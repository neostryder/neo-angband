/**
 * The worker-side runtime for scripted plugins (MOD_INTEGRATION_PLAN.md Wave 2,
 * W2.1). This module runs INSIDE the Web Worker. A plugin is a module worker
 * that imports this runtime first, registers itself with `definePlugin`, then
 * calls `runWorkerRuntime(self)`:
 *
 *   import { definePlugin, runWorkerRuntime } from ".../worker-runtime";
 *   definePlugin({ decide(view, act) { ... return act.move(6); } });
 *   runWorkerRuntime(self);
 *
 * The plugin decides against the SAME perceive/act shape an in-process
 * controller uses (core/agent/types.ts): `view` is an AgentView reconstructed
 * from the host's capability-gated ViewSnapshot, and `act` builds plain
 * AgentCommands. The only boundary-imposed difference is targeting: across a
 * thread you cannot get a synchronous boolean back, so act.setTargetMonster /
 * setTargetLocation return a reserved command the host applies against target.c
 * before asking the plugin to decide again (see host.ts).
 *
 * Network egress is neutered as an import side effect (below), before any
 * plugin code runs, and only restored on init if the plugin holds "network:*".
 * A specific-host grant fails closed for now (a per-host fetch broker is a Wave
 * 2 follow-up); game-state isolation - the primary property - is absolute
 * regardless, since a worker cannot reach GameState at all.
 */

import type {
  AgentCommand,
  AgentView,
  CellView,
  GameConstants,
  ItemView,
  MonsterView,
  PlayerView,
  SpellbookView,
  StoreView,
  TargetView,
} from "@neo-angband/core";
import { AGENT_API_VERSION } from "@neo-angband/core";
import type { HostToWorker, ViewSnapshot, WorkerToHost } from "./protocol";
import {
  SANDBOX_PROTOCOL_VERSION,
  TARGET_LOCATION_CODE,
  TARGET_MONSTER_CODE,
} from "./protocol";

/* ------------------------------------------------------------------ *
 * Network neutering (import side effect: runs before any plugin body).
 * ------------------------------------------------------------------ */

interface NetworkGlobals {
  fetch?: unknown;
  XMLHttpRequest?: unknown;
  WebSocket?: unknown;
  importScripts?: unknown;
}

const NETWORK_KEYS: (keyof NetworkGlobals)[] = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "importScripts",
];

/** Captured originals, removed at import; restored only if network:* granted. */
const capturedNetwork: NetworkGlobals = {};

function neuterNetwork(scope: Record<string, unknown>): void {
  for (const key of NETWORK_KEYS) {
    if (key in scope && !(key in capturedNetwork)) {
      capturedNetwork[key] = scope[key];
      try {
        delete scope[key];
      } catch {
        scope[key] = undefined;
      }
    }
  }
}

function restoreNetwork(scope: Record<string, unknown>): void {
  for (const key of NETWORK_KEYS) {
    if (key in capturedNetwork) scope[key] = capturedNetwork[key];
  }
}

// Remove network globals the instant this module loads - which, per ESM
// evaluation order, is before the importing plugin module's body runs, as long
// as the plugin imports this runtime first (the documented template does).
if (typeof self !== "undefined") {
  neuterNetwork(self as unknown as Record<string, unknown>);
}

/* ------------------------------------------------------------------ *
 * Author-facing plugin surface.
 * ------------------------------------------------------------------ */

/**
 * The act facade inside the sandbox: identical to core's AgentActions except
 * the two targeting verbs return an AgentCommand (a reserved code the host
 * applies), since a cross-thread call cannot return a synchronous result.
 */
export interface SandboxActions
  extends Omit<
    import("@neo-angband/core").AgentActions,
    "setTargetMonster" | "setTargetLocation"
  > {
  setTargetMonster(midx: number): AgentCommand;
  setTargetLocation(x: number, y: number): AgentCommand;
}

/** A scripted plugin: a decide function over the perceive view and act facade. */
export interface SandboxPlugin {
  /** Return the next command, or null to yield control this decision. */
  decide(view: AgentView, act: SandboxActions): AgentCommand | null;
  /** Optional one-time hook after init (capabilities are live). */
  onReady?(): void;
}

let registered: SandboxPlugin | null = null;

/** Register the plugin. Called once at the top of a plugin module. */
export function definePlugin(plugin: SandboxPlugin): void {
  registered = plugin;
}

/* ------------------------------------------------------------------ *
 * View reconstruction from a ViewSnapshot.
 * ------------------------------------------------------------------ */

/** Error thrown when a plugin reads a domain it was not granted. */
export class SandboxCapabilityError extends Error {}

function missing(domain: string): never {
  throw new SandboxCapabilityError(
    `perceive: this plugin lacks "state:${domain}.read"; add it to the manifest`,
  );
}

function unknownCell(x: number, y: number): CellView {
  return {
    x,
    y,
    feat: 0,
    passable: false,
    inView: false,
    known: false,
    monster: 0,
    objectCount: 0,
    glow: false,
    trap: false,
  };
}

/** Reconstruct an AgentView from a snapshot; absent domains throw on read. */
export function snapshotView(snap: ViewSnapshot): AgentView {
  // Index the sparse cells once for O(1) cell() lookup.
  let cellIndex: Map<string, CellView> | null = null;
  const cellsOf = (): Map<string, CellView> => {
    if (cellIndex) return cellIndex;
    cellIndex = new Map();
    for (const c of snap.cells ?? []) cellIndex.set(`${c.x},${c.y}`, c);
    return cellIndex;
  };

  return {
    apiVersion: snap.apiVersion,
    turn: (): number => snap.turn ?? missing("turn"),
    player: (): PlayerView => snap.player ?? missing("player"),
    monsters: (): MonsterView[] => snap.monsters ?? missing("monsters"),
    target: (): TargetView | null =>
      snap.target === undefined ? missing("target") : snap.target,
    messages: (): string[] => snap.messages ?? missing("messages"),
    stores: (): StoreView[] => snap.stores ?? missing("stores"),
    spellbooks: (): SpellbookView[] => snap.spellbooks ?? missing("spells"),
    constants: (): GameConstants => snap.constants ?? missing("constants"),
    inventory: (): ItemView[] => snap.inventory ?? missing("inventory"),
    equipment: (): Array<ItemView | null> =>
      snap.equipment ?? missing("inventory"),
    mapBounds: (): { width: number; height: number } =>
      snap.mapBounds ?? missing("map"),
    cell: (x: number, y: number): CellView | null => {
      const bounds = snap.mapBounds ?? missing("map");
      if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return null;
      return cellsOf().get(`${x},${y}`) ?? unknownCell(x, y);
    },
    floorItems: (x: number, y: number): ItemView[] => {
      if (snap.floor === undefined) missing("floor");
      return snap.floor[`${x},${y}`] ?? [];
    },
  };
}

/* ------------------------------------------------------------------ *
 * The act command builder (pure; mirrors core/agent/act.ts codes).
 * ------------------------------------------------------------------ */

/** Build the sandbox act facade. Verbs return plain AgentCommands. */
export function sandboxActions(): SandboxActions {
  const cmd = (code: string, args?: Record<string, unknown>): AgentCommand =>
    args ? { code, args } : { code };
  const dirCmd = (code: string, dir: number): AgentCommand => ({ code, dir });
  const itemCmd = (code: string, handle: number): AgentCommand =>
    cmd(code, { handle });

  return {
    move: (dir) => dirCmd("walk", dir),
    melee: (dir) => dirCmd("walk", dir),
    hold: () => cmd("hold"),
    rest: () => cmd("rest"),
    descend: () => cmd("descend"),
    ascend: () => cmd("ascend"),
    tunnel: (dir) => dirCmd("tunnel", dir),
    open: (dir) => dirCmd("open", dir),
    close: (dir) => dirCmd("close", dir),
    disarm: (dir) => dirCmd("disarm", dir),

    quaff: (handle) => itemCmd("quaff", handle),
    read: (handle) => itemCmd("read", handle),
    eat: (handle) => itemCmd("eat", handle),
    wear: (handle) => itemCmd("wield", handle),
    takeoff: (handle) => itemCmd("takeoff", handle),
    drop: (handle, number) =>
      cmd("drop", number !== undefined ? { handle, quantity: number } : { handle }),
    pickup: () => cmd("pickup"),
    destroy: (handle) => itemCmd("destroy", handle),
    aimWand: (handle) => itemCmd("aim-wand", handle),
    zapRod: (handle) => itemCmd("zap-rod", handle),
    useStaff: (handle) => itemCmd("use-staff", handle),
    activate: (handle) => itemCmd("activate", handle),

    fire: (handle) => itemCmd("fire", handle),
    throw: (handle) => itemCmd("throw", handle),
    cast: (spell) => cmd("cast", { spell }),

    setTargetMonster: (midx) => cmd(TARGET_MONSTER_CODE, { midx }),
    setTargetLocation: (x, y) => cmd(TARGET_LOCATION_CODE, { x, y }),

    shopBuy: (index, number) =>
      cmd("shop-buy", number !== undefined ? { index, quantity: number } : { index }),
    shopSell: (handle, number) =>
      cmd("shop-sell", number !== undefined ? { handle, quantity: number } : { handle }),
    shopExit: () => cmd("shop-exit"),

    raw: (code, args) => cmd(code, args),
  };
}

/* ------------------------------------------------------------------ *
 * The message handler (pure: injectable transport for tests).
 * ------------------------------------------------------------------ */

/** A minimal poster the runtime writes replies through. */
export type PostFn = (msg: WorkerToHost) => void;

/**
 * Build the runtime's message handler over an injected `post` and worker
 * `scope`. Returns a `handle(msg)` the worker's onmessage forwards to; tests
 * call it directly with a fake poster. Keeps all logic out of the Worker-only
 * plumbing so it is unit-testable in node.
 */
export function createRuntimeHandler(
  post: PostFn,
  scope: Record<string, unknown> = {},
): (msg: HostToWorker) => void {
  const act = sandboxActions();

  return (msg: HostToWorker): void => {
    switch (msg.type) {
      case "init": {
        if (msg.protocolVersion !== SANDBOX_PROTOCOL_VERSION) {
          post({
            type: "error",
            phase: "init",
            message: `protocol mismatch: host ${msg.protocolVersion}, worker ${SANDBOX_PROTOCOL_VERSION}`,
          });
          return;
        }
        // Restore network only for an unrestricted grant; a specific-host grant
        // fails closed until the per-host broker lands (documented above).
        if (msg.capabilities.includes("network:*")) restoreNetwork(scope);
        if (!registered) {
          post({
            type: "error",
            phase: "init",
            message: "no plugin registered; call definePlugin() before runWorkerRuntime()",
          });
          return;
        }
        try {
          registered.onReady?.();
        } catch (err) {
          post({ type: "error", phase: "init", ...errInfo(err) });
          return;
        }
        post({
          type: "ready",
          protocolVersion: SANDBOX_PROTOCOL_VERSION,
          apiVersion: AGENT_API_VERSION,
        });
        return;
      }
      case "decide": {
        if (!registered) {
          post({ type: "error", phase: "decide", message: "no plugin registered" });
          return;
        }
        try {
          const view = snapshotView(msg.view);
          const command = registered.decide(view, act);
          post({ type: "command", seq: msg.seq, command: command ?? null });
        } catch (err) {
          // A buggy plugin must not wedge the loop: report and yield (null).
          post({ type: "error", phase: "decide", ...errInfo(err) });
          post({ type: "command", seq: msg.seq, command: null });
        }
        return;
      }
      case "teardown":
        return;
    }
  };
}

function errInfo(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return err.stack ? { message: err.message, stack: err.stack } : { message: err.message };
  }
  return { message: String(err) };
}

/* ------------------------------------------------------------------ *
 * The Worker entry wiring.
 * ------------------------------------------------------------------ */

/** Minimal worker-global shape this runtime uses (a subset of DedicatedWorkerGlobalScope). */
interface WorkerScope {
  onmessage: ((ev: { data: HostToWorker }) => void) | null;
  postMessage(msg: WorkerToHost): void;
}

/**
 * Wire the runtime into a worker global. Call this once at the top of a plugin
 * module, after definePlugin. It forwards every inbound message to the handler
 * and posts replies back through the worker's postMessage.
 */
export function runWorkerRuntime(scope: WorkerScope): void {
  const handle = createRuntimeHandler(
    (msg) => scope.postMessage(msg),
    scope as unknown as Record<string, unknown>,
  );
  scope.onmessage = (ev): void => handle(ev.data);
}
