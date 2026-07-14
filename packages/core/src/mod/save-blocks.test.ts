import { describe, expect, it } from "vitest";
import type { SavedGame } from "../session/save";
import {
  advanceDeterminism,
  coreOnlyManifest,
  migrateModBag,
  namespaceOf,
  orphanCount,
  orphanedNamespaces,
  quarantineSave,
  rehydrateSave,
} from "./save-blocks";
import type { SaveManifest } from "./save-blocks";

/* A manifest whose save was produced by core + a "frost" mod at 1.2.0. */
const manifest: SaveManifest = {
  packs: [
    { id: "core", version: "0.1.0" },
    { id: "frost", version: "1.2.0" },
  ],
  loadOrder: ["core", "frost"],
  determinism: "deterministic",
};

/**
 * A save with one core and one frost entity in every mod-owned collection, plus
 * a core monster holding a frost object. Only the fields quarantineSave touches
 * are populated; the rest of SavedGame is irrelevant to these pure transforms.
 */
function makeSave(): SavedGame {
  return {
    version: 2,
    player: { equipment: [0, 0, 41] },
    gear: {
      next: 100,
      pack: [40, 41],
      store: [
        [40, { kindId: "core:sword:dagger" }],
        [41, { kindId: "frost:ice-brand" }],
      ],
    },
    monsters: [
      null,
      { raceId: "core:kobold", originalRaceId: null, midx: 1, heldObj: [] },
      {
        raceId: "core:orc",
        originalRaceId: null,
        midx: 2,
        heldObj: [{ kindId: "frost:snowball" }],
      },
      { raceId: "frost:frost-wyrm", originalRaceId: null, midx: 3, heldObj: [] },
    ],
    groups: [
      null,
      { index: 1, leader: 1, members: [1, 3] },
      { index: 2, leader: 3, members: [3] },
    ],
    floor: [
      { x: 5, y: 5, objs: [{ kindId: "core:potion:cure-light-wounds" }] },
      { x: 6, y: 6, objs: [{ kindId: "frost:ice-shard" }] },
      {
        x: 7,
        y: 7,
        objs: [{ kindId: "core:scroll:phase-door" }, { kindId: "frost:rime" }],
      },
    ],
    traps: [
      { x: 1, y: 1, traps: [{ trapId: "core:trap-door" }] },
      { x: 2, y: 2, traps: [{ trapId: "frost:ice-spikes" }] },
    ],
    lore: [
      ["core:kobold", { sights: 3 }],
      ["frost:frost-wyrm", { sights: 1 }],
    ],
    artifactsCreated: ["core:the-one-ring", "frost:icicle-of-doom"],
  } as unknown as SavedGame;
}

/* frost is missing; core is present. */
const presentCoreOnly = (ns: string): boolean => ns === "core";
const presentBoth = (ns: string): boolean => ns === "core" || ns === "frost";

describe("advanceDeterminism (one-way ratchet)", () => {
  it("stays deterministic without a nondeterministic mod", () => {
    expect(advanceDeterminism("deterministic", false)).toBe("deterministic");
  });
  it("flips to nondeterministic when one is enabled", () => {
    expect(advanceDeterminism("deterministic", true)).toBe("nondeterministic");
  });
  it("never returns to deterministic once flipped (irreversible)", () => {
    expect(advanceDeterminism("nondeterministic", false)).toBe("nondeterministic");
    expect(advanceDeterminism("nondeterministic", true)).toBe("nondeterministic");
  });
});

describe("coreOnlyManifest", () => {
  it("is core-as-pack-zero and deterministic", () => {
    const m = coreOnlyManifest();
    expect(m.packs).toEqual([{ id: "core", version: "0.1.0" }]);
    expect(m.loadOrder).toEqual(["core"]);
    expect(m.determinism).toBe("deterministic");
  });
});

describe("namespaceOf", () => {
  it("reads the namespace before the first colon", () => {
    expect(namespaceOf("core:kobold")).toBe("core");
    expect(namespaceOf("frost:wyrm")).toBe("frost");
    /* localids may contain colons; only the first split matters. */
    expect(namespaceOf("core:sword:dagger")).toBe("core");
  });
  it("returns null for a bare id with no namespace", () => {
    expect(namespaceOf("kobold")).toBeNull();
  });
});

describe("orphanedNamespaces", () => {
  it("lists manifest packs absent from the present set", () => {
    expect(orphanedNamespaces(manifest, new Set(["core"]))).toEqual(["frost"]);
    expect(orphanedNamespaces(manifest, new Set(["core", "frost"]))).toEqual([]);
  });
  it("never orphans core (its absence is an engine-incompat, not quarantine)", () => {
    expect(orphanedNamespaces(manifest, new Set(["frost"]))).toEqual([]);
  });
});

describe("migrateModBag", () => {
  it("leaves a bag already at or beyond the target untouched", () => {
    const bag = { schema: 3, data: { x: 1 } };
    expect(migrateModBag(bag, 3, () => ({ y: 2 }))).toBe(bag);
    expect(migrateModBag(bag, 2, () => ({ y: 2 }))).toBe(bag);
  });
  it("runs the mod's migrator and stamps the schema forward", () => {
    const out = migrateModBag({ schema: 1, data: { v: 1 } }, 3, (data, from) => ({
      migratedFrom: from,
      seen: data,
    }));
    expect(out).toEqual({ schema: 3, data: { migratedFrom: 1, seen: { v: 1 } } });
  });
});

describe("quarantineSave", () => {
  it("quarantines a whole mod monster and repairs its groups", () => {
    const { save, quarantined } = quarantineSave(
      makeSave(),
      manifest,
      presentCoreOnly,
    );
    /* The frost-wyrm slot is emptied; the core monsters survive. */
    expect(save.monsters[3]).toBeNull();
    expect(save.monsters[1]?.raceId).toBe("core:kobold");
    /* Group 1 loses member 3; group 2 (frost-wyrm leader) dissolves. */
    expect(save.groups[1]).toEqual({ index: 1, leader: 1, members: [1] });
    expect(save.groups[2]).toBeNull();
    expect(quarantined).toBeGreaterThan(0);
  });

  it("prunes a mod object held by a surviving core monster", () => {
    const { save, orphans } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    const orc = save.monsters.find((m) => m?.raceId === "core:orc");
    expect(orc?.heldObj).toEqual([]);
    const held = orphans["frost@1.2.0"]?.find((e) => e.kind === "heldObject");
    expect(held?.ref).toBe("frost:snowball");
  });

  it("quarantines mod gear and clears its pack/equipment handles", () => {
    const { save } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    /* The frost handle 41 is gone from the store, the pack, and equipment. */
    expect(save.gear.store.map(([h]) => h)).toEqual([40]);
    expect(save.gear.pack).toEqual([40]);
    expect(save.player.equipment).toEqual([0, 0, 0]);
  });

  it("prunes mod floor objects and drops emptied piles", () => {
    const { save } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    /* (6,6) held only frost:ice-shard, so the pile is gone; (7,7) keeps its
     * core scroll but drops frost:rime; (5,5) is untouched. */
    expect(save.floor.map((p) => `${p.x},${p.y}`)).toEqual(["5,5", "7,7"]);
    const pile77 = save.floor.find((p) => p.x === 7);
    expect(pile77?.objs.map((o) => o.kindId)).toEqual(["core:scroll:phase-door"]);
  });

  it("prunes mod traps, lore, and created-artifact ids", () => {
    const { save } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    expect(save.traps.map((c) => `${c.x},${c.y}`)).toEqual(["1,1"]);
    expect(save.lore).toEqual([["core:kobold", { sights: 3 }]]);
    expect(save.artifactsCreated).toEqual(["core:the-one-ring"]);
  });

  it("keys the orphan store by <namespace>@<version> from the manifest", () => {
    const { orphans } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    expect(Object.keys(orphans)).toEqual(["frost@1.2.0"]);
  });

  it("quarantines nothing when every pack is present", () => {
    const { save, quarantined, orphans } = quarantineSave(
      makeSave(),
      manifest,
      presentBoth,
    );
    expect(quarantined).toBe(0);
    expect(orphanCount(orphans)).toBe(0);
    expect(save.monsters[3]?.raceId).toBe("frost:frost-wyrm");
  });

  it("is pure: the input save is not mutated", () => {
    const input = makeSave();
    const snapshot = JSON.stringify(input);
    quarantineSave(input, manifest, presentCoreOnly);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("rehydrateSave (round-trip)", () => {
  it("restores every quarantined entity when the pack returns", () => {
    const original = makeSave();
    const { save: quarantined } = quarantineSave(original, manifest, presentCoreOnly);
    expect(orphanCount(quarantined.orphans)).toBeGreaterThan(0);

    const restored = rehydrateSave(quarantined, presentBoth);
    /* The orphan store is emptied and the content is back. */
    expect(restored.orphans).toBeUndefined();
    expect(restored.monsters[3]?.raceId).toBe("frost:frost-wyrm");
    const orc = restored.monsters.find((m) => m?.raceId === "core:orc");
    expect(orc?.heldObj.map((o) => o.kindId)).toEqual(["frost:snowball"]);
    expect(restored.gear.store.some(([, o]) => o.kindId === "frost:ice-brand")).toBe(
      true,
    );
    expect(restored.gear.pack).toContain(41);
    expect(restored.artifactsCreated).toContain("frost:icicle-of-doom");
    expect(restored.lore?.some(([id]) => id === "frost:frost-wyrm")).toBe(true);
    expect(restored.traps.some((c) => c.x === 2 && c.y === 2)).toBe(true);
  });

  it("leaves orphans quarantined while their pack is still absent", () => {
    const { save: quarantined } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    const stillOut = rehydrateSave(quarantined, presentCoreOnly);
    expect(orphanCount(stillOut.orphans)).toBe(orphanCount(quarantined.orphans));
    expect(stillOut.monsters[3]).toBeNull();
  });
});
