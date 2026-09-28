/**
 * calc_bonuses (player-calcs.c:2401-2404): a changed light radius flags
 * PU_UPDATE_VIEW, so the view is rebuilt the moment a light is wielded, removed
 * or goes out, not on the character's next step.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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

describe("the view follows the light radius", () => {
  it("rebuilds the view when the radius changes and leaves it when it does not", () => {
    const game = startGame(pack, { seed: 7, depth: 5 });
    const { state } = game;
    const p = state.actor.player;
    const lightSlot = p.body.slots.findIndex((s) => s.type === "LIGHT");
    expect(p.equipment[lightSlot], "the new character carries a light").toBeTruthy();
    const litRadius = state.actor.light;
    expect(litRadius).toBeGreaterThan(0);

    let rebuilt = 0;
    const updateFov = state.updateFov!;
    state.updateFov = (s) => {
      rebuilt++;
      updateFov(s);
    };
    state.updateBonuses!();
    expect(rebuilt, "an unchanged radius needs no rebuild").toBe(0);

    const torch = p.equipment[lightSlot]!;
    p.equipment[lightSlot] = 0;
    state.updateBonuses!();
    expect(state.actor.light).toBeLessThan(litRadius);
    expect(rebuilt).toBe(1);

    p.equipment[lightSlot] = torch;
    state.updateBonuses!();
    expect(state.actor.light).toBe(litRadius);
    expect(rebuilt).toBe(2);
  });
});
