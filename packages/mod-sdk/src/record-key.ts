/**
 * Per-record identity for the record files whose identity is NOT a unique
 * string `name`.
 *
 * WHY THIS EXISTS
 *
 * composePacks (compose.ts) keys every record by `packRef(pack, slugify(name))`.
 * That is the right identity for the 24 upstream record files whose records
 * carry a unique `name` - monster, object_property, terrain and so on - and it
 * is what makes `patches` / `replaces` / `fieldPatches` / `removes` work there.
 *
 * The other 20 files do not fit it, for two measured reasons (counts taken over
 * packages/content/pack on 2026-07-29):
 *
 *  - 14 files have no string `name` at all. Their identity lives somewhere else:
 *    `code` (brand, slay, chest_trap, projection), the tval half of a composite
 *    (`object_base`), the upstream `name:<name>:<desc>` line (trap), an index
 *    (pain, names), a plain other field (store, ui_knowledge, body, world,
 *    flavor, hints), or nowhere at all because the file is a single config
 *    singleton (constants, visuals).
 *  - 6 files DO have `name` but core's own data slugs two records to the same
 *    ref, mostly because slugify drops `*` and `+`: object has 5 such pairs
 *    ("Acquirement" / "*Acquirement*"), vault 1 ("Little eruption" /
 *    "Little eruption+"), and brand / slay / chest_trap name several records
 *    after the element rather than the variant. ego_item is the genuine case:
 *    "of Acid" exists twice, distinguished only by which item types it applies
 *    to - which are the very fields a mod would patch, so they cannot be part of
 *    its identity.
 *
 * Before this file existed, a per-record op against any of those 20 was
 * SILENTLY DROPPED (loader.ts stripped the whole contribution before compose saw
 * it). This table is what makes 19 of them addressable, and it is deliberately
 * an EXPLICIT declaration rather than a heuristic: guessing a key would trade a
 * silent drop for a silent mis-merge, which is worse. Every entry below was
 * verified unique over the shipped core pack (see record-key.test.ts, which
 * reads the real pack and fails if a declared key stops being unique).
 *
 * `history` is deliberately absent: a history record is
 * `{chart:{chart,next,roll}, phrase}` and every part of that is a value a mod
 * would legitimately change, so it has no identity to key on. An op against it
 * is REPORTED, not applied - see loader.ts.
 *
 * AMBIGUITY IS NAMED, NEVER GUESSED. A key that two records in the same file
 * claim (object's 5 pairs, ego_item's 25) makes that one ref unaddressable; the
 * records stay in the game and any op naming the ref becomes a reported problem.
 * The rest of the file remains addressable per record.
 */

import { slugify } from "./manifest.js";
import type { JsonRecord, JsonValue } from "./compose.js";

/**
 * How to derive one record's identity within a file.
 *
 * - `fields`: slugify each dot-path in order and join with "--". Every path must
 *   resolve to a string or a number; anything else (absent, object, array) means
 *   the record has no derivable key and is simply not addressable.
 * - `singleton`: the file holds exactly one config record, so the FILE is the
 *   identity (ref `<pack>:<file>`). A second record in such a file collides with
 *   the first and both become unaddressable, which is the correct answer - the
 *   host binds one.
 */
export type RecordKeySpec =
  | { readonly kind: "fields"; readonly paths: readonly string[] }
  | { readonly kind: "singleton" };

/**
 * The identity of every record file that is NOT keyed by a unique string `name`.
 *
 * A file absent from this table is keyed by `name`, which is what composePacks
 * already does. Keys here are file stems, exactly as they appear in a pack
 * folder (`brand.json` -> `brand`).
 */
export const RECORD_KEY_SPECS: Readonly<Record<string, RecordKeySpec>> = {
  /* `code` is the upstream identity; `name` names the element, so ACID_2 and
   * ACID_3 both slug to "acid". */
  brand: { kind: "fields", paths: ["code"] },
  slay: { kind: "fields", paths: ["code"] },
  chest_trap: { kind: "fields", paths: ["code"] },
  /* projection: `code` is on all 56 records, `name` is not. */
  projection: { kind: "fields", paths: ["code"] },
  /* object_base: `name` is the composite {tval, name}; tval is the key upstream
   * looks bases up by. */
  object_base: { kind: "fields", paths: ["name.tval"] },
  /* trap: `name` is the composite {name, desc} - upstream's `name:<name>:<desc>`
   * line. The display half repeats (6 records are "strange rune"); the pair is
   * unique. */
  trap: { kind: "fields", paths: ["name.name", "name.desc"] },
  /* store: the STORE_* code. */
  store: { kind: "fields", paths: ["store"] },
  /* pain: the message-set index, which IS its identity (mon_pain_msg). */
  pain: { kind: "fields", paths: ["type"] },
  ui_knowledge: { kind: "fields", paths: ["monster-category"] },
  /* names: the random-name section index. */
  names: { kind: "fields", paths: ["section"] },
  body: { kind: "fields", paths: ["body"] },
  /* world: the level's name, which is what upstream's up/down links reference. */
  world: { kind: "fields", paths: ["level.name"] },
  /* flavor: one record per object base, keyed by that base's tval. */
  flavor: { kind: "fields", paths: ["kind.tval"] },
  /* hints: the hint text is the whole record, so it is also its identity. */
  hints: { kind: "fields", paths: ["H"] },
  /* Config singletons: one record for the whole file. */
  constants: { kind: "singleton" },
  visuals: { kind: "singleton" },
  /* Files that DO have `name` but need more of the record to be unique. Each is
   * still not fully unique (see the header) - the residual collisions are
   * reported, never guessed. */
  object: { kind: "fields", paths: ["type", "name"] },
  vault: { kind: "fields", paths: ["type", "name"] },
  ego_item: { kind: "fields", paths: ["name"] },
};

/**
 * Files with a declared key spec, sorted. Exported so a test can assert the set
 * in BOTH directions (a file wrongly added and a file wrongly removed).
 */
export const KEYED_RECORD_FILES: readonly string[] =
  Object.keys(RECORD_KEY_SPECS).sort();

/** The key spec for a file: the declared one, or `name` by default. */
export function keySpecFor(file: string): RecordKeySpec {
  return RECORD_KEY_SPECS[file] ?? { kind: "fields", paths: ["name"] };
}

function atPath(record: JsonRecord, path: string): JsonValue | undefined {
  let cur: JsonValue | undefined = record;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as JsonRecord)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * The slug half of a record's ref within `file`, or null when this record has no
 * derivable identity (a missing key field, or a key field that is not a scalar).
 * Null means "not addressable"; it never means "drop the record".
 */
export function recordKey(
  file: string,
  record: unknown,
  spec: RecordKeySpec = keySpecFor(file),
): string | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return null;
  }
  if (spec.kind === "singleton") return slugify(file);
  const parts: string[] = [];
  for (const path of spec.paths) {
    const value = atPath(record as JsonRecord, path);
    if (typeof value !== "string" && typeof value !== "number") return null;
    const slug = slugify(String(value));
    if (slug.length === 0) return null;
    parts.push(slug);
  }
  return parts.join("--");
}

/** A human phrase for what a file's identity is, for problem messages. */
export function keyDescription(file: string): string {
  const spec = keySpecFor(file);
  return spec.kind === "singleton"
    ? `the whole file (one config record, ref "<pack>:${slugify(file)}")`
    : spec.paths.join(" + ");
}
