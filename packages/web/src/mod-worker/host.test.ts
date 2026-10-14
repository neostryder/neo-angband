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
  monsterIsObvious,
  startGame,
  type GamePack,
  type GameState,
  type Monster,
  type ModNet,
  type ModNetResponse,
  type StartedGame,
} from "@rpgm-tools/neo-angband-core";
import { API2_POLICY_KINDS, CapabilitySet, type Api2ModDefinition, type Api2Policies, type Api2PolicyRegistrations, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
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
    return createApi2Host(ctx, { grants: capabilities, ...options });
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
    onHooks: (policies, notify) =>
      settleWorkerHooks("probe", { policies, notify, send: (hook, args) => session.notify(hook, args) }),
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
    messageText: [{ find: "a", replace: "b" }], screenText: [{ find: "a", replace: "b" }],
    characterBackground: [{ find: "a", replace: "b" }], objectInfoText: [{ find: "a", replace: "b" }],
    effectIntro: [{ find: "a", replace: "b" }], historyAdd: [{ find: "a", replace: "b" }],
    historyDisplay: [{ find: "a", replace: "b" }], objectListOrder: ["dy"], saveNoiseScent: true,
    shapeLearnObviousFlagsDirectly: true, storeDiscountRoll: { tiers: [{ oneIn: 1, percent: 20 }] },
    tileMap: [{ monster: 2, like: 1 }],
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

  it("forwards the notification hooks it declared", async () => {
    const seen: unknown[] = [];
    const wired = wire({ api: API, hooks: () => ({ optionsChanged: (value: unknown) => { seen.push(value); } }) });
    await wired.session.ready;
    workerModHooks("probe")?.optionsChanged?.({ changed: ["a"] } as never);
    await vi.waitFor(() => expect(seen).toEqual([{ changed: ["a"] }]));
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
