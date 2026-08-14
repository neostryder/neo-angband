/**
 * The folder code loader (mod-code.ts).
 *
 * Two things are being proved here, and the second matters more than the first.
 *
 * 1. A folder CAN supply code. Until this path existed, every route to a mod's
 *    behaviour was a build-time Vite glob, so a third-party mod could ship records
 *    and nothing else no matter what the SDK could express.
 *
 * 2. Every gate is applied BEFORE the module is imported. That is not a detail:
 *    a module's top-level statements run the instant it is imported, so a check
 *    performed on the imported object has already lost. The importer is injected
 *    and counted, which is the only way to assert an ABSENCE of execution - and an
 *    absence is exactly what a "we check the version" claim usually turns out to
 *    be.
 */

import { describe, expect, it, vi } from "vitest";
import { problemLines } from "./mod-problems";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { loadModCode, hasPlugin, PLUGIN_FILE } from "./mod-code";
import type { CodeUrlResolver, DiskPack } from "./disk-packs";
import { MOD_API_MIN, MOD_API_VERSION, modApiVerdict, validateModPlugin } from "./mod-plugin";

/** A pack that ships code, with whatever manifest overrides a case needs. */
function codePack(id: string, over: Partial<PackManifest> = {}): DiskPack {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      shape: "plugin",
      modApi: MOD_API_VERSION,
      ...over,
    } as PackManifest,
    files: {},
    code: [PLUGIN_FILE],
    assets: [],
  };
}

/** A pure content pack: no code at all. */
function dataPack(id: string): DiskPack {
  return {
    manifest: { id, name: id, version: "1.0.0", shape: "content" } as PackManifest,
    files: { monster: [] },
    code: [],
    assets: [],
  };
}

/** A code URL resolver that hands back a fake URL and records releases. */
function resolver(released: string[] = []): CodeUrlResolver {
  const fn = ((id: string, file: string) => Promise.resolve(`mem://${id}/${file}`)) as {
    (id: string, file: string): Promise<string | null>;
    release?: (url: string) => void;
  };
  fn.release = (url) => released.push(url);
  return fn as CodeUrlResolver;
}

const ALL_ENABLED = (): boolean => true;
const NO_CAPS = (): readonly string[] => [];

describe("a folder can supply code", () => {
  it("imports an enabled pack's plugin and returns it in load order", async () => {
    const plugin = { api: MOD_API_VERSION, hooks: () => undefined };
    const other = { api: MOD_API_VERSION, register: () => undefined };
    const importer = vi.fn((url: string) =>
      Promise.resolve({ default: url.includes("second") ? other : plugin }),
    );
    const report = await loadModCode({
      packs: [codePack("first"), dataPack("plain"), codePack("second")],
      codeUrl: resolver(),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer,
    });
    expect(report.problems).toEqual([]);
    expect(report.plugins.map((p) => p.id)).toEqual(["first", "second"]);
    expect(report.plugins[0]?.plugin).toBe(plugin);
    /* The content-only pack was never a candidate: no probe, no 404, no problem
     * line. The directory listing already said it ships no code. */
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("releases each URL once the import has settled", async () => {
    /* A blob: URL pins its bytes for the document's lifetime until revoked, and a
     * mods folder can hold many. Safe after the import: the module graph is built
     * and never re-fetches. */
    const released: string[] = [];
    await loadModCode({
      packs: [codePack("one")],
      codeUrl: resolver(released),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer: () => Promise.resolve({ default: { api: MOD_API_VERSION, hooks: () => undefined } }),
    });
    expect(released).toEqual([`mem://one/${PLUGIN_FILE}`]);
  });

  it("releases the URL even when the import throws", async () => {
    const released: string[] = [];
    await loadModCode({
      packs: [codePack("bad")],
      codeUrl: resolver(released),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer: () => Promise.reject(new Error("boom")),
    });
    expect(released).toHaveLength(1);
  });

  it("says so when packs ship code and the source cannot serve any", async () => {
    /* This is the state the entire mod system used to be in, and from the outside
     * it looked exactly like a mod that did nothing. Silence here is the bug. */
    const report = await loadModCode({
      packs: [codePack("wants-code")],
      codeUrl: null,
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
    });
    expect(report.plugins).toEqual([]);
    expect(problemLines(report.problems)[0]).toContain("cannot serve code");
  });

  it("is silent for a data-only folder with no code source", async () => {
    const report = await loadModCode({
      packs: [dataPack("plain")],
      codeUrl: null,
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
    });
    expect(report.problems).toEqual([]);
    expect(report.skipped).toEqual([]);
  });
});

describe("every gate is applied BEFORE the import", () => {
  /**
   * Run one case and report whether the module was imported at all.
   *
   * `pluginApi` is separate from `opts` because the plugin's own `api` field is
   * re-checked AFTER the import, so a case driving a window this build does not
   * have has to move the fake module's number too - and overriding `importer`
   * from a caller would silently kill the counter that makes `imported` mean
   * anything, which is the one thing this suite exists to measure.
   */
  async function attempt(
    pack: DiskPack,
    opts: Partial<Parameters<typeof loadModCode>[0]> = {},
    pluginApi: number = MOD_API_VERSION,
  ) {
    const importer = vi.fn(() =>
      Promise.resolve({ default: { api: pluginApi, hooks: () => undefined } }),
    );
    const report = await loadModCode({
      packs: [pack],
      codeUrl: resolver(),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer,
      ...opts,
    });
    return { report, imported: importer.mock.calls.length };
  }

  it("a disabled mod's code does not exist", async () => {
    /* The same standing rule as a disabled mod's PATCHES: not "loaded and inert",
     * not loaded. */
    const { report, imported } = await attempt(codePack("off"), { enabled: () => false });
    expect(imported).toBe(0);
    expect(report.plugins).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.skipped).toEqual([{ id: "off", why: "not enabled" }]);
  });

  it("refuses code from a pack whose manifest is not shape:plugin", async () => {
    const { report, imported } = await attempt(codePack("sneaky", { shape: "content" }));
    expect(imported).toBe(0);
    expect(problemLines(report.problems)[0]).toContain('shape is "content"');
    /* The refusal now names the FACET and the fix, since a mod may legitimately
     * be content-shaped and still run code - it just has to say so. */
    expect(problemLines(report.problems)[0]).toContain('does not declare the "plugin" facet');
    expect(problemLines(report.problems)[0]).toContain('"facets": ["content", "plugin"]');
  });

  it("refuses a pack that ships code and declares no modApi", async () => {
    /* Deleted rather than set to undefined: exactOptionalPropertyTypes makes those
     * two different things in the type system, and the ABSENT case is the one a
     * hand-written manifest actually produces. */
    const pack = codePack("undeclared");
    delete (pack.manifest as { modApi?: number }).modApi;
    const { report, imported } = await attempt(pack);
    expect(imported).toBe(0);
    expect(problemLines(report.problems)[0]).toContain("modApi");
  });

  it("names both versions, and which side is behind", async () => {
    /* "Incompatible" alone sends the player to the wrong place: a too-new mod needs
     * a game update and a too-old one needs a mod update, and only the pair of
     * numbers says which. */
    const newer = await attempt(codePack("future", { modApi: MOD_API_VERSION + 1 }));
    expect(newer.imported).toBe(0);
    expect(problemLines(newer.report.problems)[0]).toContain(`${MOD_API_VERSION + 1}`);
    expect(problemLines(newer.report.problems)[0]).toContain(`${MOD_API_VERSION}`);
    expect(problemLines(newer.report.problems)[0]).toContain("newer game");

    /* Below the window's FLOOR, not merely below the current version - the second
     * of those loads now (see the window suite below). */
    const older = await attempt(codePack("past", { modApi: MOD_API_VERSION }), {
      hostApi: MOD_API_VERSION + 2,
      minApi: MOD_API_VERSION + 1,
    });
    expect(older.imported).toBe(0);
    expect(problemLines(older.report.problems)[0]).toContain("needs updating");
  });

  /**
   * THE WINDOW. Until 2026-08-02 the ABI check was `declared !== MOD_API_VERSION`,
   * so the day the host bumped to 2, every mod in existence stopped loading at
   * once - before any author could react, for a change most were not affected by.
   *
   * MOD_API_MIN and MOD_API_VERSION are both 1 today, which makes the window a
   * single point and every one of these branches unreachable from the constants.
   * That is exactly why `hostApi` and `minApi` are parameters: a window that could
   * only be tested at its current width would first run in anger on the day of a
   * bump, which is the worst possible day to find out it was wrong.
   */
  describe("the ABI window: a bump costs a release, not every mod at once", () => {
    /* A host mid-deprecation: it implements 3 and still honours 2. */
    const MID = { hostApi: 3, minApi: 2 };

    it("loads a plugin one ABI behind, and says so on its row", async () => {
      const { report, imported } = await attempt(codePack("olde", { modApi: 2 }), MID, 2);
      expect(imported).toBe(1);
      expect(report.plugins.map((p) => p.id)).toEqual(["olde"]);
      const line = problemLines(report.problems)[0] ?? "";
      expect(line).toContain("compatibility path");
      expect(line).toContain("rebuilt against 3");
    });

    /* The whole mechanism behind the promise. A host that accepted an older ABI
     * without recording WHICH plugins were on it could not honour it - there
     * would be nothing to branch on - so the window would be a promise with no
     * way to keep it. */
    it("records what each plugin declared, not what the host implements", async () => {
      const { report } = await attempt(codePack("olde", { modApi: 2 }), MID, 2);
      expect(report.plugins[0]?.api).toBe(2);
    });

    it("refuses below the floor, and names the floor rather than the current version", async () => {
      const { report, imported } = await attempt(codePack("ancient", { modApi: 1 }), MID);
      expect(imported).toBe(0);
      expect(problemLines(report.problems)[0]).toContain("no longer supports anything below 2");
    });

    it("still refuses anything above the host, window or no window", async () => {
      const { imported } = await attempt(codePack("future", { modApi: 4 }), MID);
      expect(imported).toBe(0);
    });

    /* The constants themselves have to stay coherent, and this is the assertion
     * that fails on a careless bump: raising VERSION without deciding what
     * happens to MIN is the decision two constants exist to force. */
    it("keeps the shipped window non-empty and pointing the right way", () => {
      expect(MOD_API_MIN).toBeLessThanOrEqual(MOD_API_VERSION);
      expect(modApiVerdict(MOD_API_VERSION)).toEqual({ ok: true, deprecated: false });
      expect(modApiVerdict(MOD_API_MIN).ok).toBe(true);
    });

    /* validateModPlugin re-checks the plugin's OWN api field after the import,
     * against the same window from the same function - two copies of "which ABIs
     * does this host take" is the pair that drifts apart at the first bump. */
    it("judges the plugin's own api field by the same window as the manifest", () => {
      const plugin = { api: 2, hooks: () => undefined };
      expect(validateModPlugin(plugin, 3, 2)).toBeNull();
      expect(validateModPlugin(plugin, 3, 3)).toContain("needs updating");
      expect(validateModPlugin(plugin, 1, 1)).toContain("newer game");
    });
  });

  it("does not import a plugin whose capabilities are not consented", async () => {
    /* The consent prompt IS the security boundary for in-process code, so it has
     * to gate the IMPORT, not the first registry call. */
    const { report, imported } = await attempt(
      codePack("greedy", { capabilities: ["registry:effect", "registry:monster"] }),
      { consented: () => ["registry:effect"] },
    );
    expect(imported).toBe(0);
    expect(report.skipped[0]?.why).toContain("registry:monster");
    expect(report.skipped[0]?.why).not.toContain("registry:effect");
  });

  it("imports once every capability is consented", async () => {
    const { report, imported } = await attempt(
      codePack("polite", { capabilities: ["registry:effect"] }),
      { consented: () => ["registry:effect"] },
    );
    expect(imported).toBe(1);
    expect(report.plugins).toHaveLength(1);
  });
});

describe("a broken plugin is one line, not a boot failure", () => {
  async function loadDefault(def: unknown) {
    return await loadModCode({
      packs: [codePack("m")],
      codeUrl: resolver(),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer: () => Promise.resolve({ default: def }),
    });
  }

  it("rejects a module with no default export", async () => {
    const report = await loadModCode({
      packs: [codePack("m")],
      codeUrl: resolver(),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer: () => Promise.resolve({}),
    });
    expect(report.plugins).toEqual([]);
    expect(problemLines(report.problems)[0]).toContain("no default export");
  });

  it("rejects a default export that declares no member that does anything", async () => {
    const report = await loadDefault({ api: MOD_API_VERSION });
    expect(problemLines(report.problems)[0]).toContain(
      "no hooks, register, controller, frontend, hud, menu, screen or regions",
    );
  });

  it("accepts a plugin whose ONLY member is a hud", async () => {
    /* Same shape as the controller case below, and for the same reason: a mod
     * that redraws the vitals registers nothing and hooks nothing. Refusing it
     * as "would do nothing" is exactly the mistake the controller seam already
     * made once. */
    const report = await loadDefault({ api: MOD_API_VERSION, hud: () => undefined });
    expect(report.problems).toEqual([]);
    expect(report.plugins).toHaveLength(1);
  });

  it("rejects a hud that is not a function", async () => {
    const report = await loadDefault({ api: MOD_API_VERSION, hud: {} });
    expect(problemLines(report.problems)[0]).toContain("hud is not a function");
  });

  it("accepts a plugin whose ONLY member is a controller", async () => {
    /* An autoplayer registers nothing and hooks nothing - the Borg's entire
     * contribution is playing the game. Before the controller seam existed this
     * plugin was refused as "would do nothing", which is the shape of mod the
     * seam was added for. */
    const report = await loadDefault({ api: MOD_API_VERSION, controller: () => undefined });
    expect(report.problems).toEqual([]);
    expect(report.plugins).toHaveLength(1);
  });

  it("rejects a controller that is not a function", async () => {
    const report = await loadDefault({ api: MOD_API_VERSION, controller: "borg" });
    expect(problemLines(report.problems)[0]).toContain("controller is not a function");
  });

  it("rejects a plugin whose own api field disagrees with its manifest", async () => {
    /* Belt and braces: the manifest gate already ran, so this only fires when the
     * two disagree - a plugin rebuilt without its manifest, which is exactly the
     * mistake a mod author makes while iterating. */
    const report = await loadDefault({ api: MOD_API_VERSION + 5, hooks: () => undefined });
    expect(problemLines(report.problems)[0]).toContain("mod API");
  });

  it("explains a BARE specifier rather than repeating the browser's message", async () => {
    /* Relative imports are resolved before the import now (mod-modules.ts), so a
     * resolution failure here means the one import a folder plugin cannot have: a
     * package name. It is also the first mistake anyone who has written a bundled
     * mod makes, and the browser's message names the specifier without saying what
     * to do instead - which is the part that matters, since there is nothing to
     * import at all. */
    const report = await loadModCode({
      packs: [codePack("m")],
      codeUrl: resolver(),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer: () =>
        Promise.reject(
          new Error('Failed to resolve module specifier "@rpgm-tools/neo-angband-core"'),
        ),
    });
    expect(problemLines(report.problems)[0]).toContain("@rpgm-tools/neo-angband-core");
    expect(problemLines(report.problems)[0]).toContain("ctx.core");
    /* And it must not tell the author to bundle, which is what it used to say and
     * is now simply wrong: relative imports of the mod's own files work. */
    expect(problemLines(report.problems)[0]).toContain("./lib/dice.js");
    expect(problemLines(report.problems)[0]).not.toMatch(/single plugin\.js|bundle it into/u);
  });

  it("carries the pack's record files to the caller for the plugin's context", async () => {
    const pack = codePack("m");
    const report = await loadModCode({
      packs: [{ ...pack, files: { monster: [{ name: "Grip" }] } }],
      codeUrl: resolver(),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer: () =>
        Promise.resolve({ default: { api: MOD_API_VERSION, hooks: () => undefined } }),
    });
    expect(report.plugins[0]?.data).toEqual({ monster: [{ name: "Grip" }] });
  });

  it("one bad plugin does not cost a good one", async () => {
    const good = { api: MOD_API_VERSION, hooks: () => undefined };
    const report = await loadModCode({
      packs: [codePack("bad"), codePack("good")],
      codeUrl: resolver(),
      enabled: ALL_ENABLED,
      consented: NO_CAPS,
      importer: (url) =>
        url.includes("bad") ? Promise.reject(new Error("nope")) : Promise.resolve({ default: good }),
    });
    expect(report.plugins.map((p) => p.id)).toEqual(["good"]);
    expect(report.problems).toHaveLength(1);
  });
});

describe("validateModPlugin", () => {
  it("accepts a minimal plugin", () => {
    expect(validateModPlugin({ api: MOD_API_VERSION, hooks: () => undefined })).toBeNull();
    expect(validateModPlugin({ api: MOD_API_VERSION, register: () => undefined })).toBeNull();
  });

  it("rejects a non-integer or absent api", () => {
    expect(validateModPlugin({ hooks: () => undefined })).toContain("api");
    expect(validateModPlugin({ api: 1.5, hooks: () => undefined })).toContain("api");
  });

  it("rejects a non-function member", () => {
    expect(validateModPlugin({ api: MOD_API_VERSION, hooks: 3 })).toContain("hooks");
    expect(validateModPlugin({ api: MOD_API_VERSION, hooks: () => undefined, uninstall: 1 })).toContain(
      "uninstall",
    );
  });
});

describe("hasPlugin", () => {
  it("matches case-insensitively, like every other name check in the folder reader", () => {
    expect(hasPlugin(codePack("a"))).toBe(true);
    expect(hasPlugin({ ...codePack("a"), code: ["Plugin.JS"] })).toBe(true);
    expect(hasPlugin({ ...codePack("a"), code: ["plugin.ts", "helper.js"] })).toBe(false);
    expect(hasPlugin(dataPack("a"))).toBe(false);
  });
});
