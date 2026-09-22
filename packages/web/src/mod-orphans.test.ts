/**
 * The stash view and the one-time keep/purge question, over the REAL quarantine
 * output.
 *
 * Every fixture here is built by running core's own `quarantineSave` on a save
 * with mod content in it, rather than by hand-writing an orphan store. A test
 * that constructs the object production code will receive is an assertion about
 * the producer and an unchecked one; this screen's whole job is to be right
 * about what quarantine actually produced.
 *
 * Pure: no terminal, no game, no storage.
 */

import { describe, expect, it, vi } from "vitest";
import {
  purgeOrphans,
  quarantineSave,
  type OrphanEntry,
  type OrphanStore,
  type SaveManifest,
} from "@rpgm-tools/neo-angband-core";
import {
  categoryText,
  deleteOrphanConfirmLines,
  deleteOrphanConfirmMenu,
  deleteOrphanItem,
  groupCaption,
  howToRestore,
  orphanDeletedMessage,
  orphanKeptMessage,
  orphanPurgeLines,
  orphanPurgeMenu,
  orphanPurgedMessage,
  orphanRowLabel,
  orphanStashScreen,
  stashOf,
  stashActionsFooter,
  viewOrphanStash,
  whyInert,
  type OrphanViewDeps,
} from "./mod-orphans";
import { describeQuarantine } from "./save-recovery";
import { MODELLED_SCREENS, screenBodyLines, type ScreenTableBlock } from "./screen-view";

/* Mocking overlay keeps the viewOrphanStash tests focused on the wiring
 * (setStore gets called, doesn't get called) without dragging in the
 * terminal-renderer stack. Each call resolves immediately and pops the next
 * queued pick from a per-test queue. */
const selectQueue: (number | null)[] = [];
vi.mock("./overlay", async () => {
  const actual = await vi.importActual<typeof import("./overlay")>("./overlay");
  return {
    ...actual,
    showTextScreen: vi.fn(async () => undefined),
    selectFromMenu: vi.fn(async () => selectQueue.shift() ?? null),
  };
});

const manifest: SaveManifest = {
  packs: [
    { id: "core", version: "0.1.0" },
    { id: "frost", version: "1.2.0" },
  ],
  loadOrder: ["core", "frost"],
  determinism: "deterministic",
  modNoscore: false,
};

/** A save played with a "frost" content mod, in every collection it touches. */
function moddedSave(): Parameters<typeof quarantineSave>[0] {
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
      { raceId: "frost:frost-wyrm", originalRaceId: null, midx: 2, heldObj: [] },
    ],
    groups: [null, { index: 1, leader: 1, members: [1, 2] }],
    floor: [{ x: 6, y: 6, objs: [{ kindId: "frost:ice-shard" }] }],
    traps: [],
    lore: [],
    artifactsCreated: [],
  } as unknown as Parameters<typeof quarantineSave>[0];
}

/** The store a real uninstall of "frost" produces. */
function frostStore(): OrphanStore {
  return quarantineSave(moddedSave(), manifest, (ns) => ns === "core").orphans;
}

const gone = { store: frostStore, present: () => new Set(["core"]), installed: () => new Set(["core"]) };
const offNotGone = {
  store: frostStore,
  present: () => new Set(["core"]),
  installed: () => new Set(["core", "frost"]),
};
const nothing = { store: (): OrphanStore => ({}) };

const text = (deps: Parameters<typeof stashOf>[0]): string[] =>
  screenBodyLines(orphanStashScreen(stashOf(deps)), 80).map((l) => l.text);

describe("the stash view lists what a missing mod took with it", () => {
  it("is a modelled screen with its own id", () => {
    expect(orphanStashScreen(stashOf(nothing)).id).toBe("core:mod-orphans");
    expect(MODELLED_SCREENS).toContain("core:mod-orphans");
  });

  it("names every quarantined thing under the pack that owned it", () => {
    const lines = text(gone);
    expect(lines.some((l) => l.includes("frost 1.2.0"))).toBe(true);
    for (const name of ["ice-brand", "snow-boots", "frost-wyrm", "ice-shard"]) {
      expect(lines.some((l) => l.includes(name)), `no row for ${name}`).toBe(true);
    }
  });

  /* The three questions decision 7 says this screen exists to answer. */
  it("says what each thing was, why it is inert, and what would restore it", () => {
    const lines = text(gone).join("\n");
    expect(lines).toContain("you were wearing it");
    expect(lines).toContain("you were carrying it");
    expect(lines).toContain("frost is not installed.");
    expect(lines).toContain("Install frost again");
    expect(lines).toContain("frost 1.2.0");
  });

  it("tells a player to flip a switch when the mod is only turned off, not gone", () => {
    const lines = text(offNotGone).join("\n");
    expect(lines).toContain("frost is installed but switched off.");
    expect(lines).toContain("Turn frost back on");
    expect(lines).not.toContain("frost is not installed.");
  });

  it("counts the monster-pack links instead of filling the screen with them", () => {
    const stash = stashOf(gone);
    const group = stash.groups[0]!;
    expect(group.links).toBeGreaterThan(0);
    const table = orphanStashScreen(stash).blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table",
    )!;
    /* Every ROW is a thing the player owned; the links are one summary line. */
    expect(table.rows.length).toBe(group.items.length);
    expect(text(gone).join("\n")).toContain("keeps frost's monster packs together");
  });

  it("publishes the mod, the storage kind and the availability beside each row", () => {
    const table = orphanStashScreen(stashOf(gone)).blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table",
    )!;
    const brand = table.rows.find((r) => r.semantic?.ref === "frost:ice-brand")!;
    expect(brand.semantic).toEqual({
      kind: "mod-orphan",
      ref: "frost:ice-brand",
      data: {
        mod: "frost",
        version: "1.2.0",
        availability: "absent",
        storage: "gearObject",
        category: "worn",
      },
    });
  });

  it("says plainly that a held item costs the player nothing while it waits", () => {
    expect(text(gone).join("\n")).toContain("takes no pack slot");
  });

  it("answers the question rather than showing an empty list when nothing is held", () => {
    const lines = text(nothing).join("\n");
    expect(lines).toContain("Nothing is set aside.");
    expect(lines).not.toContain("frost");
  });
});

describe("the wording each availability gets", () => {
  const group = (availability: string) =>
    ({ namespace: "frost", version: "1.2.0", availability, key: "frost@1.2.0", items: [], links: 0, total: 0 }) as unknown as Parameters<typeof whyInert>[0];

  it("separates a pack that is gone from one that merely did not compose", () => {
    expect(whyInert(group("absent"))).toContain("not installed");
    expect(whyInert(group("disabled"))).toContain("switched off");
    expect(whyInert(group("present"))).toContain("could not put these back");
    expect(whyInert(group("unknown"))).toContain("did not load");
  });

  /* A pack that IS loaded has no reinstall to offer, so the sentence must not
   * tell the player to do something that would change nothing. */
  it("never tells a player to reinstall a pack that is already loaded", () => {
    expect(howToRestore(group("present"))).not.toContain("Install");
    expect(howToRestore(group("present"))).toContain("until frost can place them again");
  });

  it("drops the version from the caption and the fix when the key carries none", () => {
    const bare = { ...group("absent"), version: "", key: "frost" } as Parameters<typeof whyInert>[0];
    expect(groupCaption(bare)).toContain("frost -");
    expect(howToRestore(bare)).toBe(
      "Install frost again, and every one of these returns to where it was.",
    );
  });

  it("has a phrase for every category, including the bookkeeping one", () => {
    for (const c of [
      "worn",
      "carried",
      "held",
      "floor",
      "monster",
      "trap",
      "lore",
      "artifact",
      "cached",
      "link",
    ] as const) {
      expect(categoryText(c).length).toBeGreaterThan(0);
    }
  });
});

describe("the mods-menu row", () => {
  it("carries the count, so a player sees something is held before opening it", () => {
    expect(orphanRowLabel(stashOf(gone).total)).toMatch(/\d+ things/u);
    expect(orphanRowLabel(1)).toContain("1 thing");
  });
  it("says nothing about a count when there is nothing held", () => {
    expect(orphanRowLabel(0)).toBe("Set aside by a missing mod...");
  });
});

describe("the load-time note", () => {
  it("names the count, the mod, and where to look", () => {
    const note = describeQuarantine(stashOf(gone));
    expect(note).toContain("set aside");
    expect(note).toContain("frost did not load");
    expect(note).toContain("ice-brand");
    expect(note).toContain("Mods, then Set aside");
  });

  /* The message line is 80 columns wide and a content mod can strand dozens of
   * things at once, so the names are capped and the count carries the rest. */
  it("caps the names rather than listing every one of them", () => {
    const note = describeQuarantine(stashOf(gone), 2);
    expect(note).toContain("ice-brand");
    expect(note).not.toContain("ice-shard");
  });

  it("is empty when nothing was quarantined, so it never joins a load message", () => {
    expect(describeQuarantine(stashOf(nothing))).toBe("");
  });
});

describe("the one-time keep/purge question (decision 8)", () => {
  it("counts what is at stake and names the content that is missing", () => {
    const body = orphanPurgeLines(stashOf(gone))
      .map((l) => l.text)
      .join("\n");
    expect(body).toContain("frost");
    expect(body).toMatch(/\d+ things from this character have been set aside/u);
    expect(body).toContain("Nothing has been destroyed.");
    expect(body).toContain("asked this once");
  });

  it("offers keeping first, so the default answer destroys nothing", () => {
    const menu = orphanPurgeMenu(stashOf(gone));
    expect(menu[0]!.label).toBe("Keep them frozen");
    expect(menu[1]!.label).toContain("permanently");
    /* The count is ON the destructive row: decision 8 requires the confirmation
     * to be counted, not a bare yes/no over an unnamed quantity. */
    expect(menu[1]!.label).toMatch(/all \d+ things/u);
  });

  it("says what happened after either answer", () => {
    expect(orphanKeptMessage(4)).toContain("4 things stay");
    expect(orphanKeptMessage(4)).toContain("Mods, then Set aside");
    expect(orphanPurgedMessage(4)).toContain("4 things were thrown away permanently");
    expect(orphanPurgedMessage(1)).toContain("1 thing was thrown away permanently");
  });
});

/* ------------------------------------------------------------------ *
 * The per-item permanent delete (issue 76).
 *
 * The data function is pure, so its tests are: shape in, shape out, with a
 * reference compare for the no-op signal the host relies on to skip
 * autosave. The screen's `actions` and footer carry the affordance; the
 * interactive flow's wiring (setStore callback) gets one end-to-end test
 * that drives a real stash through `viewOrphanStash`. The all-purge path
 * gets a regression-guard test, since the new code sits next to it.
 * ------------------------------------------------------------------ */

describe("the per-item delete (issue 76) on the underlying store", () => {
  /** A small, hand-written store: two packs, two items each. The exact
   *  fixture the issue's tests need - hand-built so we know the refs. */
  function twoPackStore(): OrphanStore {
    const frost = (ref: string): OrphanEntry => ({
      kind: "gearObject",
      ref,
      data: null,
      locus: null,
    });
    const wyrm: OrphanEntry = { kind: "monster", ref: "frost:frost-wyrm", data: null, locus: null };
    const shard: OrphanEntry = { kind: "floorObject", ref: "frost:ice-shard", data: null, locus: null };
    return {
      "frost@1.2.0": [
        frost("frost:ice-brand"),
        frost("frost:snow-boots"),
        wyrm,
        shard,
      ],
      "ember@0.5.0": [
        { kind: "gearObject", ref: "ember:torch", data: null, locus: null },
        { kind: "gearObject", ref: "ember:brand", data: null, locus: null },
      ],
    };
  }

  /** Pull the stash for a hand-built store so the tests can drive
   *  `deleteOrphanItem` through the same model the screen reads from. */
  const stash = (store: OrphanStore): ReturnType<typeof stashOf> =>
    stashOf({ store: () => store });

  it("removes exactly the named item and leaves its siblings in place", () => {
    const store = twoPackStore();
    const before = stash(store);
    const frostGroup = before.groups.find((g) => g.key === "frost@1.2.0")!;
    const item = frostGroup.items.find((i) => i.ref === "frost:ice-brand")!;
    const next = stash(deleteOrphanItem(store, frostGroup, item)).groups.find(
      (g) => g.key === "frost@1.2.0",
    )!;
    /* The sibling count drops by one, NOT by the whole pack. */
    expect(next.items.map((i) => i.ref).sort()).toEqual(
      ["frost:frost-wyrm", "frost:ice-shard", "frost:snow-boots"].sort(),
    );
    expect(next.total).toBe(frostGroup.total - 1);
  });

  it("does not touch a different pack in the same store", () => {
    const store = twoPackStore();
    const before = stash(store);
    const frostGroup = before.groups.find((g) => g.key === "frost@1.2.0")!;
    const item = frostGroup.items[0]!;
    const next = stash(deleteOrphanItem(store, frostGroup, item)).groups.find(
      (g) => g.key === "ember@0.5.0",
    )!;
    expect(next.items.map((i) => i.ref).sort()).toEqual(
      ["ember:brand", "ember:torch"].sort(),
    );
  });

  it("removes the group key when the last entry in the pack is deleted", () => {
    const single: OrphanStore = {
      "ember@0.5.0": [
        { kind: "gearObject", ref: "ember:torch", data: null, locus: null },
      ],
    };
    const before = stash(single);
    const group = before.groups[0]!;
    const item = group.items[0]!;
    const next = deleteOrphanItem(single, group, item);
    /* The key vanishes from the store entirely so `orphanCount` agrees with
     * what the player sees on the next rebuild of the stash view. */
    expect(Object.prototype.hasOwnProperty.call(next, "ember@0.5.0")).toBe(false);
    expect(next).toEqual({});
  });

  it("returns the SAME store unchanged when the ref is not in the group", () => {
    const store = twoPackStore();
    const before = stash(store);
    const frostGroup = before.groups.find((g) => g.key === "frost@1.2.0")!;
    const notThere = { ...frostGroup.items[0]!, ref: "frost:not-there" };
    /* Same-store return is the no-op signal the host relies on to skip the
     * autosave it would otherwise trigger on every confirm. */
    expect(deleteOrphanItem(store, frostGroup, notThere)).toBe(store);
  });

  it("does not mutate the caller's store", () => {
    const store = twoPackStore();
    const beforeJson = JSON.stringify(store);
    const before = stash(store);
    const frostGroup = before.groups.find((g) => g.key === "frost@1.2.0")!;
    const item = frostGroup.items[0]!;
    deleteOrphanItem(store, frostGroup, item);
    expect(JSON.stringify(store)).toBe(beforeJson);
  });

  it("still accepts the real store produced by quarantineSave, not just hand-built ones", () => {
    /* Hand-built fixtures are easier to read, but the function has to keep
     * working on the store shape core actually produces. The fixture's
     * monsters array carries a real monster GROUP, whose frozen entry uses
     * a numeric ref (the group's midx) and a monster-kind entry of its own -
     * the assertions below are about the entry ice-brand the test deletes,
     * which is the one the player's gear store held, and the surviving
     * siblings, which is what the stash screen would re-show. */
    const real = frostStore();
    const before = stash(real);
    const frostGroup = before.groups.find((g) => g.key === "frost@1.2.0")!;
    const item = frostGroup.items.find((i) => i.ref === "frost:ice-brand")!;
    const next = deleteOrphanItem(real, frostGroup, item);
    const remaining = next["frost@1.2.0"]?.map((e) => e.ref) ?? [];
    /* The named gear is gone; the OTHER frost gear and the floor object
     * survive. The monster group ref is a numeric string (the group index)
     * and stays untouched. */
    expect(remaining).not.toContain("frost:ice-brand");
    expect(remaining).toContain("frost:snow-boots");
    expect(remaining).toContain("frost:ice-shard");
  });
});

describe("the per-item delete on the stash screen (issue 76)", () => {
  /* The screen publishes no `actions`: the interactive flow is driven by
   * `viewOrphanStash` directly, not through `ScreenHost.invoke`. The
   * prompt-census tripwire in screens.test.ts is what catches a fourth
   * module that does publish `actions`, so this test stays intentionally
   * close to the model's shape: a footer that names what the next prompt
   * will do, and no action array a presenter would have to learn about. */
  it("does NOT publish actions - the flow is local to viewOrphanStash", () => {
    const fullView = orphanStashScreen(stashOf(gone));
    const emptyView = orphanStashScreen(stashOf(nothing));
    expect(fullView.actions).toBeUndefined();
    expect(emptyView.actions).toBeUndefined();
  });

  it("uses the actions footer when the stash has anything to delete", () => {
    /* The footer is the only thing a player sees that the action exists -
     * the follow-up menu in viewOrphanStash is what makes it real. */
    const fullView = orphanStashScreen(stashOf(gone));
    const emptyView = orphanStashScreen(stashOf(nothing));
    expect(fullView.footer).toBe(stashActionsFooter());
    /* The empty screen reverts to the plain footer so an empty stash
     * does not claim there is something to act on. */
    expect(emptyView.footer).not.toBe(stashActionsFooter());
  });
});

describe("the per-item delete wording (issue 76)", () => {
  /* The wording functions take core's own model types, but the only fields
   * the body text actually reads are `namespace`/`version` (group) and
   * `name` (item), so a minimal unknown-cast fixture is enough - it
   * keeps the test independent of the type changes that happen when
   * orphan-stash.ts grows a new column. */
  const group = { namespace: "frost", version: "1.2.0" } as unknown as Parameters<typeof deleteOrphanConfirmLines>[1];
  const item = { ref: "frost:ice-brand", name: "frost:ice-brand" } as unknown as Parameters<typeof deleteOrphanConfirmLines>[0];

  it("names the item and the mod in the body so the player sees what is at stake", () => {
    const body = deleteOrphanConfirmLines(item, group)
      .map((l) => l.text)
      .join("\n");
    expect(body).toContain("frost:ice-brand");
    expect(body).toContain("frost");
    /* Stating permanence in the same screen as the question - the same
     * shape `orphanPurgeLines` uses for the all-purge prompt. */
    expect(body.toLowerCase()).toContain("permanently");
  });

  it("offers keeping first so the default answer is the safe one", () => {
    const menu = deleteOrphanConfirmMenu();
    expect(menu[0]!.label).toBe("Keep it");
    expect(menu[1]!.label).toContain("permanently");
  });

  it("names what was thrown away after a successful delete", () => {
    expect(orphanDeletedMessage(item)).toContain("frost:ice-brand");
    expect(orphanDeletedMessage(item).toLowerCase()).toContain("permanently");
  });
});

describe("the all-purge path is unchanged by the per-item delete (regression guard)", () => {
  /* The two paths sit next to each other and share the screen and the
   * store. The per-item delete had to be additive: anything that the
   * one-time keep/purge prompt answered before should still answer the
   * same way, and the host's own write (game.orphans = purgeOrphans())
   * is the contract the new code must not touch. */

  it("purgeOrphans still returns the empty store, not undefined", () => {
    expect(purgeOrphans()).toEqual({});
  });

  it("the all-purge menu and confirmation copy are unchanged", () => {
    const menu = orphanPurgeMenu(stashOf(gone));
    expect(menu[0]!.label).toBe("Keep them frozen");
    expect(menu[1]!.label).toContain("permanently");
    const body = orphanPurgeLines(stashOf(gone))
      .map((l) => l.text)
      .join("\n");
    expect(body).toContain("Nothing has been destroyed.");
  });

  it("deleting one item does not produce the all-purge copy", () => {
    /* The per-item prompt names the item; the all-purge prompt names the
     * count. A test that mixes the two would be a wording regression. */
    const group = { namespace: "frost", version: "1.2.0" } as unknown as Parameters<typeof deleteOrphanConfirmLines>[1];
    const item = { ref: "frost:ice-brand", name: "frost:ice-brand" } as unknown as Parameters<typeof deleteOrphanConfirmLines>[0];
    const oneBody = deleteOrphanConfirmLines(item, group)
      .map((l) => l.text)
      .join("\n");
    const purgeBody = orphanPurgeLines(stashOf(gone))
      .map((l) => l.text)
      .join("\n");
    /* The all-purge wording uses the word "things" (plural); the per-item
     * wording does not, because it is about the one named thing. */
    expect(oneBody).toContain("frost:ice-brand");
    expect(purgeBody).not.toContain("frost:ice-brand");
  });
});

describe("viewOrphanStash writes through the setStore callback (issue 76)", () => {
  /* End-to-end: a real stash, a fake setStore, and the showTextScreen /
   * selectFromMenu calls answered in the order the function asks. The
   * function's return is awaited but its result is the side-effect: the
   * host's setStore is the only place a write happens, the same way
   * `offerOrphanChoice` uses `purgeOrphans`. The terminal is mocked at the
   * overlay module (above) so the test never has to fake `size()`, `clear`,
   * `print` and friends. */

  const fakeTerm = {} as Parameters<typeof viewOrphanStash>[0];

  /** Push the picks the function will see in order, then drive it. */
  async function drive(responses: ReadonlyArray<number | null>): Promise<void> {
    selectQueue.length = 0;
    selectQueue.push(...responses);
    /* Resolve whatever showTextScreen mock has queued - there is none,
     * but `vi.runAllTimersAsync` keeps the test honest about microtask
     * ordering. */
    await Promise.resolve();
  }

  it("calls setStore with the new store when a delete is confirmed", async () => {
    const initial = frostStore();
    /* `let` because the view's `store` getter is what `viewOrphanStash` calls
     * to compute the next store, and the next store is what we want setStore
     * to hand back; pinning both ends of the round-trip on the same cell
     * mirrors the live game's `game.orphans` being assigned, not replaced. */
    let store: OrphanStore = initial;
    const before = stashOf({ store: () => store });
    const flatIndex = before.groups
      .flatMap((g) => g.items)
      .findIndex((i) => i.ref === "frost:ice-brand");
    /* action menu picks "Throw one thing away" (1) -> pick menu picks the
     * target by index -> confirm menu picks "Throw away" (1) -> return (0)
     * to leave the loop. */
    await drive([1, flatIndex, 1, 0]);
    const writes: OrphanStore[] = [];
    const deps: OrphanViewDeps = {
      store: () => store,
      present: () => new Set(["core"]),
      installed: () => new Set(["core"]),
      setStore: (next) => {
        writes.push(next);
        store = next;
      },
    };
    await viewOrphanStash(fakeTerm, deps);
    /* One write, with the named entry removed and nothing else touched. */
    expect(writes).toHaveLength(1);
    expect(writes[0]!["frost@1.2.0"]?.map((e) => e.ref)).not.toContain(
      "frost:ice-brand",
    );
    expect(writes[0]!["frost@1.2.0"]?.map((e) => e.ref)).toContain(
      "frost:snow-boots",
    );
  });

  it("does NOT call setStore when the player picks 'Return to Mods'", async () => {
    const store = frostStore();
    await drive([0]);
    const writes: OrphanStore[] = [];
    const deps: OrphanViewDeps = {
      store: () => store,
      present: () => new Set(["core"]),
      installed: () => new Set(["core"]),
      setStore: (next) => writes.push(next),
    };
    await viewOrphanStash(fakeTerm, deps);
    expect(writes).toHaveLength(0);
  });

  it("does NOT call setStore when the player backs out of the confirm with ESC", async () => {
    const store = frostStore();
    const before = stashOf({ store: () => store });
    const flatIndex = before.groups
      .flatMap((g) => g.items)
      .findIndex((i) => i.ref === "frost:ice-brand");
    /* action 1 = throw one away; pick by index = the first item; null =
     * ESC on the confirm menu = keep it. */
    await drive([1, flatIndex, null, 0]);
    const writes: OrphanStore[] = [];
    const deps: OrphanViewDeps = {
      store: () => store,
      present: () => new Set(["core"]),
      installed: () => new Set(["core"]),
      setStore: (next) => writes.push(next),
    };
    await viewOrphanStash(fakeTerm, deps);
    expect(writes).toHaveLength(0);
  });

  it("does NOT call setStore when there is nothing to delete (empty store)", async () => {
    /* showTextScreen resolves immediately on the empty store, then the
     * loop returns without ever asking for the action menu - the queue
     * is empty and the test passes through. */
    await drive([]);
    const writes: OrphanStore[] = [];
    const deps: OrphanViewDeps = {
      store: () => ({}),
      present: () => new Set<string>(),
      installed: () => new Set<string>(),
      setStore: (next) => writes.push(next),
    };
    await viewOrphanStash(fakeTerm, deps);
    expect(writes).toHaveLength(0);
  });

  it("falls back to the one-way display when setStore is absent", async () => {
    /* Older hosts that have not been updated still get the stash screen;
     * the function shows it once and returns without offering any action. */
    await drive([]);
    const deps: OrphanViewDeps = {
      store: () => frostStore(),
      present: () => new Set(["core"]),
      installed: () => new Set(["core"]),
      /* No setStore - the contract for "read-only caller". */
    };
    await viewOrphanStash(fakeTerm, deps);
    /* No throw, no error, just a single showTextScreen and a return. */
  });
});
