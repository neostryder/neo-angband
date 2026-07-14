/**
 * Content-pack loading: turn a resolved set of packs into the merged per-file
 * record arrays a host binds into the running game.
 *
 * This is the join MOD_INTEGRATION_PLAN.md (Wave 1, W1.1) calls for. Until now
 * the composition engine (resolveLoadOrder + composePacks) had no runtime
 * caller: the game bound a single hard-coded pack directly. This wraps the
 * engine into one entry point so the base game and every mod flow through the
 * same pipeline, and a mod's records / patches / replaces / removes /
 * fieldPatches actually take effect.
 *
 * The host (web / cli) owns the glue: it reads packs off disk or bundle, calls
 * composeContentPacks, assembles its GamePack from the result, and hands that
 * to core bindCore. Core stays mod-sdk-agnostic (it only ever sees a merged
 * pack), so the layering the audit relied on is preserved.
 *
 * Per-record composition needs stable per-record identity, so a file composes
 * through the full FileContribution model only when every contributing pack's
 * added records are uniquely name-keyed (monster, object, p_race, class, ...).
 * Files whose records carry no `name`, or whose names collide, cannot be
 * addressed per-record; they pass through last-in-load-order-wins. This also
 * guarantees composePacks is never handed a set that would throw on a missing
 * or duplicate name at boot. Refining passthrough (config singletons like
 * constants, index-keyed sections like names) is W1.2.
 */

import type { PackManifest } from "./manifest.js";
import { slugify } from "./manifest.js";
import { resolveLoadOrder } from "./resolve.js";
import { composePacks } from "./compose.js";
import type { FileContribution, JsonRecord, PackContent } from "./compose.js";

/**
 * One pack as the host loaded it: its manifest plus its per-file contributions.
 * The base game is the degenerate case where every file is records-only.
 */
export interface LoadedPack {
  manifest: PackManifest;
  /** fileName -> that file's contribution (records / patches / ...). */
  files: Record<string, FileContribution>;
}

/** The merged content: per-file record arrays, in deterministic order. */
export interface ComposedContent {
  /** fileName -> composed record array. */
  records: Record<string, unknown[]>;
  /** Files merged per-record through the full FileContribution model. */
  composedFiles: string[];
  /** Files passed through last-wins (nameless or name-colliding records). */
  passthroughFiles: string[];
}

function isNamedRecord(r: unknown): r is JsonRecord {
  return (
    typeof r === "object" &&
    r !== null &&
    !Array.isArray(r) &&
    typeof (r as { name?: unknown }).name === "string" &&
    (r as { name: string }).name.length > 0
  );
}

/**
 * A pack's added records for one file are per-record composable only if they
 * are all name-keyed and their refs (pack:slug(name)) do not collide - exactly
 * the two conditions composePacks would otherwise throw on.
 */
function recordsComposable(records: readonly unknown[]): boolean {
  const slugs = new Set<string>();
  for (const r of records) {
    if (!isNamedRecord(r)) return false;
    const slug = slugify(r["name"] as string);
    if (slugs.has(slug)) return false;
    slugs.add(slug);
  }
  return true;
}

/** Reorder loaded packs into resolved load order (dependencies first). */
function orderPacks(packs: readonly LoadedPack[]): LoadedPack[] {
  const ordered = resolveLoadOrder(packs.map((p) => p.manifest));
  const byId = new Map(packs.map((p) => [p.manifest.id, p]));
  return ordered.map((m) => byId.get(m.id) as LoadedPack);
}

/**
 * Compose a set of loaded packs into merged per-file record arrays. With a
 * single pack (the base game alone) the output is record-identical to the
 * input: every record object is preserved by reference and its order is
 * unchanged, so routing the base game through this path is a no-op.
 */
export function composeContentPacks(
  packs: readonly LoadedPack[],
): ComposedContent {
  const ordered = orderPacks(packs);

  const fileNames = new Set<string>();
  for (const p of ordered) {
    for (const f of Object.keys(p.files)) fileNames.add(f);
  }

  // Classify each file: per-record composable, or whole-file passthrough.
  const composable = new Set<string>();
  for (const f of fileNames) {
    let ok = true;
    for (const p of ordered) {
      const contrib = p.files[f];
      if (contrib?.records && !recordsComposable(contrib.records)) {
        ok = false;
        break;
      }
    }
    if (ok) composable.add(f);
  }

  const contents: PackContent[] = ordered.map((p) => {
    const files: Record<string, FileContribution> = {};
    for (const [f, contrib] of Object.entries(p.files)) {
      if (composable.has(f)) files[f] = contrib;
    }
    return { manifest: p.manifest, files };
  });

  const game = composePacks(contents);

  const out: Record<string, unknown[]> = {};
  for (const [file, table] of game) {
    out[file] = [...table.values()].map((r) => r.value);
  }

  // Passthrough files: the last provider in load order wins the whole file.
  for (const f of fileNames) {
    if (composable.has(f)) continue;
    for (const p of ordered) {
      const contrib = p.files[f];
      if (contrib?.records) out[f] = [...contrib.records];
    }
  }

  return {
    records: out,
    composedFiles: [...composable].sort(),
    passthroughFiles: [...fileNames].filter((f) => !composable.has(f)).sort(),
  };
}
