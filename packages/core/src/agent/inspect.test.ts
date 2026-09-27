/** Seeded inspection reads must leave the entire saved game unchanged. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, MFLAG, TV } from "../generated/index.js";
import { gearAdd } from "../game/gear.js";
import { objectSeeAt } from "../game/known.js";
import { objectInfoTextblock } from "../game/object-inspect.js";
import { loreDescription } from "../mon/lore-describe.js";
import { newMonsterLore } from "../mon/lore.js";
import { objectPrep } from "../obj/make.js";
import { tvalIsPotion } from "../obj/object.js";
import { spellByIndex, spellChance } from "../player/spell.js";
import { makeSpellChanceEnv } from "../game/spell-cmd.js";
import { floorPile } from "../game/floor.js";
import { saveGame, startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import { AgentCapabilityError } from "./types.js";
import { createAgentView } from "./perceive.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  /* store.json is here because one arm of LoadoutItemRef addresses a SHOP's
     stock, and a pack with no shops cannot exercise it. */
  store: loadRecords("store"),
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  obj: {
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

function newGame(): StartedGame {
  return startGame(pack, { seed: 4242, depth: 1 });
}
/** Everything a read must not change, as one comparable value. */
function fingerprint(game: StartedGame): string {
  return JSON.stringify({
    save: saveGame(game),
    rng: game.state.rng.getState(),
    turn: game.state.turn,
    cmdQueue: game.state.cmdQueue ?? [],
  });
}

function viewFor(game: StartedGame, caps?: { has(cap: string): boolean }) {
  const state = game.state;
  const player = state.actor.player;
  const loreDeps = () => ({
    playerLevel: player.lev,
    playerMaxDepth: player.maxDepth,
    playerSpeed: state.actor.speed,
    effectiveSpeed: false,
    purpleUniques: false,
    spells: game.booted.registries.monsters.spells,
    breathProjection: (i: number) => game.booted.registries.projections?.[i],
  });
  const objectInfo = {
    projections: game.booted.registries.projections ?? [],
    constants: game.booted.registries.constants,
  };
  return { view: createAgentView(state, undefined, { reg: game.booted.registries.objects, inspect: {
    objectInfo,
    races: game.booted.registries.monsters.races,
    loreDeps,
    projections: game.booted.registries.projections ?? [],
  } }, caps), loreDeps, objectInfo };
}

describe("inspection reads", () => {
  it("repeats item, recall, spell, tester and map reads without a state change", () => {
    const game = newGame();
    const state = game.state;
    const potion = game.booted.registries.objects.kinds.find((kind) => tvalIsPotion(kind.tval));
    expect(potion).toBeDefined();
    expect(state.isAware?.(potion!)).toBe(false);
    const obj = objectPrep(state.rng, game.booted.registries.objects, game.booted.registries.constants, potion!, 1, "minimise");
    const handle = gearAdd(state.gear, obj);
    state.gear.pack.push(handle);
    state.gear.inven ??= [];
    state.gear.inven.push(handle);
    const quivered = objectPrep(state.rng, game.booted.registries.objects, game.booted.registries.constants, potion!, 1, "minimise");
    const quiverHandle = gearAdd(state.gear, quivered);
    state.gear.pack.push(quiverHandle);
    state.gear.quiver ??= [];
    state.gear.quiver.push(quiverHandle);
    const floorObj = objectPrep(state.rng, game.booted.registries.objects, game.booted.registries.constants, potion!, 1, "minimise");
    const floorKey = state.actor.grid.y * state.chunk.width + state.actor.grid.x;
    state.floor.set(floorKey, [floorObj, ...(state.floor.get(floorKey) ?? [])]);
    const race = game.booted.registries.monsters.races.find((r) => r && r.ridx > 0)!;
    state.lore.set(race.ridx, { ...newMonsterLore(race), sights: 1 });
    const caster = game.players.classes.find((cls) => cls.magic.totalSpells > 0)!;
    state.actor.player.cls = caster;
    state.actor.player.csp = 0;
    const spellIndex = caster.magic.books[0]!.spells[0]!.sidx;
    expect(spellByIndex(caster, spellIndex)!.mana).toBeGreaterThan(0);
    const { view, loreDeps, objectInfo } = viewFor(game);
    const to = { x: state.actor.grid.x + 3, y: state.actor.grid.y };
    const before = fingerprint(game);
    for (let i = 0; i < 5; i++) {
      const item = view.inspectItem!(handle)!;
      expect(item.text).toBe(objectInfoTextblock(state, obj, objectInfo, true).runs.map((run) => run.text).join(""));
      expect(Object.isFrozen(item)).toBe(true);
      const recall = view.monsterRecall!(race.ridx)!;
      expect(recall.text).toBe(loreDescription(race, state.lore.get(race.ridx)!, loreDeps()).map((run) => run.text).join(""));
      expect(view.spellInfo!(spellIndex)?.failChance).toBe(spellChance(state.actor.player, state.statInd ?? [], spellIndex, makeSpellChanceEnv(state)));
      expect(view.spellInfo!(spellIndex)?.description).toBe(spellByIndex(caster, spellIndex)!.text);
      expect(view.itemTester!("quaff").items).toContainEqual({ handle });
      expect(view.itemTester!("quaff").items).toContainEqual({ floor: { ...state.actor.grid, index: 0 } });
      expect(view.itemTester!("quaff").items).not.toContainEqual({ handle: quiverHandle });
      expect(view.itemTester!("ignore").items).toContainEqual({ handle: quiverHandle });
      view.projectionPath!(to);
      view.blastArea!(to, 2);
      view.travelPath!(to);
      view.tileActions!(to);
      view.itemRules!();
    }
    expect(fingerprint(game)).toBe(before);
  });

  it("does not create lore for an unseen race", () => {
    const game = newGame();
    const index = game.booted.registries.monsters.races.findIndex((race) => race && !game.state.lore.has(race.ridx));
    const view = viewFor(game).view;
    const before = fingerprint(game);
    for (let i = 0; i < 5; i++) expect(view.monsterRecall!(index)).toBeNull();
    expect(fingerprint(game)).toBe(before);
  });

  it("answers only for floor objects the player remembers and races the player has met", () => {
    const game = newGame();
    const state = game.state;
    const potion = game.booted.registries.objects.kinds.find((kind) => tvalIsPotion(kind.tval))!;
    const floorObj = objectPrep(state.rng, game.booted.registries.objects, game.booted.registries.constants, potion, 1, "minimise");
    const grid = { x: state.actor.grid.x, y: state.actor.grid.y };
    const floorKey = grid.y * state.chunk.width + grid.x;
    state.floor.set(floorKey, [floorObj, ...(state.floor.get(floorKey) ?? [])]);
    const race = game.booted.registries.monsters.races.find((r) => r && r.ridx > 0 && !state.lore.has(r.ridx))!;
    state.lore.set(race.ridx, newMonsterLore(race));
    const view = viewFor(game).view;
    expect(view.inspectItem!({ floor: { ...grid, index: 0 } })).toBeNull();
    expect(view.monsterRecall!(race.ridx)).toBeNull();
    objectSeeAt(state, grid, floorObj);
    state.lore.set(race.ridx, { ...newMonsterLore(race), sights: 1 });
    expect(view.inspectItem!({ floor: { ...grid, index: 0 } })?.title).toBeTruthy();
    expect(view.monsterRecall!(race.ridx)?.title).toBe(race.name);
  });

  it("uses remembered walls and visible monsters for previews", () => {
    const game = newGame();
    const state = game.state;
    const from = state.actor.grid;
    const wall = { x: from.x + 1, y: from.y };
    const to = { x: from.x + 3, y: from.y };
    state.known.feat[wall.y * state.chunk.width + wall.x] = FEAT.GRANITE;
    const view = viewFor(game).view;
    const before = fingerprint(game);
    for (let i = 0; i < 5; i++) {
      expect(view.projectionPath!(to).grids.at(-1)).toEqual(wall);
      expect(view.blastArea!(to, 2).grids).not.toContainEqual(to);
    }
    expect(fingerprint(game)).toBe(before);
    state.known.feat[wall.y * state.chunk.width + wall.x] = FEAT.FLOOR;
    const mon = state.monsters.find((m) => m && m.midx > 0);
    expect(mon).toBeDefined();
    mon!.mflag.on(MFLAG.VISIBLE);
    state.chunk.setMon(wall, mon!.midx);
    const blocked = fingerprint(game);
    for (let i = 0; i < 5; i++) expect(view.projectionPath!(to).grids.at(-1)).toEqual(wall);
    expect(fingerprint(game)).toBe(blocked);
  });

  it("checks each domain before reading", () => {
    const game = newGame();
    const view = viewFor(game, { has: () => false }).view;
    expect(() => view.inspectItem!(1)).toThrow(AgentCapabilityError);
    expect(() => view.monsterRecall!(1)).toThrow(AgentCapabilityError);
    expect(() => view.spellInfo!(0)).toThrow(AgentCapabilityError);
    expect(() => view.itemTester!("quaff")).toThrow(AgentCapabilityError);
    expect(() => view.projectionPath!({ x: 1, y: 1 })).toThrow(AgentCapabilityError);
    expect(() => view.blastArea!({ x: 1, y: 1 }, 2)).toThrow(AgentCapabilityError);
    expect(() => view.travelPath!({ x: 1, y: 1 })).toThrow(AgentCapabilityError);
    expect(() => view.tileActions!({ x: 1, y: 1 })).toThrow(AgentCapabilityError);
    expect(() => view.itemRules!()).toThrow(AgentCapabilityError);
    expect(() => view.bookForItem!(1)).toThrow(AgentCapabilityError);
    expect(() => view.compareLoadoutSlots!({ from: "gear", handle: 1 })).toThrow(AgentCapabilityError);
  });

  it("returns stock sections, book mapping, paired slots and blast metadata without mutation", () => {
    const game = startGame(pack, { seed: 4242, depth: 0 });
    const state = game.state;
    const store = state.stores!.find((entry) => entry.stock.length > 0)!;
    expect(store).toBeDefined();
    const storeIndex = state.stores!.indexOf(store);
    state.actor.player.cls = game.players.classes.find((cls) => cls.magic.books.length > 0)!;
    const bookKind = game.booted.registries.objects.kinds.find((kind) =>
      state.actor.player.cls.magic.books.some((book) => book.tvalIdx === kind.tval && book.sval === kind.sval));
    const ringKind = game.booted.registries.objects.kinds.find((kind) => kind.tval === TV.RING)!;
    const book = bookKind ? objectPrep(state.rng, game.booted.registries.objects,
      game.booted.registries.constants, bookKind, 1, "minimise") : null;
    const ring = objectPrep(state.rng, game.booted.registries.objects,
      game.booted.registries.constants, ringKind, 1, "minimise");
    const bookHandle = book ? gearAdd(state.gear, book) : 0;
    const ringHandle = gearAdd(state.gear, ring);
    state.gear.pack.push(ringHandle);
    const view = viewFor(game).view;
    const before = fingerprint(game);
    for (let i = 0; i < 5; i++) {
      const stockInfo = view.inspectItem!({ store: storeIndex, index: 0 })!;
      expect(stockInfo.sections?.[0]).toEqual({ kind: "title", text: stockInfo.title });
      expect(stockInfo.sections?.slice(1).map((section) => section.text).join("\n\n")).toBe(stockInfo.text.trim());
      expect(Object.isFrozen(stockInfo.sections)).toBe(true);
      if (book) expect(view.bookForItem!(bookHandle)?.spells).toEqual(
        state.actor.player.cls.magic.books.find((entry) => entry.tvalIdx === book.tval && entry.sval === book.sval)!.spells.map((spell) => spell.sidx));
      const comparisons = view.compareLoadoutSlots!({ from: "gear", handle: ringHandle });
      expect(comparisons.token).toEqual(view.inputToken!());
      expect(comparisons.slots.filter((slot) => state.actor.player.body.slots[slot.slot]?.type === "RING")).toHaveLength(2);
      expect(Object.isFrozen(comparisons.slots)).toBe(true);
      const blast = view.blastArea!({ x: state.actor.grid.x + 1, y: state.actor.grid.y }, 2);
      expect(blast).toMatchObject({ radius: 2, element: null, wallsStop: true });
      expect(Object.isFrozen(blast)).toBe(true);
    }
    expect(fingerprint(game)).toBe(before);
    const inventoryOnly = viewFor(game, { has: (cap) => cap === "state:inventory.read" }).view;
    expect(() => inventoryOnly.inspectItem!({ store: storeIndex, index: 0 })).toThrow(AgentCapabilityError);
  });

  it("reports the travel command's remembered route without changing the game", () => {
    const game = newGame();
    const state = game.state;
    const from = state.actor.grid;
    const to = { x: from.x + 3, y: from.y };
    for (let x = from.x + 1; x <= to.x; x++) state.known.feat[from.y * state.chunk.width + x] = FEAT.FLOOR;
    const view = viewFor(game).view;
    const before = fingerprint(game);
    for (let i = 0; i < 5; i++) {
      const path = view.travelPath!(to)!;
      expect(path.token).toEqual(view.inputToken!());
      expect(Object.isFrozen(path.grids)).toBe(true);
      expect(Math.max(Math.abs(path.grids[0]!.x - from.x), Math.abs(path.grids[0]!.y - from.y))).toBe(1);
      expect(path.grids.at(-1)).toEqual(to);
      expect(view.travelPath!({ x: from.x + 4, y: from.y })).toBeNull();
    }
    expect(fingerprint(game)).toBe(before);
  });

  it("uses remembered terrain and the command codes for adjacent grid actions", () => {
    const game = newGame();
    const state = game.state;
    const from = state.actor.grid;
    const next = { x: from.x + 1, y: from.y };
    const index = next.y * state.chunk.width + next.x;
    state.known.feat[index] = FEAT.CLOSED;
    state.chunk.setFeat(next, FEAT.CLOSED);
    const view = viewFor(game).view;
    const before = fingerprint(game);
    for (let i = 0; i < 5; i++) {
      const actions = view.tileActions!(next);
      expect(Object.isFrozen(actions.codes)).toBe(true);
      expect(actions.codes).toContain("open");
      expect(actions.codes).not.toContain("walk");
      expect(actions.codes).not.toContain("attack");
      expect(view.tileActions!(from).codes).not.toContain("open");
    }
    expect(fingerprint(game)).toBe(before);
    state.known.feat[index] = FEAT.FLOOR;
    state.chunk.setFeat(next, FEAT.FLOOR);
    const kind = game.booted.registries.objects.kinds.find((entry) => tvalIsPotion(entry.tval))!;
    const obj = objectPrep(state.rng, game.booted.registries.objects, game.booted.registries.constants, kind, 1, "minimise");
    state.floor.set(index, [obj]);
    expect(view.tileActions!(next).codes).toContain("walk");
    expect(view.tileActions!(next).codes).not.toContain("pickup");
    state.floor.set(from.y * state.chunk.width + from.x, [obj]);
    expect(floorPile(state, from)).toContain(obj);
    expect(view.tileActions!(from).codes).toContain("pickup");
    state.chunk.setFeat(from, FEAT.LESS);
    state.known.feat[from.y * state.chunk.width + from.x] = FEAT.LESS;
    expect(view.tileActions!(from).codes).toContain("ascend");
    expect(view.tileActions!(from).codes).not.toContain("descend");
    state.chunk.setFeat(from, FEAT.MORE);
    state.known.feat[from.y * state.chunk.width + from.x] = FEAT.MORE;
    expect(view.tileActions!(from).codes).toContain("descend");
  });

  it("reads learned ignore and auto-inscription rules after the existing kind toggle", () => {
    const game = newGame();
    const state = game.state;
    const kind = game.booted.registries.objects.kinds.find((entry) => (state.isAware?.(entry) ?? false) && entry.name)!;
    state.everseen!.markKind(kind);
    state.ignore.kindToggleAware(kind.kidx);
    state.autoinscribe!.set(kind.kidx, "@m1", true);
    state.autoinscribe!.set(kind.kidx, "@m2", false);
    const view = viewFor(game).view;
    const before = fingerprint(game);
    for (let i = 0; i < 5; i++) {
      const rules = view.itemRules!();
      expect(Object.isFrozen(rules.kinds)).toBe(true);
      expect(rules.kinds.find((row) => row.kidx === kind.kidx)).toMatchObject({ ignoreAware: true, noteAware: "@m1", noteUnaware: "@m2" });
      expect(rules.quality).toHaveLength(26);
    }
    expect(fingerprint(game)).toBe(before);
  });
});
