/**
 * The built `plugin.js` is the same mod as the bundled one.
 *
 * This is the test the extraction turns on. A bundled mod is found by Vite's glob
 * and runs as TypeScript compiled into the app; the copy in the mod's own repository
 * is a single ES module a player's install imports from a folder. Those are two
 * artefacts from one source, and every earlier failure in this area had the same
 * shape - one path worked, the other silently did nothing, and no test looked at
 * both. So this runs the real build script, imports what it wrote, and drives it
 * through the FOLDER loader, then compares against the bundled entry point.
 *
 * It shells out rather than calling esbuild itself on purpose: a test that
 * reimplements the build proves the reimplementation.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadModCode, PLUGIN_FILE } from "./mod-code";
import { MOD_API_VERSION, type ModPlugin } from "./mod-plugin";
import { discoverModHookEntries } from "./mod-hooks";
import { modPluginContext } from "./mod-context";
import type { DiskPack } from "./disk-packs";

const WEB_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(WEB_ROOT, "scripts", "build-mod-plugins.mjs");
const MODS = ["qol", "bug-fixes"] as const;

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "neo-mod-plugins-"));
  execFileSync(process.execPath, [SCRIPT, "--out", outDir], {
    cwd: WEB_ROOT,
    encoding: "utf8",
    /* The script exits non-zero on a surviving bare import or a bad default export,
     * so a throw here IS the assertion for those cases - and the message it prints
     * is the one an author would need. */
    stdio: ["ignore", "pipe", "pipe"],
  });
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("build-mod-plugins.mjs", () => {
  it("writes a plugin.js and a manifest.json per mod", () => {
    for (const id of MODS) {
      const js = readFileSync(join(outDir, id, PLUGIN_FILE), "utf8");
      expect(js.length, id).toBeGreaterThan(0);
      const manifest = JSON.parse(
        readFileSync(join(outDir, id, "manifest.json"), "utf8"),
      ) as { id: string };
      /* Verbatim copy: the build step is not in the business of editing what a mod
       * declares, and a rewritten id would install under the wrong name. */
      expect(manifest.id, id).toBe(id);
    }
  });

  it("leaves NO bare import in the output", () => {
    /* The failure mode that is invisible in the dev bundle and total in a player's
     * install: "@neo-angband/core" resolves against the document, where nothing is
     * published. Asserted on the bytes as well as inside the script, because the
     * script's own check is a thing that could be deleted. */
    for (const id of MODS) {
      const js = readFileSync(join(outDir, id, PLUGIN_FILE), "utf8");
      expect(js, id).not.toMatch(/from\s*["']@neo-angband\//);
      expect(js, id).not.toMatch(/import\s*\(\s*["'][^."'][^"']*["']\s*\)/);
    }
  });

  it("bundles the mod's own modules in, rather than importing them", () => {
    /* bug-fixes is three source files. One request and one digest for a distributed
     * artefact, and no chance of a half-downloaded dependency graph. */
    const js = readFileSync(join(outDir, "bug-fixes", PLUGIN_FILE), "utf8");
    expect(js).not.toMatch(/from\s*["']\.\//);
    expect(js).toContain("ensureStairsReachable");
    expect(js).toContain("miscStringFix");
  });
});

describe("the built plugin behaves as the bundled mod does", () => {
  /**
   * Load the built artefacts through the real folder path: the same gates, the same
   * validator, the same order. Only the importer is injected, because Node has no
   * browser module loader - and it imports the file the script actually wrote.
   */
  async function loadBuilt(): Promise<Map<string, ModPlugin>> {
    const packs: DiskPack[] = MODS.map((id) => {
      const manifest = JSON.parse(
        readFileSync(join(outDir, id, "manifest.json"), "utf8"),
      ) as DiskPack["manifest"];
      return {
        manifest,
        code: [PLUGIN_FILE],
        files: {},
        assets: [],
      } satisfies DiskPack;
    });
    const report = await loadModCode({
      packs,
      codeUrl: Object.assign(
        (id: string, file: string) =>
          Promise.resolve(pathToFileURL(join(outDir, id, file)).href),
        {},
      ),
      enabled: () => true,
      consented: (id) =>
        (packs.find((p) => p.manifest.id === id)?.manifest.capabilities ?? []) as string[],
      importer: (url) => import(url),
    });
    expect(report.problems).toEqual([]);
    expect(report.skipped).toEqual([]);
    return new Map(report.plugins.map((p) => [p.id, p.plugin]));
  }

  it("passes every gate the folder loader applies", async () => {
    const built = await loadBuilt();
    expect([...built.keys()].sort()).toEqual([...MODS].sort());
    for (const [id, plugin] of built) {
      expect(plugin.api, id).toBe(MOD_API_VERSION);
      expect(typeof plugin.hooks, id).toBe("function");
    }
  });

  it("installs the SAME hooks the bundled entry point installs", async () => {
    const built = await loadBuilt();
    const bundled = discoverModHookEntries();
    const cases: Record<string, Record<string, boolean>> = {
      qol: { "qol.autoDig": true },
      "bug-fixes": {
        "bugfix.uniqueKillHistory": true,
        "bugfix.noiseScentSave": true,
        "bugfix.objectListOrder": true,
        "bugfix.duplicateArtifact": true,
        "bugfix.stairsReachable": true,
        "bugfix.miscStrings": true,
      },
    };
    for (const id of MODS) {
      const flags = cases[id]!;
      const fromBundle = Object.keys(bundled.get(id)!(flags) ?? {}).sort();
      const fromBuilt = Object.keys(
        built.get(id)!.hooks!(modPluginContext(id, flags)) ?? {},
      ).sort();
      expect(fromBuilt, id).toEqual(fromBundle);
      // Guards the comparison: two empty sets would agree for the wrong reason.
      expect(fromBuilt.length, id).toBeGreaterThan(0);
    }
  });

  it("and installs NOTHING when every patch is off, from either source", async () => {
    /* The standing rule, on both paths: a mod whose patches are all off must leave
     * core on its faithful path rather than install an empty opinion. */
    const built = await loadBuilt();
    const bundled = discoverModHookEntries();
    for (const id of MODS) {
      expect(Object.keys(bundled.get(id)!({}) ?? {}), id).toEqual([]);
      expect(
        Object.keys(built.get(id)!.hooks!(modPluginContext(id, {})) ?? {}),
        id,
      ).toEqual([]);
    }
  });

  it("runs a real hook out of the BUILT module, not just inspects its shape", async () => {
    /* A hook that is present and throws would pass every assertion above. This one
     * calls the built bug-fixes mod's two pure hooks and checks their answers -
     * evidence that the code inside the artefact runs, and that `ctx.core` reached
     * the parts of it that need the engine. */
    const built = await loadBuilt();
    const hooks = built.get("bug-fixes")!.hooks!(
      modPluginContext("bug-fixes", {
        "bugfix.uniqueKillHistory": true,
        "bugfix.objectListOrder": true,
      }),
    )!;
    expect(hooks.historyAdd!({ duplicate: true } as never)).toBe(false);
    expect(hooks.historyAdd!({ duplicate: false } as never)).toBe(true);
    // Nearer-to-top first, then leftmost.
    expect(hooks.objectListTiebreak!({ dy: -1, dx: 5 } as never, { dy: 2, dx: 0 } as never)).toBe(-1);
    expect(hooks.objectListTiebreak!({ dy: 0, dx: 1 } as never, { dy: 0, dx: 3 } as never)).toBe(-1);
  });
});
