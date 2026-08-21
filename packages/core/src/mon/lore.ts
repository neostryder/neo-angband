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
 * lazily by getLore.
 *
 * PERSISTENCE IS SPLIT, as upstream's is. The savefile owns pkills and thefts
 * ("in this life"); lore.txt in the user directory owns everything else and
 * outlives the character, which is what makes tkills "monsters killed in all
 * lives" and lore-describe's "your ancestors have exterminated at least %d"
 * able to be about an ancestor. lore-file.ts is both halves of that file; the
 * JSON save still carries the whole record (narrowing it would be a
 * SAVE_VERSION change) and the file is laid over it on load.
 *
 * `spellFlags` is a bit vector IN MEMORY and a list of RSF_ NAMES in both
 * stores: lore.txt has always written it by name, and the savefile joined it at
 * SAVE_VERSION 5 (session/save.ts, SavedLore.spellsKnown). That is what stops a
 * future RSF entry from renumbering an existing character's memory - MOD_REACH
 * row 22.
 */

import { FlagSet } from "../bitflag.js";
import { MON_RACE_FLAG_ENTRIES, RF } from "../generated/index.js";
import type { Rng } from "../rng.js";
import { RF_SIZE } from "./types.js";
import { rsfSize } from "./spell-registry.js";
import type { MonsterRace } from "./types.js";
import type { Monster } from "./monster.js";
import { monsterIsVisible } from "./predicate.js";

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
  const lore: MonsterLore = {
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
    spellFlags: new FlagSet(rsfSize()),
    allKnown: false,
    armourKnown: false,
    dropKnown: false,
    sleepKnown: false,
    spellFreqKnown: false,
    innateFreqKnown: false,
  };
  /* The base's flags are known from the start (finish_parse_lore), so a record
   * carries them from the moment it exists rather than waiting for a
   * `loreUpdate` that a display path might not have run. `loreUpdate` does it
   * too, because a record restored from a save never passes through here; the
   * union is idempotent. See `knowBaseFlags`. */
  knowBaseFlags(race, lore);
  return lore;
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
 * A MONSTER'S BASE FLAGS ARE KNOWN WITHOUT MEETING IT.
 *
 * `finish_parse_lore` (mon-init.c:2570-2575) walks every race at startup and
 * does `rf_union(l->flags, r->base->flags)` before calling `lore_update`, so a
 * player who has never seen a giant black ant still knows that ants are
 * ANIMAL and WEIRD_MIND, and that ainu are IM_FIRE and NO_CONF. It is a
 * FINISH hook, and the port did not have it: measured 2026-08-20, a fresh lore
 * for a giant black ant knew neither of its base's two flags, so monster recall
 * was quieter than upstream's for every unmet monster in the game - 54 of the
 * 56 bases carry flags.
 *
 * IT IS DONE WHERE A RECORD IS BORN, because there is no startup pass in this
 * port to put it in: upstream allocates `l_list` up front for every race, and
 * the port creates a record lazily on first access. Creation is therefore the
 * port's own "once per race", and `newMonsterLore` is the one place every new
 * record passes through - including the one `wipeMonsterLore` builds, which is
 * what makes a wiped record behave like upstream's rather than like a record
 * that never existed.
 *
 * NOT FROM `loreUpdate`, which was the first thing tried and is wrong. Upstream
 * unions once at startup and never again, so its wizard "wipe monster lore"
 * really does lose the base flags and the next blow does not restore them.
 * Putting the union in `lore_update`'s port would quietly make that command
 * less complete than the C's, which the existing wipe test caught.
 *
 * A base flag the RACE removed is still marked known, and that is upstream's
 * behaviour rather than an oversight: `lore.flags` means "this flag, or its
 * absence, is known", so learning that a green glutton ghost lacks something
 * its base has is knowledge too (see mon/bind.ts on races dropping inherited
 * base flags).
 *
 * THE `if (r->base)` GUARD IS UPSTREAM'S OWN (mon-init.c:2571), kept because
 * the C tolerates a race with no base and this should not be stricter than the
 * thing it reproduces. It is deliberately NOT widened to `race.base?.flags`: a
 * base with no flag set at all is a shape the binder cannot produce, and eight
 * lore-file tests that threw here were a hand-made fixture claiming otherwise -
 * the fixture was corrected rather than this guard loosened, because a guard
 * that tolerates an impossible shape stops any test from noticing a real one.
 */
function knowBaseFlags(race: MonsterRace, lore: MonsterLore): void {
  if (!race.base) return;
  lore.flags.union(race.base.flags);
}

/**
 * lore_update (L303): derive which bits of lore are known from the
 * observation counters (obvious flags assumed; seen blows known; kills
 * reveal armour, drops and the racial/drop flags; the wake/ignore counts
 * reveal sleep; 50+ observed casts reveal the frequencies; all_known
 * spreads to everything).
 *
 * DOES NOT union the base's flags, and that is measured rather than assumed:
 * upstream unions them once at startup (`finish_parse_lore`) and never again,
 * so the wizard "wipe monster lore" command genuinely loses them and
 * `lore_update` on the next blow does not bring them back. Doing it here would
 * make the port's wipe less complete than upstream's. `newMonsterLore` is the
 * placement that matches - see `knowBaseFlags`.
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
  /* AS BLANK AS UPSTREAM'S, base flags included. `newMonsterLore` seeds them
   * (`knowBaseFlags`) because upstream's startup pass does, but upstream runs
   * that pass ONCE - so a wizard-wiped lore in the C really has no base flags
   * and nothing puts them back. Reproducing that means clearing them here,
   * which is the difference between "a fresh record" and "a wiped one" in a
   * port where both are built by the same function. */
  lore.flags.wipe();
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
  for (let i = 0; i < rsfSize(); i++) {
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
