/**
 * W2.4 mod-manager persistence + catalog. Uses an in-memory StorageLike so the
 * enabled-set / consent / profile round-trips and the pure catalog builder are
 * tested without a browser. The enabled key + JSON schema match pack.ts's
 * reader (that agreement is what makes enable-then-reload actually work).
 */

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PackManifest } from "@neo-angband/mod-sdk";
import {
  ModStore,
  buildCatalog,
  consentSatisfied,
  isShippedMod,
  resolveEnabledIds,
  DEFAULT_ENABLED_MODS,
  FIRST_PARTY_MOD_IDS,
  type StorageLike,
} from "./mod-store";
import { confirmGameplayNoscore, needsGameplayNoscoreWarning } from "./mods";
import { discoverContentModManifests } from "./pack";

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

describe("the shipped mod set (isShippedMod)", () => {
  it("ships exactly the three bundled mods: qol, bug-fixes, linoleum", () => {
    expect([...FIRST_PARTY_MOD_IDS].sort()).toEqual([
      "bug-fixes",
      "linoleum",
      "qol",
    ]);
  });

  it("keeps every first-party id in both builds", () => {
    for (const id of FIRST_PARTY_MOD_IDS) {
      expect(isShippedMod(id, true)).toBe(true);
      expect(isShippedMod(id, false)).toBe(true);
    }
  });

  it("drops the demo-* framework proofs from a release build only", () => {
    for (const id of ["demo-modtest", "demo-sandbox", "demo-trusted"]) {
      expect(isShippedMod(id, true)).toBe(true); // dev: proofs stay loadable
      expect(isShippedMod(id, false)).toBe(false); // release: not offered
    }
  });

  it("is DEV-gated so the demos are discoverable while running the tests", () => {
    // The production filter must not silently apply under vitest, or the demo
    // mods would vanish from every discovery test that relies on them.
    expect(isShippedMod("demo-modtest")).toBe(true);
  });

  /*
   * The guard that makes the two lists above meaningful: a new directory under
   * packages/web/mods/ is either a shipped first-party mod or a demo-* proof.
   * Adding a fourth player-facing mod is a scope decision, so it has to come
   * with an edit here rather than appearing in the manager unannounced.
   */
  it("accounts for every bundled mod directory, and each manifest id matches its folder", () => {
    const modsDir = new URL("../mods/", import.meta.url);
    const dirs = readdirSync(modsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(dirs.length).toBeGreaterThan(0); // the glob root really exists

    for (const dir of dirs) {
      const shipped = FIRST_PARTY_MOD_IDS.includes(dir);
      expect(
        shipped || dir.startsWith("demo-"),
        `packages/web/mods/${dir} is neither first-party nor a demo-* proof`,
      ).toBe(true);
      expect(isShippedMod(dir, false)).toBe(shipped);

      const raw = readFileSync(new URL(`${dir}/manifest.json`, modsDir), "utf8");
      expect((JSON.parse(raw) as { id?: string }).id).toBe(dir);
    }

    for (const id of FIRST_PARTY_MOD_IDS) expect(dirs).toContain(id);
  });

  /*
   * End-to-end on the real discovery path rather than the predicate: pack.ts
   * globs the manifests on disk, so this is what the mod manager's catalog is
   * actually built from in each build.
   */
  it("a release build's content catalog is exactly the three shipped mods", () => {
    vi.stubEnv("DEV", false);
    try {
      const ids = discoverContentModManifests().map((m) => m.id);
      expect([...ids].sort()).toEqual(["bug-fixes", "linoleum", "qol"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a dev build's content catalog still includes the demo content pack", () => {
    vi.stubEnv("DEV", true);
    try {
      expect(discoverContentModManifests().map((m) => m.id)).toContain(
        "demo-modtest",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("resolveEnabledIds + hasStoredEnabled", () => {
  it("first run (no stored key) enables nothing - the faithful no-mod base game", () => {
    // Parity mandate (audit 06 MOD-11): DEFAULT_ENABLED_MODS is empty, so a
    // fresh install boots pure Angband 4.2.6 with zero mods on, regardless of
    // which bundled mods were discovered.
    expect(DEFAULT_ENABLED_MODS).toEqual([]);
    const discovered = ["bug-fixes", "qol", "linoleum", "demo-x"];
    expect(resolveEnabledIds({ url: null, stored: null, discovered })).toEqual(
      [],
    );
  });

  it("keeps the first-party identity list separate from the (empty) default-enable list", () => {
    // Bundled mods are trusted-when-enabled but NOT on by default.
    expect(FIRST_PARTY_MOD_IDS).toContain("qol");
    expect(DEFAULT_ENABLED_MODS).not.toContain("qol");
  });

  it("honors a stored set verbatim, including an empty one (all off)", () => {
    const discovered = ["bug-fixes", "qol", "linoleum"];
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
        discovered: ["bug-fixes", "qol", "linoleum", "demo-modtest"],
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

  it("surfaces the gameplay flag and fires its warning exactly once", async () => {
    const gameplay = buildCatalog({
      content: [manifest("gameplay", { affectsGameplay: true })],
      sandbox: [], trusted: [], enabled: [], consents: {},
    })[0]!;
    expect(gameplay.affectsGameplay).toBe(true);
    expect(needsGameplayNoscoreWarning(gameplay, false)).toBe(true);
    const warning = vi.fn(async () => true);
    expect(await confirmGameplayNoscore(gameplay, false, warning)).toBe(true);
    // After acceptance the persistent ratchet is true; subsequent enables do not warn.
    expect(await confirmGameplayNoscore(gameplay, true, warning)).toBe(true);
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
