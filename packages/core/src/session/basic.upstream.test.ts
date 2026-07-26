/**
 * Upstream unit tests from reference/src/tests/game/basic.c
 *
 * Mapping:
 * - player_make_simple + prepare_next_level + savefile_save/load
 *   -> startGame / saveGame / loadGame (session/game.ts)
 * - CMD_GO_DOWN / CMD_WALK: exercised through the installed command registry,
 *   then the session level changer, matching the observable post-conditions.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TMD, TV } from "../generated";
import { PY_FOOD_FULL_DEFAULT } from "../player/birth";
import { floorCarry, floorPile } from "../game/floor";
import { gearGet } from "../game/gear";
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
    const descend = game.registry.get("descend");
    expect(descend, "the session must register the descend action").toBeTruthy();
    expect(
      game.state.chunk.isDownstairs(game.state.actor.grid),
      "the town start must stand on its down staircase",
    ).toBe(true);
    expect(descend!(game.state, { code: "descend" })).toBe(game.state.z.moveEnergy);
    expect(game.state.generateLevel).toBe(true);
    expect(game.state.targetDepth).toBe(1);
    game.changeLevel(game.state.targetDepth!);
    expect(game.state.chunk.depth).toBe(1);
  });

  // upstream: test_stairs2 — walk off stairs then back before descending
  it("stairs2", () => {
    const game = startGame(pack, { seed: 3, depth: 1 });
    const { state, registry } = game;
    const start = { ...state.actor.grid };
    const step = [
      { dir: 6, dx: 1, dy: 0 },
      { dir: 4, dx: -1, dy: 0 },
      { dir: 2, dx: 0, dy: 1 },
      { dir: 8, dx: 0, dy: -1 },
    ].find(({ dx, dy }) => {
      const grid = { x: start.x + dx, y: start.y + dy };
      return state.chunk.inBounds(grid) && state.chunk.isPassable(grid);
    });
    expect(step, "the generated level must have an adjacent passable square").toBeDefined();
    const walk = registry.get("walk");
    expect(walk, "the session must register the walk action").toBeTruthy();
    expect(walk!(state, { code: "walk", dir: step!.dir })).toBe(state.z.moveEnergy);
    expect(state.actor.grid).toEqual({ x: start.x + step!.dx, y: start.y + step!.dy });
    expect(game.state.chunk.depth).toBe(1);
    const back = ({ 2: 8, 4: 6, 6: 4, 8: 2 } as const)[step!.dir]!;
    expect(walk!(state, { code: "walk", dir: back })).toBe(state.z.moveEnergy);
    expect(state.actor.grid).toEqual(start);
    expect(game.state.chunk.depth).toBe(1);
  });

  // upstream: test_drop_pickup
  it("droppickup", () => {
    const game = startGame(pack, { seed: 4, depth: 1 });
    const { state, booted, registry } = game;
    const constants = bindConstants(pack.constants as never);
    const reg = booted.registries.objects;
    const foodKind = reg.kinds.find((k) => k.tval === TV.FOOD);
    expect(foodKind).toBeTruthy();
    const stack = objectPrep(new Rng(1), reg, constants, foodKind!, 1, "average");
    stack.number = 5;
    expect(floorCarry(state, state.actor.grid, stack)).toBe(true);
    const pickup = registry.get("pickup");
    expect(pickup, "the session must register the pickup action").toBeTruthy();
    expect(pickup!(state, { code: "pickup" })).toBeGreaterThan(0);
    const handle = state.gear.pack.find((h) => gearGet(state.gear, h)?.tval === TV.FOOD);
    expect(handle, "pickup must carry the food stack used by CMD_DROP").toBeDefined();
    const carried = gearGet(state.gear, handle!);
    expect(carried?.number, "CMD_DROP requires a carried stack with more than one item").toBeGreaterThan(1);
    const drop = registry.get("drop");
    expect(drop, "the session must register the drop action").toBeTruthy();
    expect(drop!(state, { code: "drop", args: { handle: handle!, quantity: 1 } })).toBe(
      Math.trunc(state.z.moveEnergy / 2),
    );
    expect(floorPile(state, state.actor.grid).some((o) => o.number === 1)).toBe(
      true,
    );
    const autopickup = registry.get("autopickup");
    expect(autopickup, "the session must register the autopickup action").toBeTruthy();
    expect(autopickup!(state, { code: "autopickup" })).toBeGreaterThan(0);
    expect(floorPile(state, state.actor.grid).length).toBe(0);
  });

  // upstream: test_drop_eat
  it("dropeat", () => {
    const game = startGame(pack, { seed: 5, depth: 1 });
    const { state, booted, registry } = game;
    const constants = bindConstants(pack.constants as never);
    const reg = booted.registries.objects;
    const foodKind = reg.kinds.find((k) => k.tval === TV.FOOD);
    expect(foodKind).toBeTruthy();
    const food = objectPrep(new Rng(1), reg, constants, foodKind!, 1, "average");
    const num = 3;
    food.number = num;
    expect(floorCarry(state, state.actor.grid, food)).toBe(true);
    const pickup = registry.get("pickup");
    expect(pickup, "the session must register the pickup action").toBeTruthy();
    expect(pickup!(state, { code: "pickup" })).toBeGreaterThan(0);
    const handle = state.gear.pack.find((h) => gearGet(state.gear, h)?.tval === TV.FOOD);
    expect(handle, "pickup must carry the food stack used by CMD_DROP").toBeDefined();
    const carried = gearGet(state.gear, handle!);
    expect(carried?.number).toBe(num);
    const drop = registry.get("drop");
    expect(drop, "the session must register the drop action").toBeTruthy();
    expect(drop!(state, { code: "drop", args: { handle: handle!, quantity: num } })).toBe(
      Math.trunc(state.z.moveEnergy / 2),
    );
    expect(floorPile(state, state.actor.grid)[0]?.number).toBe(num);
    const eat = registry.get("eat");
    expect(eat, "the session must register the eat action").toBeTruthy();
    expect(eat!(state, { code: "eat", args: { floor: 0 } })).toBe(state.z.moveEnergy);
    expect(floorPile(state, state.actor.grid)[0]?.number).toBe(num - 1);
  });
});
