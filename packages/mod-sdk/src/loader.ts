/**
 * Content-pack loading: turn a resolved set of packs into the merged per-file
 * record arrays a host binds into the running game.
 *
 * This is the join MOD_INTEGRATION_PLAN.md (Wave 1, W1.1) calls for. Until now
 * the composition engine (resolveLoadOrder + composePacks) had no runtime
 * caller: the game bound a single hard-coded pack directly. This wraps the
 * engine into one entry point so the base game and every mod flow through the
 * same pipeline, and a mod's records / patches / replaces / removes /
 * fieldPatches actually take effect.
 *
 * The host (web / cli) owns the glue: it reads packs off disk or bundle, calls
 * composeContentPacks, assembles its GamePack from the result, and hands that
 * to core bindCore. Core stays mod-sdk-agnostic (it only ever sees a merged
 * pack), so the layering the audit relied on is preserved.
 *
 * TWO MERGE PHASES, AND WHY
 *
 * composePacks needs every added record to have a ref no sibling claims, because
 * that is the identity it builds the composed table from. Measured over the
 * shipped core pack, 41 of the 44 record files satisfy that and 3 do not. So:
 *
 *  1. COMPOSED FILES (41) go through composePacks, which merges records
 *     per-record and appends a later pack's additions after an earlier pack's.
 *  2. PASSTHROUGH FILES (3) keep whole-file semantics for `records` - the last
 *     provider in load order wins the file - because a mod that ships
 *     `constants.json` means "use mine", not "add a second constants record",
 *     and the host binds one. Per-record ops are then applied on top, in load
 *     order, against the winning array (applyPassthroughOps below), using the
 *     per-file identity declared in record-key.ts.
 *
 * IT WAS 24 AND 20 UNTIL 2026-08-08, and the line that decided it asked for a
 * unique `name`. `object`, `ego_item` and `vault` all have names and core's own
 * data repeats them, so all three sat in phase 2 - which meant a mod could patch
 * any object but could not ADD one without discarding every object in the game.
 * The identity those files really use was already declared in record-key.ts and
 * already proved unique over the shipped pack; recordsComposable now asks it.
 * What is left in phase 2 is `constants` and `visuals` (config singletons, where
 * whole-file IS the meaning) and `history` (no per-record identity at all).
 *
 * NOTHING IS DROPPED IN SILENCE. This is the invariant the whole file exists to
 * hold. Until 2026-07-29 phase 2 did not exist: a `patches` / `replaces` /
 * `fieldPatches` / `removes` entry aimed at any of the 20 was stripped from the
 * contribution before compose ever saw it, so a mod author shipped a valid op
 * and got no effect and no message - the worst failure mode there is, because a
 * feature that appears to work cannot be found by review. Now every per-record
 * op either takes effect or produces a line in `ComposedContent.problems`
 * naming the pack, the file, the op and the ref. Whole-file replacement of a
 * passthrough file is reported the same way, because it silently discards
 * whatever the previous provider (usually core) put there.
 *
 * `problems` is reported rather than thrown because the web host composes at
 * module scope with no try (packages/web/src/pack.ts), so a throw here is a
 * blank page rather than a message. It is the same shape of channel the pack
 * readers already use (`problems: readonly string[]`), so a host concatenates it
 * into the list it already shows.
 *
 * THAT PARAGRAPH WAS ONLY TRUE OF THIS FILE'S OWN REFUSALS, and it read as a
 * property of composition (2026-07-31). `composePacks` threw ComposeError on a
 * patch whose target does not exist, and `resolveLoadOrder` throws on a missing
 * dependency or a cycle - both reached from composeContentPacks, both from a
 * mod's manifest or contribution, and the host does compose at module scope with
 * no try. So the one class of mod mistake that stayed loud took the whole game to
 * a blank page with nothing on screen naming the mod. `composeDroppingBroken`
 * below is the answer, and it is the rule the rest of the mod system already
 * follows: one broken mod costs that mod.
 *
 * AND "ONE BROKEN MOD COSTS THAT MOD" WAS ITSELF TOO COARSE (2026-08-02). The two
 * merge phases disagreed about the same author mistake: a `fieldPatch` at a ref
 * that does not exist was one reported line for a passthrough file and the loss
 * of the ENTIRE PACK for a composable one, because only the second went through
 * a thrower. Nobody chose that; it fell out of which of the two phases a record
 * file happened to be classified into. composePacks now takes an `onRefuse`
 * reporter and this file passes one, so both phases refuse the same op the same
 * way and in the same words. `composeDroppingBroken` is still here for
 * resolveLoadOrder's throws, which are about the SET of mods rather than one
 * contribution and genuinely cannot be composed around.
 *
 * `faults` carries the same refusals as `problems` with the pack id kept SEPARATE
 * rather than prefixed into the sentence. A host that wants to show a mod its own
 * problems on its own row cannot get that back out of a formatted line without
 * parsing this file's message format - which is how a UI comes to depend on
 * punctuation.
 */

import type { PackManifest } from "./manifest.js";
import { resolveLoadOrder } from "./resolve.js";
import { expandSections } from "./sections.js";
import { composePacks, mergePatch, RENAMED_HINT } from "./compose.js";
import type { FileContribution, JsonRecord, PackContent } from "./compose.js";
import { applyFieldPatch } from "./patch.js";
import { applyFieldPolicy, declaredFields } from "./fields.js";
import type { ResolvedField } from "./fields.js";
import { stampProvenance } from "./provenance.js";
import { checkPacks, composedObjects } from "./validate.js";
import type { PackFinding } from "./validate.js";
import {
  keyDescription,
  keySpecFor,
  legacyRecordKey,
  recordRefKeys,
  RECORD_KEY_SPECS,
} from "./record-key.js";

/**
 * One pack as the host loaded it: its manifest plus its per-file contributions.
 * The base game is the degenerate case where every file is records-only.
 */
export interface LoadedPack {
  manifest: PackManifest;
  /** fileName -> that file's contribution (records / patches / ...). */
  files: Record<string, FileContribution>;
}

/**
 * One refused operation with the pack that asked for it kept separate from the
 * sentence, so a host can put a mod's own problems on that mod's own row.
 */
export interface ComposeFault {
  /** The pack whose operation was refused. */
  packId: string;
  /** What could not be honoured, with no id prefix. */
  why: string;
}

/** The merged content: per-file record arrays, in deterministic order. */
export interface ComposedContent {
  /** fileName -> composed record array. */
  records: Record<string, unknown[]>;
  /** Files merged per-record through the full FileContribution model. */
  composedFiles: string[];
  /** Files whose `records` pass through last-wins (nameless or name-colliding). */
  passthroughFiles: string[];
  /**
   * Every mod-facing operation that could NOT be honoured, in one line each,
   * naming the pack, the file, the op and the record. Empty for a clean set.
   * A host shows these next to the pack-reading problems it already collects.
   */
  problems: string[];
  /**
   * The same refusals, attributed. One entry per line in `problems`, in the same
   * order, with `packId` split out - so a mod manager can show a mod what IT got
   * wrong without parsing a sentence.
   */
  faults: ComposeFault[];
  /**
   * Every field the loaded packs declared, resolved to its qualified name.
   *
   * Returned rather than kept private so a host can show a mod manager what
   * vocabulary is in play, and so a plugin author can assert their own field
   * survived composition instead of inferring it from a record.
   */
  declaredFields: ResolvedField[];
  /**
   * What is wrong with the records the mods contributed, checked against core's
   * own blueprint and attributed to the mod that wrote them.
   *
   * A THIRD LIST, not a third source for `problems`. A fault is an operation the
   * composer REFUSED - the record is not in the game. A finding is about a record
   * that composed perfectly and will not do what its author thinks: a `weight`
   * written as a string, a monster with no `depth`, a drop naming an object no
   * loaded pack defines. Folding the two together would make `problems.length`
   * mean two different things, and a host that showed findings as refusals would
   * tell a player their mod had been cut when it had not.
   *
   * Empty when the base game composes alone; see validate.ts for why the base
   * game is not reported on.
   */
  findings: PackFinding[];
}

/** How a refusal is recorded: one call, both channels, no chance to disagree. */
interface Refusals {
  readonly problems: string[];
  readonly faults: ComposeFault[];
  refuse(packId: string, why: string): void;
}

function refusals(): Refusals {
  const problems: string[] = [];
  const faults: ComposeFault[] = [];
  return {
    problems,
    faults,
    refuse(packId, why) {
      problems.push(`${packId}: ${why}`);
      faults.push({ packId, why });
    },
  };
}

function isNamedRecord(r: unknown): r is JsonRecord {
  return (
    typeof r === "object" &&
    r !== null &&
    !Array.isArray(r) &&
    typeof (r as { name?: unknown }).name === "string" &&
    (r as { name: string }).name.length > 0
  );
}

/**
 * A pack's added records for one file are per-record composable only if every
 * one of them has a ref no sibling claims - exactly the condition composePacks
 * needs to give each record a primary key.
 *
 * IT USED TO ASK FOR A UNIQUE `name` (changed 2026-08-08), and that single line
 * is what made `object`, `ego_item` and `vault` unmergeable. All three carry a
 * `name`, but core's own data repeats it - Angband's convention for a greater
 * form is the same name with a mark ("Acquirement" / "*Acquirement*"), and
 * `ego_item` ships 23 names twice - so all three failed the test, were
 * classified whole-file, and a mod adding ONE object replaced all 375 of core's.
 * Those were exactly the three files most worth adding to. record-key.ts already
 * declared the real per-file identity; this now asks it instead of guessing.
 *
 * A record answers to SEVERAL refs, so the test is "has at least one ref no
 * sibling claims" rather than "its first ref is unique": an ego whose name core
 * ships twice is addressed by its discriminated form.
 *
 * A CONFIG SINGLETON IS STILL PASSTHROUGH, and that is not an oversight. Its key
 * is the FILE, so keying it per record would be legal and wrong: two packs
 * shipping `constants.json` would compose to two constants records under two
 * refs, and the host binds one. "Use mine" is what shipping a singleton means.
 */
function recordsComposable(file: string, records: readonly unknown[]): boolean {
  const spec = keySpecFor(file);
  if (spec.kind === "singleton") return false;
  const claimants = new Map<string, number>();
  const keysOf: (readonly string[])[] = [];
  for (const r of records) {
    const keys = recordRefKeys(file, r, spec);
    if (keys.length === 0) return false;
    keysOf.push(keys);
    for (const key of keys) claimants.set(key, (claimants.get(key) ?? 0) + 1);
  }
  return keysOf.every((keys) => keys.some((k) => claimants.get(k) === 1));
}

/**
 * What a caller can tell the composer beyond the packs themselves.
 *
 * Only sections so far, and deliberately an OPTIONS BAG rather than a second
 * positional argument: the two composition entry points are called from the web
 * host, the desktop host, the CLI and the tests, and every one of those would
 * have had to learn a new parameter for a value most of them do not have.
 */
export interface ComposeOptions {
  /**
   * Which of each pack's named sections are on: modId -> sectionId -> on. A
   * section not mentioned is ON, so a caller that knows nothing about sections
   * composes every pack whole, exactly as before they existed.
   *
   * Resolved by the caller (resolveSectionState) rather than here, because the
   * inputs are the player's stored choices and the enabled set - host state the
   * composer has no business reading.
   */
  sections?: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
}

/** The is-this-section-on predicate expandSections wants, from the options bag. */
function sectionPredicate(
  options: ComposeOptions,
): (packId: string, sectionId: string) => boolean {
  const table = options.sections;
  if (!table) return () => true;
  return (packId, sectionId) => table[packId]?.[sectionId] ?? true;
}

/** Reorder loaded packs into resolved load order (dependencies first). */
function orderPacks(packs: readonly LoadedPack[]): LoadedPack[] {
  const ordered = resolveLoadOrder(packs.map((p) => p.manifest));
  const byId = new Map(packs.map((p) => [p.manifest.id, p]));
  return ordered.map((m) => byId.get(m.id) as LoadedPack);
}

/** The pack id a ref's "<owner>:<slug>" prefix names. */
function ownerOf(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? "" : ref.slice(0, at);
}

/** compose.ts mayModify: a pack may only touch its own or a declared dep's records. */
function mayModify(m: PackManifest, ownerPack: string): boolean {
  return ownerPack === m.id || (m.dependencies ?? {})[ownerPack] !== undefined;
}

/** The four per-record op kinds, in the order composePacks applies them. */
type OpKind = "patch" | "replace" | "fieldPatch" | "remove";

/** Every per-record op in one contribution, flattened, in apply order. */
function perRecordOps(
  contrib: FileContribution,
): Array<{ kind: OpKind; ref: string }> {
  const out: Array<{ kind: OpKind; ref: string }> = [];
  for (const ref of Object.keys(contrib.patches ?? {})) out.push({ kind: "patch", ref });
  for (const ref of Object.keys(contrib.replaces ?? {})) out.push({ kind: "replace", ref });
  for (const ref of Object.keys(contrib.fieldPatches ?? {})) {
    out.push({ kind: "fieldPatch", ref });
  }
  for (const ref of contrib.removes ?? []) out.push({ kind: "remove", ref });
  return out;
}

const OP_VERB: Readonly<Record<OpKind, string>> = {
  patch: "patches",
  replace: "replaces",
  fieldPatch: "fieldPatches",
  remove: "removes",
};

/**
 * Apply every pack's per-record ops to a PASSTHROUGH file's winning record
 * array, in load order, and report every op that could not be honoured.
 *
 * Returns the (possibly new) record array; the input is never mutated, and when
 * no pack contributes an op the input array is returned unchanged so routing the
 * base game alone through this path stays a no-op by reference.
 *
 * Provenance is stamped HERE rather than by the caller because this is the only
 * place that knows which packs' ops actually landed on which record. A caller
 * could see that a mod contributed ops to the file; only this loop knows that
 * three of them were refused and the fourth hit record 12.
 */
function applyPassthroughOps(
  file: string,
  records: readonly unknown[],
  ordered: readonly LoadedPack[],
  providerId: string,
  baseId: string,
  refused: Refusals,
): unknown[] {
  /** Whole-file ownership with nothing layered on: the caller's array, as it was. */
  const unmodified = (): unknown[] =>
    providerId === baseId
      ? (records as unknown[])
      : records.map((r) => stampProvenance(r, providerId, [], baseId));

  const hasOps = ordered.some(
    (p) => p.files[file] !== undefined && perRecordOps(p.files[file] as FileContribution).length > 0,
  );
  if (!hasOps) return unmodified();

  /* No declared identity (history: chart/next/roll/phrase are all values a mod
   * would change). Every op is reported and none is applied - the one honest
   * answer, because inventing a key here would mis-merge instead of dropping. */
  if (RECORD_KEY_SPECS[file] === undefined && !recordsKeyedByName(records)) {
    for (const pack of ordered) {
      const contrib = pack.files[file];
      if (!contrib) continue;
      for (const { kind, ref } of perRecordOps(contrib)) {
        refused.refuse(
          pack.manifest.id,
          `${file} ${OP_VERB[kind]} "${ref}", but ${file} records have no per-record identity, so only whole-file replacement can change them`,
        );
      }
    }
    return unmodified();
  }

  const spec = keySpecFor(file);
  const working: Array<JsonRecord | null> = records.map((r) =>
    typeof r === "object" && r !== null && !Array.isArray(r) ? (r as JsonRecord) : null,
  );

  /* ref -> EVERY position claiming it. Kept as a list rather than resolved to a
   * winner on insert, so "not found" and "claimed twice" are one lookup with two
   * outcomes: there is nowhere for a first-claim-wins fallback to hide. A ref two
   * records claim is unaddressable and reported; both records stay in the game.
   *
   * A record claims SEVERAL refs (record-key.ts): its base key, its discriminated
   * form where the file declares one, and - unless it would shadow another
   * record's primary - the pre-2026-08-08 lossy slug, so refs written against an
   * older engine keep resolving. Registering all of them here is what took the
   * shipped pack from 73 records no ref could name to zero. */
  const claims = new Map<string, number[]>();
  const claim = (ref: string, i: number): void => {
    const at = claims.get(ref);
    if (at) at.push(i);
    else claims.set(ref, [i]);
  };
  const primary = new Set<string>();
  records.forEach((record) => {
    for (const key of recordRefKeys(file, record, spec)) primary.add(key);
  });
  records.forEach((record, i) => {
    // An unkeyable record stays in the game; it is simply not addressable.
    for (const key of recordRefKeys(file, record, spec)) {
      claim(`${providerId}:${key}`, i);
    }
    const legacy = legacyRecordKey(file, record, spec);
    if (legacy !== null && !primary.has(legacy)) claim(`${providerId}:${legacy}`, i);
  });

  const removed = new Set<number>();

  /* Which packs' ops LANDED on each record, in the order they landed. Recorded
   * per applied op rather than per contributing pack, and without deduping,
   * because that is exactly what compose.ts does for the composable files - two
   * files that disagreed about the shape of the same list would be worse than
   * either answer. */
  const modifiers: string[][] = records.map(() => []);

  /** The refs that resolve to exactly record `i` - what to suggest on ambiguity. */
  const unambiguousRefs = (i: number): string[] => {
    const record = records[i];
    return recordRefKeys(file, record, spec)
      .map((key) => `${providerId}:${key}`)
      .filter((r) => (claims.get(r) ?? []).length === 1);
  };

  const reject = (pid: string, kind: OpKind, ref: string, why: string): void => {
    refused.refuse(pid, `${file} ${OP_VERB[kind]} "${ref}", but ${why}`);
  };

  /** Resolve a ref to a live index, or report why it cannot be touched. */
  const resolve = (
    pack: LoadedPack,
    kind: OpKind,
    ref: string,
  ): number | null => {
    const pid = pack.manifest.id;
    const claimants = claims.get(ref) ?? [];
    if (claimants.length > 1) {
      /* Hand back the refs that DO resolve to these records rather than only
       * saying the ref is ambiguous. An author who wrote "core:of-acid" cannot
       * derive "core:of-acid#sword-polearm-hafted" from a description of the key
       * spec - they would have to read record-key.ts - and a message that leaves
       * them nowhere to go is how a seam gets a reputation for not working. */
      const alternatives = claimants
        .flatMap((i) => unambiguousRefs(i))
        .filter((r) => r !== ref);
      reject(
        pid,
        kind,
        ref,
        alternatives.length > 0
          ? `${claimants.length} ${file} records share that identity (${keyDescription(file)}) - name one of them instead: ${alternatives.join(", ")}`
          : `${claimants.length} ${file} records share that identity (${keyDescription(file)}), so it cannot be addressed - patch a record with a unique identity instead`,
      );
      return null;
    }
    const at = claimants[0];
    if (at === undefined) {
      reject(
        pid,
        kind,
        ref,
        `no such record exists in ${file} (identity is ${keyDescription(file)})${RENAMED_HINT}`,
      );
      return null;
    }
    if (removed.has(at)) {
      reject(pid, kind, ref, "an earlier pack already removed it");
      return null;
    }
    if (!mayModify(pack.manifest, ownerOf(ref))) {
      reject(
        pid,
        kind,
        ref,
        `${pid} does not declare ${ownerOf(ref)} as a dependency`,
      );
      return null;
    }
    return at;
  };

  for (const pack of ordered) {
    const contrib = pack.files[file];
    if (!contrib) continue;

    for (const [ref, body] of Object.entries(contrib.patches ?? {})) {
      const at = resolve(pack, "patch", ref);
      if (at === null) continue;
      working[at] = mergePatch(working[at] as JsonRecord, body);
      modifiers[at]?.push(pack.manifest.id);
    }
    for (const [ref, body] of Object.entries(contrib.replaces ?? {})) {
      const at = resolve(pack, "replace", ref);
      if (at === null) continue;
      working[at] = body;
      modifiers[at]?.push(pack.manifest.id);
    }
    for (const [ref, ops] of Object.entries(contrib.fieldPatches ?? {})) {
      const at = resolve(pack, "fieldPatch", ref);
      if (at === null) continue;
      working[at] = applyFieldPatch(working[at] as JsonRecord, ops);
      modifiers[at]?.push(pack.manifest.id);
    }
    for (const ref of contrib.removes ?? []) {
      const at = resolve(pack, "remove", ref);
      if (at === null) continue;
      removed.add(at);
    }
  }

  const out: unknown[] = [];
  working.forEach((r, i) => {
    if (removed.has(i)) return;
    out.push(stampProvenance(r === null ? records[i] : r, providerId, modifiers[i] ?? [], baseId));
  });
  return out;
}

/** Whether a passthrough file's records are name-keyed after all (mod-only file). */
function recordsKeyedByName(records: readonly unknown[]): boolean {
  return records.some((r) => isNamedRecord(r));
}

/**
 * Compose a set of loaded packs into merged per-file record arrays. With a
 * single pack (the base game alone) the output is record-identical to the
 * input: every record object is preserved by reference and its order is
 * unchanged, so routing the base game through this path is a no-op.
 */
export function composeContentPacks(
  packs: readonly LoadedPack[],
  options: ComposeOptions = {},
): ComposedContent {
  /* TWO STEPS. resolveLoadOrder first, over the UNIQUE manifests - it refuses a
   * duplicate pack id, so it has to run before sections turn one pack into
   * several entries. Then expandSections drops the parts the player switched off
   * and repositions the banded ones. Everything below sees `ordered`, a list in
   * which one pack may appear more than once; composePacks already keys by
   * manifest.id and folds in sequence, so that composes exactly as the combined
   * contribution would - except at different points in the order. */
  const ordered = expandSections(orderPacks(packs), sectionPredicate(options)).map(
    (u) => u.content,
  );
  const refused = refusals();

  const fileNames = new Set<string>();
  for (const p of ordered) {
    for (const f of Object.keys(p.files)) fileNames.add(f);
  }

  // Classify each file: per-record composable, or whole-file passthrough.
  const composable = new Set<string>();
  for (const f of fileNames) {
    let ok = true;
    for (const p of ordered) {
      const contrib = p.files[f];
      if (contrib?.records && !recordsComposable(f, contrib.records)) {
        ok = false;
        break;
      }
    }
    if (ok) composable.add(f);
  }

  const contents: PackContent[] = ordered.map((p) => {
    const files: Record<string, FileContribution> = {};
    for (const [f, contrib] of Object.entries(p.files)) {
      if (composable.has(f)) files[f] = contrib;
    }
    return { manifest: p.manifest, files };
  });

  /* Report, do not throw: a patch aimed at a record the engine has since renamed
   * costs that patch, not the mod. See ComposePacksOptions for why the throwing
   * default is still the right answer for a mod's own build. */
  const game = composePacks(contents, { onRefuse: refused.refuse });

  /* PACK ZERO IS THE FLOOR. Ownership by the base game with nothing layered on
   * top is the unremarkable case and is left unstamped, which is what keeps
   * "compose the base game alone and get your own objects back" true. Falling
   * back to "core" when there are no packs at all matches ContentIdResolver's
   * own default, so the writer and the reader agree about the same absence. */
  const baseId = packs[0]?.manifest.id ?? "core";

  const out: Record<string, unknown[]> = {};
  for (const [file, table] of game) {
    out[file] = [...table.values()].map((r) =>
      stampProvenance(r.value, r.owner, r.modifiedBy, baseId),
    );
  }

  /* Passthrough files, in two phases (see the header): the last provider in load
   * order wins the whole file, then every pack's per-record ops apply on top. */
  for (const f of fileNames) {
    if (composable.has(f)) continue;

    let providerId = "";
    for (const p of ordered) {
      const contrib = p.files[f];
      if (!contrib?.records) continue;
      if (providerId !== "") {
        /* Whole-file replacement is destructive and used to be invisible: the
         * previous provider's records simply vanished. Say so. */
        refused.refuse(
          p.manifest.id,
          `${f} replaces the whole file, discarding ${(out[f] as unknown[]).length} record(s) from ${providerId} - ${f} records have no ref of their own, so a whole file is the only thing that can be added to it`,
        );
      }
      out[f] = [...contrib.records];
      providerId = p.manifest.id;
    }

    if (providerId === "") {
      /* SAFETY NET, not a live path. A file is only classified passthrough
       * because some pack's `records` for it are not name-keyed, and such a pack
       * is by definition a provider - so today providerId is never "" here. The
       * equivalent case for a COMPOSABLE file (a mod patches a file nobody
       * supplies records for) is loud already: composePacks throws
       * "patch target ... does not exist". This branch is kept, cordoned and
       * documented rather than deleted, because if the classification ever
       * changes its absence would be a silent drop - the exact failure this file
       * exists to prevent. Covered by loader.test.ts only through the composable
       * counterpart. */
      for (const p of ordered) {
        const contrib = p.files[f];
        if (!contrib) continue;
        for (const { kind, ref } of perRecordOps(contrib)) {
          refused.refuse(
            p.manifest.id,
            `${f} ${OP_VERB[kind]} "${ref}", but no pack supplies any ${f} records`,
          );
        }
      }
      continue;
    }

    out[f] = applyPassthroughOps(f, out[f] as unknown[], ordered, providerId, baseId, refused);
  }

  /* THE FIELD POLICY RUNS LAST, over the composed result, because that is the
   * only point at which every pack's contribution to a record is present: a
   * field declared by mod A and written by a patch from mod B is legal, and
   * checking either pack in isolation would refuse it. */
  const declared = declaredFields(ordered.map((p) => p.manifest));
  for (const [file, records] of Object.entries(out)) {
    const objects = records.filter(
      (r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r),
    );
    for (const fault of applyFieldPolicy(file, objects, declared)) {
      refused.refuse(fault.packId, fault.message);
    }
  }

  /* THE RECORD CHECK, over the composed result and over the ORIGINAL pack list.
   *
   * `packs`, not `ordered`: expandSections turns one pack into several entries,
   * and checking each entry would report a pack once per named part it ships.
   * resolveLoadOrder has already refused a duplicate id by this point, so the
   * input list is exactly one entry per pack.
   *
   * `packs[0]` is the base game - the convention this file already keeps, stated
   * in composeDroppingBroken - and it is not reported on. See validate.ts.
   *
   * WARN AND ABOVE. `hint` is drafting advice ("core always writes `desc`") and
   * belongs to the builder, where the author is sitting there with the draft
   * open. At load the audience is a player asking why a mod does nothing and an
   * author reading their bug report, and dozens of stylistic lines on a working
   * mod's row would bury the one line that matters. */
  const base = packs[0];
  const findings = checkPacks(packs, composedObjects(out), {
    minLevel: "warn",
    ...(base === undefined ? {} : { baseId: base.manifest.id }),
  });

  return {
    records: out,
    composedFiles: [...composable].sort(),
    passthroughFiles: [...fileNames].filter((f) => !composable.has(f)).sort(),
    problems: refused.problems,
    faults: refused.faults,
    declaredFields: [...declared.values()],
    findings,
  };
}

/** One pack that was left out of a composition, and why. */
export interface DroppedPack {
  /** The pack's id. */
  readonly id: string;
  /** What it did that could not be composed, as the thrower said it. */
  readonly why: string;
}

/**
 * Compose, dropping any pack whose contribution or manifest makes composition
 * IMPOSSIBLE, and reporting which ones went.
 *
 * WHY THIS EXISTS. Everything in this file reports rather than throws, and that
 * made the throwing paths easy to forget: `composePacks` threw ComposeError on a
 * patch whose target does not exist or a duplicate record name, and
 * `resolveLoadOrder` throws ResolveError on a missing dependency or a cycle. Both
 * are reachable from `composeContentPacks` and both are caused by a MOD - so on
 * the web host, which composes at module scope with no try, one mod's typo was a
 * blank page. Not a bad message: no page, and therefore no mod manager to open
 * and no way to turn the offending mod off again. The only exit was clearing
 * localStorage.
 *
 * WHAT IS LEFT FOR IT TO CATCH. composeContentPacks now hands composePacks an
 * `onRefuse` reporter, so a bad contribution is a reported line rather than a
 * throw and never reaches here. What still throws is `resolveLoadOrder`: a
 * missing dependency or a hard cycle is a statement about the SET of enabled
 * mods, there is no single op to skip, and dropping a pack is the only move that
 * makes the rest of them loadable. This is not dead code - it is the same
 * function with a smaller and better-defined job - and the tests below drive it
 * through resolve.ts rather than through a patch typo.
 *
 * ONE BROKEN MOD COSTS THAT MOD. That is already the rule everywhere else here -
 * a bad record file loses one contribution, a plugin that throws at import loses
 * one plugin, a register() that throws loses one mod - and it is what this
 * restores for the throwing paths. Each thrown message names its pack
 * (`<pid>/<file>: ...` from compose.ts, `pack <id> requires ...` from resolve.ts),
 * so the offender is identified, removed, and composition retried.
 *
 * `packs[0]` is the BASE GAME and is never dropped: if it is the pack named, or if
 * no pack can be identified from the message, everything but the base is dropped
 * at once. A game with no content cannot start, so that is the floor - and it is
 * the outcome a player recognises ("my mods are off") rather than a dead tab.
 *
 * The loop is bounded by the pack count: every pass either returns or removes one
 * pack, so it cannot spin.
 */
export function composeDroppingBroken(
  packs: readonly LoadedPack[],
  options: ComposeOptions = {},
): {
  readonly composed: ComposedContent;
  readonly dropped: readonly DroppedPack[];
} {
  const base = packs[0];
  let live = [...packs];
  const dropped: DroppedPack[] = [];

  for (let pass = 0; pass <= packs.length; pass++) {
    try {
      return { composed: composeContentPacks(live, options), dropped };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      const culprit = live
        .slice(1)
        .map((p) => p.manifest.id)
        .find((id) => namesPack(why, id));
      if (culprit === undefined) {
        /* Nobody identifiable, or the base game itself. Fall back to the base
         * alone, which composes by construction (a single pack is a no-op), and
         * say so once per mod that lost out rather than pretending they loaded. */
        for (const p of live.slice(1)) dropped.push({ id: p.manifest.id, why });
        live = base ? [base] : [];
        continue;
      }
      dropped.push({ id: culprit, why });
      live = live.filter((p) => p.manifest.id !== culprit);
    }
  }
  /* Unreachable: the base alone always composes. Returning an empty composition
   * rather than throwing keeps the promise this function exists to make. */
  return {
    composed: {
      records: {},
      composedFiles: [],
      passthroughFiles: [],
      problems: [],
      faults: [],
      declaredFields: [],
      findings: [],
    },
    dropped,
  };
}

/**
 * Whether a thrown message is ABOUT this pack.
 *
 * Both throwers put the id at a boundary - `${pid}/${file}: ...` and
 * `pack ${id} requires ...` - so the id is matched with its delimiters rather than
 * as a substring. A bare `includes(id)` would let the pack "qol" claim a message
 * about "qol-extras", and then this would drop the wrong mod and leave the broken
 * one in, which loops until everything is gone.
 */
function namesPack(message: string, id: string): boolean {
  for (const pattern of [`${id}/`, `${id}:`, `pack ${id} `, ` ${id},`, ` ${id} `]) {
    if (message.includes(pattern)) return true;
  }
  return message.endsWith(` ${id}`);
}
