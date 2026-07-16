/**
 * `stats:baseline` entry point: regenerate the committed self-regression
 * baseline (packages/cli/baseline/stats-baseline.json) from the port at the
 * pinned BASELINE_PARAMS. Run this - and review the diff - only after an
 * INTENTIONAL change to generation/allocation.
 */

import { pathToFileURL } from "node:url";
import { loadGamePack } from "./pack";
import { BASELINE_PARAMS, runStatsBatch, serializeReport } from "./stats";
import { BASELINE_URL, writeBaseline } from "./baseline";

function main(): void {
  const pack = loadGamePack();
  const report = runStatsBatch(pack, BASELINE_PARAMS);
  writeBaseline(serializeReport(report));
  process.stderr.write(
    `baseline: wrote ${BASELINE_URL.pathname} ` +
      `(runs=${BASELINE_PARAMS.runs} depths=${BASELINE_PARAMS.depthMin}..${BASELINE_PARAMS.depthMax} ` +
      `seed=${BASELINE_PARAMS.baseSeed})\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
