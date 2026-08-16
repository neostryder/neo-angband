/**
 * Tests for the persistent-level stair-join machinery: get_join_info
 * (generate.c L893-992), the chunk->join population (L1203-1214),
 * get_min_level_size (L997-1013), and lair_gen's two helpers -
 * find_joinfree_vertical_seam and transform_join_list (gen-cave.c L984-1117).
 *
 * These are the pure, generation-side halves of the birth_levels_persist stair
 * round-trip. The savefile serialization and the changeLevel threading are
 * outside gen/ and are covered by session/persist-levels.test.ts, which drives
 * a real game down and back up.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import type { ConstantsJson } from "../constants.js";
import { FEAT } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { Chunk } from "../world/chunk.js";
import { FeatureRegistry } from "../world/feature.js";
import type { TerrainRecordJson } from "../world/feature.js";
import {
  collectJoins,
  getJoinInfo,
  getMinLevelSize,
  type AdjacentJoins,
} from "./generate.js";
import { findJoinfreeVerticalSeam, transformJoinList } from "./cave.js";
import { Dun, Gen, type Connector } from "./util.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const reg = new FeatureRegistry(loadRecords<TerrainRecordJson>("terrain"));
const constants = bindConstants(loadJson<ConstantsJson>("constants"));

/* ------------------------------------------------------------------ *
 * get_join_info (generate.c L893-992).
 * ------------------------------------------------------------------ */

describe("getJoinInfo (generate.c L893-992)", () => {
  it("turns the level-above's down staircases into our up staircases", () => {
    /* The level above (depth-1) records FEAT_MORE stairs; on this level they
     * must become FEAT_LESS up staircases in dun.join (L905-917). Non-MORE
     * connectors from that level are ignored. */
    const above: Connector[] = [
      { grid: loc(3, 4), feat: FEAT.MORE },
      { grid: loc(7, 8), feat: FEAT.LESS }, // ignored (not a down stair)
      { grid: loc(9, 2), feat: FEAT.MORE },
    ];
    const { join, oneOffAbove, oneOffBelow } = getJoinInfo({ above });

    expect(oneOffAbove).toEqual([]);
    expect(oneOffBelow).toEqual([]);
    expect(join).toEqual([
      { grid: loc(9, 2), feat: FEAT.LESS },
      { grid: loc(3, 4), feat: FEAT.LESS },
    ]);
  });

  it("turns the level-below's up staircases into our down staircases", () => {
    /* The level below (depth+1) records FEAT_LESS stairs; here they become
     * FEAT_MORE down staircases (L955-967). */
    const below: Connector[] = [
      { grid: loc(1, 1), feat: FEAT.LESS },
      { grid: loc(5, 5), feat: FEAT.MORE }, // ignored (not an up stair)
    ];
    const { join, oneOffAbove, oneOffBelow } = getJoinInfo({ below });

    expect(oneOffAbove).toEqual([]);
    expect(oneOffBelow).toEqual([]);
    expect(join).toEqual([{ grid: loc(1, 1), feat: FEAT.MORE }]);
  });

  it("merges above and below joins (below prepended after above)", () => {
    const above: Connector[] = [{ grid: loc(2, 2), feat: FEAT.MORE }];
    const below: Connector[] = [{ grid: loc(6, 6), feat: FEAT.LESS }];
    const { join } = getJoinInfo({ above, below });
    /* above is processed first (unshifted), then below (unshifted to front),
     * matching upstream's linked-list prepend order. */
    expect(join).toEqual([
      { grid: loc(6, 6), feat: FEAT.MORE },
      { grid: loc(2, 2), feat: FEAT.LESS },
    ]);
  });

  it("remembers a two-levels-up level's down stairs as one_off_above", () => {
    /* No level directly above, but one two levels up: its FEAT_MORE stairs are
     * remembered as one_off_above FEAT_MORE so our up staircases avoid them
     * (L918-945). dun.join stays empty. */
    const twoAbove: Connector[] = [
      { grid: loc(4, 4), feat: FEAT.MORE },
      { grid: loc(8, 1), feat: FEAT.LESS }, // ignored
    ];
    const { join, oneOffAbove, oneOffBelow } = getJoinInfo({ twoAbove });

    expect(join).toEqual([]);
    expect(oneOffBelow).toEqual([]);
    expect(oneOffAbove).toEqual([{ grid: loc(4, 4), feat: FEAT.MORE }]);
  });

  it("remembers a two-levels-down level's up stairs as one_off_below", () => {
    const twoBelow: Connector[] = [{ grid: loc(3, 3), feat: FEAT.LESS }];
    const { join, oneOffAbove, oneOffBelow } = getJoinInfo({ twoBelow });

    expect(join).toEqual([]);
    expect(oneOffAbove).toEqual([]);
    expect(oneOffBelow).toEqual([{ grid: loc(3, 3), feat: FEAT.LESS }]);
  });

  it("prefers the direct neighbour over the two-off level", () => {
    /* When the direct level above exists, the two-levels-up fallback is not
     * consulted (the else branch, L918); same for below. */
    const above: Connector[] = [{ grid: loc(2, 2), feat: FEAT.MORE }];
    const twoAbove: Connector[] = [{ grid: loc(9, 9), feat: FEAT.MORE }];
    const { join, oneOffAbove } = getJoinInfo({ above, twoAbove });

    expect(oneOffAbove).toEqual([]);
    expect(join).toEqual([{ grid: loc(2, 2), feat: FEAT.LESS }]);
  });

  it("produces empty lists when no neighbour has been generated", () => {
    const info = getJoinInfo({});
    expect(info.join).toEqual([]);
    expect(info.oneOffAbove).toEqual([]);
    expect(info.oneOffBelow).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * chunk->join population (generate.c L1203-1214).
 * ------------------------------------------------------------------ */

function makeGen(c: Chunk): Gen {
  return new Gen(c, new Rng(1), reg, constants, new Dun(constants), null, null, null);
}

describe("collectJoins (generate.c L1203-1214)", () => {
  it("records every staircase grid with its feature", () => {
    const c = new Chunk(reg, 8, 8);
    c.depth = 5;
    c.setFeat(loc(2, 1), FEAT.MORE);
    c.setFeat(loc(5, 3), FEAT.LESS);
    c.setFeat(loc(6, 6), FEAT.MORE);
    const g = makeGen(c);

    collectJoins(g);

    /* One connector per stair, feature preserved. */
    expect(g.joins).toHaveLength(3);
    const byGrid = new Map(g.joins.map((j) => [`${j.grid.x},${j.grid.y}`, j.feat]));
    expect(byGrid.get("2,1")).toBe(FEAT.MORE);
    expect(byGrid.get("5,3")).toBe(FEAT.LESS);
    expect(byGrid.get("6,6")).toBe(FEAT.MORE);
  });

  it("prepends in scan order so the head is the last grid scanned (matches C)", () => {
    /* Upstream prepends each stair to chunk->join, so after a row-major scan
     * the head is the highest (y,x). This ordering, re-prepended by getJoinInfo,
     * is what makes the connecting level's dun.join come out in forward scan
     * order exactly as C. */
    const c = new Chunk(reg, 8, 8);
    c.depth = 5;
    c.setFeat(loc(1, 1), FEAT.MORE); // scanned first
    c.setFeat(loc(4, 4), FEAT.LESS);
    c.setFeat(loc(7, 6), FEAT.MORE); // scanned last
    const g = makeGen(c);

    collectJoins(g);

    expect(g.joins.map((j) => j.grid)).toEqual([loc(7, 6), loc(4, 4), loc(1, 1)]);
  });

  it("records nothing on a level with no staircases", () => {
    const c = new Chunk(reg, 6, 6);
    c.depth = 3;
    c.setFeat(loc(2, 2), FEAT.FLOOR);
    const g = makeGen(c);

    collectJoins(g);

    expect(g.joins).toEqual([]);
  });

  it("round-trips through getJoinInfo into forward scan order", () => {
    /* Full generation-side round-trip: a finished level's collected joins,
     * read by the NEXT level down as its 'above', yield up staircases in the
     * upstream forward-scan order (s1..sN). */
    const c = new Chunk(reg, 8, 8);
    c.depth = 5;
    c.setFeat(loc(1, 1), FEAT.MORE); // s1
    c.setFeat(loc(4, 4), FEAT.MORE); // s2
    c.setFeat(loc(7, 6), FEAT.MORE); // s3
    const g = makeGen(c);
    collectJoins(g);

    const adj: AdjacentJoins = { above: g.joins };
    const { join } = getJoinInfo(adj);

    expect(join).toEqual([
      { grid: loc(1, 1), feat: FEAT.LESS },
      { grid: loc(4, 4), feat: FEAT.LESS },
      { grid: loc(7, 6), feat: FEAT.LESS },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * get_min_level_size (generate.c L997-1013).
 * ------------------------------------------------------------------ */

describe("get_min_level_size (generate.c L997-1013)", () => {
  it("measures the level ABOVE by its DOWN staircases only", () => {
    /* above=true takes FEAT_MORE (they become our up stairs). The FEAT_LESS
     * connector is further out in both axes and must be ignored, or the test
     * cannot tell the filter from a max over everything. */
    const join: Connector[] = [
      { grid: loc(10, 20), feat: FEAT.MORE },
      { grid: loc(90, 60), feat: FEAT.LESS },
    ];
    expect(getMinLevelSize(join, true)).toEqual({ height: 22, width: 12 });
  });

  it("measures the level BELOW by its UP staircases only", () => {
    const join: Connector[] = [
      { grid: loc(10, 20), feat: FEAT.MORE },
      { grid: loc(90, 60), feat: FEAT.LESS },
    ];
    expect(getMinLevelSize(join, false)).toEqual({ height: 62, width: 92 });
  });

  it("takes the maximum per axis, from separate connectors", () => {
    /* The tallest and the widest constraint come from DIFFERENT stairs, so a
     * reading that carried both axes off one connector would be wrong. */
    const join: Connector[] = [
      { grid: loc(3, 40), feat: FEAT.MORE },
      { grid: loc(50, 4), feat: FEAT.MORE },
    ];
    expect(getMinLevelSize(join, true)).toEqual({ height: 42, width: 52 });
  });

  it("accumulates across both neighbours, never shrinking the running min", () => {
    /* prepare_next_level calls it twice against the same locals. The second
     * call must not lower what the first established. */
    const above: Connector[] = [{ grid: loc(80, 50), feat: FEAT.MORE }];
    const below: Connector[] = [{ grid: loc(5, 5), feat: FEAT.LESS }];
    const first = getMinLevelSize(above, true);
    expect(getMinLevelSize(below, false, first)).toEqual({ height: 52, width: 82 });
  });

  it("is 0 x 0 for an empty list and for a list with no matching stairs", () => {
    expect(getMinLevelSize([], true)).toEqual({ height: 0, width: 0 });
    expect(getMinLevelSize([{ grid: loc(9, 9), feat: FEAT.LESS }], true)).toEqual({
      height: 0,
      width: 0,
    });
  });
});

/* ------------------------------------------------------------------ *
 * find_joinfree_vertical_seam (gen-cave.c L984-1031).
 * ------------------------------------------------------------------ */

describe("find_joinfree_vertical_seam (gen-cave.c L984-1031)", () => {
  it("returns colpref itself when nothing is in the way", () => {
    expect(findJoinfreeVerticalSeam([], 50, 5, 0, 60)).toBe(50);
  });

  it("steps to the nearest clear PAIR, which can be past colpref", () => {
    /* A connector on colpref poisons index `range`, so the pair (4,5) is out
     * and the search must skip it. (6,7) is one column from centre and beats
     * (3,4), which is two - so the answer is 51, not 48. A reading that took
     * the first clear pair rather than the closest would say 45. */
    const join: Connector[] = [{ grid: loc(50, 10), feat: FEAT.MORE }];
    expect(findJoinfreeVerticalSeam(join, 50, 5, 0, 60)).toBe(51);
  });

  it("prefers the LEFT of two equally-close pairs", () => {
    /* Connectors on colpref and colpref+1 knock out every pair closer than
     * two columns, leaving (range-2) and (range+2) tied. Upstream's strict
     * `metric > ABS(i - range)` keeps the first one reached, which is the left
     * pair; a `>=` would silently prefer the right. */
    const join: Connector[] = [
      { grid: loc(50, 10), feat: FEAT.MORE },
      { grid: loc(51, 10), feat: FEAT.LESS },
    ];
    expect(findJoinfreeVerticalSeam(join, 50, 5, 0, 60)).toBe(48);
  });

  it("returns -1 when every column in range is occupied", () => {
    const join: Connector[] = [
      { grid: loc(49, 10), feat: FEAT.MORE },
      { grid: loc(50, 11), feat: FEAT.LESS },
      { grid: loc(51, 12), feat: FEAT.MORE },
    ];
    expect(findJoinfreeVerticalSeam(join, 50, 1, 0, 60)).toBe(-1);
  });

  it("ignores connectors outside the row window", () => {
    /* Same connector, twice, differing only in its row: inside the window it
     * displaces the seam, outside it is invisible. */
    const inside: Connector[] = [{ grid: loc(50, 10), feat: FEAT.MORE }];
    const outside: Connector[] = [{ grid: loc(50, 99), feat: FEAT.MORE }];
    expect(findJoinfreeVerticalSeam(inside, 50, 5, 0, 60)).toBe(51);
    expect(findJoinfreeVerticalSeam(outside, 50, 5, 0, 60)).toBe(50);
  });

  it("ignores connectors outside the column range", () => {
    const join: Connector[] = [{ grid: loc(40, 10), feat: FEAT.MORE }];
    expect(findJoinfreeVerticalSeam(join, 50, 5, 0, 60)).toBe(50);
  });
});

/* ------------------------------------------------------------------ *
 * transform_join_list (gen-cave.c L1060-1117).
 * ------------------------------------------------------------------ */

describe("transform_join_list (gen-cave.c L1060-1117)", () => {
  it("translates into the sub-chunk and drops what falls outside it", () => {
    /* A 10-row x 5-col sub-chunk placed at column 8 of the level. */
    const join: Connector[] = [
      { grid: loc(5, 3), feat: FEAT.MORE }, // left of the sub-chunk
      { grid: loc(10, 3), feat: FEAT.MORE }, // inside
      { grid: loc(12, 9), feat: FEAT.LESS }, // inside, far corner
      { grid: loc(13, 3), feat: FEAT.MORE }, // right of the sub-chunk
      { grid: loc(10, 10), feat: FEAT.MORE }, // below the sub-chunk
    ];
    expect(transformJoinList(join, 10, 5, 0, 8, 0, false)).toEqual([
      { grid: loc(2, 3), feat: FEAT.MORE },
      { grid: loc(4, 9), feat: FEAT.LESS },
    ]);
  });

  it("preserves order, unlike get_join_info and collect_joins", () => {
    const join: Connector[] = [
      { grid: loc(1, 1), feat: FEAT.MORE },
      { grid: loc(2, 2), feat: FEAT.MORE },
      { grid: loc(3, 3), feat: FEAT.MORE },
    ];
    expect(transformJoinList(join, 8, 8, 0, 0, 0, false).map((j) => j.grid.x)).toEqual([
      1, 2, 3,
    ]);
  });

  it("does not carry the SQUARE info bytes (upstream mem_zallocs them)", () => {
    const join: Connector[] = [{ grid: loc(1, 1), feat: FEAT.MORE, info: [7, 7] }];
    expect(transformJoinList(join, 8, 8, 0, 0, 0, false)[0]!.info).toBeUndefined();
  });

  it("inverts a 90-degree rotation", () => {
    /* Square sub-chunk, so the rotation is unambiguous: symmetry_transform
     * maps (1,1) to (3,1) in a 5x5 piece rotated once, and this undoes it. */
    const join: Connector[] = [{ grid: loc(3, 1), feat: FEAT.MORE }];
    expect(transformJoinList(join, 5, 5, 0, 0, 1, false)).toEqual([
      { grid: loc(1, 1), feat: FEAT.MORE },
    ]);
  });

  it("inverts a horizontal reflection", () => {
    const join: Connector[] = [{ grid: loc(1, 2), feat: FEAT.LESS }];
    expect(transformJoinList(join, 6, 6, 0, 0, 0, true)).toEqual([
      { grid: loc(4, 2), feat: FEAT.LESS },
    ]);
  });
});
