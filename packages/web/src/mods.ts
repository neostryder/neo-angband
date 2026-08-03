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
  promptText,
  MENU_REFRESH,
  type MenuItem,
  type ScreenLine,
} from "./overlay";
import type { GlyphTerm } from "./term";
import type { ModDirKind, ModOrigin } from "./disk-packs";
import type { CatalogMod, ModStore } from "./mod-store";
import type { ModRuleDecl } from "./pack";
import {
  problemsFor,
  unattributedProblems,
  type ModProblem,
} from "./mod-problems";
import { describeCapabilities, hasElevatedCapability } from "./capability-describe";
import { showModCatalogue, type ModCatalogueDeps } from "./mod-catalogue";
import { showModBrowse, showModUpgrades, type ModUpgradeDeps } from "./mod-browse";
import { modUpgradeRowLabel } from "./mod-refresh";
import type { ConflictReportLines } from "./mod-conflicts";
import {
  resolveSectionState,
  sortModOrder,
  type PackManifest,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { wrapCssRuns } from "./shop";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD } from "./ui-colors";

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
  modCatalogue?: ModCatalogueDeps;
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
    return { label: "Choose a mods folder...", color: C_FG, lapsed: false };
  }
  if (attached) return { label: `Mods folder: ${savedName}`, color: C_FG, lapsed: false };
  return {
    label: `Mods folder: ${savedName} - NEEDS RECONNECTING`,
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
  const own = `${String(count)} ${theirs}.`;
  if (bundledCount === 0) return own[0]!.toUpperCase() + own.slice(1);
  return `${String(bundledCount)} bundled with the game, ${own}`;
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
    { text: "This browser cannot be given a mods FOLDER.", color: C_FG },
    { text: "", color: C_FG },
    { text: "It has no way to hand a directory to a web page, so that one", color: C_FG },
    { text: "route is closed here. Downloading is not: Install a mod... needs", color: C_FG },
    { text: "only a network request and this browser's own storage, and every", color: C_FG },
    { text: "mod on offer arrives that way - checked against a digest that", color: C_FG },
    { text: "ships inside the game, so a tampered download never runs.", color: C_FG },
    { text: "", color: C_FG },
    { text: "Nothing is missing from your mod list because of your browser.", color: C_GOLD_TEXT },
    { text: "", color: C_FG },
    { text: "Chrome and Edge can ALSO be given a folder, which is useful for", color: C_WARN },
    { text: "a mod you are writing; the desktop build keeps its own, which an", color: C_WARN },
    { text: "external mod manager can deploy into.", color: C_WARN },
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
      label: `[x] ${m.name}  - NOT INSTALLED`,
      color: C_DANGER,
      hint: "Switched on, but the mod itself is gone. Enter to remove it.",
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
    flags.push("NOT WORKING");
  } else {
    if (m.nondeterministic) flags.push("unseeded");
    if (m.affectsGameplay) flags.push("noscore");
    if (needsConsent) flags.push("NEEDS OK");
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
   * called "Bug Fixes (unofficial patch set)" with both save ratchets set built
   * an 85-column row, and what a player saw was the name, the version, the kind,
   * and none of the three warnings. Eliding the name instead keeps every badge
   * on screen and costs a few characters of something the row below spells out
   * in full. Measured in mod-viewport.test.ts against the real paint. */
  const fixed = `${box}   v${m.version}  (${kindTag})${suffix}`;
  const room = Math.max(MIN_NAME_COLS, LABEL_COLS - fixed.length);
  const name = m.name.length <= room ? m.name : `${m.name.slice(0, room - 3)}...`;
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
      ? "Asks for nothing beyond the game."
      : m.capabilities.length === 1
        ? "Asks for one permission."
        : `Asks for ${m.capabilities.length} permissions.`;
  /* No "Enter to manage it." on the end. The footer of this very screen already
   * says so for every row, and repeating it cost four columns off the end of
   * the longest hint - which is the part that describes the mod. */
  return {
    label,
    color,
    hint: broken
      ? `${problems.length === 1 ? "Something" : `${problems.length} things`} stopped this working. Enter to see what.`
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
      return "Changes the game's contents.";
    case "tiles":
      return "A set of graphics.";
    case "plugin":
      return "Runs its own code.";
    default:
      return `A ${shape} mod.`;
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
      ...wrapped("Switched on, but not installed.", w, C_DANGER),
      { text: "", color: C_FG },
      ...wrapped(
        "This mod is in your enabled list and the game cannot find it, so " +
          "every launch tries to load it and gives up. It was probably " +
          "uninstalled, or this is a fresh copy of the game over an old profile.",
        w,
      ),
      { text: "", color: C_FG },
      ...wrapped(
        "Open it to take it off the list. If you want it back instead, " +
          "Install a mod... will fetch it again.",
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
    ...wrapped(`${m.name}  (id: ${m.id})`, w, C_TITLE),
    ...wrapped(
      m.kind === "content"
        ? `version ${m.version}  -  ${m.shape} pack`
        : `version ${m.version}  -  ${m.shape} pack, ${m.kind} plugin`,
      w,
    ),
  ];
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
        problems.length === 1 ? "NOT WORKING:" : `NOT WORKING - ${problems.length} problems:`,
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
    trouble.push({ text: "", color: C_FG }, ...wrapped(`Not loaded: ${s}`, w, C_WARN));
  }

  const below: ScreenLine[] = [];
  const ruleCount = m.manifest.rules?.length ?? 0;
  if (ruleCount > 0) {
    below.push({ text: "", color: C_FG });
    below.push(
      ...wrapped(
        m.enabled
          ? `Makes ${ruleCount} separate ${ruleCount === 1 ? "change" : "changes"}, all on. Open the mod to switch any one off.`
          : `Makes ${ruleCount} separate ${ruleCount === 1 ? "change" : "changes"}. None of them happen while it is off; turning it on turns all of them on.`,
        w,
        m.enabled ? C_ENABLED : C_DIM,
      ),
    );
  }
  const deps = m.manifest.dependencies
    ? Object.entries(m.manifest.dependencies).map(([d, v]) => `${d} ${v}`)
    : [];
  if (deps.length) below.push(...wrapped(`Needs: ${deps.join(", ")}`, w));
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
      ...wrapped("Permanent once on: the same seed stops giving the same game.", w, C_WARN),
    );
  }
  if (m.affectsGameplay) {
    below.push(
      ...wrapped("Permanent once on: changes play, so this character cannot score.", w, C_WARN),
    );
  }
  if (m.capabilities.length === 0) {
    /* "(content only)" was wrong for a plugin that requests nothing, and a folder
     * plugin is exactly that case: it runs code but asks for no registry domain,
     * so the row said "content only" about a mod whose whole substance is code.
     * The parenthetical now describes the mod in front of the player. */
    below.push(
      ...wrapped(
        m.kind === "content"
          ? "Asks for no permissions - it only adds and changes game contents."
          : "Asks for no permissions.",
        w,
        C_DIM,
      ),
    );
  } else {
    below.push(...wrapped("It asks to be allowed to:", w));
    for (const d of describeCapabilities(m.capabilities)) {
      /* Hanging indent so a wrapped bullet stays visibly one bullet. */
      below.push(
        ...wrapped(`  - ${d.text}${d.elevated ? "  [powerful]" : ""}`, w, d.elevated ? C_WARN : C_FG)
          .map((l, i) => (i === 0 ? l : { ...l, text: `    ${l.text}` })),
      );
    }
    below.push(
      ...wrapped(
        m.consented
          ? "You have allowed this."
          : "You have not allowed this yet - you will be asked when you turn it on.",
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
  const MORE = { text: "...  (open the mod to read the rest)", color: C_DIM };
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
 */
export function fullDescription(m: CatalogMod, width = 80): ScreenLine[] {
  const w = width - 1;
  const out: ScreenLine[] = [
    ...wrapped(`${m.name}  (id: ${m.id})`, w, C_TITLE),
    ...wrapped(`version ${m.version}  -  ${m.shape} pack`, w, C_DIM),
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
  if (deps.length) out.push(...wrapped(`Needs: ${deps.join(", ")}`, w, C_DIM));
  if (m.manifest.engine) out.push(...wrapped(`Written for game ${m.manifest.engine}`, w, C_DIM));
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

async function gameplayNoscorePrompt(term: GlyphTerm, m: CatalogMod): Promise<boolean> {
  await showTextScreen(term, `Non-scoring save - ${m.name}`, [
    { text: "This mod changes core gameplay behavior.", color: C_WARN },
    { text: "Your save will be permanently marked as non-scoring.", color: C_WARN },
  ], "[ Press ESC to review, then choose ]");
  const pick = await selectFromMenu(
    term,
    `Enable gameplay-changing mod "${m.name}"?`,
    [
      { label: "Yes, enable and mark save non-scoring", color: C_WARN },
      { label: "No, cancel", color: C_FG },
    ],
    "[ a/b or tap; ESC cancels ]",
  );
  return pick === 0;
}

/**
 * The capability consent gate: show every requested capability in plain terms,
 * flag elevated ones, and require an explicit Yes. Returns true if consented.
 */
async function consentPrompt(term: GlyphTerm, m: CatalogMod): Promise<boolean> {
  const lines: ScreenLine[] = [
    { text: `"${m.name}" requests these capabilities:`, color: C_TITLE },
    { text: "", color: C_FG },
  ];
  for (const d of describeCapabilities(m.capabilities)) {
    lines.push({
      text: `  - ${d.text}${d.elevated ? "   [elevated]" : ""}`,
      color: d.elevated ? C_WARN : C_FG,
    });
  }
  lines.push({ text: "", color: C_FG });
  if (hasElevatedCapability(m.capabilities)) {
    lines.push({
      text: "This mod can change core game behavior in-process. Only enable mods you trust.",
      color: C_DANGER,
    });
  }
  if (m.nondeterministic) {
    lines.push({
      text: "It also marks your save permanently non-reproducible.",
      color: C_WARN,
    });
  }
  lines.push({ text: "", color: C_FG });
  // A trailing read of the terms, then a Yes/No pick.
  await showTextScreen(term, `Consent - ${m.name}`, lines, "[ Press ESC to review, then choose ]");
  const pick = await selectFromMenu(
    term,
    `Grant these capabilities to "${m.name}"?`,
    [
      { label: "Yes, enable and grant", color: C_ENABLED },
      { label: "No, cancel", color: C_FG },
    ],
    "[ a/b or tap; ESC cancels ]",
  );
  return pick === 0;
}

/**
 * The question asked straight after a download: turn it on now?
 *
 * It re-reads the mod sources first, and that call is what makes the rest of this
 * possible. `listCatalog()` is built from a report latched at boot, so a mod
 * installed thirty seconds ago is not in it - the answer to "which mod is this"
 * would have been "no such mod", and enabling it by bare id would skip the
 * consent prompt and the non-scoring warning, which are exactly the things that
 * must not be skipped by a convenience. With the sources re-read the mod is a
 * real catalogue row and goes through the same enableMod every other path uses.
 */
async function enableAfterInstall(
  term: GlyphTerm,
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
  const pick = await selectFromMenu(
    term,
    `Turn ${m.name} on now?`,
    [
      {
        label: "Yes, turn it on",
        color: C_ENABLED,
        hint: "Takes effect when the game reloads, which you are offered on the way out.",
      },
      {
        label: "No, leave it off",
        color: C_DIM,
        hint: "It stays installed. You can switch it on in the list at any time.",
      },
    ],
    "[ Enter to choose; ESC leaves it off ]",
    { minListRows: 2, detail: () => rowDetail(m, term.size().cols, 99) },
  );
  if (pick !== 0) return false;
  return enableMod(term, deps, m);
}

/** Enable a mod, gating plugins on capability consent. Returns true if enabled. */
async function enableMod(
  term: GlyphTerm,
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
  term: GlyphTerm,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  const catalog = deps.listCatalog();
  const nameOf = (id: string): string => catalog.find((c) => c.id === id)?.name ?? id;
  const enabled = catalog.filter((c) => c.enabled && c.id !== m.id);
  const claims: { text: string; because: string }[] = [];

  for (const c of m.manifest.compat ?? []) {
    if (c.claim !== "conflicts" || !enabled.some((e) => e.id === c.with)) continue;
    const where = c.scope?.length ? ` over ${c.scope.join(", ")}` : "";
    claims.push({
      text: `${m.name} says it conflicts with ${nameOf(c.with)}${where}.`,
      because: c.because,
    });
  }
  for (const other of enabled) {
    for (const c of other.manifest.compat ?? []) {
      if (c.claim !== "conflicts" || c.with !== m.id) continue;
      const where = c.scope?.length ? ` over ${c.scope.join(", ")}` : "";
      claims.push({
        text: `${other.name} says it conflicts with ${m.name}${where}.`,
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
    text: "This is the author's own warning. Nothing stops you running both.",
    color: C_DIM,
  });
  await showTextScreen(term, `Enable ${m.name}?`, body);

  const pick = await selectFromMenu(
    term,
    `Enable ${m.name} anyway?`,
    [
      { label: "Enable it anyway", color: C_WARN },
      { label: "Leave it off", color: C_DIM },
    ],
    "[ Enter to choose; ESC to leave it off ]",
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
  term: GlyphTerm,
  deps: ModManagerDeps,
  id: string,
): Promise<boolean> {
  let changed = false;
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
        m.name,
        [
          {
            label: "Take it off the list",
            color: C_ENABLED,
            hint: "The game stops trying to load it. Nothing else changes.",
          },
          { label: "Leave it", color: C_DIM, hint: "In case you mean to reinstall it." },
        ],
        "[ Enter to choose; ESC to leave it ]",
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
    /* A mod's named parts (PackSection): the general form of a rule, since a
     * section can carry content and a load-order band as well as behaviour. */
    const sectionCount = m.manifest.sections?.length ?? 0;
    if (m.enabled) {
      items.push({ label: "Disable", color: C_WARN });
      acts.push("disable");
      if (ruleCount > 0) {
        items.push({
          label: `Fixes & tweaks (${ruleCount})...`,
          color: C_ENABLED,
          hint: `All ${ruleCount} are on; switch any one off here.`,
        });
        acts.push("rules");
      }
      if (sectionCount > 0) {
        items.push({
          label: `Parts of this mod (${sectionCount})...`,
          color: C_ENABLED,
          hint: "Take some of this mod without the rest.",
        });
        acts.push("sections");
      }
      items.push({ label: "Move earlier (loads first)", color: C_FG });
      acts.push("up");
      items.push({ label: "Move later (loads last, wins conflicts)", color: C_FG });
      acts.push("down");
    } else {
      items.push({ label: "Enable", color: C_ENABLED });
      acts.push("enable");
      if (ruleCount > 0) {
        // Deliberately present and deliberately dead: it is the clearest way to
        // show that this mod HAS patches and that they do not exist yet.
        items.push({
          label: `Fixes & tweaks (${ruleCount} once enabled)`,
          color: C_DISABLED,
          disabled: true,
          hint: "Enable this mod first - its patches do not exist until then.",
        });
        acts.push("rules");
      }
      if (sectionCount > 0) {
        items.push({
          label: `Parts of this mod (${sectionCount} once enabled)`,
          color: C_DISABLED,
          disabled: true,
          hint: "Enable this mod first - its parts do not exist until then.",
        });
        acts.push("sections");
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
        label: "Read the full description",
        color: C_DIM,
        hint: "The whole thing, scrollable, with what it depends on.",
      });
      acts.push("read");
    }
    items.push({ label: "Back", color: C_DIM });
    acts.push("back");

    const pick = await selectFromMenu(
      term,
      `${m.name}  v${m.version}`,
      items,
      "[ choose an action; ESC to go back ]",
      {
        /* Every action row stays visible. This screen's list is short and fixed,
         * so there is no reason for the description to win any of it - and it is
         * the description that has somewhere else to be read in full. */
        minListRows: items.length,
        detail: () => rowDetail(m, term.size().cols, 99, myProblems, mySkipped),
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    const act = pick === null ? "back" : acts[pick];
    if (act === "back") return changed;
    if (act === "read") {
      await showTextScreen(term, `${m.name}  v${m.version}`, fullDescription(m, term.size().cols));
      continue;
    }
    if (act === "enable") {
      if (await enableMod(term, deps, m)) changed = true;
    } else if (act === "disable") {
      deps.store.setModEnabled(m.id, false);
      changed = true;
    } else if (act === "rules") {
      await managePatches(term, deps, m);
    } else if (act === "sections") {
      if (await manageSections(term, deps, m)) changed = true;
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
async function autoSortLoadOrder(term: GlyphTerm, deps: ModManagerDeps): Promise<boolean> {
  const current = deps.store.getEnabled();
  const byId = new Map(deps.listCatalog().map((m) => [m.id, m]));
  const manifests = current
    .map((id) => byId.get(id)?.manifest)
    .filter((m): m is PackManifest => m !== undefined);

  if (manifests.length < 2) {
    await showTextScreen(term, "Auto-sort", [
      { text: "There is nothing to sort - enable at least two mods first.", color: C_DIM },
    ]);
    return false;
  }

  const result = sortModOrder(manifests, { pins: deps.store.getPins(), current });
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;
  const unchanged = result.order.every((id, i) => current[i] === id);

  const body: ScreenLine[] = [];
  body.push({ text: unchanged ? "Already in order:" : "Proposed order:", color: C_TITLE });
  result.order.forEach((id, i) => {
    const moved = current[i] !== id;
    body.push({
      text: `  ${String(i + 1).padStart(2)}. ${nameOf(id)}${moved ? "   <- moved" : ""}`,
      color: moved ? C_WARN : C_FG,
    });
  });
  body.push({ text: "", color: C_DIM });
  body.push({ text: "Later mods win conflicts.", color: C_DIM });

  if (result.dropped.length > 0) {
    body.push({ text: "", color: C_DIM });
    body.push({ text: "Suggestions it could not honour", color: C_WARN });
    for (const d of result.dropped) {
      /* The REASON, not just the pair: an author wrote it, and it is the only
       * thing that tells the player whether the drop matters to them. */
      body.push({ text: `  ${d.reason}`, color: C_FG });
      body.push({
        text: `    dropped - it would need ${d.cycle.map(nameOf).join(" -> ")} -> ${nameOf(d.cycle[0] ?? "")}`,
        color: C_DIM,
      });
    }
  }

  if (result.unresolvable.length > 0) {
    body.push({ text: "", color: C_DIM });
    body.push({ text: "These mods cannot all load", color: C_DANGER });
    for (const cycle of result.unresolvable) {
      body.push({
        text: `  ${cycle.map(nameOf).join(" and ")} each require the other.`,
        color: C_FG,
      });
    }
    body.push({ text: "  Turn one of them off; no order can satisfy both.", color: C_DIM });
  }

  await showTextScreen(term, "Auto-sort", body);
  if (unchanged) return false;

  const pick = await selectFromMenu(
    term,
    "Apply this order?",
    [
      { label: "Apply it", color: C_ENABLED },
      { label: "Leave my order alone", color: C_DIM },
    ],
    "[ Enter to choose; ESC to leave it alone ]",
  );
  if (pick !== 0) return false;
  deps.store.setEnabled(result.order);
  return true;
}

/**
 * A mod's named PARTS: switch any one of them off without losing the rest.
 *
 * The general form of "Fixes & tweaks". A rule toggles the mod's own behaviour;
 * a section can also carry content and a load-order band, so this is where a
 * player takes a mod's tileset without its monsters.
 *
 * A section a `patches` claim made conditional is shown but not switchable, with
 * the reason: it is a compatibility patch for a mod that is not installed, so
 * turning it on would patch nothing.
 */
async function manageSections(
  term: GlyphTerm,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  const sections = m.manifest.sections ?? [];
  if (sections.length === 0) return false;
  let changed = false;
  const title = `Parts of ${m.name}`;
  /* Kept across passes for the same reason the mod list keeps its own: toggling
   * rebuilds the screen, and a rebuild that re-opens at row 0 makes switching two
   * parts off in a row harder than it needs to be. */
  let cursor = 0;

  for (;;) {
    const enabledManifests = deps
      .listCatalog()
      .filter((c) => c.enabled)
      .map((c) => c.manifest);
    const resolved = resolveSectionState(
      enabledManifests,
      deps.store.getSectionChoices(),
      new Set(enabledManifests.map((c) => c.id)),
    ).get(m.id);
    /* Which sections the player cannot decide, and why: a `patches` claim whose
     * target is absent forces the section off regardless of any stored choice. */
    const forcedOff = new Map<string, string>();
    for (const c of m.manifest.compat ?? []) {
      if (c.claim !== "patches") continue;
      if (enabledManifests.some((e) => e.id === c.with)) continue;
      for (const sid of c.scope ?? []) forcedOff.set(sid, c.with);
    }

    const items: MenuItem[] = sections.map((s) => {
      const on = resolved?.get(s.id) ?? true;
      const locked = forcedOff.has(s.id);
      return {
        label: `${on ? "[x]" : "[ ]"} ${s.title}${locked ? "   (needs " + forcedOff.get(s.id) + ")" : ""}`,
        color: locked ? C_DISABLED : on ? C_ENABLED : C_DISABLED,
        ...(locked ? { disabled: true } : {}),
      };
    });
    items.push({ label: "Back", color: C_DIM });

    const pick = await selectFromMenu(term, title, items, "[ Space or Enter toggles a part; ESC to go back ]", {
      initialCursor: cursor,
      onHighlight: (i) => {
        cursor = i;
      },
      /* Space is an alias for Enter here - both toggle - so it resolves the menu
       * on the cursor row rather than needing the MENU_REFRESH round trip the mod
       * list uses. Null on the Back row: space should not close the screen. */
      commands: { " ": (cur) => (cur < sections.length ? cur : null) },
      detail: (i) => {
        const s = sections[i];
        if (!s) return [];
        const cols = term.size().cols;
        const on = resolved?.get(s.id) ?? true;
        const lines: ScreenLine[] = [
          { text: s.title, color: C_TITLE },
          { text: on ? "ON" : "OFF", color: on ? C_ENABLED : C_DIM },
          { text: "", color: C_FG },
          ...wrapped(s.description ?? "", cols - 1),
        ];
        if (s.priority && s.priority !== "normal") {
          lines.push({ text: "", color: C_FG });
          lines.push(
            ...wrapped(
              `This part is set to load ${s.priority}, so it wins or loses conflicts independently of where ${m.name} sits in the list.`,
              cols - 1,
              C_DIM,
            ),
          );
        }
        const needs = forcedOff.get(s.id);
        if (needs) {
          lines.push({ text: "", color: C_FG });
          lines.push(
            ...wrapped(
              `A compatibility patch for ${needs}, which is not enabled - so it does nothing and cannot be turned on.`,
              cols - 1,
              C_DIM,
            ),
          );
        }
        return lines;
      },
      detailToggleKey: "?",
      detailInitiallyShown: true,
    });

    if (pick === null || pick >= sections.length) return changed;
    const s = sections[pick];
    if (!s || forcedOff.has(s.id)) continue;
    deps.store.setSectionChoice(m.id, s.id, !(resolved?.get(s.id) ?? true));
    changed = true;
  }
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
async function viewConflicts(term: GlyphTerm, deps: ModManagerDeps): Promise<void> {
  const { declared, contested, combined } = deps.conflictLines();
  const body: ScreenLine[] = [];

  if (declared.length > 0) {
    body.push({ text: "The authors said so themselves", color: C_WARN });
    for (const t of declared) body.push({ text: t, color: C_FG });
    body.push({ text: "", color: C_DIM });
    body.push({
      text: "Nothing here is blocked - you can play any combination you like.",
      color: C_DIM,
    });
    body.push({ text: "", color: C_DIM });
  }

  if (contested.length > 0) {
    body.push({ text: "One of these wins, the rest are ignored", color: C_WARN });
    for (const t of contested) body.push({ text: t, color: C_FG });
    body.push({ text: "", color: C_DIM });
  }

  if (combined.length > 0) {
    body.push({ text: "These stack, and need nothing from you", color: C_ENABLED });
    for (const t of combined) body.push({ text: t, color: C_DIM });
    body.push({ text: "", color: C_DIM });
  }

  if (body.length === 0) {
    body.push({
      text: "Nothing among your enabled mods contests anything else.",
      color: C_ENABLED,
    });
  }
  await showTextScreen(term, "Mod conflicts", body);
}

/** The profiles submenu: save current, apply, or delete a named config. */
async function manageProfiles(
  term: GlyphTerm,
  deps: ModManagerDeps,
): Promise<boolean> {
  let changed = false;
  for (;;) {
    const profiles = Object.keys(deps.store.getProfiles()).sort();
    const items: MenuItem[] = [
      { label: "Save current setup as a profile...", color: C_FG },
    ];
    const acts: string[] = ["save"];
    for (const name of profiles) {
      items.push({ label: `Apply "${name}"`, color: C_ENABLED });
      acts.push(`apply:${name}`);
      items.push({ label: `Delete "${name}"`, color: C_WARN });
      acts.push(`delete:${name}`);
    }
    items.push({ label: "Back", color: C_DIM });
    acts.push("back");

    const pick = await selectFromMenu(
      term,
      "Mod profiles",
      items,
      "[ save / apply / delete; ESC to go back ]",
    );
    const act = pick === null ? "back" : acts[pick];
    if (act === "back") return changed;
    if (act === "save") {
      const name = await promptText(term, "Profile name", "", 40);
      if (name && name.trim()) deps.store.saveProfile(name.trim());
    } else if (act?.startsWith("apply:")) {
      deps.store.applyProfile(act.slice("apply:".length));
      changed = true;
    } else if (act?.startsWith("delete:")) {
      deps.store.deleteProfile(act.slice("delete:".length));
    }
  }
}

/**
 * ONE MOD's Fixes & tweaks: the toggleable rules that mod declares, each with an
 * on/off box and its full description. Reached from the mod itself (manageMod),
 * not from a pooled screen - a patch belongs to its mod, so it is managed where
 * the mod is.
 *
 * Toggling writes the player's choice to the store and, when a game is running,
 * applies it live (deps.applyRuleLive) so it takes effect immediately; otherwise
 * it applies on the next character.
 *
 * Reachable only while the mod is ENABLED, because a patch does not exist while
 * its mod is off - no flag is present and core runs faithful 4.2.6. Enabling the
 * mod brings its whole patch set on with it (every bundled patch declares
 * `default: true`, i.e. "on once its mod is on"); these rows exist so a player
 * can then opt out of individual patches and take the set minus one.
 */
async function managePatches(
  term: GlyphTerm,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<void> {
  const getDecls = deps.ruleDecls ?? ((): ModRuleDecl[] => []);
  const title = `Fixes & tweaks - ${m.name}`;
  /* Survives the rebuild a toggle causes - see manageSections. */
  let cursor = 0;
  for (;;) {
    const decls = getDecls().filter((d) => d.modId === m.id);
    if (decls.length === 0) {
      // Only reachable if discovery and the catalog disagree (the mod declares
      // rules but the host does not surface them) - say so plainly.
      await showTextScreen(term, title, [
        { text: `${m.name} is not contributing any toggleable patch right now.`, color: C_DIM },
        { text: "", color: C_FG },
        { text: "A patch exists only while the mod providing it is enabled.", color: C_FG },
      ]);
      return;
    }
    const choices = deps.store.getRuleChoices();
    // No per-row hint: the detail pane below already carries the full wrapped
    // description, and a truncated copy of it on the bottom line only costs a row.
    const items: MenuItem[] = decls.map(({ rule }) => {
      const on = choices[rule.flag] ?? rule.default;
      return {
        label: `${on ? "[x]" : "[ ]"} ${rule.title}`,
        color: on ? C_ENABLED : C_DISABLED,
      };
    });
    const pick = await selectFromMenu(
      term,
      title,
      items,
      "[ On with the mod; Space or Enter opts one out; ESC to go back ]",
      {
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
        /* Every row here is a rule, so space simply means Enter. */
        commands: { " ": (cur) => cur },
        detail: (i) => {
          const d = decls[i];
          if (!d) return [];
          const cols = term.size().cols;
          const on = choices[d.rule.flag] ?? d.rule.default;
          return [
            { text: d.rule.title, color: C_TITLE },
            { text: `${on ? "ON" : "OFF"}  -  flag ${d.rule.flag}`, color: on ? C_ENABLED : C_DIM },
            { text: "", color: C_FG },
            ...wrapped(d.rule.description, cols - 1),
            { text: "", color: C_FG },
            ...wrapped(
              d.rule.default
                ? `Comes on with ${m.name}; turn it off here to take the rest of the set without it. It does not exist at all while ${m.name} is disabled.`
                : `Off until you turn it on here. It does not exist at all while ${m.name} is disabled.`,
              cols - 1,
              C_DIM,
            ),
          ];
        },
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    if (pick === null) return;
    const d = decls[pick];
    if (!d) continue;
    const now = choices[d.rule.flag] ?? d.rule.default;
    deps.store.setRuleChoice(d.rule.flag, !now);
    deps.applyRuleLive?.(d.rule.flag, !now);
  }
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
  term: GlyphTerm,
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
        { text: "No mods folder chosen yet.", color: C_FG },
        { text: "", color: C_FG },
        { text: "This build can read one: choose a folder on your computer and it", color: C_FG },
        { text: "is remembered for every later visit. The mods in it are read the", color: C_FG },
        { text: "same way the desktop build reads its own folder, by the same", color: C_FG },
        { text: "validator, so a mod behaves identically on both.", color: C_FG },
        { text: "", color: C_FG },
        { text: "Pick either a folder of mods, or a single mod's folder.", color: C_GOLD_TEXT },
      );
    } else {
      lines.push(...noFolderPickerLines());
    }
  } else if (status.kind === "installed") {
    /* Mods installed from their own repositories and NO folder at all. There is no
     * directory to name - nobody put these anywhere - so saying "Mods folder:
     * (unknown)" would be a sentence about a folder that does not exist. */
    lines.push(
      { text: "Mods installed from their own repositories.", color: C_FG },
      { text: "", color: C_FG },
      { text: modSourceLine(status.bundledCount, status.count, "installed"), color: C_FG },
      { text: "", color: C_FG },
      { text: "An installed mod's files are kept in this browser's storage, not in", color: C_FG },
      { text: "a folder, so there is no path to show. Each was checked against a", color: C_FG },
      { text: "digest before a byte of it was unpacked, and the mod manager names", color: C_FG },
      { text: "the repository and tag it came from.", color: C_FG },
      { text: "", color: C_FG },
      { text: "You can also give this browser a mods FOLDER, and use both.", color: C_DIM },
    );
  } else {
    lines.push(
      {
        text: status.kind === "picked" ? "Mods folder you chose:" : "Mods folder:",
        color: C_FG,
      },
      { text: `  ${status.dir ?? "(unknown)"}`, color: C_GOLD_TEXT },
      { text: "", color: C_FG },
      /* The folder count is always given, even at zero: "0 mods found in it." is TRUE
       * and reads as "this game has no mods" while others are listed one screen away.
       * A player with an empty folder needs to see that the FOLDER is the empty part. */
      { text: modSourceLine(status.bundledCount, status.count, "from this folder"), color: C_FG },
      ...(status.count === 0
        ? [{ text: "Nothing has been copied into it yet.", color: C_DIM }]
        : []),
      { text: "", color: C_FG },
      { text: "To add one, copy its folder in and restart. A mod folder holds", color: C_FG },
      { text: "manifest.json plus one .json per kind of record it changes -", color: C_FG },
      { text: "exactly the layout a bundled mod has.", color: C_FG },
      { text: "", color: C_FG },
      { text: "load-order.json in that folder is owned by an external mod", color: C_FG },
      { text: "manager: the ids it lists are loaded, in that order. Turning a", color: C_FG },
      { text: "mod on or off here overrides it for that mod.", color: C_FG },
    );
    if (status.kind === "picked") {
      lines.push(
        { text: "", color: C_FG },
        { text: "Your browser is not told where that folder is on disk, only its", color: C_DIM },
        { text: "name, so only the name can be shown here.", color: C_DIM },
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
              ? `${origin.count} installed from ${origin.count === 1 ? "its own repository" : "their own repositories"}.`
              : `${origin.count} from ${origin.dir ?? "another source"}.`,
          color: C_FG,
        },
        ...(origin.kind === "installed"
          ? [
              {
                /* Where they physically are, honestly: nobody put them anywhere. */
                text: "  Kept in this browser's storage, not in a folder - the mod",
                color: C_DIM,
              },
              { text: "  manager names the repository and tag each came from.", color: C_DIM },
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
  await showTextScreen(term, "Where mods come from", lines);
}

/**
 * The "could not be used" block, or nothing.
 *
 * Exported and pure because the CAP is the interesting part. This used to
 * `slice(0, 8)` and print nothing about the rest, so nine problems looked like
 * eight - a truncation that reads as completeness is worse than a long list, and it
 * hid exactly the case where a lot has gone wrong. The cap stays (a text screen has
 * one page and no scroll) and now says what it dropped.
 */
export function problemBlock(problems: readonly ModProblem[]): ScreenLine[] {
  if (problems.length === 0) return [];
  const CAP = 8;
  const out: ScreenLine[] = [
    { text: "", color: C_FG },
    { text: "Could not be used:", color: C_DANGER },
  ];
  for (const p of problems.slice(0, CAP)) {
    out.push({ text: `  ${p.id === null ? p.why : `${p.id}: ${p.why}`}`, color: C_DANGER });
  }
  if (problems.length > CAP) {
    const rest = problems.length - CAP;
    out.push({
      text: `  ...and ${rest} more (each mod's own are on its row in the Mods list)`,
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
  term: GlyphTerm,
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
      `Reconnect "${savedName}"`,
      "reconnect",
      C_WARN,
      "Your browser needs permission again before it will read that folder.",
    );
  }
  add(
    savedName === null ? "Choose a mods folder..." : "Choose a different folder...",
    "pick",
    C_FG,
    "A folder of mods, or one mod's own folder.",
  );
  if (savedName !== null) {
    add(
      `Stop using "${savedName}"`,
      "forget",
      C_DIM,
      "The bundled mods stay; nothing on your disk is touched.",
    );
  }
  add("What is this?", "about", C_DIM, "Where mods come from, and the folder layout.");

  for (;;) {
    const pick = await selectFromMenu(term, "Mods folder", items, "[ ESC to go back ]");
    if (pick === null) return false;
    const row = rows[pick];
    if (row === "about") {
      await showModSources(term, status, true);
      continue;
    }
    if (row === "pick") {
      const name = await picker.pick();
      if (name === null) return false; /* cancelled: not a failure, no message */
      await showTextScreen(term, "Mods folder", [
        { text: `Using "${name}".`, color: C_ENABLED },
        { text: "", color: C_FG },
        { text: "Reload to read it. Any mod in it appears in this list, off until", color: C_FG },
        { text: "you turn it on - the same as a bundled one.", color: C_FG },
      ]);
      return true;
    }
    if (row === "reconnect") {
      const ok = await picker.reconnect();
      await showTextScreen(term, "Mods folder", [
        ok
          ? { text: `Reconnected to "${savedName}".`, color: C_ENABLED }
          : { text: "Permission was not granted, so that folder stays unread.", color: C_DANGER },
        { text: "", color: C_FG },
        ok
          ? { text: "Reload to read it.", color: C_FG }
          : { text: "You can try again, or choose a different folder.", color: C_FG },
      ]);
      if (ok) return true;
      continue;
    }
    /* forget */
    await picker.forget();
    await showTextScreen(term, "Mods folder", [
      { text: `No longer using "${savedName}".`, color: C_FG },
      { text: "", color: C_FG },
      { text: "Nothing on your disk was changed. Reload to drop its mods.", color: C_FG },
    ]);
    return true;
  }
}

/**
 * Run the mod manager. Loops on the top list (mods + actions) until the user
 * leaves; if changes were made it offers to reload so they take effect.
 */
export async function runModManager(
  term: GlyphTerm,
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
      | "profiles"
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
     * so every install shifted them: `f) Install a mod...` became `g)` the
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
      profiles: "5",
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
    if (deps.modCatalogue) {
      addAction(
        catalog.length === 0 ? "Install a mod...  (start here)" : "Install a mod...",
        "download",
        C_ENABLED,
        "Pick one from the list; the game downloads and checks it for you.",
      );
      /* KEEPING A MOD IS A SEPARATE JOB FROM GETTING ONE, and it had no row.
       *
       * The browse screen can update a mod - its row says so - but it is called
       * "Install a mod", which is not where anyone looks for something they
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
        "Asks each installed mod's own repository whether there is a newer version.",
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
          ? "Already have a mod on disk? Point the game at its folder."
          : row.lapsed
            ? "Your browser needs permission again before it will read it."
            : "Choose another, reconnect, or stop using it.",
      );
    }
    // No pooled "Fixes & tweaks" row: a mod's patches live under that mod
    // (manageMod -> managePatches), because they arrive with it and cannot exist
    // without it.
    addAction(
      "View conflicts",
      "conflicts",
      C_FG,
      "Where two mods change the same thing, and which one wins.",
    );
    addAction(
      "Auto-sort load order...",
      "autosort",
      C_FG,
      "Work out an order from what the mods ask for. Your own moves are kept.",
    );
    addAction(
      "Profiles...",
      "profiles",
      C_FG,
      "Save this set of mods under a name, and switch between sets.",
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
        ? `Where mods come from...  ! ${orphans.length} ${orphans.length === 1 ? "problem" : "problems"}`
        : "Where mods come from...",
      "install",
      orphans.length > 0 ? C_DANGER : C_DIM,
      orphans.length > 0
        ? "A mod could not be read at all, so it has no row above."
        : diskStatus?.available === true
          ? "Your mods folder: path, contents, and anything unreadable."
          : deps.modFolder
            ? "The folder layout, and how one is read."
            : "Why this build has no mods folder.",
    );
    if (dirty) {
      addAction(
        "Apply changes and reload",
        "reload",
        C_WARN,
        "Nothing you changed is in effect until the game restarts.",
      );
    }
    addAction("Done", "done", C_DIM, "Close this and go back to the game.");

    // A live ?mods= override outranks the store for this session, so the boxes
    // below describe what is SAVED, not what is loaded. Say so; the row list is
    // too narrow to spell out both sets.
    const override = deps.urlModsOverride?.() ?? null;
    const footer = override
      ? dirty
        ? "[ ?mods= live; changes pending - Apply to reload; ESC ]"
        : "[ ?mods= override is live; boxes show the SAVED set; ESC ]"
      : dirty
        ? "[ Space on/off, Enter opens; Apply to reload; ESC = back ]"
        : catalog.length === 0
          ? /* An empty list with "Enter a mod to manage it" underneath is the
             * screen telling a player to do something there is nothing to do. */
            "[ No mods installed - Install a mod... to get one; ESC to go back ]"
          : "[ Space turns one on or off, Enter opens it; ESC to go back ]";
    const pick = await selectFromMenu(term, "Mods", items, footer, {
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
         * whole screen is this row, and "Install a mod..." alone does not answer
         * the question a player has, which is where these come from and whether
         * running one is safe. */
        if (rk?.kind === "download" && catalog.length === 0) {
          const w = term.size().cols - 1;
          return [
            { text: "You have no mods installed.", color: C_TITLE },
            { text: "", color: C_FG },
            ...wrapped(
              "That is the normal starting state - Neo Angband ships as " +
                "Angband 4.2.6 and nothing else, and every mod, including the " +
                "ones written here, is something you choose to add.",
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
              "Open this row for the list. The game holds no list of what a mod " +
                "contains - it asks each mod's own repository, so a mod can " +
                "release an update without waiting for a new version of the game.",
              w,
            ),
            { text: "", color: C_FG },
            ...wrapped(
              "On first install a mod is pinned to the repository it came from " +
                "and can only be updated from that same place. Nothing here " +
                "reviews a mod's code, including the recommended ones.",
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
          ? [{ text: `Mod ${i + 1} of ${total}`, color: C_DIM }, ...detail]
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
    } else if (rk.kind === "profiles") {
      if (await manageProfiles(term, deps)) dirty = true;
    } else if (rk.kind === "download") {
      if (deps.modBrowse) {
        const touched = await showModBrowse(term, {
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
      } else if (deps.modCatalogue) {
        const touched = await showModCatalogue(term, {
          ...deps.modCatalogue,
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

  if (dirty) {
    /* A newly-enabled tiles mod contributes Graphics rows and nothing else, so
     * say so here and open that screen after the reload. Without this the player
     * enables a tile mod, reloads, sees an unchanged ASCII map, and concludes the
     * mod is broken - which is what happened. */
    const newTiles = [...enabledTileModIds(deps)].some((id) => !tileModsAtEntry.has(id));
    const pick = await selectFromMenu(
      term,
      newTiles ? "Apply mod changes? (adds tile sets to Graphics)" : "Apply mod changes?",
      [
        {
          label: newTiles ? "Reload now, then pick a tile set" : "Reload now to apply",
          color: C_ENABLED,
        },
        { label: "Later (changes are saved; apply on next reload)", color: C_FG },
      ],
      "[ a/b or tap ]",
    );
    if (pick === 0) deps.requestReload(newTiles ? { showGraphics: true } : undefined);
  }
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
