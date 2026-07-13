/**
 * Cave commands, ported from reference/src/cmd-cave.c (Angband 4.2.6):
 * opening and closing doors, tunneling (with the calc_digging_chances
 * player math and rubble / gold-vein payouts onto the live floor piles),
 * chest open/disarm branches (do_cmd_open / do_cmd_disarm, gap #49), the
 * alter dispatcher, and the stair commands with their terrain checks.
 *
 * Door LOCKS are traps upstream (the "door lock" trap kind holds the
 * power), so locked-door handling rides on the isLockedDoor / pickLock
 * seams until trap.c lands (#21) - shipped levels place plain closed
 * doors, which open exactly as upstream. square_isknown gating is
 * knowledge (#24): everything is known here, matching the current FOV
 * front end.
 *
 * Chests (game/chest.ts) plug in via the optional `chestDeps`; open gains
 * a chest branch (chest_check(CHEST_OPENABLE) before the door test), and a
 * new "disarm" action is registered that tries chest_check(CHEST_TRAPPED)
 * first and falls through to whatever "disarm" action was already
 * registered (the sibling floor-trap disarm, trap.ts #21) otherwise -
 * merging rather than double-registering, since a stub or the real
 * trap-disarm action is always present by the time this installs.
 *
 * DEFERRED (ledgered in game-cave-cmd.yaml): the swap-digger machinery
 * (player_best_digger recalculating bonuses with the best pack digger -
 * digging uses the wielded state's DIGGING skill), the door-lock branch of
 * disarm (do_cmd_lock_door, rides the trap.c door-lock seams), do_cmd_steal
 * (shapechange #22), command repetition and count_feats direction inference
 * (UI). Running and travel / explore (player-path #24) are ported in
 * game/player-path.ts.
 */

import type { Loc } from "../loc";
import { DDGRID, locSum } from "../loc";
import { FEAT, TF } from "../generated";
import { SKILL } from "../player/types";
import { pyAttack } from "../combat/melee";
import { learnBrandSlayFromMelee } from "../combat/brand-slay";
import { getLore } from "../mon/lore";
import { monsterIsCamouflaged } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { equipLearnOnMeleeAttack } from "../obj/knowledge";
import { featIsTreasure } from "../world/chunk";
import type { MakeDeps } from "../obj/make";
import { makeGold, makeObject } from "../obj/make";
import { CHEST_QUERY } from "../obj/chest";
import { chestCheck, doCmdDisarmChest, doCmdOpenChest } from "./chest";
import type { ChestCmdDeps } from "./chest";
import type { GameState, PlayerCommand } from "./context";
import { arenaInterceptDeath, deleteMonster, squareMonster } from "./context";
import { floorCarry } from "./floor";
import { playerConfuseDir } from "./obj-cmd";
import type { ActionRegistry } from "./player-turn";

/** Hooks for messages and unported subsystems; all optional. */
export interface CaveCmdEnv {
  msg?: (text: string) => void;
  /** square_islockeddoor: door locks are traps (#21). Default false. */
  isLockedDoor?: (grid: Loc) => boolean;
  /**
   * The unlock attempt for a locked door (calc_unlocking_chance +
   * square_open_door's lock removal, #21). Returns whether it opened.
   */
  pickLock?: (grid: Loc) => boolean;
}

/** What the cave commands need beyond the state. */
export interface CaveCmdDeps {
  /** Object generation deps for rubble finds / gold veins; optional. */
  makeDeps?: MakeDeps;
  env?: CaveCmdEnv;
  /**
   * Chest deps (gap #49); absent, the open/disarm chest branches are
   * skipped entirely (doors and floor traps behave exactly as before).
   */
  chestDeps?: ChestCmdDeps;
}

/* ------------------------------------------------------------------ *
 * Door predicates (cave-square.c) over the feature flags.
 * ------------------------------------------------------------------ */

/** square_isopendoor: a door that can be closed (TF CLOSABLE). */
export function squareIsOpenDoor(state: GameState, grid: Loc): boolean {
  return state.chunk.feature(grid).flags.has(TF.CLOSABLE);
}

/** square_isbrokendoor: passable door that cannot be closed. */
export function squareIsBrokenDoor(state: GameState, grid: Loc): boolean {
  const f = state.chunk.feature(grid).flags;
  return f.has(TF.DOOR_ANY) && f.has(TF.PASSABLE) && !f.has(TF.CLOSABLE);
}

/** square_issecretdoor: a door still disguised as rock. */
export function squareIsSecretDoor(state: GameState, grid: Loc): boolean {
  const f = state.chunk.feature(grid).flags;
  return f.has(TF.DOOR_ANY) && f.has(TF.ROCK);
}

/** square_isdiggable: mineral, secret door or rubble. */
export function squareIsDiggable(state: GameState, grid: Loc): boolean {
  return (
    state.chunk.isMineralWall(grid) ||
    squareIsSecretDoor(state, grid) ||
    state.chunk.isRubble(grid)
  );
}

/* ------------------------------------------------------------------ *
 * Digging math (player-calcs.c calc_digging_chances).
 * ------------------------------------------------------------------ */

/** enum digging (player.h): the digging-difficulty classes. */
export const DIGGING = {
  RUBBLE: 0,
  MAGMA: 1,
  QUARTZ: 2,
  GRANITE: 3,
  DOORS: 4,
  MAX: 5,
} as const;

/** calc_digging_chances: success chances (out of 1600) by difficulty. */
export function calcDiggingChances(diggingSkill: number): number[] {
  const chances = new Array<number>(DIGGING.MAX);
  chances[DIGGING.RUBBLE] = diggingSkill * 8;
  chances[DIGGING.MAGMA] = (diggingSkill - 10) * 4;
  chances[DIGGING.QUARTZ] = (diggingSkill - 20) * 2;
  chances[DIGGING.GRANITE] = (diggingSkill - 40) * 1;
  /* Approximate a 1/1200 chance per skill point over 30. */
  chances[DIGGING.DOORS] = Math.trunc((diggingSkill * 4 - 119) / 3);
  for (let i = 0; i < DIGGING.MAX; i++) {
    chances[i] = Math.max(0, chances[i] as number);
  }
  return chances;
}

/** square_digging: the feature's 1..5 digging class (0 = not diggable). */
export function squareDigging(state: GameState, grid: Loc): number {
  if (squareIsDiggable(state, grid) || state.chunk.isClosedDoor(grid)) {
    return state.chunk.feature(grid).dig;
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * Open / close.
 * ------------------------------------------------------------------ */

/** do_cmd_open_test: a closed door there? (Knowledge gate is #24.) */
function openTest(state: GameState, grid: Loc, env: CaveCmdEnv): boolean {
  if (!state.chunk.inBounds(grid) || !state.chunk.isClosedDoor(grid)) {
    env.msg?.("You see nothing there to open.");
    return false;
  }
  return true;
}

/** do_cmd_open_aux: open (or pick) the door. Returns "may repeat". */
function openAux(state: GameState, grid: Loc, env: CaveCmdEnv): boolean {
  if (!openTest(state, grid, env)) return false;

  if (env.isLockedDoor?.(grid)) {
    /* Locked door: the lock is a trap (#21); the pickLock seam decides. */
    if (env.pickLock?.(grid)) {
      env.msg?.("You have picked the lock.");
      state.chunk.setFeat(grid, FEAT.OPEN);
    } else {
      env.msg?.("You failed to pick the lock.");
      return true; /* We may keep trying. */
    }
  } else {
    /* Closed door. */
    state.chunk.setFeat(grid, FEAT.OPEN);
  }
  return false;
}

/** do_cmd_close_test / _aux. */
function closeAux(state: GameState, grid: Loc, env: CaveCmdEnv): boolean {
  if (
    !state.chunk.inBounds(grid) ||
    (!squareIsOpenDoor(state, grid) && !squareIsBrokenDoor(state, grid))
  ) {
    env.msg?.("You see nothing there to close.");
    return false;
  }
  /* Don't allow if the player is in the way. */
  if (state.chunk.mon(grid) < 0) {
    env.msg?.("You're standing in that doorway.");
    return false;
  }
  if (squareIsBrokenDoor(state, grid)) {
    env.msg?.("The door appears to be broken.");
  } else {
    state.chunk.setFeat(grid, FEAT.CLOSED);
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Tunnel.
 * ------------------------------------------------------------------ */

/** do_cmd_tunnel_test. */
function tunnelTest(state: GameState, grid: Loc, env: CaveCmdEnv): boolean {
  if (!state.chunk.inBounds(grid)) return false;
  if (state.chunk.isPerm(grid)) {
    env.msg?.("This seems to be permanent rock.");
    return false;
  }
  if (!squareIsDiggable(state, grid) && !state.chunk.isClosedDoor(grid)) {
    env.msg?.("You see nothing there to tunnel.");
    return false;
  }
  return true;
}

/** twall: knock the feature down to floor. */
function twall(state: GameState, grid: Loc): boolean {
  if (!squareIsDiggable(state, grid) && !state.chunk.isClosedDoor(grid)) {
    return false;
  }
  state.chunk.setFeat(grid, FEAT.FLOOR);
  return true;
}

/**
 * do_cmd_tunnel_aux: one digging attempt. The swap-digger recalculation is
 * DEFERRED - the wielded state's DIGGING skill decides. Returns "may
 * repeat" (a failed dig with hope).
 */
function tunnelAux(
  state: GameState,
  grid: Loc,
  deps: CaveCmdDeps,
): boolean {
  const env = deps.env ?? {};
  if (!tunnelTest(state, grid, env)) return false;

  const gold = featIsTreasure(state.chunk.features, state.chunk.feat(grid));
  const rubble = state.chunk.isRubble(grid);

  const chances = calcDiggingChances(
    state.actor.combat.skills[SKILL.DIGGING] ?? 0,
  );
  let digIdx = squareDigging(state, grid);
  if (digIdx < 1 || digIdx > DIGGING.MAX) digIdx = DIGGING.GRANITE + 1;
  const chance = chances[digIdx - 1] as number;
  const okay = chance > state.rng.randint0(1600);

  if (okay && twall(state, grid)) {
    if (rubble) {
      env.msg?.("You have removed the rubble.");
      /* Place an object (except in town). */
      if (state.rng.randint0(100) < 10 && state.chunk.depth > 0 && deps.makeDeps) {
        const obj = makeObject(
          state.rng,
          deps.makeDeps,
          state.chunk.depth,
          false,
          false,
          false,
          0,
          state.chunk.depth,
        );
        if (obj) {
          floorCarry(state, grid, obj);
          env.msg?.("You have found something!");
        }
      }
    } else if (gold && deps.makeDeps) {
      /* Found treasure. */
      const money = makeGold(state.rng, deps.makeDeps, state.chunk.depth, "any");
      floorCarry(state, grid, money);
      env.msg?.("You have found something digging!");
    } else {
      env.msg?.("You have finished the tunnel.");
    }
    return false;
  }
  if (chance > 0) {
    env.msg?.(rubble ? "You dig in the rubble." : "You tunnel into the wall.");
    return true;
  }
  env.msg?.("You chip away futilely.");
  return false;
}

/* ------------------------------------------------------------------ *
 * The command actions.
 * ------------------------------------------------------------------ */

function commandGrid(state: GameState, cmd: PlayerCommand): { grid: Loc; dir: number } | null {
  const dir = cmd.dir;
  if (dir === undefined || dir < 1 || dir > 9 || dir === 5) return null;
  return { grid: locSum(state.actor.grid, DDGRID[dir] as Loc), dir };
}

/** dir -> grid, but allowing 5 (the player's own grid) for a chest underfoot. */
function chestDirGrid(state: GameState, dir: number): Loc {
  return dir === 5 ? state.actor.grid : (locSum(state.actor.grid, DDGRID[dir] as Loc));
}

/** Resolve a command's target grid, allowing dir 5 for chest-capable actions. */
function chestCommandGrid(state: GameState, cmd: PlayerCommand): { grid: Loc; dir: number } | null {
  const dir = cmd.dir;
  if (dir === undefined || dir < 1 || dir > 9) return null;
  return { grid: chestDirGrid(state, dir), dir };
}

/** Attack the monster standing in the way (shared by open/close/tunnel). */
function attackBlocker(state: GameState, grid: Loc, env: CaveCmdEnv): void {
  const target = squareMonster(state, grid);
  if (!target) return;
  env.msg?.("There is a monster in the way!");
  learnBrandSlayFromMelee(
    state.actor.player,
    state.runeEnv,
    state.actor.weapon,
    { race: target.race, visible: true, lore: getLore(state.lore, target.race) },
  );
  const result = pyAttack(
    state.rng,
    state.actor.player,
    state.actor.combat,
    state.actor.weapon,
    target,
    state.brands,
    state.slays,
    { monVisible: true },
  );
  equipLearnOnMeleeAttack(state.actor.player, state.runeEnv);
  if (result.monsterDied && !arenaInterceptDeath(state, target)) {
    state.onPlayerKill?.(target);
    deleteMonster(state, target.midx);
  }
}

/**
 * do_cmd_open / do_cmd_disarm's monster branch (cmd-cave.c L290-305 /
 * L913-923): a camouflaged monster surprises the player instead of being
 * attacked - become_aware reveals it, then monster_wake(mon, false, 100)
 * wakes it, same as move_player. Close/tunnel/alter do not special-case
 * camouflage upstream (they always py_attack), so they keep calling
 * attackBlocker directly.
 */
function revealOrAttackBlocker(state: GameState, grid: Loc, env: CaveCmdEnv): void {
  const target = squareMonster(state, grid);
  if (!target) return;
  if (monsterIsCamouflaged(target)) {
    state.becomeAware?.(target);
    monsterWake(state.rng, target, false, 100);
    return;
  }
  attackBlocker(state, grid, env);
}

/**
 * Register open / close / tunnel / alter and the stair-checked descend /
 * ascend on the action registry.
 */
export function installCaveCommands(
  registry: ActionRegistry,
  deps: CaveCmdDeps = {},
): void {
  const env = deps.env ?? {};
  const chestDeps = deps.chestDeps;

  registry.register("open", (state, cmd) => {
    const at = chestCommandGrid(state, cmd);
    if (!at) return 0;
    /* do_cmd_open (L268-276): a chest there skips the door legality test. */
    const preChest = chestDeps ? chestCheck(state, at.grid, CHEST_QUERY.OPENABLE) : null;
    if (!preChest && !openTest(state, at.grid, env)) return 0;

    /* Apply confusion after the turn is committed, then re-resolve the
     * chest at the (possibly redirected) grid, as upstream does. */
    const dir = playerConfuseDir(state, at.dir);
    const grid = chestDirGrid(state, dir);
    const chestObj = chestDeps ? chestCheck(state, grid, CHEST_QUERY.OPENABLE) : null;

    if (squareMonster(state, grid)) {
      revealOrAttackBlocker(state, grid, env);
    } else if (chestObj) {
      doCmdOpenChest(state, grid, chestObj, chestDeps!);
    } else {
      openAux(state, grid, env);
    }
    return state.z.moveEnergy;
  });

  registry.register("close", (state, cmd) => {
    const at = commandGrid(state, cmd);
    if (!at) return 0;
    if (
      !state.chunk.inBounds(at.grid) ||
      (!squareIsOpenDoor(state, at.grid) && !squareIsBrokenDoor(state, at.grid))
    ) {
      env.msg?.("You see nothing there to close.");
      return 0;
    }
    const dir = playerConfuseDir(state, at.dir);
    const grid = locSum(state.actor.grid, DDGRID[dir] as Loc);
    if (state.chunk.mon(grid) > 0) attackBlocker(state, grid, env);
    else closeAux(state, grid, env);
    return state.z.moveEnergy;
  });

  /*
   * do_cmd_disarm (L858): disarm a trapped chest, or fall through to
   * whatever "disarm" action is already registered (trap.ts's floor-trap
   * disarm, #21 - or the deferred stub if traps are not installed). A
   * trapped chest at the target grid takes priority, mirroring upstream's
   * chest-before-trap dispatch; capture the prior action BEFORE overwriting
   * so this merges instead of shadowing it.
   */
  const priorDisarm = registry.get("disarm");
  registry.register("disarm", (state, cmd) => {
    if (chestDeps) {
      const at = chestCommandGrid(state, cmd);
      const preChest = at ? chestCheck(state, at.grid, CHEST_QUERY.TRAPPED) : null;
      if (at && preChest) {
        /* Apply confusion after the turn is committed, then re-resolve the
         * chest at the (possibly redirected) grid, as upstream does. */
        const dir = playerConfuseDir(state, at.dir);
        const grid = chestDirGrid(state, dir);
        const chestObj = chestCheck(state, grid, CHEST_QUERY.TRAPPED);

        if (squareMonster(state, grid)) {
          revealOrAttackBlocker(state, grid, env);
        } else if (chestObj) {
          doCmdDisarmChest(state, chestObj, chestDeps);
        } else if (priorDisarm) {
          priorDisarm(state, { ...cmd, dir });
        } else {
          env.msg?.("You see nothing there to disarm.");
        }
        return state.z.moveEnergy;
      }
    }
    return priorDisarm ? priorDisarm(state, cmd) : 0;
  });

  registry.register("tunnel", (state, cmd) => {
    const at = commandGrid(state, cmd);
    if (!at) return 0;
    if (!tunnelTest(state, at.grid, env)) return 0;
    const dir = playerConfuseDir(state, at.dir);
    const grid = locSum(state.actor.grid, DDGRID[dir] as Loc);
    if (state.chunk.mon(grid) > 0) attackBlocker(state, grid, env);
    else tunnelAux(state, grid, deps);
    return state.z.moveEnergy;
  });

  /*
   * do_cmd_alter: attack, tunnel, or open, by what is there. DEFERRED: the
   * chest and floor-trap-disarm branches upstream falls through to
   * (do_cmd_alter_aux L969-992) - "alter" is not wired to a shell key yet,
   * so this stays door/dig/attack-only until it is.
   */
  registry.register("alter", (state, cmd) => {
    const at = commandGrid(state, cmd);
    if (!at) return 0;
    const dir = playerConfuseDir(state, at.dir);
    const grid = locSum(state.actor.grid, DDGRID[dir] as Loc);
    if (state.chunk.mon(grid) > 0) {
      attackBlocker(state, grid, env);
    } else if (squareIsDiggable(state, grid)) {
      tunnelAux(state, grid, deps);
    } else if (state.chunk.isClosedDoor(grid)) {
      openAux(state, grid, env);
    } else {
      env.msg?.("You spin around.");
      return 0;
    }
    return state.z.moveEnergy;
  });

  /* do_cmd_go_down / go_up: require the matching staircase underfoot. */
  registry.register("descend", (state) => {
    if (!state.chunk.isDownstairs(state.actor.grid)) {
      env.msg?.("There is no down staircase here.");
      return 0;
    }
    state.targetDepth = state.chunk.depth + 1;
    state.generateLevel = true;
    return state.z.moveEnergy;
  });

  registry.register("ascend", (state) => {
    if (!state.chunk.isUpstairs(state.actor.grid)) {
      env.msg?.("There is no up staircase here.");
      return 0;
    }
    if (state.chunk.depth === 0) {
      env.msg?.("You are already on the surface.");
      return 0;
    }
    state.targetDepth = state.chunk.depth - 1;
    state.generateLevel = true;
    return state.z.moveEnergy;
  });
}
