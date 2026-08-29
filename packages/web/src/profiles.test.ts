import { describe, expect, it } from "vitest";
import { ProfileStore } from "./profiles";
import { scopedStorage, type ScopedStorage } from "./profile-scope";

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

describe("ProfileStore - default profile", () => {
  it("always lists the default first, named 'Default' until renamed", () => {
    const store = new ProfileStore(fakeStorage());
    expect(store.list()).toEqual([{ id: null, name: "Default", createdAt: 0 }]);
    expect(store.isDefaultNamed()).toBe(false);
    expect(store.hasNamedProfiles()).toBe(false);
  });

  it("is active by default, with no metadata write needed to be so", () => {
    const store = new ProfileStore(fakeStorage());
    expect(store.activeId()).toBeNull();
    expect(store.isDefaultActive()).toBe(true);
  });

  it("renaming the default sets its display name without creating a profile entry", () => {
    const store = new ProfileStore(fakeStorage());
    store.rename(null, "Tester");
    expect(store.isDefaultNamed()).toBe(true);
    expect(store.hasNamedProfiles()).toBe(false);
    expect(store.list()).toEqual([{ id: null, name: "Tester", createdAt: 0 }]);
  });
});

describe("ProfileStore - creating profiles", () => {
  it("create() returns a fresh id and lists it alongside the default", () => {
    const store = new ProfileStore(fakeStorage());
    const id = store.create("Testing");
    expect(store.list()).toEqual([
      { id: null, name: "Default", createdAt: 0 },
      { id, name: "Testing", createdAt: expect.any(Number) },
    ]);
    expect(store.hasNamedProfiles()).toBe(true);
  });

  it("a full reset (no copyFrom) leaves the new profile's scoped storage empty", () => {
    const meta = fakeStorage();
    const real = fakeStorage();
    real.setItem("neo:enabledMods", "[\"qol\"]"); // the default's own data
    const store = new ProfileStore(meta);
    const id = store.create("Fresh");
    expect(scopedStorage(real, id).getItem("neo:enabledMods")).toBeNull();
  });

  it("copyFrom: null copies the default profile's data into the new one", () => {
    const meta = fakeStorage();
    const real = fakeStorage();
    real.setItem("neo:enabledMods", "[\"qol\"]");
    const store = new ProfileStore(meta);
    const id = store.create("Copy of default", { copyFrom: null, realStorage: real });
    expect(scopedStorage(real, id).getItem("neo:enabledMods")).toBe("[\"qol\"]");
    // the default's own data is untouched
    expect(real.map.get("neo:enabledMods")).toBe("[\"qol\"]");
  });

  it("copyFrom: <id> copies one named profile's data into a new one", () => {
    const meta = fakeStorage();
    const real = fakeStorage();
    const store = new ProfileStore(meta);
    const src = store.create("Source");
    scopedStorage(real, src).setItem("neo-angband-roster", "[{\"id\":\"c1\"}]");
    const dst = store.create("Copy", { copyFrom: src, realStorage: real });
    expect(scopedStorage(real, dst).getItem("neo-angband-roster")).toBe("[{\"id\":\"c1\"}]");
  });
});

describe("ProfileStore - switching", () => {
  it("switchTo records the active id; switching back to null returns to default", () => {
    const store = new ProfileStore(fakeStorage());
    const id = store.create("Testing");
    store.switchTo(id);
    expect(store.activeId()).toBe(id);
    expect(store.isDefaultActive()).toBe(false);
    store.switchTo(null);
    expect(store.isDefaultActive()).toBe(true);
  });
});

describe("ProfileStore - renaming", () => {
  it("renames a named profile by id", () => {
    const store = new ProfileStore(fakeStorage());
    const id = store.create("Original");
    store.rename(id, "Renamed");
    expect(store.list().find((p) => p.id === id)?.name).toBe("Renamed");
  });

  it("renaming an unknown id is a no-op", () => {
    const store = new ProfileStore(fakeStorage());
    store.rename("nope", "X");
    expect(store.list()).toEqual([{ id: null, name: "Default", createdAt: 0 }]);
  });
});

describe("ProfileStore - removing", () => {
  it("removes a named profile's metadata and wipes its scoped data", () => {
    const meta = fakeStorage();
    const real = fakeStorage();
    const store = new ProfileStore(meta);
    const id = store.create("Doomed");
    scopedStorage(real, id).setItem("neo:enabledMods", "[]");
    store.remove(id, real);
    expect(store.list()).toEqual([{ id: null, name: "Default", createdAt: 0 }]);
    expect(scopedStorage(real, id).getItem("neo:enabledMods")).toBeNull();
  });

  it("switches back to the default first if the removed profile was active", () => {
    const meta = fakeStorage();
    const real = fakeStorage();
    const store = new ProfileStore(meta);
    const id = store.create("Active one");
    store.switchTo(id);
    store.remove(id, real);
    expect(store.isDefaultActive()).toBe(true);
  });

  it("removing an unknown id is a no-op and never touches the default", () => {
    const meta = fakeStorage();
    const real = fakeStorage();
    const store = new ProfileStore(meta);
    store.remove("nope", real);
    expect(store.list()).toEqual([{ id: null, name: "Default", createdAt: 0 }]);
  });
});

describe("ProfileStore - tolerates missing storage", () => {
  it("every method degrades to a single, permanent default profile", () => {
    const store = new ProfileStore(null);
    expect(store.list()).toEqual([{ id: null, name: "Default", createdAt: 0 }]);
    expect(store.isDefaultActive()).toBe(true);
    const id = store.create("Ghost"); // returns an id, but nothing persists
    expect(store.list()).toEqual([{ id: null, name: "Default", createdAt: 0 }]);
    expect(typeof id).toBe("string");
  });
});
