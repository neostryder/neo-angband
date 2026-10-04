import { describe, expect, it } from "vitest";
import { parseDocument, serializeDocument } from "./json/index.js";
import { ManifestError, validateManifest } from "./manifest.js";
import type { PackManifest } from "./manifest.js";
import {
  CONVERTED_ENGINE_REASON,
  DEFAULT_TURN_BUDGET_MS,
  ManifestConversionError,
  MAX_TURN_BUDGET_MS,
  MOD_API_1_RANGE,
  WORKER_PREVIEW_API,
  convertManifestV1,
  legacyModApi,
  manifestToV2,
  manifestV2Validator,
  modManifestFormat,
  runtimePayloadComplaint,
  turnBudgetMs,
} from "./manifest-v2.js";
import type { ManifestV2Data } from "./manifest-v2.js";

const FORMAT = "neo-angband/mod/manifest";
const doc = (data: unknown, schemaVersion = 2): unknown => ({ format: FORMAT, schemaVersion, data });
const issues = (data: unknown): string[] => {
  const result = manifestV2Validator.validate(data, "$.data");
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const RULE = { flag: "demo.on", title: "On", description: "Turns it on.", default: false };

/* One schema 1 manifest per shape the first-party mods ship, cut down to the
 * fields that make each shape different. */
const SHAPES: Record<string, Record<string, unknown>> = {
  "plugin (AnybandUI, Borg, Squire)": {
    id: "panel-mod", name: "Panel Mod", version: "1.1.0", shape: "plugin", facets: ["plugin"], modApi: 1,
    engine: ">=1.21.1", dependencies: { core: "*" },
    capabilities: ["ui:sidebar.replace", "state:map.read", "event:heal", "network:local", "profiles:manage"],
    rules: [RULE],
    settings: [{ id: "demo.level", title: "Level", description: "How much.", min: 0, max: 100, step: 10, default: 50, parent: "demo.on" }],
    author: "an author", license: "GPL-2.0-only", description: "A panel.", repository: "https://example.test/panel-mod",
  },
  "plugin in a sorting group (ModForge)": {
    id: "workshop", name: "Workshop", version: "1.4.2", shape: "plugin", facets: ["plugin"], modApi: 1, group: "interface",
    engine: ">=1.0.0", dependencies: { core: "*" }, capabilities: ["ui:region.create", "mod:session", "debug:wizard"],
  },
  "content and plugin with a scoped claim (Bug Fixes)": {
    id: "fixes", name: "Fixes", version: "1.3.0", shape: "content", facets: ["content", "plugin"], modApi: 1,
    engine: ">=1.2.0", capabilities: ["registry:tval"], dependencies: { core: "*" },
    rules: [RULE], renamedRuleFlags: { "demo.old": "demo.on" },
    sections: [{ id: "fix-borg", title: "Borg fixes", description: "Fixes the Borg.", default: true }],
    compat: [{ with: "borg", claim: "patches", scope: ["fix-borg"], because: "This section corrects the Borg." }],
  },
  "content and plugin with restored art and a soft dependency (Cutting Room Floor)": {
    id: "restored", name: "Restored", version: "1.3.0", shape: "content", facets: ["content", "plugin"], modApi: 1,
    engine: ">=1.21.1", capabilities: ["registry:store", "keymap:write"], dependencies: { core: "*" },
    optionalDependencies: { linoleum: "*" },
    sections: [{ id: "old-books", title: "Old books", description: "Brings them back.", default: false, lockedAtBirth: true }],
    restoredItemArt: [{ kind: "core:magic-book:magic-for-beginners", packs: { old: { asset: "assets/book.png" } } }],
    restoredMonsterArt: [{ race: "restored:large-brown-snake", packs: { old: { asset: "assets/snake.png" } }, hue: 45 }],
    restoredFlavorArt: [{ flavor: 303, drawAs: 28, hue: 30 }],
  },
  "tiles and plugin with archives (Linoleum)": {
    id: "floor-tiles", name: "Floor Tiles", version: "1.5.0", shape: "tiles", facets: ["tiles", "plugin"], modApi: 1,
    affectsGameplay: false, capabilities: ["registry:tiles"], engine: ">=1.21.1", dependencies: { core: "*" },
    fields: [{ name: "no-kin-fill", files: ["object"], type: "boolean" }],
    payload: { archives: ["dist/floor-tiles.zip"] },
    tilePacks: [{ grafID: 101, engine: "linoleum", menuname: "Original Tiles", path: "sources/original-tiles" }],
  },
  "content, no code (tutorials, the content pack)": {
    id: "tutorial", name: "Tutorial", version: "1.0.0", shape: "content", engine: ">=0.19.0", dependencies: { core: "*" },
    changelog: "CHANGELOG.md", screenshots: ["shots/one.png"],
  },
  "worker (modApi 2)": {
    id: "isolated", name: "Isolated", version: "0.1.0", shape: "plugin", modApi: 2, runtime: "worker", workerEntry: "dist/main.js",
    capabilities: ["query:snapshot", "ui:panel"],
  },
};

describe("schema 1 to schema 2", () => {
  for (const [label, raw] of Object.entries(SHAPES)) {
    it(`converts ${label} and reads back the same manifest`, () => {
      const v1 = validateManifest(raw);
      const data = convertManifestV1(raw);
      expect(issues(data)).toEqual([]);
      const text = serializeDocument(modManifestFormat, data);
      const { listing, ...v2 } = validateManifest(JSON.parse(text));
      expect(v2).toEqual({ ...v1, manifestSchema: 2, ...(v1.engine === undefined ? {} : { engineBecause: CONVERTED_ENGINE_REASON }) });
      expect(listing).toEqual(data.listing);
      expect(serializeDocument(modManifestFormat, manifestToV2(v1))).toBe(text);
      expect(serializeDocument(modManifestFormat, manifestToV2(validateManifest(JSON.parse(text))))).toBe(text);
    });
  }

  it("maps each modApi explicitly", () => {
    const plugin = convertManifestV1(SHAPES["plugin (AnybandUI, Borg, Squire)"]);
    expect([plugin.api, plugin.runtime, plugin.entry]).toEqual([MOD_API_1_RANGE, "in-process", undefined]);
    const worker = convertManifestV1(SHAPES["worker (modApi 2)"]);
    expect([worker.api, worker.runtime, worker.entry]).toEqual([WORKER_PREVIEW_API, "worker", "dist/main.js"]);
    const data = convertManifestV1(SHAPES["content, no code (tutorials, the content pack)"]);
    expect([data.api, data.runtime, data.entry]).toEqual(["*", "data", undefined]);
    expect(data.listing).toEqual({ changelog: "CHANGELOG.md", screenshots: ["shots/one.png"] });
    expect(data.engine).toEqual({ range: ">=0.19.0", because: CONVERTED_ENGINE_REASON });
    expect("modApi" in plugin || "workerEntry" in worker || "optionalDependencies" in data).toBe(false);
  });

  it("refuses a modApi it has no mapping for", () => {
    const base = { id: "odd", name: "Odd", version: "1.0.0", shape: "plugin" };
    expect(() => convertManifestV1(base)).toThrow(ManifestConversionError);
    expect(() => convertManifestV1({ ...base, modApi: 3 })).toThrow(/modApi 3 has no schema 2 mapping/u);
    expect(() => convertManifestV1({ ...base, modApi: 2 })).toThrow(ManifestConversionError);
    expect(() => convertManifestV1({ ...base, modApi: 1, runtime: "worker", workerEntry: "a.js" })).toThrow(ManifestConversionError);
    expect(parseDocument(doc({ ...base, modApi: 3 }, 1), modManifestFormat).ok).toBe(false);
  });

  it("migrates a schema 1 document through the format", () => {
    const raw = SHAPES["plugin (AnybandUI, Borg, Squire)"]!;
    const result = parseDocument(doc(raw, 1), modManifestFormat);
    expect(result.ok && result.migrated).toBe(true);
    if (result.ok) expect(result.data).toEqual(convertManifestV1(raw));
  });

  it("still reads a schema 1 manifest whose plugin has no modApi, with no api", () => {
    const m = validateManifest({ id: "old", name: "Old", version: "1.0.0", shape: "plugin" });
    expect([m.api, m.runtime, m.entry, m.modApi]).toEqual([undefined, "in-process", "plugin.js", undefined]);
  });
});

describe("the api range and the loader's ABI", () => {
  it("fills modApi only for an API this build runs", () => {
    expect(legacyModApi("in-process", ">=1.0.0 <2.0.0")).toBe(1);
    expect(legacyModApi("in-process", ">=2.0.0")).toBeUndefined();
    expect(legacyModApi("worker", WORKER_PREVIEW_API)).toBe(2);
    expect(legacyModApi("worker", ">=2.0.0 <3.0.0")).toBeUndefined();
    expect(legacyModApi("data", "*")).toBeUndefined();
  });

  it("never reads a stable API 2 range as the preview Worker ABI", () => {
    const m = validateManifest(doc({ id: "next", name: "Next", version: "1.0.0", api: "^2.0.0", runtime: "worker", entry: "main.js" }));
    expect(m.modApi).toBeUndefined();
    expect(m.workerEntry).toBe("main.js");
  });
});

const V2: ManifestV2Data = {
  id: "full", name: "Full", version: "2.0.0", api: MOD_API_1_RANGE, runtime: "in-process",
  engine: { range: ">=1.21.1", because: "Needs the panel API added in 1.21.1." },
  dependencies: {
    required: { core: { range: "*" }, runes: { range: "^1.2.0", because: "Draws its runes." } },
    optional: { linoleum: { range: "*", because: "Uses its tiles when present." } },
    conflicts: { rival: { because: "Both rewrite the shops." }, older: { range: "<1.0.0", because: "Old saves break." } },
  },
  capabilities: ["command:add"],
  text: { default: "en", locales: { en: "text/en.json", "pt-BR": "text/pt-BR.json" } },
  listing: { tags: ["interface", "quality-of-life"], screenshots: ["shots/a.png"], changelog: "CHANGELOG.md" },
  budget: { msPerTurn: 120 },
  facets: ["content", "plugin"],
  shape: "content",
  compat: [{ with: "runes", claim: "prefer-mine", because: "Its book list wins." }],
};

describe("dependencies", () => {
  it("parses required, optional and conflicts, each with its reason", () => {
    const m = validateManifest(doc(V2));
    expect(m.dependencies).toEqual({ core: "*", runes: "^1.2.0" });
    expect(m.optionalDependencies).toEqual({ linoleum: "*" });
    expect(m.dependencyReasons).toEqual({ runes: "Draws its runes.", linoleum: "Uses its tiles when present." });
    expect(m.compat).toEqual([
      { with: "runes", claim: "prefer-mine", because: "Its book list wins." },
      { with: "older", range: "<1.0.0", claim: "conflicts", because: "Old saves break." },
      { with: "rival", claim: "conflicts", because: "Both rewrite the shops." },
    ]);
    expect(serializeDocument(modManifestFormat, manifestToV2(m))).toBe(serializeDocument(modManifestFormat, V2));
  });

  it("moves a whole-mod conflict out of compat and leaves the rest", () => {
    const data = convertManifestV1({
      id: "a", name: "A", version: "1.0.0", shape: "content",
      compat: [
        { with: "b", claim: "conflicts", because: "Same shops." },
        { with: "c", claim: "conflicts", scope: [], because: "One part." },
        { with: "d", claim: "prefer-theirs", because: "Theirs is better." },
      ],
    });
    expect(data.dependencies?.conflicts).toEqual({ b: { because: "Same shops." } });
    expect(data.compat?.map((c) => c.with)).toEqual(["c", "d"]);
  });

  it("refuses a mod listed twice, a self-reference, a conflict with no reason and a bad range", () => {
    const { compat: _compat, ...rest } = V2;
    const deps = (dependencies: unknown): string[] => issues({ ...rest, dependencies });
    expect(deps({ required: { x: { range: "*" } }, optional: { x: { range: "*" } } }).join()).toMatch(/already listed under required/u);
    expect(deps({ required: { full: { range: "*" } } }).join()).toMatch(/cannot list itself/u);
    expect(deps({ conflicts: { x: { range: "*" } } }).join()).toMatch(/because.*missing required field/u);
    expect(deps({ required: { x: { range: "not a range" } } }).join()).toMatch(/semver range/u);
    expect(deps({ required: { X: { range: "*" } } }).join()).toMatch(/kebab-case mod id/u);
  });
});

describe("the runtime follows the payload", () => {
  const data = { id: "d", name: "D", version: "1.0.0", api: "*", runtime: "data" };
  it("is checked inside the manifest", () => {
    expect(issues({ ...data, entry: "plugin.js" }).join()).toMatch(/runs no code/u);
    expect(issues({ ...data, facets: ["content", "plugin"], shape: "content" }).join()).toMatch(/plugin facet/u);
    expect(issues({ ...data, payload: { files: ["object.json", "lib/x.mjs"] } }).join()).toMatch(/ships lib\/x\.mjs/u);
    expect(issues({ ...data, runtime: "worker" }).join()).toMatch(/names the module/u);
    expect(issues({ ...data, runtime: "in-process", entry: "main.js" }).join()).toMatch(/entry is plugin\.js/u);
    expect(issues({ ...data, runtime: "in-process", facets: ["content"], shape: "content" }).join()).toMatch(/must include "plugin"/u);
    expect(issues({ ...data, runtime: "in-process" })).toEqual([]);
  });

  it("is checked against the folder", () => {
    const manifest = (runtime: NonNullable<PackManifest["runtime"]>, entry?: string): Pick<PackManifest, "id" | "runtime" | "entry"> =>
      ({ id: "m", runtime, ...(entry === undefined ? {} : { entry }) });
    expect(runtimePayloadComplaint(manifest("data"), [])).toBeNull();
    expect(runtimePayloadComplaint(manifest("data"), ["plugin.js"])).toMatch(/declares runtime "data" but ships plugin\.js/u);
    expect(runtimePayloadComplaint(manifest("in-process"), ["Plugin.js"])).toBeNull();
    expect(runtimePayloadComplaint(manifest("in-process"), ["lib/a.js"])).toMatch(/starts plugin\.js, which is not in the mod/u);
    expect(runtimePayloadComplaint(manifest("worker", "dist/main.js"), ["dist/main.js"])).toBeNull();
    expect(() => validateManifest(doc(data), { code: ["plugin.js"] })).toThrow(ManifestError);
    expect(validateManifest(doc(data), { code: [] }).runtime).toBe("data");
    /* Schema 1 keeps its own loader check. */
    expect(validateManifest({ id: "d", name: "D", version: "1.0.0", shape: "content" }, { code: ["plugin.js"] }).runtime).toBe("data");
  });

  it("gives code runtimes the plugin facet and data runtimes none", () => {
    expect(validateManifest(doc({ ...data, runtime: "in-process" }))).toMatchObject({ shape: "plugin", entry: "plugin.js", modApi: 1 });
    expect(validateManifest(doc({ ...data, api: ">=2.0.0", runtime: "in-process" })).modApi).toBeUndefined();
    expect(validateManifest(doc({ ...data, api: MOD_API_1_RANGE, runtime: "in-process", shape: "content" }))).toMatchObject({ shape: "content", facets: ["content", "plugin"], modApi: 1 });
    const plain = validateManifest(doc(data));
    expect([plain.shape, plain.facets, plain.entry, plain.modApi]).toEqual(["content", undefined, undefined, undefined]);
  });
});

describe("the manifest envelope", () => {
  it("validates through the shared document validator", () => {
    expect(parseDocument(doc(V2), modManifestFormat).ok).toBe(true);
    expect(() => validateManifest(doc({ ...V2, modApi: 1 }))).toThrow(/\$\.data\["modApi"\]: unknown field/u);
    expect(() => validateManifest(doc({ ...V2, optionalDependencies: {} }))).toThrow(/unknown field/u);
    expect(() => validateManifest({ ...(doc(V2) as object), extra: true })).toThrow(/unknown envelope field/u);
    expect(() => validateManifest(doc(V2, 3))).toThrow(/future schema version/u);
    expect(() => validateManifest(doc({ ...V2, runtime: "native" }))).toThrow(/expected one of/u);
  });

  it("checks text, listing and the turn budget", () => {
    expect(issues({ ...V2, text: { default: "english", locales: {} } }).join()).toMatch(/locale tag/u);
    expect(issues({ ...V2, text: { default: "en", locales: { en: "../en.json" } } }).join()).toMatch(/relative path/u);
    expect(issues({ ...V2, listing: { tags: ["Not Kebab"] } }).join()).toMatch(/kebab-case/u);
    expect(issues({ ...V2, budget: { msPerTurn: 0 } }).join()).toMatch(/above 0/u);
    expect(issues({ ...V2, budget: { msPerTurn: MAX_TURN_BUDGET_MS + 1 } }).join()).toMatch(/at most 500/u);
    expect(issues({ ...V2, budget: { msPerTurn: MAX_TURN_BUDGET_MS } })).toEqual([]);
    expect(issues({ ...V2, engine: { range: ">=1.0.0" } }).join()).toMatch(/because.*missing required field/u);
    expect(turnBudgetMs({})).toBe(DEFAULT_TURN_BUDGET_MS);
    expect(turnBudgetMs(validateManifest(doc(V2)))).toBe(120);
  });

  it("runs the shared field checks on schema 2 too", () => {
    expect(() => validateManifest(doc({ ...V2, publicFlags: ["undeclared"] }))).toThrow(/publicFlags/u);
    expect(() => validateManifest(doc({ ...V2, version: "two" }))).toThrow(/version must be semver/u);
  });
});
