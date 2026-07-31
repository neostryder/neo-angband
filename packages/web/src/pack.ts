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

import type { GamePack, UiEntryPackRecords } from "@rpgm-tools/neo-angband-core";
import {
  composeDroppingBroken,
  computeConflictReport,
  hasFacet,
  resolveLoadOrder,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack, PackContent, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { isShippedMod, readEnabledModIds } from "./mod-store";
import { diskPacks, type ModDirKind, type ModOrigin } from "./disk-packs";
import { activeModCode } from "./mod-code";
import { modFaults, type ModProblem } from "./mod-problems";

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
     *   composedProblems() the COMPOSER: a ref no record answers to, a ref two
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
     * is what four of these five amounted to. */
    problems: [
      ...r.problems,
      ...composedProblems(),
      ...shadowed,
      ...code.problems,
      ...modFaults(),
    ],
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
    // Plugins are surfaced by discoverPlugins/discoverTrustedPlugins; here we
    // list only packs with something to CONTRIBUTE as content, so the catalog
    // does not double-count. A hybrid (content + plugin) belongs here for its
    // content facet; a plugin-only pack does not.
    if (hasFacet(m, "content") || hasFacet(m, "tiles")) out.push(m);
  }
  return out;
}

/**
 * The human-readable conflict lines (P7.6) for a chosen enabled CONTENT set,
 * for the mod-manager conflicts pane. Builds the ordered LoadedPack set for the
 * given ids (core + enabled content mods), resolves load order, and runs
 * computeConflictReport, returning its prebuilt humanLines. Add-only mods and a
 * single contributor produce none. Returns the error text (not a throw) when a
 * dependency is missing or the order cannot resolve, so the UI can show it.
 */
export function modConflictLines(enabledIds: readonly string[]): string[] {
  const mods = discoverMods();
  const packs: LoadedPack[] = [coreLoadedPack()];
  for (const id of enabledIds) {
    const mod = mods.get(id);
    if (!mod) continue;
    const manifest = modManifest(mod.manifest);
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
    return computeConflictReport(contents).records.flatMap((r) => r.humanLines);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
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
  });
}

function modManifest(raw: unknown): PackManifest {
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
    ...(m.nondeterministic !== undefined ? { nondeterministic: m.nondeterministic } : {}),
    ...(m.affectsGameplay !== undefined ? { affectsGameplay: m.affectsGameplay } : {}),
    ...(m.rules ? { rules: m.rules } : {}),
    // The mod manager shows this to the player when they highlight the mod, so
    // it has to survive normalisation - dropping it here is what left the detail
    // pane with only the id and shape to say for itself.
    ...(m.description ? { description: m.description } : {}),
    ...(m.author ? { author: m.author } : {}),
    ...(m.license ? { license: m.license } : {}),
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
      console.warn(`[mods] enabled mod "${id}" not found; skipping`);
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

/* ------------------------------------------------------------------ *
 * The composition, and WHEN it happens
 * ------------------------------------------------------------------ */

/** One composition: what went in, what came out, and what had to be left out. */
interface Composition {
  readonly packs: readonly LoadedPack[];
  readonly composed: ReturnType<typeof composeDroppingBroken>["composed"];
  readonly dropped: ReturnType<typeof composeDroppingBroken>["dropped"];
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

  const packs = activePackSetFrom(discoverMods(), enabledIds);
  /* composeDroppingBroken, NOT composeContentPacks. `composeContentPacks` THROWS on
   * a class of mod mistake its own header says it reports: a `patches` ref whose
   * target does not exist, a duplicate record name, a missing dependency, a
   * dependency cycle. Every one of those comes from a mod, and every one of them
   * turned this module into an exception before the canvas existed - a blank page,
   * with no mod manager to open and no way to turn the offending mod off short of
   * clearing localStorage. Dropping the offender keeps the rule the rest of the mod
   * system already holds: one broken mod costs that mod, and the player is told. */
  const { composed, dropped } = composeDroppingBroken(packs);
  memo = { packs, composed, dropped, forReport: report, forEnabled: key };
  return memo;
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
  const { composed, dropped } = composition();
  return [
    ...composed.faults.map((f) => ({ id: f.packId, why: f.why })),
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
  const out: ModRuleDecl[] = [];
  for (const id of enabledModIds()) {
    const mod = mods.get(id);
    if (!mod) continue;
    const manifest = modManifest(mod.manifest);
    for (const rule of manifest.rules ?? []) {
      out.push({ modId: manifest.id, modName: manifest.name, rule });
    }
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
