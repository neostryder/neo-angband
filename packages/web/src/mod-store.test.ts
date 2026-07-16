/**
 * W2.4 mod-manager persistence + catalog. Uses an in-memory StorageLike so the
 * enabled-set / consent / profile round-trips and the pure catalog builder are
 * tested without a browser. The enabled key + JSON schema match pack.ts's
 * reader (that agreement is what makes enable-then-reload actually work).
 */

import { describe, expect, it } from "vitest";
import type { PackManifest } from "@neo-angband/mod-sdk";
import {
  ModStore,
  buildCatalog,
  consentSatisfied,
  resolveEnabledIds,
  DEFAULT_ENABLED_MODS,
  type StorageLike,
} from "./mod-store";

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function manifest(id: string, over: Partial<PackManifest> = {}): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content", ...over };
}

describe("ModStore - enabled set", () => {
  it("writes the enabled key with the pack.ts JSON-array schema", () => {
    const s = fakeStorage();
    new ModStore(s).setEnabled(["a", "b"]);
    expect(JSON.parse(s.map.get("neo:enabledMods")!)).toEqual(["a", "b"]);
  });

  it("toggles, de-dupes, and preserves order", () => {
    const store = new ModStore(fakeStorage());
    store.setModEnabled("a", true);
    store.setModEnabled("b", true);
    store.setModEnabled("a", true); // no-op, no dupe
    expect(store.getEnabled()).toEqual(["a", "b"]);
    store.setModEnabled("a", false);
    expect(store.getEnabled()).toEqual(["b"]);
    expect(store.isEnabled("b")).toBe(true);
  });

  it("reorders within bounds and ignores out-of-range moves", () => {
    const store = new ModStore(fakeStorage());
    store.setEnabled(["a", "b", "c"]);
    store.moveEnabled("c", -1);
    expect(store.getEnabled()).toEqual(["a", "c", "b"]);
    store.moveEnabled("a", -1); // already first: no-op
    expect(store.getEnabled()).toEqual(["a", "c", "b"]);
    store.moveEnabled("b", +1); // already last: no-op
    expect(store.getEnabled()).toEqual(["a", "c", "b"]);
  });

  it("degrades to empty with no storage", () => {
    const store = new ModStore(null);
    store.setEnabled(["a"]);
    expect(store.getEnabled()).toEqual([]);
  });
});

describe("resolveEnabledIds + hasStoredEnabled", () => {
  it("first run (no stored key) enables the discovered default bundled mods", () => {
    const discovered = [...DEFAULT_ENABLED_MODS, "demo-x"];
    expect(resolveEnabledIds({ url: null, stored: null, discovered })).toEqual([
      ...DEFAULT_ENABLED_MODS,
    ]);
  });

  it("intersects defaults with what is actually discovered", () => {
    const only = DEFAULT_ENABLED_MODS[0]!;
    expect(
      resolveEnabledIds({ url: null, stored: null, discovered: [only] }),
    ).toEqual([only]);
  });

  it("honors a stored set verbatim, including an empty one (all off)", () => {
    const discovered = [...DEFAULT_ENABLED_MODS];
    expect(resolveEnabledIds({ url: null, stored: [], discovered })).toEqual([]);
    expect(
      resolveEnabledIds({ url: null, stored: ["qol"], discovered }),
    ).toEqual(["qol"]);
  });

  it("lets a URL override win over both stored and defaults", () => {
    expect(
      resolveEnabledIds({
        url: ["demo-modtest"],
        stored: ["qol"],
        discovered: [...DEFAULT_ENABLED_MODS, "demo-modtest"],
      }),
    ).toEqual(["demo-modtest"]);
  });

  it("hasStoredEnabled distinguishes first run from an explicit empty set", () => {
    const s = fakeStorage();
    const store = new ModStore(s);
    expect(store.hasStoredEnabled()).toBe(false);
    store.setEnabled([]);
    expect(store.hasStoredEnabled()).toBe(true);
    expect(store.getEnabled()).toEqual([]);
  });
});

describe("ModStore - consent", () => {
  it("records and reads per-mod consent", () => {
    const store = new ModStore(fakeStorage());
    store.setConsent("p", ["registry:effect", "registry:vocab"]);
    expect(store.getConsent("p")).toEqual(["registry:effect", "registry:vocab"]);
    store.clearConsent("p");
    expect(store.getConsent("p")).toEqual([]);
  });
});

describe("consentSatisfied", () => {
  it("is true only when every required capability is consented", () => {
    expect(consentSatisfied(["a", "b"], ["a", "b", "c"])).toBe(true);
    expect(consentSatisfied(["a", "b"], ["a"])).toBe(false);
    expect(consentSatisfied([], [])).toBe(true);
  });
});

describe("ModStore - profiles", () => {
  it("snapshots and restores enabled-set + consents", () => {
    const store = new ModStore(fakeStorage());
    store.setEnabled(["a", "b"]);
    store.setConsent("b", ["registry:vocab"]);
    store.saveProfile("mine");

    store.setEnabled(["c"]);
    store.setConsent("c", ["network:*"]);
    expect(store.applyProfile("mine")).toBe(true);
    expect(store.getEnabled()).toEqual(["a", "b"]);
    expect(store.getConsent("b")).toEqual(["registry:vocab"]);
    expect(store.getConsent("c")).toEqual([]); // profile replaced the consent map

    expect(store.applyProfile("missing")).toBe(false);
    store.deleteProfile("mine");
    expect(Object.keys(store.getProfiles())).toEqual([]);
  });
});

describe("buildCatalog", () => {
  it("merges the three kinds, marks enabled/consent, and sorts enabled-first", () => {
    const cat = buildCatalog({
      content: [manifest("z-content"), manifest("a-content")],
      sandbox: [manifest("sbx", { shape: "plugin", capabilities: ["state:player.read"] })],
      trusted: [
        manifest("trust", {
          shape: "plugin",
          capabilities: ["registry:effect"],
          nondeterministic: true,
        }),
      ],
      enabled: ["trust", "a-content"],
      consents: { trust: ["registry:effect"] },
    });

    // Enabled first, in enabled order; then disabled by name.
    expect(cat.map((m) => m.id)).toEqual(["trust", "a-content", "sbx", "z-content"]);

    const trust = cat.find((m) => m.id === "trust")!;
    expect(trust.kind).toBe("trusted");
    expect(trust.enabled).toBe(true);
    expect(trust.consented).toBe(true); // consent covers its one capability
    expect(trust.nondeterministic).toBe(true);

    // A content mod with no capabilities is always "consented".
    expect(cat.find((m) => m.id === "a-content")!.consented).toBe(true);

    // A plugin whose capability is not consented shows consented=false.
    expect(cat.find((m) => m.id === "sbx")!.consented).toBe(false);
  });
});
