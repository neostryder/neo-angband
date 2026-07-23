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
import { FEAT, RF, SQUARE } from "../generated";
import { MON_GROUP } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import type { Rng } from "../rng";
import type { FeatureRegistry } from "../world/feature";
import type { TrapKind } from "../world/trap";
import { loc } from "../loc";
import type { MakeDeps } from "../obj/make";
import type { CaveBuildContext, DungeonProfiles } from "./cave";
import type { RoomRegistry } from "./room";
import {
  Dun,
  Gen,
  findEmpty,
  placeNewMonster,
  type Connector,
  type MonPlaceDeps,
} from "./util";

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
  /**
   * The trap kind table (trap_info). When present, place_trap picks the kind
   * and rolls the power at generation time (gap 9.2), and the returned Gen's
   * `traps` list carries the choices for the populate path to instantiate
   * directly. Omitted/null keeps the deferred bare-grid behaviour.
   */
  trapKinds?: readonly TrapKind[] | null;
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
  /**
   * Quest guardians to place on this level (generate.c L1172-1191). The caller
   * (session changeLevel) resolves the player's quests whose level == depth to
   * their races; generateLevel places max_num of each (a unique already alive,
   * cur_num > 0, is skipped). Empty/omitted on non-quest levels.
   */
  questSpawns?: readonly QuestSpawn[];
  /**
   * OPT(player, birth_levels_persist): mark this build as a persistent-level
   * dungeon (generate.c L1148-1150). Off by default; when on, the builders'
   * dun.persist branches (staircase joins, always-lit persistent rooms) run.
   */
  persist?: boolean;
  /**
   * get_join_info's result (generate.c L893-992): connectors seeded from the
   * saved stair joins of adjacent levels so up/down stairs line up. The caller
   * (session change-level) resolves adjacent frozen levels and passes their
   * joins through getJoinInfo. Only consulted under `persist`.
   */
  joinInfo?: JoinInfo;
  /**
   * chunk_find_adjacent (gen-chunk.c:147) for this depth: whether the adjacent
   * persistent level above/below has already been generated. Only consulted
   * under `persist`; handle_level_stairs (gen-cave.c:959-966) skips alloc_stairs
   * for a direction whose neighbour exists (its staircase rooms already placed
   * the matching stairs here via the seeded joinInfo). Harmless when persist is
   * off - the gated stair path ignores them.
   */
  hasAdjacentAbove?: boolean;
  hasAdjacentBelow?: boolean;
  /**
   * birth_connect_stairs (gen-util.c:427-433, new_player_spot): lay an arrival
   * staircase on the player's start grid - "up" after a descent, "down" after
   * an ascent - so connected stairs line up. The caller (session changeLevel)
   * resolves it from the pending stair command, already gated on the
   * birth_connect_stairs option; null (recall / arena / first spawn) lays no
   * stair, exactly as upstream leaves create_up_stair/create_down_stair unset.
   */
  createStair?: "down" | "up" | null;
}

/** One quest guardian to place: the resolved race and how many to spawn. */
export interface QuestSpawn {
  race: MonsterRace;
  maxNum: number;
}

/** The connectors get_join_info seeds onto a persistent level's dun_data. */
export interface JoinInfo {
  join: Connector[];
  oneOffAbove: Connector[];
  oneOffBelow: Connector[];
}

/**
 * The saved stair joins (chunk->join) of the levels adjacent to the target
 * depth, resolved by the caller from the frozen-level cache. An entry that is
 * `undefined` means that level has never been generated; an empty array means
 * it exists but recorded no stairs of the relevant kind.
 */
export interface AdjacentJoins {
  /** Level depth-1 (get_join_info: its FEAT_MORE become our FEAT_LESS). */
  above?: readonly Connector[];
  /** Level depth-2 (its FEAT_MORE become one_off_above FEAT_MORE). */
  twoAbove?: readonly Connector[];
  /** Level depth+1 (its FEAT_LESS become our FEAT_MORE). */
  below?: readonly Connector[];
  /** Level depth+2 (its FEAT_LESS become one_off_below FEAT_LESS). */
  twoBelow?: readonly Connector[];
}

/**
 * get_join_info (generate.c L893-992): build the connector seed for a level
 * from the join lists of its (already-generated) neighbours, so a persistent
 * dungeon keeps up/down stairs aligned across depths. Pure - the caller
 * resolves which neighbours exist and supplies their saved joins. Connectors
 * are prepended (unshift), matching upstream's linked-list insertion order.
 */
export function getJoinInfo(adj: AdjacentJoins): JoinInfo {
  const join: Connector[] = [];
  const oneOffAbove: Connector[] = [];
  const oneOffBelow: Connector[] = [];

  /* Level above: its down staircases become our up staircases. */
  if (adj.above) {
    for (const j of adj.above) {
      if (j.feat === FEAT.MORE) join.unshift({ grid: j.grid, feat: FEAT.LESS });
    }
  } else if (adj.twoAbove) {
    /* No level above, but one two levels up: remember its down staircases so
     * our up staircases won't conflict if that level is later generated. */
    for (const j of adj.twoAbove) {
      if (j.feat === FEAT.MORE) {
        oneOffAbove.unshift({ grid: j.grid, feat: FEAT.MORE });
      }
    }
  }

  /* Level below: its up staircases become our down staircases. */
  if (adj.below) {
    for (const j of adj.below) {
      if (j.feat === FEAT.LESS) join.unshift({ grid: j.grid, feat: FEAT.MORE });
    }
  } else if (adj.twoBelow) {
    for (const j of adj.twoBelow) {
      if (j.feat === FEAT.LESS) {
        oneOffBelow.unshift({ grid: j.grid, feat: FEAT.LESS });
      }
    }
  }

  return { join, oneOffAbove, oneOffBelow };
}

/**
 * Collect the finished level's staircases as join connectors
 * (generate.c L1203-1214 populating chunk->join): each stair grid plus its
 * feature. RNG-free; the per-connector SQUARE info copy upstream also makes is
 * a deferred detail (the port's Connector carries grid + feat). Feeds the next
 * level's getJoinInfo when persistent levels are wired.
 *
 * Order matters: upstream PREPENDS each stair (new->next = chunk->join;
 * chunk->join = new, L1212-1213), so chunk->join ends up in reverse scan order
 * (head = last grid scanned). getJoinInfo below re-prepends when it reads a
 * neighbour's list, so this reverse-scan order is what makes the resulting
 * dun.join come out in forward scan order exactly as C's does. Prepending here
 * (unshift) rather than pushing is therefore required for stair-room build
 * order on a first-visit persistent level to match upstream.
 */
export function collectJoins(g: Gen): void {
  const c = g.c;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      if (c.isStairs(grid)) g.joins.unshift({ grid, feat: c.feat(grid) });
    }
  }
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
 * chunk_validate_objects (gen-chunk.c:514): assert the finished level holds no
 * malformed objects (tval == 0) on the floor or in any monster's inventory. A
 * pure validation pass drawing no RNG; a tval-0 object indicates a generation
 * bug, so this throws exactly where upstream's assert would abort.
 */
export function chunkValidateObjects(g: Gen): void {
  for (const po of g.objects) {
    if (po.obj.tval === 0) {
      throw new Error("gen: chunk_validate_objects: floor object with tval 0");
    }
  }
  for (const pm of g.monsters) {
    for (const held of pm.mon.heldObj) {
      if (held.tval === 0) {
        throw new Error("gen: chunk_validate_objects: held object with tval 0");
      }
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
    /* Persistent levels (generate.c L1148-1153): seed the stair connectors from
     * adjacent levels before building so the dun.persist branches line stairs
     * up. Off by default, leaving dun.join empty and every builder unchanged. */
    dun.persist = options.persist ?? false;
    if (dun.persist && options.joinInfo) {
      dun.join = [...options.joinInfo.join];
      dun.oneOffAbove = [...options.joinInfo.oneOffAbove];
      dun.oneOffBelow = [...options.joinInfo.oneOffBelow];
    }
    /* chunk_find_adjacent (gen-chunk.c:147) seed: whether the neighbour levels
     * already exist, so handle_level_stairs skips the matching alloc_stairs.
     * Only read under dun.persist. */
    dun.hasAdjacentAbove = options.hasAdjacentAbove ?? false;
    dun.hasAdjacentBelow = options.hasAdjacentBelow ?? false;

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
      trapKinds: deps.trapKinds ?? null,
      rooms: deps.rooms,
      createStair: options.createStair ?? null,
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

  /* Record the level's stair connectors (generate.c L1203-1214) so a
   * persistent dungeon can align the next level's stairs. RNG-free. */
  collectJoins(result);

  /* Ensure quest monsters (generate.c L1170-1191). Run once on the accepted
   * level, before the feeling calc (quest monsters count toward mon_rating).
   * A unique guardian already alive elsewhere (cur_num > 0) is not re-placed,
   * matching upstream. Sleep=true, group_ok=true, ORIGIN_DROP as in C. */
  if (options.questSpawns && options.questSpawns.length > 0) {
    for (const q of options.questSpawns) {
      if (q.race.flags.has(RF.UNIQUE) && q.race.curNum > 0) continue;
      for (let n = 0; n < q.maxNum; n++) {
        const grid = findEmpty(result);
        if (!grid) break;
        placeNewMonster(result, grid, q.race, true, true, {
          index: 0,
          role: MON_GROUP.LEADER,
        });
      }
    }
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

  /* Validate the dungeon (generate.c L1244): no malformed objects survive. */
  chunkValidateObjects(result);

  return result;
}
