/**
 * The bundled `bug-fixes` mod (packages/web/mods/bug-fixes/).
 *
 * After the mod-scope reset it is a plain CONTENT mod with no plugin code and no
 * capabilities: it just DECLARES the core rule flags (PackManifest.rules)
 * that the host applies to GameState.modRules, each ON once the mod is enabled
 * (`default: true`) - and the mod itself is off on a fresh install, so an
 * untouched game applies no rule at all. This test ties the on-disk manifest to
 * its contract by reading it; the flags here are the same names the core control
 * tests gate on (obj-list / make / chunk / session tests), and each flag's
 * off/on behaviour is proven there. With the mod absent (or a rule the player
 * switched off) core stays byte-identical.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";

const MANIFEST = new URL("../mods/bug-fixes/manifest.json", import.meta.url);

/** The flags the mod must declare == the flags core control tests gate on. */
const EXPECTED_FLAGS = [
  "bugfix.uniqueKillHistory",
  "bugfix.noiseScentSave",
  "bugfix.objectListOrder",
  "bugfix.duplicateArtifact",
  /* Entry 13: unreachable staircases. The one fix that was MIGRATED out of core
   * (owner ruling 2026-07-26 - core keeps upstream's warts); its off/on pair is
   * proven in core's gen/gen.test.ts and session/qol-defaults.test.ts. */
  "bugfix.stairsReachable",
  /* Entry 14: the owner's catch-all string-cleanup item. Measured before it was
   * built - 38 double-space-after-sentence literals, ZERO misspellings - so it
   * is one narrow whitespace rule plus an exact-match table that is empty on
   * purpose. Proven in packages/web/mods/bug-fixes/strings.test.ts. */
  "bugfix.miscStrings",
];

describe("bug-fixes bundled mod", () => {
  const m = validateManifest(JSON.parse(readFileSync(MANIFEST, "utf8")));

  it("is a content mod with no capabilities", () => {
    expect(m.id).toBe("bug-fixes");
    expect(m.shape).toBe("content");
    expect(m.capabilities).toBeUndefined();
    expect(m.dependencies).toEqual({ core: "*" });
  });

  /*
   * Default policy (neostryder's ruling, 2026-07-26), two independent layers:
   * the MOD is off by default (DEFAULT_ENABLED_MODS is [], asserted in
   * mod-store.test.ts), and once the player enables it each fix inside it
   * defaults ON. So `default: true` here means "on once the mod is on", never
   * "on in a fresh install" - an untouched game is still faithful 4.2.6.
   * The per-fix toggle exists so a player can take the patch set minus one.
   */
  it("declares exactly the documented core rule flags, all ON once the mod is enabled", () => {
    const rules = m.rules ?? [];
    expect(rules.map((r) => r.flag).sort()).toEqual([...EXPECTED_FLAGS].sort());
    for (const r of rules) {
      expect(r.default).toBe(true);
      expect(r.title.length).toBeGreaterThan(0);
      // The per-mod Fixes & tweaks screen wraps this description to fill its
      // detail pane, so it must actually explain the fix (neostryder, 2026-07-27:
      // descriptions "as long as will fit"), not just name it again.
      expect(r.description.length, `${r.flag}'s description is a stub`).toBeGreaterThan(80);
    }
  });
});
