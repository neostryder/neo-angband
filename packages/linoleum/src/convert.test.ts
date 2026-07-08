/**
 * End-to-end converter tests on the two smallest bundled packs:
 * original-tiles (old, 8x8) and nomad (8x16, non-square).
 *
 * All hardcoded counts and target lines below were cross-checked against a
 * ground-truth run of the original scripts/build-linoleum-packs.ps1 over the
 * same reference data: every text output matched byte-for-byte (modulo the
 * generated-by header) and every extracted PNG matched pixel-for-pixel.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPacks } from "./convert.js";
import type { ConvertSummary } from "./convert.js";

const tilesRoot = fileURLToPath(new URL("../../../reference/lib/tiles", import.meta.url));
const outputRoot = fileURLToPath(new URL("../.test-out", import.meta.url));

let summary: ConvertSummary;

beforeAll(() => {
  rmSync(outputRoot, { recursive: true, force: true });
  summary = convertPacks({
    tilesRoot,
    outputRoot,
    packKeys: ["original-tiles", "nomad"],
  });
}, 60_000);

function readLines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n");
}

describe("original-tiles (old, 8x8) pack", () => {
  const packRoot = (): string => join(outputRoot, "original-tiles");

  it("writes the exact manifest lines", () => {
    expect(readFileSync(join(packRoot(), "manifest.txt"), "utf8")).toBe(
      [
        "pack:linoleum-original-tiles:Original Tiles (Linoleum)",
        "format:png",
        "resolution:8",
        "map:targets:maps/targets.txt",
        "map:families:maps/families.txt",
        "",
      ].join("\n"),
    );
  });

  it("emits the expected exact target lines (hand-computed from graf-xxx.prf)", () => {
    const lines = readLines(join(packRoot(), "maps", "targets.txt"));
    // graf-xxx.prf: feat:FLOOR:lit:0x80:0xA1
    expect(lines).toContain("target:feat:FLOOR:lit:asset:feat_floor_lit_0");
    // graf-xxx.prf: monster:Farmer Maggot:0x9B:0x8B
    expect(lines).toContain("target:monster:Farmer Maggot:asset:monster_farmer_maggot_0");
    // graf-xxx.prf: GF:ELEC:0:0x84:0x90 (logical value contains a colon)
    expect(lines).toContain("target:GF:ELEC:0:asset:gf_elec_0_0");
    // xtra-xxx.prf: ?:[AND [EQU $CLASS Warrior] [EQU $RACE Human] ] then
    // monster:<player>:0x8C:0x80
    expect(lines).toContain(
      "target:monster:<player>:when:[AND [EQU $CLASS Warrior] [EQU $RACE Human] ]:asset:monster_player_when_and_equ_class_warrior_equ_race_human_0",
    );
  });

  it("emits compatibility aliases preferring the lit variant", () => {
    const lines = readLines(join(packRoot(), "maps", "targets.txt"));
    // FLOOR has dark/lit/los/torch variants; lit ranks highest for aliases.
    expect(lines).toContain("target:feat:FLOOR:asset:feat_floor_lit_0");
    // LESS is a family-mapped stairway selector.
    expect(lines).toContain("target:feat:LESS:family:feat_less_lit_0_fx");
  });

  it("puts compatibility aliases before the exact-selectors comment", () => {
    const lines = readLines(join(packRoot(), "maps", "targets.txt"));
    const aliasIndex = lines.indexOf("target:feat:FLOOR:asset:feat_floor_lit_0");
    const exactHeaderIndex = lines.indexOf(
      "# Exact legacy selectors, including stateful and conditional variants.",
    );
    const exactIndex = lines.indexOf("target:feat:FLOOR:lit:asset:feat_floor_lit_0");
    expect(aliasIndex).toBeGreaterThan(-1);
    expect(exactHeaderIndex).toBeGreaterThan(aliasIndex);
    expect(exactIndex).toBeGreaterThan(exactHeaderIndex);
  });

  it("skips non-hex legacy coordinate lines like object:none:<pile>:131:159", () => {
    const text = readFileSync(join(packRoot(), "maps", "targets.txt"), "utf8");
    expect(text).not.toContain("<pile>");
  });

  it("writes family effect metadata for LESS/MORE stairs", () => {
    const lines = readLines(join(packRoot(), "maps", "families.txt"));
    expect(lines).toContain("family:feat_less_lit_0_fx:selection:stable");
    expect(lines).toContain("family:feat_less_lit_0_fx:asset:feat_less_lit_0");
    expect(lines).toContain("family:feat_less_lit_0_fx:glow-alpha:72");
    expect(lines).toContain("family:feat_less_lit_0_fx:tint:180,220,255,48");
    expect(lines).toContain("family:feat_less_lit_0_fx:pulse:168,255,1400");
    expect(lines).toContain("family:feat_more_lit_0_fx:glow-alpha:64");
    expect(lines).toContain("family:feat_more_lit_0_fx:tint:255,210,150,40");
    expect(lines).toContain("family:feat_more_lit_0_fx:pulse:176,255,1200");
  });

  it("extracts 8x8 PNG assets matching the source sheet pixels", () => {
    const assetPath = join(packRoot(), "images", "8", "feat_floor_lit_0.png");
    const tile = PNG.sync.read(readFileSync(assetPath));
    expect(tile.width).toBe(8);
    expect(tile.height).toBe(8);

    // feat:FLOOR:lit:0x80:0xA1 -> row 0, col 33 -> sheet rect (264, 0, 8, 8).
    const sheet = PNG.sync.read(readFileSync(join(tilesRoot, "old", "8x8.png")));
    const expected = new PNG({ width: 8, height: 8 });
    PNG.bitblt(sheet, expected, 264, 0, 8, 8, 0, 0);
    expect(Buffer.compare(tile.data, expected.data)).toBe(0);
  });

  it("produces the expected asset volume", () => {
    const result = summary.results.find((r) => r.key === "original-tiles");
    expect(result).toBeDefined();
    expect(result?.assetCount).toBe(1495);
    expect(result?.assetCount ?? 0).toBeGreaterThan(1000);
    const files = readdirSync(join(packRoot(), "images", "8"));
    expect(files.length).toBe(result?.assetCount);
  });

  it("mirrors the pref files byte-for-byte", () => {
    for (const pref of ["graf-xxx.prf", "xtra-xxx.prf", "flvr-xxx.prf"]) {
      const source = readFileSync(join(tilesRoot, "old", pref));
      const mirror = readFileSync(join(packRoot(), pref));
      expect(Buffer.compare(source, mirror)).toBe(0);
    }
  });
});

describe("nomad (8x16, non-square) pack", () => {
  const packRoot = (): string => join(outputRoot, "nomad");

  it("writes the exact manifest lines with the nominal 16 resolution", () => {
    expect(readFileSync(join(packRoot(), "manifest.txt"), "utf8")).toBe(
      [
        "pack:linoleum-nomad:Nomad's tiles (Linoleum)",
        "format:png",
        "resolution:16",
        "map:targets:maps/targets.txt",
        "map:families:maps/families.txt",
        "",
      ].join("\n"),
    );
  });

  it("preserves the literal * variant in exact selectors", () => {
    const lines = readLines(join(packRoot(), "maps", "targets.txt"));
    // graf-nmd.prf: feat:LESS:*:0x80:0x94
    expect(lines).toContain("target:feat:LESS:*:family:feat_less_0_fx");
    expect(lines).toContain("target:feat:LESS:family:feat_less_0_fx");
    // graf-nmd.prf: feat:FLOOR:lit:0x80:0x82
    expect(lines).toContain("target:feat:FLOOR:lit:asset:feat_floor_lit_0");
    expect(lines).toContain("target:feat:FLOOR:asset:feat_floor_lit_0");
  });

  it("extracts 8x16 PNG assets", () => {
    const tile = PNG.sync.read(
      readFileSync(join(packRoot(), "images", "16", "feat_floor_lit_0.png")),
    );
    expect(tile.width).toBe(8);
    expect(tile.height).toBe(16);
  });

  it("counts and skips out-of-bounds selectors instead of crashing", () => {
    const result = summary.results.find((r) => r.key === "nomad");
    expect(result?.invalidSourceSelectorCount).toBe(2);
    expect(result?.invalidSourceExamples).toEqual([
      "monster:Red-Hatted Elf -> row 4, col 104",
      "monster:Father Christmas -> row 13, col 104",
    ]);
  });

  it("produces the expected asset volume", () => {
    const result = summary.results.find((r) => r.key === "nomad");
    expect(result?.assetCount).toBe(1461);
    const files = readdirSync(join(packRoot(), "images", "16"));
    expect(files.length).toBe(1461);
  });

  it("mirrors the pref files byte-for-byte", () => {
    for (const pref of ["graf-nmd.prf", "xtra-nmd.prf", "flvr-nmd.prf"]) {
      const source = readFileSync(join(tilesRoot, "nomad", pref));
      const mirror = readFileSync(join(packRoot(), pref));
      expect(Buffer.compare(source, mirror)).toBe(0);
    }
  });
});

describe("inventory reports", () => {
  it("writes a well-formed JSON inventory with the packs' counts", () => {
    const path = join(outputRoot, "graphics-linoleum-inventory.json");
    expect(existsSync(path)).toBe(true);
    const inventory = JSON.parse(readFileSync(path, "utf8")) as {
      generatedAt: string;
      outputRoot: string;
      packCount: number;
      packs: Array<{
        key: string;
        resolution: number;
        assetCount: number;
        exactSelectorCount: number;
        compatibilityAliasCount: number;
        totalTargetRuleCount: number;
        statefulSelectorCount: number;
        conditionalSelectorCount: number;
        invalidSourceSelectorCount: number;
        legacyTypeCounts: Record<string, number>;
      }>;
    };

    expect(inventory.packCount).toBe(2);
    expect(inventory.packs).toHaveLength(2);

    const old = inventory.packs.find((p) => p.key === "original-tiles");
    expect(old?.resolution).toBe(8);
    expect(old?.assetCount).toBe(1495);
    expect(old?.exactSelectorCount).toBe(1498);
    expect(old?.compatibilityAliasCount).toBe(59);
    expect(old?.totalTargetRuleCount).toBe(1557);
    expect(old?.statefulSelectorCount).toBe(204);
    expect(old?.conditionalSelectorCount).toBe(66);
    expect(old?.invalidSourceSelectorCount).toBe(0);
    expect(old?.legacyTypeCounts).toEqual({
      GF: 70,
      feat: 72,
      trap: 140,
      object: 233,
      monster: 671,
      flavor: 312,
    });

    const nomad = inventory.packs.find((p) => p.key === "nomad");
    expect(nomad?.resolution).toBe(16);
    expect(nomad?.assetCount).toBe(1461);
    expect(nomad?.exactSelectorCount).toBe(1464);
    expect(nomad?.compatibilityAliasCount).toBe(59);
    expect(nomad?.totalTargetRuleCount).toBe(1523);
    expect(nomad?.statefulSelectorCount).toBe(156);
    expect(nomad?.conditionalSelectorCount).toBe(66);
    expect(nomad?.invalidSourceSelectorCount).toBe(2);
  });

  it("writes a Markdown inventory with the summary table", () => {
    const text = readFileSync(join(outputRoot, "graphics-linoleum-inventory.md"), "utf8");
    expect(text).toContain("# Linoleum bundled tileset inventory");
    expect(text).toContain(
      "| Original Tiles (Linoleum) | Original Tiles | 8 | 1495 | 1498 | 59 | 204 | 66 | 1557 |",
    );
    expect(text).toContain(
      "| Nomad's tiles (Linoleum) | Nomad's tiles | 16 | 1461 | 1464 | 59 | 156 | 66 | 1523 |",
    );
  });

  it("counts target lines in targets.txt consistently with the inventory", () => {
    for (const [key, expected] of [
      ["original-tiles", 1557],
      ["nomad", 1523],
    ] as const) {
      const lines = readLines(join(outputRoot, key, "maps", "targets.txt"));
      const targetLines = lines.filter((line) => line.startsWith("target:"));
      expect(targetLines.length).toBe(expected);
    }
  });
});
