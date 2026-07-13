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
 * NOW PORTED (this pass, one coherent RNG-order-preserving change):
 * - Fleeing geometry: get_move_find_safety (the dist_offsets ring scan for a
 *   reachable out-of-view grid) and the swerving get_move_flee, wired into the
 *   afraid branch of get_move exactly as upstream (find_safety -> flee for a
 *   course, else leg it away). Both draw no RNG.
 * - Terrain manipulation in monster_turn_can_move: OPEN_DOOR / BASH_DOOR
 *   (with the confused one_in_(3) bash chance, the one_in_(2) open-vs-bash
 *   choice, and the locked-door randint0(hp/10) strength test seamed to the
 *   trap system) and KILL_WALL / SMASH_WALL (square_smash_wall's per-adjacent
 *   granite/quartz/magma survival rolls) / PASS_WALL, plus the confused-move
 *   self-stun. The "can move here" predicate stays distinct from "did the
 *   terrain action" (the did-something flag that spends the turn).
 * - Reproduction: monster_turn_multiply (the num_repro cap, arena block, the
 *   3x3 neighbour count and the one_in_(k * repro_monster_rate) chance) calling
 *   multiply_monster through the state.monsterMultiply hook. Runs before the
 *   ranged attack, matching upstream's process_monster order.
 * - Item pickup/crush: monster_turn_grab_objects (TAKE_ITEM copies the floor
 *   object into the monster's held pile, KILL_ITEM crushes it; gold, mimics and
 *   artifacts are left; draws no RNG).
 * - Aggravation: monster_reduce_sleep consults player OF_AGGRAVATE first and
 *   wakes the monster (drawing monster_wake's randint0(100) instead of the
 *   notice roll), matching the upstream if/else.
 *
 * DEFERRED (ledgered in parity/ledger/game-monster-ai.yaml):
 * - bodyguard tactics (get_move_bodyguard), group surround and pack ambush
 *   (get_move_find_hiding - its only caller is the out-of-scope pack branch,
 *   so it is left deferred with that branch), damaging-terrain flight /
 *   avoidance / activation, glyph/decoy/web handling, camouflage/mimic reveal
 *   (become_aware, a separate agent), react_to_slay pickup safety, the
 *   confused-move / door-burst UI messages and disturb, and the remaining
 *   monster-lore updates. None of these draw RNG until taken, so they stay as
 *   inert conditionals in their upstream positions and the RNG order for the
 *   ported paths is unaffected.
 */

import type { Loc } from "../loc";
import {
  DDD,
  DDGRID,
  DDGRID_DDD,
  SIDE_DIRS,
  distance,
  loc,
  locDiff,
  locIsZero,
  locSum,
} from "../loc";
import { FEAT, MFLAG, MON_TMD, MSG, OF, RF, TF } from "../generated";
import type { Monster } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import {
  monsterIsObvious,
  monsterIsVisible,
  monsterPassesWalls,
} from "../mon/predicate";
import {
  getLore,
  loreCountU16,
  loreCountU8,
  loreLearnFlagIfVisible,
  loreUpdate,
} from "../mon/lore";
import { monsterRevertShape } from "./mon-shape";
import { monsterCarry } from "../mon/make";
import { monsterWake } from "../mon/take-hit";
import { monIncTimed, monsterEffectLevel } from "../mon/timed";
import { tvalIsMoney } from "../obj/object";
import { monMeleeAttack } from "../combat/mon-melee";
import { equipLearnOnDefend } from "../obj/knowledge";
import { los, squareIsView } from "../world/view";
import type { GameState } from "./context";
import { monsterSwap, squareIsPlayer, squareMonster } from "./context";
import { floorExcise, floorPile } from "./floor";
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

/**
 * dist_offsets_y / dist_offsets_x (cave.c): for each distance d (1..9), the
 * offsets of every grid exactly distance d from a centre, terminated by the
 * (0,0) sentinel. Copied verbatim so get_move_find_safety's ring scan order -
 * and therefore its tie-break (first grid at the maximum distance wins) - match
 * upstream exactly.
 */
const D_OFF_Y: readonly (readonly number[])[] = [
  [0],
  [-1, -1, -1, 0, 0, 1, 1, 1, 0],
  [-1, -1, -2, -2, -2, 0, 0, 1, 1, 2, 2, 2, 0],
  [-1, -1, -2, -2, -3, -3, -3, 0, 0, 1, 1, 2, 2, 3, 3, 3, 0],
  [
    -1, -1, -2, -2, -3, -3, -3, -3, -4, -4, -4, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 4,
    4, 4, 0,
  ],
  [
    -1, -1, -2, -2, -3, -3, -4, -4, -4, -4, -5, -5, -5, 0, 0, 1, 1, 2, 2, 3, 3,
    4, 4, 4, 4, 5, 5, 5, 0,
  ],
  [
    -1, -1, -2, -2, -3, -3, -4, -4, -5, -5, -5, -5, -6, -6, -6, 0, 0, 1, 1, 2, 2,
    3, 3, 4, 4, 5, 5, 5, 5, 6, 6, 6, 0,
  ],
  [
    -1, -1, -2, -2, -3, -3, -4, -4, -5, -5, -5, -5, -6, -6, -6, -6, -7, -7, -7,
    0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 0,
  ],
  [
    -1, -1, -2, -2, -3, -3, -4, -4, -5, -5, -6, -6, -6, -6, -7, -7, -7, -7, -8,
    -8, -8, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8,
    0,
  ],
  [
    -1, -1, -2, -2, -3, -3, -4, -4, -5, -5, -6, -6, -7, -7, -7, -7, -8, -8, -8,
    -8, -9, -9, -9, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 7, 8, 8,
    8, 8, 9, 9, 9, 0,
  ],
];
const D_OFF_X: readonly (readonly number[])[] = [
  [0],
  [-1, 0, 1, -1, 1, -1, 0, 1, 0],
  [-2, 2, -1, 0, 1, -2, 2, -2, 2, -1, 0, 1, 0],
  [-3, 3, -2, 2, -1, 0, 1, -3, 3, -3, 3, -2, 2, -1, 0, 1, 0],
  [
    -4, 4, -3, 3, -2, -3, 2, 3, -1, 0, 1, -4, 4, -4, 4, -3, 3, -2, -3, 2, 3, -1,
    0, 1, 0,
  ],
  [
    -5, 5, -4, 4, -4, 4, -2, -3, 2, 3, -1, 0, 1, -5, 5, -5, 5, -4, 4, -4, 4, -2,
    -3, 2, 3, -1, 0, 1, 0,
  ],
  [
    -6, 6, -5, 5, -5, 5, -4, 4, -2, -3, 2, 3, -1, 0, 1, -6, 6, -6, 6, -5, 5, -5,
    5, -4, 4, -2, -3, 2, 3, -1, 0, 1, 0,
  ],
  [
    -7, 7, -6, 6, -6, 6, -5, 5, -4, -5, 4, 5, -2, -3, 2, 3, -1, 0, 1, -7, 7, -7,
    7, -6, 6, -6, 6, -5, 5, -4, -5, 4, 5, -2, -3, 2, 3, -1, 0, 1, 0,
  ],
  [
    -8, 8, -7, 7, -7, 7, -6, 6, -6, 6, -4, -5, 4, 5, -2, -3, 2, 3, -1, 0, 1, -8,
    8, -8, 8, -7, 7, -7, 7, -6, 6, -6, 6, -4, -5, 4, 5, -2, -3, 2, 3, -1, 0, 1,
    0,
  ],
  [
    -9, 9, -8, 8, -8, 8, -7, 7, -7, 7, -6, 6, -4, -5, 4, 5, -2, -3, 2, 3, -1, 0,
    1, -9, 9, -9, 9, -8, 8, -8, 8, -7, 7, -7, 7, -6, 6, -4, -5, 4, 5, -2, -3, 2,
    3, -1, 0, 1, 0,
  ],
];

/** The (0,0)-terminated ring of offsets at each distance d (1..9). */
const DIST_OFFSETS: readonly (readonly Loc[])[] = D_OFF_Y.map((ys, d) => {
  const xs = D_OFF_X[d] as readonly number[];
  const ring: Loc[] = [];
  for (let i = 0; (xs[i] ?? 0) !== 0 || (ys[i] ?? 0) !== 0; i++) {
    ring.push(loc(xs[i] as number, ys[i] as number));
  }
  return ring;
});

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

/**
 * get_move_find_safety (mon-move.c L545): choose a reachable grid the player
 * cannot fire into (out of view) that is as far from the player as possible,
 * spreading outward a distance ring at a time. Sets mon.target.grid and returns
 * true on success. Pure scan - draws no RNG. The dist_offsets ring order fixes
 * the tie-break: the FIRST grid at the maximum player-distance wins.
 */
function getMoveFindSafety(mon: Monster, state: GameState): boolean {
  const c = state.chunk;
  let gdis = 0;
  let best = loc(0, 0);

  for (let d = 1; d < 10; d++) {
    const ring = DIST_OFFSETS[d] as readonly Loc[];
    for (const off of ring) {
      const grid = locSum(mon.grid, off);

      /* Skip illegal / walled locations. */
      if (!c.inBoundsFully(grid)) continue;
      if (!c.isPassable(grid)) continue;

      /* Ignore too-distant grids (noise heatmap gate). */
      if (noiseAt(state, grid) > noiseAt(state, mon.grid) + 2 * d) continue;

      /* Ignore damaging terrain (DEFERRED: monsterHatesGrid is false). */
      if (monsterHatesGrid(state, mon, grid)) continue;

      /* Check for absence of shot (more or less). */
      if (!squareIsView(c, grid)) {
        const dis = distance(grid, state.actor.grid);
        if (dis > gdis) {
          best = grid;
          gdis = dis;
        }
      }
    }

    if (gdis > 0) {
      mon.target = { grid: best, midx: mon.target.midx };
      return true;
    }
  }

  return false;
}

/**
 * get_move_flee (mon-move.c L675): provide a swerving course toward the current
 * target (a safe grid) that gives the player a wide berth. Sets mon.target.grid
 * and returns true, or returns false (leaving the target as find_safety set it)
 * when the monster is too far to bother. Diagonals are scanned first. Draws no
 * RNG.
 */
function getMoveFlee(mon: Monster, state: GameState): boolean {
  let best = loc(0, 0);
  let bestScore = -1;

  /* Terrain damage (which would make moving vital) is DEFERRED and always
   * false, so these two early-outs always apply. */
  if (mon.cdis >= mon.bestRange) return false;
  if (!monsterCanHear(mon, state) && !monsterCanSmell(mon, state)) return false;

  /* Check nearby grids, diagonals first. */
  for (let i = 7; i >= 0; i--) {
    const grid = locSum(mon.grid, DDGRID_DDD[i] as Loc);
    if (!state.chunk.inBounds(grid)) continue;

    /* Distance of this grid from our target. */
    const dis = distance(grid, mon.target.grid);

    /* Inversely proportional to distance, less the grid's closeness to the
     * player (the noise heatmap). Integer division, as upstream. */
    let score =
      Math.trunc(5000 / (dis + 3)) - Math.trunc(500 / (noiseAt(state, grid) + 1));
    if (score < 0) score = 0;
    if (score < bestScore) continue;

    bestScore = score;
    best = grid;
  }

  mon.target = { grid: best, midx: mon.target.midx };
  return true;
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

  /* Terrain-damage flight DEFERRED. Pack ambush (get_move_find_hiding)
   * DEFERRED (out of scope; draws no RNG). */

  /* Not hiding and monster is afraid. */
  if (!done && mon.minRange === fleeRange) {
    /* Try to find a safe place. */
    if (getMoveFindSafety(mon, state)) {
      /* Set a course for the safe place (flee's return is ignored: on a
       * false early-out the target stays as find_safety set it). */
      getMoveFlee(mon, state);
      grid = locDiff(mon.target.grid, mon.grid);
    } else {
      /* Just leg it away from the player. */
      grid = locDiff(loc(0, 0), grid);
    }
    /* No longer tracking. */
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

/** square_issecretdoor: a door still disguised as rock (cave-square.c L304). */
function squareIsSecretDoor(state: GameState, grid: Loc): boolean {
  const f = state.chunk.feature(grid).flags;
  return f.has(TF.DOOR_ANY) && f.has(TF.ROCK);
}

/** square_destroy_wall (cave-square.c L1419): turn a wall to floor. */
function squareDestroyWall(state: GameState, grid: Loc): void {
  state.chunk.setFeat(grid, FEAT.FLOOR);
}

/** square_open_door (cave-square.c L1351): remove the lock, open the door. */
function squareOpenDoor(state: GameState, grid: Loc): void {
  state.removeDoorLock?.(grid);
  state.chunk.setFeat(grid, FEAT.OPEN);
}

/** square_smash_door (cave-square.c L1367): remove the lock, break the door. */
function squareSmashDoor(state: GameState, grid: Loc): void {
  state.removeDoorLock?.(grid);
  state.chunk.setFeat(grid, FEAT.BROKEN);
}

/**
 * square_smash_wall (cave-square.c L1424): reduce the wall and much of what is
 * next to it to floor. Each adjacent granite / quartz / magma grid gets a
 * survival roll (one_in_ 4 / 10 / 20) - the RNG draws happen in ddgrid_ddd
 * order, exactly once per mineral neighbour. (Decoy destruction on adjacent
 * floors is DEFERRED and draws no RNG.)
 */
function squareSmashWall(state: GameState, grid: Loc): void {
  const c = state.chunk;
  c.setFeat(grid, FEAT.FLOOR);

  for (let i = 0; i < 8; i++) {
    const adj = locSum(grid, DDGRID_DDD[i] as Loc);
    if (!c.inBoundsFully(adj)) continue;
    if (c.isPerm(adj)) continue;
    /* Ignore floors (adjacent-decoy destruction DEFERRED). */
    if (c.isFloor(adj)) continue;
    /* Give this grid a chance to survive. */
    if (
      (c.isGranite(adj) && state.rng.oneIn(4)) ||
      (c.isQuartz(adj) && state.rng.oneIn(10)) ||
      (c.isMagma(adj) && state.rng.oneIn(20))
    ) {
      continue;
    }
    c.setFeat(adj, FEAT.FLOOR);
  }
}

/**
 * monster_slightly_stun_by_move (mon-move.c L1127): a confused monster that
 * bumbles into something may lightly stun itself (one_in_(3), then a normal
 * mon_inc_timed which itself may draw the STUN resist save).
 */
function monsterSlightlyStunByMove(mon: Monster, state: GameState): void {
  if ((mon.mTimed[MON_TMD.STUN] ?? 0) < 5 && state.rng.oneIn(3)) {
    monIncTimed(state.rng, mon, MON_TMD.STUN, 3, 0);
  }
}

/**
 * monster_turn_can_move (mon-move.c L1141): whether the monster can move
 * through `next`, opening / bashing doors or smashing / boring walls in the
 * way. `did` is set true when the monster spent its turn on a terrain action
 * (or a confused bump) even though it did not move - the caller keeps the
 * "can move here" result distinct from "did the terrain action".
 */
function monsterTurnCanMove(
  mon: Monster,
  state: GameState,
  next: Loc,
  confused: boolean,
  did: { value: boolean },
): boolean {
  const lore = getLore(state.lore, mon.race);

  /* Always allow an attack upon the player (decoy DEFERRED). */
  if (squareIsPlayer(state, next)) return true;

  /* Dangerous terrain in the way (monsterHatesGrid is DEFERRED: false). */
  if (!confused && monsterHatesGrid(state, mon, next)) return false;

  /* Floor is open? */
  if (state.chunk.isPassable(next)) return true;

  /* Permanent wall in the way. */
  if (state.chunk.isPerm(next)) {
    if (confused) {
      did.value = true;
      /* confused-move message DEFERRED. */
      monsterSlightlyStunByMove(mon, state);
    }
    return false;
  }

  /* Normal wall, door, or secret door in the way - learn kill / pass-wall. */
  if (monsterIsVisible(mon)) {
    lore.flags.on(RF.PASS_WALL);
    lore.flags.on(RF.KILL_WALL);
    lore.flags.on(RF.SMASH_WALL);
  }

  if (mon.race.flags.has(RF.PASS_WALL)) {
    return true;
  } else if (mon.race.flags.has(RF.SMASH_WALL)) {
    squareSmashWall(state, next);
    return true;
  } else if (mon.race.flags.has(RF.KILL_WALL)) {
    squareDestroyWall(state, next);
    return true;
  } else if (state.chunk.isClosedDoor(next) || squareIsSecretDoor(state, next)) {
    /* Don't allow a confused move to open a door. */
    const canOpen = mon.race.flags.has(RF.OPEN_DOOR) && !confused;
    /* During a confused move, a monster only bashes sometimes. */
    const canBash =
      mon.race.flags.has(RF.BASH_DOOR) && (!confused || state.rng.oneIn(3));
    let willBash = false;

    /* Take a turn. */
    if (canOpen || canBash) did.value = true;

    /* Learn about door abilities. */
    if (!confused && monsterIsVisible(mon)) {
      lore.flags.on(RF.OPEN_DOOR);
      lore.flags.on(RF.BASH_DOOR);
    }

    /* If creature can open or bash doors, make a choice. */
    if (canOpen) {
      /* Sometimes bash anyway (impatient). */
      if (canBash) willBash = state.rng.oneIn(2);
    } else if (canBash) {
      /* Only choice. */
      willBash = true;
    } else {
      /* Door is an insurmountable obstacle. */
      if (confused) {
        did.value = true;
        monsterSlightlyStunByMove(mon, state);
      }
      return false;
    }

    /* Now outcome depends on type of door. */
    const lockPower = state.doorLockPower?.(next) ?? 0;
    if (lockPower > 0) {
      /* Locked door -- test monster strength against door strength. */
      if (state.rng.randint0(Math.trunc(mon.hp / 10)) > lockPower) {
        /* "slams against" / "fiddles with" message DEFERRED. */
        /* Reduce the power of the door by one. */
        state.setDoorLock?.(next, lockPower - 1);
      }
      if (confused) {
        if (monsterIsVisible(mon)) lore.flags.on(RF.BASH_DOOR);
        monsterSlightlyStunByMove(mon, state);
      }
    } else {
      /* Closed or secret door -- always open or bash. */
      if (willBash) {
        squareSmashDoor(state, next);
        /* "You hear a door burst open!" + disturb DEFERRED. */
        if (confused) {
          if (monsterIsVisible(mon)) lore.flags.on(RF.BASH_DOOR);
          monsterSlightlyStunByMove(mon, state);
        }
        /* Fall into doorway. */
        return true;
      } else {
        squareOpenDoor(state, next);
      }
    }
  } else if (confused) {
    did.value = true;
    monsterSlightlyStunByMove(mon, state);
  }

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
 * monster_turn_multiply (mon-move.c L1025): every monster is checked here so
 * the RF_MULTIPLY lore is learnt when the crowd roll passes; only breeders that
 * find room actually reproduce. Returns true if reproduction spent the turn.
 *
 * RNG order is exact: the level cap and arena gate draw nothing, then the 3x3
 * neighbour count (k, which always includes the monster itself so k >= 1), then
 * one_in_(k * repro_monster_rate) - and only on a passing roll does the breeder
 * gate and multiply_monster (via the state.monsterMultiply hook) run.
 */
export function monsterTurnMultiply(mon: Monster, state: GameState): boolean {
  /* Too many breeders on the level already. */
  if ((state.numRepro ?? 0) >= state.z.reproMonsterMax) return false;

  /* No breeding in single combat. */
  if (state.arenaLevel) return false;

  /* Count the adjacent monsters (the 3x3 includes the monster itself). */
  let k = 0;
  for (let y = mon.grid.y - 1; y <= mon.grid.y + 1; y++) {
    for (let x = mon.grid.x - 1; x <= mon.grid.x + 1; x++) {
      const g = loc(x, y);
      if (state.chunk.inBounds(g) && state.chunk.mon(g) > 0) k++;
    }
  }

  /* Multiply slower in crowded areas. */
  if (k < 4 && (k === 0 || state.rng.oneIn(k * state.z.reproMonsterRate))) {
    /* Successful breeding attempt, learn about that now. */
    const lore = getLore(state.lore, mon.race);
    loreLearnFlagIfVisible(lore, mon, RF.MULTIPLY);

    /* Leave now if not a breeder. */
    if (!mon.race.flags.has(RF.MULTIPLY)) return false;

    /* Try to multiply. */
    if (state.monsterMultiply?.(mon)) {
      /* Make a sound. */
      if (monsterIsVisible(mon)) state.sound?.(MSG.MULTIPLY);

      /* Multiplying takes energy. */
      return true;
    }
  }

  return false;
}

/**
 * monster_turn_grab_objects (mon-move.c L1374): pick up (TAKE_ITEM) or crush
 * (KILL_ITEM) the floor objects at `next`. Gold, mimicked objects and artifacts
 * are left alone. Draws no RNG. The lore learn, the react_to_slay pickup-safety
 * check and the seen/ignore message gating are handled as noted (react_to_slay
 * is DEFERRED - it draws no RNG; messages ride presentation).
 */
function monsterTurnGrabObjects(
  mon: Monster,
  state: GameState,
  next: Loc,
): void {
  const lore = getLore(state.lore, mon.race);
  const visible = monsterIsVisible(mon);

  /* Learn about item pickup behaviour. */
  for (const obj of floorPile(state, next)) {
    if (!tvalIsMoney(obj.tval) && visible) {
      lore.flags.on(RF.TAKE_ITEM);
      lore.flags.on(RF.KILL_ITEM);
      break;
    }
  }

  /* Abort if can't pick up / kill. */
  if (
    !mon.race.flags.has(RF.TAKE_ITEM) &&
    !mon.race.flags.has(RF.KILL_ITEM)
  ) {
    return;
  }

  /* Take or kill objects on the floor (snapshot: the pile is mutated). */
  for (const obj of [...floorPile(state, next)]) {
    /* Skip gold. */
    if (tvalIsMoney(obj.tval)) continue;
    /* Skip mimicked objects. */
    if (obj.mimickingMIdx) continue;

    /* Artifacts are "safe" - a monster cannot pick them up. react_to_slay
     * (an object that would hurt the monster) is DEFERRED and draws no RNG. */
    const safe = obj.artifact ? true : false;

    if (safe) {
      /* Only a message for take_item (DEFERRED). */
    } else if (mon.race.flags.has(RF.TAKE_ITEM)) {
      /* Pick it up: move the floor object into the monster's held pile. The
       * player-cave placeholder copy rides the knowledge subsystem (DEFERRED);
       * here the object simply leaves the floor and joins the monster. */
      if (floorExcise(state, next, obj)) {
        monsterCarry(mon.heldObj, obj, mon.midx);
      }
    } else {
      /* Crush it. */
      floorExcise(state, next, obj);
    }
  }
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

  /* Web handling DEFERRED (out of scope; only draws RNG when webbed). */

  /* Let other group monsters know about the player. */
  monsterGroupRouse(state, mon);

  /* Try to multiply - this can use up a turn (mon-move.c L1564, BEFORE the
   * ranged attack, so its cap / chance rolls precede make_ranged_attack in the
   * RNG stream). */
  if (monsterTurnMultiply(mon, state)) return;

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
    /* "can move here" (return) is kept distinct from "did the terrain action"
     * (canDid) which spends the turn even when the monster does not step. */
    const canDid = { value: false };
    const canMove = monsterTurnCanMove(
      mon,
      state,
      next,
      stagger === STAGGER.CONFUSED,
      canDid,
    );
    if (canDid.value) didSomething = true;
    if (!canMove) continue;

    /* Glyph / decoy DEFERRED. */

    if (squareIsPlayer(state, next)) {
      if (mon.race.flags.has(RF.NEVER_BLOW)) continue;
      const result = monMeleeAttack(
        state.rng,
        mon,
        state.actor.player,
        state.actor.defense,
        state.monBlowEnv ? { env: state.monBlowEnv(mon) } : {},
      );
      /* Being attacked teaches the to-armor rune (mon-attack.c L530). */
      equipLearnOnDefend(state.actor.player, state.runeEnv);
      if (result.playerDied || state.actor.player.chp < 0) {
        state.isDead = true;
        state.playing = false;
      }
      /* Analyze "visible" monsters only: count obvious or damaging blows
       * (mon-attack.c L727), notice the cause of death, refresh lore. */
      const lore = getLore(state.lore, mon.race);
      if (monsterIsVisible(mon)) {
        result.blows.forEach((blow, i) => {
          if (blow.obvious || blow.damage || (lore.blowTimesSeen[i] ?? 0) > 10) {
            if ((lore.blowTimesSeen[i] ?? 0) < 255) lore.blowTimesSeen[i]!++;
          }
        });
      }
      if (state.isDead) loreCountU16(lore, "deaths");
      loreUpdate(mon.race, lore);
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

    /* Scan all objects in the grid, if we reached it. */
    if (squareMonster(state, next) === mon) {
      monsterTurnGrabObjects(mon, state, next);
    }
  }

  /* Out of options - monster is paralysed by fear (converts fear to hold). */
  if (!didSomething && (mon.mTimed[MON_TMD.FEAR] ?? 0)) {
    const amount = mon.mTimed[MON_TMD.FEAR] ?? 0;
    mon.mTimed[MON_TMD.FEAR] = 0;
    mon.mTimed[MON_TMD.HOLD] = (mon.mTimed[MON_TMD.HOLD] ?? 0) + amount;
  }
}

/**
 * monster_reduce_sleep (mon-move.c L1729): wake a monster (or reduce its sleep)
 * from player noise. The notice roll is drawn unconditionally (matching
 * upstream), then aggravation is checked first: an aggravating player wakes the
 * monster outright via monster_wake (which draws its own randint0(100)); only
 * otherwise does the noise-notice reduction run.
 */
function monsterReduceSleep(mon: Monster, state: GameState): void {
  const stealth = state.actor.stealth;
  const playerNoise = Math.pow(2, 30 - stealth);
  const notice = state.rng.randint0(1024);
  const aggravate = state.playerState?.flags.has(OF.AGGRAVATE) ?? false;

  if (aggravate) {
    /* Wake the monster, make it aware. The "X wakes up" message and
     * equip_learn_flag(OF_AGGRAVATE) are UI/lore (DEFERRED, no RNG). */
    monsterWake(state.rng, mon, false, 100);
  } else if (notice * notice * notice <= playerNoise) {
    let sleepReduction = 1;
    const localNoise = noiseAt(state, mon.grid);
    if (localNoise > 0 && localNoise < 50) {
      sleepReduction = Math.trunc(100 / localNoise);
    }
    const cur = mon.mTimed[MON_TMD.SLEEP] ?? 0;
    const next = Math.max(0, cur - sleepReduction);
    mon.mTimed[MON_TMD.SLEEP] = next;

    /* Update knowledge (mon-move.c L1771): a watched sleeper that stirs
     * is "ignored", one that wakes is "woken". */
    if (monsterIsObvious(mon)) {
      const lore = getLore(state.lore, mon.race);
      loreCountU8(lore, next > 0 ? "ignore" : "wake");
    }
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
  if (mon.mTimed[MON_TMD.CHANGED] ?? 0) {
    dec(MON_TMD.CHANGED);
    /* The shapechange running out reverts the form (mon-timed.c L202). */
    if ((mon.mTimed[MON_TMD.CHANGED] ?? 0) === 0) {
      monsterRevertShape(state, mon);
    }
  }
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
