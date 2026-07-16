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
 * DEFERRED (ledgered in parity/ledger/game-mon-place.yaml): placement-time
 * monster drops (mon_create_drop) - the drops are instead generated at death
 * in game/mon-death.ts (an accepted RNG-stream deviation documented there),
 * so no held pile is populated here; the cheat_hear messages are UI-only;
 * update_mon / monster-light view refresh rides the FOV consumers.
 *
 * Object-mimic placement (mon_create_mimicked_object) IS ported here and
 * fires from placeMonsterLive for live-placed (summoned / bred) mimics when
 * the caller supplies MonPlaceDeps.mimic. SEAM: generation-spawned mimics are
 * built by gen/util.ts and installed by session/game.ts populateFromLevel,
 * neither of which yet calls monCreateMimickedObject (nor threads the
 * object-make deps), so generated object-mimics still spawn with
 * mon.mimickedObj = 0 until that handoff is wired.
 *
 * add_to_monster_rating IS wired here (mon-make.c L1112-1126), matching
 * upstream's single place_new_monster_one for both generation and live
 * summons/breeders. Since chunk.feeling is computed once at gen-end
 * (gen/generate.ts generateLevel) and never recomputed, these post-gen
 * accumulations are harmless bookkeeping: they keep chunk.mon_rating byte-
 * faithful to upstream but have no effect on an already-shown feeling.
 */

import { MON_TMD, ORIGIN, RF } from "../generated";
import type { Rng } from "../rng";
import type { Loc } from "../loc";
import { DDGRID_DDD, distance, locEq, locSum } from "../loc";
import type { MonsterBase, MonsterGroupRole, MonsterRace } from "../mon/types";
import { MON_GROUP } from "../mon/types";
import type { Monster, MonsterGroupInfo } from "../mon/monster";
import { turnEnergy } from "../mon/monster";
import { createMonster, monsterCarry } from "../mon/make";
import type { MonAllocTable } from "../mon/make";
import { monsterIsCamouflaged, monsterIsShapeUnique } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import type { SummonTable } from "../mon/summon";
import { summonSpecificOkay } from "../mon/summon";
import { applyMagic, makeGold, objectPrep } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { tvalIsMoney } from "../obj/object";
import type { GameObject } from "../obj/object";
import { tvalFindIdx } from "../obj/bind";
import type { ObjectKind } from "../obj/types";
import { scatterExt } from "../world/scatter";
import { los } from "../world/view";
import { monsterMax, monsterSwap, squareMonster } from "./context";
import type { GameState } from "./context";
import { floorCarry } from "./floor";
import type { FloorEnv } from "./floor";
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
  /**
   * Object-make deps for mon_create_mimicked_object (mon-make.c L899). Absent
   * (worldless / monster-only harnesses, and every current caller until the
   * generation-handoff seam is wired), object-mimics are placed as bare
   * monsters with no fake item - exactly the pre-mimic behaviour - and
   * mon.mimickedObj stays 0.
   */
  mimic?: MimicDeps;
}

/** Everything mon_create_mimicked_object needs beyond the state and monster. */
export interface MimicDeps {
  /** Object-make deps (makeGold / objectPrep / applyMagic share the RNG). */
  makeDeps: MakeDeps;
  /** floor_carry env (ignore / stacking hooks); defaults to inert. */
  floorEnv?: FloorEnv;
}

/**
 * The minimal, GameState-free surface mon_create_mimicked_object needs so BOTH
 * the live cave (this module) and level generation (gen/util.ts) can build a
 * mimic's fake object off the same code. The two paths differ only in how the
 * object is carried: the live path calls floor_carry on the running state; the
 * generation path parks it on the Gen side-table that populateFromLevel later
 * re-carries. Neither carry draws RNG, so the object's draws (reservoir sample
 * + make_gold / object_prep + apply_magic) land at the same stream position on
 * either path.
 */
export interface MimicTarget {
  /** c->depth: the depth make_gold / origin_depth read. */
  depth: number;
  /** The stream to draw from (live state.rng or generation g.rng). */
  rng: Rng;
  /** make_gold / object_prep / apply_magic dependencies. */
  makeDeps: MakeDeps;
  /** floor_carry(c, mon->grid, obj): put obj at grid, true iff it went. */
  carry: (grid: Loc, obj: GameObject) => boolean;
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
function placeMonsterLive(
  state: GameState,
  grid: Loc,
  mon: Monster,
  deps: MonPlaceDeps,
): number {
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

  /* Count the number of "reproducers" (mon-make.c L1038): current race flag. */
  if (mon.race.flags.has(RF.MULTIPLY)) {
    state.numRepro = (state.numRepro ?? 0) + 1;
  }

  /* Count racial occurrences. */
  (mon.originalRace ?? mon.race).curNum++;

  /* Make mimics start mimicking (mon-make.c place_monster L1048-1051). The
   * upstream origin gate is implicit here: every live placement carries an
   * origin (ORIGIN_DROP etc.), and generated mimics ride the generation
   * handoff seam. mon_create_drop (L1044-1046) is deferred to death (module
   * docstring); object-mimic races carry no RF_DROP_* / drops in vanilla, so
   * its RNG draws would be zero at this point - the mimic object's draws land
   * at the same stream position as upstream for every mimic race. Inert unless
   * the caller supplies object-make deps. */
  if (deps.mimic && mon.race.mimicKinds.length > 0) {
    monCreateMimickedObject(state, mon, deps.mimic);
  }

  return midx;
}

/**
 * mon_create_mimicked_object (mon-make.c L899): create the fake floor item an
 * object-mimic imitates and link it to the monster. Reservoir-samples one of
 * the race's mimic_kinds (one_in_(i) over i = 1..n; the first draw, one_in_(1),
 * draws no RNG and always selects the first kind), makes a gold object for a
 * money kind or a prepped-and-magicked item otherwise (RNG order identical to
 * upstream), links both sides of the mimicry, and drops it on the monster's
 * grid via floor_carry. If the floor cannot hold it the mimicry is cleared and
 * the item is either given to the monster (RF_MIMIC_INV) or discarded.
 *
 * The port has no object oidx registry, so mon.mimickedObj is a nonzero
 * presence marker (1); the live mon<->obj link is carried by
 * obj.mimickingMIdx === mon.midx, which is what become_aware reads and the save
 * format persists. C's list_object (oidx bookkeeping) is DEFERRED with the
 * floor object list (game/floor.ts module docs). convert_depth_to_origin(
 * c->depth) is the port's direct state.chunk.depth (matching mon-death.ts /
 * effect-item.ts). Draws RNG exactly as upstream.
 */
export function createMimickedObject(target: MimicTarget, mon: Monster): void {
  const { reg, constants } = target.makeDeps;

  /* Resolve a MonsterMimic (tval/sval names) to an object kind. Upstream
   * resolves these to object_kind pointers at parse time; the port stores the
   * names (mon/bind.ts) and looks them up here. */
  const resolveKind = (m: { tval: string; sval: string }): ObjectKind => {
    const tval = tvalFindIdx(m.tval);
    const sval = tval >= 0 ? reg.lookupSval(tval, m.sval) : -1;
    const kind = tval >= 0 ? reg.lookupKind(tval, sval) : null;
    if (!kind) throw new Error(`mon: mimic kind ${m.tval}:${m.sval} not found`);
    return kind;
  };

  /* Pick a random object kind to mimic (reservoir sample, i starts at 1). */
  const kinds = mon.race.mimicKinds;
  let kind = resolveKind(kinds[0] as { tval: string; sval: string });
  let i = 1;
  for (const mk of kinds) {
    if (target.rng.oneIn(i)) kind = resolveKind(mk);
    i++;
  }

  let obj: GameObject;
  if (tvalIsMoney(kind.tval)) {
    obj = makeGold(target.rng, target.makeDeps, target.depth, kind.name);
  } else {
    obj = objectPrep(
      target.rng,
      reg,
      constants,
      kind,
      mon.race.level,
      "randomise",
    );
    applyMagic(
      target.rng,
      target.makeDeps,
      obj,
      mon.race.level,
      true,
      false,
      false,
      false,
      target.depth,
    );
    obj.number = 1;
    obj.origin = ORIGIN.DROP_MIMIC;
    obj.originDepth = target.depth;
  }

  obj.mimickingMIdx = mon.midx;
  mon.mimickedObj = 1;

  /* Put the object on the floor if it goes, otherwise no mimicry. */
  if (target.carry(mon.grid, obj)) {
    /* list_object: oidx bookkeeping DEFERRED (game/floor.ts). */
  } else {
    /* Clear the mimicry. */
    obj.mimickingMIdx = 0;
    mon.mimickedObj = 0;

    if (mon.race.flags.has(RF.MIMIC_INV)) {
      /* Give the object to the monster if appropriate. */
      monsterCarry(mon.heldObj, obj, mon.midx);
    }
    /* Otherwise object_delete: drop the reference (no pile to excise). */
  }
}

/**
 * Live-cave mon_create_mimicked_object: a thin wrapper that binds the running
 * GameState to the shared, GameState-free createMimickedObject core. The carry
 * is the live floor_carry (no RNG), so this stays byte- and RNG-identical to
 * the pre-refactor function for every live-placed mimic.
 */
export function monCreateMimickedObject(
  state: GameState,
  mon: Monster,
  deps: MimicDeps,
): void {
  createMimickedObject(
    {
      depth: state.chunk.depth,
      rng: state.rng,
      makeDeps: deps.makeDeps,
      carry: (grid, obj) => floorCarry(state, grid, obj, deps.floorEnv),
    },
    mon,
  );
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

  /* Add to level feeling, note uniques for cheaters (mon-make.c
   * L1112-1126). See the module docstring: harmless post-gen bookkeeping. */
  state.chunk.addToMonsterRating(race.level * race.level);
  if (race.level > state.chunk.depth) {
    state.chunk.addToMonsterRating(
      (race.level - state.chunk.depth) * race.level * race.level,
    );
  }

  const mon = createMonster(state.rng, race, {
    sleep,
    moveEnergy: state.z.moveEnergy,
    groupIndex: info.index,
    groupRole: info.role,
  });
  placeMonsterLive(state, grid, mon, deps);
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

/**
 * multiply_monster (mon-make.c L983): a breeder tries to spawn a copy of
 * itself in a nearby empty grid. Returns true on a successful spawn.
 *
 * RNG order is preserved exactly: monster_is_shape_unique short-circuits
 * before any draw (uniques never multiply and never touch the stream), then
 * scatter_ext draws (distance 1, needs LOS, square_isempty), then
 * place_new_monster (groupOk = false, so no friends/escort table draws - only
 * createMonster's sleep/hp/speed/energy/attr draws). Fixing so multiplying a
 * revealed camouflaged monster creates another revealed camouflaged monster
 * (mon-move.c L1002-1011) draws no RNG - it just looks up the child that was
 * placed a moment ago via square_monster, exactly as upstream does.
 */
export function multiplyMonster(
  state: GameState,
  mon: Monster,
  deps: MonPlaceDeps,
): boolean {
  /* Uniques can never multiply - tested before any RNG is drawn. */
  if (monsterIsShapeUnique(mon)) return false;

  /* Pick an empty location adjacent to the breeder. */
  const spots = scatterExt(
    state.chunk,
    state.rng,
    1,
    mon.grid,
    1,
    true,
    (_c, g) => squareIsEmptyLive(state, g, deps.preds),
  );
  if (spots.length === 0) return false;

  /* Create a new monster (awake, no groups). */
  const info: MonsterGroupInfo = { index: 0, role: MON_GROUP.LEADER };
  const grid = spots[0] as Loc;
  const result = placeNewMonster(state, grid, mon.race, false, false, info, deps);

  if (result) {
    const child = squareMonster(state, grid);
    if (child && monsterIsCamouflaged(child) && !monsterIsCamouflaged(mon)) {
      state.becomeAware?.(child);
    }
  }

  return result;
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

/**
 * Re-count racial occurrences from a freshly populated monster list, and
 * rebuild cave->num_repro (mon-make.c wipe_mon_list sets it to 0 at wipe; the
 * generated / loaded breeders are counted here so the reproduction cap sees
 * every RF_MULTIPLY monster on the level, not only mid-game arrivals).
 */
export function countMonsterRaces(state: GameState): void {
  state.numRepro = 0;
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    (mon.originalRace ?? mon.race).curNum++;
    if (mon.race.flags.has(RF.MULTIPLY)) state.numRepro++;
  }
}
