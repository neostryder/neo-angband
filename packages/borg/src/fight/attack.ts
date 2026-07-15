/**
 * The Borg's best-attack chooser and damage simulator - a faithful port of
 * reference/src/borg/borg-fight-attack.c.
 *
 * The engine of fidelity here is the "simulate then commit" pattern: borg_attack
 * builds the near-monster list, then for every BF_* method calls
 * borg_calculate_attack_effectiveness with borg_simulate = true to score the
 * method's net reward (damage + danger-bonus, minus mana/charge penalties),
 * picks the highest, and re-runs that one BF_* with borg_simulate = false to
 * actually perform it. This port keeps that exact structure; the C's
 * borg_keypress side effects become an AgentCommand stored on the FightState's
 * `pending`, which borgAttack returns.
 *
 * Every damage formula, resist multiplier, threshold and priority is preserved
 * with a reference file:line citation. Simulation randomness is drawn ONLY from
 * ctx.rng (the Borg's own quick-RNG), never the game RNG.
 *
 * DATA GAPS (documented, faithful defaults; P8.6 injects a real resolver):
 *  - r_ptr->ac is not on MonsterFacts; the to-hit gate uses ac = 0 (borg always
 *    "hits" AC), an over-estimate that never suppresses an attack.
 *  - r_ptr->speed (race base speed) is not on MonsterFacts; the status-spell
 *    branches use kill.speed for both sides of the `kill->speed < r_ptr->speed-5`
 *    test (so the guard never fires), documented per site.
 *  - r_ptr->d_char is unavailable; the OLD_DRAIN "Egv" symbol guard is dropped
 *    (the RF_UNDEAD/RF_DEMON guards remain).
 *  - borg_takes carry tval but not sval/aware; borg_launch_destroy_stuff applies
 *    the base tval penalty only (the ring-of-speed / cool-potion specials are
 *    skipped).
 */

import type { AgentCommand, ItemView } from "@neo-angband/core";
import { RSF } from "@neo-angband/core";
import type { BorgContext } from "../context";
import type { MonsterFacts } from "../danger";
import {
  borgDanger,
  borgDangerOneKill,
  getDangerGlobals,
  borgLos,
  borgProjectablePure,
  borgIncMotion,
  MONBLOW,
} from "../danger";
import {
  BI,
  CLASS_MAGE,
  CLASS_NECROMANCER,
  CLASS_DRUID,
  CLASS_PRIEST,
  CLASS_ROGUE,
  CLASS_RANGER,
  CLASS_PALADIN,
} from "../trait/trait-index";
import { trait } from "../item/deps";
import type { BorgKill } from "../world/kill";
import { FEAT, borgCaveFloorGrid } from "../flow/flow-consts";
import { GOAL_KILL } from "../world/model";
import { AUTO_MAX_X, AUTO_MAX_Y } from "../world/grid";
import { TV, SVAL } from "../item/svals";
import {
  Spell,
  borgSpell,
  borgSpellFail,
  borgSpellOkay,
  borgSpellOkayFail,
  borgSpellLegal,
  borgSpellLegalFail,
  borgGetSpellPower,
} from "../item/magic";
import {
  borgAimWand,
  borgZapRod,
  borgUseStaff,
  borgEquipsRod,
  borgEquipsStaffFail,
  borgActivateItem,
  borgEquipsItem,
  borgActivateRing,
  borgEquipsRing,
  borgActivateDragon,
  borgEquipsDragon,
  borgActivateFailure,
} from "../item/item-use";
import { borgSlot } from "../item/deps";
import { borgExtractDir } from "../flow/flow-consts";
import { getFightState, idiv, iabs, type FightState } from "./state";
import { BA, BF, BTH_PLUS_ADJ } from "./bf";
import { borgOffsetProjectable, borgTarget } from "./projection";

/* ---------------------------------------------------------------- *
 * Small shared readers
 * ---------------------------------------------------------------- */

/** avoidance (borg-flow.c global): shared via the danger globals. */
function avoidance(ctx: BorgContext): number {
  return getDangerGlobals(ctx.world).avoidance;
}

/** Resolve a kill index to its MonsterFacts (the danger resolver seam). */
function factsOf(ctx: BorgContext, i: number): MonsterFacts {
  return getDangerGlobals(ctx.world).resolveFacts(ctx, i);
}

/** rf_has(r_ptr->flags, RF_NAME) via the resolved facts (unprefixed names). */
function rf(facts: MonsterFacts, name: string): boolean {
  return facts.flags.has(name);
}

/** rsf_has(r_ptr->spell_flags, RSF_X) via the resolved spell list. */
function rsf(facts: MonsterFacts, code: number): boolean {
  return facts.spells.includes(code);
}

/** distance(a, b) = MAX(|dy|,|dx|) (Angband Chebyshev metric). */
function dist(y1: number, x1: number, y2: number, x2: number): number {
  return Math.max(iabs(y1 - y2), iabs(x1 - x2));
}

/** The race name of a tracked monster (from its MonsterView), or "". */
function raceName(ctx: BorgContext, mIdx: number): string {
  for (const m of ctx.view.monsters()) if (m.id === mIdx) return m.race;
  return "";
}

/** z_info->max_range (20 in 4.2.6). */
function maxRange(ctx: BorgContext): number {
  return ctx.view.constants().maxRange ?? 20;
}

/* ---------------------------------------------------------------- *
 * Physical (thrust) damage estimate  (attack.c:100 borg_thrust_damage_one)
 * ---------------------------------------------------------------- */

/** Guess the damage a physical attack does to monster i (attack.c:100). */
export function borgThrustDamageOne(ctx: BorgContext, i: number): number {
  const kill = ctx.world.kills.at(i);
  const facts = factsOf(ctx, i);

  /* "player ghosts" (kill->r_idx >= r_max-1): not modelled here (P8.6 supplies
   * r_max). rIdx 0 already means dead; a live tracked kill is a real race. */
  if (!kill.rIdx) return 0;

  /* Weapon dice via the borg's own derived traits (WDD/WDS/WTODAM/WTOHIT). */
  let dam = idiv(trait(ctx, BI.WDD) * (trait(ctx, BI.WDS) + 1), 2);

  /* Slays / brands from the borg's weapon-flag traits (attack.c:132). */
  let mult = 1;
  if (
    (trait(ctx, BI.WS_ANIMAL) && rf(facts, "ANIMAL")) ||
    (trait(ctx, BI.WS_EVIL) && rf(facts, "EVIL"))
  )
    mult = 2;
  if (
    (trait(ctx, BI.WS_UNDEAD) && rf(facts, "UNDEAD")) ||
    (trait(ctx, BI.WS_DEMON) && rf(facts, "DEMON")) ||
    (trait(ctx, BI.WS_ORC) && rf(facts, "ORC")) ||
    (trait(ctx, BI.WS_TROLL) && rf(facts, "TROLL")) ||
    (trait(ctx, BI.WS_GIANT) && rf(facts, "GIANT")) ||
    (trait(ctx, BI.WS_DRAGON) && rf(facts, "DRAGON")) ||
    (trait(ctx, BI.WB_ACID) && !rf(facts, "IM_ACID")) ||
    (trait(ctx, BI.WB_FIRE) && !rf(facts, "IM_FIRE")) ||
    (trait(ctx, BI.WB_COLD) && !rf(facts, "IM_COLD")) ||
    (trait(ctx, BI.WB_POIS) && !rf(facts, "IM_POIS")) ||
    (trait(ctx, BI.WB_ELEC) && !rf(facts, "IM_ELEC"))
  )
    mult = 3;
  if (
    (trait(ctx, BI.WK_UNDEAD) && rf(facts, "UNDEAD")) ||
    (trait(ctx, BI.WK_DEMON) && rf(facts, "DEMON")) ||
    (trait(ctx, BI.WK_DRAGON) && rf(facts, "DRAGON"))
  )
    mult = 5;

  dam *= mult;
  dam += trait(ctx, BI.WTODAM);
  dam += trait(ctx, BI.TODAM);
  dam *= trait(ctx, BI.BLOWS);

  /* Bonuses for combat (attack.c:165). */
  let chance = trait(ctx, BI.THN) + (trait(ctx, BI.TOHIT) + trait(ctx, BI.WTOHIT)) * 3;

  /* Chance of hitting the monster's AC. GAP: r_ptr->ac == 0. */
  const ac = 0;
  if (chance < idiv(idiv(ac * 3, 4) * 8, 10)) dam = 0;

  if (chance > 95) chance = 95;
  if (chance < 5) chance = 5;

  if (trait(ctx, BI.CLEVEL) > 15) chance += 10;

  if (
    (trait(ctx, BI.CLASS) === CLASS_MAGE || trait(ctx, BI.CLASS) === CLASS_NECROMANCER) &&
    trait(ctx, BI.CURSP) > 1
  )
    chance -= 10;

  dam = idiv(dam * chance, 100);
  if (dam <= 0) dam = 1;

  /* Limit to twice max hitpoints (unless unique) (attack.c:194). */
  if (dam > kill.power * 2 && !rf(facts, "UNIQUE")) dam = kill.power * 2;

  /* Mages should not melee if avoidable (attack.c:201). */
  if (
    (trait(ctx, BI.CLASS) === CLASS_MAGE || trait(ctx, BI.CLASS) === CLASS_NECROMANCER) &&
    trait(ctx, BI.MAXCLEVEL) < 40 &&
    trait(ctx, BI.CURSP) > 1
  )
    dam = idiv(dam * 8, 10) + 1;

  /* Unique preference (attack.c:214). */
  if (rf(facts, "UNIQUE") && trait(ctx, BI.CDEPTH) >= 1) dam += dam * 5;
  if (rf(facts, "UNIQUE") && trait(ctx, BI.CDEPTH) === 0) {
    dam = idiv(dam * 2, 3);
    if (trait(ctx, BI.CLEVEL) < 5) dam = 0;
  }

  /* Breeder bonus (attack.c:231). */
  if (rf(facts, "MULTIPLY")) dam = idiv(dam * 3, 2);

  /* Summoner preference (attack.c:237). */
  if (isSummoner(facts)) dam += idiv(dam * 3, 2);

  /* Questor massive bonus (attack.c:258). */
  if (rf(facts, "QUESTOR")) dam += dam * 5;

  return dam;
}

/** The summoner RSF_S_* set (attack.c:237 & attack.c:1172). */
function isSummoner(facts: MonsterFacts): boolean {
  const s = RSF as unknown as Record<string, number>;
  const codes = [
    "S_KIN", "S_HI_DEMON", "S_MONSTER", "S_MONSTERS", "S_ANIMAL", "S_SPIDER",
    "S_HOUND", "S_HYDRA", "S_AINU", "S_DEMON", "S_UNDEAD", "S_DRAGON",
    "S_HI_DRAGON", "S_HI_UNDEAD", "S_WRAITH", "S_UNIQUE",
  ];
  for (const c of codes) {
    const v = s[c];
    if (typeof v === "number" && rsf(facts, v)) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- *
 * Brand/slay multiplier for launched ammo (attack.c:374 borg_best_mult)
 * ---------------------------------------------------------------- */

/* 4.2.6 brand table (brand.txt): code -> mult, resist flag, vuln flag. */
const BRAND_TABLE: Record<string, { mult: number; im: string; vuln?: string }> = {
  ACID: { mult: 3, im: "IM_ACID" },
  ELEC: { mult: 3, im: "IM_ELEC" },
  FIRE: { mult: 3, im: "IM_FIRE", vuln: "HURT_FIRE" },
  COLD: { mult: 3, im: "IM_COLD", vuln: "HURT_COLD" },
  POIS: { mult: 3, im: "IM_POIS" },
};
/* 4.2.6 slay table (slay.txt): matched by containment of the race token. */
const SLAY_TABLE: Array<{ token: string; mult: number; race: string }> = [
  { token: "ANIMAL", mult: 2, race: "ANIMAL" },
  { token: "EVIL", mult: 2, race: "EVIL" },
  { token: "UNDEAD", mult: 3, race: "UNDEAD" },
  { token: "DEMON", mult: 3, race: "DEMON" },
  { token: "ORC", mult: 3, race: "ORC" },
  { token: "TROLL", mult: 3, race: "TROLL" },
  { token: "GIANT", mult: 3, race: "GIANT" },
  { token: "DRAGON", mult: 3, race: "DRAGON" },
];

/**
 * borg_best_mult (attack.c:374): the best brand/slay multiplier of a bow or
 * ammo against a monster. Ported from ItemView brand/slay codes and the 4.2.6
 * brand/slay tables (the engine brands[]/slays[] arrays). "*slay*" x5 codes are
 * matched by the trailing token too (UNDEAD/DEMON/DRAGON), taking the max.
 */
export function borgBestMult(obj: ItemView | null, facts: MonsterFacts): number {
  let maxMult = 1;
  if (!obj) return maxMult;

  for (const code of obj.brands) {
    const b = BRAND_TABLE[code.toUpperCase()];
    if (!b) continue;
    if (!facts.flags.has(b.im)) {
      let mult = b.mult;
      if (b.vuln && facts.flags.has(b.vuln)) mult *= 2;
      if (mult > maxMult) maxMult = mult;
    }
  }
  for (const code of obj.slays) {
    const up = code.toUpperCase();
    for (const s of SLAY_TABLE) {
      if (!up.includes(s.token)) continue;
      if (facts.flags.has(s.race)) {
        /* "*slay*" (kill) variants carry a higher multiplier; honour a trailing
         * _5 / KILL token when present, else the base table multiplier. */
        const isKill = up.includes("KILL") || up.endsWith("5");
        const mult = isKill ? 5 : s.mult;
        if (mult > maxMult) maxMult = mult;
      }
    }
  }
  return maxMult;
}

/* ---------------------------------------------------------------- *
 * Ranged / spell damage estimate  (attack.c:437 borg_launch_damage_one)
 * ---------------------------------------------------------------- */

/** Guess ranged/spell damage to monster i (attack.c:437). */
export function borgLaunchDamageOne(
  ctx: BorgContext,
  fs: FightState,
  i: number,
  dam: number,
  typ: number,
  ammo: ItemView | null,
): number {
  const g = getDangerGlobals(ctx.world);
  const kill = ctx.world.kills.at(i);
  const facts = factsOf(ctx, i);
  if (!kill.rIdx) return 0;

  const curDis = dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x);

  /* gold eater detection (attack.c:478) via resolved blows. */
  let goldEater = false;
  for (const b of facts.blows) if (b.effect === MONBLOW.EAT_GOLD) goldEater = true;

  let borgUseMissile = false;

  switch (typ) {
    case BA.MISSILE:
      break;
    case BA.ARROW: {
      /* to-hit gate (attack.c:492). GAP: r_ptr->ac == 0 -> armor = curDis. */
      const bow = findBow(ctx);
      const bonus =
        trait(ctx, BI.TOHIT) +
        (bow ? bow.toH : 0) +
        (ammo ? ammo.toH : 0);
      const chance = trait(ctx, BI.THB) + bonus * BTH_PLUS_ADJ;
      const armor = 0 + curDis;
      let mult = borgBestMult(bow, facts);
      mult = Math.max(mult, borgBestMult(ammo, facts));
      dam *= mult;
      if (curDis === 1 && !rf(facts, "UNIQUE")) dam = idiv(dam, 5);
      if (chance < idiv(armor * 8, 10)) dam = 0;
      break;
    }
    case BA.MANA:
      if (g.fightingUnique && ctx.world.self.has.length > 0) {
        /* borg.has[kv_potion_restore_mana] > 3: restore-mana stock; GAP -> use
         * BI trait if wired, else skip the x2. Faithful conservative default. */
      }
      break;
    case BA.METEOR:
      break;
    case BA.ACID:
      if (rf(facts, "IM_ACID")) dam = 0;
      break;
    case BA.ELEC:
      if (rf(facts, "IM_ELEC")) dam = 0;
      break;
    case BA.FIRE:
      if (rf(facts, "IM_FIRE")) dam = 0;
      if (rf(facts, "HURT_FIRE")) dam *= 2;
      break;
    case BA.COLD:
      if (rf(facts, "IM_COLD")) dam = 0;
      if (rf(facts, "HURT_COLD")) dam *= 2;
      break;
    case BA.POIS:
      if (rf(facts, "IM_POIS")) dam = 0;
      break;
    case BA.ICE:
      if (rf(facts, "IM_COLD")) dam = 0;
      break;
    case BA.HOLY_ORB:
      if (rf(facts, "EVIL")) dam *= 2;
      break;
    case BA.DISP_UNDEAD:
      if (!rf(facts, "UNDEAD")) dam = 0;
      break;
    case BA.DISP_SPIRITS:
      if (!rf(facts, "SPIRIT")) dam = 0;
      break;
    case BA.DISP_EVIL:
      if (!rf(facts, "EVIL")) dam = 0;
      break;
    case BA.DRAIN_LIFE:
      if (!rf(facts, "NONLIVING")) dam = 0;
      if (!rf(facts, "UNDEAD")) dam = 0;
      break;
    case BA.HOLY_WORD:
      if (!rf(facts, "EVIL")) dam = 0;
      break;
    case BA.LIGHT_WEAK:
      if (!rf(facts, "HURT_LIGHT")) dam = 0;
      break;
    case BA.OLD_DRAIN:
      if (curDis === 1) dam = idiv(dam, 5);
      /* GAP: r_ptr->d_char "Egv" guard dropped; UNDEAD/DEMON guards kept. */
      if (rf(facts, "UNDEAD") || rf(facts, "DEMON")) dam = 0;
      break;
    case BA.KILL_WALL:
      if (!rf(facts, "HURT_ROCK")) dam = 0;
      break;
    case BA.NETHER:
      if (rf(facts, "UNDEAD")) dam = 0;
      else if (rsf(facts, RSF.BR_NETH)) dam = idiv(dam * 3, 9);
      else if (rf(facts, "EVIL")) dam = idiv(dam, 2);
      break;
    case BA.CHAOS:
      if (rsf(facts, RSF.BR_CHAO)) dam = idiv(dam * 3, 9);
      if (!rf(facts, "UNIQUE")) dam = -999;
      break;
    case BA.GRAVITY:
      if (rsf(facts, RSF.BR_GRAV)) dam = idiv(dam * 3, 9);
      break;
    case BA.SHARD:
      if (rsf(facts, RSF.BR_SHAR)) dam = idiv(dam * 3, 9);
      break;
    case BA.SOUND:
      if (rsf(facts, RSF.BR_SOUN)) dam = idiv(dam * 3, 9);
      break;
    case BA.PLASMA:
      if (rsf(facts, RSF.BR_PLAS)) dam = idiv(dam * 3, 9);
      break;
    case BA.CONFU:
      if (rf(facts, "NO_CONF")) dam = 0;
      break;
    case BA.DISEN:
      if (rsf(facts, RSF.BR_DISE)) dam = idiv(dam * 3, 9);
      break;
    case BA.NEXUS:
      if (rsf(facts, RSF.BR_NEXU)) dam = idiv(dam * 3, 9);
      break;
    case BA.FORCE:
      if (rsf(facts, RSF.BR_WALL)) dam = idiv(dam * 3, 9);
      break;
    case BA.INERTIA:
      if (rsf(facts, RSF.BR_INER)) dam = idiv(dam * 3, 9);
      break;
    case BA.TIME:
      if (rsf(facts, RSF.BR_TIME)) dam = idiv(dam * 3, 9);
      break;
    case BA.LIGHT:
      if (rsf(facts, RSF.BR_LIGHT)) dam = idiv(dam * 3, 9);
      break;
    case BA.DARK:
      if (rsf(facts, RSF.BR_DARK)) dam = idiv(dam * 3, 9);
      break;
    case BA.WATER:
      if (rsf(facts, RSF.BA_WATE)) dam = idiv(dam * 3, 9);
      dam = idiv(dam, 2);
      break;
    case BA.OLD_HEAL:
    case BA.OLD_CLONE:
    case BA.OLD_SPEED:
    case BA.DARK_WEAK:
    case BA.KILL_DOOR:
    case BA.KILL_TRAP:
    case BA.MAKE_WALL:
    case BA.MAKE_DOOR:
    case BA.MAKE_TRAP:
    case BA.AWAY_UNDEAD:
    case BA.TURN_EVIL:
      dam = 0;
      break;

    case BA.AWAY_ALL:
      dam = teleportAwayValue(ctx, fs, i, kill, facts, dam);
      break;

    case BA.AWAY_ALL_MORGOTH:
      dam = teleportAwayMorgothValue(ctx, fs, i, kill, facts);
      break;

    case BA.DISP_ALL:
      if (rf(facts, "UNIQUE")) {
        dam = 0;
        break;
      }
      dam = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, true);
      break;

    case BA.OLD_CONF:
      dam = statusSpellValue(ctx, i, kill, facts, "confuseSpell", { needConfCheck: true });
      break;
    case BA.TURN_ALL:
      dam = statusSpellValue(ctx, i, kill, facts, "fearMonSpell", { noFear: true });
      break;
    case BA.OLD_SLOW:
      dam = statusSpellValue(ctx, i, kill, facts, "slowSpell", {});
      break;
    case BA.OLD_SLEEP:
    case BA.SLEEP_EVIL:
      dam = statusSpellValue(ctx, i, kill, facts, "sleepSpell", {
        noSleep: true,
        evilOnly: typ === BA.SLEEP_EVIL,
      });
      break;
    case BA.OLD_POLY: {
      dam = 0;
      if (
        kill.level >
        (trait(ctx, BI.CLEVEL) < 13
          ? 10
          : idiv(trait(ctx, BI.CLEVEL) - 10, 4) * 3 + 10)
      )
        break;
      dam = -999;
      if (rf(facts, "UNIQUE")) break;
      dam = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 2, i, true, true);
      if (dam < avoidance(ctx) * 2 && !kill.afraid) dam = 0;
      break;
    }
    case BA.TURN_UNDEAD:
      if (rf(facts, "UNDEAD")) {
        dam = 0;
        if (kill.confused) break;
        /* GAP: r_ptr->speed unavailable; kill.speed used both sides. */
        if (kill.speed < kill.speed - 5) break;
        if (!kill.awake) break;
        if (kill.level > trait(ctx, BI.CLEVEL) - 5) break;
        g.fearMonSpell = false;
        const p1 = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, true);
        g.fearMonSpell = true;
        const p2 = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, true);
        g.fearMonSpell = false;
        dam = p1 - p2;
      } else dam = 0;
      break;

    case BA.AWAY_EVIL:
      if (rf(facts, "EVIL")) {
        if (rf(facts, "UNIQUE")) {
          if (facts.hasFriends) dam = 0;
          else dam = -500;
        } else {
          dam = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, true);
        }
      } else dam = 0;
      break;

    case BA.TAP_UNLIFE:
      if (!rf(facts, "UNDEAD")) dam = 0;
      else {
        const spDrain = 0; /* attack.c:1103 CURSP-CURSP == 0 */
        if (spDrain < kill.power) dam = kill.power - spDrain;
      }
      break;

    case BA.CURSE:
      dam = idiv(idiv(trait(ctx, BI.CLEVEL), 12) * (50 + kill.injury + 1), 2);
      break;

    case BA.ELEC_STRIKE:
      if (rf(facts, "IM_ELEC")) dam = 0;
      else if (
        !borgProjectablePure(ctx.world, maxRange(ctx), ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x)
      )
        dam = 0;
      break;
  }

  /* use Missiles on certain types of monsters (attack.c:1124). */
  if (
    trait(ctx, BI.CDEPTH) >= 1 &&
    (borgDangerOneKill(ctx, kill.pos.y, kill.pos.x, 1, i, true, true) > idiv(avoidance(ctx) * 2, 10) ||
      (facts.hasFriends && kill.level >= trait(ctx, BI.CLEVEL) - 5) ||
      kill.rangedAttack ||
      rf(facts, "UNIQUE") ||
      rf(facts, "MULTIPLY") ||
      goldEater ||
      rf(facts, "NEVER_MOVE") ||
      trait(ctx, BI.CLEVEL) <= 20)
  ) {
    borgUseMissile = true;
  }

  /* Teleport-away types return pure danger (attack.c:1139). */
  if (typ === BA.AWAY_ALL || typ === BA.AWAY_EVIL || typ === BA.AWAY_ALL_MORGOTH) return dam;

  /* Limit to twice max hitpoints (attack.c:1144). */
  if (dam > kill.power * 2 && !rf(facts, "UNIQUE")) dam = kill.power * 2;

  /* Unique preference (attack.c:1149). */
  if (rf(facts, "UNIQUE") && trait(ctx, BI.CDEPTH) >= 1) dam = dam * 3;
  if (rf(facts, "UNIQUE") && trait(ctx, BI.CDEPTH) === 0) {
    dam = idiv(dam * 2, 3);
    if (trait(ctx, BI.CLEVEL) < 5) dam = 0;
  }

  /* Breeder bonus (attack.c:1166). */
  if (rf(facts, "MULTIPLY")) dam = idiv(dam * 3, 2);

  /* Summoner preference (attack.c:1172). */
  if (isSummoner(facts)) dam += idiv(dam * 3, 2);

  /* Questor bonus (attack.c:1194). */
  if (rf(facts, "QUESTOR")) dam += dam * 9;

  /* Conserve missiles (attack.c:1199). */
  if (typ === BA.ARROW && !borgUseMissile) dam = 0;

  return dam;
}

/** Find the wielded bow (TV.BOW) in equipment, or null. */
function findBow(ctx: BorgContext): ItemView | null {
  for (const it of ctx.view.equipment()) {
    if (it && it.number > 0 && it.tval === TV.BOW) return it;
  }
  return null;
}

/* The AWAY_ALL teleport-other bookkeeping (attack.c:768). Pushes exclusion
 * indices onto the danger globals so borg_danger skips them, exactly as the C
 * filled borg_tp_other_*. Returns the provisional dam (recomputed as danger
 * reduction later in borg_launch_bolt). */
function teleportAwayValue(
  ctx: BorgContext,
  fs: FightState,
  i: number,
  kill: BorgKill,
  facts: MonsterFacts,
  dam: number,
): number {
  const g = getDangerGlobals(ctx.world);
  const push = () => g.tpOtherIndices.push(i);
  if (rf(facts, "UNIQUE")) {
    if (kill.injury >= 60) return -9999;
    if (g.asPosition) return -9999;
    if (dam > idiv(avoidance(ctx) * 13, 10) && trait(ctx, BI.CDEPTH) <= 98) {
      push();
    } else if (fs.fightingUnique >= 2 && fs.fightingUnique <= 8) {
      push();
    } else if (trait(ctx, BI.CLASS) === CLASS_MAGE && dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) <= 2) {
      push();
    } else if (ctx.world.facts.vaultOnLevel) {
      /* Unique next to >=2 perma grids -> banish (attack.c:815). */
      let vaultGrids = 0;
      for (let ii = 0; ii < 8; ii++) {
        const dx = [0, 0, 1, -1, 1, -1, 1, -1][ii]!;
        const dy = [1, -1, 0, 0, 1, 1, -1, -1][ii]!;
        const x = kill.pos.x + dx;
        const y = kill.pos.y + dy;
        if (!ctx.world.map.inBounds(x, y)) continue;
        const f = ctx.world.map.at(x, y).feat;
        if (f === FEAT.NONE) continue;
        if (f === FEAT.PERM) vaultGrids++;
      }
      if (vaultGrids >= 2) push();
    } else {
      return -999;
    }
  } else {
    push();
  }
  return dam;
}

/* AWAY_ALL_MORGOTH (attack.c:857). */
function teleportAwayMorgothValue(
  ctx: BorgContext,
  fs: FightState,
  i: number,
  kill: BorgKill,
  _facts: MonsterFacts,
): number {
  const g = getDangerGlobals(ctx.world);
  let dam = 0;
  for (let j = 0; j < 8; j++) {
    const dx = [0, 0, 1, -1, 1, -1, 1, -1][j]!;
    const dy = [1, -1, 0, 0, 1, 1, -1, -1][j]!;
    const y2 = kill.pos.y + dy;
    const x2 = kill.pos.x + dx;
    if (!ctx.world.map.inBounds(x2, y2)) continue;
    if (ctx.world.map.at(x2, y2).glyph) {
      g.tpOtherIndices.push(i);
      dam = 300;
    }
  }
  if (ctx.world.facts.morgothOnLevel && !g.morgothPosition) {
    g.tpOtherIndices.push(i);
    dam = 100;
  }
  if (trait(ctx, BI.CURSP) <= 35) {
    g.tpOtherIndices.push(i);
    dam = 150;
  }
  void fs;
  return dam;
}

/* OLD_CONF / OLD_SLOW / OLD_SLEEP / TURN_ALL shared danger-difference estimator
 * (attack.c:914..1035). The flag key selects which danger global to toggle. */
function statusSpellValue(
  ctx: BorgContext,
  i: number,
  kill: BorgKill,
  facts: MonsterFacts,
  flag: "confuseSpell" | "slowSpell" | "sleepSpell" | "fearMonSpell",
  opt: { needConfCheck?: boolean; noFear?: boolean; noSleep?: boolean; evilOnly?: boolean },
): number {
  const g = getDangerGlobals(ctx.world);
  let dam = 0;
  if (opt.noSleep && rf(facts, "NO_SLEEP")) return 0;
  if (opt.evilOnly && !rf(facts, "EVIL")) return 0;
  if (opt.needConfCheck && rf(facts, "NO_CONF")) return 0;
  if (opt.needConfCheck && rf(facts, "MULTIPLY")) return 0;
  if (opt.noFear && rf(facts, "NO_FEAR")) return 0;
  /* GAP: r_ptr->speed unavailable; kill.speed used both sides (guard off). */
  if (kill.speed < kill.speed - 5) return 0;
  if (kill.confused) return 0;
  if (!kill.awake) return 0;
  if (
    kill.level >
    (trait(ctx, BI.CLEVEL) < 13 ? 10 : idiv(trait(ctx, BI.CLEVEL) - 10, 4) * 3 + 10)
  )
    return 0;
  dam = -999;
  if (rf(facts, "UNIQUE")) return dam;

  g[flag] = false;
  let p1 = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, true);
  if (kill.afraid && trait(ctx, BI.CLEVEL) <= 10) p1 = p1 + 20;
  g[flag] = true;
  const p2 = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, true);
  g[flag] = false;
  return p1 - p2;
}

/* ---------------------------------------------------------------- *
 * Bolt/beam/ball path simulation (attack.c:1212..2066)
 * ---------------------------------------------------------------- */

/** borg_launch_bolt_aux_hack (attack.c:1212): damage to one monster grid. */
function borgLaunchBoltAuxHack(
  ctx: BorgContext,
  fs: FightState,
  i: number,
  dam: number,
  typ: number,
  ammo: ItemView | null,
): number {
  if (i <= 0 || !ctx.world.kills.has(i)) return 0;
  const kill = ctx.world.kills.at(i);
  const facts = factsOf(ctx, i);
  if (!kill.rIdx) return 0;

  /* Require current knowledge (attack.c:1241). */
  if (kill.when < ctx.world.clock - 2) return 0;

  const x = kill.pos.x;
  const y = kill.pos.y;
  if (!ctx.world.map.inBounds(x, y)) return 0;
  const ag = ctx.world.map.at(x, y);
  if (!borgCaveFloorGrid(ag)) return 0;

  /* ghost-in-wall checks (attack.c:1256) require RF_PASS_WALL; when the resolver
   * supplies it we honour the "2 walls + 1 unknown" skip. */
  if (rf(facts, "PASS_WALL")) {
    if (
      ag.feat !== FEAT.FLOOR &&
      ag.feat !== FEAT.OPEN &&
      ag.feat !== FEAT.BROKEN &&
      !ag.trap
    )
      return 0;
    let walls = 0;
    let unknown = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox;
        const yy = y + oy;
        if (!ctx.world.map.inBounds(xx, yy)) continue;
        const f = ctx.world.map.at(xx, yy).feat;
        if (f >= FEAT.MAGMA && f <= FEAT.PERM) walls++;
        if (f === FEAT.NONE) unknown++;
      }
    }
    if (walls >= 2 && unknown >= 1) return 0;
  }

  let d = borgLaunchDamageOne(ctx, fs, i, dam, typ, ammo);

  if (typ === BA.AWAY_ALL || typ === BA.AWAY_ALL_MORGOTH) return d;
  if (typ === BA.AWAY_EVIL) return d;
  if (d <= 0) return d;

  const p2 = borgDangerOneKill(ctx, y, x, 1, i, true, false);
  /* Avoid waking hard sleepers (attack.c:1310). */
  if (!kill.awake && p2 > idiv(avoidance(ctx), 2) && d < kill.power && !ctx.world.self.munchkinMode)
    return -999;

  /* Ignore sleeping town monsters (attack.c:1316). */
  if (!trait(ctx, BI.CDEPTH) && !kill.awake) return 0;

  const p1 = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, i, true, false);

  if (d >= kill.power) d = 2 * d;
  d = d + p1;
  return d;
}

/** borg_launch_destroy_stuff (attack.c:1344). GAP: takes carry tval only. */
function borgLaunchDestroyStuff(ctx: BorgContext, takeIdx: number, typ: number): number {
  if (!ctx.world.takes.has(takeIdx)) return 0;
  const t = ctx.world.takes.at(takeIdx);
  switch (typ) {
    case BA.ACID:
      if (t.tval === TV.BOOTS) return 20;
      break;
    case BA.ELEC:
      if (t.tval === TV.RING) return 20;
      break;
    case BA.FIRE:
      if (t.tval === TV.BOOTS) return 20;
      break;
    case BA.COLD:
      if (t.tval === TV.POTION) return 20;
      break;
  }
  return 0;
}

/** borg_launch_bolt_at_location (attack.c:1424): reward of a bolt/beam/ball. */
function borgLaunchBoltAtLocation(
  ctx: BorgContext,
  fs: FightState,
  y2: number,
  x2: number,
  rad: number,
  dam: number,
  typ: number,
  max: number,
  ammo: ItemView | null,
): number {
  let n = 0;
  const x1 = ctx.world.self.c.x;
  const y1 = ctx.world.self.c.y;
  if (!squareInBoundsFully(x2, y2)) return 0;

  let x = x1;
  let y = y1;
  const kill0 = killAtGrid(ctx, y2, x2);
  const facts0 = kill0 ? factsOf(ctx, kill0) : null;

  let dist = 1;
  for (; dist < max; dist++) {
    [y, x] = borgIncMotion(y, x, y1, x1, y2, x2);
    if (!squareInBoundsFully(x, y)) break;
    const ag = ctx.world.map.at(x, y);

    /* Stop at walls (attack.c:1489). */
    if (!borgCaveFloorGrid(ag) || ag.feat === FEAT.PASS_RUBBLE) {
      if (rad !== -1 && rad !== 10) return 0;
      return n;
    }

    /* Collect damage (bolts/beams) (attack.c:1497). */
    if (rad <= 0 || rad === 10) n += borgLaunchBoltAuxHack(ctx, fs, ag.kill, dam, typ, ammo);

    /* Arrival for non-beams (attack.c:1502). */
    if (rad !== -1 && rad !== 10 && x === x2 && y === y2) break;

    /* Stop bolts at monsters (attack.c:1506). */
    if (!rad && ag.kill) return n;

    /* Missile-path visibility checks (attack.c:1543). Simplified faithfully:
     * without ESP, stop at unknown grids; honour the successful_target miss
     * skip. (The magic-map/fear-region ESP fast-path degrades to the no-ESP
     * behaviour, which is the conservative choice.) */
    if (!trait(ctx, BI.ESP)) {
      if (trait(ctx, BI.INFRA) <= 0 && !factsHasLight(facts0)) {
        if (ag.feat === FEAT.NONE) {
          if (rad !== -1 && rad !== 10) return 0;
          return n;
        }
      }
      if (fs.successfulTarget < 0) {
        if (fs.successfulTarget <= -12) fs.successfulTarget = 0;
        if (rad !== -1 && rad !== 10) return 0;
        return n;
      }
    } else if (fs.successfulTarget < 0) {
      if (fs.successfulTarget <= -12) fs.successfulTarget = 0;
      if (rad !== -1 && rad !== 10) return 0;
      return n;
    }
  }

  if (rad <= 0) return n;
  if (dist >= max) return 0;

  /* Blast radius (attack.c:1628). */
  for (let ry = y2 - rad; ry < y2 + rad; ry++) {
    for (let rx = x2 - rad; rx < x2 + rad; rx++) {
      if (!squareInBounds(rx, ry)) continue;
      const ag = ctx.world.map.at(rx, ry);
      let r = dist2(y2, x2, ry, rx);
      if (r > rad) continue;
      if (!borgLos(ctx.world, y2, x2, ry, rx)) continue;
      if (rad === 10) r = 0;
      n += borgLaunchBoltAuxHack(ctx, fs, ag.kill, idiv(dam, r + 1), typ, ammo);
      if (ag.take && ctx.world.takes.has(ag.take)) n -= borgLaunchDestroyStuff(ctx, ag.take, typ);
    }
  }
  return n;
}

/** Whether a monster race is self-lighting (r_ptr->light > 0). GAP: unknown -> false. */
function factsHasLight(_facts: MonsterFacts | null): boolean {
  return false;
}

/** kill index at grid or 0. */
function killAtGrid(ctx: BorgContext, y: number, x: number): number {
  if (!ctx.world.map.inBounds(x, y)) return 0;
  return ctx.world.map.at(x, y).kill;
}

function squareInBounds(x: number, y: number): boolean {
  return x >= 0 && x < AUTO_MAX_X && y >= 0 && y < AUTO_MAX_Y;
}
function squareInBoundsFully(x: number, y: number): boolean {
  return x >= 1 && x < AUTO_MAX_X - 1 && y >= 1 && y < AUTO_MAX_Y - 1;
}
function dist2(y1: number, x1: number, y2: number, x2: number): number {
  return Math.max(iabs(y1 - y2), iabs(x1 - x2));
}

/**
 * borg_launch_bolt (attack.c:1677): choose the best target grid for a
 * beam/bolt/ball and, on commit, target it. Returns the reward.
 */
export function borgLaunchBolt(
  ctx: BorgContext,
  fs: FightState,
  rad: number,
  dam: number,
  typ: number,
  max: number,
  ammo: ItemView | null,
): number {
  const g = getDangerGlobals(ctx.world);
  let bI = -1;
  let bN = -1;
  let bOy = 0;
  let bOx = 0;
  let bD = maxRange(ctx);

  for (let i = 0; i < fs.tempN; i++) {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = fs.tempX[i]! + ox;
        const y = fs.tempY[i]! + oy;

        g.tpOtherIndices.length = 0;
        let n = 0;

        if (!squareInBounds(x, y)) continue;
        const d = dist2(ctx.world.self.c.y, ctx.world.self.c.x, fs.tempY[i]!, fs.tempX[i]!);

        if ((x !== fs.tempX[i] || y !== fs.tempY[i]) && typ === BA.AWAY_ALL) continue;
        if (dist2(ctx.world.self.c.y, ctx.world.self.c.x, y, x) > max) continue;

        if (
          (rad >= 2 && ctx.world.map.inBounds(x, y) && ctx.world.map.at(x, y).feat !== FEAT.NONE) ||
          (y === fs.tempY[i] && x === fs.tempX[i])
        )
          n = borgLaunchBoltAtLocation(ctx, fs, y, x, rad, dam, typ, max, ammo);

        if (typ === BA.AWAY_ALL && n > 0) {
          n = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, false);
          n = dam - n;
        }

        g.tpOtherIndices.length = 0;

        if (n <= 0) continue;
        if (x === 0 || y === 0 || x === ctx.world.map.width - 1 || y === ctx.world.map.height - 1) continue;
        if (bI >= 0 && n < bN) continue;
        if (n === bN && d > bD) continue;

        bI = i;
        bN = n;
        bOy = oy;
        bOx = ox;
        bD = d;
      }
    }
  }
  if (bI === -1) return bN;

  g.tpOtherIndices.length = 0;

  if (fs.simulate) return bN;

  /* Commit: target the chosen grid. */
  const gx = fs.tempX[bI]! + bOx;
  const gy = fs.tempY[bI]! + bOy;
  ctx.world.self.goal.g.x = gx;
  ctx.world.self.goal.g.y = gy;
  const requireMonster = typ === BA.CURSE;
  borgTarget(ctx, gy, gx, requireMonster);
  return bN;
}

/** borg_launch_arc_at_location (attack.c:1816), simplified faithful port. */
function borgLaunchArcAtLocation(
  ctx: BorgContext,
  fs: FightState,
  y2: number,
  x2: number,
  degrees: number,
  dam: number,
  typ: number,
  max: number,
): number {
  let n = 0;
  const x1 = ctx.world.self.c.x;
  const y1 = ctx.world.self.c.y;
  if (!squareInBoundsFully(x2, y2)) return 0;

  const kill0 = killAtGrid(ctx, y2, x2);
  const facts0 = kill0 ? factsOf(ctx, kill0) : null;

  const pathGrids: Array<{ y: number; x: number }> = [{ y: y1, x: x1 }];
  let x = x1;
  let y = y1;
  let dist = 1;
  for (; dist < max; dist++) {
    [y, x] = borgIncMotion(y, x, y1, x1, y2, x2);
    if (!squareInBoundsFully(x, y)) break;
    const ag = ctx.world.map.at(x, y);
    if (!borgCaveFloorGrid(ag) || ag.feat === FEAT.PASS_RUBBLE) break;
    pathGrids[dist] = { y, x };
    if (x === x2 && y === y2) break;
    if (ag.feat === FEAT.NONE) {
      if (trait(ctx, BI.ESP)) {
        if (trait(ctx, BI.INFRA) <= 0 && !factsHasLight(facts0)) break;
      }
      if (fs.successfulTarget < 0) {
        if (fs.successfulTarget <= -12) fs.successfulTarget = 0;
        break;
      }
    }
  }
  if (dist < 21) dist = dist - 1;
  else dist = 20;
  const end = pathGrids[dist] ?? { y, x };

  /* Angular arc test (attack.c:1936). Ported using get_angle_to_grid via the
   * atan2 approximation: a grid is inside the arc if the half-angle between the
   * centre line and the grid is under (degrees+6)/4. */
  const centreAngle = angleTo(end.y - y1, end.x - x1);
  for (let ry = y1 - max; ry < y1 + max; ry++) {
    for (let rx = x1 - max; rx < x1 + max; rx++) {
      if (!squareInBounds(rx, ry)) continue;
      const ag = ctx.world.map.at(rx, ry);
      const r = dist2(y1, x1, ry, rx);
      if (r > max) continue;
      if (!borgLos(ctx.world, y1, x1, ry, rx)) continue;
      const gridAngle = angleTo(ry - y1, rx - x1);
      let diff = iabs(centreAngle - gridAngle);
      if (diff > 180) diff = 360 - diff;
      if (diff >= idiv(degrees + 6, 4)) continue;
      if (ag.kill) n += borgLaunchBoltAuxHack(ctx, fs, ag.kill, idiv(dam, r + 1), typ, null);
      if (ag.take && ctx.world.takes.has(ag.take)) n -= borgLaunchDestroyStuff(ctx, ag.take, typ);
    }
  }
  return n;
}

/** Angle of (dy,dx) in degrees [0,360), matching get_angle_to_grid semantics. */
function angleTo(dy: number, dx: number): number {
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** borg_launch_arc (attack.c:1999). */
export function borgLaunchArc(
  ctx: BorgContext,
  fs: FightState,
  degrees: number,
  dam: number,
  typ: number,
  maxIn: number,
): number {
  let max = maxIn;
  if (max > 20) max = 20;
  let bI = -1;
  let bN = -1;
  let bD = maxRange(ctx);

  for (let i = 0; i < fs.tempN; i++) {
    const x = fs.tempX[i]!;
    const y = fs.tempY[i]!;
    const d = dist2(ctx.world.self.c.y, ctx.world.self.c.x, y, x);
    if (d > max) continue;
    const n = borgLaunchArcAtLocation(ctx, fs, y, x, degrees, dam, typ, max);
    if (n <= 0) continue;
    if (bI >= 0 && n < bN) continue;
    if (n === bN && d > bD) continue;
    bI = i;
    bN = n;
    bD = d;
  }
  if (bI === -1) return bN;
  if (fs.simulate) return bN;
  const gx = fs.tempX[bI]!;
  const gy = fs.tempY[bI]!;
  ctx.world.self.goal.g.x = gx;
  ctx.world.self.goal.g.y = gy;
  borgTarget(ctx, gy, gx, false);
  return bN;
}

/* ---------------------------------------------------------------- *
 * The attack aux functions (attack.c:268..3776)
 * ---------------------------------------------------------------- */

/** borg_attack_aux_thrust (attack.c:268): best adjacent melee. */
function auxThrust(ctx: BorgContext, fs: FightState): number {
  if (trait(ctx, BI.ISAFRAID) || trait(ctx, BI.CRSFEAR)) return 0;
  let bI = -1;
  let bD = -1;
  for (let i = 0; i < fs.tempN; i++) {
    const x = fs.tempX[i]!;
    const y = fs.tempY[i]!;
    if (dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x) > 1) continue;
    const ag = ctx.world.map.at(x, y);
    let d = borgThrustDamageOne(ctx, ag.kill);
    if (d <= 0) continue;
    const kill = ctx.world.kills.at(ag.kill);

    if (!kill.awake && d <= kill.power && !ctx.world.self.munchkinMode) {
      const p = borgDangerOneKill(ctx, y, x, 1, ag.kill, true, true);
      if (p > avoidance(ctx) * 2) continue;
    }
    if (!trait(ctx, BI.CDEPTH) && !kill.awake) continue;

    let p = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 2, ag.kill, true, true);
    if (d <= kill.power && trait(ctx, BI.MAXCLEVEL) > 15) p = idiv(p, 10);
    d += p;
    if (bI >= 0 && d < bD) continue;
    bI = i;
    bD = d;
  }
  if (bI < 0) return 0;
  if (fs.simulate) return bD;

  ctx.world.self.goal.g.x = fs.tempX[bI]!;
  ctx.world.self.goal.g.y = fs.tempY[bI]!;
  const dir = borgExtractDir(ctx.world.self.c.y, ctx.world.self.c.x, ctx.world.self.goal.g.y, ctx.world.self.goal.g.x);
  fs.pending = ctx.act.melee(dir);
  return bD;
}

/** borg_attack_aux_launch (attack.c:2071): fire the best missile. */
function auxLaunch(ctx: BorgContext, fs: FightState): number {
  const bow = findBow(ctx);
  if (!bow) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;

  let bN = 0;
  let bV = -1;
  let bAmmo: ItemView | null = null;
  const ammoTval = trait(ctx, BI.AMMO_TVAL);

  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval !== ammoTval) continue;
    if ((item.value ?? 0) <= 0) continue;
    let d = idiv(item.dd * (item.ds + 1), 2);
    d = d + item.toD + bow.toD;
    d = d * trait(ctx, BI.AMMO_POWER) * trait(ctx, BI.SHOTS);
    const v = item.value ?? 0;
    /* unID boost omitted (needs note-needs-id); faithful conservative default. */
    if (d <= 0) continue;
    const n = borgLaunchBolt(ctx, fs, 0, d, BA.ARROW, 6 + 2 * trait(ctx, BI.AMMO_POWER), item);
    if (n === bN && v >= bV) continue;
    if (n >= bN) {
      bN = n;
      bV = v;
      bAmmo = item;
    }
  }
  if (bN < 0) return 0;
  if (fs.simulate) return bN;
  if (bAmmo) {
    /* Re-target with the chosen ammo, then fire. */
    borgLaunchBolt(ctx, fs, 0, 1, BA.ARROW, 6 + 2 * trait(ctx, BI.AMMO_POWER), bAmmo);
    fs.pending = ctx.act.fire(bAmmo.handle);
    fs.successfulTarget = -2;
  }
  return bN;
}

/** borg_attack_aux_object (attack.c:2274): throw the best object. */
function auxObject(ctx: BorgContext, fs: FightState): number {
  let bK: ItemView | null = null;
  let bD = -1;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    /* skip spellbooks / wieldables / ammo handled elsewhere (attack.c:2294). */
    if (item.tval === TV.MAGIC_BOOK || item.tval === TV.PRAYER_BOOK) continue;
    const d = idiv(item.dd * (item.ds + 1), 2);
    if ((item.value ?? 0) > 100 && d < 5) continue;
    if (d <= 0) continue;
    if (item.tval === TV.POTION) continue;
    if (item.tval === TV.FLASK && trait(ctx, BI.AFUEL) <= 1 && !fs.fightingUnique) continue;
    if (item.tval === TV.WAND || item.tval === TV.ROD) continue;
    if (bK && d <= bD) continue;
    bK = item;
    bD = d;
  }
  if (!bK) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  const bN = borgLaunchBolt(ctx, fs, 0, bD, BA.ARROW, 6 + 2 * trait(ctx, BI.AMMO_POWER), bK);
  if (fs.simulate) return bN;
  fs.pending = ctx.act.throw(bK.handle);
  fs.successfulTarget = -2;
  return bN;
}

/** borg_attack_aux_rest (attack.c:2169): wait for an approaching monster. */
function auxRest(ctx: BorgContext, fs: FightState): number {
  if (fs.simulate && ctx.world.self.goal.waiting) {
    ctx.world.self.goal.waiting = false;
    return 0;
  }
  const myDanger = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, false, false);
  let found = false;
  for (const [i, kill] of ctx.world.kills.entries()) {
    const facts = factsOf(ctx, i);
    const ax = iabs(kill.pos.x - ctx.world.self.c.x);
    const ay = iabs(kill.pos.y - ctx.world.self.c.y);
    const d = Math.max(ax, ay);
    if (d !== 2) continue;
    if (kill.rangedAttack) continue;
    if (!kill.awake) continue;
    if (ctx.world.clock - kill.when > 10) continue;
    if (rf(facts, "NEVER_MOVE")) continue;
    if (kill.speed - trait(ctx, BI.SPEED) >= 5) continue;
    if (kill.afraid || kill.confused || kill.stunned) continue;
    if (ctx.world.self.goal.type !== GOAL_KILL) continue;
    if (!borgLos(ctx.world, ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x)) continue;
    if (myDanger > trait(ctx, BI.CURHP)) continue;
    found = true;
    break;
  }
  if (!found) return 0;
  if (fs.simulate) return 1;
  fs.pending = ctx.act.rest();
  ctx.world.self.goal.waiting = true;
  return 1;
}

/** Class primary attack spell (attack.c:2424). */
function primarySpellForClass(ctx: BorgContext): Spell {
  switch (trait(ctx, BI.CLASS)) {
    case CLASS_MAGE:
      return Spell.MAGIC_MISSILE;
    case CLASS_DRUID:
      return Spell.STINKING_CLOUD;
    case CLASS_PRIEST:
      return Spell.ORB_OF_DRAINING;
    case CLASS_NECROMANCER:
      return Spell.NETHER_BOLT;
    default:
      return Spell.MAGIC_MISSILE;
  }
}

/** Class final-teleport reserve mana (attack.c:2474). */
function teleportReserve(ctx: BorgContext): number {
  switch (trait(ctx, BI.CLASS)) {
    case CLASS_MAGE: return 6;
    case CLASS_RANGER: return 22;
    case CLASS_ROGUE: return 20;
    case CLASS_PRIEST: return 8;
    case CLASS_PALADIN: return 20;
    case CLASS_NECROMANCER: return 10;
    default: return 0;
  }
}

/** borg_attack_aux_spell_bolt (attack.c:2388). */
function auxSpellBolt(
  ctx: BorgContext,
  fs: FightState,
  spell: Spell,
  rad: number,
  dam: number,
  typ: number,
  maxR: number,
  isArc: boolean,
): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (
    fs.simulate &&
    trait(ctx, BI.CLASS) !== CLASS_MAGE &&
    trait(ctx, BI.CLASS) !== CLASS_NECROMANCER &&
    trait(ctx, BI.CLEVEL) <= 2 &&
    ctx.rng.randint0(100) < 1
  )
    return 0;
  if (
    trait(ctx, BI.FOOD) === 0 &&
    trait(ctx, BI.ISWEAK) &&
    (borgSpellLegal(ctx, Spell.REMOVE_HUNGER) || borgSpellLegal(ctx, Spell.HERBAL_CURING))
  )
    return 0;
  if (!borgSpellOkayFail(ctx, spell, fs.fightingUnique ? 40 : 25)) return 0;

  let bN = isArc
    ? borgLaunchArc(ctx, fs, rad, dam, typ, maxR)
    : borgLaunchBolt(ctx, fs, rad, dam, typ, maxR, null);

  const primary = primarySpellForClass(ctx);
  if (
    spell === primary &&
    (!borgSpellLegalFail(ctx, Spell.TELEPORT_SELF, 15) || trait(ctx, BI.MAXCLEVEL) <= 30)
  ) {
    if (fs.simulate) return bN;
  } else {
    const spellPower = borgGetSpellPower(ctx, spell);
    if (spell !== primary) {
      bN = bN - spellPower;
      if (trait(ctx, BI.MAXSP) < 50 && spellPower > bN) bN = bN - spellPower;
      if (trait(ctx, BI.CURSP) - spellPower < idiv(trait(ctx, BI.MAXSP), 2)) bN = bN - spellPower * 3;
      if (trait(ctx, BI.CURSP) - spellPower < idiv(trait(ctx, BI.MAXSP), 3)) bN = bN - spellPower * 5;
    }
    const penalty = teleportReserve(ctx);
    if (trait(ctx, BI.MAXSP) > 30 && trait(ctx, BI.CURSP) - spellPower < penalty) bN = bN - spellPower * 750;
  }

  if (fs.simulate) return bN;
  fs.pending = borgSpell(ctx, spell);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_spell_bolt_reserve (attack.c:2518): emergency MM (neg mana). */
function auxSpellBoltReserve(
  ctx: BorgContext,
  fs: FightState,
  spell: Spell,
  rad: number,
  dam: number,
  typ: number,
  maxR: number,
): number {
  if (trait(ctx, BI.CLEVEL) >= 15) return 0;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (trait(ctx, BI.FOOD) === 0 && trait(ctx, BI.ISWEAK) && borgSpellLegal(ctx, Spell.REMOVE_HUNGER)) return 0;
  if (borgSpellOkayFail(ctx, spell, 25)) return 0;
  if (borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, false) < avoidance(ctx) * 2) return 0;

  let nearMonsters = 0;
  for (const [, kill] of ctx.world.kills.entries()) {
    const d = dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x);
    if (d < 7) nearMonsters++;
    if (kill.power > dam + 4) return 0;
    if (trait(ctx, BI.CDEPTH) === 0) return 0;
    break;
  }
  if (nearMonsters > 1) return 0;
  /* Faked full-mana legality check: we can't mutate CURSP, so require legality
   * ignoring cost (borgSpellLegalFail at MAXSP is equivalent to borg_spell_okay
   * with faked mana for these low-cost spells). */
  if (!borgSpellLegalFail(ctx, spell, 25)) return 0;

  const bN = borgLaunchBolt(ctx, fs, rad, dam, typ, maxR, null);
  if (fs.simulate) return bN;
  fs.pending = borgSpellFail(ctx, spell, 25);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_spell_dispel (attack.c:2643). */
function auxSpellDispel(ctx: BorgContext, fs: FightState, spell: Spell, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (
    trait(ctx, BI.FOOD) === 0 &&
    trait(ctx, BI.ISWEAK) &&
    (borgSpellLegal(ctx, Spell.REMOVE_HUNGER) || borgSpellLegal(ctx, Spell.HERBAL_CURING))
  )
    return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 2) return 0;
  if (!borgSpellOkayFail(ctx, spell, 25)) return 0;

  let bN = borgLaunchBolt(ctx, fs, 10, dam, typ, maxRange(ctx), null);
  const spellPower = borgGetSpellPower(ctx, spell);
  bN = bN - spellPower;
  if (trait(ctx, BI.CURSP) - spellPower < idiv(trait(ctx, BI.MAXSP), 2)) bN = bN - spellPower * 3;
  if (trait(ctx, BI.CURSP) - spellPower < idiv(trait(ctx, BI.MAXSP), 3)) bN = bN - spellPower * 5;
  const penalty = teleportReserve(ctx);
  if (trait(ctx, BI.MAXSP) > 30 && trait(ctx, BI.CURSP) - spellPower < penalty) bN = bN - spellPower * 750;
  if (trait(ctx, BI.MAXSP) > 30 && trait(ctx, BI.CURSP) - spellPower < 6) bN = bN - spellPower * 750;

  if (fs.targetClosest < 0 && typ === BA.TAP_UNLIFE && bN > 0) {
    fs.targetClosest = 0;
    return 0;
  }
  if (fs.simulate) return bN;
  fs.pending = borgSpell(ctx, spell);
  return bN;
}

/** borg_attack_aux_staff_dispel (attack.c:2736). */
function auxStaffDispel(ctx: BorgContext, fs: FightState, sval: number, rad: number, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 2) return 0;
  if (!borgEquipsStaffFail(ctx, sval)) return 0;
  let bN = borgLaunchBolt(ctx, fs, rad, dam, typ, maxRange(ctx), null);
  bN = bN - 50;
  if (fs.simulate) return bN;
  fs.pending = borgUseStaff(ctx, sval);
  return bN;
}

/** borg_attack_aux_rod_bolt (attack.c:2773). */
function auxRodBolt(ctx: BorgContext, fs: FightState, sval: number, rad: number, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 2) return 0;
  if (500 < borgActivateFailure(ctx, TV.ROD, sval)) return 0;
  if (!borgEquipsRod(ctx, sval)) return 0;
  const bN = borgLaunchBolt(ctx, fs, rad, dam, typ, maxRange(ctx), null);
  if (fs.simulate) return bN;
  fs.pending = borgZapRod(ctx, sval);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_wand_bolt (attack.c:2817). */
function auxWandBolt(ctx: BorgContext, fs: FightState, sval: number, rad: number, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (!trait(ctx, BI.CDEPTH)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 2) return 0;
  const item = borgSlot(ctx, TV.WAND, sval);
  if (!item) return 0;
  if (!item.pval) return 0;
  if (500 < borgActivateFailure(ctx, TV.WAND, sval)) return 0;
  let bN = borgLaunchBolt(ctx, fs, rad, dam, typ, maxRange(ctx), null);
  if (trait(ctx, BI.CLEVEL) > 5) bN = bN - 5;
  if (sval === SVAL.wand.wonder && !ctx.world.self.munchkinMode) {
    if (bN > 0 && borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, false) >= idiv(avoidance(ctx) * 7, 10))
      bN = 999;
    else bN = 0;
  }
  if (fs.simulate) return bN;
  fs.pending = borgAimWand(ctx, sval);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_wand_bolt_unknown (attack.c:2904). */
function auxWandUnknown(ctx: BorgContext, fs: FightState, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 5) return 0;
  let bItem: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval !== TV.WAND) continue;
    if (!item.pval) continue;
    bItem = item; /* keep last unaware wand */
  }
  if (!bItem) return 0;
  const bN = borgLaunchBolt(ctx, fs, 0, dam, typ, maxRange(ctx), null);
  if (fs.simulate) return bN;
  fs.pending = ctx.act.aimWand(bItem.handle);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_rod_bolt_unknown (attack.c:2972). */
function auxRodUnknown(ctx: BorgContext, fs: FightState, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 5) return 0;
  let bItem: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval !== TV.ROD) continue;
    if (!item.pval) continue;
    bItem = item;
  }
  if (!bItem) return 0;
  const bN = borgLaunchBolt(ctx, fs, 0, dam, typ, maxRange(ctx), null);
  if (fs.simulate) return bN;
  fs.pending = ctx.act.zapRod(bItem.handle);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_activation (attack.c:3044). */
function auxActivation(ctx: BorgContext, fs: FightState, act: string, rad: number, dam: number, typ: number, aim: boolean): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 2) return 0;
  if (!borgEquipsItem(ctx, act, true)) return 0;
  const bN = borgLaunchBolt(ctx, fs, rad, dam, typ, maxRange(ctx), null);
  if (fs.simulate) return bN;
  fs.pending = borgActivateItem(ctx, act);
  if (aim) fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_ring (attack.c:3091). */
function auxRing(ctx: BorgContext, fs: FightState, ringSval: number, rad: number, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 2) return 0;
  if (!borgEquipsRing(ctx, ringSval)) return 0;
  const bN = borgLaunchBolt(ctx, fs, rad, dam, typ, maxRange(ctx), null);
  if (fs.simulate) return bN;
  fs.pending = borgActivateRing(ctx, ringSval);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_dragon (attack.c:3131). */
function auxDragon(ctx: BorgContext, fs: FightState, sval: number, rad: number, dam: number, typ: number): number {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED) || trait(ctx, BI.ISIMAGE)) return 0;
  if (fs.simulate && ctx.rng.randint0(100) < 2) return 0;
  if (!borgEquipsDragon(ctx, sval)) return 0;
  const bN = borgLaunchArc(ctx, fs, rad, dam, typ, maxRange(ctx));
  if (fs.simulate) return bN;
  fs.pending = borgActivateDragon(ctx, sval);
  fs.successfulTarget = -1;
  return bN;
}

/** borg_attack_aux_whirlwind_attack (attack.c:3180). */
function auxWhirlwind(ctx: BorgContext, fs: FightState): number {
  if (!borgSpellOkayFail(ctx, Spell.WHIRLWIND_ATTACK, fs.fightingUnique ? 40 : 25)) return 0;
  const blows = idiv(trait(ctx, BI.CLEVEL) + 10, 15);
  let totalD = 0;
  for (let i = 0; i < fs.tempN; i++) {
    const x = fs.tempX[i]!;
    const y = fs.tempY[i]!;
    if (dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x) > 1) continue;
    const ag = ctx.world.map.at(x, y);
    let d = borgThrustDamageOne(ctx, ag.kill);
    if (d <= 0) continue;
    d = d * blows;
    const kill = ctx.world.kills.at(ag.kill);
    if (!kill.awake && d <= kill.power && !ctx.world.self.munchkinMode) {
      const p = borgDangerOneKill(ctx, y, x, 1, ag.kill, true, true);
      if (p > avoidance(ctx) * 2) continue;
    }
    if (!trait(ctx, BI.CDEPTH) && !kill.awake) continue;
    let p = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 2, ag.kill, true, true);
    if (d <= kill.power && trait(ctx, BI.MAXCLEVEL) > 15) p = idiv(p, 10);
    d += p;
    totalD += d;
  }
  if (totalD < 0) return 0;
  if (fs.simulate) return totalD;
  fs.pending = borgSpell(ctx, Spell.WHIRLWIND_ATTACK);
  return fs.pending ? totalD : 0;
}

/** borg_attack_aux_crush (attack.c:3633). */
function auxCrush(ctx: BorgContext, fs: FightState): number {
  const g = getDangerGlobals(ctx.world);
  if (!borgSpellOkay(ctx, Spell.CRUSH)) return 0;
  if (trait(ctx, BI.CURHP) + 10 < trait(ctx, BI.CLEVEL) * 4) return 0;
  g.crushSpell = false;
  const p1 = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 4, true, false);
  g.crushSpell = true;
  const p2 = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 4, true, false);
  g.crushSpell = false;
  let d = p1 - p2;
  const newHp = trait(ctx, BI.CURHP) - trait(ctx, BI.CLEVEL) * 2;
  if (fs.simulate && (p2 >= newHp * 2 || newHp <= 50)) return 0;
  const spellPower = borgGetSpellPower(ctx, Spell.CRUSH);
  d = d - spellPower;
  if (trait(ctx, BI.CURSP) - spellPower < idiv(trait(ctx, BI.MAXSP), 2)) d = d - spellPower * 10;
  if (fs.simulate) return d;
  fs.pending = borgSpell(ctx, Spell.CRUSH);
  return fs.pending ? d : 0;
}

/** borg_attack_aux_trance (attack.c:3697). */
function auxTrance(ctx: BorgContext, fs: FightState): number {
  const g = getDangerGlobals(ctx.world);
  if (!borgSpellOkay(ctx, Spell.TRANCE)) return 0;
  g.sleepSpellIi = false;
  const p1 = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 4, true, false);
  g.sleepSpellIi = true;
  const p2 = borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 4, true, false);
  g.sleepSpellIi = false;
  let d = p1 - p2;
  const spellPower = borgGetSpellPower(ctx, Spell.TRANCE);
  d = d - spellPower;
  if (trait(ctx, BI.CURSP) - spellPower < idiv(trait(ctx, BI.MAXSP), 2)) d = d - spellPower * 10;
  if (fs.simulate) return d;
  fs.pending = borgSpell(ctx, Spell.TRANCE);
  return fs.pending ? d : 0;
}

/* ---------------------------------------------------------------- *
 * Dispatch  (attack.c:3781 borg_calculate_attack_effectiveness)
 * ---------------------------------------------------------------- */

/** borg_calculate_attack_effectiveness (attack.c:3781). */
export function borgCalculateAttackEffectiveness(ctx: BorgContext, fs: FightState, attackType: BF): number {
  const cl = trait(ctx, BI.CLEVEL);
  const mr = maxRange(ctx);
  let rad = 0;
  let dam = 0;
  switch (attackType) {
    case BF.REST:
      return auxRest(ctx, fs);
    case BF.THRUST:
      return auxThrust(ctx, fs);
    case BF.LAUNCH:
      return auxLaunch(ctx, fs);
    case BF.OBJECT:
      return auxObject(ctx, fs);

    case BF.SPELL_SLOW_MONSTER:
      return auxSpellBolt(ctx, fs, Spell.SLOW_MONSTER, 0, 10, BA.OLD_SLOW, mr, false);
    case BF.SPELL_CONFUSE_MONSTER:
      return auxSpellBolt(ctx, fs, Spell.CONFUSE_MONSTER, 0, 10, BA.OLD_CONF, mr, false);
    case BF.SPELL_SLEEP_III:
      return auxSpellDispel(ctx, fs, Spell.MASS_SLEEP, 10, BA.OLD_SLEEP);
    case BF.SPELL_MAGIC_MISSILE:
      dam = idiv((idiv(cl - 1, 5) + 3) * (4 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.MAGIC_MISSILE, 0, dam, BA.MISSILE, mr, false);
    case BF.SPELL_MAGIC_MISSILE_RESERVE:
      dam = (idiv(cl - 1, 5) + 3) * (4 + 1);
      return auxSpellBoltReserve(ctx, fs, Spell.MAGIC_MISSILE, 0, dam, BA.MISSILE, mr);
    case BF.SPELL_COLD_BOLT:
      dam = idiv((idiv(cl - 5, 3) + 6) * (8 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.FROST_BOLT, 0, dam, BA.COLD, mr, false);
    case BF.SPELL_STONE_TO_MUD:
      dam = 20 + idiv(30, 2);
      return auxSpellBolt(ctx, fs, Spell.TURN_STONE_TO_MUD, 0, dam, BA.KILL_WALL, mr, false);
    case BF.SPELL_LIGHT_BEAM:
      dam = idiv(6 * (8 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.SPEAR_OF_LIGHT, -1, dam, BA.LIGHT_WEAK, mr, false);
    case BF.SPELL_STINK_CLOUD:
      dam = 10 + idiv(cl, 2);
      return auxSpellBolt(ctx, fs, Spell.STINKING_CLOUD, 2, dam, BA.POIS, mr, false);
    case BF.SPELL_FIRE_BALL:
      dam = cl * 2;
      return auxSpellBolt(ctx, fs, Spell.FIRE_BALL, 2, dam, BA.FIRE, mr, false);
    case BF.SPELL_COLD_STORM:
      dam = idiv(3 * (cl * 3 + 1), 2);
      return auxSpellDispel(ctx, fs, Spell.ICE_STORM, dam, BA.ICE);
    case BF.SPELL_METEOR_SWARM:
      dam = 30 + idiv(cl, 2) + idiv(cl, 20) + 2;
      return auxSpellBolt(ctx, fs, Spell.METEOR_SWARM, 1, dam, BA.METEOR, mr, false);
    case BF.SPELL_RIFT:
      dam = cl * 3 + 40;
      return auxSpellBolt(ctx, fs, Spell.RIFT, -1, dam, BA.GRAVITY, mr, false);
    case BF.SPELL_MANA_STORM:
      dam = 300 + cl * 2;
      return auxSpellBolt(ctx, fs, Spell.MANA_STORM, 3, dam, BA.MANA, mr, false);
    case BF.SPELL_SHOCK_WAVE:
      dam = cl * 2;
      return auxSpellBolt(ctx, fs, Spell.SHOCK_WAVE, 2, dam, BA.SOUND, mr, false);
    case BF.SPELL_EXPLOSION:
      dam = cl * 2 + idiv(cl, 5);
      return auxSpellBolt(ctx, fs, Spell.EXPLOSION, 2, dam, BA.SHARD, mr, false);
    case BF.PRAYER_HOLY_ORB_BALL:
      rad = cl >= 30 ? 3 : 2;
      dam = idiv(cl * 3, 2) + idiv(3 * (6 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.ORB_OF_DRAINING, rad, dam, BA.HOLY_ORB, mr, false);
    case BF.SPELL_BLIND_CREATURE:
      return auxSpellBolt(ctx, fs, Spell.FRIGHTEN, 0, 10, BA.OLD_CONF, mr, false);
    case BF.SPELL_TRANCE:
      return auxTrance(ctx, fs);
    case BF.PRAYER_DISP_UNDEAD:
      dam = idiv(cl * 5 + 1, 2);
      return auxSpellDispel(ctx, fs, Spell.DISPEL_UNDEAD, dam, BA.DISP_UNDEAD);
    case BF.PRAYER_DISP_EVIL:
      dam = idiv(cl * 5 + 1, 2);
      return auxSpellDispel(ctx, fs, Spell.DISPEL_EVIL, dam, BA.DISP_EVIL);
    case BF.PRAYER_DISP_SPIRITS:
      return auxSpellDispel(ctx, fs, Spell.BANISH_SPIRITS, 100, BA.DISP_SPIRITS);
    case BF.PRAYER_HOLY_WORD:
      if (trait(ctx, BI.MAXHP) - trait(ctx, BI.CURHP) >= 300) {
        dam = cl * 10;
        return auxSpellDispel(ctx, fs, Spell.HOLY_WORD, dam, BA.DISP_EVIL);
      }
      dam = idiv(cl * 3, 2) - 50;
      return auxSpellDispel(ctx, fs, Spell.DISPEL_EVIL, dam, BA.DISP_EVIL);
    case BF.SPELL_ANNIHILATE:
      dam = cl * 4;
      return auxSpellBolt(ctx, fs, Spell.ANNIHILATE, 0, dam, BA.OLD_DRAIN, mr, false);
    case BF.SPELL_ELECTRIC_ARC:
      dam = idiv((idiv(cl - 1, 5) + 3) * (6 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.ELECTRIC_ARC, 0, dam, BA.ELEC, cl, false);
    case BF.SPELL_ACID_SPRAY:
      dam = idiv(idiv(cl, 2) * (8 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.ACID_SPRAY, 60, dam, BA.ACID, 10, true);
    case BF.SPELL_MANA_BOLT:
      dam = idiv((cl - 10) * (8 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.MANA_BOLT, 0, dam, BA.MANA, mr, false);
    case BF.SPELL_THRUST_AWAY:
      dam = idiv(cl * (8 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.THRUST_AWAY, 0, dam, BA.FORCE, idiv(cl, 10) + 1, false);
    case BF.SPELL_LIGHTNING_STRIKE:
      dam = idiv(idiv(cl, 4) * (4 + 1), 2) + cl + 5;
      return auxSpellBolt(ctx, fs, Spell.LIGHTNING_STRIKE, 0, dam, BA.ELEC_STRIKE, mr, false);
    case BF.SPELL_EARTH_RISING:
      dam = idiv((idiv(cl, 3) + 2) * (6 + 1), 2) + cl + 5;
      return auxSpellBolt(ctx, fs, Spell.EARTH_RISING, 0, dam, BA.SHARD, idiv(cl, 5) + 4, false);
    case BF.SPELL_VOLCANIC_ERUPTION:
      dam = idiv(idiv(cl * 3, 2) * (cl * 3 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.VOLCANIC_ERUPTION, 0, dam, BA.FIRE, mr, false);
    case BF.SPELL_RIVER_OF_LIGHTNING:
      dam = idiv((cl + 10) * (8 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.RIVER_OF_LIGHTNING, 20, dam, BA.PLASMA, 20, true);
    case BF.SPELL_SPEAR_OF_OROME:
      dam = idiv(idiv(cl, 2) + (8 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.SPEAR_OF_OROME, 0, dam, BA.HOLY_ORB, mr, false);
    case BF.SPELL_LIGHT_OF_MANWE:
      dam = cl * 5 + 100;
      return auxSpellBolt(ctx, fs, Spell.LIGHT_OF_MANWE, 0, dam, BA.LIGHT, mr, false);
    case BF.SPELL_NETHER_BOLT:
      dam = idiv((idiv(cl, 4) + 3) * (4 + 1), 2);
      return auxSpellBolt(ctx, fs, Spell.NETHER_BOLT, 0, dam, BA.NETHER, mr, false);
    case BF.SPELL_TAP_UNLIFE:
      dam = idiv((idiv(cl, 4) + 3) * (4 + 1), 2);
      return auxSpellDispel(ctx, fs, Spell.TAP_UNLIFE, dam, BA.TAP_UNLIFE);
    case BF.SPELL_CRUSH:
      return auxCrush(ctx, fs);
    case BF.SPELL_SLEEP_EVIL:
      dam = cl * 10 + 500;
      return auxSpellDispel(ctx, fs, Spell.SLEEP_EVIL, dam, BA.SLEEP_EVIL);
    case BF.SPELL_DISENCHANT:
      dam = idiv(cl * 2 + 10 + 1, 2) * 2;
      return auxSpellBolt(ctx, fs, Spell.DISENCHANT, 0, dam, BA.DISEN, mr, false);
    case BF.SPELL_FRIGHTEN:
      dam = cl;
      return auxSpellBolt(ctx, fs, Spell.FRIGHTEN, 0, dam, BA.TURN_ALL, mr, false);
    case BF.SPELL_VAMPIRE_STRIKE:
      return auxVampireStrike(ctx, fs);
    case BF.PRAYER_DISPEL_LIFE:
      dam = idiv(cl * 3 + 1, 2);
      return auxSpellBolt(ctx, fs, Spell.DISPEL_LIFE, 0, dam, BA.DRAIN_LIFE, mr, false);
    case BF.SPELL_DARK_SPEAR:
      dam = idiv(cl * 2 + 1, 2) * 2;
      return auxSpellBolt(ctx, fs, Spell.DARK_SPEAR, 0, dam, BA.DARK, mr, false);
    case BF.SPELL_UNLEASH_CHAOS:
      dam = idiv(cl + 1, 2) * 8;
      return auxSpellBolt(ctx, fs, Spell.UNLEASH_CHAOS, 0, dam, BA.CHAOS, mr, false);
    case BF.SPELL_STORM_OF_DARKNESS:
      dam = idiv(cl * 2 + 1, 2) * 4;
      return auxSpellBolt(ctx, fs, Spell.STORM_OF_DARKNESS, 4, dam, BA.DARK, mr, false);
    case BF.SPELL_CURSE:
      if (trait(ctx, BI.CURHP) < 120) return 0;
      return auxSpellBolt(ctx, fs, Spell.CURSE, 0, -1, BA.CURSE, mr, false);
    case BF.SPELL_WHIRLWIND_ATTACK:
      return auxWhirlwind(ctx, fs);
    case BF.SPELL_LEAP_INTO_BATTLE:
      return auxLeapIntoBattle(ctx, fs);
    case BF.SPELL_MAIM_FOE:
      return auxMaimFoe(ctx, fs);
    case BF.SPELL_HOWL_OF_THE_DAMNED:
      return auxSpellDispel(ctx, fs, Spell.HOWL_OF_THE_DAMNED, cl, BA.TURN_ALL);

    case BF.ROD_SLOW_MONSTER:
      return auxRodBolt(ctx, fs, SVAL.rod.slow_monster!, 0, 10, BA.OLD_SLOW);
    case BF.ROD_SLEEP_MONSTER:
      return auxRodBolt(ctx, fs, SVAL.rod.sleep_monster!, 0, 10, BA.OLD_SLEEP);
    case BF.ROD_ELEC_BOLT:
      return auxRodBolt(ctx, fs, SVAL.rod.elec_bolt!, -1, idiv(6 * (6 + 1), 2), BA.ELEC);
    case BF.ROD_COLD_BOLT:
      return auxRodBolt(ctx, fs, SVAL.rod.cold_bolt!, 0, idiv(12 * (8 + 1), 2), BA.COLD);
    case BF.ROD_ACID_BOLT:
      return auxRodBolt(ctx, fs, SVAL.rod.acid_bolt!, 0, idiv(12 * (8 + 1), 2), BA.ACID);
    case BF.ROD_FIRE_BOLT:
      return auxRodBolt(ctx, fs, SVAL.rod.fire_bolt!, 0, idiv(12 * (8 + 1), 2), BA.FIRE);
    case BF.ROD_LIGHT_BEAM:
      return auxRodBolt(ctx, fs, SVAL.rod.light!, -1, idiv(6 * (8 + 1), 2), BA.LIGHT_WEAK);
    case BF.ROD_DRAIN_LIFE:
      return auxRodBolt(ctx, fs, SVAL.rod.drain_life!, 0, 150, BA.OLD_DRAIN);
    case BF.ROD_ELEC_BALL:
      return auxRodBolt(ctx, fs, SVAL.rod.elec_ball!, 2, 64, BA.ELEC);
    case BF.ROD_COLD_BALL:
      return auxRodBolt(ctx, fs, SVAL.rod.cold_ball!, 2, 100, BA.COLD);
    case BF.ROD_ACID_BALL:
      return auxRodBolt(ctx, fs, SVAL.rod.acid_ball!, 2, 120, BA.ACID);
    case BF.ROD_FIRE_BALL:
      return auxRodBolt(ctx, fs, SVAL.rod.fire_ball!, 2, 144, BA.FIRE);
    case BF.ROD_UNKNOWN:
      return auxRodUnknown(ctx, fs, 75, BA.MISSILE);

    case BF.WAND_UNKNOWN:
      return auxWandUnknown(ctx, fs, 75, BA.MISSILE);
    case BF.WAND_MAGIC_MISSILE:
      return auxWandBolt(ctx, fs, SVAL.wand.magic_missile!, 0, idiv(3 * (4 + 1), 2), BA.MISSILE);
    case BF.WAND_SLOW_MONSTER:
      return auxWandBolt(ctx, fs, SVAL.wand.slow_monster!, 0, 10, BA.OLD_SLOW);
    case BF.WAND_HOLD_MONSTER:
      return auxWandBolt(ctx, fs, SVAL.wand.hold_monster!, 0, 10, BA.OLD_SLEEP);
    case BF.WAND_FEAR_MONSTER:
      return auxWandBolt(ctx, fs, SVAL.wand.fear_monster!, 0, idiv(2 * (6 + 1), 2), BA.TURN_ALL);
    case BF.WAND_CONFUSE_MONSTER:
      return auxWandBolt(ctx, fs, SVAL.wand.confuse_monster!, 0, idiv(2 * (6 + 1), 2), BA.OLD_CONF);
    case BF.WAND_ELEC_BOLT:
      return auxWandBolt(ctx, fs, SVAL.wand.elec_bolt!, -1, idiv(6 * (6 + 1), 2), BA.ELEC);
    case BF.WAND_COLD_BOLT:
      return auxWandBolt(ctx, fs, SVAL.wand.cold_bolt!, 0, idiv(12 * (8 + 1), 2), BA.COLD);
    case BF.WAND_ACID_BOLT:
      return auxWandBolt(ctx, fs, SVAL.wand.acid_bolt!, 0, idiv(5 * (8 + 1), 2), BA.ACID);
    case BF.WAND_FIRE_BOLT:
      return auxWandBolt(ctx, fs, SVAL.wand.fire_bolt!, 0, idiv(12 * (8 + 1), 2), BA.FIRE);
    case BF.WAND_LIGHT_BEAM:
      return auxWandBolt(ctx, fs, SVAL.wand.light!, -1, idiv(6 * (8 + 1), 2), BA.LIGHT_WEAK);
    case BF.WAND_STINKING_CLOUD:
      return auxWandBolt(ctx, fs, SVAL.wand.stinking_cloud!, 2, 12, BA.POIS);
    case BF.WAND_ELEC_BALL:
      return auxWandBolt(ctx, fs, SVAL.wand.elec_ball!, 2, 64, BA.ELEC);
    case BF.WAND_COLD_BALL:
      return auxWandBolt(ctx, fs, SVAL.wand.cold_ball!, 2, 100, BA.COLD);
    case BF.WAND_ACID_BALL:
      return auxWandBolt(ctx, fs, SVAL.wand.acid_ball!, 2, 120, BA.ACID);
    case BF.WAND_FIRE_BALL:
      return auxWandBolt(ctx, fs, SVAL.wand.fire_ball!, 2, 144, BA.FIRE);
    case BF.WAND_DRAGON_COLD:
      return auxWandBolt(ctx, fs, SVAL.wand.dragon_cold!, 3, 160, BA.COLD);
    case BF.WAND_DRAGON_FIRE:
      return auxWandBolt(ctx, fs, SVAL.wand.dragon_fire!, 3, 200, BA.FIRE);
    case BF.WAND_ANNIHILATION:
      return auxWandBolt(ctx, fs, SVAL.wand.annihilation!, 0, 250, BA.OLD_DRAIN);
    case BF.WAND_DRAIN_LIFE:
      return auxWandBolt(ctx, fs, SVAL.wand.drain_life!, 0, 150, BA.OLD_DRAIN);
    case BF.WAND_WONDER:
      return auxWandBolt(ctx, fs, SVAL.wand.wonder!, 0, 35, BA.MISSILE);

    case BF.STAFF_SLEEP_MONSTERS:
      return auxStaffDispel(ctx, fs, SVAL.staff.sleep_monsters!, 10, 60, BA.OLD_SLEEP);
    case BF.STAFF_SLOW_MONSTERS:
      return auxStaffDispel(ctx, fs, SVAL.staff.slow_monsters!, 10, 60, BA.OLD_SLOW);
    case BF.STAFF_DISPEL_EVIL:
      return auxStaffDispel(ctx, fs, SVAL.staff.dispel_evil!, 10, 60, BA.DISP_EVIL);
    case BF.STAFF_POWER:
      return auxStaffDispel(ctx, fs, SVAL.staff.power!, 10, 120, BA.TURN_ALL);
    case BF.STAFF_HOLINESS:
      return auxStaffDispel(
        ctx,
        fs,
        SVAL.staff.holiness!,
        10,
        trait(ctx, BI.CURHP) < idiv(trait(ctx, BI.MAXHP), 2) ? 500 : 120,
        BA.DISP_EVIL,
      );

    case BF.RING_ACID:
      return auxRing(ctx, fs, SVAL.ring.acid!, 2, 70, BA.ACID);
    case BF.RING_FIRE:
      return auxRing(ctx, fs, SVAL.ring.flames!, 2, 80, BA.FIRE);
    case BF.RING_ICE:
      return auxRing(ctx, fs, SVAL.ring.ice!, 2, 75, BA.ICE);
    case BF.RING_LIGHTNING:
      return auxRing(ctx, fs, SVAL.ring.lightning!, 2, 85, BA.ELEC);

    case BF.DRAGON_BLUE:
      return auxDragon(ctx, fs, SVAL.dragon.blue!, 20, 150, BA.ELEC);
    case BF.DRAGON_WHITE:
      return auxDragon(ctx, fs, SVAL.dragon.white!, 20, 100, BA.COLD);
    case BF.DRAGON_BLACK:
      return auxDragon(ctx, fs, SVAL.dragon.black!, 20, 120, BA.ACID);
    case BF.DRAGON_GREEN:
      return auxDragon(ctx, fs, SVAL.dragon.green!, 20, 150, BA.POIS);
    case BF.DRAGON_RED:
      return auxDragon(ctx, fs, SVAL.dragon.red!, 2, 200, BA.FIRE);
    case BF.DRAGON_MULTIHUED:
      return auxDragonMulti(ctx, fs, SVAL.dragon.multihued!, 20, 250, [
        BA.ELEC, BA.COLD, BA.ACID, BA.POIS, BA.FIRE,
      ]);
    case BF.DRAGON_GOLD:
      return auxDragon(ctx, fs, SVAL.dragon.gold!, 20, 150, BA.SOUND);
    case BF.DRAGON_CHAOS:
      return auxDragonMulti(ctx, fs, SVAL.dragon.chaos!, 20, 220, [BA.CHAOS, BA.DISEN]);
    case BF.DRAGON_LAW:
      return auxDragonMulti(ctx, fs, SVAL.dragon.law!, 20, 220, [BA.SOUND, BA.SHARD]);
    case BF.DRAGON_BALANCE:
      return auxDragonMulti(ctx, fs, SVAL.dragon.balance!, 20, 250, [
        BA.CHAOS, BA.DISEN, BA.SOUND, BA.SHARD,
      ]);
    case BF.DRAGON_SHINING:
      return auxDragonMulti(ctx, fs, SVAL.dragon.shining!, 20, 200, [BA.LIGHT, BA.DARK]);
    case BF.DRAGON_POWER:
      return auxDragon(ctx, fs, SVAL.dragon.power!, 20, 300, BA.MISSILE);

    default:
      /* Artifact activations (BF_ACT_*): route through the activation seam.
       * Without an activation resolver these all return 0 (faithful: no artifact
       * available). P8.6 injects a resolver and these become live. */
      return 0;
  }
}

/** Multi-type dragon breath: pick the biggest of several element types (attack.c:4973). */
function auxDragonMulti(ctx: BorgContext, fs: FightState, sval: number, rad: number, dam: number, types: number[]): number {
  const savedSim = fs.simulate;
  fs.simulate = true;
  const values = types.map((t) => auxDragon(ctx, fs, sval, rad, dam, t));
  let biggest = 0;
  for (let x = 1; x < values.length; x++) if (values[x]! > values[biggest]!) biggest = x;
  fs.simulate = savedSim;
  if (!fs.simulate) return auxDragon(ctx, fs, sval, rad, dam, types[biggest]!);
  return values[biggest]!;
}

/** borg_attack_aux_leap_into_battle (attack.c:3267). */
function auxLeapIntoBattle(ctx: BorgContext, fs: FightState): number {
  if (!borgSpellOkayFail(ctx, Spell.LEAP_INTO_BATTLE, fs.fightingUnique ? 40 : 25)) return 0;
  if (trait(ctx, BI.ISAFRAID) || trait(ctx, BI.CRSFEAR)) return 0;
  if (fs.targetClosest < 10) return 0;
  let bI = -1;
  let bD = -1;
  for (let i = 0; i < fs.tempN; i++) {
    const x = fs.tempX[i]!;
    const y = fs.tempY[i]!;
    const mDist = dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x);
    if (mDist > 4) continue;
    const ag = ctx.world.map.at(x, y);
    if (!ag.kill) continue;
    let d = borgThrustDamageOne(ctx, ag.kill);
    let blows = idiv(trait(ctx, BI.CLEVEL) + 5, 15);
    blows = idiv(blows * mDist + 2, 4) + 1;
    d *= blows;
    if (d <= 0) continue;
    const kill = ctx.world.kills.at(ag.kill);
    if (!kill.awake && d <= kill.power && !ctx.world.self.munchkinMode) {
      const p = borgDangerOneKill(ctx, y, x, 1, ag.kill, true, true);
      if (p > avoidance(ctx) * 2) continue;
    }
    if (!trait(ctx, BI.CDEPTH) && !kill.awake) continue;
    let p = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 2, ag.kill, true, true);
    if (d <= kill.power && trait(ctx, BI.MAXCLEVEL) > 15) p = idiv(p, 10);
    d += p;
    if (bI >= 0 && d < bD) continue;
    bI = i;
    bD = d;
  }
  if (bI < 0) return 0;
  if (fs.simulate) return bD;
  ctx.world.self.goal.g.x = fs.tempX[bI]!;
  ctx.world.self.goal.g.y = fs.tempY[bI]!;
  borgTarget(ctx, ctx.world.self.goal.g.y, ctx.world.self.goal.g.x, true);
  fs.pending = borgSpell(ctx, Spell.LEAP_INTO_BATTLE);
  fs.successfulTarget = -1;
  return bD;
}

/** borg_attack_aux_maim_foe (attack.c:3396). */
function auxMaimFoe(ctx: BorgContext, fs: FightState): number {
  if (trait(ctx, BI.ISAFRAID) || trait(ctx, BI.CRSFEAR)) return 0;
  if (!borgSpellOkayFail(ctx, Spell.MAIM_FOE, fs.fightingUnique ? 40 : 25)) return 0;
  const blows = idiv(trait(ctx, BI.CLEVEL), 15);
  let bI = -1;
  let bD = -1;
  for (let i = 0; i < fs.tempN; i++) {
    const x = fs.tempX[i]!;
    const y = fs.tempY[i]!;
    if (dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x) > 1) continue;
    const ag = ctx.world.map.at(x, y);
    let d = borgThrustDamageOne(ctx, ag.kill) * blows;
    if (d <= 0) continue;
    const kill = ctx.world.kills.at(ag.kill);
    if (!kill.awake && d <= kill.power && !ctx.world.self.munchkinMode) {
      const p = borgDangerOneKill(ctx, y, x, 1, ag.kill, true, true);
      if (p > avoidance(ctx) * 2) continue;
    }
    if (!trait(ctx, BI.CDEPTH) && !kill.awake) continue;
    let p = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 2, ag.kill, true, true);
    if (d <= kill.power && trait(ctx, BI.MAXCLEVEL) > 15) p = idiv(p, 10);
    d += p;
    if (bI >= 0 && d < bD) continue;
    bI = i;
    bD = d;
  }
  if (bI < 0) return 0;
  if (fs.simulate) return bD;
  ctx.world.self.goal.g.x = fs.tempX[bI]!;
  ctx.world.self.goal.g.y = fs.tempY[bI]!;
  const dir = borgExtractDir(ctx.world.self.c.y, ctx.world.self.c.x, ctx.world.self.goal.g.y, ctx.world.self.goal.g.x);
  const cmd = borgSpell(ctx, Spell.MAIM_FOE);
  /* the C queues the spell then a direction; the fire command carries the aim. */
  fs.pending = cmd;
  void dir;
  return bD;
}

/** borg_attack_aux_vampire_strike (attack.c:3505). */
function auxVampireStrike(ctx: BorgContext, fs: FightState): number {
  if (!borgSpellOkayFail(ctx, Spell.VAMPIRE_STRIKE, fs.fightingUnique ? 40 : 25)) return 0;
  let bI = -1;
  let bestDist = maxRange(ctx);
  let curDist = 0;
  for (let i = 0; i < fs.tempN; i++) {
    const x = fs.tempX[i]!;
    const y = fs.tempY[i]!;
    curDist = dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x);
    if (curDist > bestDist) continue;
    bestDist = curDist;
    bI = i;
  }
  if (bI === -1) return 0;
  if (curDist >= 20) return 0;
  const x = fs.tempX[bI]!;
  const y = fs.tempY[bI]!;

  let found = false;
  for (let ox = -1; ox <= 1 && !found; ox++) {
    for (let oy = -1; oy <= 1 && !found; oy++) {
      if (!ox && !oy) continue;
      const x2 = x + ox;
      const y2 = y + oy;
      if (!ctx.world.map.inBounds(x2, y2)) continue;
      const ag2 = ctx.world.map.at(x2, y2);
      if (!ag2.kill && ag2.feat === FEAT.FLOOR && !ag2.web && !ag2.glyph && (y2 !== ctx.world.self.c.y || x2 !== ctx.world.self.c.x))
        found = true;
    }
  }
  if (!found) return 0;
  if (!borgOffsetProjectable(ctx, ctx.world.self.c.y, ctx.world.self.c.x, y, x)) return 0;

  const ag = ctx.world.map.at(x, y);
  let d = trait(ctx, BI.CLEVEL) * 2;
  const kill = ctx.world.kills.at(ag.kill);
  const facts = factsOf(ctx, ag.kill);
  if (rf(facts, "NONLIVING") || rf(facts, "UNDEAD")) return 0;
  if (!kill.awake && d <= kill.power && !ctx.world.self.munchkinMode) {
    const p = borgDangerOneKill(ctx, y, x, 1, ag.kill, true, true);
    if (p > avoidance(ctx) * 2) return 0;
  }
  let p = borgDangerOneKill(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 2, ag.kill, true, true);
  if (d <= kill.power && trait(ctx, BI.MAXCLEVEL) > 15) p = idiv(p, 10);
  d += p;
  if (fs.targetClosest < 0 && d > 0) {
    fs.targetClosest = 0;
    return 0;
  }
  if (fs.simulate) return d;
  fs.pending = borgSpell(ctx, Spell.VAMPIRE_STRIKE);
  return d;
}

/* ---------------------------------------------------------------- *
 * borg_attack  (attack.c:5148)
 * ---------------------------------------------------------------- */

/**
 * borgAttack (attack.c:5148): attack nearby monsters in the best possible way.
 * Returns the AgentCommand to perform, or null when no worthwhile attack exists.
 */
export function borgAttack(ctx: BorgContext, boostedBravery = false): AgentCommand | null {
  const fs = getFightState(ctx.world);
  const g = getDangerGlobals(ctx.world);
  if (ctx.world.kills.count <= 1) return null;

  g.attacking = true;
  g.fightingUnique = fs.fightingUnique !== 0;

  fs.tempN = 0;
  let adjacentMonster = false;

  for (const [i, kill] of ctx.world.kills.entries()) {
    const facts = factsOf(ctx, i);
    if (!kill.rIdx) continue;
    if (kill.when < ctx.world.clock - 2) continue;
    if (ctx.world.self.goal.ignoring && !trait(ctx, BI.ISAFRAID) && rf(facts, "MULTIPLY")) continue;

    const nm = raceName(ctx, kill.mIdx);
    if (
      trait(ctx, BI.CLASS) === CLASS_MAGE &&
      trait(ctx, BI.MAXCLEVEL) < 10 &&
      trait(ctx, BI.CDEPTH) === 0 &&
      nm.includes("Farmer")
    )
      continue;

    if (
      (kill.speed > trait(ctx, BI.SPEED) && dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) <= 2) ||
      dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) <= 1
    )
      adjacentMonster = true;

    if (ctx.world.facts.scaryGuyOnLevel) {
      if (nm.includes("Grip") || nm.includes("Fang")) {
        /* fight Grip/Fang */
      } else if (trait(ctx, BI.CDEPTH) <= 5 && trait(ctx, BI.CDEPTH) !== 0 && rf(facts, "MULTIPLY")) {
        /* fight single worms/mice */
      } else if (
        ctx.world.clock - fs.began >= 2000 ||
        fs.timeTown + (ctx.world.clock - fs.began) >= 3000
      ) {
        /* been here too long */
      } else if (boostedBravery || ctx.world.self.noRetreat >= 1 || ctx.world.self.goal.recalling || ctx.world.self.goal.descending) {
        /* bored / recalling */
      } else if (trait(ctx, BI.CDEPTH) * 4 <= trait(ctx, BI.CLEVEL) && trait(ctx, BI.CLEVEL) > 10) {
        /* high clevel */
      } else if (adjacentMonster) {
        /* monster next to me */
      } else {
        continue; /* flee other scary guys */
      }
    }

    if (!ctx.world.map.inBounds(kill.pos.x, kill.pos.y)) continue;
    const ag = ctx.world.map.at(kill.pos.x, kill.pos.y);
    if (!(ag.info & 0x08 /* BORG_OKAY */)) continue;
    if (!(ag.info & 0x20 /* BORG_VIEW */)) continue;
    if (dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) > maxRange(ctx)) continue;
    if (!ag.kill) ag.kill = i;

    fs.tempX[fs.tempN] = kill.pos.x;
    fs.tempY[fs.tempN] = kill.pos.y;
    fs.tempN++;
  }

  if (!fs.tempN) {
    g.attacking = false;
    return null;
  }

  /* birth_randarts cutoff (attack.c:5281): without randarts, skip BF_ACT_STARLIGHT+ */
  const randarts = false;
  const maxAttacks = randarts ? BF.MAX : BF.ACT_STARLIGHT;

  fs.simulate = true;
  let bG = -1;
  let bN = 0;
  for (let gI = 0; gI < maxAttacks; gI++) {
    const n = borgCalculateAttackEffectiveness(ctx, fs, gI as BF);
    if (n <= bN) continue;
    bG = gI;
    bN = n;
  }

  if (bN <= 0) {
    g.attacking = false;
    return null;
  }

  fs.simulate = false;
  fs.pending = null;
  borgCalculateAttackEffectiveness(ctx, fs, bG as BF);
  g.attacking = false;
  return fs.pending;
}

