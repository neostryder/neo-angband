/**
 * Unit tests for the enabled-tiles-mod -> selectable-tile-modes mapping. Uses
 * the pure enabledTileModes over synthetic manifests, so no glob/storage is
 * involved. grafIDs 1..6 are the real core catalog (grafmode.c / list.txt); a
 * mod may claim any of them, since it brings its own art.
 *
 * What a tiles mod contributes is strictly ADDITIVE: core's own tile sets come
 * from tile-catalog.ts and need no mod at all (see tile-catalog.test.ts).
 */

import { describe, expect, it } from "vitest";
import { enabledTileModes } from "./tile-mods";

const artpack = {
  id: "artpack",
  name: "Some Art Pack",
  shape: "tiles",
  tilePacks: [
    { grafID: 1, key: "old", path: "mods/artpack/tiles" },
    { grafID: 2, key: "adam-bolt", path: "mods/artpack/tiles" },
  ],
};

function manifests(...entries: [string, unknown][]): Map<string, unknown> {
  return new Map(entries);
}

const loosepack = {
  id: "loosepack",
  name: "Loose Pack Mod",
  shape: "tiles",
  tilePacks: [
    {
      grafID: 101,
      engine: "linoleum",
      menuname: "Hand-drawn (Linoleum)",
      path: "mods/loosepack/hand-drawn",
    },
  ],
};

describe("enabledTileModes", () => {
  it("surfaces an enabled tiles mod's packs, named from the core catalog", () => {
    const modes = enabledTileModes({
      manifests: manifests(["artpack", artpack]),
      enabledIds: ["artpack"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([1, 2]);
    expect(modes.every((m) => m.modId === "artpack")).toBe(true);
    expect(modes[0]?.menuname).toBe("Original Tiles");
  });

  it("carries the pack's declared path, so the MOD's art is what loads", () => {
    // Without this the mod row is a lie: it would render core's bundled atlas
    // while claiming to be the mod's tile set.
    const modes = enabledTileModes({
      manifests: manifests(["artpack", artpack]),
      enabledIds: ["artpack"],
    });
    expect(modes[0]?.baseUrl).toBe("mods/artpack/tiles");
  });

  it("leaves baseUrl unset when a pack declares no path", () => {
    const modes = enabledTileModes({
      manifests: manifests(["x", { shape: "tiles", tilePacks: [{ grafID: 1 }] }]),
      enabledIds: ["x"],
    });
    expect(modes[0]?.baseUrl).toBeUndefined();
  });

  it("carries the contributing mod's DISPLAY name, so the menu can tag the row", () => {
    // The Graphics screen labels a mod row "<tileset>  [<mod>]" and leaves core's
    // own rows plain, so a tag means "not stock, and here is what to disable".
    const modes = enabledTileModes({
      manifests: manifests(["artpack", artpack]),
      enabledIds: ["artpack"],
    });
    expect(modes.every((m) => m.modName === "Some Art Pack")).toBe(true);
  });

  it("falls back to the mod id when the manifest declares no name", () => {
    const nameless = { id: "x", shape: "tiles", tilePacks: [{ grafID: 1 }] };
    const modes = enabledTileModes({
      manifests: manifests(["x", nameless]),
      enabledIds: ["x"],
    });
    expect(modes[0]?.modName).toBe("x");
  });

  it("returns nothing when the mod is present but not enabled", () => {
    expect(
      enabledTileModes({
        manifests: manifests(["artpack", artpack]),
        enabledIds: [],
      }),
    ).toEqual([]);
  });

  it("returns nothing when the mod is not discovered", () => {
    expect(
      enabledTileModes({ manifests: manifests(), enabledIds: ["artpack"] }),
    ).toEqual([]);
  });

  it("ignores non-tiles-shape mods", () => {
    const content = { id: "qol", shape: "content", tilePacks: [{ grafID: 1 }] };
    expect(
      enabledTileModes({
        manifests: manifests(["qol", content]),
        enabledIds: ["qol"],
      }),
    ).toEqual([]);
  });

  it("skips unknown and None grafIDs; dedupes by grafID", () => {
    const mod = {
      id: "artpack",
      shape: "tiles",
      tilePacks: [
        { grafID: 0 }, // GRAPHICS_NONE
        { grafID: 99 }, // not in the core catalog: no metadata to render it
        { grafID: 1 },
        { grafID: 1 }, // duplicate
      ],
    };
    const modes = enabledTileModes({
      manifests: manifests(["artpack", mod]),
      enabledIds: ["artpack"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([1]);
  });

  it("lets a mod supply Shockbolt (5/6), which core cannot bundle", () => {
    // Core omits these because their licence forbids redistributing the art, not
    // because the modes are invalid. A player who owns the pack can wrap it in a
    // mod, and that mod's packs must come through.
    const mod = {
      id: "my-shockbolt",
      name: "My Shockbolt",
      shape: "tiles",
      tilePacks: [
        { grafID: 5, path: "mods/my-shockbolt/tiles" },
        { grafID: 6, path: "mods/my-shockbolt/tiles" },
      ],
    };
    const modes = enabledTileModes({
      manifests: manifests(["my-shockbolt", mod]),
      enabledIds: ["my-shockbolt"],
    });
    expect(modes.map((m) => m.menuname)).toEqual(["Shockbolt Dark", "Shockbolt Light"]);
    expect(modes.every((m) => m.baseUrl === "mods/my-shockbolt/tiles")).toBe(true);
  });

  it("preserves enabled/load order across multiple tiles mods", () => {
    const extra = {
      id: "extra-tiles",
      shape: "tiles",
      tilePacks: [{ grafID: 3 }],
    };
    const base = { id: "artpack", shape: "tiles", tilePacks: [{ grafID: 1 }] };
    const modes = enabledTileModes({
      manifests: manifests(["artpack", base], ["extra-tiles", extra]),
      enabledIds: ["extra-tiles", "artpack"],
    });
    expect(modes.map((m) => `${m.modId}:${m.grafID}`)).toEqual([
      "extra-tiles:3",
      "artpack:1",
    ]);
  });
});

describe("enabledTileModes: loose packs", () => {
  it("adds a mode of the mod's own, with its own name and no catalog entry", () => {
    // A loose pack carries its metadata inside the pack (manifest.txt), so it
    // needs no list.txt row - it ADDS a Graphics row instead of re-skinning one.
    const modes = enabledTileModes({
      manifests: manifests(["loosepack", loosepack]),
      enabledIds: ["loosepack"],
    });
    expect(modes).toHaveLength(1);
    expect(modes[0]?.grafID).toBe(101);
    expect(modes[0]?.engine).toBe("linoleum");
    expect(modes[0]?.menuname).toBe("Hand-drawn (Linoleum)");
    expect(modes[0]?.baseUrl).toBe("mods/loosepack/hand-drawn");
    expect(modes[0]?.modName).toBe("Loose Pack Mod");
  });

  it("skips a loose pack with no path - there would be nothing to fetch", () => {
    expect(
      enabledTileModes({
        manifests: manifests([
          "x",
          { shape: "tiles", tilePacks: [{ grafID: 101, engine: "linoleum", menuname: "X" }] },
        ]),
        enabledIds: ["x"],
      }),
    ).toEqual([]);
  });

  it("skips a loose pack with no name for an id the catalog does not know", () => {
    expect(
      enabledTileModes({
        manifests: manifests([
          "x",
          { shape: "tiles", tilePacks: [{ grafID: 101, engine: "linoleum", path: "mods/x" }] },
        ]),
        enabledIds: ["x"],
      }),
    ).toEqual([]);
  });

  it("lets a loose pack re-skin a catalog row, borrowing its menu name", () => {
    const modes = enabledTileModes({
      manifests: manifests([
        "x",
        { shape: "tiles", tilePacks: [{ grafID: 3, engine: "linoleum", path: "mods/x" }] },
      ]),
      enabledIds: ["x"],
    });
    expect(modes[0]?.menuname).toBe("David Gervais' tiles");
    expect(modes[0]?.engine).toBe("linoleum");
  });

  it("still skips a TILESHEET pack on a grafID the catalog does not know", () => {
    // A sheet needs the catalog's cell size and pref file to be renderable at
    // all, so an unknown id has no metadata to draw with.
    expect(
      enabledTileModes({
        manifests: manifests([
          "x",
          { shape: "tiles", tilePacks: [{ grafID: 101, menuname: "X", path: "mods/x" }] },
        ]),
        enabledIds: ["x"],
      }),
    ).toEqual([]);
  });
});
