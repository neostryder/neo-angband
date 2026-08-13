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
 * THE `@` IS NOT THE DIGGER (#252). It was, for one release, and it read as the
 * player walking through solid rock - a game whose whole subject is a dungeon,
 * advertising itself with a character that ignores walls. The two are separate
 * now: the DIGGER is generation and is never drawn, and the `@` is an actor that
 * moves only onto carved floor, under the movement rule the real game uses.
 * Once it is obeying walls it may as well be playing, so it does: wanderers that
 * notice it give chase, it fights what it can and runs from what it cannot, and
 * it never dies (see hurtPlayer - a tombstone on a loading screen would be a
 * lie about a character that does not exist yet).
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
 * The eight steps, in the order the scene picks them. Orthogonals first, which
 * is only a taste in the digger and load-bearing in the chase: a pursuer that
 * tries the diagonal first hugs corners and looks like it is sliding.
 */
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
] as const;

/**
 * How far a wanderer notices the `@`. Short on purpose: something that beelines
 * from across the screen reads as a homing missile rather than a resident.
 */
const MONSTER_SIGHT = 9;

/** The `@`'s hit points, and the level at which it stops fighting and runs. */
const PLAYER_MAX_HP = 12;
const PLAYER_FLEES_BELOW = 5;

/** A wanderer's hit points - two or three blows, so a fight is readable. */
const MONSTER_HP = 3;

/** Frames between the `@` recovering a point while nothing is near it. */
const REGEN_FRAMES = 24;

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
  /** Down to zero and it is gone. The `@` is the only thing that lowers it. */
  hp: number;
}

/** The whole animation, as a value. */
export interface LoadingScene {
  readonly cols: number;
  readonly rows: number;
  /** Row-major carve map: 0 = untouched rock, 1 = floor, 2 = wall face. */
  readonly cells: Uint8Array;
  /**
   * The `@`. It is drawn; it is not the digger; and every move it makes is onto
   * a cell `isFloor` already returns true for.
   */
  x: number;
  y: number;
  /** Its heading, so exploring reads as walking a corridor rather than jittering. */
  pdx: number;
  pdy: number;
  /** Where it came from, so it does not shuffle between two squares forever. */
  lastX: number;
  lastY: number;
  /** Hit points. Never reaches zero - see hurtPlayer. */
  hp: number;
  /**
   * The DIGGER: what makes the dungeon appear. Never drawn, and deliberately
   * not bound by the floor rule, because it is the thing that creates floor.
   */
  digX: number;
  digY: number;
  /** The digger's heading, as a step in each axis; changed on a turn, never zero. */
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
    pdx: 0,
    pdy: 0,
    lastX: w >> 1,
    lastY: h >> 1,
    hp: PLAYER_MAX_HP,
    digX: w >> 1,
    digY: h >> 1,
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
    const d = DIRS[below(scene, DIRS.length)] ?? DIRS[0];
    scene.dx = d[0];
    scene.dy = d[1];
  }
  let nx = scene.digX + scene.dx;
  let ny = scene.digY + scene.dy;
  if (nx < 1 || nx >= scene.cols - 1) {
    scene.dx = -scene.dx;
    nx = scene.digX + scene.dx;
  }
  if (ny < 1 || ny >= scene.rows - 1) {
    scene.dy = -scene.dy;
    ny = scene.digY + scene.dy;
  }
  scene.digX = nx;
  scene.digY = ny;
  carve(scene, nx, ny);

  /* A room, now and then: the corridors alone read as scribble. */
  if (below(scene, 100) < 6) {
    const w = 2 + below(scene, 5);
    const h = 1 + below(scene, 3);
    for (let ry = ny - h; ry <= ny + h; ry++) {
      for (let rx = nx - w; rx <= nx + w; rx++) carve(scene, rx, ry);
    }
    /* Something moves into the room it just found. Capped, because a wanderer
     * per room over a slow boot ends up as a wall of letters. Not on top of the
     * `@`: a monster appearing in its face is a jump scare, not a dungeon. */
    if (scene.wanderers.length < 7 && chebyshev(nx, ny, scene.x, scene.y) > 3) {
      scene.wanderers.push({
        x: nx,
        y: ny,
        glyph: MONSTER_GLYPHS[below(scene, MONSTER_GLYPHS.length)] ?? "r",
        hp: MONSTER_HP,
      });
    }
  }
}

/** Chebyshev distance - the one that matches an eight-way step. */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** The carved squares one step from here. The whole of the movement rule. */
function floorSteps(scene: LoadingScene, x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const [dx, dy] of DIRS) {
    if (isFloor(scene, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  }
  return out;
}

/** How far the nearest wanderer is, or Infinity while the `@` has the place to itself. */
function nearestMonster(scene: LoadingScene): number {
  let best = Infinity;
  for (const w of scene.wanderers) best = Math.min(best, chebyshev(w.x, w.y, scene.x, scene.y));
  return best;
}

/**
 * Take a hit.
 *
 * THE `@` DOES NOT DIE HERE. There is no character yet - that is the entire
 * reason this screen exists - so a tombstone would be a death notice for
 * somebody who has not been rolled, and "the game killed me before it started"
 * is a poor first impression to have engineered on purpose. It escapes instead,
 * which is at least a thing Angband characters really do, and comes back
 * somewhere else on the floor with its wind back.
 */
function hurtPlayer(scene: LoadingScene): void {
  scene.hp -= 1;
  if (scene.hp > 0) return;
  scene.hp = PLAYER_MAX_HP;
  /* Twenty tries rather than a scan: the scene is mostly rock early on, and a
   * scan taking the FIRST floor cell would blink to the same corner every time. */
  for (let i = 0; i < 20; i++) {
    const x = below(scene, scene.cols);
    const y = below(scene, scene.rows);
    if (!isFloor(scene, x, y)) continue;
    if (scene.wanderers.some((w) => chebyshev(w.x, w.y, x, y) <= 3)) continue;
    scene.lastX = scene.x;
    scene.lastY = scene.y;
    scene.x = x;
    scene.y = y;
    return;
  }
  /* Nowhere to go - very early, or a crowded little dungeon. Standing and
   * breathing is better than blinking into rock. */
}

/** Move the `@` off the square it is on, and remember where it came from. */
function walkTo(scene: LoadingScene, x: number, y: number): void {
  scene.pdx = x - scene.x;
  scene.pdy = y - scene.y;
  scene.lastX = scene.x;
  scene.lastY = scene.y;
  scene.x = x;
  scene.y = y;
}

/**
 * The `@`'s turn: fight what is next to it, run from what it cannot fight, and
 * otherwise get on with exploring.
 *
 * Exported so a test can drive it with the digger held still. That matters more
 * than it looks: the digger CARVES the square it steps onto, so "the `@` is
 * standing on floor" is true of the old, broken version too, and a test built
 * on it would pass while the bug was back. With the map frozen, "it only moves
 * onto floor" and "it changes no cell" are statements about the `@` alone.
 */
export function playerTurn(scene: LoadingScene): void {
  const afraid = scene.hp <= PLAYER_FLEES_BELOW;
  const adjacent = scene.wanderers.find((w) => chebyshev(w.x, w.y, scene.x, scene.y) <= 1);

  if (adjacent !== undefined && !afraid) {
    adjacent.hp -= below(scene, 3) === 0 ? 2 : 1;
    if (adjacent.hp <= 0) scene.wanderers.splice(scene.wanderers.indexOf(adjacent), 1);
    return;
  }

  const steps = floorSteps(scene, scene.x, scene.y);
  if (steps.length === 0) return;

  if (afraid && nearestMonster(scene) <= MONSTER_SIGHT) {
    /* Away from the nearest one, which is not the same as away from all of them
     * - but a fleeing `@` that solves an optimisation problem does not look
     * like one. */
    let best = steps[0] as { x: number; y: number };
    let bestGap = -1;
    for (const s of steps) {
      let gap = Infinity;
      for (const w of scene.wanderers) gap = Math.min(gap, chebyshev(w.x, w.y, s.x, s.y));
      if (gap > bestGap) {
        bestGap = gap;
        best = s;
      }
    }
    walkTo(scene, best.x, best.y);
    return;
  }

  /* Keep going the way it was going, most of the time: a walk that re-rolls
   * every frame reads as a fly in a jar rather than somebody exploring. */
  const ahead = { x: scene.x + scene.pdx, y: scene.y + scene.pdy };
  if ((scene.pdx !== 0 || scene.pdy !== 0) && isFloor(scene, ahead.x, ahead.y) && below(scene, 100) < 72) {
    walkTo(scene, ahead.x, ahead.y);
    return;
  }
  /* Anywhere but back, unless back is the only way - which in a dead end it is. */
  const forward = steps.filter((s) => s.x !== scene.lastX || s.y !== scene.lastY);
  const from = forward.length > 0 ? forward : steps;
  const pick = (from[below(scene, from.length)] ?? from[0]) as { x: number; y: number };
  walkTo(scene, pick.x, pick.y);
}

/**
 * The wanderers' turn: chase the `@` if they have noticed it, swing at it if
 * they are on top of it, and otherwise shuffle about as they always did.
 *
 * Exported for the same reason as playerTurn, and the reason is sharper here. A
 * test that runs whole frames and waits for something to end up next to the `@`
 * measures NOTHING: the idle shuffle produces that on its own within a boot, so
 * the assertion passed with chasing switched off entirely (control run, #252).
 * Driving this directly against a staged corridor is what separates a pursuer
 * from a drunkard.
 */
export function monsterTurn(scene: LoadingScene): void {
  for (const w of scene.wanderers) {
    const d = chebyshev(w.x, w.y, scene.x, scene.y);
    if (d <= 1) {
      /* Not every frame. Three of them adjacent, each landing a blow per frame,
       * empties the `@` in four - which is a mugging, not a fight. */
      if (below(scene, 3) === 0) hurtPlayer(scene);
      continue;
    }
    if (d <= MONSTER_SIGHT) {
      const sx = Math.sign(scene.x - w.x);
      const sy = Math.sign(scene.y - w.y);
      /* Straight at it, then either axis alone. The cheapest thing that gets
       * around a corner without a pathfinder, and a chase that sometimes loses
       * its quarry to a wall is the correct amount of clever for a loading
       * screen. */
      for (const [dx, dy] of [
        [sx, sy],
        [sx, 0],
        [0, sy],
      ] as const) {
        if ((dx !== 0 || dy !== 0) && isFloor(scene, w.x + dx, w.y + dy)) {
          w.x += dx;
          w.y += dy;
          break;
        }
      }
      continue;
    }
    /* Every third frame while it has noticed nothing: the residents are meant
     * to look slower than the digging. */
    if (scene.frame % 3 !== 0) continue;
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
  playerTurn(scene);
  monsterTurn(scene);
  if (scene.frame % REGEN_FRAMES === 0 && scene.hp < PLAYER_MAX_HP && nearestMonster(scene) > MONSTER_SIGHT) {
    scene.hp += 1;
  }
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
