import { describe, expect, it } from "vitest";
import { composePacks, mergePatch } from "./compose.js";
import type { PackContent } from "./compose.js";
import { packRef, slugify, validateManifest } from "./manifest.js";
import type { PackManifest } from "./manifest.js";
import type { FieldPatch } from "./patch.js";
import { resolveLoadOrder } from "./resolve.js";

/** An op with `value` where `append` needs `values` - the typo the audit found. */
const APPEND_WITH_VALUE_TYPO = [
  { op: "append", path: "flags", value: ["COLD"] },
] as unknown as FieldPatch;

function manifest(id: string, deps?: Record<string, string>): PackManifest {
  const m: PackManifest = { id, name: id, version: "1.0.0", shape: "content" };
  if (deps) m.dependencies = deps;
  return m;
}

const core: PackContent = {
  manifest: manifest("core"),
  files: {
    monster: {
      records: [
        { name: "Kobold", hp: 8, flags: ["EVIL"], blows: [{ method: "HIT" }] },
        { name: "Grip, Farmer Maggot's Dog", hp: 5 },
      ],
    },
  },
};

describe("manifest", () => {
  it("validates and rejects", () => {
    expect(() => validateManifest(manifest("my-pack"))).not.toThrow();
    expect(() => validateManifest({ ...manifest("Bad_ID") })).toThrow();
    expect(() =>
      validateManifest({ ...manifest("ok"), version: "1.0" }),
    ).toThrow();
    expect(() =>
      validateManifest({ ...manifest("ok"), shape: "weird" }),
    ).toThrow();
  });

  it("validates affectsGameplay exactly as the optional boolean manifest flags", () => {
    expect(validateManifest({ ...manifest("gameplay"), affectsGameplay: true }).affectsGameplay).toBe(true);
    expect(validateManifest({ ...manifest("cosmetic"), affectsGameplay: false }).affectsGameplay).toBe(false);
    expect(() => validateManifest({ ...manifest("bad-gameplay"), affectsGameplay: "yes" })).toThrow(
      /affectsGameplay must be a boolean/,
    );
  });

  it("validates retired rule flags against this manifest's current rules", () => {
    const withRename = (renamedRuleFlags: unknown): unknown => ({
      ...manifest("bug-fixes"),
      rules: [{ flag: "bug-fixes.class", title: "Class", description: "", default: true }],
      renamedRuleFlags,
    });
    expect(
      validateManifest(
        withRename({
          "bug-fixes.atomic-a": "bug-fixes.class",
          "bug-fixes.atomic-b": "bug-fixes.class",
        }),
      ).renamedRuleFlags,
    ).toEqual({
      "bug-fixes.atomic-a": "bug-fixes.class",
      "bug-fixes.atomic-b": "bug-fixes.class",
    });
    expect(() => validateManifest(withRename([]))).toThrow(/renamedRuleFlags must be a map/);
    expect(() => validateManifest(withRename({ "bug-fixes.atomic-a": "" }))).toThrow(
      /must name a non-empty current rule flag/,
    );
    expect(() => validateManifest(withRename({ "bug-fixes.atomic-a": "bug-fixes.gone" }))).toThrow(
      /not a declared rule/,
    );
    expect(() => validateManifest(withRename({ "bug-fixes.class": "bug-fixes.class" }))).toThrow(
      /cannot rename a flag to itself/,
    );
  });

  /*
   * description is the prose the in-app mod manager puts in front of the player
   * when they highlight a mod, so it has to survive validation as-is (it is
   * carried, not re-built) and be rejected when it is not text.
   */
  it("carries the human description through, and rejects a non-string one", () => {
    const text = "Adds a frost realm: new monsters, a new depth band, and two vaults.";
    expect(validateManifest({ ...manifest("frost"), description: text }).description).toBe(text);
    expect(validateManifest(manifest("plain")).description).toBeUndefined();
    expect(() => validateManifest({ ...manifest("bad-desc"), description: 42 })).toThrow(
      /description must be a string/,
    );
  });

  /*
   * `tilePacks` was read loosely off the raw JSON and was not in the schema at all,
   * so a typo produced no error - the entry was skipped and the mod author saw a
   * Graphics row that never appeared. These pin the fields the tile discovery
   * actually reads.
   */
  it("validates a tilePacks entry, and names the field when it is wrong", () => {
    const withPacks = (packs: unknown): unknown => ({
      ...manifest("art"),
      shape: "tiles",
      tilePacks: packs,
    });
    expect(
      validateManifest(
        withPacks([
          { grafID: 101, engine: "linoleum", menuname: "Hand-drawn", path: "my-set" },
          { grafID: 3 },
        ]),
      ).tilePacks,
    ).toHaveLength(2);
    expect(() => validateManifest(withPacks({}))).toThrow(/tilePacks must be an array/);
    expect(() => validateManifest(withPacks(["x"]))).toThrow(/must be an object/);
    expect(() => validateManifest(withPacks([{}]))).toThrow(/grafID must be a/);
    expect(() => validateManifest(withPacks([{ grafID: 1.5 }]))).toThrow(/grafID/);
    expect(() =>
      validateManifest(withPacks([{ grafID: 1, engine: "sprites" }])),
    ).toThrow(/engine must be one of tilesheet, linoleum/);
    expect(() =>
      validateManifest(withPacks([{ grafID: 1, menuname: 7 }])),
    ).toThrow(/menuname must be a string/);
  });

  it("validates an on-demand Linoleum tilesheet declaration", () => {
    const source = {
      key: "old",
      packId: "linoleum-old",
      displayName: "Old tiles",
      cacheKey: "v1",
      image: "source/8x8.png",
      prefFiles: ["source/graf-xxx.prf"],
      resolution: 8,
    };
    const withSource = (tilePacks: unknown): unknown => ({
      ...manifest("art"),
      shape: "tiles",
      tilePacks,
    });
    const value = validateManifest(
      withSource([{ grafID: 101, engine: "linoleum", path: "old", tilesheet: source }]),
    );
    expect(value.tilePacks?.[0]?.tilesheet).toEqual(source);
    expect(() =>
      validateManifest(withSource([{ grafID: 101, tilesheet: { ...source, image: "../8x8.png" } }])),
    ).toThrow(/tilesheet files/);
    expect(() =>
      validateManifest(withSource([{ grafID: 101, tilesheet: { ...source, prefFiles: [] } }])),
    ).toThrow(/prefFiles/);
  });

  /*
   * The old form of `path` was a site-root-relative URL base, which only a mod
   * compiled into the app could know. Refused at the edge now, because unconverted
   * it resolves to mods/<id>/mods/<id>/... - a 404, and ASCII with nothing said.
   */
  it("refuses a tilePacks path that is not relative to the mod folder", () => {
    const withPath = (path: unknown): unknown => ({
      ...manifest("art"),
      shape: "tiles",
      tilePacks: [{ grafID: 101, path }],
    });
    expect(validateManifest(withPath("tiles/my-set")).tilePacks?.[0]?.path).toBe(
      "tiles/my-set",
    );
    for (const bad of ["/mods/art/tiles", "https://cdn.example/tiles", "\\mods\\art"]) {
      expect(() => validateManifest(withPath(bad)), bad).toThrow(/must be relative/);
    }
    expect(() => validateManifest(withPath("../other-mod/tiles"))).toThrow(
      /stay inside the mod folder/,
    );
    expect(() => validateManifest(withPath(3))).toThrow(/path must be a string/);
  });

  it("slugs names into stable refs", () => {
    expect(slugify("Grip, Farmer Maggot's Dog")).toBe(
      "grip-farmer-maggot-s-dog",
    );
    expect(packRef("core", "Kobold")).toBe("core:kobold");
  });
});

describe("resolveLoadOrder", () => {
  it("orders dependencies first, breaking ties by the caller's input order", () => {
    const order = resolveLoadOrder([
      manifest("core"),
      manifest("zeta", { core: "*" }),
      manifest("alpha", { core: "*" }),
      manifest("bridge", { alpha: "*", zeta: "*" }),
    ]).map((m) => m.id);
    expect(order).toEqual(["core", "zeta", "alpha", "bridge"]);
  });

  it("rejects missing deps, duplicates, and cycles", () => {
    expect(() =>
      resolveLoadOrder([manifest("a", { ghost: "*" })]),
    ).toThrow(/missing pack ghost/);
    expect(() =>
      resolveLoadOrder([manifest("a"), manifest("a")]),
    ).toThrow(/duplicate/);
    expect(() =>
      resolveLoadOrder([manifest("a", { b: "*" }), manifest("b", { a: "*" })]),
    ).toThrow(/cycle/);
  });
});

describe("mergePatch", () => {
  it("merges objects, replaces arrays and scalars, null deletes", () => {
    const merged = mergePatch(
      { a: 1, nest: { x: 1, y: 2 }, list: [1, 2], gone: "bye" },
      { a: 2, nest: { y: 3 }, list: [9], gone: null },
    );
    expect(merged).toEqual({ a: 2, nest: { x: 1, y: 3 }, list: [9] });
  });
});

describe("composePacks", () => {
  it("adds, patches, replaces, and removes with provenance", () => {
    const mod: PackContent = {
      manifest: manifest("frost", { core: "*" }),
      files: {
        monster: {
          records: [{ name: "Frost Wyrm", hp: 400 }],
          patches: { "core:kobold": { hp: 12, flags: ["EVIL", "COLD"] } },
          removes: ["core:grip-farmer-maggot-s-dog"],
        },
      },
    };
    const game = composePacks([core, mod]);
    const monsters = game.get("monster");
    expect(monsters).toBeDefined();
    if (!monsters) return;

    expect([...monsters.keys()]).toEqual(["core:kobold", "frost:frost-wyrm"]);
    const kobold = monsters.get("core:kobold");
    expect(kobold?.value["hp"]).toBe(12);
    expect(kobold?.value["flags"]).toEqual(["EVIL", "COLD"]);
    expect(kobold?.value["blows"]).toEqual([{ method: "HIT" }]);
    expect(kobold?.owner).toBe("core");
    expect(kobold?.modifiedBy).toEqual(["frost"]);
    expect(monsters.get("frost:frost-wyrm")?.owner).toBe("frost");
  });

  it("total conversion: replacing core wholesale is supported", () => {
    const tc: PackContent = {
      manifest: manifest("total", { core: "*" }),
      files: {
        monster: {
          replaces: { "core:kobold": { name: "Kobold", hp: 999 } },
          removes: ["core:grip-farmer-maggot-s-dog"],
        },
      },
    };
    const monsters = composePacks([core, tc]).get("monster");
    expect(monsters?.size).toBe(1);
    expect(monsters?.get("core:kobold")?.value["hp"]).toBe(999);
    expect(monsters?.get("core:kobold")?.value["flags"]).toBeUndefined();
  });

  it("enforces the dependency-ownership rule", () => {
    const sneaky: PackContent = {
      manifest: manifest("sneaky"), // no dependency on core declared
      files: { monster: { patches: { "core:kobold": { hp: 1 } } } },
    };
    expect(() => composePacks([core, sneaky])).toThrow(
      /without declaring core/,
    );
  });

  it("applies field patches in load order after coarse patches", () => {
    const a: PackContent = {
      manifest: manifest("a", { core: "*" }),
      files: {
        monster: {
          fieldPatches: {
            "core:kobold": [
              { op: "add", path: "hp", value: 4 },
              { op: "addFlag", path: "flags", flag: "COLD" },
            ],
          },
        },
      },
    };
    const b: PackContent = {
      manifest: manifest("b", { core: "*" }),
      files: {
        monster: {
          fieldPatches: {
            "core:kobold": [{ op: "mul", path: "hp", value: 2 }],
          },
        },
      },
    };
    const kobold = composePacks([core, a, b]).get("monster")?.get("core:kobold");
    // 8 (+4 from a) = 12, then (*2 from b) = 24; load order a before b.
    expect(kobold?.value["hp"]).toBe(24);
    expect(kobold?.value["flags"]).toEqual(["EVIL", "COLD"]);
    expect(kobold?.value["blows"]).toEqual([{ method: "HIT" }]);
    expect(kobold?.modifiedBy).toEqual(["a", "b"]);
  });

  it("field patches obey ownership and existence rules", () => {
    const sneaky: PackContent = {
      manifest: manifest("sneaky"), // no dependency on core declared
      files: {
        monster: { fieldPatches: { "core:kobold": [{ op: "add", path: "hp", value: 1 }] } },
      },
    };
    expect(() => composePacks([core, sneaky])).toThrow(/without declaring core/);

    const missing: PackContent = {
      manifest: manifest("missing", { core: "*" }),
      files: {
        monster: { fieldPatches: { "core:nope": [{ op: "add", path: "hp", value: 1 }] } },
      },
    };
    expect(() => composePacks([core, missing])).toThrow(/does not exist/);
  });

  it("rejects unknown targets and duplicate adds", () => {
    const bad: PackContent = {
      manifest: manifest("bad", { core: "*" }),
      files: { monster: { patches: { "core:nope": { hp: 1 } } } },
    };
    expect(() => composePacks([core, bad])).toThrow(/does not exist/);

    const dup: PackContent = {
      manifest: manifest("dup", { core: "*" }),
      files: {
        monster: { records: [{ name: "Same" }, { name: "Same" }] },
      },
    };
    expect(() => composePacks([core, dup])).toThrow(/duplicate record/);
  });
});

/**
 * THE CLAIM: an engine release that renames one record must not cost a mod
 * everything else it does.
 *
 * The throwing default is right for a mod's own build - the author is there, and
 * a silent no-op is worse than a failed build. It is wrong for a player's game,
 * because `composeDroppingBroken` answers a throw by removing the whole pack, so
 * the same ComposeError that tells an author "fix line 12" tells a player "your
 * mod is gone". These tests pin the second behaviour, since the first has been
 * covered since composePacks was written.
 */
describe("composePacks with an onRefuse reporter: one bad op costs that op", () => {
  /** Every refusal, as (packId, why) pairs. */
  function refusing(): { onRefuse: (id: string, why: string) => void; seen: string[][] } {
    const seen: string[][] = [];
    return { onRefuse: (id, why) => void seen.push([id, why]), seen };
  }

  it("keeps every op that CAN be honoured when one cannot", () => {
    const { onRefuse, seen } = refusing();
    const mod: PackContent = {
      manifest: manifest("frost", { core: "*" }),
      files: {
        monster: {
          records: [{ name: "Ice Kobold", hp: 7 }],
          fieldPatches: {
            "core:kobold": [{ op: "set", path: "speed", value: 120 }],
            "core:renamed-away": [{ op: "set", path: "speed", value: 1 }],
          },
        },
      },
    };
    const table = composePacks([core, mod], { onRefuse }).get("monster");

    expect(seen).toEqual([["frost", expect.stringContaining("core:renamed-away")]]);
    expect(seen[0]?.[1]).toContain("may have been renamed");
    /* The two survivors are the whole point: the mod's own new monster is in the
     * game, and its patch to the record that DOES still exist took effect. */
    expect(table?.get("frost:ice-kobold")?.value["hp"]).toBe(7);
    expect(table?.get("core:kobold")?.value["speed"]).toBe(120);
  });

  it("names the pack separately from the sentence, so a host can put it on a row", () => {
    const { onRefuse, seen } = refusing();
    composePacks(
      [core, { manifest: manifest("rude"), files: { monster: { patches: { "core:kobold": { hp: 1 } } } } }],
      { onRefuse },
    );
    expect(seen[0]?.[0]).toBe("rude");
    expect(seen[0]?.[1]).toContain("does not declare core as a dependency");
  });

  it("skips only the offending record for a duplicate or nameless add", () => {
    const { onRefuse, seen } = refusing();
    const mod: PackContent = {
      manifest: manifest("sloppy", { core: "*" }),
      files: {
        monster: {
          records: [{ name: "Twin", hp: 1 }, { name: "Twin", hp: 2 }, { hp: 3 }, { name: "Fine", hp: 4 }],
        },
      },
    };
    const table = composePacks([core, mod], { onRefuse }).get("monster");
    expect(seen).toHaveLength(2);
    /* First Twin wins, not last: two records with one name inside ONE pack is
     * that pack's own bug, not a load-order question, and there is no later mod
     * for "later wins" to prefer. */
    expect(table?.get("sloppy:twin")?.value["hp"]).toBe(1);
    expect(table?.get("sloppy:fine")?.value["hp"]).toBe(4);
  });

  it("still throws when nobody is listening, so a mod's build fails loudly", () => {
    const bad: PackContent = {
      manifest: manifest("bad", { core: "*" }),
      files: { monster: { patches: { "core:nope": { hp: 1 } } } },
    };
    expect(() => composePacks([core, bad])).toThrow(/does not exist/);
    expect(() => composePacks([core, bad], {})).toThrow(/does not exist/);
  });

  /**
   * A MALFORMED fieldPatch OP degrades the same way a target that does not
   * exist does. Until this fix, `applyFieldPatch` (patch.ts) was the one
   * caller in this file whose throw did not go through `refuse` - a
   * `PatchError` from a target of the wrong shape, or a bare TypeError from an
   * `append` op written with `value` instead of `values`, propagated straight
   * out of `composePacks`. Reachable only through `composeDroppingBroken`
   * (loader.ts), that meant the whole pack was dropped when the message could
   * be pinned on it and EVERY installed mod was dropped when it could not,
   * since a raw TypeError names no pack.
   */
  it("costs only the malformed op, not the whole pack", () => {
    const { onRefuse, seen } = refusing();
    const mod: PackContent = {
      manifest: manifest("clumsy", { core: "*" }),
      files: {
        monster: {
          records: [{ name: "Ice Kobold", hp: 7 }],
          fieldPatches: {
            "core:kobold": APPEND_WITH_VALUE_TYPO,
          },
        },
      },
    };
    const table = composePacks([core, mod], { onRefuse }).get("monster");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe("clumsy");
    expect(seen[0]?.[1]).toContain("core:kobold");
    /* The mod's own new monster still made it in, and core's kobold is
     * exactly as it was - the failed op left no partial write behind. */
    expect(table?.get("clumsy:ice-kobold")?.value["hp"]).toBe(7);
    expect(table?.get("core:kobold")?.value["flags"]).toEqual(["EVIL"]);
  });

  it("still throws a malformed op when nobody is listening", () => {
    const mod: PackContent = {
      manifest: manifest("clumsy", { core: "*" }),
      files: {
        monster: {
          fieldPatches: {
            "core:kobold": APPEND_WITH_VALUE_TYPO,
          },
        },
      },
    };
    expect(() => composePacks([core, mod])).toThrow(/needs a "values" array/);
  });
});

describe("payload: which of a repository's files ARE the mod", () => {
  const withPayload = (payload: unknown): unknown => ({
    ...manifest("qol"),
    payload,
  });

  it("takes files, archives, or both", () => {
    expect(
      (validateManifest(withPayload({ files: ["manifest.json", "plugin.js"] })) as PackManifest)
        .payload?.files,
    ).toEqual(["manifest.json", "plugin.js"]);
    expect(
      (validateManifest(withPayload({ archives: ["packs/a.zip"] })) as PackManifest)
        .payload?.archives,
    ).toEqual(["packs/a.zip"]);
    expect(() =>
      validateManifest(withPayload({ files: ["manifest.json"], archives: ["p.zip"] })),
    ).not.toThrow();
  });

  it("is optional - a repository that says nothing still installs", () => {
    /* The installer falls back to the whole tree minus build scaffolding, which
     * is right for a third-party mod that has never heard of this field. */
    expect(validateManifest(manifest("qol")).payload).toBeUndefined();
  });

  it("rejects a payload that names nothing, rather than reading it as 'guess'", () => {
    /* Absent and empty mean opposite things, and only one of them is what an
     * author who typed the field wanted. */
    expect(() => validateManifest(withPayload({}))).toThrow(/payload names no files/);
    expect(() => validateManifest(withPayload({ files: [] }))).toThrow(
      /payload names no files/,
    );
    expect(() =>
      validateManifest(withPayload({ files: [], archives: [] })),
    ).toThrow(/payload names no files/);
  });

  it("rejects the shapes that would fail later, with the mod's id", () => {
    expect(() => validateManifest(withPayload([]))).toThrow(
      /manifest qol: payload must be an object/,
    );
    expect(() => validateManifest(withPayload("plugin.js"))).toThrow(
      /payload must be an object/,
    );
    expect(() => validateManifest(withPayload({ files: "plugin.js" }))).toThrow(
      /payload\.files must be an array/,
    );
    expect(() => validateManifest(withPayload({ files: [1] }))).toThrow(
      /payload\.files entries must be non-empty strings/,
    );
    expect(() => validateManifest(withPayload({ archives: [""] }))).toThrow(
      /payload\.archives entries must be non-empty strings/,
    );
  });
});

/**
 * THE SHAPE GUARD, on the two write paths the end-to-end tests do not reach.
 *
 * `packages/web/src/mod-shape.node.test.ts` measures this through the real
 * composer against the real core pack and the real store binder, which is where
 * the defect was found and where the cost of it is visible. It only exercises
 * `fieldPatches`. `patches` and `replaces` reach the same guard by a different
 * route - `replaces` computes its changed keys as the UNION of the old and new
 * records, which is a different question - and "the same helper" is an argument,
 * not a measurement.
 *
 * These use the `monster` fixture above because core's monster blueprint is
 * real: `flags` is measured as an array on 595 of core's 624 monsters, so a
 * patch writing a number over it is refusable without inventing a schema for
 * the test. `blows` and `hp` are NOT usable for this, and that is worth knowing -
 * core spells them differently, so the blueprint has no entry for either name
 * and the guard correctly says nothing about them.
 */
describe("composePacks: a patch cannot make a field unreadable", () => {
  const refusals = (): { refused: string[]; onRefuse: (id: string, why: string) => void } => {
    const refused: string[] = [];
    return { refused, onRefuse: (id, why) => refused.push(`${id}: ${why}`) };
  };

  it("refuses a `patches` body that writes a scalar over a list", () => {
    const r = refusals();
    const mod: PackContent = {
      manifest: manifest("break", { core: "*" }),
      files: { monster: { patches: { "core:kobold": { flags: 3 } } } },
    };
    const kobold = composePacks([core, mod], { onRefuse: r.onRefuse })
      .get("monster")!
      .get("core:kobold")!;

    expect(r.refused.length).toBe(1);
    expect(r.refused[0]).toContain("break:");
    expect(r.refused[0]).toContain("`flags` is number");
    /* Put BACK, not dropped: the record is still the one the game can read. */
    expect(kobold.value["flags"]).toEqual(["EVIL"]);
  });

  it("lets the rest of the same patch through", () => {
    const r = refusals();
    const mod: PackContent = {
      manifest: manifest("break", { core: "*" }),
      files: { monster: { patches: { "core:kobold": { flags: 3, hp: 12 } } } },
    };
    const kobold = composePacks([core, mod], { onRefuse: r.onRefuse })
      .get("monster")!
      .get("core:kobold")!;
    expect(r.refused.length).toBe(1);
    expect(kobold.value["hp"]).toBe(12);
    expect(kobold.value["flags"]).toEqual(["EVIL"]);
  });

  it("still lets a total conversion DROP a list field", () => {
    /* The reason an absent field is not refused. `replaces` swaps the whole
     * record, and a monster rewritten as `{name, hp}` legitimately has no
     * `flags` - so a guard that put an absent field back would silently undo
     * the feature compose.test.ts asserts two describes up. */
    const r = refusals();
    const tc: PackContent = {
      manifest: manifest("total", { core: "*" }),
      files: { monster: { replaces: { "core:kobold": { name: "Kobold", hp: 999 } } } },
    };
    const kobold = composePacks([core, tc], { onRefuse: r.onRefuse })
      .get("monster")!
      .get("core:kobold")!;
    expect(r.refused).toEqual([]);
    expect(kobold.value["hp"]).toBe(999);
    expect(kobold.value["blows"]).toBeUndefined();
    expect(kobold.value["flags"]).toBeUndefined();
  });

  it("refuses a `replaces` body that writes a scalar over a list", () => {
    /* Dropping the field is the mod's business; writing something unreadable
     * into it is not. */
    const r = refusals();
    const tc: PackContent = {
      manifest: manifest("total", { core: "*" }),
      files: { monster: { replaces: { "core:kobold": { name: "Kobold", flags: "EVIL" } } } },
    };
    const kobold = composePacks([core, tc], { onRefuse: r.onRefuse })
      .get("monster")!
      .get("core:kobold")!;
    expect(r.refused.length).toBe(1);
    expect(r.refused[0]).toContain("`flags` is string");
    /* Restored from what the record had BEFORE the replace, which is core's. */
    expect(kobold.value["flags"]).toEqual(["EVIL"]);
  });

  it("says nothing about a file core does not ship, or a field core does not have", () => {
    /* No blueprint means nothing to contradict, and a mod's own field is the
     * mod's to shape - which is the whole reason the guard reads core's
     * measurement rather than a schema of its own. */
    const r = refusals();
    const mod: PackContent = {
      manifest: manifest("odd", { core: "*" }),
      files: {
        monster: { patches: { "core:kobold": { "odd:mood": "grumpy" } } },
        "odd:extra": { records: [{ name: "Thing", whatever: 3 }] },
      },
    };
    composePacks([core, mod], { onRefuse: r.onRefuse });
    expect(r.refused).toEqual([]);
  });
});
