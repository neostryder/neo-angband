/**
 * `c-baseline` entry point: import a C main-stats SQLite database into the
 * committed upstream parity baseline (packages/cli/baseline/c-stats-baseline.json).
 *
 * Usage:
 *   node --import ./register.mjs dist/main-cimport.js <stats.db> [depthMax]
 *
 * See packages/cli/baseline/README.md for how to build the C main-stats tool
 * and produce <stats.db>. The sqlite3 CLI must be on PATH (or set $NEO_SQLITE3).
 */

import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { importCStats } from "./c-stats";
import { serializeReport } from "./stats";
import { C_BASELINE_URL } from "./baseline";

function main(): void {
  const db = process.argv[2];
  if (!db) {
    process.stderr.write(
      "usage: main-cimport <stats.db> [depthMax]\n",
    );
    process.exit(2);
  }
  const report = importCStats(
    db,
    process.argv[3] ? { depthMax: Number(process.argv[3]) } : {},
  );
  const outPath = fileURLToPath(C_BASELINE_URL);
  writeFileSync(outPath, serializeReport(report));
  process.stderr.write(
    `c-baseline: wrote ${outPath} ` +
      `(depths ${report.meta.depthMin}..${report.meta.depthMax}, ` +
      `~${report.meta.runs} levels/depth, engine ${report.meta.engineVersion})\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
