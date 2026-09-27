/**
 * End-to-end converter tests on the two smallest bundled packs:
 * original-tiles (old, 8x8) and nomad (8x16, non-square).
 *
 * The counts and target lines below started as a byte-for-byte cross-check
 * against a ground-truth run of the original scripts/build-linoleum-packs.ps1
 * over the same reference data. Three deliberate divergences from the ps1 have
 * since been made, each because the ps1's behaviour produced a pack that did
 * NOT render like the tilesheet it came from (all three were caught by
 * packages/web linoleum-equivalence.test.ts, which compares the two engines
 * pixel by pixel):
 *
 * 1. DECIMAL tile bytes are accepted (prf.ts isTileByte). The ps1 required
 *    0xNN and so dropped `object:none:<pile>:131:159`, losing the pile tile.
 * 2. Colliding asset names are disambiguated with the trailing sequence number
 *    (`_1`, `_2`, ...). The ps1 slugged `Enchant Armour` and `*Enchant Armour*`
 *    - two different scrolls - to one file name, so one crop overwrote the
 *    other and a scroll drew the wrong tile.
 * 3. Exact target rules are written in SOURCE order, not alphabetically. The
 *    format is last-rule-wins, so sorting discards the precedence a pack's own
 *    override lines rely on. This one is DEFENSIVE: on the four bundled packs
 *    it changes no rendered tile (proven - the pixel-equivalence test passes
 *    with either order), and it is pinned here instead, by the test that an
 *    override line must follow what it overrides.
 *
 * Everything else still matches the ps1's output, and every extracted PNG
 * still matches the source sheet pixel-for-pixel.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { linoleumInventoryFormat, linoleumPackFormat, linoleumTileMapFormat, parseDocument, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
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

function packOf(root: string) {
  const parsed = parseDocument(readFileSync(join(root, "pack.json"), "utf8"), linoleumPackFormat);
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join("; "));
  return parsed.data;
}

function targetIndex(
  root: string,
  type: string,
  selector: string,
  kind: string,
  value: string,
): number {
  return packOf(root).targets.findIndex(
    (rule) => rule.type === type && rule.selector === selector && rule.kind === kind && rule.value === value,
  );
}

describe("original-tiles (old, 8x8) pack", () => {
  const packRoot = (): string => join(outputRoot, "original-tiles");

  it("writes the pack document", () => {
    const pack = packOf(packRoot());
    expect(pack.packId).toBe("linoleum-original-tiles");
    expect(pack.displayName).toBe("Original Tiles (Linoleum)");
    expect(pack.imageFormat).toBe("png");
    expect(pack.resolution).toBe(8);
    expect(pack.families?.length).toBeGreaterThan(0);
    expect(existsSync(join(packRoot(), "manifest.txt"))).toBe(false);
    expect(existsSync(join(packRoot(), "graf-xxx.prf"))).toBe(false);
  });

  it("emits the expected exact targets (hand-computed from graf-xxx.prf)", () => {
    const root = packRoot();
    // graf-xxx.prf: feat:FLOOR:lit:0x80:0xA1
    expect(targetIndex(root, "feat", "FLOOR:lit", "asset", "feat_floor_lit_0")).toBeGreaterThan(-1);
    // graf-xxx.prf: monster:Farmer Maggot:0x9B:0x8B
    expect(targetIndex(root, "monster", "Farmer Maggot", "asset", "monster_farmer_maggot_0")).toBeGreaterThan(-1);
    // graf-xxx.prf: GF:ELEC:0:0x84:0x90 (logical value contains a colon)
    expect(targetIndex(root, "GF", "ELEC:0", "asset", "gf_elec_0_0")).toBeGreaterThan(-1);
    // xtra-xxx.prf: ?:[AND [EQU $CLASS Warrior] [EQU $RACE Human] ] then
    // monster:<player>:0x8C:0x80
    expect(targetIndex(
      root,
      "monster",
      "<player>:when:[AND [EQU $CLASS Warrior] [EQU $RACE Human] ]",
      "asset",
      "monster_player_when_and_equ_class_warrior_equ_race_human_0",
    )).toBeGreaterThan(-1);
  });

  it("emits compatibility aliases preferring the lit variant", () => {
    const root = packRoot();
    // FLOOR has dark/lit/los/torch variants; lit ranks highest for aliases.
    expect(targetIndex(root, "feat", "FLOOR", "asset", "feat_floor_lit_0")).toBeGreaterThan(-1);
    // LESS is a family-mapped stairway selector.
    expect(targetIndex(root, "feat", "LESS", "family", "feat_less_lit_0_fx")).toBeGreaterThan(-1);
  });

  it("puts compatibility aliases before the exact selector they generalize", () => {
    const root = packRoot();
    const aliasIndex = targetIndex(root, "feat", "FLOOR", "asset", "feat_floor_lit_0");
    const exactIndex = targetIndex(root, "feat", "FLOOR:lit", "asset", "feat_floor_lit_0");
    expect(aliasIndex).toBeGreaterThan(-1);
    expect(exactIndex).toBeGreaterThan(aliasIndex);
  });

  it("exports the decimal-coordinate line object:none:<pile>:131:159", () => {
    // The ps1 dropped it (hex-only); the C reads decimal, and the pile tile is
    // real art the map draws over a grid holding several objects.
    expect(targetIndex(packRoot(), "object", "none:<pile>", "asset", "object_none_pile_0")).toBeGreaterThan(-1);
    expect(existsSync(join(packRoot(), "images", "8", "object_none_pile_0.png"))).toBe(true);
  });

  it("gives two selectors that slug alike their own assets", () => {
    // object.txt has both `Enchant Armour` and `*Enchant Armour*` (a distinct,
    // greater scroll) and they slug to the same name; the second takes _1, so
    // neither scroll can end up drawing the other's tile.
    const root = packRoot();
    expect(targetIndex(root, "object", "scroll:Enchant Armour", "asset", "object_scroll_enchant_armour_0")).toBeGreaterThan(-1);
    expect(targetIndex(root, "object", "scroll:*Enchant Armour*", "asset", "object_scroll_enchant_armour_1")).toBeGreaterThan(-1);
    const dir = join(packRoot(), "images", "8");
    const first = PNG.sync.read(readFileSync(join(dir, "object_scroll_enchant_armour_0.png")));
    const second = PNG.sync.read(readFileSync(join(dir, "object_scroll_enchant_armour_1.png")));
    expect(Buffer.compare(first.data, second.data)).not.toBe(0);
  });

  it("keeps an override line after the line it overrides (source order)", () => {
    const root = packRoot();
    const specific = targetIndex(root, "object", "scroll:Enchant Armour", "asset", "object_scroll_enchant_armour_0");
    const glob = targetIndex(root, "object", "scroll:*Enchant Armour*", "asset", "object_scroll_enchant_armour_1");
    expect(specific).toBeGreaterThan(-1);
    expect(glob).toBeGreaterThan(specific);
  });

  it("writes family effect metadata for LESS/MORE stairs", () => {
    const families = packOf(packRoot()).families ?? [];
    const less = families.find((family) => family.id === "feat_less_lit_0_fx");
    const more = families.find((family) => family.id === "feat_more_lit_0_fx");
    expect(less).toMatchObject({
      asset: "feat_less_lit_0",
      selection: "stable",
      glowAlpha: 72,
      tint: { red: 180, green: 220, blue: 255, alpha: 48 },
      pulse: { min: 168, max: 255, period: 1400 },
    });
    expect(more).toMatchObject({
      glowAlpha: 64,
      tint: { red: 255, green: 210, blue: 150, alpha: 40 },
      pulse: { min: 176, max: 255, period: 1200 },
    });
  });

  it("records the pref selectors in tile-map.json instead of copying .prf", () => {
    const text = readFileSync(join(packRoot(), "tile-map.json"), "utf8");
    const parsed = parseDocument(
      text,
      linoleumTileMapFormat,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDocument(linoleumTileMapFormat, parsed.data)).toBe(text);
    const packText = readFileSync(join(packRoot(), "pack.json"), "utf8");
    const pack = parseDocument(packText, linoleumPackFormat);
    expect(pack.ok && serializeDocument(linoleumPackFormat, pack.data)).toBe(packText);
    const graf = parsed.data.files.find((file) => file.name === "graf-xxx.prf");
    expect(graf?.selectors).toContainEqual({ type: "feat", selector: "FLOOR:lit", row: 0, column: 33 });
    expect(existsSync(join(packRoot(), "xtra-xxx.prf"))).toBe(false);
    expect(existsSync(join(packRoot(), "flvr-xxx.prf"))).toBe(false);
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
    expect(result?.assetCount).toBe(1499);
    expect(result?.assetCount ?? 0).toBeGreaterThan(1000);
    const files = readdirSync(join(packRoot(), "images", "8"));
    expect(files.length).toBe(result?.assetCount);
  });

  it("does not copy the source pref files into the pack", () => {
    for (const pref of ["graf-xxx.prf", "xtra-xxx.prf", "flvr-xxx.prf"]) {
      expect(existsSync(join(packRoot(), pref))).toBe(false);
    }
  });
});

describe("nomad (8x16, non-square) pack", () => {
  const packRoot = (): string => join(outputRoot, "nomad");

  it("writes the pack document with the nominal 16 resolution", () => {
    const pack = packOf(packRoot());
    expect(pack.packId).toBe("linoleum-nomad");
    expect(pack.displayName).toBe("Nomad's tiles (Linoleum)");
    expect(pack.resolution).toBe(16);
    expect(pack.families?.length).toBeGreaterThan(0);
  });

  it("preserves the literal * variant in exact selectors", () => {
    const root = packRoot();
    // graf-nmd.prf: feat:LESS:*:0x80:0x94
    expect(targetIndex(root, "feat", "LESS:*", "family", "feat_less_0_fx")).toBeGreaterThan(-1);
    expect(targetIndex(root, "feat", "LESS", "family", "feat_less_0_fx")).toBeGreaterThan(-1);
    // graf-nmd.prf: feat:FLOOR:lit:0x80:0x82
    expect(targetIndex(root, "feat", "FLOOR:lit", "asset", "feat_floor_lit_0")).toBeGreaterThan(-1);
    expect(targetIndex(root, "feat", "FLOOR", "asset", "feat_floor_lit_0")).toBeGreaterThan(-1);
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
    /* 1465 -> 1463 on 2026-08-07 (#143): reference/ moved from upstream master
     * back to the 4.2.6 tag, and 4.2.6's nomad prf files name two fewer tiles.
     * The count is read from the pack AND from the directory on disk, so a
     * converter that under-emits cannot satisfy both. */
    expect(result?.assetCount).toBe(1463);
    const files = readdirSync(join(packRoot(), "images", "16"));
    expect(files.length).toBe(1463);
  });

  it("does not copy the source pref files into the pack", () => {
    for (const pref of ["graf-nmd.prf", "xtra-nmd.prf", "flvr-nmd.prf"]) {
      expect(existsSync(join(packRoot(), pref))).toBe(false);
    }
  });
});

describe("inventory reports", () => {
  it("writes a well-formed JSON inventory with the packs' counts", () => {
    const path = join(outputRoot, "graphics-linoleum-inventory.json");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    const parsed = parseDocument(text, linoleumInventoryFormat);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDocument(linoleumInventoryFormat, parsed.data)).toBe(text);
    const inventory = parsed.data;

    expect(inventory.packCount).toBe(2);
    expect(inventory.packs).toHaveLength(2);

    const old = inventory.packs.find((p) => p.key === "original-tiles");
    expect(old?.resolution).toBe(8);
    expect(old?.assetCount).toBe(1499);
    expect(old?.exactSelectorCount).toBe(1499);
    expect(old?.compatibilityAliasCount).toBe(59);
    expect(old?.totalTargetRuleCount).toBe(1558);
    expect(old?.statefulSelectorCount).toBe(204);
    expect(old?.conditionalSelectorCount).toBe(66);
    expect(old?.invalidSourceSelectorCount).toBe(0);
    expect(old?.legacyTypeCounts).toEqual({
      GF: 70,
      feat: 72,
      trap: 140,
      // 234, not 233: the decimal-coordinate <pile> line now counts too.
      object: 234,
      monster: 671,
      flavor: 312,
    });

    const nomad = inventory.packs.find((p) => p.key === "nomad");
    expect(nomad?.resolution).toBe(16);
    expect(nomad?.assetCount).toBe(1463);
    expect(nomad?.exactSelectorCount).toBe(1463);
    expect(nomad?.compatibilityAliasCount).toBe(59);
    expect(nomad?.totalTargetRuleCount).toBe(1522);
    expect(nomad?.statefulSelectorCount).toBe(156);
    expect(nomad?.conditionalSelectorCount).toBe(66);
    expect(nomad?.invalidSourceSelectorCount).toBe(2);
  });

  it("writes a Markdown inventory with the summary table", () => {
    const text = readFileSync(join(outputRoot, "graphics-linoleum-inventory.md"), "utf8");
    expect(text).toContain("# Linoleum bundled tileset inventory");
    expect(text).toContain(
      "| Original Tiles (Linoleum) | Original Tiles | 8 | 1499 | 1499 | 59 | 204 | 66 | 1558 |",
    );
    expect(text).toContain(
      "| Nomad's tiles (Linoleum) | Nomad's tiles | 16 | 1463 | 1463 | 59 | 156 | 66 | 1522 |",
    );
  });

  it("counts pack targets consistently with the inventory", () => {
    for (const [key, expected] of [
      ["original-tiles", 1558],
      ["nomad", 1522],
    ] as const) {
      expect(packOf(join(outputRoot, key)).targets.length).toBe(expected);
    }
  });
});
