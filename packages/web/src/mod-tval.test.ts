/**
 * A mod's tval.json reaches bindCore through the real loader, so the mod's
 * kinds of that class bind (core obj/tval-table.ts).
 */

import { afterEach, describe, expect, it } from "vitest";
import { bindCore, FIRST_MOD_TVAL, tvals } from "@rpgm-tools/neo-angband-core";
import { loadGamePack, resetComposition } from "./pack";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack, DiskPackReport } from "./disk-packs";

afterEach(() => {
  resetDiskPacks();
  resetComposition();
  tvals.clear();
});

function junkPack(withTval: boolean): DiskPack {
  return {
    manifest: { id: "junk-mod", name: "junk-mod", version: "1.0.0", shape: "content", dependencies: { core: "*" } } as unknown as DiskPack["manifest"],
    files: {
      ...(withTval ? { tval: { records: [{ name: "junk" }] } } : {}),
      object_base: { records: [{ name: { tval: "junk", name: "Junk" }, graphics: "white" }] },
      object: {
        records: [
          {
            name: "& Empty Bottle~",
            type: "junk",
            graphics: { glyph: "!", color: "w" },
            level: 0,
            weight: 2,
            cost: 0,
            alloc: { common: 50, minmax: "0 to 40" },
            desc: ["An empty bottle."],
          },
        ],
      },
    } as unknown as DiskPack["files"],
    code: [],
    assets: [],
  };
}

function report(pack: DiskPack): DiskPackReport {
  return { ...NO_DISK_PACKS, packs: [pack], order: ["junk-mod"], available: true, kind: "picked", dir: "/mods" };
}

describe("a mod's own item class", () => {
  it("is declared by the loader, so its kinds bind", () => {
    setDiskPacks(report(junkPack(true)));
    const game = bindCore(loadGamePack() as never);
    const bottle = game.objects.kinds.find((k) => k?.name === "& Empty Bottle~");
    expect(bottle?.tval).toBe(FIRST_MOD_TVAL);
  });

  it("stops the bind when the mod leaves the class out", () => {
    setDiskPacks(report(junkPack(false)));
    expect(() => bindCore(loadGamePack() as never)).toThrow(/unknown tval junk/u);
  });
});
