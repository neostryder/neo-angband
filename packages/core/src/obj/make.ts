/**
 * Object generation, ported from reference/src/obj-make.c
 * (Angband 4.2.6): object_prep, the object/ego allocation tables
 * (alloc_init_objects / alloc_init_egos), kind_is_good, get_obj_num,
 * ego_find_random, ego_apply_magic, ego_apply_minima, make_ego_item,
 * apply_magic (with its weapon/armour enchant helpers and apply_curse),
 * make_object, money_kind, and make_gold.
 *
 * LIVE vs DEFERRED (ledgered in parity/ledger/obj-make.yaml):
 * - LIVE: object_prep; the cumulative allocation tables and both
 *   get_obj_num paths (any-tval binary search, per-tval linear scan)
 *   including the great_obj level boost; ego allocation (table sorted by
 *   alloc_min, ego_find_random with the out-of-depth chance),
 *   ego_apply_magic (random sustain/power/resist picks, ego bonuses,
 *   modifiers, flags, slays/brands/curses, resists, activation),
 *   ego_apply_minima, make_ego_item (great_ego boost); apply_magic's
 *   good/great power rolls, weapon and armour enchantment (including the
 *   melee dice supercharge and ammo dice boosts), the Ring of Speed
 *   supercharge, apply_curse (see object.ts for the one deferred check
 *   inside append_object_curse); make_object's kind selection, prep,
 *   magic, and stack-size generation; make_gold/money_kind.
 * - DEFERRED: artifact creation. make_artifact and
 *   make_artifact_special return false/null stubs, so apply_magic's
 *   artifact rolls always fail (upstream consumes RNG scanning the
 *   artifact list; this port consumes none there) and make_object's
 *   special-artifact attempt falls through to its "player gets a good
 *   item" branch exactly as upstream does when no artifact is possible.
 *   copy_artifact_data IS ported (make_fake_artifact-style uses and
 *   tests), but nothing marks artifacts created.
 * - DEFERRED: make_object's book rejection (obj_kind_can_browse needs
 *   the player class), the *value out-parameter and its
 *   out-of-depth boost (object_value_real is obj-power), and
 *   pick_chest_traps for chests (chest domain); chest pvals stay 0.
 * - DEFERRED: make_gold's birth_no_selling value inflation (player
 *   options).
 */

import type { Constants } from "../constants";
import { KF, OBJ_MOD, OF, TV } from "../generated";
import type { Aspect, Rng } from "../rng";
import type { ObjRegistry } from "./bind";
import type { GameObject } from "./object";
import {
  appendObjectCurse,
  copyBrands,
  copyCurses,
  copySlays,
  objectNew,
  tvalCanHaveCharges,
  tvalIsAmmo,
  tvalIsArmor,
  tvalIsChest,
  tvalIsEdible,
  tvalIsFuel,
  tvalIsLauncher,
  tvalIsLight,
  tvalIsMeleeWeapon,
  tvalIsPotion,
  tvalIsRing,
  tvalIsWeapon,
  tvalIsWearable,
} from "./object";
import type { Artifact, ElementInfo, ObjectKind, ObjectProperty } from "./types";
import type { EgoItem } from "./types";
import { FlagSet } from "../bitflag";
import {
  EL_INFO_IGNORE,
  EL_INFO_RANDOM,
  ELEM_BASE_MIN,
  ELEM_HIGH_MAX,
  ELEM_HIGH_MIN,
  ELEM_MAX,
  NO_MINIMUM,
  OBJ_MOD_MAX,
  OBJ_PROPERTY,
  OF_SIZE,
  OFT,
  TV_MAX,
} from "./types";
import type { RandomValue } from "../rng";

/** randcalc(v, 0, MINIMISE) without an Rng (consumes no randomness). */
function randcalcMin(v: RandomValue): number {
  /* damcalc minimise returns the dice count; m_bonus minimise is 0. */
  return v.base + v.dice;
}

/* ------------------------------------------------------------------ */
/* object_prep                                                          */
/* ------------------------------------------------------------------ */

/**
 * object_prep: wipe an object clean and make it a standard object of
 * the given kind.
 *
 * Upstream quirk kept: of_copy(obj, base->flags) then
 * of_copy(obj, kind->flags) -- the second copy overwrites the first, so
 * base flags do NOT reach the object here (they were already folded
 * into nothing; only kind flags apply).
 */
export function objectPrep(
  rng: Rng,
  reg: ObjRegistry,
  constants: Constants,
  kind: ObjectKind,
  lev: number,
  randAspect: Aspect,
): GameObject {
  const obj = objectNew(kind);

  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.ac = kind.ac;
  obj.dd = kind.dd;
  obj.ds = kind.ds;
  obj.weight = kind.weight;
  obj.effect = kind.effect;
  obj.time = { ...kind.time };

  /* Default number */
  obj.number = 1;

  /* Copy flags (see quirk note above). */
  obj.flags.copy(kind.base.flags);
  obj.flags.copy(kind.flags);

  /* Assign modifiers */
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    obj.modifiers[i] = rng.randcalc(
      kind.modifiers[i] as RandomValue,
      lev,
      randAspect,
    );
  }

  /* Assign charges (wands/staves only) */
  if (tvalCanHaveCharges(obj.tval)) {
    obj.pval = rng.randcalc(kind.charge, lev, randAspect);
  }

  /* Assign pval for food, oil and launchers */
  if (
    tvalIsEdible(obj.tval) ||
    tvalIsPotion(obj.tval) ||
    tvalIsFuel(obj.tval) ||
    tvalIsLauncher(obj.tval)
  ) {
    obj.pval = rng.randcalc(kind.pval, lev, randAspect);
  }

  /* Default fuel */
  if (tvalIsLight(obj.tval)) {
    if (obj.flags.has(OF.BURNS_OUT)) obj.timeout = constants.fuelTorch;
    else if (obj.flags.has(OF.TAKES_FUEL)) obj.timeout = constants.defaultLamp;
  }

  /* Default magic */
  obj.toH = rng.randcalc(kind.toH, lev, randAspect);
  obj.toD = rng.randcalc(kind.toD, lev, randAspect);
  obj.toA = rng.randcalc(kind.toA, lev, randAspect);

  /* Default slays, brands and curses */
  obj.slays = copySlays(obj.slays, kind.slays, reg.slays);
  obj.brands = copyBrands(obj.brands, kind.brands, reg.brands);
  copyCurses(rng, obj, kind.curses, reg.curses);

  /* Default resists */
  for (let i = 0; i < ELEM_MAX; i++) {
    const dst = obj.elInfo[i] as ElementInfo;
    const src = kind.elInfo[i] as ElementInfo;
    dst.resLevel = src.resLevel;
    dst.flags = src.flags;
    dst.flags |= (kind.base.elInfo[i] as ElementInfo).flags;
  }

  return obj;
}

/* ------------------------------------------------------------------ */
/* Allocation tables                                                    */
/* ------------------------------------------------------------------ */

/** alloc_entry for the ego table. */
interface EgoAllocEntry {
  /** eidx. */
  index: number;
  level: number;
  prob2: number;
  prob3: number;
}

interface MoneyType {
  name: string;
  type: number;
}

/**
 * kind_is_good: whether a template is "good" (kind-level test only).
 */
export function kindIsGood(kind: ObjectKind): boolean {
  switch (kind.tval) {
    case TV.HARD_ARMOR:
    case TV.SOFT_ARMOR:
    case TV.DRAG_ARMOR:
    case TV.SHIELD:
    case TV.CLOAK:
    case TV.BOOTS:
    case TV.GLOVES:
    case TV.HELM:
    case TV.CROWN:
      return randcalcMin(kind.toA) >= 0;

    case TV.BOW:
    case TV.SWORD:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.DIGGING:
      return randcalcMin(kind.toH) >= 0 && randcalcMin(kind.toD) >= 0;

    case TV.BOLT:
    case TV.ARROW:
      return true;
    default:
      break;
  }

  return kind.kindFlags.has(KF.GOOD);
}

/**
 * The allocation state built by init_obj_make: cumulative kind
 * probability tables per level, per-tval totals, the ego allocation
 * table, and the money kinds.
 */
export class ObjAllocState {
  private readonly reg: ObjRegistry;
  private readonly kMax: number;
  private readonly maxObjDepth: number;
  /** Cumulative prob table: (maxObjDepth+1) rows of (kMax+1). */
  private readonly objAlloc: Uint32Array;
  private readonly objAllocGreat: Uint32Array;
  /** Per-tval totals: (maxObjDepth+1) rows of TV_MAX. */
  private readonly objTotalTval: Uint32Array;
  private readonly objTotalTvalGreat: Uint32Array;
  /** alloc_ego_table, sorted by ego alloc_min. */
  readonly egoTable: EgoAllocEntry[] = [];
  private readonly moneyTypes: MoneyType[] = [];

  constructor(reg: ObjRegistry, constants: Constants) {
    this.reg = reg;
    this.kMax = reg.kinds.length;
    this.maxObjDepth = constants.maxObjDepth;

    const rows = this.maxObjDepth + 1;
    this.objAlloc = new Uint32Array(rows * (this.kMax + 1));
    this.objAllocGreat = new Uint32Array(rows * (this.kMax + 1));
    this.objTotalTval = new Uint32Array(rows * TV_MAX);
    this.objTotalTvalGreat = new Uint32Array(rows * TV_MAX);

    /* alloc_init_objects: fill the cumulative probability tables. */
    for (let item = 0; item < this.kMax; item++) {
      const kind = reg.kinds[item] as ObjectKind;
      const min = kind.allocMin;
      const max = kind.allocMax;
      const good = kindIsGood(kind);
      for (let lev = 0; lev <= this.maxObjDepth; lev++) {
        let rarity = kind.allocProb;
        if (lev < min || lev > max) rarity = 0;
        const row = lev * (this.kMax + 1);
        this.objAlloc[row + item + 1] =
          (this.objAlloc[row + item] as number) + rarity;
        this.objTotalTval[lev * TV_MAX + kind.tval] =
          (this.objTotalTval[lev * TV_MAX + kind.tval] as number) + rarity;

        if (!good) rarity = 0;
        this.objAllocGreat[row + item + 1] =
          (this.objAllocGreat[row + item] as number) + rarity;
        this.objTotalTvalGreat[lev * TV_MAX + kind.tval] =
          (this.objTotalTvalGreat[lev * TV_MAX + kind.tval] as number) +
          rarity;
      }
    }

    /* alloc_init_egos: table sorted (grouped) by minimum depth. */
    const num = new Array<number>(this.maxObjDepth + 1).fill(0);
    const levelTotal = new Array<number>(this.maxObjDepth + 1).fill(0);
    let egoSize = 0;
    for (const ego of reg.egos) {
      if (ego.allocProb) {
        egoSize++;
        num[ego.allocMin] = (num[ego.allocMin] as number) + 1;
      }
    }
    for (let i = 1; i < this.maxObjDepth; i++) {
      num[i] = (num[i] as number) + (num[i - 1] as number);
    }
    for (let i = 0; i < egoSize; i++) {
      this.egoTable.push({ index: 0, level: 0, prob2: 0, prob3: 0 });
    }
    for (const ego of reg.egos) {
      if (!ego.allocProb) continue;
      const minLevel = ego.allocMin;
      const y = minLevel > 0 ? (num[minLevel - 1] as number) : 0;
      const z = y + (levelTotal[minLevel] as number);
      const entry = this.egoTable[z] as EgoAllocEntry;
      entry.index = ego.eidx;
      entry.level = minLevel;
      entry.prob2 = ego.allocProb;
      entry.prob3 = ego.allocProb;
      levelTotal[minLevel] = (levelTotal[minLevel] as number) + 1;
    }

    /* init_money_svals. */
    for (const kind of reg.kinds) {
      if (kind.tval === TV.GOLD) {
        this.moneyTypes.push({ name: kind.name, type: kind.sval });
      }
    }
  }

  /**
   * binary_search_probtable: index i with tbl[i] <= p < tbl[i + 1].
   */
  private static binarySearchProbtable(
    tbl: Uint32Array,
    offset: number,
    n: number,
    p: number,
  ): number {
    let ilow = 0;
    let ihigh = n;
    for (;;) {
      if (ilow === ihigh - 1) return ilow;
      const imid = ilow + Math.trunc((ihigh - ilow) / 2);
      if ((tbl[offset + imid] as number) <= p) {
        ilow = imid;
      } else {
        ihigh = imid;
      }
    }
  }

  /** get_obj_num_by_kind: choose a kind of the given tval at a level. */
  private getObjNumByKind(
    rng: Rng,
    level: number,
    good: boolean,
    tval: number,
  ): ObjectKind | null {
    const objects = good ? this.objAllocGreat : this.objAlloc;
    const totals = good ? this.objTotalTvalGreat : this.objTotalTval;
    const total = totals[level * TV_MAX + tval] as number;
    if (!total) return null;

    let value = rng.randint0(total);
    const row = level * (this.kMax + 1);
    let item = 0;
    for (; item < this.kMax; item++) {
      if ((this.reg.kinds[item] as ObjectKind).tval === tval) {
        const prob =
          (objects[row + item + 1] as number) - (objects[row + item] as number);
        if (value < prob) break;
        value -= prob;
      }
    }
    return this.reg.kinds[item] ?? null;
  }

  /**
   * get_obj_num: choose an object kind for a dungeon level; tval 0
   * allows any type. Includes the occasional great_obj level boost.
   */
  getObjNum(
    rng: Rng,
    constants: Constants,
    level: number,
    good: boolean,
    tval: number,
  ): ObjectKind | null {
    /* Occasional level boost */
    if (level > 0 && rng.oneIn(constants.greatObj)) {
      /* What a bizarre calculation */
      level =
        1 +
        Math.trunc(
          (level * this.maxObjDepth) / rng.randint1(this.maxObjDepth),
        );
    }

    /* Paranoia */
    level = Math.min(level, this.maxObjDepth);
    level = Math.max(level, 0);

    if (tval) return this.getObjNumByKind(rng, level, good, tval);

    const objects = good ? this.objAllocGreat : this.objAlloc;
    const row = level * (this.kMax + 1);

    if (!(objects[row + this.kMax] as number)) return null;
    const value = rng.randint0(objects[row + this.kMax] as number);

    const item = ObjAllocState.binarySearchProbtable(
      objects,
      row,
      this.kMax + 1,
      value,
    );
    return this.reg.kinds[item] ?? null;
  }

  /**
   * ego_find_random: select an ego that fits the object's kind. Mutates
   * prob3 per entry exactly as upstream does.
   */
  egoFindRandom(rng: Rng, obj: GameObject, level: number): EgoItem | null {
    let total = 0;
    for (const entry of this.egoTable) {
      const ego = this.reg.egos[entry.index] as EgoItem;
      entry.prob3 = 0;
      if (level <= ego.allocMax) {
        const oodChance = Math.max(2, Math.trunc((ego.allocMin - level) / 3));
        if (level >= ego.allocMin || rng.oneIn(oodChance)) {
          if (ego.possItems.has(obj.kind.kidx)) {
            entry.prob3 = entry.prob2;
          }
          total += entry.prob3;
        }
      }
    }

    if (total) {
      let value = rng.randint0(total);
      for (const entry of this.egoTable) {
        if (value < entry.prob3) {
          return this.reg.egos[entry.index] as EgoItem;
        }
        value -= entry.prob3;
      }
    }
    return null;
  }

  /** money_kind: a money kind by name, or level-appropriate. */
  moneyKind(constants: Constants, name: string, value: number): ObjectKind {
    /* (Roughly) the largest possible gold drop at max depth. */
    const maxGoldDrop = 3 * constants.maxDepth + 30;

    let rank = 0;
    for (; rank < this.moneyTypes.length; rank++) {
      if ((this.moneyTypes[rank] as MoneyType).name === name) break;
    }

    if (rank === this.moneyTypes.length) {
      rank = Math.trunc(
        (Math.trunc((value * 100) / maxGoldDrop) * this.moneyTypes.length) /
          100,
      );
    }
    if (rank >= this.moneyTypes.length) rank = this.moneyTypes.length - 1;

    const kind = this.reg.lookupKind(
      TV.GOLD,
      (this.moneyTypes[rank] as MoneyType).type,
    );
    if (!kind) throw new Error("make: no gold kinds bound");
    return kind;
  }
}

/* ------------------------------------------------------------------ */
/* Ego magic                                                            */
/* ------------------------------------------------------------------ */

/**
 * get_new_attr: choose a random flag from newf not already in flags
 * (reservoir sampling), or 0 when none is available.
 */
export function getNewAttr(rng: Rng, flags: FlagSet, newf: FlagSet): number {
  let options = 0;
  let flag = 0;
  for (const f of newf) {
    if (flags.has(f)) continue;
    if (rng.oneIn(++options)) flag = f;
  }
  return flag;
}

/** random_base_resist: a random unresisted base element, or -1. */
function randomBaseResist(rng: Rng, obj: GameObject): number {
  let count = 0;
  for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
    if ((obj.elInfo[i] as ElementInfo).resLevel === 0) count++;
  }
  if (count === 0) return -1;
  let r = rng.randint0(count);
  for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
    if ((obj.elInfo[i] as ElementInfo).resLevel !== 0) continue;
    if (r === 0) return i;
    r--;
  }
  return -1;
}

/** random_high_resist: a random unresisted high element, or -1. */
function randomHighResist(rng: Rng, obj: GameObject): number {
  let count = 0;
  for (let i = ELEM_HIGH_MIN; i < ELEM_HIGH_MAX; i++) {
    if ((obj.elInfo[i] as ElementInfo).resLevel === 0) count++;
  }
  if (count === 0) return -1;
  let r = rng.randint0(count);
  for (let i = ELEM_HIGH_MIN; i < ELEM_HIGH_MAX; i++) {
    if ((obj.elInfo[i] as ElementInfo).resLevel !== 0) continue;
    if (r === 0) return i;
    r--;
  }
  return -1;
}

/**
 * create_obj_flag_mask (obj-properties.c): a flag set of all FLAG
 * properties whose subtype (id=false) or id_type (id=true) is in the
 * given list.
 */
export function createObjFlagMask(
  properties: readonly (ObjectProperty | null)[],
  id: boolean,
  ...types: number[]
): FlagSet {
  const f = new FlagSet(OF_SIZE);
  for (const t of types) {
    for (let j = 1; j < properties.length; j++) {
      const prop = properties[j] as ObjectProperty;
      if (prop.type !== OBJ_PROPERTY.FLAG) continue;
      if ((id && prop.idType === t) || (!id && prop.subtype === t)) {
        f.on(prop.propIndex);
      }
    }
  }
  return f;
}

/**
 * ego_apply_magic: apply generation magic to an ego item.
 */
export function egoApplyMagic(
  rng: Rng,
  reg: ObjRegistry,
  obj: GameObject,
  level: number,
): void {
  const ego = obj.ego;
  if (!ego) return;
  let pick = 0;
  let resist = -1;

  /* Resist or power? */
  if (ego.kindFlags.has(KF.RAND_RES_POWER)) pick = rng.randint1(3);

  /* Extra powers */
  if (ego.kindFlags.has(KF.RAND_SUSTAIN)) {
    const newf = createObjFlagMask(reg.properties, false, OFT.SUST);
    const flag = getNewAttr(rng, obj.flags, newf);
    /* Upstream of_on with flag 0 is UB; guard (never happens live). */
    if (flag !== 0) obj.flags.on(flag);
  } else if (ego.kindFlags.has(KF.RAND_POWER) || pick === 1) {
    const newf = createObjFlagMask(reg.properties, false, OFT.PROT, OFT.MISC);
    const flag = getNewAttr(rng, obj.flags, newf);
    if (flag !== 0) obj.flags.on(flag);
  } else if (ego.kindFlags.has(KF.RAND_BASE_RES) || pick > 1) {
    /* Get a base resist if available, mark it as random */
    resist = randomBaseResist(rng, obj);
    if (resist >= 0) {
      const info = obj.elInfo[resist] as ElementInfo;
      info.resLevel = 1;
      info.flags |= EL_INFO_RANDOM | EL_INFO_IGNORE;
    }
  } else if (ego.kindFlags.has(KF.RAND_HI_RES)) {
    /* Get a high resist if available, mark it as random */
    resist = randomHighResist(rng, obj);
    if (resist >= 0) {
      const info = obj.elInfo[resist] as ElementInfo;
      info.resLevel = 1;
      info.flags |= EL_INFO_RANDOM | EL_INFO_IGNORE;
    }
  }

  /* Apply extra ego bonuses */
  obj.toH += rng.randcalc(ego.toH, level, "randomise");
  obj.toD += rng.randcalc(ego.toD, level, "randomise");
  obj.toA += rng.randcalc(ego.toA, level, "randomise");

  /* Apply modifiers */
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    const x = rng.randcalc(ego.modifiers[i] as RandomValue, level, "randomise");
    obj.modifiers[i] = (obj.modifiers[i] as number) + x;
  }

  /* Apply flags */
  obj.flags.union(ego.flags);
  obj.flags.diff(ego.flagsOff);

  /* Add slays, brands and curses */
  obj.slays = copySlays(obj.slays, ego.slays, reg.slays);
  obj.brands = copyBrands(obj.brands, ego.brands, reg.brands);
  copyCurses(rng, obj, ego.curses, reg.curses);

  /* Add resists */
  for (let i = 0; i < ELEM_MAX; i++) {
    const dst = obj.elInfo[i] as ElementInfo;
    const src = ego.elInfo[i] as ElementInfo;
    dst.resLevel = Math.max(src.resLevel, dst.resLevel);
    dst.flags |= src.flags;
  }

  /* Add activation (ego's activation will trump object's, if any). */
  if (ego.activation) {
    obj.activation = ego.activation;
    obj.time = { ...ego.time };
  }
}

/** ego_apply_minima: apply minimum standards for ego items. */
export function egoApplyMinima(obj: GameObject): void {
  const ego = obj.ego;
  if (!ego) return;

  if (ego.minToH !== NO_MINIMUM && obj.toH < ego.minToH) obj.toH = ego.minToH;
  if (ego.minToD !== NO_MINIMUM && obj.toD < ego.minToD) obj.toD = ego.minToD;
  if (ego.minToA !== NO_MINIMUM && obj.toA < ego.minToA) obj.toA = ego.minToA;

  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    if ((obj.modifiers[i] as number) < (ego.minModifiers[i] as number)) {
      obj.modifiers[i] = ego.minModifiers[i] as number;
    }
  }
}

/**
 * make_ego_item: try to find an ego for the object and apply it.
 */
export function makeEgoItem(
  rng: Rng,
  reg: ObjRegistry,
  alloc: ObjAllocState,
  constants: Constants,
  obj: GameObject,
  level: number,
): void {
  /* Cannot further improve artifacts or ego items */
  if (obj.artifact || obj.ego) return;

  /* Occasionally boost the generation level of an item */
  if (level > 0 && rng.oneIn(constants.greatEgo)) {
    level =
      1 +
      Math.trunc((level * constants.maxDepth) / rng.randint1(constants.maxDepth));
    if (level >= constants.maxDepth) level = constants.maxDepth - 1;
  }

  obj.ego = alloc.egoFindRandom(rng, obj, level);
  if (obj.ego) egoApplyMagic(rng, reg, obj, level);
}

/* ------------------------------------------------------------------ */
/* Artifacts                                                            */
/* ------------------------------------------------------------------ */

/**
 * copy_artifact_data: copy artifact data onto a prepped object.
 */
export function copyArtifactData(
  rng: Rng,
  reg: ObjRegistry,
  obj: GameObject,
  art: Artifact,
): void {
  const kind = reg.lookupKind(art.tval, art.sval);

  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    obj.modifiers[i] = art.modifiers[i] as number;
  }
  obj.ac = art.ac;
  obj.dd = art.dd;
  obj.ds = art.ds;
  obj.toA = art.toA;
  obj.toH = art.toH;
  obj.toD = art.toD;
  obj.weight = art.weight;

  /* Activations can come from the artifact or the kind */
  if (art.activation) {
    obj.activation = art.activation;
    obj.time = { ...art.time };
  } else if (kind?.activation) {
    obj.activation = kind.activation;
    obj.time = { ...kind.time };
  }

  /* Fix for artifact lights */
  obj.flags.off(OF.TAKES_FUEL);
  obj.flags.off(OF.BURNS_OUT);

  /* Timeouts are always 0 */
  obj.timeout = 0;

  obj.flags.union(art.flags);
  obj.slays = copySlays(obj.slays, art.slays, reg.slays);
  obj.brands = copyBrands(obj.brands, art.brands, reg.brands);
  copyCurses(rng, obj, art.curses, reg.curses);
  for (let i = 0; i < ELEM_MAX; i++) {
    const dst = obj.elInfo[i] as ElementInfo;
    const src = art.elInfo[i] as ElementInfo;
    if (src.resLevel !== 0) dst.resLevel = src.resLevel;
    dst.flags |= src.flags;
  }
}

/**
 * DEFERRED STUB: make_artifact (obj-make.c). Random artifact creation
 * needs artifact upkeep (created flags), the player depth, and birth
 * options; until those land this always fails, like a game where every
 * artifact has been generated. Upstream consumes RNG while scanning the
 * artifact list; this stub consumes none.
 */
export function makeArtifact(_obj: GameObject): boolean {
  return false;
}

/**
 * DEFERRED STUB: make_artifact_special (obj-make.c). See makeArtifact.
 */
export function makeArtifactSpecial(
  _level: number,
  _tval: number,
): GameObject | null {
  return null;
}

/* ------------------------------------------------------------------ */
/* apply_magic                                                          */
/* ------------------------------------------------------------------ */

/** apply_magic_weapon. */
export function applyMagicWeapon(
  rng: Rng,
  obj: GameObject,
  level: number,
  power: number,
): void {
  if (power <= 0) return;

  obj.toH += rng.randint1(5) + rng.mBonus(5, level);
  obj.toD += rng.randint1(5) + rng.mBonus(5, level);

  if (power > 1) {
    obj.toH += rng.mBonus(10, level);
    obj.toD += rng.mBonus(10, level);

    if (tvalIsMeleeWeapon(obj.tval)) {
      /* Super-charge the damage dice */
      while (obj.dd * obj.ds > 0 && rng.oneIn(4 * obj.dd * obj.ds)) {
        /* More dice or sides means more likely to get still more */
        if (rng.randint0(obj.dd + obj.ds) < obj.dd) {
          let newdice = rng.randint1(2 + Math.trunc(obj.dd / obj.ds));
          while ((obj.dd + 1) * obj.ds <= 40 && newdice) {
            if (!rng.oneIn(3)) obj.dd++;
            newdice--;
          }
        } else {
          let newsides = rng.randint1(2 + Math.trunc(obj.ds / obj.dd));
          while (obj.dd * (obj.ds + 1) <= 40 && newsides) {
            if (!rng.oneIn(3)) obj.ds++;
            newsides--;
          }
        }
      }
    } else if (tvalIsAmmo(obj.tval)) {
      /* Up to two chances to enhance damage dice. */
      if (rng.oneIn(6)) {
        obj.ds++;
        if (rng.oneIn(10)) {
          obj.ds++;
        }
      }
    }
  }
}

/** apply_magic_armour. */
export function applyMagicArmour(
  rng: Rng,
  obj: GameObject,
  level: number,
  power: number,
): void {
  if (power <= 0) return;
  obj.toA += rng.randint1(5) + rng.mBonus(5, level);
  if (power > 1) obj.toA += rng.mBonus(10, level);
}

/**
 * apply_curse (obj-make.c): try to curse an object, increasing its
 * effective generation level in exchange.
 */
export function applyCurse(
  rng: Rng,
  reg: ObjRegistry,
  obj: GameObject,
  lev: number,
): number {
  let maxCurses = rng.randint1(4);
  const power = rng.randint1(9) + 10 * rng.mBonus(9, lev);
  let newLev = lev;

  if (obj.flags.has(OF.BLESSED)) return lev;

  while (maxCurses--) {
    /* Try to curse it */
    let tries = 3;
    while (tries--) {
      const pick = rng.randint1(reg.curseMax - 1);
      const curse = reg.curses[pick];
      if (curse && curse.poss[obj.tval]) {
        if (appendObjectCurse(rng, obj, pick, power, reg.curses)) {
          newLev += rng.randint1(1 + Math.trunc(power / 10));
        }
        break;
      }
    }
  }

  return newLev;
}

/** Everything applyMagic/makeObject need, bundled. */
export interface MakeDeps {
  reg: ObjRegistry;
  alloc: ObjAllocState;
  constants: Constants;
}

/**
 * apply_magic: ego creation and random bonuses. Returns 0 for a normal
 * object, 1 good, 2 ego, 3 artifact (never 3 while artifact generation
 * is deferred; the rolls loop runs but the stub always fails).
 *
 * DEFERRED inside (see module docs): artifact creation rolls,
 * pick_chest_traps for chests.
 */
export function applyMagic(
  rng: Rng,
  deps: MakeDeps,
  obj: GameObject,
  lev: number,
  allowArtifacts: boolean,
  good: boolean,
  great: boolean,
  extraRoll: boolean,
): number {
  const { reg, alloc, constants } = deps;
  let power = 0;
  const goodChance = 33 + lev;
  const greatChance = 30;

  /* Roll for "good" */
  if (good || rng.randint0(100) < goodChance) {
    power = 1;
    /* Roll for "great" */
    if (great || rng.randint0(100) < greatChance) power = 2;
  }

  /* Roll for artifact creation (DEFERRED: stub never succeeds) */
  if (allowArtifacts) {
    let rolls = 0;
    if (power >= 2) rolls = 1;
    if (great) rolls = 2;
    if (extraRoll) rolls += 2;
    for (let i = 0; i < rolls; i++) {
      if (makeArtifact(obj)) return 3;
    }
  }

  /* Try to make an ego item */
  if (power === 2) makeEgoItem(rng, reg, alloc, constants, obj, lev);

  /* Give it a chance to be cursed */
  if (rng.oneIn(20) && tvalIsWearable(obj.tval)) {
    lev = applyCurse(rng, reg, obj, lev);
  }

  /* Apply magic */
  if (tvalIsWeapon(obj.tval)) {
    applyMagicWeapon(rng, obj, lev, power);
  } else if (tvalIsArmor(obj.tval)) {
    applyMagicArmour(rng, obj, lev, power);
  } else if (tvalIsRing(obj.tval)) {
    if (obj.sval === reg.lookupSval(obj.tval, "Speed")) {
      /* Super-charge the ring */
      while (rng.oneIn(2)) {
        obj.modifiers[OBJ_MOD_SPEED] = (obj.modifiers[OBJ_MOD_SPEED] as number) + 1;
      }
    }
  } else if (tvalIsChest(obj.tval)) {
    /* DEFERRED: pick_chest_traps (chest domain); pval stays as-is. */
  }

  /* Apply minima from ego items if necessary */
  egoApplyMinima(obj);

  return power;
}

/** OBJ_MOD_SPEED index (STR..CON are 0..4, then the modifier list). */
const OBJ_MOD_SPEED = OBJ_MOD.SPEED;

/* ------------------------------------------------------------------ */
/* make_object / make_gold                                              */
/* ------------------------------------------------------------------ */

/**
 * make_object: attempt to make an object at a creation level.
 *
 * Live: the special-artifact chance roll (the attempt itself is the
 * deferred stub, so failing it upgrades the drop to `good` exactly as
 * upstream does when no special artifact can be made), kind selection,
 * prep, apply_magic, and stack generation. DEFERRED: book rejection
 * (needs the player class), the *value out-parameter and its
 * out-of-depth boost (obj-power).
 */
export function makeObject(
  rng: Rng,
  deps: MakeDeps,
  lev: number,
  good: boolean,
  great: boolean,
  extraRoll: boolean,
  tval: number,
): GameObject | null {
  const { reg, alloc, constants } = deps;

  /* Try to make a special artifact */
  if (rng.oneIn(good ? 10 : 1000)) {
    const special = makeArtifactSpecial(lev, tval);
    if (special) return special;
    /* If we failed to make an artifact, the player gets a good item */
    good = true;
  }

  /* Base level for the object */
  const base = good ? lev + 10 : lev;

  /* Choose an object kind. DEFERRED: upstream rejects most books the
   * player cannot read (obj_kind_can_browse); no player classes are
   * bound yet, so every book is browsable here and the retry loop
   * always accepts its first pick. */
  const kind = alloc.getObjNum(rng, constants, base, good || great, tval);
  if (!kind) return null;

  /* Make the object, prep it and apply magic */
  const obj = objectPrep(rng, reg, constants, kind, lev, "randomise");
  applyMagic(rng, deps, obj, lev, true, good, great, extraRoll);

  /* Generate multiple items */
  if (!obj.artifact && kind.genMultProb >= rng.randint1(100)) {
    obj.number = rng.randcalc(kind.stackSize, lev, "randomise");
  }
  if (obj.number > obj.kind.base.maxStack) {
    obj.number = obj.kind.base.maxStack;
  }

  /* DEFERRED: *value computation and the 20%-per-level OOD boost
   * (object_value_real lives in obj-power). */

  return obj;
}

/** C SHRT_MAX, the gold pval cap. */
const SHRT_MAX = 32767;

/**
 * make_gold: make a money object. DEFERRED: the birth_no_selling
 * inflation (player options).
 */
export function makeGold(
  rng: Rng,
  deps: MakeDeps,
  lev: number,
  coinType: string,
): GameObject {
  const { reg, alloc, constants } = deps;

  /* This average is 16 at dlev0, 80 at dlev40, 176 at dlev100. */
  const avg = Math.trunc((16 * lev) / 10) + 16;
  const spread = lev + 10;
  let value = rng.randSpread(avg, spread);

  /* Increase the range to infinite, moving the average to 110% */
  while (rng.oneIn(100) && value * 10 <= SHRT_MAX) value *= 10;

  const kind = alloc.moneyKind(constants, coinType, value);
  const newGold = objectPrep(rng, reg, constants, kind, lev, "randomise");

  /* Cap gold at max short */
  if (value >= SHRT_MAX) {
    value = SHRT_MAX - rng.randint0(200);
  }
  newGold.pval = value;

  return newGold;
}
