import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BlowVector } from "./blow-vectors.js";
import { computeBlowVectors } from "./blow-vectors.js";
import { blowVectorFixtures } from "./blow-vectors.fixtures.js";
import { RESOLVED_BLOW_EFFECTS } from "./mon-melee.js";

const RECORDED = JSON.parse(
  readFileSync(new URL("./blow-vectors.json", import.meta.url), "utf8"),
) as BlowVector[];

const COMPUTED = computeBlowVectors(blowVectorFixtures());

/**
 * The blow-effect registry replaced two 26-case switches that resolve live
 * combat. `blow-vectors.json` was recorded from the code as it stood before
 * that refactor, so these tests are the evidence that it changed nothing.
 *
 * They are CHECK-ONLY on purpose. There is no "regenerate if missing" branch
 * and no environment flag that rewrites the file, because a check that repairs
 * its own subject stops being a check the first time it is convenient. The
 * generator is a separate script a person runs deliberately.
 */
describe("monster blow golden vectors", () => {
  it("covers every resolved blow effect, in both directions", () => {
    const recorded = new Set(RECORDED.map((v) => v.effect));
    expect([...recorded].sort()).toEqual([...RESOLVED_BLOW_EFFECTS].sort());
    expect(RECORDED).toHaveLength(COMPUTED.length);
  });

  /**
   * A fixture of 480 misses would match forever. This is the guard that the
   * evidence can actually disagree: every scenario must land its blow, and the
   * grid must reach the branches that matter - deaths, applied side effects,
   * and world-touching calls.
   */
  it("is evidence that could fail: hits, deaths, side effects and env calls", () => {
    const runs = RECORDED.flatMap((v) => [v.worldless, v.liveSoft, v.liveHard]);
    const blows = runs.flatMap((r) => r.blows);
    expect(blows.length).toBeGreaterThan(1000);
    expect(blows.filter((b) => b.startsWith("hit"))).toHaveLength(blows.length);
    expect(runs.filter((r) => r.playerDied).length).toBeGreaterThan(100);
    expect(runs.flatMap((r) => r.sideEffects).length).toBeGreaterThan(100);
    expect(runs.flatMap((r) => r.calls).length).toBeGreaterThan(1000);
  });

  /**
   * One test per scenario rather than one deep-equal over the array: a
   * divergence then names the blow, the method, the dice and the hp it happened
   * under, instead of dumping 480 records and leaving the reader to diff them.
   */
  for (const [i, expected] of RECORDED.entries()) {
    const label =
      `${expected.effect}/${expected.method} ${expected.dice} ` +
      `ac=${expected.ac} hp=${expected.hp}`;
    it(`resolves ${label} exactly as recorded`, () => {
      expect(COMPUTED[i]).toEqual(expected);
    });
  }
});
