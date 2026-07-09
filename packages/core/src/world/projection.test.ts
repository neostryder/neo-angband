import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ } from "../generated";
import { Rng } from "../rng";
import { adjustDam, bindProjections } from "./projection";
import type { ProjectionRecordJson } from "./projection";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

const projections = bindProjections(
  packJson<ProjectionRecordJson>("projection"),
);
const rng = () => new Rng(1);

describe("bindProjections", () => {
  it("binds all 56 projection types in PROJ order", () => {
    expect(projections).toHaveLength(56);
    expect(projections[PROJ.ACID]!.code).toBe("ACID");
    expect(projections[PROJ.MON_CRUSH]!.code).toBe("MON_CRUSH");
  });

  it("captures element resist data and flags", () => {
    const acid = projections[PROJ.ACID]!;
    expect(acid.type).toBe("element");
    expect(acid.numerator).toBe(1);
    expect(acid.denominator).not.toBeNull();
    expect(acid.obvious).toBe(true);
    expect(acid.wake).toBe(true);

    const lightWeak = projections[PROJ.LIGHT_WEAK]!;
    expect(lightWeak.type).toBe("environs");
    expect(lightWeak.denominator).toBeNull();
    expect(lightWeak.wake).toBe(false);
  });
});

describe("adjustDam", () => {
  it("returns 0 for an immune player (res_level 3)", () => {
    expect(adjustDam(rng(), projections, PROJ.FIRE, 100, "average", 3)).toBe(0);
  });

  it("multiplies damage by 4/3 for a vulnerable player (res_level -1)", () => {
    expect(adjustDam(rng(), projections, PROJ.FIRE, 90, "average", -1)).toBe(
      120,
    );
  });

  it("leaves damage unchanged with no resistance", () => {
    expect(adjustDam(rng(), projections, PROJ.FIRE, 90, "average", 0)).toBe(90);
  });

  it("divides by the constant denominator per resist level (ACID = /3)", () => {
    expect(adjustDam(rng(), projections, PROJ.ACID, 90, "average", 1)).toBe(30);
    /* Two levels of resist compound: 90 -> 30 -> 10 */
    expect(adjustDam(rng(), projections, PROJ.ACID, 90, "average", 2)).toBe(10);
  });

  it("halves acid damage first when the player has damageable armour", () => {
    /* minus_ac: (100 + 1) / 2 = 50, then no resist */
    expect(adjustDam(rng(), projections, PROJ.ACID, 100, "average", 0, true)).toBe(
      50,
    );
  });

  it("uses the variable denominator with the aspect inverted (LIGHT 6/den)", () => {
    /* denominator 8+1d4: avg 10, min 9, max 12. numerator 6. */
    expect(adjustDam(rng(), projections, PROJ.LIGHT, 100, "average", 1)).toBe(60);
    /* minimise damage -> maximise divisor (12): 100*6/12 = 50 */
    expect(adjustDam(rng(), projections, PROJ.LIGHT, 100, "minimise", 1)).toBe(50);
    /* maximise damage -> minimise divisor (9): 100*6/9 = 66 */
    expect(adjustDam(rng(), projections, PROJ.LIGHT, 100, "maximise", 1)).toBe(66);
  });
});
