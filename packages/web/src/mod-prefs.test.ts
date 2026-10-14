/**
 * ctx.prefs: a mod's data kept OUTSIDE the character's save.
 *
 * The two properties worth pinning are the two that make it different from the
 * save bag: it is keyed by MOD, so one mod cannot read another's, and every
 * failure is swallowed, because this is called from inside plugin code and a
 * throw here would be blamed on the mod.
 */

import { describe, expect, it, vi } from "vitest";
import { modPrefs, modPrefsKey, type PrefsStorage } from "./mod-prefs";

/** An in-memory PrefsStorage, so a test never touches the real localStorage. */
function fakeStorage(seed: Record<string, string> = {}): PrefsStorage & {
  readonly map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("modPrefs", () => {
  it("round-trips a value", () => {
    const p = modPrefs("qol", fakeStorage());
    expect(p.get()).toBeNull();
    p.set({ remembered: { use_sound: true } });
    expect(p.get()).toEqual({ remembered: { use_sound: true } });
  });

  it("keys by mod, so one mod cannot read another's", () => {
    const store = fakeStorage();
    modPrefs("qol", store).set("mine");
    modPrefs("bug-fixes", store).set("theirs");
    expect(modPrefs("qol", store).get()).toBe("mine");
    expect(modPrefs("bug-fixes", store).get()).toBe("theirs");
    expect([...store.map.keys()].sort()).toEqual([
      modPrefsKey("bug-fixes"),
      modPrefsKey("qol"),
    ]);
  });

  it("null forgets, rather than storing the word null", () => {
    /* A mod turning its own feature off should leave nothing behind, and the
     * next get() must answer "never stored" rather than a JSON null that reads
     * back as a value. */
    const store = fakeStorage();
    const p = modPrefs("qol", store);
    p.set({ a: 1 });
    p.set(null);
    expect(store.map.has(modPrefsKey("qol"))).toBe(false);
    expect(p.get()).toBeNull();
  });

  it("reads fresh every time, so a write from elsewhere is seen", () => {
    const store = fakeStorage();
    const p = modPrefs("qol", store);
    p.set(1);
    store.setItem(modPrefsKey("qol"), "2");
    expect(p.get()).toBe(2);
  });

  it("survives a corrupt value instead of throwing into the mod", () => {
    const store = fakeStorage({ [modPrefsKey("qol")]: "{not json" });
    expect(modPrefs("qol", store).get()).toBeNull();
  });

  it("survives a storage that throws on write (quota, private mode)", () => {
    const store: PrefsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(() => modPrefs("qol", store).set({ big: "x" })).not.toThrow();
  });

  it("is inert, not broken, with no storage at all", () => {
    /* A front end without localStorage gets preferences that do not persist.
     * The mod still runs; it just never remembers. */
    const p = modPrefs("qol", null);
    expect(() => p.set({ a: 1 })).not.toThrow();
    expect(p.get()).toBeNull();
  });

  it("serialises only on set, so a caller's later edits are not picked up", () => {
    /* The stored copy is the value as it was AT the call. A mod that keeps
     * mutating the object it passed in has not silently changed what is on
     * disk - which is the confusing half of a store that held a reference. */
    const store = fakeStorage();
    const p = modPrefs("qol", store);
    const live = { n: 1 };
    p.set(live);
    live.n = 2;
    expect(p.get()).toEqual({ n: 1 });
  });

  it("does not read storage until asked", () => {
    /* Built for every mod at boot, including mods that never call it. */
    const getItem = vi.fn(() => null);
    modPrefs("qol", { getItem, setItem: () => undefined, removeItem: () => undefined });
    expect(getItem).not.toHaveBeenCalled();
  });
});
