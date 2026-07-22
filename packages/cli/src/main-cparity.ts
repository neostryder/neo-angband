/**
 * `c-parity` dev tool: run the TS port's stats over the same depth range as the
 * committed C baseline (baseline/c-stats-baseline.json) and print the
 * distribution diff (rates, statistical tolerance, C-covered metrics only).
 *
 * This is the human-facing view of the same comparison the parity-c vitest
 * asserts. Usage:
 *   node --import ./register.mjs dist/main-cparity.js [runs] [depthMax]
 */

import { pathToFileURL } from "node:url";
import { loadGamePack } from "./pack";
import { runStatsBatch, type StatsReport } from "./stats";
import {
  loadCBaseline,
  compareReports,
  formatCompareResult,
  STATISTICAL_TOLERANCE,
} from "./baseline";
import { C_RECORD_METRICS, C_SCALAR_METRICS } from "./c-stats";

/** Keep only the depths <= depthMax so the depth sets match for comparison. */
function sliceDepths(report: StatsReport, depthMax: number): StatsReport {
  const depths: StatsReport["depths"] = {};
  for (const [k, v] of Object.entries(report.depths)) {
    if (Number(k) <= depthMax) depths[k] = v;
  }
  return { ...report, depths };
}

function main(): void {
  const cbase = loadCBaseline();
  if (!cbase) {
    process.stderr.write("no C baseline; run main-cimport first\n");
    process.exit(2);
  }
  const runs = process.argv[2] ? Number(process.argv[2]) : 30;
  const depthMax = process.argv[3]
    ? Number(process.argv[3])
    : cbase.meta.depthMax;

  const port = runStatsBatch(loadGamePack(), {
    runs,
    depthMin: cbase.meta.depthMin,
    depthMax,
    baseSeed: 1337,
    race: "Human",
    class: "Warrior",
    randarts: false,
  });

  const c = sliceDepths(cbase, depthMax);
  const result = compareReports(c, port, {
    tolerance: STATISTICAL_TOLERANCE,
    normalizeByLevels: true,
    scalarKeys: C_SCALAR_METRICS,
    recordKeys: C_RECORD_METRICS,
  });
  process.stdout.write(
    `C-vs-TS parity (runs=${runs}, depths ${cbase.meta.depthMin}..${depthMax}, ` +
      `rate tol abs=${STATISTICAL_TOLERANCE.abs} rel=${STATISTICAL_TOLERANCE.rel})\n`,
  );
  process.stdout.write(formatCompareResult(result) + "\n");
  process.stdout.write(`total out-of-tolerance: ${result.diffs.length}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
