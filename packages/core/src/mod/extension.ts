/**
 * Attaching a mod's own fields - and the name of the mod itself - to a bound
 * record.
 *
 * `record-keys.ts` answers "which keys came from a mod"; this file is what puts
 * the answer somewhere a plugin can read it. They are separate because the
 * former is GENERATED from the shipped pack and the latter is hand-written -
 * regenerating the table must never overwrite this.
 *
 * ONE HELPER RATHER THAN THE SAME THREE LINES IN FIFTEEN BINDERS, for a reason
 * that outlives the tidiness: `grep attachExt` is then a census of which record
 * types carry mod fields, so a bound type that was never wired up is visible as
 * an absence rather than being indistinguishable from one that has no mod
 * fields to carry. mod/extension.test.ts turns that census into a check.
 *
 * PROVENANCE RIDES THE SAME HELPER, and that is the whole reason it reaches
 * every record type at once. `owner` / `modifiedBy` existed in the composer from
 * the beginning and died one line into the host handoff; the alternative to this
 * seam was fifteen binders each remembering to copy two more fields, which is
 * fifteen chances to forget and no way to see the omission from outside. Here,
 * the census that already proves `ext` reaches a record type proves provenance
 * does too.
 */

import { extensionData } from "./record-keys.js";

/**
 * A bound record that can carry the keys core does not know about.
 *
 * OPTIONAL, and absent rather than `{}` when a record is unmodded: the presence
 * of `ext` MEANS a mod put something there, so a plugin reading it never has to
 * distinguish "no mod touched this" from "a mod added nothing".
 *
 * FROZEN by attachExt, so one mod cannot rewrite what another reads. Two mods
 * writing the same field name is a composition-time conflict, resolved there by
 * the same last-load-wins rule as any other patch; by bind time the value is
 * settled and nothing should be editing it.
 */
export interface ModExtensible {
  /**
   * The record's mod-supplied fields, keyed exactly as they appeared in the
   * JSON, or absent when the record has none.
   *
   * Core never interprets these. A mod writes the field in its patch and reads
   * it back here from its own plugin code - core's job is only to stop
   * dropping it on the floor between the two.
   */
  ext?: Readonly<Record<string, unknown>>;
  /**
   * Which pack added this record and which packs changed it, or absent when the
   * base game supplied it and nothing touched it.
   *
   * ABSENT IS THE COMMON CASE and it means "core's own, unmodified" - the same
   * convention `ext` uses, so a reader never has to distinguish "no mod" from
   * "a mod that left no mark". `ContentIdResolver` reads exactly this to decide
   * the namespace a record is saved under.
   */
  from?: RecordProvenance;
}

/**
 * Which pack a record came from.
 *
 * Deliberately a fact about the RECORD, not about the registry it landed in: a
 * mod that adds one monster to a list of six hundred leaves the other five
 * hundred and ninety nine core's, and "which pack is this game running" is not
 * a question anything downstream can use.
 */
export interface RecordProvenance {
  /** The pack that ADDED the record. */
  readonly owner: string;
  /**
   * Every pack that patched, replaced or field-patched it, in load order.
   * Absent when none did.
   */
  readonly modifiedBy?: readonly string[];
  /**
   * The values the DEFINING pack gave to every top-level field a later pack
   * changed, keyed exactly as they appear in the pack's JSON. Absent when
   * nothing was changed.
   *
   * READ BY ONE PLACE: `mod/ids.ts`, which mints a record's content id from the
   * definer's spelling rather than the one in front of it. A localid comes from
   * a record's own name or code, so without this a mod that renames a record it
   * does not own MOVES that record's id - and every save written before the mod
   * was installed loses the entity (task #233). Restoring the definer's value
   * is what makes "a record's id is fixed by the pack that DEFINED it, and a
   * patch cannot move it" true rather than aspirational.
   *
   * KEYED BY THE JSON's FIELD NAMES, not the bound record's. `attachExt` copies
   * the stamp onto the bound value verbatim, and rewriting the keys per binder
   * would be fifteen chances to translate one wrong. The reader walks the JSON
   * shape it needs - `name.name` for a trap, `type` for an object kind - which
   * is the same shape core's own binder for that file already reads.
   */
  readonly was?: Readonly<Record<string, unknown>>;
}

/**
 * The reserved key a composed record carries its provenance under.
 *
 * DECLARED TWICE ON PURPOSE. The writer is `@rpgm-tools/neo-angband-mod-sdk`
 * (provenance.ts) and core has no package dependencies at all - that
 * independence is what lets a host bind a pack it composed itself, or one that
 * never went through the SDK. The two spellings are held together by
 * `packages/web/src/mod-provenance.node.test.ts` - the host is where the two
 * packages meet - which imports both and fails when they part;
 * a comment saying "keep these in sync" is what this file exists not to rely on.
 *
 * Unnamespaced, so no mod can mint it: a mod's own field must contain a colon.
 */
export const PROVENANCE_KEY = "$from";

/**
 * The provenance stamped on a raw record, or undefined when it carries none.
 *
 * Shape-checked rather than cast. A record can reach a binder from a hand-written
 * JSON file that never passed through the composer, and a `"$from": 7` trusted
 * on sight would hand `ContentIdResolver` a namespace that is not a string - so
 * every id it minted would come out `[object Object]:kobold` and the save would
 * be the place that found out.
 */
export function provenanceOf(record: object): RecordProvenance | undefined {
  const raw = (record as Record<string, unknown>)[PROVENANCE_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const { owner, modifiedBy, was } = raw as {
    owner?: unknown;
    modifiedBy?: unknown;
    was?: unknown;
  };
  if (typeof owner !== "string" || owner === "") return undefined;
  const mods = Array.isArray(modifiedBy)
    ? modifiedBy.filter((m): m is string => typeof m === "string")
    : [];
  /* Shape-checked for the same reason `owner` is: `"was": 7` from a hand-written
   * pack would otherwise reach the id minter as a bag of fields to restore
   * from, and the savefile would be where that was discovered. */
  const defined =
    typeof was === "object" && was !== null && !Array.isArray(was)
      ? Object.freeze({ ...(was as Record<string, unknown>) })
      : undefined;
  return Object.freeze({
    owner,
    ...(mods.length === 0 ? {} : { modifiedBy: Object.freeze(mods) }),
    ...(defined === undefined ? {} : { was: defined }),
  });
}

/**
 * Copy `record`'s mod-supplied fields and its provenance onto the bound value,
 * and return it.
 *
 * Returns `bound` so a binder can wrap its existing push without restructuring:
 * `this.egos.push(attachExt("ego_item", rec, ego))`.
 *
 * `file` is the pack file STEM ("ego_item", not "ego_item.json"), because that
 * is how CORE_RECORD_KEYS is keyed. A stem with no table yields nothing rather
 * than guessing - see extensionData.
 *
 * PROVENANCE IGNORES `file`, and that asymmetry is deliberate: `ext` needs the
 * table to know which keys are core's, while `$from` is written by the composer
 * and means the same thing everywhere. So a mod that ships a record file core
 * has never heard of still gets attribution, where it would get no `ext` at all.
 */
export function attachExt<T extends ModExtensible>(file: string, record: object, bound: T): T {
  const ext = extensionData(file, record);
  if (ext !== undefined) bound.ext = ext;
  const from = provenanceOf(record);
  if (from !== undefined) bound.from = from;
  return bound;
}
