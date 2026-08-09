/**
 * Replay the object-naming table recorded on disk. MOD_REACH gap 15.
 *
 * These vectors were recorded BEFORE any naming registry existed. Their whole
 * value is that the fixture is older than the refactor - a test that computes
 * the answer twice in one process cannot fail across one, because agreement is
 * symmetric. See the header of `desc-vectors.ts` for what the grid covers and
 * why each axis is there.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TVAL_ENTRIES } from "../generated/tvals.js";
import { descVectorFixtures } from "./desc-vectors.fixtures.js";
import { computeDescVectors } from "./desc-vectors.js";
import type { DescVector } from "./desc-vectors.js";

const tvalName = (tval: number): string =>
  TVAL_ENTRIES[tval]?.name ?? `TVAL_${String(tval)}`;

const golden = JSON.parse(
  readFileSync(new URL("./desc-vectors.json", import.meta.url), "utf8"),
) as DescVector[];

const fresh = computeDescVectors(descVectorFixtures(), tvalName);

describe("object naming replays its recorded descriptions", () => {
  it("covers every item class the shipped data can produce", () => {
    expect(fresh.length).toBe(golden.length);

    /* THE COVERAGE CHECK, and it caught a real hole. Upstream 4.2.6 defines NO
     * book in object.txt - `registerBookKinds` synthesises them from class.txt's
     * `book:` lines - so a grid built from the object pack alone reached 31 of
     * the switch's 34 arms and the five book templates were never exercised. A
     * fixture that calls the real producer closes it; this assertion is what
     * stops it reopening. */
    const tvals = new Set(fresh.map((v) => v.tval));
    for (const name of [
      "MAGIC_BOOK",
      "PRAYER_BOOK",
      "NATURE_BOOK",
      "SHADOW_BOOK",
    ]) {
      expect({ name, covered: tvals.has(name) }).toEqual({ name, covered: true });
    }

    /* OTHER_BOOK is honestly NOT covered, and saying so is the point. No class
     * in 4.2.6 declares a book of that tval, so no shipped record can reach the
     * arm - it is reachable only by a mod that adds such a class. Recording the
     * absence beats a synthetic kind that would prove nothing about the game. */
    expect(tvals.has("OTHER_BOOK")).toBe(false);

    /* Around thirty item classes, six axes each. A scanner that silently
     * matched nothing would otherwise make the comparison below pass forever
     * against an empty list. */
    expect(tvals.size).toBeGreaterThanOrEqual(33);
    expect(new Set(fresh.map((v) => v.axes)).size).toBe(6);
    expect(fresh.length).toBeGreaterThan(2000);
  });

  it("the only descriptions that read (nothing) are upstream's placeholders", () => {
    /* `obj_desc_get_basename`'s default arm returns the literal "(nothing)",
     * which is the silent failure a mod-coined tval would hit. Four kinds take
     * it today and all four are upstream's own internal objects, carried
     * faithfully: <pile>, <unknown item>, <unknown treasure>, <curse object>,
     * all `type:none`. Pinning the LIST means a real item falling into the
     * default arm fails here rather than blending in. */
    const blank = [
      ...new Set(fresh.filter((v) => v.desc === "(nothing)").map((v) => v.kind)),
    ].sort();
    expect(blank).toEqual([
      "<curse object>",
      "<pile>",
      "<unknown item>",
      "<unknown treasure>",
    ]);
  });

  it("describes every kind the same way", () => {
    /* Compared row by row so a failure names the item and the axis. */
    for (let i = 0; i < golden.length; i++) {
      expect(fresh[i]).toEqual(golden[i]);
    }
  });
});
