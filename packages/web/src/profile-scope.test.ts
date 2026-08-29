import { describe, expect, it } from "vitest";
import { clearScopedStorage, copyScopedStorage, scopedStorage, type ScopedStorage } from "./profile-scope";

function fakeStorage(): ScopedStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

describe("scopedStorage", () => {
  it("the default profile (null) is the real storage, unprefixed", () => {
    const real = fakeStorage();
    const view = scopedStorage(real, null);
    view.setItem("neo:enabledMods", "[]");
    expect(real.map.get("neo:enabledMods")).toBe("[]");
  });

  it("a named profile prefixes every key it touches", () => {
    const real = fakeStorage();
    const view = scopedStorage(real, "abc");
    view.setItem("neo:enabledMods", "[]");
    expect(real.map.get("neo:enabledMods")).toBeUndefined();
    expect(real.map.get("profile:abc:neo:enabledMods")).toBe("[]");
    expect(view.getItem("neo:enabledMods")).toBe("[]");
  });

  it("two profiles never see each other's keys", () => {
    const real = fakeStorage();
    scopedStorage(real, "a").setItem("k", "1");
    scopedStorage(real, "b").setItem("k", "2");
    expect(scopedStorage(real, "a").getItem("k")).toBe("1");
    expect(scopedStorage(real, "b").getItem("k")).toBe("2");
  });

  it("dynamic per-slot keys (roster's own SLOT_PREFIX + uuid shape) scope correctly", () => {
    const real = fakeStorage();
    const view = scopedStorage(real, "p1");
    view.setItem("neo-angband-save:11111111-1111-1111-1111-111111111111", "bytes");
    expect(real.map.get("profile:p1:neo-angband-save:11111111-1111-1111-1111-111111111111")).toBe(
      "bytes",
    );
  });

  it("length/key enumerate only this profile's keys, unprefixed", () => {
    const real = fakeStorage();
    scopedStorage(real, "a").setItem("x", "1");
    scopedStorage(real, "a").setItem("y", "2");
    scopedStorage(real, "b").setItem("z", "3");
    real.setItem("global", "g"); // an unrelated, unprefixed global key
    const a = scopedStorage(real, "a");
    expect(a.length).toBe(2);
    const seen = new Set<string>();
    for (let i = 0; i < a.length; i++) {
      const k = a.key(i);
      if (k !== null) seen.add(k);
    }
    expect(seen).toEqual(new Set(["x", "y"]));
  });

  it("removeItem only removes the prefixed key", () => {
    const real = fakeStorage();
    const view = scopedStorage(real, "a");
    view.setItem("k", "1");
    view.removeItem("k");
    expect(view.getItem("k")).toBeNull();
    expect(real.map.size).toBe(0);
  });
});

describe("copyScopedStorage", () => {
  it("copies every key from one profile's scope into another's, real keys untouched", () => {
    const real = fakeStorage();
    scopedStorage(real, "src").setItem("neo:enabledMods", "[\"qol\"]");
    scopedStorage(real, "src").setItem("neo-angband-roster", "[]");
    copyScopedStorage(real, "src", "dst");
    expect(scopedStorage(real, "dst").getItem("neo:enabledMods")).toBe("[\"qol\"]");
    expect(scopedStorage(real, "dst").getItem("neo-angband-roster")).toBe("[]");
    // the source is untouched
    expect(scopedStorage(real, "src").getItem("neo:enabledMods")).toBe("[\"qol\"]");
  });

  it("copies from the default profile (null) into a new named one", () => {
    const real = fakeStorage();
    real.setItem("neo:enabledMods", "[\"borg\"]");
    copyScopedStorage(real, null, "new-id");
    expect(scopedStorage(real, "new-id").getItem("neo:enabledMods")).toBe("[\"borg\"]");
    // the default's own (unprefixed) key is untouched
    expect(real.map.get("neo:enabledMods")).toBe("[\"borg\"]");
  });

  it("copying into an empty source leaves the destination untouched", () => {
    const real = fakeStorage();
    copyScopedStorage(real, "empty-src", "dst");
    expect(real.map.size).toBe(0);
  });
});

describe("clearScopedStorage", () => {
  it("removes every key in a profile's scope and nothing else", () => {
    const real = fakeStorage();
    scopedStorage(real, "a").setItem("x", "1");
    scopedStorage(real, "a").setItem("y", "2");
    scopedStorage(real, "b").setItem("z", "3");
    real.setItem("global", "g");
    clearScopedStorage(real, "a");
    expect(scopedStorage(real, "a").length).toBe(0);
    expect(scopedStorage(real, "b").getItem("z")).toBe("3");
    expect(real.map.get("global")).toBe("g");
  });
});
