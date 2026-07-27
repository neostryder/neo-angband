/**
 * Unit tests for the enabled-tiles-mod -> selectable-tile-modes mapping. Uses
 * the pure enabledTileModes over synthetic manifests, so no glob/storage is
 * involved. grafID 1..4 are the real bundled packs (core grafmode catalog);
 * 5/6 are Shockbolt (deliberately unbundled).
 */

import { describe, expect, it } from "vitest";
import { enabledTileModes, tileModProviders } from "./tile-mods";

const linoleum = {
  id: "linoleum",
  name: "neo-linoleum",
  shape: "tiles",
  tilePacks: [
    { grafID: 1, key: "old", path: "tiles/old" },
    { grafID: 2, key: "adam-bolt", path: "tiles/adam-bolt" },
    { grafID: 3, key: "gervais", path: "tiles/gervais" },
    { grafID: 4, key: "nomad", path: "tiles/nomad" },
  ],
};

function manifests(...entries: [string, unknown][]): Map<string, unknown> {
  return new Map(entries);
}

describe("enabledTileModes", () => {
  it("surfaces the four bundled packs when linoleum is enabled", () => {
    const modes = enabledTileModes({
      manifests: manifests(["linoleum", linoleum]),
      enabledIds: ["linoleum"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([1, 2, 3, 4]);
    expect(modes.every((m) => m.modId === "linoleum")).toBe(true);
    expect(modes[0]?.menuname).toBe("Original Tiles");
  });

  it("carries the contributing mod's DISPLAY name, so the menu can say whose tiles these are", () => {
    // The Graphics screen labels each row "<tileset>  [<mod>]". Without this the
    // player sees four tileset names with no clue that they come from a mod, or
    // which mod to disable - the reported "I only see the original tileset
    // options; how do I get to the linoleum ones?" confusion (they ARE linoleum's).
    const modes = enabledTileModes({
      manifests: manifests(["linoleum", linoleum]),
      enabledIds: ["linoleum"],
    });
    expect(modes.every((m) => m.modName === "neo-linoleum")).toBe(true);
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
        manifests: manifests(["linoleum", linoleum]),
        enabledIds: [],
      }),
    ).toEqual([]);
  });

  it("returns nothing when the mod is not discovered", () => {
    expect(
      enabledTileModes({ manifests: manifests(), enabledIds: ["linoleum"] }),
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

  it("skips unknown, None, and Shockbolt grafIDs; dedupes by grafID", () => {
    const mod = {
      id: "linoleum",
      shape: "tiles",
      tilePacks: [
        { grafID: 0 }, // GRAPHICS_NONE
        { grafID: 5 }, // Shockbolt Dark (unbundled)
        { grafID: 6 }, // Shockbolt Light (unbundled)
        { grafID: 99 }, // unknown
        { grafID: 1 },
        { grafID: 1 }, // duplicate
      ],
    };
    const modes = enabledTileModes({
      manifests: manifests(["linoleum", mod]),
      enabledIds: ["linoleum"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([1]);
  });

  it("preserves enabled/load order across multiple tiles mods", () => {
    const extra = {
      id: "extra-tiles",
      shape: "tiles",
      tilePacks: [{ grafID: 3 }],
    };
    const base = { id: "linoleum", shape: "tiles", tilePacks: [{ grafID: 1 }] };
    const modes = enabledTileModes({
      manifests: manifests(["linoleum", base], ["extra-tiles", extra]),
      enabledIds: ["extra-tiles", "linoleum"],
    });
    expect(modes.map((m) => `${m.modId}:${m.grafID}`)).toEqual([
      "extra-tiles:3",
      "linoleum:1",
    ]);
  });
});

describe("tileModProviders", () => {
  const qol = { id: "qol", name: "neo-qol", shape: "content" };

  it("reports an enabled tiles mod with its name and pack count", () => {
    expect(
      tileModProviders({
        manifests: manifests(["linoleum", linoleum], ["qol", qol]),
        enabledIds: ["linoleum"],
      }),
    ).toEqual([{ id: "linoleum", name: "neo-linoleum", packCount: 4, enabled: true }]);
  });

  it("reports a DISABLED tiles mod too - that is the whole point", () => {
    // With no tiles mod on, the Graphics screen offers ASCII and nothing else,
    // and nothing tells the player the tilesets live in a mod. These rows are
    // what let it name the mod to enable instead of being a dead end.
    const providers = tileModProviders({
      manifests: manifests(["linoleum", linoleum]),
      enabledIds: [],
    });
    expect(providers).toEqual([
      { id: "linoleum", name: "neo-linoleum", packCount: 4, enabled: false },
    ]);
  });

  it("ignores mods that are not tiles-shape", () => {
    expect(
      tileModProviders({ manifests: manifests(["qol", qol]), enabledIds: ["qol"] }),
    ).toEqual([]);
  });

  it("falls back to the id when a manifest declares no name", () => {
    const nameless = { id: "x", shape: "tiles", tilePacks: [{ grafID: 1 }] };
    expect(
      tileModProviders({ manifests: manifests(["x", nameless]), enabledIds: [] })[0]?.name,
    ).toBe("x");
  });
});
