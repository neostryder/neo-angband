import { cloneWorkerJson, payloadBytes } from "./clone";
import {
  MOD_WORKER_PROTOCOL_VERSION,
  type HostReply,
  type HostToModWorker,
  type ModWorkerToHost,
  type WorkerInitSnapshot,
  type WorkerJson,
  type WorkerLogLevel,
} from "./protocol";
import { panelDescription, panelId as validPanelId, panelPatch } from "./panel-schema";
import { isSnapshotDomain, ModWorkerTransport } from "./transport";

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_REQUESTS_PER_MINUTE = 60;

export interface ModWorkerLike {
  postMessage(message: HostToModWorker | HostReply): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface ModWorkerHostDeps {
  readonly id: string;
  readonly capabilities: readonly string[];
  readonly snapshot: WorkerInitSnapshot;
  readonly entryUrl: string;
  readonly prefs: { get(): unknown; set(value: unknown): void };
  readonly readAsset: (path: string) => Promise<Uint8Array | null>;
  readonly onLog?: (level: WorkerLogLevel, message: string) => void;
  /** Read a fresh cloned model after a capability-checked subscription begins. */
  readonly modelForTopic?: (topic: ModWorkerTopic) => unknown;
  readonly onCommand?: (code: string, args: WorkerJson) => Promise<WorkerJson | null>;
  readonly onSubscribe?: (subscriptionId: string, topic: ModWorkerTopic) => void;
  readonly onUi?: (operation: "mount" | "patch", payload: WorkerJson, panelId?: string) => Promise<WorkerJson | null>;
  readonly onTeardown?: () => void;
  readonly onProblem?: (message: string) => void;
  /** Shared per-game API-2 cache. It owns policies, declarations and regions. */
  readonly transport?: ModWorkerTransport;
  /** The resolved plugin load position, used by the same folds as ModHooks. */
  readonly loadOrder?: number;
}

export interface StartedModWorker {
  readonly ready: Promise<void>;
  canMigrateBag(): boolean;
  migrateBag(data: unknown, fromSchema: number): Promise<WorkerJson>;
  publishModel(subscriptionId: string, model: unknown): void;
  publishUiAction(panelId: string, action: string): void;
  publishSnapshotInvalidated(domain: string, revision: number): void;
  teardown(): void;
}

type Lifecycle = "starting" | "ready" | "tearing-down" | "stopped";
export type ModWorkerTopic = "state.snapshot" | "display.snapshot" | "snapshot.invalidated";

/**
 * Host-side API-2 broker. It owns every live service and rejects malformed,
 * over-sized, unauthorised, stale, or cross-plugin messages before acting.
 */
export function startModWorker(worker: ModWorkerLike, deps: ModWorkerHostDeps): StartedModWorker {
  const granted = new Set(deps.capabilities);
  let state: Lifecycle = "starting";
  let requestId = 0;
  let subscriptionId = 0;
  let hasMigrateBag = false;
  const subscriptions = new Map<string, ModWorkerTopic>();
  const pendingMigrations = new Map<number, { resolve(value: WorkerJson): void; reject(reason: Error): void; timeout: ReturnType<typeof setTimeout> }>();
  const pendingHooks = new Map<number, { sequence: number; resolve(value: { decision: "allow" | "deny"; patch?: WorkerJson }): void }>();
  const transport = deps.transport ?? new ModWorkerTransport({ onProblem: (pluginId, message) => deps.onProblem?.(`${pluginId}: ${message}`) });
  const requestTimes: number[] = [];
  let resolveReady: () => void = () => undefined;
  let rejectReady: (reason: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const fail = (message: string): void => {
    deps.onProblem?.(message);
  };
  const post = (message: HostToModWorker | HostReply): void => {
    try {
      worker.postMessage(message);
    } catch (err) {
      fail(`worker post failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const reply = (id: number, result: WorkerJson | Uint8Array | null | Error): void => {
    if (result instanceof Error) {
      post({ type: "reply", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: deps.id, requestId: id, ok: false, error: result.message });
      return;
    }
    post({ type: "reply", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: deps.id, requestId: id, ok: true, value: result });
  };
  const postModel = (subscriptionId: string, model: unknown): void => {
    try { post({ type: "event.model", pluginId: deps.id, subscriptionId, model: cloneWorkerJson(model) }); } catch (err) { fail(asError(err).message); }
  };
  const allowed = (capability: string): boolean => granted.has(capability) || granted.has("*");
  const admit = (message: unknown): ModWorkerToHost | null => {
    try {
      cloneWorkerJson(message);
    } catch (err) {
      fail(`refused worker payload: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    if (payloadBytes(message) > MAX_MESSAGE_BYTES) {
      fail(`refused worker payload larger than ${MAX_MESSAGE_BYTES} bytes`);
      return null;
    }
    if (!isWorkerMessage(message)) {
      fail("refused malformed worker message");
      return null;
    }
    if (message.protocolVersion !== MOD_WORKER_PROTOCOL_VERSION || message.pluginId !== deps.id) {
      fail("refused worker message with wrong protocol version or plugin id");
      return null;
    }
    if (state === "stopped" || (state === "tearing-down" && message.type !== "teardown.ack")) {
      fail("refused worker message outside its lifecycle");
      return null;
    }
    const now = Date.now();
    while (requestTimes[0] !== undefined && requestTimes[0] < now - 60_000) requestTimes.shift();
    if (message.type !== "ready" && message.type !== "teardown.ack") {
      if (requestTimes.length >= MAX_REQUESTS_PER_MINUTE) {
        fail("refused worker request rate above 60 per minute");
        return null;
      }
      requestTimes.push(now);
    }
    return message;
  };

  const receive = async (raw: unknown): Promise<void> => {
    const message = admit(raw);
    if (!message) return;
    if (message.type === "ready") {
      if (state !== "starting") return fail("refused duplicate worker ready");
      if (typeof message.hasMigrateBag !== "boolean") return fail("refused malformed worker ready");
      hasMigrateBag = message.hasMigrateBag;
      state = "ready";
      resolveReady();
      return;
    }
    if (message.type === "teardown.ack") return;
    /* A module may await prefs, assets, or subscriptions from its default export
     * before it can truthfully send ready. Starting is therefore a live broker
     * state, while bag migration still begins only after ready below. */
    if (message.type === "log") {
      if (message.message.length > 4096) return fail("refused worker log longer than 4096 characters");
      deps.onLog?.(message.level, message.message);
      return;
    }
    if (message.type === "migrateBag.result") {
      const pending = pendingMigrations.get(message.requestId);
      if (!pending) return fail("refused unknown migrateBag reply");
      pendingMigrations.delete(message.requestId);
      clearTimeout(pending.timeout);
      try {
        pending.resolve(cloneWorkerJson(message.data));
      } catch (err) {
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    if (message.type === "migrateBag.error") {
      const pending = pendingMigrations.get(message.requestId);
      if (!pending) return fail("refused unknown migrateBag error");
      pendingMigrations.delete(message.requestId);
      clearTimeout(pending.timeout);
      pending.reject(new Error(message.error));
      return;
    }
    if (message.type === "hook.result") {
      const pending = pendingHooks.get(message.requestId);
      if (!pending || pending.sequence !== message.sequence) return fail("refused unknown hook result");
      pendingHooks.delete(message.requestId);
      pending.resolve(message.patch === undefined ? { decision: message.decision } : { decision: message.decision, patch: cloneWorkerJson(message.patch) });
      return;
    }
    if (message.type === "prefs.get") {
      if (!allowed("prefs:read")) return reply(message.requestId, new Error("prefs:read capability required"));
      try { reply(message.requestId, cloneWorkerJson(deps.prefs.get())); } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "prefs.set") {
      if (!allowed("prefs:write")) return reply(message.requestId, new Error("prefs:write capability required"));
      try { deps.prefs.set(message.value); reply(message.requestId, null); } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "asset.read") {
      if (!allowed("asset:read") || !validPath(message.path)) return reply(message.requestId, new Error("asset.read requires asset:read and an own relative path"));
      try { reply(message.requestId, await deps.readAsset(message.path)); } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "event.subscribe") {
      if ((!allowed("state:model.read") && !(message.topic === "snapshot.invalidated" && allowed("query:snapshot"))) || !validTopic(message.topic)) return reply(message.requestId, new Error("event.subscribe requires its read capability and a declared topic"));
      subscriptionId += 1;
      const id = `subscription-${String(subscriptionId)}`;
      subscriptions.set(id, message.topic);
      try {
        deps.onSubscribe?.(id, message.topic);
        reply(message.requestId, id);
        /* postMessage ordering keeps this after the reply that installs the
         * listener in bootstrap.ts, so the initial model cannot race it. */
        if (deps.modelForTopic) postModel(id, deps.modelForTopic(message.topic));
        return;
      } catch (err) {
        subscriptions.delete(id);
        return reply(message.requestId, asError(err));
      }
    }
    if (message.type === "query.snapshot") {
      if (!allowed("query:snapshot")) return reply(message.requestId, new Error("query:snapshot capability required"));
      try { reply(message.requestId, transport.snapshot(message.domain, message.revision, message.selector)); } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "policy.install") {
      if (!allowed("policy:install")) return reply(message.requestId, new Error("policy:install capability required"));
      try { transport.installPolicy(deps.id, deps.loadOrder ?? 0, message.policy, message.revision, message.body); reply(message.requestId, null); } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "registry.declare" || message.type === "registry.revoke") {
      if (!allowed("registry:declare")) return reply(message.requestId, new Error("registry:declare capability required"));
      try {
        if (message.type === "registry.declare") transport.declare(deps.id, message.kind, message.id, message.definition);
        else transport.revoke(deps.id, message.kind, message.id);
        reply(message.requestId, null);
      } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "ui.region.declare" || message.type === "ui.region.patch") {
      if (!allowed("ui:region")) return reply(message.requestId, new Error("ui:region capability required"));
      try {
        if (message.type === "ui.region.declare") transport.declareRegion(deps.id, { id: message.id, layer: message.layer, placement: message.placement, inputActions: message.inputActions });
        else transport.patchRegion(deps.id, message.id, { cells: message.cells, ...(message.visible === undefined ? {} : { visible: message.visible }) });
        reply(message.requestId, null);
      } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "command.submit") {
      if (!allowed("command:submit") || !validCode(message.code)) return reply(message.requestId, new Error("command.submit requires command:submit and a semantic code"));
      try { reply(message.requestId, (await deps.onCommand?.(message.code, message.args)) ?? null); } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "ui.mount" || message.type === "ui.patch") {
      if (!allowed("ui:panel") || (message.type === "ui.patch" && !validId(message.panelId))) return reply(message.requestId, new Error("host-owned UI requires ui:panel and a valid panel id"));
      const payload = message.type === "ui.mount" ? message.panel : message.patch;
      if (message.type === "ui.mount" ? !panelDescription(payload) : !panelPatch(payload)) {
        return reply(message.requestId, new Error("host-owned UI needs a declared panel grammar"));
      }
      try { reply(message.requestId, (await deps.onUi?.(message.type === "ui.mount" ? "mount" : "patch", payload, message.type === "ui.patch" ? message.panelId : undefined)) ?? null); } catch (err) { reply(message.requestId, asError(err)); }
    }
  };

  worker.onmessage = (event): void => { void receive(event.data); };
  transport.addHookPeer({
    pluginId: deps.id,
    loadOrder: deps.loadOrder ?? 0,
    request: (hook, sequence, input) => new Promise((resolve, reject) => {
      if (!allowed("hook:respond") || state !== "ready") return resolve({ decision: "allow" });
      requestId += 1;
      pendingHooks.set(requestId, { sequence, resolve });
      try { post({ type: "hook.request", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: deps.id, requestId, hook, sequence, input: cloneWorkerJson(input) }); } catch (err) { pendingHooks.delete(requestId); reject(asError(err)); }
    }),
  });
  worker.onerror = (event): void => {
    const error = new Error(event.message || "worker failed");
    if (state === "starting") rejectReady(error);
    fail(error.message);
  };
  post({ type: "init", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: deps.id, entryUrl: deps.entryUrl, snapshot: cloneSnapshot(deps.snapshot) });

  return {
    ready,
    canMigrateBag: (): boolean => hasMigrateBag,
    migrateBag(data: unknown, fromSchema: number): Promise<WorkerJson> {
      if (state !== "ready") return Promise.reject(new Error("worker is not ready to migrate its bag"));
      if (!Number.isInteger(fromSchema) || fromSchema < 0) return Promise.reject(new Error("bag schema must be a non-negative integer"));
      const cloned = cloneWorkerJson(data);
      requestId += 1;
      return new Promise<WorkerJson>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingMigrations.delete(requestId);
          reject(new Error("worker bag migration timed out"));
        }, 5000);
        pendingMigrations.set(requestId, { resolve, reject, timeout });
        post({ type: "migrateBag", requestId, pluginId: deps.id, data: cloned, fromSchema });
      });
    },
    publishModel(subscriptionId: string, model: unknown): void {
      if (state !== "ready" || !subscriptions.has(subscriptionId)) return;
      postModel(subscriptionId, model);
    },
    publishUiAction(panelId: string, action: string): void {
      if (state !== "ready" || !allowed("ui:panel") || !validPanelId(panelId) || !validPanelId(action)) return;
      post({ type: "ui.action", pluginId: deps.id, panelId, action });
    },
    publishSnapshotInvalidated(domain: string, revision: number): void {
      if (state !== "ready" || !allowed("query:snapshot") || !isSnapshotDomain(domain) || !Number.isInteger(revision) || revision < 0) return;
      for (const [id, topic] of subscriptions) if (topic === "snapshot.invalidated") post({ type: "event.snapshotInvalidated", pluginId: deps.id, subscriptionId: id, domain, revision });
    },
    teardown(): void {
      if (state === "stopped" || state === "tearing-down") return;
      state = "tearing-down";
      post({ type: "teardown", pluginId: deps.id });
      worker.terminate();
      state = "stopped";
      for (const pending of pendingMigrations.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("worker stopped during bag migration"));
      }
      pendingMigrations.clear();
      for (const pending of pendingHooks.values()) pending.resolve({ decision: "allow" });
      pendingHooks.clear();
      subscriptions.clear();
      transport.removePlugin(deps.id);
      deps.onTeardown?.();
    },
  };
}

function cloneSnapshot(snapshot: WorkerInitSnapshot): WorkerInitSnapshot {
  return cloneWorkerJson(snapshot) as unknown as WorkerInitSnapshot;
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
function validId(value: string): boolean { return /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function validPath(value: string): boolean { return value.length > 0 && value.length <= 256 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === ".."); }
function validTopic(value: string): value is ModWorkerTopic { return value === "state.snapshot" || value === "display.snapshot" || value === "snapshot.invalidated"; }
function validCode(value: string): boolean { return /^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})+$/.test(value); }
function isWorkerMessage(value: unknown): value is ModWorkerToHost {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (typeof message["type"] !== "string" || typeof message["protocolVersion"] !== "string" || typeof message["pluginId"] !== "string") return false;
  const request = (): boolean => Number.isSafeInteger(message["requestId"]) && (message["requestId"] as number) > 0;
  switch (message["type"]) {
    case "ready": return typeof message["hasMigrateBag"] === "boolean";
    case "teardown.ack": return true;
    case "log": return (message["level"] === "info" || message["level"] === "warn" || message["level"] === "error") && typeof message["message"] === "string";
    case "prefs.get": return request();
    case "prefs.set": return request() && (message["value"] === null || message["value"] !== undefined);
    case "asset.read": return request() && typeof message["path"] === "string";
    case "event.subscribe": return request() && typeof message["topic"] === "string";
    case "query.snapshot": return request() && typeof message["domain"] === "string" && message["selector"] !== undefined && (message["revision"] === undefined || (Number.isInteger(message["revision"]) && (message["revision"] as number) >= 0));
    case "policy.install": return request() && typeof message["policy"] === "string" && Number.isInteger(message["revision"]) && message["body"] !== undefined;
    case "hook.result": return request() && Number.isInteger(message["sequence"]) && (message["decision"] === "allow" || message["decision"] === "deny") && (message["patch"] === undefined || message["patch"] !== undefined);
    case "registry.declare": return request() && typeof message["kind"] === "string" && typeof message["id"] === "string" && message["definition"] !== undefined;
    case "registry.revoke": return request() && typeof message["kind"] === "string" && typeof message["id"] === "string";
    case "ui.region.declare": return request() && typeof message["id"] === "string" && typeof message["layer"] === "string" && message["placement"] !== undefined && message["inputActions"] !== undefined;
    case "ui.region.patch": return request() && typeof message["id"] === "string" && message["cells"] !== undefined && (message["visible"] === undefined || typeof message["visible"] === "boolean");
    case "command.submit": return request() && typeof message["code"] === "string" && message["args"] !== undefined;
    case "ui.mount": return request() && message["panel"] !== undefined;
    case "ui.patch": return request() && typeof message["panelId"] === "string" && message["patch"] !== undefined;
    case "migrateBag.result": return request() && message["data"] !== undefined;
    case "migrateBag.error": return request() && typeof message["error"] === "string";
    default: return false;
  }
}
