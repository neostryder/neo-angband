/**
 * MOD_REACH gap 13: a boot-time compose error is survivable, RUN rather than
 * claimed.
 *
 * The row this closes was marked "partly determined - the mechanism is present,
 * the run is still owed", and the reason it stayed open is the whole point of
 * this file. `composition()` (`pack.ts`) calls `composeDroppingBroken` and not
 * `composeContentPacks`, with a comment at the call site naming exactly this
 * failure. `composeDroppingBroken` has its own tests in the SDK. Neither of
 * those is evidence about the BOOT: they are evidence that a function behaves,
 * and the question is whether the host's composition path - manifest
 * normalisation, the engine gate, section resolution, the bundled globs, then
 * the composer - gets a player to a screen when a mod is broken.
 *
 * What a failure here costs is why it is worth a file. `composeContentPacks`
 * throws on a `patches` ref whose target does not exist, and every reader in
 * `pack.ts` is reached from module scope. A throw there is a blank page: no
 * canvas, no mod manager to open, and no way to turn the offending mod off short
 * of clearing localStorage - which also destroys the player's saves. "One broken
 * mod costs that mod" is the rule the rest of the mod system already keeps, and
 * this is the one place it had never been measured.
 *
 * DRIVEN THROUGH THE REAL READERS (`composedRecords`, `diskPackStatus`,
 * `presentNamespaces`), not through `composition()` - which is module-private,
 * and rightly so. Those three are what `main.ts` actually calls, so a regression
 * that made the composer safe and a reader unsafe would still fail here.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  composedRecords,
  diskPackStatus,
  presentNamespaces,
  resetComposition,
} from "./pack";
import { NO_DISK_PACKS, readModDir, resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack, DiskPackReport, ModDirSource } from "./disk-packs";
import { problemLines } from "./mod-problems";

afterEach(() => {
  resetDiskPacks();
  resetComposition();
});

/**
 * A content mod that composes cleanly, as the baseline every case below is
 * measured against. Without it, "the game still has monsters" would be true of a
 * run where nothing was ever attempted.
 */
function goodPack(id: string): DiskPack {
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
 * A mod that depends on a pack nobody installed.
 *
 * THE ROW SAID "a bad patch ref" AND THAT IS NOW STALE. A patch whose target
 * does not exist stopped throwing when composePacks gained its `onRefuse`
 * reporter - a missing target costs the patch and gets a line, which is the
 * better behaviour and is separately tested. What is left for
 * `composeDroppingBroken` to catch is `resolveLoadOrder`: a missing dependency
 * or a hard cycle is a statement about the SET of enabled mods, so there is no
 * single op to skip and dropping a pack is the only move that makes the rest
 * loadable. That is the shape a boot has to survive, so it is the shape driven
 * here.
 *
 * A missing dependency is the ordinary way this happens to a player: a mod ships
 * requiring another, they install one and not the other, and the game has to
 * come up anyway and say so.
 */
function badRefPack(id: string): DiskPack {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      shape: "content",
      dependencies: { "nobody-installed-this": "1.0.0" },
    } as unknown as DiskPack["manifest"],
    files: {},
    code: [],
    assets: [],
  };
}

/** A report the composer will read, with every listed id enabled. */
function report(packs: readonly DiskPack[]): DiskPackReport {
  return {
    ...NO_DISK_PACKS,
    packs,
    /* `order` is load-order.json's list, and an id in it that the player has
     * made no explicit choice about IS enabled (mod-store.resolveEnabledIds).
     * That is how an external manager deploys a mod, so it is also the honest
     * way to enable one here - no test-only door. */
    order: packs
      .map((p) => (p.manifest as { id?: string } | null)?.id)
      .filter((id): id is string => typeof id === "string"),
    available: true,
    kind: "picked",
    dir: "/mods",
  };
}

/** How many monster records the game composed. */
function monsterCount(): number {
  return (composedRecords()["monster"] ?? []).length;
}

describe("a boot-time compose error costs the mod, not the game", () => {
  it("composes the base game with no mods at all (the baseline)", () => {
    /* Control for every assertion below. If the bundled pack ever stopped
     * reaching this module, every "the game still has its monsters" check would
     * pass against zero and mean nothing. */
    setDiskPacks(NO_DISK_PACKS);
    expect(monsterCount()).toBeGreaterThan(500);
  });

  it("a mod whose dependency is missing is DROPPED and the game composes", () => {
    setDiskPacks(report([badRefPack("boom")]));

    /* The whole claim, in one line: this call is what used to be an exception
     * before the canvas existed. */
    const monsters = monsterCount();
    expect(monsters).toBeGreaterThan(500);

    /* And the player is TOLD, by name. A game that silently swallowed the mod
     * would pass the line above and leave an author with no way to find out. */
    const lines = problemLines(diskPackStatus().problems);
    expect(lines.some((l) => l.includes("boom"))).toBe(true);
    expect(
      lines.some((l) => l.includes("nobody-installed-this")),
    ).toBe(true);
  });

  it("the broken mod's namespace is ABSENT from the present set", () => {
    /* Not cosmetic. `presentNamespaces` is what `loadGame` reconciles a save's
     * mod-lifecycle blocks against: calling a dropped mod present would tell it
     * to rehydrate orphans against content that is not in the game. A pack that
     * was asked for and did not compose must not appear. */
    setDiskPacks(report([badRefPack("boom")]));
    expect([...presentNamespaces()].includes("boom")).toBe(false);
  });

  it("one broken mod does not take a good one down with it", () => {
    /* THE RULE, stated as a measurement. `composeDroppingBroken` drops packs one
     * at a time and retries, so the failure mode worth checking is the greedy
     * one: an implementation that gave up and fell back to the base alone would
     * pass every assertion above and quietly cost the innocent mod. */
    setDiskPacks(report([goodPack("fine"), badRefPack("boom")]));

    expect(monsterCount()).toBeGreaterThan(500);
    const present = presentNamespaces();
    expect({
      good: present.has("fine"),
      bad: present.has("boom"),
    }).toEqual({ good: true, bad: false });
  });

  it("two broken mods are both dropped, and both named", () => {
    setDiskPacks(report([badRefPack("boom"), badRefPack("kaboom")]));

    expect(monsterCount()).toBeGreaterThan(500);
    const lines = problemLines(diskPackStatus().problems).join("\n");
    expect({
      boom: lines.includes("boom"),
      kaboom: lines.includes("kaboom"),
      present: [...presentNamespaces()].filter((n) =>
        n.endsWith("boom"),
      ),
    }).toEqual({ boom: true, kaboom: true, present: [] });
  });

  it("a dependency CYCLE is broken by dropping, not by hanging or throwing", () => {
    /* The other resolveLoadOrder throw. A cycle has no single op to skip - it is
     * a statement about the whole enabled SET - so it is the case where dropping
     * a pack is the only move that makes the rest loadable, and the case a naive
     * guard would leave spinning. */
    const cyclic = (id: string, needs: string): DiskPack => ({
      manifest: {
        id,
        name: id,
        version: "1.0.0",
        shape: "content",
        dependencies: { [needs]: "1.0.0" },
      } as unknown as DiskPack["manifest"],
      files: {},
      code: [],
      assets: [],
    });
    setDiskPacks(report([cyclic("ping", "pong"), cyclic("pong", "ping")]));

    expect(monsterCount()).toBeGreaterThan(500);
    expect([...presentNamespaces()].sort()).toEqual(["core"]);
  });

});

/**
 * The OTHER half of the gap-13 row: whether a throw from anywhere ELSE in the
 * boot chain reaches a screen, not just the composer.
 *
 * `discoverMods` (`pack.ts:134`) reads `pack.manifest.id` with no guard, and
 * `composition()` is reached from module scope, so a `DiskPack` whose manifest
 * was not an object would be a blank page - the exact failure the composer's
 * `composeDroppingBroken` was chosen to prevent, one layer earlier.
 *
 * It cannot happen, and this is where that is measured rather than asserted.
 * Both producers of a `DiskPackReport` - the mods folder and the IndexedDB
 * installs - go through `readModDir`/`readOnePack`, which calls
 * `validateManifest` inside a `try` and returns `null` on a throw. A pack with a
 * bad manifest never becomes a `DiskPack` at all.
 *
 * SO NO GUARD WAS ADDED AT `pack.ts:134`, deliberately. A guard there could
 * never fire, and a check that cannot fail is worse than no check: it reads as
 * protection, it survives every refactor, and it would quietly become the reason
 * nobody re-asked this question. The invariant is enforced at the producer, so
 * the producer is what this proves.
 */
describe("a manifest that is not an object never becomes a pack", () => {
  /** An in-memory mods directory holding whatever JSON we hand it. */
  function source(files: Record<string, unknown>): ModDirSource {
    return {
      kind: "picked",
      dir: () => "/mods",
      list: () =>
        Promise.resolve(
          Object.keys(files).map((id) => ({
            id,
            files: ["manifest.json"],
          })),
        ) as ReturnType<ModDirSource["list"]>,
      readJson: (id: string) =>
        id in files
          ? Promise.resolve(files[id])
          : Promise.reject(new Error("no such file")),
      order: () => Promise.resolve([]),
    } as unknown as ModDirSource;
  }

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "not a manifest"],
    ["a number", 3],
    ["an object with no id", { name: "x", version: "1.0.0", shape: "content" }],
  ])("rejects a manifest that is %s, and says so", async (_what, value) => {
    const report = await readModDir(source({ broken: value }));
    expect({
      packs: report.packs.length,
      named: report.problems.some((p) => p.id === "broken"),
    }).toEqual({ packs: 0, named: true });
  });

  it("a good manifest in the same directory still loads (the control)", async () => {
    /* Without this, every row above would pass against a source that could not
     * produce a pack under any circumstances. */
    const report = await readModDir(
      source({
        broken: null,
        fine: { id: "fine", name: "fine", version: "1.0.0", shape: "content" },
      }),
    );
    expect(report.packs.map((p) => p.manifest.id)).toEqual(["fine"]);
  });
});
