/**
 * The bundled `bug-fixes` mod (packages/web/mods/bug-fixes/).
 *
 * After the mod-scope reset it is a plain CONTENT mod with no plugin code and no
 * capabilities: it just DECLARES the four core rule flags (PackManifest.rules)
 * that the host applies to GameState.modRules, each OFF by default. This test
 * ties the on-disk manifest to its contract by reading it; the flags here are
 * the same names the core control tests gate on (obj-list / make / chunk /
 * session tests), and each flag's off/on behaviour is proven there. With the
 * mod absent (or a rule left at its false default) core stays byte-identical.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateManifest } from "@neo-angband/mod-sdk";

const MANIFEST = new URL("../mods/bug-fixes/manifest.json", import.meta.url);

/** The flags the mod must declare == the flags core control tests gate on. */
const EXPECTED_FLAGS = [
  "bugfix.uniqueKillHistory",
  "bugfix.noiseScentSave",
  "bugfix.objectListOrder",
  "bugfix.duplicateArtifact",
];

describe("bug-fixes bundled mod", () => {
  const m = validateManifest(JSON.parse(readFileSync(MANIFEST, "utf8")));

  it("is a content mod with no capabilities", () => {
    expect(m.id).toBe("bug-fixes");
    expect(m.shape).toBe("content");
    expect(m.capabilities).toBeUndefined();
    expect(m.dependencies).toEqual({ core: "*" });
  });

  it("declares exactly the four documented core rule flags, all OFF by default", () => {
    const rules = m.rules ?? [];
    expect(rules.map((r) => r.flag).sort()).toEqual([...EXPECTED_FLAGS].sort());
    for (const r of rules) {
      expect(r.default).toBe(false); // bug fixes are opt-in
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });
});
