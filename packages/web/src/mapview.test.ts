import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loc,
  Rng,
  Chunk,
  FeatureRegistry,
  bindPlayer,
  blankPlayer,
  newGear,
  newKnownMap,
  newTargetState,
  IgnoreSettings,
  makeRuneEnv,
  DEFAULT_GAME_CONSTANTS,
  placePlayer,
  knownFeat,
  knownObject,
  squareMemorize,
} from "@neo-angband/core";
import type { GameState, Loc, TerrainRecordJson, PlayerPackRecords } from "@neo-angband/core";
import { buildOverview, panLocate, locateRelDesc, locateSectorBanner } from "./mapview";
import type { OverviewGlyph } from "./mapview";

// main.ts's own wiring is the ground truth; mapview.ts is imported by it but
// must stay a pure geometry module with no path to the deterministic game
// RNG (viewing the map / locating must never draw from it - PORT hard rule).
const MAPVIEW_SOURCE = readFileSync(new URL("./mapview.ts", import.meta.url), "utf8");

describe("RNG invariance (source guard)", () => {
  it("mapview.ts never references the game RNG", () => {
    expect(MAPVIEW_SOURCE).not.toMatch(/\brandint/);
    expect(MAPVIEW_SOURCE).not.toMatch(/state\.rng/);
    expect(MAPVIEW_SOURCE).not.toMatch(/\bnew Rng\b/);
  });
});

describe("buildOverview (display_map priority scan)", () => {
  const glyph = (ch: string, css: string, priority: number): OverviewGlyph & { priority: number } => ({
    ch,
    css,
    priority,
  });

  it("skips a grid that has never been seen (knownFeatAt < 0): blank cell", () => {
    const overview = buildOverview({
      width: 4,
      height: 4,
      mapW: 4,
      mapH: 4,
      knownFeatAt: () => -1,
      featureGlyph: () => glyph("#", "#fff", 5),
      playerGrid: { x: 0, y: 0 },
    });
    expect(overview.cells.flat().every((c) => c === null)).toBe(true);
  });

  it("places a single known grid's glyph at its scaled cell, 1:1 when mapW/mapH match width/height", () => {
    const overview = buildOverview({
      width: 4,
      height: 4,
      mapW: 4,
      mapH: 4,
      knownFeatAt: (x, y) => (x === 2 && y === 1 ? 7 : -1),
      featureGlyph: () => glyph("%", "#abc", 5),
      playerGrid: { x: 0, y: 0 },
    });
    expect(overview.cells[1]![2]).toEqual({ ch: "%", css: "#abc" });
    expect(overview.cells.flat().filter((c) => c !== null)).toHaveLength(1);
  });

  it("higher Feature.priority wins when multiple grids collapse into one cell", () => {
    // width=4 scaled to mapW=1: every x in 0..3 maps to col 0. Two grids at
    // the same row (y=0 -> row 0) compete: lower priority first (x=0), then
    // a higher-priority grid at x=2 must displace it.
    const overview = buildOverview({
      width: 4,
      height: 1,
      mapW: 1,
      mapH: 1,
      knownFeatAt: (x) => (x === 0 || x === 2 ? x : -1),
      featureGlyph: (fidx) => (fidx === 0 ? glyph("~", "#111", 5) : glyph("^", "#222", 12)),
      playerGrid: { x: 0, y: 0 },
    });
    expect(overview.cells[0]![0]).toEqual({ ch: "^", css: "#222" });
  });

  it("strict '<' replacement: a later EQUAL-priority grid does not displace the first (first-wins tie)", () => {
    const overview = buildOverview({
      width: 4,
      height: 1,
      mapW: 1,
      mapH: 1,
      knownFeatAt: (x) => (x === 0 || x === 2 ? x : -1),
      featureGlyph: () => glyph("first-or-second", "#same", 5),
      playerGrid: { x: 0, y: 0 },
    });
    // Both grids report priority 5; the first one scanned (x=0, ascending
    // x-then-y scan order) must be the one that stuck.
    const overview2 = buildOverview({
      width: 4,
      height: 1,
      mapW: 1,
      mapH: 1,
      knownFeatAt: (x) => (x === 0 || x === 2 ? x : -1),
      featureGlyph: (fidx) => glyph(fidx === 0 ? "A" : "B", "#c", 5),
      playerGrid: { x: 0, y: 0 },
    });
    expect(overview.cells[0]![0]!.ch).toBe("first-or-second");
    expect(overview2.cells[0]![0]).toEqual({ ch: "A", css: "#c" });
  });

  it("per-grid layering: monster beats object beats trap beats terrain in the SAME grid", () => {
    const base = {
      width: 1,
      height: 1,
      mapW: 1,
      mapH: 1,
      knownFeatAt: () => 3,
      featureGlyph: () => glyph(".", "#floor", 5),
      playerGrid: { x: 0, y: 0 },
    };
    // terrain alone
    expect(buildOverview(base).cells[0]![0]).toEqual({ ch: ".", css: "#floor" });
    // + trap
    expect(
      buildOverview({ ...base, trapGlyphAt: () => ({ ch: "^", css: "#trap" }) }).cells[0]![0],
    ).toEqual({ ch: "^", css: "#trap" });
    // + trap + object: object wins
    expect(
      buildOverview({
        ...base,
        trapGlyphAt: () => ({ ch: "^", css: "#trap" }),
        objectGlyphAt: () => ({ ch: "!", css: "#obj" }),
      }).cells[0]![0],
    ).toEqual({ ch: "!", css: "#obj" });
    // + trap + object + monster: monster wins
    expect(
      buildOverview({
        ...base,
        trapGlyphAt: () => ({ ch: "^", css: "#trap" }),
        objectGlyphAt: () => ({ ch: "!", css: "#obj" }),
        monsterGlyphAt: () => ({ ch: "o", css: "#mon" }),
      }).cells[0]![0],
    ).toEqual({ ch: "o", css: "#mon" });
  });

  it("an unidentified sensed object (knownObject ch=null) draws as the '*' pile marker", () => {
    const overview = buildOverview({
      width: 1,
      height: 1,
      mapW: 1,
      mapH: 1,
      knownFeatAt: () => 3,
      featureGlyph: () => glyph(".", "#floor", 5),
      objectGlyphAt: () => ({ ch: "*", css: "#8a8a94" }),
      playerGrid: { x: 0, y: 0 },
    });
    expect(overview.cells[0]![0]).toEqual({ ch: "*", css: "#8a8a94" });
  });

  it("stamps the player at its own scaled cell regardless of what occupies it", () => {
    const overview = buildOverview({
      width: 10,
      height: 10,
      mapW: 5,
      mapH: 5,
      knownFeatAt: () => 1,
      featureGlyph: () => glyph(".", "#floor", 5),
      playerGrid: { x: 7, y: 3 },
    });
    expect(overview.playerCol).toBe(Math.floor((7 * 5) / 10));
    expect(overview.playerRow).toBe(Math.floor((3 * 5) / 10));
  });

  it("guards mapW<1 or mapH<1 without throwing (tiny/degenerate viewport)", () => {
    const overview = buildOverview({
      width: 10,
      height: 10,
      mapW: 0,
      mapH: 5,
      knownFeatAt: () => 1,
      featureGlyph: () => glyph(".", "#floor", 5),
      playerGrid: { x: 0, y: 0 },
    });
    expect(overview.cells).toEqual([]);
    expect(overview.mapW).toBe(0);
  });
});

describe("panLocate (change_panel + modify_panel)", () => {
  it("east (dir 6) shifts x by half the viewport width, y unchanged", () => {
    const next = panLocate({ x: 10, y: 10 }, 6, 20, 20, 200, 200);
    expect(next).toEqual({ x: 20, y: 10 });
  });

  it("north (dir 8) decreases y by half the viewport height (y grows downward)", () => {
    const next = panLocate({ x: 10, y: 10 }, 8, 20, 20, 200, 200);
    expect(next).toEqual({ x: 10, y: 0 });
  });

  it("south-west (dir 1) moves both axes diagonally", () => {
    const next = panLocate({ x: 10, y: 10 }, 1, 20, 20, 200, 200);
    expect(next).toEqual({ x: 0, y: 20 });
  });

  it("clamps to [0, width-mapCols] on the high edge", () => {
    const next = panLocate({ x: 190, y: 10 }, 6, 20, 20, 200, 200);
    expect(next.x).toBe(180); // width - mapCols
  });

  it("clamps to 0 on the low edge", () => {
    const next = panLocate({ x: 5, y: 5 }, 7, 20, 20, 200, 200); // dir 7 = NW
    expect(next).toEqual({ x: 0, y: 0 });
  });

  it("clamps to 0 when the level is smaller than the viewport", () => {
    const next = panLocate({ x: 0, y: 0 }, 3, 20, 20, 10, 10); // dir 3 = SE
    expect(next).toEqual({ x: 0, y: 0 });
  });

  it("a non-directional key (dir 5, DIR_TARGET/'stay') is a no-op shift", () => {
    const next = panLocate({ x: 50, y: 50 }, 5, 20, 20, 200, 200);
    expect(next).toEqual({ x: 50, y: 50 });
  });
});

describe("locateRelDesc / locateSectorBanner (do_cmd_locate's banner)", () => {
  it("reports no direction when back at the start", () => {
    expect(locateRelDesc({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe("");
    const banner = locateSectorBanner({ x: 5, y: 5 }, { x: 5, y: 5 }, 20, 20);
    expect(banner).toContain("which is your sector");
  });

  it("north-west of the start", () => {
    expect(locateRelDesc({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe(" north west of");
  });

  it("south-east of the start", () => {
    expect(locateRelDesc({ x: 20, y: 20 }, { x: 10, y: 10 })).toBe(" south east of");
  });

  it("pure north (same column) omits the east/west half", () => {
    expect(locateRelDesc({ x: 10, y: 0 }, { x: 10, y: 10 })).toBe(" north of");
  });

  it("formats sector coordinates as floor(2*top / panelDim)", () => {
    const banner = locateSectorBanner({ x: 40, y: 30 }, { x: 0, y: 0 }, 20, 20);
    // row = floor(2*30/20) = 3, col = floor(2*40/20) = 4
    expect(banner).toContain("Map sector [3,4]");
    expect(banner).toContain("Direction (ESC to exit)");
  });
});

// --- Integration: real GameState wiring + RNG invariance -------------------
// A trimmed makeTestState (screens.test.ts's own fixture, minus the object
// registry machinery this module doesn't need), built entirely from public
// core exports and the shipped content pack, so knownFeat/knownObject flow
// through the real map-knowledge layer buildOverview's caller (main.ts)
// wires up.

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const featureReg = new FeatureRegistry(loadRecords<TerrainRecordJson>("terrain"));
const FLOOR = featureReg.byCodeName("FLOOR").fidx;
const GRANITE = featureReg.byCodeName("GRANITE").fidx;

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
} as PlayerPackRecords);

function makeIntegrationState(playerGrid: Loc): GameState {
  const w = 12;
  const h = 12;
  const chunk = new Chunk(featureReg, h, w);
  chunk.fill(GRANITE);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) chunk.setFeat(loc(x, y), FLOOR);
  }
  const player = blankPlayer(players.races[0]!, players.classes[0]!, players.bodies[0]!);
  const gear = newGear();
  const rng = new Rng(7);
  const actor = {
    player,
    grid: playerGrid,
    energy: 0,
    speed: 110,
    totalEnergy: 0,
    combat: {
      toH: 0, toD: 0, ac: 0, toA: 0, skills: [],
      numBlows: 1, ammoMult: 1, numShots: 0, ammoTval: 0, blessWield: false,
    },
    defense: { ac: 0, toA: 0 },
    weapon: null,
    stealth: 0,
    light: 0,
    unlight: false,
  };
  const state = {
    rng,
    chunk,
    actor,
    gear,
    monsters: [null],
    groups: [null],
    floor: new Map(),
    traps: new Map(),
    known: newKnownMap(w, h),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    lore: new Map(),
    turn: 0,
    z: { ...DEFAULT_GAME_CONSTANTS },
    brands: [null],
    slays: [null],
    runeEnv: makeRuneEnv(
      (slot: number) => gear.store.get(player.equipment[slot] ?? 0) ?? null,
      (v) => rng.randcalcVaries(v),
    ),
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: () => null,
  } as unknown as GameState;
  placePlayer(state, playerGrid);
  return state;
}

describe("buildOverview wired to a real GameState (knownFeat/knownObject)", () => {
  it("shows only remembered (memorized) terrain, blank elsewhere, and no RNG draw", () => {
    const state = makeIntegrationState(loc(5, 5));
    // Memorize a couple of grids (as noteSpots would after FOV), leave the
    // rest of the level unknown.
    squareMemorize(state, loc(5, 5));
    squareMemorize(state, loc(6, 5));

    const control = new Rng(7);
    const expectedNext = control.randint0(1_000_000);

    const overview = buildOverview({
      width: state.chunk.width,
      height: state.chunk.height,
      mapW: state.chunk.width,
      mapH: state.chunk.height,
      knownFeatAt: (x, y) => knownFeat(state, loc(x, y)),
      featureGlyph: (fidx) => {
        const f = featureReg.get(fidx);
        return { ch: f.dChar, css: f.dAttr, priority: f.priority };
      },
      objectGlyphAt: (x, y) => {
        const mem = knownObject(state, loc(x, y));
        if (!mem) return null;
        return mem.ch === null ? { ch: "*", css: "#8a8a94" } : { ch: mem.ch, css: mem.attr };
      },
      playerGrid: { x: state.actor.grid.x, y: state.actor.grid.y },
    });

    // Only the two memorized grids (and every other grid stays null/unknown).
    const knownCount = overview.cells.flat().filter((c) => c !== null).length;
    expect(knownCount).toBe(2);
    expect(overview.cells[5]![5]).not.toBeNull();
    expect(overview.cells[5]![6]).not.toBeNull();
    expect(overview.cells[0]![0]).toBeNull();

    // No game-RNG draw happened while building the overview: the state's rng
    // still produces the exact same next value as a fresh control stream
    // seeded identically.
    expect(state.rng.randint0(1_000_000)).toBe(expectedNext);
  });
});
