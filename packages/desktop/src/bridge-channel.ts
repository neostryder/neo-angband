/**
 * The names and numbers the three desktop processes have to agree on.
 *
 * The WIRE FORMAT itself is not here - it lives in core (host/bridge.ts), shared
 * with the renderer, so the game's host layer is the same code on every front
 * end. This file only holds what is specific to Electron: the channel name, and
 * the capability numbers the preload reports.
 *
 * The renderer cannot import from this package (it would make the web build
 * depend on the desktop build, backwards), so it reads these off the object the
 * preload exposes and validates them. That is why they are stated once, here, by
 * the side that actually knows them.
 */

/** The single synchronous IPC channel the host layer uses. */
export const HOST_BRIDGE_CHANNEL = "neo-host-fs";

/**
 * The channel that reports what the platform is, asked once at preload time.
 *
 * Separate from the filesystem channel because the answers come from a different
 * authority: only the MAIN process knows the real command line. A sandboxed
 * preload's own `process.argv` is the renderer's Chromium switch list, so reading
 * it there would have produced a plausible-looking argv that never contains the
 * user's arguments - a stand-in, which is worse than an absence.
 */
export const HOST_INFO_CHANNEL = "neo-host-info";

/** The global the preload exposes on the renderer's window. */
export const HOST_BRIDGE_GLOBAL = "neoHostFs";

/**
 * textui_quit's channel (ui-game.c:199).
 *
 * "Save and exit" means EXIT where there is something to exit to. The web build
 * has no OS to quit to, so it reloads to the title screen - and that analogue was
 * being used on the desktop build too, where the app simply stayed open and the
 * row read as "just saves". The renderer asks; the main process decides whether
 * quitting is allowed and does the quitting.
 */
export const HOST_QUIT_CHANNEL = "neo-host-quit";

/**
 * The in-place updater's channel (invoke/handle, not sendSync).
 *
 * Asynchronous on purpose, unlike the filesystem bridge: this one downloads a
 * hundred and sixty megabytes. Blocking the renderer for that would freeze the
 * title screen with no way to report progress, and progress is most of what the
 * player is owed while it happens.
 */
export const UPDATE_CHANNEL = "neo-update";

/** Download progress, pushed to the renderer while UPDATE_CHANNEL is working. */
export const UPDATE_PROGRESS_CHANNEL = "neo-update-progress";

/** What the renderer may ask the updater to do. */
export type UpdateOp = "shape" | "download" | "apply" | "reveal";

/** What this launch can do about an update, answered by the main process. */
export interface UpdateShape {
  /** "swap" | "manual" | "none" - see update-plan.ts. */
  readonly how: string;
  /** The directory an update would replace, for the message that says so. */
  readonly installRoot: string;
  readonly platform: string;
  readonly arch: string;
}

/** What the info channel answers with. */
export interface HostBridgeInfo {
  /** main.c's argv, minus the program name. */
  readonly argv: readonly string[];
  readonly termCount: number;
  readonly signals: boolean;
  /**
   * The resolved ANGBAND_DIR_* base. Reported so that "where are my saves?" has
   * an answer inside the game: with a portable install it moves with the folder,
   * so it is not a constant the player can be assumed to know.
   */
  readonly dataDir: string;
  /** True when the tree travels with the install rather than with the user. */
  readonly portable: boolean;
}

/**
 * What this shell can actually do, before argv is filled in by the main process.
 *
 * termCount is 1 because this shell still opens ONE window. Upstream's
 * ANGBAND_TERM_MAX is 8 (ui-term.h:244) and real subwindows are the next phase;
 * declaring 8 before the windows exist would make the subwindow setup screen
 * offer terms that cannot be shown - precisely the lie the capability record
 * exists to prevent.
 *
 * signals is false for the same reason. The main process CAN observe quitting,
 * but nothing yet forwards that to the renderer or holds the quit open long
 * enough for a panic save to land, so the renderer genuinely is not told. It
 * turns true when ui-game.c's panic save is wired, not before.
 */
export const HOST_SHELL_LIMITS = {
  termCount: 1,
  signals: false,
} as const;
