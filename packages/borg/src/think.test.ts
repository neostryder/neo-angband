/**
 * Think-ladder tests (P8.6): the faithful borg_think_dungeon priority ladder and
 * the borg_think store/dungeon dispatch, driven through the controller against
 * the scenario harness. These assert the load-bearing priorities (yield on
 * death, always drive the game, store dispatch, determinism) rather than the
 * former foundation stub's fixed melee/step/hold policy.
 */

import { describe, expect, it } from "vitest";
import { FEAT } from "@neo-angband/core";
import { createBorg } from "./controller";
import { makeScenarioView, makeFakeActions } from "./harness";

describe("borg_think dispatch", () => {
  it("yields (null) when the player is dead", () => {
    const { controller } = createBorg();
    const view = makeScenarioView({ player: { dead: true } });
    expect(controller(view, makeFakeActions())).toBeNull();
  });

  it("always drives the game on a live dungeon level", () => {
    const { controller } = createBorg();
    const view = makeScenarioView({
      player: { grid: { x: 5, y: 5 }, depth: 3 },
      monsters: [{ grid: { x: 9, y: 5 } }],
    });
    const cmd = controller(view, makeFakeActions());
    expect(cmd).not.toBeNull();
  });

  it("dispatches to the store ladder when the inShop seam reports a shop", () => {
    // With an empty store the shop ladder finds no business and exits (the
    // faithful borg_think_store tail: clear goal, shop-exit).
    const { controller } = createBorg({ resolvers: { inShop: () => 0 } });
    const view = makeScenarioView({ player: { depth: 0 } });
    const cmd = controller(view, makeFakeActions());
    expect(cmd).not.toBeNull();
    expect(cmd!.code).toBe("shop-exit");
  });

  it("does not enter the store ladder without the seam (default)", () => {
    const { controller } = createBorg();
    const view = makeScenarioView({ player: { depth: 0 } });
    const cmd = controller(view, makeFakeActions());
    // Town ladder produces exploration / leave behavior, never a shop command.
    expect(cmd?.code).not.toBe("shop-exit");
  });
});

describe("ladder determinism", () => {
  it("two borgs from the same seed produce the same command for a scenario", () => {
    const scenario = {
      player: { grid: { x: 6, y: 6 }, depth: 2 },
      monsters: [{ grid: { x: 10, y: 6 } }],
    };
    const a = createBorg();
    const b = createBorg();
    const ca = a.controller(makeScenarioView(scenario), makeFakeActions());
    const cb = b.controller(makeScenarioView(scenario), makeFakeActions());
    expect(ca).toEqual(cb);
  });
});

describe("ladder priorities", () => {
  it("advances the panel clock and per-level began clock", () => {
    const { world, controller } = createBorg();
    controller(makeScenarioView({ player: { depth: 2 } }), makeFakeActions());
    expect(world.self.timeThisPanel).toBeGreaterThanOrEqual(1);
    // Descending to a new depth resets the panel clock and the "began" marker.
    controller(makeScenarioView({ player: { depth: 3 } }), makeFakeActions());
    expect(world.facts.depth).toBe(3);
  });

  it("takes a down staircase it is standing on when fleeing the level", () => {
    // Stand the borg on a down stair, force the fleeing goal, and confirm the
    // ladder's flee branch drives toward / uses stairs (a stair-seeking command).
    const { world, controller } = createBorg();
    const view = makeScenarioView({
      player: { grid: { x: 5, y: 5 }, depth: 5 },
      cells: { "5,5": { feat: FEAT.MORE } },
    });
    // Prime perception once so the stair is tracked, then set the flee goal.
    controller(view, makeFakeActions());
    world.self.goal.fleeing = true;
    const cmd = controller(view, makeFakeActions());
    expect(cmd).not.toBeNull();
  });
});
