import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearKeymaps,
  decodeActionTokens,
  encodeActionToken,
  isBindableTriggerKey,
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

/**
 * isBindableTriggerKey (#62/#63): the shared predicate keymap-edit.ts's
 * trigger capture and main.ts's runtime resolver both call, so accepting a
 * key in the editor and accepting it at the door cannot drift apart.
 */
describe("isBindableTriggerKey", () => {
  it("accepts a single printable character", () => {
    expect(isBindableTriggerKey("q")).toBe(true);
    expect(isBindableTriggerKey("&")).toBe(true);
    expect(isBindableTriggerKey("1")).toBe(true);
  });

  it("accepts Enter (#63)", () => {
    expect(isBindableTriggerKey("Enter")).toBe(true);
  });

  it("accepts a plain F-key, F1 through F12 (#62)", () => {
    for (let n = 1; n <= 12; n++) expect(isBindableTriggerKey(`F${n}`)).toBe(true);
  });

  it("rejects F13+ and other multi-character keys with no trigger meaning", () => {
    expect(isBindableTriggerKey("F13")).toBe(false);
    expect(isBindableTriggerKey("Tab")).toBe(false);
    expect(isBindableTriggerKey("ArrowLeft")).toBe(false);
    expect(isBindableTriggerKey("Shift")).toBe(false);
  });
});

/** encodeActionToken / decodeActionTokens: the action-string wire format. */
describe("action-string token encoding (#63's 'R&[enter]' case)", () => {
  afterEach(() => clearKeymaps());

  it("encodes a single character literally", () => {
    expect(encodeActionToken("q")).toBe("q");
    expect(encodeActionToken("&")).toBe("&");
  });

  it("encodes a named key as bracketed text", () => {
    expect(encodeActionToken("Enter")).toBe("[Enter]");
    expect(encodeActionToken("F5")).toBe("[F5]");
  });

  it("decodes a plain action into one token per character", () => {
    expect(decodeActionTokens("qc")).toEqual(["q", "c"]);
  });

  it("decodes a bracketed name as a single token, not its individual letters", () => {
    expect(decodeActionTokens("R&[Enter]")).toEqual(["R", "&", "Enter"]);
    expect(decodeActionTokens("[F5]")).toEqual(["F5"]);
  });

  it("round-trips encode -> decode for a mixed sequence", () => {
    const action = ["R", "&", "Enter"].map(encodeActionToken).join("");
    expect(action).toBe("R&[Enter]");
    expect(decodeActionTokens(action)).toEqual(["R", "&", "Enter"]);
  });

  it("treats an unterminated '[' as a literal character, not a broken token", () => {
    expect(decodeActionTokens("a[b")).toEqual(["a", "[", "b"]);
  });

  it("stores and replays a keymap action containing Enter end to end", () => {
    keymapAdd("orig", "X", ["R", "&", "Enter"].map(encodeActionToken).join(""));
    const action = keymapFind("orig", "X");
    expect(action).toBe("R&[Enter]");
    expect(decodeActionTokens(action ?? "")).toEqual(["R", "&", "Enter"]);
  });
});
