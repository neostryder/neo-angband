/**
 * Linoleum target-map and variant-pool model, parsers, and the deterministic
 * pool selection rule.
 *
 * The converter (convert.ts) is the WRITER of `maps/targets.txt` and (when a
 * pack authors them) `maps/pools.txt`. This module gives the format a matching
 * READER plus the pure selection rule a runtime uses to resolve a `pool`
 * mapping down to a single asset for a given grid, so the additive pool /
 * per-object features are round-trippable and testable without touching a
 * tilesheet.
 *
 * Format recap (see docs/LINOLEUM.md):
 *
 *   target:<type>:<selector>:<kind>:<value>
 *     kind = asset   -> value is a PNG base name under images/<res>/
 *          | family  -> value is a family id from maps/families.txt
 *          | pool    -> value is a pool id from maps/pools.txt   (NEW)
 *
 *   pool:<poolId>:selection:<rule>          rule = stable | index   (NEW)
 *   pool:<poolId>:member:<assetName>        one line per candidate  (NEW)
 *
 * Selectors may themselves contain colons (for example `GF:ELEC:0` or
 * `object:light:Wooden Torch`), so a target line is parsed by its fixed head
 * (`target`, type) and fixed tail (kind, value); everything in between is the
 * selector, colons and all - exactly how the writer emits it.
 */

import { stableHashHex } from "./naming.js";

/** The three mapping kinds a target rule may point at. */
export type TargetKind = "asset" | "family" | "pool";

/** The two documented, deterministic pool selection rules. */
export type PoolSelection = "stable" | "index";

/** One parsed `target:` rule. */
export interface TargetRule {
  /** Selector type (feat, trap, GF, monster, object, flavor). */
  type: string;
  /** Selector value, including any embedded colons. */
  selector: string;
  /** What `value` points at. */
  kind: TargetKind;
  /** Asset base name, family id, or pool id, per `kind`. */
  value: string;
}

/** One parsed pool definition: a selection rule plus its candidate assets. */
export interface PoolDefinition {
  /** Stable id referenced by a `pool`-kind target rule. */
  poolId: string;
  /** How a grid resolves to one member (defaults to `stable`). */
  selection: PoolSelection;
  /** Candidate asset base names, in authored order. */
  members: string[];
}

/**
 * The grid/context a pool is resolved against. `index` (an explicit ordinal
 * such as an object's stack position) drives the `index` rule; `x`/`y` drive
 * the `stable` rule and act as the `index` rule's fallback ordinal.
 */
export interface PoolGridContext {
  x: number;
  y: number;
  index?: number;
}

/**
 * Resolve a pool to exactly one member asset for a grid, deterministically.
 *
 * - `stable`: an md5-derived index of `"<poolId>:<x>,<y>"`, so a given grid
 *   cell always draws the same variant (spatial variety that is stable across
 *   redraws and identical on every machine).
 * - `index`: the explicit `ctx.index` (or, when absent, the linear `x + y`)
 *   modulo the member count, wrapped to stay non-negative.
 *
 * Returns null only for an empty pool (no members to choose from).
 */
export function selectPoolMember(
  pool: PoolDefinition,
  ctx: PoolGridContext,
): string | null {
  const n = pool.members.length;
  if (n === 0) return null;
  let raw: number;
  if (pool.selection === "index") {
    raw = ctx.index ?? ctx.x + ctx.y;
  } else {
    raw = Number.parseInt(stableHashHex(`${pool.poolId}:${ctx.x},${ctx.y}`), 16);
  }
  const idx = ((Math.trunc(raw) % n) + n) % n;
  return pool.members[idx] ?? null;
}

/** Format one target rule as its canonical `target:` line. */
export function formatTargetRule(rule: TargetRule): string {
  return `target:${rule.type}:${rule.selector}:${rule.kind}:${rule.value}`;
}

/**
 * Format one pool definition as its `pool:` lines (selection first, then one
 * member line per candidate). The caller prepends any file header.
 */
export function formatPoolLines(pool: PoolDefinition): string[] {
  const lines = [`pool:${pool.poolId}:selection:${pool.selection}`];
  for (const member of pool.members) {
    lines.push(`pool:${pool.poolId}:member:${member}`);
  }
  return lines;
}

function isTargetKind(value: string): value is TargetKind {
  return value === "asset" || value === "family" || value === "pool";
}

/**
 * Parse one `target:` line into a rule, or null when the line is a comment,
 * blank, or not a well-formed target rule. Head/tail fields are fixed; the
 * selector is everything between type and kind, so its embedded colons survive.
 */
export function parseTargetLine(line: string): TargetRule | null {
  const text = line.trim();
  if (text.length === 0 || text.startsWith("#")) return null;
  const parts = text.split(":");
  // target : type : <selector...> : kind : value  -> at least 5 fields.
  if (parts.length < 5 || parts[0] !== "target") return null;
  const kind = parts[parts.length - 2] ?? "";
  const value = parts[parts.length - 1] ?? "";
  if (!isTargetKind(kind) || value.length === 0) return null;
  const type = parts[1] ?? "";
  const selector = parts.slice(2, parts.length - 2).join(":");
  if (type.length === 0 || selector.length === 0) return null;
  return { type, selector, kind, value };
}

/** Parse every `target:` rule from a targets.txt body, in file order. */
export function parseTargetsFile(text: string): TargetRule[] {
  const rules: TargetRule[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const rule = parseTargetLine(line);
    if (rule !== null) rules.push(rule);
  }
  return rules;
}

/**
 * Parse every pool definition from a pools.txt body. Lines for the same pool
 * id accumulate onto one definition regardless of order; a `selection` line
 * sets the rule (defaulting to `stable` if never stated), `member` lines append
 * candidates in file order. Unknown fields and malformed lines are ignored.
 */
export function parsePoolsFile(text: string): PoolDefinition[] {
  const byId = new Map<string, PoolDefinition>();
  const order: string[] = [];
  const ensure = (poolId: string): PoolDefinition => {
    let pool = byId.get(poolId);
    if (pool === undefined) {
      pool = { poolId, selection: "stable", members: [] };
      byId.set(poolId, pool);
      order.push(poolId);
    }
    return pool;
  };

  for (const line of text.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(":");
    if (parts.length < 4 || parts[0] !== "pool") continue;
    const poolId = parts[1] ?? "";
    const field = parts[2] ?? "";
    const value = parts.slice(3).join(":");
    if (poolId.length === 0 || value.length === 0) continue;
    if (field === "selection") {
      const pool = ensure(poolId);
      pool.selection = value === "index" ? "index" : "stable";
    } else if (field === "member") {
      ensure(poolId).members.push(value);
    }
  }

  return order.map((id) => byId.get(id) as PoolDefinition);
}
