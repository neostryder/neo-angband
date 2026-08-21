/**
 * WHOSE MISTAKE IS THIS? - the one answer, shared by every binder that refuses.
 *
 * A binder resolves names: a shop's stock line names an item, an ego's item
 * list names a base kind, and either can name something no loaded pack defines.
 * Upstream's answer is to abort, and for CORE's own data that is still the right
 * answer - a game shipped with a broken data file should fail where it breaks.
 * But `append` (mod-sdk patch.ts) lets one mod add an entry to another pack's
 * list, so the same miss is reachable from an ordinary pair of mods and an
 * ordinary click: mod A stocks an item mod B defines, the player turns mod B
 * off, and a `throw` out of `bindCore` inside `startGame` - which the host runs
 * at module top level - is the crash screen and no game.
 *
 * So the rule is: an entry a MOD contributed is dropped and reported against
 * that mod; core's own is thrown exactly as it always was. `fieldOwner` is the
 * whole of how the two are told apart, and it lives here rather than in one
 * binder because the answer must not differ between them. The store binder
 * worked this out first (`packages/core/src/store/bind.ts`) and this file is
 * that reasoning extracted, unchanged, at the point where the second binder
 * needed it.
 */

import { CORE_NS } from "./ids.js";
import type { RecordProvenance } from "./extension.js";

/**
 * One entry a binder dropped because the pack that contributed it got it wrong.
 *
 * ATTRIBUTED, NOT PREFIXED, the same way the host's own `ModProblem` is: the mod
 * manager has to be able to ask "what is wrong with THIS mod" and get an answer
 * without parsing punctuation, so the pack id rides beside the sentence.
 */
export interface RecordRefusal {
  /** The pack file the record belongs to, as its stem is spelled: `store`. */
  readonly file: string;
  /** The record's own identity, as its file spells it: `STORE_ARMOR`. */
  readonly record: string;
  /** Which field of it lost the entry. */
  readonly field: string;
  /** The pack the fault is attributed to - never `core`. */
  readonly id: string;
  /** What went wrong, in the player's terms, with no id prefix. */
  readonly why: string;
}

/**
 * Two record fragments as the same entry.
 *
 * Structural rather than field-by-field, because the fields compared are not
 * one shape: a store's stock line is `{tval, sval}`, a buy entry is either a
 * bare tval string or `{tval, flag}`, and an entrance feature is a string on its
 * own. Key ORDER must not matter - a patched record is rebuilt by the composer,
 * and `JSON.stringify` would call a reordered but identical entry a mod's - so
 * this walks the keys instead of serialising.
 */
export function sameEntry(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      sameEntry((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * The pack answerable for one entry of one field, or null when the base game is.
 *
 * THIS IS THE WHOLE CORE-VERSUS-MOD DISTINCTION, so it is worth saying exactly
 * what each answer rests on.
 *
 *   - No provenance at all means no pack touched the record (`stampProvenance`
 *     leaves the base game's own untouched records unmarked, on purpose). Every
 *     entry is core's, and a miss throws. This is the case for all of the
 *     shipped data in a modless game, and it is what makes "core's data fails
 *     loudly" true of the path that actually guards core - the whole test suite
 *     and every unmodded boot run through it.
 *   - `was[field]` is the DEFINING pack's own value for a field a later pack
 *     changed (mod-sdk provenance.ts). An entry deep-equal to one of those -
 *     or, for a scalar field, to the value itself - is the definer's, so it is
 *     core's when core defined the record, and a mod's own when a mod did,
 *     which is why a mod's bad entry in a record it defines itself does not
 *     throw either.
 *   - Anything else in the field arrived from a modifier. The LAST modifier is
 *     named, because load order applies patches in order and it is the only one
 *     of them core can single out; the message carries the full list so a fault
 *     landing on the wrong row is still traceable.
 *
 * THE ONE CASE THIS DECIDES IN THE MOD'S FAVOUR WITHOUT PROOF: `was` records
 * only fields the definer HAD and a patch CHANGED, so an absent `was[field]`
 * means either "core's field, which nothing changed" or "a field core never had
 * and a mod added outright". Provenance cannot separate those two, and this
 * returns the last modifier for both. Deciding it the other way would turn a
 * mod's added field back into a failed boot, which is the defect this exists to
 * fix; deciding it this way can only ever downgrade a broken CORE entry to a
 * reported drop, and only on a record a mod has already patched.
 */
export function fieldOwner(
  from: RecordProvenance | undefined,
  field: string,
  entry: unknown,
): string | null {
  if (from === undefined) return null;
  const definer = from.was?.[field];
  const mods = from.modifiedBy ?? [];
  /* A list field's `was` holds the definer's whole list, so the entry is theirs
   * when it appears anywhere in it. A scalar field's `was` IS their value, so
   * the entry is theirs when it still equals that - which for a scalar means a
   * patch that put back what was already there, and the definer keeps the blame
   * for a value they wrote. */
  const definers = Array.isArray(definer)
    ? definer.some((d) => sameEntry(d, entry))
    : definer !== undefined && sameEntry(definer, entry);
  const answerable = definers ? from.owner : (mods[mods.length - 1] ?? from.owner);
  /* Never blame core, and never excuse it. A stamped record with no modifiers is
   * a mod's own (an unmodified base-game record is not stamped at all), so this
   * guard should be unreachable - but a hand-written `$from` is a shape this
   * has to survive, and putting "core" on the mod manager's own row would be
   * worse than throwing. */
  return answerable === CORE_NS ? null : answerable;
}

/**
 * One dropped entry, said the way a player reading the mod manager needs it.
 *
 * Names the record and what it lost, because "which entry" is the only question
 * a mod author has after "which mod".
 *
 * The pack list is appended only when TWO OR MORE packs patched the record, and
 * that condition is the honest one rather than a tidy one: attribution picks the
 * last modifier and cannot prove it, so the set is worth showing exactly when
 * there was a choice to get wrong. One modifier is the ordinary case, the
 * attribution is then certain, and it should not pay a parenthetical.
 */
export function refusalWhy(
  record: string,
  lost: string,
  why: string,
  from: RecordProvenance,
): string {
  const mods = from.modifiedBy ?? [];
  const also =
    mods.length > 1 ? ` (packs touching this record: ${[from.owner, ...mods].join(", ")})` : "";
  return `${record}: ${lost} - ${why}${also}`;
}
