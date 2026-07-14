/**
 * Record composition: how a stack of packs becomes one game.
 *
 * Every record in the composed game is identified by a PackRef
 * ("<owner-pack>:<slug>"). Packs may:
 *  - add records (they become the owner),
 *  - patch records owned by packs they declare as dependencies
 *    (deep merge: objects merge per key, arrays and scalars replace,
 *    an explicit null deletes the key),
 *  - replace such records wholesale, or
 *  - remove them.
 *
 * The base game is pack zero ("core") and gets no special treatment:
 * a total conversion is just a pack that replaces or removes core
 * records. Composition is deterministic given the resolved load order,
 * and every record carries provenance (owner plus every pack that
 * modified it) for savefiles and debugging.
 */

import type { PackManifest, PackRef } from "./manifest.js";
import { packRef } from "./manifest.js";
import { applyFieldPatch } from "./patch.js";
import type { FieldPatch } from "./patch.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

/** One pack's contribution to one record file (e.g. "monster"). */
export interface FileContribution {
  /** New records; this pack becomes their owner. Each needs a name. */
  records?: JsonRecord[];
  /** Deep-merge patches onto records owned by declared dependencies. */
  patches?: Record<string, JsonRecord>;
  /** Wholesale replacements (owner and ref are preserved). */
  replaces?: Record<string, JsonRecord>;
  /** Refs to delete from the composed game. */
  removes?: string[];
  /**
   * Field-level patches (see patch.ts): ordered field ops per target ref.
   * composePacks applies these in load order after the coarse `patches`/
   * `replaces` for the same pack (each pack's ops fold onto the running
   * value, which is identical to composeFieldPatches over the ordered
   * list). The pre-launch conflict report (P7 phase 6) reads the same data
   * to find same-field collisions without the false-positive whole-record
   * conflicts `patches` produces.
   */
  fieldPatches?: Record<string, FieldPatch>;
}

export interface PackContent {
  manifest: PackManifest;
  /** Contributions keyed by record file: "monster", "object", ... */
  files: Record<string, FileContribution>;
}

export interface ComposedRecord {
  ref: PackRef;
  /** The pack that added the record. */
  owner: string;
  /** Every pack that patched or replaced it, in load order. */
  modifiedBy: string[];
  value: JsonRecord;
}

export class ComposeError extends Error {}

/** Deep merge per the pack patch rules. Returns a new object. */
export function mergePatch(base: JsonRecord, patch: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };
  for (const [key, val] of Object.entries(patch)) {
    if (val === null) {
      delete out[key];
    } else if (
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof out[key] === "object" &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergePatch(out[key] as JsonRecord, val as JsonRecord);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function mayModify(m: PackManifest, ownerPack: string): boolean {
  return ownerPack === m.id || (m.dependencies ?? {})[ownerPack] !== undefined;
}

function ownerOf(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? "" : ref.slice(0, at);
}

/**
 * Compose packs (already in resolved load order) into per-file record
 * maps. Iteration order of each map is deterministic: records appear
 * in the order their owning packs added them.
 */
export function composePacks(
  packs: readonly PackContent[],
): Map<string, Map<PackRef, ComposedRecord>> {
  const game = new Map<string, Map<PackRef, ComposedRecord>>();

  for (const pack of packs) {
    const pid = pack.manifest.id;
    for (const [file, contrib] of Object.entries(pack.files)) {
      let table = game.get(file);
      if (!table) {
        table = new Map();
        game.set(file, table);
      }

      for (const rec of contrib.records ?? []) {
        const name = rec["name"];
        if (typeof name !== "string" || name.length === 0) {
          throw new ComposeError(`${pid}/${file}: record without a name`);
        }
        const ref = packRef(pid, name);
        if (table.has(ref)) {
          throw new ComposeError(`${pid}/${file}: duplicate record ${ref}`);
        }
        table.set(ref, { ref, owner: pid, modifiedBy: [], value: rec });
      }

      for (const kind of ["patches", "replaces"] as const) {
        for (const [refStr, body] of Object.entries(contrib[kind] ?? {})) {
          const ref = refStr as PackRef;
          const existing = table.get(ref);
          if (!existing) {
            const verb = kind === "patches" ? "patch" : "replace";
            throw new ComposeError(`${pid}/${file}: ${verb} target ${ref} does not exist`);
          }
          if (!mayModify(pack.manifest, ownerOf(ref))) {
            throw new ComposeError(
              `${pid}/${file}: cannot modify ${ref} without declaring ${ownerOf(ref)} as a dependency`,
            );
          }
          existing.value =
            kind === "patches" ? mergePatch(existing.value, body) : body;
          existing.modifiedBy.push(pid);
        }
      }

      for (const [refStr, ops] of Object.entries(contrib.fieldPatches ?? {})) {
        const ref = refStr as PackRef;
        const existing = table.get(ref);
        if (!existing) {
          throw new ComposeError(
            `${pid}/${file}: fieldPatch target ${ref} does not exist`,
          );
        }
        if (!mayModify(pack.manifest, ownerOf(ref))) {
          throw new ComposeError(
            `${pid}/${file}: cannot modify ${ref} without declaring ${ownerOf(ref)} as a dependency`,
          );
        }
        existing.value = applyFieldPatch(existing.value, ops);
        existing.modifiedBy.push(pid);
      }

      for (const refStr of contrib.removes ?? []) {
        const ref = refStr as PackRef;
        if (!table.has(ref)) {
          throw new ComposeError(`${pid}/${file}: remove target ${ref} does not exist`);
        }
        if (!mayModify(pack.manifest, ownerOf(ref))) {
          throw new ComposeError(
            `${pid}/${file}: cannot remove ${ref} without declaring ${ownerOf(ref)} as a dependency`,
          );
        }
        table.delete(ref);
      }
    }
  }

  return game;
}
