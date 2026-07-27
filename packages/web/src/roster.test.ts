import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CharMeta } from "./roster";
import { listRoster, markDead, upsertMeta, writeSlot } from "./roster";

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
const realStorage = globalThis.localStorage;

beforeEach(() => {
  storage = new FakeStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: realStorage,
    configurable: true,
    writable: true,
  });
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
