/** The SEE_ORE treasure sense, wired through the live effect stack. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT } from "../generated/index.js";
import { knownFeat } from "../game/known.js";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
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

/**
 * The SEE_ORE sense (game-world.c:952-962): a dwarf in good shape remembers the
 * treasure veins within three squares before each command.
 */
describe("the dwarf's sense for ore", () => {
  it("remembers a treasure vein within three squares", () => {
    const game = startGame(pack, { seed: 7, depth: 5 });
    const { state } = game;
    const at = { x: state.actor.grid.x + 2, y: state.actor.grid.y };
    state.chunk.setFeat(at, FEAT.MAGMA_K);
    expect(knownFeat(state, at)).not.toBe(FEAT.MAGMA_K);
    state.detectOre!();
    expect(knownFeat(state, at)).toBe(FEAT.MAGMA_K);
  });
});
