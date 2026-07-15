/**
 * Flow toward objects to take: a faithful port of the navigation core of
 * reference/src/borg/borg-flow-take.c (borg_flow_take and borg_flow_take_scum).
 *
 * ADAPTATIONS
 * - The upstream "value" of a take (from kind->cost) is not modelled yet (P8.5);
 *   the port uses BorgTake.wanted as the "value > 0" predicate ("skip worthless
 *   items"), which is exactly what that field means.
 * - "Require one empty pack slot" (borg_items[PACK_SLOTS-1].iqty) needs the
 *   inventory model (P8.5), so it is delegated to FlowHooks.packFull.
 * - The gold-scumming book/ammo-kind cheats need k_info; they are gated by the
 *   same GOLD >= 500000 guard as upstream (default gold 0 -> inactive) and left
 *   out. The lunal-mode take variant (heavily inventory/quiver dependent) is a
 *   P8.5 follow-up and is not ported here.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { distance } from "../think";
import { GOAL_TAKE } from "../world/model";
import { BORG_VIEW } from "../world/grid";
import { BI, trait } from "./flow-consts";
import {
  borgFlowClear,
  borgFlowCommit,
  borgFlowEnqueueGrid,
  borgFlowOld,
  borgFlowSpread,
  type FlowState,
} from "./flow";
import {
  borgFlowFarFromStairs,
  borgGetLeash,
  nearestUpStair,
} from "./flow-misc";
import { borgFlowCostStair, syncStairsFromMap } from "./flow-stairs";

/** z_info->quiver_slot_size default; used for the ammo-capacity skip. */
const QUIVER_SLOT_SIZE = 40;

/**
 * borg_flow_take (borg-flow-take.c): flow toward wanted floor objects. nearness
 * bounds the spread depth; viewable requires line of sight to the object.
 */
export function borgFlowTake(
  ctx: BorgContext,
  flow: FlowState,
  viewable: boolean,
  nearness: number,
): AgentCommand | null {
  const w = ctx.world;

  const fullQuiver = trait(w, BI.FAST_SHOTS)
    ? (QUIVER_SLOT_SIZE - 1) * 2
    : QUIVER_SLOT_SIZE - 1;

  if (!w.takes.count || w.takes.count <= 1) return null;
  if (flow.hooks.packFull(w)) return null;
  if (w.facts.scaryGuyOnLevel) return null;
  if (!trait(w, BI.LIGHT)) return null;
  if (flow.borgMorgothPosition) return null;

  flow.tempN = 0;
  syncStairsFromMap(ctx, flow);

  const bStair = nearestUpStair(ctx, flow);
  const bJ =
    bStair === -1
      ? -1
      : distance(w.self.c.x, w.self.c.y, flow.less.x[bStair]!, flow.less.y[bStair]!);
  const leash = borgGetLeash(ctx, flow, true);

  for (const [, take] of w.takes.entries()) {
    const x = take.pos.x;
    const y = take.pos.y;

    /* Skip ones that make me wander too far when low level */
    if (bStair !== -1 && trait(w, BI.CLEVEL) < 10) {
      const j = distance(flow.less.x[bStair]!, flow.less.y[bStair]!, x, y);
      if (j !== 255 && bJ <= leash && j >= leash) continue;
    }

    /* skip worthless items (value <= 0 -> !wanted) */
    if (!take.wanted) continue;

    const ag = w.map.at(x, y);
    if (viewable && !(ag.info & BORG_VIEW)) continue;

    /* Don't over-collect ammo */
    if (take.tval === trait(w, BI.AMMO_TVAL) && trait(w, BI.AMISSILES) >= fullQuiver)
      continue;

    borgFlowClear(flow);

    /* Distance-to-stair leash for far items when low level */
    if (
      nearness > 5 &&
      trait(w, BI.CLEVEL) < 20 &&
      borgFlowCostStair(ctx, flow, y, x, bStair) > leash
    )
      continue;

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

  if (!borgFlowCommit(ctx, flow, GOAL_TAKE)) return null;
  return borgFlowOld(ctx, flow, GOAL_TAKE);
}

/**
 * borg_flow_take_scum (borg-flow-take.c): a sneaky, stair-leashed variant used
 * while scumming a level for valuables.
 */
export function borgFlowTakeScum(
  ctx: BorgContext,
  flow: FlowState,
  viewable: boolean,
  nearness: number,
): AgentCommand | null {
  const w = ctx.world;

  if (!w.takes.count || w.takes.count <= 1) return null;
  if (flow.hooks.packFull(w)) return null;

  flow.tempN = 0;
  syncStairsFromMap(ctx, flow);
  const bStair = nearestUpStair(ctx, flow);

  for (const [, take] of w.takes.entries()) {
    const x = take.pos.x;
    const y = take.pos.y;
    const ag = w.map.at(x, y);

    if (!take.wanted) continue;
    if (viewable && !(ag.info & BORG_VIEW)) continue;
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
  borgFlowSpread(ctx, flow, nearness, true, !viewable, false, -1, true);

  if (!borgFlowCommit(ctx, flow, GOAL_TAKE)) return null;
  return borgFlowOld(ctx, flow, GOAL_TAKE);
}
