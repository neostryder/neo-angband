/**
 * The in-process API 2 host on a real game: it hands out known data only,
 * answers a refused permission with a typed result, and builds `manage` and
 * `truth` only for an allowlisted mod.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GameEvents,
  FEAT,
  MFLAG,
  SQUARE,
  knownMonsterMidx,
  knownMonsters,
  monsterIsObvious,
  monsterSwap,
  startGame,
  type GamePack,
  type GameState,
  type Monster,
  type ModNet,
  type StartedGame,
} from "@rpgm-tools/neo-angband-core";
import { CapabilitySet, type JsonValue, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { api2EventPayload, createApi2Host, type Api2HostOptions } from "./mod-api2-host";
import { modPluginContext } from "./mod-context";
import type { ModPrefs } from "./mod-prefs";

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8")) as T;
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

const SEED = 4242;
const DEPTH = 10;

function capabilities(id: string, granted: string[]): CapabilitySet {
  return CapabilitySet.fromManifest({
    id, name: id, version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: granted,
  });
}

function memoryPrefs(): ModPrefs & { raw: () => unknown } {
  let stored: unknown = null;
  return {
    get: () => (stored === null ? null : structuredClone(stored)),
    set: (value: unknown) => {
      stored = value === undefined || value === null ? null : structuredClone(value);
    },
    raw: () => stored,
  } as ModPrefs & { raw: () => unknown };
}

function host(
  game: StartedGame,
  granted: string[],
  extra: Partial<Api2HostOptions> = {},
  prefs: ModPrefs = memoryPrefs(),
): ModApi2 {
  const caps = capabilities("probe", granted);
  const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: caps, prefs });
  return createApi2Host(ctx, { grants: caps, ...extra });
}

function liveMonsters(state: GameState): Monster[] {
  return state.monsters.filter((m): m is Monster => m !== null && m !== undefined);
}

function twin(state: GameState, mon: Monster): Monster {
  const other = state.monsters[mon.midx];
  if (!other || other.race.ridx !== mon.race.ridx) throw new Error("the paired games diverged");
  return other;
}

function emptyGrid(state: GameState, visible: boolean): { x: number; y: number } {
  for (let y = 1; y < state.chunk.height - 1; y++) {
    for (let x = 1; x < state.chunk.width - 1; x++) {
      const grid = { x, y };
      if (state.chunk.feat(grid) !== FEAT.FLOOR || state.chunk.mon(grid) !== 0) continue;
      if (state.chunk.sqinfoHas(grid, SQUARE.VIEW) !== visible || state.chunk.sqinfoHas(grid, SQUARE.SEEN) !== visible) continue;
      return grid;
    }
  }
  throw new Error("no empty grid with the requested visibility");
}

/** What a mod can observe through the host, as text, without the game-specific token epochs. */
async function observedThroughHost(api: ModApi2): Promise<string> {
  const world = await api.view.world();
  const monsters = await api.view.monsters();
  if (!world.ok || !monsters.ok) throw new Error("the probe was refused a read it holds");
  const { token: _token, level, ...rest } = world.value;
  const { token: _levelToken, ...levelRest } = level ?? { token: null };
  return JSON.stringify({ rest, level: levelRest, monsters: monsters.value });
}

const READS = ["state:*.read"];

describe("the API 2 host's view", () => {
  it("does not change when an unseen monster's health and speed change (paired worlds)", async () => {
    const a = startGame(pack, { seed: SEED, depth: DEPTH });
    const b = startGame(pack, { seed: SEED, depth: DEPTH });
    const hiddenA = liveMonsters(a.state).find((m) => !monsterIsObvious(m));
    if (!hiddenA) throw new Error("no unseen monster at this seed");
    const hiddenB = twin(b.state, hiddenA);
    hiddenB.hp = Math.max(1, hiddenB.hp - 1);
    hiddenB.mspeed += 10;
    expect(monsterIsObvious(hiddenB)).toBe(false);

    const viewA = host(a, READS);
    const viewB = host(b, READS);
    expect(await observedThroughHost(viewB)).toBe(await observedThroughHost(viewA));

    /* Control: the same change is visible once the player perceives the monster. */
    hiddenB.mflag.on(MFLAG.VISIBLE);
    hiddenB.mflag.off(MFLAG.CAMOUFLAGE);
    expect(await observedThroughHost(viewB)).not.toBe(await observedThroughHost(viewA));
  });

  it("lists only monsters the player perceives, as frozen plain data", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const api = host(game, READS);
    const r = await api.view.monsters();
    if (!r.ok) throw new Error("refused");
    const perceived = liveMonsters(game.state).filter(monsterIsObvious).map((m) => m.midx);
    /* Each id is a handle that leads back to one perceived monster, not its index. */
    const back = r.value.map((m) => knownMonsterMidx(game.state, m.id));
    expect(back.slice().sort()).toEqual(perceived.slice().sort());
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(structuredClone(r.value)).toEqual(r.value);
  });

  it("answers a read it lacks the permission for with not-granted, without throwing", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const api = host(game, ["state:player.read"]);
    expect(await api.view.monsters()).toMatchObject({ ok: false, reason: "not-granted", capability: "state:monsters.read" });
    expect(await api.view.level()).toMatchObject({ ok: false, reason: "not-granted", capability: "state:map.read" });
    expect(await api.view.input()).toMatchObject({ ok: false, reason: "not-granted", capability: "state:interaction.read" });
    const player = await api.view.player();
    expect(player.ok).toBe(true);
    const world = await api.view.world();
    if (!world.ok) throw new Error("refused");
    expect(world.value.monsters).toBeNull();
    expect(world.value.player).not.toBeNull();
  });
});

describe("the API 2 host's refusals", () => {
  it("answers act, events, ui and keys with not-granted when the permission is missing", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    game.state.events = new GameEvents();
    const api = host(game, []);
    const token = { epoch: 0, revision: 0 };
    expect(await api.act.submit(token, { kind: "stop-resting" })).toMatchObject({ reason: "not-granted", capability: "input:intent" });
    expect(await api.act.answer(1, true)).toMatchObject({ reason: "not-granted", capability: "input:prompt.reply" });
    expect(await api.events.on("message", () => undefined)).toMatchObject({ reason: "not-granted", capability: "event:message" });
    expect(await api.ui.mount({ id: "probe", root: { type: "text", text: "hi" } })).toMatchObject({ reason: "not-granted", capability: "ui:panel.mount" });
    expect(await api.ui.keys.bind("x", "probe")).toMatchObject({ reason: "not-granted", capability: "keymap:write" });
    expect(api.meta.granted("input:intent")).toBe(false);
    expect(api.meta.granted("not a capability at all")).toBe(false);
  });
});

describe("the API 2 host's commands", () => {
  function commander(game: StartedGame): { api: ModApi2; sent: unknown[] } {
    const sent: unknown[] = [];
    const caps = capabilities("probe", [...READS, "input:intent"]);
    const ctx = modPluginContext("probe", {}, game.state, {}, {
      capabilities: caps,
      prefs: memoryPrefs(),
      intentGate: { submit: (_token, intent) => (sent.push(intent), { accepted: true }) },
    });
    return { api: createApi2Host(ctx, { grants: caps }), sent };
  }

  it("turn a target's KnownMonster id into the monster it names, and an unknown id into none", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const mon = liveMonsters(game.state).find((m) => !monsterIsObvious(m));
    if (!mon) throw new Error("no unseen monster at this seed");
    mon.mflag.on(MFLAG.VISIBLE);
    mon.mflag.off(MFLAG.CAMOUFLAGE);
    const { api, sent } = commander(game);
    const listed = await api.view.monsters();
    if (!listed.ok) throw new Error("refused");
    const id = listed.value.find((m) => m.grid.x === mon.grid.x && m.grid.y === mon.grid.y)!.id;
    const token = { epoch: 0, revision: 0 };
    expect(await api.act.submit(token, { kind: "target", midx: id })).toMatchObject({ ok: true });
    /* An id no monster holds, and a real monster index the player was never given. */
    const hidden = liveMonsters(game.state).find((m) => !monsterIsObvious(m))!;
    await api.act.submit(token, { kind: "target", midx: 999 });
    expect(knownMonsterMidx(game.state, hidden.midx)).toBeNull();
    await api.act.submit(token, { kind: "target", midx: hidden.midx });
    expect(sent).toEqual([
      { kind: "target", midx: mon.midx },
      { kind: "target", midx: 0 },
      { kind: "target", midx: 0 },
    ]);
  });
});

describe("the first-party seams", () => {
  it("are absent without an allowlist, whatever the grants", () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const api = host(game, [...READS, "profiles:manage", "session:control"]);
    expect(api.manage).toBeUndefined();
    expect(api.truth).toBeUndefined();
    expect("manage" in api).toBe(false);
    expect("truth" in api).toBe(false);
    expect(api.meta.tier).toBe("public");
  });

  it("are present only for the seams the allowlist names", () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const truthOnly = host(game, READS, { tier: "first-party", firstParty: { truth: true } });
    expect(truthOnly.truth).toBeDefined();
    expect(truthOnly.manage).toBeUndefined();
    expect(truthOnly.meta.tier).toBe("first-party");
    const manageOnly = host(game, READS, { firstParty: { manage: true } });
    expect(manageOnly.manage).toBeDefined();
    expect(manageOnly.truth).toBeUndefined();
  });

  it("truth sees the unseen monster the view hides", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const hidden = liveMonsters(game.state).find((m) => !monsterIsObvious(m));
    if (!hidden) throw new Error("no unseen monster at this seed");
    const api = host(game, READS, { tier: "first-party", firstParty: { truth: true } });
    const seen = await api.view.monsters();
    const real = await api.truth!.monsters();
    if (!seen.ok || !real.ok) throw new Error("refused");
    expect(seen.value.some((m) => m.id === hidden.midx)).toBe(false);
    expect(real.value.some((m) => m.id === hidden.midx)).toBe(true);
    const level = await api.truth!.level();
    expect(level.ok).toBe(true);
  });

  it("manage without its API 1 grant answers not-granted", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const api = host(game, READS, { firstParty: { manage: true } });
    expect(await api.manage!.profiles.list()).toMatchObject({ reason: "not-granted", capability: "profiles:manage" });
    expect(await api.manage!.session.save()).toMatchObject({ reason: "not-granted", capability: "session:control" });
  });
});

describe("API 2 events", () => {
  it("hear a granted event as plain data and stop after off", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    game.state.events = new GameEvents();
    const api = host(game, ["event:message"]);
    const heard: unknown[] = [];
    const sub = await api.events.on("message", (m) => heard.push(m));
    if (!sub.ok) throw new Error("refused");
    game.state.events.emit("message", { type: 0, msg: "hello" });
    await api.events.off(sub.value);
    game.state.events.emit("message", { type: 0, msg: "again" });
    expect(heard).toEqual([{ text: "hello", type: 0 }]);
  });

  it("hidden combat targets produce identical observations (paired worlds)", () => {
    const a = startGame(pack, { seed: SEED, depth: DEPTH });
    const b = startGame(pack, { seed: SEED, depth: DEPTH });
    const hiddenA = liveMonsters(a.state).find((m) => !monsterIsObvious(m))!;
    const hiddenB = twin(b.state, hiddenA);
    monsterSwap(b.state, hiddenB.grid, emptyGrid(b.state, false));
    const observation = (state: GameState, mon: Monster, hit: boolean, died: boolean) => api2EventPayload("combat-outcome", {
      attacker: "player", target: mon.midx, perceivedAttacker: "player", perceivedTarget: "unseen",
      kind: "ranged", hit, damage: 4, died, grid: mon.grid, seen: state.chunk.sqinfoHas(mon.grid, SQUARE.VIEW),
    });
    expect(monsterIsObvious(hiddenB)).toBe(false);
    expect(hiddenB.grid).not.toEqual(hiddenA.grid);
    expect(observation(a.state, hiddenA, false, false)).toEqual(observation(b.state, hiddenB, true, true));
    expect(observation(a.state, hiddenA, false, false)).toBeUndefined();
  });

  it("hidden motion origins produce identical observations (paired worlds)", () => {
    const a = startGame(pack, { seed: SEED, depth: DEPTH });
    const b = startGame(pack, { seed: SEED, depth: DEPTH });
    const hiddenA = liveMonsters(a.state).find((m) => !monsterIsObvious(m))!;
    const hiddenB = twin(b.state, hiddenA);
    monsterSwap(b.state, hiddenB.grid, emptyGrid(b.state, false));
    const to = emptyGrid(a.state, true);
    const observation = (state: GameState, mon: Monster) => {
      const from = { ...mon.grid };
      const fromSeen = monsterIsObvious(mon) && state.chunk.sqinfoHas(from, SQUARE.VIEW);
      monsterSwap(state, from, to);
      const id = knownMonsters(state).find((m) => m.grid.x === to.x && m.grid.y === to.y)!.id;
      return api2EventPayload("motion", { who: mon.midx, perceivedWho: { monster: id }, from, to, fromSeen, kind: "teleport", seen: true });
    };
    expect(hiddenB.grid).not.toEqual(hiddenA.grid);
    const appeared = observation(a.state, hiddenA);
    expect(observation(b.state, hiddenB)).toEqual(appeared);
    expect(appeared).toEqual({ who: { monster: 1 }, to, kind: "teleport" });
    expect(api2EventPayload("motion", {
      who: hiddenA.midx, perceivedWho: { monster: 1 }, from: to, to, fromSeen: true, kind: "walk", seen: true,
    })).toHaveProperty("from", to);
  });

  it("name a monster as core perceived it when the event was sent", () => {
    const grid = { x: 1, y: 2 };
    const seen = api2EventPayload("combat-outcome", {
      attacker: 7, target: "player", perceivedAttacker: { monster: 1 }, perceivedTarget: "player",
      kind: "melee", hit: true, damage: 4, died: false, grid, seen: true,
    });
    expect(seen).toEqual({ attacker: { monster: 1 }, target: "player", kind: "melee", hit: true, died: false, grid, playerDamage: 4 });

    const invisible = api2EventPayload("combat-outcome", {
      attacker: 9, target: "player", perceivedAttacker: "unseen", perceivedTarget: "player",
      kind: "melee", hit: true, damage: 4, died: false, grid, seen: true,
    });
    expect(invisible).toMatchObject({ attacker: "unseen", target: "player" });

    /* Two monsters the player cannot see, fighting in view: nothing to report. */
    expect(api2EventPayload("combat-outcome", {
      attacker: 9, target: 10, perceivedAttacker: "unseen", perceivedTarget: "unseen",
      kind: "melee", hit: true, damage: 4, died: false, grid, seen: true,
    })).toBeUndefined();
    /* Out of view and not involving the player. */
    expect(api2EventPayload("combat-outcome", {
      attacker: 7, target: 7, perceivedAttacker: { monster: 1 }, perceivedTarget: { monster: 1 },
      kind: "effect", hit: true, damage: 1, died: false, grid, seen: false,
    })).toBeUndefined();
    /* Damage to a monster is not a number the player sees. */
    expect(api2EventPayload("combat-outcome", {
      attacker: "player", target: 7, perceivedAttacker: "player", perceivedTarget: { monster: 1 },
      kind: "melee", hit: true, damage: 12, died: false, grid, seen: true,
    })).not.toHaveProperty("playerDamage");

    expect(api2EventPayload("motion", { who: 9, perceivedWho: "unseen", from: grid, to: grid, kind: "walk", seen: true })).toBeUndefined();
    expect(api2EventPayload("heal", { who: 9, perceivedWho: "unseen", amount: 3, grid, seen: true })).toBeUndefined();
    expect(api2EventPayload("heal", { who: 7, perceivedWho: { monster: 1 }, amount: 3, grid, seen: true })).toEqual({ who: { monster: 1 }, grid });
    expect(api2EventPayload("heal", { who: "player", perceivedWho: "player", amount: 3, grid, seen: false })).toEqual({ who: "player", grid, playerAmount: 3 });
  });
});

describe("API 2 credential references", () => {
  it("passes a prefix and opaque reference to the host transport", async () => {
    const requests: Parameters<ModNet["request"]>[0][] = [];
    const net: ModNet = {
      transport: "page",
      request: async (request) => {
        requests.push(request);
        return { ok: true, status: 200, headers: {}, body: "{}" };
      },
      secrets: {
        storage: "page",
        has: async () => ({ present: false }),
        set: async () => ({ ok: true, storage: "page" }),
        fromEnv: async () => ({ ok: false, problem: "unavailable" }),
        delete: async () => ({ ok: true }),
      },
    };
    const caps = capabilities("probe", ["network:example.test"]);
    const ctx = modPluginContext("probe", {}, undefined, {}, { capabilities: caps, net });
    const api = createApi2Host(ctx, { grants: caps });
    const ref = api.net!.credential("key", "Bearer ");
    expect(ref).toEqual({ credential: "key", prefix: "Bearer " });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(await api.net!.request({ url: "https://example.test", headers: {
      authorization: ref, "x-api-key": api.net!.credential("key"),
    } })).toMatchObject({ ok: true });
    expect(requests[0]?.headers).toEqual({ authorization: "Bearer {secret:key}", "x-api-key": "{secret:key}" });
  });
});

describe("API 2 storage", () => {
  it("unwraps preferences when the definition drops its migration", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const prefs = memoryPrefs();
    const versioned = host(game, [], { prefs: { version: 1, migrate: (value) => value } }, prefs);
    await versioned.store.prefs.set({ colour: "blue" });
    expect(await host(game, [], {}, prefs).store.prefs.get()).toEqual({ ok: true, value: { colour: "blue" } });
  });

  it("keeps a numeric $api2prefs key as user data", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const prefs = memoryPrefs();
    const value = { $api2prefs: 9, value: "user data" };
    prefs.set(value);
    const fromVersions: number[] = [];
    const api = host(game, [], { prefs: { version: 1, migrate: (data, from) => {
      fromVersions.push(from);
      return data;
    } } }, prefs);
    expect(await api.store.prefs.get()).toEqual({ ok: true, value });
    expect(fromVersions).toEqual([0]);
    expect(await host(game, [], {}, prefs).store.prefs.get()).toEqual({ ok: true, value });
  });

  it("shares a pending preference migration and preserves a newer write", async () => {
    const prefs = memoryPrefs();
    prefs.set({ colour: "red" });
    let release: (value: JsonValue) => void = () => undefined;
    let calls = 0;
    const api = host(startGame(pack, { seed: SEED, depth: DEPTH }), [], {
      prefs: {
        version: 2,
        migrate: () => {
          calls += 1;
          return new Promise<JsonValue>((resolve) => { release = resolve; });
        },
      },
    }, prefs);
    const first = api.store.prefs.get();
    const second = api.store.prefs.get();
    expect(calls).toBe(1);
    await api.store.prefs.set({ colour: "blue" });
    release({ colour: "red", shade: "dark" });
    expect(await first).toEqual({ ok: true, value: { colour: "blue" } });
    expect(await second).toEqual({ ok: true, value: { colour: "blue" } });
    expect(prefs.raw()).toEqual({ format: "neo-angband/mod/prefs", schemaVersion: 1, data: { version: 2, value: { colour: "blue" } } });
  });

  it("keeps a cleared preference value when an older migration finishes", async () => {
    const prefs = memoryPrefs();
    prefs.set({ colour: "red" });
    let release: (value: JsonValue) => void = () => undefined;
    const api = host(startGame(pack, { seed: SEED, depth: DEPTH }), [], {
      prefs: { version: 2, migrate: () => new Promise<JsonValue>((resolve) => { release = resolve; }) },
    }, prefs);
    const reading = api.store.prefs.get();
    await api.store.prefs.set(null);
    release({ colour: "red" });
    expect(await reading).toEqual({ ok: true, value: null });
    expect(prefs.raw()).toBeNull();
  });

  it("migrates stored preferences once and keeps the version beside them", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const prefs = memoryPrefs();
    prefs.set({ colour: "red" });
    const calls: number[] = [];
    const api = host(game, [], {
      prefs: {
        version: 2,
        migrate: (value, from) => {
          calls.push(from);
          return { ...(value as Record<string, string>), shade: "dark" };
        },
      },
    }, prefs);
    expect(await api.store.prefs.get()).toEqual({ ok: true, value: { colour: "red", shade: "dark" } });
    expect(prefs.raw()).toEqual({ format: "neo-angband/mod/prefs", schemaVersion: 1, data: { version: 2, value: { colour: "red", shade: "dark" } } });
    expect(await api.store.prefs.get()).toEqual({ ok: true, value: { colour: "red", shade: "dark" } });
    expect(calls).toEqual([0]);
    await api.store.prefs.set({ colour: "blue" });
    expect(prefs.raw()).toEqual({ format: "neo-angband/mod/prefs", schemaVersion: 1, data: { version: 2, value: { colour: "blue" } } });
  });
});
