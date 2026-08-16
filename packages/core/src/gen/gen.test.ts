import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import type { ConstantsJson } from "../constants.js";
import { FEAT, ORIGIN, ROOM_ENTRIES, SQUARE } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import { Rng } from "../rng.js";
import { Chunk } from "../world/chunk.js";
import { FeatureRegistry } from "../world/feature.js";
import type { TerrainRecordJson } from "../world/feature.js";
import { ObjRegistry, tvalFindIdx } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { applyMagic, ArtifactState, objectPrep, ObjAllocState } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { createMonster, MonAllocTable } from "../mon/make.js";
import { createMimickedObject } from "../game/mon-place.js";

import {
  cavernGen,
  classicGen,
  connectCaverns,
  createDungeonProfiles,
  DungeonProfiles,
  gauntletGen,
  hardCentreGen,
  labyrinthGen,
  lairGen,
  loadDunProfile,
  modifiedGen,
  moriaGen,
  TOWN_STORE_FEATS,
  type CaveBuildContext,
  type DunProfile,
  type DunProfileRecordJson,
} from "./cave.js";
import {
  buildRoomTemplate,
  buildVault,
  createRoomRegistry,
  loadRoomTemplates,
  loadVaults,
  type RoomProfile,
  type RoomTemplateRecordJson,
  type VaultRecordJson,
} from "./room.js";
import {
  calcMonFeeling,
  calcObjFeeling,
  generateLevel,
  placeFeeling,
  type GenDeps,
} from "./generate.js";
import { getVaultMonsters, monPitHook, resolvePits, setPitType } from "./gen-monster.js";
import { RF } from "../generated/index.js";
import { GROUP_TYPE } from "../mon/monster.js";
import { MON_GROUP } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import {
  Dun,
  Gen,
  drawRectangle,
  fillRectangle,
  generateRoom,
  pickAndPlaceDistantMonster,
  placeNewMonster,
  placeObject,
  type MonPlaceDeps,
} from "./util.js";

/* ------------------------------------------------------------------ *
 * Pack loading.
 * ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return (loadJson<{ records: T[] }>(name)).records;
}

const terrain = loadRecords<TerrainRecordJson>("terrain");
const reg = new FeatureRegistry(terrain);
const constants = bindConstants(loadJson<ConstantsJson>("constants"));

const roomTemplates = loadRoomTemplates(loadRecords<RoomTemplateRecordJson>("room_template"));
const vaults = loadVaults(loadRecords<VaultRecordJson>("vault"), constants.maxDepth);

const objPack: ObjPackJson = {
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson;

const monPack: MonsterPackRecords = {
  pain: loadRecords("pain"),
  blowMethods: loadRecords("blow_methods"),
  blowEffects: loadRecords("blow_effects"),
  monsterSpells: loadRecords("monster_spell"),
  monsterBases: loadRecords("monster_base"),
  monsters: loadRecords("monster"),
  summons: loadRecords("summon"),
  pits: loadRecords("pit"),
};

/**
 * Faithful GenDeps: no mod, so GenDeps.hooks is absent and every extension point
 * is one undefined check. The seam tests below set `deps.hooks` on the result.
 */
function makeDeps(): GenDeps {
  const objReg = new ObjRegistry(objPack);
  const objAlloc = new ObjAllocState(objReg, constants);
  const objDeps: MakeDeps = {
    reg: objReg,
    alloc: objAlloc,
    constants,
    artifacts: new ArtifactState(objReg.artifacts.length),
    noArtifacts: false,
  };

  const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
  const table = new MonAllocTable(monReg.races, {
    maxDepth: constants.maxDepth,
    oodChance: constants.oodMonsterChance,
    oodAmount: constants.oodMonsterAmount,
  });
  const monDeps: MonPlaceDeps = { table, pits: resolvePits(monReg) };

  const rooms = createRoomRegistry({ templates: roomTemplates, vaults });
  const profiles = createDungeonProfiles(loadRecords<DunProfileRecordJson>("dungeon_profile"));
  return { reg, constants, rooms, profiles, objDeps, monDeps };
}

function bareGen(width: number, height: number, depth: number): Gen {
  const c = new Chunk(reg, height, width);
  c.depth = depth;
  const dun = new Dun(constants);
  return new Gen(c, new Rng(1), reg, constants, dun, null, null);
}

/* ------------------------------------------------------------------ *
 * Room template instantiation.
 * ------------------------------------------------------------------ */

describe("room template instantiation", () => {
  it("lays the 'Tiny hidden room' 7x7 with faithful glyph->feature mapping", () => {
    const tiny = roomTemplates.find((t) => t.name === "Tiny hidden room");
    expect(tiny).toBeDefined();
    if (!tiny) return;
    expect(tiny.hgt).toBe(7);
    expect(tiny.wid).toBe(7);

    const g = bareGen(40, 25, 3);
    /* randFix(0) forces the identity symmetry transform and the deterministic
     * "first door position" / "optional walls on" branches. */
    g.rng.randFix(0);
    const ok = buildRoomTemplate(g, loc(15, 10), tiny.hgt, tiny.wid, tiny.dor, tiny.rows, tiny.tval, tiny.fewEntrances);
    g.rng.randUnfix();
    expect(ok).toBe(true);

    /* Identity transform: top-left = (15 - 3, 10 - 3) = (12, 7). */
    /* '.' at template (1,1) -> floor. */
    expect(g.c.feat(loc(13, 8))).toBe(FEAT.FLOOR);
    /* '%' at (0,0) -> outer-wall granite. */
    expect(g.c.isGranite(loc(12, 7))).toBe(true);
    expect(g.c.isWallOuter(loc(12, 7))).toBe(true);
    /* '(' at (2,1) with optional walls on -> secret door. */
    expect(g.c.feat(loc(14, 8))).toBe(FEAT.SECRET);
    /* '1' at (3,4) is the chosen random door position -> secret door. */
    expect(g.c.feat(loc(15, 11))).toBe(FEAT.SECRET);

    /* The whole 7x7 footprint is marked as a room. */
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const grid = loc(12 + dx, 7 + dy);
        if (g.c.feat(grid) !== FEAT.NONE) {
          expect(g.c.sqinfoHas(grid, SQUARE.ROOM)).toBe(true);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Vault instantiation.
 * ------------------------------------------------------------------ */

describe("vault instantiation", () => {
  it("lays the 'Round' lesser vault with faithful glyph->feature mapping", () => {
    /* "Round" names TWO records in vault.txt - a Lesser vault and an
     * Interesting room - as do "Cross" and "Hourglass". Selecting on the name
     * alone silently depends on list order, and C's list is in REVERSE file
     * order (parse_vault_name prepends at generate.c:479-487 and
     * finish_parse_vault does not reverse, generate.c:614-618), so the bare
     * find returned the Interesting room once the loader was corrected to
     * match C. This test is about the lesser vault, so it says so. */
    const round = vaults.find((v) => v.name === "Round" && v.typ === "Lesser vault");
    expect(round).toBeDefined();
    if (!round) return;
    expect(round.hgt).toBe(12);
    expect(round.wid).toBe(20);

    const g = bareGen(30, 25, 8);
    g.rng.randFix(0);
    const ok = buildVault(g, loc(12, 8), round);
    g.rng.randUnfix();
    expect(ok).toBe(true);

    /* Identity transform: top-left = (12 - 10, 8 - 6) = (2, 2). */
    /* '%' at template (7,0) -> outer granite, NOT icky (no VAULT flag). */
    const outer = loc(2 + 7, 2 + 0);
    expect(g.c.isGranite(outer)).toBe(true);
    expect(g.c.isWallOuter(outer)).toBe(true);
    expect(g.c.sqinfoHas(outer, SQUARE.VAULT)).toBe(false);

    /* '#' at template (8,2) -> granite, icky (VAULT flag set). */
    const inner = loc(2 + 8, 2 + 2);
    expect(g.c.isGranite(inner)).toBe(true);
    expect(g.c.sqinfoHas(inner, SQUARE.VAULT)).toBe(true);

    /* Every non-space glyph laid down some feature and marked ROOM. */
    for (let y = 0; y < round.hgt; y++) {
      const row = round.rows[y] as string;
      for (let x = 0; x < round.wid; x++) {
        if ((row[x] ?? " ") === " ") continue;
        const grid = loc(2 + x, 2 + y);
        expect(g.c.feat(grid)).not.toBe(FEAT.NONE);
        expect(g.c.sqinfoHas(grid, SQUARE.ROOM)).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Full level generation invariants + determinism.
 * ------------------------------------------------------------------ */

/** Serialize a chunk's terrain for equality checks. */
function serialize(g: Gen): string {
  const c = g.c;
  const feats: number[] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) feats.push(c.feat(loc(x, y)));
  }
  return `${c.width}x${c.height}|${g.playerSpot?.x},${g.playerSpot?.y}|${feats.join(",")}`;
}

/** BFS-count traversable grids reachable from a start (4-connected). */
function reachableCount(g: Gen, start: Loc): number {
  const c = g.c;
  const traversable = (grid: Loc): boolean =>
    c.isPassable(grid) || c.isDoor(grid) || c.isRubble(grid);
  const seen = new Uint8Array(c.width * c.height);
  const stack: Loc[] = [start];
  seen[start.y * c.width + start.x] = 1;
  let count = 0;
  const dirs = [loc(0, 1), loc(0, -1), loc(1, 0), loc(-1, 0)];
  while (stack.length) {
    const cur = stack.pop() as Loc;
    count++;
    for (const d of dirs) {
      const n = loc(cur.x + d.x, cur.y + d.y);
      if (!c.inBounds(n)) continue;
      const idx = n.y * c.width + n.x;
      if (seen[idx]) continue;
      if (!traversable(n)) continue;
      seen[idx] = 1;
      stack.push(n);
    }
  }
  return count;
}

function totalTraversable(g: Gen): number {
  const c = g.c;
  let total = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      if (c.isPassable(grid) || c.isDoor(grid) || c.isRubble(grid)) total++;
    }
  }
  return total;
}

describe("full level generation", () => {
  it("is deterministic for a fixed seed and depth", () => {
    const a = generateLevel(new Rng(20260708), 5, makeDeps());
    const b = generateLevel(new Rng(20260708), 5, makeDeps());
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });

  it("satisfies structural invariants at depth 5", () => {
    const g = generateLevel(new Rng(4242), 5, makeDeps());
    const c = g.c;

    /* Player start on passable floor, fully in bounds. */
    expect(g.playerSpot).not.toBeNull();
    const p = g.playerSpot as Loc;
    expect(c.inBoundsFully(p)).toBe(true);
    expect(c.isPassable(p)).toBe(true);
    expect(c.isFloor(p)).toBe(true);

    /* At least one down stair and one up stair (depth 5 has both). */
    expect(c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
    expect(c.featCount[FEAT.LESS] ?? 0).toBeGreaterThanOrEqual(1);

    /* Fully connected: every traversable grid is reachable from the player. */
    expect(reachableCount(g, p)).toBe(totalTraversable(g));

    /* Perimeter is permanent wall. */
    for (let x = 0; x < c.width; x++) {
      expect(c.isPerm(loc(x, 0))).toBe(true);
      expect(c.isPerm(loc(x, c.height - 1))).toBe(true);
    }

    /* Placed monsters/objects are in bounds and on legal squares. */
    for (const m of g.monsters) expect(c.inBoundsFully(m.grid)).toBe(true);
    for (const o of g.objects) {
      expect(c.inBoundsFully(o.grid)).toBe(true);
      expect(c.isObjectHolding(o.grid)).toBe(true);
    }
  });

  it("places monsters and objects within expected ranges across depths", () => {
    for (const depth of [1, 5, 25, 50]) {
      const g = generateLevel(new Rng(1000 + depth), depth, makeDeps());
      expect(g.monsters.length).toBeGreaterThanOrEqual(1);
      expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
      expect(g.objects.length).toBeGreaterThanOrEqual(1);
      /* No monster shares a grid; no two objects share a grid. */
      const monCells = new Set(g.monsters.map((m) => m.grid.y * g.c.width + m.grid.x));
      expect(monCells.size).toBe(g.monsters.length);
      const objCells = new Set(g.objects.map((o) => o.grid.y * g.c.width + o.grid.x));
      expect(objCells.size).toBe(g.objects.length);
    }
  });

  /*
   * Walk the region the player can actually get to: passable grids, plus doors
   * (openable) and rubble (diggable). 8-directional, since the player moves
   * diagonally and caverns connect diagonally. Walls are excluded on purpose -
   * granite is tunnellable, but counting it would make the guarantee vacuous.
   */
  const D8: readonly Loc[] = [
    loc(0, 1), loc(0, -1), loc(1, 0), loc(-1, 0),
    loc(1, 1), loc(1, -1), loc(-1, 1), loc(-1, -1),
  ];

  const walkFrom = (g: Gen, start: Loc): Uint8Array => {
    const c = g.c;
    const trav = (gr: Loc): boolean => c.isPassable(gr) || c.isDoor(gr) || c.isRubble(gr);
    const seen = new Uint8Array(c.width * c.height);
    const stack: Loc[] = [start];
    seen[start.y * c.width + start.x] = 1;
    while (stack.length) {
      const cur = stack.pop() as Loc;
      for (const d of D8) {
        const n = loc(cur.x + d.x, cur.y + d.y);
        if (!c.inBounds(n)) continue;
        const idx = n.y * c.width + n.x;
        if (seen[idx] || !trav(n)) continue;
        seen[idx] = 1;
        stack.push(n);
      }
    }
    return seen;
  };

  /** [total on the level, how many of them the player can walk to]. */
  const stairTally = (g: Gen, seen: Uint8Array, feat: number): [number, number] => {
    const c = g.c;
    let total = 0;
    let reached = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (c.feat(loc(x, y)) !== feat) continue;
        total++;
        if (seen[y * c.width + x]) reached++;
      }
    }
    return [total, reached];
  };

  /**
   * THE STAIRCASE INVARIANT IS NOT CORE'S, and the control test below is what
   * says so out loud.
   *
   * Faithful core does NOT hold it, deliberately (owner ruling 2026-07-26: "Core
   * must retain all warts of the reference code"). The ruling only stands, of
   * course, if the stranding really is upstream's; a port defect would have to be
   * FIXED here and un-fixed in the mod. Adjudicated 2026-08-06 against the C, and
   * every piece of the mechanism is upstream's:
   *
   *   - alloc_stairs (gen-util.c:629) accepts any square_isempty grid with the
   *     required wall count. It does NOT exclude vault interiors. The asymmetry
   *     is deliberate rather than an oversight: find_start, three tiers deep
   *     (square_suits_stairs_well / _ok at cave-square.c:929/939, then the
   *     walls-6-and-falling fallback at gen-util.c:387), excludes
   *     square_isvault at EVERY tier. Upstream knows how to keep something out
   *     of a vault, and keeps the player out but not the staircase.
   *   - join_region (gen-cave.c:1983, 2017) refuses to dig a vault grid, and
   *     with allow_vault_disconnect = true it still plans a path THROUGH one,
   *     so the two regions are recoloured as joined without a passage ever being
   *     cut. Five of the six ensure_connectedness sites pass true; only
   *     hard_centre_gen (gen-cave.c:3464) passes false.
   *   - The port matches all eight of the C's generation-time square_isvault
   *     sites, and both files mark SQUARE_VAULT from exactly one place
   *     (gen-room.c:1506 <-> gen/room.ts).
   *
   * The census that closed it: all 22 pinned seeds strand a stair that is itself
   * SQUARE_VAULT, and in every one of them the sealed region is 100% vault
   * grids - not one grid of ordinary level leaks into it. So the port is not
   * failing to connect the dungeon; it is reproducing upstream's refusal to
   * connect a vault. The control test below re-measures that on every run.
   *
   * The repair is the bug-fixes mod's, in the neo-angband-mod-bug-fixes repo
   * (stairs.ts, flag bugfix.stairsReachable), and it reaches this generator
   * through the levelGenerated hook like any third-party level mod would.
   * Everything that asserts the repair WORKS - the synthetic sealed-vault
   * levels, the RNG-freedom pin, the under-the-player fallback, the unrepairable
   * refusal, the quest-floor guard, and the sweep over every stranded seed -
   * moved with it. What is left here is core's half: the wart, and the seam.
   */

  /**
   * Measured stranded levels in FAITHFUL core: every staircase of at least one
   * direction sealed away from the player, in all 22 cases inside a vault. These
   * drive the control/fix pair below - the control proves core still has the
   * wart AND that it is upstream's wart, the fix test proves the mod flag
   * repairs exactly these.
   */
  const STRANDED: readonly [number, number, readonly string[]][] = [
    /*
     * RE-PINNED WHOLESALE on 2026-08-07, and the cause is an INPUT change, not
     * a code change: #143 moved reference/ from upstream master back to the
     * 4.2.6 tag, which is the baseline every doc already claimed. 4.2.6 ships
     * 1,631 more lines of room_template.txt than master and a different
     * vault.txt, so the room the generator reaches for at each draw differs
     * from the first template onward.
     *
     * 14 of the 22 previously pinned seeds stopped stranding. This test's own
     * note calls "most of them going stale" a behavioural regression rather
     * than a stream shift, and that rule is right - it is just not what
     * happened here, and the evidence is that the RATE held:
     *
     *     master gamedata   22 / 15000   0.15% stranded
     *     4.2.6 gamedata    31 / 12000   0.26% stranded
     *
     * Same sweep shape (3,000 seeds each at depths 20/40/50/60; depth 1 is
     * dropped because it produced zero after the 2026-08-06 predicate fix and
     * 3,000 wasted generations with it). Every one of the 31 below carries
     * upstream's signature - the CONTROL test re-measures that on every run,
     * and notUpstreamStranding would name any that did not.
     *
     * The previous re-pin's finding still stands and is not repeated here: see
     * git history for the 2026-08-06 build_streamer / square_isrock note, which
     * separated 104 genuine port defects from a stream shift.
     *
     * Every direction is DERIVED from strandedDirs, never hand-written.
     */
    [20, 200435, ["up"]],
    [20, 200563, ["up"]],
    [20, 201097, ["up"]],
    [20, 201258, ["up"]],
    [40, 402102, ["up"]],
    [40, 402149, ["up"]],
    [40, 402342, ["up"]],
    [40, 402698, ["up"]],
    [40, 402806, ["up"]],
    [40, 402944, ["up"]],
    [50, 500152, ["up"]],
    [50, 500255, ["up"]],
    [50, 500314, ["up"]],
    [50, 501002, ["up"]],
    [50, 501368, ["up"]],
    [50, 501511, ["up"]],
    [50, 502233, ["up"]],
    [50, 502276, ["up"]],
    [60, 600148, ["up"]],
    [60, 600399, ["up"]],
    [60, 600567, ["up"]],
    [60, 600759, ["up"]],
    [60, 601057, ["up"]],
    [60, 601175, ["up"]],
    [60, 601451, ["up"]],
    [60, 601566, ["up"]],
    [60, 602100, ["up"]],
    [60, 602272, ["up"]],
    [60, 602403, ["down"]],
    [60, 602920, ["up"]],
    /* Held apart in STRANDED_UNCLASSIFIED until 2026-08-09; see the test below
     * for the adjudication. Upstream's route 2, and the only seed of the 32
     * that strands in BOTH directions. */
    [40, 400792, ["down", "up"]],
  ];

  /**
   * Upstream's stranding has a SIGNATURE, and this is the classifier for it.
   *
   * join_region (gen-cave.c:1983, 2017) declines to dig exactly one kind of
   * grid: SQUARE_VAULT. So the mechanism that swallows a staircase leaves a
   * vault grid sealed into a region that is vault to the last square, and all 22
   * pinned seeds plus every stranding in a 15,000-seed sweep look exactly like
   * that.
   *
   * A violation is a LEAD, not a verdict. The likely cause is the port failing
   * to connect the dungeon - core's bug to fix, and the bug-fixes mod's repair
   * to withdraw. Upstream has a SECOND route to the same shape, and as of
   * 2026-08-09 it is no longer hypothetical: see ROUTE 2 below and the seed
   * 400792 test. Both are checked here, so a violation now means neither
   * mechanism explains it.
   *
   * Returns one string per violation, empty when every stranding is upstream's.
   */
  const notUpstreamStranding = (g: Gen): string[] => {
    const c = g.c;
    const reachable = walkFrom(g, g.playerSpot as Loc);
    const out: string[] = [];
    for (const [name, feat] of [["down", FEAT.MORE], ["up", FEAT.LESS]] as const) {
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const stair = loc(x, y);
          if (c.feat(stair) !== feat) continue;
          if (reachable[y * c.width + x]) continue;
          /* The region it is sealed into, by the same walk rule. */
          const sealed = walkFrom(g, stair);
          let size = 0;
          let outside = 0;
          for (let i = 0; i < sealed.length; i++) {
            if (!sealed[i]) continue;
            size++;
            if (!c.sqinfoHas(loc(i % c.width, Math.trunc(i / c.width)), SQUARE.VAULT)) outside++;
          }
          /* ROUTE 1: the stair is itself a vault grid and its region is vault to
           * the last square - join_region never entered, because every way in
           * was a grid it declines to dig. */
          if (c.sqinfoHas(stair, SQUARE.VAULT) && outside === 0) continue;
          /* ROUTE 2, adjudicated 2026-08-09 on d40 seed 400792 (task #148).
           *
           * join_region's two halves treat vault grids DIFFERENTLY, in the port
           * and in 4.2.6 alike (cave.ts joinRegion / gen-cave.c:1925): the BFS
           * may traverse a vault grid when allow_vault_disconnect is set, but
           * the walk-back that turns the planned path into floor refuses to dig
           * one. So a crossing whose only route was through a vault WALL is
           * recoloured as joined and left physically holed, and an ORDINARY
           * region stays sealed with no vault grid in it.
           *
           * The observable signature is a non-permanent SQUARE_VAULT wall on the
           * sealed region's boundary: that is the only grid class join_region
           * can plan through and then decline to dig. Permanent walls are
           * excluded because upstream never digs those on any path, so they say
           * nothing about which mechanism fired.
           *
           * MEASURED, not inferred. Instrumenting the else-branch of that dig
           * loop to record every refused vault grid named exactly one on this
           * region's boundary: (94,38). The evidence is reproducible by adding
           * that recorder back; the check here is written against the finished
           * level so it needs no hook in the generator. */
          let undiggableVaultWall = false;
          for (let i = 0; i < sealed.length && !undiggableVaultWall; i++) {
            if (!sealed[i]) continue;
            const gy = Math.trunc(i / c.width);
            const gx = i % c.width;
            for (const d of D8) {
              const n = loc(gx + d.x, gy + d.y);
              if (!c.inBounds(n) || sealed[n.y * c.width + n.x]) continue;
              if (c.sqinfoHas(n, SQUARE.VAULT) && !c.isPerm(n)) {
                undiggableVaultWall = true;
                break;
              }
            }
          }
          if (undiggableVaultWall) continue;
          if (!c.sqinfoHas(stair, SQUARE.VAULT)) {
            out.push(`sealed ${name} stair at (${x},${y}) is not SQUARE_VAULT`);
            continue;
          }
          out.push(
            `${name} stair at (${x},${y}) is sealed into a ${size}-grid region ` +
              `with ${outside} non-vault grids`,
          );
        }
      }
    }
    return out;
  };

  /** The directions of `g` that have a stair but no reachable one. */
  const strandedDirs = (g: Gen): string[] => {
    const seen = walkFrom(g, g.playerSpot as Loc);
    const out: string[] = [];
    for (const [name, feat] of [["down", FEAT.MORE], ["up", FEAT.LESS]] as const) {
      const [total, reached] = stairTally(g, seen, feat);
      if (total > 0 && reached === 0) out.push(name);
    }
    return out;
  };

  /* 20s, not the 5s default, and for the same reason as the deep-profile-pool
   * test above - which is the point: this is the SECOND test in this file caught
   * by the 5s default, and it was left behind the first time because it is the
   * second-heaviest rather than the heaviest.
   *
   * Measured for #282 before changing anything, because a raised ceiling with no
   * argument behind it is a loosened tolerance. The body is 31 generateLevel
   * calls on 31 fixed seeds; "is deterministic for a fixed seed and depth", ~300
   * lines up, asserts that a seed's level is a fixed object, so the WORK here is
   * a constant. What is not constant is how long the machine takes to do it. The
   * same body, instrumented with process.cpuUsage() around the loop, as mean
   * over n runs:
   *
   *     alone            n=5    wall 1585ms (1522-1721)  cpu 2216ms (2032-2328)
   *     12 workers       n=60   wall 4146ms (3527-4824)  cpu 3824ms (3516-4173)
   *     20 workers       n=60   wall 5598ms (3770-7371)  cpu 3858ms (3454-4453)
   *
   * Between the two contended rows the CPU means are 0.9% apart while the wall
   * means move 35%: the failure is scheduling, not work. (The step from row one
   * to row two costs real cycles as well as real time - eight physical cores
   * sharing cache - but that step fails nothing. The step that fails is the one
   * where only the clock moves.) And it is a pure clock failure, never a
   * disagreement - at 20 workers, 46 of 60 runs failed and the count of bodies
   * whose wall exceeded 5000ms was also exactly 46, with no assertion difference
   * in any of them. Every one reported "Test timed out in 5000ms" and nothing
   * else. At 12 workers, 12 of 36 whole-file runs failed and the CONTROL was the
   * only test in the file that timed out in any of the 76 whole-file runs, which
   * is why no sibling gets a ceiling here. With this ceiling in place and the
   * concurrency unchanged: 0 of 36, and 0 of 40 at 20 workers.
   *
   * What the ceiling replaces is a margin, not a safety property. Ten full-suite
   * runs measured this body at 3897-4778ms (mean 4246ms) against the old 5000ms
   * default - a worst case using 96% of it. None of those ten went over, so this
   * series did not itself catch an excursion; the four sightings that opened the
   * ticket are the evidence that it happens, and a distribution sitting that
   * close to the bound is the evidence for why. Two tests further down this file
   * clear 8s on every full-suite run and survive only on their 120s ceilings.
   *
   * That matters more than an ordinary flake because this is the CONTROL. An
   * intermittent control fails in both directions: a real stranding regression
   * gets waved away as "that flaky control", and a green control stops being
   * evidence the instrument works. Vitest 4 enforces the bound on a synchronous
   * body too - it re-checks now() - startTime after the body returns - so being
   * sync is no protection.
   *
   * Note what the ceiling does NOT do: it cannot change this test's verdict.
   * The body either completes and gives its exact answer or it does not run at
   * all, so the bound was only ever noise. A generous one still catches a hang. */
  it("CONTROL: faithful core strands floors, exactly as upstream 4.2.6 does", { timeout: 20_000 }, () => {
    /*
     * The wart core keeps on purpose. This is the load-bearing test of the
     * 2026-07-26 ruling ("Core must retain all warts of the reference code"): if
     * someone re-adds the repair to core unconditionally, or makes it
     * default-on, this test fails and says why.
     *
     * It is also the power validation for the fix test below - the two run the
     * same seeds through the same generator and differ only in the flag.
     */
    /* Collect every stale seed rather than aborting on the first. A loop of
     * bare expects hides the rest of the list, which matters here: when the
     * parse_random fix shifted the generation stream on 2026-07-26 the first
     * failure looked like a single stale example, and there were two. */
    /* The third tuple element is the stranded DIRECTIONS, and it is compared,
     * not just printed. The 2026-08-06 re-pin nearly shipped 22 hand-written
     * labels ("both", "up stair sealed off") that were guesses: 21 of the 22
     * seeds strand upward only and exactly one strands downward, and a label
     * nothing reads could have said anything at all. Derived and asserted, it
     * is a second measurement per seed rather than a decoration. */
    /* The fourth measurement: WHY it stranded. See the long note above - the
     * ruling that core keeps this wart rests on the stranding being upstream's,
     * and upstream's mechanism has a signature. Every sealed stair must be a
     * vault grid, and the region sealed with it must be vault to the last grid.
     * A stranding that fails either half is not join_region declining to dig a
     * vault; it is the port failing to connect the dungeon, and it would have to
     * be fixed HERE and un-fixed in the bug-fixes mod. */
    const notUpstream: string[] = [];
    const notStranded: string[] = [];
    const wrongDirs: string[] = [];
    for (const [depth, seed, dirs] of STRANDED) {
      const g = generateLevel(new Rng(seed), depth, makeDeps());
      const actual = strandedDirs(g);
      if (actual.length === 0) {
        notStranded.push(`d${depth} seed ${seed} (${dirs.join("+")})`);
      } else if (actual.join("+") !== [...dirs].join("+")) {
        wrongDirs.push(`d${depth} seed ${seed}: pinned ${dirs.join("+")}, got ${actual.join("+")}`);
      }
      for (const v of notUpstreamStranding(g)) notUpstream.push(`d${depth} seed ${seed}: ${v}`);
    }
    expect(
      notUpstream,
      `these strandings do not carry upstream's signature: ${notUpstream.join("; ")}. ` +
        `join_region declines to dig SQUARE_VAULT grids and nothing else, so a sealed ` +
        `region that reaches ordinary floor is most likely a PORT connectivity defect - ` +
        `it would belong in core's generator, not in the bug-fixes mod. Read the note on ` +
        `notUpstreamStranding for the one upstream route to the same shape, and rule it ` +
        `out before changing anything.`,
    ).toEqual([]);
    expect(wrongDirs, `stranded directions moved: ${wrongDirs.join("; ")}`).toEqual([]);
    expect(
      notStranded,
      `these seeds no longer strand under faithful core: ${notStranded.join("; ")}. ` +
        `If the repair moved back into core unconditionally, revert it - it belongs to ` +
        `the bug-fixes mod (bugfix.stairsReachable). If instead a deliberate change moved ` +
        `the generation stream, re-pin only the stale examples and say so, and check how ` +
        `many of the ${STRANDED.length} still strand: a handful going stale is a stream ` +
        `shift, most of them going stale is a behavioural regression.`,
    ).toEqual([]);
  });

  it("d40 seed 400792 is upstream's SECOND route, and stays measurable", () => {
    /*
     * Task #148, adjudicated 2026-08-09. This seed was held apart for two days
     * as the one stranding that did not carry upstream's signature, and the
     * verdict is that it carries upstream's OTHER one - the route
     * notUpstreamStranding's note predicted and had never observed in 27,000
     * levels.
     *
     * The seed's own numbers, and they are what a regression would move:
     * three down staircases at (166,14), (96,39) and (114,46), all in ONE
     * 385-grid region that is 60 vault grids and 325 ordinary ones, plus a
     * separate 17-grid all-vault pocket holding the level's only up stair.
     * The first is route 2, the second is route 1 - one level, both mechanisms.
     *
     * Asserted here rather than left to the CONTROL test above, because the
     * control only checks that nothing is UNexplained: if this seed stopped
     * stranding entirely the control would go quiet and the finding would
     * vanish with it.
     */
    const g = generateLevel(new Rng(400792), 40, makeDeps());
    expect(strandedDirs(g)).toEqual(["down", "up"]);
    expect(notUpstreamStranding(g)).toEqual([]);

    const c = g.c;
    const downRegion = walkFrom(g, loc(166, 14));
    let size = 0;
    let vaultIn = 0;
    let diggableVaultWalls = 0;
    for (let i = 0; i < downRegion.length; i++) {
      if (!downRegion[i]) continue;
      size++;
      const gy = Math.trunc(i / c.width);
      const gx = i % c.width;
      if (c.sqinfoHas(loc(gx, gy), SQUARE.VAULT)) vaultIn++;
      for (const d of D8) {
        const n = loc(gx + d.x, gy + d.y);
        if (!c.inBounds(n) || downRegion[n.y * c.width + n.x]) continue;
        if (c.sqinfoHas(n, SQUARE.VAULT) && !c.isPerm(n)) diggableVaultWalls++;
      }
    }
    /* The region really is ORDINARY - that is what made it look like a port
     * connectivity defect - and it really is walled by grids upstream would
     * have dug had they not been flagged vault. Both halves, or the route-2
     * verdict is resting on one of them alone. */
    expect(size).toBe(385);
    expect(vaultIn).toBe(60);
    expect(size - vaultIn).toBeGreaterThan(0);
    expect(diggableVaultWalls).toBeGreaterThan(0);
    /* All three down stairs share the one region: a single refused dig sealed
     * every way off this level except tunnelling. */
    for (const stair of [loc(166, 14), loc(96, 39), loc(114, 46)]) {
      expect(c.feat(stair)).toBe(FEAT.MORE);
      expect(downRegion[stair.y * c.width + stair.x]).toBe(1);
    }
  });

  /**
   * A CONTROL ON THE CONTROL. The signature check above passes on all 22 pinned
   * seeds, and a check that has only ever been seen passing is not yet evidence.
   *
   * The obvious mutant does not reach it: disabling ensureConnectedness's join
   * loop entirely still produced zero non-vault strandings on these seeds - it
   * moved the generation stream instead, and seven seeds simply stopped
   * stranding, which the OLDER assertion catches. So the signature check needs
   * an input built to violate it, and here it is: one hand-built level with a
   * floor pocket sealed off by granite and an up staircase inside it, and its
   * twin with the pocket marked SQUARE_VAULT. Identical geometry; only the flag
   * that join_region reads differs, and the verdict flips with it.
   */
  it("CONTROL for the control: a sealed NON-vault stair is called a port defect", () => {
    /**
     * A level with one sealed 3x3 pocket holding an up stair.
     *
     * `markVault`: "none" leaves the pocket as ordinary floor, "all" flags the
     * whole pocket the way build_vault does, and "stair" flags only the stair -
     * which is the case that separates the classifier's two halves, since the
     * stair passes the SQUARE_VAULT test and the region it is sealed into does
     * not.
     */
    const sealedPocket = (mark: "none" | "all" | "stair" | "wall"): Gen => {
      const markVault = mark === "all";
      const g = bareGen(40, 25, 10);
      const c = g.c;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) c.setFeat(loc(x, y), FEAT.GRANITE);
      }
      /* The player's room. */
      for (let y = 2; y <= 10; y++) {
        for (let x = 2; x <= 10; x++) c.setFeat(loc(x, y), FEAT.FLOOR);
      }
      /* The pocket, nowhere near it and walled off by the granite fill. */
      for (let y = 18; y <= 20; y++) {
        for (let x = 20; x <= 22; x++) {
          const grid = loc(x, y);
          c.setFeat(grid, FEAT.FLOOR);
          if (markVault) c.sqinfoOn(grid, SQUARE.VAULT);
        }
      }
      const stair = loc(21, 19);
      c.setFeat(stair, FEAT.LESS);
      if (mark === "all" || mark === "stair") c.sqinfoOn(stair, SQUARE.VAULT);
      /* ROUTE 2's synthetic: an ORDINARY pocket walled by ordinary granite,
       * with one boundary grid flagged vault - the grid join_region would have
       * dug had build_vault not claimed it. Nothing inside the pocket is vault,
       * which is exactly what makes it indistinguishable from a port
       * connectivity defect by route 1's test alone. */
      if (mark === "wall") c.sqinfoOn(loc(21, 17), SQUARE.VAULT);
      g.playerSpot = loc(6, 6);
      return g;
    };

    /* All three levels really do strand the up stair - otherwise the classifier
     * is being asked about a level that has nothing to classify. */
    const plain = sealedPocket("none");
    const vaulted = sealedPocket("all");
    const stairOnly = sealedPocket("stair");
    const wallOnly = sealedPocket("wall");
    expect(strandedDirs(plain)).toEqual(["up"]);
    expect(strandedDirs(vaulted)).toEqual(["up"]);
    expect(strandedDirs(stairOnly)).toEqual(["up"]);
    expect(strandedDirs(wallOnly)).toEqual(["up"]);

    /* Ordinary floor: a port connectivity defect, and named as one. */
    expect(notUpstreamStranding(plain)).toEqual([
      "sealed up stair at (21,19) is not SQUARE_VAULT",
    ]);
    /* The same pocket, flagged the way build_vault flags one: upstream's wart. */
    expect(notUpstreamStranding(vaulted)).toEqual([]);
    /* Vault stair, ordinary sealed region: still not upstream's mechanism, and
     * the half of the classifier the other two cases never reach. */
    expect(notUpstreamStranding(stairOnly)).toEqual([
      "up stair at (21,19) is sealed into a 9-grid region with 8 non-vault grids",
    ]);
    /* ROUTE 2, and the pair that keeps the arm from being a blanket pardon:
     * `wallOnly` and `plain` are the SAME level but for one boundary grid's
     * vault flag, and they must be classified differently. If the route-2 arm
     * ever accepts `plain` it has stopped discriminating and would forgive a
     * real port connectivity defect. */
    expect(notUpstreamStranding(wallOnly)).toEqual([]);
    expect(notUpstreamStranding(plain)).not.toEqual([]);
  });

  /* ------------------------------------------------------------------ *
   * The finished-level seam (mod/hooks.ts levelGenerated). Core's half of the
   * contract, with hand-written hooks standing in for a mod: it is offered the
   * accepted level, its refusal re-rolls, and its mere presence changes nothing.
   * ------------------------------------------------------------------ */

  it("offers the accepted level to the hook, with the quest flag", () => {
    const seen: Array<{ isGen: boolean; quest: boolean; spot: boolean }> = [];
    const deps = makeDeps();
    deps.hooks = {
      levelGenerated: (gen, quest) => {
        const g = gen as Gen;
        seen.push({ isGen: g instanceof Gen, quest, spot: g.playerSpot !== null });
        return true;
      },
    };
    const g = generateLevel(new Rng(20260729), 5, deps);
    expect(seen).toEqual([{ isGen: true, quest: false, spot: true }]);
    /* The very object the caller gets back, so a repair reaches the real level. */
    expect(g.playerSpot).not.toBeNull();
  });

  it("passes quest=true on a quest level, so a repair cannot mint a way down", () => {
    const seen: boolean[] = [];
    const deps = makeDeps();
    deps.hooks = { levelGenerated: (_g, quest) => { seen.push(quest); return true; } };
    generateLevel(new Rng(4242), 99, deps, { quest: true });
    expect(seen).toEqual([true]);
  });

  it("a refusal re-rolls the level, the same treatment as a monster overflow", () => {
    const rejected: string[] = [];
    const deps = makeDeps();
    let calls = 0;
    deps.hooks = { levelGenerated: () => ++calls > 2 };
    deps.cheatMsg = (text) => rejected.push(text);
    const g = generateLevel(new Rng(777), 5, deps);
    expect(calls).toBe(3); // two refusals, then an accepted level
    expect(rejected.filter((t) => t.includes("rejected by a mod"))).toHaveLength(2);
    expect(g.playerSpot).not.toBeNull();
    /* Different from the level the same seed builds with no hook at all - the
     * refusal really went back through the retry loop. */
    const faithful = generateLevel(new Rng(777), 5, makeDeps());
    expect(Array.from(g.c.featCount)).not.toEqual(Array.from(faithful.c.featCount));
  });

  it("an installed but permissive hook builds a BIT-IDENTICAL level", () => {
    /* The hook is handed no rng and must draw none; core must not spend a draw
     * offering the level either. Level equality plus RNG-state equality is the
     * whole claim, and it is what lets a mod be enabled without a seed changing
     * meaning. */
    const seed = 31337;
    const faithful = generateLevel(new Rng(seed), 5, makeDeps());
    const permissiveDeps = makeDeps();
    let called = 0;
    permissiveDeps.hooks = { levelGenerated: () => { called++; return true; } };
    const hooked = generateLevel(new Rng(seed), 5, permissiveDeps);

    expect(called).toBe(1); // not a vacuous comparison: the hook really ran
    expect(hooked.rng.getState()).toEqual(faithful.rng.getState());
    expect(Array.from(hooked.c.featCount)).toEqual(Array.from(faithful.c.featCount));
    expect(hooked.playerSpot).toEqual(faithful.playerSpot);
    expect(hooked.monsters.length).toBe(faithful.monsters.length);
    expect(hooked.objects.length).toBe(faithful.objects.length);
  });

  /* 20s, not the 5s default. This is the heaviest test in the suite - many seeds
   * driven end to end through the deep generators - and it measured 5353ms against
   * the 5s default while 350 other files competed for the machine, so it failed a
   * full-suite run and passed alone. Nothing about "did any deep generator throw"
   * is expressed by a wall-clock bound, so the bound was only ever noise; a
   * generous ceiling still catches a hang. */
  it("generates valid levels across the deep profile pool", { timeout: 20_000 }, () => {
    /* Post-enablement, depth 30/60 select cavern/moria/labyrinth/lair/gauntlet/
     * hard_centre (proven by the choose() test). Drive many seeds end-to-end
     * through generateLevel and require every level to be structurally valid -
     * catches any deep generator that throws or degenerates via the pipeline.
     *
     * This deliberately does NOT assert staircase reachability. It used to (as
     * "fully-connected"), and depth 60 seed 15004 - 4 down stairs, none of them
     * reachable - is what opened that investigation. Upstream genuinely permits
     * it (BUG_FIXES.md entry 13), so asserting it here would be asserting a
     * property C does not have. Reachability is tested against the bug-fixes
     * flag instead, above. Fresh deps per seed: a shared ArtifactState /
     * race.curNum pollutes the mid-gen vault object draws. */
    for (const [depth, seeds] of [[30, 24], [60, 14]] as const) {
      for (let s = 0; s < seeds; s++) {
        const seed = 9000 + depth * 100 + s;
        const g = generateLevel(new Rng(seed), depth, makeDeps());
        expect(g.c.isPassable(g.playerSpot as Loc), `depth ${depth} seed ${seed}`).toBe(true);
        expect(g.c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
        expect(g.c.featCount[FEAT.LESS] ?? 0).toBeGreaterThanOrEqual(1);
        expect(g.monsters.length).toBeGreaterThanOrEqual(1);
        expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
      }
    }
  });

  it("selects town at depth 0 and a dungeon profile below", () => {
    const deps = makeDeps();
    expect(deps.profiles.choose(new Rng(1), 0).name).toBe("town");
    const names = new Set<string>();
    for (let s = 0; s < 40; s++) names.add(deps.profiles.choose(new Rng(s), 7).name);
    /* At depth 7 only classic/modified qualify (cavern min-level 15, moria
     * needs depth>=10, labyrinth needs depth>=13, lair/gauntlet 20, hard 50). */
    for (const n of names) expect(["classic", "modified"]).toContain(n);
  });

  it("selects the full weighted/forced profile pool at depth (choose_profile)", () => {
    const deps = makeDeps();
    /* Deep enough that every alloc>0 profile qualifies (hard centre min 50),
     * plus the labyrinth_check (>=13) and the depth 10-40 moria one_in_(40). */
    const deep = new Set<string>();
    for (let s = 0; s < 400; s++) deep.add(deps.profiles.choose(new Rng(s), 30).name);
    /* The weighted pool (cavern/classic/modified) must all appear by depth 30. */
    expect(deep.has("classic")).toBe(true);
    expect(deep.has("modified")).toBe(true);
    expect(deep.has("cavern")).toBe(true);
    /* labyrinth (forced, >=13) and moria (depth 10-40) appear across seeds. */
    expect(deep.has("labyrinth")).toBe(true);
    expect(deep.has("moria")).toBe(true);
    /* lair/gauntlet (alloc 1, min 20) qualify here; sampled across many seeds. */
    const deeper = new Set<string>();
    for (let s = 0; s < 800; s++) deeper.add(deps.profiles.choose(new Rng(s), 60).name);
    expect(deeper.has("lair") || deeper.has("gauntlet") || deeper.has("hard centre")).toBe(true);
    /* Every returned profile is a real registered builder (no throw). */
    for (const n of [...deep, ...deeper]) {
      expect(deps.profiles.hasBuilder(deps.profiles.find(n)!.builder)).toBe(true);
    }
  });

  it("generates a walkable town at depth 0", () => {
    const g = generateLevel(new Rng(7), 0, makeDeps());
    expect(g.c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
    const p = g.playerSpot as Loc;
    expect(g.c.isPassable(p)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Persistent-level staircase rooms (gen-cave.c:908-967
 * build_staircase_rooms + handle_level_stairs persistent path). The whole
 * feature is gated on dun.persist (birth_levels_persist, OFF by default), so
 * these tests drive classicGen directly with dun.persist toggled and assert
 * that with persist OFF nothing changes.
 * ------------------------------------------------------------------ */

describe("persistent-level staircase rooms", () => {
  it("places a staircase room at each seeded join connector (persist on)", () => {
    /* Seed one up-join and one down-join at fixed grids; classicGen builds on
     * the full 66x198 dungeon, so both grids are well inside. */
    const ctx = builderCtx(1, 424242);
    ctx.dun.persist = true;
    ctx.dun.join = [
      { grid: loc(20, 20), feat: FEAT.LESS },
      { grid: loc(120, 40), feat: FEAT.MORE },
    ];

    const res = classicGen(ctx);
    expect(res.gen).not.toBeNull();
    const g = res.gen as Gen;

    /* build_staircase_rooms ran once per join (gen-cave.c:934). */
    expect(g.dun.nstairRoom).toBe(2);
    /* Each connector grid carries its stair feature (buildStaircase setFeat). */
    expect(g.c.feat(loc(20, 20))).toBe(FEAT.LESS);
    expect(g.c.feat(loc(120, 40))).toBe(FEAT.MORE);
  });

  it("skips alloc_stairs for a direction whose adjacent level exists", () => {
    /* Up: neighbour above already exists (gen-cave.c:963-966) and seeded no
     * up-join here, so the finished level has zero up staircases; down stairs
     * are still allocated normally. */
    const up = builderCtx(1, 51515);
    up.dun.persist = true;
    up.dun.hasAdjacentAbove = true;
    up.dun.join = [];
    const gUp = classicGen(up).gen as Gen;
    expect(gUp).not.toBeNull();
    expect(gUp.c.featCount[FEAT.LESS] ?? 0).toBe(0);
    expect(gUp.c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);

    /* Down: mirror case (gen-cave.c:959-962). */
    const down = builderCtx(1, 51515);
    down.dun.persist = true;
    down.dun.hasAdjacentBelow = true;
    down.dun.join = [];
    const gDown = classicGen(down).gen as Gen;
    expect(gDown).not.toBeNull();
    expect(gDown.c.featCount[FEAT.MORE] ?? 0).toBe(0);
    expect(gDown.c.featCount[FEAT.LESS] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("changes nothing when persist is off (regression guard)", () => {
    /* Even with joinInfo and the adjacency flags supplied, persist:false must
     * yield a byte-identical level and build zero staircase rooms - a default
     * game is untouched. */
    const plain = generateLevel(new Rng(31337), 3, makeDeps());
    const withPersistInputs = generateLevel(new Rng(31337), 3, makeDeps(), {
      persist: false,
      joinInfo: {
        join: [{ grid: loc(20, 20), feat: FEAT.LESS }],
        oneOffAbove: [],
        oneOffBelow: [],
      },
      hasAdjacentAbove: true,
      hasAdjacentBelow: true,
    });
    expect(serialize(withPersistInputs)).toBe(serialize(plain));
    expect(withPersistInputs.dun.nstairRoom).toBe(0);
  });

  it("does not run build_staircase_rooms when persist is off", () => {
    /* Direct classicGen with dun.persist false and a non-empty join list: the
     * gated call is skipped, so no staircase rooms are placed. */
    const ctx = builderCtx(1, 424242);
    ctx.dun.persist = false;
    ctx.dun.join = [{ grid: loc(20, 20), feat: FEAT.LESS }];
    const g = classicGen(ctx).gen as Gen;
    expect(g).not.toBeNull();
    expect(g.dun.nstairRoom).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Standalone labyrinth + cavern generators (gen-cave.c labyrinth_gen /
 * cavern_gen). These profiles are not enabled for choose(), so the builders
 * are exercised directly through a hand-built CaveBuildContext.
 * ------------------------------------------------------------------ */

/** Build a CaveBuildContext for a direct builder invocation. */
function builderCtx(depth: number, seed: number): CaveBuildContext {
  const deps = makeDeps();
  const dun = new Dun(constants);
  dun.quest = false;
  dun.persist = false;
  /* labyrinth/cavern read no profile fields; any real profile suffices. */
  const profile = deps.profiles.find("classic") as DunProfile;
  return {
    rng: new Rng(seed),
    reg,
    constants,
    dun,
    profile,
    depth,
    minHeight: 1,
    minWidth: 1,
    objDeps: deps.objDeps,
    monDeps: deps.monDeps,
    rooms: deps.rooms,
  };
}

describe("labyrinth generator", () => {
  it("registers labyrinthGen as the 'labyrinth' builder (not the modified alias)", () => {
    const profiles = createDungeonProfiles(loadRecords<DunProfileRecordJson>("dungeon_profile"));
    expect(profiles.builder("labyrinth")).toBe(labyrinthGen);
    expect(profiles.builder("cavern")).toBe(cavernGen);
  });

  it("builds a connected maze with one up and one down stair, player on floor", () => {
    const built = labyrinthGen(builderCtx(20, 12345));
    expect(built.error).toBeNull();
    const g = built.gen;
    expect(g).not.toBeNull();
    if (!g) return;
    const c = g.c;

    /* Player on passable floor, fully in bounds. */
    const p = g.playerSpot as Loc;
    expect(c.inBoundsFully(p)).toBe(true);
    expect(c.isFloor(p)).toBe(true);

    /* Exactly one up and one down stair (labyrinth places a single set). */
    expect(c.featCount[FEAT.MORE] ?? 0).toBe(1);
    expect(c.featCount[FEAT.LESS] ?? 0).toBe(1);

    /* Perimeter is permanent wall. */
    for (let x = 0; x < c.width; x++) {
      expect(c.isPerm(loc(x, 0))).toBe(true);
      expect(c.isPerm(loc(x, c.height - 1))).toBe(true);
    }

    /* The maze is fully connected (a Kruskal spanning tree). */
    expect(reachableCount(g, p)).toBe(totalTraversable(g));

    /* Placed monsters/objects are in bounds and on legal squares. */
    expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
    for (const m of g.monsters) expect(c.inBoundsFully(m.grid)).toBe(true);
    for (const o of g.objects) expect(c.isObjectHolding(o.grid)).toBe(true);
  });

  it("sets light_level for a KNOWN maze and leaves it clear otherwise", () => {
    /*
     * gen-cave.c:1529-1530: `known = lit && randint0(p->depth) < 25`, and a
     * known maze sets p->upkeep->light_level (:1594), which cave_generate
     * consumes as wiz_light(chunk, p, false) (generate.c:1255-1258). At depth 13
     * `randint0(13) < 25` is always true, so `known == lit` there; at depth 200
     * both rolls are overwhelmingly false. Sample a spread of seeds and require
     * both outcomes to appear, and require the flag to track `lit`.
     */
    const flags = (depth: number): boolean[] =>
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        (seed) => (labyrinthGen(builderCtx(depth, seed)).gen as Gen).lightLevel,
      );
    /* At depth 13 randint0(13) < 25 always holds, so lit and known are both
     * unconditionally true: every shallow maze is revealed. */
    expect(flags(13)).toEqual([true, true, true, true, true, true, true, true]);
    /* Deep down both rolls bite and most mazes are not known. */
    const deep = flags(400);
    expect(deep.filter((v) => v).length).toBeLessThan(deep.length);
    /* Nothing else sets it. */
    expect((cavernGen(builderCtx(15, 424242)).gen as Gen).lightLevel).toBe(false);
    expect((classicGen(builderCtx(10, 99)).gen as Gen).lightLevel).toBe(false);
  });

  it("is deterministic run-to-run for a fixed seed", () => {
    const a = labyrinthGen(builderCtx(20, 777)).gen as Gen;
    const b = labyrinthGen(builderCtx(20, 777)).gen as Gen;
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });
});

describe("cavern generator", () => {
  it("builds a fully connected cavern with stairs and bounded monsters", () => {
    const built = cavernGen(builderCtx(15, 424242));
    expect(built.error).toBeNull();
    const g = built.gen;
    expect(g).not.toBeNull();
    if (!g) return;
    const c = g.c;

    /* Player on passable floor. */
    const p = g.playerSpot as Loc;
    expect(c.inBoundsFully(p)).toBe(true);
    expect(c.isFloor(p)).toBe(true);

    /* Down (1-3) and up (1-2) stairs were placed. */
    expect(c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
    expect(c.featCount[FEAT.LESS] ?? 0).toBeGreaterThanOrEqual(1);

    /* Perimeter is permanent wall. */
    for (let x = 0; x < c.width; x++) {
      expect(c.isPerm(loc(x, 0))).toBe(true);
      expect(c.isPerm(loc(x, c.height - 1))).toBe(true);
    }

    /* The CA + clear_small_regions + join_regions leave one connected cave. */
    expect(reachableCount(g, p)).toBe(totalTraversable(g));

    /* Monsters bounded and legally placed. */
    expect(g.monsters.length).toBeGreaterThanOrEqual(1);
    expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
    for (const m of g.monsters) expect(c.inBoundsFully(m.grid)).toBe(true);
    for (const o of g.objects) expect(c.isObjectHolding(o.grid)).toBe(true);
  });

  it("is deterministic run-to-run for a fixed seed", () => {
    const a = cavernGen(builderCtx(15, 909090)).gen as Gen;
    const b = cavernGen(builderCtx(15, 909090)).gen as Gen;
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });
});

/* ------------------------------------------------------------------ *
 * moria / lair / gauntlet generators (gen-cave.c). Registered but not enabled
 * for choose() (#80), so each is driven directly via a CaveBuildContext using
 * its own dungeon profile.
 * ------------------------------------------------------------------ */

/** builderCtx for a specific (possibly not-enabled) dungeon profile. */
function builderCtxNamed(depth: number, seed: number, profileName: string): CaveBuildContext {
  const deps = makeDeps();
  const dun = new Dun(constants);
  dun.quest = false;
  dun.persist = false;
  const rec = loadRecords<DunProfileRecordJson>("dungeon_profile").find(
    (r) => r.name === profileName,
  ) as DunProfileRecordJson;
  const profile = loadDunProfile(rec);
  return {
    rng: new Rng(seed),
    reg,
    constants,
    dun,
    profile,
    depth,
    minHeight: 1,
    minWidth: 1,
    objDeps: deps.objDeps,
    monDeps: deps.monDeps,
    rooms: deps.rooms,
  };
}

/** Assert the shared level invariants: player-on-floor, stairs, perimeter,
 * full connectivity, and bounded/legal monsters and objects. */
function assertLevelInvariants(g: Gen): void {
  const c = g.c;
  const p = g.playerSpot as Loc;
  expect(p).not.toBeNull();
  expect(c.inBoundsFully(p)).toBe(true);
  expect(c.isFloor(p)).toBe(true);

  expect(c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
  expect(c.featCount[FEAT.LESS] ?? 0).toBeGreaterThanOrEqual(1);

  for (let x = 0; x < c.width; x++) {
    expect(c.isPerm(loc(x, 0))).toBe(true);
    expect(c.isPerm(loc(x, c.height - 1))).toBe(true);
  }
  for (let y = 0; y < c.height; y++) {
    expect(c.isPerm(loc(0, y))).toBe(true);
    expect(c.isPerm(loc(c.width - 1, y))).toBe(true);
  }

  /* Fully connected: every traversable grid reachable from the player. */
  expect(reachableCount(g, p)).toBe(totalTraversable(g));

  expect(g.monsters.length).toBeGreaterThanOrEqual(1);
  expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
  for (const m of g.monsters) expect(c.inBoundsFully(m.grid)).toBe(true);
  for (const o of g.objects) expect(c.isObjectHolding(o.grid)).toBe(true);
}

/**
 * hard_centre invariants. Unlike the cavern-only builders a greater vault sits
 * at the centre; its interior may hold passable pockets sealed behind veins,
 * permanent walls or inner walls that ensure_connectedness (faithfully) refuses
 * to tunnel through. So the connectivity guarantee is over the CAVERN network,
 * not the vault interior: every NON-vault traversable grid must be reachable
 * from the player (this is exactly what connect_caverns + ensure_connectedness +
 * chunk_copy are responsible for). The vault itself must be present and the
 * player must stand on a non-vault floor.
 */
function assertHardCentreInvariants(g: Gen): void {
  const c = g.c;
  const p = g.playerSpot as Loc;
  expect(p).not.toBeNull();
  expect(c.inBoundsFully(p)).toBe(true);
  expect(c.isFloor(p)).toBe(true);
  expect(c.sqinfoHas(p, SQUARE.VAULT)).toBe(false);

  /* Stairs present. */
  expect(c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
  expect(c.featCount[FEAT.LESS] ?? 0).toBeGreaterThanOrEqual(1);

  /* Perimeter permanent rock. */
  for (let x = 0; x < c.width; x++) {
    expect(c.isPerm(loc(x, 0))).toBe(true);
    expect(c.isPerm(loc(x, c.height - 1))).toBe(true);
  }
  for (let y = 0; y < c.height; y++) {
    expect(c.isPerm(loc(0, y))).toBe(true);
    expect(c.isPerm(loc(c.width - 1, y))).toBe(true);
  }

  /* The centre vault is present (chunk_copy carried its VAULT-flagged grids). */
  let vaultCells = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (c.sqinfoHas(loc(x, y), SQUARE.VAULT)) vaultCells++;
    }
  }
  expect(vaultCells).toBeGreaterThan(0);

  /* The cavern network (non-vault traversable) is fully connected: BFS from the
   * player must reach every non-vault traversable grid. */
  const trav = (gr: Loc): boolean => c.isPassable(gr) || c.isDoor(gr) || c.isRubble(gr);
  const reached = new Uint8Array(c.width * c.height);
  const stack: Loc[] = [p];
  reached[p.y * c.width + p.x] = 1;
  const dirs = [loc(0, 1), loc(0, -1), loc(1, 0), loc(-1, 0)];
  while (stack.length) {
    const cur = stack.pop() as Loc;
    for (const d of dirs) {
      const n = loc(cur.x + d.x, cur.y + d.y);
      if (!c.inBounds(n)) continue;
      const idx = n.y * c.width + n.x;
      if (reached[idx]) continue;
      if (!trav(n)) continue;
      reached[idx] = 1;
      stack.push(n);
    }
  }
  let nonVaultTotal = 0;
  let nonVaultReached = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const gr = loc(x, y);
      if (!trav(gr) || c.sqinfoHas(gr, SQUARE.VAULT)) continue;
      nonVaultTotal++;
      if (reached[y * c.width + x]) nonVaultReached++;
    }
  }
  expect(nonVaultTotal).toBeGreaterThan(0);
  expect(nonVaultReached).toBe(nonVaultTotal);

  /* Bounded, legal monsters and objects. */
  expect(g.monsters.length).toBeGreaterThanOrEqual(1);
  expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
  for (const m of g.monsters) expect(c.inBoundsFully(m.grid)).toBe(true);
  for (const o of g.objects) expect(c.isObjectHolding(o.grid)).toBe(true);
}

describe("moria / lair / gauntlet / hard_centre generators", () => {
  it("registers the real builders (not the modified alias)", () => {
    const profiles = createDungeonProfiles(loadRecords<DunProfileRecordJson>("dungeon_profile"));
    expect(profiles.builder("moria")).toBe(moriaGen);
    expect(profiles.builder("lair")).toBe(lairGen);
    expect(profiles.builder("gauntlet")).toBe(gauntletGen);
    /* hard_centre is now a real builder (vault_chunk ported), still not enabled
     * for choose() (#80). */
    expect(profiles.builder("hard_centre")).toBe(hardCentreGen);
    expect(profiles.builder("hard_centre")).not.toBe(modifiedGen);
  });

  it("moria_gen builds a connected modified-style level with cave dwellers", () => {
    const built = moriaGen(builderCtxNamed(20, 246810, "moria"));
    expect(built.error).toBeNull();
    const g = built.gen as Gen;
    expect(g).not.toBeNull();
    assertLevelInvariants(g);
  });

  it("moria_gen is deterministic run-to-run for a fixed seed", () => {
    const a = moriaGen(builderCtxNamed(20, 13579, "moria")).gen as Gen;
    const b = moriaGen(builderCtxNamed(20, 13579, "moria")).gen as Gen;
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });

  it("lair_gen joins a modified half to a themed cavern (connected, stairs)", () => {
    const built = lairGen(builderCtxNamed(25, 55555, "lair"));
    expect(built.error).toBeNull();
    const g = built.gen as Gen;
    expect(g).not.toBeNull();
    assertLevelInvariants(g);
  });

  it("lair_gen is deterministic run-to-run for a fixed seed", () => {
    /* RE-PINNED 2026-08-07 (#143, reference/ moved to the 4.2.6 tag). The old
     * seed 24680 now aborts with "cavern chunk could not be created", which is
     * upstream behaviour and not a defect: cavern_chunk returns NULL when its
     * flood fill does not connect, lair_gen passes the NULL up, and cave_gen
     * simply re-rolls (gen-cave.c). Measured at 1 abort in 100 consecutive
     * seeds, so it is the ordinary rate and this seed was unlucky.
     *
     * The `error` assertions are new and are the point of the re-pin: the old
     * test cast `.gen as Gen` with no check, so an abort surfaced as
     * "Cannot read properties of null" from a helper three frames away instead
     * of naming what happened. */
    const ra = lairGen(builderCtxNamed(25, 24681, "lair"));
    const rb = lairGen(builderCtxNamed(25, 24681, "lair"));
    expect(ra.error, "the pinned seed must BUILD before it can be compared").toBeNull();
    expect(rb.error).toBeNull();
    const a = ra.gen as Gen;
    const b = rb.gen as Gen;
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });

  it("lair_gen under persist splits on a join-free seam and lands both halves' stairs", () => {
    /* lair_gen is the one multi-region builder that SUPPORTS persistent levels
     * (labyrinth, gauntlet and hard_centre all refuse outright). It has to do
     * two things the port was not doing: pick the seam with
     * find_joinfree_vertical_seam so the split does not cut a staircase in
     * half, and translate the level-wide connector list into each half's own
     * coordinates with transform_join_list before building it.
     *
     * Without the second, both halves were handed the level-wide list and
     * build_staircase_rooms was asked to place a room at a column outside the
     * half it was building - an abort, not a wrong layout. */
    const ctx = builderCtxNamed(25, 20260806, "lair");
    ctx.dun.persist = true;
    ctx.dun.join = [
      { grid: loc(20, 15), feat: FEAT.LESS },
      { grid: loc(100, 30), feat: FEAT.MORE },
    ];

    const built = lairGen(ctx);
    expect(built.error).toBeNull();
    const g = built.gen as Gen;
    expect(g).not.toBeNull();

    /* Both connectors are in the finished, merged level at their ORIGINAL
     * level-wide grids: the transform into each half and the chunk_copy back
     * out are inverses. */
    expect(g.c.isUpstairs(loc(20, 15))).toBe(true);
    expect(g.c.isDownstairs(loc(100, 30))).toBe(true);

    /* The seam did not cut through either staircase's column. */
    assertLevelInvariants(g);
  });

  it("lair_gen under persist moves the seam off an occupied middle column", () => {
    /* The seam search only earns its keep when the natural midpoint is taken.
     * The level width is DERIVED, not written down: build once with no
     * connectors to learn it (the width is drawn before any join is read, so
     * the same seed gives the same width), then rebuild with a connector
     * sitting exactly on x_size / 2 - the column a plain down-the-middle split
     * would cut. */
    const probe = lairGen(builderCtxNamed(25, 616161, "lair")).gen as Gen;
    const mid = Math.trunc(probe.c.width / 2);

    const ctx = builderCtxNamed(25, 616161, "lair");
    ctx.dun.persist = true;
    ctx.dun.join = [{ grid: loc(mid, 20), feat: FEAT.LESS }];

    const built = lairGen(ctx);
    expect(built.error).toBeNull();
    const g = built.gen as Gen;
    expect(g.c.width).toBe(probe.c.width);
    expect(g.c.isUpstairs(loc(mid, 20))).toBe(true);
  });

  it("lair_gen leaves dun.join untouched for its caller", () => {
    /* Upstream caches dun->join, swaps in a transformed list per half, and
     * restores the cached one (L3592-3614). The level's own join list is the
     * untransformed one, so a builder that left a half's list behind would
     * corrupt the next level's stair alignment. */
    const ctx = builderCtxNamed(25, 4242, "lair");
    ctx.dun.persist = true;
    const seeded = [{ grid: loc(30, 20), feat: FEAT.LESS }];
    ctx.dun.join = seeded;

    lairGen(ctx);

    expect(ctx.dun.join).toBe(seeded);
    expect(ctx.dun.join).toEqual([{ grid: loc(30, 20), feat: FEAT.LESS }]);
  });

  it("gauntlet_gen splits two caverns with an unmappable labyrinth (connected)", () => {
    const built = gauntletGen(builderCtxNamed(30, 99887, "gauntlet"));
    expect(built.error).toBeNull();
    const g = built.gen as Gen;
    expect(g).not.toBeNull();
    assertLevelInvariants(g);
    /* The labyrinth carries SQUARE_NO_MAP; the left cavern SQUARE_NO_TELEPORT. */
    let noMap = 0;
    let noTele = 0;
    for (let y = 0; y < g.c.height; y++) {
      for (let x = 0; x < g.c.width; x++) {
        if (g.c.sqinfoHas(loc(x, y), SQUARE.NO_MAP)) noMap++;
        if (g.c.sqinfoHas(loc(x, y), SQUARE.NO_TELEPORT)) noTele++;
      }
    }
    expect(noMap).toBeGreaterThan(0);
    expect(noTele).toBeGreaterThan(0);
  });

  it("gauntlet_gen is deterministic run-to-run for a fixed seed", () => {
    const a = gauntletGen(builderCtxNamed(30, 31415, "gauntlet")).gen as Gen;
    const b = gauntletGen(builderCtxNamed(30, 31415, "gauntlet")).gen as Gen;
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });

  it("hard_centre_gen wraps a greater vault in four connected caverns", () => {
    const built = hardCentreGen(builderCtxNamed(55, 222, "hard centre"));
    expect(built.error).toBeNull();
    const g = built.gen as Gen;
    expect(g).not.toBeNull();
    assertHardCentreInvariants(g);
  });

  it("hard_centre_gen is deterministic run-to-run for a fixed seed", () => {
    const a = hardCentreGen(builderCtxNamed(55, 555, "hard centre")).gen as Gen;
    const b = hardCentreGen(builderCtxNamed(55, 555, "hard centre")).gen as Gen;
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });

  it("hard_centre_gen produces connected caverns for several seeds", () => {
    for (const seed of [222, 555, 777]) {
      const built = hardCentreGen(builderCtxNamed(55, seed, "hard centre"));
      expect(built.error).toBeNull();
      assertHardCentreInvariants(built.gen as Gen);
    }
  });
});

describe("connect_caverns (gen-cave.c L3249)", () => {
  it("joins four separate caverns into one connected region", () => {
    const w = 44;
    const h = 22;
    const c = new Chunk(reg, h, w);
    c.depth = 10;
    const dun = new Dun(constants);
    const g = new Gen(c, new Rng(1), reg, constants, dun, null, null);

    /* Perma border, granite interior. */
    fillRectangle(c, 1, 1, h - 2, w - 2, FEAT.GRANITE, SQUARE.WALL_SOLID);
    drawRectangle(c, 0, 0, h - 1, w - 1, FEAT.PERM, SQUARE.NONE, true);

    /* Four floor pockets, well separated by granite (order: L, U, Lo, R). */
    const carve = (y1: number, x1: number, y2: number, x2: number): void => {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) c.setFeat(loc(x, y), FEAT.FLOOR);
    };
    carve(2, 2, 19, 7); // left
    carve(2, 16, 8, 27); // upper
    carve(13, 16, 19, 27); // lower
    carve(2, 36, 19, 41); // right

    const floor: Loc[] = [loc(4, 10), loc(21, 5), loc(21, 16), loc(38, 10)];
    /* Precondition: the four samples start in four distinct regions. */
    expect(reachableCount(g, floor[0] as Loc)).toBeLessThan(totalTraversable(g));

    connectCaverns(g, floor);

    /* Every sample is now reachable from the first, 4-connected. */
    const reachable = reachableCount(g, floor[0] as Loc);
    expect(reachable).toBe(totalTraversable(g));
  });
});

/* ------------------------------------------------------------------ *
 * Faithful town generation (gen-cave.c town_gen_layout / town_gen).
 * ------------------------------------------------------------------ */

/** Serialize only the terrain grid + player spot (time-of-day independent). */
function serializeFeats(g: Gen): string {
  const c = g.c;
  const feats: number[] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) feats.push(c.feat(loc(x, y)));
  }
  return `${c.width}x${c.height}|${g.playerSpot?.x},${g.playerSpot?.y}|${feats.join(",")}`;
}

/** An Rng that counts every consuming draw (Rand_div with m > 1). */
class CountingRng extends Rng {
  draws = 0;
  override randDiv(m: number): number {
    if (m > 1) this.draws++;
    return super.randDiv(m);
  }
}

describe("faithful town generation", () => {
  it("is identical run-to-run for a fixed seed (determinism)", () => {
    const a = generateLevel(new Rng(7), 0, makeDeps(), { daytime: true });
    const b = generateLevel(new Rng(7), 0, makeDeps(), { daytime: true });
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
  });

  it("lays all store entrances, one down stair, and the player on it", () => {
    const g = generateLevel(new Rng(7), 0, makeDeps(), { daytime: true });
    const c = g.c;

    /* Exactly one down stair (the single north-wall crossroads head). */
    expect(c.featCount[FEAT.MORE] ?? 0).toBe(1);

    /* Player placed on that stair (player_place(c, p, pgrid)). */
    const p = g.playerSpot as Loc;
    expect(c.feat(p)).toBe(FEAT.MORE);
    expect(c.inBoundsFully(p)).toBe(true);
    expect(c.isPassable(p)).toBe(true);

    /* All eight shop entrances present, exactly one of each feature. */
    for (const feat of TOWN_STORE_FEATS) {
      expect(c.featCount[feat] ?? 0).toBe(1);
    }

    /* Perimeter is permanent wall. */
    for (let x = 0; x < c.width; x++) {
      expect(c.isPerm(loc(x, 0))).toBe(true);
      expect(c.isPerm(loc(x, c.height - 1))).toBe(true);
    }
  });

  it("has a time-of-day-independent layout (illumination/residents come after)", () => {
    /* cave_illuminate sets info flags and residents place monsters; neither
     * touches terrain, so the feature grid + player spot are identical. */
    const day = generateLevel(new Rng(11), 0, makeDeps(), { daytime: true });
    const night = generateLevel(new Rng(11), 0, makeDeps(), { daytime: false });
    expect(serializeFeats(day)).toBe(serializeFeats(night));
  });

  it("places town_monsters_day residents by day (a non-empty town)", () => {
    expect(constants.townMonstersDay).toBe(4);
    expect(constants.townMonstersNight).toBe(8);
    const g = generateLevel(new Rng(7), 0, makeDeps(), { daytime: true });
    /* The 4 daytime pick_and_place_distant_monster calls seed the town. */
    expect(g.monsters.length).toBeGreaterThanOrEqual(1);
  });

  it("consumes the exact RNG draw count of the faithful layout", () => {
    /* A regression guard on RNG draw ORDER and COUNT: any extra, missing or
     * reordered draw in town_gen_layout / build_streamer / starburst /
     * build_store / build_ruin / residents changes this number. Includes each
     * resident's mon_create_drop at placement (mon-make.c place_monster
     * L1044-1046; town residents are placed with ORIGIN_DROP via
     * pick_and_place_distant_monster, mon-make.c L1515). */
    const rng = new CountingRng(7);
    generateLevel(rng, 0, makeDeps(), { daytime: true });
    expect(rng.draws).toBe(TOWN_DRAW_COUNT_SEED7_DAY);
  });
});

/** Observed faithful draw count for seed 7, daytime (layout + residents,
 * including each resident's placement-time mon_create_drop draws). */
const TOWN_DRAW_COUNT_SEED7_DAY = 1608;

/* ------------------------------------------------------------------ *
 * Mod-registered custom room builder (moddability pillar).
 * ------------------------------------------------------------------ */

describe("mod-registered room builder", () => {
  it("builds a level using a runtime-registered custom builder", () => {
    let customRuns = 0;
    const rooms = createRoomRegistry({ templates: roomTemplates, vaults });
    /* A mod adds a brand-new builder that upstream does not have. */
    rooms.register("mod_bunker", (g, centre) => {
      customRuns++;
      const y1 = centre.y - 2;
      const x1 = centre.x - 2;
      const y2 = centre.y + 2;
      const x2 = centre.x + 2;
      generateRoom(g.c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, true);
      drawRectangle(g.c, y1 - 1, x1 - 1, y2 + 1, x2 + 1, FEAT.GRANITE, SQUARE.WALL_OUTER, false);
      fillRectangle(g.c, y1, x1, y2, x2, FEAT.FLOOR, SQUARE.NONE);
      return true;
    });
    expect(rooms.has("mod_bunker")).toBe(true);

    /* A mod profile that references the custom builder via the classic
     * builder's block-based room allocation. */
    const customRoom: RoomProfile = {
      name: "mod bunker",
      builder: "mod_bunker",
      rating: 0,
      height: 11,
      width: 33,
      level: 0,
      pit: false,
      rarity: 0,
      cutoff: 100,
    };
    const profile: DunProfile = {
      name: "modtest",
      builder: "classic",
      blockSize: 11,
      dunRooms: 50,
      dunUnusual: 200,
      maxRarity: 0,
      tun: { rnd: 10, chg: 30, con: 15, pen: 25, jct: 50 },
      str: { den: 5, rng: 2, mag: 3, mc: 90, qua: 2, qc: 40 },
      roomProfiles: [customRoom],
      minLevel: 0,
      alloc: 100,
    };

    const profiles = new DungeonProfiles();
    const base = createDungeonProfiles(loadRecords<DunProfileRecordJson>("dungeon_profile"));
    profiles.registerBuilder("classic", base.builder("classic"));
    profiles.addProfile(profile);

    const objReg = new ObjRegistry(objPack);
    const objAlloc = new ObjAllocState(objReg, constants);
    const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
    const table = new MonAllocTable(monReg.races, { maxDepth: constants.maxDepth });

    const deps: GenDeps = {
      reg,
      constants,
      rooms,
      profiles,
      objDeps: {
        reg: objReg,
        alloc: objAlloc,
        constants,
        artifacts: new ArtifactState(objReg.artifacts.length),
        noArtifacts: false,
      },
      monDeps: { table, pits: resolvePits(monReg) },
    };

    const g = generateLevel(new Rng(55), 5, deps);
    expect(customRuns).toBeGreaterThan(0);
    /* The modded level is still valid and fully connected. */
    const p = g.playerSpot as Loc;
    expect(g.c.isFloor(p)).toBe(true);
    expect(reachableCount(g, p)).toBe(totalTraversable(g));
  });
});

/* ------------------------------------------------------------------ *
 * Monster group placement (mon-make.c place_new_monster family).
 * ------------------------------------------------------------------ */

describe("place_new_monster groups and friends", () => {
  const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
  const table = new MonAllocTable(monReg.races, { maxDepth: constants.maxDepth });

  /** An open floor arena with a granite border, monster deps wired. */
  function openGen(depth: number, seed: number): Gen {
    const c = new Chunk(reg, 25, 40);
    c.depth = depth;
    drawRectangle(c, 0, 0, 24, 39, FEAT.GRANITE, SQUARE.NONE, false);
    fillRectangle(c, 1, 1, 23, 38, FEAT.FLOOR, SQUARE.NONE);
    const dun = new Dun(constants);
    return new Gen(c, new Rng(seed), reg, constants, dun, null, { table });
  }

  /* The urchin's "friends:100:3d4:Same" line always brings company. */
  const urchin = monReg.races.find((r) => r.name === "filthy street urchin")!;

  it("places a same-race group led by the placed monster", () => {
    const g = openGen(5, 42);
    const ok = placeNewMonster(g, loc(20, 12), urchin, false, true, {
      index: 0,
      role: MON_GROUP.LEADER,
    });
    expect(ok).toBe(true);

    /* 3d4 same-race friends at full strength (depth 5 vs level 0). */
    expect(g.monsters.length).toBeGreaterThanOrEqual(4);

    const leader = g.monsters[0]!.mon;
    const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!;
    expect(gi.index).toBeGreaterThan(0);
    expect(gi.role).toBe(MON_GROUP.LEADER);

    /* Every friend (same race or 50%-chance cats/dogs) shares the group. */
    for (const pm of g.monsters.slice(1)) {
      const info = pm.mon.groupInfo[GROUP_TYPE.PRIMARY]!;
      expect(info.index).toBe(gi.index);
      expect(info.role).not.toBe(MON_GROUP.LEADER);
    }
  });

  it("group_ok=false places exactly one monster", () => {
    const g = openGen(5, 42);
    const ok = placeNewMonster(g, loc(20, 12), urchin, false, false, {
      index: 0,
      role: MON_GROUP.LEADER,
    });
    expect(ok).toBe(true);
    expect(g.monsters.length).toBe(1);
  });

  it("separate placements get distinct group indices", () => {
    const g = openGen(5, 7);
    placeNewMonster(g, loc(5, 5), urchin, false, false, {
      index: 0,
      role: MON_GROUP.LEADER,
    });
    placeNewMonster(g, loc(30, 18), urchin, false, false, {
      index: 0,
      role: MON_GROUP.LEADER,
    });
    const a = g.monsters[0]!.mon.groupInfo[GROUP_TYPE.PRIMARY]!.index;
    const b = g.monsters[1]!.mon.groupInfo[GROUP_TYPE.PRIMARY]!.index;
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it("base-template escorts join the leader's group", () => {
    /* A race with friends-base lines (e.g. a person-escorted leader). */
    const escorted = monReg.races.find(
      (r) => r.friendsBase.length > 0 && r.friends.length === 0,
    );
    expect(escorted).toBeDefined();
    if (!escorted) return;

    /* The escort lines are percent-chance gated; scan seeds until one
     * fires so the assertion is on structure, not luck. */
    for (let seed = 1; seed <= 20; seed++) {
      const g = openGen(escorted.level + 5, seed);
      placeNewMonster(g, loc(20, 12), escorted, false, true, {
        index: 0,
        role: MON_GROUP.LEADER,
      });
      if (g.monsters.length > 1) {
        const gi = g.monsters[0]!.mon.groupInfo[GROUP_TYPE.PRIMARY]!.index;
        const bases = new Set(escorted.friendsBase.map((fb) => fb.base));
        for (const pm of g.monsters.slice(1)) {
          expect(pm.mon.groupInfo[GROUP_TYPE.PRIMARY]!.index).toBe(gi);
          expect(bases.has(pm.mon.race.base)).toBe(true);
        }
        return;
      }
    }
    throw new Error("no seed produced an escort in 20 tries");
  });
});

/* ------------------------------------------------------------------ *
 * Generation-spawned object-mimics (mon-make.c place_monster L1044-1051,
 * mon_create_mimicked_object L899). The generation placement path is the twin
 * of place_new_monster_one -> place_monster, so the mimic's fake object must be
 * created here, at the position that corresponds to just after mon_create_drop
 * (which draws zero RNG for the drop-less vanilla mimic races).
 * ------------------------------------------------------------------ */

describe("generation object-mimics (mon-make.c place_monster L1044-1051)", () => {
  const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
  const table = new MonAllocTable(monReg.races, { maxDepth: constants.maxDepth });
  const mimicObjReg = new ObjRegistry(objPack);

  /** An open floor arena with obj + mon deps wired. */
  function mimicGen(depth: number, seed: number): Gen {
    const c = new Chunk(reg, 25, 40);
    c.depth = depth;
    drawRectangle(c, 0, 0, 24, 39, FEAT.GRANITE, SQUARE.NONE, false);
    fillRectangle(c, 1, 1, 23, 38, FEAT.FLOOR, SQUARE.NONE);
    const dun = new Dun(constants);
    const objDeps: MakeDeps = {
      reg: mimicObjReg,
      alloc: new ObjAllocState(mimicObjReg, constants),
      constants,
      artifacts: new ArtifactState(mimicObjReg.artifacts.length),
      noArtifacts: false,
    };
    return new Gen(c, new Rng(seed), reg, constants, dun, objDeps, { table });
  }

  function mimicRace(name: string): MonsterRace {
    const r = monReg.races.find((x) => x.name === name);
    if (!r || r.mimicKinds.length === 0) {
      throw new Error(`no object-mimic race "${name}" in the pack`);
    }
    return r;
  }

  it("links a generated object-mimic to a fake object on its own grid", () => {
    const g = mimicGen(3, 42);
    const grid = loc(20, 12);
    const ok = placeNewMonster(
      g,
      grid,
      mimicRace("creeping copper coins"),
      false,
      false,
      { index: 0, role: MON_GROUP.LEADER },
    );
    expect(ok).toBe(true);
    expect(g.monsters).toHaveLength(1);

    const mon = g.monsters[0]!.mon;
    expect(mon.mimickedObj).not.toBe(0);

    /* Exactly one generated object, on the monster's grid, linked back by
     * the monster's (generation = live) midx. */
    expect(g.objects).toHaveLength(1);
    const fake = g.objects[0]!;
    expect(fake.grid).toEqual(grid);
    expect(fake.obj.mimickingMIdx).toBe(mon.midx);
    expect(g.hasObject(grid)).toBe(true);
  });

  it("a non-mimic monster gets no fake object and mimickedObj stays 0", () => {
    const g = mimicGen(3, 42);
    const plain = monReg.races.find((r) => r.name === "filthy street urchin")!;
    /* group_ok=false so the urchin's friends line draws nothing. */
    const ok = placeNewMonster(g, loc(20, 12), plain, false, false, {
      index: 0,
      role: MON_GROUP.LEADER,
    });
    expect(ok).toBe(true);
    expect(g.objects).toHaveLength(0);
    expect(g.monsters[0]!.mon.mimickedObj).toBe(0);
  });

  it("draws the mimic object in exactly upstream generation-RNG order", () => {
    const g = mimicGen(3, 99);
    const race = mimicRace("potion mimic"); // 6 kinds -> reservoir draws
    const grid = loc(20, 12);

    /* Attach the monster directly so the snapshot lands at exactly the
     * create-drop position (i.e. after createMonster's draws), isolating the
     * mimic object's stream from the monster-construction stream. */
    const mon = createMonster(g.rng, race, {
      sleep: false,
      moveEnergy: constants.moveEnergy,
      groupIndex: 0,
      groupRole: MON_GROUP.LEADER,
    });
    g.attachMonster(grid, mon, g.nextMonIndex());

    const snapshot = g.rng.getState();
    createMimickedObject(
      {
        depth: g.c.depth,
        rng: g.rng,
        makeDeps: g.objDeps!,
        carry: (cg, o) => {
          g.addObject(cg, o);
          return true;
        },
      },
      mon,
    );
    const fake = g.objects[g.objects.length - 1]!.obj;
    const endState = g.rng.getState();

    /* Independent replay of the exact C sequence from the same snapshot. */
    g.rng.setState(snapshot);
    const resolve = (m: { tval: string; sval: string }) => {
      const tval = tvalFindIdx(m.tval);
      return mimicObjReg.lookupKind(tval, mimicObjReg.lookupSval(tval, m.sval))!;
    };
    const kinds = race.mimicKinds;
    let kind = resolve(kinds[0]!);
    let i = 1;
    for (const mk of kinds) {
      if (g.rng.oneIn(i)) kind = resolve(mk);
      i++;
    }
    const expected = objectPrep(
      g.rng,
      mimicObjReg,
      constants,
      kind,
      race.level,
      "randomise",
    );
    applyMagic(
      g.rng,
      g.objDeps!,
      expected,
      race.level,
      true,
      false,
      false,
      false,
      g.c.depth,
    );

    /* Same draw sequence (final RNG states match) and same selected kind. */
    expect(endState).toEqual(g.rng.getState());
    expect(fake.kind).toBe(kind);
    expect(fake.sval).toBe(expected.sval);
  });
});

/* ------------------------------------------------------------------ *
 * Themed pits / nests (gen-room.c build_pit / build_nest) and vault
 * racial-symbol monsters (gen-monster.c get_vault_monsters, item #75).
 * ------------------------------------------------------------------ */

describe("themed pits, nests and vault monsters", () => {
  const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
  const pits = resolvePits(monReg);
  const rooms = createRoomRegistry({ templates: roomTemplates, vaults });

  /** A large granite-bordered arena with obj + mon (+ pit) deps wired. */
  function themedGen(depth: number, seed: number): Gen {
    const c = new Chunk(reg, 25, 50);
    c.depth = depth;
    const dun = new Dun(constants);
    const objReg = new ObjRegistry(objPack);
    const objDeps: MakeDeps = {
      reg: objReg,
      alloc: new ObjAllocState(objReg, constants),
      constants,
      artifacts: new ArtifactState(objReg.artifacts.length),
      noArtifacts: false,
    };
    const table = new MonAllocTable(monReg.races, { maxDepth: constants.maxDepth });
    return new Gen(c, new Rng(seed), reg, constants, dun, objDeps, { table, pits });
  }

  function monSig(g: Gen): string {
    return g.monsters
      .map((m) => `${m.grid.x},${m.grid.y}:${m.mon.race.ridx}`)
      .join("|");
  }

  it("set_pit_type is deterministic and respects room type", () => {
    const a = setPitType(new Rng(99), pits, 40, 1);
    const b = setPitType(new Rng(99), pits, 40, 1);
    expect(a.name).toBe(b.name);
    expect(a.roomType).toBe(1);
    const nest = setPitType(new Rng(99), pits, 40, 2);
    expect(nest.roomType).toBe(2);
  });

  it("mon_pit_hook accepts theme members and rejects uniques/off-theme", () => {
    const orc = pits.find((p) => p.name === "Orc")!;
    const hook = monPitHook(orc);
    const orcRace = monReg.races.find(
      (r) => r.base.name === "orc" && !r.flags.has(RF.UNIQUE),
    )!;
    expect(hook(orcRace)).toBe(true);
    /* A unique orc (e.g. an orc boss) is rejected. */
    const uniqueOrc = monReg.races.find(
      (r) => r.base.name === "orc" && r.flags.has(RF.UNIQUE),
    );
    if (uniqueOrc) expect(hook(uniqueOrc)).toBe(false);
    /* An off-base race is rejected. */
    const nonOrc = monReg.races.find((r) => r.base.name !== "orc" && r.rarity)!;
    expect(hook(nonOrc)).toBe(false);
  });

  it("builds a deterministic pit, depth-sorted with no uniques", () => {
    const a = themedGen(30, 20260713);
    const okA = rooms.get("pit")(a, loc(25, 12), 0);
    expect(okA).toBe(true);
    expect(a.monsters.length).toBeGreaterThan(0);

    /* Run-to-run determinism for a fixed seed. */
    const b = themedGen(30, 20260713);
    rooms.get("pit")(b, loc(25, 12), 0);
    expect(monSig(a)).toBe(monSig(b));

    /* Pits never contain uniques. */
    for (const m of a.monsters) {
      expect(m.mon.race.flags.has(RF.UNIQUE)).toBe(false);
    }

    /* Ordered: the centre monster (placed first, what[7]) is the deepest;
     * the first ring monster (placed second, what[0]) is the shallowest. */
    expect(a.monsters[0]!.mon.race.level).toBeGreaterThanOrEqual(
      a.monsters[1]!.mon.race.level,
    );
    /* The leader carries a group; the centre is at the room centre. */
    expect(a.monsters[0]!.grid).toEqual(loc(25, 12));
  });

  it("builds a deterministic nest with no uniques (disordered fill)", () => {
    const a = themedGen(20, 555);
    const okA = rooms.get("nest")(a, loc(25, 12), 0);
    expect(okA).toBe(true);
    expect(a.monsters.length).toBeGreaterThan(0);

    const b = themedGen(20, 555);
    rooms.get("nest")(b, loc(25, 12), 0);
    expect(monSig(a)).toBe(monSig(b));

    for (const m of a.monsters) {
      expect(m.mon.race.flags.has(RF.UNIQUE)).toBe(false);
    }
    /* Disordered: when the theme spans more than one level, the placed-order
     * sequence of levels is not the monotonic radial ordering a pit produces. */
    const levels = a.monsters.map((m) => m.mon.race.level);
    if (new Set(levels).size > 1) {
      const sortedAsc = levels.every((v, i) => i === 0 || levels[i - 1]! <= v);
      expect(sortedAsc).toBe(false);
    }
  });

  it("places vault racial-symbol monsters of the matching base (item #75)", () => {
    /* Pick a real low-depth base symbol and require every placed monster to
     * share that base template. */
    const seed = monReg.races.find(
      (r) => r.level > 0 && r.level <= 8 && /^[a-z]$/.test(r.base.glyph) && !r.flags.has(RF.UNIQUE),
    )!;
    const sym = seed.base.glyph;

    const g = themedGen(6, 4242);
    const c = g.c;
    /* A floor arena so the placement squares are empty. */
    for (let y = 1; y < c.height - 1; y++) {
      for (let x = 1; x < c.width - 1; x++) c.setFeat(loc(x, y), FEAT.FLOOR);
    }
    /* Three grids in a 3-wide rectangle carry the racial symbol. */
    const marks = new Set([`${10},${10}`, `${12},${10}`, `${11},${11}`]);
    const w = 3;
    const dataCharAt = (t: number): string => {
      const gx = 10 + (t % w);
      const gy = 10 + Math.trunc(t / w);
      return marks.has(`${gx},${gy}`) ? sym : ".";
    };
    getVaultMonsters(g, [sym], "Lesser vault", dataCharAt, 10, 11, 10, 12);

    expect(g.monsters.length).toBeGreaterThan(0);
    for (const m of g.monsters) {
      expect(m.mon.race.base.glyph).toBe(sym);
      /* placed on one of the racial-symbol grids. */
      expect(marks.has(`${m.grid.x},${m.grid.y}`)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Level feeling lifecycle (item #74): gen-util.c place_object's obj_rating,
 * mon-make.c place_new_monster_one's add_to_monster_rating, generate.c
 * place_feeling / calc_obj_feeling / calc_mon_feeling.
 * ------------------------------------------------------------------ */

describe("level feeling: calc_obj_feeling / calc_mon_feeling ladders", () => {
  function feelGen(depth: number): Gen {
    const c = new Chunk(reg, 10, 10);
    c.depth = depth;
    const dun = new Dun(constants);
    return new Gen(c, new Rng(1), reg, constants, dun, null, null);
  }

  it("both return 0 in town regardless of rating", () => {
    const g = feelGen(0);
    g.c.objRating = 999999;
    g.c.monRating = 999999;
    g.c.goodItem = true;
    expect(calcObjFeeling(g, false)).toBe(0);
    expect(calcObjFeeling(g, true)).toBe(0);
    expect(calcMonFeeling(g)).toBe(0);
  });

  it("calc_obj_feeling: birth_lose_arts gives the special 'easily lost' feeling", () => {
    const g = feelGen(10);
    g.c.goodItem = true;
    g.c.objRating = 0;
    expect(calcObjFeeling(g, true)).toBe(10);
    /* Without the option, the good-item floor applies instead. */
    expect(calcObjFeeling(g, false)).toBe(60);
  });

  it("calc_obj_feeling: a good item floors the feeling at 60 when rating is low", () => {
    const g = feelGen(1);
    g.c.goodItem = true;
    g.c.objRating = 5; /* x = 5 < 641 */
    expect(calcObjFeeling(g, false)).toBe(60);
  });

  it("calc_obj_feeling ladder (depth 1, no good item)", () => {
    const g = feelGen(1);
    const cases: Array<[number, number]> = [
      [200000, 20],
      [50000, 30],
      [15000, 40],
      [3000, 50],
      [700, 60],
      [200, 70],
      [50, 80],
      [15, 90],
      [5, 100],
    ];
    for (const [rating, expected] of cases) {
      g.c.objRating = rating;
      expect(calcObjFeeling(g, false)).toBe(expected);
    }
  });

  it("calc_mon_feeling ladder (depth 1)", () => {
    const g = feelGen(1);
    const cases: Array<[number, number]> = [
      [8000, 1],
      [5000, 2],
      [3000, 3],
      [2000, 4],
      [900, 5],
      [500, 6],
      [200, 7],
      [60, 8],
      [5, 9],
    ];
    for (const [rating, expected] of cases) {
      g.c.monRating = rating;
      expect(calcMonFeeling(g)).toBe(expected);
    }
  });
});

describe("level feeling: place_feeling", () => {
  it("scatters up to feelingTotal FEEL marks on passable, non-damaging grids and resets feeling_squares", () => {
    const c = new Chunk(reg, 25, 40);
    c.depth = 5;
    drawRectangle(c, 0, 0, 24, 39, FEAT.GRANITE, SQUARE.NONE, false);
    fillRectangle(c, 1, 1, 23, 38, FEAT.FLOOR, SQUARE.NONE);
    const dun = new Dun(constants);
    const g = new Gen(c, new Rng(9), reg, constants, dun, null, null);
    c.feelingSquares = 7;

    placeFeeling(g);

    let marked = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const grid = loc(x, y);
        if (c.sqinfoHas(grid, SQUARE.FEEL)) {
          marked++;
          expect(c.allowsFeel(grid)).toBe(true);
        }
      }
    }
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThanOrEqual(constants.feelingTotal);
    expect(c.feelingSquares).toBe(0);
  });
});

describe("level feeling: obj_rating / mon_rating accumulation", () => {
  function objArena(depth: number, seed: number): Gen {
    const c = new Chunk(reg, 30, 50);
    c.depth = depth;
    drawRectangle(c, 0, 0, 29, 49, FEAT.GRANITE, SQUARE.NONE, false);
    fillRectangle(c, 1, 1, 28, 48, FEAT.FLOOR, SQUARE.NONE);
    const dun = new Dun(constants);
    const objReg = new ObjRegistry(objPack);
    const objDeps: MakeDeps = {
      reg: objReg,
      alloc: new ObjAllocState(objReg, constants),
      constants,
      artifacts: new ArtifactState(objReg.artifacts.length),
      noArtifacts: false,
    };
    return new Gen(c, new Rng(seed), reg, constants, dun, objDeps, null);
  }

  it("place_object accumulates a positive obj_rating, RNG-free beyond make_object's own draws", () => {
    const g = objArena(10, 99);
    expect(g.c.objRating).toBe(0);
    let x = 1;
    let y = 1;
    for (let i = 0; i < 40; i++) {
      placeObject(g, loc(x, y), 10, false, false, 0, ORIGIN.FLOOR);
      x += 1;
      if (x > 47) {
        x = 1;
        y += 1;
      }
    }
    expect(g.c.objRating).toBeGreaterThan(0);
  });

  it("place_object sets good_item when an artifact lands", () => {
    let hit = false;
    for (let seed = 1; seed < 4000 && !hit; seed++) {
      const g = objArena(50, seed);
      placeObject(g, loc(5, 5), 50, true, false, 0, ORIGIN.FLOOR);
      const placed = g.objects[0];
      if (placed && placed.obj.artifact) {
        hit = true;
        expect(g.c.goodItem).toBe(true);
      }
    }
    expect(hit).toBe(true);
  });

  it("place_new_monster_one accumulates mon_rating exactly (level^2, plus the OOD bonus)", () => {
    const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
    const race = monReg.races.find((r) => r.level > 10);
    expect(race).toBeDefined();
    if (!race) return;
    const depth = Math.max(1, race.level - 5); /* guarantee race.level > depth (OOD) */

    const c = new Chunk(reg, 25, 40);
    c.depth = depth;
    drawRectangle(c, 0, 0, 24, 39, FEAT.GRANITE, SQUARE.NONE, false);
    fillRectangle(c, 1, 1, 23, 38, FEAT.FLOOR, SQUARE.NONE);
    const dun = new Dun(constants);
    const table = new MonAllocTable(monReg.races, { maxDepth: constants.maxDepth });
    const g = new Gen(c, new Rng(321), reg, constants, dun, null, { table });

    expect(g.c.monRating).toBe(0);
    const ok = placeNewMonster(g, loc(20, 12), race, false, false, {
      index: 0,
      role: MON_GROUP.LEADER,
    });
    expect(ok).toBe(true);

    const base = race.level * race.level;
    expect(race.level).toBeGreaterThan(depth);
    const ood = (race.level - depth) * race.level * race.level;
    expect(g.c.monRating).toBe(base + ood);
  });
});

describe("level feeling: full generation wiring (generate.c cave_generate L1235-1241)", () => {
  it("town gets feeling 0 and no FEEL squares are drawn", () => {
    const g = generateLevel(new Rng(7), 0, makeDeps());
    expect(g.c.feeling).toBe(0);
    for (let y = 0; y < g.c.height; y++) {
      for (let x = 0; x < g.c.width; x++) {
        expect(g.c.sqinfoHas(loc(x, y), SQUARE.FEEL)).toBe(false);
      }
    }
  });

  it("a dungeon level places FEEL squares and computes feeling from the calc functions", () => {
    const g = generateLevel(new Rng(4242), 5, makeDeps());
    let marked = 0;
    for (let y = 0; y < g.c.height; y++) {
      for (let x = 0; x < g.c.width; x++) {
        if (g.c.sqinfoHas(loc(x, y), SQUARE.FEEL)) marked++;
      }
    }
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThanOrEqual(constants.feelingTotal);
    expect(g.c.feelingSquares).toBe(0);
    expect(g.c.feeling).toBe(calcObjFeeling(g, false) + calcMonFeeling(g));
  });

  it("place_feeling's trailing draws do not alter room/monster/object content on a fixed seed", () => {
    const seed = 20260709;
    const depth = 5;
    const withFeeling = generateLevel(new Rng(seed), depth, makeDeps());

    const depsNoFeel = makeDeps();
    depsNoFeel.constants = { ...depsNoFeel.constants, feelingTotal: 0 };
    const withoutFeelingDraws = generateLevel(new Rng(seed), depth, depsNoFeel);

    /* Terrain + player spot are byte-identical. */
    expect(serialize(withFeeling)).toBe(serialize(withoutFeelingDraws));

    /* Monster and object placement (grid + identity) are byte-identical. */
    const monSig = (g: Gen): string =>
      g.monsters.map((m) => `${m.grid.x},${m.grid.y}:${m.mon.race.ridx}`).join("|");
    const objSig = (g: Gen): string =>
      g.objects
        .map((o) => `${o.grid.x},${o.grid.y}:${o.obj.kind.kidx}:${o.obj.number}`)
        .join("|");
    expect(monSig(withFeeling)).toBe(monSig(withoutFeelingDraws));
    expect(objSig(withFeeling)).toBe(objSig(withoutFeelingDraws));

    /* RNG-free rating accumulation matches too (it does not depend on
     * feeling_total at all). */
    expect(withFeeling.c.objRating).toBe(withoutFeelingDraws.c.objRating);
    expect(withFeeling.c.monRating).toBe(withoutFeelingDraws.c.monRating);
    expect(withFeeling.c.goodItem).toBe(withoutFeelingDraws.c.goodItem);

    /* But the FEEL squares differ: the real run marks some, feeling_total=0
     * marks none - proving the extra draws are strictly appended at gen-end
     * and touch nothing but SQUARE_FEEL. */
    let realMarks = 0;
    let noneMarks = 0;
    for (let y = 0; y < withFeeling.c.height; y++) {
      for (let x = 0; x < withFeeling.c.width; x++) {
        if (withFeeling.c.sqinfoHas(loc(x, y), SQUARE.FEEL)) realMarks++;
        if (withoutFeelingDraws.c.sqinfoHas(loc(x, y), SQUARE.FEEL)) noneMarks++;
      }
    }
    expect(realMarks).toBeGreaterThan(0);
    expect(noneMarks).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Moria / room of chambers / huge room builders (gen-room.c).
 * ------------------------------------------------------------------ */

/** A Gen backed by a granite-filled chunk (as during real cave layout). */
function roomGen(width: number, height: number, depth: number, seed: number): Gen {
  const deps = makeDeps();
  const c = new Chunk(reg, height, width);
  c.depth = depth;
  fillRectangle(c, 0, 0, height - 1, width - 1, FEAT.GRANITE, SQUARE.NONE);
  const dun = new Dun(constants);
  return new Gen(c, new Rng(seed), reg, constants, dun, deps.objDeps, deps.monDeps);
}

function countFloor(g: Gen): number {
  const c = g.c;
  let n = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) if (c.isFloor(loc(x, y))) n++;
  }
  return n;
}

/** BFS-count floor grids reachable (8-connected, through broken/doors too). */
function reachableFloor(g: Gen, start: Loc): number {
  const c = g.c;
  const passable = (grid: Loc): boolean =>
    c.isFloor(grid) || c.isDoor(grid) || c.feat(grid) === FEAT.BROKEN;
  const seen = new Uint8Array(c.width * c.height);
  const stack: Loc[] = [start];
  seen[start.y * c.width + start.x] = 1;
  let count = 0;
  const dirs = [loc(0, 1), loc(0, -1), loc(1, 0), loc(-1, 0), loc(1, 1), loc(-1, 1), loc(1, -1), loc(-1, -1)];
  while (stack.length) {
    const cur = stack.pop() as Loc;
    if (c.isFloor(cur)) count++;
    for (const d of dirs) {
      const n = loc(cur.x + d.x, cur.y + d.y);
      if (!c.inBounds(n)) continue;
      const idx = n.y * c.width + n.x;
      if (seen[idx]) continue;
      if (!passable(n)) continue;
      seen[idx] = 1;
      stack.push(n);
    }
  }
  return count;
}

describe("build_moria", () => {
  it("builds a lit-or-dark starburst cave room, deterministic run-to-run", () => {
    const a = roomGen(120, 60, 5, 12345);
    const b = roomGen(120, 60, 5, 12345);
    const build = createRoomRegistry({ templates: roomTemplates, vaults }).get("moria");
    expect(build(a, loc(60, 30), 0)).toBe(true);
    expect(build(b, loc(60, 30), 0)).toBe(true);
    /* Produced a non-trivial floor region. */
    expect(countFloor(a)).toBeGreaterThan(50);
    /* Deterministic: identical terrain for the same seed. */
    expect(serializeFeats(a)).toBe(serializeFeats(b));
    /* Every floor grid the starburst lays is marked as room (SQUARE_ROOM). */
    for (let y = 0; y < a.c.height; y++) {
      for (let x = 0; x < a.c.width; x++) {
        const grid = loc(x, y);
        if (a.c.isFloor(grid)) expect(a.c.sqinfoHas(grid, SQUARE.ROOM)).toBe(true);
      }
    }
  });
});

describe("room builder registry", () => {
  it("registers exactly the list-rooms.h builder set, both directions", () => {
    /* get_room_builder_count (generate.c L1561) = N_ELEMENTS(room_builders). */
    expect(ROOM_ENTRIES.length).toBe(19);
    const registered = new Set(
      createRoomRegistry({ templates: roomTemplates, vaults }).names(),
    );
    const upstream = new Set<string>(ROOM_ENTRIES.map((e) => e.builder));
    /* Set difference empty both ways. */
    expect([...upstream].filter((k) => !registered.has(k))).toEqual([]);
    expect([...registered].filter((k) => !upstream.has(k))).toEqual([]);
    expect(registered.size).toBe(19);
  });
});

describe("help_greater_vault", () => {
  /* gen-room.c L3075. Greater vaults carry an artificially high allocation
   * cutoff (100 in "classic") precisely because this helper cancels nearly
   * every attempt; without it a greater vault lands on almost every level at
   * depth 35+. A greater vault is up to 44x66, so the test chunk is oversized. */
  const gvGen = (depth: number, seed: number, profileName: string): Gen => {
    const g = roomGen(160, 70, depth, seed);
    g.dun.profileName = profileName;
    return g;
  };
  const build = (key: string) =>
    createRoomRegistry({ templates: roomTemplates, vaults }).get(key);

  it("refuses a greater vault that is not the first non-staircase room", () => {
    /* L3086: cent_n - nstair_room > 1 (real centre => room_build already
     * incremented cent_n). Depth 90 so the depth ladder alone would pass 1/3
     * of the time; the gate must reject regardless of seed. */
    for (let seed = 1; seed <= 40; seed++) {
      const g = gvGen(90, seed, "classic");
      g.dun.centN = 3;
      g.dun.nstairRoom = 0;
      expect(build("greater_vault")(g, loc(80, 35), 0)).toBe(false);
      /* Nothing was drawn or built. */
      expect(countFloor(g)).toBe(0);
    }
  });

  it("still allows a greater vault as the second room when a staircase room precedes it", () => {
    /* L3086: nstair_room is subtracted, so persistent-level staircase rooms do
     * not use up the one allowed slot. */
    let passed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = gvGen(90, seed, "classic");
      g.dun.centN = 2;
      g.dun.nstairRoom = 1;
      if (build("greater_vault")(g, loc(80, 35), 0)) passed++;
    }
    expect(passed).toBeGreaterThan(0);
  });

  /* SAMPLES is fixed and the seeds are fixed, so every count below is
   * deterministic; the bounds are set well clear of the observed values. */
  const SAMPLES = 120;
  const rate = (depth: number, profileName: string): number => {
    let n = 0;
    for (let seed = 1; seed <= SAMPLES; seed++) {
      const g = gvGen(depth, seed, profileName);
      if (build("greater_vault")(g, loc(80, 35), 0)) n++;
    }
    return n;
  };

  it(
    "applies the depth ladder: ~1/3 at depth 90+, far rarer shallow",
    () => {
      /* L3090-3096: depth 90+ -> 1/3 (no ladder iterations). */
      const deep = rate(90, "classic");
      expect(deep).toBeGreaterThan(20);
      expect(deep).toBeLessThan(65);
      /* Depth 40 -> five iterations -> 32/729 = 4.4%. */
      const shallow = rate(40, "classic");
      expect(shallow).toBeLessThan(20);
      expect(shallow).toBeLessThan(deep);
      /* Observed: depth90 = 41/120 (34.2%, theory 33.3%);
       *           depth40 =  6/120 ( 5.0%, theory 32/729 = 4.4%). */
    },
    120000,
  );

  it(
    "rejects a further 2/3 outside the classic profile",
    () => {
      /* L3099: !streq(dun->profile->name, "classic") && !one_in_(3). */
      const classic = rate(90, "classic");
      const modified = rate(90, "modified");
      /* Observed: classic = 41/120 (34.2%); modified = 15/120 (12.5%,
       * theory 1/3 * 1/3 = 11.1%). */
      expect(modified).toBeLessThan(classic / 2);
      expect(modified).toBeGreaterThan(2);
    },
    120000,
  );

  it("has the live builder path publish the profile name onto dun", () => {
    /* dun->profile = choose_profile(p) (generate.c L1157). help_greater_vault
     * (L3099) reads dun->profile->name, so makeGen must publish it; without
     * this the classic profile would take the non-classic 2/3 rejection. */
    const ctx = builderCtx(50, 4242);
    expect(ctx.dun.profileName).toBe("");
    const built = classicGen(ctx);
    expect(built.error).toBeNull();
    expect(ctx.dun.profileName).toBe("classic");
  });

  it("gates the (new) greater vault the same way, and plain vaults not at all", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = gvGen(90, seed, "classic");
      g.dun.centN = 3;
      expect(build("greater_new_vault")(g, loc(80, 35), 0)).toBe(false);
    }
    /* Lesser/medium vaults are plain build_vault_type wrappers: no gate, so a
     * fourth room may still be a lesser vault. */
    let lesser = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = gvGen(90, seed, "classic");
      g.dun.centN = 3;
      if (build("lesser_vault")(g, loc(80, 35), 0)) lesser++;
    }
    expect(lesser).toBe(20);
  });
});

describe("build_huge", () => {
  it("builds a huge connected starburst room at a seed that passes its 5% gate", () => {
    /* Seed 30 passes the one_in_(20) gate for this footprint (verified). */
    const g = roomGen(160, 70, 5, 30);
    const build = createRoomRegistry({ templates: roomTemplates, vaults }).get("huge");
    const ok = build(g, loc(80, 35), 0);
    expect(ok).toBe(true);
    /* Huge rooms are large. */
    expect(countFloor(g)).toBeGreaterThan(400);
    /* build_huge places no monsters itself. */
    expect(g.monsters.length).toBe(0);
    /* Deterministic run-to-run. */
    const g2 = roomGen(160, 70, 5, 30);
    build(g2, loc(80, 35), 0);
    expect(serializeFeats(g)).toBe(serializeFeats(g2));
  });

  it("returns false when it is not the first non-staircase room", () => {
    const g = roomGen(160, 70, 5, 30);
    /* Simulate rooms already placed: cent_n - nstair_room exceeds the cap. */
    g.dun.centN = 3;
    g.dun.nstairRoom = 0;
    const build = createRoomRegistry({ templates: roomTemplates, vaults }).get("huge");
    /* Valid centre -> finding_space is false -> gate is (> 1). */
    expect(build(g, loc(80, 35), 0)).toBe(false);
  });
});

describe("build_room_of_chambers", () => {
  it("builds a connected multi-chamber room and fills it with themed monsters", () => {
    const g = roomGen(120, 60, 10, 1);
    const build = createRoomRegistry({ templates: roomTemplates, vaults }).get("room_of_chambers");
    const ok = build(g, loc(60, 30), 0);
    expect(ok).toBe(true);

    /* Hollowed chambers produced floor. */
    const floors = countFloor(g);
    expect(floors).toBeGreaterThan(50);

    /* All floor is connected (unreached magma chambers become granite). */
    let anyFloor: Loc | null = null;
    for (let y = 0; y < g.c.height && !anyFloor; y++) {
      for (let x = 0; x < g.c.width; x++) {
        if (g.c.isFloor(loc(x, y))) { anyFloor = loc(x, y); break; }
      }
    }
    expect(anyFloor).not.toBeNull();
    expect(reachableFloor(g, anyFloor as Loc)).toBe(floors);

    /* get_chamber_monsters placed themed monsters (bounded count). */
    expect(g.monsters.length).toBeGreaterThan(0);
    expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
    /* Every placed monster sits inside the room footprint. */
    for (const m of g.monsters) {
      expect(g.c.inBoundsFully(m.grid)).toBe(true);
      expect(g.c.isFloor(m.grid)).toBe(true);
    }
  });

  it("is deterministic run-to-run for a fixed seed", () => {
    const a = roomGen(120, 60, 10, 7);
    const b = roomGen(120, 60, 10, 7);
    const build = createRoomRegistry({ templates: roomTemplates, vaults }).get("room_of_chambers");
    expect(build(a, loc(60, 30), 0)).toBe(true);
    expect(build(b, loc(60, 30), 0)).toBe(true);
    expect(serializeFeats(a)).toBe(serializeFeats(b));
    expect(a.monsters.length).toBe(b.monsters.length);
  });

  it("returns false cleanly when the room does not fit in the chunk", () => {
    /* A 25x25 chunk cannot hold a >=20-tall room centred at (12,12). */
    const g = roomGen(25, 25, 10, 1);
    const build = createRoomRegistry({ templates: roomTemplates, vaults }).get("room_of_chambers");
    expect(build(g, loc(12, 12), 0)).toBe(false);
  });
});

describe("vault max-depth default (parse_vault_max_depth, generate.c L562)", () => {
  it("treats max-depth 0 as no maximum (= constants.maxDepth), not 0", () => {
    /* vault.txt has 128 of 161 vaults at max-depth:0; without the default they
     * would be unreachable in the dungeon (randomVault filters maxLev >= depth). */
    expect(vaults.length).toBeGreaterThan(100);
    for (const v of vaults) {
      expect(v.maxLev).toBeGreaterThanOrEqual(1);
      expect(v.maxLev).toBeLessThanOrEqual(constants.maxDepth);
    }
    /* The defaulted (0 -> maxDepth) vaults are the majority. */
    const defaulted = vaults.filter((v) => v.maxLev === constants.maxDepth);
    expect(defaulted.length).toBeGreaterThan(vaults.length / 2);
  });
});

describe("quest monster placement (generate.c cave_generate L1170-1191)", () => {
  const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
  /* Any concrete race serves as a stand-in guardian; placement passes the race
   * object directly, so it need not be in the allocation table. */
  const guardian = monReg.races.find((r) => !r.flags.has(RF.UNIQUE));
  if (!guardian) throw new Error("test setup: no non-unique race in pack");

  it("spawns max_num guardians when questSpawns is supplied", () => {
    const g = generateLevel(new Rng(2026_0716), 5, makeDeps(), {
      questSpawns: [{ race: guardian, maxNum: 2 }],
    });
    const placed = g.monsters.filter((m) => m.mon.race === guardian);
    expect(placed.length).toBe(2);
  });

  it("spawns no guardian without questSpawns (regression: the bug we fixed)", () => {
    const g = generateLevel(new Rng(2026_0716), 5, makeDeps());
    expect(g.monsters.some((m) => m.mon.race === guardian)).toBe(false);
  });

  it("skips a unique guardian already alive (cur_num > 0)", () => {
    const uniq = monReg.races.find((r) => r.flags.has(RF.UNIQUE));
    expect(uniq).toBeDefined();
    uniq!.curNum = 1;
    try {
      const g = generateLevel(new Rng(4242), 10, makeDeps(), {
        questSpawns: [{ race: uniq!, maxNum: 1 }],
      });
      expect(g.monsters.some((m) => m.mon.race === uniq)).toBe(false);
    } finally {
      uniq!.curNum = 0;
    }
  });
});

/* ------------------------------------------------------------------ *
 * pick_and_place_distant_monster (mon-make.c L1483-1520).
 * ------------------------------------------------------------------ */

/**
 * Mechanical proof of the C search loop, because a histogram cannot see it.
 *
 * C is `int attempts_left = 10000; while (--attempts_left) { ... }`, so the
 * loop body runs exactly 9,999 times and each iteration spends exactly two
 * draws -- `randint0(c->width)` then `randint0(c->height)` -- over the FULL
 * map, with no distance relaxation and no retry after exhaustion. The port's
 * generation copy had drifted to a post-decrement 10,000-iteration loop over
 * interior-only coordinates with a `max_sight + 1` distance floor and a
 * halving retry, none of which exist in C. Only the draw COUNT and the draw
 * MODULI can catch that, so they are asserted directly here.
 *
 * The port's live-game copy (game/mon-place.ts) is the same loop minus the
 * SQUARE_MON_RESTRICT test, which C gates on `!character_dungeon`.
 */
describe("pick_and_place_distant_monster search loop", () => {
  const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
  const table = new MonAllocTable(monReg.races, { maxDepth: constants.maxDepth });

  /** C's iteration count: `while (--attempts_left)` from 10,000. */
  const C_ATTEMPTS = 9_999;
  /** Two coordinate draws per attempt, and nothing else on a rejected grid. */
  const C_DRAWS_ON_EXHAUSTION = C_ATTEMPTS * 2;

  /** An Rng that records the modulus of every consuming draw, in order. */
  class ModulusRng extends Rng {
    readonly moduli: number[] = [];
    override randDiv(m: number): number {
      if (m > 1) this.moduli.push(m);
      return super.randDiv(m);
    }
  }

  /** An all-floor arena with no border, so every grid is a legal candidate. */
  function floorGen(rng: Rng, width: number, height: number, flag: number = SQUARE.NONE): Gen {
    const c = new Chunk(reg, height, width);
    c.depth = 5;
    fillRectangle(c, 0, 0, height - 1, width - 1, FEAT.FLOOR, flag);
    return new Gen(c, rng, reg, constants, new Dun(constants), null, { table });
  }

  it("draws randint0(width) then randint0(height) over the full map", () => {
    /* Interior-only sampling would ask for width-2 / height-2, and drawing y
     * first would swap the pair. Both are visible in the moduli alone. */
    const rng = new ModulusRng(7);
    const g = floorGen(rng, 40, 25);
    pickAndPlaceDistantMonster(g, loc(20, 12), 0, true, g.c.depth);
    expect(rng.moduli.slice(0, 2)).toEqual([40, 25]);
  });

  it("spends exactly 9,999 attempts and gives up, with no distance relaxation", () => {
    /* `dis` larger than the map's diagonal makes every grid too close, so the
     * loop must exhaust. C returns false; the old port halved `dis` and tried
     * again, which shows up as a draw count above 19,998. */
    const rng = new ModulusRng(11);
    const g = floorGen(rng, 40, 25);
    const placed = pickAndPlaceDistantMonster(g, loc(20, 12), 10_000, true, g.c.depth);
    expect(placed).toBe(false);
    expect(rng.moduli.length).toBe(C_DRAWS_ON_EXHAUSTION);
    /* Every attempt sampled the full map -- no widened or narrowed retry. */
    expect(new Set(rng.moduli)).toEqual(new Set([40, 25]));
    expect(g.monsters).toHaveLength(0);
  });

  it("rejects SQUARE_MON_RESTRICT grids during generation", () => {
    /* C: `if ((!character_dungeon) && square_ismon_restrict(c, grid)) continue;`
     * Generation is the !character_dungeon case, so a wholly restricted map
     * yields nothing even though every grid is empty and far enough away. */
    const rng = new ModulusRng(13);
    const g = floorGen(rng, 40, 25, SQUARE.MON_RESTRICT);
    const placed = pickAndPlaceDistantMonster(g, loc(20, 12), 0, true, g.c.depth);
    expect(placed).toBe(false);
    expect(rng.moduli.length).toBe(C_DRAWS_ON_EXHAUSTION);
    expect(g.monsters).toHaveLength(0);
  });
});

describe("choose_profile's wizard override (generate.c L824-836)", () => {
  const profiles = createDungeonProfiles(loadRecords<DunProfileRecordJson>("dungeon_profile"));

  it("a named profile wins over every depth rule", () => {
    /* The wizard's "Jump to a level" -> "Choose cave profile? " -> "Profile name
     * (eg classic): " path. Depth 1 would normally never build a labyrinth. */
    const named = profiles.choose(new Rng(1), 1, { name: "labyrinth" });
    expect(named.name).toBe("labyrinth");
    /* And a town-depth jump can be told to build something else entirely. */
    expect(profiles.choose(new Rng(1), 0, { name: "cavern" }).name).toBe("cavern");
  });

  it("an unknown name falls through to the ordinary selection", () => {
    /* L834: "If no valid profile name given, fall through". */
    const seed = 7;
    const fell = profiles.choose(new Rng(seed), 0, { name: "not-a-profile" });
    expect(fell.name).toBe(profiles.choose(new Rng(seed), 0, {}).name);
    expect(fell.name).toBe("town");
  });

  it("no name at all leaves selection byte-identical", () => {
    const a = profiles.choose(new Rng(99), 12, {});
    const b = profiles.choose(new Rng(99), 12, { name: undefined });
    expect(a.name).toBe(b.name);
  });
});
