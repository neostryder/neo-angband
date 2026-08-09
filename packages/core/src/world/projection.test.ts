import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ } from "../generated/index.js";
import { Rng } from "../rng.js";
import { adjustDam, bindProjections, CORE_PROJECTION_COUNT } from "./projection.js";
import type { ProjectionRecordJson } from "./projection.js";

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

describe("a projection a mod added", () => {
  /* Until 2026-08-08 this threw `projection: unknown code SLUDGE` - the one
   * content change that took the game DOWN rather than being ignored, and it
   * reached the bind intact because composition merges projection.json per
   * record (keyed by `code`). */
  const core = (): ProjectionRecordJson[] =>
    packJson<ProjectionRecordJson>("projection");
  const sludge: ProjectionRecordJson = {
    code: "SLUDGE",
    name: "sludge",
    type: "environs",
    desc: "sludge",
    color: "Green",
  };

  it("binds after the compiled-in ones, moving none of them", () => {
    const before = bindProjections(core());
    const after = bindProjections([...core(), sludge]);

    expect(after).toHaveLength(before.length + 1);
    /* THE PARITY CLAIM, over the whole table rather than a sample: a spot check
     * would pass while a run of slots had shifted by one, and every PROJ_ value
     * upstream compiled in is a number this port hard-codes. */
    expect(after.slice(0, before.length).map((p) => `${String(p.index)}:${p.code}`))
      .toEqual(before.map((p) => `${String(p.index)}:${p.code}`));

    const added = after[CORE_PROJECTION_COUNT];
    expect(added?.code).toBe("SLUDGE");
    expect(added?.index).toBe(CORE_PROJECTION_COUNT);
    expect(added?.name).toBe("sludge");
  });

  it("takes a second new projection at the next slot, and a repeat is a duplicate", () => {
    const grime: ProjectionRecordJson = { code: "GRIME", type: "monster" };
    const two = bindProjections([...core(), sludge, grime]);
    expect(two[CORE_PROJECTION_COUNT + 1]?.code).toBe("GRIME");

    expect(() => bindProjections([...core(), sludge, { ...sludge }])).toThrow(
      /duplicate code SLUDGE/,
    );
  });

  it("refuses a new ELEMENT, because el_info has no slot for one", () => {
    /* The line between extending core and breaking it. The first 25 slots are
     * list-elements.h and el_info[] is indexed by ELEM value, so an element in
     * slot 56 is one the player could never resist. Refused by name rather than
     * bound into something that silently does not work. */
    expect(() =>
      bindProjections([...core(), { ...sludge, type: "element" }]),
    ).toThrow(/type "element"/);
  });

  it("does not resolve a code through Object.prototype", () => {
    /* `PROJ["constructor"]` is a FUNCTION, not undefined, so the old bare
     * lookup would have bound this record at index `function Object()`.
     * Unreachable while every code came from core's own file; a mod-supplied
     * code is what makes it reachable. */
    const odd = bindProjections([
      ...core(),
      { ...sludge, code: "constructor" },
    ]);
    expect(odd[CORE_PROJECTION_COUNT]?.code).toBe("constructor");
    expect(odd[CORE_PROJECTION_COUNT]?.index).toBe(CORE_PROJECTION_COUNT);
  });

  it("still refuses a pack that is missing a compiled-in projection", () => {
    /* Control: widening what binds must not widen this. Dropping ACID is pack
     * drift, not a mod, and it still fails. */
    expect(() => bindProjections(core().slice(1))).toThrow(/PARSE_ERROR|no record/);
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
