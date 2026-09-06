/**
 * The in-app mod manager (W2.4): the discoverable screen behind the Escape
 * menu's "Mods" row. It lets a player list installed mods, read what each one
 * does, enable/disable them, nudge load order, switch an individual patch of a
 * mod off, consent to plugin capabilities, view content conflicts, and manage
 * named profiles - all on the canvas glyph terminal, through the overlay.ts
 * helpers, launched via openModal (main.ts) so it owns input while up.
 *
 * The shape is deliberately MOD-CENTRIC: the top list highlights one mod at a
 * time and shows its full description, and everything about that mod - including
 * its fixes/tweaks - hangs off the mod's own screen. There is no pooled
 * cross-mod patch list, because a patch is part of a mod: it arrives when the mod
 * is enabled and does not exist while the mod is off.
 *
 * It is also deliberately RUDIMENTARY (MOD_LIFECYCLE.md decision 9, 2026-07-27):
 * enable/disable, per-patch and per-SECTION opt-out, a one-step order nudge,
 * one auto-sort button, conflicts, profiles. Deployment/staging, collections,
 * per-install profiles, update watching and bulk install/remove belong to an
 * external mod manager (Vortex/MO2) over the shared on-disk pack format.
 *
 * AUTO-SORT IS IN-GAME as of 2026-08-01, amending the part of that ruling that
 * put load-order SORTING outside too. The reason it moved: once authors can
 * declare compatibility, the sort's inputs (`group`, `compat`, loadAfter/Before,
 * the player's pins) are all things the ENGINE reads and an external manager
 * cannot see, and resolving them is one deterministic function rather than a UI.
 * It stays one button that PROPOSES - it writes nothing until the player
 * accepts, and it shows every suggestion it could not honour.
 *
 * It is deliberately decoupled from discovery and reload: main.ts injects a
 * ModManagerDeps (a live catalog builder, a conflict-line provider, and a
 * reload trigger), so this module is pure UI over the W2.4a store/catalog and
 * the P7.4/P7.6 mod-sdk machinery. Enable/disable/reorder mutate the persisted
 * store; the change takes effect on reload (content is composed at load time and
 * plugins are installed at boot), which the manager makes explicit.
 *
 * Where mods come from is surfaced honestly, and now with a real answer on the
 * desktop build: the "Where mods come from" row names the actual mods folder,
 * how many packs are in it, and anything it could not read. On a browser tab it
 * says there is no folder and why. Neither surface has a runtime CODE loader, so
 * neither can fetch and run a mod from a URL - a folder of records is a different
 * thing, and it composes through the same pipeline as a bundled pack.
 */

import {
  selectFromMenu,
  showTextScreen,
  MENU_REFRESH,
  type MenuItem,
  type ScreenLine,
} from "./overlay";
import {
  freezeView,
  SCREEN_FOOTER,
  type ScreenBlock,
  type ScreenRow,
  type ScreenView,
} from "./screen-view";
import type { GridPointerInput, GridSurface } from "./term";
import type { ModDirKind, ModOrigin } from "./disk-packs";
import type { AutoplayerSpeed, CatalogMod, ModStore } from "./mod-store";
import { dropSessionMods } from "./mod-session";
import type { ModRuleDecl } from "./pack";
import {
  problemsFor,
  unattributedProblems,
  type ModProblem,
} from "./mod-problems";
import { describeCapabilities, hasElevatedCapability } from "./capability-describe";
import { showModUpgrades, showRecommendedMods, type ModUpgradeDeps } from "./mod-browse";
import { displayName } from "./mod-authors";
import { modUpgradeRowLabel } from "./mod-refresh";
import type { ConflictReportLines } from "./mod-conflicts";
import {
  resolveSectionState,
  sortModOrder,
  type ContestedSlot,
  type PackManifest,
  type RecordConflict,
  type SortResult,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { wrapCssRuns } from "./shop";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD } from "./ui-colors";
import { t } from "@rpgm-tools/neo-angband-core";

const C_ENABLED = UI_GOOD;
const C_DISABLED = UI_DIM;
const C_WARN = UI_GOLD;
const C_DANGER = UI_BAD;
const C_FG = UI_TEXT;
const C_DIM = UI_DIM;
const C_TITLE = UI_TEXT;
const C_GOLD_TEXT = UI_GOLD;

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
   * Apply a rule toggle to the LIVE running game immediately (writes
   * GameState.modRules), so a tweak takes effect without a reload. Absent when
   * no game is running (the choice still persists and applies on next start).
   */
  applyRuleLive?: (flag: string, on: boolean) => void;
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
}

/**
 * The mods-folder row: label and colour for the three states it can be in.
 *
 * Exported and pure because the states are easy to get wrong in the direction that
 * hides a problem - a remembered folder the browser will not read must look
 * DIFFERENT from one it is reading, or the player sees a folder named on screen,
 * no mods from it, and no explanation.
 */
export function modFolderRow(
  savedName: string | null,
  attached: boolean,
): { label: string; color: string; lapsed: boolean } {
  if (savedName === null) {
    return {
      label: t("modsScreen.folder.choose", "Choose a mods folder..."),
      color: C_FG,
      lapsed: false,
    };
  }
  if (attached) {
    return {
      label: t("modsScreen.folder.row.attached", "Mods folder: {name}", { name: savedName }),
      color: C_FG,
      lapsed: false,
    };
  }
  return {
    label: t("modsScreen.folder.row.lapsed", "Mods folder: {name} - NEEDS RECONNECTING", {
      name: savedName,
    }),
    color: C_WARN,
    lapsed: true,
  };
}

/**
 * The "where these mods came from" line on the mods-folder screen.
 *
 * WHY THE BUNDLED CLAUSE IS DROPPED AT ZERO, rather than printed as "0". The game
 * bundles no mods at all now - FIRST_PARTY_MOD_IDS is empty, and a release build inlines
 * nothing - so "0 bundled with the game" would be a permanent fixture of this screen: a
 * number that can only ever be zero, sitting exactly where a player looks to find out
 * where their mods are. The clause exists to stop the other count reading as the whole
 * answer, and with nothing bundled there is nothing left for it to disambiguate.
 *
 * The other count is always printed, zero included. "0 from this folder" is the sentence
 * that tells a player the FOLDER is the empty part rather than the game.
 */
export function modSourceLine(bundledCount: number, count: number, theirs: string): string {
  const own = t("modsScreen.folder.source.own", "{count} {theirs}.", { count, theirs });
  if (bundledCount === 0) return own[0]!.toUpperCase() + own.slice(1);
  return t("modsScreen.folder.source.bundled", "{bundled} bundled with the game, {own}", {
    bundled: bundledCount,
    own,
  });
}

/**
 * What a browser with no directory picker is told.
 *
 * THIS TEXT WAS WRONG, in the way a screen can be wrong for a long time. It said "every
 * mod here is one bundled into the app - fully manageable, but a fixed set", and both
 * halves have since stopped being true: the game bundles no mods at all, and installing
 * one needs nothing this browser lacks - a network request and its own storage. So the
 * sentence told a Firefox or Safari player that their mod list was fixed, on a screen
 * they opened to find out how to change it. Telling someone not to look for the thing
 * that works is worse than saying nothing.
 *
 * Exported and pure so the words are testable. It is the words that are the behaviour
 * here, and the previous version was a template nothing asserted anything about.
 */
export function noFolderPickerLines(): ScreenLine[] {
  return [
    {
      text: t("modsScreen.noPicker.title", "This browser cannot be given a mods FOLDER."),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.noPicker.body1",
        "It has no way to hand a directory to a web page, so that one",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body2",
        "route is closed here. Downloading is not: Recommended mods... needs",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body3",
        "only a network request and this browser's own storage, and every",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body4",
        "mod on offer arrives that way - checked against a digest that",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body5",
        "ships inside the game, so a tampered download never runs.",
      ),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.noPicker.reassure",
        "Nothing is missing from your mod list because of your browser.",
      ),
      color: C_GOLD_TEXT,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.noPicker.alt1",
        "Chrome and Edge can ALSO be given a folder, which is useful for",
      ),
      color: C_WARN,
    },
    {
      text: t(
        "modsScreen.noPicker.alt2",
        "a mod you are writing; the desktop build keeps its own, which an",
      ),
      color: C_WARN,
    },
    {
      text: t("modsScreen.noPicker.alt3", "external mod manager can deploy into."),
      color: C_WARN,
    },
  ];
}

/**
 * The one-line badge for a catalog row: enabled state, any warning, and whether
 * this mod is BROKEN.
 *
 * "NOT WORKING" outranks every other flag and takes the row's colour, because it is
 * the only one that answers the question a player opens this screen with. A row that
 * said `[x] Quality of Life v0.10.0 (plugin)` in the enabled colour was the whole
 * problem: the mod was on, consented, listed, and contributing nothing, and the
 * screen agreed with it.
 *
 * `problems` is the mod's OWN problems, already filtered by caller - pure so the
 * wording is assertable.
 */
export function rowLabel(m: CatalogMod, problems: readonly string[] = []): MenuItem {
  /* A mod that is switched on and is not there. No version, no kind, no flags -
   * none of them mean anything without a manifest, and printing "v-  (content)"
   * beside a mod that does not exist reads as a mod that does. */
  if (m.missing) {
    return {
      label: t("modsScreen.row.notInstalled.label", "[x] {name}  - NOT INSTALLED", {
        name: m.name,
      }),
      color: C_DANGER,
      hint: t(
        "modsScreen.row.notInstalled.hint",
        "Switched on, but the mod itself is gone. Enter to remove it.",
      ),
    };
  }
  const box = m.enabled ? "[x]" : "[ ]";
  const needsConsent = m.enabled && !m.consented;
  const broken = problems.length > 0;
  /* NOT WORKING IS EXCLUSIVE, not merely first.
   *
   * It already outranked the others and took the row's colour, and the reason
   * given was that it is the one flag that answers the question a player opens
   * this screen with. That reasoning finishes here: a mod that is not running
   * is not affecting this game's determinism or its score right now, so listing
   * "! NOT WORKING, non-deterministic, noscore" spends thirty columns saying
   * one useful thing and two hypothetical ones - and on a wide-enough row it
   * pushed the useful one toward the edge. The save ratchets are still stated,
   * in the detail pane, where there is room to say what they mean.
   *
   * The short words are deliberate too. These share one line with a name, a
   * version and a kind; "non-deterministic" is seventeen columns of a word the
   * pane below spells out in a sentence anyway. */
  const flags: string[] = [];
  if (broken) {
    flags.push(t("modsScreen.row.flag.notWorking", "NOT WORKING"));
  } else {
    /* FIRST AMONG THE NON-EXCLUSIVE FLAGS, because it changes what every other
     * word on the row means: a version, a kind and a permission list all read as
     * facts about something the player has, and this one does not persist. Short
     * for the reason the others are - it shares a line with a name. */
    if (m.session) flags.push(t("modsScreen.row.flag.sessionOnly", "SESSION ONLY"));
    if (m.nondeterministic) flags.push(t("modsScreen.row.flag.unseeded", "unseeded"));
    if (m.affectsGameplay) flags.push(t("modsScreen.row.flag.noscore", "noscore"));
    if (needsConsent) flags.push(t("modsScreen.row.flag.needsOk", "NEEDS OK"));
  }
  const suffix = flags.length ? `  ! ${flags.join(", ")}` : "";
  // Kind distinguishes the two PLUGIN load paths (sandbox vs trusted); for a
  // non-plugin it is just "content", which mislabels a tiles pack - so show the
  // shape there instead ("tiles" for a tile pack, not "content").
  const kindTag = m.kind === "content" ? m.shape : m.kind;
  /* THE NAME IS WHAT GIVES WAY, not the badges.
   *
   * selectFromMenu slices a row at the terminal's edge, so an over-long row
   * loses its END - and the end is where "! NOT WORKING, noscore" lives. A mod
   * called "Bug Fixes" with both save ratchets set built
   * an 85-column row, and what a player saw was the name, the version, the kind,
   * and none of the three warnings. Eliding the name instead keeps every badge
   * on screen and costs a few characters of something the row below spells out
   * in full. Measured in mod-viewport.test.ts against the real paint. */
  const fixed = `${box}   v${m.version}  (${kindTag})${suffix}`;
  const room = Math.max(MIN_NAME_COLS, LABEL_COLS - fixed.length);
  const name = displayName(m.name, m.manifest.author, room);
  const label = `${box} ${name}  v${m.version}  (${kindTag})${suffix}`;
  const color = broken
    ? C_DANGER
    : needsConsent
      ? C_WARN
      : m.enabled
        ? C_ENABLED
        : C_DISABLED;
  /* "Requests 2 capability(ies)" was the machine talking. Nobody says
   * "capability(ies)", and the count on its own tells a player nothing they can
   * act on - the detail pane below already lists what each one is for. */
  const capNote =
    m.capabilities.length === 0
      ? t("modsScreen.row.cap.none", "Asks for nothing beyond the game.")
      : t("modsScreen.row.cap.count", "Asks for {count, plural, one {one permission} other {# permissions}}.", {
          count: m.capabilities.length,
        });
  /* No "Enter to manage it." on the end. The footer of this very screen already
   * says so for every row, and repeating it cost four columns off the end of
   * the longest hint - which is the part that describes the mod. */
  return {
    label,
    color,
    hint: broken
      ? t(
          "modsScreen.row.hint.broken",
          "{count, plural, one {Something} other {# things}} stopped this working. Enter to see what.",
          { count: problems.length },
        )
      : m.session
        ? /* The hint says what is different about this row rather than what the
           * mod does, because the shape and the permissions are on the detail
           * screen and "it goes away when you close the game" is not. */
          t(
            "modsScreen.row.hint.sessionOnly",
            "Loaded for this session, not installed. Gone when you close the game.",
          )
        : `${describeShape(m.shape)} ${capNote}`,
  };
}

/**
 * The widest a row's label may be: 80 columns, less the one the slice reserves,
 * less the three `x) ` takes (display_menu_row, ui-menu.c:577-585).
 */
const LABEL_COLS = 80 - 1 - 3;
/** Never elide a name below this - past it the row stops identifying anything. */
const MIN_NAME_COLS = 14;


/** What a manifest's `shape` is, said the way a player would say it. */
function describeShape(shape: string): string {
  switch (shape) {
    case "content":
      return t("modsScreen.shape.content", "Changes the game's contents.");
    case "tiles":
      return t("modsScreen.shape.tiles", "A set of graphics.");
    case "plugin":
      return t("modsScreen.shape.plugin", "Runs its own code.");
    default:
      /* `shape` here is whatever a manifest declares, so it is not a fixed set of
       * literals this file can enumerate - a stray custom shape falls through to
       * this line rather than to one of the three named cases above. */
      return t("modsScreen.shape.other", "A {shape} mod.", { shape });
  }
}

/**
 * Word-wrap plain text to `width` columns as ScreenLines. The menu's detail pane
 * hard-slices at the terminal edge, so anything long enough to be worth reading -
 * a mod's own description, a patch's - has to be wrapped before it gets there.
 */
function wrapped(text: string, width: number, color = C_FG): ScreenLine[] {
  return wrapCssRuns([{ text, color }], Math.max(20, width)).map((runs) => ({
    text: runs.map((r) => r.text).join(""),
    color,
  }));
}

/**
 * The detail pane for a catalog row: the mod's own description (the thing a
 * player actually needs in order to decide, wrapped to fill the pane), then what
 * it is, what it depends on, what its patches do collectively, and the trust /
 * consent facts. `width` is the terminal's column count.
 *
 * `maxLines` is the pane's budget. selectFromMenu gives the detail pane whatever
 * it asks for and shrinks the LIST to fit, so an unbounded description on the
 * top-level Mods list would push the action rows off screen. Only the
 * description flexes: the identity and trust lines are never dropped, and the
 * mod's own screen (few rows, a big budget) shows the description in full.
 */
export function rowDetail(
  m: CatalogMod,
  width = 80,
  maxLines = 99,
  problems: readonly string[] = [],
  skipped: readonly string[] = [],
): ScreenLine[] {
  const w = width - 1;
  /* A mod that is on and not installed. Everything below this point describes a
   * manifest, and there is not one; what the player needs instead is the two
   * sentences that explain the state and end it. */
  if (m.missing) {
    return [
      ...wrapped(m.name, w, C_TITLE),
      ...wrapped(t("modsScreen.detail.missing.title", "Switched on, but not installed."), w, C_DANGER),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          "modsScreen.detail.missing.why",
          "This mod is in your enabled list and the game cannot find it, so " +
            "every launch tries to load it and gives up. It was probably " +
            "uninstalled, or this is a fresh copy of the game over an old profile.",
        ),
        w,
      ),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          "modsScreen.detail.missing.action",
          "Open it to take it off the list. If you want it back instead, " +
            "Recommended mods... will fetch it again.",
        ),
        w,
        C_WARN,
      ),
    ];
  }
  /* EVERY line here goes through wrapped(), not just the description. The
   * description was wrapped and its siblings were not, so on any terminal
   * narrower than the longest of them - "Non-deterministic: enabling this
   * permanently marks the save non-reproducible." is 76 columns, a capability
   * blurb can be longer - the pane sliced them mid-word at cols-1 while the
   * paragraph above wrapped cleanly. */
  const head: ScreenLine[] = [
    ...wrapped(
      t("modsScreen.detail.head.nameId", "{name}  (id: {id})", {
        name: displayName(m.name, m.manifest.author),
        id: m.id,
      }),
      w,
      C_TITLE,
    ),
    ...wrapped(
      m.kind === "content"
        ? t("modsScreen.detail.head.versionContent", "version {version}  -  {shape} pack", {
            version: m.version,
            shape: m.shape,
          })
        : t(
            "modsScreen.detail.head.versionPlugin",
            "version {version}  -  {shape} pack, {kind} plugin",
            { version: m.version, shape: m.shape, kind: m.kind },
          ),
      w,
    ),
  ];
  /* The author's name IN FULL, plus the licence. The line above carries the short
   * form beside the mod's name (displayName drops an organisation in parentheses to
   * keep a row inside 80 columns); this is the place that has room for whatever they
   * actually wrote, so this is where it is said. */
  const by = [m.manifest.author, m.manifest.license].filter(Boolean).join("  -  ");
  if (by) head.push(...wrapped(by, w, C_DIM));

  /* WHY THIS MOD IS NOT WORKING, directly under its name and above everything else
   * including its own description.
   *
   * It goes here rather than in the `below` block for the same reason it takes the
   * row's colour: the description is what a player reads to decide whether they WANT
   * the mod, and this is what they read when they already turned it on and nothing
   * happened. The description flexes to fit the pane; this never does - it is
   * subtracted from the description's budget instead, so a long blurb can be cut and
   * a fault cannot. Every one of these lines was previously reachable only from a
   * devtools console, and four of the five sources reached nothing at all. */
  const trouble: ScreenLine[] = [];
  if (problems.length > 0) {
    trouble.push({ text: "", color: C_FG });
    trouble.push(
      ...wrapped(
        t(
          "modsScreen.detail.trouble.heading",
          "{count, plural, one {NOT WORKING:} other {NOT WORKING - # problems:}}",
          { count: problems.length },
        ),
        w,
        C_DANGER,
      ),
    );
    for (const p of problems) {
      /* Hanging indent, so a wrapped problem stays visibly one problem. */
      trouble.push(
        ...wrapped(`  - ${p}`, w, C_DANGER).map((l, i) =>
          i === 0 ? l : { ...l, text: `    ${l.text}` },
        ),
      );
    }
  }
  /* Not a fault, and said differently: a mod that is enabled and waiting for consent
   * is not broken, but it is also not running, and "enabled" alone does not
   * distinguish those two for a player looking at a mod that does nothing. */
  for (const s of skipped) {
    trouble.push(
      { text: "", color: C_FG },
      ...wrapped(t("modsScreen.detail.trouble.notLoaded", "Not loaded: {reason}", { reason: s }), w, C_WARN),
    );
  }

  const below: ScreenLine[] = [];
  const ruleCount = m.manifest.rules?.length ?? 0;
  if (ruleCount > 0) {
    below.push({ text: "", color: C_FG });
    below.push(
      ...wrapped(
        m.enabled
          ? t(
              "modsScreen.detail.rules.enabled",
              "Makes {count, plural, one {# separate change} other {# separate changes}}, all on. Open the mod to switch any one off.",
              { count: ruleCount },
            )
          : t(
              "modsScreen.detail.rules.disabled",
              "Makes {count, plural, one {# separate change} other {# separate changes}}. None of them happen while it is off; turning it on turns all of them on.",
              { count: ruleCount },
            ),
        w,
        m.enabled ? C_ENABLED : C_DIM,
      ),
    );
  }
  const deps = m.manifest.dependencies
    ? Object.entries(m.manifest.dependencies).map(([d, v]) => `${d} ${v}`)
    : [];
  if (deps.length) {
    below.push(
      ...wrapped(t("modsScreen.detail.needs", "Needs: {deps}", { deps: deps.join(", ") }), w),
    );
  }
  /* WHO ASKED FOR THIS, not where it came from - that is `browseDetail`'s "From"
   * line, on a different screen entirely, and this pane has never shown it. A
   * mod-building tool can install a mod it generated through `ctx.installMod`,
   * and the player is owed the difference between that and a zip they picked
   * themselves - the same reason `session` gets its own row rather than being
   * folded into "enabled". */
  if (m.installedByModId !== undefined) {
    below.push(
      ...wrapped(
        t("modsScreen.detail.installedBy", "Installed by: {id}", { id: m.installedByModId }),
        w,
        C_DIM,
      ),
    );
  }
  /* THE TWO ONE-WAY DOORS, said as one-way doors.
   *
   * "Non-deterministic: enabling this permanently marks the save
   * non-reproducible" is three pieces of jargon in a row about a decision that
   * cannot be undone, on a screen where the next keypress makes it. What a
   * player needs to know is that turning it on is permanent for THIS character,
   * and what they give up. */
  /* Short on purpose, as well as plain. These are the two lines that must
   * survive the pane's budget on a narrow terminal (see the truncation rule
   * below), and a warning that takes three wrapped lines is a warning that can
   * lose its last one - which is where the consequence lives. */
  if (m.nondeterministic) {
    below.push(
      ...wrapped(
        t(
          "modsScreen.detail.nondeterministicWarning",
          "Permanent once on: the same seed stops giving the same game.",
        ),
        w,
        C_WARN,
      ),
    );
  }
  if (m.affectsGameplay) {
    below.push(
      ...wrapped(
        t(
          "modsScreen.detail.affectsGameplayWarning",
          "Permanent once on: changes play, so this character cannot score.",
        ),
        w,
        C_WARN,
      ),
    );
  }
  if (m.capabilities.length === 0) {
    /* "(content only)" was wrong for a plugin that requests nothing, and a folder
     * plugin is exactly that case: it runs code but asks for no registry domain,
     * so the row said "content only" about a mod whose whole substance is code.
     * The parenthetical now describes the mod in front of the player.
     *
     * AND IT SAYS THE CODE PART OUT LOUD, because "asks for no permissions" on
     * its own reads as "cannot do anything" and that is not what an empty
     * capability list means. A plugin is handed `ctx.core` (the live engine
     * namespace), `ctx.state` and `ctx.registries` with no capability check at
     * all, so a mod declaring nothing still reaches the registries the
     * capability-gated facades guard - see docs/modding/PLUGINS.md, "What a
     * capability gates". The list is what the mod DECLARED, and the code is what
     * the player is actually trusting. Warning colour rather than dim for the
     * same reason: it is the one row here that a player would otherwise read as
     * a reassurance. */
    below.push(
      ...wrapped(
        m.kind === "content"
          ? t(
              "modsScreen.detail.noPermissions.content",
              "Asks for no permissions - it only adds and changes game contents.",
            )
          : t(
              "modsScreen.detail.noPermissions.code",
              "Asks for no permissions, but it still runs its own code in the game.",
            ),
        w,
        m.kind === "content" ? C_DIM : C_WARN,
      ),
    );
  } else {
    below.push(...wrapped(t("modsScreen.detail.capabilitiesIntro", "It asks to be allowed to:"), w));
    for (const d of describeCapabilities(m.capabilities)) {
      /* Hanging indent so a wrapped bullet stays visibly one bullet. */
      const elevatedTag = d.elevated ? `  ${t("modsScreen.detail.elevatedTag", "[powerful]")}` : "";
      below.push(
        ...wrapped(`  - ${d.text}${elevatedTag}`, w, d.elevated ? C_WARN : C_FG)
          .map((l, i) => (i === 0 ? l : { ...l, text: `    ${l.text}` })),
      );
    }
    below.push(
      ...wrapped(
        m.consented
          ? t("modsScreen.detail.consented", "You have allowed this.")
          : t(
              "modsScreen.detail.notConsented",
              "You have not allowed this yet - you will be asked when you turn it on.",
            ),
        w,
        m.consented ? C_ENABLED : C_WARN,
      ),
    );
  }

  /* The description gets whatever the head and the below block leave. This used
   * to be a COUNT of how many lines each part was expected to occupy (rules ? 3
   * : 0, deps ? 1 : 0, ...), which is only right while every one of them is a
   * single line - and once they wrap, the guess under-reserves and the pane
   * overflows. Measuring the built lines cannot drift from what is drawn. */
  const lines = [...head, ...trouble];
  const MORE = {
    text: t("modsScreen.detail.more", "...  (open the mod to read the rest)"),
    color: C_DIM,
  };
  if (m.manifest.description) {
    const room = maxLines - head.length - trouble.length - below.length - 1;
    const desc = wrapped(m.manifest.description, w);
    if (desc.length <= room) {
      lines.push({ text: "", color: C_FG }, ...desc);
    } else if (room >= 2) {
      lines.push({ text: "", color: C_FG }, ...desc.slice(0, room - 1), MORE);
    } else {
      /* No room for even a line of it plus the pointer: the head and the block
       * below already fill the pane. Say so instead of showing a stub. */
      lines.push({ text: "", color: C_FG }, MORE);
    }
  }
  const all = [...lines, ...below];

  /* Even with no description at all the pane can outgrow a short terminal, and
   * overlay.ts's print loop just STOPS at the hint row - silently, from the
   * bottom, which is where the two save-ratchet warnings are. Truncating here
   * instead keeps the loss visible and keeps this function's length equal to
   * what gets drawn, which is the property the caller's budget depends on. */
  if (all.length <= maxLines) return all;
  return [...all.slice(0, Math.max(1, maxLines - 1)), MORE];
}

/**
 * A mod's description in full, for the scrolling viewer - the place the capped
 * detail pane sends a player who wants the rest of it.
 *
 * Paragraphs are kept: a blank line in a manifest's description is the author
 * separating two ideas, and `wrapped()` on the whole string runs them together
 * into the wall of text this row exists to stop being the only option.
 *
 * LEFT AT `lines`, DELIBERATELY. This page is the canonical finished-at-`lines`
 * case: it is one stranger's prose, already wrapped, and the three rows in front of
 * it are not a repeated record - a name-and-id line, a version-and-shape line and an
 * author-and-licence line, each a different shape and each present or not on its
 * own. A table of three one-off rows is a table with no second row to line up
 * against, and re-declaring the prose as a `text` block would hand the wrap from
 * `wrapCssRuns` to `textblock_calculate_lines` and move the page under the player.
 * The header's FIELDS are already reachable: every one of them comes off
 * `CatalogMod`, which a presenter has before it has this screen.
 */
export function fullDescription(m: CatalogMod, width = 80): ScreenLine[] {
  const w = width - 1;
  const out: ScreenLine[] = [
    ...wrapped(
      t("modsScreen.fullDesc.nameId", "{name}  (id: {id})", {
        name: displayName(m.name, m.manifest.author),
        id: m.id,
      }),
      w,
      C_TITLE,
    ),
    ...wrapped(
      t("modsScreen.fullDesc.version", "version {version}  -  {shape} pack", {
        version: m.version,
        shape: m.shape,
      }),
      w,
      C_DIM,
    ),
  ];
  const by = [m.manifest.author, m.manifest.license].filter(Boolean).join("  -  ");
  if (by) out.push(...wrapped(by, w, C_DIM));
  out.push({ text: "", color: C_FG });
  for (const para of (m.manifest.description ?? "").split(/\n\s*\n/u)) {
    const text = para.trim();
    if (!text) continue;
    out.push(...wrapped(text, w), { text: "", color: C_FG });
  }
  const deps = m.manifest.dependencies
    ? Object.entries(m.manifest.dependencies).map(([d, v]) => `${d} ${v}`)
    : [];
  if (deps.length) {
    out.push(
      ...wrapped(t("modsScreen.fullDesc.needs", "Needs: {deps}", { deps: deps.join(", ") }), w, C_DIM),
    );
  }
  if (m.manifest.engine) {
    out.push(
      ...wrapped(
        t("modsScreen.fullDesc.engine", "Written for game {engine}", { engine: m.manifest.engine }),
        w,
        C_DIM,
      ),
    );
  }
  return out;
}

/** True exactly while enabling `m` needs the one-time score warning. */
export function needsGameplayNoscoreWarning(m: CatalogMod, modNoscore: boolean): boolean {
  return m.affectsGameplay && !modNoscore;
}

/** Run the one-time warning only for the transition that trips the ratchet. */
export async function confirmGameplayNoscore(
  m: CatalogMod,
  modNoscore: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return needsGameplayNoscoreWarning(m, modNoscore) ? confirm() : true;
}

async function gameplayNoscorePrompt(term: GridSurface & GridPointerInput, m: CatalogMod): Promise<boolean> {
  await showTextScreen(
    term,
    t("modsScreen.noscore.title", "Non-scoring save - {name}", { name: m.name }),
    [
      {
        text: t("modsScreen.noscore.body1", "This mod changes core gameplay behavior."),
        color: C_WARN,
      },
      {
        text: t(
          "modsScreen.noscore.body2",
          "Your save will be permanently marked as non-scoring.",
        ),
        color: C_WARN,
      },
    ],
    consentFooter(),
  );
  const pick = await selectFromMenu(
    term,
    "core:mod-enable-gameplay",
    t("modsScreen.noscore.confirm", 'Enable gameplay-changing mod "{name}"?', { name: m.name }),
    [
      {
        label: t("modsScreen.noscore.yes", "Yes, enable and mark save non-scoring"),
        color: C_WARN,
      },
      { label: t("modsScreen.common.no.cancel", "No, cancel"), color: C_FG },
    ],
    t("modsScreen.common.footer.abTapEsc", "[ a/b or tap; ESC cancels ]"),
  );
  return pick === 0;
}

/**
 * The footer under the consent read, before the Yes/No pick that follows it.
 *
 * A FUNCTION, not a constant: see gameMenuFooter's comment in game-menu.ts - a
 * locale can change mid-session, so nothing translatable may be frozen at
 * import time.
 */
function consentFooter(): string {
  return t("modsScreen.consent.footer", "[ Press ESC to review, then choose ]");
}

/**
 * The capability consent gate as a document: what is being asked for, as a LIST.
 *
 * `describeCapabilities` already answers `{ cap, text, elevated }` per grant, and
 * the screen was flattening all three into `  - <text>   [elevated]`. So the one
 * fact this screen exists to make impossible to miss - which grants are the
 * powerful ones - was recoverable only by looking for a word in a sentence. Each
 * grant is now a row: `elevated` is a boolean on `semantic.data`, `cap` is the raw
 * capability string on `semantic.ref`, and a presenter draws the flag as whatever
 * a warning looks like in its own vocabulary.
 *
 * The bullet is a CELL rather than the table's own `tagged` prefix, which would
 * write `a) ` - a lettered row the player cannot choose, three columns wide by
 * coincidence. As a cell it is the marker, and a presenter replaces it with an icon.
 *
 * The sentences around the list are prose and stay `lines`; the warnings use prose
 * blocks so a warning itself cannot be cut off on the terminal.
 */
export function capabilityConsentScreen(requested: CatalogMod | readonly CatalogMod[]): ScreenView {
  const mods = Array.isArray(requested) ? requested : [requested];
  const one = mods.length === 1;
  const m = mods[0];
  if (!m) throw new Error("capability consent needs at least one mod");
  const capabilities = mods.flatMap((mod) =>
    describeCapabilities(mod.capabilities).map((detail) => ({ mod, detail })),
  );
  return freezeView({
    id: "core:mod-capabilities",
    title: one
      ? t("modsScreen.consent.title", "Consent - {name}", { name: m.name })
      : t("modsScreen.consent.batchTitle", "Capability approval"),
    footer: consentFooter(),
    blocks: [
      {
        kind: "lines",
        lines: [
          {
            text: one
              ? t("modsScreen.consent.requests", '"{name}" requests these capabilities:', {
                  name: m.name,
                })
              : t("modsScreen.consent.batchRequests", "These mods request these capabilities:"),
            color: C_TITLE,
          },
          { text: "", color: C_FG },
        ],
      },
      {
        kind: "table",
        key: "capabilities",
        tagged: false,
        columns: [
          { key: "bullet", width: 3, align: "right" },
          /* A capability blurb runs to 200 characters (registry:*). It consumes
           * the room left by the bullet and flag, then continues below them. */
          { key: "text", wrap: true },
          /* Three columns of space before the flag, as the column's own gap rather
           * than as three spaces on the front of the cell - a row with no flag then
           * ends where it always did, because the renderer cuts the trailing run. */
          { key: "elevated", gap: 3, pad: false },
        ],
        rows: capabilities.map(({ mod, detail }) => ({
          id: `${mod.id}:${detail.cap}`,
          semantic: {
            kind: "capability",
            ref: detail.cap,
            data: one ? { elevated: detail.elevated } : { modId: mod.id, elevated: detail.elevated },
          },
          color: detail.elevated ? C_WARN : C_FG,
          cells: {
            bullet: { text: "-" },
            text: { text: one ? detail.text : `${mod.name}: ${detail.text}` },
            elevated: { text: detail.elevated ? t("modsScreen.consent.elevatedTag", "[elevated]") : "" },
          },
        })),
      },
      { kind: "lines", lines: [{ text: "", color: C_FG }] },
      /* THE IN-PROCESS LINE IS ABOUT THE CODE, NOT ABOUT THE LIST above it.
       * A plugin receives `ctx.core`, `ctx.state` and `ctx.registries` without a
       * capability check, so declared capabilities say what it intends to
       * override, not what its code can reach. Any mod that ships code gets this
       * warning; a validated content pack does not. */
      ...(mods.some((mod) => mod.kind !== "content" || hasElevatedCapability(mod.capabilities))
        ? [
            {
              kind: "text" as const,
              paragraphs: [
                [
                  {
                    text: t(
                      "modsScreen.consent.runsCode",
                      "This mod runs its own code inside the game and can change how the game behaves. Only enable mods you trust.",
                    ),
                  },
                ],
              ],
              color: C_DANGER,
            },
          ]
        : []),
      ...(mods.some((mod) => mod.nondeterministic)
        ? [
            {
              kind: "text" as const,
              paragraphs: [
                [
                  {
                    text: t(
                      "modsScreen.consent.nonReproducible",
                      one
                        ? "It also marks your save permanently non-reproducible."
                        : "One or more of these mods mark your save permanently non-reproducible.",
                    ),
                  },
                ],
              ],
              color: C_WARN,
            },
          ]
        : []),
      {
        kind: "lines",
        lines: [
          { text: "", color: C_FG },
        ],
      },
    ],
  });
}

/**
 * The capability consent gate: show every requested capability in plain terms,
 * flag elevated ones, and require an explicit Yes. Returns true if consented.
 */
async function consentPrompt(term: GridSurface & GridPointerInput, m: CatalogMod): Promise<boolean> {
  return await consentPromptForMods(term, [m]);
}

/** One explicit choice grants the declared capabilities for a whole bulk action. */
async function consentPromptForMods(
  term: GridSurface & GridPointerInput,
  mods: readonly CatalogMod[],
): Promise<boolean> {
  const one = mods.length === 1;
  const m = mods[0];
  if (!m) return true;
  // A trailing read of the terms, then a Yes/No pick.
  await showTextScreen(term, capabilityConsentScreen(mods));
  const pick = await selectFromMenu(
    term,
    "core:mod-capability-consent",
    one
      ? t("modsScreen.consent.grantConfirm", 'Grant these capabilities to "{name}"?', { name: m.name })
      : t("modsScreen.consent.batchConfirm", "Grant these capabilities to all selected mods?"),
    [
      {
        label: one
          ? t("modsScreen.consent.yes", "Yes, enable and grant")
          : t("modsScreen.consent.batchYes", "Yes, enable all and grant"),
        color: C_ENABLED,
      },
      { label: t("modsScreen.common.no.cancel", "No, cancel"), color: C_FG },
    ],
    t("modsScreen.common.footer.abTapEsc", "[ a/b or tap; ESC cancels ]"),
  );
  return pick === 0;
}

/**
 * Enable a mod straight after the player selected "Install and enable".
 *
 * It re-reads the mod sources first, and that call is what makes the rest of this
 * possible. `listCatalog()` is built from a report latched at boot, so a mod
 * installed thirty seconds ago is not in it - the answer to "which mod is this"
 * would have been "no such mod", and enabling it by bare id would skip the
 * consent prompt and the non-scoring warning, which are exactly the things that
 * must not be skipped by a convenience. With the sources re-read the mod is a
 * real catalogue row and goes through the same enableMod every other path uses.
 *
 * There is intentionally no second yes/no screen for a content-only mod. The
 * action the player just chose already says "Install and enable", while the
 * browse pane they chose it from names the mod, version, author standing,
 * engine range, payload size, and source. Anything that changes the safety
 * decision (capabilities, a declared conflict, or a non-scoring game) still
 * stops here and asks in its own words before the mod is enabled.
 */
async function enableAfterInstall(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  id: string,
): Promise<boolean> {
  await deps.rediscover?.();
  const m = deps.listCatalog().find((x) => x.id === id);
  /* No row even after re-reading: the manifest did not validate, or this host has
   * no rediscover. Neither is a thing to ask a yes/no question about - the mod
   * list will show why - so say nothing and leave it off. */
  if (!m || m.missing) return false;
  if (m.enabled) return true;
  return enableMod(term, deps, m);
}

/** Enable a mod, gating plugins on capability consent. Returns true if enabled. */
async function enableMod(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  if (!(await confirmGameplayNoscore(
    m,
    deps.isModNoscore?.() ?? false,
    () => gameplayNoscorePrompt(term, m),
  ))) return false;
  if (!(await confirmDeclaredConflicts(term, deps, m))) return false;
  if (m.capabilities.length > 0) {
    const ok = await consentPrompt(term, m);
    if (!ok) return false;
    deps.store.setConsent(m.id, m.capabilities);
  }
  deps.advanceSaveRatchets?.(m);
  deps.store.setModEnabled(m.id, true);
  return true;
}

/**
 * Enable a recommended set after a bulk action, with one capability decision.
 *
 * The ordinary per-mod path deliberately remains as it is: its consent screen is
 * the right amount of ceremony for one mod. A bulk action has already collected a
 * set, so asking the same question several times would obscure the very capability
 * list the player needs to compare. Every other enable gate still runs before the
 * combined consent, then the grants and enables are committed together as a loop.
 */
async function enableRecommendedMods(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  ids: readonly string[],
  enableAllOptions: boolean,
): Promise<boolean> {
  await deps.rediscover?.();
  const wanted = new Set(ids);
  const mods = deps.listCatalog().filter((m) => wanted.has(m.id) && !m.missing);
  const toEnable = mods.filter((m) => !m.enabled);

  for (const m of toEnable) {
    if (!(await confirmGameplayNoscore(
      m,
      deps.isModNoscore?.() ?? false,
      () => gameplayNoscorePrompt(term, m),
    ))) return false;
    if (!(await confirmDeclaredConflicts(term, deps, m))) return false;
  }

  const needingConsent = toEnable.filter((m) => m.capabilities.length > 0 && !m.consented);
  if (needingConsent.length > 0 && !(await consentPromptForMods(term, needingConsent))) return false;

  for (const m of needingConsent) deps.store.setConsent(m.id, m.capabilities);
  for (const m of toEnable) {
    deps.advanceSaveRatchets?.(m);
    deps.store.setModEnabled(m.id, true);
  }

  if (!enableAllOptions) return toEnable.length > 0;
  for (const m of mods) {
    for (const rule of m.manifest.rules ?? []) {
      deps.store.setRuleChoice(rule.flag, true);
      deps.applyRuleLive?.(rule.flag, true);
    }
    for (const section of m.manifest.sections ?? []) {
      deps.store.setSectionChoice(m.id, section.id, true);
    }
  }
  return toEnable.length > 0 || mods.some((m) => (m.manifest.rules?.length ?? 0) > 0 || (m.manifest.sections?.length ?? 0) > 0);
}

/**
 * Offer the existing one reload decision at the point a combined first install
 * finishes. Reload remains optional: "Later" leaves the recorded enablement in
 * place for a normal future reload. Returning here rather than repainting the
 * source and manager menus is safe because the player has already seen the
 * install outcome and can reopen either list at any time.
 */
async function applyModChanges(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  tileModsAtEntry: ReadonlySet<string>,
): Promise<void> {
  /* A newly-enabled tiles mod contributes Graphics rows and nothing else, so
   * say so here and open that screen after the reload. Without this the player
   * enables a tile mod, reloads, sees an unchanged ASCII map, and concludes the
   * mod is broken - which is what happened. */
  const newTiles = [...enabledTileModIds(deps)].some((id) => !tileModsAtEntry.has(id));
  const pick = await selectFromMenu(
    term,
    "core:mod-apply",
    newTiles
      ? t("modsScreen.applyPrompt.titleTiles", "Apply mod changes? (adds tile sets to Graphics)")
      : t("modsScreen.applyPrompt.title", "Apply mod changes?"),
    [
      {
        label: newTiles
          ? t("modsScreen.applyPrompt.reloadTiles", "Reload now, then pick a tile set")
          : t("modsScreen.applyPrompt.reload", "Reload now to apply"),
        color: C_ENABLED,
      },
      {
        label: t("modsScreen.applyPrompt.later", "Later (changes are saved; apply on next reload)"),
        color: C_FG,
      },
    ],
    t("modsScreen.applyPrompt.footer", "[ a/b or tap ]"),
  );
  if (pick === 0) deps.requestReload(newTiles ? { showGraphics: true } : undefined);
}

/**
 * Show any `conflicts` claim between this mod and one already enabled, and let
 * the player go ahead anyway.
 *
 * IT WARNS AND NEVER BLOCKS, which is the deliberate divergence from NeoForge
 * and Factorio - both refuse to launch an incompatible pair. Two reasons, and
 * they point the same way: ratified decision 18 says the engine labels rather
 * than forbids, and a claim is one author's opinion about somebody else's mod,
 * which must not become a veto over the player's own setup. A declaration also
 * goes stale - the other mod fixes the clash and the warning outlives it - and a
 * stale warning the player cannot walk past is a mod they cannot use.
 *
 * Both directions are checked: the claim may be written by the mod being enabled
 * or by one already on, and the player needs to see it either way.
 */
async function confirmDeclaredConflicts(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  const catalog = deps.listCatalog();
  const nameOf = (id: string): string => catalog.find((c) => c.id === id)?.name ?? id;
  const enabled = catalog.filter((c) => c.enabled && c.id !== m.id);
  const claims: { text: string; because: string }[] = [];

  const claimText = (a: string, b: string, scope: readonly string[] | undefined): string =>
    scope?.length
      ? t("modsScreen.conflicts.claimScoped", "{a} says it conflicts with {b} over {scope}.", {
          a,
          b,
          scope: scope.join(", "),
        })
      : t("modsScreen.conflicts.claim", "{a} says it conflicts with {b}.", { a, b });

  for (const c of m.manifest.compat ?? []) {
    if (c.claim !== "conflicts" || !enabled.some((e) => e.id === c.with)) continue;
    claims.push({
      text: claimText(m.name, nameOf(c.with), c.scope),
      because: c.because,
    });
  }
  for (const other of enabled) {
    for (const c of other.manifest.compat ?? []) {
      if (c.claim !== "conflicts" || c.with !== m.id) continue;
      claims.push({
        text: claimText(other.name, m.name, c.scope),
        because: c.because,
      });
    }
  }
  if (claims.length === 0) return true;

  const body: ScreenLine[] = [];
  for (const c of claims) {
    body.push({ text: c.text, color: C_WARN });
    body.push(...wrapped(c.because, term.size().cols - 1));
    body.push({ text: "", color: C_DIM });
  }
  body.push({
    text: t(
      "modsScreen.conflicts.authorWarning",
      "This is the author's own warning. Nothing stops you running both.",
    ),
    color: C_DIM,
  });
  /* LEFT AT `lines`, DELIBERATELY (see screen-view.ts's header for the rule).
   *
   * `claims` is a real array, but a claim does not render as a row: it is one
   * UNWRAPPED headline - the screen lets a long mod name run to the edge rather
   * than fold, which a `text` block would undo - followed by the author's own
   * `because`, wrapped to the live terminal, followed by a blank. That is one to
   * many rows per record, varying with the terminal's width and with what a
   * stranger typed into their manifest, and a table row is one row. Both halves
   * are also prose: the headline is a sentence this file generates and `because`
   * is free author text, which is the case the model calls finished at `lines`. */
  await showTextScreen(term, t("modsScreen.conflicts.enableTitle", "Enable {name}?", { name: m.name }), body);

  const pick = await selectFromMenu(
    term,
    "core:mod-enable-anyway",
    t("modsScreen.conflicts.enableAnyway", "Enable {name} anyway?", { name: m.name }),
    [
      { label: t("modsScreen.conflicts.enableItAnyway", "Enable it anyway"), color: C_WARN },
      { label: t("modsScreen.common.leaveItOff", "Leave it off"), color: C_DIM },
    ],
    t("modsScreen.common.footer.enterEscLeaveOff", "[ Enter to choose; ESC to leave it off ]"),
  );
  return pick === 0;
}

/**
 * Per-mod action submenu: toggle, reorder, THIS MOD'S patches, details. Returns
 * true if anything changed. The patch list hangs off the mod that provides it
 * rather than a pooled screen, because that is where a patch belongs: it is part
 * of a mod, arrives with it, and cannot exist without it.
 */
async function manageMod(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  id: string,
): Promise<boolean> {
  let changed = false;
  let cursor = 0;
  for (;;) {
    const m = deps.listCatalog().find((x) => x.id === id);
    if (!m) return changed;
    const trouble = deps.diskPackStatus?.();
    const myProblems = problemsFor(trouble?.problems ?? [], id);
    const mySkipped = problemsFor(trouble?.skipped ?? [], id);
    const items: MenuItem[] = [];
    const acts: string[] = [];
    /* A mod that is on and not installed has exactly one useful action, and
     * every other row on this screen would be about a manifest that is not
     * there. Offer the one thing, and say what it does. */
    if (m.missing) {
      const pick = await selectFromMenu(
        term,
        "core:mod-missing",
        m.name,
        [
          {
            label: t("modsScreen.missing.takeOff", "Take it off the list"),
            color: C_ENABLED,
            hint: t(
              "modsScreen.missing.takeOffHint",
              "The game stops trying to load it. Nothing else changes.",
            ),
          },
          {
            label: t("modsScreen.missing.leaveIt", "Leave it"),
            color: C_DIM,
            hint: t("modsScreen.missing.leaveItHint", "In case you mean to reinstall it."),
          },
        ],
        t("modsScreen.missing.footer", "[ Enter to choose; ESC to leave it ]"),
        {
          minListRows: 2,
          detail: () => rowDetail(m, term.size().cols, 99),
          detailToggleKey: "?",
          detailInitiallyShown: true,
        },
      );
      if (pick === 0) {
        deps.store.setModEnabled(m.id, false);
        return true;
      }
      return changed;
    }
    const ruleCount = m.manifest.rules?.length ?? 0;
    /* This mod holds the one autoplayer slot right now: its Mod options screen
     * carries the speed row even on the unusual mod that ships a controller but
     * declares no rule of its own. */
    const autoplayerActive = deps.autoplayer?.activeId() === m.id;
    const sectionCount = m.manifest.sections?.length ?? 0;
    const optionCount = ruleCount + sectionCount + (autoplayerActive ? 1 : 0);
    const showOptionsRow = optionCount > 0;
    const optionsLabel = t("modsScreen.manageMod.optionsLabel", "Mod options ({count})...", {
      count: optionCount,
    });
    const optionsHint = t(
      "modsScreen.manageMod.optionsHint",
      "Fixes and structural parts together, so every setting for this mod is in one place.",
    );
    if (m.session) {
      /* NO DISABLE ROW FOR A SESSION MOD, and this is the reason rather than an
       * omission: it is on because it was staged, not because a stored choice says
       * so, and writing that choice would record a decision about a mod the player
       * does not have while the row stayed on anyway. Dropping the archive is the
       * control that means something, and it is the only honest way to stop a
       * staged plugin's code from running on the next reload. */
      items.push({
        label: t("modsScreen.manageMod.dropIt", "Drop it (this is how you stop it)"),
        color: C_DANGER,
        hint: t("modsScreen.manageMod.dropItHint", "Forgets the archive. Takes effect on the next reload."),
      });
      acts.push("drop");
      if (showOptionsRow) {
        items.push({ label: optionsLabel, color: C_ENABLED, hint: optionsHint });
        acts.push("options");
      }
    } else if (m.enabled) {
      items.push({ label: t("modsScreen.manageMod.disable", "Disable"), color: C_WARN });
      acts.push("disable");
      if (showOptionsRow) {
        items.push({ label: optionsLabel, color: C_ENABLED, hint: optionsHint });
        acts.push("options");
      }
      items.push({ label: t("modsScreen.manageMod.moveEarlier", "Move earlier (loads first)"), color: C_FG });
      acts.push("up");
      items.push({
        label: t("modsScreen.manageMod.moveLater", "Move later (loads last, wins conflicts)"),
        color: C_FG,
      });
      acts.push("down");
    } else {
      items.push({ label: t("modsScreen.manageMod.enable", "Enable"), color: C_ENABLED });
      acts.push("enable");
      if (showOptionsRow) {
        // Deliberately present and deliberately dead: it is the clearest way to
        // show that this mod HAS settings and that they do not exist yet.
        items.push({
          label: t(
            "modsScreen.manageMod.optionsLabelDisabled",
            "Mod options ({count} once enabled)",
            { count: optionCount },
          ),
          color: C_DISABLED,
          disabled: true,
          hint: t(
            "modsScreen.manageMod.optionsHintDisabled",
            "Enable this mod first - its fixes and parts do not exist until then.",
          ),
        });
        acts.push("options");
      }
    }
    /* THE WAY TO READ A LONG BLURB.
     *
     * The pane below is capped so it can never squeeze this list (it did: a mod
     * with a thirty-line description left one action row on screen and no way to
     * scroll past it), and a cap means some descriptions are cut. This row is
     * where the rest of it lives, in the viewer that already scrolls. Offered
     * only when there IS a description, so it is never a row that opens nothing. */
    if (m.manifest.description) {
      items.push({
        label: t("modsScreen.manageMod.readFull", "Read the full description"),
        color: C_DIM,
        hint: t(
          "modsScreen.manageMod.readFullHint",
          "The whole thing, scrollable, with what it depends on.",
        ),
      });
      acts.push("read");
    }
    items.push({ label: t("modsScreen.common.back", "Back"), color: C_DIM });
    acts.push("back");

    const pick = await selectFromMenu(
      term,
      "core:mod-details",
      t("modsScreen.manageMod.title", "{name}  v{version}", { name: m.name, version: m.version }),
      items,
      t("modsScreen.manageMod.footer", "[ choose an action; ESC to go back ]"),
      {
        /* Every action row stays visible. This screen's list is short and fixed,
         * so there is no reason for the description to win any of it - and it is
         * the description that has somewhere else to be read in full. */
        minListRows: items.length,
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
        detail: () => rowDetail(m, term.size().cols, 99, myProblems, mySkipped),
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    const act = pick === null ? "back" : acts[pick];
    if (act === "back") return changed;
    if (act === "read") {
      await showTextScreen(
        term,
        t("modsScreen.manageMod.title", "{name}  v{version}", { name: m.name, version: m.version }),
        fullDescription(m, term.size().cols),
      );
      continue;
    }
    if (act === "enable") {
      if (await enableMod(term, deps, m)) changed = true;
    } else if (act === "disable") {
      deps.store.setModEnabled(m.id, false);
      changed = true;
    } else if (act === "drop") {
      if (await dropSession(term, deps, m)) changed = true;
    } else if (act === "options") {
      if (await manageModOptions(term, deps, [m], m.name)) changed = true;
    } else if (act === "up") {
      deps.store.moveEnabled(m.id, -1);
      changed = true;
    } else if (act === "down") {
      deps.store.moveEnabled(m.id, +1);
      changed = true;
    }
  }
}

/**
 * Drop a session-only mod: forget the archive, and say what that does and does not
 * undo.
 *
 * THE SECOND SENTENCE IS THE POINT. Dropping stops the pack composing and stops a
 * staged plugin's code running, from the next reload. It does not reach back into
 * a character the mod already touched, and it does not remove anything the code
 * wrote to storage or unsend anything it sent. A screen that said "dropped" and
 * stopped there would be describing a rollback, which this is not.
 */
async function dropSession(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  const pick = await selectFromMenu(
    term,
    "core:mod-session-drop",
    t("modsScreen.dropSession.confirm", "Drop {name}?", { name: m.name }),
    [
      {
        label: t("modsScreen.dropSession.yes", "Yes, forget it"),
        color: C_DANGER,
        hint: t(
          "modsScreen.dropSession.yesHint",
          "It stops loading from the next reload. Nothing it already did is undone.",
        ),
      },
      {
        label: t("modsScreen.dropSession.keep", "Keep it for now"),
        color: C_DIM,
        hint: t("modsScreen.common.noChange", "No change."),
      },
    ],
    t("modsScreen.dropSession.footer", "[ Enter to choose; ESC to keep it ]"),
  );
  if (pick !== 0) return false;
  dropSessionMods(globalThis, m.id);
  await showTextScreen(term, m.name, [
    { text: t("modsScreen.dropSession.dropped", "{name} is dropped.", { name: m.name }), color: C_FG },
    { text: "", color: C_FG },
    { text: t("modsScreen.dropSession.stops", "It stops loading on the next reload."), color: C_FG },
    {
      text: t(
        "modsScreen.dropSession.stands1",
        "What it did while it was loaded stands: a character it changed is",
      ),
      color: C_DIM,
    },
    {
      text: t("modsScreen.dropSession.stands2", "still changed, and anything it stored is still stored."),
      color: C_DIM,
    },
  ]);
  void deps;
  return true;
}

/**
 * Auto-sort: propose a load order, show what it could not honour, and apply it
 * only if the player says so.
 *
 * A PROPOSAL, NOT AN ACTION. The order is shown before anything is written,
 * because a sort the player cannot review is one they cannot trust - and this
 * one is allowed to move mods for reasons no row in the list explains (a group,
 * a compat claim, an author's hint). Their own placements are pinned and survive
 * it (ModStore.moveEnabled records a pin), so pressing this does not throw away
 * the nudging they already did.
 *
 * It CANNOT FAIL. Where suggestions contradict each other the weakest is dropped
 * and named here; only a hard dependency cycle is left unresolved, and that is
 * an impossible mod set rather than a disagreement.
 *
 * This revises the 2026-07-27 ruling that load-order SORTING belongs to
 * Vortex/MO2 (MOD_LIFECYCLE section 3). The division of labour otherwise stands:
 * this is one button over the mods already installed, not staging, collections,
 * profiles-per-install or bulk management.
 */
async function autoSortLoadOrder(term: GridSurface & GridPointerInput, deps: ModManagerDeps): Promise<boolean> {
  const current = deps.store.getEnabled();
  const byId = new Map(deps.listCatalog().map((m) => [m.id, m]));
  const manifests = current
    .map((id) => byId.get(id)?.manifest)
    .filter((m): m is PackManifest => m !== undefined);

  if (manifests.length < 2) {
    await showTextScreen(term, t("modsScreen.autoSort.title", "Auto-sort"), [
      {
        text: t(
          "modsScreen.autoSort.nothingToSort",
          "There is nothing to sort - enable at least two mods first.",
        ),
        color: C_DIM,
      },
    ]);
    return false;
  }

  const result = sortModOrder(manifests, { pins: deps.store.getPins(), current });
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;
  const unchanged = result.order.every((id, i) => current[i] === id);

  await showTextScreen(term, autoSortScreen(result, current, nameOf));
  if (unchanged) return false;

  const pick = await selectFromMenu(
    term,
    "core:mod-apply-order",
    t("modsScreen.autoSort.applyConfirm", "Apply this order?"),
    [
      { label: t("modsScreen.autoSort.applyIt", "Apply it"), color: C_ENABLED },
      { label: t("modsScreen.autoSort.leaveAlone", "Leave my order alone"), color: C_DIM },
    ],
    t("modsScreen.autoSort.applyFooter", "[ Enter to choose; ESC to leave it alone ]"),
  );
  if (pick !== 0) return false;
  deps.store.setEnabled(result.order);
  return true;
}

/**
 * The auto-sort proposal as a document: a RANKED LIST the player is being asked to
 * accept, plus what the sorter had to give up to produce it.
 *
 * THE ORDER IS THE SCREEN, and it was the part least reachable. A proposed load
 * order is the one listing in this manager a real mod-manager UI wants as rows it
 * can drag: the rank belongs in `values`, the mod belongs on `semantic.ref`, and
 * "this one moved" belongs beside them rather than inside a string that reads
 * `  3. Quality of Life   <- moved`. `rank`'s width is 5 because that is the field
 * the terminal writes - two columns of margin, two of number, and the point - which
 * is also why it does not clamp until a player has ten thousand mods enabled, where
 * the `padStart(2)` it replaces never clamped at all.
 *
 * THE MOVED FLAG IS A BOOLEAN ON `semantic.data`, NOT A NUMBER IN `values`, which is
 * the one place this disagrees with the brief it was built from. `ScreenValues` is
 * `Record<string, number>`, so a flag would have to go in as 0/1 - a boolean
 * pretending to be a quantity, in the field the HUD's proportion convention reads.
 * `semantic.data` takes booleans and is already where a presenter looks for what a
 * row IS, so the flag goes there and the visible marker stays a cell.
 *
 * THE DROPPED SUGGESTIONS ARE A TABLE NOW TOO, with `ScreenRow.detail`: the
 * author's reason is a cell, and the cycle that forced the drop - "A -> B -> A" -
 * is the row's paragraph rather than a second row at a deeper indent sharing the
 * first row's identity. The ids behind that cycle are on `semantic.data`, exactly
 * as the unresolvable table below already publishes them.
 */
export function autoSortScreen(
  result: SortResult,
  current: readonly string[],
  nameOf: (id: string) => string,
): ScreenView {
  const unchanged = result.order.every((id, i) => current[i] === id);
  const blocks: ScreenBlock[] = [
    {
      kind: "table",
      key: "order",
      tagged: false,
      caption: {
        text: unchanged
          ? t("modsScreen.autoSort.alreadyInOrder", "Already in order:")
          : t("modsScreen.autoSort.proposedOrder", "Proposed order:"),
        color: C_TITLE,
      },
      columns: [
        { key: "rank", width: 5, align: "right" },
        /* Unpadded: the names were never lined up under each other, and padding
         * them would move the "<- moved" markers into a column of their own. */
        { key: "name", pad: false },
        { key: "moved", gap: 3, pad: false },
      ],
      rows: result.order.map((id, i) => {
        const moved = current[i] !== id;
        return {
          id,
          semantic: { kind: "mod", ref: id, data: { moved } },
          color: moved ? C_WARN : C_FG,
          values: { rank: i + 1 },
          cells: {
            rank: { text: `${String(i + 1)}.` },
            name: { text: nameOf(id) },
            moved: { text: moved ? t("modsScreen.autoSort.movedMarker", "<- moved") : "" },
          },
        };
      }),
    },
    {
      kind: "lines",
      lines: [
        { text: "", color: C_DIM },
        { text: t("modsScreen.autoSort.laterWins", "Later mods win conflicts."), color: C_DIM },
      ],
    },
  ];

  if (result.dropped.length > 0) {
    blocks.push(
      {
        kind: "lines",
        lines: [
          { text: "", color: C_DIM },
          {
            text: t("modsScreen.autoSort.suggestionsDropped", "Suggestions it could not honour"),
            color: C_WARN,
          },
        ],
      },
      {
        kind: "table",
        key: "dropped",
        tagged: false,
        columns: [
          { key: "indent", width: 2 },
          /* gap:0 for the same reason the unresolvable table's `mods` column is:
           * the indent column already put two spaces in front, and a second gap
           * would put three. */
          { key: "reason", gap: 0, pad: false },
        ],
        rows: result.dropped.map((d, i) => ({
          id: `dropped:${String(i)}`,
          /* The ids a presenter would otherwise have to read out of "A -> B -> A" -
           * exactly as the unresolvable table already publishes them. */
          semantic: { kind: "mod-cycle-dropped", data: { ids: d.cycle.join(",") } },
          color: C_FG,
          /* The REASON, not just the pair: an author wrote it, and it is the only
           * thing that tells the player whether the drop matters to them. */
          cells: { reason: { text: d.reason } },
          detail: {
            indent: 4,
            paragraphs: [
              [
                {
                  text: t(
                    "modsScreen.autoSort.droppedReason",
                    "dropped - it would need {chain} -> {first}",
                    {
                      chain: d.cycle.map(nameOf).join(" -> "),
                      first: nameOf(d.cycle[0] ?? ""),
                    },
                  ),
                },
              ],
            ],
            color: C_DIM,
          },
        })),
      },
    );
  }

  if (result.unresolvable.length > 0) {
    blocks.push(
      { kind: "lines", lines: [{ text: "", color: C_DIM }] },
      {
        kind: "table",
        key: "unresolvable",
        tagged: false,
        caption: {
          text: t("modsScreen.autoSort.cannotAllLoad", "These mods cannot all load"),
          color: C_DANGER,
        },
        columns: [
          { key: "indent", width: 2 },
          { key: "mods", gap: 0, pad: false },
          /* The verdict is the same sentence on every row, and it is a cell rather
           * than the tail of the names so that the NAMES are addressable on their
           * own - a presenter listing an impossible set wants the mods, not a
           * sentence it has to cut in half to get at them. */
          { key: "note", pad: false },
        ],
        rows: result.unresolvable.map((cycle, i) => ({
          id: `cycle:${String(i)}`,
          semantic: { kind: "mod-cycle", data: { ids: cycle.join(",") } },
          color: C_FG,
          cells: {
            mods: { text: cycle.map(nameOf).join(" and ") },
            note: { text: t("modsScreen.autoSort.eachRequireOther", "each require the other.") },
          },
        })),
      },
      {
        kind: "lines",
        lines: [
          {
            text: t(
              "modsScreen.autoSort.turnOneOff",
              "  Turn one of them off; no order can satisfy both.",
            ),
            color: C_DIM,
          },
        ],
      },
    );
  }

  return freezeView({
    id: "core:mod-auto-sort",
    title: t("modsScreen.autoSort.title", "Auto-sort"),
    footer: SCREEN_FOOTER,
    blocks,
  });
}

/**
 * One settings screen for one mod or for every enabled mod.
 *
 * Rules and sections remain different kinds of control: rules alter behaviour,
 * while sections can add records and have their own load order. They deliberately
 * share this screen because a player looking for a mod's settings should not need
 * to remember which implementation detail put a control behind which old menu.
 * Prefixing every row with Fix or Part keeps that distinction visible, and the
 * all-mods view also prefixes the owning mod so its flat list remains legible.
 *
 * Returns true only for section changes, which still need a reload. Rule choices
 * are applied live by the existing hook path and do not make the manager dirty.
 */
async function manageModOptions(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  wanted: readonly CatalogMod[],
  label: string,
): Promise<boolean> {
  const title = t("modsScreen.options.title", "Mod options - {name}", { name: label });
  const candidateIds = new Set(wanted.map((m) => m.id));
  let changed = false;
  let cursor = 0;

  for (;;) {
    const catalog = deps.listCatalog();
    const selected = catalog.filter((m) => candidateIds.has(m.id) && !m.missing);
    const enabled = selected.filter((m) => m.enabled);
    if (enabled.length === 0) {
      const only = selected[0];
      const rules = only?.manifest.rules?.length ?? 0;
      const sections = only?.manifest.sections?.length ?? 0;
      await selectFromMenu(
        term,
        "core:mod-options-disabled",
        title,
        [
          ...(rules > 0
            ? [
                {
                  label: t("modsScreen.options.fixesDisabled", "Fixes & tweaks ({count} once enabled)", {
                    count: rules,
                  }),
                  color: C_DISABLED,
                  disabled: true,
                },
              ]
            : []),
          ...(sections > 0
            ? [
                {
                  label: t("modsScreen.options.partsDisabled", "Parts of this mod ({count} once enabled)", {
                    count: sections,
                  }),
                  color: C_DISABLED,
                  disabled: true,
                },
              ]
            : []),
          { label: t("modsScreen.common.back", "Back"), color: C_DIM },
        ],
        t("modsScreen.options.disabledFooter", "[ Enable this mod first; ESC to go back ]"),
      );
      return changed;
    }

    const enabledManifests = catalog.filter((m) => m.enabled).map((m) => m.manifest);
    deps.store.migrateSectionChoices(enabledManifests);
    const sectionState = resolveSectionState(
      enabledManifests,
      deps.store.getSectionChoices(),
      new Set(enabledManifests.map((m) => m.id)),
    );
    const forcedOff = new Map<string, string>();
    for (const m of enabled) {
      for (const c of m.manifest.compat ?? []) {
        if (c.claim !== "patches" || enabledManifests.some((other) => other.id === c.with)) continue;
        for (const sectionId of c.scope ?? []) forcedOff.set(`${m.id}:${sectionId}`, c.with);
      }
    }

    /* Space and Enter both resolve through the same selectFromMenu pick() (see
     * overlay.ts), so a row with a checkbox has no way today to tell "toggle"
     * from "open a submenu" apart by KEY - only by what its own `kind` does with
     * the returned index below. That is fine as long as no row is BOTH a
     * checkbox AND a submenu at once (neo-angband#162): "rule"/"section" toggle
     * in place, "speed" opens pickAutoplayerSpeed, and neither kind does both.
     * The day a row needs to, Enter must open the submenu and Space alone must
     * toggle - which needs the picker to say which key resolved it, not just
     * which row. */
    type Option =
      | { readonly kind: "rule"; readonly mod: CatalogMod; readonly decl: ModRuleDecl }
      | {
          readonly kind: "section";
          readonly mod: CatalogMod;
          readonly section: NonNullable<PackManifest["sections"]>[number];
          readonly on: boolean;
          readonly needs: string | null;
        }
      | { readonly kind: "speed"; readonly mod: CatalogMod; readonly autoplayer: NonNullable<ModManagerDeps["autoplayer"]> };
    const options: Option[] = [];
    const decls = (deps.ruleDecls ?? ((): ModRuleDecl[] => []))();
    for (const m of enabled) {
      for (const decl of decls.filter((d) => d.modId === m.id)) {
        options.push({ kind: "rule", mod: m, decl });
      }
    }
    for (const m of enabled) {
      for (const section of m.manifest.sections ?? []) {
        const needs = forcedOff.get(`${m.id}:${section.id}`) ?? null;
        options.push({
          kind: "section",
          mod: m,
          section,
          on: sectionState.get(m.id)?.get(section.id) ?? true,
          needs,
        });
      }
    }
    const autoplayer = deps.autoplayer;
    if (autoplayer) {
      const active = enabled.find((m) => autoplayer.activeId() === m.id);
      if (active) options.push({ kind: "speed", mod: active, autoplayer });
    }

    if (options.length === 0) {
      await showTextScreen(term, title, [
        {
          text: t("modsScreen.options.none", "These mods are enabled, but have no configurable fixes or parts."),
          color: C_DIM,
        },
      ]);
      return changed;
    }

    const ruleChoices = deps.store.getRuleChoices();
    const many = enabled.length > 1;
    /* No "Fix:"/"Part:"/"Control:" kind label - it named an internal
     * distinction (rule vs. section vs. speed control) that meant nothing to a
     * player reading the row. The detail panel below (modOptionDetail) already
     * explains that distinction in a full sentence when it matters; the row
     * itself only needs to say which mod, and only when more than one is
     * shown at once. */
    const prefix = (m: CatalogMod): string => (many ? `${m.name} - ` : "");
    const items: MenuItem[] = options.map((option) => {
      if (option.kind === "rule") {
        const on = ruleChoices[option.decl.rule.flag] ?? option.decl.rule.default;
        return {
          label: `${prefix(option.mod)}${on ? "[x]" : "[ ]"} ${option.decl.rule.title}`,
          color: on ? C_ENABLED : C_DISABLED,
        };
      }
      if (option.kind === "section") {
        const needs = option.needs === null ? "" : `   (${t("modsScreen.options.needs", "needs {name}", { name: option.needs })})`;
        return {
          label: `${prefix(option.mod)}${option.on ? "[x]" : "[ ]"} ${option.section.title}${needs}`,
          color: option.needs === null ? (option.on ? C_ENABLED : C_DISABLED) : C_DISABLED,
          ...(option.needs === null ? {} : { disabled: true }),
        };
      }
      return {
        label: `${prefix(option.mod)}Autoplayer speed: ${autoplayerSpeedLabel(option.autoplayer.getSpeed())}`,
        color: C_FG,
      };
    });

    const pick = await selectFromMenu(
      term,
      "core:mod-options",
      title,
      items,
      t("modsScreen.options.footer", "[ Space or Enter changes a setting; ESC to go back ]"),
      {
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
        commands: { " ": (cur) => (options[cur]?.kind === "section" && options[cur]?.needs !== null ? null : cur) },
        detail: (i) => modOptionDetail(options[i], ruleChoices, term.size().cols),
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    if (pick === null) return changed;
    const option = options[pick];
    if (!option) continue;
    if (option.kind === "rule") {
      const on = ruleChoices[option.decl.rule.flag] ?? option.decl.rule.default;
      deps.store.setRuleChoice(option.decl.rule.flag, !on);
      deps.applyRuleLive?.(option.decl.rule.flag, !on);
    } else if (option.kind === "section") {
      if (option.needs !== null) continue;
      deps.store.setSectionChoice(option.mod.id, option.section.id, !option.on);
      changed = true;
    } else {
      await pickAutoplayerSpeed(term, option.autoplayer, option.mod);
    }
  }
}

function modOptionDetail(
  option:
    | {
        readonly kind: "rule";
        readonly mod: CatalogMod;
        readonly decl: ModRuleDecl;
      }
    | {
        readonly kind: "section";
        readonly mod: CatalogMod;
        readonly section: NonNullable<PackManifest["sections"]>[number];
        readonly on: boolean;
        readonly needs: string | null;
      }
    | {
        readonly kind: "speed";
        readonly mod: CatalogMod;
        readonly autoplayer: NonNullable<ModManagerDeps["autoplayer"]>;
      }
    | undefined,
  ruleChoices: Readonly<Record<string, boolean>>,
  cols: number,
): readonly ScreenLine[] {
  if (!option) return [];
  if (option.kind === "rule") {
    const on = ruleChoices[option.decl.rule.flag] ?? option.decl.rule.default;
    return [
      { text: option.decl.rule.title, color: C_TITLE },
      { text: `${on ? t("modsScreen.common.on", "ON") : t("modsScreen.common.off", "OFF")}  -  ${option.mod.name}`, color: on ? C_ENABLED : C_DIM },
      { text: "", color: C_FG },
      ...wrapped(option.decl.rule.description, cols - 1),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          "modsScreen.options.ruleNote",
          "This is a behavioural fix or tweak. It takes effect at once while this mod is enabled.",
        ),
        cols - 1,
        C_DIM,
      ),
    ];
  }
  if (option.kind === "section") {
    const lines: ScreenLine[] = [
      { text: option.section.title, color: C_TITLE },
      { text: `${option.on ? t("modsScreen.common.on", "ON") : t("modsScreen.common.off", "OFF")}  -  ${option.mod.name}`, color: option.on ? C_ENABLED : C_DIM },
      { text: "", color: C_FG },
      ...wrapped(option.section.description ?? "", cols - 1),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          "modsScreen.options.sectionNote",
          "This is a structural part of the mod. Changing it takes effect after a reload.",
        ),
        cols - 1,
        C_DIM,
      ),
    ];
    if (option.needs !== null) {
      lines.push(
        { text: "", color: C_FG },
        ...wrapped(
          t("modsScreen.options.sectionNeeds", "It is a compatibility patch for {name}, which is not enabled.", {
            name: option.needs,
          }),
          cols - 1,
          C_DIM,
        ),
      );
    }
    return lines;
  }
  return [
    { text: t("modsScreen.patches.autoplayerHeading", "Autoplayer speed"), color: C_TITLE },
    {
      text: t(
        "modsScreen.patches.autoplayerDetail",
        "{speed} - how often {name} takes a turn while it holds the keyboard",
        { speed: autoplayerSpeedLabel(option.autoplayer.getSpeed()), name: option.mod.name },
      ),
      color: C_DIM,
    },
  ];
}

/**
 * The options-menu route into the same per-mod settings screen used by the
 * manager. The first row pools enabled mods only, because an off mod has no live
 * rules or active sections; individual rows stay present so the player can see
 * which mod they need to enable before its settings become available.
 */
export async function runModOptionsBrowser(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
): Promise<void> {
  let needsReload = false;
  let cursor = 0;
  for (;;) {
    const catalog = deps.listCatalog().filter((m) => !m.missing);
    const enabled = catalog.filter((m) => m.enabled);
    const items: MenuItem[] = [
      {
        label: t("modsScreen.options.allMods", "All mods"),
        color: enabled.length > 0 ? C_ENABLED : C_DISABLED,
        disabled: enabled.length === 0,
        hint:
          enabled.length > 0
            ? t("modsScreen.options.allModsHint", "Every enabled mod's fixes and parts in one flat list.")
            : t("modsScreen.options.allModsDisabledHint", "Enable a mod first to configure its options."),
      },
      ...catalog.map((m) => ({
        label: m.name,
        color: m.enabled ? C_FG : C_DISABLED,
        hint: m.enabled
          ? t("modsScreen.options.modHint", "Open this mod's fixes and parts together.")
          : t("modsScreen.options.modDisabledHint", "Open to see what becomes available when enabled."),
      })),
    ];
    const pick = await selectFromMenu(
      term,
      "core:mod-options-browser",
      t("modsScreen.options.browserTitle", "Mod options"),
      items,
      t("modsScreen.options.browserFooter", "[ Choose a mod, ESC to return ]"),
      {
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
      },
    );
    if (pick === null) break;
    if (pick === 0) {
      if (await manageModOptions(term, deps, enabled, t("modsScreen.options.allMods", "All mods"))) {
        needsReload = true;
      }
      continue;
    }
    const mod = catalog[pick - 1];
    if (mod && (await manageModOptions(term, deps, [mod], mod.name))) needsReload = true;
  }
  if (!needsReload) return;
  const pick = await selectFromMenu(
    term,
    "core:mod-options-apply",
    t("modsScreen.applyPrompt.title", "Apply mod changes?"),
    [
      { label: t("modsScreen.applyPrompt.reload", "Reload now to apply"), color: C_ENABLED },
      {
        label: t("modsScreen.applyPrompt.later", "Later (changes are saved; apply on next reload)"),
        color: C_FG,
      },
    ],
    t("modsScreen.applyPrompt.footer", "[ a/b or tap ]"),
  );
  if (pick === 0) deps.requestReload();
}

/**
 * The conflicts viewer, over every composition layer.
 *
 * THREE GROUPS, because they need three different amounts of attention and a
 * flat list taught the player that none of them did:
 *
 *  - what an AUTHOR DECLARED. A human wrote a reason; it is the only group that
 *    might mean "do not run these together", and it still never blocks.
 *  - what is CONTESTED: somebody's contribution is being discarded. This is the
 *    group with a decision in it.
 *  - what COMBINES: several mods touching one thing and all of them taking
 *    effect. Listed so the picture is complete, kept last so it does not bury
 *    the group above.
 */
async function viewConflicts(term: GridSurface & GridPointerInput, deps: ModManagerDeps): Promise<void> {
  await showTextScreen(term, modConflictsScreen(deps.conflictLines()));
}

/**
 * The conflicts viewer as a document: three groups, each a TABLE of records.
 *
 * WHAT CHANGED, AND WHERE. This screen was `lines` because its producer destroyed
 * the structure one module earlier - `conflictLines` mapped every `ContestedSlot`
 * through `describeContested` and handed over three `string[]`, so the slot, its
 * fold, the winner and the mods that lost were gone before any screen saw them. They
 * now travel beside the sentences (`ConflictRow`), and a group of one-row-per-record
 * is exactly what a table is for.
 *
 * ONE VISIBLE COLUMN, AND THAT IS NOT A COSTUME. The sentence stays whole in `what`
 * because it is the rendering that shipped and it must not move; everything a
 * presenter would act on - which layer, which fold, who won, who lost - rides on
 * `semantic.data` beside it, exactly as the update report carries `ModRefresh`. The
 * sentence is DERIVED from `describeContested` rather than re-worded here: six folds'
 * wording lives in the SDK and a second copy would rot.
 *
 * THE PROSE BETWEEN THE GROUPS STAYS `lines`, by the rule rather than for
 * convenience. Those are hand-broken constants the screen has already laid out, and
 * the blank rows between groups carry a colour that `gapAfter` does not emit.
 *
 * THE CONTENT LAYER NOW CARRIES ITS OWN RECORD. `modConflictLines` (pack.ts) used
 * to flatten `computeConflictReport`'s field-granular records into plain sentences
 * before this module ever ran, so every content row arrived here as `{ kind:
 * "content-record" }` with NO `ref` - the stopgap that told a presenter "the fields
 * were not published" apart from "this row has nothing to say". That producer now
 * carries the RecordConflict beside the sentence the same way every other layer
 * does, so a content row is `record-conflict` like any other and the stopgap kind
 * is retired.
 *
 * A ROW CAN STILL ARRIVE WITH NO RECORD AT ALL, and is still marked rather than
 * left with an absent `semantic`: `modConflictLines` returns one when
 * resolveLoadOrder throws before a single RecordConflict could be gathered (a
 * duplicate pack id, a missing dependency, an incompatible version range). There
 * is genuinely nothing to attach there, which `{ kind: "unresolved-load-order" }`
 * says plainly rather than reusing the retired content-record kind for a different
 * reason.
 */
export function modConflictsScreen(report: ConflictReportLines): ScreenView {
  const { declaredRows, contestedRows, combinedRows } = report;
  const blocks: ScreenBlock[] = [];

  /* One unpadded column: `pad: false` and no declared `width`, so a row renders as
   * exactly the sentence it always was. A width would line the sentences up under
   * each other, which is a change to the player's screen and not this pass's to
   * make. */
  const oneColumn = [{ key: "what", pad: false }] as const;

  if (declaredRows.length > 0) {
    blocks.push(
      {
        kind: "table",
        key: "declared",
        tagged: false,
        caption: {
          text: t("modsScreen.conflictsScreen.declaredCaption", "The authors said so themselves"),
          color: C_WARN,
        },
        columns: [...oneColumn],
        rows: declaredRows.map(({ text, record }) => ({
          id: `${record.packId}->${record.with}`,
          /* The CLAIMANT is what a presenter acts on: it is the mod whose author
           * wrote this, and the one whose page a "tell me more" would open. */
          semantic: {
            kind: "mod-conflict",
            ref: record.packId,
            data: {
              with: record.with,
              because: record.because,
              scope: record.scope?.join(",") ?? null,
            },
          },
          color: C_FG,
          cells: { what: { text } },
        })),
      },
      {
        kind: "lines",
        lines: [
          { text: "", color: C_DIM },
          {
            text: t(
              "modsScreen.conflictsScreen.nothingBlocked",
              "Nothing here is blocked - you can play any combination you like.",
            ),
            color: C_DIM,
          },
          { text: "", color: C_DIM },
        ],
      },
    );
  }

  if (contestedRows.length > 0) {
    blocks.push(
      {
        kind: "table",
        key: "contested",
        tagged: false,
        caption: {
          text: t("modsScreen.conflictsScreen.contestedCaption", "One of these wins, the rest are ignored"),
          color: C_WARN,
        },
        columns: [...oneColumn],
        rows: contestedRows.map(({ text, record }) => slotRow(text, record, C_FG)),
      },
      { kind: "lines", lines: [{ text: "", color: C_DIM }] },
    );
  }

  if (combinedRows.length > 0) {
    blocks.push(
      {
        kind: "table",
        key: "combined",
        tagged: false,
        caption: {
          text: t("modsScreen.conflictsScreen.combinedCaption", "These stack, and need nothing from you"),
          color: C_ENABLED,
        },
        columns: [...oneColumn],
        rows: combinedRows.map(({ text, record }) => slotRow(text, record, C_DIM)),
      },
      { kind: "lines", lines: [{ text: "", color: C_DIM }] },
    );
  }

  if (blocks.length === 0) {
    blocks.push({
      kind: "lines",
      lines: [
        {
          text: t(
            "modsScreen.conflictsScreen.nothingContests",
            "Nothing among your enabled mods contests anything else.",
          ),
          color: C_ENABLED,
        },
      ],
    });
  }

  return freezeView({
    id: "core:mod-conflicts",
    title: t("modsScreen.conflictsScreen.title", "Mod conflicts"),
    footer: SCREEN_FOOTER,
    blocks,
  });
}

/**
 * One contested or combining row.
 *
 * `losers` is published as well as `claims` because it is the question the screen
 * exists to answer - "whose work is being thrown away" - and deriving it from
 * `claims` minus `winner` is a rule about the fold that a presenter should not have
 * to know. Empty for a combining fold, where nobody loses.
 *
 * THREE SHAPES OF `record` NOW, not two: a `ContestedSlot` for the four layers
 * `layerSlots` derives, a `RecordConflict` for the content layer's own rows
 * (pack.ts's modConflictLines), and `null` for the one row that producer still
 * cannot attach anything to. Discriminated on a field unique to each - `file` is
 * on every `RecordConflict` and no `ContestedSlot` - rather than by which array the
 * row came from, so this stays correct regardless of how the caller assembled
 * `contestedRows`/`combinedRows`.
 */
function slotRow(
  text: string,
  record: ContestedSlot | RecordConflict | null,
  color: string,
): ScreenRow {
  const cells = { what: { text } };
  if (record === null) {
    /* modConflictLines could not even attempt composition: resolveLoadOrder threw
     * (a duplicate pack id, a missing dependency, an incompatible version range)
     * before a single RecordConflict existed to gather. Marked rather than left
     * with no semantic at all, so a presenter can tell "the game could not compose
     * this set" from "this row has nothing to say". */
    return { semantic: { kind: "unresolved-load-order" }, color, cells };
  }
  if ("file" in record) {
    return {
      id: record.ref,
      semantic: {
        kind: "record-conflict",
        ref: record.ref,
        data: {
          file: record.file,
          contributingPacks: record.contributingPacks.join(","),
          /* Only the fields that actually COLLIDED - two packs writing the same
           * field with an order-dependent op - not every field any contributor
           * merely touched, which would bury the one question this row answers
           * under every additive field a mod added alongside it. */
          collidingFields: record.collisions.map((c) => c.path).join(","),
          overriddenBy: record.override?.pack ?? null,
          overrideKind: record.override?.kind ?? null,
        },
      },
      color,
      cells,
    };
  }
  const claims = record.claims.map((c) => c.packId);
  return {
    id: record.key,
    semantic: {
      kind: "contested-slot",
      ref: record.key,
      data: {
        layer: record.layer,
        fold: record.fold,
        what: record.what,
        winner: record.winner ?? null,
        claims: claims.join(","),
        /* Empty when the fold picks nobody. Filtering `claims` against an undefined
         * winner would keep every one of them and report a combining slot - where
         * every contribution runs - as a slot where everybody lost. */
        losers:
          record.winner === undefined
            ? ""
            : claims.filter((id) => id !== record.winner).join(","),
      },
    },
    color,
    cells,
  };
}

/**
 * Display name for each autoplayer speed tier (mod-store.ts).
 *
 * A FUNCTION, not a constant: see gameMenuFooter's comment in game-menu.ts - a
 * locale can change mid-session, so nothing translatable may be frozen at
 * import time.
 */
function autoplayerSpeedLabel(speed: AutoplayerSpeed): string {
  switch (speed) {
    case "turbo":
      return t("modsScreen.autoplayer.speed.turbo", "Turbo");
    case "fast":
      return t("modsScreen.autoplayer.speed.fast", "Fast");
    case "normal":
      return t("modsScreen.autoplayer.speed.normal", "Normal");
    case "slow":
      return t("modsScreen.autoplayer.speed.slow", "Slow");
  }
}
/** Pump rate for each autoplayer speed tier (mod-store.ts). Not player-facing text. */
const AUTOPLAYER_SPEED_MS: Record<AutoplayerSpeed, number> = {
  turbo: 10,
  fast: 40,
  normal: 120,
  slow: 400,
};

/**
 * The autoplayer speed sub-screen: three tiers, current one marked, same shape
 * as every other named-choice picker on this screen. Reached from the row
 * manageModOptions shows beside a mod's own rule that hands back a controller,
 * only while that mod actually holds the one autoplayer slot.
 */
async function pickAutoplayerSpeed(
  term: GridSurface & GridPointerInput,
  autoplayer: NonNullable<ModManagerDeps["autoplayer"]>,
  m: CatalogMod,
): Promise<void> {
  const tiers: AutoplayerSpeed[] = ["turbo", "fast", "normal", "slow"];
  const current = autoplayer.getSpeed();
  const items: MenuItem[] = tiers.map((tier) => ({
    label: `${tier === current ? "[x]" : "[ ]"} ${autoplayerSpeedLabel(tier)}`,
    color: tier === current ? C_ENABLED : C_FG,
  }));
  const pick = await selectFromMenu(
    term,
    "core:mod-autoplayer-speed",
    t("modsScreen.autoplayer.title", "Autoplayer speed - {name}", { name: m.name }),
    items,
    t("modsScreen.autoplayer.footer", "[ Enter to choose; ESC to leave it as it is ]"),
    {
      initialCursor: tiers.indexOf(current),
      detail: (i) => {
        const tier = tiers[i];
        if (!tier) return [];
        return [
          { text: autoplayerSpeedLabel(tier), color: C_TITLE },
          {
            text: t(
              "modsScreen.autoplayer.turnRate",
              "A turn every {ms}ms while {name} holds the keyboard.",
              { ms: AUTOPLAYER_SPEED_MS[tier], name: m.name },
            ),
            color: C_DIM,
          },
          { text: "", color: C_FG },
          {
            text: t(
              "modsScreen.autoplayer.urlNote",
              "The same three tiers the debug agent seam's ?speed= URL parameter offers - takes effect at once, no reload.",
            ),
            color: C_DIM,
          },
        ];
      },
      detailToggleKey: "?",
      detailInitiallyShown: true,
    },
  );
  if (pick === null) return;
  const chosen = tiers[pick];
  if (chosen) autoplayer.setSpeed(chosen);
}

/**
 * Where mods come from, and how to add one.
 *
 * On a front end WITH a mods directory this is the real answer: the path, what
 * is in it, and what could not be read. On one without, it says so - which is
 * the same honesty the old "Install from URL" row had, arrived at from the other
 * side now that the directory actually works.
 *
 * Neither surface has a runtime code loader, so neither can fetch and RUN a mod
 * from a URL. A folder you copied in is a different thing: its records are data,
 * composed at load time by the same pipeline the bundled mods use.
 */
async function showModSources(
  term: GridSurface & GridPointerInput,
  status: DiskPackStatus | undefined,
  canPick: boolean,
): Promise<void> {
  const lines: ScreenLine[] = [];
  if (!status || !status.available) {
    if (canPick) {
      /* An engine that CAN be given a folder has not been given one yet. Saying
       * "this build has no mods folder" here would be a false statement about the
       * program, which is the exact failure mode PLATFORM.md was written about. */
      lines.push(
        { text: t("modsScreen.sources.notChosen.title", "No mods folder chosen yet."), color: C_FG },
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.sources.notChosen.body1",
            "This build can read one: choose a folder on your computer and it",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modsScreen.sources.notChosen.body2",
            "is remembered for every later visit. The mods in it are read the",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modsScreen.sources.notChosen.body3",
            "same way the desktop build reads its own folder, by the same",
          ),
          color: C_FG,
        },
        {
          text: t("modsScreen.sources.notChosen.body4", "validator, so a mod behaves identically on both."),
          color: C_FG,
        },
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.sources.notChosen.pick",
            "Pick either a folder of mods, or a single mod's folder.",
          ),
          color: C_GOLD_TEXT,
        },
      );
    } else {
      lines.push(...noFolderPickerLines());
    }
  } else if (status.kind === "installed") {
    /* Mods installed from their own repositories and NO folder at all. There is no
     * directory to name - nobody put these anywhere - so saying "Mods folder:
     * (unknown)" would be a sentence about a folder that does not exist. */
    lines.push(
      {
        text: t("modsScreen.sources.installed.title", "Mods installed from their own repositories."),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: modSourceLine(
          status.bundledCount,
          status.count,
          t("modsScreen.folder.source.installed", "installed"),
        ),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: t(
          "modsScreen.sources.installed.body1",
          "An installed mod's files are kept in this browser's storage, not in",
        ),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.installed.body2",
          "a folder, so there is no path to show. Each was checked against a",
        ),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.installed.body3",
          "digest before a byte of it was unpacked, and the mod manager names",
        ),
        color: C_FG,
      },
      {
        text: t("modsScreen.sources.installed.body4", "the repository and tag it came from."),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: t(
          "modsScreen.sources.installed.alsoFolder",
          "You can also give this browser a mods FOLDER, and use both.",
        ),
        color: C_DIM,
      },
    );
  } else {
    lines.push(
      {
        text:
          status.kind === "picked"
            ? t("modsScreen.sources.folder.headingPicked", "Mods folder you chose:")
            : t("modsScreen.sources.folder.heading", "Mods folder:"),
        color: C_FG,
      },
      { text: `  ${status.dir ?? t("modsScreen.sources.folder.unknown", "(unknown)")}`, color: C_GOLD_TEXT },
      { text: "", color: C_FG },
      /* The folder count is always given, even at zero: "0 mods found in it." is TRUE
       * and reads as "this game has no mods" while others are listed one screen away.
       * A player with an empty folder needs to see that the FOLDER is the empty part. */
      {
        text: modSourceLine(
          status.bundledCount,
          status.count,
          t("modsScreen.folder.source.fromFolder", "from this folder"),
        ),
        color: C_FG,
      },
      ...(status.count === 0
        ? [
            {
              text: t("modsScreen.sources.folder.empty", "Nothing has been copied into it yet."),
              color: C_DIM,
            },
          ]
        : []),
      { text: "", color: C_FG },
      {
        text: t("modsScreen.sources.folder.addBody1", "To add one, copy its folder in and restart. A mod folder holds"),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.folder.addBody2",
          "manifest.json plus one .json per kind of record it changes -",
        ),
        color: C_FG,
      },
      { text: t("modsScreen.sources.folder.addBody3", "exactly the layout a bundled mod has."), color: C_FG },
      { text: "", color: C_FG },
      {
        text: t("modsScreen.sources.folder.loadOrderBody1", "load-order.json in that folder is owned by an external mod"),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.folder.loadOrderBody2",
          "manager: the ids it lists are loaded, in that order. Turning a",
        ),
        color: C_FG,
      },
      {
        text: t("modsScreen.sources.folder.loadOrderBody3", "mod on or off here overrides it for that mod."),
        color: C_FG,
      },
    );
    if (status.kind === "picked") {
      lines.push(
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.sources.folder.pickedPrivacy1",
            "Your browser is not told where that folder is on disk, only its",
          ),
          color: C_DIM,
        },
        {
          text: t("modsScreen.sources.folder.pickedPrivacy2", "name, so only the name can be shown here."),
          color: C_DIM,
        },
      );
    }
    /* Mods can arrive from more than one source at once - a folder AND repositories
     * the player installed from - and the block above describes only the first. Every
     * other source gets its own line, because "2 from this folder" was otherwise a
     * true sentence that read as the whole answer while other mods loaded unmentioned. */
    for (const origin of status.origins.slice(1)) {
      lines.push(
        { text: "", color: C_FG },
        {
          text:
            origin.kind === "installed"
              ? t(
                  "modsScreen.sources.extraOrigin.installed",
                  "{count} installed from {count, plural, one {its own repository} other {their own repositories}}.",
                  { count: origin.count },
                )
              : t("modsScreen.sources.extraOrigin.folder", "{count} from {dir}.", {
                  count: origin.count,
                  dir: origin.dir ?? t("modsScreen.sources.extraOrigin.anotherSource", "another source"),
                }),
          color: C_FG,
        },
        ...(origin.kind === "installed"
          ? [
              {
                /* Where they physically are, honestly: nobody put them anywhere. */
                text: t(
                  "modsScreen.sources.extraOrigin.storageBody1",
                  "  Kept in this browser's storage, not in a folder - the mod",
                ),
                color: C_DIM,
              },
              {
                text: t(
                  "modsScreen.sources.extraOrigin.storageBody2",
                  "  manager names the repository and tag each came from.",
                ),
                color: C_DIM,
              },
            ]
          : []),
      );
    }
  }
  /* HOISTED OUT OF THE BRANCHES (2026-07-31). Two of the three said this and the
   * first did not, so a problem collected while no folder was attached - a bundled
   * plugin that failed validation, a hooks() that threw - was computed, carried all
   * the way here, and then fell down the one branch that never printed it. */
  lines.push(...problemBlock(status?.problems ?? []));
  /* LEFT AT `lines`, DELIBERATELY, and the two lists here are why rather than an
   * oversight.
   *
   * The extra-origin loop is one to THREE rows per origin - the count sentence, and
   * two more only when the mods came from browser storage rather than a folder - so
   * an origin is not a table row.
   *
   * `problemBlock` is a genuine one-line-per-record list and is the one thing on
   * this screen that wants to be a table. It cannot become one without a lie: an
   * attributed problem renders `  id: why` and an unattributed one renders `  why`,
   * and no fixed column can produce both, because the separator is conditional. The
   * only byte-identical table puts `"id: "` - colon, trailing space and all - inside
   * the id cell, which is the rendering back in the data. It stays `lines` until the
   * separator can be a fact about the column instead of a fact about the row. */
  await showTextScreen(term, t("modsScreen.sources.title", "Where mods come from"), lines);
}

/**
 * The "could not be used" block, or nothing.
 *
 * Exported and pure because the CAP is the interesting part. This used to
 * `slice(0, 8)` and print nothing about the rest, so nine problems looked like
 * eight - a truncation that reads as completeness is worse than a long list, and it
 * hid exactly the case where a lot has gone wrong. The cap stays and now says what
 * it dropped.
 *
 * WHY THE CAP IS KEPT IS NOT WHY IT WAS WRITTEN. This said "a text screen has one
 * page and no scroll", and that is simply not true: `showViewOnTerminal` (overlay.ts)
 * scrolls with the arrows, the numpad, PageUp/PageDown and Home/End, and prints its
 * own `(1-23/57)` position footer. What the cap is actually worth is the sentence
 * under it - a hundred problems on one page buries the mod list's own per-mod
 * reasons, which are the ones a player can act on. Lifting it is a change to what
 * this screen SHOWS and belongs to whoever wants that, not to a modelling pass.
 */
export function problemBlock(problems: readonly ModProblem[]): ScreenLine[] {
  if (problems.length === 0) return [];
  const CAP = 8;
  const out: ScreenLine[] = [
    { text: "", color: C_FG },
    { text: t("modsScreen.problemBlock.heading", "Could not be used:"), color: C_DANGER },
  ];
  for (const p of problems.slice(0, CAP)) {
    out.push({ text: `  ${p.id === null ? p.why : `${p.id}: ${p.why}`}`, color: C_DANGER });
  }
  if (problems.length > CAP) {
    const rest = problems.length - CAP;
    out.push({
      text: t(
        "modsScreen.problemBlock.more",
        "  ...and {rest} more (each mod's own are on its row in the Mods list)",
        { rest },
      ),
      color: C_DANGER,
    });
  }
  return out;
}

/**
 * Choose, reconnect, or forget the mods folder.
 *
 * Returns whether anything changed, so the caller can offer the reload that makes
 * it take effect. Every branch is reported: a cancelled picker and a refused
 * permission look identical from here otherwise, and silence after a folder failed
 * to attach is how a player concludes the feature is broken.
 */
async function manageModFolder(
  term: GridSurface & GridPointerInput,
  picker: ModFolderPicker,
  status: DiskPackStatus | undefined,
  savedName: string | null,
): Promise<boolean> {
  /* A saved folder that produced no readable directory is the lapsed-permission
   * case: the handle is still remembered, the browser just will not read it until
   * the player says so from a keypress. */
  const lapsed = savedName !== null && status?.available !== true;

  type Row = "pick" | "reconnect" | "forget" | "about";
  const items: MenuItem[] = [];
  const rows: Row[] = [];
  const add = (label: string, row: Row, color: string, hint: string): void => {
    items.push({ label, color, hint });
    rows.push(row);
  };

  if (lapsed) {
    add(
      t("modsScreen.manageFolder.reconnect", 'Reconnect "{name}"', { name: savedName }),
      "reconnect",
      C_WARN,
      t(
        "modsScreen.manageFolder.reconnectHint",
        "Your browser needs permission again before it will read that folder.",
      ),
    );
  }
  add(
    savedName === null
      ? t("modsScreen.folder.choose", "Choose a mods folder...")
      : t("modsScreen.manageFolder.chooseDifferent", "Choose a different folder..."),
    "pick",
    C_FG,
    t("modsScreen.manageFolder.pickHint", "A folder of mods, or one mod's own folder."),
  );
  if (savedName !== null) {
    add(
      t("modsScreen.manageFolder.stopUsing", 'Stop using "{name}"', { name: savedName }),
      "forget",
      C_DIM,
      t("modsScreen.manageFolder.stopUsingHint", "The bundled mods stay; nothing on your disk is touched."),
    );
  }
  add(
    t("modsScreen.common.whatIsThis", "What is this?"),
    "about",
    C_DIM,
    t("modsScreen.manageFolder.aboutHint", "Where mods come from, and the folder layout."),
  );

  for (;;) {
    const pick = await selectFromMenu(
      term,
      "core:mods-folder",
      t("modsScreen.manageFolder.title", "Mods folder"),
      items,
      t("modsScreen.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (pick === null) return false;
    const row = rows[pick];
    if (row === "about") {
      await showModSources(term, status, true);
      continue;
    }
    if (row === "pick") {
      const name = await picker.pick();
      if (name === null) return false; /* cancelled: not a failure, no message */
      await showTextScreen(term, t("modsScreen.manageFolder.title", "Mods folder"), [
        { text: t("modsScreen.manageFolder.using", 'Using "{name}".', { name }), color: C_ENABLED },
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.manageFolder.usingBody1",
            "Reload to read it. Any mod in it appears in this list, off until",
          ),
          color: C_FG,
        },
        {
          text: t("modsScreen.manageFolder.usingBody2", "you turn it on - the same as a bundled one."),
          color: C_FG,
        },
      ]);
      return true;
    }
    if (row === "reconnect") {
      const ok = await picker.reconnect();
      await showTextScreen(term, t("modsScreen.manageFolder.title", "Mods folder"), [
        ok
          ? {
              text: t("modsScreen.manageFolder.reconnected", 'Reconnected to "{name}".', {
                name: savedName ?? "",
              }),
              color: C_ENABLED,
            }
          : {
              text: t(
                "modsScreen.manageFolder.reconnectFailed",
                "Permission was not granted, so that folder stays unread.",
              ),
              color: C_DANGER,
            },
        { text: "", color: C_FG },
        ok
          ? { text: t("modsScreen.manageFolder.reloadToRead", "Reload to read it."), color: C_FG }
          : {
              text: t(
                "modsScreen.manageFolder.tryAgain",
                "You can try again, or choose a different folder.",
              ),
              color: C_FG,
            },
      ]);
      if (ok) return true;
      continue;
    }
    /* forget */
    await picker.forget();
    await showTextScreen(term, t("modsScreen.manageFolder.title", "Mods folder"), [
      {
        text: t("modsScreen.manageFolder.noLongerUsing", 'No longer using "{name}".', {
          name: savedName ?? "",
        }),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: t(
          "modsScreen.manageFolder.noLongerUsingBody",
          "Nothing on your disk was changed. Reload to drop its mods.",
        ),
        color: C_FG,
      },
    ]);
    return true;
  }
}

/**
 * Run the mod manager. Loops on the top list (mods + actions) until the user
 * leaves; if changes were made it offers to reload so they take effect.
 */
export async function runModManager(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
): Promise<void> {
  let dirty = false;
  /* Which tile-contributing mods were already on when this screen opened. Any id
   * that is enabled at the end and absent here was turned ON here, which is
   * exactly when the reboot should land on the Graphics screen - see
   * newTileModEnabled below. */
  const tileModsAtEntry = enabledTileModIds(deps);
  /* THE CURSOR SURVIVES A PASS.
   *
   * This loop rebuilds the whole screen every time round, which is what lets a
   * toggle change a row's label, its colour and whether the Apply row exists at
   * all. It also re-opened the menu with the cursor back at the top, so turning
   * three mods on in a row meant scrolling back down twice. selectFromMenu takes
   * an initialCursor; the only thing missing was somewhere to keep it. */
  let cursor = 0;
  /**
   * WHICH MOD the cursor is on, not just which row.
   *
   * The catalogue is sorted enabled-first, so turning one on MOVES it - press
   * space on the fourth row and it becomes the first, while a plain index would
   * leave the cursor pointing at whatever slid into fourth place. Going down a
   * list ticking boxes then means the cursor drifts up the list behind you. The
   * id is restored each pass and the index is the fallback for the action rows,
   * which have no id and do not move.
   */
  let cursorId: string | null = null;
  /* Set by the space-to-toggle command key, consumed after the menu closes:
   * enabling a mod can put up a consent prompt and a non-scoring warning, and a
   * command handler runs synchronously inside the menu's own key listener. */
  let toggleId: string | null = null;
  for (;;) {
    const catalog = deps.listCatalog();
    /* Read ONCE per pass, not once per row: diskPackStatus recomposes and re-reads
     * every source, and calling it inside a map over thirty mods would do that thirty
     * times for one screen. */
    const trouble = deps.diskPackStatus?.();
    const problems = trouble?.problems ?? [];
    const skipped = trouble?.skipped ?? [];
    const items: MenuItem[] = catalog.map((m) =>
      rowLabel(m, problemsFor(problems, m.id)),
    );
    type ActionKind =
      | "conflicts"
      | "autosort"
      | "install"
      | "download"
      | "modupdates"
      | "folder"
      | "reload"
      | "done";
    type RowKind = { kind: "mod"; id: string } | { kind: ActionKind };
    const rowKinds: RowKind[] = catalog.map((m) => ({
      kind: "mod" as const,
      id: m.id,
    }));

    /* Action rows below the list, each with a FIXED tag.
     *
     * Positional lettering put these on whatever letter followed the last mod,
     * so every install shifted them: `f) Recommended mods...` became `g)` the
     * moment a mod appeared above it, and a player - or a scripted test, which
     * is how this was caught - pressing the letter they used yesterday landed on
     * Auto-sort. The mods keep a, b, c...; the actions never move. Upstream does
     * exactly this for the rows that must stay put (option_actions[]' a/b/d/h in
     * ui-options.c), and MenuItem.tag is that mechanism. */
    const ACTION_TAG: Record<ActionKind, string> = {
      download: "1",
      modupdates: "7",
      folder: "2",
      conflicts: "3",
      autosort: "4",
      install: "6",
      reload: "9",
      done: "0",
    };
    const addAction = (
      label: string,
      kind: ActionKind,
      color = C_FG,
      hint = "",
    ): void => {
      items.push({ label, color, tag: ACTION_TAG[kind], ...(hint ? { hint } : {}) });
      rowKinds.push({ kind });
    };
    /* GETTING A MOD IS THE FIRST ROW.
     *
     * The list above it is the mods you already have; on a fresh install that
     * list is EMPTY, because the game bundles none. So the row directly under
     * an empty list has to be the one that ends the emptiness. It used to be
     * fourth, under conflicts, auto-sort and profiles - three screens that are
     * only meaningful once you have several mods, offered to a player who has
     * none. */
    const diskStatus = trouble;
    /* Gated on the BROWSE screen, which is the only one there is. It used to be
     * gated on the compiled-in catalogue's deps, and when that was deleted these
     * two rows would have vanished from every host - the mod manager with no way
     * to get a mod. */
    if (deps.modBrowse) {
      addAction(
        catalog.length === 0
          ? t("modsScreen.run.installStart", "Recommended mods...  (start here)")
          : t("modsScreen.run.install", "Recommended mods..."),
        "download",
        C_ENABLED,
        t("modsScreen.run.installHint", "Pick a curated mod; the game downloads, checks, and can enable it."),
      );
      /* KEEPING A MOD IS A SEPARATE JOB FROM GETTING ONE, and it had no row.
       *
       * The browse screen can update a mod - its row says so - but it is called
       * "Recommended mods", which is not where anyone looks for something they
       * already installed. So the job has its own row here.
       *
       * THE COUNT IS NOT ON THIS ROW ANY MORE, and that is the honest shape. It
       * used to be, because the answer was a local comparison against the
       * catalogue compiled into the build - instant, offline, and wrong in the
       * one way that matters: its silence meant "nothing newer shipped HERE" and
       * it said "all up to date". The answer now comes from each mod's own
       * repository, which means a request per mod, and there is no truthful way
       * to put a number here without making them. Nothing is cached either: a
       * cached freshness check is a stale answer wearing a fresh answer's
       * wording, which is the same defect one layer down.
       *
       * So the row says what pressing it does. The screen behind it says what it
       * found, including what it could not reach. */
      addAction(
        modUpgradeRowLabel(null, catalog.length),
        "modupdates",
        C_FG,
        t(
          "modsScreen.run.updatesHint",
          "Asks each installed mod's own repository whether there is a newer version.",
        ),
      );
    }
    /* The saved folder's name is read fresh each pass, because picking or
     * forgetting one changes it and the row has to follow. */
    const savedFolder = deps.modFolder ? await deps.modFolder.savedName() : null;
    if (deps.modFolder) {
      const row = modFolderRow(savedFolder, diskStatus?.available === true);
      addAction(
        row.label,
        "folder",
        row.color,
        savedFolder === null
          ? t("modsScreen.run.folderHintNone", "Already have a mod on disk? Point the game at its folder.")
          : row.lapsed
            ? t("modsScreen.run.folderHintLapsed", "Your browser needs permission again before it will read it.")
            : t("modsScreen.run.folderHintNormal", "Choose another, reconnect, or stop using it."),
      );
    }
    // No pooled "Fixes & tweaks" row: a mod's patches live under that mod
    // (manageMod -> manageModOptions), because they arrive with it and cannot
    // exist without it.
    addAction(
      t("modsScreen.run.viewConflicts", "View conflicts"),
      "conflicts",
      C_FG,
      t("modsScreen.run.viewConflictsHint", "Where two mods change the same thing, and which one wins."),
    );
    addAction(
      t("modsScreen.run.autoSort", "Auto-sort load order..."),
      "autosort",
      C_FG,
      t(
        "modsScreen.run.autoSortHint",
        "Work out an order from what the mods ask for. Your own moves are kept.",
      ),
    );
    /* The problems belonging to no ROW - a folder whose manifest would not validate
     * never becomes a catalogue entry, so there is nowhere else in this screen they
     * can appear. Badged onto the row that shows them, because the failure this whole
     * change is about is a diagnosis nobody could find: leaving them behind an
     * unremarkable "Where mods come from..." row was how the pack reader's list stayed
     * effectively invisible even though it was, technically, rendered. */
    const orphans = unattributedProblems(problems, new Set(catalog.map((m) => m.id)));
    addAction(
      orphans.length > 0
        ? t(
            "modsScreen.run.sourcesRowProblems",
            "Where mods come from...  ! {count, plural, one {# problem} other {# problems}}",
            { count: orphans.length },
          )
        : t("modsScreen.run.sourcesRow", "Where mods come from..."),
      "install",
      orphans.length > 0 ? C_DANGER : C_DIM,
      orphans.length > 0
        ? t("modsScreen.run.sourcesHintOrphans", "A mod could not be read at all, so it has no row above.")
        : diskStatus?.available === true
          ? t("modsScreen.run.sourcesHintAvailable", "Your mods folder: path, contents, and anything unreadable.")
          : deps.modFolder
            ? t("modsScreen.run.sourcesHintFolder", "The folder layout, and how one is read.")
            : t("modsScreen.run.sourcesHintNoFolder", "Why this build has no mods folder."),
    );
    if (dirty) {
      addAction(
        t("modsScreen.run.applyReload", "Apply changes and reload"),
        "reload",
        C_WARN,
        t("modsScreen.run.applyReloadHint", "Nothing you changed is in effect until the game restarts."),
      );
    }
    addAction(
      t("modsScreen.common.done", "Done"),
      "done",
      C_DIM,
      t("modsScreen.run.doneHint", "Close this and go back to the game."),
    );

    // A live ?mods= override outranks the store for this session, so the boxes
    // below describe what is SAVED, not what is loaded. Say so; the row list is
    // too narrow to spell out both sets.
    const override = deps.urlModsOverride?.() ?? null;
    const footer = override
      ? dirty
        ? t("modsScreen.run.footer.overrideDirty", "[ ?mods= live; changes pending - Apply to reload; ESC ]")
        : t(
            "modsScreen.run.footer.override",
            "[ ?mods= override is live; boxes show the SAVED set; ESC ]",
          )
      : dirty
        ? t("modsScreen.run.footer.dirty", "[ Space on/off, Enter opens; Apply to reload; ESC = back ]")
        : catalog.length === 0
          ? /* An empty list with "Enter a mod to manage it" underneath is the
             * screen telling a player to do something there is nothing to do. */
            t(
              "modsScreen.run.footer.empty",
              "[ No mods installed - Recommended mods... to get one; ESC to go back ]",
            )
          : t("modsScreen.run.footer.normal", "[ Space turns one on or off, Enter opens it; ESC to go back ]");
    const pick = await selectFromMenu(term, "core:mods", t("modsScreen.run.title", "Mods"), items, footer, {
      initialCursor: cursorId === null ? cursor : (() => {
        const at = rowKinds.findIndex((r) => r.kind === "mod" && "id" in r && r.id === cursorId);
        return at >= 0 ? at : Math.min(cursor, items.length - 1);
      })(),
      onHighlight: (i) => {
        cursor = i;
        const row = rowKinds[i];
        cursorId = row && row.kind === "mod" && "id" in row ? row.id : null;
      },
      /* SPACE IS THE TOGGLE, on the row you are looking at.
       *
       * The list is a column of checkboxes and the only way to tick one was to
       * open the mod, choose Enable, and come back out - three keys and two
       * screens for the single thing this screen is for. Enter keeps its meaning
       * (open the mod), because everything else about a mod lives in there.
       *
       * This is port-only UI and does not collide with parity: upstream's menus
       * give space to "page down" (menu_handle_keypress, ui-menu.c), and there is
       * no mod manager upstream to disagree with.
       *
       * The handler cannot do the work itself - enabling can raise a consent
       * prompt and a permanent-non-scoring warning, both of which are awaited -
       * so it records the id and asks for a rebuild. */
      commands: {
        " ": (cur) => {
          const row = rowKinds[cur];
          if (!row || row.kind !== "mod" || !("id" in row)) return null;
          toggleId = row.id;
          return MENU_REFRESH;
        },
      },
      // Shown by default (not behind the '?' toggle): what a mod IS is the thing
      // a player needs in order to decide whether to turn it on.
      detail: (i) => {
        const rk = rowKinds[i];
        /* The one action row that gets a pane of its own. On a fresh install the
         * whole screen is this row, and "Recommended mods..." alone does not answer
         * the question a player has, which is where these come from and whether
         * running one is safe. */
        if (rk?.kind === "download" && catalog.length === 0) {
          const w = term.size().cols - 1;
          return [
            { text: t("modsScreen.run.emptyTitle", "You have no mods installed."), color: C_TITLE },
            { text: "", color: C_FG },
            ...wrapped(
              t(
                "modsScreen.run.emptyBody1",
                "That is the normal starting state - Neo Angband ships as " +
                  "Angband 4.2.6 and nothing else, and every mod, including the " +
                  "ones written here, is something you choose to add.",
              ),
              w,
            ),
            { text: "", color: C_FG },
            /* REWRITTEN because it described a model that no longer exists. It
             * said every file is checked against "a fingerprint that shipped
             * inside your copy of the game" - which was true of the compiled-in
             * catalogue and is now false: a shipped digest cannot survive a mod
             * releasing a new version, which is why the game asks the repository
             * instead and pins the ORIGIN on first install. Prose describing a
             * deleted mechanism is worse than no prose, because a player trusts
             * it. */
            ...wrapped(
              t(
                "modsScreen.run.emptyBody2",
                "Open this row for the list. The game holds no list of what a mod " +
                  "contains - it asks each mod's own repository, so a mod can " +
                  "release an update without waiting for a new version of the game.",
              ),
              w,
            ),
            { text: "", color: C_FG },
            ...wrapped(
              t(
                "modsScreen.run.emptyBody3",
                "On first install a mod is pinned to the repository it came from " +
                  "and can only be updated from that same place. Nothing here " +
                  "reviews a mod's code, including the recommended ones.",
              ),
              w,
            ),
          ];
        }
        if (!rk || !("id" in rk)) return [];
        const m = catalog.find((x) => x.id === rk.id);
        if (!m) return [];
        // Budget: keep at least MIN_LIST_ROWS rows of the LIST on screen (it
        // scrolls to the cursor, and ESC always closes) and hand the rest to the
        // description. The cap only bites on a mod whose blurb is longer than the
        // pane; the bundled ones fit, and opening the mod shows the full text.
        //
        // The floor used to be written `Math.max(8, ...)` - a floor on the PANE,
        // which overrides the list floor it sits next to rather than protecting
        // it. On a 14-row terminal it claimed 8 of them and left the mod list
        // two rows deep. A pane is the thing that can afford to be short here,
        // because opening the mod shows all of it; the list is not.
        const MIN_LIST_ROWS = 5;
        const { cols, rows } = term.size();
        const CHROME = 4; // title, blank, hint line, footer
        const budget = Math.max(0, rows - CHROME - Math.min(items.length, MIN_LIST_ROWS));
        const detail = rowDetail(
          m,
          cols,
          budget - 1,
          problemsFor(problems, m.id),
          problemsFor(skipped, m.id),
        );
        /* Where in the list this row is. With five rows of a thirty-mod catalogue
         * on screen there is otherwise nothing that says the list continues -
         * upstream's menu draws no scroll indicator (display_scrolling has none)
         * and this pane is the port's own text, so the count goes here rather
         * than as new chrome on a faithful menu. Only when it is worth saying. */
        const total = catalog.length;
        return total > 1 && detail.length < budget
          ? [
              {
                text: t("modsScreen.run.modOfTotal", "Mod {index} of {total}", {
                  index: i + 1,
                  total,
                }),
                color: C_DIM,
              },
              ...detail,
            ]
          : detail;
      },
      detailToggleKey: "?",
      detailInitiallyShown: true,
    });

    /* The space toggle asked for a rebuild rather than choosing a row. Do the
     * work the command handler could not await, then fall through to the top of
     * the loop - which redraws with `cursor` still where the player left it. */
    if (pick === MENU_REFRESH) {
      const id = toggleId;
      toggleId = null;
      const m = id === null ? undefined : catalog.find((x) => x.id === id);
      if (m) {
        if (m.enabled) {
          deps.store.setModEnabled(m.id, false);
          dirty = true;
        } else if (await enableMod(term, deps, m)) {
          dirty = true;
        }
      }
      continue;
    }

    const rk: RowKind | undefined =
      pick === null ? { kind: "done" } : rowKinds[pick];
    if (!rk || rk.kind === "done") break;
    if (rk.kind === "mod" && "id" in rk) {
      if (await manageMod(term, deps, rk.id)) dirty = true;
    } else if (rk.kind === "conflicts") {
      await viewConflicts(term, deps);
    } else if (rk.kind === "autosort") {
      if (await autoSortLoadOrder(term, deps)) dirty = true;
    } else if (rk.kind === "download") {
      if (deps.modBrowse) {
        let enabledThroughInstall = false;
        const touched = await showRecommendedMods(term, {
          ...deps.modBrowse,
          offerEnable: async (id) => {
            if (await enableAfterInstall(term, deps, id)) {
              dirty = true;
              enabledThroughInstall = true;
              return true;
            }
            return false;
          },
          leaveAfterEnabledInstall: () => enabledThroughInstall,
          applyRecommended: async (ids, enableAllOptions) => {
            const applied = await enableRecommendedMods(term, deps, ids, enableAllOptions);
            if (applied) dirty = true;
            return applied;
          },
        });
        if (touched) dirty = true;
        if (enabledThroughInstall) {
          await applyModChanges(term, deps, tileModsAtEntry);
          return;
        }
      }
    } else if (rk.kind === "modupdates") {
      if (deps.modBrowse) {
        const touched = await showModUpgrades(term, {
          ...deps.modBrowse,
          offerEnable: async (id) => {
            if (await enableAfterInstall(term, deps, id)) {
              dirty = true;
              return true;
            }
            return false;
          },
        });
        if (touched) dirty = true;
      }
    } else if (rk.kind === "install") {
      await showModSources(term, deps.diskPackStatus?.(), deps.modFolder !== undefined);
    } else if (rk.kind === "folder") {
      if (
        deps.modFolder &&
        (await manageModFolder(term, deps.modFolder, diskStatus, savedFolder))
      ) {
        dirty = true;
      }
    } else if (rk.kind === "reload") {
      deps.requestReload();
      return; // reload takes over
    }
  }

  if (dirty) await applyModChanges(term, deps, tileModsAtEntry);
}

/**
 * Ids of the ENABLED mods that contribute tile packs.
 *
 * A `tiles`-shape mod need not declare tilePacks (it could re-skin via records),
 * and a mod of any shape may declare them, so this asks the manifest what it
 * actually contributes rather than trusting `shape`.
 */
function enabledTileModIds(deps: ModManagerDeps): Set<string> {
  const out = new Set<string>();
  for (const m of deps.listCatalog()) {
    if (m.enabled && (m.manifest.tilePacks?.length ?? 0) > 0) out.add(m.id);
  }
  return out;
}
