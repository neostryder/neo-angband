import { describe, expect, it } from "vitest";
import type { SavedGame } from "../session/save.js";
import { orphanCount, quarantineSave } from "./save-blocks.js";
import type { OrphanEntry, SaveManifest } from "./save-blocks.js";
import {
  orphanCategory,
  orphanPromptDue,
  orphanStash,
  parseOrphanKey,
  purgeOrphans,
} from "./orphan-stash.js";

/* The same fixture shape save-blocks.test.ts uses: a save produced by core plus
 * a "frost" mod at 1.2.0, with one frost entity in every collection quarantine
 * touches. Built through the REAL quarantineSave rather than by hand, so what
 * the model is read against is what the storage half actually produces. */
const manifest: SaveManifest = {
  packs: [
    { id: "core", version: "0.1.0" },
    { id: "frost", version: "1.2.0" },
  ],
  loadOrder: ["core", "frost"],
  determinism: "deterministic",
  modNoscore: false,
};

function makeSave(): SavedGame {
  return {
    version: 2,
    player: { equipment: [0, 0, 41] },
    gear: {
      next: 100,
      pack: [40, 42],
      store: [
        [40, { kindId: "core:sword:dagger" }],
        [41, { kindId: "frost:ice-brand" }],
        [42, { kindId: "frost:snow-boots" }],
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
    floor: [{ x: 6, y: 6, objs: [{ kindId: "frost:ice-shard" }] }],
    traps: [{ x: 2, y: 2, traps: [{ trapId: "frost:ice-spikes" }] }],
    lore: [["frost:frost-wyrm", { sights: 1 }]],
    artifactsCreated: ["frost:icicle-of-doom"],
  } as unknown as SavedGame;
}

const coreOnly = (ns: string): boolean => ns === "core";

function quarantined(): SavedGame["orphans"] {
  return quarantineSave(makeSave(), manifest, coreOnly).orphans;
}

describe("parseOrphanKey", () => {
  it("splits the store key the quarantine writes", () => {
    expect(parseOrphanKey("frost@1.2.0")).toEqual({ namespace: "frost", version: "1.2.0" });
  });
  /* The FIRST '@', because that is the one rehydrateSave splits on when it
   * decides whether a key's pack is present. A namespace naming a pack this
   * screen shows but rehydrate would never match is the failure to avoid. */
  it("splits on the first @, exactly as rehydrateSave does", () => {
    expect(parseOrphanKey("frost@1.2.0-rc.1+build@2")).toEqual({
      namespace: "frost",
      version: "1.2.0-rc.1+build@2",
    });
  });
  it("treats a key with no version as all namespace", () => {
    expect(parseOrphanKey("frost")).toEqual({ namespace: "frost", version: "" });
  });
});

describe("orphanCategory", () => {
  const entry = (kind: OrphanEntry["kind"], locus: OrphanEntry["locus"] = 0): OrphanEntry => ({
    kind,
    ref: "frost:thing",
    data: null,
    locus,
  });

  it("separates a worn item from a carried one, which is the same kind twice", () => {
    expect(orphanCategory(entry("gearObject", { handle: 41, equipSlots: [2] }))).toBe("worn");
    expect(orphanCategory(entry("gearObject", { handle: 40, equipSlots: [] }))).toBe("carried");
  });

  it("folds the four frozen-level-cache kinds into one fact", () => {
    for (const kind of ["cacheMonster", "cacheHeldObject", "cacheFloorObject", "cacheTrap"] as const) {
      expect(orphanCategory(entry(kind))).toBe("cached");
    }
  });

  it("marks group bookkeeping as a link rather than as a thing the player owns", () => {
    for (const kind of ["group", "groupMembership", "cacheGroup", "cacheGroupMembership"] as const) {
      expect(orphanCategory(entry(kind))).toBe("link");
    }
  });
});

describe("orphanStash", () => {
  it("is empty rather than null when nothing is quarantined", () => {
    expect(orphanStash(undefined)).toEqual({ groups: [], total: 0 });
    expect(orphanStash({})).toEqual({ groups: [], total: 0 });
  });

  it("groups everything under the pack that owned it, at the save's version", () => {
    const stash = orphanStash(quarantined());
    expect(stash.groups.length).toBe(1);
    const group = stash.groups[0]!;
    expect(group.key).toBe("frost@1.2.0");
    expect(group.namespace).toBe("frost");
    expect(group.version).toBe("1.2.0");
  });

  /* The prompt counts entries and the screen lists them; if the two disagreed a
   * player would be offered "purge 9 items" over a screen showing 7. */
  it("counts every entry, so the total matches orphanCount exactly", () => {
    const store = quarantined();
    const stash = orphanStash(store);
    expect(stash.total).toBe(orphanCount(store));
    const group = stash.groups[0]!;
    expect(group.total).toBe(group.items.length + group.links);
    expect(stash.groups.reduce((n, g) => n + g.total, 0)).toBe(stash.total);
  });

  it("lists entities and counts the group links instead of listing them", () => {
    const group = orphanStash(quarantined()).groups[0]!;
    expect(group.links).toBeGreaterThan(0);
    expect(group.items.every((i) => i.category !== "link")).toBe(true);
  });

  it("names the worn item, the carried item, and what each one is", () => {
    const items = orphanStash(quarantined()).groups[0]!.items;
    const brand = items.find((i) => i.ref === "frost:ice-brand");
    expect(brand).toEqual({
      kind: "gearObject",
      category: "worn",
      ref: "frost:ice-brand",
      name: "ice-brand",
    });
    expect(items.find((i) => i.ref === "frost:snow-boots")?.category).toBe("carried");
    expect(items.find((i) => i.ref === "frost:frost-wyrm")?.category).toBe("monster");
    expect(items.find((i) => i.ref === "frost:ice-shard")?.category).toBe("floor");
    expect(items.find((i) => i.ref === "frost:ice-spikes")?.category).toBe("trap");
    expect(items.find((i) => i.ref === "frost:snowball")?.category).toBe("held");
    expect(items.find((i) => i.ref === "frost:icicle-of-doom")?.category).toBe("artifact");
  });

  it("keeps a bare id whole when it has no namespace to strip", () => {
    const stash = orphanStash({
      "frost@1.0.0": [{ kind: "artifactCreated", ref: "icicle", data: "icicle", locus: "icicle" }],
    });
    expect(stash.groups[0]!.items[0]!.name).toBe("icicle");
  });

  it("sorts groups by namespace then version, so the screen does not shuffle", () => {
    const one: OrphanEntry = { kind: "artifactCreated", ref: "x:y", data: "x:y", locus: "x:y" };
    const stash = orphanStash({
      "zeta@1.0.0": [one],
      "frost@2.0.0": [one],
      "frost@1.0.0": [one],
    });
    expect(stash.groups.map((g) => g.key)).toEqual(["frost@1.0.0", "frost@2.0.0", "zeta@1.0.0"]);
  });

  describe("availability", () => {
    const store = { "frost@1.2.0": [{ kind: "lore", ref: "frost:w", data: null, locus: "frost:w" }] } as const;
    const ask = (deps: Parameters<typeof orphanStash>[1]): string =>
      orphanStash(store as unknown as SavedGame["orphans"], deps).groups[0]!.availability;

    it("says absent when the host looked and the pack is not there", () => {
      expect(ask({ present: new Set(["core"]), installed: new Set(["core"]) })).toBe("absent");
    });
    it("says disabled when the pack is installed but did not compose", () => {
      expect(ask({ present: new Set(["core"]), installed: new Set(["core", "frost"]) })).toBe("disabled");
    });
    /* An entry keyed to a PRESENT namespace is not a contradiction: rehydrate
     * leaves an entry it could not reinsert in the store rather than throwing. */
    it("says present when the pack composed and the entry stayed behind anyway", () => {
      expect(ask({ present: new Set(["core", "frost"]) })).toBe("present");
    });
    it("says unknown rather than absent when the host supplied nothing to look in", () => {
      expect(ask({})).toBe("unknown");
      expect(ask(undefined)).toBe("unknown");
    });
  });
});

describe("orphanPromptDue (decision 8)", () => {
  it("is due once, on a save with something quarantined that has not been asked", () => {
    expect(orphanPromptDue(quarantined(), false)).toBe(true);
  });
  it("never nags a save that has already answered, either way", () => {
    expect(orphanPromptDue(quarantined(), true)).toBe(false);
  });
  it("is not due with nothing quarantined", () => {
    expect(orphanPromptDue({}, false)).toBe(false);
    expect(orphanPromptDue(undefined, false)).toBe(false);
  });
});

describe("purgeOrphans (decision 8's destructive half)", () => {
  it("returns an empty store rather than emptying the caller's", () => {
    const store = quarantined()!;
    const before = orphanCount(store);
    expect(before).toBeGreaterThan(0);
    expect(purgeOrphans()).toEqual({});
    expect(orphanCount(store)).toBe(before);
  });
});
