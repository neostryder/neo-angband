/**
 * Monster allocation and creation, ported from reference/src/mon-make.c
 * (Angband 4.2.6).
 *
 * Ported here: the race allocation table (init_race_allocs), restriction
 * hooks (get_mon_num_prep), depth-ruled picking (get_mon_num), hp
 * calculation (mon_hp), and the monster-instance construction half of
 * place_new_monster_one. Actual placement into a chunk (square checks,
 * level rating, drops, mimicked objects, groups/friends spawning) is
 * deferred to the world integration; see parity/ledger/mon-make.yaml.
 *
 * Upstream notes preserved:
 * - Town monsters (level 0) are only picked when generated_level is 0,
 *   and never in the dungeon; dungeon monsters never appear in town
 *   because entries above generated_level are cut off.
 * - get_mon_num boosts generated_level 1 time in ood_monster_chance by
 *   min(level / 4 + 2, ood_monster_amount), then rerolls for a deeper
 *   race once at 60 percent or twice at 10 percent.
 * - SEASONAL races only allocate around Christmas; this port takes that
 *   as an option instead of reading the wall clock.
 * - Uniques allocate only while cur_num < max_num; FORCE_DEPTH races
 *   never allocate above their native depth (checked against the level
 *   the monster is placed on, not the generation level).
 */

import type { Rng } from "../rng";
import type { Aspect } from "../rng";
import { ORIGIN, RF } from "../generated";
import { MON_TMD } from "../generated";
import type { MonsterGroupRole, MonsterRace } from "./types";
import { MON_GROUP } from "./types";
import type { Monster } from "./monster";
import { blankMonster, GROUP_TYPE, turnEnergy } from "./monster";
import { MFLAG } from "../generated";
import type { GameObject, StackLimits } from "../obj/object";
import { objectAbsorb, objectMergeable, OSTACK_MONSTER } from "../obj/object";

/** BASIC_COLORS from z-color.h, for ATTR_RAND rolls. */
const BASIC_COLORS = 29;

/** One row of the allocation table (alloc_entry for races). */
export interface MonAllocEntry {
  /** ridx of the race. */
  index: number;
  level: number;
  /** Base probability from rarity and depth factor. */
  prob1: number;
  /** prob1 gated by the get_mon_num_prep hook. */
  prob2: number;
  /** prob2 gated by get_mon_num's universal rules (stateful, as upstream). */
  prob3: number;
}

export interface MonAllocOptions {
  /** z_info->max_depth (constants.txt world:max-depth, 128). */
  maxDepth?: number;
  /** z_info->ood_monster_chance (mon-gen:ood-chance, 25). */
  oodChance?: number;
  /** z_info->ood_monster_amount (mon-gen:ood-amount, 10). */
  oodAmount?: number;
  /** Whether SEASONAL races may allocate (upstream: Dec 24-26). */
  seasonalAllowed?: boolean;
}

/**
 * The monster allocation table (init_race_allocs + get_mon_num_prep +
 * get_mon_num). Races are grouped by level ascending, stable by ridx,
 * exactly like the upstream counting sort.
 */
export class MonAllocTable {
  readonly entries: MonAllocEntry[];
  private readonly races: MonsterRace[];
  private readonly oodChance: number;

  /**
   * Full race table (index 0 is the <player> placeholder). Exposed so callers
   * that need the raw r_info array for mon_restrict("random") - e.g.
   * get_chamber_monsters - can reuse the table's races without re-threading a
   * separate array through MonPlaceDeps.
   */
  get allRaces(): MonsterRace[] {
    return this.races;
  }
  private readonly oodAmount: number;
  private readonly seasonalAllowed: boolean;

  constructor(races: MonsterRace[], options: MonAllocOptions = {}) {
    const maxDepth = options.maxDepth ?? 128;
    this.oodChance = options.oodChance ?? 25;
    this.oodAmount = options.oodAmount ?? 10;
    this.seasonalAllowed = options.seasonalAllowed ?? false;
    this.races = races;

    /*
     * init_race_allocs: scan races skipping index 0 (the <player>
     * placeholder record, which has no rarity anyway) and keep only
     * races with a rarity. Upstream also skips the trailing player
     * ghost slot, which this port does not allocate at all.
     */
    const legal: MonsterRace[] = [];
    for (let i = 1; i < races.length; i++) {
      const race = races[i] as MonsterRace;
      if (!race.rarity) continue;
      if (race.level >= maxDepth) {
        throw new Error(
          `mon: race ${race.name} level ${race.level} outside max depth`,
        );
      }
      legal.push(race);
    }
    /* Counting sort by level is stable within a level. */
    legal.sort((a, b) => (a.level !== b.level ? a.level - b.level : a.ridx - b.ridx));

    this.entries = legal.map((race) => {
      /* p = (100 / rarity) * (1 + lev / 10), C integer division. */
      const p =
        Math.trunc(100 / race.rarity) * (1 + Math.trunc(race.level / 10));
      return {
        index: race.ridx,
        level: race.level,
        prob1: p,
        prob2: p,
        prob3: p,
      };
    });
  }

  /**
   * get_mon_num_prep: apply a restriction hook; prob2 becomes prob1 for
   * accepted races and 0 otherwise. Pass null to clear the restriction.
   */
  prep(hook: ((race: MonsterRace) => boolean) | null): void {
    for (const entry of this.entries) {
      const race = this.races[entry.index] as MonsterRace;
      entry.prob2 = !hook || hook(race) ? entry.prob1 : 0;
    }
  }

  /** get_mon_race_aux: weighted pick over prob3. */
  private pickAux(rng: Rng, total: number): MonsterRace {
    let value = rng.randint0(total);
    let i = 0;
    for (; i < this.entries.length; i++) {
      const entry = this.entries[i] as MonAllocEntry;
      if (value < entry.prob3) break;
      value -= entry.prob3;
    }
    const entry = this.entries[Math.min(i, this.entries.length - 1)];
    return this.races[(entry as MonAllocEntry).index] as MonsterRace;
  }

  /**
   * get_mon_num: choose a race appropriate to generatedLevel, applying
   * the universal restrictions against currentLevel (the level the
   * monster will be placed on). Returns null when no race is legal.
   */
  getMonNum(
    rng: Rng,
    generatedLevel: number,
    currentLevel: number,
  ): MonsterRace | null {
    /* Occasionally produce a nastier monster in the dungeon. */
    if (generatedLevel > 0 && rng.oneIn(this.oodChance)) {
      generatedLevel += Math.min(
        Math.trunc(generatedLevel / 4) + 2,
        this.oodAmount,
      );
    }

    let total = 0;
    for (const entry of this.entries) {
      /* Monsters are sorted by depth. */
      if (entry.level > generatedLevel) break;

      entry.prob3 = 0;

      /* No town monsters in the dungeon. */
      if (generatedLevel > 0 && entry.level <= 0) continue;

      const race = this.races[entry.index] as MonsterRace;

      /* No seasonal monsters outside of Christmas. */
      if (race.flags.has(RF.SEASONAL) && !this.seasonalAllowed) continue;

      /* Only one copy of a unique at a time (and none once dead). */
      if (race.flags.has(RF.UNIQUE) && race.curNum >= race.maxNum) continue;

      /* Some monsters never appear out of depth. */
      if (race.flags.has(RF.FORCE_DEPTH) && race.level > currentLevel) {
        continue;
      }

      entry.prob3 = entry.prob2;
      total += entry.prob3;
    }

    if (total <= 0) return null;

    let race = this.pickAux(rng, total);

    /* Try for a harder monster once (50%) or twice (10%). */
    const p = rng.randint0(100);
    if (p < 60) {
      const old = race;
      race = this.pickAux(rng, total);
      if (race.level < old.level) race = old;
    }
    if (p < 10) {
      const old = race;
      race = this.pickAux(rng, total);
      if (race.level < old.level) race = old;
    }

    return race;
  }
}

/**
 * mon_hp: hp for a race by aspect. Uniques are handled by the caller
 * (they always get avg_hp); this is the raw calculation.
 */
export function monHp(race: MonsterRace, hpAspect: Aspect, rng?: Rng): number {
  let stdDev = Math.trunc((Math.trunc((race.avgHp * 10) / 8) + 5) / 10);
  if (race.avgHp > 1) stdDev++;

  switch (hpAspect) {
    case "minimise":
      return race.avgHp - 4 * stdDev;
    case "maximise":
    case "extremify":
      return race.avgHp + 4 * stdDev;
    case "average":
      return race.avgHp;
    case "randomise":
      if (!rng) throw new Error("monHp: randomise needs an rng");
      return rng.randNormal(race.avgHp, stdDev);
  }
}

export interface CreateMonsterOptions {
  /** Place asleep with the race's default sleep value (default true). */
  sleep?: boolean;
  /** Primary group assignment. */
  groupIndex?: number;
  groupRole?: MonsterGroupRole;
  /** z_info->move_energy for the speed-variation roll (default 100). */
  moveEnergy?: number;
}

/**
 * The monster-construction half of place_new_monster_one: builds a fully
 * initialized Monster instance for a race. RNG call order matches
 * upstream (sleep, hp, speed variation, energy, random attr) so seeded
 * streams stay comparable. Placement into a chunk is deferred.
 */
export function createMonster(
  rng: Rng,
  race: MonsterRace,
  options: CreateMonsterOptions = {},
): Monster {
  const sleep = options.sleep ?? true;
  const mon = blankMonster(race);
  const unique = race.flags.has(RF.UNIQUE);

  /* Enforce sleeping if needed. */
  if (sleep && race.sleep) {
    const val = race.sleep;
    mon.mTimed[MON_TMD.SLEEP] = val * 2 + rng.randint1(val * 10);
  }

  /* Uniques get a fixed amount of HP. */
  if (unique) {
    mon.maxhp = race.avgHp;
  } else {
    mon.maxhp = Math.max(monHp(race, "randomise", rng), 1);
  }
  mon.hp = mon.maxhp;

  /* Extract the monster base speed, with small racial variety. */
  mon.mspeed = race.speed;
  if (!unique) {
    const i = Math.trunc(turnEnergy(race.speed, options.moveEnergy) / 10);
    if (i) mon.mspeed += rng.randSpread(0, i);
  }

  /* Give a random starting energy. */
  mon.energy = rng.randint0(50);

  /* Force monster to wait for player. */
  if (race.flags.has(RF.FORCE_SLEEP)) mon.mflag.on(MFLAG.NICE);

  /* Is this obviously a monster? (Mimics etc. are not.) */
  if (race.flags.has(RF.UNAWARE)) {
    mon.mflag.on(MFLAG.CAMOUFLAGE);
  } else {
    mon.mflag.off(MFLAG.CAMOUFLAGE);
  }

  /* Set the color if necessary. */
  if (race.flags.has(RF.ATTR_RAND)) {
    mon.attr = rng.randint1(BASIC_COLORS - 1);
  }

  /* Set the primary group info. */
  const info = mon.groupInfo[GROUP_TYPE.PRIMARY];
  if (info) {
    info.index = options.groupIndex ?? 0;
    info.role = options.groupRole ?? MON_GROUP.MEMBER;
  }

  return mon;
}

/* ------------------------------------------------------------------ */
/* Drops (mon_create_drop_count) and held objects (monster_carry)       */
/* ------------------------------------------------------------------ */

/** drop_4_max / drop_3_max / drop_2_max (mon-make.c L704-706). */
const DROP_4_MAX = 6;
const DROP_3_MAX = 4;
const DROP_2_MAX = 3;

/**
 * mon_create_drop_count (mon-make.c L699): how many generic drops a race
 * yields from its RF_DROP_* flags, plus (optionally) its specified-drop
 * count. `maximize` returns the maximum instead of a random roll (the lore
 * display path); `specific` folds the specified-drop count into the returned
 * `number`. `specificCount` is always the (random or maximum) specified-drop
 * total, so callers that need the two separately (lore display) can read it.
 *
 * CRITICAL (mon-make.c L728-734): in the non-maximize branch the specified-drop
 * loop draws RNG - randint0(100), then randint0(max-min) when it passes - for
 * EVERY race.drops entry, even though the resulting specnum is discarded when
 * specific=false. mon_create_drop calls this with specific=false but the draws
 * still happen; omitting them desyncs every later draw. Kept faithfully below.
 */
export function monCreateDropCount(
  rng: Rng,
  race: MonsterRace,
  maximize: boolean,
  specific: boolean,
): { number: number; specificCount: number } {
  let number = 0;
  let specnum = 0;

  if (maximize) {
    if (race.flags.has(RF.DROP_20)) number++;
    if (race.flags.has(RF.DROP_40)) number++;
    if (race.flags.has(RF.DROP_60)) number++;
    if (race.flags.has(RF.DROP_4)) number += DROP_4_MAX;
    if (race.flags.has(RF.DROP_3)) number += DROP_3_MAX;
    if (race.flags.has(RF.DROP_2)) number += DROP_2_MAX;
    if (race.flags.has(RF.DROP_1)) number++;
    for (const drop of race.drops) specnum += drop.max;
  } else {
    if (race.flags.has(RF.DROP_20) && rng.randint0(100) < 20) number++;
    if (race.flags.has(RF.DROP_40) && rng.randint0(100) < 40) number++;
    if (race.flags.has(RF.DROP_60) && rng.randint0(100) < 60) number++;
    if (race.flags.has(RF.DROP_4)) number += rng.randRange(2, DROP_4_MAX);
    if (race.flags.has(RF.DROP_3)) number += rng.randRange(2, DROP_3_MAX);
    if (race.flags.has(RF.DROP_2)) number += rng.randRange(1, DROP_2_MAX);
    if (race.flags.has(RF.DROP_1)) number++;
    for (const drop of race.drops) {
      if (rng.randint0(100) < drop.percentChance) {
        specnum += rng.randint0(drop.max - drop.min) + drop.min;
      }
    }
  }

  if (specific) number += specnum;
  return { number, specificCount: specnum };
}

/**
 * OSTACK_MONSTER stacking never reads the quiver limits (only OSTACK_QUIVER
 * does), so any values work; these are the shipped constants.txt quiver
 * numbers for consistency with floor.ts.
 */
const MON_STACK_LIMITS: StackLimits = { quiverSlotSize: 40, thrownQuiverMult: 5 };

/**
 * monster_carry (mon-util.c L1368): give an object to a monster's held pile.
 * Merges into a compatible held stack when possible (object_absorb), otherwise
 * forgets the object's location and prepends it (pile_insert) so `pile[0]` is
 * the newest held object, matching the upstream head-first held_obj list.
 *
 * The port's held pile is the GameObject[] on Monster.heldObj (head-first);
 * the chunk-side list_object / known-object bookkeeping of upstream rides the
 * knowledge subsystem and is not modelled here.
 */
export function monsterCarry(
  pile: GameObject[],
  obj: GameObject,
  midx: number,
): void {
  /* Scan objects already being held for combination. */
  for (const held of pile) {
    if (objectMergeable(held, obj, OSTACK_MONSTER, MON_STACK_LIMITS)) {
      objectAbsorb(held, obj, ORIGIN.MIXED);
      return;
    }
  }

  /* Forget location; link the object to the monster; prepend to the pile. */
  obj.grid = null;
  obj.heldMIdx = midx;
  pile.unshift(obj);
}
