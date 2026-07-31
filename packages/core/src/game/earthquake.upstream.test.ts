/**
 * Upstream unit tests from reference/src/tests/effects/earthquake.c
 *
 * Mapping: same as effects/destruction.c but EF_EARTHQUAKE.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EF, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { registerTerrainHandlers } from "./effect-terrain.js";
import { buildEffectContext } from "./effect-env.js";
import { attachGameEnv } from "./effect-game-env.js";
import { floorCarry } from "./floor.js";
import { objectPrep } from "../obj/make.js";
import { bindConstants } from "../constants.js";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";

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

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerTerrainHandlers(r);
  return r;
}

function scatterPiles(game: ReturnType<typeof startGame>): void {
  const { state, booted } = game;
  const constants = bindConstants(pack.constants as never);
  const reg = booted.registries.objects;
  const tvals = [TV.BOOTS, TV.LIGHT, TV.SCROLL];
  const c = state.chunk;
  for (let y = 1; y < Math.min(c.height - 1, 12); y++) {
    for (let x = 1; x < Math.min(c.width - 1, 14); x++) {
      const kind = reg.kinds.find((k) => k.tval === tvals[(x + y) % 3]!);
      if (!kind) continue;
      const obj = objectPrep(new Rng(x * 17 + y), reg, constants, kind, 1, "average");
      obj.number = 1;
      floorCarry(state, loc(x, y), obj);
    }
  }
}

describe("effects/earthquake (reference/src/tests/effects/earthquake.c)", () => {
  // upstream: test_obj_pile_simple
  it("quake:  object pile simple", () => {
    const game = startGame(pack, { seed: 9, depth: 1 });
    const { state } = game;
    scatterPiles(game);
    const r = registry();
    const env = attachGameEnv(
      buildEffectContext(state, { timedTable: [] }),
      { state } as never,
    );
    const rad = Math.max(
      Math.trunc(state.chunk.width / 2),
      Math.trunc(state.chunk.height / 2),
    );
    expect(() => {
      r.effectSimple(EF.EARTHQUAKE, env, {
        origin: sourcePlayer(),
        radius: rad,
      });
    }).not.toThrow();
    for (const pile of state.floor.values()) {
      expect(Array.isArray(pile)).toBe(true);
      for (const o of pile) {
        expect(o).toBeTruthy();
        expect(o.number).toBeGreaterThan(0);
      }
    }
  });

  // upstream: test_obj_pile_orphan
  it("quake:  object pile orphan", () => {
    const game = startGame(pack, { seed: 10, depth: 1 });
    const { state } = game;
    scatterPiles(game);
    state.floor.clear();
    const r = registry();
    const env = attachGameEnv(
      buildEffectContext(state, { timedTable: [] }),
      { state } as never,
    );
    const rad = Math.max(
      Math.trunc(state.chunk.width / 2),
      Math.trunc(state.chunk.height / 2),
    );
    expect(() => {
      r.effectSimple(EF.EARTHQUAKE, env, {
        origin: sourcePlayer(),
        radius: rad,
      });
    }).not.toThrow();
  });
});
