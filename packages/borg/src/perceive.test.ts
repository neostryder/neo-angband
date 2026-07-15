/**
 * Perception-deepening tests (P8.6): staleness / expiry, floor-object
 * persistence and under-borg deletion, message-stream pruning of dead monsters,
 * and the per-level fact derivation (borg_near_monster_type). These guard the
 * behavior borg_update contributes to the world model that the think ladder
 * reads.
 */

import { describe, expect, it } from "vitest";
import { FEAT } from "@neo-angband/core";
import { BorgWorld } from "./world/model";
import { perceive, makePerceiveMemo, BORG_EXPIRE_TURNS } from "./perceive";
import { borgReactMessages } from "./perceive-messages";
import { borgNearMonsterType } from "./perceive-facts";
import { borgNotice, BI } from "./trait";
import { getFightState } from "./fight";
import { makeScenarioView, makeFakeActions } from "./harness";
import { makeBorgRng } from "./rng";
import type { BorgContext } from "./context";

/** Build a primed context (perceive + notice run) for a scenario. */
function makeCtx(scenario: Parameters<typeof makeScenarioView>[0]): {
  ctx: BorgContext;
  world: BorgWorld;
} {
  const world = new BorgWorld();
  const view = makeScenarioView(scenario);
  const ctx: BorgContext = {
    world,
    view,
    act: makeFakeActions(),
    rng: makeBorgRng(),
  };
  borgNotice(ctx);
  perceive(world, view, makePerceiveMemo());
  return { ctx, world };
}

describe("staleness and expiry", () => {
  it("keeps a monster after it leaves view, then expires it at 2000 turns", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    perceive(
      world,
      makeScenarioView({ monsters: [{ id: 9, grid: { x: 8, y: 5 } }] }),
      memo,
    );
    expect([...world.kills.entries()]).toHaveLength(1);

    // Leaves view but is still recent -> record survives.
    world.clock = 100;
    perceive(world, makeScenarioView({ monsters: [] }), memo);
    expect([...world.kills.entries()]).toHaveLength(1);

    // Cross the expiry horizon -> record forgotten.
    world.clock = BORG_EXPIRE_TURNS;
    perceive(world, makeScenarioView({ monsters: [] }), memo);
    expect([...world.kills.entries()]).toHaveLength(0);
  });

  it("keeps a floor object across ticks and deletes it when stepped on", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    perceive(
      world,
      makeScenarioView({
        player: { grid: { x: 5, y: 5 } },
        floor: { "6,5": [{ tval: 5 } as never] },
      }),
      memo,
    );
    expect([...world.takes.entries()]).toHaveLength(1);

    // The object leaves the current view (not reported) but persists.
    world.clock = 10;
    perceive(world, makeScenarioView({ player: { grid: { x: 5, y: 5 } } }), memo);
    expect([...world.takes.entries()]).toHaveLength(1);

    // Step onto its grid -> the object under the borg is deleted.
    world.clock = 11;
    perceive(
      world,
      makeScenarioView({
        player: { grid: { x: 6, y: 5 } },
        floor: { "6,5": [{ tval: 5 } as never] },
      }),
      memo,
    );
    expect([...world.takes.entries()]).toHaveLength(0);
  });
});

describe("message-stream reaction", () => {
  it("prunes a tracked monster on a death message once it is out of view", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    perceive(
      world,
      makeScenarioView({
        player: { grid: { x: 5, y: 5 } },
        monsters: [{ id: 9, grid: { x: 6, y: 5 } }],
      }),
      memo,
    );
    expect([...world.kills.entries()]).toHaveLength(1);

    // Next tick the monster is gone from view and a death message arrives.
    world.clock = 1;
    perceive(
      world,
      makeScenarioView({
        player: { grid: { x: 5, y: 5 } },
        monsters: [],
        messages: ["The white harpy dies."],
      }),
      memo,
    );
    expect([...world.kills.entries()]).toHaveLength(0);
  });

  it("does not prune a still-visible monster on a death message", () => {
    const world = new BorgWorld();
    world.self.c = { x: 5, y: 5 };
    // One visible monster (id 9), one stale record (id 7, not in view).
    world.kills.wipe();
    const a = world.kills.alloc();
    world.kills.at(a).mIdx = 9;
    world.kills.at(a).rIdx = 1;
    world.kills.at(a).pos = { x: 6, y: 5 };
    const b = world.kills.alloc();
    world.kills.at(b).mIdx = 7;
    world.kills.at(b).rIdx = 1;
    world.kills.at(b).pos = { x: 4, y: 5 };

    const visible = new Set<number>([9]);
    const deleted = borgReactMessages(world, ["The kobold dies."], visible);
    expect(deleted).toBe(1);
    // The visible monster (9) survives; the stale one (7) is pruned.
    const ids = [...world.kills.entries()].map(([, k]) => k.mIdx);
    expect(ids).toContain(9);
    expect(ids).not.toContain(7);
  });
});

describe("borg_near_monster_type facts", () => {
  it("flags a visible unique on the level and marks fighting-unique", () => {
    const { ctx, world } = makeCtx({
      player: { grid: { x: 5, y: 5 }, level: 10 },
      monsters: [
        {
          id: 3,
          raceIndex: 77,
          grid: { x: 8, y: 5 },
          race: "Bullroarer the Hobbit",
          raceFlags: ["UNIQUE", "EVIL"],
        },
      ],
    });
    borgNearMonsterType(ctx, 20);
    expect(world.facts.uniqueOnLevel).toBe(77);
    expect(getFightState(world).fightingUnique).toBeGreaterThan(0);
    expect(getFightState(world).fightingEvilUnique).toBe(true);
  });

  it("flags a scary guy by name for a very low-level borg", () => {
    const { ctx, world } = makeCtx({
      player: { grid: { x: 5, y: 5 }, level: 1, depth: 1 },
      monsters: [{ id: 4, grid: { x: 7, y: 5 }, race: "Grip, Farmer Maggot's Dog" }],
    });
    expect(world.self.trait[BI.CLEVEL]).toBeLessThanOrEqual(5);
    borgNearMonsterType(ctx, 20);
    expect(world.facts.scaryGuyOnLevel).toBe(true);
  });

  it("marks a summoner and records its index when close", () => {
    const { ctx, world } = makeCtx({
      player: { grid: { x: 5, y: 5 }, level: 20, depth: 20 },
      monsters: [
        {
          id: 5,
          grid: { x: 7, y: 5 },
          race: "necromancer",
          spellFlags: ["S_MONSTER"],
        },
      ],
    });
    borgNearMonsterType(ctx, 20);
    expect(getFightState(world).fightingSummoner).toBe(true);
    expect(world.kills.summoner).toBeGreaterThan(0);
  });
});

describe("fog-of-war invariant", () => {
  it("records only known/in-view cells (no omniscient reads)", () => {
    const world = new BorgWorld();
    perceive(
      world,
      makeScenarioView({
        width: 10,
        height: 10,
        player: { grid: { x: 5, y: 5 } },
        cells: { "1,1": { known: false, inView: false, feat: FEAT.GRANITE } },
      }),
      makePerceiveMemo(),
    );
    // The unknown far corner was skipped -> still feat 0 (unseen).
    expect(world.map.at(1, 1).feat).toBe(0);
  });
});
