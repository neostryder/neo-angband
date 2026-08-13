import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Glyph, RenderAssetRef } from "./term";
import { projectLiveWorld, type LiveWorldRead, type ResolvedGlyph } from "./world-render-data";
import { glyphWorldFrameSink, teeWorldFrameSink, type WorldFrame } from "./world-view";

const asset = (data: string): RenderAssetRef => ({ kind: "test", data });
const terrain = (id: number, tile?: RenderAssetRef): ResolvedGlyph => ({ ch: ".", attr: id, css: `#${id}`, ...(tile ? { tile } : {}), layer: { kind: "terrain", id, lighting: 2 } });

describe("the production live-world data producer", () => {
  it("keeps the unmodded pre-frame map glyph tuples while teeing the one live frame", () => {
    const floor = asset("floor");
    const rememberedFloor = asset("memory");
    const monster: ResolvedGlyph = { ch: "D", attr: 7, css: "#7", tile: asset("monster"), layer: { kind: "monster", id: 7 } };
    const calls: Array<{ x: number; y: number; glyph: Glyph }> = [];
    let independentFrame: WorldFrame | undefined;
    const frame = projectLiveWorld(reads({
      width: 4,
      size: { width: 4, height: 2 },
      seen: ({ x, y }) => (x === 0 && y === 0) || y === 1,
      knownFeature: ({ x, y }) => y === 0 && (x === 1 || x === 2) ? 5 : -1,
      pathColours: new Map([[0, 12], [1, 13]]),
      terrainAt: () => terrain(4, floor),
      remembered: () => ({ terrain: terrain(5), visual: { ...terrain(5), css: "dim(#5)", tile: rememberedFloor }, terrainAsset: rememberedFloor }),
      rememberedObjectAt: ({ x }) => x === 1 || x === 2 ? "memory" : undefined,
      monsters: new Map([[1, monster], [2, monster], [5, monster]]),
      cursor: { x: 3, y: 0 }, playerGrid: { x: 0, y: 1 },
    }), teeWorldFrameSink(
      glyphWorldFrameSink({ put: (x, y, glyph) => calls.push({ x, y, glyph }) }),
      { present: (value) => { independentFrame = value; } },
    ));

    // This is the unmodded control captured at the old term.put boundary:
    // foreground order, remembered dimness, path tiles, cursor, and player-last.
    expect(calls).toEqual([
      { x: 10, y: 4, glyph: { ch: "*", fg: "#12", bgTile: floor } },
      { x: 11, y: 4, glyph: { ch: "*", fg: "#13" } },
      { x: 12, y: 4, glyph: { ch: "D", fg: "#7", tile: asset("monster"), bgTile: rememberedFloor } },
      { x: 13, y: 4, glyph: { ch: " ", fg: "#000", bg: "#cursor" } },
      { x: 10, y: 5, glyph: { ch: ".", fg: "#4", tile: floor } },
      { x: 11, y: 5, glyph: { ch: "D", fg: "#7", tile: asset("monster"), bgTile: floor } },
      { x: 12, y: 5, glyph: { ch: ".", fg: "#4", tile: floor } },
      { x: 13, y: 5, glyph: { ch: ".", fg: "#4", tile: floor } },
      { x: 10, y: 5, glyph: { ch: "@", fg: "#fff", bgTile: floor } },
    ]);
    expect(independentFrame).toBe(frame);
    expect(independentFrame?.cells).toHaveLength(8);
    expect(independentFrame?.cells[2]).toMatchObject({
      visibility: "remembered", terrain: { id: 5 }, overlays: [{ kind: "object", id: 8 }, { kind: "monster", id: 7 }],
    });
  });

  it("delivers the exact production frame to an independent sink", () => {
    let received: WorldFrame | undefined;
    const frame = projectLiveWorld(reads({}), { present: (value) => { received = value; } });
    expect(received).toBe(frame);
    expect(frame.cells.slice(0, 2)).toMatchObject([
      { grid: { x: 0, y: 0 }, visibility: "seen", terrain: { id: 4 } },
      { grid: { x: 1, y: 0 }, visibility: "remembered", terrain: { id: 5 } },
    ]);
  });

  /**
   * map_info's hallucination pass reaching the real layering (cave-map.c
   * L179-188, ui-map.c L192-235). The fixture's grid 0 is a SEEN grid that
   * carries a trap AND an object, so all three of upstream's arms - trap
   * suppression, object substitution, monster substitution - are observable on
   * one cell.
   */
  describe("hallucination", () => {
    const fake = (ch: string, kind: "object" | "monster"): ResolvedGlyph =>
      ({ ch, attr: 99, css: "#99", layer: { kind, id: 99 } });

    it("replaces the object, drops the trap, and never asks monsterGlyph", () => {
      let composed = 0;
      const frame = projectLiveWorld(reads({
        monsters: new Map([[0, { ch: "D", attr: 7, css: "#7", layer: { kind: "monster", id: 7 } }]]),
        monsterGlyph: (_u, m) => { composed++; return m; },
        hallucinate: () => ({ object: fake("?", "object"), monster: fake("W", "monster") }),
      }), { present: () => {} });
      const cell = frame.cells[0]!;
      expect(cell.visual?.ch).toBe("W");
      /* The trap's layer is gone: ui-map.c L193 draws it only while the grid
       * is NOT hallucinating. The two 99s are the substitutions. */
      expect(cell.overlays).toEqual([{ kind: "object", id: 99 }, { kind: "monster", id: 99 }]);
      /* A hallucinated monster gets the race's attr/char assigned directly and
       * returns (L232-235); it never enters the seven-arm clear/unique chain. */
      expect(composed).toBe(0);
    });

    it("draws the trap normally on a grid whose placeholder rolls both missed", () => {
      /* The common case: `hallucinate` returns null and nothing changes. This
       * is the control - it is the same expectation the non-hallucinating
       * fixture produces, and it fails if the trap gate keys off the player's
       * TMD_IMAGE rather than the per-grid verdict. */
      const frame = projectLiveWorld(reads({ hallucinate: () => null }), { present: () => {} });
      expect(frame.cells[0]!.overlays).toEqual([{ kind: "trap", id: 6 }, { kind: "object", id: 8 }]);
    });

    it("asks about a remembered grid with `sensed` set, and leaves the star alone", () => {
      const asked: Array<{ object: boolean; sensed: boolean }> = [];
      const frame = projectLiveWorld(reads({
        rememberedObjectSensed: () => true,
        hallucinate: (_g, present) => {
          asked.push({ object: present.object, sensed: present.sensed });
          /* map_info leaves first_kind at 0 for a sensed marker, so this grid
           * is still eligible for a placeholder - but the resolver declines to
           * substitute the object, because the star is drawn over it. */
          return {};
        },
      }), { present: () => {} });
      expect(asked).toContainEqual({ object: false, sensed: true });
      expect(frame.cells[1]!.visual?.ch).toBe("!");
    });

    it("replaces the PLAYER'S OWN '@' with a phantom monster", () => {
      /* The arm that is unreachable if the port paints the player last and
       * unconditionally: map_info gives the player's grid m_idx = 0, so it
       * enters the placeholder block, and grid_data_as_text tests `m_idx > 0`
       * BEFORE `is_player` (ui-map.c L229, L282). */
      const frame = projectLiveWorld(reads({
        playerGrid: { x: 2, y: 1 },
        hallucinate: (g) => (g.x === 2 && g.y === 1 ? { monster: fake("W", "monster") } : null),
      }), { present: () => {} });
      expect(frame.player?.visual.ch).toBe("W");
    });

    it("leaves the '@' alone when the player's grid does not hallucinate", () => {
      const frame = projectLiveWorld(reads({
        playerGrid: { x: 2, y: 1 }, hallucinate: () => null,
      }), { present: () => {} });
      expect(frame.player?.visual.ch).toBe("@");
    });
  });

  it("is the producer the live render path calls, rather than a test-only projection", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/const frame = projectLiveWorld\(\{[\s\S]*?\}, frontendWorldFrameSink\(\s*glyphWorldFrameSink\(term\),/);
    expect(main).toContain("seen: ({ x, y }) => squareIsSeen(state.chunk, loc(x, y))");
    expect(main).toContain("terrainAt: ({ x, y }) => terrainGlyph(x, y, LIGHTING.LOS)");
    expect(main).toContain("monsterGlyph: composeMonster");
  });
});

function reads(overrides: Partial<LiveWorldRead<string, ResolvedGlyph>>): LiveWorldRead<string, ResolvedGlyph> {
  const floor = asset("floor"); const rememberedFloor = asset("memory");
  return {
    width: 3, height: 2, origin: { x: 0, y: 0 }, size: { width: 3, height: 2 }, screenOrigin: { x: 10, y: 4 }, playerGrid: { x: 9, y: 9 }, cursorBackground: "#cursor", unknownForeground: "#000", pathColours: new Map(), gridKey: ({ x, y }) => y * 4 + x, css: (attr) => `#${attr}`,
    seen: ({ x, y }) => x === 0 && y === 0, knownFeature: ({ x, y }) => x === 1 && y === 0 ? 5 : -1,
    remembered: () => ({ terrain: terrain(5), visual: { ...terrain(5), css: "dim(#5)", tile: rememberedFloor }, terrainAsset: rememberedFloor }),
    rememberedObjectAt: ({ x }) => x === 1 ? "memory" : undefined, rememberedObjectGlyph: () => ({ ch: "!", attr: 8, css: "#8", layer: { kind: "object", id: 8 } }), terrainAt: () => terrain(4, floor),
    traps: new Map([[0, { ch: "^", attr: 6, css: "#6", layer: { kind: "trap", id: 6 } }]]), objects: new Map([[0, { ch: "!", attr: 8, css: "#8", layer: { kind: "object", id: 8 } }]]), monsters: new Map(), monsterGlyph: (_under, monster) => monster,
    playerGlyph: () => ({ ch: "@", css: "#fff" }), playerTerrain: () => terrain(4, floor), ...overrides,
  };
}
