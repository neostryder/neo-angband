/**
 * borg_power - the master scalar fitness function
 * (reference/src/borg/borg-power.c:1881). Ported faithfully: every weight and
 * threshold in borg_power_equipment (power.c:43) and borg_power_inventory
 * (power.c:1122) is preserved, reading ctx.world.self.trait[] and the derived
 * side-state (has[], amt_statgain, need_statgain) from state.ts.
 *
 * SEAM NOTES (see config.ts):
 * - The per-activation reward loop (power.c:704-1064) reads borg.activation[]
 *   and the act_* identity table; both come from the activation subsystem that
 *   AgentView does not expose, so with the default empty activation[] it
 *   contributes 0. Ported structurally as a no-op scan; wire activation counts
 *   in to enable it.
 * - The spellbook reward (power.c:1770-1829) needs borg_get_spell_entry (the
 *   magic subsystem); omitted with a caveat (amt_book stays 0 by default).
 * - Swap values (weapon_swap_value/armour_swap_value) are 0 (swap subsystem out
 *   of scope).
 * - spell_chance / spell_stat come from the spell seam / class map.
 */

import type { BorgContext } from "../context";
import { BI, CLASS_MAGE, CLASS_WARRIOR, CLASS_PRIEST, CLASS_DRUID,
  CLASS_NECROMANCER, CLASS_ROGUE, CLASS_RANGER, CLASS_PALADIN, CLASS_BLACKGUARD,
  STAT_MAX, spellStatForClass } from "./trait-index";
import type { ItemView } from "@neo-angband/core";
import { present } from "./item-util";
import { ADJ_STR_HOLD } from "./tables";
import { resolveOpts, type BorgTraitOpts, type ResolvedOpts } from "./config";
import { getDerived, has, type BorgDerived } from "./state";
import { borgPrepared } from "./prepared";

const SLOT_WIELD = 0;
const SLOT_BOW = 1;
const SLOT_BODY = 6;
const SLOT_HEAD = 9;
const SLOT_ARM = 8;
const SLOT_OUTER = 7;
const SLOT_HANDS = 10;
const SLOT_FEET = 11;

const TV_ARROW = 3;
const TV_DIGGING = 6;

/** Per-slot item weight (ItemView.weight is per-object; slots hold 1). */
function wgt(item: ItemView | null | undefined): number {
  return present(item) ? item.weight : 0;
}

/**
 * borg_power - overall fitness. Writes ctx.world.self.power and returns it.
 */
export function borgPower(ctx: BorgContext, opts: BorgTraitOpts = {}): number {
  const R = resolveOpts(opts);
  const t = ctx.world.self.trait;
  const d = getDerived(ctx.world);
  const equip = ctx.view.equipment();
  const cls = t[BI.CLASS]!;

  let value = 0;
  value += powerEquipment(t, d, R, equip, cls);
  value += powerInventory(t, d, R, equip, cls);

  /* Deep-level prep bonus (power.c:1899). Scan surface..maxdepth+50, stop at
   * the first depth the borg is not prepared for. */
  let i = 1;
  for (; i <= t[BI.MAXDEPTH]! + 50; i++) {
    if (borgPrepared(ctx, i, opts) !== null) break;
  }
  value += (i - 1) * 40000;

  /* Swap values: swap subsystem out of scope (0). */

  ctx.world.self.power = value;
  return value;
}

/** borg_power_equipment (power.c:43). */
function powerEquipment(
  t: number[],
  _d: BorgDerived,
  R: ResolvedOpts,
  equip: Array<ItemView | null>,
  cls: number,
): number {
  const cfg = R.cfg;
  let value = 0;
  const hold = ADJ_STR_HOLD[t[BI.STR_INDEX]!]!;

  /*** Weapon ***/
  const wep = equip[SLOT_WIELD];
  const wepToH = present(wep) ? wep.toH : 0;
  const wepToD = present(wep) ? wep.toD : 0;
  const wepDd = present(wep) ? wep.dd : 0;
  const wepDs = present(wep) ? wep.ds : 0;

  /* unID'd-weapon exploration bonus (power.c:70): ItemView exposes no ident
   * flag, items are treated identified, so this never fires (caveat). */

  let damage = wepDd * wepDs * 20;
  value += damage * (t[BI.BLOWS]! + 1);
  value += (t[BI.TOHIT]! + wepToH) * 100;
  value += (t[BI.TODAM]! + wepToD) * 30;
  if (cfg.worshipsDamage) value += (t[BI.TOHIT]! + wepToH) * 15;

  if (t[BI.MAXDEPTH]! >= 75) {
    value += (t[BI.TOHIT]! + wepToH) * 15;
    value += wepDd * wepDs * 20 * 2 * t[BI.BLOWS]!;
  }

  let dam = damage * 2 * t[BI.BLOWS]!;
  if (t[BI.WS_ANIMAL]) value += Math.trunc((dam * 2) / 2);
  if (t[BI.WS_EVIL]) value += Math.trunc((dam * 7) / 2);
  if (cfg.worshipsDamage) value += dam;

  dam = damage * 3 * t[BI.BLOWS]!;
  if (t[BI.WS_UNDEAD] && !t[BI.WK_UNDEAD]) value += Math.trunc((dam * 5) / 2);
  if (t[BI.WS_DEMON] && !t[BI.WK_DEMON]) value += Math.trunc((dam * 3) / 2);
  if (t[BI.WS_DRAGON] && !t[BI.WK_DRAGON]) value += Math.trunc((dam * 6) / 2);
  if (t[BI.WS_GIANT]) value += Math.trunc((dam * 4) / 2);
  if (t[BI.WB_ACID]) value += Math.trunc((dam * 4) / 2);
  if (t[BI.WB_ELEC]) value += Math.trunc((dam * 5) / 2);
  if (t[BI.WB_FIRE]) value += Math.trunc((dam * 3) / 2);
  if (t[BI.WB_COLD]) value += Math.trunc((dam * 3) / 2);
  if (t[BI.WS_ORC]) value += Math.trunc((dam * 1) / 2);
  if (t[BI.WS_TROLL]) value += Math.trunc((dam * 2) / 2);
  if (t[BI.WS_ORC] && !t[BI.WS_EVIL]) value += Math.trunc((dam * 1) / 2);
  if (t[BI.WS_TROLL] && !t[BI.WS_EVIL]) value += Math.trunc((dam * 1) / 2);
  if (cfg.worshipsDamage) value += dam;

  dam = damage * 5 * t[BI.BLOWS]!;
  if (t[BI.WK_UNDEAD]) value += Math.trunc((dam * 5) / 2);
  if (t[BI.WK_DEMON]) value += Math.trunc((dam * 5) / 2);
  if (t[BI.WK_DRAGON]) value += Math.trunc((dam * 5) / 2);
  if (cfg.worshipsDamage) value += dam;

  if (t[BI.W_IMPACT]) value += 50;
  if (t[BI.HEAVYWEPON]) value -= 500000;
  if (t[BI.CLEVEL]! <= 10) value += t[BI.BLOWS]! * 45000;

  /*** Bow ***/
  const bow = equip[SLOT_BOW];
  const bowToH = present(bow) ? bow.toH : 0;
  const bowToD = present(bow) ? bow.toD : 0;

  if (bowToD > 8 || t[BI.CLEVEL]! < 25)
    damage = (t[BI.AMMO_SIDES]! + bowToD) * t[BI.AMMO_POWER]!;
  else damage = (t[BI.AMMO_SIDES]! + 8) * t[BI.AMMO_POWER]!;

  if (cfg.worshipsDamage) value += t[BI.SHOTS]! * damage * 11;
  else value += t[BI.SHOTS]! * damage * 9;

  if (t[BI.CLEVEL]! < 15) value += t[BI.SHOTS]! * damage * 200;

  if (present(bow) && bow.sval === R.svals.sling && !bow.artifact && t[BI.STR]! < 9)
    value -= 5000;
  if (present(bow) && bow.sval === R.svals.sling && t[BI.CLEVEL] === 1 && t[BI.STR]! >= 9)
    value += 8000;

  value += (t[BI.TOHIT]! + bowToH) * 100;
  if (cfg.worshipsDamage) value += (t[BI.TOHIT]! + bowToH) * 25;

  if (t[BI.FAST_SHOTS] && t[BI.AMMO_TVAL] === TV_ARROW) value += 30000;
  if (present(bow) && hold < bow.weight / 10) value -= 500000;

  /*** Rewards ***/
  if (cls === CLASS_NECROMANCER) value -= (t[BI.LIGHT]! - 1) * 10000;
  else if (t[BI.LIGHT]! <= 3) value += t[BI.LIGHT]! * 10000;
  else if (t[BI.LIGHT]! > 3) value += 30000 + t[BI.LIGHT]! * 1000;

  value += t[BI.MOD_MOVES]! * 3000;
  value += t[BI.DAM_RED]! * 10000;

  value += speedReward(t[BI.SPEED]!, cfg.worshipsSpeed);

  value += t[BI.STR_INDEX]! * 100;

  const spellStat = spellStatForClass(cls);
  if (spellStat >= 0) {
    value += t[BI.STR_INDEX + spellStat]! * 500;
    if (cfg.worshipsMana) value += Math.trunc(t[BI.SP_ADJ]! / 2) * 255;
    else value += Math.trunc(t[BI.SP_ADJ]! / 2) * 155;
    value += (100 - R.spells.spellChance()) * 100;
    if (R.spells.playerHas("ZERO_FAIL") && R.spells.spellChance() < 1) value += 30000;
  }

  if (t[BI.DEX_INDEX]! <= 37) value += t[BI.DEX_INDEX]! * 120;

  if (t[BI.CON_INDEX]! <= 37) {
    if (cfg.worshipsHp) {
      value += t[BI.CON_INDEX]! * 250;
      if (t[BI.HP_ADJ]! < 800) value += t[BI.HP_ADJ]! * 450;
      else value += (t[BI.HP_ADJ]! - 800) * 100 + 350 * 500;
    } else {
      value += t[BI.CON_INDEX]! * 150;
      if (t[BI.HP_ADJ]! < 500) value += t[BI.HP_ADJ]! * 350;
      else value += (t[BI.HP_ADJ]! - 500) * 100 + 350 * 500;
    }
  }

  for (let i = 0; i < STAT_MAX; i++) value += t[BI.ASTR + i]!;

  value += t[BI.DISP]! * 2;
  value += t[BI.DISM]! * 2;
  value += t[BI.DEV]! * 25;
  value += t[BI.SAV]! * 25;
  if (t[BI.SAV]! > 99) value += 10000;
  value += t[BI.STL]! * 2;
  value += t[BI.SRCH]! * 1;
  value += t[BI.THN]! * 5;
  value += t[BI.THB]! * 35;
  value += t[BI.THT]! * 2;
  value += t[BI.DIG]! * 2;

  /*** Flags ***/
  if (t[BI.SDIG]) value += 750;
  if (t[BI.SDIG] && t[BI.ISHUNGRY]) value += 7500;
  if (t[BI.SDIG] && t[BI.ISWEAK]) value += 7500;

  if (t[BI.MAXDEPTH]! < 20) {
    if (t[BI.FEATH]) value += 500;
  } else if (t[BI.FEATH]) value += 50;

  if (t[BI.LIGHT]) value += 2000;
  if (t[BI.ESP] && t[BI.SINV]) value += 500;
  if (!t[BI.DINV] && t[BI.SINV]) value += 5000;
  if (t[BI.FRACT]) value += 10000;

  if (t[BI.MAXCLEVEL]! < 50) {
    if (t[BI.HLIFE]) value += 2000;
  } else if (t[BI.HLIFE]) value += 200;
  if (t[BI.REG]) value += 2000;
  if (t[BI.ESP]) value += 80000;

  if (t[BI.ICOLD]) value += 65000;
  if (t[BI.IELEC]) value += 40000;
  if (t[BI.IFIRE]) value += 80000;
  if (t[BI.IACID]) value += 50000;

  if (t[BI.RCOLD]) value += 3000;
  if (t[BI.RELEC]) value += 4000;
  if (t[BI.RACID]) value += 6000;
  if (t[BI.RFIRE]) value += 8000;
  if (t[BI.RFIRE] && t[BI.RACID] && t[BI.RELEC] && t[BI.RCOLD]) value += 10000;
  if (t[BI.RPOIS]) value += 20000;
  if (t[BI.RSND]) value += 3500;
  if (t[BI.RLITE]) value += 800;
  if (t[BI.RDARK]) value += 800;
  if (t[BI.RKAOS]) value += 5000;
  if (t[BI.RCONF]) value += 80000;
  if (cls === CLASS_MAGE && t[BI.RCONF]) value += 2000;
  if (t[BI.RDIS]) value += 5000;
  if (t[BI.RSHRD]) value += 100;
  if (t[BI.RNXUS]) value += 100;
  if (t[BI.RBLIND]) value += 5000;
  if (t[BI.RNTHR]) value += 5500;
  if (t[BI.RFEAR]) value += 2000;

  if (t[BI.SSTR]) value += 50;
  if (t[BI.SINT]) value += 50;
  if (t[BI.SWIS]) value += 50;
  if (t[BI.SCON]) value += 50;
  if (t[BI.SDEX]) value += 50;
  if (t[BI.SSTR] && t[BI.SINT] && t[BI.SWIS] && t[BI.SDEX] && t[BI.SCON])
    value += 1000;

  /*** Necessary flags by depth (power.c:513) ***/
  const md1 = t[BI.MAXDEPTH]! + 1;
  if ((t[BI.SINV] || t[BI.ESP]) && md1 >= 10) value += 100000;
  if (t[BI.FRACT] && md1 >= 20) value += 100000;
  if (t[BI.RFIRE] && md1 >= 25) value += 100000;
  if (t[BI.RPOIS] && md1 >= 40) value += 100000;
  if (t[BI.RELEC] && md1 >= 40) value += 100000;
  if (t[BI.RACID] && md1 >= 40) value += 100000;
  if (t[BI.RCOLD] && md1 >= 40) value += 100000;
  if (t[BI.HLIFE] && md1 >= 46 && t[BI.MAXCLEVEL]! < 50) value += 100000;
  if (t[BI.SPEED]! >= 115 && md1 >= 46) value += 100000;
  if (t[BI.RCONF] && md1 >= 46) value += 100000;
  if (t[BI.RNTHR] && md1 >= 50) value += 55000;
  if (t[BI.RSND] && md1 >= 50) value += 100000;
  if (t[BI.RBLIND] && md1 >= 55) value += 100000;
  if (t[BI.ESP] && md1 >= 55) value += 100000;
  if (t[BI.RNTHR] && md1 >= 60) value += 55000;
  if (t[BI.RKAOS] && md1 >= 60) value += 104000;
  if (t[BI.RDIS] && md1 >= 60) value += 90000;
  if (t[BI.SPEED]! >= 120 && md1 >= 60) value += 100000;
  if (t[BI.SPEED]! >= 130 && md1 >= 80) value += 100000;
  if (t[BI.RNTHR] && md1 >= 80) value += 15000;
  if (t[BI.RDARK] && md1 >= 80) value += 25000;
  if (t[BI.SPEED]! >= 140 && md1 >= 80 && cls === CLASS_WARRIOR) value += 100000;

  /*** Armor ***/
  const armor = t[BI.ARMOR]!;
  if (cfg.worshipsAc) {
    if (armor < 15) value += armor * 2500;
    if (armor >= 15 && armor < 75) value += armor * 2000 + 28250;
    if (armor >= 75) value += armor * 1500 + 73750;
  } else {
    if (armor < 15) value += armor * 2000;
    if (armor >= 15 && armor < 75) value += armor * 500 + 28350;
    if (armor >= 75) value += armor * 100 + 73750;
  }

  /*** Penalties ***/
  if (t[BI.CRSAGRV]) value -= 800000;
  if (t[BI.CRSHPIMP]) value -= 35000;
  if (cls !== CLASS_WARRIOR && t[BI.CRSMPIMP]) value -= 15000;
  if (
    (cls === CLASS_MAGE || cls === CLASS_PRIEST || cls === CLASS_DRUID ||
      cls === CLASS_NECROMANCER) && t[BI.CRSMPIMP]
  )
    value -= 15000;
  if (t[BI.CRSFEAR]) value -= 400000;
  if (t[BI.CRSFEAR] && cls !== CLASS_MAGE) value -= 200000;
  if (t[BI.CRSDRAIN_XP]) value -= 400000;
  if (t[BI.CRSFVULN]) value -= 30000;
  if (t[BI.CRSEVULN]) value -= 30000;
  if (t[BI.CRSCVULN]) value -= 30000;
  if (t[BI.CRSAVULN]) value -= 30000;
  if (t[BI.CRSTELE]) value -= 100000;
  if (t[BI.CRSENVELOPING]) value -= 50000;
  if (t[BI.CRSIRRITATION]) value -= 20000;
  if (t[BI.CRSPOIS]) value -= 10000;
  if (t[BI.CRSSIREN]) value -= 800000;
  if (t[BI.CRSHALU]) value -= 100000;
  if (t[BI.CRSPARA]) value -= 800000;
  if (t[BI.CRSSDEM]) value -= 100000;
  if (t[BI.CRSSDRA]) value -= 100000;
  if (t[BI.CRSSUND]) value -= 100000;
  if (t[BI.CRSSTONE] && t[BI.SPEED]! < 140) value -= 10000;
  if (t[BI.CRSSTEELSKIN] && t[BI.SPEED]! < 140) value -= 10000;
  if (t[BI.CRSNOTEL]) value -= 700000;
  if (t[BI.CRSTWEP]) value -= 100000;
  if (t[BI.CRSAIRSWING]) value -= 10000;
  if (t[BI.CRSUNKNO]) value -= 9999999;

  value += 3000 * t[BI.MULTIPLE_BONUSES]!;
  value += 10000 * t[BI.WORN_NEED_ID]!;

  /* Per-activation reward loop (power.c:704): activation[] empty by default. */
  value += activationReward(ctx_activation(), t, cls);

  /* Random-power un-ID'd cloak bonus (power.c:1069): ego random-power data not
   * exposed; omitted (caveat). */

  /*** Armor weight penalties (power.c:1077) ***/
  if (t[BI.STR_INDEX]! < 15) {
    if (wgt(equip[SLOT_BODY]) > 200) value -= (wgt(equip[SLOT_BODY]) - 200) * 15;
    if (wgt(equip[SLOT_HEAD]) > 30) value -= 250;
    if (wgt(equip[SLOT_ARM]) > 10) value -= 250;
    if (wgt(equip[SLOT_FEET]) > 50) value -= 250;
  }

  let curWgt = 0;
  curWgt += wgt(equip[SLOT_BODY]);
  curWgt += wgt(equip[SLOT_HEAD]);
  curWgt += wgt(equip[SLOT_ARM]);
  curWgt += wgt(equip[SLOT_OUTER]);
  curWgt += wgt(equip[SLOT_HANDS]);
  curWgt += wgt(equip[SLOT_FEET]);

  const maxWgt = R.frame.spellWeight ?? 0;
  const totalSpells = R.frame.totalSpells ?? 0;
  if (totalSpells && Math.trunc((curWgt - maxWgt) / 10) > 0) {
    let maxSp = Math.trunc(t[BI.SP_ADJ]! / 100) + 1;
    maxSp -= Math.trunc((curWgt - maxWgt) / 10);
    if (maxSp >= 300 && maxSp <= 350) value -= Math.trunc((curWgt - maxWgt) / 10) * 400;
    if (maxSp >= 200 && maxSp <= 299) value -= Math.trunc((curWgt - maxWgt) / 10) * 800;
    if (maxSp >= 100 && maxSp <= 199) value -= Math.trunc((curWgt - maxWgt) / 10) * 1600;
    if (maxSp <= 99) value -= Math.trunc((curWgt - maxWgt) / 10) * 3200;
  }

  return value;
}

/* Activation reward is a no-op until the activation subsystem is wired (see
 * module note). Returns 0 for an empty activation[]. */
function ctx_activation(): number[] {
  return [];
}
function activationReward(_activation: number[], _t: number[], _cls: number): number {
  return 0;
}

/**
 * borg_power_speed reward table (power.c:249-303). Extracted so both the
 * worships and non-worships branches read cleanly.
 */
function speedReward(speed: number, worships: boolean): number {
  if (worships) {
    if (speed >= 150) return (speed - 120) * 1500 + 185000;
    if (speed >= 145 && speed <= 149) return (speed - 120) * 1500 + 180000;
    if (speed >= 140 && speed <= 144) return (speed - 120) * 1500 + 175000;
    if (speed >= 135 && speed <= 139) return (speed - 120) * 1500 + 175000;
    if (speed >= 130 && speed <= 134) return (speed - 120) * 1500 + 160000;
    if (speed >= 125 && speed <= 129) return (speed - 110) * 1500 + 135000;
    if (speed >= 120 && speed <= 124) return (speed - 110) * 1500 + 110000;
    if (speed >= 115 && speed <= 119) return (speed - 110) * 1500 + 85000;
    if (speed >= 110 && speed <= 114) return (speed - 110) * 1500 + 65000;
    if (speed < 110) return (speed - 110) * 2500;
    return 0;
  }
  if (speed >= 140) return (speed - 120) * 1000 + 175000;
  if (speed >= 135 && speed <= 139) return (speed - 120) * 1000 + 165000;
  if (speed >= 130 && speed <= 134) return (speed - 120) * 1000 + 150000;
  if (speed >= 125 && speed <= 129) return (speed - 110) * 1000 + 125000;
  if (speed >= 120 && speed <= 124) return (speed - 110) * 1000 + 100000;
  if (speed >= 115 && speed <= 119) return (speed - 110) * 1000 + 75000;
  if (speed >= 110 && speed <= 114) return (speed - 110) * 1000 + 55000;
  if (speed < 110) return (speed - 110) * 2500;
  return 0;
}

/** borg_power_inventory (power.c:1122). */
function powerInventory(
  t: number[],
  d: BorgDerived,
  R: ResolvedOpts,
  equip: Array<ItemView | null>,
  cls: number,
): number {
  const cfg = R.cfg;
  const H = R.home;
  let value = 0;
  let k = 0;
  const munchGate =
    cfg.munchkinStart && t[BI.MAXCLEVEL]! < cfg.munchkinLevel;

  /* Fuel (power.c:1131). */
  for (k = 0; k < 6 && k < t[BI.AFUEL]!; k++) value += 60000;
  if (t[BI.STR]! >= 15) for (; k < 10 && k < t[BI.AFUEL]!; k++) value += 6000 - k * 100;

  /* Food (power.c:1140). */
  if ((t[BI.ISHUNGRY] || t[BI.ISWEAK]) && t[BI.FOOD]) value += 100000;
  for (k = 0; k < 7 && k < t[BI.FOOD]!; k++) value += 50000;
  if (t[BI.STR]! >= 15) for (; k < 10 && k < t[BI.FOOD]!; k++) value += 200;
  if (t[BI.REG] && t[BI.CLEVEL]! <= 15)
    for (k = 0; k < 15 && k < t[BI.FOOD]!; k++) value += 700;

  for (k = 0; k < 7 && k < t[BI.FOOD_HI]!; k++) value += 52;
  for (k = 0; k < 15 && k < t[BI.FOOD_LO]!; k++) value -= 2;

  /* Cure poison/cuts (power.c:1166). */
  if ((t[BI.ISCUT] || t[BI.ISPOISONED]) && t[BI.ACCW]) value += 100000;
  if ((t[BI.ISCUT] || t[BI.ISPOISONED]) && t[BI.AHEAL]) value += 50000;
  if ((t[BI.ISCUT] || t[BI.ISPOISONED]) && t[BI.ACSW])
    for (k = 0; k < 5 && k < t[BI.ACSW]!; k++) value += 25000;
  if (t[BI.ISPOISONED] && t[BI.ACUREPOIS]) value += 15000;

  /* Resist-poison pots (power.c:1182). Note: k continues from above, as in C. */
  if (!t[BI.IPOIS] && t[BI.ACUREPOIS]! <= 20) {
    if (!munchGate) for (; k < 4 && k < t[BI.ARESPOIS]!; k++) value += 300;
  }

  /* Warrior resist pots (power.c:1194). */
  if (cls === CLASS_WARRIOR && t[BI.MAXDEPTH]! > 20) {
    k = 0;
    if (!munchGate) {
      if (!t[BI.IFIRE]) for (; k < 4 && k < t[BI.ARESHEAT]!; k++) value += 500;
      k = 0;
      if (!t[BI.ICOLD]) for (; k < 4 && k < t[BI.ARESCOLD]!; k++) value += 500;
      if (!t[BI.IPOIS]) for (; k < 4 && k < t[BI.ARESPOIS]!; k++) value += 500;
    }
  }

  /* Identify (power.c:1221). */
  k = 0;
  if (t[BI.CLEVEL]! >= 10) {
    for (; k < 5 && k < t[BI.AID]!; k++) value += 6000;
    if (t[BI.STR]! >= 15) for (; k < 15 && k < t[BI.AID]!; k++) value += 600;
  }
  if (t[BI.ALL_NEED_ID]) {
    for (k = 0; k < t[BI.ALL_NEED_ID]! && k < t[BI.AID]!; k++) value += 6000;
  }

  /* PFE (power.c:1237). */
  k = 0;
  if (!munchGate) {
    for (; k < 10 && k < t[BI.APFE]!; k++) value += 10000;
    for (; k < 25 && k < t[BI.APFE]!; k++) value += 2000;
  }
  /* Glyph (power.c:1249). */
  k = 0;
  for (; k < 10 && k < t[BI.AGLYPH]!; k++) value += 10000;
  for (; k < 25 && k < t[BI.AGLYPH]!; k++) value += 2000;
  if (t[BI.MAXDEPTH]! >= 100) {
    k = 0;
    for (; k < 10 && k < t[BI.AGLYPH]!; k++) value += 2500;
    for (; k < 75 && k < t[BI.AGLYPH]!; k++) value += 2500;
  }

  /* Mass banishment (power.c:1264). */
  if (t[BI.MAXDEPTH]! >= 100) {
    for (k = 0; k < 99 && k < t[BI.AMASSBAN]!; k++) value += 2500;
  }

  /* Recall (power.c:1271). */
  if (t[BI.CLEVEL]! > 7 && !munchGate) {
    k = 0;
    for (; k < 3 && k < t[BI.RECALL]!; k++) value += 50000;
    if (t[BI.STR]! >= 15) for (; k < 7 && k < t[BI.RECALL]!; k++) value += 5000;
    if (t[BI.MAXDEPTH]! >= 50 && has(d, "rod_recall")) value += 12000;
  }

  /* Phase (power.c:1291). */
  k = 1;
  if (t[BI.APHASE]) value += 50000;
  if (!munchGate) {
    for (; k < 8 && k < t[BI.APHASE]!; k++) value += 500;
    if (t[BI.STR]! >= 15) for (; k < 15 && k < t[BI.APHASE]!; k++) value += 500;
  }

  /* Escape (power.c:1308). */
  k = 0;
  if (!munchGate) {
    for (; k < 2 && k < t[BI.AESCAPE]!; k++) value += 10000;
    if (t[BI.MAXDEPTH]! > 70) {
      k = 0;
      for (; k < 3 && k < t[BI.AESCAPE]!; k++) value += 10000;
    }
  }

  /* Teleport scroll (power.c:1323). */
  k = 0;
  if (t[BI.CLEVEL]! >= 3 && t[BI.ATELEPORT]) value += 10000;
  if (t[BI.CLEVEL]! >= 7) for (; k < 3 && k < t[BI.ATELEPORT]!; k++) value += 10000;
  if (t[BI.CLEVEL]! >= 30) for (; k < 10 && k < t[BI.ATELEPORT]!; k++) value += 10000;

  /* Teleport level (power.c:1338). */
  k = 0;
  if (t[BI.CLEVEL]! >= 15)
    for (; k < 5 && k < t[BI.ATELEPORTLVL]!; k++) value += 5000;

  /*** Healing (power.c:1346) ***/
  if (cls === CLASS_WARRIOR || cls === CLASS_ROGUE || cls === CLASS_BLACKGUARD) {
    for (k = 0; k < 15 && k < t[BI.AHEAL]!; k++) value += 8000;
    k = 0;
    if (t[BI.MAXDEPTH]! >= 46) {
      const lim = t[BI.PREP_BIG_FIGHT] ? 1 : 2;
      for (; k < lim && k < t[BI.AEZHEAL]!; k++) value += 10000;
    }
    for (k = 0; k < 6 && k < has(d, "rod_healing"); k++) value += 20000;
  } else if (
    cls === CLASS_RANGER || cls === CLASS_PALADIN ||
    cls === CLASS_NECROMANCER || cls === CLASS_MAGE
  ) {
    for (k = 0; k < 10 && k < t[BI.AHEAL]!; k++) value += 4000;
    k = 0;
    if (t[BI.MAXDEPTH]! >= 46) {
      const lim = t[BI.PREP_BIG_FIGHT] ? 1 : 2;
      for (; k < lim && k < t[BI.AEZHEAL]!; k++) value += 10000;
    }
    if (cls === CLASS_PALADIN)
      for (k = 0; k < 3 && k < has(d, "potion_healing"); k++) value += 5000;
    for (k = 0; k < 4 && k < has(d, "rod_healing"); k++) value += 20000;
  } else if (cls === CLASS_PRIEST || cls === CLASS_DRUID) {
    if (t[BI.CLEVEL] === 1)
      for (k = 0; k < 10 && k < has(d, "potion_healing"); k++) value -= 2000;
    for (k = 0; k < 5 && k < has(d, "potion_healing"); k++) value += 2000;
    k = 0;
    if (t[BI.MAXDEPTH]! >= 46) {
      const lim = t[BI.PREP_BIG_FIGHT] ? 1 : 2;
      for (; k < lim && k < t[BI.AEZHEAL]!; k++) value += 10000;
    }
  }

  /* Endgame potion stockpile (power.c:1431). */
  if (t[BI.MAXDEPTH]! >= 99 && !t[BI.PREP_BIG_FIGHT]) {
    for (k = 0; k < 99 && k < has(d, "potion_healing"); k++) value += 8000;
    for (k = 0; k < 99 && k < t[BI.AEZHEAL]!; k++) value += 10000;
    for (k = 0; k < 99 && k < t[BI.ASPEED]!; k++) value += 8000;
    for (k = 0; k < 99 && k < t[BI.ALIFE]!; k++) value += 10000;
    if (cls !== CLASS_WARRIOR)
      for (k = 0; k < 99 && k < has(d, "potion_restore_mana"); k++) value += 5000;
    for (k = 0; k < 40 && k < has(d, "mush_stoneskin"); k++) value += 5000;
    if (t[BI.SAURON_DEAD])
      for (k = 0; k < 99 && k < t[BI.AMASSBAN]!; k++) value += 2500;
  }

  /* Restore mana (power.c:1463). */
  if (t[BI.MAXSP]! > 100) {
    for (k = 0; k < 10 && k < has(d, "potion_restore_mana"); k++) value += 4000;
    for (k = 0; k < 100 && k < t[BI.ASTFMAGI]!; k++) value += 4000;
  }

  /* Cure critical (power.c:1472). */
  if (t[BI.CLEVEL]! < 35 && t[BI.CLEVEL]! > 10) {
    for (k = 0; k < 10 && k < t[BI.ACCW]!; k++) value += 5000;
  } else if (t[BI.CLEVEL]! >= 35) {
    for (k = 0; k < 10 && k < t[BI.ACCW]!; k++) value += 5000;
    if (t[BI.STR]! > 15) for (; k < 15 && k < t[BI.ACCW]!; k++) value += 500;
  }

  /* Cure serious (power.c:1489). */
  if (
    t[BI.ACCW]! < 5 && t[BI.MAXCLEVEL]! > 10 &&
    (t[BI.CLEVEL]! < 35 || !t[BI.RCONF])
  ) {
    for (k = 0; k < 7 && k < t[BI.ACSW]!; k++) value += 50;
    if (t[BI.STR]! > 15) for (; k < 10 && k < t[BI.ACSW]!; k++) value += 5;
  }

  /* Cure light (power.c:1501). */
  if (t[BI.ACCW]! + t[BI.ACSW]! < 5 && t[BI.CLEVEL]! < 8) {
    for (k = 0; k < 5 && k < t[BI.ACLW]!; k++) value += 550;
  }

  /* Cures (power.c:1509). */
  if (!t[BI.RCONF]) {
    if (!(cfg.munchkinStart && t[BI.MAXCLEVEL]! < 10))
      for (k = 0; k < 10 && k < t[BI.FOOD_CURE_CONF]!; k++) value += 400;
  }
  if (!t[BI.RBLIND]) {
    if (!munchGate)
      for (k = 0; k < 5 && k < t[BI.FOOD_CURE_BLIND]!; k++) value += 300;
  }
  if (!t[BI.RPOIS]) {
    if (!munchGate) for (k = 0; k < 5 && k < t[BI.ACUREPOIS]!; k++) value += 250;
  }

  /*** Detection (power.c:1541) ***/
  for (k = 0; k < 1 && k < t[BI.ADETTRAP]!; k++) value += 4000;
  for (k = 0; k < 1 && k < t[BI.ADETDOOR]!; k++) value += 2000;
  if (!t[BI.ESP]) for (k = 0; k < 1 && k < t[BI.ADETEVIL]!; k++) value += 1000;
  for (k = 0; k < 1 && k < t[BI.AMAGICMAP]!; k++) value += 4000;
  if (cls !== CLASS_NECROMANCER)
    for (k = 0; k < 1 && k < t[BI.ALITE]!; k++) value += 1000;

  /* Genocide scrolls (power.c:1570). */
  if (t[BI.MAXDEPTH]! >= 100) {
    k = 0;
    for (; k < 10 && k < has(d, "scroll_mass_banishment"); k++) value += 10000;
    for (; k < 25 && k < has(d, "scroll_mass_banishment"); k++) value += 2000;
  }

  /* Speed potions (power.c:1579). */
  if (!munchGate) for (k = 0; k < 20 && k < t[BI.ASPEED]!; k++) value += 5000;

  /* Recharge (power.c:1589). */
  if (t[BI.ARECHARGE] && t[BI.MAXDEPTH]! < 99) value += 5000;

  /*** Missiles (power.c:1594) ***/
  if (cls === CLASS_RANGER || cls === CLASS_WARRIOR) {
    for (k = 0; k < 40 && k < t[BI.AMISSILES]!; k++) value += 100;
    if (t[BI.STR]! > 15 && t[BI.STR]! <= 18)
      for (; k < 80 && k < t[BI.AMISSILES]!; k++) value += 10;
    if (t[BI.STR]! > 18) for (; k < 180 && k < t[BI.AMISSILES]!; k++) value += 8;
    for (k = 4; k < t[BI.QUIVER_SLOTS]!; k++) value -= 10000;
  } else {
    for (k = 0; k < 20 && k < t[BI.AMISSILES]!; k++) value += 100;
    if (t[BI.STR]! > 15) for (; k < 50 && k < t[BI.AMISSILES]!; k++) value += 10;
    if (t[BI.STR]! <= 15 && t[BI.AMISSILES]! > 20) value -= 1000;
    for (k = 2; k < t[BI.QUIVER_SLOTS]!; k++) value -= 10000;
  }
  value -= 1000 * t[BI.AMISSILES_CURSED]!;
  value += 100 * t[BI.AMISSILES_SPECIAL]!;

  /*** Various (power.c:1637) ***/
  if (t[BI.ASTFDEST]) value += 5000;
  for (k = 0; k < 9 && k < t[BI.ASTFDEST]!; k++) value += 200;

  if (t[BI.ATPORTOTHER]) value += 5000;
  if (cls === CLASS_WARRIOR && t[BI.ATPORTOTHER]) value += 50000;
  for (k = 0; k < 15 && k < t[BI.ATPORTOTHER]!; k++) value += 5000;

  if ((has(d, "wand_magic_missile") || has(d, "wand_stinking_cloud")) && t[BI.MAXDEPTH]! < 30)
    value += 5000;
  if (has(d, "wand_annihilation") && t[BI.CDEPTH]! < 30) value += 5000;
  if (
    (cls === CLASS_WARRIOR || t[BI.CLEVEL]! <= 20) &&
    (has(d, "wand_magic_missile") || has(d, "wand_annihilation") || has(d, "wand_stinking_cloud"))
  )
    value += 10000;
  value += t[BI.GOOD_W_CHG]! * 50;

  if (t[BI.GOOD_S_CHG]) value += 2500;
  for (k = 0; k < 3 && k < t[BI.GOOD_S_CHG]!; k++) value += 500;

  for (k = 0; k < 6 && k < t[BI.AROD1]!; k++) value += 8000;
  for (k = 0; k < 6 && k < t[BI.AROD2]!; k++) value += 12000;

  /* Max-stat rewards (power.c:1686). */
  if (!d.needStatgain[0]) value += 50000;
  if (!d.needStatgain[1]) value += 20000;
  if (!d.needStatgain[2]) value += 20000;
  if (!d.needStatgain[3]) value += 50000;
  if (!d.needStatgain[4]) value += 50000;

  const spellStat = spellStatForClass(cls);
  if (spellStat >= 0 && !d.needStatgain[spellStat]) value += 50000;

  /* Stat potions (power.c:1703). */
  if (d.amtStatgain[0]! && t[BI.CSTR]! < 18 + 100) value += 550000;
  if (d.amtStatgain[1]! && t[BI.CINT]! < 18 + 100) value += 520000;
  if (spellStat >= 0 && d.amtStatgain[spellStat]! && t[BI.CSTR + spellStat]! < 18 + 100)
    value += 575000;
  if (d.amtStatgain[2]! && t[BI.CWIS]! < 18 + 100) value += 520000;
  if (d.amtStatgain[3]! && t[BI.CDEX]! < 18 + 100) value += 550000;
  if (d.amtStatgain[4]! && t[BI.CCON]! < 18 + 100) value += 550000;

  /* Remove curse (power.c:1720). */
  if (t[BI.FIRST_CURSED]) {
    if (has(d, "scroll_star_remove_curse")) value += 90000;
    if (has(d, "scroll_remove_curse")) value += 90000;
  }

  if (t[BI.HASFIXEXP]) value += 50000;

  /*** Enchantment (power.c:1731) ***/
  if (t[BI.AENCH_ARM]! < 1000 && t[BI.NEED_ENCHANT_TO_A]) value += 540;
  if (t[BI.AENCH_TOH]! < 1000 && t[BI.NEED_ENCHANT_TO_H]) value += 540;
  if (t[BI.AENCH_TOD]! < 1000 && t[BI.NEED_ENCHANT_TO_D]) value += 500;
  if (t[BI.AENCH_SWEP]) value += 5000;
  if (t[BI.AENCH_SARM]) value += 5000;

  /* Empty slots (power.c:1753). */
  for (k = 1; k < 6 && k < t[BI.EMPTY]!; k++) value += 40;
  if (t[BI.EMPTY]) value += 4000;

  /* Shovel at low level (power.c:1761). */
  if (
    t[BI.MAXDEPTH]! <= 40 && t[BI.MAXDEPTH]! >= 25 && t[BI.GOLD]! < 100000 &&
    (equip[SLOT_WIELD]?.tval ?? -1) !== TV_DIGGING && t[BI.ADIGGER] === 1
  )
    value += 5000;

  /* Books (power.c:1768): needs the magic subsystem's spell tables; omitted
   * (amt_book is 0 by default). */

  /* Encumbrance penalty from weight (power.c:1834). */
  if (t[BI.WEIGHT]! > Math.trunc(t[BI.CARRY]! / 2)) {
    value -=
      Math.trunc(
        (t[BI.WEIGHT]! - Math.trunc(t[BI.CARRY]! / 2)) /
          Math.trunc(t[BI.CARRY]! / 10),
      ) * 1000;
  }

  void H;
  return value;
}
