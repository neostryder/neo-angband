/**
 * The danger / threat evaluator: a faithful port of the core of
 * reference/src/borg/borg-danger.c - borg_danger_physical (base:63),
 * borg_danger_spell (base:556), borg_danger_one_kill (base:2288) and
 * borg_danger (base:2825).
 *
 * borg_danger(y, x, turns, average, full_damage) estimates the expected damage
 * to a grid from every tracked monster over `turns` player-moves, adding the
 * regional/monster fear caches. The per-monster estimate (borg_danger_one_kill)
 * combines a physical-blow estimate and a spell/breath estimate, each scaled by
 * how many times the monster can act in the window (its energy/speed) and gated
 * by distance and line of sight.
 *
 * Every damage constant, resistance division and threshold is transcribed from
 * the reference with the source line noted. Integer division uses Math.trunc to
 * match C truncation exactly (see `div`).
 *
 * See facts.ts for the r_info data gap and how the default resolver approximates
 * blows / spell_power / frequency that the frozen MonsterView does not carry.
 */

import { FEAT } from "@neo-angband/core";
import type { BorgContext } from "../context";
import type { BorgKill } from "../world/kill";
import type { BorgWorld } from "../world/model";
import { AUTO_MAX_X, AUTO_MAX_Y, BORG_VIEW } from "../world/grid";
import {
  BI,
  CLASS_MAGE,
  STAT_INT,
  STAT_WIS,
  spellStatForClass,
} from "../trait/trait-index";
import { RSF } from "@neo-angband/core";
import { MONBLOW, extractEnergy, adjDexSafe } from "./tables";
import {
  trait,
  borgDistance,
  squareInBoundsFully,
  borgCaveFloorBold,
  borgFeatureProtected,
  borgProjectable,
  borgProjectablePure,
  ddx_ddd,
  ddy_ddd,
} from "./geometry";
import type { MonsterFacts } from "./facts";
import { BORG_SPELL } from "./globals";
import type { DangerGlobals } from "./globals";
import { getDangerState } from "./state";

/** C integer division: truncate toward zero. */
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** rf_has(r_ptr->flags, RF_<flag>) over the resolved race flags. */
function hasFlag(facts: MonsterFacts, flag: string): boolean {
  return facts.flags.has(flag);
}

/**
 * borg_danger_physical (borg-danger.c:63): estimate the danger from a monster's
 * physical (melee) attacks. Verbatim port of the per-blow BORG_MONBLOW switch.
 */
export function borgDangerPhysical(
  world: BorgWorld,
  g: DangerGlobals,
  facts: MonsterFacts,
  fullDamage: boolean,
): number {
  let n = 0;
  let pfe = 0;

  let ac = trait(world, BI.ARMOR);
  const temp = world.self.temp;

  /* shields gives +50 to ac and deflects some missiles and balls */
  if (temp.shield) ac += 50;

  /* Apply PROTECTION_FROM_EVIL */
  if (
    temp.protFromEvil &&
    hasFlag(facts, "EVIL") &&
    trait(world, BI.CLEVEL) >= facts.level
  ) {
    pfe = 1;
  }

  /* Mega-Hack -- unknown monsters (or "player ghosts") */
  if (facts.rIdx === 0) return 1000;

  const attacking = g.attacking;
  const clevel = trait(world, BI.CLEVEL);
  const spellStat = spellStatForClass(trait(world, BI.CLASS));

  /* Analyze each physical attack */
  for (let k = 0; k < facts.blows.length; k++) {
    const blow = facts.blows[k]!;
    const dDice = blow.dice;
    const dSide = blow.sides;
    let z = 0;
    let power = 0;

    switch (blow.effect) {
      case MONBLOW.HURT:
        z = dDice * dSide;
        /* stun (upstream condition is always false; preserved verbatim) */
        if (dSide < 3 && z > dDice * dSide) n += 200;
        /* fudge - low-sides high-dice kickers tend to KO */
        if (dSide < 3 && dDice > 5) n += 400;
        power = 60;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.POISON:
        z = dDice * dSide;
        power = 5;
        if (trait(world, BI.RPOIS)) break;
        if (temp.resPois) break;
        z += 10;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.DISENCHANT:
        z = dDice * dSide;
        power = 20;
        if (trait(world, BI.RDIS)) break;
        z += 500;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.DRAIN_CHARGES:
        z = dDice * dSide;
        z += 20;
        power = 15;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EAT_GOLD:
        z = dDice * dSide;
        if (clevel < 5) z += 50;
        power = 5;
        if (100 <= adjDexSafe(trait(world, BI.DEX_INDEX)) + clevel) break;
        if (trait(world, BI.GOLD) < 100) break;
        if (trait(world, BI.GOLD) > 100000) break;
        z += 5;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EAT_ITEM:
        z = dDice * dSide;
        power = 5;
        if (100 <= adjDexSafe(trait(world, BI.DEX_INDEX)) + clevel) break;
        z += 5;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EAT_FOOD:
        z = dDice * dSide;
        power = 5;
        if (trait(world, BI.FOOD) > 5) break;
        z += 5;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EAT_LIGHT:
        z = dDice * dSide;
        power = 5;
        if (!g.lightTimeout || g.lightNoFuel) break;
        if (trait(world, BI.AFUEL) > 5) break;
        z += 5;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.ACID:
        if (trait(world, BI.IACID)) break;
        z = dDice * dSide;
        if (trait(world, BI.RACID)) z = div(z + 2, 3);
        if (temp.resAcid) z = div(z + 2, 3);
        z += 200; /* We don't want our armour corroded. */
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.ELEC:
        if (trait(world, BI.IELEC)) break;
        z = dDice * dSide;
        power = 10;
        if (trait(world, BI.RELEC)) z = div(z + 2, 3);
        if (temp.resElec) z = div(z + 2, 3);
        z = z * 2;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.FIRE:
        if (trait(world, BI.IFIRE)) break;
        z = dDice * dSide;
        power = 10;
        if (trait(world, BI.RFIRE)) z = div(z + 2, 3);
        if (temp.resFire) z = div(z + 2, 3);
        z = z * 2;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.COLD:
        if (trait(world, BI.ICOLD)) break;
        z = dDice * dSide;
        power = 10;
        if (trait(world, BI.RCOLD)) z = div(z + 2, 3);
        /* upstream reads res_acid here (preserved verbatim) */
        if (temp.resAcid) z = div(z + 2, 3);
        z = z * 2;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.BLIND:
        z = dDice * dSide;
        power = 2;
        if (trait(world, BI.RBLIND)) break;
        z += 10;
        if (trait(world, BI.CLASS) === CLASS_MAGE) z += 75;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.CONFUSE:
        z = dDice * dSide;
        power = 10;
        if (trait(world, BI.RCONF)) break;
        z += 200;
        if (trait(world, BI.CLASS) === CLASS_MAGE) z += 200;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.TERRIFY:
        z = dDice * dSide;
        power = 10;
        if (trait(world, BI.RFEAR)) break;
        z = z * 2;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.PARALYZE:
        z = dDice * dSide;
        power = 2;
        if (trait(world, BI.FRACT)) break;
        z += 200;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.LOSE_STR:
        z = dDice * dSide;
        if (trait(world, BI.SSTR)) break;
        if (trait(world, BI.CSTR) <= 3) break;
        if (g.spellLegal(BORG_SPELL.RESTORATION)) break;
        if (g.spellLegal(BORG_SPELL.REVITALIZE)) break;
        if (g.spellLegal(BORG_SPELL.UNHOLY_REPRIEVE)) break;
        z += 150;
        if (trait(world, BI.CSTR) < 10) z += 100;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.LOSE_DEX:
        z = dDice * dSide;
        if (trait(world, BI.SDEX)) break;
        if (trait(world, BI.CDEX) <= 3) break;
        if (g.spellLegal(BORG_SPELL.RESTORATION)) break;
        if (g.spellLegal(BORG_SPELL.REVITALIZE)) break;
        z += 150;
        if (trait(world, BI.CDEX) < 10) z += 100;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.LOSE_CON:
        z = dDice * dSide;
        if (trait(world, BI.SCON)) break;
        if (trait(world, BI.CCON) <= 3) break;
        if (g.spellLegal(BORG_SPELL.RESTORATION)) break;
        if (g.spellLegal(BORG_SPELL.REVITALIZE)) break;
        if (g.spellLegal(BORG_SPELL.UNHOLY_REPRIEVE)) break;
        z += 150;
        /* upstream checks CSTR here (preserved verbatim) */
        if (trait(world, BI.CSTR) < 8) z += 100;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.LOSE_INT:
        z = dDice * dSide;
        if (trait(world, BI.SINT)) break;
        if (trait(world, BI.CINT) <= 3) break;
        if (g.spellLegal(BORG_SPELL.RESTORATION)) break;
        if (g.spellLegal(BORG_SPELL.REVITALIZE)) break;
        if (g.spellLegal(BORG_SPELL.UNHOLY_REPRIEVE)) break;
        z += 150;
        if (spellStat === STAT_INT) z += 50;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.LOSE_WIS:
        z = dDice * dSide;
        if (trait(world, BI.SWIS)) break;
        if (trait(world, BI.CWIS) <= 3) break;
        if (g.spellLegal(BORG_SPELL.RESTORATION)) break;
        if (g.spellLegal(BORG_SPELL.REVITALIZE)) break;
        z += 150;
        if (spellStat === STAT_WIS) z += 50;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.LOSE_ALL:
        z = dDice * dSide;
        power = 2;
        /* only morgoth to make it easier to fight him */
        break;

      case MONBLOW.SHATTER:
        z = dDice * dSide;
        z -= div(z * (ac < 150 ? ac : 150), 250);
        power = 60;
        z += 150;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EXP_10:
        z = dDice * dSide;
        if (trait(world, BI.HLIFE)) break;
        if (clevel === 50) break;
        if (
          g.spellLegal(BORG_SPELL.REMEMBRANCE) ||
          g.spellLegal(BORG_SPELL.UNHOLY_REPRIEVE) ||
          g.spellLegal(BORG_SPELL.REVITALIZE)
        )
          break;
        z += 100;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EXP_20:
        z = dDice * dSide;
        if (trait(world, BI.HLIFE)) break;
        if (clevel >= 50) break;
        if (
          g.spellLegal(BORG_SPELL.REMEMBRANCE) ||
          g.spellLegal(BORG_SPELL.UNHOLY_REPRIEVE) ||
          g.spellLegal(BORG_SPELL.REVITALIZE)
        )
          break;
        z += 150;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EXP_40:
        z = dDice * dSide;
        if (trait(world, BI.HLIFE)) break;
        if (clevel >= 50) break;
        if (
          g.spellLegal(BORG_SPELL.REMEMBRANCE) ||
          g.spellLegal(BORG_SPELL.UNHOLY_REPRIEVE) ||
          g.spellLegal(BORG_SPELL.REVITALIZE)
        )
          break;
        z += 200;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.EXP_80:
        z = dDice * dSide;
        if (trait(world, BI.HLIFE)) break;
        if (clevel >= 50) break;
        if (
          g.spellLegal(BORG_SPELL.REMEMBRANCE) ||
          g.spellLegal(BORG_SPELL.UNHOLY_REPRIEVE) ||
          g.spellLegal(BORG_SPELL.REVITALIZE)
        )
          break;
        z += 250;
        if (pfe && !attacking) z = div(z, 2);
        break;

      case MONBLOW.HALLU:
        z = dDice * dSide;
        z += 250;
        if (pfe && !attacking) z = div(z, 2);
        break;

      default:
        /* NONE / PARALYZE-less / BLACK_BREATH etc.: no damage estimate. */
        break;
    }

    /* reduce by damage reduction */
    z -= trait(world, BI.DAM_RED);
    if (z < 0) z = 0;

    /* if partial damage, reduce by the % chance the monster hits you */
    if (!fullDamage) {
      let chance: number;
      if (g.fightingUnique || facts.level + power > 0)
        chance = 150 - (div(ac * 300, 4) + (facts.level + power) * 3);
      else chance = -1;

      if (chance < 5) chance = 5;
      z = div(z * chance, 100);
    }

    n += z;
  }

  return n;
}

/**
 * borg_danger_spell (borg-danger.c:556): estimate the danger from a monster's
 * ranged (innate + spell) attacks. Verbatim port of the RSF_ switch, the summon
 * "safe squares" logic, and the average-vs-worst return rule.
 */
export function borgDangerSpell(
  world: BorgWorld,
  g: DangerGlobals,
  facts: MonsterFacts,
  kill: BorgKill,
  y: number,
  x: number,
  d: number,
  average: boolean,
): number {
  let n = 0;
  let pfe = 0;
  let glyph = 0;
  let totalDam = 0;

  const temp = world.self.temp;
  const sp = facts.spellPower;
  const isMage = trait(world, BI.CLASS) === CLASS_MAGE;

  /* Apply PROTECTION_FROM_EVIL */
  if (
    temp.protFromEvil &&
    hasFlag(facts, "EVIL") &&
    trait(world, BI.CLEVEL) >= facts.level
  ) {
    pfe = 1;
  }

  /* Glyph of warding at (y, x) */
  if (g.onGlyph) {
    glyph = 1;
  } else if (g.trackGlyph.length) {
    for (const gp of g.trackGlyph) {
      if (gp.y === y && gp.x === x) glyph = 1;
    }
  }

  /* Mega-Hack -- unknown monsters */
  if (facts.rIdx === 0) return 1000;

  /* Paranoia -- Nothing to cast */
  if (!facts.spells.length) return 0;

  const hp = kill.power;
  const isUnique = hasFlag(facts, "UNIQUE");

  /* spot_safe helper for the summon cases (scan 8 neighbours of the monster). */
  const spotSafe = (): number => {
    let safe = 1;
    for (let sx = -1; sx <= 1; sx++) {
      for (let sy = -1; sy <= 1; sy++) {
        const gx = sx + kill.pos.x;
        const gy = sy + kill.pos.y;
        if (gx === kill.pos.x && gy === kill.pos.y) continue;
        if (!world.map.inBounds(gx, gy)) continue;
        if (borgFeatureProtected(world.map.at(gx, gy))) {
          safe++;
          if (safe === 0) safe = 1;
          if (safe === 8) safe = 100;
          if (g.morgothPosition || g.asPosition) safe = 1000;
        }
      }
    }
    return safe;
  };

  for (let q = 0; q < facts.spells.length; q++) {
    let p = 0;
    let z = 0;
    let bolt = false;

    switch (facts.spells[q]!) {
      case RSF.SHRIEK:
        p += 5;
        break;

      case RSF.WHIP:
        if (d < 3) z = 100;
        break;

      case RSF.SPIT:
        if (d < 4) z = 100;
        break;

      case RSF.SHOT:
        z = (div(sp, 8) + 1) * 5;
        break;

      case RSF.ARROW:
        z = (div(sp, 8) + 1) * 6;
        break;

      case RSF.BOLT:
        z = (div(sp, 8) + 1) * 7;
        break;

      case RSF.BR_ACID:
        if (trait(world, BI.IACID)) break;
        z = div(hp, 3);
        if (z > 1600) z = 1600;
        if (trait(world, BI.RACID)) z = div(z + 2, 3);
        if (temp.resAcid) z = div(z + 2, 3);
        p += 40;
        break;

      case RSF.BR_ELEC:
        if (trait(world, BI.IELEC)) break;
        z = div(hp, 3);
        if (z > 1600) z = 1600;
        if (trait(world, BI.RELEC)) z = div(z + 2, 3);
        if (temp.resElec) z = div(z + 2, 3);
        p += 20;
        break;

      case RSF.BR_FIRE:
        if (trait(world, BI.IFIRE)) break;
        z = div(hp, 3);
        if (z > 1600) z = 1600;
        if (trait(world, BI.RFIRE)) z = div(z + 2, 3);
        if (temp.resFire) z = div(z + 2, 3);
        p += 40;
        break;

      case RSF.BR_COLD:
        if (trait(world, BI.ICOLD)) break;
        z = div(hp, 3);
        if (z > 1600) z = 1600;
        if (trait(world, BI.RCOLD)) z = div(z + 2, 3);
        if (temp.resCold) z = div(z + 2, 3);
        p += 20;
        break;

      case RSF.BR_POIS:
        z = div(hp, 3);
        if (z > 800) z = 800;
        if (trait(world, BI.RPOIS)) z = div(z + 2, 3);
        if (temp.resPois) z = div(z + 2, 3);
        if (temp.resPois) break;
        if (trait(world, BI.RPOIS)) break;
        p += 20;
        break;

      case RSF.BR_NETH:
        z = div(hp, 6);
        if (z > 600) z = 600;
        if (trait(world, BI.RNTHR)) {
          z = div(z * 6, 9);
          break;
        }
        p += 125;
        break;

      case RSF.BR_LIGHT:
        z = div(hp, 6);
        if (z > 500) z = 500;
        if (trait(world, BI.RLITE)) {
          z = div(z * 2, 3);
          break;
        }
        if (trait(world, BI.RBLIND)) break;
        p += 20;
        if (isMage) p += 20;
        break;

      case RSF.BR_DARK:
        z = div(hp, 6);
        if (z > 500) z = 500;
        if (trait(world, BI.RDARK)) z = div(z * 2, 3);
        if (trait(world, BI.RDARK)) break;
        if (trait(world, BI.RBLIND)) break;
        p += 20;
        if (isMage) p += 20;
        break;

      case RSF.BR_SOUN:
        z = div(hp, 6);
        if (z > 500) z = 500;
        if (trait(world, BI.RSND)) z = div(z * 5, 9);
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) z += 500;
        if (trait(world, BI.ISHEAVYSTUN)) z += 1000;
        p += 50;
        break;

      case RSF.BR_CHAO:
        z = div(hp, 6);
        if (z > 600) z = 600;
        if (trait(world, BI.RKAOS)) z = div(z * 6, 9);
        p += 100;
        if (trait(world, BI.RKAOS)) break;
        p += 200;
        break;

      case RSF.BR_DISE:
        z = div(hp, 6);
        if (z > 500) z = 500;
        if (trait(world, BI.RDIS)) z = div(z * 6, 10);
        if (trait(world, BI.RDIS)) break;
        p += 500;
        break;

      case RSF.BR_NEXU:
        z = div(hp, 6);
        if (z > 400) z = 400;
        if (trait(world, BI.RNXUS)) z = div(z * 6, 10);
        if (trait(world, BI.RNXUS)) break;
        p += 100;
        break;

      case RSF.BR_TIME:
        z = div(hp, 3);
        if (z > 150) z = 150;
        p += 250;
        break;

      case RSF.BR_INER:
        z = div(hp, 6);
        if (z > 200) z = 200;
        p += 100;
        break;

      case RSF.BR_GRAV:
        z = div(hp, 3);
        if (z > 200) z = 200;
        p += 100;
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) z += 500;
        if (trait(world, BI.ISHEAVYSTUN)) z += 1000;
        break;

      case RSF.BR_SHAR:
        z = div(hp, 6);
        if (z > 500) z = 500;
        if (trait(world, BI.RSHRD)) z = div(z * 6, 9);
        if (trait(world, BI.RSHRD)) break;
        p += 50;
        break;

      case RSF.BR_PLAS:
        z = div(hp, 6);
        if (z > 150) z = 150;
        if (trait(world, BI.RSND)) break;
        p += 100;
        if (trait(world, BI.ISSTUN)) z += 500;
        if (trait(world, BI.ISHEAVYSTUN)) z += 1000;
        break;

      case RSF.BR_WALL:
        z = div(hp, 6);
        if (z > 200) z = 200;
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) z += 100;
        if (trait(world, BI.ISHEAVYSTUN)) z += 500;
        p += 50;
        break;

      case RSF.BR_MANA:
        z = div(hp, 3);
        if (z > 1600) z = 1600;
        break;

      case RSF.BOULDER:
        z = (1 + div(sp, 7)) * 12;
        bolt = true;
        break;

      case RSF.WEAVE:
        break;

      case RSF.BA_ACID:
        if (trait(world, BI.IACID)) break;
        z = sp * 3 + 15;
        if (trait(world, BI.RACID)) z = div(z + 2, 3);
        if (temp.resAcid) z = div(z + 2, 3);
        p += 40;
        break;

      case RSF.BA_ELEC:
        if (trait(world, BI.IELEC)) break;
        z = div(sp * 3, 2) + 8;
        if (trait(world, BI.RELEC)) z = div(z + 2, 3);
        if (temp.resElec) z = div(z + 2, 3);
        p += 20;
        break;

      case RSF.BA_FIRE:
        if (trait(world, BI.IFIRE)) break;
        z = div(sp * 7, 2) + 10;
        if (trait(world, BI.RFIRE)) z = div(z + 2, 3);
        if (temp.resFire) z = div(z + 2, 3);
        p += 40;
        break;

      case RSF.BA_COLD:
        if (trait(world, BI.ICOLD)) break;
        z = div(sp * 3, 2) + 10;
        if (trait(world, BI.RCOLD)) z = div(z + 2, 3);
        if (temp.resCold) z = div(z + 2, 3);
        p += 20;
        break;

      case RSF.BA_POIS:
        z = (div(sp, 2) + 3) * 4;
        if (trait(world, BI.RPOIS)) z = div(z + 2, 3);
        if (temp.resPois) z = div(z + 2, 3);
        if (temp.resPois) break;
        if (trait(world, BI.RPOIS)) break;
        p += 20;
        break;

      case RSF.BA_SHAR:
        z = div(sp * 3, 2) + 10;
        if (trait(world, BI.RSHRD)) z = div(z * 6, 9);
        if (trait(world, BI.RSHRD)) break;
        p += 20;
        break;

      case RSF.BA_NETH:
        z = sp * 4 + 10 * 10;
        if (trait(world, BI.RNTHR)) z = div(z * 6, 8);
        if (trait(world, BI.RNTHR)) break;
        p += 250;
        break;

      case RSF.BA_WATE:
        z = div(sp * 5, 2) + 50;
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) p += 500;
        if (trait(world, BI.ISHEAVYSTUN)) p += 1000;
        if (trait(world, BI.RCONF)) break;
        p += 50;
        if (isMage) p += 20;
        break;

      case RSF.BA_MANA:
        z = sp * 5 + 10 * 10;
        p += 50;
        break;

      case RSF.BA_HOLY:
        z = 10 + div(div(sp * 3, 2) + 1, 2);
        p += 50;
        break;

      case RSF.BA_DARK:
        z = sp * 4 + 10 * 10;
        if (trait(world, BI.RDARK)) z = div(z * 6, 9);
        if (trait(world, BI.RDARK)) break;
        if (trait(world, BI.RBLIND)) break;
        p += 20;
        if (isMage) p += 20;
        break;

      case RSF.BA_LIGHT:
        z = 10 + div(sp * 3, 2);
        if (trait(world, BI.RLITE)) z = div(z * 6, 9);
        if (trait(world, BI.RLITE)) break;
        if (trait(world, BI.RBLIND)) break;
        p += 20;
        if (isMage) p += 20;
        break;

      case RSF.STORM:
        z = 70 + sp * 5;
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) p += 500;
        if (trait(world, BI.ISHEAVYSTUN)) p += 1000;
        if (trait(world, BI.RCONF)) break;
        break;

      case RSF.DRAIN_MANA:
        if (trait(world, BI.MAXSP)) p += 100;
        break;

      case RSF.MIND_BLAST:
        if (trait(world, BI.SAV) < 100) z = div(sp, 2) + 1;
        break;

      case RSF.BRAIN_SMASH:
        z = div(12 * (15 + 1), 2);
        p += 200 - 2 * trait(world, BI.SAV);
        if (p < 0) p = 0;
        break;

      case RSF.WOUND:
        if (trait(world, BI.SAV) >= 100) break;
        z = div(sp, 3) * 2 * 5;
        z = div(z * (120 - trait(world, BI.SAV)), 100);
        break;

      case RSF.BO_ACID:
        bolt = true;
        if (trait(world, BI.IACID)) break;
        z = 7 * 8 + div(sp, 3);
        if (trait(world, BI.RACID)) z = div(z + 2, 3);
        if (temp.resAcid) z = div(z + 2, 3);
        p += 40;
        break;

      case RSF.BO_ELEC:
        if (trait(world, BI.IELEC)) break;
        bolt = true;
        z = 4 * 8 + div(sp, 3);
        if (trait(world, BI.RELEC)) z = div(z + 2, 3);
        if (temp.resElec) z = div(z + 2, 3);
        p += 20;
        break;

      case RSF.BO_FIRE:
        if (trait(world, BI.IFIRE)) break;
        bolt = true;
        z = 9 * 8 + div(sp, 3);
        if (trait(world, BI.RFIRE)) z = div(z + 2, 3);
        if (temp.resFire) z = div(z + 2, 3);
        p += 40;
        break;

      case RSF.BO_COLD:
        if (trait(world, BI.ICOLD)) break;
        bolt = true;
        z = 6 * 8 + div(sp, 3);
        if (trait(world, BI.RCOLD)) z = div(z + 2, 3);
        if (temp.resCold) z = div(z + 2, 3);
        p += 20;
        break;

      case RSF.BO_POIS:
        if (trait(world, BI.IPOIS)) break;
        z = 9 * 8 + div(sp, 3);
        if (trait(world, BI.RPOIS)) z = div(z + 2, 3);
        if (temp.resPois) z = div(z + 2, 3);
        bolt = true;
        break;

      case RSF.BO_NETH:
        bolt = true;
        z = 5 * 5 + div(sp * 3, 2) + 50;
        if (trait(world, BI.RNTHR)) z = div(z * 6, 8);
        if (trait(world, BI.RNTHR)) break;
        p += 200;
        break;

      case RSF.BO_WATE:
        z = 10 * 10 + sp;
        bolt = true;
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) p += 500;
        if (trait(world, BI.ISHEAVYSTUN)) p += 1000;
        if (trait(world, BI.RCONF)) break;
        p += 20;
        if (isMage) p += 20;
        break;

      case RSF.BO_MANA:
        z = div(sp * 5, 2) + 50;
        bolt = true;
        p += 50;
        break;

      case RSF.BO_PLAS:
        z = 10 + 8 * 7 + sp;
        bolt = true;
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) z += 500;
        if (trait(world, BI.ISHEAVYSTUN)) z += 1000;
        break;

      case RSF.BO_ICE:
        z = 6 * 6 + sp;
        bolt = true;
        p += 20;
        if (trait(world, BI.RSND)) break;
        if (trait(world, BI.ISSTUN)) z += 50;
        if (trait(world, BI.ISHEAVYSTUN)) z += 1000;
        break;

      case RSF.MISSILE:
        z = 2 * 6 + div(sp, 3);
        bolt = true;
        break;

      case RSF.BE_ELEC:
        if (trait(world, BI.IELEC)) break;
        z = 5 * 5 + sp * 2 + 30;
        if (trait(world, BI.RELEC)) z = div(z + 2, 3);
        if (temp.resElec) z = div(z + 2, 3);
        bolt = true;
        break;

      case RSF.BE_NETH:
        bolt = true;
        z = 5 * 5 + sp * 2 + 30;
        if (trait(world, BI.RNTHR)) z = div(z * 6, 8);
        if (trait(world, BI.RNTHR)) break;
        bolt = true;
        break;

      case RSF.SCARE:
        if (trait(world, BI.SAV) >= 100) break;
        p += 10;
        break;

      case RSF.BLIND:
        if (trait(world, BI.RBLIND)) break;
        if (trait(world, BI.SAV) >= 100) break;
        p += 10;
        break;

      case RSF.CONF:
        if (trait(world, BI.RCONF)) break;
        if (trait(world, BI.SAV) >= 100) break;
        p += 10;
        break;

      case RSF.SLOW:
        if (trait(world, BI.FRACT)) break;
        if (trait(world, BI.SAV) >= 100) break;
        p += 5;
        break;

      case RSF.HOLD:
        if (trait(world, BI.FRACT)) break;
        if (trait(world, BI.SAV) >= 100) break;
        p += 150;
        break;

      case RSF.HASTE:
        p += 10;
        break;

      case RSF.HEAL:
        p += 10;
        break;

      case RSF.HEAL_KIN:
        break;

      case RSF.BLINK:
        break;

      case RSF.TPORT:
        p += 10;
        break;

      case RSF.TELE_TO:
        p += 20;
        break;

      case RSF.TELE_SELF_TO:
        p += 20;
        break;

      case RSF.TELE_AWAY:
        p += 10;
        break;

      case RSF.TELE_LEVEL:
        if (trait(world, BI.SAV) >= 100) break;
        p += 50;
        break;

      case RSF.DARKNESS:
        p += 5;
        break;

      case RSF.TRAPS:
        p += 50;
        break;

      case RSF.FORGET:
        if (trait(world, BI.SAV) >= 100) break;
        if (trait(world, BI.CURSP) < 15) p += 500;
        else p += 30;
        break;

      case RSF.SHAPECHANGE:
        p += 200;
        break;

      case RSF.S_KIN: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 3;
          p = div(p, safe);
        } else {
          p += sp * 7;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_HI_DEMON: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 6;
          p = div(p, safe);
        } else {
          p += sp * 12;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_MONSTER: {
        const safe = spotSafe();
        if (pfe || glyph || g.createDoor || g.fightingUnique) p += 0;
        else {
          p += sp * 5;
          p = div(p, safe);
        }
        break;
      }

      case RSF.S_MONSTERS: {
        const safe = spotSafe();
        if (pfe || glyph || g.createDoor || g.fightingUnique) p += 0;
        else {
          p += sp * 7;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_ANIMAL: {
        const safe = spotSafe();
        if (pfe || glyph || g.createDoor || g.fightingUnique) p += 0;
        else {
          p += sp * 5;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_SPIDER: {
        const safe = spotSafe();
        if (pfe || glyph || g.createDoor || g.fightingUnique) p += 0;
        else {
          p += sp * 5;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_HOUND: {
        const safe = spotSafe();
        if (pfe || glyph || g.createDoor || g.fightingUnique) p += 0;
        else {
          p += sp * 5;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_HYDRA: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 2;
          p = div(p, safe);
        } else {
          p += sp * 5;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_AINU: {
        const safe = spotSafe();
        if (pfe || g.fightingUnique) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 3;
          p = div(p, safe);
        } else {
          p += sp * 7;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_DEMON: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 3;
          p = div(p, safe);
        } else {
          p += sp * 7;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_UNDEAD: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 3;
          p = div(p, safe);
        } else {
          p += sp * 7;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_DRAGON: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 3;
          p = div(p, safe);
        } else {
          p += sp * 7;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_HI_UNDEAD: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 6;
          p = div(p, safe);
        } else {
          p += sp * 12;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_HI_DRAGON: {
        const safe = spotSafe();
        if (pfe) {
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 6;
          p = div(p, safe);
        } else {
          p += sp * 12;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_WRAITH: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor || g.fightingUnique) {
          p += sp * 6;
          p = div(p, safe);
        } else {
          p += sp * 12;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      case RSF.S_UNIQUE: {
        const safe = spotSafe();
        if (pfe) {
          p += sp;
          p = div(p, safe);
        } else if (glyph || g.createDoor) {
          p += sp * 3; /* slightly reduced danger for unique */
          p = div(p, safe);
        } else {
          p += sp * 6;
          p = div(p, safe);
        }
        if (isUnique) p = div(p * 75, 100);
        break;
      }

      default:
        break;
    }

    /* A bolt spell cannot jump monsters to hit the borg. */
    if (
      bolt &&
      !borgProjectablePure(
        world,
        maxRangeOf(world),
        kill.pos.y,
        kill.pos.x,
        world.self.c.y,
        world.self.c.x,
      )
    )
      z = 0;

    /* Deep borgs stop caring about the 'effects' of an attack. */
    if (trait(world, BI.MAXDEPTH) >= 75) p = 0;

    /* Notice damage */
    p += z;

    /* Track the most dangerous spell */
    if (p > n) n = p;

    /* Track the damage of all the spells, used in averaging */
    totalDam += p;
  }

  /* reduce by damage reduction */
  totalDam -= trait(world, BI.DAM_RED);
  if (totalDam < 0) totalDam = 0;

  /* Slightly decrease danger if the borg sits in a sea of runes. */
  if (g.morgothPosition || g.asPosition) totalDam = div(totalDam * 7, 10);

  /* Average damage of all the spells & compare to most dangerous spell */
  const av = div(totalDam, facts.spells.length);

  if (!average) return av;
  if (n >= div(av * 15, 10) || n > div(trait(world, BI.CURHP) * 8, 10)) return n;
  return av;
}

/** z_info->max_range, defaulting to the 4.2.6 value (20) when unset. */
function maxRangeOf(world: BorgWorld): number {
  const st = getDangerState(world);
  return st.maxRange;
}

/**
 * A grid feat that a monster cannot move onto (closed door or perma-wall).
 * Mirrors the FEAT_CLOSED / FEAT_PERM early-continue in the C move sim.
 */
function isBlockingFeat(feat: number): boolean {
  return feat === FEAT.CLOSED || feat === FEAT.PERM;
}

/** The magma/quartz/rubble seam feats the move-sim wall branch tests. */
function isSeamFeat(feat: number): boolean {
  return (
    feat === FEAT.MAGMA ||
    feat === FEAT.QUARTZ ||
    feat === FEAT.MAGMA_K ||
    feat === FEAT.QUARTZ_K ||
    feat === FEAT.RUBBLE
  );
}

/**
 * borg_danger_one_kill (borg-danger.c:2288): the danger to grid (y, x) from the
 * monster tracked at kill index `i` over `c` player-moves. Verbatim port of the
 * energy/speed model, the movement+attack simulation, and every reduction.
 */
export function borgDangerOneKill(
  ctx: BorgContext,
  y: number,
  x: number,
  c: number,
  i: number,
  average: boolean,
  fullDamage: boolean,
): number {
  const world = ctx.world;
  const st = getDangerState(world);
  st.maxRange = ctx.view.constants().maxRange ?? 20;
  const g = st.globals;
  const kill = world.kills.at(i);
  const facts = g.resolveFacts(ctx, i);

  const x9 = kill.pos.x;
  const y9 = kill.pos.y;

  /* Paranoia */
  if (!kill.rIdx) return 0;

  /* Skip monsters marked as teleported-away in the current maneuver. */
  for (const idx of g.tpOtherIndices) {
    if (i === idx) return 0;
  }

  /* Distance components */
  const ax = x9 > x ? x9 - x : x - x9;
  const ay = y9 > y ? y9 - y : y - y9;
  let d = Math.max(ax, ay);
  if (d < 1) d = 1;
  if (d > 20) return 0;

  const temp = world.self.temp;
  const clevel = trait(world, BI.CLEVEL);

  let fakeSpeed = trait(world, BI.SPEED);
  let monsterSpeed = kill.speed;

  /* A very speedy borg will miscalculate danger of some monsters */
  if (trait(world, BI.SPEED) >= 135) fakeSpeed = g.fightingUnique ? 120 : 125;

  if (temp.fast) fakeSpeed += 10;
  if (g.slowSpell) monsterSpeed -= 10;

  /* Assume monsters are a little fast when you are low level */
  if (trait(world, BI.MAXHP) < 20 && trait(world, BI.CDEPTH)) monsterSpeed += 3;

  /* Player energy per game turn */
  let e = extractEnergy(fakeSpeed);
  /* Game turns per player move */
  const t = div(100 + (e - 1), e);
  /* Monster energy per game turn */
  e = extractEnergy(monsterSpeed);
  /* Monster moves */
  let q = c * div(t * e, 10);

  /* allow partial hits when not calculating full possible damage */
  if (fullDamage) q = div(q + 9, 10) * 10;

  /* Minimal energy: monsters get at least some. */
  if (q <= 10) q = 10;

  /** Danger from physical attacks **/
  let v1 = borgDangerPhysical(world, g, facts, fullDamage);

  if (world.self.timeThisPanel > 1200 || world.clock > 25000) v1 = div(v1, 5);

  if (hasFlag(facts, "NEVER_BLOW")) v1 = 0;
  if (hasFlag(facts, "NEVER_MOVE") && d > 1) v1 = 0;

  /* multipliers yield some trouble when I am weak */
  if (hasFlag(facts, "MULTIPLY") && clevel < 20) v1 = v1 + div(v1 * 15, 10);

  /* Friends yield some trouble when I am weak */
  if (facts.hasFriends && clevel < 20) {
    if (clevel < 15) v1 = v1 + div(v1 * 18, 10);
    else v1 = v1 + div(v1 * 13, 10);
  }

  /* Reduce danger from sleeping monsters */
  if (!kill.awake) {
    const inc = facts.sleep + 5;
    if (clevel >= 25) v1 = div(v1, 2);
    v1 = v1 + div(v1 * inc, 100);
  }
  /* sleep-2 spell */
  if (g.sleepSpellIi) {
    if (
      d === 1 &&
      kill.awake &&
      !hasFlag(facts, "NO_SLEEP") &&
      !hasFlag(facts, "UNIQUE") &&
      kill.level <= clevel - 15
    ) {
      if (clevel < 20 && trait(world, BI.CURHP) < div(trait(world, BI.MAXHP), 2))
        v1 = 0;
      else v1 = div(v1, 3);
    }
  }
  /* sleep-1/3 spell */
  if (g.sleepSpell) {
    if (
      kill.awake &&
      !hasFlag(facts, "NO_SLEEP") &&
      !hasFlag(facts, "UNIQUE") &&
      kill.level <= clevel - 15
    ) {
      if (clevel < 20 && trait(world, BI.CURHP) < div(trait(world, BI.MAXHP), 2))
        v1 = 0;
      else v1 = div(v1, d + 2);
    }
  }
  if (g.crushSpell) {
    if (div(kill.power * (100 - kill.injury), 100) < clevel * 4) {
      const ag = world.map.inBounds(x9, y9) ? world.map.at(x9, y9) : null;
      if (ag && ag.info & BORG_VIEW && borgCaveFloorGridForKill(ag.feat)) v1 = 0;
    }
  }

  /* Reduce danger from confused / stunned monsters */
  if (kill.confused) v1 = div(v1, 2);
  if (kill.stunned) v1 = div(v1 * 10, 13);
  if (g.confuseSpell) {
    if (
      kill.awake &&
      !kill.confused &&
      !hasFlag(facts, "NO_SLEEP") &&
      !hasFlag(facts, "UNIQUE") &&
      kill.level <= clevel - 15
    ) {
      if (clevel < 20 && trait(world, BI.CURHP) < div(trait(world, BI.MAXHP), 2))
        v1 = 0;
      else v1 = div(v1, d + 2);
    }
  }
  /* Perceive a reduced danger from scared monsters */
  if (g.fearMonSpell) v1 = 0;

  /* Physical attacks require proximity (movement + attack in one round). */
  if (q > 10 && d !== 1 && !hasFlag(facts, "NEVER_MOVE")) {
    let bV1 = 0;

    for (let ii = 0; ii < 8; ii++) {
      const yTemp = y9 + ddy_ddd[ii]!;
      const xTemp = x9 + ddx_ddd[ii]!;

      if (!squareInBoundsFully(xTemp, yTemp)) continue;
      const ag = world.map.at(xTemp, yTemp);
      if (ag.kill) continue;
      if (isBlockingFeat(ag.feat)) continue;

      if (ag.feat === FEAT.GRANITE || isSeamFeat(ag.feat)) {
        if (hasFlag(facts, "PASS_WALL")) {
          if (borgDistance(yTemp, xTemp, y, x) === 1) bV1 = v1;
        }
        if (hasFlag(facts, "KILL_WALL")) {
          if (borgDistance(yTemp, xTemp, y, x) === 1) bV1 = v1;
        }
      }

      if (borgDistance(yTemp, xTemp, y, x) > 1) continue;

      if (borgCaveFloorBold(world, yTemp, xTemp)) {
        bV1 = v1 * div(q, d * 10);
      }
    }

    v1 = bV1;
  }

  /* Fast monster striking more than once per round */
  if (q > 10 && d === 1) v1 = div(v1 * q, 10);

  /* Need to be close if you are normal speed */
  if (q === 10 && d > 1) v1 = 0;

  /** Ranged Attacks **/
  let v2 = borgDangerSpell(world, g, facts, kill, y, x, d, average);

  /* Never cast spells */
  if (!facts.freqInnate && !facts.freqSpell) v2 = 0;

  const maxRange = getDangerState(world).maxRange;

  /* Verify distance */
  if (borgDistance(y9, x9, y, x) > maxRange) v2 = 0;

  /* Verify line of sight (both ways) for slow monsters. */
  if (
    q <= 10 &&
    !borgProjectable(world, g, maxRange, y9, x9, y, x) &&
    !borgProjectable(world, g, maxRange, y, x, y9, x9)
  )
    v2 = 0;

  /* Fast monsters can move and still range-attack: check LOS from each grid
   * they could move to. */
  if (q >= 20) {
    const bQ = q;
    let bV2 = 0;

    if (q > 20) q = 20;

    for (let ii = 0; ii < 8; ii++) {
      const yTemp = y9 + ddy_ddd[ii]!;
      const xTemp = x9 + ddx_ddd[ii]!;

      if (!squareInBoundsFully(xTemp, yTemp)) continue;
      const ag = world.map.at(xTemp, yTemp);
      if (ag.kill) continue;
      if (isBlockingFeat(ag.feat)) continue;

      if (ag.feat >= FEAT.GRANITE || isSeamFeat(ag.feat)) {
        if (hasFlag(facts, "PASS_WALL")) {
          if (borgProjectable(world, g, maxRange, yTemp, xTemp, y, x))
            bV2 = div(v2 * bQ, 10);
        }
        if (hasFlag(facts, "KILL_WALL")) {
          if (borgProjectable(world, g, maxRange, yTemp, xTemp, y, x))
            bV2 = div(v2 * bQ, 10);
        }
      } else if (borgProjectable(world, g, maxRange, yTemp, xTemp, y, x)) {
        bV2 = div(v2 * bQ, 10);
      }
    }

    v2 = bV2;
  }

  if (world.self.timeThisPanel > 1200 || world.clock > 25000) v2 = div(v2, 5);

  if (hasFlag(facts, "MULTIPLY") && clevel < 20) v2 = v2 + div(v2 * 12, 10);

  if (facts.hasFriends && clevel < 20) v2 = v2 + div(v2 * 12, 10);

  if (!kill.awake) {
    const inc = facts.sleep + 5;
    if (clevel >= 25) v2 = div(v2, 2);
    v2 = v2 + div(v2 * inc, 100);
  }

  if (g.sleepSpellIi) {
    /* cap = clevel<15 ? clevel : ((clevel-10)/4)*3 + 10 (borg-danger.c:2731). */
    const cap = clevel < 15 ? clevel : div(clevel - 10, 4) * 3 + 10;
    if (
      d === 1 &&
      kill.awake &&
      !hasFlag(facts, "NO_SLEEP") &&
      !hasFlag(facts, "UNIQUE") &&
      kill.level <= cap
    ) {
      v2 = div(v2, 3);
    }
  }

  if (g.crushSpell) {
    if (div(kill.power * (100 - kill.injury), 100) < clevel * 4) {
      const ag = world.map.inBounds(x9, y9) ? world.map.at(x9, y9) : null;
      if (ag && ag.info & BORG_VIEW && borgCaveFloorGridForKill(ag.feat)) v1 = 0;
    }
  }

  if (g.sleepSpell) v2 = div(v2, d + 2);
  if (kill.confused) v2 = div(v2, 2);
  if (kill.stunned) v2 = div(v2 * 10, 13);
  if (g.confuseSpell) v2 = div(v2, 6);

  if (!fullDamage) {
    const chance = div(facts.freqInnate + facts.freqSpell, 2);
    if (chance < 11) v2 = div(v2 * 4, 10);
    else if (chance < 26) v2 = div(v2 * 6, 10);
    else if (chance < 51) v2 = div(v2 * 8, 10);
  }

  /* Danger */
  if (v2) {
    const r = q;
    v2 = div(v2 * r, 10);
  }

  let p = Math.max(v1, v2);
  if (p > 2000) p = 2000;
  return p;
}

/** borg_cave_floor_grid over a raw feat (used inside the crush check). */
function borgCaveFloorGridForKill(feat: number): boolean {
  return (
    feat === FEAT.NONE ||
    feat === FEAT.FLOOR ||
    feat === FEAT.OPEN ||
    feat === FEAT.MORE ||
    feat === FEAT.LESS ||
    feat === FEAT.BROKEN ||
    feat === FEAT.PASS_RUBBLE ||
    feat === FEAT.LAVA
  );
}

/**
 * borg_danger (borg-danger.c:2825): the total danger at grid (y, x) over `c`
 * player-moves, summing the regional/monster fear caches and every tracked
 * monster's borg_danger_one_kill. Note the upstream quirk that full_damage is
 * forced true here regardless of the argument.
 */
export function borgDanger(
  ctx: BorgContext,
  y: number,
  x: number,
  c: number,
  average: boolean,
  fullDamage: boolean,
): number {
  void fullDamage;
  const world = ctx.world;
  const st = getDangerState(world);
  st.maxRange = ctx.view.constants().maxRange ?? 20;
  let p = 0;

  if (x < 0 || x >= AUTO_MAX_X || y < 0 || y >= AUTO_MAX_Y) return 2000;

  const cdepth = trait(world, BI.CDEPTH);
  const isVaultHere = false; /* GAP: borg map carries no vault flag (see fear.ts). */

  /* Base danger from regional fear (not within a vault, not too deep). */
  if (!isVaultHere && cdepth <= 80) {
    p += st.fear.region(y, x) * c;
  }

  /* Reduce regional fear on Depth 100 */
  if (cdepth === 100 && p >= 300) p = 300;

  /* Added danger from a lot of monsters. */
  if (world.self.timeThisPanel <= 200 && !isVaultHere) {
    p += st.fear.monsters(y, x) * c;
  }

  /* full_damage is forced true here (upstream borg-danger.c:2851). */
  const forcedFull = true;

  /* Examine all the monsters (borg-danger.c:2854, i in [1, borg_kills_nxt)). */
  for (const [i] of world.kills.entries()) {
    p += borgDangerOneKill(ctx, y, x, c, i, average, forcedFull);
  }

  return p > 2000 ? 2000 : p;
}
