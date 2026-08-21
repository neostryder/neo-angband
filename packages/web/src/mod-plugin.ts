/**
 * The mod plugin ABI: the one contract a mod's CODE is written against.
 *
 * Until this existed, every path by which a mod could supply code was a build-time
 * Vite `import.meta.glob` over `mods/<id>/hooks.ts` for behaviour and the same for
 * `trusted.ts` for system overrides. Both resolve when the app is BUILT, so a folder
 * on disk could contribute records and never a line of code, for first- or
 * third-party mods alike. Everything else the SDK does - add/replace/remove/merge/
 * field patches, provenance-aware conflicts, five capability-gated registry facades -
 * was already built and sitting behind that one gate. This module is the gate's
 * replacement.
 *
 * And it is now the ONLY shape. The bundled mods were rewritten onto it (their
 * source is `mods/<id>/plugin.ts`, still resolved by a Vite glob, but the same
 * ModPlugin a folder ships), so there is one contract rather than a first-party one
 * and a third-party one. That is what lets one source produce both the bundled mod
 * and the plugin.js in the mod's own repository - scripts/build-mod-plugins.mjs -
 * and it is why the hooks.ts signature is gone rather than kept as a second option.
 *
 * A mod that runs code ships `plugin.js`, an ES module beside its manifest.json,
 * default-exporting a ModPlugin. That is the ENTRY POINT, not the whole mod: a mod
 * is a folder, and it may hold as many scripts, images and data files as it likes.
 *
 *   mods/my-mod/
 *     manifest.json
 *     plugin.js        <- the entry point, default-exporting a ModPlugin
 *     lib/dice.js      <- more code; `import "./lib/dice.js"` from plugin.js
 *     monster.json     <- a record contribution, as before
 *     tiles/orc.png    <- an asset: `await ctx.assetUrl("tiles/orc.png")`
 *     data/spawns.json <- nested data, also an asset (ctx.assetUrl + fetch)
 *
 * Relative imports resolve on both front ends. On desktop that is free - the pack
 * is served from the shell's loopback origin. In a browser tab the folder has no
 * location at all, so the dependency graph is resolved and rewritten before the
 * import (mod-modules.ts); read that file's header for the two things it cannot do
 * (a cycle, and an extensionless specifier).
 *
 * WHY NO IMPORTS. The obvious design is to let plugin.js `import` from
 * "@rpgm-tools/neo-angband-core" the way a bundled mod's TypeScript does. It cannot: a bare
 * specifier does not resolve in a module fetched from a folder, and bundling core
 * into each plugin would give every plugin its own copy of the engine's
 * registries and singletons - two effect registries, two action registries,
 * mutations landing on objects the game is not looking at. An import map plus a
 * generated re-export shim would work, but it makes the ABI a list that has to be
 * kept in sync with itself, and it puts a CSP and browser-support question in the
 * middle of the critical path.
 *
 * So the host PASSES the engine in, and `ctx.core` is the live core namespace -
 * the same module instance the game itself is running on. That makes the ABI one
 * object rather than a list, gives a plugin the whole public API rather than a
 * curated slice of it, and works identically for a loopback URL on desktop, a
 * blob: URL from a browser directory picker, and a bundled module in dev.
 *
 * WHY THE SAME SHAPE FOR BOTH KINDS. hooks.ts and trusted.ts were two entry
 * points with two signatures for two halves of the same job: `hooks` folds
 * behaviour into core's ModHooks, `register` reaches the capability-gated
 * registries. A mod that wants both had to ship two files. One ModPlugin carries
 * both, either optional. (trusted.ts still exists for the AGENT system, which is a
 * different thing wearing a similar name; the sandboxed agent entry is sandbox.ts.)
 *
 * WHY THE VERSION IS DECLARED AND CHECKED. The API is explicitly unstable until
 * 1.0. That is a reason to fail LOUDLY, not a reason to skip the check: a plugin
 * written against api 1 and loaded by a host that cannot honour api 1 must be
 * refused with both numbers named, because the alternative is a mod that
 * half-works and a player who reports a game bug.
 *
 * It is NOT a reason to refuse everything the moment the number moves, which is
 * what an `!==` did until 2026-08-02. The host accepts a WINDOW - see
 * MOD_API_MIN for the two-release rule that makes the window mean something -
 * so a bump costs authors a release they have time to make, rather than taking
 * every mod offline on the day it ships.
 */

/* TYPE-ONLY import of core, deliberately. A mod's own source imports this module
 * for defineModPlugin and the context types, and gets built into a single-file
 * plugin.js; if this file pulled core in as a VALUE, the whole engine would be
 * bundled into every plugin - which is the exact duplication the host-passes-the-
 * engine design exists to avoid. The one function that needs the live namespace
 * lives in mod-context.ts, which no plugin imports. */
import type {
  AgentController,
  CoreRegistries,
  ModHooks,
  ModRegistryHost,
  GameState,
} from "@rpgm-tools/neo-angband-core";
/* Type-only, like every other import here: a mod's source imports this module,
 * and a value import would put the host's code in every plugin's bundle. */
import type { ModPrefs } from "./mod-prefs";
import type {
  HudOwnership,
  MenuPresenter,
  RegionDeclaration,
  ScreenPresenter,
  WorldFrameSink,
} from "@rpgm-tools/neo-angband-mod-sdk";

/** The renderer-neutral map snapshot a selected front end receives. */
export type { WorldFrame } from "@rpgm-tools/neo-angband-mod-sdk";

/**
 * The ABI version this host implements. Bump ONLY when an existing plugin would
 * misbehave under the new host - adding an optional field is not a bump; changing
 * what an existing call does, or removing anything, is.
 */
export const MOD_API_VERSION = 1;

/**
 * The OLDEST ABI this host still accepts. Everything in [MIN, VERSION] loads.
 *
 * WHY A WINDOW AND NOT AN EXACT MATCH. Until 2026-08-02 the check was
 * `declared !== MOD_API_VERSION`, so the day the host bumped to 2, every mod in
 * existence stopped loading - all at once, before any author had a chance to
 * react, for a change most of them were not affected by. The header used to call
 * that "the intended cost", and it is not a cost anyone chose to pay: it is what
 * falls out of comparing two integers with `!==`.
 *
 * THE RULE THAT MAKES THE WINDOW REAL, and it is a promise about behaviour, not
 * about this number: a host that accepts api N-1 must still HONOUR the api N-1
 * contract for those plugins. So a bump comes in two releases. The first ships
 * the new behaviour, keeps MIN where it is, keeps the old behaviour working for
 * plugins that declared the old number, and starts warning them. The second
 * raises MIN and deletes the old path. If a change genuinely cannot be
 * conditioned on the declared version, MIN moves with VERSION in one step - and
 * that is a decision to take deliberately, which is what having two constants
 * forces.
 *
 * `LoadedModPlugin.api` is the mechanism the first release needs: it carries what
 * each plugin DECLARED, so the host can branch on it. A window with no record of
 * who is in it would be a promise nothing could keep.
 */
export const MOD_API_MIN = 1;

/** Whether the host can load a plugin at `declared`, and what to say if not. */
export type ModApiVerdict =
  | { readonly ok: true; readonly deprecated: false }
  /** Loads, but is below the current ABI and will stop when MIN next moves. */
  | { readonly ok: true; readonly deprecated: true; readonly why: string }
  | { readonly ok: false; readonly why: string };

/**
 * Judge a declared ABI version against this host's window.
 *
 * The bounds are parameters rather than reads of the constants so a test can
 * drive a window this build does not have - which is the only way to exercise
 * the deprecation branch while MIN and VERSION are both 1, and therefore the
 * only way it is more than an untested claim on the day it first matters.
 */
export function modApiVerdict(
  declared: number,
  host: number = MOD_API_VERSION,
  min: number = MOD_API_MIN,
): ModApiVerdict {
  /* Both numbers, and which way round: "incompatible" alone sends the player to
   * the wrong place - a too-NEW mod needs a game update, a too-OLD one needs a
   * mod update, and only the pair of numbers says which. */
  if (declared > host) {
    return {
      ok: false,
      why: `targets mod API ${declared}; this build implements ${host} - the mod needs a newer game`,
    };
  }
  if (declared < min) {
    return {
      ok: false,
      why:
        `targets mod API ${declared}; this build implements ${host} and no longer ` +
        `supports anything below ${min} - the mod needs updating for this game`,
    };
  }
  if (declared < host) {
    return {
      ok: true,
      deprecated: true,
      why:
        `targets mod API ${declared} and this build implements ${host}; it is ` +
        `running on a compatibility path that will be removed - the mod should be ` +
        `rebuilt against ${host}`,
    };
  }
  return { ok: true, deprecated: false };
}

/** What the host hands a plugin. Frozen before it is passed. */
export interface ModPluginContext {
  /** The mod's own id, which is also its folder name. */
  readonly id: string;
  /** The ABI version the HOST implements (MOD_API_VERSION). */
  readonly api: number;
  /** The engine version, for a plugin that wants to adapt rather than refuse. */
  readonly engine: string;
  /**
   * THIS mod's resolved rule flags (`choices[flag] ?? rule.default` for every
   * rule its own manifest declares) - sliced per mod, never the whole map, so a
   * mod cannot read or act on another mod's toggles.
   */
  readonly flags: Readonly<Record<string, boolean>>;
  /**
   * The live core namespace: the same module instance the game runs on. This is
   * the engine API, entire - not a curated subset. See the header.
   */
  readonly core: ModCoreApi;
  /** The live game state, when there is one (absent during content composition). */
  readonly state?: GameState;
  /**
   * A URL for one of the mod's OWN files, by path relative to its folder -
   * `"tiles/orc.png"`, `"data/spawns.json"`, `"sound/hit.ogg"`. Null when the pack
   * has no such file, or when this front end cannot serve one.
   *
   * A function rather than a map of paths to URLs because the browser case has to
   * read the file to mint a URL for it, and building one for every asset of every
   * installed mod at boot would read the whole mods folder into memory to satisfy
   * the mods that ask for nothing. The URL stays valid for the session, and asking
   * twice returns the same one.
   *
   * Use it, rather than composing a path yourself: on desktop this is an http URL
   * under the shell's own server, in a browser tab it is a blob:, and a mod that
   * hard-codes either is a mod that runs on one of the two front ends.
   */
  readonly assetUrl: (path: string) => Promise<string | null>;
  /**
   * The mod's own record files, parsed, keyed WITHOUT the `.json` - so
   * `data["monster"]` for `monster.json`. The same objects the content composer
   * was handed.
   *
   * Here because a plugin frequently wants to read what its own pack declares (to
   * index it, to validate it, to drive behaviour from it) and the alternative was
   * fetching its own file back through assetUrl and re-parsing bytes the game had
   * already parsed. Empty for a plugin whose folder holds no record files.
   */
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * This mod's own preferences, kept OUTSIDE any character's save - the place
   * for what the PLAYER likes, where the save bag is the place for what happened
   * to a character. See mod-prefs.ts for why the two are different.
   *
   * Scoped to this mod, by the id it was loaded under.
   */
  readonly prefs: ModPrefs;
  /**
   * Whether this session's character was just CREATED, as opposed to loaded from
   * a save.
   *
   * A mod that seeds something at the start of a life needs this and cannot
   * derive it: turn 0 is not the answer (the game autosaves immediately after
   * birth, so a save loaded at turn 0 exists), and neither is an empty save bag
   * (a mod enabled mid-game has one too). Only the host knows which of startGame
   * and loadGame it called.
   */
  readonly newCharacter: boolean;
  /** Emit a diagnostic line; the host decides where it goes. */
  readonly log: (msg: string) => void;
  /**
   * Ticket #133's cloud-backup folder. Present only when this mod's manifest
   * declared the `backup:folder` capability AND this front end can pick a
   * folder at all; `undefined` otherwise, same shape `ctx.assetUrl` and
   * `ctx.prefs` use for "this concept exists, but sometimes there is nothing
   * behind it" - except here absence has two independent causes (no consent,
   * no platform support), and either one degrades to `undefined` rather than a
   * facade that throws on first use. Guard with `if (!ctx.backupFolder)
   * return;`, the same shape `rememberSettings` uses for `ctx.core.setPrefErrorPolicy`.
   *
   * See docs/modding/CLOUD_BACKUP_DESIGN.md for the full design and
   * docs/modding/MOD_SEAMS.md's "why a ctx field, not a sixth ModPlugin owner
   * seam" argument.
   */
  readonly backupFolder?: BackupFolder;
  /**
   * Panels of your own, drawn with real HTML rather than the character grid.
   *
   * Present only when your manifest declared `ui:panel.mount` and the player
   * consented to it; `undefined` otherwise, the shape `backupFolder` uses and
   * for the same reason - a facade that existed and threw on first use would put
   * the refusal at the worst possible moment. Guard with `if (!ctx.ui) return;`.
   *
   * WHAT THIS IS FOR, and what it is not. `regions()` gives you a rectangle of
   * the game's own character grid and it is the right answer for anything that
   * belongs on the same screen as the dungeon. This is for a mod whose screen is
   * a FORM - fields, lists, a table - which is a shape the grid cannot carry
   * without reimplementing a caret and a tab order inside a text terminal.
   *
   * THE HOST OWNS THE CONTAINER, you own its contents. The host places it,
   * stacks it, hands the keyboard to whatever inside it holds the caret, closes
   * it on Escape, and takes it down when the mod set changes. That is
   * management, not isolation - see `ModPanel.root`.
   *
   * See docs/modding/MOD_SEAMS.md section 4b for the whole contract, including
   * the two things that will surprise you: Escape is the player's and cannot be
   * taken, and a non-modal panel's container takes no pointer events.
   */
  readonly ui?: ModUi;
  /**
   * Install a CONTENT mod from the bytes of an archive.
   *
   * Present only when your manifest declared `mod:install` and the player
   * consented to it; `undefined` otherwise, so guard with
   * `if (!ctx.installMod) return;`.
   *
   * The bytes are a zip of a mod folder - `manifest.json` beside one JSON file
   * per record file, which is exactly what `ModProject.emit()` returns and what
   * `fflate`'s `zipSync` will pack for you. They go through the same door the
   * player's own zip import uses, so the archive is read under the same
   * ceilings, inspected against the same requirements, and pinned to the same
   * origin on first import.
   *
   * CONTENT ONLY. An archive that ships code, or whose manifest asks for any
   * capability, is refused by name. Adding records, patches and removals to a
   * player's library is what this is for; a mod that RUNS is something they
   * install through the Mods screen, where they read what it asks for first.
   *
   * AND INSTALLING IS NOT ENABLING. What you install lands switched off. The
   * player finds it on the Mods screen and turns it on themselves, and a mod
   * takes effect on reload, so nothing you install is in the game this turn.
   * Say so to them rather than letting them wonder why the monster they just
   * made is not in the dungeon.
   *
   * Re-installing your own output replaces it, provided the manifest declares
   * the same `repository` every time - the origin is pinned on the first import
   * and a mismatch is refused, so persist that string with your draft rather
   * than regenerating it.
   */
  readonly installMod?: (bytes: Uint8Array) => Promise<ModInstallOutcome>;
  /**
   * Put a content mod into THIS session only, so the player can try it now.
   *
   * Present only when your manifest declared `mod:session` and the player
   * consented to it; `undefined` otherwise, so guard with
   * `if (!ctx.loadModForSession) return;`.
   *
   * The bytes are the same zip `installMod` takes and are refused on the same
   * terms: content only, no capability requests, the same ceilings, the same
   * standards inspection, and the same origin pin against an installed copy of
   * that id. What changes is where the archive is kept and how long. It is held in
   * session storage instead of the library, it composes into the game on the next
   * reload without waiting to be switched on, and it is gone when the player closes
   * the game.
   *
   * A RELOAD IS STILL WHAT APPLIES IT. Content composes at load, so nothing you
   * stage is in the game this turn - the mod manager offers the reload on the way
   * out. Say that rather than letting the player wonder where their monster is.
   *
   * SAY WHAT "THIS SESSION" ACTUALLY MEANS, because a player will read it as "so
   * nothing can go wrong". The ARCHIVE is forgotten. The records were as real as
   * any other mod's while they were loaded, and a character that met them keeps
   * whatever they did to it - and next time, with the pack gone, the game will treat
   * that character's mod-owned monsters and items as belonging to something that is
   * not installed. Do not stage content under a character somebody is playing
   * seriously.
   *
   * `survivesReload` is false when the browser would not take the archive - a
   * private window with storage switched off, most often. The mod is loadable this
   * page and will NOT come back after the reload, which makes the reload pointless,
   * so tell the player to save the file and import it instead.
   */
  readonly loadModForSession?: (bytes: Uint8Array) => Promise<ModSessionOutcome>;
  /**
   * Conjure an item or a creature into the live game, for a mod that wants to
   * show the player the thing they just made.
   *
   * Present only when your manifest declared `debug:spawn` and the player
   * consented to it, and only while there is a game to conjure into; guard with
   * `if (!ctx.debug) return;`. Read `ModDebug` before using it: the first use in
   * a character asks the game's own debug question and marks the character
   * permanently, which is a thing to tell the player before they click your
   * button rather than after.
   */
  readonly debug?: ModDebug;
  /**
   * The BOUND content registries: every race, kind, feature, trap, store and
   * projection the game actually runs on, after this session's mods composed
   * their content and core bound it.
   *
   * WHY THE WHOLE THING RATHER THAN A SLICE. Two mods asked for this within a
   * day of each other and asked for different halves - the Borg needs races by
   * `ridx`, a tile pack needs races and object kinds with their `base`/`tval` and
   * provenance - so the curated version was already two fields behind on the day
   * it would have been written. `ctx.core` is the whole namespace for exactly
   * this reason (MOD_COMPATIBILITY.md decision 18: a curated list is the thing
   * that drifts), and the registries are the data half of the same argument.
   *
   * WHY IT IS NOT THE SAME AS `ctx.state`. `state` holds one level: the monsters
   * standing on it, the objects lying on it. That is enough to draw a frame and
   * not enough to answer a question about a creature that is merely REMEMBERED -
   * which is what a danger evaluator asks, because it tracks what it has seen
   * rather than only what it can see. There was no path from a plugin to the
   * registry behind an index, so every such question got a conservative default.
   *
   * MOD-ADDED CONTENT IS IN HERE ON THE SAME TERMS AS CORE'S. Binding runs after
   * composition and mods append, so a mod's monster is a `MonsterRace` at a real
   * `ridx` in this list, indistinguishable from one of core's except by the
   * `from` provenance field. A consumer that reads the registry therefore treats
   * modded and vanilla content identically without trying to, which is the
   * point: the alternative is every consumer keeping its own vanilla table and
   * silently ignoring everything a mod added.
   *
   * Absent during content composition, for the same reason `state` is absent
   * there: at that point this is what is being built. Guard with
   * `if (!ctx.registries) return;`.
   */
  readonly registries?: CoreRegistries;
}

/**
 * What a mod asks for when it wants a panel of its own on the page.
 *
 * A panel is a rectangle of REAL DOM, not a rectangle of the character grid -
 * that second thing is `regions()`, it is still there, and it is still the right
 * answer for a compass or a carried-weight readout. This is for the mod whose
 * screen is a form: a list with a scrollbar, a text field, a table the player
 * sorts. Building one of those out of `RegionSurface`'s seven methods is
 * possible and nobody enjoys the result.
 */
export interface ModPanelSpec {
  /**
   * A short name of your own - `"editor"`, `"preview"`. Namespaced by the host,
   * so the live panel is `my-mod:editor`, for the same reason a region's id is:
   * the names are what a fault report and a player both read.
   */
  readonly id: string;
  /**
   * Whether this panel takes the screen (`true`) or sits over it (`false`, the
   * default).
   *
   * A MODAL PANEL COVERS THE VIEWPORT AND SWALLOWS THE POINTER, and it is
   * focused on mount so the keyboard is yours immediately. That is what an
   * authoring tool wants and it is a real cost to the player, which is why it is
   * declared rather than inferred.
   *
   * A NON-MODAL PANEL'S CONTAINER TAKES NO POINTER EVENTS AT ALL. Style
   * `pointer-events: auto` onto the elements you actually want clickable, the
   * way the game's own touch bar does - otherwise an invisible full-viewport
   * container would eat every tap meant for the dungeon underneath it. It is
   * also not focused on mount, so the player keeps the keyboard until they put
   * the caret in something of yours.
   */
  readonly modal?: boolean;
  /**
   * What assistive technology should call this panel. Defaults to the live id,
   * which is better than nothing and worse than a sentence.
   *
   * Worth writing: a panel is the FIRST thing in this game a screen reader can
   * read, because everything else is pixels on a canvas.
   */
  readonly label?: string;
}

/** A mounted panel: where to build, and how to take it down. */
export interface ModPanel {
  /** The id as the host carries it: `${modId}:${declared}`. */
  readonly id: string;
  /**
   * Build here. A CLOSED shadow root on a container the host owns and positions.
   *
   * SHADOW, AND WHAT THAT IS FOR. Styles you put in here do not reach the game,
   * and the page's do not reach you, so a `#title` of yours cannot collide with
   * anything and a stylesheet of yours cannot restyle the game's own furniture
   * by accident. That is hygiene, and hygiene is all it is: it is NOT a sandbox
   * and must not be described as one. Your plugin already runs in the page's own
   * realm - see docs/modding/PLUGINS.md, "What a capability gates".
   */
  readonly root: ShadowRoot;
  /** False once this panel has been closed, by you, by the player, or by teardown. */
  readonly open: boolean;
  /**
   * Resolves when the panel closes, whoever closed it. Await it to know the
   * player is done, rather than keeping a callback for every way out.
   */
  readonly closed: Promise<void>;
  /** Take it down. Idempotent: closing a closed panel is not an error. */
  close(): void;
}

/**
 * `ctx.ui`: present only when this mod's manifest declared `ui:panel.mount` and
 * the player consented to it, `undefined` otherwise - the same shape
 * `ctx.backupFolder` uses, and guarded the same way (`if (!ctx.ui) return;`).
 */
export interface ModUi {
  /**
   * Mount a panel and return the handle. Throws with the reason when the spec is
   * unusable, when too many panels are already open, or when the front end has
   * no document to mount into - all three are author errors, and a facade that
   * returned a dead handle would hide them.
   */
  openPanel(spec: ModPanelSpec): ModPanel;
  /** THIS mod's open panels, topmost last. Never another mod's. */
  readonly openPanels: readonly string[];
}

/**
 * What came of handing the game a mod's bytes.
 *
 * A RESULT, NEVER A THROW. The caller is a mod that will be putting this in front
 * of a player, so every refusal is one whole sentence it can print without
 * knowing which refusal it is - the shape the host's own install paths use
 * (`InstallResult`), for the same reason.
 */
export type ModInstallOutcome =
  | {
      readonly ok: true;
      /** The id the mod is stored under, from its own manifest. */
      readonly id: string;
      /** The version it was recorded at. */
      readonly version: string;
    }
  | { readonly ok: false; readonly problem: string };

/**
 * What came of loading a mod for this session only.
 *
 * `ModInstallOutcome` plus one field, rather than a reuse of it, because the extra
 * field is the one thing a caller cannot find out for itself and must not assume:
 * whether the archive will still be there after the reload that applies it. A
 * browser with storage switched off takes the mod for this page and loses it on the
 * way back up, and a screen that said "reload to try it" in that case would be
 * sending the player round a loop that cannot finish.
 */
export type ModSessionOutcome =
  | {
      readonly ok: true;
      /** The id it will load under, from its own manifest. */
      readonly id: string;
      /** The version its manifest declares, or "unversioned". */
      readonly version: string;
      /** False when this browser would not hold the archive across the reload. */
      readonly survivesReload: boolean;
    }
  | { readonly ok: false; readonly problem: string };

/** What came of conjuring something into the live game. */
export type ModSpawnOutcome =
  | { readonly ok: true; /** What was placed, by the name the game knows it by. */ readonly what: string }
  | { readonly ok: false; readonly problem: string };

/**
 * `ctx.debug`: put an item or a creature into the game the player is playing.
 *
 * Present only when your manifest declared `debug:spawn` and the player
 * consented to it, `undefined` otherwise.
 *
 * WHAT IT COSTS THE PLAYER, because you should be the one who tells them rather
 * than the prompt. The first use in a character asks the game's own debug
 * question - the same two warning lines and the same confirmation `^A` asks -
 * and accepting marks the character permanently: it cannot be scored, and the
 * mark is written before anything is conjured, so there is no path where
 * something arrives in a character the player did not agree to spend. If they
 * decline, you get `{ ok: false }` and nothing happened.
 *
 * THE QUESTION IS ASKED ON THE GAME SCREEN, which one of your own modal panels
 * would be covering. So close your panel before the first spawn in a character,
 * or you will get a refusal saying so. Once the character is marked, later
 * spawns ask nothing and the panel does not matter.
 *
 * PLACEMENT IS THE GAME'S. An item is dropped at the player's feet and a
 * creature is scattered near them, both exactly as the debug commands do it.
 * There are no coordinates in this API on purpose: a mod that could name a grid
 * could put a monster inside a wall, and "does the thing I just wrote work" does
 * not depend on where it lands.
 */
export interface ModDebug {
  /**
   * Drop one item at the player's feet. Takes the kind's `name` - which is what
   * you know, if you just wrote it - or its index. Prefer the name: an index is a
   * fact about a registry, and the registry moved when another mod was enabled.
   */
  spawnObject(kind: number | string): Promise<ModSpawnOutcome>;
  /** Place one creature near the player, by name or by race index. */
  spawnMonster(race: number | string): Promise<ModSpawnOutcome>;
}

/**
 * Ticket #133's cloud-backup folder primitive. One instance is capable of
 * serving any number of consenting mods - see mod-backup.ts.
 */
export interface BackupFolder {
  /**
   * The remembered folder's display name, or null if none is chosen. Never
   * prompts - a query, like folderPermission's non-request path.
   */
  name(): Promise<string | null>;
  /**
   * Ask the player to choose (or replace) the folder. MUST be called from a
   * user gesture (browser tab) or a menu-selection continuation (desktop) -
   * see CLOUD_BACKUP_DESIGN.md §3. Null means the player cancelled, which is
   * not an error and must not be reported as one (mod-folder.ts's own rule).
   */
  choose(): Promise<string | null>;
  /** Forget the folder. write() becomes a silent no-op until choose() runs again. */
  forget(): Promise<void>;
  /**
   * Write one file into the chosen folder, creating it if absent. False -
   * never throws - if there is no folder, permission has lapsed, or the write
   * failed.
   */
  write(name: string, text: string): Promise<boolean>;
  /**
   * Replace this mod's "a save just landed" callback. There is exactly one
   * per mod; calling again replaces it, matching setPrefErrorPolicy's "last
   * call from hooks(ctx) wins" shape. `file` is a COMPLETE, already-encoded
   * transfer file, so the mod never touches save bytes directly.
   */
  onSave(fn: (file: { readonly name: string; readonly text: string }) => void): void;
}

/**
 * The engine surface, typed as core's own public module. Declared as an import
 * type rather than a hand-written list so it can never drift from what core
 * actually exports - the drift is the whole failure mode a curated list has.
 */
export type ModCoreApi = typeof import("@rpgm-tools/neo-angband-core");

/** A mod's code. Both members optional: a plugin may do either job, or both. */
export interface ModPlugin {
  /**
   * The ABI version this plugin was WRITTEN against. Required, and checked: a
   * mismatch refuses the plugin rather than running it hopefully.
   */
  readonly api: number;
  /**
   * Behaviour, folded into the single ModHooks core consults (core/mod/hooks.ts).
   * Called once per enabled mod, in load order. Return undefined to contribute
   * nothing - a mod whose every rule is switched off must leave core on its
   * faithful path, not on a path that happens to agree.
   */
  hooks?(ctx: ModPluginContext): ModHooks | undefined;
  /**
   * System overrides, through the capability-gated registry facade. Each facade
   * throws AgentCapabilityError unless the manifest declared the matching
   * `registry:<domain>` capability AND the player consented to it. Called once
   * after the game is booted; throwing aborts this plugin's install and is
   * surfaced, without taking the game or the other mods down.
   */
  register?(host: ModRegistryHost, ctx: ModPluginContext): void;
  /**
   * Rewrite this mod's OWN save bag when the mod's `saveSchema` has moved past
   * the schema the bag was written at.
   *
   * A bag is whatever JSON the mod chose to keep in the player's save
   * (`ctx.state.mods[id]`); core round-trips it verbatim and never reads it, so
   * core cannot migrate it and neither can the host - only the mod knows what its
   * own data means. `fromSchema` is what the bag was written at; return the same
   * data in the shape this version expects, and the host stamps the schema
   * forward (core's migrateModBag).
   *
   * Called at mod-load time, before `register()`, so a plugin can rely on its bag
   * being current by the time any of its other code runs. Optional: a mod that
   * never changes its data shape, or would rather branch on `bag.schema` itself,
   * simply omits it. Omitting it while HAVING bumped saveSchema is reported to
   * the player - the old data is kept exactly as it was rather than being
   * relabelled as current.
   *
   * Throwing leaves the old bag untouched and reports; a half-applied migration
   * written back over the only copy is worse than no migration at all.
   */
  migrateBag?(data: unknown, fromSchema: number, ctx: ModPluginContext): unknown;
  /**
   * An AUTOPLAYER: return a controller and the host binds it as the game's
   * command provider, so the mod plays the game. Return undefined to decline -
   * a mod whose own autoplay toggle is off must leave the human at the keyboard.
   *
   * A first-class member rather than a `ctx.core.installController(...)` call
   * from register(), for one reason that is not style: installController
   * REPLACES state.nextCommand and hands back an uninstall that restores
   * whatever was there before (core/agent/controller.ts). Two mods doing that
   * from register() both succeed, the second one silently wins, and unwinding
   * them out of order restores the wrong provider. Going through the host means
   * exactly one controller exists, the host knows whose it is, and it can refuse
   * the second by name instead of losing the first.
   *
   * Turning the autoplayer off is turning the MOD off: a mod toggle re-composes
   * the page (requestReload), and a controller that is not installed on the way
   * back up is not installed. The host also keeps the AgentSession and RELEASES
   * it on the way out, right after the plugins' `uninstall` and before the save
   * (mod-teardown.ts) - so the bytes written for this character are taken with
   * state.nextCommand already back in the human's hands.
   *
   * Called once, AFTER register(), so a mod can register the commands its own
   * controller will then drive.
   *
   * Requires the `command:add` capability in the manifest (a controller that
   * cannot act is not a controller); installController throws
   * AgentCapabilityError without it, which is reported as this mod's fault and
   * leaves the game playable by hand. Determinism is NOT declared here - the
   * manifest's `nondeterministic` flag already advances the save's determinism
   * ratchet when the mod is enabled, and a second place to say it is a second
   * place for it to disagree.
   */
  controller?(ctx: ModPluginContext): AgentController | undefined;
  /**
   * Replace the map renderer with a sink for the live `WorldFrame` stream.
   *
   * The host selects exactly one declaration before invoking it: the LAST
   * enabled mod in load order wins. Earlier frontends are not constructed, so
   * they cannot mount UI or retain game data after losing. Return `undefined`
   * to decline, which leaves the faithful glyph renderer active. The sink gets
   * a frozen, structurally owned snapshot on every real map repaint; it may
   * retain that frame, but cannot retain or mutate the player's live grid.
   *
   * Requires the `display:replace` capability in the manifest, and the player's
   * consent to it. Not a `registry:` domain, and not covered by `registry:*`: a
   * registry grant overrides one named game system among many, while this one
   * means everything the player sees of the dungeon is drawn by the mod. A mod
   * that declares this member without asking is reported by name and the game
   * keeps drawing.
   *
   * CORE'S OWN RENDERER DECLARES THIS TOO, as candidate zero of the same list
   * (frontend-runtime.ts). It is not a fallback the selection falls through to;
   * it is what wins when no mod outranks it, and what a faulting replacement
   * hands the map back to.
   *
   * This is a front-end seam, not a registry capability. It replaces display
   * only; input remains at the host's one input door until a later input-binding
   * seam lets a replacement front end submit intents.
   */
  frontend?(ctx: ModPluginContext): WorldFrameSink | undefined;
  /**
   * Draw one or more named parts of the HUD instead of the game: the message
   * line, the vitals, the status line.
   *
   * The companion to `frontend`, and separate from it because they are
   * separately ownable. `frontend` is the dungeon; this is everything around it,
   * and OWNERSHIP IS PER REGION. Return a sink for each region you are taking
   * and omit the rest - they stay the game's and keep being drawn. `undefined`
   * or `{}` declines everything, which is the right answer on a host you cannot
   * draw on; throwing costs you your regions and is reported as your fault.
   *
   * Each region needs its own `ui:<region>.replace` capability
   * ("ui:sidebar.replace"), or the wildcard "ui:*.replace" for all three. THE
   * CAPABILITY IS THE CLAIM: the host selects each region's owner from the
   * manifests before invoking anybody, so a losing candidate is never
   * constructed and cannot mount UI it will never draw into. Two consequences
   * follow. A sink for a region you did not ask for is dropped and reported. And
   * a region you won but then declined goes to the GAME, not to the next
   * claimant - so ask for the regions you actually draw.
   *
   * Your sink gets a frozen, structurally owned snapshot on every HUD repaint:
   * your own section, plus the whole frame, because `targeting` and `layout`
   * change what a section means. Read `entry.key` (`hp`, `depth`, `state` - the
   * engine's own handler names) and `run.color` (its COLOUR_* attribute); those
   * are the semantic half. `entry.screen` and `run.css` are the faithful
   * terminal's own projection, there for a text-mode replacement and ignorable
   * by anything else. `section.region.pixels` is where to put a canvas.
   *
   * CORE'S OWN TERMINAL DECLARES THIS TOO, as candidate zero of the same list
   * (hud-runtime.ts), holding whichever regions no mod outranks it for - and it
   * is what a faulting region is handed back to, that region alone.
   */
  hud?(ctx: ModPluginContext): HudOwnership | undefined;
  /**
   * Ask the game's questions your own way: a console-RPG frame, a radial command
   * dial, a floating window with a detail pane.
   *
   * The third owner seam, after `frontend` (the dungeon) and `hud` (everything
   * drawn around it). Return a presenter, or `undefined` to decline - which is
   * the right answer on a host you cannot draw on. Gated by the single
   * `ui:menu.replace` capability, or the wildcard "ui:*.replace".
   *
   * ONE GRANT, AND THE FINE CHOICE IS PER QUESTION. There are ~50 menus in the
   * game; a capability per menu id would be a consent list nobody could read. So
   * your presenter is offered EVERY menu and returns `undefined` from `ask` for
   * the ones you have no better way to present - a dial for the six command
   * verbs has no opinion about the mod manager's thirty-row list, and the game
   * asks those in its own way. Declining costs nothing and is expected.
   *
   * A MENU IS ASKED, NOT DRAWN, which is what makes this different from `hud`:
   * taking a question means taking its input too, and you resolve it by naming a
   * choice's stable `id` - never an index, because an index is a fact about a
   * layout and yours is not the game's. Read `choice.semantic` for what a choice
   * MEANS (`{kind, ref}`, independent of its wording), and `question.id` to
   * recognise which question you are being asked.
   *
   * Throwing costs you the seam for the rest of the session, on every menu and
   * not just the one - unlike `hud`, where a fault costs one region. A presenter
   * that throws on one question generally throws on all of them, and reporting
   * that once beats reporting it every time the player opens anything.
   */
  menu?(ctx: ModPluginContext): MenuPresenter | undefined;
  /**
   * Show the game's full screens your own way: an inventory of sprite tiles, a
   * character sheet as a Dragon-Quest side panel, a knowledge browser with tabs.
   *
   * The fourth owner seam, and the one that reaches the CONTENT rather than the
   * frame. A screen arrives as a `ScreenView`: blocks, and a list is a `table`
   * with columns that have stable keys, so you read `row.cells.name` instead of
   * parsing `"a) Potion of Cure Light Wounds    12.0 lb"`. Rows carry the same
   * `semantic` a menu choice does, so an item is the same thing to you whether the
   * game is listing it or asking you to pick one. Gated by the single
   * `ui:screen.replace` capability, or the wildcard "ui:*.replace".
   *
   * ONE GRANT, THE FINE CHOICE PER SCREEN, exactly as `menu` does it: your
   * presenter is offered every screen and returns `undefined` from `show` for the
   * ones you have no better way to present. Declining costs nothing.
   *
   * NOT EVERY SCREEN HAS A MODEL YET. `MODELLED_SCREENS` names the ones that do;
   * the rest arrive under the shared id `core:text` with a single `lines` block of
   * pre-wrapped rows, which is enough to reskin a frame and not enough to
   * reimagine a listing. Check `view.id` rather than assuming.
   *
   * A SCREEN IS DISMISSED, NOT ANSWERED, which is why `show` declines by returning
   * `undefined` synchronously and takes the screen by returning `{ dismissed }` -
   * there is no answer value left to decline with once the promise means "the
   * player closed it". Resolve `dismissed` when they are done.
   *
   * Throwing costs you the seam for the rest of the session, as `menu` does. If
   * you throw while a screen is OPEN the game shows it again itself, because a
   * player left staring at a dead overlay has no way out.
   */
  screen?(ctx: ModPluginContext): ScreenPresenter | undefined;
  /**
   * Put furniture of your OWN on the screen: a carried-weight readout, a compass,
   * a threat meter - a rectangle beside the game's, not instead of it.
   *
   * THE FIFTH OWNER SEAM, AND THE ONLY ONE NOBODY WINS. The other four each
   * answer "who gets it", because the map, the HUD, the menu seam and the screen
   * seam are each ONE THING and two mods cannot both have it. A region is not one
   * thing. Two mods that both declare a region are not in contention - they are
   * two pieces of furniture, and they coexist, each at its own band, in load
   * order. "Last load wins" appears here only in its ordinary form: within a
   * band, the later-loaded region draws on top.
   *
   * Requires `ui:region.create`. Note that `ui:*.replace` does NOT grant it: the
   * wildcard ranges over which of the GAME's regions changes hands, and adding
   * one of your own is a different sentence for the player to agree to.
   *
   * THE UNIT OF FAILURE IS THE DECLARATION, not the mod. A rectangle with no
   * `paint`, a band that does not exist, a duplicate name, a `paint` that throws
   * on its first frame - each costs exactly that one region, is reported once
   * with the fix in the sentence, and leaves your others and everyone else's
   * alone. A region that faults is WITHDRAWN rather than left as an empty
   * rectangle, because a region left in the stack is a phantom occluder and a
   * replacement front end would stand its canvas down for something that has
   * drawn nothing since the first frame.
   *
   * Your id is namespaced: declare `"carried"` and the live stack carries
   * `my-mod:carried`. That is a correctness rule rather than tidiness - a mod
   * naming its region `map` would otherwise put a second `map` in the stack, and
   * `occludersOf` answers about the FIRST match.
   *
   * The `system` layer is reserved to the game, so the mod manager and a fault
   * report can always draw ABOVE a mod - including above one that has gone wrong.
   */
  regions?(ctx: ModPluginContext): readonly RegionDeclaration[] | undefined;
  /**
   * Teardown, called when the mod set changes and the page is about to re-compose.
   *
   * The re-compose is what actually removes the mod - a plugin that is not
   * installed on the way back up is not installed - so this is NOT the hook that
   * unregisters your effects or rolls back your hooks; the fresh page has neither.
   * What it is, is your last moment on a live `state`: the host runs it BEFORE it
   * saves the character (mod-teardown.ts), so anything you would not want written
   * into the save, you undo here.
   *
   * Called once per page, in load order, ahead of the autoplayer slot being
   * released. Throwing loses your teardown and nothing else - it is reported on
   * your mod's row and the reload still happens.
   */
  uninstall?(): void;
}

/** Identity helper, so a plugin's default export gets checked at author time. */
export function defineModPlugin(plugin: ModPlugin): ModPlugin {
  return plugin;
}


/**
 * What is wrong with a candidate default export, or null when it is usable.
 *
 * Returns a message rather than throwing, because this runs over PLAYER-SUPPLIED
 * files: a hand-edited or half-downloaded plugin must become one line the mod
 * manager can show, never a boot failure. Same reasoning as z-file.c returning
 * NULL instead of dying.
 */
export function validateModPlugin(
  candidate: unknown,
  hostApi = MOD_API_VERSION,
  minApi = MOD_API_MIN,
): string | null {
  if (candidate === null || candidate === undefined) {
    return "plugin.js has no default export";
  }
  if (typeof candidate !== "object" && typeof candidate !== "function") {
    return `plugin.js default-exports a ${typeof candidate}, not a plugin object`;
  }
  const p = candidate as Partial<ModPlugin>;
  if (typeof p.api !== "number" || !Number.isInteger(p.api)) {
    return `plugin.js does not declare an integer "api" version (this host implements ${hostApi})`;
  }
  /* The window, not an equality - and the same window the manifest's `modApi` is
   * judged against, from the same function, because two copies of "which ABIs
   * does this host take" is the pair that drifts apart at the first bump. A
   * deprecated-but-accepted plugin is NOT an error here; the loader reports it. */
  const verdict = modApiVerdict(p.api, hostApi, minApi);
  if (!verdict.ok) return `plugin.js ${verdict.why}`;
  if (p.hooks !== undefined && typeof p.hooks !== "function") return "plugin.js: hooks is not a function";
  if (p.register !== undefined && typeof p.register !== "function") {
    return "plugin.js: register is not a function";
  }
  if (p.migrateBag !== undefined && typeof p.migrateBag !== "function") {
    return "plugin.js: migrateBag is not a function";
  }
  if (p.controller !== undefined && typeof p.controller !== "function") {
    return "plugin.js: controller is not a function";
  }
  if (p.frontend !== undefined && typeof p.frontend !== "function") {
    return "plugin.js: frontend is not a function";
  }
  if (p.hud !== undefined && typeof p.hud !== "function") {
    return "plugin.js: hud is not a function";
  }
  if (p.menu !== undefined && typeof p.menu !== "function") {
    return "plugin.js: menu is not a function";
  }
  if (p.screen !== undefined && typeof p.screen !== "function") {
    return "plugin.js: screen is not a function";
  }
  if (p.regions !== undefined && typeof p.regions !== "function") {
    return "plugin.js: regions is not a function";
  }
  if (p.uninstall !== undefined && typeof p.uninstall !== "function") {
    return "plugin.js: uninstall is not a function";
  }
  if (
    p.hooks === undefined &&
    p.register === undefined &&
    p.controller === undefined &&
    p.frontend === undefined &&
    p.hud === undefined &&
    p.menu === undefined &&
    p.screen === undefined &&
    p.regions === undefined
  ) {
    /* A plugin that does none of these is almost certainly a mistake - a mod
     * with no code at all simply ships no plugin.js - and saying so beats
     * loading it and having nothing happen. `controller` counts because an
     * autoplayer is a mod whose entire contribution is playing the game: the
     * Borg registers nothing and hooks nothing. `regions` counts for the same
     * reason and was missing for the same reason: a mod whose entire
     * contribution is a carried-weight readout beside the map declares nothing
     * else, and until #267 both validators refused it as doing nothing - so the
     * seam existed for every mod except the one it was built for. Deliberately
     * still NOT widened to include migrateBag: a plugin whose only member is a bag migrator
     * changes nothing about the game and would silently do nothing on a fresh
     * save, which is the same mistake wearing a newer field name. */
    return "plugin.js declares no hooks, register, controller, frontend, hud, menu, screen or regions, so it would do nothing";
  }
  return null;
}
