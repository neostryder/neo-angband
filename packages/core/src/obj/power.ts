/**
 * Object power evaluation, ported from the power half of
 * reference/src/obj-power.c (Angband 4.2.6): object_power and its ~15 helper
 * ratings. This is the engine that drives variable-power valuation
 * (object_value_real) and randart balance.
 *
 * Faithful notes / deferrals (ledgered in parity/ledger/obj-power.yaml):
 * - The upstream `verbose`/`log_file` logging IS ported (PORT_TODO 5.5). All 59
 *   `log_obj` sites narrate into obj/randart-log.ts's sink, which is a
 *   module-level static exactly as upstream's `object_log` is - NULL for the
 *   whole game except inside do_randart, so objectPower on the item-pricing
 *   path pays nothing for it. object_power's signature stays (reg, obj): the
 *   `log_file` argument is what SETS that static in the C, and there is only
 *   ever one log. `verbose` is likewise not a parameter here - it gates four
 *   lines in slay_power, every randart evaluation passes it, and nothing else
 *   calls slayPower with a log open, so an open log is the flag.
 *   This note used to say the logging was dropped "because it never affects
 *   the returned power". That is true, and it was never the question: the
 *   the disposition is to pursue parity.
 * - Every `wield_slot(obj) == slot_by_name(player, "shooting")` test in
 *   upstream is exactly `obj->tval == TV_BOW` for the standard body (only a bow
 *   maps to the shooting slot), so it is ported as tvalIsLauncher(obj.tval).
 *   A mod that adds another tval to the shooting slot would diverge; that is a
 *   moddable-body concern, out of scope for the 4.2.6 baseline.
 * - object_flags(obj, flags) is just a copy of obj->flags (obj-util.c L353), so
 *   flags_power iterates obj.flags directly.
 * - object_power accepts a normalized PowerObject so both a live GameObject and
 *   a bare curse template (curse->obj, which has no kind/ac/dd/ds/brands/slays)
 *   can be valued; a curse template is adapted by cursePowerObject.
 */

import { randartLog, randartLogOpen, randartLogf } from "./randart-log.js";
import type { FlagSet } from "../bitflag.js";
import { KF, OBJ_MOD, OF, TV } from "../generated/index.js";
import { addGuardi, INT_MAX, INT_MIN, subGuardi } from "../guard.js";
import type { ObjRegistry } from "./bind.js";
import type { CurseData } from "./object.js";
import {
  applyCurseAttributes,
  objectWeightOne,
  tvalIsAmmo,
  tvalIsJewelry,
  tvalIsLauncher,
  tvalIsMeleeWeapon,
} from "./object.js";
import type { CurseObject, ElementInfo, ObjectProperty } from "./types.js";
import { EL_INFO_IGNORE, OBJ_MOD_MAX, OBJ_PROPERTY, OFT } from "./types.js";

/* ------------------------------------------------------------------ */
/* Power algorithm constants (obj-power.h)                              */
/* ------------------------------------------------------------------ */

const NONWEAP_DAMAGE = 15;
const WEAP_DAMAGE = 12;
const BASE_JEWELRY_POWER = 4;
const BASE_ARMOUR_POWER = 1;
const DAMAGE_POWER = 5;
const TO_HIT_POWER = 3;
const BASE_AC_POWER = 2;
const TO_AC_POWER = 2;
const MAX_BLOWS = 5;
const WGT_POWER_NUM_NOBASEAC = 1;
const WGT_POWER_DEN_NOBASEAC = 50;
const WGT_POWER_NUM_THROW = 15;
const WGT_POWER_DEN_THROW = 12;

export const INHIBIT_POWER = 20000;
const INHIBIT_BLOWS = 3;
const INHIBIT_MIGHT = 4;
const INHIBIT_SHOTS = 21;
const HIGH_TO_AC = 26;
const VERYHIGH_TO_AC = 36;
const INHIBIT_AC = 56;
/* eslint-disable-next-line @typescript-eslint/no-unused-vars -- obj-power.c's constant block, transcribed whole */
const AMMO_RESCALER = 20;

/* ------------------------------------------------------------------ */
/* Static power tables (obj-power.c)                                    */
/* ------------------------------------------------------------------ */

/** Archery constants, indexed as (tval - TV_SHOT) for ammo, sval/10 or type. */
const ARCHERY = [
  { ammoDam: 10, launchDam: 9, launchMult: 4 }, // shot
  { ammoDam: 12, launchDam: 9, launchMult: 5 }, // arrow
  { ammoDam: 14, launchDam: 9, launchMult: 7 }, // bolt
] as const;

/** Flag-set weightings, keyed by OFT_ subtype. */
interface FlagSetWeight {
  type: number;
  factor: number;
  bonus: number;
  size: number;
  /** flag_sets[].desc - the name the power log prints (obj-power.c L71-75). */
  desc: string;
}
const FLAG_SETS: readonly FlagSetWeight[] = [
  { type: OFT.SUST, factor: 1, bonus: 10, size: 5, desc: "sustains" },
  { type: OFT.PROT, factor: 3, bonus: 15, size: 4, desc: "protections" },
  { type: OFT.MISC, factor: 1, bonus: 25, size: 8, desc: "misc abilities" },
];

const T_LRES = 0;
const T_HRES = 1;

/** Element-set weightings (immunities / low resists / high resists). */
interface ElementSetWeight {
  type: number;
  resLevel: number;
  factor: number;
  bonus: number;
  size: number;
  /** element_sets[].desc (obj-power.c L94-98). */
  desc: string;
}
const ELEMENT_SETS: readonly ElementSetWeight[] = [
  { type: T_LRES, resLevel: 3, factor: 6, bonus: INHIBIT_POWER, size: 4, desc: "immunities" },
  { type: T_LRES, resLevel: 1, factor: 1, bonus: 10, size: 4, desc: "low resists" },
  { type: T_HRES, resLevel: 1, factor: 2, bonus: 10, size: 9, desc: "high resists" },
];

/**
 * Per-element power data, indexed by ELEM value (acid=0 .. disenchantment=12).
 */
interface ElementPower {
  /**
   * el_powers[].name (obj-power.c L104, L111-123). The power log's own
   * spelling, which is NOT the projection name - "electricity" and
   * "disenchantment" are written out here where list-elements.h has ELEC and
   * DISEN. Transcribed from the C table, not derived from the enum.
   */
  name: string;
  type: number;
  ignorePower: number;
  vulnPower: number;
  resPower: number;
  imPower: number;
}
const EL_POWERS: readonly ElementPower[] = [
  { name: "acid", type: T_LRES, ignorePower: 3, vulnPower: -6, resPower: 5, imPower: 38 },
  { name: "electricity", type: T_LRES, ignorePower: 1, vulnPower: -6, resPower: 6, imPower: 35 },
  { name: "fire", type: T_LRES, ignorePower: 3, vulnPower: -6, resPower: 6, imPower: 40 },
  { name: "cold", type: T_LRES, ignorePower: 1, vulnPower: -6, resPower: 6, imPower: 37 },
  { name: "poison", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 28, imPower: 0 },
  { name: "light", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 6, imPower: 0 },
  { name: "dark", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 16, imPower: 0 },
  { name: "sound", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 14, imPower: 0 },
  { name: "shards", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 8, imPower: 0 },
  { name: "nexus", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 15, imPower: 0 },
  { name: "nether", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 20, imPower: 0 },
  { name: "chaos", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 20, imPower: 0 },
  { name: "disenchantment", type: T_HRES, ignorePower: 0, vulnPower: 0, resPower: 20, imPower: 0 },
];

/** Boost ratings for combinations of ability bonuses (index bonus/10). */
const ABILITY_POWER: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 2, 4, 6, 8, 12, 16, 20, 24, 30, 36, 42, 48, 56, 64, 74,
  84, 96, 110,
];

/* ------------------------------------------------------------------ */
/* Normalized power input                                               */
/* ------------------------------------------------------------------ */

/**
 * The fixed set of fields object_power reads. A live GameObject satisfies this
 * structurally; a bare curse template is adapted via cursePowerObject.
 */
export interface PowerObject {
  tval: number;
  toH: number;
  toD: number;
  toA: number;
  ac: number;
  dd: number;
  ds: number;
  weight: number;
  pval: number;
  modifiers: number[];
  brands: boolean[] | null;
  slays: boolean[] | null;
  flags: FlagSet;
  elInfo: ElementInfo[];
  curses: CurseData[] | null;
  activation: { power: number } | null;
  kind: { power: number; kindFlags: FlagSet } | null;
  ego: unknown;
}

/**
 * Adapt a curse template (curse->obj) to a PowerObject. Curse templates have
 * kind == curse_object_kind (tval "none", power 0) and never carry
 * ac/dd/ds/brands/slays/activation/ego, so those default to zero/null/empty.
 */
function cursePowerObject(c: CurseObject): PowerObject {
  return {
    tval: 0,
    toH: c.toH,
    toD: c.toD,
    toA: c.toA,
    ac: 0,
    dd: 0,
    ds: 0,
    weight: c.weight,
    pval: 0,
    modifiers: c.modifiers,
    brands: null,
    slays: null,
    flags: c.flags,
    elInfo: c.elInfo,
    curses: null,
    activation: null,
    kind: null,
    ego: null,
  };
}

/** A power-clone deep enough for curse_power's pass-2 merge and re-valuation. */
function powerClone(obj: PowerObject): PowerObject {
  return {
    ...obj,
    modifiers: obj.modifiers.slice(),
    elInfo: obj.elInfo.map((e) => ({ resLevel: e.resLevel, flags: e.flags })),
    flags: obj.flags.clone(),
    brands: obj.brands ? obj.brands.slice() : null,
    slays: obj.slays ? obj.slays.slice() : null,
    curses: obj.curses
      ? obj.curses.map((c) => ({ power: c.power, timeout: c.timeout }))
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Property lookup (obj-properties.c L24)                               */
/* ------------------------------------------------------------------ */

/**
 * lookup_obj_property (obj-properties.c:24) over a bare property table: the
 * property whose type and stored index match, PLUS upstream's "special case -
 * stats count as mods" (:36), which is the half that is easy to leave out and
 * costs a NAME when you do.
 *
 * THE ONE IMPLEMENTATION. player/shape-lore.ts had a second copy that omitted
 * the special case, so every shape's stat line rendered as "Adds -3 to ." with
 * an empty name - a screen-visible blank that the copy with the special case
 * could never have produced. Anything needing this lookup calls here.
 */
export function lookupObjPropertyIn(
  properties: readonly (ObjectProperty | null)[],
  type: number,
  index: number,
): ObjectProperty | null {
  for (const prop of properties) {
    if (!prop) continue;
    if (prop.type === type && prop.propIndex === index) return prop;
    /* Special case - stats count as mods (obj-properties.c:36). */
    if (
      type === OBJ_PROPERTY.MOD &&
      prop.type === OBJ_PROPERTY.STAT &&
      prop.propIndex === index
    ) {
      return prop;
    }
  }
  return null;
}

/** lookup_obj_property against an ObjRegistry's table. */
export function lookupObjProperty(
  reg: ObjRegistry,
  type: number,
  index: number,
): ObjectProperty | null {
  return lookupObjPropertyIn(reg.properties, type, index);
}

/* ------------------------------------------------------------------ */
/* Power helper ratings (obj-power.c)                                   */
/* ------------------------------------------------------------------ */

function bowMultiplier(obj: PowerObject): number {
  if (!tvalIsLauncher(obj.tval)) return 1;
  const mult = obj.pval;
  randartLogf(() => `Base mult for this weapon is ${mult}\n`);
  return mult;
}

function toDamagePower(obj: PowerObject): number {
  let p = Math.trunc((obj.toD * DAMAGE_POWER) / 2);
  if (p) randartLogf(() => `${p} power from to_dam\n`);
  /* Add a second lot of damage power for non-weapons. */
  if (
    !tvalIsLauncher(obj.tval) &&
    !tvalIsMeleeWeapon(obj.tval) &&
    !tvalIsAmmo(obj.tval)
  ) {
    const q = obj.toD * DAMAGE_POWER;
    p += q;
    if (q) randartLogf(() => `Add ${q} from non-weapon to_dam, total ${p}\n`);
  }
  return p;
}

function damageDicePower(obj: PowerObject): number {
  let dice = 0;
  if (tvalIsMeleeWeapon(obj.tval) || tvalIsAmmo(obj.tval)) {
    dice = Math.trunc((obj.dd * (obj.ds + 1) * DAMAGE_POWER) / 4);
    /* No newline, deliberately: object_power continues the line with
     * "total is %d" once damage_dice_power returns (obj-power.c L1017). */
    randartLogf(() => `Add ${dice} power for damage dice, `);
  } else if (!tvalIsLauncher(obj.tval)) {
    /* Power boost for nonweapons with combat flags. */
    if (
      obj.brands ||
      obj.slays ||
      (obj.modifiers[OBJ_MOD.BLOWS] ?? 0) > 0 ||
      (obj.modifiers[OBJ_MOD.SHOTS] ?? 0) > 0 ||
      (obj.modifiers[OBJ_MOD.MIGHT] ?? 0) > 0
    ) {
      dice = WEAP_DAMAGE * DAMAGE_POWER;
      randartLogf(() => `Add ${dice} power for non-weapon combat bonuses, `);
    }
  }
  return dice;
}

function ammoDamagePower(obj: PowerObject, p: number): number {
  if (!tvalIsLauncher(obj.tval)) return 0;
  let launcher = -1;
  const kf = obj.kind?.kindFlags;
  if (kf?.has(KF.SHOOTS_SHOTS)) launcher = 0;
  else if (kf?.has(KF.SHOOTS_ARROWS)) launcher = 1;
  else if (kf?.has(KF.SHOOTS_BOLTS)) launcher = 2;
  if (launcher === -1) return 0;
  const q = Math.trunc((ARCHERY[launcher]!.ammoDam * DAMAGE_POWER) / 2);
  /* Logs p + q, the running total, not the return value - which is why this
   * function takes p at all (obj-power.c L239). */
  randartLogf(() => `Adding ${q} power from ammo, total is ${p + q}\n`);
  return q;
}

function launcherAmmoDamagePower(obj: PowerObject, p: number): number {
  if (!tvalIsAmmo(obj.tval)) return p;
  let ammoType = 0;
  if (obj.tval === TV.ARROW) ammoType = 1;
  if (obj.tval === TV.BOLT) ammoType = 2;
  const a = ARCHERY[ammoType]!;
  if (obj.ego) p += Math.trunc((a.launchDam * DAMAGE_POWER) / 2);
  p = Math.trunc((p * a.launchMult) / (2 * MAX_BLOWS));
  randartLogf(() => `After multiplying ammo and rescaling, power is ${p}\n`);
  return p;
}

function extraBlowsPower(obj: PowerObject, p: number): number {
  const blows = obj.modifiers[OBJ_MOD.BLOWS] ?? 0;
  if (blows === 0) return p;
  const before = p;
  if (blows >= INHIBIT_BLOWS) {
    randartLog(`INHIBITING - too many extra blows - quitting\n`);
    return p + INHIBIT_POWER;
  }
  p = Math.trunc((p * (MAX_BLOWS + blows)) / MAX_BLOWS);
  /* Add boost for assumed off-weapon damage. */
  p += Math.trunc((NONWEAP_DAMAGE * blows * DAMAGE_POWER) / 2);
  randartLogf(() => `Add ${p - before} power for extra blows, total is ${p}\n`);
  return p;
}

function extraShotsPower(obj: PowerObject, p: number): number {
  const shots = obj.modifiers[OBJ_MOD.SHOTS] ?? 0;
  if (shots === 0) return p;
  if (shots >= INHIBIT_SHOTS) {
    randartLog(`INHIBITING - too many extra shots - quitting\n`);
    return p + INHIBIT_POWER;
  }
  if (shots > 0) {
    p *= 10 + shots;
    p = Math.trunc(p / 10);
    /* "%d%%" is a literal percent sign in the C. */
    randartLogf(
      () => `Adding ${10 * shots}% power for extra shots, total is ${p}\n`,
    );
  }
  return p;
}

function extraMightPower(obj: PowerObject, p: number, mult: number): number {
  const might = obj.modifiers[OBJ_MOD.MIGHT] ?? 0;
  if (might >= INHIBIT_MIGHT) {
    randartLog(`INHIBITING - too much extra might - quitting\n`);
    return p + INHIBIT_POWER;
  }
  mult += might;
  randartLogf(() => `Mult after extra might is ${mult}\n`);
  p *= mult;
  randartLogf(() => `After multiplying power for might, total is ${p}\n`);
  return p;
}

function slayPower(
  reg: ObjRegistry,
  obj: PowerObject,
  p: number,
  dicePwr: number,
): number {
  let numBrands = 0;
  let numSlays = 0;
  let numKills = 0;
  let bestPower = 1;

  if (obj.brands) {
    for (let i = 1; i < reg.brands.length; i++) {
      if (obj.brands[i]) {
        numBrands++;
        const bp = reg.brands[i]!.power;
        if (bp > bestPower) bestPower = bp;
      }
    }
  }
  if (obj.slays) {
    for (let i = 1; i < reg.slays.length; i++) {
      if (obj.slays[i]) {
        const s = reg.slays[i]!;
        if (s.multiplier <= 3) numSlays++;
        else numKills++;
        if (s.power > bestPower) bestPower = s.power;
      }
    }
  }

  if (numSlays + numBrands + numKills === 0) return p;

  /* The `verbose` half (obj-power.c L370-393). Upstream threads a bool from
   * object_power's caller purely to gate these four lines; every randart
   * evaluation passes it, and nothing else in the port calls slayPower with a
   * log open, so an open log IS the verbose flag here. */
  if (randartLogOpen()) {
    randartLog(`Slay and brands: `);
    if (obj.brands) {
      for (let i = 1; i < reg.brands.length; i++) {
        if (obj.brands[i]) {
          const b = reg.brands[i]!;
          randartLog(`${b.name}x${b.multiplier} `);
        }
      }
    }
    if (obj.slays) {
      for (let i = 1; i < reg.slays.length; i++) {
        if (obj.slays[i]) {
          const sl = reg.slays[i]!;
          randartLog(`${sl.name}x${sl.multiplier} `);
        }
      }
    }
    randartLog(`\nbest power is : ${bestPower}\n`);
  }

  let q = Math.trunc((dicePwr * dicePwr * (bestPower - 100)) / 2500);
  p += q;
  randartLogf(() => `Add ${q} for slay power, total is ${p}\n`);

  if (numSlays > 1) {
    q = Math.trunc((numSlays * numSlays * dicePwr) / (DAMAGE_POWER * 5));
    p += q;
    randartLogf(() => `Add ${q} power for multiple slays, total is ${p}\n`);
  }
  if (numBrands > 1) {
    q = Math.trunc((2 * numBrands * numBrands * dicePwr) / (DAMAGE_POWER * 5));
    p += q;
    randartLogf(() => `Add ${q} power for multiple brands, total is ${p}\n`);
  }
  if (numSlays && numBrands) {
    q = Math.trunc((numSlays * numBrands * dicePwr) / (DAMAGE_POWER * 5));
    p += q;
    randartLogf(() => `Add ${q} power for slay and brand, total is ${p}\n`);
  }
  if (numKills > 1) {
    q = Math.trunc((3 * numKills * numKills * dicePwr) / (DAMAGE_POWER * 5));
    p += q;
    randartLogf(() => `Add ${q} power for multiple kills, total is ${p}\n`);
  }
  if (numSlays === 8) {
    p += 10;
    randartLogf(() => `Add 10 power for full set of slays, total is ${p}\n`);
  }
  if (numBrands === 5) {
    p += 20;
    randartLogf(() => `Add 20 power for full set of brands, total is ${p}\n`);
  }
  if (numKills === 3) {
    p += 20;
    randartLogf(() => `Add 20 power for full set of kills, total is ${p}\n`);
  }

  return p;
}

function rescaleBowPower(obj: PowerObject, p: number): number {
  if (tvalIsLauncher(obj.tval)) {
    p = Math.trunc(p / MAX_BLOWS);
    randartLogf(() => `Rescaling bow power, total is ${p}\n`);
  }
  return p;
}

function toHitPower(obj: PowerObject, p: number): number {
  const q = Math.trunc((obj.toH * TO_HIT_POWER) / 2);
  p += q;
  /* Gated on the TOTAL being non-zero, not the addend (obj-power.c L458). */
  if (p) randartLogf(() => `Add ${q} power for to hit, total is ${p}\n`);
  return p;
}

function acPower(reg: ObjRegistry, obj: PowerObject, p: number): number {
  if (obj.ac) {
    const weight = objectWeightOne(obj, reg.curses);
    p += BASE_ARMOUR_POWER;
    let q = Math.trunc((obj.ac * BASE_AC_POWER) / 2);
    randartLogf(() => `Adding ${q} power for base AC value\n`);
    if (weight > 0) {
      let i = Math.trunc((750 * (obj.ac + obj.toA)) / weight);
      /* Avoid overpricing Elven Cloaks. */
      if (i > 450) i = 450;
      q *= i;
      q = Math.trunc(q / 100);
    } else {
      /* Weightless (ethereal) armour items get a fixed boost. */
      q *= 5;
    }
    p += q;
    randartLogf(() => `Add ${q} power for AC per unit weight, now ${p}\n`);
  }
  return p;
}

function toAcPower(obj: PowerObject, p: number): number {
  if (obj.toA === 0) return p;
  let q = Math.trunc((obj.toA * TO_AC_POWER) / 2);
  p += q;
  randartLogf(() => `Add ${q} power for to_ac of ${obj.toA}, total is ${p}\n`);
  if (obj.toA > HIGH_TO_AC) {
    q = (obj.toA - (HIGH_TO_AC - 1)) * TO_AC_POWER;
    p += q;
    randartLogf(() => `Add ${q} power for high to_ac, total is ${p}\n`);
  }
  if (obj.toA > VERYHIGH_TO_AC) {
    q = (obj.toA - (VERYHIGH_TO_AC - 1)) * TO_AC_POWER * 2;
    p += q;
    randartLogf(() => `Add ${q} power for very high to_ac, total is ${p}\n`);
  }
  if (obj.toA >= INHIBIT_AC) {
    p += INHIBIT_POWER;
    randartLog(`INHIBITING: AC bonus too high\n`);
  }
  return p;
}

function jewelryPower(obj: PowerObject, p: number): number {
  if (tvalIsJewelry(obj.tval)) {
    p += BASE_JEWELRY_POWER;
    randartLogf(
      () => `Adding ${BASE_JEWELRY_POWER} power for jewelry, total is ${p}\n`,
    );
  }
  return p;
}

function modifierPower(reg: ObjRegistry, obj: PowerObject, p: number): number {
  let extraStatBonus = 0;

  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    const mod = lookupObjProperty(reg, OBJ_PROPERTY.MOD, i);
    if (!mod) continue;
    const k = obj.modifiers[i] ?? 0;
    extraStatBonus += k * mod.mult;
    if (mod.power) {
      const q = k * mod.power * (mod.typeMult[obj.tval] ?? 1);
      p += q;
      if (q) {
        randartLogf(
          () => `Add ${q} power for ${k} ${mod.name}, total is ${p}\n`,
        );
      }
    }
  }

  if (extraStatBonus > 249) {
    randartLogf(
      () => `Inhibiting - Total ability bonus of ${extraStatBonus} is too high\n`,
    );
    p += INHIBIT_POWER;
  } else if (extraStatBonus > 0) {
    const q = ABILITY_POWER[Math.trunc(extraStatBonus / 10)] ?? 0;
    if (!q) return p;
    p += q;
    randartLogf(
      () =>
        `Add ${q} power for modifier total of ${extraStatBonus}, total is ${p}\n`,
    );
  }
  return p;
}

function flagsPower(reg: ObjRegistry, obj: PowerObject, p: number): number {
  /* object_flags(obj) is a copy of obj.flags (obj-util.c L353). */
  const counts = FLAG_SETS.map(() => 0);

  for (const flagIdx of obj.flags) {
    const flag = lookupObjProperty(reg, OBJ_PROPERTY.FLAG, flagIdx);
    if (!flag) continue;
    if (flag.power) {
      const q = flag.power * (flag.typeMult[obj.tval] ?? 1);
      p += q;
      randartLogf(() => `Add ${q} power for ${flag.name}, total is ${p}\n`);
    }
    for (let j = 0; j < FLAG_SETS.length; j++) {
      if (FLAG_SETS[j]!.type === flag.subtype) counts[j]!++;
    }
  }

  for (let i = 0; i < FLAG_SETS.length; i++) {
    const set = FLAG_SETS[i]!;
    const count = counts[i]!;
    if (count > 1) {
      const q = set.factor * count * count;
      p += q;
      randartLogf(
        () => `Add ${q} power for multiple ${set.desc}, total is ${p}\n`,
      );
    }
    if (count === set.size) {
      const q = set.bonus;
      p += q;
      randartLogf(
        () => `Add ${q} power for full set of ${set.desc}, total is ${p}\n`,
      );
    }
  }
  return p;
}

function elementPower(obj: PowerObject, p: number): number {
  const counts = ELEMENT_SETS.map(() => 0);

  for (let i = 0; i < EL_POWERS.length; i++) {
    const el = EL_POWERS[i]!;
    const ei = obj.elInfo[i] as ElementInfo;

    if ((ei.flags & EL_INFO_IGNORE) !== 0 && el.ignorePower !== 0) {
      const q = el.ignorePower;
      p += q;
      randartLogf(
        () => `Add ${q} power for ignoring ${el.name}, total is ${p}\n`,
      );
    }

    if (ei.resLevel === -1) {
      if (el.vulnPower !== 0) {
        const q = el.vulnPower;
        p += q;
        randartLogf(
          () => `Add ${q} power for vulnerability to ${el.name}, total is ${p}\n`,
        );
      }
    } else if (ei.resLevel === 1) {
      if (el.resPower !== 0) {
        const q = el.resPower;
        p += q;
        randartLogf(
          () => `Add ${q} power for resistance to ${el.name}, total is ${p}\n`,
        );
      }
    } else if (ei.resLevel === 3) {
      if (el.imPower !== 0) {
        const q = el.imPower + el.resPower;
        p += q;
        randartLogf(
          () => `Add ${q} power for immunity to ${el.name}, total is ${p}\n`,
        );
      }
    }

    for (let j = 0; j < ELEMENT_SETS.length; j++) {
      const set = ELEMENT_SETS[j]!;
      if (set.type === el.type && set.resLevel <= ei.resLevel) counts[j]!++;
    }
  }

  for (let i = 0; i < ELEMENT_SETS.length; i++) {
    const set = ELEMENT_SETS[i]!;
    const count = counts[i]!;
    if (count > 1) {
      const q = set.factor * count * count;
      p += q;
      randartLogf(
        () => `Add ${q} power for multiple ${set.desc}, total is ${p}\n`,
      );
    }
    if (count === set.size) {
      const q = set.bonus;
      p += q;
      randartLogf(
        () => `Add ${q} power for full set of ${set.desc}, total is ${p}\n`,
      );
    }
  }
  return p;
}

function effectsPower(obj: PowerObject, p: number): number {
  let q = 0;
  if (obj.activation) q = obj.activation.power;
  else if (obj.kind && obj.kind.power) q = obj.kind.power;
  if (q) {
    p += q;
    randartLogf(() => `Add ${q} power for item activation, total is ${p}\n`);
  }
  return p;
}

/** Scale v by num with the same INT_MIN/INT_MAX clamp as upstream. */
function scaleGuarded(v: number, num: number): number {
  if (v >= 0) return v < Math.trunc(INT_MAX / num) ? v * num : INT_MAX;
  return v > Math.trunc(INT_MIN / num) ? v * num : INT_MIN;
}

function cursePower(reg: ObjRegistry, obj: PowerObject, p: number): number {
  let q = 0;

  if (obj.curses) {
    let weightAffecting = false;

    /* Pass 1: curses that do not affect weight, valued directly. */
    for (let i = 1; i < reg.curses.length; i++) {
      const power = obj.curses[i]?.power ?? 0;
      if (!power) continue;
      const cobj = reg.curses[i]!.obj;
      if (cobj.flags.has(OF.MULTIPLY_WEIGHT)) {
        if (cobj.weight !== 100) {
          weightAffecting = true;
          continue;
        }
      } else if (cobj.weight !== 0) {
        weightAffecting = true;
        continue;
      }

      const cname = reg.curses[i]!.name;
      randartLogf(() => `Calculating ${cname} curse power...\n`);
      let cp = objectPower(reg, cursePowerObject(cobj));
      cp -= Math.trunc(power / 10);
      randartLogf(
        () =>
          `Adjust for strength of curse, ${cp} for ${cname} curse power\n`,
      );
      q += cp;
    }

    /* Pass 2: weight-affecting curses, valued by difference of merged power. */
    if (weightAffecting) {
      let objLocal = powerClone(obj);
      applyCurseAttributes(reg.curses, -1, objLocal);
      objLocal.curses = null;
      const pAllCurse = objectPower(reg, objLocal);
      randartLogf(() => `Power is ${pAllCurse} with all curses applied\n`);

      for (let i = 1; i < reg.curses.length; i++) {
        const power = obj.curses[i]?.power ?? 0;
        if (!power) continue;
        const cobj = reg.curses[i]!.obj;
        if (cobj.flags.has(OF.MULTIPLY_WEIGHT)) {
          if (cobj.weight === 100) continue;
        } else if (cobj.weight === 0) {
          continue;
        }

        objLocal = powerClone(obj);
        applyCurseAttributes(reg.curses, i, objLocal);
        objLocal.curses = null;
        const pAllButI = objectPower(reg, objLocal);
        const cname = reg.curses[i]!.name;
        randartLogf(
          () => `Power is ${pAllButI} with all but ${cname} curse applied\n`,
        );

        let pCurse = subGuardi(pAllCurse, pAllButI);
        if (pCurse < 0) {
          const resistance = Math.max(20, Math.min(100, power));
          pCurse = scaleGuarded(pCurse, resistance);
          pCurse = Math.trunc(pCurse / 100);
        }
        randartLogf(() => `Adjusted power is ${pCurse} for ${cname} curse\n`);
        q = addGuardi(q, pCurse);
      }
    }
  }

  if (q !== 0) {
    p += q;
    randartLogf(() => `Total of ${q} power added for curses, total is ${p}\n`);
  }
  return p;
}

function nonstandardWeightPower(
  reg: ObjRegistry,
  obj: PowerObject,
  p: number,
): number {
  const stdWeight = Math.max(obj.weight, 0);
  const nonstdWeight = objectWeightOne(obj, reg.curses);
  if (stdWeight === nonstdWeight) return p;

  let adj = 0;

  /* Merge flags from the base object and any curses (for THROWING below). */
  const flags = obj.flags.clone();
  if (obj.curses) {
    for (let i = 1; i < reg.curses.length; i++) {
      if (obj.curses[i]?.power) flags.union(reg.curses[i]!.obj.flags);
    }
  }

  /* ac_power already accounted for weight when the object provides base AC. */
  if (!obj.ac) {
    const adjWc = Math.trunc(
      (stdWeight - nonstdWeight) / WGT_POWER_DEN_NOBASEAC,
    );
    const scaled = scaleGuarded(adjWc, WGT_POWER_NUM_NOBASEAC);
    randartLogf(
      () =>
        `Add ${scaled} power for non-standard weight of object not affecting base armor.\n`,
    );
    adj = addGuardi(adj, scaled);
  }

  /* THROWING items can gain damage with weight. */
  if (flags.has(OF.THROWING)) {
    const adjTh =
      Math.trunc(nonstdWeight / WGT_POWER_DEN_THROW) -
      Math.trunc(stdWeight / WGT_POWER_DEN_THROW);
    const scaled = scaleGuarded(adjTh, WGT_POWER_NUM_THROW);
    randartLogf(
      () =>
        `Add ${scaled} power for non-standard weight of object good for throwing.\n`,
    );
    adj = addGuardi(adj, scaled);
  }

  if (adj) {
    p = addGuardi(p, adj);
    /* UPSTREAM TYPO, NOT REPRODUCED. obj-power.c:994 passes an int to "%p":
     *   log_obj("Add %d power combined for non-standard weight; "
     *           "total is %p\n", adj, p);
     * That is undefined behaviour with no portable output - glibc prints a
     * pointer-formatted value of whatever ends up in the register - so there
     * is nothing here to be byte-identical TO. The port prints the number the
     * line plainly means. Recorded in parity/ledger/obj-power.yaml rather
     * than silently normalised, because a wart this port would usually keep
     * (see the staircase invariant) is being dropped on purpose. */
    randartLogf(
      () => `Add ${adj} power combined for non-standard weight; total is ${p}\n`,
    );
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* object_power (obj-power.c L1005)                                     */
/* ------------------------------------------------------------------ */

/**
 * object_power: the object's overall power level. `reg` supplies the brand,
 * slay, curse and property tables the ratings read.
 */
export function objectPower(reg: ObjRegistry, obj: PowerObject): number {
  let p = toDamagePower(obj);
  const dicePwr = damageDicePower(obj);
  p += dicePwr;
  /* Completes damage_dice_power's trailing "Add %d power for damage dice, ". */
  if (dicePwr) randartLogf(() => `total is ${p}\n`);
  p += ammoDamagePower(obj, p);
  const mult = bowMultiplier(obj);
  p = launcherAmmoDamagePower(obj, p);
  p = extraBlowsPower(obj, p);
  if (p > INHIBIT_POWER) return p;
  p = extraShotsPower(obj, p);
  if (p > INHIBIT_POWER) return p;
  p = extraMightPower(obj, p, mult);
  if (p > INHIBIT_POWER) return p;
  p = slayPower(reg, obj, p, dicePwr);
  p = rescaleBowPower(obj, p);
  p = toHitPower(obj, p);

  /* Armour class power. */
  p = acPower(reg, obj, p);
  p = toAcPower(obj, p);

  /* Bonus for jewelry. */
  p = jewelryPower(obj, p);

  /* Other object properties. */
  p = modifierPower(reg, obj, p);
  p = flagsPower(reg, obj, p);
  p = elementPower(obj, p);
  p = effectsPower(obj, p);
  p = cursePower(reg, obj, p);
  p = nonstandardWeightPower(reg, obj, p);

  randartLogf(() => `FINAL POWER IS ${p}\n`);
  return p;
}
