/**
 * A built `plugin.js` loads and RUNS through the web front end's folder path.
 *
 * WHAT THIS USED TO BE, and why it had to change. It compared a mod built for
 * distribution against the same mod bundled into the app, because qol and bug-fixes
 * existed in both forms and every earlier failure in this area had the same shape - one
 * path worked, the other silently did nothing, and no test looked at both. Both mods now
 * live in their own repositories, so there is no bundled twin left to compare against,
 * and an equivalence test with one side missing is a test that passes by having nothing
 * to disagree with.
 *
 * What is still worth pinning is the half this repository owns: that the FRONT END can
 * take a real generated artefact, put it through the real gates, and get a plugin whose
 * code actually runs. So this builds the mod SDK's `ok-mod` fixture with the real builder
 * and drives the result through `loadModCode` - the same validator, the same consent
 * check, the same order a downloaded mod goes through. Only the importer is injected,
 * because Node has no browser module loader, and it imports the file the builder wrote.
 *
 * The other half - that a mod's built artefact behaves like its source, and that the
 * committed artefact is current - belongs to each mod's own repository, where both the
 * source and the artefact are. neo-angband-mod-qol and neo-angband-mod-bug-fixes each run
 * it on every push.
 *
 * It shells out to the builder rather than calling esbuild: a test that reimplements the
 * build proves the reimplementation.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadModCode, PLUGIN_FILE } from "./mod-code";
import { MOD_API_VERSION, type ModPlugin } from "./mod-plugin";
import { modPluginContext } from "./mod-context";
import type { DiskPack } from "./disk-packs";

const SDK = join(import.meta.dirname, "..", "..", "mod-sdk");
const BUILDER = join(SDK, "bin", "neo-angband-mod-build.mjs");
const FIXTURE = join(SDK, "test-fixtures", "ok-mod");
const ID = "ok-mod";

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "neo-mod-plugin-"));
  execFileSync(process.execPath, [BUILDER, "--root", FIXTURE, "--out", outDir], {
    encoding: "utf8",
    /* The builder exits non-zero on a surviving bare import, an inlined package or a
     * bad default export, so a throw here IS the assertion for those - and the message
     * it prints is the one a mod author would need. Its own failure paths are proven
     * directly in packages/mod-sdk/src/mod-build.test.ts. */
    stdio: ["ignore", "pipe", "pipe"],
  });
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/** Load the built artefact the way a folder mod is loaded. */
async function loadBuilt(): Promise<ModPlugin> {
  const manifest = JSON.parse(
    readFileSync(join(outDir, ID, "manifest.json"), "utf8"),
  ) as DiskPack["manifest"];
  const packs: DiskPack[] = [{ manifest, code: [PLUGIN_FILE], files: {}, assets: [] }];
  const report = await loadModCode({
    packs,
    codeUrl: Object.assign(
      (id: string, file: string) => Promise.resolve(pathToFileURL(join(outDir, id, file)).href),
      {},
    ),
    enabled: () => true,
    consented: (id) =>
      (packs.find((p) => p.manifest.id === id)?.manifest.capabilities ?? []) as string[],
    importer: (url) => import(url),
  });
  expect(report.problems).toEqual([]);
  expect(report.skipped).toEqual([]);
  expect(report.plugins).toHaveLength(1);
  return report.plugins[0]!.plugin;
}

describe("the builder writes a loadable mod folder", () => {
  it("writes plugin.js and a verbatim manifest.json", () => {
    const js = readFileSync(join(outDir, ID, PLUGIN_FILE), "utf8");
    expect(js.length).toBeGreaterThan(0);
    const manifest = JSON.parse(readFileSync(join(outDir, ID, "manifest.json"), "utf8")) as {
      id: string;
    };
    /* Verbatim: the build step is not in the business of editing what a mod declares,
     * and a rewritten id would install under the wrong name. */
    expect(manifest.id).toBe(ID);
  });

  it("leaves NO non-relative import in the output", () => {
    /* Asserted on the bytes here as well as inside the builder, because the builder's
     * own check is a thing that could be deleted - and this failure is invisible in a
     * dev bundle and total in a player's install.
     *
     * The pattern is "any bare specifier", not the engine's name spelled out. An earlier
     * version matched "@neo-angband/" and a scope rename left it matching a string
     * nothing writes any more; a rename must not be able to defang a guard. */
    const js = readFileSync(join(outDir, ID, PLUGIN_FILE), "utf8");
    expect(js).not.toMatch(/(?:^|[\s;}])(?:import|export)[\s\S]{0,200}?from\s*["'][^."'][^"']*["']/u);
    expect(js).not.toMatch(/import\s*\(\s*["'][^."'][^"']*["']\s*\)/u);
  });

  it("bundles the mod's own modules IN rather than importing them", () => {
    /* One request, one digest, and no chance of a half-downloaded dependency graph. */
    const js = readFileSync(join(outDir, ID, PLUGIN_FILE), "utf8");
    expect(js).not.toMatch(/from\s*["']\.\//u);
    expect(js).toContain("ok-mod-helper-was-bundled");
  });
});

describe("the front end loads and runs it", () => {
  it("passes every gate the folder loader applies", async () => {
    const plugin = await loadBuilt();
    expect(plugin.api).toBe(MOD_API_VERSION);
    expect(typeof plugin.hooks).toBe("function");
  });

  it("installs NOTHING when every patch is off", async () => {
    /* The standing rule: a mod whose patches are all off leaves core on its faithful
     * path rather than installing an empty opinion. */
    const plugin = await loadBuilt();
    expect(plugin.hooks!(modPluginContext(ID, {})) ?? {}).toEqual({});
  });

  it("runs a real hook out of the BUILT module, not just inspects its shape", async () => {
    /* A hook that is present and throws would pass every assertion above. This calls
     * into the artefact and checks the answer - evidence that the code inside the file
     * the builder wrote actually executes, and that `ctx.core` reached it. */
    const plugin = await loadBuilt();
    const hooks = plugin.hooks!(modPluginContext(ID, { "ok-mod.on": true }))!;
    expect(typeof hooks.historyAdd).toBe("function");
    expect(hooks.historyAdd!({ what: "x", type: 0, duplicate: false })).toBe(true);
  });
});
