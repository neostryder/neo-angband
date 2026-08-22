/**
 * Build the ModPluginContext a plugin is handed.
 *
 * Split out of mod-plugin.ts on purpose, and the split is load-bearing. A mod's
 * own source imports mod-plugin.ts for `defineModPlugin` and the context types,
 * and is then built into a single-file plugin.js. If the module holding those
 * types also imported core as a VALUE, every plugin's bundle would contain the
 * whole engine - the exact duplication that passing the engine in exists to
 * avoid. So mod-plugin.ts imports core for TYPES only, and the one function that
 * needs the live namespace lives here, where no plugin imports it.
 */

import * as neoCore from "@rpgm-tools/neo-angband-core";
import { log } from "./logging";
import type { CoreRegistries, GameState } from "@rpgm-tools/neo-angband-core";
import {
  MOD_API_VERSION,
  type BackupFolder,
  type ModCoreApi,
  type ModDebug,
  type ModInstallOutcome,
  type ModPluginContext,
  type ModSessionOutcome,
  type ModUi,
  type ModWizard,
} from "./mod-plugin";
import { diskPacks } from "./disk-packs";
import { modPrefs, type ModPrefs } from "./mod-prefs";
import { createBackupFolder } from "./mod-backup";
import { createModUi, PANEL_CAPABILITY } from "./panel-runtime";
import {
  createModInstaller,
  createModSessionLoader,
  INSTALL_CAPABILITY,
  SESSION_CAPABILITY,
  type InstallDoorDeps,
} from "./install-runtime";
import { createModDebug, SPAWN_CAPABILITY, type SpawnDoorDeps } from "./spawn-runtime";
import { createModWizard, WIZARD_CAPABILITY, type WizardDoorDeps } from "./wizard-runtime";
import type { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";

/**
 * `core` is the module namespace this host itself imported, so a plugin and the
 * game look at ONE set of registries and singletons. A plugin that resolved
 * "@rpgm-tools/neo-angband-core" for itself from a folder would get a second copy, register
 * its effect handler on a registry the interpreter never consults, and appear to
 * do nothing at all - a failure mode with no error message anywhere.
 *
 * Frozen, so one plugin cannot edit what the next is handed. Shallow on purpose:
 * `core` IS the live engine and freezing it would break the game. This stops
 * accidental cross-talk, not a determined adversary - the security boundary for
 * in-process code is the consent prompt, not this object.
 */
/**
 * The bound registries, latched once per page load.
 *
 * A LATCH RATHER THAN AN ARGUMENT AT EVERY CALL SITE, which is the same choice
 * `diskPacks()` made above and for a sharper reason here: there are seven places
 * that build a context, they are spread across three modules, and a new one that
 * forgot to pass this would hand its mod `registries: undefined` - a mod reading
 * no monsters and reporting nothing, because absence is a legal state during
 * composition and cannot be told apart from a call site that forgot. Latching it
 * means every context that exists after boot has it, including the ones written
 * next year.
 *
 * Set once, because binding happens once: toggling a mod reloads the page rather
 * than rebinding in place (see docs/modding/MOD_LIFECYCLE.md), so there is no
 * stale-value window to defend against.
 */
let boundRegistries: CoreRegistries | undefined;

/** Latch the bound registries (the boot path, and the tests). */
export function setModRegistries(registries: CoreRegistries | undefined): void {
  boundRegistries = registries;
}

/** What a plugin context will report as `ctx.registries`. */
export function modRegistries(): CoreRegistries | undefined {
  return boundRegistries;
}

export function modPluginContext(
  id: string,
  flags: Readonly<Record<string, boolean>>,
  state?: GameState,
  own: ModOwnFiles = {},
  session: ModSessionFacts = {},
): ModPluginContext {
  /* The mod's OWN files only. `assetUrl` is called with the mod's id fixed here
   * rather than taken as an argument, so a plugin cannot read another mod's assets
   * by passing a different one - the id it gets is the id it was loaded under. */
  const assets = own.assetUrl;
  const backupFolder = backupFolderFor(id, session);
  const ui = modUiFor(id, session);
  const installMod = installerFor(session);
  const loadModForSession = sessionLoaderFor(session);
  const debug = debugFor(id, session);
  const wizard = wizardFor(id, session);
  /* `session.registries` first so a test can supply its own without booting a
   * game; the latch otherwise, which is what every real call site uses. */
  const registries = session.registries ?? boundRegistries;
  return Object.freeze({
    id,
    api: MOD_API_VERSION,
    engine: neoCore.ENGINE_VERSION,
    flags: Object.freeze({ ...flags }),
    core: neoCore as unknown as ModCoreApi,
    ...(state ? { state } : {}),
    assetUrl: (path: string): Promise<string | null> =>
      assets ? assets(id, path) : Promise.resolve(null),
    data: Object.freeze({ ...(own.data ?? {}) }),
    /* Scoped by the id fixed above, for the same reason assetUrl is: the id a
     * mod gets is the id it was loaded under, so no mod can read another's. */
    prefs: session.prefs ?? modPrefs(id),
    /* Defaults FALSE, which is the safe way round: a mod that seeds something
     * for a new life must not seed it over a character who already lived one,
     * so a caller that forgets to say gets the answer that changes nothing. */
    newCharacter: session.newCharacter ?? false,
    log: (msg: string) => {
      log.info(`mod:${id}`, `${msg}`);
    },
    ...(backupFolder ? { backupFolder } : {}),
    ...(ui ? { ui } : {}),
    ...(installMod ? { installMod } : {}),
    ...(loadModForSession ? { loadModForSession } : {}),
    ...(debug ? { debug } : {}),
    ...(wizard ? { wizard } : {}),
    /* Spread rather than set to undefined, so `"registries" in ctx` answers the
     * same question as `ctx.registries !== undefined` - the shape `state` uses. */
    ...(registries ? { registries } : {}),
  });
}

/**
 * Ticket #133's `ctx.backupFolder`: present only when this mod's manifest
 * declared `backup:folder` AND this front end can pick a folder at all -
 * two independent reasons for absence (no consent, no platform support),
 * either one degrading to `undefined` rather than a facade that throws.
 *
 * `session.capabilities` is this MOD's own resolved set (not a shared,
 * mod-agnostic session fact like `newCharacter`), so every call site that
 * builds one already has it close by - `CapabilitySet.fromManifest(manifest)`,
 * the same value it already passes to `installSandboxedController` /
 * `installController` / `composeModHooks` for the very same mod.
 */
function backupFolderFor(id: string, session: ModSessionFacts): BackupFolder | undefined {
  if (session.backupFolder !== undefined) return session.backupFolder;
  if (!session.capabilities?.has("backup:folder")) return undefined;
  return createBackupFolder(id);
}

/**
 * `ctx.ui`: present only when this mod's manifest declared `ui:panel.mount`.
 *
 * ONE REASON FOR ABSENCE, not two. `backupFolder` above degrades on consent OR
 * on the platform having no folder picker; this one is consent alone, because a
 * front end with no document has no game either. What happens on a host with no
 * `document` is that `openPanel` refuses with that sentence - which is the right
 * place for it, since a mod that never opens a panel should not be told it
 * cannot.
 */
function modUiFor(id: string, session: ModSessionFacts): ModUi | undefined {
  if (session.ui !== undefined) return session.ui;
  if (!session.capabilities?.has(PANEL_CAPABILITY)) return undefined;
  return createModUi(id);
}

/**
 * `ctx.installMod`: present only when this mod's manifest declared `mod:install`
 * AND the host has told this module where installs go.
 *
 * TWO REASONS FOR ABSENCE, like `backupFolder` and unlike `ui`. The second one
 * is the one that matters for a test: `installDoor` is latched by the boot path,
 * so a context built by a unit test has no install env and gets no door - which
 * is the right answer, since an install needs IndexedDB and a network fetch
 * primitive that a test has not supplied.
 */
function installerFor(
  session: ModSessionFacts,
): ((bytes: Uint8Array) => Promise<ModInstallOutcome>) | undefined {
  if (session.installMod !== undefined) return session.installMod;
  if (!session.capabilities?.has(INSTALL_CAPABILITY)) return undefined;
  if (!installDoor) return undefined;
  return createModInstaller(installDoor);
}

/**
 * `ctx.loadModForSession`: present only when this mod's manifest declared
 * `mod:session` AND the host has latched the install door.
 *
 * THE SAME DOOR DEPS as `installerFor`, and that is deliberate rather than
 * convenient: a session load runs the third-party switch and reads the installed
 * mods to check the origin pin, so it needs exactly what an install needs. What
 * separates the two is the capability, which is a different string precisely so
 * that granting one does not grant the other.
 */
function sessionLoaderFor(
  session: ModSessionFacts,
): ((bytes: Uint8Array) => Promise<ModSessionOutcome>) | undefined {
  if (session.loadModForSession !== undefined) return session.loadModForSession;
  if (!session.capabilities?.has(SESSION_CAPABILITY)) return undefined;
  if (!installDoor) return undefined;
  return createModSessionLoader(installDoor);
}

/**
 * Where installs go, latched once per page.
 *
 * A LATCH FOR THE SAME REASON `boundRegistries` IS ONE, and the reason is the
 * same seven context-building call sites: a new one that forgot to thread this
 * through would hand its mod `installMod: undefined`, and a mod reporting that
 * it cannot install anything is indistinguishable from a mod that was never
 * granted the capability. Latching it means every context built after boot has
 * it, including the ones written next year.
 */
let installDoor: InstallDoorDeps | undefined;

/** Latch the install door (the boot path, and the tests). */
export function setModInstallDoor(deps: InstallDoorDeps | undefined): void {
  installDoor = deps;
}

/**
 * `ctx.debug`: present only when this mod's manifest declared `debug:spawn` AND
 * there is a live game to conjure into.
 *
 * The second condition is not a formality. The spawn door needs the wizard deps
 * bundle, which `wireGame` assembles and which does not exist during content
 * composition - the same reason `ctx.state` and `ctx.registries` are absent
 * there. A facade that existed then and failed on first use would put the
 * refusal at the worst moment.
 */
function debugFor(id: string, session: ModSessionFacts): ModDebug | undefined {
  if (session.debug !== undefined) return session.debug;
  if (!session.capabilities?.has(SPAWN_CAPABILITY)) return undefined;
  if (!spawnDoor) return undefined;
  return createModDebug(id, spawnDoor);
}

/**
 * `ctx.wizard`: present only when this mod's manifest declared `debug:wizard` AND
 * there is a live game to drive.
 *
 * The same two conditions `debugFor` checks and for the same reason - the wizard
 * deps bundle is assembled by `wireGame` and does not exist during content
 * composition - and a DIFFERENT capability, checked separately, because a mod that
 * may conjure one monster has not thereby been allowed to detach the player's save.
 */
function wizardFor(id: string, session: ModSessionFacts): ModWizard | undefined {
  if (session.wizard !== undefined) return session.wizard;
  if (!session.capabilities?.has(WIZARD_CAPABILITY)) return undefined;
  /* THE SAME LATCH, NOT A SECOND ONE, and that is a decision rather than reuse.
   *
   * There is exactly one live game on a page, and `SpawnDoorDeps.wizard` is the
   * getter over it - `WizardDoorDeps` is that field and nothing else, so the door
   * already latched satisfies both surfaces by construction. A second latch would
   * have added one more thing for a new boot path to forget, and forgetting it
   * would hand every mod `wizard: undefined`, which is indistinguishable from a
   * capability the player never granted. That is the failure `boundRegistries` and
   * `installDoor` both carry a comment about; a seam that cannot be forgotten is
   * better than a seam with a note asking not to forget it.
   *
   * The two surfaces stay two capability checks over one source. Sharing where the
   * game is says nothing about who may reach it. */
  if (!spawnDoor) return undefined;
  return createModWizard(id, spawnDoor satisfies WizardDoorDeps);
}

/** Where a mod's conjuring goes, latched once per page. Same argument as above. */
let spawnDoor: SpawnDoorDeps | undefined;

/** Latch the spawn door (the boot path, and the tests). */
export function setModSpawnDoor(deps: SpawnDoorDeps | undefined): void {
  spawnDoor = deps;
}

/** What the host knows about THIS session, as opposed to this mod's folder. */
export interface ModSessionFacts {
  /** Whether the character was created this session rather than loaded. */
  readonly newCharacter?: boolean;
  /** Override the preference store (tests, and a front end with its own). */
  readonly prefs?: ModPrefs;
  /**
   * THIS mod's resolved capability grants (ticket #133's `ctx.backupFolder`
   * gate). Absent in most call sites today - see MOD_REACH.md's own note that
   * capability-gated ctx fields are being added one at a time.
   */
  readonly capabilities?: CapabilitySet;
  /** Override backupFolder directly (tests, and a front end with its own). */
  readonly backupFolder?: BackupFolder;
  /** Override ctx.ui directly (tests, and a front end with its own panels). */
  readonly ui?: ModUi;
  /** Override ctx.installMod directly (tests, and a front end with its own door). */
  readonly installMod?: (bytes: Uint8Array) => Promise<ModInstallOutcome>;
  /** Override ctx.loadModForSession directly (tests, and a front end of its own). */
  readonly loadModForSession?: (bytes: Uint8Array) => Promise<ModSessionOutcome>;
  /** Override ctx.debug directly (tests, and a front end with its own). */
  readonly debug?: ModDebug;
  /** Override ctx.wizard directly (tests, and a front end with its own). */
  readonly wizard?: ModWizard;
  /**
   * Override the bound registries, for a test that wants a plugin to see a
   * registry it built by hand rather than one a booted game latched.
   */
  readonly registries?: CoreRegistries;
}

/**
 * A mod's own files for its context: its parsed record JSON plus the live asset
 * resolver.
 *
 * The resolver is read off the CURRENT disk-pack report rather than captured when
 * the plugin loaded, because the browser's is stateful - it caches the URLs it has
 * minted, and a stale copy would hand out a second blob URL for the same image.
 */
export function modOwnFiles(data: Readonly<Record<string, unknown>>): ModOwnFiles {
  const assetUrl = diskPacks().assetUrl;
  return { data, ...(assetUrl ? { assetUrl } : {}) };
}

/** What the host knows about this mod's own folder, when it came from one. */
export interface ModOwnFiles {
  /** The report's asset resolver (DiskPackReport.assetUrl), if the source has one. */
  readonly assetUrl?: (id: string, path: string) => Promise<string | null>;
  /** The pack's parsed record files, keyed without `.json` (DiskPack.files). */
  readonly data?: Readonly<Record<string, unknown>>;
}
