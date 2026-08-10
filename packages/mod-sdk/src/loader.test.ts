import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeContentPacks } from "./loader.js";
import type { LoadedPack } from "./loader.js";
import type { PackManifest } from "./manifest.js";
import { PROVENANCE_KEY } from "./provenance.js";

function manifest(id: string, deps?: Record<string, string>): PackManifest {
  const m: PackManifest = { id, name: id, version: "1.0.0", shape: "content" };
  if (deps) m.dependencies = deps;
  return m;
}

/** A minimal core pack: named monster records, an index-keyed file, a singleton. */
function corePack(): LoadedPack {
  return {
    manifest: manifest("core"),
    files: {
      monster: {
        records: [
          { name: "Kobold", hp: 8, flags: ["EVIL"] },
          { name: "Grip, Farmer Maggot's Dog", hp: 5 },
        ],
      },
      /* No `name`, but record-key.ts declares `section` as its identity, so
       * every record has a ref of its own and the file merges per record. */
      names: { records: [{ section: 2, word: ["foo", "bar"] }] },
      /* A config singleton: the FILE is the identity, the host binds one, so
       * "ships constants.json" means "use mine" - whole-file passthrough. */
      constants: { records: [{ "level-max": [{ label: "monsters", value: 1024 }] }] },
    },
  };
}

describe("composeContentPacks", () => {
  it("is record-identical (by reference and order) for the base game alone", () => {
    const core = corePack();
    const composed = composeContentPacks([core]);

    // Same objects, same order - routing pack zero through compose is a no-op.
    expect(composed.records["monster"]).toEqual(core.files["monster"]?.records);
    expect(composed.records["monster"]?.[0]).toBe(
      core.files["monster"]?.records?.[0],
    );
    expect(composed.records["monster"]?.[1]).toBe(
      core.files["monster"]?.records?.[1],
    );
    expect(composed.composedFiles).toContain("monster");
    expect(composed.passthroughFiles).toContain("constants");
  });

  it("adds a mod's new records after core's, in load order", () => {
    const mod: LoadedPack = {
      manifest: manifest("beasts", { core: "*" }),
      files: { monster: { records: [{ name: "Frost Wyrm", hp: 400 }] } },
    };
    const composed = composeContentPacks([mod, corePack()]); // deliberately mod-first
    const names = (composed.records["monster"] as { name: string }[]).map(
      (m) => m.name,
    );
    expect(names).toEqual(["Kobold", "Grip, Farmer Maggot's Dog", "Frost Wyrm"]);
  });

  it("applies a mod's coarse patch to a core record", () => {
    const mod: LoadedPack = {
      manifest: manifest("buff", { core: "*" }),
      files: { monster: { patches: { "core:kobold": { hp: 99 } } } },
    };
    const composed = composeContentPacks([corePack(), mod]);
    const kobold = (composed.records["monster"] as { name: string; hp: number }[]).find(
      (m) => m.name === "Kobold",
    );
    expect(kobold?.hp).toBe(99);
  });

  it("applies a mod's field patch to a core record", () => {
    const mod: LoadedPack = {
      manifest: manifest("tweak", { core: "*" }),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "add", path: "hp", value: 5 }] },
        },
      },
    };
    const composed = composeContentPacks([corePack(), mod]);
    const kobold = (composed.records["monster"] as { name: string; hp: number }[]).find(
      (m) => m.name === "Kobold",
    );
    expect(kobold?.hp).toBe(13); // 8 + 5
  });

  it("applies a mod's removal of a core record", () => {
    const mod: LoadedPack = {
      manifest: manifest("cull", { core: "*" }),
      files: { monster: { removes: ["core:grip-farmer-maggot-s-dog"] } },
    };
    const composed = composeContentPacks([corePack(), mod]);
    const names = (composed.records["monster"] as { name: string }[]).map(
      (m) => m.name,
    );
    expect(names).toEqual(["Kobold"]);
  });

  it("passes a config singleton through last-in-load-order-wins", () => {
    const mod: LoadedPack = {
      manifest: manifest("deeper", { core: "*" }),
      files: {
        constants: { records: [{ "level-max": [{ label: "monsters", value: 2048 }] }] },
      },
    };
    const composed = composeContentPacks([corePack(), mod]);
    expect(composed.records["constants"]).toEqual([
      {
        "level-max": [{ label: "monsters", value: 2048 }],
        /* The whole file is the mod's now, so the record says so. */
        [PROVENANCE_KEY]: { owner: "deeper" },
      },
    ]);
    expect(composed.passthroughFiles).toContain("constants");
  });

  it("adds to a file whose identity is not `name` at all", () => {
    /* THE CHANGE OF 2026-08-08, at its smallest. `names` records carry no
     * `name`; their identity is the section index, declared in record-key.ts.
     * Under the old rule that made the whole file whole-file, so a mod shipping
     * one random-name section discarded core's. Now it adds one. */
    const mod: LoadedPack = {
      manifest: manifest("renamer", { core: "*" }),
      files: { names: { records: [{ section: 7, word: ["zap"] }] } },
    };
    const composed = composeContentPacks([corePack(), mod]);
    expect(composed.problems).toEqual([]);
    expect(composed.composedFiles).toContain("names");
    expect((composed.records["names"] as { section: number }[]).map((r) => r.section))
      .toEqual([2, 7]);
  });

  it("falls back to passthrough (no throw) when record names collide", () => {
    const dupCore: LoadedPack = {
      manifest: manifest("core"),
      files: {
        object: {
          records: [
            { name: "Torch", tval: "light" },
            { name: "Torch", tval: "light" }, // colliding slug
          ],
        },
      },
    };
    const composed = composeContentPacks([dupCore]);
    expect(composed.passthroughFiles).toContain("object");
    expect(composed.records["object"]).toHaveLength(2);
  });

  it("reports no problems for the base game alone", () => {
    expect(composeContentPacks([corePack()]).problems).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Per-record ops on PASSTHROUGH files (the 20 whose records are not
 * name-keyed). Before 2026-07-29 every op below was silently dropped.
 * ------------------------------------------------------------------ */

/**
 * A core pack made only of passthrough-shaped files, one per bucket:
 *  - `store`  keyed by the STORE_* code (a declared non-name key)
 *  - `constants` a config singleton, keyed by the file
 *  - `object` name-keyed, holding both a "*starred*" pair (addressable since the
 *    key stopped dropping the mark) and a genuinely duplicated name (not)
 *  - `ego_item` repeated names separated by a declared discriminator
 *  - `history` no per-record identity at all
 */
function passthroughCore(): LoadedPack {
  return {
    manifest: manifest("core"),
    files: {
      store: {
        records: [
          { store: "STORE_GENERAL", slots: { min: 0, max: 4 }, turnover: 9 },
          { store: "STORE_ARMOR", slots: { min: 6, max: 18 }, turnover: 9 },
        ],
      },
      constants: { records: [{ "level-max": [{ label: "monsters", value: 1024 }] }] },
      object: {
        records: [
          /* The "*" pair used to be one ambiguous ref; as of 2026-08-08 the key
           * spells the mark out, so both are addressable and the pair is now a
           * regression test for that rather than an ambiguity fixture. */
          { type: "scroll", name: "Acquirement", cost: 900 },
          { type: "scroll", name: "*Acquirement*", cost: 5000 },
          { type: "scroll", name: "Word of Recall", cost: 150 },
          /* Genuinely indistinguishable: same type, same name, and `object`
           * declares no discriminator. Nothing can address either one, which is
           * the case the loader must still report rather than guess at. */
          { type: "scroll", name: "Deep Descent", cost: 150 },
          { type: "scroll", name: "Deep Descent", cost: 200 },
        ],
      },
      /* Same name, different item types - the shape core really ships (23 ego
       * names cover 51 records). The base ref is ambiguous and the
       * discriminated refs are not. */
      ego_item: {
        records: [
          { name: "of Acid", type: ["sword", "polearm"], cost: 5000 },
          { name: "of Acid", type: ["shot", "arrow"], cost: 50 },
        ],
      },
      history: {
        records: [{ chart: { chart: 1, next: 2, roll: 10 }, phrase: ["You are "] }],
      },
    },
  };
}

function recordsOf(
  composed: ReturnType<typeof composeContentPacks>,
  file: string,
): Record<string, unknown>[] {
  return composed.records[file] as Record<string, unknown>[];
}

/* ------------------------------------------------------------------ *
 * The classification, over the pack the game actually ships. Every
 * fixture above is a shape someone chose; this one is the data.
 * ------------------------------------------------------------------ */

describe("the shipped pack", () => {
  const packDir = new URL("../../content/pack/", import.meta.url);

  function shippedCore(): LoadedPack {
    const files: Record<string, { records: unknown[] }> = {};
    for (const f of readdirSync(packDir)) {
      if (!f.endsWith(".json")) continue;
      const raw: unknown = JSON.parse(readFileSync(new URL(f, packDir), "utf8"));
      const records = Array.isArray(raw) ? raw : (raw as { records?: unknown[] }).records;
      if (!Array.isArray(records) || records.length === 0) continue;
      files[f.replace(/\.json$/, "")] = { records };
    }
    return { manifest: manifest("core"), files } as unknown as LoadedPack;
  }

  it("merges 41 of its 44 record files per record, and composes cleanly alone", () => {
    const composed = composeContentPacks([shippedCore()]);
    expect(composed.composedFiles.length + composed.passthroughFiles.length).toBe(44);
    /* Named rather than counted: a count would still pass if a DIFFERENT file
     * fell out of phase 1, and the three left are left for three different
     * reasons - two config singletons and one file with no identity at all. */
    expect(composed.passthroughFiles).toEqual(["constants", "history", "visuals"]);
    expect(composed.problems).toEqual([]);
  });

  it("takes a new object, ego and vault WITHOUT discarding the base game's", () => {
    /* THE MEASUREMENT THIS CHANGE EXISTS FOR. Before 2026-08-08 each of these
     * three lines replaced its whole file: 375, 107 and 162 records gone for
     * adding one. Asserted against the real pack because the collisions that
     * caused it are core's own data, not a fixture's. */
    const core = shippedCore();
    const mod = {
      manifest: manifest("sludge", { core: "*" }),
      files: {
        object: {
          records: [
            { name: "& Sludge Dagger~", type: "sword", graphics: { glyph: "|", color: "W" } },
          ],
        },
        ego_item: { records: [{ name: "of Sludge", type: ["sword"], cost: 400 }] },
        vault: { records: [{ name: "Sludge pit", type: "Lesser vault", rows: 1, columns: 1 }] },
      },
    } as unknown as LoadedPack;
    const composed = composeContentPacks([core, mod]);
    expect(composed.problems).toEqual([]);
    for (const file of ["object", "ego_item", "vault"]) {
      const before = (core.files[file]?.records ?? []).length;
      expect(composed.records[file], file).toHaveLength(before + 1);
    }
  });

  it("resolves a legacy ref to the record that owns the name, starred or not", () => {
    /* The rule is CONDITIONAL on core's data, which is easy to state wrongly:
     * core ships no plain "Destruction", so *Destruction* keeps its pre-mark
     * alias and an old ref still lands on it; core DOES ship a plain
     * "Acquirement", so the same-looking ref reaches the plain scroll instead.
     *
     * What this test PROVES is the lookup order - the table before the alias
     * map - which holds whether or not the shadow rule exists. The rule's own
     * discriminating case is the next test. */
    const core = shippedCore();
    const mod = {
      manifest: {
        ...manifest("sludge", { core: "*" }),
        fields: [{ name: "mark", files: ["object"], type: "string" }],
      },
      files: {
        object: {
          fieldPatches: {
            "core:scroll--destruction": [{ op: "set", path: "sludge:mark", value: "legacy" }],
            "core:scroll--acquirement": [{ op: "set", path: "sludge:mark", value: "plain" }],
          },
        },
      },
    } as unknown as LoadedPack;
    const composed = composeContentPacks([core, mod]);
    expect(composed.problems).toEqual([]);

    const hit = (mark: string): { name?: string } | undefined =>
      (composed.records["object"] as { name?: string; "sludge:mark"?: string }[]).find(
        (r) => r["sludge:mark"] === mark,
      );
    expect(hit("legacy")?.name).toBe("*Destruction*");
    expect(hit("plain")?.name).toBe("Acquirement");
  });

  it("does not hand a removed record's name to the starred record behind it", () => {
    /* THE SHADOW RULE'S OWN CASE - the ONE arrangement where dropping the alias
     * changes an answer, and it took two failed attempts to find it.
     *
     * Lookup order (table before aliases) already means a live record wins its
     * own name, and `table.has` already blocks the alias when the plain record
     * is DECLARED FIRST - which is how core's object.json happens to be
     * written, so the shipped pack never reaches this. What reaches it is a pack
     * that declares the starred form first AND a later pack that removes the
     * plain one: without `primary.has(k)`, "scroll--acquirement" would then be
     * live on *Acquirement* and the patch would silently land on the wrong
     * scroll. Registering the alias is what must not happen; refusing the ref
     * afterwards would be too late, because there would be nothing to refuse.
     *
     * Control RUN, not assumed: commenting out `primary.has(k)` in compose.ts
     * makes this fail and nothing else. */
    const starredFirst = {
      manifest: manifest("core"),
      files: {
        object: {
          records: [
            { type: "scroll", name: "*Acquirement*", cost: 5000 },
            { type: "scroll", name: "Acquirement", cost: 900 },
          ],
        },
      },
    } as unknown as LoadedPack;
    const strip = {
      manifest: manifest("strip", { core: "*" }),
      files: { object: { removes: ["core:scroll--acquirement"] } },
    } as unknown as LoadedPack;
    const patch = {
      manifest: {
        ...manifest("sludge", { core: "*", strip: "*" }),
        fields: [{ name: "mark", files: ["object"], type: "string" }],
      },
      files: {
        object: {
          fieldPatches: {
            "core:scroll--acquirement": [{ op: "set", path: "sludge:mark", value: "x" }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([starredFirst, strip, patch]);
    const records = composed.records["object"] as {
      name: string;
      "sludge:mark"?: string;
    }[];
    /* The starred scroll survived the removal, untouched, and the ref that used
     * to name the plain one now names nothing rather than naming it. */
    expect(records.map((r) => r.name)).toEqual(["*Acquirement*"]);
    expect(records[0]?.["sludge:mark"]).toBeUndefined();
    expect(composed.problems.join(" | ")).toContain(
      'object fieldPatches "core:scroll--acquirement", but no such record exists',
    );
  });
});

describe("composeContentPacks: per-record ops on passthrough files", () => {
  it("classifies each of the five by whether its records have refs of their own", () => {
    /* THE SPLIT MOVED ON 2026-08-08 and this is where it is visible. `store` is
     * keyed by its STORE_* code and `ego_item` by name + discriminator, so both
     * now merge per record. What is left whole-file is `constants` (a config
     * singleton - the host binds one), `history` (no identity at all) and
     * `object` ONLY in this fixture, which deliberately ships "Deep Descent"
     * twice with the same type; core's real object.txt does not. */
    const composed = composeContentPacks([passthroughCore()]);
    expect(composed.passthroughFiles).toEqual(["constants", "history", "object"]);
    expect(composed.composedFiles).toEqual(["ego_item", "store"]);
    expect(composed.problems).toEqual([]);
  });

  it("applies a coarse patch keyed by a declared non-name field", () => {
    const mod: LoadedPack = {
      manifest: manifest("shops", { core: "*" }),
      files: { store: { patches: { "core:store-armor": { turnover: 40 } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([]);
    expect(recordsOf(composed, "store")).toEqual([
      /* Untouched, so unstamped - the general store is still plainly core's. */
      { store: "STORE_GENERAL", slots: { min: 0, max: 4 }, turnover: 9 },
      {
        store: "STORE_ARMOR",
        slots: { min: 6, max: 18 },
        turnover: 40,
        [PROVENANCE_KEY]: { owner: "core", modifiedBy: ["shops"] },
      },
    ]);
  });

  it("applies a fieldPatch to a config singleton, addressed by its file", () => {
    const mod: LoadedPack = {
      manifest: manifest("deeper", { core: "*" }),
      files: {
        constants: {
          fieldPatches: {
            "core:constants": [
              { op: "set", path: "level-max.0.value", value: 2048 },
            ],
          },
        },
      },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([]);
    expect(recordsOf(composed, "constants")).toEqual([
      {
        "level-max": [{ label: "monsters", value: 2048 }],
        [PROVENANCE_KEY]: { owner: "core", modifiedBy: ["deeper"] },
      },
    ]);
  });

  it("applies a replace and a remove, preserving the order of the survivors", () => {
    const mod: LoadedPack = {
      manifest: manifest("edit", { core: "*" }),
      files: {
        object: {
          replaces: {
            "core:scroll--word-of-recall": {
              type: "scroll",
              name: "Word of Recall",
              cost: 1,
            },
          },
        },
        store: { removes: ["core:store-general"] },
      },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([]);
    expect(recordsOf(composed, "object")[2]).toEqual({
      type: "scroll",
      name: "Word of Recall",
      cost: 1,
      /* A wholesale replace still leaves the record core's - the mod did not
       * add a scroll, it overwrote one - so `owner` stays core and `edit`
       * appears as a modifier. */
      [PROVENANCE_KEY]: { owner: "core", modifiedBy: ["edit"] },
    });
    expect(recordsOf(composed, "store").map((r) => r["store"])).toEqual([
      "STORE_ARMOR",
    ]);
  });

  it("applies two mods' ops in load order", () => {
    const a: LoadedPack = {
      manifest: manifest("a-mod", { core: "*" }),
      files: {
        store: { fieldPatches: { "core:store-general": [{ op: "add", path: "turnover", value: 1 }] } },
      },
    };
    const b: LoadedPack = {
      manifest: manifest("b-mod", { core: "*" }),
      files: {
        store: { fieldPatches: { "core:store-general": [{ op: "mul", path: "turnover", value: 10 }] } },
      },
    };
    /* Load order among independents is the CALLER'S order, so the arithmetic is
     * the visible proof of it: turnover starts at 9, a-mod adds 1 and b-mod
     * multiplies by 10, and the two orders give two different numbers. This used
     * to assert 100 for the b,a input with the comment "load order is
     * lexicographic among independents" - i.e. the resolver re-sorted the caller's
     * list and a player reordering these two mods saw no change. */
    const bFirst = composeContentPacks([passthroughCore(), b, a]);
    expect(bFirst.problems).toEqual([]);
    expect(recordsOf(bFirst, "store")[0]?.["turnover"]).toBe(91); // 9*10 then +1

    const aFirst = composeContentPacks([passthroughCore(), a, b]);
    expect(aFirst.problems).toEqual([]);
    expect(recordsOf(aFirst, "store")[0]?.["turnover"]).toBe(100); // 9+1 then *10
  });
});

describe("composeContentPacks: no per-record op is ever ignored in silence", () => {
  it("reports an op against a file with no per-record identity", () => {
    const mod: LoadedPack = {
      manifest: manifest("lore", { core: "*" }),
      files: { history: { patches: { "core:1": { phrase: ["You were "] } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([
      'lore: history patches "core:1", but history records have no per-record identity, so only whole-file replacement can change them',
    ]);
    // and the record is untouched, not half-applied
    expect(recordsOf(composed, "history")[0]?.["phrase"]).toEqual(["You are "]);
  });

  it("reports an op against a ref two records claim, and changes neither", () => {
    const mod: LoadedPack = {
      manifest: manifest("cheap", { core: "*" }),
      files: { object: { patches: { "core:scroll--deep-descent": { cost: 1 } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toHaveLength(1);
    expect(composed.problems[0]).toContain('object patches "core:scroll--deep-descent"');
    expect(composed.problems[0]).toContain("2 object records share that identity");
    expect(recordsOf(composed, "object").map((r) => r["cost"])).toEqual([
      900, 5000, 150, 150, 200,
    ]);
  });

  it("addresses both halves of a *starred* pair, which used to be one ref", () => {
    /* The regression this exists to hold: `slugify` dropped "*", so
     * "*Acquirement*" and "Acquirement" arrived as one key and NEITHER could be
     * patched. Nothing about the data was ambiguous - the key was lossy. */
    const mod: LoadedPack = {
      manifest: manifest("both", { core: "*" }),
      files: {
        object: {
          patches: {
            "core:scroll--acquirement": { cost: 1 },
            "core:scroll--star-acquirement-star": { cost: 2 },
          },
        },
      },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([]);
    expect(recordsOf(composed, "object").map((r) => r["cost"])).toEqual([
      1, 2, 150, 150, 200,
    ]);
  });

  it("names the discriminated refs when a base ref is ambiguous", () => {
    /* A message that only says "ambiguous" leaves the author nowhere to go: the
     * discriminated form is not derivable without reading record-key.ts. */
    const mod: LoadedPack = {
      manifest: manifest("acidic", { core: "*" }),
      files: { ego_item: { patches: { "core:of-acid": { cost: 1 } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toHaveLength(1);
    expect(composed.problems[0]).toContain("core:of-acid#sword-polearm");
    expect(composed.problems[0]).toContain("core:of-acid#shot-arrow");
    expect(recordsOf(composed, "ego_item").map((r) => r["cost"])).toEqual([5000, 50]);
  });

  it("patches one of two same-named egos through its discriminator", () => {
    /* 51 of core's 107 ego records are in this position. Before the
     * discriminator existed, none of them could be patched at all. */
    const mod: LoadedPack = {
      manifest: manifest("ammo", { core: "*" }),
      files: { ego_item: { patches: { "core:of-acid#shot-arrow": { cost: 7 } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([]);
    expect(recordsOf(composed, "ego_item").map((r) => r["cost"])).toEqual([5000, 7]);
  });

  it("reports an op against a ref that does not exist", () => {
    const mod: LoadedPack = {
      manifest: manifest("typo", { core: "*" }),
      files: { store: { removes: ["core:store-blacksmith"] } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([
      'typo: store removes "core:store-blacksmith", but no such record exists in store (identity is store)' +
        " - it may have been renamed or removed by a newer version of the pack that owns it",
    ]);
    expect(recordsOf(composed, "store")).toHaveLength(2);
  });

  it("reports an op against a pack that was not declared as a dependency", () => {
    const mod: LoadedPack = {
      manifest: manifest("rude"), // no dependencies
      files: { store: { patches: { "core:store-general": { turnover: 1 } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([
      'rude: store patches "core:store-general", but rude does not declare core as a dependency',
    ]);
    expect(recordsOf(composed, "store")[0]?.["turnover"]).toBe(9);
  });

  it("reports, and no longer throws, for an op on a file nobody supplies records for", () => {
    /* Such a file is classified COMPOSABLE - no pack contributed records, so
     * nothing failed the name test - and this used to be the one path out of
     * composeContentPacks that threw. Under composeDroppingBroken that cost the
     * whole mod; here it costs the op, like every other unaddressable ref. */
    const mod: LoadedPack = {
      manifest: manifest("orphan", { core: "*" }),
      files: { trap: { patches: { "core:pit--pit": { visibility: 5 } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toHaveLength(1);
    expect(composed.problems[0]).toContain('orphan: trap patches "core:pit--pit"');
    expect(composed.problems[0]).toContain("no such record exists");
    expect(composed.faults).toEqual([
      { packId: "orphan", why: expect.stringContaining("no such record exists") },
    ]);
  });

  /* THE ASYMMETRY THAT WAS NEVER CHOSEN. `object` is a passthrough file in this
   * fixture and `trap` a composable one, purely because of how the records are
   * shaped - and until 2026-08-02 the identical author mistake was one reported
   * line in the first case and the loss of the entire pack in the second.
   * Asserted as an equality between the two paths rather than as two expected
   * strings, because two strings drift back apart the next time one of them is
   * reworded.
   *
   * `store` used to be the passthrough half here. It stopped being passthrough
   * on 2026-08-08, which would have left this comparing one phase to itself -
   * an equality that cannot fail. The fixture's `object` still is, because it
   * deliberately ships one name twice. */
  it("refuses an unaddressable ref the same way in both merge phases", () => {
    const shape = (file: string, ref: string): LoadedPack => ({
      manifest: manifest("twin", { core: "*" }),
      files: { [file]: { patches: { [ref]: { visibility: 5 } } } },
    });
    const passthrough = composeContentPacks([
      passthroughCore(),
      shape("object", "core:nowhere"),
    ]);
    const composable = composeContentPacks([
      passthroughCore(),
      shape("trap", "core:nowhere"),
    ]);
    /* The control on the comparison: it is only worth anything while the two
     * files really are in different phases. */
    expect(passthrough.passthroughFiles).toContain("object");
    expect(composable.composedFiles).toContain("trap");
    /* The identity clause is deliberately per-file - each file's key is declared
     * in record-key.ts - so it is normalised away and everything else has to
     * match. */
    const shapeOf = (s: string): string =>
      s
        .replace(/core:[a-z-]+/u, "REF")
        .replace(/object|trap/gu, "FILE")
        .replace(/\(identity is [^)]*\)/u, "(ID)");
    expect(passthrough.problems.map(shapeOf)).toEqual(composable.problems.map(shapeOf));
    expect(passthrough.faults.map((f) => f.packId)).toEqual(composable.faults.map((f) => f.packId));
  });

  it("reports a whole-file replacement that discards another pack's records", () => {
    const mod: LoadedPack = {
      manifest: manifest("total", { core: "*" }),
      files: { constants: { records: [{ "level-max": [{ label: "monsters", value: 1 }] }] } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toHaveLength(1);
    expect(composed.problems[0]).toContain(
      "total: constants replaces the whole file, discarding 1 record(s) from core",
    );
    expect(recordsOf(composed, "constants")).toHaveLength(1);
  });

  it("ADDS a record to a file whose names core repeats, instead of replacing it", () => {
    /* The whole point of keying by recordRefKeys. `ego_item` ships "of Acid"
     * twice, so under the old `name`-must-be-unique rule this contribution
     * discarded both of core's egos and left the game with one. The same is
     * true of `object` and `vault` against the real pack: 375 and 162 records
     * gone for adding one. */
    const mod: LoadedPack = {
      manifest: manifest("sludge", { core: "*" }),
      files: {
        ego_item: { records: [{ name: "of Sludge", type: ["sword"], cost: 400 }] },
      },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toEqual([]);
    expect(recordsOf(composed, "ego_item").map((r) => r["name"])).toEqual([
      "of Acid",
      "of Acid",
      "of Sludge",
    ]);
    /* And it is addressable under the mod's own ref, not core's. */
    const patched = composeContentPacks([
      passthroughCore(),
      mod,
      {
        manifest: manifest("tweak", { sludge: "*" }),
        files: { ego_item: { patches: { "sludge:of-sludge": { cost: 9 } } } },
      },
    ]);
    expect(patched.problems).toEqual([]);
    expect(recordsOf(patched, "ego_item")[2]?.["cost"]).toBe(9);
  });

  /**
   * The invariant, asserted directly over the cross-product rather than by
   * example: for every op kind and every passthrough bucket, the composed output
   * either CHANGED or a problem line names that pack, that file and that ref.
   * Never neither (the silent drop this whole path exists to end) and never both.
   */
  it("holds for every op kind against every bucket", () => {
    const buckets: Array<{ file: string; ref: string; reachable: boolean }> = [
      { file: "store", ref: "core:store-general", reachable: true },
      { file: "constants", ref: "core:constants", reachable: true },
      { file: "object", ref: "core:scroll--word-of-recall", reachable: true },
      { file: "object", ref: "core:scroll--deep-descent", reachable: false }, // ambiguous
      { file: "ego_item", ref: "core:of-acid", reachable: false }, // ambiguous base
      { file: "ego_item", ref: "core:of-acid#shot-arrow", reachable: true }, // discriminated
      { file: "history", ref: "core:1", reachable: false }, // no identity
      { file: "store", ref: "core:nope", reachable: false }, // missing
    ];
    const ops: Array<[string, (ref: string) => Record<string, unknown>]> = [
      ["patches", (ref) => ({ patches: { [ref]: { probe: 1 } } })],
      ["replaces", (ref) => ({ replaces: { [ref]: { probe: 1 } } })],
      [
        "fieldPatches",
        (ref) => ({ fieldPatches: { [ref]: [{ op: "set", path: "probe", value: 1 }] } }),
      ],
      ["removes", (ref) => ({ removes: [ref] })],
    ];

    const baseline = JSON.stringify(composeContentPacks([passthroughCore()]).records);

    for (const { file, ref, reachable } of buckets) {
      for (const [name, build] of ops) {
        const mod = {
          manifest: manifest("probe", { core: "*" }),
          files: { [file]: build(ref) },
        } as LoadedPack;
        const composed = composeContentPacks([passthroughCore(), mod]);
        const changed = JSON.stringify(composed.records) !== baseline;
        const reported = composed.problems.some(
          (p) => p.includes(`probe: ${file} ${name} "${ref}"`),
        );
        const where = `${file} ${name} ${ref}`;
        expect(changed || reported, `${where}: neither applied nor reported`).toBe(true);
        expect(changed && reported, `${where}: both applied and reported`).toBe(false);
        expect(changed, `${where}: expected reachable=${String(reachable)}`).toBe(reachable);
      }
    }
  });
});
