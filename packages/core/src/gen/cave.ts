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
 * DEFERRED (ledgered in parity/ledger/gen-cave.yaml): labyrinth, cavern,
 * moria, lair, gauntlet and hard_centre builders (their builder keys are
 * registered but delegate to modified_gen); the town builder is a minimal
 * open level (full town generation with stores is a separate later task);
 * persistent-level connectors and the arena level.
 */

import type { Constants } from "../constants";
import { DUN_PROFILE_ENTRIES, FEAT, ROOM_ENTRIES, SQUARE } from "../generated";
import type { Loc } from "../loc";
import { loc } from "../loc";
import type { Rng } from "../rng";
import { Chunk } from "../world/chunk";
import type { FeatureRegistry } from "../world/feature";
import type { MakeDeps } from "../obj/make";
import type { RoomProfile, RoomRegistry } from "./room";
import { roomBuild } from "./room";
import {
  Dun,
  Gen,
  type MonPlaceDeps,
  allocObjects,
  allocStairs,
  correctDir,
  drawRectangle,
  fillRectangle,
  findNearbyGrid,
  newPlayerSpot,
  nextGrid,
  pickAndPlaceDistantMonster,
  placeRandomDoor,
  randDir,
  setMarkedGranite,
  squareIsGraniteWithFlag,
  squareIsRoom,
  squareIsStrongWall,
  SET_BOTH,
  SET_CORR,
  SET_ROOM,
  TYP_GOLD,
  TYP_OBJECT,
  TYP_RUBBLE,
  TYP_TRAP,
  DIR_N,
  DIR_S,
  DIR_E,
  DIR_W,
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

/**
 * A minimal town builder: an open lit level with a perimeter wall and a down
 * staircase. Full town generation (stores, home) is a separate later task.
 */
export const townGen: CaveBuilder = (ctx) => {
  const { constants, dun } = ctx;
  dun.blockHgt = 1;
  dun.blockWid = 1;
  const c = new Chunk(ctx.reg, constants.townHgt, constants.townWid);
  c.depth = ctx.depth;
  const g = makeGen(ctx, c);
  dun.rowBlocks = c.height;
  dun.colBlocks = c.width;
  dun.roomMap = alloc2dBool(dun.rowBlocks, dun.colBlocks);
  dun.centN = 0;
  dun.pitNum = 0;
  dun.resetEntranceData(c);

  fillRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.GRANITE, SQUARE.NONE);
  fillRectangle(c, 1, 1, c.height - 2, c.width - 2, FEAT.FLOOR, SQUARE.NONE);
  for (let y = 1; y <= c.height - 2; y++) {
    for (let x = 1; x <= c.width - 2; x++) {
      c.sqinfoOn(loc(x, y), SQUARE.ROOM);
      c.sqinfoOn(loc(x, y), SQUARE.GLOW);
    }
  }
  drawRectangle(c, 0, 0, c.height - 1, c.width - 1, FEAT.PERM, SQUARE.NONE, true);

  /* One down staircase (all town stairs go down). */
  allocStairs(g, FEAT.MORE, 1, 0, false, [], false);

  const pspot = newPlayerSpot(g);
  if (!pspot) return { gen: null, error: "could not place player in town" };
  g.playerSpot = pspot;
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
  /* Deferred builders delegate to modified_gen (ledgered). */
  reg.registerBuilder("moria", modifiedGen);
  reg.registerBuilder("labyrinth", modifiedGen);
  reg.registerBuilder("cavern", modifiedGen);
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
