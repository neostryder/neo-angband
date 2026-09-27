import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CharMeta } from "./roster";
import {
  deleteSlot,
  getActiveId,
  lineageOf,
  listDeaths,
  listRoster,
  markDead,
  rosterReadableFrom,
  setActiveId,
  setRosterStorage,
  upsertMeta,
  writeSlot,
} from "./roster";

/**
 * A localStorage stand-in whose writes can be made to fail, the way a browser's
 * does when the origin's quota is exhausted.
 */
class FakeStorage {
  private map = new Map<string, string>();
  /** Throw QuotaExceededError on every setItem while true. */
  full = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function meta(id: string, over: Partial<CharMeta> = {}): CharMeta {
  return {
    id,
    name: "Test",
    race: "Human",
    cls: "Warrior",
    sex: "",
    level: 1,
    depth: 0,
    maxDepth: 0,
    turn: 0,
    alive: true,
    updatedAt: 1,
    ...over,
  } as CharMeta;
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  // roster.ts caches its backing storage (setRosterStorage, neo-angband#163's
  // profile-scoping seam) rather than re-reading globalThis.localStorage on
  // every call, so a fresh fake has to be pushed in explicitly each test.
  setRosterStorage(storage);
});

afterEach(() => {
  setRosterStorage(null);
});

describe("the roster reports a failed write (ui-game.c:1152-1166)", () => {
  it("writeSlot succeeds and is readable when storage accepts it", () => {
    expect(writeSlot("a", "AAAA", meta("a"))).toBe(true);
    expect(listRoster().map((c) => c.id)).toEqual(["a"]);
  });

  it("writeSlot reports FALSE when the quota is exhausted", () => {
    /* The whole point: setItem used to swallow this, so writeSlot claimed
     * success while nothing was stored and the player was told nothing. */
    storage.full = true;
    expect(writeSlot("a", "AAAA", meta("a"))).toBe(false);
    expect(listRoster()).toEqual([]);
  });

  it("writeSlot reports FALSE when only the metadata write fails", () => {
    /* A save whose metadata did not land cannot be offered by the character
     * select, so the bytes landing alone is still a failed save. */
    let calls = 0;
    const raw = storage.setItem.bind(storage);
    storage.setItem = (k: string, v: string): void => {
      calls += 1;
      if (calls === 2) throw new Error("quota"); // the upsertMeta write
      raw(k, v);
    };
    expect(writeSlot("a", "AAAA", meta("a"))).toBe(false);
  });

  it("upsertMeta reports FALSE when the quota is exhausted", () => {
    storage.full = true;
    expect(upsertMeta(meta("a"))).toBe(false);
  });

  it("markDead reports FALSE when the tombstone cannot be written", () => {
    /* Death is terminal, so the tombstone IS the port's dead-player save; a
     * failed write loses the memorial and earns "death save failed!". */
    expect(writeSlot("a", "AAAA", meta("a"))).toBe(true);
    storage.full = true;
    expect(markDead("a")).toBe(false);
  });

  it("markDead of an unknown id is not a failure", () => {
    /* No metadata means there was nothing to tombstone. */
    expect(markDead("nobody")).toBe(true);
  });
});

describe("a death outlives its tombstone (the import gate's ledger)", () => {
  it("records the lineage, name and turn of a death", () => {
    writeSlot("a", "AAAA", meta("a", { name: "Grond", turn: 50_000, lineage: "lin-1" }));
    expect(markDead("a")).toBe(true);
    expect(listDeaths()).toEqual([
      { lineage: "lin-1", name: "Grond", turn: 50_000, at: expect.any(Number) },
    ]);
  });

  it("survives deleting the tombstone from the picker", () => {
    /* The whole reason the ledger is a separate key. Del on a memorial is a
     * legitimate thing for a player to do; forgetting the death is not. */
    writeSlot("a", "AAAA", meta("a", { lineage: "lin-1" }));
    markDead("a");
    deleteSlot("a");
    expect(listRoster()).toEqual([]);
    expect(listDeaths().map((d) => d.lineage)).toEqual(["lin-1"]);
  });

  it("records the SLOT ID for a character born before lineages existed", () => {
    /* lineageOf's fallback, at the one place that matters: a pre-lineage
     * character's export carries their slot id, so the death has to be filed
     * under the same string or the file would import over the grave. */
    writeSlot("born-here", "AAAA", meta("born-here"));
    markDead("born-here");
    expect(listDeaths().map((d) => d.lineage)).toEqual(["born-here"]);
    expect(lineageOf({ id: "born-here" })).toBe("born-here");
    expect(lineageOf({ id: "slot", lineage: "" })).toBe("slot");
  });

  it("keeps one record per lineage, not one per death", () => {
    /* A character can only die once, but an imported-then-died-again lineage
     * would otherwise accumulate rows and the newest is the one that is true. */
    writeSlot("a", "AAAA", meta("a", { lineage: "lin-1", turn: 10 }));
    markDead("a");
    writeSlot("b", "AAAA", meta("b", { lineage: "lin-1", turn: 20 }));
    markDead("b");
    expect(listDeaths()).toHaveLength(1);
    expect(listDeaths()[0]?.turn).toBe(20);
  });

  it("a ledger write that fails does not fail the death save", () => {
    /* Priorities: the tombstone IS the dead-player save (ui-game.c:1152). A
     * ledger that cannot be written costs an anti-scum check, not a memorial -
     * so this asserts the ORDER of those two failures, not just that one throws
     * nothing. */
    writeSlot("a", "AAAA", meta("a", { lineage: "lin-1" }));
    const raw = storage.setItem.bind(storage);
    storage.setItem = (k: string, v: string): void => {
      if (k === "neo-angband-death-records") throw new Error("quota");
      raw(k, v);
    };
    expect(markDead("a")).toBe(true);
    expect(listRoster()[0]?.alive).toBe(false);
    expect(listDeaths()).toEqual([]);
  });

  it("reads a corrupt or half-written ledger as empty", () => {
    storage.setItem("neo-angband-deaths", "{not json");
    expect(listDeaths()).toEqual([]);
    expect(storage.getItem("neo-angband-deaths")).toBe("{not json");
    storage.setItem("neo-angband-deaths", JSON.stringify([{ name: "no lineage" }, 7, null]));
    expect(listDeaths()).toEqual([]);
  });

  it("converts a previous roster array once, and leaves a future document untouched", () => {
    storage.setItem(
      "neo-angband-roster",
      JSON.stringify([{ id: "a", name: "Grond", race: "Human", cls: "Warrior", sex: "", level: 3, depth: 1, maxDepth: 2, turn: 40, alive: true, updatedAt: 1_700_000_000_000 }]),
    );
    expect(listRoster().map((c) => c.name)).toEqual(["Grond"]);
    expect(storage.getItem("neo-angband-roster")).toBeNull();
    const document = storage.getItem("neo-angband-character-roster");
    expect(document).toContain("neo-angband/web/character-roster");
    expect(listRoster()[0]?.updatedAt).toBe(1_700_000_000_000);
    const again = storage.getItem("neo-angband-character-roster");
    expect(again).toBe(document);

    const future = document!.replace('"schemaVersion":1', '"schemaVersion":2');
    storage.setItem("neo-angband-character-roster", future);
    expect(listRoster()).toEqual([]);
    expect(storage.getItem("neo-angband-character-roster")).toBe(future);
  });

  it("converts a raw active id and does not write that key again", () => {
    storage.setItem("neo-angband-active", "slot-9");
    expect(getActiveId()).toBe("slot-9");
    expect(storage.getItem("neo-angband-active")).toBeNull();
    expect(storage.getItem("neo-angband-active-slot")).toContain("slot-9");
    setActiveId("slot-8");
    expect(storage.getItem("neo-angband-active")).toBeNull();
    expect(getActiveId()).toBe("slot-8");
  });

  it("converts the old death ledger and leaves a future ledger untouched", () => {
    storage.setItem("neo-angband-deaths", JSON.stringify([
      { lineage: "lin-1", name: "Grond", turn: 44, at: 1_700_000_000_000 },
    ]));
    expect(listDeaths()[0]?.lineage).toBe("lin-1");
    expect(storage.getItem("neo-angband-deaths")).toBeNull();
    const document = storage.getItem("neo-angband-death-records");
    expect(document).toContain("neo-angband/web/death-records");
    expect(listDeaths()[0]?.at).toBe(1_700_000_000_000);
    expect(storage.getItem("neo-angband-death-records")).toBe(document);

    const future = document!.replace('"schemaVersion":1', '"schemaVersion":2');
    storage.setItem("neo-angband-death-records", future);
    expect(writeSlot("a", "AAAA", meta("a"))).toBe(true);
    expect(markDead("a")).toBe(true);
    expect(storage.getItem("neo-angband-death-records")).toBe(future);
  });

  it("does not overwrite future roster, active, or death documents", () => {
    const future = (format: string): string => JSON.stringify({ format, schemaVersion: 2, data: {} });
    const roster = future("neo-angband/web/character-roster");
    const active = future("neo-angband/web/active-slot");
    const deaths = future("neo-angband/web/death-records");
    storage.setItem("neo-angband-character-roster", roster);
    storage.setItem("neo-angband-active-slot", active);
    storage.setItem("neo-angband-death-records", deaths);
    expect(rosterReadableFrom(storage)).toBe(false);
    expect(upsertMeta(meta("a"))).toBe(false);
    setActiveId("a");
    expect(writeSlot("a", "AAAA", meta("a"))).toBe(false);
    expect(storage.getItem("neo-angband-character-roster")).toBe(roster);
    expect(storage.getItem("neo-angband-active-slot")).toBe(active);
    expect(storage.getItem("neo-angband-death-records")).toBe(deaths);
  });

  it("keeps save bytes when a death tombstone cannot be stored", () => {
    expect(writeSlot("a", "AAAA", meta("a"))).toBe(true);
    storage.full = true;
    expect(markDead("a")).toBe(false);
    expect(storage.getItem("neo-angband-save:a")).toBe("AAAA");
  });
});
