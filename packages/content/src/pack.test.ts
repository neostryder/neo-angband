/**
 * Validates the committed pack/*.json against the upstream gamedata
 * sources. Expected record counts are derived at test time by counting
 * record-start directives in reference/lib/gamedata/*.txt, so the pack can
 * never silently drift from the source of truth.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { CompiledFile, JsonObject } from "./records.js";
import { gamedataSpecs } from "./specs/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(here, "..");
const repoRoot = path.resolve(contentRoot, "..", "..");
const gamedataDir = path.join(repoRoot, "reference", "lib", "gamedata");
const packDir = path.join(contentRoot, "pack");

function readPack(name: string): CompiledFile {
  const raw = readFileSync(path.join(packDir, `${name}.json`), "utf8");
  return JSON.parse(raw) as CompiledFile;
}

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
    const manifest = JSON.parse(
      readFileSync(path.join(packDir, "manifest.json"), "utf8"),
    ) as { id: string; name: string; version: string; engine: string; files: string[] };
    expect(manifest.id).toBe("core");
    expect(manifest.name).toBe("Angband");
    expect(manifest.version).toBe("4.2.6");
    expect(manifest.engine).toBe(">=0.1.0");
    expect(manifest.files).toEqual(gamedataSpecs.map((s) => `${s.name}.json`));
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
