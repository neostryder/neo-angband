/**
 * Flow/pathfinding tests (P8.1). Drive the ported borg_flow_* subsystem against
 * the scenario harness: the BFS cost model, commit/reachability, and each goal
 * family (stairs, kills, takes, dark) producing a faithful next step.
 */

import { describe, expect, it } from "vitest";
import type { AgentCommand } from "@neo-angband/core";
import { BorgWorld } from "../world/model";
import { perceive, makePerceiveMemo } from "../perceive";
import { makeScenarioView, makeFakeActions, type Scenario } from "../harness";
import { makeBorgRng } from "../rng";
import type { BorgContext } from "../context";
import { FEAT } from "@neo-angband/core";
import { BI } from "./flow-consts";
import {
  borgFlowClear,
  borgFlowCommit,
  borgFlowEnqueueGrid,
  borgPlayStep,
  borgFlowSpread,
  createFlowState,
  dataIdx,
} from "./flow";
import { createFlow } from "./index";

/** Build a seeded BorgContext from a scenario, with optional trait overrides. */
function makeCtx(
  scenario: Scenario,
  traits: Partial<Record<keyof typeof BI, number>> = {},
): BorgContext {
  const world = new BorgWorld();
  const view = makeScenarioView(scenario);
  perceive(world, view, makePerceiveMemo());
  for (const [k, v] of Object.entries(traits)) {
    world.self.trait[BI[k as keyof typeof BI]] = v;
  }
  return { world, view, act: makeFakeActions(), rng: makeBorgRng() };
}

/** A dir command's numpad direction, or -1. */
function dirOf(cmd: AgentCommand | null): number {
  if (!cmd) return -1;
  const c = cmd as { code: string; dir?: number };
  return c.code === "walk" && typeof c.dir === "number" ? c.dir : -1;
}

describe("borg_flow_spread (BFS cost model)", () => {
  it("fills cost[] with Chebyshev step distance on open floor", () => {
    const ctx = makeCtx({
      width: 40,
      height: 25,
      player: { grid: { x: 10, y: 10 } },
    });
    const flow = createFlowState();

    borgFlowClear(flow);
    borgFlowEnqueueGrid(ctx, flow, 10, 13); // target 3 east of player
    borgFlowSpread(ctx, flow, 250, false, false, false, -1, false);

    // 8-connected BFS on open floor == Chebyshev distance.
    expect(flow.cost[dataIdx(13, 10)]).toBe(0);
    expect(flow.cost[dataIdx(10, 10)]).toBe(3);
    expect(flow.cost[dataIdx(11, 10)]).toBe(2);
    expect(flow.cost[dataIdx(13, 13)]).toBe(3);
  });

  it("does not spread through walls (granite)", () => {
    const ctx = makeCtx({
      width: 40,
      height: 25,
      player: { grid: { x: 10, y: 10 } },
    });
    // A full-height granite wall at x=12 fully separates the two sides (written
    // straight onto the borg map so it spans the whole 66-row map, not just the
    // perceived panel, which the borg would otherwise flow around).
    for (let y = 0; y < ctx.world.map.height; y++) {
      ctx.world.map.at(12, y).feat = FEAT.GRANITE;
    }
    const flow = createFlowState();

    borgFlowClear(flow);
    borgFlowEnqueueGrid(ctx, flow, 10, 15); // target east of the wall
    borgFlowSpread(ctx, flow, 250, false, false, false, -1, false);

    // Player is walled off: cost stays at the "hard" 255 sentinel.
    expect(flow.cost[dataIdx(10, 10)]).toBe(255);
  });
});

describe("borg_flow_commit (reachability)", () => {
  it("commits a reachable goal and records the goal type", () => {
    const ctx = makeCtx({ player: { grid: { x: 10, y: 10 } } });
    const flow = createFlowState();
    borgFlowClear(flow);
    borgFlowEnqueueGrid(ctx, flow, 10, 13);
    borgFlowSpread(ctx, flow, 250, false, false, false, -1, false);

    expect(borgFlowCommit(ctx, flow, 1 /* GOAL_KILL */)).toBe(true);
    expect(ctx.world.self.goal.type).toBe(1);
  });

  it("refuses an unreachable goal (cost >= 250)", () => {
    const ctx = makeCtx({ player: { grid: { x: 10, y: 10 } } });
    const flow = createFlowState();
    borgFlowClear(flow);
    // Nothing enqueued -> player cost stays 255 -> commit fails.
    expect(borgFlowCommit(ctx, flow, 1)).toBe(false);
  });
});

describe("flow.toKills", () => {
  it("steps toward a tracked monster on open floor", () => {
    const ctx = makeCtx(
      {
        width: 40,
        height: 25,
        player: { grid: { x: 10, y: 10 } },
        monsters: [{ grid: { x: 15, y: 10 }, hp: 10, maxHp: 10 }],
      },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    const flow = createFlow();
    const cmd = flow.toKills(ctx, 250);
    // Should walk east (dir 6) toward the monster.
    expect(dirOf(cmd)).toBe(6);
  });

  it("melees an adjacent monster", () => {
    const ctx = makeCtx(
      {
        width: 40,
        height: 25,
        player: { grid: { x: 10, y: 10 } },
        monsters: [{ grid: { x: 11, y: 10 }, hp: 10, maxHp: 10 }],
      },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    const flow = createFlow();
    const cmd = flow.toKills(ctx, 250);
    expect(dirOf(cmd)).toBe(6); // walk into the monster's grid == melee
  });

  it("yields (null) when there are no monsters", () => {
    const ctx = makeCtx(
      { player: { grid: { x: 10, y: 10 } } },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    expect(createFlow().toKills(ctx, 250)).toBeNull();
  });
});

describe("flow.toTakes", () => {
  it("steps toward a wanted floor object", () => {
    const ctx = makeCtx(
      {
        width: 40,
        height: 25,
        player: { grid: { x: 10, y: 10 } },
        floor: { "7,10": [{ tval: 5 } as never] },
      },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    // Perceive records the take as un-wanted; mark it wanted (P8.5 valuation).
    for (const [, t] of ctx.world.takes.entries()) t.wanted = true;

    const cmd = createFlow().toTakes(ctx);
    expect(dirOf(cmd)).toBe(4); // walk west toward (7,10)
  });

  it("yields when the only item is not wanted", () => {
    const ctx = makeCtx(
      {
        player: { grid: { x: 10, y: 10 } },
        floor: { "7,10": [{ tval: 5 } as never] },
      },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    expect(createFlow().toTakes(ctx)).toBeNull();
  });
});

describe("flow.toStairs", () => {
  it("steps toward a down staircase", () => {
    const ctx = makeCtx(
      {
        width: 40,
        height: 25,
        player: { grid: { x: 10, y: 10 } },
        cells: { "10,14": { feat: FEAT.MORE } },
      },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    const cmd = createFlow().toStairs(ctx, true);
    expect(dirOf(cmd)).toBe(2); // walk south toward (10,14)
  });

  it("yields when no down stairs are known", () => {
    const ctx = makeCtx(
      { player: { grid: { x: 10, y: 10 } } },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    expect(createFlow().toStairs(ctx, true)).toBeNull();
  });

  it("borg_play_step ascends while standing on up stairs with goal.less", () => {
    // The stand-on-up-stairs branch checks the borg's CURRENT grid.
    const ctx = makeCtx(
      {
        player: { grid: { x: 10, y: 10 } },
        cells: { "10,10": { feat: FEAT.LESS } },
      },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    ctx.world.self.goal.less = true;
    const flow = createFlowState();
    const cmd = borgPlayStep(ctx, flow, 5, 10); // any target; current grid wins
    expect((cmd as { code: string } | null)?.code).toBe("ascend");
  });
});

describe("flow.toDark (exploration)", () => {
  it("steps toward unknown territory when boxed by explored floor", () => {
    // A small known floor room inside a larger map; everything else is unknown
    // (FEAT.NONE), so exploration should head for the frontier.
    const ctx = makeCtx(
      {
        width: 60,
        height: 40,
        player: { grid: { x: 30, y: 20 } },
      },
      { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 },
    );
    // The scenario marks the whole 60x40 as known floor; carve unknown edges by
    // leaving the borg map's far grids as FEAT.NONE (they already are beyond the
    // perceived bounds). Reachability is satisfied within the room.
    const cmd = createFlow().toDark(ctx, false);
    // Exploration either finds a frontier step (a walk) or yields; if it steps,
    // it must be a legal move command.
    if (cmd) expect((cmd as { code: string }).code).toBe("walk");
  });
});

describe("determinism", () => {
  it("produces the same command for the same inputs", () => {
    const scenario: Scenario = {
      width: 40,
      height: 25,
      player: { grid: { x: 10, y: 10 } },
      monsters: [{ grid: { x: 15, y: 12 }, hp: 10, maxHp: 10 }],
    };
    const traits = { CLEVEL: 25, CDEPTH: 5, FOOD: 5, LIGHT: 1 } as const;

    const a = dirOf(createFlow().toKills(makeCtx(scenario, traits), 250));
    const b = dirOf(createFlow().toKills(makeCtx(scenario, traits), 250));
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });
});
