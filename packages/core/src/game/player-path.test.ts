import { describe, expect, it } from "vitest";
import { FEAT, MFLAG } from "../generated";
import { loc, locEq } from "../loc";
import type { Loc } from "../loc";
import type { GameState, PlayerCommand } from "./context";
import { addMon, makeRace, makeState, FLOOR, GRANITE } from "./harness";
import { squareMemorize } from "./known";
import {
  disturb,
  exploreAction,
  findPath,
  installRunning,
  pathNearestUnknown,
  pathfindAction,
  pathfindDirectionTo,
  runAction,
} from "./player-path";
import { createDefaultRegistry } from "./player-turn";
import type { ActionRegistry } from "./player-turn";
import { installCaveCommands } from "./cave-cmd";

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

  it("stops at a non-ignored floor object but runs past ignored ones", () => {
    const mk = () => {
      const s = makeState({ w: 14, h: 7, playerGrid: loc(1, 3) });
      corridor(s, 3, 12);
      memorizeAll(s);
      s.floor.set(3 * s.chunk.width + 6, [{} as never]); /* object at (6,3) */
      return s;
    };
    /* No ignore hook: the object blocks, stopping the run beside it. */
    const blocked = mk();
    driveRun(blocked, 6);
    expect(blocked.actor.grid.x).toBe(5);

    /* With the object ignored, the run passes over it to the end wall. */
    const past = mk();
    past.isIgnored = () => true;
    driveRun(past, 6);
    expect(past.actor.grid.x).toBe(12);
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

/* Pump the internal command queue through a registry the way processPlayer
 * would, so travel self-continues (and can push open / tunnel commands). */
function pump(state: GameState, reg: ActionRegistry, first: PlayerCommand): void {
  (reg.get(first.code) ?? (() => 0))(state, first);
  let guard = 0;
  while (state.cmdQueue && state.cmdQueue.length > 0 && guard++ < 3000) {
    const cmd = state.cmdQueue.shift()!;
    (reg.get(cmd.code) ?? (() => 0))(state, cmd);
  }
}

function travelRegistry(): ActionRegistry {
  const reg = createDefaultRegistry();
  installRunning(reg);
  installCaveCommands(reg, {});
  return reg;
}

describe("pathfind_direction_to (player-path.c L1347)", () => {
  it("prefers diagonals within a factor of two, else a cardinal", () => {
    expect(pathfindDirectionTo(loc(0, 0), loc(3, 0))).toBe(6); /* E */
    expect(pathfindDirectionTo(loc(0, 0), loc(0, 3))).toBe(2); /* S */
    expect(pathfindDirectionTo(loc(0, 0), loc(3, 3))).toBe(3); /* SE */
    expect(pathfindDirectionTo(loc(3, 3), loc(0, 0))).toBe(7); /* NW */
    expect(pathfindDirectionTo(loc(0, 0), loc(0, 0))).toBe(5); /* none */
  });
});

describe("find_path (player-path.c L1069)", () => {
  it("returns a straight-line path down a corridor", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 7);
    memorizeAll(state);
    const path = findPath(state, loc(1, 3), loc(7, 3));
    expect(path.length).toBe(6);
    /* Reverse order: every step is east (6). */
    expect(path.steps.every((d) => d === 6)).toBe(true);
  });

  it("reports zero for the start and -1 for the unreachable", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 7);
    memorizeAll(state);
    expect(findPath(state, loc(1, 3), loc(1, 3)).length).toBe(0);
    /* A walled-off cell (the granite above the corridor) is unreachable. */
    expect(findPath(state, loc(1, 3), loc(3, 1)).length).toBe(-1);
  });
});

describe("do_cmd_pathfind (travel)", () => {
  it("walks the player to a clicked destination", () => {
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 5) });
    memorizeAll(state);
    const reg = travelRegistry();
    pump(state, reg, { code: "pathfind", args: { dest: loc(15, 12) } });
    expect(locEq(state.actor.grid, loc(15, 12))).toBe(true);
    expect(state.run!.stepCount).toBe(0);
    expect(state.cmdQueue!.length).toBe(0);
  });

  it("auto-opens a closed door in the path and continues", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 7);
    state.chunk.setFeat(loc(4, 3), FEAT.CLOSED); /* a closed door mid-corridor */
    memorizeAll(state);
    const reg = travelRegistry();
    pump(state, reg, { code: "pathfind", args: { dest: loc(7, 3) } });
    expect(locEq(state.actor.grid, loc(7, 3))).toBe(true);
    expect(state.chunk.feat(loc(4, 3))).toBe(FEAT.OPEN); /* opened en route */
  });
});

describe("do_cmd_explore (path_nearest_unknown)", () => {
  it("heads for the nearest remembered grid on the unknown frontier", () => {
    const state = makeState({ w: 12, h: 11, playerGrid: loc(3, 5) });
    /* Remember only the western columns (x=0..6); x>=7 stays unknown. */
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x <= 6; x++) squareMemorize(state, loc(x, y));
    }
    const found = pathNearestUnknown(state, loc(3, 5));
    expect(found.length).toBeGreaterThan(0);
    expect(found.dest.x).toBe(6); /* the frontier column */

    const reg = travelRegistry();
    pump(state, reg, { code: "explore" });
    expect(state.actor.grid.x).toBe(6);
  });
});
