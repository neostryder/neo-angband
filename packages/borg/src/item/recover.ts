/**
 * Post-battle recovery - a faithful port of borg_recover (borg-recover.c:59).
 *
 * The "rest/heal decision": rest, cure, or heal to full before proceeding. The
 * companion borgFlowRecover (movement to a safe grid) already exists; this is the
 * consumption/rest half. Returns an AgentCommand (or null when nothing to do).
 *
 * borg_danger (P8.2) is taken as deps.danger (default 0), never imported. The
 * regional borg_fear_region and borg_check_rest come from deps (fearRegion,
 * canRest). The paranoia roll uses ctx.rng (deterministic).
 */

import type { BorgContext, AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import { GOAL_RECOVER } from "../world/model";
import { getDerived, has } from "../trait/state";
import { SVAL, TV } from "./svals";
import type { ItemDeps } from "./deps";
import {
  trait,
  danger,
  avoidance,
  canRest,
  clockOf,
  borgSlot,
} from "./deps";
import { Spell, borgSpell, borgSpellOkay } from "./magic";
import {
  borgActivateItem,
  borgQuaffCrit,
  borgQuaffPotion,
  borgReadScroll,
  borgEat,
  borgUseStaffFail,
  borgZapRod,
} from "./item-use";
import { borgMaintainLight, borgCheckLightOnly, BorgNeed } from "./light";

/**
 * borg_recover: try, in the C's exact order, spells/prayers (free), then cheap
 * cures, then expensive cures, then resting. Returns the chosen command or null.
 */
export function borgRecover(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  /*** Annoying situations: light ***/
  const light = borgMaintainLight(ctx, d);
  if (light.need === BorgNeed.MET_NEED && light.cmd) return light.cmd;

  /*** Do not recover when in danger ***/
  const p = danger(d);
  if (p > Math.trunc(avoidance(d) / 4)) return null;

  /*** Paranoia roll ***/
  let q = ctx.rng.randint0(100);
  if (trait(ctx, BI.CURHP) < Math.trunc(trait(ctx, BI.MAXHP) / 2)) q -= 10;
  if (trait(ctx, BI.CURHP) < Math.trunc(trait(ctx, BI.MAXHP) / 4)) q -= 10;

  const D = getDerived(ctx.world);

  /*** Cheap cures ***/

  /* Cure stun */
  if (trait(ctx, BI.ISSTUN) && q < 75) {
    const cmd =
      borgActivateItem(ctx, "act_cure_body", d) ||
      borgActivateItem(ctx, "act_cure_critical", d) ||
      borgActivateItem(ctx, "act_cure_full", d) ||
      borgActivateItem(ctx, "act_cure_full2", d) ||
      borgActivateItem(ctx, "act_cure_temp", d) ||
      borgActivateItem(ctx, "act_heal3", d) ||
      borgSpell(ctx, Spell.MINOR_HEALING) ||
      borgSpell(ctx, Spell.HEALING) ||
      borgSpell(ctx, Spell.HERBAL_CURING) ||
      borgSpell(ctx, Spell.HOLY_WORD);
    if (cmd) return cmd;
  }

  /* Cure heavy stun */
  if (trait(ctx, BI.ISHEAVYSTUN)) {
    const cmd =
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.fast_recovery!, d) ||
      borgActivateItem(ctx, "act_cure_body", d) ||
      borgActivateItem(ctx, "act_cure_critical", d) ||
      borgActivateItem(ctx, "act_cure_full", d) ||
      borgActivateItem(ctx, "act_cure_full2", d) ||
      borgActivateItem(ctx, "act_cure_temp", d) ||
      borgActivateItem(ctx, "act_heal3", d) ||
      borgSpell(ctx, Spell.MINOR_HEALING) ||
      borgSpell(ctx, Spell.HEALING) ||
      borgSpell(ctx, Spell.HERBAL_CURING) ||
      borgSpell(ctx, Spell.HOLY_WORD);
    if (cmd) return cmd;
  }

  /* Cure cuts */
  if (trait(ctx, BI.ISCUT) && q < 75) {
    const cmd =
      borgActivateItem(ctx, "act_cure_light", d) ||
      borgSpell(ctx, Spell.MINOR_HEALING) ||
      borgSpell(ctx, Spell.HEALING) ||
      borgSpell(ctx, Spell.HERBAL_CURING) ||
      borgSpell(ctx, Spell.HOLY_WORD);
    if (cmd) return cmd;
  }

  /* Cure poison */
  if (trait(ctx, BI.ISPOISONED) && q < 75) {
    const cmd =
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.fast_recovery!, d) ||
      borgActivateItem(ctx, "act_rem_fear_pois", d) ||
      borgSpell(ctx, Spell.HERBAL_CURING) ||
      borgSpell(ctx, Spell.CURE_POISON);
    if (cmd) return cmd;
  }

  /* Cure fear */
  if (trait(ctx, BI.ISAFRAID) && !trait(ctx, BI.CRSFEAR) && q < 75) {
    const cmd =
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.cure_mind!, d) ||
      borgActivateItem(ctx, "act_rem_fear_pois", d) ||
      borgSpell(ctx, Spell.HEROISM) ||
      borgSpell(ctx, Spell.BERSERK_STRENGTH) ||
      borgSpell(ctx, Spell.HOLY_WORD);
    if (cmd) return cmd;
  }

  /* Satisfy hunger */
  if ((trait(ctx, BI.ISHUNGRY) || trait(ctx, BI.ISWEAK)) && q < 75) {
    const cmd =
      borgSpell(ctx, Spell.REMOVE_HUNGER) || borgSpell(ctx, Spell.HERBAL_CURING);
    if (cmd) return cmd;
  }

  /* Hallucination */
  if (trait(ctx, BI.ISIMAGE) && q < 75) {
    const cmd = borgEat(ctx, TV.MUSHROOM, SVAL.mush.cure_mind!, d);
    if (cmd) return cmd;
  }

  /* Heal damage (cheap) */
  if (
    trait(ctx, BI.CURHP) < Math.trunc(trait(ctx, BI.MAXHP) / 2) &&
    q < 75 &&
    p === 0 &&
    trait(ctx, BI.CURSP) > Math.trunc(trait(ctx, BI.MAXSP) / 4)
  ) {
    const cmd =
      borgActivateItem(ctx, "act_heal1", d) ||
      borgActivateItem(ctx, "act_heal2", d) ||
      borgActivateItem(ctx, "act_heal3", d) ||
      borgSpell(ctx, Spell.HEALING) ||
      borgSpell(ctx, Spell.HOLY_WORD) ||
      borgSpell(ctx, Spell.MINOR_HEALING) ||
      borgSpell(ctx, Spell.HEROISM);
    if (cmd) return cmd;
  }

  /* Cure experience loss */
  if (trait(ctx, BI.ISFIXEXP)) {
    const cmd =
      borgActivateItem(ctx, "act_restore_exp", d) ||
      borgActivateItem(ctx, "act_restore_st_lev", d) ||
      borgActivateItem(ctx, "act_restore_life", d) ||
      borgSpell(ctx, Spell.REVITALIZE) ||
      borgSpell(ctx, Spell.REMEMBRANCE) ||
      (trait(ctx, BI.CURHP) > 90 ? borgSpell(ctx, Spell.UNHOLY_REPRIEVE) : null);
    if (cmd) return cmd;
  }

  /* Cure stat drain */
  if (
    trait(ctx, BI.ISFIXSTR) ||
    trait(ctx, BI.ISFIXINT) ||
    trait(ctx, BI.ISFIXWIS) ||
    trait(ctx, BI.ISFIXDEX) ||
    trait(ctx, BI.ISFIXCON) ||
    trait(ctx, BI.ISFIXALL)
  ) {
    const cmd =
      borgSpell(ctx, Spell.RESTORATION) || borgSpell(ctx, Spell.REVITALIZE);
    if (cmd) return cmd;
  }
  if (
    (trait(ctx, BI.ISFIXSTR) ||
      trait(ctx, BI.ISFIXINT) ||
      trait(ctx, BI.ISFIXCON)) &&
    trait(ctx, BI.CURHP) > 90
  ) {
    const cmd = borgSpell(ctx, Spell.UNHOLY_REPRIEVE);
    if (cmd) return cmd;
  }

  /*** Expensive cures ***/

  /* Cure stun */
  if (trait(ctx, BI.ISSTUN) && q < 25) {
    const cmd =
      borgUseStaffFail(ctx, SVAL.staff.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.healing!, d) ||
      borgActivateItem(ctx, "act_heal1", d) ||
      borgActivateItem(ctx, "act_heal2", d) ||
      borgQuaffCrit(ctx, false, d);
    if (cmd) return cmd;
  }

  /* Cure heavy stun */
  if (trait(ctx, BI.ISHEAVYSTUN) && q < 95) {
    const cmd =
      borgQuaffCrit(ctx, true, d) ||
      borgUseStaffFail(ctx, SVAL.staff.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.healing!, d) ||
      borgActivateItem(ctx, "act_heal1", d) ||
      borgActivateItem(ctx, "act_heal2", d);
    if (cmd) return cmd;
  }

  /* Cure cuts */
  if (trait(ctx, BI.ISCUT) && q < 25) {
    const cmd =
      borgUseStaffFail(ctx, SVAL.staff.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.healing!, d) ||
      borgActivateItem(ctx, "act_heal1", d) ||
      borgActivateItem(ctx, "act_heal2", d) ||
      borgQuaffCrit(ctx, trait(ctx, BI.CURHP) < 10, d);
    if (cmd) return cmd;
  }

  /* Cure poison */
  if (trait(ctx, BI.ISPOISONED) && q < 25) {
    const cmd =
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.fast_recovery!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.cure_poison!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.waybread!, d) ||
      borgQuaffCrit(ctx, trait(ctx, BI.CURHP) < 10, d) ||
      borgUseStaffFail(ctx, SVAL.staff.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.curing!, d) ||
      borgActivateItem(ctx, "act_rem_fear_pois", d) ||
      borgActivateItem(ctx, "act_food_waybread", d);
    if (cmd) return cmd;
  }

  /* Cure blindness */
  if (trait(ctx, BI.ISBLIND) && q < 25) {
    const cmd =
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.fast_recovery!, d) ||
      borgEat(ctx, TV.FOOD, SVAL.food.waybread!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.cure_light!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.cure_serious!, d) ||
      borgQuaffCrit(ctx, false, d) ||
      borgUseStaffFail(ctx, SVAL.staff.curing!, d) ||
      borgZapRod(ctx, SVAL.rod.curing!, d) ||
      borgActivateItem(ctx, "act_food_waybread", d);
    if (cmd) return cmd;
  }

  /* Cure confusion */
  if (trait(ctx, BI.ISCONFUSED) && q < 25) {
    const cmd =
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.cure_mind!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.cure_serious!, d) ||
      borgQuaffCrit(ctx, false, d) ||
      borgUseStaffFail(ctx, SVAL.staff.curing!, d) ||
      borgActivateItem(ctx, "act_cure_confusion", d) ||
      borgZapRod(ctx, SVAL.rod.curing!, d);
    if (cmd) return cmd;
  }

  /* Cure fear */
  if (trait(ctx, BI.ISAFRAID) && !trait(ctx, BI.CRSFEAR) && q < 25) {
    const cmd =
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.cure_mind!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.boldness!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.heroism!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.berserk!, d) ||
      borgActivateItem(ctx, "act_rem_fear_pois", d);
    if (cmd) return cmd;
  }

  /* Satisfy hunger (expensive) */
  if ((trait(ctx, BI.ISHUNGRY) || trait(ctx, BI.ISWEAK)) && q < 25) {
    const cmd =
      borgReadScroll(ctx, SVAL.scroll.satisfy_hunger!, d) ||
      borgActivateItem(ctx, "act_satisfy", d);
    if (cmd) return cmd;
  }

  /* Heal damage (expensive) */
  if (trait(ctx, BI.CURHP) < Math.trunc(trait(ctx, BI.MAXHP) / 2) && q < 25) {
    const cmd =
      borgZapRod(ctx, SVAL.rod.healing!, d) ||
      borgQuaffPotion(ctx, SVAL.potion.cure_serious!, d) ||
      borgQuaffCrit(ctx, false, d) ||
      borgActivateItem(ctx, "act_cure_serious", d);
    if (cmd) return cmd;
  }

  /*** Resting ***/
  const fearRegion = d?.fearRegion ?? Number.MAX_SAFE_INTEGER;

  /* Rest to recharge Rods of Healing or Recall (recover.c:319). */
  if (has(D, "rod_recall") || has(D, "rod_healing")) {
    const healRod = borgSlot(ctx, TV.ROD, SVAL.rod.healing!, d);
    const recallRod = borgSlot(ctx, TV.ROD, SVAL.rod.recall!, d);
    const needCharge =
      (has(D, "rod_healing") && healRod !== null && !healRod.pval) ||
      (has(D, "rod_recall") && recallRod !== null && !recallRod.pval);
    if (needCharge) {
      if (
        !trait(ctx, BI.ISWEAK) &&
        !trait(ctx, BI.ISCUT) &&
        !trait(ctx, BI.ISHUNGRY) &&
        !trait(ctx, BI.ISPOISONED) &&
        canRest(d) &&
        !borgSpellOkay(ctx, Spell.RECHARGING)
      ) {
        ctx.world.self.timeThisPanel = 0;
        return ctx.act.rest();
      }
    }
  }

  /* Rest until healed (recover.c:357). */
  if (
    !trait(ctx, BI.ISBLIND) &&
    !trait(ctx, BI.ISPOISONED) &&
    !trait(ctx, BI.ISCUT) &&
    !trait(ctx, BI.ISWEAK) &&
    !trait(ctx, BI.ISHUNGRY) &&
    (trait(ctx, BI.ISCONFUSED) ||
      trait(ctx, BI.ISIMAGE) ||
      trait(ctx, BI.ISAFRAID) ||
      trait(ctx, BI.ISSTUN) ||
      trait(ctx, BI.ISHEAVYSTUN) ||
      trait(ctx, BI.CURHP) < trait(ctx, BI.MAXHP) ||
      trait(ctx, BI.CURSP) <
        Math.trunc(
          (trait(ctx, BI.MAXSP) * (trait(ctx, BI.CDEPTH) > 85 ? 7 : 6)) / 10,
        ))
  ) {
    if (
      canRest(d) &&
      !ctx.world.facts.scaryGuyOnLevel &&
      p <= fearRegion &&
      ctx.world.self.goal.type !== GOAL_RECOVER
    ) {
      /* Light a dark room first, else rest. */
      const lightCmd = borgCheckLightOnly(ctx, d, playerHas);
      if (lightCmd) return lightCmd;
      ctx.world.self.timeThisPanel = 0;
      ctx.world.self.temp.needSeeInvis = clockOf(ctx, d) - 50;
      return ctx.act.rest();
    }
  }

  /* Recharge mana: low-level mage/priest (recover.c:399). */
  if (
    trait(ctx, BI.MAXSP) &&
    (trait(ctx, BI.CLEVEL) <= 40 || trait(ctx, BI.CDEPTH) >= 85) &&
    trait(ctx, BI.CURSP) < Math.trunc((trait(ctx, BI.MAXSP) * 8) / 10) &&
    p < Math.trunc((avoidance(d) * 1) / 10) &&
    canRest(d)
  ) {
    if (
      !trait(ctx, BI.ISWEAK) &&
      !trait(ctx, BI.ISCUT) &&
      !trait(ctx, BI.ISHUNGRY) &&
      !trait(ctx, BI.ISPOISONED) &&
      trait(ctx, BI.FOOD) > 2 &&
      !ctx.world.self.munchkinMode
    ) {
      return ctx.act.rest();
    }
  }

  return null;
}
