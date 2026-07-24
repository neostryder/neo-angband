import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearKeymaps,
  keymapAdd,
  keymapEntries,
  keymapFind,
  keymapModeFor,
  keymapRemove,
  loadKeymapPrefs,
  saveKeymapPrefs,
} from "./keymap-store";

/** A minimal in-memory localStorage for the persistence tests. */
function fakeStorage(): void {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("keymap store (keymap_add / find / remove)", () => {
  beforeEach(() => {
    fakeStorage();
    clearKeymaps();
  });
  afterEach(() => {
    clearKeymaps();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("maps keyset to keymap mode", () => {
    expect(keymapModeFor(false)).toBe("orig");
    expect(keymapModeFor(true)).toBe("rogue");
  });

  it("add / find / remove a keymap, per mode", () => {
    keymapAdd("orig", "X", "qc");
    expect(keymapFind("orig", "X")).toBe("qc");
    // The same trigger is independent in the other mode.
    expect(keymapFind("rogue", "X")).toBeNull();
    keymapAdd("rogue", "X", "R&");
    expect(keymapFind("rogue", "X")).toBe("R&");
    expect(keymapFind("orig", "X")).toBe("qc"); // unaffected

    expect(keymapRemove("orig", "X")).toBe(true);
    expect(keymapFind("orig", "X")).toBeNull();
    expect(keymapRemove("orig", "X")).toBe(false); // already gone
  });

  it("lists entries for the editor", () => {
    keymapAdd("orig", "1", "aa");
    keymapAdd("orig", "2", "bb");
    expect(keymapEntries("orig").sort()).toEqual([
      ["1", "aa"],
      ["2", "bb"],
    ]);
  });

  it("save / load round-trips through localStorage", () => {
    keymapAdd("orig", "Q", "qd");
    keymapAdd("rogue", "Z", "maa");
    saveKeymapPrefs();
    clearKeymaps();
    expect(keymapFind("orig", "Q")).toBeNull();
    loadKeymapPrefs();
    expect(keymapFind("orig", "Q")).toBe("qd");
    expect(keymapFind("rogue", "Z")).toBe("maa");
  });

  it("load tolerates a corrupt pref", () => {
    localStorage.setItem("neo-angband:keymaps", "{not json");
    expect(() => loadKeymapPrefs()).not.toThrow();
    expect(keymapEntries("orig")).toHaveLength(0);
  });
});
