/**
 * A PATCH CANNOT MAKE A FIELD UNREADABLE, measured composer-to-binder.
 *
 * The store binder was hardened on 2026-08-20 against a mod-contributed entry
 * that RESOLVES to nothing - a shop line naming an item no loaded pack defines.
 * This file is the defect one level down: a patch that changes a field's JSON
 * SHAPE, so the record composes perfectly and no binder can read it. `owner` is
 * the case that surfaced it, because the store binder does `rec.owner.map(...)`
 * and a string has no `.map`.
 *
 * WHAT MEASURING FIRST CHANGED. The premise this was written to test was
 * "nothing validates the composed record's shape", and that premise was WRONG:
 * `composeContentPacks` already runs core's record check on the load path
 * (validate.ts), that check already has a `field/type` rule, and it fired on
 * this exact patch and attributed it to the mod. What was actually broken was
 * narrower and worse - the check REPORTS AND NEVER REFUSES, deliberately, so
 * the unreadable record went into the game anyway and the binder threw a
 * TypeError out of `bindCore` inside `startGame` at the host's module top level.
 * The player got the crash screen and no game.
 *
 * Reporting is right for a statistic: the blueprint is a MEASUREMENT of core's
 * records, and blueprints.ts says an unlisted value is legal, because a mod
 * inventing a new tval is doing something the mod system exists to allow. It is
 * not right for container-ness. So the composer now refuses exactly that class,
 * puts the field back, and tells the mod - and everything else stays a finding.
 *
 * These tests are the end-to-end half: real core pack, real composer, real
 * store binder. The guard's own cases live in mod-sdk's compose.test.ts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeContentPacks } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ComposedContent, LoadedPack, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { ObjRegistry, StoreRegistry } from "@rpgm-tools/neo-angband-core";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CORE_PACK = join(REPO, "packages", "content", "pack");

const readJson = (name: string): never =>
  JSON.parse(readFileSync(join(CORE_PACK, `${name}.json`), "utf8")) as never;

/** The real core pack, restricted to the files a store bind needs. */
function corePack(files: readonly string[]): LoadedPack {
  const manifest: PackManifest = {
    id: "core",
    name: "Angband",
    version: "1.0.0",
    shape: "content",
  };
  const out: Record<string, unknown> = {};
  for (const f of files) out[f] = readJson(f);
  return { manifest, files: out } as LoadedPack;
}

/** A one-file mod carrying whatever ops the test wants, against the Armoury. */
function modPatching(ops: unknown, id = "mod-shape"): LoadedPack {
  const manifest = {
    id,
    name: "Shape Breaker",
    version: "1.0.0",
    shape: "content",
    /* Declared, because the composer refuses a patch aimed at a pack the mod
     * does not depend on - one of the gates that DOES hold here. */
    dependencies: { core: "*" },
  } as unknown as PackManifest;
  return {
    manifest,
    files: {
      /* A store record's key is its STORE_* code, slugified (record-key.ts). */
      store: { fieldPatches: { "core:store-armor": ops } },
    },
  } as unknown as LoadedPack;
}

const OBJ_FILES = [
  "object_base",
  "object",
  "ego_item",
  "artifact",
  "curse",
  "brand",
  "slay",
  "activation",
  "object_property",
  "flavor",
] as const;

function objRegistry(): ObjRegistry {
  return new ObjRegistry({
    objectBase: readJson("object_base"),
    object: readJson("object"),
    egoItem: readJson("ego_item"),
    artifact: readJson("artifact"),
    curse: readJson("curse"),
    brand: readJson("brand"),
    slay: readJson("slay"),
    activation: readJson("activation"),
    objectProperty: readJson("object_property"),
    flavor: readJson("flavor"),
  } as never);
}

/** Core's own store records, bound with no mod at all. */
function bareStores(): StoreRegistry {
  return new StoreRegistry((readJson("store") as { records: never[] }).records, objRegistry());
}

/** Compose core plus one mod's ops, and hand back what the game would see. */
function compose(ops: unknown): {
  composed: ComposedContent;
  armoury: Record<string, unknown>;
  bind: () => StoreRegistry;
} {
  const composed = composeContentPacks([corePack(["store", ...OBJ_FILES]), modPatching(ops)]);
  const stores = composed.records["store"] as Record<string, unknown>[];
  return {
    composed,
    armoury: stores.find((r) => r["store"] === "STORE_ARMOR")!,
    bind: (): StoreRegistry => new StoreRegistry(stores as never[], objRegistry()),
  };
}

const bare = bareStores().byName("STORE_ARMOR")!;

describe("a patch that would make a field unreadable", () => {
  it("is refused, and the field is left as core had it", () => {
    const { composed, armoury, bind } = compose([
      { op: "set", path: "owner", value: "Ithil-Mor the Ancient" },
    ]);

    /* Refused, attributed, and said in the mod's own terms. */
    expect(composed.faults.length).toBe(1);
    expect(composed.faults[0]!.packId).toBe("mod-shape");
    expect(composed.faults[0]!.why).toContain("`owner` is string");
    expect(composed.faults[0]!.why).toContain("nothing can read it");

    /* The field is core's again - not dropped, and not left broken. */
    expect(Array.isArray(armoury["owner"])).toBe(true);

    /* And the shop still binds, with the owners core shipped. */
    const armour = bind().byName("STORE_ARMOR")!;
    expect(armour.owners.map((o) => o.name)).toEqual(bare.owners.map((o) => o.name));
    expect(armour.normalTable.length).toBe(bare.normalTable.length);
  });

  it("refuses `null` as well as a scalar", () => {
    /* `null` is the case a shape check folded into "object" would wave through,
     * and `null.map(...)` throws exactly as loudly as a string does. */
    const { composed, armoury, bind } = compose([{ op: "set", path: "owner", value: null }]);
    expect(composed.faults.length).toBe(1);
    expect(composed.faults[0]!.why).toContain("`owner` is null");
    expect(Array.isArray(armoury["owner"])).toBe(true);
    expect(bind().byName("STORE_ARMOR")!.owners.length).toBe(bare.owners.length);
  });

  it("refuses a container field turned into a number", () => {
    const { composed, bind } = compose([{ op: "set", path: "normal", value: 3 }]);
    expect(composed.faults.length).toBe(1);
    expect(composed.faults[0]!.why).toContain("`normal` is number");
    expect(bind().byName("STORE_ARMOR")!.normalTable.length).toBe(bare.normalTable.length);
  });

  it("leaves every other store alone", () => {
    /* The resilience contract's own outcome, stated on the pack: one bad field
     * costs that field. */
    const { bind } = compose([{ op: "set", path: "owner", value: "nobody" }]);
    const after = bind();
    const before = bareStores();
    expect(after.stores.length).toBe(before.stores.length);
    for (const [i, shop] of before.stores.entries()) {
      expect(after.stores[i]!.featName).toBe(shop.featName);
      expect(after.stores[i]!.owners.length).toBe(shop.owners.length);
    }
  });
});

describe("what the shape guard deliberately does NOT refuse", () => {
  it("keeps a legitimate change to the same container", () => {
    const { composed, armoury, bind } = compose([
      { op: "set", path: "owner", value: [{ name: "Ithil-Mor the Ancient", purse: 12000 }] },
    ]);
    expect(composed.faults).toEqual([]);
    expect(Array.isArray(armoury["owner"])).toBe(true);
    const owners = bind().byName("STORE_ARMOR")!.owners;
    expect(owners.length).toBe(1);
    expect(owners[0]!.name).toBe("Ithil-Mor the Ancient");
    expect(owners[0]!.maxCost).toBe(12000);
  });

  it("keeps a scalar written as the wrong scalar, and reports it instead", () => {
    /* The narrowness is the point. A binder can usually read this, some coerce
     * it, and the blueprint cannot prove it unreadable - so it stays the finding
     * it already was rather than becoming a refusal. */
    const { composed, armoury } = compose([{ op: "set", path: "turnover", value: "9" }]);
    expect(composed.faults).toEqual([]);
    expect(armoury["turnover"]).toBe("9");
    const finding = composed.findings.find(
      (f) => f.rule === "field/type" && f.field === "turnover",
    );
    expect(finding, "a wrong-scalar patch should still be reported").toBeDefined();
    expect(finding!.packId).toBe("mod-shape");
  });
});

describe("a refused field is not recorded as the mod's", () => {
  it("keeps `was` for what landed and withholds it for what did not", () => {
    /* THE SUBTLE HALF. Provenance's `was[field]` is what tells core's own line
     * from a mod's in the binders (see `fieldOwner` in core's store binder), so
     * recording a write that was REFUSED would hand the mod the blame for a
     * field it did not change - and, in the store binder, turn core's own bad
     * stock line into a reported drop instead of the loud failure it should be.
     */
    const { composed, armoury } = compose([
      { op: "set", path: "owner", value: "nobody" },
      {
        op: "append",
        path: "normal",
        values: [{ tval: "boots", sval: "Pair of Leather Boots" }],
      },
    ]);

    expect(composed.faults.length).toBe(1);

    const from = armoury["$from"] as {
      owner: string;
      modifiedBy?: string[];
      was?: Record<string, unknown>;
    };
    expect(from, "the record was not stamped").toBeDefined();
    expect(from.modifiedBy).toContain("mod-shape");
    /* `normal` landed, so the definer's own list is remembered. */
    expect(from.was).toHaveProperty("normal");
    /* `owner` did not, so nothing about it is claimed. */
    expect(from.was).not.toHaveProperty("owner");
  });
});
