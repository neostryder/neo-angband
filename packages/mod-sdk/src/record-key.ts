/**
 * Per-record identity for the record files whose identity is NOT a unique
 * string `name`.
 *
 * CURRENT STATE, FIRST, BECAUSE THIS COMMENT USED TO MISLEAD. Every record file
 * but ONE is addressable per record today: 24 by a unique `name`, 19 by the
 * explicit specs in this file, and `history` by nothing - and an op against
 * `history` is REPORTED, never silently dropped. Two independent reviewers read
 * the older wording, took the "the other 20 files do not fit it" paragraph below
 * for the present tense, and filed the same non-existent P1 ("20 files silently
 * discard patch/replace/remove, including object, ego_item, vault, trap, store,
 * brand, slay, projection, constants"). Those nine are precisely the files this
 * table fixes. If you are about to report that bug, run record-key.test.ts.
 *
 * AND "ADDRESSABLE PER FILE" IS NOT "EVERY RECORD ADDRESSABLE" (measured
 * 2026-08-08). Declaring a key per file left 73 individual records that NO ref
 * could name, because two or more of them claimed the same key: 61 of
 * `ego_item`'s 107 - more than half the file - plus 10 in `object` and 2 in
 * `vault`. A mod could not patch "of Acid" at all. That residue had two
 * completely different causes, and separating them is what let both be fixed
 * without inventing an identity:
 *
 *  - INFORMATION THE SLUG THREW AWAY. `slugify` drops `*` and `+`, so
 *    "*Healing*" and "Healing" - two genuinely different objects, upstream's
 *    convention for the greater form - arrived as one key. Nothing was
 *    ambiguous about the data; the KEY was lossy. `keySlug` below spells the
 *    marks out ("star", "plus") instead of dropping them. That alone accounts
 *    for every collision in `object` and `vault` and for 16 of `ego_item`'s.
 *  - GENUINELY REPEATED NAMES. `ego_item` ships "of Acid" twice, distinguished
 *    only by which item types it applies to. No amount of care with the name
 *    separates them, so a DISCRIMINATOR is declared: extra paths appended after
 *    a "#", used only to tell same-named records apart. For `ego_item` that is
 *    the item types it applies to, which is not a guess - it is upstream's own
 *    identity for an ego, `lookup_ego_item(name, tval, sval)` in obj-util.c.
 *
 * Result: 0 unaddressable records in the shipped pack, asserted in both
 * directions by record-key.test.ts.
 *
 * NOTHING THAT USED TO RESOLVE STOPPED RESOLVING. A record answers to SEVERAL
 * refs, not one (`recordRefKeys` plus `legacyRecordKey`), and the old lossy slug
 * is kept as an alias. The alias is dropped in exactly one case: when it would
 * shadow another record's primary key. That case is not hypothetical and it is
 * the whole reason the rule exists - "*Healing*"'s legacy alias IS "healing",
 * which is plain "Healing"'s primary, so keeping it would have left the plain
 * potion unaddressable while fixing the starred one. A record's own history
 * must not cost a different record its name.
 *
 * WHY THIS EXISTS
 *
 * composePacks (compose.ts) USED TO key every record by
 * `packRef(pack, slugify(name))`. That is the right identity for the 24 upstream
 * record files whose records carry a unique `name` - monster, object_property,
 * terrain and so on - and it is what made `patches` / `replaces` /
 * `fieldPatches` / `removes` work there.
 *
 * As of 2026-08-08 composePacks keys by `recordRefKeys` from this file instead,
 * so the other 20 fit it too and 41 of the 44 files merge per record. What that
 * bought is the thing a name key could not do at all: ADDING a record to
 * `object`, `ego_item` or `vault`, which before was a whole-file replacement
 * that discarded every one of core's.
 *
 * The other 20 files did not fit it, for two measured reasons (counts taken over
 * packages/content/pack on 2026-07-29). This is the problem statement, not the
 * status:
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
  | {
      readonly kind: "fields";
      readonly paths: readonly string[];
      /**
       * Extra paths that tell SAME-KEYED records apart, appended after a "#".
       *
       * Only for files that ship genuinely repeated names. A discriminated ref
       * is offered ALONGSIDE the plain one, never instead of it: a record whose
       * plain key is already unique keeps it, so declaring a discriminator can
       * only add refs. A path may resolve to an array, or to an array of
       * objects when it is dotted (`item.tval` takes `.tval` of each element),
       * because the thing that separates two records is often a LIST - which
       * item types an ego applies to. Non-scalar leaves are skipped rather than
       * stringified: a JSON blob in a ref is not something an author can type.
       */
      readonly discriminator?: readonly string[];
    }
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
  /* Files that DO have `name` but need more of the record to be unique. `object`
   * and `vault` are fully unique once the slug stops dropping "*" and "+"
   * (keySlug); `ego_item` genuinely repeats names and needs a discriminator. */
  object: { kind: "fields", paths: ["type", "name"] },
  vault: { kind: "fields", paths: ["type", "name"] },
  /* 23 ego names repeat, covering 51 of the 107 records. What separates them is
   * the item types the ego can appear on - `type` names tvals directly, `item`
   * pins specific (tval, sval) pairs, and a record uses one or the other. Both
   * are read, so "of Elvenkind" on boots and "of Elvenkind" on shields are two
   * addressable records. This mirrors lookup_ego_item(name, tval, sval), which
   * is how upstream itself tells two same-named egos apart. */
  ego_item: {
    kind: "fields",
    paths: ["name"],
    discriminator: ["type", "item.tval"],
  },
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
 * As atPath, but a path step over an ARRAY maps across it: `item.tval` on
 * `item: [{tval:"boots"}, {tval:"shield"}]` yields `["boots", "shield"]`.
 *
 * Discriminator-only, because the thing that separates two same-named records is
 * routinely a list rather than a scalar. atPath deliberately keeps its
 * scalar-or-nothing rule for the KEY itself: a key that silently spans an array
 * would change whenever the array is reordered.
 */
function atPathThroughArrays(
  record: JsonRecord,
  path: string,
): readonly JsonValue[] {
  let cur: JsonValue[] = [record];
  for (const part of path.split(".")) {
    const next: JsonValue[] = [];
    for (const node of cur) {
      if (typeof node !== "object" || node === null || Array.isArray(node)) {
        continue;
      }
      const value = (node as JsonRecord)[part];
      if (value === undefined) continue;
      if (Array.isArray(value)) next.push(...value);
      else next.push(value);
    }
    cur = next;
  }
  return cur;
}

/**
 * The slug used for a record's identity, distinct from `slugify` and
 * deliberately so.
 *
 * `slugify` builds the refs mods already write and is the ABI for the 24
 * name-composed files; it is not changed here. But it collapses every
 * non-alphanumeric run to a "-", which erases the two marks Angband uses to mean
 * "the greater form of this": "*Healing*" and "Little eruption+" arrived
 * indistinguishable from "Healing" and "Little eruption". Spelling the marks out
 * keeps the distinction inside an author-typeable ref. The old form is still
 * accepted as an alias (legacyRecordKey), so this widens what resolves rather
 * than moving it.
 */
function keySlug(value: string): string {
  return slugify(value.replace(/\*/g, " star ").replace(/\+/g, " plus "));
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
  return baseKey(file, record, spec, keySlug);
}

/** The base key under one slug function; the two callers differ only in that. */
function baseKey(
  file: string,
  record: unknown,
  spec: RecordKeySpec,
  slug: (value: string) => string,
): string | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return null;
  }
  if (spec.kind === "singleton") return slug(file);
  const parts: string[] = [];
  for (const path of spec.paths) {
    const value = atPath(record as JsonRecord, path);
    if (typeof value !== "string" && typeof value !== "number") return null;
    const part = slug(String(value));
    if (part.length === 0) return null;
    parts.push(part);
  }
  return parts.join("--");
}

/**
 * The discriminating half of a ref: the declared discriminator paths, flattened
 * through arrays and joined. Empty string when the file declares none or the
 * record carries nothing at those paths - which is normal, since a
 * discriminator only has to separate the records that need separating.
 */
function discriminatorOf(record: JsonRecord, spec: RecordKeySpec): string {
  if (spec.kind !== "fields" || spec.discriminator === undefined) return "";
  const parts: string[] = [];
  for (const path of spec.discriminator) {
    const values = atPathThroughArrays(record, path)
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .map((v) => keySlug(String(v)))
      .filter((s) => s.length > 0);
    if (values.length > 0) parts.push(values.join("-"));
  }
  return parts.join("--");
}

/**
 * EVERY ref a record answers to, in preference order: the base key first, then
 * the discriminated form when the file declares a discriminator and this record
 * carries one.
 *
 * A list rather than a single key because addressing is a lookup, not a naming
 * ceremony. The base key is what an author writes when it is unambiguous; the
 * discriminated form is what they fall back to when core ships the name twice,
 * and the loader's refusal message hands them the exact string. Offering both
 * means declaring a discriminator can never take a working ref away.
 *
 * Empty when the record has no derivable identity at all.
 */
export function recordRefKeys(
  file: string,
  record: unknown,
  spec: RecordKeySpec = keySpecFor(file),
): readonly string[] {
  const base = recordKey(file, record, spec);
  if (base === null) return [];
  const disc = discriminatorOf(record as JsonRecord, spec);
  return disc === "" ? [base] : [base, `${base}#${disc}`];
}

/**
 * The pre-2026-08-08 key for this record - the one built with plain `slugify`,
 * before the "*"/"+" marks were preserved - or null when it is identical to the
 * current base key, which is the case for all but 17 records in the shipped
 * pack.
 *
 * Kept so a ref written against an older engine still resolves. It is an ALIAS:
 * the loader registers it only where it does not shadow another record's primary
 * key (see the header), because "*Healing*"'s legacy key is plain "Healing"'s
 * real one.
 */
export function legacyRecordKey(
  file: string,
  record: unknown,
  spec: RecordKeySpec = keySpecFor(file),
): string | null {
  const legacy = baseKey(file, record, spec, slugify);
  if (legacy === null) return null;
  return legacy === recordKey(file, record, spec) ? null : legacy;
}

/** A human phrase for what a file's identity is, for problem messages. */
export function keyDescription(file: string): string {
  const spec = keySpecFor(file);
  if (spec.kind === "singleton") {
    return `the whole file (one config record, ref "<pack>:${slugify(file)}")`;
  }
  const base = spec.paths.join(" + ");
  return spec.discriminator === undefined
    ? base
    : `${base}, or ${base} + "#" + ${spec.discriminator.join(" + ")} where core ships the name twice`;
}
