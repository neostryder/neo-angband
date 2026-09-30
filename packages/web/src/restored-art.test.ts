/**
 * restoredArtForPack: an enabled mod's restored kind, race and flavour art,
 * read off its manifest and narrowed to the active pack's tiles.
 */

import { afterEach, describe, expect, it } from "vitest";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack, DiskPackReport } from "./disk-packs";
import { resetComposition } from "./pack";
import { restoredArtForPack } from "./tile-mods";

afterEach(() => {
  resetDiskPacks();
  resetComposition();
});

function artPack(): DiskPack {
  return {
    manifest: {
      id: "restorer",
      name: "restorer",
      version: "1.0.0",
      shape: "content",
      dependencies: { core: "*" },
      restoredItemArt: [{ kind: "restorer:food:apple-juice", packs: { old: { row: 1, col: 2 }, nomad: { row: 5, col: 6 } } }],
      restoredMonsterArt: [
        { race: "restorer:mature-bronze-dragon", packs: { old: { row: 13, col: 5 } }, hue: 40 },
        { race: "restorer:nomad-only", packs: { nomad: { row: 1, col: 1 } } },
      ],
      restoredFlavorArt: [
        { flavor: 303, drawAs: 28, hue: 90 },
        { flavor: 304, drawAs: 29, packs: { nomad: { row: 2, col: 2 } } },
      ],
    } as unknown as DiskPack["manifest"],
    files: {} as DiskPack["files"],
    code: [],
    assets: [],
  };
}

function report(pack: DiskPack): DiskPackReport {
  return { ...NO_DISK_PACKS, packs: [pack], order: ["restorer"], available: true, kind: "picked", dir: "/mods" };
}

describe("restoredArtForPack", () => {
  it("keeps each declaration's tile for the active pack, with its hue", async () => {
    setDiskPacks(report(artPack()));
    const art = await restoredArtForPack("old");
    expect(art.items).toEqual([{ kind: "restorer:food:apple-juice", packs: { old: { row: 1, col: 2 } } }]);
    expect(art.monsters).toEqual([
      { race: "restorer:mature-bronze-dragon", packs: { old: { row: 13, col: 5 } }, hue: 40 },
    ]);
    expect(art.flavors).toEqual([
      { flavor: 303, drawAs: 28, hue: 90 },
      { flavor: 304, drawAs: 29 },
    ]);
  });

  it("uses a flavour's own cell for a pack that has one", async () => {
    setDiskPacks(report(artPack()));
    const art = await restoredArtForPack("nomad");
    expect(art.flavors[1]).toEqual({ flavor: 304, drawAs: 29, packs: { nomad: { row: 2, col: 2 } } });
    expect(art.monsters.map((m) => m.race)).toEqual(["restorer:nomad-only"]);
  });

  it("drops an asset it cannot resolve, and falls back to drawAs for a flavour", async () => {
    const pack = artPack();
    Object.assign(pack.manifest, {
      restoredItemArt: [{ kind: "restorer:food:water", packs: { old: { asset: "art/water.png" } } }],
      restoredFlavorArt: [{ flavor: 305, drawAs: 30, packs: { old: { asset: "art/ring.png" } } }],
    });
    setDiskPacks(report(pack));
    const art = await restoredArtForPack("old");
    expect(art.items).toEqual([]);
    expect(art.flavors).toEqual([{ flavor: 305, drawAs: 30 }]);
  });
});

describe("restoredArtForPack and a mod's flavour section", () => {
  const ring = (index: number, desc: string) => ({
    kind: { tval: "ring", glyph: "=" },
    entries: [{ kind: "flavor", index, attr: "Red", desc }],
  });

  /** A mod that adds flavour 303 in its `flavors` section and gives it art. */
  function sectioned(on: boolean): DiskPack {
    return {
      manifest: {
        id: "restorer",
        name: "restorer",
        version: "1.0.0",
        shape: "content",
        dependencies: { core: "*" },
        sections: [{ id: "flavors", title: "Flavours", default: on }],
        restoredFlavorArt: [{ flavor: 303, packs: { old: { row: 3, col: 4 } } }, { flavor: 28, drawAs: 29 }],
      } as unknown as DiskPack["manifest"],
      files: { flavor: { sections: { flavors: { records: [ring(303, "Ruby")] } } } } as unknown as DiskPack["files"],
      code: [],
      assets: [],
    };
  }

  /** Another mod whose own appended flavour also takes index 303. */
  const other: DiskPack = {
    manifest: {
      id: "other",
      name: "other",
      version: "1.0.0",
      shape: "content",
      dependencies: { core: "*" },
    } as unknown as DiskPack["manifest"],
    files: { flavor: { records: [ring(303, "Lava")] } } as unknown as DiskPack["files"],
    code: [],
    assets: [],
  };

  function both(on: boolean): DiskPackReport {
    return {
      ...NO_DISK_PACKS,
      packs: [sectioned(on), other],
      order: ["restorer", "other"],
      available: true,
      kind: "picked",
      dir: "/mods",
    };
  }

  it("skips art for a flavour the mod adds only in a section that is off", async () => {
    setDiskPacks(both(false));
    const art = await restoredArtForPack("old");
    expect(art.flavors).toEqual([{ flavor: 28, drawAs: 29 }]);
  });

  it("keeps it while the section is on", async () => {
    setDiskPacks(both(true));
    const art = await restoredArtForPack("old");
    expect(art.flavors).toEqual([{ flavor: 303, packs: { old: { row: 3, col: 4 } } }, { flavor: 28, drawAs: 29 }]);
  });
});
