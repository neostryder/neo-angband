import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { StoreRegistry } from "./bind.js";
import type { StoreRecordJson } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const objPack: ObjPackJson = {
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson;

const reg = new ObjRegistry(objPack);
const storeRecords = loadRecords<StoreRecordJson>("store");
const stores = new StoreRegistry(storeRecords, reg);

describe("StoreRegistry (store.c parsing / store_at)", () => {
  it("binds all eight 4.2.6 stores", () => {
    expect(stores.stores.length).toBe(8);
    expect(stores.byName("STORE_GENERAL")).not.toBeNull();
    expect(stores.byName("HOME")).not.toBeNull();
  });

  it("binds the general store faithfully", () => {
    const gen = stores.byName("STORE_GENERAL")!;
    expect(gen.feat).toBe(FEAT.STORE_GENERAL);

    // Four owners, in order, Bilbo first with a 5000 purse.
    expect(gen.owners.length).toBe(4);
    expect(gen.owners[0]!.index).toBe(0);
    expect(gen.owners[0]!.name).toBe("Bilbo the Friendly (Hobbit)");
    expect(gen.owners[0]!.maxCost).toBe(5000);

    // Always stocks nine specific kinds; the Wooden Torch is one of them.
    expect(gen.alwaysTable.length).toBe(9);
    const torch = gen.alwaysTable.find((k) => k.tval === TV.LIGHT);
    expect(torch?.name).toContain("Torch");
    // No deferred book expansion for the general store.
    expect(gen.alwaysBookTvals.length).toBe(0);

    // Six normal-table kinds, buy list of nine tvals, turnover/slots as data.
    expect(gen.normalTable.length).toBe(6);
    expect(gen.buy).not.toBeNull();
    expect(gen.buy!.length).toBe(9);
    expect(gen.buy!.map((b) => b.tval)).toContain(TV.LIGHT);
    expect(gen.buy!.every((b) => b.flag === 0)).toBe(true);
    expect(gen.turnover).toBe(2);
    expect(gen.normalStockMin).toBe(0);
    expect(gen.normalStockMax).toBe(4);
  });

  it("defers the bookseller's town-book always lines to store_init", () => {
    const book = stores.byName("STORE_BOOK")!;
    expect(book.feat).toBe(FEAT.STORE_BOOK);
    // Its four `always: <book tval>` lines have no sval: captured as tvals for
    // later town-book expansion, none resolved into alwaysTable yet.
    expect(book.alwaysBookTvals.length).toBe(4);
    expect(book.alwaysBookTvals.every((t) => t >= 0)).toBe(true);
    expect(book.alwaysTable.length).toBe(0);
  });

  it("binds the black market with no fixed tables and no buy list", () => {
    const black = stores.byName("STORE_BLACK")!;
    expect(black.feat).toBe(FEAT.STORE_BLACK);
    expect(black.alwaysTable.length).toBe(0);
    expect(black.normalTable.length).toBe(0);
    // No buy list means "buys anything" (store_will_buy).
    expect(black.buy).toBeNull();
    expect(black.normalStockMax).toBe(18);
  });

  it("binds the home as storage (placeholder owners, no stock or buy)", () => {
    const home = stores.byName("HOME")!;
    expect(home.feat).toBe(FEAT.HOME);
    expect(home.owners[0]!.name).toBe("Your home");
    expect(home.owners[0]!.maxCost).toBe(0);
    expect(home.alwaysTable.length).toBe(0);
    expect(home.normalTable.length).toBe(0);
    expect(home.buy).toBeNull();
  });

  it("store_at: looks a store up by entrance feature", () => {
    expect(stores.byFeat(FEAT.STORE_MAGIC)?.featName).toBe("STORE_MAGIC");
    expect(stores.byFeat(FEAT.FLOOR)).toBeNull();
  });

  it("the shipped pack refuses nothing", () => {
    /* The denominator for every test below: with no mod loaded, no record
     * carries provenance and the drop path is unreachable, so an entry here
     * would mean this file had started tolerating core's own data. */
    expect(stores.refused).toEqual([]);
  });
});

/**
 * A stock line that resolves to nothing: whose mistake it is decides whether the
 * game refuses to boot.
 *
 * WHAT MADE THIS REACHABLE. `append` on `normal` / `always` (mod-sdk patch.ts)
 * is the op that lets one mod stock an item in a shop, and the tutorials teach
 * it. So "mod A stocks an item mod B defines, player disables mod B" is an
 * ordinary pair of mods and an ordinary click, and it used to reach
 * `store: unknown sval` out of `bindCore` - which runs inside `startGame` at the
 * host's module top level, i.e. the whole game failing to start.
 *
 * Provenance is written the way `stampProvenance` writes it, because that is the
 * shape this code reads in production: `was` carries the DEFINING pack's own
 * value for a table a later pack changed, and it is the only thing that can tell
 * core's line from an appended one within a single list.
 */
describe("bindStore: an unresolvable stock line", () => {
  const armour = (): StoreRecordJson =>
    JSON.parse(
      JSON.stringify(storeRecords.find((r) => r.store === "STORE_ARMOR")),
    ) as StoreRecordJson;

  /** `{tval, sval}` naming an item no pack defines. */
  const GHOST = { tval: "soft armor", sval: "Padded Jerkin" };

  /** A record with `$from` on it, in `stampProvenance`'s shape. */
  function stamped(
    rec: StoreRecordJson,
    from: { owner: string; modifiedBy?: string[]; was?: Record<string, unknown> },
  ): StoreRecordJson {
    return { ...rec, $from: from } as StoreRecordJson;
  }

  it("throws when nothing touched the record", () => {
    const rec = armour();
    rec.normal!.push(GHOST);
    expect(() => new StoreRegistry([rec], reg)).toThrow(
      /store: unknown sval soft armor:Padded Jerkin/,
    );
  });

  it("drops it and names the appending mod when a mod appended it", () => {
    const base = armour();
    const was = { normal: base.normal!.map((it) => ({ ...it })) };
    const rec = stamped(base, { owner: "core", modifiedBy: ["mod-a"], was });
    rec.normal!.push(GHOST);

    const bound = new StoreRegistry([rec], reg);
    const armoury = bound.byName("STORE_ARMOR")!;

    /* The line is gone and NOTHING ELSE IS. Compared against the same store
     * bound with no mod at all, so this cannot pass on an empty table. */
    const bare = stores.byName("STORE_ARMOR")!;
    expect(armoury.normalTable.length).toBe(bare.normalTable.length);
    expect(armoury.normalTable.map((k) => k.name)).toEqual(
      bare.normalTable.map((k) => k.name),
    );
    expect(armoury.alwaysTable.length).toBe(bare.alwaysTable.length);
    expect(armoury.buy!.length).toBe(bare.buy!.length);

    expect(bound.refused.length).toBe(1);
    expect(bound.refused[0]!.id).toBe("mod-a");
    expect(bound.refused[0]!.store).toBe("STORE_ARMOR");
    expect(bound.refused[0]!.table).toBe("normal");
    expect(bound.refused[0]!.why).toContain("Padded Jerkin");
    /* One modifier, so no parenthetical set - the ordinary case pays nothing. */
    expect(bound.refused[0]!.why).not.toContain("packs touching");
  });

  it("still throws for CORE's own line in a record a mod patched", () => {
    /* The half of the rule that keeps core honest. The mod's append is fine;
     * core's own list is what holds the bad line, and `was.normal` is what
     * proves it - the entry is in the definer's own value, so the definer is
     * answerable and the definer is core. */
    const base = armour();
    base.normal!.push(GHOST);
    const was = { normal: base.normal!.map((it) => ({ ...it })) };
    const rec = stamped(base, { owner: "core", modifiedBy: ["mod-a"], was });
    rec.normal!.push({ tval: "boots", sval: "Pair of Leather Boots" });

    expect(() => new StoreRegistry([rec], reg)).toThrow(
      /store: unknown sval soft armor:Padded Jerkin/,
    );
  });

  it("names every pack that touched the store when more than one did", () => {
    const base = armour();
    const was = { normal: base.normal!.map((it) => ({ ...it })) };
    const rec = stamped(base, {
      owner: "core",
      modifiedBy: ["mod-a", "mod-b"],
      was,
    });
    rec.normal!.push(GHOST);

    const bound = new StoreRegistry([rec], reg);
    /* Attributed to the LAST modifier, because load order applies patches in
     * order and it is the only one of the two core can single out - and the set
     * is in the sentence, so a fault on the wrong row is still traceable. */
    expect(bound.refused[0]!.id).toBe("mod-b");
    expect(bound.refused[0]!.why).toContain("packs touching this store: core, mod-a, mod-b");
  });

  it("drops a mod-defined store's own bad line rather than throwing", () => {
    /* A whole store a mod added: no `was`, and the definer is not core, so
     * every line in it is the mod's to get wrong. */
    const rec = stamped(
      { ...armour(), store: "STORE_ARMOR", normal: [GHOST] },
      { owner: "mod-a" },
    );

    const bound = new StoreRegistry([rec], reg);
    expect(bound.byName("STORE_ARMOR")!.normalTable).toEqual([]);
    expect(bound.refused.length).toBe(1);
    expect(bound.refused[0]!.id).toBe("mod-a");
  });

  it("covers the `always` table and its svalless book lines too", () => {
    /* `always:` takes two shapes and a mod appending to it can get either
     * wrong; only one of them being survivable would be an arbitrary line. */
    const base = armour();
    const was = { always: (base.always ?? []).map((it) => ({ ...it })) };
    const rec = stamped(base, { owner: "core", modifiedBy: ["mod-a"], was });
    rec.always = [...(rec.always ?? []), GHOST, { tval: "no such tval" }];

    const bound = new StoreRegistry([rec], reg);
    const bare = stores.byName("STORE_ARMOR")!;
    expect(bound.byName("STORE_ARMOR")!.alwaysTable.length).toBe(bare.alwaysTable.length);
    expect(bound.byName("STORE_ARMOR")!.alwaysBookTvals).toEqual(bare.alwaysBookTvals);
    expect(bound.refused.map((r) => r.table)).toEqual(["always", "always"]);
    expect(bound.refused.every((r) => r.id === "mod-a")).toBe(true);
    expect(bound.refused[1]!.why).toContain("unknown always tval no such tval");
  });

  it("leaves the other stores in the pack whole", () => {
    /* The outcome the resilience contract asks for, stated on the pack rather
     * than on one record: one bad line costs one line. */
    const base = armour();
    const was = { normal: base.normal!.map((it) => ({ ...it })) };
    const rec = stamped(base, { owner: "core", modifiedBy: ["mod-a"], was });
    rec.normal!.push(GHOST);

    const bound = new StoreRegistry(
      storeRecords.map((r) => (r.store === "STORE_ARMOR" ? rec : r)),
      reg,
    );
    expect(bound.stores.length).toBe(stores.stores.length);
    for (const bare of stores.stores) {
      const after = bound.byName(bare.featName)!;
      if (bare.featName === "STORE_ARMOR") continue;
      expect(after.normalTable.length).toBe(bare.normalTable.length);
      expect(after.alwaysTable.length).toBe(bare.alwaysTable.length);
    }
  });
});
