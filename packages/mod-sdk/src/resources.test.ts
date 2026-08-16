/**
 * The static half of the resource check, and the arbitration between mods.
 *
 * The runtime half - "can THIS machine decode these bytes" - is not testable
 * here and is not tested here; it lives in packages/web/src/mod-resources.ts
 * with the `Audio` element it needs. What this file is responsible for is the
 * part whose answer is the same everywhere, plus the merge rules, which are
 * invisible by construction: a shadowed contribution is a sound pack that
 * silently does not play, and only a test can see one.
 */

import { describe, expect, it } from "vitest";
import {
  ART_SLOTS,
  chooseResources,
  RESOURCE_KIND_NAMES,
  RESOURCE_KINDS,
  resourceComplaint,
  resourcesOfKind,
  type ContributedResource,
  type PackResource,
} from "./resources.js";
import { ManifestError, validateManifest } from "./manifest.js";

/** A manifest that validates, so a test can add one bad resource to it. */
function manifestWith(resources: unknown): Record<string, unknown> {
  return {
    id: "test-mod",
    name: "Test Mod",
    version: "1.0.0",
    shape: "content",
    resources,
  };
}

function contribution(modId: string, resource: PackResource): ContributedResource {
  return { modId, resource };
}

describe("a well-formed declaration is accepted", () => {
  it("takes one entry of every kind", () => {
    const resources: PackResource[] = [
      { kind: "sound", path: "sounds" },
      { kind: "font", path: "fonts/tiny.json" },
      { kind: "prefs", path: "prefs/colours.prf" },
      { kind: "help", path: "help/spoilers.txt", slot: "spoilers" },
      { kind: "art", path: "art/splash.txt", slot: "splash" },
      { kind: "locale", path: "locales/de.json", slot: "de" },
    ];
    for (const resource of resources) {
      expect(resourceComplaint(resource, "test-mod")).toBeNull();
    }
    expect(() => validateManifest(manifestWith(resources))).not.toThrow();
  });

  it("covers every kind in the registry, so a new one cannot arrive untested", () => {
    /* The list above is written out by hand, which means it can fall behind
     * RESOURCE_KINDS without anything noticing - the same shape as an allowlist
     * falling behind its type. Counting closes it: add a kind and this fails
     * until the case above exists. */
    const covered = new Set<string>([
      "sound",
      "font",
      "prefs",
      "help",
      "art",
      "locale",
    ]);
    expect([...covered].sort()).toEqual([...RESOURCE_KIND_NAMES].sort());
  });

  it("allows the whole manifest to omit resources", () => {
    const m = validateManifest({
      id: "quiet",
      name: "Quiet",
      version: "1.0.0",
      shape: "content",
    });
    expect(m.resources).toBeUndefined();
  });
});

describe("a declaration that cannot work is refused, and says why", () => {
  it("refuses an unknown kind and lists the known ones", () => {
    const why = resourceComplaint({ kind: "shader", path: "x/y.glsl" }, "test-mod");
    expect(why).toContain("shader");
    for (const kind of RESOURCE_KIND_NAMES) expect(why).toContain(kind);
  });

  it("refuses a path that leaves the mod folder", () => {
    expect(
      resourceComplaint({ kind: "prefs", path: "../other-mod/x.prf" }, "test-mod"),
    ).toContain("stay inside the mod folder");
  });

  it("refuses a site-absolute path, which only a bundled mod could know", () => {
    expect(
      resourceComplaint({ kind: "prefs", path: "/mods/me/x.prf" }, "test-mod"),
    ).toContain("must be relative to the mod folder");
  });

  it("refuses an extension the kind cannot be", () => {
    const why = resourceComplaint({ kind: "prefs", path: "prefs/colours.txt" }, "m");
    expect(why).toContain(".prf");
  });

  it("refuses a TOP-LEVEL .json font, because the record composer would take it", () => {
    /* The collision this catches is silent and cross-file: sortPackFiles sorts a
     * pack's files by path shape alone and treats every top-level .json as a
     * record contribution. A `font.json` would go to the record composer, which
     * has no content file by that name, and the mod would load with no font and
     * no complaint anywhere. */
    expect(resourceComplaint({ kind: "font", path: "font.json" }, "m")).toContain(
      "subdirectory",
    );
    expect(
      resourceComplaint({ kind: "font", path: "fonts/font.json" }, "m"),
    ).toBeNull();
  });

  it("refuses art for a slot no screen paints, naming the slots that exist", () => {
    const why = resourceComplaint(
      { kind: "art", path: "art/boss.txt", slot: "boss-portrait" },
      "m",
    );
    expect(why).toContain("boss-portrait");
    for (const slot of ART_SLOTS) expect(why).toContain(slot);
  });

  it("requires a slot where the kind has named parts", () => {
    expect(resourceComplaint({ kind: "help", path: "help/x.txt" }, "m")).toContain(
      "must name a slot",
    );
  });

  it("REFUSES a slot on a kind that has none, rather than dropping it", () => {
    /* An ignored key is an author believing something about how their resource
     * will be used, and the belief surviving to ship. */
    expect(
      resourceComplaint({ kind: "sound", path: "sounds", slot: "combat" }, "m"),
    ).toContain("takes no slot");
  });

  it("makes the manifest validator throw, with the same sentence", () => {
    const bad = manifestWith([{ kind: "prefs", path: "../escape.prf" }]);
    expect(() => validateManifest(bad)).toThrow(ManifestError);
    expect(() => validateManifest(bad)).toThrow(/stay inside the mod folder/u);
  });

  it("refuses resources that is not an array at all", () => {
    expect(() => validateManifest(manifestWith({ kind: "sound", path: "s" }))).toThrow(
      /resources must be an array/u,
    );
  });
});

describe("several mods contributing the same kind", () => {
  it("gives the LAST enabled mod the single-slot kinds", () => {
    const { chosen, shadowed } = chooseResources([
      contribution("first", { kind: "sound", path: "sounds" }),
      contribution("second", { kind: "sound", path: "audio" }),
    ]);
    expect(chosen.map((c) => c.modId)).toEqual(["second"]);
    expect(shadowed.map((c) => c.modId)).toEqual(["first"]);
  });

  it("keeps EVERY pref file, because a .prf is a list of assignments", () => {
    const { chosen, shadowed } = chooseResources([
      contribution("first", { kind: "prefs", path: "a.prf" }),
      contribution("second", { kind: "prefs", path: "b.prf" }),
    ]);
    expect(chosen.map((c) => c.resource.path)).toEqual(["a.prf", "b.prf"]);
    expect(shadowed).toEqual([]);
  });

  it("arbitrates slotted kinds per slot, so two mods can coexist", () => {
    const { chosen, shadowed } = chooseResources([
      contribution("art-mod", { kind: "art", path: "s.txt", slot: "splash" }),
      contribution("help-mod", { kind: "help", path: "h.txt", slot: "spoilers" }),
    ]);
    expect(chosen).toHaveLength(2);
    expect(shadowed).toEqual([]);
  });

  it("holds the WINNER at the first claimant's position", () => {
    /* So a list the player reads does not reshuffle when they reorder mods -
     * the rule tiles settled on after the reverse behaviour shipped. */
    const { chosen } = chooseResources([
      contribution("a", { kind: "help", path: "1.txt", slot: "alpha" }),
      contribution("b", { kind: "help", path: "2.txt", slot: "beta" }),
      contribution("c", { kind: "help", path: "3.txt", slot: "alpha" }),
    ]);
    expect(chosen.map((c) => c.resource.slot)).toEqual(["alpha", "beta"]);
    expect(chosen[0]?.modId).toBe("c");
  });

  it("reports the loser, which is the only way anyone could see it", () => {
    const { shadowed } = chooseResources([
      contribution("quiet-loser", { kind: "font", path: "f/a.json" }),
      contribution("winner", { kind: "font", path: "f/b.json" }),
    ]);
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0]?.modId).toBe("quiet-loser");
  });

  it("selects by kind", () => {
    const { chosen } = chooseResources([
      contribution("a", { kind: "prefs", path: "a.prf" }),
      contribution("b", { kind: "sound", path: "s" }),
    ]);
    expect(resourcesOfKind(chosen, "prefs").map((c) => c.modId)).toEqual(["a"]);
    expect(resourcesOfKind(chosen, "font")).toEqual([]);
  });
});

describe("the registry itself", () => {
  it("gives a directory kind no extensions, and a file kind at least one", () => {
    for (const kind of RESOURCE_KIND_NAMES) {
      const spec = RESOURCE_KINDS[kind];
      if (spec.directory) expect(spec.extensions).toEqual([]);
      else expect(spec.extensions.length).toBeGreaterThan(0);
    }
  });

  it("spells every extension lowercase and dotted, since that is how they are matched", () => {
    for (const kind of RESOURCE_KIND_NAMES) {
      for (const ext of RESOURCE_KINDS[kind].extensions) {
        expect(ext).toBe(ext.toLowerCase());
        expect(ext.startsWith(".")).toBe(true);
      }
    }
  });

  it("matches an extension case-insensitively, because a file name is the author's", () => {
    expect(resourceComplaint({ kind: "art", path: "art/Splash.TXT", slot: "splash" }, "m"))
      .toBeNull();
  });

  it("refuses an IMAGE for the splash, because nothing paints one", () => {
    /* The honest half of this seam: a kind's extensions are what a consumer can
     * read, not what sounds plausible. A PNG that validated and then drew
     * nothing would be a manifest field with no reader. */
    expect(
      resourceComplaint({ kind: "art", path: "art/splash.png", slot: "splash" }, "m"),
    ).toContain(".txt");
  });
});
