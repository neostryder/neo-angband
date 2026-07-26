/*
 * Mechanical ledger of upstream unit-test COVERAGE, function by function.
 *
 * The previous measure was per-FILE: "does any port source cite
 * reference/src/tests/<dir>/<file>.c?". That undercounts and overcounts at the
 * same time. It undercounts because content/src/records.upstream.test.ts cites
 * the parse/ DIRECTORY and covers 28 files' MISSING_RECORD_HEADER cases in one
 * table, so every one of those files reads as uncited. It overcounts because a
 * single citation of a 44-test file reads as the whole file being covered.
 *
 * The unit here is the upstream test FUNCTION: `static int test_xxx0(void *)`.
 * Upstream test names are unique enough to grep for and the port already cites
 * them by name in test titles ("test_reg0", "test_magic_repeated0"), which is
 * the convention this ledger turns into a measurement.
 *
 * A citation is evidence a human looked at that upstream case, not proof the
 * port asserts the same thing. So this is a WORK QUEUE, not a parity claim --
 * same standing as w1-triage.mjs's candidate generator.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TESTS = "reference/src/tests";
const OUT = process.argv[2] ?? "parity/phase3-2026-07-25/reports";

/** Every .c under reference/src/tests, as a path relative to that dir. */
function cFiles(dir = TESTS, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...cFiles(join(dir, e.name), `${prefix}${e.name}/`));
    else if (e.name.endsWith(".c")) out.push(prefix + e.name);
  }
  return out;
}

/* The upstream harness declares every case as a file-static returning int.
 * unit-test.c's own helpers are not cases and do not match this shape. */
const CASE_RE = /^static int (test_[A-Za-z0-9_]+)\(/gm;

const cases = [];
for (const rel of cFiles()) {
  const src = readFileSync(join(TESTS, rel), "utf8");
  for (const m of src.matchAll(CASE_RE)) cases.push({ file: rel, name: m[1] });
}

/** Every test_* identifier appearing anywhere in the port's TypeScript. */
function portCitations() {
  const cited = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(p);
      } else if (e.name.endsWith(".ts")) {
        for (const m of readFileSync(p, "utf8").matchAll(/test_[A-Za-z0-9_]+/g)) cited.add(m[0]);
      }
    }
  };
  for (const pkg of readdirSync("packages", { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    try {
      walk(join("packages", pkg.name, "src"));
    } catch {
      /* a package without src/ is not an error here */
    }
  }
  return cited;
}

const cited = portCitations();
const rows = cases.map((c) => ({ ...c, cited: cited.has(c.name) }));

writeFileSync(
  join(OUT, "ut-ledger.tsv"),
  ["file\tcase\tcited", ...rows.map((r) => `${r.file}\t${r.name}\t${r.cited}`)].join("\n") + "\n",
);

const uncited = rows.filter((r) => !r.cited);
const byArea = new Map();
const byFile = new Map();
for (const r of uncited) {
  const area = r.file.includes("/") ? r.file.slice(0, r.file.indexOf("/")) : ".";
  byArea.set(area, (byArea.get(area) ?? 0) + 1);
  byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
}
const desc = (m) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

console.log(`upstream test cases: ${rows.length} in ${new Set(rows.map((r) => r.file)).size} files`);
console.log(`cited in the port:   ${rows.length - uncited.length}`);
console.log(`UNCITED:             ${uncited.length}\n`);
console.log("=== uncited by area ===");
for (const [a, n] of desc(byArea)) console.log(`${String(n).padStart(5)} ${a}`);
console.log("\n=== uncited by file ===");
for (const [f, n] of desc(byFile)) console.log(`${String(n).padStart(5)} ${f}`);
console.log(`\nwrote ${join(OUT, "ut-ledger.tsv")}`);
