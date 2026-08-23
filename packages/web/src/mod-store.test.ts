/**
 * W2.4 mod-manager persistence + catalog. Uses an in-memory StorageLike so the
 * enabled-set / consent / profile round-trips and the pure catalog builder are
 * tested without a browser. The enabled key + JSON schema match pack.ts's
 * reader (that agreement is what makes enable-then-reload actually work).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  ModStore,
  buildCatalog,
  consentSatisfied,
  defaultModStore,
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
  it("bundles NO mods at all", () => {
    /* The de-bundling, stated where the list is. qol and bug-fixes were here;
     * neo-linoleum left before them when its six converted packs - 9161 files, 42 MiB of
     * art that belongs to the mod - moved to their own repository. All three are equally
     * first-party and all three now arrive from their own repositories, which is the point:
     * a fresh install is Angband 4.2.6 and nothing else, and the author's own mods take
     * the same route, through the same verification, as anyone else's.
     *
     * The list is not deleted along with its contents. It means "the game vouched for
     * this by shipping it", which is what grants implicit capability consent - so an
     * empty list is a statement, not a leftover. */
    expect(FIRST_PARTY_MOD_IDS).toEqual([]);
  });

  it("keeps every first-party id in both builds", () => {
    /* Vacuous today - the list is empty - and kept because it is the rule, not the
     * roster: whatever the game bundles is offered in dev AND in release. The last
     * assertion is what stops the loop above from reading as coverage. */
    for (const id of FIRST_PARTY_MOD_IDS) {
      expect(isShippedMod(id, true)).toBe(true);
      expect(isShippedMod(id, false)).toBe(true);
    }
    expect(FIRST_PARTY_MOD_IDS.length, "vacuous: nothing is bundled").toBe(0);
  });

  it("drops the demo-* framework proofs from a release build only", () => {
    for (const id of ["demo-modtest", "demo-sandbox", "demo-trusted", "demo-hooks"]) {
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
      /* And now that nothing is bundled, EVERY directory must be a demo. A real mod
       * appearing here again is a scope decision, and it has to come with an edit to
       * this file rather than turning up in the manager unannounced. */
      expect(shipped, `packages/web/mods/${dir} is bundled; nothing should be`).toBe(false);
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
  it("gives every bundled mod a substantial description that does not claim to be on by default", () => {
    /* Over every DIRECTORY rather than over FIRST_PARTY_MOD_IDS, which is empty. Written
     * against the list, this test would have gone silently vacuous the moment the mods
     * left the bundle - and a dev build still puts these descriptions on screen. */
    const modsDir = new URL("../mods/", import.meta.url);
    const bundledDirs = readdirSync(modsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(bundledDirs.length).toBeGreaterThan(0);
    for (const id of bundledDirs) {
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
  it("a release build's content catalog is EMPTY", () => {
    /* The strongest single statement of the de-bundling, made on the real discovery path
     * rather than on the predicate: pack.ts globs the manifests on disk, so this is what
     * the mod manager's catalog is actually built from. In a release build, nothing. */
    vi.stubEnv("DEV", false);
    try {
      expect(discoverContentModManifests().map((m) => m.id)).toEqual([]);
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
    /* Both are empty now, and they mean different things: FIRST_PARTY_MOD_IDS is "the
     * game vouched for this by shipping it" (implicit capability consent) and
     * DEFAULT_ENABLED_MODS is "this is on before anyone chose it" (which nothing ever is,
     * by the parity mandate). They coincide at empty today; conflating them would be
     * wrong the moment either changes. */
    expect(FIRST_PARTY_MOD_IDS).toEqual([]);
    expect(DEFAULT_ENABLED_MODS).toEqual([]);
    for (const id of FIRST_PARTY_MOD_IDS) expect(DEFAULT_ENABLED_MODS).not.toContain(id);
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

  /**
   * The duplicate rows a player saw after installing all four mods.
   *
   * qol and bug-fixes declare `facets: ["content", "plugin"]`, so each is listed
   * once for its content facet and once for its plugin facet, by two discovery
   * functions neither of which is wrong. The catalogue is per MOD, so it has to
   * join them; the assertion is on the id COUNT, because "the row is present" was
   * already true of the broken build - twice.
   */
  it("lists a hybrid content+plugin mod once, under its plugin kind", () => {
    const hybrid = manifest("qol", { shape: "content", capabilities: ["registry:effect"] });
    const cat = buildCatalog({
      content: [hybrid, manifest("tiles-only", { shape: "tiles" })],
      sandbox: [],
      trusted: [hybrid],
      enabled: ["qol"],
      consents: {},
    });
    expect(cat.map((m) => m.id)).toEqual(["qol", "tiles-only"]);
    /* The more privileged kind wins: enabling this runs code in-process, and a
     * row reading "(content)" would understate what the player is agreeing to. */
    expect(cat.find((m) => m.id === "qol")!.kind).toBe("trusted");
    /* And the merge cannot loosen the consent gate - it is computed from the
     * manifest, so the surviving row still says the capability is ungranted. */
    expect(cat.find((m) => m.id === "qol")!.consented).toBe(false);
  });

  it("does not turn a duplicate into a phantom 'not installed' row", () => {
    /* The missing-mod synthesis keys off `found`, which is built from the merged
     * list. Deduping the wrong way round (dropping the id from `found`) would put
     * an enabled hybrid back as a NOT INSTALLED row - a scarier bug than the one
     * being fixed, so it gets its own assertion. */
    const hybrid = manifest("bug-fixes");
    const cat = buildCatalog({
      content: [hybrid],
      sandbox: [],
      trusted: [hybrid],
      enabled: ["bug-fixes"],
      consents: {},
    });
    expect(cat).toHaveLength(1);
    expect(cat[0]!.missing).toBeUndefined();
  });

  it("carries installedByModId through for a mod installed by another mod", () => {
    /* Issue #18: this is the row's only source. `installedBy` is keyed by the
     * INSTALLED mod's id, and buildCatalog looks itself up by that key rather
     * than trusting the caller to have filtered it. */
    const cat = buildCatalog({
      content: [manifest("companion"), manifest("hand-picked")],
      sandbox: [],
      trusted: [],
      enabled: [],
      consents: {},
      installedBy: { companion: "mod-builder" },
    });
    expect(cat.find((m) => m.id === "companion")!.installedByModId).toBe("mod-builder");
    /* Unset for a mod the player installed themselves - absent, not a sentinel,
     * so a row can test for it with a plain truthiness check. */
    expect(cat.find((m) => m.id === "hand-picked")!.installedByModId).toBeUndefined();
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
 * The mod default policy, in mechanical form. The MOD is the unit the
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
 *
 * Driven against demo-hooks. They used to be driven against bug-fixes, which was bundled
 * and is not any more; what is under test is the HOST's rule lifecycle, not any
 * particular mod's rules, so the bundled framework proof does the job and the suite stops
 * depending on which mods happen to ship. A second id appears below as a mod that is NOT
 * enabled - it needs no manifest, because the whole point is that nothing is discovered
 * for it.
 */
describe("a mod's patches exist only while its mod is enabled", () => {
  /**
   * The demo mod's rules, with the DEFAULT each one declares.
   *
   * Read rather than assumed. These tests used to assert that enabling the mod made
   * every flag true, which was an accident of the manifest at the time and not what
   * `resolveModRules` promises - the promise is "each flag takes its own declared
   * default until the player chooses otherwise". The moment a rule shipped with
   * `"default": false` (demo-hooks.explode, which breaks the session on purpose and
   * must be off unless asked for) the old assertion failed while the behaviour was
   * exactly right.
   */
  const DEMO_RULES = (
    JSON.parse(
      readFileSync(new URL("../mods/demo-hooks/manifest.json", import.meta.url), "utf8"),
    ) as { rules?: { flag: string; default?: boolean }[] }
  ).rules!.map((r) => ({ flag: r.flag, on: r.default !== false }));
  const DEMO_FLAGS = DEMO_RULES.map((r) => r.flag);
  /** The flags that come on by themselves - what "the whole patch set" means. */
  const DEMO_ON = DEMO_RULES.filter((r) => r.on).map((r) => r.flag);

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
    expect(DEMO_FLAGS.length).toBeGreaterThan(1);
  });

  it("contributes NO flag while the mod is off, even with a saved choice for it", () => {
    const rules = withEnabled([], () =>
      resolveModRules(loadEnabledModRuleDecls(), {
        // A remembered opt-out AND a remembered opt-in, both for disabled mods:
        // neither may resurrect a patch whose mod is not enabled.
        "demo-hooks.shout": false,
        "demo-hooks.tiebreak": true,
      }),
    );
    expect(rules).toEqual({});
    // The distinction that matters: absent, not present-and-false.
    expect("demo-hooks.shout" in rules).toBe(false);
    expect("demo-hooks.tiebreak" in rules).toBe(false);
  });

  it("brings in every rule the mod declares, each at its own default", () => {
    const rules = withEnabled(["demo-hooks"], () =>
      resolveModRules(loadEnabledModRuleDecls(), {}),
    );
    expect(Object.keys(rules).sort()).toEqual([...DEMO_FLAGS].sort());
    for (const { flag, on } of DEMO_RULES) expect(rules[flag], flag).toBe(on);
    /* And the ordinary case is still "on": a mod whose patches all defaulted off
     * would make every assertion below vacuous. */
    expect(DEMO_ON.length).toBeGreaterThan(1);
    // Enabling one mod says nothing about another: demo-modtest is still off, so
    // nothing of its appears - and a flag from a mod that is not even installed
    // certainly does not.
    expect("qol.autoDig" in rules).toBe(false);
  });

  it("lets a player take the set minus one, leaving the rest at their defaults", () => {
    const opted = DEMO_ON[0]!;
    const rules = withEnabled(["demo-hooks"], () =>
      resolveModRules(loadEnabledModRuleDecls(), { [opted]: false }),
    );
    expect(rules[opted]).toBe(false);
    const rest = DEMO_RULES.filter((r) => r.flag !== opted);
    expect(rest.length, "set-minus-one needs a set of at least two").toBeGreaterThan(0);
    for (const { flag, on } of rest) expect(rules[flag], flag).toBe(on);
  });

  it("keeps a player's old opt-out when the enabled mod renames its rule", () => {
    /* This deliberately starts with the browser store's OLD key, not a choices
     * literal passed to resolveModRules. loadEnabledModRuleDecls is the real
     * manifest/load seam, and defaultModStore().getRuleChoices is the real read
     * immediately before the real resolver. Without a host-side migration,
     * demo-hooks.shout falls back to its declared true default and this fails. */
    const oldFlag = "demo-hooks.message-transform";
    const newFlag = "demo-hooks.shout";
    const rules = withEnabled(["demo-hooks"], () => {
      localStorage.setItem("neo:modRuleChoices", JSON.stringify({ [oldFlag]: false }));
      return resolveModRules(loadEnabledModRuleDecls(), defaultModStore().getRuleChoices());
    });

    expect(rules[newFlag]).toBe(false);
  });

  it("OR-folds collapsed old flags, preserves a current choice, and stays idempotent", () => {
    const oldA = "demo-hooks.message-transform";
    const oldB = "demo-hooks.all-caps";
    const newFlag = "demo-hooks.shout";
    const result = withEnabled(["demo-hooks"], () => {
      localStorage.setItem(
        "neo:modRuleChoices",
        JSON.stringify({ [oldA]: false, [oldB]: true }),
      );
      const folded = resolveModRules(loadEnabledModRuleDecls(), defaultModStore().getRuleChoices());

      localStorage.setItem(
        "neo:modRuleChoices",
        JSON.stringify({ [oldA]: true, [newFlag]: false }),
      );
      const decls = loadEnabledModRuleDecls();
      const afterFirstLoad = defaultModStore().getRuleChoices();
      const preserved = resolveModRules(decls, afterFirstLoad);
      loadEnabledModRuleDecls();
      const afterSecondLoad = defaultModStore().getRuleChoices();
      return { folded, afterFirstLoad, preserved, afterSecondLoad };
    });

    expect(result.folded[newFlag]).toBe(true);
    expect(result.afterFirstLoad).toEqual({ [newFlag]: false });
    expect(result.preserved[newFlag]).toBe(false);
    expect(result.afterSecondLoad).toEqual(result.afterFirstLoad);
  });

  it("drops the flags again when the mod goes off, but remembers the opt-out", () => {
    const store = new ModStore(fakeStorage());
    const opted = DEMO_ON[0]!;
    store.setRuleChoice(opted, false);

    const off = withEnabled([], () =>
      resolveModRules(loadEnabledModRuleDecls(), store.getRuleChoices()),
    );
    expect(off).toEqual({});
    // The choice is kept, not deleted - it is simply inert while the mod is off.
    expect(store.getRuleChoices()).toEqual({ [opted]: false });

    const back = withEnabled(["demo-hooks"], () =>
      resolveModRules(loadEnabledModRuleDecls(), store.getRuleChoices()),
    );
    expect(back[opted]).toBe(false);
    for (const { flag, on } of DEMO_RULES.filter((r) => r.flag !== opted)) {
      expect(back[flag], flag).toBe(on);
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

  it("the curated list still points at the mod, and no bundled folder claims it", () => {
    /* The rename outlives the de-bundling: the id is still what a player's saved
     * enabled set and an external manager's load-order.json record, and it is now
     * the id the INSTALLER writes from the mod's own manifest.
     *
     * WHAT CAN AND CANNOT BE CHECKED HERE, since the shipped catalogue went. That
     * catalogue named an id, so this test could compare it with the migration's
     * target. The curated list names REPOSITORIES only - the id comes from the
     * manifest at discovery time - so the local half of the claim is that the list
     * still points at this mod, and the id half belongs to the discovery canary,
     * which is the only thing that can read a manifest at a tag. */
    const registry = JSON.parse(
      readFileSync(new URL("../../../mods/registry.json", import.meta.url), "utf8"),
    ) as { mods: { repo: string }[] };
    expect(registry.mods.map((m) => m.repo)).toContain(
      "neostryder/neo-angband-mod-linoleum",
    );
    expect(FIRST_PARTY_MOD_IDS).not.toContain("linoleum");
    expect(existsSync(new URL("../mods/neo-linoleum/", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../mods/linoleum/", import.meta.url))).toBe(false);
  });
});
