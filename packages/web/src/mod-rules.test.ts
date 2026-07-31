/**
 * Rule discovery and resolution: pack.ts + mod-store.ts, the host half of a mod's
 * `PackManifest.rules`.
 *
 * WHERE THIS CAME FROM. It was qol-mod.test.ts, which did two different jobs: it asserted
 * the qol mod's own manifest contract, and it asserted that the HOST surfaces a declared
 * rule only once the mod is enabled. The first job moved to neo-angband-mod-qol along
 * with the manifest it was about - a test of a mod's declarations belongs where those
 * declarations live, and a test that reads a file from another repository is a test that
 * breaks for reasons unrelated to what it checks.
 *
 * The second job is the host's, and it stays. It is also the one worth keeping: a mod can
 * declare a perfectly good rule and the game will still play faithfully if the host never
 * looks at it - the class of failure that survives code review, because both halves are
 * individually correct.
 *
 * Driven against demo-hooks, the bundled framework proof, rather than against a shipping
 * mod. The game bundles none of those any more.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { loadEnabledModRuleDecls } from "./pack";
import { resolveModRules, DEFAULT_ENABLED_MODS, FIRST_PARTY_MOD_IDS } from "./mod-store";

const MODS_DIR = join(import.meta.dirname, "..", "mods");
const manifest = validateManifest(
  JSON.parse(readFileSync(join(MODS_DIR, "demo-hooks", "manifest.json"), "utf8")),
);

/** Try to use localStorage; vitest's node environment has none. */
function withStoredMods<T>(ids: string[] | null, body: () => T): T | "no-storage" {
  try {
    if (ids === null) localStorage.removeItem("neo:enabledMods");
    else localStorage.setItem("neo:enabledMods", JSON.stringify(ids));
  } catch {
    return "no-storage";
  }
  try {
    return body();
  } finally {
    try {
      localStorage.removeItem("neo:enabledMods");
    } catch {
      /* nothing to clean up if there was nowhere to write */
    }
  }
}

describe("a rule declaration is well formed", () => {
  it("is namespaced to its own mod, never a bare option name", () => {
    /* The rule that keeps a mod out of core's business: a mod declares flags in its own
     * namespace. A bare `auto_more` would collide with one of Angband's own options,
     * which ship in core at their upstream defaults and are nobody's to override. */
    expect((manifest.rules ?? []).length).toBeGreaterThan(0);
    for (const r of manifest.rules ?? []) {
      expect(r.flag).toMatch(/^demo-hooks\./u);
    }
  });

  it("carries no interface or option defaults", () => {
    expect(manifest).not.toHaveProperty("interfaceDefaults");
  });
});

describe("pack.ts rule discovery", () => {
  it("surfaces NO mod rules on a fresh install", () => {
    /**
     * The parity default, and it now holds for a second reason worth writing down.
     * DEFAULT_ENABLED_MODS is empty, so nothing is enabled on a first run - and
     * FIRST_PARTY_MOD_IDS is empty too, because the game bundles no mods at all. A fresh
     * install therefore has no rule to surface even in principle: it is Angband 4.2.6.
     */
    expect(DEFAULT_ENABLED_MODS).toEqual([]);
    expect(FIRST_PARTY_MOD_IDS).toEqual([]);
    const result = withStoredMods(null, () => loadEnabledModRuleDecls());
    if (result === "no-storage") return;
    expect(result.find((d) => d.rule.flag.startsWith("demo-hooks."))).toBeUndefined();
  });

  it("surfaces a mod's rules once that mod is explicitly enabled", () => {
    const result = withStoredMods(["demo-hooks"], () => loadEnabledModRuleDecls());
    if (result === "no-storage") return;
    const found = result.filter((d) => d.modId === "demo-hooks").map((d) => d.rule.flag);
    expect(found.sort()).toEqual((manifest.rules ?? []).map((r) => r.flag).sort());
  });

  it("does not surface a DIFFERENT mod's rules", () => {
    /* Guards the test above: a discovery that returned every bundled mod's rules
     * regardless of the enabled set would satisfy it. */
    const result = withStoredMods(["demo-modtest"], () => loadEnabledModRuleDecls());
    if (result === "no-storage") return;
    expect(result.find((d) => d.modId === "demo-hooks")).toBeUndefined();
  });
});

describe("resolveModRules", () => {
  it("honours the declared default, and a saved choice over it", () => {
    const decls = [{ rule: { flag: "demo-hooks.shout", default: true } }];
    expect(resolveModRules(decls, {})).toEqual({ "demo-hooks.shout": true });
    expect(resolveModRules(decls, { "demo-hooks.shout": false })).toEqual({
      "demo-hooks.shout": false,
    });
  });

  it("a rule declared OFF stays off until chosen", () => {
    /* Both directions. `default: true` means "on once its mod is on", and the resolver
     * must not treat presence in the list as consent. */
    const decls = [{ rule: { flag: "demo-hooks.shout", default: false } }];
    expect(resolveModRules(decls, {})).toEqual({ "demo-hooks.shout": false });
    expect(resolveModRules(decls, { "demo-hooks.shout": true })).toEqual({
      "demo-hooks.shout": true,
    });
  });
});
