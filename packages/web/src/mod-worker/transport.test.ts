import { describe, expect, it, vi } from "vitest";
import { ModWorkerTransport } from "./transport";

describe("API-2 generic transport caches", () => {
  it("serves only named versioned snapshots", () => {
    const transport = new ModWorkerTransport();
    expect(transport.snapshot("engine.facts", undefined, {})).toMatchObject({ revision: 1, data: { commandFallbackVerb: "do that with" } });
    expect(() => transport.snapshot("core.exports", undefined, {})).toThrow(/allow-listed/);
    expect(() => transport.snapshot("engine.facts", undefined, { export: "nope" })).toThrow(/selector/);
  });

  it("installs object ordering once and reads it synchronously during sorting", () => {
    const transport = new ModWorkerTransport();
    transport.installPolicy("early", 1, "object-list.order-v1", 1, { keys: ["dx"] });
    transport.installPolicy("late", 2, "object-list.order-v1", 1, { keys: ["dy"] });
    const compared = [{ dx: 9, dy: 1 }, { dx: 1, dy: 2 }].sort((a, b) => transport.compareObjectList(a, b));
    expect(compared).toEqual([{ dx: 9, dy: 1 }, { dx: 1, dy: 2 }]);
  });

  it("folds artifact.commit serially in load order and treats a timeout as allow", async () => {
    const transport = new ModWorkerTransport({ hookTimeoutMs: 1 });
    const order: string[] = [];
    transport.addHookPeer({ pluginId: "first", loadOrder: 1, request: async () => { order.push("first"); return { decision: "allow" }; } });
    transport.addHookPeer({ pluginId: "second", loadOrder: 2, request: async () => { order.push("second"); return { decision: "deny" }; } });
    expect(await transport.artifactCommit({ artifactIndex: 4, alreadyCreated: false })).toBe(false);
    expect(order).toEqual(["first", "second"]);
    const slow = new ModWorkerTransport({ hookTimeoutMs: 1 });
    slow.addHookPeer({ pluginId: "slow", loadOrder: 1, request: () => new Promise(() => undefined) });
    expect(await slow.artifactCommit({ artifactIndex: 4, alreadyCreated: false })).toBe(true);
  });

  it("owns command declarations and their teardown, dispatching a host intent", () => {
    const actions = new Map<string, () => number>();
    const intents: string[] = [];
    const transport = new ModWorkerTransport({ commands: { register: (id, action) => actions.set(id, action), revoke: (id) => actions.delete(id), setVerb: vi.fn() }, onCommandIntent: (_plugin, _id, intent) => intents.push(intent) });
    transport.declare("feature", "command", "feature-spike", { id: "feature-spike", verb: "spike", input: "direction", intentCodes: ["spike-door"] });
    expect(actions.has("feature-spike")).toBe(true);
    expect(actions.get("feature-spike")?.()).toBe(0);
    expect(intents).toEqual(["spike-door"]);
    transport.revoke("feature", "command", "feature-spike");
    expect(actions.has("feature-spike")).toBe(false);
  });

  it("paints the last bounded region patch from a host cache", () => {
    const transport = new ModWorkerTransport();
    transport.declareRegion("forge", { id: "forge-tab", layer: "hud", placement: { x: 0, y: 0, width: 10, height: 1 }, inputActions: ["open"] });
    transport.patchRegion("forge", "forge-tab", { cells: [{ x: 0, y: 0, text: "Forge", style: { bold: true } }] });
    const painted: string[] = [];
    transport.paintRegion("forge", "forge-tab", (cell) => painted.push(cell.text));
    expect(painted).toEqual(["Forge"]);
  });
});
