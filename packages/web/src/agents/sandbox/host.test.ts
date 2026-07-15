/**
 * The host async<->sync bridge (W2.1): the controller yields null until the
 * worker replies, then surfaces the pending command; reserved targeting
 * commands are applied to the live act facade and transparently re-requested.
 * Tested with a fake transport - no real Worker.
 */

import { describe, expect, it, vi } from "vitest";
import type {
  AgentActions,
  AgentCapabilities,
  AgentView,
} from "@neo-angband/core";
import type { HostToWorker } from "./protocol";
import { TARGET_MONSTER_CODE } from "./protocol";
import { createSandboxBridge } from "./host";

const NO_CAPS: AgentCapabilities = { has: () => false };
const view = { apiVersion: "1.0.0" } as AgentView;

function makeBridge() {
  const posted: HostToWorker[] = [];
  const setTargetMonster = vi.fn(() => true);
  const setTargetLocation = vi.fn();
  const act = { setTargetMonster, setTargetLocation } as unknown as AgentActions;
  const bridge = createSandboxBridge({
    post: (m) => posted.push(m),
    caps: NO_CAPS,
    capabilityStrings: [],
    pluginUrl: "demo",
  });
  return { bridge, posted, act, setTargetMonster, setTargetLocation };
}

describe("createSandboxBridge", () => {
  it("yields null and posts nothing until the worker is ready", () => {
    const { bridge, posted, act } = makeBridge();
    expect(bridge.controller(view, act)).toBeNull();
    expect(posted).toHaveLength(0);
    expect(bridge.isReady()).toBe(false);
  });

  it("requests a decision once ready and surfaces the reply on the next tick", () => {
    const { bridge, posted, act } = makeBridge();
    bridge.receive({ type: "ready", protocolVersion: "1.0.0", apiVersion: "1.0.0" });
    expect(bridge.isReady()).toBe(true);

    // First controller call after ready posts a decide and yields.
    expect(bridge.controller(view, act)).toBeNull();
    expect(posted).toEqual([{ type: "decide", seq: 1, view: { apiVersion: "1.0.0" } }]);

    // While the request is in flight, no duplicate decide is posted.
    expect(bridge.controller(view, act)).toBeNull();
    expect(posted).toHaveLength(1);

    // The worker replies; the next controller call returns the command.
    bridge.receive({ type: "command", seq: 1, command: { code: "walk", dir: 6 } });
    expect(bridge.controller(view, act)).toEqual({ code: "walk", dir: 6 });

    // After executing it, the next call requests the following decision.
    expect(bridge.controller(view, act)).toBeNull();
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ type: "decide", seq: 2 });
  });

  it("applies a targeting command to live state and re-requests transparently", () => {
    const { bridge, posted, act, setTargetMonster } = makeBridge();
    bridge.receive({ type: "ready", protocolVersion: "1.0.0", apiVersion: "1.0.0" });
    bridge.controller(view, act); // posts decide seq 1

    // Worker returns a set-target command: applied to live state, not surfaced.
    bridge.receive({ type: "command", seq: 1, command: { code: TARGET_MONSTER_CODE, args: { midx: 4 } } });
    expect(setTargetMonster).toHaveBeenCalledWith(4);
    // A fresh decide was posted; no command is pending for the loop.
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ type: "decide", seq: 2 });
    expect(bridge.controller(view, act)).toBeNull();

    // The follow-up real command surfaces normally.
    bridge.receive({ type: "command", seq: 2, command: { code: "walk", dir: 2 } });
    expect(bridge.controller(view, act)).toEqual({ code: "walk", dir: 2 });
  });

  it("ignores a stale reply from a superseded request", () => {
    const { bridge, act } = makeBridge();
    bridge.receive({ type: "ready", protocolVersion: "1.0.0", apiVersion: "1.0.0" });
    bridge.controller(view, act); // seq 1
    // A reply tagged with the wrong seq is dropped.
    bridge.receive({ type: "command", seq: 99, command: { code: "walk", dir: 8 } });
    expect(bridge.controller(view, act)).toBeNull();
  });

  it("routes worker diagnostics to the sinks", () => {
    const onError = vi.fn();
    const onLog = vi.fn();
    const posted: HostToWorker[] = [];
    const bridge = createSandboxBridge({
      post: (m) => posted.push(m),
      caps: NO_CAPS,
      capabilityStrings: [],
      pluginUrl: "demo",
      onError,
      onLog,
    });
    bridge.receive({ type: "log", level: "warn", message: "hi" });
    bridge.receive({ type: "error", phase: "decide", message: "bad" });
    expect(onLog).toHaveBeenCalledWith("warn", "hi");
    expect(onError).toHaveBeenCalledWith("decide", "bad");
  });
});
