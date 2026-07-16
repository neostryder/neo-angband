/**
 * `stats` entry point: run the full Monte-Carlo harness and print/write the
 * report. Deterministic (all draws trace to --seed); no wall-clock.
 *
 * Usage: node dist/main-stats.js [--runs N] [--depth-min N] [--depth-max N]
 *          [--seed N] [--race NAME] [--class NAME] [--randarts]
 *          [--out FILE] [--summary]
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

function parseArgs(argv: string[]): {
  params: Partial<StatsParams>;
  out: string | null;
  summary: boolean;
} {
  const params: Partial<StatsParams> = {};
  let out: string | null = null;
  let summary = false;
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
      case "--": break; /* pnpm run forwards a bare -- separator; ignore it. */
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { params, out, summary };
}

function main(): void {
  const { params, out, summary } = parseArgs(process.argv.slice(2));
  const merged = { ...DEFAULT_STATS_PARAMS, ...params };
  const pack = loadGamePack();
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
