/**
 * The `input-flush` event as a mod receives it through `ctx.events`, on a real
 * game.
 *
 * Upstream's disturb() ends by signalling EVENT_INPUT_FLUSH (player-util.c:1674),
 * and the port's disturb() now does too. A disturbance is driven here through a
 * genuine engine flow - a rest to full hitpoints, whose completion check is one
 * of disturb()'s callers - so the test covers the shell's capability wiring, not
 * just the bus.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GameEvents,
  REST_ALL_POINTS,
  runGameLoop,
  startGame,
  type GamePack,
} from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { modPluginContext } from "./mod-context";

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

function capabilities(id: string, granted: string[]): CapabilitySet {
  return CapabilitySet.fromManifest({
    id, name: id, version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: granted,
  });
}

describe("a mod's input-flush subscription", () => {
  it("hears a rest's completion disturbance, and a mod without the grant hears none", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    game.state.events = new GameEvents();

    const tracker = modPluginContext("tracker", {}, game.state, {}, {
      capabilities: capabilities("tracker", ["event:input-flush"]),
    });
    const heard: number[] = [];
    tracker.events!.on("input-flush", () => heard.push(game.state.turn));

    const plain = modPluginContext("plain", {}, game.state, {}, { capabilities: capabilities("plain", []) });
    expect(plain.events).toBeUndefined();

    /* A rest to full hitpoints: the fresh character is already at full health,
     * so the loop's completion check (loop.ts processPlayerChecked ->
     * playerRestingCompleteSpecial, game-world.c:936) disturbs on the rest's
     * first turn. At least that one disturbance is guaranteed; the world phase
     * may bring townsperson visibility disturbances of its own, so the count is
     * a floor, not an exact number. */
    game.registry.get("rest")!(game.state, { code: "rest", args: { count: REST_ALL_POINTS } });
    runGameLoop(game.state, game.registry);

    expect(heard.length).toBeGreaterThanOrEqual(1);
    expect(game.state.resting).toBeUndefined();
  });
});
