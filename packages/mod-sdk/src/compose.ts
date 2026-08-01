/**
 * Record composition: how a stack of packs becomes one game.
 *
 * Every record in the composed game is identified by a PackRef
 * ("<owner-pack>:<slug>"). Packs may:
 *  - add records (they become the owner),
 *  - patch records owned by packs they declare as dependencies
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

import type { PackManifest, PackRef } from "./manifest.js";
import { packRef } from "./manifest.js";
import { applyFieldPatch } from "./patch.js";
import type { FieldPatch } from "./patch.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

/** One pack's contribution to one record file (e.g. "monster"). */
export interface FileContribution {
  /** New records; this pack becomes their owner. Each needs a name. */
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
}

export class ComposeError extends Error {}

/** Deep merge per the pack patch rules. Returns a new object. */
export function mergePatch(base: JsonRecord, patch: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };
  for (const [key, val] of Object.entries(patch)) {
    if (val === null) {
      delete out[key];
    } else if (
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof out[key] === "object" &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergePatch(out[key] as JsonRecord, val as JsonRecord);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function mayModify(m: PackManifest, ownerPack: string): boolean {
  return ownerPack === m.id || (m.dependencies ?? {})[ownerPack] !== undefined;
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

      /**
       * Can `pid` touch `ref`, and does it exist? Reports the same two reasons
       * the passthrough path reports, in the same words, so one mod's row does
       * not read differently depending on which of the two merge phases its file
       * happened to land in.
       */
      const addressable = (kind: keyof typeof REF_VERB, ref: PackRef): boolean => {
        const verb = REF_VERB[kind];
        if (!table.has(ref)) {
          const noun = kind === "removes" ? "remove" : kind === "replaces" ? "replace" : kind === "patches" ? "patch" : "fieldPatch";
          return refuse(
            `${file} ${verb} "${ref}", but no such record exists in ${file} (identity is the record's name)${RENAMED_HINT}`,
            `${file}: ${noun} target ${ref} does not exist`,
          );
        }
        if (!mayModify(pack.manifest, ownerOf(ref))) {
          const act = kind === "removes" ? "remove" : "modify";
          return refuse(
            `${file} ${verb} "${ref}", but ${pid} does not declare ${ownerOf(ref)} as a dependency`,
            `${file}: cannot ${act} ${ref} without declaring ${ownerOf(ref)} as a dependency`,
          );
        }
        return true;
      };

      for (const rec of contrib.records ?? []) {
        const name = rec["name"];
        if (typeof name !== "string" || name.length === 0) {
          refuse(
            `${file} contributes a record with no "name", so nothing can address it and it was left out`,
            `${file}: record without a name`,
          );
          continue;
        }
        const ref = packRef(pid, name);
        if (table.has(ref)) {
          refuse(
            `${file} adds two records that both resolve to "${ref}", so the second was left out`,
            `${file}: duplicate record ${ref}`,
          );
          continue;
        }
        table.set(ref, { ref, owner: pid, modifiedBy: [], value: rec });
      }

      for (const kind of ["patches", "replaces"] as const) {
        for (const [refStr, body] of Object.entries(contrib[kind] ?? {})) {
          const ref = refStr as PackRef;
          if (!addressable(kind, ref)) continue;
          const existing = table.get(ref) as ComposedRecord;
          existing.value =
            kind === "patches" ? mergePatch(existing.value, body) : body;
          existing.modifiedBy.push(pid);
        }
      }

      for (const [refStr, ops] of Object.entries(contrib.fieldPatches ?? {})) {
        const ref = refStr as PackRef;
        if (!addressable("fieldPatches", ref)) continue;
        const existing = table.get(ref) as ComposedRecord;
        existing.value = applyFieldPatch(existing.value, ops);
        existing.modifiedBy.push(pid);
      }

      for (const refStr of contrib.removes ?? []) {
        const ref = refStr as PackRef;
        if (!addressable("removes", ref)) continue;
        table.delete(ref);
      }
    }
  }

  return game;
}
