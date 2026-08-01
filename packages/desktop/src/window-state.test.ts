/**
 * sdlinit.txt's window lines, round-tripped and parsed as leniently as the C.
 *
 * Two upstream front ends are involved: main-sdl.c owns `Resolution` and
 * `Fullscreen` (save_prefs L4197-4198, load_prefs L4058-4063), main-win.c owns
 * `Maximized` and `PositionX`/`PositionY` (save_prefs_aux L780-790, load_prefs_aux
 * L845-870). Every key must default independently, because
 * `GetPrivateProfileIntA(section, key, <default>, file)` does - a state file
 * written before a key existed still has to load.
 *
 * The wiring in main.ts is pinned by source at the bottom: createWindow needs a
 * real Electron window and cannot be imported here.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_VISIBLE,
  MIN_WIDTH,
  WINDOW_FILE,
  onSomeDisplay,
  readWindowState,
  startPlacement,
  writeWindowState,
} from "./window-state.js";
import type { Rect, WindowState } from "./window-state.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "neo-window-"));
}

const DEFAULTS: WindowState = {
  fullscreen: false,
  maximized: false,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  position: null,
};

describe("window state (main-sdl.c sdlinit.txt + main-win.c's window keys)", () => {
  it("defaults to a centred windowed 1200x800 when there is no file", () => {
    expect(readWindowState(path.join(tmp(), "user"))).toEqual(DEFAULTS);
  });

  it("round-trips every key", () => {
    const dir = path.join(tmp(), "user");
    const state: WindowState = {
      fullscreen: true,
      /* NOT true alongside fullscreen - see the invariant tests below. */
      maximized: false,
      width: 1600,
      height: 900,
      position: { x: 120, y: -340 },
    };
    writeWindowState(dir, state);
    expect(readWindowState(dir)).toEqual(state);
  });

  it("round-trips maximised on its own", () => {
    const dir = path.join(tmp(), "user");
    const state: WindowState = {
      fullscreen: false,
      maximized: true,
      width: 1600,
      height: 900,
      position: { x: 120, y: -340 },
    };
    writeWindowState(dir, state);
    expect(readWindowState(dir)).toEqual(state);
  });

  it("round-trips the other side of every boolean, and an absent position", () => {
    const dir = path.join(tmp(), "user");
    writeWindowState(dir, {
      fullscreen: false,
      maximized: false,
      width: 800,
      height: 600,
      position: null,
    });
    expect(readWindowState(dir)).toEqual({
      fullscreen: false,
      maximized: false,
      width: 800,
      height: 600,
      position: null,
    });
  });

  it("keeps a negative position, because a real monitor can be at one", () => {
    /* Windows puts displays left of or above the primary at negative
     * coordinates - MEASURED on this machine, work areas at x=-1310 and
     * y=-1014. Clamping a saved position to >= 0 would move the window off the
     * screen the player actually left it on. */
    const dir = tmp();
    writeWindowState(dir, { ...DEFAULTS, position: { x: -1200, y: -900 } });
    expect(readWindowState(dir).position).toEqual({ x: -1200, y: -900 });
  });

  it("rounds a fractional rect rather than writing one back", () => {
    /* Electron reports device-pixel-ratio scaled bounds; `%d` in the C. */
    const dir = tmp();
    writeWindowState(dir, {
      ...DEFAULTS,
      width: 1200.6,
      height: 800.4,
      position: { x: 10.5, y: -20.5 },
    });
    const text = fs.readFileSync(path.join(dir, WINDOW_FILE), "utf8");
    expect(text).toContain("Resolution = 1201x800");
    expect(text).not.toMatch(/\d\.\d/);
    expect(readWindowState(dir).position).toEqual({ x: 11, y: -20 });
  });

  it("reads upstream's own spacing and ignores comments", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, WINDOW_FILE),
      "# a comment\nResolution = 1440x900\nFullscreen = 0\nGraphics = 0\nMaximized = 1\n",
    );
    expect(readWindowState(dir)).toEqual({
      fullscreen: false,
      maximized: true,
      width: 1440,
      height: 900,
      position: null,
    });
  });

  describe("a missing key keeps its default (GetPrivateProfileIntA's 3rd arg)", () => {
    /* Each case writes ONLY the named key, so a default that is silently
     * overwritten by another key's parsing is caught. */
    const cases: ReadonlyArray<readonly [string, string, Partial<WindowState>]> = [
      ["Fullscreen alone", "Fullscreen = 1\n", { fullscreen: true }],
      ["Maximized alone", "Maximized = 1\n", { maximized: true }],
      ["Resolution alone", "Resolution = 1024x768\n", { width: 1024, height: 768 }],
      ["a position alone", "PositionX = 5\nPositionY = 6\n", { position: { x: 5, y: 6 } }],
    ];
    for (const [name, text, expected] of cases) {
      it(name, () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, WINDOW_FILE), text);
        expect(readWindowState(dir)).toEqual({ ...DEFAULTS, ...expected });
      });
    }

    it("a file from the build before these keys existed still loads", () => {
      /* The exact bytes the shipped build wrote. */
      const dir = tmp();
      fs.writeFileSync(
        path.join(dir, WINDOW_FILE),
        "# Neo Angband window settings (main-sdl.c's sdlinit.txt).\nFullscreen = 1\n",
      );
      expect(readWindowState(dir)).toEqual({ ...DEFAULTS, fullscreen: true });
    });
  });

  it("treats an unparseable value as the default rather than throwing", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, WINDOW_FILE),
      "Fullscreen = yes please\nMaximized = maybe\nResolution = big\nPositionX = left\n",
    );
    expect(readWindowState(dir)).toEqual(DEFAULTS);
  });

  it("treats half a position as no position", () => {
    /* An x with no y would put the window somewhere the player never left it. */
    const dir = tmp();
    fs.writeFileSync(path.join(dir, WINDOW_FILE), "PositionX = 300\n");
    expect(readWindowState(dir).position).toBeNull();
  });

  it("survives outright garbage", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, WINDOW_FILE),
      "\u0000\u0001binary junk\n====\n= 1\nno equals sign at all\n#\n",
    );
    expect(readWindowState(dir)).toEqual(DEFAULTS);
  });

  it("clamps a too-small size, as load_prefs does (L4178-4179)", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, WINDOW_FILE), "Resolution = 80x24\n");
    expect(readWindowState(dir)).toMatchObject({ width: MIN_WIDTH, height: MIN_HEIGHT });
  });

  describe("the ceiling upstream does not have", () => {
    /* A value can parse and still be one no window can be given. MEASURED on
     * Electron 43 / Windows 11: width 2147483648 is silently IGNORED (the window
     * is the default 800), and 2147483647 is accepted and clamped to the display -
     * so on this platform the window does open either way. The clamp is here so
     * that the behaviour does not depend on that measurement holding, and so the
     * file cannot go on carrying a size that has no effect. */
    it("refuses an out-of-int32 size from a hand-edited file", () => {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, WINDOW_FILE), "Resolution = 2147483648x800\n");
      expect(readWindowState(dir)).toMatchObject({ width: MAX_WIDTH, height: 800 });
    });

    it("refuses an absurd height too", () => {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, WINDOW_FILE), "Resolution = 1200x99999999\n");
      expect(readWindowState(dir)).toMatchObject({ width: 1200, height: MAX_HEIGHT });
    });

    it("does not let a caller write one either", () => {
      const dir = tmp();
      writeWindowState(dir, { ...DEFAULTS, width: 2 ** 40, height: 2 ** 40 });
      expect(fs.readFileSync(path.join(dir, WINDOW_FILE), "utf8")).toContain(
        `Resolution = ${MAX_WIDTH}x${MAX_HEIGHT}`,
      );
    });

    it("keeps a size that is merely large but real", () => {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, WINDOW_FILE), "Resolution = 3491x2328\n");
      expect(readWindowState(dir)).toMatchObject({ width: 3491, height: 2328 });
    });
  });

  describe("fullscreen and maximised are never both recorded", () => {
    /* The pair has no restore path (Electron takes no maximised option at
     * construction, and reports isMaximized() false for a full-screen window) and
     * no upstream counterpart: main-win.c has Maximized and no fullscreen,
     * main-sdl.c has Fullscreen and no maximised. */
    it("is refused on the way out", () => {
      const dir = tmp();
      writeWindowState(dir, { ...DEFAULTS, fullscreen: true, maximized: true });
      const text = fs.readFileSync(path.join(dir, WINDOW_FILE), "utf8");
      expect(text).toContain("Fullscreen = 1");
      expect(text).toContain("Maximized = 0");
    });

    it("is refused on the way in, so a hand-edited file cannot produce it", () => {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, WINDOW_FILE), "Fullscreen = 1\nMaximized = 1\n");
      expect(readWindowState(dir)).toMatchObject({ fullscreen: true, maximized: false });
    });

    it("leaves maximised alone when there is no fullscreen to lose it to", () => {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, WINDOW_FILE), "Fullscreen = 0\nMaximized = 1\n");
      expect(readWindowState(dir)).toMatchObject({ fullscreen: false, maximized: true });
    });
  });

  it("survives a file it cannot read", () => {
    /* A directory where the file should be: readFileSync throws EISDIR. */
    const dir = tmp();
    fs.mkdirSync(path.join(dir, WINDOW_FILE));
    expect(readWindowState(dir)).toEqual(DEFAULTS);
  });

  it("does not throw when the directory cannot be written", () => {
    /* A FILE where the directory should be: mkdirSync throws EEXIST/ENOTDIR. */
    const dir = tmp();
    const blocked = path.join(dir, "user");
    fs.writeFileSync(blocked, "not a directory");
    expect(() => writeWindowState(blocked, DEFAULTS)).not.toThrow();
  });
});

/**
 * A window restored onto a monitor that is no longer plugged in is unreachable -
 * it cannot be seen, moved or closed. Upstream never had to answer this, because
 * SDL 1.2 cannot place its window at all and main-win.c hands the saved rect
 * straight to SetWindowPlacement (L2874-2878).
 *
 * The work areas here are the ones MEASURED on the reporting machine, negative
 * coordinates and all: a "sanity check" that rejected x < 0 would have thrown away
 * two real displays.
 */
const LEFT: Rect = { x: -1310, y: -1014, width: 1310, height: 2328 };
const PRIMARY: Rect = { x: 0, y: 0, width: 3491, height: 1964 };
const RIGHT: Rect = { x: 3491, y: -1014, width: 1310, height: 2328 };
const THREE = [LEFT, PRIMARY, RIGHT];

describe("onSomeDisplay", () => {
  it("accepts a window in the middle of the primary display", () => {
    expect(onSomeDisplay({ x: 400, y: 300, width: 1200, height: 800 }, THREE)).toBe(true);
  });

  it("accepts a window on a display at negative coordinates", () => {
    expect(onSomeDisplay({ x: -1200, y: -900, width: 1200, height: 800 }, THREE)).toBe(true);
  });

  it("rejects a window on a display that is no longer there", () => {
    const only = [PRIMARY];
    expect(onSomeDisplay({ x: 3600, y: -900, width: 1200, height: 800 }, only)).toBe(false);
    expect(onSomeDisplay({ x: -1200, y: -900, width: 1200, height: 800 }, only)).toBe(false);
  });

  it("rejects a window with no display at all", () => {
    expect(onSomeDisplay({ x: 0, y: 0, width: 1200, height: 800 }, [])).toBe(false);
  });

  it("rejects a sliver hanging one pixel onto a screen edge", () => {
    /* Non-empty intersection, but nothing the player can see or grab. */
    expect(onSomeDisplay({ x: 3490, y: 500, width: 1200, height: 800 }, [PRIMARY])).toBe(false);
    expect(onSomeDisplay({ x: 500, y: -799, width: 1200, height: 800 }, [PRIMARY])).toBe(false);
  });

  it(`accepts exactly ${MIN_VISIBLE}px of overlap and rejects one less`, () => {
    const at = (x: number): Rect => ({ x, y: 500, width: 1200, height: 800 });
    expect(onSomeDisplay(at(PRIMARY.width - MIN_VISIBLE), [PRIMARY])).toBe(true);
    expect(onSomeDisplay(at(PRIMARY.width - MIN_VISIBLE + 1), [PRIMARY])).toBe(false);
  });
});

describe("startPlacement", () => {
  it("centres the default when nothing was ever saved", () => {
    expect(startPlacement(DEFAULTS, THREE)).toEqual({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("restores a saved rectangle that a current display can show", () => {
    const state: WindowState = {
      ...DEFAULTS,
      width: 1600,
      height: 900,
      position: { x: -1200, y: -900 },
    };
    expect(startPlacement(state, THREE)).toEqual({
      width: 1600,
      height: 900,
      x: -1200,
      y: -900,
    });
  });

  it("falls back to the centred default when the saved monitor is unplugged", () => {
    /* THE case this exists for: without it the window opens on nothing and the
     * player has no way to reach it. */
    const state: WindowState = {
      ...DEFAULTS,
      width: 1600,
      height: 900,
      position: { x: 3600, y: -900 },
    };
    const placement = startPlacement(state, [PRIMARY]);
    expect(placement).toEqual({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    expect(placement.x, "no position at all, so Electron centres it").toBeUndefined();
    expect(placement.y).toBeUndefined();
  });

  it("on rejection drops the saved SIZE too, not just the position", () => {
    /* A size saved on a monitor that is gone is as likely to be wrong as the
     * position was. Deliberately SMALLER than the default, so that keeping it
     * cannot be mistaken for replacing it. */
    const state: WindowState = {
      ...DEFAULTS,
      width: 800,
      height: 600,
      position: { x: 3600, y: -900 },
    };
    expect(startPlacement(state, [PRIMARY])).toEqual({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("does NOT shrink an oversized window whose position is still valid", () => {
    /* Deliberate, and the same as upstream: main-win.c clamps nothing downward
     * (it hands rcNormalPosition to SetWindowPlacement, L2874-2878) and
     * main-sdl.c clamps only a MINIMUM (L4178-4179). A window larger than the
     * display is awkward but reachable - its title bar is on screen - which is a
     * different complaint from a window that is nowhere at all. */
    const state: WindowState = {
      ...DEFAULTS,
      width: 3491,
      height: 1964,
      position: { x: 0, y: 0 },
    };
    expect(startPlacement(state, [{ x: 0, y: 0, width: 1280, height: 720 }])).toEqual({
      width: 3491,
      height: 1964,
      x: 0,
      y: 0,
    });
  });
});

/**
 * main.ts's wiring, pinned by reading the source.
 *
 * createWindow needs a real BrowserWindow and an Electron app, so a node test
 * cannot call it - the shape used here is the repo's established one
 * (packages/web/src/exit-to-title.test.ts, packages/core/src/session/
 * feeling-announce.test.ts): read the file, strip comments, assert the call.
 *
 * This is not ceremony. The defect being fixed was invisible to review precisely
 * because the code READ correctly - `writeWindowState(userDir, { fullscreen:
 * win.isFullScreen() })` inside an `enter-full-screen` handler is what anyone
 * would write, and it recorded the inverse of the truth on Electron 43 / Windows
 * 11 because the event fires before the flag flips (MEASURED: inside the enter
 * handler `isFullScreen()` is still false; inside the leave handler still true).
 * So what is asserted is the thing that cannot be got wrong twice: the handlers
 * must take the new state from the EVENT, never by asking the window.
 */
const MAIN = (() => {
  const src = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  /* Comments would let a citation of the old code score as the code itself. */
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
})();

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*[(<]`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

describe("createWindow's window-state wiring", () => {
  const body = functionBody(MAIN, "createWindow");

  it("takes the new state from the EVENT, not from the window", () => {
    expect(body).toMatch(/on\("enter-full-screen",\s*\(\)\s*=>\s*\{\s*fullscreen = true;/);
    expect(body).toMatch(/on\("leave-full-screen",\s*\(\)\s*=>\s*\{\s*fullscreen = false;/);
  });

  /**
   * The ratchet, and the reason it is shaped like this.
   *
   * The first version of this test asserted only that `isFullScreen()` did not
   * appear inside the textual span `writeWindowState(...)`. That holds nothing: a
   * refactor that reads `const fs = win.isFullScreen()` into a variable inside the
   * `save()` helper passes every other assertion in this file and reintroduces the
   * inverted-persistence bug exactly. A test that constrains one spelling of a
   * defect rather than the defect is worse than no test, because it reads as cover.
   *
   * So the invariant is asserted as a COUNT over the whole function: the window is
   * asked for its fullscreen state in exactly ONE place, the F11 toggle, which is
   * the only place where "what is it now" is the actual question. Every other path -
   * every handler, every helper any handler can reach - must use the tracked flags.
   * `isMaximized()` is asked nowhere at all: `maximize`/`unmaximize` name their own
   * new state, and during a fullscreen transition the window's answer is wrong.
   *
   * If a legitimate need for either call ever arrives, this test has to be edited
   * deliberately. That is the point.
   */
  it("asks the window for its fullscreen state in exactly ONE place: the F11 toggle", () => {
    const asks = body.match(/isFullScreen\s*\(/g) ?? [];
    expect(
      asks,
      "every handler must use the tracked flag - the events fire before isFullScreen() flips",
    ).toHaveLength(1);
    /* And that one is the toggle, where the current state IS the question. */
    expect(body).toContain("win.setFullScreen(!win.isFullScreen())");
  });

  it("never asks the window whether it is maximised", () => {
    expect(body.match(/isMaximized\s*\(/g) ?? []).toHaveLength(0);
  });

  it("hides the menu bar from the same tracked flag", () => {
    /* setMenuBarVisibility(!win.isFullScreen()) was inverted for the same reason,
     * showing the menu bar on the way INTO fullscreen. */
    expect(body).toContain("win.setMenuBarVisibility(!fullscreen)");
    expect(body).not.toContain("setMenuBarVisibility(!win.isFullScreen())");
  });

  it("persists maximised, which isFullScreen() cannot see", () => {
    expect(body).toMatch(/on\("maximize",[\s\S]{0,160}?maximized = true;/);
    expect(body).toMatch(/on\("unmaximize",[\s\S]{0,160}?maximized = false;/);
    /* Entering fullscreen from a maximised window emits `maximize` as well. */
    expect(body).toMatch(/on\("maximize",\s*\(\)\s*=>\s*\{\s*if \(fullscreen\) return;/);
  });

  it("restores maximised at startup, and not on top of fullscreen", () => {
    expect(body).toContain("if (startState.maximized && !startState.fullscreen) win.maximize()");
  });

  it("tracks the NORMAL bounds, so un-maximising goes back where it was", () => {
    expect(body).toContain("win.getNormalBounds()");
    expect(body).not.toContain("win.getBounds()");
    expect(body).toMatch(/on\("resize", rememberBounds\)/);
    expect(body).toMatch(/on\("move", rememberBounds\)/);
    /* Guarded by the tracked flag, not isFullScreen(): the transition's own
     * resize/move events arrive while the window reports the old state. */
    expect(body).toMatch(
      /rememberBounds = \(\): void => \{\s*if \(fullscreen \|\| win\.isMinimized\(\)\) return;/,
    );
  });

  it("clears maximised on entering fullscreen, so the tracked pair stays restorable", () => {
    expect(body).toMatch(
      /on\("enter-full-screen",\s*\(\)\s*=>\s*\{\s*fullscreen = true;\s*maximized = false;/,
    );
  });

  it("saves at close, as hook_quit does (main-win.c L5124, main-sdl.c L1217)", () => {
    /* A resize or a drag is far too frequent to write a file on, so the close is
     * what catches them. */
    expect(body).toMatch(/flush = \(\): void => \{\s*rememberBounds\(\);\s*save\(\);/);
    expect(body).toMatch(/on\("close", flush\)/);
  });

  it("also flushes on a Windows session end, which never sends `close`", () => {
    /* Shutdown / restart / log off. Without this, every resize and drag since the
     * last state transition is dropped and the next launch restores stale geometry.
     * electron.d.ts L2316-2325 (query-session-end) / L2411-2422 (session-end). */
    expect(body).toContain('win.on("query-session-end"');
    expect(body).toContain('win.on("session-end", flush)');
    /* And it must NOT hold the shutdown up. Scoped to the handler's own body,
     * because createWindow legitimately calls preventDefault elsewhere - the F11
     * before-input-event handler swallows the key. */
    const handler = body.slice(body.indexOf('win.on("query-session-end"'));
    expect(
      handler.slice(0, handler.indexOf("});")),
      "a window-settings write is not a reason to delay the user's shutdown",
    ).not.toContain("preventDefault");
  });

  it("validates the saved rectangle against the CURRENT displays", () => {
    expect(body).toContain("startPlacement(");
    expect(body).toContain("screen.getAllDisplays()");
    expect(body).toContain("d.workArea");
    /* Spread into the constructor, so a rejected position omits x/y entirely
     * rather than passing an explicit undefined the option parser may keep. */
    expect(body).toMatch(/new BrowserWindow\(\{\s*\.\.\.placement,/);
  });
});
