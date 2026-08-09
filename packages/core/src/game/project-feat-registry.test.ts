/**
 * The project_f handler table, as a table.
 *
 * `project-feat-vectors.test.ts` replays 6,552 recorded outcomes and is what
 * proves the refactor changed no behaviour. This file asserts the two things a
 * replay cannot see, because a vector only exercises codes core ships:
 *
 *  1. The table is a COMPLETE statement of the switch it replaced - every code
 *     in the bound projection table is accounted for, and every key in the
 *     table is a real code. Both directions, because a table with a catch-all
 *     behind it goes quietly wrong in one of them: a code that silently falls
 *     through to observe-only looks identical to one handled on purpose.
 *  2. A mod can reach it - by code, for a projection whose PROJ number did not
 *     exist when core was compiled.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ } from "../generated/index.js";
import { bindProjections, CORE_PROJECTION_COUNT } from "../world/projection.js";
import type { ProjectionInfo, ProjectionRecordJson } from "../world/projection.js";
import { PROJECT_FEAT_HANDLERS, projectFeature } from "./project-feat.js";
import type { ProjectFeatHandler } from "./project-feat.js";
import type { GameState } from "./context.js";

function coreRecords(): ProjectionRecordJson[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ) as { records: ProjectionRecordJson[] };
  return parsed.records;
}

const projections = bindProjections(coreRecords());

/** The codes whose upstream project_f arm does nothing at all. */
const INERT = [
  "AWAY_UNDEAD",
  "AWAY_EVIL",
  "AWAY_SPIRIT",
  "AWAY_ALL",
  "TURN_UNDEAD",
  "TURN_EVIL",
  "TURN_LIVING",
  "TURN_ALL",
  "DISP_UNDEAD",
  "DISP_EVIL",
  "DISP_ALL",
  "SLEEP_UNDEAD",
  "SLEEP_EVIL",
  "SLEEP_ALL",
  "MON_CLONE",
  "MON_POLY",
  "MON_HEAL",
  "MON_SPEED",
  "MON_SLOW",
  "MON_CONF",
  "MON_HOLD",
  "MON_STUN",
  "MON_DRAIN",
  "MON_CRUSH",
];

/** The codes with a handler that actually does something to terrain. */
const ACTIVE = [
  "LIGHT_WEAK",
  "LIGHT",
  "DARK_WEAK",
  "DARK",
  "KILL_WALL",
  "KILL_DOOR",
  "KILL_TRAP",
  "MAKE_DOOR",
  "MAKE_TRAP",
  "FIRE",
  "PLASMA",
  "COLD",
  "ICE",
];

describe("PROJECT_FEAT_HANDLERS", () => {
  it("names only codes that exist, and covers the switch it replaced", () => {
    const real = new Set(projections.map((p) => p.code));
    /* Direction 1: no key is a typo. A misspelled key is the worst failure this
     * refactor can have - the handler silently never runs and the projection
     * quietly becomes observe-only, which is a plausible-looking outcome. */
    expect([...PROJECT_FEAT_HANDLERS.keys()].filter((c) => !real.has(c))).toEqual([]);

    /* Direction 2: the 37 arms are all here, by name. */
    expect([...ACTIVE, ...INERT].filter((c) => !PROJECT_FEAT_HANDLERS.has(c))).toEqual([]);
    expect(PROJECT_FEAT_HANDLERS.size).toBe(ACTIVE.length + INERT.length);
    expect(ACTIVE.length + INERT.length).toBe(37);
  });

  it("leaves the elemental codes OUT, so they fall to observe-only", () => {
    /* Upstream's `default`. Asserting the absence explicitly, because "not in
     * the table" is a deliberate decision here and not an omission - and a test
     * that only checks presence cannot tell those apart. */
    const unhandled = projections
      .map((p) => p.code)
      .filter((c) => !PROJECT_FEAT_HANDLERS.has(c));
    expect(unhandled).toEqual([
      "ACID",
      "ELEC",
      "POIS",
      "SOUND",
      "SHARD",
      "NEXUS",
      "NETHER",
      "CHAOS",
      "DISEN",
      "WATER",
      "GRAVITY",
      "INERTIA",
      "FORCE",
      "TIME",
      "METEOR",
      "MISSILE",
      "MANA",
      "HOLY_ORB",
      "ARROW",
    ]);
    /* 56 = 37 handled + 19 observe-only. */
    expect(unhandled.length + PROJECT_FEAT_HANDLERS.size).toBe(
      CORE_PROJECTION_COUNT,
    );
  });

  it("shares one handler between the codes upstream shares an arm between", () => {
    /* LIGHT/LIGHT_WEAK, DARK/DARK_WEAK, FIRE/PLASMA and COLD/ICE were `case`
     * fallthroughs; the same function is how that survives the rewrite. */
    for (const [a, b] of [
      ["LIGHT", "LIGHT_WEAK"],
      ["DARK", "DARK_WEAK"],
      ["FIRE", "PLASMA"],
      ["COLD", "ICE"],
    ]) {
      expect(PROJECT_FEAT_HANDLERS.get(a as string)).toBe(
        PROJECT_FEAT_HANDLERS.get(b as string),
      );
    }
  });
});

describe("a mod's own terrain handler", () => {
  /* A GameState is large; project_f's dispatch reads none of it before the
   * handler runs, so a handler that ignores its ctx needs nothing real. The
   * tests that DO exercise a handler are the 6,552 vectors. */
  const state = {} as unknown as GameState;
  const grid = { x: 1, y: 1 };
  const sludgeProjections: readonly ProjectionInfo[] = bindProjections([
    ...coreRecords(),
    { code: "SLUDGE", name: "sludge", type: "environs", desc: "sludge" },
  ]);
  const SLUDGE = CORE_PROJECTION_COUNT;

  it("runs for a projection whose PROJ number did not exist at compile time", () => {
    let ran = 0;
    const mine: ProjectFeatHandler = () => {
      ran++;
      return true;
    };
    const table = new Map(PROJECT_FEAT_HANDLERS).set("SLUDGE", mine);

    const obvious = projectFeature(state, 0, grid, 10, SLUDGE, {
      projections: sludgeProjections,
      featHandlers: table,
    });
    expect(obvious).toBe(true);
    expect(ran).toBe(1);
  });

  it("needs the bound table to resolve, and says nothing rather than guessing", () => {
    /* Without `projections` the code for slot 56 is unknown, so the dispatcher
     * falls to observe-only rather than to some other projection's handler.
     * Control for the resolution order: a wrong answer here would be a mod's
     * projection silently running KILL_WALL. */
    let ran = 0;
    const table = new Map(PROJECT_FEAT_HANDLERS).set("SLUDGE", () => {
      ran++;
      return true;
    });
    /* observed() reads state, so this measures only that the mod handler did
     * NOT run - which is the claim. */
    expect(() =>
      projectFeature(state, 0, grid, 10, SLUDGE, { featHandlers: table }),
    ).toThrow();
    expect(ran).toBe(0);
  });

  it("can REPLACE a core code, and does not disturb the shipped table", () => {
    let ran = 0;
    const table = new Map(PROJECT_FEAT_HANDLERS).set("KILL_WALL", () => {
      ran++;
      return true;
    });
    expect(projectFeature(state, 0, grid, 10, PROJ.KILL_WALL, {
      featHandlers: table,
    })).toBe(true);
    expect(ran).toBe(1);
    /* The module's own table is untouched: overriding is per-call, so one
     * mod's replacement cannot leak into another's dispatch. */
    expect(PROJECT_FEAT_HANDLERS.get("KILL_WALL")).not.toBe(table.get("KILL_WALL"));
  });
});
