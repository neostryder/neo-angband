/**
 * Flow to / lay glyphs of warding: a faithful port of
 * reference/src/borg/borg-flow-glyph.c (borg_flow_glyph, the "sea of runes" the
 * borg builds around itself before facing Morgoth).
 *
 * ADAPTATION. Laying the glyph itself is an action (spell / rune scroll /
 * activation) from subsystems not yet ported, so on arrival the port calls
 * FlowHooks.layGlyph(ctx); if it returns null (no means to lay one) the flow
 * yields, exactly as upstream's cast/read/activate chain failing. The room
 * search, scoring, and flow are ported verbatim.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { distance } from "../think";
import { GOAL_MISC } from "../world/model";
import { AUTO_MAX_X, AUTO_MAX_Y, FEAT } from "./flow-consts";
import {
  borgFlowClear,
  borgFlowCommit,
  borgFlowEnqueueGrid,
  borgFlowOld,
  borgFlowSpread,
  dataIdx,
  type FlowState,
} from "./flow";
import { borgFlowReverse } from "./flow-misc";

/* The 24-grid open-room search offsets (borg-flow.c borg_ddx_ddd/borg_ddy_ddd). */
// prettier-ignore
const BORG_DDX_DDD = [0,0,1,-1,1,-1,1,-1,2,2,2,-2,-2,-2,-2,-1,0,1,2,-2,-1,0,1,2];
// prettier-ignore
const BORG_DDY_DDD = [1,-1,0,0,1,1,-1,-1,-1,0,1,-1,0,1,-2,-2,-2,-2,-2,2,2,2,2,2];

/**
 * borg_flow_glyph (borg-flow-glyph.c): find a 7x7 room, flow to the pattern
 * centre, and lay a ring of glyphs. Returns the next step / glyph action or null.
 */
export function borgFlowGlyph(ctx: BorgContext, flow: FlowState): AgentCommand | null {
  const w = ctx.world;

  if (
    (flow.glyphYCenter === 0 && flow.glyphXCenter === 0) ||
    distance(w.self.c.x, w.self.c.y, flow.glyphXCenter, flow.glyphYCenter) >= 50
  ) {
    flow.borgNeedsNewSea = true;
  }

  /* We have arrived at the chosen glyph grid */
  if (flow.glyphX === w.self.c.x && flow.glyphY === w.self.c.y) {
    flow.glyphX = 0;
    flow.glyphY = 0;

    if (flow.borgNeedsNewSea) {
      flow.glyphYCenter = w.self.c.y;
      flow.glyphXCenter = w.self.c.x;
    }
    flow.borgNeedsNewSea = false;

    const cmd = flow.hooks.layGlyph(ctx);
    if (!cmd) return null;

    /* Track the newly laid glyph (skip if already known) */
    for (let i = 0; i < flow.glyph.num; i++) {
      if (flow.glyph.x[i] === w.self.c.x && flow.glyph.y[i] === w.self.c.y) {
        return cmd;
      }
    }
    flow.glyph.add(w.self.c.y, w.self.c.x);
    return cmd;
  }

  /* Reverse flow to get cost[] from the player outward */
  borgFlowReverse(ctx, flow, 250, true, false, false, -1, false);

  let bX = w.self.c.x;
  let bY = w.self.c.y;
  let bV = -1;

  for (let y = 15; y < AUTO_MAX_Y - 15; y++) {
    for (let x = 50; x < AUTO_MAX_X - 50; x++) {
      const ag = w.map.at(x, y);

      /* Skip every non floor/glyph (verbatim upstream condition) */
      if (ag.feat !== FEAT.FLOOR && ag.glyph) continue;

      const cost = flow.cost[dataIdx(x, y)]!;
      if (cost >= 75) continue;

      if (flow.borgNeedsNewSea) {
        const goalGlyph = 24;
        let floor = 0;
        let tmpGlyph = 0;
        for (let i = 0; i < 24; i++) {
          const xx = x + BORG_DDX_DDD[i]!;
          const yy = y + BORG_DDY_DDD[i]!;
          if (!w.map.inBounds(xx, yy)) continue;
          const a = w.map.at(xx, yy);
          if (a.feat === FEAT.FLOOR || a.glyph) floor++;
        }
        if (floor !== 24) continue;
        for (let i = 0; i < 24; i++) {
          const xx = x + BORG_DDX_DDD[i]!;
          const yy = y + BORG_DDY_DDD[i]!;
          if (!w.map.inBounds(xx, yy)) continue;
          if (w.map.at(xx, yy).glyph) tmpGlyph++;
        }

        let v = 100 + tmpGlyph * 500 - cost * 1;
        if (w.map.at(x, y).feat === FEAT.FLOOR) v += 3000;
        if (tmpGlyph === goalGlyph) v += 5000;
        if (tmpGlyph !== goalGlyph && w.map.at(x, y).glyph) v = -1;
        if (v <= 0) continue;
        if (bV >= 0 && v < bV) continue;

        bV = v;
        bX = x;
        bY = y;
      } else {
        /* Old centre: fill outlying glyphs */
        for (let i = 0; i < 24; i++) {
          if (flow.glyphXCenter + BORG_DDX_DDD[i]! !== x) continue;
          if (flow.glyphYCenter + BORG_DDY_DDD[i]! !== y) continue;
          if (w.map.at(x, y).glyph) continue;

          const v = 500 - cost * 1;
          if (v <= 0) continue;
          if (bV >= 0 && v < bV) continue;

          bV = v;
          bX = x;
          bY = y;
        }
      }
    }
  }

  /* If the whole ring around the centre is glyphed, target the centre */
  if (flow.glyphYCenter !== 0 && flow.glyphXCenter !== 0) {
    let glyph = 0;
    for (let i = 0; i < 24; i++) {
      const xx = flow.glyphXCenter + BORG_DDX_DDD[i]!;
      const yy = flow.glyphYCenter + BORG_DDY_DDD[i]!;
      if (!w.map.inBounds(xx, yy)) continue;
      if (w.map.at(xx, yy).glyph) glyph++;
      if (glyph === 24) {
        bV = 5000;
        bX = flow.glyphXCenter;
        bY = flow.glyphYCenter;
      }
    }
  }

  borgFlowClear(flow);
  if (bV < 0) return null;

  flow.glyphX = bX;
  flow.glyphY = bY;

  borgFlowEnqueueGrid(ctx, flow, bY, bX);
  borgFlowSpread(ctx, flow, 250, true, false, false, -1, false);

  if (!borgFlowCommit(ctx, flow, GOAL_MISC)) return null;
  return borgFlowOld(ctx, flow, GOAL_MISC);
}
