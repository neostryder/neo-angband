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
 * count_feats direction inference is NOW PORTED (countFeats below, consumed by
 * the shell's open / close / disarm commands): it is unconditional in 4.2.6 --
 * the old easy_open option no longer exists -- so deferring it as "UI" changed
 * the keystrokes ordinary play requires on every door and trap.
 *
 * DEFERRED (ledgered in game-cave-cmd.yaml): do_cmd_steal (shapechange #22) and
 * command repetition. Running and travel / explore (player-path #24) are ported
 * in game/player-path.ts.
 */

import type { Loc } from "../loc";
import { DDGRID, DDGRID_DDD, locSum } from "../loc";
import { FEAT, ORIGIN, TF, TMD, TRF } from "../generated";
import { SKILL } from "../player/types";
import { motionDir, squareIsSeen } from "../world/view";
import { monsterIsCamouflaged } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { featIsTreasure } from "../world/chunk";
import type { MakeDeps } from "../obj/make";
import { makeGold, makeObject } from "../obj/make";
import { CHEST_QUERY } from "../obj/chest";
import { chestCheck, countChests, doCmdDisarmChest, doCmdOpenChest } from "./chest";
import type { ChestCmdDeps } from "./chest";
import type { GameState, PlayerCommand } from "./context";
import { modRuleEnabled, queueCommandRepeat, squareMonster } from "./context";
import {
  knownFeat,
  knownIsBrokenDoor,
  knownIsClosedDoor,
  knownIsDiggable,
  knownIsOpenDoor,
  knownIsPerm,
  squareApparentName,
  squareForget,
  squareIsKnown,
  squareMemorize,
} from "./known";
import { dungeonGetNextLevel, isQuest } from "./quest";
import { floorCarry } from "./floor";
import { playerConfuseDir } from "./obj-cmd";
import { attackMonster } from "./player-turn";
import type { ActionRegistry } from "./player-turn";
import {
  disarmAux,
  squareDoorPower,
  playerIsTrapsafe,
  squareIsDisarmableTrap,
  squareIsWebbed,
  squareRemoveAllTraps,
  squareTrap,
  type TrapDeps,
} from "./trap";

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
  /**
   * player_is_trapsafe (player-util.c:1073-1077): skip disarm-on-walk when
   * true (cmd-cave.c:1311-1312). Default: trap.ts playerIsTrapsafe (timed +
   * derived/equipment OF_TRAP_IMMUNE). Override only for tests.
   */
  isTrapsafe?: (state: GameState) => boolean;
  /**
   * get_check: do_cmd_go_down's force_descend quest warning
   * (cmd-cave.c:126). Default yes - an unprompted terminal auto-accepts, the
   * same convention as effect-general.ts's confirm seam.
   */
  confirm?: (prompt: string) => boolean;
  /**
   * tunnel_aux's `with_clause` (cmd-cave.c:541, :552): "with your hands" with
   * no weapon, "with your weapon" wielding one, "with your swap digger" when
   * player_best_digger swapped a better tool in for the roll. Pairs with
   * state.bestDiggerDigging, which supplies that roll; default "with your
   * hands" only matters in the worldless harness.
   */
  digWithClause?: () => string;
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
  /**
   * Live trap deps for disarm-on-walk (cmd-cave.c:1079-1083). Absent, the
   * walk wrapper never auto-disarms (step triggers as before).
   */
  trapDeps?: TrapDeps;
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

/**
 * count_feats (cave.c L644-679): how many of the nine grids around (and
 * optionally under) the player match `test`, plus the last one matched.
 *
 * Two details of the C matter and are easy to get wrong. It requires
 * `square_isknown` and then tests **the player's memory**, `player->cave`, not
 * the live map -- so terrain the player has not seen never counts, and
 * misremembered terrain counts as remembered. And `ddgrid_ddd[8]` is the
 * player's own grid, which only participates when `under` is set.
 *
 * Draws no RNG. The C uses this to auto-select a direction for open, close and
 * disarm when exactly one adjacent candidate exists (cmd-cave.c L250-260, L409,
 * L874-876), which is unconditional in 4.2.6 -- the old `easy_open` option no
 * longer exists.
 */
export function countFeats(
  state: GameState,
  test: (state: GameState, grid: Loc) => boolean,
  under: boolean,
): { count: number; grid: Loc | null } {
  let count = 0;
  let last: Loc | null = null;
  for (let d = 0; d < DDGRID_DDD.length; d++) {
    if (d === 8 && !under) continue;
    const grid = locSum(state.actor.grid, DDGRID_DDD[d] as Loc);
    if (!state.chunk.inBoundsFully(grid)) continue;
    if (!squareIsKnown(state, grid)) continue;
    if (!test(state, grid)) continue;
    count++;
    last = grid;
  }
  return { count, grid: last };
}

/* ------------------------------------------------------------------ *
 * Door predicates (cave-square.c) over the feature flags.
 * ------------------------------------------------------------------ */

/**
 * square_isunlockeddoor (cave-square.c L791-794): a closed door whose lock
 * power is zero. Locks are traps upstream, so without live trap deps every
 * closed door reads as unlocked -- which matches shipped levels, where plain
 * closed doors are what generation places.
 */
export function squareIsUnlockedDoor(
  state: GameState,
  grid: Loc,
  trapDeps?: TrapDeps,
): boolean {
  if (!state.chunk.isClosedDoor(grid)) return false;
  return trapDeps ? squareDoorPower(state, grid, trapDeps) === 0 : true;
}

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

/**
 * do_cmd_open_test (cmd-cave.c:148-166): knowledge first, then a closed door.
 *
 * The knowledge gate matters because it is what stops a player opening a door
 * they have never seen; and the failure arm reconciles a stale memory - if
 * player->cave still remembers a closed door where the real grid has none, the
 * memory is forgotten so the map stops lying.
 */
function openTest(state: GameState, grid: Loc, env: CaveCmdEnv): boolean {
  if (!state.chunk.inBounds(grid) || !squareIsKnown(state, grid)) {
    env.msg?.("You see nothing there.");
    return false;
  }
  if (!state.chunk.isClosedDoor(grid)) {
    env.msg?.("You see nothing there to open.");
    if (knownIsClosedDoor(state, grid)) squareForget(state, grid);
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

/** do_cmd_close_test / _aux (cmd-cave.c:322-393). */
function closeAux(state: GameState, grid: Loc, env: CaveCmdEnv): boolean {
  if (!state.chunk.inBounds(grid) || !squareIsKnown(state, grid)) {
    env.msg?.("You see nothing there.");
    return false;
  }
  if (!squareIsOpenDoor(state, grid) && !squareIsBrokenDoor(state, grid)) {
    env.msg?.("You see nothing there to close.");
    /* cmd-cave.c:337-341: a remembered door that is not there is forgotten. */
    if (knownIsOpenDoor(state, grid) || knownIsBrokenDoor(state, grid)) {
      squareForget(state, grid);
    }
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
    /* square_close_door (cave-square.c:1361): set_feat(FEAT_CLOSED). */
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
  if (!squareIsKnown(state, grid)) {
    env.msg?.("You see nothing there.");
    return false;
  }
  if (state.chunk.isPerm(grid)) {
    env.msg?.("This seems to be permanent rock.");
    /* cmd-cave.c:464-467: MEMORIZES - discovering titanium teaches it. */
    if (!knownIsPerm(state, grid)) squareMemorize(state, grid);
    return false;
  }
  if (!squareIsDiggable(state, grid) && !state.chunk.isClosedDoor(grid)) {
    env.msg?.("You see nothing there to tunnel.");
    /* cmd-cave.c:474-478: forgets a remembered wall/door that is not there. */
    if (knownIsDiggable(state, grid) || knownIsClosedDoor(state, grid)) {
      squareForget(state, grid);
    }
    return false;
  }
  return true;
}

/**
 * twall (cmd-cave.c:500-515): knock the feature down to floor. The set_feat
 * is square_tunnel_wall (cave-square.c:1414), called at cmd-cave.c:510.
 */
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

  /* with_clause (cmd-cave.c:541, :552) - every tunnel message names the tool. */
  const withClause = env.digWithClause?.() ?? "with your hands";

  if (okay && twall(state, grid)) {
    if (rubble) {
      env.msg?.(`You have removed the rubble ${withClause}.`);
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
          /* cmd-cave.c:603-609: announced only if it is not ignored and the
           * grid is seen - digging blind finds it without telling you. */
          if (
            !(state.isIgnored?.(obj) ?? false) &&
            squareIsSeen(state.chunk, grid)
          ) {
            env.msg?.("You have found something!");
          }
        }
      }
    } else if (gold && deps.makeDeps) {
      /* Found treasure. */
      const money = makeGold(state.rng, deps.makeDeps, state.chunk.depth, "any");
      /* cmd-cave.c L613: dug-out gold carries ORIGIN_FLOOR. */
      money.origin = ORIGIN.FLOOR;
      money.originDepth = state.chunk.depth;
      floorCarry(state, grid, money);
      env.msg?.(`You have found something digging ${withClause}!`);
    } else {
      env.msg?.(`You have finished the tunnel ${withClause}.`);
    }
    return false;
  }
  /* Failure messages name the terrain the player believes is there
   * (square_apparent_name over player->cave), cmd-cave.c:624-639. */
  if (chance > 0) {
    env.msg?.(
      rubble
        ? `You dig in the rubble ${withClause}.`
        : `You tunnel into the ${squareApparentName(state, grid)} ${withClause}.`,
    );
    return true;
  }
  env.msg?.(
    rubble
      ? `You dig in the rubble ${withClause} with little effect.`
      : `You chip away futilely ${withClause} at the ${squareApparentName(state, grid)}.`,
  );
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

/** The direction supplied by count_feats/count_chests, or the command's one. */
function inferredDirection(
  state: GameState,
  cmd: PlayerCommand,
  tests: readonly ((state: GameState, grid: Loc) => boolean)[],
  chestQuery?: (typeof CHEST_QUERY)[keyof typeof CHEST_QUERY],
): number | undefined {
  if (cmd.dir !== undefined && cmd.dir >= 1 && cmd.dir <= 9) return cmd.dir;

  let count = 0;
  let grid: Loc | null = null;
  for (const test of tests) {
    const result = countFeats(state, test, false);
    count += result.count;
    if (result.grid) grid = result.grid;
  }
  if (chestQuery !== undefined) {
    const chests = countChests(state, chestQuery);
    count += chests.count;
    if (chests.grid) grid = chests.grid;
  }
  return count === 1 ? motionDir(state.actor.grid, grid!) : undefined;
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
  cmd: PlayerCommand,
  dir: number,
  deps: CaveCmdDeps,
  env: CaveCmdEnv,
): number {
  const cdir = playerConfuseDir(state, dir);
  const grid = locSum(state.actor.grid, DDGRID[cdir] as Loc);
  let more = false;
  if (state.chunk.mon(grid) > 0) {
    revealOrAttackBlocker(state, grid, env);
  } else {
    more = doCmdLockDoor(state, grid, deps);
  }
  queueCommandRepeat(state, cmd, more);
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
   * move_player's alter branch (cmd-cave.c L1079-1083): walking (or jumping)
   * into a known closed door opens it via do_cmd_alter_aux; walking onto a
   * known disarmable trap (when not trapsafe) auto-disarms. Jump uses
   * disarm=false so only the door half applies. Web clear is in walkAction.
   */
  const trapDeps = deps.trapDeps;
  /* Single C player_is_trapsafe (player-util.c:1073-1077) via trap.ts. */
  const isTrapsafe = env.isTrapsafe ?? playerIsTrapsafe;

  const bumpOpen =
    (prior: ReturnType<typeof registry.get>, allowDisarm: boolean) =>
    (state: GameState, cmd: PlayerCommand): number => {
      /*
       * do_cmd_walk / jump web clear (cmd-cave.c:1288-1297) runs BEFORE
       * confusion so a webbed player spends no confuse-dir draw.
       */
      if (squareIsWebbed(state, state.actor.grid)) {
        env.msg?.("You clear the web.");
        const web = squareTrap(state, state.actor.grid).find(
          (t) => t.kind.flags.has(TRF.WEB) || t.kind.desc === "web",
        );
        squareRemoveAllTraps(state, state.actor.grid, web?.tidx ?? -1);
        return state.z.moveEnergy;
      }
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
      /*
       * move_player (cmd-cave.c:1079-1083): ((trap && disarm) || door) &&
       * square_isknown. Door and known-trap alter share the known guard; an
       * unknown closed door falls through to the bump message path.
       */
      if (
        grid &&
        !squareMonster(state, grid) &&
        squareIsKnown(state, grid) &&
        state.chunk.isClosedDoor(grid)
      ) {
        /* move_player L1079-1083: walking into a known closed door sets a 99x
         * repeat (cmd_set_repeat(99) when nrepeats == 0) then do_cmd_alter_aux
         * opens it. A locked door that fails to pick this attempt re-queues the
         * walk so the player keeps trying without pressing the key again,
         * bounded at CMD_AUTO_REPEAT - the same repeat-on-failure budget the
         * explicit open/tunnel/disarm commands use. Re-queue the ORIGINAL cmd
         * (not the confused redirect) so each repeat re-rolls confusion, exactly
         * as upstream's repeat re-runs do_cmd_walk from the top. */
        const more = openAux(state, grid, env);
        queueCommandRepeat(state, cmd, more);
        return state.z.moveEnergy;
      }
      /*
       * move_player L1079-1083 / do_cmd_walk L1311-1312: known disarmable trap
       * + disarm (walk, not jump, not trapsafe) -> do_cmd_alter_aux disarm.
       */
      if (
        allowDisarm &&
        trapDeps &&
        grid &&
        !squareMonster(state, grid) &&
        squareIsDisarmableTrap(state, grid) &&
        squareIsKnown(state, grid) &&
        !isTrapsafe(state)
      ) {
        const more = disarmAux(state, grid, trapDeps);
        queueCommandRepeat(state, cmd, more);
        return state.z.moveEnergy;
      }
      const used = prior ? prior(state, cmd2) : 0;
      /* A confused redirect that dead-ends (bump / edge) still spends a full
       * turn; walkAction returns 0 in that case since confusedApplied is set. */
      return confused && used === 0 ? state.z.moveEnergy : used;
    };
  const priorWalk = registry.get("walk");
  if (priorWalk) registry.register("walk", bumpOpen(priorWalk, true));
  const priorJump = registry.get("jump");
  if (priorJump) registry.register("jump", bumpOpen(priorJump, false));

  registry.register("open", (state, cmd) => {
    const dir0 = inferredDirection(
      state,
      cmd,
      [(s, grid) => s.chunk.features.featHas(knownFeat(s, grid), TF.DOOR_CLOSED)],
      CHEST_QUERY.OPENABLE,
    );
    const at = dir0 === undefined ? null : chestCommandGrid(state, { ...cmd, dir: dir0 });
    if (!at) return 0;
    /* do_cmd_open (L268-276): a chest there skips the door legality test. */
    const preChest = chestDeps ? chestCheck(state, at.grid, CHEST_QUERY.OPENABLE) : null;
    if (!preChest && !openTest(state, at.grid, env)) return 0;

    /* Apply confusion after the turn is committed, then re-resolve the
     * chest at the (possibly redirected) grid, as upstream does. */
    const dir = playerConfuseDir(state, at.dir);
    const grid = chestDirGrid(state, dir);
    const chestObj = chestDeps ? chestCheck(state, grid, CHEST_QUERY.OPENABLE) : null;

    let more = false;
    if (squareMonster(state, grid)) {
      revealOrAttackBlocker(state, grid, env);
    } else if (chestObj) {
      more = doCmdOpenChest(state, grid, chestObj, chestDeps!);
    } else {
      more = openAux(state, grid, env);
    }
    queueCommandRepeat(state, cmd, more);
    return state.z.moveEnergy;
  });

  registry.register("close", (state, cmd) => {
    const dir0 = inferredDirection(state, cmd, [
      (s, grid) => s.chunk.features.featHas(knownFeat(s, grid), TF.CLOSABLE),
    ]);
    const at = dir0 === undefined ? null : commandGrid(state, { ...cmd, dir: dir0 });
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
    let more = false;
    if (state.chunk.mon(grid) > 0) attackBlocker(state, grid, env);
    else more = closeAux(state, grid, env);
    queueCommandRepeat(state, cmd, more);
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
    const dir0 = inferredDirection(
      state,
      cmd,
      [
        (s, grid) => squareIsDisarmableTrap(s, grid),
        (s, grid) =>
          s.chunk.features.featHas(knownFeat(s, grid), TF.DOOR_CLOSED) &&
          !(env.isLockedDoor?.(grid) ?? false),
      ],
      CHEST_QUERY.TRAPPED,
    );
    const inferredCmd = dir0 === undefined ? cmd : { ...cmd, dir: dir0 };
    if (chestDeps) {
      const at = chestCommandGrid(state, inferredCmd);
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
          const more = doCmdDisarmChest(state, chestObj, chestDeps);
          queueCommandRepeat(state, cmd, more);
        } else if (priorDisarm) {
          /* priorDisarm (trap.ts's floor-trap disarm) queues its own repeat. */
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
    const doorAt = commandGrid(state, inferredCmd);
    if (
      doorAt &&
      state.chunk.isClosedDoor(doorAt.grid) &&
      !(env.isLockedDoor?.(doorAt.grid) ?? false)
    ) {
      return lockDoorCommand(state, cmd, doorAt.dir, deps, env);
    }
    return priorDisarm ? priorDisarm(state, inferredCmd) : 0;
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
    return lockDoorCommand(state, cmd, at.dir, deps, env);
  });

  registry.register("tunnel", (state, cmd) => {
    const at = commandGrid(state, cmd);
    if (!at) return 0;
    if (!tunnelTest(state, at.grid, env)) return 0;
    const dir = playerConfuseDir(state, at.dir);
    const grid = locSum(state.actor.grid, DDGRID[dir] as Loc);
    /* A monster in the way is attacked and the dig does not repeat (upstream
     * leaves `more` false); otherwise repeat while the aux reports hope. */
    let more = false;
    if (state.chunk.mon(grid) > 0) attackBlocker(state, grid, env);
    else more = tunnelAux(state, grid, deps);
    queueCommandRepeat(state, cmd, more);
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
    let more = false;
    if (state.chunk.mon(grid) > 0) {
      attackBlocker(state, grid, env);
    } else if (squareIsDiggable(state, grid)) {
      more = tunnelAux(state, grid, deps);
    } else if (state.chunk.isClosedDoor(grid)) {
      more = openAux(state, grid, env);
    } else {
      env.msg?.("You spin around.");
      return 0;
    }
    queueCommandRepeat(state, cmd, more);
    return state.z.moveEnergy;
  });

  /* do_cmd_go_down / go_up: require the matching staircase underfoot. When
   * OPT(autoexplore_commands) and the player is not on the stair, fall through
   * to do_cmd_navigate_* which uses pathNearestKnown (cmd-cave.c:62-66,107-111;
   * W2-003). navigate-* is registered by installRunning after this; the
   * registry.get at call time finds it. */
  registry.register("descend", (state) => {
    const p = state.actor.player;
    if (!state.chunk.isDownstairs(state.actor.grid)) {
      if (state.options?.get("autoexplore_commands")) {
        const nav = registry.get("navigate-down");
        if (nav) return nav(state, { code: "navigate-down" });
      }
      env.msg?.("I see no down staircase here.");
      return 0;
    }
    /* Paranoia, no descent from max_depth - 1 (cmd-cave.c:115-119). */
    if (state.chunk.depth === state.z.maxDepth - 1) {
      env.msg?.("The dungeon does not appear to extend deeper");
      return 0;
    }
    /* dungeon_get_next_level (cmd-cave.c:103): the quest scan is what keeps a
     * player on 99 while Sauron lives instead of landing them on Morgoth. */
    let descendTo = dungeonGetNextLevel(p, state.chunk.depth, 1, state.z);
    /* Warn a force_descend player about a quest level (cmd-cave.c:121-128).
     * force_descend measures from max_depth, not from here. */
    if (state.options?.get("birth_force_descend")) {
      descendTo = dungeonGetNextLevel(p, p.maxDepth, 1, state.z);
      if (
        isQuest(p, descendTo) &&
        !(env.confirm ?? ((): boolean => true))("Are you sure you want to descend? ")
      ) {
        return 0;
      }
    }
    /* Success (cmd-cave.c:134): the stair message, typed MSG_STAIRS_DOWN, goes
     * through the message log so it reaches the -more- pager and Ctrl-P. */
    env.msg?.("You enter a maze of down staircases.");
    /* create_up_stair = true (cmd-cave.c:137): arrive on an up staircase. */
    state.arrivalStair = "up";
    state.targetDepth = descendTo;
    state.generateLevel = true;
    return state.z.moveEnergy;
  });

  registry.register("ascend", (state) => {
    if (!state.chunk.isUpstairs(state.actor.grid)) {
      if (state.options?.get("autoexplore_commands")) {
        const nav = registry.get("navigate-up");
        if (nav) return nav(state, { code: "navigate-up" });
      }
      env.msg?.("I see no up staircase here.");
      return 0;
    }
    /* Force descend (cmd-cave.c:70-74): up staircases do nothing at all. */
    if (state.options?.get("birth_force_descend")) {
      env.msg?.("Nothing happens!");
      return 0;
    }
    const ascendTo = dungeonGetNextLevel(
      state.actor.player,
      state.chunk.depth,
      -1,
      state.z,
    );
    if (ascendTo === state.chunk.depth) {
      /* do_cmd_go_up (cmd-cave.c:78-81): can't ascend past the top level. */
      env.msg?.("You can't go up from here!");
      return 0;
    }
    /* Success (cmd-cave.c:87): typed MSG_STAIRS_UP. */
    env.msg?.("You enter a maze of up staircases.");
    /* create_down_stair = true (cmd-cave.c:91): arrive on a down staircase. */
    state.arrivalStair = "down";
    state.targetDepth = ascendTo;
    state.generateLevel = true;
    return state.z.moveEnergy;
  });
}
