/**
 * Validates the committed pack/*.json against the upstream gamedata
 * sources. Expected record counts are derived at test time by counting
 * record-start directives in reference/lib/gamedata/*.txt, so the pack can
 * never silently drift from the source of truth.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadPackFile, loadPackManifest, loadPackRecords, packDir, packFileNames } from "./pack.js";
import type { CompiledFile, JsonObject } from "./records.js";
import { gamedataSpecs } from "./specs/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(here, "..");
const repoRoot = path.resolve(contentRoot, "..", "..");
const gamedataDir = path.join(repoRoot, "reference", "lib", "gamedata");

/* Read the pack through the module a CONSUMER gets, not through a private copy
 * of the same two lines. This file used to resolve packDir and JSON.parse the
 * files itself, which meant the shipped loader could break without a single
 * assertion here moving - and the loader is the only way anyone outside this
 * repository reaches the data. */
const readPack = (name: string): CompiledFile => loadPackFile<CompiledFile>(name);

/** Count record-start directives in the upstream .txt, comments excluded. */
function countRecordStarts(name: string, start: string): number {
  const text = readFileSync(path.join(gamedataDir, `${name}.txt`), "utf8");
  let count = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s\u{FEFF}]+/u, "");
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    const directive = colon === -1 ? line.replace(/\r$/, "") : line.slice(0, colon);
    if (directive === start) {
      count++;
    }
  }
  return count;
}

describe("compiled pack record counts match the upstream sources", () => {
  for (const spec of gamedataSpecs) {
    it(`${spec.name}.json`, () => {
      const pack = readPack(spec.name);
      expect(pack.file).toBe(spec.name);
      expect(pack.source).toBe(`lib/gamedata/${spec.name}.txt`);
      if (spec.recordStart === null) {
        expect(pack.records).toHaveLength(1);
      } else {
        expect(pack.records).toHaveLength(countRecordStarts(spec.name, spec.recordStart));
        expect(pack.records.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("manifest", () => {
  it("lists every compiled file for the core pack", () => {
    const manifest = loadPackManifest();
    expect(manifest.id).toBe("core");
    expect(manifest.name).toBe("Angband");
    expect(manifest.version).toBe("4.2.6");
    expect(manifest.engine).toBe(">=0.1.0");
    expect(manifest.files).toEqual(gamedataSpecs.map((s) => `${s.name}.json`));
  });
});

/**
 * The pack loader is the package's REASON to be published, so it is tested as a
 * consumer uses it.
 *
 * 0.11.0 shipped these 45 files and declared no exports subpath for any of them,
 * which made every one of them unreachable from outside - `exports` refuses an
 * undeclared subpath rather than merely not documenting it. Nothing here could
 * have caught that, because everything here reads the repository. What catches it
 * is tools/check-npm-package.mjs, which now resolves by bare specifier through a
 * real node_modules. What these test is the other half: that the module those
 * subpaths point at does the job the mod repositories need.
 */
describe("the pack loader a consumer imports", () => {
  it("resolves packDir to the directory the files are actually in", () => {
    expect(existsSync(path.join(packDir, "manifest.json"))).toBe(true);
  });

  it("returns the records array, not the wrapper", () => {
    const records = loadPackRecords<JsonObject>("monster");
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    expect(records.find((r) => r["name"] === "Morgoth, Lord of Darkness")).toBeDefined();
  });

  it("names the pack files in LOAD order, which is not alphabetical", () => {
    const names = packFileNames();
    expect(names).toEqual(gamedataSpecs.map((s) => s.name));
    /* object records reference the bases they are built from, so the bases have
     * to be read first; sorting this list would break the engine's load. */
    expect(names.indexOf("object_base")).toBeLessThan(names.indexOf("object"));
    expect(names).not.toEqual([...names].sort());
  });

  it("names the directory and what IS there when a file is missing", () => {
    /* The bare ENOENT names one path and reads as a broken install. The usual
     * cause is a name that changed between releases, and that is invisible in it. */
    expect(() => loadPackFile("monsters")).toThrow(/no pack file "monsters\.json"/u);
    expect(() => loadPackFile("monsters")).toThrow(/available: .*\bmonster\b/u);
  });
});

describe("spot checks against known upstream content", () => {
  it("monster.txt contains Morgoth, Lord of Darkness", () => {
    const pack = readPack("monster");
    const morgoth = pack.records.find((r) => r["name"] === "Morgoth, Lord of Darkness");
    expect(morgoth).toBeDefined();
    expect(morgoth?.["base"]).toBe("Morgoth");
    expect(morgoth?.["speed"]).toBe(140);
    const blows = morgoth?.["blow"];
    expect(Array.isArray(blows)).toBe(true);
    expect((blows as JsonObject[])[0]).toEqual({
      method: "HIT",
      effect: "SHATTER",
      damage: "20d10",
    });
  });

  it("terrain.txt contains a FLOOR record", () => {
    const pack = readPack("terrain");
    const floor = pack.records.find((r) => r["code"] === "FLOOR");
    expect(floor).toBeDefined();
    expect(floor?.["name"]).toBe("open floor");
    expect(floor?.["graphics"]).toEqual({ glyph: ".", color: "w" });
  });

  it("terrain.txt keeps space glyphs from char fields", () => {
    const pack = readPack("terrain");
    const none = pack.records.find((r) => r["code"] === "NONE");
    expect(none?.["graphics"]).toEqual({ glyph: " ", color: "w" });
  });

  it("object.txt has a record whose name contains Broad Sword", () => {
    const pack = readPack("object");
    const sword = pack.records.find((r) => String(r["name"]).includes("Broad Sword"));
    expect(sword).toBeDefined();
    expect(sword?.["type"]).toBe("sword");
  });

  it("constants.txt compiles to labelled value groups", () => {
    const pack = readPack("constants");
    const record = pack.records[0];
    expect(record).toBeDefined();
    const levelMax = record?.["level-max"];
    expect(levelMax).toEqual([{ label: "monsters", value: 1024 }]);
  });

  it("object_base.txt defaults land in the pack header", () => {
    const pack = readPack("object_base");
    expect(pack.header).toEqual({
      default: [
        { label: "break-chance", value: 10 },
        { label: "max-stack", value: 40 },
      ],
    });
  });

  it("class.txt nests spells in books and effects in spells", () => {
    const pack = readPack("class");
    const mage = pack.records.find((r) => r["name"] === "Mage");
    expect(mage).toBeDefined();
    const books = mage?.["book"] as JsonObject[];
    expect(books.length).toBeGreaterThan(0);
    const spells = books[0]?.["spell"] as JsonObject[];
    const missile = spells.find((s) => s["name"] === "Magic Missile");
    expect(missile).toBeDefined();
    const effects = missile?.["effect"] as JsonObject[];
    expect(effects[0]?.["eff"]).toBe("BOLT_OR_BEAM");
    expect(effects[0]?.["dice"]).toBe("$Dd4");
  });

  it("monster_spell.txt keeps pre-cutoff lore on the record and later lore on cutoffs", () => {
    const pack = readPack("monster_spell");
    const shot = pack.records.find((r) => r["name"] === "SHOT");
    expect(shot).toBeDefined();
    expect(Array.isArray(shot?.["lore"])).toBe(true);
    const cutoffs = shot?.["power-cutoff"] as JsonObject[];
    expect(cutoffs.length).toBeGreaterThan(0);
    expect(typeof cutoffs[0]?.["power"]).toBe("number");
    expect(Array.isArray(cutoffs[0]?.["lore"])).toBe(true);
  });

  it("vault.txt map rows survive verbatim, padding included", () => {
    const pack = readPack("vault");
    const round = pack.records.find((r) => r["name"] === "Round");
    const rows = round?.["D"] as string[];
    expect(rows).toHaveLength(round?.["rows"] as number);
    expect(rows[0]).toBe("       %%%%%%       ");
  });

  it("store.txt keeps the STORE_GENERAL record with its owners", () => {
    const pack = readPack("store");
    const general = pack.records.find((r) => r["store"] === "STORE_GENERAL");
    expect(general).toBeDefined();
    expect((general?.["owner"] as JsonObject[]).length).toBeGreaterThanOrEqual(1);
  });
});
