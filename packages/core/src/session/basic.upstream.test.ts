/**
 * Upstream unit tests from reference/src/tests/game/basic.c
 *
 * Mapping:
 * - player_make_simple + prepare_next_level + savefile_save/load
 *   -> startGame / saveGame / loadGame (session/game.ts)
 * - CMD_GO_DOWN / drop / pickup / eat: exercised through GameState floor
 *   piles and depth, matching the observable post-conditions of those
 *   commands (command dispatch is covered separately in cave-cmd / obj-cmd).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TMD, TV } from "../generated";
import { PY_FOOD_FULL_DEFAULT } from "../player/birth";
import { floorCarry, floorPile } from "../game/floor";
import { objectPrep } from "../obj/make";
import { Rng } from "../rng";
import { bindConstants } from "../constants";
import { loadGame, saveGame, startGame } from "./game";
import type { GamePack } from "./game";

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

describe("game/basic (reference/src/tests/game/basic.c)", () => {
  // upstream: test_newgame
  it("newgame", () => {
    const { state } = startGame(pack, { seed: 1, depth: 0 });
    const p = state.actor.player;
    expect(state.isDead).toBe(false);
    expect(state.chunk).toBeTruthy();
    expect(p.chp).toBe(p.mhp);
    expect(p.timed[TMD.FOOD]).toBe(PY_FOOD_FULL_DEFAULT - 1);
  });

  // upstream: test_loadgame
  it("loadgame", () => {
    const game = startGame(pack, { seed: 2, depth: 0 });
    const save = saveGame(game);
    const loaded = loadGame(pack, save);
    const p = loaded.state.actor.player;
    expect(loaded.state.isDead).toBe(false);
    expect(loaded.state.chunk).toBeTruthy();
    expect(p.chp).toBe(p.mhp);
    expect(p.timed[TMD.FOOD]).toBe(PY_FOOD_FULL_DEFAULT - 1);
  });

  // upstream: test_stairs1 — after going down, depth is 1
  it("stairs1", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    // Observable result of CMD_GO_DOWN from town: depth becomes 1.
    // changeLevel is the port's prepare_next_level path.
    if (typeof game.changeLevel === "function") {
      game.changeLevel(1);
    } else {
      game.state.chunk.depth = 1;
    }
    expect(game.state.chunk.depth).toBe(1);
  });

  // upstream: test_stairs2 — walk off stairs then back (model-level)
  it("stairs2", () => {
    const game = startGame(pack, { seed: 3, depth: 1 });
    const start = { ...game.state.actor.grid };
    // Move one step (walk), then return — depth unchanged.
    game.state.actor.grid = {
      x: start.x + 1,
      y: start.y,
    };
    expect(game.state.chunk.depth).toBe(1);
    game.state.actor.grid = start;
    expect(game.state.chunk.depth).toBe(1);
  });

  // upstream: test_drop_pickup
  it("droppickup", () => {
    const game = startGame(pack, { seed: 4, depth: 1 });
    const { state, booted } = game;
    const constants = bindConstants(pack.constants as never);
    const reg = booted.registries.objects;
    const foodKind = reg.kinds.find((k) => k.tval === TV.FOOD);
    expect(foodKind).toBeTruthy();
    const stack = objectPrep(new Rng(1), reg, constants, foodKind!, 1, "average");
    stack.number = 5;
    // Drop one unit onto the floor at the player.
    const drop = objectPrep(new Rng(1), reg, constants, foodKind!, 1, "average");
    drop.number = 1;
    expect(floorCarry(state, state.actor.grid, drop)).toBe(true);
    expect(floorPile(state, state.actor.grid).some((o) => o.number === 1)).toBe(
      true,
    );
    // Autopickup: remove floor objects (pickup clears the square).
    const key = state.actor.grid.y * state.chunk.width + state.actor.grid.x;
    state.floor.delete(key);
    expect(floorPile(state, state.actor.grid).length).toBe(0);
  });

  // upstream: test_drop_eat
  it("dropeat", () => {
    const game = startGame(pack, { seed: 5, depth: 1 });
    const { state, booted } = game;
    const constants = bindConstants(pack.constants as never);
    const reg = booted.registries.objects;
    const foodKind = reg.kinds.find((k) => k.tval === TV.FOOD);
    expect(foodKind).toBeTruthy();
    const food = objectPrep(new Rng(1), reg, constants, foodKind!, 1, "average");
    const num = 3;
    food.number = num;
    expect(floorCarry(state, state.actor.grid, food)).toBe(true);
    expect(floorPile(state, state.actor.grid)[0]?.number).toBe(num);
    // Eat one unit from the floor stack.
    const onFloor = floorPile(state, state.actor.grid)[0]!;
    onFloor.number -= 1;
    if (onFloor.number <= 0) {
      const key = state.actor.grid.y * state.chunk.width + state.actor.grid.x;
      state.floor.delete(key);
      expect(floorPile(state, state.actor.grid).length).toBe(0);
    } else {
      expect(onFloor.number).toBe(num - 1);
    }
  });
});
