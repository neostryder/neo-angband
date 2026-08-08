/**
 * Attaching a mod's own fields to a bound record.
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
}

/**
 * Copy `record`'s mod-supplied fields onto the bound value, and return it.
 *
 * Returns `bound` so a binder can wrap its existing push without restructuring:
 * `this.egos.push(attachExt("ego_item", rec, ego))`.
 *
 * `file` is the pack file STEM ("ego_item", not "ego_item.json"), because that
 * is how CORE_RECORD_KEYS is keyed. A stem with no table yields nothing rather
 * than guessing - see extensionData.
 */
export function attachExt<T extends ModExtensible>(file: string, record: object, bound: T): T {
  const ext = extensionData(file, record);
  if (ext !== undefined) bound.ext = ext;
  return bound;
}
