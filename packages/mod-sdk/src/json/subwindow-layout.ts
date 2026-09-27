import { defineFormat, json, type ValidationIssue, type ValidationResult, type Validator } from "./index.js";
import { nonNegativeInt } from "./scalars.js";

/**
 * Panel ids the tiled shell can show, plus the main view. The web shell's
 * own list must stay in this order; a test compares the two.
 */
export const SUBWINDOW_LAYOUT_IDS = [
  "inventory",
  "equipment",
  "player-basic",
  "player-extra",
  "player-compact",
  "map",
  "messages",
  "overhead",
  "monster-recall",
  "object-recall",
  "monsters",
  "status",
  "items",
  "player-topbar",
] as const;

const tileId = json.enum(["main", ...SUBWINDOW_LAYOUT_IDS] as const);
const subwindowId = json.enum(SUBWINDOW_LAYOUT_IDS);

export type LayoutTileId = "main" | (typeof SUBWINDOW_LAYOUT_IDS)[number];

export type LayoutNodeData =
  | { kind: "leaf"; id: LayoutTileId }
  | {
      kind: "split";
      axis: "h" | "v";
      ratio: number;
      first: LayoutNodeData;
      second: LayoutNodeData;
    };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function unknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: `${path}[${JSON.stringify(key)}]`, message: "unknown field" });
  }
  return issues;
}

/** A BSP node. Split children are the same shape, so this cannot be a plain object combinator. */
export const layoutNode: Validator<LayoutNodeData> = {
  validate(value, path = "$"): ValidationResult<LayoutNodeData> {
    if (!isObject(value)) return { ok: false, issues: [{ path, message: "expected an object" }] };
    if (value.kind === "leaf") {
      const issues = unknownFields(value, ["kind", "id"], path);
      const id = tileId.validate(value.id, `${path}["id"]`);
      if (!id.ok) issues.push(...id.issues);
      if (issues.length || !id.ok) return { ok: false, issues };
      return { ok: true, value: { kind: "leaf", id: id.value } };
    }
    if (value.kind === "split") {
      const issues = unknownFields(value, ["kind", "axis", "ratio", "first", "second"], path);
      const axis = json.enum(["h", "v"] as const).validate(value.axis, `${path}["axis"]`);
      const ratio = json.finiteNumber.validate(value.ratio, `${path}["ratio"]`);
      const first = layoutNode.validate(value.first, `${path}["first"]`);
      const second = layoutNode.validate(value.second, `${path}["second"]`);
      if (!axis.ok) issues.push(...axis.issues);
      if (!ratio.ok) issues.push(...ratio.issues);
      else if (ratio.value < 0.08 || ratio.value > 0.92) {
        issues.push({ path: `${path}["ratio"]`, message: "ratio must be from 0.08 to 0.92" });
      }
      if (!first.ok) issues.push(...first.issues);
      if (!second.ok) issues.push(...second.issues);
      if (issues.length || !axis.ok || !ratio.ok || !first.ok || !second.ok) return { ok: false, issues };
      return {
        ok: true,
        value: { kind: "split", axis: axis.value, ratio: ratio.value, first: first.value, second: second.value },
      };
    }
    return { ok: false, issues: [{ path: `${path}["kind"]`, message: "expected leaf or split" }] };
  },
};

const validator = json.object({
  enabled: json.map(json.boolean, subwindowId),
  tree: layoutNode,
  mapTileMode: nonNegativeInt,
  modBlocks: json.optional(json.map(json.string)),
});

function collectLeaves(node: LayoutNodeData, ids: string[]): void {
  if (node.kind === "leaf") ids.push(node.id);
  else {
    collectLeaves(node.first, ids);
    collectLeaves(node.second, ids);
  }
}

const layoutValidator: typeof validator = {
  validate(value, path = "$") {
    const result = validator.validate(value, path);
    if (!result.ok) return result;
    const leaves: string[] = [];
    collectLeaves(result.value.tree, leaves);
    if (!leaves.includes("main") || new Set(leaves).size !== leaves.length) {
      return { ok: false, issues: [{ path: `${path}["tree"]`, message: "expected one main tile and no duplicate tiles" }] };
    }
    return result;
  },
};

export const subwindowLayoutFormat = defineFormat({
  format: "neo-angband/ui/subwindow-layout",
  schemaVersion: 1,
  validator: layoutValidator,
  sample: {
    enabled: {
      equipment: false,
      inventory: false,
      items: false,
      map: false,
      messages: true,
      "monster-recall": false,
      monsters: false,
      "object-recall": false,
      overhead: false,
      "player-basic": false,
      "player-compact": false,
      "player-extra": false,
      "player-topbar": false,
      status: false,
    },
    tree: {
      kind: "split",
      axis: "v",
      ratio: 0.78,
      first: { kind: "leaf", id: "main" },
      second: { kind: "leaf", id: "messages" },
    },
    mapTileMode: 0,
    modBlocks: { "qol-zoom": "8:10:12" },
  },
});
