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
import { problemLines } from "./mod-problems";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { validateManifest, CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { DungeonProfiles, createModRegistryHost } from "@rpgm-tools/neo-angband-core";
import { readModDir, type ModDirEntry, type ModDirSource } from "./disk-packs";
import { loadModCode, PLUGIN_FILE } from "./mod-code";
import { MOD_API_VERSION, type ModPlugin } from "./mod-plugin";
import { buildModuleGraph } from "./mod-modules";

const root = mkdtempSync(join(tmpdir(), "neo-mods-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * Write a mod folder to disk, exactly as a player unzipping one would.
 *
 * `extra` holds any further files by pack-relative path - more scripts, an image,
 * nested data - with their directories created. A mod is a folder, not a file.
 */
function writeMod(
  id: string,
  manifest: Partial<PackManifest>,
  plugin: string | null,
  extra: Record<string, string | Uint8Array> = {},
): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", shape: "plugin", modApi: MOD_API_VERSION, ...manifest }, null, 2),
    "utf8",
  );
  if (plugin !== null) writeFileSync(join(dir, PLUGIN_FILE), plugin, "utf8");
  for (const [rel, body] of Object.entries(extra)) {
    const full = join(dir, ...rel.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    if (typeof body === "string") writeFileSync(full, body, "utf8");
    else writeFileSync(full, body);
  }
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
    assetUrl: (id, path) => Promise.resolve(pathToFileURL(join(root, id, path)).href),
  };
}

/**
 * A source whose code URLs are `data:` - which stands in for a browser's `blob:`,
 * and stands in EXACTLY where it matters.
 *
 * Both are opaque: neither has a path component, so a relative specifier inside a
 * module loaded from one has no base to resolve against. Node rejects it with
 * ERR_UNSUPPORTED_RESOLVE_REQUEST; a browser reports "Failed to fetch dynamically
 * imported module". Same cause, same consequence, and it means the browser half of
 * the multi-file mod path can be proven here with real module evaluation instead of
 * being asserted about a platform no test can reach.
 *
 * `resolveGraph: false` is the WITHOUT case, kept so the tests can show the problem
 * is real before showing it fixed. A fix demonstrated only in its working state is
 * a fix nobody has watched matter.
 */
function dataSource(
  entries: readonly ModDirEntry[],
  { resolveGraph }: { resolveGraph: boolean },
): ModDirSource {
  const read = async (id: string, path: string): Promise<string | null> => {
    const { readFile } = await import("node:fs/promises");
    try {
      return await readFile(join(root, id, ...path.split("/")), "utf8");
    } catch {
      return null;
    }
  };
  const dataUrl = (text: string): string =>
    `data:text/javascript;base64,${Buffer.from(text, "utf8").toString("base64")}`;
  return {
    ...fsSource(entries),
    codeUrl: async (id, file) => {
      if (!resolveGraph) {
        const text = await read(id, file);
        return text === null ? null : dataUrl(text);
      }
      const graph = await buildModuleGraph(file, {
        read: (path) => read(id, path),
        urlFor: (_path, text) => dataUrl(text),
      });
      if (graph.url === null) throw new Error(graph.problem ?? "could not be read");
      return graph.url;
    },
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
      assetUrl: () => Promise.resolve(null),
      data: {},
      prefs: { get: () => null, set: () => undefined },
      newCharacter: false,
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
    expect(problemLines(code.problems)[0]).toContain("needs a newer game");
    expect(problemLines(code.problems)[0]).not.toContain("top-level code ran");
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
    expect(problemLines(code.problems)[0]).toContain("failed to load");
  });

  it("carries the pack's own record files through to the plugin's context", async () => {
    writeMod("with-data", {}, `export default { api: ${MOD_API_VERSION}, hooks: () => ({}) };`, {
      "monster.json": JSON.stringify([{ name: "Grip" }]),
    });
    const report = await readModDir(
      fsSource([{ id: "with-data", files: ["manifest.json", "monster.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    /* Without this the plugin would have to fetch and re-parse a file the game had
     * already parsed, to read what its own pack declares. */
    expect(code.plugins[0]?.data).toEqual({ monster: [{ name: "Grip" }] });
  });

  it("serves an asset - a real PNG's bytes, unmangled", async () => {
    /* The bytes matter: an image read as text and re-encoded comes back with every
     * invalid UTF-8 sequence replaced by U+FFFD, which is a corrupt PNG that still
     * "loads". These are the first eight bytes of the PNG signature. */
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeMod("tiled", {}, `export default { api: ${MOD_API_VERSION}, hooks: () => ({}) };`, {
      "tiles/orc.png": png,
      "data/spawns.json": JSON.stringify({ orc: 3 }),
    });
    const report = await readModDir(
      fsSource([
        {
          id: "tiled",
          files: ["manifest.json"],
          code: [PLUGIN_FILE],
          assets: ["tiles/orc.png", "data/spawns.json"],
        },
      ]),
    );
    expect(report.packs[0]?.assets).toEqual(["tiles/orc.png", "data/spawns.json"]);
    expect(report.assetUrl).not.toBeNull();

    const url = await report.assetUrl?.("tiled", "tiles/orc.png");
    expect(url).toContain("orc.png");
    const { readFile } = await import("node:fs/promises");
    const back = await readFile(new URL(url as string));
    expect([...back]).toEqual([...png]);
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

/* ------------------------------------------------------------------ *
 * SEVERAL SCRIPTS.
 * ------------------------------------------------------------------ */

/** A mod split across three files, two of them in a subdirectory. */
const MULTI = {
  plugin: `import { greet } from "./lib/greet.js";
           export default {
             api: ${MOD_API_VERSION},
             hooks(ctx) { return { messageText: (raw) => greet(ctx.id) + raw }; },
           };`,
  files: {
    "lib/greet.js": `import { BRACKET } from "./format.js";
                     export const greet = (id) => BRACKET(id) + " ";`,
    "lib/format.js": `export const BRACKET = (s) => "[" + s + "]";`,
  },
};

const MULTI_ENTRY: ModDirEntry = {
  id: "multi",
  files: ["manifest.json"],
  code: [PLUGIN_FILE, "lib/greet.js", "lib/format.js"],
};

describe("a mod may be several scripts, not one bundled file", () => {
  it("works with no help at all where the pack has a real base URL (the desktop path)", async () => {
    /* On desktop the pack is served from the shell's loopback origin, so
     * `./lib/greet.js` resolves against plugin.js's own URL and the engine fetches
     * it. A file: URL behaves the same way, which is what makes this the honest
     * stand-in for that platform. Nothing in mod-modules.ts is involved. */
    writeMod("multi", {}, MULTI.plugin, MULTI.files);
    const report = await readModDir(fsSource([MULTI_ENTRY]));
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.problems).toEqual([]);
    const hooks = code.plugins[0]?.plugin.hooks?.(ctx("multi"));
    /* Through two files: format.js's BRACKET, used by greet.js, called by plugin.js. */
    expect(hooks?.messageText?.("You feel less thirsty.")).toBe(
      "[multi] You feel less thirsty.",
    );
  });

  it("FAILS from an opaque URL when the graph is not resolved - the problem, shown", async () => {
    /* Establishing that the fix below is fixing something. A data: URL is opaque in
     * exactly the way a blob: URL is, so the relative specifier has no base and the
     * import dies. This is the state a browser tab was in, and it is why the first
     * cut of the loader told authors to bundle. */
    writeMod("multi", {}, MULTI.plugin, MULTI.files);
    const report = await readModDir(dataSource([MULTI_ENTRY], { resolveGraph: false }));
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.plugins).toEqual([]);
    expect(code.problems).toHaveLength(1);
    expect(problemLines(code.problems)[0]).toContain("failed to load");
  });

  it("WORKS from an opaque URL once the graph is resolved (the browser path)", async () => {
    writeMod("multi", {}, MULTI.plugin, MULTI.files);
    const report = await readModDir(dataSource([MULTI_ENTRY], { resolveGraph: true }));
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.problems).toEqual([]);
    expect(code.plugins).toHaveLength(1);
    const hooks = code.plugins[0]?.plugin.hooks?.(ctx("multi"));
    expect(hooks?.messageText?.("You feel less thirsty.")).toBe(
      "[multi] You feel less thirsty.",
    );
  });

  it("names the missing script rather than the entry point", async () => {
    /* The browser's own message names plugin.js, which is the file that is fine. */
    writeMod("gappy", {}, `import "./lib/absent.js"; export default { api: ${MOD_API_VERSION} };`);
    const report = await readModDir(
      dataSource([{ id: "gappy", files: ["manifest.json"], code: [PLUGIN_FILE] }], {
        resolveGraph: true,
      }),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.plugins).toEqual([]);
    expect(problemLines(code.problems)[0]).toContain("lib/absent.js");
    expect(problemLines(code.problems)[0]).toContain("not in the mod folder");
  });
});

/** A minimal ModPluginContext for calling a loaded plugin's hooks directly. */
function ctx(id: string): Parameters<NonNullable<ModPlugin["hooks"]>>[0] {
  return {
    id,
    api: MOD_API_VERSION,
    engine: "test",
    flags: {},
    core: {} as never,
    assetUrl: () => Promise.resolve(null),
    data: {},
    prefs: { get: () => null, set: () => undefined },
    newCharacter: false,
    log: () => undefined,
  };
}

/**
 * The sample-mod rule: a seam only a BUNDLED mod or a test double can reach is
 * not a capability. So each registry seam gets a mod written to a real folder,
 * imported for real, and handed a host over the REAL core registry - and the
 * assertion is made on the registry, not on the mod's own report of itself.
 *
 * This one covers registry:profile (the dungeon-profile seam). It fails if the
 * facade is removed, if the capability stops parsing, or if the host stops
 * delegating to the live DungeonProfiles - none of which a mock could tell us.
 */
describe("a mod folder on disk reaches the dungeon-profile registry", () => {
  it("registers a cave builder and a profile through the capability gate", async () => {
    writeMod(
      "hollow",
      { capabilities: ["registry:profile"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           /* Wrap the core builder rather than replace it: prove a mod can
            * reach core generation, not merely shadow it. */
           const classic = host.profiles.builder("classic");
           host.profiles.registerBuilder("hollow:cave", (c) => classic(c));
           const base = host.profiles.find("classic");
           host.profiles.addProfile({ ...base, name: "hollow", builder: "hollow:cave", alloc: 0 });
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "hollow", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      /* The player consented to exactly what the manifest asks for. Without
       * this the mod does not load at all - asserted below - so consent is a
       * gate ahead of the capability gate, not a duplicate of it. */
      consented: () => ["registry:profile"],
    });
    expect(code.problems).toEqual([]);
    expect(code.plugins).toHaveLength(1);

    /* The REAL registry the generator reads, with a real core builder in it. */
    const profiles = new DungeonProfiles();
    const classicCalls: string[] = [];
    profiles.registerBuilder("classic", (() => {
      classicCalls.push("classic");
      return { ok: true };
    }) as never);
    profiles.addProfile({
      name: "classic",
      builder: "classic",
      blockSize: 11,
      dunRooms: 50,
      dunUnusual: 200,
      maxRarity: 2,
      tun: { rnd: 10, chg: 30, con: 15, pen: 25, jct: 90 },
      str: { den: 5, rng: 40, mag: 3, mc: 90, qua: 2, qc: 40 },
      roomProfiles: [],
      minLevel: 0,
      alloc: 10,
    });

    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { profiles },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("hollow"));

    /* Asserted on the registry, not on the mod. */
    expect(profiles.hasBuilder("hollow:cave")).toBe(true);
    expect(profiles.find("hollow")?.builder).toBe("hollow:cave");
    expect(profiles.list().map((p) => p.name)).toEqual(["classic", "hollow"]);

    /* And the mod's builder is the one generation would call, with core's
     * builder reachable from inside it. */
    profiles.builder("hollow:cave")({} as never);
    expect(classicCalls).toEqual(["classic"]);
  });

  it("without consent the mod never loads, capability or not", async () => {
    const report = await readModDir(
      fsSource([{ id: "hollow", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    expect(code.plugins).toEqual([]);
  });

  it("a mod that did not declare the capability is refused at the call", async () => {
    writeMod(
      "greedy",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) { host.profiles.registerBuilder("greedy:cave", () => ({ ok: true })); },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "greedy", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const profiles = new DungeonProfiles();
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { profiles },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("greedy"))).toThrow(
      /registry:profile/,
    );
    expect(profiles.hasBuilder("greedy:cave")).toBe(false);
  });
});
