/**
 * "Munchkin mode" attacks - the super-cautious early-game stair-scum combat, a
 * faithful port of reference/src/borg/borg-attack-munchkin.c.
 *
 * The borg rests on a stair to recover, then uses limited magic (mage) or melee
 * to pick off easy monsters, fleeing via the stair if anything gets close. Both
 * routines reuse borgCalculateAttackEffectiveness for the actual damage sim.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { BI, CLASS_MAGE, CLASS_NECROMANCER } from "../trait/trait-index";
import { trait } from "../item/deps";
import { borgDanger, getDangerGlobals } from "../danger";
import { FEAT } from "../flow/flow-consts";
import { getFightState, idiv, iabs } from "./state";
import { BF } from "./bf";
import { borgCalculateAttackEffectiveness } from "./attack";

/** Chebyshev distance. */
function dist(y1: number, x1: number, y2: number, x2: number): number {
  return Math.max(iabs(y1 - y2), iabs(x1 - x2));
}

function avoidance(ctx: BorgContext): number {
  return getDangerGlobals(ctx.world).avoidance;
}

function onStair(ctx: BorgContext): boolean {
  const { x, y } = ctx.world.self.c;
  if (!ctx.world.map.inBounds(x, y)) return false;
  const f = ctx.world.map.at(x, y).feat;
  return f === FEAT.MORE || f === FEAT.LESS;
}

function maxRange(ctx: BorgContext): number {
  return ctx.view.constants().maxRange ?? 20;
}

/** borg_munchkin_mage (munchkin.c:47): rest-and-shoot from a stair. */
export function borgMunchkinMage(ctx: BorgContext): AgentCommand | null {
  const fs = getFightState(ctx.world);
  const g = getDangerGlobals(ctx.world);

  if (!onStair(ctx)) return null;
  if (
    borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, true) > idiv(avoidance(ctx) * 7, 10) ||
    trait(ctx, BI.CURHP) < idiv(trait(ctx, BI.MAXHP), 3)
  )
    return null;
  if (trait(ctx, BI.ISCONFUSED)) return null;
  if (ctx.world.kills.count <= 1) return null;

  g.attacking = true;
  g.fightingUnique = fs.fightingUnique !== 0;
  fs.tempN = 0;

  for (const [i, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (kill.when < ctx.world.clock - 2) continue;
    if (trait(ctx, BI.CDEPTH) === 0) continue;
    if (
      (kill.speed > trait(ctx, BI.SPEED) && dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) <= 2) ||
      dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) <= 1
    ) {
      g.attacking = false;
      return null;
    }
    if (ctx.world.facts.scaryGuyOnLevel) {
      g.attacking = false;
      return null;
    }
    if (!ctx.world.map.inBounds(kill.pos.x, kill.pos.y)) continue;
    const ag = ctx.world.map.at(kill.pos.x, kill.pos.y);
    if (!(ag.info & 0x08)) continue; /* BORG_OKAY */
    if (!(ag.info & 0x20)) continue; /* BORG_VIEW */
    if (dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) > maxRange(ctx)) continue;
    fs.tempX[fs.tempN] = kill.pos.x;
    fs.tempY[fs.tempN] = kill.pos.y;
    fs.tempN++;
    void i;
  }

  if (!fs.tempN) {
    g.attacking = false;
    return null;
  }

  fs.simulate = true;
  let bDam = -1;
  let bN = -1;
  for (let i = 0; i < BF.MAX; i++) {
    if (i <= 1) continue; /* skip BF_REST / BF_THRUST */
    const dam = borgCalculateAttackEffectiveness(ctx, fs, i as BF);
    if (dam >= bDam && dam > 0) {
      bDam = dam;
      bN = i;
    }
  }
  if (bN < 0 || bDam <= 0) {
    g.attacking = false;
    return null;
  }

  fs.simulate = false;
  fs.pending = null;
  borgCalculateAttackEffectiveness(ctx, fs, bN as BF);
  g.attacking = false;
  return fs.pending;
}

/** borg_munchkin_melee (munchkin.c:192): rest-and-melee from a stair. */
export function borgMunchkinMelee(ctx: BorgContext): AgentCommand | null {
  const fs = getFightState(ctx.world);
  const g = getDangerGlobals(ctx.world);

  if (trait(ctx, BI.CLASS) === CLASS_MAGE || trait(ctx, BI.CLASS) === CLASS_NECROMANCER) return null;
  if (!onStair(ctx)) return null;
  if (ctx.world.kills.count <= 1) return null;
  if (
    borgDanger(ctx, ctx.world.self.c.y, ctx.world.self.c.x, 1, true, true) > idiv(avoidance(ctx) * 7, 10) ||
    trait(ctx, BI.CURHP) < idiv(trait(ctx, BI.MAXHP), 3)
  )
    return null;
  if (trait(ctx, BI.ISCONFUSED)) return null;

  g.attacking = true;
  g.fightingUnique = fs.fightingUnique !== 0;
  fs.tempN = 0;

  for (const [, kill] of ctx.world.kills.entries()) {
    if (!kill.rIdx) continue;
    if (kill.when < ctx.world.clock - 2) continue;
    if (trait(ctx, BI.CDEPTH) === 0) continue;
    if (ctx.world.facts.scaryGuyOnLevel) {
      g.attacking = false;
      return null;
    }
    if (!ctx.world.map.inBounds(kill.pos.x, kill.pos.y)) continue;
    const ag = ctx.world.map.at(kill.pos.x, kill.pos.y);
    if (!(ag.info & 0x08)) continue;
    if (!(ag.info & 0x20)) continue;
    if (dist(ctx.world.self.c.y, ctx.world.self.c.x, kill.pos.y, kill.pos.x) !== 1) continue;
    fs.tempX[fs.tempN] = kill.pos.x;
    fs.tempY[fs.tempN] = kill.pos.y;
    fs.tempN++;
  }

  if (!fs.tempN) {
    g.attacking = false;
    return null;
  }

  fs.simulate = true;
  const n = borgCalculateAttackEffectiveness(ctx, fs, BF.THRUST);
  if (n <= 0) {
    g.attacking = false;
    return null;
  }

  fs.simulate = false;
  fs.pending = null;
  borgCalculateAttackEffectiveness(ctx, fs, BF.THRUST);
  g.attacking = false;
  return fs.pending;
}
