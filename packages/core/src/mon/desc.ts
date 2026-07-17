/**
 * Monster description, ported from reference/src/mon-desc.c and mon-desc.h
 * (Angband 4.2.6): monster_desc (the naming grammar - articles, possessives,
 * gendered pronouns, reflexives, "(offscreen)", capitalisation), get_mon_name
 * (the list-count label) and plural_aux (simple English pluralisation).
 *
 * This is the display-layer (#25) grammar that turns a live monster into a
 * finished noun phrase - "the kobold", "a kobold", "the kobold's", "she",
 * "herself", "it (offscreen)". Callers select the phrasing through the MDESC_*
 * bit flags, exactly as upstream.
 *
 * Two upstream couplings are handled faithfully:
 * - monster_is_visible reads the monster's MFLAG_VISIBLE, present on the live
 *   Monster; forced visibility (MDESC_SHOW / MDESC_HIDE) overrides it as in C.
 * - panel_contains (mon-desc.c L236, the "(offscreen)" test) is UI viewport
 *   state; it is injected as an optional predicate defaulting to "on-screen"
 *   (panel_contains == true), so the "(offscreen)" tag is only appended when a
 *   caller supplies a real panel test. The single-message web sink never sees a
 *   monster it cannot show, so the default matches the reachable behaviour.
 */

import { RF } from "../generated";
import type { Loc } from "../loc";
import type { Monster } from "./monster";
import type { MonsterRace } from "./types";
import { monsterIsShapeUnique, monsterIsVisible } from "./predicate";

/** Bit flags for monster_desc (mon-desc.h L27-42). */
export const MDESC = {
  DEFAULT: 0x00,
  /** Objective (or Reflexive). */
  OBJE: 0x01,
  /** Possessive (or Reflexive). */
  POSS: 0x02,
  /** Indefinites for hidden monsters ("something"). */
  IND_HID: 0x04,
  /** Indefinites for visible monsters ("a kobold"). */
  IND_VIS: 0x08,
  /** Pronominalize hidden monsters. */
  PRO_HID: 0x10,
  /** Pronominalize visible monsters. */
  PRO_VIS: 0x20,
  /** Assume the monster is hidden. */
  HIDE: 0x40,
  /** Assume the monster is visible. */
  SHOW: 0x80,
  /** Capitalise. */
  CAPITAL: 0x100,
  /** Add a comma after an unterminated phrase name. */
  COMMA: 0x200,
} as const;

/** "someone", "something", or "the kobold" at the start of a message. */
export const MDESC_STANDARD =
  MDESC.CAPITAL | MDESC.IND_HID | MDESC.PRO_HID | MDESC.COMMA;

/** "someone", "something", or "the kobold" as the target of an attack. */
export const MDESC_TARG = MDESC.OBJE | MDESC.IND_HID | MDESC.PRO_HID;

/** Reveal the full, indefinite name of a monster (died_from). */
export const MDESC_DIED_FROM = MDESC.SHOW | MDESC.IND_VIS;

/** is_a_vowel (z-util.c): the leading article picks "an" for vowels. */
function isAVowel(ch: string): boolean {
  return "aeiouAEIOU".includes(ch);
}

/** my_strcap (z-util.c): capitalise the first letter of the string. */
function strcap(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * plural_aux (mon-desc.c L27): simple English pluralisation of a monster name -
 * append "es" after a trailing "s", otherwise "s".
 */
export function pluralAux(name: string): string {
  if (name.length === 0) return name;
  return name + (name[name.length - 1] === "s" ? "es" : "s");
}

/**
 * get_mon_name (mon-desc.c L44): the "N race(s)" label the monster list prints.
 * Uniques get "[U] name" with no count; otherwise the count, then the singular
 * name (num == 1), the race's explicit plural, or plural_aux of the name.
 */
export function getMonName(race: MonsterRace, num: number): string {
  if (race.flags.has(RF.UNIQUE)) {
    return `[U] ${race.name}`;
  }
  /* strnfmt "%3d " - the count is right-justified in a 3-wide field. */
  const prefix = `${String(num).padStart(3, " ")} `;
  if (num === 1) return prefix + race.name;
  if (race.plural !== null) return prefix + race.plural;
  return prefix + pluralAux(race.name);
}

/**
 * monster_desc (mon-desc.c L108): build a description of `mon` per the MDESC_*
 * `mode` flags. `panelContains(grid)` is the injected viewport test for the
 * "(offscreen)" tag; it defaults to "on-screen" so no tag is appended unless a
 * caller supplies a real panel predicate.
 */
export function monsterDesc(
  mon: Monster,
  mode: number,
  panelContains: (grid: Loc) => boolean = () => true,
): string {
  /* Can we see it? (forced, or not hidden + visible.) */
  const seen =
    !!(mode & MDESC.SHOW) ||
    (!(mode & MDESC.HIDE) && monsterIsVisible(mon));

  /* Sexed pronouns (seen and forced, or unseen and allowed). */
  const usePronoun =
    (seen && !!(mode & MDESC.PRO_VIS)) || (!seen && !!(mode & MDESC.PRO_HID));

  /* First, try using pronouns, or describing hidden monsters. */
  if (!seen || usePronoun) {
    let choice = "it";

    /* An encoding of the monster "sex". */
    let msex = 0x00;
    if (usePronoun) {
      if (mon.race.flags.has(RF.FEMALE)) msex = 0x20;
      else if (mon.race.flags.has(RF.MALE)) msex = 0x10;
    }

    /* Brute force: split on the possibilities (mon-desc.c L137). */
    switch (msex + (mode & 0x07)) {
      /* Neuter. */
      case 0x00: choice = "it"; break;
      case 0x01: choice = "it"; break;
      case 0x02: choice = "its"; break;
      case 0x03: choice = "itself"; break;
      case 0x04: choice = "something"; break;
      case 0x05: choice = "something"; break;
      case 0x06: choice = "something's"; break;
      case 0x07: choice = "itself"; break;
      /* Male. */
      case 0x10: choice = "he"; break;
      case 0x11: choice = "him"; break;
      case 0x12: choice = "his"; break;
      case 0x13: choice = "himself"; break;
      case 0x14: choice = "someone"; break;
      case 0x15: choice = "someone"; break;
      case 0x16: choice = "someone's"; break;
      case 0x17: choice = "himself"; break;
      /* Female. */
      case 0x20: choice = "she"; break;
      case 0x21: choice = "her"; break;
      case 0x22: choice = "her"; break;
      case 0x23: choice = "herself"; break;
      case 0x24: choice = "someone"; break;
      case 0x25: choice = "someone"; break;
      case 0x26: choice = "someone's"; break;
      case 0x27: choice = "herself"; break;
    }

    return mode & MDESC.CAPITAL ? strcap(choice) : choice;
  }

  if (mode & MDESC.POSS && mode & MDESC.OBJE) {
    /* The monster is visible, so use its gender. */
    let out: string;
    if (mon.race.flags.has(RF.FEMALE)) out = "herself";
    else if (mon.race.flags.has(RF.MALE)) out = "himself";
    else out = "itself";
    return mode & MDESC.CAPITAL ? strcap(out) : out;
  }

  /* Strip a descriptive phrase (after the comma) when a possessive follows. */
  const stripPhrase = (name: string): string => {
    if (
      mode & MDESC.POSS &&
      mon.race.flags.has(RF.NAME_COMMA)
    ) {
      const commaPos = name.indexOf(",");
      if (commaPos >= 0 && commaPos < 1024) return name.slice(0, commaPos);
    }
    return name;
  };

  let desc: string;

  /* Unique, indefinite or definite. */
  if (monsterIsShapeUnique(mon)) {
    desc = stripPhrase(mon.race.name);
  } else if (mode & MDESC.IND_VIS) {
    /* Indefinite monsters need an indefinite article. */
    desc = (isAVowel(mon.race.name[0] ?? "") ? "an " : "a ") + stripPhrase(mon.race.name);
  } else {
    /* Definite monsters need a definite article. */
    desc = "the " + stripPhrase(mon.race.name);
  }

  if (mode & MDESC.COMMA && mon.race.flags.has(RF.NAME_COMMA)) {
    desc += ",";
  }

  /* Handle the possessive. */
  if (mode & MDESC.POSS) {
    desc += "'s";
  }

  /* Mention "offscreen" monsters. */
  if (!panelContains(mon.grid)) {
    desc += " (offscreen)";
  }

  return mode & MDESC.CAPITAL ? strcap(desc) : desc;
}
