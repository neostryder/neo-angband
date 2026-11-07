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
  NOSCORE,
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
  saveGame,
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
import { API2_POLICY_KINDS, CapabilitySet, MOD_PERMISSION_TEXT, type Api2ModDefinition, type Api2Policies, type Api2PolicyRegistrations, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { api2Plugin, installApi2PolicyRegistrations, removeApi2PrefErrors, setApi2PolicyLoadOrder } from "../mod-api2-shim";
import { createApi2Host } from "../mod-api2-host";
import { modPluginContext } from "../mod-context";
import { TRUTH_MAP, TRUTH_MONSTERS, resetModTiers, setModGrants } from "../mod-tier";
import { recordTruthUse, setTruthSaveWriter } from "../mod-truth-consent";
import { ModHealthMonitor, type ModSwitchOff } from "../mod-health";
import type { ModPrefs } from "../mod-prefs";
import { installModWorkerBootstrap, type WorkerScope } from "./bootstrap";
import { resetWorkerHooks, settleWorkerHooks, workerModHooks } from "./hooks";
import {
  startModWorker,
  MAX_MESSAGE_BYTES,
  MAX_REPLY_BYTES,
  MAX_CALLS_PER_SECOND,
  WorkerTimeoutError,
  type ModWorkerHostDeps,
  type ModWorkerLike,
  type StartedModWorker,
  type WorkerApiOptions,
} from "./host";
import { MOD_WORKER_PROTOCOL_VERSION, type HostToModWorker, type ModWorkerToHost, type WorkerJson } from "./protocol";
import { setConsentBindings } from "../mod-consent-binding";
import { createModProfiles } from "../profile-runtime";
import { ProfileStore } from "../profiles";
import { scopedStorage, type ScopedStorage } from "../profile-scope";
import { buildCatalog, ModStore, MOD_STATE_STORAGE_KEY } from "../mod-store";
import { createModSaves, type SavesDoorDeps } from "../saves-facade";
import type { CharMeta } from "../roster";
import type { WorkerManagementHost } from "../mod-api2-host";
import { createModManagerService } from "../mod-manager/service";

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
      ...(setup.game ? { registries: setup.game.booted.registries } : {}),
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
    installModWorkerBootstrap(this.scope, MOD_WORKER_PROTOCOL_VERSION, () => Promise.resolve({ default: definition }), MOD_PERMISSION_TEXT);
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
  resetModTiers();
  setTruthSaveWriter(undefined);
  setConsentBindings(new Map());
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

async function managementProbe(grants = ["profiles:manage", "session:control", "options:manage", "saves:manage"]) {
  const values = new Map<string, string>();
  const storage: ScopedStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); }, get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null };
  const manifest = { id: "probe", name: "Probe", version: "1.0.0", shape: "plugin" as const, capabilities: grants, settings: [{ id: "amount", title: "Amount", description: "Amount", min: 0, max: 10, step: 1, default: 1 }], sections: [{ id: "part", title: "Part", flag: "probe.part" }] };
  const caps = CapabilitySet.fromManifest(manifest);
  const authorize = (held: readonly string[]) => setModGrants(new Map([["probe", { granted: held, refusedByTier: [], refusedByPlayer: [], undecided: [], blocking: [] }]]));
  setConsentBindings(new Map([["probe", "probe-digest"], ["victim", "victim-digest"]]));
  authorize(grants);
  const store = new ModStore(storage);
  store.setDecisions("probe", { granted: grants, refused: [], binding: "probe-digest" }, "1.0.0");
  store.setDecisions("victim", { granted: ["engine:access"], refused: [], binding: "victim-digest" }, "1.0.0");
  const consent = () => storage.getItem(MOD_STATE_STORAGE_KEY);
  const beforeConsent = consent();
  const manager = createModManagerService({ store, listCatalog: () => buildCatalog({ content: [], sandbox: [], trusted: [manifest, { ...manifest, id: "victim", name: "Victim", capabilities: ["engine:access"] }], enabled: store.getEnabled(), consents: store.getConsents(), refusals: store.getRefusals() }) });
  const profilesStore = new ProfileStore(storage);
  const reload = vi.fn();
  const profiles = createModProfiles("probe", caps, { store: profilesStore, storage, pendingStorage: storage, installed: () => [manifest], hasController: () => true, reload, canSwitch: () => ({ ok: true }) });
  const foreignProfile = profilesStore.create("Another profile");
  const character: CharMeta = { id: "raw-a", name: "Alice", race: "Human", cls: "Mage", sex: "", level: 1, depth: 0, maxDepth: 0, turn: 0, alive: true, updatedAt: 1 };
  let roster = [character, { ...character, id: "raw-b", name: "Bob" }];
  let active: string | null = null;
  let scope = "profile-a";
  const load = vi.fn(async (_id: string, current?: () => boolean, _resumeModId?: string) => current?.() ? { ok: true as const } : { ok: false as const, reason: "Revoked" });
  const rename = vi.fn(() => ({ ok: true as const }));
  const deleteSlot = vi.fn((id: string) => { roster = roster.filter((entry) => entry.id !== id); });
  const saveDeps: SavesDoorDeps = { listRoster: () => roster, load, rename, renameStored: rename, deleteSlot, confirmDelete: vi.fn(async () => true), activeSlot: () => active, namePinned: () => false, fingerprint: (id) => `save:${id}` };
  const saves = createModSaves(saveDeps);
  const game = startGame(pack, { seed: SEED, depth: DEPTH });
  const save = vi.fn(() => ({ ok: true as const }));
  const host: WorkerManagementHost = {
    confirm: vi.fn(async () => true), pickSaves: vi.fn(async () => ["raw-a"]), scope: () => scope,
    markCheat: vi.fn(() => { expect(game.state.options!.get("cheat_live")).toBe(false); game.state.actor.player.noscore |= 2; return true; }), saveOptions: vi.fn(),
  };
  let proxy: ModApi2 | undefined;
  const wired = wire({ api: API, start: (api) => { proxy = api; } }, { grants, api: () => createApi2Host({ ...modPluginContext("probe", {}, game.state, {}, { capabilities: caps }), profiles, saves, session: { save, exitToTitle: vi.fn(), quit: vi.fn() } }, { execution: "worker", grants: caps, workerManagement: host, management: async () => manager.service }) });
  const api = await started(wired, () => proxy);
  let requestId = 1000;
  const raw = async (method: string, args: import("./protocol").WorkerJson[] = [], epoch = 1) => {
    const id = ++requestId;
    wired.worker.scope.postMessage({ type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch, requestId: id, method, args });
    await vi.waitFor(() => expect(wired.worker.sent.some((message) => message.type === "reply" && message.requestId === id)).toBe(true));
    const reply = wired.worker.sent.find((message) => message.type === "reply" && message.requestId === id);
    if (reply?.type !== "reply") throw new Error("The broker did not reply.");
    return reply.ok ? reply.result : { error: reply.error };
  };
  const selected = async () => {
    const result = await api.manage!.saves.list();
    if (!result.ok) throw new Error("The player selection failed.");
    return result.value[0]!.id;
  };
  return { api, wired, raw, selected, host, load, rename, deleteSlot, save, authorize, profiles, profilesStore, storage, caps, game, reload, foreignProfile, consent, beforeConsent, setActive: (id: string | null) => { active = id; }, setScope: (value: string) => { scope = value; }, changeRoster: () => { roster = roster.map((entry) => ({ ...entry, updatedAt: entry.updatedAt + 1 })); } };
}

describe("Worker management", () => {
  it("redacts the manager snapshot across the port and confirms its own configuration changes", async () => {
    const f = await managementProbe();
    expect(await f.api.manage!.mods.snapshot()).toEqual({ ok: true, value: { id: "probe", name: "Probe" } });
    vi.mocked(f.host.confirm).mockResolvedValue(false);
    expect(await f.api.manage!.mods.setSettingValue("probe", "amount", 4)).toMatchObject({ ok: false });
    expect(await f.api.manage!.mods.setSectionChoice("victim", "part", false)).toMatchObject({ ok: false });
    expect(f.consent()).toBe(f.beforeConsent);
    vi.mocked(f.host.confirm).mockResolvedValue(true);
    expect(await f.api.manage!.mods.setSettingValue("probe", "amount", 4)).toMatchObject({ ok: true });
    expect(new ModStore(f.storage).getSettingValues().probe?.amount).toBe(4);
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it.each(["manage.profiles.create", "manage.session.save", "manage.options.set", "manage.saves.list"])("refuses an ungranted %s before asking or mutating", async (method) => {
    const f = await managementProbe([]);
    const args = method === "manage.profiles.create" ? ["Denied"] : method === "manage.options.set" ? [{ values: { cheat_live: true } }] : [];
    expect(await f.raw(method, args)).toMatchObject({ ok: false, reason: "not-granted" });
    expect(f.host.confirm).not.toHaveBeenCalled();
    expect(f.host.pickSaves).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.profilesStore.list()).toHaveLength(2);
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("uses explicit proxies and opaque ids for only the player-selected characters", async () => {
    const f = await managementProbe();
    const id = await f.selected();
    expect(id).not.toBe("raw-a");
    expect(JSON.stringify(await f.api.manage!.saves.list())).not.toContain("raw-");
    const fresh = await f.selected();
    expect(await f.api.manage!.saves.load(id)).toMatchObject({ ok: false });
    expect(await f.api.manage!.saves.load("raw-a")).toMatchObject({ ok: false });
    expect(await f.api.manage!.saves.rename("raw-b", "Stolen")).toMatchObject({ ok: false });
    expect(await f.api.manage!.saves.load(fresh, { resumeAutoplayer: true })).toMatchObject({ ok: true });
    expect(f.load).toHaveBeenCalledWith("raw-a", expect.any(Function), "probe");
    expect(await f.api.manage!.saves.rename(fresh, "Allowed")).toMatchObject({ ok: true });
    expect(f.rename).toHaveBeenCalledWith("raw-a", "Allowed");
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("refuses missing and revoked grants and does not expose install or consent writers", async () => {
    const f = await managementProbe(["profiles:manage"]);
    expect(await f.raw("manage.session.save")).toMatchObject({ reason: "not-granted" });
    for (const method of ["manage.mods.recordConsent", "manage.mods.setDecisions", "manage.mods.resolveConfirmation", "manage.mods.copyScopedStorage", "manage.mods.enable", "manage.screens.take", "manage.loadForSession", "manage.wizard", "manage.session.quit", "manage.session.exitToTitle"]) {
      expect(await f.raw(method)).toHaveProperty("error");
    }
    f.authorize([]);
    expect(await f.raw("manage.profiles.create", ["Denied"])).toMatchObject({ ok: false, code: "revoked" });
    expect(f.profilesStore.list()).toHaveLength(2);
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("rejects stale epochs, spoofed callers, malformed arguments, and oversized messages before mutation", async () => {
    const f = await managementProbe();
    const count = f.wired.worker.sent.length;
    f.wired.worker.scope.postMessage({ type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "victim", epoch: 1, requestId: 9, method: "manage.session.save", args: [] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(f.wired.worker.sent).toHaveLength(count);
    expect(await f.raw("manage.session.save", [], 0)).toHaveProperty("error");
    expect(await f.raw("manage.profiles.create", ["x".repeat(121)])).toMatchObject({ ok: false, code: "bad-call" });
    expect(await f.raw("manage.profiles.create", ["Name", null])).toMatchObject({ ok: false, code: "bad-call" });
    expect(await f.raw("manage.options.set", [{ values: { use_sound: "yes" } }])).toMatchObject({ ok: false, code: "bad-call" });
    expect(await f.raw("manage.profiles.create", ["x".repeat(MAX_MESSAGE_BYTES)])).toHaveProperty("error");
    expect(f.save).not.toHaveBeenCalled();
    expect(f.host.confirm).not.toHaveBeenCalled();
    expect(f.profilesStore.list()).toHaveLength(2);
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("declines every mutation without changing consent, profiles, characters, or options", async () => {
    const f = await managementProbe();
    const id = await f.selected();
    vi.mocked(f.host.confirm).mockResolvedValue(false);
    for (const [method, args] of [["manage.profiles.create", ["Declined"]], ["manage.options.set", [{ values: { cheat_live: true } }]], ["manage.session.save", []], ["manage.saves.load", [id]], ["manage.saves.rename", [id, "Declined"]], ["manage.saves.delete", [id]]] as const) {
      expect(await f.raw(method, [...args])).toMatchObject({ ok: false });
    }
    expect(f.load).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.deleteSlot).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.host.markCheat).not.toHaveBeenCalled();
    expect(f.game.state.options!.get("cheat_live")).toBe(false);
    expect(f.profilesStore.list()).toHaveLength(2);
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it.each(["binding", "grant", "epoch", "plan"])("refuses a %s change during the dialog", async (change) => {
    const f = await managementProbe();
    const id = await f.selected();
    vi.mocked(f.host.confirm).mockImplementation(async () => {
      if (change === "binding") setConsentBindings(new Map([["probe", "replacement-digest"]]));
      if (change === "grant") f.authorize([]);
      if (change === "epoch") f.wired.session.teardown();
      if (change === "plan") f.changeRoster();
      return true;
    });
    if (change === "epoch") {
      const pending = f.api.manage!.saves.delete(id).catch(() => {});
      await vi.waitFor(() => expect(f.host.confirm).toHaveBeenCalled());
      await pending;
    } else expect(await f.api.manage!.saves.delete(id)).toMatchObject({ ok: false });
    expect(f.deleteSlot).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("refuses active-slot deletion both initially and after the confirmation", async () => {
    const f = await managementProbe();
    const id = await f.selected();
    f.setActive("raw-a");
    expect(await f.api.manage!.saves.delete(id)).toMatchObject({ ok: false });
    f.setActive(null);
    vi.mocked(f.host.confirm).mockImplementation(async () => { f.setActive("raw-a"); return true; });
    expect(await f.api.manage!.saves.delete(id)).toMatchObject({ ok: false });
    expect(f.deleteSlot).not.toHaveBeenCalled();
  });

  it("binds save ids to the profile and refuses another profile's raw id", async () => {
    const f = await managementProbe();
    const id = await f.selected();
    f.setScope("profile-b");
    expect(await f.api.manage!.saves.load(id)).toMatchObject({ ok: false });
    expect(f.load).not.toHaveBeenCalled();
    expect(await f.raw("manage.profiles.switchTo", [f.foreignProfile])).toMatchObject({ ok: false });
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("creates profiles without consent, pins, or preferences and requires destination consent for birth", async () => {
    const f = await managementProbe();
    const result = await f.api.manage!.profiles.create("Own profile");
    if (!result.ok || result.value.id === null) throw new Error("The profile was not created.");
    const target = scopedStorage(f.storage, result.value.id);
    expect(new ModStore(target).getConsents()).toEqual({});
    expect(new ModStore(target).getPins()).toEqual([]);
    expect(target.getItem("neo:modPrefs:probe")).toBeNull();
    expect(await f.raw("manage.profiles.switchTo", [result.value.id, { kind: "create-character" }])).toMatchObject({ ok: false });
    expect(await f.raw("manage.profiles.rename", [f.foreignProfile, "Stolen"])).toMatchObject({ ok: false });
    expect(await f.raw("manage.profiles.rename", [result.value.id, "Renamed"])).toMatchObject({ ok: true });
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("marks cheat consequences before changing options and keeps birth options refused", async () => {
    const f = await managementProbe();
    expect(await f.api.manage!.options.set({ values: { cheat_live: true } })).toMatchObject({ ok: true });
    expect(f.host.markCheat).toHaveBeenCalledTimes(1);
    expect(f.game.state.actor.player.noscore).not.toBe(0);
    expect(f.game.state.options!.get("score_live")).toBe(true);
    expect(await f.api.manage!.options.set({ values: { birth_no_recall: true } })).toMatchObject({ ok: false });
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("refuses an option transaction when the durable cheat mark fails", async () => {
    const f = await managementProbe();
    vi.mocked(f.host.markCheat).mockReturnValue(false);
    expect(await f.api.manage!.options.set({ values: { cheat_live: true, use_sound: true } })).toMatchObject({ ok: false });
    expect(f.game.state.options!.get("cheat_live")).toBe(false);
    expect(f.game.state.options!.get("use_sound")).toBe(false);
    expect(f.host.saveOptions).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("rechecks authorization after an asynchronous load prerequisite", async () => {
    const f = await managementProbe();
    const id = await f.selected();
    let release: (() => void) | undefined;
    const committed = vi.fn();
    f.load.mockImplementation(async (_id, current) => {
      await new Promise<void>((resolve) => { release = resolve; });
      if (!current?.()) return { ok: false, reason: "Revoked" };
      committed();
      return { ok: true };
    });
    const pending = f.api.manage!.saves.load(id);
    await vi.waitFor(() => expect(release).toBeDefined());
    f.authorize([]);
    release!();
    expect(await pending).toMatchObject({ ok: false });
    expect(committed).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("keeps a confirmed profile rename and switch unchanged after a declined dialog", async () => {
    const f = await managementProbe();
    const created = await f.api.manage!.profiles.create("Owned");
    if (!created.ok || !created.value.id) throw new Error("The profile was not created.");
    vi.mocked(f.host.confirm).mockResolvedValue(false);
    expect(await f.raw("manage.profiles.rename", [created.value.id, "Declined"])).toMatchObject({ ok: false });
    expect(await f.api.manage!.profiles.switchTo(created.value.id)).toMatchObject({ ok: false });
    expect(f.profilesStore.list().find((profile) => profile.id === created.value.id)?.name).toBe("Owned");
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("refuses a profile birth plan when destination decisions change during confirmation", async () => {
    const f = await managementProbe();
    const created = f.profiles.create("Destination");
    if (!created.ok || !created.value.id) throw new Error("The profile was not created.");
    const destination = new ModStore(scopedStorage(f.storage, created.value.id));
    vi.mocked(f.host.confirm).mockImplementation(async () => {
      destination.setDecisions("probe", { granted: ["profiles:manage", "session:control", "options:manage", "saves:manage"], refused: [], binding: "probe-digest" }, "1.0.0");
      return true;
    });
    expect(await f.api.manage!.profiles.switchTo(created.value.id, { kind: "create-character" })).toMatchObject({ ok: false, code: "changed" });
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("serializes pending dialogs and bounds management call rate", async () => {
    const f = await managementProbe();
    let answer: ((value: boolean) => void) | undefined;
    vi.mocked(f.host.confirm).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const pending = f.api.manage!.session.save();
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect(await f.api.manage!.session.save()).toMatchObject({ ok: false, code: "busy" });
    answer!(false);
    await pending;
    for (let count = 0; count < 31; count++) await f.api.manage!.profiles.list();
    expect(await f.api.manage!.session.save()).toMatchObject({ ok: false, code: "rate" });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });

  it("refuses profile creation at its storage limit without opening a dialog", async () => {
    const f = await managementProbe();
    for (let index = 0; index < 64; index++) expect(f.profiles.create(`Profile ${index}`).ok).toBe(true);
    const before = f.profilesStore.list();
    expect(await f.api.manage!.profiles.create("Overflow")).toMatchObject({ ok: false, code: "quota" });
    expect(f.profilesStore.list()).toEqual(before);
    expect(f.host.confirm).not.toHaveBeenCalled();
    expect(f.consent()).toBe(f.beforeConsent);
  });
});

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

describe("Worker truth reads", () => {
  const hold = (granted: readonly string[]): void => setModGrants(new Map([["probe", {
    granted, refusedByTier: [], refusedByPlayer: [], undecided: [], blocking: [],
  }]]));
  const send = (wired: Wired, requestId: number, method = "truth.monsters", args: readonly WorkerJson[] = [], pluginId = "probe", epoch = 1): void => {
    wired.worker.scope.postMessage({ type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId, epoch, requestId, method, args });
  };
  const reply = (wired: Wired, requestId: number) => wired.worker.sent.find((m) => m.type === "reply" && m.requestId === requestId);
  const ready = async (grants: readonly string[], api = hostApi({ grants })): Promise<Wired> => {
    hold(grants);
    const wired = wire({ api: API }, { grants, api });
    await wired.session.ready;
    wired.session.start();
    return wired;
  };

  it.each([TRUTH_MAP, TRUTH_MONSTERS])("saves %s before a Worker reads and crashes", async (capability) => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    let saved: ReturnType<typeof saveGame> | undefined;
    setTruthSaveWriter(async (id, used, state) => {
      recordTruthUse(game.manifest, state.actor.player, { installation: "binding", id, version: "1.0.0", digest: "digest" }, used,
        { turn: state.turn, depth: state.chunk.depth });
      saved = structuredClone(saveGame(game));
      return true;
    });
    hold([capability]);
    let crashed = false;
    const wired = wire({ api: API, start: async (api) => {
      const result = await api.truth!.monsters();
      expect(result.ok).toBe(true);
      expect(saved?.manifest?.modNoscore).toBe(true);
      expect(saved?.manifest?.capabilityUse?.entries[0]).toMatchObject({ id: "probe", capability, consequence: "hidden-information" });
      expect((saved!.player.noscore ?? 0) & NOSCORE.DEBUG).not.toBe(0);
      crashed = true;
      throw new Error("crash after truth");
    } }, { grants: [capability], api: hostApi({ game, grants: [capability] }) });
    await started(wired, () => crashed ? true : undefined);
    await vi.waitFor(() => expect(wired.problems.join(" ")).toContain("crash after truth"));
    expect(game.manifest.determinism).toBe("deterministic");
  });

  it.each([TRUTH_MAP, TRUTH_MONSTERS])("exposes exactly the reads granted by %s", async (capability) => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const hidden = liveMonsters(game.state).find((mon) => !monsterIsObvious(mon))!;
    setTruthSaveWriter(() => true);
    hold([capability]);
    let done = false;
    const wired = wire({ api: API, start: async (api) => {
      const monsters = await api.truth!.monsters();
      expect(monsters.ok).toBe(true);
      if (monsters.ok) expect(monsters.value.find((mon) => mon.id === hidden.midx)).toMatchObject({ perceived: false });
      const race = await api.truth!.race(hidden.race.ridx);
      expect(race.ok && race.value?.ridx).toBe(hidden.race.ridx);
      expect((await api.truth!.level()).ok).toBe(capability === TRUTH_MAP);
      expect((await api.truth!.storeKnowledge()).ok).toBe(capability === TRUTH_MAP);
      done = true;
    } }, { grants: [capability], api: hostApi({ game, grants: [capability] }) });
    await started(wired, () => done ? true : undefined);
  });

  it.each([true, false])("keeps a controller using truth unscorable with firstParty=%s", async (firstParty) => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const grants = [TRUTH_MONSTERS, "input:controller", "input:intent", "state:interaction.read"];
    hold(grants);
    let saved: ReturnType<typeof saveGame> | undefined;
    setTruthSaveWriter((id, capability, state) => {
      recordTruthUse(game.manifest, state.actor.player, { installation: "binding", id, version: "1", digest: "digest" }, capability, null);
      saved = structuredClone(saveGame(game));
      return true;
    });
    const wired = wire({ api: API, controller: async (api) => {
      expect((await api.truth!.monsters()).ok).toBe(true);
      expect(saved?.manifest?.modNoscore).toBe(true);
      expect(saved?.manifest?.capabilityUse?.entries[0]?.consequence).toBe("hidden-information");
      expect((saved!.player.noscore ?? 0) & NOSCORE.DEBUG).not.toBe(0);
    } }, { grants, api: hostApi({ game, grants, options: { tier: firstParty ? "first-party" : "public" } }) });
    await wired.session.ready;
    expect(wired.session.hasController()).toBe(true);
    wired.session.start();
    await wired.session.decide({ token: { epoch: 0, revision: 1 }, phase: "play", messagePending: false, prompt: null } as never, {} as ModApi2);
    expect(saved).toBeDefined();
  });

  it("omits truth without a grant and refuses a forged call without mutation", async () => {
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    let absent: boolean | undefined;
    const wired = wire({ api: API, start: (api) => { absent = api.truth === undefined; } });
    expect(await started(wired, () => absent)).toBe(true);
    send(wired, 101);
    await vi.waitFor(() => expect(reply(wired, 101)).toMatchObject({ result: { reason: "not-granted" } }));
    expect(writer).not.toHaveBeenCalled();
  });

  it("refuses a grant revoked before admission without marking", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    const wired = await ready([TRUTH_MAP], hostApi({ game, grants: [TRUTH_MAP] }));
    hold([]);
    send(wired, 102);
    await vi.waitFor(() => expect(reply(wired, 102)).toMatchObject({ result: { reason: "not-granted" } }));
    expect(writer).not.toHaveBeenCalled();
  });

  it("drops a reply revoked while the save writer waits", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    let release: ((ok: boolean) => void) | undefined;
    setTruthSaveWriter(() => new Promise((resolve) => { release = resolve; }));
    const wired = await ready([TRUTH_MAP], hostApi({ game, grants: [TRUTH_MAP] }));
    send(wired, 103);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(reply(wired, 103)).toBeUndefined();
    hold([]);
    release!(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply(wired, 103)).toBeUndefined();
  });

  it.each([false, true])("drops a reply revoked during serialization, including copy failure=%s", async (failCopy) => {
    const wired = await ready([TRUTH_MAP], () => ({
      meta: { granted: () => true },
      truth: { monsters: () => ({ ok: true, value: { get hidden() {
        hold([]);
        if (failCopy) throw new Error("copy failed");
        return "hidden";
      } } }) },
    }) as unknown as ModApi2);
    send(wired, 104);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply(wired, 104)).toBeUndefined();
  });

  it("refuses a spoofed identity and stale epoch without marking", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    const wired = await ready([TRUTH_MAP], hostApi({ game, grants: [TRUTH_MAP] }));
    send(wired, 105, "truth.monsters", [], "victim");
    send(wired, 106, "truth.monsters", [], "probe", 0);
    await vi.waitFor(() => expect(reply(wired, 106)).toMatchObject({ ok: false, error: expect.stringMatching(/epoch/u) }));
    expect(reply(wired, 105)).toBeUndefined();
    expect(writer).not.toHaveBeenCalled();
  });

  it("refuses replay of a formerly valid epoch after a timeout", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    hold([TRUTH_MAP]);
    const wired = wire({ api: API, migrateBag: () => new Promise(() => undefined) as never }, {
      grants: [TRUTH_MAP], api: hostApi({ game, grants: [TRUTH_MAP] }), timing: { askMs: 10 },
    });
    await wired.session.ready;
    wired.session.start();
    await expect(wired.session.migrateBag({}, 0)).rejects.toBeInstanceOf(WorkerTimeoutError);
    send(wired, 116);
    await vi.waitFor(() => expect(reply(wired, 116)).toMatchObject({ epoch: 1, ok: false, error: expect.stringMatching(/epoch/u) }));
    expect(writer).not.toHaveBeenCalled();
  });

  it.each([
    ["truth.monsters", [true]], ["truth.level", [{}]], ["truth.storeKnowledge", [0]],
    ["truth.race", []], ["truth.race", [-1]], ["truth.race", [1.5]], ["truth.race", ["1"]],
    ["truth.race", [0, 1]], ["truth.race", [{ capability: TRUTH_MAP }]],
  ] as const)("refuses malformed %s arguments %j without marking", async (method, args) => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    const wired = await ready([TRUTH_MAP], hostApi({ game, grants: [TRUTH_MAP] }));
    send(wired, 107, method, args as readonly WorkerJson[]);
    await vi.waitFor(() => expect(reply(wired, 107)).toMatchObject({ result: { code: "bad-call" } }));
    expect(writer).not.toHaveBeenCalled();
  });

  it("refuses an oversized truth request without marking", async () => {
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    const wired = await ready([TRUTH_MAP]);
    send(wired, 108, "truth.race", ["x".repeat(MAX_MESSAGE_BYTES)]);
    await vi.waitFor(() => expect(reply(wired, 108)).toMatchObject({ ok: false }));
    expect(JSON.stringify(reply(wired, 108)).length).toBeLessThan(512);
    expect(writer).not.toHaveBeenCalled();
  });

  it("retains the durable mark when the reply exceeds 4 MiB", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    let saved: ReturnType<typeof saveGame> | undefined;
    setTruthSaveWriter((id, capability, state) => {
      recordTruthUse(game.manifest, state.actor.player, { installation: "binding", id, version: "1", digest: "digest" }, capability, null);
      saved = structuredClone(saveGame(game));
      return true;
    });
    const real = hostApi({ game, grants: [TRUTH_MAP] });
    const wired = await ready([TRUTH_MAP], (options) => {
      const api = real(options);
      return { ...api, truth: { ...api.truth!, monsters: async () => {
        const result = await api.truth!.monsters();
        return result.ok ? { ok: true, value: "x".repeat(MAX_REPLY_BYTES) } : result;
      } } } as unknown as ModApi2;
    });
    send(wired, 109);
    await vi.waitFor(() => expect(reply(wired, 109)).toMatchObject({ ok: false }));
    expect(JSON.stringify(reply(wired, 109)).length).toBeLessThan(512);
    expect(saved?.manifest?.modNoscore).toBe(true);
    expect(saved?.manifest?.capabilityUse?.entries[0]?.capability).toBe(TRUTH_MAP);
  });

  it("refuses truth calls past 200 per second before marking", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    const wired = await ready([TRUTH_MAP], hostApi({ game, grants: [TRUTH_MAP] }));
    for (let i = 1; i <= MAX_CALLS_PER_SECOND + 1; i++) send(wired, i, "truth.race", [0]);
    await vi.waitFor(() => expect(reply(wired, MAX_CALLS_PER_SECOND + 1)).toMatchObject({ result: { code: "rate" } }));
    expect(writer).toHaveBeenCalledTimes(MAX_CALLS_PER_SECOND);
  });

  it.each(["missing", "false", "throws", "rejects"])("returns no truth when the save writer is %s", async (failure) => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const before = structuredClone(saveGame(game));
    setTruthSaveWriter(failure === "missing" ? undefined : () => {
      if (failure === "throws") throw new Error("writer failed");
      return failure === "rejects" ? Promise.reject(new Error("writer failed")) : false;
    });
    const wired = await ready([TRUTH_MAP], hostApi({ game, grants: [TRUTH_MAP] }));
    for (const [index, method] of ["truth.level", "truth.monsters", "truth.race", "truth.storeKnowledge"].entries()) {
      send(wired, 110 + index, method, method === "truth.race" ? [0] : []);
      await vi.waitFor(() => expect(reply(wired, 110 + index)).toMatchObject({ result: { ok: false } }));
      expect(JSON.stringify(reply(wired, 110 + index)).length).toBeLessThan(512);
    }
    expect(saveGame(game)).toEqual(before);
  });

  it("returns no hidden data without a character and never calls after stop", async () => {
    const writer = vi.fn(() => true);
    setTruthSaveWriter(writer);
    const wired = await ready([TRUTH_MAP]);
    send(wired, 114);
    await vi.waitFor(() => expect(reply(wired, 114)).toMatchObject({ result: { reason: "unavailable" } }));
    const receive = wired.worker.onmessage!;
    wired.session.teardown();
    receive({ data: { type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1, requestId: 115, method: "truth.monsters", args: [] } } as MessageEvent);
    expect(reply(wired, 115)).toBeUndefined();
    expect(writer).not.toHaveBeenCalled();
  });
});

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

  it.each(["ui.mountPage", "ui.overlay", "presentation.cancelInput"])("refuses the first-party method %s", async (method) => {
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

  it("refuses live callbacks and accepts declarative title actions", async () => {
    for (const declaration of [{ birth: () => undefined }, { engineHooks: () => ({}) }]) {
      const wired = wire({ api: API, ...declaration });
      await expect(wired.session.ready).rejects.toThrow(MOD_PERMISSION_TEXT.unsupported);
    }
    await expect(wire({ api: API, titleActions: [] }).session.ready).resolves.toBeDefined();
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
      requestId: 99, method: "manage.session.quit", args: [],
    });
    await vi.waitFor(() => expect(wired.problems.join("\n")).toMatch(/refused call to "manage\.session\.quit"/u));
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
    tileMap: [{ monster: 2, like: 1 }], projectionRadiusClamp: true, levelRevisitTracking: true,
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

describe("isolated controller broker", () => {
  it("requires every declared controller grant before offering a controller", async () => {
    const required = ["input:controller", "input:intent", "state:interaction.read"];
    for (const omitted of required) {
      const grants = required.filter((cap) => cap !== omitted);
      const wired = wire({ api: API, controller: () => undefined }, { grants, api: hostApi({ grants }) });
      await wired.session.ready; expect(wired.session.hasController()).toBe(false);
    }
    const wired = wire({ api: API, controller: () => undefined }, { grants: required, api: hostApi({ grants: required }) });
    await wired.session.ready; expect(wired.session.hasController()).toBe(true);
  });

  it("passes copied input to a decision and routes its intent to the decision host", async () => {
    const grants = ["input:controller", "input:intent", "state:interaction.read"];
    let armedAtStart: boolean | undefined; let received: unknown; let response: unknown;
    const wired = wire({ api: API, start: (mod) => { armedAtStart = mod.meta.controllerArmed; }, controller: async (mod, input) => {
      received = { input, frozen: Object.isFrozen(input), armed: mod.meta.controllerArmed };
      response = await mod.act.submit(input.token, { kind: "command", command: { code: "hold" } });
    } }, { grants, api: hostApi({ grants }) });
    await started(wired, () => armedAtStart);
    expect(armedAtStart).toBe(false);
    const submit = vi.fn(async () => ({ ok: true, value: null }));
    const decisionHost = { act: { submit } } as unknown as ModApi2;
    const input = { token: { epoch: 0, revision: 1 }, driver: { kind: "controller", owner: "probe" }, phase: "play", messagePending: false, prompt: null } as never;
    await wired.session.decide(input, decisionHost);
    expect(received).toMatchObject({ input, frozen: true, armed: false });
    expect(response).toEqual({ ok: true, value: null }); expect(submit).toHaveBeenCalledTimes(1);
  });

  it("times out a decision that never returns and terminates a message flood", async () => {
    const grants = ["input:controller", "input:intent", "state:interaction.read"];
    const wired = wire({ api: API, controller: () => new Promise(() => undefined) }, { grants, api: hostApi({ grants }), timing: { askMs: 20, heartbeatMs: 1000 } });
    await wired.session.ready; wired.session.start();
    await expect(wired.session.decide({} as never, {} as ModApi2)).rejects.toBeInstanceOf(WorkerTimeoutError);
    const flood = wire({ api: API }, { timing: { maxCallsPerSecond: 2 } });
    await flood.session.ready; flood.session.start();
    for (let i = 0; i < 12; i++) flood.worker.scope.postMessage({ type: "log", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1, level: "info", message: "flood" });
    await vi.waitFor(() => expect(flood.worker.terminated).toBe(true));
    expect(flood.health.isOff("probe")).toBe(true);
  });
});

it("keeps a Worker's arming decision separate from controller availability", async () => {
  const grants = ["input:controller", "input:intent", "state:interaction.read"];
  const definition: Api2ModDefinition = { api: API, armed: ({ armed }) => armed, controller: () => undefined };
  const idle = wire(definition, { grants, api: hostApi({ grants }) });
  await idle.session.ready;
  expect(idle.session.hasController()).toBe(true); expect(idle.session.controllerArmed()).toBe(false);
  const armed = wire(definition, { grants, controllerArmed: true, api: hostApi({ grants }) });
  await armed.session.ready;
  expect(armed.session.controllerArmed()).toBe(true);
});

it("runs a declarative Worker title action through the host's row", async () => {
  const grants = ["ui:title"]; let row: { run(): void } | undefined; let clicks = 0;
  const capabilities = CapabilitySet.fromManifest({ id: "probe", name: "Probe", version: "1.0.0", shape: "plugin", capabilities: grants });
  const api = () => createApi2Host({ ...modPluginContext("probe", {}), title: { registerRow: (value: { run(): void }) => { row = value; return () => { row = undefined; }; } } as never }, { grants: capabilities, execution: "worker" });
  const wired = wire({ api: API, titleActions: [{ id: "open", label: "Open", run: () => { clicks += 1; } }] }, { grants, api });
  await wired.session.ready; wired.session.start();
  await vi.waitFor(() => expect(row).toBeDefined()); row!.run();
  await vi.waitFor(() => expect(clicks).toBe(1));
  wired.session.teardown(); expect(row).toBeUndefined();
});

it("stops oversized host replies before transferring them", async () => {
  const wired = wire({ api: API }, { api: () => ({ meta: { settings: async () => ({ ok: true, value: { text: "x".repeat(4 * 1024 * 1024) } }) } }) as unknown as ModApi2 });
  await wired.session.ready; wired.session.start();
  wired.worker.scope.postMessage({ type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1, requestId: 88, method: "meta.settings", args: [] });
  await vi.waitFor(() => expect(wired.worker.terminated).toBe(true));
  expect(wired.worker.sent.find((message) => message.type === "reply" && message.requestId === 88)).toMatchObject({ ok: false, error: MOD_PERMISSION_TEXT.quota });
});

it("gates controller key observation and never sends emergency keys to the Worker", async () => {
  const required = ["input:controller", "input:intent", "state:interaction.read"];
  const onKey = vi.fn(() => ({ kind: "keep" as const, message: "Continuing" }));
  const definition: Api2ModDefinition = { api: API, controller: () => undefined, onKey };
  const press = { key: "a", ctrl: false, alt: false, shift: false, meta: false, repeat: false };
  const denied = wire(definition, { grants: required, api: hostApi({ grants: required }) });
  await denied.session.ready; denied.session.start();
  expect(denied.session.hasKeyHandler()).toBe(false);
  expect(await denied.session.key(press)).toEqual({ kind: "release" });
  expect(onKey).not.toHaveBeenCalled();
  const grants = [...required, "input:observe"];
  const allowed = wire(definition, { grants, api: hostApi({ grants }) });
  await allowed.session.ready; allowed.session.start();
  expect(await allowed.session.key(press)).toEqual({ kind: "keep", message: "Continuing" });
  expect(await allowed.session.key({ ...press, key: "Escape" })).toEqual({ kind: "release" });
  expect(await allowed.session.key({ ...press, key: "z", ctrl: true })).toEqual({ kind: "release" });
  expect(onKey).toHaveBeenCalledTimes(1);
});
