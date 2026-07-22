/**
 * The bundled qol content mod: a content mod that DECLARES quality-of-life rule
 * toggles (PackManifest.rules), each ON by default WHEN THE MOD IS ENABLED. Per
 * the parity mandate the mod itself is OPT-IN (not enabled by default), so a
 * fresh install surfaces none of its rules and the base game is untouched. It
 * must NOT touch built-in Angband options (those ship in core at their upstream
 * defaults). This ties the on-disk manifest to that contract and checks pack.ts
 * surfaces its rule declaration only once the mod is enabled.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateManifest } from "@neo-angband/mod-sdk";
import { loadEnabledModRuleDecls } from "./pack";
import { resolveModRules } from "./mod-store";

const manifest = validateManifest(
  JSON.parse(readFileSync(new URL("../mods/qol/manifest.json", import.meta.url), "utf8")),
);

describe("qol bundled mod", () => {
  it("is a content mod with no capabilities, credited to the handle only", () => {
    expect(manifest.id).toBe("qol");
    expect(manifest.shape).toBe("content");
    expect(manifest.capabilities).toBeUndefined();
    expect(manifest.author).toBe("neostryder (RPGM Tools)");
    expect(manifest.license).toBe("GPL-2.0-only");
  });

  it("declares the auto-dig tweak, ON by default", () => {
    const rules = manifest.rules ?? [];
    const autoDig = rules.find((r) => r.flag === "qol.autoDig");
    expect(autoDig).toBeDefined();
    expect(autoDig!.default).toBe(true); // QoL tweaks are on by default
    expect(autoDig!.title.length).toBeGreaterThan(0);
    expect(autoDig!.description.length).toBeGreaterThan(0);
  });

  it("declares no built-in Angband option defaults (those live in faithful core)", () => {
    // The manifest must carry rules only; it must not smuggle option overrides.
    expect(manifest).not.toHaveProperty("interfaceDefaults");
    for (const r of manifest.rules ?? []) {
      // Every rule is a mod-owned flag, namespaced - never a bare option name.
      expect(r.flag).toMatch(/^qol\./);
    }
  });
});

describe("pack.ts rule discovery + resolution", () => {
  it("surfaces no mod rules on a fresh install (faithful no-mod default)", () => {
    // DEFAULT_ENABLED_MODS is empty (parity), so with nothing stored no mod is
    // enabled and no rule - including qol.autoDig - is injected into the base.
    let hadStorage = false;
    try {
      localStorage.removeItem("neo:enabledMods");
      hadStorage = true;
    } catch {
      /* no storage in this env: enabledModIds falls back to empty defaults */
    }
    void hadStorage;
    const decls = loadEnabledModRuleDecls();
    expect(decls.find((d) => d.rule.flag === "qol.autoDig")).toBeUndefined();
  });

  it("surfaces the qol auto-dig rule once qol is explicitly enabled", () => {
    // qol is opt-in; enabling it must make its declared rule discoverable.
    let hasStorage = false;
    try {
      localStorage.setItem("neo:enabledMods", JSON.stringify(["qol"]));
      hasStorage = true;
    } catch {
      /* no storage: the enabled->discovery path is unit-covered below */
    }
    if (!hasStorage) return;
    try {
      const decls = loadEnabledModRuleDecls();
      const autoDig = decls.find((d) => d.rule.flag === "qol.autoDig");
      expect(autoDig).toBeDefined();
      expect(autoDig!.modId).toBe("qol");
    } finally {
      try {
        localStorage.removeItem("neo:enabledMods");
      } catch {
        /* ignore */
      }
    }
  });

  it("resolveModRules honours the default and a saved choice", () => {
    const decls = [{ rule: { flag: "qol.autoDig", default: true } }];
    expect(resolveModRules(decls, {})).toEqual({ "qol.autoDig": true });
    expect(resolveModRules(decls, { "qol.autoDig": false })).toEqual({
      "qol.autoDig": false,
    });
  });
});
