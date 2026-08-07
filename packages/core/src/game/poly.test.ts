/**
 * poly_race (project-mon.c:45) against the real race table.
 *
 * The wiring test next door proves the hook is supplied and swaps a monster;
 * it cannot prove the CHOICE obeys upstream's filters, because a level with no
 * uniques in range passes either way. Removing the unique filter survived that
 * test, so the filters get their own draws here.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import { RF } from "../generated/index.js";
import { polyRace } from "./poly.js";
import type { MonsterRace } from "../mon/types.js";

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

describe("poly_race obeys its filters over many draws (project-mon.c:45-81)", () => {
  const game = startGame(pack, { seed: 4242, depth: 20 });
  const deps = game.wizardBundles.monPlace;
  const races = game.booted.registries.monsters.races.filter(
    (r): r is MonsterRace => r !== null && !!r.name,
  );

  /** Upstream's own bands (L57-59), recomputed here from the C rather than
   *  copied out of the implementation. */
  function band(race: MonsterRace) {
    return {
      min: Math.min(race.level - 10, Math.trunc((race.level * 3) / 4)),
      max: Math.max(race.level + 10, Math.trunc((race.level * 5) / 4)),
    };
  }

  it("never returns a unique, and never leaves the level band", () => {
    /* A spread of non-unique source races across the depth curve. */
    const sources = races
      .filter((r) => !r.flags.has(RF.UNIQUE) && r.level > 0 && r.level <= 40)
      .filter((_, i) => i % 7 === 0)
      .slice(0, 30);
    expect(sources.length, "fixture: the pack has races to draw from").toBeGreaterThan(10);

    let changed = 0;
    let belowBand = 0;
    let aboveBand = 0;
    let uniques = 0;
    const currentLevel = 20;

    for (const src of sources) {
      for (let i = 0; i < 40; i++) {
        const got = polyRace(game.state, src, currentLevel, deps!);
        /* Returning the argument is upstream's "found nothing" (L79-80) - a
         * real outcome that carries no invariants. */
        if (got === src) continue;
        changed++;
        if (got.flags.has(RF.UNIQUE)) uniques++;
        const { min, max } = band(src);
        if (got.level < min) belowBand++;
        if (got.level > max) aboveBand++;
        /* No FORCE_DEPTH counter here: every RF_FORCE_DEPTH race in the pack
         * is also RF_UNIQUE, so the filter is unreachable on stock data and a
         * zero would be a fixture that cannot disagree. The reason is recorded
         * at the filter itself (game/poly.ts). */
      }
    }

    /* Without a real sample the zeroes below would be vacuous. */
    expect(changed, "poly_race found replacements at all").toBeGreaterThan(100);
    expect(uniques).toBe(0);
    /* The lower bound has no escape hatch, so it must never be crossed. */
    expect(belowBand).toBe(0);
    /* The UPPER bound does: "small chance to allow something really strong"
     * raises maxlvl to 100 one time in a hundred (project-mon.c:62). So an
     * above-band result is upstream behaviour, and the assertion is on its
     * RATE - a bound of 10% against an expected 1%. Asserting zero here would
     * have been the test measuring the wrong thing; it is what this test did
     * first, and it failed for exactly that reason. */
    expect(aboveBand * 10).toBeLessThan(changed);
  });

  it("returns a unique unchanged - uniques never polymorph (L54)", () => {
    const unique = races.find((r) => r.flags.has(RF.UNIQUE) && r.level <= 30);
    expect(unique, "fixture: the pack has a unique").toBeDefined();
    /* The early return means no RNG is drawn either. */
    const before = JSON.stringify(game.state.rng.getState());
    expect(polyRace(game.state, unique!, 20, deps!)).toBe(unique);
    expect(JSON.stringify(game.state.rng.getState())).toBe(before);
  });
});
