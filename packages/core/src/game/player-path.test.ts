import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, MFLAG, TMD } from "../generated";
import { bindTraps } from "../world/trap";
import type { TrapRecordJson } from "../world/trap";
import { placeTrap, squareIsVisibleTrap, squareRevealTrap } from "./trap";
import { DDGRID, loc, locEq, locSum } from "../loc";
import type { Loc } from "../loc";
import type { GameState, PlayerCommand } from "./context";
import { addMon, makeRace, makeState, FLOOR, GRANITE } from "./harness";
import { squareMemorize } from "./known";
import { OptionState } from "../player/options";
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

/**
 * Replay a path the way run_step does: steps come back in REVERSE order, so
 * index length-1 is the first move. Returns the grids stepped through,
 * including the start.
 */
function walkSteps(start: Loc, steps: number[]): Loc[] {
  const grids: Loc[] = [start];
  let g = start;
  for (let i = steps.length - 1; i >= 0; i--) {
    g = locSum(g, DDGRID[steps[i] as number] as Loc);
    grids.push(g);
  }
  return grids;
}

/** The Chebyshev distance, which is the step count over open passable floor. */
function chebyshev(a: Loc, b: Loc): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

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

  /*
   * The three cases below are the A*'s step sequence, hand-traced through the C
   * (player-path.c L1150-L1339 with z-queue.c's up_heap / down_heap /
   * qp_pushpop_int) rather than read off this port. They exist because
   * upstream's own comment at L1063-L1067 warns that find_path and
   * pfdistances_to_path disagree on WHICH equal-cost route they return, so a
   * cost-only assertion cannot tell a faithful A* from the composition of
   * upstream's other pair that used to stand in for it here. Each expectation
   * therefore pins the whole chain: the ddd order over the eight neighbours,
   * which neighbour is held back for qp_pushpop_int, the heap's sift order, and
   * patched_distances_to_path's backward walk.
   */
  it("A* trace: two steps east across open floor (C-derived)", () => {
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 5) });
    memorizeAll(state);
    /*
     * The C: expanding (5,5) assigns all eight neighbours distance 16 and
     * pushes seven of them, keeping (4,4) at priority 80 for qp_pushpop_int.
     * The heap root is then (6,5) at 32 (priorities: 48/48/32/80/32/80/32 with
     * up_heap's ties resolved toward the earlier push), and 80 > 32, so the pop
     * returns (6,5). Expanding (6,5) meets the destination at ddd index 2.
     * patched_distances_to_path walks back (7,5) -> (6,5) -> (5,5), both times
     * taking ddd index 3 (west) since ties never beat the running minimum.
     */
    const path = findPath(state, loc(5, 5), loc(7, 5));
    expect(path.length).toBe(2);
    expect(path.steps).toEqual([6, 6]);
  });

  it("A* trace: a diagonal-then-straight route across open floor (C-derived)", () => {
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 5) });
    memorizeAll(state);
    /*
     * Four expansions in the C - (5,5), then (6,5), (6,4) and (7,6) as the heap
     * hands them over - reach (8,6) at ddd index 2 of the fourth. The backward
     * walk is (8,6) -> (7,6) -> (6,6) -> (5,5): west, west, then north-west,
     * recorded as their opposites.
     */
    const path = findPath(state, loc(5, 5), loc(8, 6));
    expect(path.length).toBe(3);
    expect(path.steps).toEqual([6, 6, 3]);
    expect(walkSteps(loc(5, 5), path.steps)).toEqual([
      loc(5, 5),
      loc(6, 6),
      loc(7, 6),
      loc(8, 6),
    ]);
  });

  it("A* trace: picks one of two equal-cost detours round a wall (C-derived)", () => {
    /* A three-grid granite plug between start and destination, with identical
     * four-step detours north and south of it. */
    const state = makeState({ w: 8, h: 9, playerGrid: loc(1, 4) });
    for (const x of [2, 3, 4]) state.chunk.setFeat(loc(x, 4), GRANITE);
    memorizeAll(state);

    /*
     * The C explores both sides: qp_pushpop_int hands (2,3) - the northern
     * diagonal - straight back on the priority-64 tie at the end of the first
     * expansion, and the walk only crosses to the south when (4,5) ties with the
     * heap root at 64 in the fifth expansion. The route that comes out is the
     * SOUTHERN one, because patched_distances_to_path finds (4,5) at ddd index 5
     * before (4,3) at index 7 and a tie does not displace the running minimum.
     */
    const path = findPath(state, loc(1, 4), loc(5, 4));
    expect(path.length).toBe(4);
    expect(path.steps).toEqual([9, 6, 6, 3]);
    expect(walkSteps(loc(1, 4), path.steps)).toEqual([
      loc(1, 4),
      loc(2, 5),
      loc(3, 5),
      loc(4, 5),
      loc(5, 4),
    ]);
  });

  it("A* trace: the Chebyshev heuristic decides the route (C-derived)", () => {
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 12) });
    memorizeAll(state);
    /*
     * Traced through the C: three expansions - (5,12), then (6,12) which the
     * heap hands over at priority 48, then (7,11) which qp_pushpop_int hands
     * back on the 48 tie - reach (8,10) at ddd index 6 of the third. The
     * backward walk is (8,10) -> (7,11) -> (6,11) -> (5,12).
     *
     * This case exists because the heuristic is what ORDERS those expansions:
     * strip `dist_remaining` (L1200-L1212) and every priority collapses to the
     * distance alone, the walk fans out symmetrically from the start instead of
     * driving at the destination, and the route that comes back is 699 - still
     * three steps, still minimum-cost, but not the reference build's route.
     */
    const path = findPath(state, loc(5, 12), loc(8, 10));
    expect(path.length).toBe(3);
    expect(path.steps).toEqual([9, 6, 9]);
    expect(walkSteps(loc(5, 12), path.steps)).toEqual([
      loc(5, 12),
      loc(6, 11),
      loc(7, 11),
      loc(8, 10),
    ]);
  });

  it("A* trace: a grid already reached at equal cost is not re-expanded (C-derived)", () => {
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 12) });
    memorizeAll(state);
    /*
     * Six expansions in the C - (5,12), (5,13), (4,13), (6,14), (6,13), (6,15)
     * - reach (7,16) at ddd index 4 of the last, and the backward walk gives
     * south, south, south-east, south-east.
     *
     * The fifth expansion is the point: (6,13) finds (7,13) and (7,14) already
     * holding 48 from the fourth and LOWERS them to 32, because the skip test
     * at L1177 is `dist_stored <= dist_this` and 48 is not <= 32. Relax that to
     * `<` and equal-cost grids get re-expanded as well, which reorders the walk
     * and returns 2323 instead.
     */
    const path = findPath(state, loc(5, 12), loc(7, 16));
    expect(path.length).toBe(4);
    expect(path.steps).toEqual([2, 2, 3, 3]);
    expect(walkSteps(loc(5, 12), path.steps)).toEqual([
      loc(5, 12),
      loc(6, 13),
      loc(7, 14),
      loc(7, 15),
      loc(7, 16),
    ]);
  });

  it("returns a minimum-cost, contiguous, passable path over open floor", () => {
    /* Minimum cost is the property the A* shares with prepare_pfdistances (the
     * heuristic is admissible because no step costs less than PF_SCL), so it
     * holds whichever of the tied routes comes back. Over open floor that cost
     * is the Chebyshev distance. */
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 5) });
    memorizeAll(state);
    const start = loc(5, 5);
    for (const dest of [
      loc(6, 5),
      loc(5, 9),
      loc(9, 9),
      loc(12, 7),
      loc(2, 2),
      loc(30, 20),
      loc(1, 23),
      loc(38, 1),
    ]) {
      const path = findPath(state, start, dest);
      expect(path.length).toBe(chebyshev(start, dest));
      const grids = walkSteps(start, path.steps);
      expect(grids[grids.length - 1]).toEqual(dest);
      for (let i = 1; i < grids.length; i++) {
        expect(chebyshev(grids[i - 1] as Loc, grids[i] as Loc)).toBe(1);
        expect(state.chunk.isPassable(grids[i] as Loc)).toBe(true);
      }
    }
  });

  it("crosses patch boundaries (initialize_patch, 16x16 blocks)", () => {
    /* (5,5) sits in patch (0,0); (30,20) needs patches (0,1), (1,0) and (1,1)
     * allocated on the way. The 25-step path also outgrows the queue's initial
     * 4 * (2 + 25) capacity, exercising the resize at L1253. */
    const state = makeState({ w: 40, h: 25, playerGrid: loc(5, 5) });
    memorizeAll(state);
    const path = findPath(state, loc(5, 5), loc(30, 20));
    expect(path.length).toBe(25);
    const grids = walkSteps(loc(5, 5), path.steps);
    expect(grids[grids.length - 1]).toEqual(loc(30, 20));
  });

  it("falls back through a known visible trap (hit_trap retry)", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 7);
    /* A visible trap plugs the one-wide corridor. The first pass rejects it
     * (is_valid_pf with forbid_traps), exhausts the queue and - because the
     * trap is what it hit (hit_trap, L1289) - retries allowing traps. */
    const kinds = bindTraps(
      (
        JSON.parse(
          readFileSync(
            new URL("../../../content/pack/trap.json", import.meta.url),
            "utf8",
          ),
        ) as { records: TrapRecordJson[] }
      ).records,
    );
    const pit = kinds.find((k) => k.desc === "pit") as { tidx: number };
    placeTrap(state, loc(4, 3), pit.tidx, 5, { kinds });
    /* square_reveal_trap: the pathfinder only avoids traps the player has
     * NOTICED (square_isvisibletrap), not merely ones that are there. */
    squareRevealTrap(state, loc(4, 3), true, { kinds });
    memorizeAll(state);
    expect(squareIsVisibleTrap(state, loc(4, 3))).toBe(true);

    const path = findPath(state, loc(1, 3), loc(7, 3));
    expect(path.length).toBe(6);
    expect(walkSteps(loc(1, 3), path.steps)).toContainEqual(loc(4, 3));
  });

  it("falls back to grids the player does not remember (only_known retry)", () => {
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    corridor(state, 3, 7);
    /* Remember only the two ends: with only_known true every grid between them
     * is unusable, so the first pass exhausts the queue and the C retries with
     * only_known false (L1305). */
    squareMemorize(state, loc(1, 3));
    squareMemorize(state, loc(7, 3));
    const path = findPath(state, loc(1, 3), loc(7, 3));
    expect(path.length).toBe(6);
    expect(walkSteps(loc(1, 3), path.steps).at(-1)).toEqual(loc(7, 3));
  });

  it("never routes along the cave boundary, even when it is unremembered", () => {
    /* With only_known false, is_valid_pf returns TRUE for any unremembered grid
     * - including the boundary ring. What keeps the walk inside the cave is
     * initialize_patch's square_in_bounds_fully test (L691), which marks those
     * cells -1 regardless. Here the destination is two steps down the column
     * next to the west wall, so a boundary detour would tie on cost. */
    const state = makeState({ w: 12, h: 7, playerGrid: loc(1, 3) });
    squareMemorize(state, loc(1, 3));
    squareMemorize(state, loc(1, 5));
    const path = findPath(state, loc(1, 3), loc(1, 5));
    expect(path.length).toBe(2);
    for (const g of walkSteps(loc(1, 3), path.steps)) {
      expect(state.chunk.inBoundsFully(g)).toBe(true);
    }
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

describe("do_cmd_explore (cmd-cave.c:1500)", () => {
  /** A state with the western columns remembered and explore enabled. */
  function frontierState(): GameState {
    const state = makeState({ w: 12, h: 11, playerGrid: loc(3, 5) });
    /* Remember only the western columns (x=0..6); x>=7 stays unknown. */
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x <= 6; x++) squareMemorize(state, loc(x, y));
    }
    /* autoexplore_commands is OFF by default upstream (list-options.h:16-17). */
    state.options = new OptionState({
      overrides: { autoexplore_commands: true },
    });
    return state;
  }

  it("heads for the nearest remembered grid on the unknown frontier", () => {
    const state = frontierState();
    const found = pathNearestUnknown(state, loc(3, 5));
    expect(found.length).toBeGreaterThan(0);
    expect(found.dest.x).toBe(6); /* the frontier column */

    const reg = travelRegistry();
    pump(state, reg, { code: "explore" });
    expect(state.actor.grid.x).toBe(6);
  });

  it("does nothing at all when autoexplore_commands is off (L1502-1505)", () => {
    const state = frontierState();
    state.options = new OptionState(); /* shipped default: off */
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    pump(state, travelRegistry(), { code: "explore" });
    expect(state.actor.grid.x).toBe(3); /* did not move */
    expect(msgs).toEqual([]); /* and said nothing */
  });

  it("refuses while confused, and reports it (L1508-1511)", () => {
    const state = frontierState();
    state.actor.player.timed[TMD.CONFUSED] = 5;
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    pump(state, travelRegistry(), { code: "explore" });
    expect(state.actor.grid.x).toBe(3);
    expect(msgs).toContain("You cannot explore while confused.");
  });

  it("refuses with a monster in view (L1524-1527)", () => {
    const state = frontierState();
    const mon = addMon(state, makeRace({ level: 1 }), loc(4, 5));
    mon.mflag.on(MFLAG.VIEW);
    mon.mflag.on(MFLAG.VISIBLE);
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    pump(state, travelRegistry(), { code: "explore" });
    expect(msgs).toContain("Something is here.");
  });

  it("reports when there is nowhere left to explore (L1542)", () => {
    /* Everything remembered: path_nearest_unknown finds no frontier. */
    const state = makeState({ w: 12, h: 11, playerGrid: loc(3, 5) });
    memorizeAll(state);
    state.options = new OptionState({
      overrides: { autoexplore_commands: true },
    });
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    pump(state, travelRegistry(), { code: "explore" });
    expect(msgs).toContain("No apparent path for exploration.");
  });
});
