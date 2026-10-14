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
  observeKnownStore,
  TMD,
  knownMonsterMidx,
  knownMonsters,
  monsterIsObvious,
  monsterSwap,
  startGame,
  inputToken,
  bumpInputRevision,
  createAgentView,
  createAgentActions,
  installController,
  type GamePack,
  type GameState,
  type Monster,
  type ModNet,
  type StartedGame,
} from "@rpgm-tools/neo-angband-core";
import { CapabilitySet, type Api2ModDefinition, type JsonValue, type ModApi2, type RunReport } from "@rpgm-tools/neo-angband-mod-sdk";
import { createRunReports } from "./run-report";
import { createModKnowledge } from "./knowledge-read";
import { api2EventPayload, createApi2Host, stopApi2Host, type Api2HostOptions } from "./mod-api2-host";
import { modPluginContext } from "./mod-context";
import type { ModPrefs } from "./mod-prefs";
import { api2Plugin } from "./mod-api2-shim";

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
  const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: caps, prefs, registries: game.booted.registries });
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
  it("keeps session inspection dependencies when the loader supplies only a registry", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    game.state.knownWorldDeps = { inspect: { objectInfo: { constants: game.booted.registries.constants, projections: [] },
      races: game.booted.registries.monsters.races, projections: [], loreDeps: () => ({ playerLevel: 1, playerMaxDepth: 10,
        playerSpeed: 110, effectiveSpeed: false, purpleUniques: false, spells: game.booted.registries.monsters.spells }) }, describe: () => "Known item" };
    const api = host(game, READS, { viewDeps: { reg: game.booted.registries.objects } });
    const item = game.state.gear.pack[0] ?? game.state.actor.player.equipment.find(Boolean)!;
    expect(await api.view.inspect.item(item)).toMatchObject({ ok: true, value: { title: expect.any(String) } });
    const simulation = await api.view.simulateLoadout({});
    if (!simulation.ok) throw new Error("refused");
    expect(simulation.value.before.inventory.every((entry) => entry.name === "Known item")).toBe(true);
  });

  it("reads messages since an absolute cursor without consuming them", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const grants = capabilities("probe", ["state:messages.read"]);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: grants, prefs: memoryPrefs() });
    const api = createApi2Host({ ...ctx, snapshot: () => ({ messages: { cursor: 102,
      recent: [{ text: "One", count: 1 }, { text: "One", count: 1 }] } }) as never }, { grants });
    const result = await api.view.messages(101);
    expect(result).toEqual({ ok: true, value: { cursor: 102, entries: [{ sequence: 102, text: "One", count: 1 }] } });
    expect(await api.view.messages(101)).toEqual(result);
    expect(await api.view.messages(102)).toMatchObject({ value: { entries: [] } });
    expect(await api.view.messages(-1)).toMatchObject({ code: "invalid-cursor" });
    expect(await host(game, []).view.messages()).toMatchObject({ capability: "state:messages.read" });
  });

  it("copies only the player's chosen item and spell arguments", () => {
    const command = { code: "cast", args: { handle: 4, spell: 2, floor: 0, index: 3, hidden: { name: "secret monster" } },
      phase: "play" as const, token: { epoch: 1, revision: 1 } };
    const result = api2EventPayload("player-command", command);
    expect(result).toMatchObject({ args: { handle: 4, spell: 2, floor: 0, index: 3 } });
    expect(api2EventPayload("player-command", { ...command, args: { ...command.args, hidden: { name: "different monster" } } })).toEqual(result);
    expect(result!.args).not.toHaveProperty("hidden");
    expect(Object.isFrozen(result!.args)).toBe(true);
  });

  it("clones the knowledge menu and keeps an unknown entry without a recall", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const grants = capabilities("probe", READS);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: grants, prefs: memoryPrefs() });
    const knowledge = createModKnowledge({ runes: { groups: () => ({ title: "Runes", groups: [{ name: "Flags",
      rows: [{ member: "known" as never, label: "Free action", color: "white" }] }] }), key: (member) => String(member),
      recall: () => ({ id: "core:text", title: "Rune", footer: "", blocks: [] }) } }, () => game.state.rng);
    const api = createApi2Host({ ...ctx, knowledge }, { grants });
    const result = await api.view.knowledge("runes", "unknown");
    expect(result).toMatchObject({ value: { recall: null, lists: { runes: { groups: [{ entries: [{ id: "known" }] }] } } } });
    expect(await api.view.knowledge("runes", "known")).toMatchObject({ value: { recall: { title: "Rune" } } });
    if (!result.ok) throw new Error("refused");
    expect(Object.isFrozen(result.value.lists)).toBe(true);
    expect(await host(game, []).view.knowledge()).toMatchObject({ capability: "state:knowledge.read" });
  });

  it("keeps unseen bolt origins and blast grids out of animation events", () => {
    const bolt = { projType: 1, element: "FIRE", drawing: true, seen: true, beam: false, oy: 8, ox: 9, y: 2, x: 3 };
    expect(api2EventPayload("bolt", { ...bolt, oy: 99, ox: 88 })).toEqual(api2EventPayload("bolt", bolt));
    expect(api2EventPayload("bolt", { ...bolt, seen: false })).toBeUndefined();
    const blast = { projType: 1, element: "FIRE", arc: false, radius: 2, numGrids: 2, distanceToGrid: [0, 1],
      drawing: true, playerSeesGrid: [true, false], blastGrid: [{ x: 2, y: 3 }, { x: 8, y: 9 }], centre: { x: 2, y: 3 } };
    expect(api2EventPayload("explosion", { ...blast, radius: 9, centre: { x: 99, y: 88 }, blastGrid: [blast.blastGrid[0]!, { x: 99, y: 88 }] }))
      .toEqual(api2EventPayload("explosion", blast));
    expect(api2EventPayload("explosion", blast)).toEqual({ grids: [{ x: 2, y: 3 }], element: "FIRE", arc: false });
    expect(api2EventPayload("explosion", { ...blast, playerSeesGrid: [false, false] })).toBeUndefined();
  });

  it("keeps full run reports first-party and unsubscribes run-end listeners", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const grants = capabilities("probe", [...READS, "event:run-end"]);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: grants, prefs: memoryPrefs() });
    const reports = createRunReports();
    const report = { key: "cedar", name: "Cedar" } as RunReport;
    const character = { key: () => "cedar", history: () => [], runReport: reports.last, onRunEnd: reports.onEnd };
    const publicApi = createApi2Host({ ...ctx, character }, { grants });
    const firstParty = createApi2Host({ ...ctx, character }, { grants, tier: "first-party" });
    const publicEvents: unknown[] = [];
    const fullEvents: unknown[] = [];
    const subscription = await publicApi.events.on("run-end", (event) => publicEvents.push(event));
    await firstParty.events.on("run-end", (event) => fullEvents.push(event));
    reports.publish(report);
    expect(publicEvents).toEqual([{ key: "cedar", report: null }]);
    expect(fullEvents).toEqual([{ key: "cedar", report }]);
    expect(await publicApi.view.character()).toMatchObject({ value: { key: "cedar", report: null } });
    expect(await firstParty.view.character()).toMatchObject({ value: { report } });
    expect(await publicApi.view.player()).toMatchObject({ value: { key: "cedar" } });
    if (!subscription.ok) throw new Error("refused");
    await publicApi.events.off(subscription.value);
    reports.publish(report);
    expect(publicEvents).toHaveLength(1);
  });

  it("keeps inspection paths independent of hidden terrain", async () => {
    const a = startGame(pack, { seed: SEED, depth: DEPTH });
    const b = startGame(pack, { seed: SEED, depth: DEPTH });
    const grid = emptyGrid(a.state, false);
    b.state.chunk.setFeat(grid, FEAT.GRANITE);
    const apiA = host(a, READS);
    const apiB = host(b, READS);
    const strip = (value: unknown) => JSON.stringify(value, (key, field: unknown) => key === "token" ? undefined : field);
    expect(strip(await apiB.view.inspect.projectionPath(grid))).toBe(strip(await apiA.view.inspect.projectionPath(grid)));
    expect(strip(await apiB.view.inspect.blastArea(grid, 2))).toBe(strip(await apiA.view.inspect.blastArea(grid, 2)));
    expect(strip(await apiB.view.inspect.tileActions(grid))).toBe(strip(await apiA.view.inspect.tileActions(grid)));
    expect(await apiA.view.inspect.item({ floor: { ...grid, index: 0 } })).toMatchObject({ value: null });
    expect(await host(a, []).view.inspect.itemRules()).toMatchObject({ capability: "state:inventory.read" });
    expect(await apiA.view.inspect.simulateLoadout({})).toEqual(await apiA.view.simulateLoadout({}));
    expect(await apiA.view.world()).toMatchObject({ value: { equipmentSlots: a.state.actor.player.body.slots } });
  });

  it("bounds the HUD message log and gates its independent reads", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    game.state.cmdQueue = [{ code: "tunnel", repeatRemaining: 7 }];
    game.state.unignoring = 1;
    const grants = capabilities("probe", READS);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: grants, prefs: memoryPrefs() });
    const api = createApi2Host({ ...ctx, snapshot: () => ({ token: { epoch: 1, revision: 1 }, driver: { kind: "player" },
      phase: "play", messagePending: false, prompt: null, resting: null, storeStatus: null, activeBlast: null,
      messages: { log: Array.from({ length: 120 }, (_, i) => ({ text: String(i), count: 1 })) } }) as never }, { grants });
    const input = await api.view.input();
    expect(input).toMatchObject({ value: { repeating: true, repeatsLeft: 7, unignoring: true } });
    if (!input.ok) throw new Error("refused");
    expect(input.value.messages).toHaveLength(100);
    expect(input.value.messages![0]!.text).toBe("20");
    expect(Object.isFrozen(input.value.messages![0])).toBe(true);
  });

  it("returns the game's depth string and CSS color table", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const api = host(game, READS);
    expect(await api.view.player()).toMatchObject({ value: { depthText: "500' (L10)" } });
    const colors = await api.content.colors();
    expect(colors.ok).toBe(true);
    if (!colors.ok) throw new Error("refused");
    expect(colors.value).toHaveLength(32);
    expect(colors.value[1]).toMatchObject({ index: 1, id: "white", css: expect.any(String) });
    expect(Object.isFrozen(colors.value[1])).toBe(true);
  });

  it("returns the same loadout simulation for different counters in one timed grade", async () => {
    const a = startGame(pack, { seed: SEED, depth: DEPTH });
    const b = startGame(pack, { seed: SEED, depth: DEPTH });
    a.state.actor.player.timed[TMD.FAST] = 10;
    b.state.actor.player.timed[TMD.FAST] = 20;
    expect(await host(b, READS).view.simulateLoadout({})).toEqual(await host(a, READS).view.simulateLoadout({}));
  });

  it("simulates a loadout without exposing timed counters", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const result = await host(game, READS).view.simulateLoadout({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("refused");
    expect(result.value.delta.unknownRunes).toBe(false);
    expect(result.value.before.player.status.fast).toBeNull();
    for (const item of result.value.before.inventory) expect(item).not.toHaveProperty("timeout");
    expect(await host(game, ["state:player.read"]).view.simulateLoadout({})).toMatchObject({ reason: "not-granted", capability: "state:inventory.read" });
    const grid = emptyGrid(game.state, false);
    expect(await host(game, READS).view.simulateLoadout({ wield: [{ from: "floor", ...grid, index: 0 }] })).toMatchObject({ code: "unobserved-item" });
  });

  it("keeps look text unchanged when hidden terrain changes and hides wizard flow", async () => {
    const a = startGame(pack, { seed: SEED, depth: DEPTH });
    const b = startGame(pack, { seed: SEED, depth: DEPTH });
    const grid = emptyGrid(a.state, false);
    b.state.chunk.setFeat(grid, FEAT.GRANITE);
    b.state.wizard = true;
    expect(await host(b, READS).view.look(grid)).toEqual(await host(a, READS).view.look(grid));
    expect(await host(a, []).view.look(grid)).toMatchObject({ reason: "not-granted" });
  });

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
  it("reports perception independently of eye visibility, including detected monsters and mimics", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const mon = liveMonsters(game.state).find((mon) => !monsterIsObvious(mon))!;
    const api = host(game, READS, { firstParty: { truth: true } });
    const read = async () => {
      const result = await api.truth!.monsters();
      if (!result.ok) throw new Error("refused");
      expect(Object.isFrozen(result.value)).toBe(true);
      return result.value.find((monster) => monster.id === mon.midx)!;
    };
    expect((await read()).perceived).toBe(false);
    mon.mflag.on(MFLAG.VISIBLE);
    mon.mflag.off(MFLAG.VIEW);
    mon.mflag.off(MFLAG.CAMOUFLAGE);
    expect(await read()).toMatchObject({ visible: true, perceived: true });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    expect((await read()).perceived).toBe(false);
  });

  it("returns full race facts as frozen data without creating lore", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const api = host(game, READS, { firstParty: { truth: true } });
    const race = game.booted.registries.monsters.races.find((race) => race.blows.length > 0 && !race.spellFlags.isEmpty())!;
    const before = game.state.lore.size;
    const result = await api.truth!.race(race.ridx);
    if (!result.ok || !result.value) throw new Error("refused");
    expect(result.value).toMatchObject({ ridx: race.ridx, level: race.level, sleep: race.sleep, spellPower: race.spellPower, freqInnate: race.freqInnate, freqSpell: race.freqSpell });
    expect(result.value.spells).toEqual([...race.spellFlags].sort((a, b) => a - b));
    expect(result.value.blows[0]).toMatchObject({ effect: race.blows[0]!.effect.name });
    expect(Object.isFrozen(result.value.blows)).toBe(true);
    expect(structuredClone(result.value)).toEqual(result.value);
    expect(game.state.lore.size).toBe(before);
    expect(await api.truth!.race(-1)).toEqual({ ok: true, value: null });
  });

  it("keeps store stock at the last observation and declares the current truth policy", async () => {
    const games = [startGame({ ...pack, store: records("store") }, { seed: SEED, depth: DEPTH }), startGame({ ...pack, store: records("store") }, { seed: SEED, depth: DEPTH })];
    for (const game of games) {
      game.changeLevel(0);
      game.state.turn = 12;
      observeKnownStore(game.state, game.state.stores![0]!);
      game.changeLevel(1);
      game.state.turn = 20;
    }
    games[1]!.state.stores![0]!.stock = [];
    const a = host(games[0]!, READS, { firstParty: { truth: true } });
    const b = host(games[1]!, READS, { firstParty: { truth: true } });
    const worldA = await a.view.world();
    const worldB = await b.view.world();
    if (!worldA.ok || !worldB.ok) throw new Error("refused");
    expect(worldA.value.stores).toEqual(worldB.value.stores);
    const result = await a.truth!.storeKnowledge();
    if (!result.ok) throw new Error("refused");
    expect(result.value[0]).toMatchObject({ storeIndex: 0, feat: games[0]!.state.stores![0]!.feat, depth: 1, lastVisitTurn: 12, snapshotTurn: 20, stalenessRule: "current", remoteStockUsable: true });
    expect(result.value[1]!.lastVisitTurn).toBeNull();
    expect(Object.isFrozen(result.value[0])).toBe(true);
  });

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

  it("migrates install storage separately from profile preferences", async () => {
    const storage = memoryPrefs();
    storage.set(["profile-one"]);
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const options = { installStorage: storage, install: { version: 1, migrate: (value: JsonValue, from: number) => ({ profiles: value, from }) } };
    const first = host(game, [], options);
    expect(await first.store.install.get()).toEqual({ ok: true, value: { profiles: ["profile-one"], from: 0 } });
    await first.store.prefs.set("first-profile");
    const second = host(game, [], options);
    expect(await second.store.prefs.get()).toEqual({ ok: true, value: null });
    expect(await second.store.install.get()).toEqual({ ok: true, value: { profiles: ["profile-one"], from: 0 } });
    await second.store.install.set(null);
    expect(await first.store.install.get()).toEqual({ ok: true, value: null });
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

describe("API 2 engine and content", () => {
  it("keeps engine access live and requires consent outside first-party", () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const caps = capabilities("probe", ["engine:access"]);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: caps, registries: game.booted.registries });
    const api = createApi2Host(ctx, { grants: caps });
    expect(api.engine?.api).toBe("1.0.0");
    expect(api.engine?.core).toBe(ctx.core);
    expect(api.engine?.state).toBe(game.state);
    expect(api.engine?.registries).toBe(game.booted.registries);
    expect(Object.isFrozen(api.engine)).toBe(true);
    expect(host(game, []).engine).toBeUndefined();
    expect(host(game, [], { tier: "first-party" }).engine?.state).toBe(game.state);
    const worker = createApi2Host(ctx, { grants: caps, tier: "first-party", execution: "worker" });
    expect(worker.engine).toBeUndefined();
    expect(worker.meta.granted("engine:access")).toBe(false);
  });

  it("reads options and static categories without constructing an option state", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const api = host(game, READS);
    expect(await api.view.options()).toEqual({ ok: true, value: game.state.options!.snapshot() });
    expect(await host(game, []).view.options()).toMatchObject({ reason: "not-granted", capability: "state:player.read" });
    const pregame = createApi2Host(modPluginContext("probe", {}), { grants: capabilities("probe", []) });
    expect(await pregame.content.lookup({ file: "option", key: "birth_no_selling" })).toEqual({ ok: true, value: { name: "birth_no_selling", birth: true, cheat: false, score: false } });
    expect(await pregame.content.lookup({ file: "option", key: "cheat_live" })).toMatchObject({ value: { cheat: true, score: false } });
    expect(await pregame.content.lookup({ file: "option", key: "score_live" })).toMatchObject({ value: { cheat: false, score: true } });
  });

  it("returns bound indices, provenance, and activations as independent data", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const reg = game.booted.registries;
    const caps = capabilities("probe", []);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: caps, registries: reg,
      composedRecords: { monster: records("monster"), object: records("object") } });
    const api = createApi2Host(ctx, { grants: caps });
    const kind = reg.objects.kinds[1]!;
    kind.from = { owner: "fixture", modifiedBy: ["patch"], was: { name: "Original" } };
    kind.ext = { "fixture:label": "Extra" };
    const bound = await api.content.boundRecords("object");
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error("bound objects were refused");
    expect(bound.value.find((entry) => entry.index === kind.kidx)).toMatchObject({ name: kind.name, tval: kind.tval, owner: "fixture", from: kind.from, ext: kind.ext });
    expect(Object.isFrozen(bound.value[1])).toBe(true);
    const monsters = await api.content.boundRecords("monster");
    expect(monsters.ok).toBe(true);
    if (!monsters.ok) throw new Error("bound monsters were refused");
    expect(monsters.value.find((entry) => entry.index === 1)).toMatchObject({ name: reg.monsters.races[1]!.name, owner: "core" });
    expect(monsters.value.find((entry) => entry.index === 1)).not.toHaveProperty("from");
    const activation = reg.objects.activations.find((entry) => entry !== null)!;
    const activations = await api.content.activations();
    expect(activations).toMatchObject({ ok: true, value: expect.arrayContaining([expect.objectContaining({ name: activation.name, effect: activation.effect })]) });
    kind.activation = activation;
    expect(await api.content.activation({ tval: kind.tval, sval: kind.sval })).toMatchObject({ ok: true, value: { name: activation.name } });
    expect(await api.content.activation({ artifact: "absent" })).toEqual({ ok: true, value: null });
    const artifact = reg.objects.artifacts.find((entry) => entry?.activation);
    if (!artifact) throw new Error("no artifact activation in the pack");
    expect(await api.content.activation({ artifact: artifact.name })).toMatchObject({ value: { name: artifact.activation!.name } });
  });

  it("removes subscriptions and owned keys when the host stops", async () => {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    const bus = new GameEvents();
    game.state.events = bus;
    let heard = 0;
    const keys = new Map<string, string>();
    const caps = capabilities("probe", ["event:message", "keymap:write"]);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: caps });
    const api = createApi2Host({ ...ctx, keymaps: {
      bind: (trigger, action) => { keys.set(trigger, action); return true; },
      entries: () => [...keys].map(([trigger, action]) => ({ trigger, action })),
      remove: (trigger) => keys.delete(trigger),
      rebind: () => false,
      isBindableTriggerKey: () => true,
    } }, { grants: caps });
    await api.events.on("message", () => { heard += 1; });
    await api.ui.keys.bind("F2", "purge");
    bus.emit("message", { msg: "before", type: 0 });
    expect(heard).toBe(1);
    stopApi2Host(api);
    bus.emit("message", { msg: "after", type: 0 });
    expect(heard).toBe(1);
    expect(keys.size).toBe(0);
    expect(await api.events.on("message", () => undefined)).toMatchObject({ reason: "unavailable" });
  });

  it("delivers copied key events and unsubscribes them by handle and on stop", async () => {
    const caps = capabilities("probe", ["keymap:write"]);
    const listeners = new Set<(event: KeyboardEvent) => void>();
    const context = modPluginContext("probe", {});
    const api = createApi2Host({ ...context, display: { onKey: (listener: (event: KeyboardEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    } } as NonNullable<typeof context.display> }, { grants: caps });
    const heard: unknown[] = [];
    const subscription = await api.ui.onKey((event) => { heard.push(event); });
    expect(subscription.ok).toBe(true);
    if (!subscription.ok) throw new Error("key subscription was refused");
    const event = { key: "F2", code: "F2", repeat: true, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false } as KeyboardEvent;
    for (const listener of listeners) listener(event);
    expect(heard).toEqual([{ key: "F2", code: "F2", modifiers: ["ctrl"], isRepeat: true }]);
    expect(Object.isFrozen(heard[0])).toBe(true);
    await api.ui.offKey(subscription.value);
    expect(listeners.size).toBe(0);
    await api.ui.onKey(() => undefined);
    stopApi2Host(api);
    expect(listeners.size).toBe(0);
  });
});

describe("API 2 controller decisions", () => {
  function controller(definition: Api2ModDefinition, tier: "first-party" | "public" = "first-party") {
    const game = startGame(pack, { seed: SEED, depth: DEPTH });
    game.state.events = new GameEvents();
    const caps = capabilities("probe", ["command:add", "input:intent", "state:*.read", "event:message"]);
    const ctx = modPluginContext("probe", {}, game.state, {}, { capabilities: caps, snapshotSource: {
      state: () => game.state, viewDeps: () => ({}), phase: () => "play", messagePending: () => false,
      prompt: () => null, frame: () => null, knownLevel: () => null,
    } });
    const plugin = api2Plugin(definition, () => ({ grants: caps, tier }));
    plugin.register?.({} as never, ctx);
    const offered = plugin.controller!(ctx);
    const decide = typeof offered === "function" ? offered : offered?.controller;
    return { game, plugin, decide, caps };
  }

  it("submits a target before a command and obtains a fresh token", async () => {
    let before = 0;
    let after = 0;
    const { game, plugin, decide, caps } = controller({ api: ">=2.0.0 <3.0.0", controller: async (mod, input) => {
      before = input.token.revision;
      expect(await mod.act.submit(input.token, { kind: "target", x: game.state.actor.grid.x, y: game.state.actor.grid.y })).toEqual({ ok: true, value: null });
      const fresh = await mod.view.input();
      if (!fresh.ok) throw new Error("the controller has no input view");
      after = fresh.value.token.revision;
      expect(await mod.act.submit(fresh.value.token, { kind: "command", command: { code: "hold" } })).toEqual({ ok: true, value: null });
    } });
    const session = installController(game.state, decide!, { capabilities: caps });
    try {
      expect(game.state.nextCommand!()).toBeNull();
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(after).toBeGreaterThan(before);
      expect(game.state.nextCommand!()).toEqual({ code: "hold" });
    } finally { plugin.uninstall?.(); session.uninstall(); }
  });

  it("discards an asynchronous answer after the input wait changes", async () => {
    let release: () => void = () => undefined;
    let result: unknown;
    const { game, plugin, decide } = controller({ api: ">=2.0.0 <3.0.0", controller: async (mod, input) => {
      await new Promise<void>((resolve) => { release = resolve; });
      result = await mod.act.submit(input.token, { kind: "command", command: { code: "hold" } });
    } });
    const view = createAgentView(game.state);
    const act = createAgentActions(game.state);
    expect(decide!(view, act)).toBeNull();
    bumpInputRevision(game.state);
    release();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(result).toMatchObject({ reason: "refused", message: "stale input token" });
    expect(decide!(view, act)).toBeNull();
    plugin.uninstall?.();
    release();
  });

  it("keeps arming separate from ownership and refuses public controllers", () => {
    const definition = { api: ">=2.0.0 <3.0.0", armed: ({ armed }: { armed: boolean }) => armed, controller: () => undefined };
    expect(controller(definition).decide).toBeUndefined();
    expect(controller({ ...definition, armed: () => true }, "public").decide).toBeUndefined();
    const { plugin, decide } = controller({ ...definition, armed: () => true });
    expect(decide).toBeTypeOf("function");
    plugin.uninstall?.();
  });

  it("subscribes before play, drains messages per decision, and cleans up without a stop callback", () => {
    const messages: string[] = [];
    const heard: string[][] = [];
    const { game, plugin, decide } = controller({ api: ">=2.0.0 <3.0.0",
      start: (mod) => { void mod.events.on("message", (message) => { messages.push(message.text); }); },
      controller: (mod, input) => { heard.push(messages.splice(0)); void mod.act.submit(input.token, { kind: "command", command: { code: "hold" } }); },
    });
    game.state.events!.emit("message", { msg: "arrival", type: 0 });
    expect(decide!(createAgentView(game.state), createAgentActions(game.state))).toEqual({ code: "hold" });
    expect(heard).toEqual([["arrival"]]);
    expect(messages).toEqual([]);
    plugin.uninstall?.();
    game.state.events!.emit("message", { msg: "after stop", type: 0 });
    expect(messages).toEqual([]);
    expect(decide!(createAgentView(game.state), createAgentActions(game.state))).toBeNull();
    expect(inputToken(game.state).epoch).toBeGreaterThan(0);
  });
});
