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
 * levels, persistent-level connectors, level feeling calculation and the
 * known-level ("player cave") duplicate. Monster-count overflow is the one
 * upstream post-build regeneration trigger that is kept.
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
  return result;
}
