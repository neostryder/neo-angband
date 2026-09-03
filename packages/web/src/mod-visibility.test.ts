/**
 * The two failures a mod system can have that a player cannot see, pinned.
 *
 * 1. A MOD THAT CONTRIBUTES NOTHING AND SAYS NOTHING. Five layers computed a reason
 *    and four of them rendered it nowhere - most sharply `loadModCode().problems`,
 *    written on every failure path and read by nothing at all. So an enabled,
 *    consented, listed mod could be behaviourally absent with the only evidence in a
 *    devtools console. These tests assert the reason reaches the screen, per mod.
 *
 * 2. CONTENT COMPOSED BEFORE THE MODS DIRECTORY WAS READ. pack.ts composed at module
 *    scope; main.ts latches the directory in its own body; ES module order puts the
 *    dependency first. So a folder or installed CONTENT mod could never contribute a
 *    record - on any platform, since the mods directory existed. Measured in the
 *    running dev server, not deduced.
 *
 *    THE EXISTING SUITE COULD NOT SEE IT, and it is worth saying how, because the
 *    shape recurs: disk-packs.test.ts's "a disk pack reaches the composer" calls
 *    `composeContentPacks` DIRECTLY on a hand-assembled pair. That proves the SDK
 *    accepts a disk pack's shape, which was never in doubt, and says nothing about
 *    whether the host ever hands it one. The port had the function and wired no
 *    caller. The test below drives pack.ts's own entry points instead, in the order
 *    boot uses them, which is the only order that can fail.
 */

import { afterEach, describe, expect, it } from "vitest";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks, type DiskPack } from "./disk-packs";
import { resetModCode, setModCode } from "./mod-code";
import {
  modFaults,
  problemLines,
  problemsFor,
  reportModFault,
  resetModFaults,
  unattributedProblems,
} from "./mod-problems";
import { problemBlock, rowDetail, rowLabel } from "./mods";
import type { CatalogMod } from "./mod-store";

/**
 * NO vi.resetModules(), deliberately.
 *
 * Resetting the registry would give `await import("./pack")` a private copy of
 * disk-packs, mod-code and mod-problems, so the `setDiskPacks` / `setModCode` /
 * `reportModFault` this file imported would write to modules pack.ts cannot see -
 * and every assertion below would fail for a reason that has nothing to do with the
 * code under test. It is unnecessary as well as harmful: the composition is keyed on
 * its inputs rather than memoised on first touch, so re-latching is the supported
 * operation and resetting the three latches is the whole cleanup.
 */
afterEach(() => {
  resetDiskPacks();
  resetModCode();
  resetModFaults();
});

/** A disk pack that PATCHES a core monster, so its effect is observable in records. */
function patchingPack(id: string, newName: string): DiskPack {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      shape: "content",
      dependencies: { core: "*" },
    } as DiskPack["manifest"],
    files: {
      monster: {
        patches: { "core:grip-farmer-maggot-s-dog": { name: newName } },
      },
    },
    code: [],
    assets: [],
  };
}

/**
 * A report carrying exactly these packs, as a picked folder would.
 *
 * `order` is what ENABLES them here, and that is not a shortcut: it is
 * load-order.json, the file an external mod manager owns, and resolveEnabledIds
 * appends any id in it that the player has no recorded opinion about. So this needs
 * no localStorage - which this suite runs without - and it exercises the OTHER thing
 * the composition-order defect broke, since enabledModIds() read `diskPacks().order`
 * at module scope too and so ignored a deployed mod's load order entirely.
 */
function folderWith(...packs: DiskPack[]): Parameters<typeof setDiskPacks>[0] {
  return {
    packs,
    order: packs.map((p) => p.manifest.id),
    problems: [],
    dir: "my-mods",
    available: true,
    kind: "picked",
    codeUrl: null,
    assetUrl: null,
    origins: [{ kind: "picked", dir: "my-mods", count: packs.length }],
  };
}

describe("content composes AFTER the mods directory is latched", () => {
  it("lets a disk pack latched after pack.ts loaded still patch a core record", async () => {
    /* THE RATCHET. The import comes FIRST and the latch SECOND, which is exactly
     * boot's order (main.ts imports ./pack statically, then setDiskPacks in its
     * body) and exactly the order the old module-scope composition could not
     * survive. Reversing these two lines makes this pass either way, which is why
     * they are in this order and commented. */
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("folder-hound", "Grip, the Folder Hound")));
    const monsters = pack.loadGamePack().mon.monsters as { name?: string }[];
    const names = monsters.map((m) => m.name);
    expect(names).toContain("Grip, the Folder Hound");
    expect(names).not.toContain("Grip, Farmer Maggot's Dog");
  });

  it("puts a disk mod's namespace in the present set, so loadGame keeps its entities", async () => {
    /* The same defect's second face, and the more damaging one: presentNamespaces
     * omitting an enabled content mod tells loadGame to QUARANTINE that mod's live
     * world entities on the next reload. The set that exists to prevent
     * "I added a mod and my content vanished" was causing it. */
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("folder-hound", "x")));
    expect([...pack.presentNamespaces()]).toEqual(["core", "folder-hound"]);
  });

  it("recomposes when the directory changes, so no early reader can freeze the answer", async () => {
    /* A memo that fills on FIRST TOUCH is one early caller away from being the
     * original bug again, silently and identically. So it is keyed on the inputs:
     * reading content before the latch must not poison what comes after. */
    const pack = await import("./pack");
    /* An early read, with no directory - the poisoning call. */
    setDiskPacks(NO_DISK_PACKS);
    expect([...pack.presentNamespaces()]).toEqual(["core"]);
    setDiskPacks(folderWith(patchingPack("folder-hound", "y")));
    expect([...pack.presentNamespaces()]).toEqual(["core", "folder-hound"]);
  });
});

describe("one broken mod costs that mod, not the game", () => {
  /**
   * NARROWED TWICE, and the second narrowing is 2026-08-02.
   *
   * First this whole class of mistake was a BLANK PAGE: composeContentPacks threw
   * and pack.ts composes with no try, so a mod's typo left no canvas, no mod
   * manager, and no way to turn the offender off short of clearing localStorage.
   * composeDroppingBroken made it cost the mod.
   *
   * Costing the MOD was still too coarse for a dangling ref. An engine release
   * that renames one record would take out a mod that patches forty, along with
   * its code, its rules and its tiles - which is the cost that makes an author
   * republish on every engine patch. It now costs the OP.
   *
   * Both tests are here because both behaviours are still live and they must not
   * be confused: a bad contribution is skipped, an unsatisfiable dependency graph
   * still drops the pack, and there is no single op to skip in the second case.
   */
  it("costs the PATCH when a ref does not exist, and keeps the rest of the mod", async () => {
    const pack = await import("./pack");
    const broken: DiskPack = {
      manifest: {
        id: "broken",
        name: "broken",
        version: "1.0.0",
        shape: "content",
        dependencies: { core: "*" },
      } as DiskPack["manifest"],
      files: {
        monster: {
          patches: { "core:no-such-monster-at-all": { name: "x" } },
          /* The forty that ARE fine, standing in as one - and WRITTEN OUT in
           * full, which it used to not be. `{name: "Survivor Hound"}` composed
           * and survived, so it made the point about the patch; then gap 12
           * taught the loader to check a mod's records against core's blueprint,
           * and this one drew four warnings of its own. A record standing in for
           * "the ones that are fine" cannot be one that is not. */
          records: [
            {
              name: "Survivor Hound",
              base: "canine",
              color: "u",
              speed: 110,
              "hit-points": 5,
              hearing: 30,
              "armor-class": 12,
              sleepiness: 10,
              depth: 1,
              rarity: 1,
              experience: 1,
              blow: [{ method: "BITE", effect: "HURT", damage: "1d3" }],
              flags: ["ANIMAL"],
              desc: ["It survived."],
            },
          ],
        },
      },
      code: [],
      assets: [],
    };
    setDiskPacks(folderWith(broken, patchingPack("good", "Grip, the Good Hound")));
    const names = (pack.loadGamePack().mon.monsters as { name?: string }[]).map((m) => m.name);

    expect(names).toContain("Grip, the Good Hound"); // the innocent mod
    expect(names).toContain("Survivor Hound"); // the rest of the broken one

    const mine = problemsFor(pack.diskPackStatus().problems, "broken");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("core:no-such-monster-at-all");
    expect(mine[0]).not.toContain("none of this mod's content loaded");
    expect(problemsFor(pack.diskPackStatus().problems, "good")).toEqual([]);
    /* Its records ARE in the game, so its namespace is present - the quarantine
     * question has to be answered by what composed, not by whether anything went
     * wrong. */
    expect(pack.presentNamespaces().has("broken")).toBe(true);
  });

  it("still drops the whole pack when the load order itself cannot be resolved", async () => {
    /* resolveLoadOrder throws on a missing dependency, and that is a statement
     * about the SET of mods rather than one contribution: there is no op to skip,
     * and dropping the pack is what makes the others loadable. */
    const pack = await import("./pack");
    const orphan: DiskPack = {
      manifest: {
        id: "orphan",
        name: "orphan",
        version: "1.0.0",
        shape: "content",
        dependencies: { "a-mod-that-is-not-installed": "*" },
      } as DiskPack["manifest"],
      files: { monster: { records: [{ name: "Never Loaded Hound" }] } },
      code: [],
      assets: [],
    };
    setDiskPacks(folderWith(orphan, patchingPack("good", "Grip, the Good Hound")));
    const names = (pack.loadGamePack().mon.monsters as { name?: string }[]).map((m) => m.name);

    expect(names).toContain("Grip, the Good Hound");
    expect(names).not.toContain("Never Loaded Hound");
    const mine = problemsFor(pack.diskPackStatus().problems, "orphan");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("none of this mod's content loaded");
    /* Dropped means ABSENT, so its namespace must not be called present: a
     * rehydrated orphan with no content behind it is worse than a quarantined one. */
    expect(pack.presentNamespaces().has("orphan")).toBe(false);
  });
});

describe("every layer's reason reaches diskPackStatus", () => {
  it("carries the CODE loader's problems, which used to reach nothing at all", async () => {
    const pack = await import("./pack");
    setDiskPacks(NO_DISK_PACKS);
    setModCode({
      plugins: [],
      workers: [],
      problems: [{ id: "codey", why: "plugin.js failed to load: boom" }],
      skipped: [{ id: "shy", why: "awaiting consent for registry:effects" }],
    });
    const s = pack.diskPackStatus();
    expect(problemsFor(s.problems, "codey")).toEqual([
      "plugin.js failed to load: boom",
    ]);
    /* Not a fault: a mod waiting for consent is in the state the player left it in,
     * and a manager that called it broken would cry wolf on every mod turned off. */
    expect(problemsFor(s.problems, "shy")).toEqual([]);
    expect(problemsFor(s.skipped, "shy")).toEqual([
      "awaiting consent for registry:effects",
    ]);
  });

  it("carries a hooks()/register() throw, which used to be a console.error only", async () => {
    const pack = await import("./pack");
    setDiskPacks(NO_DISK_PACKS);
    reportModFault("thrower", "hooks() threw, so it changes no behaviour: nope");
    expect(problemsFor(pack.diskPackStatus().problems, "thrower")).toEqual([
      "hooks() threw, so it changes no behaviour: nope",
    ]);
  });

  it("dedupes a repeated fault, because activeModHooks re-runs on every rule toggle", () => {
    reportModFault("a", "same");
    reportModFault("a", "same");
    reportModFault("a", "different");
    expect(modFaults()).toHaveLength(2);
  });
});

/** A catalog row with just enough on it for the label and detail functions. */
function catalogMod(over: Partial<CatalogMod> = {}): CatalogMod {
  return {
    id: "qol",
    name: "Quality of Life",
    version: "0.10.0",
    shape: "plugin",
    kind: "trusted",
    manifest: { id: "qol", name: "Quality of Life", version: "0.10.0", shape: "plugin" },
    enabled: true,
    capabilities: [],
    nondeterministic: false,
    affectsGameplay: false,
    consented: true,
    ...over,
  };
}

describe("the mods screen says which mod is not working", () => {
  it("badges the row and takes its colour, outranking every other flag", () => {
    const clean = rowLabel(catalogMod());
    expect(clean.label).not.toContain("NOT WORKING");

    const broken = rowLabel(catalogMod({ nondeterministic: true }), ["plugin.js failed"]);
    expect(broken.label).toContain("! NOT WORKING");
    /* It is now the ONLY flag on a broken row, not merely the first one. A mod
     * that is not running is not affecting this game's determinism right now,
     * and the row has 76 columns for a name, a version, a kind and the badges -
     * so the two hypothetical flags give way to the one that is true. The save
     * ratchets are still stated in the detail pane. */
    expect(broken.label).not.toContain("unseeded");
    expect(broken.color).not.toBe(clean.color);
    expect(broken.hint).toContain("Enter to see what");
    /* The unbroken row keeps its own flag. */
    expect(rowLabel(catalogMod({ nondeterministic: true })).label).toContain("unseeded");
  });

  it("puts the reason in the detail pane above the description, and never truncates it", () => {
    const lines = rowDetail(
      catalogMod({
        manifest: {
          id: "qol",
          name: "Quality of Life",
          version: "0.10.0",
          shape: "plugin",
          description: "word ".repeat(400),
        },
      }),
      80,
      12,
      ["plugin.js failed to load: boom"],
    );
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("NOT WORKING");
    expect(text).toContain("plugin.js failed to load: boom");
    /* The pane's budget is respected by cutting the DESCRIPTION, which is what a
     * player reads to decide whether they want the mod - not the fault, which is what
     * they read when they already turned it on and nothing happened. */
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(text).toContain("open the mod to read the rest");
  });

  it("distinguishes 'not loaded on purpose' from 'broken'", () => {
    const text = rowDetail(catalogMod(), 80, 99, [], ["awaiting consent for registry:effects"])
      .map((l) => l.text)
      .join("\n");
    expect(text).toContain("Not loaded: awaiting consent");
    expect(text).not.toContain("NOT WORKING");
  });

  it("says what the problem list DROPPED instead of truncating in silence", () => {
    /* It used to slice(0, 8) and print nothing about the rest, so nine problems
     * looked like eight - a truncation that reads as completeness, hiding exactly
     * the case where a lot has gone wrong. */
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, why: "nope" }));
    const text = problemBlock(many).map((l) => l.text).join("\n");
    expect(text).toContain("and 3 more");
    expect(problemBlock([])).toEqual([]);
  });

  it("keeps a problem whose mod has NO row visible somewhere", () => {
    /* A folder whose manifest will not validate never becomes a catalogue entry, so
     * per-mod rendering alone would hide it completely - the failure this whole change
     * is about, reintroduced by the fix for it. */
    const problems = [
      { id: "listed", why: "on its own row" },
      { id: "unlisted", why: "never became a row" },
      { id: null, why: "the folder itself" },
    ];
    expect(unattributedProblems(problems, new Set(["listed"]))).toEqual([
      "unlisted: never became a row",
      "the folder itself",
    ]);
  });

  it("puts the id back on a line when it is asked for one", () => {
    expect(problemLines([{ id: "a", why: "b" }, { id: null, why: "c" }])).toEqual([
      "a: b",
      "c",
    ]);
  });
});
