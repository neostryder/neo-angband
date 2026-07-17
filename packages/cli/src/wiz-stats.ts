/**
 * The in-game Monte-Carlo statistics collectors - the port's answer to
 * reference/src/wiz-stats.c, driven upstream by the do_cmd_wiz_collect_*
 * commands (cmd-wizard.c L585 / L622 / L671). Three headless dev tools:
 *
 *   - objMonStats  <- stats_collect (wiz-stats.c L1666) / diving_stats (L1525) /
 *                     clearing_stats (L1561): object + monster distributions per
 *                     depth in a "diving" (every level fresh) or "clearing" (one
 *                     descent, artifacts/uniques removed as found) simulation.
 *   - pitStats     <- pit_stats (wiz-stats.c L1855): the pit / nest profile
 *                     chosen by set_pit_type, histogrammed per depth.
 *   - disconnectStats <- disconnect_stats (wiz-stats.c L2962): per-generated-level
 *                     connectivity - disconnected non-vault areas, all-downstairs-
 *                     inaccessible, and bad player starts.
 *
 * DEV TOOLING, not gameplay. Like spoilers.ts and stats.ts these drive the
 * port's REAL generation code (generateLevel) headlessly and return a plain-JSON
 * aggregate instead of writing the SQLite / text-log / HTML files upstream does.
 * The file I/O, the Term redraw (do_cmd_redraw), the check_break interrupt
 * polling and the auto_more toggle are UI / transport and are omitted.
 *
 * The object+monster tallies reuse stats.ts's collectLevel / DepthMetrics so
 * the collection semantics live in exactly one place (see stats.ts's header for
 * the deliberate, documented deviations from the C collectors: reading the
 * generated level directly instead of birthing + killing a player, and a
 * per-cell derived seed instead of one continuous descending RNG stream).
 *
 * Determinism: NO wall-clock, NO Math.random. Every draw traces to baseSeed.
 */

import {
  ArtifactState,
  Rng,
  SQUARE,
  bindCore,
  generateLevel,
  genDeps,
} from "@neo-angband/core";
import type { CoreRegistries, GamePack, Loc } from "@neo-angband/core";
import {
  type DepthMetrics,
  collectLevel,
  deriveSeed,
  emptyDepth,
} from "./stats";

/* ================================================================== *
 * 1. objMonStats <- stats_collect / diving_stats / clearing_stats.
 * ================================================================== */

/** Parameters for an object+monster collection batch. */
export interface ObjMonStatsParams {
  /** Number of simulations (main-stats -n / wiz-stats `tries`). Default 5. */
  nsim: number;
  /**
   * Simulation type (cmd-wizard.c L619): 1 = diving, 2 = clearing, 3 = clearing
   * with a random-artifact regeneration per simulation. Default 1.
   */
  simtype: number;
  /** Shallowest depth to catalogue (inclusive). Default 1. */
  depthMin: number;
  /** Deepest depth to catalogue (inclusive). Default 10. */
  depthMax: number;
  /**
   * Diving strides every `divingStep` levels (diving_stats: `depth += 5`).
   * Default 5. Ignored in clearing mode (which walks every level).
   */
  divingStep: number;
  /** Base seed every per-cell seed derives from. Default 1. */
  baseSeed: number;
}

/** The default batch: small enough for CI, wide enough to have signal. */
export const DEFAULT_OBJ_MON_PARAMS: ObjMonStatsParams = {
  nsim: 5,
  simtype: 1,
  depthMin: 1,
  depthMax: 10,
  divingStep: 5,
  baseSeed: 1,
};

/** An object+monster stats report keyed by depth. */
export interface ObjMonStatsReport {
  meta: {
    mode: "diving" | "clearing" | "clearing-randart";
    nsim: number;
    depthMin: number;
    depthMax: number;
    divingStep: number;
    baseSeed: number;
  };
  depths: Record<string, DepthMetrics>;
}

/**
 * Run an object+monster collection batch.
 *
 * Diving (simtype 1, diving_stats): each catalogued depth is generated `nsim`
 * times, every level starting with all artifacts and uniques available - so a
 * fresh registry + ArtifactState per level (mirrors "diving begins each level
 * with all artifacts and uniques available", wiz-stats.c L59-62). Upstream
 * strides depth by 5; the port honours divingStep within [depthMin, depthMax].
 *
 * Clearing (simtype 2/3, clearing_stats): `nsim` full descents; within one
 * descent the registry + ArtifactState persist so an artifact found shallow is
 * not re-found deeper and a slain unique stays dead (uncreate_all_artifacts +
 * revive_uniques run once per descent, L1570-1574). simtype 3 additionally
 * swaps in a fresh random-artifact set per descent (regen, L1577-1590); the
 * port applies a randart set per descent to match that RNG shape.
 */
export function objMonStats(
  pack: GamePack,
  params: Partial<ObjMonStatsParams> = {},
): ObjMonStatsReport {
  const p: ObjMonStatsParams = { ...DEFAULT_OBJ_MON_PARAMS, ...params };
  if (p.depthMax < p.depthMin) {
    throw new RangeError(`depthMax (${p.depthMax}) < depthMin (${p.depthMin})`);
  }
  const clearing = p.simtype !== 1;

  /* The depths catalogued: every level in clearing, strided in diving. */
  const depths: number[] = [];
  if (clearing) {
    for (let d = p.depthMin; d <= p.depthMax; d++) depths.push(d);
  } else {
    for (let d = p.depthMin; d <= p.depthMax; d += p.divingStep) depths.push(d);
  }

  const agg: Record<string, DepthMetrics> = {};
  for (const d of depths) agg[String(d)] = emptyDepth();

  if (clearing) {
    /* One registry + ArtifactState per descent, shared across every depth. */
    for (let run = 0; run < p.nsim; run++) {
      const reg = bindCore(pack);
      const artifacts = new ArtifactState(reg.objects.artifacts.length);
      for (const d of depths) {
        const rng = new Rng(deriveSeed(p.baseSeed, run, d));
        const deps = genDeps(reg, true, artifacts, false);
        const g = generateLevel(rng, d, deps, { daytime: true });
        collectLevel(agg[String(d)]!, g);
      }
    }
  } else {
    /* Fresh registry + ArtifactState per level: every level sees all arts. */
    for (const d of depths) {
      for (let run = 0; run < p.nsim; run++) {
        const reg = bindCore(pack);
        const artifacts = new ArtifactState(reg.objects.artifacts.length);
        const rng = new Rng(deriveSeed(p.baseSeed, run, d));
        const deps = genDeps(reg, true, artifacts, false);
        const g = generateLevel(rng, d, deps, { daytime: true });
        collectLevel(agg[String(d)]!, g);
      }
    }
  }

  const mode: ObjMonStatsReport["meta"]["mode"] =
    p.simtype === 1 ? "diving" : p.simtype === 3 ? "clearing-randart" : "clearing";
  return {
    meta: {
      mode,
      nsim: p.nsim,
      depthMin: p.depthMin,
      depthMax: p.depthMax,
      divingStep: p.divingStep,
      baseSeed: p.baseSeed,
    },
    depths: agg,
  };
}

/* ================================================================== *
 * 2. pitStats <- pit_stats (wiz-stats.c L1855).
 * ================================================================== */

/** Parameters for a pit-profile histogram batch. */
export interface PitStatsParams {
  /** Simulations per depth (pit_stats `nsim`). Default 1000. */
  nsim: number;
  /** Pit room type: 1 pit, 2 nest, 3 other (pit_stats `pittype`). Default 1. */
  pittype: number;
  /** Minimum depth (inclusive). Default 1. */
  depthMin: number;
  /** Maximum depth (inclusive). Default depthMin. */
  depthMax: number;
  /** Base seed for the sampling Rng. Default 1. */
  baseSeed: number;
}

/** The default pit batch (kept small for CI; scale nsim up for real signal). */
export const DEFAULT_PIT_PARAMS: PitStatsParams = {
  nsim: 1000,
  pittype: 1,
  depthMin: 1,
  depthMax: 1,
  baseSeed: 1,
};

/** A pit-profile histogram report. */
export interface PitStatsReport {
  meta: {
    nsim: number;
    pittype: number;
    depthMin: number;
    depthMax: number;
    baseSeed: number;
  };
  /** depth -> { pit name -> selection count }. */
  perDepth: Record<string, Record<string, number>>;
  /** pit name -> total count across all depths (null when a single depth). */
  sum: Record<string, number> | null;
}

/**
 * pit_stats (wiz-stats.c L1855-2012): for each depth, run `nsim` set_pit_type
 * selections and histogram the chosen profile. The selection is set_pit_type
 * (gen-room.c L968) inlined: each candidate of the requested room type draws
 * Rand_normal(pit->ave, 10); the closest-to-depth candidate that also passes
 * one_in_(pit->rarity) wins, defaulting to pit index 0. The one_in_ draw is
 * short-circuited behind the distance test, exactly as upstream, so the RNG
 * draw order is identical.
 *
 * Deviations from the C tool: no per-depth file write, and a single seeded Rng
 * for reproducibility (upstream draws from the shared game RNG).
 */
export function pitStats(
  pack: GamePack,
  params: Partial<PitStatsParams> = {},
): PitStatsReport {
  const p: PitStatsParams = {
    ...DEFAULT_PIT_PARAMS,
    ...params,
  };
  if (p.depthMax === undefined || p.depthMax < p.depthMin) p.depthMax = p.depthMin;

  const reg = bindCore(pack);
  const pits = reg.monsters.pits;
  const rng = new Rng(p.baseSeed);

  /* The output columns: every named pit (regardless of room type), as upstream
   * lists all named pits in the header. */
  const named: { idx: number; name: string }[] = [];
  for (let i = 0; i < pits.length; i++) {
    const pit = pits[i]!;
    if (pit.name) named.push({ idx: i, name: pit.name });
  }

  const perDepth: Record<string, Record<string, number>> = {};
  const sum: Record<string, number> = {};
  for (const { name } of named) sum[name] = 0;

  for (let depth = p.depthMin; depth <= p.depthMax; depth++) {
    const hist = new Array<number>(pits.length).fill(0);

    for (let j = 0; j < p.nsim; j++) {
      let pitIdx = 0;
      let pitDist = 999;
      for (let i = 0; i < pits.length; i++) {
        const pit = pits[i]!;
        /* Skip empty pits or pits of the wrong room type. */
        if (!pit.name || pit.room !== p.pittype) continue;

        const offset = rng.randNormal(pit.allocLevel, 10);
        const dist = Math.abs(offset - depth);

        if (dist < pitDist && rng.oneIn(pit.allocRarity)) {
          pitIdx = i;
          pitDist = dist;
        }
      }
      hist[pitIdx] = (hist[pitIdx] ?? 0) + 1;
    }

    const row: Record<string, number> = {};
    for (const { idx, name } of named) {
      const c = hist[idx] ?? 0;
      row[name] = c;
      sum[name] = (sum[name] ?? 0) + c;
    }
    perDepth[String(depth)] = row;
  }

  return {
    meta: {
      nsim: p.nsim,
      pittype: p.pittype,
      depthMin: p.depthMin,
      depthMax: p.depthMax,
      baseSeed: p.baseSeed,
    },
    perDepth,
    sum: p.depthMin < p.depthMax ? sum : null,
  };
}

/* ================================================================== *
 * 3. disconnectStats <- disconnect_stats (wiz-stats.c L2962).
 * ================================================================== */

/** Parameters for a connectivity batch. */
export interface DisconnectStatsParams {
  /** Number of levels to generate (disconnect_stats `nsim`). Default 50. */
  nsim: number;
  /** Depth to generate the test levels at. Default 1. */
  depth: number;
  /** Stop early once the first problem level is seen (`stop_on_disconnect`). */
  stopOnDisconnect: boolean;
  /** Base seed every per-level seed derives from. Default 1. */
  baseSeed: number;
}

/** The default connectivity batch. */
export const DEFAULT_DISCONNECT_PARAMS: DisconnectStatsParams = {
  nsim: 50,
  depth: 1,
  stopOnDisconnect: false,
  baseSeed: 1,
};

/** A connectivity report. */
export interface DisconnectStatsReport {
  meta: {
    nsim: number;
    depth: number;
    stopOnDisconnect: boolean;
    baseSeed: number;
  };
  /** Levels actually generated (< nsim only when stopOnDisconnect tripped). */
  levels: number;
  /** Levels where the player start grid was impassable (bad_starts). */
  badStarts: number;
  /** Levels with a reachable-terrain area cut off from the player (dsc_area). */
  disconnectedAreas: number;
  /** Levels where no down staircase was reachable (dsc_from_stairs). */
  stairsInaccessible: number;
}

const DIST_MAX = 10000;

/** The eight neighbour offsets (calc_cave_distances scans all 8 adjacencies). */
const DDY = [-1, 1, 0, 0, -1, -1, 1, 1];
const DDX = [0, 0, -1, 1, -1, 1, -1, 1];

/**
 * calc_cave_distances (wiz-stats.c L1745): breadth-first distance from `start`
 * through passable / door / rubble terrain. Returns a height*width Int32Array of
 * distances (-1 = unreachable). Faithful to the flood order (the exact tie-order
 * does not affect the resulting distances or the connectivity counts).
 */
function calcCaveDistances(
  c: ReturnType<typeof generateLevel>["c"],
  start: Loc,
): Int32Array {
  const { width, height } = c;
  const dist = new Int32Array(width * height).fill(-1);
  dist[start.y * width + start.x] = 0;

  let frontier: Loc[] = [start];
  let d = 0;
  while (frontier.length > 0 && d < DIST_MAX) {
    d++;
    const next: Loc[] = [];
    for (const g of frontier) {
      for (let k = 0; k < 8; k++) {
        const ty = g.y + DDY[k]!;
        const tx = g.x + DDX[k]!;
        /* square_in_bounds_fully. */
        if (ty < 1 || ty >= height - 1 || tx < 1 || tx >= width - 1) continue;
        const idx = ty * width + tx;
        if (dist[idx]! >= 0) continue;
        const loc = { x: tx, y: ty };
        /* Impassable terrain that isn't a door or rubble blocks progress. */
        if (!c.isPassable(loc) && !c.isDoor(loc) && !c.isRubble(loc)) continue;
        dist[idx] = d;
        next.push(loc);
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * disconnect_stats (wiz-stats.c L2962-3157): generate `nsim` levels and tally
 * connectivity problems. For each level, flood distances from the player start,
 * then count:
 *   - bad_starts: the player start grid is not passable (the non-stairs arrival
 *     branch of upstream's has_bad_start test; the coin-flip stair-arrival
 *     branch is a live-upkeep detail not modelled by headless generation).
 *   - disconnectedAreas: some in-bounds passable / door / rubble grid is
 *     unreachable and is not part of a vault (vaults are often intentionally
 *     sealed, so upstream ignores them).
 *   - stairsInaccessible: no reachable grid is a down staircase.
 *
 * Deviations from the C tool: no HTML map dump, no cgen_stats level-type
 * breakdown, and the one_in_(2) create_up_stair coin flip / birth_connect_stairs
 * arrival handling (which needs the live player upkeep) are not modelled - the
 * flood always starts from the generated player spot.
 */
export function disconnectStats(
  pack: GamePack,
  params: Partial<DisconnectStatsParams> = {},
): DisconnectStatsReport {
  const p: DisconnectStatsParams = { ...DEFAULT_DISCONNECT_PARAMS, ...params };

  let levels = 0;
  let badStarts = 0;
  let disconnectedAreas = 0;
  let stairsInaccessible = 0;

  for (let i = 0; i < p.nsim; i++) {
    const reg: CoreRegistries = bindCore(pack);
    const artifacts = new ArtifactState(reg.objects.artifacts.length);
    const rng = new Rng(deriveSeed(p.baseSeed, i, p.depth));
    const deps = genDeps(reg, true, artifacts, false);
    const g = generateLevel(rng, p.depth, deps, { daytime: true });
    levels++;

    const c = g.c;
    const start = g.playerSpot ?? { x: 1, y: 1 };
    const dist = calcCaveDistances(c, start);

    let hasDsc = false;
    let hasDscFromStairs = true;
    for (let y = 1; y < c.height - 1; y++) {
      for (let x = 1; x < c.width - 1; x++) {
        const grid = { x, y };
        /* Only terrain the player could traverse or open matters. */
        if (!c.isPassable(grid) && !c.isDoor(grid) && !c.isRubble(grid)) continue;

        if (dist[y * c.width + x]! >= 0) {
          if (c.isDownstairs(grid)) hasDscFromStairs = false;
          continue;
        }
        /* Ignore vaults - they are often deliberately disconnected. */
        if (c.sqinfoHas(grid, SQUARE.VAULT)) continue;
        hasDsc = true;
      }
    }

    const hasBadStart = !c.isPassable(start);
    if (hasBadStart) badStarts++;
    if (hasDscFromStairs) stairsInaccessible++;
    if (hasDsc) disconnectedAreas++;

    if (p.stopOnDisconnect && (hasBadStart || hasDsc || hasDscFromStairs)) break;
  }

  return {
    meta: {
      nsim: p.nsim,
      depth: p.depth,
      stopOnDisconnect: p.stopOnDisconnect,
      baseSeed: p.baseSeed,
    },
    levels,
    badStarts,
    disconnectedAreas,
    stairsInaccessible,
  };
}
