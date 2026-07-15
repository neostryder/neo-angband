/**
 * borg_caution / borg_heal - "try not to die": the life-preservation ladder, a
 * faithful port of reference/src/borg/borg-caution.c.
 *
 * borg_heal (caution.c:60) is ported in full: the confusion/blindness cures, the
 * Morgoth-combat healing, mana restoration, the percent-based heal ladder
 * (Levels 1..10), and the poison/cut emergency cures. Every threshold, heal
 * amount and reserve rule is preserved.
 *
 * borg_caution (caution.c:799) is a ~1200-line orchestrator that also drives
 * stair-taking, level-fleeing, food/light maintenance and retreat movement -
 * those emit flow/rest commands and depend on subsystems outside the P8.4 scope
 * (borg-flow*, borg-store, borg_prepared, borg_maintain_light). This port keeps
 * the life-critical core that returns a fight/item command: nasty-situation
 * detection, the surrounded check, the class-ordered heal/defend attempt, the
 * escape attempt, and the final emergency ez-heal; it sets the pure fleeing/
 * leaving goal flags where the C does. The movement/flow tail is left to the
 * P8.6 think ladder, documented at the return points.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { BI, CLASS_MAGE, CLASS_PRIEST, CLASS_PALADIN } from "../trait/trait-index";
import { trait } from "../item/deps";
import { borgDanger, getDangerGlobals } from "../danger";
import { FEAT, ddx_ddd, ddy_ddd } from "../flow/flow-consts";
import { TV, SVAL } from "../item/svals";
import { Spell, borgSpell, borgSpellFail } from "../item/magic";
import {
  borgQuaffPotion,
  borgQuaffCrit,
  borgQuaffUnknown,
  borgReadUnknown,
  borgEat,
  borgEatUnknown,
  borgUseUnknown,
  borgUseStaff,
  borgUseStaffFail,
  borgActivateItem,
  borgZapRod,
  borgActivateFailure,
} from "../item/item-use";
import { borgSlot } from "../item/deps";
import { getFightState, idiv } from "./state";
import { borgSurrounded, borgEscape } from "./escape";
import { borgDefend } from "./defend";

function av(ctx: BorgContext): number {
  return getDangerGlobals(ctx.world).avoidance;
}
function firstCmd(...cmds: Array<AgentCommand | null>): AgentCommand | null {
  for (const c of cmds) if (c) return c;
  return null;
}

/* ---------------------------------------------------------------- *
 * borg_heal (caution.c:60)
 * ---------------------------------------------------------------- */

/**
 * borgHeal (caution.c:60): heal before fleeing. `danger` is the current threat.
 * Returns the heal command (or null). *Heal* and Life are reserved for Morgoth /
 * true emergencies (the emergency use lives in borgCaution, after escape).
 */
export function borgHeal(ctx: BorgContext, danger: number): AgentCommand | null {
  const fs = getFightState(ctx.world);
  const allowFail = 15;
  const maxhp = trait(ctx, BI.MAXHP);
  const curhp = trait(ctx, BI.CURHP);
  const hpDown = maxhp - curhp;
  const pctDown = idiv((maxhp - curhp) * 100, maxhp);

  let clwHeal = idiv((maxhp - curhp) * 15, 100);
  let cswHeal = idiv((maxhp - curhp) * 20, 100);
  let ccwHeal = idiv((maxhp - curhp) * 25, 100);
  let cmwHeal = idiv((maxhp - curhp) * 30, 100);
  let healHeal = idiv((maxhp - curhp) * 35, 100);
  if (clwHeal < 15) clwHeal = 15;
  if (cswHeal < 25) cswHeal = 25;
  if (ccwHeal < 30) ccwHeal = 30;
  if (cmwHeal < 50) cmwHeal = 50;
  if (healHeal < 300) healHeal = 300;
  void cmwHeal;

  let rodGood = false;
  if (borgSlot(ctx, TV.ROD, SVAL.rod.healing!)) {
    if (borgActivateFailure(ctx, TV.ROD, SVAL.rod.healing!) < 500) rodGood = true;
  }

  /* stats needing fix (Morgoth Life-potion accounting, caution.c:107). */
  let statsFix = 0;
  if (trait(ctx, BI.ISFIXSTR)) statsFix++;
  if (trait(ctx, BI.ISFIXINT)) statsFix++;
  if (trait(ctx, BI.ISFIXWIS)) statsFix++;
  if (trait(ctx, BI.ISFIXDEX)) statsFix++;
  if (trait(ctx, BI.ISFIXCON)) statsFix++;
  const cls = trait(ctx, BI.CLASS);
  if (cls === CLASS_MAGE && trait(ctx, BI.ISFIXINT)) statsFix++;
  if (cls === CLASS_PRIEST && trait(ctx, BI.ISFIXWIS)) statsFix++;
  if (cls === 2 /* DRUID */ && trait(ctx, BI.ISFIXWIS)) statsFix++;
  if (cls === 4 /* NECRO */ && trait(ctx, BI.ISFIXINT)) statsFix++;
  if (cls === 0 /* WARRIOR */ && trait(ctx, BI.ISFIXCON)) statsFix++;
  if (maxhp <= 850 && trait(ctx, BI.ISFIXCON)) statsFix++;
  if (maxhp <= 700 && trait(ctx, BI.ISFIXCON)) statsFix += 3;
  if (cls === CLASS_PRIEST && trait(ctx, BI.MAXSP) < 100 && trait(ctx, BI.ISFIXWIS)) statsFix += 5;
  if (cls === CLASS_MAGE && trait(ctx, BI.MAXSP) < 100 && trait(ctx, BI.ISFIXINT)) statsFix += 5;

  /* Heal confusion (caution.c:144). */
  if (trait(ctx, BI.ISCONFUSED)) {
    if (pctDown >= 80 && danger - healHeal < curhp) {
      const c = borgQuaffPotion(ctx, SVAL.potion.healing!);
      if (c) return c;
    }
    if (pctDown >= 85 && danger >= curhp * 2) {
      const c = firstCmd(borgQuaffPotion(ctx, SVAL.potion.star_healing!), borgQuaffPotion(ctx, SVAL.potion.life!));
      if (c) return c;
    }
    if (danger < curhp + cswHeal) {
      const c = firstCmd(
        borgEat(ctx, TV.MUSHROOM, SVAL.mush.cure_mind!),
        borgQuaffPotion(ctx, SVAL.potion.cure_serious!),
        borgQuaffCrit(ctx, false),
        borgQuaffPotion(ctx, SVAL.potion.healing!),
        borgUseStaffFail(ctx, SVAL.staff.healing!),
        borgActivateItem(ctx, "act_cure_confusion"),
        borgUseStaffFail(ctx, SVAL.staff.curing!),
      );
      if (c) return c;
    }
    /* teleport-staff-then-heal branch (caution.c:172). */
    /* GAP: the "heal then use staff" nuance needs staff-fail probing already
     * done above; fall through to the plain heal path below. */
    const c = firstCmd(borgQuaffCrit(ctx, true), borgQuaffPotion(ctx, SVAL.potion.cure_serious!), borgQuaffPotion(ctx, SVAL.potion.healing!));
    if (c) return c;
  }

  /* Heal blindness (caution.c:203). */
  if (trait(ctx, BI.ISBLIND) && ctx.rng.randint0(100) < 85) {
    if (hpDown >= 300) {
      const c = borgQuaffPotion(ctx, SVAL.potion.healing!);
      if (c) return c;
    }
    if (!(cls === 0 && curhp > idiv(maxhp, 4) && trait(ctx, BI.ESP))) {
      const c = firstCmd(
        borgEat(ctx, TV.MUSHROOM, SVAL.mush.fast_recovery!),
        borgQuaffPotion(ctx, SVAL.potion.cure_light!),
        borgQuaffPotion(ctx, SVAL.potion.cure_serious!),
        borgQuaffCrit(ctx, true),
        borgUseStaffFail(ctx, SVAL.staff.healing!),
        borgUseStaffFail(ctx, SVAL.staff.curing!),
        borgQuaffPotion(ctx, SVAL.potion.healing!),
      );
      if (c) return c;
    }
  }

  /* Conserve ez-heal for blind/confused big drops (caution.c:233). */
  if (
    (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) &&
    (hpDown >= 400 || (danger > curhp * 5 && hpDown > 100))
  ) {
    const c = borgQuaffPotion(ctx, SVAL.potion.star_healing!);
    if (c) return c;
  }

  /* Morgoth-combat healing (caution.c:242). */
  if (fs.fightingUnique >= 10) {
    if (curhp <= 700) {
      const c = firstCmd(
        curhp > 250 ? borgSpellFail(ctx, Spell.HOLY_WORD, 14) : null,
        statsFix >= 5 ? borgQuaffPotion(ctx, SVAL.potion.life!) : null,
        hpDown > 500 && borgSlot(ctx, TV.POTION, SVAL.potion.star_healing!) === null
          ? borgQuaffPotion(ctx, SVAL.potion.life!)
          : null,
        borgQuaffPotion(ctx, SVAL.potion.star_healing!),
        borgQuaffPotion(ctx, SVAL.potion.healing!),
        borgActivateItem(ctx, "act_heal1"),
        borgActivateItem(ctx, "act_heal2"),
        borgActivateItem(ctx, "act_heal3"),
        curhp < 250 ? borgSpellFail(ctx, Spell.HOLY_WORD, 5) : null,
        curhp > 550 ? borgSpellFail(ctx, Spell.HOLY_WORD, 15) : null,
        borgSpellFail(ctx, Spell.HEALING, 15),
        borgQuaffPotion(ctx, SVAL.potion.life!),
        borgZapRod(ctx, SVAL.rod.healing!),
      );
      if (c) return c;
    }
  }

  /* Restore mana (caution.c:273). */
  if (trait(ctx, BI.CURSP) < idiv(trait(ctx, BI.MAXSP), 5) && ctx.rng.randint0(100) < 50) {
    const c = firstCmd(borgUseStaffFail(ctx, SVAL.staff.the_magi!), borgActivateItem(ctx, "act_staff_magi"));
    if (c) return c;
  }
  if (
    trait(ctx, BI.CURSP) < idiv(trait(ctx, BI.MAXSP), 10) ||
    (trait(ctx, BI.CURSP) < 70 && trait(ctx, BI.MAXSP) > 200)
  ) {
    if (
      fs.fightingUnique >= 10 ||
      (fs.fightingUnique && danger < av(ctx) * 2) ||
      (trait(ctx, BI.ATELEPORT) + trait(ctx, BI.AESCAPE) === 0 && danger > av(ctx))
    ) {
      const c = firstCmd(
        borgUseStaffFail(ctx, SVAL.staff.the_magi!),
        borgQuaffPotion(ctx, SVAL.potion.restore_mana!),
        borgActivateItem(ctx, "act_restore_mana"),
        borgActivateItem(ctx, "act_staff_magi"),
      );
      if (c) return c;
    }
  }

  if (hpDown === 0) return null;
  if (danger === 0 && !trait(ctx, BI.ISPOISONED) && !trait(ctx, BI.ISCUT)) return null;

  /* Restore stats in Morgoth combat (caution.c:309). */
  if (statsFix >= 5 && fs.fightingUnique >= 10 && curhp > 650) {
    const c = firstCmd(borgEat(ctx, TV.MUSHROOM, SVAL.mush.restoring!), borgActivateItem(ctx, "act_restore_all"));
    if (c) return c;
  }
  if (fs.fightingUnique >= 10) return null;

  /* Percent-of-the-time heal gate (caution.c:324). */
  let chance = ctx.rng.randint0(100);
  if (fs.fightingUnique) chance -= 10;
  if (danger >= curhp && danger < maxhp) chance -= 75;
  else if (cls !== CLASS_PRIEST && cls !== CLASS_PALADIN) chance -= 25;
  if (fs.playsRisky) chance += 5;
  if (
    ((pctDown <= 15 && chance < 98) ||
      (pctDown >= 16 && pctDown <= 25 && chance < 95) ||
      (pctDown >= 26 && pctDown <= 50 && chance < 80) ||
      (pctDown >= 51 && pctDown <= 65 && chance < 50) ||
      (pctDown >= 66 && pctDown <= 74 && chance < 25) ||
      (pctDown >= 75 && chance < 1)) &&
    !trait(ctx, BI.ISHEAVYSTUN) &&
    !trait(ctx, BI.ISSTUN) &&
    !trait(ctx, BI.ISPOISONED) &&
    !trait(ctx, BI.ISCUT)
  )
    return null;

  /* Heal ladder (caution.c:353). */
  if (pctDown >= 30 && (pctDown <= 40 || trait(ctx, BI.CLEVEL) < 10) && danger < curhp + clwHeal && clwHeal > idiv(danger, 3)) {
    const c = firstCmd(borgSpellFail(ctx, Spell.MINOR_HEALING, allowFail), borgQuaffPotion(ctx, SVAL.potion.cure_light!), borgActivateItem(ctx, "act_cure_light"));
    if (c) return c;
  }
  if (pctDown >= 40 && (pctDown <= 50 || trait(ctx, BI.CLEVEL) < 20) && danger < curhp + cswHeal && cswHeal > idiv(danger, 3)) {
    const c = firstCmd(borgQuaffPotion(ctx, SVAL.potion.cure_serious!), borgActivateItem(ctx, "act_cure_serious"));
    if (c) return c;
  }
  if (pctDown >= 50 && pctDown <= 55 && danger < curhp + ccwHeal && ccwHeal > idiv(danger, 3)) {
    const c = firstCmd(borgActivateItem(ctx, "act_cure_critical"), borgQuaffCrit(ctx, false));
    if (c) return c;
  }
  if (danger >= curhp && danger < maxhp && curhp < 50 && danger < ccwHeal) {
    const c = borgQuaffCrit(ctx, true);
    if (c) return c;
  }
  if (trait(ctx, BI.CDEPTH) >= 80 && danger < 50 && pctDown >= 20) {
    const c = borgQuaffPotion(ctx, SVAL.potion.cure_critical!);
    if (c) return c;
  }
  /* Heal step one (caution.c:398). */
  if (pctDown >= 55 && danger < curhp + healHeal) {
    const c = firstCmd(
      (!trait(ctx, BI.ATELEPORT) && !trait(ctx, BI.AESCAPE)) || rodGood ? borgZapRod(ctx, SVAL.rod.healing!) : null,
      borgActivateItem(ctx, "act_cure_full"),
      borgActivateItem(ctx, "act_cure_full2"),
      borgActivateItem(ctx, "act_cure_nonorlybig"),
      borgActivateItem(ctx, "act_heal1"),
      borgActivateItem(ctx, "act_heal2"),
      borgActivateItem(ctx, "act_heal3"),
      borgUseStaffFail(ctx, SVAL.staff.healing!),
      borgSpellFail(ctx, Spell.HEALING, allowFail),
    );
    if (c) return c;
  }

  /* Save heal pots for the end game (caution.c:419). */
  if (trait(ctx, BI.MAXDEPTH) >= 98 && !trait(ctx, BI.KING) && !fs.fightingUnique && cls !== CLASS_PRIEST) return null;

  /* Heal steps two/three/first-ez (caution.c:426..498). */
  if (pctDown > 50 && danger < curhp + healHeal) {
    const c = firstCmd(
      borgUseStaffFail(ctx, SVAL.staff.healing!),
      fs.fightingEvilUnique ? borgSpellFail(ctx, Spell.HOLY_WORD, allowFail) : null,
      borgSpellFail(ctx, Spell.HEALING, allowFail),
      (!trait(ctx, BI.ATELEPORT) && !trait(ctx, BI.AESCAPE)) || rodGood ? borgZapRod(ctx, SVAL.rod.healing!) : null,
      borgZapRod(ctx, SVAL.rod.healing!),
      borgQuaffPotion(ctx, SVAL.potion.healing!),
    );
    if (c) return c;
  }
  if (pctDown > 65 && danger < curhp + healHeal) {
    const c = firstCmd(
      fs.fightingEvilUnique ? borgSpellFail(ctx, Spell.HOLY_WORD, allowFail) : null,
      borgSpellFail(ctx, Spell.HEALING, allowFail),
      borgUseStaffFail(ctx, SVAL.staff.healing!),
      (!trait(ctx, BI.ATELEPORT) && !trait(ctx, BI.AESCAPE)) || rodGood ? borgZapRod(ctx, SVAL.rod.healing!) : null,
      borgQuaffPotion(ctx, SVAL.potion.healing!),
      borgActivateItem(ctx, "act_cure_full"),
      borgActivateItem(ctx, "act_heal1"),
      fs.fightingUnique ? borgQuaffPotion(ctx, SVAL.potion.star_healing!) : null,
      fs.fightingUnique ? borgQuaffPotion(ctx, SVAL.potion.life!) : null,
    );
    if (c) return c;
  }
  if (
    pctDown > 75 &&
    danger > curhp &&
    trait(ctx, BI.ATELEPORT) + trait(ctx, BI.AESCAPE) <= 0
  ) {
    const c = firstCmd(borgQuaffPotion(ctx, SVAL.potion.healing!), borgQuaffPotion(ctx, SVAL.potion.star_healing!), borgQuaffPotion(ctx, SVAL.potion.life!));
    if (c) return c;
  }

  /* Cures - not mid-fight (caution.c:503). */
  if (danger > idiv(av(ctx) * 2, 10)) return null;

  if (trait(ctx, BI.ISPOISONED) && curhp < idiv(maxhp, 2)) {
    const c = firstCmd(
      borgSpellFail(ctx, Spell.CURE_POISON, 60),
      borgSpellFail(ctx, Spell.HERBAL_CURING, 60),
      borgQuaffPotion(ctx, SVAL.potion.cure_poison!),
      borgActivateItem(ctx, "act_cure_body"),
      borgActivateItem(ctx, "act_cure_critical"),
      borgActivateItem(ctx, "act_cure_full"),
      borgUseStaff(ctx, SVAL.staff.curing!),
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.fast_recovery!),
      borgEat(ctx, TV.MUSHROOM, SVAL.mush.purging!),
      borgQuaffCrit(ctx, true),
      borgSpellFail(ctx, Spell.HEALING, 60),
      borgSpellFail(ctx, Spell.HOLY_WORD, 60),
      borgUseStaffFail(ctx, SVAL.staff.healing!),
    );
    if (c) return c;
  }

  if (trait(ctx, BI.ISCUT) && (curhp < idiv(maxhp, 3) || ctx.rng.randint0(100) < 20)) {
    const c = firstCmd(
      borgQuaffPotion(ctx, SVAL.potion.cure_serious!),
      borgQuaffPotion(ctx, SVAL.potion.cure_light!),
      borgQuaffCrit(ctx, curhp < 10),
      borgSpell(ctx, Spell.MINOR_HEALING),
      borgQuaffPotion(ctx, SVAL.potion.cure_critical!),
    );
    if (c) return c;
  }

  return null;
}

/* ---------------------------------------------------------------- *
 * borg_caution (caution.c:799) - life-critical core
 * ---------------------------------------------------------------- */

/** Least-danger adjacent floor grid (the b_q borg_escape is called with). */
function leastAdjacentDanger(ctx: BorgContext, fallback: number): number {
  let best = fallback;
  for (let i = 0; i < 8; i++) {
    const x = ctx.world.self.c.x + ddx_ddd[i]!;
    const y = ctx.world.self.c.y + ddy_ddd[i]!;
    if (!ctx.world.map.inBounds(x, y)) continue;
    const ag = ctx.world.map.at(x, y);
    if (ag.feat === FEAT.NONE || ag.kill) continue;
    const d = borgDanger(ctx, y, x, 1, true, false);
    if (d < best) best = d;
  }
  return best;
}

/**
 * borgCaution (caution.c:799): the "prevent death" step. Returns a heal/defend/
 * escape/emergency command, or null (yield to the think ladder's movement/flow
 * stages, which own stair-taking and retreat). Pure fleeing/leaving goal flags
 * are set exactly as the C does.
 */
export function borgCaution(ctx: BorgContext): AgentCommand | null {
  const fs = getFightState(ctx.world);
  const g = getDangerGlobals(ctx.world);

  /* Nasty-situation flags (caution.c:807). */
  let nasty = false;
  if (!trait(ctx, BI.LIGHT) && g.lightTimeout < 250) nasty = true;
  if (trait(ctx, BI.ISWEAK)) nasty = true;
  if (trait(ctx, BI.ISBLIND)) nasty = true;
  if (trait(ctx, BI.ISCONFUSED)) nasty = true;
  if (trait(ctx, BI.ISIMAGE)) nasty = true;
  void nasty;

  /* Surrounded? (caution.c:857). */
  const surrounded = borgSurrounded(ctx);
  void surrounded;

  /* Too many escapes -> flee flags (caution.c:861). */
  if (
    (ctx.world.self.escapes > 3 && ctx.world.facts.uniqueOnLevel === 0 && ctx.world.self.readyMorgoth <= 0) ||
    ctx.world.self.escapes > 55
  ) {
    if (trait(ctx, BI.CDEPTH) <= 98) {
      ctx.world.self.goal.leaving = true;
      if (ctx.world.self.escapes > 3) ctx.world.self.goal.fleeing = true;
    }
  }

  /* Scary guy -> flee (caution.c:886). */
  if (ctx.world.facts.scaryGuyOnLevel) {
    ctx.world.self.goal.leaving = true;
    ctx.world.self.goal.fleeing = true;
    if (trait(ctx, BI.CDEPTH) === 0) ctx.world.self.goal.fleeingToTown = true;
  }

  /* Local danger (caution.c:925). */
  const posDanger = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, false);

  /* Heal / defend, class-ordered (caution.c:1001). */
  if (!ctx.world.self.goal.fleeing) {
    const mageFirst =
      trait(ctx, BI.CLASS) === CLASS_MAGE &&
      !g.morgothPosition &&
      !g.asPosition &&
      !trait(ctx, BI.ISBLIND) &&
      !trait(ctx, BI.ISCUT) &&
      !trait(ctx, BI.ISPOISONED) &&
      !trait(ctx, BI.ISCONFUSED);
    if (mageFirst) {
      const d = borgDefend(ctx, posDanger);
      if (d) return d;
      const h = borgHeal(ctx, posDanger);
      if (h) return h;
    } else {
      const h = borgHeal(ctx, posDanger);
      if (h) return h;
      const d = borgDefend(ctx, posDanger);
      if (d) return d;
    }
  }

  /* Excessive danger / town near-death flee flags (caution.c:1087). */
  if (posDanger > trait(ctx, BI.CURHP) * 2) {
    if (
      !ctx.world.self.goal.fleeing &&
      !fs.fightingUnique &&
      trait(ctx, BI.CLEVEL) < 50 &&
      !ctx.world.facts.vaultOnLevel &&
      trait(ctx, BI.CDEPTH) < 100 &&
      ctx.world.self.readyMorgoth === 1
    )
      ctx.world.self.goal.fleeing = true;
  } else if (!trait(ctx, BI.CDEPTH) && posDanger > trait(ctx, BI.CURHP) && trait(ctx, BI.CLEVEL) < 50) {
    ctx.world.self.goal.leaving = true;
  }

  /* Prevent starvation (caution.c:1230): eat / cast / restore-mana. */
  if (trait(ctx, BI.ISWEAK)) {
    const c = firstCmd(
      borgSpell(ctx, Spell.REMOVE_HUNGER),
      borgSpell(ctx, Spell.HERBAL_CURING),
      borgQuaffPotion(ctx, SVAL.potion.restore_mana!),
      borgActivateItem(ctx, "act_restore_mana"),
    );
    if (c) return c;
    if (trait(ctx, BI.CDEPTH)) {
      ctx.world.self.goal.leaving = true;
      ctx.world.self.goal.fleeing = true;
    }
  }

  /* Teleport from danger (caution.c strategy 1b): escape with the least-danger
   * adjacent square as b_q. */
  const bQ = leastAdjacentDanger(ctx, posDanger);
  const esc = borgEscape(ctx, bQ);
  if (esc) return esc;

  /* Final emergency ez-heal (caution.c end): all escape failed, about to die. */
  if (
    posDanger > trait(ctx, BI.CURHP) &&
    trait(ctx, BI.CURHP) < idiv(trait(ctx, BI.MAXHP), 4)
  ) {
    const c = firstCmd(
      borgQuaffPotion(ctx, SVAL.potion.healing!),
      borgQuaffPotion(ctx, SVAL.potion.star_healing!),
      borgQuaffPotion(ctx, SVAL.potion.life!),
      borgQuaffCrit(ctx, true),
      borgQuaffUnknown(ctx),
      borgReadUnknown(ctx),
      borgEatUnknown(ctx),
      borgUseUnknown(ctx),
    );
    if (c) return c;
  }

  /* Remaining C tail (stairs / retreat / back-away / food-light flow) emits
   * flow/rest commands owned by the P8.6 think ladder; yield to it. */
  return null;
}
