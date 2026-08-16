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
  /**
   * The values the DEFINING pack gave to every top-level field a later pack
   * changed. Absent when nothing was changed, which is why it is safe to read as
   * "the definer's record, for these keys".
   *
   * WHAT IT IS FOR: an id that a patch cannot move (task #233). A content id's
   * localid is derived from the record's own name or code
   * (`core/src/mod/ids.ts`), so a mod that patches the NAME of a record it does
   * not own moves that record's id - and a character who met the thing before
   * the mod was installed reloads to find its id resolves to nothing. The rule
   * is that a record's id is fixed by the pack that DEFINED it; this is the only
   * thing that makes the definer's spelling recoverable after composition, since
   * composition keeps no history of its own.
   *
   * WHY THE WHOLE DELTA AND NOT "THE IDENTITY FIELDS". The composer does not
   * know which fields core mints ids from - `name` for a monster, `code` for a
   * terrain feature, `type` + `name` for an object kind, `name.name` for a trap -
   * and teaching it would put core's id scheme in the SDK, where the next entity
   * type would be a silent gap rather than a compile error. Recording what
   * CHANGED is a fact the composer already has, and the reader picks the fields
   * it cares about.
   *
   * ONLY FIELDS THE DEFINER HAD. A field a patch ADDED is not recorded: the
   * definer had no value to restore, and "absent" is what the reader falls back
   * to anyway. A field a patch DELETED is recorded, which is the same restore
   * case as one it overwrote.
   */
  readonly was?: Readonly<Record<string, unknown>>;
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
 *
 * `defined` is the record as its OWNER supplied it, before any patch, replace or
 * fieldPatch landed on it; pass it and the stamp carries `was` (see
 * {@link RecordProvenance.was}), which is what keeps a patched record's content
 * id from moving. Omit it and the stamp is exactly what it was before task #233:
 * the caller is then saying "I do not know what this looked like when it was
 * defined", and a reader falls back to the record in front of it.
 */
export function stampProvenance(
  record: unknown,
  owner: string,
  modifiedBy: readonly string[],
  baseId: string,
  defined?: unknown,
): unknown {
  if (owner === baseId && modifiedBy.length === 0) return record;
  if (typeof record !== "object" || record === null || Array.isArray(record)) return record;
  const was = overwrittenFields(defined, record);
  const from: RecordProvenance = {
    owner,
    ...(modifiedBy.length === 0 ? {} : { modifiedBy: [...modifiedBy] }),
    ...(was === undefined ? {} : { was }),
  };
  return { ...(record as Record<string, unknown>), [PROVENANCE_KEY]: from };
}

/**
 * The definer's values for every top-level field composition changed, or
 * undefined when it changed none (or when there is nothing to compare).
 *
 * COMPARED BY VALUE, not by reference, and the difference is measurable:
 * `mergePatch` rebuilds only the branches it touches, but `applyFieldPatch`
 * deep-clones the whole record before it edits one path
 * (`structuredJsonClone`), so a reference test would report every object-valued
 * field of a field-patched record as changed and `was` would become a second
 * copy of the record. The walk is bounded by one record and only happens for
 * records a mod actually touched.
 */
function overwrittenFields(
  defined: unknown,
  final: object,
): Record<string, unknown> | undefined {
  if (defined === final) return undefined;
  if (typeof defined !== "object" || defined === null || Array.isArray(defined)) {
    return undefined;
  }
  const before = defined as Record<string, unknown>;
  const after = final as Record<string, unknown>;
  let was: Record<string, unknown> | undefined;
  for (const key of Object.keys(before)) {
    if (isReservedKey(key)) continue;
    if (sameJson(before[key], after[key])) continue;
    (was ??= {})[key] = before[key];
  }
  return was;
}

/** Structural equality over the JSON values a record file can hold. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameJson(v, b[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
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
  const { owner, modifiedBy, was } = raw as {
    owner?: unknown;
    modifiedBy?: unknown;
    was?: unknown;
  };
  if (typeof owner !== "string" || owner === "") return undefined;
  const mods = Array.isArray(modifiedBy)
    ? modifiedBy.filter((m): m is string => typeof m === "string")
    : [];
  /* Shape-checked like `owner`: a hand-written `"was": 7` would otherwise reach
   * the id minter as a bag of fields to restore from. */
  const defined =
    typeof was === "object" && was !== null && !Array.isArray(was)
      ? (was as Record<string, unknown>)
      : undefined;
  return {
    owner,
    ...(mods.length === 0 ? {} : { modifiedBy: mods }),
    ...(defined === undefined ? {} : { was: defined }),
  };
}
