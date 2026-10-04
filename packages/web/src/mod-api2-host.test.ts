/**
 * The in-process API 2 host on a real game: it hands out known data only,
 * answers a refused permission with a typed result, and builds `manage` and
 * `truth` only for an allowlisted mod.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GameEvents,
  MFLAG,
  monsterIsObvious,
  startGame,
  type GamePack,
  type GameState,
  type Monster,
  type StartedGame,
} from "@rpgm-tools/neo-angband-core";
import { CapabilitySet, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
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
    expect(r.value.map((m) => m.id).sort()).toEqual(perceived.sort());
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
    const truthOnly = host(game, READS, { firstParty: { truth: true } });
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
    const api = host(game, READS, { firstParty: { truth: true } });
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

  it("name a monster only while the player perceives it", () => {
    const perceives = (id: number) => id === 7;
    const grid = { x: 1, y: 2 };
    const seen = api2EventPayload("combat-outcome", {
      attacker: 7, target: "player", kind: "melee", hit: true, damage: 4, died: false, grid, seen: true,
    }, perceives);
    expect(seen).toEqual({ attacker: { monster: 7 }, target: "player", kind: "melee", hit: true, died: false, grid, playerDamage: 4 });

    const invisible = api2EventPayload("combat-outcome", {
      attacker: 9, target: "player", kind: "melee", hit: true, damage: 4, died: false, grid, seen: true,
    }, perceives);
    expect(invisible).toMatchObject({ attacker: "unseen", target: "player" });

    /* Two monsters the player cannot see, fighting in view: nothing to report. */
    expect(api2EventPayload("combat-outcome", {
      attacker: 9, target: 10, kind: "melee", hit: true, damage: 4, died: false, grid, seen: true,
    }, perceives)).toBeUndefined();
    /* Out of view and not involving the player. */
    expect(api2EventPayload("combat-outcome", {
      attacker: 7, target: 7, kind: "effect", hit: true, damage: 1, died: false, grid, seen: false,
    }, perceives)).toBeUndefined();
    /* Damage to a monster is not a number the player sees. */
    expect(api2EventPayload("combat-outcome", {
      attacker: "player", target: 7, kind: "melee", hit: true, damage: 12, died: false, grid, seen: true,
    }, perceives)).not.toHaveProperty("playerDamage");

    expect(api2EventPayload("motion", { who: 9, from: grid, to: grid, kind: "walk", seen: true }, perceives)).toBeUndefined();
    expect(api2EventPayload("heal", { who: 9, amount: 3, grid, seen: true }, perceives)).toBeUndefined();
    expect(api2EventPayload("heal", { who: 7, amount: 3, grid, seen: true }, perceives)).toEqual({ who: { monster: 7 }, grid });
    expect(api2EventPayload("heal", { who: "player", amount: 3, grid, seen: false }, perceives)).toEqual({ who: "player", grid, playerAmount: 3 });
  });
});

describe("API 2 storage", () => {
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
    expect(prefs.raw()).toEqual({ $api2prefs: 2, value: { colour: "red", shade: "dark" } });
    expect(await api.store.prefs.get()).toEqual({ ok: true, value: { colour: "red", shade: "dark" } });
    expect(calls).toEqual([0]);
    await api.store.prefs.set({ colour: "blue" });
    expect(prefs.raw()).toEqual({ $api2prefs: 2, value: { colour: "blue" } });
  });
});
