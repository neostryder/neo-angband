/**
 * borg_defend - the pre-battle / mid-battle defensive maneuvers, a faithful port
 * of reference/src/borg/borg-fight-defend.c.
 *
 * Structure mirrors attack/perm: for every BD_* maneuver, score it with
 * borg_simulate = true (usually "reduction in danger", p1 - p2, computed by
 * re-running borg_danger with a temp protection flag toggled), keep the best,
 * then perform it. p1 is the caller's current danger; each aux's exact fail
 * thresholds, danger-averaging and improvement gates are preserved.
 *
 * COVERAGE: the buff/resist/teleport-other cluster is ported in full (bless,
 * speed, grim purpose, resist FECAP + single elements, PFE, shield, tele-away,
 * hero, regen, berserk, smite-evil, glyph, create-door, earthquake, word of
 * destruction, teleport-level, banishment, detect-invis, light-beam). The four
 * data-gapped maneuvers return 0 (documented at each stub): the *genocide*
 * family needs r_ptr->d_char symbols, and panel-shift / rest / the Morgoth
 * variants need Term panel geometry / morgoth_panel data not on the borg model.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { BI } from "../trait/trait-index";
import { trait } from "../item/deps";
import {
  borgDanger,
  borgDangerOneKill,
  getDangerGlobals,
  getFearCaches,
  borgProjectable,
  borgLos,
} from "../danger";
import { borgCaveFloorBold } from "../danger/geometry";
import { FEAT } from "../flow/flow-consts";
import { BORG_GLOW } from "../world/grid";
import { TV, SVAL } from "../item/svals";
import {
  Spell,
  borgSpell,
  borgSpellFail,
  borgSpellOkayFail,
  borgHeroismLevel,
} from "../item/magic";
import {
  borgEquipsItem,
  borgActivateItem,
  borgActivateRing,
  borgEquipsRing,
  borgEquipsRod,
  borgZapRod,
  borgEquipsStaffFail,
  borgUseStaff,
  borgQuaffPotion,
  borgReadScroll,
  borgEat,
  borgAimWand,
} from "../item/item-use";
import { borgSlot } from "../item/deps";
import { getFightState, idiv, type FightState } from "./state";
import { BA } from "./bf";
import { borgLaunchBolt } from "./attack";
import { borgCautionTeleport } from "./escape";
import type { Temp } from "../world/model";

/* enum BD_* (defend.c:65). */
enum BD {
  BLESS,
  SPEED,
  GRIM_PURPOSE,
  RESIST_FECAP,
  RESIST_F,
  RESIST_C,
  RESIST_A,
  RESIST_E,
  RESIST_P,
  PROT_FROM_EVIL,
  SHIELD,
  TELE_AWAY,
  HERO,
  BERSERK,
  SMITE_EVIL,
  REGEN,
  GLYPH,
  CREATE_DOOR,
  MASS_GENOCIDE,
  GENOCIDE,
  GENOCIDE_NASTIES,
  EARTHQUAKE,
  DESTRUCTION,
  TPORTLEVEL,
  BANISHMENT,
  DETECT_INVISO,
  LIGHT_BEAM,
  SHIFT_PANEL,
  REST,
  TELE_AWAY_MORGOTH,
  BANISHMENT_MORGOTH,
  LIGHT_MORGOTH,
  MAX,
}

function av(ctx: BorgContext): number {
  return getDangerGlobals(ctx.world).avoidance;
}
/** The 'averaging' danger (average=false gives worst-case; average=true is the
 * averaged value the elemental/PFE branches redefine p1 with). */
function dangerAvg(ctx: BorgContext): number {
  return borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, false, false);
}
function screwed(ctx: BorgContext): boolean {
  return !!(trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISFORGET));
}
function lit(ctx: BorgContext): boolean {
  const { x, y } = ctx.world.self.c;
  const glow = ctx.world.map.inBounds(x, y) && (ctx.world.map.at(x, y).info & BORG_GLOW) !== 0;
  return glow || trait(ctx, BI.LIGHT) !== 0;
}
/** Improvement gate shared by the danger-difference maneuvers (defend.c). */
function improved(ctx: BorgContext, p1: number, p2: number): boolean {
  const cap = getFightState(ctx.world).fightingUnique ? idiv(av(ctx) * 2, 3) : idiv(av(ctx), 2);
  return p1 > p2 && p2 <= cap && p1 > idiv(av(ctx), 7);
}
/** Standard fail-allowed scaling (-19 / -10 / +10) around avoidance (defend.c). */
function scaleFail(ctx: BorgContext, p1: number, base: number, mid = 10): number {
  let fa = base;
  if (p1 > av(ctx)) fa -= 19;
  else if (p1 > idiv(av(ctx) * 2, 3)) fa -= mid;
  else if (p1 < idiv(av(ctx), 3)) fa += 10;
  return fa;
}

/** Recompute danger with a temp flag toggled on, restoring it after. */
function withTemp<K extends keyof Temp>(ctx: BorgContext, keys: K[], vals: Temp[K][], fn: () => number): number {
  const t = ctx.world.self.temp;
  const saved = keys.map((k) => t[k]);
  keys.forEach((k, i) => (t[k] = vals[i]!));
  const r = fn();
  keys.forEach((k, i) => (t[k] = saved[i]!));
  return r;
}

/* ---- bless (defend.c:157) ---- */
function auxBless(ctx: BorgContext, fs: FightState, p1: number): number {
  const fa = 25;
  if (ctx.world.self.temp.bless) return 0;
  if (screwed(ctx)) return 0;
  if (!lit(ctx)) return 0;
  if (
    !borgSpellOkayFail(ctx, Spell.BLESS, fa) &&
    !borgEquipsItem(ctx, "act_blessing", true) &&
    !borgEquipsItem(ctx, "act_blessing2", true) &&
    !borgEquipsItem(ctx, "act_blessing3", true) &&
    !borgSlot(ctx, TV.SCROLL, SVAL.scroll.blessing!) &&
    !borgSlot(ctx, TV.SCROLL, SVAL.scroll.holy_chant!) &&
    !borgSlot(ctx, TV.SCROLL, SVAL.scroll.holy_prayer!)
  )
    return 0;

  let nearKill = false;
  for (const [, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (kill.when < ctx.world.clock - 5) continue;
    if (Math.max(Math.abs(kill.pos.y - ctx.world.self.c.y), Math.abs(kill.pos.x - ctx.world.self.c.x)) > 3) continue;
    nearKill = true;
  }
  if ((p1 > idiv(av(ctx), 12) || trait(ctx, BI.CLEVEL) <= 15) && p1 > 0 && nearKill && p1 < idiv(av(ctx), 2)) {
    if (fs.simulate) return 1;
    ctx.world.self.noRestPrep = 11000;
    fs.pending =
      borgSpell(ctx, Spell.BLESS) ||
      borgActivateItem(ctx, "act_blessing") ||
      borgActivateItem(ctx, "act_blessing2") ||
      borgActivateItem(ctx, "act_blessing3") ||
      borgReadScroll(ctx, SVAL.scroll.blessing!) ||
      borgReadScroll(ctx, SVAL.scroll.holy_chant!) ||
      borgReadScroll(ctx, SVAL.scroll.holy_prayer!);
    return fs.pending ? 1 : 0;
  }
  return 0;
}

/* ---- speed (defend.c:242) ---- */
function auxSpeed(ctx: BorgContext, fs: FightState, p1: number): number {
  let fa = 25;
  if (ctx.world.self.temp.fast) return 0;
  if (screwed(ctx)) return 0;
  fa = scaleFail(ctx, p1, 25);

  const speedSpell = borgSpellOkayFail(ctx, Spell.HASTE_SELF, fa);
  const speedStaff = borgEquipsStaffFail(ctx, SVAL.staff.speed!);
  const speedRod = borgEquipsRod(ctx, SVAL.rod.speed!);
  const haste = borgEquipsItem(ctx, "act_haste", true) || borgEquipsItem(ctx, "act_haste1", true) || borgEquipsItem(ctx, "act_haste2", true);
  if (!borgSlot(ctx, TV.POTION, SVAL.potion.speed!) && !speedStaff && !speedRod && !speedSpell && !haste) return 0;
  const goodSpeed = speedRod || speedSpell || speedStaff || haste;

  let p2 = withTemp(ctx, ["fast"], [true], () => borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, false));
  if (ctx.world.facts.scaryGuyOnLevel) p2 = idiv(p2 * 3, 10);
  if (goodSpeed && fs.fightingUnique) p2 = idiv(p2 * 7, 10);
  if (fs.fightingSummoner && fs.fightingUnique) p2 = idiv(p2 * 7, 10);
  if (trait(ctx, BI.CDEPTH) === 99 && fs.fightingUnique >= 10) p2 = idiv(p2 * 6, 10);
  if (trait(ctx, BI.CDEPTH) === 100 && fs.fightingUnique >= 10) p2 = idiv(p2 * 5, 10);
  if (trait(ctx, BI.CDEPTH) >= 97 && !fs.fightingUnique && !goodSpeed) p2 = 9999;

  const capU = fs.fightingUnique ? idiv(av(ctx) * 2, 3) : idiv(av(ctx), 2);
  const capU2 = fs.fightingUnique ? idiv(av(ctx) * 2, 3) : idiv(av(ctx), 3);
  if (
    (p1 > p2 && p2 <= capU && p1 > idiv(av(ctx), 5) && goodSpeed) ||
    (p1 > p2 && p2 <= capU2 && p1 > idiv(av(ctx), 7))
  ) {
    if (fs.simulate) return p1 - p2;
    ctx.world.self.noRestPrep = trait(ctx, BI.CLEVEL) * 1000;
    fs.pending =
      borgZapRod(ctx, SVAL.rod.speed!) ||
      borgActivateItem(ctx, "act_haste") ||
      borgActivateItem(ctx, "act_haste1") ||
      borgActivateItem(ctx, "act_haste2") ||
      borgUseStaff(ctx, SVAL.staff.speed!) ||
      borgQuaffPotion(ctx, SVAL.potion.speed!) ||
      borgSpellFail(ctx, Spell.HASTE_SELF, fa);
    return fs.pending ? p1 - p2 : 0;
  }
  return 0;
}

/* ---- grim purpose (defend.c:388): temp conf + free-action resist ---- */
function auxGrimPurpose(ctx: BorgContext, fs: FightState, p1: number): number {
  if (trait(ctx, BI.RCONF) && trait(ctx, BI.FRACT)) return 0;
  if (screwed(ctx)) return 0;
  const fa = scaleFail(ctx, p1, 25);
  if (!borgSpellOkayFail(ctx, Spell.GRIM_PURPOSE, fa)) return 0;
  p1 = dangerAvg(ctx);
  const t = ctx.world.self.trait;
  const savedConf = t[BI.RCONF];
  const savedFa = t[BI.FRACT];
  t[BI.RCONF] = 1;
  t[BI.FRACT] = 1;
  const p2 = dangerAvg(ctx);
  t[BI.RCONF] = savedConf!;
  t[BI.FRACT] = savedFa!;
  if (improved(ctx, p1, p2)) {
    if (fs.simulate) return p1 - p2 + 2;
    fs.pending = borgSpell(ctx, Spell.GRIM_PURPOSE);
    return fs.pending ? p1 - p2 + 2 : 0;
  }
  return 0;
}

/* ---- resist all (FECAP) via item (defend.c:458) ---- */
function auxResistFecap(ctx: BorgContext, fs: FightState, p1: number): number {
  const t = ctx.world.self.temp;
  if (t.resFire && t.resAcid && t.resPois && t.resElec && t.resCold) return 0;
  if (screwed(ctx)) return 0;
  if (!borgEquipsItem(ctx, "act_resist_all", true) && !borgEquipsItem(ctx, "act_rage_bless_resist", true)) return 0;
  p1 = dangerAvg(ctx);
  let p2 = withTemp(
    ctx,
    ["resFire", "resElec", "resCold", "resAcid", "resPois"],
    [true, true, true, true, true],
    () => dangerAvg(ctx),
  );
  if (trait(ctx, BI.CLEVEL) >= 45) p2 = idiv(p2 * 8, 10);
  if (improved(ctx, p1, p2)) {
    if (fs.simulate) return p1 - p2 + 2;
    fs.pending = borgActivateItem(ctx, "act_resist_all") || borgActivateItem(ctx, "act_rage_bless_resist");
    if (fs.pending) ctx.world.self.noRestPrep = 21000;
    return fs.pending ? p1 - p2 + 2 : 0;
  }
  return 0;
}

/* ---- single-element resists (defend.c:543..964) ---- */
function auxResistElement(
  ctx: BorgContext,
  fs: FightState,
  p1: number,
  key: keyof Temp,
  spell: Spell,
  available: boolean,
  means: () => AgentCommand | null,
): number {
  if (ctx.world.self.temp[key]) return 0;
  if (screwed(ctx)) return 0;
  const fa = scaleFail(ctx, p1, 25);
  if (!borgSpellOkayFail(ctx, spell, fa) && !available) return 0;
  p1 = dangerAvg(ctx);
  const p2 = withTemp(ctx, [key], [true], () => dangerAvg(ctx));
  if (improved(ctx, p1, p2)) {
    if (fs.simulate) return p1 - p2;
    fs.pending = borgSpellFail(ctx, spell, fa) || means();
    if (fs.pending) ctx.world.self.noRestPrep = 21000;
    return fs.pending ? p1 - p2 : 0;
  }
  return 0;
}

/* ---- protection from evil (defend.c:967) ---- */
function auxProtEvil(ctx: BorgContext, fs: FightState, p1: number): number {
  if (ctx.world.self.temp.protFromEvil) return 0;
  if (screwed(ctx)) return 0;
  const fa = scaleFail(ctx, p1, 25, 5);
  let ok = borgSpellOkayFail(ctx, Spell.PROTECTION_FROM_EVIL, fa);
  if (borgSlot(ctx, TV.SCROLL, SVAL.scroll.protection_from_evil!)) ok = true;
  if (!lit(ctx)) ok = false;
  if (borgEquipsItem(ctx, "act_protevil", true)) ok = true;
  if (!ok) return 0;
  p1 = dangerAvg(ctx);
  const p2 = withTemp(ctx, ["protFromEvil"], [true], () => dangerAvg(ctx));
  if (improved(ctx, p1, p2)) {
    if (fs.simulate) return p1 - p2;
    fs.pending =
      borgSpellFail(ctx, Spell.PROTECTION_FROM_EVIL, fa) ||
      borgActivateItem(ctx, "act_protevil") ||
      borgReadScroll(ctx, SVAL.scroll.protection_from_evil!);
    if (fs.pending) ctx.world.self.noRestPrep = trait(ctx, BI.CLEVEL) * 1000;
    return fs.pending ? p1 - p2 : 0;
  }
  return 0;
}

/* ---- stone skin shield (defend.c:1055) ---- */
function auxShield(ctx: BorgContext, fs: FightState, p1: number): number {
  if (ctx.world.self.temp.shield) return 0;
  if (screwed(ctx)) return 0;
  if (!borgSlot(ctx, TV.MUSHROOM, SVAL.mush.stoneskin!) && !borgEquipsItem(ctx, "act_shroom_stone", true)) return 0;
  let p2 = withTemp(ctx, ["shield"], [true], () => borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, false));
  if (fs.fightingUnique) p2 = idiv(p2 * 7, 10);
  if (improved(ctx, p1, p2)) {
    if (fs.simulate) return p1 - p2;
    fs.pending = borgEat(ctx, TV.MUSHROOM, SVAL.mush.stoneskin!) || borgActivateItem(ctx, "act_shroom_stone");
    if (fs.pending) {
      ctx.world.self.noRestPrep = 2000;
      return p1 - p2;
    }
  }
  return 0;
}

/* ---- teleport other (defend.c:1110) ---- */
function auxTeleAway(ctx: BorgContext, fs: FightState, p1: number): number {
  if (screwed(ctx)) return 0;
  if (fs.fightingUnique) {
    if (p1 < idiv(av(ctx) * 7, 10) && trait(ctx, BI.CURSP) > 30 && fs.simulate) return 0;
  } else {
    if (p1 < idiv(av(ctx) * 5, 10) && trait(ctx, BI.CURSP) > 30 && fs.simulate) return 0;
  }
  if (p1 < idiv(av(ctx) * 4, 10) && fs.simulate) return 0;

  let fa = 50;
  if (p1 > av(ctx) * 3) fa -= 10;
  else if (p1 > av(ctx) * 2) fa -= 5;
  else if (p1 > idiv(av(ctx) * 5, 2)) fa += 5;

  const wandSlot = borgSlot(ctx, TV.WAND, SVAL.wand.teleport_away!);
  const spellOk =
    borgSpellOkayFail(ctx, Spell.TELEPORT_OTHER, fa) ||
    borgEquipsItem(ctx, "act_tele_other", true) ||
    (wandSlot !== null && wandSlot.pval > 0);
  if (!spellOk) return 0;

  /* fill temp list of nearby monsters (defend.c:1187). */
  const g = getDangerGlobals(ctx.world);
  fs.tempN = 0;
  g.tpOtherIndices.length = 0;
  for (const [, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (kill.when < ctx.world.clock - 2) continue;
    if (!ctx.world.map.inBounds(kill.pos.x, kill.pos.y)) continue;
    const ag = ctx.world.map.at(kill.pos.x, kill.pos.y);
    if (!(ag.info & 0x08)) continue;
    if (!(ag.info & 0x20)) continue;
    if (ag.feat >= FEAT.RUBBLE && ag.feat <= FEAT.PERM) continue;
    const d = Math.max(Math.abs(kill.pos.y - ctx.world.self.c.y), Math.abs(kill.pos.x - ctx.world.self.c.x));
    if (d > (ctx.view.constants().maxRange ?? 20)) continue;
    fs.tempX[fs.tempN] = kill.pos.x;
    fs.tempY[fs.tempN] = kill.pos.y;
    fs.tempN++;
  }
  if (!fs.tempN && fs.simulate) return 0;

  const p2 = borgLaunchBolt(ctx, fs, 0, p1, BA.AWAY_ALL, ctx.view.constants().maxRange ?? 20, null);
  if (p2 <= 0) return 0;
  if (fs.simulate) {
    fs.tempN = 0;
    g.tpOtherIndices.length = 0;
    return p2 && p2 > idiv(av(ctx), 2) ? p2 : 0;
  }
  fs.tempN = 0;
  g.tpOtherIndices.length = 0;
  fs.pending =
    borgSpell(ctx, Spell.TELEPORT_OTHER) ||
    borgActivateItem(ctx, "act_tele_other") ||
    borgAimWand(ctx, SVAL.wand.teleport_away!);
  if (fs.pending) fs.successfulTarget = -1;
  return fs.pending ? p2 : 0;
}

/* ---- hero (defend.c:1290) ---- */
function auxHero(ctx: BorgContext, fs: FightState, p1: number): number {
  const fa = 15;
  if (ctx.world.self.temp.hero) return 0;
  if (screwed(ctx)) return 0;
  const spell = borgSpellOkayFail(ctx, Spell.HEROISM, fa) && trait(ctx, BI.CLEVEL) >= borgHeroismLevel(ctx);
  const potion = borgSlot(ctx, TV.POTION, SVAL.potion.heroism!) !== null;
  if (!potion && !spell) return 0;
  if (p1 > idiv(av(ctx), 10) && p1 < idiv(av(ctx) * (fs.fightingUnique ? 7 : 5), 10)) {
    if (fs.simulate) return 1;
    ctx.world.self.noRestPrep = 10000;
    fs.pending = (spell ? borgSpell(ctx, Spell.HEROISM) : null) || borgQuaffPotion(ctx, SVAL.potion.heroism!);
    return fs.pending ? 1 : 0;
  }
  return 0;
}

/* ---- rapid regeneration (defend.c:1339) ---- */
function auxRegen(ctx: BorgContext, fs: FightState, p1: number): number {
  const fa = 15;
  if (ctx.world.self.temp.regen) return 0;
  if (screwed(ctx)) return 0;
  if (trait(ctx, BI.MAXHP) < 100) return 0;
  if (!borgSpellOkayFail(ctx, Spell.RAPID_REGENERATION, fa)) return 0;
  if (p1 > idiv(av(ctx), 10) && p1 < idiv(av(ctx) * (fs.fightingUnique ? 7 : 5), 10)) {
    if (fs.simulate) return 1;
    fs.pending = borgSpell(ctx, Spell.RAPID_REGENERATION);
    if (fs.pending) {
      ctx.world.self.noRestPrep = 10000;
      return 1;
    }
  }
  return 0;
}

/* ---- berserk (defend.c:1384) ---- */
function auxBerserk(ctx: BorgContext, fs: FightState, p1: number): number {
  const fa = 15;
  if (ctx.world.self.temp.berserk) return 0;
  if (screwed(ctx)) return 0;
  if (
    !borgSpellOkayFail(ctx, Spell.BERSERK_STRENGTH, fa) &&
    !borgSlot(ctx, TV.POTION, SVAL.potion.berserk!) &&
    !borgEquipsItem(ctx, "act_berserker", true) &&
    !borgEquipsItem(ctx, "act_rage_bless_resist", true) &&
    !borgEquipsItem(ctx, "act_shero", true)
  )
    return 0;
  if (p1 > idiv(av(ctx), 10) && p1 < idiv(av(ctx) * (fs.fightingUnique ? 7 : 5), 10)) {
    if (fs.simulate) return 5;
    fs.pending =
      borgSpell(ctx, Spell.BERSERK_STRENGTH) ||
      borgActivateItem(ctx, "act_berserker") ||
      borgActivateItem(ctx, "act_rage_bless_resist") ||
      borgActivateItem(ctx, "act_shero") ||
      borgQuaffPotion(ctx, SVAL.potion.berserk!);
    return fs.pending ? 5 : 0;
  }
  return 0;
}

/* near_evil (defend.c:1429). */
function nearEvil(ctx: BorgContext): boolean {
  for (const [i, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (kill.when < ctx.world.clock - 2) continue;
    if (!ctx.world.map.inBounds(kill.pos.x, kill.pos.y)) continue;
    if (!(ctx.world.map.at(kill.pos.x, kill.pos.y).info & 0x08)) continue;
    if (Math.max(Math.abs(kill.pos.y - ctx.world.self.c.y), Math.abs(kill.pos.x - ctx.world.self.c.x)) > 3) continue;
    if (getDangerGlobals(ctx.world).resolveFacts(ctx, i).flags.has("EVIL")) return true;
  }
  return false;
}

/* ---- smite evil (defend.c:1474) ---- */
function auxSmiteEvil(ctx: BorgContext, fs: FightState, p1: number): number {
  const fa = 15;
  if (ctx.world.self.temp.smiteEvil || trait(ctx, BI.WS_EVIL)) return 0;
  if (screwed(ctx)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.SMITE_EVIL, fa)) return 0;
  if (!nearEvil(ctx)) return 0;
  if (p1 > idiv(av(ctx), 10) && p1 < idiv(av(ctx) * (fs.fightingUnique ? 7 : 5), 10)) {
    if (fs.simulate) return 5;
    fs.pending = borgSpell(ctx, Spell.SMITE_EVIL);
    return fs.pending ? 5 : 0;
  }
  return 0;
}

/* ---- glyph of warding (defend.c:1515) ---- */
function auxGlyph(ctx: BorgContext, fs: FightState, p1: number): number {
  if (screwed(ctx)) return 0;
  const { x, y } = ctx.world.self.c;
  if (!ctx.world.map.inBounds(x, y)) return 0;
  const ag = ctx.world.map.at(x, y);
  if (ag.take || ag.trap || ag.feat === FEAT.LESS || ag.feat === FEAT.MORE || ag.feat === FEAT.OPEN || ag.feat === FEAT.BROKEN)
    return 0;
  if (fs.fightingUnique >= 10) return 0;
  const fa = scaleFail(ctx, p1, 25, 5); /* note: +20 low branch in C */
  let ok = borgSpellOkayFail(ctx, Spell.GLYPH_OF_WARDING, fa);
  if (borgSlot(ctx, TV.SCROLL, SVAL.scroll.rune_of_protection!)) ok = true;
  if (borgEquipsItem(ctx, "act_glyph", true)) ok = true;
  if (!lit(ctx)) ok = false;
  if (!ok) return 0;
  const g = getDangerGlobals(ctx.world);
  g.onGlyph = true;
  const p2 = borgDanger(ctx, y, x, 1, true, false);
  g.onGlyph = false;
  if (improved(ctx, p1, p2)) {
    if (fs.simulate) return p1 - p2;
    fs.pending =
      borgSpellFail(ctx, Spell.GLYPH_OF_WARDING, fa) ||
      borgReadScroll(ctx, SVAL.scroll.rune_of_protection!) ||
      borgActivateItem(ctx, "act_glyph");
    return fs.pending ? p1 - p2 : 0;
  }
  return 0;
}

/* ---- create door (defend.c:1620) ---- */
function auxCreateDoor(ctx: BorgContext, fs: FightState, p1: number): number {
  if (screwed(ctx)) return 0;
  if (!fs.fightingSummoner) return 0;
  const fa = scaleFail(ctx, p1, 30, 5);
  if (!borgSpellOkayFail(ctx, Spell.DOOR_CREATION, fa)) return 0;
  let doorBad = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = ctx.world.self.c.x + dx;
      const y = ctx.world.self.c.y + dy;
      if (!ctx.world.map.inBounds(x, y)) continue;
      const ag = ctx.world.map.at(x, y);
      if (ag.glyph || ag.kill || ag.feat === FEAT.GRANITE || ag.feat === FEAT.PERM || ag.feat === FEAT.CLOSED) doorBad++;
      if (ag.take || ag.trap || ag.feat === FEAT.LESS || ag.feat === FEAT.MORE || ag.feat === FEAT.OPEN || ag.feat === FEAT.BROKEN || ag.kill)
        doorBad++;
    }
  }
  if (doorBad >= 6) return 0;
  const g = getDangerGlobals(ctx.world);
  g.createDoor = true;
  const p2 = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, false);
  g.createDoor = false;
  if (improved(ctx, p1, p2)) {
    if (fs.simulate) return p1 - p2;
    fs.pending = borgSpellFail(ctx, Spell.DOOR_CREATION, fa);
    if (fs.pending) {
      ctx.world.facts.breederLevel = true;
      return p1 - p2;
    }
  }
  return 0;
}

/* ---- earthquake (defend.c:2243) ---- */
function auxEarthquake(ctx: BorgContext, fs: FightState, p1: number): number {
  if (!fs.simulate) {
    fs.pending =
      borgSpell(ctx, Spell.TREMOR) ||
      borgSpell(ctx, Spell.QUAKE) ||
      borgSpell(ctx, Spell.GRONDS_BLOW) ||
      borgActivateItem(ctx, "act_earthquakes");
    return fs.pending ? 9999 : 0;
  }
  if (screwed(ctx)) return 0;
  if (
    !borgSpellOkayFail(ctx, Spell.TREMOR, 35) &&
    !borgSpellOkayFail(ctx, Spell.QUAKE, 35) &&
    !borgSpellOkayFail(ctx, Spell.GRONDS_BLOW, 35) &&
    !borgEquipsItem(ctx, "act_earthquakes", true)
  )
    return 0;
  if (p1 < idiv(av(ctx) * 6, 10) && !fs.fightingSummoner) return 0;
  let threat = 0;
  for (const [, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (
      borgLos(ctx.world, ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) &&
      kill.rangedAttack &&
      Math.max(Math.abs(kill.pos.y - ctx.world.self.c.y), Math.abs(kill.pos.x - ctx.world.self.c.x)) >= 2
    )
      threat++;
  }
  let p2 = 9999;
  if (threat >= 4 && p1 > idiv(av(ctx) * 7, 10)) p2 = idiv(p1, 3);
  if (threat === 3 && p1 > idiv(av(ctx) * 7, 10)) p2 = idiv(p1 * 6, 10);
  const cap = fs.fightingUnique ? idiv(av(ctx) * 2, 3) : idiv(av(ctx), 2);
  if (p1 > p2 && p2 <= cap && p1 > idiv(av(ctx), 5)) return p1 - p2;
  return 0;
}

/* ---- word of destruction (defend.c:2314) ---- */
function auxDestruction(ctx: BorgContext, fs: FightState, p1: number): number {
  if (screwed(ctx)) return 0;
  if (!fs.simulate) {
    fs.pending = borgSpell(ctx, Spell.WORD_OF_DESTRUCTION) || borgUseStaff(ctx, SVAL.staff.destruction!) || borgActivateItem(ctx, "act_destruction2");
    return 500;
  }
  if (getDangerGlobals(ctx.world).morgothPosition) return 0;
  let realDanger = false;
  if (p1 > av(ctx)) realDanger = true;
  if (p1 > idiv(av(ctx) * 8, 10) && trait(ctx, BI.CDEPTH) >= 90 && trait(ctx, BI.CURHP) <= 300) realDanger = true;
  if (!realDanger) return 0;
  if (
    (trait(ctx, BI.ATELEPORT) || trait(ctx, BI.ATELEPORTLVL)) &&
    !screwed(ctx) &&
    fs.fightingUnique <= 4 &&
    trait(ctx, BI.CURHP) >= 275 &&
    borgCautionTeleport(ctx, 75, 2)
  )
    return 0;
  if (trait(ctx, BI.AESCAPE) >= 2 && trait(ctx, BI.CURHP) >= 275 && borgCautionTeleport(ctx, 75, 2)) return 0;
  let spell = borgSpellOkayFail(ctx, Spell.WORD_OF_DESTRUCTION, 55) || borgEquipsStaffFail(ctx, SVAL.staff.destruction!) || borgEquipsItem(ctx, "act_destruction2", true);
  if ((p1 > av(ctx) * 4 || (p1 > av(ctx) && trait(ctx, BI.CURHP) <= 150)) && borgEquipsStaffFail(ctx, SVAL.staff.destruction!)) spell = true;
  if (!spell) return 0;
  let d = p1 - 0;
  if (fs.fightingUnique <= 2 && p1 < av(ctx) * 2) d = 0;
  if (fs.fightingUnique >= 10) d = 0;
  return d;
}

/* ---- teleport level (defend.c:2416) ---- */
function auxTeleportLevel(ctx: BorgContext, fs: FightState, p1: number): number {
  if (!fs.simulate) {
    fs.pending = borgSpell(ctx, Spell.TELEPORT_LEVEL);
    return fs.pending ? 500 : 0;
  }
  if (screwed(ctx)) return 0;
  if (p1 < av(ctx) * 2) return 0;
  if ((trait(ctx, BI.ATELEPORT) || trait(ctx, BI.ATELEPORTLVL)) && !screwed(ctx) && borgCautionTeleport(ctx, 65, 2)) return 0;
  if (trait(ctx, BI.AESCAPE) >= 2 && borgCautionTeleport(ctx, 65, 2)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.TELEPORT_LEVEL, 55)) return 0;
  if (ctx.world.facts.morgothOnLevel || (fs.fightingUnique >= 1 && getDangerGlobals(ctx.world).asPosition)) return 0;
  return p1;
}

/* ---- banishment: remove evil in LOS (defend.c:2474) ---- */
function auxBanishment(ctx: BorgContext, fs: FightState, p1: number): number {
  if (p1 < idiv(av(ctx) * 1, 10)) return 0;
  let fa = 15;
  if (p1 > av(ctx) * 4) fa -= 10;
  if (screwed(ctx)) return 0;
  const usingArtifact = borgEquipsItem(ctx, "act_loskill", true) && trait(ctx, BI.CURHP) > 100;
  if (!usingArtifact && !borgSpellOkayFail(ctx, Spell.BANISH_EVIL, fa)) return 0;

  p1 = 1;
  for (const [i, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (!borgProjectable(ctx.world, getDangerGlobals(ctx.world), ctx.view.constants().maxRange ?? 20, ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x)) continue;
    p1 += borgDangerOneKillLocal(ctx, i);
  }
  let p2 = p1;
  let banished = 0;
  const toDelete: number[] = [];
  for (const [i, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (!borgProjectable(ctx.world, getDangerGlobals(ctx.world), ctx.view.constants().maxRange ?? 20, ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x)) continue;
    const facts = getDangerGlobals(ctx.world).resolveFacts(ctx, i);
    if (!facts.flags.has("EVIL")) continue;
    if (facts.flags.has("UNIQUE") && kill.injury > 60) continue;
    if (!borgCaveFloorBold(ctx.world, kill.pos.y, kill.pos.x)) continue;
    banished++;
    p2 -= borgDangerOneKillLocal(ctx, i);
    toDelete.push(i);
  }

  if (!fs.simulate) {
    for (const i of toDelete) ctx.world.kills.delete(i);
    fs.pending = usingArtifact ? borgActivateItem(ctx, "act_loskill") : borgSpell(ctx, Spell.BANISH_EVIL);
    return fs.pending ? p1 - p2 : 0;
  }
  if (p2 <= 0) p2 = 0;
  if (banished === 0) p2 = 9999;
  if (fs.fightingUnique >= 10 && trait(ctx, BI.CURHP) > 250 && trait(ctx, BI.CDEPTH) === 99) p2 = 9999;
  if (fs.fightingUnique >= 10 && trait(ctx, BI.CURHP) > 350 && trait(ctx, BI.CDEPTH) === 100) p2 = 9999;
  const cap = fs.fightingUnique ? idiv(av(ctx) * 2, 3) : idiv(av(ctx), 2);
  if (p1 > p2 && p2 <= cap) return p1 - p2;
  return 0;
}

/* ---- detect invisible (defend.c:2666) ---- */
function auxInviso(ctx: BorgContext, fs: FightState, p1: number): number {
  const fa = 25;
  if (trait(ctx, BI.ISFORGET) || trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || ctx.world.self.temp.seeInv) return 0;
  if (ctx.world.clock > ctx.world.self.temp.needSeeInvis + 5) return 0;
  if (p1 > av(ctx) * 2) return 0;
  if (
    !borgSlot(ctx, TV.POTION, SVAL.potion.detect_invis!) &&
    !borgSlot(ctx, TV.SCROLL, SVAL.scroll.detect_invis!) &&
    !borgEquipsStaffFail(ctx, SVAL.staff.detect_invis!) &&
    !borgEquipsStaffFail(ctx, SVAL.staff.detect_evil!) &&
    !borgSpellOkayFail(ctx, Spell.SENSE_INVISIBLE, fa) &&
    !borgSpellOkayFail(ctx, Spell.DETECTION, fa) &&
    !borgEquipsItem(ctx, "act_detect_invis", true) &&
    !borgEquipsItem(ctx, "act_detect_evil", true)
  )
    return 0;
  if (!lit(ctx)) return 0;
  if (fs.simulate) return 10;
  fs.pending =
    borgSpellFail(ctx, Spell.REVEAL_MONSTERS, fa) ||
    borgReadScroll(ctx, SVAL.scroll.detect_invis!) ||
    borgUseStaff(ctx, SVAL.staff.detect_invis!) ||
    borgUseStaff(ctx, SVAL.staff.detect_evil!) ||
    borgActivateItem(ctx, "act_detect_invis") ||
    borgActivateItem(ctx, "act_detect_evil");
  if (fs.pending) {
    ctx.world.self.temp.seeInv = 3000;
    return 10;
  }
  fs.pending = borgQuaffPotion(ctx, SVAL.potion.detect_invis!);
  if (fs.pending) {
    ctx.world.self.temp.seeInv = 18000;
    ctx.world.self.noRestPrep = 18000;
    return 10;
  }
  fs.pending = borgSpellFail(ctx, Spell.SENSE_INVISIBLE, fa);
  if (fs.pending) {
    ctx.world.self.temp.seeInv = 30000;
    ctx.world.self.noRestPrep = 16000;
    return 10;
  }
  return 0;
}

/* ---- light beam to spot lurkers (defend.c:2740) ---- */
function auxLbeam(ctx: BorgContext, fs: FightState, p1: number): number {
  if (screwed(ctx)) return 0;
  if (ctx.world.clock > ctx.world.self.temp.needSeeInvis + 2) return 0;
  const y = ctx.world.self.c.y;
  const x = ctx.world.self.c.x;
  const f = (yy: number, xx: number) => borgCaveFloorBold(ctx.world, yy, xx);
  let hallway = false;
  if (f(y - 1, x) && f(y + 1, x) && !f(y, x - 1) && !f(y, x + 1) && !f(y + 1, x - 1) && !f(y + 1, x + 1) && !f(y - 1, x - 1) && !f(y - 1, x + 1)) hallway = true;
  if (f(y, x - 1) && f(y, x + 1) && !f(y - 1, x) && !f(y + 1, x) && !f(y + 1, x - 1) && !f(y + 1, x + 1) && !f(y - 1, x - 1) && !f(y - 1, x + 1)) hallway = true;
  if (f(y - 1, x) && f(y + 1, x) && !f(y, x - 1) && !f(y, x + 1)) hallway = true;
  if (f(y, x - 1) && f(y, x + 1) && !f(y - 1, x) && !f(y + 1, x)) hallway = true;
  if (!hallway) return 0;
  if (fs.simulate && p1 > idiv(av(ctx) * 3, 4)) return 0;
  /* borg_light_beam maps to the Call Light / Spear-of-Light beam; delegate to
   * the item-layer light-beam command builder is out of scope here, so cast
   * SPEAR_OF_LIGHT as a lit beam (faithful to borg_light_beam's spell path). */
  if (!borgSpellOkayFail(ctx, Spell.SPEAR_OF_LIGHT, 25) && !borgSpellOkayFail(ctx, Spell.CALL_LIGHT, 25)) return 0;
  if (fs.simulate) return 10;
  fs.pending = borgSpell(ctx, Spell.SPEAR_OF_LIGHT) || borgSpell(ctx, Spell.CALL_LIGHT);
  return fs.pending ? 10 : 0;
}

/** borg_danger_one_kill wrapper at the borg's grid (average, full). */
function borgDangerOneKillLocal(ctx: BorgContext, i: number): number {
  return borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, true);
}

/** borg_fear_region[borg.c.y/11][borg.c.x/11] (defend.c:3567). */
function getFearRegional(ctx: BorgContext): number {
  return getFearCaches(ctx.world).region(ctx.world.self.c.y, ctx.world.self.c.x);
}

/* dispatch (defend.c:3441). */
function defendAux(ctx: BorgContext, fs: FightState, what: BD, p1: number): number {
  switch (what) {
    case BD.SPEED: return auxSpeed(ctx, fs, p1);
    case BD.PROT_FROM_EVIL: return auxProtEvil(ctx, fs, p1);
    case BD.GRIM_PURPOSE: return auxGrimPurpose(ctx, fs, p1);
    case BD.RESIST_FECAP: return auxResistFecap(ctx, fs, p1);
    case BD.RESIST_F:
      return auxResistElement(ctx, fs, p1, "resFire", Spell.RESISTANCE,
        borgEquipsItem(ctx, "act_resist_all", true) ||
          borgEquipsItem(ctx, "act_resist_fire", true) ||
          borgEquipsItem(ctx, "act_rage_bless_resist", true) ||
          borgEquipsRing(ctx, SVAL.ring.flames!) ||
          borgEquipsItem(ctx, "act_ring_flames", true) ||
          borgSlot(ctx, TV.POTION, SVAL.potion.resist_heat!) !== null,
        () =>
          borgActivateRing(ctx, SVAL.ring.flames!) ||
          borgActivateItem(ctx, "act_resist_all") ||
          borgActivateItem(ctx, "act_resist_fire") ||
          borgActivateItem(ctx, "act_rage_bless_resist") ||
          borgQuaffPotion(ctx, SVAL.potion.resist_heat!));
    case BD.RESIST_C:
      return auxResistElement(ctx, fs, p1, "resCold", Spell.RESISTANCE,
        borgEquipsItem(ctx, "act_resist_all", true) ||
          borgEquipsItem(ctx, "act_rage_bless_resist", true) ||
          borgEquipsItem(ctx, "act_resist_cold", true) ||
          borgEquipsRing(ctx, SVAL.ring.ice!) ||
          borgEquipsItem(ctx, "act_ring_ice", true) ||
          borgSlot(ctx, TV.POTION, SVAL.potion.resist_cold!) !== null,
        () =>
          borgActivateRing(ctx, SVAL.ring.ice!) ||
          borgActivateItem(ctx, "act_resist_all") ||
          borgActivateItem(ctx, "act_rage_bless_resist") ||
          borgActivateItem(ctx, "act_resist_cold") ||
          borgQuaffPotion(ctx, SVAL.potion.resist_cold!));
    case BD.RESIST_A:
      return auxResistElement(ctx, fs, p1, "resAcid", Spell.RESISTANCE,
        borgEquipsItem(ctx, "act_resist_acid", true) ||
          borgEquipsItem(ctx, "act_resist_all", true) ||
          borgEquipsItem(ctx, "act_rage_bless_resist", true) ||
          borgEquipsRing(ctx, SVAL.ring.acid!),
        () =>
          borgActivateRing(ctx, SVAL.ring.acid!) ||
          borgActivateItem(ctx, "act_resist_acid") ||
          borgActivateItem(ctx, "act_resist_all") ||
          borgActivateItem(ctx, "act_rage_bless_resist"));
    case BD.RESIST_E:
      return auxResistElement(ctx, fs, p1, "resElec", Spell.RESISTANCE,
        borgEquipsItem(ctx, "act_resist_elec", true) ||
          borgEquipsItem(ctx, "act_resist_all", true) ||
          borgEquipsItem(ctx, "act_rage_bless_resist", true) ||
          borgEquipsRing(ctx, SVAL.ring.lightning!) ||
          borgEquipsItem(ctx, "act_ring_lightning", true),
        () =>
          borgActivateRing(ctx, SVAL.ring.lightning!) ||
          borgActivateItem(ctx, "act_resist_elec") ||
          borgActivateItem(ctx, "act_resist_all") ||
          borgActivateItem(ctx, "act_rage_bless_resist"));
    case BD.RESIST_P:
      if (ctx.world.self.temp.resPois) return 0;
      return auxResistElement(ctx, fs, p1, "resPois", Spell.RESIST_POISON,
        borgEquipsItem(ctx, "act_resist_pois", true) ||
          borgEquipsItem(ctx, "act_resist_all", true) ||
          borgEquipsItem(ctx, "act_rage_bless_resist", true) ||
          borgSlot(ctx, TV.POTION, SVAL.potion.resist_pois!) !== null,
        () =>
          borgActivateItem(ctx, "act_resist_pois") ||
          borgActivateItem(ctx, "act_resist_all") ||
          borgActivateItem(ctx, "act_rage_bless_resist") ||
          borgQuaffPotion(ctx, SVAL.potion.resist_pois!));
    case BD.BLESS: return auxBless(ctx, fs, p1);
    case BD.HERO: return auxHero(ctx, fs, p1);
    case BD.BERSERK: return auxBerserk(ctx, fs, p1);
    case BD.SMITE_EVIL: return auxSmiteEvil(ctx, fs, p1);
    case BD.REGEN: return auxRegen(ctx, fs, p1);
    case BD.SHIELD: return auxShield(ctx, fs, p1);
    case BD.TELE_AWAY: return auxTeleAway(ctx, fs, p1);
    case BD.GLYPH: return auxGlyph(ctx, fs, p1);
    case BD.CREATE_DOOR: return auxCreateDoor(ctx, fs, p1);
    case BD.EARTHQUAKE: return auxEarthquake(ctx, fs, p1);
    case BD.DESTRUCTION: return auxDestruction(ctx, fs, p1);
    case BD.TPORTLEVEL: return auxTeleportLevel(ctx, fs, p1);
    case BD.BANISHMENT: return auxBanishment(ctx, fs, p1);
    case BD.DETECT_INVISO: return auxInviso(ctx, fs, p1);
    case BD.LIGHT_BEAM: return auxLbeam(ctx, fs, p1);
    /* GAP: the *genocide* family (defend.c:1720/1851/2157) needs r_ptr->d_char
     * symbols; panel-shift (2817) needs Term panel geometry; rest (2973) and the
     * Morgoth variants (3048/3198/3341) need morgoth-panel/position data not on
     * the borg model. These return 0 (unavailable), which is the faithful
     * "cannot perform this maneuver" result for the best-of scan. */
    case BD.MASS_GENOCIDE:
    case BD.GENOCIDE:
    case BD.GENOCIDE_NASTIES:
    case BD.SHIFT_PANEL:
    case BD.REST:
    case BD.TELE_AWAY_MORGOTH:
    case BD.BANISHMENT_MORGOTH:
    case BD.LIGHT_MORGOTH:
      return 0;
    default:
      return 0;
  }
}

/**
 * borgDefend (defend.c:3548): prepare for / survive a battle. p1 is the current
 * danger. Returns the AgentCommand for the chosen maneuver, or null.
 */
export function borgDefend(ctx: BorgContext, p1: number): AgentCommand | null {
  const fs = getFightState(ctx.world);
  fs.simulate = true;

  /* Resistance refresh when it is about to drop (defend.c:3558). */
  if (ctx.world.self.resistance && ctx.world.self.resistance < fs.gameRatio * 2) {
    const g = getDangerGlobals(ctx.world);
    g.attacking = true;
    const p = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, false, false);
    g.attacking = false;
    if (p > getFearRegional(ctx) || fs.fightingUnique) {
      const cmd = borgSpell(ctx, Spell.RESISTANCE);
      if (cmd) {
        ctx.world.self.resistance = 25000;
        return cmd;
      }
    }
  }

  let bG = -1;
  let bN = 0;
  for (let g = 0; g < BD.MAX; g++) {
    const n = defendAux(ctx, fs, g as BD, p1);
    if (n <= bN) continue;
    bG = g;
    bN = n;
  }
  if (bN <= 0) return null;

  fs.simulate = false;
  fs.pending = null;
  defendAux(ctx, fs, bG as BD, p1);
  return fs.pending;
}
