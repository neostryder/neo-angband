/**
 * The teleport-family general effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_TELEPORT (L2507),
 * EF_TELEPORT_TO (L2703), EF_TELEPORT_LEVEL (L2834) and the level-regenerating
 * EF_ALTER_REALITY (L1184). Like the other
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
 * The surrounding subsystems are reached through the injected TeleportEnv
 * (env.teleport), which session/game.ts wireGame now supplies IN FULL:
 * player_handle_post_move and handle_stuff, the OF_NO_TELEPORT curse and its
 * equip_learn_flag, the trap / glyph / web / damaging-terrain destination
 * predicates, player_resists(ELEM_NEXUS), player->max_depth, z_info->max_depth,
 * birth_force_descend, dungeon_get_next_level / dungeon_change_level, and the
 * Dimension Door aim prompt. Arena, decoy and target state use their live
 * GameState counterparts, and monster_target_monster is called directly
 * (teleportTargetMonster below).
 *
 * THAT LIST USED TO READ "the subsystems ... that are not modelled yet ...
 * with inert defaults", naming #19 / #21 / #23 / #24 as the blockers. Every one
 * of those had landed. Nine members had no producer anywhere, so their "inert
 * default" was a shipped feature that did nothing: the curse never blocked a
 * teleport, a teleport could land the player in lava, nexus resistance never
 * foiled a hostile teleport-level, force_descend targeted the current depth,
 * and Dimension Door returned false every single time. Wired 2026-08-09;
 * session/teleport-env-wiring.test.ts drives the real handlers through the real
 * env and is what stops it happening again.
 *
 * The sounds ARE ported now (PORT_TODO 3.26): MSG_TELEPORT / MSG_TPOTHER at
 * the two swap sites and MSG_TPLEVEL on the level-change messages, each
 * through state.sound at the point upstream calls sound(). So is the monster
 * "puzzled" message, which this header called deferred lore long after the
 * monster message queue landed (PORT_TODO 3.1): a failed teleport whose caster
 * is a visible monster now queues MON_MSG_BRIEF_PUZZLE, as
 * effect-handler-general.c:2643-2650 does.
 *
 * teleportMonster is the concrete backing for the project_m `teleport` hook
 * (game/project-monster.ts) deferred there: a monster teleported a fixed number
 * of grids by an area effect.
 */

import { EF, MON_MSG, MSG, SQUARE } from "../generated/index.js";
import { addMonsterMessage } from "./mon-message.js";
import { squareIsSeen } from "../world/view.js";
import { distance, loc, randLoc } from "../loc.js";
import type { Loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter.js";
import { deleteMonster, monsterSwap, movePlayer } from "./context.js";
import type { GameState } from "./context.js";
import { gameEnv } from "./effect-game-env.js";
import {
  caveFindDecoy,
  destroyDecoy,
  monsterIsDecoyed,
  monsterTargetMonster,
} from "./effect-mon-origin.js";
import { targetSetLocation } from "./target.js";

/**
 * The teleport-family seams, grouped on the game effect environment
 * (effect-game-env.ts GameEffectEnv.teleport).
 *
 * Every field is optional and every one carries a documented default, so a
 * worldless harness can run a handler with `{}`. THE LIVE GAME SUPPLIES ALL OF
 * THEM (session/game.ts); the defaults below describe what a test that omits
 * one gets, not what the shipped game does. Reading them as "the port has not
 * built this yet" is what let nine of them ship unsupplied - see the module
 * header.
 */
export interface TeleportEnv {
  /** player_of_has(OF_NO_TELEPORT): a teleport-forbidding curse. Default off. */
  hasNoTeleport?: boolean;
  /** equip_learn_flag(OF_NO_TELEPORT) when the curse blocks a teleport. */
  onLearnNoTeleport?: () => void;
  /**
   * An explicit override for monster_target_monster. Default (and the live
   * game's answer) is the real thing: teleportTargetMonster reads the caster's
   * own mon->target.midx.
   */
  targetMonster?: number;
  /** player_handle_post_move + handle_stuff after the player teleports. */
  onPlayerPostMove?: (byMonster: boolean) => void;
  /** handle_stuff after a monster teleports (FOV / target refresh). */
  onMonsterPostMove?: (midx: number) => void;
  /** get_aim_dir / target_get for EF_TELEPORT_TO's Dimension Door. */
  getAimTarget?: () => Loc | null;
  /** square_isplayertrap. Default: no player trap. */
  isPlayerTrap?: (grid: Loc) => boolean;
  /** square_iswarded (glyph of warding). Default: not warded. */
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
  /** dungeon_change_level(target): commit a level change. */
  changeLevel?: (targetDepth: number) => void;
  /** player->max_depth (deepest reached). Default: the current depth. */
  maxPlayerDepth?: number;
  /** z_info->max_depth. Default 128 (the shipped constants.txt value). */
  maxDepth?: number;
}

/**
 * effectAimDirRequest (the RNG-free shell probe, the sibling of
 * effect-item.ts itemTargetRequest and effect-monster.ts banishSymbolRequest):
 * does this chain contain a handler that will ask get_aim_dir ITSELF?
 *
 * Today that is exactly one branch: EF_TELEPORT_TO with no supplied
 * coordinates, cast by the player - Dimension Door. TELEPORT_TO is not an
 * `aim` effect in list-effects.h, so the command's own get_aim_dir never runs
 * and the shell would otherwise never ask. Returns false on an arena level,
 * where the handler returns before the prompt.
 */
export function effectAimDirRequest(
  chain: import("../effects/effect.js").Effect | null,
  state: GameState,
): boolean {
  if (state.arenaLevel) return false;
  for (let e = chain; e; e = e.next) {
    /* The player-choice arm is `!context->y || !context->x` with a player
     * source (effect-handler-general.c:2756-2770); a monster source takes the
     * `else if (mon)` arm and never prompts. */
    if (e.index === EF.TELEPORT_TO && e.subtype === 0 && (e.x === 0 || e.y === 0)) {
      return true;
    }
  }
  return false;
}

/**
 * monster_target_monster (effect-handler-general.c:96) for the three teleport
 * handlers that branch on it.
 *
 * This used to be `tp.targetMonster !== undefined ? ... : null` and NOTHING
 * supplied tp.targetMonster, so a monster teleporting the monster it was aiming
 * at instead teleported itself, and EF_TELEPORT_LEVEL's "the target is simply
 * gone" arm was unreachable. The excuse on the seam - "monster-vs-monster
 * spells (#19)" - outlived its subsystem: effect-mon-origin.ts has exported
 * monsterTargetMonster for a long time and effect-attack, effect-general and
 * effect-terrain all call it directly. The dep stays as an explicit override so
 * a test or a mod can still pin the target.
 */
function teleportTargetMonster(
  state: GameState,
  ctx: EffectHandlerContext,
  tp: TeleportEnv,
): Monster | null {
  if (tp.targetMonster !== undefined) {
    return state.monsters[tp.targetMonster] ?? null;
  }
  if (ctx.origin.what !== "monster") return null;
  return monsterTargetMonster(state, ctx.origin.monster);
}

/**
 * msg() convenience over the effect context's optional message sink. `msgt` is
 * a MSG_* NAME (the sink's convention, shared with effect-attack and
 * take-hit-hooks), and supplies msgt's message half only - the sound half is
 * state.sound at the call site, because this helper has no state.
 */
function say(ctx: EffectHandlerContext, text: string, msgt?: string): void {
  ctx.env.messages?.msg(text, msgt);
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

  /* No teleporting in arena levels (effect-handler-general.c:2529-2530).
   *
   * Position matters, and not where a reader would guess. The damroll above is
   * a C LOCAL INITIALISER (L2510-2511), evaluated before the function body, so
   * upstream spends the distance roll even when the arena refusal is about to
   * return - and this refusal must too, or a single-combat scroll read would
   * shift every RNG draw in the rest of the game. The refusal comes after
   * ident, so the scroll still identifies. */
  if (state.arenaLevel) return true;

  /* is_player: not a monster source, or a monster spell that moves the player. */
  const isPlayer = ctx.origin.what !== "monster" || ctx.subtype !== 0;
  const tMon = teleportTargetMonster(state, ctx, tp);

  let start: Loc;
  if (ctx.x !== 0 && ctx.y !== 0) {
    /* Effect supplied the origin coordinates. */
    start = loc(ctx.x, ctx.y);
  } else if (tMon) {
    /* Monster teleporting another monster. */
    start = tMon.grid;
  } else if (isPlayer) {
    start = state.actor.grid;

    /* A no-teleport grid blocks all but a short, fixed hop:
     * square_isno_teleport (cave-square.c:538). */
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
    /* "Report failure (very unlikely)" (effect-handler-general.c:2636-2652).
     * BOTH arms, not just the player's. With teleport-self or teleport-other
     * it is the CASTER that looks puzzled, and only when its grid is seen.
     * This used to say the message was "lore (#19), omitted" - the monster
     * message queue landed at PORT_TODO 3.1 and the excuse outlived it, which
     * is what leaves an ordinary missing call looking like a missing
     * subsystem. */
    if (isPlayer) {
      say(ctx, "Failed to find teleport destination!");
    } else if (ctx.origin.what === "monster") {
      const caster = state.monsters[ctx.origin.monster];
      if (caster && squareIsSeen(state.chunk, caster.grid)) {
        addMonsterMessage(state, caster, MON_MSG.BRIEF_PUZZLE, true);
      }
    }
    return true;
  }

  /* sound(is_player ? MSG_TELEPORT : MSG_TPOTHER) (effect-handler-general.c
   * :2666): after the spot is picked, before the swap. */
  state.sound?.(isPlayer ? MSG.TELEPORT : MSG.TPOTHER);

  const startOcc = state.chunk.mon(start);
  moveOccupant(state, start, dest);
  if (isPlayer) tp.onPlayerPostMove?.(ctx.origin.what === "monster");
  else if (startOcc > 0) tp.onMonsterPostMove?.(startOcc);

  /* Clear any projection marker to prevent double processing. */
  state.chunk.sqinfoOff(dest, SQUARE.PROJECT);
  return true;
};

/**
 * EF_TELEPORT_TO's landing search: rejection-sample a legal grid near `aim`,
 * widening the search radius when it keeps failing. RNG draws (randLoc per
 * attempt) match upstream.
 */
function findLandingNear(
  state: GameState,
  aim: Loc,
  dis: number,
  isPlayerMoving: boolean,
  tp: TeleportEnv,
): Loc {
  let land: Loc;
  let ctr = 0;
   
  for (;;) {
    do {
      land = randLoc(state.rng, aim, dis, dis);
    } while (!state.chunk.inBoundsFully(land));

    if (hasTeleportDestinationPrereqs(state, land, isPlayerMoving, tp)) {
      return land;
    }

    if (++ctr > 4 * dis * dis + 4 * dis + 1) {
      ctr = 0;
      dis++;
    }
  }
}

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
  const tMon = teleportTargetMonster(state, ctx, tp);

  /* No teleporting in arena levels (effect-handler-general.c:2714-2715). */
  if (state.arenaLevel) return true;

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
    /* Targeted decoys get destroyed (effect-handler-general.c:2735-2739). */
    if (mon && monsterIsDecoyed(state, mon)) {
      destroyDecoy(state, env.general?.trapDeps, (t) => say(ctx, t));
      return true;
    }

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
  const land = findLandingNear(state, aim, dis, playerMoves, tp);

  /* sound(MSG_TELEPORT) (effect-handler-general.c:2808). */
  state.sound?.(MSG.TELEPORT);

  const startOcc = state.chunk.mon(start);
  moveOccupant(state, start, land);
  if (playerMoves) tp.onPlayerPostMove?.(isMonsterOrigin);
  else if (startOcc > 0) tp.onMonsterPostMove?.(startOcc);

  /* Cancel the location target on a Dimension Door
   * (effect-handler-general.c:2817-2820). */
  if (dimDoor) targetSetLocation(state, loc(0, 0));
  state.chunk.sqinfoOff(land, SQUARE.PROJECT);
  return true;
};

/**
 * teleportPlayerTo: the player slice of EF_TELEPORT_TO with supplied
 * coordinates, for callers dispatching through effect_simple (the NEXUS
 * "teleport to" branch of project-player.c). The forbidden-grid / curse
 * checks and the landing search are the handler's.
 */
export function teleportPlayerTo(
  state: GameState,
  aim: Loc,
  tp: TeleportEnv = {},
  say?: (text: string) => void,
): void {
  const start = state.actor.grid;
  if (state.chunk.sqinfoHas(start, SQUARE.NO_TELEPORT)) {
    say?.("Teleportation forbidden!");
    return;
  }
  if (tp.hasNoTeleport) {
    tp.onLearnNoTeleport?.();
    say?.("Teleportation forbidden!");
    return;
  }

  const land = findLandingNear(state, aim, 0, true, tp);
  /* sound(MSG_TELEPORT) (effect-handler-general.c:2808), the handler's. */
  state.sound?.(MSG.TELEPORT);
  movePlayer(state, land);
  tp.onPlayerPostMove?.(true);
  state.chunk.sqinfoOff(land, SQUARE.PROJECT);
}

/**
 * teleportPlayerLevel: the player path of EF_TELEPORT_LEVEL (the up/down
 * decision and its messages), shared between the handler and the NEXUS
 * "teleport level" branch. `hostile` runs the nexus-resistance check a
 * monster-origin effect gets.
 */
export function teleportPlayerLevel(
  state: GameState,
  tp: TeleportEnv,
  say: (text: string, msgt?: string) => void,
  hostile: boolean,
): void {
  const depth = state.chunk.depth;
  const maxDepth = tp.maxDepth ?? 128;
  const maxPlayerDepth = tp.maxPlayerDepth ?? depth;
  const getNext = tp.getNextLevel ?? ((from: number, dir: 1 | -1) => from + dir);
  const isQuest = tp.isQuest ?? (() => false);

  if (state.chunk.sqinfoHas(state.actor.grid, SQUARE.NO_TELEPORT)) {
    say("Teleportation forbidden!");
    return;
  }
  if (tp.hasNoTeleport) {
    tp.onLearnNoTeleport?.();
    say("Teleportation forbidden!");
    return;
  }

  /* Resist hostile teleport. */
  if (hostile && tp.resistsNexus) {
    say("You resist the effect!");
    return;
  }

  /* OPT(player, birth_force_descend): the injected dep wins, else the wired
   * option store, else off (the shipped default). */
  const forceDescend =
    tp.forceDescend ?? state.options?.get("birth_force_descend") ?? false;

  let up = true;
  let down = true;
  let targetDepth = getNext(maxPlayerDepth, 1);

  /* No going up with force_descend or in the town. */
  if (forceDescend || depth === 0) up = false;
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
    /* msgt(MSG_TPLEVEL, ...) (effect-handler-general.c:2909): the typed sink is
     * msgt, so it carries the sound. */
    say("You rise up through the ceiling.", "TPLEVEL");
    targetDepth = getNext(depth, -1);
    tp.changeLevel?.(targetDepth);
  } else if (down) {
    /* msgt(MSG_TPLEVEL, ...) (effect-handler-general.c:2915). */
    say("You sink through the floor.", "TPLEVEL");
    targetDepth = forceDescend
      ? getNext(maxPlayerDepth, 1)
      : getNext(depth, 1);
    tp.changeLevel?.(targetDepth);
  } else {
    say("Nothing happens.");
  }
}

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
  const tMon = teleportTargetMonster(state, ctx, tp);

  /* No teleporting in arena levels (effect-handler-general.c:2844-2845). */
  if (state.arenaLevel) return true;

  /* A monster targeting another monster: it is simply gone. */
  if (tMon) {
    deleteMonster(state, tMon.midx);
    return true;
  }

  /* Targeted decoys get destroyed (effect-handler-general.c:2855-2859). */
  if (caveFindDecoy(state)) {
    destroyDecoy(state, env.general?.trapDeps, (t) => say(ctx, t));
    return true;
  }

  teleportPlayerLevel(
    state,
    tp,
    (t, type) => say(ctx, t, type),
    ctx.origin.what === "monster",
  );
  return true;
};

/**
 * EF_ALTER_REALITY: regenerate the current dungeon level in place. The world
 * change is the injected changeLevel hook (staying on the same depth, #23).
 *
 * The arena guard used to be omitted here "because arenas are not modelled".
 * They are, and were when that was written: state.arenaLevel is set by
 * EF_SINGLE_COMBAT and honoured at a dozen sites. Regenerating the level from
 * inside single combat would have thrown away the arena and the opponent.
 */
const handleALTER_REALITY: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* effect-handler-general.c:1186-1187: the refusal returns BEFORE ident is
   * set, so an arena use does not even identify the scroll. */
  if (state.arenaLevel) return true;

  ctx.ident = true;
  const tp = env.teleport ?? {};
  say(ctx, "The world changes!");
  tp.changeLevel?.(state.chunk.depth);
  return true;
};

/**
 * teleportPlayer: the player self-teleport slice of EF_TELEPORT, for callers
 * that dispatch it through effect_simple (project-player.c's GRAVITY blink,
 * NEXUS). Runs the same forbidden-grid / curse checks and destination search
 * as handleTELEPORT's player branch, for a fixed distance.
 */
export function teleportPlayer(
  state: GameState,
  dis: number,
  tp: TeleportEnv = {},
  say?: (text: string) => void,
): void {
  const start = state.actor.grid;

  /* A no-teleport grid blocks all but a short, fixed hop. */
  if (
    state.chunk.sqinfoHas(start, SQUARE.NO_TELEPORT) &&
    (dis > 10 || dis === 0)
  ) {
    say?.("Teleportation forbidden!");
    return;
  }
  /* A no-teleport curse blocks it outright. */
  if (tp.hasNoTeleport) {
    tp.onLearnNoTeleport?.();
    say?.("Teleportation forbidden!");
    return;
  }

  const dest = chooseTeleportDestination(state, start, dis, 0, true, tp);
  if (!dest) {
    say?.("Failed to find teleport destination!");
    return;
  }

  /* sound(MSG_TELEPORT) (effect-handler-general.c:2666, is_player arm). */
  state.sound?.(MSG.TELEPORT);
  movePlayer(state, dest);
  tp.onPlayerPostMove?.(true);
  state.chunk.sqinfoOff(dest, SQUARE.PROJECT);
}

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
  /* sound(MSG_TPOTHER) (effect-handler-general.c:2666, the !is_player arm). */
  state.sound?.(MSG.TPOTHER);
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
  /* effect_handler_TELEPORT_TO (effect-handler-general.c:2703) */
  [EF.TELEPORT_TO, handleTELEPORT_TO],
  /* effect_handler_TELEPORT_LEVEL (effect-handler-general.c:2834) */
  [EF.TELEPORT_LEVEL, handleTELEPORT_LEVEL],
  /* effect_handler_ALTER_REALITY (effect-handler-general.c:1184) */
  [EF.ALTER_REALITY, handleALTER_REALITY],
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
