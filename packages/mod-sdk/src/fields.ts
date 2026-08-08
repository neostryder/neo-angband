/**
 * Mod-declared record fields: a mod's own vocabulary on core's records.
 *
 * THE PROBLEM THIS SOLVES. Composition has always carried an unrecognised key
 * through, and core now hands it back on the bound record as `ext`. That is
 * enough to ADD a field, and not enough to add one SAFELY: two mods that both
 * coin `bleed` mean different things by it and silently fight, and a typo
 * (`atack` for `attack`) looks exactly like a deliberate new field, so the
 * author sees no error and no effect.
 *
 * THE RULE, in one line: an extension field is a NAMESPACED key, and the mod
 * whose namespace it carries must have declared it.
 *
 *   "mymod:bleed": { "dice": "1d3", "turns": 5 }
 *
 * NAMESPACED BECAUSE THE ALTERNATIVE IS A LAND GRAB. Whoever ships first takes
 * `bleed` and every later mod either collides with it or works around it.
 * Qualifying by the declaring mod's id makes the collision impossible and makes
 * deliberate interop possible in the same stroke - a second mod writing
 * `mymod:bleed` is asking to extend mymod's field, which is a meaningful thing
 * to want and reads unambiguously. It is also what the port already does for
 * VocabularyRegistry terms ("demo:luck"), so this is one rule rather than two.
 *
 * A COLON IS SAFE AS THE SEPARATOR: no key in core's gamedata contains one
 * (278 distinct tokens, zero with a colon - packages/core/src/mod/record-keys.ts,
 * checked by fields.test.ts). So "contains a colon" identifies an extension
 * field without needing core's key table at all, which is what keeps this file
 * in the SDK where the manifests are and out of core.
 *
 * AN UNDECLARED FIELD COSTS THE FIELD, NOT THE MOD. It is stripped and reported
 * by name, matching the rule a missing patch target already follows. Refusing
 * the whole mod would turn a typo in one record into a game that will not boot.
 */

import type { PackManifest } from "./manifest.js";

/** The JSON shapes a declared field may take. "any" declines to check. */
export type FieldType = "string" | "number" | "boolean" | "object" | "array" | "any";

/** Every legal `type` value, for validation and for error messages. */
export const FIELD_TYPES: readonly FieldType[] = [
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "any",
];

/**
 * One field a mod introduces onto core's records.
 *
 * `files` is REQUIRED rather than defaulting to "anywhere". The whole value of
 * declaring is precision: a field meant for weapons that lands on a monster
 * because of a copy-paste is the second-most-likely mistake after a misspelling,
 * and "anywhere" cannot see it. An author writing the declaration already knows
 * which files they are patching.
 */
export interface FieldDecl {
  /** Bare name, unqualified. The mod owns `<mod id>:<name>`. */
  name: string;
  /** Pack file stems this field may appear on ("object", "ego_item", ...). */
  files: string[];
  /** Expected JSON shape; "any" (the default) declines to check. */
  type?: FieldType;
  /** Human label for a mod manager or a character sheet. */
  label?: string;
  /** What the field means, for the author's own documentation. */
  desc?: string;
}

/** A declared field, resolved to its qualified name and owning mod. */
export interface ResolvedField extends FieldDecl {
  /** The pack that declared it. */
  owner: string;
  /** `<owner>:<name>` - how the field is written in JSON and read from `ext`. */
  qualified: string;
}

/** The declaring mod's id in a qualified key, or "" when the key is unqualified. */
export function fieldOwner(key: string): string {
  const at = key.indexOf(":");
  return at === -1 ? "" : key.slice(0, at);
}

/** Whether a record key is an extension field rather than one of core's. */
export function isExtensionKey(key: string): boolean {
  return key.includes(":");
}

/**
 * Index every field declared by the given manifests, by qualified name.
 *
 * A pack declaring the same name twice keeps the FIRST, which matches how a
 * duplicate anywhere else in a manifest resolves and means a later edit cannot
 * silently change what an earlier one meant.
 */
export function declaredFields(manifests: readonly PackManifest[]): Map<string, ResolvedField> {
  const out = new Map<string, ResolvedField>();
  for (const m of manifests) {
    for (const f of m.fields ?? []) {
      const qualified = `${m.id}:${f.name}`;
      if (!out.has(qualified)) out.set(qualified, { ...f, owner: m.id, qualified });
    }
  }
  return out;
}

/** What a value's JSON shape is, in the vocabulary FieldType uses. */
function shapeOf(value: unknown): FieldType {
  if (Array.isArray(value)) return "array";
  if (value === null) return "object";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") return t;
  return "any";
}

/** One field a record carried that could not be honoured, and why. */
export interface FieldFault {
  /** The mod the fault is attributed to: the key's namespace, or "" if none. */
  packId: string;
  /** The pack file the record lives in. */
  file: string;
  /** The key as written. */
  key: string;
  /** A full sentence naming the mod, the file, the key and the reason. */
  message: string;
}

/**
 * Strip every extension key that is not properly declared, in place, and return
 * one fault per stripped key.
 *
 * ATTRIBUTED TO THE NAMESPACE, NOT THE WRITER. A composed record has lost which
 * pack contributed each key - the ref says who OWNS the record, and a patch
 * from a third pack leaves no trace on the value it set. So a fault names the
 * mod whose namespace the key claims, which is the mod that would have to
 * declare it, and is the actionable half. What this therefore does NOT yet
 * enforce is a pack writing into another pack's namespace without depending on
 * it: the namespace is a boundary against COLLISION here, not yet against
 * trespass. MOD_REACH records that as the remaining half rather than letting
 * the docs imply a gate that is not there.
 *
 * UNQUALIFIED keys are left ALONE. They are core's business - `attack` on a
 * dagger is not an extension field - and this layer has no way to tell a
 * misspelling of one of core's keys from a key core reads but never ships. That
 * distinction needs core's own key table; see checkUnqualified.
 */
export function applyFieldPolicy(
  file: string,
  records: readonly Record<string, unknown>[],
  declared: ReadonlyMap<string, ResolvedField>,
): FieldFault[] {
  const faults: FieldFault[] = [];
  /* One fault per (key, reason) rather than per record: a mod that adds an
   * undeclared field to four hundred objects should produce one line, not four
   * hundred, or the real problems drown. */
  const seen = new Set<string>();
  const fault = (packId: string, key: string, message: string): void => {
    const dedupe = `${packId}|${key}|${message}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    faults.push({ packId, file, key, message });
  };

  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!isExtensionKey(key)) continue;
      const owner = fieldOwner(key);
      const decl = declared.get(key);

      if (decl === undefined) {
        delete record[key];
        fault(
          owner,
          key,
          `${file}: dropped "${key}" - no loaded mod declares it. ` +
            `A field must be declared in ${owner === "" ? "its mod"
              : `${owner}'s`} manifest under "fields" before it can be written.`,
        );
        continue;
      }

      if (!decl.files.includes(file)) {
        delete record[key];
        fault(
          owner,
          key,
          `${file}: dropped "${key}" - ${owner} declares it for ` +
            `${decl.files.join(", ")} and not for ${file}.`,
        );
        continue;
      }

      const want = decl.type ?? "any";
      /* Read the shape BEFORE deleting. Reading it after reports the shape of
       * the hole, which is a message that describes the check rather than the
       * data - and it is what the first version of this did. */
      const got = shapeOf(record[key]);
      if (want !== "any" && got !== want) {
        delete record[key];
        fault(owner, key, `${file}: dropped "${key}" - declared as ${want}, got ${got}.`);
      }
    }
  }
  return faults;
}

/**
 * The arm that needs core's key table: an UNQUALIFIED key core does not know.
 *
 * Separate from applyFieldPolicy, and separately callable, because the
 * knowledge it needs lives in core and this package has no dependencies. A host
 * that has the table calls both; the SDK alone can still enforce the namespace
 * rule, which is the half that does not need to know anything about core.
 *
 * NOTHING IS STRIPPED HERE. A key core reads but never ships in its own data
 * would look identical to a typo from out here, and dropping it would break a
 * legitimate patch to satisfy a diagnostic. The fault is the product.
 */
export function checkUnqualified(
  file: string,
  records: readonly Record<string, unknown>[],
  knownKeys: readonly string[],
): FieldFault[] {
  const known = new Set(knownKeys);
  const faults: FieldFault[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (isExtensionKey(key) || known.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const near = nearest(key, knownKeys);
      faults.push({
        packId: "",
        file,
        key,
        message:
          `${file}: "${key}" is not one of core's fields` +
          (near === null ? "" : ` (did you mean "${near}"?)`) +
          `. A field a mod introduces must be namespaced, e.g. "<mod id>:${key}", ` +
          `and declared in that mod's manifest.`,
      });
    }
  }
  return faults;
}

/** The closest known key within a small edit distance, or null. */
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

/** Levenshtein distance, abandoning once every cell exceeds `cap`. */
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
