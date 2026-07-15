/**
 * Flow toward monsters to kill: a faithful port of the navigation routines in
 * reference/src/borg/borg-flow-kill.c (borg_flow_kill, borg_flow_kill_aim,
 * borg_flow_kill_corridor, borg_flow_kill_direct). The monster-belief
 * bookkeeping (observe_kill_*, borg_near_monster_type, etc.) overlaps perception
 * and is intentionally out of scope here; only the flow/navigation is ported.
 *
 * ADAPTATIONS
 * - Monster race-flag tests (RF_UNIQUE / RF_MULTIPLY / RF_NEVER_MOVE /
 *   RF_GROUP_AI / RF_PASS_WALL / RF_KILL_WALL) use FlowHooks.monsterHasFlag
 *   (default false) until the monster-race model lands (P8.6).
 * - Danger uses FlowHooks.danger; the distance-attack / dig-magic / line-of-sight
 *   dependencies use FlowHooks.hasDistanceAttack / canDigMagic / los.
 * - In the corridor's "summoner out of LOS" branch, borg_detect_wall panel data
 *   is unavailable, so with the default los() == true that pre-dig branch is
 *   skipped and the pattern search (the geometric heart) runs unchanged.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { distance } from "../think";
import { GOAL_DIGGING, GOAL_KILL } from "../world/model";
import { BORG_VIEW } from "../world/grid";
import { AUTO_MAX_X, AUTO_MAX_Y, BI, FEAT, trait } from "./flow-consts";
import {
  borgCanDig,
  borgFlowClear,
  borgFlowCommit,
  borgFlowEnqueueGrid,
  borgFlowOld,
  borgFlowSpread,
  type FlowState,
} from "./flow";
import { borgFlowFarFromStairs, nearestUpStair } from "./flow-misc";
import { syncStairsFromMap } from "./flow-stairs";

/**
 * borg_flow_kill (borg-flow-kill.c): flow toward a monster worth engaging.
 */
export function borgFlowKill(
  ctx: BorgContext,
  flow: FlowState,
  viewable: boolean,
  nearness: number,
): AgentCommand | null {
  const w = ctx.world;

  if (!w.kills.count || w.kills.count <= 1) return null;

  /* Don't chase town monsters when just starting out */
  if (trait(w, BI.CDEPTH) === 0 && trait(w, BI.CLEVEL) < 20) return null;

  /* Casters are not warriors */
  if (
    (trait(w, BI.CLASS) === 1 /* MAGE */ || trait(w, BI.CLASS) === 4 /* NECRO */) &&
    trait(w, BI.CLEVEL) < (trait(w, BI.CDEPTH) ? 35 : 25)
  )
    return null;

  if (trait(w, BI.ISHUNGRY) || trait(w, BI.ISWEAK) || trait(w, BI.FOOD) === 0)
    return null;
  if (flow.borgMorgothPosition) return null;

  flow.tempN = 0;

  /* Am I in a hall? (walls in my 3x3, cumulative like upstream) */
  let borgInHall = false;
  let hallWalls = 0;
  for (let hx = -1; hx <= 1; hx++) {
    for (let hy = -1; hy <= 1; hy++) {
      const x = hx + w.self.c.x;
      const y = hy + w.self.c.y;
      if (!w.map.inBounds(x, y)) continue;
      const ag = w.map.at(x, y);
      if (ag.glyph || (ag.feat >= FEAT.MAGMA && ag.feat <= FEAT.PERM)) hallWalls++;
      if (hallWalls >= 5) borgInHall = true;
    }
  }

  syncStairsFromMap(ctx, flow);
  const bStair = nearestUpStair(ctx, flow);
  const bJ =
    bStair === -1
      ? -1
      : distance(w.self.c.x, w.self.c.y, flow.less.x[bStair]!, flow.less.y[bStair]!);

  for (const [ki, kill] of w.kills.entries()) {
    const x9 = kill.pos.x;
    const y9 = kill.pos.y;
    const ax = Math.abs(x9 - w.self.c.x);
    const ay = Math.abs(y9 - w.self.c.y);
    const d = Math.max(ax, ay);

    let skipMonster = false;

    if (d === 1 && (trait(w, BI.ISAFRAID) || trait(w, BI.CRSFEAR))) continue;
    if (
      w.self.goal.ignoring &&
      !trait(w, BI.ISAFRAID) &&
      flow.hooks.monsterHasFlag(w, ki, "MULTIPLY")
    )
      continue;
    if (trait(w, BI.MAXCLEVEL) < 10 && flow.hooks.monsterHasFlag(w, ki, "NEVER_MOVE"))
      continue;
    if (w.facts.scaryGuyOnLevel) continue;
    if (trait(w, BI.CLEVEL) < 10 && flow.hooks.monsterHasFlag(w, ki, "MULTIPLY"))
      continue;
    if (
      flow.hooks.monsterHasFlag(w, ki, "UNIQUE") &&
      trait(w, BI.CDEPTH) === 0 &&
      trait(w, BI.CLEVEL) < 5
    )
      continue;

    const x = x9;
    const y = y9;
    const ag = w.map.at(x, y);
    if (viewable && !(ag.info & BORG_VIEW)) continue;

    const p = flow.hooks.danger(w, y, x);

    /* Skip deadly monsters unless uniques */
    if (
      trait(w, BI.CLEVEL) > 25 &&
      !flow.hooks.monsterHasFlag(w, ki, "UNIQUE") &&
      p > Math.trunc(flow.avoidance / 2)
    )
      continue;
    if (trait(w, BI.CLEVEL) <= 15 && p > Math.trunc(flow.avoidance / 3)) continue;

    /* Skip ones that make me wander too far */
    if (bStair !== -1 && trait(w, BI.CLEVEL) < 10) {
      const j = distance(flow.less.x[bStair]!, flow.less.y[bStair]!, x, y);
      if (bJ <= trait(w, BI.CLEVEL) * 5 + 9 && j >= trait(w, BI.CLEVEL) * 5 + 9)
        continue;
    }

    /* Avoid getting surrounded by groups when both are out of a hall */
    if (borgInHall && flow.hooks.monsterHasFlag(w, ki, "GROUP_AI")) {
      for (let hx = -1; hx <= 1; hx++) {
        for (let hy = -1; hy <= 1; hy++) {
          if (!w.map.inBounds(hx + x, hy + y)) continue;
          const ag2 = w.map.at(hx + x, hy + y);
          if (ag2.glyph || (ag2.feat >= FEAT.MAGMA && ag2.feat <= FEAT.PERM))
            hallWalls++;
          if (hallWalls < 4) skipMonster = true;
        }
      }
    }

    /* Skip a monster 2 away that could hit me as I close (no ranged/immobile) */
    if (
      d === 2 &&
      !kill.rangedAttack &&
      !flow.hooks.monsterHasFlag(w, ki, "NEVER_MOVE")
    )
      skipMonster = true;

    if (skipMonster) continue;
    if (borgFlowFarFromStairs(ctx, flow, x, y, bStair)) continue;

    flow.tempX[flow.tempN] = x;
    flow.tempY[flow.tempN] = y;
    flow.tempN++;
  }

  if (!flow.tempN) return null;

  borgFlowClear(flow);
  for (let i = 0; i < flow.tempN; i++) {
    borgFlowEnqueueGrid(ctx, flow, flow.tempY[i]!, flow.tempX[i]!);
  }
  borgFlowSpread(ctx, flow, nearness, true, !viewable, false, -1, false);

  if (!borgFlowCommit(ctx, flow, GOAL_KILL)) return null;
  return borgFlowOld(ctx, flow, GOAL_KILL);
}

/**
 * borg_flow_kill_aim (borg-flow-kill.c): take a couple of steps to line up a
 * ranged shot. Mutates self.c to probe alternate positions (restored after).
 */
export function borgFlowKillAim(ctx: BorgContext, flow: FlowState, viewable: boolean): AgentCommand | null {
  const w = ctx.world;

  if (!w.kills.count || w.kills.count <= 1) return null;
  if (w.self.timeThisPanel > 500) return null;
  if (trait(w, BI.ISHUNGRY) || trait(w, BI.ISWEAK) || trait(w, BI.FOOD) === 0) return null;

  /* Already able to shoot -- no need to re-aim */
  if (flow.hooks.hasDistanceAttack(w)) return null;

  const sy = w.self.c.y;
  const sx = w.self.c.x;

  for (let ox = -2; ox <= 2; ox++) {
    for (let oy = -2; oy <= 2; oy++) {
      if (ox === 0 && oy === 0) continue;

      w.self.c.x = sx + ox;
      w.self.c.y = sy + oy;

      if (
        w.self.c.x > AUTO_MAX_X - 2 ||
        w.self.c.x < 2 ||
        w.self.c.y > AUTO_MAX_Y - 2 ||
        w.self.c.y < 2
      )
        continue;

      /* Do not end up adjacent to a monster */
      let adjacent = false;
      for (const [, kill] of w.kills.entries()) {
        if (distance(w.self.c.x, w.self.c.y, kill.pos.x, kill.pos.y) === 1) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) continue;

      if (flow.hooks.hasDistanceAttack(w)) {
        borgFlowClear(flow);
        borgFlowEnqueueGrid(ctx, flow, w.self.c.y, w.self.c.x);
        w.self.c.x = sx;
        w.self.c.y = sy;
        borgFlowSpread(ctx, flow, 5, true, !viewable, false, -1, false);
        if (!borgFlowCommit(ctx, flow, GOAL_KILL)) return null;
        return borgFlowOld(ctx, flow, GOAL_KILL);
      }
    }
  }

  w.self.c.x = sx;
  w.self.c.y = sy;
  return null;
}

/* Anti-summon corridor pattern arrays (borg-flow-kill.c). */
// prettier-ignore
const N_ARRAY = [1,0,0,0,1, 1,0,1,0,1, 0,1,0,1,0, 0,0,1,0,0, 1,1,1,1,1];
// prettier-ignore
const NY = [-4,-4,-4,-4,-4, -3,-3,-3,-3,-3, -2,-2,-2,-2,-2, -1,-1,-1,-1,-1, 0,0,0,0,0];
// prettier-ignore
const NX = [-2,-1,0,1,2, -2,-1,0,1,2, -2,-1,0,1,2, -2,-1,0,1,2, -2,-1,0,1,2];
// prettier-ignore
const S_ARRAY = [1,1,1,1,1, 0,0,1,0,0, 0,1,0,1,0, 1,0,1,0,1, 1,0,0,0,1];
// prettier-ignore
const SY = [0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2, 3,3,3,3,3, 4,4,4,4,4];
// prettier-ignore
const SX = [-2,-1,0,1,2, -2,-1,0,1,2, -2,-1,0,1,2, -2,-1,0,1,2, -2,-1,0,1,2];
// prettier-ignore
const E_ARRAY = [1,0,0,1,1, 1,0,1,0,0, 1,1,0,1,0, 1,0,1,0,0, 1,0,0,1,1];
// prettier-ignore
const EY = [-2,-2,-2,-2,-2, -1,-1,-1,-1,-1, 0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2];
// prettier-ignore
const EX = [0,1,2,3,4, 0,1,2,3,4, 0,1,2,3,4, 0,1,2,3,4, 0,1,2,3,4];
// prettier-ignore
const W_ARRAY = [1,1,0,0,1, 0,0,1,0,1, 0,1,0,1,1, 0,0,1,0,1, 1,1,0,0,1];
// prettier-ignore
const WY = [-2,-2,-2,-2,-2, -1,-1,-1,-1,-1, 0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2];
// prettier-ignore
const WX = [-4,-3,-2,-1,0, -4,-3,-2,-1,0, -4,-3,-2,-1,0, -4,-3,-2,-1,0, -4,-3,-2,-1,0];

/** Does grid (mx, my) count as the "must be wall" cell type? */
function isWallCell(feat: number): boolean {
  return (
    feat === FEAT.NONE ||
    (feat >= FEAT.MAGMA && feat <= FEAT.QUARTZ_K) ||
    feat === FEAT.GRANITE
  );
}

/** Does grid (mx, my) count as a "wall or open" cell for the array==1 slots? */
function isWallOrFloorCell(feat: number): boolean {
  return (
    feat <= FEAT.MORE ||
    (feat >= FEAT.MAGMA && feat <= FEAT.QUARTZ_K) ||
    feat === FEAT.GRANITE
  );
}

/** Score one 5x5 pattern; returns 25 for a perfect match. */
function scorePattern(
  ctx: BorgContext,
  oy: number,
  ox: number,
  arr: number[],
  ay: number[],
  axArr: number[],
): number {
  const w = ctx.world;
  let count = 0;
  for (let i = 0; i < 25; i++) {
    const my = w.self.c.y + oy + ay[i]!;
    const mx = w.self.c.x + ox + axArr[i]!;
    if (!w.map.inBounds(mx, my)) continue;
    const feat = w.map.at(mx, my).feat;
    if (arr[i] === 0 && isWallCell(feat)) count++;
    if (arr[i] === 1 && isWallOrFloorCell(feat)) count++;
  }
  return count;
}

/**
 * borg_flow_kill_corridor (borg-flow-kill.c): dig a type-I anti-summon corridor
 * to break a mobile summoner's line of sight. The four 5x5 patterns and the
 * best-hide-spot selection are ported verbatim.
 */
export function borgFlowKillCorridor(ctx: BorgContext, flow: FlowState): AgentCommand | null {
  const w = ctx.world;

  flow.borgDigging = false;

  if (!w.kills.count || w.kills.count <= 1) return null;
  const summoner = w.kills.summoner;
  if (summoner <= 0 || !w.kills.has(summoner)) return null;
  if (trait(w, BI.ISHUNGRY) || trait(w, BI.ISWEAK)) return null;
  if (w.self.timeThisPanel > 500) return null;
  if (trait(w, BI.ISCONFUSED)) return null;
  if (trait(w, BI.LIGHT) === 0) return null;
  if (flow.borgMorgothPosition) return null;
  if (flow.borgAsPosition) return null;

  const kill = w.kills.at(summoner);

  /* Summoner must be mobile, non-wall-passing, and awake */
  if (flow.hooks.monsterHasFlag(w, summoner, "NEVER_MOVE")) return null;
  if (flow.hooks.monsterHasFlag(w, summoner, "PASS_WALL")) return null;
  if (flow.hooks.monsterHasFlag(w, summoner, "KILL_WALL")) return null;
  if (!kill.awake) return null;

  /* Must be able to dig via magic (stone-to-mud / ring / activation) */
  if (!flow.hooks.canDigMagic(w, true)) return null;

  /*
   * When the summoner is out of LOS, upstream pre-digs toward it using panel
   * detect-wall data that the port lacks; with the default los()==true this
   * branch is skipped and the pattern search proceeds.
   */
  if (!flow.hooks.los(w, kill.pos.y, kill.pos.x, w.self.c.y, w.self.c.x)) {
    borgFlowClear(flow);
    flow.borgDigging = true;
    borgFlowEnqueueGrid(ctx, flow, kill.pos.y, kill.pos.x);
    borgFlowSpread(ctx, flow, 10, true, true, false, -1, false);
    if (!borgFlowCommit(ctx, flow, GOAL_KILL)) return null;
  }

  let bY = 0;
  let bX = 0;
  let bDistance = 99;
  let bN = false;
  let bS = false;
  let bE = false;
  let bW = false;

  /* NORTH */
  for (let oy = -2; oy < 1; oy++) {
    const ox = 0;
    if (scorePattern(ctx, oy, ox, N_ARRAY, NY, NX) === 25) {
      const dd = distance(
        w.self.c.x,
        w.self.c.y,
        w.self.c.x + ox + NX[7]!,
        w.self.c.y + oy + NY[7]!,
      );
      if (dd < bDistance) {
        bY = oy;
        bX = ox;
        bN = true;
        bDistance = dd;
      }
    }
  }

  /* SOUTH */
  for (let oy = -1; oy < 2; oy++) {
    const ox = 0;
    if (scorePattern(ctx, oy, ox, S_ARRAY, SY, SX) === 25) {
      const dd = distance(
        w.self.c.x,
        w.self.c.y,
        w.self.c.x + ox + SX[17]!,
        w.self.c.y + oy + SY[17]!,
      );
      if (dd < bDistance) {
        bY = oy;
        bX = ox;
        bS = true;
        bN = false;
        bDistance = dd;
      }
    }
  }

  /* EAST */
  for (let ox = -1; ox < 2; ox++) {
    const oy = 0;
    if (scorePattern(ctx, oy, ox, E_ARRAY, EY, EX) === 25) {
      const dd = distance(
        w.self.c.x,
        w.self.c.y,
        w.self.c.x + ox + EX[13]!,
        w.self.c.y + oy + EY[13]!,
      );
      if (dd < bDistance) {
        bY = oy;
        bX = ox;
        bE = true;
        bS = false;
        bN = false;
        bDistance = dd;
      }
    }
  }

  /* WEST */
  for (let ox = -2; ox < 1; ox++) {
    const oy = 0;
    if (scorePattern(ctx, oy, ox, W_ARRAY, WY, WX) === 25) {
      const dd = distance(
        w.self.c.x,
        w.self.c.y,
        w.self.c.x + ox + WX[11]!,
        w.self.c.y + oy + WY[11]!,
      );
      if (dd < bDistance) {
        bY = oy;
        bX = ox;
        bW = true;
        bE = false;
        bS = false;
        bN = false;
        bDistance = dd;
      }
    }
  }

  const dig = (ey: number, ex: number, depth: number): AgentCommand | null => {
    borgFlowClear(flow);
    flow.borgDigging = true;
    borgFlowEnqueueGrid(ctx, flow, w.self.c.y + bY + ey, w.self.c.x + bX + ex);
    borgFlowSpread(ctx, flow, depth, true, false, true, -1, false);
    if (!borgFlowCommit(ctx, flow, GOAL_DIGGING)) return null;
    return borgFlowOld(ctx, flow, GOAL_DIGGING);
  };

  if (bN) return dig(NY[7]!, NX[7]!, 5);
  if (bS) return dig(SY[17]!, SX[17]!, 6);
  if (bE) return dig(EY[13]!, EX[13]!, 5);
  if (bW) return dig(WY[11]!, WX[11]!, 5);

  return null;
}

/**
 * borg_flow_kill_direct (borg-flow-kill.c): dig a straight tunnel to the closest
 * monster (or the map centre) when stuck / twitchy.
 */
export function borgFlowKillDirect(ctx: BorgContext, flow: FlowState, twitchy: boolean): AgentCommand | null {
  const w = ctx.world;

  if (!borgCanDig(ctx, flow, false, FEAT.GRANITE)) return null;

  if (
    !twitchy &&
    (trait(w, BI.ISHUNGRY) || trait(w, BI.ISWEAK) || trait(w, BI.FOOD) === 0)
  )
    return null;

  if (!twitchy && w.clock - flow.borgBegan < 3000 && w.self.timesTwitch < 5)
    return null;

  if (trait(w, BI.ISCONFUSED)) return null;
  if (trait(w, BI.LIGHT) === 0) return null;

  let bI = -1;
  let bD = 20; /* z_info->max_sight */

  if (w.kills.count > 1) {
    for (const [ki, kill] of w.kills.entries()) {
      const d = distance(kill.pos.x, kill.pos.y, w.self.c.x, w.self.c.y);
      if (d > bD) continue;
      bI = ki;
      bD = d;
    }
  }

  if (bI === -1) {
    borgFlowClear(flow);
    borgFlowEnqueueGrid(ctx, flow, Math.trunc(AUTO_MAX_Y / 2), Math.trunc(AUTO_MAX_X / 2));
    borgFlowSpread(ctx, flow, 150, true, false, true, -1, false);
    if (!borgFlowCommit(ctx, flow, GOAL_DIGGING)) return null;
    return borgFlowOld(ctx, flow, GOAL_DIGGING);
  }

  const kill = w.kills.at(bI);
  borgFlowClear(flow);
  borgFlowEnqueueGrid(ctx, flow, kill.pos.y, kill.pos.x);
  borgFlowSpread(ctx, flow, 15, true, false, true, -1, false);
  if (!borgFlowCommit(ctx, flow, GOAL_DIGGING)) return null;
  return borgFlowOld(ctx, flow, GOAL_DIGGING);
}
