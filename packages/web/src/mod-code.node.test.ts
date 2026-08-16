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

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { problemLines } from "./mod-problems";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  validateManifest,
  CapabilitySet,
  composeContentPacks,
  checkUnqualified,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  DungeonProfiles,
  EffectRegistry,
  RoomRegistry,
  ActionRegistry,
  CommandVerbTable,
  VocabularyRegistry,
  createModRegistryHost,
  BlowEffectRegistry,
  registerCoreBlowEffects,
  StoreBehaviourRegistry,
  registerCoreStoreBehaviour,
  storeWillBuy,
  ProjectionHandlerRegistry,
  PLAYER_SIDE_HANDLERS,
  Chunk,
  Dun,
  FeatureRegistry,
  Gen,
  SQUARE,
  bindConstants,
  buildVault,
  fillRectangle,
  projectFeature,
  FEAT,
  monMeleeAttack,
  blankMonster,
  blankPlayer,
  Dice,
  FlagSet,
  RF_SIZE,
  Rng,
  TMD,
  loc,
  extensionData,
  CORE_RECORD_KEYS,
  ART_IDX,
  OF,
  ObjRegistry,
  addAbilityAux,
  bindProjections,
  cloneArtifact,
  collectArtifactData,
  randartRegistry,
  objectNew,
  runeRegistry,
  resetRuneRegistry,
  buildRuneList,
  runeDesc,
  runeKey,
  runeName,
  playerKnowsRune,
  playerLearnRune,
  objectHasRune,
  objectLearnOnWield,
  resetRandartRegistry,
  EF,
  describeEffect,
  effectMenuName,
  effectNew,
  effectInfoRegistry,
  resetEffectInfoRegistry,
  TV,
  kindIsGood,
  objectValueBase,
  tvalCanHaveFlavor,
  tvalIsBook,
  tvalIsWeapon,
  tvalIsWearable,
  tvalRegistry,
  resetTvalRegistry,
  ODESC,
  objectDesc,
  makeRuneEnv,
} from "@rpgm-tools/neo-angband-core";
import type {
  TerrainRecordJson,
  BlowEffect,
  BlowMethod,
  MonBlowEnv,
  Monster,
  MonsterRace,
  Player,
} from "@rpgm-tools/neo-angband-core";
import { readModDir, type ModDirEntry, type ModDirSource } from "./disk-packs";
import { loadModCode, PLUGIN_FILE } from "./mod-code";
import { MOD_API_VERSION, type ModPlugin } from "./mod-plugin";
import { buildModuleGraph } from "./mod-modules";

/* The shipped pack, read from disk: the glyph seam is only meaningful over a
 * real terrain table and real constants. */
function loadPackJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadPackRecords<T>(name: string): T[] {
  return loadPackJson<{ records: T[] }>(name).records;
}

/** The real object kinds, for the two tval dispatches that read a kind. */
function loadObjKinds(): { tval: number; name: string }[] {
  return new ObjRegistry({
    objectBase: loadPackJson("object_base"),
    object: loadPackJson("object"),
    egoItem: loadPackJson("ego_item"),
    artifact: loadPackJson("artifact"),
    curse: loadPackJson("curse"),
    brand: loadPackJson("brand"),
    slay: loadPackJson("slay"),
    activation: loadPackJson("activation"),
    objectProperty: loadPackJson("object_property"),
    flavor: loadPackJson("flavor"),
  } as never).kinds as never;
}


/**
 * A minimal rune world over the real pack, for the gap-16 sample mod below.
 * Built here rather than imported from core so the fixture stays out of the
 * published ABI surface - the same reason loadObjKinds above is local.
 */
function runeWorld(): {
  env: never;
  player(): never;
  drain(): string[];
  blankObject(tval: number): { modifiers: number[] };
} {
  const reg = new ObjRegistry({
    objectBase: loadPackJson("object_base"),
    object: loadPackJson("object"),
    egoItem: loadPackJson("ego_item"),
    artifact: loadPackJson("artifact"),
    curse: loadPackJson("curse"),
    brand: loadPackJson("brand"),
    slay: loadPackJson("slay"),
    activation: loadPackJson("activation"),
    objectProperty: loadPackJson("object_property"),
    flavor: loadPackJson("flavor"),
  } as never) as never as {
    brands: unknown[];
    slays: unknown[];
    curses: unknown[];
    properties: unknown[];
    kinds: { tval: number; kidx: number }[];
    ordinaryKindCount: number;
  };
  const messages: string[] = [];
  const env = makeRuneEnv(
    () => null,
    ((v: { base: number }) => v.base) as never,
    {
      brands: reg.brands,
      slays: reg.slays,
      curses: reg.curses,
      properties: reg.properties,
      elementNames: loadPackRecords<{ name: string }>("projection").map(
        (p) => p.name,
      ),
      msg: (t: string) => messages.push(t),
    } as never,
  ) as never;
  return {
    env,
    player(): never {
      const p = blankPlayer(
        {} as never,
        {} as never,
        { slots: [] } as unknown as never,
      ) as never as { upkeep: { playing: boolean } };
      /* modMessage is guarded by upkeep.playing: without this every modifier
       * row would be empty and could not disagree with a broken table. */
      p.upkeep.playing = true;
      return p as never;
    },
    drain(): string[] {
      const out = [...messages];
      messages.length = 0;
      return out;
    },
    blankObject(tval: number): { modifiers: number[] } {
      /* object_new, zeroed: a prepared ring of the first ordinary sval is a
       * Ring of Strength and would print its own lines first. */
      const kind = reg.kinds.find(
        (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
      );
      return objectNew(kind as never) as never as { modifiers: number[] };
    },
  };
}

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

/**
 * The monster blow-effect registry, from disk.
 *
 * This is the one seam where a mod's code has to reach LIVE COMBAT, and where
 * the same description has to work on both of the paths that resolve a blow.
 * So the assertions are not "the registry holds the handler" - they are a real
 * `monMeleeAttack` run twice, once worldless and once with an environment,
 * against a monster whose blow effect core has never heard of.
 */
/** A monster whose one blow carries an effect name core has no handler for. */
function monsterWithBlow(effectName: string): Monster {
  const method = {
    name: "HIT",
    messages: [],
    msgt: "MON_HIT",
    phys: true,
  } as unknown as BlowMethod;
  const dice = new Dice();
  dice.parseString("10");
  const race = {
    name: "test-fiend",
    level: 10,
    flags: new FlagSet(RF_SIZE),
    blows: [
      {
        method,
        effect: { name: effectName, power: 40 } as unknown as BlowEffect,
        dice,
        diceRaw: "10",
      },
    ],
  } as unknown as MonsterRace;
  const mon = blankMonster(race);
  mon.hp = 100;
  mon.maxhp = 100;
  return mon;
}

function testPlayer(): Player {
  const p = blankPlayer({} as never, {} as never, { slots: [] } as unknown as never);
  p.lev = 1;
  p.chp = 100;
  p.mhp = 100;
  return p;
}

/** A blow environment that records what actually reached the world. */
function loggingBlowEnv(player: Player, applied: string[]): MonBlowEnv {
  let died = false;
  return {
    playerGrid: () => loc(0, 0),
    applyReduction: (dam) => dam,
    takeHit: (dam) => {
      player.chp -= dam;
      died = player.chp < 0;
      applied.push(`takeHit(${String(dam)})`);
    },
    get playerDied() {
      return died;
    },
    msg: () => {},
    monName: "The test-fiend",
    showDamage: false,
    monVisible: true,
    elementalDam: (_proj, dam) => dam,
    invenDamage: () => {},
    resists: () => false,
    incTimed: (tmd, amount) => {
      applied.push(`incTimed(${String(tmd)},${String(amount)})`);
      return true;
    },
    saveVsSkill: () => false,
    drainStat: () => {},
    hasHoldLife: () => false,
    drainExp: () => {},
    drainCharges: () => {},
    eatGold: () => false,
    eatItem: () => ({ blinked: false, obvious: true }),
    eatFood: () => {},
    eatLight: () => {},
    disenchant: () => {},
    earthquake: () => {},
    thrust: () => {},
    blinkAway: () => {},
  };
}

describe("a mod folder on disk reaches the monster blow registry", () => {
  it("adds a blow effect that lands on both combat paths", async () => {
    writeMod(
      "soulburn",
      { capabilities: ["registry:blow"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           /* One description; the engine derives both handlers from it. */
           host.blows.define("soulburn:sear", {
             damage: (ctx) => ctx.baseDamage + 7,
             after: () => [{ kind: "timed", effect: "AFRAID", amount: 4 }],
           });
           /* And wrap a core effect, calling through rather than around it. */
           const core = host.blows.handlerFor("HURT");
           host.blows.register("HURT", {
             record: (ctx) => core.record(ctx),
             live: (ctx, env) => core.live(ctx, env),
           });
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "soulburn", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:blow"],
    });
    expect(code.problems).toEqual([]);
    expect(code.plugins).toHaveLength(1);

    /* The REAL table combat consults, seeded exactly as wireGame seeds it. */
    const blows = new BlowEffectRegistry();
    registerCoreBlowEffects(blows);
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { blows },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("soulburn"));

    expect(blows.has("soulburn:sear")).toBe(true);

    /* Worldless: the blow lands, damage comes from the MOD's function, and the
     * consequence is recorded as an intent. */
    const worldless = monMeleeAttack(
      new Rng(5),
      monsterWithBlow("soulburn:sear"),
      testPlayer(),
      { ac: 0, toA: 0 },
      { blowEffects: blows },
    );
    expect(worldless.blows[0]?.effect).toBe("soulburn:sear");
    expect(worldless.sideEffects).toEqual([
      { kind: "timed", effect: "AFRAID", amount: 4 },
    ]);
    /* dice "10" + the mod's +7. Core alone would have dealt 10. */
    expect(worldless.totalDamage).toBe(17);

    /* Live: the same description, applied for real through the environment. */
    const player = testPlayer();
    const applied: string[] = [];
    const live = monMeleeAttack(
      new Rng(5),
      monsterWithBlow("soulburn:sear"),
      player,
      { ac: 0, toA: 0 },
      { env: loggingBlowEnv(player, applied), blowEffects: blows },
    );
    expect(live.blows[0]?.effect).toBe("soulburn:sear");
    expect(applied).toEqual(["takeHit(17)", `incTimed(${String(TMD.AFRAID)},4)`]);
    expect(player.chp).toBe(83);
  });

  it("without the capability the blow registry refuses at the call", async () => {
    writeMod(
      "sneaky",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) { host.blows.define("sneaky:bite", {}); },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "sneaky", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const blows = new BlowEffectRegistry();
    registerCoreBlowEffects(blows);
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { blows },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("sneaky"))).toThrow(
      /registry:blow/,
    );
    expect(blows.has("sneaky:bite")).toBe(false);
  });
});

/**
 * The store-behaviour registry, from disk.
 *
 * A mod could already add a store record and its own object kinds; it could not
 * make the shop deal in them, because "what will this shop buy" and "how many
 * does it stock" were switches. The assertions run the real `storeWillBuy`
 * against the registry the mod wrote into, so a handler that was installed but
 * never consulted would fail here.
 */
describe("a mod folder on disk reaches the store registry", () => {
  it("changes what a shop buys, and wraps core's rule rather than replacing it", async () => {
    writeMod(
      "haggler",
      { capabilities: ["registry:store"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           /* One shop stops buying entirely. */
           host.stores.setWillBuy(${String(FEAT.STORE_GENERAL)}, () => false);
           /* And every OTHER shop keeps core's rule, with one exception layered
            * on top - taken by calling through, not reimplemented. */
           const core = host.stores.willBuyFor("*");
           host.stores.setWillBuy("*", (ctx) => ctx.obj.tval === 999 ? true : core(ctx));
           /* A stack rule for a tval core has none for. */
           host.stores.setMassProduce(999, () => 12);
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "haggler", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:store"],
    });
    expect(code.problems).toEqual([]);
    expect(code.plugins).toHaveLength(1);

    const stores = new StoreBehaviourRegistry();
    registerCoreStoreBehaviour(stores);
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { stores },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("haggler"));

    /* The registry combat and town actually read. objectValue is never reached
     * on these paths - the mod's handler decides first, and for tval 999 the
     * wrapper answers before delegating - so no ObjRegistry is needed. */
    const reg = {} as never;
    const flagKnown = (): boolean => false;
    const modItem = { tval: 999 } as never;

    /* The named shop refuses outright. */
    expect(
      storeWillBuy(
        reg,
        { feat: FEAT.STORE_GENERAL, buy: null },
        modItem,
        true,
        false,
        false,
        flagKnown,
        stores,
      ),
    ).toBe(false);

    /* Any other shop takes the mod's own item, through the wildcard wrapper. */
    expect(
      storeWillBuy(
        reg,
        { feat: FEAT.STORE_ALCHEMY, buy: null },
        modItem,
        true,
        false,
        false,
        flagKnown,
        stores,
      ),
    ).toBe(true);

    /* And the stack rule is the mod's, on the live registry. */
    expect(stores.massProduceFor(999)).not.toBeNull();
    expect(
      stores.massProduceFor(999)?.({
        rng: new Rng(1),
        obj: modItem,
        cost: 0,
        massRoll: () => 0,
      }),
    ).toBe(12);
  });

  it("without the capability the store registry refuses at the call", async () => {
    writeMod(
      "cheapskate",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) { host.stores.setWillBuy("*", () => true); },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "cheapskate", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const stores = new StoreBehaviourRegistry();
    registerCoreStoreBehaviour(stores);
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { stores },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("cheapskate"))).toThrow(
      /registry:store/,
    );
  });
});

/**
 * The room-template / vault glyph registry, from disk.
 *
 * WHAT THIS EXISTS TO CATCH. `vault.json` has always accepted a new record, so
 * a mod could always ship a vault - but only one drawn with the symbols the
 * decoder already knew. A symbol it did not know became plain floor: no error,
 * no effect, and no way for an author to find out except by staring at the
 * level. This drives the REAL `buildVault` over a vault the mod ships, and
 * asserts on the CHUNK - what the level actually looks like - rather than on
 * the registry or on the mod's report of itself.
 *
 * The control: drop `glyphs` from the host's targets and the register call
 * throws "did not wire"; drop the capability and it throws at the gate; leave
 * the glyph unregistered and the `Q` grids come out FLOOR, which is exactly the
 * silent failure this seam removes. All three were run.
 */
describe("a mod folder on disk reaches the vault glyph registry", () => {
  /* A 5x5 vault whose middle row is a symbol core has never heard of. */
  const MOD_VAULT = {
    name: "sigil vault",
    typ: "Lesser vault",
    rat: 0,
    hgt: 5,
    wid: 5,
    minLev: 1,
    maxLev: 127,
    fewEntrances: false,
    rows: ["%%%%%", "%...%", "%QQQ%", "%...%", "%%%%%"],
  };

  /** A blank granite chunk big enough that find_space never runs. */
  function genOver(rooms: RoomRegistry): Gen {
    const reg = new FeatureRegistry(
      loadPackRecords<TerrainRecordJson>("terrain"),
    );
    const constants = bindConstants(loadPackJson("constants"));
    const c = new Chunk(reg, 25, 40);
    c.depth = 10;
    fillRectangle(c, 0, 0, 24, 39, FEAT.GRANITE, SQUARE.NONE);
    const g = new Gen(c, new Rng(7), reg, constants, new Dun(constants), null, null);
    /* What makeGen does on a real level: the level's glyph table, so the mod's
     * registration is in scope for this build. */
    g.glyphs = rooms.glyphs;
    return g;
  }

  it("teaches the game a symbol its vault uses, and the level shows it", async () => {
    writeMod(
      "sigil",
      { capabilities: ["registry:glyph"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           /* Wrap core's '%' rather than replace it: the outer wall also
            * records an entrance, and a mod that reimplemented it would
            * disagree with the level around it. */
           const outer = host.glyphs.handlerFor("vault", "%");
           host.glyphs.set("vault", "%", {
             terrain(ctx) {
               ctx.g.dun.modOuterWalls = (ctx.g.dun.modOuterWalls ?? 0) + 1;
               return outer.terrain(ctx);
             },
           });
           /* And a symbol core has never heard of. The feature index is
            * interpolated from core's own FEAT table rather than hard-coded,
            * so the test cannot pass against a number that has drifted. */
           host.glyphs.set("vault", "Q", {
             terrain(ctx) {
               ctx.g.c.setFeat(ctx.grid, ${String(FEAT.LAVA)});
             },
           });
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "sigil", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:glyph"],
    });
    expect(code.problems).toEqual([]);

    /* The REAL registry generation reads, seeded with core's own glyphs. */
    const rooms = new RoomRegistry({ templates: [], vaults: [MOD_VAULT] });
    expect(rooms.glyphs.has("vault", "Q")).toBe(false);

    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { glyphs: rooms.glyphs },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("sigil"));
    expect(rooms.glyphs.has("vault", "Q")).toBe(true);

    /* Now build it for real and read the level, not the registry. */
    const g = genOver(rooms);
    expect(buildVault(g, loc(20, 12), MOD_VAULT)).toBe(true);

    /* The vault is 5x5 centred on (20,12): top-left (18,10). Row 2 is QQQ. */
    for (const x of [19, 20, 21]) {
      expect(g.c.feat(loc(x, 12))).toBe(FEAT.LAVA);
    }
    /* The rows either side are ordinary floor, so the mod changed its own
     * symbol and nothing else. */
    expect(g.c.feat(loc(20, 11))).toBe(FEAT.FLOOR);
    expect(g.c.feat(loc(20, 13))).toBe(FEAT.FLOOR);
    /* Core's '%' still ran - the wrapper called through rather than shadowing. */
    expect(g.c.isGranite(loc(18, 10))).toBe(true);
    expect((g.dun as unknown as { modOuterWalls?: number }).modOuterWalls).toBe(16);
  });

  it("without the capability the glyph registry refuses at the call", async () => {
    writeMod(
      "trespasser",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) { host.glyphs.set("vault", "Q", { terrain() {} }); },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "trespasser", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const rooms = new RoomRegistry({ templates: [], vaults: [] });
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { glyphs: rooms.glyphs },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("trespasser"))).toThrow(
      /registry:glyph/,
    );
    expect(rooms.glyphs.has("vault", "Q")).toBe(false);
  });

  it("an unknown symbol without a mod is silently plain floor - the failure this removes", () => {
    /* The BEFORE picture, kept as a test so the seam's value is measured
     * rather than asserted: with nothing registered for 'Q' the grids come out
     * FLOOR and the build still returns true. */
    const rooms = new RoomRegistry({ templates: [], vaults: [MOD_VAULT] });
    const g = genOver(rooms);
    expect(buildVault(g, loc(20, 12), MOD_VAULT)).toBe(true);
    expect(g.c.feat(loc(20, 12))).toBe(FEAT.FLOOR);
  });
});

/**
 * The other five registry domains, from disk.
 *
 * They already had a sample mod - `packages/web/mods/demo-trusted` - but that mod
 * is BUNDLED, and this page's own rule is that a seam only a bundled mod can
 * reach is not a capability. A bundled demo is compiled into the app: it proves
 * the facade works, not that a mod a player installs can get to it. So the same
 * five overrides are done again here by a folder written to disk and imported for
 * real, and every assertion is made on the live registry.
 *
 * One mod exercises all five, which is also the realistic case - a mod that
 * changes the game usually reaches more than one system, and the composed
 * capability set has to carry all of them.
 */
describe("a mod folder on disk reaches every other registry domain", () => {
  it("overrides effects, rooms, commands, monster AI and vocabulary", async () => {
    writeMod(
      "overhaul",
      {
        capabilities: [
          "registry:effect",
          "registry:room",
          "registry:command",
          "registry:monster",
          "registry:vocab",
        ],
      },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           host.effects.register("overhaul:pulse", { handler: () => true, desc: "a mod effect" });
           host.rooms.register("overhaul:hall", () => true);
           host.commands.register("overhaul:dance", () => 3);
           host.commands.setVerb("overhaul:dance", "dance with");
           host.monsters.setTurnHook(() => true);
           host.vocab.define({ kind: "stat", term: "overhaul:grit", label: "Grit" });
           host.vocab.setValue("player", "overhaul:grit", 4);
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "overhaul", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [
        "registry:effect",
        "registry:room",
        "registry:command",
        "registry:monster",
        "registry:vocab",
      ],
    });
    expect(code.problems).toEqual([]);
    expect(code.plugins).toHaveLength(1);

    const effects = new EffectRegistry();
    const rooms = new RoomRegistry({ vaults: [], rooms: [] } as never);
    const commands = new ActionRegistry();
    const commandVerbs = new CommandVerbTable();
    const vocab = new VocabularyRegistry();
    const state = {} as { monsterTurnHook?: unknown };

    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { effects, rooms, commands, commandVerbs, state: state as never, vocab },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("overhaul"));

    /* Every assertion is on the live object the GAME reads, not on the host. */
    expect(effects.isRegistered("overhaul:pulse")).toBe(true);
    expect(rooms.get("overhaul:hall")).toBeTypeOf("function");
    expect(commands.get("overhaul:dance")).toBeTypeOf("function");
    /* ... including the verb the "Really <verb> <the object>? " confirm reads,
     * which is what a mod command had no way to supply (#284). The sentence it
     * produces is asserted in core (session/command-verb-wiring.test.ts). */
    expect(commandVerbs.verbFor("overhaul:dance")).toBe("dance with");
    expect(state.monsterTurnHook).toBeTypeOf("function");
    expect(vocab.has("stat", "overhaul:grit")).toBe(true);
    expect(vocab.getValue("player", "overhaul:grit")).toBe(4);
  });

  it("one missing capability costs that domain and nothing else", async () => {
    /* The composed set is not all-or-nothing: the mod above minus registry:vocab
     * still gets its effect through, and only the vocab call throws. A gate that
     * failed whole-mod would make partial consent useless. */
    const report = await readModDir(
      fsSource([{ id: "overhaul", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [
        "registry:effect",
        "registry:room",
        "registry:command",
        "registry:monster",
        "registry:vocab",
      ],
    });
    const effects = new EffectRegistry();
    const host = createModRegistryHost(
      {
        effects,
        rooms: new RoomRegistry({ vaults: [], rooms: [] } as never),
        commands: new ActionRegistry(),
        commandVerbs: new CommandVerbTable(),
        state: {} as never,
        vocab: new VocabularyRegistry(),
      },
      /* Manifest minus vocab: what the mod ASKED for is the gate, and it did not
       * ask for this one. */
      CapabilitySet.fromManifest({
        ...code.plugins[0]!.manifest,
        capabilities: [
          "registry:effect",
          "registry:room",
          "registry:command",
          "registry:monster",
        ],
      }),
    );
    expect(() => code.plugins[0]!.plugin.register?.(host, ctx("overhaul"))).toThrow(
      /registry:vocab/,
    );
    /* The calls BEFORE the throw landed - the gate is per call, not per mod. */
    expect(effects.isRegistered("overhaul:pulse")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * A mod folder on disk patching a record that NO ref could name before.
 *
 * Gap 2's residue, proven closed the way this project requires: not against a
 * fixture, but against the REAL shipped ego_item.json, by a mod written to a
 * real folder and read back through the real disk reader. Before 2026-08-08,
 * 61 of that file's 107 records - "of Acid" among them - shared a key with
 * another record and were addressable by nothing at all.
 * ------------------------------------------------------------------ */

describe("a disk mod patches a record that used to be unaddressable", () => {
  /** The real core pack's ego_item records, as the game binds them. */
  function coreEgoItems(): LoadedPack {
    const path = fileURLToPath(
      new URL("../../content/pack/ego_item.json", import.meta.url),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      records: Record<string, unknown>[];
    };
    return {
      manifest: { id: "core", name: "Angband", version: "1.0.0", shape: "content" },
      files: { ego_item: { records: raw.records } },
    } as unknown as LoadedPack;
  }

  /** Every shipped "of Acid" ego, in file order. */
  function acidEgos(records: readonly unknown[]): Array<Record<string, unknown>> {
    return (records as Array<Record<string, unknown>>).filter(
      (r) => r["name"] === "of Acid",
    );
  }

  it("changes exactly the ammo brand, leaving the melee one alone", async () => {
    writeMod(
      "sharper-acid",
      { shape: "content", dependencies: { core: "*" } },
      null,
      {
        "ego_item.json": JSON.stringify({
          patches: { "core:of-acid#shot-arrow-bolt": { info: { cost: 999, rating: 42 } } },
        }),
      },
    );
    const report = await readModDir(
      fsSource([{ id: "sharper-acid", files: ["manifest.json", "ego_item.json"] }]),
    );
    expect(report.problems).toEqual([]);
    const pack = report.packs[0];
    expect(pack).toBeDefined();

    const core = coreEgoItems();
    const before = acidEgos(core.files["ego_item"]?.records ?? []);
    /* The premise: core really does ship this name more than once. If a future
     * pack stops doing that, this test should say so rather than pass on a
     * file where nothing was ever ambiguous. */
    expect(before.length).toBeGreaterThan(1);

    const composed = composeContentPacks([
      core,
      { manifest: pack!.manifest, files: pack!.files } as unknown as LoadedPack,
    ]);
    expect(composed.problems).toEqual([]);

    const after = acidEgos(composed.records["ego_item"] ?? []);
    expect(after).toHaveLength(before.length);

    /* The one whose item types the ref named took the patch... */
    const ammo = after.filter((r) => {
      const types = r["type"];
      return Array.isArray(types) && types.includes("shot");
    });
    expect(ammo).toHaveLength(1);
    expect(ammo[0]?.["info"]).toEqual({ cost: 999, rating: 42 });

    /* ...and every other "of Acid" is untouched, which is the half a
     * name-only key could never express. */
    const others = after.filter((r) => {
      const types = r["type"];
      return !(Array.isArray(types) && types.includes("shot"));
    });
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) {
      expect(r["info"]).not.toEqual({ cost: 999, rating: 42 });
    }
  });

  it("refuses the ambiguous base ref and hands back the refs that work", async () => {
    /* The other half of "zero silent no-ops": an author who writes the obvious
     * ref gets told what to write instead, from the running data. */
    writeMod(
      "vague-acid",
      { shape: "content", dependencies: { core: "*" } },
      null,
      { "ego_item.json": JSON.stringify({ patches: { "core:of-acid": { info: {} } } }) },
    );
    const report = await readModDir(
      fsSource([{ id: "vague-acid", files: ["manifest.json", "ego_item.json"] }]),
    );
    const pack = report.packs[0];
    const composed = composeContentPacks([
      coreEgoItems(),
      { manifest: pack!.manifest, files: pack!.files } as unknown as LoadedPack,
    ]);
    expect(composed.problems).toHaveLength(1);
    const why = composed.problems[0] as string;
    expect(why).toContain("vague-acid");
    expect(why).toContain("core:of-acid#");
    /* Named alternatives, not just "it is ambiguous". */
    expect(why).toContain("core:of-acid#sword-polearm-hafted");
  });
});

/* ------------------------------------------------------------------ *
 * A disk mod ADDS a field to a core object and reads it back at runtime.
 *
 * The maintainer's test case, verbatim: make a dagger 1d5 instead of 1d4, and
 * give it a `bleed` key core has never heard of. Both halves matter and only one
 * of them used to work - composition always carried the new key through, and
 * then every binder dropped it, so an author got no error and no effect. That is
 * the difference between a mod that can RETUNE the game and one that can EXTEND
 * it.
 * ------------------------------------------------------------------ */

describe("a disk mod adds a field core has never heard of", () => {
  function corePack(): LoadedPack {
    const read = (stem: string): { records: Record<string, unknown>[] } =>
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../../content/pack/${stem}.json`, import.meta.url)),
          "utf8",
        ),
      ) as { records: Record<string, unknown>[] };
    return {
      manifest: { id: "core", name: "Angband", version: "1.0.0", shape: "content" },
      files: { object: { records: read("object").records } },
    } as unknown as LoadedPack;
  }

  it("retunes the dagger AND carries its own declared field to the bound kind", async () => {
    /* The maintainer's test case, verbatim: a dagger retuned to 1d5, plus a
     * `bleed` field core has never heard of, whose meaning the mod supplies. */
    writeMod(
      "bleeder",
      {
        shape: "content",
        dependencies: { core: "*" },
        fields: [{ name: "bleed", files: ["object"], type: "object", label: "Bleed" }],
      },
      null,
      {
        "object.json": JSON.stringify({
          fieldPatches: {
            "core:sword--dagger": [
              { op: "set", path: "attack.hd", value: "1d5" },
              { op: "set", path: "bleeder:bleed", value: { dice: "1d3", turns: 5 } },
            ],
          },
        }),
      },
    );
    const report = await readModDir(
      fsSource([{ id: "bleeder", files: ["manifest.json", "object.json"] }]),
    );
    expect(report.problems).toEqual([]);
    const pack = report.packs[0];
    expect(pack).toBeDefined();

    const composed = composeContentPacks([
      corePack(),
      { manifest: pack!.manifest, files: pack!.files } as unknown as LoadedPack,
    ]);
    expect(composed.problems).toEqual([]);

    const objects = composed.records["object"] as Record<string, unknown>[];
    const dagger = objects.find((r) => r["name"] === "& Dagger~");
    expect(dagger, "core still ships the dagger under this name").toBeDefined();
    expect(dagger?.["attack"]).toMatchObject({ hd: "1d5" });
    expect(dagger?.["bleeder:bleed"]).toEqual({ dice: "1d3", turns: 5 });

    /* The half that used to be lost: what the GAME ends up holding. */
    const ext = extensionData("object", dagger as object);
    expect(ext, "the added key survives classification").toEqual({
      "bleeder:bleed": { dice: "1d3", turns: 5 },
    });
    /* And core's own fields are not smuggled in alongside it. */
    expect(ext?.["attack"]).toBeUndefined();
  });

  it("strips the same field from a mod that did NOT declare it, and says so", async () => {
    /* The declaration is the difference, and this is the only test that shows
     * it: identical bytes on the record side, one manifest line apart. */
    writeMod("sloppy", { shape: "content", dependencies: { core: "*" } }, null, {
      "object.json": JSON.stringify({
        fieldPatches: {
          "core:sword--dagger": [
            { op: "set", path: "sloppy:bleed", value: { dice: "1d3" } },
          ],
        },
      }),
    });
    const report = await readModDir(
      fsSource([{ id: "sloppy", files: ["manifest.json", "object.json"] }]),
    );
    const pack = report.packs[0];
    const composed = composeContentPacks([
      corePack(),
      { manifest: pack!.manifest, files: pack!.files } as unknown as LoadedPack,
    ]);
    const objects = composed.records["object"] as Record<string, unknown>[];
    const dagger = objects.find((r) => r["name"] === "& Dagger~");
    expect(dagger?.["sloppy:bleed"]).toBeUndefined();
    expect(composed.problems.join(" | ")).toContain('dropped "sloppy:bleed"');
  });

  it("does not mistake a misspelling of one of core's fields for a new one", async () => {
    /* `atack` reaches core looking exactly like a deliberate field. Before the
     * namespace rule it would have appeared in `ext`, and the author would have
     * seen their data arrive and concluded the patch worked - while the real
     * `attack` went untouched. */
    writeMod("typo", { shape: "content", dependencies: { core: "*" } }, null, {
      "object.json": JSON.stringify({
        fieldPatches: {
          "core:sword--dagger": [{ op: "set", path: "atack", value: { hd: "1d9" } }],
        },
      }),
    });
    const report = await readModDir(
      fsSource([{ id: "typo", files: ["manifest.json", "object.json"] }]),
    );
    const pack = report.packs[0];
    const composed = composeContentPacks([
      corePack(),
      { manifest: pack!.manifest, files: pack!.files } as unknown as LoadedPack,
    ]);
    const objects = composed.records["object"] as Record<string, unknown>[];
    const dagger = objects.find((r) => r["name"] === "& Dagger~");
    expect(extensionData("object", dagger as object)).toBeUndefined();

    /* And the host, which HAS core's key table, names it. */
    const faults = checkUnqualified("object", objects, CORE_RECORD_KEYS["object"] ?? []);
    expect(faults.map((f) => f.key)).toEqual(["atack"]);
    expect(faults[0]?.message).toContain('did you mean "attack"');
  });

  it("leaves an unmodded record with no ext at all", async () => {
    /* `ext` present has to MEAN something, or a mod cannot tell its own data
     * from core's by looking. */
    const composed = composeContentPacks([corePack()]);
    const objects = composed.records["object"] as Record<string, unknown>[];
    const dagger = objects.find((r) => r["name"] === "& Dagger~");
    expect(extensionData("object", dagger as object)).toBeUndefined();
    await Promise.resolve();
  });
});

/**
 * The projection registries, from disk.
 *
 * project_f / project_o / project_p stopped being switches and became keyed
 * registries - and for a day they were registries with NO PRODUCER: the
 * override field existed, was typed and was consumed, and nothing anywhere
 * wrote it. This runs the real dispatch function against the table a mod
 * folder on disk wrote into, so "installed" and "consulted" are one assertion
 * rather than two hopes.
 *
 * The live-game half - that wireGame hands these tables to the engine by
 * identity, so a register() that runs after wiring is still seen - is proven by
 * firing a real projection in core's session/projection-registry-wiring.test.ts.
 */
describe("a mod folder on disk reaches the projection registries", () => {
  it("gives its own projection a terrain arm, and wraps a core one", async () => {
    writeMod(
      "sludge",
      { capabilities: ["registry:projection"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           /* A brand-new projection's terrain behaviour: the thing a mod could
            * not do at all while this was a switch. */
           host.projections.feat.set("sludge:ooze", (ctx) => {
             ctx.state.seen.push("ooze@" + String(ctx.dam));
             return true;
           });
           /* And a core code, wrapped rather than replaced - the mod's line
            * runs, then core's own handler does, and core's answer is what
            * comes back. MON_HEAL is one of the 24 codes whose upstream
            * terrain arm is deliberately empty, which is what lets this
            * assertion be about the CALL-THROUGH and not about a chunk. */
           const core = host.projections.feat.handlerFor("MON_HEAL");
           host.projections.feat.set("MON_HEAL", (ctx) => {
             ctx.state.seen.push("wrapped-core");
             return core(ctx);
           });
           /* The other two sides answer too. */
           host.projections.player.set("sludge:ooze", () => {});
           host.projections.obj.set("sludge:ooze", () => {});
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "sludge", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:projection"],
    });
    expect(code.problems).toEqual([]);
    expect(code.plugins).toHaveLength(1);

    /* The registry wireGame builds, seeded exactly as wireGame seeds it. */
    const projections = new ProjectionHandlerRegistry();
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { projections },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("sludge"));

    expect(projections.feat.has("sludge:ooze")).toBe(true);
    expect(projections.obj.has("sludge:ooze")).toBe(true);
    expect(projections.player.has("sludge:ooze")).toBe(true);

    /* Now RUN project_f, the real one, over the table the mod wrote into.
     * The bound projection table is what turns a PROJ number into a code, and
     * a mod's projection is appended past core's - so slot 0 here stands for
     * "wherever this pack's own projection landed". Neither handler touches
     * the state, so a recorder is all project_f needs to be given. */
    const state = { seen: [] as string[] } as never;
    const bound = [{ code: "sludge:ooze" }, { code: "MON_HEAL" }] as never;
    const env = { featHandlers: projections.feat.table, projections: bound };

    /* The mod's own projection, at the slot its record landed in. */
    expect(projectFeature(state, 0, loc(3, 4), 40, 0, env)).toBe(true);
    /* And core's, through the wrapper: core's `false` is what surfaces, so the
     * inner handler was really called rather than merely held. */
    expect(projectFeature(state, 0, loc(3, 4), 10, 1, env)).toBe(false);

    expect((state as unknown as { seen: string[] }).seen).toEqual([
      "ooze@40",
      "wrapped-core",
    ]);
  });

  it("without the capability the projection registry refuses at the call", async () => {
    writeMod(
      "meddler",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) { host.projections.player.set("FIRE", () => {}); },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "meddler", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const projections = new ProjectionHandlerRegistry();
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { projections },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("meddler"))).toThrow(
      /registry:projection/,
    );
    expect(projections.player.handlerFor("FIRE")).toBe(
      PLAYER_SIDE_HANDLERS.get("FIRE"),
    );
  });
});

/**
 * The effect-info registry, from disk.
 *
 * WHAT THIS EXISTS TO CATCH. `registry:effect` has always let a mod register a
 * handler for a brand-new effect code and have it DO something. What no mod
 * could do was let the game SAY anything about it: `effectMenuName` and
 * `effect_describe` were closed switches on the EFINFO_* flag, and a mod's
 * effect has no flag - so it showed a blank row in the activate/cast menu and
 * contributed nothing at all to object recall. No error, no effect, and no way
 * for an author to find out except by looking at the menu.
 *
 * This drives the REAL `effectMenuName` and `describeEffect` over an effect
 * chain built from a mod's own string code, and asserts on the STRINGS a player
 * would read - not on the registry, and not on the mod's report of itself.
 *
 * The controls, all run: drop `effectInfo` from the host's targets and the
 * register call throws "did not wire"; drop the capability and it throws at the
 * gate; leave the handler unregistered and both strings come out empty, which
 * is the silent failure this seam removes.
 */
describe("a mod folder on disk reaches the effect-info registry", () => {
  /* Module-level table: restore core's arms so one test cannot leak into the
   * next. This is also the assertion that `resetEffectInfoRegistry` works,
   * since the "before" test below runs after a registration. */
  afterEach(() => {
    resetEffectInfoRegistry();
  });

  /** An effect chain of one node carrying a mod's own string code. */
  function modEffect(): ReturnType<typeof effectNew> {
    const e = effectNew("SOULFIRE");
    e.subtype = 2;
    const d = new Dice();
    d.parseString("4d6");
    e.dice = d;
    e.diceString = "4d6";
    return e;
  }

  it("gives a mod's own effect a menu row and a recall sentence", async () => {
    writeMod(
      "soulfire",
      { capabilities: ["registry:effect-info"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           host.effectInfo.text.set("SOULFIRE", {
             menuName: (c) => "burn a soul for " + c.average() + " damage",
             describe: (c) =>
               "sears the target for " + c.diceString + " soul damage" +
               c.appendDamage(),
           });
           /* Wrap a CORE flag too, rather than only adding: keeping the
            * previous handler and calling through is the difference between
            * extending the recall and replacing it with your own guess. */
           const inner = host.effectInfo.text.handlerFor("EFINFO_QUAKE");
           host.effectInfo.text.set("EFINFO_QUAKE", {
             menuName: inner.menuName,
             describe: (c) => inner.describe(c) + ", and the air screams",
           });
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "soulfire", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:effect-info"],
    });
    expect(code.problems).toEqual([]);

    const reg = effectInfoRegistry();
    expect(reg.text.has("SOULFIRE")).toBe(false);

    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { effectInfo: reg },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("soulfire"));
    expect(reg.text.has("SOULFIRE")).toBe(true);

    /* What the player reads. The menu row and the recall sentence, from the
     * real functions the UI calls. */
    const e = modEffect();
    expect(effectMenuName(e)).toBe("burn a soul for 14 damage");
    expect(describeEffect(e, null, 0, true, { projections: [] })).toBe(
      "sears the target for 4d6 soul damage for an average of 14.0 damage",
    );

    /* And the wrapped core flag still says everything it said before, plus the
     * mod's tail - so wrapping composed rather than shadowed. */
    const quake = effectNew(EF.EARTHQUAKE);
    quake.radius = 10;
    const said = describeEffect(quake, null, 0, true, { projections: [] });
    expect(said).toContain("10");
    expect(said?.endsWith(", and the air screams")).toBe(true);
  });

  it("without the capability the effect-info registry refuses at the call", async () => {
    writeMod(
      "mute",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           host.effectInfo.text.set("SOULFIRE", { menuName: () => "x" });
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "mute", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const reg = effectInfoRegistry();
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { effectInfo: reg },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("mute"))).toThrow(
      /registry:effect-info/,
    );
    expect(reg.text.has("SOULFIRE")).toBe(false);
  });

  it("a mod effect with no handler is silently blank - the failure this removes", () => {
    /* The BEFORE picture, kept as a test so the seam's value is measured
     * rather than asserted. Both strings are empty and nothing complains. */
    expect(effectInfoRegistry().text.has("SOULFIRE")).toBe(false);
    const e = modEffect();
    expect(effectMenuName(e)).toBe("");
    expect(describeEffect(e, null, 0, true, { projections: [] })).toBeNull();
  });
});

/**
 * The random-artifact registry, from disk.
 *
 * WHAT THIS EXISTS TO CATCH. `artifact.json` has always accepted a new record,
 * so a mod could always ship a FIXED artifact. Reaching the RANDOM artifact
 * generator was a different thing entirely: `add_ability_aux` was an 87-case
 * switch and a mod-coined ability index took its default arm, which is a bare
 * `break`. The design loop SPENT POWER on that ability and the artifact got
 * nothing - no error, no effect, and no way for an author to find out except by
 * generating a few hundred artifacts and staring at them.
 *
 * This registers a new ability index and then runs `add_ability_aux` for real,
 * asserting on the ARTIFACT - what the player would eventually pick up - rather
 * than on the registry or on the mod's report of itself.
 *
 * The controls, all run: drop `randart` from the host's targets and the register
 * call throws "did not wire"; drop the capability and it throws at the gate;
 * leave the index unregistered and the artifact comes back untouched, which is
 * the silent failure this seam removes.
 */
describe("a mod folder on disk reaches the random artifact registry", () => {
  /* Module-level table: restore core's arms so one test cannot leak into the
   * next, and so the "before" test below is measuring core rather than the
   * previous test's registration. */
  afterEach(() => {
    resetRandartRegistry();
  });

  /** An ability index beyond everything core defines - a mod's own. */
  const MOD_ABILITY = 500;

  function objRegistry(): ObjRegistry {
    const reg = new ObjRegistry({
      objectBase: loadPackJson("object_base"),
      object: loadPackJson("object"),
      egoItem: loadPackJson("ego_item"),
      artifact: loadPackJson("artifact"),
      curse: loadPackJson("curse"),
      brand: loadPackJson("brand"),
      slay: loadPackJson("slay"),
      activation: loadPackJson("activation"),
      objectProperty: loadPackJson("object_property"),
      flavor: loadPackJson("flavor"),
    } as never);
    reg.projections = bindProjections(loadPackRecords("projection"));
    return reg;
  }

  /** The real set profile and a real artifact to build on. */
  function buildBed(reg: ObjRegistry): {
    art: ReturnType<typeof cloneArtifact>;
    data: ReturnType<typeof collectArtifactData>;
  } {
    const constants = bindConstants(loadPackJson("constants"));
    const data = collectArtifactData(reg, constants, reg.artifacts, new Rng(11));
    const src = reg.artifacts.find((a) => a !== null);
    return { art: cloneArtifact(src!), data };
  }

  it("teaches the generator a power core has never heard of", async () => {
    writeMod(
      "soulforge",
      { capabilities: ["registry:randart"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           /* A brand-new ability index. The flag is interpolated from core's
            * own OF table rather than hard-coded, so the test cannot pass
            * against a number that has drifted. */
           host.randart.abilities.set(${String(MOD_ABILITY)}, (ctx) => {
             ctx.art.flags.on(${String(OF.PROT_FEAR)});
             ctx.art.toA += 5;
           });
           /* And WRAP a core ability rather than replacing it: keeping the
            * previous handler and calling through is the difference between
            * extending the generator and guessing at what it used to do. An
            * ability that draws a different NUMBER of random values moves every
            * artifact generated after it. */
           const inner = host.randart.abilities.handlerFor(${String(ART_IDX.GEN_REGEN)});
           host.randart.abilities.set(${String(ART_IDX.GEN_REGEN)}, (ctx) => {
             inner(ctx);
             ctx.art.toD += 1;
           });
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "soulforge", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:randart"],
    });
    expect(code.problems).toEqual([]);

    const registry = randartRegistry();
    expect(registry.abilities.has(MOD_ABILITY)).toBe(false);

    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { randart: registry },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("soulforge"));
    expect(registry.abilities.has(MOD_ABILITY)).toBe(true);

    /* Now run the REAL generator entry point and read the artifact. */
    const reg = objRegistry();
    const { art, data } = buildBed(reg);
    const beforeAc = art.toA;
    addAbilityAux(reg, art, MOD_ABILITY, 100, data, new Rng(5));
    expect(art.flags.has(OF.PROT_FEAR)).toBe(true);
    expect(art.toA).toBe(beforeAc + 5);

    /* And the wrapped core ability still does what it did, plus the mod's
     * addition - so wrapping composed rather than shadowed. */
    const { art: art2, data: data2 } = buildBed(reg);
    art2.flags.off(OF.REGEN);
    const beforeDam = art2.toD;
    addAbilityAux(reg, art2, ART_IDX.GEN_REGEN, 100, data2, new Rng(5));
    expect(art2.flags.has(OF.REGEN)).toBe(true);
    expect(art2.toD).toBe(beforeDam + 1);
  });

  it("without the capability the randart registry refuses at the call", async () => {
    writeMod(
      "overreach",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           host.randart.abilities.set(${String(MOD_ABILITY)}, () => {});
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "overreach", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const registry = randartRegistry();
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { randart: registry },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("overreach"))).toThrow(
      /registry:randart/,
    );
    expect(registry.abilities.has(MOD_ABILITY)).toBe(false);
  });

  it("an unregistered ability silently does nothing - the failure this removes", () => {
    /* The BEFORE picture, kept as a test so the seam's value is measured
     * rather than asserted. add_ability_aux's default arm is a bare `break`,
     * so the artifact comes back untouched and the design loop has already
     * spent power on it. */
    expect(randartRegistry().abilities.has(MOD_ABILITY)).toBe(false);
    const reg = objRegistry();
    const { art, data } = buildBed(reg);
    const before = JSON.stringify([art.toA, art.toD, art.flags.count()]);
    addAbilityAux(reg, art, MOD_ABILITY, 100, data, new Rng(5));
    expect(JSON.stringify([art.toA, art.toD, art.flags.count()])).toBe(before);
  });
});

/**
 * The item-CLASS registry, from disk.
 *
 * WHAT THIS EXISTS TO CATCH. `object.json` has always accepted a new record, so
 * a mod could always ship a new ITEM. Making core recognise a new item CLASS -
 * a tval - was a different thing: thirty-four predicates in `obj-tval.c` and
 * two dispatches elsewhere decided every property a class has, all closed, all
 * failing by answering NO across 408 call sites. A mod's new item class was not
 * a weapon, could not be worn, could not be flavoured, was never "good", and
 * was worth nothing before it was identified. No error anywhere.
 *
 * This registers one mod-coined tval and then calls the REAL exported
 * predicates and the REAL `kindIsGood` / `objectValueBase`, asserting on what
 * they answer rather than on the registry or on the mod's report of itself.
 *
 * The controls, all run: drop `tval` from the host's targets and the register
 * call throws "did not wire"; drop the capability and it throws at the gate;
 * leave the tval unregistered and every question comes back no, which is the
 * silent failure this seam removes.
 */
describe("a mod folder on disk reaches the item-class registry", () => {
  /* Module-level tables: restore core's arms so one test cannot leak into the
   * next, and so the "before" test below is measuring core rather than the
   * previous test's registration. */
  afterEach(() => {
    resetTvalRegistry();
  });

  /** A tval beyond everything core defines - a mod's own. */
  const MOD_TVAL = 200;

  it("teaches core an item class it has never heard of", async () => {
    writeMod(
      "relicforge",
      { capabilities: ["registry:tval"] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           /* WRAP rather than replace. Keeping the previous predicate and
            * OR-ing one tval into it is the difference between widening a
            * class and guessing at everything else that was already in it -
            * and here the "everything else" is the whole base game. */
           for (const cls of ["tvalIsWeapon", "tvalIsWearable", "tvalCanHaveFlavor"]) {
             const inner = host.tval.classes.handlerFor(cls);
             host.tval.classes.set(cls, (t) => t === ${String(MOD_TVAL)} || inner(t));
           }
           /* And the two dispatches: good on its own merits, and worth
            * something before it is identified. */
           host.tval.good.set(${String(MOD_TVAL)}, () => true);
           host.tval.valueBase.set(${String(MOD_TVAL)}, () => 175);
           /* And a NAME. Without this every message, menu row and shop line
            * that mentions the class reads "(nothing)". */
           host.tval.basename.set(${String(MOD_TVAL)}, (c) =>
             c.showFlavor ? "& # Relic~" : "& Relic~",
           );
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "relicforge", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:tval"],
    });
    expect(code.problems).toEqual([]);

    /* BEFORE: core answers no to everything, which is the silent failure. */
    expect({
      weapon: tvalIsWeapon(MOD_TVAL),
      wearable: tvalIsWearable(MOD_TVAL),
      flavor: tvalCanHaveFlavor(MOD_TVAL),
    }).toEqual({ weapon: false, wearable: false, flavor: false });

    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { tval: tvalRegistry() },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("relicforge"));

    /* AFTER, read through the REAL exported predicates - the same functions the
     * 408 call sites call, not the table. */
    expect({
      weapon: tvalIsWeapon(MOD_TVAL),
      wearable: tvalIsWearable(MOD_TVAL),
      flavor: tvalCanHaveFlavor(MOD_TVAL),
    }).toEqual({ weapon: true, wearable: true, flavor: true });

    /* Composed, not shadowed: core's own classes still answer as they did. */
    expect({
      sword: tvalIsWeapon(TV.SWORD),
      potionFlavour: tvalCanHaveFlavor(TV.POTION),
      swordIsBook: tvalIsBook(TV.SWORD),
      modIsBook: tvalIsBook(MOD_TVAL),
    }).toEqual({
      sword: true,
      potionFlavour: true,
      swordIsBook: false,
      modIsBook: false,
    });

    /* And the two dispatches, through their real entry points. */
    const kind = {
      ...loadObjKinds().find((k) => k.tval === TV.POTION)!,
      tval: MOD_TVAL,
    };
    expect({
      good: kindIsGood(kind as never),
      value: objectValueBase({ tval: MOD_TVAL, kind } as never, false),
    }).toEqual({ good: true, value: 175 });

    /* And what the PLAYER READS, through the real objectDesc - which is the
     * whole point, because before this registered the answer was the literal
     * string "(nothing)". */
    const env = makeRuneEnv(
      () => null,
      ((v: { base: number }) => v.base) as never,
      {
        brands: [],
        slays: [],
        curses: [],
        properties: [],
        elementNames: ["acid", "lightning", "fire", "frost"],
        msg: () => {},
      } as never,
    );
    const named = objectDesc(
      { tval: MOD_TVAL, kind, number: 1 } as never,
      ODESC.PREFIX,
      null,
      env,
      { isAware: () => true, isTried: () => false },
    );
    /* The mod's template composed with core's naming machinery rather than
     * replacing it: "Relic" is the mod's, the article and the " of Strength"
     * tail are obj-desc.c's, and before the registration this whole string
     * would have read "(nothing)". */
    expect(named).toBe("the Relic of Strength");
  });

  it("without the capability the tval registry refuses at the call", async () => {
    writeMod(
      "trespass",
      { capabilities: [] },
      `export default {
         api: ${MOD_API_VERSION},
         register(host) {
           host.tval.classes.set("tvalIsWeapon", () => true);
         },
       };`,
    );
    const report = await readModDir(
      fsSource([{ id: "trespass", files: ["manifest.json"], code: [PLUGIN_FILE] }]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { tval: tvalRegistry() },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("trespass"))).toThrow(
      /registry:tval/,
    );
    expect(tvalIsWeapon(MOD_TVAL)).toBe(false);
  });
});

/**
 * MOD_REACH gap 16: a mod folder on disk teaches core a new kind of RUNE.
 *
 * The seam this exercises is the hardest closure the moddability work has hit.
 * `RuneVariety` was a closed TypeScript union of seven string literals, so a mod
 * could not coin a variety AT ALL - the type refused it before any default arm
 * was reached. Five functions dispatched on it (`runeDesc`, `playerKnowsRune`,
 * `objectHasRune`, `playerLearnRune`, `runeName`) and a sixth switched on
 * OBJ_MOD (`modMessage`, the "You feel stronger!" line). A mod's rune had no
 * description, could not be found on an item, could never be known, could never
 * be learned, and a mod-coined modifier was learned in silence.
 *
 * This registers one mod-coined variety, contributes two runes of it, and then
 * calls the REAL exported functions - the same ones `session/game.ts`,
 * `game/known.ts` and the knowledge browser call - asserting on what they
 * answer rather than on the registry or on the mod's report of itself.
 *
 * The controls, all run: drop `rune` from the host's targets and the register
 * call throws "did not wire"; drop the capability and it throws at the gate;
 * register the handlers but skip `contribute` and the rune never appears in
 * `buildRuneList`, which is the "a seam its callers walk past" failure the
 * previous four conversions each turned up somewhere different.
 */
describe("a mod folder on disk reaches the rune registry", () => {
  /* Module-level tables: restore core's arms so one test cannot leak into the
   * next, and so the "before" assertions measure core rather than the previous
   * test's registration. */
  afterEach(() => {
    resetRuneRegistry();
  });

  /** A variety core has never heard of - a mod's own. */
  const MOD_VARIETY = "relicforge:attunement";

  const RUNE_PLUGIN = `export default {
       api: ${MOD_API_VERSION},
       register(host) {
         /* The six answers core needs before a rune of this variety is real. */
         host.rune.desc.set(
           "${MOD_VARIETY}",
           (env, rune) => "Object attunes the wielder to " + rune.name + ".",
         );
         host.rune.name.set(
           "${MOD_VARIETY}",
           (rune) => rune.name + " attunement",
         );
         /* The mod owns its own knowledge store - core never grew a slot for
          * it, which is the whole point of the vocabulary architecture. */
         const known = new Set();
         host.rune.knows.set("${MOD_VARIETY}", (p, rune) => known.has(rune.name));
         host.rune.learn.set("${MOD_VARIETY}", (p, env, rune, message) => {
           if (known.has(rune.name)) return false;
           known.add(rune.name);
           if (message) env.msg("You have learned the rune of " + rune.name + ".");
           return true;
         });
         host.rune.objectHas.set(
           "${MOD_VARIETY}",
           (env, obj, rune) => (obj.modifiers[0] || 0) !== 0,
         );
         /* Wrapping, not shadowing: core's TUNNEL modifier says nothing at all,
          * so this is a pure addition; core's STR arm is composed with. */
         host.rune.modMessage.set(8, (v) => (v > 0 ? "Your hands itch to dig." : null));
         const innerStr = host.rune.modMessage.handlerFor(0);
         host.rune.modMessage.set(0, (v) => {
           const core = innerStr(v);
           return core ? core + " Mightily so." : core;
         });
         /* And the PRODUCER. Without this the six tables above are a seam every
          * caller in the game walks past: nothing asks about a rune that is not
          * in buildRuneList. */
         host.rune.contribute(() => [
           { variety: "${MOD_VARIETY}", index: 0, name: "flame" },
           { variety: "${MOD_VARIETY}", index: 1, name: "frost" },
         ]);
       },
     };`;

  it("teaches core a rune variety it has never heard of", async () => {
    writeMod("relicforge-runes", { capabilities: ["registry:rune"] }, RUNE_PLUGIN);
    const report = await readModDir(
      fsSource([
        { id: "relicforge-runes", files: ["manifest.json"], code: [PLUGIN_FILE] },
      ]),
    );
    expect(report.problems).toEqual([]);
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => ["registry:rune"],
    });
    expect(code.problems).toEqual([]);

    const world = runeWorld();
    const modRune = { variety: MOD_VARIETY, index: 0, name: "flame" };

    /* BEFORE: every answer is a silent no, and the rune is not in the list at
     * all - which is why no caller could ever have asked. */
    const before = buildRuneList(world.env);
    expect({
      inList: before.some((r) => r.variety === MOD_VARIETY),
      desc: runeDesc(world.env, modRune),
      knows: playerKnowsRune(world.player(), modRune),
    }).toEqual({ inList: false, desc: "", knows: false });

    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { rune: runeRegistry() },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    loaded!.plugin.register?.(host, ctx("relicforge-runes"));

    /* AFTER, read through the REAL exported functions - the ones the knowledge
     * screens, the save round-trip and EF_IDENTIFY all call. */
    const after = buildRuneList(world.env);
    const contributed = after.slice(before.length);
    expect({
      grew: after.length - before.length,
      keys: contributed.map((r) => runeKey(r)),
      /* Core's list is untouched and comes first. Every consumer keys on the
       * list INDEX, so an insertion in the middle would renumber core's runes
       * and mis-target every saved rune note. */
      corePrefixIntact: after
        .slice(0, before.length)
        .every((r, i) => runeKey(r) === runeKey(before[i]!)),
    }).toEqual({
      grew: 2,
      keys: ["relicforge:attunement:flame", "relicforge:attunement:frost"],
      corePrefixIntact: true,
    });

    const flame = contributed[0]!;
    const p = world.player();
    world.drain();
    const learned = playerLearnRune(p, world.env, flame, true);
    const messages = world.drain();

    const carrier = world.blankObject(TV.RING);
    carrier.modifiers[0] = 2;

    expect({
      display: runeName(flame),
      desc: runeDesc(world.env, flame),
      knowsBefore: false,
      learned,
      messages,
      knowsAfter: playerKnowsRune(p, flame),
      again: playerLearnRune(p, world.env, flame, true),
      onCarrier: objectHasRune(world.env, carrier as never, flame),
      onBare: objectHasRune(world.env, world.blankObject(TV.RING) as never, flame),
    }).toEqual({
      display: "flame attunement",
      desc: "Object attunes the wielder to flame.",
      knowsBefore: false,
      learned: true,
      messages: ["You have learned the rune of flame."],
      knowsAfter: true,
      again: false,
      onCarrier: true,
      onBare: false,
    });

    /* Core's own runes still answer as they did - composed, not replaced. */
    const coreBrand = after.find((r) => r.variety === "brand")!;
    expect({
      name: runeName(coreBrand).endsWith(" brand"),
      desc: runeDesc(world.env, coreBrand).startsWith("Object brands"),
    }).toEqual({ name: true, desc: true });

    /* And the modifier lines, through objectLearnOnWield: a modifier core says
     * nothing for now speaks, and core's own line is wrapped rather than lost. */
    const say = (mod: number, value: number): string[] => {
      const wielder = world.player();
      const obj = world.blankObject(TV.RING);
      obj.modifiers[mod] = value;
      world.drain();
      objectLearnOnWield(wielder, obj as never, world.env);
      return world.drain().filter((m) => !m.startsWith("You have learned"));
    };
    expect({
      tunnelUp: say(8, 2),
      tunnelDown: say(8, -2),
      strUp: say(0, 2),
      strDown: say(0, -2),
    }).toEqual({
      tunnelUp: ["Your hands itch to dig."],
      tunnelDown: [],
      strUp: ["You feel stronger! Mightily so."],
      strDown: ["You feel weaker! Mightily so."],
    });
  });

  it("without the capability the rune registry refuses at the call", async () => {
    writeMod("rune-trespass", { capabilities: [] }, RUNE_PLUGIN);
    const report = await readModDir(
      fsSource([
        { id: "rune-trespass", files: ["manifest.json"], code: [PLUGIN_FILE] },
      ]),
    );
    const code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: () => true,
      consented: () => [],
    });
    const loaded = code.plugins[0];
    const host = createModRegistryHost(
      { rune: runeRegistry() },
      CapabilitySet.fromManifest(loaded!.manifest),
    );
    expect(() => loaded!.plugin.register?.(host, ctx("rune-trespass"))).toThrow(
      /registry:rune/,
    );
    const world = runeWorld();
    expect(
      buildRuneList(world.env).some((r) => r.variety === MOD_VARIETY),
    ).toBe(false);
  });
});
