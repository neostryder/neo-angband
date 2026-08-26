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
  | { op: "mul"; path: string; value: number }
  /**
   * Append values to the array at path (missing = []), preserving what is
   * already there. This is the op that lets a mod add ONE entry to a list -
   * an item to a store's `normal` stock table, an owner to a store, a blow to
   * a monster - without restating the list, so two mods can both add to the
   * same list and neither loses. Duplicates are kept: a list is not a set, and
   * a store's stock table uses repetition as weighting.
   */
  | { op: "append"; path: string; values: JsonValue[] }
  /**
   * Remove every entry deep-equal to `value` from the array at path. The
   * counterpart to `append`, so a mod can take an entry OUT of a list. Unlike
   * `append` this is order-dependent, because it can erase another pack's
   * appended entry - which is exactly the same-resource collision load order
   * is meant to settle, so it is reported as a conflict.
   */
  | { op: "removeValue"; path: string; value: JsonValue };

/** An ordered list of field operations - one pack's patch of one record. */
export type FieldPatch = FieldOp[];

/**
 * Which ops compose without anybody losing a contribution. The flag ops are
 * set operations; `append` is pure addition - two packs appending to one list
 * both keep their entries, so a shared list is NOT a collision the way a
 * shared scalar is. Everything else is order-dependent and a second writer
 * means load order decides.
 */
function isCommutative(op: FieldOp["op"]): boolean {
  return op === "addFlag" || op === "removeFlag" || op === "append";
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

/**
 * A path segment naming an inherited Object.prototype property. `cur[part]`
 * for one of these resolves through the prototype chain instead of an own
 * property, so an unguarded read exposes `Object.prototype` itself, and an
 * unguarded write on the far end of a `set`/`merge` path pollutes it -
 * see NA-CORE-002. Rejected outright, at every path-walking entry point,
 * rather than merely skipped, so a mod-authored path cannot silently target
 * the wrong thing.
 */
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function checkPathSegment(part: string, path: string): void {
  if (UNSAFE_PATH_SEGMENTS.has(part)) {
    throw new PatchError(`patch: "${part}" is not an allowed path segment in "${path}"`);
  }
}

/** One step down a path, through either an object key or an array index. */
function childOf(cur: JsonValue | undefined, part: string, path: string): JsonValue | undefined {
  checkPathSegment(part, path);
  if (Array.isArray(cur)) {
    const at = arrayIndex(part);
    return at === null ? undefined : cur[at];
  }
  if (typeof cur === "object" && cur !== null) {
    return Object.hasOwn(cur, part) ? (cur as JsonRecord)[part] : undefined;
  }
  return undefined;
}

function getPath(record: JsonRecord, path: string): JsonValue | undefined {
  let cur: JsonValue | undefined = record;
  for (const part of path.split(".")) {
    cur = childOf(cur, part, path);
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Write one slot of an object or an array container. */
function assignAt(
  container: JsonRecord | JsonValue[],
  part: string,
  value: JsonValue,
  path: string,
): void {
  checkPathSegment(part, path);
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
    const next = childOf(cur as JsonValue, part, path);
    if (typeof next !== "object" || next === null) {
      const fresh: JsonValue =
        arrayIndex(parts[i + 1] as string) === null ? {} : [];
      assignAt(cur, part, fresh, path);
      cur = fresh as JsonRecord | JsonValue[];
    } else {
      cur = next as JsonRecord | JsonValue[];
    }
  }
  assignAt(cur, parts[parts.length - 1] as string, value, path);
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
      if (Array.isArray(cur)) {
        throw new PatchError(
          `patch: cannot merge into field ${op.path}, which is a list - ` +
            `use "append" to add entries, or "set" to replace the whole list`,
        );
      }
      const base =
        typeof cur === "object" && cur !== null ? (cur as JsonRecord) : {};
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
      const n = asNumber(getPath(record, op.path), op.path, "add");
      setPath(record, op.path, n + op.value);
      return;
    }
    case "mul": {
      const n = asNumber(getPath(record, op.path), op.path, "mul");
      setPath(record, op.path, n * op.value);
      return;
    }
    case "append": {
      /*
       * A TYPO HERE IS NOT A TypeError. `values` is required by the FieldOp
       * type, but an op arrives as JSON and nothing checks its FIELDS the way
       * the default arm below checks its op NAME - so `{"op":"append",
       * "path":..., "value":[...]}` (singular, the field `set`/`add`/`mul`
       * actually use) reached `list.push(...op.values)` with `op.values`
       * undefined, and spreading `undefined` is a bare TypeError with no
       * mention of the op, the path, or the typo that caused it.
       */
      if (!Array.isArray(op.values)) {
        const sawValueInstead = Object.hasOwn(op, "value") ? ` (this op has "value" instead)` : "";
        throw new PatchError(
          `patch: "append" at ${op.path} needs a "values" array${sawValueInstead}`,
        );
      }
      const list = asList(getPath(record, op.path), op.path, "append");
      list.push(...op.values);
      setPath(record, op.path, list);
      return;
    }
    case "removeValue": {
      const list = asList(getPath(record, op.path), op.path, "removeValue");
      const target = JSON.stringify(op.value);
      setPath(
        record,
        op.path,
        list.filter((v) => JSON.stringify(v) !== target),
      );
      return;
    }
    default:
      /*
       * A TYPO IS NOT A NO-OP. The switch above is exhaustive over FieldOp, so
       * TypeScript never reaches here - but a mod's ops arrive as JSON, and
       * nothing between the file and this function checks the op NAME. Without
       * this arm `{"op": "apend"}` fell out of the switch, changed nothing, and
       * left `composeContentPacks` reporting no problems at all: the author's
       * patch simply did not happen and the game said everything was fine.
       * There are eight op names now and two of them are new, so the odds of
       * that misspelling went up rather than down.
       */
      throw new PatchError(
        `patch: unknown op ${JSON.stringify((op as { op: unknown }).op)} at ` +
          `${JSON.stringify((op as { path?: unknown }).path ?? "")} - expected one of ` +
          `set, merge, addFlag, removeFlag, add, mul, append, removeValue`,
      );
  }
}

/**
 * The numeric value at a path, treating ABSENT as 0 but refusing a value that
 * is present and not a number. Coercing those to 0 silently destroyed data: an
 * `add` aimed at a list path replaced the whole list with a number, and an
 * earlier documentation example did exactly that while the composer reported no
 * problems at all. A wrong path is now an error rather than a quiet deletion.
 */
function asNumber(value: JsonValue | undefined, path: string, op: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number") {
    throw new PatchError(
      `patch: cannot ${op} field ${path}, which is ${describe(value)}, not a number`,
    );
  }
  return value;
}

/** The array at a path (absent = empty), copied so the base record is untouched. */
function asList(value: JsonValue | undefined, path: string, op: string): JsonValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PatchError(
      `patch: cannot ${op} field ${path}, which is ${describe(value)}, not a list`,
    );
  }
  return [...value];
}

/** A value's shape, for an error message that says what was actually there. */
function describe(value: JsonValue): string {
  if (Array.isArray(value)) return "a list";
  if (value === null) return "null";
  if (typeof value === "object") return "an object";
  return `${typeof value} (${JSON.stringify(value)})`;
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
