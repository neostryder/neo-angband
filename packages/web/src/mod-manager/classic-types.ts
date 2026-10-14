import { type ModProblem } from "../mod-problems";
import { type ModDirKind, type ModOrigin } from "../disk-packs";
import { ModStore, type CatalogMod, type AutoplayerSpeed } from "../mod-store";
import { type ConflictReportLines } from "../mod-conflicts";
import { type ModHealthStats } from "../mod-health";
import { type ModRuleDecl } from "../pack";
import { type OrphanViewDeps } from "../mod-orphans";
import { type ModUpgradeDeps } from "../mod-browse";
import { type HostFolder } from "../host-folder";

/** What the manager needs to know about the on-disk mods folder. */
export interface DiskPackStatus {
  available: boolean;
  dir: string | null;
  /** How many mods came from the FOLDER. On its own this number misleads. */
  count: number;
  /**
   * How many came from the bundle instead. Reported alongside `count` because
   * the folder count alone reads as the whole mod list: "0 mods found in it" is
   * true of an empty folder in a game shipping three mods, and says nothing
   * about where those three are. Both numbers come from pack.ts, which is the
   * only place that knows both sets.
   */
  bundledCount: number;
  /**
   * Everything any layer knows about why a mod is not working, attributed to the mod
   * when it can be (mod-problems.ts). Five sources feed it and only two of them used
   * to reach a screen; the code loader's list reached nothing at all.
   */
  problems: readonly ModProblem[];
  /**
   * Mods not loaded ON PURPOSE - disabled, or waiting for capability consent. Kept
   * apart from `problems` so this screen never calls a mod broken for being off.
   */
  skipped: readonly ModProblem[];
  /**
   * Which kind of source these came from.
   *
   * ModDirKind itself rather than a copy of its members. It was spelled out here as
   * `"none" | "app" | "picked"`, and adding a fourth kind broke this assignment - which
   * was the lucky outcome. The unlucky one is a copy that still compiles and no longer
   * covers every case the producer can hand it.
   */
  kind: ModDirKind;
  /**
   * One entry per SOURCE that contributed mods, so this screen never has to claim
   * that one `kind`/`dir` describes all of them.
   *
   * A player can have a folder AND mods installed from repositories at the same time
   * (boot combines them - see combineDiskReports). "Mods folder: my-mods/ ... 2 from
   * this folder" was then a true sentence that read as the whole answer, while two
   * more mods loaded from IndexedDB with nothing on screen to say so.
   */
  origins: readonly ModOrigin[];
}

/**
 * Choosing a mods folder, on a front end that has to be GIVEN one.
 *
 * Absent on the desktop build, which knows where its own folder is, and on an
 * engine that cannot pick a directory at all - in both cases there is nothing here
 * for a player to do, so no row is offered. Every one of these takes effect on
 * reload, because content composes at load time.
 */
export interface ModFolderPicker {
  /** Ask for a folder. Resolves to its name, or null when cancelled. */
  pick(): Promise<string | null>;
  /** Re-grant read permission for the saved folder. */
  reconnect(): Promise<boolean>;
  /** Stop using the saved folder (the bundled mods remain). */
  forget(): Promise<void>;
  /** The saved folder's name, when one is remembered. */
  savedName(): Promise<string | null>;
}

/** What the manager needs from the host (discovery + reload are browser-only). */
export interface ModManagerDeps {
  look?: import("../look-state").LookStore;
  modLists?: import("./mod-lists").ModListStore;
  saveReferences?: (id: string) => boolean;
  /** The persisted enable/consent/profile store. */
  store: ModStore;
  /**
   * The mods DIRECTORY's state, when this front end has one (pack.diskPackStatus).
   * Absent means the same as unavailable; the manager says so rather than
   * implying a folder exists.
   */
  diskPackStatus?: () => DiskPackStatus;
  /**
   * Pick / reconnect / forget a mods folder. Present only where the player is the
   * one who has to supply it - a browser tab on an engine that can pick a
   * directory. See ModFolderPicker.
   */
  modFolder?: ModFolderPicker;
  /** Build the current catalog fresh (re-reads discovery + store each call). */
  listCatalog: () => CatalogMod[];
  /**
   * Re-read the mod SOURCES - the shell's folder, a picked folder, and the mods
   * installed into browser storage - so a mod downloaded a moment ago shows up in
   * `listCatalog()` without a reload.
   *
   * `listCatalog` is already "fresh", but only over a report that was latched once
   * at boot, which is why installing a mod and coming straight back to the list
   * showed nothing new. Optional: a host with no installable sources (a test) has
   * nothing to re-read.
   */
  rediscover?: () => Promise<void>;
  /** Human-readable conflict lines for the enabled content set (P7.6 humanLines). */
  conflictLines: () => ConflictReportLines;
  /**
   * What each mod's code has cost this session (mod-health.ts), for the Mod
   * performance screen. Absent means the row is not offered.
   */
  profiler?: () => readonly ModHealthStats[];
  /**
   * Apply pending changes by reloading (recompose content + reinstall plugins).
   *
   * `showGraphics` asks the reboot to open the Graphics screen once the game is
   * back. Enabling a tiles mod is the case that needs it: the mod's rows are
   * composed at boot, so enabling one is CORRECT to change nothing visible -
   * and "correct" is not the same as understandable. Reported from play as
   * "enabling it does nothing and the imagery stayed as text glyphs".
   */
  requestReload: (opts?: { showGraphics?: boolean }) => void;
  /**
   * The rule declarations of the currently ENABLED mods (qol / bug-fixes). Each
   * mod's own Fixes & tweaks submenu filters this by `modId`; a disabled mod is
   * absent from it entirely, which is what makes "a patch does not exist while
   * its mod is off" true of the UI and not just of core. Absent / empty when no
   * enabled mod declares rules.
   */
  ruleDecls?: () => ModRuleDecl[];
  /**
   * Apply a hooks-side rule toggle to the LIVE running game immediately (writes
   * GameState.modRules). A rule whose manifest requires a reload is recorded
   * and follows the ordinary reload path instead. Absent when no game is running
   * (the choice still persists and applies on next start).
   */
  applyRuleLive?: (flag: string, on: boolean) => void;
  /** Tell a running mod that one of its settings changed; absent when no game is running. */
  applySettingLive?: (modId: string, settingId: string) => void;
  /**
   * The player-facing speed control for a mod's autoplayer (ModPlugin.controller).
   * Absent while no game is running; `activeId`
   * lets the mod's own Fixes & tweaks screen show the row only for the mod that
   * actually holds the controller slot right now, since the pump rate means
   * nothing for a mod that is not the one pumping.
   */
  autoplayer?: {
    /** The id of the mod currently holding the one autoplayer slot, or null. */
    activeId: () => string | null;
    getSpeed: () => AutoplayerSpeed;
    /** Persists the choice and, if a controller is live, re-paces it at once. */
    setSpeed: (speed: AutoplayerSpeed) => void;
  };
  isModNoscore?: () => boolean;
  advanceSaveRatchets?: (mod: CatalogMod) => void;
  /**
   * The live game's quarantine store and what the host can see of the packs
   * that own it, for the "Set aside by a missing mod" row and its screen
   * (MOD_LIFECYCLE decision 7, mod-orphans.ts).
   *
   * Absent while no game is running - the title screen's mod manager has no
   * character and therefore nothing set aside - and the row simply does not
   * appear, rather than appearing and saying zero.
   */
  orphans?: OrphanViewDeps;
  /**
   * The `?mods=` URL override, when one is in force, else null. It outranks the
   * store for the RUNNING session (resolveEnabledIds), so the [x] boxes here -
   * which show the persisted set, the thing this screen edits - can disagree
   * with what is actually loaded. The manager says so rather than showing a
   * screenful of empty boxes over a game running three mods.
   */
  urlModsOverride?: () => readonly string[] | null;
  /**
   * The download catalogue, when this surface can install one. Absent on a surface
   * with no IndexedDB, which is the honest way to say "not here" - the row simply
   * does not appear, rather than appearing and failing.
   */
  /**
   * The three doors (mod-browse.ts): the curated list, a registry address, a
   * repository address.
   *
   * Takes over the "Get mods" row from modCatalogue when present. Both are here
   * during the changeover, and the browse screen wins - it is the one that can offer
   * a version newer than this build shipped with, because it asks the mod rather
   * than reading a catalogue compiled into the game.
   */
  modBrowse?: ModUpgradeDeps;
  /**
   * The mod-profile SYNC folder (#158) - a player-chosen folder a portable
   * mod-set snapshot is written to on the "Apply changes and reload"
   * checkpoint and read back from at menu-open, so a second device (or a
   * synced-folder tool watching the same path) can offer the newer set.
   *
   * Independent of `modFolder` above, which is the mods-SOURCE folder an
   * engine with no picker of its own asks the player to supply; this is a
   * destination for a snapshot, wired through `host-folder.ts`'s own
   * purpose-keyed primitive (`DELVE_SYNC_PURPOSE`), never through
   * `modFolder`. Absent means "no sync configured for this front end": the
   * write on Apply and the menu-open arrival check both no-op.
   */
  delveSync?: HostFolder;
}
