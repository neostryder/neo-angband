/**
 * The staircase repair's own tests, next to the mod's own code. Moved here
 * wholesale from packages/core/src/gen/gen.test.ts when the fix left core: the
 * assertions are unchanged, only their home and their imports are.
 *
 * Four things they establish:
 *
 *  1. The repair works on the shape of the real defect (a stair sealed inside a
 *     vault), picks its replacement grid the way alloc_stairs would, falls back to
 *     the player's own grid, refuses when nothing will hold a stair, and never
 *     mints a way down on a quest floor.
 *  2. It repairs every seed measured stranded under faithful core - the fix half
 *     of the control/fix pair whose control still lives in core.
 *  3. It reaches a real game through startGame's modHooks (the plumbing).
 *  4. THE DETERMINISM RATCHET: a level needing no repair is BIT-IDENTICAL to one
 *     generated with no mod at all, for the same seed.
 *
 * Everything is driven through @neo-angband/core's published API, so this also
 * demonstrates that a third-party level mod needs nothing private.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ArtifactState,
  Chunk,
  Dun,
  FEAT,
  FeatureRegistry,
  Gen,
  MonAllocTable,
  ObjAllocState,
  ObjRegistry,
  Rng,
  SQUARE,
  bindConstants,
  bindMonsters,
  createDungeonProfiles,
  createRoomRegistry,
  drawRectangle,
  fillRectangle,
  generateLevel,
  loadRoomTemplates,
  loadVaults,
  loc,
  resolvePits,
  squareIsEmpty,
  squareNumWallsAdjacent,
  startGame,
} from "@neo-angband/core";
import type {
  GamePack,
  GenDeps,
  Loc,
  MakeDeps,
  ModHooks,
  MonPlaceDeps,
} from "@neo-angband/core";
import * as neoCore from "@neo-angband/core";
import plugin from "./plugin";

/**
 * The mod's behaviour, driven the way the HOST drives it: the entry point is a
 * ModPlugin whose `hooks` reads the engine off `ctx.core`
 * (mods/bug-fixes/plugin.ts), and the host reduces that to a function of flags
 * (src/mod-hooks.ts pluginAdapter). Same reduction here, with the real core.
 */
const bugFixesHooks = (flags: Readonly<Record<string, boolean>>): ModHooks =>
  plugin.hooks({ flags, core: neoCore });
import { ensureStairsReachable as repairStairs } from "./stairs";

/** The repair with the engine handed in, as the plugin hands it. */
const ensureStairsReachable = (g: Gen, quest: boolean): boolean =>
  repairStairs(g, quest, neoCore);

/* ------------------------------------------------------------------ *
 * Content, loaded straight from the shipped pack.
 * ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const terrain = loadRecords("terrain");
const reg = new FeatureRegistry(terrain as never);
const constants = bindConstants(loadJson("constants") as never);
const roomTemplates = loadRoomTemplates(loadRecords("room_template") as never);
const vaults = loadVaults(loadRecords("vault") as never, constants.maxDepth);

const objPack = {
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
};
const monPack = {
  pain: loadRecords("pain"),
  blowMethods: loadRecords("blow_methods"),
  blowEffects: loadRecords("blow_effects"),
  monsterSpells: loadRecords("monster_spell"),
  monsterBases: loadRecords("monster_base"),
  monsters: loadRecords("monster"),
  summons: loadRecords("summon"),
  pits: loadRecords("pit"),
};

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain,
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  quest: loadRecords("quest"),
  obj: objPack,
  mon: monPack,
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
} as unknown as GamePack;

/**
 * Faithful GenDeps - no hooks. Fresh per call on purpose: vault object placement
 * draws mid-generation, and a shared ArtifactState / race.curNum from a previous
 * seed pollutes those draws (independent seed trials are not one continuous game).
 */
function makeDeps(): GenDeps {
  const objReg = new ObjRegistry(objPack as never);
  const objDeps: MakeDeps = {
    reg: objReg,
    alloc: new ObjAllocState(objReg, constants),
    constants,
    artifacts: new ArtifactState(objReg.artifacts.length),
    noArtifacts: false,
  };
  const monReg = bindMonsters(monPack as never, { maxSight: constants.maxSight });
  const monDeps: MonPlaceDeps = {
    table: new MonAllocTable(monReg.races, {
      maxDepth: constants.maxDepth,
      oodChance: constants.oodMonsterChance,
      oodAmount: constants.oodMonsterAmount,
    }),
    pits: resolvePits(monReg),
  };
  return {
    reg,
    constants,
    rooms: createRoomRegistry({ templates: roomTemplates, vaults }),
    profiles: createDungeonProfiles(loadRecords("dungeon_profile") as never),
    objDeps,
    monDeps,
  };
}

/** GenDeps with THIS MOD's levelGenerated hook installed, as the game installs it. */
function fixDeps(): GenDeps {
  const deps = makeDeps();
  deps.hooks = bugFixesHooks({ "bugfix.stairsReachable": true });
  return deps;
}

/* ------------------------------------------------------------------ *
 * Reachability measurement (the same walk the invariant is stated over).
 * ------------------------------------------------------------------ */

/**
 * Walk the region the player can actually get to: passable grids, plus doors
 * (openable) and rubble (diggable). 8-directional, since the player moves
 * diagonally and caverns connect diagonally. Walls are excluded on purpose -
 * granite is tunnellable, but counting it would make the guarantee vacuous.
 */
function walkFrom(c: Chunk, start: Loc): Uint8Array {
  const trav = (gr: Loc): boolean => c.isPassable(gr) || c.isDoor(gr) || c.isRubble(gr);
  const seen = new Uint8Array(c.width * c.height);
  const stack: Loc[] = [start];
  seen[start.y * c.width + start.x] = 1;
  const d8 = [loc(0, 1), loc(0, -1), loc(1, 0), loc(-1, 0), loc(1, 1), loc(1, -1), loc(-1, 1), loc(-1, -1)];
  while (stack.length) {
    const cur = stack.pop() as Loc;
    for (const d of d8) {
      const n = loc(cur.x + d.x, cur.y + d.y);
      if (!c.inBounds(n)) continue;
      const idx = n.y * c.width + n.x;
      if (seen[idx] || !trav(n)) continue;
      seen[idx] = 1;
      stack.push(n);
    }
  }
  return seen;
}

/** [total on the level, how many of them the player can walk to]. */
function stairTally(c: Chunk, seen: Uint8Array, feat: number): [number, number] {
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
}

/** The directions that have a stair but no walk-reachable one. */
function strandedDirs(c: Chunk, start: Loc): string[] {
  const seen = walkFrom(c, start);
  const out: string[] = [];
  for (const [name, feat] of [["down", FEAT.MORE], ["up", FEAT.LESS]] as const) {
    const [total, reached] = stairTally(c, seen, feat);
    if (total > 0 && reached === 0) out.push(name);
  }
  return out;
}

/**
 * "each direction it actually has one" is what exempts the town (place_stairs
 * forces FEAT_MORE at depth 0, so there is no up stair to reach) and the
 * quest/Morgoth floors (forced FEAT_LESS, so no down stair) with no depth
 * special-casing.
 */
function assertStairInvariant(g: Gen, label: string): void {
  const p = g.playerSpot as Loc;
  expect(g.c.isPassable(p), `${label}: player spot not passable`).toBe(true);
  const seen = walkFrom(g.c, p);
  for (const [name, feat] of [["down", FEAT.MORE], ["up", FEAT.LESS]] as const) {
    const [total, reached] = stairTally(g.c, seen, feat);
    if (total === 0) continue;
    expect(reached, `${label}: ${total} ${name} stair(s), NONE reachable`).toBeGreaterThan(0);
  }
}

/* ------------------------------------------------------------------ *
 * Synthetic levels: the shape of the real defect, without a lucky seed.
 * ------------------------------------------------------------------ */

/** A one-room level whose only up stair is sealed inside a granite ring. */
function sealedPocketLevel(): Gen {
  const c = new Chunk(reg, 25, 40);
  c.depth = 5;
  fillRectangle(c, 0, 0, 24, 39, FEAT.FLOOR, SQUARE.NONE);
  drawRectangle(c, 0, 0, 24, 39, FEAT.PERM, SQUARE.NONE, true);
  /* A granite ring with a 3x3 interior, joined to nothing. */
  drawRectangle(c, 10, 28, 14, 32, FEAT.GRANITE, SQUARE.NONE, false);
  /* The level's ONLY up stair sits inside it - the shape of the real defect. */
  c.setFeat(loc(30, 12), FEAT.LESS);
  /* A down stair out in the open, so only the up direction needs repair. */
  c.setFeat(loc(5, 5), FEAT.MORE);
  const g = new Gen(c, new Rng(99), reg, constants, new Dun(constants), null, null);
  g.playerSpot = loc(3, 3);
  return g;
}

/** Player alone in a 1x1 pocket, with the only up stair sealed elsewhere. */
function onePocketLevel(): Gen {
  const c = new Chunk(reg, 25, 40);
  c.depth = 5;
  fillRectangle(c, 0, 0, 24, 39, FEAT.GRANITE, SQUARE.NONE);
  drawRectangle(c, 0, 0, 24, 39, FEAT.PERM, SQUARE.NONE, true);
  c.setFeat(loc(3, 3), FEAT.FLOOR);
  c.setFeat(loc(30, 12), FEAT.LESS);
  const g = new Gen(c, new Rng(99), reg, constants, new Dun(constants), null, null);
  g.playerSpot = loc(3, 3);
  return g;
}

describe("bugfix.stairsReachable: the repair itself", () => {
  it("repairs a level whose only up staircase is sealed inside a vault", () => {
    const g = sealedPocketLevel();
    const before = walkFrom(g.c, g.playerSpot as Loc);
    /* Precondition: the pocket really is sealed and holds the only up stair. */
    expect(before[12 * g.c.width + 30]).toBe(0);
    expect(stairTally(g.c, before, FEAT.LESS)).toEqual([1, 0]);
    expect(stairTally(g.c, before, FEAT.MORE)).toEqual([1, 1]);

    expect(ensureStairsReachable(g, false)).toBe(true);

    const after = walkFrom(g.c, g.playerSpot as Loc);
    const [total, reached] = stairTally(g.c, after, FEAT.LESS);
    expect(total).toBe(2); // the stranded one stays; a reachable one is added
    expect(reached).toBe(1);
    /*
     * The spot is chosen the way alloc_stairs chooses: the best available
     * wall-adjacency tier first (3 -> 0, so stairs sit in alcoves, not in the
     * middle of a room), and within that tier the grid closest to the stranded
     * stair it stands in for. Assert exactly that, rather than a raw distance -
     * on this synthetic single-room level the walled tier is scarce, so the
     * nearest qualifying grid is legitimately not the nearest grid.
     */
    const spot = [...Array(g.c.height).keys()]
      .flatMap((y) => [...Array(g.c.width).keys()].map((x) => loc(x, y)))
      .find((gr) => g.c.feat(gr) === FEAT.LESS && after[gr.y * g.c.width + gr.x]) as Loc;
    const dist2 = (gr: Loc): number => (gr.x - 30) ** 2 + (gr.y - 12) ** 2;
    const tier = squareNumWallsAdjacent(g.c, spot);
    for (let y = 1; y <= g.c.height - 2; y++) {
      for (let x = 1; x <= g.c.width - 2; x++) {
        const gr = loc(x, y);
        if (gr.x === spot.x && gr.y === spot.y) continue;
        if (!after[y * g.c.width + x]) continue;
        if (!squareIsEmpty(g, gr)) continue;
        if (squareNumWallsAdjacent(g.c, gr) !== tier) continue;
        expect(dist2(gr), `${x},${y} is a closer tier-${tier} spot than the one chosen`)
          .toBeGreaterThanOrEqual(dist2(spot));
      }
    }
  });

  it("spends no RNG repairing a level (so healthy levels are untouched)", () => {
    /* State equality is airtight: any draw through any entry point advances it.
     * This is the hook's RNG-FREE contract, and the reason the patch can be on
     * for every level without a seed changing meaning. */
    const g = sealedPocketLevel();
    const before = JSON.stringify(g.rng.getState());
    expect(ensureStairsReachable(g, false)).toBe(true);
    expect(JSON.stringify(g.rng.getState()), "the repair drew RNG").toBe(before);

    /* And the no-op path on an already-valid level. */
    const ok = sealedPocketLevel();
    ok.c.setFeat(loc(6, 6), FEAT.LESS); // reachable up stair, nothing to repair
    const okBefore = JSON.stringify(ok.rng.getState());
    const featsBefore = JSON.stringify([...ok.c.featCount]);
    expect(ensureStairsReachable(ok, false)).toBe(true);
    expect(JSON.stringify(ok.rng.getState())).toBe(okBefore);
    expect(JSON.stringify([...ok.c.featCount]), "a valid level was modified").toBe(featsBefore);
  });

  it("falls back to a staircase under the player when nothing else will hold one", () => {
    /* Upstream lays a stair on the player's own grid under birth_connect_stairs
     * (new_player_spot), so this is a legal arrival state, and it saves the
     * level from a full re-roll. Measured: it turns the one re-roll in ~230
     * generated levels into zero. */
    const g = onePocketLevel();
    expect(ensureStairsReachable(g, false)).toBe(true);
    expect(g.c.feat(loc(3, 3))).toBe(FEAT.LESS);
  });

  it("reports failure when a level cannot be repaired, so the caller re-rolls", () => {
    /* Same 1x1 pocket, but the player's grid holds a trap - square_isempty
     * rejects it, so not even the fallback applies and the repair must refuse
     * rather than pretend. Core then re-rolls the level. */
    const g = onePocketLevel();
    g.markTrap(loc(3, 3));
    expect(ensureStairsReachable(g, false)).toBe(false);
  });

  it("never mints a down staircase on a quest floor", () => {
    /* place_stairs forces FEAT_LESS when quest is set, so a repair on a Morgoth
     * floor must not become a way down. With no down stair present the down
     * branch is skipped entirely; assert the level stays down-stair-free. */
    const g = sealedPocketLevel();
    g.c.setFeat(loc(5, 5), FEAT.FLOOR); // remove the down stair
    expect(ensureStairsReachable(g, true)).toBe(true);
    expect(g.c.featCount[FEAT.MORE] ?? 0).toBe(0);
  });

  it("leaves a sub-chunk with no player spot alone", () => {
    /* Gauntlet's halves and the hard centre's caverns are generated as pieces
     * with no player spot; they are checked once assembled, not in pieces. */
    const g = sealedPocketLevel();
    g.playerSpot = null;
    const before = JSON.stringify([...g.c.featCount]);
    expect(ensureStairsReachable(g, false)).toBe(true);
    expect(JSON.stringify([...g.c.featCount])).toBe(before);
  });
});

describe("bugfix.stairsReachable: real generated levels", () => {
  /**
   * Measured stranded levels in FAITHFUL core: every staircase of at least one
   * direction sealed away from the player, mostly inside a vault. Core's
   * gen/gen.test.ts keeps the CONTROL half - that these still strand with no mod
   * loaded - and this is the fix half, on the same seeds through the same
   * generator, differing only in the hook.
   */
  const STRANDED: readonly [number, number, string][] = [
    [1, 501016, "both directions sealed off from the player's region"],
    [20, 520009, "both"],
    [20, 520004, "single up stair unreachable"],
    [40, 400017, "up stair sealed off"],
    [40, 400038, "up stair sealed off"],
    [40, 400121, "both"],
    [50, 500021, "up stair sealed off"],
    [50, 500130, "both"],
    [50, 500131, "both"],
    [50, 500217, "both"],
    [60, 600181, "down stair sealed off"],
    [20, 520037, "both"],
  ];

  it("repairs every level faithful core strands", () => {
    for (const [depth, seed, why] of STRANDED) {
      const g = generateLevel(new Rng(seed), depth, fixDeps());
      assertStairInvariant(g, `repaired d${depth} seed ${seed} (${why})`);
    }
  });

  it("a reachable up AND down staircase on every floor", () => {
    /*
     * Depth coverage spans every profile in the pool plus the three special
     * cases: 0 (town, down only), 99 and 100 (quest/Morgoth, up only).
     */
    const depths = [0, 1, 2, 5, 10, 25, 40, 60, 80, 98, 99, 100];
    for (const depth of depths) {
      for (let s = 0; s < 8; s++) {
        const seed = 9000 + depth * 100 + s;
        const g = generateLevel(new Rng(seed), depth, fixDeps());
        assertStairInvariant(g, `depth ${depth} seed ${seed}`);
        if (depth > 0) {
          expect(g.monsters.length).toBeGreaterThanOrEqual(1);
          expect(g.monsters.length).toBeLessThan(constants.levelMonsterMax);
        }
      }
    }
    /* 96 full level builds measure at ~6s, over vitest's 5s default - it timed
     * out on a slower run rather than failing an assertion. Raised rather than
     * trimmed: the seed count is what gives this guard its power. */
  }, 30_000);
});

describe("bugfix.stairsReachable: through a real game (startGame -> modHooks)", () => {
  /*
   * The end-to-end guard on the plumbing: the host installs this mod's hooks as
   * GameState.modHooks, and the session must hand them to cave_generate. No unit
   * test on the repair can catch that wire coming loose. These birth seeds were
   * measured stranded through startGame itself and cover both directions,
   * including a down-only case - the direction that actually blocks descent.
   */
  const STRANDED: readonly [number, number, string][] = [
    [40, 740014, "down+up"],
    [50, 750080, "up"],
    [60, 1300081, "down+up"],
    [40, 1100361, "down"],
  ];

  const ALL_ON: ModHooks = bugFixesHooks({ "bugfix.stairsReachable": true });

  it("a character born on one of those floors arrives on a repaired one", () => {
    for (const [depth, seed] of STRANDED) {
      const { state } = startGame(pack, { seed, depth, modHooks: ALL_ON });
      expect(strandedDirs(state.chunk, state.actor.grid), `d${depth} seed ${seed}`).toEqual([]);
    }
  });

  it("CONTROL: the same seeds still strand with the patch off", () => {
    /* Power validation for the test above: without this, a repair that silently
     * stopped running would still pass, because "not stranded" would be true of
     * the faithful level too. `{}` is what an enabled mod with this patch
     * switched off contributes - no hook at all. */
    const off = bugFixesHooks({ "bugfix.stairsReachable": false });
    expect(off.levelGenerated).toBeUndefined();
    for (const [depth, seed, dirs] of STRANDED) {
      const { state } = startGame(pack, { seed, depth, modHooks: off });
      expect(strandedDirs(state.chunk, state.actor.grid).join("+"), `d${depth} seed ${seed}`).toBe(dirs);
    }
  });
});

describe("DETERMINISM RATCHET: a level needing no repair is bit-identical", () => {
  /**
   * The hook is contractually RNG-FREE, and this is what that buys: with the
   * patch ON, a floor that already had a reachable staircase - the overwhelming
   * majority - is the SAME floor, grid for grid, that faithful core builds from
   * that seed. So enabling the mod does not silently reinterpret every seed; it
   * changes only the ~10% of floors that were broken.
   *
   * Bit-identity is asserted three ways, because each catches a different kind of
   * drift: the RNG end state (a pure function of the entire draw history, so it
   * proves not one extra or reordered draw), every grid's feature and flags (so
   * it proves no silent mutation), and the placed monster/object lists.
   *
   * Seeds: depths 1, 5, 25, 50 and 80, each taking the first seed from a fixed
   * base that faithful core does NOT strand - because a stranded level is
   * legitimately allowed to differ, so "needed no repair" has to be established
   * rather than assumed. The scan is deterministic (fixed bases, fixed order), so
   * the test always runs the same levels; it is a scan only so that a future
   * generation-stream shift re-finds a healthy seed instead of going stale.
   */
  const BASES: readonly [number, number][] = [
    [1, 20260729],
    [5, 31337],
    [25, 424242],
    [50, 8675309],
    [80, 1234567],
  ];

  function fingerprint(g: Gen): string {
    const c = g.c;
    const feats: number[] = [];
    const flags: string[] = [];
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const gr = loc(x, y);
        feats.push(c.feat(gr));
        flags.push(String(c.info(gr).bits.join(",")));
      }
    }
    return JSON.stringify({
      feats,
      flags,
      spot: g.playerSpot,
      mons: g.monsters.map((m) => [m.grid.y, m.grid.x, m.mon.race.ridx]),
      objs: g.objects.map((o) => [o.grid.y, o.grid.x, o.obj.kind.kidx, o.obj.number]),
      rng: g.rng.getState(),
    });
  }

  it("is byte-for-byte the faithful level on every seed that needed no repair", () => {
    const used: string[] = [];
    for (const [depth, base] of BASES) {
      let healthy = -1;
      for (let seed = base; seed < base + 10 && healthy < 0; seed++) {
        const faithful = generateLevel(new Rng(seed), depth, makeDeps());
        if (strandedDirs(faithful.c, faithful.playerSpot as Loc).length > 0) continue;
        healthy = seed;

        const hooked = generateLevel(new Rng(seed), depth, fixDeps());
        expect(fingerprint(hooked), `d${depth} seed ${seed} differs with the patch on`).toBe(
          fingerprint(faithful),
        );
      }
      expect(healthy, `no unstranded seed near d${depth} base ${base}`).toBeGreaterThan(0);
      used.push(`d${depth}:${healthy}`);
    }
    /* The seeds this actually compared, so a reader knows what was proven and a
     * silent collapse to zero comparisons cannot pass. */
    expect(used).toHaveLength(BASES.length);
  }, 30_000);

  it("and the repaired minority DOES differ - so the ratchet is not vacuous", () => {
    /* The other side of the same coin: if the fingerprints matched here too, the
     * comparison above would be proving nothing (e.g. a hook that never ran). */
    const faithful = generateLevel(new Rng(501016), 1, makeDeps());
    const repaired = generateLevel(new Rng(501016), 1, fixDeps());
    expect(strandedDirs(faithful.c, faithful.playerSpot as Loc).length).toBeGreaterThan(0);
    expect(strandedDirs(repaired.c, repaired.playerSpot as Loc)).toEqual([]);
    expect(fingerprint(repaired)).not.toBe(fingerprint(faithful));
    /* ...and even then the RNG stream is untouched: the difference is the one
     * grid the repair changed, not a shifted draw sequence. */
    expect(repaired.rng.getState()).toEqual(faithful.rng.getState());
  });
});
