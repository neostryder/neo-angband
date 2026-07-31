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

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { problemLines } from "./mod-problems";
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

/**
 * Every directory under packages/web/mods/, read rather than listed.
 *
 * It was a hardcoded array, which meant adding or removing a mod folder silently changed
 * what these tests measured while they went on passing. Reading the directory makes the
 * count a measurement of the build instead of a memory of it.
 */
function bundledDirs(): string[] {
  return readdirSync(join(import.meta.dirname, "..", "mods")).sort();
}

describe("diskPackStatus reports the folder count AND the bundled count", () => {
  it("gives a bundled count with no folder at all", () => {
    setDiskPacks(NO_DISK_PACKS);
    const s = diskPackStatus();
    expect(s.count).toBe(0);
    /* NOT "greater than zero" any more, and the change is the point. The game bundles
     * no shipping mod: in a release build this count is 0, permanently and correctly.
     * The old assertion said "whatever the shipped set is, it is not empty" - a premise
     * that has since died, and one that would have gone on passing here forever because
     * vitest runs in DEV, where the demo mods make it non-zero.
     *
     * So what is pinned instead is AGREEMENT with the predicate that decides the set,
     * which is the invariant that was always the real one. */
    expect(s.bundledCount).toBe(bundledDirs().filter((id) => isShippedMod(id)).length);
  });

  it("counts exactly what the catalog lists, in either build mode", () => {
    setDiskPacks(NO_DISK_PACKS);
    /* The invariant is AGREEMENT, not a fixed number: composeMods admits a
     * bundled directory iff isShippedMod does, so the count must use the same
     * predicate with the same default. isShippedMod's default is
     * import.meta.env.DEV, so a dev build lists every demo and a release build lists
     * none - pinning a number here would have hidden the bug this caught: the first
     * version of the count called isShippedMod(id) meaning "release" while the catalog
     * meant "current mode". */
    const dirs = bundledDirs();
    const listed = dirs.filter((id) => isShippedMod(id));
    expect(diskPackStatus().bundledCount).toBe(listed.length);
    /* And a RELEASE build offers NONE of them, because every remaining directory is a
     * demo. That is the de-bundling stated as a measurement rather than as a document: a
     * fresh install is Angband 4.2.6 and nothing else. If a real mod is ever bundled
     * again this fails, which is the right moment to have to think about it. */
    expect(dirs.filter((id) => isShippedMod(id, false))).toEqual([]);
    /* Guards both lines above: an empty dirs list would satisfy them for free. */
    expect(dirs.length).toBeGreaterThan(0);
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
      origins: [{ kind: "app", dir: "mods", count: 1 }],
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
      packs: [pack("demo-hooks")],
      problems: [],
      available: true,
      dir: "mods",
      order: [],
      kind: "app",
      codeUrl: null,
      assetUrl: null,
      origins: [{ kind: "app", dir: "mods", count: 1 }],
    });
    const s = diskPackStatus();
    expect(s.count).toBe(1);
    expect(problemLines(s.problems).join(" ")).toContain("demo-hooks");
    expect(s.bundledCount).toBe(bundledDirs().filter((id) => isShippedMod(id)).length);
  });
});
