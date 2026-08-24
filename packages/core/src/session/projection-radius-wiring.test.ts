/**
 * A blast radius above `max_range`, driven through the live game and observed
 * at the `registry:projection` seam a mod actually writes to.
 *
 * WHAT THIS EXISTS TO CATCH. `computeProjection` sizes `damAtDist` by
 * `maxRange`, fills it for `0..maxRange`, and then collects blast grids out to
 * `rad`. Faithful 4.2.6 never checks one against the other, so a radius above
 * the maximum range produces distances the table has no entry for. Upstream
 * (issue #6671) reads past the end of a fixed C array and gets whatever is
 * there; this port reads `undefined` and hands it to every per-grid handler as
 * the damage, where the first piece of arithmetic turns it into `NaN`.
 *
 * So the assertions below are not about a number being slightly wrong. They are
 * about core promising a handler a `number` and giving it a hole, at a seam the
 * mod system invites third-party code to stand in - which is why the radius is
 * decidable at all rather than left to the one caller that happens to be inside
 * core today.
 *
 * The arena is carved rather than hoped for: a generated level rarely has 25
 * clear grids in any direction, and a blast that runs into a wall never reaches
 * the distances this is about. Carving is the harness, not the subject - the
 * projection, the handler table, the damage and the seam are all the live
 * game's own.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import type { GameState } from "../game/context.js";
import { castProjection, monsterCastSource } from "../game/project-cast.js";
import type { CastContext } from "../game/project-cast.js";
import { createModRegistryHost } from "../mod/registry-host.js";
import type { ModRegistryHost } from "../mod/registry-host.js";
import { PROJECT, computeProjection } from "../world/project.js";
import type { Loc } from "../loc.js";
import { FEAT } from "../generated/terrain.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  quest: loadRecords("quest"),
  store: loadRecords("store"),
  obj: {
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
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
};

const SEED = 6671;
const DEPTH = 3;
/** Base damage, chosen only so the falloff is legible in an assertion. */
const DAM = 20;

interface Arena {
  game: StartedGame;
  state: GameState;
  cast: CastContext;
  /** The capability-gated facade a trusted plugin is handed. */
  host: ModRegistryHost;
  /** Centre of the cleared area, and of every blast fired here. */
  centre: Loc;
  /** z_info->max_range, from the bound constants rather than a literal. */
  maxRange: number;
}

/**
 * A live game with a clear circle around the middle of the map, wide enough for
 * a blast to reach `maxRange + margin` in every direction.
 */
function arena(margin: number): Arena {
  const game = startGame(pack, { seed: SEED, depth: DEPTH, className: "Warrior" });
  const state = game.state;
  const effect = game.wizardBundles.effect;
  expect(effect, "a depth game should have the effect bundle").toBeTruthy();
  const cast = effect!.cast;
  const reach = cast.maxRange + margin;
  const centre = {
    x: Math.floor(state.chunk.width / 2),
    y: Math.floor(state.chunk.height / 2),
  };
  for (let y = Math.max(1, centre.y - reach); y <= Math.min(state.chunk.height - 2, centre.y + reach); y++) {
    for (let x = Math.max(1, centre.x - reach); x <= Math.min(state.chunk.width - 2, centre.x + reach); x++) {
      state.chunk.setFeat({ x, y }, FEAT.FLOOR);
    }
  }
  return {
    game,
    state,
    cast,
    centre,
    maxRange: cast.maxRange,
    host: createModRegistryHost({ projections: state.projectionHandlers ?? null }),
  };
}

/** The PROJ_ value a code sits at in the BOUND table (never a literal). */
function projOf(cast: CastContext, code: string): number {
  const typ = cast.projections.findIndex((p) => p.code === code);
  expect(typ, `the pack should define a "${code}" projection`).toBeGreaterThan(-1);
  return typ;
}

/**
 * Fire a real monster-sourced ball centred on the arena, with a mod's own
 * terrain handler installed through the capability-gated facade, and collect
 * the damage core handed it for every grid.
 *
 * The handler is installed the way a plugin's register() installs one - after
 * the game is wired, over the live table - so what it receives is what a third
 * party's code receives.
 */
function damagesSeenByAMod(a: Arena, rad: number): unknown[] {
  const seen: unknown[] = [];
  a.host.projections.feat.set("FIRE", (ctx) => {
    seen.push(ctx.dam);
    return false;
  });
  const midx = a.state.monsters.findIndex((m, i) => i > 0 && !!m);
  expect(midx, "the generated level should contain a monster").toBeGreaterThan(0);
  castProjection(
    a.state,
    a.cast,
    { ...monsterCastSource(a.state, midx), grid: a.centre },
    a.centre,
    DAM,
    projOf(a.cast, "FIRE"),
    PROJECT.GRID,
    rad,
  );
  return seen;
}

describe("the 4.2.6 behaviour, reproduced through the live seam", () => {
  it("hands a mod's handler a damage that is not a number", () => {
    const a = arena(5);
    const rad = a.maxRange + 5;
    const seen = damagesSeenByAMod(a, rad);

    expect(seen.length).toBeGreaterThan(0);
    const holes = seen.filter((d) => typeof d !== "number");
    expect(
      holes.length,
      "core should have handed out a damage for every grid it collected",
    ).toBeGreaterThan(0);
    /* The port's shape of upstream #6671: not a wrong number, an absent one. */
    expect(holes[0]).toBeUndefined();
    /* And what it becomes the moment anything is done with it. Every handler in
     * the game does arithmetic on its damage; this is the first line of it. */
    expect(Number.isNaN(Math.floor((holes[0] as number) / 2))).toBe(true);
  });

  it("is faithful, not accidental: the table stops where max_range does", () => {
    const a = arena(5);
    const rad = a.maxRange + 5;
    const proj = computeProjection(a.state.chunk, {
      origin: a.centre,
      finish: a.centre,
      rad,
      typ: projOf(a.cast, "FIRE"),
      flg: PROJECT.GRID,
      dam: DAM,
      maxRange: a.maxRange,
    });
    expect(proj.damAtDist).toHaveLength(a.maxRange + 1);
    expect(Math.max(...proj.distanceToGrid)).toBeGreaterThan(a.maxRange);
  });

  it("stays that way with a mod loaded that does not touch the radius", () => {
    /* The seam is threaded off state.modHooks, so an unrelated mod must not
     * change the blast on its way past. */
    const a = arena(5);
    a.state.modHooks = { messageText: (s) => s };
    const seen = damagesSeenByAMod(a, a.maxRange + 5);
    expect(seen.some((d) => typeof d !== "number")).toBe(true);
  });
});

describe("the projectionRadius seam", () => {
  it("clamps the radius, so every damage handed out is a real number", () => {
    const a = arena(5);
    a.state.modHooks = {
      projectionRadius: (rad, maxRange) => (rad > maxRange ? maxRange : rad),
    };
    const seen = damagesSeenByAMod(a, a.maxRange + 5);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((d) => typeof d === "number" && Number.isFinite(d))).toBe(true);
    /* The centre still takes the full damage, so the clamp narrowed the blast
     * rather than gutting it. */
    expect(seen).toContain(DAM);
  });

  it("is not consulted at all when no mod contributed one", () => {
    const a = arena(5);
    expect(a.state.modHooks).toBeUndefined();
    expect(damagesSeenByAMod(a, a.maxRange + 5).some((d) => typeof d !== "number")).toBe(
      true,
    );
  });

  it("leaves a radius already within range exactly alone", () => {
    const a = arena(5);
    const calls: [number, number][] = [];
    a.state.modHooks = {
      projectionRadius: (rad, maxRange) => {
        calls.push([rad, maxRange]);
        return rad > maxRange ? maxRange : rad;
      },
    };
    const withHook = damagesSeenByAMod(a, 4);
    expect(calls).toEqual([[4, a.maxRange]]);

    const without = damagesSeenByAMod(arena(5), 4);
    expect(withHook).toEqual(without);
  });

  it("produces exactly the blast the clamped radius would have produced", () => {
    /* Upstream's fix is a clamp and nothing else, so a clamped over-radius must
     * be indistinguishable from having asked for max_range in the first place -
     * same grids, same distances, same damage table. */
    const a = arena(5);
    const params = {
      origin: a.centre,
      finish: a.centre,
      typ: projOf(a.cast, "FIRE"),
      flg: PROJECT.GRID,
      dam: DAM,
      maxRange: a.maxRange,
    };
    const clamped = computeProjection(a.state.chunk, {
      ...params,
      rad: a.maxRange + 5,
      resolveRadius: (rad, maxRange) => (rad > maxRange ? maxRange : rad),
    });
    const asked = computeProjection(a.state.chunk, { ...params, rad: a.maxRange });
    expect(clamped).toEqual(asked);
  });

  it("is RNG-free: the stream is where it was before the blast either way", () => {
    const withHook = arena(5);
    withHook.state.modHooks = {
      projectionRadius: (rad, maxRange) => (rad > maxRange ? maxRange : rad),
    };
    damagesSeenByAMod(withHook, withHook.maxRange + 5);

    /* A second game from the same seed, whose blast the seam never saw. The
     * radius decides how many grids the blast collects, so a hook that drew
     * from the stream would leave the two positions apart. Terrain handlers
     * returning false draw nothing, which is what makes the comparison legible
     * at all - the subject is the seam, not the FIRE arm. */
    const plain = arena(5);
    damagesSeenByAMod(plain, plain.maxRange);

    expect(withHook.state.rng.getState()).toEqual(plain.state.rng.getState());
  });
});
