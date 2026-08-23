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
/* The SDK as a VALUE, for the same reason core is one here and only here: this
 * is the module that hands a live namespace to a plugin, and it is the module no
 * plugin imports. mod-plugin.ts keeps its SDK imports type-only. */
import * as neoAuthoring from "@rpgm-tools/neo-angband-mod-sdk";
import { log } from "./logging";
import type { CoreRegistries, GameState } from "@rpgm-tools/neo-angband-core";
import {
  MOD_API_VERSION,
  type BackupFolder,
  type ModAuthoringApi,
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
  createModReload,
  createModSessionLoader,
  INSTALL_CAPABILITY,
  SESSION_CAPABILITY,
  type InstallDoorDeps,
} from "./install-runtime";
import { createModDebug, SPAWN_CAPABILITY, type DebugDoorDeps } from "./spawn-runtime";
import { createModWizard, WIZARD_CAPABILITY, type WizardDoorDeps } from "./wizard-runtime";
import type { CapabilitySet, ComposedRecords } from "@rpgm-tools/neo-angband-mod-sdk";

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

/**
 * The composed records the binder read, latched beside the registries it bound.
 *
 * THE SAME LATCH ARGUMENT, and the pair is the point: these two are one
 * composition seen twice, so a boot path that set one and forgot the other would
 * hand a mod a peer table drawn from a different game than its registry lookups.
 * They are set on the same line of main.ts for that reason, and a drift guard in
 * mod-context.test.ts reads main.ts to confirm it.
 *
 * NOT READ FROM pack.ts ON DEMAND, which was the shorter option. `composition()`
 * is what BUILDS this, and content composition is when a mod's `hooks(ctx)` runs,
 * so a context that pulled the value itself would be asking the composer for its
 * own output partway through producing it. Absence during composition is the
 * honest answer there, exactly as it is for `registries`, and a latch set after
 * boot gives that for free.
 */
let composedRecords: ComposedRecords | undefined;

/** Latch the composed records (the boot path, and the tests). */
export function setModComposedRecords(records: ComposedRecords | undefined): void {
  composedRecords = records;
}

/** What a plugin context will report as `ctx.composedRecords`. */
export function modComposedRecords(): ComposedRecords | undefined {
  return composedRecords;
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
  const installMod = installerFor(id, session);
  const reloadGame = reloadGameFor(session);
  const loadModForSession = sessionLoaderFor(session);
  const debug = debugFor(id, session);
  const wizard = wizardFor(id, session);
  /* `session.registries` first so a test can supply its own without booting a
   * game; the latch otherwise, which is what every real call site uses. */
  const registries = session.registries ?? boundRegistries;
  const records = session.composedRecords ?? composedRecords;
  return Object.freeze({
    id,
    api: MOD_API_VERSION,
    engine: neoCore.ENGINE_VERSION,
    flags: Object.freeze({ ...flags }),
    core: neoCore as unknown as ModCoreApi,
    /* Unconditional, unlike every optional field below it. The SDK is a module
     * this host already imported, so there is no boot state it waits on and no
     * consent to check - see the field's own comment in mod-plugin.ts. */
    authoring: neoAuthoring as unknown as ModAuthoringApi,
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
    ...(reloadGame ? { reloadGame } : {}),
    ...(loadModForSession ? { loadModForSession } : {}),
    ...(debug ? { debug } : {}),
    ...(wizard ? { wizard } : {}),
    /* Spread rather than set to undefined, so `"registries" in ctx` answers the
     * same question as `ctx.registries !== undefined` - the shape `state` uses. */
    ...(registries ? { registries } : {}),
    ...(records ? { composedRecords: records } : {}),
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
 *
 * `id` TRAVELS WITH THE DOOR, not just with the context. This is the one place
 * that knows, without asking, which mod is about to be handed `ctx.installMod` -
 * it is this function's own argument - so it is also the one place that can
 * tell `createModInstaller` who to blame an install on. A mod that installs
 * another mod through this door gets that recorded on the arriving mod's meta
 * (`InstalledModMeta.installedByModId`), which is a different fact from where
 * the bytes claim to come from.
 */
function installerFor(
  id: string,
  session: ModSessionFacts,
): ((bytes: Uint8Array) => Promise<ModInstallOutcome>) | undefined {
  if (session.installMod !== undefined) return session.installMod;
  if (!session.capabilities?.has(INSTALL_CAPABILITY)) return undefined;
  if (!installDoor) return undefined;
  return createModInstaller(installDoor, id);
}

/**
 * `ctx.reloadGame`: present on either of the two capabilities that stage
 * content a reload is needed to apply - `mod:install` and `mod:session` - on
 * the same latched door both already use.
 *
 * BOTH CAPABILITIES ON PURPOSE, not just `mod:install` any more. Content
 * composes at load, and that is true of a session stage exactly as it is of an
 * install: a mod that calls `loadModForSession` and cannot follow it with a
 * reload leaves the player holding a mod that will not be in the game until
 * something reloads it. A mod with nothing staged either way has no business
 * reloading anybody's game, which is what keeps this off every other
 * capability. A third capability string for reload alone would still put half
 * an act on the consent list - the fix for that is covering both staging
 * capabilities here, not inventing one.
 *
 * THE SAME LATCH, NOT A SECOND ONE, for the reason `wizardFor` reads the debug
 * door rather than latching its own: a seam that cannot be forgotten beats a seam
 * with a note asking not to forget it. `InstallDoorDeps.reload` is required, so a
 * boot path cannot latch a door that installs and then cannot apply.
 */
function reloadGameFor(session: ModSessionFacts): (() => Promise<void>) | undefined {
  if (session.reloadGame !== undefined) return session.reloadGame;
  if (!session.capabilities?.has(INSTALL_CAPABILITY) && !session.capabilities?.has(SESSION_CAPABILITY)) {
    return undefined;
  }
  if (!installDoor) return undefined;
  return createModReload(installDoor);
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
  if (!debugDoor) return undefined;
  return createModDebug(id, debugDoor);
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
   * There is exactly one live game on a page, and `DebugDoorDeps.wizard` is the
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
  if (!debugDoor) return undefined;
  return createModWizard(id, debugDoor satisfies WizardDoorDeps);
}

/**
 * Where the live game is, for both debug surfaces, latched once per page.
 *
 * NAMED FOR THE FAMILY RATHER THAN FOR ITS FIRST CALLER. It was `spawnDoor`, and
 * it stayed that when `ctx.wizard` began reading it, which left a function called
 * `setModSpawnDoor` feeding a surface that does no spawning. The name is what a
 * reader trusts about which surfaces depend on it, so the wrong one is a
 * standing invitation to add a second latch that duplicates this one.
 */
let debugDoor: DebugDoorDeps | undefined;

/** Latch the debug door (the boot path, and the tests). */
export function setModDebugDoor(deps: DebugDoorDeps | undefined): void {
  debugDoor = deps;
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
  /** Override ctx.reloadGame directly (tests, and a front end with its own). */
  readonly reloadGame?: () => Promise<void>;
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
  /**
   * Override the composed records, for a test that wants a plugin to draft
   * against a record set it wrote rather than one a booted game latched.
   */
  readonly composedRecords?: ComposedRecords;
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
