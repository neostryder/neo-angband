/// <reference lib="dom" />
import type {
  AgentCommand, AgentController, AgentEventSubscription, BlastAreaResult, BookItemResult,
  CoreSnapshot, GridInspectResult, InputToken, InspectResult, ItemRulesResult,
  ItemTesterResult, LoadoutItemRef, LoadoutSlotsResult, SpellInspectResult,
  TerrainCatalogueResult, TileActionsResult, TravelPathResult,
} from "../agent/index.js";
import type { KnownLevelView } from "../agent/known-level.js";
import type { GameState } from "../game/context.js";
import type { CoreRegistries } from "../session/boot.js";
import type {
  ComposedRecords, NetProblemCode, NetRequest, PackCompat, ScreenRegions, ScreenView,
  WorldFrame,
} from "@rpgm-tools/neo-angband-mod-sdk";

export type KnowledgeCategoryId = "objects" | "runes" | "artifacts" | "egos" | "monsters" | "features" | "traps" | "shapes";

/** Whole-cell responsive geometry requested by a display-oriented mod. */
export interface ModDisplayGridRequest {
  readonly cellHeight: number;
  readonly minCols: number;
  readonly minRows: number;
  readonly snapViewportToEven: boolean;
}

/** A cave-space window for the full-level map modal. */
export interface ModMapView {
  readonly origin: {
    readonly x: number;
    readonly y: number;
  };
  readonly size: {
    readonly width: number;
    readonly height: number;
  };
}

/** Current display geometry, copied on every read. */
export interface ModDisplaySnapshot {
  /** The CSS-pixel rectangle the terminal was measured against. */
  readonly surface?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /**
   * "store" covers a shop screen: it renders over the same play viewport as
   * "play" (a shop is not the level-map modal), but a display-oriented mod
   * needs to tell the two apart so an overlay meant for ordinary play (a
   * responsive status sidebar, for one) can hide itself over a shop's own
   * item listing instead of painting across it.
   *
   * "modal" covers every OTHER full-screen takeover core's own modalDepth
   * already tracks - the Options Menu, an item-selection screen, the target
   * loop, and anything else that hides tiled subwindow panels (#248). A
   * display-oriented overlay should hide here too, for the same reason it
   * hides over "store": nothing of the ordinary play view is left to overlay.
   */
  readonly mode: "play" | "map" | "store" | "modal";
  readonly grid: {
    readonly cols: number;
    readonly rows: number;
    readonly cellWidth: number;
    readonly cellHeight: number;
  };
  readonly viewport: {
    readonly origin: {
      readonly x: number;
      readonly y: number;
    };
    readonly size: {
      readonly width: number;
      readonly height: number;
    };
    readonly screenOrigin: {
      readonly x: number;
      readonly y: number;
    };
  };
  readonly level: {
    readonly width: number;
    readonly height: number;
  };
  readonly layout: "left" | "top" | "none";
  readonly regions: ScreenRegions;
}

/**
 * Narrow access to the web shell's display geometry.
 *
 * It contains no bindings, zoom steps, gesture interpretation, persistence, or
 * animation. A mod supplies those policies and uses this surface to apply the
 * resulting whole-cell grid, camera, map window, sidebar reservation, tile
 * sampling choice, and (with the separately consented display:filter capability)
 * a post-processing filter on the terminal canvas or game panels.
 */
export interface ModDisplay {
  snapshot(): ModDisplaySnapshot;
  /** Subscribe ahead of the shell's ordinary and modal key owners. */
  onKey(listener: (event: KeyboardEvent) => void): () => void;
  setGrid(request: ModDisplayGridRequest | null): void;
  getGrid(): ModDisplayGridRequest | null;
  setCamera(origin: {
    readonly x: number;
    readonly y: number;
  } | null): void;
  getCamera(): {
    readonly x: number;
    readonly y: number;
  } | null;
  setMapView(view: ModMapView | null): void;
  getMapView(): ModMapView | null;
  setSidebarExtent(extent: {
    readonly columns: number;
    readonly topRows: number;
  } | null): void;
  getSidebarExtent(): {
    readonly columns: number;
    readonly topRows: number;
  } | null;
  /** Reserve whole cells beside the main map for mod-owned controls. */
  setMapMargin?(margin: {
    readonly edge: "top" | "right" | "bottom" | "left";
    readonly cells: number;
  } | null): void;
  getMapMargin?(): {
    readonly edge: "top" | "right" | "bottom" | "left";
    readonly cells: number;
  } | null;
  setTileScaling(mode: "auto" | "crisp" | null): void;
  getTileScaling(): "auto" | "crisp";
  /** Choose the full-detail map picture instead of the compressed ASCII miniature. */
  setFullMapOverview(enabled: boolean | null): void;
  getFullMapOverview(): boolean;
  /** Show a trailing ellipsis for store item names that exceed their column. */
  setStoreItemNameEllipsis(enabled: boolean): void;
  /** Show the selected store item's full description on the message line. */
  setStoreSelectionDescription(enabled: boolean): void;
  /** Itemize the inventory subwindow's quiver rows by name instead of a capacity summary. */
  setQuiverItemization(enabled: boolean): void;
  /**
   * Add a one-line colour key to the visible-monster list ('[') and its
   * passive subwindow, naming what monsterListEntryLineColor's row colours
   * mean (violet a unique, red a monster whose native level is above the
   * current dungeon depth, white everything else). Off leaves both screens
   * exactly as upstream draws them.
   */
  setMonsterListColorKey(enabled: boolean): void;
  /** Apply a CSS filter to the canvas or the game's panels; null clears both. */
  setVisualFilter(filter: string | null, options?: {
    readonly scope?: "canvas" | "game";
  }): void;
  getVisualFilter(): {
    readonly filter: string;
    readonly scope: "canvas" | "game";
  } | null;
  /**
   * Repaint the window chrome around the panels (title bars, tabs, buttons,
   * dividers and drop guides) under `display:filter`; null puts back the
   * game's own colours and font. Each key is optional and an unknown key or a
   * bad value throws (chrome-theme.ts).
   */
  setChromeTheme?(theme: ChromeTheme | null): void;
  getChromeTheme?(): ChromeTheme | null;
  /**
   * Clear the text terminals to `color` instead of the game's black, under
   * `display:filter`. `scope` is "subwindows" (the default) or "all", which adds
   * the main terminal. Only the ground changes; every explicit cell background
   * and every text colour stays the game's. null restores the game's ground.
   */
  setTerminalGround?(ground: {
    readonly color: string;
    readonly scope?: TerminalGroundScope;
  } | null): void;
  getTerminalGround?(): TerminalGround | null;
  repaint(): void;
}

/**
 * One subwindow panel's identity and live geometry (neo-angband#241) - the
 * main view is never one of these; use `display` for it.
 */
export interface ModSubwindowInfo {
  readonly id: string;
  readonly label: string;
  /** This panel's body, in CSS pixels, for hit-testing a pointer event against it. */
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Whether this panel currently holds DOM focus (the player clicked into it). */
  readonly focused: boolean;
  readonly grid: {
    readonly cols: number;
    readonly rows: number;
    readonly cellWidth: number;
    readonly cellHeight: number;
  };
}

/** A small control a mod adds to one subwindow panel's title bar, beside its close button. */
export interface ModSubwindowControl {
  /** A short glyph or label drawn on the control itself - kept to a character or two. */
  readonly glyph: string;
  /** Hover / accessible name. */
  readonly title?: string;
  onActivate(): void;
}

/**
 * Per-subwindow-panel geometry and chrome (neo-angband#241), for a mod
 * implementing its own zoom gesture the way `display` lets one implement the
 * main view's - `ctx.display.onKey`/a mod's own `window` wheel listener still
 * drive it; this only exposes what panels exist and lets a gesture apply to
 * one of them instead of the main view.
 *
 * Absent during content composition, and on a front end with no subwindow
 * shell. Entirely ungated, on the same reasoning `display`'s own geometry
 * methods are: in-process plugin code already holds the document, so this is
 * a typed door onto what a mod could otherwise only reach by guessing at the
 * shell's own DOM structure, not a boundary being withheld.
 */
export interface ModSubwindows {
  /** Every currently visible panel. */
  list(): readonly ModSubwindowInfo[];
  /** Apply new whole-cell geometry to one panel, or null to return it to its default. */
  setGrid(id: string, request: ModDisplayGridRequest | null): void;
  /**
   * Add (or replace) this mod's control in a panel's title bar, keyed by
   * `key` so more than one (e.g. "-" and "+") can coexist. Returns an
   * unregister function.
   */
  addControl(id: string, key: string, control: ModSubwindowControl): () => void;
  /**
   * Register (or replace) a named block of this mod's own state in the
   * subwindow pref-file export/import (neo-angband#262) - a per-panel zoom
   * level a mod maintains outside core's own tiling state, say. `serialize`
   * returns this block's current text, or null to leave it out of a dump
   * entirely; `parse` is its inverse and returns null for anything
   * malformed; `apply` is called only with a value `parse` itself accepted,
   * never with anything it rejected. Returns an unregister function.
   */
  registerPrefBlock<T>(name: string, block: {
    serialize(): string | null;
    parse(text: string): T | null;
    apply(value: T): void;
  }): () => void;
}

/**
 * Live monster-tile lookup and paint over the currently active graphics pack
 * (neo-angband#256), for a mod drawing its own monster portrait outside the
 * dungeon grid - the same terrain-then-foreground blit the map's own render
 * loop uses, reachable without a canvas of the shell's own.
 *
 * Absent during content composition, like `display` and `subwindows`, and
 * entirely ungated for the same reason theirs is: this is read-only art
 * already fetched into the page (the active pack's own images), not a
 * capability over the game or the platform.
 */
export interface ModTiles {
  /** True when a graphics/tileset mode, rather than ASCII, is the current display mode. */
  readonly active: boolean;
  /**
   * Whether the active pack assigns a tile to this monster race (core's
   * `tileForMonster`). False in ASCII mode, and false for a race the pack has
   * never heard of - the caller's cue to keep its own ASCII glyph instead.
   */
  hasMonsterTile(ridx: number): boolean;
  /**
   * Paint a monster race's tile art onto a 2D canvas context at (dx, dy),
   * scaled to (dw, dh), composited over a neutral floor tile exactly as the
   * dungeon view draws a monster standing on open ground. Returns true when
   * art was drawn; false (ASCII mode, no tile for this race, or its art has
   * not finished loading yet) means the caller should keep its ASCII glyph.
   */
  drawMonster(ctx: CanvasRenderingContext2D, ridx: number, dx: number, dy: number, dw: number, dh: number): boolean;
}

/** One binding the calling mod owns in the current keyset. */
export interface ModKeymapBinding {
  readonly trigger: string;
  readonly action: string;
}

/** A consented door to the calling mod's live user keymaps in the current keyset. */
export interface ModKeymaps {
  /** True only for a valid trigger that has no existing keymap in this keyset. */
  isBindableTriggerKey(trigger: string): boolean;
  /** Bind an unused trigger, claim it for this mod, persist it, and report success. */
  bind(trigger: string, action: string): boolean;
  /** List only bindings this mod owns, never the player's or another mod's. */
  entries(): readonly ModKeymapBinding[];
  /** Replace this mod's binding, persist it, and report success. */
  rebind(trigger: string, action: string): boolean;
  /** Remove this mod's binding, persist it, and report success. */
  remove(trigger: string): boolean;
}

/**
 * neo-angband#171: a plugin's own live per-character storage - the save bag
 * `migrateBag` migrates, read and written during play rather than only
 * rewritten at mod-load time.
 *
 * `migrateBag` gave a mod a way to bring an OLD bag forward when its schema
 * changed, but nothing to write a NEW one during play. A mod that wanted to
 * remember something per character had no seam for that and approximated a
 * save key instead - name, race, class, birth stats - and kept it in
 * `ctx.prefs`, which is install-wide, not per-character, and collides between
 * two characters that happen to match on all of those. This is the missing
 * write seam, keyed to the actual save rather than to a fingerprint of it.
 *
 * SCOPED BY MOD ID, exactly like `ctx.prefs`: the id a mod gets is the id it
 * was loaded under, so no mod can read or write another mod's storage by
 * passing a different one.
 *
 * ENTIRELY UNGATED, like `ctx.prefs`: no capability changes what a mod's own
 * bag holds, only whether there is a live character to hold one for at all.
 */
export interface ModCharacterStore {
  /**
   * This mod's own data on the CURRENT character's save, or null when it has
   * never written one this life - a fresh character, or a mod enabled
   * mid-game that has not written yet. Read fresh every call, never cached.
   */
  get(): unknown;
  /**
   * Replace this mod's own data on the current character's save. Stamped with
   * whatever `saveSchema` this mod's manifest currently declares (0 when it
   * declares none) - the same number `migrateBag` reads back on a later load,
   * so a mod that bumps `saveSchema` after writing here still gets a coherent
   * migration rather than data silently mismarked as already current.
   *
   * Passing null or undefined clears it, the same convention `ctx.prefs.set`
   * uses.
   */
  set(value: unknown): void;
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
   * THIS mod's numeric settings from its manifest's `settings`, as the player set
   * them on the Mods screen. Present only when the manifest declares at least one.
   */
  readonly settings?: ModSettingsRead;
  /**
   * The live core namespace: the same module instance the game runs on. This is
   * the engine API, entire - not a curated subset. See the header.
   */
  readonly core: ModCoreApi;
  /**
   * The mod SDK's public barrel: the authoring stack, handed in the way `core`
   * is handed in.
   *
   * WHAT IS BEHIND IT. Everything a tool needs to draft a record against the
   * game's real content rather than against a fixture. `RECORD_BLUEPRINTS`,
   * `BLUEPRINT_FILES` and `blueprintFor` carry every field's measured shape,
   * type set and range; `fieldUsage` and `requiredFields` say how common a field
   * is; `templateRecord` and `draftRecord` fill a new record with typical values;
   * `peersFor` builds the comparable-records table; `suggestFields` proposes a
   * value with the sentence explaining it; `checkRecords` and `COMPANION_RULES`
   * validate at the three levels the running game uses; `ModProject` and
   * `modProject` assemble and emit the mod itself.
   *
   * ALWAYS PRESENT, unlike `registries` and `composedRecords`. These are pure
   * functions over data the caller supplies, so there is no boot state they wait
   * for and no moment at which the honest answer is absence.
   *
   * NO CAPABILITY GATES IT, and that is the same argument `registries` and `core`
   * already settle rather than a new one. Nothing here reads game state, nothing
   * here mutates a registry, and every name is already reachable to anybody who
   * can install the published npm package. See capability-gate-reach.test.ts for
   * what a `registry:*` grant does and does not buy.
   *
   * WHY THE WHOLE BARREL rather than a curated subset: decision 18's argument
   * unchanged, which is that a curated list is the thing that drifts. The barrel
   * is already a considered surface - `applyFieldPolicy` is deliberately left out
   * of the SDK's index.ts and says so there - and it is watched by the same kind
   * of ratchet `ctx.core` has (packages/mod-sdk/mod-sdk-api-surface.json).
   */
  readonly authoring: ModAuthoringApi;
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
   * Live display geometry, once the web shell has a game surface.
   *
   * Absent during content composition. Geometry, sampling, and repaint methods
   * are intentionally ungated: this is a layout/rendering seam, and in-process
   * plugin code already receives the live game namespace and document. The
   * narrow interface makes ownership explicit without pretending to add an
   * isolation boundary. setVisualFilter is different: it is explicitly gated by
   * display:filter so the consent screen tells a player that a mod changes the
   * final rendered appearance.
   */
  readonly display?: ModDisplay;
  /**
   * Live subwindow-panel geometry and chrome (neo-angband#241), once the web
   * shell has a subwindow host. Absent during content composition, and on a
   * front end that never mounts one - see `ModSubwindows`'s own header for
   * why this is ungated like the rest of `display`.
   */
  readonly subwindows?: ModSubwindows;
  /**
   * One input wait, whole: the frozen core capture, the shell's phase, whether
   * a "-more-" pause holds input, and the last world frame, under one token
   * (input-snapshot.ts). Null before a game exists. Each part is null unless its
   * `state:<domain>.read` is granted; the phase and pause use
   * `state:interaction.read`, the frame `state:map.read`. Absent when the host
   * has not installed a snapshot source.
   */
  readonly snapshot?: () => InputSnapshot | null;
  /** The current keyboard owner, read from the host's installed controller. */
  readonly driver?: () => InputDriver;
  /**
   * Present only while this mod owns the installed controller. `setStatus`
   * publishes its current task. `markNondeterministic()` records on the save that
   * the controller's play can no longer be replayed from the seed, for a mod that
   * switches to a nondeterministic source (a model, a clock) after install. The
   * mark is permanent for the save.
   */
  readonly controller?: {
    setStatus(status: {
      readonly label?: string;
      readonly reason?: string;
    }): void;
    markNondeterministic(): void;
    /** Give the keyboard back to the player, showing the optional reason. Does nothing once another mod owns the controller. */
    release(reason?: string): void;
  } | undefined;
  /** Enabled and loaded mods, limited to manifest-declared public flags. */
  readonly mods?: () => readonly {
    readonly id: string;
    readonly version: string;
    readonly flags?: Readonly<Record<string, boolean>>;
  }[];
  /** Resolved game events, gated by each declared `event:<name>` grant. */
  readonly events?: AgentEventSubscription;
  /** The whole remembered level at one token; null without map read access. */
  readonly knownLevel?: () => KnownLevelView | null;
  /** Read-pure inspection under the matching state read capability. */
  readonly inspect?: ModInspect;
  /** Submit a validated player action at the current input wait. Present only
   * with `input:intent` and a live host gate. This does not install a controller. */
  readonly intent?: ModIntent;
  /** Answer the currently open typed prompt, when input:prompt.reply is granted. */
  readonly prompt?: ModPrompt;
  /**
   * Live monster-tile lookup and paint over the active graphics pack
   * (neo-angband#256), once the web shell has one. Absent during content
   * composition, and on a front end with no tile subsystem - see
   * `ModTiles`'s own header for why this is ungated like the rest of
   * `display` and `subwindows`.
   */
  readonly tiles?: ModTiles;
  /**
   * neo-angband#35: the host's own judgment on the most recent root-screen
   * keydown - a genuine key-repeat (the browser's own auto-repeat while a key
   * stays held, or a keydown close enough behind the previous one to be
   * indistinguishable from one) versus a fresh, deliberate press. Call it
   * inside your own keydown handling to read the CURRENT verdict; see
   * key-repeat.ts for the two signals it combines and why a third
   * (event-staleness) figure is reported but does not by itself decide it.
   *
   * `null` before the root handler has classified a keydown this session.
   * Absent during content composition and on any host that has not wired a
   * live keydown handler yet - the same absence `display` and `subwindows`
   * have, and for the same reason: this rides `main.ts`'s own DOM keydown
   * handling, which core never sees (packages/core has no DOM).
   *
   * ENTIRELY UNGATED, like `subwindows`: this is read-only timing information
   * about a keypress you could already observe for yourself via
   * `ctx.display.onKey`, not a capability over the game or the platform.
   *
   * THIS IS THE READ-SIDE PRIMITIVE ONLY. Nothing in this codebase yet uses
   * the verdict to suppress or alter a command - building on it to skip a
   * stale repeat is a separate, later change.
   */
  readonly keyRepeat?: () => KeyRepeatVerdict | null;
  /**
   * The game's own options, under `state:options.read`; `set` needs
   * `options:write` too and changes only user interface options and the three
   * number settings (mod-options.ts).
   */
  readonly options?: ModOptions;
  /** The player's keymap editor for the current keyset, under `keymap:edit` (mod-keybindings.ts). */
  readonly keybindings?: ModKeybindings;
  /**
   * The knowledge menu's contents, under `state:knowledge.read`: each category's
   * known members as the game groups them, and each one's recall page as a
   * `ScreenView` (knowledge-read.ts). Reading a page changes nothing in the game.
   */
  readonly knowledge?: ModKnowledge;
  /** Manage roster slots after declaring `saves:manage`, including at the title. */
  readonly saves?: ModSaves;
  /** Add title actions after declaring `ui:title`. */
  readonly title?: ModTitle;
  /** Manage player profiles after declaring `profiles:manage`. */
  readonly profiles?: ModProfiles;
  /** True when this mod's controller was requested for the new character. */
  readonly controllerArmed?: boolean;
  /**
   * The attached character, under `state:player.read`. `key()` is its stable host
   * roster lineage. `sheet()` is the character sheet as data: the same panels,
   * stat rows, history and flag grid the character screen draws.
   */
  readonly character?: {
    key(): string | null;
    sheet?(): CharacterSheetData | null;
    /** Angband's own player history, oldest first: the run journal (run-report.ts). */
    history(): readonly CharacterHistoryEntry[];
    /** The report for the run that ended on this page, or null. Starting a new character reloads the page, so store it from `onRunEnd` to keep it. */
    runReport?(): RunReport | null;
    /** Called once when a run ends, before the tombstone. Returns an unsubscribe. */
    onRunEnd?(listener: (report: RunReport) => void): () => void;
  };
  /**
   * Manage this mod's keymaps in the player's current keyset. Present only when
   * the mod declared `keymap:write` and the player consented. `bind()` never
   * replaces an existing mapping. `entries()`, `rebind()`, and `remove()` only
   * reach bindings this mod owns; a player edit takes ownership back, and host
   * teardown removes any bindings still owned by a departing mod.
   */
  readonly keymaps?: ModKeymaps;
  /**
   * neo-angband#171: this mod's own live per-character storage - the actual
   * save bag, not a fingerprint approximated from birth-fixed facts. Absent
   * during content composition and on any host that has not latched a live
   * game to write into - the same absence `state` itself has, and for the
   * same reason: there is no character to key storage to before one exists.
   * See `ModCharacterStore`'s own header for scoping and what a write is
   * tagged with.
   */
  readonly characterStore?: ModCharacterStore;
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
   * HTTP requests to the hosts this mod's manifest names with `network:<host>`,
   * `network:local` or `network:*`. Present only when the manifest asks for at
   * least one. In the desktop app the main process sends the request, so a
   * server needs no CORS headers, and secrets are kept encrypted where the page
   * cannot read them. In a browser tab it is `fetch`, CORS applies, and secrets
   * are kept in page storage. See docs/modding/MOD_SEAMS.md section 4z.
   */
  readonly net?: ModNet;
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
   *
   * PRINT `lines`, NOT A SENTENCE OF YOUR OWN. Every outcome carries the wording
   * the mod manager itself would show for it, including the per-requirement rows
   * of a standards refusal and the advice under them. A mod that writes its own
   * teaches the player a second vocabulary for one concept, and the first thing
   * they do with two vocabularies is stop trusting either.
   */
  readonly installMod?: (bytes: Uint8Array) => Promise<ModInstallOutcome>;
  /**
   * Save the game and reload the page, so what you installed this session is in
   * the game.
   *
   * Present on exactly the terms `installMod` is - your manifest declared
   * `mod:install`, the player consented, and the host latched a door - so guard
   * with `if (!ctx.reloadGame) return;`.
   *
   * GATED BY THE INSTALL CAPABILITY RATHER THAN BY ONE OF ITS OWN, because the
   * two halves are one act. Content composes at load, so a mod that may install
   * and may not reload leaves the player holding something this process will
   * never load; and reloading is not a thing a mod with nothing to apply has any
   * business doing.
   *
   * WHAT IT IS NOT is a permission to reload. A plugin runs in the page and can
   * reach `location` with or without any grant (docs/modding/PLUGINS.md, "What a
   * capability gates"). What this buys is the SEQUENCE the game does for its own
   * mod changes and a mod cannot do for itself: every plugin's `uninstall()` runs,
   * the autoplayer hands the keyboard back, the live character is written down,
   * and the session is marked to resume that character rather than to land on the
   * title screen. Calling `location.reload()` yourself skips all of it.
   *
   * The promise resolves once the host has taken the save and asked for the
   * reload. The page is on its way out at that point, so treat anything after the
   * await as best-effort: your own `uninstall()` has already run.
   */
  readonly reloadGame?: () => Promise<void>;
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
   * Resolve a mod reference through the SAME resolver the mods screen's own
   * "install from a repository" door uses, and hand back its manifest and
   * payload listing - without installing anything.
   *
   * Present only when your manifest declared `mod:read` and the player
   * consented to it; `undefined` otherwise, so guard with
   * `if (!ctx.readMod) return;`.
   *
   * `ref` IS ANYTHING A PLAYER COULD TYPE into that screen: `owner/repo`, a
   * `github.com/owner/repo` URL, or a URL pinning one tag (a
   * `.../tree/<tag>`). It is parsed and resolved by the exact functions the
   * install door calls - the tags API, the channel filter, the manifest read
   * at each candidate tag until one is engine-compatible - so a mod cannot see
   * a reference resolve here that an install would refuse, or the other way
   * round. Writing that walk yourself instead would drift from it the moment
   * either copy changed, in the direction of believing something the real
   * install door would turn away.
   *
   * REFUSES RATHER THAN GUESSES. An address that does not resolve, and one
   * that resolves to nothing this build can run, both come back as
   * `{ok: false, problem}` with the host's own sentence for why - never a
   * throw, and never a version this engine cannot load reported as though it
   * were fine.
   *
   * NOT AN INSTALL, AND NOT THE MOD'S FILES. `mod.payload` is the listing the
   * mods screen computes before ever offering an install - paths and archive
   * names, and a byte total when the tree could be read - not the bytes of
   * each file. Getting the actual bytes still means installing it, through
   * `ctx.installMod` or the player's own zip import; nothing here writes to
   * storage or to the player's library.
   */
  readonly readMod?: (ref: string) => Promise<ReadModResult>;
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
   * The game's own debug commands, for a mod that TESTS rather than one that
   * shows.
   *
   * Present only when your manifest declared `debug:wizard` and the player
   * consented to it, and only while there is a game to drive; guard with
   * `if (!ctx.wizard) return;`.
   *
   * Read `ModWizard` before using any of it. The whole set is behind one
   * irreversible call - `sandbox()`, which cuts this session loose from its save
   * slot - and telling the player what that costs before they press your button is
   * your job, not the game's, because you are the one with a screen to say it on.
   */
  readonly wizard?: ModWizard;
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
  /**
   * The UNBOUND content: every record the running game was composed from, as
   * JSON, keyed by pack-file stem with no extension - `"monster"`, `"object"`,
   * `"store"`.
   *
   * WHY THIS EXISTS WHEN `registries` DOES. They are different shapes and only
   * one of them is what the authoring stack on `ctx.authoring` accepts. Every
   * `records` parameter in the SDK is `Readonly<Record<string, readonly
   * JsonRecord[]>>` keyed by file stem, and `peersFor`, `suggestFields`,
   * `templateRecord`, `draftRecord` and `checkRecords` all take it.
   * `registries.monsters.races` is `MonsterRace[]`: bound, resolved, and
   * carrying neither the JSON key names nor the fields that bound to nothing. A
   * peer table built from bound races cannot answer what `base` says on the dogs
   * near depth 3, because `base` is not a field on a bound race.
   *
   * MOD-ADDED RECORDS ARE IN HERE ON THE SAME TERMS AS CORE'S, exactly as they
   * are in `registries`, and each one carries its provenance under the SDK's
   * `PROVENANCE_KEY`. A tool basing a new sword on another mod's sword can
   * therefore see that record and name the dependency it just acquired.
   *
   * NON-RECORD ELEMENTS ARE FILTERED OUT. Passthrough files can hold arrays and
   * scalars, and the authoring functions read `Object.entries` off every element,
   * so the host narrows through the SDK's own `composedObjects` rather than
   * leaving each consumer to guess what a record is.
   *
   * NO CAPABILITY GATES IT: this is the same content the player already has, in
   * the shape it was read in, and it is strictly less than `registries` already
   * publishes ungated - data rather than live objects.
   *
   * Absent during content composition, for the same reason `registries` is
   * absent there: at that point this is what is being built. Guard with
   * `if (!ctx.composedRecords) return;`.
   */
  readonly composedRecords?: ComposedRecords;
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
  /** Register a persistent tiled panel kind for this mod. */
  registerPanelKind(spec: PanelKindSpec): () => void;
  /** THIS mod's open panels, topmost last. Never another mod's. */
  readonly openPanels: readonly string[];
}

export interface PanelKindSpec {
  readonly kind: string;
  readonly label: string;
  readonly tab?: string;
  readonly minSize?: Readonly<{
    width: number;
    height: number;
  }>;
  readonly preferredPlacement?: Readonly<{
    kind: "dock";
    target: string;
    edge: "left" | "right" | "top" | "bottom";
  }> | Readonly<{
    kind: "tab";
    target: string;
  }>;
  readonly fitHeight?: number;
  mount(host: PanelMount): void | (() => void);
}

export interface PanelMount {
  readonly id: string;
  readonly root: ShadowRoot;
  readonly bounds: Readonly<{
    width: number;
    height: number;
  }>;
  readonly active: boolean;
  readonly focused: boolean;
  onStateChange(listener: (state: PanelState) => void): () => void;
  requestFocus(): void;
  requestClose(): void;
  setFitHeight(px: number | null): void;
}

/**
 * What came of handing the game a mod's bytes.
 *
 * A RESULT, NEVER A THROW. The caller is a mod that will be putting this in front
 * of a player, so every refusal is one whole sentence it can print without
 * knowing which refusal it is - the shape the host's own install paths use
 * (`InstallResult`), for the same reason.
 *
 * AND `lines` IS THE HOST'S OWN WORDING, not a second vocabulary. It is what the
 * mod manager itself prints for the very same outcome, built by the very same
 * functions (`installOutcomeLines`, `installFailureLines`, and under a
 * requirements refusal `requirementsRefusal` and `MOD_CHECK_ADVICE`). A mod that
 * prints it says what the game says: one concept, one set of words, whichever
 * door the archive arrived through. Returning the lines rather than a code is
 * what makes that free - a caller reproducing the wording from `problem` and a
 * failure code would drift the first time either side was edited.
 */
export type ModInstallOutcome = {
  readonly ok: true;
  /** The id the mod is stored under, from its own manifest. */
  readonly id: string;
  /** The version it was recorded at. */
  readonly version: string;
  /** The host's own wording for this outcome, ready to print. */
  readonly lines: readonly string[];
} | {
  readonly ok: false;
  readonly problem: string;
  /** The host's own wording for this refusal, ready to print. */
  readonly lines: readonly string[];
};

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
export type ModSessionOutcome = {
  readonly ok: true;
  /** The id it will load under, from its own manifest. */
  readonly id: string;
  /** The version its manifest declares, or "unversioned". */
  readonly version: string;
  /** False when this browser would not hold the archive across the reload. */
  readonly survivesReload: boolean;
} | {
  readonly ok: false;
  readonly problem: string;
};

/**
 * What `ctx.readMod` resolved, or the refusal instead.
 *
 * A RESULT, NEVER A THROW, the same shape `ModInstallOutcome` and
 * `ModSessionOutcome` use and for the same reason: the caller is a mod that
 * will be deciding something from this, so every refusal is one whole
 * sentence it can act on - an address that never resolved and one that
 * resolved to a version this build cannot run are both `{ok: false, problem}`,
 * not two different shapes to check for.
 *
 * `mod` IS `DiscoveredMod`, not a second description of the same facts. It is
 * exactly what the mods screen itself would show for this reference: the
 * manifest's id, name, author, version, description and engine range; every
 * orderable tag the repository offers; and the payload listing - paths and
 * archive names, with a byte total when the tree could be read. It is NOT the
 * bytes of any file; see `readMod`'s own comment on `ModPluginContext`.
 */
export type ReadModResult = {
  readonly ok: true;
  readonly mod: DiscoveredMod;
} | {
  readonly ok: false;
  readonly problem: string;
};

/** What came of conjuring something into the live game. */
export type ModSpawnOutcome = {
  readonly ok: true; /** What was placed, by the name the game knows it by. */
  readonly what: string;
} | {
  readonly ok: false;
  readonly problem: string;
};

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

/** What came of one debug command. `did` is a sentence, ready to show a player. */
export type ModWizardOutcome = {
  readonly ok: true;
  readonly did: string;
} | {
  readonly ok: false;
  readonly problem: string;
};

/** The save a session is still attached to, for a sentence naming what is at risk. */
export interface ModWizardSandbox {
  /** The character's name, or the empty string for a slot with no roster row yet. */
  readonly name: string;
}

/** One record a mod's browser can offer, and which pack put it in the game. */
export interface ModWizardEntry {
  /** The name the game knows it by. */
  readonly name: string;
  /** Its index in the registry this came from, for a caller that wants to be exact. */
  readonly index: number;
  /** Native depth, for sorting a list by where a thing belongs. */
  readonly level: number;
  /**
   * The pack that ADDED this record, absent when the base game did.
   *
   * Absent is the common case and means core's own, the same convention
   * `provenanceOf` uses. This is what lets a browser put a mod's own content first
   * without keeping a list of what vanilla contains.
   */
  readonly from?: string;
}

/** Everything the running game has, after this session's mods composed. */
export interface ModWizardCatalogue {
  readonly items: readonly ModWizardEntry[];
  readonly creatures: readonly ModWizardEntry[];
  readonly artifacts: readonly ModWizardEntry[];
}

/** Where the character is and what it has, for filling in a panel's fields. */
export interface ModWizardWhere {
  /** Current dungeon level; 0 is the town. */
  readonly depth: number;
  /** The deepest level this game's dungeon has. */
  readonly maxDepth: number;
  /** Character level. */
  readonly level: number;
  readonly experience: number;
  readonly gold: number;
  /** Current stats, in the engine's own order, named. */
  readonly stats: readonly {
    readonly name: string;
    readonly value: number;
  }[];
}

/**
 * `ctx.wizard`: the game's own debug commands, for testing a mod.
 *
 * Present only when your manifest declared `debug:wizard` and the player consented
 * to it, and only while there is a game to drive; guard with
 * `if (!ctx.wizard) return;`.
 *
 * READ THIS BEFORE YOU BUILD A BUTTON. Every command here refuses until you have
 * called `sandbox()`, which cuts this session loose from its save slot and cannot
 * be undone. That is the deal: you get the whole debug set, and in exchange the
 * character it happens to has already stopped being written to disk. A mod cannot
 * opt out of it and neither can the player, which is what makes the grant offerable
 * at all.
 *
 * WHAT `sandbox()` COSTS, and you are the one who has to say it, because you are
 * the one with a screen. The character on disk keeps whatever the last save left,
 * and every turn from then on is discarded. The autosave runs at the tail of a turn
 * and throttles to three seconds, so what is lost is at most three seconds of
 * turns. Afterwards the session plays on in memory; reloading the page returns the
 * player to the character select with their character waiting as it was. Call
 * `attached()` first to get the name, so you can put it in the question.
 *
 * NOT THE SAME AS `ctx.debug`, and neither is a bigger version of the other.
 * `ctx.debug` conjures one thing into the character the player is actually playing,
 * after the game's own once-per-character question, and it is the right seam for a
 * mod that made a monster and wants to show it to you. This one is for a mod that
 * needs the character to be somewhere else, some other level, carrying something
 * else - which is testing, not showing - and it pays for that with the save.
 *
 * PLACEMENT IS THE GAME'S, as it is there: items land at the player's feet,
 * creatures are scattered nearby, and there are no coordinates in this API.
 */
export interface ModWizard {
  /** Whether `sandbox()` has already happened. Everything else refuses until it has. */
  sandboxed(): boolean;
  /**
   * The save this session would write to, or null when it would write nowhere.
   *
   * Ask this BEFORE `sandbox()`: it is how you name the character in the question
   * you put to the player. Null afterwards, and null for a session that never had
   * a slot.
   */
  attached(): ModWizardSandbox | null;
  /**
   * Cut this session loose from its save. One way, and the gate on everything else.
   *
   * Also takes the character's debug mark, because after this it is simply true.
   * Idempotent: calling it on a session that is already loose succeeds.
   */
  sandbox(): ModWizardOutcome;
  /**
   * Every item, creature and artifact this game has, each saying which pack added
   * it. Readable BEFORE `sandbox()` - deciding what to test is how a player decides
   * whether to detach at all.
   */
  catalogue(): ModWizardCatalogue;
  /** Where the character is and what it has, or null when there is no game. */
  where(): ModWizardWhere | null;
  /** Drop `quantity` of one item at the player's feet, by name or registry index. */
  spawnItem(which: number | string, quantity?: number): ModWizardOutcome;
  /** Put `quantity` of one creature beside the player, by name or race index. */
  spawnCreature(which: number | string, quantity?: number): ModWizardOutcome;
  /** Drop one artifact at the player's feet, by name or index. */
  spawnArtifact(which: number | string): ModWizardOutcome;
  /** Go to a dungeon level. 0 is the town. */
  goToDepth(depth: number): ModWizardOutcome;
  /** Gain experience, levelling up on the way as normal play would. */
  grantExperience(amount: number): ModWizardOutcome;
  /** Set the experience total outright, gaining or losing to reach it. */
  setExperience(value: number): ModWizardOutcome;
  setGold(value: number): ModWizardOutcome;
  /** Set one stat by name ("STR", "INT", ...). Clamped to the game's own band. */
  setStat(stat: string, value: number): ModWizardOutcome;
  /** Everything at maximum: stats, experience, gold, hit points. */
  maxOut(): ModWizardOutcome;
  /** Full hit points and spell points, every affliction cured, fed. */
  heal(): ModWizardOutcome;
  /** Reroll the per-level hit point table. */
  rerollLife(): ModWizardOutcome;
  /** Drop `quantity` good (or `great`) random items, the way acquirement does. */
  acquire(quantity: number, great?: boolean): ModWizardOutcome;
  /** Summon `quantity` random creatures near the player. */
  summonRandom(quantity: number): ModWizardOutcome;
  /** Remove every creature within `range` squares. Defaults to the whole level. */
  banish(range?: number): ModWizardOutcome;
  /** Hit everything in line of sight, hard. */
  killVisible(): ModWizardOutcome;
  /** Teleport the player up to `range` squares away. */
  teleport(range: number): ModWizardOutcome;
  /** Map this level. */
  mapLevel(): ModWizardOutcome;
  /** Light the whole level. */
  lightLevel(): ModWizardOutcome;
  /** Show every creature on this level. */
  findCreatures(): ModWizardOutcome;
  /** Learn every item found down to `upTo` (the whole dungeon when omitted). */
  learnItems(upTo?: number): ModWizardOutcome;
  /** Learn every creature's lore. */
  learnCreatures(): ModWizardOutcome;
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
   * see CLOUD_BACKUP_DESIGN.md section3. Null means the player cancelled, which is
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
  onSave(fn: (file: {
    readonly name: string;
    readonly text: string;
  }) => void): void;
  /**
   * Ticket #24 (the read side of #133's cloud backup): every `.neochar` file
   * currently sitting in the chosen folder, identified cheaply - a JSON
   * header read, never a full decode of its save bytes and never an import.
   * Empty when there is no folder chosen, permission has lapsed, or the
   * folder cannot be read; never throws, same contract as `write()`.
   *
   * WHY THIS IS ENOUGH TO "OFFER WHAT IS IN THE FOLDER" WITHOUT A SECOND
   * IMPORT PATH. A caller that wants to know "is there a character here I do
   * not have yet" only needs a lineage to compare against its own roster,
   * not the save bytes - and reading save bytes for every file, every time a
   * caller merely wants to look, is the cost this method exists to avoid.
   * Actually bringing a file in still goes through the real import door
   * (Shift-M on the host, or whatever a caller builds on top of that).
   */
  list(): Promise<readonly BackupFolderEntry[]>;
}

/**
 * One `.neochar` file `BackupFolder.list()` found, identified without a full
 * decode - see that method's own doc comment for why a lineage is enough.
 */
export interface BackupFolderEntry {
  /** The file's name inside the chosen folder. */
  readonly name: string;
  /**
   * The character's lineage (roster.ts's stable identity across a transfer),
   * read from the file's own JSON header. Absent for a file this build could
   * not even parse as a transfer file - still reported by name, rather than
   * silently dropped, so a caller can say "found a file it could not read"
   * instead of pretending the folder held one fewer file than it did.
   */
  readonly lineage?: string;
  /** The character's name, for a sentence a player can recognise. Empty when unreadable. */
  readonly characterName: string;
  /** Character level, for the same sentence. 0 when unreadable. */
  readonly level: number;
}

/**
 * The engine surface, typed as core's own public module. Declared as an import
 * type rather than a hand-written list so it can never drift from what core
 * actually exports - the drift is the whole failure mode a curated list has.
 */
export type ModCoreApi = typeof import("@rpgm-tools/neo-angband-core");

/**
 * The authoring surface, typed as the mod SDK's own public module. Declared as
 * an import type for the same reason `ModCoreApi` is: a hand-written list is the
 * thing that drifts from what the package actually exports.
 */
export type ModAuthoringApi = typeof import("@rpgm-tools/neo-angband-mod-sdk");

/** The roster fields the character picker already displays. */
export interface SaveEntry {
  readonly id: string;
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly level: number;
  readonly depth: number;
  readonly dead: boolean;
  /** Epoch milliseconds of the last save. */
  readonly lastPlayed: number;
}

export type SaveResult = {
  readonly ok: true;
} | {
  readonly ok: false;
  readonly reason: string;
};

export type SaveListResult = {
  readonly ok: true;
  readonly entries: readonly SaveEntry[];
} | {
  readonly ok: false;
  readonly reason: string;
};

export interface ModTitleRow {
  readonly label: string;
  readonly key?: string;
  run(): void | Promise<void>;
}

export interface ModTitle {
  registerRow(row: ModTitleRow): () => void;
  choose(title: string, choices: readonly string[]): Promise<number | null>;
}

export interface ModProfile {
  readonly id: string | null;
  readonly name: string;
  readonly active: boolean;
}

export type ProfileResult<T = undefined> = {
  readonly ok: true;
  readonly value: T;
} | {
  readonly ok: false;
  readonly reason: string;
};

export interface ModProfileAction {
  readonly kind: "create-character";
  /** Requires `saves:manage` and this mod's controller. */
  readonly armController?: boolean;
}

export interface ModProfiles {
  list(): ProfileResult<readonly ModProfile[]>;
  /** Omit copyFrom for a fresh profile; null copies the default profile. Saves are excluded. */
  create(name: string, options?: { readonly copyFrom?: string | null }): ProfileResult<ModProfile>;
  /** Replace the enabled set in a profile this mod created; the calling mod stays enabled. */
  setEnabledMods(id: string, mods: readonly string[]): ProfileResult;
  /** Reload into a profile, then run the action once. Refusals leave the active profile unchanged. */
  switchTo(id: string | null, action?: ModProfileAction): ProfileResult;
}

/** The host's character roster and the same actions offered by its picker. */
export interface ModSaves {
  onChange?(listener: (event: Readonly<{
    kind: "rename";
    id: string;
    key: string;
    name: string;
  }> | Readonly<{
    kind: "delete";
    id: string;
    key: string;
  }>) => void): () => void;
  list(): Promise<SaveListResult>;
  load(id: string): Promise<SaveResult>;
  rename(id: string, name: string): Promise<SaveResult>;
  delete(id: string): Promise<SaveResult>;
  /**
   * Start character creation, as the title screen's new character does. The
   * page reloads into the birth screens, or into a `birth` presenter. With
   * `like`, that character becomes the previous one creation offers to reuse:
   * pass a run report's `birth` for "a new character like this one".
   */
  create?(options?: {
    readonly like?: {
      readonly race: string;
      readonly cls: string;
      readonly name?: string;
      readonly stats?: readonly number[];
    };
    /**
     * Hand the new character to this mod's autoplayer without asking the player
     * again. Accepted only from the mod whose controller holds the keyboard when
     * `create` is called; any other caller gets a refusal and nothing starts. The
     * new character is marked as autoplayed when the controller installs. Ask the
     * player for this in your own settings first: it is how they agree to it.
     */
    readonly resumeAutoplayer?: boolean;
  }): Promise<SaveResult>;
}

/** A controller plus what the host should know about this one install. */
export interface ModControllerInstall {
  readonly controller: AgentController;
  /**
   * The controller draws on a source the save's seed cannot replay: a model, a
   * wall clock, the network. The save is marked nondeterministic when it
   * installs, permanently.
   */
  readonly nondeterministic?: boolean;
  /**
   * What the character's death does while this controller holds the keyboard.
   * `reincarnate`, the default, starts the next character in place, as the Borg
   * does. `end` runs the ordinary death: the tombstone, the score table and
   * `ctx.character.onRunEnd`. The controller stays installed until the page
   * reloads, so the mod can start the next character with
   * `ctx.saves.create({ resumeAutoplayer: true })`.
   */
  readonly onDeath?: "reincarnate" | "end";
}

/**
 * What the shell is doing at this moment.
 *
 * - `pregame`: the title, the roster or birth; no game screen is live.
 * - `play`: the dungeon or town, waiting on an ordinary command.
 * - `store`: a shop or the Home screen.
 * - `more`: a "-more-" pause is holding input until the player dismisses it.
 * - `modal`: any other full-screen takeover (options, an item list, the target
 *   loop, a recall page).
 * - `dead`: the character has died and the death screens own the terminal.
 */
export type InteractionPhase = "pregame" | "play" | "store" | "more" | "modal" | "dead";

export type InputDriver = {
  readonly kind: "player";
} | {
  readonly kind: "controller";
  readonly owner: string;
  readonly label?: string;
  readonly reason?: string;
};

export interface InputSnapshot {
  /** The core token; the same value `core.token` carries. */
  readonly token: InputToken;
  /** The host's current keyboard owner, independent of read capabilities. */
  readonly driver: InputDriver;
  /** Null when `state:interaction.read` is not granted. */
  readonly phase: InteractionPhase | null;
  /** Whether a "-more-" pause holds input. Null without `state:interaction.read`. */
  readonly messagePending: boolean | null;
  /**
   * The current rest; null without interaction read access. `mode` is "turns"
   * for a timed rest or the condition a special rest waits for; `turnsRequested`
   * is the length a timed rest was asked to run.
   */
  readonly resting: Readonly<{
    active: boolean;
    mode: RestMode | null;
    turnsRequested: number | null;
    turnsRemaining: number | null;
    turnsRested: number | null;
  }> | null;
  /** Message history without consuming the agent's per-decision stream. */
  /**
   * The message history, oldest first. `entries` is the text alone; `log`
   * carries each entry's repeat count and colour as the message history shows
   * them. Reading it does not drain the log.
   */
  readonly messages: Readonly<{
    token: InputToken;
    entries: readonly string[];
    log: readonly Readonly<{
      text: string;
      count: number;
      color?: string;
    }>[];
  }> | null;
  readonly storeStatus: Readonly<{
    token: InputToken;
    feat: number;
    ready: boolean;
    noSelling: boolean;
    inventory: readonly Readonly<{
      handle: number;
      location?: "pack" | "quiver" | "equipment";
      eligible: boolean;
      price: number | null;
    }>[];
  }> | null;
  readonly activeBlast: Readonly<{
    token: InputToken;
    radius: number;
    arc?: number;
    element: string;
    wallsStop: boolean;
  }> | null;
  /** The open question, or null without `state:interaction.read`. */
  readonly prompt: PromptDescriptor | null;
  /** What the game knows at this wait (agent/boundary.ts). */
  readonly core: CoreSnapshot;
  /**
   * The last world frame the map was painted from, copied. Null before the
   * first paint, or without `state:map.read`.
   */
  readonly frame: WorldFrame | null;
}

/** Inspection methods from a view built for the calling mod. */
export interface ModInspect {
  inspectItem(ref: number | {
    floor: {
      x: number;
      y: number;
      index: number;
    };
  } | {
    store: number;
    index: number;
  }): InspectResult | null;
  bookForItem(handle: number): BookItemResult | null;
  compareLoadoutSlots(ref: Exclude<LoadoutItemRef, {
    from: "object";
  }>): LoadoutSlotsResult | null;
  monsterRecall(raceIndex: number): InspectResult | null;
  spellInfo(spellIndex: number): SpellInspectResult | null;
  itemTester(code: string): ItemTesterResult | null;
  projectionPath(to: {
    x: number;
    y: number;
  }): GridInspectResult | null;
  blastArea(to: {
    x: number;
    y: number;
  }, radius: number, arc?: number): BlastAreaResult | null;
  travelPath(to: {
    x: number;
    y: number;
  }): TravelPathResult | null;
  tileActions(to: {
    x: number;
    y: number;
  }): TileActionsResult | null;
  itemRules(): ItemRulesResult | null;
  terrainCatalogue(): TerrainCatalogueResult | null;
}

/** What a rest runs until: a turn count, or one of the three conditions `R` offers. */
export type RestMode = "turns" | "complete" | "all-points" | "some-points";

export interface BirthAbilityView {
  readonly name: string;
  readonly description: string;
}

export interface BirthRaceView {
  readonly name: string;
  /** STR, INT, WIS, DEX, CON adjustments. */
  readonly statAdj: readonly number[];
  readonly hitDie: number;
  /** Experience factor, as a percentage. */
  readonly expFactor: number;
  readonly infravisionFeet: number;
  /** Skill bonuses by SKILL name (DISARM_PHYS, DEVICE, SAVE, STEALTH, ...). */
  readonly skills: Readonly<Record<string, number>>;
  readonly abilities: readonly BirthAbilityView[];
}

export interface BirthClassView {
  readonly name: string;
  readonly statAdj: readonly number[];
  readonly hitDie: number;
  readonly expFactor: number;
  readonly skills: Readonly<Record<string, number>>;
  /** The realms of magic the class learns; empty for a class with no spells. */
  readonly magic: readonly string[];
  readonly abilities: readonly BirthAbilityView[];
}

export interface BirthOptionView {
  readonly name: string;
  readonly description: string;
  readonly value: boolean;
}

export interface BirthCatalogue {
  readonly races: readonly BirthRaceView[];
  readonly classes: readonly BirthClassView[];
  readonly stats: readonly string[];
  readonly pointBudget: number;
  readonly nameMax: number;
  /** The previous character's race, class and name, when there is one to reuse. */
  readonly previous: {
    readonly race: string;
    readonly cls: string;
    readonly name: string;
  } | null;
  /** A name the host pinned (a launch argument); `setName` then refuses. */
  readonly namePinned: boolean;
}

export interface BirthPreview {
  /** The terminal birth screen's stat rows: label, Self, race, class and Best. */
  readonly stats: readonly {
    readonly key: string;
    readonly label: string;
    readonly natural: string;
    readonly raceBonus: string;
    readonly classBonus: string;
    readonly best: string;
  }[];
  /** The five character panels, each line with its label, value and COLOUR_* index. */
  readonly panels: readonly {
    readonly key: string;
    readonly lines: readonly {
      readonly label: string;
      readonly value: string;
      readonly color: number;
    }[];
  }[];
  /** Starting gold before equipment is bought, as point-buy leaves it. */
  readonly gold: number;
}

export interface BirthDraftView {
  readonly race: string | null;
  readonly cls: string | null;
  /** "point" for point-buy, "roller" for the standard roller. */
  readonly method: "point" | "roller";
  /** The natural stats the character will start with, STR to CON. */
  readonly stats: readonly number[];
  readonly pointsLeft: number;
  readonly pointsSpent: readonly number[];
  readonly canPreviousRoll: boolean;
  readonly name: string;
  readonly history: string;
  readonly historyEdited: boolean;
  readonly options: readonly BirthOptionView[];
  readonly preview: BirthPreview | null;
  /** Race, class and a name are all chosen, so `accept` will start the game. */
  readonly ready: boolean;
}

export type BirthResult = {
  readonly ok: true;
} | {
  readonly ok: false;
  readonly reason: string;
};

export interface ModBirthSession {
  catalogue(): BirthCatalogue;
  draft(): BirthDraftView;
  chooseRace(name: string): BirthResult;
  chooseClass(name: string): BirthResult;
  /** Switch to point-buy at the suggested spread. */
  usePointBuy(): BirthResult;
  buy(stat: number): BirthResult;
  sell(stat: number): BirthResult;
  /** The suggested spread for the chosen race and class (generate_stats). */
  suggest(): BirthResult;
  /** Every stat back to 10 with the full budget. */
  reset(): BirthResult;
  /** Switch to the standard roller and roll a new set of stats. */
  roll(): BirthResult;
  /** Swap back to the roll before the latest one. */
  previousRoll(): BirthResult;
  setName(name: string): BirthResult;
  randomName(): BirthResult;
  setHistory(text: string): BirthResult;
  /** Roll a new background for the chosen race and drop any edit. */
  regenerateHistory(): BirthResult;
  setOption(name: string, value: boolean): BirthResult;
  /** Take the previous character's race, class and stats. */
  usePrevious(): BirthResult;
  /** Start the game with this draft. The page reloads into the new character. */
  accept(): BirthResult;
  /** Leave creation without starting a game, back to the title screen. */
  cancel(): void;
}

/** The live question at an input wait. PromptRequest remains the presenter ABI. */
export type PromptDescriptor = {
  readonly kind: "ack";
  readonly promptId: number;
  readonly label: string;
  readonly tag: "more";
} | {
  readonly kind: "confirm";
  readonly promptId: number;
  readonly label: string;
  readonly price?: number;
} | {
  readonly kind: "quantity";
  readonly promptId: number;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly unitPrice?: number;
  readonly totalPrice?: number;
  readonly totals?: readonly number[];
  readonly gold?: number;
} | {
  readonly kind: "text";
  readonly promptId: number;
  readonly label: string;
  readonly maxLength: number;
  readonly defaultValue: string;
  readonly tag?: "rest";
} | {
  readonly kind: "direction";
  readonly promptId: number;
  readonly label: string;
  readonly targetAllowed: boolean;
} | {
  readonly kind: "item";
  readonly promptId: number;
  readonly label: string;
  readonly choices: readonly {
    readonly handle: number;
    readonly label: string;
    readonly letter: string;
  }[];
  readonly tabs: Readonly<{
    floor: boolean;
    quiver: boolean;
    equipment: boolean;
  }>;
} | {
  readonly kind: "spell";
  readonly promptId: number;
  readonly label: string;
  readonly choices: readonly {
    readonly index: number;
    readonly name: string;
    readonly level: number;
    readonly mana: number;
    readonly fail: number;
    readonly castable: boolean;
  }[];
} | {
  readonly kind: "target";
  readonly promptId: number;
  readonly label: string;
  readonly mode: "interesting" | "free";
  readonly cursor: Readonly<{
    x: number;
    y: number;
  }>;
  readonly candidates: readonly Readonly<{
    x: number;
    y: number;
  }>[];
  readonly path: readonly Readonly<{
    x: number;
    y: number;
  }>[];
};

export type PromptAnswer = boolean | number | string | Readonly<{
  action: "move";
  x: number;
  y: number;
}> | Readonly<{
  action: "next" | "previous" | "toggle" | "select" | "cancel" | "acknowledge";
}>;

export interface PromptReplyResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly code?: "controller-owned";
}

export interface ModPrompt {
  reply(promptId: number, answer: PromptAnswer): PromptReplyResult;
}

export type PlayerIntent = {
  readonly kind: "command";
  readonly command: AgentCommand;
} | {
  readonly kind: "travel";
  readonly x: number;
  readonly y: number;
  readonly modifiers?: Readonly<{
    shift?: boolean;
    ctrl?: boolean;
  }>;
} | {
  readonly kind: "target";
  readonly midx: number;
} | {
  readonly kind: "target";
  readonly x: number;
  readonly y: number;
} | {
  readonly kind: "stop-resting";
} | {
  readonly kind: "ignore" | "unignore";
  readonly handle: number;
} | {
  readonly kind: "item-rule";
  readonly rule: "kind-aware" | "kind-unaware" | "ego" | "quality" | "note-aware" | "note-unaware";
  readonly index: number;
  readonly itype?: number;
  readonly value: boolean | number | string;
};

export interface IntentResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly code?: "controller-owned";
}

export interface ModIntent {
  submit(token: InputToken, intent: PlayerIntent): IntentResult;
  catalogue?(): Readonly<{
    token: InputToken;
    commands: readonly Readonly<{
      code: string;
      verb: string | null;
      args: string;
      phase: "play" | "store";
    }>[];
    intents: readonly Readonly<{
      kind: string;
      args: string;
    }>[];
  }>;
}

/** Where a secret's value is kept. */
export type ModSecretStorage = "os" | "environment" | "page";

/**
 * What `ctx.net.request` resolves to. `ok: true` means a response arrived,
 * whatever its status; read `status` for the HTTP result.
 */
export type ModNetResponse = {
  readonly ok: true;
  readonly status: number;
  /** Response headers, names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Present when the request used a secret: where the least protected one is kept. */
  readonly secretStorage?: ModSecretStorage;
} | {
  readonly ok: false;
  readonly code: NetProblemCode;
  readonly problem: string;
};

export type ModSecretResult = {
  readonly ok: true;
  readonly storage: ModSecretStorage;
} | {
  readonly ok: false;
  readonly problem: string;
};

export interface ModNetSecrets {
  /** Where `set` keeps a value on this front end: `os` in the desktop app, `page` in a browser tab. */
  readonly storage: "os" | "page";
  /**
   * Keep `value` under `name`, to be sent only to `hosts`. Each host must be one
   * this mod's grants cover. Setting a name again replaces its value and hosts.
   */
  set(name: string, value: string, options: {
    readonly hosts: readonly string[];
  }): Promise<ModSecretResult>;
  /**
   * Take `name`'s value from the first of `variables` that is set in the
   * environment the game was started from, sent only to `hosts`. Desktop app
   * only. The player is asked, in a dialog of the game's own, the first time and
   * whenever the variables or hosts change.
   */
  fromEnv(name: string, variables: readonly string[], options: {
    readonly hosts: readonly string[];
  }): Promise<ModSecretResult>;
  /** Whether `name` is set, and where. Never the value. */
  has(name: string): Promise<{
    readonly present: boolean;
    readonly storage?: ModSecretStorage;
  }>;
  delete(name: string): Promise<{
    readonly ok: boolean;
  }>;
}

export interface ModNet {
  /** `relay` in the desktop app, `page` in a browser tab. */
  readonly transport: "relay" | "page";
  /**
   * Send one request. A header value may contain `{secret:name}`, which the host
   * replaces with that secret's value when the request's host is one the secret
   * may be sent to. Never throws.
   */
  request(request: NetRequest): Promise<ModNetResponse>;
  readonly secrets: ModNetSecrets;
}

/**
 * The window chrome's look: title bars, tabs, buttons, dividers and drop
 * guides around the panels. index.html draws it from `--chrome-*` custom
 * properties whose defaults are Angband's own palette and 8x13 dialog font. A
 * mod holding `display:filter` can repaint it through
 * `ctx.display.setChromeTheme`, and clearing the request puts the game's own
 * look back.
 */
/** Colours accept #rgb, #rrggbb, #rrggbbaa or rgb()/rgba(). */
export interface ChromeTheme {
  /** A font family already loaded in the page, for example with the FontFace API. */
  readonly font?: string;
  /** Font size in CSS pixels, 8 to 24. */
  readonly fontSize?: number;
  /** Behind every panel, and the dividers' ground. */
  readonly page?: string;
  readonly titleBackground?: string;
  readonly text?: string;
  readonly textStrong?: string;
  readonly muted?: string;
  readonly border?: string;
  readonly divider?: string;
  readonly dividerHover?: string;
  /** Selected tab, drop guides and hover outlines. */
  readonly accent?: string;
  readonly floatBorder?: string;
  /** Corner rounding in CSS pixels, 0 to 16. */
  readonly radius?: number;
  /** A drop shadow under floating panels. */
  readonly shadow?: boolean;
}

/** What a plugin is handed as `ctx.prefs`. */
export interface ModPrefs {
  /**
   * This mod's stored value, or null when it has never stored one. Parsed fresh
   * on every call rather than cached: the game and the mod manager both run in
   * this tab, and a cached copy would go stale the moment a profile is applied.
   */
  get(): unknown;
  /**
   * Replace this mod's stored value. Passing null or undefined REMOVES it, so a
   * mod can forget what it knows without leaving an empty husk behind.
   */
  set(value: unknown): void;
}

export interface ModSettingsRead {
  /** Undefined for an id the manifest does not declare. */
  get(id: string): number | undefined;
  /** Every declared setting, by id. */
  all(): Readonly<Record<string, number>>;
  /** Runs when the player moves a setting that needs no reload. Call the returned function to stop. */
  onChange(listener: (id: string, value: number) => void): () => void;
}

/** What the tracker decided about one keydown. */
export interface KeyRepeatVerdict {
  /**
   * The host's own judgment: true if this keydown should be treated as a
   * continuation of a held key rather than a fresh, deliberate press.
   * `reportedRepeat || (intervalMs !== null && intervalMs < MIN_HUMAN_KEYPRESS_INTERVAL_MS)`.
   */
  readonly isRepeat: boolean;
  /** `event.repeat` exactly as the browser reported it. */
  readonly reportedRepeat: boolean;
  /**
   * Milliseconds since the previous keydown of this SAME key, or null when
   * there was none yet (a different key, or the first keydown this tracker
   * has ever classified).
   */
  readonly intervalMs: number | null;
  /**
   * Milliseconds between this event's own `timeStamp` and `now` (the moment it
   * was classified) - see the module header for why this is reported but does
   * not drive `isRepeat` on its own.
   */
  readonly ageMs: number;
}

/** Which terminals take the ground: the text subwindows only, or the main terminal too. */
export type TerminalGroundScope = "subwindows" | "all";

export interface TerminalGround {
  /** #rgb, #rrggbb, #rrggbbaa or rgb(), the forms setChromeTheme accepts. */
  readonly color: string;
  readonly scope: TerminalGroundScope;
}

/** What one file of the mod's payload is, and how it arrives. */
export type PayloadEntry = {
  readonly kind: "file";
  readonly path: string;
} | {
  readonly kind: "archive";
  readonly path: string;
};

/**
 * A version that exists and that THIS build cannot run.
 *
 * Discovery walks down a repository's versions until it finds one this build
 * accepts, so the version it offers is installable. That walk is only honest if
 * what it walked PAST is reported: a player offered v0.14.4 while the mod's front
 * page shows v0.15.0 would otherwise conclude the game is broken or the listing
 * is stale, when the real answer is that v0.15.0 wants a newer game and updating
 * gets it. Same shape of debt as `channelHeld`, different creditor.
 */
export interface EngineHeld {
  /** The tag that was passed over. */
  readonly tag: string;
  /** Its manifest's own version string, or null when it did not state one. */
  readonly version: string | null;
  /** The engine range it declares, or null when it declares none. */
  readonly engine: string | null;
  /** The loader's own sentence about why this build is outside that range. */
  readonly why: string;
  /**
   * Whether updating the GAME is what would unlock this version.
   *
   * True when a newer engine version satisfies the range, so "update the game" is
   * advice that works. False when no newer version within the probed window does,
   * which is a mod wanting an OLDER game and is nearly always an author's mistake
   * in the range. Null when the range cannot be read at all. See
   * `newerGameCouldRun`, whose bound is the reason the false and null cases must be
   * worded as facts about the two versions rather than as instructions.
   */
  readonly newerGameHelps: boolean | null;
}

/** A mod, as its own repository describes it. */
export interface DiscoveredMod {
  readonly repo: string;
  readonly tag: string;
  /** Every version the repository offers that can be ordered, newest first. */
  readonly tags: readonly string[];
  /** From the manifest. The id is also the folder name. */
  readonly id: string;
  readonly name: string;
  /**
   * Who the manifest says wrote it, shown beside the name everywhere a mod is
   * listed. SELF-DECLARED, and never the author register: the register is a
   * standing this project has looked at, and putting either one where the other
   * belongs would turn attribution into an endorsement or hide it entirely.
   * Required of every manifest (docs/modding/REQUIREMENTS.md), so null here means
   * a manifest that predates that rule.
   */
  readonly author: string | null;
  readonly version: string;
  readonly description: string | null;
  /** The engine range the MOD claims. */
  readonly engine: string | null;
  /**
   * Paths to screenshot assets the manifest declares (marketplace preview),
   * relative to the pack. Empty when the manifest names none.
   */
  readonly screenshots: readonly string[];
  /**
   * SPDX license expression the manifest declares, or null when it states none.
   *
   * Optional for the same reason `sha` is: a fixture built before this field
   * existed still type-checks as a DiscoveredMod. `discoverMod` itself always
   * sets it.
   */
  readonly license?: string | null;
  /**
   * Capabilities the manifest requests (only meaningful for a `shape: plugin`
   * pack; empty for content). Read here, RATHER THAN LEFT TO THE INSTALLER, so
   * the pre-install summary (mod-preinstall.ts) can describe them in plain
   * language - via capability-describe.ts, the one place that wording lives -
   * before a byte is fetched.
   *
   * Optional rather than required-and-empty, so an older fixture still
   * type-checks; absent is read as "none declared", same as `[]`.
   */
  readonly capabilities?: readonly string[];
  /**
   * What this manifest claims about OTHER packs (see PackCompat in the SDK),
   * filtered to entries whose shape is actually usable rather than validated -
   * a malformed entry here is the real install's problem to refuse, not this
   * row's to throw over. Read for the same reason `capabilities` is: the
   * pre-install summary's conflict check (declaredConflicts, mod-conflicts.ts)
   * needs it before install, not only after.
   *
   * Optional, same reasoning as `capabilities`; absent reads as "declares nothing".
   */
  readonly compat?: readonly PackCompat[];
  /**
   * Whether the mod would LOAD in this build, and what to say about the range if
   * there is anything to say - both straight from the loader's own verdict
   * (mod-engine.ts), so a row cannot promise what load time then refuses. Note
   * that a problem is not always a refusal: a pack with no code that declares a
   * range this build sits outside still loads, and still deserves the line.
   */
  readonly compatible: boolean;
  readonly engineNote: string | null;
  /**
   * The newest version this repository has that the player's CHANNEL declined, or
   * null. A row that shows 0.13.0 while the repository's front page shows
   * 0.14.0-beta.1 looks out of date, and the honest answer is "your channel" - so
   * the row is given what it needs to say so.
   */
  readonly channelHeld: string | null;
  /**
   * The newest version this build cannot run, when an OLDER one is being offered
   * instead, or null.
   *
   * Null in both of the cases that are not this one: the newest version runs here
   * (nothing was held), and no version runs here (then `compatible` is false and
   * the row says so, and naming the same tag twice would read as two problems).
   */
  readonly engineHeld: EngineHeld | null;
  /**
   * How many versions' manifests were actually read before settling on `tag`.
   *
   * One in the ordinary case, because the newest version is nearly always the one
   * that runs. More only when it did not, and then this is what lets a refusal say
   * "none of the last four versions runs here" instead of leaving the player to
   * wonder whether the older ones were even looked at.
   *
   * Optional for the same reason `sha` is: a fixture written before it existed
   * still type-checks. `discoverMod` always sets it.
   */
  readonly versionsChecked?: number;
  readonly payload: readonly PayloadEntry[];
  /**
   * Bytes, when the tree could be read. Null when the payload came from the
   * manifest and the tree call failed - a size the row cannot show is better
   * than one it makes up.
   */
  readonly bytes: number | null;
  /** True when the payload was guessed from the tree rather than declared. */
  readonly guessedPayload: boolean;
  /**
   * The commit `tag` resolves to right now, or null when it could not be
   * learned - the tags call failed (a pinned tag still installs on that
   * failure; see the try/catch below) or the API's own entry had no SHA.
   *
   * THIS IS THE VALUE AN INSTALL PINS. `installModFromRepo` (mod-install.ts)
   * carries it straight into `InstalledModMeta.sha`, so an install records not
   * just which tag it asked for but which commit that tag named at the moment
   * it asked - the fact a moved tag changes and a tag name alone cannot show.
   *
   * Optional rather than required-and-nullable like this interface's other
   * fields, purely so a fixture built before this field existed still type-checks
   * as a DiscoveredMod without every caller having to be revisited the day it was
   * added. `discoverMod` itself always sets it - to a SHA or explicitly to null -
   * so nothing this module produces ever leaves it undefined.
   */
  readonly sha?: string | null;
}

export interface ModOptionEntry {
  readonly name: string;
  readonly description: string;
  /** The options page: "interface", "birth", "cheat" or "score". */
  readonly page: string;
  readonly value: boolean;
  /** Whether `set` accepts this option. */
  readonly writable: boolean;
}

export interface ModOptionsView {
  readonly entries: readonly ModOptionEntry[];
  /** The low hit point warning, in tenths of maximum hit points (0 to 9). */
  readonly hitpointWarn: number;
  /** The base delay factor in milliseconds (0 to 255). */
  readonly delayFactor: number;
  /** The movement delay in milliseconds (0 to 255). */
  readonly lazymoveDelay: number;
}

export interface ModOptionsChange {
  readonly values?: Readonly<Record<string, boolean>>;
  readonly hitpointWarn?: number;
  readonly delayFactor?: number;
  readonly lazymoveDelay?: number;
}

export type ModOptionsResult = {
  readonly ok: true;
  readonly changed: readonly string[];
} | {
  readonly ok: false;
  readonly reason: string;
};

export interface ModOptions {
  get(): ModOptionsView;
  /** Apply a whole change or none of it. Present only with `options:write`. */
  set?(change: ModOptionsChange): ModOptionsResult;
}

export interface ModKeybinding {
  /** The key that runs the binding, such as "g" or "F5". */
  readonly trigger: string;
  /** The keys it presses, in the keymap action encoding ("R&[Enter]"). */
  readonly action: string;
  /** The mod that created it with `ctx.keymaps`, or null for the player's own. */
  readonly owner: string | null;
}

export interface ModKeybindings {
  /** "original" or "roguelike": the keyset these bindings belong to. */
  keyset(): "original" | "roguelike";
  list(): readonly ModKeybinding[];
  /** Bind or replace one trigger. False for a trigger no keymap can use, or an empty action. */
  set(trigger: string, action: string): boolean;
  /** Remove one binding; false when there was none. */
  remove(trigger: string): boolean;
  /**
   * Resolve with the next key the player presses that a keymap can use, or null
   * for Escape. The key is taken before the game sees it, so it runs nothing.
   * A second capture while one is waiting resolves the first with null.
   */
  capture(): Promise<string | null>;
}

export interface KnowledgeCategoryView {
  readonly id: KnowledgeCategoryId;
  /** The browser's own title ("runes (3 unknown)", "known objects"). */
  readonly title: string;
  /** How many entries the category lists. The game greys a category at 0 where it has a gate. */
  readonly count: number;
}

export interface KnowledgeEntryView {
  /** Stable within the category for the session: pass it to `recall`. */
  readonly id: string;
  readonly name: string;
  /** CSS colour the game draws the name in. */
  readonly color: string;
  /** Extra fields the game prints after the name: a rune's note, a monster's symbol, kills and "Full". */
  readonly cells?: readonly {
    readonly text: string;
    readonly color: string;
  }[];
}

export interface KnowledgeGroupView {
  readonly name: string;
  readonly entries: readonly KnowledgeEntryView[];
}

export interface KnowledgeListView {
  readonly title: string;
  readonly groups: readonly KnowledgeGroupView[];
}

export interface ModKnowledge {
  categories(): readonly KnowledgeCategoryView[];
  /** The known members of one category, grouped as the game groups them. Null for an unknown category id. */
  list(category: string): KnowledgeListView | null;
  /**
   * The recall page for one entry, as the game shows it. Null when the id is not
   * in the category's current list: an entry the player does not know yet has no
   * page to read. A monster's page grows as its lore does, so read it again after
   * the snapshot changes rather than keeping an old one.
   */
  recall(category: string, id: string): ScreenView | null;
}

/** One coloured value on the structured sheet: its COLOUR_* index and the CSS colour it draws in. */
export interface SheetColor {
  readonly color: number;
  readonly css: string;
}

/**
 * The character sheet as data, for a mod that lays it out itself
 * (`ctx.character.sheet()`). It carries the same panels, stat rows, history and
 * flag grid that `characterScreen` and `characterFlagsScreen` draw, computed by
 * the same core functions, so the two pages and this read never disagree.
 */
export interface CharacterSheetData {
  readonly name: string;
  /** The five panels of the first page (topleft, misc, midleft, combat, skills). */
  readonly panels: readonly {
    readonly key: string;
    readonly lines: readonly ({
      readonly label: string;
      readonly value: string;
    } & SheetColor)[];
  }[];
  /** One row per stat: the Self, race, class, equipment and Best columns, and the drained value. */
  readonly stats: readonly {
    readonly key: string;
    readonly label: string;
    readonly natural: string;
    readonly raceBonus: string;
    readonly classBonus: string;
    readonly equipBonus: string;
    readonly best: string;
    readonly reduced: string | null;
    readonly naturalMax: boolean;
    readonly drained: boolean;
  }[];
  /** The background paragraph, unwrapped, or "" when the character has none. */
  readonly history: string;
  /**
   * The second page: the sustains block first, then the resistance, ability,
   * hindrance and modifier regions. Each row has one cell per equipment slot and
   * then the player's own column. Null when the game has no ui_entry packs.
   */
  readonly grids: readonly {
    readonly key: string;
    readonly rows: readonly {
      readonly name: string;
      readonly label: string;
      readonly labelColor: SheetColor;
      readonly cells: readonly ({
        readonly symbol: string;
      } & SheetColor)[];
    }[];
  }[] | null;
}

export type HistoryKind = "birth" | "level" | "unique" | "artifact" | "artifact-unknown" | "note" | "import" | "other";

export interface CharacterHistoryEntry {
  readonly kind: HistoryKind;
  /** The text the character history screen shows, without its "(LOST)" suffix. */
  readonly text: string;
  readonly turn: number;
  /** Dungeon level when recorded; feet are this times 50. */
  readonly depth: number;
  /** Character level when recorded. */
  readonly level: number;
  /** An artifact entry for an artifact the character has since lost. */
  readonly lost: boolean;
}

export type RunOutcome = "death" | "winner" | "retired";

export interface RunBelonging {
  readonly name: string;
  readonly color: string;
  readonly location: "equipment" | "pack" | "quiver" | "home";
  readonly quantity: number;
  /** The item's inspect text, as `ctx.inspect.inspectItem` returns it. */
  readonly recall: {
    readonly title: string;
    readonly text: string;
  } | null;
}

export interface RunReport {
  readonly outcome: RunOutcome;
  /** The killer's name, "Ripe Old Age" for a winner, or "Retiring". */
  readonly cause: string;
  /** `ctx.character.key()` for the character, or null when it had no save slot. */
  readonly key: string | null;
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly level: number;
  readonly maxLevel: number;
  /** The deepest dungeon level reached; feet are this times 50. */
  readonly maxDepth: number;
  /** The dungeon level the run ended on. */
  readonly depth: number;
  readonly gold: number;
  /** The game turn the run ended on. */
  readonly turn: number;
  /** total_points: maximum experience plus 100 per level of maximum depth. */
  readonly score: number;
  /** Whether the score table accepted the entry. */
  readonly scored: boolean;
  /** Epoch milliseconds. */
  readonly endedAt: number;
  readonly history: readonly CharacterHistoryEntry[];
  /** The last messages, oldest first, with repeats folded into `count`. */
  readonly messages: readonly {
    readonly text: string;
    readonly count: number;
    readonly color?: string;
  }[];
  readonly belongings: readonly RunBelonging[];
  readonly sheet: CharacterSheetData | null;
  /** The character's birth choices, for `ctx.saves.create({ like: report.birth })`. */
  readonly birth: {
    readonly race: string;
    readonly cls: string;
    readonly name: string;
    readonly stats: readonly number[];
  };
}

export type PanelState = Readonly<{
  bounds: Readonly<{
    width: number;
    height: number;
  }>;
  active: boolean;
  focused: boolean;
}>;

export type ItemRef = Parameters<ModInspect["inspectItem"]>[0];

export type StoreItemRef = number | Extract<ItemRef, {
  store: number;
}>;

export type IntentCatalogue = NonNullable<ReturnType<NonNullable<ModIntent["catalogue"]>>>;

export type CommandCatalogue = IntentCatalogue;

export type CommandCatalogueEntry = CommandCatalogue["commands"][number];

export type IntentCatalogueEntry = IntentCatalogue["intents"][number];

export type StopRestingIntent = Extract<PlayerIntent, {
  kind: "stop-resting";
}>;

export type PromptBase = Pick<PromptDescriptor, "promptId" | "label">;
export type AckPrompt = Extract<PromptDescriptor, { kind: "ack" }>;
export type ConfirmPrompt = Extract<PromptDescriptor, { kind: "confirm" }>;
export type QuantityPrompt = Extract<PromptDescriptor, { kind: "quantity" }>;
export type TextPrompt = Extract<PromptDescriptor, { kind: "text" }>;
export type DirectionPrompt = Extract<PromptDescriptor, { kind: "direction" }>;
export type ItemPrompt = Extract<PromptDescriptor, { kind: "item" }>;
export type SpellPrompt = Extract<PromptDescriptor, { kind: "spell" }>;
export type TargetPrompt = Extract<PromptDescriptor, { kind: "target" }>;
export type OtherPrompt = Exclude<PromptDescriptor, ItemPrompt | QuantityPrompt>;
export type StorePromptAnswer = number | boolean | Readonly<{ action: "cancel" }>;
export type AckReply = Readonly<{ action: "acknowledge" }>;

export type RestingView = NonNullable<InputSnapshot["resting"]>;
export type MessageHistory = NonNullable<InputSnapshot["messages"]>;
export type StoreStatus = NonNullable<InputSnapshot["storeStatus"]>;
export type ActiveBlastView = NonNullable<InputSnapshot["activeBlast"]>;
export type PublicMod = ReturnType<NonNullable<ModPluginContext["mods"]>>[number];
export type ChromeThemeRequest = ChromeTheme;
