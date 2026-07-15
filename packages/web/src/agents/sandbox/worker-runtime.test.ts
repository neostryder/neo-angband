/**
 * The worker-side runtime (W2.1): view reconstruction with a per-domain gate,
 * the pure act command builder, and the init/decide message handler. Exercised
 * without a real Worker via the injectable createRuntimeHandler.
 */

import { describe, expect, it, vi } from "vitest";
import type { ViewSnapshot, WorkerToHost } from "./protocol";
import {
  SANDBOX_PROTOCOL_VERSION,
  TARGET_LOCATION_CODE,
  TARGET_MONSTER_CODE,
} from "./protocol";
import {
  createRuntimeHandler,
  definePlugin,
  sandboxActions,
  snapshotView,
  SandboxCapabilityError,
} from "./worker-runtime";

describe("snapshotView", () => {
  it("returns granted domains and throws on ungranted ones", () => {
    const snap = {
      apiVersion: "1.0.0",
      player: { hp: 5 },
    } as unknown as ViewSnapshot;
    const view = snapshotView(snap);
    expect(view.player()).toEqual({ hp: 5 });
    expect(() => view.monsters()).toThrow(SandboxCapabilityError);
    expect(() => view.turn()).toThrow(/state:turn\.read/);
  });

  it("reconstructs cell() sparsely with synthetic unknowns and bounds nulls", () => {
    const snap: ViewSnapshot = {
      apiVersion: "1.0.0",
      mapBounds: { width: 3, height: 3 },
      cells: [
        {
          x: 1,
          y: 1,
          feat: 7,
          passable: true,
          inView: true,
          known: true,
          monster: 0,
          objectCount: 0,
          glow: false,
          trap: false,
        },
      ],
    };
    const view = snapshotView(snap);
    expect(view.cell(1, 1)?.feat).toBe(7);
    // In-bounds but absent -> synthetic unknown cell.
    expect(view.cell(0, 0)).toMatchObject({ known: false, inView: false });
    // Out of bounds -> null.
    expect(view.cell(5, 5)).toBeNull();
  });

  it("floorItems() defaults to [] and throws without the floor grant", () => {
    const withFloor = snapshotView({ apiVersion: "1", floor: { "2,3": [] } });
    expect(withFloor.floorItems(0, 0)).toEqual([]);
    const noFloor = snapshotView({ apiVersion: "1" });
    expect(() => noFloor.floorItems(0, 0)).toThrow(SandboxCapabilityError);
  });
});

describe("sandboxActions", () => {
  it("builds the same command shapes as the in-process act facade", () => {
    const act = sandboxActions();
    expect(act.move(6)).toEqual({ code: "walk", dir: 6 });
    expect(act.quaff(3)).toEqual({ code: "quaff", args: { handle: 3 } });
    expect(act.cast(2)).toEqual({ code: "cast", args: { spell: 2 } });
    expect(act.drop(1, 5)).toEqual({ code: "drop", args: { handle: 1, quantity: 5 } });
  });

  it("returns reserved codes for the targeting verbs", () => {
    const act = sandboxActions();
    expect(act.setTargetMonster(4)).toEqual({
      code: TARGET_MONSTER_CODE,
      args: { midx: 4 },
    });
    expect(act.setTargetLocation(2, 3)).toEqual({
      code: TARGET_LOCATION_CODE,
      args: { x: 2, y: 3 },
    });
  });
});

describe("createRuntimeHandler", () => {
  it("posts ready on init and drives the plugin's decide on decide", () => {
    const seen: string[] = [];
    definePlugin({
      decide(view) {
        // Reads a granted domain; returns a command derived from it.
        seen.push("decide");
        return { code: "walk", dir: view.player().hp > 0 ? 8 : 2 };
      },
    });
    const posts: WorkerToHost[] = [];
    const handle = createRuntimeHandler((m) => posts.push(m));

    handle({
      type: "init",
      protocolVersion: SANDBOX_PROTOCOL_VERSION,
      pluginUrl: "x",
      capabilities: ["state:*.read", "command:add"],
    });
    expect(posts[0]).toMatchObject({ type: "ready" });

    handle({
      type: "decide",
      seq: 1,
      view: { apiVersion: "1.0.0", player: { hp: 9 } as never },
    });
    expect(posts[1]).toEqual({ type: "command", seq: 1, command: { code: "walk", dir: 8 } });
    expect(seen).toEqual(["decide"]);
  });

  it("rejects a protocol-version mismatch", () => {
    definePlugin({ decide: () => null });
    const posts: WorkerToHost[] = [];
    const handle = createRuntimeHandler((m) => posts.push(m));
    handle({ type: "init", protocolVersion: "9.9.9", pluginUrl: "x", capabilities: [] });
    expect(posts[0]).toMatchObject({ type: "error", phase: "init" });
  });

  it("reports a throwing decide and still yields a null command", () => {
    definePlugin({
      decide() {
        throw new Error("boom");
      },
    });
    const posts: WorkerToHost[] = [];
    const handle = createRuntimeHandler((m) => posts.push(m));
    handle({ type: "init", protocolVersion: SANDBOX_PROTOCOL_VERSION, pluginUrl: "x", capabilities: [] });
    handle({ type: "decide", seq: 7, view: { apiVersion: "1" } });
    expect(posts.find((p) => p.type === "error")).toMatchObject({ phase: "decide", message: "boom" });
    expect(posts.find((p) => p.type === "command")).toEqual({ type: "command", seq: 7, command: null });
  });

  it("errors when a decide arrives with no plugin registered decide-safe", () => {
    // Register a plugin whose decide reads an ungranted domain -> throws inside,
    // proving the gate reaches sandboxed code, not just the host.
    definePlugin({
      decide(view) {
        return { code: "walk", dir: view.monsters().length };
      },
    });
    const posts: WorkerToHost[] = [];
    const handle = createRuntimeHandler((m) => posts.push(m));
    handle({ type: "init", protocolVersion: SANDBOX_PROTOCOL_VERSION, pluginUrl: "x", capabilities: [] });
    handle({ type: "decide", seq: 1, view: { apiVersion: "1", player: { hp: 1 } as never } });
    // monsters domain absent from snapshot -> SandboxCapabilityError -> error + null.
    expect(posts.find((p) => p.type === "error")?.type).toBe("error");
    expect(posts.find((p) => p.type === "command")).toEqual({ type: "command", seq: 1, command: null });
    vi.clearAllMocks();
  });
});
