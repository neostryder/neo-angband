import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SQUARE } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { Chunk } from "./chunk";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";
import type { MonsterHitResult, Projection } from "./project";
import {
  PROJECT,
  computeProjection,
  project,
  projectPath,
  projectable,
} from "./project";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;

/** An all-floor chunk of the given size (Chunk takes height, width). */
function floorChunk(w = 20, h = 14): Chunk {
  const c = new Chunk(reg, h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) c.setFeat(loc(x, y), FLOOR);
  }
  return c;
}

/** Path as [x,y] pairs for easy comparison. */
function coords(c: Chunk, range: number, a: [number, number], b: [number, number], flg = 0) {
  return projectPath(c, range, loc(a[0], a[1]), loc(b[0], b[1]), flg).map(
    (g) => [g.x, g.y] as [number, number],
  );
}

describe("project_path (project.c)", () => {
  it("is empty when source and target coincide", () => {
    expect(coords(floorChunk(), 20, [5, 5], [5, 5])).toEqual([]);
  });

  it("walks a straight horizontal line, ending on the target", () => {
    expect(coords(floorChunk(), 20, [2, 7], [6, 7])).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
      [6, 7],
    ]);
  });

  it("walks a pure diagonal one step per grid", () => {
    expect(coords(floorChunk(), 20, [2, 2], [6, 6])).toEqual([
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ]);
  });

  it("matches the hand-derived slope walk for a 4:2 bolt", () => {
    // (0,0) -> (4,2): horizontal-major slope walk.
    expect(coords(floorChunk(), 20, [0, 0], [4, 2])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
  });

  it("includes and stops at a wall grid in the way", () => {
    const c = floorChunk();
    c.setFeat(loc(5, 7), GRANITE);
    // The bolt reaches the wall (included as the last grid) and stops there.
    expect(coords(c, 20, [2, 7], [9, 7])).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
    ]);
  });

  it("stops at an intervening monster only with PROJECT_STOP", () => {
    const c = floorChunk();
    c.setMon(loc(5, 7), 3);
    // Without STOP, the monster does not halt the path.
    expect(coords(c, 20, [2, 7], [7, 7]).at(-1)).toEqual([7, 7]);
    // With STOP, the path halts on the monster's grid.
    expect(coords(c, 20, [2, 7], [7, 7], PROJECT.STOP)).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
    ]);
  });

  it("respects the range limit", () => {
    // Range 3 truncates a would-be longer horizontal path.
    expect(coords(floorChunk(), 3, [2, 7], [12, 7]).length).toBeLessThanOrEqual(3);
  });
});

describe("projectable (project.c)", () => {
  it("is true for a clear line to the target and false through a wall", () => {
    const c = floorChunk();
    expect(projectable(c, loc(2, 7), loc(9, 7), 0, 20)).toBe(true);
    c.setFeat(loc(5, 7), GRANITE);
    expect(projectable(c, loc(2, 7), loc(9, 7), 0, 20)).toBe(false);
  });

  it("is never projectable from a grid to itself", () => {
    expect(projectable(floorChunk(), loc(4, 4), loc(4, 4), 0, 20)).toBe(false);
  });
});

/** Does the grid list contain (x, y)? */
function has(grids: readonly Loc[], x: number, y: number): boolean {
  return grids.some((g) => g.x === x && g.y === y);
}

/** The distance recorded for (x, y), or -1 if the grid is absent. */
function distAt(proj: Projection, x: number, y: number): number {
  const i = proj.grids.findIndex((g) => g.x === x && g.y === y);
  return i === -1 ? -1 : proj.distanceToGrid[i]!;
}

describe("computeProjection (project.c project blast geometry)", () => {
  const base = (over: Partial<Parameters<typeof computeProjection>[1]>) => ({
    origin: loc(-1, -1),
    finish: loc(0, 0),
    rad: 0,
    typ: 0,
    flg: 0,
    maxRange: 20,
    dam: 20,
    ...over,
  });

  it("collects only the final grid for a bolt", () => {
    const proj = computeProjection(
      floorChunk(),
      base({ origin: loc(2, 7), finish: loc(6, 7), rad: 0 }),
    );
    expect(proj.grids.map((g) => [g.x, g.y])).toEqual([[6, 7]]);
    expect(proj.distanceToGrid).toEqual([0]);
    expect(proj.centre).toEqual(loc(6, 7));
    // Every traveled step is recorded for visuals.
    expect(proj.bolts.map((b) => [b.to.x, b.to.y])).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
      [6, 7],
    ]);
  });

  it("collects every path grid for a beam", () => {
    const proj = computeProjection(
      floorChunk(),
      base({ origin: loc(2, 7), finish: loc(6, 7), flg: PROJECT.BEAM }),
    );
    expect(proj.grids.map((g) => [g.x, g.y])).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
      [6, 7],
    ]);
    expect(proj.distanceToGrid).toEqual([0, 0, 0, 0]);
  });

  it("limits a beam to its radius length", () => {
    const proj = computeProjection(
      floorChunk(),
      base({ origin: loc(2, 7), finish: loc(9, 7), flg: PROJECT.BEAM, rad: 2 }),
    );
    expect(proj.grids.map((g) => [g.x, g.y])).toEqual([
      [3, 7],
      [4, 7],
    ]);
  });

  it("explodes a ball around a jumped-to centre with distance rings", () => {
    const proj = computeProjection(
      floorChunk(),
      base({ finish: loc(10, 7), rad: 2, flg: PROJECT.JUMP }),
    );
    expect(proj.centre).toEqual(loc(10, 7));
    expect(distAt(proj, 10, 7)).toBe(0); // centre
    expect(distAt(proj, 11, 7)).toBe(1);
    expect(distAt(proj, 12, 7)).toBe(2);
    expect(distAt(proj, 12, 8)).toBe(2);
    expect(has(proj.grids, 13, 7)).toBe(false); // dist 3 > rad
    expect(has(proj.grids, 12, 9)).toBe(false); // dist 3 > rad
    // Grids come out sorted outward from the centre.
    for (let i = 1; i < proj.distanceToGrid.length; i++) {
      expect(proj.distanceToGrid[i]!).toBeGreaterThanOrEqual(
        proj.distanceToGrid[i - 1]!,
      );
    }
  });

  it("explodes against a wall in the ball's path", () => {
    const c = floorChunk();
    c.setFeat(loc(8, 7), GRANITE);
    const proj = computeProjection(
      c,
      base({ origin: loc(2, 7), finish: loc(15, 7), rad: 2 }),
    );
    // Ball stops one grid short of the wall and explodes there.
    expect(proj.centre).toEqual(loc(7, 7));
    expect(distAt(proj, 7, 7)).toBe(0);
    expect(has(proj.grids, 8, 7)).toBe(false); // the wall is not affected
  });

  it("computes standard damage falloff by distance", () => {
    const proj = computeProjection(
      floorChunk(),
      base({ finish: loc(10, 7), rad: 2, flg: PROJECT.JUMP, dam: 20 }),
    );
    // (dam + i) / (i + 1), truncated; zero beyond the radius.
    expect(proj.damAtDist.slice(0, 4)).toEqual([20, 10, 7, 0]);
  });

  it("keeps full damage across a wide source diameter", () => {
    const proj = computeProjection(
      floorChunk(),
      base({
        finish: loc(10, 7),
        rad: 2,
        flg: PROJECT.JUMP,
        dam: 20,
        diameterOfSource: 20,
      }),
    );
    // diameter 20 => full strength to every grid in the radius, capped at dam.
    expect(proj.damAtDist.slice(0, 3)).toEqual([20, 20, 20]);
    expect(proj.damAtDist[3]).toBe(0);
  });

  it("restricts an arc to its cone via the angle table", () => {
    const proj = computeProjection(
      floorChunk(),
      base({
        origin: loc(5, 7),
        finish: loc(13, 7), // due east
        rad: 3,
        flg: PROJECT.ARC,
        degreesOfArc: 90,
      }),
    );
    expect(proj.centre).toEqual(loc(5, 7));
    expect(has(proj.grids, 5, 7)).toBe(true); // centre
    expect(has(proj.grids, 6, 7)).toBe(true); // toward the target
    expect(has(proj.grids, 7, 7)).toBe(true);
    expect(has(proj.grids, 3, 7)).toBe(false); // behind the caster
    expect(has(proj.grids, 5, 9)).toBe(false); // perpendicular to the arc
    expect(has(proj.grids, 5, 5)).toBe(false);
  });
});

describe("project (project.c driver)", () => {
  const base = (over: Partial<Parameters<typeof project>[1]>) => ({
    origin: loc(-1, -1),
    finish: loc(10, 7),
    rad: 2,
    typ: 7,
    flg: PROJECT.JUMP | PROJECT.KILL,
    maxRange: 20,
    dam: 20,
    ...over,
  });

  it("applies the monster handler once per occupied grid with ringed damage", () => {
    const c = floorChunk();
    c.setMon(loc(10, 7), 5); // centre, dist 0
    c.setMon(loc(12, 7), 6); // dist 2
    const hits: Array<[number, number, number]> = [];
    project(c, base({}), {
      onMonster: (dist, grid, dam): MonsterHitResult => {
        hits.push([grid.x, dam, dist]);
        return { didHit: true, wasObvious: true };
      },
    });
    expect(hits).toContainEqual([10, 20, 0]);
    expect(hits).toContainEqual([12, 7, 2]);
    expect(hits.length).toBe(2);
  });

  it("clears all SQUARE_PROJECT marks after running", () => {
    const c = floorChunk();
    project(c, base({}), { onMonster: () => ({ didHit: true, wasObvious: false }) });
    for (let y = 5; y <= 9; y++) {
      for (let x = 8; x <= 12; x++) {
        expect(c.sqinfoHas(loc(x, y), SQUARE.PROJECT)).toBe(false);
      }
    }
  });

  it("tracks the single monster a player projection hits", () => {
    const c = floorChunk();
    c.setMon(loc(11, 7), 5); // one monster, dist 1
    let tracked: Loc | null = null;
    project(c, base({ sourceIsPlayer: true }), {
      onMonster: (_d, grid) => ({ didHit: true, wasObvious: true, grid }),
      onTrackMonster: (grid) => {
        tracked = grid;
      },
    });
    expect(tracked).toEqual(loc(11, 7));
  });

  it("does not track when more than one monster is hit", () => {
    const c = floorChunk();
    c.setMon(loc(11, 7), 5);
    c.setMon(loc(12, 7), 6);
    let tracked = false;
    project(c, base({ sourceIsPlayer: true }), {
      onMonster: () => ({ didHit: true, wasObvious: true }),
      onTrackMonster: () => {
        tracked = true;
      },
    });
    expect(tracked).toBe(false);
  });

  it("suppresses bolt visuals when the player is blind", () => {
    const c = floorChunk();
    const boltParams = base({
      origin: loc(2, 7),
      finish: loc(6, 7),
      rad: 0,
      flg: PROJECT.KILL,
    });
    let seen = 0;
    project(c, { ...boltParams, blind: false }, { onBolt: () => seen++ });
    expect(seen).toBe(4);
    seen = 0;
    project(c, { ...boltParams, blind: true }, { onBolt: () => seen++ });
    expect(seen).toBe(0);
  });

  it("stops at player death before affecting features", () => {
    const c = floorChunk();
    let featuresTouched = false;
    const notice = project(
      c,
      base({ flg: PROJECT.JUMP | PROJECT.PLAY | PROJECT.GRID }),
      {
        onPlayer: () => true,
        playerIsDead: () => true,
        onFeature: () => {
          featuresTouched = true;
          return true;
        },
      },
    );
    expect(notice).toBe(true);
    expect(featuresTouched).toBe(false);
    // Marks are still cleared on the death path.
    expect(c.sqinfoHas(loc(10, 7), SQUARE.PROJECT)).toBe(false);
  });
});
