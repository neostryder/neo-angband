/**
 * Loads the active pack set into a GamePack the engine can start.
 *
 * The compiled pack JSON lives in @rpgm-tools/neo-angband-content; Vite's glob import
 * inlines every file into the bundle at build time, so the whole game ships as
 * one static asset with no runtime fetch.
 *
 * As of MOD_INTEGRATION_PLAN.md Wave 1, the base game is no longer bound
 * directly: it flows through the mod compose pipeline as "pack zero"
 * (composeContentPacks -> merged per-file records -> GamePack -> core
 * bindCore). With only core loaded the composed output is record-identical, so
 * this is a no-op today; it is the seam mods plug into (W1.3). Core stays
 * mod-sdk-agnostic - this host module owns the glue.
 */

import { CORE_RECORD_KEYS } from "@rpgm-tools/neo-angband-core";
import type {
  GamePack,
  SavePackRef,
  UiEntryPackRecords,
} from "@rpgm-tools/neo-angband-core";
import { log } from "./logging";
import {
  checkUnqualified,
  composeDroppingBroken,
  computeConflictReport,
  hasFacet,
  resolveLoadOrder,
  resolveSectionState,
  sectionFlag,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type {
  LoadedPack,
  PackContent,
  PackManifest,
  RecordConflict,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { ConflictRow } from "./mod-conflicts";
import { defaultModStore, isShippedMod, readEnabledModIds } from "./mod-store";
import { diskPacks, sessionPacks, type ModDirKind, type ModOrigin } from "./disk-packs";
import { sessionMods } from "./mod-session";
import { activeModCode } from "./mod-code";
import { engineAllows, engineProblem } from "./mod-engine";
import { dedupeProblems, modFaults, type ModProblem } from "./mod-problems";

// Eagerly import every compiled pack file. Keys are module paths; values
// are the parsed JSON (the file's default export).
const files = import.meta.glob("../../content/pack/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** Parsed pack files keyed by basename without extension ("monster", ...). */
const byName = new Map<string, unknown>();
for (const [key, val] of Object.entries(files)) {
  const m = /([^/]+)\.json$/.exec(key);
  if (m && m[1]) byName.set(m[1], val);
}

function rawFile(name: string): unknown {
  const f = byName.get(name);
  if (f === undefined) throw new Error(`pack file not found: ${name}.json`);
  return f;
}

/** The on-disk manifest (manifest.json) adapted to a PackManifest. */
function coreManifest(): PackManifest {
  const m = byName.get("manifest") as
    | { id?: string; name?: string; version?: string; engine?: string }
    | undefined;
  return {
    id: m?.id ?? "core",
    name: m?.name ?? "Angband",
    version: m?.version ?? "0.0.0",
    shape: "content",
    ...(m?.engine ? { engine: m.engine } : {}),
  };
}

/** The base game as a LoadedPack: every record-bearing file, records-only. */
function coreLoadedPack(): LoadedPack {
  const contrib: Record<string, { records: unknown[] }> = {};
  for (const [name, val] of byName) {
    if (name === "manifest") continue;
    const recs = (val as { records?: unknown[] }).records;
    if (Array.isArray(recs)) contrib[name] = { records: recs };
  }
  return { manifest: coreManifest(), files: contrib } as unknown as LoadedPack;
}

/* ------------------------------------------------------------------ *
 * Mods (W1.3): bundled packs under packages/web/mods/<id>/, disabled by
 * default. Enable with ?mods=a,b (wins) or localStorage neo:enabledMods.
 * The full mod-manager UI (enable/reorder/consent) is W2.4.
 * ------------------------------------------------------------------ */

const modManifestGlob = import.meta.glob("../mods/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const modFileGlob = import.meta.glob("../mods/*/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/**
 * modId -> { manifest, files } gathered from packages/web/mods/<id>/. The
 * demo-* framework proofs are dropped from release builds (isShippedMod), so a
 * shipped game discovers exactly the three bundled mods.
 */
function discoverMods(): Map<
  string,
  { manifest: unknown; files: Record<string, unknown> }
> {
  const mods = new Map<
    string,
    { manifest: unknown; files: Record<string, unknown> }
  >();
  for (const [key, val] of Object.entries(modManifestGlob)) {
    const m = /\/mods\/([^/]+)\/manifest\.json$/.exec(key);
    if (m && m[1] && isShippedMod(m[1])) mods.set(m[1], { manifest: val, files: {} });
  }
  for (const [key, val] of Object.entries(modFileGlob)) {
    const m = /\/mods\/([^/]+)\/([^/]+)\.json$/.exec(key);
    if (!m || !m[1] || !m[2] || m[2] === "manifest") continue;
    const mod = mods.get(m[1]);
    if (mod) mod.files[m[2]] = val;
  }
  /* Packs from the user's mods DIRECTORY, read at boot (disk-packs.ts). Merged
   * into the same map because a disk pack is not a different KIND of pack - same
   * manifest, same record files - it just arrived by being copied into a folder
   * instead of by being bundled.
   *
   * THIS COMMENT USED TO SAY "latched before this runs", AND IT WAS FALSE from the
   * day the mods directory was added: this ran at module scope, and main.ts latches
   * in its own body, which ES module order puts second. See composition() below for
   * the measurement. It is true now because nothing here runs until something asks
   * for content, and the first ask comes after boot.
   *
   * A disk pack with a bundled pack's id LOSES, deliberately: shadowing a
   * first-party mod would let a folder silently redefine what "bug-fixes" is,
   * and the player would have no way to see which one they had enabled. It is
   * reported as a problem instead. */
  for (const pack of diskPacks().packs) {
    if (mods.has(pack.manifest.id)) continue;
    mods.set(pack.manifest.id, {
      manifest: pack.manifest,
      files: { ...pack.files },
    });
  }
  return mods;
}

/** Ids that came from the mods directory rather than from the bundle. */
export function diskPackIds(): ReadonlySet<string> {
  return new Set(diskPacks().packs.map((p) => p.manifest.id));
}

/**
 * Everything the mod manager needs to tell a player about the mods DIRECTORY:
 * where it is, what could not be read, and whether this front end even has one.
 */
export function diskPackStatus(): {
  available: boolean;
  dir: string | null;
  count: number;
  bundledCount: number;
  problems: readonly ModProblem[];
  skipped: readonly ModProblem[];
  kind: ModDirKind;
  origins: readonly ModOrigin[];
} {
  const r = diskPacks();
  const shadowed: ModProblem[] = r.packs
    .filter((p) => bundledModIds().has(p.manifest.id))
    .map((p) => ({
      id: p.manifest.id,
      why: "a bundled mod already uses this id; renaming it makes it loadable",
    }));
  const code = activeModCode();
  return {
    available: r.available,
    dir: r.dir,
    count: r.packs.length,
    /* The SHIPPED bundled mods, which is what the manager lists - the glob also
     * picks up the dev-only demo-* proofs, and isShippedMod is what filters them
     * out of the catalog, so counting them here would disagree with the list the
     * player is looking at. */
    bundledCount: [...bundledModIds()].filter((id) => isShippedMod(id)).length,
    /* EVERY SOURCE THAT KNOWS WHY A MOD IS NOT WORKING, in one list. Five of them,
     * and only the first two were reaching a screen before 2026-07-31:
     *
     *   r.problems         the pack READER: a manifest that will not validate, a
     *                      folder whose name disagrees with its id, a record file
     *                      that would not parse, a directory that would not open.
     *   composedProblems() the ENGINE GATE (a mod written for a different build of
     *                      the game, or an `engine` range that will not parse) and
     *                      the COMPOSER: a ref no record answers to, a ref two
     *                      records both claim, a per-record op against a file with
     *                      no keyable identity, a whole-file replacement that
     *                      discarded core records - and now a pack that could not
     *                      be composed at all.
     *   shadowed           a disk pack wearing a bundled mod's id.
     *   code.problems      the CODE loader: an unimportable plugin, an ABI
     *                      mismatch, plugin.js without the declared facet. Computed
     *                      on every failure path since the loader was written and
     *                      read by nothing.
     *   modFaults()        hooks() or register() throwing, which had gone to
     *                      console.error - a channel a player does not have.
     *
     * Collecting a diagnosis nobody renders is the same as not collecting it, which
     * is what four of these five amounted to.
     *
     * DEDUPED, because the engine gate is deliberately enforced by more than one of
     * them: a mod shipping records and a plugin is refused on both paths and both say
     * so. See dedupeProblems. */
    problems: dedupeProblems([
      ...r.problems,
      ...composedProblems(),
      ...shadowed,
      ...code.problems,
      ...modFaults(),
    ]),
    /* NOT faults: a mod that is off, or waiting for consent, is in the state the
     * player put it in. Kept separate so the manager can explain a plugin that is
     * enabled and still not running (awaiting consent) without calling it broken. */
    skipped: code.skipped,
    kind: r.kind,
    /* Every contributing source, not just the primary one: boot combines a folder
     * with any mods installed from repositories, and `kind`/`dir` can only describe
     * one of them. */
    origins: r.origins,
  };
}

/** The ids that come from the bundle, so a disk pack can be told apart. */
function bundledModIds(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of Object.keys(modManifestGlob)) {
    const m = /\/mods\/([^/]+)\/manifest\.json$/.exec(key);
    if (m && m[1] && isShippedMod(m[1])) out.add(m[1]);
  }
  return out;
}

/**
 * The manifests of every bundled CONTENT/tiles mod under packages/web/mods/,
 * for the mod-manager catalog (W2.4). Normalized via modManifest so callers get
 * a real PackManifest; the manager merges these with the plugin/trusted lists.
 */
export function discoverContentModManifests(): PackManifest[] {
  const out: PackManifest[] = [];
  for (const [, mod] of discoverMods()) {
    const m = modManifest(mod.manifest);
    // Plugins are surfaced by discoverPlugins/discoverTrustedPlugins; here it
    // list only packs with something to CONTRIBUTE as content, so the catalog
    // does not double-count. A hybrid (content + plugin) belongs here for its
    // content facet; a plugin-only pack does not.
    if (hasFacet(m, "content") || hasFacet(m, "tiles")) out.push(m);
  }
  return out;
}

/**
 * The content layer's rows (P7.6) for the mod-manager conflicts pane, for a
 * chosen enabled CONTENT set: one row per computeConflictReport humanLine, its
 * RecordConflict carried beside it as `record` - the same `ConflictRow<T>`
 * shape mod-conflicts.ts's other four layers use (mod-conflicts.ts, commit
 * 85d87e283), so a presenter can act on the fields a mod actually touched
 * without parsing the sentence.
 *
 * THIS USED TO FLATTEN THE RECORD AWAY. `computeConflictReport(...).records`
 * is field-granular - which fields, whose writes, who wins - and this function
 * turned it into `.flatMap(r => r.humanLines)` before mod-conflicts.ts ever saw
 * it: the content layer's rows arrived as prose while the other four layers
 * (mod-conflicts.ts, layerSlots) carried their ContestedSlot beside the
 * sentence. That was the ONE thing that forced `ConflictRow.record` to stay
 * nullable; see the note on the error path below for what still does.
 *
 * Builds the ordered LoadedPack set for the given ids (core + enabled content
 * mods), resolves load order, and runs computeConflictReport. Add-only mods and
 * a single contributor produce none.
 *
 * `record` is null for exactly one reason now, not "every content row": when
 * resolveLoadOrder throws before a single RecordConflict could be gathered - a
 * duplicate pack id, a missing dependency, an incompatible version range. There
 * is genuinely no record to attach, because composition never ran; the row
 * carries the thrown message alone, same as it always has (not a throw itself,
 * so the UI can show it).
 */
export function modConflictLines(
  enabledIds: readonly string[],
): readonly ConflictRow<RecordConflict | null>[] {
  const mods = discoverMods();
  const packs: LoadedPack[] = [coreLoadedPack()];
  for (const id of enabledIds) {
    const mod = mods.get(id);
    if (!mod) continue;
    const manifest = modManifest(mod.manifest);
    /* A mod this build refuses composes nothing, so it can conflict with nothing.
     * Listing its overlaps here would send the player looking for a load-order fix
     * to a problem they do not have. `engineAllows`, not `engineProblem`: a data
     * pack outside its declared range has a problem AND composes, so its overlaps
     * are real and belong in the report. */
    if (!engineAllows(manifest)) continue;
    if (!hasFacet(manifest, "content")) continue; // nothing to compose
    packs.push({
      manifest,
      files: mod.files as unknown as LoadedPack["files"],
    });
  }
  try {
    const ordered = resolveLoadOrder(packs.map((p) => p.manifest));
    const byId = new Map(packs.map((p) => [p.manifest.id, p]));
    const contents = ordered.map((m) => {
      const p = byId.get(m.id) as LoadedPack;
      return { manifest: p.manifest, files: p.files } as unknown as PackContent;
    });
    return computeConflictReport(contents).records.flatMap((r) =>
      r.humanLines.map((text) => ({ text, record: r })),
    );
  } catch (e) {
    return [{ text: e instanceof Error ? e.message : String(e), record: null }];
  }
}

/**
 * The EFFECTIVE enabled set - what the game actually loaded.
 *
 * Exported because the mod manager has to agree with it. It used to build its
 * [x] boxes straight from `store.getEnabled()`, which was the same thing until a
 * mods DIRECTORY existed: a pack an external manager deployed and listed in
 * load-order.json is loaded by the composer but is not in the player's stored
 * set, so the manager showed it as OFF while the game was running it. One
 * resolver, one answer.
 *
 * Enabled mod ids, via the shared reader (mod-store.readEnabledModIds):
 * URL ?mods=a,b wins; else the saved set in localStorage; else - on a first run
 * with no saved set - the DEFAULT_ENABLED_MODS that are actually discovered.
 * Distinguishing "no saved key" (first run -> defaults) from an empty array
 * (user turned everything off) is why that reader reads the raw key itself.
 */
export function enabledModIds(): string[] {
  /* The URL/localStorage reading, the player's explicit per-mod decisions and the
   * external manager's load-order.json all live in mod-store.readEnabledModIds, so
   * this surface and the tile discovery cannot answer differently. */
  return readEnabledModIds({
    discovered: [...discoverMods().keys()],
    diskOrder: diskPacks().order,
    /* Staging a mod for one session IS enabling it - there is no row to turn on,
     * and a leftover "off" choice from a copy the player once installed must not
     * silence the copy they just asked to try (mod-session.ts). */
    forced: sessionPacks().packs.map((p) => p.manifest.id),
  });
}

/**
 * A bundled or disk-pack mod's own manifest, by id - what a hook-entry adapter
 * needs to build THAT mod's CapabilitySet (ticket #133's `ctx.backupFolder` gate
 * and any capability after it) without re-deriving discoverMods' own
 * bundled-wins-over-disk precedence a second time.
 */
export function modManifestFor(id: string): PackManifest | undefined {
  const found = discoverMods().get(id);
  return found ? modManifest(found.manifest) : undefined;
}

export function modManifest(raw: unknown): PackManifest {
  const m = raw as Partial<PackManifest> & { id?: string };
  return {
    id: m.id ?? "mod",
    name: m.name ?? m.id ?? "mod",
    version: m.version ?? "0.0.0",
    shape: m.shape ?? "content",
    /* What the pack contributes, when it is more than its shape alone. Dropping
     * this would silently demote a hybrid mod to its primary facet - exactly the
     * class of bug the facet model exists to end. */
    ...(m.facets ? { facets: m.facets } : {}),
    ...(m.engine ? { engine: m.engine } : {}),
    ...(m.dependencies ? { dependencies: m.dependencies } : {}),
    /* ORDERING INPUTS, and they were all being dropped here. This normaliser is
     * an allowlist, so every field it forgets becomes a manifest key the player
     * can write and nothing can read: optionalDependencies, loadAfter and
     * loadBefore reached resolveLoadOrder as undefined for every mod discovered
     * through this path, making all three inert. */
    ...(m.optionalDependencies ? { optionalDependencies: m.optionalDependencies } : {}),
    ...(m.loadAfter ? { loadAfter: m.loadAfter } : {}),
    ...(m.loadBefore ? { loadBefore: m.loadBefore } : {}),
    ...(m.saveSchema !== undefined ? { saveSchema: m.saveSchema } : {}),
    ...(m.modApi !== undefined ? { modApi: m.modApi } : {}),
    ...(m.capabilities ? { capabilities: m.capabilities } : {}),
    /* The pack's DECLARED FIELDS. Forgetting this one is not inert like the
     * ordering hints were - it inverts the feature: every field the mod
     * declared would arrive undeclared, so composition would strip the very
     * keys the manifest exists to authorise, and the mod would look broken. */
    ...(m.fields ? { fields: m.fields } : {}),
    ...(m.nondeterministic !== undefined ? { nondeterministic: m.nondeterministic } : {}),
    ...(m.affectsGameplay !== undefined ? { affectsGameplay: m.affectsGameplay } : {}),
    ...(m.rules ? { rules: m.rules } : {}),
    ...(m.renamedRuleFlags ? { renamedRuleFlags: m.renamedRuleFlags } : {}),
    /* THE COMPATIBILITY FIELDS, and this allowlist is exactly where they would
     * have died. `sections` is what the composer gates parts on, `compat` is what
     * the conflict report and the sorter read, and `group` is how a mod sorts
     * against mods nobody has written yet - all three are read from the manifest
     * a mod SHIPS, and every mod that is discovered rather than hand-built reaches
     * the rest of the host through this function. Forgetting one here is not a
     * partial feature, it is a feature that does not exist outside the monorepo:
     * the author writes the field, the validator accepts it, and nothing ever
     * reads it. manifestAllowlist.test.ts is the census that keeps the next field
     * from doing the same. */
    ...(m.sections ? { sections: m.sections } : {}),
    ...(m.group ? { group: m.group } : {}),
    ...(m.compat ? { compat: m.compat } : {}),
    // The mod manager shows this to the player when they highlight the mod, so
    // it has to survive normalisation - dropping it here is what left the detail
    // pane with only the id and shape to say for itself.
    ...(m.description ? { description: m.description } : {}),
    ...(m.author ? { author: m.author } : {}),
    ...(m.license ? { license: m.license } : {}),
    /* FOUND BY THE CENSUS, not by review. These four were being dropped as well.
     * `tilePacks` has not shown a symptom because tile discovery reads the RAW
     * manifest off the glob and never comes through here (tile-mods.ts) - which
     * is exactly what makes it dangerous: the normalised manifest is the one the
     * catalogue, the conflict report and the mod detail pane read, so the first
     * consumer to ask a normalised manifest what modes a pack contributes would
     * be told "none" and be wrong. The provenance three are what a marketplace
     * listing and the detail pane are made of. */
    ...(m.tilePacks ? { tilePacks: m.tilePacks } : {}),
    /* THE CENSUS EARNED ITS KEEP AGAIN, on the day `resources` was added: the
     * field was written, the validator accepted it, the loader read it off the
     * RAW manifest - and this function dropped it, so anything reading a
     * NORMALISED manifest would have been told the mod supplies nothing. That is
     * the same shape as `tilePacks` above, and the same reason it is dangerous:
     * the symptom does not appear where the mistake is. */
    ...(m.resources ? { resources: m.resources } : {}),
    ...(m.repository ? { repository: m.repository } : {}),
    /* Which of the repository's files ARE the mod. Carried through because the
     * updater re-reads an installed mod's manifest to work out what to fetch for
     * the next version, and it reads the NORMALISED one - a mod that declared its
     * payload and then had it dropped here would silently fall back to the
     * whole-tree guess on every update. Caught by the allowlist census, not by
     * review, which is the third time that census has earned its keep. */
    ...(m.payload ? { payload: m.payload } : {}),
    ...(m.changelog ? { changelog: m.changelog } : {}),
    ...(m.screenshots ? { screenshots: m.screenshots } : {}),
  };
}

/**
 * The ordered LoadedPack set: core first, then each enabled mod that contributes
 * records, in the player's order.
 *
 * PURE, and takes its two inputs, so the gate below is assertable. It used to
 * read the glob and localStorage itself, which meant the one line that decides
 * whether a mod's records reach the game could only be exercised by whatever the
 * bundle happened to contain - and that is how `shape !== "content"` sat here
 * dropping every hybrid mod's records with nothing able to notice.
 */
export function activePackSetFrom(
  mods: ReadonlyMap<string, { manifest: unknown; files: Record<string, unknown> }>,
  enabledIds: readonly string[],
): LoadedPack[] {
  const packs: LoadedPack[] = [coreLoadedPack()];
  for (const id of enabledIds) {
    const mod = mods.get(id);
    if (!mod) {
      log.warn("mods", `enabled mod "${id}" not found; skipping`);
      continue;
    }
    const manifest = modManifest(mod.manifest);
    /* Only packs with the CONTENT facet contribute records to the compose
     * pipeline. Plugins (sandbox/trusted) are installed separately in main.ts
     * boot; tiles packs are loaded by the tile subsystem (tiles.ts), and neither
     * carries record files composeContentPacks could use.
     *
     * This was `shape !== "content"`, which is what made a mod choose between
     * shipping records and shipping code: a hybrid declaring "plugin" had its
     * record files dropped here, silently, while its code loaded fine. */
    if (!hasFacet(manifest, "content")) continue;
    packs.push({
      manifest,
      files: mod.files as unknown as LoadedPack["files"],
    });
  }
  return packs;
}

/**
 * What this build has to say about each enabled mod's engine range, and which of
 * those mods it is actually holding back.
 *
 * OVER EVERY ENABLED MOD, whatever it contributes - not only the ones that would
 * have reached the composer. A plugin-only or tiles-only mod has no records and so
 * never gets as far as activePackSetFrom's facet check, and it is still a mod the
 * player enabled and is owed an answer about. Running the gate here, ahead of the
 * facet split, is what makes one answer cover all three doors.
 *
 * TWO LISTS, NOT ONE, since 2026-08-02. `problems` and `blocked` used to be the
 * same set, because every version mismatch was a refusal. Now a pack with no code
 * that sits outside its declared range still loads and still gets a line, so the
 * caller that decides what to compose must read `blocked` - and a caller that
 * reaches for `problems.length` to mean "held back" is making an error the types
 * can no longer hide.
 *
 * Pure over its two inputs for the same reason activePackSetFrom is: the line that
 * decides whether a mod loads should be assertable without a bundle.
 */
export function engineProblemsFor(
  mods: ReadonlyMap<string, { manifest: unknown; files: Record<string, unknown> }>,
  enabledIds: readonly string[],
): { readonly problems: readonly ModProblem[]; readonly blocked: ReadonlySet<string> } {
  const problems: ModProblem[] = [];
  const blocked = new Set<string>();
  for (const id of enabledIds) {
    const mod = mods.get(id);
    /* An enabled id with no mod behind it is the manager's problem to report (the
     * catalogue's "listed but not installed" line), not a version question. */
    if (!mod) continue;
    const manifest = modManifest(mod.manifest);
    const problem = engineProblem(manifest);
    if (!problem) continue;
    problems.push(problem);
    if (!engineAllows(manifest)) blocked.add(id);
  }
  return { problems, blocked };
}

/* ------------------------------------------------------------------ *
 * The composition, and WHEN it happens
 * ------------------------------------------------------------------ */

/** One composition: what went in, what came out, and what had to be left out. */
interface Composition {
  readonly packs: readonly LoadedPack[];
  readonly composed: ReturnType<typeof composeDroppingBroken>["composed"];
  readonly dropped: ReturnType<typeof composeDroppingBroken>["dropped"];
  /** Mods held out of the set before composing, because this build is not theirs. */
  readonly refused: readonly ModProblem[];
  /* The inputs this answer is FOR, so a later call with different inputs cannot be
   * served a stale one. See composition(). */
  readonly forReport: unknown;
  readonly forEnabled: string;
}

let memo: Composition | null = null;

/**
 * The active pack set and the pack composed from it, computed on FIRST USE and
 * recomputed if the inputs have changed since.
 *
 * THIS USED TO BE TWO MODULE-SCOPE CONSTS, AND THAT WAS A REAL DEFECT (measured
 * 2026-07-31, not reasoned): a mod from the mods DIRECTORY could never contribute a
 * single record.
 *
 * main.ts imports this module STATICALLY (main.ts:247) and latches the mods
 * directory in its own module BODY (main.ts:492, `setDiskPacks`). ES module
 * evaluation runs every static dependency before the importer's body, so
 * `discoverMods()` at module scope read `diskPacks()` while it was still
 * NO_DISK_PACKS - every time, on every platform. Verified in the running dev server
 * with a probe on both sides: pack.ts's module scope saw `available: false`, and the
 * boot block found the probe already written. The comment in discoverMods claiming
 * disk packs were "latched before this runs" had been wrong since the day the mods
 * directory was added, and nothing could see it:
 *
 *   - the mod MANAGER lists a folder mod correctly, because it calls
 *     discoverContentModManifests() at runtime, long after boot;
 *   - so a player could see the mod, enable it, reload, and watch it do nothing;
 *   - `presentNamespaces()` then omitted its namespace, which tells loadGame to
 *     QUARANTINE that still-enabled mod's live entities on the next reload - the
 *     exact "added a mod mid-game and my content vanished" failure the present set
 *     exists to prevent, caused by the thing that computes it;
 *   - and `enabledModIds()` read `diskPacks().order`, so an external manager's
 *     load-order.json was ignored for composition too.
 *
 * The plugin half was fine and that is what hid it: loadModCode is CALLED from the
 * boot block, after the latch, so a folder mod's plugin.js ran and its records did
 * not. A mod that is code-only - which both first-party mods are - works perfectly.
 *
 * KEYED ON THE INPUTS rather than a bare `let memo`, because a memo that fills on
 * first touch is one early caller away from being the same bug again: some future
 * line in main.ts's body that reads content before the boot block would freeze the
 * empty answer permanently, silently, and identically. Comparing the latched report
 * by identity and the enabled ids by value costs nothing and cannot be got wrong by
 * a caller.
 */
function composition(): Composition {
  const report = diskPacks();
  const enabledIds = enabledModIds();
  const key = enabledIds.join(",");
  if (memo && memo.forReport === report && memo.forEnabled === key) return memo;

  const mods = discoverMods();
  /* THE ENGINE GATE, ahead of the composer - and since 2026-08-02 it holds back
   * only the packs that ship CODE.
   *
   * The old reasoning here was that "a pack that half-applies is the failure mode
   * with no good diagnosis". That was true when it was written and is not now: a
   * half-applying pack is exactly what composePacks' onRefuse reporter diagnoses,
   * op by op, on the mod's own row. Which leaves refusing a pack of JSON with
   * nothing to recommend it - the author's range says what they TESTED, and
   * treating that as a demand means every content mod goes dark on an engine
   * release its author never saw. The line still appears; it just no longer takes
   * the mod with it. */
  const { problems: refused, blocked } = engineProblemsFor(mods, enabledIds);
  const packs = activePackSetFrom(
    mods,
    enabledIds.filter((id) => !blocked.has(id)),
  );
  /* composeDroppingBroken, NOT composeContentPacks. `composeContentPacks` THROWS on
   * a class of mod mistake its own header says it reports: a `patches` ref whose
   * target does not exist, a duplicate record name, a missing dependency, a
   * dependency cycle. Every one of those comes from a mod, and every one of them
   * turned this module into an exception before the canvas existed - a blank page,
   * with no mod manager to open and no way to turn the offending mod off short of
   * clearing localStorage. Dropping the offender keeps the rule the rest of the mod
   * system already holds: one broken mod costs that mod, and the player is told. */
  /* Which of each mod's named PARTS are on. Resolved here rather than inside the
   * composer because the inputs are host state - the player's stored choices and
   * the enabled set - and a `patches` claim needs to know what else is loaded to
   * decide whether a compatibility section applies at all. A section that is off
   * is dropped before composition, so its records are absent rather than present
   * and overridden. */
  const sections = sectionChoiceTable(packs.map((p) => p.manifest));
  const { composed, dropped } = composeDroppingBroken(packs, { sections });
  /* THE OTHER HALF OF THE FIELD RULE, and it can only run here. The composer
   * enforces "a namespaced key must be declared" with nothing but the
   * manifests; telling a MISSPELLED core key from a legitimate one needs core's
   * own key table, which the SDK deliberately cannot import (it has no
   * dependencies). So the host, which has both, runs it - and appends to the
   * same problems list the mod manager already shows, rather than inventing a
   * second channel that something would have to remember to read. */
  for (const [file, records] of Object.entries(composed.records)) {
    const known = CORE_RECORD_KEYS[file];
    if (known === undefined) continue;
    const objects = records.filter(
      (r): r is Record<string, unknown> =>
        r !== null && typeof r === "object" && !Array.isArray(r),
    );
    for (const fault of checkUnqualified(file, objects, known)) {
      composed.problems.push(fault.message);
      composed.faults.push({ packId: fault.packId, why: fault.message });
    }
  }
  memo = { packs, composed, dropped, refused, forReport: report, forEnabled: key };
  return memo;
}

/**
 * modId -> sectionId -> on, for the packs about to compose.
 *
 * Storage failures degrade to "every section on", matching the rest of the store
 * (roster.ts idiom): a private-mode browser that cannot read choices should get
 * the mods it enabled whole, not silently stripped of their parts.
 */
function sectionChoiceTable(
  manifests: readonly PackManifest[],
): Record<string, Record<string, boolean>> {
  let choices: Record<string, Record<string, boolean>> = {};
  try {
    choices = defaultModStore().getSectionChoices();
  } catch {
    choices = {};
  }
  const resolved = resolveSectionState(
    manifests,
    choices,
    new Set(manifests.map((m) => m.id)),
  );
  const out: Record<string, Record<string, boolean>> = {};
  for (const [modId, table] of resolved) {
    if (table.size === 0) continue;
    out[modId] = Object.fromEntries(table);
  }
  return out;
}

/** Forget the composition, so a test can compose again over different inputs. */
export function resetComposition(): void {
  memo = null;
}

/**
 * What the composer refused, for diskPackStatus.
 *
 * Attributed from `faults` rather than parsed back out of `problems`: the two carry
 * the same refusals and only one of them says which pack without punctuation.
 */
function composedProblems(): readonly ModProblem[] {
  const { composed, dropped, refused } = composition();
  return [
    ...refused,
    ...composed.faults.map((f) => ({ id: f.packId, why: f.why })),
    /* THE RECORD CHECK (MOD_REACH gap 12). Not a refusal: these records are in
     * the game and will be read. What they will not do is what their author
     * thinks - a `weight` written as a string, a monster with no `depth`, a drop
     * naming an object nothing defines. That is the same question the rest of
     * this list answers ("why is my mod not doing anything?") from the other
     * side, so it belongs on the same row rather than in a channel the manager
     * would have to be taught to read.
     *
     * The message is passed through unchanged: it already names its file and its
     * record, and none of the wordings claims the record was dropped, so a
     * player can tell a finding from a refusal by reading it. */
    ...composed.findings.map((f) => ({ id: f.packId, why: f.message })),
    /* A pack that could not be composed AT ALL. Distinguished in the wording,
     * because "this patch did nothing" and "none of this mod loaded" are very
     * different things to read on a row. */
    ...dropped.map((d) => ({
      id: d.id,
      why: `none of this mod's content loaded - the game composed without it: ${d.why}`,
    })),
  ];
}

/**
 * The namespaces whose content the running pack can resolve: core plus every
 * enabled CONTENT mod's id. This is the `present` set loadGame needs to
 * reconcile a save's mod-lifecycle blocks (mod/save-blocks.ts): it rehydrates
 * orphans whose pack is present again and quarantines live entities whose pack
 * is now missing. Passing anything narrower (e.g. hardcoded core-only) would
 * make loadGame quarantine a still-enabled content mod's live entities on every
 * reload - the add-a-content-mod-mid-game hazard. Plugin-shape mods contribute
 * no content ids (they are skipped by activePackSet), and their private save
 * bags round-trip verbatim regardless of this set, so content ids are the whole
 * concern here.
 */
export function presentNamespaces(): ReadonlySet<string> {
  /* The packs that actually COMPOSED, not the ones that were asked for. A pack
   * composeDroppingBroken had to leave out contributes no records, so calling its
   * namespace present would tell loadGame to rehydrate orphans against content that
   * is not in the game - the mirror image of the quarantine hazard this set exists to
   * avoid, and a worse one, because a rehydrated entity has nothing behind it. */
  const { packs, dropped } = composition();
  const gone = new Set(dropped.map((d) => d.id));
  return new Set(packs.map((p) => p.manifest.id).filter((id) => !gone.has(id)));
}

/**
 * The current content digest for every present pack THIS HOST CAN MEASURE
 * right now, fed to `loadGame`'s `currentPacks` option (issue #20) so it can
 * catch a pack that PATCHED a record instead of only adding one - the case
 * `presentNamespaces` alone cannot see, because a patched record still
 * resolves under its own, still-present namespace.
 *
 * SESSION PACKS ONLY, for now. `stageSessionMod` already hashes the whole
 * archive once, at staging time (mod-session.ts), and `sessionMods()` reads
 * that back synchronously - which matters, because `loadGame` runs on the
 * synchronous boot path and cannot itself await anything. A regular installed
 * mod's digest (`InstalledModMeta.digests`, mod-install.ts) is real, but it is
 * read back from IndexedDB, which is asynchronous; wiring that in would mean
 * pre-fetching it into a synchronous cache ahead of boot, which is a larger
 * change than this fix and is tracked separately as issue #72 (see also
 * MOD_SEAMS.md section 4d). Omitting an installed mod here is the honest
 * "not measured", never "unchanged" - `mismatchedNamespaces` skips a
 * namespace with no current hash rather than reporting a false match.
 *
 * A session mod's `digest` is `""` on a host with no `crypto.subtle` at
 * staging time (mod-session.ts); such an entry is skipped here for the same
 * reason.
 */
export function presentPackDigests(): SavePackRef[] {
  const out: SavePackRef[] = [];
  for (const m of sessionMods()) {
    if (!m.digest) continue;
    out.push({ id: m.id, version: m.version ?? "0.0.0", hash: m.digest });
  }
  return out;
}

// DEV-only diagnostic: proves an enabled mod's changes reach the running
// game's content. Stripped from production builds (import.meta.env.DEV).
//
// GETTERS, not values. This block used to read the composition eagerly, which was
// harmless while the composition was itself a module-scope const and is not now: the
// first read is what fixes the answer, and a diagnostic that composed at module load
// would freeze the pre-boot one and hand every later reader the empty pack. A probe
// that changes the thing it measures is worse than no probe.
if (import.meta.env.DEV) {
  const monsters = (): { name?: string; "hit-points"?: number }[] =>
    (composition().composed.records["monster"] ?? []) as {
      name?: string;
      "hit-points"?: number;
    }[];
  (globalThis as Record<string, unknown>)["__neoPack"] = {
    get enabledMods() {
      return enabledModIds();
    },
    get monsterCount() {
      return monsters().length;
    },
    get grip() {
      const g = monsters().find(
        (r) => typeof r.name === "string" && r.name.startsWith("Grip"),
      );
      return g ? { name: g.name, hp: g["hit-points"] } : null;
    },
    get hasModberry() {
      return monsters().some((r) => r.name === "Modberry Slime");
    },
    /* Which mods actually reached the composition, and which could not - the two
     * questions a mod author asks first, and the pair the old probe could not
     * answer at all. */
    get composedMods() {
      return composition().packs.map((p) => p.manifest.id);
    },
    get droppedMods() {
      return composition().dropped.map((d) => ({ id: d.id, why: d.why }));
    },
  };
}

function records(name: string): unknown[] {
  const recs = composition().composed.records[name];
  if (!recs) throw new Error(`pack file not found: ${name}.json`);
  return recs;
}

/**
 * A record file that a pack is allowed NOT to ship.
 *
 * `records` throws, and that is right for the ~41 files the game cannot boot
 * without: a missing object.json is a broken pack and the loudest possible
 * failure is the kindest one. But an OPTIONAL file is a different question, and
 * answering it with the mandatory function is how #266's wire took 23 test
 * packs down on 2026-08-14 - `CorePack.messageTypes` is declared `?`, the
 * composer only emits a key for a file some pack actually shipped, and the very
 * first pack without one threw before it could reach the optional field it was
 * being loaded into. A type saying "optional" and a loader saying "required"
 * cannot both be right.
 */
function optionalRecords(name: string): unknown[] | undefined {
  return composition().composed.records[name];
}

/**
 * Every composed file with its record array, for the `__neo.mods()` probe.
 *
 * The composed OUTPUT, not the manifests: a count that came out of composition
 * is the only thing that can tell a harness whether a section actually
 * contributed, and "the mod is enabled so it must be working" is the assumption
 * this probe exists to replace.
 */
export function composedRecords(): Record<string, unknown[]> {
  return composition().composed.records;
}

/**
 * A whole-file object with its records replaced by the composed set, keeping
 * any file-level header/source. Used for the files the binders consume as a
 * `{ header?, records }` object rather than a bare record array (constants and
 * the object sub-files).
 */
function composedFile(name: string): unknown {
  return { ...(rawFile(name) as object), records: records(name) };
}

/**
 * The compiled visuals.txt record (records[0] of visuals.json): the flicker
 * cycles and grouped color cycles the animation engine consumes. Returns null
 * if the pack ships no visuals.json, so the caller can degrade to no animation.
 */
export function loadVisualsRecord(): unknown {
  try {
    return records("visuals")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The per-race color-cycle assignments from monster.txt: each monster record's
 * `color-cycle:<group>:<cycle>`, keyed by ridx (the record index, which the
 * core binder uses as MonsterRace.ridx). Mirrors mon-init.c
 * parse_monster_color_cycle -> visuals_cycler_set_cycle_for_race.
 */
export function loadMonsterColorCycles(): {
  ridx: number;
  group: string;
  cycle: string;
}[] {
  const out: { ridx: number; group: string; cycle: string }[] = [];
  const monsters = records("monster") as {
    "color-cycle"?: { group: string; cycle: string };
  }[];
  for (let ridx = 0; ridx < monsters.length; ridx++) {
    const cc = monsters[ridx]?.["color-cycle"];
    if (cc && cc.group && cc.cycle) {
      out.push({ ridx, group: cc.group, cycle: cc.cycle });
    }
  }
  return out;
}

/**
 * The ui_entry* + object_property/player_property record sets buildUiEntryConfig
 * needs (game/ui-entry.ts): the property-grid backend behind the equip-cmp
 * screen and the (not yet shell-wired) second character screen.
 */
export function loadUiEntryPacks(): UiEntryPackRecords {
  return {
    uiEntry: records("ui_entry"),
    uiEntryBase: records("ui_entry_base"),
    uiEntryRenderer: records("ui_entry_renderer"),
    objectProperty: records("object_property"),
    playerProperty: records("player_property"),
  } as unknown as UiEntryPackRecords;
}

/**
 * One player-toggleable rule an ENABLED mod declares (PackManifest.rules), with
 * the id/name of the mod that declares it - the input the host uses both to
 * resolve GameState.modRules (choice ?? default) and to render the Fixes &
 * tweaks menu grouped by mod. Only ENABLED mods contribute, in enabled/load
 * order (so a later mod's rule with the same flag wins, like content records).
 */
export interface ModRuleDecl {
  modId: string;
  modName: string;
  rule: import("@rpgm-tools/neo-angband-mod-sdk").PackRule;
}

/**
 * The rule declarations of every ENABLED mod (any shape), in enabled order.
 * Feeds mod-store.resolveModRules (to seed state.modRules) and the mod manager's
 * Fixes & tweaks menu. Returns [] when no enabled mod declares rules - so a game
 * with the qol / bug-fixes mods off carries no modRules and core is faithful.
 */
export function loadEnabledModRuleDecls(): ModRuleDecl[] {
  const mods = discoverMods();
  const store = defaultModStore();
  const out: ModRuleDecl[] = [];
  for (const id of enabledModIds()) {
    const mod = mods.get(id);
    if (!mod) continue;
    const manifest = modManifest(mod.manifest);
    if (manifest.renamedRuleFlags) {
      store.migrateRuleChoices(manifest.renamedRuleFlags);
    }
    for (const rule of manifest.rules ?? []) {
      out.push({ modId: manifest.id, modName: manifest.name, rule });
    }
  }
  return out;
}

/**
 * modId -> that mod's SECTION flags (sectionFlag(s) -> on), for enabled mods.
 *
 * A section reaches the mod's own code the same way a rule does, so one mod can
 * use one vocabulary for the parts that carry content and the parts that only
 * change behaviour. Merged with the rule flags by mod-hooks; the manifest
 * validator refuses a section whose flag a rule already declares, so the merge
 * cannot silently give one name two meanings.
 */
export function loadEnabledModSectionFlags(): Map<string, Record<string, boolean>> {
  const mods = discoverMods();
  const manifests: PackManifest[] = [];
  for (const id of enabledModIds()) {
    const mod = mods.get(id);
    if (mod) manifests.push(modManifest(mod.manifest));
  }
  let choices: Record<string, Record<string, boolean>> = {};
  try {
    choices = defaultModStore().getSectionChoices();
  } catch {
    choices = {};
  }
  const resolved = resolveSectionState(
    manifests,
    choices,
    new Set(manifests.map((m) => m.id)),
  );
  const out = new Map<string, Record<string, boolean>>();
  for (const m of manifests) {
    const table = resolved.get(m.id);
    if (!table || table.size === 0) continue;
    const flags: Record<string, boolean> = {};
    for (const s of m.sections ?? []) {
      flags[sectionFlag(s)] = table.get(s.id) ?? true;
    }
    out.set(m.id, flags);
  }
  return out;
}

/** Assemble the parsed game pack for startGame (core content + player). */
export function loadGamePack(): GamePack {
  return {
    constants: composedFile("constants"),
    terrain: records("terrain"),
    roomTemplates: records("room_template"),
    vaults: records("vault"),
    dungeonProfiles: records("dungeon_profile"),
    projection: records("projection"),
    trap: records("trap"),
    /* #266: message types a pack coins, composed like any other record file so
     * they exist before bindCore binds a record that names one. A plugin's
     * register() runs long after bindCore, and a content-only pack has no
     * register() at all, so composition is the ONLY route that reaches every
     * pack that would want one. */
    messageTypes: optionalRecords("message_type"),
    names: records("names"),
    store: records("store"),
    quest: records("quest"),
    uiKnowledge: records("ui_knowledge"),
    /* hints.json (ui-store.c prt_welcome tip branch). Bound into CorePack so
     * the one_in_(3) + random_hint draws land on the main stream. */
    hints: records("hints"),
    obj: {
      objectBase: composedFile("object_base"),
      object: composedFile("object"),
      egoItem: composedFile("ego_item"),
      artifact: composedFile("artifact"),
      curse: composedFile("curse"),
      brand: composedFile("brand"),
      slay: composedFile("slay"),
      activation: composedFile("activation"),
      objectProperty: composedFile("object_property"),
      flavor: composedFile("flavor"),
    },
    mon: {
      pain: records("pain"),
      blowMethods: records("blow_methods"),
      blowEffects: records("blow_effects"),
      monsterSpells: records("monster_spell"),
      monsterBases: records("monster_base"),
      monsters: records("monster"),
      summons: records("summon"),
      pits: records("pit"),
    },
    player: {
      races: records("p_race"),
      classes: records("class"),
      properties: records("player_property"),
      timed: records("player_timed"),
      shapes: records("shape"),
      bodies: records("body"),
      history: records("history"),
      realms: records("realm"),
    },
  } as unknown as GamePack;
}
