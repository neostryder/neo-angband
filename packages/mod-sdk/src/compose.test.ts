import { describe, expect, it } from "vitest";
import { composePacks, mergePatch } from "./compose.js";
import type { PackContent } from "./compose.js";
import { packRef, slugify, validateManifest } from "./manifest.js";
import type { PackManifest } from "./manifest.js";
import { resolveLoadOrder } from "./resolve.js";

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
