/** Reads added for interface effects: terrain catalogue, monster quest flags, player warnings, object auras. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OF, TV } from "../generated/index.js";
import { objectSeeAt } from "../game/known.js";
import { objectPrep } from "../obj/make.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { saveGame, startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import { createAgentView } from "./perceive.js";
import type { RememberedObject } from "./known-level.js";

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

function auraAt(game: StartedGame, grid: { x: number; y: number }): RememberedObject[] {
  const level = viewFor(game).view.knownLevel!()!;
  return [...(level.cells.find((cell) => cell.x === grid.x && cell.y === grid.y)?.remembered.objects ?? [])];
}

function weaponOnFloor(game: StartedGame) {
  const state = game.state;
  const reg = game.booted.registries.objects;
  const kind = reg.kinds.find((k) => k && k.tval === TV.SWORD)!;
  const obj = objectPrep(state.rng, reg, game.booted.registries.constants, kind, 1, "minimise");
  const grid = { x: state.actor.grid.x, y: state.actor.grid.y };
  const key = grid.y * state.chunk.width + grid.x;
  state.floor.set(key, [obj, ...(state.floor.get(key) ?? [])]);
  objectSeeAt(state, grid, obj);
  return { obj, grid };
}

describe("reads for interface effects", () => {
  it("lists every terrain feature with its stairs and fire flags, without a state change", () => {
    const game = newGame();
    const view = viewFor(game).view;
    const before = fingerprint(game);
    const catalogue = view.terrainCatalogue!();
    expect(Object.isFrozen(catalogue.features)).toBe(true);
    const byCode = new Map(catalogue.features.map((f) => [f.code, f]));
    expect(byCode.get("LESS")).toMatchObject({ stairs: "up", fiery: false });
    expect(byCode.get("MORE")).toMatchObject({ stairs: "down" });
    expect(byCode.get("LAVA")).toMatchObject({ fiery: true, stairs: null });
    expect(byCode.get("FLOOR")?.passable).toBe(true);
    expect(byCode.get("GRANITE")?.passable).toBe(false);
    expect(byCode.get("LAVA")?.flags).toContain("FIERY");
    expect(fingerprint(game)).toBe(before);
  });

  it("marks unique monsters and the guardian of the last quest", () => {
    const game = startGame(pack, { seed: 4242, depth: 10 });
    const state = game.state;
    const monsters = viewFor(game).view.monsters();
    expect(monsters.length).toBeGreaterThan(0);
    for (const m of monsters) {
      expect(m.unique).toBe(m.raceFlags.includes("UNIQUE"));
      expect(m.finalGuardian).toBe(false);
    }
    const target = monsters[0]!;
    const other = monsters.find((m) => m.raceIndex !== target.raceIndex);
    const quests = state.actor.player.quests;
    quests.length = 0;
    quests.push({ name: "Earlier", level: 9, race: other?.raceIndex ?? 0, maxNum: 1, curNum: 0 });
    quests.push({ name: "Last", level: 10, race: target.raceIndex, maxNum: 1, curNum: 0 });
    const again = viewFor(game).view.monsters();
    expect(again.find((m) => m.id === target.id)).toMatchObject({ questGuardian: true, finalGuardian: true });
    if (other) expect(again.find((m) => m.id === other.id)).toMatchObject({ questGuardian: true, finalGuardian: false });
  });

  it("reports the low hit point threshold and the recall and descent timers", () => {
    const game = newGame();
    const p = game.state.actor.player;
    p.mhp = 57;
    game.state.options!.hitpointWarn = 3;
    p.wordRecall = 15;
    p.deepDescent = 0;
    const player = viewFor(game).view.player();
    expect(player).toMatchObject({ hpWarning: 17, recall: 15, descent: 0 });
    game.state.options!.hitpointWarn = 0;
    expect(viewFor(game).view.player().hpWarning).toBe(0);
  });

  it("gives a remembered object the glow class its name already shows", () => {
    const game = newGame();
    const { obj, grid } = weaponOnFloor(game);
    const aura = () => auraAt(game, grid).map((o) => ("aura" in o ? o.aura : undefined))[0];
    expect(aura()).toBeUndefined();

    obj.flags.on(OF.SEE_INVIS);
    obj.notice |= OBJ_NOTICE.ASSESSED;
    expect(aura()).toBe("rune");

    const artifact = game.booted.registries.objects.artifacts.find((a) => a !== null)!;
    obj.artifact = artifact;
    expect(aura()).toBe("artifact");

    const env = game.state.runeEnv;
    const curseIndex = env.curses.findIndex((c, i) => i > 0 && c);
    obj.curses = Array.from({ length: env.curses.length }, () => ({ power: 0, timeout: 0 }));
    obj.curses[curseIndex]!.power = 10;
    game.state.actor.player.objKnown.curses[curseIndex] = 1;
    expect(aura()).toBe("cursed");
  });

  it("never names a glow for an object the player has not identified as special", () => {
    const game = newGame();
    const { obj, grid } = weaponOnFloor(game);
    obj.artifact = game.booted.registries.objects.artifacts.find((a) => a !== null)!;
    const before = fingerprint(game);
    const objects = auraAt(game, grid);
    expect(objects[0] && "aura" in objects[0] ? objects[0].aura : undefined).toBeUndefined();
    expect(fingerprint(game)).toBe(before);
  });
});
