/**
 * Object ignoring, ported from reference/src/obj-ignore.c (Angband 4.2.6):
 * the quality / ego / per-kind ignore predicates and the player's ignore
 * settings.
 *
 * Ignoring lets the player suppress uninteresting drops: by quality tier
 * within an "ignore type" (all bad daggers, all average shields...), by ego
 * kind, by flavored kind (all Cure Light Wounds potions), or per object. The
 * predicates decide whether a given object is ignored; the settings hold the
 * player's choices. In a headless engine the settings start empty (nothing is
 * ignored, matching the shipped default), but the machinery is complete so a
 * front end (or a mod) can drive it, and the settings ride the save.
 *
 * KNOWLEDGE: the port carries no per-object `known` twin (obj-knowledge.c),
 * running as if every object were fully known - so ignore_level_of always
 * takes the fully-known branch and reads the object's own fields, and the
 * !obj->known guards never fire. Flavor awareness (task #11) is real and
 * decides the aware-vs-unaware per-kind ignore.
 *
 * DEFERRED (ledgered in obj-ignore.yaml): the ignore MENU plumbing
 * (ego_has_ignore_type / quality_choices / autoinscription), ignore_drop
 * (drop all {ignore}able gear - a command), and the redraw / PN_IGNORE notice
 * pass - all presentation (#25) or gear-command surface.
 */

import { TV } from "../generated";
import { ITYPE } from "../generated";
import { Rng } from "../rng";
import type { RandomValue } from "../rng";
import { OBJ_NOTICE } from "./knowledge";
import { tvalIsJewelry } from "./object";
import type { GameObject } from "./object";
import { OBJ_MOD_MAX } from "./types";

/**
 * Quality ignore tiers (obj-ignore.h quality_values). ALL means "everything
 * that is not an artifact"; MAX is the sentinel for "value undetermined /
 * never ignore".
 */
export const IGNORE = {
  NONE: 0,
  BAD: 1,
  AVERAGE: 2,
  GOOD: 3,
  ALL: 4,
  MAX: 5,
} as const;

/** kind->ignore bit flags (object.h): ignore this kind when aware / unaware. */
export const IGNORE_IF_AWARE = 0x01;
export const IGNORE_IF_UNAWARE = 0x02;

/** The number of ignore types (ITYPE_MAX). */
export const ITYPE_MAX = 27;

/** One row of obj-ignore.c's quality_mapping. */
interface QualityMap {
  itype: number;
  tval: number;
  identifier: string;
}

/** quality_mapping (obj-ignore.c L44): itype for a tval + optional name match. */
const QUALITY_MAPPING: readonly QualityMap[] = [
  { itype: ITYPE.GREAT, tval: TV.SWORD, identifier: "Chaos" },
  { itype: ITYPE.GREAT, tval: TV.POLEARM, identifier: "Slicing" },
  { itype: ITYPE.GREAT, tval: TV.HAFTED, identifier: "Disruption" },
  { itype: ITYPE.SHARP, tval: TV.SWORD, identifier: "" },
  { itype: ITYPE.SHARP, tval: TV.POLEARM, identifier: "" },
  { itype: ITYPE.BLUNT, tval: TV.HAFTED, identifier: "" },
  { itype: ITYPE.SLING, tval: TV.BOW, identifier: "Sling" },
  { itype: ITYPE.BOW, tval: TV.BOW, identifier: "Bow" },
  { itype: ITYPE.CROSSBOW, tval: TV.BOW, identifier: "Crossbow" },
  { itype: ITYPE.SHOT, tval: TV.SHOT, identifier: "" },
  { itype: ITYPE.ARROW, tval: TV.ARROW, identifier: "" },
  { itype: ITYPE.BOLT, tval: TV.BOLT, identifier: "" },
  { itype: ITYPE.ROBE, tval: TV.SOFT_ARMOR, identifier: "Robe" },
  { itype: ITYPE.BASIC_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Black" },
  { itype: ITYPE.BASIC_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Blue" },
  { itype: ITYPE.BASIC_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "White" },
  { itype: ITYPE.BASIC_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Red" },
  { itype: ITYPE.BASIC_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Green" },
  { itype: ITYPE.MULTI_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Multi" },
  { itype: ITYPE.HIGH_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Shining" },
  { itype: ITYPE.HIGH_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Law" },
  { itype: ITYPE.HIGH_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Gold" },
  { itype: ITYPE.HIGH_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Chaos" },
  { itype: ITYPE.BALANCE_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Balance" },
  { itype: ITYPE.POWER_DRAGON_ARMOR, tval: TV.DRAG_ARMOR, identifier: "Power" },
  { itype: ITYPE.BODY_ARMOR, tval: TV.HARD_ARMOR, identifier: "" },
  { itype: ITYPE.BODY_ARMOR, tval: TV.SOFT_ARMOR, identifier: "" },
  { itype: ITYPE.ELVEN_CLOAK, tval: TV.CLOAK, identifier: "Elven" },
  { itype: ITYPE.CLOAK, tval: TV.CLOAK, identifier: "" },
  { itype: ITYPE.SHIELD, tval: TV.SHIELD, identifier: "" },
  { itype: ITYPE.HEADGEAR, tval: TV.HELM, identifier: "" },
  { itype: ITYPE.HEADGEAR, tval: TV.CROWN, identifier: "" },
  { itype: ITYPE.HANDGEAR, tval: TV.GLOVES, identifier: "" },
  { itype: ITYPE.FEET, tval: TV.BOOTS, identifier: "" },
  { itype: ITYPE.DIGGER, tval: TV.DIGGING, identifier: "" },
  { itype: ITYPE.RING, tval: TV.RING, identifier: "" },
  { itype: ITYPE.AMULET, tval: TV.AMULET, identifier: "" },
  { itype: ITYPE.LIGHT, tval: TV.LIGHT, identifier: "" },
];

/**
 * ignore_type_of (obj-ignore.c L382): the ignore type an object belongs to, or
 * ITYPE_MAX if none (it cannot be quality-ignored).
 */
export function ignoreTypeOf(obj: GameObject): number {
  for (const q of QUALITY_MAPPING) {
    if (q.tval === obj.tval) {
      if (q.identifier && !obj.kind.name.includes(q.identifier)) continue;
      return q.itype;
    }
  }
  return ITYPE_MAX;
}

/*
 * randcalc under the minimise aspect draws no randomness, so a single shared
 * generator computes it deterministically for cmp_object_trait.
 */
const MINCALC = new Rng(1);
function minimise(v: RandomValue): number {
  return MINCALC.randcalc(v, 0, "minimise");
}

/** CMP(a, b): the sign of a - b. */
function cmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * cmp_object_trait (obj-ignore.c L434): how an object trait compares to its
 * base type. A positive base bonus is treated as zero (a positive bonus never
 * makes an item seem bad).
 */
function cmpObjectTrait(bonus: number, base: RandomValue): number {
  let amt = minimise(base);
  if (amt > 0) amt = 0;
  return cmp(bonus, amt);
}

/**
 * is_object_good (obj-ignore.c L448): whether an item seems good (positive),
 * bad (negative) or average (zero) from its to_h / to_d / to_a.
 */
export function isObjectGood(obj: GameObject): number {
  let good = 0;
  good += 4 * cmpObjectTrait(obj.toD, obj.kind.toD);
  good += 2 * cmpObjectTrait(obj.toH, obj.kind.toH);
  good += 1 * cmpObjectTrait(obj.toA, obj.kind.toA);
  return good;
}

/**
 * ignore_level_of (obj-ignore.c L464): the quality tier of an object. The port
 * treats every object as fully known, so the not-fully-known branch (which
 * returns ALL / MAX from the assessed flag) never applies.
 */
export function ignoreLevelOf(obj: GameObject): number {
  /* Jewelry is only ever bad or average. */
  if (tvalIsJewelry(obj.tval)) {
    for (let i = 0; i < OBJ_MOD_MAX; i++) {
      if ((obj.modifiers[i] ?? 0) > 0) return IGNORE.AVERAGE;
    }
    if (obj.toH > 0 || obj.toD > 0 || obj.toA > 0) return IGNORE.AVERAGE;
    if (obj.toH < 0 || obj.toD < 0 || obj.toA < 0) return IGNORE.BAD;
    return IGNORE.AVERAGE;
  }

  const isgood = isObjectGood(obj);
  let value: number =
    isgood > 0 ? IGNORE.GOOD : isgood < 0 ? IGNORE.BAD : IGNORE.AVERAGE;
  if (obj.ego) value = IGNORE.ALL;
  else if (obj.artifact) value = IGNORE.MAX;
  return value;
}

/** check_for_inscrip: the inscription contains the given tag. */
function checkForInscrip(obj: GameObject, tag: string): boolean {
  return obj.note ? obj.note.includes(tag) : false;
}

/**
 * The player's ignore choices (the obj-ignore.c file-statics: ignore_level[],
 * ego_ignore_types[][], and the per-kind kind->ignore bits). Kept off the
 * shared immutable kind / ego records so the pack stays read-only; keyed by
 * kidx / eidx instead. Everything defaults to "not ignored".
 */
export class IgnoreSettings {
  /** ignore_level[itype]: the quality tier ignored for each type. */
  readonly level = new Uint8Array(ITYPE_MAX).fill(IGNORE.NONE);
  /** ego_ignore_types[eidx][itype], keyed "eidx:itype". */
  private readonly egoSet = new Set<string>();
  /** kinds ignored when aware / unaware (kind->ignore bits), by kidx. */
  private readonly kindAware = new Set<number>();
  private readonly kindUnaware = new Set<number>();
  /** p->unignoring: temporarily show everything (the ignore menu is open). */
  unignoring = false;

  /** ego_is_ignored(eidx, itype). */
  egoIsIgnored(eidx: number, itype: number): boolean {
    return this.egoSet.has(`${eidx}:${itype}`);
  }
  /** ego_ignore_toggle(eidx, itype). */
  egoToggle(eidx: number, itype: number): void {
    const key = `${eidx}:${itype}`;
    if (this.egoSet.has(key)) this.egoSet.delete(key);
    else this.egoSet.add(key);
  }

  /** kind_is_ignored_aware / _unaware. */
  kindIsIgnoredAware(kidx: number): boolean {
    return this.kindAware.has(kidx);
  }
  kindIsIgnoredUnaware(kidx: number): boolean {
    return this.kindUnaware.has(kidx);
  }
  /** kind_ignore_when_aware / _unaware. */
  kindIgnoreWhenAware(kidx: number): void {
    this.kindAware.add(kidx);
  }
  kindIgnoreWhenUnaware(kidx: number): void {
    this.kindUnaware.add(kidx);
  }
  /** kind_ignore_clear. */
  kindIgnoreClear(kidx: number): void {
    this.kindAware.delete(kidx);
    this.kindUnaware.delete(kidx);
  }

  /** A JSON-safe snapshot for the savefile. */
  snapshot(): IgnoreSettingsData {
    return {
      level: Array.from(this.level),
      ego: Array.from(this.egoSet),
      kindAware: Array.from(this.kindAware),
      kindUnaware: Array.from(this.kindUnaware),
    };
  }
  /** Restore a snapshot() payload. */
  restore(data: IgnoreSettingsData): void {
    this.level.fill(IGNORE.NONE);
    for (let i = 0; i < data.level.length && i < ITYPE_MAX; i++) {
      this.level[i] = data.level[i] as number;
    }
    this.egoSet.clear();
    for (const k of data.ego) this.egoSet.add(k);
    this.kindAware.clear();
    for (const k of data.kindAware) this.kindAware.add(k);
    this.kindUnaware.clear();
    for (const k of data.kindUnaware) this.kindUnaware.add(k);
  }
}

/** The serialized ignore settings. */
export interface IgnoreSettingsData {
  level: number[];
  ego: string[];
  kindAware: number[];
  kindUnaware: number[];
}

/**
 * object_is_ignored (obj-ignore.c L576): whether an object is currently
 * ignored under the given settings and flavor awareness.
 */
export function objectIsIgnored(
  obj: GameObject,
  settings: IgnoreSettings,
  aware: boolean,
): boolean {
  /* Individually marked ignore. */
  if (obj.notice & OBJ_NOTICE.IGNORE) return true;

  /* Never ignore artifacts (or !k / !* inscribed items) by rule. */
  if (obj.artifact || checkForInscrip(obj, "!k") || checkForInscrip(obj, "!*")) {
    return false;
  }

  /* Ignore by kind (aware / unaware). */
  if (
    aware
      ? settings.kindIsIgnoredAware(obj.kind.kidx)
      : settings.kindIsIgnoredUnaware(obj.kind.kidx)
  ) {
    return true;
  }

  const type = ignoreTypeOf(obj);
  if (type === ITYPE_MAX) return false;

  /* Ignore ego items of an ignored ego+type. */
  if (obj.ego && settings.egoIsIgnored(obj.ego.eidx, type)) return true;

  /* Ignore anything assessed as a non-artifact when the type ignores ALL. */
  if (
    obj.notice & OBJ_NOTICE.ASSESSED &&
    !obj.artifact &&
    settings.level[type] === IGNORE.ALL
  ) {
    return true;
  }

  /* Otherwise compare the object's quality tier to the type's threshold. */
  return ignoreLevelOf(obj) <= (settings.level[type] as number);
}

/**
 * ignore_item_ok (obj-ignore.c L622): whether an object is eligible for
 * ignoring right now (false while the player is unignoring).
 */
export function ignoreItemOk(
  obj: GameObject,
  settings: IgnoreSettings,
  aware: boolean,
): boolean {
  if (settings.unignoring) return false;
  return objectIsIgnored(obj, settings, aware);
}
