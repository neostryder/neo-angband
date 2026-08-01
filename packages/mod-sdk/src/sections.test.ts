import { describe, expect, it } from "vitest";
import type { PackContent } from "./compose.js";
import { ComposeError, composePacks } from "./compose.js";
import { composeContentPacks, composeDroppingBroken, type LoadedPack } from "./loader.js";
import type { PackManifest } from "./manifest.js";
import {
  expandedPackContents,
  expandSections,
  resolveSectionState,
  sectionFlag,
} from "./sections.js";

function manifest(id: string, extra: Partial<PackManifest> = {}): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content", ...extra };
}

/** Every section on. */
const allOn = (): boolean => true;

describe("resolveSectionState", () => {
  const frost = manifest("frost", {
    sections: [
      { id: "on-by-default", title: "A" },
      { id: "off-by-default", title: "B", default: false },
      { id: "explicit-on", title: "C", default: true },
    ],
  });

  it("defaults a section with no `default` to ON", () => {
    const s = resolveSectionState([frost], {}, new Set(["frost"]));
    expect(s.get("frost")?.get("on-by-default")).toBe(true);
  });

  it("honours the author's default when the player has not chosen", () => {
    const s = resolveSectionState([frost], {}, new Set(["frost"]));
    expect(s.get("frost")?.get("off-by-default")).toBe(false);
  });

  it("lets the player's choice beat the author's default, both ways", () => {
    const s = resolveSectionState(
      [frost],
      { frost: { "off-by-default": true, "explicit-on": false } },
      new Set(["frost"]),
    );
    expect(s.get("frost")?.get("off-by-default")).toBe(true);
    expect(s.get("frost")?.get("explicit-on")).toBe(false);
  });

  it("gives a pack with no sections an empty table rather than no entry", () => {
    const s = resolveSectionState([manifest("plain")], {}, new Set(["plain"]));
    expect(s.get("plain")?.size).toBe(0);
  });
});

describe("resolveSectionState: a `patches` claim makes a section conditional", () => {
  const withPatch = (range?: string): PackManifest =>
    manifest("frost", {
      sections: [{ id: "runes-fix", title: "Runes compatibility" }],
      compat: [
        {
          with: "runes",
          claim: "patches",
          scope: ["runes-fix"],
          because: "Runes changes the same speed field.",
          ...(range ? { range } : {}),
        },
      ],
    });

  it("is ON when the patched pack is present", () => {
    const s = resolveSectionState(
      [withPatch(), manifest("runes")],
      {},
      new Set(["frost", "runes"]),
    );
    expect(s.get("frost")?.get("runes-fix")).toBe(true);
  });

  it("is OFF when the patched pack is absent", () => {
    const s = resolveSectionState([withPatch()], {}, new Set(["frost"]));
    expect(s.get("frost")?.get("runes-fix")).toBe(false);
  });

  /* Otherwise an "on" the player set while runes was installed would silently
   * keep patching nothing after they removed it. */
  it("stays OFF even when the player explicitly turned it on", () => {
    const s = resolveSectionState(
      [withPatch()],
      { frost: { "runes-fix": true } },
      new Set(["frost"]),
    );
    expect(s.get("frost")?.get("runes-fix")).toBe(false);
  });

  it("respects the claim's version range", () => {
    const packs = [withPatch("<2.0.0"), manifest("runes", { version: "2.5.0" })];
    expect(
      resolveSectionState(packs, {}, new Set(["frost", "runes"])).get("frost")?.get("runes-fix"),
    ).toBe(false);

    const older = [withPatch("<2.0.0"), manifest("runes", { version: "1.9.0" })];
    expect(
      resolveSectionState(older, {}, new Set(["frost", "runes"])).get("frost")?.get("runes-fix"),
    ).toBe(true);
  });

  /* A claim is about someone ELSE's mod; a typo in its range must not stop the
   * game, so an unparseable range simply does not restrict. */
  it("does not throw on a malformed range in a claim", () => {
    const packs = [withPatch("not a range"), manifest("runes")];
    expect(() => resolveSectionState(packs, {}, new Set(["frost", "runes"]))).not.toThrow();
    expect(
      resolveSectionState(packs, {}, new Set(["frost", "runes"])).get("frost")?.get("runes-fix"),
    ).toBe(true);
  });
});

describe("sectionFlag", () => {
  it("is the section id unless the author named a flag", () => {
    expect(sectionFlag({ id: "kobolds", title: "K" })).toBe("kobolds");
    expect(sectionFlag({ id: "kobolds", title: "K", flag: "frost.kobolds" })).toBe(
      "frost.kobolds",
    );
  });
});

/** A pack whose "monster" file contributes a base patch plus per-section patches. */
function pack(
  id: string,
  sections: PackManifest["sections"],
  files: PackContent["files"],
): PackContent {
  return { manifest: manifest(id, sections ? { sections } : {}), files };
}

describe("expandSections", () => {
  it("keeps an unsectioned pack as exactly one unit", () => {
    const units = expandSections(
      [pack("frost", undefined, { monster: { fieldPatches: { "core:kobold": [] } } })],
      allOn,
    );
    expect(units).toHaveLength(1);
    expect(units[0]?.sectionId).toBeNull();
    expect(units[0]?.content.files["monster"]).toEqual({ fieldPatches: { "core:kobold": [] } });
  });

  it("splits a section out into its own unit and strips it from the base", () => {
    const units = expandSections(
      [
        pack("frost", [{ id: "kobolds", title: "K" }], {
          monster: {
            fieldPatches: { "core:orc": [] },
            sections: { kobolds: { fieldPatches: { "core:kobold": [] } } },
          },
        }),
      ],
      allOn,
    );
    expect(units.map((u) => u.sectionId)).toEqual([null, "kobolds"]);
    /* The base unit must NOT still carry the nested sections key, or the
     * contribution would compose twice. */
    expect(units[0]?.content.files["monster"]).toEqual({ fieldPatches: { "core:orc": [] } });
    expect(units[1]?.content.files["monster"]).toEqual({ fieldPatches: { "core:kobold": [] } });
  });

  it("drops a section that is off entirely, rather than composing it", () => {
    const units = expandSections(
      [
        pack("frost", [{ id: "kobolds", title: "K" }], {
          monster: { sections: { kobolds: { fieldPatches: { "core:kobold": [] } } } },
        }),
      ],
      () => false,
    );
    expect(units).toHaveLength(1);
    expect(units[0]?.sectionId).toBeNull();
    expect(JSON.stringify(units)).not.toContain("core:kobold");
  });

  it("emits a base unit even for a pack contributing no content", () => {
    const units = expandSections([pack("plugin-only", undefined, {})], allOn);
    expect(units).toHaveLength(1);
    expect(units[0]?.content.files).toEqual({});
  });

  it("refuses a contribution to a section the manifest does not declare", () => {
    expect(() =>
      expandSections(
        [
          pack("frost", [{ id: "kobolds", title: "K" }], {
            monster: { sections: { koblods: { fieldPatches: {} } } },
          }),
        ],
        allOn,
      ),
    ).toThrow(ComposeError);
  });

  it("names both the section and the file when it refuses", () => {
    try {
      expandSections(
        [pack("frost", [], { monster: { sections: { ghost: { fieldPatches: {} } } } })],
        allOn,
      );
      throw new Error("expected a refusal");
    } catch (e) {
      expect((e as Error).message).toContain("ghost");
      expect((e as Error).message).toContain("frost/monster");
    }
  });
});

describe("expandSections: band ordering", () => {
  /** Two packs, each with one banded section, in the given load order. */
  function two(aBand: PackManifest["sections"], bBand: PackManifest["sections"]) {
    return [
      pack("a", aBand, { monster: { sections: { s: { fieldPatches: {} } } } }),
      pack("b", bBand, { monster: { sections: { s: { fieldPatches: {} } } } }),
    ];
  }

  it("leaves same-band sections in load order", () => {
    const units = expandSections(
      two([{ id: "s", title: "S" }], [{ id: "s", title: "S" }]),
      allOn,
    );
    expect(units.filter((u) => u.sectionId).map((u) => u.packId)).toEqual(["a", "b"]);
  });

  /* The property a numeric offset could not have: `last` beats an EARLIER pack's
   * normal section no matter how many mods sit between them. */
  it("puts a later pack's `last` section after an earlier pack's normal one", () => {
    const units = expandSections(
      two([{ id: "s", title: "S" }], [{ id: "s", title: "S", priority: "last" }]),
      allOn,
    );
    expect(units.filter((u) => u.sectionId).map((u) => u.packId)).toEqual(["a", "b"]);
  });

  it("puts an EARLIER pack's `last` section after a later pack's normal one", () => {
    const units = expandSections(
      two([{ id: "s", title: "S", priority: "last" }], [{ id: "s", title: "S" }]),
      allOn,
    );
    expect(units.filter((u) => u.sectionId).map((u) => u.packId)).toEqual(["b", "a"]);
  });

  it("puts a `first` section ahead of everything, including earlier packs", () => {
    const units = expandSections(
      two([{ id: "s", title: "S" }], [{ id: "s", title: "S", priority: "first" }]),
      allOn,
    );
    expect(units[0]?.packId).toBe("b");
    expect(units[0]?.sectionId).toBe("s");
  });

  it("orders a pack's own unsectioned contributions before its normal sections", () => {
    const units = expandSections(
      [
        pack("a", [{ id: "s", title: "S" }], {
          monster: { fieldPatches: {}, sections: { s: { fieldPatches: {} } } },
        }),
      ],
      allOn,
    );
    expect(units.map((u) => u.sectionId)).toEqual([null, "s"]);
  });

  it("keeps two sections of one pack in declaration order within a band", () => {
    const units = expandSections(
      [
        pack(
          "a",
          [
            { id: "second", title: "2" },
            { id: "first-declared", title: "1" },
          ],
          {
            monster: {
              sections: { second: { fieldPatches: {} }, "first-declared": { fieldPatches: {} } },
            },
          },
        ),
      ],
      allOn,
    );
    /* Declaration order, not the JSON key order of the contribution table. */
    expect(units.filter((u) => u.sectionId).map((u) => u.sectionId)).toEqual([
      "second",
      "first-declared",
    ]);
  });

  it("is a pure function of its input", () => {
    const input = two(
      [{ id: "s", title: "S", priority: "late" }],
      [{ id: "s", title: "S", priority: "first" }],
    );
    const once = expandSections(input, allOn).map((u) => `${u.packId}/${u.sectionId}`);
    for (let i = 0; i < 5; i++) {
      expect(expandSections(input, allOn).map((u) => `${u.packId}/${u.sectionId}`)).toEqual(once);
    }
  });
});

describe("a band yields to a patch target", () => {
  /** core owns the kobold; frost patches it from a section with the given band. */
  function frostBanded(band: "first" | "early" | "late" | "last") {
    const core: PackContent = {
      manifest: manifest("core"),
      files: { monster: { records: [{ name: "kobold", speed: 110 }] } },
    };
    const frost: PackContent = {
      manifest: manifest("frost", {
        dependencies: { core: "*" },
        sections: [{ id: "speed", title: "Speed", priority: band }],
      }),
      files: {
        monster: {
          sections: {
            speed: { fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 130 }] } },
          },
        },
      },
    };
    return expandSections([core, frost], allOn);
  }

  /* The wish is coherent - "let everyone else override my value" - and the
   * position is impossible, because core:kobold does not exist yet. Left alone
   * this threw and took the whole game down over one manifest field. */
  it("holds a `first` section back until the pack owning its target has composed", () => {
    const units = frostBanded("first");
    const at = (p: string, s: string | null) =>
      units.findIndex((u) => u.packId === p && u.sectionId === s);
    expect(at("frost", "speed")).toBeGreaterThan(at("core", null));
  });

  it("records which pack it was held for, so the report can say the band did not apply", () => {
    const held = frostBanded("first").find((u) => u.sectionId === "speed");
    expect(held?.heldFor).toBe("core");
    expect(held?.band).toBe("first");
  });

  it("leaves a band that needs no holding alone", () => {
    for (const band of ["late", "last"] as const) {
      const u = frostBanded(band).find((s) => s.sectionId === "speed");
      expect(u?.heldFor).toBeUndefined();
    }
  });

  it("still composes to the patched value after being held", () => {
    for (const band of ["first", "early", "late", "last"] as const) {
      const game = composePacks(frostBanded(band).map((u) => u.content));
      expect(game.get("monster")?.get("core:kobold")?.value).toMatchObject({ speed: 130 });
    }
  });

  /* A section may patch a record its OWN pack declared outside any section, so
   * the pack's own base unit is a requirement like anyone else's. */
  it("holds a section back for its own pack's base unit", () => {
    const units = expandSections(
      [
        {
          manifest: manifest("frost", {
            sections: [{ id: "tune", title: "Tune", priority: "first" }],
          }),
          files: {
            monster: {
              records: [{ name: "wyrm", speed: 110 }],
              sections: {
                tune: {
                  fieldPatches: { "frost:wyrm": [{ op: "set", path: "speed", value: 120 }] },
                },
              },
            },
          },
        },
      ],
      allOn,
    );
    expect(units.map((u) => u.sectionId)).toEqual([null, "tune"]);
    expect(units[1]?.heldFor).toBe("frost");
    expect(
      composePacks(units.map((u) => u.content)).get("monster")?.get("frost:wyrm")?.value,
    ).toMatchObject({ speed: 120 });
  });

  /* A target that never appears is a broken pack, not a band to repair - and
   * composePacks' error names the ref, which is the useful message. */
  it("emits a section whose target pack is absent, leaving composePacks to name it", () => {
    const units = expandSections(
      [
        {
          manifest: manifest("frost", {
            sections: [{ id: "s", title: "S", priority: "first" }],
          }),
          files: { monster: { sections: { s: { fieldPatches: { "ghost:thing": [] } } } } },
        },
      ],
      allOn,
    );
    expect(units).toHaveLength(2);
    expect(() => composePacks(units.map((u) => u.content))).toThrow(/ghost:thing/);
  });

  it("terminates and keeps band order among several held sections", () => {
    const core: PackContent = {
      manifest: manifest("core"),
      files: { monster: { records: [{ name: "kobold", speed: 110 }] } },
    };
    const one = (id: string): PackContent => ({
      manifest: manifest(id, {
        dependencies: { core: "*" },
        sections: [{ id: "s", title: "S", priority: "first" }],
      }),
      files: { monster: { sections: { s: { fieldPatches: { "core:kobold": [] } } } } },
    });
    const units = expandSections([core, one("a"), one("b")], allOn);
    expect(units.filter((u) => u.sectionId).map((u) => u.packId)).toEqual(["a", "b"]);
    expect(units.every((u) => u.sectionId === null || u.heldFor === "core")).toBe(true);
  });
});

describe("expandSections composes through composePacks unchanged", () => {
  /** core owns the kobold; frost patches its speed in a section, colour outside one. */
  function scenario(sectionOn: boolean, band?: "first" | "last") {
    const core: PackContent = {
      manifest: manifest("core"),
      files: { monster: { records: [{ name: "kobold", speed: 110, color: "U" }] } },
    };
    const frost: PackContent = {
      manifest: manifest("frost", {
        dependencies: { core: "*" },
        sections: [{ id: "speed", title: "Speed", ...(band ? { priority: band } : {}) }],
      }),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "color", value: "B" }] },
          sections: {
            speed: { fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 130 }] } },
          },
        },
      },
    };
    const list = expandedPackContents([core, frost], () => sectionOn);
    const game = composePacks(list);
    return game.get("monster")?.get("core:kobold")?.value;
  }

  it("applies a section's patch when it is on", () => {
    expect(scenario(true)).toMatchObject({ speed: 130, color: "B" });
  });

  /* Not "composed and then overridden" - the field keeps core's value, which is
   * what "a disabled section's contributions do not exist" has to mean. */
  it("leaves the field at core's value when the section is off", () => {
    expect(scenario(false)).toMatchObject({ speed: 110, color: "B" });
  });

  it("still composes correctly when the section is banded away from its pack", () => {
    expect(scenario(true, "last")).toMatchObject({ speed: 130, color: "B" });
    expect(scenario(true, "first")).toMatchObject({ speed: 130, color: "B" });
  });

  /* composePacks enforces "you may only modify what you depend on" per entry.
   * A section is a separate entry sharing its pack's manifest, so the check has
   * to keep seeing frost's `dependencies` - if expandSections had synthesised a
   * bare manifest, this would throw. */
  it("keeps the pack's dependency permission on a section's own unit", () => {
    expect(() => scenario(true, "last")).not.toThrow();
  });
});

/**
 * The real entry point. Everything above tests the pre-pass in isolation; this
 * proves the pass is actually WIRED - that a section the player switched off
 * reaches composeContentPacks as absent, not as a contribution that composes and
 * is then overridden. A pre-pass with no caller is the failure this project
 * keeps rediscovering.
 */
describe("composeContentPacks honours the section state", () => {
  function packs(): LoadedPack[] {
    return [
      {
        manifest: manifest("core"),
        files: { monster: { records: [{ name: "kobold", speed: 110, color: "U" }] } },
      },
      {
        manifest: manifest("frost", {
          dependencies: { core: "*" },
          sections: [
            { id: "speed", title: "Speed" },
            { id: "colour", title: "Colour" },
          ],
        }),
        files: {
          monster: {
            sections: {
              speed: {
                fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 130 }] },
              },
              colour: {
                fieldPatches: { "core:kobold": [{ op: "set", path: "color", value: "B" }] },
              },
            },
          },
        },
      },
    ] as unknown as LoadedPack[];
  }

  const kobold = (
    opts?: Parameters<typeof composeContentPacks>[1],
  ): Record<string, unknown> =>
    (composeContentPacks(packs(), opts).records["monster"] as Record<string, unknown>[]).find(
      (r) => r["name"] === "kobold",
    ) as Record<string, unknown>;

  it("applies every section when the caller says nothing about them", () => {
    /* The compatibility ratchet: a host that has never heard of sections must
     * compose each pack whole, exactly as before they existed. */
    expect(kobold()).toMatchObject({ speed: 130, color: "B" });
  });

  it("applies a section the caller marks on", () => {
    expect(kobold({ sections: { frost: { speed: true, colour: true } } })).toMatchObject({
      speed: 130,
      color: "B",
    });
  });

  it("drops ONLY the section that is off, leaving the rest of the mod", () => {
    expect(kobold({ sections: { frost: { speed: false } } })).toMatchObject({
      speed: 110, // core's value: the patch does not exist, it did not lose
      color: "B", // the mod's other part still applies
    });
  });

  it("drops every section when they are all off", () => {
    expect(kobold({ sections: { frost: { speed: false, colour: false } } })).toMatchObject({
      speed: 110,
      color: "U",
    });
  });

  it("ignores a section state naming a pack that is not loaded", () => {
    expect(kobold({ sections: { ghost: { speed: false } } })).toMatchObject({ speed: 130 });
  });

  it("threads the same option through composeDroppingBroken", () => {
    const { composed, dropped } = composeDroppingBroken(packs(), {
      sections: { frost: { speed: false } },
    });
    expect(dropped).toEqual([]);
    const rec = (composed.records["monster"] as Record<string, unknown>[]).find(
      (r) => r["name"] === "kobold",
    );
    expect(rec).toMatchObject({ speed: 110, color: "B" });
  });
});
