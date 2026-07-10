/**
 * Monster lore (memory), ported from the engine half of
 * reference/src/mon-lore.c (Angband 4.2.6): the per-race knowledge record
 * (upstream l_list), the observation counters combat and the AI increment,
 * the lore_learn_* helpers, lore_update's derived known fields, probing,
 * the fully-known test and the treasure observation.
 *
 * The recall text generation (lore_append_* over textblocks, spell/blow
 * colors) is the monster recall screen and rides presentation (#25); this
 * module is the complete knowledge model it will read. The known-copy
 * lists upstream keeps on the lore record (drops / friends / mimic kinds)
 * exist only for that display walk - the port's recall reads the race
 * gated on dropKnown / the known flags, so they are not modelled.
 *
 * The store lives on GameState.lore (a Map keyed by race.ridx), created
 * lazily by getLore; the save serializes it whole. Upstream splits
 * persistence between the savefile (pkills / thefts) and the user lore
 * file (everything else); the JSON save carries the full record.
 */

import { FlagSet } from "../bitflag";
import { MON_RACE_FLAG_ENTRIES, RF } from "../generated";
import type { Rng } from "../rng";
import { RF_SIZE, RSF_SIZE } from "./types";
import type { MonsterRace } from "./types";
import type { Monster } from "./monster";
import { monsterIsVisible } from "./predicate";

const UCHAR_MAX = 255;
const SHRT_MAX = 32767;

/** struct monster_lore: everything the player knows about one race. */
export interface MonsterLore {
  /** Count sightings of this monster. */
  sights: number;
  /** Count deaths from this monster. */
  deaths: number;
  /** Count monsters killed in this life. */
  pkills: number;
  /** Count objects stolen in this life. */
  thefts: number;
  /** Count monsters killed in all lives. */
  tkills: number;
  /** Number of times woken up. */
  wake: number;
  /** Number of times ignored. */
  ignore: number;
  /** Max number of gold dropped at once. */
  dropGold: number;
  /** Max number of items dropped at once. */
  dropItem: number;
  /** Max number of innate spells seen. */
  castInnate: number;
  /** Max number of other spells seen. */
  castSpell: number;
  /** blows[i].times_seen, indexed like race.blows. */
  blowTimesSeen: number[];
  /** blow_known[i] (the upstream lore->blows copy is read off the race). */
  blowKnown: boolean[];
  /** Observed racial flags (a 1 = the flag or lack thereof is known). */
  flags: FlagSet;
  /** Observed racial spell flags. */
  spellFlags: FlagSet;
  /* Derived known fields. */
  allKnown: boolean;
  armourKnown: boolean;
  dropKnown: boolean;
  sleepKnown: boolean;
  spellFreqKnown: boolean;
  innateFreqKnown: boolean;
}

/** The per-game lore store (upstream l_list), keyed by race.ridx. */
export type LoreStore = Map<number, MonsterLore>;

/** A blank lore record for a race. */
export function newMonsterLore(race: MonsterRace): MonsterLore {
  return {
    sights: 0,
    deaths: 0,
    pkills: 0,
    thefts: 0,
    tkills: 0,
    wake: 0,
    ignore: 0,
    dropGold: 0,
    dropItem: 0,
    castInnate: 0,
    castSpell: 0,
    blowTimesSeen: new Array<number>(race.blows.length).fill(0),
    blowKnown: new Array<boolean>(race.blows.length).fill(false),
    flags: new FlagSet(RF_SIZE),
    spellFlags: new FlagSet(RSF_SIZE),
    allKnown: false,
    armourKnown: false,
    dropKnown: false,
    sleepKnown: false,
    spellFreqKnown: false,
    innateFreqKnown: false,
  };
}

/** get_lore (L1735): the race's lore record, created on first access. */
export function getLore(store: LoreStore, race: MonsterRace): MonsterLore {
  let lore = store.get(race.ridx);
  if (!lore) {
    lore = newMonsterLore(race);
    store.set(race.ridx, lore);
  }
  return lore;
}

/**
 * create_mon_flag_mask (mon-util.c): the union of all race flags whose
 * RFT_ category is in the list.
 */
export function createMonFlagMask(...types: string[]): FlagSet {
  const mask = new FlagSet(RF_SIZE);
  for (let i = 0; i < MON_RACE_FLAG_ENTRIES.length; i++) {
    if (types.includes(MON_RACE_FLAG_ENTRIES[i]!.type)) mask.on(i);
  }
  return mask;
}

/** lore_learn_spell_if_has (L278). */
export function loreLearnSpellIfHas(
  lore: MonsterLore,
  race: MonsterRace,
  flag: number,
): void {
  if (race.spellFlags.has(flag)) lore.spellFlags.on(flag);
}

/** lore_learn_spell_if_visible (L285). */
export function loreLearnSpellIfVisible(
  lore: MonsterLore,
  mon: Monster,
  flag: number,
): void {
  if (monsterIsVisible(mon)) lore.spellFlags.on(flag);
}

/** lore_learn_flag_if_visible (L292). */
export function loreLearnFlagIfVisible(
  lore: MonsterLore,
  mon: Monster,
  flag: number,
): void {
  if (monsterIsVisible(mon)) lore.flags.on(flag);
}

/** Bump a counter capped at UCHAR_MAX (the uint8_t lore counters). */
export function loreCountU8(
  lore: MonsterLore,
  key: "wake" | "ignore" | "castInnate" | "castSpell",
): void {
  if (lore[key] < UCHAR_MAX) lore[key]++;
}

/** Bump a counter capped at SHRT_MAX (the uint16_t-as-short counters). */
export function loreCountU16(
  lore: MonsterLore,
  key: "sights" | "deaths" | "pkills" | "tkills",
): void {
  if (lore[key] < SHRT_MAX) lore[key]++;
}

/**
 * lore_update (L303): derive which bits of lore are known from the
 * observation counters (obvious flags assumed; seen blows known; kills
 * reveal armour, drops and the racial/drop flags; the wake/ignore counts
 * reveal sleep; 50+ observed casts reveal the frequencies; all_known
 * spreads to everything).
 */
export function loreUpdate(race: MonsterRace, lore: MonsterLore): void {
  /* Assume some "obvious" flags. */
  lore.flags.union(createMonFlagMask("RFT_OBV"));

  /* Blows. */
  for (let i = 0; i < race.blows.length; i++) {
    if (lore.blowKnown[i] || lore.blowTimesSeen[i] || lore.allKnown) {
      lore.blowKnown[i] = true;
    }
  }

  /* Killing a monster reveals some properties. */
  if (lore.tkills > 0 || lore.allKnown) {
    lore.armourKnown = true;
    lore.dropKnown = true;
    lore.flags.union(
      createMonFlagMask("RFT_RACE_A", "RFT_RACE_N", "RFT_DROP"),
    );
    lore.flags.on(RF.FORCE_DEPTH);
  }

  /* Awareness. */
  if (
    lore.wake * lore.wake > race.sleep ||
    lore.ignore === UCHAR_MAX ||
    lore.allKnown ||
    (race.sleep === 0 && lore.tkills >= 10)
  ) {
    lore.sleepKnown = true;
  }

  /* Spellcasting frequency. */
  if (lore.castInnate > 50 || lore.allKnown) lore.innateFreqKnown = true;
  if (lore.castSpell > 50 || lore.allKnown) lore.spellFreqKnown = true;

  /* Flags for probing and cheating. */
  if (lore.allKnown) {
    lore.flags.setall();
    lore.spellFlags.copy(race.spellFlags);
  }
}

/** cheat_monster_lore (L361): learn everything about a race. */
export function cheatMonsterLore(race: MonsterRace, lore: MonsterLore): void {
  lore.allKnown = true;
  loreUpdate(race, lore);
}

/** wipe_monster_lore (L374): forget everything about a race. */
export function wipeMonsterLore(race: MonsterRace, lore: MonsterLore): void {
  Object.assign(lore, newMonsterLore(race));
}

/**
 * lore_do_probe (L426): learn everything about one monster. The recall
 * window redraw rides presentation (#25).
 */
export function loreDoProbe(store: LoreStore, mon: Monster): void {
  const lore = getLore(store, mon.race);
  lore.allKnown = true;
  loreUpdate(mon.race, lore);
}

/**
 * lore_is_fully_known (L441): everything there is to know is known. The
 * flag check is upstream's byte-level test (every byte of the observed
 * set nonzero), kept verbatim. Marks the lore all_known when it passes.
 */
export function loreIsFullyKnown(store: LoreStore, race: MonsterRace): boolean {
  const lore = getLore(store, race);
  if (lore.allKnown) return true;
  if (!lore.armourKnown) return false;
  /* Only check spells if the monster can cast them. */
  if (!lore.spellFreqKnown && race.freqInnate + race.freqSpell) return false;
  if (!lore.dropKnown) return false;
  if (!lore.sleepKnown) return false;

  for (let i = 0; i < race.blows.length; i++) {
    if (!lore.blowKnown[i]) return false;
  }

  for (let i = 0; i < RF_SIZE; i++) {
    if (!lore.flags.bits[i]) return false;
  }
  for (let i = 0; i < RSF_SIZE; i++) {
    if (lore.spellFlags.bits[i] !== race.spellFlags.bits[i]) return false;
  }

  /* The player knows everything. */
  lore.allKnown = true;
  loreUpdate(race, lore);
  return true;
}

/**
 * lore_treasure (L502): note an observed drop - the max counts, the
 * DROP_GOOD/GREAT reveal, and the one-in-4 ONLY_ITEM / ONLY_GOLD learns.
 */
export function loreTreasure(
  rng: Rng,
  lore: MonsterLore,
  numItem: number,
  numGold: number,
): void {
  if (numItem > lore.dropItem) lore.dropItem = numItem;
  if (numGold > lore.dropGold) lore.dropGold = numGold;

  /* Learn about drop quality. */
  lore.flags.on(RF.DROP_GOOD);
  lore.flags.on(RF.DROP_GREAT);

  /* Have a chance to learn ONLY_ITEM and ONLY_GOLD. */
  if (numItem && lore.dropGold === 0 && rng.oneIn(4)) {
    lore.flags.on(RF.ONLY_ITEM);
  }
  if (numGold && lore.dropItem === 0 && rng.oneIn(4)) {
    lore.flags.on(RF.ONLY_GOLD);
  }
}

/**
 * monster_flags_known (L542): the race's flags masked to what the lore
 * has observed.
 */
export function monsterFlagsKnown(
  race: MonsterRace,
  lore: MonsterLore,
): FlagSet {
  const flags = race.flags.clone();
  flags.inter(lore.flags);
  return flags;
}
