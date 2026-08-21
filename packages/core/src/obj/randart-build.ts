/**
 * Random artifact generation: the artifact-building primitives, ported from
 * reference/src/obj-randart.c (Angband 4.2.6) lines 1332-2670. These are the
 * routines do_randart uses to construct a single random artifact: pick a base
 * item (get_base_item), seed it with its base stats (artifact_prep), build its
 * per-item ability frequency table (build_freq_table), optionally supercharge
 * it (try_supercharge), and then add individual abilities/curses via the many
 * add_* helpers, choose_ability, add_ability(_aux), remove_contradictory and
 * make_bad.
 *
 * Every routine that needs randomness takes an Rng explicitly (no globals) and
 * draws in the exact upstream order so a randart_seed remains reproducible. The
 * two inhibiting macros are, per upstream obj-randart.h:
 *   INHIBIT_STRONG => rng.oneIn(6)   (one_in_(6))
 *   INHIBIT_WEAK   => rng.oneIn(2)   (one_in_(2))
 * Each textual occurrence of these macros consumes one draw, and C's
 * short-circuit evaluation of && / || is reproduced exactly so no draw is
 * added or dropped.
 *
 * Faithful notes / approximations:
 * - The upstream file_putf(log_file, ...) logging is PORTED (PORT_TODO 5.5),
 *   including the lookup_obj_property calls in add_flag / add_mod whose only
 *   use is the name they put in the line. Logging never affects a returned
 *   value or an RNG draw, so the emitters sit outside the decision points.
 * - projections[element].name is read from the bound table on ObjRegistry
 *   (attached by bindCore from the pack's projection.json), by add_brand to add
 *   the resist matching the brand it just picked and by add_resist /
 *   add_immunity's log lines. It used to be a hand-written mirror of
 *   projection.txt; see the note above `projections()` for why reading the
 *   loaded data is not merely tidier.
 * - remove_contradictory_activation depends on effect_summarize_properties
 *   (effects-info.c). That summarizer lives in the effects domain, so it is
 *   ported in ./effects-info.ts (makeActivationSummarizer) and injected here as
 *   the ActivationSummarizer seam. It consumes no RNG and only ever nulls an
 *   activation when it is fully redundant with the artifact's other properties.
 *   When no summarizer is supplied this stays a conservative no-op (activations
 *   are never treated as redundant).
 * - artifact_curse_conflicts's TIMED_INC "effect foiled by an existing
 *   property" branch IS ported (PORT_TODO 5.7) and is no longer an
 *   approximation: the timed-effects failure tables are bound
 *   (player/bind.ts:733), curseTimedIncFoiled (obj/object.ts:703) walks them
 *   for TMD_FAIL_FLAG_OBJECT / _RESIST / _VULN and skips _PLAYER /
 *   _TIMED_EFFECT exactly as obj-curse.c:267-296 does, and both swapRandartSet
 *   call sites supply the map. It reaches here through the optional
 *   `timedFoil`; absent (a caller with no player table) the branch stays
 *   dormant and only the explicit conflict-flags arm runs. Affects the
 *   cursed-artifact path (make_bad) and consumes no RNG.
 * - add_curse computes power as randint1(9) + 10 * m_bonus(9, level); C leaves
 *   the evaluation order of the two calls unspecified, so this port draws
 *   randint1 then m_bonus (left-to-right textual order).
 */

import { ELEM, KF, OBJ_MOD, OF, STAT_ENTRIES, TV } from "../generated/index.js";
import { ART_IDX } from "../generated/randart-properties.js";
import type { Rng } from "../rng.js";
import { randartLog, randartLogf } from "./randart-log.js";
import { objectShortName } from "./bind.js";
import type { ObjRegistry } from "./bind.js";
import type { ProjectionInfo } from "../world/projection.js";
import type { CurseTimedFoil } from "./object.js";
import {
  copyBrands,
  copySlays,
  curseTimedIncFoiled,
  tvalIsArmor,
  tvalIsBodyArmor,
  tvalIsHeadArmor,
  tvalIsJewelry,
  tvalIsLauncher,
  tvalIsMeleeWeapon,
} from "./object.js";
import { INHIBIT_POWER, lookupObjProperty } from "./power.js";
import type { ArtifactSetData } from "./randart-data.js";
import { randartRegistry, seedRandart } from "./randart-registry.js";
import type {
  RandartAbilityHandler,
  RandartPrepHandler,
  RandartRedundancyContext,
} from "./randart-registry.js";
import type {
  Artifact,
  EffectRecordJson,
  ElementInfo,
  ObjectKind,
  ObjectProperty,
} from "./types.js";
import {
  EL_INFO_IGNORE,
  ELEM_BASE_MIN,
  ELEM_HIGH_MIN,
  OBJ_MOD_MAX,
  OBJ_PROPERTY,
} from "./types.js";

/* ------------------------------------------------------------------ */
/* Constants (obj-randart.h, obj-power.h)                              */
/* ------------------------------------------------------------------ */

/** MAX_TRIES (obj-randart.h L28). */
const MAX_TRIES = 200;

/**
 * AGGR_POWER (obj-randart.h L47): power below which uncursed randarts cannot
 * aggravate.
 */
const AGGR_POWER = 300;

/** STAT_MAX (list-stats.h): the number of player stats. */
const STAT_MAX = STAT_ENTRIES.length;

/** Inhibiting thresholds (obj-power.h L67-L76). */
const INHIBIT_BLOWS = 3;
const INHIBIT_MIGHT = 4;
const INHIBIT_SHOTS = 21;
const HIGH_TO_HIT = 16;
const VERYHIGH_TO_HIT = 26;
const HIGH_TO_DAM = 16;
const VERYHIGH_TO_DAM = 26;
const HIGH_TO_AC = 26;
const VERYHIGH_TO_AC = 36;

/** ART_IDX_TOTAL (obj-randart.h): number of learned-probability slots. */
const ART_IDX_TOTAL = ART_IDX.TOTAL;

/**
 * projections[element].name (projection.txt), for the 25 element-type
 * projections that PROJ_ lists first. Two callers: add_brand compares the
 * brand's name against the four base elements to add the matching resist, and
 * add_resist / add_immunity quote the name into randart.log.
 *
 * The names come from the bound projection table on ObjRegistry, which is the
 * pack's own projection.json. This used to be a hand-written mirror of
 * projection.txt guarded by a test that re-derived the list from the reference
 * data. That guard proved the mirror matched 4.2.6 and nothing else: a MOD
 * that renames an element would have stopped matching upstream while the port
 * carried on matching, which is precisely the divergence the mirror existed to
 * bound. Reading the loaded data removes the question.
 */

/** projections[] for the object domain; throws rather than substituting. */
function projections(reg: ObjRegistry): readonly ProjectionInfo[] {
  const table = reg.projections;
  if (!table) {
    throw new Error(
      "randart: ObjRegistry.projections is not bound. add_brand and the " +
        "randart log read projections[i].name (obj-randart.c:1951); a " +
        "registry built without them cannot answer that question, and " +
        "guessing an answer would be an unchecked claim about projection.txt.",
    );
  }
  return table;
}

/* ------------------------------------------------------------------ */
/* Arrays of indices by item type (obj-randart.c L52)                  */
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
const artIdxGen: readonly number[] = [
  ART_IDX.GEN_STAT,
  ART_IDX.GEN_SUST,
  ART_IDX.GEN_STEALTH,
  ART_IDX.GEN_SEARCH,
  ART_IDX.GEN_INFRA,
  ART_IDX.GEN_SPEED,
  ART_IDX.GEN_IMMUNE,
  ART_IDX.GEN_FA,
  ART_IDX.GEN_HLIFE,
  ART_IDX.GEN_FEATHER,
  ART_IDX.GEN_LIGHT,
  ART_IDX.GEN_SINV,
  ART_IDX.GEN_ESP,
  ART_IDX.GEN_SDIG,
  ART_IDX.GEN_REGEN,
  ART_IDX.GEN_LRES,
  ART_IDX.GEN_RPOIS,
  ART_IDX.GEN_RFEAR,
  ART_IDX.GEN_RLIGHT,
  ART_IDX.GEN_RDARK,
  ART_IDX.GEN_RBLIND,
  ART_IDX.GEN_RCONF,
  ART_IDX.GEN_RSOUND,
  ART_IDX.GEN_RSHARD,
  ART_IDX.GEN_RNEXUS,
  ART_IDX.GEN_RNETHER,
  ART_IDX.GEN_RCHAOS,
  ART_IDX.GEN_RDISEN,
  ART_IDX.GEN_AC,
  ART_IDX.GEN_TUNN,
  ART_IDX.GEN_ACTIV,
  ART_IDX.GEN_PSTUN,
  ART_IDX.GEN_DAM_RED,
  ART_IDX.GEN_MOVES,
  ART_IDX.GEN_TRAP_IMM,
];
const artIdxHighResist: readonly number[] = [
  ART_IDX.GEN_RPOIS,
  ART_IDX.GEN_RFEAR,
  ART_IDX.GEN_RLIGHT,
  ART_IDX.GEN_RDARK,
  ART_IDX.GEN_RBLIND,
  ART_IDX.GEN_RCONF,
  ART_IDX.GEN_RSOUND,
  ART_IDX.GEN_RSHARD,
  ART_IDX.GEN_RNEXUS,
  ART_IDX.GEN_RNETHER,
  ART_IDX.GEN_RCHAOS,
  ART_IDX.GEN_RDISEN,
  ART_IDX.GEN_PSTUN,
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** randcalc(v, 0, MINIMISE): base + dice (consumes no RNG). */
function rvMinimise(v: { base: number; dice: number }): number {
  return v.base + v.dice;
}

/* ------------------------------------------------------------------ */
/* get_base_item (obj-randart.c L1348)                                 */
/* ------------------------------------------------------------------ */

/**
 * get_base_item (obj-randart.c L1348): pick a random base item kind for a given
 * tval, drawn uniformly across the tval's svals; rejects elven Rings-of and
 * quest-artifact kinds. For rings/amulets the search starts past the ordinary
 * kinds (so only special jewellery bases are used).
 */
export function getBaseItem(
  reg: ObjRegistry,
  tval: number,
  rng: Rng,
): ObjectKind {
  let kind: ObjectKind | null = null;
  let start = 1;

  /* Restrict to appropriate kinds if jewellery. */
  if (tvalIsJewelry(tval)) {
    let testKind = reg.lookupKind(tval, start);
    while (testKind && testKind.kidx < reg.ordinaryKindCount) {
      start++;
      testKind = reg.lookupKind(tval, start);
    }
  }

  const numSvals = reg.bases[tval]?.numSvals ?? 0;

  /* Pick an sval for that tval at random. */
  while (!kind) {
    const r = start + rng.randint0(numSvals - start + 1);
    kind = reg.lookupKind(tval, r);

    /* No items based on quest artifacts or elven rings. */
    if (
      kind &&
      (kind.name.includes("Ring of") || kind.kindFlags.has(KF.QUEST_ART))
    ) {
      kind = null;
    }
  }

  if (kind) randartLogf(() => `Creating ${objectShortName(kind.name)}\n`);
  return kind;
}

/* ------------------------------------------------------------------ */
/* artifact_prep (obj-randart.c L1383)                                 */
/* ------------------------------------------------------------------ */

/**
 * artifact_prep (obj-randart.c L1383): add basic data to an artifact of a given
 * object kind, then assign basic combat stats based on the item type. Draws
 * randint0 for the weapon to-hit/to-dam or armour to-AC starting bonus.
 */
export function artifactPrep(
  reg: ObjRegistry,
  art: Artifact,
  kind: ObjectKind,
  data: ArtifactSetData,
  rng: Rng,
): void {
  art.tval = kind.tval;
  art.sval = kind.sval;
  art.toH = rvMinimise(kind.toH);
  art.toD = rvMinimise(kind.toD);
  art.toA = rvMinimise(kind.toA);
  art.ac = kind.ac;
  art.dd = kind.dd;
  art.ds = kind.ds;
  art.weight = kind.weight;
  art.flags.copy(kind.flags);
  art.slays = copySlays(null, kind.slays, reg.slays);
  art.brands = copyBrands(null, kind.brands, reg.brands);
  art.curses = kind.curses ? kind.curses.slice() : null;
  art.activation = null;
  art.altMsg = "";

  /* Inherit an activation's level, else the kind's level (if it has an
   * effect), else 0. */
  if (kind.activation) {
    art.level = kind.activation.level;
  } else if (kind.effect) {
    art.level = kind.level;
  } else {
    art.level = 0;
  }
  art.time = { base: 0, dice: 0, sides: 0, mBonus: 0 };

  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    art.modifiers[i] = rvMinimise(kind.modifiers[i]!);
  }
  for (let i = 0; i < art.elInfo.length; i++) {
    const ke = kind.elInfo[i] as ElementInfo;
    art.elInfo[i] = { resLevel: ke.resLevel, flags: ke.flags };
  }

  /* Artifacts ignore everything (base elements). */
  for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
    (art.elInfo[i] as ElementInfo).flags |= EL_INFO_IGNORE;
  }

  /* Assign basic stats to the artifact based on its type. The upstream switch
   * on tval is now the randart registry's `prep` table, so a mod's new item
   * class starts with something rather than a blank artifact. An unregistered
   * tval gets nothing, which is upstream's own default arm. */
  randartRegistry().prep.handlerFor(kind.tval)?.({ reg, art, kind, data, rng });
}

/* ------------------------------------------------------------------ */
/* build_freq_table (obj-randart.c L1505)                              */
/* ------------------------------------------------------------------ */

/**
 * build_freq_table (obj-randart.c L1505): build a cumulative ability-frequency
 * table for the given artifact's item type, zeroing frequencies for abilities
 * that do not apply. Returns the cumulative table (length ART_IDX_TOTAL).
 */
export function buildFreqTable(
  art: Artifact,
  data: ArtifactSetData,
): number[] {
  const fTemp = new Array<number>(ART_IDX_TOTAL).fill(0);
  const freq = new Array<number>(ART_IDX_TOTAL).fill(0);

  const copyGroup = (group: readonly number[]): void => {
    for (const idx of group) fTemp[idx] = data.artProbs[idx]!;
  };

  /* Bow abilities. */
  if (tvalIsLauncher(art.tval)) copyGroup(artIdxBow);

  /* General weapon abilities. Upstream lists BOW plus the four melee tvals;
   * that is `tvalIsLauncher || tvalIsMeleeWeapon`, and NOT `tvalIsWeapon`,
   * which also answers yes for ammo. */
  if (tvalIsLauncher(art.tval) || tvalIsMeleeWeapon(art.tval)) {
    copyGroup(artIdxWeapon);
  } else {
    /* General non-weapon abilities. */
    copyGroup(artIdxNonweapon);
  }

  /* General melee abilities. */
  if (tvalIsMeleeWeapon(art.tval)) {
    copyGroup(artIdxMelee);
  }

  /* General armor abilities. Upstream's nine tvals are exactly tvalIsArmor. */
  if (tvalIsArmor(art.tval)) {
    copyGroup(artIdxAllarmor);
  }

  /* Boot abilities. Slot-specific: no class predicate covers "boots alone",
   * and inventing one would be a randart SLOT registry, not registry:tval. */
  if (art.tval === TV.BOOTS) copyGroup(artIdxBoot);
  /* Glove abilities (slot-specific, as above). */
  if (art.tval === TV.GLOVES) copyGroup(artIdxGlove);
  /* Headgear abilities. */
  if (tvalIsHeadArmor(art.tval)) copyGroup(artIdxHeadgear);
  /* Shield abilities (slot-specific). */
  if (art.tval === TV.SHIELD) copyGroup(artIdxShield);
  /* Cloak abilities (slot-specific). */
  if (art.tval === TV.CLOAK) copyGroup(artIdxCloak);
  /* Armor abilities. */
  if (tvalIsBodyArmor(art.tval)) {
    copyGroup(artIdxArmor);
  }

  /* General abilities - no constraint. */
  copyGroup(artIdxGen);

  /* Build the cumulative frequency table. */
  for (let i = 0; i < ART_IDX_TOTAL; i++) {
    for (let j = i; j < ART_IDX_TOTAL; j++) {
      freq[j]! += fTemp[i]!;
    }
  }

  /* Print out the frequency table, for verification. */
  for (let i = 0; i < ART_IDX_TOTAL; i++) {
    randartLogf(
      () =>
        `Cumulative frequency of ability ${String(i)} is: ${String(freq[i])}\n`,
    );
  }

  return freq;
}

/* ------------------------------------------------------------------ */
/* try_supercharge (obj-randart.c L1627)                               */
/* ------------------------------------------------------------------ */

/**
 * try_supercharge (obj-randart.c L1627): give the artifact one up-front chance
 * at each supercharge ability (huge dice/blows, max shots/might, big speed, big
 * AC, aggravation), weighted by the learned supercharge frequencies. The
 * randint0(a_max) rolls use reg.artifacts.length (z_info->a_max).
 */
export function trySupercharge(
  reg: ObjRegistry,
  art: Artifact,
  targetPower: number,
  data: ArtifactSetData,
  rng: Rng,
): void {
  const aMax = reg.artifacts.length;

  /* Huge damage dice or max blows - melee weapon only. */
  if (tvalIsMeleeWeapon(art.tval)) {
    if (rng.randint0(aMax) < data.artProbs[ART_IDX.MELEE_DICE_SUPER]!) {
      art.dd += 3 + rng.randint0(4);
      randartLogf(
        () => `Supercharging damage dice!  (Now ${String(art.dd)} dice)\n`,
      );
    } else if (rng.randint0(aMax) < data.artProbs[ART_IDX.MELEE_BLOWS_SUPER]!) {
      art.modifiers[OBJ_MOD.BLOWS] = INHIBIT_BLOWS - 1;
      randartLogf(
        () =>
          `Supercharging melee blows! (${plusD(art.modifiers[OBJ_MOD.BLOWS]!)} blows)\n`,
      );
    }
  }

  /* Bows - max might or shots. */
  if (tvalIsLauncher(art.tval)) {
    if (rng.randint0(aMax) < data.artProbs[ART_IDX.BOW_SHOTS_SUPER]!) {
      art.modifiers[OBJ_MOD.SHOTS] = INHIBIT_SHOTS - 1;
      randartLogf(
        () =>
          `Supercharging shots! (${plusD(art.modifiers[OBJ_MOD.SHOTS]!)} extra shots)\n`,
      );
    } else if (rng.randint0(aMax) < data.artProbs[ART_IDX.BOW_MIGHT_SUPER]!) {
      art.modifiers[OBJ_MOD.MIGHT] = INHIBIT_MIGHT - 1;
      randartLogf(
        () =>
          `Supercharging might! (${plusD(art.modifiers[OBJ_MOD.MIGHT]!)} extra might)\n`,
      );
    }
  }

  /* Big speed bonus - any item but more likely on boots. C short-circuits the
   * || so the second randint0 only rolls when the first test fails and the
   * item is boots. */
  if (
    rng.randint0(aMax) < data.artProbs[ART_IDX.GEN_SPEED_SUPER]! ||
    (art.tval === TV.BOOTS &&
      rng.randint0(aMax) < data.artProbs[ART_IDX.BOOT_SPEED]!)
  ) {
    art.modifiers[OBJ_MOD.SPEED] = 5 + rng.randint0(6);
    if (rng.oneIn(2)) art.modifiers[OBJ_MOD.SPEED]! += rng.randint1(3);
    if (rng.oneIn(6)) art.modifiers[OBJ_MOD.SPEED]! += 1 + rng.randint1(6);
    randartLogf(
      () =>
        `Supercharging speed for this item!  (New speed bonus is ${String(art.modifiers[OBJ_MOD.SPEED])})\n`,
    );
  }

  /* Big AC bonus. */
  if (tvalIsMeleeWeapon(art.tval)) {
    if (rng.randint0(aMax) < data.artProbs[ART_IDX.MELEE_AC_SUPER]!) {
      art.toA += 19 + rng.randint1(11);
      if (rng.oneIn(2)) art.toA += rng.randint1(10);
      if (rng.oneIn(6)) art.toA += rng.randint1(20);
      randartLogf(
        () => `Supercharging AC! New AC bonus is ${String(art.toA)}\n`,
      );
    }
  } else if (
    !tvalIsLauncher(art.tval) &&
    rng.randint0(aMax) < data.artProbs[ART_IDX.GEN_AC_SUPER]!
  ) {
    art.toA += 19 + rng.randint1(11);
    if (rng.oneIn(2)) art.toA += rng.randint1(10);
    if (rng.oneIn(6)) art.toA += rng.randint1(20);
    randartLogf(
      () => `Supercharging AC! New AC bonus is ${String(art.toA)}\n`,
    );
  }

  /* Aggravation. C short-circuits the && so target_power is only tested when
   * the randint0 roll succeeds. */
  if (tvalIsLauncher(art.tval) || tvalIsMeleeWeapon(art.tval)) {
    if (
      rng.randint0(aMax) < data.artProbs[ART_IDX.WEAPON_AGGR]! &&
      targetPower > AGGR_POWER
    ) {
      art.flags.on(OF.AGGRAVATE);
      randartLog("Adding aggravation\n");
    }
  } else {
    if (
      rng.randint0(aMax) < data.artProbs[ART_IDX.NONWEAPON_AGGR]! &&
      targetPower > AGGR_POWER
    ) {
      art.flags.on(OF.AGGRAVATE);
      randartLog("Adding aggravation\n");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Log-line helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * `prop->name` for randart.log. Upstream dereferences the lookup without a
 * null check, so a property missing from object_property.txt segfaults there;
 * here it degrades to the index, because a log line is not worth a crash.
 */
function propName(prop: ObjectProperty | null): string {
  return prop ? prop.name : "(unknown)";
}

/** `projections[i].name` for randart.log - the in-game name, e.g. "acid". */
function projName(reg: ObjRegistry, index: number): string {
  return projections(reg)[index]?.name ?? "(unknown)";
}

/* ------------------------------------------------------------------ */
/* add_flag (obj-randart.c L1721)                                      */
/* ------------------------------------------------------------------ */

/** add_flag (obj-randart.c L1721): add a flag; returns true when it changed. */
export function addFlag(reg: ObjRegistry, art: Artifact, flag: number): boolean {
  const prop = lookupObjProperty(reg, OBJ_PROPERTY.FLAG, flag);
  if (art.flags.has(flag)) return false;
  art.flags.on(flag);
  randartLogf(() => `Adding ability: ${propName(prop)}\n`);
  return true;
}

/* ------------------------------------------------------------------ */
/* add_resist (obj-randart.c L1736)                                    */
/* ------------------------------------------------------------------ */

/** add_resist (obj-randart.c L1736): add a resist; true when it changed. */
export function addResist(
  reg: ObjRegistry,
  art: Artifact,
  element: number,
): boolean {
  const info = art.elInfo[element] as ElementInfo;
  if (info.resLevel > 0) return false;
  info.resLevel = 1;
  randartLogf(() => `Adding resistance to ${projName(reg, element)}\n`);
  return true;
}

/* ------------------------------------------------------------------ */
/* add_immunity (obj-randart.c L1750)                                  */
/* ------------------------------------------------------------------ */

/** add_immunity (obj-randart.c L1750): grant immunity to a random base element. */
export function addImmunity(reg: ObjRegistry, art: Artifact, rng: Rng): void {
  const r = rng.randint0(4);
  (art.elInfo[r] as ElementInfo).resLevel = 3;
  randartLogf(() => `Adding immunity to ${projName(reg, r)}\n`);
}

/* ------------------------------------------------------------------ */
/* add_mod (obj-randart.c L1761)                                       */
/* ------------------------------------------------------------------ */

/**
 * add_mod (obj-randart.c L1761): add, increase (or worsen a negative) a
 * modifier, favouring a few large bonuses over many small ones. Blows, might
 * and moves are "powerful" and applied sparingly. Returns true when changed.
 */
export function addMod(
  reg: ObjRegistry,
  art: Artifact,
  mod: number,
  rng: Rng,
): boolean {
  const prop = lookupObjProperty(reg, OBJ_PROPERTY.MOD, mod);
  const powerful =
    mod === OBJ_MOD.BLOWS || mod === OBJ_MOD.MIGHT || mod === OBJ_MOD.MOVES;
  let success = false;

  if (art.modifiers[mod]! < 0) {
    /* Negative mods just get a bit worse. */
    if (rng.oneIn(2)) {
      art.modifiers[mod]!--;
      randartLogf(
        () =>
          `Decreasing ${propName(prop)} by 1, new value is: ${String(art.modifiers[mod])}\n`,
      );
      success = true;
    }
  } else if (powerful) {
    /* Powerful mods need to be applied sparingly. */
    if (art.modifiers[mod] === 0) {
      art.modifiers[mod] = rng.randint1(2);
      randartLogf(
        () => `Adding ability: ${propName(prop)} (${plusD(art.modifiers[mod]!)})\n`,
      );
      success = true;
    } else if (rng.oneIn(20 * art.modifiers[mod]!)) {
      art.modifiers[mod]!++;
      randartLogf(
        () =>
          `Increasing ${propName(prop)} by 1, new value is: ${String(art.modifiers[mod])}\n`,
      );
      success = true;
    }
  } else {
    /* Hard cap of 6 on non-speed mods. */
    if (mod !== OBJ_MOD.SPEED && art.modifiers[mod]! >= 6) {
      return false;
    }

    /* New mods average 3, old ones are incremented by 1 or 2. */
    if (art.modifiers[mod] === 0) {
      art.modifiers[mod] = rng.randint0(3) + rng.randint1(3);
      randartLogf(
        () => `Adding ability: ${propName(prop)} (${plusD(art.modifiers[mod]!)})\n`,
      );
      success = true;
    } else {
      art.modifiers[mod]! += rng.randint1(2);
      randartLogf(
        () =>
          `Increasing ${propName(prop)} by 2, new value is: ${String(art.modifiers[mod])}\n`,
      );
      success = true;
    }

    /* Enforce cap. */
    if (mod !== OBJ_MOD.SPEED && art.modifiers[mod]! >= 6) {
      art.modifiers[mod] = 6;
    }
  }

  return success;
}

/* ------------------------------------------------------------------ */
/* add_stat (obj-randart.c L1823)                                      */
/* ------------------------------------------------------------------ */

/** add_stat (obj-randart.c L1823): add or increase a random stat modifier. */
export function addStat(reg: ObjRegistry, art: Artifact, rng: Rng): void {
  addMod(reg, art, OBJ_MOD.STR + rng.randint0(STAT_MAX), rng);
}

/* ------------------------------------------------------------------ */
/* add_sustain (obj-randart.c L1831)                                   */
/* ------------------------------------------------------------------ */

/** add_sustain (obj-randart.c L1831): add a random sustain, if any are free. */
export function addSustain(reg: ObjRegistry, art: Artifact, rng: Rng): void {
  /* Break out if all stats are sustained to avoid an infinite loop. */
  if (
    art.flags.testAll(
      OF.SUST_STR,
      OF.SUST_INT,
      OF.SUST_WIS,
      OF.SUST_DEX,
      OF.SUST_CON,
    )
  ) {
    return;
  }

  let success = false;
  while (!success) {
    const r = rng.randint0(5);
    if (r === 0) success = addFlag(reg, art, OF.SUST_STR);
    else if (r === 1) success = addFlag(reg, art, OF.SUST_INT);
    else if (r === 2) success = addFlag(reg, art, OF.SUST_WIS);
    else if (r === 3) success = addFlag(reg, art, OF.SUST_DEX);
    else if (r === 4) success = addFlag(reg, art, OF.SUST_CON);
  }
}

/* ------------------------------------------------------------------ */
/* add_low_resist (obj-randart.c L1854)                                */
/* ------------------------------------------------------------------ */

/** add_low_resist (obj-randart.c L1854): add a random unheld low resist. */
export function addLowResist(reg: ObjRegistry, art: Artifact, rng: Rng): void {
  let count = 0;
  for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
    if ((art.elInfo[i] as ElementInfo).resLevel <= 0) count++;
  }

  if (!count) return;

  const r = rng.randint0(count);
  count = 0;

  for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
    if ((art.elInfo[i] as ElementInfo).resLevel > 0) continue;
    if (r === count++) {
      addResist(reg, art, i);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* add_high_resist (obj-randart.c L1879)                               */
/* ------------------------------------------------------------------ */

/**
 * add_high_resist (obj-randart.c L1879): add a high resist chosen from the
 * learned high-resist frequency distribution. Faithfully preserves the
 * upstream weighting quirk in which the running `temp` accumulator is left in
 * a partial-sum state between retry iterations (it is not reset to the total).
 */
export function addHighResist(
  reg: ObjRegistry,
  art: Artifact,
  data: ArtifactSetData,
  rng: Rng,
): void {
  const n = artIdxHighResist.length;
  let temp = 0;
  for (let k = 0; k < n; k++) temp += data.artProbs[artIdxHighResist[k]!]!;

  let success = false;
  let count = 0;
  while (!success && count < MAX_TRIES) {
    /* Randomize from 1 to the current total amount. */
    const r = rng.randint1(temp);

    /* Determine which (weighted) resist this number corresponds to. */
    temp = data.artProbs[artIdxHighResist[0]!]!;
    let i = 0;
    while (r > temp && i < n) {
      temp += data.artProbs[artIdxHighResist[i]!]!;
      i++;
    }

    /* i is the index of the correct high resist. */
    if (i === 0) success = addResist(reg, art, ELEM.POIS);
    else if (i === 1) success = addFlag(reg, art, OF.PROT_FEAR);
    else if (i === 2) success = addResist(reg, art, ELEM.LIGHT);
    else if (i === 3) success = addResist(reg, art, ELEM.DARK);
    else if (i === 4) success = addFlag(reg, art, OF.PROT_BLIND);
    else if (i === 5) success = addFlag(reg, art, OF.PROT_CONF);
    else if (i === 6) success = addResist(reg, art, ELEM.SOUND);
    else if (i === 7) success = addResist(reg, art, ELEM.SHARD);
    else if (i === 8) success = addResist(reg, art, ELEM.NEXUS);
    else if (i === 9) success = addResist(reg, art, ELEM.NETHER);
    else if (i === 10) success = addResist(reg, art, ELEM.CHAOS);
    else if (i === 11) success = addResist(reg, art, ELEM.DISEN);
    else if (i === 12) success = addFlag(reg, art, OF.PROT_STUN);

    count++;
  }
}

/* ------------------------------------------------------------------ */
/* append_brand / append_slay (obj-slays.c)                            */
/* ------------------------------------------------------------------ */

/**
 * append_brand (obj-slays.c): try to add brand `pick`, replacing a same-named
 * lower-multiplier brand if present. Returns false when a same-or-greater
 * multiplier brand of the same name already exists.
 */
function appendBrand(art: Artifact, pick: number, reg: ObjRegistry): boolean {
  const brand = reg.brands[pick]!;
  if (!art.brands) {
    art.brands = new Array<boolean>(reg.brands.length).fill(false);
    art.brands[pick] = true;
    return true;
  }
  for (let i = 1; i < reg.brands.length; i++) {
    if (art.brands[i]) {
      if (reg.brands[i]!.name === brand.name) {
        if (brand.multiplier <= reg.brands[i]!.multiplier) return false;
        art.brands[i] = false;
        art.brands[pick] = true;
        return true;
      }
    }
  }
  art.brands[pick] = true;
  return true;
}

/**
 * same_monsters_slain (obj-slays.c): whether two slays affect the same
 * monsters (same race flag and same base).
 */
function sameMonstersSlain(reg: ObjRegistry, i: number, j: number): boolean {
  const a = reg.slays[i]!;
  const b = reg.slays[j]!;
  if (a.raceFlag !== b.raceFlag) return false;
  if (!a.base && !b.base) return true;
  if ((a.base && !b.base) || (!a.base && b.base)) return false;
  return a.base === b.base;
}

/**
 * append_slay (obj-slays.c): try to add slay `pick`, replacing a
 * same-monsters lower-multiplier slay if present. Returns false when a
 * same-or-greater multiplier slay of the same monsters already exists.
 */
function appendSlay(art: Artifact, pick: number, reg: ObjRegistry): boolean {
  const slay = reg.slays[pick]!;
  if (!art.slays) {
    art.slays = new Array<boolean>(reg.slays.length).fill(false);
    art.slays[pick] = true;
    return true;
  }
  for (let i = 1; i < reg.slays.length; i++) {
    if (art.slays[i]) {
      if (sameMonstersSlain(reg, i, pick)) {
        if (slay.multiplier <= reg.slays[i]!.multiplier) return false;
        art.slays[i] = false;
        art.slays[pick] = true;
        return true;
      }
    }
  }
  art.slays[pick] = true;
  return true;
}

/* ------------------------------------------------------------------ */
/* add_brand (obj-randart.c L1928)                                     */
/* ------------------------------------------------------------------ */

/**
 * add_brand (obj-randart.c L1928): add a brand (mostly only one), then
 * frequently add the resist matching the brand's element.
 */
export function addBrand(reg: ObjRegistry, art: Artifact, rng: Rng): void {
  /* Mostly only one brand. C short-circuits so randint0(4) is only rolled
   * when the artifact already has brands. */
  if (art.brands && rng.randint0(4)) return;

  /* Get a random brand. */
  let brandIdx = 0;
  for (let count = 0; count < MAX_TRIES; count++) {
    const pick = rng.randint1(reg.brands.length - 1);
    if (!appendBrand(art, pick, reg)) continue;
    randartLogf(() => {
      const b = reg.brands[pick]!;
      return `Adding brand: ${b.name}x${String(b.multiplier)}\n`;
    });
    brandIdx = pick;
    break;
  }

  /* Frequently add the corresponding resist. randint0(4) only rolls when a
   * brand was actually added. */
  if (brandIdx && rng.randint0(4)) {
    const brand = reg.brands[brandIdx]!;
    const projTable = projections(reg);
    for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
      if (
        brand.name === projTable[i]?.name &&
        (art.elInfo[i] as ElementInfo).resLevel <= 0
      ) {
        addResist(reg, art, i);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* add_slay (obj-randart.c L1962)                                      */
/* ------------------------------------------------------------------ */

/**
 * add_slay (obj-randart.c L1962): add a slay, then frequently add more slays
 * if the first choice was weak (power < 105).
 */
export function addSlay(reg: ObjRegistry, art: Artifact, rng: Rng): void {
  let slayIdx = 0;
  for (let count = 0; count < MAX_TRIES; count++) {
    const pick = rng.randint1(reg.slays.length - 1);
    if (!appendSlay(art, pick, reg)) continue;
    randartLogf(() => {
      const sl = reg.slays[pick]!;
      return `Adding slay: ${sl.name}x${String(sl.multiplier)}\n`;
    });
    slayIdx = pick;
    break;
  }

  /* Frequently add more slays if the first choice is weak. randint0(4) only
   * rolls when a slay was actually added. */
  if (slayIdx && rng.randint0(4) && reg.slays[slayIdx]!.power < 105) {
    addSlay(reg, art, rng);
  }
}

/* ------------------------------------------------------------------ */
/* add_damage_dice (obj-randart.c L1986)                               */
/* ------------------------------------------------------------------ */

/** add_damage_dice (obj-randart.c L1986): add one or two damage dice. */
/**
 * C's "%+d": a signed integer that keeps an explicit "+" on non-negatives.
 * printf writes "+3" and "0" as "+0"; JS template interpolation writes "3" and
 * "0", so the log lines that use it need this rather than the default.
 */
function plusD(n: number): string {
  return n < 0 ? String(n) : `+${n}`;
}

export function addDamageDice(art: Artifact, rng: Rng): void {
  art.dd += rng.randint1(2);
  randartLogf(
    () => `Adding ability: extra damage dice (now ${art.dd} dice)\n`,
  );
}

/* ------------------------------------------------------------------ */
/* add_to_hit (obj-randart.c L1997)                                    */
/* ------------------------------------------------------------------ */

/**
 * add_to_hit (obj-randart.c L1997): add to-hit unless already too high (the
 * high thresholds are only bypassed by the inhibiting rolls).
 */
export function addToHit(
  art: Artifact,
  fixed: number,
  random: number,
  rng: Rng,
): void {
  if (art.toH > VERYHIGH_TO_HIT) {
    if (!rng.oneIn(6)) {
      randartLogf(
        () => `Failed to add to-hit, value ${art.toH} is too high\n`,
      );
      return;
    }
  } else if (art.toH > HIGH_TO_HIT) {
    if (!rng.oneIn(2)) {
      randartLogf(
        () => `Failed to add to-hit, value ${art.toH} is too high\n`,
      );
      return;
    }
  }
  art.toH += fixed + rng.randint0(random);
  randartLogf(() => `Adding ability: extra to_h (now ${plusD(art.toH)})\n`);
}

/* ------------------------------------------------------------------ */
/* add_to_dam (obj-randart.c L2020)                                    */
/* ------------------------------------------------------------------ */

/**
 * add_to_dam (obj-randart.c L2020): add to-dam unless already too high. Note
 * the upstream quirk kept faithfully: the HIGH threshold branch tests to_h,
 * not to_d.
 */
export function addToDam(
  art: Artifact,
  fixed: number,
  random: number,
  rng: Rng,
): void {
  if (art.toD > VERYHIGH_TO_DAM) {
    if (!rng.oneIn(6)) {
      randartLogf(
        () => `Failed to add to-dam, value ${art.toD} is too high\n`,
      );
      return;
    }
  } else if (art.toH > HIGH_TO_DAM) {
    if (!rng.oneIn(2)) {
      randartLogf(
        () => `Failed to add to-dam, value ${art.toD} is too high\n`,
      );
      return;
    }
  }
  art.toD += fixed + rng.randint0(random);
  randartLogf(
    () => `Adding ability: extra to_dam (now ${plusD(art.toD)})\n`,
  );
}

/* ------------------------------------------------------------------ */
/* add_to_AC (obj-randart.c L2044)                                     */
/* ------------------------------------------------------------------ */

/**
 * add_to_AC (obj-randart.c L2044): add to-AC unless already too high. Note the
 * upstream quirk kept faithfully: the HIGH threshold branch tests to_h, not
 * to_a.
 */
export function addToAC(
  art: Artifact,
  fixed: number,
  random: number,
  rng: Rng,
): void {
  if (art.toA > VERYHIGH_TO_AC) {
    if (!rng.oneIn(6)) {
      randartLogf(
        () => `Failed to add to-AC, value ${art.toA} is too high\n`,
      );
      return;
    }
  } else if (art.toH > HIGH_TO_AC) {
    if (!rng.oneIn(2)) {
      randartLogf(
        () => `Failed to add to-AC, value ${art.toA} is too high\n`,
      );
      return;
    }
  }
  art.toA += fixed + rng.randint0(random);
  randartLogf(
    () => `Adding ability: AC bonus (new bonus is ${plusD(art.toA)})\n`,
  );
}

/* ------------------------------------------------------------------ */
/* add_weight_mod (obj-randart.c L2068)                                */
/* ------------------------------------------------------------------ */

/** add_weight_mod (obj-randart.c L2068): lower the artifact's weight by 10%. */
export function addWeightMod(art: Artifact): void {
  art.weight = Math.trunc((art.weight * 9) / 10);
  randartLogf(
    () => `Adding ability: lower weight (new weight is ${art.weight})\n`,
  );
}

/* ------------------------------------------------------------------ */
/* add_activation (obj-randart.c L2078)                                */
/* ------------------------------------------------------------------ */

/**
 * add_activation (obj-randart.c L2078): give the artifact a random activation
 * that is useful but not exploitable and roughly proportionate to its power.
 * z_info->act_max is reg.activations.length (index 0 is the null/zeroed slot,
 * mirroring the zeroed activations[0] upstream).
 */
export function addActivation(
  reg: ObjRegistry,
  art: Artifact,
  targetPower: number,
  maxPower: number,
  rng: Rng,
): void {
  const actMax = reg.activations.length;

  /* Work out the maximum allowed activation power. */
  let maxEffect = 0;
  for (let i = 0; i < actMax; i++) {
    const act = reg.activations[i];
    const power = act ? act.power : 0;
    if (power > maxEffect && power < INHIBIT_POWER) maxEffect = power;
  }

  /* Select an activation at random. */
  let count = 0;
  while (count < MAX_TRIES) {
    const x = rng.randint0(actMax);
    const act = reg.activations[x];
    const p = act ? act.power : 0;

    if (
      p < INHIBIT_POWER &&
      Math.trunc((100 * p) / maxEffect) >
        Math.trunc((50 * targetPower) / maxPower) &&
      Math.trunc((100 * p) / maxEffect) <
        Math.trunc((200 * targetPower) / maxPower)
    ) {
      randartLogf(() => `Adding activation effect ${String(x)}\n`);
      art.activation = act!;
      art.level = act!.level;
      art.time.base = p * 8;
      art.time.dice = p > 5 ? Math.trunc(p / 5) : 1;
      art.time.sides = p;
      return;
    }
    count++;
  }
}

/* ------------------------------------------------------------------ */
/* choose_ability (obj-randart.c L2121)                                */
/* ------------------------------------------------------------------ */

/**
 * choose_ability (obj-randart.c L2121): choose an ability index weighted by the
 * given cumulative frequency table (length ART_IDX_TOTAL).
 */
export function chooseAbility(freqTable: readonly number[], rng: Rng): number {
  const r = rng.randint1(freqTable[ART_IDX_TOTAL - 1]!);
  let ability = 0;
  while (r > freqTable[ability]!) ability++;

  randartLogf(() => `Ability chosen was number: ${String(ability)}\n`);
  return ability;
}

/* ------------------------------------------------------------------ */
/* add_ability_aux (obj-randart.c L2150)                               */
/* ------------------------------------------------------------------ */

/**
 * add_ability_aux (obj-randart.c L2150): add the ability given by index r. A
 * general dispatch that imposes no item-type restriction (that is handled by
 * the frequency table).
 */
export function addAbilityAux(
  reg: ObjRegistry,
  art: Artifact,
  r: number,
  targetPower: number,
  data: ArtifactSetData,
  rng: Rng,
): void {
  const kind = reg.lookupKind(art.tval, art.sval);

  /* The upstream switch on the ability index is now the randart registry's
   * `abilities` table, so a mod can coin a NEW ability and have it do
   * something. An unregistered index does nothing, which is upstream's own
   * default arm - but before this seam that was ALSO what a mod's index did,
   * silently, after the design loop had already spent power on it. */
  randartRegistry().abilities.handlerFor(r)?.({
    reg,
    art,
    kind,
    targetPower,
    data,
    rng,
  });
}

/* ------------------------------------------------------------------ */
/* Curse conflict helpers (obj-curse.c)                                */
/* ------------------------------------------------------------------ */

/**
 * check_artifact_curses (obj-curse.c L243): drop the curses field if no active
 * curse remains.
 */
function checkArtifactCurses(art: Artifact): void {
  if (!art.curses) return;
  for (let i = 0; i < art.curses.length; i++) {
    if (art.curses[i]) return;
  }
  art.curses = null;
}

/**
 * curses_conflict (obj-curse.c L95): whether curse `second` is in curse
 * `first`'s conflict list.
 */
function cursesConflict(
  reg: ObjRegistry,
  first: number,
  second: number,
): boolean {
  const c = reg.curses[first]!;
  if (!c.conflict) return false;
  const needle = "|" + reg.curses[second]!.name + "|";
  return c.conflict.includes(needle);
}

/**
 * artifact_curse_conflicts (obj-curse.c L262): whether curse `pick` is foiled
 * by an existing artifact property - its TIMED_INC effect fails against a
 * flag/resist/vulnerability the artifact already has (obj-curse.c L267-296,
 * consulted only when `timedFoil` is supplied), or it explicitly conflicts with
 * an artifact flag. Draws no RNG.
 */
function artifactCurseConflicts(
  reg: ObjRegistry,
  art: Artifact,
  pick: number,
  timedFoil?: CurseTimedFoil,
): boolean {
  const c = reg.curses[pick]!;

  /* Reject curses with effects foiled by an existing artifact property. */
  if (timedFoil && curseTimedIncFoiled(c, art.flags, art.elInfo, timedFoil)) {
    checkArtifactCurses(art);
    return true;
  }

  for (const flag of c.conflictFlags) {
    if (art.flags.has(flag)) {
      checkArtifactCurses(art);
      return true;
    }
  }
  return false;
}

/**
 * append_artifact_curse (obj-curse.c L317): add curse `pick` at the given
 * power, rejecting conflicts. Returns true when the curse was applied.
 */
function appendArtifactCurse(
  reg: ObjRegistry,
  art: Artifact,
  pick: number,
  power: number,
  timedFoil?: CurseTimedFoil,
): boolean {
  if (!art.curses) art.curses = new Array<number>(reg.curses.length).fill(0);

  /* Reject conflicting curses. */
  for (let i = 0; i < reg.curses.length; i++) {
    if (art.curses[i] && cursesConflict(reg, i, pick)) {
      checkArtifactCurses(art);
      return false;
    }
  }

  /* Reject curses foiled by an existing artifact property. */
  if (artifactCurseConflicts(reg, art, pick, timedFoil)) {
    checkArtifactCurses(art);
    return false;
  }

  /* Adjust power if our pick is a duplicate. */
  if (power > art.curses[pick]!) art.curses[pick] = power;

  checkArtifactCurses(art);
  return true;
}

/* ------------------------------------------------------------------ */
/* remove_contradictory_activation (obj-randart.c L2420)               */
/* ------------------------------------------------------------------ */

/**
 * enum effect_object_property_kind (effects-info.h L40): the kind of object
 * property an activation effect grants, as summarized for redundancy checks.
 */
export const EFPROP = {
  OBJECT_FLAG_EXACT: 0,
  OBJECT_FLAG: 1,
  RESIST: 2,
  CURE_FLAG: 3,
  CURE_RESIST: 4,
  CONFLICT_FLAG: 5,
  CONFLICT_RESIST: 6,
  CONFLICT_VULN: 7,
  BRAND: 8,
  SLAY: 9,
} as const;

/** struct effect_object_property (effects-info.h L53): one summarized property. */
export interface EffectObjectProperty {
  /** EFPROP_* kind. */
  kind: number;
  /** OF_ / ELEM_ / brand / slay index, per `kind`. */
  idx: number;
  /** For the resist/vuln kinds: the res_level window that makes it redundant. */
  reslevelMin: number;
  reslevelMax: number;
}

/**
 * effect_summarize_properties (effects-info.c L898): summarize the object
 * properties an activation's effect chain grants, plus a count of sub-effects
 * that map to no object property. This lives in the effects domain (out of this
 * work package's lock) and is injected so remove_contradictory_activation can
 * measure redundancy. When no summarizer is supplied the activation is never
 * treated as redundant (a conservative no-op).
 */
export type ActivationSummarizer = (
  effect: readonly EffectRecordJson[],
) => { props: EffectObjectProperty[]; unsummarizedCount: number };

/**
 * remove_contradictory_activation (obj-randart.c L2420): drop the activation
 * when everything it does is already provided by (or in conflict with) the
 * artifact's other properties. Upstream summarizes the activation via
 * effect_summarize_properties; the port injects that summarizer (see
 * ActivationSummarizer / gap 3.8 WIRING-NEEDED). The redundancy switch below is
 * a faithful transcription; it draws no RNG.
 */
export function removeContradictoryActivation(
  reg: ObjRegistry,
  art: Artifact,
  summarize?: ActivationSummarizer,
): void {
  if (!art.activation || !art.activation.effect) return;

  /* Without the effects-domain summarizer, redundancy cannot be proven; keep the
   * activation (conservative). */
  if (!summarize) return;

  const { props, unsummarizedCount } = summarize(art.activation.effect);
  let redundant = true;

  if (unsummarizedCount > 0) {
    /* The activation does at least one thing with no object-property twin. */
    redundant = false;
  } else {
    for (const p of props) {
      if (!redundant) break;
      /* The upstream switch on the EFPROP kind is now the randart registry's
       * `redundancy` table. An unregistered kind keeps the activation, which
       * is upstream's own default and the safe direction: a kept activation is
       * a weaker artifact than intended, a dropped one is a missing power. */
      const judge = randartRegistry().redundancy.handlerFor(p.kind);
      redundant = judge ? judge({ reg, art, prop: p }) : false;
    }
  }

  if (redundant) art.activation = null;
}

/* ------------------------------------------------------------------ */
/* remove_contradictory (obj-randart.c L2530)                          */
/* ------------------------------------------------------------------ */

/**
 * remove_contradictory (obj-randart.c L2530): clean up illogical combinations
 * of powers (aggravation vs stealth, negative stats vs their sustains,
 * drain-exp vs hold-life), remove conflicting curses, and drop a redundant
 * activation.
 */
export function removeContradictory(
  reg: ObjRegistry,
  art: Artifact,
  timedFoil?: CurseTimedFoil,
  activationSummarize?: ActivationSummarizer,
): void {
  if (art.flags.has(OF.AGGRAVATE)) art.modifiers[OBJ_MOD.STEALTH] = 0;

  if (art.modifiers[OBJ_MOD.STR]! < 0) art.flags.off(OF.SUST_STR);
  if (art.modifiers[OBJ_MOD.INT]! < 0) art.flags.off(OF.SUST_INT);
  if (art.modifiers[OBJ_MOD.WIS]! < 0) art.flags.off(OF.SUST_WIS);
  if (art.modifiers[OBJ_MOD.DEX]! < 0) art.flags.off(OF.SUST_DEX);
  if (art.modifiers[OBJ_MOD.CON]! < 0) art.flags.off(OF.SUST_CON);

  if (art.flags.has(OF.DRAIN_EXP)) art.flags.off(OF.HOLD_LIFE);

  /* Remove any conflicting curses. */
  if (art.curses) {
    for (let i = 1; i < reg.curses.length; i++) {
      if (artifactCurseConflicts(reg, art, i, timedFoil)) {
        if (art.curses) art.curses[i] = 0;
        checkArtifactCurses(art);
      }
      if (!art.curses) break;
    }
  }

  removeContradictoryActivation(reg, art, activationSummarize);
}

/* ------------------------------------------------------------------ */
/* add_ability (obj-randart.c L2567)                                   */
/* ------------------------------------------------------------------ */

/**
 * add_ability (obj-randart.c L2567): choose a random ability from the frequency
 * table, add it, remove contradictions, and bless WIS-bearing sharp weapons.
 */
export function addAbility(
  reg: ObjRegistry,
  art: Artifact,
  targetPower: number,
  freq: readonly number[],
  data: ArtifactSetData,
  rng: Rng,
): void {
  /* Choose a random ability using the frequency table. */
  const r = chooseAbility(freq, rng);

  /* Add the appropriate ability. */
  addAbilityAux(reg, art, r, targetPower, data, rng);

  /* Remove contradictory or redundant powers. */
  removeContradictory(reg, art, data.timedFoil, data.activationSummarize);

  /* Adding WIS to sharp weapons always blesses them. */
  if (
    art.modifiers[OBJ_MOD.WIS] &&
    (art.tval === TV.SWORD || art.tval === TV.POLEARM)
  ) {
    addFlag(reg, art, OF.BLESSED);
  }
}

/* ------------------------------------------------------------------ */
/* add_curse (obj-randart.c L2591)                                     */
/* ------------------------------------------------------------------ */

/**
 * add_curse (obj-randart.c L2591): randomly select a curse and apply it, unless
 * the artifact is blessed. Each attempt draws pick then power regardless of
 * whether the curse is possible on this tval. See the module note on the
 * randint1(9) + 10 * m_bonus(9, level) evaluation order.
 */
export function addCurse(
  reg: ObjRegistry,
  art: Artifact,
  level: number,
  rng: Rng,
  timedFoil?: CurseTimedFoil,
): boolean {
  if (art.flags.has(OF.BLESSED)) return false;

  let maxTries = 5;
  while (maxTries) {
    const pick = rng.randint1(reg.curses.length - 1);
    const rand9 = rng.randint1(9);
    const bonus = rng.mBonus(9, level);
    const power = rand9 + 10 * bonus;
    if (!reg.curses[pick]!.poss[art.tval]) {
      maxTries--;
      continue;
    }
    return appendArtifactCurse(reg, art, pick, power, timedFoil);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* make_bad (obj-randart.c L2613)                                      */
/* ------------------------------------------------------------------ */

/**
 * make_bad (obj-randart.c L2613): make an artifact bad, or worse: possibly add
 * aggravation / drain-exp / no-teleport, flip some positive modifiers and
 * combat bonuses to negative, and apply one or two curses.
 */
export function makeBad(
  reg: ObjRegistry,
  art: Artifact,
  level: number,
  rng: Rng,
  timedFoil?: CurseTimedFoil,
): void {
  let num = rng.randint1(2);

  randartLog("Make it bad:\n");
  randartLog("   ");

  if (rng.oneIn(7)) {
    art.flags.on(OF.AGGRAVATE);
    randartLog(" aggravate,");
  }
  if (rng.oneIn(4)) {
    art.flags.on(OF.DRAIN_EXP);
    randartLog(" drain xp,");
  }
  if (rng.oneIn(7)) {
    art.flags.on(OF.NO_TELEPORT);
    randartLog(" no tele,");
  }

  let count1 = 0;
  let count2 = 0;
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    if (art.modifiers[i]! > 0) {
      ++count1;
      if (rng.oneIn(2) && i !== OBJ_MOD.MIGHT) {
        art.modifiers[i] = -art.modifiers[i]!;
        ++count2;
      }
    }
  }
  randartLogf(
    () => ` flip ${String(count2)} of ${String(count1)} modifiers,`,
  );

  if (art.toA > 0 && rng.oneIn(2)) {
    art.toA = -art.toA;
    randartLog(" flip ac,");
  }
  if (art.toH > 0 && rng.oneIn(2)) {
    art.toH = -art.toH;
    randartLog(" flip to-hit,");
  }
  if (art.toD > 0 && rng.oneIn(4)) {
    art.toD = -art.toD;
    randartLog(" flip to-dam,");
  }

  count1 = num;
  count2 = 0;
  while (num) {
    if (addCurse(reg, art, level, rng, timedFoil)) ++count2;
    num--;
  }
  randartLogf(
    () => ` ${String(count2)} of ${String(count1)} curses applied\n`,
  );
}

/* ------------------------------------------------------------------ *
 * Core's randart arms, lifted case by case.
 *
 * Every arm is the upstream case body unchanged, in upstream's order. A group
 * that upstream handles in one shared `case` block registers the SAME closure
 * under each index rather than being merged, because the indices are separate
 * keys and a mod replacing one must not silently replace its siblings -
 * `MELEE_AC` and `GEN_AC` do the same thing today and a mod may well want them
 * to stop doing the same thing.
 * ------------------------------------------------------------------ */

seedRandart((registry) => {
  /** Register one handler under every index of a group. */
  const ability = (
    indices: readonly number[],
    handler: RandartAbilityHandler,
  ): void => {
    for (const index of indices) registry.abilities.set(index, handler);
  };
  /** The commonest shape: add one object modifier. */
  const mod = (indices: readonly number[], objMod: number): void => {
    ability(indices, (c) => {
      addMod(c.reg, c.art, objMod, c.rng);
    });
  };
  /** The next commonest: turn one object flag on. */
  const flag = (indices: readonly number[], objFlag: number): void => {
    ability(indices, (c) => {
      addFlag(c.reg, c.art, objFlag);
    });
  };
  /** And: grant one elemental resist. */
  const resist = (indices: readonly number[], element: number): void => {
    ability(indices, (c) => {
      addResist(c.reg, c.art, element);
    });
  };

  mod([ART_IDX.BOW_SHOTS, ART_IDX.NONWEAPON_SHOTS], OBJ_MOD.SHOTS);
  mod([ART_IDX.BOW_MIGHT], OBJ_MOD.MIGHT);

  ability([ART_IDX.WEAPON_HIT, ART_IDX.NONWEAPON_HIT], (c) => {
    addToHit(c.art, 1, 2 * c.data.hitIncrement, c.rng);
  });
  ability([ART_IDX.WEAPON_DAM, ART_IDX.NONWEAPON_DAM], (c) => {
    addToDam(c.art, 1, 2 * c.data.damIncrement, c.rng);
  });
  ability([ART_IDX.NONWEAPON_HIT_DAM, ART_IDX.GLOVE_HIT_DAM], (c) => {
    addToHit(c.art, 1, 2 * c.data.hitIncrement, c.rng);
    addToDam(c.art, 1, 2 * c.data.damIncrement, c.rng);
  });

  /* Aggravation is only worth its power cost on a strong artifact
   * (obj-randart.h L47); below AGGR_POWER this arm does nothing at all. */
  ability([ART_IDX.WEAPON_AGGR, ART_IDX.NONWEAPON_AGGR], (c) => {
    if (c.targetPower > AGGR_POWER) addFlag(c.reg, c.art, OF.AGGRAVATE);
  });

  flag([ART_IDX.MELEE_BLESS], OF.BLESSED);

  ability(
    [ART_IDX.BOW_BRAND, ART_IDX.MELEE_BRAND, ART_IDX.NONWEAPON_BRAND],
    (c) => {
      addBrand(c.reg, c.art, c.rng);
    },
  );
  ability([ART_IDX.BOW_SLAY, ART_IDX.MELEE_SLAY, ART_IDX.NONWEAPON_SLAY], (c) => {
    addSlay(c.reg, c.art, c.rng);
  });

  flag([ART_IDX.MELEE_SINV, ART_IDX.HELM_SINV, ART_IDX.GEN_SINV], OF.SEE_INVIS);
  mod([ART_IDX.MELEE_BLOWS, ART_IDX.NONWEAPON_BLOWS], OBJ_MOD.BLOWS);

  ability(
    [
      ART_IDX.MELEE_AC,
      ART_IDX.BOOT_AC,
      ART_IDX.GLOVE_AC,
      ART_IDX.HELM_AC,
      ART_IDX.SHIELD_AC,
      ART_IDX.CLOAK_AC,
      ART_IDX.ARMOR_AC,
      ART_IDX.GEN_AC,
    ],
    (c) => {
      addToAC(c.art, 1, 2 * c.data.acIncrement, c.rng);
    },
  );

  ability([ART_IDX.MELEE_DICE], (c) => {
    addDamageDice(c.art, c.rng);
  });
  ability([ART_IDX.MELEE_WEIGHT, ART_IDX.ALLARMOR_WEIGHT], (c) => {
    addWeightMod(c.art);
  });

  mod([ART_IDX.MELEE_TUNN, ART_IDX.GEN_TUNN], OBJ_MOD.TUNNEL);
  flag([ART_IDX.BOOT_FEATHER, ART_IDX.GEN_FEATHER], OF.FEATHER);
  mod(
    [
      ART_IDX.BOOT_STEALTH,
      ART_IDX.CLOAK_STEALTH,
      ART_IDX.ARMOR_STEALTH,
      ART_IDX.GEN_STEALTH,
    ],
    OBJ_MOD.STEALTH,
  );
  mod([ART_IDX.BOOT_SPEED, ART_IDX.GEN_SPEED], OBJ_MOD.SPEED);
  flag([ART_IDX.GLOVE_FA, ART_IDX.GEN_FA], OF.FREE_ACT);
  mod([ART_IDX.GLOVE_DEX], OBJ_MOD.DEX);
  flag([ART_IDX.HELM_RBLIND, ART_IDX.GEN_RBLIND], OF.PROT_BLIND);
  flag([ART_IDX.HELM_ESP, ART_IDX.GEN_ESP], OF.TELEPATHY);
  mod([ART_IDX.HELM_WIS], OBJ_MOD.WIS);
  mod([ART_IDX.HELM_INT], OBJ_MOD.INT);

  ability([ART_IDX.SHIELD_LRES, ART_IDX.ARMOR_LRES, ART_IDX.GEN_LRES], (c) => {
    addLowResist(c.reg, c.art, c.rng);
  });

  flag([ART_IDX.ARMOR_HLIFE, ART_IDX.GEN_HLIFE], OF.HOLD_LIFE);
  mod([ART_IDX.ARMOR_CON], OBJ_MOD.CON);

  ability([ART_IDX.ARMOR_ALLRES], (c) => {
    addResist(c.reg, c.art, ELEM.ACID);
    addResist(c.reg, c.art, ELEM.ELEC);
    addResist(c.reg, c.art, ELEM.FIRE);
    addResist(c.reg, c.art, ELEM.COLD);
  });
  ability([ART_IDX.ARMOR_HRES], (c) => {
    addHighResist(c.reg, c.art, c.data, c.rng);
  });
  ability([ART_IDX.GEN_STAT], (c) => {
    addStat(c.reg, c.art, c.rng);
  });
  ability([ART_IDX.GEN_SUST], (c) => {
    addSustain(c.reg, c.art, c.rng);
  });

  mod([ART_IDX.GEN_SEARCH], OBJ_MOD.SEARCH);
  mod([ART_IDX.GEN_INFRA], OBJ_MOD.INFRA);

  ability([ART_IDX.GEN_IMMUNE], (c) => {
    addImmunity(c.reg, c.art, c.rng);
  });
  /* A light source already carries its own light; this only lifts an item that
   * has none (obj-randart.c L2338). */
  ability([ART_IDX.GEN_LIGHT], (c) => {
    if (c.art.tval !== TV.LIGHT) c.art.modifiers[OBJ_MOD.LIGHT] = 1;
  });

  flag([ART_IDX.GEN_SDIG], OF.SLOW_DIGEST);
  flag([ART_IDX.GEN_REGEN], OF.REGEN);
  resist([ART_IDX.GEN_RPOIS], ELEM.POIS);
  flag([ART_IDX.GEN_RFEAR], OF.PROT_FEAR);
  resist([ART_IDX.GEN_RLIGHT], ELEM.LIGHT);
  resist([ART_IDX.GEN_RDARK], ELEM.DARK);
  flag([ART_IDX.GEN_RCONF], OF.PROT_CONF);
  resist([ART_IDX.GEN_RSOUND], ELEM.SOUND);
  resist([ART_IDX.GEN_RSHARD], ELEM.SHARD);
  resist([ART_IDX.GEN_RNEXUS], ELEM.NEXUS);
  resist([ART_IDX.GEN_RNETHER], ELEM.NETHER);
  resist([ART_IDX.GEN_RCHAOS], ELEM.CHAOS);
  resist([ART_IDX.GEN_RDISEN], ELEM.DISEN);
  flag([ART_IDX.GEN_PSTUN], OF.PROT_STUN);
  flag([ART_IDX.BOOT_TRAP_IMM, ART_IDX.GEN_TRAP_IMM], OF.TRAP_IMMUNE);
  mod([ART_IDX.GEN_DAM_RED], OBJ_MOD.DAM_RED);
  mod([ART_IDX.GEN_MOVES, ART_IDX.BOOT_MOVES], OBJ_MOD.MOVES);

  /* Never a second activation, and never one over a base item that already
   * activates (obj-randart.c L2400). */
  ability([ART_IDX.GEN_ACTIV], (c) => {
    if (!c.art.activation && !c.kind?.activation) {
      addActivation(c.reg, c.art, c.targetPower, c.data.maxPower, c.rng);
    }
  });

  /* ---------------- artifact_prep, keyed on the item class ---------------- */

  const prep = (tvals: readonly number[], handler: RandartPrepHandler): void => {
    for (const tval of tvals) registry.prep.set(tval, handler);
  };

  prep([TV.BOW, TV.DIGGING, TV.HAFTED, TV.SWORD, TV.POLEARM], (c) => {
    c.art.toH +=
      Math.trunc(c.data.hitStartval / 2) + c.rng.randint0(c.data.hitStartval);
    c.art.toD +=
      Math.trunc(c.data.damStartval / 2) + c.rng.randint0(c.data.damStartval);
    randartLogf(
      () =>
        `Assigned basic stats, to_hit: ${String(c.art.toH)}, to_dam: ${String(c.art.toD)}\n`,
    );
  });

  prep(
    [
      TV.BOOTS,
      TV.GLOVES,
      TV.HELM,
      TV.CROWN,
      TV.SHIELD,
      TV.CLOAK,
      TV.SOFT_ARMOR,
      TV.HARD_ARMOR,
      TV.DRAG_ARMOR,
    ],
    (c) => {
      c.art.toA +=
        Math.trunc(c.data.acStartval / 2) + c.rng.randint0(c.data.acStartval);
      randartLogf(() => `Assigned basic stats, AC bonus: ${String(c.art.toA)}\n`);
    },
  );

  prep([TV.LIGHT], (c) => {
    c.art.flags.off(OF.TAKES_FUEL);
    c.art.flags.off(OF.BURNS_OUT);
    c.art.flags.on(OF.NO_FUEL);
    if (c.kind.kidx >= c.reg.ordinaryKindCount) {
      c.art.modifiers[OBJ_MOD.LIGHT] = 3;
    }
  });

  /* -------------- activation redundancy, keyed on EFPROP kind -------------- */

  registry.redundancy.set(EFPROP.BRAND, ({ reg, art, prop }) => {
    let maxmult = 1;
    for (let i = 1; i < reg.brands.length; i++) {
      if (!art.brands?.[i]) continue;
      if (reg.brands[i]!.resistFlag !== reg.brands[prop.idx]!.resistFlag) continue;
      maxmult = Math.max(reg.brands[i]!.multiplier, maxmult);
    }
    return maxmult >= reg.brands[prop.idx]!.multiplier;
  });

  registry.redundancy.set(EFPROP.SLAY, ({ reg, art, prop }) => {
    let maxmult = 1;
    for (let i = 1; i < reg.slays.length; i++) {
      if (!art.slays?.[i]) continue;
      if (!sameMonstersSlain(reg, i, prop.idx)) continue;
      maxmult = Math.max(reg.slays[i]!.multiplier, maxmult);
    }
    return maxmult >= reg.slays[prop.idx]!.multiplier;
  });

  const resistWindow = ({ art, prop }: RandartRedundancyContext): boolean => {
    const res = art.elInfo[prop.idx]?.resLevel ?? 0;
    return !(res >= prop.reslevelMin && res <= prop.reslevelMax);
  };
  registry.redundancy.set(EFPROP.RESIST, resistWindow);
  registry.redundancy.set(EFPROP.CONFLICT_RESIST, resistWindow);
  registry.redundancy.set(EFPROP.CONFLICT_VULN, resistWindow);

  /* Does more than the flag; keep it (also screens HERO/SHERO). */
  registry.redundancy.set(EFPROP.OBJECT_FLAG, () => false);

  const flagHeld = ({ art, prop }: RandartRedundancyContext): boolean =>
    art.flags.has(prop.idx);
  registry.redundancy.set(EFPROP.OBJECT_FLAG_EXACT, flagHeld);
  registry.redundancy.set(EFPROP.CURE_FLAG, flagHeld);
  registry.redundancy.set(EFPROP.CONFLICT_FLAG, flagHeld);
});
