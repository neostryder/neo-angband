/**
 * Every mod folder IN THIS REPOSITORY, run through the rules the game refuses
 * installs with.
 *
 * WHY THIS EXISTS. The requirements in packages/mod-sdk/src/standards.ts are
 * enforced at INSTALL time - which is the one path the mods in this tree never
 * take, because they are globbed into the bundle instead. So the project could
 * (and did) ship folders that its own published checker would have refused, and
 * nothing anywhere would say so. `neo-angband-mod-check` existing is not the
 * same as anyone having run it.
 *
 * That matters more than tidiness. These folders are the worked examples an
 * author copies: docs/modding points at them, and the plugin ABI test builds one
 * of them. A demo that does not meet the standard teaches the standard wrong.
 *
 * DISCOVERED, NOT LISTED. The folders are found on disk rather than named here,
 * because a list is a thing a new mod can be left off - and a mod left off this
 * list is exactly the mod nobody checked.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MOD_REQUIREMENTS, checkMod } from "@rpgm-tools/neo-angband-mod-sdk";

/** packages/web/mods - the folders the six import.meta.glob patterns match. */
const MODS_DIR = join(import.meta.dirname, "..", "mods");

/** Every path under `dir`, relative to it, with `/` separators. */
function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function modFolders(): string[] {
  return readdirSync(MODS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe("the mod folders this repository ships", () => {
  const folders = modFolders();

  it("finds some, so an empty directory cannot pass by finding nothing", () => {
    /* The failure this guards against is the whole file quietly becoming a no-op
     * after a refactor moves the folder: zero mods checked reads exactly like zero
     * mods broken. */
    expect(folders.length).toBeGreaterThan(0);
  });

  it.each(folders)("%s meets every requirement the installer enforces", (id) => {
    const dir = join(MODS_DIR, id);
    const files = walk(dir);
    /* A mod folder built from source has TypeScript in it (plugin.ts) that becomes
     * plugin.js only at build time, so the file list is taken as-is and the rules
     * that key off plugin.js simply do not fire here. That is correct: what is under
     * test is the manifest, which is the same file either way. */
    const manifestPath = join(dir, "manifest.json");
    const manifestText = statSync(manifestPath, { throwIfNoEntry: false })
      ? readFileSync(manifestPath, "utf8")
      : null;

    const report = checkMod({ files, manifestText });
    expect(
      report.errors.map((f) => `${f.id}: ${f.problem}`),
      `${id} would be refused by the game's own installer`,
    ).toEqual([]);
  });

  it.each(folders)("%s declares an author and a repository the manager can show", (id) => {
    /* Asserted on the VALUES and not only through checkMod, because these two are
     * what the mod manager paints beside the name - a rule passing tells you the
     * field is present, and this tells you it says something. */
    const m = JSON.parse(
      readFileSync(join(MODS_DIR, id, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(typeof m["author"], `${id}.author`).toBe("string");
    expect((m["author"] as string).trim(), `${id}.author`).not.toBe("");
    expect(typeof m["repository"], `${id}.repository`).toBe("string");
  });

  it("keeps an author short enough to share a row with the mod's name", () => {
    /* The manager's row is 76 columns and already gives way on the NAME when it runs
     * out (mods.ts, LABEL_COLS). An author of any length would push the badges -
     * "NOT WORKING", "NEEDS OK" - off the end, which is the one thing that row must
     * never lose. Twenty-four is roughly a third of it. */
    for (const id of folders) {
      const m = JSON.parse(
        readFileSync(join(MODS_DIR, id, "manifest.json"), "utf8"),
      ) as { author?: string };
      expect((m.author ?? "").length, `${id}.author is too long for a row`).toBeLessThanOrEqual(24);
    }
  });
});

describe("the requirement set itself", () => {
  it("still contains the three that were added for uniformity across the four doors", () => {
    /* Named explicitly so that deleting one is a decision somebody makes rather
     * than a rule that quietly stops being enforced. */
    const ids = new Set(MOD_REQUIREMENTS.filter((r) => r.level === "required").map((r) => r.id));
    for (const id of ["declare-a-repository", "credit-an-author", "engine-range"]) {
      expect([...ids], id).toContain(id);
    }
  });
});
