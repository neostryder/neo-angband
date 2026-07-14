/**
 * Dungeon generation utilities, ported from reference/src/gen-util.c and the
 * gen-room.c geometry helpers (Angband 4.2.6), plus the dun_data-style
 * bookkeeping structure from generate.h and the low-level monster/object
 * placement wiring.
 *
 * DIVERGENCES BY DESIGN (ledgered in parity/ledger/gen-framework.yaml):
 * - The upstream Chunk stores objects and traps as pointer piles on each
 *   square; this port's Chunk only stores a monster index and no object or
 *   trap handles (those domains attach later via world integration). During
 *   generation we therefore track placed objects, placed monsters, and trap
 *   grids on the Gen context and mirror monster occupancy into the Chunk's
 *   mon array so square_isempty / square_canputitem behave exactly as
 *   upstream for placement decisions.
 * - place_trap only records the grid (no trap object is created; the trap
 *   domain is not ported).
 * - Monster group/escort spawning (mon-make.c place_new_monster /
 *   place_friends / place_new_monster_group) is ported; group indices are
 *   allocated from a per-generation counter and recorded on each monster's
 *   group_info, and the live GameState rebuilds its group structures from
 *   them at start (the savefile-loading path of monster_group_assign).
 *   Unique cur_num tracking is kept level-local so a unique appears at most
 *   once per level without mutating the shared registry.
 */

import { FEAT, RF, SQUARE } from "../generated";
import type { Loc } from "../loc";
import {
  DDGRID,
  DDGRID_DDD,
  distance,
  loc,
  locDiff,
  locEq,
  locSum,
} from "../loc";
import type { Rng } from "../rng";
import type { Constants } from "../constants";
import type { Chunk } from "../world/chunk";
import {
  featIsBright,
  featIsFloor,
  featIsPassable,
  featIsSmooth,
} from "../world/chunk";
import { GET_ANGLE_TO_GRID } from "../world/project";
import type { FeatureRegistry } from "../world/feature";
import type { GameObject } from "../obj/object";
import type { MakeDeps, MakeObjectRating } from "../obj/make";
import { makeGold, makeObject } from "../obj/make";
import type { Monster, MonsterGroupInfo } from "../mon/monster";
import { createMonster, type MonAllocTable } from "../mon/make";
import type { MonsterRace } from "../mon/types";
import type { ResolvedPit } from "./gen-monster";
import { MON_GROUP } from "../mon/types";
import { scatterExt } from "../world/scatter";

/* ------------------------------------------------------------------ *
 * Keypad direction helpers (z-type.h / cave.c next_grid).
 * ------------------------------------------------------------------ */

export const DIR_NONE = 5;
export const DIR_N = 8;
export const DIR_S = 2;
export const DIR_E = 6;
export const DIR_W = 4;
export const DIR_NE = 9;
export const DIR_NW = 7;
export const DIR_SE = 3;
export const DIR_SW = 1;

/** next_grid: the neighbour of grid in keypad direction dir. */
export function nextGrid(grid: Loc, dir: number): Loc {
  const d = DDGRID[dir] as Loc;
  return loc(grid.x + d.x, grid.y + d.y);
}

/** grid_to_i / i_to_grid (index <-> location in a width-w area). */
export function gridToI(grid: Loc, w: number): number {
  return grid.y * w + grid.x;
}

export function iToGrid(i: number, w: number): Loc {
  return loc(i % w, Math.trunc(i / w));
}

/** shuffle: Knuth shuffle, faithful RNG order. */
export function shuffle(rng: Rng, arr: number[], n: number): void {
  for (let i = 0; i < n; i++) {
    const j = rng.randint0(n - i) + i;
    const k = arr[j] as number;
    arr[j] = arr[i] as number;
    arr[i] = k;
  }
}

/* ------------------------------------------------------------------ *
 * dun_data bookkeeping (generate.h struct dun_data).
 * ------------------------------------------------------------------ */

/** A connection to an adjacent level (persistent-level stairs). */
export interface Connector {
  grid: Loc;
  feat: number;
}

/**
 * The mutable state a level builder threads through room allocation,
 * tunneling and stair placement. One per generation attempt.
 */
export class Dun {
  /** Centres of placed rooms (index is the room number). */
  readonly cent: Loc[] = [];
  centN = 0;

  /** Marked entrance points, per room, plus a reverse lookup by grid. */
  readonly ent: Loc[][] = [];
  readonly entN: number[] = [];
  /** ent2room[y * width + x] = room index, or -1. */
  ent2room: Int32Array = new Int32Array(0);

  /** Candidate door / wall-piercing / tunnel grids for the current tunnel. */
  readonly door: Loc[] = [];
  doorN = 0;
  readonly wall: Loc[] = [];
  wallN = 0;
  readonly tunn: Loc[] = [];
  tunnN = 0;

  /** Block grid dimensions and counts. */
  blockHgt = 1;
  blockWid = 1;
  rowBlocks = 0;
  colBlocks = 0;
  /** room_map[by][bx] = block reserved. */
  roomMap: boolean[][] = [];

  pitNum = 0;
  quest = false;
  persist = false;

  /** Persistent-level connection info (empty for non-persistent levels). */
  join: Connector[] = [];
  oneOffAbove: Connector[] = [];
  oneOffBelow: Connector[] = [];
  currJoin: Connector | null = null;
  nstairRoom = 0;

  constructor(private readonly constants: Constants) {}

  get levelRoomMax(): number {
    return this.constants.levelRoomMax;
  }
  get levelDoorMax(): number {
    return this.constants.levelDoorMax;
  }
  get wallPierceMax(): number {
    return this.constants.wallPierceMax;
  }
  get tunnGridMax(): number {
    return this.constants.tunnGridMax;
  }
  get levelPitMax(): number {
    return this.constants.levelPitMax;
  }

  /** reset_entrance_data: clear per-room entrances and the reverse lookup. */
  resetEntranceData(c: Chunk): void {
    for (let i = 0; i < this.levelRoomMax; i++) {
      this.entN[i] = 0;
      this.ent[i] = [];
    }
    this.ent2room = new Int32Array(c.height * c.width).fill(-1);
  }
}

/* ------------------------------------------------------------------ *
 * Object generation dependencies.
 * ------------------------------------------------------------------ */

/** Monster placement dependencies. */
export interface MonPlaceDeps {
  table: MonAllocTable;
  /**
   * Resolved pit profiles (set_pit_type / mon_pit_hook), when themed pit,
   * nest and chamber generation is wired. Absent for bare unit-test contexts;
   * builders that need theming bail (empty room) when it is missing.
   */
  pits?: ResolvedPit[];
}

/** Tunnel parameters read by build_tunnel (cave_profile.tun). */
export interface TunnelParams {
  rnd: number;
  chg: number;
  con: number;
  pen: number;
  jct: number;
}

/** Streamer parameters read by build_streamer (cave_profile.str). */
export interface StreamerParams {
  den: number;
  rng: number;
  mag: number;
  mc: number;
  qua: number;
  qc: number;
}

const ZERO_TUNNEL: TunnelParams = { rnd: 0, chg: 0, con: 0, pen: 0, jct: 0 };
const ZERO_STREAMER: StreamerParams = { den: 0, rng: 0, mag: 0, mc: 0, qua: 0, qc: 0 };

export interface PlacedObject {
  grid: Loc;
  obj: GameObject;
}

export interface PlacedMonster {
  grid: Loc;
  mon: Monster;
  index: number;
}

/**
 * The generation context: the chunk under construction plus the RNG, feature
 * registry, constants, dun bookkeeping, and the placement side-tables the
 * upstream Chunk stores directly. Passed to every builder and placement
 * helper.
 */
export class Gen {
  readonly objects: PlacedObject[] = [];
  readonly monsters: PlacedMonster[] = [];
  /** grid index -> square holds a generated object. */
  readonly objOccupied = new Set<number>();
  /** grid index -> square holds a trap (player trap for gen purposes). */
  readonly trapGrids = new Set<number>();
  /** Doors rolled locked at generation (grid + 1d7 lock power). */
  readonly lockedDoors: Array<{ grid: Loc; power: number }> = [];
  /** ridx of uniques already placed on this level. */
  private readonly placedUniques = new Set<number>();
  private monCounter = 0;
  private groupCounter = 0;
  /** The player start, set by the cave builder via new_player_spot. */
  playerSpot: Loc | null = null;
  /** Current tunnel/streamer parameters (set by the cave builder). */
  profileTun: TunnelParams = ZERO_TUNNEL;
  profileStr: StreamerParams = ZERO_STREAMER;

  constructor(
    readonly c: Chunk,
    readonly rng: Rng,
    readonly reg: FeatureRegistry,
    readonly constants: Constants,
    readonly dun: Dun,
    /** Object-make dependencies, or null to skip object placement. */
    readonly objDeps: MakeDeps | null,
    /** Monster-placement dependencies, or null to skip monster placement. */
    readonly monDeps: MonPlaceDeps | null,
  ) {}

  get depth(): number {
    return this.c.depth;
  }

  private idx(grid: Loc): number {
    return grid.y * this.c.width + grid.x;
  }

  /** square_istrap-ish: a generated trap occupies this grid. */
  hasTrap(grid: Loc): boolean {
    return this.trapGrids.has(this.idx(grid));
  }

  /** square_object-ish: a generated object occupies this grid. */
  hasObject(grid: Loc): boolean {
    return this.objOccupied.has(this.idx(grid));
  }

  markTrap(grid: Loc): void {
    this.trapGrids.add(this.idx(grid));
  }

  /** Attach a generated object; mirrors floor_carry + list_object. */
  addObject(grid: Loc, obj: GameObject): void {
    this.objects.push({ grid, obj });
    this.objOccupied.add(this.idx(grid));
  }

  /** Assign a fresh monster index (upstream indices start at 1). */
  nextMonIndex(): number {
    return ++this.monCounter;
  }

  /**
   * monster_group_index_new for generation: a fresh group index. The live
   * GameState rebuilds its group structures from these at start.
   */
  nextGroupIndex(): number {
    return ++this.groupCounter;
  }

  attachMonster(grid: Loc, mon: Monster, index: number): void {
    mon.grid = grid;
    mon.midx = index;
    this.c.setMon(grid, index);
    this.monsters.push({ grid, mon, index });
    if (mon.race.flags.has(RF.UNIQUE)) {
      this.placedUniques.add(mon.race.ridx);
    }
  }

  uniqueAlreadyPlaced(race: MonsterRace): boolean {
    return this.placedUniques.has(race.ridx);
  }
}

/* ------------------------------------------------------------------ *
 * Square predicates that the upstream generation code needs and which are
 * not (or cannot be) on the Chunk because they depend on generated objects
 * and traps.
 * ------------------------------------------------------------------ */

/** square_isopen: floor with no monster. */
export function squareIsOpen(g: Gen, grid: Loc): boolean {
  return g.c.isFloor(grid) && g.c.mon(grid) === 0;
}

/** square_isempty: open with no object and no player trap. */
export function squareIsEmpty(g: Gen, grid: Loc): boolean {
  if (!g.c.inBounds(grid)) return false;
  if (g.hasTrap(grid)) return false;
  return squareIsOpen(g, grid) && !g.hasObject(grid);
}

/** square_isarrivable: reachable landing spot. */
export function squareIsArrivable(g: Gen, grid: Loc): boolean {
  if (g.c.mon(grid) !== 0) return false;
  if (g.hasTrap(grid)) return false;
  if (g.c.isFloor(grid)) return true;
  if (g.c.isStairs(grid)) return true;
  return false;
}

/** square_canputitem: object-holding, untrapped, unoccupied. */
export function squareCanPutItem(g: Gen, grid: Loc): boolean {
  if (!g.c.isObjectHolding(grid)) return false;
  if (g.hasTrap(grid)) return false;
  return !g.hasObject(grid);
}

/** square_isroom (SQUARE_ROOM flag). */
export function squareIsRoom(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE.ROOM);
}

/** square_isvault (SQUARE_VAULT flag). */
export function squareIsVault(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE.VAULT);
}

/** square_isno_stairs (SQUARE_NO_STAIRS flag). */
export function squareIsNoStairs(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE.NO_STAIRS);
}

/** square_iswall_outer (cave-square.c L514): the SQUARE_WALL_OUTER flag alone. */
export function squareIswallOuter(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE.WALL_OUTER);
}

/** square_is_granite_with_flag. */
export function squareIsGraniteWithFlag(
  c: Chunk,
  grid: Loc,
  flag: number,
): boolean {
  return c.isGranite(grid) && c.sqinfoHas(grid, flag);
}

/** square_isstrongwall: mineral wall or permanent. */
export function squareIsStrongWall(c: Chunk, grid: Loc): boolean {
  return c.isMineralWall(grid) || c.isPerm(grid);
}

/** count_neighbors: matches among the (up to 9) neighbours in ddd order. */
export function countNeighbors(
  c: Chunk,
  grid: Loc,
  test: (c: Chunk, grid: Loc) => boolean,
  under: boolean,
): number {
  const dlim = under ? 9 : 8;
  let count = 0;
  for (let d = 0; d < dlim; d++) {
    const off = DDGRID_DDD[d] as Loc;
    const g = loc(grid.x + off.x, grid.y + off.y);
    if (!c.inBounds(g)) continue;
    if (test(c, g)) count++;
  }
  return count;
}

/** square_num_walls_adjacent: cardinal wall neighbours. */
export function squareNumWallsAdjacent(c: Chunk, grid: Loc): number {
  let k = 0;
  for (const dir of [DIR_S, DIR_N, DIR_E, DIR_W]) {
    if (c.isWall(nextGrid(grid, dir))) k++;
  }
  return k;
}

/** square_num_walls_diagonal: diagonal wall neighbours. */
export function squareNumWallsDiagonal(c: Chunk, grid: Loc): number {
  let k = 0;
  for (const dir of [DIR_SE, DIR_NW, DIR_NE, DIR_SW]) {
    if (c.isWall(nextGrid(grid, dir))) k++;
  }
  return k;
}

/** square_suits_stairs_well. */
export function squareSuitsStairsWell(g: Gen, grid: Loc): boolean {
  if (squareIsVault(g.c, grid) || squareIsNoStairs(g.c, grid)) return false;
  return (
    squareNumWallsAdjacent(g.c, grid) === 3 &&
    squareNumWallsDiagonal(g.c, grid) === 4 &&
    squareIsEmpty(g, grid)
  );
}

/** square_suits_stairs_ok. */
export function squareSuitsStairsOk(g: Gen, grid: Loc): boolean {
  if (squareIsVault(g.c, grid) || squareIsNoStairs(g.c, grid)) return false;
  return (
    squareNumWallsAdjacent(g.c, grid) === 2 &&
    squareNumWallsDiagonal(g.c, grid) === 4 &&
    squareIsEmpty(g, grid)
  );
}

/* ------------------------------------------------------------------ *
 * Randomised rectangular search (cave_find_init / get_grid / cave_find).
 * ------------------------------------------------------------------ */

/**
 * A left-to-right, top-to-bottom index list drawn in a uniformly random
 * order without replacement, exactly as cave_find_get_grid() does.
 */
export class CaveFinder {
  private readonly order: number[];
  private readonly n: number;
  private readonly stride: number;
  private readonly x0: number;
  private readonly y0: number;
  private next = 0;

  constructor(topLeft: Loc, bottomRight: Loc) {
    const dx = bottomRight.x - topLeft.x;
    const dy = bottomRight.y - topLeft.y;
    this.n = dx < 0 || dy < 0 ? 0 : (dx + 1) * (dy + 1);
    this.stride = dx + 1;
    this.x0 = topLeft.x;
    this.y0 = topLeft.y;
    this.order = new Array<number>(this.n);
    for (let i = 0; i < this.n; i++) this.order[i] = i;
  }

  reset(): void {
    this.next = 0;
  }

  /** Draw the next random grid, or null when exhausted. */
  get(rng: Rng): Loc | null {
    if (this.next >= this.n) return null;
    const j = rng.randint0(this.n - this.next) + this.next;
    const k = this.order[j] as number;
    this.order[j] = this.order[this.next] as number;
    this.order[this.next] = k;
    this.next++;
    return loc((k % this.stride) + this.x0, Math.trunc(k / this.stride) + this.y0);
  }
}

/** cave_find_in_range: first grid in the rectangle satisfying pred. */
export function caveFindInRange(
  c: Chunk,
  rng: Rng,
  topLeft: Loc,
  bottomRight: Loc,
  pred: (c: Chunk, grid: Loc) => boolean,
): Loc | null {
  const finder = new CaveFinder(topLeft, bottomRight);
  for (;;) {
    const grid = finder.get(rng);
    if (!grid) return null;
    if (pred(c, grid)) return grid;
  }
}

/** cave_find: first grid in the whole chunk satisfying pred. */
export function caveFind(
  c: Chunk,
  rng: Rng,
  pred: (c: Chunk, grid: Loc) => boolean,
): Loc | null {
  return caveFindInRange(c, rng, loc(0, 0), loc(c.width - 1, c.height - 1), pred);
}

/** find_empty: a random empty square anywhere in the chunk. */
export function findEmpty(g: Gen): Loc | null {
  return caveFind(g.c, g.rng, (_c, grid) => squareIsEmpty(g, grid));
}

/** find_nearby_grid: a fully-in-bounds grid within +/- yd, xd of centre. */
export function findNearbyGrid(
  c: Chunk,
  rng: Rng,
  centre: Loc,
  yd: number,
  xd: number,
): Loc | null {
  return caveFindInRange(
    c,
    rng,
    loc(centre.x - xd, centre.y - yd),
    loc(centre.x + xd, centre.y + yd),
    (cc, grid) => cc.inBoundsFully(grid),
  );
}

/* ------------------------------------------------------------------ *
 * Directions (correct_dir / rand_dir).
 * ------------------------------------------------------------------ */

function cmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** correct_dir: a cardinal step from grid1 toward grid2 (random if diagonal). */
export function correctDir(rng: Rng, grid1: Loc, grid2: Loc): Loc {
  let ox = cmp(grid2.x, grid1.x);
  let oy = cmp(grid2.y, grid1.y);
  if (ox !== 0 && oy !== 0) {
    if (rng.randint0(100) < 50) oy = 0;
    else ox = 0;
  }
  return loc(ox, oy);
}

/** rand_dir: a random cardinal offset. */
export function randDir(rng: Rng): Loc {
  return DDGRID_DDD[rng.randint0(4)] as Loc;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers (gen-room.c fill/draw/mark, set_marked_granite).
 * ------------------------------------------------------------------ */

/** generate_room: mark a rectangle as room (and lit, if light). */
export function generateRoom(
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  light: boolean,
): void {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      c.sqinfoOn(loc(x, y), SQUARE.ROOM);
      if (light) c.sqinfoOn(loc(x, y), SQUARE.GLOW);
    }
  }
}

/** generate_mark: set a sqinfo flag over a rectangle. */
export function generateMark(
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  flag: number,
): void {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      c.sqinfoOn(loc(x, y), flag);
    }
  }
}

/** fill_rectangle: set a feature over a rectangle, optionally marking. */
export function fillRectangle(
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  feat: number,
  flag: number,
): void {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) c.setFeat(loc(x, y), feat);
  }
  if (flag) generateMark(c, y1, x1, y2, x2, flag);
}

/** draw_rectangle: set a feature around the border of a rectangle. */
export function drawRectangle(
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  feat: number,
  flag: number,
  overwritePerm: boolean,
): void {
  for (let y = y1; y <= y2; y++) {
    if (overwritePerm || !c.isPerm(loc(x1, y))) c.setFeat(loc(x1, y), feat);
    if (overwritePerm || !c.isPerm(loc(x2, y))) c.setFeat(loc(x2, y), feat);
  }
  if (flag) {
    generateMark(c, y1, x1, y2, x1, flag);
    generateMark(c, y1, x2, y2, x2, flag);
  }
  for (let x = x1; x <= x2; x++) {
    if (overwritePerm || !c.isPerm(loc(x, y1))) c.setFeat(loc(x, y1), feat);
    if (overwritePerm || !c.isPerm(loc(x, y2))) c.setFeat(loc(x, y2), feat);
  }
  if (flag) {
    generateMark(c, y1, x1, y1, x2, flag);
    generateMark(c, y2, x1, y2, x2, flag);
  }
}

function fillXrange(
  c: Chunk,
  y: number,
  x1: number,
  x2: number,
  feat: number,
  flag: number,
  light: boolean,
): void {
  for (let x = x1; x <= x2; x++) {
    const grid = loc(x, y);
    c.setFeat(grid, feat);
    c.sqinfoOn(grid, SQUARE.ROOM);
    if (flag) c.sqinfoOn(grid, flag);
    if (light) c.sqinfoOn(grid, SQUARE.GLOW);
  }
}

function fillYrange(
  c: Chunk,
  x: number,
  y1: number,
  y2: number,
  feat: number,
  flag: number,
  light: boolean,
): void {
  for (let y = y1; y <= y2; y++) {
    const grid = loc(x, y);
    c.setFeat(grid, feat);
    c.sqinfoOn(grid, SQUARE.ROOM);
    if (flag) c.sqinfoOn(grid, flag);
    if (light) c.sqinfoOn(grid, SQUARE.GLOW);
  }
}

/** fill_circle: a filled disc of a feature (used by circular rooms). */
export function fillCircle(
  c: Chunk,
  y0: number,
  x0: number,
  radius: number,
  border: number,
  feat: number,
  flag: number,
  light: boolean,
): void {
  let last = 0;
  let k = radius;
  let r2i2k2 = 0;
  for (let i = 0; i <= radius; i++) {
    let b = border;
    if (border && last > k) b++;
    fillXrange(c, y0 - i, x0 - k - b, x0 + k + b, feat, flag, light);
    fillXrange(c, y0 + i, x0 - k - b, x0 + k + b, feat, flag, light);
    fillYrange(c, x0 - i, y0 - k - b, y0 + k + b, feat, flag, light);
    fillYrange(c, x0 + i, y0 - k - b, y0 + k + b, feat, flag, light);
    last = k;
    if (i < radius) {
      r2i2k2 -= 2 * i + 1;
      for (;;) {
        const adj = 2 * k - 1;
        if (Math.abs(r2i2k2 + adj) >= Math.abs(r2i2k2)) break;
        k--;
        r2i2k2 += adj;
      }
    }
  }
}

/** generate_plus: fill the cross lines of a rectangle. */
export function generatePlus(
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  feat: number,
  flag: number,
): void {
  const y0 = Math.trunc((y1 + y2) / 2);
  const x0 = Math.trunc((x1 + x2) / 2);
  for (let y = y1; y <= y2; y++) c.setFeat(loc(x0, y), feat);
  if (flag) generateMark(c, y1, x0, y2, x0, flag);
  for (let x = x1; x <= x2; x++) c.setFeat(loc(x, y0), feat);
  if (flag) generateMark(c, y0, x1, y0, x2, flag);
}

/** generate_open: open all four sides of a rectangle. */
export function generateOpen(
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  feat: number,
): void {
  const y0 = Math.trunc((y1 + y2) / 2);
  const x0 = Math.trunc((x1 + x2) / 2);
  c.setFeat(loc(x0, y1), feat);
  c.setFeat(loc(x1, y0), feat);
  c.setFeat(loc(x0, y2), feat);
  c.setFeat(loc(x2, y0), feat);
}

/** generate_hole: open one random side of a rectangle. */
export function generateHole(
  rng: Rng,
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  feat: number,
): void {
  const y0 = Math.trunc((y1 + y2) / 2);
  const x0 = Math.trunc((x1 + x2) / 2);
  switch (rng.randint0(4)) {
    case 0:
      c.setFeat(loc(x0, y1), feat);
      break;
    case 1:
      c.setFeat(loc(x1, y0), feat);
      break;
    case 2:
      c.setFeat(loc(x0, y2), feat);
      break;
    case 3:
      c.setFeat(loc(x2, y0), feat);
      break;
  }
}

/** set_marked_granite: lay granite and optionally mark it. */
export function setMarkedGranite(c: Chunk, grid: Loc, flag: number): void {
  c.setFeat(grid, FEAT.GRANITE);
  if (flag) generateMark(c, grid.y, grid.x, grid.y, grid.x, flag);
}

/**
 * set_bordering_walls: convert floor grids on the edge of a room to outer
 * walls so no floor is adjacent to a non-floor, non-outer-wall grid.
 */
export function setBorderingWalls(
  c: Chunk,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): void {
  const ry1 = Math.max(0, y1);
  const ry2 = Math.min(c.height - 1, y2);
  const rx1 = Math.max(0, x1);
  const rx2 = Math.min(c.width - 1, x2);
  const nx = rx2 - rx1 + 1;
  const walls = new Array<boolean>(nx * (ry2 - ry1 + 1)).fill(false);

  for (let y = ry1; y <= ry2; y++) {
    const adjy1 = Math.max(0, y - 1);
    const adjy2 = Math.min(c.height - 1, y + 1);
    for (let x = rx1; x <= rx2; x++) {
      if (!c.isFloor(loc(x, y))) continue;
      const adjx1 = Math.max(0, x - 1);
      const adjx2 = Math.min(c.width - 1, x + 1);
      if (adjy2 - adjy1 !== 2 || adjx2 - adjx1 !== 2) {
        walls[x - rx1 + nx * (y - ry1)] = true;
      } else {
        let nfloor = 0;
        for (let ay = adjy1; ay <= adjy2; ay++) {
          for (let ax = adjx1; ax <= adjx2; ax++) {
            if (c.isFloor(loc(ax, ay))) nfloor++;
          }
        }
        if (nfloor !== 9) walls[x - rx1 + nx * (y - ry1)] = true;
      }
    }
  }

  for (let y = ry1; y <= ry2; y++) {
    for (let x = rx1; x <= rx2; x++) {
      if (walls[x - rx1 + nx * (y - ry1)]) {
        setMarkedGranite(c, loc(x, y), SQUARE.WALL_OUTER);
      }
    }
  }
}

/**
 * generate_starburst_room (gen-room.c L569): carve a rounded "starburst" of
 * `feat` inside the rectangle (y1,x1)-(y2,x2). Ported verbatim, including the
 * long/narrow-room subdivision recursion, the per-arc RNG draws, the
 * make-denser randint1 for non-floor passable terrain, and the outer-wall
 * marking pass. RNG draws are reproduced in exact upstream order and count.
 * Used by the town builder (a town-sized FEAT_FLOOR starburst) and available
 * to any builder needing lakes/caverns. Occupancy checks read the Gen (no
 * monsters/objects exist yet during town layout, matching upstream).
 */
export function generateStarburstRoom(
  g: Gen,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  light: boolean,
  feat: number,
  specialOk: boolean,
): boolean {
  const c = g.c;
  const rng = g.rng;
  const reg = c.features;

  /* Make certain the room does not cross the dungeon edge. */
  if (!c.inBounds(loc(x1, y1)) || !c.inBounds(loc(x2, y2))) return false;
  /* Robustness -- test sanity of input coordinates. */
  if (y1 + 2 >= y2 || x1 + 2 >= x2) return false;

  const height = 1 + y2 - y1;
  const width = 1 + x2 - x1;

  /* Handle long, narrow rooms by dividing them up. */
  if (
    height > Math.trunc((5 * width) / 2) ||
    width > Math.trunc((5 * height) / 2)
  ) {
    let tmpAy = y2;
    let tmpAx = x2;
    if (height > width) tmpAy = y1 + Math.trunc((2 * height) / 3);
    else tmpAx = x1 + Math.trunc((2 * width) / 3);
    generateStarburstRoom(g, y1, x1, tmpAy, tmpAx, light, feat, false);

    let tmpBy = y1;
    let tmpBx = x1;
    if (height > width) tmpBy = y1 + Math.trunc((1 * height) / 3);
    else tmpBx = x1 + Math.trunc((1 * width) / 3);
    generateStarburstRoom(g, tmpBy, tmpBx, y2, x2, light, feat, false);

    if (featIsFloor(reg, feat)) {
      /* Extend a corridor between the two room centres. */
      for (
        let y = Math.trunc((y1 + tmpAy) / 2);
        y <= Math.trunc((tmpBy + y2) / 2);
        y++
      ) {
        for (
          let x = Math.trunc((x1 + tmpAx) / 2);
          x <= Math.trunc((tmpBx + x2) / 2);
          x++
        ) {
          c.setFeat(loc(x, y), feat);
        }
      }
    } else {
      /* Otherwise fill any gap between the two starbursts. */
      let tmpCy1: number;
      let tmpCx1: number;
      let tmpCy2: number;
      let tmpCx2: number;
      if (height > width) {
        tmpCy1 = y1 + Math.trunc((height - width) / 2);
        tmpCx1 = x1;
        tmpCy2 = tmpCy1 - Math.trunc((height - width) / 2);
        tmpCx2 = x2;
      } else {
        tmpCy1 = y1;
        tmpCx1 = x1 + Math.trunc((width - height) / 2);
        tmpCy2 = y2;
        tmpCx2 = tmpCx1 + Math.trunc((width - height) / 2);
      }
      generateStarburstRoom(g, tmpCy1, tmpCx1, tmpCy2, tmpCx2, light, feat, false);
    }
    return true;
  }

  /* Get a shrinkage ratio for large rooms, as the table is limited. */
  let distConv: number;
  if (width > 44 || height > 44) {
    if (width > height) distConv = Math.trunc((10 * width) / 44);
    else distConv = Math.trunc((10 * height) / 44);
  } else {
    distConv = 10;
  }

  /* arc[i] = [first degree of arc, maximum effect distance in arc]. */
  const arc: number[][] = [];
  let arcNum: number;
  let makeCloverleaf = false;

  if (specialOk && height > 10 && rng.randint0(20) === 0) {
    arcNum = 12;
    makeCloverleaf = true;
  } else {
    arcNum = 8 + Math.trunc((height * width) / 80);
    arcNum = arcNum + 3 - rng.randint0(7);
    if (arcNum < 8) arcNum = 8;
    if (arcNum > 45) arcNum = 45;
  }

  const y0 = y1 + Math.trunc(height / 2);
  const x0 = x1 + Math.trunc(width / 2);

  let degreeFirst = 0;
  for (let i = 0; i < arcNum; i++) {
    /* Get the first degree for this arc (before advancing degreeFirst). */
    const arc0 = degreeFirst;

    /* Get a slightly randomized start degree for the next arc. */
    degreeFirst += Math.trunc((180 + rng.randint0(arcNum)) / arcNum);
    if (degreeFirst < Math.trunc((180 * (i + 1)) / arcNum)) {
      degreeFirst = Math.trunc((180 * (i + 1)) / arcNum);
    }
    if (degreeFirst > Math.trunc(((180 + arcNum) * (i + 1)) / arcNum)) {
      degreeFirst = Math.trunc(((180 + arcNum) * (i + 1)) / arcNum);
    }

    const centerOfArc = degreeFirst + arc0;

    let arc1 = 0;
    if (
      (centerOfArc > 45 && centerOfArc < 135) ||
      (centerOfArc > 225 && centerOfArc < 315)
    ) {
      arc1 = Math.trunc(height / 4) + rng.randint0(Math.trunc((height + 3) / 4));
    } else if (
      centerOfArc < 45 ||
      centerOfArc > 315 ||
      (centerOfArc < 225 && centerOfArc > 135)
    ) {
      arc1 = Math.trunc(width / 4) + rng.randint0(Math.trunc((width + 3) / 4));
    } else if (i !== 0) {
      if (makeCloverleaf) arc1 = 0;
      else arc1 = (arc[i - 1] as number[])[1]! + 3 - rng.randint0(7);
    }

    /* Keep variability under control. */
    if (!makeCloverleaf && i !== 0 && i !== arcNum - 1) {
      const prev = (arc[i - 1] as number[])[1]!;
      if (featIsSmooth(reg, feat)) {
        if (arc1 > prev + 2) arc1 = prev + 2;
        if (arc1 > prev - 2) arc1 = prev - 2;
      } else {
        if (arc1 > Math.trunc((3 * (prev + 1)) / 2)) {
          arc1 = Math.trunc((3 * (prev + 1)) / 2);
        }
        if (arc1 < Math.trunc((2 * (prev - 1)) / 3)) {
          arc1 = Math.trunc((2 * (prev - 1)) / 3);
        }
      }
    }

    /* Neaten up the final arc by comparing it to the first. */
    if (i === arcNum - 1) {
      const first = (arc[0] as number[])[1]!;
      if (Math.abs(arc1 - first) > 3) {
        if (arc1 > first) arc1 -= rng.randint0(arc1 - first);
        else if (arc1 < first) arc1 += rng.randint0(first - arc1);
      }
    }

    arc[i] = [arc0, arc1];
  }

  /* Precalculate check distance. */
  const distCheck = Math.trunc((21 * distConv) / 10);

  /* Change grids between (and not including) the edges. */
  for (let y = y1 + 1; y < y2; y++) {
    for (let x = x1 + 1; x < x2; x++) {
      const grid = loc(x, y);

      /* Do not touch vault grids or occupied grids. */
      if (squareIsVault(c, grid)) continue;
      if (c.mon(grid) !== 0) continue;
      if (g.hasObject(grid)) continue;

      const dist = distance(loc(x0, y0), grid);
      if (dist >= distCheck) continue;

      /* Convert and reorient the grid for table access. */
      const ny = 20 + Math.trunc((10 * (y - y0)) / distConv);
      const nx = 20 + Math.trunc((10 * (x - x0)) / distConv);
      if (ny < 0 || ny > 40 || nx < 0 || nx > 40) continue;

      const degree = (GET_ANGLE_TO_GRID[ny] as readonly number[])[nx]!;

      for (let i = arcNum - 1; i >= 0; i--) {
        if ((arc[i] as number[])[0]! <= degree) {
          const maxDist = (arc[i] as number[])[1]!;
          if (maxDist >= dist) {
            if (featIsFloor(reg, feat) || !featIsPassable(reg, feat)) {
              c.setFeat(grid, feat);
              if (featIsFloor(reg, feat)) c.sqinfoOn(grid, SQUARE.ROOM);
              else c.sqinfoOff(grid, SQUARE.ROOM);
              if (light) c.sqinfoOn(grid, SQUARE.GLOW);
              else if (!featIsBright(reg, c.feat(grid))) {
                c.sqinfoOff(grid, SQUARE.GLOW);
              }
            } else {
              /* Non-floor passable terrain: place only over floor. */
              if (featIsSmooth(reg, feat)) {
                if (c.isFloor(grid)) c.setFeat(grid, feat);
              } else if (c.isFloor(grid) && rng.randint1(maxDist + 5) >= dist + 5) {
                c.setFeat(grid, feat);
              }
              if (light) c.sqinfoOn(grid, SQUARE.GLOW);
            }
          }
          /* Arc found; end search. */
          break;
        }
      }
    }
  }

  /*
   * If we placed floors or dungeon granite, all dungeon granite next to
   * floors becomes outer wall.
   */
  if (featIsFloor(reg, feat) || feat === FEAT.GRANITE) {
    for (let y = y1 + 1; y < y2; y++) {
      for (let x = x1 + 1; x < x2; x++) {
        const grid = loc(x, y);
        if (!c.isFloor(grid)) continue;
        for (let d = 0; d < 8; d++) {
          const g1 = locSum(grid, DDGRID_DDD[d] as Loc);
          c.sqinfoOn(g1, SQUARE.ROOM);
          c.sqinfoOn(g1, SQUARE.NO_STAIRS);
          if (light) c.sqinfoOn(g1, SQUARE.GLOW);
          if (c.feat(g1) === FEAT.GRANITE) {
            setMarkedGranite(c, g1, SQUARE.WALL_OUTER);
          }
        }
      }
    }
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Feature placement (doors, rubble, stairs).
 * ------------------------------------------------------------------ */

export function placeRubble(g: Gen, grid: Loc): void {
  g.c.setFeat(grid, g.rng.oneIn(2) ? FEAT.RUBBLE : FEAT.PASS_RUBBLE);
}

export function placeSecretDoor(c: Chunk, grid: Loc): void {
  c.setFeat(grid, FEAT.SECRET);
}

/** place_closed_door: one in four doors is locked to power 1d7. */
export function placeClosedDoor(g: Gen, grid: Loc): void {
  g.c.setFeat(grid, FEAT.CLOSED);
  /* square_set_door_lock: the lock is a trap on the live cave; record the
   * rolled power so the game state can place the lock at start. */
  if (g.rng.oneIn(4)) g.lockedDoors.push({ grid, power: g.rng.randint1(7) });
}

export function placeRandomDoor(g: Gen, grid: Loc): void {
  const tmp = g.rng.randint0(100);
  if (tmp < 30) g.c.setFeat(grid, FEAT.OPEN);
  else if (tmp < 40) g.c.setFeat(grid, FEAT.BROKEN);
  else placeClosedDoor(g, grid);
}

/** place_trap: record the grid (trap objects are a deferred domain). */
export function placeTrap(g: Gen, grid: Loc): void {
  g.markTrap(grid);
}

/** place_stairs: choose the stair terrain honoring town / max-depth rules. */
export function placeStairs(g: Gen, grid: Loc, quest: boolean, feat: number): void {
  if (!g.c.depth) {
    g.c.setFeat(grid, FEAT.MORE);
  } else if (quest || g.c.depth >= g.constants.maxDepth - 1) {
    g.c.setFeat(grid, FEAT.LESS);
  } else {
    g.c.setFeat(grid, feat);
  }
}

export function placeRandomStairs(g: Gen, grid: Loc, quest: boolean): void {
  const feat = g.rng.randint0(100) < 50 ? FEAT.LESS : FEAT.MORE;
  if (squareCanPutItem(g, grid)) placeStairs(g, grid, quest, feat);
}

/* ------------------------------------------------------------------ *
 * Object placement (place_object / place_gold), via ./obj.
 * ------------------------------------------------------------------ */

/** place_object: make and place an object, if object deps are available. */
export function placeObject(
  g: Gen,
  grid: Loc,
  level: number,
  good: boolean,
  great: boolean,
  tval: number,
): void {
  if (!g.c.inBounds(grid)) return;
  if (!squareCanPutItem(g, grid)) return;
  if (!g.objDeps) return;
  const rating: MakeObjectRating = { value: 0 };
  const obj = makeObject(
    g.rng,
    g.objDeps,
    level,
    good,
    great,
    false,
    tval,
    g.c.depth,
    rating,
  );
  if (!obj) return;
  g.addObject(grid, obj);

  /* place_object's obj_rating accumulation (gen-util.c L509-540). Draws no
   * RNG: rating.value is a pure recomputation of make_object's *value. */
  if (obj.artifact) g.c.goodItem = true;
  let r = rating.value;
  if (r > 2_500_000) r = 2_500_000;
  else if (r < -2_500_000) r = -2_500_000;
  const scaled = Math.trunc(r / 100);
  g.c.addToObjRating(scaled * scaled);
}

/** place_gold: make and place a money object. */
export function placeGold(g: Gen, grid: Loc, level: number): void {
  if (!g.c.inBounds(grid)) return;
  if (!squareCanPutItem(g, grid)) return;
  if (!g.objDeps) return;
  const money = makeGold(g.rng, g.objDeps, level, "any");
  g.addObject(grid, money);
}

/* SET_* and TYP_* constants (generate.h). */
export const SET_CORR = 0x01;
export const SET_ROOM = 0x02;
export const SET_BOTH = 0x03;

export const TYP_RUBBLE = 0;
export const TYP_TRAP = 1;
export const TYP_GOLD = 2;
export const TYP_OBJECT = 3;
export const TYP_GOOD = 4;
export const TYP_GREAT = 5;

/** alloc_object: place one random entity in a corridor/room/either. */
export function allocObject(
  g: Gen,
  set: number,
  typ: number,
  depth: number,
): boolean {
  const finder = new CaveFinder(loc(1, 1), loc(g.c.width - 2, g.c.height - 2));
  for (;;) {
    const grid = finder.get(g.rng);
    if (!grid) return false;
    const inRoom = squareIsRoom(g.c, grid);
    const matched =
      (!!(set & SET_CORR) && !inRoom) || (!!(set & SET_ROOM) && inRoom);
    if (squareIsEmpty(g, grid) && matched) {
      switch (typ) {
        case TYP_RUBBLE:
          placeRubble(g, grid);
          break;
        case TYP_TRAP:
          placeTrap(g, grid);
          break;
        case TYP_GOLD:
          placeGold(g, grid, depth);
          break;
        case TYP_OBJECT:
          placeObject(g, grid, depth, false, false, 0);
          break;
        case TYP_GOOD:
          placeObject(g, grid, depth, true, false, 0);
          break;
        case TYP_GREAT:
          placeObject(g, grid, depth, true, true, 0);
          break;
      }
      return true;
    }
  }
}

/** alloc_objects: place num entities, returning the number not placed. */
export function allocObjects(
  g: Gen,
  set: number,
  typ: number,
  num: number,
  depth: number,
): number {
  let missed = 0;
  for (let k = 0; k < num; k++) {
    if (!allocObject(g, set, typ, depth)) missed++;
  }
  return missed;
}

/* ------------------------------------------------------------------ *
 * Stairs (alloc_stairs) and player placement (new_player_spot).
 * ------------------------------------------------------------------ */

/** alloc_stairs: place num stairs of a type near walls, honoring minsep. */
export function allocStairs(
  g: Gen,
  feat: number,
  num: number,
  minsep: number,
  sepany: boolean,
  avoidList: Connector[],
  quest: boolean,
): void {
  const c = g.c;
  const av: Loc[] = [];

  if (minsep > 0) {
    const tester = (grid: Loc): boolean => {
      if (sepany) return c.isStairs(grid);
      return feat === FEAT.MORE ? c.isDownstairs(grid) : c.isUpstairs(grid);
    };
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const grid = loc(x, y);
        if (tester(grid)) av.push(grid);
      }
    }
    for (const avc of avoidList) {
      if (avc.feat !== feat) av.push(avc.grid);
    }
  }

  const finder = new CaveFinder(loc(1, 1), loc(c.width - 2, c.height - 2));
  let i = 0;
  let walls = 3;
  while (i < num && walls >= 0) {
    for (;;) {
      if (i >= num) break;
      const grid = finder.get(g.rng);
      if (!grid) break;
      if (!squareIsEmpty(g, grid) || squareNumWallsAdjacent(c, grid) !== walls) {
        continue;
      }
      if (minsep > 0) {
        let clash = false;
        for (const a of av) {
          if (Math.abs(grid.y - a.y) <= minsep && Math.abs(grid.x - a.x) <= minsep) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
        av.push(grid);
      }
      placeStairs(g, grid, quest, feat);
      i++;
    }
    if (i < num) {
      walls--;
      finder.reset();
    }
  }
}

/** find_start: a good starting location for the player (or stairs). */
export function findStart(g: Gen): Loc | null {
  const finder = new CaveFinder(loc(1, 1), loc(g.c.width - 2, g.c.height - 2));

  let grid = scanFinder(finder, g.rng, (gr) => squareSuitsStairsWell(g, gr));
  if (grid) return grid;

  finder.reset();
  grid = scanFinder(finder, g.rng, (gr) => squareSuitsStairsOk(g, gr));
  if (grid) return grid;

  let walls = 6;
  while (walls >= 0) {
    finder.reset();
    grid = scanFinder(finder, g.rng, (gr) => {
      if (
        !squareIsEmpty(g, gr) ||
        squareIsVault(g.c, gr) ||
        squareIsNoStairs(g.c, gr)
      ) {
        return false;
      }
      const total =
        squareNumWallsAdjacent(g.c, gr) + squareNumWallsDiagonal(g.c, gr);
      return total === walls;
    });
    if (grid) return grid;
    walls--;
  }
  return null;
}

function scanFinder(
  finder: CaveFinder,
  rng: Rng,
  pred: (grid: Loc) => boolean,
): Loc | null {
  for (;;) {
    const grid = finder.get(rng);
    if (!grid) return null;
    if (pred(grid)) return grid;
  }
}

/**
 * new_player_spot: choose the player start. Returns the location, or null on
 * failure. createStair, if given, lays a stair on the start (the
 * birth_connect_stairs upstream behavior); depends on player state so it is
 * injected rather than read.
 */
export function newPlayerSpot(
  g: Gen,
  createStair: "down" | "up" | null = null,
): Loc | null {
  const grid = findStart(g);
  if (!grid) return null;
  if (createStair === "down") g.c.setFeat(grid, FEAT.MORE);
  else if (createStair === "up") g.c.setFeat(grid, FEAT.LESS);
  return grid;
}

/* ------------------------------------------------------------------ *
 * Vault helpers (vault_objects / vault_traps).
 * ------------------------------------------------------------------ */

export function vaultObjects(g: Gen, grid: Loc, depth: number, num: number): void {
  for (; num > 0; num--) {
    for (let i = 0; i < 11; i++) {
      const near = findNearbyGrid(g.c, g.rng, grid, 2, 3);
      if (!near) continue;
      if (!squareCanPutItem(g, near)) continue;
      if (g.rng.randint0(100) < 75) placeObject(g, near, depth, false, false, 0);
      else placeGold(g, near, depth);
      break;
    }
  }
}

export function vaultTraps(
  g: Gen,
  grid: Loc,
  yd: number,
  xd: number,
  num: number,
): void {
  for (let i = 0; i < num; i++) {
    for (let tries = 0; tries <= 5; tries++) {
      const near = findNearbyGrid(g.c, g.rng, grid, yd, xd);
      if (!near) continue;
      if (!squareIsEmpty(g, near)) continue;
      placeTrap(g, near);
      break;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Monster placement (mon-make placement half + gen-monster helpers).
 *
 * The place_new_monster family (one monster, same-race groups, friends and
 * base-template escorts) is ported. Pit/nest monster theming (mon_restrict)
 * is still simplified to any depth-appropriate monster; placement RNG order
 * therefore diverges from upstream where theming would have restricted the
 * table, and structural invariants plus per-seed determinism are asserted
 * instead.
 * ------------------------------------------------------------------ */

/**
 * place_new_monster_one, reduced to the generation-time subset: build the
 * monster and attach it if the grid is free. The live-cave concerns (mimicked
 * objects, drops, level rating, update_mon) attach with their subsystems.
 */
function placeNewMonsterOne(
  g: Gen,
  grid: Loc,
  race: MonsterRace,
  sleep: boolean,
  info: MonsterGroupInfo,
): boolean {
  if (!g.c.inBounds(grid) || !squareIsEmpty(g, grid)) return false;
  if (g.uniqueAlreadyPlaced(race)) return false;

  /* Add to level feeling (mon-make.c place_new_monster_one L1112-1126).
   * Draws no RNG. */
  g.c.addToMonsterRating(race.level * race.level);
  if (race.level > g.c.depth) {
    g.c.addToMonsterRating((race.level - g.c.depth) * race.level * race.level);
  }

  const mon = createMonster(g.rng, race, {
    sleep,
    moveEnergy: g.constants.moveEnergy,
    groupIndex: info.index,
    groupRole: info.role,
  });
  g.attachMonster(grid, mon, g.nextMonIndex());
  return true;
}

/**
 * place_new_monster_group: puddle up to `total` monsters of one race around
 * grid, breadth first over the 8 neighbours of each placed monster.
 */
function placeNewMonsterGroup(
  g: Gen,
  grid: Loc,
  race: MonsterRace,
  sleep: boolean,
  info: MonsterGroupInfo,
  total: number,
): boolean {
  total = Math.min(total, g.constants.monsterGroupMax);

  /* Start on the monster. */
  const locList: Loc[] = [grid];

  /* Puddle monsters, breadth first, up to total. */
  for (let n = 0; n < locList.length && locList.length < total; n++) {
    for (let i = 0; i < 8 && locList.length < total; i++) {
      const tryGrid = locSum(locList[n] as Loc, DDGRID_DDD[i] as Loc);

      /* Walls and monsters block flow. */
      if (!squareIsEmpty(g, tryGrid)) continue;

      if (placeNewMonsterOne(g, tryGrid, race, sleep, info)) {
        locList.push(tryGrid);
      }
    }
  }
  return true;
}

/** place_friends: place a friend or escort race near the original monster. */
function placeFriends(
  g: Gen,
  grid: Loc,
  race: MonsterRace,
  friendsRace: MonsterRace,
  total: number,
  sleep: boolean,
  info: MonsterGroupInfo,
): boolean {
  /* Find the difference between current dungeon depth and monster level. */
  const levelDifference = g.c.depth - friendsRace.level + 5;

  /* Handle unique monsters. */
  const isUnique = friendsRace.flags.has(RF.UNIQUE);

  /* Make sure the unique hasn't been killed (or placed here) already. */
  if (isUnique) {
    if (friendsRace.curNum >= friendsRace.maxNum) return false;
    if (g.uniqueAlreadyPlaced(friendsRace)) return false;
  }

  /* More than 4 levels OoD, no groups allowed. */
  if (levelDifference <= 0 && !isUnique) return false;

  /* Reduce group size within 5 levels of natural depth. */
  if (levelDifference < 10 && !isUnique) {
    const extraChance = (total * levelDifference) % 10;
    total = Math.trunc((total * levelDifference) / 10);

    /* Instead of flooring the group value, we use the decimal place
     * as a chance of an extra monster. */
    if (g.rng.randint0(10) > extraChance) total += 1;
  }

  if (total > 0) {
    /* Handle friends same as original monster. */
    if (race.ridx === friendsRace.ridx) {
      return placeNewMonsterGroup(g, grid, race, sleep, info, total);
    }

    /* Find a nearby place to put the other groups. */
    const spots = scatterExt(
      g.c,
      g.rng,
      1,
      grid,
      g.constants.monsterGroupDist,
      false,
      (_c, gr) => squareIsOpen(g, gr),
    );
    if (spots.length > 0) {
      const start = spots[0] as Loc;
      /* Place the monsters. */
      let success = placeNewMonsterOne(g, start, friendsRace, sleep, info);
      if (total > 1) {
        success = placeNewMonsterGroup(g, start, friendsRace, sleep, info, total);
      }
      return success;
    }
  }

  return false;
}

/**
 * place_new_monster: place a monster of the given race at the given location,
 * with its friends and escorts when `groupOk` is set. The first monster of a
 * fresh group is its leader.
 */
export function placeNewMonster(
  g: Gen,
  grid: Loc,
  race: MonsterRace,
  sleep: boolean,
  groupOk: boolean,
  groupInfo: MonsterGroupInfo,
): boolean {
  if (!g.monDeps) return false;
  const info: MonsterGroupInfo = { ...groupInfo };

  /* If we don't have a group index already, make one; our first monster
   * will be the leader. */
  if (!info.index) info.index = g.nextGroupIndex();

  /* Place one monster, or fail. */
  if (!placeNewMonsterOne(g, grid, race, sleep, info)) return false;

  /* We're done unless the group flag is set. */
  if (!groupOk) return true;

  /* Go through friends flags. */
  for (const friends of race.friends) {
    if (g.rng.randint0(100) >= friends.percentChance) continue;

    /* Calculate the base number of monsters to place. */
    const total = g.rng.damroll(friends.numberDice, friends.numberSide);

    /* Set group role. */
    info.role = friends.role;

    /* Place them. */
    if (friends.race) {
      placeFriends(g, grid, race, friends.race, total, sleep, info);
    }
  }

  /* Go through the friends_base flags. */
  for (const friendsBase of race.friendsBase) {
    /* Check if we pass chance for the monster appearing. */
    if (g.rng.randint0(100) >= friendsBase.percentChance) continue;

    const total = g.rng.damroll(friendsBase.numberDice, friendsBase.numberSide);

    /* Prepare allocation table for the escort base (no uniques). */
    g.monDeps.table.prep(
      (r) => r.base === friendsBase.base && !r.flags.has(RF.UNIQUE),
    );

    /* Pick a random race, then reset the allocation table. */
    const friendsRace = g.monDeps.table.getMonNum(g.rng, race.level, g.c.depth);
    g.monDeps.table.prep(null);

    /* Handle failure. */
    if (!friendsRace) break;

    /* Set group role. */
    info.role = friendsBase.role;

    /* Place them. */
    placeFriends(g, grid, race, friendsRace, total, sleep, info);
  }

  return true;
}

/** pick_and_place_monster: place an appropriate monster (and group) at grid. */
export function pickAndPlaceMonster(
  g: Gen,
  grid: Loc,
  depth: number,
  sleep: boolean,
  groupOkay = true,
): boolean {
  if (!g.monDeps) return false;
  const race = g.monDeps.table.getMonNum(g.rng, depth, g.c.depth);
  if (!race) return false;
  const info: MonsterGroupInfo = { index: 0, role: MON_GROUP.LEADER };
  return placeNewMonster(g, grid, race, sleep, groupOkay, info);
}

/** pick_and_place_distant_monster: place one monster far from the player. */
export function pickAndPlaceDistantMonster(
  g: Gen,
  pgrid: Loc,
  dis: number,
  sleep: boolean,
  depth: number,
): boolean {
  if (!g.monDeps) return false;
  const c = g.c;
  let attemptsLeft = 10_000;
  let minDist = Math.max(dis, g.constants.maxSight + 1);
  for (;;) {
    let grid: Loc | null = null;
    let found = false;
    while (attemptsLeft > 0) {
      attemptsLeft--;
      grid = loc(g.rng.randint0(c.width - 2) + 1, g.rng.randint0(c.height - 2) + 1);
      if (squareIsEmpty(g, grid) && distance(pgrid, grid) > minDist) {
        found = true;
        break;
      }
    }
    if (found && grid) return pickAndPlaceMonster(g, grid, depth, sleep);
    if (minDist > 1) {
      /* Loosen the distance requirement rather than fail outright. */
      minDist = Math.trunc(minDist / 2);
      attemptsLeft = 10_000;
      continue;
    }
    return false;
  }
}

/** vault_monsters: place num sleeping monsters near a grid. */
export function vaultMonsters(g: Gen, grid: Loc, depth: number, num: number): void {
  if (!g.c.inBounds(grid)) return;
  for (let k = 0; k < num; k++) {
    for (let i = 0; i < 9; i++) {
      const near = scatterExt(g.c, g.rng, 1, grid, 1, true, (cc, gr) =>
        squareIsEmpty(g, gr),
      );
      if (near.length === 0) continue;
      pickAndPlaceMonster(g, near[0] as Loc, depth, true);
      break;
    }
  }
}

/**
 * spread_monsters: place num monsters spread over a rectangle of effect.
 * Monster theming via type is simplified to any depth-appropriate monster.
 */
export function spreadMonsters(
  g: Gen,
  depth: number,
  num: number,
  y0: number,
  x0: number,
  dy: number,
  dx: number,
): void {
  if (!g.monDeps) return;
  const startCount = g.monsters.length;
  let count = 0;
  for (let i = 0; count < num && i < 50; i++) {
    let x = x0;
    let y = y0;
    if (dy === 0 && dx === 0) {
      if (!g.c.inBounds(loc(x, y))) return;
    } else {
      let ok = false;
      for (let j = 0; j < 10; j++) {
        y = g.rng.randSpread(y0, dy);
        x = g.rng.randSpread(x0, dx);
        if (g.c.inBounds(loc(x, y))) {
          ok = true;
          break;
        }
      }
      if (!ok) return;
    }
    if (!squareIsEmpty(g, loc(x, y))) continue;
    pickAndPlaceMonster(g, loc(x, y), depth, true);
    if (g.monsters.length - startCount > num * 2) break;
    count++;
    i = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Shared helpers re-exported for builders.
 * ------------------------------------------------------------------ */

export { loc, locSum, locDiff, locEq, distance };
