import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import type { ConstantsJson } from "../constants";
import { FEAT, ORIGIN, SQUARE } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { Rng } from "../rng";
import { Chunk } from "../world/chunk";
import { FeatureRegistry } from "../world/feature";
import type { TerrainRecordJson } from "../world/feature";
import { ObjRegistry, tvalFindIdx } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { applyMagic, ArtifactState, objectPrep, ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { createMonster, MonAllocTable } from "../mon/make";
import { createMimickedObject } from "../game/mon-place";

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
} from "./cave";
import {
  buildRoomTemplate,
  buildVault,
  createRoomRegistry,
  loadRoomTemplates,
  loadVaults,
  type RoomProfile,
  type RoomTemplateRecordJson,
  type VaultRecordJson,
} from "./room";
import {
  calcMonFeeling,
  calcObjFeeling,
  generateLevel,
  placeFeeling,
  type GenDeps,
} from "./generate";
import { getVaultMonsters, monPitHook, resolvePits, setPitType } from "./gen-monster";
import { RF } from "../generated";
import { GROUP_TYPE } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import {
  Dun,
  Gen,
  drawRectangle,
  fillRectangle,
  generateRoom,
  placeNewMonster,
  placeObject,
  type MonPlaceDeps,
} from "./util";

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
    const round = vaults.find((v) => v.name === "Round");
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

  it("generates fully-connected valid levels across the deep profile pool", () => {
    /* Post-enablement, depth 30/60 select cavern/moria/labyrinth/lair/gauntlet/
     * hard_centre (proven by the choose() test). Drive many seeds end-to-end
     * through generateLevel and require every level to be valid + connected -
     * catches any deep generator that disconnects or throws via the pipeline. */
    const deps = makeDeps();
    /* The player can reach a down staircase (the true playability guarantee).
     * 8-directional, since the player moves diagonally and caverns connect
     * diagonally. Angband does NOT guarantee every passable cell is reachable
     * (vault interiors and stray fully-enclosed 1-cell pockets can be sealed),
     * so this asserts descent-reachability, not total cell connectivity. */
    const downStairReachable = (g: Gen, start: Loc): boolean => {
      const c = g.c;
      const trav = (gr: Loc): boolean => c.isPassable(gr) || c.isDoor(gr) || c.isRubble(gr);
      const seen = new Uint8Array(c.width * c.height);
      const stack: Loc[] = [start];
      seen[start.y * c.width + start.x] = 1;
      const d8 = [loc(0,1),loc(0,-1),loc(1,0),loc(-1,0),loc(1,1),loc(1,-1),loc(-1,1),loc(-1,-1)];
      let found = c.feat(start) === FEAT.MORE;
      while (stack.length && !found) {
        const cur = stack.pop() as Loc;
        for (const d of d8) {
          const n = loc(cur.x + d.x, cur.y + d.y);
          if (!c.inBounds(n)) continue;
          const idx = n.y * c.width + n.x;
          if (seen[idx] || !trav(n)) continue;
          seen[idx] = 1;
          if (c.feat(n) === FEAT.MORE) { found = true; break; }
          stack.push(n);
        }
      }
      return found;
    };
    for (const [depth, seeds] of [[30, 24], [60, 14]] as const) {
      for (let s = 0; s < seeds; s++) {
        const g = generateLevel(new Rng(9000 + depth * 100 + s), depth, deps);
        const p = g.playerSpot as Loc;
        expect(g.c.isPassable(p)).toBe(true);
        expect(g.c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
        /* The player can descend: a down staircase is reachable. */
        expect(downStairReachable(g, p)).toBe(true);
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
    const a = lairGen(builderCtxNamed(25, 24680, "lair")).gen as Gen;
    const b = lairGen(builderCtxNamed(25, 24680, "lair")).gen as Gen;
    expect(serialize(a)).toBe(serialize(b));
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
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
