/**
 * Live-cave monster placement, ported from the placement half of
 * reference/src/mon-make.c (place_monster, place_new_monster_one,
 * place_new_monster_group, place_friends, place_new_monster,
 * pick_and_place_monster) and the world half of reference/src/mon-summon.c
 * (summon_specific, call_monster, select_shape), Angband 4.2.6.
 *
 * The generation-time twin of this family lives in gen/util.ts and operates
 * on the Gen context; this module operates on a running GameState, so
 * summons, breeders and other mid-game arrivals join the live monster list,
 * the group structures and the square occupancy exactly as the generated
 * population did. Monster construction (RNG order: sleep, hp, speed
 * variation, energy, random attr) is the shared mon/make.ts createMonster.
 *
 * Racial population counts (race->cur_num) are live here: placement
 * increments them and deleteMonster (game/context.ts) decrements, so the
 * "only one unique at a time" rule holds across summoning and death. The
 * session layer keeps the counts consistent across level changes
 * (wipe_mon_list decrements for every live monster).
 *
 * DEFERRED (ledgered in parity/ledger/game-mon-place.yaml): monster drops
 * (mon_create_drop) and mimicked objects ride the monster-inventory
 * subsystem; level rating (add_to_monster_rating) and the cheat_hear
 * messages ride level feelings (#25); update_mon / monster-light view
 * refresh rides the FOV consumers.
 */

import { MON_TMD, RF } from "../generated";
import type { Loc } from "../loc";
import { DDGRID_DDD, distance, locEq, locSum } from "../loc";
import type { MonsterBase, MonsterGroupRole, MonsterRace } from "../mon/types";
import { MON_GROUP } from "../mon/types";
import type { Monster, MonsterGroupInfo } from "../mon/monster";
import { turnEnergy } from "../mon/monster";
import { createMonster } from "../mon/make";
import type { MonAllocTable } from "../mon/make";
import { monsterWake } from "../mon/take-hit";
import type { SummonTable } from "../mon/summon";
import { summonSpecificOkay } from "../mon/summon";
import { scatterExt } from "../world/scatter";
import { los } from "../world/view";
import { monsterMax, monsterSwap, squareMonster } from "./context";
import type { GameState } from "./context";
import { monsterGroupAssign, summonGroup } from "./mon-group";

/** Everything live placement needs beyond the state. */
export interface MonPlaceDeps {
  /** The live race allocation table (shared across the session). */
  table: MonAllocTable;
  /**
   * square_isplayertrap / iswebbed / iswarded (game/trap.ts trapPredicates).
   * Absent (no trap system), those tests pass vacuously.
   */
  preds?: {
    isPlayerTrap: (grid: Loc) => boolean;
    isWebbed: (grid: Loc) => boolean;
    isWarded: (grid: Loc) => boolean;
  };
  /** z_info->monster_group_max (mon-gen:group-max, 25). */
  groupMax?: number;
  /** z_info->monster_group_dist (mon-gen:group-dist, 5). */
  groupDist?: number;
}

/** square_isopen on the live cave: floor with no occupant (player counts). */
export function squareIsOpenLive(state: GameState, grid: Loc): boolean {
  if (!state.chunk.inBounds(grid)) return false;
  return state.chunk.isFloor(grid) && state.chunk.mon(grid) === 0;
}

/** square_isempty on the live cave: open, no objects, no player trap / web. */
export function squareIsEmptyLive(
  state: GameState,
  grid: Loc,
  preds?: MonPlaceDeps["preds"],
): boolean {
  if (!state.chunk.inBounds(grid)) return false;
  if (preds?.isPlayerTrap(grid)) return false;
  if (preds?.isWebbed(grid)) return false;
  if (!squareIsOpenLive(state, grid)) return false;
  const pile = state.floor.get(grid.y * state.chunk.width + grid.x);
  return !pile || pile.length === 0;
}

/** square_allows_summon: empty and neither warded nor decoyed. */
export function squareAllowsSummon(
  state: GameState,
  grid: Loc,
  preds?: MonPlaceDeps["preds"],
): boolean {
  if (!squareIsEmptyLive(state, grid, preds)) return false;
  if (preds?.isWarded(grid)) return false;
  return !(state.decoy && locEq(state.decoy, grid));
}

/**
 * mon_pop + the placement bookkeeping of place_monster: put a constructed
 * monster into the first free slot (or a fresh one), mark its square, join
 * its group and count its race. Returns the midx.
 */
function placeMonsterLive(state: GameState, grid: Loc, mon: Monster): number {
  if (state.monsters.length === 0) state.monsters.push(null);
  let midx = 0;
  for (let i = 1; i < state.monsters.length; i++) {
    if (!state.monsters[i]) {
      midx = i;
      break;
    }
  }
  if (!midx) {
    midx = state.monsters.length;
    state.monsters.push(null);
  }
  mon.midx = midx;
  mon.grid = grid;
  state.monsters[midx] = mon;
  state.chunk.setMon(grid, midx);

  /* Assign monster to its monster group. */
  monsterGroupAssign(state, mon, mon.groupInfo, false);

  /* update_mon's distance bookkeeping (visibility rides FOV consumers). */
  mon.cdis = distance(grid, state.actor.grid);

  /* Count racial occurrences. */
  (mon.originalRace ?? mon.race).curNum++;

  return midx;
}

/**
 * place_new_monster_one on the live cave: legality checks, monster
 * construction (shared RNG order) and placement.
 */
export function placeNewMonsterOne(
  state: GameState,
  grid: Loc,
  race: MonsterRace,
  sleep: boolean,
  info: MonsterGroupInfo,
  deps: MonPlaceDeps,
): boolean {
  if (!state.chunk.inBounds(grid)) return false;

  /* Not where monsters already are. */
  if (squareMonster(state, grid)) return false;

  /* Not where the player already is. */
  if (locEq(state.actor.grid, grid)) return false;

  /* Prevent monsters from being placed where they cannot walk. */
  if (!state.chunk.isPassable(grid)) return false;

  /* No creation on glyphs or the decoy. */
  if (deps.preds?.isWarded(grid)) return false;
  if (state.decoy && locEq(state.decoy, grid)) return false;

  /* "unique" monsters must be "unique". */
  if (race.flags.has(RF.UNIQUE) && race.curNum >= race.maxNum) return false;

  /* Depth monsters may NOT be created out of depth. */
  if (race.flags.has(RF.FORCE_DEPTH) && state.chunk.depth < race.level) {
    return false;
  }

  const mon = createMonster(state.rng, race, {
    sleep,
    moveEnergy: state.z.moveEnergy,
    groupIndex: info.index,
    groupRole: info.role,
  });
  placeMonsterLive(state, grid, mon);
  return true;
}

/**
 * place_new_monster_group: puddle up to `total` monsters of one race around
 * grid, breadth first over the 8 neighbours of each placed monster.
 */
function placeNewMonsterGroup(
  state: GameState,
  grid: Loc,
  race: MonsterRace,
  sleep: boolean,
  info: MonsterGroupInfo,
  total: number,
  deps: MonPlaceDeps,
): boolean {
  total = Math.min(total, deps.groupMax ?? 25);

  /* Start on the monster. */
  const locList: Loc[] = [grid];

  /* Puddle monsters, breadth first, up to total. */
  for (let n = 0; n < locList.length && locList.length < total; n++) {
    for (let i = 0; i < 8 && locList.length < total; i++) {
      const tryGrid = locSum(locList[n] as Loc, DDGRID_DDD[i] as Loc);

      /* Walls and monsters block flow. */
      if (!squareIsEmptyLive(state, tryGrid, deps.preds)) continue;

      if (placeNewMonsterOne(state, tryGrid, race, sleep, info, deps)) {
        locList.push(tryGrid);
      }
    }
  }
  return true;
}

/** place_friends: place a friend or escort race near the original monster. */
function placeFriends(
  state: GameState,
  grid: Loc,
  race: MonsterRace,
  friendsRace: MonsterRace,
  total: number,
  sleep: boolean,
  info: MonsterGroupInfo,
  deps: MonPlaceDeps,
): boolean {
  /* Find the difference between current dungeon depth and monster level. */
  const levelDifference = state.chunk.depth - friendsRace.level + 5;

  /* Handle unique monsters. */
  const isUnique = friendsRace.flags.has(RF.UNIQUE);

  /* Make sure the unique hasn't been killed already. */
  if (isUnique && friendsRace.curNum >= friendsRace.maxNum) return false;

  /* More than 4 levels OoD, no groups allowed. */
  if (levelDifference <= 0 && !isUnique) return false;

  /* Reduce group size within 5 levels of natural depth. */
  if (levelDifference < 10 && !isUnique) {
    const extraChance = (total * levelDifference) % 10;
    total = Math.trunc((total * levelDifference) / 10);

    /* Instead of flooring the group value, we use the decimal place
     * as a chance of an extra monster. */
    if (state.rng.randint0(10) > extraChance) total += 1;
  }

  if (total > 0) {
    /* Handle friends same as original monster. */
    if (race.ridx === friendsRace.ridx) {
      return placeNewMonsterGroup(state, grid, race, sleep, info, total, deps);
    }

    /* Find a nearby place to put the other groups. */
    const spots = scatterExt(
      state.chunk,
      state.rng,
      1,
      grid,
      deps.groupDist ?? 5,
      false,
      (_c, gr) => squareIsOpenLive(state, gr),
    );
    if (spots.length > 0) {
      const start = spots[0] as Loc;
      /* Place the monsters. */
      let success = placeNewMonsterOne(state, start, friendsRace, sleep, info, deps);
      if (total > 1) {
        success = placeNewMonsterGroup(
          state,
          start,
          friendsRace,
          sleep,
          info,
          total,
          deps,
        );
      }
      return success;
    }
  }

  return false;
}

/**
 * monster_group_index_new: the next free group slot on the live state
 * (mon-group.ts owns the group model; this mirrors its allocator so the
 * pre-allocated index and the one monsterGroupStart picks agree).
 */
function nextGroupIndex(state: GameState): number {
  for (let i = 1; i < state.groups.length; i++) {
    if (!state.groups[i]) return i;
  }
  return Math.max(state.groups.length, 1);
}

/**
 * place_new_monster: place a monster of the given race at the given
 * location, with its friends and escorts when `groupOk` is set. The first
 * monster of a fresh group is its leader.
 */
export function placeNewMonster(
  state: GameState,
  grid: Loc,
  race: MonsterRace,
  sleep: boolean,
  groupOk: boolean,
  groupInfo: MonsterGroupInfo,
  deps: MonPlaceDeps,
): boolean {
  const info: MonsterGroupInfo = { ...groupInfo };

  /* If we don't have a group index already, make one; our first monster
   * will be the leader. */
  if (!info.index) info.index = nextGroupIndex(state);

  /* Place one monster, or fail. */
  if (!placeNewMonsterOne(state, grid, race, sleep, info, deps)) return false;

  /* We're done unless the group flag is set. */
  if (!groupOk) return true;

  /* Go through friends flags. */
  for (const friends of race.friends) {
    if (state.rng.randint0(100) >= friends.percentChance) continue;

    /* Calculate the base number of monsters to place. */
    const total = state.rng.damroll(friends.numberDice, friends.numberSide);

    /* Set group role. */
    info.role = friends.role;

    /* Place them. */
    if (friends.race) {
      placeFriends(state, grid, race, friends.race, total, sleep, info, deps);
    }
  }

  /* Go through the friends_base flags. */
  for (const friendsBase of race.friendsBase) {
    /* Check if we pass chance for the monster appearing. */
    if (state.rng.randint0(100) >= friendsBase.percentChance) continue;

    const total = state.rng.damroll(
      friendsBase.numberDice,
      friendsBase.numberSide,
    );

    /* Prepare allocation table for the escort base (no uniques). */
    deps.table.prep(
      (r) => r.base === friendsBase.base && !r.flags.has(RF.UNIQUE),
    );

    /* Pick a random race, then reset the allocation table. */
    const friendsRace = deps.table.getMonNum(
      state.rng,
      race.level,
      state.chunk.depth,
    );
    deps.table.prep(null);

    /* Handle failure. */
    if (!friendsRace) break;

    /* Set group role. */
    info.role = friendsBase.role;

    /* Place them. */
    placeFriends(state, grid, race, friendsRace, total, sleep, info, deps);
  }

  return true;
}

/** pick_and_place_monster: place an appropriate monster (and group) at grid. */
export function pickAndPlaceMonster(
  state: GameState,
  grid: Loc,
  depth: number,
  sleep: boolean,
  groupOkay: boolean,
  deps: MonPlaceDeps,
): boolean {
  const race = deps.table.getMonNum(state.rng, depth, state.chunk.depth);
  if (!race) return false;
  const info: MonsterGroupInfo = { index: 0, role: MON_GROUP.LEADER };
  return placeNewMonster(state, grid, race, sleep, groupOkay, info, deps);
}

/**
 * pick_and_place_distant_monster (mon-make.c L1483): pick a monster race and
 * place it on a naked floor grid at least `dis` away from `toAvoid`, allowing
 * groups. Up to 10000 attempts, each drawing randint0(width) THEN
 * randint0(height) (x before y - a chosen canonical order; C leaves the two
 * argument evaluations unspecified and the port targets its own save
 * determinism, not binary C-save compatibility). In a running game
 * character_dungeon is true, so the "no random monsters in marked rooms" test
 * is skipped. Returns whether a monster was placed.
 */
export function pickAndPlaceDistantMonster(
  state: GameState,
  toAvoid: Loc,
  dis: number,
  sleep: boolean,
  depth: number,
  deps: MonPlaceDeps,
): boolean {
  let grid: Loc = toAvoid;
  let attemptsLeft = 10000;

  /* Find a legal, distant, unoccupied space. */
  while (--attemptsLeft) {
    /* Pick a location (x drawn before y). */
    const x = state.rng.randint0(state.chunk.width);
    const y = state.rng.randint0(state.chunk.height);
    grid = { x, y };

    /* Require "naked" floor grid. */
    if (!squareIsEmptyLive(state, grid, deps.preds)) continue;

    /* Accept far away grids. */
    if (distance(grid, toAvoid) > dis) break;
  }

  if (!attemptsLeft) return false;

  /* Attempt to place the monster, allow groups. */
  return pickAndPlaceMonster(state, grid, depth, sleep, true, deps);
}

/* ------------------------------------------------------------------ *
 * mon-summon.c world half.
 * ------------------------------------------------------------------ */

/** Everything summon_specific needs beyond the placement deps. */
export interface SummonDeps extends MonPlaceDeps {
  /** The bound summon table (mon/summon.ts). */
  summons: SummonTable;
  /** cave->mon_current: the summoner, whose group summons join (0 = none). */
  monCurrent?: number;
  /** The kin base for S_KIN (the summoner's race base). */
  kinBase?: MonsterBase | null;
}

/**
 * can_call_monster: alive, eligible for the summon type, and NOT in line
 * of sight of the summon point.
 */
function canCallMonster(
  state: GameState,
  grid: Loc,
  mon: Monster,
  type: number,
  deps: SummonDeps,
): boolean {
  if (!summonSpecificOkay(deps.summons, type, mon.race, deps.kinBase ?? null)) {
    return false;
  }
  return !los(state.chunk, grid, mon.grid);
}

/**
 * call_monster: move an eligible off-screen monster to the summon point,
 * wake it and zero its energy. Returns its race level, or 0.
 */
function callMonster(
  state: GameState,
  grid: Loc,
  type: number,
  deps: SummonDeps,
): number {
  const eligible: number[] = [];
  const max = monsterMax(state);
  for (let i = 1; i < max; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (canCallMonster(state, grid, mon, type, deps)) eligible.push(i);
  }

  /* There were no good monsters on the level. */
  if (eligible.length === 0) return 0;

  /* Pick one (upstream rolls randint0(count - 1), quirk preserved). */
  const choice = state.rng.randint0(eligible.length - 1);
  const mon = state.monsters[eligible[choice] as number] as Monster;

  /* Swap the monster. */
  monsterSwap(state, mon.grid, grid);

  /* Wake it up, make it aware. */
  monsterWake(state.rng, mon, false, 100);

  /* Set its energy to 0. */
  mon.energy = 0;

  return mon.race.level;
}

/**
 * summon_specific: place a monster of the given summon type near the grid,
 * trying progressively wider scatters (1..4). Returns the summoned
 * monster's race level iff a monster was actually summoned.
 */
export function summonSpecific(
  state: GameState,
  grid: Loc,
  lev: number,
  type: number,
  delay: boolean,
  call: boolean,
  deps: SummonDeps,
): number {
  /* Look for a location, allow up to 4 squares away. */
  let near: Loc | null = null;
  for (let d = 1; d < 5; d++) {
    const found = scatterExt(state.chunk, state.rng, 1, grid, d, true, (_c, g) =>
      squareAllowsSummon(state, g, deps.preds),
    );
    if (found.length > 0) {
      near = found[0] as Loc;
      break;
    }
  }

  /* Failure. */
  if (!near) return 0;

  /* Use the new calling scheme if requested. */
  if (
    call &&
    type !== deps.summons.nameToIdx("UNIQUE") &&
    type !== deps.summons.nameToIdx("WRAITH")
  ) {
    return callMonster(state, near, type, deps);
  }

  /* Prepare allocation table. */
  deps.table.prep((race) =>
    summonSpecificOkay(deps.summons, type, race, deps.kinBase ?? null),
  );

  /* Pick a monster, using the level calculation. */
  const race = deps.table.getMonNum(
    state.rng,
    Math.trunc((state.chunk.depth + lev) / 2) + 5,
    state.chunk.depth,
  );

  /* Prepare allocation table. */
  deps.table.prep(null);

  /* Handle failure. */
  if (!race) return 0;

  /* Put summons in the group of any summoner. */
  const info: MonsterGroupInfo = { index: 0, role: MON_GROUP.MEMBER };
  if (deps.monCurrent && deps.monCurrent > 0) {
    const group = summonGroup(state, deps.monCurrent);
    if (group) {
      info.index = group.index;
      info.role = MON_GROUP.SUMMON as MonsterGroupRole;
    }
  }

  /* Attempt to place the monster (awake, don't allow groups). */
  if (!placeNewMonster(state, near, race, false, false, info, deps)) return 0;

  /* Success: the monster is on the summon grid. */
  const mon = squareMonster(state, near) as Monster;

  /* If delay, try to let the player act before the summoned monsters,
   * including holding faster monsters for the required number of turns. */
  if (delay) {
    const pEPerTurn = turnEnergy(state.actor.speed, state.z.moveEnergy);
    const mEPerTurn = turnEnergy(mon.mspeed, state.z.moveEnergy);
    /*
     * Number of turns for the player to move from zero energy is
     * move_energy / p_e_per_turn; for the monster, move_energy /
     * m_e_per_turn. Hold the monster for the difference, rounding up.
     */
    const turns = Math.trunc(
      (state.z.moveEnergy * (mEPerTurn - pEPerTurn) + mEPerTurn * pEPerTurn - 1) /
        (mEPerTurn * pEPerTurn),
    );

    mon.energy = 0;
    if (turns > 0) {
      /* Set timer directly to avoid resistance. */
      mon.mTimed[MON_TMD.HOLD] = Math.min(turns, 32767);
    }
  }

  return mon.race.level;
}

/**
 * select_shape: a race for a monster shapechange, drawn from the summon
 * type's eligible races at the current depth (+5).
 */
export function selectShape(
  state: GameState,
  type: number,
  deps: SummonDeps,
): MonsterRace | null {
  deps.table.prep((race) =>
    summonSpecificOkay(deps.summons, type, race, deps.kinBase ?? null),
  );
  const race = deps.table.getMonNum(
    state.rng,
    state.chunk.depth + 5,
    state.chunk.depth,
  );
  deps.table.prep(null);
  return race;
}

/**
 * wipe_mon_list's racial-count half: forget every live monster's racial
 * occurrence before the level's monster list is discarded. The session's
 * level change calls this so cur_num stays balanced across levels.
 */
export function wipeMonsterCounts(state: GameState): void {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    const race = mon.originalRace ?? mon.race;
    if (race.curNum > 0) race.curNum--;
  }
}

/** Re-count racial occurrences from a freshly populated monster list. */
export function countMonsterRaces(state: GameState): void {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (mon) (mon.originalRace ?? mon.race).curNum++;
  }
}
