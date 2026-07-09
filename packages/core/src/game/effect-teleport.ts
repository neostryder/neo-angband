/**
 * The teleport-family general effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_TELEPORT (L2507),
 * EF_TELEPORT_TO (L2703) and EF_TELEPORT_LEVEL (L2834). Like the other
 * game-layer effect handlers they mutate the live GameState (moving the player
 * or a monster across the level), so they live in game/ and register into the
 * EffectRegistry from here (registerTeleportHandlers), reading their game
 * environment from context.env.game (effect-game-env.ts) and no-opping when it
 * is absent.
 *
 * The geometry is ported faithfully: EF_TELEPORT scores every interior grid by
 * how close its distance from the start is to the desired distance (avoiding
 * vault grids unless nothing else is reachable), and EF_TELEPORT_TO rejection-
 * samples a nearby legal grid, widening its search when it cannot find one.
 * has_teleport_destination_prereqs is the shared legality test. The distance
 * jitter (one_in_(2)) and the final pick (randint0) draw from the state RNG in
 * upstream order, so a seeded run reproduces the destination exactly.
 *
 * The subsystems these handlers touch that are not modelled yet are reached
 * through the injected TeleportEnv (env.teleport) with inert defaults, so the
 * ported logic is exact where the substrate exists and simply skips what does
 * not: player_handle_post_move / handle_stuff (FOV refresh), the OF_NO_TELEPORT
 * curse and its learning, monster_target_monster (monster-vs-monster spells,
 * #19), the Dimension Door aim prompt (targeting, #24), the trap / glyph / web /
 * damaging-terrain destination predicates (traps #21, terrain), and
 * dungeon_get_next_level / dungeon_change_level (level change, #23). Arena
 * levels, decoys, sound and the monster "puzzled" message are omitted (their
 * subsystems are not modelled); they are ledgered.
 *
 * teleportMonster is the concrete backing for the project_m `teleport` hook
 * (game/project-monster.ts) deferred there: a monster teleported a fixed number
 * of grids by an area effect.
 */

import { EF, SQUARE } from "../generated";
import { distance, loc, randLoc } from "../loc";
import type { Loc } from "../loc";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter";
import { deleteMonster, monsterSwap, movePlayer } from "./context";
import type { GameState } from "./context";
import { gameEnv } from "./effect-game-env";

/**
 * The teleport-family hooks and unmodelled-subsystem seams, grouped on the
 * game effect environment (effect-game-env.ts GameEffectEnv.teleport). Every
 * field is optional; an absent field takes the inert default noted on it.
 */
export interface TeleportEnv {
  /** player_of_has(OF_NO_TELEPORT): a teleport-forbidding curse. Default off. */
  hasNoTeleport?: boolean;
  /** equip_learn_flag(OF_NO_TELEPORT) when the curse blocks a teleport. */
  onLearnNoTeleport?: () => void;
  /** monster_target_monster: a monster spell aimed at another monster (#19). */
  targetMonster?: number;
  /** player_handle_post_move + handle_stuff after the player teleports. */
  onPlayerPostMove?: (byMonster: boolean) => void;
  /** handle_stuff after a monster teleports (FOV / target refresh). */
  onMonsterPostMove?: (midx: number) => void;
  /** get_aim_dir / target_get for EF_TELEPORT_TO's Dimension Door (#24). */
  getAimTarget?: () => Loc | null;
  /** square_isplayertrap (traps, #21). Default: no player trap. */
  isPlayerTrap?: (grid: Loc) => boolean;
  /** square_iswarded (glyph of warding, #21). Default: not warded. */
  isWarded?: (grid: Loc) => boolean;
  /** square_isdamaging (lava and the like). Default: not damaging. */
  isDamaging?: (grid: Loc) => boolean;
  /** square_iswebbed (webs). Default: not webbed. */
  isWebbed?: (grid: Loc) => boolean;
  /* --- EF_TELEPORT_LEVEL --- */
  /** player_resists(ELEM_NEXUS): resist a hostile teleport-level. Default off. */
  resistsNexus?: boolean;
  /** is_quest(depth): the depth holds a quest the player cannot leave. */
  isQuest?: (depth: number) => boolean;
  /** OPT(player, birth_force_descend). Default off. */
  forceDescend?: boolean;
  /** dungeon_get_next_level(from, dir): the connected level. Default from+dir. */
  getNextLevel?: (fromDepth: number, dir: 1 | -1) => number;
  /** dungeon_change_level(target): commit a level change (#23). */
  changeLevel?: (targetDepth: number) => void;
  /** player->max_depth (deepest reached). Default: the current depth. */
  maxPlayerDepth?: number;
  /** z_info->max_depth. Default 128 (the shipped constants.txt value). */
  maxDepth?: number;
}

/** msg() convenience over the effect context's optional message sink. */
function say(ctx: EffectHandlerContext, text: string): void {
  ctx.env.messages?.msg(text);
}

/**
 * has_teleport_destination_prereqs (effect-handler-general.c L132): whether a
 * grid is a legal teleport landing spot for the player or a monster. The trap /
 * glyph / web / damaging-terrain tests come from the injected env (inert until
 * their subsystems land); the passability, occupancy and shop tests are exact.
 */
export function hasTeleportDestinationPrereqs(
  state: GameState,
  grid: Loc,
  isPlayerMoving: boolean,
  tp: TeleportEnv,
): boolean {
  const c = state.chunk;
  if (isPlayerMoving) {
    if (!c.isPassable(grid)) return false;
    if (tp.isPlayerTrap?.(grid)) return false;
  } else {
    if (!c.isMonsterWalkable(grid)) return false;
    if (tp.isWarded?.(grid)) return false;
  }
  /* square(c, grid)->mon: occupied by a monster (> 0) or the player (< 0). */
  if (c.mon(grid) !== 0) return false;
  if (tp.isDamaging?.(grid)) return false;
  if (tp.isWebbed?.(grid)) return false;
  if (c.isShop(grid)) return false;
  return true;
}

/**
 * The EF_TELEPORT grid search: score every interior grid by how well its
 * distance from `start` approximates `dis` (after the percentage and jitter
 * adjustments), preferring non-vault grids, and return a uniformly chosen best
 * grid (null when none exists). RNG draws mirror upstream: the one_in_(2)
 * jitter first, then a single randint0 over the winning grids.
 */
export function chooseTeleportDestination(
  state: GameState,
  start: Loc,
  dis: number,
  perc: number,
  isPlayerMoving: boolean,
  tp: TeleportEnv,
): Loc | null {
  const c = state.chunk;
  const rng = state.rng;
  const cap = 2 * Math.max(c.width, c.height);

  let want = dis;
  /* Percentage of the largest cardinal distance to an edge. */
  if (perc) {
    const vertical = Math.max(start.y, c.height - start.y);
    const horizontal = Math.max(start.x, c.width - start.x);
    want = Math.trunc((Math.max(vertical, horizontal) * perc) / 100);
  }

  /* Randomise the distance a little, besides what the dice allow. */
  if (rng.oneIn(2)) {
    want -= rng.randint0(Math.trunc(want / 4));
  } else {
    want += rng.randint0(Math.trunc(want / 4));
  }

  let currentScore = cap;
  let onlyVaultPossible = true;
  let spots: Loc[] = [];

  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const grid = loc(x, y);
      const d = distance(grid, start);

      /* Must move. */
      if (d === 0) continue;
      if (!hasTeleportDestinationPrereqs(state, grid, isPlayerMoving, tp)) continue;

      /* No teleporting into vaults unless there is no other choice. */
      if (c.sqinfoHas(grid, SQUARE.VAULT)) {
        if (!onlyVaultPossible) continue;
      } else {
        /* First non-vault grid: reset the threshold and drop the vault spots. */
        if (onlyVaultPossible) currentScore = cap;
        onlyVaultPossible = false;
      }

      const score = Math.abs(d - want);
      if (score > currentScore) continue;

      if (score < currentScore) {
        currentScore = score;
        spots = [grid];
      } else {
        /* Equal score: prepend, matching upstream's linked-list order. */
        spots.unshift(grid);
      }
    }
  }

  if (spots.length === 0) return null;
  return spots[rng.randint0(spots.length)] ?? null;
}

/** Move whatever is at `start` (player or monster) to `dest`. */
function moveOccupant(state: GameState, start: Loc, dest: Loc): void {
  if (state.chunk.mon(start) < 0) {
    movePlayer(state, dest);
  } else {
    monsterSwap(state, start, dest);
  }
}

/**
 * EF_TELEPORT: teleport the player (or a monster) a distance roughly equal to
 * the effect value from its current grid.
 */
const handleTELEPORT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;

  const { state } = env;
  const tp = env.teleport ?? {};
  const dis = ctx.value.base + state.rng.damroll(ctx.value.dice, ctx.value.sides);
  const perc = ctx.value.mBonus;

  /* is_player: not a monster source, or a monster spell that moves the player. */
  const isPlayer = ctx.origin.what !== "monster" || ctx.subtype !== 0;
  const tMon =
    tp.targetMonster !== undefined ? state.monsters[tp.targetMonster] : null;

  let start: Loc;
  if (ctx.x !== 0 && ctx.y !== 0) {
    /* Effect supplied the origin coordinates. */
    start = loc(ctx.x, ctx.y);
  } else if (tMon) {
    /* Monster teleporting another monster. */
    start = tMon.grid;
  } else if (isPlayer) {
    start = state.actor.grid;

    /* A no-teleport grid blocks all but a short, fixed hop. */
    if (
      state.chunk.sqinfoHas(start, SQUARE.NO_TELEPORT) &&
      (dis > 10 || dis === 0)
    ) {
      say(ctx, "Teleportation forbidden!");
      return true;
    }
    /* A no-teleport curse blocks it outright. */
    if (tp.hasNoTeleport) {
      tp.onLearnNoTeleport?.();
      say(ctx, "Teleportation forbidden!");
      return true;
    }
  } else {
    /* Monster teleporting itself. */
    if (ctx.origin.what !== "monster") return true;
    start = state.monsters[ctx.origin.monster]?.grid ?? state.actor.grid;
  }

  const dest = chooseTeleportDestination(state, start, dis, perc, isPlayer, tp);
  if (!dest) {
    /* Very unlikely; the monster "puzzled" message is lore (#19), omitted. */
    if (isPlayer) say(ctx, "Failed to find teleport destination!");
    return true;
  }

  const startOcc = state.chunk.mon(start);
  moveOccupant(state, start, dest);
  if (isPlayer) tp.onPlayerPostMove?.(ctx.origin.what === "monster");
  else if (startOcc > 0) tp.onMonsterPostMove?.(startOcc);

  /* Clear any projection marker to prevent double processing. */
  state.chunk.sqinfoOff(dest, SQUARE.PROJECT);
  return true;
};

/**
 * EF_TELEPORT_TO: teleport the player or the target monster to a grid near a
 * given location (a monster, a chosen target, or supplied coordinates).
 */
const handleTELEPORT_TO: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;

  const { state } = env;
  const tp = env.teleport ?? {};
  const isMonsterOrigin = ctx.origin.what === "monster";
  const mon =
    ctx.origin.what === "monster" ? state.monsters[ctx.origin.monster] : null;
  const tMon =
    tp.targetMonster !== undefined ? state.monsters[tp.targetMonster] : null;

  let dis = 0;
  let start: Loc;
  let playerMoves = false;

  /* Where are we coming from? */
  if (tMon) {
    start = tMon.grid;
  } else if (ctx.subtype !== 0) {
    /* Monster teleporting to the player. */
    if (!mon) return true;
    start = mon.grid;
  } else {
    /* Player being teleported. */
    playerMoves = true;
    start = state.actor.grid;
    if (state.chunk.sqinfoHas(start, SQUARE.NO_TELEPORT)) {
      say(ctx, "Teleportation forbidden!");
      return true;
    }
    if (tp.hasNoTeleport) {
      tp.onLearnNoTeleport?.();
      say(ctx, "Teleportation forbidden!");
      return true;
    }
  }

  /* Where are we going? */
  let aim: Loc;
  let dimDoor = false;
  if (ctx.x !== 0 && ctx.y !== 0) {
    aim = loc(ctx.x, ctx.y);
  } else if (mon) {
    if (ctx.subtype !== 0) {
      /* Monster teleporting to the player. */
      aim = state.actor.grid;
      dis = 2;
    } else {
      /* Player being teleported to the monster. */
      aim = mon.grid;
    }
  } else {
    /* Player choice (Dimension Door): the aim prompt is a targeting seam. */
    const chosen = tp.getAimTarget ? tp.getAimTarget() : null;
    if (!chosen) return false;
    aim = chosen;
    if (state.chunk.sqinfoHas(aim, SQUARE.VAULT)) dis = 10;
    dimDoor = true;
  }

  /* Find a usable location, widening the search when it keeps failing. */
  let land: Loc;
  let ctr = 0;
  /* eslint-disable-next-line no-constant-condition */
  for (;;) {
    do {
      land = randLoc(state.rng, aim, dis, dis);
    } while (!state.chunk.inBoundsFully(land));

    if (hasTeleportDestinationPrereqs(state, land, playerMoves, tp)) break;

    if (++ctr > 4 * dis * dis + 4 * dis + 1) {
      ctr = 0;
      dis++;
    }
  }

  const startOcc = state.chunk.mon(start);
  moveOccupant(state, start, land);
  if (playerMoves) tp.onPlayerPostMove?.(isMonsterOrigin);
  else if (startOcc > 0) tp.onMonsterPostMove?.(startOcc);

  /* Cancel the location target on a Dimension Door (targeting, #24). */
  void dimDoor;
  state.chunk.sqinfoOff(land, SQUARE.PROJECT);
  return true;
};

/**
 * EF_TELEPORT_LEVEL: move the player one level up or down (random when both are
 * legal). The up/down decision is ported exactly; the actual level change is
 * the injected changeLevel hook (#23).
 */
const handleTELEPORT_LEVEL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;

  const { state } = env;
  const tp = env.teleport ?? {};
  const depth = state.chunk.depth;
  const maxDepth = tp.maxDepth ?? 128;
  const maxPlayerDepth = tp.maxPlayerDepth ?? depth;
  const getNext = tp.getNextLevel ?? ((from: number, dir: 1 | -1) => from + dir);
  const isQuest = tp.isQuest ?? (() => false);

  const tMon =
    tp.targetMonster !== undefined ? state.monsters[tp.targetMonster] : null;

  /* A monster targeting another monster: it is simply gone. */
  if (tMon) {
    deleteMonster(state, tp.targetMonster!);
    return true;
  }

  if (state.chunk.sqinfoHas(state.actor.grid, SQUARE.NO_TELEPORT)) {
    say(ctx, "Teleportation forbidden!");
    return true;
  }
  if (tp.hasNoTeleport) {
    tp.onLearnNoTeleport?.();
    say(ctx, "Teleportation forbidden!");
    return true;
  }

  /* Resist hostile teleport. */
  if (ctx.origin.what === "monster" && tp.resistsNexus) {
    say(ctx, "You resist the effect!");
    return true;
  }

  let up = true;
  let down = true;
  let targetDepth = getNext(maxPlayerDepth, 1);

  /* No going up with force_descend or in the town. */
  if (tp.forceDescend || depth === 0) up = false;
  /* No forcing the player down to quest levels they cannot leave. */
  if (!up && isQuest(targetDepth)) down = false;
  /* Cannot leave quest levels or descend past the bottom of the dungeon. */
  if (isQuest(depth) || depth >= maxDepth - 1) down = false;

  /* Determine up/down if not already forced. */
  if (up && down) {
    if (state.rng.randint0(100) < 50) up = false;
    else down = false;
  }

  if (up) {
    say(ctx, "You rise up through the ceiling.");
    targetDepth = getNext(depth, -1);
    tp.changeLevel?.(targetDepth);
  } else if (down) {
    say(ctx, "You sink through the floor.");
    targetDepth = tp.forceDescend
      ? getNext(maxPlayerDepth, 1)
      : getNext(depth, 1);
    tp.changeLevel?.(targetDepth);
  } else {
    say(ctx, "Nothing happens.");
  }

  return true;
};

/**
 * teleportMonster: the concrete backing for the project_m `teleport` hook
 * (game/project-monster.ts). A monster is teleported `distance` grids from its
 * current location, exactly as EF_TELEPORT does for a self-teleporting monster.
 */
export function teleportMonster(
  state: GameState,
  midx: number,
  dist: number,
  tp: TeleportEnv = {},
): void {
  const mon = state.monsters[midx];
  if (!mon) return;
  const start = mon.grid;
  const dest = chooseTeleportDestination(state, start, dist, 0, false, tp);
  if (!dest) return;
  monsterSwap(state, start, dest);
  tp.onMonsterPostMove?.(midx);
  state.chunk.sqinfoOff(dest, SQUARE.PROJECT);
}

/** The teleport-family handlers, keyed by upstream EF code. */
const TELEPORT_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.TELEPORT, handleTELEPORT],
  [EF.TELEPORT_TO, handleTELEPORT_TO],
  [EF.TELEPORT_LEVEL, handleTELEPORT_LEVEL],
]);

/**
 * Register the teleport-family handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each handler
 * reads its game environment from context.env.game (attach it with
 * attachGameEnv) and no-ops when it is absent.
 */
export function registerTeleportHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of TELEPORT_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The teleport-family EF codes this module registers. */
export const TELEPORT_HANDLER_CODES: readonly number[] = [
  ...TELEPORT_HANDLERS.keys(),
];
