/**
 * Random artifact generation: the data model and power-measurement half,
 * ported from reference/src/obj-randart.c (Angband 4.2.6) lines 1-1332 plus
 * the struct artifact_set_data allocator (obj-randart.c L2993) and the
 * struct definition in obj-randart.h.
 *
 * This module ports the parts of the randart generator that measure the
 * standard artifact set: it evaluates each artifact's power (artifactPower,
 * upstream artifact_power), records the baseline power statistics
 * (storeBasePower), tallies how often each ability appears (collectArtifactData
 * and the count_* helpers), and rescales those tallies into generation
 * frequencies (parseFrequencies / rescaleFreqs / adjustFreqs). The actual
 * generation of new artifacts (do_randart and its helpers, obj-randart.c
 * L1332+) is a separate, later port.
 *
 * Faithful notes / approximations:
 * - The upstream file_putf(log_file, ...) logging is dropped throughout; it
 *   never affects any returned value (same convention as power.ts).
 * - artifact_power (obj-randart.c L186) builds a "fake" object with
 *   make_fake_artifact (obj-make.c L728), which is object_prep(kind, 0,
 *   MAXIMISE) (obj-make.c L817) followed by copy_artifact_data (obj-make.c
 *   L520). artifactPower reproduces that field mapping directly into a
 *   PowerObject; the MAXIMISE and MINIMISE aspects it uses consume no RNG, so
 *   the two are inlined as pure rvMaximise/rvMinimise helpers and artifactPower
 *   needs no Rng.
 * - The fake object's curse timeouts (copy_curses, obj-curse.c) are set from a
 *   RANDOMISE dice roll upstream. Timeouts never enter object_power (cursePower
 *   reads only curse power), so artifactPower maps curse powers with timeout 0
 *   and consumes no RNG. Standard artifacts carry no curses, so RNG order in
 *   storeBasePower is unaffected either way.
 * - Upstream mean()/variance() (z-util.c L1389/L1516) are exact-rational
 *   multi-precision routines; store_base_power calls them with a non-NULL frac,
 *   which is the "round the result down" path. Artifact powers are small
 *   positive ints, so the exact value fits in a JS double and the floored
 *   result is reproduced by plain arithmetic (mean/variance below).
 */

import { ELEM, KF, OBJ_MOD, OF, TV } from "../generated";
import { ART_IDX } from "../generated/randart-properties";
import type { Rng } from "../rng";
import type { ObjRegistry } from "./bind";
import type { CurseData } from "./object";
import {
  copyBrands,
  copySlays,
  tvalCanHaveCharges,
  tvalIsEdible,
  tvalIsFuel,
  tvalIsLauncher,
  tvalIsPotion,
} from "./object";
import { objectPower } from "./power";
import type { PowerObject } from "./power";
import type { Artifact, ElementInfo, ObjectKind } from "./types";
import { ELEM_MAX, newOfFlags, OBJ_MOD_MAX, TV_MAX } from "./types";
import type { RandomValue } from "../rng";

/** ART_IDX_TOTAL: number of learned-probability slots (obj-randart.h). */
const ART_IDX_TOTAL = ART_IDX.TOTAL;

/* ------------------------------------------------------------------ */
/* struct artifact_set_data (obj-randart.h L59)                        */
/* ------------------------------------------------------------------ */

/**
 * struct artifact_set_data: everything the generator learns from the standard
 * artifact set. Field names mirror the upstream struct (snake_case -> camelCase).
 */
export interface ArtifactSetData {
  /* Mean start and increment values for to_hit, to_dam and AC. */
  hitIncrement: number;
  damIncrement: number;
  hitStartval: number;
  damStartval: number;
  acStartval: number;
  acIncrement: number;

  /* Data structures for learned probabilities. */
  artProbs: number[];
  tvProbs: number[];
  tvNum: number[];
  bowTotal: number;
  meleeTotal: number;
  bootTotal: number;
  gloveTotal: number;
  headgearTotal: number;
  shieldTotal: number;
  cloakTotal: number;
  armorTotal: number;
  otherTotal: number;
  total: number;
  negPowerTotal: number;

  /* Tval frequency values. */
  tvFreq: number[];

  /* Artifact power ratings. */
  basePower: number[];
  maxPower: number;
  minPower: number;
  avgPower: number;
  varPower: number;
  avgTvPower: number[];
  minTvPower: number[];
  maxTvPower: number[];

  /* Base item levels. */
  baseItemLevel: number[];

  /* Base item rarities. */
  baseItemProb: number[];

  /* Artifact rarities. */
  baseArtAlloc: number[];
}

/* ------------------------------------------------------------------ */
/* Arrays of indices by item type, used in frequency generation        */
/* (obj-randart.c L52)                                                 */
/* ------------------------------------------------------------------ */

const artIdxBow: readonly number[] = [
  ART_IDX.BOW_SHOTS,
  ART_IDX.BOW_MIGHT,
  ART_IDX.BOW_BRAND,
  ART_IDX.BOW_SLAY,
];
const artIdxWeapon: readonly number[] = [
  ART_IDX.WEAPON_HIT,
  ART_IDX.WEAPON_DAM,
  ART_IDX.WEAPON_AGGR,
];
const artIdxNonweapon: readonly number[] = [
  ART_IDX.NONWEAPON_HIT,
  ART_IDX.NONWEAPON_DAM,
  ART_IDX.NONWEAPON_HIT_DAM,
  ART_IDX.NONWEAPON_AGGR,
  ART_IDX.NONWEAPON_BRAND,
  ART_IDX.NONWEAPON_SLAY,
  ART_IDX.NONWEAPON_BLOWS,
  ART_IDX.NONWEAPON_SHOTS,
];
const artIdxMelee: readonly number[] = [
  ART_IDX.MELEE_BLESS,
  ART_IDX.MELEE_SINV,
  ART_IDX.MELEE_BRAND,
  ART_IDX.MELEE_SLAY,
  ART_IDX.MELEE_BLOWS,
  ART_IDX.MELEE_AC,
  ART_IDX.MELEE_DICE,
  ART_IDX.MELEE_WEIGHT,
  ART_IDX.MELEE_TUNN,
];
const artIdxAllarmor: readonly number[] = [ART_IDX.ALLARMOR_WEIGHT];
const artIdxBoot: readonly number[] = [
  ART_IDX.BOOT_AC,
  ART_IDX.BOOT_FEATHER,
  ART_IDX.BOOT_STEALTH,
  ART_IDX.BOOT_TRAP_IMM,
  ART_IDX.BOOT_SPEED,
  ART_IDX.BOOT_MOVES,
];
const artIdxGlove: readonly number[] = [
  ART_IDX.GLOVE_AC,
  ART_IDX.GLOVE_HIT_DAM,
  ART_IDX.GLOVE_FA,
  ART_IDX.GLOVE_DEX,
];
const artIdxHeadgear: readonly number[] = [
  ART_IDX.HELM_AC,
  ART_IDX.HELM_RBLIND,
  ART_IDX.HELM_ESP,
  ART_IDX.HELM_SINV,
  ART_IDX.HELM_WIS,
  ART_IDX.HELM_INT,
];
const artIdxShield: readonly number[] = [
  ART_IDX.SHIELD_AC,
  ART_IDX.SHIELD_LRES,
];
const artIdxCloak: readonly number[] = [
  ART_IDX.CLOAK_AC,
  ART_IDX.CLOAK_STEALTH,
];
const artIdxArmor: readonly number[] = [
  ART_IDX.ARMOR_AC,
  ART_IDX.ARMOR_STEALTH,
  ART_IDX.ARMOR_HLIFE,
  ART_IDX.ARMOR_CON,
  ART_IDX.ARMOR_LRES,
  ART_IDX.ARMOR_ALLRES,
  ART_IDX.ARMOR_HRES,
];

/* ------------------------------------------------------------------ */
/* Aspect helpers (pure; MAXIMISE/MINIMISE consume no RNG)             */
/* ------------------------------------------------------------------ */

/** randcalc(v, 0, MINIMISE): base + dice (see rng.ts damcalc/mBonusCalc). */
function rvMinimise(v: RandomValue): number {
  return v.base + v.dice;
}

/** randcalc(v, 0, MAXIMISE): base + dice*sides + mBonus. */
function rvMaximise(v: RandomValue): number {
  return v.base + v.dice * v.sides + v.mBonus;
}

/** Number of set entries in a 1-based boolean slay/brand array, or 0. */
function countTrue(arr: readonly boolean[] | null): number {
  if (!arr) return 0;
  let n = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]) n++;
  }
  return n;
}

/** floor(sum(nums) / size); mean() (z-util.c L1389), frac-passed path. */
function mean(nums: readonly number[]): number {
  if (nums.length <= 0) return 0;
  let sum = 0;
  for (const n of nums) sum += n;
  return Math.floor(sum / nums.length);
}

/**
 * Biased variance floored: variance() (z-util.c L1516) with unbiased=false,
 * of_mean=false and a non-NULL frac. Exact value is
 * (sum(x^2)*size - sum(x)^2) / (size*size).
 */
function variance(nums: readonly number[]): number {
  const size = nums.length;
  if (size <= 1) return 0;
  let sum = 0;
  let sumSq = 0;
  for (const n of nums) {
    sum += n;
    sumSq += n * n;
  }
  return Math.floor((sumSq * size - sum * sum) / (size * size));
}

/* ------------------------------------------------------------------ */
/* artifact_power (obj-randart.c L186)                                 */
/* ------------------------------------------------------------------ */

/**
 * Build the "fake" object object_power evaluates for an artifact, reproducing
 * make_fake_artifact (obj-make.c L728) = object_prep(kind, 0, MAXIMISE)
 * followed by copy_artifact_data (obj-make.c L520). Returns null when the
 * artifact has no tval or no base kind (make_fake_artifact would return false).
 */
function makeFakeArtifactPower(
  reg: ObjRegistry,
  art: Artifact,
): PowerObject | null {
  if (!art.tval) return null;
  const kind = reg.lookupKind(art.tval, art.sval);
  if (!kind) return null;

  /* Flags: object_prep copies base then kind flags (the second copy
   * overwrites the first, upstream quirk kept in objectPrep), then
   * copy_artifact_data clears the light-fuel flags and unions art flags. */
  const flags = newOfFlags();
  flags.copy(kind.base.flags);
  flags.copy(kind.flags);
  flags.off(OF.TAKES_FUEL);
  flags.off(OF.BURNS_OUT);
  flags.union(art.flags);

  /* Modifiers: object_prep fills from the kind (MAXIMISE), then
   * copy_artifact_data overwrites every entry with the artifact's. */
  const modifiers: number[] = new Array<number>(OBJ_MOD_MAX).fill(0);
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    modifiers[i] = art.modifiers[i] ?? 0;
  }

  /* pval: object_prep assigns charges then food/oil/launcher pval; the
   * artifact copy does not touch pval. */
  let pval = 0;
  if (tvalCanHaveCharges(art.tval)) {
    pval = rvMaximise(kind.charge);
  }
  if (
    tvalIsEdible(art.tval) ||
    tvalIsPotion(art.tval) ||
    tvalIsFuel(art.tval) ||
    tvalIsLauncher(art.tval)
  ) {
    pval = rvMaximise(kind.pval);
  }

  /* Slays/brands: object_prep copies the kind's, copy_artifact_data unions
   * the artifact's on top. */
  let slays = copySlays(null, kind.slays, reg.slays);
  slays = copySlays(slays, art.slays, reg.slays);
  let brands = copyBrands(null, kind.brands, reg.brands);
  brands = copyBrands(brands, art.brands, reg.brands);

  /* Element info: object_prep sets res_level and flags from kind (+ base
   * flags); copy_artifact_data overrides res_level with any non-zero
   * artifact level and unions the artifact ignore flags. */
  const elInfo: ElementInfo[] = [];
  for (let i = 0; i < ELEM_MAX; i++) {
    const ke = kind.elInfo[i] as ElementInfo;
    const be = kind.base.elInfo[i] as ElementInfo;
    const ae = art.elInfo[i] as ElementInfo;
    let resLevel = ke.resLevel;
    let elFlags = ke.flags | be.flags;
    if (ae.resLevel !== 0) resLevel = ae.resLevel;
    elFlags |= ae.flags;
    elInfo.push({ resLevel, flags: elFlags });
  }

  /* Curses: copy_curses copies the kind's then the artifact's powers.
   * Timeouts (a RANDOMISE roll upstream) never affect power, so they are
   * left at 0 and no RNG is consumed. */
  let curses: CurseData[] | null = null;
  if (kind.curses || art.curses) {
    curses = [];
    for (let i = 0; i < reg.curses.length; i++) {
      curses.push({ power: 0, timeout: 0 });
    }
    if (kind.curses) {
      for (let i = 0; i < reg.curses.length; i++) {
        const power = kind.curses[i] ?? 0;
        if (power) (curses[i] as CurseData).power = power;
      }
    }
    if (art.curses) {
      for (let i = 0; i < reg.curses.length; i++) {
        const power = art.curses[i] ?? 0;
        if (power) (curses[i] as CurseData).power = power;
      }
    }
  }

  /* Activation comes from the artifact or, failing that, the kind. */
  const act = art.activation ?? kind.activation;
  const activation = act ? { power: act.power } : null;

  return {
    tval: art.tval,
    toH: art.toH,
    toD: art.toD,
    toA: art.toA,
    ac: art.ac,
    dd: art.dd,
    ds: art.ds,
    weight: art.weight,
    pval,
    modifiers,
    brands,
    slays,
    flags,
    elInfo,
    curses,
    activation,
    kind: { power: kind.power, kindFlags: kind.kindFlags },
    ego: null,
  };
}

/**
 * artifact_power (obj-randart.c L186): the artifact's power, by generating a
 * fake object from the artifact and calling the common object_power.
 */
export function artifactPower(reg: ObjRegistry, art: Artifact): number {
  const obj = makeFakeArtifactPower(reg, art);
  if (!obj) return 0;
  return objectPower(reg, obj);
}

/* ------------------------------------------------------------------ */
/* store_base_power (obj-randart.c L219)                               */
/* ------------------------------------------------------------------ */

/**
 * store_base_power (obj-randart.c L219): store the original artifact power
 * ratings as a baseline, and capture the per-set and per-tval power statistics
 * and base-item info.
 */
export function storeBasePower(reg: ObjRegistry, data: ArtifactSetData): void {
  const aMax = reg.artifacts.length;

  data.maxPower = 0;
  data.minPower = INHIBIT_POWER + 1;
  data.varPower = 0;

  const fakeTotalPower: number[] = [];
  const fakeTvPower: number[][] = [];
  for (let i = 0; i < TV_MAX; i++) {
    fakeTvPower.push([]);
    data.minTvPower[i] = INHIBIT_POWER + 1;
    data.maxTvPower[i] = 0;
  }

  for (let i = 0; i < aMax; i++) {
    const art = reg.artifacts[i] ?? null;
    const power = art ? artifactPower(reg, art) : 0;
    data.basePower[i] = power;

    /* Capture power stats, ignoring cursed and uber arts. */
    if (power > data.maxPower && power < INHIBIT_POWER) {
      data.maxPower = power;
    }
    if (power < data.minPower && power > 0) {
      data.minPower = power;
    }
    if (power > 0 && power < INHIBIT_POWER && art) {
      const tval = art.tval;
      fakeTotalPower.push(power);
      fakeTvPower[tval]!.push(power);
      data.tvNum[tval] = (data.tvNum[tval] ?? 0) + 1;
      if (power < (data.minTvPower[tval] ?? 0)) data.minTvPower[tval] = power;
      if (power > (data.maxTvPower[tval] ?? 0)) data.maxTvPower[tval] = power;
    }
    if (power < 0) {
      data.negPowerTotal++;
    }

    if (!power || !art) continue;
    const kind = reg.lookupKind(art.tval, art.sval);
    if (!kind) continue;
    data.baseItemLevel[i] = kind.level;
    data.baseItemProb[i] = kind.allocProb;
    data.baseArtAlloc[i] = art.allocProb;
  }

  /* Round the result down (upstream passes frac but ignores it). */
  data.avgPower = mean(fakeTotalPower);
  data.varPower = variance(fakeTotalPower);
  for (let i = 0; i < TV_MAX; i++) {
    if (data.tvNum[i]) {
      data.avgTvPower[i] = mean(fakeTvPower[i]!);
    }
  }

  /* Store the number of different types, for use later. */
  for (let i = 0; i < aMax; i++) {
    const art = reg.artifacts[i] ?? null;
    const tval = art ? art.tval : TV.NULL;
    switch (tval) {
      case TV.SWORD:
      case TV.POLEARM:
      case TV.HAFTED:
        data.meleeTotal++;
        break;
      case TV.BOW:
        data.bowTotal++;
        break;
      case TV.SOFT_ARMOR:
      case TV.HARD_ARMOR:
      case TV.DRAG_ARMOR:
        data.armorTotal++;
        break;
      case TV.SHIELD:
        data.shieldTotal++;
        break;
      case TV.CLOAK:
        data.cloakTotal++;
        break;
      case TV.HELM:
      case TV.CROWN:
        data.headgearTotal++;
        break;
      case TV.GLOVES:
        data.gloveTotal++;
        break;
      case TV.BOOTS:
        data.bootTotal++;
        break;
      case TV.NULL:
        break;
      default:
        data.otherTotal++;
    }
    data.total++;
  }
}

/* ------------------------------------------------------------------ */
/* Ability counters (obj-randart.c L342-L1053)                         */
/* ------------------------------------------------------------------ */

/**
 * count_weapon_abilities (obj-randart.c L342): handle weapon combat abilities.
 */
export function countWeaponAbilities(
  reg: ObjRegistry,
  art: Artifact,
  data: ArtifactSetData,
): void {
  const kind = reg.lookupKind(art.tval, art.sval);
  if (!kind) return;
  const minToH = rvMinimise(kind.toH);
  const minToD = rvMinimise(kind.toD);
  const minToA = rvMinimise(kind.toA);

  /* To-hit and to-dam. */
  let bonus = Math.trunc(
    (art.toH - minToH - data.hitStartval) / data.hitIncrement,
  );
  data.artProbs[ART_IDX.WEAPON_HIT]! += bonus;

  bonus = Math.trunc((art.toD - minToD - data.damStartval) / data.damIncrement);
  data.artProbs[ART_IDX.WEAPON_DAM]! += bonus;

  /* Does this weapon have an unusual bonus to AC? */
  bonus = Math.trunc((art.toA - minToA) / data.acIncrement);
  if (art.toA > 20) {
    data.artProbs[ART_IDX.MELEE_AC_SUPER]!++;
  } else if (bonus > 0) {
    data.artProbs[ART_IDX.MELEE_AC]! += bonus;
  }

  /* Check damage dice - are they more than normal? */
  if (art.dd > kind.dd) {
    if (art.dd - kind.dd > 2) {
      data.artProbs[ART_IDX.MELEE_DICE_SUPER]!++;
    } else {
      data.artProbs[ART_IDX.MELEE_DICE]!++;
    }
  }

  /* Check weight - is it different from normal? */
  if (art.weight !== kind.weight) {
    data.artProbs[ART_IDX.MELEE_WEIGHT]!++;
  }

  /* Do we have 3 or more extra blows? */
  const blows = art.modifiers[OBJ_MOD.BLOWS] ?? 0;
  if (blows > 2) {
    data.artProbs[ART_IDX.MELEE_BLOWS_SUPER]!++;
  } else if (blows > 0) {
    data.artProbs[ART_IDX.MELEE_BLOWS]!++;
  }

  /* Aggravation. */
  if (art.flags.has(OF.AGGRAVATE)) {
    data.artProbs[ART_IDX.WEAPON_AGGR]!++;
  }

  /* Blessed weapon? */
  if (art.flags.has(OF.BLESSED)) {
    data.artProbs[ART_IDX.MELEE_BLESS]!++;
  }

  /* See invisible? */
  if (art.flags.has(OF.SEE_INVIS)) {
    data.artProbs[ART_IDX.MELEE_SINV]!++;
  }

  /* Tunnelling ability. */
  if ((art.modifiers[OBJ_MOD.TUNNEL] ?? 0) > 0) {
    data.artProbs[ART_IDX.MELEE_TUNN]!++;
  }

  /* Count brands and slays. */
  if (art.slays) {
    data.artProbs[ART_IDX.MELEE_SLAY]! += countTrue(art.slays);
  }
  if (art.brands) {
    data.artProbs[ART_IDX.MELEE_BRAND]! += countTrue(art.brands);
  }
}

/**
 * count_bow_abilities (obj-randart.c L444): count combat abilities on bows.
 */
export function countBowAbilities(
  reg: ObjRegistry,
  art: Artifact,
  data: ArtifactSetData,
): void {
  const kind = reg.lookupKind(art.tval, art.sval);
  if (!kind) return;
  const minToH = rvMinimise(kind.toH);
  const minToD = rvMinimise(kind.toD);
  const minToA = rvMinimise(kind.toA);

  /* To-hit. */
  let bonus = Math.trunc(
    (art.toH - minToH - data.hitStartval) / data.hitIncrement,
  );
  data.artProbs[ART_IDX.WEAPON_HIT]! += bonus;

  /* To-dam. */
  bonus = Math.trunc((art.toD - minToD - data.damStartval) / data.damIncrement);
  data.artProbs[ART_IDX.WEAPON_DAM]! += bonus;

  /* Armor class. */
  bonus = Math.trunc((art.toA - minToA - data.acStartval) / data.acIncrement);
  if (bonus > 0) {
    data.artProbs[ART_IDX.GEN_AC]! += bonus;
  }

  /* Aggravation. */
  if (art.flags.has(OF.AGGRAVATE)) {
    data.artProbs[ART_IDX.WEAPON_AGGR]!++;
  }

  /* Do we have more than 1 extra shot? */
  const shots = art.modifiers[OBJ_MOD.SHOTS] ?? 0;
  if (shots > 10) {
    data.artProbs[ART_IDX.BOW_SHOTS_SUPER]!++;
  } else if (shots > 0) {
    data.artProbs[ART_IDX.BOW_SHOTS]!++;
  }

  /* Do we have 3 or more extra might? */
  const might = art.modifiers[OBJ_MOD.MIGHT] ?? 0;
  if (might > 2) {
    data.artProbs[ART_IDX.BOW_MIGHT_SUPER]!++;
  } else if (might > 0) {
    data.artProbs[ART_IDX.BOW_MIGHT]!++;
  }

  /* Count brands and slays. */
  if (art.slays) {
    data.artProbs[ART_IDX.BOW_SLAY]! += countTrue(art.slays);
  }
  if (art.brands) {
    data.artProbs[ART_IDX.BOW_BRAND]! += countTrue(art.brands);
  }
}

/**
 * count_nonweapon_abilities (obj-randart.c L516): handle nonweapon combat
 * abilities.
 */
export function countNonweaponAbilities(
  reg: ObjRegistry,
  art: Artifact,
  data: ArtifactSetData,
): void {
  const kind = reg.lookupKind(art.tval, art.sval);
  if (!kind) return;
  const toHit = art.toH - rvMinimise(kind.toH);
  const toDam = art.toD - rvMinimise(kind.toD);
  const toA = art.toA - rvMinimise(kind.toA) - data.acStartval;
  let bonus = Math.trunc(toA / data.acIncrement);

  /* Armor class. */
  if (bonus > 0) {
    if (art.toA > 20) {
      data.artProbs[ART_IDX.GEN_AC_SUPER]!++;
    } else if (art.tval === TV.BOOTS) {
      data.artProbs[ART_IDX.BOOT_AC]! += bonus;
    } else if (art.tval === TV.GLOVES) {
      data.artProbs[ART_IDX.GLOVE_AC]! += bonus;
    } else if (art.tval === TV.HELM || art.tval === TV.CROWN) {
      data.artProbs[ART_IDX.HELM_AC]! += bonus;
    } else if (art.tval === TV.SHIELD) {
      data.artProbs[ART_IDX.SHIELD_AC]! += bonus;
    } else if (art.tval === TV.CLOAK) {
      data.artProbs[ART_IDX.CLOAK_AC]! += bonus;
    } else if (
      art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR
    ) {
      data.artProbs[ART_IDX.ARMOR_AC]! += bonus;
    } else {
      data.artProbs[ART_IDX.GEN_AC]! += bonus;
    }
  }

  /* To hit and dam bonuses. */
  if (toHit > 0 && toDam > 0) {
    bonus = Math.trunc(
      (toHit + toDam) / (data.hitIncrement + data.damIncrement),
    );
    if (bonus > 0) {
      if (art.tval === TV.GLOVES) {
        data.artProbs[ART_IDX.GLOVE_HIT_DAM]! += bonus;
      } else {
        data.artProbs[ART_IDX.NONWEAPON_HIT_DAM]! += bonus;
      }
    }
  } else if (toHit > 0) {
    bonus = Math.trunc(toHit / data.hitIncrement);
    if (bonus > 0) {
      data.artProbs[ART_IDX.NONWEAPON_HIT]! += bonus;
    }
  } else if (toDam > 0) {
    bonus = Math.trunc(toDam / data.damIncrement);
    if (bonus > 0) {
      data.artProbs[ART_IDX.NONWEAPON_DAM]! += bonus;
    }
  }

  /* Check weight - is it different from normal? */
  if (art.weight !== kind.weight) {
    data.artProbs[ART_IDX.ALLARMOR_WEIGHT]!++;
  }

  /* Aggravation. */
  if (art.flags.has(OF.AGGRAVATE)) {
    data.artProbs[ART_IDX.NONWEAPON_AGGR]!++;
  }

  /* Count brands and slays. */
  if (art.slays) {
    data.artProbs[ART_IDX.NONWEAPON_SLAY]! += countTrue(art.slays);
  }
  if (art.brands) {
    data.artProbs[ART_IDX.NONWEAPON_BRAND]! += countTrue(art.brands);
  }

  /* Blows. */
  if ((art.modifiers[OBJ_MOD.BLOWS] ?? 0) > 0) {
    data.artProbs[ART_IDX.NONWEAPON_BLOWS]!++;
  }

  /* Shots. */
  if ((art.modifiers[OBJ_MOD.SHOTS] ?? 0) > 0) {
    data.artProbs[ART_IDX.NONWEAPON_SHOTS]!++;
  }

  /* Tunnelling ability. */
  if ((art.modifiers[OBJ_MOD.TUNNEL] ?? 0) > 0) {
    data.artProbs[ART_IDX.GEN_TUNN]!++;
  }
}

/**
 * count_modifiers (obj-randart.c L630): count stat and other modifier bonuses.
 */
export function countModifiers(art: Artifact, data: ArtifactSetData): void {
  let num = 0;

  /* Stat bonuses. Add up the number of individual bonuses. */
  if ((art.modifiers[OBJ_MOD.STR] ?? 0) > 0) num++;
  if ((art.modifiers[OBJ_MOD.INT] ?? 0) > 0) num++;
  if ((art.modifiers[OBJ_MOD.WIS] ?? 0) > 0) num++;
  if ((art.modifiers[OBJ_MOD.DEX] ?? 0) > 0) num++;
  if ((art.modifiers[OBJ_MOD.CON] ?? 0) > 0) num++;

  /* Handle a few special cases separately. */
  if (
    (art.tval === TV.HELM || art.tval === TV.CROWN) &&
    ((art.modifiers[OBJ_MOD.WIS] ?? 0) > 0 ||
      (art.modifiers[OBJ_MOD.INT] ?? 0) > 0)
  ) {
    if ((art.modifiers[OBJ_MOD.WIS] ?? 0) > 0) {
      data.artProbs[ART_IDX.HELM_WIS]!++;
      num--;
    }
    if ((art.modifiers[OBJ_MOD.INT] ?? 0) > 0) {
      data.artProbs[ART_IDX.HELM_INT]!++;
      num--;
    }
  } else if (
    (art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR) &&
    (art.modifiers[OBJ_MOD.CON] ?? 0) > 0
  ) {
    data.artProbs[ART_IDX.ARMOR_CON]!++;
    num--;
  } else if (art.tval === TV.GLOVES && (art.modifiers[OBJ_MOD.DEX] ?? 0) > 0) {
    data.artProbs[ART_IDX.GLOVE_DEX]!++;
    num--;
  }

  /* Now the general case. */
  if (num > 0) {
    data.artProbs[ART_IDX.GEN_STAT]! += num;
  }

  /* Handle stealth, including a couple of special cases. */
  if ((art.modifiers[OBJ_MOD.STEALTH] ?? 0) > 0) {
    if (art.tval === TV.BOOTS) {
      data.artProbs[ART_IDX.BOOT_STEALTH]!++;
    } else if (art.tval === TV.CLOAK) {
      data.artProbs[ART_IDX.CLOAK_STEALTH]!++;
    } else if (
      art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR
    ) {
      data.artProbs[ART_IDX.ARMOR_STEALTH]!++;
    } else {
      data.artProbs[ART_IDX.GEN_STEALTH]!++;
    }
  }

  /* Searching bonus - fully generic. */
  if ((art.modifiers[OBJ_MOD.SEARCH] ?? 0) > 0) {
    data.artProbs[ART_IDX.GEN_SEARCH]!++;
  }

  /* Infravision bonus - fully generic. */
  if ((art.modifiers[OBJ_MOD.INFRA] ?? 0) > 0) {
    data.artProbs[ART_IDX.GEN_INFRA]!++;
  }

  /* Damage reduction bonus - fully generic. */
  if ((art.modifiers[OBJ_MOD.DAM_RED] ?? 0) > 0) {
    data.artProbs[ART_IDX.GEN_DAM_RED]!++;
  }

  /* Moves bonus. */
  if ((art.modifiers[OBJ_MOD.MOVES] ?? 0) > 0) {
    if (art.tval === TV.BOOTS) {
      data.artProbs[ART_IDX.BOOT_MOVES]!++;
    } else {
      data.artProbs[ART_IDX.GEN_MOVES]!++;
    }
  }

  /* Speed - boots handled separately, supercharge shares its frequency. */
  const speed = art.modifiers[OBJ_MOD.SPEED] ?? 0;
  if (speed > 0) {
    if (speed > 7) {
      data.artProbs[ART_IDX.GEN_SPEED_SUPER]!++;
    } else if (art.tval === TV.BOOTS) {
      data.artProbs[ART_IDX.BOOT_SPEED]!++;
    } else {
      data.artProbs[ART_IDX.GEN_SPEED]!++;
    }
  }

  /* Permanent light. */
  if ((art.modifiers[OBJ_MOD.LIGHT] ?? 0) > 0) {
    data.artProbs[ART_IDX.GEN_LIGHT]!++;
  }
}

/**
 * count_low_resists (obj-randart.c L764): count low resists and immunities.
 */
export function countLowResists(art: Artifact, data: ArtifactSetData): void {
  let num = 0;

  /* Count up immunities for this item, if any. */
  if ((art.elInfo[ELEM.ACID] as ElementInfo).resLevel === 3) num++;
  if ((art.elInfo[ELEM.ELEC] as ElementInfo).resLevel === 3) num++;
  if ((art.elInfo[ELEM.FIRE] as ElementInfo).resLevel === 3) num++;
  if ((art.elInfo[ELEM.COLD] as ElementInfo).resLevel === 3) num++;

  data.artProbs[ART_IDX.GEN_IMMUNE]! += num;

  /* Count up low resists (not the type, just the number). */
  num = 0;
  if ((art.elInfo[ELEM.ACID] as ElementInfo).resLevel === 1) num++;
  if ((art.elInfo[ELEM.ELEC] as ElementInfo).resLevel === 1) num++;
  if ((art.elInfo[ELEM.FIRE] as ElementInfo).resLevel === 1) num++;
  if ((art.elInfo[ELEM.COLD] as ElementInfo).resLevel === 1) num++;

  if (num) {
    if (art.tval === TV.SHIELD) {
      data.artProbs[ART_IDX.SHIELD_LRES]! += num;
    } else if (
      art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR
    ) {
      if (num === 4) {
        data.artProbs[ART_IDX.ARMOR_ALLRES]!++;
      } else {
        data.artProbs[ART_IDX.ARMOR_LRES]! += num;
      }
    } else {
      data.artProbs[ART_IDX.GEN_LRES]! += num;
    }
  }
}

/**
 * count_high_resists (obj-randart.c L816): count high resists and protections.
 */
export function countHighResists(art: Artifact, data: ArtifactSetData): void {
  let num = 0;

  /* Body armor: count all high resists as an aggregate first. */
  if (
    art.tval === TV.SOFT_ARMOR ||
    art.tval === TV.HARD_ARMOR ||
    art.tval === TV.DRAG_ARMOR
  ) {
    if ((art.elInfo[ELEM.POIS] as ElementInfo).resLevel === 1) num++;
    if (art.flags.has(OF.PROT_FEAR)) num++;
    if ((art.elInfo[ELEM.LIGHT] as ElementInfo).resLevel === 1) num++;
    if ((art.elInfo[ELEM.DARK] as ElementInfo).resLevel === 1) num++;
    if (art.flags.has(OF.PROT_BLIND)) num++;
    if (art.flags.has(OF.PROT_CONF)) num++;
    if ((art.elInfo[ELEM.SOUND] as ElementInfo).resLevel === 1) num++;
    if ((art.elInfo[ELEM.SHARD] as ElementInfo).resLevel === 1) num++;
    if ((art.elInfo[ELEM.NEXUS] as ElementInfo).resLevel === 1) num++;
    if ((art.elInfo[ELEM.NETHER] as ElementInfo).resLevel === 1) num++;
    if ((art.elInfo[ELEM.CHAOS] as ElementInfo).resLevel === 1) num++;
    if ((art.elInfo[ELEM.DISEN] as ElementInfo).resLevel === 1) num++;
    if (art.flags.has(OF.PROT_STUN)) num++;
    data.artProbs[ART_IDX.ARMOR_HRES]! += num;
  }

  /* Now do the high resists individually. */
  if ((art.elInfo[ELEM.POIS] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RPOIS]!++;
  }
  if (art.flags.has(OF.PROT_FEAR)) {
    data.artProbs[ART_IDX.GEN_RFEAR]!++;
  }
  if ((art.elInfo[ELEM.LIGHT] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RLIGHT]!++;
  }
  if ((art.elInfo[ELEM.DARK] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RDARK]!++;
  }
  if (art.flags.has(OF.PROT_BLIND)) {
    if (art.tval === TV.HELM || art.tval === TV.CROWN) {
      data.artProbs[ART_IDX.HELM_RBLIND]!++;
    } else {
      data.artProbs[ART_IDX.GEN_RBLIND]!++;
    }
  }
  if (art.flags.has(OF.PROT_CONF)) {
    data.artProbs[ART_IDX.GEN_RCONF]!++;
  }
  if ((art.elInfo[ELEM.SOUND] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RSOUND]!++;
  }
  if ((art.elInfo[ELEM.SHARD] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RSHARD]!++;
  }
  if ((art.elInfo[ELEM.NEXUS] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RNEXUS]!++;
  }
  if ((art.elInfo[ELEM.NETHER] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RNETHER]!++;
  }
  if ((art.elInfo[ELEM.CHAOS] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RCHAOS]!++;
  }
  if ((art.elInfo[ELEM.DISEN] as ElementInfo).resLevel === 1) {
    data.artProbs[ART_IDX.GEN_RDISEN]!++;
  }
  if (art.flags.has(OF.PROT_STUN)) {
    data.artProbs[ART_IDX.GEN_PSTUN]!++;
  }
}

/**
 * count_abilities (obj-randart.c L943): general abilities, adding some to a
 * specific item-type tally depending on the base item.
 */
export function countAbilities(
  reg: ObjRegistry,
  art: Artifact,
  data: ArtifactSetData,
): void {
  const kind = reg.lookupKind(art.tval, art.sval);

  /* Sustains. */
  if (
    art.flags.has(OF.SUST_STR) ||
    art.flags.has(OF.SUST_INT) ||
    art.flags.has(OF.SUST_WIS) ||
    art.flags.has(OF.SUST_DEX) ||
    art.flags.has(OF.SUST_CON)
  ) {
    let num = 0;
    if (art.flags.has(OF.SUST_STR)) num++;
    if (art.flags.has(OF.SUST_INT)) num++;
    if (art.flags.has(OF.SUST_WIS)) num++;
    if (art.flags.has(OF.SUST_DEX)) num++;
    if (art.flags.has(OF.SUST_CON)) num++;
    data.artProbs[ART_IDX.GEN_SUST]! += num;
  }

  /* Free action - handle gloves separately. */
  if (art.flags.has(OF.FREE_ACT)) {
    if (art.tval === TV.GLOVES) {
      data.artProbs[ART_IDX.GLOVE_FA]!++;
    } else {
      data.artProbs[ART_IDX.GEN_FA]!++;
    }
  }

  /* Hold life - do body armor separately. */
  if (art.flags.has(OF.HOLD_LIFE)) {
    if (
      art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR
    ) {
      data.artProbs[ART_IDX.ARMOR_HLIFE]!++;
    } else {
      data.artProbs[ART_IDX.GEN_HLIFE]!++;
    }
  }

  /* Feather fall - handle boots separately. */
  if (art.flags.has(OF.FEATHER)) {
    if (art.tval === TV.BOOTS) {
      data.artProbs[ART_IDX.BOOT_FEATHER]!++;
    } else {
      data.artProbs[ART_IDX.GEN_FEATHER]!++;
    }
  }

  /* See invisible - do helms/crowns separately (weapons already handled). */
  if (art.flags.has(OF.SEE_INVIS)) {
    if (
      !(
        art.tval === TV.DIGGING ||
        art.tval === TV.HAFTED ||
        art.tval === TV.POLEARM ||
        art.tval === TV.SWORD
      )
    ) {
      if (art.tval === TV.HELM || art.tval === TV.CROWN) {
        data.artProbs[ART_IDX.HELM_SINV]!++;
      } else {
        data.artProbs[ART_IDX.GEN_SINV]!++;
      }
    }
  }

  /* ESP - handle helms/crowns separately. */
  if (art.flags.has(OF.TELEPATHY)) {
    if (art.tval === TV.HELM || art.tval === TV.CROWN) {
      data.artProbs[ART_IDX.HELM_ESP]!++;
    } else {
      data.artProbs[ART_IDX.GEN_ESP]!++;
    }
  }

  /* Slow digestion - generic. */
  if (art.flags.has(OF.SLOW_DIGEST)) {
    data.artProbs[ART_IDX.GEN_SDIG]!++;
  }

  /* Regeneration - generic. */
  if (art.flags.has(OF.REGEN)) {
    data.artProbs[ART_IDX.GEN_REGEN]!++;
  }

  /* Trap immunity - handle boots separately. */
  if (art.flags.has(OF.TRAP_IMMUNE)) {
    if (art.tval === TV.BOOTS) {
      data.artProbs[ART_IDX.BOOT_TRAP_IMM]!++;
    } else {
      data.artProbs[ART_IDX.GEN_TRAP_IMM]!++;
    }
  }

  /* Activation. */
  if (art.activation || kind?.activation) {
    data.artProbs[ART_IDX.GEN_ACTIV]!++;
  }
}

/* ------------------------------------------------------------------ */
/* collect_artifact_data (obj-randart.c L1059)                         */
/* ------------------------------------------------------------------ */

/**
 * collect_artifact_data (obj-randart.c L1059): parse the standard artifacts and
 * count up the frequencies of the various abilities.
 */
export function collectArtifactCounts(
  reg: ObjRegistry,
  data: ArtifactSetData,
): void {
  const aMax = reg.artifacts.length;

  for (let i = 0; i < aMax; i++) {
    const art = reg.artifacts[i] ?? null;
    if (!art) continue;

    /* Don't parse cursed or null items. */
    if ((data.basePower[i] ?? 0) < 0 || art.tval === 0) continue;

    const kind = reg.lookupKind(art.tval, art.sval);
    if (!kind) continue;

    /* Special cases -- don't parse these! */
    if (art.name.includes("The One Ring") || kind.kindFlags.has(KF.QUEST_ART)) {
      continue;
    }

    /* Add the base item tval to the tv_probs array. */
    data.tvProbs[kind.tval] = (data.tvProbs[kind.tval] ?? 0) + 1;

    /* Count combat abilities broken up by type. */
    if (
      art.tval === TV.DIGGING ||
      art.tval === TV.HAFTED ||
      art.tval === TV.POLEARM ||
      art.tval === TV.SWORD
    ) {
      countWeaponAbilities(reg, art, data);
    } else if (art.tval === TV.BOW) {
      countBowAbilities(reg, art, data);
    } else {
      countNonweaponAbilities(reg, art, data);
    }

    /* Count other properties. */
    countModifiers(art, data);
    countLowResists(art, data);
    countHighResists(art, data);
    countAbilities(reg, art, data);
  }
}

/* ------------------------------------------------------------------ */
/* Frequency rescaling (obj-randart.c L1124-L1265)                     */
/* ------------------------------------------------------------------ */

/** Rescale one index group by total / denom (integer division, in place). */
function rescaleGroup(
  data: ArtifactSetData,
  group: readonly number[],
  denom: number,
): void {
  for (const idx of group) {
    data.artProbs[idx] = Math.trunc((data.artProbs[idx]! * data.total) / denom);
  }
}

/**
 * rescale_freqs (obj-randart.c L1124): rescale item-dependent ability
 * frequencies as though the whole set were made of that item type, so
 * dependent and independent abilities become comparable.
 */
export function rescaleFreqs(data: ArtifactSetData): void {
  /* Bow-only abilities. */
  rescaleGroup(data, artIdxBow, data.bowTotal);

  /* All weapon abilities. */
  rescaleGroup(data, artIdxWeapon, data.bowTotal + data.meleeTotal);

  /* Corresponding non-weapon abilities. */
  const nonweaponDenom = data.total - data.meleeTotal - data.bowTotal;
  rescaleGroup(data, artIdxNonweapon, nonweaponDenom);

  /* All melee weapon abilities. */
  rescaleGroup(data, artIdxMelee, data.meleeTotal);

  /* All general armor abilities. */
  const allArmorDenom =
    data.armorTotal +
    data.bootTotal +
    data.shieldTotal +
    data.headgearTotal +
    data.cloakTotal +
    data.gloveTotal;
  rescaleGroup(data, artIdxAllarmor, allArmorDenom);

  /* Boots. */
  rescaleGroup(data, artIdxBoot, data.bootTotal);
  /* Gloves. */
  rescaleGroup(data, artIdxGlove, data.gloveTotal);
  /* Headgear. */
  rescaleGroup(data, artIdxHeadgear, data.headgearTotal);
  /* Shields. */
  rescaleGroup(data, artIdxShield, data.shieldTotal);
  /* Cloaks. */
  rescaleGroup(data, artIdxCloak, data.cloakTotal);
  /* Body armor. */
  rescaleGroup(data, artIdxArmor, data.armorTotal);
}

/**
 * adjust_freqs (obj-randart.c L1214): enforce minimum frequencies for
 * abilities that might be missing from the standard set, and halve the
 * aggravation frequencies (which are counted twice).
 */
export function adjustFreqs(data: ArtifactSetData): void {
  const atLeast = (idx: number, min: number): void => {
    if (data.artProbs[idx]! < min) data.artProbs[idx] = min;
  };

  atLeast(ART_IDX.GEN_RFEAR, 5);
  atLeast(ART_IDX.MELEE_DICE_SUPER, 5);
  atLeast(ART_IDX.BOW_SHOTS_SUPER, 5);
  atLeast(ART_IDX.BOW_MIGHT_SUPER, 5);
  atLeast(ART_IDX.MELEE_BLOWS_SUPER, 5);
  atLeast(ART_IDX.GEN_SPEED_SUPER, 5);
  atLeast(ART_IDX.GEN_AC, 5);
  atLeast(ART_IDX.GEN_TUNN, 5);
  atLeast(ART_IDX.NONWEAPON_BRAND, 2);
  atLeast(ART_IDX.NONWEAPON_SLAY, 1);
  atLeast(ART_IDX.BOW_BRAND, 2);
  atLeast(ART_IDX.BOW_SLAY, 2);
  atLeast(ART_IDX.NONWEAPON_BLOWS, 1);
  atLeast(ART_IDX.NONWEAPON_SHOTS, 1);
  atLeast(ART_IDX.GEN_AC_SUPER, 5);
  atLeast(ART_IDX.MELEE_AC, 5);
  atLeast(ART_IDX.GEN_PSTUN, 3);

  /* Cut aggravation frequencies in half since they're used twice. */
  data.artProbs[ART_IDX.NONWEAPON_AGGR] = Math.trunc(
    data.artProbs[ART_IDX.NONWEAPON_AGGR]! / 2,
  );
  data.artProbs[ART_IDX.WEAPON_AGGR] = Math.trunc(
    data.artProbs[ART_IDX.WEAPON_AGGR]! / 2,
  );
}

/**
 * parse_frequencies (obj-randart.c L1273): parse the artifacts and write
 * frequencies of their abilities and base object kinds, building the dynamic
 * generation probabilities.
 */
export function parseFrequencies(reg: ObjRegistry, data: ArtifactSetData): void {
  /* Zero the frequencies for artifact attributes. */
  for (let i = 0; i < ART_IDX_TOTAL; i++) data.artProbs[i] = 0;

  collectArtifactCounts(reg, data);

  /* Big hack, reduce frequencies of sharp weapons. */
  for (let i = 0; i < TV_MAX; i++) {
    if (i === TV.SWORD || i === TV.POLEARM) {
      data.tvProbs[i] = Math.trunc((data.tvProbs[i]! * 2) / 3);
    }
  }

  /* Rescale frequencies. */
  rescaleFreqs(data);

  /* Perform any additional rescaling and adjustment. */
  adjustFreqs(data);

  /* Build a cumulative frequency table for tvals. */
  for (let i = 0; i < TV_MAX; i++) {
    for (let j = i; j < TV_MAX; j++) {
      data.tvFreq[j] = (data.tvFreq[j] ?? 0) + (data.tvProbs[i] ?? 0);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Generation of a random artifact (header)                            */
/* ------------------------------------------------------------------ */

/**
 * get_base_item_tval (obj-randart.c L1332): pick a random base item tval from
 * the original artifact tval frequencies.
 */
export function getBaseItemTval(data: ArtifactSetData, rng: Rng): number {
  let tval = 0;
  const r = rng.randint1(data.tvFreq[TV_MAX - 1]!);
  while (r > (data.tvFreq[tval] ?? 0)) {
    tval++;
  }
  return tval;
}

/* ------------------------------------------------------------------ */
/* artifact_set_data allocation (obj-randart.c L2993)                  */
/* ------------------------------------------------------------------ */

/** INHIBIT_POWER: the power ceiling above which arts are treated as uber. */
const INHIBIT_POWER = 20000;

/**
 * artifact_set_data_new (obj-randart.c L2993): allocate and initialize a new
 * artifact set data structure. Power/level/prob arrays are sized by the number
 * of artifact slots (a_max, i.e. reg.artifacts.length); the tval arrays by
 * TV_MAX and the ability array by ART_IDX_TOTAL.
 */
export function artifactSetDataNew(reg: ObjRegistry): ArtifactSetData {
  const aMax = reg.artifacts.length;
  const zeros = (n: number): number[] => new Array<number>(n).fill(0);

  return {
    /* Mean start and increment values for to_hit, to_dam and AC. */
    hitIncrement: 4,
    damIncrement: 4,
    hitStartval: 10,
    damStartval: 10,
    acStartval: 15,
    acIncrement: 5,

    artProbs: zeros(ART_IDX_TOTAL),
    tvProbs: zeros(TV_MAX),
    tvNum: zeros(TV_MAX),
    bowTotal: 0,
    meleeTotal: 0,
    bootTotal: 0,
    gloveTotal: 0,
    headgearTotal: 0,
    shieldTotal: 0,
    cloakTotal: 0,
    armorTotal: 0,
    otherTotal: 0,
    total: 0,
    negPowerTotal: 0,

    tvFreq: zeros(TV_MAX),

    basePower: zeros(aMax),
    maxPower: 0,
    minPower: 0,
    avgPower: 0,
    varPower: 0,
    avgTvPower: zeros(TV_MAX),
    minTvPower: zeros(TV_MAX),
    maxTvPower: zeros(TV_MAX),

    baseItemLevel: zeros(aMax),
    baseItemProb: zeros(aMax),
    baseArtAlloc: zeros(aMax),
  };
}

/**
 * Allocate an ArtifactSetData and run the measurement pipeline over the
 * registry's standard artifacts: store_base_power, then parse_frequencies
 * (which runs collect_artifact_data, rescale_freqs and adjust_freqs). Returns
 * the populated data. `rng` is threaded through for parity with upstream
 * do_randart (store_base_power's fake-object build consumes no RNG for the
 * standard, curse-free artifact set).
 */
export function collectArtifactData(
  reg: ObjRegistry,
  rng: Rng,
): ArtifactSetData {
  void rng;
  const data = artifactSetDataNew(reg);
  storeBasePower(reg, data);
  parseFrequencies(reg, data);
  return data;
}
