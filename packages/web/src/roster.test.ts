import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CharMeta } from "./roster";
import {
  deleteSlot,
  lineageOf,
  listDeaths,
  listRoster,
  markDead,
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
      if (k === "neo-angband-deaths") throw new Error("quota");
      raw(k, v);
    };
    expect(markDead("a")).toBe(true);
    expect(listRoster()[0]?.alive).toBe(false);
    expect(listDeaths()).toEqual([]);
  });

  it("reads a corrupt or half-written ledger as empty", () => {
    storage.setItem("neo-angband-deaths", "{not json");
    expect(listDeaths()).toEqual([]);
    storage.setItem("neo-angband-deaths", JSON.stringify([{ name: "no lineage" }, 7, null]));
    expect(listDeaths()).toEqual([]);
  });
});
