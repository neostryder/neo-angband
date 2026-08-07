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
 * - The upstream file_putf(log_file, ...) logging is PORTED (PORT_TODO 5.5),
 *   through the randartLog sink in ./randart-log.js. It never affects any
 *   returned value, so a run with no log open behaves identically.
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
 *   which is the "round the result down" path. Both are now ported for real in
 *   ../rational (saturation and all) and called through meanFloored /
 *   varianceFloored below, rather than reimplemented here.
 */

import { randartLog, randartLogf } from "./randart-log.js";
import { ELEM, KF, OBJ_MOD, OF, TV } from "../generated/index.js";
import { ART_IDX } from "../generated/randart-properties.js";
import type { Rng } from "../rng.js";
import type { ObjRegistry } from "./bind.js";
import { tvalFindName } from "./bind.js";
import type { CurseData, CurseTimedFoil } from "./object.js";
import type { ActivationSummarizer } from "./randart-build.js";
import {
  copyBrands,
  copySlays,
  tvalCanHaveCharges,
  tvalIsEdible,
  tvalIsFuel,
  tvalIsLauncher,
  tvalIsPotion,
} from "./object.js";
import { mean, variance } from "../rational.js";
import { objectPower } from "./power.js";
import type { PowerObject } from "./power.js";
import type { Artifact, ElementInfo } from "./types.js";
import { ELEM_MAX, newOfFlags, OBJ_MOD_MAX, TV_MAX } from "./types.js";
import type { RandomValue } from "../rng.js";

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

  /**
   * The player-timed failure tables (timed effect NAME -> fail directives) for
   * artifact_curse_conflicts' TIMED_INC foil rejection (obj-curse.c L267-296).
   * Built by the game from the bound TimedEffect[]; absent => the foil branch
   * is skipped (curses still filtered by explicit conflict flags). See gap 3.3.
   */
  timedFoil?: CurseTimedFoil | undefined;
  /**
   * effect_summarize_properties (effects-info.c) for
   * remove_contradictory_activation's redundancy check (obj-randart.c L2420,
   * gap 3.8). Lives in the effects domain; injected here. Absent => a redundant
   * activation is never stripped (conservative). Wired from the effects layer.
   */
  activationSummarize?: ActivationSummarizer | undefined;
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

/**
 * store_base_power's two statistics, at the call shape obj-randart.c L278-L282
 * uses: mean(a, n, &frac) and variance(a, n, false, false, &frac), i.e. the
 * FLOORED variants. The scratch fraction upstream passes is written and then
 * ignored, so one shared throwaway stands in for it.
 *
 * These used to be local reimplementations here (plain floor division and
 * (sum(x^2)*size - sum(x)^2) / size^2). They agreed with the C for artifact
 * powers, but not at the rails: upstream's variance saturates at INT_MAX and
 * upstream's mean floors toward negative infinity via a magnitude-and-fraction
 * dance. ../rational is the real port, so the statistics now go through it.
 */
const SCRATCH_FRAC = { n: 0, d: 1 };

function meanFloored(nums: readonly number[]): number {
  return mean(nums, nums.length, SCRATCH_FRAC);
}

function varianceFloored(nums: readonly number[]): number {
  return variance(nums, nums.length, false, false, SCRATCH_FRAC);
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
export function artifactPower(
  reg: ObjRegistry,
  art: Artifact,
  /**
   * artifact_power's `reason` (obj-randart.c:186), which exists only to head
   * the log block. REQUIRED rather than optional: upstream writes it out at
   * every one of its four call sites, and a default here would silently label
   * one evaluation as another in the log the argument exists to produce.
   */
  reason: string,
): number {
  randartLogf(() => `********** Evaluating ${reason} ********\n`);
  randartLogf(() => `Artifact index is ${art.aidx}\n`);

  const obj = makeFakeArtifactPower(reg, art);
  if (!obj) return 0;

  /*
   * obj-randart.c:205-206 also logs the fake artifact's object_desc with
   * ODESC_PREFIX | ODESC_FULL | ODESC_SPOIL. STILL NOT WRITTEN, and the reason
   * is bigger than the one recorded here before.
   *
   * A KnownDesc is not the obstacle: SPOIL describes the object as it truly
   * is, so aware-and-tried for everything is the only answer consistent with
   * it, and a RuneEnv over reg.brands/slays/curses/properties with a null
   * slot_object is buildable right here. Attempted 2026-08-07 and abandoned on
   * the real blocker: makeFakeArtifactPower returns a PowerObject - the
   * reduced shape object_power needs - and object_desc wants a whole
   * GameObject. Writing this line means building the full fake object upstream
   * builds, which is a change to the power path, not to the log.
   *
   * Its format string is "%s\n", which has no literal span, so the census in
   * randart-log.census.test.ts cannot see it - it is carried there as
   * UNWRITTEN_SPANLESS instead, and PORT_TODO 5.5 stays open on it. Left to
   * the ratchet alone this would be a line quietly dropped.
   */

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
export function storeBasePower(
  reg: ObjRegistry,
  arts: readonly (Artifact | null)[],
  data: ArtifactSetData,
): void {
  const aMax = arts.length;

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
    const art = arts[i] ?? null;
    const power = art ? artifactPower(reg, art, "for original power") : 0;
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
  data.avgPower = meanFloored(fakeTotalPower);
  data.varPower = varianceFloored(fakeTotalPower);
  for (let i = 0; i < TV_MAX; i++) {
    if (data.tvNum[i]) {
      data.avgTvPower[i] = meanFloored(fakeTvPower[i]!);
    }
  }

  randartLogf(
    () =>
      `Max power is ${String(data.maxPower)}, min is ${String(data.minPower)}\n`,
  );
  randartLogf(
    () =>
      `Mean is ${String(data.avgPower)}, variance is ${String(data.varPower)}\n`,
  );
  for (let i = 0; i < TV_MAX; i++) {
    if (data.avgTvPower[i]) {
      randartLogf(
        () =>
          `Power for tval ${tvalFindName(i)}: min ${String(data.minTvPower[i])}, max ${String(data.maxTvPower[i])}, avg ${String(data.avgTvPower[i])}\n`,
      );
    }
  }

  /* Store the number of different types, for use later. */
  for (let i = 0; i < aMax; i++) {
    const art = arts[i] ?? null;
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
  if (bonus > 0) {
    randartLogf(
      () => `Adding ${bonus} instances of extra to-hit bonus for weapon\n`,
    );
  } else if (bonus < 0) {
    randartLogf(
      () => `Subtracting ${bonus} instances of extra to-hit bonus for weapon\n`,
    );
  }
  data.artProbs[ART_IDX.WEAPON_HIT]! += bonus;

  bonus = Math.trunc((art.toD - minToD - data.damStartval) / data.damIncrement);
  /* Asymmetric with to-hit ON PURPOSE: the to-dam arm has no `< 0` test, so a
   * bonus of exactly 0 logs "Subtracting 0" (obj-randart.c L359-363). */
  if (bonus > 0) {
    randartLogf(
      () => `Adding ${bonus} instances of extra to-dam bonus for weapon\n`,
    );
  } else {
    randartLogf(
      () => `Subtracting ${bonus} instances of extra to-dam bonus for weapon\n`,
    );
  }
  data.artProbs[ART_IDX.WEAPON_DAM]! += bonus;

  /* Does this weapon have an unusual bonus to AC? */
  bonus = Math.trunc((art.toA - minToA) / data.acIncrement);
  if (art.toA > 20) {
    randartLogf(() => `Adding ${bonus} for supercharged AC\n`);
    data.artProbs[ART_IDX.MELEE_AC_SUPER]!++;
  } else if (bonus > 0) {
    randartLogf(
      () => `Adding ${bonus} instances of extra AC bonus for weapon\n`,
    );
    data.artProbs[ART_IDX.MELEE_AC]! += bonus;
  }

  /* Check damage dice - are they more than normal? */
  if (art.dd > kind.dd) {
    if (art.dd - kind.dd > 2) {
      randartLog(`Adding 1 for super-charged damage dice!\n`);
      data.artProbs[ART_IDX.MELEE_DICE_SUPER]!++;
    } else {
      randartLog(`Adding 1 for extra damage dice.\n`);
      data.artProbs[ART_IDX.MELEE_DICE]!++;
    }
  }

  /* Check weight - is it different from normal? */
  if (art.weight !== kind.weight) {
    randartLog(`Adding 1 for unusual weight.\n`);
    data.artProbs[ART_IDX.MELEE_WEIGHT]!++;
  }

  /* Do we have 3 or more extra blows? */
  const blows = art.modifiers[OBJ_MOD.BLOWS] ?? 0;
  if (blows > 2) {
    randartLog(`Adding 1 for supercharged blows (3 or more!)\n`);
    data.artProbs[ART_IDX.MELEE_BLOWS_SUPER]!++;
  } else if (blows > 0) {
    randartLog(`Adding 1 for extra blows\n`);
    data.artProbs[ART_IDX.MELEE_BLOWS]!++;
  }

  /* Aggravation. */
  if (art.flags.has(OF.AGGRAVATE)) {
    randartLog(`Adding 1 for aggravation - weapon\n`);
    data.artProbs[ART_IDX.WEAPON_AGGR]!++;
  }

  /* Blessed weapon? */
  if (art.flags.has(OF.BLESSED)) {
    randartLog(`Adding 1 for blessed weapon\n`);
    data.artProbs[ART_IDX.MELEE_BLESS]!++;
  }

  /* See invisible? */
  if (art.flags.has(OF.SEE_INVIS)) {
    randartLog(`Adding 1 for see invisible (weapon case)\n`);
    data.artProbs[ART_IDX.MELEE_SINV]!++;
  }

  /* Tunnelling ability. */
  if ((art.modifiers[OBJ_MOD.TUNNEL] ?? 0) > 0) {
    randartLog(`Adding 1 for tunnelling bonus.\n`);
    data.artProbs[ART_IDX.MELEE_TUNN]!++;
  }

  /* Count brands and slays. */
  if (art.slays) {
    const n = countTrue(art.slays);
    data.artProbs[ART_IDX.MELEE_SLAY]! += n;
    randartLogf(() => `Adding ${n} for slays\n`);
  }
  if (art.brands) {
    const n = countTrue(art.brands);
    data.artProbs[ART_IDX.MELEE_BRAND]! += n;
    randartLogf(() => `Adding ${n} for brands\n`);
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
  if (bonus > 0) {
    randartLogf(
      () => `Adding ${bonus} instances of extra to-hit bonus for weapon\n`,
    );
  } else if (bonus < 0) {
    randartLogf(
      () => `Subtracting ${bonus} instances of extra to-hit bonus for weapon\n`,
    );
  }
  data.artProbs[ART_IDX.WEAPON_HIT]! += bonus;

  /* To-dam. */
  bonus = Math.trunc((art.toD - minToD - data.damStartval) / data.damIncrement);
  /* Plain `else`, as in count_weapon_abilities: the to-dam arm has no `< 0`
   * test either here (obj-randart.c L461-466), so a bonus of exactly 0 logs
   * "Subtracting 0". The to-hit arm above DOES have one. */
  if (bonus > 0) {
    randartLogf(
      () => `Adding ${bonus} instances of extra to-dam bonus for weapon\n`,
    );
  } else {
    randartLogf(
      () => `Subtracting ${bonus} instances of extra to-dam bonus for weapon\n`,
    );
  }
  data.artProbs[ART_IDX.WEAPON_DAM]! += bonus;

  /* Armor class. */
  bonus = Math.trunc((art.toA - minToA - data.acStartval) / data.acIncrement);
  if (bonus > 0) {
    randartLogf(() => `Adding ${bonus} for AC bonus - general\n`);
    data.artProbs[ART_IDX.GEN_AC]! += bonus;
  }

  /* Aggravation. */
  if (art.flags.has(OF.AGGRAVATE)) {
    randartLog(`Adding 1 for aggravation - weapon\n`);
    data.artProbs[ART_IDX.WEAPON_AGGR]!++;
  }

  /* Do we have more than 1 extra shot? */
  const shots = art.modifiers[OBJ_MOD.SHOTS] ?? 0;
  if (shots > 10) {
    randartLog(`Adding 1 for supercharged shots (more than 1!)\n`);
    data.artProbs[ART_IDX.BOW_SHOTS_SUPER]!++;
  } else if (shots > 0) {
    randartLog(`Adding 1 for extra shots\n`);
    data.artProbs[ART_IDX.BOW_SHOTS]!++;
  }

  /* Do we have 3 or more extra might? */
  const might = art.modifiers[OBJ_MOD.MIGHT] ?? 0;
  if (might > 2) {
    randartLog(`Adding 1 for supercharged might (3 or more!)\n`);
    data.artProbs[ART_IDX.BOW_MIGHT_SUPER]!++;
  } else if (might > 0) {
    randartLog(`Adding 1 for extra might\n`);
    data.artProbs[ART_IDX.BOW_MIGHT]!++;
  }

  /* Count brands and slays. */
  if (art.slays) {
    const n = countTrue(art.slays);
    data.artProbs[ART_IDX.BOW_SLAY]! += n;
    randartLogf(() => `Adding ${n} for slays\n`);
  }
  if (art.brands) {
    const n = countTrue(art.brands);
    data.artProbs[ART_IDX.BOW_BRAND]! += n;
    randartLogf(() => `Adding ${n} for brands\n`);
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
      randartLogf(() => `Adding ${bonus} for supercharged AC\n`);
      data.artProbs[ART_IDX.GEN_AC_SUPER]!++;
    } else if (art.tval === TV.BOOTS) {
      randartLogf(() => `Adding ${bonus} for AC bonus - boots\n`);
      data.artProbs[ART_IDX.BOOT_AC]! += bonus;
    } else if (art.tval === TV.GLOVES) {
      randartLogf(() => `Adding ${bonus} for AC bonus - gloves\n`);
      data.artProbs[ART_IDX.GLOVE_AC]! += bonus;
    } else if (art.tval === TV.HELM || art.tval === TV.CROWN) {
      randartLogf(() => `Adding ${bonus} for AC bonus - hat\n`);
      data.artProbs[ART_IDX.HELM_AC]! += bonus;
    } else if (art.tval === TV.SHIELD) {
      randartLogf(() => `Adding ${bonus} for AC bonus - shield\n`);
      data.artProbs[ART_IDX.SHIELD_AC]! += bonus;
    } else if (art.tval === TV.CLOAK) {
      randartLogf(() => `Adding ${bonus} for AC bonus - cloak\n`);
      data.artProbs[ART_IDX.CLOAK_AC]! += bonus;
    } else if (
      art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR
    ) {
      randartLogf(() => `Adding ${bonus} for AC bonus - body armor\n`);
      data.artProbs[ART_IDX.ARMOR_AC]! += bonus;
    } else {
      randartLogf(() => `Adding ${bonus} for AC bonus - general\n`);
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
        randartLogf(
          () =>
            `Adding ${bonus} instances of extra to-hit and to-dam bonus for gloves\n`,
        );
        data.artProbs[ART_IDX.GLOVE_HIT_DAM]! += bonus;
      } else {
        randartLogf(
          () =>
            `Adding ${bonus} instances of extra to-hit and to-dam bonus for non-weapon\n`,
        );
        data.artProbs[ART_IDX.NONWEAPON_HIT_DAM]! += bonus;
      }
    }
  } else if (toHit > 0) {
    bonus = Math.trunc(toHit / data.hitIncrement);
    if (bonus > 0) {
      randartLogf(
        () => `Adding ${bonus} instances of extra to-hit bonus for non-weapon\n`,
      );
      data.artProbs[ART_IDX.NONWEAPON_HIT]! += bonus;
    }
  } else if (toDam > 0) {
    bonus = Math.trunc(toDam / data.damIncrement);
    if (bonus > 0) {
      randartLogf(
        () => `Adding ${bonus} instances of extra to-dam bonus for non-weapon\n`,
      );
      data.artProbs[ART_IDX.NONWEAPON_DAM]! += bonus;
    }
  }

  /* Check weight - is it different from normal? */
  if (art.weight !== kind.weight) {
    randartLog(`Adding 1 for unusual weight.\n`);
    data.artProbs[ART_IDX.ALLARMOR_WEIGHT]!++;
  }

  /* Aggravation. */
  if (art.flags.has(OF.AGGRAVATE)) {
    randartLog(`Adding 1 for aggravation - nonweapon\n`);
    data.artProbs[ART_IDX.NONWEAPON_AGGR]!++;
  }

  /* Count brands and slays. */
  if (art.slays) {
    const n = countTrue(art.slays);
    data.artProbs[ART_IDX.NONWEAPON_SLAY]! += n;
    randartLogf(() => `Adding ${n} for slays\n`);
  }
  if (art.brands) {
    const n = countTrue(art.brands);
    data.artProbs[ART_IDX.NONWEAPON_BRAND]! += n;
    randartLogf(() => `Adding ${n} for brands\n`);
  }

  /* Blows. */
  if ((art.modifiers[OBJ_MOD.BLOWS] ?? 0) > 0) {
    randartLog(`Adding 1 for extra blows on nonweapon\n`);
    data.artProbs[ART_IDX.NONWEAPON_BLOWS]!++;
  }

  /* Shots. */
  if ((art.modifiers[OBJ_MOD.SHOTS] ?? 0) > 0) {
    randartLog(`Adding 1 for extra shots on nonweapon\n`);
    data.artProbs[ART_IDX.NONWEAPON_SHOTS]!++;
  }

  /* Tunnelling ability. */
  if ((art.modifiers[OBJ_MOD.TUNNEL] ?? 0) > 0) {
    randartLog(`Adding 1 for tunnelling bonus - general.\n`);
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
      randartLog("Adding 1 for WIS bonus on headgear.\n");
      data.artProbs[ART_IDX.HELM_WIS]!++;
      num--;
    }
    if ((art.modifiers[OBJ_MOD.INT] ?? 0) > 0) {
      randartLog("Adding 1 for INT bonus on headgear.\n");
      data.artProbs[ART_IDX.HELM_INT]!++;
      num--;
    }
  } else if (
    (art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR) &&
    (art.modifiers[OBJ_MOD.CON] ?? 0) > 0
  ) {
    randartLog("Adding 1 for CON bonus on body armor.\n");
    data.artProbs[ART_IDX.ARMOR_CON]!++;
    num--;
  } else if (art.tval === TV.GLOVES && (art.modifiers[OBJ_MOD.DEX] ?? 0) > 0) {
    randartLog("Adding 1 for DEX bonus on gloves.\n");
    data.artProbs[ART_IDX.GLOVE_DEX]!++;
    num--;
  }

  /* Now the general case. */
  if (num > 0) {
    randartLogf(() => `Adding ${num} for stat bonuses - general.\n`);
    data.artProbs[ART_IDX.GEN_STAT]! += num;
  }

  /* Handle stealth, including a couple of special cases. */
  if ((art.modifiers[OBJ_MOD.STEALTH] ?? 0) > 0) {
    if (art.tval === TV.BOOTS) {
      randartLog("Adding 1 for stealth bonus on boots.\n");
      data.artProbs[ART_IDX.BOOT_STEALTH]!++;
    } else if (art.tval === TV.CLOAK) {
      randartLog("Adding 1 for stealth bonus on cloak.\n");
      data.artProbs[ART_IDX.CLOAK_STEALTH]!++;
    } else if (
      art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR
    ) {
      randartLog("Adding 1 for stealth bonus on armor.\n");
      data.artProbs[ART_IDX.ARMOR_STEALTH]!++;
    } else {
      randartLog("Adding 1 for stealth bonus - general.\n");
      data.artProbs[ART_IDX.GEN_STEALTH]!++;
    }
  }

  /* Searching bonus - fully generic. */
  if ((art.modifiers[OBJ_MOD.SEARCH] ?? 0) > 0) {
    randartLog("Adding 1 for search bonus - general.\n");
    data.artProbs[ART_IDX.GEN_SEARCH]!++;
  }

  /* Infravision bonus - fully generic. */
  if ((art.modifiers[OBJ_MOD.INFRA] ?? 0) > 0) {
    randartLog("Adding 1 for infravision bonus - general.\n");
    data.artProbs[ART_IDX.GEN_INFRA]!++;
  }

  /* Damage reduction bonus - fully generic. */
  if ((art.modifiers[OBJ_MOD.DAM_RED] ?? 0) > 0) {
    randartLog("Adding 1 for damage reduction bonus - general.\n");
    data.artProbs[ART_IDX.GEN_DAM_RED]!++;
  }

  /* Moves bonus. */
  if ((art.modifiers[OBJ_MOD.MOVES] ?? 0) > 0) {
    if (art.tval === TV.BOOTS) {
      randartLog("Adding 1 for moves bonus on boots.\n");
      data.artProbs[ART_IDX.BOOT_MOVES]!++;
    } else {
      randartLog("Adding 1 for moves bonus - general.\n");
      data.artProbs[ART_IDX.GEN_MOVES]!++;
    }
  }

  /* Speed - boots handled separately, supercharge shares its frequency. */
  const speed = art.modifiers[OBJ_MOD.SPEED] ?? 0;
  if (speed > 0) {
    if (speed > 7) {
      randartLog("Adding 1 for supercharged speed bonus!\n");
      data.artProbs[ART_IDX.GEN_SPEED_SUPER]!++;
    } else if (art.tval === TV.BOOTS) {
      randartLog("Adding 1 for normal speed bonus on boots.\n");
      data.artProbs[ART_IDX.BOOT_SPEED]!++;
    } else {
      randartLog("Adding 1 for normal speed bonus - general.\n");
      data.artProbs[ART_IDX.GEN_SPEED]!++;
    }
  }

  /* Permanent light. */
  if ((art.modifiers[OBJ_MOD.LIGHT] ?? 0) > 0) {
    randartLog("Adding 1 for light radius - general.\n");
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

  randartLogf(() => `Adding ${num} for immunities.\n`);
  data.artProbs[ART_IDX.GEN_IMMUNE]! += num;

  /* Count up low resists (not the type, just the number). */
  num = 0;
  if ((art.elInfo[ELEM.ACID] as ElementInfo).resLevel === 1) num++;
  if ((art.elInfo[ELEM.ELEC] as ElementInfo).resLevel === 1) num++;
  if ((art.elInfo[ELEM.FIRE] as ElementInfo).resLevel === 1) num++;
  if ((art.elInfo[ELEM.COLD] as ElementInfo).resLevel === 1) num++;

  if (num) {
    if (art.tval === TV.SHIELD) {
      randartLogf(() => `Adding ${num} for low resists on shield.\n`);
      data.artProbs[ART_IDX.SHIELD_LRES]! += num;
    } else if (
      art.tval === TV.SOFT_ARMOR ||
      art.tval === TV.HARD_ARMOR ||
      art.tval === TV.DRAG_ARMOR
    ) {
      if (num === 4) {
        randartLog("Adding 1 for ALL LOW RESISTS on body armor.\n");
        data.artProbs[ART_IDX.ARMOR_ALLRES]!++;
      } else {
        randartLogf(() => `Adding ${num} for low resists on body armor.\n`);
        data.artProbs[ART_IDX.ARMOR_LRES]! += num;
      }
    } else {
      randartLogf(() => `Adding ${num} for low resists - general.\n`);
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
    randartLogf(() => `Adding ${num} for high resists on body armor.\n`);
    data.artProbs[ART_IDX.ARMOR_HRES]! += num;
  }

  /* Now do the high resists individually. */
  if ((art.elInfo[ELEM.POIS] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist poison - general.\n");
    data.artProbs[ART_IDX.GEN_RPOIS]!++;
  }
  if (art.flags.has(OF.PROT_FEAR)) {
    randartLog("Adding 1 for resist fear - general.\n");
    data.artProbs[ART_IDX.GEN_RFEAR]!++;
  }
  if ((art.elInfo[ELEM.LIGHT] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist light - general.\n");
    data.artProbs[ART_IDX.GEN_RLIGHT]!++;
  }
  if ((art.elInfo[ELEM.DARK] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist dark - general.\n");
    data.artProbs[ART_IDX.GEN_RDARK]!++;
  }
  if (art.flags.has(OF.PROT_BLIND)) {
    if (art.tval === TV.HELM || art.tval === TV.CROWN) {
      randartLog("Adding 1 for resist blindness - headgear.\n");
      data.artProbs[ART_IDX.HELM_RBLIND]!++;
    } else {
      randartLog("Adding 1 for resist blindness - general.\n");
      data.artProbs[ART_IDX.GEN_RBLIND]!++;
    }
  }
  if (art.flags.has(OF.PROT_CONF)) {
    randartLog("Adding 1 for resist confusion - general.\n");
    data.artProbs[ART_IDX.GEN_RCONF]!++;
  }
  if ((art.elInfo[ELEM.SOUND] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist sound - general.\n");
    data.artProbs[ART_IDX.GEN_RSOUND]!++;
  }
  if ((art.elInfo[ELEM.SHARD] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist shards - general.\n");
    data.artProbs[ART_IDX.GEN_RSHARD]!++;
  }
  if ((art.elInfo[ELEM.NEXUS] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist nexus - general.\n");
    data.artProbs[ART_IDX.GEN_RNEXUS]!++;
  }
  if ((art.elInfo[ELEM.NETHER] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist nether - general.\n");
    data.artProbs[ART_IDX.GEN_RNETHER]!++;
  }
  if ((art.elInfo[ELEM.CHAOS] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist chaos - general.\n");
    data.artProbs[ART_IDX.GEN_RCHAOS]!++;
  }
  if ((art.elInfo[ELEM.DISEN] as ElementInfo).resLevel === 1) {
    randartLog("Adding 1 for resist disenchantment - general.\n");
    data.artProbs[ART_IDX.GEN_RDISEN]!++;
  }
  if (art.flags.has(OF.PROT_STUN)) {
    randartLog("Adding 1 for res_stun - general.\n");
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
    randartLogf(() => `Adding ${num} for stat sustains.\n`);
    data.artProbs[ART_IDX.GEN_SUST]! += num;
  }

  /* Free action - handle gloves separately. */
  if (art.flags.has(OF.FREE_ACT)) {
    if (art.tval === TV.GLOVES) {
      randartLog("Adding 1 for free action on gloves.\n");
      data.artProbs[ART_IDX.GLOVE_FA]!++;
    } else {
      randartLog("Adding 1 for free action - general.\n");
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
      randartLog("Adding 1 for hold life on armor.\n");
      data.artProbs[ART_IDX.ARMOR_HLIFE]!++;
    } else {
      randartLog("Adding 1 for hold life - general.\n");
      data.artProbs[ART_IDX.GEN_HLIFE]!++;
    }
  }

  /* Feather fall - handle boots separately. */
  if (art.flags.has(OF.FEATHER)) {
    if (art.tval === TV.BOOTS) {
      randartLog("Adding 1 for feather fall on boots.\n");
      data.artProbs[ART_IDX.BOOT_FEATHER]!++;
    } else {
      randartLog("Adding 1 for feather fall - general.\n");
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
        randartLog("Adding 1 for see invisible - headgear.\n");
      data.artProbs[ART_IDX.HELM_SINV]!++;
      } else {
        randartLog("Adding 1 for see invisible - general.\n");
      data.artProbs[ART_IDX.GEN_SINV]!++;
      }
    }
  }

  /* ESP - handle helms/crowns separately. */
  if (art.flags.has(OF.TELEPATHY)) {
    if (art.tval === TV.HELM || art.tval === TV.CROWN) {
      randartLog("Adding 1 for ESP on headgear.\n");
      data.artProbs[ART_IDX.HELM_ESP]!++;
    } else {
      randartLog("Adding 1 for ESP - general.\n");
      data.artProbs[ART_IDX.GEN_ESP]!++;
    }
  }

  /* Slow digestion - generic. */
  if (art.flags.has(OF.SLOW_DIGEST)) {
    randartLog("Adding 1 for slow digestion - general.\n");
    data.artProbs[ART_IDX.GEN_SDIG]!++;
  }

  /* Regeneration - generic. */
  if (art.flags.has(OF.REGEN)) {
    randartLog("Adding 1 for regeneration - general.\n");
    data.artProbs[ART_IDX.GEN_REGEN]!++;
  }

  /* Trap immunity - handle boots separately. */
  if (art.flags.has(OF.TRAP_IMMUNE)) {
    if (art.tval === TV.BOOTS) {
      randartLog("Adding 1 for trap immunity on boots.\n");
      data.artProbs[ART_IDX.BOOT_TRAP_IMM]!++;
    } else {
      randartLog("Adding 1 for trap immunity - general.\n");
      data.artProbs[ART_IDX.GEN_TRAP_IMM]!++;
    }
  }

  /* Activation. */
  if (art.activation || kind?.activation) {
    randartLog("Adding 1 for activation.\n");
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
  arts: readonly (Artifact | null)[],
  data: ArtifactSetData,
): void {
  const aMax = arts.length;

  for (let i = 0; i < aMax; i++) {
    const art = arts[i] ?? null;

    /* obj-randart.c:1066-1067 logs the index BEFORE any skip, so a cursed,
     * tval-0 or absent entry still prints its line. Upstream reads a_info[i]
     * out of a dense array and never has a null to guard, so the port's own
     * null check has to come after this to keep the counts aligned. */
    randartLogf(() => `Current artifact index is ${i}\n`);
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
    randartLogf(() => `Base item is ${kind.kidx}\n`);

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
export function parseFrequencies(
  reg: ObjRegistry,
  arts: readonly (Artifact | null)[],
  data: ArtifactSetData,
): void {
  randartLog("\n****** BEGINNING GENERATION OF FREQUENCIES\n\n");

  /* Zero the frequencies for artifact attributes. */
  for (let i = 0; i < ART_IDX_TOTAL; i++) data.artProbs[i] = 0;

  collectArtifactCounts(reg, arts, data);

  /* Big hack, reduce frequencies of sharp weapons. */
  for (let i = 0; i < TV_MAX; i++) {
    if (i === TV.SWORD || i === TV.POLEARM) {
      data.tvProbs[i] = Math.trunc((data.tvProbs[i]! * 2) / 3);
    }
  }

  /* "Print out some of the abilities, to make sure that everything's fine"
   * (obj-randart.c:1295-1301). Both loops run to their FULL extent, before any
   * rescaling - the pre- and post-rescale dumps are what make the log usable
   * for comparing two runs. */
  for (let i = 0; i < ART_IDX_TOTAL; i++) {
    randartLogf(() => `Frequency of ability ${i}: ${data.artProbs[i]}\n`);
  }
  for (let i = 0; i < TV_MAX; i++) {
    randartLogf(
      () => `Frequency of ${tvalFindName(i)}: ${data.tvProbs[i]}\n`,
    );
  }

  /* Rescale frequencies. */
  rescaleFreqs(data);

  /* Perform any additional rescaling and adjustment. */
  adjustFreqs(data);

  /* "Log the final frequencies to check that everything's correct" (:1309). */
  for (let i = 0; i < ART_IDX_TOTAL; i++) {
    randartLogf(
      () => `Rescaled frequency of ability ${i}: ${data.artProbs[i]}\n`,
    );
  }

  /* Build a cumulative frequency table for tvals. */
  for (let i = 0; i < TV_MAX; i++) {
    for (let j = i; j < TV_MAX; j++) {
      data.tvFreq[j] = (data.tvFreq[j] ?? 0) + (data.tvProbs[i] ?? 0);
    }
  }

  /* "Print out the frequency table, for verification" (:1319). */
  for (let i = 0; i < TV_MAX; i++) {
    randartLogf(
      () => `Cumulative frequency of ${tvalFindName(i)} is: ${data.tvFreq[i]}\n`,
    );
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
 * Allocate an ArtifactSetData and run the measurement pipeline over `arts`:
 * store_base_power, then parse_frequencies (which runs collect_artifact_data,
 * rescale_freqs and adjust_freqs). Returns the populated data. `rng` is
 * threaded through for parity with upstream do_randart (store_base_power's
 * fake-object build consumes no RNG - see the module note on curse timeouts -
 * so this holds for a generated, cursed set as well as the standard one).
 *
 * WHICH SET is a parameter because do_randart measures TWICE (obj-randart.c
 * L3175-L3186): once over the standard artifacts, and once more over the
 * finished ones. Upstream can leave it implicit because create_artifact_set
 * overwrites the a_info global in place, so "the artifacts" means a different
 * set the second time round without anything being passed. This port generates
 * into a fresh array and leaves reg.artifacts alone, so the set being measured
 * has to be handed in.
 */
export function collectArtifactData(
  reg: ObjRegistry,
  arts: readonly (Artifact | null)[],
  rng: Rng,
): ArtifactSetData {
  void rng;
  const data = artifactSetDataNew(reg);
  storeBasePower(reg, arts, data);
  parseFrequencies(reg, arts, data);
  return data;
}
