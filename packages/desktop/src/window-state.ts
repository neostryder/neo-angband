/**
 * The front end's own window settings, remembered between launches.
 *
 * This is main-sdl.c's `sdlinit.txt` (load_prefs L4037-4075, save_prefs
 * L4186-4215): a plain `Key = value` file in ANGBAND_DIR_USER holding the things
 * the DISPLAY layer owns rather than the game - upstream keeps `Resolution`,
 * `Fullscreen`, `Graphics`, tile sizes and the per-window geometry there. It is
 * not a savefile and not an option in the game's option screens; a front end's
 * window state has never been either.
 *
 * Two upstream front ends are drawn on, because between them they cover what an
 * Electron window can actually be:
 *
 *   - `Resolution = WxH` and `Fullscreen` are main-sdl.c's own keys
 *     (save_prefs L4197-4198). SDL 1.2 cannot place its window, so that front end
 *     saves a size and nothing else.
 *   - `PositionX`, `PositionY` and `Maximized` are main-win.c's
 *     (save_prefs_aux L780-790), read back at L845-847 (`Maximized`) and L868-872
 *     (`PositionX`, `PositionY`), and applied when the window is created
 *     (`if (td->maximized) td->dwStyle |= WS_MAXIMIZE;` L2770, and
 *     `rcNormalPosition` L2874-2877). A Win32 window is the same kind of object an
 *     Electron window is - it can be moved, resized, maximised or full-screened -
 *     so it is main-win.c that says what must survive a quit.
 *
 * Parsed leniently, as upstream parses it: a line is matched by containing the
 * key, and the value is whatever follows the `=`. Every key is independent and
 * every ABSENT key keeps its default, exactly as main-win.c's
 * `GetPrivateProfileIntA(section, key, <default>, file)` does - so a state file
 * written by an older build still loads. An unreadable or absent file is every
 * default, never an error - losing window settings must not stop the game.
 *
 * PARSING never throws, but that is a smaller promise than it sounds and used to
 * be written here as a larger one. A value can parse perfectly and still be one no
 * window can be given: `Resolution = 2147483648x800` is a number. So every value
 * that leaves this file is clamped into a range a real window can hold (see
 * MIN_/MAX_WIDTH), and the two flags are reconciled (see WindowState.maximized).
 * What a caller gets back is always a window that can exist, not merely a file
 * that could be read.
 *
 * The per-SUBWINDOW geometry lines (`Window = N`, `Visible`, `Left`, `Top` ...)
 * are still Phase 3's business (real subwindows). Note that upstream's `Left`/
 * `Top`/`Width`/`Height` keys belong to those subwindows, not to the main window,
 * which is why the main window's position uses main-win.c's `PositionX`/
 * `PositionY` names: it keeps the substring matching above unambiguous when the
 * subwindow lines eventually arrive.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Named for the front end, as each of upstream's front ends names its own. */
export const WINDOW_FILE = "window.txt";

/**
 * The window a player gets who has never resized one.
 *
 * Given no position, Electron centres the window, which is what a first launch
 * has always done here.
 */
export const DEFAULT_WIDTH = 1200;
export const DEFAULT_HEIGHT = 800;

/**
 * main-sdl.c L4178-4179, applied to the loaded `Resolution` before it is used:
 * `if (screen_w < 640) screen_w = 640; if (screen_h < 480) screen_h = 480;`.
 * A truncated or nonsense size must not produce a window too small to play in.
 */
export const MIN_WIDTH = 640;
export const MIN_HEIGHT = 480;

/**
 * The other end, which upstream does NOT have: a PLATFORM ACCOMMODATION, not
 * parity. main-sdl.c clamps only a minimum (L4178-4179) because SDL's video mode
 * had to name a real resolution; nothing upstream can be handed a size no window
 * can be.
 *
 * MEASURED on Electron 43 / Windows 11, `new BrowserWindow({ width })`:
 *
 *   32767      -> created, bounds clamped to the display (3492)
 *   2147483647 -> created, bounds clamped to the display (3492)
 *   2147483648 -> created, the option SILENTLY IGNORED, window is the default 800
 *
 * So on this platform an absurd size does not stop the window opening. It is still
 * worth clamping, for two reasons that do not depend on that measurement holding:
 * out-of-int32 values are dropped rather than honoured, so the state file goes on
 * carrying a size that has no effect and cannot be seen to have none; and the
 * behaviour above is one version of one platform's, arrived at by experiment, where
 * a clamp is the same everywhere.
 *
 * SHRT_MAX, which is far larger than any display that exists (the largest measured
 * on the reporting machine is 3491x2328) and far inside the integer range every
 * platform's window API accepts.
 */
export const MAX_WIDTH = 32767;
export const MAX_HEIGHT = 32767;

/** A screen rectangle. Matches Electron's `Rectangle` and `Display.workArea`. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowState {
  /**
   * SDL_FULLSCREEN (main-sdl.c L5572), `Fullscreen` in save_prefs (L4021).
   * Upstream's fullscreen is a video mode with no window furniture at all, which
   * is what "borderless" means here: Electron's own full-screen state drops the
   * frame and the title bar, and the menu bar is hidden with it.
   */
  readonly fullscreen: boolean;
  /**
   * main-win.c's `Maximized` (save_prefs_aux L788-790, restored L2770).
   *
   * A DISTINCT state from fullscreen, and the one a Windows player reaches by
   * clicking the title-bar button or double-clicking the title bar. Electron
   * agrees: `isFullScreen()` is false for a maximised window and `isMaximized()`
   * is false for a full-screen one, and they have separate events.
   *
   * INVARIANT: false whenever `fullscreen` is true, enforced by both
   * readWindowState and writeWindowState so that no file and no caller can produce
   * the pair. Fullscreen-and-maximised is a state this port cannot restore -
   * Electron takes no maximised option at construction and reports `isMaximized()`
   * false for a full-screen window - and it is a state neither upstream front end
   * can even express: main-win.c has `Maximized` and no fullscreen at all,
   * main-sdl.c has `Fullscreen` and no maximised at all. A combination with no
   * upstream counterpart AND no restore path is not worth carrying; recording it
   * would be recording something that can never be honoured.
   *
   * Nothing is lost while the game runs. MEASURED: leaving fullscreen from a
   * window that was maximised underneath re-emits `maximize`, so main.ts learns the
   * state back on the way out.
   */
  readonly maximized: boolean;
  /** main-sdl.c's `Resolution = %dx%d` (L4197), clamped as it clamps. */
  readonly width: number;
  readonly height: number;
  /**
   * main-win.c's `PositionX`/`PositionY` (L780-786), the window's rect in
   * *normal* mode - not its maximised or full-screen rect, which is why
   * save_prefs_aux reads `lpwndpl.rcNormalPosition` (L771-773) rather than the
   * live one.
   *
   * `null` when the file has never recorded a position, which is every state file
   * written before these keys existed. Centre the window, as a first launch does.
   */
  readonly position: { readonly x: number; readonly y: number } | null;
}

const DEFAULTS: WindowState = {
  fullscreen: false,
  maximized: false,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  position: null,
};

/** atoi: leading integer, or `null` when there is not one. */
function intOrNull(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** Into a range a real window can hold. L4178-4179 for the floor; MAX_* for the ceiling. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

export function readWindowState(userDir: string): WindowState {
  let text: string;
  try {
    text = fs.readFileSync(path.join(userDir, WINDOW_FILE), "utf8");
  } catch {
    return DEFAULTS;
  }

  let { fullscreen, maximized, width, height } = DEFAULTS;
  let x: number | null = null;
  let y: number | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const value = line.slice(line.indexOf("=") + 1).trim();
    /* An if/else chain matched by substring, in load_prefs' own shape
     * (L4058-4090). Each key keeps its default when the line is absent or its
     * value does not parse. */
    if (line.includes("Resolution")) {
      /* `screen_w = atoi(s); s = strchr(buf, 'x'); screen_h = atoi(s + 1);`
       * - L4059-4061. */
      const [w, h] = value.split("x");
      width = intOrNull(w ?? "") ?? width;
      height = intOrNull(h ?? "") ?? height;
    } else if (line.includes("Fullscreen")) {
      /* strstr(buf, "Fullscreen") then atoi(s) - L4062-4063. */
      fullscreen = intOrNull(value) === 1;
    } else if (line.includes("Maximized")) {
      /* main-win.c L846-847: nonzero is true. */
      maximized = (intOrNull(value) ?? 0) !== 0;
    } else if (line.includes("PositionX")) {
      x = intOrNull(value);
    } else if (line.includes("PositionY")) {
      y = intOrNull(value);
    }
  }

  /* Half a position is no position: an x with no y would put the window
   * somewhere the player never left it. */
  const position = x !== null && y !== null ? { x, y } : null;
  /* Clamped and reconciled HERE, so that a hand-edited or truncated file cannot
   * hand a caller a window that cannot exist. */
  return coherent({ fullscreen, maximized, width, height, position });
}

/**
 * The one place the two rules live: a size a window can hold, and at most one of
 * fullscreen/maximised. Applied on the way in AND on the way out, so neither a
 * file nor a caller can get round them.
 */
function coherent(state: WindowState): WindowState {
  return {
    fullscreen: state.fullscreen,
    /* See WindowState.maximized: fullscreen wins, because it is the one of the two
     * that can actually be restored. */
    maximized: state.fullscreen ? false : state.maximized,
    width: clamp(state.width, MIN_WIDTH, MAX_WIDTH),
    height: clamp(state.height, MIN_HEIGHT, MAX_HEIGHT),
    position:
      state.position === null
        ? null
        : { x: Math.round(state.position.x), y: Math.round(state.position.y) },
  };
}

export function writeWindowState(userDir: string, raw: WindowState): void {
  /* Not trusted any more than the file is: a caller can be wrong too, and the
   * window's own events are where the fullscreen/maximised pair came from. */
  const state = coherent(raw);
  try {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDir, WINDOW_FILE),
      `# Neo Angband window settings (main-sdl.c's sdlinit.txt).\n` +
        `Resolution = ${state.width}x${state.height}\n` +
        `Fullscreen = ${state.fullscreen ? 1 : 0}\n` +
        `Maximized = ${state.maximized ? 1 : 0}\n` +
        (state.position === null
          ? ""
          : `PositionX = ${state.position.x}\nPositionY = ${state.position.y}\n`),
      "utf8",
    );
  } catch {
    /* best effort: window state is a convenience, not the player's data. */
  }
}

/**
 * How much of a restored window has to land on a real display.
 *
 * A saved rectangle can name a monitor that is no longer plugged in, and on
 * Windows the displays to the left of or above the primary have NEGATIVE
 * coordinates, so "off screen" is not "x < 0" - it can only be decided against
 * the displays that exist right now. A window restored onto nothing is
 * unreachable: it cannot be seen, moved, or closed.
 *
 * Upstream has no equivalent check (main-win.c hands `rcNormalPosition` straight
 * to `SetWindowPlacement`, L2874-2878, and lets Win32 do what it will). This is a
 * platform accommodation, not a game rule: the failure it prevents - a launch
 * that draws nothing anywhere - has no upstream counterpart because SDL 1.2 never
 * saved a position at all.
 *
 * 64px in each axis rather than a bare non-empty intersection, so that a window
 * saved one pixel onto a screen edge is rejected too: enough of it must be there
 * to see and to grab.
 */
export const MIN_VISIBLE = 64;

/** Does enough of `rect` overlap any of these work areas to be usable? */
export function onSomeDisplay(rect: Rect, workAreas: readonly Rect[]): boolean {
  return workAreas.some((area) => {
    const overlapX =
      Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
    const overlapY =
      Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
    return (
      overlapX >= Math.min(MIN_VISIBLE, rect.width) &&
      overlapY >= Math.min(MIN_VISIBLE, rect.height)
    );
  });
}

/** The size and (optional) position to create the window with. */
export interface Placement {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
}

/**
 * Turn a loaded state into BrowserWindow options, refusing a rectangle that no
 * current display can show.
 *
 * Falls back to the whole default - centred, DEFAULT_WIDTH x DEFAULT_HEIGHT - and
 * not merely to a centred saved SIZE, because a size saved on a monitor that is
 * gone is as likely to be wrong as the position was.
 */
export function startPlacement(state: WindowState, workAreas: readonly Rect[]): Placement {
  if (state.position === null) {
    /* No position to validate; Electron centres it. */
    return { width: state.width, height: state.height };
  }
  const rect: Rect = {
    x: state.position.x,
    y: state.position.y,
    width: state.width,
    height: state.height,
  };
  if (!onSomeDisplay(rect, workAreas)) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  return { width: state.width, height: state.height, x: rect.x, y: rect.y };
}
