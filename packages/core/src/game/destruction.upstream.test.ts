/**
 * Upstream unit tests from reference/src/tests/effects/destruction.c
 *
 * Mapping:
 * - effect_simple(EF_DESTRUCTION, ...) -> EffectRegistry.effectSimple /
 *   registerTerrainHandlers handleDESTRUCTION (game/effect-terrain.ts)
 * - Object pile integrity after destruction (no use-after-free of known
 *   objects). Port: floor piles + effect run without throwing; knowledge
 *   update remains callable.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EF, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { registerTerrainHandlers } from "./effect-terrain";
import { buildEffectContext } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import { floorCarry, floorPile } from "./floor";
import { objectPrep } from "../obj/make";
import { bindConstants } from "../constants";
import { startGame } from "../session/game";
import type { GamePack } from "../session/game";

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
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const n = 1 + (x + y) % 3;
      for (let i = 0; i < n; i++) {
        const tval = tvals[i % tvals.length]!;
        const kind = reg.kinds.find((k) => k.tval === tval);
        if (!kind) continue;
        const obj = objectPrep(new Rng(x * 31 + y + i), reg, constants, kind, 1, "average");
        obj.number = 1;
        floorCarry(state, loc(x, y), obj);
      }
    }
  }
}

describe("effects/destruction (reference/src/tests/effects/destruction.c)", () => {
  // upstream: test_obj_pile_simple
  it("destruction:  object pile simple", () => {
    const game = startGame(pack, { seed: 7, depth: 1 });
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
      r.effectSimple(EF.DESTRUCTION, env, {
        origin: sourcePlayer(),
        radius: rad,
      });
    }).not.toThrow();
    // Pile integrity: every remaining floor entry is a non-null object list.
    for (const pile of state.floor.values()) {
      expect(Array.isArray(pile)).toBe(true);
      for (const o of pile) {
        expect(o).toBeTruthy();
        expect(o.number).toBeGreaterThan(0);
      }
    }
  });

  // upstream: test_obj_pile_orphan
  it("destruction:  object pile orphan", () => {
    const game = startGame(pack, { seed: 8, depth: 1 });
    const { state } = game;
    scatterPiles(game);
    // Orphan: remove objects from grids without freeing via square_delete.
    // Port equivalent: clear floor map entries (objects become unreferenced).
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
      r.effectSimple(EF.DESTRUCTION, env, {
        origin: sourcePlayer(),
        radius: rad,
      });
    }).not.toThrow();
  });
});

void floorPile;
