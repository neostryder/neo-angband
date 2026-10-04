/** Host-owned module Worker bootstrap for the API-2 ordinary-plugin ABI. */

import {
  MOD_WORKER_PROTOCOL_VERSION,
  type HostReply,
  type HostToModWorker,
  type ModWorkerToHost,
  type WorkerInitSnapshot,
  type WorkerJson,
  type WorkerLogLevel,
  type ModWorkerPanel,
  type ModWorkerPanelPatch,
  type ModStateSnapshot,
} from "./protocol";
import type { RegionCell } from "./transport";
import type { ModDisplaySnapshot } from "../mod-plugin";

export interface ModWorkerApi {
  readonly init: WorkerInitSnapshot;
  log(level: WorkerLogLevel, message: string): void;
  prefs: { get(): Promise<WorkerJson | null>; set(value: WorkerJson | null): Promise<void> };
  assets: { read(path: string): Promise<Uint8Array | null> };
  events: { subscribe(topic: "state.snapshot", listener: (model: ModStateSnapshot) => void): Promise<string>; subscribe(topic: "display.snapshot", listener: (model: ModDisplaySnapshot) => void): Promise<string>; onSnapshotInvalidated(listener: (event: { readonly domain: string; readonly revision: number }) => void): Promise<string> };
  query: { snapshot(domain: "engine.facts", selector: WorkerJson, revision?: number): Promise<{ readonly revision: number; readonly data: WorkerJson }> };
  policies: { install(policy: "object-list.order-v1", revision: number, body: { readonly keys: readonly ("dy" | "dx")[] }): Promise<void> };
  registry: { declare(kind: "command", id: string, definition: { readonly id: string; readonly verb: string; readonly input: "none" | "direction"; readonly intentCodes: readonly string[] }): Promise<void>; revoke(kind: "command", id: string): Promise<void> };
  regions: { declare(region: { readonly id: string; readonly layer: "hud" | "overlay"; readonly placement: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly inputActions: readonly string[] }): Promise<void>; patch(id: string, cells: readonly RegionCell[], visible?: boolean): Promise<void> };
  commands: { submit(code: string, args: WorkerJson): Promise<WorkerJson | null> };
  ui: {
    mount(panel: ModWorkerPanel): Promise<WorkerJson | null>;
    patch(panelId: string, patch: ModWorkerPanelPatch): Promise<WorkerJson | null>;
    onAction(listener: (event: { readonly panelId: string; readonly action: string }) => void): () => void;
  };
}

export interface ModWorkerModule {
  default?(api: ModWorkerApi): void | Promise<void>;
  migrateBag?(data: WorkerJson, fromSchema: number): WorkerJson | Promise<WorkerJson>;
  hooks?: { artifactCommit?(input: { readonly artifactIndex: number; readonly alreadyCreated: boolean }): { readonly decision: "allow" | "deny"; readonly patch?: WorkerJson } | Promise<{ readonly decision: "allow" | "deny"; readonly patch?: WorkerJson }> };
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<HostToModWorker | HostReply>) => void) | null;
  postMessage(message: ModWorkerToHost): void;
}

export function installModWorkerBootstrap(scope: WorkerScope): void {
  let id: string | null = null;
  let plugin: ModWorkerModule | null = null;
  let nextRequest = 0;
  const pending = new Map<number, { resolve(value: WorkerJson | Uint8Array | null): void; reject(reason: Error): void }>();
  const listeners = new Map<string, (model: WorkerJson) => void>();
  const invalidationListeners = new Map<string, (event: { readonly domain: string; readonly revision: number }) => void>();
  const uiListeners = new Set<(event: { readonly panelId: string; readonly action: string }) => void>();

  const send = (message: Record<string, unknown>): void => {
    if (!id) return;
    scope.postMessage({ ...message, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: id } as ModWorkerToHost);
  };
  const request = <T extends WorkerJson | Uint8Array | null>(message: Record<string, unknown>): Promise<T> => {
    nextRequest += 1;
    const requestId = nextRequest;
    send({ ...message, requestId });
    return new Promise<T>((resolve, reject) => pending.set(requestId, { resolve: resolve as (value: WorkerJson | Uint8Array | null) => void, reject }));
  };

  scope.onmessage = (event): void => {
    const message = event.data;
    if (message.type === "reply") {
      const pendingRequest = pending.get(message.requestId);
      if (!pendingRequest) return;
      pending.delete(message.requestId);
      if (message.ok) pendingRequest.resolve(message.value);
      else pendingRequest.reject(new Error(message.error));
      return;
    }
    if (message.type === "event.model") {
      listeners.get(message.subscriptionId)?.(message.model);
      return;
    }
    if (message.type === "event.snapshotInvalidated") {
      invalidationListeners.get(message.subscriptionId)?.({ domain: message.domain, revision: message.revision });
      return;
    }
    if (message.type === "hook.request") {
      void answerHook(message);
      return;
    }
    if (message.type === "ui.action") {
      for (const listener of uiListeners) listener({ panelId: message.panelId, action: message.action });
      return;
    }
    if (message.type === "migrateBag") {
      void migrate(message);
      return;
    }
    if (message.type === "teardown") {
      send({ type: "teardown.ack" });
      return;
    }
    if (message.type === "init") void boot(message);
  };

  const migrate = async (message: Extract<HostToModWorker, { type: "migrateBag" }>): Promise<void> => {
    try {
      if (!plugin?.migrateBag) throw new Error("worker module has no migrateBag export");
      send({ type: "migrateBag.result", requestId: message.requestId, data: await plugin.migrateBag(message.data, message.fromSchema) });
    } catch (err) {
      /* A failed migrator deliberately has no data result. The host keeps the old bag. */
      send({ type: "migrateBag.error", requestId: message.requestId, error: err instanceof Error ? err.message : String(err) });
    }
  };
  const answerHook = async (message: Extract<HostToModWorker, { type: "hook.request" }>): Promise<void> => {
    try {
      const input = message.input as { artifactIndex?: unknown; alreadyCreated?: unknown };
      if (message.hook !== "artifact.commit" || typeof input.artifactIndex !== "number" || !Number.isInteger(input.artifactIndex) || typeof input.alreadyCreated !== "boolean") throw new Error("unsupported hook request");
      const result = await plugin?.hooks?.artifactCommit?.({ artifactIndex: input.artifactIndex, alreadyCreated: input.alreadyCreated }) ?? { decision: "allow" as const };
      if (result.decision !== "allow" && result.decision !== "deny") throw new Error("invalid hook decision");
      send({ type: "hook.result", requestId: message.requestId, sequence: message.sequence, decision: result.decision, ...(result.patch === undefined ? {} : { patch: result.patch }) });
    } catch (_err) {
      send({ type: "hook.result", requestId: message.requestId, sequence: message.sequence, decision: "allow" });
    }
  };
  const boot = async (message: Extract<HostToModWorker, { type: "init" }>): Promise<void> => {
    if (id !== null || message.protocolVersion !== MOD_WORKER_PROTOCOL_VERSION || message.snapshot.id !== message.pluginId) return;
    id = message.pluginId;
    try {
      plugin = (await import(/* @vite-ignore */ message.entryUrl)) as ModWorkerModule;
      const api: ModWorkerApi = {
        init: immutableSnapshot(message.snapshot),
        log: (level, text): void => send({ type: "log", level, message: String(text) }),
        prefs: {
          get: (): Promise<WorkerJson | null> => request({ type: "prefs.get" }),
          set: async (value): Promise<void> => { await request({ type: "prefs.set", value }); },
        },
        assets: { read: (path): Promise<Uint8Array | null> => request({ type: "asset.read", path }) },
        events: {
          subscribe: async (topic, listener): Promise<string> => {
            const subscriptionId = await request<string>({ type: "event.subscribe", topic });
            listeners.set(subscriptionId, listener as unknown as (model: WorkerJson) => void);
            return subscriptionId;
          },
          onSnapshotInvalidated: async (listener): Promise<string> => {
            const subscriptionId = await request<string>({ type: "event.subscribe", topic: "snapshot.invalidated" });
            invalidationListeners.set(subscriptionId, listener);
            return subscriptionId;
          },
        },
        query: { snapshot: (domain, selector, revision): Promise<{ readonly revision: number; readonly data: WorkerJson }> => request({ type: "query.snapshot", domain, selector, ...(revision === undefined ? {} : { revision }) }) },
        policies: { install: async (policy, revision, body): Promise<void> => { await request({ type: "policy.install", policy, revision, body }); } },
        registry: {
          declare: async (kind, declarationId, definition): Promise<void> => { await request({ type: "registry.declare", kind, id: declarationId, definition }); },
          revoke: async (kind, declarationId): Promise<void> => { await request({ type: "registry.revoke", kind, id: declarationId }); },
        },
        regions: {
          declare: async (region): Promise<void> => { await request({ type: "ui.region.declare", ...region }); },
          patch: async (regionId, cells, visible): Promise<void> => { await request({ type: "ui.region.patch", id: regionId, cells, ...(visible === undefined ? {} : { visible }) }); },
        },
        commands: { submit: (code, args): Promise<WorkerJson | null> => request({ type: "command.submit", code, args }) },
        ui: {
          mount: (panel): Promise<WorkerJson | null> => request({ type: "ui.mount", panel }),
          patch: (panelId, patch): Promise<WorkerJson | null> => request({ type: "ui.patch", panelId, patch }),
          onAction: (listener): (() => void) => {
            uiListeners.add(listener);
            return () => uiListeners.delete(listener);
          },
        },
      };
      await plugin.default?.(api);
      send({ type: "ready", hasMigrateBag: typeof plugin.migrateBag === "function" });
    } catch (err) {
      send({ type: "log", level: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };
}

if (typeof self !== "undefined") installModWorkerBootstrap(self as unknown as WorkerScope);

/** The Worker may retain its copy, but API-2 init data is immutable by contract. */
function immutableSnapshot(snapshot: WorkerInitSnapshot): WorkerInitSnapshot {
  const freeze = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      for (const item of value) freeze(item);
      return Object.freeze(value);
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) freeze(item);
      return Object.freeze(value);
    }
    return value;
  };
  return freeze(snapshot) as WorkerInitSnapshot;
}
