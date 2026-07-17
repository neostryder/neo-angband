/**
 * Tests for the persistent-level stair-join machinery (gap 9.4):
 * get_join_info (generate.c L893-992) and the chunk->join population
 * (generate.c L1203-1214). These are the generation-side halves of the
 * birth_levels_persist stair round-trip; the savefile serialization and the
 * changeLevel threading are wired outside gen/ (see WIRING-NEEDED notes).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import type { ConstantsJson } from "../constants";
import { FEAT } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { Chunk } from "../world/chunk";
import { FeatureRegistry } from "../world/feature";
import type { TerrainRecordJson } from "../world/feature";
import {
  collectJoins,
  getJoinInfo,
  type AdjacentJoins,
} from "./generate";
import { Dun, Gen, type Connector } from "./util";

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
