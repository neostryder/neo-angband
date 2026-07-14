/**
 * Top-level level generation, ported from the cave_generate() loop of
 * reference/src/generate.c (Angband 4.2.6).
 *
 * generateLevel() picks a dungeon profile by depth, builds the level into a
 * fresh Chunk via the profile's cave builder, then runs the upstream
 * validity checks and the try-until-valid regeneration loop. On success it
 * returns the Gen context, which exposes the finished Chunk, the placed
 * objects and monsters, and the player start location.
 *
 * DEFERRED (ledgered in parity/ledger/gen-framework.yaml): arena and quest
 * levels, persistent-level connectors, and the known-level ("player cave")
 * duplicate. Monster-count overflow is the one upstream post-build
 * regeneration trigger that is kept.
 *
 * Level feeling (generate.c place_feeling / calc_obj_feeling /
 * calc_mon_feeling, L676-761 and L1235-1241) IS ported: placeFeeling scatters
 * feelingTotal hidden SQUARE_FEEL marks (the only RNG this file spends after
 * the retry loop resolves), then the chunk's obj_rating/mon_rating
 * accumulators (populated RNG-free by gen/util.ts placeObject and
 * placeNewMonsterOne during the builder run) are reduced to the final
 * chunk.feeling value.
 */

import type { Constants } from "../constants";
import { SQUARE } from "../generated";
import type { Rng } from "../rng";
import type { FeatureRegistry } from "../world/feature";
import { loc } from "../loc";
import type { MakeDeps } from "../obj/make";
import type { CaveBuildContext, DungeonProfiles } from "./cave";
import type { RoomRegistry } from "./room";
import { Dun, Gen, type MonPlaceDeps } from "./util";

/** Everything the generator needs beyond an RNG and a depth. */
export interface GenDeps {
  reg: FeatureRegistry;
  constants: Constants;
  rooms: RoomRegistry;
  profiles: DungeonProfiles;
  /** Object-make dependencies, or null to skip object placement. */
  objDeps: MakeDeps | null;
  /** Monster-placement dependencies, or null to skip monster placement. */
  monDeps: MonPlaceDeps | null;
}

export interface GenerateOptions {
  /** Whether this is a quest level (forces the classic profile). */
  quest?: boolean;
  /** Minimum level dimensions (persistent-level stair matching); default 1. */
  minHeight?: number;
  minWidth?: number;
  /** Generation attempts before giving up (upstream: 100). */
  maxTries?: number;
  /**
   * is_daytime() at generation time; only the town builder reads it (for
   * cave_illuminate and the resident count). Defaults to daytime when omitted.
   */
  daytime?: boolean;
  /**
   * OPT(player, birth_lose_arts): calc_obj_feeling's special "artifacts are
   * easily lost" feeling (generate.c L719). Default false, matching the
   * option's shipped default (list-options.h birth_lose_arts).
   */
  birthLoseArts?: boolean;
}

/** Clear the transient generation-only square flags on a finished level. */
function clearGenerationFlags(g: Gen): void {
  const c = g.c;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      c.sqinfoOff(grid, SQUARE.WALL_INNER);
      c.sqinfoOff(grid, SQUARE.WALL_OUTER);
      c.sqinfoOff(grid, SQUARE.WALL_SOLID);
      c.sqinfoOff(grid, SQUARE.MON_RESTRICT);
    }
  }
}

/**
 * place_feeling (generate.c L676-703): scatter feeling_total hidden
 * SQUARE_FEEL marks on legal (passable, non-damaging), not-yet-marked
 * grids. Each mark gets up to 500 random-coordinate tries (x drawn before y,
 * matching upstream's `loc(randint0(width), randint0(height))` exactly); a
 * mark that exhausts its tries without landing is simply skipped, same as
 * upstream. Resets feeling_squares to 0 (the runtime reveal counter). This is
 * the ONLY RNG the level-feeling lifecycle spends, and it runs strictly
 * after every room/monster/object placement, so it cannot perturb them.
 */
export function placeFeeling(g: Gen): void {
  const { c, rng } = g;
  const tries = 500;
  for (let i = 0; i < g.constants.feelingTotal; i++) {
    for (let j = 0; j < tries; j++) {
      const grid = loc(rng.randint0(c.width), rng.randint0(c.height));
      if (!c.allowsFeel(grid)) continue;
      if (c.sqinfoHas(grid, SQUARE.FEEL)) continue;
      c.sqinfoOn(grid, SQUARE.FEEL);
      break;
    }
  }
  c.feelingSquares = 0;
}

/**
 * calc_obj_feeling (generate.c L711-736): the object-feeling digit (tens
 * place of chunk.feeling), from obj_rating adjusted for depth. Draws no RNG.
 */
export function calcObjFeeling(g: Gen, birthLoseArts: boolean): number {
  const c = g.c;
  if (c.depth === 0) return 0;
  if (c.goodItem && birthLoseArts) return 10;

  const x = Math.trunc(c.objRating / c.depth);
  if (c.goodItem && x < 641) return 60;

  if (x > 160000) return 20;
  if (x > 40000) return 30;
  if (x > 10000) return 40;
  if (x > 2500) return 50;
  if (x > 640) return 60;
  if (x > 160) return 70;
  if (x > 40) return 80;
  if (x > 10) return 90;
  return 100;
}

/**
 * calc_mon_feeling (generate.c L742-761): the monster-feeling digit (units
 * place of chunk.feeling), from mon_rating adjusted for depth. Draws no RNG.
 */
export function calcMonFeeling(g: Gen): number {
  const c = g.c;
  if (c.depth === 0) return 0;

  const x = Math.trunc(c.monRating / c.depth);
  if (x > 7000) return 1;
  if (x > 4500) return 2;
  if (x > 2500) return 3;
  if (x > 1500) return 4;
  if (x > 800) return 5;
  if (x > 400) return 6;
  if (x > 150) return 7;
  if (x > 50) return 8;
  return 9;
}

/**
 * cave_generate: build one valid dungeon level, retrying on builder failure
 * or maxima overflow. Returns the finished Gen context.
 */
export function generateLevel(
  rng: Rng,
  depth: number,
  deps: GenDeps,
  options: GenerateOptions = {},
): Gen {
  const quest = options.quest ?? false;
  const maxTries = options.maxTries ?? 100;
  const minHeight = options.minHeight ?? 1;
  const minWidth = options.minWidth ?? 1;

  let error: string | null = "no generation";
  let result: Gen | null = null;

  for (let tries = 0; tries < maxTries && error; tries++) {
    error = null;
    const dun = new Dun(deps.constants);
    dun.quest = quest;
    dun.persist = false;

    const profile = deps.profiles.choose(rng, depth, { quest });
    const builder = deps.profiles.builder(profile.builder);

    const ctx: CaveBuildContext = {
      rng,
      reg: deps.reg,
      constants: deps.constants,
      dun,
      profile,
      depth,
      minHeight,
      minWidth,
      objDeps: deps.objDeps,
      monDeps: deps.monDeps,
      rooms: deps.rooms,
      ...(options.daytime !== undefined ? { daytime: options.daytime } : {}),
    };

    const built = builder(ctx);
    if (!built.gen) {
      error = built.error ?? "unspecified level builder failure";
      continue;
    }

    const g = built.gen;
    clearGenerationFlags(g);

    /* Regenerate levels that overflow the monster maximum. */
    if (g.monsters.length >= deps.constants.levelMonsterMax) {
      error = "too many monsters";
      continue;
    }

    result = g;
  }

  if (error || !result) {
    throw new Error(`gen: cave_generate failed: ${error ?? "unknown"}`);
  }

  /* Place dungeon squares to trigger feeling (not in town), then compute the
   * final feeling (generate.c L1235-1241). Runs once, after the retry loop
   * above has resolved to a successful level; place_feeling's draws are
   * strictly appended to the RNG stream and touch only SQUARE_FEEL flags, so
   * they cannot change any room/monster/object placement already decided. */
  if (depth > 0) {
    placeFeeling(result);
  }
  result.c.feeling =
    calcObjFeeling(result, options.birthLoseArts ?? false) + calcMonFeeling(result);

  return result;
}
