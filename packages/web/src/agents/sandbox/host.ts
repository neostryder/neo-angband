/**
 * The host side of the scripted-plugin sandbox (MOD_INTEGRATION_PLAN.md Wave 2,
 * W2.1). It bridges the asynchronous Worker boundary to the SYNCHRONOUS
 * controller seam (core/agent/controller.ts): runGameLoop calls nextCommand and
 * expects an immediate AgentCommand or null, but a Worker round-trip is async.
 *
 * The bridge resolves this with a one-decision pipeline that reuses the same
 * tick pump an in-process agent already uses (main.ts W1.5):
 *  - When the loop asks for a command and one is pending from the worker,
 *    return it. Otherwise post the current (capability-gated) view to the
 *    worker as a decision request and yield null. The pump ticks again; once
 *    the worker replies, the command is pending and the next tick executes it.
 *  - A returned targeting command (the two reserved codes) is applied against
 *    the live target.c facade immediately, then the worker is re-asked, so the
 *    full act surface - including set-target - works across the thread.
 *
 * Every command the worker returns is implicitly re-validated by the live act
 * facade the loop drives it through (command:add was enforced at install), and
 * the view was already gated by serializeView, so an ungranted plugin can
 * neither see nor do anything outside its manifest.
 *
 * createSandboxBridge holds all of this logic over injected transport so it is
 * unit-testable with a fake worker; installSandboxedController wires a real
 * Worker to it and installs the controller.
 */

import type {
  AgentActions,
  AgentCapabilities,
  AgentCommand,
  AgentController,
  AgentSession,
  AgentView,
  GameState,
} from "@neo-angband/core";
import { installController } from "@neo-angband/core";
import { serializeView } from "./serialize";
import {
  SANDBOX_PROTOCOL_VERSION,
  TARGET_LOCATION_CODE,
  TARGET_MONSTER_CODE,
} from "./protocol";
import type { HostToWorker, WorkerToHost } from "./protocol";

/** Dependencies the pure bridge needs; the real host injects a Worker poster. */
export interface SandboxBridgeDeps {
  /** Post a message to the worker. */
  post: (msg: HostToWorker) => void;
  /** The plugin's granted capabilities (gates the serialized view). */
  caps: AgentCapabilities;
  /**
   * The exact capability strings from the manifest, forwarded to the worker in
   * init (AgentCapabilities is structural has() only, so the grant list itself
   * cannot be read back off it - the worker needs it to restore network globals).
   */
  capabilityStrings: string[];
  /** Plugin module URL, sent in init so the worker can identify itself. */
  pluginUrl: string;
  /** Diagnostic sinks (optional). */
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  onError?: (phase: "init" | "decide", message: string) => void;
  onReady?: () => void;
}

/** A live bridge: the controller to install, plus the inbound message sink. */
export interface SandboxBridge {
  /** The synchronous controller to hand installController. */
  controller: AgentController;
  /** Feed one worker->host message in. */
  receive: (msg: WorkerToHost) => void;
  /** True once the worker has posted "ready". */
  isReady: () => boolean;
  /** Send init to the worker (call once, after wiring receive). */
  start: () => void;
}

/**
 * Build the async<->sync bridge over injected transport. Pure: no Worker, no
 * DOM. The real host passes a Worker-backed `post` and forwards the worker's
 * messages to `receive`; tests pass fakes.
 */
export function createSandboxBridge(deps: SandboxBridgeDeps): SandboxBridge {
  let ready = false;
  let awaiting = false;
  let pending: AgentCommand | null = null;
  let seq = 0;
  let viewRef: AgentView | null = null;
  let actRef: AgentActions | null = null;

  const requestDecision = (): void => {
    if (!viewRef) return;
    awaiting = true;
    seq += 1;
    deps.post({ type: "decide", seq, view: serializeView(viewRef, deps.caps) });
  };

  const controller: AgentController = (view, act) => {
    viewRef = view;
    actRef = act;
    if (pending) {
      const cmd = pending;
      pending = null;
      return cmd;
    }
    if (ready && !awaiting) requestDecision();
    return null; // yield; a later tick picks up the worker's reply
  };

  const applyTarget = (cmd: AgentCommand): boolean => {
    if (!actRef) return false;
    const args = (cmd.args ?? {}) as Record<string, number>;
    if (cmd.code === TARGET_MONSTER_CODE) {
      actRef.setTargetMonster(args["midx"] ?? 0);
      return true;
    }
    if (cmd.code === TARGET_LOCATION_CODE) {
      actRef.setTargetLocation(args["x"] ?? 0, args["y"] ?? 0);
      return true;
    }
    return false;
  };

  const receive = (msg: WorkerToHost): void => {
    switch (msg.type) {
      case "ready":
        ready = true;
        deps.onReady?.();
        return;
      case "log":
        deps.onLog?.(msg.level, msg.message);
        return;
      case "error":
        deps.onError?.(msg.phase, msg.message);
        return;
      case "command": {
        if (msg.seq !== seq) return; // stale reply from a superseded request
        awaiting = false;
        const cmd = msg.command;
        if (cmd && applyTarget(cmd)) {
          // A targeting action took effect on live state; ask again for a real
          // command without surfacing the reserved code to the game loop.
          requestDecision();
          return;
        }
        pending = cmd;
        return;
      }
    }
  };

  const start = (): void => {
    deps.post({
      type: "init",
      protocolVersion: SANDBOX_PROTOCOL_VERSION,
      pluginUrl: deps.pluginUrl,
      capabilities: deps.capabilityStrings,
    });
  };

  return { controller, receive, isReady: () => ready, start };
}

/** A minimal Worker shape the host uses (a real DOM Worker satisfies it). */
export interface WorkerLike {
  postMessage(msg: HostToWorker): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  terminate(): void;
}

/** Options for installing a sandboxed controller. */
export interface SandboxInstallOptions {
  caps: AgentCapabilities;
  /** The exact capability strings from the manifest (forwarded to the worker). */
  capabilityStrings: string[];
  pluginUrl: string;
  viewDeps?: import("@neo-angband/core").AgentViewDeps;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  onError?: (phase: "init" | "decide", message: string) => void;
  onReady?: () => void;
}

/** A live sandboxed agent: its controller session plus a teardown. */
export interface SandboxSession {
  session: AgentSession;
  bridge: SandboxBridge;
  uninstall: () => void;
}

/**
 * Wire a real Worker to a fresh bridge and install its controller into `state`.
 * The worker must be a module worker whose plugin registered via definePlugin
 * and called runWorkerRuntime(self).
 */
export function installSandboxedController(
  state: GameState,
  worker: WorkerLike,
  opts: SandboxInstallOptions,
): SandboxSession {
  const bridge = createSandboxBridge({
    post: (msg) => worker.postMessage(msg),
    caps: opts.caps,
    capabilityStrings: opts.capabilityStrings,
    pluginUrl: opts.pluginUrl,
    ...(opts.onLog ? { onLog: opts.onLog } : {}),
    ...(opts.onError ? { onError: opts.onError } : {}),
    ...(opts.onReady ? { onReady: opts.onReady } : {}),
  });

  worker.onmessage = (ev): void => bridge.receive(ev.data);

  const session = installController(state, bridge.controller, {
    capabilities: opts.caps,
    ...(opts.viewDeps ? { viewDeps: opts.viewDeps } : {}),
  });

  bridge.start();

  return {
    session,
    bridge,
    uninstall: (): void => {
      try {
        worker.postMessage({ type: "teardown" });
      } catch {
        /* worker may already be gone */
      }
      worker.terminate();
      session.uninstall();
    },
  };
}
