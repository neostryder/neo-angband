/**
 * The host side of the Worker broker: it runs a Worker mod's API 2 calls
 * against the same domain implementations an in-process mod uses, and asks the
 * Worker the few things only the mod can answer.
 *
 * - Every call is checked against the protocol's allowlist (WORKER_CALLS),
 *   then served by the `ModApi2` the caller built for this mod, normally
 *   `createApi2Host` over the mod's own context. Grants, known-only data and
 *   `Api2Result` answers are therefore the in-process host's, unchanged.
 * - Grants arrive as a list under their API 2 names. A literal "*" is dropped:
 *   there is no wildcard grant here.
 * - Each served call runs through the health monitor (`run`), so its host time
 *   and its faults are this mod's. Time the Worker takes to answer a question
 *   is response latency, and time its network requests wait is network time;
 *   both are recorded apart from CPU time.
 * - A question (`ask`) has an id, the epoch it was asked in, and a timeout. On
 *   timeout the host takes the neutral answer (the old bag kept, the stored
 *   preferences left as they are) and moves to a new epoch; an answer that
 *   arrives later, or from an epoch the host has left, is dropped and counted.
 * - While the mod runs, the host pings it. A Worker that does not answer a ping
 *   within the stall limit is terminated and switched off, with a switch-off
 *   notice that says it stopped responding.
 * - Secrets never cross: a credential is an opaque reference the Worker names,
 *   and the host's `net` domain puts the value into the request.
 */

import { disposeApi2Host } from "../mod-api2-host";
import {
  API2_HOOK_NAMES,
  CAPABILITY_VOCABULARY,
  CapabilitySet,
  api2PolicyEffects,
  api2NotGranted,
  api2Refused,
  api2Unavailable,
  apiRangeVerdict,
  checkApi2Policies,
  MOD_API2_VERSION,
  type Api2HookName,
  type Api2Hooks,
  type Api2Policies,
  type Api2PolicyRegistrations,
  type Api2Result,
  type JsonValue,
  type ModApi2,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { modHealth } from "../mod-health";
import { cloneWorkerJson, payloadBytes, toWorkerJson } from "./clone";
import {
  MOD_WORKER_PROTOCOL_VERSION,
  WORKER_CALLS,
  type HostToModWorker,
  type ModWorkerToHost,
  type WorkerDefinitionSummary,
  type WorkerJson,
  type WorkerLogLevel,
  type WorkerQuestion,
} from "./protocol";

/** The largest message a Worker may send, in bytes. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Calls a Worker may make in one second before the rest are refused. */
export const MAX_CALLS_PER_SECOND = 200;
/** How long the host waits for an answer before it takes the neutral one. */
export const ASK_TIMEOUT_MS = 3000;
/** How often the host pings a running Worker. */
export const HEARTBEAT_MS = 1000;
/** How long a ping may go unanswered before the Worker is terminated. */
export const STALL_MS = 5000;

const NOTIFY_HOOKS: readonly string[] = ["optionsChanged", "abilityGained", "monsterBecameVisible", "artifactIdentified"];

export interface ModWorkerLike {
  postMessage(message: HostToModWorker): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

/** What the broker adds when it asks the caller for the mod's API. */
export interface WorkerApiOptions {
  readonly install?: { readonly version: number; migrate(value: JsonValue, fromVersion: number): Promise<JsonValue> };
  /** The hooks the mod declared (notifications) and the ones its policies fill. */
  readonly activeHooks: readonly Api2HookName[];
  /** The mod's preference migration, answered by the Worker. Absent when it declares none. */
  readonly prefs?: { readonly version: number; migrate(value: JsonValue, fromVersion: number): Promise<JsonValue> };
}

/** The health monitor's parts the broker uses (modHealth() by default; a test may pass its own). */
export type WorkerHealth = Pick<
  ReturnType<typeof modHealth>,
  "run" | "isOff" | "recordFault" | "recordPayload" | "recordReply" | "recordNetWait" | "recordStale" | "switchOff"
>;

export interface ModWorkerHostDeps {
  readonly id: string;
  /** The entry URL the Worker imports (the staged graph's own name for it). */
  readonly entryUrl: string;
  /** The permissions granted, under their API 2 names. A "*" is dropped. */
  readonly grants: readonly string[];
  /** The mod's flags, for `meta.flags` and the hook context. */
  readonly flags: Readonly<Record<string, boolean>>;
  readonly engine: string;
  readonly newCharacter: boolean;
  /** Whether the mod has a `net` domain. */
  readonly net: boolean;
  /** Build the host-side API for this mod, once, when the Worker is ready. */
  readonly api: (options: WorkerApiOptions) => ModApi2;
  /**
   * Read one of the mod's own files. When present, `content.asset` answers a
   * data: URL of the file's bytes, since the sandbox can fetch nothing.
   */
  readonly readAsset?: (path: string) => Promise<Uint8Array | null>;
  readonly health?: WorkerHealth;
  readonly onLog?: (level: WorkerLogLevel, message: string) => void;
  /** Told of every refused message and every fault the Worker reports. */
  readonly onProblem?: (message: string) => void;
  /** Told, once it is ready, the hooks its policy tables stand for, the notification hooks it declared, and the registrations its tables install. */
  readonly onHooks?: (policyHooks: Api2Hooks, notify: readonly string[], registrations: Api2PolicyRegistrations) => void;
  /** Told after the broker has stopped, for whatever reason. */
  readonly onTeardown?: () => void;
  /** Timing overrides, for tests. */
  readonly timing?: {
    readonly askMs?: number;
    readonly heartbeatMs?: number;
    readonly stallMs?: number;
    readonly maxCallsPerSecond?: number;
  };
}

/** What the broker found in the mod's definition. */
export interface WorkerReady {
  readonly summary: WorkerDefinitionSummary;
  /** The hooks its valid policy tables stand for. */
  readonly policyHooks: readonly Api2HookName[];
}

export interface StartedModWorker {
  /** Settles once the Worker has loaded the mod and the host accepted what it holds. */
  readonly ready: Promise<WorkerReady>;
  canMigrateBag(): boolean;
  /** Ask the Worker to migrate its bag. Rejects on failure or timeout, and the caller keeps the old bag. */
  migrateBag(data: unknown, fromSchema: number): Promise<JsonValue>;
  /** Run the mod's `start` with its API, after any bag migration (the in-process order). */
  start(): void;
  /** Forward a notification hook the mod declared. */
  notify(hook: string, args: readonly unknown[]): void;
  /** Answers the host dropped as stale, so far. */
  staleCount(): number;
  teardown(): void;
}

type Lifecycle = "starting" | "ready" | "running" | "stopped";

interface PendingAsk {
  readonly epoch: number;
  readonly sent: number;
  readonly site: string;
  readonly timeout: ReturnType<typeof setTimeout>;
  resolve(value: WorkerJson): void;
  reject(reason: Error): void;
}

/** Thrown for an ask that was not answered in time. */
export class WorkerTimeoutError extends Error {}

/** Start the broker for one Worker. */
export function startModWorker(worker: ModWorkerLike, deps: ModWorkerHostDeps): StartedModWorker {
  const health = deps.health ?? modHealth();
  const askMs = deps.timing?.askMs ?? ASK_TIMEOUT_MS;
  const heartbeatMs = deps.timing?.heartbeatMs ?? HEARTBEAT_MS;
  const stallMs = deps.timing?.stallMs ?? STALL_MS;
  const maxCalls = deps.timing?.maxCallsPerSecond ?? MAX_CALLS_PER_SECOND;
  const grants = deps.grants.filter((g) => g !== "*" && g !== "engine:access");
  const capabilities = CapabilitySet.fromManifest({
    id: deps.id, name: deps.id, version: "0.0.0", shape: "plugin", capabilities: grants,
  });
  const implied = CAPABILITY_VOCABULARY.filter((entry) => entry.args.length === 0 && capabilities.has(entry.capability))
    .map((entry) => entry.capability);
  const workerGrants = [...new Set([...grants, ...implied])];
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

  let state: Lifecycle = "starting";
  let epoch = 1;
  let nextAsk = 0;
  let stale = 0;
  let summary: WorkerDefinitionSummary | null = null;
  let policyHooks: Api2HookName[] = [];
  let api: ModApi2 | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let pinging = false;
  const asks = new Map<number, PendingAsk>();
  const subscriptions = new Map<number, { readonly id: string }>();
  const keySubscriptions = new Map<number, { readonly id: string }>();
  const backupSubscriptions = new Map<number, { readonly id: string }>();
  const callTimes: number[] = [];

  let resolveReady: (value: WorkerReady) => void = () => undefined;
  let rejectReady: (reason: Error) => void = () => undefined;
  const ready = new Promise<WorkerReady>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  /* A boot that fails is reported through `ready`; nothing else waits on it. */
  ready.catch(() => undefined);

  const problem = (message: string): void => deps.onProblem?.(message);
  const post = (message: HostToModWorker): void => {
    if (state === "stopped") return;
    try {
      worker.postMessage(message);
    } catch (err) {
      problem(`worker post failed: ${messageOf(err)}`);
    }
  };
  const envelope = (): { pluginId: string; epoch: number } => ({ pluginId: deps.id, epoch });

  const ask = (question: WorkerQuestion, site: string): Promise<WorkerJson> => {
    if (state === "stopped") return Promise.reject(new Error("the mod's Worker has stopped"));
    nextAsk += 1;
    const askId = nextAsk;
    const askedIn = epoch;
    return new Promise<WorkerJson>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!asks.delete(askId)) return;
        /* The neutral answer is the caller's: this rejection. Every answer still
         * outstanding from this epoch is superseded with it. */
        supersede();
        reject(new WorkerTimeoutError(`the mod did not answer ${site} within ${String(askMs)} ms`));
      }, askMs);
      asks.set(askId, { epoch: askedIn, sent: now(), site, timeout, resolve, reject });
      post({ type: "ask", ...envelope(), askId, question });
    });
  };

  /* A new epoch. A ping still out belongs to the old one, so it is withdrawn
   * (its answer will be stale) and the next beat sends a fresh one. */
  const supersede = (): void => {
    epoch += 1;
    for (const [askId, pending] of asks) {
      if (pending.site !== "ping") continue;
      clearTimeout(pending.timeout);
      asks.delete(askId);
      pinging = false;
    }
  };

  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const stall = (): void => {
    if (state === "stopped") return;
    const seconds = stallMs % 1000 === 0 ? `${String(stallMs / 1000)} seconds` : `${String(stallMs)} ms`;
    /* The switch-off notice and its problem line say this; no second line is reported. */
    stop();
    health.switchOff(deps.id, "heartbeat", new Error(`its Worker went ${seconds} without answering the game`));
  };
  const ping = (): void => {
    if (pinging || state === "stopped") return;
    pinging = true;
    nextAsk += 1;
    const askId = nextAsk;
    const sent = now();
    /* A host thread that was itself blocked past the deadline proves nothing
     * about the Worker, whose answer may be queued behind this very timer: it
     * gets one more short window before the verdict. */
    let due = sent + stallMs;
    const verdict = (): void => {
      const entry = asks.get(askId);
      if (!entry) return;
      const late = now() - due;
      if (late > 250) {
        due = now() + Math.min(stallMs, 1000);
        asks.set(askId, { ...entry, timeout: setTimeout(verdict, Math.min(stallMs, 1000)) });
        return;
      }
      stall();
    };
    const stallTimer = setTimeout(verdict, stallMs);
    /* A ping has its own clock: it waits for the stall limit, not the ask
     * timeout, and its answer is latency like any other. */
    asks.set(askId, {
      epoch,
      sent,
      site: "ping",
      timeout: stallTimer,
      resolve: () => { pinging = false; },
      reject: () => { pinging = false; },
    });
    post({ type: "ask", ...envelope(), askId, question: { kind: "ping" } });
  };

  const fail = (message: string): void => {
    problem(message);
    health.recordFault(deps.id, "Worker message", new Error(message));
  };

  const admit = (raw: unknown): ModWorkerToHost | null => {
    let bytes: number;
    try {
      cloneWorkerJson(raw);
      bytes = payloadBytes(raw);
    } catch (err) {
      refuse(raw, `refused worker payload: ${messageOf(err)}`);
      return null;
    }
    health.recordPayload(deps.id, bytes);
    if (bytes > MAX_MESSAGE_BYTES) {
      refuse(raw, `refused worker payload larger than ${String(MAX_MESSAGE_BYTES)} bytes`);
      return null;
    }
    if (!isWorkerMessage(raw)) {
      refuse(raw, "refused malformed worker message");
      return null;
    }
    if (raw.protocolVersion !== MOD_WORKER_PROTOCOL_VERSION || raw.pluginId !== deps.id) {
      fail("refused worker message with wrong protocol version or plugin id");
      return null;
    }
    if (state === "stopped") return null;
    return raw;
  };

  const accept = (message: Extract<ModWorkerToHost, { type: "ready" }>): void => {
    if (state !== "starting") return fail("refused duplicate worker ready");
    const s = message.summary;
    const verdict = apiRangeVerdict(s.api);
    if (!verdict.ok) {
      const error = new Error(`"api": "${s.api}" ${verdict.why}`);
      rejectReady(error);
      problem(error.message);
      stop();
      return;
    }
    if (s.misplaced.length > 0) {
      problem(
        `declares ${s.misplaced.join(", ")} as hook functions, which a Worker cannot answer inside a turn; ` +
          "declare them as policies instead. They are not installed.",
      );
    }
    let hooks: Api2Hooks = {};
    let registrations: Api2PolicyRegistrations = {};
    if (s.policies !== null) {
      const why = checkApi2Policies(s.policies);
      if (why) problem(`its policies are not valid, so none is installed: ${why}`);
      else ({ hooks, registrations } = api2PolicyEffects(s.policies as unknown as Api2Policies,
        (capability) => capabilities.has(capability)));
    }
    policyHooks = (Object.keys(hooks) as Api2HookName[]).filter((h) => API2_HOOK_NAMES.includes(h));
    const notify = s.notify.filter((h) => NOTIFY_HOOKS.includes(h));
    summary = { ...s, notify };
    const prefsVersion = s.prefsVersion;
    try {
      api = deps.api({
        ...(typeof s.installVersion === "number" && Number.isInteger(s.installVersion) && s.installVersion >= 1 ? {
          install: { version: s.installVersion, migrate: async (value: JsonValue, fromVersion: number): Promise<JsonValue> =>
            (await ask({ kind: "install.migrate", value: toWorkerJson(value), fromVersion }, "its install migration")) as JsonValue },
        } : {}),
        activeHooks: [...notify, ...policyHooks] as Api2HookName[],
        ...(prefsVersion !== null && Number.isInteger(prefsVersion) && prefsVersion >= 1
          ? {
            prefs: {
              version: prefsVersion,
              migrate: async (value: JsonValue, fromVersion: number): Promise<JsonValue> =>
                (await ask({ kind: "prefs.migrate", value: toWorkerJson(value), fromVersion }, "its preference migration")) as JsonValue,
            },
          }
          : {}),
      });
    } catch (err) {
      const error = new Error(`its API could not be built: ${messageOf(err)}`);
      rejectReady(error);
      problem(error.message);
      stop();
      return;
    }
    state = "ready";
    deps.onHooks?.(hooks, notify, registrations);
    heartbeat = setInterval(ping, heartbeatMs);
    resolveReady({ summary, policyHooks });
  };

  const answered = (message: Extract<ModWorkerToHost, { type: "answer" }>): void => {
    const pending = asks.get(message.askId);
    if (!pending || pending.epoch !== message.epoch || message.epoch !== epoch) {
      stale += 1;
      health.recordStale(deps.id);
      return;
    }
    asks.delete(message.askId);
    clearTimeout(pending.timeout);
    health.recordReply(deps.id, Math.max(0, now() - pending.sent));
    if (message.ok) {
      try {
        pending.resolve(cloneWorkerJson(message.value));
      } catch (err) {
        pending.reject(new Error(messageOf(err)));
      }
    } else {
      pending.reject(new Error(message.error));
    }
  };

  const reply = (requestId: number, calledIn: number, result: Api2Result<unknown> | Error): void => {
    if (result instanceof Error) {
      post({ type: "reply", pluginId: deps.id, epoch: calledIn, requestId, ok: false, error: result.message.slice(0, 4096) });
      return;
    }
    let json: WorkerJson;
    try {
      json = toWorkerJson(result);
    } catch (err) {
      post({ type: "reply", pluginId: deps.id, epoch: calledIn, requestId, ok: false, error: `the answer could not be copied: ${messageOf(err)}`.slice(0, 4096) });
      return;
    }
    post({ type: "reply", pluginId: deps.id, epoch: calledIn, requestId, ok: true, result: json });
  };

  const refuse = (raw: unknown, reason: string): void => {
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const m = raw as Record<string, unknown>;
      if (m["type"] === "call" && m["pluginId"] === deps.id && m["protocolVersion"] === MOD_WORKER_PROTOCOL_VERSION &&
        Number.isSafeInteger(m["requestId"]) && (m["requestId"] as number) > 0 && Number.isSafeInteger(m["epoch"])) {
        reply(m["requestId"] as number, m["epoch"] as number, new Error(reason));
      }
    }
    fail(reason);
  };

  /** Serve one call. Every path answers with an Api2Result or an error. */
  const serve = async (host: ModApi2, method: string, args: readonly WorkerJson[]): Promise<Api2Result<unknown>> => {
    if (method === "ui.onKey") {
      const listenerId = args[0] as number;
      if (!Number.isSafeInteger(listenerId) || listenerId <= 0 || keySubscriptions.has(listenerId)) return api2Refused("bad-call", "ui.onKey takes a fresh listener id");
      const result = await host.ui.onKey((payload) => {
        if (state === "running") post({ type: "event", ...envelope(), listenerId, payload: toWorkerJson(payload) });
      });
      if (!result.ok) return result;
      keySubscriptions.set(listenerId, result.value);
      return { ok: true, value: { id: String(listenerId) } };
    }
    if (method === "ui.offKey") {
      const id = Number((args[0] as { id?: unknown } | null)?.id);
      const subscription = keySubscriptions.get(id);
      keySubscriptions.delete(id);
      return subscription ? host.ui.offKey(subscription) : { ok: true, value: null };
    }
    if (method === "events.on") {
      const [name, listenerId] = args;
      if (typeof name !== "string" || !Number.isSafeInteger(listenerId) || (listenerId as number) <= 0 || subscriptions.has(listenerId as number)) {
        return api2Refused("bad-call", "events.on takes an event name and a fresh listener id");
      }
      const result = await host.events.on(name as never, (payload: unknown) => {
        if (state !== "running") return;
        let json: WorkerJson;
        try {
          json = toWorkerJson(payload);
        } catch (err) {
          problem(`event ${name} could not be copied: ${messageOf(err)}`);
          return;
        }
        post({ type: "event", ...envelope(), listenerId: listenerId as number, payload: json });
      });
      if (!result.ok) return result;
      subscriptions.set(listenerId as number, result.value);
      return { ok: true, value: { id: String(listenerId) } };
    }
    if (method === "events.off") {
      const listenerId = Number((args[0] as { id?: unknown } | null)?.id);
      const subscription = subscriptions.get(listenerId);
      if (!subscription) return { ok: true, value: null };
      subscriptions.delete(listenerId);
      return host.events.off(subscription);
    }
    if (method === "ui.mount") {
      const [panel, callbackId, dismissId] = args;
      const onAction = Number.isSafeInteger(callbackId) && (callbackId as number) > 0
        ? (action: string, value?: string | boolean): void => post({ type: "ui.action", ...envelope(), callbackId: callbackId as number, action: String(action), ...(value === undefined ? {} : { value }) })
        : undefined;
      const onDismiss = Number.isSafeInteger(dismissId) && (dismissId as number) > 0
        ? (): void => post({ type: "ui.dismissed", ...envelope(), callbackId: dismissId as number })
        : undefined;
      return host.ui.mount(panel as never, onAction, onDismiss);
    }
    if (method === "ui.commands.register" || method === "ui.gameMenu.register") {
      const [id, label, callbackId, commandOptions] = args;
      if (typeof id !== "string" || typeof label !== "string" || !Number.isSafeInteger(callbackId) || (callbackId as number) <= 0) {
        return api2Refused("bad-call", "a UI action needs an id, label and callback id");
      }
      const run = (commandArgs?: { readonly dir?: number }): void => post({ type: "ui.action", ...envelope(), callbackId: callbackId as number, action: id, ...(commandArgs?.dir === undefined ? {} : { value: String(commandArgs.dir) }) });
      const direction = typeof commandOptions === "object" && commandOptions !== null && (commandOptions as { direction?: unknown }).direction === true;
      return method === "ui.commands.register"
        ? host.ui.commands.register(id, label, run, direction ? { direction: true } : undefined)
        : host.ui.gameMenu.register(id, label, run);
    }
    if (method.startsWith("backupFolder.")) {
      if (!host.meta.granted("backup:folder")) return api2NotGranted("backup:folder");
      if (!host.backupFolder) return api2Unavailable("this front end has no backup folder");
      if (method === "backupFolder.onSave") {
        const callbackId = args[0];
        if (!Number.isSafeInteger(callbackId) || (callbackId as number) <= 0 || backupSubscriptions.has(callbackId as number)) return api2Refused("bad-call", "backup subscription needs a fresh callback id");
        const result = await host.backupFolder.onSave((file) => post({ type: "backup.save", ...envelope(), callbackId: callbackId as number, file }));
        if (!result.ok) return result;
        backupSubscriptions.set(callbackId as number, result.value);
        return { ok: true, value: { id: String(callbackId) } };
      }
      if (method === "backupFolder.off") {
        const callbackId = Number((args[0] as { id?: unknown } | null)?.id);
        const subscription = backupSubscriptions.get(callbackId);
        backupSubscriptions.delete(callbackId);
        return subscription ? host.backupFolder.off(subscription) : { ok: true, value: null };
      }
    }
    if (method === "content.asset" && deps.readAsset) {
      const path = args[0];
      if (typeof path !== "string" || !validPath(path)) return api2Refused("bad-path", "content.asset takes a relative path inside this mod");
      const bytes = await deps.readAsset(path);
      if (bytes === null) return api2Refused("not-found", `this mod has no file "${path}"`);
      return { ok: true, value: `data:application/octet-stream;base64,${base64(bytes)}` };
    }
    if (method === "store.prefs.get") {
      try {
        return await host.store.prefs.get();
      } catch (err) {
        if (err instanceof WorkerTimeoutError) return api2Unavailable(`its stored preferences were left as they are: ${err.message}`);
        throw err;
      }
    }
    const target = resolve(host, method);
    if (!target) return api2Unavailable(`this mod has no "${method.split(".")[0] ?? method}" domain`);
    if (method === "net.request") {
      const started = now();
      try {
        return await (target(...args) as Promise<Api2Result<unknown>>);
      } finally {
        health.recordNetWait(deps.id, Math.max(0, now() - started));
      }
    }
    return await (target(...args) as Promise<Api2Result<unknown>>);
  };

  const called = (message: Extract<ModWorkerToHost, { type: "call" }>): void => {
    const respond = (result: Api2Result<unknown> | Error): void => reply(message.requestId, message.epoch, result);
    if (message.epoch !== epoch) {
      stale += 1;
      health.recordStale(deps.id);
      respond(new Error("the call was superseded by a new Worker epoch"));
      return;
    }
    if (state !== "running" || api === null) {
      respond(new Error("the mod's API is not open yet; call it from start()"));
      return;
    }
    if (message.method.startsWith("engine.")) {
      respond(api2NotGranted("engine:access"));
      return;
    }
    if (!(WORKER_CALLS as readonly string[]).includes(message.method)) {
      fail(`refused call to "${message.method}", which a Worker mod cannot make`);
      respond(new Error(`"${message.method}" is not part of the API a Worker mod holds`));
      return;
    }
    const t = now();
    while (callTimes[0] !== undefined && callTimes[0] < t - 1000) callTimes.shift();
    if (callTimes.length >= maxCalls) {
      respond(api2Refused("rate", `more than ${String(maxCalls)} calls in one second`));
      return;
    }
    callTimes.push(t);
    const host = api;
    let pending: Promise<Api2Result<unknown>>;
    try {
      pending = health.run(deps.id, `Worker ${message.method}`, () => serve(host, message.method, message.args));
    } catch (err) {
      respond(err instanceof Error ? err : new Error(messageOf(err)));
      return;
    }
    pending.then(
      (result) => respond(result),
      (err: unknown) => respond(err instanceof Error ? err : new Error(messageOf(err))),
    );
  };

  const receive = (raw: unknown): void => {
    const message = admit(raw);
    if (!message) return;
    switch (message.type) {
      case "ready":
        accept(message);
        return;
      case "answer":
        answered(message);
        return;
      case "call":
        called(message);
        return;
      case "log":
        if (message.message.length > 4096) return fail("refused worker log longer than 4096 characters");
        deps.onLog?.(message.level, message.message);
        return;
      case "fault": {
        const error = new Error(message.message.slice(0, 4096));
        problem(`${message.site.slice(0, 64)} failed: ${error.message}`);
        if (state === "starting") {
          rejectReady(error);
          stop();
          return;
        }
        health.recordFault(deps.id, message.site.slice(0, 64), error);
        return;
      }
      default:
        return;
    }
  };

  const stop = (): void => {
    if (state === "stopped") return;
    if (state !== "starting") post({ type: "teardown", ...envelope() });
    state = "stopped";
    stopHeartbeat();
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    for (const pending of asks.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("the mod's Worker stopped"));
    }
    asks.clear();
    const host = api;
    for (const subscription of subscriptions.values()) void host?.events.off(subscription);
    subscriptions.clear();
    for (const subscription of keySubscriptions.values()) void host?.ui.offKey(subscription);
    keySubscriptions.clear();
    for (const subscription of backupSubscriptions.values()) void host?.backupFolder?.off(subscription);
    backupSubscriptions.clear();
    if (host) disposeApi2Host(host);
    rejectReady(new Error("the mod's Worker stopped before it was ready"));
    deps.onTeardown?.();
  };

  worker.onmessage = (event): void => receive(event.data);
  worker.onerror = (event): void => {
    const error = new Error(event.message || "the mod's Worker failed");
    problem(error.message);
    if (state === "starting") {
      rejectReady(error);
      stop();
    } else {
      health.recordFault(deps.id, "Worker", error);
    }
  };
  post({
    type: "init",
    ...envelope(),
    protocolVersion: MOD_WORKER_PROTOCOL_VERSION,
    entryUrl: deps.entryUrl,
    meta: {
      id: deps.id,
      api: MOD_API2_VERSION,
      engine: deps.engine,
      tier: "public",
      flags: { ...deps.flags },
      newCharacter: deps.newCharacter,
      granted: workerGrants,
      net: deps.net,
      hooks: [...API2_HOOK_NAMES],
    },
  });

  return {
    ready,
    canMigrateBag: (): boolean => summary?.migrateBag === true && state !== "stopped",
    migrateBag: async (data: unknown, fromSchema: number): Promise<JsonValue> => {
      if (state !== "ready" && state !== "running") throw new Error("the mod's Worker is not ready to migrate its bag");
      if (!Number.isInteger(fromSchema) || fromSchema < 0) throw new Error("bag schema must be a non-negative integer");
      return (await ask({ kind: "migrateBag", data: toWorkerJson(data), fromSchema }, "its bag migration")) as JsonValue;
    },
    start(): void {
      if (state !== "ready") return;
      state = "running";
      post({ type: "start", ...envelope(), policyHooks });
    },
    notify(hook: string, args: readonly unknown[]): void {
      if ((state !== "ready" && state !== "running") || !summary?.notify.includes(hook) || health.isOff(deps.id)) return;
      let json: WorkerJson[];
      try {
        json = args.map((arg) => toWorkerJson(arg));
      } catch (err) {
        problem(`${hook} could not be copied: ${messageOf(err)}`);
        return;
      }
      health.run(deps.id, `${hook} hook`, () => post({ type: "notify", ...envelope(), hook, args: json }));
    },
    staleCount: (): number => stale,
    teardown: stop,
  };
}

/** The API method at `path` on `api`, bound, or null when the domain is absent. */
function resolve(api: ModApi2, path: string): ((...args: unknown[]) => unknown) | null {
  const parts = path.split(".");
  let owner: unknown = api;
  for (const part of parts.slice(0, -1)) {
    owner = (owner as Record<string, unknown> | undefined)?.[part];
    if (owner === undefined || owner === null) return null;
  }
  const fn = (owner as Record<string, unknown>)[parts[parts.length - 1] ?? ""];
  return typeof fn === "function" ? (fn as (...args: unknown[]) => unknown).bind(owner) : null;
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function validPath(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !value.startsWith("/") && !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function isWorkerMessage(value: unknown): value is ModWorkerToHost {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  if (typeof m["type"] !== "string" || typeof m["protocolVersion"] !== "string" || typeof m["pluginId"] !== "string") return false;
  if (!Number.isSafeInteger(m["epoch"])) return false;
  const positive = (key: string): boolean => Number.isSafeInteger(m[key]) && (m[key] as number) > 0;
  switch (m["type"]) {
    case "ready": {
      const s = m["summary"] as Record<string, unknown> | null;
      return typeof s === "object" && s !== null && typeof s["api"] === "string" &&
        stringList(s["notify"]) && stringList(s["misplaced"]) && s["policies"] !== undefined &&
        typeof s["migrateBag"] === "boolean" && typeof s["start"] === "boolean" && typeof s["stop"] === "boolean" &&
        (s["prefsVersion"] === null || typeof s["prefsVersion"] === "number");
    }
    case "call":
      return positive("requestId") && typeof m["method"] === "string" && Array.isArray(m["args"]) && m["args"].length <= 4;
    case "answer":
      return positive("askId") && (m["ok"] === true ? m["value"] !== undefined : m["ok"] === false && typeof m["error"] === "string");
    case "log":
      return (m["level"] === "info" || m["level"] === "warn" || m["level"] === "error") && typeof m["message"] === "string";
    case "fault":
      return typeof m["site"] === "string" && typeof m["message"] === "string";
    default:
      return false;
  }
}

function stringList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 64 && value.every((v) => typeof v === "string");
}
