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

/** Every port .ts file, with its source, for the citation tests below. */
const portFiles = [];

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
        const src = readFileSync(p, "utf8");
        portFiles.push({ path: p, src });
        for (const m of src.matchAll(/test_[A-Za-z0-9_]+/g)) cited.add(m[0]);
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

/*
 * AMBIGUOUS NAMES. Upstream reuses case names across files: `test_dice0`,
 * `test_flags0` and `test_effect0` each appear in many parse/*.c. Keying purely
 * on the name credited EVERY file sharing a name as soon as ONE was cited, which
 * inflated the cited count by 125 rows in a single run and -- worse -- hid a real
 * GAP: `parse/ptimed.c test_missing_effect0` read as covered because c-info.c has
 * a case of that name, and the two assert OPPOSITE things (c-info treats an
 * orphan effect dep as PARSE_ERROR_NONE, ptimed as MISSING_RECORD_HEADER).
 *
 * So a bare-name citation is only accepted when the name is UNIQUE upstream.
 * Where it is shared, the citing port file must also name the upstream file, and
 * the citation is credited only to that file. This can under-credit a real
 * adjudication that did not spell out the filename -- that is the safe direction
 * for a work queue, and the fix is to add the filename to the citation.
 */
const nameCount = new Map();
for (const c of cases) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);

const rows = cases.map((c) => {
  if (!cited.has(c.name)) return { ...c, cited: false, why: "" };
  if (nameCount.get(c.name) === 1) return { ...c, cited: true, why: "name" };
  /* Shared name: require the upstream file to be named by a port file that also
   * cites the case name, so a citation in one file cannot credit another. */
  const base = c.file.split("/").pop();
  const ok = portFiles.some((f) => f.src.includes(base) && f.src.includes(c.name));
  return { ...c, cited: ok, why: ok ? "file+name" : "" };
});

writeFileSync(
  join(OUT, "ut-ledger.tsv"),
  ["file\tcase\tcited\tvia", ...rows.map((r) => `${r.file}\t${r.name}\t${r.cited}\t${r.why}`)].join(
    "\n",
  ) + "\n",
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
