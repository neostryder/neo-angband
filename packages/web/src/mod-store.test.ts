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
  readEnabledModIds,
  resolveEnabledIds,
  resolveModRules,
  DEFAULT_ENABLED_MODS,
  FIRST_PARTY_MOD_IDS,
  RENAMED_MOD_IDS,
  migrateModIdKeys,
  migrateModIds,
  type StorageLike,
} from "./mod-store";
import { confirmGameplayNoscore, needsGameplayNoscoreWarning } from "./mods";
import { discoverContentModManifests, loadEnabledModRuleDecls } from "./pack";

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
      "neo-linoleum",
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
   * A bundled mod must explain itself. The mod manager shows manifest.description
   * in the detail pane of the highlighted row (wrapped to fill it), so a stub
   * one-liner leaves a player with nothing to decide on - neostryder's 2026-07-27 ask
   * was explicitly for descriptions "as long as will fit".
   */
  it("gives every shipped mod a substantial description that does not claim to be on by default", () => {
    const modsDir = new URL("../mods/", import.meta.url);
    for (const id of FIRST_PARTY_MOD_IDS) {
      const m = JSON.parse(
        readFileSync(new URL(`${id}/manifest.json`, modsDir), "utf8"),
      ) as { description?: string };
      expect(typeof m.description, `${id} has no description`).toBe("string");
      expect(m.description!.length, `${id}'s description is a stub`).toBeGreaterThan(120);
      // No mod is enabled on a fresh install, so no mod may advertise otherwise.
      // (linoleum's description said "Default-on" long after that stopped being
      // true, and the manager puts this text in front of the player.)
      for (const claim of [/default-on/i, /\bon by default\b/i, /enabled by default/i]) {
        expect(claim.test(m.description!), `${id} claims to be on by default`).toBe(false);
      }
    }
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
      expect([...ids].sort()).toEqual(["bug-fixes", "neo-linoleum", "qol"]);
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
    const discovered = ["bug-fixes", "qol", "neo-linoleum", "demo-x"];
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
    const discovered = ["bug-fixes", "qol", "neo-linoleum"];
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
        discovered: ["bug-fixes", "qol", "neo-linoleum", "demo-modtest"],
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

/**
 * The mod default policy, in mechanical form (neostryder's ruling 2026-07-26,
 * restated 2026-07-27 because the prose was ambiguous). The MOD is the unit the
 * player switches; a patch is a part of a mod, never a separate install:
 *
 *  - while a mod is disabled its patches DO NOT EXIST - not "exist and resolve
 *    false". No key reaches modRules, so modRuleEnabled (which tests `=== true`
 *    on an absent key) leaves core on the faithful 4.2.6 line;
 *  - enabling a mod turns its WHOLE patch set on at once;
 *  - each patch is then individually switchable, so a player can take the set
 *    minus one.
 *
 * These run the real path - the on-disk bundled manifests through pack.ts's
 * enabled-only rule discovery into resolveModRules - rather than hand-built
 * decls, so a manifest that changed its `default` would fail here.
 */
describe("a mod's patches exist only while its mod is enabled", () => {
  const BUG_FIX_FLAGS = (
    JSON.parse(
      readFileSync(new URL("../mods/bug-fixes/manifest.json", import.meta.url), "utf8"),
    ) as { rules?: { flag: string }[] }
  ).rules!.map((r) => r.flag);

  /**
   * Run `fn` with pack.ts's enabled-mods key set to `ids`. The web tests run in
   * node with no localStorage (which is why enabledModIds swallows the throw and
   * falls back to DEFAULT_ENABLED_MODS = []), so stubbing the global is how a
   * test drives the enabled set through the real reader.
   */
  function withEnabled<T>(ids: readonly string[], fn: () => T): T {
    const map = new Map<string, string>([["neo:enabledMods", JSON.stringify(ids)]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
    try {
      return fn();
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("declares at least one patch per rule-carrying bundled mod", () => {
    // Guards the tests below from passing vacuously on an empty manifest.
    expect(BUG_FIX_FLAGS.length).toBeGreaterThan(0);
  });

  it("contributes NO flag while the mod is off, even with a saved choice for it", () => {
    const rules = withEnabled([], () =>
      resolveModRules(loadEnabledModRuleDecls(), {
        // A remembered opt-out AND a remembered opt-in, both for disabled mods:
        // neither may resurrect a patch whose mod is not enabled.
        "bugfix.objectListOrder": false,
        "qol.autoDig": true,
      }),
    );
    expect(rules).toEqual({});
    // The distinction that matters: absent, not present-and-false.
    expect("bugfix.objectListOrder" in rules).toBe(false);
    expect("qol.autoDig" in rules).toBe(false);
  });

  it("turns the mod's whole patch set on at once when it is enabled", () => {
    const rules = withEnabled(["bug-fixes"], () =>
      resolveModRules(loadEnabledModRuleDecls(), {}),
    );
    expect(Object.keys(rules).sort()).toEqual([...BUG_FIX_FLAGS].sort());
    expect(Object.values(rules).every((v) => v === true)).toBe(true);
    // Enabling one mod says nothing about another: qol is still off, so its
    // tweak does not exist.
    expect("qol.autoDig" in rules).toBe(false);
  });

  it("lets a player take the set minus one, leaving the rest on", () => {
    const opted = BUG_FIX_FLAGS[0]!;
    const rules = withEnabled(["bug-fixes"], () =>
      resolveModRules(loadEnabledModRuleDecls(), { [opted]: false }),
    );
    expect(rules[opted]).toBe(false);
    for (const flag of BUG_FIX_FLAGS.filter((f) => f !== opted)) {
      expect(rules[flag]).toBe(true);
    }
  });

  it("drops the flags again when the mod goes off, but remembers the opt-out", () => {
    const store = new ModStore(fakeStorage());
    const opted = BUG_FIX_FLAGS[0]!;
    store.setRuleChoice(opted, false);

    const off = withEnabled([], () =>
      resolveModRules(loadEnabledModRuleDecls(), store.getRuleChoices()),
    );
    expect(off).toEqual({});
    // The choice is kept, not deleted - it is simply inert while the mod is off.
    expect(store.getRuleChoices()).toEqual({ [opted]: false });

    const back = withEnabled(["bug-fixes"], () =>
      resolveModRules(loadEnabledModRuleDecls(), store.getRuleChoices()),
    );
    expect(back[opted]).toBe(false);
    for (const flag of BUG_FIX_FLAGS.filter((f) => f !== opted)) {
      expect(back[flag]).toBe(true);
    }
  });
});

/*
 * ONE reader for the live enabled set, because there were three: pack.ts,
 * tile-mods.ts and this module each spelled out the same URL and localStorage
 * reads, and two of them hardcoded the key strings that are constants in this
 * file. They had already drifted - only pack.ts passed `diskOrder` and `choices`,
 * so a tiles mod an external manager deployed was COMPOSED as content and
 * contributed no Graphics row, enabled by one answer and disabled by the other in
 * the same launch.
 *
 * The node test env has no `location` and no `localStorage`, which is itself one
 * of the cases this has to survive: both reads must degrade to "no recorded
 * opinion" rather than throwing at boot, and that is exactly what makes the
 * diskOrder pass-through observable here.
 */
describe("readEnabledModIds (the one live reader)", () => {
  it("survives a host with no location and no localStorage", () => {
    // Not a hypothetical: this runs at module scope during content composition,
    // and a private-mode browser throws on the localStorage getter itself.
    expect(readEnabledModIds({ discovered: ["qol"] })).toEqual([]);
  });

  it("passes the external manager's load order through, so a deployed mod is on", () => {
    // The Vortex/MO2 division of labour: deploying a folder and listing it in
    // load-order.json IS a request to enable it. Dropping diskOrder here is what
    // made the tile surface disagree with content composition.
    expect(
      readEnabledModIds({ discovered: ["folder-tiles"], diskOrder: ["folder-tiles"] }),
    ).toEqual(["folder-tiles"]);
  });

  it("appends the disk order after the stored set, never before", () => {
    expect(
      readEnabledModIds({ discovered: ["a", "b"], diskOrder: ["b", "a"] }),
    ).toEqual(["b", "a"]);
  });
});

/**
 * A mod id is DURABLE state - the saved enabled set, the per-mod choice map, and
 * an external manager's load-order.json all record it - so renaming one without
 * a migration silently turns the mod off for anyone who had it on. The symptom
 * ("the tile sets stopped appearing in Graphics") points nowhere near the rename.
 */
describe("renamed mod ids keep working", () => {
  it("maps the old id to the new one in a saved enabled set", () => {
    expect(RENAMED_MOD_IDS["linoleum"]).toBe("neo-linoleum");
    expect(
      resolveEnabledIds({
        url: null,
        stored: ["qol", "linoleum"],
        discovered: ["qol", "neo-linoleum"],
      }),
    ).toEqual(["qol", "neo-linoleum"]);
  });

  it("maps it in the ?mods= override and in an external load order too", () => {
    expect(
      resolveEnabledIds({ url: ["linoleum"], stored: null, discovered: ["neo-linoleum"] }),
    ).toEqual(["neo-linoleum"]);
    expect(
      resolveEnabledIds({
        url: null,
        stored: [],
        discovered: ["neo-linoleum"],
        diskOrder: ["linoleum"],
      }),
    ).toEqual(["neo-linoleum"]);
  });

  it("honours an OFF choice recorded against the old id", () => {
    /* The choice map is keyed by id as well, so a player who turned the mod off
     * must not find it back on after the rename. */
    expect(
      resolveEnabledIds({
        url: null,
        stored: ["neo-linoleum"],
        discovered: ["neo-linoleum"],
        choices: { linoleum: false },
      }),
    ).toEqual([]);
  });

  it("does not list the mod twice when a store straddles the rename", () => {
    expect(migrateModIds(["linoleum", "neo-linoleum", "qol"])).toEqual([
      "neo-linoleum",
      "qol",
    ]);
    /* And the NEW key wins when both are in the choice map: it was set later. */
    expect(migrateModIdKeys({ linoleum: false, "neo-linoleum": true })).toEqual({
      "neo-linoleum": true,
    });
  });

  it("leaves every other id alone", () => {
    expect(migrateModIds(["qol", "bug-fixes", "demo-modtest"])).toEqual([
      "qol",
      "bug-fixes",
      "demo-modtest",
    ]);
  });

  it("the shipped set names the NEW id, and the mod folder matches it", () => {
    expect(FIRST_PARTY_MOD_IDS).toContain("neo-linoleum");
    expect(FIRST_PARTY_MOD_IDS).not.toContain("linoleum");
    const manifest = JSON.parse(
      readFileSync(new URL("../mods/neo-linoleum/manifest.json", import.meta.url), "utf8"),
    ) as { id: string; name: string };
    expect(manifest.id).toBe("neo-linoleum");
    expect(manifest.name).toBe("neo-linoleum");
  });
});
