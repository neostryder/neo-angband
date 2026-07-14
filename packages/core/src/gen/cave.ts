/**
 * Dungeon (cave) builders, tunneling, connectivity, mineral streamers and the
 * runtime-registrable dungeon-profile registry, ported from
 * reference/src/gen-cave.c and the profile-selection code of generate.c
 * (Angband 4.2.6).
 *
 * PORTED: classic_gen and modified_gen (with do_traditional_tunneling,
 * build_tunnel, choose_random_entrance, build_streamer, ensure_connectedness
 * and handle_level_stairs), and choose_profile's selection by depth.
 *
 * MODDABILITY (ratified pillar, decision 13): cave builders live in a
 * string-keyed registry and dungeon profiles in a runtime-registrable list.
 * A mod can register a new builder key and add a profile that uses it.
 *
 * PORTED (standalone): labyrinth_gen and cavern_gen (with labyrinth_chunk's
 * Kruskal maze, and init_cavern/mutate_cavern/clear_small_regions/cavern_chunk's
 * cellular automaton). cavern_chunk's persistent-level `join` stair machinery is
 * ported but dormant (dun.join is empty for non-persistent levels).
 *
 * DEFERRED (ledgered in parity/ledger/gen-cave.yaml): moria, lair, gauntlet and
 * hard_centre builders (their builder keys are registered but delegate to
 * modified_gen); the town builder is a minimal open level (full town generation
 * with stores is a separate later task); persistent-level connectors and the
 * arena level. connect_caverns is left for the hard_centre agent.
 */

import type { Constants } from "../constants";
import { DUN_PROFILE_ENTRIES, FEAT, ROOM_ENTRIES, SQUARE } from "../generated";
import type { Loc } from "../loc";
import { DDGRID_DDD, loc, locSum } from "../loc";
import type { Rng } from "../rng";
import { Chunk, featIsBright } from "../world/chunk";
import type { FeatureRegistry } from "../world/feature";
import type { MakeDeps } from "../obj/make";
import type { RoomProfile, RoomRegistry } from "./room";
import { roomBuild } from "./room";
import {
  CaveFinder,
  Dun,
  Gen,
  type Connector,
  type MonPlaceDeps,
  allocObjects,
  allocStairs,
  caveFind,
  correctDir,
  countNeighbors,
  drawRectangle,
  fillRectangle,
  findNearbyGrid,
  generateStarburstRoom,
  gridToI,
  iToGrid,
  newPlayerSpot,
  nextGrid,
  pickAndPlaceDistantMonster,
  placeClosedDoor,
  placeRandomDoor,
  randDir,
  setMarkedGranite,
  shuffle,
  squareIsEmpty,
  squareIsGraniteWithFlag,
  squareIsRoom,
  squareIsStrongWall,
  SET_BOTH,
  SET_CORR,
  SET_ROOM,
  TYP_GOLD,
  TYP_GOOD,
  TYP_GREAT,
  TYP_OBJECT,
  TYP_RUBBLE,
  TYP_TRAP,
  DIR_N,
  DIR_S,
  DIR_E,
  DIR_W,
  DIR_SE,
  distance,
} from "./util";

/* ------------------------------------------------------------------ *
 * Profile types and loading.
 * ------------------------------------------------------------------ */

export interface TunnelProfile {
  rnd: number;
  chg: number;
  con: number;
  pen: number;
  jct: number;
}

export interface StreamerProfile {
  den: number;
  rng: number;
  mag: number;
  mc: number;
  qua: number;
  qc: number;
}

export interface DunProfile {
  name: string;
  /** Cave-builder registry key. */
  builder: string;
  blockSize: number;
  dunRooms: number;
  dunUnusual: number;
  maxRarity: number;
  tun: TunnelProfile;
  str: StreamerProfile;
  roomProfiles: RoomProfile[];
  minLevel: number;
  alloc: number;
}

/** dungeon_profile.json record. */
export interface DunProfileRecordJson {
  name: string;
  params: { block: number; rooms: number; unusual: number; rarity: number };
  tunnel?: { rnd: number; chg: number; con: number; pen: number; jct: number };
  streamer?: {
    den: number;
    rng: number;
    mag: number;
    mc: number;
    qua: number;
    qc: number;
  };
  room?: Array<{
    name: string;
    rating: number;
    height: number;
    width: number;
    level: number;
    pit: number;
    rarity: number;
    cutoff: number;
  }>;
  "min-level"?: number;
  alloc: number;
}

const ZERO_TUNNEL: TunnelProfile = { rnd: 0, chg: 0, con: 0, pen: 0, jct: 0 };
const ZERO_STREAMER: StreamerProfile = {
  den: 0,
  rng: 0,
  mag: 0,
  mc: 0,
  qua: 0,
  qc: 0,
};

/** name -> cave builder key, from list-dun-profiles.h. */
function profileBuilderKey(name: string): string {
  for (const e of DUN_PROFILE_ENTRIES) {
    if (e.name === name) return e.builder;
  }
  throw new Error(`gen: unknown dungeon profile name '${name}'`);
}

/** room name -> room-builder key, from list-rooms.h. */
function roomBuilderKey(name: string): string {
  for (const e of ROOM_ENTRIES) {
    if (e.name === name) return e.builder;
  }
  throw new Error(`gen: unknown room name '${name}'`);
}

/** Convert one dungeon_profile.json record into a DunProfile. */
export function loadDunProfile(rec: DunProfileRecordJson): DunProfile {
  const roomProfiles: RoomProfile[] = (rec.room ?? []).map((r) => ({
    name: r.name,
    builder: roomBuilderKey(r.name),
    rating: r.rating,
    height: r.height,
    width: r.width,
    level: r.level,
    pit: r.pit !== 0,
    rarity: r.rarity,
    cutoff: r.cutoff,
  }));
  return {
    name: rec.name,
    builder: profileBuilderKey(rec.name),
    blockSize: rec.params.block,
    dunRooms: rec.params.rooms,
    dunUnusual: rec.params.unusual,
    maxRarity: rec.params.rarity,
    tun: rec.tunnel ?? ZERO_TUNNEL,
    str: rec.streamer ?? ZERO_STREAMER,
    roomProfiles,
    minLevel: rec["min-level"] ?? 0,
    alloc: rec.alloc,
  };
}

/* ------------------------------------------------------------------ *
 * The cave-build context and builder type.
 * ------------------------------------------------------------------ */

export interface CaveBuildContext {
  rng: Rng;
  reg: FeatureRegistry;
  constants: Constants;
  dun: Dun;
  profile: DunProfile;
  depth: number;
  minHeight: number;
  minWidth: number;
  objDeps: MakeDeps | null;
  monDeps: MonPlaceDeps | null;
  rooms: RoomRegistry;
  /**
   * is_daytime() at the moment of generation (game-world.c). Read only by the
   * town builder for cave_illuminate and the resident count. Absent for
   * dungeon levels; defaults to daytime (turn 0) when omitted.
   */
  daytime?: boolean;
}

export interface CaveBuildResult {
  gen: Gen | null;
  error: string | null;
}

export type CaveBuilder = (ctx: CaveBuildContext) => CaveBuildResult;

/* ------------------------------------------------------------------ *
 * choose_random_entrance (gen-cave.c).
 * ------------------------------------------------------------------ */

/**
 * Randomly choose a marked entrance for room ridx, biased toward tgt, or
 * loc(0, 0) when there is no satisfactory entrance.
 */
function chooseRandomEntrance(
  g: Gen,
  ridx: number,
  tgt: Loc | null,
  bias: number,
  exc: Loc[],
): Loc {
  const dun = g.dun;
  const nEnt = dun.entN[ridx] ?? 0;
  if (nEnt > 0) {
    const entries = dun.ent[ridx] as Loc[];
    const accum = new Array<number>(nEnt + 1).fill(0);
    let nchoice = 0;
    for (let i = 0; i < nEnt; i++) {
      const e = entries[i] as Loc;
      let included = squareIsGraniteWithFlag(g.c, e, SQUARE.WALL_OUTER);
      if (included) {
        for (const x of exc) {
          const dx = e.x - x.x;
          const dy = e.y - x.y;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0)) {
            included = false;
            break;
          }
        }
      }
      if (included) {
        if (tgt) {
          const d = distance(e, tgt);
          if (d === 0) return e;
          const biased = Math.max(1, bias - d);
          accum[i + 1] = (accum[i] as number) + biased * biased;
        } else {
          accum[i + 1] = (accum[i] as number) + 1;
        }
        nchoice++;
      } else {
        accum[i + 1] = accum[i] as number;
      }
    }
    if (nchoice > 0) {
      const chosen = g.rng.randint0(accum[nEnt] as number);
      let low = 0;
      let high = nEnt;
      for (;;) {
        if (low === high - 1) return entries[low] as Loc;
        const mid = low + Math.trunc((high - low) / 2);
        if ((accum[mid] as number) <= chosen) low = mid;
        else high = mid;
      }
    }
  }
  return loc(0, 0);
}

/* ------------------------------------------------------------------ *
 * build_tunnel (gen-cave.c).
 * ------------------------------------------------------------------ */

function pierceOuterWall(g: Gen, grid: Loc): void {
  const dun = g.dun;
  if (dun.wallN < dun.wallPierceMax) {
    dun.wall[dun.wallN] = grid;
    dun.wallN++;
  }
  for (let ay = grid.y - 1; ay <= grid.y + 1; ay++) {
    for (let ax = grid.x - 1; ax <= grid.x + 1; ax++) {
      const adj = loc(ax, ay);
      if (
        ax !== 0 &&
        ay !== 0 &&
        g.c.inBounds(adj) &&
        squareIsGraniteWithFlag(g.c, adj, SQUARE.WALL_OUTER)
      ) {
        setMarkedGranite(g.c, adj, SQUARE.WALL_SOLID);
      }
    }
  }
}

interface TunnelState {
  door: boolean;
  bend: number;
  offset: Loc;
}

function handlePostWallStep(g: Gen, grid: Loc, st: TunnelState): Loc {
  let cur = grid;
  const dir = st.offset;
  if (dir.x !== 0 && dir.y !== 0) {
    cur = loc(cur.x + dir.x, cur.y + dir.y);
    if (!squareIsRoom(g.c, cur) && g.c.isGranite(cur)) {
      if (g.dun.tunnN < g.dun.tunnGridMax) {
        g.dun.tunn[g.dun.tunnN] = cur;
        g.dun.tunnN++;
      }
      st.door = false;
    }
    st.bend = 0;
    if (g.rng.randint0(32768) < 16384) st.offset = loc(0, dir.y);
    else st.offset = loc(dir.x, 0);
  } else {
    st.bend = 1;
  }
  return cur;
}

function findNormalToWall(g: Gen, grid: Loc, inner: boolean): Loc {
  const choices: Loc[] = [];
  let ncardinal = 0;
  const ddd = ddgridDdd();
  for (let i = 0; i < 8; i++) {
    const off = ddd[i] as Loc;
    const chk = loc(grid.x + off.x, grid.y + off.y);
    if (
      g.c.inBounds(chk) &&
      !g.c.isPerm(chk) &&
      squareIsRoom(g.c, chk) === inner &&
      !squareIsGraniteWithFlag(g.c, chk, SQUARE.WALL_OUTER) &&
      !squareIsGraniteWithFlag(g.c, chk, SQUARE.WALL_SOLID) &&
      !squareIsGraniteWithFlag(g.c, chk, SQUARE.WALL_INNER)
    ) {
      choices.push(off);
      if (i < 4) ncardinal++;
    }
  }
  let n = choices.length;
  if (n > 1 && ncardinal > 0) n = ncardinal;
  return n === 0 ? loc(0, 0) : (choices[g.rng.randint0(n)] as Loc);
}

function allowsWallPiercingDoor(g: Gen, grid: Loc): boolean {
  let nOut = 0;
  let nIn = 0;
  for (let cy = grid.y - 1; cy <= grid.y + 1; cy++) {
    for (let cx = grid.x - 1; cx <= grid.x + 1; cx++) {
      if ((cy === 0 && cx === 0) || !g.c.inBounds(loc(cx, cy))) continue;
      const chk = loc(cx, cy);
      if (
        (g.c.isPassable(chk) || g.c.isRubble(chk)) &&
        !g.c.isDoor(chk) &&
        !g.c.isShop(chk)
      ) {
        if (squareIsRoom(g.c, chk)) nIn++;
        else nOut++;
      }
    }
  }
  return nOut > 0 && nIn > 0;
}

let cachedDddGrid: Loc[] | null = null;
function ddgridDdd(): Loc[] {
  if (!cachedDddGrid) {
    /* ddgrid_ddd order: S, N, E, W, SE, SW, NE, NW. */
    cachedDddGrid = [
      loc(0, 1),
      loc(0, -1),
      loc(1, 0),
      loc(-1, 0),
      loc(1, 1),
      loc(-1, 1),
      loc(1, -1),
      loc(-1, -1),
      loc(0, 0),
    ];
  }
  return cachedDddGrid;
}

function buildTunnel(g: Gen, from: Loc, to: Loc): void {
  const dun = g.dun;
  const c = g.c;
  let grid1 = from;
  let grid2 = to;
  const start = grid1;
  let mainLoop = 0;
  const st: TunnelState = { door: false, bend: 0, offset: correctDir(g.rng, grid1, grid2) };

  dun.tunnN = 0;
  dun.wallN = 0;

  while (!(grid1.x === grid2.x && grid1.y === grid2.y)) {
    if (mainLoop++ > 2000) break;

    if (st.bend === 0) {
      if (g.rng.randint0(100) < g.profileTun.chg) {
        st.offset = correctDir(g.rng, grid1, grid2);
        if (g.rng.randint0(100) < g.profileTun.rnd) st.offset = randDir(g.rng);
      }
    } else {
      st.bend--;
    }

    let tmp = loc(grid1.x + st.offset.x, grid1.y + st.offset.y);
    while (!c.inBounds(tmp)) {
      st.offset = correctDir(g.rng, grid1, grid2);
      if (g.rng.randint0(100) < g.profileTun.rnd) st.offset = randDir(g.rng);
      tmp = loc(grid1.x + st.offset.x, grid1.y + st.offset.y);
    }

    if (
      (c.isPerm(tmp) && !c.sqinfoHas(tmp, SQUARE.WALL_INNER)) ||
      squareIsGraniteWithFlag(c, tmp, SQUARE.WALL_SOLID)
    ) {
      continue;
    }

    if (squareIsGraniteWithFlag(c, tmp, SQUARE.WALL_OUTER)) {
      const nxt = loc(grid2.x - tmp.x, grid2.y - tmp.y);
      if (nxt.x === 0 && nxt.y === 0) {
        grid1 = tmp;
        pierceOuterWall(g, grid1);
        continue;
      }
      if (
        Math.abs(nxt.x) <= 1 &&
        Math.abs(nxt.y) <= 1 &&
        squareIsGraniteWithFlag(c, grid2, SQUARE.WALL_OUTER)
      ) {
        continue;
      }
      const iroom = dun.ent2room[tmp.y * c.width + tmp.x] as number;
      if (iroom !== -1) {
        let nxtdir: Loc;
        if (squareIsRoom(c, grid1)) {
          nxtdir = findNormalToWall(g, tmp, false);
          if (nxtdir.x === 0 && nxtdir.y === 0) continue;
          grid1 = tmp;
          pierceOuterWall(g, grid1);
        } else {
          let bias =
            80 -
            Math.trunc(
              (80 *
                Math.min(Math.max(0, g.profileTun.chg), 100) *
                Math.min(Math.max(0, g.profileTun.rnd), 100)) /
                10000,
            );
          let ntry = 0;
          const mtry = 20;
          const exc = [tmp, grid2];
          let chk = loc(0, 0);
          nxtdir = loc(0, 0);
          for (;;) {
            if (ntry >= mtry) break;
            chk = chooseRandomEntrance(g, iroom, grid2, bias, exc);
            if (chk.x === 0 && chk.y === 0) {
              ntry = mtry;
              break;
            }
            nxtdir = findNormalToWall(g, chk, false);
            if (nxtdir.x !== 0 || nxtdir.y !== 0) break;
            ntry++;
            bias = Math.trunc((bias * 8) / 10);
          }
          if (ntry >= mtry) continue;
          pierceOuterWall(g, tmp);
          pierceOuterWall(g, chk);
          grid1 = chk;
        }
        st.offset = nxtdir;
        grid1 = handlePostWallStep(g, grid1, st);
        continue;
      }

      const nxtdir = findNormalToWall(g, tmp, !squareIsRoom(c, grid1));
      if (nxtdir.x === 0 && nxtdir.y === 0) continue;
      grid1 = tmp;
      pierceOuterWall(g, grid1);
      st.offset = nxtdir;
      grid1 = handlePostWallStep(g, grid1, st);
    } else if (squareIsRoom(c, tmp)) {
      grid1 = tmp;
    } else if (c.isGranite(tmp)) {
      grid1 = tmp;
      if (dun.tunnN < dun.tunnGridMax) {
        dun.tunn[dun.tunnN] = grid1;
        dun.tunnN++;
      }
      st.door = false;
    } else {
      grid1 = tmp;
      if (!st.door) {
        if (dun.doorN < dun.levelDoorMax) {
          dun.door[dun.doorN] = grid1;
          dun.doorN++;
        }
        st.door = true;
      }
      if (g.rng.randint0(100) >= g.profileTun.con) {
        const d = loc(grid1.x - start.x, grid1.y - start.y);
        if (Math.abs(d.x) > 10 || Math.abs(d.y) > 10) break;
      }
    }
  }

  for (let i = 0; i < dun.tunnN; i++) c.setFeat(dun.tunn[i] as Loc, FEAT.FLOOR);
  for (let i = 0; i < dun.wallN; i++) {
    const w = dun.wall[i] as Loc;
    c.setFeat(w, FEAT.FLOOR);
    if (g.rng.randint0(100) < g.profileTun.pen && allowsWallPiercingDoor(g, w)) {
      placeRandomDoor(g, w);
    }
  }
}

/* ------------------------------------------------------------------ *
 * do_traditional_tunneling (gen-cave.c).
 * ------------------------------------------------------------------ */

function nextToCorr(g: Gen, grid: Loc): number {
  let k = 0;
  const ddd = ddgridDdd();
  for (let i = 0; i < 4; i++) {
    const off = ddd[i] as Loc;
    const g1 = loc(grid.x + off.x, grid.y + off.y);
    if (g.c.isFloor(g1) && !squareIsRoom(g.c, g1)) k++;
  }
  return k;
}

function possibleDoorway(g: Gen, grid: Loc): boolean {
  if (nextToCorr(g, grid) < 2) return false;
  if (
    squareIsStrongWall(g.c, nextGrid(grid, DIR_N)) &&
    squareIsStrongWall(g.c, nextGrid(grid, DIR_S))
  ) {
    return true;
  }
  if (
    squareIsStrongWall(g.c, nextGrid(grid, DIR_W)) &&
    squareIsStrongWall(g.c, nextGrid(grid, DIR_E))
  ) {
    return true;
  }
  return false;
}

function tryDoor(g: Gen, grid: Loc): void {
  if (!g.c.inBounds(grid)) return;
  if (squareIsStrongWall(g.c, grid)) return;
  if (squareIsRoom(g.c, grid)) return;
  if (g.hasTrap(grid)) return;
  if (g.c.isDoor(grid)) return;
  if (g.rng.randint0(100) < g.profileTun.jct && possibleDoorway(g, grid)) {
    placeRandomDoor(g, grid);
  } else if (g.rng.randint0(500) < g.profileTun.jct && possibleDoorway(g, grid)) {
    /* place_trap deferred: record the grid. */
    g.markTrap(grid);
  }
}

function doTraditionalTunneling(g: Gen): void {
  const dun = g.dun;
  const scrambled: number[] = [];
  for (let i = 0; i < dun.centN; i++) scrambled[i] = i;
  for (let i = 0; i < dun.centN; i++) {
    const p1 = g.rng.randint0(dun.centN);
    const p2 = g.rng.randint0(dun.centN);
    const t = scrambled[p1] as number;
    scrambled[p1] = scrambled[p2] as number;
    scrambled[p2] = t;
  }

  dun.doorN = 0;

  if (dun.centN === 0) return;
  let grid = chooseRandomEntrance(g, scrambled[dun.centN - 1] as number, null, 80, []);
  if (grid.x === 0 && grid.y === 0) {
    grid = dun.cent[scrambled[dun.centN - 1] as number] as Loc;
  }
  for (let i = 0; i < dun.centN; i++) {
    let next = chooseRandomEntrance(g, scrambled[i] as number, grid, 80, []);
    if (next.x === 0 && next.y === 0) next = dun.cent[scrambled[i] as number] as Loc;
    buildTunnel(g, next, grid);
    grid = next;
  }

  for (let i = 0; i < dun.doorN; i++) {
    const d = dun.door[i] as Loc;
    tryDoor(g, nextGrid(d, DIR_W));
    tryDoor(g, nextGrid(d, DIR_E));
    tryDoor(g, nextGrid(d, DIR_N));
    tryDoor(g, nextGrid(d, DIR_S));
  }
}

/* ------------------------------------------------------------------ *
 * build_streamer (gen-cave.c).
 * ------------------------------------------------------------------ */

function buildStreamer(g: Gen, feat: number, chance: number): void {
  const c = g.c;
  let grid = loc(
    g.rng.randSpread(Math.trunc(c.width / 2), 15),
    g.rng.randSpread(Math.trunc(c.height / 2), 10),
  );
  const dirOff = ddgridDdd();
  /* ddd[randint0(8)] chooses among S,N,E,W,SE,SW,NE,NW. */
  const dir = dirOff[g.rng.randint0(8)] as Loc;
  for (;;) {
    for (let i = 0; i < g.profileStr.den; i++) {
      const d = g.profileStr.rng;
      const change = findNearbyGrid(c, g.rng, grid, d, d);
      if (change && (c.isMagma(change) || c.isQuartz(change) || c.isGranite(change))) {
        c.setFeat(change, feat);
        if (g.rng.oneIn(chance)) {
          /* square_upgrade_mineral: magma/quartz -> the treasure variant. */
          const cur = c.feat(change);
          if (cur === FEAT.MAGMA) c.setFeat(change, FEAT.MAGMA_K);
          else if (cur === FEAT.QUARTZ) c.setFeat(change, FEAT.QUARTZ_K);
        }
      }
    }
    grid = loc(grid.x + dir.x, grid.y + dir.y);
    if (!c.inBounds(grid)) break;
  }
}

/* ------------------------------------------------------------------ *
 * ensure_connectedness (gen-cave.c flood-fill region joining).
 * ------------------------------------------------------------------ */

class IntQueue {
  private readonly data: number[] = [];
  private head = 0;
  push(v: number): void {
    this.data.push(v);
  }
  pop(): number {
    return this.data[this.head++] as number;
  }
  get length(): number {
    return this.data.length - this.head;
  }
}

function ignorePoint(g: Gen, colors: Int32Array, grid: Loc): boolean {
  if (!g.c.inBounds(grid)) return true;
  if (colors[grid.y * g.c.width + grid.x]) return true;
  if (g.c.isPassable(grid)) return false;
  if (g.c.isDoor(grid)) return false;
  return true;
}

function buildColorPoint(
  g: Gen,
  colors: Int32Array,
  counts: Int32Array,
  grid: Loc,
  color: number,
): void {
  const w = g.c.width;
  const queue = new IntQueue();
  const added = new Uint8Array(g.c.height * w);
  queue.push(grid.y * w + grid.x);
  counts[color] = 0;
  const ddd = ddgridDdd();
  while (queue.length > 0) {
    const n1 = queue.pop();
    const g1 = loc(n1 % w, Math.trunc(n1 / w));
    if (ignorePoint(g, colors, g1)) continue;
    colors[n1] = color;
    counts[color] = (counts[color] as number) + 1;
    for (let i = 0; i < 4; i++) {
      const off = ddd[i] as Loc;
      const g2 = loc(g1.x + off.x, g1.y + off.y);
      const n2 = g2.y * w + g2.x;
      if (ignorePoint(g, colors, g2)) continue;
      if (added[n2]) continue;
      queue.push(n2);
      added[n2] = 1;
    }
  }
}

function buildColors(g: Gen, colors: Int32Array, counts: Int32Array): void {
  let color = 1;
  for (let y = 0; y < g.c.height; y++) {
    for (let x = 0; x < g.c.width; x++) {
      if (ignorePoint(g, colors, loc(x, y))) continue;
      buildColorPoint(g, colors, counts, loc(x, y), color);
      color++;
    }
  }
}

function countColors(counts: Int32Array): number {
  let num = 0;
  for (const v of counts) if (v > 0) num++;
  return num;
}

function firstColor(counts: Int32Array): number {
  for (let i = 0; i < counts.length; i++) if ((counts[i] as number) > 0) return i;
  return -1;
}

function fixColors(colors: Int32Array, counts: Int32Array, from: number, to: number): void {
  for (let i = 0; i < colors.length; i++) if (colors[i] === from) colors[i] = to;
  counts[to] = (counts[to] as number) + (counts[from] as number);
  counts[from] = 0;
}

function joinRegion(
  g: Gen,
  colors: Int32Array,
  counts: Int32Array,
  color: number,
  allowVaultDisconnect: boolean,
): void {
  const w = g.c.width;
  const size = g.c.height * w;
  const queue = new IntQueue();
  const previous = new Int32Array(size).fill(-1);
  let newColor = -1;

  for (let i = 0; i < size; i++) {
    if (colors[i] === color) {
      queue.push(i);
      previous[i] = i;
    }
  }

  const ddd = ddgridDdd();
  while (queue.length > 0) {
    const n1 = queue.pop();
    const color2 = colors[n1] as number;
    if (newColor === -1 && color2 && color2 !== color) newColor = color2;
    if (color2 === newColor) {
      let n = n1;
      while (colors[n] !== color) {
        const grid = loc(n % w, Math.trunc(n / w));
        if ((colors[n] as number) > 0) counts[colors[n] as number] = (counts[colors[n] as number] as number) - 1;
        counts[color] = (counts[color] as number) + 1;
        colors[n] = color;
        if (
          !g.c.isPerm(grid) &&
          !g.c.sqinfoHas(grid, SQUARE.VAULT) &&
          !(g.c.isPassable(grid) || g.c.isDoor(grid))
        ) {
          g.c.setFeat(grid, FEAT.FLOOR);
        }
        n = previous[n] as number;
      }
      fixColors(colors, counts, newColor, color);
      break;
    }
    for (let i = 0; i < 4; i++) {
      const off = ddd[i] as Loc;
      const grid = loc((n1 % w) + off.x, Math.trunc(n1 / w) + off.y);
      if (!g.c.inBounds(grid)) continue;
      const n2 = grid.y * w + grid.x;
      if ((previous[n2] as number) >= 0) continue;
      if (g.c.isPerm(grid)) continue;
      if (g.c.sqinfoHas(grid, SQUARE.VAULT) && !allowVaultDisconnect) continue;
      queue.push(n2);
      previous[n2] = n1;
    }
  }
}

/** ensure_connectedness: colour regions, then join until one remains. */
export function ensureConnectedness(g: Gen, allowVaultDisconnect: boolean): void {
  const size = g.c.height * g.c.width;
  const colors = new Int32Array(size);
  const counts = new Int32Array(size);
  buildColors(g, colors, counts);
  let num = countColors(counts);
  while (num > 1) {
    const color = firstColor(counts);
    joinRegion(g, colors, counts, color, allowVaultDisconnect);
    num--;
  }
}

/* ------------------------------------------------------------------ *
 * Cave builders.
 * ------------------------------------------------------------------ */

function sizePercent(rng: Rng, depth: number, quest: boolean): number {
  const i = rng.randint1(10) + Math.trunc(depth / 24);
  if (quest) return 100;
  if (i < 2) return 75;
  if (i < 3) return 80;
  if (i < 4) return 85;
  if (i < 5) return 90;
  if (i < 6) return 95;
  return 100;
}

function alloc2dBool(rows: number, cols: number): boolean[][] {
  const m: boolean[][] = [];
  for (let i = 0; i < rows; i++) m.push(new Array<boolean>(cols).fill(false));
  return m;
}

/** classic_gen. */
export const classicGen: CaveBuilder = (ctx) => {
  const { rng, reg, constants, dun, profile, depth } = ctx;
  const numRooms = Math.trunc((profile.dunRooms * sizePercent(rng, depth, dun.quest)) / 100);
  dun.blockHgt = profile.blockSize;
  dun.blockWid = profile.blockSize;
  const c = new Chunk(reg, constants.dungeonHgt, constants.dungeonWid);
  c.depth = depth;
  const g = makeGen(ctx, c);

  fillRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.GRANITE, SQUARE.NONE);
  dun.rowBlocks = Math.trunc(c.height / dun.blockHgt);
  dun.colBlocks = Math.trunc(c.width / dun.blockWid);
  dun.roomMap = alloc2dBool(dun.rowBlocks, dun.colBlocks);
  const blocksTried = alloc2dBool(dun.rowBlocks, dun.colBlocks);
  dun.pitNum = 0;
  dun.centN = 0;
  dun.resetEntranceData(c);

  let built = 0;
  while (built < numRooms) {
    let j = 0;
    let tby = 0;
    let tbx = 0;
    for (let by = 0; by < dun.rowBlocks; by++) {
      for (let bx = 0; bx < dun.colBlocks; bx++) {
        if ((blocksTried[by] as boolean[])[bx]) continue;
        j++;
        if (rng.oneIn(j)) {
          tby = by;
          tbx = bx;
        }
      }
    }
    if (j === 0) break;
    (blocksTried[tby] as boolean[])[tbx] = true;

    const key = rng.randint0(100);
    let rarity = 0;
    let i = 0;
    while (i === rarity && i < profile.maxRarity) {
      if (rng.randint0(profile.dunUnusual) < 50 + Math.trunc(c.depth / 2)) rarity++;
      i++;
    }

    for (const rp of profile.roomProfiles) {
      if (rp.rarity > rarity) continue;
      if (rp.cutoff <= key) continue;
      if (roomBuild(g, tby, tbx, rp, false, ctx.rooms)) {
        built++;
        break;
      }
    }
  }

  if (built < 2) return { gen: null, error: "less than two rooms created" };

  drawRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.PERM, SQUARE.NONE, true);
  doTraditionalTunneling(g);
  ensureConnectedness(g, true);

  for (let i = 0; i < profile.str.mag; i++) buildStreamer(g, FEAT.MAGMA, profile.str.mc);
  for (let i = 0; i < profile.str.qua; i++) buildStreamer(g, FEAT.QUARTZ, profile.str.qc);

  handleLevelStairs(g, dun.quest, rng.randRange(3, 4), rng.randRange(1, 2));

  const k = Math.max(Math.min(Math.trunc(c.depth / 3), 10), 2);
  allocObjects(g, SET_CORR, TYP_RUBBLE, rng.randint1(k), c.depth);
  allocObjects(g, SET_CORR, TYP_TRAP, Math.trunc(rng.randint1(k) / 5), c.depth);

  const pspot = newPlayerSpot(g);
  if (!pspot) return { gen: null, error: "could not place player" };
  g.playerSpot = pspot;

  let mcount = constants.levelMonsterMin + rng.randint1(8) + k;
  for (; mcount > 0; mcount--) pickAndPlaceDistantMonster(g, pspot, 0, true, c.depth);

  allocObjects(g, SET_ROOM, TYP_OBJECT, rng.randNormal(constants.roomItemAv, 3), c.depth);
  allocObjects(g, SET_BOTH, TYP_OBJECT, rng.randNormal(constants.bothItemAv, 3), c.depth);
  allocObjects(g, SET_BOTH, TYP_GOLD, rng.randNormal(constants.bothGoldAv, 3), c.depth);

  return { gen: g, error: null };
};

/** modified_chunk: build the room+tunnel skeleton for a modified level. */
function modifiedChunk(ctx: CaveBuildContext, height: number, width: number): Gen | null {
  const { rng, reg, constants, dun, profile, depth } = ctx;
  const c = new Chunk(reg, height, width);
  c.depth = depth;
  const g = makeGen(ctx, c);

  const numFloors = Math.trunc((c.height * c.width) / 7);
  fillRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.GRANITE, SQUARE.NONE);
  drawRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.PERM, SQUARE.NONE, true);
  dun.rowBlocks = Math.trunc(c.height / dun.blockHgt);
  dun.colBlocks = Math.trunc(c.width / dun.blockWid);
  dun.roomMap = alloc2dBool(dun.rowBlocks, dun.colBlocks);
  dun.pitNum = 0;
  dun.centN = 0;
  dun.resetEntranceData(c);

  let nAttempt = 0;
  for (;;) {
    if ((c.featCount[FEAT.FLOOR] ?? 0) >= numFloors && dun.centN >= 2) break;
    if (nAttempt > 500) return null;
    nAttempt++;
    const key = rng.randint0(100);
    let rarity = 0;
    let i = 0;
    while (i === rarity && i < profile.maxRarity) {
      if (rng.randint0(profile.dunUnusual) < 50 + Math.trunc(c.depth / 2)) rarity++;
      i++;
    }
    for (const rp of profile.roomProfiles) {
      if (rp.rarity > rarity) continue;
      if (rp.cutoff <= key) continue;
      if (roomBuild(g, 0, 0, rp, true, ctx.rooms)) break;
    }
  }

  doTraditionalTunneling(g);
  ensureConnectedness(g, true);
  drawRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.GRANITE, SQUARE.NONE, true);
  return g;
}

/** modified_gen. */
export const modifiedGen: CaveBuilder = (ctx) => {
  const { rng, constants, dun, depth } = ctx;
  const sp = sizePercent(rng, depth, dun.quest);
  let ySize = Math.trunc((constants.dungeonHgt * (sp - 5 + rng.randint0(10))) / 100);
  let xSize = Math.trunc((constants.dungeonWid * (sp - 5 + rng.randint0(10))) / 100);
  ySize = Math.min(Math.max(ySize, ctx.minHeight), constants.dungeonHgt);
  xSize = Math.min(Math.max(xSize, ctx.minWidth), constants.dungeonWid);
  dun.blockHgt = ctx.profile.blockSize;
  dun.blockWid = ctx.profile.blockSize;

  const g = modifiedChunk(
    ctx,
    Math.min(constants.dungeonHgt, ySize),
    Math.min(constants.dungeonWid, xSize),
  );
  if (!g) return { gen: null, error: "modified chunk could not be created" };
  const c = g.c;

  drawRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.PERM, SQUARE.NONE, true);

  for (let i = 0; i < ctx.profile.str.mag; i++) buildStreamer(g, FEAT.MAGMA, ctx.profile.str.mc);
  for (let i = 0; i < ctx.profile.str.qua; i++) buildStreamer(g, FEAT.QUARTZ, ctx.profile.str.qc);

  handleLevelStairs(g, dun.quest, rng.randRange(3, 4), rng.randRange(1, 2));

  const k = Math.max(Math.min(Math.trunc(c.depth / 3), 10), 2);
  allocObjects(g, SET_CORR, TYP_RUBBLE, rng.randint1(k), c.depth);
  allocObjects(g, SET_CORR, TYP_TRAP, Math.trunc(rng.randint1(k) / 5), c.depth);

  const pspot = newPlayerSpot(g);
  if (!pspot) return { gen: null, error: "could not place player" };
  g.playerSpot = pspot;

  let mcount = constants.levelMonsterMin + rng.randint1(8) + k;
  for (; mcount > 0; mcount--) pickAndPlaceDistantMonster(g, pspot, 0, true, c.depth);

  allocObjects(g, SET_ROOM, TYP_OBJECT, rng.randNormal(constants.roomItemAv, 3), c.depth);
  allocObjects(g, SET_BOTH, TYP_OBJECT, rng.randNormal(constants.bothItemAv, 3), c.depth);
  allocObjects(g, SET_BOTH, TYP_GOLD, rng.randNormal(constants.bothGoldAv, 3), c.depth);

  return { gen: g, error: null };
};

/* ------------------------------------------------------------------ *
 * Labyrinth generator (gen-cave.c labyrinth_chunk / labyrinth_gen).
 * ------------------------------------------------------------------ */

/**
 * lab_get_adjoin: given an adjoining wall index i in a width-w labyrinth,
 * return the two cell indices [a, b] it separates.
 */
function labGetAdjoin(i: number, w: number): [number, number] {
  const grid = iToGrid(i, w);
  if (grid.x % 2 === 0) {
    return [gridToI(nextGrid(grid, DIR_N), w), gridToI(nextGrid(grid, DIR_S), w)];
  }
  return [gridToI(nextGrid(grid, DIR_W), w), gridToI(nextGrid(grid, DIR_E), w)];
}

/**
 * lab_is_tunnel: true if grid is a straight (non-intersection) passage - the
 * squares on one axis are open and on the other are walls. Doors count as open.
 */
function labIsTunnel(c: Chunk, grid: Loc): boolean {
  const open = (g: Loc): boolean => c.isPassable(g) || c.isClosedDoor(g);
  const west = open(nextGrid(grid, DIR_W));
  const east = open(nextGrid(grid, DIR_E));
  const north = open(nextGrid(grid, DIR_N));
  const south = open(nextGrid(grid, DIR_S));
  return north === south && west === east && north !== west;
}

/**
 * labyrinth_chunk: build an h x w labyrinth (in a chunk sized h+2 x w+2 with a
 * perma-rock border) using a randomized Kruskal's algorithm. NEW helpers:
 * labGetAdjoin/labIsTunnel (the maze index math and tunnel test).
 */
function labyrinthChunk(
  ctx: CaveBuildContext,
  depth: number,
  h: number,
  w: number,
  lit: boolean,
  soft: boolean,
): Gen {
  const { rng, reg } = ctx;
  const c = new Chunk(reg, h + 2, w + 2);
  c.depth = depth;
  const g = makeGen(ctx, c);

  /* Number of squares in the labyrinth. */
  const n = h * w;
  /* sets[i] tracks connectedness; walls[i] is the shuffle list. */
  const sets = new Array<number>(n);
  const walls = new Array<number>(n);

  /* Bound with perma-rock; fill the interior with rock. */
  drawRectangle(c, 0, 0, h + 1, w + 1, FEAT.PERM, SQUARE.NONE, true);
  if (soft) fillRectangle(c, 1, 1, h, w, FEAT.GRANITE, SQUARE.WALL_SOLID);
  else fillRectangle(c, 1, 1, h, w, FEAT.PERM, SQUARE.NONE);

  for (let i = 0; i < n; i++) {
    walls[i] = i;
    sets[i] = -1;
  }

  /* Cut out a grid of 1x1 "cells". next_grid(grid, DIR_SE) translates
   * labyrinth-space (0-based) into chunk-space (offset by the border). */
  for (let gy = 0; gy < h; gy += 2) {
    for (let gx = 0; gx < w; gx += 2) {
      const grid = loc(gx, gy);
      const kLocal = gridToI(grid, w);
      const diag = nextGrid(grid, DIR_SE);
      sets[kLocal] = kLocal;
      c.setFeat(diag, FEAT.FLOOR);
      if (lit) c.sqinfoOn(diag, SQUARE.GLOW);
    }
  }

  /* Shuffle the walls, then run randomized Kruskal's algorithm. */
  shuffle(rng, walls, n);
  for (let i = 0; i < n; i++) {
    const j = walls[i] as number;
    const grid = iToGrid(j, w);
    if ((grid.x < 1 && grid.y < 1) || (grid.x > w - 2 && grid.y > h - 2)) continue;
    if (grid.x % 2 === grid.y % 2) continue;

    const [a, b] = labGetAdjoin(j, w);
    if (sets[a] !== sets[b]) {
      const sa = sets[a] as number;
      const sb = sets[b] as number;
      const diag = nextGrid(grid, DIR_SE);
      c.setFeat(diag, FEAT.FLOOR);
      if (lit) c.sqinfoOn(diag, SQUARE.GLOW);
      for (let k = 0; k < n; k++) if (sets[k] === sb) sets[k] = sa;
    }
  }

  /* Generate a closed door for every 100 squares in the labyrinth. */
  const finder = new CaveFinder(loc(1, 1), loc(c.width - 2, c.height - 2));
  let doors = Math.trunc(n / 100);
  while (doors > 0) {
    const grid = finder.get(rng);
    if (!grid) break;
    if (squareIsEmpty(g, grid) && labIsTunnel(c, grid)) {
      placeClosedDoor(g, grid);
      doors--;
    }
  }

  /* Unlit labyrinths hold some good items; hard (non-diggable) ones some great. */
  if (!lit) allocObjects(g, SET_BOTH, TYP_GOOD, rng.randNormal(3, 2), c.depth);
  if (!soft) allocObjects(g, SET_BOTH, TYP_GREAT, rng.randNormal(2, 1), c.depth);

  return g;
}

/** labyrinth_gen: build a labyrinth level. */
export const labyrinthGen: CaveBuilder = (ctx) => {
  const { rng, constants, dun, depth } = ctx;

  /* The labyrinth area (excluding the enclosing walls) must be odd-sized. */
  let h = 15 + rng.randint0(Math.trunc(depth / 10)) * 2;
  let w = 51 + rng.randint0(Math.trunc(depth / 10)) * 2;

  /* Most labyrinths are lit; many lit ones are known; most have soft walls. */
  const lit = rng.randint0(depth) < 25 || rng.randint0(2) < 1;
  const known = lit && rng.randint0(depth) < 25;
  const soft = rng.randint0(depth) < 35 || rng.randint0(3) < 2;

  /* No persistent levels of this type for now. */
  if (dun.persist) {
    return { gen: null, error: "no labyrinth levels in persistent dungeons" };
  }

  /* Enforce minimum dimensions. */
  h = Math.max(h, ctx.minHeight);
  w = Math.max(w, ctx.minWidth);

  const g = labyrinthChunk(ctx, depth, h, w, lit, soft);
  const c = g.c;

  /* Determine the character location. */
  const pspot = newPlayerSpot(g);
  if (!pspot) return { gen: null, error: "could not place player" };
  g.playerSpot = pspot;

  /* A single set of up/down stairs, if not already present. */
  if (!caveFind(c, rng, (cc, gr) => cc.isUpstairs(gr))) {
    allocStairs(g, FEAT.LESS, 1, 0, false, dun.oneOffAbove, dun.quest);
  }
  if (!caveFind(c, rng, (cc, gr) => cc.isDownstairs(gr))) {
    allocStairs(g, FEAT.MORE, 1, 0, false, dun.oneOffBelow, dun.quest);
  }

  /* Rubble, traps and monsters, scaled by labyrinth size. */
  let k = Math.max(Math.min(Math.trunc(c.depth / 3), 10), 2);
  k = Math.trunc((3 * k * (h * w)) / (constants.dungeonHgt * constants.dungeonWid));

  allocObjects(g, SET_BOTH, TYP_RUBBLE, rng.randint1(k), c.depth);
  allocObjects(g, SET_CORR, TYP_TRAP, rng.randint1(k), c.depth);

  let mcount = constants.levelMonsterMin + rng.randint1(8) + k;
  for (; mcount > 0; mcount--) pickAndPlaceDistantMonster(g, pspot, 0, true, c.depth);

  allocObjects(g, SET_BOTH, TYP_OBJECT, rng.randNormal(k * 6, 2), c.depth);
  allocObjects(g, SET_BOTH, TYP_GOLD, rng.randNormal(k * 3, 2), c.depth);
  allocObjects(g, SET_BOTH, TYP_GOOD, rng.randint1(2), c.depth);

  /* known would set p->upkeep->light_level upstream (a UI reveal flag, no RNG
   * and no layout effect); the port does not model player upkeep here. */
  void known;

  return { gen: g, error: null };
};

/* ------------------------------------------------------------------ *
 * Cavern generator (gen-cave.c init_cavern / mutate_cavern /
 * clear_small_regions / cavern_chunk / cavern_gen). Cellular-automaton cave.
 * ------------------------------------------------------------------ */

const MAX_CAVERN_TRIES = 10;

/**
 * init_cavern: fill the chunk with rock, then open `density` percent of the
 * interior to floor at random. The `join` connector list (empty for
 * non-persistent levels) builds in stairs surrounded by protected floor/rock;
 * it is ported faithfully but dormant until persistent levels wire dun.join.
 */
function initCavern(g: Gen, density: number, join: Connector[]): void {
  const c = g.c;
  const rng = g.rng;
  const h = c.height;
  const w = c.width;
  const size = h * w;
  let count = Math.trunc((size * density) / 100);

  /* Fill the entire chunk with rock. */
  fillRectangle(c, 0, 0, h - 1, w - 1, FEAT.GRANITE, SQUARE.WALL_SOLID);

  /* Add in the desired stairs (dormant for non-persistent levels). */
  for (const j of join) {
    if (
      j.grid.y > 0 &&
      j.grid.y < h - 1 &&
      j.grid.x > 0 &&
      j.grid.x < w - 1 &&
      !c.isStairs(j.grid)
    ) {
      const bcrit = rng.randint0(h) + (j.grid.y > Math.trunc(h / 2) ? -10 : 10);
      const rcrit = rng.randint0(w) + (j.grid.x > Math.trunc(w / 2) ? -10 : 10);
      const offy = bcrit > j.grid.y ? 1 : -1;
      const offx = rcrit > j.grid.x ? 1 : -1;

      if (!c.isFloor(j.grid)) count--;
      c.setFeat(j.grid, j.feat);

      let adj = loc(j.grid.x + offx, j.grid.y + offy);
      if (!c.isStairs(adj) && !c.isFloor(adj)) {
        count--;
        c.setFeat(adj, FEAT.FLOOR);
      }
      adj = loc(j.grid.x, j.grid.y + offy);
      if (!c.isStairs(adj) && !c.isFloor(adj)) {
        count--;
        c.setFeat(adj, FEAT.FLOOR);
      }
      adj = loc(j.grid.x + offx, j.grid.y);
      if (!c.isStairs(adj) && !c.isFloor(adj)) {
        count--;
        c.setFeat(adj, FEAT.FLOOR);
      }
      adj = loc(j.grid.x - offx, j.grid.y - offy);
      if (c.isGranite(adj)) c.setFeat(adj, FEAT.PERM);
      adj = loc(j.grid.x, j.grid.y - offy);
      if (c.isGranite(adj)) c.setFeat(adj, FEAT.PERM);
      adj = loc(j.grid.x - offx, j.grid.y);
      if (c.isGranite(adj)) c.setFeat(adj, FEAT.PERM);
    }
  }

  while (count > 0) {
    const grid = loc(rng.randint1(w - 2), rng.randint1(h - 2));
    if (c.isGranite(grid)) {
      c.setFeat(grid, FEAT.FLOOR);
      count--;
    }
  }
}

/** mutate_cavern: one pass of the (4,5) cellular-automaton rules. No RNG. */
function mutateCavern(g: Gen): void {
  const c = g.c;
  const h = c.height;
  const w = c.width;
  const temp = new Int32Array(h * w);
  const passable = (cc: Chunk, gr: Loc): boolean => cc.isPassable(gr);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const grid = loc(x, y);
      const count = 8 - countNeighbors(c, grid, passable, false);
      const i = gridToI(grid, w);
      if (c.isStairs(grid) || c.isPerm(grid)) temp[i] = c.feat(grid);
      else if (count > 5) temp[i] = FEAT.GRANITE;
      else if (count < 4) temp[i] = FEAT.FLOOR;
      else temp[i] = c.feat(grid);
    }
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const grid = loc(x, y);
      const feat = temp[gridToI(grid, w)] as number;
      if (feat === FEAT.GRANITE) setMarkedGranite(c, grid, SQUARE.WALL_SOLID);
      else c.setFeat(grid, feat);
    }
  }
}

/**
 * clear_small_regions: delete all open regions smaller than 9 squares (turning
 * them back to granite). No stair-preservation here: join is empty for
 * non-persistent levels, so no region carries a staircase to protect.
 */
function clearSmallRegions(g: Gen, colors: Int32Array, counts: Int32Array): void {
  const c = g.c;
  const size = c.height * c.width;
  const deleted = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    if ((counts[i] as number) < 9) {
      deleted[i] = 1;
      counts[i] = 0;
    }
  }

  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const grid = loc(x, y);
      const i = gridToI(grid, c.width);
      if (!deleted[colors[i] as number]) continue;
      colors[i] = 0;
      setMarkedGranite(c, grid, SQUARE.WALL_SOLID);
    }
  }
}

/**
 * cavern_chunk: build a cellular-automaton cavern, regenerating (up to
 * MAX_CAVERN_TRIES times) until enough floor is open, then colour the regions,
 * delete the small ones and join the rest into one connected cave. Returns null
 * if no large-enough cavern could be made. Reuses the file's buildColors /
 * joinRegion / countColors / firstColor region machinery.
 */
function cavernChunk(
  ctx: CaveBuildContext,
  depth: number,
  h: number,
  w: number,
  join: Connector[],
): Gen | null {
  const { rng, reg } = ctx;
  const size = h * w;
  const limit = Math.trunc(size / 13);
  const density = rng.randRange(25, 40);
  const times = rng.randRange(3, 6);

  const c = new Chunk(reg, h, w);
  c.depth = depth;
  const g = makeGen(ctx, c);

  let tries = 0;
  for (; tries < MAX_CAVERN_TRIES; tries++) {
    initCavern(g, density, join);
    for (let i = 0; i < times; i++) mutateCavern(g);
    if ((c.featCount[FEAT.FLOOR] ?? 0) >= limit) break;
  }
  if (tries === MAX_CAVERN_TRIES) return null;

  const colors = new Int32Array(size);
  const counts = new Int32Array(size);
  buildColors(g, colors, counts);
  clearSmallRegions(g, colors, counts);
  let num = countColors(counts);
  while (num > 1) {
    joinRegion(g, colors, counts, firstColor(counts), true);
    num--;
  }

  /* Convert the permanent rock walls near stairs back to granite (dormant). */
  for (const j of join) {
    for (let i = 0; i < 8; i++) {
      const adj = locSum(j.grid, DDGRID_DDD[i] as Loc);
      if (c.inBounds(adj) && c.isPerm(adj)) setMarkedGranite(c, adj, SQUARE.WALL_SOLID);
    }
  }

  return g;
}

/** cavern_gen: build a cavern level. */
export const cavernGen: CaveBuilder = (ctx) => {
  const { rng, constants, dun, depth } = ctx;

  let h = rng.randRange(Math.trunc(constants.dungeonHgt / 2), Math.trunc((constants.dungeonHgt * 3) / 4));
  let w = rng.randRange(Math.trunc(constants.dungeonWid / 2), Math.trunc((constants.dungeonWid * 3) / 4));

  /* Enforce minimum dimensions. */
  h = Math.max(h, ctx.minHeight);
  w = Math.max(w, ctx.minWidth);

  const g = cavernChunk(ctx, depth, h, w, dun.join);
  if (!g) return { gen: null, error: "cavern chunk could not be created" };
  const c = g.c;

  /* Surround the level with perma-rock. */
  drawRectangle(c, 0, 0, h - 1, w - 1, FEAT.PERM, SQUARE.NONE, true);

  /* Place 1-3 down stairs and 1-2 up stairs near some walls. */
  handleLevelStairs(g, dun.quest, rng.randRange(1, 3), rng.randRange(1, 2));

  /* Rubble, traps and monsters, scaled (with a floor of 6) by cavern size. */
  let k = Math.max(Math.min(Math.trunc(c.depth / 3), 10), 2);
  k = Math.max(Math.trunc((4 * k * (h * w)) / (constants.dungeonHgt * constants.dungeonWid)), 6);

  allocObjects(g, SET_BOTH, TYP_RUBBLE, rng.randint1(k), c.depth);
  allocObjects(g, SET_CORR, TYP_TRAP, rng.randint1(k), c.depth);

  /* Determine the character location. */
  const pspot = newPlayerSpot(g);
  if (!pspot) return { gen: null, error: "could not place player" };
  g.playerSpot = pspot;

  let mcount = rng.randint1(8) + k;
  for (; mcount > 0; mcount--) pickAndPlaceDistantMonster(g, pspot, 0, true, c.depth);

  allocObjects(g, SET_BOTH, TYP_OBJECT, rng.randNormal(k, 2), c.depth + 5);
  allocObjects(g, SET_BOTH, TYP_GOLD, rng.randNormal(Math.trunc(k / 2), 2), c.depth);
  allocObjects(g, SET_BOTH, TYP_GOOD, rng.randint0(Math.trunc(k / 4)), c.depth);

  return { gen: g, error: null };
};

/**
 * The eight town entrance features, in store order: the seven shops plus the
 * player's Home. Their FEAT_* indices are the store_at keys the store runtime
 * looks a store up by.
 */
export const TOWN_STORE_FEATS: readonly number[] = [
  FEAT.STORE_GENERAL,
  FEAT.STORE_ARMOR,
  FEAT.STORE_WEAPON,
  FEAT.STORE_BOOK,
  FEAT.STORE_ALCHEMY,
  FEAT.STORE_MAGIC,
  FEAT.STORE_BLACK,
  FEAT.HOME,
];

/* ------------------------------------------------------------------ *
 * Faithful town generation (gen-cave.c town_gen_layout / town_gen).
 *
 * Every RNG draw is reproduced in the exact upstream order and count. The
 * two subtleties that would otherwise diverge the seeded stream:
 *  1. Angband's MIN/MAX (h-basic.h) are macros - (a)>(b)?(b):(a) etc - that
 *     RE-EVALUATE the selected argument. When a randint0 lives inside a MIN/MAX
 *     argument it is drawn once for the comparison and AGAIN when that branch
 *     is chosen. macroMin/macroMax below model this with a thunk for the
 *     side-effecting argument.
 *  2. build_ruin's `!randint0(3)` is the first operand of an && so it is drawn
 *     for every non-building grid before the floor/perimeter tests.
 * ------------------------------------------------------------------ */

/** MAX(a, b) = (a < b) ? b : a with the C-macro re-evaluation of b. */
function macroMax(a: number, bThunk: () => number): number {
  const b = bThunk();
  return a < b ? bThunk() : a;
}

/** MIN(a, b) = (a > b) ? b : a with the C-macro re-evaluation of b. */
function macroMin(a: number, bThunk: () => number): number {
  const b = bThunk();
  return a > b ? bThunk() : a;
}

interface LotBounds {
  west: number;
  north: number;
  east: number;
  south: number;
}

/** get_lot_bounds (gen-cave.c L2243): the grid bounds of a town lot. */
function getLotBounds(
  c: Chunk,
  xroads: Loc,
  lot: Loc,
  lotWid: number,
  lotHgt: number,
): LotBounds {
  /* 0 is the road; no lots. */
  if (lot.x === 0 || lot.y === 0) return { west: 0, north: 0, east: 0, south: 0 };

  let west: number;
  let east: number;
  let north: number;
  let south: number;

  if (lot.x < 0) {
    west = Math.max(2, xroads.x - 1 + lot.x * lotWid);
    east = Math.min(c.width - 3, xroads.x - 2 + (lot.x + 1) * lotWid);
  } else {
    west = Math.max(2, xroads.x + 2 + (lot.x - 1) * lotWid);
    east = Math.min(c.width - 3, xroads.x + 1 + lot.x * lotWid);
  }

  if (lot.y < 0) {
    north = Math.max(2, xroads.y + lot.y * lotHgt);
    south = Math.min(c.height - 3, xroads.y - 1 + (lot.y + 1) * lotHgt);
  } else {
    north = Math.max(2, xroads.y + 2 + (lot.y - 1) * lotHgt);
    south = Math.min(c.height - 3, xroads.y + 1 + lot.y * lotHgt);
  }

  return { west, north, east, south };
}

/** lot_is_clear (gen-cave.c L2273): the lot is big enough and all floor. */
function lotIsClear(
  c: Chunk,
  xroads: Loc,
  lot: Loc,
  lotWid: number,
  lotHgt: number,
): boolean {
  const b = getLotBounds(c, xroads, lot, lotWid, lotHgt);
  if (b.east - b.west < lotWid - 1 || b.south - b.north < lotHgt - 1) return false;
  for (let x = b.west; x <= b.east; x++) {
    for (let y = b.north; y <= b.south; y++) {
      if (!c.isFloor(loc(x, y))) return false;
    }
  }
  return true;
}

/** lot_has_shop (gen-cave.c L2295): the lot already contains a shop entrance. */
function lotHasShop(
  c: Chunk,
  xroads: Loc,
  lot: Loc,
  lotWid: number,
  lotHgt: number,
): boolean {
  const b = getLotBounds(c, xroads, lot, lotWid, lotHgt);
  for (let x = b.west; x <= b.east; x++) {
    for (let y = b.north; y <= b.south; y++) {
      if (c.isShop(loc(x, y))) return true;
    }
  }
  return false;
}

/** build_store (gen-cave.c L2322): lay one store's building + door for shop n. */
function buildStore(
  g: Gen,
  n: number,
  xroads: Loc,
  lot: Loc,
  lotWid: number,
  lotHgt: number,
): void {
  const c = g.c;
  const rng = g.rng;
  const { west: lotW, north: lotN, east: lotE, south: lotS } = getLotBounds(
    c,
    xroads,
    lot,
    lotWid,
    lotHgt,
  );

  let doorX = 0;
  let doorY = 0;
  let buildW = 0;
  let buildN = 0;
  let buildE = 0;
  let buildS = 0;

  if (lot.x < -1 || lot.x > 1) {
    /* on the east west street */
    if (lot.y === -1) {
      /* north side of street */
      doorY = macroMax(lotN + 1, () => lotS - rng.randint0(2));
      buildS = doorY;
      buildN = doorY - 2;
    } else {
      /* south side */
      doorY = macroMin(lotS - 1, () => lotN + rng.randint0(2));
      buildN = doorY;
      buildS = doorY + 2;
    }

    doorX = rng.randRange(lotW + 1, lotE - 2);
    buildW = rng.randRange(Math.max(lotW, doorX - 2), doorX);
    if (!c.isFloor(loc(buildW - 1, doorY))) {
      buildW++;
      doorX = Math.max(doorX, buildW);
    }
    buildE = rng.randRange(buildW + 2, Math.min(doorX + 2, lotE));
    if (buildE - buildW > 1 && !c.isFloor(loc(buildE + 1, doorY))) {
      buildE--;
      doorX = Math.min(doorX, buildE);
    }
  } else if (lot.y < -1 || lot.y > 1) {
    /* on the north - south street */
    if (lot.x === -1) {
      /* west side of street */
      doorX = macroMax(lotW + 1, () => lotE - rng.randint0(2) - rng.randint0(2));
      buildE = doorX;
      buildW = doorX - 2;
    } else {
      /* east side */
      doorX = macroMin(lotE - 1, () => lotW + rng.randint0(2) + rng.randint0(2));
      buildW = doorX;
      buildE = doorX + 2;
    }

    doorY = rng.randRange(lotN, lotS - 1);
    buildN = rng.randRange(Math.max(lotN, doorY - 2), doorY);
    if (!c.isFloor(loc(doorX, buildN - 1))) {
      buildN++;
      doorY = Math.max(doorY, buildN);
    }
    buildS = rng.randRange(Math.max(buildN + 1, doorY), Math.min(lotS, doorY + 2));
    if (buildS - buildN > 1 && !c.isFloor(loc(doorX, buildS + 1))) {
      buildS--;
      doorY = Math.min(doorY, buildS);
    }
  } else {
    /* corner store */
    if (lot.x < 0) {
      /* west side */
      doorX = lotE - 1 - rng.randint0(2);
      buildE = macroMin(lotE, () => doorX + rng.randint0(2));
      buildW = rng.randRange(Math.max(lotW, doorX - 2), buildE - 2);
    } else {
      /* east side */
      doorX = lotW + 1 + rng.randint0(2);
      buildW = macroMax(lotW, () => doorX - rng.randint0(2));
      buildE = rng.randRange(buildW + 2, Math.min(lotE, doorX + 2));
    }

    if (lot.y < 0) {
      /* north side */
      doorY = lotS - rng.randint0(2);
      if (buildE === doorX || buildW === doorX) {
        buildS = doorY + rng.randint0(2);
      } else {
        /* Avoid encapsulating door */
        buildS = doorY;
      }
      buildN = Math.max(lotN, doorY - 2);
      if (buildS - buildN > 1 && !c.isFloor(loc(doorX, buildN - 1))) {
        buildN++;
        doorY = Math.max(buildN, doorY);
      }
    } else {
      /* south side */
      doorY = lotN + rng.randint0(2);
      if (buildE === doorX || buildW === doorX) {
        buildN = doorY - rng.randint0(2);
      } else {
        /* Avoid encapsulating door */
        buildN = doorY;
      }
      buildS = Math.min(lotS, doorY + 2);
      if (buildS - buildN > 1 && !c.isFloor(loc(doorX, buildS + 1))) {
        buildS--;
        doorY = Math.min(buildS, doorY);
      }
    }

    /* Avoid placing buildings without space between them */
    if (lot.x < 0 && buildE - buildW > 1 && !c.isFloor(loc(buildW - 1, doorY))) {
      buildW++;
      doorX = Math.max(doorX, buildW);
    } else if (
      lot.x > 0 &&
      buildE - buildW > 1 &&
      !c.isFloor(loc(buildE + 1, doorY))
    ) {
      buildE--;
      doorX = Math.min(doorX, buildE);
    }
  }

  buildW = Math.max(buildW, lotW);
  buildE = Math.min(buildE, lotE);
  buildN = Math.max(buildN, lotN);
  buildS = Math.min(buildS, lotS);

  /* Build an invulnerable rectangular building */
  fillRectangle(c, buildN, buildW, buildS, buildE, FEAT.PERM, SQUARE.NONE);

  /* Clear previous contents, add a store door (the feature whose shopnum is
   * n + 1; TOWN_STORE_FEATS is that store-index -> feature mapping). */
  c.setFeat(loc(doorX, doorY), TOWN_STORE_FEATS[n]!);
}

/** build_ruin (gen-cave.c L2461): a ruined granite building spewing rubble. */
function buildRuin(
  g: Gen,
  xroads: Loc,
  lot: Loc,
  lotWid: number,
  lotHgt: number,
): void {
  const c = g.c;
  const rng = g.rng;
  const b = getLotBounds(c, xroads, lot, lotWid, lotHgt);
  const lotWest = b.west;
  const lotNorth = b.north;
  const lotEast = b.east;
  const lotSouth = b.south;

  if (lotEast - lotWest < 1 || lotSouth - lotNorth < 1) return;

  /* make a building */
  const wid = rng.randRange(1, lotWid - 2);
  const hgt = rng.randRange(1, lotHgt - 2);

  const offsetX = rng.randRange(1, lotWid - 1 - wid);
  const offsetY = rng.randRange(1, lotHgt - 1 - hgt);

  const west = lotWest + offsetX;
  const north = lotNorth + offsetY;
  const south = lotSouth - (lotHgt - (hgt + offsetY));
  const east = lotEast - (lotWid - (wid + offsetX));

  fillRectangle(c, north, west, south, east, FEAT.GRANITE, SQUARE.NONE);

  /* and then destroy it and spew rubble everywhere */
  for (let x = lotWest; x <= lotEast; x++) {
    for (let y = lotNorth; y <= lotSouth; y++) {
      if (x >= west && x <= east && y >= north && y <= south) {
        if (rng.randint0(4) === 0) {
          c.setFeat(loc(x, y), FEAT.RUBBLE);
        }
      } else if (
        rng.randint0(3) === 0 &&
        c.isFloor(loc(x, y)) &&
        /* Avoid placing rubble next to a store */
        (x > lotWest || x === 2 || !c.isPerm(loc(x - 1, y))) &&
        (x < lotEast || x === c.width - 2 || !c.isPerm(loc(x + 1, y))) &&
        (y > lotNorth || y === 2 || !c.isPerm(loc(x, y - 1))) &&
        (y < lotSouth || y === c.height - 2 || !c.isPerm(loc(x, y + 1)))
      ) {
        c.setFeat(loc(x, y), FEAT.PASS_RUBBLE);
      }
    }
  }
}

/**
 * cave_illuminate (cave-map.c L555), the RNG-free flag-setting subset used at
 * generation time: light (SQUARE_GLOW) every grid by day; by night keep only
 * non-floor / bright terrain lit. Shop doorways are always lit. The
 * player-knowledge side (square_memorize / square_forget) is a runtime concern
 * and is applied by the live game, not here.
 */
function caveIlluminate(c: Chunk, daytime: boolean): void {
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      if (daytime || !c.isFloor(grid)) {
        c.sqinfoOn(grid, SQUARE.GLOW);
      } else if (!featIsBright(c.features, c.feat(grid))) {
        c.sqinfoOff(grid, SQUARE.GLOW);
      }
    }
  }
  /* Light shop doorways. */
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      if (!c.isShop(grid)) continue;
      for (let i = 0; i < 8; i++) {
        const a = locSum(grid, DDGRID_DDD[i] as Loc);
        if (c.inBounds(a)) c.sqinfoOn(a, SQUARE.GLOW);
      }
    }
  }
}

/**
 * town_gen_layout (gen-cave.c L2515): build the town for the first time and
 * return the north-wall crossroads head (pgrid) - where the single down stair
 * sits and where the player is placed. Ported statement-by-statement so the
 * RNG stream matches upstream draw-for-draw. Returns the player/stair grid.
 */
function townGenLayout(g: Gen): Loc {
  const c = g.c;
  const rng = g.rng;
  const townWid = c.width; /* z_info->town_wid */
  const townHgt = c.height; /* z_info->town_hgt */
  const storeMax = TOWN_STORE_FEATS.length; /* z_info->store_max */

  const numLava = 3 + rng.randint0(3);
  const ruinsPercent = 80;
  const maxAttempts = 100;

  const lotHgt = 4;
  const lotWid = 6;

  /* Declared outside the retry loop; NOT reset on a retry (upstream). */
  let maxStoreY = 0;
  let minStoreX = townWid;
  let maxStoreX = 0;

  /* Create walls */
  drawRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.PERM, SQUARE.NONE, true);

  let pgrid = loc(0, 0);
  let xroads = loc(0, 0);
  let success = false;

  while (!success) {
    /* Initialize to ROCK for build_streamer precondition */
    for (let y = 1; y < c.height - 1; y++) {
      for (let x = 1; x < c.width - 1; x++) {
        c.setFeat(loc(x, y), FEAT.GRANITE);
      }
    }

    /* Make some lava streamers */
    for (let n = 0; n < 3 + numLava; n++) buildStreamer(g, FEAT.LAVA, 0);

    /* Make a town-sized starburst room. */
    generateStarburstRoom(g, 0, 0, c.height - 1, c.width - 1, false, FEAT.FLOOR, false);

    /* Turn off room illumination flag */
    for (let y = 1; y < c.height - 1; y++) {
      for (let x = 1; x < c.width - 1; x++) {
        c.sqinfoOff(loc(x, y), SQUARE.ROOM);
      }
    }

    /* Stairs along north wall */
    const px = rng.randSpread(Math.trunc(townWid / 2), Math.trunc(townWid / 6));
    let py = 1;
    while (!c.isFloor(loc(px, py)) && py < Math.trunc(townHgt / 4)) py++;
    if (py >= Math.trunc(townHgt / 4)) continue;
    pgrid = loc(px, py);

    /* no lava next to stairs */
    for (let x = px - 1; x <= px + 1; x++) {
      for (let y = py - 1; y <= py + 1; y++) {
        if (c.isFiery(loc(x, y))) c.setFeat(loc(x, y), FEAT.GRANITE);
      }
    }

    const xrx = px;
    const xry =
      Math.trunc(townHgt / 2) -
      rng.randint0(Math.trunc(townHgt / 4)) +
      rng.randint0(Math.trunc(townHgt / 8));
    xroads = loc(xrx, xry);

    const lotMinX = Math.trunc((-1 * xrx) / lotWid);
    const lotMaxX = Math.trunc((townWid - xrx) / lotWid);
    const lotMinY = Math.trunc((-1 * xry) / lotHgt);
    const lotMaxY = Math.trunc((townHgt - xry) / lotHgt);

    /* place stores along the streets */
    let numAttempts = 0;
    let exhausted = false;
    for (let n = 0; n < storeMax; n++) {
      let storeLot = loc(0, 0);
      let foundSpot = false;
      while (!foundSpot && numAttempts < maxAttempts) {
        numAttempts++;
        if (rng.randint0(2)) {
          /* east-west street */
          const sx = rng.randRange(lotMinX, lotMaxX);
          const sy = rng.randint0(2) ? 1 : -1;
          storeLot = loc(sx, sy);
        } else {
          /* north-south street */
          const sx = rng.randint0(2) ? 1 : -1;
          const sy = rng.randRange(lotMinY, lotMaxY);
          storeLot = loc(sx, sy);
        }
        if (storeLot.y === 0 || storeLot.x === 0) continue;
        foundSpot = lotIsClear(c, xroads, storeLot, lotWid, lotHgt);
      }
      if (numAttempts >= maxAttempts) {
        exhausted = true;
        break;
      }

      maxStoreY = Math.max(maxStoreY, xry + lotHgt * storeLot.y);
      minStoreX = Math.min(minStoreX, xrx + lotWid * storeLot.x);
      maxStoreX = Math.max(maxStoreX, xrx + lotWid * storeLot.x);

      buildStore(g, n, xroads, storeLot, lotWid, lotHgt);
    }
    if (exhausted) continue;

    /* place ruins */
    for (let x = lotMinX; x <= lotMaxX; x++) {
      if (x === 0) continue; /* 0 is the street */
      for (let y = lotMinY; y <= lotMaxY; y++) {
        if (y === 0) continue;
        if (rng.randint0(100) > ruinsPercent) continue;
        if (rng.oneIn(2) && !lotHasShop(c, xroads, loc(x, y), lotWid, lotHgt)) {
          buildRuin(g, xroads, loc(x, y), lotWid, lotHgt);
        }
      }
    }
    success = true;
  }

  /* clear the street */
  c.setFeat(loc(pgrid.x, pgrid.y + 1), FEAT.FLOOR);
  fillRectangle(c, pgrid.y + 2, pgrid.x - 1, maxStoreY, pgrid.x + 1, FEAT.FLOOR, SQUARE.NONE);
  fillRectangle(c, xroads.y, minStoreX, xroads.y + 1, maxStoreX, FEAT.FLOOR, SQUARE.NONE);

  /* Clear previous contents, add down stairs */
  c.setFeat(pgrid, FEAT.MORE);

  return pgrid;
}

/**
 * The town builder (town_gen, gen-cave.c L2664): a faithful port of the
 * first-time town layout (town_gen_layout) followed by day/night illumination
 * and the resident townsfolk. Store entrances are non-passable shop terrain (a
 * shell opens the shop when the player walks into one).
 *
 * DEFERRED: the chunk-persistence re-entry branch (town_gen L2682, a Tier-5
 * RECALL/level-persistence concern) - the port regenerates the town on every
 * entry, so only the first-time path is implemented. Day/night is honoured
 * when the caller supplies ctx.daytime; when omitted it defaults to daytime
 * (turn 0), which is the faithful state at birth.
 */
export const townGen: CaveBuilder = (ctx) => {
  const { constants } = ctx;
  const c = new Chunk(ctx.reg, constants.townHgt, constants.townWid);
  c.depth = ctx.depth;
  const g = makeGen(ctx, c);
  const daytime = ctx.daytime ?? true;

  /* Build the layout and place the player at the crossroads head. */
  const pgrid = townGenLayout(g);
  g.playerSpot = pgrid;

  /* Apply illumination. */
  caveIlluminate(c, daytime);

  /* Make some residents. */
  const residents = daytime
    ? constants.townMonstersDay
    : constants.townMonstersNight;
  for (let i = 0; i < residents; i++) {
    pickAndPlaceDistantMonster(g, pgrid, 3, true, c.depth);
  }

  return { gen: g, error: null };
};

/* ------------------------------------------------------------------ *
 * Stairs (handle_level_stairs) - non-persistent path.
 * ------------------------------------------------------------------ */

function handleLevelStairs(g: Gen, quest: boolean, downCount: number, upCount: number): void {
  /* Non-persistent minsep: a quarter of the shorter dimension. */
  const minsep = Math.max(Math.trunc(Math.min(g.c.width, g.c.height) / 4), 0);
  allocStairs(g, FEAT.MORE, downCount, minsep, false, g.dun.oneOffBelow, quest);
  allocStairs(g, FEAT.LESS, upCount, minsep, false, g.dun.oneOffAbove, quest);
}

/* ------------------------------------------------------------------ *
 * Context construction (attach profile tun/str shortcuts to Gen).
 * ------------------------------------------------------------------ */

function makeGen(ctx: CaveBuildContext, c: Chunk): Gen {
  const g = new Gen(c, ctx.rng, ctx.reg, ctx.constants, ctx.dun, ctx.objDeps, ctx.monDeps);
  /* Attach the current profile's tunnel/streamer parameters for the tunnel
   * and streamer helpers (they are read-only during a build). */
  g.profileTun = ctx.profile.tun;
  g.profileStr = ctx.profile.str;
  return g;
}

/* ------------------------------------------------------------------ *
 * Dungeon profile registry + selection (choose_profile).
 * ------------------------------------------------------------------ */

/** labyrinth_check: d_m's prime-number labyrinth acceptance. */
function labyrinthCheck(rng: Rng, depth: number): boolean {
  let chance = 2;
  if (depth < 13) return false;
  if (depth % 3 === 0) chance += 1;
  if (depth % 5 === 0) chance += 1;
  if (depth % 7 === 0) chance += 1;
  if (depth % 11 === 0) chance += 1;
  if (depth % 13 === 0) chance += 1;
  if (rng.randint0(100) >= chance) return false;
  return true;
}

export interface ChooseProfileOptions {
  quest?: boolean;
}

/**
 * The dungeon-profile registry: a string-keyed set of cave builders plus the
 * ordered profile list used for selection. Both are runtime-registrable so a
 * mod can add a builder and/or a whole new profile.
 */
export class DungeonProfiles {
  private readonly builders = new Map<string, CaveBuilder>();
  private readonly profiles: DunProfile[] = [];

  registerBuilder(key: string, builder: CaveBuilder): void {
    this.builders.set(key, builder);
  }

  builder(key: string): CaveBuilder {
    const b = this.builders.get(key);
    if (!b) throw new Error(`gen: no cave builder registered for '${key}'`);
    return b;
  }

  hasBuilder(key: string): boolean {
    return this.builders.has(key);
  }

  addProfile(profile: DunProfile): void {
    this.profiles.push(profile);
  }

  find(name: string): DunProfile | null {
    return this.profiles.find((p) => p.name === name) ?? null;
  }

  list(): readonly DunProfile[] {
    return this.profiles;
  }

  /** choose_profile: select a dungeon profile for the given depth. */
  choose(rng: Rng, depth: number, options: ChooseProfileOptions = {}): DunProfile {
    const quest = options.quest ?? false;
    const moria = this.find("moria");
    const labyrinth = this.find("labyrinth");
    const moriaAlloc = moria ? moria.alloc : 0;
    const labyrinthAlloc = labyrinth ? labyrinth.alloc : 0;

    let profile: DunProfile | null = null;
    if (depth === 0) {
      profile = this.find("town");
    } else if (quest) {
      profile = this.find("classic");
    } else if (labyrinthCheck(rng, depth) && (labyrinthAlloc > 0 || labyrinthAlloc === -1)) {
      profile = labyrinth;
    } else if (depth >= 10 && depth < 40 && rng.oneIn(40) && (moriaAlloc > 0 || moriaAlloc === -1)) {
      profile = moria;
    } else {
      let totalAlloc = 0;
      for (const test of this.profiles) {
        if (test.alloc <= 0 || depth < test.minLevel) continue;
        totalAlloc += test.alloc;
        if (rng.randint0(totalAlloc) < test.alloc) profile = test;
      }
      if (!profile) profile = this.find("classic");
    }

    if (!profile) profile = this.find("classic");
    if (!profile) throw new Error("gen: failed to find a cave profile");
    return profile;
  }
}

/**
 * Build the default dungeon-profile registry: cave builders for every upstream
 * key (classic/modified/town are real; the rest delegate to modified_gen and
 * are ledgered as deferred), and the town/classic/modified profiles enabled
 * for selection. Mods extend both via registerBuilder/addProfile.
 */
export function createDungeonProfiles(
  profileRecords: DunProfileRecordJson[],
): DungeonProfiles {
  const reg = new DungeonProfiles();
  reg.registerBuilder("classic", classicGen);
  reg.registerBuilder("modified", modifiedGen);
  reg.registerBuilder("town", townGen);
  reg.registerBuilder("labyrinth", labyrinthGen);
  reg.registerBuilder("cavern", cavernGen);
  /* Deferred builders delegate to modified_gen (ledgered). */
  reg.registerBuilder("moria", modifiedGen);
  reg.registerBuilder("lair", modifiedGen);
  reg.registerBuilder("gauntlet", modifiedGen);
  reg.registerBuilder("hard_centre", modifiedGen);

  /* Enable town, classic and modified for selection (the two working dungeon
   * profiles plus the minimal town). Their room lists carry a rarity-0,
   * cutoff-100 catch-all builder, so generation always terminates. */
  const enabled = new Set(["town", "classic", "modified"]);
  for (const rec of profileRecords) {
    if (!enabled.has(rec.name)) continue;
    reg.addProfile(loadDunProfile(rec));
  }
  return reg;
}
