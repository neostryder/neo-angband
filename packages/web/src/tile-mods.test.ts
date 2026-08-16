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
import type { DiskPackReport } from "./disk-packs";
import {
  BUNDLED_MODS_BASE,
  contributedTileModes,
  enabledTileModes,
  mergeModSources,
  tilePackResolver,
} from "./tile-mods";

const artpack = {
  id: "artpack",
  name: "Some Art Pack",
  shape: "tiles",
  tilePacks: [
    { grafID: 1, key: "old", path: "tiles" },
    { grafID: 2, key: "adam-bolt", path: "tiles" },
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
      path: "hand-drawn",
    },
  ],
};

describe("enabledTileModes: a contested grafID goes to the last claimant", () => {
  /* First-wins until 2026-08-01, which made the manager's "Move later (loads
   * last, wins conflicts)" false for tiles alone - the player's one lever ran
   * backwards. See lastClaimWins in tile-mods.ts. */
  const claimant = (id: string, name: string): unknown => ({
    id,
    name,
    shape: "tiles",
    tilePacks: [{ grafID: 2, path: "tiles" }],
  });

  it("keeps one entry and gives it to the mod later in the enabled order", () => {
    const modes = enabledTileModes({
      manifests: manifests(["early", claimant("early", "Early")], ["late", claimant("late", "Late")]),
      enabledIds: ["early", "late"],
    });
    const two = modes.filter((m) => m.grafID === 2);
    expect(two).toHaveLength(1);
    expect(two[0]?.modId).toBe("late");
  });

  it("follows the enabled order, not the manifest map order", () => {
    const both = manifests(["early", claimant("early", "Early")], ["late", claimant("late", "Late")]);
    expect(
      enabledTileModes({ manifests: both, enabledIds: ["late", "early"] }).find(
        (m) => m.grafID === 2,
      )?.modId,
    ).toBe("early");
  });

  it("leaves the row where the first claimant put it", () => {
    const modes = enabledTileModes({
      manifests: manifests(
        ["a", { id: "a", name: "A", shape: "tiles", tilePacks: [{ grafID: 2, path: "t" }] }],
        ["b", { id: "b", name: "B", shape: "tiles", tilePacks: [{ grafID: 1, path: "t" }] }],
        ["c", { id: "c", name: "C", shape: "tiles", tilePacks: [{ grafID: 2, path: "t" }] }],
      ),
      enabledIds: ["a", "b", "c"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([2, 1]);
    expect(modes[0]?.modId).toBe("c");
  });
});

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
    // while claiming to be the mod's tile set. The path is MOD-relative - where
    // the mod's folder physically is is the source's business, not the
    // manifest's, because two of the three sources have no path to give.
    const modes = enabledTileModes({
      manifests: manifests(["artpack", artpack]),
      enabledIds: ["artpack"],
    });
    expect(modes[0]?.path).toBe("tiles");
  });

  it("leaves path unset when a pack declares none", () => {
    const modes = enabledTileModes({
      manifests: manifests(["x", { shape: "tiles", tilePacks: [{ grafID: 1 }] }]),
      enabledIds: ["x"],
    });
    expect(modes[0]?.path).toBeUndefined();
  });

  it("sets no resolver at all - it is pure, and only the source knows how", () => {
    // discoverEnabledTileModes attaches one, because only it knows whether the
    // mod came from the bundle or from the mods directory.
    const modes = enabledTileModes({
      manifests: manifests(["artpack", artpack]),
      enabledIds: ["artpack"],
    });
    expect(modes.every((m) => m.resolve === undefined)).toBe(true);
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
        { grafID: 5, path: "tiles" },
        { grafID: 6, path: "tiles" },
      ],
    };
    const modes = enabledTileModes({
      manifests: manifests(["my-shockbolt", mod]),
      enabledIds: ["my-shockbolt"],
    });
    expect(modes.map((m) => m.menuname)).toEqual(["Shockbolt Dark", "Shockbolt Light"]);
    expect(modes.every((m) => m.path === "tiles")).toBe(true);
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
    expect(modes[0]?.path).toBe("hand-drawn");
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
          { shape: "tiles", tilePacks: [{ grafID: 101, engine: "linoleum", path: "pack" }] },
        ]),
        enabledIds: ["x"],
      }),
    ).toEqual([]);
  });

  it("lets a loose pack re-skin a catalog row, borrowing its menu name", () => {
    const modes = enabledTileModes({
      manifests: manifests([
        "x",
        { shape: "tiles", tilePacks: [{ grafID: 3, engine: "linoleum", path: "pack" }] },
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
          { shape: "tiles", tilePacks: [{ grafID: 101, menuname: "X", path: "pack" }] },
        ]),
        enabledIds: ["x"],
      }),
    ).toEqual([]);
  });
});

/*
 * `path` is mod-relative, so something has to turn it into a URL, and WHICH
 * something depends on where the mod came from. This is that decision, and the
 * reason the field changed: a bundled mod's manifest used to spell out the site
 * path the shell serves it from, which no mod outside the bundle can know.
 */
describe("tilePackResolver", () => {
  it("puts a bundled pack under the site path the bundle serves mods from", async () => {
    const resolve = tilePackResolver({
      source: { kind: "bundle", base: BUNDLED_MODS_BASE },
      modId: "neo-linoleum",
      path: "original-tiles",
    });
    expect(await resolve?.("manifest.txt")).toBe("mods/neo-linoleum/original-tiles/manifest.txt");
    expect(await resolve?.("images/8/floor.png")).toBe(
      "mods/neo-linoleum/original-tiles/images/8/floor.png",
    );
  });

  /*
   * The whole point. A picked folder mints blob: URLs and an installed mod reads
   * IndexedDB; neither has a base a manifest could have named, and the pack path
   * has to travel as part of what the SOURCE is asked for.
   */
  it("asks a directory source for the pack path, not for a URL it built itself", async () => {
    const asked: [string, string][] = [];
    const resolve = tilePackResolver({
      source: {
        kind: "dir",
        assetUrl: (id, path) => {
          asked.push([id, path]);
          return Promise.resolve(`blob:neo/${asked.length}`);
        },
      },
      modId: "my-tiles",
      path: "tiles/my-set",
    });
    expect(await resolve?.("manifest.txt")).toBe("blob:neo/1");
    expect(await resolve?.("images/64/orc.png")).toBe("blob:neo/2");
    expect(asked).toEqual([
      ["my-tiles", "tiles/my-set/manifest.txt"],
      ["my-tiles", "tiles/my-set/images/64/orc.png"],
    ]);
  });

  it("passes a source's null straight through - a mod may name a file it lacks", async () => {
    const resolve = tilePackResolver({
      source: { kind: "dir", assetUrl: () => Promise.resolve(null) },
      modId: "m",
      path: "p",
    });
    expect(await resolve?.("manifest.txt")).toBeNull();
  });

  /*
   * Null means "this pack names no directory of its own", which is what a
   * `path`-less tilesheet entry has always meant: re-register a grafID whose art
   * is already where the shell's tile base points. The caller supplies that base;
   * inventing one here would make the mod's row silently draw core's atlas while
   * claiming to be the mod's.
   */
  it("is null when the pack declares no path, for either source", () => {
    for (const source of [
      { kind: "bundle" as const, base: BUNDLED_MODS_BASE },
      { kind: "dir" as const, assetUrl: () => Promise.resolve("x") },
    ]) {
      expect(tilePackResolver({ source, modId: "m", path: undefined })).toBeNull();
      expect(tilePackResolver({ source, modId: "m", path: "" })).toBeNull();
    }
  });
});

/*
 * MOD_REACH gap 8: "a disk tile pack registers a Graphics row - no (listed,
 * enableable, INERT)". Tile discovery consulted only the build-time bundle glob,
 * so a player could drop a tiles pack in the mods folder, see it in the manager,
 * enable it, and get nothing. The bytes were already served; the registration was
 * not. These pin the merge and the resolver it implies.
 *
 * contributedTileModes is the whole chain except the two lines that read the glob
 * and the enabled set, which is what discover() is; the node test env has no
 * localStorage or location to drive those with.
 */
describe("mergeModSources + contributedTileModes: a mods-directory pack", () => {
  const diskTiles = {
    id: "folder-tiles",
    name: "A Folder Tile Pack",
    shape: "tiles",
    tilePacks: [
      { grafID: 101, engine: "linoleum", menuname: "Folder Set", path: "pack" },
    ],
  };

  /** A report shaped like the one disk-packs.ts latches, with an assetUrl. */
  function report(
    packs: unknown[],
    over: Partial<DiskPackReport> = {},
  ): DiskPackReport {
    return {
      packs: packs.map((manifest) => ({
        manifest,
        files: {},
        code: [],
        assets: [],
      })),
      order: [],
      problems: [],
      dir: "mods/",
      available: true,
      kind: "picked",
      codeUrl: null,
      assetUrl: (id: string, path: string) => Promise.resolve(`blob:${id}/${path}`),
      ...over,
    } as unknown as DiskPackReport;
  }

  it("registers a Graphics row for a pack that is not in the bundle", () => {
    const merged = mergeModSources({
      bundled: new Map(),
      disk: report([diskTiles]),
    });
    const modes = contributedTileModes({ ...merged, enabledIds: ["folder-tiles"] });
    expect(modes).toHaveLength(1);
    expect(modes[0]?.grafID).toBe(101);
    expect(modes[0]?.menuname).toBe("Folder Set");
    expect(modes[0]?.modName).toBe("A Folder Tile Pack");
  });

  it("reaches its art through the REPORT's assetUrl, not through a site path", async () => {
    // The row is worthless without this half: a picked folder's files have no site
    // path, so a resolver built from `path` alone would 404 on every tile.
    const merged = mergeModSources({
      bundled: new Map(),
      disk: report([diskTiles]),
    });
    const modes = contributedTileModes({ ...merged, enabledIds: ["folder-tiles"] });
    expect(await modes[0]?.resolve?.("manifest.txt")).toBe(
      "blob:folder-tiles/pack/manifest.txt",
    );
    expect(await modes[0]?.resolve?.("images/8/floor.png")).toBe(
      "blob:folder-tiles/pack/images/8/floor.png",
    );
  });

  it("puts a bundled pack's art under the site path instead", async () => {
    const merged = mergeModSources({
      bundled: new Map([["loosepack", loosepack]]),
      disk: report([]),
    });
    const modes = contributedTileModes({ ...merged, enabledIds: ["loosepack"] });
    expect(await modes[0]?.resolve?.("manifest.txt")).toBe(
      "mods/loosepack/hand-drawn/manifest.txt",
    );
  });

  it("lets a bundled mod keep its id when a folder pack claims the same one", () => {
    // pack.ts applies exactly this rule when merging the same two sources: a
    // folder must not be able to silently redefine what a first-party mod is.
    const shadow = {
      id: "loosepack",
      name: "Not The Real One",
      shape: "tiles",
      tilePacks: [{ grafID: 101, engine: "linoleum", menuname: "Fake", path: "x" }],
    };
    const merged = mergeModSources({
      bundled: new Map([["loosepack", loosepack]]),
      disk: report([shadow]),
    });
    const modes = contributedTileModes({ ...merged, enabledIds: ["loosepack"] });
    expect(modes[0]?.menuname).toBe("Hand-drawn (Linoleum)");
    expect(modes[0]?.modName).toBe("Loose Pack Mod");
  });

  it("contributes no resolver when the source cannot serve assets at all", async () => {
    // A data-only source (no assetUrl) must not fall through to something that
    // reads CORE's files as if they were the mod's.
    const merged = mergeModSources({
      bundled: new Map(),
      disk: report([diskTiles], { assetUrl: null }),
    });
    const modes = contributedTileModes({ ...merged, enabledIds: ["folder-tiles"] });
    expect(modes).toHaveLength(1);
    expect(modes[0]?.resolve).toBeUndefined();
  });
});
