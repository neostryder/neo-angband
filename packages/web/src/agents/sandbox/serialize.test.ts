/**
 * serializeView (W2.1): the perceive-side capability gate for a sandboxed
 * plugin. A domain must be present iff the plugin holds its read grant (or the
 * wildcard); an ungranted domain is absent, not thrown.
 */

import { describe, expect, it } from "vitest";
import type {
  AgentCapabilities,
  AgentView,
  CellView,
} from "@neo-angband/core";
import { serializeView } from "./serialize";

/** Exact-match capability stub (serializeView also checks the wildcard). */
function caps(grants: string[]): AgentCapabilities {
  return { has: (c) => grants.includes(c) };
}

function cell(x: number, y: number, over: Partial<CellView> = {}): CellView {
  return {
    x,
    y,
    feat: 1,
    passable: true,
    inView: false,
    known: false,
    monster: 0,
    objectCount: 0,
    glow: false,
    trap: false,
    ...over,
  };
}

/** A fake AgentView over a tiny 2x2 map with one known cell carrying an item. */
function fakeView(): AgentView {
  const bounds = { width: 2, height: 2 };
  const grid: Record<string, CellView> = {
    "0,0": cell(0, 0, { known: true }),
    "1,0": cell(1, 0, { inView: true, objectCount: 2 }),
    "0,1": cell(0, 1), // unknown + unseen -> excluded from sparse cells
    "1,1": cell(1, 1),
  };
  return {
    apiVersion: "1.0.0",
    turn: () => 42,
    player: () =>
      ({ hp: 10, grid: { x: 0, y: 0 } }) as unknown as ReturnType<AgentView["player"]>,
    monsters: () => [{ id: 1 }] as unknown as ReturnType<AgentView["monsters"]>,
    cell: (x, y) => grid[`${x},${y}`] ?? null,
    mapBounds: () => bounds,
    inventory: () => [{ label: "a potion" }] as unknown as ReturnType<AgentView["inventory"]>,
    equipment: () => [null],
    floorItems: (x, y) =>
      x === 1 && y === 0
        ? ([{ label: "a torch" }] as unknown as ReturnType<AgentView["floorItems"]>)
        : [],
    target: () => null,
    messages: () => ["hello"],
    stores: () => [],
    spellbooks: () => [],
    constants: () => ({}) as ReturnType<AgentView["constants"]>,
  };
}

describe("serializeView", () => {
  it("includes only granted domains", () => {
    const snap = serializeView(fakeView(), caps(["state:player.read"]));
    expect(snap.player).toBeDefined();
    expect(snap.turn).toBeUndefined();
    expect(snap.monsters).toBeUndefined();
    expect(snap.inventory).toBeUndefined();
    expect(snap.cells).toBeUndefined();
    expect(snap.messages).toBeUndefined();
  });

  it("state:*.read grants every domain", () => {
    const snap = serializeView(fakeView(), caps(["state:*.read"]));
    expect(snap.turn).toBe(42);
    expect(snap.player).toBeDefined();
    expect(snap.monsters).toHaveLength(1);
    expect(snap.inventory).toBeDefined();
    expect(snap.equipment).toBeDefined();
    expect(snap.messages).toEqual(["hello"]);
    expect(snap.mapBounds).toEqual({ width: 2, height: 2 });
  });

  it("carries only seen/remembered cells (sparse map)", () => {
    const snap = serializeView(fakeView(), caps(["state:map.read"]));
    // 0,0 known + 1,0 inView are carried; 0,1 and 1,1 (unknown+unseen) are not.
    expect(snap.cells?.map((c) => `${c.x},${c.y}`).sort()).toEqual(["0,0", "1,0"]);
    expect(snap.floor).toBeUndefined(); // floor domain not granted
  });

  it("carries floor objects for the floor domain only", () => {
    const snap = serializeView(fakeView(), caps(["state:floor.read"]));
    expect(snap.floor).toEqual({ "1,0": [{ label: "a torch" }] });
    expect(snap.cells).toBeUndefined(); // map domain not granted
  });

  it("inventory grant carries both pack and equipment", () => {
    const snap = serializeView(fakeView(), caps(["state:inventory.read"]));
    expect(snap.inventory).toBeDefined();
    expect(snap.equipment).toBeDefined();
  });
});
