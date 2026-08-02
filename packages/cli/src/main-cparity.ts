/**
 * `c-parity` dev tool: where the port's generation distributions sit relative to
 * the committed C baseline (baseline/c-stats-baseline.json), per depth, per
 * metric.
 *
 * **THIS IS A DIAGNOSTIC AND NOT THE PARITY GATE.** It compares means against a
 * fixed +/-tolerance band, which is an instrument that cannot tell a real
 * divergence from an under-sampled one - the exact reason
 * `parity-c-stat.test.ts` replaced it. Per-level monster count has a standard
 * deviation near 17 on a mean near 46, so at this tool's default 30 runs the
 * band is well inside one standard error and it duly reports a hundred-odd
 * "failures" that are sampling noise. It printed `parity: FAIL` while doing so,
 * which is a verdict it has no power to reach; it now reports a count and says
 * what the count means.
 *
 * The gate is:
 *
 *   NEO_PARITY_RUNS=1000 npx vitest run packages/cli/src/parity-c-stat.test.ts
 *
 * - hypothesis tests, Bonferroni-corrected across the family, alpha = 0.01.
 *
 * What this tool is still good for: once the gate says something is wrong,
 * seeing WHERE - which depth, which metric, in which direction.
 *
 * Usage: node dist/main-cparity.js [runs] [depthMax]
 */

import { pathToFileURL } from "node:url";
import { loadGamePack } from "./pack.js";
import { runStatsBatch, type StatsReport } from "./stats.js";
import {
  loadCBaseline,
  compareReports,
  formatCompareResult,
  STATISTICAL_TOLERANCE,
} from "./baseline.js";
import { C_RECORD_METRICS, C_SCALAR_METRICS } from "./c-stats.js";

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
    `C-vs-TS distribution diff - A DIAGNOSTIC, NOT THE PARITY GATE.\n` +
      `port runs=${runs}, C baseline runs=${cbase.meta.runs ?? "?"}, ` +
      `depths ${cbase.meta.depthMin}..${depthMax}, ` +
      `band abs=${STATISTICAL_TOLERANCE.abs} rel=${STATISTICAL_TOLERANCE.rel}\n\n`,
  );
  /* Strip the verdict line the shared formatter opens with. It is correct for
   * the port-vs-port baseline that formatter also serves - that comparison is
   * zero-tolerance against the port's own last-accepted output, so a diff there
   * IS a regression - and it is wrong here, where a diff is as likely to be the
   * sample size as the generator. */
  const body = formatCompareResult(result).replace(/^parity: (FAIL|OK[^\n]*)\n?/u, "");
  if (body.trim()) process.stdout.write(body + "\n\n");
  process.stdout.write(
    `${result.diffs.length} metric(s) outside the band at ${runs} runs.\n` +
      `This number is NOT a defect count. A fixed band cannot separate a real\n` +
      `divergence from sampling noise: per-level monster count has an sd near 17\n` +
      `on a mean near 46, so +/-2 is about one standard error at 100 levels.\n\n` +
      `The gate, which states its own resolving power and corrects for the\n` +
      `family size, is:\n` +
      `  NEO_PARITY_RUNS=1000 npx vitest run packages/cli/src/parity-c-stat.test.ts\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
