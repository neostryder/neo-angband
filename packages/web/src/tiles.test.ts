/**
 * The TILESHEET engine's file-reaching half: which pack-relative paths it asks
 * its resolver for, and what happens when the resolver has no answer.
 *
 * Both engines take a PackFileResolver now, and this half had no test at all
 * while it took a base URL string. That was not an oversight worth ignoring: the
 * atlas and the pref files are TWO separate reads, and when they were two
 * separate `base` arguments a mod could fetch its sheet from one place and its
 * graf-*.prf from another - a tileset that draws but maps nothing, or maps but
 * draws nothing, with no error either way. A mutation that resolved the pref
 * files without the mode's directory passed the whole suite before these existed.
 *
 * The blit itself, and the proof that a converted loose pack draws the same
 * pixels this engine does, are linoleum-equivalence.test.ts.
 */

import { afterEach, describe, expect, it } from "vitest";
import { GRAPHICS_MODE_CATALOG, LIGHTING, tileForFeature } from "@rpgm-tools/neo-angband-core";
import type { GraphicsMode, TilePrefsDeps } from "@rpgm-tools/neo-angband-core";
import { urlBaseResolver, type PackFileResolver } from "./pack-files";
import {
  createTileRenderer,
  isTile,
  isTileDownscale,
  setTileScalingMode,
  loadTilePrefs,
  tileCode,
} from "./tiles";
import type { ModPrefText, TileSet } from "./tiles";

/** grafID 1 (Original Tiles, `old`): a real catalog row, with a real pref file. */
const OLD = GRAPHICS_MODE_CATALOG.find((m) => m.grafID === 1) as GraphicsMode;

const FLOOR_FIDX = 3;
const deps = {
  features: {
    lookupByCode: (code: string) => (code === "FLOOR" ? { fidx: FLOOR_FIDX } : null),
    lookupByName: () => null,
  },
  objects: { kinds: [], flavors: [], lookupSval: () => -1, lookupKind: () => null },
  monsters: { raceByName: () => null },
  traps: null,
} as unknown as TilePrefsDeps;

/** Records every path the engine asks for, and serves the given bodies. */
function recorder(bodies: Record<string, string> = {}): {
  asked: string[];
  resolve: PackFileResolver;
} {
  const asked: string[] = [];
  return {
    asked,
    resolve: (rel) => {
      asked.push(rel);
      return Promise.resolve(rel in bodies ? `url:${rel}` : null);
    },
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setTileScalingMode("auto");
});

/** Serve text bodies by URL, no network. */
function serve(bodies: Record<string, string>): void {
  globalThis.fetch = ((url: string) => {
    const rel = url.startsWith("url:") ? url.slice("url:".length) : url;
    const body = bodies[rel];
    return Promise.resolve({
      ok: body !== undefined,
      text: () => Promise.resolve(body ?? ""),
    });
  }) as unknown as typeof fetch;
}

describe("createTileRenderer", () => {
  it("asks its resolver for the atlas by PACK-relative path", () => {
    // <directory>/<file> from the catalog row, resolved against the pack - not a
    // URL the engine built itself, which is what a picked folder cannot supply.
    const rec = recorder();
    createTileRenderer({ resolve: rec.resolve, grafID: 1 });
    expect(rec.asked).toEqual([`${OLD.directory}/${OLD.file}`]);
  });

  it("is null with no resolver, on ASCII, and on an unknown mode", () => {
    const rec = recorder();
    expect(createTileRenderer({ grafID: 1 })).toBeNull();
    expect(createTileRenderer({ resolve: rec.resolve, grafID: 0 })).toBeNull();
    expect(createTileRenderer({ resolve: rec.resolve, grafID: 999 })).toBeNull();
    expect(rec.asked).toEqual([]);
  });

  it("stays not-ready when the resolver has no URL for the atlas", async () => {
    // A mod may name art it does not ship. That leaves the map ASCII, exactly as
    // a 404 does, and must not throw - there is no Image in this environment
    // either, which is the same degradation path.
    const ts = createTileRenderer({
      resolve: () => Promise.resolve(null),
      grafID: 1,
    });
    expect(ts).not.toBeNull();
    await Promise.resolve();
    expect(ts?.ready).toBe(false);
  });

  it("survives a resolver that rejects", async () => {
    const ts = createTileRenderer({
      resolve: () => Promise.reject(new Error("storage gone")),
      grafID: 1,
    });
    await Promise.resolve();
    expect(ts?.ready).toBe(false);
  });

  it("carries the catalog row's cell metrics", () => {
    const ts = createTileRenderer({ resolve: recorder().resolve, grafID: 1 });
    expect(ts?.cellWidth).toBe(OLD.cellWidth);
    expect(ts?.cellHeight).toBe(OLD.cellHeight);
    expect(ts?.menuname).toBe(OLD.menuname);
  });
});

describe("isTileDownscale", () => {
  it("is a downscale when either destination axis is smaller than the source", () => {
    expect(isTileDownscale(8, 8, 4, 4)).toBe(true);
    expect(isTileDownscale(8, 8, 4, 8)).toBe(true);
    expect(isTileDownscale(8, 8, 8, 4)).toBe(true);
  });

  it("is NOT a downscale for an upscale on both axes, or an equal-size blit", () => {
    expect(isTileDownscale(8, 8, 16, 16)).toBe(false);
    expect(isTileDownscale(8, 8, 8, 8)).toBe(false);
  });

  it("is a downscale even when the OTHER axis is upscaled", () => {
    // Non-uniform stretch: narrower but taller. Still discards detail on the
    // narrowed axis, so it still wants the filtered sampler.
    expect(isTileDownscale(8, 8, 4, 16)).toBe(true);
  });
});

/**
 * TileSet.drawTile's sampler choice (#100): a per-blit decision, not the
 * once-per-resize `imageSmoothingEnabled = false` GlyphTerm.fit sets as the
 * baseline (which stays correct for the bitmap font and for upscaled tiles).
 */
describe("TileSet.drawTile smoothing", () => {
  const imageGlobal = globalThis as typeof globalThis & { Image?: typeof Image };

  class LoadedImage {
    private readonly listeners = new Map<string, (() => void)[]>();
    addEventListener(type: string, listener: () => void): void {
      const group = this.listeners.get(type) ?? [];
      group.push(listener);
      this.listeners.set(type, group);
    }
    set src(_url: string) {
      for (const listener of this.listeners.get("load") ?? []) listener();
    }
  }

  /** grafID 1's atlas cell is 8x8 (OLD.cellWidth/cellHeight above). */
  async function loadedTileSet(): Promise<TileSet> {
    const originalImage = imageGlobal.Image;
    imageGlobal.Image = LoadedImage as unknown as typeof Image;
    try {
      const ts = createTileRenderer({
        resolve: () => Promise.resolve("url:8x8.png"),
        grafID: 1,
      });
      if (!ts) throw new Error("expected a TileSet for grafID 1");
      await Promise.resolve();
      expect(ts.ready).toBe(true);
      return ts;
    } finally {
      if (originalImage === undefined) delete imageGlobal.Image;
      else imageGlobal.Image = originalImage;
    }
  }

  /** A context that records the smoothing state ACTIVE at each drawImage call. */
  function recordingCtx(): {
    ctx: CanvasRenderingContext2D;
    smoothingAtDraw: { enabled: boolean; quality: ImageSmoothingQuality }[];
  } {
    const state = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low" as ImageSmoothingQuality,
    };
    const smoothingAtDraw: { enabled: boolean; quality: ImageSmoothingQuality }[] = [];
    const ctx = {
      get imageSmoothingEnabled(): boolean {
        return state.imageSmoothingEnabled;
      },
      set imageSmoothingEnabled(v: boolean) {
        state.imageSmoothingEnabled = v;
      },
      get imageSmoothingQuality(): ImageSmoothingQuality {
        return state.imageSmoothingQuality;
      },
      set imageSmoothingQuality(v: ImageSmoothingQuality) {
        state.imageSmoothingQuality = v;
      },
      drawImage: () => {
        smoothingAtDraw.push({
          enabled: state.imageSmoothingEnabled,
          quality: state.imageSmoothingQuality,
        });
      },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, smoothingAtDraw };
  }

  it("enables high-quality smoothing when the destination cell is SMALLER than the 8x8 source tile", async () => {
    const ts = await loadedTileSet();
    const { ctx, smoothingAtDraw } = recordingCtx();
    expect(ts.drawTile(ctx, 0, 0, 4, 4, { row: 0, col: 0 })).toBe(true);
    expect(smoothingAtDraw).toEqual([{ enabled: true, quality: "high" }]);
    // Restored immediately after, so it cannot leak into the next cell's
    // nearest-neighbour bitmap-glyph paint (GlyphTerm.paintCell interleaves them).
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it("keeps nearest-neighbour while shrinking when crisp scaling is selected", async () => {
    const ts = await loadedTileSet();
    setTileScalingMode("crisp");
    const { ctx, smoothingAtDraw } = recordingCtx();
    expect(ts.drawTile(ctx, 0, 0, 4, 4, { row: 0, col: 0 })).toBe(true);
    expect(smoothingAtDraw).toEqual([{ enabled: false, quality: "low" }]);
  });

  it("keeps nearest-neighbour for an upscale and for an equal-size blit", async () => {
    const ts = await loadedTileSet();
    {
      const { ctx, smoothingAtDraw } = recordingCtx();
      expect(ts.drawTile(ctx, 0, 0, 16, 16, { row: 0, col: 0 })).toBe(true);
      expect(smoothingAtDraw).toEqual([{ enabled: false, quality: "low" }]);
    }
    {
      const { ctx, smoothingAtDraw } = recordingCtx();
      expect(ts.drawTile(ctx, 0, 0, 8, 8, { row: 0, col: 0 })).toBe(true);
      expect(smoothingAtDraw).toEqual([{ enabled: false, quality: "low" }]);
    }
  });

  it("bases a double-height tile's smoothing decision on its doubled source and destination height", async () => {
    const ts = await loadedTileSet();
    // tall: source becomes 8x16, destination dh*2. 8x16 into 8x16 is equal-size.
    const equal = recordingCtx();
    expect(
      ts.drawTile(equal.ctx, 0, 8, 8, 8, { row: 1, col: 0 }, undefined, true),
    ).toBe(true);
    expect(equal.smoothingAtDraw).toEqual([{ enabled: false, quality: "low" }]);
    // 8x16 into 4x8 (dw=4, dh=4 -> doubled 4x8) is a downscale on both axes.
    const shrunk = recordingCtx();
    expect(
      ts.drawTile(shrunk.ctx, 0, 8, 4, 4, { row: 1, col: 0 }, undefined, true),
    ).toBe(true);
    expect(shrunk.smoothingAtDraw).toEqual([{ enabled: true, quality: "high" }]);
  });
});

describe("loadTilePrefs", () => {
  const mode: GraphicsMode = { ...OLD, directory: "old", pref: "graf-xxx.prf" };

  /** A latched mod pref that includes nothing - the ordinary case. */
  const modPref = (text: string): ModPrefText => ({ text, includes: new Map() });

  it("resolves the pref file UNDER the mode's directory, like the atlas", async () => {
    // The mutation this exists for: resolving `graf-xxx.prf` instead of
    // `old/graf-xxx.prf` reads a file from the pack root, which for a mod with
    // several packs is a different set's prefs or nothing at all.
    const rec = recorder({ "old/graf-xxx.prf": "" });
    serve({ "old/graf-xxx.prf": "feat:FLOOR:*:0x80:0x81" });
    const map = await loadTilePrefs(rec.resolve, mode, deps);
    expect(rec.asked).toEqual(["old/graf-xxx.prf"]);
    expect(map).not.toBeNull();
  });

  it("resolves each %: include under the same directory", async () => {
    // ui-prefs.c process_pref_file follows these; they are siblings of the graf
    // file, so an include resolved from the pack root would silently be missing
    // and every flavour it maps would fall back to ASCII.
    const rec = recorder({
      "old/graf-xxx.prf": "",
      "old/flvr-xxx.prf": "",
      "old/xtra-xxx.prf": "",
    });
    serve({
      "old/graf-xxx.prf": "%:flvr-xxx.prf\n%:xtra-xxx.prf\nfeat:FLOOR:*:0x80:0x81",
      "old/flvr-xxx.prf": "",
      "old/xtra-xxx.prf": "",
    });
    await loadTilePrefs(rec.resolve, mode, deps);
    expect(rec.asked).toEqual([
      "old/graf-xxx.prf",
      "old/flvr-xxx.prf",
      "old/xtra-xxx.prf",
    ]);
  });

  it("resolves nested %: includes under the same directory", async () => {
    const rec = recorder({
      "old/graf-xxx.prf": "",
      "old/flvr-xxx.prf": "",
      "old/xtra-xxx.prf": "",
    });
    serve({
      "old/graf-xxx.prf": "%:flvr-xxx.prf\nfeat:FLOOR:dark:0x81:0x82",
      "old/flvr-xxx.prf": "%:xtra-xxx.prf\nfeat:FLOOR:lit:0x83:0x84",
      "old/xtra-xxx.prf": "feat:FLOOR:los:0x85:0x86",
    });
    const map = await loadTilePrefs(rec.resolve, mode, deps);
    expect(rec.asked).toEqual([
      "old/graf-xxx.prf",
      "old/flvr-xxx.prf",
      "old/xtra-xxx.prf",
    ]);
    const dark = tileForFeature(map!, FLOOR_FIDX, LIGHTING.DARK)!;
    expect(tileCode(dark.attr, dark.char)).toEqual({
      row: 1,
      col: 2,
    });
    const lit = tileForFeature(map!, FLOOR_FIDX, LIGHTING.LIT)!;
    expect(tileCode(lit.attr, lit.char)).toEqual({
      row: 3,
      col: 4,
    });
    const los = tileForFeature(map!, FLOOR_FIDX, LIGHTING.LOS)!;
    expect(tileCode(los.attr, los.char)).toEqual({
      row: 5,
      col: 6,
    });
  });

  it("parses the pref lines into a real core TileMap", async () => {
    const rec = recorder({ "old/graf-xxx.prf": "" });
    serve({ "old/graf-xxx.prf": "feat:FLOOR:*:0x82:0x83" });
    const map = await loadTilePrefs(rec.resolve, mode, deps);
    expect(map).not.toBeNull();
    const cell = tileForFeature(map!, FLOOR_FIDX, LIGHTING.LIT);
    expect(cell).toBeDefined();
    expect(isTile(cell?.attr ?? 0, cell?.char ?? 0)).toBe(true);
    expect(tileCode(cell?.attr ?? 0, cell?.char ?? 0)).toEqual({ row: 2, col: 3 });
  });

  it("layers a mod pref's tile reassignment over the pack, while no mod keeps the pack cell", async () => {
    const rec = recorder({ "old/graf-xxx.prf": "" });
    serve({ "old/graf-xxx.prf": "feat:FLOOR:*:0x82:0x83" });

    const withMod = await loadTilePrefs(rec.resolve, mode, deps, [
      modPref("feat:FLOOR:*:0x86:0x87"),
    ]);
    const modCell = tileForFeature(withMod!, FLOOR_FIDX, LIGHTING.LIT);
    expect(tileCode(modCell?.attr ?? 0, modCell?.char ?? 0)).toEqual({ row: 6, col: 7 });

    const withoutMod = await loadTilePrefs(rec.resolve, mode, deps);
    const packCell = tileForFeature(withoutMod!, FLOOR_FIDX, LIGHTING.LIT);
    expect(tileCode(packCell?.attr ?? 0, packCell?.char ?? 0)).toEqual({ row: 2, col: 3 });
  });

  it("uses the later enabled mod's tile reassignment", async () => {
    const rec = recorder({ "old/graf-xxx.prf": "" });
    serve({ "old/graf-xxx.prf": "feat:FLOOR:*:0x82:0x83" });

    const map = await loadTilePrefs(rec.resolve, mode, deps, [
      modPref("feat:FLOOR:*:0x84:0x85"),
      modPref("feat:FLOOR:*:0x88:0x89"),
    ]);
    const cell = tileForFeature(map!, FLOOR_FIDX, LIGHTING.LIT);
    expect(tileCode(cell?.attr ?? 0, cell?.char ?? 0)).toEqual({ row: 8, col: 9 });
  });

  it("replays a mod pref's OWN %: include, from the bytes latched with it", async () => {
    /* #278: the mod path's includes are read once, when the pref resource is
     * applied to the GlyphTable, and travel with the text - the mod may be
     * unreachable by the time a graphics mode is switched. Replaying the text
     * without them put the tile half of the same silent skip back. The pack cell
     * is the control: it is what this assertion reads if the include is lost. */
    const rec = recorder({ "old/graf-xxx.prf": "" });
    serve({ "old/graf-xxx.prf": "feat:FLOOR:*:0x82:0x83" });

    const map = await loadTilePrefs(rec.resolve, mode, deps, [
      {
        text: "%:mod-inc.prf",
        includes: new Map([["mod-inc.prf", "feat:FLOOR:*:0x8A:0x8B"]]),
      },
    ]);
    const cell = tileForFeature(map!, FLOOR_FIDX, LIGHTING.LIT);
    expect(tileCode(cell?.attr ?? 0, cell?.char ?? 0)).toEqual({ row: 10, col: 11 });
  });

  it("is null when the mode has no pref file, without asking for anything", async () => {
    const rec = recorder();
    expect(await loadTilePrefs(rec.resolve, { ...mode, pref: "none" }, deps)).toBeNull();
    expect(await loadTilePrefs(rec.resolve, { ...mode, pref: "" }, deps)).toBeNull();
    expect(rec.asked).toEqual([]);
  });

  it("is null when the resolver refuses, and when the fetch 404s", async () => {
    serve({});
    expect(await loadTilePrefs(() => Promise.resolve(null), mode, deps)).toBeNull();
    expect(await loadTilePrefs(recorder().resolve, mode, deps)).toBeNull();
  });

  it("never throws when the resolver rejects", async () => {
    serve({});
    expect(
      await loadTilePrefs(() => Promise.reject(new Error("gone")), mode, deps),
    ).toBeNull();
  });

  /*
   * The plain-base case still has to work: core's own modes and a `?tiles=`
   * override both reach a real site path, and urlBaseResolver is what expresses
   * that. This pins the composition, since the two halves are now separate.
   */
  it("works through urlBaseResolver, which is what core modes use", async () => {
    serve({ "tiles/old/graf-xxx.prf": "feat:FLOOR:*:0x80:0x81" });
    globalThis.fetch = ((url: string) => {
      const body =
        url === "tiles/old/graf-xxx.prf" ? "feat:FLOOR:*:0x80:0x81" : undefined;
      return Promise.resolve({
        ok: body !== undefined,
        text: () => Promise.resolve(body ?? ""),
      });
    }) as unknown as typeof fetch;
    expect(await loadTilePrefs(urlBaseResolver("tiles"), mode, deps)).not.toBeNull();
  });
});
