/**
 * The folder code path, end to end, against REAL FILES and a REAL dynamic import.
 *
 * mod-code.test.ts injects the importer, which is right for asserting the gates -
 * it is the only way to prove a module was NOT imported. But an injected importer
 * cannot show that the mechanism works: a plugin that is fetched from a location,
 * evaluated by the JavaScript engine, and whose exported function then produces a
 * live ModHooks the game can fold. That is what this file does. Nothing is mocked
 * except the transport, which here is the filesystem instead of a loopback HTTP
 * server or a blob: URL.
 *
 * Why it matters: the entire mod system was previously reachable only from code
 * compiled INTO the app, and it had unit tests. Tests on a mocked seam cannot tell
 * you whether the seam is connected to anything.
 *
 * WHAT THIS DOES NOT PROVE: that the shipped game boots this path. The desktop
 * build was driven by hand for that - the folder is read, the mod appears in the
 * manager as a trusted plugin with its own description, and the gameplay-change
 * gate fires on enable. Those are separate claims and they were checked separately.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { PackManifest } from "@neo-angband/mod-sdk";
import { validateManifest } from "@neo-angband/mod-sdk";
import { readModDir, type ModDirEntry, type ModDirSource } from "./disk-packs";
import { loadModCode, PLUGIN_FILE } from "./mod-code";
import { MOD_API_VERSION } from "./mod-plugin";

const root = mkdtempSync(join(tmpdir(), "neo-mods-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Write a mod folder to disk, exactly as a player unzipping one would. */
function writeMod(id: string, manifest: Partial<PackManifest>, plugin: string | null): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", shape: "plugin", modApi: MOD_API_VERSION, ...manifest }, null, 2),
    "utf8",
  );
  if (plugin !== null) writeFileSync(join(dir, PLUGIN_FILE), plugin, "utf8");
}

/**
 * A ModDirSource over the real filesystem.
 *
 * This is a THIRD implementation of the same interface the desktop shell (HTTP
 * index) and a picked browser folder (directory handles) implement, and it needed
 * no change to readModDir or loadModCode to work - which is the property the
 * source-agnostic split was built for.
 */
function fsSource(entries: readonly ModDirEntry[]): ModDirSource {
  return {
    kind: "app",
    dir: () => root,
    list: () => Promise.resolve(entries),
    readJson: async (id, file) => {
      const { readFile } = await import("node:fs/promises");
      return JSON.parse(await readFile(join(root, id, file), "utf8")) as unknown;
    },
    order: () => Promise.resolve([]),
    /* A file: URL is what node's import() takes; the browser's equivalents are a
     * loopback http: URL and a blob:. All three are just "somewhere import() can
     * fetch from", which is the whole abstraction. */
    codeUrl: (id, file) => Promise.resolve(pathToFileURL(join(root, id, file)).href),
  };
}

describe("a mod folder on disk supplies working code", () => {
  it("reads, imports, and produces a live ModHooks", async () => {
    writeMod(
      "greeter",
      { capabilities: [] },
      /* No imports of any kind - the engine arrives as ctx.core. This is a
       * complete, self-contained mod. */
      `export default {
         api: ${MOD_API_VERSION},
         hooks(ctx) {
           return { messageText: (raw) => "[" + ctx.id + ":" + ctx.flags.loud + "] " + raw };
         },
       };`,
    );
    const report = await readModDir(fsSource([{ id: "greeter", files: ["manifest.json"], code: [PLUGIN_FILE] }]));
    expect(report.problems).toEqual([]);
    expect(report.packs).toHaveLength(1);
    expect(report.codeUrl).not.toBeNull();

    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.problems).toEqual([]);
    expect(code.plugins).toHaveLength(1);

    /* The payoff: call the loaded plugin's hooks and use what it returns. A string
     * that came out of a file on disk, through a real module evaluation, and back
     * into the host. */
    const hooks = code.plugins[0]?.plugin.hooks?.({
      id: "greeter",
      api: MOD_API_VERSION,
      engine: "test",
      flags: { loud: true },
      core: {} as never,
      log: () => undefined,
    });
    expect(hooks?.messageText?.("You feel less thirsty.")).toBe(
      "[greeter:true] You feel less thirsty.",
    );
  });

  it("refuses a plugin whose manifest declares the wrong ABI, without evaluating it", async () => {
    /* The module's top level THROWS. If the manifest gate ran after the import
     * rather than before it, this test would see that throw instead of the version
     * message - which is exactly how the check would rot into a formality. */
    writeMod(
      "stale",
      { modApi: MOD_API_VERSION + 1 },
      `throw new Error("top-level code ran, so the gate did not hold");
       export default { api: ${MOD_API_VERSION + 1} };`,
    );
    const report = await readModDir(fsSource([{ id: "stale", files: ["manifest.json"], code: [PLUGIN_FILE] }]));
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.plugins).toEqual([]);
    expect(code.problems[0]).toContain("needs a newer game");
    expect(code.problems[0]).not.toContain("top-level code ran");
  });

  it("reports a plugin that fails to evaluate, and keeps the game up", async () => {
    writeMod("broken", {}, `export default { api: ${MOD_API_VERSION} }; this is not javascript`);
    const report = await readModDir(fsSource([{ id: "broken", files: ["manifest.json"], code: [PLUGIN_FILE] }]));
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.plugins).toEqual([]);
    expect(code.problems).toHaveLength(1);
    expect(code.problems[0]).toContain("failed to load");
  });

  it("the manifest schema accepts modApi and rejects a non-integer one", () => {
    /* The declaration has to survive validateManifest or the gate never sees it -
     * a field the validator drops is a field that does not exist. */
    const ok = validateManifest({
      id: "x",
      name: "x",
      version: "1.0.0",
      shape: "plugin",
      modApi: 1,
    });
    expect(ok.modApi).toBe(1);
    expect(() =>
      validateManifest({ id: "x", name: "x", version: "1.0.0", shape: "plugin", modApi: "1" }),
    ).toThrow(/modApi/);
    expect(() =>
      validateManifest({ id: "x", name: "x", version: "1.0.0", shape: "plugin", modApi: 0 }),
    ).toThrow(/modApi/);
  });
});
