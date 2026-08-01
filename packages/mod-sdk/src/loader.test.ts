import { describe, expect, it } from "vitest";
import { composeContentPacks } from "./loader.js";
import type { LoadedPack } from "./loader.js";
import type { PackManifest } from "./manifest.js";

function manifest(id: string, deps?: Record<string, string>): PackManifest {
  const m: PackManifest = { id, name: id, version: "1.0.0", shape: "content" };
  if (deps) m.dependencies = deps;
  return m;
}

/** A minimal core pack: named monster records + a nameless config file. */
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
      // nameless / index-keyed: not per-record addressable -> passthrough
      names: { records: [{ section: 2, word: ["foo", "bar"] }] },
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
    expect(composed.passthroughFiles).toContain("names");
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

  it("passes nameless files through last-in-load-order-wins", () => {
    const mod: LoadedPack = {
      manifest: manifest("renamer", { core: "*" }),
      files: { names: { records: [{ section: 2, word: ["zap"] }] } },
    };
    const composed = composeContentPacks([corePack(), mod]);
    expect(composed.records["names"]).toEqual([{ section: 2, word: ["zap"] }]);
    expect(composed.passthroughFiles).toContain("names");
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
 *  - `object` name-keyed but with a slug collision core really ships
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
          { type: "scroll", name: "Acquirement", cost: 900 },
          { type: "scroll", name: "*Acquirement*", cost: 5000 },
          { type: "scroll", name: "Word of Recall", cost: 150 },
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

describe("composeContentPacks: per-record ops on passthrough files", () => {
  it("still classifies all four as passthrough (whole-file `records` semantics kept)", () => {
    const composed = composeContentPacks([passthroughCore()]);
    expect(composed.passthroughFiles).toEqual([
      "constants",
      "history",
      "object",
      "store",
    ]);
    expect(composed.composedFiles).toEqual([]);
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
      { store: "STORE_GENERAL", slots: { min: 0, max: 4 }, turnover: 9 },
      { store: "STORE_ARMOR", slots: { min: 6, max: 18 }, turnover: 40 },
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
      { "level-max": [{ label: "monsters", value: 2048 }] },
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
      files: { object: { patches: { "core:scroll--acquirement": { cost: 1 } } } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toHaveLength(1);
    expect(composed.problems[0]).toContain('object patches "core:scroll--acquirement"');
    expect(composed.problems[0]).toContain("2 object records share that identity");
    expect(recordsOf(composed, "object").map((r) => r["cost"])).toEqual([900, 5000, 150]);
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

  /* THE ASYMMETRY THAT WAS NEVER CHOSEN. `store` is a passthrough file and `trap`
   * a composable one, purely because of how core's own records are shaped - and
   * until 2026-08-02 the identical author mistake was one reported line in the
   * first case and the loss of the entire pack in the second. Asserted as an
   * equality between the two paths rather than as two expected strings, because
   * two strings drift back apart the next time one of them is reworded. */
  it("refuses an unaddressable ref the same way in both merge phases", () => {
    const shape = (file: string, ref: string): LoadedPack => ({
      manifest: manifest("twin", { core: "*" }),
      files: { [file]: { patches: { [ref]: { visibility: 5 } } } },
    });
    const passthrough = composeContentPacks([
      passthroughCore(),
      shape("store", "core:store-nowhere"),
    ]);
    const composable = composeContentPacks([
      passthroughCore(),
      shape("trap", "core:trap-nowhere"),
    ]);
    /* The identity clause is deliberately per-phase - a passthrough file's key
     * is declared in record-key.ts, a composable one's is always the record's
     * `name` - so it is normalised away and everything else has to match. */
    const shapeOf = (s: string): string =>
      s
        .replace(/core:[a-z-]+/u, "REF")
        .replace(/store|trap/gu, "FILE")
        .replace(/\(identity is [^)]*\)/u, "(ID)");
    expect(passthrough.problems.map(shapeOf)).toEqual(composable.problems.map(shapeOf));
    expect(passthrough.faults.map((f) => f.packId)).toEqual(composable.faults.map((f) => f.packId));
  });

  it("reports a whole-file replacement that discards another pack's records", () => {
    const mod: LoadedPack = {
      manifest: manifest("total", { core: "*" }),
      files: { store: { records: [{ store: "STORE_GENERAL", turnover: 1 }] } },
    };
    const composed = composeContentPacks([passthroughCore(), mod]);
    expect(composed.problems).toHaveLength(1);
    expect(composed.problems[0]).toContain(
      "total: store replaces the whole file, discarding 2 record(s) from core",
    );
    expect(recordsOf(composed, "store")).toHaveLength(1);
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
      { file: "object", ref: "core:scroll--acquirement", reachable: false }, // ambiguous
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
