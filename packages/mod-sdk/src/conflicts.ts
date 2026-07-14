/**
 * The pre-launch conflict report (MOD_LIFECYCLE section 3, P7 phase 6).
 *
 * Before a session starts, the app shows the player every record touched
 * by more than one pack: which fields each pack wrote, who wins, and a
 * plain-language line for anything that actually collides. Nothing is
 * silent, nothing is a surprise at runtime.
 *
 * Two kinds of "touch" feed the report:
 *  - Field patches (patch.ts) and the coarse whole-record `patches` merge
 *    (compose.ts) both write specific fields. A record is contested when
 *    two or more distinct packs write it this way; a field is a collision
 *    only when two or more of those packs write the SAME field with an
 *    order-dependent op (composeFieldPatches decides that - reused here,
 *    not reimplemented).
 *  - A whole-record `replaces` or `removes` is always worth reporting,
 *    regardless of how many other packs touched the record: it overrides
 *    whatever the owning pack (and any patches) established, and that is
 *    exactly the kind of surprise this report exists to surface.
 *
 * Pure and deterministic: given the same (already load-ordered) pack list,
 * the report is always the same value.
 */

import type { FileContribution, JsonRecord, PackContent } from "./compose.js";
import type { FieldConflict, FieldPatch } from "./patch.js";
import { composeFieldPatches, touchedFields } from "./patch.js";

/** One field a contested record's contributing packs wrote. */
export interface FieldTouch {
  /** The dot-path written (as used by FieldOp / touchedFields). */
  path: string;
  /** Packs that wrote this field, in load order. */
  owners: string[];
  /** The pack whose write wins: the last one in load order. */
  winner: string;
}

/** A later pack overriding a record's entire body outright. */
export interface RecordOverride {
  /** The pack that performed the override (last one, if more than one did). */
  pack: string;
  kind: "replace" | "remove";
}

/** One contested record: touched by more than one pack. */
export interface RecordConflict {
  /** The record reference, e.g. "core:kobold". */
  ref: string;
  /** The file the record lives in, e.g. "monster". */
  file: string;
  /**
   * Every pack that contributed a field patch, coarse patch, replace, or
   * remove to this record, in load order. Does not include the owning
   * pack unless the owner is itself one of those contributors.
   */
  contributingPacks: string[];
  /**
   * Every field any contributing pack wrote (via fieldPatches, or a
   * top-level key of a coarse `patches` body), with who wrote it and who
   * wins. Empty when the record was only touched by a whole-record
   * replace/remove.
   */
  fields: FieldTouch[];
  /** Same-field collisions among `fields` - empty when none collided. */
  collisions: FieldConflict[];
  /** Present when a pack replaced or removed the record outright. */
  override?: RecordOverride;
  /** One plain-language line per collision and per override. */
  humanLines: string[];
}

/** The full pre-launch conflict report: contested records only. */
export interface ConflictReport {
  records: RecordConflict[];
}

/** The pack id a ref's "<owner>:<slug>" prefix names. */
function ownerOf(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? "" : ref.slice(0, at);
}

/**
 * Turn a coarse whole-record patch body into field ops, one per top-level
 * key, so it runs through the same field-conflict engine as fieldPatches:
 * nested objects merge (mirroring mergePatch), everything else - including
 * an explicit null delete - is a straight `set` for reporting purposes.
 */
function coarsePatchOps(body: JsonRecord): FieldPatch {
  const ops: FieldPatch = [];
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      ops.push({ op: "merge", path: key, value });
    } else {
      ops.push({ op: "set", path: key, value });
    }
  }
  return ops;
}

/** Per-record bookkeeping while walking the pack list once, in order. */
interface RecordEntry {
  fieldContribs: { owner: string; ops: FieldPatch }[];
  modifiers: Set<string>;
  overrides: { pack: string; kind: "replace" | "remove" }[];
}

function entryFor(
  byFile: Map<string, Map<string, RecordEntry>>,
  file: string,
  ref: string,
): RecordEntry {
  let table = byFile.get(file);
  if (!table) {
    table = new Map();
    byFile.set(file, table);
  }
  let entry = table.get(ref);
  if (!entry) {
    entry = { fieldContribs: [], modifiers: new Set(), overrides: [] };
    table.set(ref, entry);
  }
  return entry;
}

/** For every field any contributing pack wrote: who wrote it, who wins. */
function fieldBreakdown(
  contribs: ReadonlyArray<{ owner: string; ops: FieldPatch }>,
): FieldTouch[] {
  const writers = new Map<string, string[]>();
  for (const { owner, ops } of contribs) {
    for (const path of touchedFields(ops)) {
      const owners = writers.get(path) ?? [];
      if (owners[owners.length - 1] !== owner) owners.push(owner);
      writers.set(path, owners);
    }
  }
  const out: FieldTouch[] = [];
  for (const [path, owners] of writers) {
    out.push({ path, owners, winner: owners[owners.length - 1] as string });
  }
  return out;
}

/** Two, or several, pack names joined for a human sentence. */
function joinOwners(owners: readonly string[]): string {
  if (owners.length <= 1) return owners.join("");
  if (owners.length === 2) return `${owners[0]} and ${owners[1]}`;
  return `${owners.slice(0, -1).join(", ")} and ${owners[owners.length - 1]}`;
}

/** The record name half of a ref, for readable human lines ("core:kobold" -> "kobold"). */
function refName(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? ref : ref.slice(at + 1);
}

/**
 * Compute the pre-launch conflict report over an already load-ordered pack
 * list (see resolveLoadOrder). Only contested records get an entry:
 * additive changes - distinct records, or a single pack touching a record -
 * produce none.
 */
export function computeConflictReport(packs: readonly PackContent[]): ConflictReport {
  const byFile = new Map<string, Map<string, RecordEntry>>();

  for (const pack of packs) {
    const pid = pack.manifest.id;
    for (const [file, contrib] of Object.entries(pack.files) as [
      string,
      FileContribution,
    ][]) {
      for (const [ref, ops] of Object.entries(contrib.fieldPatches ?? {})) {
        const entry = entryFor(byFile, file, ref);
        entry.fieldContribs.push({ owner: pid, ops });
        entry.modifiers.add(pid);
      }
      for (const [ref, body] of Object.entries(contrib.patches ?? {})) {
        const entry = entryFor(byFile, file, ref);
        entry.fieldContribs.push({ owner: pid, ops: coarsePatchOps(body) });
        entry.modifiers.add(pid);
      }
      for (const [ref] of Object.entries(contrib.replaces ?? {})) {
        const entry = entryFor(byFile, file, ref);
        entry.modifiers.add(pid);
        entry.overrides.push({ pack: pid, kind: "replace" });
      }
      for (const ref of contrib.removes ?? []) {
        const entry = entryFor(byFile, file, ref);
        entry.modifiers.add(pid);
        entry.overrides.push({ pack: pid, kind: "remove" });
      }
    }
  }

  const records: RecordConflict[] = [];
  for (const [file, table] of byFile) {
    for (const [ref, entry] of table) {
      const hasOverride = entry.overrides.length > 0;
      if (entry.modifiers.size < 2 && !hasOverride) continue; // additive: not contested

      const { conflicts } = composeFieldPatches({}, entry.fieldContribs);
      const fields = fieldBreakdown(entry.fieldContribs);
      const humanLines: string[] = [];

      for (const conflict of conflicts) {
        const winner = conflict.owners[conflict.owners.length - 1] as string;
        const verb = conflict.owners.length === 2 ? "both set" : "all set";
        humanLines.push(
          `${joinOwners(conflict.owners)} ${verb} ${refName(ref)}.${conflict.path}; ${winner} wins - drag to reorder.`,
        );
      }

      let override: RecordOverride | undefined;
      if (hasOverride) {
        const last = entry.overrides[entry.overrides.length - 1] as {
          pack: string;
          kind: "replace" | "remove";
        };
        override = { pack: last.pack, kind: last.kind };
        const verb = last.kind === "replace" ? "replaces" : "removes";
        humanLines.push(
          `${last.pack} ${verb} ${refName(ref)} outright, overriding ${ownerOf(ref)}'s original.`,
        );
      }

      const record: RecordConflict = {
        ref,
        file,
        contributingPacks: [...entry.modifiers],
        fields,
        collisions: conflicts,
        humanLines,
      };
      if (override) record.override = override;
      records.push(record);
    }
  }

  return { records };
}
