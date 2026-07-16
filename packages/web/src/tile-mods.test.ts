/**
 * Unit tests for the enabled-tiles-mod -> selectable-tile-modes mapping. Uses
 * the pure enabledTileModes over synthetic manifests, so no glob/storage is
 * involved. grafID 1..4 are the real bundled packs (core grafmode catalog);
 * 5/6 are Shockbolt (deliberately unbundled).
 */

import { describe, expect, it } from "vitest";
import { enabledTileModes } from "./tile-mods";

const linoleum = {
  id: "linoleum",
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
