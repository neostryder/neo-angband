import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import type { ConstantsJson } from "../constants";
import { FEAT, SQUARE } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { Rng } from "../rng";
import { Chunk } from "../world/chunk";
import { FeatureRegistry } from "../world/feature";
import type { TerrainRecordJson } from "../world/feature";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { ArtifactState, ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { MonAllocTable } from "../mon/make";

import {
  createDungeonProfiles,
  DungeonProfiles,
  TOWN_STORE_FEATS,
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
import { generateLevel, type GenDeps } from "./generate";
import { GROUP_TYPE } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import {
  Dun,
  Gen,
  drawRectangle,
  fillRectangle,
  generateRoom,
  placeNewMonster,
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
const vaults = loadVaults(loadRecords<VaultRecordJson>("vault"));

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
  const monDeps: MonPlaceDeps = { table };

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

  it("selects town at depth 0 and a dungeon profile below", () => {
    const deps = makeDeps();
    expect(deps.profiles.choose(new Rng(1), 0).name).toBe("town");
    const names = new Set<string>();
    for (let s = 0; s < 40; s++) names.add(deps.profiles.choose(new Rng(s), 7).name);
    /* Only classic/modified are enabled for dungeon depths. */
    for (const n of names) expect(["classic", "modified"]).toContain(n);
  });

  it("generates a walkable town at depth 0", () => {
    const g = generateLevel(new Rng(7), 0, makeDeps());
    expect(g.c.featCount[FEAT.MORE] ?? 0).toBeGreaterThanOrEqual(1);
    const p = g.playerSpot as Loc;
    expect(g.c.isPassable(p)).toBe(true);
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
     * build_store / build_ruin / residents changes this number. */
    const rng = new CountingRng(7);
    generateLevel(rng, 0, makeDeps(), { daytime: true });
    expect(rng.draws).toBe(TOWN_DRAW_COUNT_SEED7_DAY);
  });
});

/** Observed faithful draw count for seed 7, daytime (layout + residents). */
const TOWN_DRAW_COUNT_SEED7_DAY = 1567;

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
      monDeps: { table },
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
