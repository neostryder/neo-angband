/**
 * `pnpm --filter @neo-angband/cli census` - print the upstream text census.
 *
 * The CI gate is text-census.test.ts; this is the same run in a form you can
 * read while working: every player-visible C literal the port does not contain,
 * grouped by upstream file, newest findings first in the file order you would
 * open them in. Exit code is 0 either way - failing the build is the test's job,
 * not this script's.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCensus } from "./text-census.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { calls, missing } = runCensus(root);

const byFile = new Map<string, typeof missing>();
for (const m of missing) {
  const list = byFile.get(m.file) ?? [];
  list.push(m);
  byFile.set(m.file, list);
}

console.log(`upstream player-visible literals: ${calls.length}`);
console.log(`absent from the port:             ${missing.length}\n`);
for (const [file, ms] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${file} (${ms.length})`);
  for (const m of [...ms].sort((a, b) => a.line - b.line)) {
    console.log(`  ${String(m.line).padStart(5)} ${m.fn}: ${JSON.stringify(m.text)}`);
  }
  console.log("");
}
console.log(
  "Every line above must appear in KNOWN_ABSENT (packages/cli/src/text-census.test.ts)\n" +
    "with the reason it does not apply, or the test fails.",
);
