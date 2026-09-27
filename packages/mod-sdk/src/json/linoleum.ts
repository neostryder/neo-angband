/**
 * Linoleum loose-pack documents.
 *
 * A pack used to be five text files (manifest.txt, maps/targets.txt,
 * maps/families.txt, maps/pools.txt, maps/tall.txt) plus a byte copy of each
 * source graf/xtra/flvr pref. The runtime reads one pack document. The pref
 * copy is a tile-map document, because a pack no longer ships .prf.
 */

import { color, defineFormat, json, utcTimestamp } from "./index.js";
import type { Validator } from "./index.js";

function nonEmpty(message = "expected a non-empty string"): Validator<string> {
  return {
    validate(value, path = "$") {
      const result = json.string.validate(value, path);
      if (!result.ok) return result;
      if (result.value.length === 0) return { ok: false, issues: [{ path, message }] };
      return result;
    },
  };
}

function byte(): Validator<number> {
  return {
    validate(value, path = "$") {
      const result = json.integer.validate(value, path);
      if (!result.ok) return result;
      if (result.value < 0 || result.value > 255) {
        return { ok: false, issues: [{ path, message: "expected an integer from 0 to 255" }] };
      }
      return result;
    },
  };
}

const pulseShape = json.object({
  min: byte(),
  max: byte(),
  period: json.integer,
});

const pulse: Validator<{ min: number; max: number; period: number }> = {
  validate(value, path = "$") {
    const result = pulseShape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.min > result.value.max) {
      return { ok: false, issues: [{ path: `${path}["min"]`, message: "min cannot exceed max" }] };
    }
    if (result.value.period <= 0) {
      return { ok: false, issues: [{ path: `${path}["period"]`, message: "period must be positive" }] };
    }
    return result;
  },
};

/**
 * Selector types keep the pref grammar's own spelling, including "GF".
 * They are values the tile parser matches, not house ids.
 */
const target = json.object({
  type: nonEmpty(),
  selector: nonEmpty(),
  kind: json.enum(["asset", "family", "pool"] as const),
  value: nonEmpty(),
});

const family = json.object({
  id: nonEmpty(),
  asset: nonEmpty(),
  selection: json.optional(json.enum(["stable", "index"] as const)),
  glowAlpha: json.optional(byte()),
  tint: json.optional(color),
  pulse: json.optional(pulse),
});

const pool = json.object({
  id: nonEmpty(),
  selection: json.enum(["stable", "index"] as const),
  members: json.array(nonEmpty()),
});

const packShape = json.object({
  packId: nonEmpty(),
  displayName: nonEmpty(),
  imageFormat: json.enum(["png"] as const),
  resolution: json.integer,
  targets: json.array(target),
  families: json.optional(json.array(family)),
  pools: json.optional(json.array(pool)),
  tall: json.optional(json.array(nonEmpty())),
});

const packValidator: typeof packShape = {
  validate(value, path = "$") {
    const result = packShape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.resolution <= 0) {
      return { ok: false, issues: [{ path: `${path}["resolution"]`, message: "resolution must be positive" }] };
    }
    return result;
  },
};

export const linoleumPackFormat = defineFormat({
  format: "neo-angband/linoleum/pack",
  schemaVersion: 1,
  validator: packValidator,
  sample: {
    packId: "linoleum-original-tiles",
    displayName: "Original Tiles (Linoleum)",
    imageFormat: "png",
    resolution: 8,
    targets: [
      { type: "feat", selector: "FLOOR:lit", kind: "asset", value: "feat_floor_lit_0" },
    ],
    families: [
      {
        id: "feat_less_lit_0_fx",
        asset: "feat_less_lit_0",
        selection: "stable",
        glowAlpha: 72,
        tint: { red: 180, green: 220, blue: 255, alpha: 48 },
        pulse: { min: 168, max: 255, period: 1400 },
      },
    ],
    pools: [
      {
        id: "floor_variants",
        selection: "stable",
        members: ["feat_floor_lit_0", "feat_floor_dark_0"],
      },
    ],
    tall: ["monster_guardian_naga_0"],
  },
});

const tileSelector = json.object({
  type: nonEmpty(),
  selector: nonEmpty(),
  row: byte(),
  column: byte(),
  condition: json.optional(nonEmpty()),
});

export const linoleumTileMapFormat = defineFormat({
  format: "neo-angband/linoleum/tile-map",
  schemaVersion: 1,
  validator: json.object({
    files: json.array(json.object({
      name: nonEmpty(),
      selectors: json.array(tileSelector),
    })),
  }),
  sample: {
    files: [
      {
        name: "graf-xxx.prf",
        selectors: [{ type: "feat", selector: "FLOOR:lit", row: 0, column: 33 }],
      },
    ],
  },
});

/** Legacy type tokens such as "GF" are map keys here, so they are not kebab-case ids. */
const typeToken: Validator<string> = {
  validate(value, path = "$") {
    if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) {
      return { ok: false, issues: [{ path, message: "expected a legacy type token" }] };
    }
    return { ok: true, value };
  },
};

const countMap = json.map(json.integer, typeToken);

const inventoryPack = json.object({
  key: nonEmpty(),
  displayName: nonEmpty(),
  sourceMode: nonEmpty(),
  sourceDirectory: nonEmpty(),
  resolution: json.integer,
  packRoot: nonEmpty(),
  packPath: nonEmpty(),
  tileMapPath: nonEmpty(),
  tallAssetCount: json.integer,
  poolCount: json.integer,
  authoredTargetCount: json.integer,
  prefFiles: json.array(nonEmpty()),
  legacyTypeCounts: countMap,
  exactTypeCounts: countMap,
  compatibilityAliasCounts: countMap,
  exactSelectorCount: json.integer,
  compatibilityAliasCount: json.integer,
  totalTargetRuleCount: json.integer,
  assetCount: json.integer,
  statefulSelectorCount: json.integer,
  conditionalSelectorCount: json.integer,
  invalidSourceSelectorCount: json.integer,
  invalidSourceExamples: json.array(json.string),
  parityNotes: json.array(json.string),
});

export const linoleumInventoryFormat = defineFormat({
  format: "neo-angband/linoleum/inventory",
  schemaVersion: 1,
  validator: json.object({
    generatedAt: utcTimestamp,
    outputRoot: nonEmpty(),
    packCount: json.integer,
    packs: json.array(inventoryPack),
  }),
  sample: {
    generatedAt: "2026-09-26T00:00:00Z",
    outputRoot: "build/linoleum",
    packCount: 1,
    packs: [
      {
        key: "original-tiles",
        displayName: "Original Tiles (Linoleum)",
        sourceMode: "Original Tiles",
        sourceDirectory: "old",
        resolution: 8,
        packRoot: "build/linoleum/original-tiles",
        packPath: "build/linoleum/original-tiles/pack.json",
        tileMapPath: "build/linoleum/original-tiles/tile-map.json",
        tallAssetCount: 0,
        poolCount: 0,
        authoredTargetCount: 0,
        prefFiles: ["graf-xxx.prf"],
        legacyTypeCounts: { feat: 1 },
        exactTypeCounts: { feat: 1 },
        compatibilityAliasCounts: {},
        exactSelectorCount: 1,
        compatibilityAliasCount: 0,
        totalTargetRuleCount: 1,
        assetCount: 1,
        statefulSelectorCount: 0,
        conditionalSelectorCount: 0,
        invalidSourceSelectorCount: 0,
        invalidSourceExamples: [],
        parityNotes: ["Stateful feat and trap selectors keep their variant suffix."],
      },
    ],
  },
});
