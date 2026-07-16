/**
 * `scenarios` entry point: run the golden scenarios and print a report. Exits
 * non-zero if any scenario fails. `--print` dumps observed end-state values
 * (used to refresh the EXPECTED constants after an intentional change).
 */

import { pathToFileURL } from "node:url";
import { loadGamePack } from "./pack";
import { formatScenarioResults, runScenarios } from "./scenarios";

function main(): void {
  const print = process.argv.slice(2).includes("--print");
  const pack = loadGamePack();
  const results = runScenarios(pack);
  process.stdout.write(formatScenarioResults(results) + "\n");
  if (print) {
    for (const r of results) {
      process.stdout.write(`\n[${r.name}] observed:\n`);
      process.stdout.write(JSON.stringify(r.observed, null, 2) + "\n");
    }
  }
  if (results.some((r) => !r.ok)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
