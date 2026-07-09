/**
 * The live object instance (struct object from reference/src/object.h)
 * plus the pure pile/stacking helpers from obj-pile.c and the slay,
 * brand, and curse copy helpers from obj-slays.c and obj-curse.c
 * (Angband 4.2.6).
 *
 * DEFERRED (ledgered in parity/ledger/obj-model.yaml):
 * - The known/unknown split (obj->known and the whole knowledge system,
 *   obj-knowledge.c). GameObject has no `known` twin yet; stacking rules
 *   that read player knowledge run as if everything were known:
 *   - object_similar's OSTACK_LIST kind-vs-known-kind checks,
 *   - the object_fully_known comparison for wearables in list mode,
 *   - object_absorb_merge's known-object bookkeeping.
 * - object_is_equipped: there is no player gear yet, so the equipped
 *   checks at the top of object_similar are skipped.
 * - origin_race unique-favouring in object_origin_combine takes an
 *   isUnique callback (defaults to "not unique") until the monster
 *   domain lands.
 * - append_object_curse's "effect foiled by an existing property" check
 *   needs the player-timed registry (timed_effects[].fail); it is
 *   skipped, the conflict and conflict-flag checks are live.
 *
 * Held/holder references are numeric handles (0 = none), grids are Loc
 * or null; piles are managed by the world layer, so the prev/next
 * doubly-linked pile pointers of upstream are not part of GameObject.
 */

import type { FlagSet } from "../bitflag";
import { OF, TV } from "../generated";
import { addGuardi16 } from "../guard";
import type { Loc } from "../loc";
import type { RandomValue, Rng } from "../rng";
import type {
  Activation,
  Artifact,
  Brand,
  Curse,
  EffectRecordJson,
  EgoItem,
  ElementInfo,
  ObjectKind,
  Slay,
} from "./types";
import {
  EL_INFO_HATES,
  EL_INFO_IGNORE,
  ELEM_MAX,
  MAX_PVAL,
  newElemInfo,
  newOfFlags,
  OBJ_MOD_MAX,
  zeroRv,
} from "./types";

/* ------------------------------------------------------------------ */
/* tval predicates (obj-tval.c), on numeric tvals                       */
/* ------------------------------------------------------------------ */

export function tvalIsStaff(tval: number): boolean {
  return tval === TV.STAFF;
}
export function tvalIsWand(tval: number): boolean {
  return tval === TV.WAND;
}
export function tvalIsRod(tval: number): boolean {
  return tval === TV.ROD;
}
export function tvalIsPotion(tval: number): boolean {
  return tval === TV.POTION;
}
export function tvalIsScroll(tval: number): boolean {
  return tval === TV.SCROLL;
}
export function tvalIsFood(tval: number): boolean {
  return tval === TV.FOOD;
}
export function tvalIsMushroom(tval: number): boolean {
  return tval === TV.MUSHROOM;
}
export function tvalIsLight(tval: number): boolean {
  return tval === TV.LIGHT;
}
export function tvalIsRing(tval: number): boolean {
  return tval === TV.RING;
}
export function tvalIsChest(tval: number): boolean {
  return tval === TV.CHEST;
}
export function tvalIsFuel(tval: number): boolean {
  return tval === TV.FLASK;
}
export function tvalIsMoney(tval: number): boolean {
  return tval === TV.GOLD;
}
export function tvalIsDigger(tval: number): boolean {
  return tval === TV.DIGGING;
}
export function tvalCanHaveNourishment(tval: number): boolean {
  return tval === TV.FOOD || tval === TV.POTION || tval === TV.MUSHROOM;
}
export function tvalCanHaveCharges(tval: number): boolean {
  return tval === TV.STAFF || tval === TV.WAND;
}
export function tvalCanHaveTimeout(tval: number): boolean {
  return tval === TV.ROD;
}
export function tvalIsBodyArmor(tval: number): boolean {
  return (
    tval === TV.SOFT_ARMOR || tval === TV.HARD_ARMOR || tval === TV.DRAG_ARMOR
  );
}
export function tvalIsHeadArmor(tval: number): boolean {
  return tval === TV.HELM || tval === TV.CROWN;
}
export function tvalIsAmmo(tval: number): boolean {
  return tval === TV.SHOT || tval === TV.ARROW || tval === TV.BOLT;
}
export function tvalIsSharpMissile(tval: number): boolean {
  return tval === TV.ARROW || tval === TV.BOLT;
}
export function tvalIsLauncher(tval: number): boolean {
  return tval === TV.BOW;
}
export function tvalIsUseable(tval: number): boolean {
  switch (tval) {
    case TV.ROD:
    case TV.WAND:
    case TV.STAFF:
    case TV.SCROLL:
    case TV.POTION:
    case TV.FOOD:
    case TV.MUSHROOM:
      return true;
    default:
      return false;
  }
}
export function tvalCanHaveFailure(tval: number): boolean {
  return tval === TV.STAFF || tval === TV.WAND || tval === TV.ROD;
}
export function tvalIsJewelry(tval: number): boolean {
  return tval === TV.RING || tval === TV.AMULET;
}
/**
 * tval_has_variable_power (obj-tval.c L256): items whose value/price depends on
 * individual properties (weapons, launchers, ammo, armour, jewelry, lights),
 * so object_value_real prices them by object_power rather than a flat cost.
 */
export function tvalHasVariablePower(tval: number): boolean {
  switch (tval) {
    case TV.SHOT:
    case TV.ARROW:
    case TV.BOLT:
    case TV.BOW:
    case TV.DIGGING:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.SWORD:
    case TV.BOOTS:
    case TV.GLOVES:
    case TV.HELM:
    case TV.CROWN:
    case TV.SHIELD:
    case TV.CLOAK:
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
    case TV.LIGHT:
    case TV.AMULET:
    case TV.RING:
      return true;
    default:
      return false;
  }
}
export function tvalIsWeapon(tval: number): boolean {
  switch (tval) {
    case TV.SWORD:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.DIGGING:
    case TV.BOW:
    case TV.BOLT:
    case TV.ARROW:
    case TV.SHOT:
      return true;
    default:
      return false;
  }
}
export function tvalIsArmor(tval: number): boolean {
  switch (tval) {
    case TV.DRAG_ARMOR:
    case TV.HARD_ARMOR:
    case TV.SOFT_ARMOR:
    case TV.SHIELD:
    case TV.CLOAK:
    case TV.CROWN:
    case TV.HELM:
    case TV.BOOTS:
    case TV.GLOVES:
      return true;
    default:
      return false;
  }
}
export function tvalIsMeleeWeapon(tval: number): boolean {
  return (
    tval === TV.SWORD ||
    tval === TV.HAFTED ||
    tval === TV.POLEARM ||
    tval === TV.DIGGING
  );
}
export function tvalIsWearable(tval: number): boolean {
  switch (tval) {
    case TV.BOW:
    case TV.DIGGING:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.SWORD:
    case TV.BOOTS:
    case TV.GLOVES:
    case TV.HELM:
    case TV.CROWN:
    case TV.SHIELD:
    case TV.CLOAK:
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
    case TV.LIGHT:
    case TV.AMULET:
    case TV.RING:
      return true;
    default:
      return false;
  }
}
export function tvalIsEdible(tval: number): boolean {
  return tval === TV.FOOD || tval === TV.MUSHROOM;
}
export function tvalCanHaveFlavor(tval: number): boolean {
  switch (tval) {
    case TV.AMULET:
    case TV.RING:
    case TV.STAFF:
    case TV.WAND:
    case TV.ROD:
    case TV.POTION:
    case TV.MUSHROOM:
    case TV.SCROLL:
      return true;
    default:
      return false;
  }
}
export function tvalIsBook(tval: number): boolean {
  switch (tval) {
    case TV.MAGIC_BOOK:
    case TV.PRAYER_BOOK:
    case TV.NATURE_BOOK:
    case TV.SHADOW_BOOK:
    case TV.OTHER_BOOK:
      return true;
    default:
      return false;
  }
}
export function tvalIsZapper(tval: number): boolean {
  return tval === TV.WAND || tval === TV.STAFF;
}

/* ------------------------------------------------------------------ */
/* struct object                                                        */
/* ------------------------------------------------------------------ */

/** struct curse_data: per-object curse power and timeout. */
export interface CurseData {
  power: number;
  timeout: number;
}

/**
 * struct object. The known twin, pile links, and oidx list index are
 * deferred; see module docs.
 */
export interface GameObject {
  kind: ObjectKind;
  ego: EgoItem | null;
  artifact: Artifact | null;
  /** Position on the map, or null when held. */
  grid: Loc | null;
  tval: number;
  sval: number;
  pval: number;
  weight: number;
  dd: number;
  ds: number;
  ac: number;
  toA: number;
  toH: number;
  toD: number;
  flags: FlagSet;
  modifiers: number[];
  elInfo: ElementInfo[];
  brands: boolean[] | null;
  slays: boolean[] | null;
  curses: CurseData[] | null;
  /** Raw effect chain shared with the kind (effects domain binds it). */
  effect: EffectRecordJson[] | null;
  effectMsg: string;
  activation: Activation | null;
  time: RandomValue;
  timeout: number;
  number: number;
  notice: number;
  /** Monster holding us (handle, 0 = none). */
  heldMIdx: number;
  /** Monster mimicking us (handle, 0 = none). */
  mimickingMIdx: number;
  /** ORIGIN_* value. */
  origin: number;
  originDepth: number;
  /** Monster race handle that dropped it (0 = none). */
  originRace: number;
  /** Inscription, or null (upstream quark). */
  note: string | null;
}

/** A blank object (OBJECT_NULL / object_new); kind must be set later. */
export function objectNew(kind: ObjectKind): GameObject {
  return {
    kind,
    ego: null,
    artifact: null,
    grid: null,
    tval: 0,
    sval: 0,
    pval: 0,
    weight: 0,
    dd: 0,
    ds: 0,
    ac: 0,
    toA: 0,
    toH: 0,
    toD: 0,
    flags: newOfFlags(),
    modifiers: new Array<number>(OBJ_MOD_MAX).fill(0),
    elInfo: newElemInfo(),
    brands: null,
    slays: null,
    curses: null,
    effect: null,
    effectMsg: "",
    activation: null,
    time: zeroRv(),
    timeout: 0,
    number: 0,
    notice: 0,
    heldMIdx: 0,
    mimickingMIdx: 0,
    origin: 0,
    originDepth: 0,
    originRace: 0,
    note: null,
  };
}

/* ------------------------------------------------------------------ */
/* obj-slays.c copy helpers                                             */
/* ------------------------------------------------------------------ */

/** same_monsters_slain. */
export function sameMonstersSlain(
  slays: readonly (Slay | null)[],
  slay1: number,
  slay2: number,
): boolean {
  const a = slays[slay1] as Slay;
  const b = slays[slay2] as Slay;
  if (a.raceFlag !== b.raceFlag) return false;
  if (!a.base && !b.base) return true;
  if ((a.base && !b.base) || (!a.base && b.base)) return false;
  return a.base === b.base;
}

/**
 * copy_slays: union source into dest (allocating if needed), then drop
 * the lower-multiplier duplicate of any pair slaying the same monsters.
 */
export function copySlays(
  dest: boolean[] | null,
  source: boolean[] | null,
  slays: readonly (Slay | null)[],
): boolean[] | null {
  if (!source) return dest;
  const out = dest ?? new Array<boolean>(slays.length).fill(false);
  for (let i = 0; i < slays.length; i++) {
    if (source[i]) out[i] = true;
  }
  for (let i = 1; i < slays.length; i++) {
    for (let j = 1; j < i; j++) {
      if (out[i] && out[j] && sameMonstersSlain(slays, i, j)) {
        if ((slays[i] as Slay).multiplier < (slays[j] as Slay).multiplier) {
          out[i] = false;
        } else {
          out[j] = false;
        }
      }
    }
  }
  return out;
}

/** copy_brands: as copySlays, deduping on brand name. */
export function copyBrands(
  dest: boolean[] | null,
  source: boolean[] | null,
  brands: readonly (Brand | null)[],
): boolean[] | null {
  if (!source) return dest;
  const out = dest ?? new Array<boolean>(brands.length).fill(false);
  for (let i = 0; i < brands.length; i++) {
    if (source[i]) out[i] = true;
  }
  for (let i = 1; i < brands.length; i++) {
    for (let j = 1; j < i; j++) {
      if (
        out[i] &&
        out[j] &&
        (brands[i] as Brand).name === (brands[j] as Brand).name
      ) {
        if ((brands[i] as Brand).multiplier < (brands[j] as Brand).multiplier) {
          out[i] = false;
        } else {
          out[j] = false;
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* obj-curse.c                                                          */
/* ------------------------------------------------------------------ */

/**
 * copy_curses: copy template curse powers onto an object, rolling each
 * new curse's timeout from the curse's time dice.
 */
export function copyCurses(
  rng: Rng,
  obj: GameObject,
  source: number[] | null,
  curses: readonly (Curse | null)[],
): void {
  if (!source) return;
  if (!obj.curses) {
    obj.curses = newCurseData(curses.length);
  }
  for (let i = 0; i < curses.length; i++) {
    const power = source[i];
    if (!power) continue;
    const data = obj.curses[i] as CurseData;
    data.power = power;
    data.timeout = rng.randcalc(
      (curses[i] as Curse).obj.time,
      0,
      "randomise",
    );
  }
}

function newCurseData(n: number): CurseData[] {
  const out: CurseData[] = [];
  for (let i = 0; i < n; i++) out.push({ power: 0, timeout: 0 });
  return out;
}

/** curses_are_equal. */
export function cursesAreEqual(obj1: GameObject, obj2: GameObject): boolean {
  if (!obj1.curses && !obj2.curses) return true;
  if (!obj1.curses || !obj2.curses) return false;
  const n = Math.max(obj1.curses.length, obj2.curses.length);
  for (let i = 0; i < n; i++) {
    if ((obj1.curses[i]?.power ?? 0) !== (obj2.curses[i]?.power ?? 0)) {
      return false;
    }
  }
  return true;
}

/** curses_conflict: is `second` in the conflict list of `first`? */
export function cursesConflict(
  curses: readonly (Curse | null)[],
  first: number,
  second: number,
): boolean {
  const c = curses[first] as Curse;
  if (!c.conflict) return false;
  return c.conflict.includes(`|${(curses[second] as Curse).name}|`);
}

/** check_object_curses: drop the array when no curse is active. */
function checkObjectCurses(obj: GameObject): void {
  if (!obj.curses) return;
  for (const c of obj.curses) {
    if (c.power) return;
  }
  obj.curses = null;
}

/**
 * append_object_curse. The upstream check that rejects curses whose
 * TIMED_INC effect is foiled by an existing object property needs the
 * player-timed registry and is DEFERRED (see module docs); the curse
 * conflict and conflict-flag rejections are live.
 */
export function appendObjectCurse(
  rng: Rng,
  obj: GameObject,
  pick: number,
  power: number,
  curses: readonly (Curse | null)[],
): boolean {
  const c = curses[pick] as Curse;
  if (!obj.curses) obj.curses = newCurseData(curses.length);

  /* Reject conflicting curses */
  for (let i = 0; i < curses.length; i++) {
    if ((obj.curses[i] as CurseData | undefined)?.power &&
        cursesConflict(curses, i, pick)) {
      checkObjectCurses(obj);
      return false;
    }
  }

  /* DEFERRED: timed-effect foil check (needs timed_effects[].fail). */

  /* Reject curses which explicitly conflict with an object property */
  for (const flag of c.conflictFlags) {
    if (obj.flags.has(flag)) {
      checkObjectCurses(obj);
      return false;
    }
  }

  /* Adjust power if our pick is a duplicate */
  const data = obj.curses[pick] as CurseData;
  if (power > data.power) {
    data.power = power;
    data.timeout = rng.randcalc(c.obj.time, 0, "randomise");
    return true;
  }

  checkObjectCurses(obj);
  return false;
}

/**
 * modify_weight_for_curse (obj-curse.c L382): apply curse `i`'s weight
 * adjustment to `weight`. OF_MULTIPLY_WEIGHT curses scale by
 * curse->obj->weight / 100 (rounded to nearest, coercing to at least 1 when
 * the factor exceeds 1); the rest add curse->obj->weight as a flat delta.
 * Result is clamped to [0, 32767] like the int16_t upstream.
 */
export function modifyWeightForCurse(
  curses: readonly (Curse | null)[],
  i: number,
  weight: number,
): number {
  const curseObj = (curses[i] as Curse).obj;
  let result: number;
  if (curseObj.flags.has(OF.MULTIPLY_WEIGHT)) {
    let scaled = curseObj.weight > 100 ? Math.max(weight, 1) : Math.max(weight, 0);
    scaled *= curseObj.weight;
    const q = Math.trunc(scaled / 100);
    if (q < 32767) {
      result = q;
      if (scaled % 100 >= 50) result++;
    } else {
      result = 32767;
    }
  } else {
    weight = Math.max(0, weight);
    if (curseObj.weight < 0) {
      result = weight + curseObj.weight;
      if (result < 0) result = 0;
    } else {
      result =
        weight < 32767 - curseObj.weight ? weight + curseObj.weight : 32767;
    }
  }
  return result;
}

/**
 * object_weight_one (obj-util.c L276): the weight of a single item, including
 * any active curse's weight adjustment.
 *
 * `curses` is the bound curse table; when it is omitted (combat callers that do
 * not thread it, where objects never carry curses) the curse adjustment is
 * skipped, which is exactly Math.max(weight, 0) for a curse-free object.
 */
export function objectWeightOne(
  obj: { weight: number; curses: CurseData[] | null },
  curses?: readonly (Curse | null)[] | null,
): number {
  let result = Math.max(obj.weight, 0);
  if (obj.curses && curses) {
    for (let i = 1; i < curses.length; i++) {
      if (obj.curses[i]?.power) {
        result = modifyWeightForCurse(curses, i, result);
      }
    }
  }
  return result;
}

/** Sentinel for "vulnerability + resistance" during curse el_info merging. */
const RES_VULN_AND_RES = -32768;

/**
 * apply_curse_attributes (obj-curse.c L450): merge the attributes of every
 * active curse (skipping index `i` when i >= 0) into the base attributes of
 * `obj`, in place. Weight, to_a/to_h/to_d, flags, modifiers and el_info are
 * combined; brands and slays are never merged (the data files cannot give a
 * curse a brand or slay, per upstream). The caller clears obj.curses after,
 * since the curse attributes are now folded directly into the object.
 *
 * The struct field obj.ac would also take curse->obj->ac here, but no curse
 * data directive can set a curse's base AC (it is always 0), so that merge is
 * a guaranteed no-op and CurseObject omits the field.
 */
export function applyCurseAttributes(
  curses: readonly (Curse | null)[],
  i: number,
  obj: Pick<
    GameObject,
    "weight" | "toA" | "toH" | "toD" | "flags" | "modifiers" | "elInfo" | "curses"
  >,
): void {
  if (!obj.curses) return;

  for (let j = 0; j < curses.length; j++) {
    /* Ignore the requested curse and any that are not active. */
    if (j === i || !obj.curses[j]?.power) continue;
    const curse = curses[j];
    if (!curse) continue;
    const curseObj = curse.obj;

    /* The curse may modify the object's weight. */
    obj.weight = modifyWeightForCurse(curses, j, obj.weight);

    /* Curses can adjust the AC, hit and to-dam modifiers. */
    obj.toA = addGuardi16(obj.toA, curseObj.toA);
    obj.toH = addGuardi16(obj.toH, curseObj.toH);
    obj.toD = addGuardi16(obj.toD, curseObj.toD);

    /* The curse may extend the object's flags. */
    obj.flags.union(curseObj.flags);

    /* The curse's modifiers combine additively with the object's. */
    for (let k = 0; k < OBJ_MOD_MAX; k++) {
      obj.modifiers[k] = addGuardi16(
        obj.modifiers[k] ?? 0,
        curseObj.modifiers[k] ?? 0,
      );
    }

    /* Resistances combine with the standard resistance-merge lattice. */
    for (let k = 0; k < ELEM_MAX; k++) {
      const oe = obj.elInfo[k] as ElementInfo;
      const ce = curseObj.elInfo[k] as ElementInfo;
      if (oe.resLevel >= 3) {
        /* Already immune; the curse cannot change that. */
        continue;
      }
      if (oe.resLevel === 1) {
        if (ce.resLevel >= 3) oe.resLevel = 3;
        else if (ce.resLevel < 0) oe.resLevel = RES_VULN_AND_RES;
      } else if (oe.resLevel === RES_VULN_AND_RES) {
        if (ce.resLevel >= 3) oe.resLevel = 3;
      } else if (oe.resLevel < 0) {
        if (ce.resLevel >= 3) oe.resLevel = 3;
        else if (ce.resLevel === 1) oe.resLevel = RES_VULN_AND_RES;
      } else {
        /* No resistance in the base: take whatever the curse has. */
        oe.resLevel = ce.resLevel;
      }
    }
  }

  /* Vulnerability + resistance nets out to no resistance for the caller. */
  for (let j = 0; j < ELEM_MAX; j++) {
    if ((obj.elInfo[j] as ElementInfo).resLevel === RES_VULN_AND_RES) {
      (obj.elInfo[j] as ElementInfo).resLevel = 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/* obj-pile.c stacking                                                  */
/* ------------------------------------------------------------------ */

/** object_stack_t modes (obj-pile.h). */
export const OSTACK_NONE = 0;
export const OSTACK_STORE = 0x01;
export const OSTACK_PACK = 0x02;
export const OSTACK_LIST = 0x04;
export const OSTACK_MONSTER = 0x08;
export const OSTACK_FLOOR = 0x10;
export const OSTACK_QUIVER = 0x20;

/** The stacking limits objectMergeable needs from z_info. */
export interface StackLimits {
  quiverSlotSize: number;
  thrownQuiverMult: number;
}

/**
 * object_similar: can one item like obj1 stack with one like obj2,
 * ignoring inscriptions? Player-knowledge inputs are deferred (module
 * docs): the equipped checks are skipped and the OSTACK_LIST known-kind
 * and fully-known comparisons behave as if everything were known.
 */
export function objectSimilar(
  obj1: GameObject,
  obj2: GameObject,
  _mode: number,
): boolean {
  /* DEFERRED: object_is_equipped checks (no player gear yet). */

  /* Mimicked items do not stack */
  if (obj1.mimickingMIdx || obj2.mimickingMIdx) return false;

  /* DEFERRED: OSTACK_LIST unknown-item checks (knowledge system). */

  /* Identical items cannot be stacked */
  if (obj1 === obj2) return false;

  /* Require identical object kinds */
  if (obj1.kind !== obj2.kind) return false;

  /* Different flags don't stack */
  if (!obj1.flags.isEqual(obj2.flags)) return false;

  /* Different elements don't stack */
  for (let i = 0; i < ELEM_MAX; i++) {
    const a = obj1.elInfo[i] as ElementInfo;
    const b = obj2.elInfo[i] as ElementInfo;
    if (a.resLevel !== b.resLevel) return false;
    if (
      (a.flags & (EL_INFO_HATES | EL_INFO_IGNORE)) !==
      (b.flags & (EL_INFO_HATES | EL_INFO_IGNORE))
    ) {
      return false;
    }
  }

  /* Artifacts never stack */
  if (obj1.artifact || obj2.artifact) return false;

  /* Analyze the items */
  if (tvalIsChest(obj1.tval)) {
    /* Chests never stack */
    return false;
  } else if (
    tvalIsEdible(obj1.tval) ||
    tvalIsPotion(obj1.tval) ||
    tvalIsScroll(obj1.tval) ||
    tvalIsRod(obj1.tval)
  ) {
    /* Food, potions, scrolls and rods all stack nicely. */
  } else if (tvalCanHaveCharges(obj1.tval) || tvalIsMoney(obj1.tval)) {
    /* Too much gold or too many charges */
    if (obj1.pval + obj2.pval > MAX_PVAL) return false;
  } else if (
    tvalIsWeapon(obj1.tval) ||
    tvalIsArmor(obj1.tval) ||
    tvalIsJewelry(obj1.tval) ||
    tvalIsLight(obj1.tval)
  ) {
    /* Require identical values */
    if (obj1.ac !== obj2.ac) return false;
    if (obj1.dd !== obj2.dd) return false;
    if (obj1.ds !== obj2.ds) return false;

    /* Require identical bonuses */
    if (obj1.toH !== obj2.toH) return false;
    if (obj1.toD !== obj2.toD) return false;
    if (obj1.toA !== obj2.toA) return false;

    /* Require all identical modifiers */
    for (let i = 0; i < OBJ_MOD_MAX; i++) {
      if (obj1.modifiers[i] !== obj2.modifiers[i]) return false;
    }

    /* Require identical ego-item types */
    if (obj1.ego !== obj2.ego) return false;

    /* Require identical curses */
    if (!cursesAreEqual(obj1, obj2)) return false;

    /* Hack - Never stack recharging wearables ... */
    if ((obj1.timeout || obj2.timeout) && !tvalIsLight(obj1.tval)) {
      return false;
    }
    /* ... and lights must have same amount of fuel */
    else if (obj1.timeout !== obj2.timeout && tvalIsLight(obj1.tval)) {
      return false;
    }

    /* DEFERRED: OSTACK_LIST fully-known mismatch check. */
  } else {
    /* Anything else probably okay */
  }

  return true;
}

/** object_stackable: object_similar plus compatible inscriptions. */
export function objectStackable(
  obj1: GameObject,
  obj2: GameObject,
  mode: number,
): boolean {
  if (objectSimilar(obj1, obj2, mode)) {
    return !obj1.note || !obj2.note || obj1.note === obj2.note;
  }
  return false;
}

/** object_mergeable: whole stacks can merge into one. */
export function objectMergeable(
  obj1: GameObject,
  obj2: GameObject,
  mode: number,
  limits: StackLimits,
): boolean {
  const total = obj1.number + obj2.number;

  /* Check against stacking limit - except in stores which absorb anyway */
  if (!(mode & OSTACK_STORE)) {
    if (total > obj1.kind.base.maxStack) return false;
    /* The quiver can impose stricter limits. */
    if (mode & OSTACK_QUIVER) {
      if (tvalIsAmmo(obj1.tval)) {
        if (total > limits.quiverSlotSize) return false;
      } else {
        if (
          total >
          Math.trunc(limits.quiverSlotSize / limits.thrownQuiverMult)
        ) {
          return false;
        }
      }
    }
  }

  return objectStackable(obj1, obj2, mode);
}

/**
 * object_origin_combine. The unique-monster favouring needs monster
 * race data; pass isUnique to supply it (defaults to never-unique).
 */
export function objectOriginCombine(
  obj1: GameObject,
  obj2: GameObject,
  originMixed: number,
  isUnique: (raceHandle: number) => boolean = () => false,
): void {
  if (obj1.originRace !== obj2.originRace) {
    const uniq1 = obj1.originRace !== 0 && isUnique(obj1.originRace);
    const uniq2 = obj2.originRace !== 0 && isUnique(obj2.originRace);
    if (uniq1 && !uniq2) {
      /* Favour keeping record for a unique */
    } else if (uniq2 && !uniq1) {
      obj1.origin = obj2.origin;
      obj1.originDepth = obj2.originDepth;
      obj1.originRace = obj2.originRace;
    } else {
      obj1.origin = originMixed;
    }
  } else if (
    obj1.origin !== obj2.origin ||
    obj1.originDepth !== obj2.originDepth
  ) {
    obj1.origin = originMixed;
  }
}

/**
 * object_absorb_merge, minus the known-object bookkeeping (knowledge
 * system deferred).
 */
function objectAbsorbMerge(
  obj1: GameObject,
  obj2: GameObject,
  originMixed: number,
  combineChargesTimeouts: boolean,
): void {
  /* Merge inscriptions */
  if (obj2.note) obj1.note = obj2.note;

  if (combineChargesTimeouts) {
    /* Combine timeouts for rod stacking */
    if (tvalCanHaveTimeout(obj1.tval)) obj1.timeout += obj2.timeout;

    /* Combine pvals for wands and staves */
    if (tvalCanHaveCharges(obj1.tval) || tvalIsMoney(obj1.tval)) {
      const total = obj1.pval + obj2.pval;
      obj1.pval = total >= MAX_PVAL ? MAX_PVAL : total;
    }
  }

  objectOriginCombine(obj1, obj2, originMixed);
}

/**
 * object_absorb: merge two stacks into one, capping at the base's max
 * stack size. The caller deletes obj2 (upstream frees it and its known
 * twin here; pile management is the world layer's job in this port).
 */
export function objectAbsorb(
  obj1: GameObject,
  obj2: GameObject,
  originMixed: number,
): void {
  const total = obj1.number + obj2.number;
  obj1.number = Math.min(total, obj1.kind.base.maxStack);
  objectAbsorbMerge(obj1, obj2, originMixed, true);
}

/**
 * object_absorb_partial: merge a smaller stack into a larger one,
 * leaving two uneven stacks. Charges distribute in proportion to the
 * number moved (distribute_charges).
 */
export function objectAbsorbPartial(
  obj1: GameObject,
  obj2: GameObject,
  mode1: number,
  mode2: number,
  limits: StackLimits,
  originMixed: number,
): void {
  const smallest = Math.min(obj1.number, obj2.number);
  const largest = Math.max(obj1.number, obj2.number);
  let newsz1: number;
  let newsz2: number;

  if (mode1 & OSTACK_QUIVER) {
    const limit = Math.trunc(
      limits.quiverSlotSize /
        (tvalIsAmmo(obj1.tval) ? 1 : limits.thrownQuiverMult),
    );
    if (mode2 & OSTACK_QUIVER) {
      const difference = limit - largest;
      newsz1 = largest + difference;
      newsz2 = smallest - difference;
    } else {
      newsz1 = limit;
      newsz2 = largest + smallest - limit;
    }
  } else if (mode2 & OSTACK_QUIVER) {
    const limit = Math.trunc(
      limits.quiverSlotSize /
        (tvalIsAmmo(obj2.tval) ? 1 : limits.thrownQuiverMult),
    );
    newsz1 = largest + smallest - limit;
    newsz2 = limit;
  } else {
    const difference = obj1.kind.base.maxStack - largest;
    newsz1 = largest + difference;
    newsz2 = smallest - difference;
  }

  distributeCharges(obj2, obj1, obj2.number - newsz2, false);
  obj1.number = newsz1;
  obj2.number = newsz2;
  objectAbsorbMerge(obj1, obj2, originMixed, tvalIsMoney(obj1.tval));
}

/**
 * distribute_charges (obj-util.c): when amt of source's items move to
 * dest, allocate charges/timeouts between the two stacks. Rod charge
 * time uses randcalc AVERAGE on source.time (deterministic).
 */
export function distributeCharges(
  source: GameObject,
  dest: GameObject,
  amt: number,
  destNew: boolean,
): void {
  if (tvalCanHaveCharges(source.tval)) {
    const change = Math.trunc((source.pval * amt) / source.number);
    if (destNew) {
      dest.pval = change;
    } else {
      dest.pval += change;
    }
    if (amt < source.number) {
      source.pval -= change;
    }
  }

  if (tvalCanHaveTimeout(source.tval)) {
    /* randcalc(source->time, 0, AVERAGE). */
    const t = source.time;
    const chargeTime =
      t.base + Math.trunc((t.dice * (t.sides + 1)) / 2);
    let maxTime = chargeTime * amt;
    if (destNew) {
      dest.timeout = source.timeout > maxTime ? maxTime : source.timeout;
      if (amt < source.number) {
        source.timeout -= dest.timeout;
      }
    } else {
      let change = source.timeout > maxTime ? maxTime : source.timeout;
      maxTime = chargeTime * (dest.number + amt);
      if (dest.timeout < maxTime) {
        if (change > maxTime - dest.timeout) {
          change = maxTime - dest.timeout;
        }
        dest.timeout += change;
        if (amt < source.number) {
          source.timeout -= change;
        }
      }
    }
  }
}
