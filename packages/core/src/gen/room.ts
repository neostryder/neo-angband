/**
 * Room builders and the runtime-registrable room-builder registry, ported
 * from reference/src/gen-room.c (Angband 4.2.6).
 *
 * MODDABILITY (ratified pillar, decision 13): builders live in a string-keyed
 * RoomRegistry. createRoomRegistry() populates it with the upstream builders;
 * a mod can register a new builder under any key and reference it from a
 * (modded) dungeon profile's room list. There is no closed switch.
 *
 * PORTED (faithful geometry and RNG order for the structural work): staircase
 * (persistent-only), simple, circular, overlap, crossed, large, template
 * (build_room_template from room_template.json), vault (build_vault from
 * vault.json) and the vault-type wrappers (lesser/medium/greater and their
 * "(new)" variants, interesting).
 *
 * SIMPLIFIED (ledgered in parity/ledger/gen-rooms.yaml): nest and pit build the
 * faithful room shell but fill with any depth-appropriate monster instead of a
 * themed pit profile; vault racial glyphs likewise place any depth-appropriate
 * monster rather than a base-symbol-restricted one.
 *
 * PORTED (starburst + cellular builders): moria (build_moria), room_of_chambers
 * (build_room_of_chambers, with make_chamber/hollow_out_room carving and the
 * get_chamber_monsters themed fill) and huge (build_huge). Faithful RNG order.
 */

import { FEAT, SQUARE } from "../generated";
import type { Loc } from "../loc";
import { loc, DDGRID_DDD } from "../loc";
import type { Rng } from "../rng";
import { tvalFindIdx } from "../obj/bind";
import type { Chunk } from "../world/chunk";
import type { Gen } from "./util";
import {
  countNeighbors,
  drawRectangle,
  fillCircle,
  fillRectangle,
  generateHole,
  generateMark,
  generateOpen,
  generatePlus,
  generateRoom,
  generateStarburstRoom,
  locDiff,
  locSum,
  pickAndPlaceMonster,
  placeClosedDoor,
  placeNewMonster,
  placeObject,
  placeGold,
  placeRandomDoor,
  placeRandomStairs,
  placeSecretDoor,
  placeTrap,
  randDir,
  setBorderingWalls,
  setMarkedGranite,
  squareIsRoom,
  vaultMonsters,
  vaultObjects,
  vaultTraps,
} from "./util";
import { getChamberMonsters, getVaultMonsters, monPitHook, setPitType } from "./gen-monster";
import type { MonsterGroupInfo } from "../mon/monster";
import type { MonsterRace } from "../mon/types";
import { MON_GROUP } from "../mon/types";

/* ------------------------------------------------------------------ *
 * Room and vault template data.
 * ------------------------------------------------------------------ */

/** room_template.json record. */
export interface RoomTemplateRecordJson {
  name: string;
  type: number;
  rating: number;
  rows: number;
  columns: number;
  doors: number;
  tval: string;
  D: string[];
  flags?: string[];
}

/** vault.json record. */
export interface VaultRecordJson {
  name: string;
  type: string;
  rating: number;
  rows: number;
  columns: number;
  "min-depth"?: number;
  "max-depth"?: number;
  D: string[];
  flags?: string[];
}

export interface RoomTemplate {
  name: string;
  typ: number;
  rat: number;
  hgt: number;
  wid: number;
  dor: number;
  tval: number;
  rows: string[];
  fewEntrances: boolean;
}

export interface Vault {
  name: string;
  typ: string;
  rat: number;
  hgt: number;
  wid: number;
  minLev: number;
  maxLev: number;
  rows: string[];
  fewEntrances: boolean;
}

function hasFewEntrances(flags: string[] | undefined): boolean {
  return !!flags && flags.some((f) => f.split("|").some((n) => n.trim() === "FEW_ENTRANCES"));
}

/** Load room templates from parsed room_template.json records. */
export function loadRoomTemplates(records: RoomTemplateRecordJson[]): RoomTemplate[] {
  return records.map((r) => ({
    name: r.name,
    typ: r.type,
    rat: r.rating,
    hgt: r.rows,
    wid: r.columns,
    dor: r.doors,
    tval: r.tval === "0" ? 0 : tvalFindIdx(r.tval),
    rows: [...r.D],
    fewEntrances: hasFewEntrances(r.flags),
  }));
}

/** Load vaults from parsed vault.json records. */
export function loadVaults(records: VaultRecordJson[]): Vault[] {
  return records.map((r) => ({
    name: r.name,
    typ: r.type,
    rat: r.rating,
    hgt: r.rows,
    wid: r.columns,
    minLev: r["min-depth"] ?? 0,
    maxLev: r["max-depth"] ?? 0,
    rows: [...r.D],
    fewEntrances: hasFewEntrances(r.flags),
  }));
}

/** The template/vault data a room registry closes over. */
export interface RoomData {
  templates: RoomTemplate[];
  vaults: Vault[];
}

/** random_room_template: reservoir pick of a template of a type and rating. */
function randomRoomTemplate(
  g: Gen,
  templates: RoomTemplate[],
  typ: number,
  rating: number,
): RoomTemplate | null {
  let r: RoomTemplate | null = null;
  let n = 1;
  for (const t of templates) {
    if (t.typ === typ && t.rat === rating) {
      if (g.rng.oneIn(n)) r = t;
      n++;
    }
  }
  return r;
}

/** random_vault: reservoir pick of an in-depth vault of a given type. */
function randomVault(rng: Rng, vaults: Vault[], depth: number, typ: string): Vault | null {
  let r: Vault | null = null;
  let n = 1;
  for (const v of vaults) {
    if (v.typ === typ && v.minLev <= depth && v.maxLev >= depth) {
      if (rng.oneIn(n)) r = v;
      n++;
    }
  }
  return r;
}

function glyphAt(rows: string[], y: number, x: number): string {
  const row = rows[y];
  if (row === undefined) return " ";
  return x < row.length ? (row[x] as string) : " ";
}

/* ------------------------------------------------------------------ *
 * Symmetry transforms (gen-chunk.c).
 * ------------------------------------------------------------------ */

const SYMTR_FLAG_NONE = 0;
const SYMTR_FLAG_NO_ROT = 1;
const SYMTR_FLAG_NO_REF = 2;
const SYMTR_FLAG_FORCE_REF = 4;
const SYMTR_MAX_WEIGHT = 32768;

/** symmetry_transform: rotate (clockwise), reflect, then translate. */
export function symmetryTransform(
  grid: Loc,
  y0: number,
  x0: number,
  height: number,
  width: number,
  rotate: number,
  reflect: boolean,
): Loc {
  let x = grid.x;
  let y = grid.y;
  let rheight = height;
  let rwidth = width;
  for (let i = 0; i < rotate % 4; i++) {
    const temp = x;
    x = rheight - 1 - y;
    y = temp;
    const t2 = rwidth;
    rwidth = rheight;
    rheight = t2;
  }
  if (reflect) x = rwidth - 1 - x;
  return loc(x + x0, y + y0);
}

export interface SymmetryResult {
  rotate: number;
  reflect: boolean;
  theight: number;
  twidth: number;
}

/** get_random_symmetry_transform. */
export function getRandomSymmetryTransform(
  g: Gen,
  height: number,
  width: number,
  flags: number,
  transposeWeightIn: number,
): SymmetryResult {
  const w = new Array<number>(9).fill(0);
  const transposeWeight = Math.min(SYMTR_MAX_WEIGHT, Math.max(0, transposeWeightIn));
  w[0] = 0;
  if (flags & SYMTR_FLAG_NO_REF || !(flags & SYMTR_FLAG_FORCE_REF)) {
    w[1] = w[0] + SYMTR_MAX_WEIGHT;
  } else {
    w[1] = w[0];
  }
  if (flags & SYMTR_FLAG_NO_ROT) {
    w[2] = w[1];
    w[3] = w[2];
    w[4] = w[3];
  } else if (flags & SYMTR_FLAG_NO_REF || !(flags & SYMTR_FLAG_FORCE_REF)) {
    w[2] = w[1] + transposeWeight;
    w[3] = w[2] + SYMTR_MAX_WEIGHT;
    w[4] = w[3] + transposeWeight;
  } else {
    w[2] = w[1];
    w[3] = w[2];
    w[4] = w[3];
  }
  if (flags & SYMTR_FLAG_NO_REF) {
    w[5] = w[4];
    w[6] = w[5];
    w[7] = w[6];
    w[8] = w[7];
  } else {
    w[5] = w[4] + SYMTR_MAX_WEIGHT;
    if (flags & SYMTR_FLAG_NO_ROT) {
      w[6] = w[5];
      w[7] = w[6] + SYMTR_MAX_WEIGHT;
      w[8] = w[7];
    } else {
      w[6] = w[5] + transposeWeight;
      w[7] = w[6] + SYMTR_MAX_WEIGHT;
      w[8] = w[7] + transposeWeight;
    }
  }

  const draw = g.rng.randint0(w[8] as number);
  let ilow = 0;
  let ihigh = 8;
  for (;;) {
    if (ilow === ihigh - 1) break;
    const imid = Math.trunc((ilow + ihigh) / 2);
    if ((w[imid] as number) <= draw) ilow = imid;
    else ihigh = imid;
  }
  const rotate = ilow % 4;
  const reflect = ilow >= 4;
  const theight = rotate === 0 || rotate === 2 ? height : width;
  const twidth = rotate === 0 || rotate === 2 ? width : height;
  return { rotate, reflect, theight, twidth };
}

/** calc_default_transpose_weight. */
export function calcDefaultTransposeWeight(height: number, width: number): number {
  return (
    Math.trunc(SYMTR_MAX_WEIGHT / 64) *
    Math.max(0, Math.min(64, Math.trunc((128 * height) / width) - 64))
  );
}

/* ------------------------------------------------------------------ *
 * Block reservation and space finding (gen-room.c).
 * ------------------------------------------------------------------ */

function checkForUnreservedBlocks(
  g: Gen,
  by1: number,
  bx1: number,
  by2: number,
  bx2: number,
): boolean {
  const dun = g.dun;
  if (by1 < 0 || by2 >= dun.rowBlocks) return false;
  if (bx1 < 0 || bx2 >= dun.colBlocks) return false;
  for (let by = by1; by <= by2; by++) {
    const row = dun.roomMap[by];
    if (!row) return false;
    for (let bx = bx1; bx <= bx2; bx++) {
      if (row[bx]) return false;
    }
  }
  return true;
}

function reserveBlocks(g: Gen, by1: number, bx1: number, by2: number, bx2: number): void {
  const dun = g.dun;
  for (let by = by1; by <= by2; by++) {
    const row = dun.roomMap[by] as boolean[];
    for (let bx = bx1; bx <= bx2; bx++) row[bx] = true;
  }
}

/** find_space: reserve blocks for a room and return its centre, or null. */
function findSpace(g: Gen, height: number, width: number): Loc | null {
  const dun = g.dun;
  const blocksHigh = 1 + Math.trunc((height - 1) / dun.blockHgt);
  const blocksWide = 1 + Math.trunc((width - 1) / dun.blockWid);
  for (let i = 0; i < 25; i++) {
    const by1 = g.rng.randint0(dun.rowBlocks);
    const bx1 = g.rng.randint0(dun.colBlocks);
    const by2 = by1 + blocksHigh - 1;
    const bx2 = bx1 + blocksWide - 1;
    if (!checkForUnreservedBlocks(g, by1, bx1, by2, bx2)) continue;
    const centre = loc(
      Math.trunc(((bx1 + bx2 + 1) * dun.blockWid) / 2),
      Math.trunc(((by1 + by2 + 1) * dun.blockHgt) / 2),
    );
    if (dun.centN < dun.levelRoomMax) {
      dun.cent[dun.centN] = centre;
      dun.centN++;
    }
    reserveBlocks(g, by1, bx1, by2, bx2);
    return centre;
  }
  return null;
}

/** append_entrance: record a marked entrance for the most recent room. */
function appendEntrance(g: Gen, grid: Loc): void {
  const dun = g.dun;
  if (dun.centN <= 0 || dun.centN > dun.levelRoomMax) return;
  const ridx = dun.centN - 1;
  const list = dun.ent[ridx] ?? (dun.ent[ridx] = []);
  list.push(grid);
  dun.entN[ridx] = list.length;
  dun.ent2room[grid.y * g.c.width + grid.x] = ridx;
}

/* ------------------------------------------------------------------ *
 * build_room_template / build_vault.
 * ------------------------------------------------------------------ */

export function buildRoomTemplate(
  g: Gen,
  centreIn: Loc,
  ymax: number,
  xmax: number,
  doors: number,
  rows: string[],
  tval: number,
  fewEntrances: boolean,
): boolean {
  const c = g.c;
  const light = c.depth <= g.rng.randint1(25);
  const rnddoors = g.rng.randint1(doors);
  const rndwalls = g.rng.oneIn(2);

  let rotate: number;
  let reflect: boolean;
  let tymax: number;
  let txmax: number;
  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const s = getRandomSymmetryTransform(
      g,
      ymax,
      xmax,
      SYMTR_FLAG_NONE,
      calcDefaultTransposeWeight(ymax, xmax),
    );
    rotate = s.rotate;
    reflect = s.reflect;
    tymax = s.theight;
    txmax = s.twidth;
    const found = findSpace(g, tymax + 2, txmax + 2);
    if (!found) return false;
    centre = found;
  } else {
    const s = getRandomSymmetryTransform(g, ymax, xmax, SYMTR_FLAG_NONE, 0);
    rotate = s.rotate;
    reflect = s.reflect;
    tymax = s.theight;
    txmax = s.twidth;
  }

  centre = loc(centre.x - Math.trunc(txmax / 2), centre.y - Math.trunc(tymax / 2));

  /* First pass: features. */
  for (let dy = 0; dy < ymax; dy++) {
    for (let dx = 0; dx < xmax; dx++) {
      const t = glyphAt(rows, dy, dx);
      const grid = symmetryTransform(loc(dx, dy), centre.y, centre.x, ymax, xmax, rotate, reflect);
      if (t === " ") continue;
      c.setFeat(grid, FEAT.FLOOR);
      switch (t) {
        case "%":
          setMarkedGranite(c, grid, SQUARE.WALL_OUTER);
          if (fewEntrances) appendEntrance(g, grid);
          break;
        case "#":
          setMarkedGranite(c, grid, SQUARE.WALL_SOLID);
          break;
        case "+":
          placeClosedDoor(g, grid);
          break;
        case "^":
          if (g.rng.oneIn(4)) placeTrap(g, grid);
          break;
        case "x":
          if (rndwalls) setMarkedGranite(c, grid, SQUARE.WALL_SOLID);
          break;
        case "(":
          if (rndwalls) placeSecretDoor(c, grid);
          break;
        case ")":
          if (!rndwalls) placeSecretDoor(c, grid);
          else setMarkedGranite(c, grid, SQUARE.WALL_SOLID);
          break;
        case "8":
          if (g.rng.randint0(100) < 80 || g.dun.persist) {
            placeObject(g, grid, c.depth, false, false, 0);
          } else {
            placeRandomStairs(g, grid, g.dun.quest);
          }
          break;
        case "9":
          break;
        case "[":
          placeObject(g, grid, c.depth, false, false, tval);
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6": {
          const doorpos = t.charCodeAt(0) - "0".charCodeAt(0);
          if (doorpos === rnddoors) placeSecretDoor(c, grid);
          else setMarkedGranite(c, grid, SQUARE.WALL_SOLID);
          break;
        }
      }
      c.sqinfoOn(grid, SQUARE.ROOM);
      if (light) c.sqinfoOn(grid, SQUARE.GLOW);
    }
  }

  /* Second pass: inner-wall conversion, monsters/objects at 8 and 9. */
  for (let dy = 0; dy < ymax; dy++) {
    for (let dx = 0; dx < xmax; dx++) {
      const t = glyphAt(rows, dy, dx);
      const grid = symmetryTransform(loc(dx, dy), centre.y, centre.x, ymax, xmax, rotate, reflect);
      switch (t) {
        case "#":
          if (countNeighbors(c, grid, squareIsRoom, false) === 8) {
            c.sqinfoOff(grid, SQUARE.WALL_SOLID);
            c.sqinfoOn(grid, SQUARE.WALL_INNER);
          }
          break;
        case "8":
          vaultMonsters(g, grid, c.depth + 2, g.rng.randint0(2) + 3);
          break;
        case "9": {
          const off2 = loc(2, -2);
          const off3 = loc(3, 3);
          vaultMonsters(g, locDiff(grid, off3), c.depth + g.rng.randint0(2), g.rng.randint1(2));
          vaultMonsters(g, locSum(grid, off3), c.depth + g.rng.randint0(2), g.rng.randint1(2));
          if (g.rng.oneIn(2)) vaultObjects(g, locSum(grid, off2), c.depth, 1 + g.rng.randint0(2));
          if (g.rng.oneIn(2)) vaultObjects(g, locDiff(grid, off2), c.depth, 1 + g.rng.randint0(2));
          break;
        }
        default:
          break;
      }
    }
  }
  return true;
}

function buildRoomTemplateType(
  g: Gen,
  centre: Loc,
  typ: number,
  rating: number,
  templates: RoomTemplate[],
): boolean {
  const room = randomRoomTemplate(g, templates, typ, rating);
  if (!room) return false;
  return buildRoomTemplate(
    g,
    centre,
    room.hgt,
    room.wid,
    room.dor,
    room.rows,
    room.tval,
    room.fewEntrances,
  );
}

const TV_CHEST = tvalFindIdx("chest");
const TV_RING = tvalFindIdx("ring");
const TV_AMULET = tvalFindIdx("amulet");
const TV_POTION = tvalFindIdx("potion");
const TV_SCROLL = tvalFindIdx("scroll");
const TV_STAFF = tvalFindIdx("staff");
const TV_WAND = tvalFindIdx("wand");
const TV_ROD = tvalFindIdx("rod");
const TV_FOOD = tvalFindIdx("food");
const TV_BOOTS = tvalFindIdx("boots");
const TV_GLOVES = tvalFindIdx("gloves");
const TV_HELM = tvalFindIdx("helm");
const TV_CROWN = tvalFindIdx("crown");
const TV_SHIELD = tvalFindIdx("shield");
const TV_CLOAK = tvalFindIdx("cloak");
const TV_SOFT_ARMOR = tvalFindIdx("soft armour");
const TV_HARD_ARMOR = tvalFindIdx("hard armour");
const TV_DRAG_ARMOR = tvalFindIdx("dragon armour");
const TV_SWORD = tvalFindIdx("sword");
const TV_POLEARM = tvalFindIdx("polearm");
const TV_HAFTED = tvalFindIdx("hafted");
const TV_BOW = tvalFindIdx("bow");

function isAlpha(ch: string): boolean {
  return /^[A-Za-z]$/.test(ch);
}

/** build_vault: draw a vault from its grid text. */
export function buildVault(g: Gen, centreIn: Loc, v: Vault): boolean {
  const c = g.c;
  let rotate: number;
  let reflect: boolean;
  let thgt: number;
  let twid: number;
  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const s = getRandomSymmetryTransform(
      g,
      v.hgt,
      v.wid,
      SYMTR_FLAG_NONE,
      calcDefaultTransposeWeight(v.hgt, v.wid),
    );
    rotate = s.rotate;
    reflect = s.reflect;
    thgt = s.theight;
    twid = s.twidth;
    const found = findSpace(g, thgt + 2, twid + 2);
    if (!found) return false;
    centre = found;
  } else {
    const s = getRandomSymmetryTransform(g, v.hgt, v.wid, SYMTR_FLAG_NONE, 0);
    rotate = s.rotate;
    reflect = s.reflect;
    thgt = s.theight;
    twid = s.twidth;
  }

  centre = loc(centre.x - Math.trunc(twid / 2), centre.y - Math.trunc(thgt / 2));

  const y1 = centre.y;
  const x1 = centre.x;
  const y2 = y1 + thgt - 1;
  const x2 = x1 + twid - 1;

  /* No random monsters in vaults. */
  generateMark(c, y1, x1, y2, x2, SQUARE.MON_RESTRICT);

  /* Racial monster symbols, collected in first-appearance order (max 30). */
  const racialSymbol: string[] = [];

  /* First pass: features. */
  for (let y = 0; y < v.hgt; y++) {
    for (let x = 0; x < v.wid; x++) {
      const t = glyphAt(v.rows, y, x);
      const grid = symmetryTransform(loc(x, y), centre.y, centre.x, v.hgt, v.wid, rotate, reflect);
      if (t === " ") continue;
      c.setFeat(grid, FEAT.FLOOR);
      let icky = true;
      switch (t) {
        case "%":
          setMarkedGranite(c, grid, SQUARE.WALL_OUTER);
          if (v.fewEntrances) appendEntrance(g, grid);
          icky = false;
          break;
        case "#":
          setMarkedGranite(c, grid, SQUARE.WALL_SOLID);
          break;
        case "@":
          c.setFeat(grid, FEAT.PERM);
          break;
        case "*":
          c.setFeat(grid, g.rng.oneIn(2) ? FEAT.MAGMA_K : FEAT.QUARTZ_K);
          break;
        case ":":
          c.setFeat(grid, g.rng.oneIn(2) ? FEAT.PASS_RUBBLE : FEAT.RUBBLE);
          break;
        case "+":
          placeSecretDoor(c, grid);
          break;
        case "^":
          if (g.rng.oneIn(4)) placeTrap(g, grid);
          break;
        case "&":
          if (g.rng.randint0(100) < 75) placeObject(g, grid, c.depth, false, false, 0);
          else if (g.rng.oneIn(4)) placeTrap(g, grid);
          break;
        case "<":
          if (!g.dun.persist) c.setFeat(grid, FEAT.LESS);
          break;
        case ">":
          if (!g.dun.persist) {
            if (g.dun.quest || c.depth >= g.constants.maxDepth - 1) c.setFeat(grid, FEAT.LESS);
            else c.setFeat(grid, FEAT.MORE);
          }
          break;
        case "`":
          c.setFeat(grid, FEAT.LAVA);
          break;
        case "/":
        case ";":
          break;
      }
      c.sqinfoOn(grid, SQUARE.ROOM);
      if (icky) c.sqinfoOn(grid, SQUARE.VAULT);
    }
  }

  /* Second pass: monsters, objects, inner-wall conversion. */
  for (let y = 0; y < v.hgt; y++) {
    for (let x = 0; x < v.wid; x++) {
      const t = glyphAt(v.rows, y, x);
      const grid = symmetryTransform(loc(x, y), centre.y, centre.x, v.hgt, v.wid, rotate, reflect);
      if (t === " ") continue;
      if (isAlpha(t) && t !== "x" && t !== "X") {
        /* Racial monster glyph: store the symbol, place later via
         * get_vault_monsters (mon_select restriction, item #75). */
        if (!racialSymbol.includes(t) && racialSymbol.length < 30) {
          racialSymbol.push(t);
        }
        continue;
      }
      switch (t) {
        case "1":
          if (g.rng.oneIn(2)) {
            pickAndPlaceMonster(g, grid, c.depth, true);
          } else if (g.rng.oneIn(2)) {
            placeObject(g, grid, c.depth, g.rng.oneIn(8), false, 0);
          } else if (g.rng.oneIn(4)) {
            placeTrap(g, grid);
          }
          break;
        case "2":
          pickAndPlaceMonster(g, grid, c.depth + 5, true);
          break;
        case "3":
          placeObject(g, grid, c.depth + 3, false, false, 0);
          break;
        case "4":
          if (g.rng.oneIn(2)) pickAndPlaceMonster(g, grid, c.depth + 3, true);
          if (g.rng.oneIn(2)) placeObject(g, grid, c.depth + 7, false, false, 0);
          break;
        case "5":
          placeObject(g, grid, c.depth + 7, false, false, 0);
          break;
        case "6":
          pickAndPlaceMonster(g, grid, c.depth + 11, true);
          break;
        case "7":
          placeObject(g, grid, c.depth + 15, false, false, 0);
          break;
        case "0":
          pickAndPlaceMonster(g, grid, c.depth + 20, true);
          break;
        case "9":
          pickAndPlaceMonster(g, grid, c.depth + 9, true);
          placeObject(g, grid, c.depth + 7, true, false, 0);
          break;
        case "8":
          pickAndPlaceMonster(g, grid, c.depth + 40, true);
          placeObject(g, grid, c.depth + 20, true, true, 0);
          break;
        case "~":
          placeObject(g, grid, c.depth + 5, false, false, TV_CHEST);
          break;
        case "$":
          placeGold(g, grid, c.depth);
          break;
        case "]": {
          const temp = g.rng.oneIn(3) ? g.rng.randint1(9) : g.rng.randint1(8);
          const tval = [
            0,
            TV_BOOTS,
            TV_GLOVES,
            TV_HELM,
            TV_CROWN,
            TV_SHIELD,
            TV_CLOAK,
            TV_SOFT_ARMOR,
            TV_HARD_ARMOR,
            TV_DRAG_ARMOR,
          ][temp] as number;
          placeObject(g, grid, c.depth + 3, true, false, tval);
          break;
        }
        case "|": {
          const temp = g.rng.randint1(4);
          const tval = [0, TV_SWORD, TV_POLEARM, TV_HAFTED, TV_BOW][temp] as number;
          placeObject(g, grid, c.depth + 3, true, false, tval);
          break;
        }
        case "=":
          placeObject(g, grid, c.depth + 3, g.rng.oneIn(4), false, TV_RING);
          break;
        case '"':
          placeObject(g, grid, c.depth + 3, g.rng.oneIn(4), false, TV_AMULET);
          break;
        case "!":
          placeObject(g, grid, c.depth + 3, g.rng.oneIn(4), false, TV_POTION);
          break;
        case "?":
          placeObject(g, grid, c.depth + 3, g.rng.oneIn(4), false, TV_SCROLL);
          break;
        case "_":
          placeObject(g, grid, c.depth + 3, g.rng.oneIn(4), false, TV_STAFF);
          break;
        case "-":
          placeObject(g, grid, c.depth + 3, g.rng.oneIn(4), false, g.rng.oneIn(2) ? TV_WAND : TV_ROD);
          break;
        case ",":
          placeObject(g, grid, c.depth + 3, g.rng.oneIn(4), false, TV_FOOD);
          break;
        case "#":
          if (countNeighbors(c, grid, squareIsRoom, false) === 8) {
            c.sqinfoOff(grid, SQUARE.WALL_SOLID);
            c.sqinfoOn(grid, SQUARE.WALL_INNER);
          }
          break;
        case "@":
          if (countNeighbors(c, grid, squareIsRoom, false) === 8) {
            c.sqinfoOn(grid, SQUARE.WALL_INNER);
          }
          break;
      }
    }
  }

  /* Place specified monsters (get_vault_monsters). The upstream loop reads
   * the raw vault text linearly across the rectangle, so map the linear
   * index back to the vault's original width. */
  getVaultMonsters(
    g,
    racialSymbol,
    v.typ,
    (i) => glyphAt(v.rows, Math.trunc(i / v.wid), i % v.wid),
    y1,
    y2,
    x1,
    x2,
  );

  return true;
}

function buildVaultType(g: Gen, centre: Loc, typ: string, vaults: Vault[]): boolean {
  const v = randomVault(g.rng, vaults, g.c.depth, typ);
  if (!v) return false;
  if (!buildVault(g, centre, v)) return false;
  /* Boost the rating (gen-room.c L1728). */
  g.c.addToMonsterRating(v.rat);
  return true;
}

/**
 * vault_chunk (gen-cave.c L3212): build a fresh chunk that consists only of a
 * greater vault, filled around with granite. Picks a greater-vault type at the
 * given depth (one_in_(2) chooses the "(new)" variant), sizes a sub-chunk to
 * the vault, and builds the vault into it via build_vault. NEW exported helper.
 *
 * `makeSubGen(height, width, depth)` mints a Gen bound to a fresh sub-chunk of
 * that size (supplied by the caller so Gen/Chunk construction stays in cave.ts
 * and there is no circular import). The vault's name/type draws happen on the
 * shared `rng` before the sub-chunk exists, so RNG order is preserved.
 *
 * Returns the built sub-chunk's Gen, or null on failure (no greater vault at
 * depth, or build_vault failed). Faithful to the C control flow (return failure
 * on either path); the C-side uncreate_artifacts/cave_free cleanup is not
 * needed because the caller simply discards this sub-chunk on failure.
 */
export function vaultChunk(
  rng: Rng,
  vaults: Vault[],
  depth: number,
  makeSubGen: (height: number, width: number, depth: number) => Gen,
): Gen | null {
  const vname = rng.oneIn(2) ? "Greater vault (new)" : "Greater vault";
  const v = randomVault(rng, vaults, depth, vname);
  if (!v) return null;

  const g = makeSubGen(v.hgt, v.wid, depth);
  const c = g.c;

  /* Fill with granite; the vault will override for the grids it sets. */
  fillRectangle(c, 0, 0, v.hgt - 1, v.wid - 1, FEAT.GRANITE, SQUARE.NONE);

  /* Build the vault in it. */
  g.dun.centN = 0;
  g.dun.resetEntranceData(c);
  const built = buildVault(g, loc(Math.trunc(v.wid / 2), Math.trunc(v.hgt / 2)), v);
  if (!built) return null;

  return g;
}

/* ------------------------------------------------------------------ *
 * Geometric builders.
 * ------------------------------------------------------------------ */

/** build_staircase: a 1x1 staircase room for persistent levels. */
function buildStaircase(g: Gen, _centre: Loc, _rating: number): boolean {
  const c = g.c;
  const join = g.dun.currJoin;
  if (!join) return false;
  const centre = join.grid;
  if (centre.y < 1 || centre.y > c.height - 2 || centre.x < 1 || centre.x > c.width - 2) {
    return false;
  }
  const tl = loc(centre.x - (centre.x > 1 ? 2 : 1), centre.y - (centre.y > 1 ? 2 : 1));
  const br = loc(
    centre.x + (centre.x < c.width - 2 ? 2 : 1),
    centre.y + (centre.y < c.height - 2 ? 2 : 1),
  );
  const by1 = Math.trunc(tl.y / g.dun.blockHgt);
  const bx1 = Math.trunc(tl.x / g.dun.blockWid);
  const by2 = Math.trunc(br.y / g.dun.blockHgt);
  const bx2 = Math.trunc(br.x / g.dun.blockWid);
  if (g.dun.blockHgt > 1 || g.dun.blockWid > 1) {
    for (let y = tl.y; y <= br.y; y++) {
      for (let x = tl.x; x <= br.x; x++) {
        if (squareIsRoom(c, loc(x, y))) return false;
      }
    }
  } else if (!checkForUnreservedBlocks(g, by1, bx1, by2, bx2)) {
    return false;
  }
  reserveBlocks(g, by1, bx1, by2, bx2);
  if (g.dun.centN < g.dun.levelRoomMax) {
    g.dun.cent[g.dun.centN] = centre;
    g.dun.centN++;
  }
  generateRoom(c, centre.y - 1, centre.x - 1, centre.y + 1, centre.x + 1, false);
  drawRectangle(c, centre.y - 1, centre.x - 1, centre.y + 1, centre.x + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  c.setFeat(centre, join.feat);
  return true;
}

function buildCircular(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  const radius = 2 + g.rng.randint1(2) + g.rng.randint1(3);
  const light = c.depth <= g.rng.randint1(25);
  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, 2 * radius + 10, 2 * radius + 10);
    if (!found) return false;
    centre = found;
  }
  fillCircle(c, centre.y, centre.x, radius + 1, 0, FEAT.FLOOR, SQUARE.NONE, light);
  setBorderingWalls(c, centre.y - radius - 2, centre.x - radius - 2, centre.y + radius + 2, centre.x + radius + 2);
  if (radius - 4 > 0 && g.rng.randint0(4) < radius - 4) {
    const offset = randDir(g.rng);
    drawRectangle(c, centre.y - 2, centre.x - 2, centre.y + 2, centre.x + 2, FEAT.GRANITE, SQUARE.WALL_INNER, false);
    placeClosedDoor(g, loc(centre.x + offset.x * 2, centre.y + offset.y * 2));
    vaultObjects(g, centre, c.depth, g.rng.randint0(2));
    vaultMonsters(g, centre, c.depth + 1, g.rng.randint0(3));
  }
  return true;
}

function buildSimple(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  const height = 1 + g.rng.randint1(4) + g.rng.randint1(3);
  const width = 1 + g.rng.randint1(11) + g.rng.randint1(11);
  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, height + 2, width + 2);
    if (!found) return false;
    centre = found;
  }
  const y1 = centre.y - Math.trunc(height / 2);
  const x1 = centre.x - Math.trunc(width / 2);
  const y2 = y1 + height - 1;
  const x2 = x1 + width - 1;
  const light = c.depth <= g.rng.randint1(25);

  generateRoom(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, light);
  drawRectangle(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  fillRectangle(c, y1, x1, y2, x2, FEAT.FLOOR, SQUARE.NONE);

  if (g.rng.oneIn(20)) {
    const offx = (x2 - x1) % 2 === 0 ? 0 : g.rng.randint0(2);
    const offy = (y2 - y1) % 2 === 0 ? 0 : g.rng.randint0(2);
    for (let y = y1 + offy; y <= y2; y += 2) {
      for (let x = x1 + offx; x <= x2; x += 2) setMarkedGranite(c, loc(x, y), SQUARE.WALL_INNER);
    }
    if (!offy) {
      if (!offx) {
        c.sqinfoOff(loc(x1 - 1, y1 - 1), SQUARE.ROOM);
        c.sqinfoOff(loc(x1 - 1, y1 - 1), SQUARE.WALL_OUTER);
      }
      if ((x2 - x1 - offx) % 2 === 0) {
        c.sqinfoOff(loc(x2 + 1, y1 - 1), SQUARE.ROOM);
        c.sqinfoOff(loc(x2 + 1, y1 - 1), SQUARE.WALL_OUTER);
      }
    }
    if ((y2 - y1 - offy) % 2 === 0) {
      if (!offx) {
        c.sqinfoOff(loc(x1 - 1, y2 + 1), SQUARE.ROOM);
        c.sqinfoOff(loc(x1 - 1, y2 + 1), SQUARE.WALL_OUTER);
      }
      if ((x2 - x1 - offx) % 2 === 0) {
        c.sqinfoOff(loc(x2 + 1, y2 + 1), SQUARE.ROOM);
        c.sqinfoOff(loc(x2 + 1, y2 + 1), SQUARE.WALL_OUTER);
      }
    }
  } else if (g.rng.oneIn(50)) {
    const offx = (x2 - x1) % 2 === 0 ? 0 : g.rng.randint0(2);
    const offy = (y2 - y1) % 2 === 0 ? 0 : g.rng.randint0(2);
    for (let y = y1 + 2 + offy; y <= y2 - 2; y += 2) {
      setMarkedGranite(c, loc(x1, y), SQUARE.WALL_INNER);
      setMarkedGranite(c, loc(x2, y), SQUARE.WALL_INNER);
    }
    for (let x = x1 + 2 + offx; x <= x2 - 2; x += 2) {
      setMarkedGranite(c, loc(x, y1), SQUARE.WALL_INNER);
      setMarkedGranite(c, loc(x, y2), SQUARE.WALL_INNER);
    }
  }
  return true;
}

function buildOverlap(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  const light = c.depth <= g.rng.randint1(25);
  let y1a = g.rng.randint1(4);
  let x1a = g.rng.randint1(11);
  let y2a = g.rng.randint1(3);
  let x2a = g.rng.randint1(10);
  let y1b = g.rng.randint1(3);
  let x1b = g.rng.randint1(10);
  let y2b = g.rng.randint1(4);
  let x2b = g.rng.randint1(11);
  const height = 2 * Math.max(Math.max(y1a, y2a), Math.max(y1b, y2b)) + 1;
  const width = 2 * Math.max(Math.max(x1a, x2a), Math.max(x1b, x2b)) + 1;

  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, height + 2, width + 2);
    if (!found) return false;
    centre = found;
  }
  y1a = centre.y - y1a;
  x1a = centre.x - x1a;
  y2a = centre.y + y2a;
  x2a = centre.x + x2a;
  y1b = centre.y - y1b;
  x1b = centre.x - x1b;
  y2b = centre.y + y2b;
  x2b = centre.x + x2b;

  generateRoom(c, y1a - 1, x1a - 1, y2a + 1, x2a + 1, light);
  generateRoom(c, y1b - 1, x1b - 1, y2b + 1, x2b + 1, light);
  drawRectangle(c, y1a - 1, x1a - 1, y2a + 1, x2a + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  drawRectangle(c, y1b - 1, x1b - 1, y2b + 1, x2b + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  fillRectangle(c, y1a, x1a, y2a, x2a, FEAT.FLOOR, SQUARE.NONE);
  fillRectangle(c, y1b, x1b, y2b, x2b, FEAT.FLOOR, SQUARE.NONE);
  return true;
}

function buildCrossed(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  const light = c.depth <= g.rng.randint1(25);
  const wy = 1;
  const wx = 1;
  const dy = g.rng.randRange(3, 4);
  const dx = g.rng.randRange(3, 11);
  const height = Math.max(dy + dy + 1, wy + wy + 1);
  const width = Math.max(wx + wx + 1, dx + dx + 1);

  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, height + 2, width + 2);
    if (!found) return false;
    centre = found;
  }
  const y1a = centre.y - dy;
  const x1a = centre.x - wx;
  const y2a = centre.y + dy;
  const x2a = centre.x + wx;
  const y1b = centre.y - wy;
  const x1b = centre.x - dx;
  const y2b = centre.y + wy;
  const x2b = centre.x + dx;

  generateRoom(c, y1a - 1, x1a - 1, y2a + 1, x2a + 1, light);
  generateRoom(c, y1b - 1, x1b - 1, y2b + 1, x2b + 1, light);
  drawRectangle(c, y1a - 1, x1a - 1, y2a + 1, x2a + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  drawRectangle(c, y1b - 1, x1b - 1, y2b + 1, x2b + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  fillRectangle(c, y1a, x1a, y2a, x2a, FEAT.FLOOR, SQUARE.NONE);
  fillRectangle(c, y1b, x1b, y2b, x2b, FEAT.FLOOR, SQUARE.NONE);

  switch (g.rng.randint1(4)) {
    case 1:
      break;
    case 2:
      fillRectangle(c, y1b, x1a, y2b, x2a, FEAT.GRANITE, SQUARE.WALL_INNER);
      break;
    case 3:
      drawRectangle(c, y1b, x1a, y2b, x2a, FEAT.GRANITE, SQUARE.WALL_INNER, false);
      generateHole(g.rng, c, y1b, x1a, y2b, x2a, FEAT.SECRET);
      placeObject(g, centre, c.depth, false, false, 0);
      vaultMonsters(g, centre, c.depth + 2, g.rng.randint0(2) + 3);
      vaultTraps(g, centre, 4, 4, g.rng.randint0(3) + 2);
      break;
    case 4:
      if (g.rng.oneIn(3)) {
        for (let y = y1b; y <= y2b; y++) {
          if (y === centre.y) continue;
          setMarkedGranite(c, loc(x1a - 1, y), SQUARE.WALL_INNER);
          setMarkedGranite(c, loc(x2a + 1, y), SQUARE.WALL_INNER);
        }
        for (let x = x1a; x <= x2a; x++) {
          if (x === centre.x) continue;
          setMarkedGranite(c, loc(x, y1b - 1), SQUARE.WALL_INNER);
          setMarkedGranite(c, loc(x, y2b + 1), SQUARE.WALL_INNER);
        }
        if (g.rng.oneIn(3)) generateOpen(c, y1b - 1, x1a - 1, y2b + 1, x2a + 1, FEAT.CLOSED);
      } else if (g.rng.oneIn(3)) {
        generatePlus(c, y1b, x1a, y2b, x2a, FEAT.GRANITE, SQUARE.WALL_INNER);
      } else if (g.rng.oneIn(3)) {
        setMarkedGranite(c, centre, SQUARE.WALL_INNER);
      }
      break;
  }
  return true;
}

function buildLarge(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  const height = 9;
  const width = 23;
  const light = c.depth <= g.rng.randint1(25);
  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, height + 2, width + 2);
    if (!found) return false;
    centre = found;
  }
  let y1 = centre.y - Math.trunc(height / 2);
  let y2 = centre.y + Math.trunc(height / 2);
  let x1 = centre.x - Math.trunc(width / 2);
  let x2 = centre.x + Math.trunc(width / 2);

  generateRoom(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, light);
  drawRectangle(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  fillRectangle(c, y1, x1, y2, x2, FEAT.FLOOR, SQUARE.NONE);

  y1 = y1 + 2;
  y2 = y2 - 2;
  x1 = x1 + 2;
  x2 = x2 - 2;
  drawRectangle(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_INNER, false);

  switch (g.rng.randint1(5)) {
    case 1:
      generateHole(g.rng, c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.CLOSED);
      vaultMonsters(g, centre, c.depth + 2, 1);
      break;
    case 2: {
      generateHole(g.rng, c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.CLOSED);
      drawRectangle(c, centre.y - 1, centre.x - 1, centre.y + 1, centre.x + 1, FEAT.GRANITE, SQUARE.WALL_INNER, false);
      generateHole(g.rng, c, centre.y - 1, centre.x - 1, centre.y + 1, centre.x + 1, FEAT.CLOSED);
      for (let y = centre.y - 1; y <= centre.y + 1; y++) {
        for (let x = centre.x - 1; x <= centre.x + 1; x++) {
          if (c.isClosedDoor(loc(x, y))) g.rng.randint1(7);
        }
      }
      vaultMonsters(g, centre, c.depth + 2, g.rng.randint1(3) + 2);
      if (g.rng.randint0(100) < 80 || g.dun.persist) {
        placeObject(g, centre, c.depth, false, false, 0);
      } else {
        placeRandomStairs(g, centre, g.dun.quest);
      }
      vaultTraps(g, centre, 4, 10, 2 + g.rng.randint1(3));
      break;
    }
    case 3: {
      generateHole(g.rng, c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.CLOSED);
      fillRectangle(c, centre.y - 1, centre.x - 1, centre.y + 1, centre.x + 1, FEAT.GRANITE, SQUARE.WALL_INNER);
      if (g.rng.oneIn(2)) {
        if (g.rng.oneIn(2)) {
          fillRectangle(c, centre.y - 1, centre.x - 7, centre.y + 1, centre.x - 5, FEAT.GRANITE, SQUARE.WALL_INNER);
          fillRectangle(c, centre.y - 1, centre.x + 5, centre.y + 1, centre.x + 7, FEAT.GRANITE, SQUARE.WALL_INNER);
        } else {
          fillRectangle(c, centre.y - 1, centre.x - 6, centre.y + 1, centre.x - 4, FEAT.GRANITE, SQUARE.WALL_INNER);
          fillRectangle(c, centre.y - 1, centre.x + 4, centre.y + 1, centre.x + 6, FEAT.GRANITE, SQUARE.WALL_INNER);
        }
      }
      if (g.rng.oneIn(3)) {
        drawRectangle(c, centre.y - 1, centre.x - 5, centre.y + 1, centre.x + 5, FEAT.GRANITE, SQUARE.WALL_INNER, false);
        placeSecretDoor(c, loc(centre.x - 3, centre.y - 3 + g.rng.randint1(2) * 2));
        placeSecretDoor(c, loc(centre.x + 3, centre.y - 3 + g.rng.randint1(2) * 2));
        vaultMonsters(g, loc(centre.x - 2, centre.y), c.depth + 2, g.rng.randint1(2));
        vaultMonsters(g, loc(centre.x + 2, centre.y), c.depth + 2, g.rng.randint1(2));
        if (g.rng.oneIn(3)) placeObject(g, loc(centre.x - 2, centre.y), c.depth, false, false, 0);
        if (g.rng.oneIn(3)) placeObject(g, loc(centre.x + 2, centre.y), c.depth, false, false, 0);
      }
      break;
    }
    case 4: {
      generateHole(g.rng, c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.CLOSED);
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          if ((x + y) & 0x01) setMarkedGranite(c, loc(x, y), SQUARE.WALL_INNER);
        }
      }
      vaultMonsters(g, loc(centre.x - 5, centre.y), c.depth + 2, g.rng.randint1(3));
      vaultMonsters(g, loc(centre.x + 5, centre.y), c.depth + 2, g.rng.randint1(3));
      vaultTraps(g, loc(centre.x - 3, centre.y), 2, 8, g.rng.randint1(3));
      vaultTraps(g, loc(centre.x + 3, centre.y), 2, 8, g.rng.randint1(3));
      vaultObjects(g, centre, c.depth, 3);
      break;
    }
    case 5: {
      generatePlus(c, y1, x1, y2, x2, FEAT.GRANITE, SQUARE.WALL_INNER);
      if (g.rng.randint0(100) < 50) {
        const i = g.rng.randint1(10);
        placeClosedDoor(g, loc(centre.x - i, y1 - 1));
        placeClosedDoor(g, loc(centre.x + i, y1 - 1));
        placeClosedDoor(g, loc(centre.x - i, y2 + 1));
        placeClosedDoor(g, loc(centre.x + i, y2 + 1));
      } else {
        const i = g.rng.randint1(3);
        placeClosedDoor(g, loc(x1 - 1, centre.y + i));
        placeClosedDoor(g, loc(x1 - 1, centre.y - i));
        placeClosedDoor(g, loc(x2 + 1, centre.y + i));
        placeClosedDoor(g, loc(x2 + 1, centre.y - i));
      }
      vaultObjects(g, centre, c.depth, 2 + g.rng.randint1(2));
      vaultMonsters(g, loc(centre.x - 4, centre.y + 1), c.depth + 2, g.rng.randint1(4));
      vaultMonsters(g, loc(centre.x + 4, centre.y + 1), c.depth + 2, g.rng.randint1(4));
      vaultMonsters(g, loc(centre.x - 4, centre.y - 1), c.depth + 2, g.rng.randint1(4));
      vaultMonsters(g, loc(centre.x + 4, centre.y - 1), c.depth + 2, g.rng.randint1(4));
      break;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Nest / pit (faithful themed monster generation, gen-room.c).
 * ------------------------------------------------------------------ */

/**
 * build_nest (gen-room.c L2641): a rectangular moat around a room filled with
 * a DISORDERED scatter of monsters drawn from 64 pit-hooked picks. Nests never
 * contain uniques (mon_pit_hook rejects them).
 */
function buildNest(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  if (!g.monDeps || !g.monDeps.pits) return false;
  const table = g.monDeps.table;
  const pits = g.monDeps.pits;

  const sizeVary = g.rng.randint0(4);
  const height = 9;
  const width = 11 + 2 * sizeVary;

  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, height + 2, width + 2);
    if (!found) return false;
    centre = found;
  }

  let y1 = centre.y - Math.trunc(height / 2);
  let y2 = centre.y + Math.trunc(height / 2);
  let x1 = centre.x - Math.trunc(width / 2);
  let x2 = centre.x + Math.trunc(width / 2);

  generateRoom(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, false);
  drawRectangle(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  fillRectangle(c, y1, x1, y2, x2, FEAT.FLOOR, SQUARE.NONE);

  /* Advance to the center room. */
  y1 = y1 + 2;
  y2 = y2 - 2;
  x1 = x1 + 2;
  x2 = x2 - 2;
  drawRectangle(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_INNER, false);
  generateHole(g.rng, c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.CLOSED);

  /* Decide on the pit type (nests are room type 2). */
  const pit = setPitType(g.rng, pits, c.depth, 2);
  const allocObj = pit.objRarity;

  /* Prepare allocation table; pick 64 (hard) monster types. */
  table.prep(monPitHook(pit));
  const what: (MonsterRace | null)[] = [];
  let empty = false;
  for (let i = 0; i < 64; i++) {
    what[i] = table.getMonNum(g.rng, c.depth + 10, c.depth);
    if (!what[i]) empty = true;
  }
  table.prep(null);
  if (empty) return false;

  /* Increase the level rating (gen-room.c L2718). */
  c.addToMonsterRating(sizeVary + Math.trunc(pit.ave / 20));

  /* Place some monsters (disordered scatter) and occasional objects. */
  const info: MonsterGroupInfo = { index: 0, role: MON_GROUP.LEADER };
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const race = what[g.rng.randint0(64)] as MonsterRace;
      placeNewMonster(g, loc(x, y), race, false, false, info);

      /* Occasionally place an item, making it good 1/3 of the time. */
      if (g.rng.randint0(100) < allocObj) {
        placeObject(g, loc(x, y), c.depth + 10, g.rng.oneIn(3), false, 0);
      }
    }
  }
  return true;
}

/**
 * build_pit (gen-room.c L2773): an ORDERED pit. 16 pit-hooked monsters are
 * drawn, bubble-sorted by level, and the even entries used to fill the fixed
 * concentric/mirrored pattern (what[7] centre, radiating out to what[0]).
 * Pits never contain uniques.
 *
 *   #############
 *   #11000000011#
 *   #01234543210#
 *   #01236763210#
 *   #01234543210#
 *   #11000000011#
 *   #############
 */
function buildPit(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  if (!g.monDeps || !g.monDeps.pits) return false;
  const table = g.monDeps.table;
  const pits = g.monDeps.pits;

  const height = 9;
  const width = 15;

  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, height + 2, width + 2);
    if (!found) return false;
    centre = found;
  }

  let y1 = centre.y - Math.trunc(height / 2);
  let y2 = centre.y + Math.trunc(height / 2);
  let x1 = centre.x - Math.trunc(width / 2);
  let x2 = centre.x + Math.trunc(width / 2);

  generateRoom(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, false);
  drawRectangle(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
  fillRectangle(c, y1, x1, y2, x2, FEAT.FLOOR, SQUARE.NONE);

  /* Advance to the center room. */
  y1 = y1 + 2;
  y2 = y2 - 2;
  x1 = x1 + 2;
  x2 = x2 - 2;
  drawRectangle(c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_INNER, false);
  generateHole(g.rng, c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.CLOSED);

  /* Decide on the pit type (pits are room type 1). */
  const pit = setPitType(g.rng, pits, c.depth, 1);
  const allocObj = pit.objRarity;

  /* Prepare allocation table; pick 16 (hard) monster types. */
  table.prep(monPitHook(pit));
  const what: (MonsterRace | null)[] = [];
  let empty = false;
  for (let i = 0; i < 16; i++) {
    what[i] = table.getMonNum(g.rng, c.depth + 10, c.depth);
    if (!what[i]) empty = true;
  }
  table.prep(null);
  if (empty) return false;

  /* Sort the 16 entries by level (bubble sort, stable on ties). */
  const sorted = what as MonsterRace[];
  for (let i = 0; i < 16 - 1; i++) {
    for (let j = 0; j < 16 - 1; j++) {
      const a = sorted[j] as MonsterRace;
      const b = sorted[j + 1] as MonsterRace;
      if (a.level > b.level) {
        sorted[j] = b;
        sorted[j + 1] = a;
      }
    }
  }

  /* Select every other entry (the even-indexed picks). */
  const pick: MonsterRace[] = [];
  for (let i = 0; i < 8; i++) pick[i] = sorted[i * 2] as MonsterRace;

  /* Increase the level rating (gen-room.c L2867). */
  c.addToMonsterRating(3 + Math.trunc(pit.ave / 20));

  /* Fixed concentric placement. Center monster is the group leader. */
  const groupIndex = g.nextGroupIndex();
  const cx = centre.x;
  const cy = centre.y;
  const leader: MonsterGroupInfo = { index: groupIndex, role: MON_GROUP.LEADER };
  placeNewMonster(g, centre, pick[7] as MonsterRace, false, false, leader);

  /* Remaining monsters are servants. */
  const info: MonsterGroupInfo = { index: groupIndex, role: MON_GROUP.SERVANT };

  /* Top and bottom rows (middle). */
  for (let x = cx - 3; x <= cx + 3; x++) {
    placeNewMonster(g, loc(x, cy - 2), pick[0] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(x, cy + 2), pick[0] as MonsterRace, false, false, info);
  }

  /* Corners. */
  for (let x = cx - 5; x <= cx - 4; x++) {
    placeNewMonster(g, loc(x, cy - 2), pick[1] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(x, cy + 2), pick[1] as MonsterRace, false, false, info);
  }
  for (let x = cx + 4; x <= cx + 5; x++) {
    placeNewMonster(g, loc(x, cy - 2), pick[1] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(x, cy + 2), pick[1] as MonsterRace, false, false, info);
  }

  /* Middle columns. */
  for (let y = cy - 1; y <= cy + 1; y++) {
    placeNewMonster(g, loc(cx - 5, y), pick[0] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(cx + 5, y), pick[0] as MonsterRace, false, false, info);

    placeNewMonster(g, loc(cx - 4, y), pick[1] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(cx + 4, y), pick[1] as MonsterRace, false, false, info);

    placeNewMonster(g, loc(cx - 3, y), pick[2] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(cx + 3, y), pick[2] as MonsterRace, false, false, info);

    placeNewMonster(g, loc(cx - 2, y), pick[3] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(cx + 2, y), pick[3] as MonsterRace, false, false, info);
  }

  /* Corners around the middle monster. */
  placeNewMonster(g, loc(cx - 1, cy - 1), pick[4] as MonsterRace, false, false, info);
  placeNewMonster(g, loc(cx + 1, cy - 1), pick[4] as MonsterRace, false, false, info);
  placeNewMonster(g, loc(cx - 1, cy + 1), pick[4] as MonsterRace, false, false, info);
  placeNewMonster(g, loc(cx + 1, cy + 1), pick[4] as MonsterRace, false, false, info);

  /* Above/below the center monster. */
  for (let x = cx - 1; x <= cx + 1; x++) {
    placeNewMonster(g, loc(x, cy + 1), pick[5] as MonsterRace, false, false, info);
    placeNewMonster(g, loc(x, cy - 1), pick[5] as MonsterRace, false, false, info);
  }

  /* Next to the center monster. */
  placeNewMonster(g, loc(cx + 1, cy), pick[6] as MonsterRace, false, false, info);
  placeNewMonster(g, loc(cx - 1, cy), pick[6] as MonsterRace, false, false, info);

  /* Place some objects. */
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 9; x <= cx + 9; x++) {
      if (g.rng.randint0(100) < allocObj) {
        placeObject(g, loc(x, y), c.depth + 10, g.rng.oneIn(3), false, 0);
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Moria / room of chambers / huge (starburst + cellular builders).
 * ------------------------------------------------------------------ */

/**
 * build_moria (gen-room.c L3138): a moria-style starburst cave room, sometimes
 * enlarged, sometimes long and narrow, occasionally sprinkled with rubble.
 *
 * RNG order (verified against gen-room.c L3138-3209):
 *   randint1(35) [light], randint0(5) [height], randint0(5) [width];
 *   the two-try space loop: per try one_in_(15) [large], else one_in_(4)
 *   and (when !one_in_(4)) one_in_(15) + randint0(2)/randint0(3) [stretch];
 *   generate_starburst_room; one_in_(10) [rubble] then 4x randint0(dim/4).
 */
function buildMoria(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  const light = c.depth <= g.rng.randint1(35);

  /* Pick a room size. */
  let height = 8 + g.rng.randint0(5);
  let width = 10 + g.rng.randint0(5);

  let centre = centreIn;
  let placed = false;

  /* Try twice to find space for a room. */
  for (let i = 0; i < 2; i++) {
    /* Really large room - only on first try. */
    if (i === 0 && g.rng.oneIn(15)) {
      height *= 1 + g.rng.randint1(2);
      width *= 2 + g.rng.randint1(3);
    } else if (!g.rng.oneIn(4)) {
      /* Long, narrow room. Sometimes tall and thin. */
      if (g.rng.oneIn(15)) height *= 2 + g.rng.randint0(2);
      else width *= 2 + g.rng.randint0(3);
    }

    /* Find and reserve some space in the dungeon. Get center of room. */
    if (centre.y >= c.height || centre.x >= c.width) {
      const found = findSpace(g, height, width);
      if (!found) {
        if (i === 0) continue; /* Failed first attempt */
        if (i === 1) return false; /* Failed second attempt */
      } else {
        centre = found;
        placed = true;
        break; /* Success */
      }
    } else {
      placed = true;
      break; /* Not finding space */
    }
  }
  if (!placed) return false;

  /* Locate the room. */
  const y1 = centre.y - Math.trunc(height / 2);
  const x1 = centre.x - Math.trunc(width / 2);
  const y2 = y1 + height - 1;
  const x2 = x1 + width - 1;

  /* Generate starburst room. Return immediately if out of bounds. */
  if (!generateStarburstRoom(g, y1, x1, y2, x2, light, FEAT.FLOOR, true)) {
    return false;
  }

  /* Sometimes, the room may have rubble in it. */
  if (g.rng.oneIn(10)) {
    generateStarburstRoom(
      g,
      y1 + g.rng.randint0(Math.trunc(height / 4)),
      x1 + g.rng.randint0(Math.trunc(width / 4)),
      y2 - g.rng.randint0(Math.trunc(height / 4)),
      x2 - g.rng.randint0(Math.trunc(width / 4)),
      false,
      FEAT.PASS_RUBBLE,
      false,
    );
  }

  return true;
}

/**
 * make_inner_chamber_wall (gen-room.c L1739): mark a granite/magma grid that is
 * not already an outer/solid wall as an inner wall. NEW carving helper.
 */
function makeInnerChamberWall(c: Chunk, y: number, x: number): void {
  const grid = loc(x, y);
  const feat = c.feat(grid);
  if (feat !== FEAT.GRANITE && feat !== FEAT.MAGMA) return;
  if (c.isWallOuter(grid)) return;
  if (c.isWallSolid(grid)) return;
  setMarkedGranite(c, grid, SQUARE.WALL_INNER);
}

/**
 * make_chamber (gen-room.c L1761): fill a rectangle with magma, wrap it in
 * inner wall, and punch one door into a random border grid (up to 20 tries).
 * NEW carving helper. RNG: per door try one_in_(2) [axis], one_in_(2) [side],
 * randint0(1 + span) [position].
 */
function makeChamber(
  g: Gen,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): void {
  const c = g.c;

  /* Fill with soft granite (will later be replaced with floor). */
  fillRectangle(c, y1 + 1, x1 + 1, y2 - 1, x2 - 1, FEAT.MAGMA, SQUARE.NONE);

  /* Generate inner walls over dungeon granite and magma. */
  for (let y = y1; y <= y2; y++) {
    makeInnerChamberWall(c, y, x1);
    makeInnerChamberWall(c, y, x2);
  }
  for (let x = x1; x <= x2; x++) {
    makeInnerChamberWall(c, y1, x);
    makeInnerChamberWall(c, y2, x);
  }

  /* Try a few times to place a door. */
  for (let i = 0; i < 20; i++) {
    let x: number;
    let y: number;
    /* Pick a square along the edge, not a corner. */
    if (g.rng.oneIn(2)) {
      x = g.rng.oneIn(2) ? x1 : x2;
      y = y1 + g.rng.randint0(1 + Math.abs(y2 - y1));
    } else {
      y = g.rng.oneIn(2) ? y1 : y2;
      x = x1 + g.rng.randint0(1 + Math.abs(x2 - x1));
    }

    /* If not an inner wall square, try again. */
    if (!c.isWallInner(loc(x, y))) continue;

    /* Paranoia */
    if (!c.inBoundsFully(loc(x, y))) continue;

    /* Reset wall count */
    let count = 0;

    /*
     * If square has not more than two adjacent walls, and no adjacent
     * doors, place door.
     */
    for (let d = 0; d < 9; d++) {
      const off = DDGRID_DDD[d] as Loc;
      const adj = loc(x + off.x, y + off.y);

      /* No doors beside doors. */
      if (c.feat(adj) === FEAT.OPEN) break;

      /* Count the inner walls. */
      if (c.isWallInner(adj)) count++;

      /* No more than two walls adjacent (plus the one we're on). */
      if (count > 3) break;

      /* Checked every direction? */
      if (d === 8) {
        /* Place an open door. */
        c.setFeat(loc(x, y), FEAT.OPEN);
        return;
      }
    }
  }
}

/**
 * hollow_out_room (gen-room.c L1846): flood-fill from a start grid, turning
 * adjacent magma into floor and adjacent open doors into broken doors, then
 * recursing. NEW carving helper. No RNG.
 */
function hollowOutRoom(c: Chunk, grid: Loc): void {
  for (let d = 0; d < 9; d++) {
    const off = DDGRID_DDD[d] as Loc;
    const g1 = loc(grid.x + off.x, grid.y + off.y);
    const feat = c.feat(g1);
    if (feat === FEAT.MAGMA) {
      c.setFeat(g1, FEAT.FLOOR);
      hollowOutRoom(c, g1);
    } else if (feat === FEAT.OPEN) {
      c.setFeat(g1, FEAT.BROKEN);
      hollowOutRoom(c, g1);
    }
  }
}

/**
 * build_room_of_chambers (gen-room.c L3239): a large room subdivided into many
 * irregular magma chambers, hollowed out and connected by doors/tunnels, then
 * filled with themed monsters via get_chamber_monsters.
 *
 * RNG order (verified against gen-room.c L3239-3517):
 *   randint0(45) [light], m_bonus(20,depth) [height], randint1(20) +
 *   m_bonus(20,depth) [width]; find_space when needed; per chamber
 *   randint0(4)+randint0(10)+randint0(4) [size] and 2x randint0 [corner] then
 *   make_chamber; the deterministic door/hollow/wall cleanup passes (magma
 *   spot loop draws 2x randint0 per try); place_random_door on broken doors;
 *   finally get_chamber_monsters.
 */
function buildRoomOfChambers(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;

  /* Deeper in the dungeon, chambers are less likely to be lit. */
  const light = g.rng.randint0(45) > c.depth;

  /* Calculate a level-dependent room size. */
  const height = 20 + g.rng.mBonus(20, c.depth);
  const width = 20 + g.rng.randint1(20) + g.rng.mBonus(20, c.depth);

  /* Find and reserve some space in the dungeon. Get center of room. */
  let centre = centreIn;
  if (centre.y >= c.height || centre.x >= c.width) {
    const found = findSpace(g, height, width);
    if (!found) return false;
    centre = found;
  }

  /* Calculate the borders of the room. */
  const y1 = centre.y - Math.trunc(height / 2);
  const x1 = centre.x - Math.trunc(width / 2);
  const y2 = centre.y + Math.trunc((height - 1) / 2);
  const x2 = centre.x + Math.trunc((width - 1) / 2);

  /* Make certain the room does not cross the dungeon edge. */
  if (!c.inBounds(loc(x1, y1)) || !c.inBounds(loc(x2, y2))) return false;

  /* Determine how much space we have. */
  const area = Math.abs(y2 - y1) * Math.abs(x2 - x1);

  /* Calculate the number of smaller chambers to make. */
  const numChambers = 10 + Math.trunc(area / 80);

  /* Build the chambers. */
  for (let i = 0; i < numChambers; i++) {
    /* Determine size of chamber. */
    const size = 3 + g.rng.randint0(4);
    const widthLocal = size + g.rng.randint0(10);
    const heightLocal = size + g.rng.randint0(4);

    /* Pick an upper-left corner at random. */
    const cY1 = y1 + g.rng.randint0(1 + y2 - y1 - heightLocal);
    const cX1 = x1 + g.rng.randint0(1 + x2 - x1 - widthLocal);

    /* Determine lower-right corner of chamber. */
    let cY2 = cY1 + heightLocal;
    if (cY2 > y2) cY2 = y2;
    let cX2 = cX1 + widthLocal;
    if (cX2 > x2) cX2 = x2;

    /* Make me a (magma filled) chamber. */
    makeChamber(g, cY1, cX1, cY2, cX2);
  }

  /* Remove useless doors, fill in tiny, narrow rooms. */
  for (let gy = y1; gy <= y2; gy++) {
    for (let gx = x1; gx <= x2; gx++) {
      const grid = loc(gx, gy);
      let count = 0;

      /* Stay legal. */
      if (!c.inBoundsFully(grid)) continue;

      /* Check all adjacent grids. */
      for (let d = 0; d < 8; d++) {
        const off = DDGRID_DDD[d] as Loc;
        const grid1 = loc(gx + off.x, gy + off.y);
        /* Count the walls and dungeon granite. */
        if (
          c.feat(grid1) === FEAT.GRANITE &&
          !c.isWallOuter(grid1) &&
          !c.isWallSolid(grid1)
        ) {
          count++;
        }
      }

      /* Five adjacent walls: Change non-chamber to wall. */
      if (count === 5 && c.feat(grid) !== FEAT.MAGMA) {
        setMarkedGranite(c, grid, SQUARE.WALL_INNER);
      } else if (count > 5) {
        /* More than five adjacent walls: Change anything to wall. */
        setMarkedGranite(c, grid, SQUARE.WALL_INNER);
      }
    }
  }

  /* Pick a random magma spot near the center of the room. */
  let spot = loc(x1, y1);
  for (let i = 0; i < 50; i++) {
    spot = loc(
      x1 + Math.trunc(Math.abs(x2 - x1) / 4) + g.rng.randint0(Math.trunc(Math.abs(x2 - x1) / 2)),
      y1 + Math.trunc(Math.abs(y2 - y1) / 4) + g.rng.randint0(Math.trunc(Math.abs(y2 - y1) / 2)),
    );
    if (c.feat(spot) === FEAT.MAGMA) break;
  }

  /* Hollow out the first room. */
  c.setFeat(spot, FEAT.FLOOR);
  hollowOutRoom(c, spot);

  /* Attempt to change every in-room magma grid to open floor. */
  for (let iter = 0; iter < 100; iter++) {
    /* Assume this run will do no useful work. */
    let joy = false;

    /* Make new doors and tunnels between magma and open floor. */
    for (let gy = y1; gy < y2; gy++) {
      for (let gx = x1; gx < x2; gx++) {
        const grid = loc(gx, gy);
        /* Current grid must be magma. */
        if (c.feat(grid) !== FEAT.MAGMA) continue;

        /* Stay legal. */
        if (!c.inBoundsFully(grid)) continue;

        /* Check only horizontal and vertical directions. */
        for (let d = 0; d < 4; d++) {
          const off = DDGRID_DDD[d] as Loc;
          const grid1 = loc(gx + off.x, gy + off.y);

          /* Need inner wall. */
          if (!c.isWallInner(grid1)) continue;

          /* Keep going in the same direction, if in bounds. */
          const grid2 = loc(grid1.x + off.x, grid1.y + off.y);
          if (!c.inBounds(grid2)) continue;

          /* If we find open floor, place a door. */
          if (c.feat(grid2) === FEAT.FLOOR) {
            joy = true;

            /* Make a broken door in the wall grid. */
            c.setFeat(grid1, FEAT.BROKEN);

            /* Hollow out the new room. */
            c.setFeat(grid, FEAT.FLOOR);
            hollowOutRoom(c, grid);

            break;
          }

          /* If we find more inner wall... */
          if (c.isWallInner(grid2)) {
            /* ...Keep going in the same direction. */
            const grid3 = loc(grid2.x + off.x, grid2.y + off.y);
            if (!c.inBounds(grid3)) continue;

            /* If we /now/ find floor, make a tunnel. */
            if (c.feat(grid3) === FEAT.FLOOR) {
              joy = true;

              /* Turn both wall grids into floor. */
              c.setFeat(grid1, FEAT.FLOOR);
              c.setFeat(grid2, FEAT.FLOOR);

              /* Hollow out the new room. */
              c.setFeat(grid, FEAT.FLOOR);
              hollowOutRoom(c, grid);

              break;
            }
          }
        }
      }
    }

    /* If we could find no work to do, stop. */
    if (!joy) break;
  }

  /* Turn broken doors into a random kind of door, remove open doors. */
  for (let gy = y1; gy <= y2; gy++) {
    for (let gx = x1; gx <= x2; gx++) {
      const grid = loc(gx, gy);
      if (c.feat(grid) === FEAT.OPEN) {
        setMarkedGranite(c, grid, SQUARE.WALL_INNER);
      } else if (c.feat(grid) === FEAT.BROKEN) {
        placeRandomDoor(g, grid);
      }
    }
  }

  /*
   * Turn all walls and magma not adjacent to floor into dungeon granite.
   * Turn all floors and adjacent grids into rooms, sometimes lighting them.
   */
  {
    const gyStart = y1 - 1 > 0 ? y1 - 1 : 0;
    const gyEnd = y2 + 2 < c.height ? y2 + 2 : c.height;
    const gxStart = x1 - 1 > 0 ? x1 - 1 : 0;
    const gxEnd = x2 + 2 < c.width ? x2 + 2 : c.width;
    for (let gy = gyStart; gy < gyEnd; gy++) {
      for (let gx = gxStart; gx < gxEnd; gx++) {
        const grid = loc(gx, gy);

        if (c.isWallInner(grid) || c.feat(grid) === FEAT.MAGMA) {
          for (let d = 0; d < 9; d++) {
            const off = DDGRID_DDD[d] as Loc;
            const grid1 = loc(gx + off.x, gy + off.y);
            /* Stay legal */
            if (!c.inBounds(grid1)) continue;
            /* No floors allowed */
            if (c.feat(grid1) === FEAT.FLOOR) break;
            /* Turn me into dungeon granite. */
            if (d === 8) setMarkedGranite(c, grid, SQUARE.NONE);
          }
        }
        if (c.isFloor(grid)) {
          for (let d = 0; d < 9; d++) {
            const off = DDGRID_DDD[d] as Loc;
            const grid1 = loc(gx + off.x, gy + off.y);
            /* Stay legal */
            if (!c.inBounds(grid1)) continue;
            /* Turn into room, forbid stairs. */
            c.sqinfoOn(grid1, SQUARE.ROOM);
            c.sqinfoOn(grid1, SQUARE.NO_STAIRS);
            /* Illuminate if requested. */
            if (light) c.sqinfoOn(grid1, SQUARE.GLOW);
          }
        }
      }
    }

    /* Turn all inner wall grids adjacent to dungeon granite into outer walls. */
    for (let gy = gyStart; gy < gyEnd; gy++) {
      for (let gx = gxStart; gx < gxEnd; gx++) {
        const grid = loc(gx, gy);
        /* Stay legal. */
        if (!c.inBoundsFully(grid)) continue;

        if (c.isWallInner(grid)) {
          for (let d = 0; d < 9; d++) {
            const off = DDGRID_DDD[d] as Loc;
            const grid1 = loc(gx + off.x, gy + off.y);
            /* Look for dungeon granite */
            if (
              c.feat(grid1) === FEAT.GRANITE &&
              !c.isWallInner(grid) &&
              !c.isWallOuter(grid) &&
              !c.isWallSolid(grid)
            ) {
              /* Turn me into outer wall. */
              setMarkedGranite(c, grid, SQUARE.WALL_OUTER);
              break;
            }
          }
        }
      }
    }
  }

  /*** Now we get to place the monsters. ***/
  getChamberMonsters(g, y1, x1, y2, x2, height * width);

  /* Increase the level rating. */
  c.addToMonsterRating(10);

  return true;
}

/**
 * build_huge (gen-room.c L3533): a single extreme-size starburst room, usually
 * broken up with irregular rubble fields. Only built as the first non-staircase
 * room, at a flat 5% chance.
 *
 * RNG order (verified against gen-room.c L3533-3605):
 *   randint0(10) [height], randint0(50) [width]; the cent_n/nstair_room gate
 *   (no RNG); one_in_(20) [5% gate]; one_in_(3) [light]; find_space when
 *   needed; generate_starburst_room; randint1(5) [rubble gate] then
 *   randint1(2) [count] and per field randint0(16)/randint0(24)/2x randint0.
 */
function buildHuge(g: Gen, centreIn: Loc, _rating: number): boolean {
  const c = g.c;
  const dun = g.dun;
  const findingSpace = centreIn.y >= c.height || centreIn.x >= c.width;

  const height = 30 + g.rng.randint0(10);
  const width = 45 + g.rng.randint0(50);

  /*
   * Only try to build a huge room as the first non-staircase room. If not
   * finding space, cent_n has already been incremented.
   */
  if (dun.centN - dun.nstairRoom > (findingSpace ? 0 : 1)) return false;

  /* Flat 5% chance. */
  if (!g.rng.oneIn(20)) return false;

  /* This room is usually lit. */
  const light = !g.rng.oneIn(3);

  /* Find and reserve some space. Get center of room. */
  let centre = centreIn;
  if (findingSpace) {
    const found = findSpace(g, height, width);
    if (!found) return false;
    centre = found;
  }

  /* Locate the room. */
  const y1 = centre.y - Math.trunc(height / 2);
  const x1 = centre.x - Math.trunc(width / 2);
  const y2 = y1 + height - 1;
  const x2 = x1 + width - 1;

  /* Make a huge starburst room with optional light. */
  if (!generateStarburstRoom(g, y1, x1, y2, x2, light, FEAT.FLOOR, false)) {
    return false;
  }

  /* Often, add rubble to break things up a bit. */
  if (g.rng.randint1(5) > 2) {
    /* Determine how many rubble fields to add (between 1 and 6). */
    const count = Math.trunc((height * width * g.rng.randint1(2)) / 1100);

    /* Make the rubble fields. */
    for (let i = 0; i < count; i++) {
      const heightTmp = 8 + g.rng.randint0(16);
      const widthTmp = 10 + g.rng.randint0(24);

      /* Semi-random location. */
      const y1Tmp = y1 + g.rng.randint0(height - heightTmp);
      const x1Tmp = x1 + g.rng.randint0(width - widthTmp);
      const y2Tmp = y1Tmp + heightTmp;
      const x2Tmp = x1Tmp + widthTmp;

      /* Make the rubble field. */
      generateStarburstRoom(
        g,
        y1Tmp,
        x1Tmp,
        y2Tmp,
        x2Tmp,
        false,
        FEAT.PASS_RUBBLE,
        false,
      );
    }
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Room profile + builder registry.
 * ------------------------------------------------------------------ */

/** A room entry in a dungeon profile's room list. */
export interface RoomProfile {
  name: string;
  /** Registry key resolved from list-rooms.h. */
  builder: string;
  rating: number;
  height: number;
  width: number;
  level: number;
  pit: boolean;
  rarity: number;
  cutoff: number;
}

export type RoomBuilder = (g: Gen, centre: Loc, rating: number) => boolean;

/** The runtime-registrable, string-keyed room builder registry. */
export class RoomRegistry {
  private readonly map = new Map<string, RoomBuilder>();

  constructor(private readonly data: RoomData) {}

  /** The loaded vault list (used by hard_centre's vault_chunk). */
  get vaults(): Vault[] {
    return this.data.vaults;
  }

  register(name: string, builder: RoomBuilder): void {
    this.map.set(name, builder);
  }

  get(name: string): RoomBuilder {
    const b = this.map.get(name);
    if (!b) throw new Error(`gen: no room builder registered for '${name}'`);
    return b;
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  names(): string[] {
    return [...this.map.keys()];
  }
}

/** Create a registry populated with the upstream builders bound to data. */
export function createRoomRegistry(data: RoomData): RoomRegistry {
  const r = new RoomRegistry(data);
  r.register("staircase", buildStaircase);
  r.register("simple", buildSimple);
  r.register("circular", buildCircular);
  r.register("overlap", buildOverlap);
  r.register("crossed", buildCrossed);
  r.register("large", buildLarge);
  r.register("nest", buildNest);
  r.register("pit", buildPit);
  r.register("moria", buildMoria);
  r.register("room_of_chambers", buildRoomOfChambers);
  r.register("huge", buildHuge);
  r.register("template", (g, centre, rating) =>
    buildRoomTemplateType(g, centre, 1, rating, data.templates),
  );
  r.register("interesting", (g, centre) => buildVaultType(g, centre, "Interesting room", data.vaults));
  r.register("lesser_vault", (g, centre) => buildVaultType(g, centre, "Lesser vault", data.vaults));
  r.register("medium_vault", (g, centre) => buildVaultType(g, centre, "Medium vault", data.vaults));
  r.register("greater_vault", (g, centre) => buildVaultType(g, centre, "Greater vault", data.vaults));
  r.register("lesser_new_vault", (g, centre) => buildVaultType(g, centre, "Lesser vault (new)", data.vaults));
  r.register("medium_new_vault", (g, centre) => buildVaultType(g, centre, "Medium vault (new)", data.vaults));
  r.register("greater_new_vault", (g, centre) => buildVaultType(g, centre, "Greater vault (new)", data.vaults));
  return r;
}

/**
 * room_build: attempt to build a room of the given profile at a block, or (if
 * findsOwnSpace) let the builder find its own space. The builder is resolved
 * from the string-keyed registry, so modded builders dispatch identically.
 */
export function roomBuild(
  g: Gen,
  by0: number,
  bx0: number,
  profile: RoomProfile,
  findsOwnSpace: boolean,
  registry: RoomRegistry,
): boolean {
  const dun = g.dun;
  const by1 = by0;
  const bx1 = bx0;
  let by2 = by0 + Math.trunc(profile.height / dun.blockHgt);
  let bx2 = bx0 + Math.trunc(profile.width / dun.blockWid);

  if (g.c.depth < profile.level) return false;
  if (dun.pitNum >= dun.levelPitMax && profile.pit) return false;

  if (profile.height % dun.blockHgt) by2++;
  if (profile.width % dun.blockWid) bx2++;

  const builder = registry.get(profile.builder);

  if (findsOwnSpace) {
    if (!builder(g, loc(g.c.width, g.c.height), profile.rating)) return false;
  } else {
    if (!checkForUnreservedBlocks(g, by1, bx1, by2, bx2)) return false;
    const centre = loc(
      Math.trunc(((bx1 + bx2 + 1) * dun.blockWid) / 2),
      Math.trunc(((by1 + by2 + 1) * dun.blockHgt) / 2),
    );
    if (dun.centN < dun.levelRoomMax) {
      dun.cent[dun.centN] = centre;
      dun.centN++;
    }
    if (!builder(g, centre, profile.rating)) {
      dun.centN--;
      return false;
    }
    reserveBlocks(g, by1, bx1, by2, bx2);
  }

  if (profile.pit) dun.pitNum++;
  return true;
}
