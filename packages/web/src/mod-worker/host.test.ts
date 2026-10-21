/**
 * The Worker broker on a real game, with the real Worker-side bootstrap wired
 * to it in this thread. Each message crosses as a structured clone, as it
 * would between threads, so what a Worker mod can see is exactly what the
 * broker posts.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MFLAG,
  composeModHooks,
  loc,
  GlyphTable,
  glyphTableSink,
  movementTunnelTest,
  monsterIsObvious,
  SKILL,
  prefErrorPolicy,
  processPrefText,
  setPrefErrorPolicy,
  UPSTREAM_PREF_ERROR_POLICY,
  squareForget,
  squareMemorize,
  startGame,
  ObjRegistry,
  Rng,
  bindConstants,
  objectPrep,
  objectValueReal,
  resetTvalRegistry,
  tvalRegistry,
  tunnelAux,
  walkAction,
  type CaveCmdDeps,
  type GamePack,
  type GameState,
  type Monster,
  type ModNet,
  type ModNetResponse,
  type StartedGame,
} from "@rpgm-tools/neo-angband-core";
import { API2_POLICY_KINDS, CapabilitySet, type Api2ModDefinition, type Api2Policies, type Api2PolicyRegistrations, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { api2Plugin, installApi2PolicyRegistrations, removeApi2PrefErrors, setApi2PolicyLoadOrder } from "../mod-api2-shim";
import { createApi2Host } from "../mod-api2-host";
import { modPluginContext } from "../mod-context";
import { ModHealthMonitor, type ModSwitchOff } from "../mod-health";
import type { ModPrefs } from "../mod-prefs";
import { installModWorkerBootstrap, type WorkerScope } from "./bootstrap";
import { resetWorkerHooks, settleWorkerHooks, workerModHooks } from "./hooks";
import {
  startModWorker,
  MAX_MESSAGE_BYTES,
  WorkerTimeoutError,
  type ModWorkerHostDeps,
  type ModWorkerLike,
  type StartedModWorker,
  type WorkerApiOptions,
} from "./host";
import { MOD_WORKER_PROTOCOL_VERSION, type HostToModWorker, type ModWorkerToHost } from "./protocol";

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8")) as T;
}
function records<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: records("terrain"),
  roomTemplates: records("room_template"),
  vaults: records("vault"),
  dungeonProfiles: records("dungeon_profile"),
  obj: {
    objectBase: loadJson("object_base"), object: loadJson("object"),
    egoItem: loadJson("ego_item"), artifact: loadJson("artifact"),
    curse: loadJson("curse"), brand: loadJson("brand"),
    slay: loadJson("slay"), activation: loadJson("activation"),
    objectProperty: loadJson("object_property"), flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: records("pain"), blowMethods: records("blow_methods"),
    blowEffects: records("blow_effects"), monsterSpells: records("monster_spell"),
    monsterBases: records("monster_base"), monsters: records("monster"),
    summons: records("summon"), pits: records("pit"),
  },
  player: {
    races: records("p_race"), classes: records("class"),
    properties: records("player_property"), timed: records("player_timed"),
    shapes: records("shape"), bodies: records("body"),
    history: records("history"), realms: records("realm"),
  },
};

type NetRequest = Parameters<ModNet["request"]>[0];

const SEED = 4242;
const DEPTH = 10;
const API = ">=2.0.0 <3.0.0";

function memoryPrefs(initial: unknown = null): ModPrefs & { raw: () => unknown } {
  let stored: unknown = initial;
  return {
    get: () => (stored === null ? null : structuredClone(stored)),
    set: (value: unknown) => {
      stored = value === undefined || value === null ? null : structuredClone(value);
    },
    raw: () => stored,
  } as ModPrefs & { raw: () => unknown };
}

interface HostSetup {
  readonly game?: StartedGame;
  readonly grants?: readonly string[];
  readonly prefs?: ModPrefs;
  readonly net?: ModNet;
  readonly options?: Partial<import("../mod-api2-host").Api2HostOptions>;
}

/** The broker's `api` dependency: the in-process host over the mod's own context, as main.ts builds it. */
function hostApi(setup: HostSetup = {}): (options: WorkerApiOptions) => ModApi2 {
  return (options) => {
    const capabilities = CapabilitySet.fromManifest({
      id: "probe", name: "probe", version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1,
      capabilities: [...(setup.grants ?? [])],
    });
    const ctx = modPluginContext("probe", {}, setup.game?.state, {}, {
      capabilities,
      prefs: setup.prefs ?? memoryPrefs(),
      ...(setup.net ? { net: setup.net } : {}),
    });
    return createApi2Host(ctx, { grants: capabilities, ...setup.options, ...options, execution: "worker" });
  };
}

/** A Worker whose other end is the real bootstrap, one structured clone away. */
class InThreadWorker implements ModWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  /** A Worker thread stuck in a loop: it receives nothing and answers nothing. */
  stuck = false;
  readonly sent: HostToModWorker[] = [];
  readonly scope: WorkerScope;

  constructor(definition: Api2ModDefinition) {
    this.scope = {
      onmessage: null,
      postMessage: (message: ModWorkerToHost): void => {
        if (this.terminated || this.stuck) return;
        const copy = structuredClone(message);
        queueMicrotask(() => this.onmessage?.({ data: copy } as MessageEvent<unknown>));
      },
    };
    installModWorkerBootstrap(this.scope, MOD_WORKER_PROTOCOL_VERSION, () => Promise.resolve({ default: definition }));
  }

  postMessage(message: HostToModWorker): void {
    const copy = structuredClone(message);
    this.sent.push(copy);
    if (this.terminated || this.stuck) return;
    queueMicrotask(() => this.scope.onmessage?.({ data: structuredClone(copy) } as MessageEvent<HostToModWorker>));
  }

  terminate(): void {
    this.terminated = true;
  }
}

interface Wired {
  readonly session: StartedModWorker;
  readonly worker: InThreadWorker;
  readonly health: ModHealthMonitor;
  readonly problems: string[];
  readonly switchedOff: ModSwitchOff[];
}

const sessions: StartedModWorker[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.teardown();
  resetWorkerHooks();
  resetTvalRegistry();
});

function wire(definition: Api2ModDefinition, deps: Partial<ModWorkerHostDeps> = {}): Wired {
  const switchedOff: ModSwitchOff[] = [];
  const health = new ModHealthMonitor({ onSwitchOff: (off) => switchedOff.push(off) });
  const problems: string[] = [];
  const worker = new InThreadWorker(definition);
  const session = startModWorker(worker, {
    id: "probe",
    entryUrl: "staged:entry",
    grants: [],
    flags: {},
    engine: "9.9.9",
    newCharacter: false,
    net: false,
    api: hostApi(),
    health,
    onProblem: (message) => problems.push(message),
    onHooks: (policies, notify, registrations) =>
      settleWorkerHooks("probe", { policies, notify, registrations, send: (hook, args) => session.notify(hook, args) }),
    onTeardown: () => settleWorkerHooks("probe", null),
    ...deps,
  });
  sessions.push(session);
  return { session, worker, health, problems, switchedOff };
}

/** Wait until the Worker's start has run and handed back what it found. */
async function started<T>(wired: Wired, found: () => T | undefined): Promise<T> {
  await wired.session.ready;
  wired.session.start();
  await vi.waitFor(() => expect(found()).not.toBeUndefined());
  return found() as T;
}

function liveMonsters(state: GameState): Monster[] {
  return state.monsters.filter((m): m is Monster => m !== null && m !== undefined);
}

/** What a mod observes of the world, as text, without the per-game token epochs. */
async function observed(api: ModApi2): Promise<string> {
  const world = await api.view.world();
  const monsters = await api.view.monsters();
  if (!world.ok || !monsters.ok) throw new Error("the probe was refused a read it holds");
  const { token: _token, level, ...rest } = world.value;
  const { token: _levelToken, ...levelRest } = level ?? { token: null };
  return JSON.stringify({ rest, level: levelRest, monsters: monsters.value });
}

function observer(sink: (seen: string) => void): Api2ModDefinition {
  return { api: API, start: async (api) => sink(await observed(api)) };
}

describe("a Worker mod's view of the world", () => {
  it("uses granted key/value stores across the broker without a management namespace", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const grants = ["store:kv", "store:session"];
    let seen: unknown;
    const wired = wire({ api: API, start: async (api) => {
      const written = await api.store.kv.set("report", { turns: 1 });
      const session = await api.store.session.set("heir", true);
      seen = { written, session, report: await api.store.kv.get("report"), keys: await api.store.kv.keys(), heir: await api.store.session.get("heir"), manage: api.manage === undefined, armed: api.meta.controllerArmed };
    } }, { grants, api: hostApi({ grants, options: { kvStorage: storage, sessionStorage: storage, tier: "first-party", firstParty: { manage: true } } }) });
    expect(await started(wired, () => seen)).toEqual({ written: { ok: true, value: null }, session: { ok: true, value: null }, report: { ok: true, value: { turns: 1 } }, keys: { ok: true, value: ["report"] }, heir: { ok: true, value: true }, manage: true, armed: false });
  });

  it("refuses ungranted storage calls across the broker", async () => {
    let seen: unknown;
    const wired = wire({ api: API, start: async (api) => {
      seen = [await api.store.kv.set("report", 1), await api.store.session.get("heir")];
    } });
    expect(await started(wired, () => seen)).toMatchObject([{ reason: "not-granted", capability: "store:kv" }, { reason: "not-granted", capability: "store:session" }]);
  });
  it("is the in-process host's, and does not change when an unseen monster does (paired worlds)", async () => {
    const a = startGame(pack, { seed: SEED, depth: DEPTH });
    const b = startGame(pack, { seed: SEED, depth: DEPTH });
    const hiddenA = liveMonsters(a.state).find((m) => !monsterIsObvious(m));
    if (!hiddenA) throw new Error("no unseen monster at this seed");
    const hiddenB = b.state.monsters[hiddenA.midx];
    if (!hiddenB || hiddenB.race.ridx !== hiddenA.race.ridx) throw new Error("the paired games diverged");
    hiddenB.hp = Math.max(1, hiddenB.hp - 1);
    hiddenB.mspeed += 10;

    const grants = ["state:*.read"];
    let seenA: string | undefined;
    let seenB: string | undefined;
    const viewA = await started(wire(observer((s) => { seenA = s; }), { api: hostApi({ game: a, grants }), grants }), () => seenA);
    const viewB = await started(wire(observer((s) => { seenB = s; }), { api: hostApi({ game: b, grants }) , grants }), () => seenB);
    expect(viewB).toBe(viewA);
    /* The same answer an in-process mod gets from the same host. */
    expect(viewA).toBe(await observed(hostApi({ game: a, grants })({ activeHooks: [] })));

    /* Control: once the player perceives the monster, the change shows. */
    hiddenB.mflag.on(MFLAG.VISIBLE);
    hiddenB.mflag.off(MFLAG.CAMOUFLAGE);
    let after: string | undefined;
    await started(wire(observer((s) => { after = s; }), { api: hostApi({ game: b, grants }), grants }), () => after);
    expect(after).not.toBe(viewA);
  });

  it("answers a read it lacks the permission for with the typed not-granted result", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    let found: unknown;
    const wired = wire({
      api: API,
      start: async (api) => {
        found = { granted: api.meta.granted("state:monsters.read"), monsters: await api.view.monsters() };
      },
    }, { api: hostApi({ game, grants: ["state:player.read"] }), grants: ["state:player.read"] });
    await started(wired, () => found);
    expect(found).toMatchObject({ granted: false, monsters: { ok: false, reason: "not-granted", capability: "state:monsters.read" } });
  });
});

describe("the broker's grants", () => {
  it("reports vocabulary wildcards without granting truth or unrelated actions", async () => {
    let found: unknown;
    const grants = ["registry:*", "state:*.read", "network:*", "ui:*.replace"];
    const wired = wire({ api: API, start: (api) => {
      found = Object.fromEntries([
        "registry:store", "registry:message", "state:monsters.read", "network:local", "network:example.test",
        "ui:sidebar.replace", "ui:region.create", "state:map-actual.read", "*",
      ].map((capability) => [capability, api.meta.granted(capability)]));
    } }, { grants });
    await started(wired, () => found);
    expect(found).toEqual({
      "registry:store": true, "registry:message": true, "state:monsters.read": true,
      "network:local": true, "network:example.test": true, "ui:sidebar.replace": true,
      "ui:region.create": false, "state:map-actual.read": false, "*": false,
    });
  });

  it("answers a Worker engine request with typed not-granted and keeps live objects absent", async () => {
    let absent: boolean | undefined;
    const wired = wire({ api: API, start: (mod) => { absent = mod.engine === undefined; } }, { grants: ["engine:access"] });
    await started(wired, () => absent);
    const init = wired.worker.sent.find((message) => message.type === "init")!;
    wired.worker.scope.postMessage({ type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: init.epoch, requestId: 900, method: "engine.core", args: [] });
    await vi.waitFor(() => expect(wired.worker.sent.find((message) => message.type === "reply" && message.requestId === 900)).toMatchObject({ ok: true, result: { ok: false, reason: "not-granted", capability: "engine:access" } }));
    expect(absent).toBe(true);
  });

  it.each(["ui.title.registerRow", "ui.mountPage", "ui.overlay", "presentation.cancelInput"])("refuses the first-party method %s", async (method) => {
    const wired = wire({ api: API });
    await wired.session.ready;
    wired.session.start();
    wired.worker.scope.postMessage({ type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1, requestId: 99, method, args: [] });
    await vi.waitFor(() => expect(wired.problems.join("\n")).toContain(`refused call to "${method}"`));
    expect(wired.worker.sent.some((message) => message.type === "reply" && message.requestId === 99 && !message.ok)).toBe(true);
  });

  it("delivers typed panel changes and dismissal to a Worker", async () => {
    let action: ((panelId: string, action: string, value?: string | boolean) => void) | undefined;
    let dismiss: (() => void) | undefined;
    let mounted = false;
    const heard: unknown[] = [];
    const grants = ["ui:panel.mount"];
    const wired = wire({ api: API, start: async (api) => {
      const result = await api.ui.mount({ id: "edit", root: { type: "input", label: "Key", action: "key" } }, (id, value) => heard.push([id, value]), () => heard.push("dismissed"));
      mounted = result.ok;
    } }, { grants, api: hostApi({ grants, options: { panels: {
      apply(_id, _operation, _payload, _patchId, onAction, onDismiss) { action = onAction; dismiss = onDismiss; return { panelId: "edit" }; },
      teardown() {},
      unmount() {},
    } } }) });
    await started(wired, () => mounted ? true : undefined);
    action!("edit", "key", "F2");
    dismiss!();
    await vi.waitFor(() => expect(heard).toEqual([["key", "F2"], "dismissed"]));
  });
  it("keeps presentation absent and refuses its methods", async () => {
    let api: ModApi2 | undefined;
    const wired = wire({ api: API, start: (mod) => { api = mod; } });
    await started(wired, () => api);
    expect(api!.presentation).toBeUndefined();
    expect(api!.ui.title).toBeUndefined();
    expect(api!.ui.mountPage).toBeUndefined();
    expect(api!.ui.overlay).toBeUndefined();
    wired.worker.scope.postMessage({
      type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1,
      requestId: 99, method: "presentation.display.snapshot", args: [],
    });
    await vi.waitFor(() => expect(wired.problems.join("\n")).toContain('refused call to "presentation.display.snapshot"'));
  });

  it("refuses a Worker presentation declaration at boot", async () => {
    const wired = wire({ api: API, presentation: { menu: () => undefined } });
    await expect(wired.session.ready).rejects.toThrow(/presentation/);
  });

  it("refuses Worker birth and title action declarations", async () => {
    for (const declaration of [{ birth: () => undefined }, { titleActions: [] }]) {
      const wired = wire({ api: API, ...declaration });
      await expect(wired.session.ready).rejects.toThrow(/birth or title/);
    }
  });
  it("never passes a wildcard grant to the Worker", async () => {
    const wired = wire({ api: API }, { grants: ["*", "state:player.read"] });
    await wired.session.ready;
    const init = wired.worker.sent.find((m) => m.type === "init");
    expect(init?.type === "init" ? init.meta.granted : null).toEqual(["state:player.read"]);
    expect(JSON.stringify(wired.worker.sent)).not.toContain("\"*\"");
  });

  it("refuses a call outside the Worker's API before it reaches a domain", async () => {
    const wired = wire({ api: API });
    await wired.session.ready;
    wired.session.start();
    wired.worker.scope.postMessage({
      type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1,
      requestId: 99, method: "manage.profiles.list", args: [],
    });
    await vi.waitFor(() => expect(wired.problems.join("\n")).toMatch(/refused call to "manage\.profiles\.list"/u));
    await vi.waitFor(() => expect(wired.worker.sent.some((m) => m.type === "reply" && m.requestId === 99 && !m.ok)).toBe(true));
  });
});

describe("asking a Worker mod", () => {
  it("refuses an old-epoch preference write after a migration timeout", async () => {
    const prefs = memoryPrefs({ original: true });
    const wired = wire({ api: API, migrateBag: () => new Promise(() => undefined) as never },
      { api: hostApi({ prefs }), timing: { askMs: 30 } });
    await wired.session.ready;
    wired.session.start();
    await expect(wired.session.migrateBag({}, 0)).rejects.toBeInstanceOf(WorkerTimeoutError);
    wired.worker.scope.postMessage({
      type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1,
      requestId: 77, method: "store.prefs.set", args: [{ obsolete: true }],
    });
    await vi.waitFor(() => expect(wired.worker.sent.some((m) => m.type === "reply" && m.requestId === 77)).toBe(true));
    expect(prefs.raw()).toEqual({ original: true });
    expect(wired.worker.sent.find((m) => m.type === "reply" && m.requestId === 77)).toMatchObject({ epoch: 1, ok: false });
    expect(wired.session.staleCount()).toBe(1);
  });

  it("keeps a pending call's originating epoch in its reply", async () => {
    let release: (value: { ok: true; value: null }) => void = () => undefined;
    const set = vi.fn(() => new Promise<{ ok: true; value: null }>((resolve) => { release = resolve; }));
    const wired = wire({ api: API, migrateBag: () => new Promise(() => undefined) as never }, {
      api: () => ({ store: { prefs: { set } } }) as unknown as ModApi2, timing: { askMs: 30 },
    });
    await wired.session.ready;
    wired.session.start();
    wired.worker.scope.postMessage({
      type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1,
      requestId: 78, method: "store.prefs.set", args: [null],
    });
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    await expect(wired.session.migrateBag({}, 0)).rejects.toBeInstanceOf(WorkerTimeoutError);
    release({ ok: true, value: null });
    await vi.waitFor(() => expect(wired.worker.sent.some((m) => m.type === "reply" && m.requestId === 78)).toBe(true));
    expect(wired.worker.sent.find((m) => m.type === "reply" && m.requestId === 78)).toMatchObject({ epoch: 1 });
  });

  it("rejects pending proxy calls when the host advances the epoch", async () => {
    let proxy: ModApi2 | undefined;
    let migrations = 0;
    const wired = wire({ api: API, start: (api) => { proxy = api; }, migrateBag: () => {
      migrations += 1;
      return (migrations === 1 ? new Promise(() => undefined) : {}) as never;
    } }, {
      api: () => ({ store: { prefs: { get: () => new Promise(() => undefined) } } }) as unknown as ModApi2,
      timing: { askMs: 30 },
    });
    const api = await started(wired, () => proxy);
    const pending = api.store.prefs.get().then(() => "resolved", (err: Error) => err.message);
    await expect(wired.session.migrateBag({}, 0)).rejects.toBeInstanceOf(WorkerTimeoutError);
    await wired.session.migrateBag({}, 0);
    let result: string | undefined;
    void pending.then((value) => { result = value; });
    await vi.waitFor(() => expect(result).toMatch(/superseded/u));
  });

  it("takes the neutral answer on timeout, drops the late reply as stale, and goes on in a new epoch", async () => {
    let release: (value: unknown) => void = () => undefined;
    let calls = 0;
    const wired = wire({
      api: API,
      migrateBag: (data) => {
        calls += 1;
        /* A Worker's answer may come later; the bootstrap awaits it. */
        return (calls === 1 ? new Promise((resolve) => { release = () => resolve({ late: true }); }) : { migrated: data }) as never;
      },
    }, { timing: { askMs: 30 } });
    await wired.session.ready;
    expect(wired.session.canMigrateBag()).toBe(true);
    await expect(wired.session.migrateBag({ v: 1 }, 0)).rejects.toBeInstanceOf(WorkerTimeoutError);
    release(null);
    await vi.waitFor(() => expect(wired.session.staleCount()).toBe(1));
    expect(wired.health.stats().find((s) => s.id === "probe")?.stale).toBe(1);

    await expect(wired.session.migrateBag({ v: 2 }, 0)).resolves.toEqual({ migrated: { v: 2 } });
    const epochs = wired.worker.sent.filter((m) => m.type === "ask").map((m) => m.epoch);
    expect(epochs[0]).toBeLessThan(epochs[epochs.length - 1] ?? 0);
    const stats = wired.health.stats().find((s) => s.id === "probe");
    expect(stats?.replies).toBeGreaterThanOrEqual(1);
    expect(stats?.stale).toBe(1);
  });

  it("leaves stored preferences as they are when the Worker's migration does not answer", async () => {
    const prefs = memoryPrefs({ $api2prefs: 1, value: { theme: "dark" } });
    let found: unknown;
    const wired = wire({
      api: API,
      prefs: { version: 2, migrate: () => new Promise(() => undefined) as never },
      start: async (api) => { found = await api.store.prefs.get(); },
    }, { api: hostApi({ prefs }), timing: { askMs: 30 } });
    await started(wired, () => found);
    expect(found).toMatchObject({ ok: false, reason: "unavailable" });
    expect(prefs.raw()).toEqual({ $api2prefs: 1, value: { theme: "dark" } });
  });
});

describe("a Worker mod's hooks", () => {
  const tables: Api2Policies = {
    prefErrors: { kind: "pref-errors", continueAfterError: true, reportLimit: 20 },
    startingOptions: { kind: "starting-options", values: { auto_more: true } },
    ignore: [{ tval: "light", kindNameContains: "Torch", ignore: true }],
    displayOptions: { kind: "display-options", storeItemNameEllipsis: true, storeSelectionDescription: true, monsterListColorKey: true },
    purgeInput: { kind: "purge-input", trigger: "F2", modifiers: [], freshOnly: true, escapeCount: 3 },
    walkBlockedByDiggable: { kind: "walk-blocked-by-diggable", attempt: "tunnel", energy: "move", step: false },
    messageText: [{ find: "a", replace: "b" }], screenText: [{ find: "a", replace: "b" }],
    characterBackground: [{ find: "a", replace: "b" }], objectInfoText: [{ find: "a", replace: "b" }],
    effectIntro: [{ find: "a", replace: "b" }], historyAdd: [{ find: "a", replace: "b" }],
    historyDisplay: [{ find: "a", replace: "b" }], objectListOrder: ["dy"], saveNoiseScent: true,
    shapeLearnObviousFlagsDirectly: true, storeDiscountRoll: { tiers: [{ oneIn: 1, percent: 20 }] },
    tileMap: [{ monster: 2, like: 1 }],
    valueFloor: { kind: "valueFloor", tvals: [10, 11], appliesTo: "egoOrPositiveToA", comparison: "cheapestPlainSameTvalWithStrictlyGreaterAc", price: "objectValueReal" },
  };

  it.each(Object.keys(tables))("requires a registry grant for the Worker %s policy", async (name) => {
    let registrations: Api2PolicyRegistrations | undefined;
    let installedHooks: string[] = [];
    const wired = wire({ api: API, policies: () => ({ [name]: tables[name as keyof Api2Policies] }) },
      { onHooks: (policies, _notify, found) => {
        installedHooks = Object.keys(policies);
        registrations = found;
      } });
    const ready = await wired.session.ready;
    expect(installedHooks).toEqual([]);
    expect(ready.policyHooks).toEqual([]);
    expect(Object.keys(registrations ?? {})).toEqual([]);
  });

  it.each(API2_POLICY_KINDS)("installs the Worker $name policy under its matching registry grant", async ({ name, capability, target }) => {
    let hooks: string[] = [];
    let registrations: Api2PolicyRegistrations = {};
    const wired = wire({ api: API, policies: () => ({ [name]: tables[name] }) },
      { grants: [capability], onHooks: (policies, _notify, found) => { hooks = Object.keys(policies); registrations = found; } });
    await wired.session.ready;
    expect(hooks).toEqual("hook" in target ? [target.hook] : []);
    expect(Object.keys(registrations)).toEqual("registration" in target ? [target.registration] : []);
  });

  it("keeps granted Worker tables when another registry permission is refused", async () => {
    let hooks: string[] = [];
    let registrations: Api2PolicyRegistrations = {};
    const wired = wire({ api: API, policies: () => tables },
      { grants: ["registry:store"], onHooks: (policies, _notify, found) => { hooks = Object.keys(policies); registrations = found; } });
    await wired.session.ready;
    expect(hooks).toEqual([]);
    expect(Object.keys(registrations)).toEqual(["discountRoll"]);
  });

  it("applies its policy tables synchronously, answering neutrally until the Worker is ready", async () => {
    const pending = workerModHooks("probe");
    expect(pending?.messageText?.("You feel better.")).toBe("You feel better.");
    const wired = wire({
      api: API,
      policies: () => ({ messageText: [{ find: "You feel", replace: "You sense", match: "prefix" }] }),
      hooks: () => ({ messageText: (text: string) => text.toUpperCase() }),
    }, { grants: ["registry:message"] });
    await wired.session.ready;
    /* The hook the game composed before the Worker loaded now reads the table, with no await. */
    expect(pending?.messageText?.("You feel better.")).toBe("You sense better.");
    const settled = workerModHooks("probe");
    expect(Object.keys(settled ?? {})).toEqual(["messageText"]);
    expect(settled?.messageText?.("You feel worse.")).toBe("You sense worse.");
    expect(wired.problems.join("\n")).toMatch(/declares messageText as hook functions/u);
  });

  it("hands the host the registrations its tables stand for, across the channel", async () => {
    let registrations: Api2PolicyRegistrations | undefined;
    const wired = wire(
      { api: API, policies: () => ({ storeDiscountRoll: { minCost: 5, tiers: [{ oneIn: 25, percent: 25 }] } }) },
      { grants: ["registry:store"], onHooks: (_policies, _notify, found) => { registrations = found; } },
    );
    await wired.session.ready;
    expect(Object.keys(registrations ?? {})).toEqual(["discountRoll"]);
    expect(registrations?.discountRoll?.({ cost: 100, oneIn: (n) => n === 25 })).toBe(25);
    expect(registrations?.discountRoll?.({ cost: 4, oneIn: () => true })).toBe(0);
  });

  it("refuses invalid policy tables as a whole and contributes nothing", async () => {
    const wired = wire({ api: API, policies: () => ({ messageText: [{ find: "x", replace: "y", match: "regex" }] }) as never });
    await wired.session.ready;
    expect(wired.problems.join("\n")).toMatch(/its policies are not valid/u);
    expect(workerModHooks("probe")).toBeUndefined();
  });

  it("prices armor from Worker data in the host and restores the live handler on teardown", async () => {
    const reg = new ObjRegistry(pack.obj);
    const constants = bindConstants(pack.constants);
    const rng = new Rng(1);
    const kind = reg.kinds.find((candidate) => candidate.name === "Studded Leather Armour~")!;
    const obj = objectPrep(rng, reg, constants, kind, 0, "minimise");
    obj.toA = 2;
    const before = rng.getState();
    expect(objectValueReal(reg, obj, 1)).toBe(266);
    tvalRegistry().valueAdjust.set(obj.tval, () => 1234);
    let active = true;
    let received: unknown;
    const wired = wire({
      api: API,
      policies: (context) => {
        expect(context.engine).toBeUndefined();
        return { valueFloor: { kind: "valueFloor", tvals: [10, 11, 12, 13, 14, 15, 16, 17, 18], appliesTo: "egoOrPositiveToA", comparison: "cheapestPlainSameTvalWithStrictlyGreaterAc", price: "objectValueReal" } };
      },
    }, {
      grants: ["registry:tval"],
      onHooks: (_hooks, _notify, registrations) => {
        received = registrations.valueFloor;
        installApi2PolicyRegistrations(registrations, { stores: null, tiles: null, valueAdjust: tvalRegistry().valueAdjust }, () => active);
      },
      onTeardown: () => { active = false; },
    });
    await wired.session.ready;
    expect(received).toMatchObject({ kind: "valueFloor", price: "objectValueReal" });
    expect(objectValueReal(reg, obj, 1)).toBe(336);
    expect(objectValueReal(reg, obj, 3)).toBe(1008);
    expect(rng.getState()).toEqual(before);
    wired.session.teardown();
    expect(objectValueReal(reg, obj, 1)).toBe(1234);
  });

  it("refuses a malformed Worker value floor before registering a handler", async () => {
    let registrations: Api2PolicyRegistrations = {};
    const wired = wire({ api: API, policies: () => ({ valueFloor: { kind: "unknown" } }) as never }, {
      grants: ["registry:tval"],
      onHooks: (_hooks, _notify, found) => { registrations = found; },
    });
    await wired.session.ready;
    expect(registrations).toEqual({});
    expect(wired.problems.join("\n")).toContain("valueFloor.kind");
    expect(tvalRegistry().valueAdjust.keys()).toEqual([]);
  });

  it("forwards the notification hooks it declared", async () => {
    const seen: unknown[] = [];
    const wired = wire({ api: API, hooks: () => ({ optionsChanged: (value: unknown) => { seen.push(value); } }) });
    await wired.session.ready;
    workerModHooks("probe")?.optionsChanged?.({ changed: ["a"] } as never);
    await vi.waitFor(() => expect(seen).toEqual([{ changed: ["a"] }]));
  });
});

describe("a host-owned walk declaration", () => {
  const policies: Api2Policies = {
    walkBlockedByDiggable: { kind: "walk-blocked-by-diggable", attempt: "tunnel", energy: "move", step: false },
  };

  function wallState(skill: number, terrain: string, known = true): GameState {
    const { state } = startGame(pack, { seed: SEED, depth: DEPTH });
    state.actor.grid = loc(15, 10);
    state.chunk.setFeat(state.actor.grid, state.chunk.features.byCodeName("FLOOR").fidx);
    state.chunk.setFeat(loc(16, 10), state.chunk.features.byCodeName(terrain).fidx);
    if (known) squareMemorize(state, loc(16, 10));
    else squareForget(state, loc(16, 10));
    state.bestDiggerDigging = () => skill;
    (state.actor.combat.skills as number[])[SKILL.DIGGING] = skill;
    return state;
  }

  it.each([0, 200])("matches the live hook for a failed or successful attempt at digging skill %s", async (skill) => {
    const workerState = wallState(skill, "GRANITE");
    const pluginState = wallState(skill, "GRANITE");
    const liveState = wallState(skill, "GRANITE");
    const diggingSkill = skill === 0 ? 41 : 2000;
    for (const state of [workerState, pluginState, liveState]) state.bestDiggerDigging = () => diggingSkill;
    if (skill === 0) for (const state of [workerState, pluginState, liveState]) vi.spyOn(state.rng, "randint0").mockReturnValue(1599);
    const pending = workerModHooks("probe");
    const wired = wire({ api: API, policies: (context) => {
      expect(context.engine).toBeUndefined();
      return policies;
    } }, { grants: ["registry:command"] });
    await wired.session.ready;
    workerState.modHooks = pending!;
    const grants = CapabilitySet.fromManifest({ id: "dig", name: "Dig", version: "1.0.0", shape: "plugin", capabilities: ["registry:command"] });
    const plugin = api2Plugin({ api: API, policies: () => policies }, () => ({ grants }));
    pluginState.modHooks = plugin.hooks!(modPluginContext("dig", {}, undefined, {}, { capabilities: grants }))!;
    liveState.modHooks = { walkBlockedByDiggable: (state, grid, deps) => {
      if (!movementTunnelTest(state, grid)) return null;
      tunnelAux(state, grid, deps as CaveCmdDeps);
      return state.z.moveEnergy;
    } };
    for (const state of [workerState, pluginState, liveState]) {
      expect(walkAction(state, { code: "walk", dir: 6 })).toBe(state.z.moveEnergy);
      expect(state.actor.grid).toEqual(loc(15, 10));
      expect(state.chunk.isPassable(loc(16, 10))).toBe(skill !== 0);
    }
    expect(workerState.rng.getState()).toEqual(liveState.rng.getState());
    expect(pluginState.rng.getState()).toEqual(liveState.rng.getState());
    if (skill === 0) expect(workerState.rng.randint0).toHaveBeenCalledExactlyOnceWith(1600);
  });

  it.each([["RUBBLE", 200, false], ["PERM", 200, true], ["GRANITE", 20, true]] as const)("declines %s at skill %s with known=%s without a draw", async (terrain, skill, known) => {
    const state = wallState(skill, terrain, known);
    const wired = wire({ api: API, policies: () => policies }, { grants: ["registry:command"] });
    await wired.session.ready;
    state.modHooks = workerModHooks("probe")!;
    const before = state.rng.getState();
    expect(walkAction(state, { code: "walk", dir: 6 })).toBe(0);
    expect(state.rng.getState()).toEqual(before);
    expect(state.actor.grid).toEqual(loc(15, 10));
  });

  it("uses load order and releases both pending and settled contributions on stop", async () => {
    const state = wallState(2000, "GRANITE");
    const pending = workerModHooks("probe");
    const wired = wire({ api: API, policies: () => policies }, { grants: ["registry:command"] });
    await wired.session.ready;
    const settled = workerModHooks("probe");
    const earlier = { walkBlockedByDiggable: () => 37 };
    const before = state.rng.getState();
    state.modHooks = composeModHooks([settled!, earlier])!;
    expect(walkAction(state, { code: "walk", dir: 6 })).toBe(37);
    expect(state.rng.getState()).toEqual(before);
    wired.session.teardown();
    for (const hooks of [pending, settled]) {
      state.modHooks = composeModHooks([earlier, hooks!])!;
      expect(walkAction(state, { code: "walk", dir: 6 })).toBe(37);
      expect(state.rng.getState()).toEqual(before);
    }
    const grants = CapabilitySet.fromManifest({ id: "dig", name: "Dig", version: "1.0.0", shape: "plugin", capabilities: ["registry:command"] });
    const plugin = api2Plugin({ api: API, policies: () => policies }, () => ({ grants }));
    const hooks = plugin.hooks!(modPluginContext("dig", {}, undefined, {}, { capabilities: grants }));
    state.modHooks = composeModHooks([earlier, hooks!])!;
    expect(walkAction(state, { code: "walk", dir: 6 })).toBe(state.z.moveEnergy);
    state.chunk.setFeat(loc(16, 10), state.chunk.features.byCodeName("GRANITE").fidx);
    squareMemorize(state, loc(16, 10));
    plugin.uninstall!();
    const after = state.rng.getState();
    expect(walkAction(state, { code: "walk", dir: 6 })).toBe(37);
    expect(state.rng.getState()).toEqual(after);
  });
});

describe("preference errors during composition", () => {
  afterEach(() => {
    setApi2PolicyLoadOrder([]);
    setPrefErrorPolicy(null);
  });

  it.each([["process", "probe"], ["probe", "process"]])("keeps mixed-runtime contributions in %s then %s order before startup", async (first, second) => {
    const baseline = prefErrorPolicy();
    setApi2PolicyLoadOrder([first!, second!]);
    const grants = CapabilitySet.fromManifest({ id: "process", name: "Process", version: "1.0.0", shape: "plugin", capabilities: ["registry:ui-entry"] });
    const plugin = api2Plugin({ api: API, policies: () => ({ prefErrors: { kind: "pref-errors", continueAfterError: true, reportLimit: 1 } }) }, () => ({ grants }));
    plugin.hooks!(modPluginContext("process", {}, undefined, {}, { capabilities: grants }));
    const wired = wire({ api: API, policies: () => ({ prefErrors: { kind: "pref-errors", continueAfterError: true, reportLimit: 20 } }) }, { grants: ["registry:ui-entry"] });
    try {
      await wired.session.ready;
      expect(prefErrorPolicy()).toEqual({ continueAfterError: true, reportLimit: second === "probe" ? 20 : 1 });
      if (second === "probe") wired.session.teardown();
      else plugin.uninstall!();
      expect(prefErrorPolicy()).toEqual({ continueAfterError: true, reportLimit: first === "probe" ? 20 : 1 });
    } finally {
      plugin.uninstall!();
      wired.session.teardown();
    }
    expect(prefErrorPolicy()).toEqual(baseline);
  });

  it("matches the live preference setter, keeps valid input after an error, and caps reports at twenty", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const reg = game.booted.registries;
    const deps = { features: reg.features, objects: reg.objects, monsters: reg.monsters, traps: reg.traps };
    const table = () => new GlyphTable({ features: reg.features.allFeatures(), kinds: reg.objects.kinds, races: reg.monsters.races, traps: reg.traps, flavors: reg.objects.flavors });
    const text = [...Array.from({ length: 25 }, () => "feat:FLOOR:gloomy:4:37"), "feat:GRANITE:*:4:38"].join("\n");
    const live = table();
    setPrefErrorPolicy({ continueAfterError: true, reportLimit: 20 });
    const expected = processPrefText(text, deps, glyphTableSink(live));
    setPrefErrorPolicy(null);
    const before = game.state.rng.getState();
    const wired = wire({ api: API, policies: () => ({ prefErrors: { kind: "pref-errors", continueAfterError: true, reportLimit: 20 } }) }, { grants: ["registry:ui-entry"] });
    await wired.session.ready;
    const actual = table();
    expect(processPrefText(text, deps, glyphTableSink(actual))).toEqual(expected);
    expect(expected).toHaveLength(20);
    expect(actual.featGlyph(0, reg.features.byCodeName("GRANITE").fidx)).toEqual({ attr: 4, char: "&" });
    expect(actual.featGlyph(0, reg.features.byCodeName("GRANITE").fidx)).toEqual(live.featGlyph(0, reg.features.byCodeName("GRANITE").fidx));
    expect(game.state.rng.getState()).toEqual(before);
    wired.session.teardown();
    expect(prefErrorPolicy()).toEqual(UPSTREAM_PREF_ERROR_POLICY);
    expect(processPrefText(text, deps, glyphTableSink(table()))).toHaveLength(1);
  });

  it("releases a faulted in-process contribution and leaves the earlier Worker policy", async () => {
    setApi2PolicyLoadOrder(["probe", "process"]);
    const wired = wire({ api: API, policies: () => ({ prefErrors: { kind: "pref-errors", continueAfterError: true, reportLimit: 20 } }) }, { grants: ["registry:ui-entry"] });
    await wired.session.ready;
    const grants = CapabilitySet.fromManifest({ id: "process", name: "Process", version: "1.0.0", shape: "plugin", capabilities: ["registry:ui-entry"] });
    const plugin = api2Plugin({ api: API, policies: () => ({ prefErrors: { kind: "pref-errors", continueAfterError: false, reportLimit: 1 } }) }, () => ({ grants }));
    plugin.hooks!(modPluginContext("process", {}, undefined, {}, { capabilities: grants }));
    expect(prefErrorPolicy().continueAfterError).toBe(false);
    removeApi2PrefErrors("process");
    expect(prefErrorPolicy()).toEqual({ continueAfterError: true, reportLimit: 20 });
    plugin.uninstall!();
    expect(prefErrorPolicy()).toEqual({ continueAfterError: true, reportLimit: 20 });
  });
});

describe("a Worker mod's network access", () => {
  it("rejects oversized proxy calls locally without posting them", async () => {
    let found: string | undefined;
    const wired = wire({ api: API, start: async (api) => {
      try {
        await api.net!.request({ url: "https://api.example.com/x", method: "POST", body: "x".repeat(MAX_MESSAGE_BYTES) });
        found = "accepted";
      } catch (err) {
        found = (err as Error).message;
      }
    } }, { net: true });
    await started(wired, () => found);
    expect(found).toMatch(/larger than 65536 bytes/u);
    expect(wired.problems).toEqual([]);
  });

  it("answers identifiable oversized calls with a bounded error", async () => {
    const wired = wire({ api: API });
    await wired.session.ready;
    wired.session.start();
    wired.worker.scope.postMessage({
      type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1,
      requestId: 79, method: "store.prefs.set", args: ["x".repeat(MAX_MESSAGE_BYTES)],
    });
    await vi.waitFor(() => expect(wired.worker.sent.some((m) => m.type === "reply" && m.requestId === 79)).toBe(true));
    const response = wired.worker.sent.find((m) => m.type === "reply" && m.requestId === 79);
    expect(response).toMatchObject({ epoch: 1, ok: false, error: expect.stringMatching(/larger than 65536 bytes/u) });
    expect(JSON.stringify(response).length).toBeLessThan(512);
  });

  it("names a secret by reference; the value never crosses into the Worker", async () => {
    const secret = "hunter2-do-not-leak";
    const requests: NetRequest[] = [];
    const net: ModNet = {
      transport: "page",
      request: async (request: NetRequest): Promise<ModNetResponse> => {
        requests.push(request);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, status: 200, headers: {}, body: "fine" } as ModNetResponse;
      },
      secrets: {
        storage: "page",
        set: () => Promise.resolve({ ok: true, storage: "page" }),
        fromEnv: () => Promise.resolve({ ok: false, problem: "no" }),
        has: () => Promise.resolve({ present: secret.length > 0, storage: "page" }),
        delete: () => Promise.resolve({ ok: true }),
      },
    } as ModNet;
    let found: unknown;
    const grants = ["network:api.example.com"];
    const wired = wire({
      api: API,
      start: async (api) => {
        if (!api.net) throw new Error("no net domain");
        const response = await api.net.request({ url: "https://api.example.com/x", headers: { Authorization: api.net.credential("token", "Bearer "), "x-api-key": api.net.credential("token") } });
        found = { response, status: await api.net.credentials.status("token") };
      },
    }, { api: hostApi({ grants, net }), grants, net: true });
    await started(wired, () => found);
    expect(found).toMatchObject({ response: { ok: true, value: { status: 200, body: "fine" } }, status: { ok: true, value: { present: true } } });
    expect(requests[0]?.headers).toEqual({ Authorization: "Bearer {secret:token}", "x-api-key": "{secret:token}" });
    expect(JSON.stringify(wired.worker.sent)).not.toContain(secret);
    /* The request's wait is network time, apart from CPU time. */
    expect(wired.health.stats().find((s) => s.id === "probe")?.netMs).toBeGreaterThanOrEqual(15);
  });
});

describe("a Worker that stops answering", () => {
  it("is terminated and switched off with the stall notice", async () => {
    const wired = wire({ api: API }, { timing: { heartbeatMs: 10, stallMs: 60 } });
    await wired.session.ready;
    wired.session.start();
    /* It answers pings while it runs normally. */
    await vi.waitFor(() => expect(wired.health.stats().find((s) => s.id === "probe")?.replies).toBeGreaterThan(0));
    expect(wired.worker.terminated).toBe(false);
    wired.worker.stuck = true;
    await vi.waitFor(() => expect(wired.worker.terminated).toBe(true), { timeout: 2000 });
    expect(wired.health.isOff("probe")).toBe(true);
    expect(wired.switchedOff).toMatchObject([{ id: "probe", site: "heartbeat", reason: "stall" }]);
    expect(wired.switchedOff[0]?.why).toBe("its Worker went 60 ms without answering the game");
    expect(workerModHooks("probe")).toBeUndefined();
  });
});

describe("a Worker mod that fails to load", () => {
  it("rejects ready for a definition outside the API this build runs", async () => {
    const wired = wire({ api: ">=3.0.0" });
    await expect(wired.session.ready).rejects.toThrow(/"api": ">=3\.0\.0"/u);
    expect(wired.worker.terminated).toBe(true);
  });

  it("rejects ready for a default export that is not an API 2 definition", async () => {
    const wired = wire((() => undefined) as unknown as Api2ModDefinition);
    await expect(wired.session.ready).rejects.toThrow(/not an API 2 mod definition/u);
  });
});
