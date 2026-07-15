/**
 * Flow toward "interesting" (dark/unexplored) grids: a faithful port of
 * reference/src/borg/borg-flow-dark.c (borg_flow_dark and its five methods,
 * borg_flow_dark_interesting/reachable, borg_flow_direct, borg_flow_border).
 *
 * ADAPTATION. Method 1 scans the C borg_light[] torch-lit list, which perceive
 * (P8.6) does not populate yet, so collectLightGrids reads grids flagged
 * BORG_LIGHT (currently none) and method 1 no-ops until then; methods 2-5 scan
 * the remembered map directly and are fully functional. Danger uses
 * FlowHooks.danger via computeFear.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { distance } from "../think";
import { GOAL_DARK } from "../world/model";
import { BORG_LIGHT, BORG_VIEW } from "../world/grid";
import {
  AUTO_MAX_X,
  AUTO_MAX_Y,
  BI,
  FEAT,
  borgCaveFloorGrid,
  ddx_ddd,
  ddy_ddd,
  featIsTrapHolding,
  trait,
} from "./flow-consts";
import {
  borgCanDig,
  borgFlowClear,
  borgFlowCommit,
  borgFlowEnqueueGrid,
  borgFlowOld,
  borgFlowSpread,
  computeFear,
  dataIdx,
  type FlowState,
} from "./flow";
import {
  borgFlowFarFromStairs,
  borgFlowFarFromStairsDist,
  borgGetLeash,
} from "./flow-misc";
import { syncStairsFromMap } from "./flow-stairs";

/**
 * borg_flow_dark_interesting (borg-flow-dark.c): is (x, y) worth exploring --
 * unknown, known treasure, GCV wall, rubble, closed door, or visible trap.
 */
export function borgFlowDarkInteresting(ctx: BorgContext, flow: FlowState, y: number, x: number): boolean {
  const w = ctx.world;
  const ag = w.map.at(x, y);

  /* Explore unknown grids */
  if (ag.feat === FEAT.NONE) return true;

  /* Ignore boring grids */
  if (ag.feat < FEAT.SECRET && ag.feat !== FEAT.CLOSED) return false;

  /* Known treasure */
  if (ag.feat === FEAT.MAGMA_K || ag.feat === FEAT.QUARTZ_K) {
    if (trait(w, BI.ISCONFUSED)) return false;
    if (trait(w, BI.GOLD) >= 100000) return false;
    if (trait(w, BI.LIGHT) === 0) return false;
    if (!borgCanDig(ctx, flow, false, ag.feat)) return false;
    return true;
  }

  /* Vaults: non-perma wall adjacent to a perma wall */
  if (ag.feat === FEAT.GRANITE || ag.feat === FEAT.MAGMA || ag.feat === FEAT.QUARTZ) {
    if (trait(w, BI.ISCONFUSED)) return false;
    if (!w.facts.vaultOnLevel) return false;
    if (!borgCanDig(ctx, flow, false, ag.feat)) return false;
    if (x < AUTO_MAX_X - 1 && y < AUTO_MAX_Y - 1 && x > 1 && y > 1) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          if (w.map.at(x + ox, y + oy).feat === FEAT.PERM) return true;
        }
      }
    }
  }

  /* Rubble */
  if (ag.feat === FEAT.RUBBLE && !trait(w, BI.ISWEAK)) return true;

  /* Closed doors */
  if (ag.feat === FEAT.CLOSED) {
    if (w.facts.breederLevel) {
      for (let i = 0; i < flow.door.num; i++) {
        if (flow.door.x[i] === x && flow.door.y[i] === y) return false;
      }
    }
    return true;
  }

  /* Visible traps (see flow-consts: featIsTrapHolding is FLOOR-only, so this
   * branch is unreachable for the wall feats that reach here -- faithful). */
  if (featIsTrapHolding(ag.feat)) {
    if (trait(w, BI.ISBLIND)) return false;
    if (trait(w, BI.ISCONFUSED)) return false;
    if (trait(w, BI.ISIMAGE)) return false;
    if (trait(w, BI.LIGHT) === 0) return false;
    if (trait(w, BI.CDEPTH) === 99 && ag.trap && !ag.glyph) return false;
    if (trait(w, BI.CURHP) < 60) return false;
    if (trait(w, BI.DISP) < 30 && trait(w, BI.CLEVEL) < 20) return false;
    if (trait(w, BI.DISP) < 45 && trait(w, BI.CLEVEL) < 10) return false;
    if (trait(w, BI.DISM) < 30 && trait(w, BI.CLEVEL) < 20) return false;
    if (trait(w, BI.DISM) < 45 && trait(w, BI.CLEVEL) < 10) return false;
    if (w.facts.scaryGuyOnLevel) return false;
    return true;
  }

  return false;
}

/** borg_flow_dark_reachable (borg-flow-dark.c): adjacent to a known floor grid. */
export function borgFlowDarkReachable(ctx: BorgContext, y: number, x: number): boolean {
  const w = ctx.world;
  for (let j = 0; j < 8; j++) {
    const y2 = y + ddy_ddd[j]!;
    const x2 = x + ddx_ddd[j]!;
    if (!w.map.inBounds(x2, y2)) continue;
    const ag = w.map.at(x2, y2);
    if (ag.feat === FEAT.NONE) continue;
    if (borgCaveFloorGrid(ag)) return true;
  }
  return false;
}

/**
 * borg_flow_direct (borg-flow-dark.c): lay a single "direct path" into cost[]
 * from the player toward (x, y), aborting on walls/danger/icky. Ported verbatim
 * including the Bresenham-style shift stepping and the town 1/10 fear divisor.
 */
export function borgFlowDirect(ctx: BorgContext, flow: FlowState, y: number, x: number): void {
  const w = ctx.world;
  let n = 0;

  if (flow.icky[dataIdx(x, y)]) return;

  if (!flow.know[dataIdx(x, y)]) {
    flow.know[dataIdx(x, y)] = 1;
    const p = flow.hooks.danger(w, y, x);
    const fear = computeFear(w, flow, 1);
    if (p > fear) {
      flow.icky[dataIdx(x, y)] = 1;
      return;
    }
  }

  flow.cost[dataIdx(x, y)] = 0;

  const y1 = y;
  const x1 = x;
  const y2 = w.self.c.y;
  const x2 = w.self.c.x;

  const ay = y2 < y1 ? y1 - y2 : y2 - y1;
  const ax = x2 < x1 ? x1 - x2 : x2 - x1;

  let cx = x;
  let cy = y;

  for (;;) {
    if (cx === x2 && cy === y2) return;

    n++;

    if (ay > ax) {
      const shift = Math.trunc((n * ax + Math.trunc((ay - 1) / 2)) / ay);
      cx = x2 < x1 ? x1 - shift : x1 + shift;
      cy = y2 < y1 ? y1 - n : y1 + n;
    } else {
      const shift = Math.trunc((n * ay + Math.trunc((ax - 1) / 2)) / ax);
      cy = y2 < y1 ? y1 - shift : y1 + shift;
      cx = x2 < x1 ? x1 - n : x1 + n;
    }

    if (!(cx >= 0 && cy >= 0 && cx < AUTO_MAX_X && cy < AUTO_MAX_Y)) return;

    const ag = w.map.at(cx, cy);

    if (!borgCaveFloorGrid(ag) || (ag.feat === FEAT.LAVA && !trait(w, BI.IFIRE))) return;

    /* Avoid traps if low level -- unless brave or scaryguy */
    if (ag.trap && flow.avoidance <= trait(w, BI.CURHP) && !w.facts.scaryGuyOnLevel) {
      if (trait(w, BI.CURHP) < 60) return;
      if (trait(w, BI.DISP) < 30 && trait(w, BI.CLEVEL) < 20) return;
      if (trait(w, BI.DISP) < 45 && trait(w, BI.CLEVEL) < 10) return;
      if (trait(w, BI.DISM) < 30 && trait(w, BI.CLEVEL) < 20) return;
      if (trait(w, BI.DISM) < 45 && trait(w, BI.CLEVEL) < 10) return;
    }

    if (flow.icky[dataIdx(cx, cy)]) return;

    if (!flow.know[dataIdx(cx, cy)]) {
      flow.know[dataIdx(cx, cy)] = 1;
      const p = flow.hooks.danger(w, cy, cx);
      const fear = computeFear(w, flow, 1);
      if (p > fear) {
        flow.icky[dataIdx(cx, cy)] = 1;
        return;
      }
    }

    if (flow.cost[dataIdx(cx, cy)]! <= n) break;
    flow.cost[dataIdx(cx, cy)] = n;
  }
}

/** borg_flow_border (borg-flow-dark.c): mark/clear a rectangle's edges. */
function borgFlowBorder(flow: FlowState, y1: number, x1: number, y2: number, x2: number, stop: boolean): void {
  const v = stop ? 1 : 0;
  for (let y = y1; y <= y2; y++) {
    flow.know[dataIdx(x1, y)] = v;
    flow.icky[dataIdx(x1, y)] = v;
    flow.know[dataIdx(x2, y)] = v;
    flow.icky[dataIdx(x2, y)] = v;
  }
  for (let x = x1; x <= x2; x++) {
    flow.know[dataIdx(x, y1)] = v;
    flow.icky[dataIdx(x, y1)] = v;
    flow.know[dataIdx(x, y2)] = v;
    flow.icky[dataIdx(x, y2)] = v;
  }
}

/** Collect torch-lit grids (BORG_LIGHT). Empty until perceive sets the flag. */
function collectLightGrids(ctx: BorgContext): Array<[number, number]> {
  const w = ctx.world;
  const out: Array<[number, number]> = [];
  for (let y = 0; y < AUTO_MAX_Y; y++) {
    for (let x = 0; x < AUTO_MAX_X; x++) {
      if (w.map.at(x, y).info & BORG_LIGHT) out.push([x, y]);
    }
  }
  return out;
}

/** borg_flow_dark_1: interesting torch-lit grids (direct paths). */
function borgFlowDark1(ctx: BorgContext, flow: FlowState, bStair: number): AgentCommand | null {
  const w = ctx.world;
  if (!trait(w, BI.CDEPTH)) return null;

  flow.tempN = 0;
  for (const [x, y] of collectLightGrids(ctx)) {
    if (!borgFlowDarkInteresting(ctx, flow, y, x)) continue;
    if (borgFlowFarFromStairs(ctx, flow, x, y, bStair)) continue;
    flow.tempX[flow.tempN] = x;
    flow.tempY[flow.tempN] = y;
    flow.tempN++;
  }
  if (!flow.tempN) return null;

  if (w.self.goal.ignoring || w.facts.scaryGuyOnLevel) flow.borgDangerWipe = true;
  borgFlowClear(flow);
  for (let i = 0; i < flow.tempN; i++) borgFlowDirect(ctx, flow, flow.tempY[i]!, flow.tempX[i]!);

  if (!borgFlowCommit(ctx, flow, GOAL_DARK)) return null;
  return borgFlowOld(ctx, flow, GOAL_DARK);
}

/** borg_flow_dark_2: unknown viewable grids just outside the torch (direct). */
function borgFlowDark2(ctx: BorgContext, flow: FlowState, bStair: number): AgentCommand | null {
  const w = ctx.world;
  if (!trait(w, BI.CDEPTH)) return null;

  const r = trait(w, BI.LIGHT) + 1;
  flow.tempN = 0;

  for (let i = 0; i < 4; i++) {
    const y = w.self.c.y + ddy_ddd[i]! * r;
    const x = w.self.c.x + ddx_ddd[i]! * r;
    if (y < 1 || x < 1 || y > AUTO_MAX_Y - 2 || x > AUTO_MAX_X - 2) continue;
    const ag = w.map.at(x, y);
    if (ag.feat !== FEAT.NONE) continue;
    if (!(ag.info & BORG_VIEW)) continue;
    if (borgFlowFarFromStairs(ctx, flow, x, y, bStair)) continue;
    flow.tempX[flow.tempN] = x;
    flow.tempY[flow.tempN] = y;
    flow.tempN++;
  }
  if (!flow.tempN) return null;

  if (w.self.goal.ignoring || w.facts.scaryGuyOnLevel) flow.borgDangerWipe = true;
  borgFlowClear(flow);
  for (let i = 0; i < flow.tempN; i++) borgFlowDirect(ctx, flow, flow.tempY[i]!, flow.tempX[i]!);

  if (!borgFlowCommit(ctx, flow, GOAL_DARK)) return null;
  return borgFlowOld(ctx, flow, GOAL_DARK);
}

/** borg_flow_dark_3: interesting reachable grids within 4 (depth-5 spread). */
function borgFlowDark3(ctx: BorgContext, flow: FlowState, bStair: number): AgentCommand | null {
  const w = ctx.world;
  if (!trait(w, BI.CDEPTH)) return null;

  let y1 = w.self.c.y - 4;
  let x1 = w.self.c.x - 4;
  let y2 = w.self.c.y + 4;
  let x2 = w.self.c.x + 4;
  if (y1 < 1) y1 = 1;
  if (x1 < 1) x1 = 1;
  if (y2 > AUTO_MAX_Y - 2) y2 = AUTO_MAX_Y - 2;
  if (x2 > AUTO_MAX_X - 2) x2 = AUTO_MAX_X - 2;

  flow.tempN = 0;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (!borgFlowDarkInteresting(ctx, flow, y, x)) continue;
      if (!borgFlowDarkReachable(ctx, y, x)) continue;
      if (borgFlowFarFromStairs(ctx, flow, x, y, bStair)) continue;
      flow.tempX[flow.tempN] = x;
      flow.tempY[flow.tempN] = y;
      flow.tempN++;
    }
  }
  if (!flow.tempN) return null;

  if (w.self.goal.ignoring || w.facts.scaryGuyOnLevel) flow.borgDangerWipe = true;
  borgFlowClear(flow);
  for (let i = 0; i < flow.tempN; i++) borgFlowEnqueueGrid(ctx, flow, flow.tempY[i]!, flow.tempX[i]!);
  borgFlowSpread(ctx, flow, 5, false, true, false, -1, false);

  if (!borgFlowCommit(ctx, flow, GOAL_DARK)) return null;
  return borgFlowOld(ctx, flow, GOAL_DARK);
}

/** borg_flow_dark_4: interesting reachable grids within 11 (bordered spread). */
function borgFlowDark4(ctx: BorgContext, flow: FlowState, bStair: number): AgentCommand | null {
  const w = ctx.world;
  const leash = borgGetLeash(ctx, flow, false);
  if (!trait(w, BI.CDEPTH)) return null;
  if (w.facts.vaultOnLevel) return null;

  let y1 = w.self.c.y - 11;
  let x1 = w.self.c.x - 11;
  let y2 = w.self.c.y + 11;
  let x2 = w.self.c.x + 11;
  if (y1 < 1) y1 = 1;
  if (x1 < 1) x1 = 1;
  if (y2 > AUTO_MAX_Y - 2) y2 = AUTO_MAX_Y - 2;
  if (x2 > AUTO_MAX_X - 2) x2 = AUTO_MAX_X - 2;

  flow.tempN = 0;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (!borgFlowDarkInteresting(ctx, flow, y, x)) continue;
      if (!borgFlowDarkReachable(ctx, y, x)) continue;
      if (borgFlowFarFromStairsDist(ctx, flow, x, y, bStair, leash)) continue;
      flow.tempX[flow.tempN] = x;
      flow.tempY[flow.tempN] = y;
      flow.tempN++;
    }
  }
  if (!flow.tempN) return null;

  if (w.self.goal.ignoring || w.facts.scaryGuyOnLevel) flow.borgDangerWipe = true;
  borgFlowClear(flow);
  for (let i = 0; i < flow.tempN; i++) borgFlowEnqueueGrid(ctx, flow, flow.tempY[i]!, flow.tempX[i]!);

  /* Expand + mark the border to keep paths on-panel */
  y1--; x1--; y2++; x2++;
  borgFlowBorder(flow, y1, x1, y2, x2, true);

  if (trait(w, BI.CLEVEL) < 15) {
    borgFlowSpread(ctx, flow, leash, true, true, false, -1, false);
  } else {
    borgFlowSpread(ctx, flow, 250, true, true, false, -1, false);
  }

  borgFlowBorder(flow, y1, x1, y2, x2, false);

  if (!borgFlowCommit(ctx, flow, GOAL_DARK)) return null;
  return borgFlowOld(ctx, flow, GOAL_DARK);
}

/** borg_flow_dark_5: interesting reachable grids anywhere (leash spread). */
function borgFlowDark5(ctx: BorgContext, flow: FlowState, bStair: number): AgentCommand | null {
  const w = ctx.world;
  const leash = borgGetLeash(ctx, flow, false);
  if (!trait(w, BI.CDEPTH)) return null;

  flow.tempN = 0;
  for (let y = 1; y < AUTO_MAX_Y - 1; y++) {
    for (let x = 1; x < AUTO_MAX_X - 1; x++) {
      if (!borgFlowDarkInteresting(ctx, flow, y, x)) continue;
      if (!borgFlowDarkReachable(ctx, y, x)) continue;
      if (borgFlowFarFromStairsDist(ctx, flow, x, y, bStair, leash)) continue;
      flow.tempX[flow.tempN] = x;
      flow.tempY[flow.tempN] = y;
      flow.tempN++;
      if (flow.tempN === 9000) {
        y = AUTO_MAX_Y;
        x = AUTO_MAX_X;
        break;
      }
    }
  }
  if (!flow.tempN) return null;

  if (w.self.goal.ignoring || w.facts.scaryGuyOnLevel) flow.borgDangerWipe = true;
  borgFlowClear(flow);
  for (let i = 0; i < flow.tempN; i++) borgFlowEnqueueGrid(ctx, flow, flow.tempY[i]!, flow.tempX[i]!);

  if (trait(w, BI.CLEVEL) <= 5 && flow.avoidance <= trait(w, BI.CURHP)) {
    borgFlowSpread(ctx, flow, leash, true, true, false, -1, false);
  } else if (trait(w, BI.CLEVEL) <= 30 && flow.avoidance <= trait(w, BI.CURHP)) {
    borgFlowSpread(ctx, flow, leash, true, true, false, -1, false);
  } else {
    borgFlowSpread(ctx, flow, 250, true, true, false, -1, false);
  }

  if (!borgFlowCommit(ctx, flow, GOAL_DARK)) return null;
  return borgFlowOld(ctx, flow, GOAL_DARK);
}

/**
 * borg_flow_dark (borg-flow-dark.c): explore. neer picks the near methods
 * (1-3), else the far methods (4-5), in order. Returns the step or null.
 */
export function borgFlowDark(ctx: BorgContext, flow: FlowState, neer: boolean): AgentCommand | null {
  const w = ctx.world;

  if (flow.borgMorgothPosition && w.facts.morgothOnLevel) return null;

  /* Already standing on an interesting grid -- nothing to do */
  if (borgFlowDarkInteresting(ctx, flow, w.self.c.y, w.self.c.x)) return null;

  syncStairsFromMap(ctx, flow);
  let bStair = -1;
  let bJ = -1;
  for (let i = 0; i < flow.less.num; i++) {
    const j = distance(w.self.c.x, w.self.c.y, flow.less.x[i]!, flow.less.y[i]!);
    if (bJ >= j) continue;
    bJ = j;
    bStair = i;
  }

  if (neer) {
    return borgFlowDark1(ctx, flow, bStair) ?? borgFlowDark2(ctx, flow, bStair) ?? borgFlowDark3(ctx, flow, bStair);
  }
  return borgFlowDark4(ctx, flow, bStair) ?? borgFlowDark5(ctx, flow, bStair);
}
