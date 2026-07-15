/**
 * Flow toward stairs: a faithful port of reference/src/borg/borg-flow-stairs.c
 * (borg_flow_cost_stair, borg_flow_stair_less/more/both).
 *
 * ADAPTATION. Upstream, borg_update fills track_less / track_more as the borg
 * sees stairs. Perception (perceive.ts) does not track stairs yet (P8.6), so
 * syncStairsFromMap rebuilds the two tracks from the borg's own remembered map
 * (FEAT_LESS / FEAT_MORE grids) before each stair flow. This is the same data
 * the C borg would hold; only the moment of collection differs.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { distance } from "../think";
import { AUTO_MAX_X, AUTO_MAX_Y, BI, FEAT, trait } from "./flow-consts";
import {
  borgFlowClear,
  borgFlowCommit,
  borgFlowEnqueueGrid,
  borgFlowOld,
  borgFlowSpread,
  dataIdx,
  type FlowState,
} from "./flow";

/**
 * Rebuild track_less / track_more from the remembered map. Faithful to the set
 * of stairs the borg has seen (grids marked with FEAT_LESS / FEAT_MORE).
 */
export function syncStairsFromMap(ctx: BorgContext, flow: FlowState): void {
  const w = ctx.world;
  flow.less.wipe();
  flow.more.wipe();
  for (let y = 0; y < AUTO_MAX_Y; y++) {
    for (let x = 0; x < AUTO_MAX_X; x++) {
      const feat = w.map.at(x, y).feat;
      if (feat === FEAT.LESS) flow.less.add(y, x);
      else if (feat === FEAT.MORE) flow.more.add(y, x);
    }
  }
}

/**
 * borg_flow_cost_stair: number of steps from (x, y) to the given up-stair; 0 if
 * unreachable ("go off leash"). Runs its own non-optimized spread from the stair.
 */
export function borgFlowCostStair(
  ctx: BorgContext,
  flow: FlowState,
  y: number,
  x: number,
  bStair: number,
): number {
  borgFlowClear(flow);

  if (bStair === -1) return 0;

  borgFlowEnqueueGrid(ctx, flow, flow.less.y[bStair]!, flow.less.x[bStair]!);
  borgFlowSpread(ctx, flow, 250, false, false, false, bStair, false);

  const cost = flow.cost[dataIdx(x, y)]!;
  if (cost === 255) return 0;
  return cost;
}

/**
 * borg_flow_stair_both: flee the level via the nearest usable stair (up or down).
 */
export function borgFlowStairBoth(
  ctx: BorgContext,
  flow: FlowState,
  why: number,
  sneak: boolean,
): AgentCommand | null {
  const w = ctx.world;
  syncStairsFromMap(ctx, flow);

  if (!flow.less.num && !flow.more.num) return null;

  /* Don't go down hungry/low-food unless fleeing a scary town */
  if (
    !w.self.goal.fleeing &&
    !w.facts.scaryGuyOnLevel &&
    !flow.less.num &&
    flow.avoidance <= Math.trunc((trait(w, BI.CURHP) * 15) / 10) &&
    (trait(w, BI.ISWEAK) || trait(w, BI.ISHUNGRY) || trait(w, BI.FOOD) < 2)
  )
    return null;

  /* No diving without light */
  if (
    trait(w, BI.LIGHT) === 0 &&
    trait(w, BI.CDEPTH) !== 0 &&
    w.self.munchkinMode === false
  )
    return null;

  borgFlowClear(flow);

  for (let i = 0; i < flow.less.num; i++) {
    if (w.map.at(flow.less.x[i]!, flow.less.y[i]!).kill) continue;
    borgFlowEnqueueGrid(ctx, flow, flow.less.y[i]!, flow.less.x[i]!);
  }
  for (let i = 0; i < flow.more.num; i++) {
    if (w.map.at(flow.more.x[i]!, flow.more.y[i]!).kill) continue;
    borgFlowEnqueueGrid(ctx, flow, flow.more.y[i]!, flow.more.x[i]!);
  }

  borgFlowSpread(ctx, flow, 250, false, false, false, -1, sneak);

  if (!borgFlowCommit(ctx, flow, why)) return null;
  return borgFlowOld(ctx, flow, why);
}

/**
 * borg_flow_stair_less: flow toward up-stairs.
 */
export function borgFlowStairLess(
  ctx: BorgContext,
  flow: FlowState,
  why: number,
  sneak: boolean,
): AgentCommand | null {
  const w = ctx.world;

  /* forced to go up (down) */
  if (flow.hooks.forceDescend) return null;

  syncStairsFromMap(ctx, flow);
  if (!flow.less.num) return null;

  borgFlowClear(flow);

  for (let i = 0; i < flow.less.num; i++) {
    if (w.map.at(flow.less.x[i]!, flow.less.y[i]!).kill) continue;
    borgFlowEnqueueGrid(ctx, flow, flow.less.y[i]!, flow.less.x[i]!);
  }

  if (trait(w, BI.CLEVEL) > 35 || trait(w, BI.LIGHT) === 0) {
    borgFlowSpread(ctx, flow, 250, true, false, false, -1, sneak);
  } else {
    borgFlowSpread(ctx, flow, 250, false, !flow.borgDesperate, false, -1, sneak);
  }

  if (!borgFlowCommit(ctx, flow, why)) return null;
  return borgFlowOld(ctx, flow, why);
}

/**
 * borg_flow_stair_more: flow toward down-stairs.
 */
export function borgFlowStairMore(
  ctx: BorgContext,
  flow: FlowState,
  why: number,
  sneak: boolean,
  brave: boolean,
): AgentCommand | null {
  const w = ctx.world;
  syncStairsFromMap(ctx, flow);

  if (!flow.more.num) return null;

  /* If up-stairs exist, filter use of them */
  if (flow.less.num) {
    if (
      !w.self.lunalMode &&
      !w.self.munchkinMode &&
      !brave &&
      !flow.hooks.preparedToDescend(w)
    )
      return null;

    if (
      !brave &&
      trait(w, BI.CDEPTH) &&
      !w.facts.scaryGuyOnLevel &&
      (trait(w, BI.ISWEAK) || trait(w, BI.ISHUNGRY) || trait(w, BI.FOOD) < 2)
    )
      return null;

    if (
      trait(w, BI.CDEPTH) &&
      trait(w, BI.CLEVEL) < 25 &&
      trait(w, BI.GOLD) < 25000 &&
      flow.hooks.countSell(w) >= 13 &&
      !w.self.munchkinMode
    )
      return null;

    if (trait(w, BI.LIGHT) === 0 && w.self.munchkinMode === false) return null;
  }

  /* Don't head for stairs while recalling */
  if (w.self.goal.recalling) return null;

  borgFlowClear(flow);

  for (let i = 0; i < flow.more.num; i++) {
    if (w.map.at(flow.more.x[i]!, flow.more.y[i]!).kill) continue;
    borgFlowEnqueueGrid(ctx, flow, flow.more.y[i]!, flow.more.x[i]!);
  }

  borgFlowSpread(ctx, flow, 250, true, false, false, -1, sneak);

  if (!borgFlowCommit(ctx, flow, why)) return null;
  return borgFlowOld(ctx, flow, why);
}
