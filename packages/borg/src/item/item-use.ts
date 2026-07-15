/**
 * Consumable use decisions - a faithful port of borg-item-use.c: quaff/read/
 * eat/zap/use/aim/activate helpers, the device fail checks, borg_use_things and
 * borg_recharging. Each returns an AgentCommand (built from ctx.act) or null,
 * replacing the C's borg_keypress side effects.
 *
 * The C borg_quaff_potion(sval) etc. locate the pack slot with borg_slot then
 * press the letter; here we locate the ItemView and build the verb from its
 * handle. The "clear shop goals" bookkeeping the C does after each use is
 * intentionally omitted (goal management is P8.6's concern).
 */

import type { BorgContext, ItemView, AgentCommand } from "./types";
import type { BorgWorld } from "../world/model";
import { BI } from "../trait/trait-index";
import { TV, SVAL } from "./svals";
import type { ItemDeps } from "./deps";
import {
  trait,
  borgSlot,
  hasSlot,
  deviceFail,
  itemLevel,
  isAware,
  isIdent,
  clockOf,
  equipsItem,
  activateHandle,
} from "./deps";
import {
  Spell,
  borgSpell,
  borgSpellFail,
  borgSpellOkayFail,
} from "./magic";

/* ------------------------------------------------------------------ *
 * Potions
 * ------------------------------------------------------------------ */

/** Attempt to quaff the given potion by sval (borg_quaff_potion, use.c:76). */
export function borgQuaffPotion(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): AgentCommand | null {
  const item = borgSlot(ctx, TV.POTION, sval, d);
  if (!item) return null;
  return ctx.act.quaff(item.handle);
}

/** Per-world static for borg_quaff_crit's when_last_quaff (use.c:47). */
interface QuaffState {
  whenLastQuaff: number;
}
const quaffStore = new WeakMap<BorgWorld, QuaffState>();
function quaffState(world: BorgWorld): QuaffState {
  let s = quaffStore.get(world);
  if (!s) {
    s = { whenLastQuaff: 0 };
    quaffStore.set(world, s);
  }
  return s;
}

/**
 * borg_quaff_crit(no_check): quaff Cure Critical Wounds, the conserved emergency
 * heal (use.c:45). With no_check, drink unconditionally; otherwise avoid drinking
 * twice within 4 turns (75% of the time) and keep the last two in reserve.
 */
export function borgQuaffCrit(
  ctx: BorgContext,
  noCheck: boolean,
  d?: ItemDeps,
): AgentCommand | null {
  const st = quaffState(ctx.world);
  const borgT = clockOf(ctx, d);
  const sval = SVAL.potion.cure_critical!;

  if (noCheck) {
    const cmd = borgQuaffPotion(ctx, sval, d);
    if (cmd) st.whenLastQuaff = borgT;
    return cmd;
  }

  /* Avoid drinking CCW twice in a row (use.c:58). */
  if (
    st.whenLastQuaff > borgT - 4 &&
    st.whenLastQuaff <= borgT &&
    ctx.rng.randint1(100) < 75
  )
    return null;

  /* Save the last two for a real emergency (use.c:63). */
  if (trait(ctx, BI.ACCW) < 2) return null;

  const cmd = borgQuaffPotion(ctx, sval, d);
  if (cmd) st.whenLastQuaff = borgT;
  return cmd;
}

/** borg_quaff_unknown: quaff any unaware potion (use.c:104). Needs deps.isAware. */
export function borgQuaffUnknown(
  ctx: BorgContext,
  d?: ItemDeps,
): AgentCommand | null {
  let n: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval !== TV.POTION) continue;
    if (isAware(item, d)) continue;
    n = item; /* keep the last, as the C loop does */
  }
  return n ? ctx.act.quaff(n.handle) : null;
}

/* ------------------------------------------------------------------ *
 * Scrolls
 * ------------------------------------------------------------------ */

/** borg_read_scroll(sval) (use.c:151): forbidden when dark/blind/confused/amnesia. */
export function borgReadScroll(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): AgentCommand | null {
  if (trait(ctx, BI.LIGHT) <= 0) return null; /* no_light */
  if (
    trait(ctx, BI.ISBLIND) ||
    trait(ctx, BI.ISCONFUSED) ||
    trait(ctx, BI.ISFORGET)
  )
    return null;
  const item = borgSlot(ctx, TV.SCROLL, sval, d);
  if (!item) return null;
  return ctx.act.read(item.handle);
}

/** borg_read_unknown: read any unaware scroll (use.c:190). */
export function borgReadUnknown(
  ctx: BorgContext,
  d?: ItemDeps,
): AgentCommand | null {
  let n: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval !== TV.SCROLL) continue;
    if (isAware(item, d)) continue;
    n = item;
  }
  if (!n) return null;
  if (trait(ctx, BI.LIGHT) <= 0) return null;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return null;
  return ctx.act.read(n.handle);
}

/* ------------------------------------------------------------------ *
 * Food / mushrooms
 * ------------------------------------------------------------------ */

/** borg_eat(tval, sval) (use.c:248). */
export function borgEat(
  ctx: BorgContext,
  tval: number,
  sval: number,
  d?: ItemDeps,
): AgentCommand | null {
  const item = borgSlot(ctx, tval, sval, d);
  if (!item) return null;
  return ctx.act.eat(item.handle);
}

/** borg_eat_unknown: eat an unaware food/mushroom (emergency; use.c:277). */
export function borgEatUnknown(
  ctx: BorgContext,
  d?: ItemDeps,
): AgentCommand | null {
  let n: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval !== TV.FOOD && item.tval !== TV.MUSHROOM) continue;
    if (isAware(item, d)) continue;
    n = item;
  }
  return n ? ctx.act.eat(n.handle) : null;
}

/**
 * borg_eat_food_any: prevent starvation by any means (use.c:324). Ports the food
 * -> nourishing-potion -> negative-effect-potion (with resist) -> cure-potion
 * ladder. The C's borg_obj_has_effect(EF_NOURISH) filter for "okay" food is
 * approximated by "any aware FOOD/MUSHROOM" (effect data is not on ItemView);
 * this is a documented, conservative deviation.
 */
export function borgEatFoodAny(
  ctx: BorgContext,
  d?: ItemDeps,
): AgentCommand | null {
  /* "normal" food */
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0 || !isAware(item, d)) continue;
    if (item.tval !== TV.FOOD) continue;
    const cmd = borgEat(ctx, item.tval, item.sval, d);
    if (cmd) return cmd;
  }
  /* "okay" food (nourishing food/mushroom) */
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0 || !isAware(item, d)) continue;
    if (item.tval !== TV.FOOD && item.tval !== TV.MUSHROOM) continue;
    const cmd = borgEat(ctx, item.tval, item.sval, d);
    if (cmd) return cmd;
  }
  /* Pure-nutrition potion */
  let cmd = borgQuaffPotion(ctx, SVAL.potion.slime_mold!, d);
  if (cmd) return cmd;
  /* Nourishing-but-negative potions, only with the matching protection. */
  if (trait(ctx, BI.FRACT)) {
    cmd =
      borgQuaffPotion(ctx, SVAL.potion.sleep!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.slowness!, d);
    if (cmd) return cmd;
  }
  if (trait(ctx, BI.RBLIND)) {
    cmd = borgQuaffPotion(ctx, SVAL.potion.blindness!, d);
    if (cmd) return cmd;
  }
  if (trait(ctx, BI.RCONF)) {
    cmd = borgQuaffPotion(ctx, SVAL.potion.confusion!, d);
    if (cmd) return cmd;
  }
  /* Cure potions, when hurting (use.c:395). */
  if (
    trait(ctx, BI.CURHP) < 4 ||
    trait(ctx, BI.CURHP) <= trait(ctx, BI.MAXHP)
  ) {
    cmd =
      borgQuaffPotion(ctx, SVAL.potion.cure_light!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.cure_serious!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.cure_critical!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.healing!, d);
    if (cmd) return cmd;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Rods / staves / wands (device fail math)
 * ------------------------------------------------------------------ */

/** borg_equips_rod(sval): a charged rod that passes the fail check (use.c:411). */
export function borgEquipsRod(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): boolean {
  const item = borgSlot(ctx, TV.ROD, sval, d);
  if (!item) return false;
  if (!item.pval) return false;
  const fail = deviceFail(ctx, itemLevel(item, d));
  return fail <= 500;
}

/** borg_zap_rod(sval): zap a charged rod if it passes the fail check (use.c:451). */
export function borgZapRod(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): AgentCommand | null {
  const item = borgSlot(ctx, TV.ROD, sval, d);
  if (!item) return null;
  if (!item.pval) return null;
  const fail = deviceFail(ctx, itemLevel(item, d));
  /* Recall is exempt from the fail gate (use.c:481). */
  if (sval !== SVAL.rod.recall) {
    if (fail > 500) return null;
  }
  return ctx.act.zapRod(item.handle);
}

/** borg_use_staff(sval): use a charged staff (no fail gate; use.c:500). */
export function borgUseStaff(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): AgentCommand | null {
  const item = borgSlot(ctx, TV.STAFF, sval, d);
  if (!item) return null;
  if (!item.pval) return null;
  return ctx.act.useStaff(item.handle);
}

/** borg_use_unknown: use an unaware staff (emergency; use.c:529). */
export function borgUseUnknown(
  ctx: BorgContext,
  d?: ItemDeps,
): AgentCommand | null {
  let n: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval !== TV.STAFF) continue;
    if (isAware(item, d)) continue;
    n = item;
  }
  return n ? ctx.act.useStaff(n.handle) : null;
}

/** borg_use_staff_fail(sval): use with a fail check (teleport gets slack; use.c:577). */
export function borgUseStaffFail(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): AgentCommand | null {
  const item = borgSlot(ctx, TV.STAFF, sval, d);
  if (!item) return null;
  if (!item.pval) return null;
  const fail = deviceFail(ctx, itemLevel(item, d));
  if (fail > 500) {
    if (sval !== SVAL.staff.teleportation) return null;
    if (!trait(ctx, BI.ISCONFUSED) && !trait(ctx, BI.ISBLIND)) {
      if (fail > 500) return null;
    }
  }
  return ctx.act.useStaff(item.handle);
}

/** borg_equips_staff_fail(sval): a charged staff usable now (use.c:637). */
export function borgEquipsStaffFail(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): boolean {
  const item = borgSlot(ctx, TV.STAFF, sval, d);
  if (!item) return false;
  if (!item.pval) return false;
  const fail = deviceFail(ctx, itemLevel(item, d));
  /* Destruction is used in emergencies regardless (use.c:667). */
  if (sval === SVAL.staff.destruction) return true;
  if (fail > 500) {
    if (sval !== SVAL.staff.teleportation) return false;
    if (sval === SVAL.staff.teleportation && !trait(ctx, BI.ISCONFUSED)) {
      if (fail < 650) return false;
    }
  }
  return true;
}

/** borg_aim_wand(sval): aim a charged wand (use.c:695). */
export function borgAimWand(
  ctx: BorgContext,
  sval: number,
  d?: ItemDeps,
): AgentCommand | null {
  const item = borgSlot(ctx, TV.WAND, sval, d);
  if (!item) return null;
  if (!item.pval) return null;
  return ctx.act.aimWand(item.handle);
}

/* ------------------------------------------------------------------ *
 * Rings / dragon armour / artifact activations
 * ------------------------------------------------------------------ */

/** Equipment scan helper: worn items (equipment slots), skipping empties. */
function* equipment(ctx: BorgContext): Generator<ItemView> {
  for (const item of ctx.view.equipment()) {
    if (item && item.number > 0) yield item;
  }
}

/** borg_equips_ring(sval): a wielded, charged, IDd ring passing fail (use.c:725). */
export function borgEquipsRing(
  ctx: BorgContext,
  ringSval: number,
  d?: ItemDeps,
): boolean {
  for (const item of equipment(ctx)) {
    if (!isAware(item, d)) continue;
    if (item.tval !== TV.RING || item.sval !== ringSval) continue;
    if (item.timeout) continue;
    if (!isIdent(item, d)) continue;
    const fail = deviceFail(ctx, itemLevel(item, d));
    if (fail > 500) continue;
    return true;
  }
  return false;
}

/** borg_activate_ring(sval): activate a wielded, charged ring (use.c:780). */
export function borgActivateRing(
  ctx: BorgContext,
  ringSval: number,
  d?: ItemDeps,
): AgentCommand | null {
  for (const item of equipment(ctx)) {
    if (!isAware(item, d)) continue;
    if (item.tval !== TV.RING || item.sval !== ringSval) continue;
    if (item.timeout) continue;
    if (!isIdent(item, d)) continue;
    return ctx.act.activate(item.handle);
  }
  return null;
}

/** borg_equips_dragon(sval): worn dragon armour usable (use.c:824). */
export function borgEquipsDragon(
  ctx: BorgContext,
  dragSval: number,
  d?: ItemDeps,
): boolean {
  for (const item of equipment(ctx)) {
    if (!isAware(item, d)) continue;
    if (item.tval !== TV.DRAG_ARMOR || item.sval !== dragSval) continue;
    if (item.timeout) continue;
    if (!isIdent(item, d)) continue;
    const fail = deviceFail(ctx, itemLevel(item, d));
    if (fail > 500) return false;
    return true;
  }
  return false;
}

/** borg_activate_dragon(sval): activate worn dragon armour (use.c:891). */
export function borgActivateDragon(
  ctx: BorgContext,
  dragSval: number,
  d?: ItemDeps,
): AgentCommand | null {
  for (const item of equipment(ctx)) {
    if (!isAware(item, d)) continue;
    if (item.tval !== TV.DRAG_ARMOR || item.sval !== dragSval) continue;
    if (item.timeout) continue;
    if (!isIdent(item, d)) continue;
    return ctx.act.activate(item.handle);
  }
  return null;
}

/**
 * borg_activate_item(act): activate the equipped item bearing activation `act`
 * (use.c:928). The frozen ItemView exposes only a boolean `activation`, not its
 * index, so the specific item is resolved through the deps.activateItem seam
 * (default: none). Returns the activate command, or null.
 */
export function borgActivateItem(
  ctx: BorgContext,
  act: string,
  d?: ItemDeps,
): AgentCommand | null {
  const handle = activateHandle(act, d);
  if (handle === null) return null;
  return ctx.act.activate(handle);
}

/** borg_equips_item(act, checkCharge): an equipped item grants `act` (use.c:969). */
export function borgEquipsItem(
  ctx: BorgContext,
  act: string,
  checkCharge: boolean,
  d?: ItemDeps,
): boolean {
  return equipsItem(act, checkCharge, d);
}

/**
 * borg_activate_failure(tval, sval): relative fail number for activating a
 * carried item (use.c:1007). 100 when missing/uncharged/no activation.
 */
export function borgActivateFailure(
  ctx: BorgContext,
  tval: number,
  sval: number,
  d?: ItemDeps,
): number {
  const item = borgSlot(ctx, tval, sval, d);
  if (!item) return 100;
  if (!item.pval) return 100;
  if (!item.activation) return 100;
  return deviceFail(ctx, itemLevel(item, d));
}

/* ------------------------------------------------------------------ *
 * Composite: use_things / recharging
 * ------------------------------------------------------------------ */

/**
 * borg_use_things: use non-essential items opportunistically (use.c:1049).
 * Restore-exp, stat-gain potions, restore-stat, then force-quaff/read of a few
 * specific items, then eat when hungry. Faithful ladder; artifact-activation
 * branches (act_*) go through the deps seam and no-op without it.
 */
export function borgUseThings(
  ctx: BorgContext,
  d?: ItemDeps,
): AgentCommand | null {
  const P = SVAL.potion;
  const M = SVAL.mush;
  const inTown = trait(ctx, BI.CDEPTH) === 0;

  /* Restore experience. */
  if (trait(ctx, BI.ISFIXEXP)) {
    const cmd =
      borgSpell(ctx, Spell.REVITALIZE) ||
      borgSpell(ctx, Spell.REMEMBRANCE) ||
      (trait(ctx, BI.CURHP) > 90
        ? borgSpell(ctx, Spell.UNHOLY_REPRIEVE)
        : null) ||
      borgActivateItem(ctx, "act_restore_exp", d) ||
      borgActivateItem(ctx, "act_restore_st_lev", d) ||
      borgActivateItem(ctx, "act_restore_life", d) ||
      borgQuaffPotion(ctx, P.restore_life!, d);
    if (cmd) return cmd;
  }

  /* Drink the stat gains outright (use.c:1064). */
  {
    const cmd =
      borgQuaffPotion(ctx, P.inc_str!, d) ||
      borgQuaffPotion(ctx, P.inc_int!, d) ||
      borgQuaffPotion(ctx, P.inc_wis!, d) ||
      borgQuaffPotion(ctx, P.inc_dex!, d) ||
      borgQuaffPotion(ctx, P.inc_con!, d);
    if (cmd) return cmd;
  }

  /* Restore drained stats (use.c:1073). */
  {
    const cmd =
      (trait(ctx, BI.ISFIXSTR) &&
        (borgQuaffPotion(ctx, P.inc_str!, d) ||
          borgEat(ctx, TV.MUSHROOM, M.purging!, d) ||
          borgActivateItem(ctx, "act_shroom_purging", d) ||
          borgActivateItem(ctx, "act_restore_str", d) ||
          borgActivateItem(ctx, "act_restore_all", d) ||
          borgEat(ctx, TV.MUSHROOM, M.restoring!, d))) ||
      (trait(ctx, BI.ISFIXINT) &&
        (borgQuaffPotion(ctx, P.inc_int!, d) ||
          borgActivateItem(ctx, "act_restore_int", d) ||
          borgActivateItem(ctx, "act_restore_all", d) ||
          borgEat(ctx, TV.MUSHROOM, M.restoring!, d))) ||
      (trait(ctx, BI.ISFIXWIS) &&
        (borgQuaffPotion(ctx, P.inc_wis!, d) ||
          borgActivateItem(ctx, "act_restore_wis", d) ||
          borgActivateItem(ctx, "act_restore_all", d) ||
          borgEat(ctx, TV.MUSHROOM, M.restoring!, d))) ||
      (trait(ctx, BI.ISFIXDEX) &&
        (borgQuaffPotion(ctx, P.inc_dex!, d) ||
          borgActivateItem(ctx, "act_restore_dex", d) ||
          borgActivateItem(ctx, "act_restore_all", d) ||
          borgEat(ctx, TV.MUSHROOM, M.restoring!, d))) ||
      (trait(ctx, BI.ISFIXCON) &&
        (borgQuaffPotion(ctx, P.inc_con!, d) ||
          borgActivateItem(ctx, "act_restore_con", d) ||
          borgActivateItem(ctx, "act_restore_all", d) ||
          borgEat(ctx, TV.MUSHROOM, M.purging!, d) ||
          borgActivateItem(ctx, "act_shroom_purging", d) ||
          borgEat(ctx, TV.MUSHROOM, M.restoring!, d)));
    if (cmd) return cmd;
  }

  /* Force-use a few specific items (use.c:1106). */
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0 || !isAware(item, d)) continue;
    if (item.tval === TV.POTION) {
      if (item.sval === P.enlightenment) {
        if (inTown) continue; /* never in town */
      } else if (item.sval === P.inc_all) {
        const cmd = borgQuaffPotion(ctx, item.sval, d);
        if (cmd) return cmd;
      }
    } else if (item.tval === TV.SCROLL) {
      if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) continue;
      if (
        item.sval === SVAL.scroll.mapping ||
        item.sval === SVAL.scroll.acquirement ||
        item.sval === SVAL.scroll.star_acquirement
      ) {
        if (inTown) continue;
        const cmd = borgReadScroll(ctx, item.sval, d);
        if (cmd) return cmd;
      }
    }
  }

  /* Eat when hungry (use.c:1154). */
  if (trait(ctx, BI.ISHUNGRY)) {
    const cmd =
      borgSpell(ctx, Spell.REMOVE_HUNGER) ||
      borgSpell(ctx, Spell.HERBAL_CURING) ||
      borgQuaffPotion(ctx, P.slime_mold!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.slime_mold!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.slice!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.apple!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.pint!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.handful!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.honey_cake!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.ration!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.waybread!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.draught!, d) ||
      borgActivateItem(ctx, "act_food_waybread", d);
    if (cmd) return cmd;
  }

  return null;
}

/**
 * borg_recharging: recharge a wand/staff that needs it (use.c:1182). Selects the
 * first eligible item (per the C's charge rules) and, if a recharge means
 * exists, emits it. The C then presses the item letter; here the recharge verb
 * (scroll read / spell / activation) IS the command and the target-item choice
 * is deferred to the engine menu (a documented simplification).
 */
export function borgRecharging(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return null;

  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (!isIdent(item, d) || !isAware(item, d)) continue;

    let charge = false;
    if (item.tval === TV.WAND && item.pval <= 1) charge = true;
    if (item.tval === TV.STAFF) {
      if (
        item.pval < 2 &&
        borgSpellOkayFail(ctx, Spell.RECHARGING, 96, playerHas) &&
        item.sval < SVAL.staff.power!
      )
        charge = true;
      if (item.pval <= 1) charge = true;
      if (
        item.sval === SVAL.staff.teleportation &&
        item.pval < 3 &&
        trait(ctx, BI.CDEPTH) === 0
      )
        charge = true;
      if (item.number + item.pval >= 4 && item.pval >= 1) charge = false;
    }
    if (!charge) continue;

    const cmd =
      borgReadScroll(ctx, SVAL.scroll.recharging!, d) ||
      borgSpellFail(ctx, Spell.RECHARGING, 96, playerHas) ||
      borgActivateItem(ctx, "act_recharge", d);
    /* If we can recharge, target this item; else stop (C breaks). */
    if (cmd) return cmd;
    break;
  }
  return null;
}
