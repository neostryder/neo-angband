/**
 * `stats` entry point: run the full Monte-Carlo harness and print/write the
 * report. Deterministic (all draws trace to --seed); no wall-clock.
 *
 * Also dispatches the in-game wizard collectors (wiz-stats.ts <- wiz-stats.c)
 * so objMonStats / pitStats / disconnectStats and their DEFAULT_* params sit
 * on a live CLI entry path (W2-017…W2-022; cmd-core.c:132-133).
 *
 * Usage: node dist/main-stats.js [--runs N] [--depth-min N] [--depth-max N]
 *          [--seed N] [--race NAME] [--class NAME] [--randarts]
 *          [--out FILE] [--summary]
 *          [--wiz-objmon] [--wiz-pits] [--wiz-disconnect]
 *          [--nsim N] [--simtype N] [--pittype N] [--depth N]
 *          [--stop-on-disconnect]
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadGamePack } from "./pack";
import {
  DEFAULT_STATS_PARAMS,
  runStatsBatch,
  serializeReport,
  summarizeReport,
} from "./stats";
import type { StatsParams } from "./stats";
import {
  DEFAULT_DISCONNECT_PARAMS,
  DEFAULT_OBJ_MON_PARAMS,
  DEFAULT_PIT_PARAMS,
  disconnectStats,
  objMonStats,
  pitStats,
} from "./wiz-stats";

type WizMode = "objmon" | "pits" | "disconnect" | null;

function parseArgs(argv: string[]): {
  params: Partial<StatsParams>;
  out: string | null;
  summary: boolean;
  wiz: WizMode;
  nsim: number | undefined;
  simtype: number | undefined;
  pittype: number | undefined;
  depth: number | undefined;
  stopOnDisconnect: boolean;
} {
  const params: Partial<StatsParams> = {};
  let out: string | null = null;
  let summary = false;
  let wiz: WizMode = null;
  let nsim: number | undefined;
  let simtype: number | undefined;
  let pittype: number | undefined;
  let depth: number | undefined;
  let stopOnDisconnect = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--runs": params.runs = Number(next()); break;
      case "--depth-min": params.depthMin = Number(next()); break;
      case "--depth-max": params.depthMax = Number(next()); break;
      case "--seed": params.baseSeed = Number(next()); break;
      case "--race": params.race = next(); break;
      case "--class": params.class = next(); break;
      case "--randarts": params.randarts = true; break;
      case "--out": out = next(); break;
      case "--summary": summary = true; break;
      case "--wiz-objmon": wiz = "objmon"; break;
      case "--wiz-pits": wiz = "pits"; break;
      case "--wiz-disconnect": wiz = "disconnect"; break;
      case "--nsim": nsim = Number(next()); break;
      case "--simtype": simtype = Number(next()); break;
      case "--pittype": pittype = Number(next()); break;
      case "--depth": depth = Number(next()); break;
      case "--stop-on-disconnect": stopOnDisconnect = true; break;
      case "--": break; /* pnpm run forwards a bare -- separator; ignore it. */
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return {
    params,
    out,
    summary,
    wiz,
    nsim,
    simtype,
    pittype,
    depth,
    stopOnDisconnect,
  };
}

/**
 * Live dispatch into wiz-stats collectors. Uses DEFAULT_* params as the base
 * so those constants are reachable from this entry (W2-020…W2-022).
 */
export function runWizStats(
  pack: ReturnType<typeof loadGamePack>,
  opts: {
    wiz: Exclude<WizMode, null>;
    nsim?: number;
    simtype?: number;
    pittype?: number;
    depth?: number;
    depthMin?: number;
    depthMax?: number;
    baseSeed?: number;
    stopOnDisconnect?: boolean;
  },
): unknown {
  const seed = opts.baseSeed;
  if (opts.wiz === "objmon") {
    return objMonStats(pack, {
      ...DEFAULT_OBJ_MON_PARAMS,
      ...(opts.nsim !== undefined ? { nsim: opts.nsim } : {}),
      ...(opts.simtype !== undefined ? { simtype: opts.simtype } : {}),
      ...(opts.depthMin !== undefined ? { depthMin: opts.depthMin } : {}),
      ...(opts.depthMax !== undefined ? { depthMax: opts.depthMax } : {}),
      ...(seed !== undefined ? { baseSeed: seed } : {}),
    });
  }
  if (opts.wiz === "pits") {
    return pitStats(pack, {
      ...DEFAULT_PIT_PARAMS,
      ...(opts.nsim !== undefined ? { nsim: opts.nsim } : {}),
      ...(opts.pittype !== undefined ? { pittype: opts.pittype } : {}),
      ...(opts.depthMin !== undefined ? { depthMin: opts.depthMin } : {}),
      ...(opts.depthMax !== undefined ? { depthMax: opts.depthMax } : {}),
      ...(opts.depth !== undefined
        ? { depthMin: opts.depth, depthMax: opts.depth }
        : {}),
      ...(seed !== undefined ? { baseSeed: seed } : {}),
    });
  }
  return disconnectStats(pack, {
    ...DEFAULT_DISCONNECT_PARAMS,
    ...(opts.nsim !== undefined ? { nsim: opts.nsim } : {}),
    ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    ...(opts.stopOnDisconnect ? { stopOnDisconnect: true } : {}),
    ...(seed !== undefined ? { baseSeed: seed } : {}),
  });
}

function main(): void {
  const {
    params,
    out,
    summary,
    wiz,
    nsim,
    simtype,
    pittype,
    depth,
    stopOnDisconnect,
  } = parseArgs(process.argv.slice(2));
  const pack = loadGamePack();

  if (wiz) {
    const report = runWizStats(pack, {
      wiz,
      ...(nsim !== undefined ? { nsim } : {}),
      ...(simtype !== undefined ? { simtype } : {}),
      ...(pittype !== undefined ? { pittype } : {}),
      ...(depth !== undefined ? { depth } : {}),
      ...(params.depthMin !== undefined ? { depthMin: params.depthMin } : {}),
      ...(params.depthMax !== undefined ? { depthMax: params.depthMax } : {}),
      ...(params.baseSeed !== undefined ? { baseSeed: params.baseSeed } : {}),
      stopOnDisconnect,
    });
    const json = JSON.stringify(report, null, 2);
    if (out) {
      writeFileSync(out, json);
      process.stderr.write(`stats: wrote ${out}\n`);
    }
    if (summary || !out) {
      process.stderr.write(`stats: wiz-${wiz} complete\n`);
    }
    if (!out) process.stdout.write(json);
    return;
  }

  const merged = { ...DEFAULT_STATS_PARAMS, ...params };
  const report = runStatsBatch(pack, merged);
  const json = serializeReport(report);
  if (out) {
    writeFileSync(out, json);
    process.stderr.write(`stats: wrote ${out}\n`);
  }
  if (summary || !out) {
    process.stderr.write(summarizeReport(report) + "\n");
  }
  if (!out) process.stdout.write(json);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
