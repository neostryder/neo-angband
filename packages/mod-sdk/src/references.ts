/**
 * Which fields of a record NAME another record, and where that name resolves.
 *
 * WHAT THIS IS FOR. The single most common way a new record silently does
 * nothing is that it names something that is not there: a monster whose `base`
 * is misspelled, an ego on a tval no object_base declares, an artifact built on
 * a base object the mod forgot to add. Composition cannot catch that - every
 * one of those is a perfectly well-formed string - and the game finds out at
 * bind time, by which point the author is looking at an absence rather than an
 * error. This table is what lets `checkRecords` say "monster 'sludge fiend'
 * names base 'oooze', and no loaded pack defines it".
 *
 * DECLARED, NOT INFERRED, unlike blueprints.ts. A heuristic ("this field's
 * values are a subset of that file's names, so it must be a reference") would
 * find most of these and would also find coincidences, and a WRONG edge is
 * worse than a missing one - it invents errors in data that works. So the edges
 * are written down, and references.test.ts measures every one of them against
 * core's own 3,279 records: an edge that does not resolve is a bug in this
 * table, and the handful of records that genuinely do not resolve are pinned by
 * count so the exceptions cannot quietly grow.
 *
 * THE EXCEPTIONS ARE UPSTREAM'S, AND THEY ARE WHY THIS IS ADVISORY. Core's own
 * data contains references that do not resolve - `artifact.txt` says
 * `base-object:soft armour:...` while `object_base.txt` and `list-tvals.h` both
 * spell it `soft armor`, and fourteen artifact base objects (Phial, Arkenstone,
 * several rings) name svals that `object.txt` never defines. Those are
 * upstream's, reproduced exactly by the port under the parity mandate, and they
 * are the proof that an unresolved reference must be reported as a WARNING and
 * never as a refusal: a rule strict enough to reject them would reject Angband.
 */

import type { JsonRecord, JsonValue } from "./compose.js";

/**
 * How a reference's text is turned into something comparable with the target's.
 *
 * - `exact`: compare verbatim. Codes and tvals.
 * - `lower`: case-insensitive. Monster names, which core cross-references with
 *   inconsistent capitalisation ("Scrawny cat" for "scrawny cat").
 * - `object-name`: strip Angband's article and plural marks, then lower.
 *   `& Wooden Torch~` is how object.txt writes the name that artifact.txt,
 *   store.txt and monster.txt all refer to as `Wooden Torch`.
 */
export type RefNormalize = "exact" | "lower" | "object-name";

/** One field that names records in another file. */
export interface ReferenceEdge {
  /** Pack file stem the reference is written in. */
  readonly file: string;
  /** Dotted path to the naming field. A step over an array maps across it. */
  readonly path: string;
  /** Pack file stem the name resolves in. */
  readonly target: string;
  /** Dotted path to the name on the target record. */
  readonly targetPath: string;
  /** Comparison rule for both sides. Default `exact`. */
  readonly normalize?: RefNormalize;
  /** Split one field into several references first, e.g. `"BLINK | HEAL"`. */
  readonly split?: string;
  /** Literal values that are keywords rather than names. */
  readonly keywords?: readonly string[];
  /** What the reference is, for the message: "the object base", "a slay". */
  readonly what: string;
}

/**
 * Every reference core's data exercises, so every edge here is measurable.
 *
 * An edge core never uses is deliberately absent even where the field exists:
 * an edge nothing exercises is an edge nothing can check, and it would be
 * indistinguishable from a wrong one.
 */
export const REFERENCE_EDGES: readonly ReferenceEdge[] = [
  /* Objects and the item tree. `type` is the tval, which object_base declares;
   * a mod inventing a tval must add the object_base record too, and this is the
   * edge that says so. */
  { file: "object", path: "type", target: "object_base", targetPath: "name.tval", what: "the item type (tval)" },
  { file: "object", path: "slay", target: "slay", targetPath: "code", what: "a slay" },
  { file: "object", path: "curse.name", target: "curse", targetPath: "name", what: "a curse" },
  { file: "ego_item", path: "type", target: "object_base", targetPath: "name.tval", what: "an item type (tval) the ego can appear on" },
  { file: "ego_item", path: "item.tval", target: "object_base", targetPath: "name.tval", what: "the item type of a specific item the ego can appear on" },
  { file: "ego_item", path: "item.sval", target: "object", targetPath: "name", normalize: "object-name", what: "a specific item the ego can appear on" },
  { file: "ego_item", path: "slay", target: "slay", targetPath: "code", what: "a slay" },
  { file: "ego_item", path: "brand", target: "brand", targetPath: "code", what: "a brand" },
  { file: "artifact", path: "base-object.tval", target: "object_base", targetPath: "name.tval", what: "the item type the artifact is built on" },
  { file: "artifact", path: "base-object.sval", target: "object", targetPath: "name", normalize: "object-name", what: "the base object the artifact is built on" },
  { file: "artifact", path: "slay", target: "slay", targetPath: "code", what: "a slay" },
  { file: "artifact", path: "brand", target: "brand", targetPath: "code", what: "a brand" },
  { file: "artifact", path: "curse.name", target: "curse", targetPath: "name", what: "a curse" },
  { file: "artifact", path: "act", target: "activation", targetPath: "name", what: "an activation" },
  { file: "curse", path: "type", target: "object_base", targetPath: "name.tval", what: "an item type the curse can land on" },
  { file: "flavor", path: "kind.tval", target: "object_base", targetPath: "name.tval", what: "the item type these flavours belong to" },

  /* Monsters. */
  { file: "monster", path: "base", target: "monster_base", targetPath: "name", what: "the monster base" },
  { file: "monster", path: "blow.method", target: "blow_methods", targetPath: "name", what: "a blow method" },
  { file: "monster", path: "blow.effect", target: "blow_effects", targetPath: "name", what: "a blow effect" },
  { file: "monster", path: "spells", target: "monster_spell", targetPath: "name", split: "|", what: "a monster spell" },
  { file: "monster", path: "friends.name", target: "monster", targetPath: "name", normalize: "lower", keywords: ["Same"], what: "an escort monster" },
  { file: "monster", path: "mimic.tval", target: "object_base", targetPath: "name.tval", what: "the item type this monster mimics" },
  { file: "monster", path: "mimic.sval", target: "object", targetPath: "name", normalize: "object-name", what: "the item this monster mimics" },
  { file: "monster", path: "drop.tval", target: "object_base", targetPath: "name.tval", what: "the item type of a drop" },
  { file: "monster", path: "drop.sval", target: "object", targetPath: "name", normalize: "object-name", what: "a dropped item" },
  { file: "monster", path: "drop-base.tval", target: "object_base", targetPath: "name.tval", what: "the item type of a base drop" },
  { file: "monster_base", path: "pain", target: "pain", targetPath: "type", what: "a pain message set" },
  { file: "pit", path: "mon-base", target: "monster_base", targetPath: "name", what: "a monster base the pit draws from" },
  { file: "summon", path: "base", target: "monster_base", targetPath: "name", what: "a monster base this summon draws from" },
  { file: "quest", path: "race", target: "monster", targetPath: "name", what: "the monster the quest is for" },

  /* The world, stores and generation. */
  { file: "store", path: "normal.tval", target: "object_base", targetPath: "name.tval", what: "the item type of a stocked item" },
  { file: "store", path: "normal.sval", target: "object", targetPath: "name", normalize: "object-name", what: "a stocked item" },
  { file: "store", path: "always.tval", target: "object_base", targetPath: "name.tval", what: "the item type of an always-stocked item" },
  { file: "store", path: "always.sval", target: "object", targetPath: "name", normalize: "object-name", what: "an always-stocked item" },
  { file: "room_template", path: "tval", target: "object_base", targetPath: "name.tval", keywords: ["0"], what: "the item type the template places" },
  { file: "terrain", path: "mimic", target: "terrain", targetPath: "code", what: "the terrain this one looks like" },
  { file: "p_race", path: "history", target: "history", targetPath: "chart.chart", what: "the history chart this race starts on" },
];

/** Normalise one side of a comparison under a rule. */
export function normalizeRef(value: string | number, rule: RefNormalize = "exact"): string {
  const raw = String(value);
  if (rule === "exact") return raw;
  if (rule === "lower") return raw.trim().toLowerCase();
  /* Angband writes an object's name with the article it takes and the marks
   * that build its plural: "& Wooden Torch~", "& Ring~ of Digging". Every file
   * that REFERS to that object writes the bare "Wooden Torch". */
  return raw
    .replace(/^&\s*/, "")
    .replace(/~/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Every scalar at `path`, mapping across arrays.
 *
 * `blow.method` on `blow: [{method:"HIT"},{method:"BITE"}]` yields both. A step
 * that lands on an object or a missing key contributes nothing rather than
 * failing: a record that does not carry the field simply has no reference
 * there, which is the overwhelmingly common case.
 */
export function valuesAtPath(record: JsonRecord, path: string): (string | number)[] {
  let cur: JsonValue[] = [record];
  for (const part of path.split(".")) {
    const next: JsonValue[] = [];
    for (const node of cur) {
      if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
      const value = (node as JsonRecord)[part];
      if (value === undefined) continue;
      if (Array.isArray(value)) next.push(...value);
      else next.push(value);
    }
    cur = next;
  }
  return cur.filter((v): v is string | number => typeof v === "string" || typeof v === "number");
}

/** The individual references one field value carries, after splitting. */
function refsIn(edge: ReferenceEdge, value: string | number): string[] {
  const raw = edge.split === undefined ? [String(value)] : String(value).split(edge.split);
  const out: string[] = [];
  for (const part of raw) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const norm = normalizeRef(trimmed, edge.normalize);
    if (edge.keywords?.some((k) => normalizeRef(k, edge.normalize) === norm)) continue;
    out.push(norm);
  }
  return out;
}

/** One reference that named nothing. */
export interface DanglingReference {
  /** The file the naming record lives in. */
  readonly file: string;
  /** The naming record's `name` (or its first identifying string), for the message. */
  readonly from: string;
  /** The field path that carried the name. */
  readonly path: string;
  /** The name, as written. */
  readonly value: string;
  /** The file it should have resolved in. */
  readonly target: string;
  /** A full sentence an author can act on. */
  readonly message: string;
}

/** A best-effort human label for a record, for messages only. */
function labelOf(record: JsonRecord): string {
  for (const key of ["name", "code", "store", "type"]) {
    const v = record[key];
    if (typeof v === "string" && v !== "") return v;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const inner = (v as JsonRecord)["name"] ?? (v as JsonRecord)["tval"];
      if (typeof inner === "string" && inner !== "") return inner;
    }
  }
  return "(unnamed record)";
}

/**
 * Check every declared edge against a whole set of composed records.
 *
 * `records` is the FULL picture - core plus every loaded mod, exactly as
 * composition produced it - because that is the only set in which a mod's
 * reference to its own new object_base resolves. Checking a mod's files alone
 * would report every reference to core as dangling, which is the failure mode
 * that makes a checker get switched off.
 *
 * `subject` narrows which records are REPORTED ON without narrowing what they
 * may resolve against. An author checking their own mod wants their own
 * mistakes, not upstream's fourteen; omitting it reports on everything, which
 * is what the test that measures core's own baseline needs.
 */
export function danglingReferences(
  records: Readonly<Record<string, readonly JsonRecord[]>>,
  subject?: Readonly<Record<string, readonly JsonRecord[]>>,
): DanglingReference[] {
  const targets = new Map<string, Set<string>>();
  const targetKey = (edge: ReferenceEdge): string =>
    `${edge.target}|${edge.targetPath}|${edge.normalize ?? "exact"}`;

  for (const edge of REFERENCE_EDGES) {
    const key = targetKey(edge);
    if (targets.has(key)) continue;
    const set = new Set<string>();
    for (const record of records[edge.target] ?? []) {
      for (const v of valuesAtPath(record, edge.targetPath)) {
        set.add(normalizeRef(v, edge.normalize));
      }
    }
    targets.set(key, set);
  }

  const out: DanglingReference[] = [];
  for (const edge of REFERENCE_EDGES) {
    const known = targets.get(targetKey(edge)) as Set<string>;
    const from = subject === undefined ? records[edge.file] : subject[edge.file];
    for (const record of from ?? []) {
      for (const value of valuesAtPath(record, edge.path)) {
        for (const ref of refsIn(edge, value)) {
          if (known.has(ref)) continue;
          out.push({
            file: edge.file,
            from: labelOf(record),
            path: edge.path,
            value: ref,
            target: edge.target,
            message:
              `${edge.file} "${labelOf(record)}": ${edge.path} names ${edge.what} ` +
              `"${ref}", and no loaded pack defines it in ${edge.target}.`,
          });
        }
      }
    }
  }
  return out;
}
