/**
 * The bundled `bug-fixes` mod (packages/web/mods/bug-fixes/).
 *
 * After the mod-scope reset it is a plain CONTENT mod with no plugin code and no
 * capabilities: it just DECLARES the core rule flags (PackManifest.rules)
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
  /* Entry 13: unreachable staircases. The one fix that was MIGRATED out of core
   * (owner ruling 2026-07-26 - core keeps upstream's warts); its off/on pair is
   * proven in core's gen/gen.test.ts and session/qol-defaults.test.ts. */
  "bugfix.stairsReachable",
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
   * Default policy (Aaron's ruling, 2026-07-26), two independent layers:
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
      expect(r.description.length).toBeGreaterThan(0);
    }
  });
});
