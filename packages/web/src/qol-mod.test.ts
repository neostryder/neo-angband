/**
 * The bundled qol content mod after the mod-scope reset: a content mod that
 * DECLARES quality-of-life rule toggles (PackManifest.rules), all ON by default.
 * It must NOT touch built-in Angband options (those ship in core at their
 * upstream defaults). This ties the on-disk manifest to that contract and checks
 * pack.ts surfaces its rule declaration for the Fixes & tweaks menu / resolver.
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
  it("surfaces the qol mod's auto-dig rule (default-on, discovered)", () => {
    const decls = loadEnabledModRuleDecls();
    const autoDig = decls.find((d) => d.rule.flag === "qol.autoDig");
    expect(autoDig).toBeDefined();
    expect(autoDig!.modId).toBe("qol");
  });

  it("resolveModRules honours the default and a saved choice", () => {
    const decls = [{ rule: { flag: "qol.autoDig", default: true } }];
    expect(resolveModRules(decls, {})).toEqual({ "qol.autoDig": true });
    expect(resolveModRules(decls, { "qol.autoDig": false })).toEqual({
      "qol.autoDig": false,
    });
  });
});
