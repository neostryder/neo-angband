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
 * - The upstream file_putf(log_file, ...) logging is dropped throughout; it
 *   never affects any returned value or RNG draw (same convention as power.ts
 *   and randart-data.ts). Where a routine's only use of a value was logging
 *   (e.g. lookup_obj_property in add_flag / add_mod), that lookup is dropped.
 * - add_brand adds the resist matching the picked brand by comparing the
 *   brand's name to projections[element].name for the four base elements.
 *   Projections are not bound in ObjRegistry, so the base-element projection
 *   names are held in a small local table (BASE_ELEMENT_PROJ_NAMES) mirroring
 *   projection.txt / projection.json; noted as an approximation.
 * - remove_contradictory_activation depends on effect_summarize_properties
 *   (effects-info.c), which is not ported. Since that routine consumes no RNG
 *   and only ever nulls an activation when it is fully redundant with the
 *   artifact's other properties, it is implemented as a conservative no-op
 *   (activations are never treated as redundant). Noted as an approximation.
 * - artifact_curse_conflicts's TIMED_INC "effect foiled by an existing
 *   property" branch depends on the timed-effects failure tables (not ported);
 *   only the explicit conflict-flags branch is ported. This affects only the
 *   cursed-artifact path (make_bad) and consumes no RNG. Noted as an
 *   approximation.
 * - add_curse computes power as randint1(9) + 10 * m_bonus(9, level); C leaves
 *   the evaluation order of the two calls unspecified, so this port draws
 *   randint1 then m_bonus (left-to-right textual order).
 */

import { ELEM, KF, OBJ_MOD, OF, STAT_ENTRIES, TV } from "../generated";
import { ART_IDX } from "../generated/randart-properties";
import type { Rng } from "../rng";
import type { ObjRegistry } from "./bind";
import type { CurseTimedFoil } from "./object";
import { copyBrands, copySlays, curseTimedIncFoiled } from "./object";
import { INHIBIT_POWER } from "./power";
import type { ArtifactSetData } from "./randart-data";
import type {
  Artifact,
  EffectRecordJson,
  ElementInfo,
  ObjectKind,
} from "./types";
import {
  EL_INFO_IGNORE,
  ELEM_BASE_MIN,
  ELEM_HIGH_MIN,
  OBJ_MOD_MAX,
} from "./types";

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
 * projections[element].name for the four base elements (projection.txt), used
 * by add_brand to add the resist that matches the brand it just added.
 * Projections are not bound in ObjRegistry, so the names are held here.
 * Indexed by ELEM value (ACID..COLD).
 */
const BASE_ELEMENT_PROJ_NAMES: readonly string[] = [
  "acid", // ELEM_ACID
  "lightning", // ELEM_ELEC
  "fire", // ELEM_FIRE
  "cold", // ELEM_COLD
];

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
  if (tval === TV.RING || tval === TV.AMULET) {
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

  /* Assign basic stats to the artifact based on its type. */
  switch (kind.tval) {
    case TV.BOW:
    case TV.DIGGING:
    case TV.HAFTED:
    case TV.SWORD:
    case TV.POLEARM:
      art.toH += Math.trunc(data.hitStartval / 2) + rng.randint0(data.hitStartval);
      art.toD += Math.trunc(data.damStartval / 2) + rng.randint0(data.damStartval);
      break;
    case TV.BOOTS:
    case TV.GLOVES:
    case TV.HELM:
    case TV.CROWN:
    case TV.SHIELD:
    case TV.CLOAK:
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
      art.toA += Math.trunc(data.acStartval / 2) + rng.randint0(data.acStartval);
      break;
    case TV.LIGHT:
      art.flags.off(OF.TAKES_FUEL);
      art.flags.off(OF.BURNS_OUT);
      art.flags.on(OF.NO_FUEL);
      if (kind.kidx >= reg.ordinaryKindCount) {
        art.modifiers[OBJ_MOD.LIGHT] = 3;
      }
      break;
    default:
      break;
  }
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
  if (art.tval === TV.BOW) copyGroup(artIdxBow);

  /* General weapon abilities. */
  if (
    art.tval === TV.BOW ||
    art.tval === TV.DIGGING ||
    art.tval === TV.HAFTED ||
    art.tval === TV.POLEARM ||
    art.tval === TV.SWORD
  ) {
    copyGroup(artIdxWeapon);
  } else {
    /* General non-weapon abilities. */
    copyGroup(artIdxNonweapon);
  }

  /* General melee abilities. */
  if (
    art.tval === TV.DIGGING ||
    art.tval === TV.HAFTED ||
    art.tval === TV.POLEARM ||
    art.tval === TV.SWORD
  ) {
    copyGroup(artIdxMelee);
  }

  /* General armor abilities. */
  if (
    art.tval === TV.BOOTS ||
    art.tval === TV.GLOVES ||
    art.tval === TV.HELM ||
    art.tval === TV.CROWN ||
    art.tval === TV.SHIELD ||
    art.tval === TV.CLOAK ||
    art.tval === TV.SOFT_ARMOR ||
    art.tval === TV.HARD_ARMOR ||
    art.tval === TV.DRAG_ARMOR
  ) {
    copyGroup(artIdxAllarmor);
  }

  /* Boot abilities. */
  if (art.tval === TV.BOOTS) copyGroup(artIdxBoot);
  /* Glove abilities. */
  if (art.tval === TV.GLOVES) copyGroup(artIdxGlove);
  /* Headgear abilities. */
  if (art.tval === TV.HELM || art.tval === TV.CROWN) copyGroup(artIdxHeadgear);
  /* Shield abilities. */
  if (art.tval === TV.SHIELD) copyGroup(artIdxShield);
  /* Cloak abilities. */
  if (art.tval === TV.CLOAK) copyGroup(artIdxCloak);
  /* Armor abilities. */
  if (
    art.tval === TV.SOFT_ARMOR ||
    art.tval === TV.HARD_ARMOR ||
    art.tval === TV.DRAG_ARMOR
  ) {
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
  if (
    art.tval === TV.DIGGING ||
    art.tval === TV.HAFTED ||
    art.tval === TV.POLEARM ||
    art.tval === TV.SWORD
  ) {
    if (rng.randint0(aMax) < data.artProbs[ART_IDX.MELEE_DICE_SUPER]!) {
      art.dd += 3 + rng.randint0(4);
    } else if (rng.randint0(aMax) < data.artProbs[ART_IDX.MELEE_BLOWS_SUPER]!) {
      art.modifiers[OBJ_MOD.BLOWS] = INHIBIT_BLOWS - 1;
    }
  }

  /* Bows - max might or shots. */
  if (art.tval === TV.BOW) {
    if (rng.randint0(aMax) < data.artProbs[ART_IDX.BOW_SHOTS_SUPER]!) {
      art.modifiers[OBJ_MOD.SHOTS] = INHIBIT_SHOTS - 1;
    } else if (rng.randint0(aMax) < data.artProbs[ART_IDX.BOW_MIGHT_SUPER]!) {
      art.modifiers[OBJ_MOD.MIGHT] = INHIBIT_MIGHT - 1;
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
  }

  /* Big AC bonus. */
  if (
    art.tval === TV.DIGGING ||
    art.tval === TV.HAFTED ||
    art.tval === TV.POLEARM ||
    art.tval === TV.SWORD
  ) {
    if (rng.randint0(aMax) < data.artProbs[ART_IDX.MELEE_AC_SUPER]!) {
      art.toA += 19 + rng.randint1(11);
      if (rng.oneIn(2)) art.toA += rng.randint1(10);
      if (rng.oneIn(6)) art.toA += rng.randint1(20);
    }
  } else if (
    art.tval !== TV.BOW &&
    rng.randint0(aMax) < data.artProbs[ART_IDX.GEN_AC_SUPER]!
  ) {
    art.toA += 19 + rng.randint1(11);
    if (rng.oneIn(2)) art.toA += rng.randint1(10);
    if (rng.oneIn(6)) art.toA += rng.randint1(20);
  }

  /* Aggravation. C short-circuits the && so target_power is only tested when
   * the randint0 roll succeeds. */
  if (
    art.tval === TV.BOW ||
    art.tval === TV.DIGGING ||
    art.tval === TV.HAFTED ||
    art.tval === TV.POLEARM ||
    art.tval === TV.SWORD
  ) {
    if (
      rng.randint0(aMax) < data.artProbs[ART_IDX.WEAPON_AGGR]! &&
      targetPower > AGGR_POWER
    ) {
      art.flags.on(OF.AGGRAVATE);
    }
  } else {
    if (
      rng.randint0(aMax) < data.artProbs[ART_IDX.NONWEAPON_AGGR]! &&
      targetPower > AGGR_POWER
    ) {
      art.flags.on(OF.AGGRAVATE);
    }
  }
}

/* ------------------------------------------------------------------ */
/* add_flag (obj-randart.c L1721)                                      */
/* ------------------------------------------------------------------ */

/** add_flag (obj-randart.c L1721): add a flag; returns true when it changed. */
export function addFlag(art: Artifact, flag: number): boolean {
  if (art.flags.has(flag)) return false;
  art.flags.on(flag);
  return true;
}

/* ------------------------------------------------------------------ */
/* add_resist (obj-randart.c L1736)                                    */
/* ------------------------------------------------------------------ */

/** add_resist (obj-randart.c L1736): add a resist; true when it changed. */
export function addResist(art: Artifact, element: number): boolean {
  const info = art.elInfo[element] as ElementInfo;
  if (info.resLevel > 0) return false;
  info.resLevel = 1;
  return true;
}

/* ------------------------------------------------------------------ */
/* add_immunity (obj-randart.c L1750)                                  */
/* ------------------------------------------------------------------ */

/** add_immunity (obj-randart.c L1750): grant immunity to a random base element. */
export function addImmunity(art: Artifact, rng: Rng): void {
  const r = rng.randint0(4);
  (art.elInfo[r] as ElementInfo).resLevel = 3;
}

/* ------------------------------------------------------------------ */
/* add_mod (obj-randart.c L1761)                                       */
/* ------------------------------------------------------------------ */

/**
 * add_mod (obj-randart.c L1761): add, increase (or worsen a negative) a
 * modifier, favouring a few large bonuses over many small ones. Blows, might
 * and moves are "powerful" and applied sparingly. Returns true when changed.
 */
export function addMod(art: Artifact, mod: number, rng: Rng): boolean {
  const powerful =
    mod === OBJ_MOD.BLOWS || mod === OBJ_MOD.MIGHT || mod === OBJ_MOD.MOVES;
  let success = false;

  if (art.modifiers[mod]! < 0) {
    /* Negative mods just get a bit worse. */
    if (rng.oneIn(2)) {
      art.modifiers[mod]!--;
      success = true;
    }
  } else if (powerful) {
    /* Powerful mods need to be applied sparingly. */
    if (art.modifiers[mod] === 0) {
      art.modifiers[mod] = rng.randint1(2);
      success = true;
    } else if (rng.oneIn(20 * art.modifiers[mod]!)) {
      art.modifiers[mod]!++;
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
      success = true;
    } else {
      art.modifiers[mod]! += rng.randint1(2);
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
export function addStat(art: Artifact, rng: Rng): void {
  addMod(art, OBJ_MOD.STR + rng.randint0(STAT_MAX), rng);
}

/* ------------------------------------------------------------------ */
/* add_sustain (obj-randart.c L1831)                                   */
/* ------------------------------------------------------------------ */

/** add_sustain (obj-randart.c L1831): add a random sustain, if any are free. */
export function addSustain(art: Artifact, rng: Rng): void {
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
    if (r === 0) success = addFlag(art, OF.SUST_STR);
    else if (r === 1) success = addFlag(art, OF.SUST_INT);
    else if (r === 2) success = addFlag(art, OF.SUST_WIS);
    else if (r === 3) success = addFlag(art, OF.SUST_DEX);
    else if (r === 4) success = addFlag(art, OF.SUST_CON);
  }
}

/* ------------------------------------------------------------------ */
/* add_low_resist (obj-randart.c L1854)                                */
/* ------------------------------------------------------------------ */

/** add_low_resist (obj-randart.c L1854): add a random unheld low resist. */
export function addLowResist(art: Artifact, rng: Rng): void {
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
      addResist(art, i);
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
    if (i === 0) success = addResist(art, ELEM.POIS);
    else if (i === 1) success = addFlag(art, OF.PROT_FEAR);
    else if (i === 2) success = addResist(art, ELEM.LIGHT);
    else if (i === 3) success = addResist(art, ELEM.DARK);
    else if (i === 4) success = addFlag(art, OF.PROT_BLIND);
    else if (i === 5) success = addFlag(art, OF.PROT_CONF);
    else if (i === 6) success = addResist(art, ELEM.SOUND);
    else if (i === 7) success = addResist(art, ELEM.SHARD);
    else if (i === 8) success = addResist(art, ELEM.NEXUS);
    else if (i === 9) success = addResist(art, ELEM.NETHER);
    else if (i === 10) success = addResist(art, ELEM.CHAOS);
    else if (i === 11) success = addResist(art, ELEM.DISEN);
    else if (i === 12) success = addFlag(art, OF.PROT_STUN);

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
    brandIdx = pick;
    break;
  }

  /* Frequently add the corresponding resist. randint0(4) only rolls when a
   * brand was actually added. */
  if (brandIdx && rng.randint0(4)) {
    const brand = reg.brands[brandIdx]!;
    for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
      if (
        brand.name === BASE_ELEMENT_PROJ_NAMES[i] &&
        (art.elInfo[i] as ElementInfo).resLevel <= 0
      ) {
        addResist(art, i);
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
export function addDamageDice(art: Artifact, rng: Rng): void {
  art.dd += rng.randint1(2);
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
    if (!rng.oneIn(6)) return;
  } else if (art.toH > HIGH_TO_HIT) {
    if (!rng.oneIn(2)) return;
  }
  art.toH += fixed + rng.randint0(random);
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
    if (!rng.oneIn(6)) return;
  } else if (art.toH > HIGH_TO_DAM) {
    if (!rng.oneIn(2)) return;
  }
  art.toD += fixed + rng.randint0(random);
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
    if (!rng.oneIn(6)) return;
  } else if (art.toH > HIGH_TO_AC) {
    if (!rng.oneIn(2)) return;
  }
  art.toA += fixed + rng.randint0(random);
}

/* ------------------------------------------------------------------ */
/* add_weight_mod (obj-randart.c L2068)                                */
/* ------------------------------------------------------------------ */

/** add_weight_mod (obj-randart.c L2068): lower the artifact's weight by 10%. */
export function addWeightMod(art: Artifact): void {
  art.weight = Math.trunc((art.weight * 9) / 10);
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

  switch (r) {
    case ART_IDX.BOW_SHOTS:
    case ART_IDX.NONWEAPON_SHOTS:
      addMod(art, OBJ_MOD.SHOTS, rng);
      break;

    case ART_IDX.BOW_MIGHT:
      addMod(art, OBJ_MOD.MIGHT, rng);
      break;

    case ART_IDX.WEAPON_HIT:
    case ART_IDX.NONWEAPON_HIT:
      addToHit(art, 1, 2 * data.hitIncrement, rng);
      break;

    case ART_IDX.WEAPON_DAM:
    case ART_IDX.NONWEAPON_DAM:
      addToDam(art, 1, 2 * data.damIncrement, rng);
      break;

    case ART_IDX.NONWEAPON_HIT_DAM:
    case ART_IDX.GLOVE_HIT_DAM:
      addToHit(art, 1, 2 * data.hitIncrement, rng);
      addToDam(art, 1, 2 * data.damIncrement, rng);
      break;

    case ART_IDX.WEAPON_AGGR:
    case ART_IDX.NONWEAPON_AGGR:
      if (targetPower > AGGR_POWER) addFlag(art, OF.AGGRAVATE);
      break;

    case ART_IDX.MELEE_BLESS:
      addFlag(art, OF.BLESSED);
      break;

    case ART_IDX.BOW_BRAND:
    case ART_IDX.MELEE_BRAND:
    case ART_IDX.NONWEAPON_BRAND:
      addBrand(reg, art, rng);
      break;

    case ART_IDX.BOW_SLAY:
    case ART_IDX.MELEE_SLAY:
    case ART_IDX.NONWEAPON_SLAY:
      addSlay(reg, art, rng);
      break;

    case ART_IDX.MELEE_SINV:
    case ART_IDX.HELM_SINV:
    case ART_IDX.GEN_SINV:
      addFlag(art, OF.SEE_INVIS);
      break;

    case ART_IDX.MELEE_BLOWS:
    case ART_IDX.NONWEAPON_BLOWS:
      addMod(art, OBJ_MOD.BLOWS, rng);
      break;

    case ART_IDX.MELEE_AC:
    case ART_IDX.BOOT_AC:
    case ART_IDX.GLOVE_AC:
    case ART_IDX.HELM_AC:
    case ART_IDX.SHIELD_AC:
    case ART_IDX.CLOAK_AC:
    case ART_IDX.ARMOR_AC:
    case ART_IDX.GEN_AC:
      addToAC(art, 1, 2 * data.acIncrement, rng);
      break;

    case ART_IDX.MELEE_DICE:
      addDamageDice(art, rng);
      break;

    case ART_IDX.MELEE_WEIGHT:
    case ART_IDX.ALLARMOR_WEIGHT:
      addWeightMod(art);
      break;

    case ART_IDX.MELEE_TUNN:
    case ART_IDX.GEN_TUNN:
      addMod(art, OBJ_MOD.TUNNEL, rng);
      break;

    case ART_IDX.BOOT_FEATHER:
    case ART_IDX.GEN_FEATHER:
      addFlag(art, OF.FEATHER);
      break;

    case ART_IDX.BOOT_STEALTH:
    case ART_IDX.CLOAK_STEALTH:
    case ART_IDX.ARMOR_STEALTH:
    case ART_IDX.GEN_STEALTH:
      addMod(art, OBJ_MOD.STEALTH, rng);
      break;

    case ART_IDX.BOOT_SPEED:
    case ART_IDX.GEN_SPEED:
      addMod(art, OBJ_MOD.SPEED, rng);
      break;

    case ART_IDX.GLOVE_FA:
    case ART_IDX.GEN_FA:
      addFlag(art, OF.FREE_ACT);
      break;

    case ART_IDX.GLOVE_DEX:
      addMod(art, OBJ_MOD.DEX, rng);
      break;

    case ART_IDX.HELM_RBLIND:
    case ART_IDX.GEN_RBLIND:
      addFlag(art, OF.PROT_BLIND);
      break;

    case ART_IDX.HELM_ESP:
    case ART_IDX.GEN_ESP:
      addFlag(art, OF.TELEPATHY);
      break;

    case ART_IDX.HELM_WIS:
      addMod(art, OBJ_MOD.WIS, rng);
      break;

    case ART_IDX.HELM_INT:
      addMod(art, OBJ_MOD.INT, rng);
      break;

    case ART_IDX.SHIELD_LRES:
    case ART_IDX.ARMOR_LRES:
    case ART_IDX.GEN_LRES:
      addLowResist(art, rng);
      break;

    case ART_IDX.ARMOR_HLIFE:
    case ART_IDX.GEN_HLIFE:
      addFlag(art, OF.HOLD_LIFE);
      break;

    case ART_IDX.ARMOR_CON:
      addMod(art, OBJ_MOD.CON, rng);
      break;

    case ART_IDX.ARMOR_ALLRES:
      addResist(art, ELEM.ACID);
      addResist(art, ELEM.ELEC);
      addResist(art, ELEM.FIRE);
      addResist(art, ELEM.COLD);
      break;

    case ART_IDX.ARMOR_HRES:
      addHighResist(art, data, rng);
      break;

    case ART_IDX.GEN_STAT:
      addStat(art, rng);
      break;

    case ART_IDX.GEN_SUST:
      addSustain(art, rng);
      break;

    case ART_IDX.GEN_SEARCH:
      addMod(art, OBJ_MOD.SEARCH, rng);
      break;

    case ART_IDX.GEN_INFRA:
      addMod(art, OBJ_MOD.INFRA, rng);
      break;

    case ART_IDX.GEN_IMMUNE:
      addImmunity(art, rng);
      break;

    case ART_IDX.GEN_LIGHT:
      if (art.tval !== TV.LIGHT) art.modifiers[OBJ_MOD.LIGHT] = 1;
      break;

    case ART_IDX.GEN_SDIG:
      addFlag(art, OF.SLOW_DIGEST);
      break;

    case ART_IDX.GEN_REGEN:
      addFlag(art, OF.REGEN);
      break;

    case ART_IDX.GEN_RPOIS:
      addResist(art, ELEM.POIS);
      break;

    case ART_IDX.GEN_RFEAR:
      addFlag(art, OF.PROT_FEAR);
      break;

    case ART_IDX.GEN_RLIGHT:
      addResist(art, ELEM.LIGHT);
      break;

    case ART_IDX.GEN_RDARK:
      addResist(art, ELEM.DARK);
      break;

    case ART_IDX.GEN_RCONF:
      addFlag(art, OF.PROT_CONF);
      break;

    case ART_IDX.GEN_RSOUND:
      addResist(art, ELEM.SOUND);
      break;

    case ART_IDX.GEN_RSHARD:
      addResist(art, ELEM.SHARD);
      break;

    case ART_IDX.GEN_RNEXUS:
      addResist(art, ELEM.NEXUS);
      break;

    case ART_IDX.GEN_RNETHER:
      addResist(art, ELEM.NETHER);
      break;

    case ART_IDX.GEN_RCHAOS:
      addResist(art, ELEM.CHAOS);
      break;

    case ART_IDX.GEN_RDISEN:
      addResist(art, ELEM.DISEN);
      break;

    case ART_IDX.GEN_PSTUN:
      addFlag(art, OF.PROT_STUN);
      break;

    case ART_IDX.BOOT_TRAP_IMM:
    case ART_IDX.GEN_TRAP_IMM:
      addFlag(art, OF.TRAP_IMMUNE);
      break;

    case ART_IDX.GEN_DAM_RED:
      addMod(art, OBJ_MOD.DAM_RED, rng);
      break;

    case ART_IDX.GEN_MOVES:
    case ART_IDX.BOOT_MOVES:
      addMod(art, OBJ_MOD.MOVES, rng);
      break;

    case ART_IDX.GEN_ACTIV:
      if (!art.activation && !kind?.activation) {
        addActivation(reg, art, targetPower, data.maxPower, rng);
      }
      break;

    default:
      break;
  }
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

  /* Without the effects-domain summarizer we cannot prove redundancy; keep the
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
      switch (p.kind) {
        case EFPROP.BRAND: {
          let maxmult = 1;
          for (let i = 1; i < reg.brands.length; i++) {
            if (!art.brands?.[i]) continue;
            if (reg.brands[i]!.resistFlag !== reg.brands[p.idx]!.resistFlag) {
              continue;
            }
            maxmult = Math.max(reg.brands[i]!.multiplier, maxmult);
          }
          if (maxmult < reg.brands[p.idx]!.multiplier) redundant = false;
          break;
        }
        case EFPROP.SLAY: {
          let maxmult = 1;
          for (let i = 1; i < reg.slays.length; i++) {
            if (!art.slays?.[i]) continue;
            if (!sameMonstersSlain(reg, i, p.idx)) continue;
            maxmult = Math.max(reg.slays[i]!.multiplier, maxmult);
          }
          if (maxmult < reg.slays[p.idx]!.multiplier) redundant = false;
          break;
        }
        case EFPROP.RESIST:
        case EFPROP.CONFLICT_RESIST:
        case EFPROP.CONFLICT_VULN: {
          const res = art.elInfo[p.idx]?.resLevel ?? 0;
          if (res >= p.reslevelMin && res <= p.reslevelMax) redundant = false;
          break;
        }
        case EFPROP.OBJECT_FLAG:
          /* Does more than the flag; keep it (also screens HERO/SHERO). */
          redundant = false;
          break;
        case EFPROP.OBJECT_FLAG_EXACT:
        case EFPROP.CURE_FLAG:
        case EFPROP.CONFLICT_FLAG:
          if (!art.flags.has(p.idx)) redundant = false;
          break;
        default:
          /* Something unexpected; assume the effect is useful. */
          redundant = false;
          break;
      }
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
    addFlag(art, OF.BLESSED);
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

  if (rng.oneIn(7)) art.flags.on(OF.AGGRAVATE);
  if (rng.oneIn(4)) art.flags.on(OF.DRAIN_EXP);
  if (rng.oneIn(7)) art.flags.on(OF.NO_TELEPORT);

  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    if (art.modifiers[i]! > 0) {
      if (rng.oneIn(2) && i !== OBJ_MOD.MIGHT) {
        art.modifiers[i] = -art.modifiers[i]!;
      }
    }
  }

  if (art.toA > 0 && rng.oneIn(2)) art.toA = -art.toA;
  if (art.toH > 0 && rng.oneIn(2)) art.toH = -art.toH;
  if (art.toD > 0 && rng.oneIn(4)) art.toD = -art.toD;

  while (num) {
    addCurse(reg, art, level, rng, timedFoil);
    num--;
  }
}
