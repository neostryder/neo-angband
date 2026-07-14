import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { MFLAG } from "../generated";
import { runGameLoop } from "../game/loop";
import { createDefaultRegistry } from "../game/player-turn";
import { addMon, makeRace, makeState } from "../game/harness";
import type { AgentCapabilities } from "./types";
import { AGENT_API_VERSION } from "./types";
import { createAgentView } from "./perceive";
import { createAgentActions } from "./act";
import { AgentCapabilityError, installController } from "./controller";

/** A capability set granting exactly the listed capabilities. */
function grant(...caps: string[]): AgentCapabilities {
  const set = new Set(caps);
  return { has: (c) => set.has(c) };
}

describe("perceive facade (AgentView)", () => {
  it("reports player vitals, position, and the turn from live state", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.chp = 17;
    state.actor.player.mhp = 30;
    state.turn = 1234;
    const view = createAgentView(state);

    expect(view.apiVersion).toBe(AGENT_API_VERSION);
    const p = view.player();
    expect(p.hp).toBe(17);
    expect(p.maxHp).toBe(30);
    expect(p.grid).toEqual({ x: 10, y: 10 });
    expect(view.turn()).toBe(1234);
    expect(view.mapBounds()).toEqual({ width: 40, height: 25 });
  });

  it("lists live monsters and reads a cell's occupant", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace();
    race.name = "test-kobold";
    const mon = addMon(state, race, loc(12, 10));
    const view = createAgentView(state);

    const monsters = view.monsters();
    expect(monsters).toHaveLength(1);
    expect(monsters[0]?.race).toBe("test-kobold");
    expect(monsters[0]?.grid).toEqual({ x: 12, y: 10 });

    const cell = view.cell(12, 10);
    expect(cell?.monster).toBe(mon.midx);
    expect(cell?.passable).toBe(true);
    /* Out of bounds returns null. */
    expect(view.cell(-1, -1)).toBeNull();
  });

  it("returns fresh plain data, not live engine references", () => {
    const state = makeState();
    const view = createAgentView(state);
    const a = view.player();
    a.hp = 999;
    /* Mutating the view result must not touch the engine. */
    expect(view.player().hp).toBe(state.actor.player.chp);
    expect(state.actor.player.chp).not.toBe(999);
  });
});

describe("act facade (AgentActions)", () => {
  it("builds semantic verbs as typed commands", () => {
    const state = makeState();
    const act = createAgentActions(state);
    expect(act.move(6)).toEqual({ code: "walk", dir: 6 });
    expect(act.quaff(42)).toEqual({ code: "quaff", args: { handle: 42 } });
    expect(act.drop(42, 3)).toEqual({
      code: "drop",
      args: { handle: 42, quantity: 3 },
    });
    expect(act.cast(2)).toEqual({ code: "cast", args: { spell: 2 } });
    expect(act.descend()).toEqual({ code: "descend" });
  });

  it("sets a target by monster id through the facade", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace();
    race.name = "target-dummy";
    const mon = addMon(state, race, loc(11, 10));
    /* target_able needs the monster obvious (visible, uncamouflaged). */
    mon.mflag.on(MFLAG.VISIBLE);
    const act = createAgentActions(state);
    const view = createAgentView(state);

    expect(act.setTargetMonster(mon.midx)).toBe(true);
    expect(view.target()?.midx).toBe(mon.midx);
  });
});

describe("controller seam (the acceptance-gate end-to-end)", () => {
  it("a sample agent perceives and drives commands through the public facade", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const registry = createDefaultRegistry();

    /* A trivial agent: step east while HP is full, then yield. No privileged
     * core access - it only reads the view and emits act verbs. */
    let steps = 0;
    const startX = state.actor.grid.x;
    const session = installController(state, (view, act) => {
      if (view.player().hp <= 0 || steps >= 3) return null;
      steps++;
      return act.move(6);
    });

    runGameLoop(state, registry);

    /* The agent drove three eastward steps end-to-end via the facade. */
    expect(steps).toBe(3);
    expect(state.actor.grid.x).toBe(startX + 3);
    expect(state.turn).toBeGreaterThan(0);
    session.uninstall();
  });

  it("taps the message stream so the view reports since-last-decision", () => {
    const state = makeState();
    const prev: string[] = [];
    const originalSink = (t: string): void => {
      prev.push(t);
    };
    state.msg = originalSink;
    const session = installController(state, () => null);

    state.msg?.("you feel a chill");
    /* Perceive drains the buffer; a second read is empty. */
    expect(session.view.messages()).toEqual(["you feel a chill"]);
    expect(session.view.messages()).toEqual([]);
    /* The prior sink still received it (renderer forwarding preserved). */
    expect(prev).toEqual(["you feel a chill"]);

    session.uninstall();
    /* Uninstall restores the original sink. */
    expect(state.msg).toBe(originalSink);
  });

  it("uninstall restores the previous command provider", () => {
    const state = makeState();
    const original = state.nextCommand;
    const session = installController(state, () => ({ code: "hold" }));
    expect(state.nextCommand).not.toBe(original);
    session.uninstall();
    expect(state.nextCommand).toBe(original);
  });
});

describe("capability gating and determinism", () => {
  it("refuses to install without the required capabilities", () => {
    const state = makeState();
    expect(() =>
      installController(state, () => null, {
        capabilities: grant("state:*.read"), // missing command:add
      }),
    ).toThrow(AgentCapabilityError);
  });

  it("installs when both capabilities are granted", () => {
    const state = makeState();
    expect(() =>
      installController(state, () => null, {
        capabilities: grant("state:*.read", "command:add"),
      }),
    ).not.toThrow();
  });

  it("trips the determinism ratchet hook for a nondeterministic controller", () => {
    const state = makeState();
    let flipped = 0;
    installController(state, () => null, {
      nondeterministic: true,
      onNondeterministic: () => {
        flipped++;
      },
    });
    expect(flipped).toBe(1);
  });
});
