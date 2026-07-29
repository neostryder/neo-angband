/**
 * diskPackStatus's two counts (pack.ts).
 *
 * The mod-sources screen used to say only "N mods found in it." That sentence is
 * TRUE and misleading: a desktop install ships an empty mods folder, so it read
 * "0 mods found in it." on a game that lists three mods one screen away, with
 * nothing to say where those three came from or that the zero was about the
 * folder alone. Reporting both numbers is only possible if both are known at the
 * same place, which is here - pack.ts is where the bundle glob and the disk
 * reader meet.
 *
 * bundledCount counts the SHIPPED bundle (isShippedMod), not every directory the
 * glob sees: packages/web/mods/ also holds the dev-only demo-* SDK proofs, and
 * counting those would print a number the player cannot reconcile with the list
 * in front of them.
 */

import { afterEach, describe, expect, it } from "vitest";
import { diskPackStatus } from "./pack";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack } from "./disk-packs";
import { isShippedMod } from "./mod-store";

afterEach(() => {
  resetDiskPacks();
});

/** A minimal well-formed disk pack under a given id. */
function pack(id: string): DiskPack {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      shape: "content",
    } as DiskPack["manifest"],
    files: {},
    code: [],
    assets: [],
  };
}

describe("diskPackStatus reports the folder count AND the bundled count", () => {
  it("gives a bundled count with no folder at all", () => {
    setDiskPacks(NO_DISK_PACKS);
    const s = diskPackStatus();
    expect(s.count).toBe(0);
    /* The number the misleading message hid. Whatever the shipped set is, it is
     * not empty - if it were, "0 bundled, 0 from your folder" would be honest
     * and this whole fix pointless. */
    expect(s.bundledCount).toBeGreaterThan(0);
  });

  it("counts exactly what the catalog lists, in either build mode", () => {
    setDiskPacks(NO_DISK_PACKS);
    /* The invariant is AGREEMENT, not a fixed number: composeMods admits a
     * bundled directory iff isShippedMod does, so the count must use the same
     * predicate with the same default. isShippedMod's default is
     * import.meta.env.DEV, so a release build lists 3 and a dev build lists 6 -
     * pinning 3 here would have passed only in release and, worse, would have
     * hidden the bug this caught: the first version of the count called
     * isShippedMod(id) meaning "release" while the catalog meant "current mode".
     *
     * Every directory under packages/web/mods/, so a new one has to be added
     * here deliberately. */
    const dirs = ["qol", "bug-fixes", "linoleum", "demo-modtest", "demo-sandbox", "demo-trusted"];
    const listed = dirs.filter((id) => isShippedMod(id));
    expect(diskPackStatus().bundledCount).toBe(listed.length);
    /* And the release set really is the three shipped mods - the property the
     * demo filter exists for. */
    expect(dirs.filter((id) => isShippedMod(id, false))).toEqual([
      "qol",
      "bug-fixes",
      "linoleum",
    ]);
  });

  it("keeps the two counts independent", () => {
    setDiskPacks({
      packs: [pack("my-mod"), pack("another-mod")],
      problems: [],
      available: true,
      dir: "mods",
      order: [],
      kind: "app",
      codeUrl: null,
      assetUrl: null,
    });
    const s = diskPackStatus();
    expect(s.count).toBe(2);
    /* Adding folder mods must not change the bundled number, and vice versa -
     * the whole point of showing both is that they are different facts. */
    expect(s.bundledCount).toBe(diskPackStatus().bundledCount);
    setDiskPacks(NO_DISK_PACKS);
    expect(diskPackStatus().bundledCount).toBe(s.bundledCount);
    expect(diskPackStatus().count).toBe(0);
  });

  it("still reports a shadowed id as a problem rather than counting it twice", () => {
    /* A folder mod using a bundled id LOSES (pack.ts composeMods) - so it is in
     * the folder count and NOT in the catalog, which is exactly why the bundled
     * count cannot be derived by subtracting one from the other. */
    setDiskPacks({
      packs: [pack("bug-fixes")],
      problems: [],
      available: true,
      dir: "mods",
      order: [],
      kind: "app",
      codeUrl: null,
      assetUrl: null,
    });
    const s = diskPackStatus();
    expect(s.count).toBe(1);
    expect(s.problems.join(" ")).toContain("bug-fixes");
    expect(s.bundledCount).toBeGreaterThan(0);
  });
});
