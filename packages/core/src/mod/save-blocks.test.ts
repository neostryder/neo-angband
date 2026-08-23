import { describe, expect, it } from "vitest";
import type { SavedGame } from "../session/save.js";
import {
  advanceModNoscore,
  advanceDeterminism,
  coreOnlyManifest,
  migrateModBag,
  mismatchedNamespaces,
  namespaceOf,
  orphanCount,
  orphanedNamespaces,
  quarantineSave,
  reconcilePackManifest,
  rehydrateSave,
} from "./save-blocks.js";
import type { SaveManifest, SavePackRef } from "./save-blocks.js";
import { ENGINE_VERSION } from "../version.js";

/* A manifest whose save was produced by core + a "frost" mod at 1.2.0. */
const manifest: SaveManifest = {
  packs: [
    { id: "core", version: "0.1.0" },
    { id: "frost", version: "1.2.0" },
  ],
  loadOrder: ["core", "frost"],
  determinism: "deterministic",
  modNoscore: false,
};

/**
 * A save with one core and one frost entity in every mod-owned collection, plus
 * a core monster holding a frost object. Only the fields quarantineSave touches
 * are populated; the rest of SavedGame is irrelevant to these pure transforms.
 */
function makeSave(): SavedGame {
  return {
    version: 2,
    /* 40 is carried (in pack); 41 is worn (in equipment) - pack and equipment
     * are exclusive, matching the real game's gear model (see
     * dehydrate-roundtrip.test.ts's buildModdedSave). */
    player: { equipment: [0, 0, 41] },
    gear: {
      next: 100,
      pack: [40],
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

describe("advanceModNoscore (one-way ratchet)", () => {
  it("flips for a gameplay mod and survives disabling it", () => {
    const enabled = advanceModNoscore(false, true);
    expect(enabled).toBe(true);
    expect(advanceModNoscore(enabled, false)).toBe(true);
  });

  it("does not mark a save for a mod that does not affect gameplay", () => {
    expect(advanceModNoscore(false, false)).toBe(false);
  });
});

describe("coreOnlyManifest", () => {
  it("is core-as-pack-zero and deterministic", () => {
    const m = coreOnlyManifest();
    /* ENGINE_VERSION, not a literal. The literal was the bug: this assertion
     * used to hardcode "0.1.0" and so agreed with a CORE_PACK_VERSION that had
     * silently fallen a whole version line behind the engine. Pinning the
     * relationship instead of the value is what makes the drift impossible. */
    expect(m.packs).toEqual([{ id: "core", version: ENGINE_VERSION }]);
    expect(m.loadOrder).toEqual(["core"]);
    expect(m.determinism).toBe("deterministic");
    expect(m.modNoscore).toBe(false);
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

/* issue #20: a pack that PATCHES a record (a session mod re-pricing a core
 * sword) instead of only adding one leaves nothing for orphanedNamespaces to
 * catch, because the record still resolves under its own, still-present
 * namespace. mismatchedNamespaces is the sibling check: same manifest, but
 * compared against the CURRENT content hash of each present pack. */
describe("mismatchedNamespaces", () => {
  const patched: SaveManifest = {
    packs: [
      { id: "core", version: "0.1.0" },
      { id: "frost", version: "1.2.0", hash: "aaa" },
    ],
    loadOrder: ["core", "frost"],
    determinism: "deterministic",
    modNoscore: false,
  };

  it("reports a namespace whose recorded hash disagrees with its current one", () => {
    const current: SavePackRef[] = [{ id: "frost", version: "1.2.0", hash: "bbb" }];
    expect(mismatchedNamespaces(patched, current)).toEqual(["frost"]);
  });

  it("reports nothing when the current hash matches the recorded one", () => {
    const current: SavePackRef[] = [{ id: "frost", version: "1.2.0", hash: "aaa" }];
    expect(mismatchedNamespaces(patched, current)).toEqual([]);
  });

  it("reports nothing when the recorded manifest has no hash at all (an older save)", () => {
    expect(mismatchedNamespaces(manifest, [{ id: "frost", version: "1.2.0", hash: "bbb" }])).toEqual([]);
  });

  it("reports nothing when the caller cannot measure the pack's current hash", () => {
    /* Absent from currentPacks entirely - "not measured", not "unchanged". */
    expect(mismatchedNamespaces(patched, [])).toEqual([]);
    /* Present but with no hash of its own - same "not measured" answer. */
    expect(mismatchedNamespaces(patched, [{ id: "frost", version: "1.2.0" }])).toEqual([]);
  });

  it("never reports core (core's own content differing is an engine-version question)", () => {
    const coreHashed: SaveManifest = {
      ...patched,
      packs: [{ id: "core", version: "0.1.0", hash: "core-old" }, patched.packs[1]!],
    };
    const current: SavePackRef[] = [
      { id: "core", version: "0.1.0", hash: "core-new" },
      { id: "frost", version: "1.2.0", hash: "aaa" },
    ];
    expect(mismatchedNamespaces(coreHashed, current)).toEqual([]);
  });
});

describe("reconcilePackManifest", () => {
  const patched: SaveManifest = {
    packs: [
      { id: "core", version: "0.1.0" },
      { id: "frost", version: "1.2.0", hash: "aaa" },
    ],
    loadOrder: ["core", "frost"],
    determinism: "deterministic",
    modNoscore: false,
  };

  it("replaces a present namespace's recorded entry with the current one", () => {
    const current: SavePackRef[] = [{ id: "frost", version: "1.3.0", hash: "bbb" }];
    const out = reconcilePackManifest(patched, current);
    expect(out.packs).toEqual([
      { id: "core", version: "0.1.0" },
      { id: "frost", version: "1.3.0", hash: "bbb" },
    ]);
  });

  it("leaves a namespace's recorded entry untouched when the caller supplies nothing for it", () => {
    /* The "cannot measure this pack yet" case (a regular installed mod today) -
     * behaves exactly as if reconcilePackManifest had never been called. */
    const out = reconcilePackManifest(patched, []);
    expect(out.packs).toEqual(patched.packs);
  });

  it("adds a newly-present namespace the manifest never recorded before", () => {
    const current: SavePackRef[] = [{ id: "qol", version: "1.0.0", hash: "ccc" }];
    const out = reconcilePackManifest(patched, current);
    expect(out.packs).toEqual([...patched.packs, { id: "qol", version: "1.0.0", hash: "ccc" }]);
  });

  it("does not mutate either argument", () => {
    const before = JSON.stringify(patched);
    reconcilePackManifest(patched, [{ id: "frost", version: "1.3.0", hash: "bbb" }]);
    expect(JSON.stringify(patched)).toBe(before);
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
    const { save, orphans, quarantined } = quarantineSave(
      makeSave(),
      manifest,
      presentCoreOnly,
    );
    /* The frost-wyrm slot is emptied; the core monsters survive. */
    expect(save.monsters![3]).toBeNull();
    expect(save.monsters![1]?.raceId).toBe("core:kobold");
    /* Group 1 loses member 3; group 2 (frost-wyrm leader) dissolves - in the
     * live save. Neither is a silent loss: both are captured as orphans. */
    expect(save.groups![1]).toEqual({ index: 1, leader: 1, members: [1] });
    expect(save.groups![2]).toBeNull();
    const frost = orphans["frost@1.2.0"] ?? [];
    expect(frost.find((e) => e.kind === "group")?.data).toEqual({
      index: 2,
      leader: 3,
      members: [3],
    });
    const membership = frost.find((e) => e.kind === "groupMembership");
    expect(membership?.data).toBe(3);
    expect(membership?.locus).toBe(1);
    expect(quarantined).toBeGreaterThan(0);
  });

  it("prunes a mod object held by a surviving core monster", () => {
    const { save, orphans } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    const orc = save.monsters!.find((m) => m?.raceId === "core:orc");
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
    expect(save.floor!.map((p) => `${p.x},${p.y}`)).toEqual(["5,5", "7,7"]);
    const pile77 = save.floor!.find((p) => p.x === 7);
    expect(pile77?.objs.map((o) => o.kindId)).toEqual(["core:scroll:phase-door"]);
  });

  it("prunes mod traps, lore, and created-artifact ids", () => {
    const { save } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    expect(save.traps!.map((c) => `${c.x},${c.y}`)).toEqual(["1,1"]);
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
    expect(save.monsters![3]?.raceId).toBe("frost:frost-wyrm");
  });

  it("still quarantines dead-save gear while accepting omitted dungeon arrays", () => {
    const dead = makeSave();
    dead.isDead = true;
    delete dead.chunk;
    delete dead.featLegend;
    delete dead.monsters;
    delete dead.groups;
    delete dead.floor;
    delete dead.traps;
    delete dead.known;

    const { save, quarantined } = quarantineSave(dead, manifest, presentCoreOnly);
    expect(quarantined).toBeGreaterThan(0);
    expect(save.monsters).toBeUndefined();
    expect(save.floor).toBeUndefined();
    expect(save.traps).toBeUndefined();
    expect(save.gear.store.map(([h]) => h)).toEqual([40]);
    expect(save.orphans?.["frost@1.2.0"]?.some((e) => e.kind === "gearObject")).toBe(
      true,
    );

    const restored = rehydrateSave(save, presentBoth);
    expect(restored.gear.store.some(([, o]) => o.kindId === "frost:ice-brand")).toBe(
      true,
    );
    /* 41 was equipped, not carried, so it returns to its slot - not the pack
     * (pack and equipment are exclusive; see the "claim b" fix above). */
    expect(restored.player.equipment).toEqual([0, 0, 41]);
    expect(restored.gear.pack).toEqual([40]);
    expect(restored.monsters).toBeUndefined();
    expect(restored.floor).toBeUndefined();
    expect(restored.traps).toBeUndefined();
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
    expect(restored.monsters![3]?.raceId).toBe("frost:frost-wyrm");
    const orc = restored.monsters!.find((m) => m?.raceId === "core:orc");
    expect(orc?.heldObj.map((o) => o.kindId)).toEqual(["frost:snowball"]);
    expect(restored.gear.store.some(([, o]) => o.kindId === "frost:ice-brand")).toBe(
      true,
    );
    /* 41 was equipped, not carried - it returns to its slot below, not pack. */
    expect(restored.gear.pack).toEqual([40]);
    expect(restored.artifactsCreated).toContain("frost:icicle-of-doom");
    expect(restored.lore?.some(([id]) => id === "frost:frost-wyrm")).toBe(true);
    expect(restored.traps!.some((c) => c.x === 2 && c.y === 2)).toBe(true);
    /* Groups come back as groups, not just their entities: the whole
     * frost-wyrm-led group returns intact, and the frost-wyrm rejoins the
     * still-live core:kobold-led group it was filtered out of. */
    expect(restored.groups![2]).toEqual({ index: 2, leader: 3, members: [3] });
    expect(restored.groups![1]).toEqual({ index: 1, leader: 1, members: [1, 3] });
    /* The frost item returns to the exact slot it was equipped in, not just
     * the pack. */
    expect(restored.player.equipment).toEqual([0, 0, 41]);
  });

  it("leaves orphans quarantined while their pack is still absent", () => {
    const { save: quarantined } = quarantineSave(makeSave(), manifest, presentCoreOnly);
    const stillOut = rehydrateSave(quarantined, presentCoreOnly);
    expect(orphanCount(stillOut.orphans)).toBe(orphanCount(quarantined.orphans));
    expect(stillOut.monsters![3]).toBeNull();
  });
});
