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
 * Only `Fullscreen` so far, because only fullscreen has been asked for. The
 * per-window geometry lines are Phase 3's business (real subwindows), and this
 * file is deliberately the shape that can grow those lines without moving.
 *
 * Parsed leniently, as upstream parses it: a line is matched by containing the
 * key, and the value is whatever follows the `=`. An unreadable or absent file is
 * every default, never an error - losing window settings must not stop the game.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Named for the front end, as each of upstream's front ends names its own. */
export const WINDOW_FILE = "window.txt";

export interface WindowState {
  /**
   * SDL_FULLSCREEN (main-sdl.c L5905). Upstream's fullscreen is a video mode with
   * no window furniture at all, which is what "borderless" means here: Electron's
   * own full-screen state drops the frame and the title bar, and the menu bar is
   * hidden with it.
   */
  readonly fullscreen: boolean;
}

const DEFAULTS: WindowState = { fullscreen: false };

export function readWindowState(userDir: string): WindowState {
  let text: string;
  try {
    text = fs.readFileSync(path.join(userDir, WINDOW_FILE), "utf8");
  } catch {
    return DEFAULTS;
  }

  let fullscreen = DEFAULTS.fullscreen;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const value = line.slice(line.indexOf("=") + 1).trim();
    /* strstr(buf, "Fullscreen") then atoi(s) - L4062-4063. */
    if (line.includes("Fullscreen")) fullscreen = Number.parseInt(value, 10) === 1;
  }
  return { fullscreen };
}

export function writeWindowState(userDir: string, state: WindowState): void {
  try {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDir, WINDOW_FILE),
      `# Neo Angband window settings (main-sdl.c's sdlinit.txt).\n` +
        `Fullscreen = ${state.fullscreen ? 1 : 0}\n`,
      "utf8",
    );
  } catch {
    /* best effort: window state is a convenience, not the player's data. */
  }
}
