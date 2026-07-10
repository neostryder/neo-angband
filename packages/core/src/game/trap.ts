/**
 * Live traps, ported from reference/src/trap.c (Angband 4.2.6): trap
 * instances on squares (state.traps, the same GameState seam as floor
 * piles and monster groups), placement (pick_trap / place_trap), reveal,
 * activation (hit_trap running the kind's effect chains through the
 * effect interpreter with a trap source), disable timeouts, door locks
 * (the "door lock" trap kind), and the disarm command with the cmd-cave.c
 * skill math.
 *
 * Knowledge simplifications (with #24): traps place with their upstream
 * visibility (most are TRF_INVISIBLE until revealed or triggered);
 * square_memorize_traps / the player's shadow cave are replaced by the
 * VISIBLE instance flag the renderer reads. player_is_trapsafe and the
 * OF_ save-flag checks ride on the playerHasFlag hook; a flag that saves
 * is noticed on the equipment supplying it (equipLearnFlag, rune
 * knowledge #13).
 */

import type { Loc } from "../loc";
import { DDGRID, locEq, locSum } from "../loc";
import { SKILL } from "../player/types";
import { TMD, TRF } from "../generated";
import { checkHit } from "../combat/mon-melee";
import { equipLearnFlag } from "../obj/knowledge";
import { featIsTrapHolding } from "../world/chunk";
import type { TrapKind } from "../world/trap";
import { lookupTrap } from "../world/trap";
import { sourceTrap } from "../effects/interpreter";
import type { GameState, PlayerCommand } from "./context";
import { movePlayer } from "./context";
import { floorPile } from "./floor";
import { buildObjectEffectChain } from "./obj-cmd";
import type { ObjCmdDeps } from "./obj-cmd";
import { buildEffectContext } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import type { ActionRegistry } from "./player-turn";

/** struct trap: one trap instance on a grid. */
export interface Trap {
  tidx: number;
  kind: TrapKind;
  grid: Loc;
  /** Rolled from the kind's power at placement (vs SEARCH on reveal). */
  power: number;
  /** Turns this trap is disabled for (0 = armed). */
  timeout: number;
  /** Instance flags (a copy of the kind's; VISIBLE toggles here). */
  flags: import("../bitflag").FlagSet;
}

/** Hooks for unported subsystems; all optional. */
export interface TrapEnv {
  msg?: (text: string) => void;
  /** player_is_trapsafe / player_of_has(OF_TRAP_IMMUNE etc, #13/#24). */
  playerHasFlag?: (ofFlag: number) => boolean;
  /** is_quest(depth) for the trapdoor legality check. */
  isQuest?: (depth: number) => boolean;
  /** dungeon_change_level for TRF_DOWN (default: signal generateLevel). */
  changeLevel?: (state: GameState) => void;
  /** player_exp_gain on a successful disarm (experience system). */
  expGain?: (amount: number) => void;
  disturb?: () => void;
}

/** Everything the trap runtime needs beyond the state. */
export interface TrapDeps {
  kinds: readonly TrapKind[];
  /** The effect stack (same registry/cast/envDeps bundle as obj-cmd). */
  effects?: Pick<
    ObjCmdDeps,
    "registry" | "cast" | "envDeps" | "inject" | "teleport" | "general" | "item"
  >;
  env?: TrapEnv;
}

/**
 * The trap-backed TeleportEnv / FloorEnv predicates (square_isplayertrap,
 * square_iswarded, square_iswebbed) for the modules that stubbed them.
 */
export function trapPredicates(state: GameState): {
  isPlayerTrap: (grid: Loc) => boolean;
  isWarded: (grid: Loc) => boolean;
  isWebbed: (grid: Loc) => boolean;
  isTrap: (grid: Loc) => boolean;
} {
  return {
    isPlayerTrap: (grid) => squareIsPlayerTrap(state, grid),
    isWarded: (grid) => squareIsWarded(state, grid),
    isWebbed: (grid) => squareIsWebbed(state, grid),
    isTrap: (grid) => squareIsTrap(state, grid),
  };
}

function gridIdx(state: GameState, grid: Loc): number {
  return grid.y * state.chunk.width + grid.x;
}

/** square_trap: the traps on a grid, newest first (place prepends). */
export function squareTrap(state: GameState, grid: Loc): readonly Trap[] {
  return state.traps.get(gridIdx(state, grid)) ?? [];
}

/** square_istrap-ish: any trap here? */
export function squareIsTrap(state: GameState, grid: Loc): boolean {
  return squareTrap(state, grid).length > 0;
}

/** square_trap_flag: any trap here with the given TRF flag? */
export function squareTrapFlag(
  state: GameState,
  grid: Loc,
  flag: number,
): boolean {
  return squareTrap(state, grid).some((t) => t.flags.has(flag));
}

/** square_isplayertrap. */
export function squareIsPlayerTrap(state: GameState, grid: Loc): boolean {
  return squareTrapFlag(state, grid, TRF.TRAP);
}

/** square_isvisibletrap. */
export function squareIsVisibleTrap(state: GameState, grid: Loc): boolean {
  return squareTrapFlag(state, grid, TRF.VISIBLE);
}

/** square_iswarded / square_iswebbed. */
export function squareIsWarded(state: GameState, grid: Loc): boolean {
  return squareTrapFlag(state, grid, TRF.GLYPH);
}
export function squareIsWebbed(state: GameState, grid: Loc): boolean {
  return squareTrapFlag(state, grid, TRF.WEB);
}

/** square_trap_specific: a trap of the exact kind index here? */
export function squareTrapSpecific(
  state: GameState,
  grid: Loc,
  tidx: number,
): boolean {
  return squareTrap(state, grid).some((t) => t.tidx === tidx);
}

/** square_remove_trap: remove one trap instance. */
export function squareRemoveTrap(
  state: GameState,
  grid: Loc,
  trap: Trap,
): boolean {
  const key = gridIdx(state, grid);
  const list = state.traps.get(key);
  if (!list) return false;
  const at = list.indexOf(trap);
  if (at < 0) return false;
  list.splice(at, 1);
  if (list.length === 0) state.traps.delete(key);
  return true;
}

/** square_remove_all_traps / _of_type. */
export function squareRemoveAllTraps(
  state: GameState,
  grid: Loc,
  tidx = -1,
): boolean {
  const key = gridIdx(state, grid);
  const list = state.traps.get(key);
  if (!list || list.length === 0) return false;
  if (tidx < 0) {
    state.traps.delete(key);
    return true;
  }
  const kept = list.filter((t) => t.tidx !== tidx);
  const removed = kept.length !== list.length;
  if (kept.length === 0) state.traps.delete(key);
  else state.traps.set(key, kept);
  return removed;
}

/**
 * square_player_trap_allowed: no second trap, no objects, trappable
 * terrain (TF TRAP on the feature).
 */
export function squarePlayerTrapAllowed(
  state: GameState,
  grid: Loc,
): boolean {
  if (squareIsTrap(state, grid)) return false;
  if (floorPile(state, grid).length > 0) return false;
  return featIsTrapHolding(state.chunk.features, state.chunk.feat(grid));
}

/**
 * pick_trap: choose a player-trap kind for a feature at a trap level, by
 * cumulative rarity. Returns the t_idx or -1.
 */
export function pickTrap(
  state: GameState,
  feat: number,
  trapLevel: number,
  deps: TrapDeps,
): number {
  const env = deps.env ?? {};
  void feat; /* Only floor features are trappable in the ported subset. */
  if (state.chunk.depth === 0) return -1;

  const probs: number[] = [];
  let probMax = 0;
  for (const kind of deps.kinds) {
    probs[kind.tidx] = probMax;
    if (!kind.name) continue;
    if (!kind.rarity) continue;
    if (!kind.flags.has(TRF.TRAP)) continue;
    if (kind.minDepth > trapLevel) continue;

    /* Floor features need floor-capable traps. */
    if (!kind.flags.has(TRF.FLOOR)) continue;

    /* Check legality of trapdoors. */
    if (kind.flags.has(TRF.DOWN)) {
      if (env.isQuest?.(state.chunk.depth)) continue;
      if (state.chunk.depth >= state.z.maxDepth - 1) continue;
    }

    probs[kind.tidx] = probMax + Math.trunc(100 / kind.rarity);
    probMax = probs[kind.tidx] as number;
  }
  if (probMax === 0) return -1;

  const pick = state.rng.randint0(probMax);
  for (const kind of deps.kinds) {
    if (pick < (probs[kind.tidx] ?? 0)) return kind.tidx;
  }
  return -1;
}

/**
 * place_trap: make a new trap of the given type (or a random player trap
 * when the index is not legal).
 */
export function placeTrap(
  state: GameState,
  grid: Loc,
  tIdx: number,
  trapLevel: number,
  deps: TrapDeps,
): void {
  if (tIdx <= 0 || tIdx >= deps.kinds.length) {
    if (!squarePlayerTrapAllowed(state, grid)) return;
    tIdx = pickTrap(state, state.chunk.feat(grid), trapLevel, deps);
  }
  if (tIdx < 0) return;
  const kind = deps.kinds[tIdx]!;

  const trap: Trap = {
    tidx: tIdx,
    kind,
    grid,
    power: state.rng.randcalc(kind.power, trapLevel, "randomise"),
    timeout: 0,
    flags: kind.flags.clone(),
  };
  const key = gridIdx(state, grid);
  const list = state.traps.get(key);
  if (list) list.unshift(trap);
  else state.traps.set(key, [trap]);
}

/**
 * square_reveal_trap: mark unnoticed player traps visible when the SEARCH
 * skill beats their power (or always). Returns whether any were found.
 */
export function squareRevealTrap(
  state: GameState,
  grid: Loc,
  always: boolean,
  deps: TrapDeps,
): boolean {
  if (!squareIsPlayerTrap(state, grid)) return false;
  let found = 0;
  for (const trap of squareTrap(state, grid)) {
    if (!trap.flags.has(TRF.TRAP)) continue;
    const search = state.actor.combat.skills[SKILL.SEARCH] ?? 0;
    if (!always && search < trap.power) continue;
    if (!trap.flags.has(TRF.VISIBLE)) {
      trap.flags.on(TRF.VISIBLE);
      found++;
    }
  }
  if (found) {
    deps.env?.msg?.(
      found === 1 ? "You have found a trap." : `You have found ${found} traps.`,
    );
  }
  return found !== 0;
}

/**
 * hit_trap: trigger the player traps on a grid. `delayed` selects
 * TRF_DELAY traps (1), immediate traps (0), or all (-1).
 */
export function hitTrap(
  state: GameState,
  grid: Loc,
  delayed: number,
  deps: TrapDeps,
): void {
  const env = deps.env ?? {};
  for (const trap of [...squareTrap(state, grid)]) {
    if (!trap.kind.flags.has(TRF.TRAP)) continue;
    if (trap.timeout) continue;
    const isDelay = trap.kind.flags.has(TRF.DELAY) ? 1 : 0;
    if (delayed !== isDelay && delayed !== -1) continue;

    /* player_is_trapsafe (OF_TRAP_IMMUNE / shape flags, hook). */
    if (env.playerHasFlag?.(-1 /* trapsafe sentinel unused */)) {
      /* Reserved; trap-safety lands with rune knowledge. */
    }

    env.disturb?.();
    if (trap.kind.msg) env.msg?.(trap.kind.msg);

    /* Test for save due to flag (OF_ flags via the hook); a flag that
     * saves is noticed on whatever equipment supplies it (trap.c L538). */
    let saved = false;
    for (const flag of trap.kind.saveFlags) {
      if (env.playerHasFlag?.(flag)) {
        saved = true;
        equipLearnFlag(state.actor.player, state.runeEnv, flag);
      }
    }

    /* Test for save due to armor. */
    if (
      trap.kind.flags.has(TRF.SAVE_ARMOR) &&
      !checkHit(state.rng, 125, state.actor.defense)
    ) {
      saved = true;
    }

    /* Test for save due to saving throw. */
    if (
      trap.kind.flags.has(TRF.SAVE_THROW) &&
      state.rng.randint0(100) < (state.actor.combat.skills[SKILL.SAVE] ?? 0)
    ) {
      saved = true;
    }

    if (saved) {
      if (trap.kind.msgGood) env.msg?.(trap.kind.msgGood);
    } else {
      if (trap.kind.msgBad) env.msg?.(trap.kind.msgBad);
      runTrapEffect(state, trap, trap.kind.effect, deps);
      if (state.isDead) break;
      if (!squareTrap(state, grid).includes(trap)) {
        /* The effect removed the trap (e.g. it destroyed the grid). */
      } else if (trap.kind.effectXtra.length && state.rng.oneIn(2)) {
        if (trap.kind.msgXtra) env.msg?.(trap.kind.msgXtra);
        runTrapEffect(state, trap, trap.kind.effectXtra, deps);
        if (state.isDead) break;
      }
    }

    /* Some traps drop you a dungeon level. */
    if (trap.kind.flags.has(TRF.DOWN)) {
      if (env.changeLevel) env.changeLevel(state);
      else state.generateLevel = true;
    }

    /* Some traps drop you onto them. */
    if (trap.kind.flags.has(TRF.PIT) && !locEq(state.actor.grid, trap.grid)) {
      movePlayer(state, trap.grid);
      state.updateFov?.(state);
    }

    /* Some traps disappear after activating, all have a chance to. */
    if (trap.kind.flags.has(TRF.ONETIME) || state.rng.oneIn(3)) {
      squareRemoveTrap(state, grid, trap);
    } else {
      trap.flags.on(TRF.VISIBLE);
    }
  }
}

/** Run one of a trap's effect chains through the interpreter. */
function runTrapEffect(
  state: GameState,
  trap: Trap,
  records: readonly import("../obj/types").EffectRecordJson[],
  deps: TrapDeps,
): void {
  if (!deps.effects || records.length === 0) return;
  const chain = buildObjectEffectChain(records, state, deps.effects.inject);
  const ctx = attachGameEnv(
    buildEffectContext(state, deps.effects.envDeps),
    {
      state,
      cast: deps.effects.cast,
      ...(deps.effects.teleport ? { teleport: deps.effects.teleport } : {}),
      ...(deps.effects.general ? { general: deps.effects.general } : {}),
      ...(deps.effects.item ? { item: deps.effects.item } : {}),
    },
  );
  deps.effects.registry.effectDo(chain, ctx, {
    origin: sourceTrap(trap),
    aware: false,
  });
}

/** square_set_trap_timeout: disable traps here for `time` turns. */
export function squareSetTrapTimeout(
  state: GameState,
  grid: Loc,
  tIdx: number,
  time: number,
): boolean {
  let disabled = false;
  for (const trap of squareTrap(state, grid)) {
    if (tIdx >= 0 && tIdx !== trap.tidx) continue;
    trap.timeout = time;
    disabled = true;
  }
  return disabled;
}

/** square_trap_timeout: the first matching trap's remaining disable time. */
export function squareTrapTimeout(
  state: GameState,
  grid: Loc,
  tIdx: number,
): number {
  for (const trap of squareTrap(state, grid)) {
    if (tIdx >= 0 && tIdx !== trap.tidx) continue;
    if (trap.timeout) return trap.timeout;
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * Door locks (trap.c L706): the lock is a "door lock" trap.
 * ------------------------------------------------------------------ */

/** square_set_door_lock: lock a closed door to a power. */
export function squareSetDoorLock(
  state: GameState,
  grid: Loc,
  power: number,
  deps: TrapDeps,
): void {
  const lock = lookupTrap(deps.kinds, "door lock");
  if (!lock || !state.chunk.isClosedDoor(grid)) return;
  if (!squareTrapSpecific(state, grid, lock.tidx)) {
    placeTrap(state, grid, lock.tidx, 0, deps);
  }
  for (const trap of squareTrap(state, grid)) {
    if (trap.tidx === lock.tidx) trap.power = power;
  }
}

/** square_door_power: the lock power on a closed door (0 = unlocked). */
export function squareDoorPower(
  state: GameState,
  grid: Loc,
  deps: TrapDeps,
): number {
  const lock = lookupTrap(deps.kinds, "door lock");
  if (!lock || !state.chunk.isClosedDoor(grid)) return 0;
  for (const trap of squareTrap(state, grid)) {
    if (trap.tidx === lock.tidx) return trap.power;
  }
  return 0;
}

/**
 * calc_unlocking_chance (player-calcs.c L1676): DISARM_PHYS vs 4x lock
 * power, tenth-ed while blind / confused / hallucinating, floor of 2.
 */
export function calcUnlockingChance(
  state: GameState,
  lockPower: number,
): number {
  let skill = state.actor.combat.skills[SKILL.DISARM_PHYS] ?? 0;
  const p = state.actor.player;
  if ((p.timed[TMD.BLIND] ?? 0) > 0) skill = Math.trunc(skill / 10);
  if (
    (p.timed[TMD.CONFUSED] ?? 0) > 0 ||
    (p.timed[TMD.IMAGE] ?? 0) > 0
  ) {
    skill = Math.trunc(skill / 10);
  }
  return Math.max(2, skill - 4 * lockPower);
}

/* ------------------------------------------------------------------ *
 * Disarm (cmd-cave.c do_cmd_disarm).
 * ------------------------------------------------------------------ */

/**
 * do_cmd_disarm_aux: one disarm attempt on the first player trap at a
 * grid. Returns whether the command may repeat.
 */
export function disarmAux(
  state: GameState,
  grid: Loc,
  deps: TrapDeps,
): boolean {
  const env = deps.env ?? {};
  const trap = squareTrap(state, grid).find((t) => t.flags.has(TRF.TRAP));
  if (!trap) return false;

  /* Get the base disarming skill, penalizing some conditions. */
  let skill = trap.flags.has(TRF.MAGICAL)
    ? (state.actor.combat.skills[SKILL.DISARM_MAGIC] ?? 0)
    : (state.actor.combat.skills[SKILL.DISARM_PHYS] ?? 0);
  const p = state.actor.player;
  if (
    (p.timed[TMD.BLIND] ?? 0) > 0 ||
    (p.timed[TMD.CONFUSED] ?? 0) > 0 ||
    (p.timed[TMD.IMAGE] ?? 0) > 0
  ) {
    skill = Math.trunc(skill / 10);
  }

  /* Extract trap power and the percentage success. */
  const power = Math.trunc(state.chunk.depth / 5);
  const chance = Math.max(skill - power, 2);

  /* Two chances - one to disarm, one not to set the trap off. */
  if (state.rng.randint0(100) < chance) {
    env.msg?.(`You have disarmed the ${trap.kind.name}.`);
    env.expGain?.(1 + power);
    squareRemoveTrap(state, grid, trap);
    return false;
  }
  if (state.rng.randint0(100) < chance) {
    env.msg?.(`You failed to disarm the ${trap.kind.name}.`);
    return true; /* Player can try again. */
  }
  env.msg?.(`You set off the ${trap.kind.name}!`);
  hitTrap(state, grid, -1, deps);
  return false;
}

/**
 * Register the disarm command and wire the trap hooks: walk onto a player
 * trap triggers it, and the door-lock seams back cave-cmd's open command.
 */
export function installTraps(
  state: GameState,
  registry: ActionRegistry,
  deps: TrapDeps,
): void {
  registry.register("disarm", (s, cmd: PlayerCommand) => {
    const dir = cmd.dir;
    if (dir === undefined || dir < 1 || dir > 9 || dir === 5) return 0;
    const grid = locSum(s.actor.grid, DDGRID[dir] as Loc);
    /* Traps must be visible to disarm. */
    if (!squareIsVisibleTrap(s, grid)) {
      deps.env?.msg?.("You see nothing there to disarm.");
      return 0;
    }
    disarmAux(s, grid, deps);
    return s.z.moveEnergy;
  });

  /* Stepping onto a player trap sets it off (move_player -> hit_trap). */
  state.onPlayerMoved = (s, grid): void => {
    if (squareIsPlayerTrap(s, grid)) hitTrap(s, grid, 0, deps);
  };
}
