/**
 * The Worker side of the broker: a thin proxy that hands a Worker mod the mod
 * API, version 2, and turns each call into one message (protocol.ts).
 *
 * The mod's default export is the same `Api2ModDefinition` an in-process mod
 * exports. What differs is what the Worker can hold: every call answers
 * asynchronously, every value crosses as a copy, panels are drawn by the host,
 * and a hook that has to answer inside a turn is declared as a policy table.
 */

import type { Api2ModDefinition, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import type { HostToModWorker, ModWorkerToHost, WorkerDefinitionSummary, WorkerJson, WorkerMeta } from "./protocol";

/** The end of the host channel the bootstrap talks through: a MessagePort, or a Worker's own scope. */
export interface WorkerScope {
  onmessage: ((event: MessageEvent<HostToModWorker>) => void) | null;
  postMessage(message: ModWorkerToHost): void;
}

/**
 * Install the bootstrap on `scope`.
 *
 * The isolated runtime (isolation.ts) ships this function to its sandboxed
 * Worker as source text, so the function refers to nothing outside its own
 * body and its parameters: no imported value, no module-level helper, and no
 * `import()` of its own. `importEntry` is the one way in for the mod's code,
 * and the protocol version arrives as an argument for the same reason. Type
 * imports are erased and cost nothing.
 */
export function installModWorkerBootstrap(
  scope: WorkerScope,
  protocolVersion: string,
  importEntry: (hostEntryUrl: string) => Promise<unknown>,
): void {
  type Pending = { resolve(value: unknown): void; reject(reason: Error): void };
  type Listener = (payload: unknown) => void;
  const NOTIFY = ["optionsChanged", "abilityGained", "monsterBecameVisible", "artifactIdentified"];
  let id: string | null = null;
  let epoch = 0;
  let meta: WorkerMeta | null = null;
  let definition: Api2ModDefinition | null = null;
  let declared: Record<string, unknown> = {};
  let started = false;
  let nextRequest = 0;
  let nextListener = 0;
  let nextCallback = 0;
  const pending = new Map<number, Pending>();
  const listeners = new Map<number, Listener>();
  const callbacks = new Map<number, (action: string) => void>();

  const freeze = <T>(value: T): T => {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    }
    return value;
  };
  const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  const send = (message: Record<string, unknown>): void => {
    if (id === null) return;
    scope.postMessage({ ...message, protocolVersion, pluginId: id, epoch } as unknown as ModWorkerToHost);
  };
  const fault = (site: string, err: unknown): void => send({ type: "fault", site, message: messageOf(err) });
  /* Plain data only: functions and undefined members drop out here, as they
   * would through JSON, so a call never fails on the host's strict check. */
  const plain = (value: unknown): WorkerJson => (value === undefined ? null : JSON.parse(JSON.stringify(value)) as WorkerJson);
  const call = (method: string, args: readonly unknown[]): Promise<never> => {
    const list = [...args];
    while (list.length > 0 && list[list.length - 1] === undefined) list.pop();
    nextRequest += 1;
    const requestId = nextRequest;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      try {
        send({ type: "call", requestId, method, args: list.map(plain) });
      } catch (err) {
        pending.delete(requestId);
        reject(err instanceof Error ? err : new Error(messageOf(err)));
      }
    });
  };
  const method = (path: string) => (...args: unknown[]): Promise<never> => call(path, args);
  const granted = (capability: string): boolean => {
    const list = meta?.granted ?? [];
    if (list.includes(capability)) return true;
    const state = /^state:([a-z0-9-]+)\.read$/u.exec(capability);
    if (state && state[1] !== "map-actual" && list.includes("state:*.read")) return true;
    return capability.startsWith("network:") && capability !== "network:local" && list.includes("network:*");
  };

  const buildApi = (m: WorkerMeta, active: readonly string[]): ModApi2 => {
    const api = {
      meta: {
        id: m.id,
        api: m.api,
        engine: m.engine,
        tier: m.tier,
        flags: m.flags,
        newCharacter: m.newCharacter,
        granted,
        log: (message: string): void => send({ type: "log", level: "info", message: String(message) }),
        settings: method("meta.settings"),
        setSetting: method("meta.setSetting"),
        mods: method("meta.mods"),
      },
      view: {
        world: method("view.world"),
        player: method("view.player"),
        monsters: method("view.monsters"),
        level: method("view.level"),
        input: method("view.input"),
        isCurrent: method("view.isCurrent"),
      },
      act: {
        submit: method("act.submit"),
        answer: method("act.answer"),
        controller: {
          owns: method("act.controller.owns"),
          setStatus: method("act.controller.setStatus"),
          markNondeterministic: method("act.controller.markNondeterministic"),
          release: method("act.controller.release"),
        },
      },
      events: {
        on: async (name: string, listener: Listener): Promise<unknown> => {
          nextListener += 1;
          const listenerId = nextListener;
          listeners.set(listenerId, listener);
          const result = (await call("events.on", [name, listenerId])) as { ok: boolean };
          if (!result.ok) listeners.delete(listenerId);
          return result;
        },
        off: async (subscription: { readonly id: string }): Promise<unknown> => {
          listeners.delete(Number(subscription.id));
          return call("events.off", [{ id: subscription.id }]);
        },
      },
      hooks: { available: m.hooks, active },
      content: {
        own: method("content.own"),
        asset: method("content.asset"),
        records: method("content.records"),
        lookup: method("content.lookup"),
      },
      ui: {
        mount: (panel: unknown, onAction?: (action: string) => void): Promise<unknown> => {
          let callbackId = 0;
          if (typeof onAction === "function") {
            nextCallback += 1;
            callbackId = nextCallback;
            callbacks.set(callbackId, onAction);
          }
          return call("ui.mount", [panel, callbackId]);
        },
        patch: method("ui.patch"),
        keys: { bind: method("ui.keys.bind"), list: method("ui.keys.list"), remove: method("ui.keys.remove") },
      },
      store: {
        prefs: { get: method("store.prefs.get"), set: method("store.prefs.set") },
        character: { get: method("store.character.get"), set: method("store.character.set") },
      },
      ...(m.net ? {
        net: {
          request: method("net.request"),
          /* An opaque reference: the value stays with the host, which puts it
           * into the request after the request leaves this Worker. */
          credential: (name: string) => Object.freeze({ credential: String(name) }),
          credentials: {
            status: method("net.credentials.status"),
            set: method("net.credentials.set"),
            fromEnvironment: method("net.credentials.fromEnvironment"),
            remove: method("net.credentials.remove"),
          },
        },
      } : {}),
    };
    return freeze(api) as unknown as ModApi2;
  };

  const summarize = (d: Api2ModDefinition, m: WorkerMeta): WorkerDefinitionSummary => {
    const context = freeze({ id: m.id, flags: { ...m.flags } });
    const hooks = (d.hooks?.(context) ?? {}) as Record<string, unknown>;
    declared = {};
    const misplaced: string[] = [];
    for (const [name, fn] of Object.entries(hooks)) {
      if (typeof fn !== "function") continue;
      if (NOTIFY.includes(name)) declared[name] = (fn as (...args: unknown[]) => unknown).bind(hooks);
      else misplaced.push(name);
    }
    const policies = d.policies?.(context);
    return {
      api: d.api,
      notify: Object.keys(declared),
      misplaced,
      policies: policies === undefined ? null : plain(policies),
      migrateBag: typeof d.migrateBag === "function",
      prefsVersion: d.prefs !== undefined && typeof d.prefs.version === "number" ? d.prefs.version : null,
      start: typeof d.start === "function",
      stop: typeof d.stop === "function",
    };
  };

  const boot = async (message: Extract<HostToModWorker, { type: "init" }>): Promise<void> => {
    if (id !== null || message.protocolVersion !== protocolVersion || message.meta.id !== message.pluginId) return;
    id = message.pluginId;
    epoch = message.epoch;
    meta = freeze(message.meta);
    try {
      const module = (await importEntry(message.entryUrl)) as { default?: unknown } | null;
      const candidate = module?.default;
      if (candidate === null || typeof candidate !== "object" || typeof (candidate as { api?: unknown }).api !== "string") {
        throw new Error("the Worker entry's default export is not an API 2 mod definition (an object with an \"api\" range)");
      }
      definition = candidate as Api2ModDefinition;
      send({ type: "ready", summary: summarize(definition, meta) });
    } catch (err) {
      fault("boot", err);
    }
  };

  const answer = async (message: Extract<HostToModWorker, { type: "ask" }>): Promise<void> => {
    const reply = (body: Record<string, unknown>): void => {
      if (id === null) return;
      scope.postMessage({ type: "answer", protocolVersion, pluginId: id, epoch: message.epoch, askId: message.askId, ...body } as unknown as ModWorkerToHost);
    };
    try {
      const q = message.question;
      let value: unknown = null;
      if (q.kind === "migrateBag") {
        if (!definition?.migrateBag) throw new Error("this mod has no migrateBag");
        value = await definition.migrateBag(q.data as never, q.fromSchema);
      } else if (q.kind === "prefs.migrate") {
        if (!definition?.prefs) throw new Error("this mod declares no prefs migration");
        value = await definition.prefs.migrate(q.value as never, q.fromVersion);
      }
      reply({ ok: true, value: plain(value) });
    } catch (err) {
      reply({ ok: false, error: messageOf(err) });
    }
  };

  scope.onmessage = (event): void => {
    const message = event.data;
    if (message === null || typeof message !== "object") return;
    if (message.type === "init") {
      void boot(message);
      return;
    }
    if (id === null || message.pluginId !== id) return;
    if (typeof message.epoch === "number" && message.epoch > epoch) epoch = message.epoch;
    switch (message.type) {
      case "reply": {
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        if (message.ok) request.resolve(freeze(message.result));
        else request.reject(new Error(message.error));
        return;
      }
      case "event": {
        const listener = listeners.get(message.listenerId);
        if (!listener) return;
        try {
          listener(freeze(message.payload));
        } catch (err) {
          fault("event listener", err);
        }
        return;
      }
      case "ui.action": {
        const callback = callbacks.get(message.callbackId);
        if (!callback) return;
        try {
          callback(String(message.action));
        } catch (err) {
          fault("panel action", err);
        }
        return;
      }
      case "ask":
        void answer(message);
        return;
      case "notify": {
        const hook = declared[message.hook];
        if (typeof hook !== "function") return;
        try {
          (hook as (...args: unknown[]) => unknown)(...message.args.map((arg) => freeze(arg)));
        } catch (err) {
          fault(`${message.hook} hook`, err);
        }
        return;
      }
      case "start": {
        if (started || definition === null || meta === null) return;
        started = true;
        if (!definition.start) return;
        const active = [...Object.keys(declared), ...message.policyHooks];
        try {
          const result = definition.start(buildApi(meta, active));
          if (result && typeof (result as Promise<void>).then === "function") {
            (result as Promise<void>).then(undefined, (err: unknown) => fault("start()", err));
          }
        } catch (err) {
          fault("start()", err);
        }
        return;
      }
      case "teardown": {
        const stopping = definition;
        definition = null;
        listeners.clear();
        callbacks.clear();
        for (const request of pending.values()) request.reject(new Error("the mod was stopped"));
        pending.clear();
        try {
          stopping?.stop?.();
        } catch (err) {
          fault("stop()", err);
        }
        return;
      }
      default:
        return;
    }
  };
}
