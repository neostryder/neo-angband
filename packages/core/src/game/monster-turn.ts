/**
 * process_monster and the mon-move.c monster AI, ported from
 * reference/src/mon-move.c (Angband 4.2.6) as faithfully as the ported
 * subset of the world allows.
 *
 * PORTED:
 * - get_move_find_range: min_range / best_range (fear flight distance, the
 *   level/health comparison that scares weak monsters, the never-move /
 *   never-blow stand-off bonus, turn_range "nearby monsters won't run").
 * - get_move_advance: pass-wall beeline, line-of-sight beeline, then sound
 *   (the cave->noise flow heatmap from world/flow) with the cardinal-first
 *   8-direction scan, then scent. This is the flow-following core.
 * - get_move: advance vs. the tracking fallback / random step, the afraid
 *   flee branch, get_move_choose_direction (the vertical/horizontal/diagonal
 *   preference with the turn-parity tie-break), MFLAG_TRACKING.
 * - monster_turn_should_stagger: RAND_25 / RAND_50 erratic movement and the
 *   confusion staggers (CONF_ERRATIC_CHANCE per confusion grade).
 * - monster_turn: the 5-step side_dirs movement loop, the tracking early-out,
 *   NEVER_MOVE, attack the player via combat.monMeleeAttack, push past / kill
 *   a blocking monster, and the "paralysed by fear" fallback.
 * - process_monster_timed (sleep/wake, timer decrement, hold/stun miss) and
 *   monster_check_active.
 *
 * NOW WIRED (was deferred): make_ranged_attack via the state.monsterCast
 * hook, monster_group_rouse before it, and group_monster_tracking in
 * get_move's fallback branch.
 *
 * DEFERRED (ledgered in parity/ledger/game-monster-ai.yaml):
 * - Reproduction (multiply), item pickup/crush (monster_turn_grab_objects),
 *   bodyguard tactics (get_move_bodyguard, group surround),
 *   ambush hiding and "duck behind a wall" safety (get_move_find_hiding /
 *   get_move_find_safety / the swerving get_move_flee: the afraid branch here
 *   just legs it in the opposite direction), damaging-terrain avoidance,
 *   door open/bash and wall kill/smash carving, glyph/decoy/web handling,
 *   aggravation, camouflage/mimic reveal, and all monster-lore updates.
 */

import type { Loc } from "../loc";
import {
  DDD,
  DDGRID,
  DDGRID_DDD,
  SIDE_DIRS,
  loc,
  locDiff,
  locIsZero,
  locSum,
} from "../loc";
import { MFLAG, MON_TMD, RF } from "../generated";
import type { Monster } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import { monsterPassesWalls } from "../mon/predicate";
import { monsterEffectLevel } from "../mon/timed";
import { monMeleeAttack } from "../combat/mon-melee";
import { equipLearnOnDefend } from "../obj/knowledge";
import { los, squareIsView } from "../world/view";
import type { GameState } from "./context";
import { monsterSwap, squareIsPlayer, squareMonster } from "./context";
import { groupMonsterTracking, monsterGroupRouse } from "./mon-group";

/** enum monster_stagger. */
export const STAGGER = {
  NO: 0,
  CONFUSED: 1,
  INNATE: 2,
} as const;
export type Stagger = (typeof STAGGER)[keyof typeof STAGGER];

/** mon-timed.h CONF_ERRATIC_CHANCE / STUN_MISS_CHANCE. */
const CONF_ERRATIC_CHANCE = 30;
const STUN_MISS_CHANCE = 10;

/** PRIMARY_GROUP index (monster.h). */
const PRIMARY_GROUP = 0;

function noiseAt(state: GameState, grid: Loc): number {
  return state.chunk.noise[grid.y * state.chunk.width + grid.x] ?? 0;
}

function scentAt(state: GameState, grid: Loc): number {
  return state.chunk.scent[grid.y * state.chunk.width + grid.x] ?? 0;
}

/** monster_can_see_player: the monster's grid is in the player's view. */
function monsterCanSeePlayer(mon: Monster, state: GameState): boolean {
  if (!squareIsView(state.chunk, mon.grid)) return false;
  /* TMD_COVERTRACKS far-out-of-range case DEFERRED (needs player timed). */
  return true;
}

/** monster_can_hear: race hearing beats the local noise (minus stealth/3). */
function monsterCanHear(mon: Monster, state: GameState): boolean {
  const baseHearing = mon.race.hearing - Math.trunc(state.actor.stealth / 3);
  const n = noiseAt(state, mon.grid);
  if (n === 0) return false;
  return baseHearing > n;
}

/** monster_can_smell: race smell beats the local scent age. */
function monsterCanSmell(mon: Monster, state: GameState): boolean {
  const s = scentAt(state, mon.grid);
  if (s === 0) return false;
  return mon.race.smell > s;
}

/** compare_monsters: -1 / 0 / 1 by (original) race experience value. */
function compareMonsters(a: Monster, b: Monster): number {
  const ma = (a.originalRace ?? a.race).mexp;
  const mb = (b.originalRace ?? b.race).mexp;
  if (ma < mb) return -1;
  if (ma > mb) return 1;
  return 0;
}

/** monster_can_kill: trample a weaker, non-unique monster (KILL_BODY). */
function monsterCanKill(state: GameState, mon: Monster, grid: Loc): boolean {
  const other = squareMonster(state, grid);
  if (!other) return true;
  if (other.race.flags.has(RF.UNIQUE)) return false;
  return mon.race.flags.has(RF.KILL_BODY) && compareMonsters(mon, other) > 0;
}

/** monster_can_move: swap with a weaker monster (MOVE_BODY). */
function monsterCanMoveInto(
  state: GameState,
  mon: Monster,
  grid: Loc,
): boolean {
  const other = squareMonster(state, grid);
  if (!other) return true;
  return mon.race.flags.has(RF.MOVE_BODY) && compareMonsters(mon, other) > 0;
}

/**
 * monster_hates_grid: damaging terrain the monster can't survive. Damaging
 * terrain is not modelled yet, so this is always false (DEFERRED).
 */
function monsterHatesGrid(_state: GameState, _mon: Monster, _grid: Loc): boolean {
  return false;
}

/**
 * get_move_find_range: set mon.minRange (flee distance) and mon.bestRange.
 * The archer/breather/spellcaster best_range tweaks are DEFERRED with the
 * ranged AI; best_range is left equal to min_range.
 */
export function getMoveFindRange(mon: Monster, state: GameState): void {
  const p = state.actor.player;
  const fleeRange = state.z.maxSight + state.z.fleeRange;

  if (
    (mon.mTimed[MON_TMD.FEAR] ?? 0) ||
    mon.race.flags.has(RF.FRIGHTENED)
  ) {
    mon.minRange = fleeRange;
  } else if (mon.groupInfo[PRIMARY_GROUP]?.role === MON_GROUP.BODYGUARD) {
    mon.minRange = 1;
  } else {
    mon.minRange = 1;

    const pLev = p.lev;
    const mLev = mon.race.level + (mon.midx & 0x08) + 25;

    if (mLev + 3 < pLev) {
      mon.minRange = fleeRange;
    } else if (mLev - 5 < pLev) {
      const pChp = p.chp;
      const pMhp = p.mhp;
      const mChp = mon.hp;
      const mMhp = mon.maxhp;
      const pVal = pLev * pMhp + (pChp << 2);
      const mVal = mLev * mMhp + (mChp << 2);
      /* Strong players scare strong monsters. */
      if (pVal * mMhp > mVal * pMhp) mon.minRange = fleeRange;
    }
  }

  if (mon.minRange < fleeRange) {
    if (mon.race.flags.has(RF.NEVER_MOVE)) mon.minRange += 3;
    if (mon.race.flags.has(RF.NEVER_BLOW)) mon.minRange += 3;
  }

  if (!(mon.minRange < fleeRange)) {
    mon.minRange = fleeRange;
  } else if (mon.cdis < state.z.turnRange) {
    mon.minRange = 1;
  }

  mon.bestRange = mon.minRange;
}

/**
 * get_move_advance: set mon.target.grid to the grid to move toward and
 * return whether a good advance was found. `track` is set when the target
 * came from sound/scent tracking (a one-step goal).
 */
function getMoveAdvance(
  mon: Monster,
  state: GameState,
  track: { value: boolean },
): boolean {
  const target = state.actor.grid;

  /* Bodyguard behaviour DEFERRED. */

  /* Pass-wall monsters head straight for the player (near-permwall
   * exception DEFERRED). */
  if (monsterPassesWalls(mon)) {
    mon.target = { grid: target, midx: mon.target.midx };
    return true;
  }

  /* If the monster can see the player, beeline. */
  if (monsterCanSeePlayer(mon, state)) {
    mon.target = { grid: target, midx: mon.target.midx };
    return true;
  }

  const baseHearing = mon.race.hearing - Math.trunc(state.actor.stealth / 3);
  const currentNoise = baseHearing - noiseAt(state, mon.grid);
  let best: Loc | null = null;
  let backup: Loc | null = null;

  /* Try to use sound, cardinal directions first (ddd order). */
  if (monsterCanHear(mon, state)) {
    for (let i = 0; i < 8; i++) {
      const dir = DDGRID_DDD[i] as Loc;
      const grid = locSum(mon.grid, dir);
      if (!state.chunk.inBounds(grid)) continue;
      if (noiseAt(state, grid) === 0) continue;
      if (!monsterCanKill(state, mon, grid) && !monsterCanMoveInto(state, mon, grid)) {
        continue;
      }
      if (monsterHatesGrid(state, mon, grid)) continue;

      const heardNoise = baseHearing - noiseAt(state, grid);
      if (heardNoise > currentNoise) {
        best = grid;
        break;
      } else if (heardNoise === currentNoise) {
        backup = grid;
      }
    }
  }

  /* Failing sound, use scent. */
  if (monsterCanSmell(mon, state) && !best) {
    let bestScent = 0;
    for (let i = 0; i < 8; i++) {
      const dir = DDGRID_DDD[i] as Loc;
      const grid = locSum(mon.grid, dir);
      if (!state.chunk.inBounds(grid)) continue;
      const smelled = mon.race.smell - scentAt(state, grid);
      if (smelled > bestScent && scentAt(state, grid) !== 0) {
        bestScent = smelled;
        best = grid;
      }
    }
  }

  if (best) {
    mon.target = { grid: best, midx: mon.target.midx };
    track.value = true;
    return true;
  } else if (backup) {
    mon.target = { grid: backup, midx: mon.target.midx };
    track.value = true;
    return true;
  }

  return false;
}

/** get_move_random: a random passable adjacent step, or (0,0). */
function getMoveRandom(mon: Monster, state: GameState): Loc {
  const attempts = [0, 1, 2, 3, 4, 5, 6, 7];
  let nleft = 8;
  while (nleft > 0) {
    const itry = state.rng.randint0(nleft);
    const dir = DDGRID_DDD[attempts[itry] as number] as Loc;
    const tryGrid = locSum(mon.grid, dir);
    if (
      state.chunk.inBounds(tryGrid) &&
      state.chunk.isMonsterWalkable(tryGrid) &&
      !monsterHatesGrid(state, mon, tryGrid)
    ) {
      return dir;
    }
    const tmp = attempts[itry] as number;
    nleft--;
    attempts[itry] = attempts[nleft] as number;
    attempts[nleft] = tmp;
  }
  return loc(0, 0);
}

/**
 * get_move_choose_direction: keypad direction (as a side_dirs row index)
 * from an offset, with the turn-parity tie-break exactly as upstream.
 */
export function getMoveChooseDirection(offset: Loc, turn: number): number {
  let dir = 0;
  const dx = offset.x;
  const dy = offset.y;
  const ay = Math.abs(dy);
  const ax = Math.abs(dx);

  if (ay > ax * 2) {
    if (dy > 0) {
      dir = 2;
      if (dx > 0 || (dx === 0 && turn % 2 === 0)) dir += 10;
    } else {
      dir = 8;
      if (dx < 0 || (dx === 0 && turn % 2 === 0)) dir += 10;
    }
  } else if (ax > ay * 2) {
    if (dx > 0) {
      dir = 6;
      if (dy < 0 || (dy === 0 && turn % 2 === 0)) dir += 10;
    } else {
      dir = 4;
      if (dy > 0 || (dy === 0 && turn % 2 === 0)) dir += 10;
    }
  } else if (dy > 0) {
    if (dx > 0) {
      dir = 3;
      if (ay < ax || (ay === ax && turn % 2 === 0)) dir += 10;
    } else {
      dir = 1;
      if (ay > ax || (ay === ax && turn % 2 === 0)) dir += 10;
    }
  } else {
    if (dx > 0) {
      dir = 9;
      if (ay > ax || (ay === ax && turn % 2 === 0)) dir += 10;
    } else {
      dir = 7;
      if (ay < ax || (ay === ax && turn % 2 === 0)) dir += 10;
    }
  }
  return dir;
}

/** The outcome of get_move. */
interface MoveDecision {
  move: boolean;
  /** side_dirs row index (0 when !move). */
  dir: number;
  /** *good / tracking: the move came from sound/scent tracking. */
  tracking: boolean;
}

/**
 * get_move: decide whether and where the monster wants to step. Returns the
 * side_dirs row index for the movement loop. Group AI (pack luring and
 * surround) is DEFERRED; the afraid branch legs it directly away.
 */
export function getMove(mon: Monster, state: GameState): MoveDecision {
  const fleeRange = state.z.maxSight + state.z.fleeRange;
  let grid: Loc = loc(0, 0);
  const track = { value: false };
  let done = false;

  getMoveFindRange(mon, state);

  if (getMoveAdvance(mon, state, track)) {
    grid = locDiff(mon.target.grid, mon.grid);
    mon.mflag.on(MFLAG.TRACKING);
  } else {
    /* Try to follow someone who knows where they're going. */
    const tracker = groupMonsterTracking(state, mon);
    if (tracker && los(state.chunk, mon.grid, tracker.grid)) {
      grid = locDiff(tracker.grid, mon.grid);
      /* No longer tracking. */
      mon.mflag.off(MFLAG.TRACKING);
    } else {
      if (mon.mflag.has(MFLAG.TRACKING)) {
        /* Keep heading to the most recent goal. */
        grid = locDiff(mon.target.grid, mon.grid);
      }
      if (locIsZero(grid)) {
        /* Try a random move and no longer track. */
        grid = getMoveRandom(mon, state);
        mon.mflag.off(MFLAG.TRACKING);
      }
    }
  }

  /* Terrain-damage flight DEFERRED. Pack ambush DEFERRED. */

  /* Afraid: leg it directly away (find_safety / swerving flee DEFERRED). */
  if (!done && mon.minRange === fleeRange) {
    grid = locDiff(loc(0, 0), grid);
    mon.mflag.off(MFLAG.TRACKING);
    done = true;
  }

  /* Group surround DEFERRED. */

  if (locIsZero(grid)) return { move: false, dir: 0, tracking: track.value };

  return {
    move: true,
    dir: getMoveChooseDirection(grid, state.turn),
    tracking: track.value,
  };
}

/**
 * monster_turn_should_stagger: whether the monster steps at random this turn
 * (confusion staggers, then the cumulative RAND_25 / RAND_50 chances).
 */
export function monsterTurnShouldStagger(
  mon: Monster,
  state: GameState,
): Stagger {
  let chance = 0;
  let confLevel = monsterEffectLevel(mon, MON_TMD.CONF);
  while (confLevel) {
    let accuracy = 100 - chance;
    accuracy *= 100 - CONF_ERRATIC_CHANCE;
    accuracy = Math.trunc(accuracy / 100);
    chance = 100 - accuracy;
    confLevel--;
  }
  const confusedChance = chance;

  if (mon.race.flags.has(RF.RAND_25)) chance += 25;
  if (mon.race.flags.has(RF.RAND_50)) chance += 50;

  const roll = state.rng.randint0(100);
  if (roll < confusedChance) return STAGGER.CONFUSED;
  return roll < chance ? STAGGER.INNATE : STAGGER.NO;
}

/** monster_turn_can_move, scoped. Returns whether the monster may enter. */
function monsterTurnCanMove(
  mon: Monster,
  state: GameState,
  next: Loc,
  confused: boolean,
): boolean {
  if (squareIsPlayer(state, next)) return true;
  if (!confused && monsterHatesGrid(state, mon, next)) return false;
  if (state.chunk.isPassable(next)) return true;
  if (state.chunk.isPerm(next)) return false;
  /* Wall or door: only PASS_WALL gets through in the ported subset.
   * KILL_WALL / SMASH_WALL carving and OPEN_DOOR / BASH_DOOR are DEFERRED. */
  if (mon.race.flags.has(RF.PASS_WALL)) return true;
  return false;
}

/** monster_turn_try_push: trample or swap a blocking monster. */
function monsterTurnTryPush(
  mon: Monster,
  state: GameState,
  next: Loc,
): boolean {
  const killOk = monsterCanKill(state, mon, next);
  const moveOk =
    monsterCanMoveInto(state, mon, next) && state.chunk.isPassable(mon.grid);
  if (!killOk && !moveOk) return false;

  if (killOk) {
    const victim = squareMonster(state, next);
    if (victim) {
      state.monsters[victim.midx] = null;
      state.chunk.setMon(next, 0);
    }
  }
  monsterSwap(state, mon.grid, next);
  return true;
}

/**
 * monster_turn: the monster acts. A ranged attack (spell / breath) is attempted
 * first through the injected state.monsterCast hook (make_ranged_attack, wired by
 * game/mon-ranged.ts installMonsterCasting); when it spends the turn we stop
 * here, exactly as upstream's `if (make_ranged_attack(mon)) return;`.
 * Reproduction, item pickup, web/glyph/decoy, group behaviour and lore are
 * DEFERRED (see the module header); this ports the movement/attack core.
 */
export function monsterTurn(mon: Monster, state: GameState): void {
  let didSomething = false;

  /* Let other group monsters know about the player. */
  monsterGroupRouse(state, mon);

  /* Attempt a ranged attack (spell / breath) before moving. */
  if (state.monsterCast?.(mon, state)) return;

  const stagger = monsterTurnShouldStagger(mon, state);
  let dir = 0;
  let tracking = false;
  if (stagger === STAGGER.NO) {
    const decision = getMove(mon, state);
    if (!decision.move) return;
    dir = decision.dir;
    tracking = decision.tracking;
  }

  for (let i = 0; i < 5 && !didSomething; i++) {
    const d =
      stagger !== STAGGER.NO
        ? (DDD[state.rng.randint0(8)] as number)
        : (SIDE_DIRS[dir]?.[i] as number);
    const next = locSum(mon.grid, DDGRID[d] as Loc);

    /* Tracking monsters commit to their best direction. */
    if (
      i > 0 &&
      stagger === STAGGER.NO &&
      !squareIsView(state.chunk, mon.grid) &&
      tracking
    ) {
      break;
    }

    if (!state.chunk.inBounds(next)) continue;
    if (!monsterTurnCanMove(mon, state, next, stagger === STAGGER.CONFUSED)) {
      continue;
    }

    /* Glyph / decoy DEFERRED. */

    if (squareIsPlayer(state, next)) {
      if (mon.race.flags.has(RF.NEVER_BLOW)) continue;
      const result = monMeleeAttack(
        state.rng,
        mon,
        state.actor.player,
        state.actor.defense,
      );
      /* Being attacked teaches the to-armor rune (mon-attack.c L530). */
      equipLearnOnDefend(state.actor.player, state.runeEnv);
      if (result.playerDied || state.actor.player.chp < 0) {
        state.isDead = true;
        state.playing = false;
      }
      didSomething = true;
      break;
    }

    if (mon.race.flags.has(RF.NEVER_MOVE)) return;

    if (squareMonster(state, next)) {
      didSomething = monsterTurnTryPush(mon, state, next);
    } else {
      monsterSwap(state, mon.grid, next);
      didSomething = true;
    }

    /* monster_turn_grab_objects DEFERRED. */
  }

  /* Out of options - monster is paralysed by fear (converts fear to hold). */
  if (!didSomething && (mon.mTimed[MON_TMD.FEAR] ?? 0)) {
    const amount = mon.mTimed[MON_TMD.FEAR] ?? 0;
    mon.mTimed[MON_TMD.FEAR] = 0;
    mon.mTimed[MON_TMD.HOLD] = (mon.mTimed[MON_TMD.HOLD] ?? 0) + amount;
  }
}

/**
 * monster_reduce_sleep: wake a monster (or reduce its sleep) from player
 * noise. Aggravation and the lore updates are DEFERRED.
 */
function monsterReduceSleep(mon: Monster, state: GameState): void {
  const stealth = state.actor.stealth;
  const playerNoise = Math.pow(2, 30 - stealth);
  const notice = state.rng.randint0(1024);
  if (notice * notice * notice <= playerNoise) {
    let sleepReduction = 1;
    const localNoise = noiseAt(state, mon.grid);
    if (localNoise > 0 && localNoise < 50) {
      sleepReduction = Math.trunc(100 / localNoise);
    }
    const cur = mon.mTimed[MON_TMD.SLEEP] ?? 0;
    mon.mTimed[MON_TMD.SLEEP] = Math.max(0, cur - sleepReduction);
  }
}

/**
 * process_monster_timed: decrement timed effects, wake sleepers. Returns
 * true if the monster skips its turn (asleep, held, commanded, or a stunned
 * miss). Message plumbing and lore are DEFERRED.
 */
export function processMonsterTimed(mon: Monster, state: GameState): boolean {
  if (mon.mTimed[MON_TMD.SLEEP] ?? 0) {
    monsterReduceSleep(mon, state);
    return true;
  }
  if (state.rng.oneIn(10) && mon.mflag.has(MFLAG.ACTIVE)) {
    mon.mflag.on(MFLAG.AWARE);
  }

  const dec = (idx: number): void => {
    const v = mon.mTimed[idx] ?? 0;
    if (v > 0) mon.mTimed[idx] = v - 1;
  };
  dec(MON_TMD.FAST);
  dec(MON_TMD.SLOW);
  dec(MON_TMD.HOLD);
  dec(MON_TMD.DISEN);
  dec(MON_TMD.STUN);
  dec(MON_TMD.CONF);
  dec(MON_TMD.CHANGED);
  if (mon.mTimed[MON_TMD.FEAR] ?? 0) {
    const d = state.rng.randint1(Math.trunc(mon.race.level / 10) + 1);
    mon.mTimed[MON_TMD.FEAR] = Math.max(0, (mon.mTimed[MON_TMD.FEAR] ?? 0) - d);
  }

  if ((mon.mTimed[MON_TMD.HOLD] ?? 0) || (mon.mTimed[MON_TMD.COMMAND] ?? 0)) {
    return true;
  }
  if (mon.mTimed[MON_TMD.STUN] ?? 0) {
    return state.rng.oneIn(STUN_MISS_CHANCE);
  }
  return false;
}

/** monster_check_active: set/clear MFLAG_ACTIVE, return whether active. */
export function monsterCheckActive(mon: Monster, state: GameState): boolean {
  let active = false;
  if (mon.cdis <= mon.race.hearing && monsterPassesWalls(mon)) {
    active = true;
  } else if (mon.hp < mon.maxhp) {
    active = true;
  } else if (squareIsView(state.chunk, mon.grid)) {
    active = true;
  } else if (monsterCanHear(mon, state)) {
    active = true;
  } else if (monsterCanSmell(mon, state)) {
    active = true;
  }
  /* Terrain-damage activation DEFERRED. */
  if (active) mon.mflag.on(MFLAG.ACTIVE);
  else mon.mflag.off(MFLAG.ACTIVE);
  return active;
}
