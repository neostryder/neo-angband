/**
 * Regenerate `packages/mod-sdk/src/blueprints.ts` from the shipped core pack.
 *
 * WHAT A BLUEPRINT IS. For one record file: how many records it has, and for
 * every field - nested fields included - how many records carry it, which JSON
 * shapes it takes, and, when the field only ever holds a handful of distinct
 * scalars, what those are. That is enough to answer the three questions a mod
 * author actually has when adding a new record: what MUST I write, what MAY I
 * write, and what are the legal values.
 *
 * DERIVED, NOT DECLARED, for the same reason CORE_RECORD_KEYS is: core's own
 * gamedata is what exercises core's parser, so a hand-written schema would be a
 * second source of truth that drifts. "Required" here therefore means "every one
 * of core's 375 objects has it", which is a measurement, not an opinion - and
 * blueprints.test.ts re-derives the whole table from the pack and fails in both
 * directions.
 *
 * THE ENUMERATIONS ARE ADVISORY AND MUST STAY THAT WAY. `type` on an object
 * takes 20 distinct values in core's data, and a mod adding a 21st tval
 * alongside its own object_base record is doing something legal. So a value
 * outside the observed set is a HINT, never an error; where the field is
 * actually a reference into another file, authoring.ts checks the reference
 * against core PLUS the mod's own records, which is the check that can be
 * strict without being wrong.
 *
 *   node packages/mod-sdk/scripts/gen-blueprints.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packDir = fileURLToPath(new URL("../../content/pack", import.meta.url));

/** Distinct values at or below this count are recorded as the observed set. */
const ENUM_MAX = 32;
/**
 * Below this many observations a small distinct set is a coincidence, not a
 * vocabulary. `curse.name` appears on two objects and both say "teleportation";
 * listing that as core's values would read as a closed set of one.
 */
const ENUM_MIN_COUNT = 8;
/** How deep into nested objects/arrays a blueprint describes. */
const DEPTH_MAX = 3;

function shapeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "object";
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" || t === "object" ? t : "any";
}

/** A mutable accumulator per field, folded into a FieldShape at the end. */
function newAcc() {
  return {
    count: 0,
    types: new Set(),
    values: new Set(),
    scalarOnly: true,
    kids: new Map(),
    items: null,
    numbers: [],
  };
}

function observe(acc, value, depth) {
  acc.count += 1;
  const shape = shapeOf(value);
  acc.types.add(shape);
  /* STRINGS AND BOOLEANS ONLY. Every small numeric set in this data is
   * coincidental - `armor.ac` happens to take 30 distinct values across 222
   * records and is plainly a number, not a vocabulary - so recording it would
   * hand an author a list of "core's values" for a field that has none. The
   * string sets that matter (tvals, colours, slay codes, blow methods) are real
   * vocabularies. A field that is EVER a number gives up its set entirely,
   * rather than reporting the string half of a mixed field as though it were
   * the whole. */
  if (shape === "string" || shape === "boolean") {
    if (acc.values.size <= ENUM_MAX) acc.values.add(value);
  } else {
    acc.scalarOnly = false;
    /* Numbers get a RANGE instead of a set. "cost is 0 to 400000, typically
     * 150" is the answer to the question a set of 30 arbitrary costs cannot
     * answer, and it is what suggestFields falls back on when there are no
     * peers to measure. */
    if (shape === "number") acc.numbers.push(value);
  }
  if (depth >= DEPTH_MAX) return;
  /* An array is described by its ELEMENTS, recursively and in their own right:
   * `blow: [{method, effect}]` should tell an author about `method`, and
   * `slay: ["ORC_3"]` should tell them the slay codes. Both fall out of running
   * the same accumulator one level down. */
  if (shape === "array") {
    acc.items ??= newAcc();
    for (const element of value) observe(acc.items, element, depth + 1);
  } else if (shape === "object" && value !== null) {
    observeRecord(acc.kids, value, depth + 1);
  }
}

function observeRecord(kids, record, depth) {
  for (const [key, value] of Object.entries(record)) {
    let acc = kids.get(key);
    if (acc === undefined) {
      acc = newAcc();
      kids.set(key, acc);
    }
    observe(acc, value, depth);
  }
}

function foldAcc(acc) {
  const out = { count: acc.count, types: [...acc.types].sort() };
  if (acc.kids.size > 0) out.fields = foldKids(acc.kids);
  if (acc.items !== null) out.items = foldAcc(acc.items);
  if (acc.numbers.length > 0) {
    const sorted = [...acc.numbers].sort((a, b) => a - b);
    out.range = {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)],
    };
  }
  /* Record the set only when every observation was a scalar string, the set
   * stayed small, and there were enough observations for "small" to mean
   * something. A set that overflowed ENUM_MAX is not a vocabulary and
   * pretending it is would hand an author a truncated list of legal values. */
  if (
    acc.scalarOnly &&
    acc.count >= ENUM_MIN_COUNT &&
    acc.values.size > 0 &&
    acc.values.size <= ENUM_MAX
  ) {
    out.values = [...acc.values].sort((a, b) => String(a).localeCompare(String(b)));
  }
  return out;
}

function foldKids(kids) {
  const out = {};
  for (const key of [...kids.keys()].sort()) out[key] = foldAcc(kids.get(key));
  return out;
}

const blueprints = {};
const rawRecords = {};
for (const file of readdirSync(packDir).filter((f) => f.endsWith(".json")).sort()) {
  const stem = file.replace(/\.json$/, "");
  const raw = JSON.parse(readFileSync(`${packDir}/${file}`, "utf8"));
  const records = Array.isArray(raw) ? raw : raw.records;
  if (!Array.isArray(records)) continue;
  const objects = records.filter((r) => r !== null && typeof r === "object" && !Array.isArray(r));
  if (objects.length === 0) continue;
  rawRecords[stem] = objects;
  const kids = new Map();
  for (const r of objects) observeRecord(kids, r, 0);
  blueprints[stem] = { records: objects.length, fields: foldKids(kids, objects.length) };
}

function lit(value) {
  return JSON.stringify(value);
}

function emitShape(shape, indent) {
  const pad = " ".repeat(indent);
  const parts = [`${pad}  count: ${String(shape.count)},`, `${pad}  types: [${shape.types.map(lit).join(", ")}],`];
  if (shape.values !== undefined) {
    parts.push(`${pad}  values: [${shape.values.map(lit).join(", ")}],`);
  }
  if (shape.range !== undefined) {
    parts.push(
      `${pad}  range: { min: ${String(shape.range.min)}, max: ${String(shape.range.max)}, ` +
        `median: ${String(shape.range.median)} },`,
    );
  }
  if (shape.items !== undefined) {
    parts.push(`${pad}  items: {`);
    parts.push(emitShape(shape.items, indent + 2));
    parts.push(`${pad}  },`);
  }
  if (shape.fields !== undefined) {
    parts.push(`${pad}  fields: {`);
    for (const [key, kid] of Object.entries(shape.fields)) {
      parts.push(`${pad}    ${lit(key)}: {`);
      parts.push(emitShape(kid, indent + 4));
      parts.push(`${pad}    },`);
    }
    parts.push(`${pad}  },`);
  }
  return parts.join("\n");
}

const body = Object.entries(blueprints)
  .map(([stem, bp]) => {
    const fields = Object.entries(bp.fields)
      .map(([key, shape]) => `      ${lit(key)}: {\n${emitShape(shape, 6)}\n      },`)
      .join("\n");
    return (
      `  ${lit(stem)}: {\n` +
      `    file: ${lit(stem)},\n` +
      `    records: ${String(bp.records)},\n` +
      `    fields: {\n${fields}\n    },\n` +
      `  },`
    );
  })
  .join("\n");

const out = `/**
 * What core's own records look like, field by field.
 *
 * GENERATED by scripts/gen-blueprints.mjs from packages/content/pack. Do not
 * edit by hand; blueprints.test.ts re-derives it from the shipped pack and
 * fails in both directions.
 *
 * \`count\` is how many of the file's records carry the field, so
 * \`count === records\` is the definition of REQUIRED used throughout - a
 * measurement of core's data rather than a hand-written schema that would
 * drift. \`values\` appears only where a field holds a small closed set of
 * scalars in core's data, and it is ADVISORY: a mod adding a new tval or a new
 * slay code is doing something legal, so an unlisted value is a hint. See
 * authoring.ts, which is where the blueprint becomes advice.
 */

import type { FieldType } from "./fields.js";

/** What core's data shows about one field, at one position in a record. */
export interface FieldShape {
  /** How many of the file's records carry it. Equal to \`records\` means required. */
  readonly count: number;
  /** Every JSON shape core's data uses for it, sorted. */
  readonly types: readonly FieldType[];
  /**
   * What core's numbers span here, when the field is ever a number. A RANGE
   * rather than a set, because every small numeric set in this data is
   * coincidental - see gen-blueprints.mjs. \`median\` is core's typical value
   * and is what a scaffolder offers as a starting point.
   */
  readonly range?: { readonly min: number; readonly max: number; readonly median: number };
  /** Nested fields, when the value is an object. */
  readonly fields?: Readonly<Record<string, FieldShape>>;
  /** The elements, described in their own right, when the value is an array. */
  readonly items?: FieldShape;
  /**
   * The distinct string values core's data uses here, when there are few enough
   * for that to be a vocabulary rather than a coincidence. ADVISORY - a mod
   * coining a new tval, slay code or colour is doing something legal.
   */
  readonly values?: readonly (string | boolean)[];
}

/** One record file, as core's own data describes it. */
export interface RecordBlueprint {
  readonly file: string;
  readonly records: number;
  readonly fields: Readonly<Record<string, FieldShape>>;
}

/** file stem -> the blueprint measured from core's shipped records. */
export const RECORD_BLUEPRINTS: Readonly<Record<string, RecordBlueprint>> = {
${body}
};
`;

const dest = fileURLToPath(new URL("../src/blueprints.ts", import.meta.url));
writeFileSync(dest, out, "utf8");
const fieldCount = Object.values(blueprints).reduce((n, b) => n + Object.keys(b.fields).length, 0);
console.log(
  `wrote ${String(Object.keys(blueprints).length)} files, ` +
    `${String(fieldCount)} top-level fields, ` +
    `${String(Object.values(rawRecords).reduce((n, r) => n + r.length, 0))} records read`,
);
