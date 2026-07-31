/**
 * Upstream unit tests from reference/src/tests/player/playerstat.c
 *
 * Mapping: player_stat_inc / player_stat_dec -> playerStatInc / playerStatDec
 * (player/exp.ts). STAT_STR is index 0.
 *
 * Note: playerStatInc draws RNG for values in the 18/xx range; the upstream
 * test only asserts " > 18" after the 18->teen bump, so any seed works.
 */

import { describe, expect, it } from "vitest";
import { STAT } from "../generated/index.js";
import { Rng } from "../rng.js";
import { playerStatDec, playerStatInc } from "./exp.js";
import { blankPlayer } from "./player.js";
import type { Player } from "./player.js";
import { bindPlayer } from "./bind.js";
import { readFileSync } from "node:fs";

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

function makeP(): Player {
  const race = reg.races[0]!;
  const cls = reg.classes[0]!;
  return blankPlayer(race, cls, reg.bodies[race.body]!);
}

describe("player/playerstat (reference/src/tests/player/playerstat.c)", () => {
  // upstream: test_stat_inc
  it("stat-inc", () => {
    const p = makeP();
    const rng = new Rng(1);

    p.statCur[STAT.STR] = 18 + 101;
    const v = playerStatInc(p, rng, STAT.STR);
    expect(v).toBe(false);

    p.statCur[STAT.STR] = 15;
    playerStatInc(p, rng, STAT.STR);
    expect(p.statCur[STAT.STR]).toBe(16);
    playerStatInc(p, rng, STAT.STR);
    expect(p.statCur[STAT.STR]).toBe(17);
    playerStatInc(p, rng, STAT.STR);
    expect(p.statCur[STAT.STR]).toBe(18);
    playerStatInc(p, rng, STAT.STR);
    expect(p.statCur[STAT.STR]!).toBeGreaterThan(18);
  });

  // upstream: test_stat_dec
  it("stat-dec", () => {
    const p = makeP();

    p.statCur[STAT.STR] = 3;
    p.statMax[STAT.STR] = 3;
    const v = playerStatDec(p, STAT.STR, true);
    expect(v).toBe(false);

    p.statCur[STAT.STR] = 15;
    p.statMax[STAT.STR] = 15;
    playerStatDec(p, STAT.STR, false);
    expect(p.statCur[STAT.STR]).toBe(14);
    expect(p.statMax[STAT.STR]).toBe(15);
    playerStatDec(p, STAT.STR, true);
    expect(p.statCur[STAT.STR]).toBe(13);
    expect(p.statMax[STAT.STR]).toBe(14);

    p.statCur[STAT.STR] = 18 + 13;
    p.statMax[STAT.STR] = 18 + 13;
    playerStatDec(p, STAT.STR, false);
    expect(p.statCur[STAT.STR]).toBe(18 + 3);
    expect(p.statMax[STAT.STR]).toBe(18 + 13);
    p.statMax[STAT.STR] = 18 + 3;
    playerStatDec(p, STAT.STR, true);
    expect(p.statCur[STAT.STR]).toBe(18);
    expect(p.statMax[STAT.STR]).toBe(18);
  });
});
