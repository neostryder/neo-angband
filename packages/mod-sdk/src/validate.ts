/**
 * The record check, run against a set of packs rather than against a draft.
 *
 * WHY THIS FILE EXISTS. `index.ts` has said since the SDK was written that a
 * content pack is "schema-validated declarative JSON (safe by construction)",
 * and MOD_REACH gap 12 recorded that as a claim with no code behind it. The
 * second half of that was wrong, and wrong in the more interesting direction:
 * the check is fully built (`checkRecords` over `RECORD_BLUEPRINTS`, 4,630 lines
 * measured from core's own shipped records) and thoroughly tested - and its only
 * caller was `ModProject.build`, the MOD BUILDER. A control enforced by the
 * author's tool and absent from the load path is not a control: a mod installed
 * from a zip, hand-edited in the mods folder, or produced by any other tool has
 * never been near it. `checkRecords` is the mechanism; this is the reach.
 *
 * SUBJECT SELECTION IS THE WHOLE PROBLEM, and `ModProject.build` had already
 * solved it. Three constraints shape it:
 *
 *  - A patch cannot be checked as written. `{"weight": 40}` aimed at a dagger
 *    has no `name`, so every required-field rule would fire on every patch. What
 *    has to be checked is the record the patch PRODUCED - the thing the game
 *    will actually read.
 *  - Membership is decided by `recordRefKeys`, the identity composition itself
 *    uses, not by matching on `name`: fourteen record files have no `name`, and
 *    a second spelling of an identity that already has one is how the two drift.
 *  - The base game is not reported on. Core's own data raises 65 warnings
 *    against its own blueprint - almost all `reference/dangling` on artifact
 *    `base-object` refs, which are upstream warts the port keeps on purpose
 *    (references.ts says so). Putting those on a player's screen at every boot,
 *    with no mods installed, is crying wolf on the base game.
 *
 * So `ModProject.build` now calls the same function the loader does, and the
 * builder's answer and the game's answer cannot disagree about what a mod is
 * answerable for.
 *
 * REPORT, NEVER REFUSE. A finding costs nothing - not the record, not the mod.
 * The blueprint is a MEASUREMENT of core's data, and its own header says an
 * unlisted value is legal ("a mod adding a new tval or a new slay code is doing
 * something legal"). Dropping a mod over a statistic would punish the exact
 * experimentation the mod system exists to allow. What a finding buys is the
 * answer to "why is my mod not doing anything", on that mod's own row, which is
 * the thing that was missing.
 */

import { checkRecords } from "./authoring.js";
import type { AuthoringFinding, FindingLevel } from "./authoring.js";
import type { FileContribution, JsonRecord } from "./compose.js";
import { recordRefKeys } from "./record-key.js";

/** The key half of a `<pack>:<key>` ref. */
function refKey(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? ref : ref.slice(at + 1);
}

/** A finding with the pack it belongs to kept separate from the sentence. */
export interface PackFinding extends AuthoringFinding {
  /** The pack the record belongs to, or that patched it. */
  readonly packId: string;
}

/** A pack as the check needs to see it: an id and its contributions. */
export interface CheckablePack {
  readonly manifest: { readonly id: string };
  readonly files: Readonly<Record<string, FileContribution>>;
}

/** Every composed record, per file, with the non-objects filtered out. */
export type ComposedRecords = Readonly<Record<string, readonly JsonRecord[]>>;

/**
 * Narrow a composed `Record<string, unknown[]>` to the record objects the check
 * can speak about.
 *
 * Passthrough files can hold arrays and scalars (that is why they are
 * passthrough), and `checkRecords` reads `Object.entries` off every element. One
 * conversion, here, so the two callers cannot disagree about what a record is.
 */
export function composedObjects(
  records: Readonly<Record<string, readonly unknown[]>>,
): ComposedRecords {
  const out: Record<string, readonly JsonRecord[]> = {};
  for (const [file, list] of Object.entries(records)) {
    out[file] = list.filter(
      (r): r is JsonRecord => r !== null && typeof r === "object" && !Array.isArray(r),
    );
  }
  return out;
}

/** Every ref key this contribution touches, per file, sections included. */
function touchedKeys(
  files: Readonly<Record<string, FileContribution>>,
): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>();
  const want = (file: string, key: string): void => {
    const set = wanted.get(file) ?? new Set<string>();
    set.add(key);
    wanted.set(file, set);
  };

  const walk = (file: string, contrib: FileContribution): void => {
    for (const r of contrib.records ?? []) {
      for (const k of recordRefKeys(file, r)) want(file, k);
    }
    /* All four ref-keyed op kinds, not the three ModProject happened to hold in
     * maps. `patches` is the one a hand-written mod reaches for first, and
     * leaving it out would have made the commonest contribution the one the
     * check could not see. Only the key half of `<pack>:<key>` is compared -
     * which pack OWNS the record is not the question, whether this one touched
     * it is. */
    for (const ref of Object.keys(contrib.patches ?? {})) want(file, refKey(ref));
    for (const ref of Object.keys(contrib.replaces ?? {})) want(file, refKey(ref));
    for (const ref of Object.keys(contrib.fieldPatches ?? {})) want(file, refKey(ref));
    /* `removes` deliberately absent: the record is GONE from the composed set,
     * so there is nothing to check, and a ref that matched nothing is already
     * reported by the composer's own refusal. */
    for (const section of Object.values(contrib.sections ?? {})) walk(file, section);
  };

  for (const [file, contrib] of Object.entries(files)) walk(file, contrib);
  return wanted;
}

/**
 * The records one pack is answerable for, as composition produced them.
 *
 * A SECTION THE PLAYER SWITCHED OFF costs nothing here and needs no special
 * case: its records never reached `all`, so no composed record carries its keys
 * and the filter drops them. That is the same rule the rest of the system
 * keeps - a disabled part's contributions do not exist.
 */
export function packSubject(
  files: Readonly<Record<string, FileContribution>>,
  all: ComposedRecords,
): Record<string, readonly JsonRecord[]> {
  const subject: Record<string, readonly JsonRecord[]> = {};
  for (const [file, keys] of touchedKeys(files)) {
    const matched = (all[file] ?? []).filter((r) =>
      recordRefKeys(file, r).some((k) => keys.has(k)),
    );
    if (matched.length > 0) subject[file] = matched;
  }
  /* A file whose records composition dropped ENTIRELY still gets checked, on
   * what the pack wrote, so a mod is never silently unexamined. This is the case
   * where the answer matters most: the records are missing from the game and the
   * author is owed a reason. */
  for (const [file, contrib] of Object.entries(files)) {
    const drafts = draftsOf(contrib);
    if (drafts.length > 0 && (subject[file] ?? []).length === 0) subject[file] = drafts;
  }
  return subject;
}

/**
 * Every whole record a contribution writes, NOT counting its named sections.
 *
 * The asymmetry with `touchedKeys`, which does walk sections, is deliberate and
 * is the safe direction. Matching a composed record by key is self-limiting: a
 * section the player switched off contributed nothing, so nothing matches and
 * nothing is said. The draft fallback has no such protection - it reads what the
 * pack WROTE - and this function cannot tell an off section from an on one,
 * because that answer lives in host state the composer resolves before it gets
 * here. Warning a player about a part they deliberately turned off is the worse
 * failure, so the fallback covers only the pack's unsectioned records.
 */
function draftsOf(contrib: FileContribution): readonly JsonRecord[] {
  return contrib.records ?? [];
}

/** What `checkPacks` reports on. */
export interface CheckPacksOptions {
  /** Findings at or above this level only. Default: everything. */
  readonly minLevel?: FindingLevel;
  /**
   * The pack that is the BASE GAME rather than a mod, and so is not reported on.
   * Absent means every pack is reported on, which is what a mod's own build
   * wants: there the mod under construction is the only pack that matters and
   * core is passed in purely so its records exist to resolve against.
   */
  readonly baseId?: string;
}

/**
 * Check every pack's own records against core's blueprint, attributed.
 *
 * `all` is the COMPOSED set, which is what makes a cross-pack reference resolve:
 * a mod whose monster drops another mod's object is checked against the game as
 * it will actually be, not against its own folder.
 */
export function checkPacks(
  packs: readonly CheckablePack[],
  all: ComposedRecords,
  options: CheckPacksOptions = {},
): PackFinding[] {
  const out: PackFinding[] = [];
  for (const pack of packs) {
    const packId = pack.manifest.id;
    if (packId === options.baseId) continue;
    const subject = packSubject(pack.files, all);
    if (Object.keys(subject).length === 0) continue;
    const floor = options.minLevel === undefined ? {} : { minLevel: options.minLevel };
    for (const finding of checkRecords(subject, all, floor)) {
      out.push({ ...finding, packId });
    }
  }
  return out;
}

/**
 * NO `findingLine` HERE, deliberately, and the absence is the point.
 *
 * Every other channel in this package pairs an attributed shape with a
 * line-formatter, because its messages are built from parts and something has to
 * decide the punctuation. A finding is not: `message` already names its file and
 * its record - every rule in authoring.ts and references.ts writes the sentence
 * that way - and `packId` sits beside it for the row. A formatter would be a
 * second spelling of a string that already exists, and the first host that
 * wanted a slightly different one would parse it back apart.
 */

