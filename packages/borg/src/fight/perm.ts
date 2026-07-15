/**
 * borg_perma_spell - maintenance / "always on" buffs the borg keeps up while it
 * can afford the mana. A faithful port of reference/src/borg/borg-fight-perm.c.
 *
 * Same simulate-then-commit shape as the attack/defend ladders: score every BP_*
 * setup, keep the best, then perform it (storing the AgentCommand on the
 * FightState). Each aux's priority value and cost gate is preserved verbatim.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { BI } from "../trait/trait-index";
import { trait } from "../item/deps";
import { TV, SVAL } from "../item/svals";
import {
  Spell,
  borgSpell,
  borgSpellFail,
  borgSpellOkayFail,
  borgGetSpellPower,
  borgHeroismLevel,
} from "../item/magic";
import {
  borgEquipsItem,
  borgActivateItem,
  borgQuaffPotion,
} from "../item/item-use";
import { borgSlot } from "../item/deps";
import { getFightState, idiv, type FightState } from "./state";
import { BORG_GLOW } from "../world/grid";

/* enum BP_* (perm.c:45). */
enum BP {
  SPEED,
  PROT_FROM_EVIL,
  BLESS,
  RESIST_ALL,
  RESIST_ALL_COLLUIN,
  RESIST_P,
  FASTCAST,
  HERO,
  BERSERK,
  BERSERK_POTION,
  SMITE_EVIL,
  VENOM,
  REGEN,
  GLYPH,
  SEE_INV,
  MAX,
}

/** unique_on_level (borg-flow-kill.c global) via the level facts. */
function uniqueOnLevel(ctx: BorgContext): boolean {
  return ctx.world.facts.uniqueOnLevel !== 0;
}

/** The class-scaled fail threshold shared by every perma buff (perm.c:76). */
function failAllowed(ctx: BorgContext, fs: FightState, base: number): number {
  let fa = base;
  if (uniqueOnLevel(ctx)) fa = base + 5;
  if (fs.fightingUnique) fa = base + 10;
  return fa;
}

/** cost >= CURSP/7 (unique) else CURSP/10 => too expensive (perm.c:99). */
function tooExpensive(ctx: BorgContext, cost: number): boolean {
  const div = uniqueOnLevel(ctx) ? 7 : 10;
  return cost >= idiv(trait(ctx, BI.CURSP), div);
}

/* --- individual setups (perm.c:72..681). Each returns the priority value. --- */

function auxBless(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 15);
  if (ctx.world.self.temp.bless) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.BLESS, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.BLESS);
  if (trait(ctx, BI.CLEVEL) > 10 && tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 1;
  fs.pending = borgSpell(ctx, Spell.BLESS);
  ctx.world.self.noRestPrep = 10000;
  return 1;
}

function auxResist(ctx: BorgContext, fs: FightState): number {
  const t = ctx.world.self.temp;
  const fa = failAllowed(ctx, fs, 5);
  if ((t.resFire ? 1 : 0) + (t.resAcid ? 1 : 0) + (t.resElec ? 1 : 0) + (t.resCold ? 1 : 0) >= 3) return 0;
  if (!borgSpellOkayFail(ctx, Spell.RESISTANCE, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.RESISTANCE);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 2;
  fs.pending = borgSpellFail(ctx, Spell.RESISTANCE, fa);
  ctx.world.self.noRestPrep = 21000;
  return 2;
}

function auxResistColluin(ctx: BorgContext, fs: FightState): number {
  const t = ctx.world.self.temp;
  if ((t.resFire ? 1 : 0) + (t.resAcid ? 1 : 0) + (t.resPois ? 1 : 0) + (t.resElec ? 1 : 0) + (t.resCold ? 1 : 0) >= 3)
    return 0;
  if (!fs.fightingUnique) return 0;
  if (!borgEquipsItem(ctx, "act_resist_all", true) && !borgEquipsItem(ctx, "act_rage_bless_resist", true)) return 0;
  if (fs.simulate) return 2;
  fs.pending = borgActivateItem(ctx, "act_resist_all") || borgActivateItem(ctx, "act_rage_bless_resist");
  if (fs.pending) ctx.world.self.noRestPrep = 21000;
  return 2;
}

function auxResistP(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 5);
  if (ctx.world.self.temp.resPois || !uniqueOnLevel(ctx)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.RESIST_POISON, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.RESIST_POISON);
  if (cost >= idiv(trait(ctx, BI.CURSP), 20)) return 0;
  if (fs.simulate) return 1;
  fs.pending = borgSpellFail(ctx, Spell.RESIST_POISON, fa);
  if (fs.pending) {
    ctx.world.self.noRestPrep = 21000;
    return 1;
  }
  return 0;
}

function auxSpeed(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 7);
  if (ctx.world.self.temp.fast) return 0;
  if (!borgSpellOkayFail(ctx, Spell.HASTE_SELF, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.HASTE_SELF);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 5;
  fs.pending = borgSpellFail(ctx, Spell.HASTE_SELF, fa);
  if (fs.pending) {
    ctx.world.self.noRestPrep = trait(ctx, BI.CLEVEL) * 1000;
    return 5;
  }
  return 0;
}

function auxProtEvil(ctx: BorgContext, fs: FightState): number {
  if (ctx.world.self.temp.protFromEvil) return 0;
  const fa = failAllowed(ctx, fs, 5);
  if (!borgSpellOkayFail(ctx, Spell.PROTECTION_FROM_EVIL, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.PROTECTION_FROM_EVIL);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 3;
  fs.pending = borgSpellFail(ctx, Spell.PROTECTION_FROM_EVIL, fa);
  if (fs.pending) {
    ctx.world.self.noRestPrep = trait(ctx, BI.CLEVEL) * 1000;
    return 3;
  }
  return 0;
}

function auxFastcast(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 5);
  if (ctx.world.self.temp.fastcast) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.MANA_CHANNEL, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.MANA_CHANNEL);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 5;
  fs.pending = borgSpell(ctx, Spell.MANA_CHANNEL);
  if (fs.pending) {
    ctx.world.self.noRestPrep = 6000;
    return 1;
  }
  return 0;
}

function auxHero(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 5);
  if (ctx.world.self.temp.hero) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return 0;
  if (trait(ctx, BI.CLEVEL) <= borgHeroismLevel(ctx)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.HEROISM, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.HEROISM);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 1;
  fs.pending = borgSpell(ctx, Spell.HEROISM);
  if (fs.pending) {
    ctx.world.self.noRestPrep = 3000;
    return 1;
  }
  return 0;
}

function auxRegen(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 5);
  if (ctx.world.self.temp.regen) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISFORGET)) return 0;
  if (trait(ctx, BI.MAXHP) < 100) return 0;
  if (!borgSpellOkayFail(ctx, Spell.RAPID_REGENERATION, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.RAPID_REGENERATION);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 1;
  fs.pending = borgSpell(ctx, Spell.RAPID_REGENERATION);
  if (fs.pending) {
    ctx.world.self.noRestPrep = 6000;
    return 1;
  }
  return 0;
}

function auxSmiteEvil(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 5);
  if (ctx.world.self.temp.smiteEvil || trait(ctx, BI.WS_EVIL)) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.SMITE_EVIL, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.SMITE_EVIL);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 3;
  fs.pending = borgSpell(ctx, Spell.SMITE_EVIL);
  if (fs.pending) {
    ctx.world.self.noRestPrep = 21000;
    return 3;
  }
  return 0;
}

function auxVenom(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 5);
  if (ctx.world.self.temp.venom || trait(ctx, BI.WB_POIS)) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.VENOM, fa)) return 0;
  /* perm.c:543 upstream reads SMITE_EVIL's cost here (a known quirk, preserved). */
  const cost = borgGetSpellPower(ctx, Spell.SMITE_EVIL);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 3;
  fs.pending = borgSpell(ctx, Spell.VENOM);
  if (fs.pending) {
    ctx.world.self.noRestPrep = 19000;
    return 3;
  }
  return 0;
}

function auxBerserk(ctx: BorgContext, fs: FightState): number {
  const fa = failAllowed(ctx, fs, 5);
  if (ctx.world.self.temp.berserk) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.BERSERK_STRENGTH, fa)) return 0;
  const cost = borgGetSpellPower(ctx, Spell.BERSERK_STRENGTH);
  if (tooExpensive(ctx, cost)) return 0;
  if (fs.simulate) return 2;
  fs.pending = borgSpell(ctx, Spell.BERSERK_STRENGTH);
  if (fs.pending) {
    ctx.world.self.noRestPrep = 11000;
    return 2;
  }
  return 0;
}

function auxBerserkPotion(ctx: BorgContext, fs: FightState): number {
  if (!fs.fightingUnique) return 0;
  if (ctx.world.self.temp.hero || ctx.world.self.temp.berserk) return 0;
  if (!borgSlot(ctx, TV.POTION, SVAL.potion.berserk!)) return 0;
  if (fs.simulate) return 2;
  fs.pending = borgQuaffPotion(ctx, SVAL.potion.berserk!);
  return fs.pending ? 2 : 0;
}

function auxSeeInv(ctx: BorgContext, fs: FightState): number {
  const fa = 25;
  if (
    trait(ctx, BI.ISBLIND) ||
    trait(ctx, BI.ISCONFUSED) ||
    trait(ctx, BI.SINV) ||
    ctx.world.self.temp.seeInv
  )
    return 0;
  if (!borgSpellOkayFail(ctx, Spell.SENSE_INVISIBLE, fa)) return 0;
  const { x, y } = ctx.world.self.c;
  const glow = ctx.world.map.inBounds(x, y) && (ctx.world.map.at(x, y).info & BORG_GLOW) !== 0;
  if (!glow && !trait(ctx, BI.LIGHT)) return 0;
  if (fs.simulate) return 10;
  fs.pending = borgSpellFail(ctx, Spell.SENSE_INVISIBLE, fa);
  if (fs.pending) {
    ctx.world.self.temp.seeInv = 32000;
    ctx.world.self.noRestPrep = 16000;
    return 10;
  }
  return 0;
}

/** borg_perma_aux dispatch (perm.c:686). */
function permaAux(ctx: BorgContext, fs: FightState, what: BP): number {
  switch (what) {
    case BP.SPEED: return auxSpeed(ctx, fs);
    case BP.PROT_FROM_EVIL: return auxProtEvil(ctx, fs);
    case BP.RESIST_ALL: return auxResist(ctx, fs);
    case BP.RESIST_ALL_COLLUIN: return auxResistColluin(ctx, fs);
    case BP.RESIST_P: return auxResistP(ctx, fs);
    case BP.BLESS: return auxBless(ctx, fs);
    case BP.FASTCAST: return auxFastcast(ctx, fs);
    case BP.HERO: return auxHero(ctx, fs);
    case BP.BERSERK: return auxBerserk(ctx, fs);
    case BP.BERSERK_POTION: return auxBerserkPotion(ctx, fs);
    case BP.SMITE_EVIL: return auxSmiteEvil(ctx, fs);
    case BP.VENOM: return auxVenom(ctx, fs);
    case BP.REGEN: return auxRegen(ctx, fs);
    case BP.GLYPH: return 0; /* perm.c:731: disabled (uses too much mana) */
    case BP.SEE_INV: return auxSeeInv(ctx, fs);
    default: return 0;
  }
}

/**
 * borgPermaSpell (perm.c:746): walk around with maintenance buffs when affordable.
 * Returns the AgentCommand for the chosen setup, or null.
 */
export function borgPermaSpell(ctx: BorgContext): AgentCommand | null {
  const fs = getFightState(ctx.world);
  fs.simulate = true;

  if (!trait(ctx, BI.CDEPTH)) return null;
  if (trait(ctx, BI.CDEPTH) < idiv(trait(ctx, BI.CLEVEL), 3) || trait(ctx, BI.CDEPTH) < 7) return null;
  if (trait(ctx, BI.CLEVEL) <= 10) return null;
  if (trait(ctx, BI.CURSP) < idiv(trait(ctx, BI.MAXSP) * 75, 100)) return null;

  let bG = -1;
  let bN = 0;
  for (let g = 0; g < BP.MAX; g++) {
    const n = permaAux(ctx, fs, g as BP);
    if (n <= bN) continue;
    bG = g;
    bN = n;
  }
  if (bN <= 0) return null;

  fs.simulate = false;
  fs.pending = null;
  permaAux(ctx, fs, bG as BP);
  return fs.pending;
}
