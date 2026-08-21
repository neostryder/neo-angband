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
 * DEFERRED (ledgered in parity/ledger/gen-framework.yaml): the known-level
 * ("player cave") duplicate. Monster-count overflow is the one upstream
 * post-build regeneration trigger that is kept.
 *
 * Neither arena nor quest levels are deferred, and neither has been for some
 * time. Arena levels are built by arenaGen and driven by session/game.ts
 * (PORT_TODO 4.1). Quest levels are `options.quest`, which forces the classic
 * profile exactly as choose_profile does (generate.c L841), reaches every
 * builder as `dun.quest` - the size_percent = 100 override, handle_level_stairs
 * and every alloc_stairs / place_random_stairs call - and drives the quest
 * guardian placement below (PORT_TODO 4.2).
 *
 * Persistent-level connectors are not deferred either (PORT_TODO 4.3):
 * getJoinInfo, getMinLevelSize and collectJoins are here, the builders honour
 * dun.persist, and session/changeLevel drives all three off the frozen-level
 * cache.
 *
 * NO ADDITIONS BEYOND UPSTREAM. This file holds no fix and no mod's name. It
 * offers ONE extension point - the levelGenerated hook (mod/hooks.ts), consulted
 * on an otherwise-accepted level, which a mod may use to inspect, repair or reject
 * it. With no mod loaded the hook is absent and this loop is a faithful
 * cave_generate, stranded floors included.
 *
 * The staircase-reachability repair used to live in gen/util.ts behind a
 * "bugfix.stairsReachable" flag read here. That put a mod's fix, and a mod's name,
 * inside core; it is now the bug-fixes mod's own code, reaching this loop through
 * the hook like any third-party mod would.
 *
 * Level feeling (generate.c place_feeling / calc_obj_feeling /
 * calc_mon_feeling, L676-761 and L1235-1241) IS ported: placeFeeling scatters
 * feelingTotal hidden SQUARE_FEEL marks (the only RNG this file spends after
 * the retry loop resolves), then the chunk's obj_rating/mon_rating
 * accumulators (populated RNG-free by gen/util.ts placeObject and
 * placeNewMonsterOne during the builder run) are reduced to the final
 * chunk.feeling value.
 */

import type { Constants } from "../constants.js";
import { FEAT, RF, SQUARE } from "../generated/index.js";
import { MON_GROUP } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import type { Rng } from "../rng.js";
import type { FeatureRegistry } from "../world/feature.js";
import type { TrapKind } from "../world/trap.js";
import { loc } from "../loc.js";
import type { MakeDeps } from "../obj/make.js";
import type { CaveBuildContext, DungeonProfiles } from "./cave.js";
import type { RoomRegistry } from "./room.js";
import {
  Dun,
  Gen,
  findEmpty,
  placeNewMonster,
  type Connector,
  type MonPlaceDeps,
} from "./util.js";

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
   * directly. The live composition supplies it (session/boot.ts:239 passes
   * reg.traps); omitted/null keeps the bare-grid behaviour for a worldless
   * caller.
   */
  trapKinds?: readonly TrapKind[] | null;
  /**
   * The mod behaviour seam (mod/hooks.ts), threaded from session/game.ts so the
   * pure generation path can offer its extension point without importing session
   * state. Only `levelGenerated` is consulted here. Absent - always the case with
   * no mod enabled - keeps cave_generate faithful to 4.2.6, unreachable
   * staircases included.
   */
  hooks?: import("../mod/hooks.js").ModHooks | undefined;
  /**
   * The cheat_room readout (generate.c:1164-1166 and :1222-1224): with that
   * cheat option on, upstream narrates every rejected level - both the builder
   * failures and the monster-maximum overflow. Supplied by the session ONLY
   * when cheat_room is set, so pure generation stays silent; the generation
   * layer has no GameState to reach a msg() through, hence the seam (same shape
   * as StoreMaintContext.cheatMsg for cheat_xtra).
   */
  cheatMsg?: (text: string) => void;
  /**
   * msg() for generation messages upstream does NOT gate on a cheat option -
   * new_player_spot's "Failed to place player" (gen-util.c:422). Deliberately a
   * different seam from cheatMsg: sharing one would make an ungated message
   * conditional on cheat_room. The session always supplies this.
   */
  msg?: (text: string) => void;
}

export interface GenerateOptions {
  /** Whether this is a quest level (forces the classic profile). */
  quest?: boolean;
  /**
   * choose_profile's wizard override (generate.c L824-836), the answer to
   * "Profile name (eg classic): ". Unknown or absent falls through to the
   * ordinary depth-based selection.
   */
  profileName?: string | undefined;
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
   * Stored town terrain (chunk_write "Town") for town_gen re-entry without
   * birth_levels_persist (generate.c:1371-1373 / gen-cave.c:2671-2703).
   */
  townLayout?: import("../world/chunk.js").Chunk | null;
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
  /** Level depth-1 (get_join_info: its FEAT_MORE become this level's FEAT_LESS). */
  above?: readonly Connector[];
  /** Level depth-2 (its FEAT_MORE become one_off_above FEAT_MORE). */
  twoAbove?: readonly Connector[];
  /** Level depth+1 (its FEAT_LESS become this level's FEAT_MORE). */
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

  /* Level above: its down staircases become this level's up staircases. */
  if (adj.above) {
    for (const j of adj.above) {
      if (j.feat === FEAT.MORE) join.unshift({ grid: j.grid, feat: FEAT.LESS });
    }
  } else if (adj.twoAbove) {
    /* No level above, but one two levels up: remember its down staircases so
     * this level's up staircases won't conflict if that level is later generated. */
    for (const j of adj.twoAbove) {
      if (j.feat === FEAT.MORE) {
        oneOffAbove.unshift({ grid: j.grid, feat: FEAT.MORE });
      }
    }
  }

  /* Level below: its up staircases become this level's down staircases. */
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
 * get_min_level_size (generate.c L997-1013): the minimum dimensions a level
 * must be generated at so that the stairs of an already-frozen neighbour can
 * be reproduced on it. Each relevant connector needs its grid to exist with a
 * wall beyond it, hence `+ 2`.
 *
 * `above` selects which neighbour is being measured, exactly as upstream: for
 * the level ABOVE the target, this takes its DOWN staircases (FEAT_MORE), because
 * those become this level's up staircases; for the level BELOW, its up staircases.
 *
 * Called by prepare_next_level (L1531-1546) only on the persistent first-visit
 * path, and threaded into the builders as ctx.minHeight / ctx.minWidth. It is
 * NOT decoration: build_staircase_rooms quits outright when a seeded connector
 * has no room on the level (gen-cave.c L925-934, `quit("Failed to place
 * stairs")`), so a level generated smaller than its neighbour's deepest stair
 * is an abort, not a cosmetic mismatch.
 */
export function getMinLevelSize(
  join: readonly Connector[],
  above: boolean,
  min: { height: number; width: number } = { height: 0, width: 0 },
): { height: number; width: number } {
  const want = above ? FEAT.MORE : FEAT.LESS;
  let { height, width } = min;
  for (const j of join) {
    if (j.feat !== want) continue;
    height = Math.max(height, j.grid.y + 2);
    width = Math.max(width, j.grid.x + 2);
  }
  return { height, width };
}

/**
 * Collect the finished level's staircases as join connectors
 * (generate.c L1203-1214 populating chunk->join): each stair grid, its feature
 * and a copy of its SQUARE info bytes (L1208-1211). Feeds the next level's
 * getJoinInfo.
 *
 * The info copy has no reader in 4.2.6 - get_join_info builds fresh connectors
 * and sets only grid/feat, transform_join_list does the same, and build_staircase
 * reads only the grid; the bytes exist to be written to and read back from the
 * savefile (save.c L850-866 / load.c L1366-1379) and are then freed. It is
 * carried here anyway because that is what the original stores, and an absent
 * field invites the same "is this a gap?" question every time somebody reads
 * this function.
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
      if (c.isStairs(grid)) {
        g.joins.unshift({
          grid,
          feat: c.feat(grid),
          info: Array.from(c.info(grid).bits),
        });
      }
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
      /* square_ismon_restrict (cave-square.c:530) reads this flag. */
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

    const profile = deps.profiles.choose(rng, depth, {
      quest,
      ...(options.profileName ? { name: options.profileName } : {}),
    });
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
      /* new_player_spot's placement-failure message (gen-util.c:422). Kept
       * separate from cheatMsg: that one is gated on cheat_room, this one is
       * not, so they cannot share a sink. */
      ...(deps.msg ? { msg: deps.msg } : {}),
      ...(options.daytime !== undefined ? { daytime: options.daytime } : {}),
      ...(options.townLayout ? { townLayout: options.townLayout } : {}),
    };

    const built = builder(ctx);
    if (!built.gen) {
      error = built.error ?? "unspecified level builder failure";
      /* generate.c:1164-1166: cheat_room narrates every restart. */
      deps.cheatMsg?.(`Generation restarted: ${error}.`);
      continue;
    }

    const g = built.gen;
    clearGenerationFlags(g);

    /* Regenerate levels that overflow the monster maximum. */
    if (g.monsters.length >= deps.constants.levelMonsterMax) {
      error = "too many monsters";
      deps.cheatMsg?.(`Generation restarted: ${error}.`);
      continue;
    }

    /*
     * The finished-level seam (mod/hooks.ts levelGenerated). A mod gets the
     * accepted level and may inspect it, repair it, or refuse it - refusing
     * re-rolls, the same treatment as the monster-maximum overflow above.
     *
     * Faithful core has no opinion here: with no hook installed this is one
     * undefined check and the level is accepted exactly as generated. The hook
     * is contractually RNG-FREE (it is handed no rng) because a single draw at
     * this point would desynchronise every draw after it and a seed would stop
     * reproducing its dungeon - so a repair that happens is bit-identical to no
     * repair on a level that needed none.
     */
    if (deps.hooks?.levelGenerated?.(g, dun.quest) === false) {
      error = "level rejected by a mod";
      deps.cheatMsg?.(`Generation restarted: ${error}.`);
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
