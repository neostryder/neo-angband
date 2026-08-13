/**
 * The screen the game shows while it is still getting ready.
 *
 * WHY THIS EXISTS. Boot used to paint the map of whatever character was loaded -
 * main.ts's top-level `render()` - and then go away for as long as its startup
 * work took. Measured on the shipped Windows build, 2026-08-13: a town map sat on
 * screen from 6.9s to 12.7s after launch, over a network round trip nobody had
 * asked for. Two things were wrong with that and only one of them was the delay.
 * The other was that a town map is a LIE: it is a real, generated level belonging
 * to a character the player has not chosen yet, and it reads as "the game has
 * started" when nothing has.
 *
 * So the map is not painted until a game is actually in play, and this is what
 * fills the gap instead. It is deliberately not a progress bar: the work behind
 * it (mod resources, a tile atlas, a save, a version check) has no honest
 * percentage, and a bar that jumps from 30% to done is a worse lie than no bar.
 * It is a dungeon digging itself out, which is the one animation this game is
 * entitled to.
 *
 * EVERYTHING HERE IS PURE except paintScene. The scene is a value, advanced by a
 * function, seeded by a number - so a test drives a hundred frames without a
 * clock, a canvas or a random source, and the "does it ever stop moving" and
 * "does it stay inside its grid" questions are answerable rather than eyeballed.
 */

import type { GridSurface } from "./term";

/** The cadence, matching the title screen's shimmer so the two feel like one app. */
export const LOADING_FRAME_MS = 90;

/** How many carve steps one frame advances. Enough to feel alive, not a scribble. */
const STEPS_PER_FRAME = 3;

/** The glyphs the scene draws with, and the CSS they are drawn in. */
const FLOOR = ".";
const WALL = "#";
const PLAYER = "@";

const CSS_WALL = "rgb(110,110,110)";
const CSS_FLOOR = "rgb(80,80,80)";
const CSS_PLAYER = "rgb(255,255,255)";
const CSS_MONSTER = "rgb(160,60,60)";
const CSS_CAPTION = "rgb(190,180,140)";
const CSS_DIM = "rgb(90,90,90)";

/**
 * The letters that wander the carved corridors. Ordinary early-dungeon company -
 * nothing that would read as a spoiler for a floor the player has not seen.
 */
const MONSTER_GLYPHS = ["r", "c", "k", "w", "S", "j", "p"] as const;

/**
 * The lines under the scene. They cycle; none of them claims to know how much
 * longer this will take, because nothing here knows that.
 */
export const LOADING_CAPTIONS = [
  "Digging out the dungeon",
  "Rolling for wandering monsters",
  "Scattering gold in dark corners",
  "Teaching the kobolds to spell",
  "Deciding which staircase lies",
  "Filing down the sharp edges",
  "Waking something on level fifty",
] as const;

/** One thing moving around the carved floor. */
interface Wanderer {
  x: number;
  y: number;
  glyph: string;
}

/** The whole animation, as a value. */
export interface LoadingScene {
  readonly cols: number;
  readonly rows: number;
  /** Row-major carve map: 0 = untouched rock, 1 = floor, 2 = wall face. */
  readonly cells: Uint8Array;
  /** The digger, which is also where the `@` is drawn. */
  x: number;
  y: number;
  /** Its heading, as a step in each axis; changed by turnChance, never zero. */
  dx: number;
  dy: number;
  readonly wanderers: Wanderer[];
  /** Frames elapsed, which drives the caption and the wanderers' cadence. */
  frame: number;
  /** The LCG state. Display only - never the game's RNG. */
  seed: number;
}

/**
 * A 32-bit LCG, the same shape used elsewhere for display randomness.
 *
 * NOT the game's RNG, and it must never become it: this runs before a character
 * exists and would consume draws from a stream a save depends on.
 */
function next(scene: LoadingScene): number {
  scene.seed = (Math.imul(scene.seed, 1664525) + 1013904223) >>> 0;
  return scene.seed;
}

/** A number in [0, n). */
function below(scene: LoadingScene, n: number): number {
  return n <= 0 ? 0 : next(scene) % n;
}

/** The scene's playing field: the terminal, minus a row for the caption. */
export function makeScene(cols: number, rows: number, seed: number): LoadingScene {
  const w = Math.max(8, cols);
  const h = Math.max(6, rows);
  const scene: LoadingScene = {
    cols: w,
    rows: h,
    cells: new Uint8Array(w * h),
    x: w >> 1,
    y: h >> 1,
    dx: 1,
    dy: 0,
    wanderers: [],
    frame: 0,
    /* Seed 0 would leave the LCG at zero forever, which is a scene that never
     * turns and never spawns - a still image that looks like a hang. */
    seed: (seed >>> 0) || 0x1234_5678,
  };
  carve(scene, scene.x, scene.y);
  return scene;
}

/** Mark one cell as floor, and the ring around it as wall unless already floor. */
function carve(scene: LoadingScene, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= scene.cols || y >= scene.rows) return;
  scene.cells[y * scene.cols + x] = 1;
  for (let ny = y - 1; ny <= y + 1; ny++) {
    for (let nx = x - 1; nx <= x + 1; nx++) {
      if (nx < 0 || ny < 0 || nx >= scene.cols || ny >= scene.rows) continue;
      const i = ny * scene.cols + nx;
      if (scene.cells[i] === 0) scene.cells[i] = 2;
    }
  }
}

/** True where the scene has carved floor. */
export function isFloor(scene: LoadingScene, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= scene.cols || y >= scene.rows) return false;
  return scene.cells[y * scene.cols + x] === 1;
}

/**
 * One carve step: move the digger, sometimes turn, sometimes open a room.
 *
 * The digger is REFLECTED at the edges rather than clamped. Clamping makes it
 * grind along a wall for as long as its heading points that way, which is the
 * shape that made the first version look stuck in a corner.
 */
export function step(scene: LoadingScene): void {
  if (below(scene, 100) < 22) {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ] as const;
    const d = dirs[below(scene, dirs.length)] ?? dirs[0];
    scene.dx = d[0];
    scene.dy = d[1];
  }
  let nx = scene.x + scene.dx;
  let ny = scene.y + scene.dy;
  if (nx < 1 || nx >= scene.cols - 1) {
    scene.dx = -scene.dx;
    nx = scene.x + scene.dx;
  }
  if (ny < 1 || ny >= scene.rows - 1) {
    scene.dy = -scene.dy;
    ny = scene.y + scene.dy;
  }
  scene.x = nx;
  scene.y = ny;
  carve(scene, nx, ny);

  /* A room, now and then: the corridors alone read as scribble. */
  if (below(scene, 100) < 6) {
    const w = 2 + below(scene, 5);
    const h = 1 + below(scene, 3);
    for (let ry = ny - h; ry <= ny + h; ry++) {
      for (let rx = nx - w; rx <= nx + w; rx++) carve(scene, rx, ry);
    }
    /* Something moves into the room it just found. Capped, because a wanderer
     * per room over a slow boot ends up as a wall of letters. */
    if (scene.wanderers.length < 7) {
      scene.wanderers.push({
        x: nx,
        y: ny,
        glyph: MONSTER_GLYPHS[below(scene, MONSTER_GLYPHS.length)] ?? "r",
      });
    }
  }
}

/** Shuffle the wanderers one square, staying on carved floor. */
function moveWanderers(scene: LoadingScene): void {
  for (const w of scene.wanderers) {
    const dx = below(scene, 3) - 1;
    const dy = below(scene, 3) - 1;
    if (isFloor(scene, w.x + dx, w.y + dy)) {
      w.x += dx;
      w.y += dy;
    }
  }
}

/** Advance one animation frame. */
export function advance(scene: LoadingScene): void {
  for (let i = 0; i < STEPS_PER_FRAME; i++) step(scene);
  /* Every third frame: the digger is meant to look faster than the residents. */
  if (scene.frame % 3 === 0) moveWanderers(scene);
  scene.frame++;
}

/** The caption for this frame, with its animated ellipsis. */
export function captionFor(frame: number): string {
  const which = Math.floor(frame / 40) % LOADING_CAPTIONS.length;
  const dots = ".".repeat(1 + (Math.floor(frame / 6) % 3));
  return `${LOADING_CAPTIONS[which] ?? LOADING_CAPTIONS[0]}${dots}`;
}

/**
 * Draw the scene. The one impure function here, and the only one that needs a
 * terminal - so everything above it is testable without one.
 */
export function paintScene(term: GridSurface, scene: LoadingScene): void {
  term.clear();
  /* No cursor: this screen takes no input, and a block parked in a corridor
   * reads as the game waiting for a key it will never get. */
  term.hideCursor();
  for (let y = 0; y < scene.rows; y++) {
    let run = "";
    let runStart = 0;
    let runCss = CSS_WALL;
    const flush = (): void => {
      if (run.length > 0) term.print(runStart, y, run, runCss);
      run = "";
    };
    for (let x = 0; x < scene.cols; x++) {
      const cell = scene.cells[y * scene.cols + x] ?? 0;
      if (cell === 0) {
        flush();
        continue;
      }
      const ch = cell === 1 ? FLOOR : WALL;
      const css = cell === 1 ? CSS_FLOOR : CSS_WALL;
      if (run.length > 0 && css === runCss) {
        run += ch;
        continue;
      }
      flush();
      run = ch;
      runStart = x;
      runCss = css;
    }
    flush();
  }
  for (const w of scene.wanderers) term.print(w.x, w.y, w.glyph, CSS_MONSTER);
  term.print(scene.x, scene.y, PLAYER, CSS_PLAYER);

  const { cols, rows } = term.size();
  const caption = captionFor(scene.frame);
  const row = Math.max(0, rows - 2);
  term.print(Math.max(0, Math.floor((cols - caption.length) / 2)), row, caption, CSS_CAPTION);
  const sub = "Neo Angband";
  term.print(Math.max(0, Math.floor((cols - sub.length) / 2)), Math.max(0, rows - 1), sub, CSS_DIM);
}

/** What startLoading hands back: one idempotent way to take the screen down. */
export type StopLoading = () => void;

/**
 * Start the animation and return the way to stop it.
 *
 * IDEMPOTENT on purpose. Boot has more than one way out - a resolved chain, a
 * thrown mod resource, a shell with no title at all - and every one of them ends
 * with this call. A second stop must be free rather than a crash on a cleared
 * timer.
 *
 * WHO IS MEANT TO CALL IT. This screen clears and repaints the WHOLE terminal
 * eleven times a second, so for as long as it runs, nothing else on that
 * terminal can be seen - a live screen underneath takes keys and is erased
 * before the player reads a word of it. Whoever stops it therefore decides
 * whether the next screen exists at all, and that has to be ONE unconditional
 * caller at the point the terminal changes hands, never a call sitting behind
 * one of several early returns. main.ts's bootMenus owns it; #251 is what it
 * cost to learn that, and the note there is the long version.
 */
export function startLoading(
  term: GridSurface,
  deps: {
    readonly seed: number;
    readonly setInterval?: (fn: () => void, ms: number) => unknown;
    readonly clearInterval?: (handle: unknown) => void;
  },
): StopLoading {
  const { cols, rows } = term.size();
  /* Two rows are the caption's; the scene keeps off them. */
  const scene = makeScene(cols, Math.max(6, rows - 2), deps.seed);
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stopTimer = deps.clearInterval ?? ((h: unknown) => {
    clearInterval(h as ReturnType<typeof setInterval>);
  });
  paintScene(term, scene);
  let handle: unknown = every(() => {
    advance(scene);
    paintScene(term, scene);
  }, LOADING_FRAME_MS);
  return (): void => {
    if (handle === null) return;
    stopTimer(handle);
    handle = null;
  };
}
