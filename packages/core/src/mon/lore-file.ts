/**
 * lore.txt: monster memory as a file in ANGBAND_DIR_USER, both halves.
 *
 * WHAT WAS MISSING, AND WHY IT IS NOT JUST A FILE
 *
 * Upstream splits monster memory between two stores, and the split is
 * load-bearing rather than incidental:
 *
 *   - the SAVEFILE carries `pkills` and `thefts` - "in this life" counters;
 *   - `lore.txt` in the USER directory carries everything else, and the user
 *     directory belongs to the PLAYER, not to a character. `lore_save` is
 *     called from `save_game_checked` (ui-game.c:1076) and the file is read back
 *     by `lore_parser` at startup (mon-init.c:2646), before any savefile is
 *     touched.
 *
 * So upstream's monster knowledge SURVIVES DEATH. `tkills` is commented "Count
 * monsters killed in all lives" and mon-lore.c says so out loud: "your ancestors
 * have exterminated at least %d of the creatures." The port kept the whole lore
 * record in the JSON save, which is tidy and is why nothing ever noticed - but it
 * means tkills can only ever count this character's kills, and the ancestor
 * sentence in lore-describe.ts could never be true of an ancestor. A behavioural
 * gap wearing a file's clothes: reading the port, there was no missing function to
 * find, because the knowledge was being persisted - just to the wrong place.
 *
 * THE SPLIT, KEPT EXACTLY. This module is the file. The save keeps carrying the
 * full record (narrowing it would be a SAVE_VERSION change with nothing to gain),
 * and the front end overlays lore.txt on top of a loaded game for the
 * seven counters plus the flags and blows that the file carries - which is
 * precisely the set `write_lore_entries` writes. pkills and thefts are never in
 * the file and so are never overlaid, exactly as upstream has them.
 *
 * WHAT THIS DELIBERATELY DOES NOT EMIT: `drop:`, `drop-base:`, `friends:`,
 * `friends-base:` and `mimic:`. Upstream writes those from `lore->drops` and
 * friends, and NOTHING in the C populates those lists except the lore PARSER -
 * they are a pure echo of a previously-read file. A player who has never had a
 * lore.txt gets none of those lines from upstream either, and the port models the
 * same knowledge on the race gated on `dropKnown` and the known flags (see
 * lore.ts). The reader below accepts and ignores them, so an upstream lore.txt
 * still loads.
 */

import { writeFlags } from "../datafile.js";
/**
 * writeFlags used to be DEFINED here and is on the pinned ctx.core surface
 * (mod-core-surface.test.ts), so a plugin may be importing it from this
 * module. Moving the definition to ../datafile.js must not move the export.
 */
export { writeFlags };
import { FlagSet, flagSetall } from "../bitflag.js";
import { RF, RSF } from "../generated/index.js";
import { RF_SIZE } from "./types.js";
import { rsfSize } from "./spell-registry.js";
import type { MonsterRace } from "./types.js";
import { loreUpdate, newMonsterLore } from "./lore.js";
import type { LoreStore, MonsterLore } from "./lore.js";

/**
 * A flag-number -> name table, INVERTED FROM THE ENUM rather than read off the
 * generated entry list.
 *
 * The generated entry lists do not agree on whether they carry their sentinel,
 * so `ENTRIES[flag]` is right for some and off by one for others: MON_SPELL_
 * ENTRIES keeps RSF_NONE at [0] and MON_RACE_FLAG_ENTRIES keeps RF_NONE at [0],
 * while OBJECT_FLAG_ENTRIES drops OF_NONE and starts at SUST_STR - its own
 * generated header says so ("OF_<name> == entry index + 1"). Inverting the enum
 * - which is generated from the same header as the flags themselves - cannot be
 * off by one in any direction, and the test pins them against the reference
 * headers.
 *
 * This comment used to say MON_RACE_FLAG_ENTRIES was the list that drops its
 * sentinel. It is not, and naming the wrong table here is how an off-by-one
 * gets written somewhere that has no test: the code below was always right,
 * because it never trusted either list. #273 checked all four tables against
 * their own tuples for exactly this reason.
 */
function nameTable(en: Readonly<Record<string, number>>): readonly (string | undefined)[] {
  const out: (string | undefined)[] = [];
  for (const [name, value] of Object.entries(en)) out[value] = name;
  return out;
}

/** r_info_flags (mon-init.c), by flag number. Index 0 is upstream's RF_NONE. */
export const RF_FLAG_NAMES = nameTable(RF);
/** r_info_spell_flags (mon-init.c:55-61), by flag number. */
export const RSF_FLAG_NAMES = nameTable(RSF);

const RF_NAMES = RF_FLAG_NAMES;
const RSF_NAMES = RSF_FLAG_NAMES;


/**
 * write_lore_entries (mon-lore.c:1743-1893): one block per race the player has
 * seen or fully knows, in race index order.
 *
 * `rsf_inter(lore->spell_flags, race->spell_flags)` at L1802 MUTATES the lore
 * record as a side effect of writing the file - a wart, but a wart that changes
 * what the next save contains, so it is reproduced (core keeps the C's warts;
 * fixes go in the bug-fixes mod).
 */
export function writeLoreEntries(
  races: readonly MonsterRace[],
  store: LoreStore,
): string {
  let out = "";

  for (const race of races) {
    /* "Ignore non-existent or unseen monsters" (L1755-1757). */
    if (!race.name) continue;
    const lore = store.get(race.ridx);
    if (!lore) continue;
    if (!lore.sights && !lore.allKnown) continue;

    out += `name:${race.name}\n`;

    /* "Output base if we're remembering everything" (L1760-1762). */
    if (lore.allKnown) out += `base:${race.base.name}\n`;

    out += `counts:${lore.sights}:${lore.deaths}:${lore.tkills}:${lore.wake}:${lore.ignore}:${lore.castInnate}:${lore.castSpell}\n`;

    /* Blows, up to mon_blows_max (L1768-1795). */
    for (let n = 0; n < race.blows.length; n++) {
      if (!lore.blowKnown[n] && !lore.allKnown) continue;
      const blow = race.blows[n];
      if (!blow?.method) continue;
      const rv = blow.dice?.randomValue() ?? { base: 0, dice: 0, sides: 0, mBonus: 0 };
      out += `blow:${blow.method.name}`;
      out += `:${blow.effect.name}`;
      out += `:${rv.base}+${rv.dice}d${rv.sides}M${rv.mBonus}`;
      out += `:${lore.blowTimesSeen[n] ?? 0}`;
      out += `:${n}`;
      out += "\n";
    }

    out += writeFlags("flags:", lore.flags, RF_SIZE, RF_NAMES);

    /* rsf_inter, in place, then the spell line (L1802-1805). */
    lore.spellFlags.inter(race.spellFlags);
    out += writeFlags("spells:", lore.spellFlags, rsfSize(), RSF_NAMES);

    out += "\n";
  }

  return out;
}

/** The fields lore.txt carries, for one race. Everything else stays as it was. */
interface LoreFileEntry {
  readonly sights: number;
  readonly deaths: number;
  readonly tkills: number;
  readonly wake: number;
  readonly ignore: number;
  readonly castInnate: number;
  readonly castSpell: number;
  readonly allKnown: boolean;
  /** index -> times_seen, only for blows the file recorded as seen. */
  readonly blowTimesSeen: ReadonlyMap<number, number>;
  readonly flags: FlagSet;
  readonly spellFlags: FlagSet;
}

/** What one parse produced, plus the lines it could not use. */
export interface LoreFileParse {
  /** Race name (as written in the file) -> the record it carried. */
  readonly entries: ReadonlyMap<string, LoreFileEntry>;
  /**
   * Directives that were recognised but carry nothing this port models - the
   * drop / friends / mimic echo - counted rather than dropped silently, so a
   * caller can say "this file held more than was read" instead of guessing.
   */
  readonly ignored: number;
  /** Lines that are not a directive at all. Named, because a broken file is a bug. */
  readonly bad: readonly string[];
}

/** grab_flag by name, tolerant exactly as the C's `(void) grab_flag` is. */
function grabFlags(text: string, set: FlagSet, names: readonly (string | undefined)[]): void {
  for (const token of text.split(/[\s|]+/u)) {
    if (token === "") continue;
    const flag = names.indexOf(token);
    if (flag > 0) set.on(flag);
  }
}

/**
 * lore_parser (mon-init.c:2544-2580), as a pure function over the file text.
 *
 * Upstream resolves `name:` to a race immediately and drops the block when the
 * monster does not exist ("to allow for non-existent monsters"). This keeps the
 * NAME and lets the caller resolve, because in this port a name can be absent for
 * a second reason upstream does not have: a mod that supplied the monster is no
 * longer installed. Losing that block silently would quietly forget a player's
 * memory of it, where keeping it means re-enabling the mod restores the lore.
 */
export function parseLoreFile(text: string): LoreFileParse {
  const entries = new Map<string, LoreFileEntry>();
  const bad: string[] = [];
  let ignored = 0;

  let name: string | null = null;
  let cur: {
    sights: number;
    deaths: number;
    tkills: number;
    wake: number;
    ignore: number;
    castInnate: number;
    castSpell: number;
    allKnown: boolean;
    blowTimesSeen: Map<number, number>;
    flags: FlagSet;
    spellFlags: FlagSet;
  } | null = null;

  const flush = (): void => {
    if (name !== null && cur !== null) entries.set(name, cur);
    name = null;
    cur = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const colon = line.indexOf(":");
    const directive = colon < 0 ? line : line.slice(0, colon);
    const rest = colon < 0 ? "" : line.slice(colon + 1);

    switch (directive) {
      case "name": {
        flush();
        name = rest;
        cur = {
          sights: 0,
          deaths: 0,
          tkills: 0,
          wake: 0,
          ignore: 0,
          castInnate: 0,
          castSpell: 0,
          allKnown: false,
          blowTimesSeen: new Map<number, number>(),
          flags: new FlagSet(RF_SIZE),
          spellFlags: new FlagSet(rsfSize()),
        };
        break;
      }
      case "base": {
        /* parse_lore_base: the base is only validated; what it MEANS is
         * "know everything" plus every racial flag set (mon-init.c:2294-2296). */
        if (cur) {
          cur.allKnown = true;
          flagSetall(cur.flags.bits);
        }
        break;
      }
      case "counts": {
        if (!cur) break;
        const n = rest.split(":").map((v) => Number.parseInt(v, 10));
        if (n.length < 7 || n.some((v) => Number.isNaN(v))) {
          bad.push(line);
          break;
        }
        [cur.sights, cur.deaths, cur.tkills, cur.wake, cur.ignore, cur.castInnate, cur.castSpell] =
          n as [number, number, number, number, number, number, number];
        break;
      }
      case "blow": {
        if (!cur) break;
        /* method:effect:damage:seen:index, every field after the method
         * optional. "Interpret: if (seen)" - a blow seen zero times is not
         * recorded at all (mon-init.c:2345-2351). */
        const f = rest.split(":");
        const seen = Number.parseInt(f[3] ?? "", 10);
        const index = Number.parseInt(f[4] ?? "", 10);
        if (!Number.isNaN(seen) && seen > 0 && !Number.isNaN(index) && index >= 0) {
          cur.blowTimesSeen.set(index, seen);
        }
        break;
      }
      case "flags": {
        if (cur) grabFlags(rest, cur.flags, RF_NAMES);
        break;
      }
      case "spells": {
        if (cur) grabFlags(rest, cur.spellFlags, RSF_NAMES);
        break;
      }
      case "drop":
      case "drop-base":
      case "friends":
      case "friends-base":
      case "mimic": {
        ignored++;
        break;
      }
      default:
        bad.push(line);
    }
  }
  flush();

  return { entries, ignored, bad };
}

/** What an overlay changed, so a caller can log it instead of assuming. */
export interface LoreOverlayResult {
  /** Races whose record the file supplied. */
  readonly applied: number;
  /** Entries naming a race this pack does not have (an uninstalled mod). */
  readonly unknownRaces: readonly string[];
  readonly ignored: number;
  readonly bad: readonly string[];
}

/**
 * Put lore.txt's record over a loaded game's store, which is upstream's order:
 * the file is read at startup and the savefile then supplies only pkills and
 * thefts.
 *
 * Overwrites rather than merges, deliberately. The file is written on every save
 * from this same store, so it is never older than the save; inventing a
 * max()-per-counter merge would produce numbers neither store ever held.
 * pkills, thefts, dropGold and dropItem are not in the file and are left alone.
 */
export function applyLoreFile(
  races: readonly MonsterRace[],
  store: LoreStore,
  parsed: LoreFileParse,
): LoreOverlayResult {
  const byName = new Map<string, MonsterRace>();
  for (const race of races) if (race.name) byName.set(race.name, race);

  const unknownRaces: string[] = [];
  let applied = 0;

  for (const [name, entry] of parsed.entries) {
    const race = byName.get(name);
    if (!race) {
      unknownRaces.push(name);
      continue;
    }
    let lore: MonsterLore | undefined = store.get(race.ridx);
    if (!lore) {
      lore = newMonsterLore(race);
      store.set(race.ridx, lore);
    }

    lore.sights = entry.sights;
    lore.deaths = entry.deaths;
    lore.tkills = entry.tkills;
    lore.wake = entry.wake;
    lore.ignore = entry.ignore;
    lore.castInnate = entry.castInnate;
    lore.castSpell = entry.castSpell;
    lore.allKnown = entry.allKnown;
    lore.flags = entry.flags;
    lore.spellFlags = entry.spellFlags;

    /* Blows the file did not mention were seen zero times, which is what
     * upstream's zeroed l_list means before the parser fills it in. */
    lore.blowTimesSeen = race.blows.map((_, i) => entry.blowTimesSeen.get(i) ?? 0);
    lore.blowKnown = race.blows.map((_, i) => (entry.blowTimesSeen.get(i) ?? 0) > 0);

    /* lore_update is what derives armourKnown / dropKnown / the RFT_OBV union
     * from the counters, and the parser leaves those unset. */
    loreUpdate(race, lore);
    applied++;
  }

  return { applied, unknownRaces, ignored: parsed.ignored, bad: parsed.bad };
}

/** The name lore_save is called with (ui-game.c:1090). */
export const LORE_FILE = "lore.txt";
