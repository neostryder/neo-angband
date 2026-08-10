/**
 * Where a composed record came from, carried on the record itself.
 *
 * WHY IT RIDES ON THE RECORD. `composePacks` has always known this - every
 * `ComposedRecord` carries `owner` and `modifiedBy` - and `composeContentPacks`
 * threw it away one line later (`[...table.values()].map((r) => r.value)`),
 * because the host wants per-file record ARRAYS and there was nowhere else to
 * put it. Everything downstream is keyed by array position: the binders assign
 * `kidx` / `ridx` / `eidx` by push order, so a parallel provenance array would
 * have to survive fifteen binders' worth of appends, dummies and skips without
 * ever slipping by one. A key on the record cannot slip, because it travels with
 * the object it describes.
 *
 * WHAT IT COST TO NOT HAVE IT. `ContentIdResolver` namespaces every id it mints
 * with a single constructor argument, and every caller left it at the default -
 * so a monster a mod ADDED was written into the savefile as `core:frost-wyrm`.
 * That is not a cosmetic misattribution: it is a claim, embedded in a player's
 * save, that the base game defines a record it has never heard of. Turn the mod
 * off and the save asks core for something core cannot supply, with nothing in
 * the id to say who should have.
 *
 * ONLY WHEN IT SAYS SOMETHING. A record owned by the base pack that no mod
 * touched is not stamped at all, so composing the base game alone returns the
 * caller's own record objects by reference - the no-op loader.ts promises in its
 * header, which a blanket stamp would have quietly broken. The rule is the same
 * one `ext` follows in core: the presence of the field MEANS a mod was involved,
 * so a reader never has to tell "nothing touched this" from "something touched
 * it and left no mark".
 *
 * THE KEY IS UNNAMESPACED ON PURPOSE. A mod's own fields must contain a colon
 * (`gore:bleed`) and are checked against what the mod declared; `$from` cannot
 * be one, so the field policy skips it, `extensionData` will not sweep it into
 * `ext`, and no mod can mint a key that collides with it.
 */

/** A record's provenance as it appears on the record, under {@link PROVENANCE_KEY}. */
export interface RecordProvenance {
  /** The pack that ADDED the record. */
  readonly owner: string;
  /**
   * Every pack that patched, replaced or field-patched it, in load order.
   * Absent when none did, so `owner` alone is the common shape.
   */
  readonly modifiedBy?: readonly string[];
}

/**
 * The reserved key a composed record carries its provenance under.
 *
 * Core declares this string a second time (`packages/core/src/mod/extension.ts`)
 * because core has no package dependencies at all, and the two are held together
 * by a test rather than by a comment - see packages/web/src/mod-provenance.node.test.ts,
 * which is where the two packages meet.
 */
export const PROVENANCE_KEY = "$from";

/**
 * Whether a key is the ENGINE's, and so neither core's field nor a mod's.
 *
 * ONE PREDICATE, TWO CALLERS, on purpose. Both record checkers - the drafting
 * one in authoring.ts and the composition one in fields.ts - enumerate a
 * record's keys and complain about anything they do not recognise, and both
 * would otherwise tell an author that `$from` is a typo for a field core uses.
 * Two copies of the same skip is two chances for only one of them to learn
 * about the next reserved key.
 */
export function isReservedKey(key: string): boolean {
  return key === PROVENANCE_KEY;
}

/**
 * `record` with its provenance stamped on, or `record` itself when there is
 * nothing to say.
 *
 * `baseId` is the pack the composition treats as the floor (pack zero, the base
 * game). Ownership by that pack with no modifications is the unremarkable case
 * and is left unmarked.
 *
 * A non-object record - a bare string in a mod-only file - is returned
 * untouched. There is nowhere to put a key on it, and inventing a wrapper would
 * change the shape a binder receives to record something no binder reads.
 */
export function stampProvenance(
  record: unknown,
  owner: string,
  modifiedBy: readonly string[],
  baseId: string,
): unknown {
  if (owner === baseId && modifiedBy.length === 0) return record;
  if (typeof record !== "object" || record === null || Array.isArray(record)) return record;
  const from: RecordProvenance =
    modifiedBy.length === 0 ? { owner } : { owner, modifiedBy: [...modifiedBy] };
  return { ...(record as Record<string, unknown>), [PROVENANCE_KEY]: from };
}

/**
 * The provenance stamped on a record, or undefined when it carries none.
 *
 * Shape-checked rather than cast: a mod could write `"$from": 7` into its own
 * JSON by hand, and a reader that trusted the key would hand core a namespace
 * that is not a string.
 */
export function provenanceOf(record: unknown): RecordProvenance | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const raw = (record as Record<string, unknown>)[PROVENANCE_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const { owner, modifiedBy } = raw as { owner?: unknown; modifiedBy?: unknown };
  if (typeof owner !== "string" || owner === "") return undefined;
  const mods = Array.isArray(modifiedBy)
    ? modifiedBy.filter((m): m is string => typeof m === "string")
    : [];
  return mods.length === 0 ? { owner } : { owner, modifiedBy: mods };
}
