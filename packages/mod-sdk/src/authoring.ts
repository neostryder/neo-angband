/**
 * The shortcuts: what a new record needs, what values are typical, and what an
 * author is about to forget.
 *
 * THE PROBLEM. Adding a record to a pack has never been hard - it is JSON, and
 * composition takes it. Adding a record that WORKS is hard, and it is hard in a
 * way no error message reaches: an object with no `alloc` is legal, loads
 * cleanly, and never appears in the dungeon. A monster whose `base` is
 * misspelled is legal, loads cleanly, and binds to nothing. A forty-first
 * potion is legal, loads cleanly, and consumes the last unused flavour so that
 * some other potion becomes unidentifiable. Nothing in the pipeline can say any
 * of that, because nothing in the pipeline knows what a working record LOOKS
 * like.
 *
 * Core's own 3,279 records know. This file is the three ways of asking them:
 *
 *  - `templateRecord(file)` - the fields core always writes, filled with core's
 *    typical values. The starting point, so nobody has to reverse-engineer a
 *    record shape out of a 6,000-line JSON file.
 *  - `suggestFields(file, draft, records)` - what core's own comparable records
 *    do. A price for a level-20 sword is the median price of core's level-20
 *    swords, which is a derivation rather than a guess and is what the author
 *    actually wanted when they asked "what should this cost".
 *  - `checkRecords(subject, all)` - every way the draft will silently do
 *    nothing, named.
 *
 * WHY THIS IS NOT A SCHEMA. A schema says what is allowed; core's data cannot,
 * because the whole point of the mod system is that a mod may do things core
 * never does. So every check here is graded - `error` only where the record
 * cannot work at all, `warn` where it will not do what the author meant, `hint`
 * where it is worth a look - and NOTHING here refuses anything. The refusals
 * live in manifest.ts and fields.ts, where the rules are the engine's own.
 */

import { RECORD_BLUEPRINTS } from "./blueprints.js";
import type { FieldShape, RecordBlueprint } from "./blueprints.js";
import type { JsonRecord, JsonValue } from "./compose.js";
import { danglingReferences, valuesAtPath } from "./references.js";
import { isExtensionKey } from "./fields.js";
import { isReservedKey } from "./provenance.js";

/**
 * How much a finding costs.
 *
 * - `error`: the record cannot work. A required field is absent.
 * - `warn`: the record loads and will not do what it looks like it does. A
 *   dangling reference, a missing `alloc`.
 * - `hint`: worth a look. An unfamiliar value, a companion step, a field core
 *   always writes and this record does not.
 */
export type FindingLevel = "error" | "warn" | "hint";

/** One thing worth saying about one record. */
export interface AuthoringFinding {
  readonly level: FindingLevel;
  /** Pack file stem. */
  readonly file: string;
  /** The record's name, for the message. */
  readonly record: string;
  /** The field path, when the finding is about one. */
  readonly field?: string;
  /** A full sentence naming the record, the field and what to do. */
  readonly message: string;
  /** Stable id of the rule that produced it, so a host can filter. */
  readonly rule: string;
}

/** The blueprint for a record file, or undefined if core ships no such file. */
export function blueprintFor(file: string): RecordBlueprint | undefined {
  return RECORD_BLUEPRINTS[file];
}

/** Every record file core ships, sorted. */
export const BLUEPRINT_FILES: readonly string[] = Object.keys(RECORD_BLUEPRINTS).sort();

/**
 * The fields EVERY one of core's records in this file carries.
 *
 * This is the definition of "required" used throughout, and it is a measurement
 * rather than a schema: if all 624 monsters have `base`, a monster without one
 * is missing something core has never once omitted.
 */
export function requiredFields(file: string): readonly string[] {
  const bp = RECORD_BLUEPRINTS[file];
  if (bp === undefined) return [];
  return Object.entries(bp.fields)
    .filter(([, shape]) => shape.count === bp.records)
    .map(([name]) => name)
    .sort();
}

/** One field of a record file, with how much of core's data uses it. */
export interface FieldUsage {
  readonly name: string;
  readonly shape: FieldShape;
  /** Fraction of the file's records that carry it, 0 to 1. */
  readonly share: number;
}

/** Every field of a record file, most-used first. */
export function fieldUsage(file: string): readonly FieldUsage[] {
  const bp = RECORD_BLUEPRINTS[file];
  if (bp === undefined) return [];
  return Object.entries(bp.fields)
    .map(([name, shape]) => ({ name, shape, share: shape.count / bp.records }))
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

/** How much of a file's data a template includes. */
export type TemplateScope = "required" | "common" | "all";

/** A field is "common" once this fraction of core's records carry it. */
const COMMON_SHARE = 0.5;

function placeholder(shape: FieldShape): JsonValue {
  if (shape.values !== undefined && shape.values.length > 0) {
    const first = shape.values[0];
    return typeof first === "boolean" ? first : String(first);
  }
  if (shape.range !== undefined) return shape.range.median;
  if (shape.items !== undefined) {
    /* An empty list beats a list holding an empty string. `flags: [""]` is not
     * a hint about flags, it is a value the parser will choke on; `flags: []`
     * says "a list goes here" without asserting anything false. */
    const inner = placeholder(shape.items);
    return inner === "" ? [] : [inner];
  }
  if (shape.fields !== undefined) {
    const out: JsonRecord = {};
    for (const [name, kid] of Object.entries(shape.fields)) out[name] = placeholder(kid);
    return out;
  }
  if (shape.types.includes("array")) return [];
  if (shape.types.includes("object")) return {};
  if (shape.types.includes("boolean")) return false;
  if (shape.types.includes("number")) return 0;
  return "";
}

/**
 * A starting record for `file`, with core's typical value in every field.
 *
 * TYPICAL VALUES RATHER THAN EMPTY ONES, deliberately. An author handed
 * `{"name":"","level":0,"weight":0}` has been handed the shape and none of the
 * knowledge; handed `{"name":"","level":25,"weight":150,"cost":150}` they can
 * see at a glance what scale the game works on and change what they mean to
 * change. `name` is the one field left empty, because it is the one field
 * nobody wants a default for.
 *
 * Scope `common` (the default) adds the fields at least half of core's records
 * carry - which for an object is the difference between a shape and a working
 * item, since `alloc` is on 352 of 375 and is exactly what a new object is
 * likeliest to be missing.
 */
export function templateRecord(file: string, scope: TemplateScope = "common"): JsonRecord {
  const bp = RECORD_BLUEPRINTS[file];
  if (bp === undefined) return {};
  const out: JsonRecord = {};
  for (const { name, shape, share } of fieldUsage(file)) {
    const keep =
      scope === "all" ||
      (scope === "common" ? share >= COMMON_SHARE : shape.count === bp.records);
    if (!keep) continue;
    out[name] = name === "name" ? "" : placeholder(shape);
  }
  return out;
}

/**
 * The field whose value makes two records comparable, per file.
 *
 * DECLARED because "comparable" is a judgement, not a measurement: two swords
 * are comparable, a sword and a potion are not, and no statistic in the data
 * says so. Every entry is the field core's own designers plainly grouped by -
 * `type` is the tval, `base` is the monster family - and a file with no entry
 * simply falls back to the whole file, which is a weaker suggestion rather than
 * a wrong one.
 */
const PEER_FIELD: Readonly<Record<string, string>> = {
  object: "type",
  ego_item: "type",
  artifact: "base-object.tval",
  monster: "base",
  monster_base: "glyph",
  terrain: "code",
  trap: "flags",
};

/**
 * The field that says how deep in the dungeon a record belongs, per file.
 *
 * Used to narrow peers further: the price of a sword is a function of its
 * level far more than of its being a sword, so `cost` for a level-20 sword is
 * taken from core's level-20-ish swords rather than from all fourteen.
 */
const DEPTH_FIELD: Readonly<Record<string, string>> = {
  object: "level",
  monster: "depth",
  artifact: "level",
};

/** How many nearest-depth peers a suggestion is drawn from. */
const PEER_WINDOW = 7;

function numberAt(record: JsonRecord, path: string): number | undefined {
  const values = valuesAtPath(record, path);
  const first = values[0];
  return typeof first === "number" ? first : undefined;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The comparable records a suggestion or a model is drawn from. */
export interface PeerSet {
  /** Core's records comparable to the draft, nearest first when depth is known. */
  readonly peers: readonly JsonRecord[];
  /** Which records these are, in a sentence, for the evidence line. */
  readonly because: string;
}

/**
 * Core's own records that are comparable to `draft`, narrowed twice: to the
 * same peer field (all swords), then to the nearest in depth (level-20 swords).
 *
 * Shared by suggestFields and draftRecord so a suggested number and the record
 * it lands in are measured against the SAME set. Two different notions of
 * "comparable" in one drafted record would produce a coherent-looking item
 * whose price came from somewhere else.
 */
export function peersFor(
  file: string,
  draft: JsonRecord,
  records?: Readonly<Record<string, readonly JsonRecord[]>>,
): PeerSet {
  const pool = records?.[file] ?? [];
  const peerField = PEER_FIELD[file];
  /* OVERLAP, NOT EQUALITY. An ego declares the tvals it can appear on as a
   * list, and matching those lists exactly would find nothing: core's "of Slay
   * Orc" is `["sword","polearm","hafted"]`, so an author writing `["sword"]`
   * would be told there is no comparable ego in the game. Sharing one value is
   * what "comparable" means for a list-valued field, and for a scalar one it
   * reduces to equality. */
  const wanted = new Set(peerField === undefined ? [] : valuesAtPath(draft, peerField).map(String));
  let peers =
    wanted.size === 0
      ? pool
      : pool.filter((r) =>
          valuesAtPath(r, peerField as string).some((v) => wanted.has(String(v))),
        );
  const peerLabel = [...wanted].join(", ");
  let because =
    peers.length === 0
      ? "no comparable record"
      : wanted.size === 0
        ? `core's ${String(peers.length)} ${file} records`
        : `core's ${String(peers.length)} ${file} records with ${peerField as string} "${peerLabel}"`;

  const depthField = DEPTH_FIELD[file];
  const draftDepth = depthField === undefined ? undefined : numberAt(draft, depthField);
  if (draftDepth !== undefined && peers.length > PEER_WINDOW) {
    peers = peers
      .map((r) => ({ r, d: Math.abs((numberAt(r, depthField as string) ?? 0) - draftDepth) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, PEER_WINDOW)
      .map((s) => s.r);
    because =
      `the ${String(peers.length)} core ${file} records closest to ` +
      `${depthField as string} ${String(draftDepth)}` +
      (wanted.size === 0 ? "" : ` with ${peerField as string} "${peerLabel}"`);
  }
  return { peers, because };
}

/**
 * Fields a model record never lends to a new one.
 *
 * A template must not silently grant powers. Copying core's nearest sword to
 * get a plausible `attack` and `weight` is the whole point; copying its
 * `flags`, `slay`, `brand`, `effect` or `values` along with them would hand the
 * author an item that does things they never asked for and would not think to
 * look for. Identity and prose go for the same reason - a new record must not
 * arrive wearing someone else's name.
 */
const MODEL_EXCLUDE: ReadonlySet<string> = new Set([
  "name",
  "desc",
  "msg",
  "code",
  "flags",
  "flags-off",
  "values",
  "slay",
  "brand",
  "curse",
  "effect",
  "effect-yx",
  "act",
  "spells",
  "blow",
  "friends",
  "friends-base",
  "drop",
  "drop-base",
  "mimic",
  "shape",
  "expr",
  "dice",
  "time",
  "charges",
  "pval",
]);

/** One suggested value, with the evidence behind it. */
export interface Suggestion {
  readonly field: string;
  readonly value: JsonValue;
  /** Where the number came from, so an author can disagree with it knowingly. */
  readonly because: string;
}

/**
 * What core's comparable records would put in the fields this draft leaves out.
 *
 * THIS IS THE ANSWER TO "WHAT SHOULD IT COST". A price is not derivable from
 * first principles - Angband's costs are hand-set - but it is derivable from
 * precedent, and precedent is what core's 375 objects are. A draft that says
 * `{type: "sword", level: 20}` gets the median cost, weight and to-hit of the
 * seven core swords nearest level 20, and every suggestion carries the sentence
 * explaining which records it came from.
 *
 * `records` is the composed data - core plus any packs already loaded - so a
 * mod that has added its own tval gets suggestions from its OWN records once it
 * has more than none. With no records supplied the numbers fall back to the
 * blueprint's file-wide medians, which is weaker and says so.
 *
 * Only NUMERIC fields are suggested. A name, a description or a set of flags is
 * a design decision, and filling those in from a neighbour would produce a
 * record that reads like core's and is not what the author meant.
 */
export function suggestFields(
  file: string,
  draft: JsonRecord,
  records?: Readonly<Record<string, readonly JsonRecord[]>>,
): Suggestion[] {
  const bp = RECORD_BLUEPRINTS[file];
  if (bp === undefined) return [];
  const { peers, because } = peersFor(file, draft, records);
  const out: Suggestion[] = [];
  for (const [name, shape] of Object.entries(bp.fields)) {
    if (name in draft) continue;
    if (shape.range === undefined) continue;
    const fromPeers = median(
      peers.map((r) => numberAt(r, name)).filter((n): n is number => n !== undefined),
    );
    if (fromPeers !== undefined) {
      out.push({ field: name, value: fromPeers, because: `the median of ${because}` });
    } else {
      out.push({
        field: name,
        value: shape.range.median,
        because: `core's median across all ${String(bp.records)} ${file} records (no comparable record to measure)`,
      });
    }
  }
  return out.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * A companion step: something the record itself is fine without and the AUTHOR
 * is not.
 *
 * Expressed as data rather than as code so the whole list can be read at once,
 * printed by a scaffolder, and extended without touching the checker. A rule
 * fires when the record carries every path in `present` and none of the paths
 * in `absent`.
 */
export interface CompanionRule {
  readonly id: string;
  readonly file: string;
  /** Fires only if the record carries a value at every one of these. */
  readonly present?: readonly string[];
  /** Fires only if the record carries a value at NONE of these. */
  readonly absent?: readonly string[];
  readonly level: FindingLevel;
  /** What is missing and what to do about it. */
  readonly message: string;
}

/**
 * Every "you will not find out until you play it" rule, written down.
 *
 * These are Angband's rules, not the port's, and each one is a real way a
 * well-formed record does nothing. They are all `warn` or `hint` because every
 * one of them is legal: an object with no `alloc` is exactly how core defines
 * an item that only ever comes from a store or an artifact.
 */
export const COMPANION_RULES: readonly CompanionRule[] = [
  {
    id: "object/no-alloc",
    file: "object",
    absent: ["alloc"],
    level: "warn",
    message:
      "has no `alloc`, so it will never be generated in the dungeon. Add " +
      '`alloc: {common, minmax}` - or leave it out deliberately if the item is only ' +
      "meant to come from a store, a monster drop or an artifact.",
  },
  {
    id: "object/no-cost",
    file: "object",
    absent: ["cost"],
    level: "hint",
    message: "has no `cost`, so it is worth nothing and stores will not buy it.",
  },
  {
    id: "object/no-desc",
    file: "object",
    absent: ["desc"],
    level: "hint",
    message: "has no `desc`, so it will have no description in the knowledge menu.",
  },
  {
    id: "object/no-graphics",
    file: "object",
    absent: ["graphics"],
    level: "warn",
    message: "has no `graphics`, so it has no glyph or colour to draw with.",
  },
  {
    id: "monster/no-depth",
    file: "monster",
    absent: ["depth"],
    level: "warn",
    message:
      "has no `depth`, so it will never be generated. Add `depth` and `rarity`, " +
      "or place it deliberately from a pit, a summon or a quest.",
  },
  {
    id: "monster/no-attack",
    file: "monster",
    absent: ["blow", "spells", "innate-freq"],
    level: "hint",
    message: "has no `blow` and no `spells`, so it cannot attack.",
  },
  {
    id: "monster/no-experience",
    file: "monster",
    absent: ["experience"],
    level: "hint",
    message: "has no `experience`, so killing it teaches the player nothing.",
  },
  {
    id: "monster/no-desc",
    file: "monster",
    absent: ["desc"],
    level: "hint",
    message: "has no `desc`, so it will have no lore entry.",
  },
  {
    id: "ego_item/no-alloc",
    file: "ego_item",
    absent: ["alloc"],
    level: "warn",
    message: "has no `alloc`, so it will never be generated on an item.",
  },
  {
    id: "ego_item/no-type",
    file: "ego_item",
    absent: ["type", "item"],
    level: "warn",
    message:
      "names no `type` and no `item`, so there is no item it can appear on. " +
      "`type` lists tvals; `item` pins specific base objects.",
  },
  {
    id: "artifact/no-alloc",
    file: "artifact",
    absent: ["alloc"],
    level: "warn",
    message: "has no `alloc`, so it will never be generated.",
  },
  {
    id: "artifact/no-base",
    file: "artifact",
    absent: ["base-object"],
    level: "error",
    message: "has no `base-object`, so there is no item for it to be a version of.",
  },
  {
    id: "curse/no-type",
    file: "curse",
    absent: ["type"],
    level: "warn",
    message: "names no `type`, so there is no item type it can land on.",
  },
  {
    id: "terrain/no-graphics",
    file: "terrain",
    absent: ["graphics"],
    level: "warn",
    message: "has no `graphics`, so it has no glyph or colour to draw with.",
  },
];

function hasValue(record: JsonRecord, path: string): boolean {
  return valuesAtPath(record, path).length > 0 || pathPresent(record, path);
}

/** Whether the path resolves to anything at all, including objects and arrays. */
function pathPresent(record: JsonRecord, path: string): boolean {
  let cur: JsonValue | undefined = record;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return false;
    cur = (cur as JsonRecord)[part];
    if (cur === undefined) return false;
  }
  return Array.isArray(cur) ? cur.length > 0 : true;
}

function labelOf(record: JsonRecord): string {
  for (const key of ["name", "code", "store", "type"]) {
    const v = record[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return "(unnamed record)";
}

function shapeOf(value: JsonValue): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "object";
  return typeof value;
}

/** The closest known field name within a small edit distance, or null. */
function nearest(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestD = Math.min(3, Math.max(1, Math.floor(key.length / 3) + 1));
  for (const k of known) {
    const d = editDistance(key, k, bestD);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      row.push(v);
      if (v < min) min = v;
    }
    if (min > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length] as number;
}

/**
 * How many objects of each flavoured tval the data can support before the
 * flavours run out.
 *
 * Angband hands every object of a flavoured type a distinct flavour at startup;
 * once they are gone the remaining objects share, and the player's ability to
 * tell an unidentified potion from another one quietly degrades. Nothing warns
 * about it, and a mod that adds twenty potions is exactly the thing that does
 * it. Counted from the composed data rather than declared, so a mod that adds
 * flavours as well as objects gets the credit for them.
 */
function flavourPressure(all: Readonly<Record<string, readonly JsonRecord[]>>): Map<string, number> {
  const supply = new Map<string, number>();
  for (const record of all["flavor"] ?? []) {
    const tval = valuesAtPath(record, "kind.tval").map(String)[0];
    if (tval === undefined) continue;
    const flavours = Array.isArray(record["flavor"]) ? record["flavor"].length : 0;
    const fixed = Array.isArray(record["fixed"]) ? record["fixed"].length : 0;
    supply.set(tval, (supply.get(tval) ?? 0) + flavours + fixed);
  }
  const demand = new Map<string, number>();
  for (const record of all["object"] ?? []) {
    const tval = typeof record["type"] === "string" ? record["type"] : undefined;
    if (tval === undefined || !supply.has(tval)) continue;
    demand.set(tval, (demand.get(tval) ?? 0) + 1);
  }
  const headroom = new Map<string, number>();
  for (const [tval, n] of supply) headroom.set(tval, n - (demand.get(tval) ?? 0));
  return headroom;
}

/** Options for checkRecords. */
export interface CheckOptions {
  /** Findings at or above this level only. Default: everything. */
  readonly minLevel?: FindingLevel;
}

const LEVEL_ORDER: Record<FindingLevel, number> = { hint: 0, warn: 1, error: 2 };

/**
 * Every way the records in `subject` will silently not work, named.
 *
 * TWO ARGUMENTS, AND THE SPLIT IS THE WHOLE DESIGN. `subject` is what is
 * reported on - the mod's own records. `all` is what they are allowed to resolve
 * against - core plus every loaded pack, as composition produced it. Checking a
 * mod against itself would report every reference to core as broken; reporting
 * on everything would drown the author in upstream's own warts, of which there
 * are real ones (see references.ts). Pass the same object twice to audit
 * everything, which is what the tests do.
 */
export function checkRecords(
  subject: Readonly<Record<string, readonly JsonRecord[]>>,
  all: Readonly<Record<string, readonly JsonRecord[]>>,
  options: CheckOptions = {},
): AuthoringFinding[] {
  const out: AuthoringFinding[] = [];
  const add = (f: AuthoringFinding): void => {
    out.push(f);
  };

  for (const [file, records] of Object.entries(subject)) {
    const bp = RECORD_BLUEPRINTS[file];
    if (bp === undefined) {
      add({
        level: "warn",
        file,
        record: "(whole file)",
        rule: "file/unknown",
        message:
          `${file} is not a record file core ships, so nothing will read it. ` +
          `The files core binds are: ${BLUEPRINT_FILES.join(", ")}.`,
      });
      continue;
    }
    const required = requiredFields(file);
    const known = Object.keys(bp.fields);

    for (const record of records) {
      const label = labelOf(record);

      for (const name of required) {
        if (pathPresent(record, name)) continue;
        add({
          level: "error",
          file,
          record: label,
          field: name,
          rule: "field/required",
          message:
            `${file} "${label}" has no \`${name}\`, and all ${String(bp.records)} of ` +
            `core's ${file} records have one.`,
        });
      }

      for (const [key, value] of Object.entries(record)) {
        /* An extension field is a mod's own vocabulary and core knows nothing
         * about it by design - fields.ts is what governs those. */
        if (isExtensionKey(key)) continue;
        /* Provenance is the ENGINE's own key, stamped by the composer onto a
         * record a mod touched. It reaches this check whenever an author lints
         * composed output rather than their source files, and telling them
         * `$from` is not a field core uses would send them looking for a typo
         * they did not make. */
        if (isReservedKey(key)) continue;
        const shape = bp.fields[key];
        if (shape === undefined) {
          const near = nearest(key, known);
          add({
            level: "hint",
            file,
            record: label,
            field: key,
            rule: "field/unknown",
            message:
              `${file} "${label}": \`${key}\` is not a field core's ${file} data uses` +
              (near === null ? "" : ` (did you mean \`${near}\`?)`) +
              `. If it is a field your mod introduces it must be namespaced ` +
              `("<mod id>:${key}") and declared in your manifest.`,
          });
          continue;
        }
        const got = shapeOf(value);
        if (!shape.types.includes(got as never)) {
          add({
            level: "warn",
            file,
            record: label,
            field: key,
            rule: "field/type",
            message:
              `${file} "${label}": \`${key}\` is ${got}, and core always writes it as ` +
              `${shape.types.join(" or ")}.`,
          });
        }
      }

      for (const rule of COMPANION_RULES) {
        if (rule.file !== file) continue;
        if (rule.present?.some((p) => !hasValue(record, p)) === true) continue;
        if (rule.absent?.some((p) => hasValue(record, p)) === true) continue;
        add({
          level: rule.level,
          file,
          record: label,
          rule: rule.id,
          message: `${file} "${label}" ${rule.message}`,
        });
      }
    }
  }

  for (const dangling of danglingReferences(all, subject)) {
    add({
      level: "warn",
      file: dangling.file,
      record: dangling.from,
      field: dangling.path,
      rule: "reference/dangling",
      message: dangling.message,
    });
  }

  /* Flavour pressure is a property of the WHOLE composed set, not of any one
   * record, so it is reported once per tval against the subject's objects. */
  if (subject["object"] !== undefined) {
    const headroom = flavourPressure(all);
    const touched = new Set(
      (subject["object"] ?? [])
        .map((r) => (typeof r["type"] === "string" ? r["type"] : ""))
        .filter((t) => t !== "" && headroom.has(t)),
    );
    for (const tval of [...touched].sort()) {
      const left = headroom.get(tval) as number;
      if (left >= 0) continue;
      add({
        level: "warn",
        file: "flavor",
        record: tval,
        rule: "flavor/exhausted",
        message:
          `there are now ${String(-left)} more ${tval} objects than there are ` +
          `${tval} flavours, so some will share a flavour and stop being ` +
          `distinguishable when unidentified. Add flavours to the \`flavor\` ` +
          `record for ${tval}.`,
      });
    }
  }

  const floor = LEVEL_ORDER[options.minLevel ?? "hint"];
  return out
    .filter((f) => LEVEL_ORDER[f.level] >= floor)
    .sort(
      (a, b) =>
        LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] ||
        a.file.localeCompare(b.file) ||
        a.record.localeCompare(b.record) ||
        a.rule.localeCompare(b.rule),
    );
}

/** A drafted record, with everything that was decided for the author. */
export interface DraftedRecord {
  /** The record itself: the model, the suggestions, then the author's values. */
  readonly record: JsonRecord;
  /** Every number that was chosen for them, and on what evidence. */
  readonly suggestions: readonly Suggestion[];
  /** Everything still worth saying about it. */
  readonly findings: readonly AuthoringFinding[];
  /**
   * The core record the shape was taken from, when there was one.
   *
   * Named so the author can go and read it. "Modelled on the Main Gauche" is a
   * far more useful thing to know than any list of defaults.
   */
  readonly modelledOn?: string;
}

/**
 * The whole workflow for one new record, in one call.
 *
 * THIS IS THE SHORTCUT. An author who knows what they want ("a sludge-brand
 * dagger for around dungeon level 20") should not have to learn what an
 * Angband object record contains before they can have one:
 *
 *   draftRecord("object", { name: "& Sludge Dagger~", type: "sword", level: 20 }, core)
 *
 * comes back with a complete record - cost, weight, to-hit, alloc and graphics
 * all taken from core's own level-20 swords - a list of which numbers were
 * chosen and why, and a list of what is still wrong with it. Every step is
 * separately callable (templateRecord / suggestFields / checkRecords); this is
 * the order they go in.
 *
 * THE AUTHOR'S VALUES ALWAYS WIN, and a value they supplied is never
 * "suggested" over. The suggestions fill the gaps that remain, which is the
 * only place a derived number is better than no number.
 *
 * MODELLED ON A REAL RECORD, NOT ASSEMBLED FROM AVERAGES. The first version of
 * this built the shape from the blueprint's file-wide statistics, and produced
 * a sword carrying `armor` - because 59% of core's objects have `armor`, even
 * though no sword does. Field frequency across a whole file is not a statement
 * about any record in it. So the shape comes from core's nearest comparable
 * record, minus everything that would confer behaviour (MODEL_EXCLUDE), and
 * only the numbers are averaged. When there is no comparable record at all it
 * falls back to `templateRecord`, which is weaker and says so in the findings.
 */
export function draftRecord(
  file: string,
  values: JsonRecord = {},
  records?: Readonly<Record<string, readonly JsonRecord[]>>,
  scope: TemplateScope = "common",
): DraftedRecord {
  const { peers } = peersFor(file, values, records);
  const model = peers[0];

  const record: JsonRecord = {};
  if (model === undefined) {
    Object.assign(record, templateRecord(file, scope));
  } else {
    for (const [key, value] of Object.entries(model)) {
      if (MODEL_EXCLUDE.has(key)) continue;
      record[key] = structuredClone(value);
    }
    /* A required field the model happens not to carry still has to be there. */
    for (const name of requiredFields(file)) {
      if (name in record || MODEL_EXCLUDE.has(name)) continue;
      const shape = RECORD_BLUEPRINTS[file]?.fields[name];
      if (shape !== undefined) record[name] = placeholder(shape);
    }
    record["name"] = "";
  }

  const suggestions = suggestFields(file, values, records).filter((s) => !(s.field in values));
  for (const s of suggestions) record[s.field] = s.value;
  Object.assign(record, values);

  const subject = { [file]: [record] };
  const all: Record<string, readonly JsonRecord[]> = { ...(records ?? {}) };
  all[file] = [...(records?.[file] ?? []), record];
  const out: DraftedRecord = {
    record,
    suggestions,
    findings: checkRecords(subject, all),
  };
  const modelName = model?.["name"];
  return typeof modelName === "string" && modelName !== ""
    ? { ...out, modelledOn: modelName }
    : out;
}

/**
 * A short human summary of what a record file wants, for a scaffolder or a
 * `--help`.
 */
export function describeFile(file: string): string {
  const bp = RECORD_BLUEPRINTS[file];
  if (bp === undefined) return `${file} is not a record file core ships.`;
  const required = requiredFields(file);
  const common = fieldUsage(file)
    .filter((f) => f.share >= COMMON_SHARE && f.shape.count !== bp.records)
    .map((f) => f.name);
  return (
    `${file}: ${String(bp.records)} records in core, ` +
    `${String(Object.keys(bp.fields).length)} fields.\n` +
    `  always present: ${required.length === 0 ? "(none)" : required.join(", ")}\n` +
    `  usually present: ${common.length === 0 ? "(none)" : common.join(", ")}`
  );
}
