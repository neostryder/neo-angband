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
 * NOW PORTED (was deferred): the swap-digger machinery (player_best_digger,
 * player/best-digger.ts, temporarily wields the pack's best digger and
 * recomputes DIGGING via state.bestDiggerDigging - RNG-free, input-only to the
 * dig roll) feeds tunnelAux; and do_cmd_lock_door (the door-lock branch of
 * do_cmd_disarm plus a dedicated "lock" action) with the exact m_bonus /
 * randint0(100) / randint1(i) RNG order, riding the trap.c door-lock seams
 * (state.setDoorLock / env.isLockedDoor).
 *
 * DEFERRED (ledgered in game-cave-cmd.yaml): do_cmd_steal (shapechange #22),
 * command repetition and count_feats direction inference (UI). Running and
 * travel / explore (player-path #24) are ported in game/player-path.ts.
 */

import type { Loc } from "../loc";
import { DDGRID, locSum } from "../loc";
import { FEAT, ORIGIN, TF, TMD } from "../generated";
import { SKILL } from "../player/types";
import { squareIsSeen } from "../world/view";
import { monsterIsCamouflaged } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { featIsTreasure } from "../world/chunk";
import type { MakeDeps } from "../obj/make";
import { makeGold, makeObject } from "../obj/make";
import { CHEST_QUERY } from "../obj/chest";
import { chestCheck, doCmdDisarmChest, doCmdOpenChest } from "./chest";
import type { ChestCmdDeps } from "./chest";
import type { GameState, PlayerCommand } from "./context";
import { modRuleEnabled, squareMonster } from "./context";
import { squareIsKnown } from "./known";
import { floorCarry } from "./floor";
import { playerConfuseDir } from "./obj-cmd";
import { attackMonster } from "./player-turn";
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
 * Level feeling (do_cmd_feeling / display_feeling, cmd-cave.c L1687).
 * ------------------------------------------------------------------ */

/** obj_feeling_text[] (cmd-cave.c L1687): the 11 object-feeling strings. */
const OBJ_FEELING_TEXT = [
  "Looks like any other level.",
  "you sense an item of wondrous power!",
  "there are superb treasures here.",
  "there are excellent treasures here.",
  "there are very good treasures here.",
  "there are good treasures here.",
  "there may be something worthwhile here.",
  "there may not be much interesting here.",
  "there aren't many treasures here.",
  "there are only scraps of junk here.",
  "there is naught but cobwebs here.",
] as const;

/** mon_feeling_text[] (cmd-cave.c L1707): the 10 monster-feeling strings. */
const MON_FEELING_TEXT = [
  "You are still uncertain about this place",
  "Omens of death haunt this place",
  "This place seems murderous",
  "This place seems terribly dangerous",
  "You feel anxious about this place",
  "You feel nervous about this place",
  "This place does not seem too risky",
  "This place seems reasonably safe",
  "This seems a tame, sheltered place",
  "This seems a quiet, peaceful place",
] as const;

/**
 * display_feeling (cmd-cave.c L1729) via do_cmd_feeling (L1777): re-emit the
 * current level feeling. `objOnly` reproduces display_feeling(true), the
 * object-only line shown the moment the object feeling is first discovered;
 * do_cmd_feeling (^F) calls it with objOnly = false. Cold-hearted characters
 * (birth_feelings off) get nothing; the town gets the fixed line; a level not
 * yet explored to feeling_need grids gets only the monster feeling, otherwise
 * the joined "<mon>, and/yet <obj>" line with the exact conjunction rule.
 * feelingNeed defaults to the shipped constants.txt world:feeling-need (10),
 * matching the display-model default (display.ts).
 */
export function displayFeeling(
  state: GameState,
  opts: { objOnly?: boolean; feelingNeed?: number } = {},
): void {
  const chunk = state.chunk;
  const objOnly = opts.objOnly ?? false;
  const feelingNeed = opts.feelingNeed ?? 10;

  /* Don't show feelings for cold-hearted characters (L1736). */
  if (!(state.options?.get("birth_feelings") ?? true)) return;

  /* No useful feeling in town (L1739). */
  if (!chunk.depth) {
    state.msg?.("Looks like a typical town.");
    return;
  }

  let objFeeling = Math.trunc(chunk.feeling / 10);
  let monFeeling = chunk.feeling - 10 * objFeeling;

  /* Display only the object feeling when it's first discovered (L1745). The
   * disturb(player) upstream pairs with the reveal path (view.ts), not ^F. */
  if (objOnly) {
    state.msg?.(`You feel that ${OBJ_FEELING_TEXT[objFeeling] ?? ""}`);
    return;
  }

  /* Players automatically get a monster feeling (L1752). */
  if (chunk.feelingSquares < feelingNeed) {
    state.msg?.(`${MON_FEELING_TEXT[monFeeling] ?? ""}.`);
    return;
  }

  /* Verify the feelings (L1758-1762). */
  if (objFeeling >= OBJ_FEELING_TEXT.length) objFeeling = OBJ_FEELING_TEXT.length - 1;
  if (monFeeling >= MON_FEELING_TEXT.length) monFeeling = MON_FEELING_TEXT.length - 1;

  /* Decide the conjunction (L1765-1769). */
  const join =
    (monFeeling <= 5 && objFeeling > 6) || (monFeeling > 5 && objFeeling <= 6)
      ? ", yet"
      : ", and";

  state.msg?.(`${MON_FEELING_TEXT[monFeeling]}${join} ${OBJ_FEELING_TEXT[objFeeling]}`);
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
 * Door lock (do_cmd_lock_door, cmd-cave.c L732).
 * ------------------------------------------------------------------ */

/** no_light (cave-view.c L913): the player's own grid is not currently seen. */
function noLight(state: GameState): boolean {
  return !squareIsSeen(state.chunk, state.actor.grid);
}

/**
 * do_cmd_lock_door (cmd-cave.c L732): try to lock a closed, unlocked door the
 * player is adjacent to. Returns "may repeat" (a failed attempt with hope).
 *
 * RNG ORDER (exact, cmd-cave.c L741-777): the disarm-phys skill is penalized a
 * factor of ten while blind / lightless and again while confused / hallucinating
 * (drawing nothing), then in strict order:
 *   1. power = m_bonus(7, depth)        -- the lock's strength (draws RNG)
 *   2. randint0(100) < j                -- the success check
 *   3. randint1(i) > 5                  -- only on failure, and only when i > 5
 * On success the lock is set to `power` via square_set_door_lock (state.setDoorLock,
 * the "door lock" trap #21 seam); with no trap system live the set is a no-op and
 * the door stays (harmlessly) unlocked, matching the RNG-free monster path.
 */
function doCmdLockDoor(
  state: GameState,
  grid: Loc,
  deps: CaveCmdDeps,
): boolean {
  const env = deps.env ?? {};

  /* do_cmd_disarm_test (knowledge gate is #24, all known): a closed, unlocked
     door must be there. A confusion redirect onto a non-door grid bails with
     no draws, as do_cmd_disarm_test returning false does upstream. */
  if (
    !state.chunk.isClosedDoor(grid) ||
    (env.isLockedDoor?.(grid) ?? false)
  ) {
    return false;
  }

  /* Get the "disarm" factor, penalizing some conditions (L741-747). */
  let i = state.actor.combat.skills[SKILL.DISARM_PHYS] ?? 0;
  const p = state.actor.player;
  if ((p.timed[TMD.BLIND] ?? 0) > 0 || noLight(state)) i = Math.trunc(i / 10);
  if ((p.timed[TMD.CONFUSED] ?? 0) > 0 || (p.timed[TMD.IMAGE] ?? 0) > 0) {
    i = Math.trunc(i / 10);
  }

  /* Calculate lock "power" (L750), then the difficulty (L753-756). */
  const power = state.rng.mBonus(7, state.chunk.depth);
  let j = i - power;
  if (j < 2) j = 2;

  /* Success (L758-762). */
  if (state.rng.randint0(100) < j) {
    env.msg?.("You lock the door.");
    state.setDoorLock?.(grid, power);
    return false;
  }

  /* Failure -- keep trying (L764-771), else plain failure (L772-774). */
  if (i > 5 && state.rng.randint1(i) > 5) {
    env.msg?.("You failed to lock the door.");
    return true;
  }
  env.msg?.("You failed to lock the door.");
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
 * do_cmd_tunnel_aux: one digging attempt. player_best_digger temporarily wields
 * the pack's best digger and recomputes DIGGING (via state.bestDiggerDigging,
 * RNG-free) to feed the roll; absent that hook the wielded DIGGING decides.
 * Returns "may repeat" (a failed dig with hope).
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

  /* player_best_digger (player-util.c L744): temporarily wield the pack's best
   * digger and recompute DIGGING (RNG-free); the resulting skill feeds the
   * existing randint0(1600) draw below. Absent the hook (worldless harness),
   * the wielded state's DIGGING skill decides, as before. */
  const diggingSkill =
    state.bestDiggerDigging?.() ?? (state.actor.combat.skills[SKILL.DIGGING] ?? 0);
  const chances = calcDiggingChances(diggingSkill);
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
          /* cmd-cave.c L600: rubble finds carry ORIGIN_RUBBLE. */
          obj.origin = ORIGIN.RUBBLE;
          obj.originDepth = state.chunk.depth;
          floorCarry(state, grid, obj);
          env.msg?.("You have found something!");
        }
      }
    } else if (gold && deps.makeDeps) {
      /* Found treasure. */
      const money = makeGold(state.rng, deps.makeDeps, state.chunk.depth, "any");
      /* cmd-cave.c L613: dug-out gold carries ORIGIN_FLOOR. */
      money.origin = ORIGIN.FLOOR;
      money.originDepth = state.chunk.depth;
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
 * QoL: auto-dig on walk (mod seam, flag "qol.autoDig").
 *
 * Ported from neostryder's Angband fork (do_cmd_movement_tunnel_test /
 * move_player change; cmd-cave.c: "walking or running into known diggable
 * terrain begins
 * tunneling when the player can dig the target terrain"). This is NOT in
 * faithful 4.2.6 - it ships as an opt-in feature of the bundled `qol` content
 * mod, gated by the named flag so core is byte-identical when the flag is off
 * (the flag is absent unless the qol mod set it, and even when the qol mod is
 * enabled the player can turn it off in the Fixes & tweaks menu).
 * ------------------------------------------------------------------ */

/** do_cmd_tunnel_chance: the player's success chance (out of 1600) at `grid`. */
function tunnelChance(state: GameState, grid: Loc): number {
  const diggingSkill =
    state.bestDiggerDigging?.() ?? (state.actor.combat.skills[SKILL.DIGGING] ?? 0);
  const chances = calcDiggingChances(diggingSkill);
  let digIdx = squareDigging(state, grid);
  if (digIdx < 1 || digIdx > DIGGING.MAX) digIdx = DIGGING.GRANITE + 1;
  return chances[digIdx - 1] ?? 0;
}

/**
 * do_cmd_movement_tunnel_test (neostryder's Angband fork): a grid the player should tunnel into
 * when they try to WALK into it - known, not permanent rock, impassable,
 * diggable, and diggable with a positive success chance given the current
 * weapon / best pack digger. RNG-free (input only).
 */
export function movementTunnelTest(state: GameState, grid: Loc): boolean {
  if (!squareIsKnown(state, grid)) return false;
  if (state.chunk.isPerm(grid)) return false;
  if (state.chunk.isPassable(grid)) return false;
  if (!squareIsDiggable(state, grid)) return false;
  return tunnelChance(state, grid) > 0;
}

/**
 * The QoL auto-dig step, installed as state.autoDigStep by the session and
 * consulted by walkAction (game/player-turn.ts) when a walk is blocked by a
 * wall. When the "qol.autoDig" flag is off (faithful default) it returns 0
 * WITHOUT drawing any RNG, so the walk falls through to the normal no-energy
 * bump and core is byte-identical to 4.2.6. When on and the blocked grid passes
 * movementTunnelTest, it performs one do_cmd_tunnel_aux attempt (the same dig
 * roll and payouts as the tunnel command) and spends a full move (source fork:
 * energy_use = move_energy), returning that energy.
 */
export function movementAutoDig(
  state: GameState,
  grid: Loc,
  deps: CaveCmdDeps,
): number {
  if (!modRuleEnabled(state, "qol.autoDig")) return 0;
  if (!movementTunnelTest(state, grid)) return 0;
  tunnelAux(state, grid, deps);
  return state.z.moveEnergy;
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
  /* Route through the full py_attack path (player-turn.ts attackMonster) so
   * open/close/tunnel/alter into a monster gets the complete melee side-effect
   * suite - shield bash, vampiric/confusion/impact brands, temporary
   * brands/slays, fear generation and kill handling (gap 2.5b). A bare pyAttack
   * here previously skipped all of it. */
  attackMonster(state, target);
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
 * do_cmd_disarm's tail for the lock branch (cmd-cave.c L900-930): spend the
 * turn, apply confusion, then attack a monster in the way or lock the door.
 * Shared by the "lock" action and the disarm command's closed-door branch.
 */
function lockDoorCommand(
  state: GameState,
  dir: number,
  deps: CaveCmdDeps,
  env: CaveCmdEnv,
): number {
  const cdir = playerConfuseDir(state, dir);
  const grid = locSum(state.actor.grid, DDGRID[cdir] as Loc);
  if (state.chunk.mon(grid) > 0) {
    revealOrAttackBlocker(state, grid, env);
  } else {
    doCmdLockDoor(state, grid, deps);
  }
  return state.z.moveEnergy;
}

/**
 * Register open / close / lock / tunnel / alter and the stair-checked descend /
 * ascend on the action registry.
 */
export function installCaveCommands(
  registry: ActionRegistry,
  deps: CaveCmdDeps = {},
): void {
  const env = deps.env ?? {};
  const chestDeps = deps.chestDeps;

  /*
   * move_player's bump-to-open (cmd-cave.c L1079-1083): walking (or jumping)
   * into a known closed door opens it via do_cmd_alter_aux instead of a silent
   * no-op - the primary way players open doors. Only the closed-door case is
   * intercepted here; a monster in the doorway, an ordinary step, autopickup
   * and wall/rubble bumps stay with the base walk/jump action (delegated). A
   * disarmable trap under a walking player (disarm-on-walk) and the standing-
   * in-a-web clear are separate move_player branches still routed through the
   * base action - tracked, not silently dropped.
   */
  const bumpOpen =
    (prior: ReturnType<typeof registry.get>) =>
    (state: GameState, cmd: PlayerCommand): number => {
      /* move_player confusion (cmd-cave.c L1299-1302): apply it once, up front,
       * so the bump-open branch and the delegated step both use the redirected
       * direction and player_confuse_dir draws the RNG exactly once. The
       * delegated action is told confusion was already applied (confusedApplied)
       * so it does not re-roll. */
      let dir = cmd.dir;
      let confused = false;
      if (dir !== undefined && dir >= 1 && dir <= 9) {
        const rolled = playerConfuseDir(state, dir);
        confused = rolled !== dir;
        dir = rolled;
      }
      const cmd2: PlayerCommand = { ...cmd, confusedApplied: true };
      if (dir !== undefined) cmd2.dir = dir;
      const grid =
        dir !== undefined && dir >= 1 && dir <= 9 && dir !== 5
          ? locSum(state.actor.grid, DDGRID[dir] as Loc)
          : null;
      if (grid && state.chunk.isClosedDoor(grid) && !squareMonster(state, grid)) {
        openAux(state, grid, env);
        return state.z.moveEnergy;
      }
      const used = prior ? prior(state, cmd2) : 0;
      /* A confused redirect that dead-ends (bump / edge) still spends a full
       * turn; walkAction returns 0 in that case since confusedApplied is set. */
      return confused && used === 0 ? state.z.moveEnergy : used;
    };
  const priorWalk = registry.get("walk");
  if (priorWalk) registry.register("walk", bumpOpen(priorWalk));
  const priorJump = registry.get("jump");
  if (priorJump) registry.register("jump", bumpOpen(priorJump));

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
    /*
     * do_cmd_disarm (L927-930): a closed, unlocked door is LOCKED rather than
     * disarmed. Decided on the pre-confusion grid to pick the branch (as the
     * chest branch and do_cmd_open do); lockDoorCommand applies confusion.
     */
    const doorAt = commandGrid(state, cmd);
    if (
      doorAt &&
      state.chunk.isClosedDoor(doorAt.grid) &&
      !(env.isLockedDoor?.(doorAt.grid) ?? false)
    ) {
      return lockDoorCommand(state, doorAt.dir, deps, env);
    }
    return priorDisarm ? priorDisarm(state, cmd) : 0;
  });

  /*
   * do_cmd_lock_door reached directly (cmd-cave.c L732): the port also exposes
   * locking as its own "lock" action so a front end can bind a dedicated key,
   * in addition to the disarm-command dispatch above. Both share lockDoorCommand
   * and the exact do_cmd_lock_door RNG order.
   */
  registry.register("lock", (state, cmd) => {
    const at = commandGrid(state, cmd);
    if (!at) return 0;
    if (
      !state.chunk.isClosedDoor(at.grid) ||
      (env.isLockedDoor?.(at.grid) ?? false)
    ) {
      env.msg?.("You see nothing there to lock.");
      return 0;
    }
    return lockDoorCommand(state, at.dir, deps, env);
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
      env.msg?.("I see no down staircase here.");
      return 0;
    }
    /* Success (cmd-cave.c:134): the stair message, typed MSG_STAIRS_DOWN, goes
     * through the message log so it reaches the -more- pager and Ctrl-P. */
    env.msg?.("You enter a maze of down staircases.");
    /* create_up_stair = true (cmd-cave.c:137): arrive on an up staircase. */
    state.arrivalStair = "up";
    state.targetDepth = state.chunk.depth + 1;
    state.generateLevel = true;
    return state.z.moveEnergy;
  });

  registry.register("ascend", (state) => {
    if (!state.chunk.isUpstairs(state.actor.grid)) {
      env.msg?.("I see no up staircase here.");
      return 0;
    }
    if (state.chunk.depth === 0) {
      /* do_cmd_go_up (cmd-cave.c:78-79): can't ascend past the top level. */
      env.msg?.("You can't go up from here!");
      return 0;
    }
    /* Success (cmd-cave.c:87): typed MSG_STAIRS_UP. */
    env.msg?.("You enter a maze of up staircases.");
    /* create_down_stair = true (cmd-cave.c:91): arrive on a down staircase. */
    state.arrivalStair = "down";
    state.targetDepth = state.chunk.depth - 1;
    state.generateLevel = true;
    return state.z.moveEnergy;
  });
}
