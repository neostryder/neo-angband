/**
 * Load a mod's CODE from a folder on disk.
 *
 * This is the gate that was missing. Everything else the mod system needs was
 * already built - declarative record patching with provenance-aware conflicts
 * (packages/mod-sdk), five capability-gated registry facades
 * (core/src/mod/registry-host.ts), a manifest, a consent store, a load order that
 * an external manager owns - and all of it sat behind the single fact that the
 * only route to a mod's code was a build-time Vite `import.meta.glob`. A folder
 * could supply records and never a line of behaviour, which meant no third-party
 * mod could change a rule, register an effect, or override an AI, no matter what
 * the SDK could express.
 *
 * A mod that runs code ships one ES module, `plugin.js`, beside its manifest.
 *
 * EVERY GATE IS CHECKED BEFORE THE IMPORT. That ordering is the point, not an
 * optimisation. This is player-supplied code from a folder anyone can write into:
 * a module's top-level statements run the moment it is imported, so a check that
 * lives inside plugin.js - or that reads a field off the imported object - has
 * already lost. In order:
 *
 *   1. the pack must actually ship plugin.js (no probing, no 404s: the directory
 *      listing already said);
 *   2. the mod must be ENABLED - a disabled mod's code does not exist, which is
 *      the same standing rule as a disabled mod's patches;
 *   3. this build must fall inside the manifest's `engine` range - the shared gate
 *      every loading path uses (mod-engine.ts), asked here so a pack written for a
 *      different game does not get its code run while its records are held back;
 *   4. the manifest must declare the `plugin` FACET - `shape: "plugin"`, or a
 *      `facets` list containing it - so shipping code is a stated intent rather
 *      than a file that happened to be in the folder. A mod that contributes both
 *      records and code declares `"facets": ["content", "plugin"]`;
 *   5. the manifest's `modApi` must match this host's MOD_API_VERSION exactly;
 *   6. the player must have consented to every capability the manifest requests.
 *
 * Only then is the module imported, and only then is its default export shape
 * checked (mod-plugin.ts's validateModPlugin).
 *
 * NOTHING HERE THROWS. A hand-edited manifest, a truncated download, a plugin
 * that throws at import: each becomes one line the mod manager shows, and the
 * game still boots. Same reasoning as z-file.c returning NULL rather than dying,
 * and the same as readModDir's, one layer up.
 *
 * `plugin.js` is the ENTRY POINT, not the whole mod. A mod may hold as many
 * scripts as it likes, in subdirectories, and import them relatively: on desktop
 * the pack is served from the shell's loopback origin so that resolves for free,
 * and in a browser tab the graph is resolved and rewritten before the import
 * (mod-modules.ts). The first cut of this file required a single bundled file, and
 * said so in a comment that read like a fact about browsers; it was a fact about
 * the implementation. A mod is data, images and scripts in a folder, and needing a
 * build step to ship one would put a toolchain between an author and the game.
 *
 * What a folder plugin still cannot do is import a BARE specifier
 * ("@rpgm-tools/neo-angband-core"): it resolves against the document, where nothing is
 * published. There is nothing to import - the engine is handed in as `ctx.core`.
 */

import { hasFacet, validateManifest, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { CodeUrlResolver, DiskPack } from "./disk-packs";
import { engineRefusal } from "./mod-engine";
import type { ModProblem } from "./mod-problems";
import {
  MOD_API_VERSION,
  validateModPlugin,
  type ModPlugin,
} from "./mod-plugin";

/** The one code entry point a mod folder may ship. */
export const PLUGIN_FILE = "plugin.js";

/** A plugin that passed every gate and imported cleanly. */
export interface LoadedModPlugin {
  readonly id: string;
  readonly manifest: PackManifest;
  readonly plugin: ModPlugin;
  /** Where it was imported from, for diagnostics and the mod manager. */
  readonly url: string;
  /**
   * The pack's own parsed record files, keyed without `.json`, so the caller can
   * put them in the plugin's context (ModPluginContext.data). Carried here rather
   * than looked up again by id: the loader already held the pack, and a second
   * lookup is a second chance to disagree with it.
   */
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ModCodeReport {
  readonly plugins: readonly LoadedModPlugin[];
  /**
   * One entry per pack that ships code and could not be used.
   *
   * ATTRIBUTED, and until 2026-07-31 RENDERED NOWHERE. Every failure path below
   * appends to this list and `activeModCode()` was read at exactly two places, both
   * for `.plugins` - so a plugin that failed to import, or targeted the wrong ABI,
   * or shipped code without declaring the facet, was indistinguishable from a mod
   * that loaded and did nothing. These now share `skipped`'s attributed shape (the
   * two lists sit three lines apart and had different ones) and reach the mod
   * manager through mod-problems.ts.
   */
  readonly problems: readonly ModProblem[];
  /**
   * Packs that ship plugin.js and were SKIPPED for a reason that is not a fault -
   * disabled, or awaiting consent. Distinguished from `problems` because a mod
   * manager must not show "broken" for a mod the player simply turned off.
   */
  readonly skipped: readonly ModProblem[];
}

const EMPTY: ModCodeReport = { plugins: [], problems: [], skipped: [] };

export interface LoadModCodeOptions {
  /** The packs read off disk (readModDir's output). */
  readonly packs: readonly DiskPack[];
  /** How to turn a code file into an importable URL; null means "no code source". */
  readonly codeUrl: CodeUrlResolver | null;
  /** Whether the player has this mod enabled. */
  readonly enabled: (id: string) => boolean;
  /**
   * The capabilities the player consented to for this mod. A pack requesting
   * capabilities it has no consent for is skipped, not loaded - the manager gates
   * consent on enable, and this second-checks so a hand-edited store cannot walk
   * around it.
   */
  readonly consented: (id: string) => readonly string[];
  /** This host's ABI version; a parameter only so the tests can drive a mismatch. */
  readonly hostApi?: number;
  /** Injected for tests, which have no browser module loader to import a URL with. */
  readonly importer?: (url: string) => Promise<unknown>;
}

/**
 * Import every enabled, consented, ABI-compatible plugin in a mods folder.
 *
 * Order follows `packs`, which readModDir produced in the load order the external
 * manager (or the player) chose - so a plugin's hooks fold in that order too.
 */
export async function loadModCode(opts: LoadModCodeOptions): Promise<ModCodeReport> {
  const hostApi = opts.hostApi ?? MOD_API_VERSION;
  const plugins: LoadedModPlugin[] = [];
  const problems: ModProblem[] = [];
  const skipped: ModProblem[] = [];

  const withCode = opts.packs.filter((p) => hasPlugin(p));
  if (withCode.length === 0) return EMPTY;
  if (!opts.codeUrl) {
    /* Packs that ship code, and a source that cannot serve it. Saying so beats
     * silence: this is precisely the state the whole system used to be in, and it
     * looked from the outside exactly like a mod that did nothing. */
    for (const pack of withCode) {
      problems.push({
        id: pack.manifest.id,
        why: `ships ${PLUGIN_FILE}, but this mods folder cannot serve code`,
      });
    }
    return { plugins, problems, skipped };
  }

  const doImport = opts.importer ?? ((url: string) => import(/* @vite-ignore */ url));

  for (const pack of withCode) {
    const id = pack.manifest.id;

    if (!opts.enabled(id)) {
      skipped.push({ id, why: "not enabled" });
      continue;
    }
    /* THE ENGINE GATE, before the plugin's own ABI check and before any import.
     * The two are different questions and both are asked here: `engine` is a range
     * over the GAME's version that any pack may declare, `modApi` an exact integer
     * the plugin's CODE was compiled against. A mod can pass either and fail the
     * other. Same rule, same wording, same single implementation as the content and
     * tiles paths use - mod-engine.ts - so three loaders cannot answer differently.
     *
     * Reported here as well as by the content path, rather than deferring to it: a
     * plugin-only mod in a folder is a case the content path sees, but "some other
     * reader will mention it" is not a property this loader can check, and the
     * aggregator dedupes. */
    const refusal = engineRefusal(pack.manifest);
    if (refusal) {
      problems.push({ id, why: refusal.why });
      continue;
    }
    if (!hasFacet(pack.manifest, "plugin")) {
      problems.push({
        id,
        why:
          `ships ${PLUGIN_FILE} but its manifest does not declare the "plugin" ` +
          `facet (shape is "${pack.manifest.shape}") - add ` +
          `"facets": ["${pack.manifest.shape}", "plugin"], so that running code is ` +
          `something the mod states`,
      });
      continue;
    }
    const declared = pack.manifest.modApi;
    if (declared === undefined) {
      problems.push({
        id,
        why:
          `ships ${PLUGIN_FILE} but declares no "modApi" in its manifest - ` +
          `add "modApi": ${hostApi}`,
      });
      continue;
    }
    if (declared !== hostApi) {
      /* Both numbers and which way round: a too-new mod needs a newer game, a
       * too-old one needs updating, and only the pair says which. */
      problems.push({
        id,
        why:
          declared > hostApi
            ? `targets mod API ${declared}; this build implements ${hostApi} - the mod needs a newer game`
            : `targets mod API ${declared}; this build implements ${hostApi} - the mod needs updating for this game`,
      });
      continue;
    }
    const wanted = pack.manifest.capabilities ?? [];
    const granted = new Set(opts.consented(id));
    const missing = wanted.filter((c) => !granted.has(c));
    if (missing.length > 0) {
      skipped.push({
        id,
        why: `awaiting consent for ${missing.join(", ")}`,
      });
      continue;
    }

    let url: string | null;
    try {
      url = await opts.codeUrl(id, PLUGIN_FILE);
    } catch (e) {
      /* The message from here already names the file at fault - which script is
       * missing, which two import each other (mod-modules.ts). Prefixing it with
       * "<id>/plugin.js could not be read" would put a second, wrong filename in
       * front of the right one, so only the mod is named. */
      problems.push({ id, why: message(e) });
      continue;
    }
    if (url === null) {
      problems.push({
        id,
        why: `${PLUGIN_FILE} is listed in the folder but could not be opened`,
      });
      continue;
    }

    let mod: unknown;
    try {
      mod = await doImport(url);
    } catch (e) {
      problems.push({ id, why: `${PLUGIN_FILE} failed to load: ${importAdvice(e)}` });
      continue;
    } finally {
      opts.codeUrl.release?.(url);
    }

    const entry = (mod as { default?: unknown } | null)?.default;
    const wrong = validateModPlugin(entry, hostApi);
    if (wrong) {
      problems.push({ id, why: wrong });
      continue;
    }
    plugins.push({
      id,
      manifest: pack.manifest,
      plugin: entry as ModPlugin,
      url,
      data: pack.files,
    });
  }

  return { plugins, problems, skipped };
}

/* --- The latch ---------------------------------------------------------------
 *
 * Importing a module is asynchronous and everything downstream of it is not:
 * content composition runs at module load, and the game's own start/load path is
 * synchronous throughout. So boot awaits loadModCode ONCE, before the game
 * exists, and latches the answer here - the same shape, and for the same reason,
 * as disk-packs.ts latching its report. Pushing `await` into the composer for a
 * handful of imports that happen once, before anything is drawn, would be the
 * wrong trade.
 */

let latched: ModCodeReport = EMPTY;

/** The plugins loaded at boot. */
export function activeModCode(): ModCodeReport {
  return latched;
}

/** Install a report (the boot path, and the tests). */
export function setModCode(report: ModCodeReport): void {
  latched = report;
}

/** Back to "no folder plugins", for tests. */
export function resetModCode(): void {
  latched = EMPTY;
}

/** Whether a pack ships the code entry point (case-insensitively, like the rest). */
export function hasPlugin(pack: DiskPack): boolean {
  return pack.code.some((f) => f.toLowerCase() === PLUGIN_FILE);
}

/**
 * The folder packs that ship code, as manifests, for the mod manager's catalog.
 *
 * CANDIDATES, not loaded plugins: this has to include the ones that are disabled
 * or awaiting consent, because the manager is where a player turns them ON. Taking
 * the list from activeModCode() instead would show only mods that were already
 * running - a catalog that can never gain a row.
 *
 * This is the last mile of the folder-code path, and it was missing. The manager's
 * three sources were content packs (which exclude shape "plugin" so plugins are not
 * double-counted) and two GLOBS over bundled mods. A folder plugin appeared in none
 * of them, so it was read, validated, counted in "1 from this folder" - and had no
 * row, which means no way to enable it, which means its code could never load. Unit
 * tests could not see that; only driving the real game could.
 */
export function folderPluginManifests(packs: readonly DiskPack[]): PackManifest[] {
  return packs.filter((p) => hasPlugin(p) && hasFacet(p.manifest, "plugin")).map((p) => p.manifest);
}

/**
 * Bundled plugin manifests plus folder ones, deduped by id with the FOLDER copy
 * winning - the same precedence activeModHooks applies, because a manager row
 * describing the bundled copy while the game ran the folder copy would be lying
 * about which version is loaded.
 */
export function mergePluginManifests(
  bundled: readonly PackManifest[],
  folder: readonly PackManifest[],
): PackManifest[] {
  const byId = new Map<string, PackManifest>();
  for (const m of bundled) byId.set(m.id, m);
  for (const m of folder) byId.set(m.id, m);
  return [...byId.values()];
}

/**
 * Turn an import failure into something an author can act on.
 *
 * Relative imports are resolved before this point (mod-modules.ts), so a fetch
 * failure now means a BARE specifier - the one kind that cannot be resolved from a
 * folder, and the mistake anyone who has written a bundled mod makes first. The
 * browser's own message ("Failed to resolve module specifier") names the specifier
 * but not the thing to do instead, which is the part that matters.
 */
function importAdvice(e: unknown): string {
  const msg = message(e);
  if (/resolve module specifier|dynamically imported module|Failed to fetch|Cannot find module/i.test(msg)) {
    return (
      `${msg} - a plugin loaded from a folder cannot import a package by name. ` +
      `Relative imports of the mod's own files work ("./lib/dice.js"); the engine ` +
      `is handed to the plugin as ctx.core, so there is nothing to import from ` +
      `"@rpgm-tools/neo-angband-core"`
    );
  }
  return msg;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Re-validate a manifest that came from a folder.
 *
 * readModDir already did this, so this is for a caller holding raw JSON (the mod
 * manager's preview of a folder the player is about to enable) rather than a
 * second guess at the same bytes.
 */
export function manifestOf(raw: unknown): PackManifest {
  return validateManifest(raw);
}
