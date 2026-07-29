/**
 * Field-level patch composition (MOD_LIFECYCLE section 3, P7 phase 3).
 *
 * The coarse `patches` path in compose.ts deep-merges whole record bodies:
 * simple, but two mods touching one record always look like they collide even
 * when they change unrelated fields. The field-level model fixes that. A patch
 * is an ordered list of field operations - `set`, `merge`, `addFlag`,
 * `removeFlag`, `add`, `mul` - each addressing a dot-path into the record.
 * Patches from different packs apply in load order; two packs that touch
 * DIFFERENT fields compose with zero conflict, and only a genuine same-field
 * collision is reported (then load order decides who wins, and the app says
 * so). This is the finer lever the ratified design calls for, and it is the
 * data the conflict report (phase 6) reads.
 *
 * Pure and deterministic: given a base record and an ordered patch list the
 * output and the conflict set are fully determined.
 */

import type { JsonRecord, JsonValue } from "./compose.js";
import { mergePatch } from "./compose.js";

export class PatchError extends Error {}

/** One field operation, addressing `path` (a dot-path into the record). */
export type FieldOp =
  /** Replace the value at path outright. */
  | { op: "set"; path: string; value: JsonValue }
  /** Deep-merge an object value into the object at path (compose.mergePatch). */
  | { op: "merge"; path: string; value: JsonRecord }
  /** Ensure `flag` is present in the string array at path (set union). */
  | { op: "addFlag"; path: string; flag: string }
  /** Remove `flag` from the string array at path, if present. */
  | { op: "removeFlag"; path: string; flag: string }
  /** Add a number to the numeric value at path (missing = 0). */
  | { op: "add"; path: string; value: number }
  /** Multiply the numeric value at path (missing = 0). */
  | { op: "mul"; path: string; value: number };

/** An ordered list of field operations - one pack's patch of one record. */
export type FieldPatch = FieldOp[];

/** The flag ops compose as set operations; the rest are order-dependent. */
function isCommutative(op: FieldOp["op"]): boolean {
  return op === "addFlag" || op === "removeFlag";
}

/* ------------------------------------------------------------------ *
 * Dot-path access.
 *
 * A path segment that is a run of digits indexes an ARRAY ("level-max.0.value").
 * Array traversal is not a convenience: a great deal of upstream gamedata is
 * label/value lists rather than objects - every section of constants.json, a
 * store's owner list, a body's slot list, the visuals flicker table - so without
 * it a fieldPatch into those files could not address anything. Worse, the first
 * version of setPath treated an existing array as an unusable intermediate and
 * REPLACED it with a fresh object, which turned `set level-max.0.value` into
 * silent destruction of the whole list. Objects still win when the container is
 * an object, so a literal "0" key is unaffected.
 * ------------------------------------------------------------------ */

/** A path segment as an array index, or null when it is a plain object key. */
function arrayIndex(part: string): number | null {
  return /^(?:0|[1-9][0-9]*)$/.test(part) ? Number(part) : null;
}

/** One step down a path, through either an object key or an array index. */
function childOf(cur: JsonValue | undefined, part: string): JsonValue | undefined {
  if (Array.isArray(cur)) {
    const at = arrayIndex(part);
    return at === null ? undefined : cur[at];
  }
  if (typeof cur === "object" && cur !== null) return (cur as JsonRecord)[part];
  return undefined;
}

function getPath(record: JsonRecord, path: string): JsonValue | undefined {
  let cur: JsonValue | undefined = record;
  for (const part of path.split(".")) {
    cur = childOf(cur, part);
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Write one slot of an object or an array container. */
function assignAt(
  container: JsonRecord | JsonValue[],
  part: string,
  value: JsonValue,
): void {
  if (Array.isArray(container)) {
    const at = arrayIndex(part);
    if (at === null) {
      throw new PatchError(
        `patch: "${part}" is not an array index, and the value at that point is an array`,
      );
    }
    container[at] = value;
    return;
  }
  container[part] = value;
}

/**
 * Set a value at a dot-path, creating intermediate containers as needed. A
 * created container is an array when the next segment is an index and an object
 * otherwise, so `set a.0.b` on a record with no `a` builds `{a:[{b:...}]}`.
 */
function setPath(record: JsonRecord, path: string, value: JsonValue): void {
  const parts = path.split(".");
  let cur: JsonRecord | JsonValue[] = record;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    const next = childOf(cur as JsonValue, part);
    if (typeof next !== "object" || next === null) {
      const fresh: JsonValue =
        arrayIndex(parts[i + 1] as string) === null ? {} : [];
      assignAt(cur, part, fresh);
      cur = fresh as JsonRecord | JsonValue[];
    } else {
      cur = next as JsonRecord | JsonValue[];
    }
  }
  assignAt(cur, parts[parts.length - 1] as string, value);
}

/* ------------------------------------------------------------------ *
 * Applying a single patch.
 * ------------------------------------------------------------------ */

/** Apply one field patch to a record, returning a new record (pure). */
export function applyFieldPatch(record: JsonRecord, ops: FieldPatch): JsonRecord {
  const out = structuredJsonClone(record);
  for (const op of ops) applyOp(out, op);
  return out;
}

function applyOp(record: JsonRecord, op: FieldOp): void {
  switch (op.op) {
    case "set":
      setPath(record, op.path, op.value);
      return;
    case "merge": {
      const cur = getPath(record, op.path);
      const base =
        typeof cur === "object" && cur !== null && !Array.isArray(cur)
          ? (cur as JsonRecord)
          : {};
      setPath(record, op.path, mergePatch(base, op.value));
      return;
    }
    case "addFlag": {
      const list = asFlagList(getPath(record, op.path), op.path);
      if (!list.includes(op.flag)) list.push(op.flag);
      setPath(record, op.path, list);
      return;
    }
    case "removeFlag": {
      const list = asFlagList(getPath(record, op.path), op.path);
      setPath(
        record,
        op.path,
        list.filter((f) => f !== op.flag),
      );
      return;
    }
    case "add": {
      const cur = getPath(record, op.path);
      const n = typeof cur === "number" ? cur : 0;
      setPath(record, op.path, n + op.value);
      return;
    }
    case "mul": {
      const cur = getPath(record, op.path);
      const n = typeof cur === "number" ? cur : 0;
      setPath(record, op.path, n * op.value);
      return;
    }
  }
}

/** A flag field must be a string array (or absent, treated as empty). */
function asFlagList(value: JsonValue | undefined, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new PatchError(`patch: field ${path} is not a flag list (string[])`);
  }
  return [...(value as string[])];
}

/** A structural JSON clone (no Date.now/Math.random dependence). */
function structuredJsonClone(record: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(record)) as JsonRecord;
}

/* ------------------------------------------------------------------ *
 * Composing ordered patches with conflict detection.
 * ------------------------------------------------------------------ */

/** One same-field collision between two or more packs. */
export interface FieldConflict {
  /** The dot-path both packs wrote. */
  path: string;
  /** The packs that wrote it, in load order (last one wins the value). */
  owners: string[];
}

/** The result of composing several packs' patches over one base record. */
export interface ComposedPatch {
  /** The merged record (all patches applied in load order). */
  value: JsonRecord;
  /** Same-field collisions, empty when every pack touched distinct fields. */
  conflicts: FieldConflict[];
}

/**
 * Compose several packs' field patches over a base record, applying them in
 * the given (load) order and reporting same-field collisions. A field is a
 * conflict when two or more distinct packs write it with an order-dependent op
 * (set / merge / add / mul); pure flag ops (addFlag / removeFlag) compose as
 * set operations and never conflict on their own.
 */
export function composeFieldPatches(
  base: JsonRecord,
  patches: ReadonlyArray<{ owner: string; ops: FieldPatch }>,
): ComposedPatch {
  let value = structuredJsonClone(base);
  /* path -> the owners who wrote it, and whether any write was order-dependent. */
  const writers = new Map<string, { owners: string[]; ordered: boolean }>();

  for (const { owner, ops } of patches) {
    value = applyFieldPatch(value, ops);
    for (const op of ops) {
      const entry = writers.get(op.path) ?? { owners: [], ordered: false };
      if (entry.owners[entry.owners.length - 1] !== owner) {
        entry.owners.push(owner);
      }
      if (!isCommutative(op.op)) entry.ordered = true;
      writers.set(op.path, entry);
    }
  }

  const conflicts: FieldConflict[] = [];
  for (const [path, entry] of writers) {
    if (entry.ordered && entry.owners.length > 1) {
      conflicts.push({ path, owners: entry.owners });
    }
  }
  return { value, conflicts };
}

/** The set of dot-paths a patch writes (for external conflict analysis). */
export function touchedFields(ops: FieldPatch): Set<string> {
  const out = new Set<string>();
  for (const op of ops) out.add(op.path);
  return out;
}
