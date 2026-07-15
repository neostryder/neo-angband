/**
 * borg_escape and friends - "get me out of here": recall, phase, teleport,
 * dimension door, shoot-n-scoot. A faithful port of
 * reference/src/borg/borg-escape.c (plus the borg_shoot_scoot_safe gate from
 * borg-flow-kill.c:2901, reimplemented here so escape stays self-contained).
 *
 * The C escape ladder tries a sequence of escape means with short-circuit `||`,
 * performing the first that works. Here each means is an item/spell helper that
 * returns an AgentCommand (or null); borgEscape returns the first non-null
 * command, preserving the exact danger-threshold ladder (Danger Levels 1..8).
 *
 * GAPS (documented): the anti-summon timer (borg_t_antisummon) and level-entry
 * clock (borg_began) live on the FightState copy, not the flow state, so the
 * "reset timer" bookkeeping is local; borg_primarily_caster and square_isvault
 * are approximated (class list / no vault flag on the borg map).
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import {
  BI,
  CLASS_MAGE,
  CLASS_NECROMANCER,
  CLASS_PRIEST,
  CLASS_DRUID,
  CLASS_WARRIOR,
} from "../trait/trait-index";
import { trait } from "../item/deps";
import { borgDanger, getDangerGlobals, getFearCaches, borgLos } from "../danger";
import { FEAT, ddx_ddd, ddy_ddd } from "../flow/flow-consts";
import { AUTO_MAX_X, AUTO_MAX_Y } from "../world/grid";
import { TV, SVAL } from "../item/svals";
import {
  Spell,
  borgSpell,
  borgSpellFail,
  borgSpellOkay,
  borgSpellOkayFail,
} from "../item/magic";
import {
  borgZapRod,
  borgReadScroll,
  borgUseStaff,
  borgUseStaffFail,
  borgActivateItem,
} from "../item/item-use";
import { getFightState, idiv, iabs, type FightState } from "./state";
import { borgTarget } from "./projection";

function avoidance(ctx: BorgContext): number {
  return getDangerGlobals(ctx.world).avoidance;
}
function dist(y1: number, x1: number, y2: number, x2: number): number {
  return Math.max(iabs(y1 - y2), iabs(x1 - x2));
}
/** double_distance (escape.c:46): diagonals count as further. */
function doubleDistance(y1: number, x1: number, y2: number, x2: number): number {
  return Math.max(iabs(y1 * 2 - y2 * 2), iabs(x1 * 2 - x2 * 2));
}
function firstCmd(...cmds: Array<AgentCommand | null>): AgentCommand | null {
  for (const c of cmds) if (c) return c;
  return null;
}
function rf(ctx: BorgContext, i: number, name: string): boolean {
  return getDangerGlobals(ctx.world).resolveFacts(ctx, i).flags.has(name);
}

/* ---------------------------------------------------------------- *
 * borg_recall (escape.c:54)
 * ---------------------------------------------------------------- */

/**
 * borgRecall (escape.c:54): induce Word of Recall. Returns the command, or null.
 * The C's "reset recall depth? y/n" dialogue is engine-driven and omitted here
 * (P8.6 answers prompts); the means-selection ladder is preserved.
 */
export function borgRecall(ctx: BorgContext): AgentCommand | null {
  if (ctx.world.self.goal.recalling) return null;
  return firstCmd(
    borgZapRod(ctx, SVAL.rod.recall!),
    borgActivateItem(ctx, "act_recall"),
    borgSpellFail(ctx, Spell.WORD_OF_RECALL, 60),
    borgReadScroll(ctx, SVAL.scroll.word_of_recall!),
  );
}

/* ---------------------------------------------------------------- *
 * borg_surrounded (escape.c:137)
 * ---------------------------------------------------------------- */

/** borgSurrounded (escape.c:137): likely to be surrounded by monsters? */
export function borgSurrounded(ctx: BorgContext): boolean {
  let safeGrids = 8;
  let nonSafe = 0;
  let monsters = 0;
  let adjacent = 0;

  for (const [i, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    const d = dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x);
    if (d > 3) continue;
    if (!borgLos(ctx.world, ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x)) continue;
    if (!kill.awake) continue;
    if (rf(ctx, i, "PASS_WALL")) continue;
    if (rf(ctx, i, "KILL_WALL")) continue;
    if (d === 1) adjacent++;
    monsters++;
  }

  for (let i = 0; i < 8; i++) {
    const x = ctx.world.self.c.x + ddx_ddd[i]!;
    const y = ctx.world.self.c.y + ddy_ddd[i]!;
    if (!(x >= 1 && x < AUTO_MAX_X - 1 && y >= 1 && y < AUTO_MAX_Y - 1)) continue;
    const ag = ctx.world.map.at(x, y);
    if (!isFloor(ag.feat)) nonSafe++;
    else if (ag.feat === FEAT.NONE) nonSafe++;
    else if (ag.kill) nonSafe++;
    else if (isShop(ag.feat)) nonSafe++;
    if (ag.trap && !ag.glyph) nonSafe++;
  }

  safeGrids = safeGrids - nonSafe;
  if (safeGrids === 1 && adjacent === 1) return false;
  if (monsters > safeGrids) {
    if (ctx.world.self.goal.ignoring) {
      /* ignoring: the C leaves this as a no-op fall-through */
    } else return true;
  }
  return false;
}

function isFloor(feat: number): boolean {
  return (
    feat === FEAT.FLOOR ||
    feat === FEAT.OPEN ||
    feat === FEAT.MORE ||
    feat === FEAT.LESS ||
    feat === FEAT.BROKEN ||
    feat === FEAT.PASS_RUBBLE
  );
}
function isShop(feat: number): boolean {
  return feat >= FEAT.STORE_GENERAL && feat <= FEAT.HOME;
}

/* ---------------------------------------------------------------- *
 * borg_freedom (escape.c:286)
 * ---------------------------------------------------------------- */

/** Nearest known stair of a feature, scanned from the remembered map. */
function nearestStair(ctx: BorgContext, feat: number): { y: number; x: number } | null {
  let best: { y: number; x: number } | null = null;
  let bestD = Infinity;
  for (let y = 0; y < AUTO_MAX_Y; y++) {
    for (let x = 0; x < AUTO_MAX_X; x++) {
      if (ctx.world.map.at(x, y).feat !== feat) continue;
      const d = dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x);
      if (d < bestD) {
        bestD = d;
        best = { y, x };
      }
    }
  }
  return best;
}

/** borgFreedom (escape.c:286): "freedom" score of a grid (stair proximity). */
export function borgFreedom(ctx: BorgContext, y: number, x: number): number {
  let f = 0;
  if (!trait(ctx, BI.CDEPTH)) {
    const s = nearestStair(ctx, FEAT.MORE);
    if (s) {
      const d = doubleDistance(y, x, s.y, s.x);
      f += 1000 - d;
      if (d < 4) f += 2000 - d * 500;
    }
  }
  if (trait(ctx, BI.CDEPTH)) {
    const s = nearestStair(ctx, FEAT.LESS);
    if (s) {
      const d = doubleDistance(y, x, s.y, s.x);
      f += 1000 - d;
      if (d < 4) f += 2000 - d * 500;
    }
  }
  return f;
}

/* ---------------------------------------------------------------- *
 * borg_caution_phase / borg_caution_teleport (escape.c:323, 416)
 * ---------------------------------------------------------------- */

/** borgCautionPhase (escape.c:323): is a Phase Door landing likely safe? */
export function borgCautionPhase(ctx: BorgContext, emergency: number, turns: number): boolean {
  const dis = 10;
  const min = idiv(dis, 2);
  if (!trait(ctx, BI.APHASE)) return false;

  let n = 0;
  for (let k = 0; k < 100; k++) {
    let y = 0;
    let x = 0;
    let i = 0;
    for (; i < 100; i++) {
      let d: number;
      for (;;) {
        y = ctx.rng.randSpread(ctx.world.self.c.y, dis);
        x = ctx.rng.randSpread(ctx.world.self.c.x, dis);
        d = dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x);
        if (d >= min && d <= dis) break;
      }
      if (y <= 0 || y >= AUTO_MAX_Y - 1) continue;
      if (x <= 0 || x >= AUTO_MAX_X - 1) continue;
      const ag = ctx.world.map.at(x, y);
      if (ag.feat === FEAT.NONE) continue;
      if (!isFloor(ag.feat)) continue;
      if (ag.kill) continue;
      if (ag.web) continue;
      break;
    }
    const ag = ctx.world.map.inBounds(x, y) ? ctx.world.map.at(x, y) : null;
    if (ag && ag.feat === FEAT.NONE && trait(ctx, BI.MAXHP) < 30) {
      n++;
      continue;
    }
    if (i >= 100) {
      n++;
      continue;
    }
    const p = borgDanger(ctx, y, x, turns, true, false);
    if (p > trait(ctx, BI.CURHP)) n++;
  }
  return n <= emergency;
}

/** borgCautionTeleport (escape.c:416): is a full Teleport landing likely safe? */
export function borgCautionTeleport(ctx: BorgContext, emergency: number, turns: number): boolean {
  const dis = 100;
  const min = idiv(dis, 2);
  if (!trait(ctx, BI.ATELEPORT) || !trait(ctx, BI.AESCAPE)) return false;

  let n = 0;
  for (let k = 0; k < 100; k++) {
    let y = 0;
    let x = 0;
    let i = 0;
    for (; i < 100; i++) {
      let d: number;
      for (;;) {
        y = ctx.rng.randSpread(ctx.world.self.c.y, dis);
        x = ctx.rng.randSpread(ctx.world.self.c.x, dis);
        d = dist(ctx.world.self.c.y, ctx.world.self.c.x, y, x);
        if (d >= min && d <= dis) break;
      }
      if (y <= 0 || y >= AUTO_MAX_Y - 1) continue;
      if (x <= 0 || x >= AUTO_MAX_X - 1) continue;
      const ag = ctx.world.map.at(x, y);
      /* Skip unknown grids only once well-explored / late on the level; else ok
       * (escape.c:456; the magic-map fast-path degrades to borg_t > 2000). */
      if (ag.feat === FEAT.NONE && ctx.world.clock > 2000) continue;
      if (!isFloor(ag.feat)) continue;
      if (ag.kill) continue;
      if (ag.web) continue;
      break;
    }
    const ag = ctx.world.map.inBounds(x, y) ? ctx.world.map.at(x, y) : null;
    if (ag && ag.feat === FEAT.NONE && trait(ctx, BI.MAXHP) < 30) {
      n++;
      continue;
    }
    if (i >= 100) {
      n++;
      continue;
    }
    const p = borgDanger(ctx, y, x, turns, true, false);
    if (p > trait(ctx, BI.CURHP)) n++;
  }
  return n <= emergency;
}

/* ---------------------------------------------------------------- *
 * special teleports (escape.c:541..638)
 * ---------------------------------------------------------------- */

/** borgAllowTeleport (escape.c:541). GAP: arena/no-teleport-grid flags absent. */
export function borgAllowTeleport(ctx: BorgContext): boolean {
  if (trait(ctx, BI.CRSNOTEL)) return false;
  return true;
}

/** borgShadowShift (escape.c:559): short teleport + pain. */
export function borgShadowShift(ctx: BorgContext, allowFail: number): AgentCommand | null {
  if (trait(ctx, BI.CURHP) < 12) return null;
  return borgSpellFail(ctx, Spell.SHADOW_SHIFT, allowFail);
}

/** borgDimensionDoor (escape.c:568): medium teleport to the safest grid. */
export function borgDimensionDoor(ctx: BorgContext, allowFail: number): AgentCommand | null {
  const range = 50;
  if (!borgSpellOkayFail(ctx, Spell.DIMENSION_DOOR, allowFail)) return null;
  const fear = getFearCaches(ctx.world);
  const here = fear.region(ctx.world.self.c.y, ctx.world.self.c.x);
  let bestD = here;
  let best: { y: number; x: number } | null = null;
  for (let xo = -range; xo < range; xo++) {
    for (let yo = -range; yo < range; yo++) {
      const tx = ctx.world.self.c.x + xo;
      const ty = ctx.world.self.c.y + yo;
      if (tx < 0 || ty < 0) continue;
      if (!(tx >= 1 && tx < AUTO_MAX_X - 1 && ty >= 1 && ty < AUTO_MAX_Y - 1)) continue;
      const d = borgDanger(ctx, ty, tx, 2, true, false);
      if (d < bestD) {
        bestD = d;
        best = { y: ty, x: tx };
      }
    }
  }
  if (best && bestD < here) {
    borgTarget(ctx, best.y, best.x, false);
    return borgSpell(ctx, Spell.DIMENSION_DOOR);
  }
  return null;
}

/** borg_escape_stair (escape.c:520): leave via an up-stair when standing on one. */
function borgEscapeStair(ctx: BorgContext): AgentCommand | null {
  const { x, y } = ctx.world.self.c;
  if (!ctx.world.map.inBounds(x, y)) return null;
  if (ctx.world.map.at(x, y).feat === FEAT.LESS) {
    /* GAP: OPT(birth_force_descend) unavailable; assume normal descent rules. */
    return ctx.act.ascend();
  }
  return null;
}

/** borg_teleport_off_level (escape.c:622): teleport level / deep descent. */
function borgTeleportOffLevel(ctx: BorgContext): AgentCommand | null {
  if (ctx.world.self.goal.recalling || ctx.world.self.goal.descending) return null;
  return firstCmd(
    borgReadScroll(ctx, SVAL.scroll.teleport_level!),
    borgActivateItem(ctx, "act_tele_level"),
    borgActivateItem(ctx, "act_deep_descent"),
    borgReadScroll(ctx, SVAL.scroll.deep_descent!),
  );
}

/* borg_primarily_caster approximation (borg-magic.c). */
function primarilyCaster(ctx: BorgContext): boolean {
  const c = trait(ctx, BI.CLASS);
  return c === CLASS_MAGE || c === CLASS_NECROMANCER || c === CLASS_PRIEST || c === CLASS_DRUID;
}

/** borg_shoot_scoot_safe (borg-flow-kill.c:2901), reimplemented for escape. */
function borgShootScootSafe(ctx: BorgContext, emergency: number, turns: number): boolean {
  if (trait(ctx, BI.CLEVEL) >= 8 && trait(ctx, BI.CDEPTH) === 0) return false;
  if (!trait(ctx, BI.APHASE)) return false;
  if (!trait(ctx, BI.LIGHT)) return false;
  /* GAP: square_isvault unavailable on the borg map. */

  if (primarilyCaster(ctx)) {
    if (trait(ctx, BI.CLEVEL) >= 45 && trait(ctx, BI.CURSP) < 15) return false;
    if (trait(ctx, BI.CLEVEL) < 45 && trait(ctx, BI.CURSP) < 5) return false;
  } else {
    if (trait(ctx, BI.AMISSILES) < 5 || trait(ctx, BI.CLEVEL) >= 45) return false;
  }

  const g = getDangerGlobals(ctx.world);
  if (g.morgothPosition || g.asPosition) return false;

  let adjacent = false;
  for (let i = 0; i < 8; i++) {
    const x = ctx.world.self.c.x + ddx_ddd[i]!;
    const y = ctx.world.self.c.y + ddy_ddd[i]!;
    if (!ctx.world.map.inBounds(x, y)) continue;
    const ag = ctx.world.map.at(x, y);
    if (!ag.kill) continue;
    const kill = ctx.world.kills.at(ag.kill);
    if (
      kill.awake &&
      !rf(ctx, ag.kill, "NEVER_MOVE") &&
      !rf(ctx, ag.kill, "PASS_WALL") &&
      !rf(ctx, ag.kill, "KILL_WALL") &&
      kill.power >= trait(ctx, BI.CLEVEL)
    ) {
      if (
        borgSpellOkay(ctx, Spell.MAGIC_MISSILE) ||
        borgSpellOkay(ctx, Spell.ORB_OF_DRAINING) ||
        borgSpellOkay(ctx, Spell.NETHER_BOLT)
      ) {
        adjacent = true;
      } else {
        const facts = g.resolveFacts(ctx, ag.kill);
        if (
          borgDanger(ctx, kill.pos.y, kill.pos.x, 1, true, false) > idiv(avoidance(ctx) * 3, 10) ||
          (facts.hasFriends && kill.level >= trait(ctx, BI.CLEVEL) - 5) ||
          kill.rangedAttack ||
          facts.flags.has("UNIQUE") ||
          facts.flags.has("MULTIPLY") ||
          trait(ctx, BI.CLEVEL) <= 5
        )
          adjacent = true;
      }
    }
  }
  if (!adjacent) return false;

  /* Landing-zone safety: same 100-jump sim as caution_phase. */
  return borgCautionPhase(ctx, emergency, turns);
}

/* ---------------------------------------------------------------- *
 * borg_escape (escape.c:644)
 * ---------------------------------------------------------------- */

/** Reset the anti-summon timer when we escaped a corridor (escape.c:774). */
function resetAntisummon(ctx: BorgContext, fs: FightState): void {
  if (ctx.world.clock - fs.tAntisummon < 50) fs.tAntisummon = 0;
}

/**
 * borgEscape (escape.c:644): try to phase/teleport away. b_q is the danger of
 * the least-dangerous adjacent square. Returns the escape command, or null.
 * The full Danger-Level 1..8 threshold ladder is preserved verbatim.
 */
export function borgEscape(ctx: BorgContext, bQ: number): AgentCommand | null {
  const fs = getFightState(ctx.world);
  const av = avoidance(ctx);
  const uniq = fs.fightingUnique;
  const cdepth = trait(ctx, BI.CDEPTH);
  const curhp = trait(ctx, BI.CURHP);
  const maxhp = trait(ctx, BI.MAXHP);
  const clevel = trait(ctx, BI.CLEVEL);

  let allowFail = 25;
  if (idiv(curhp * 100, maxhp) > 70) allowFail = 10;
  if (trait(ctx, BI.ISHEAVYSTUN)) allowFail = 35;

  /* Bleeding/poisoned in town: let the shop-run finish (escape.c:674). */
  if (!cdepth && (trait(ctx, BI.ISPOISONED) || trait(ctx, BI.ISWEAK) || trait(ctx, BI.ISCUT)))
    return null;

  /* Sea-of-runes hold (escape.c:682). */
  if (cdepth === 100 && curhp >= idiv(maxhp * 5, 10)) {
    if (getDangerGlobals(ctx.world).morgothPosition) return null;
    let glyphs = 0;
    for (let j = 0; j < 8; j++) {
      const y = ctx.world.self.c.y + ddy_ddd[j]!;
      const x = ctx.world.self.c.x + ddx_ddd[j]!;
      if (ctx.world.map.inBounds(x, y) && ctx.world.map.at(x, y).glyph) glyphs++;
    }
    if (glyphs >= 3) return null;
  }

  /* Weak on depth 1: risk diving (escape.c:709). */
  if (trait(ctx, BI.ISWEAK) && cdepth === 1) {
    const cmd = borgTeleportOffLevel(ctx);
    if (cmd) return cmd;
  }

  const risky = fs.playsRisky ? 3 : 0;

  /* --- Danger Level 1: about to die (escape.c:720). --- */
  if (
    trait(ctx, BI.ISHEAVYSTUN) ||
    bQ > idiv(av * (45 + risky), 10) ||
    (bQ > idiv(av * (40 + risky), 10) && uniq >= 10 && cdepth === 100 && curhp < 600) ||
    (bQ > idiv(av * (30 + risky), 10) && uniq >= 10 && cdepth === 99 && curhp < 600) ||
    (bQ > idiv(av * (25 + risky), 10) && uniq >= 1 && uniq <= 8 && cdepth >= 95 && curhp < 550) ||
    (bQ > idiv(av * (17 + risky), 10) && uniq >= 1 && uniq <= 8 && cdepth < 95) ||
    (bQ > idiv(av * (15 + risky), 10) && !uniq)
  ) {
    const taf = 15;
    let cmd = firstCmd(borgEscapeStair(ctx));
    if (!cmd && borgAllowTeleport(ctx)) {
      cmd = firstCmd(
        borgDimensionDoor(ctx, taf - 10),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, taf - 10),
        borgSpellFail(ctx, Spell.PORTAL, taf - 10),
        borgShadowShift(ctx, taf - 10),
        borgReadScroll(ctx, SVAL.scroll.teleport!),
        borgUseStaffFail(ctx, SVAL.staff.teleportation!),
        borgActivateItem(ctx, "act_tele_long"),
        borgTeleportOffLevel(ctx),
        borgDimensionDoor(ctx, taf + 9),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, taf + 9),
        borgSpellFail(ctx, Spell.PORTAL, taf + 9),
        borgShadowShift(ctx, taf + 9),
        borgUseStaff(ctx, SVAL.staff.teleportation!),
        borgSpellFail(ctx, Spell.TELEPORT_LEVEL, taf + 9),
        borgCautionPhase(ctx, 75, 2)
          ? firstCmd(
              borgReadScroll(ctx, SVAL.scroll.phase_door!),
              borgActivateItem(ctx, "act_tele_phase"),
              borgSpellFail(ctx, Spell.PHASE_DOOR, taf),
              borgSpellFail(ctx, Spell.PORTAL, taf),
            )
          : null,
      );
    }
    if (cmd) {
      resetAntisummon(ctx, fs);
      return cmd;
    }
    /* critical emergency attempts (escape.c:779). */
    if (
      cdepth &&
      clevel < 10 &&
      curhp < idiv(maxhp * 1, 10) &&
      borgAllowTeleport(ctx)
    ) {
      const c2 = firstCmd(borgDimensionDoor(ctx, 90), borgSpell(ctx, Spell.TELEPORT_SELF), borgSpell(ctx, Spell.PORTAL));
      if (c2) {
        resetAntisummon(ctx, fs);
        return c2;
      }
    }
    if (
      cdepth &&
      (curhp < idiv(maxhp * 1, 10) || bQ > idiv(av * (45 + risky), 10))
    ) {
      const c3 = firstCmd(borgActivateItem(ctx, "act_tele_phase"), borgReadScroll(ctx, SVAL.scroll.phase_door!));
      if (c3) {
        ctx.world.self.escapes--;
        resetAntisummon(ctx, fs);
        return c3;
      }
    }
    if (cdepth && clevel < 10 && curhp < idiv(maxhp * 1, 10)) {
      const c4 = firstCmd(borgSpellFail(ctx, Spell.PHASE_DOOR, 15), borgSpell(ctx, Spell.PORTAL));
      if (c4) {
        resetAntisummon(ctx, fs);
        return c4;
      }
    }
  }

  /* End-game unique: stay and fight unless extreme (escape.c:835). */
  if (bQ < idiv(av * (25 + risky), 10) && uniq >= 1 && uniq <= 3 && cdepth >= 97) return null;

  /* --- Danger Level 2 (escape.c:843). --- */
  if (
    trait(ctx, BI.ISHEAVYSTUN) ||
    (bQ > idiv(av * (3 + risky), 10) && trait(ctx, BI.CLASS) === CLASS_MAGE && trait(ctx, BI.CURSP) <= 20 && trait(ctx, BI.MAXCLEVEL) >= 45) ||
    (bQ > idiv(av * (13 + risky), 10) && uniq >= 1 && uniq <= 8 && cdepth !== 99) ||
    (bQ > idiv(av * (11 + risky), 10) && !uniq)
  ) {
    let cmd = firstCmd(borgEscapeStair(ctx));
    if (!cmd && borgAllowTeleport(ctx)) {
      cmd = firstCmd(
        borgDimensionDoor(ctx, allowFail - 10),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, allowFail - 10),
        borgSpellFail(ctx, Spell.PORTAL, allowFail - 10),
        borgShadowShift(ctx, allowFail - 10),
        borgUseStaffFail(ctx, SVAL.staff.teleportation!),
        borgActivateItem(ctx, "act_tele_long"),
        borgReadScroll(ctx, SVAL.scroll.teleport!),
        borgDimensionDoor(ctx, allowFail),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgShadowShift(ctx, allowFail),
        borgUseStaff(ctx, SVAL.staff.teleportation!),
      );
    }
    if (cmd) {
      resetAntisummon(ctx, fs);
      return cmd;
    }
    if (borgCautionPhase(ctx, 50, 2) && ctx.world.clock - fs.tAntisummon > 50) {
      const c2 = firstCmd(
        borgSpell(ctx, Spell.PHASE_DOOR),
        borgSpell(ctx, Spell.PORTAL),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
        borgActivateItem(ctx, "act_tele_phase"),
      );
      if (c2) {
        resetAntisummon(ctx, fs);
        return c2;
      }
    }
  }

  /* --- Danger Level 3 (escape.c:892). --- */
  if (
    trait(ctx, BI.ISHEAVYSTUN) ||
    (bQ > idiv(av * (13 + risky), 10) && uniq >= 2 && uniq <= 8) ||
    (bQ > idiv(av * (10 + risky), 10) && !uniq) ||
    (bQ > idiv(av * (10 + risky), 10) && trait(ctx, BI.ISAFRAID) && trait(ctx, BI.AMISSILES) <= 0 && trait(ctx, BI.CLASS) === CLASS_WARRIOR)
  ) {
    if ((borgEscapeStair(ctx) || borgCautionPhase(ctx, 25, 2)) && ctx.world.clock - fs.tAntisummon > 50) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
      );
      if (c) {
        ctx.world.self.escapes--;
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (borgAllowTeleport(ctx)) {
      const c = firstCmd(
        borgDimensionDoor(ctx, allowFail),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgShadowShift(ctx, allowFail),
        borgActivateItem(ctx, "act_tele_long"),
        borgUseStaffFail(ctx, SVAL.staff.teleportation!),
        borgReadScroll(ctx, SVAL.scroll.teleport!),
        borgActivateItem(ctx, "act_tele_phase"),
      );
      if (c) {
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (borgCautionPhase(ctx, 75, 2) && ctx.world.clock - fs.tAntisummon > 50) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgShadowShift(ctx, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
      );
      if (c) {
        ctx.world.self.escapes--;
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    const off = borgTeleportOffLevel(ctx);
    if (off) {
      resetAntisummon(ctx, fs);
      return off;
    }
    if (!ctx.world.self.goal.fleeing && (!uniq || clevel < 35) && !ctx.world.facts.vaultOnLevel)
      ctx.world.self.goal.fleeing = true;
    if (!ctx.world.self.goal.leaving && (!uniq || clevel < 35) && !ctx.world.facts.vaultOnLevel)
      ctx.world.self.goal.leaving = true;
  }

  /* --- Danger Level 4 (escape.c:997). --- */
  if (
    (bQ > idiv(av * (8 + risky), 10) && (clevel < 35 || curhp <= idiv(maxhp, 3))) ||
    (bQ > idiv(av * (9 + risky), 10) && uniq >= 1 && uniq <= 8 && (clevel < 35 || curhp <= idiv(maxhp, 3))) ||
    (bQ > idiv(av * (6 + risky), 10) && clevel <= 20 && !uniq) ||
    (bQ > idiv(av * (6 + risky), 10) && clevel <= 35)
  ) {
    if ((borgEscapeStair(ctx) || borgCautionPhase(ctx, 20, 2)) && ctx.world.clock - fs.tAntisummon > 50) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgShadowShift(ctx, allowFail),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
      );
      if (c) {
        ctx.world.self.escapes--;
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (borgAllowTeleport(ctx)) {
      const c = firstCmd(
        borgDimensionDoor(ctx, allowFail),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_long"),
        borgShadowShift(ctx, allowFail),
        borgReadScroll(ctx, SVAL.scroll.teleport!),
        borgUseStaffFail(ctx, SVAL.staff.teleportation!),
      );
      if (c) {
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (!ctx.world.self.goal.fleeing && !uniq && clevel < 25 && !ctx.world.facts.vaultOnLevel)
      ctx.world.self.goal.fleeing = true;
    if (!ctx.world.self.goal.leaving && !uniq && !ctx.world.facts.vaultOnLevel)
      ctx.world.self.goal.leaving = true;
    if (
      (trait(ctx, BI.CLASS) === CLASS_MAGE || trait(ctx, BI.CLASS) === CLASS_NECROMANCER) &&
      clevel <= 35 &&
      borgCautionPhase(ctx, 65, 2) &&
      ctx.world.clock - fs.tAntisummon > 50
    ) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgActivateItem(ctx, "act_tele_long"),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
      );
      if (c) {
        ctx.world.self.escapes--;
        resetAntisummon(ctx, fs);
        return c;
      }
    }
  }

  /* --- Danger Level 5: very low level (escape.c:1089). --- */
  if (
    clevel < 10 &&
    (bQ > idiv(av * (5 + risky), 10) || (bQ > idiv(av * (7 + risky), 10) && uniq >= 1 && uniq <= 8))
  ) {
    if (borgEscapeStair(ctx) || borgCautionPhase(ctx, 20, 2)) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgShadowShift(ctx, allowFail),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
      );
      if (c) {
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (borgAllowTeleport(ctx)) {
      const c = firstCmd(
        borgDimensionDoor(ctx, allowFail),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgShadowShift(ctx, allowFail),
        borgActivateItem(ctx, "act_tele_long"),
        borgReadScroll(ctx, SVAL.scroll.teleport!),
        borgUseStaffFail(ctx, SVAL.staff.teleportation!),
      );
      if (c) {
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (!ctx.world.self.goal.fleeing && !uniq) ctx.world.self.goal.fleeing = true;
    if (!ctx.world.self.goal.leaving && !uniq) ctx.world.self.goal.leaving = true;
    if (
      (trait(ctx, BI.CLASS) === CLASS_MAGE || trait(ctx, BI.CLASS) === CLASS_NECROMANCER) &&
      clevel <= 8 &&
      borgCautionPhase(ctx, 65, 2)
    ) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
        borgActivateItem(ctx, "act_tele_long"),
      );
      if (c) {
        ctx.world.self.escapes--;
        resetAntisummon(ctx, fs);
        return c;
      }
    }
  }

  /* --- Danger Level 6: out of mana caster (escape.c:1170). --- */
  if (
    (trait(ctx, BI.CLASS) === CLASS_MAGE || trait(ctx, BI.CLASS) === CLASS_PRIEST || trait(ctx, BI.CLASS) === CLASS_NECROMANCER) &&
    (bQ > idiv(av * (6 + risky), 10) || (bQ > idiv(av * (8 + risky), 10) && uniq >= 1 && uniq <= 8)) &&
    trait(ctx, BI.CURSP) <= idiv(trait(ctx, BI.MAXSP) * 1, 10) &&
    trait(ctx, BI.MAXSP) >= 100
  ) {
    if ((borgEscapeStair(ctx) || borgCautionPhase(ctx, 20, 2)) && ctx.world.clock - fs.tAntisummon > 50) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
      );
      if (c) {
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (borgAllowTeleport(ctx)) {
      const c = firstCmd(
        borgDimensionDoor(ctx, allowFail),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_long"),
        borgReadScroll(ctx, SVAL.scroll.teleport!),
        borgUseStaffFail(ctx, SVAL.staff.teleportation!),
      );
      if (c) {
        resetAntisummon(ctx, fs);
        return c;
      }
    }
  }

  /* --- Danger Level 7: shoot-n-scoot (escape.c:1216). --- */
  if (
    (borgSpellOkayFail(ctx, Spell.PHASE_DOOR, allowFail) || borgSpellOkayFail(ctx, Spell.PORTAL, allowFail)) &&
    borgShootScootSafe(ctx, 20, 2)
  ) {
    const c = firstCmd(borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail), borgSpellFail(ctx, Spell.PORTAL, allowFail));
    if (c) {
      ctx.world.self.escapes--;
      resetAntisummon(ctx, fs);
      return c;
    }
  }

  /* --- Danger Level 8: twitching (escape.c:1236). --- */
  if (ctx.world.self.timesTwitch > 50) {
    if ((borgEscapeStair(ctx) || borgCautionPhase(ctx, 20, 2)) && ctx.world.clock - fs.tAntisummon > 50) {
      const c = firstCmd(
        borgSpellFail(ctx, Spell.PHASE_DOOR, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_phase"),
        borgReadScroll(ctx, SVAL.scroll.phase_door!),
      );
      if (c) {
        ctx.world.self.timesTwitch = 0;
        resetAntisummon(ctx, fs);
        return c;
      }
    }
    if (borgAllowTeleport(ctx)) {
      const c = firstCmd(
        borgDimensionDoor(ctx, allowFail),
        borgSpellFail(ctx, Spell.TELEPORT_SELF, allowFail),
        borgSpellFail(ctx, Spell.PORTAL, allowFail),
        borgActivateItem(ctx, "act_tele_long"),
        borgReadScroll(ctx, SVAL.scroll.teleport!),
        borgUseStaffFail(ctx, SVAL.staff.teleportation!),
        borgTeleportOffLevel(ctx),
      );
      if (c) {
        ctx.world.self.timesTwitch = 0;
        resetAntisummon(ctx, fs);
        return c;
      }
    }
  }

  return null;
}
