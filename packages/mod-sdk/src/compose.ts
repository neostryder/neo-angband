/**
 * Record composition: how a stack of packs becomes one game.
 *
 * Every record in the composed game is identified by a PackRef
 * ("<owner-pack>:<slug>"). Packs may:
 *  - add records (they become the owner),
 *  - patch records owned by packs they declare as hard or optional dependencies
 *    (deep merge: objects merge per key, arrays and scalars replace,
 *    an explicit null deletes the key),
 *  - replace such records wholesale, or
 *  - remove them.
 *
 * The base game is pack zero ("core") and gets no special treatment:
 * a total conversion is just a pack that replaces or removes core
 * records. Composition is deterministic given the resolved load order,
 * and every record carries provenance (owner plus every pack that
 * modified it) for savefiles and debugging.
 */

import { RECORD_BLUEPRINTS } from "./blueprints.js";
import type { PackManifest, PackRef } from "./manifest.js";
import { applyFieldPatch } from "./patch.js";
import type { FieldPatch } from "./patch.js";
import {
  keyDescription,
  keySpecFor,
  legacyRecordKey,
  recordRefKeys,
} from "./record-key.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

/**
 * A value's JSON shape, in the vocabulary `RECORD_BLUEPRINTS` measured core in.
 *
 * `null` IS ITS OWN SHAPE HERE, and that is the one deliberate difference from
 * authoring.ts's `shapeOf`, which folds it into "object". The blueprint reader
 * only has to name a shape; this decides whether a binder can READ the value,
 * and `null.map(...)` throws exactly as loudly as `"a string".map(...)` does.
 */
function jsonShape(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const CONTAINERS = new Set(["array", "object"]);

/**
 * Whether every shape core writes for a field is a container, none of them is,
 * or the field is written both ways.
 *
 * "mixed" is not a failure to decide - it is core writing the field both ways,
 * and a field core itself spells two ways cannot be proved unreadable from its
 * shape alone.
 */
function coreShapeClass(types: readonly string[]): "container" | "scalar" | "mixed" {
  const containers = types.filter((t) => CONTAINERS.has(t)).length;
  if (containers === types.length) return "container";
  if (containers === 0) return "scalar";
  return "mixed";
}

/**
 * Why this field of this record cannot be given this value, or null if it can.
 *
 * THE LINE THIS DRAWS, and why it is drawn there. `RECORD_BLUEPRINTS` is a
 * MEASUREMENT of core's shipped records, not a schema, and blueprints.ts's own
 * header says an unlisted value is legal - a mod inventing a new tval is doing
 * something the mod system exists to allow. So a value that merely disagrees
 * with the measurement is reported and kept (validate.ts, rule `field/type`),
 * and that is right.
 *
 * It is not right for CONTAINER-NESS. Every binder in the port reads a list
 * field by iterating it: `rec.owner.map(...)` in the store binder is the case
 * that surfaced this, and a string, a number, `null` and a missing field all
 * throw a TypeError there. That throw happens inside `bindCore` inside
 * `startGame`, which the host runs at module top level, so the player gets the
 * crash screen and no game - the whole cost of one patched field of one shop.
 * No amount of experimentation makes a string iterable, so this class is not
 * experimentation, and it is refused rather than reported.
 *
 * DELIBERATELY NARROW, in two ways that are both load-bearing.
 *
 * A scalar swapped for another scalar (`weight` written "40" instead of 40)
 * stays a finding: a binder can usually read it, some of them coerce it, and
 * refusing it would take the measurement's word for something it cannot prove.
 *
 * And a field that is simply GONE is not refused either, even though reading a
 * missing list throws the same TypeError a string does. Dropping a field is how
 * a total conversion works - `replaces` swaps the whole record, and a monster
 * rewritten as `{name, hp}` legitimately has no `blows` - so refusing an absent
 * field would put back the fields the mod meant to remove and quietly undo a
 * supported feature. An absent required field is already reported
 * (`field/required` in authoring.ts), and the binders are where a record the
 * mod OWNS should be refused; see docs/PLANNED.md.
 */
function unreadableShape(file: string, key: string, value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  const shape = RECORD_BLUEPRINTS[file]?.fields[key];
  /* No blueprint for the file, or a field core does not have: nothing to
   * contradict. A mod's own namespaced field lands here, which is correct - it
   * is the mod's field and the mod decides its shape. */
  if (!shape) return null;
  const want = coreShapeClass(shape.types);
  if (want === "mixed") return null;
  const got = jsonShape(value);
  const isContainer = CONTAINERS.has(got);
  if (want === "container" && !isContainer) {
    return `\`${key}\` is ${got}, and core writes it as ${shape.types.join(" or ")} on every record that has it - nothing can read it`;
  }
  if (want === "scalar" && isContainer) {
    return `\`${key}\` is ${got}, and core writes it as ${shape.types.join(" or ")} - nothing can read it`;
  }
  return null;
}

/**
 * The packs that wrote each top-level key of one composed record.
 *
 * This is composition-time bookkeeping only: loader.ts consumes it before it
 * returns record arrays to the host, so it never reaches a binder or a save.
 */
export type FieldWriters = Map<string, Set<string>>;

/** One top-level value a pack wrote, including an explicit deletion. */
export interface FieldWrite {
  readonly packId: string;
  readonly value: JsonValue | undefined;
}

/** The transient writers and values for one record's top-level keys. */
export interface FieldProvenance {
  readonly writers: FieldWriters;
  readonly writes: Map<string, FieldWrite[]>;
}

/** Start the transient field provenance for a record a pack contributes. */
export function fieldProvenanceFor(record: JsonRecord, packId: string): FieldProvenance {
  const provenance: FieldProvenance = { writers: new Map(), writes: new Map() };
  noteFieldWrites(provenance, Object.keys(record), packId, record);
  return provenance;
}

/** Record the final values for top-level keys one pack just wrote. */
export function noteFieldWrites(
  provenance: FieldProvenance,
  keys: Iterable<string>,
  packId: string,
  record: JsonRecord,
): void {
  for (const key of keys) {
    let by = provenance.writers.get(key);
    if (by === undefined) {
      by = new Set();
      provenance.writers.set(key, by);
    }
    by.add(packId);
    let writes = provenance.writes.get(key);
    if (writes === undefined) {
      writes = [];
      provenance.writes.set(key, writes);
    }
    writes.push({ packId, value: record[key] });
  }
}

/** One pack's contribution to one record file (e.g. "monster"). */
export interface FileContribution {
  /**
   * New records; this pack becomes their owner. Each needs a derivable
   * identity - the per-file key declared in record-key.ts, which is the
   * record's `name` for the files that do not declare one.
   */
  records?: JsonRecord[];
  /** Deep-merge patches onto records owned by declared dependencies. */
  patches?: Record<string, JsonRecord>;
  /** Wholesale replacements (owner and ref are preserved). */
  replaces?: Record<string, JsonRecord>;
  /** Refs to delete from the composed game. */
  removes?: string[];
  /**
   * Field-level patches (see patch.ts): ordered field ops per target ref.
   * composePacks applies these in load order after the coarse `patches`/
   * `replaces` for the same pack (each pack's ops fold onto the running
   * value, which is identical to composeFieldPatches over the ordered
   * list). The pre-launch conflict report (P7 phase 6) reads the same data
   * to find same-field collisions without the false-positive whole-record
   * conflicts `patches` produces.
   */
  fieldPatches?: Record<string, FieldPatch>;
  /**
   * Contributions attributed to a NAMED PART of this pack, keyed by a section id
   * the manifest declares (see PackSection). Each value is an ordinary
   * FileContribution, so a section contributes exactly what the pack itself can.
   *
   * Nested rather than a `section` key on each entry because `patches`,
   * `replaces` and `fieldPatches` are all keyed BY REF - there is no room for a
   * per-entry tag without changing three shapes, and every existing pack would
   * have had to be rewritten. This way an unsectioned contribution stays exactly
   * where it is and belongs to the pack's implicit default part.
   *
   * composePacks never sees this: expandSections (sections.ts) drops the
   * disabled sections and flattens the rest into the pack list, in band order,
   * BEFORE composition. So a switched-off section is absent rather than
   * overridden - the same rule a disabled mod's hooks follow.
   */
  sections?: Record<string, FileContribution>;
}

export interface PackContent {
  manifest: PackManifest;
  /** Contributions keyed by record file: "monster", "object", ... */
  files: Record<string, FileContribution>;
}

export interface ComposedRecord {
  ref: PackRef;
  /** The pack that added the record. */
  owner: string;
  /** Every pack that patched or replaced it, in load order. */
  modifiedBy: string[];
  value: JsonRecord;
  /** The record exactly as its OWNER supplied it, before any patch landed. */
  readonly defined: JsonRecord;
}

/* Deliberately outside ComposedRecord: this cannot become record data or reach
 * a save through an incidental serializer. loader.ts consumes it before it
 * returns the composed values. */
const fieldProvenanceByRecord = new WeakMap<ComposedRecord, FieldProvenance>();

/**
 * The transient key provenance for a record from this composition only.
 *
 * Every composed record is registered where it enters the table, so a miss
 * means a NEW path added a record without registering one. That is worth
 * naming rather than casting away: unregistered, the record's writers are
 * invisible, so the namespace-trespass gate stops seeing that record's writes
 * and silently permits what it exists to refuse. Left as a cast, the symptom
 * would instead be a TypeError from inside `noteFieldWrites`, several frames
 * from the mistake.
 *
 * Deliberately NOT a ComposeError. That type is the mod-attributable channel -
 * it carries a pack id and tells an author which line to fix - and this is the SDK's own
 * bug, not a mod's. Blaming whichever pack happened to be loading would send a
 * reader after the wrong thing entirely.
 */
export function fieldProvenanceOf(record: ComposedRecord): FieldProvenance {
  const provenance = fieldProvenanceByRecord.get(record);
  if (provenance === undefined) {
    throw new Error(
      `composition bug: no field provenance for "${record.ref}" - a record ` +
        `reached the table without registering one, so the namespace gate cannot see its writers`,
    );
  }
  return provenance;
}

export class ComposeError extends Error {}

/**
 * `patch`'s keys come from parsed mod-authored JSON. `__proto__`, `prototype`,
 * and `constructor` are rejected outright rather than merely skipped, so a
 * key like this can never silently do nothing while looking accepted -
 * see NA-CORE-002 (the same class of escape as patch.ts's dot-path segments).
 */
const UNSAFE_PATCH_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Deep merge per the pack patch rules. Returns a new object. */
export function mergePatch(base: JsonRecord, patch: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };
  for (const [key, val] of Object.entries(patch)) {
    if (UNSAFE_PATCH_KEYS.has(key)) {
      throw new ComposeError(`patch: "${key}" is not an allowed field name`);
    }
    const existing = Object.hasOwn(out, key) ? out[key] : undefined;
    if (val === null) {
      delete out[key];
    } else if (
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      out[key] = mergePatch(existing as JsonRecord, val as JsonRecord);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function mayModify(m: PackManifest, ownerPack: string): boolean {
  const deps = m.dependencies ?? {};
  const optDeps = m.optionalDependencies ?? {};
  return (
    ownerPack === m.id ||
    (Object.hasOwn(deps, ownerPack) && deps[ownerPack] !== undefined) ||
    (Object.hasOwn(optDeps, ownerPack) && optDeps[ownerPack] !== undefined)
  );
}

function ownerOf(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? "" : ref.slice(0, at);
}

/**
 * How composePacks should react to a contribution it cannot honour.
 *
 * WHY THIS IS AN OPTION AND NOT A DECISION. The same event has two right answers
 * depending on who is watching. A mod's BUILD should stop dead on a patch aimed
 * at nothing, because the author is right there and a silent no-op is the worst
 * thing you can hand them. A player's GAME should not: their mod was fine when it
 * was published and the record it patches has since moved, and taking the whole
 * mod away - or the whole game - is a punishment for the engine's change.
 *
 * So the throwing behaviour stays the default (every existing caller and the
 * author-facing tooling keep it) and the host passes a reporter.
 */
export interface ComposePacksOptions {
  /**
   * Called instead of throwing, with the offending pack's id kept separate from
   * the sentence so a host can put the line on that mod's own row. The
   * contribution is then SKIPPED and composition continues.
   */
  readonly onRefuse?: (packId: string, why: string) => void;
}

/**
 * The tail every "no such record" refusal carries, in both merge phases.
 *
 * Said because the likeliest cause is not a typo. A pack that composed when it
 * was published and does not now is usually pointing at a record the engine or
 * another pack has since renamed, and an author reading "does not exist" about a
 * ref they know they got right will go looking in the wrong place.
 */
export const RENAMED_HINT =
  " - it may have been renamed or removed by a newer version of the pack that owns it";

/** How a refused op reads, matched to the passthrough path's wording. */
const REF_VERB = {
  patches: "patches",
  replaces: "replaces",
  fieldPatches: "fieldPatches",
  removes: "removes",
} as const;

/**
 * Compose packs (already in resolved load order) into per-file record
 * maps. Iteration order of each map is deterministic: records appear
 * in the order their owning packs added them.
 *
 * ONE BROKEN OP COSTS THAT OP, when `onRefuse` is supplied. Until 2026-08-02 the
 * only behaviour was to throw, and the caller that mattered - composeContentPacks
 * on the web host - sat under composeDroppingBroken, which answers a throw by
 * removing the whole PACK. The result was an asymmetry nobody chose: the 20
 * passthrough record files reported a missing ref and carried on, and the 24
 * composable ones took the entire mod down for the same author mistake. A mod
 * patching forty monsters lost all forty, plus its code and its rules, because
 * one of the forty had been renamed in the engine.
 *
 * That is also the difference between an engine patch that costs mod authors a
 * release and one that costs them nothing, which is the property this exists for.
 */
export function composePacks(
  packs: readonly PackContent[],
  options: ComposePacksOptions = {},
): Map<string, Map<PackRef, ComposedRecord>> {
  const game = new Map<string, Map<PackRef, ComposedRecord>>();
  /**
   * Per file, the EXTRA refs a record answers to: its discriminated form where
   * the file declares a discriminator, and the pre-2026-08-08 lossy slug. Value
   * is every primary ref claiming that alias, so "nothing there" and "two
   * records there" are one lookup with two outcomes and an ambiguous ref can
   * name the alternatives instead of only saying it is ambiguous.
   *
   * KEPT OUT OF `table` DELIBERATELY. Registering a record under two keys in the
   * table itself would put it in the composed output twice, because the output
   * is the table's values.
   */
  const aliases = new Map<string, Map<PackRef, PackRef[]>>();
  const onRefuse = options.onRefuse;

  for (const pack of packs) {
    const pid = pack.manifest.id;

    /** Report and skip, or throw when nobody is listening. Returns false either way. */
    const refuse = (why: string, thrown: string): false => {
      if (!onRefuse) throw new ComposeError(`${pid}/${thrown}`);
      onRefuse(pid, why);
      return false;
    };

    for (const [file, contrib] of Object.entries(pack.files)) {
      let table = game.get(file);
      if (!table) {
        table = new Map();
        game.set(file, table);
      }
      let alias = aliases.get(file);
      if (!alias) {
        alias = new Map();
        aliases.set(file, alias);
      }
      const spec = keySpecFor(file);

      /**
       * Resolve `ref` to the record it names, or report why it cannot be
       * touched. Reports the same reasons the passthrough path reports, in the
       * same words, so one mod's row does not read differently depending on
       * which of the two merge phases its file happened to land in.
       */
      const addressable = (
        kind: keyof typeof REF_VERB,
        ref: PackRef,
      ): PackRef | null => {
        const verb = REF_VERB[kind];
        const noun = kind === "removes" ? "remove" : kind === "replaces" ? "replace" : kind === "patches" ? "patch" : "fieldPatch";
        let target: PackRef | undefined = table.has(ref) ? ref : undefined;
        if (target === undefined) {
          /* An alias whose record has since been removed resolves to nothing,
           * which is the same answer as never having existed. */
          const live = (alias.get(ref) ?? []).filter((r) => table.has(r));
          if (live.length > 1) {
            refuse(
              `${file} ${verb} "${ref}", but ${live.length} ${file} records share that identity (${keyDescription(file)}) - name one of them instead: ${live.join(", ")}`,
              `${file}: ${noun} target ${ref} is claimed by ${live.length} records`,
            );
            return null;
          }
          target = live[0];
        }
        if (target === undefined) {
          refuse(
            `${file} ${verb} "${ref}", but no such record exists in ${file} (identity is ${keyDescription(file)})${RENAMED_HINT}`,
            `${file}: ${noun} target ${ref} does not exist`,
          );
          return null;
        }
        if (!mayModify(pack.manifest, ownerOf(ref))) {
          const act = kind === "removes" ? "remove" : "modify";
          refuse(
            `${file} ${verb} "${ref}", but ${pid} does not declare ${ownerOf(ref)} as a dependency`,
            `${file}: cannot ${act} ${ref} without declaring ${ownerOf(ref)} as a dependency`,
          );
          return null;
        }
        return target;
      };

      /* IDENTITY IS THE FILE'S, NOT ALWAYS `name` (changed 2026-08-08). Keying
       * every record by slugify(name) is what made `object`, `ego_item` and
       * `vault` unmergeable: core's own names collide there ("Acquirement" and
       * "*Acquirement*"), so the loader classified all three whole-file and a
       * mod adding ONE object replaced all 375. record-key.ts already knew the
       * per-file identity, already spelled the marks out, and already proved 0
       * unaddressable records over the shipped pack - it was simply not the key
       * this table was built from. Now it is.
       *
       * A record answers to several refs in preference order, so the PRIMARY is
       * its first ref no sibling in the same contribution claims. That is what
       * makes an ego whose name core ships twice addressable at all: its base
       * ref is ambiguous and its discriminated one is not. */
      const contributed = contrib.records ?? [];
      const keysOf = contributed.map((rec) => recordRefKeys(file, rec, spec));
      const claimants = new Map<string, number>();
      for (const keys of keysOf) {
        for (const key of keys) claimants.set(key, (claimants.get(key) ?? 0) + 1);
      }
      /* Falling back to keys[0] when nothing is unique keeps the pre-existing
       * answer for a contribution that genuinely repeats a record: the first
       * wins the ref and the rest are refused, rather than all of them going. */
      const chosen = keysOf.map((keys) => keys.find((k) => claimants.get(k) === 1) ?? keys[0]);
      const primary = new Set(chosen.filter((k): k is string => k !== undefined));

      contributed.forEach((rec, i) => {
        const key = chosen[i];
        if (key === undefined) {
          refuse(
            `${file} contributes a record with no derivable identity (identity is ${keyDescription(file)}), so nothing can address it and it was left out`,
            `${file}: record without a name`,
          );
          return;
        }
        const ref = `${pid}:${key}` as PackRef;
        if (table.has(ref)) {
          refuse(
            `${file} adds two records that both resolve to "${ref}", so the second was left out`,
            `${file}: duplicate record ${ref}`,
          );
          return;
        }
        const added: ComposedRecord = {
          ref,
          owner: pid,
          modifiedBy: [],
          value: rec,
          defined: rec,
        };
        fieldProvenanceByRecord.set(added, fieldProvenanceFor(rec, pid));
        table.set(ref, added);

        /* Every other ref this record answers to becomes an alias - EXCEPT one
         * that is some record's real name. "*Healing*"'s legacy ref is plain
         * "Healing"'s primary, and a record's own history must not cost a
         * different record its name. 8 of the shipped pack's 19 legacy aliases
         * are dropped here; *Destruction* keeps both of its, because core ships
         * no plain "Destruction" for it to shadow (record-key.test.ts censuses
         * the lot).
         *
         * The `primary` check is NOT redundant with the `table.has` below, and
         * the difference is one arrangement: a pack that declares the starred
         * form BEFORE the plain one, whose plain record a later pack then
         * removes. Without this line the old ref goes live on the starred
         * record and a patch silently lands on the wrong item. Core's own
         * object.json happens to declare the plain form first, so `table.has`
         * covers it there - which is exactly why the case has to be tested with
         * a fixture rather than the shipped pack. */
        const extra = (keysOf[i] ?? []).filter((k) => k !== key);
        const legacy = legacyRecordKey(file, rec, spec);
        if (legacy !== null) extra.push(legacy);
        for (const k of extra) {
          if (primary.has(k)) continue;
          const at = `${pid}:${k}` as PackRef;
          if (table.has(at)) continue;
          const list = alias.get(at);
          if (list) {
            if (!list.includes(ref)) list.push(ref);
          } else {
            alias.set(at, [ref]);
          }
        }
      });

      /**
       * The record as it should be kept, and the fields that really changed.
       *
       * Every write below goes through this. A field the patch made unreadable
       * is PUT BACK to what the record had before - not dropped, and not left
       * broken - because the alternative outcomes are both worse than the
       * defect: leaving it takes the game down at boot, and dropping the record
       * would renumber a positional table (the store list is read by index, so
       * removing one shop moves another shop's stock).
       *
       * The refused key is also withheld from `noteFieldWrites`, which is the
       * subtle half. Provenance's `was[field]` is what tells core's own line
       * from a mod's later on (see the store binder's `fieldOwner`), so
       * recording a write that was refused would hand the mod the blame for a
       * field it did not change.
       */
      const vetted = (
        ref: PackRef,
        before: JsonRecord,
        after: JsonRecord,
        changed: Iterable<string>,
      ): { value: JsonRecord; wrote: string[] } => {
        const wrote: string[] = [];
        let value = after;
        for (const key of new Set(changed)) {
          const why = unreadableShape(file, key, value[key]);
          if (why === null) {
            wrote.push(key);
            continue;
          }
          if (value === after) value = { ...after };
          if (Object.hasOwn(before, key)) value[key] = before[key] as JsonValue;
          else delete value[key];
          refuse(
            `${file} "${ref}": ${why}, so that field was left as it was`,
            `${file}: unreadable shape for ${key} on ${ref}`,
          );
        }
        return { value, wrote };
      };

      for (const kind of ["patches", "replaces"] as const) {
        for (const [refStr, body] of Object.entries(contrib[kind] ?? {})) {
          const at = addressable(kind, refStr as PackRef);
          if (at === null) continue;
          const existing = table.get(at) as ComposedRecord;
          const changed =
            kind === "patches"
              ? Object.keys(body)
              : new Set([...Object.keys(existing.value), ...Object.keys(body)]);
          const before = existing.value;
          const next = kind === "patches" ? mergePatch(existing.value, body) : body;
          const ok = vetted(at, before, next, changed);
          existing.value = ok.value;
          noteFieldWrites(fieldProvenanceOf(existing), ok.wrote, pid, existing.value);
          existing.modifiedBy.push(pid);
        }
      }

      for (const [refStr, ops] of Object.entries(contrib.fieldPatches ?? {})) {
        const at = addressable("fieldPatches", refStr as PackRef);
        if (at === null) continue;
        const existing = table.get(at) as ComposedRecord;
        const before = existing.value;
        /*
         * A MALFORMED OP DEGRADES THE SAME WAY AN UNRESOLVABLE REFERENCE
         * DOES. `applyFieldPatch` (patch.ts) throws `PatchError` on a target
         * that is not a list where `append`/`removeValue` need one, and it can
         * throw a bare TypeError too - an `append` op written with `value`
         * instead of `values` spreads `undefined` and never reaches patch.ts's
         * own guard. Until this try/catch, either kind of throw propagated
         * straight out of `composePacks`, bypassing `onRefuse` entirely (this
         * loop is the only caller of `applyFieldPatch` in the file that did
         * not already go through `refuse`), so one bad op did not cost that
         * op - it cost the mod that wrote it, when `composeDroppingBroken`'s
         * pack-identifying catch could name one, and cost EVERY installed mod
         * when it could not, since a raw TypeError's message names no pack.
         */
        let patched: JsonRecord;
        try {
          patched = applyFieldPatch(existing.value, ops);
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          refuse(
            `${file} fieldPatches "${at}": ${why}, so that patch was left unapplied`,
            `${file}: fieldPatch ${at} could not be applied (${why})`,
          );
          continue;
        }
        const ok = vetted(
          at,
          before,
          patched,
          ops.map((op) => op.path.split(".")[0] as string),
        );
        existing.value = ok.value;
        noteFieldWrites(fieldProvenanceOf(existing), ok.wrote, pid, existing.value);
        existing.modifiedBy.push(pid);
      }

      for (const refStr of contrib.removes ?? []) {
        const at = addressable("removes", refStr as PackRef);
        if (at === null) continue;
        table.delete(at);
      }
    }
  }

  return game;
}
