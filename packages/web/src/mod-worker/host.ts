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
  readonly onCommand?: (code: string, args: WorkerJson) => Promise<WorkerJson | null>;
  readonly onUi?: (operation: "mount" | "patch", payload: WorkerJson) => Promise<WorkerJson | null>;
  readonly onProblem?: (message: string) => void;
}

export interface StartedModWorker {
  readonly ready: Promise<void>;
  canMigrateBag(): boolean;
  migrateBag(data: unknown, fromSchema: number): Promise<WorkerJson>;
  publishModel(subscriptionId: string, model: unknown): void;
  teardown(): void;
}

type Lifecycle = "starting" | "ready" | "tearing-down" | "stopped";

/**
 * Host-side API-2 broker. It owns every live service and rejects malformed,
 * over-sized, unauthorised, stale, or cross-plugin messages before acting.
 */
export function startModWorker(worker: ModWorkerLike, deps: ModWorkerHostDeps): StartedModWorker {
  const granted = new Set(deps.capabilities);
  let state: Lifecycle = "starting";
  let requestId = 0;
  let hasMigrateBag = false;
  const pendingMigrations = new Map<number, { resolve(value: WorkerJson): void; reject(reason: Error): void; timeout: ReturnType<typeof setTimeout> }>();
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
    if (state !== "ready") return fail("refused worker request before ready");
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
      if (!allowed("state:model.read") || !validTopic(message.topic)) return reply(message.requestId, new Error("event.subscribe requires state:model.read and a declared topic"));
      return reply(message.requestId, message.topic);
    }
    if (message.type === "command.submit") {
      if (!allowed("command:submit") || !validCode(message.code)) return reply(message.requestId, new Error("command.submit requires command:submit and a semantic code"));
      try { reply(message.requestId, (await deps.onCommand?.(message.code, message.args)) ?? null); } catch (err) { reply(message.requestId, asError(err)); }
      return;
    }
    if (message.type === "ui.mount" || message.type === "ui.patch") {
      if (!allowed("ui:panel") || (message.type === "ui.patch" && !validId(message.panelId))) return reply(message.requestId, new Error("host-owned UI requires ui:panel and a valid panel id"));
      try { reply(message.requestId, (await deps.onUi?.(message.type === "ui.mount" ? "mount" : "patch", message.type === "ui.mount" ? message.panel : message.patch)) ?? null); } catch (err) { reply(message.requestId, asError(err)); }
    }
  };

  worker.onmessage = (event): void => { void receive(event.data); };
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
      if (state !== "ready" || !validId(subscriptionId)) return;
      try { post({ type: "event.model", pluginId: deps.id, subscriptionId, model: cloneWorkerJson(model) }); } catch (err) { fail(asError(err).message); }
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
    },
  };
}

function cloneSnapshot(snapshot: WorkerInitSnapshot): WorkerInitSnapshot {
  return cloneWorkerJson(snapshot) as unknown as WorkerInitSnapshot;
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
function validId(value: string): boolean { return /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function validPath(value: string): boolean { return value.length > 0 && value.length <= 256 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === ".."); }
function validTopic(value: string): boolean { return value === "state.snapshot" || value === "display.snapshot"; }
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
    case "command.submit": return request() && typeof message["code"] === "string" && message["args"] !== undefined;
    case "ui.mount": return request() && message["panel"] !== undefined;
    case "ui.patch": return request() && typeof message["panelId"] === "string" && message["patch"] !== undefined;
    case "migrateBag.result": return request() && message["data"] !== undefined;
    case "migrateBag.error": return request() && typeof message["error"] === "string";
    default: return false;
  }
}
