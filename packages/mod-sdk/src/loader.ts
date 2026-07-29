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
 * TWO MERGE PHASES, AND WHY
 *
 * composePacks needs a unique string `name` on every added record, because that
 * is the identity it builds refs from. Measured over the shipped core pack, 24
 * of the 44 record files satisfy that and 20 do not (14 carry no string `name`
 * at all; 6 carry names that slug to the same ref). So:
 *
 *  1. COMPOSED FILES (24) go through composePacks, which merges records
 *     per-record and appends a later pack's additions after an earlier pack's.
 *  2. PASSTHROUGH FILES (20) keep whole-file semantics for `records` - the last
 *     provider in load order wins the file - because a mod that ships
 *     `constants.json` means "use mine", not "add a second constants record",
 *     and the host binds one. Per-record ops are then applied on top, in load
 *     order, against the winning array (applyPassthroughOps below), using the
 *     per-file identity declared in record-key.ts.
 *
 * NOTHING IS DROPPED IN SILENCE. This is the invariant the whole file exists to
 * hold. Until 2026-07-29 phase 2 did not exist: a `patches` / `replaces` /
 * `fieldPatches` / `removes` entry aimed at any of the 20 was stripped from the
 * contribution before compose ever saw it, so a mod author shipped a valid op
 * and got no effect and no message - the worst failure mode there is, because a
 * feature that appears to work cannot be found by review. Now every per-record
 * op either takes effect or produces a line in `ComposedContent.problems`
 * naming the pack, the file, the op and the ref. Whole-file replacement of a
 * passthrough file is reported the same way, because it silently discards
 * whatever the previous provider (usually core) put there.
 *
 * `problems` is reported rather than thrown because the web host composes at
 * module scope with no try (packages/web/src/pack.ts), so a throw here is a
 * blank page rather than a message. It is the same shape of channel the pack
 * readers already use (`problems: readonly string[]`), so a host concatenates it
 * into the list it already shows.
 */

import type { PackManifest } from "./manifest.js";
import { slugify } from "./manifest.js";
import { resolveLoadOrder } from "./resolve.js";
import { composePacks, mergePatch } from "./compose.js";
import type { FileContribution, JsonRecord, PackContent } from "./compose.js";
import { applyFieldPatch } from "./patch.js";
import { keyDescription, keySpecFor, recordKey, RECORD_KEY_SPECS } from "./record-key.js";

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
  /** Files whose `records` pass through last-wins (nameless or name-colliding). */
  passthroughFiles: string[];
  /**
   * Every mod-facing operation that could NOT be honoured, in one line each,
   * naming the pack, the file, the op and the record. Empty for a clean set.
   * A host shows these next to the pack-reading problems it already collects.
   */
  problems: string[];
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

/** The pack id a ref's "<owner>:<slug>" prefix names. */
function ownerOf(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? "" : ref.slice(0, at);
}

/** compose.ts mayModify: a pack may only touch its own or a declared dep's records. */
function mayModify(m: PackManifest, ownerPack: string): boolean {
  return ownerPack === m.id || (m.dependencies ?? {})[ownerPack] !== undefined;
}

/** The four per-record op kinds, in the order composePacks applies them. */
type OpKind = "patch" | "replace" | "fieldPatch" | "remove";

/** Every per-record op in one contribution, flattened, in apply order. */
function perRecordOps(
  contrib: FileContribution,
): Array<{ kind: OpKind; ref: string }> {
  const out: Array<{ kind: OpKind; ref: string }> = [];
  for (const ref of Object.keys(contrib.patches ?? {})) out.push({ kind: "patch", ref });
  for (const ref of Object.keys(contrib.replaces ?? {})) out.push({ kind: "replace", ref });
  for (const ref of Object.keys(contrib.fieldPatches ?? {})) {
    out.push({ kind: "fieldPatch", ref });
  }
  for (const ref of contrib.removes ?? []) out.push({ kind: "remove", ref });
  return out;
}

const OP_VERB: Readonly<Record<OpKind, string>> = {
  patch: "patches",
  replace: "replaces",
  fieldPatch: "fieldPatches",
  remove: "removes",
};

/**
 * Apply every pack's per-record ops to a PASSTHROUGH file's winning record
 * array, in load order, and report every op that could not be honoured.
 *
 * Returns the (possibly new) record array; the input is never mutated, and when
 * no pack contributes an op the input array is returned unchanged so routing the
 * base game alone through this path stays a no-op by reference.
 */
function applyPassthroughOps(
  file: string,
  records: readonly unknown[],
  ordered: readonly LoadedPack[],
  providerId: string,
  problems: string[],
): unknown[] {
  const hasOps = ordered.some(
    (p) => p.files[file] !== undefined && perRecordOps(p.files[file] as FileContribution).length > 0,
  );
  if (!hasOps) return records as unknown[];

  /* No declared identity (history: chart/next/roll/phrase are all values a mod
   * would change). Every op is reported and none is applied - the one honest
   * answer, because inventing a key here would mis-merge instead of dropping. */
  if (RECORD_KEY_SPECS[file] === undefined && !recordsKeyedByName(records)) {
    for (const pack of ordered) {
      const contrib = pack.files[file];
      if (!contrib) continue;
      for (const { kind, ref } of perRecordOps(contrib)) {
        problems.push(
          `${pack.manifest.id}: ${file} ${OP_VERB[kind]} "${ref}", but ${file} records have no per-record identity, so only whole-file replacement can change them`,
        );
      }
    }
    return records as unknown[];
  }

  const spec = keySpecFor(file);
  const working: Array<JsonRecord | null> = records.map((r) =>
    typeof r === "object" && r !== null && !Array.isArray(r) ? (r as JsonRecord) : null,
  );

  /* ref -> EVERY position claiming it. Kept as a list rather than resolved to a
   * winner on insert, so "not found" and "claimed twice" are one lookup with two
   * outcomes: there is nowhere for a first-claim-wins fallback to hide. A ref two
   * records claim is unaddressable and reported; both records stay in the game. */
  const claims = new Map<string, number[]>();
  records.forEach((record, i) => {
    const key = recordKey(file, record, spec);
    if (key === null) return; // unkeyable record: stays in the game, not addressable
    const ref = `${providerId}:${key}`;
    const at = claims.get(ref);
    if (at) at.push(i);
    else claims.set(ref, [i]);
  });

  const removed = new Set<number>();

  const reject = (pid: string, kind: OpKind, ref: string, why: string): void => {
    problems.push(`${pid}: ${file} ${OP_VERB[kind]} "${ref}", but ${why}`);
  };

  /** Resolve a ref to a live index, or report why it cannot be touched. */
  const resolve = (
    pack: LoadedPack,
    kind: OpKind,
    ref: string,
  ): number | null => {
    const pid = pack.manifest.id;
    const claimants = claims.get(ref) ?? [];
    if (claimants.length > 1) {
      reject(
        pid,
        kind,
        ref,
        `${claimants.length} ${file} records share that identity (${keyDescription(file)}), so it cannot be addressed - patch a record with a unique identity instead`,
      );
      return null;
    }
    const at = claimants[0];
    if (at === undefined) {
      reject(
        pid,
        kind,
        ref,
        `no such record exists in ${file} (identity is ${keyDescription(file)})`,
      );
      return null;
    }
    if (removed.has(at)) {
      reject(pid, kind, ref, "an earlier pack already removed it");
      return null;
    }
    if (!mayModify(pack.manifest, ownerOf(ref))) {
      reject(
        pid,
        kind,
        ref,
        `${pid} does not declare ${ownerOf(ref)} as a dependency`,
      );
      return null;
    }
    return at;
  };

  for (const pack of ordered) {
    const contrib = pack.files[file];
    if (!contrib) continue;

    for (const [ref, body] of Object.entries(contrib.patches ?? {})) {
      const at = resolve(pack, "patch", ref);
      if (at === null) continue;
      working[at] = mergePatch(working[at] as JsonRecord, body);
    }
    for (const [ref, body] of Object.entries(contrib.replaces ?? {})) {
      const at = resolve(pack, "replace", ref);
      if (at === null) continue;
      working[at] = body;
    }
    for (const [ref, ops] of Object.entries(contrib.fieldPatches ?? {})) {
      const at = resolve(pack, "fieldPatch", ref);
      if (at === null) continue;
      working[at] = applyFieldPatch(working[at] as JsonRecord, ops);
    }
    for (const ref of contrib.removes ?? []) {
      const at = resolve(pack, "remove", ref);
      if (at === null) continue;
      removed.add(at);
    }
  }

  const out: unknown[] = [];
  working.forEach((r, i) => {
    if (!removed.has(i)) out.push(r === null ? records[i] : r);
  });
  return out;
}

/** Whether a passthrough file's records are name-keyed after all (mod-only file). */
function recordsKeyedByName(records: readonly unknown[]): boolean {
  return records.some((r) => isNamedRecord(r));
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
  const problems: string[] = [];

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

  /* Passthrough files, in two phases (see the header): the last provider in load
   * order wins the whole file, then every pack's per-record ops apply on top. */
  for (const f of fileNames) {
    if (composable.has(f)) continue;

    let providerId = "";
    for (const p of ordered) {
      const contrib = p.files[f];
      if (!contrib?.records) continue;
      if (providerId !== "") {
        /* Whole-file replacement is destructive and used to be invisible: the
         * previous provider's records simply vanished. Say so. */
        problems.push(
          `${p.manifest.id}: ${f} replaces the whole file, discarding ${(out[f] as unknown[]).length} record(s) from ${providerId} - ${f} records are not name-keyed, so a whole file is the only thing that can be added to it`,
        );
      }
      out[f] = [...contrib.records];
      providerId = p.manifest.id;
    }

    if (providerId === "") {
      /* SAFETY NET, not a live path. A file is only classified passthrough
       * because some pack's `records` for it are not name-keyed, and such a pack
       * is by definition a provider - so today providerId is never "" here. The
       * equivalent case for a COMPOSABLE file (a mod patches a file nobody
       * supplies records for) is loud already: composePacks throws
       * "patch target ... does not exist". This branch is kept, cordoned and
       * documented rather than deleted, because if the classification ever
       * changes its absence would be a silent drop - the exact failure this file
       * exists to prevent. Covered by loader.test.ts only through the composable
       * counterpart. */
      for (const p of ordered) {
        const contrib = p.files[f];
        if (!contrib) continue;
        for (const { kind, ref } of perRecordOps(contrib)) {
          problems.push(
            `${p.manifest.id}: ${f} ${OP_VERB[kind]} "${ref}", but no pack supplies any ${f} records`,
          );
        }
      }
      continue;
    }

    out[f] = applyPassthroughOps(f, out[f] as unknown[], ordered, providerId, problems);
  }

  return {
    records: out,
    composedFiles: [...composable].sort(),
    passthroughFiles: [...fileNames].filter((f) => !composable.has(f)).sort(),
    problems,
  };
}
