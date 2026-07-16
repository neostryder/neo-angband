/**
 * The bundled `bug-fixes` trusted plugin (packages/web/mods/bug-fixes/).
 *
 * The plugin module itself lives outside the web tsc rootDir (it is compiled by
 * Vite's trusted-plugin glob, like demo-trusted), so it cannot be imported here.
 * This test instead ties the on-disk mod to its contract by reading its files:
 * the manifest declares a plugin requesting only "registry:rules", and the
 * plugin turns on exactly the four documented core rule flags - the same flag
 * names the core control tests gate on (registry-host / obj-list / make /
 * chunk / session tests). With the mod absent no flag is set and core stays
 * byte-identical to 4.2.6; the enable half of that seam is proven in
 * core/mod/registry-host.test.ts (host.rules.enable/disable/isEnabled).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MANIFEST = new URL("../mods/bug-fixes/manifest.json", import.meta.url);
const PLUGIN = new URL("../mods/bug-fixes/trusted.ts", import.meta.url);

/** The flags the plugin must enable == the flags core control tests gate on. */
const EXPECTED_FLAGS = [
  "bugfix.uniqueKillHistory",
  "bugfix.noiseScentSave",
  "bugfix.objectListOrder",
  "bugfix.duplicateArtifact",
];

describe("bug-fixes trusted plugin", () => {
  it("manifest is a plugin requesting only registry:rules", () => {
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      id?: string;
      shape?: string;
      capabilities?: string[];
      dependencies?: Record<string, string>;
    };
    expect(m.id).toBe("bug-fixes");
    expect(m.shape).toBe("plugin");
    expect(m.capabilities).toEqual(["registry:rules"]);
    expect(m.dependencies).toEqual({ core: "*" });
  });

  it("enables exactly the four documented core rule flags", () => {
    const src = readFileSync(PLUGIN, "utf8");
    for (const flag of EXPECTED_FLAGS) {
      expect(src).toContain(`"${flag}"`);
    }
    // It toggles rules and nothing else (no other registry facade touched).
    expect(src).toContain("host.rules.enable");
    for (const facade of ["host.effects", "host.rooms", "host.commands", "host.monsters", "host.vocab"]) {
      expect(src).not.toContain(facade);
    }
  });
});
