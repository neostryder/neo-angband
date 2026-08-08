/**
 * Replay the project_f golden vectors.
 *
 * CHECK ONLY. There is no regenerate-if-missing branch and no environment flag
 * that would let a failing run rewrite its own expectation - a marker that can
 * disable its own check is not a check. Regenerating is a separate, committed
 * script whose header says outright that it overwrites the evidence.
 *
 * The vectors were recorded from `projectFeature` BEFORE its 37-case switch
 * became a registry. Replaying them identically is the whole claim: the
 * conversion bought moddability and changed no terrain behaviour.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  recordAllProjectFeat,
  VECTOR_PROJECTIONS,
  VECTOR_TERRAINS,
} from "./project-feat-vectors.js";
import type { ProjectFeatVector } from "./project-feat-vectors.js";
import { projectFeatFixtures } from "./project-feat-vectors.fixtures.js";

const vectors = JSON.parse(
  readFileSync(new URL("./project-feat-vectors.json", import.meta.url), "utf8"),
) as ProjectFeatVector[];

/* Replayed through the SAME grid builder the generator uses, once, then
 * compared group by group. Re-listing the dimensions here would let the check
 * and the recording drift apart on a dimension neither would then cover. */
const replayed = recordAllProjectFeat(projectFeatFixtures());
const byId = new Map(vectors.map((v) => [v.id, v]));

/**
 * COULD THIS FAIL?
 *
 * A recording of 6,240 scenarios in which nothing ever happened would replay
 * forever. These assertions pin the branches the vectors exist to protect, so a
 * fixture that stopped reaching them fails here rather than passing emptily.
 * Two of them are here because the first pass DID go quiet: the trap-disable
 * arm fired zero times until the fixture revealed the trap, and the buried
 * object never once appeared until a seed was chosen that reaches its 10% roll.
 */
describe("project_f vectors: the recording can disagree", () => {
  const messages = vectors.flatMap((v) => v.messages);

  it("reaches every message project_f can produce", () => {
    const seen = new Set(messages);
    expect([...seen].sort()).toEqual([
      "Click!",
      "The door turns into mud!",
      "The rubble turns into mud!",
      "The trap seizes up.",
      "The vein turns into mud!",
      "The wall turns into mud!",
      "There is a bright flash of light!",
      "There was something buried in the rubble!",
      "You have found something!",
    ]);
  });

  it("reaches every terrain transition the handlers can make", () => {
    const moves = new Set(
      vectors.filter((v) => v.feat !== v.terrain).map((v) => `${v.terrain}->${v.feat}`),
    );
    /* Both COLD outcomes on lava and both KILL_TRAP outcomes on a secret door:
     * a recording that reached only one arm of a coin flip would ratchet in
     * half the behaviour. */
    for (const move of [
      "RUBBLE->FLOOR",
      "CLOSED->FLOOR",
      "MAGMA_K->FLOOR",
      "QUARTZ_K->FLOOR",
      "MAGMA->FLOOR",
      "QUARTZ->FLOOR",
      "GRANITE->FLOOR",
      "SECRET->CLOSED",
      "SECRET->FLOOR",
      "FLOOR->CLOSED",
      "FLOOR->LAVA",
      "LAVA->FLOOR",
      "LAVA->PASS_RUBBLE",
    ]) {
      expect(moves, `transition ${move}`).toContain(move);
    }
  });

  it("records both outcomes of every boolean it measures", () => {
    for (const field of ["obvious", "glow", "fovRefreshed", "trapHere"] as const) {
      const values = new Set(vectors.map((v) => v[field]));
      expect(values, `${field} takes both values`).toEqual(new Set([true, false]));
    }
  });

  it("records a push that moved objects rather than destroying them", () => {
    /* push_object relocates the pile; a vector set where objectsTotal always
     * fell would be recording a bug as the baseline. */
    const pushed = vectors.filter((v) => v.objectsHere === 0 && v.objectsTotal > 0);
    expect(pushed.length).toBeGreaterThan(0);
  });

  it("holds one vector per scenario in the declared grid, and no more", () => {
    /* Both directions: a scenario dropped from the grid and a stale row left in
     * the file are the same kind of silent coverage loss. */
    expect(vectors).toHaveLength(replayed.length);
    expect(byId.size).toBe(vectors.length);
  });

  it("records the surface, where the sun branches live, and the dungeon", () => {
    /* The first recording ran entirely at depth 0 because that is the harness
     * default, which left `glow` true in every one of 6,240 rows and DARK's
     * un-glow never exercised. Both depths, or the grid is measuring the
     * harness rather than the game. */
    expect(new Set(vectors.map((v) => v.depth)).size).toBeGreaterThan(1);
  });
});

/**
 * One `it()` per (projection, terrain). Finer than per-file and coarser than
 * per-row: a divergence names the handler and the terrain in the test title,
 * and the diff carries the scenario id, without minting 6,240 test cases.
 */
describe("project_f vectors replay identically", () => {
  for (const [projName] of VECTOR_PROJECTIONS) {
    for (const [terrainName] of VECTOR_TERRAINS) {
      it(`${projName} on ${terrainName}`, () => {
        const pick = (rows: readonly ProjectFeatVector[]): ProjectFeatVector[] =>
          rows.filter((v) => v.proj === projName && v.terrain === terrainName);
        const expected = pick(vectors);
        expect(expected.length, "the grid still holds this pair").toBeGreaterThan(0);
        expect(pick(replayed)).toEqual(expected);
      });
    }
  }
});
