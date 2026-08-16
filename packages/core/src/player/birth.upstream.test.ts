/**
 * Upstream unit tests from reference/src/tests/player/birth.c
 *
 * Mapping: player_generate -> generatePlayer (player/birth.ts).
 * Upstream uses unit-test-data test_race/test_class; the port uses real pack
 * Human/Warrior and asserts the same observables: lev==1 and race/class pointers.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { bindPlayer } from "./bind.js";
import { generatePlayer } from "./birth.js";

function packJson<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

const reg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
});

describe("player/birth (reference/src/tests/player/birth.c)", () => {
  // upstream: test_generate0
  it("generate0", () => {
    const race = reg.raceByName("Human")!;
    const cls = reg.classByName("Warrior")!;
    const body = reg.bodies[race.body]!;
    const result = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race) },
      new Rng(1),
    );
    expect(result.player.lev).toBe(1);
    expect(result.player.race).toBe(race);
    expect(result.player.cls).toBe(cls);
  });
});
