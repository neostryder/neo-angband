import { describe, expect, it } from "vitest";
import { MFLAG } from "../generated";
import { loc, locEq } from "../loc";
import type { Loc } from "../loc";
import type { GameState, PlayerCommand } from "./context";
import { addMon, makeRace, makeState, FLOOR, GRANITE } from "./harness";
import { squareMemorize } from "./known";
import { disturb, runAction } from "./player-path";

/** Remember every in-bounds grid (the running engine reads the known map). */
function memorizeAll(state: GameState): void {
  for (let y = 0; y < state.chunk.height; y++) {
    for (let x = 0; x < state.chunk.width; x++) {
      squareMemorize(state, loc(x, y));
    }
  }
}

/**
 * Carve a straight west-east corridor at row `y` (floor from x=1 to
 * xEnd inclusive), walling the rows above and below with granite and
 * capping the corridor with granite just past xEnd.
 */
function corridor(state: GameState, y: number, xEnd: number): void {
  const c = state.chunk;
  for (let gx = 0; gx < c.width; gx++) {
    for (let gy = 0; gy < c.height; gy++) {
      c.setFeat(loc(gx, gy), GRANITE);
    }
  }
  for (let gx = 1; gx <= xEnd; gx++) c.setFeat(loc(gx, y), FLOOR);
}

/**
 * Drive a run to completion the way runGameLoop would: start it, then keep
 * draining the internal cmdQueue. Returns the grids stepped onto, in order.
 */
function driveRun(state: GameState, dir: number): Loc[] {
  const path: Loc[] = [];
  const start: PlayerCommand = { code: "run", dir };
  let used = runAction(state, start);
  if (used > 0) path.push({ ...state.actor.grid });
  let guard = 0;
  while (state.cmdQueue && state.cmdQueue.length > 0 && guard++ < 1000) {
    const cmd = state.cmdQueue.shift()!;
    used = runAction(state, cmd);
    if (used > 0) path.push({ ...state.actor.grid });
  }
  return path;
}

describe("run_init (player-path.c L1606)", () => {
  it("detects a hallway (both sides walled) and clears open-area", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 8);
    memorizeAll(state);

    /* Starting east: both diagonals are walls, so it is a hallway. */
    runAction(state, { code: "run", dir: 6 });
    expect(state.run!.openArea).toBe(false);
    expect(state.run!.breakLeft).toBe(true);
    expect(state.run!.breakRight).toBe(true);
  });

  it("treats unknown walls as open (see_wall's known-gate)", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 8);
    /* Do NOT memorize: the walls are unseen, so they are not known walls. */
    runAction(state, { code: "run", dir: 6 });
    expect(state.run!.openArea).toBe(true);
    expect(state.run!.breakLeft).toBe(false);
    expect(state.run!.breakRight).toBe(false);
  });

  it("looks for an open area when no walls are adjacent", () => {
    const state = makeState({ w: 40, h: 25, playerGrid: loc(20, 12) });
    memorizeAll(state);
    runAction(state, { code: "run", dir: 6 });
    expect(state.run!.openArea).toBe(true);
  });
});

describe("running down a corridor (run_test / run_step)", () => {
  it("follows the hallway and stops before the end wall", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 7); /* floor x=1..7, wall at x=8 */
    memorizeAll(state);

    const path = driveRun(state, 6);
    /* Ran east from (1,3) to the last floor grid (7,3), then stopped. */
    expect(locEq(state.actor.grid, loc(7, 3))).toBe(true);
    expect(path.length).toBe(6);
    expect(state.run!.running).toBe(0);
    expect(state.cmdQueue!.length).toBe(0);
  });

  it("turns to follow a corner", () => {
    /* An L-shaped corridor: east along row 3 to x=5, then south down col 5. */
    const state = makeState({ w: 10, h: 10, playerGrid: loc(1, 3) });
    const c = state.chunk;
    for (let gx = 0; gx < c.width; gx++)
      for (let gy = 0; gy < c.height; gy++) c.setFeat(loc(gx, gy), GRANITE);
    for (let gx = 1; gx <= 5; gx++) c.setFeat(loc(gx, 3), FLOOR);
    for (let gy = 3; gy <= 7; gy++) c.setFeat(loc(5, gy), FLOOR);
    memorizeAll(state);

    driveRun(state, 6);
    /* The runner rounds the bend and stops at the far end of the leg. */
    expect(locEq(state.actor.grid, loc(5, 7))).toBe(true);
  });
});

describe("running stops on disturbance", () => {
  it("stops next to a visible monster in the path", () => {
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 12) });
    memorizeAll(state);
    const mon = addMon(state, makeRace(), loc(8, 12), { hp: 30 });
    mon.mflag.on(MFLAG.VISIBLE);

    driveRun(state, 6);
    /* The "soon to be adjacent" obvious-monster check (run_test's second
     * loop) halts the runner one grid before the monster is adjacent. */
    expect(locEq(state.actor.grid, loc(6, 12))).toBe(true);
    expect(state.run!.running).toBe(0);
  });

  it("disturb() halts running and flushes the queue", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 10);
    memorizeAll(state);
    runAction(state, { code: "run", dir: 6 });
    expect(state.run!.running).toBeGreaterThan(0);
    expect(state.cmdQueue!.length).toBe(1);

    disturb(state);
    expect(state.run!.running).toBe(0);
    expect(state.cmdQueue!.length).toBe(0);
  });
});
