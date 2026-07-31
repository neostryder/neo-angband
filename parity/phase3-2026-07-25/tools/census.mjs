/**
 * Symbol-level parity census (Phase 3, W1 + W2).
 *
 * The 2026-07-24 dual audit proved coverage at FILE granularity, and its
 * dominant defect shape was "the logic exists in a helper the live path never
 * calls". Neither is caught by a file-level map, so this tool works at SYMBOL
 * granularity and answers two questions mechanically:
 *
 *   W1 EXISTENCE  - does every in-scope C function have a port counterpart?
 *   W2 WIRING     - is every port symbol reachable from a live entry point,
 *                   and referenced by something other than its own tests?
 *
 * It is deliberately a CENSUS, not a verdict: regex extraction over C and a
 * token-level reference graph over TS both over- and under-report, so the
 * output is a worklist for adjudication against the C, never a pass/fail gate.
 * Every bucket is emitted with the evidence needed to adjudicate it.
 *
 * Usage: node parity/phase3-2026-07-25/tools/census.mjs [--out <dir>]
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve, dirname, basename } from "node:path";

const REPO = resolve(import.meta.dirname, "../../..");
const REF_SRC = join(REPO, "reference/src");
const OUT = process.argv.includes("--out")
  ? resolve(process.argv[process.argv.indexOf("--out") + 1])
  : join(REPO, "parity/phase3-2026-07-25/reports");

/* ------------------------------------------------------------------ scope */

/**
 * Out of scope per neostryder: non-Windows front ends, the Borg (its own later
 * phase), and the C build/test tooling. `main-stats.c` and the `stats/` dir
 * stay IN, because they are the statistical oracle we diff against.
 */
const C_EXCLUDE_FILES = new Set([
  "main-gcu.c", "main-ibm.c", "main-nds.c", "main-sdl.c", "main-sdl2.c",
  "main-x11.c", "main-cocoa.m", "main-crb.c", "main-test.c",
]);
const C_EXCLUDE_PREFIX = ["borg"];
/** Front ends for platforms we do not ship, plus the C's own build scaffolding. */
const C_EXCLUDE_DIRS = ["borg", "cocoa", "nds", "sdl2", "gcu", "x11", "cmake", "doc", "tests"];

/**
 * Buckets decide HOW a C function is proven, not whether it counts:
 *   engine      - game logic; proven by symbol match + behavior review
 *   zlib        - z-* utility layer; same
 *   ui          - ui-*.c; proven against the port's terminal UI (W4)
 *   frontend    - main-win.c + win/*; Windows front end, W4
 *   data-init   - *-init.c parse handlers; proven by the DATA EXACTNESS test
 *                 (W5) that re-parses lib/gamedata and diffs every field --
 *                 a per-handler symbol match would be meaningless there
 *   oracle      - main-stats.c + stats/*; the statistical oracle we diff
 *                 AGAINST, deliberately not ported
 */
function bucketOf(relPath) {
  const b = basename(relPath);
  if (relPath.includes("/stats/") || b === "main-stats.c") return "oracle";
  if (relPath.includes("/win/") || b === "main-win.c") return "frontend";
  if (/-init\.c$/.test(b) || b === "init.c") return "data-init";
  if (b.startsWith("ui-")) return "ui";
  if (b.startsWith("z-")) return "zlib";
  return "engine";
}

/** Port packages that make up the port proper (borg/linoleum are later phases). */
const TS_PACKAGES = ["core", "content", "web", "cli", "mod-sdk"];

/** Live entry points: what a real player (or the stats harness) actually runs. */
const TS_ENTRIES = [
  "packages/web/src/main.ts",
  "packages/cli/src/index.ts",
  "packages/cli/src/main-stats.ts",
  "packages/cli/src/main-baseline.ts",
  "packages/cli/src/main-spoil.ts",
  "packages/cli/src/main-scenarios.ts",
  "packages/cli/src/main-cimport.ts",
  "packages/cli/src/main-cparity.ts",
];

/* ------------------------------------------------------------------ util */

function walk(dir, pred, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

const isTest = (p) => /\.test\.ts$/.test(p);
const rel = (p) => relative(REPO, p).replace(/\\/g, "/");

/* -------------------------------------------------------- C extraction */

/**
 * Function DEFINITIONS in a .c file. A definition is a declarator at column 0
 * whose parameter list closes and is followed by `{` -- that excludes
 * prototypes (`;`), calls (indented), and struct-initialiser tables.
 */
const C_DEF = new RegExp(
  [
    "^", // column 0: C style in this codebase puts return type there
    "(?!(?:if|for|while|switch|return|else|do|case|typedef|struct\\b\\s*\\{)\\b)",
    "(?:(?:static|extern|inline|const|unsigned|signed|struct|enum|union|void|char|short|int|long|float|double|bool|size_t|u16b|u32b|s16b|s32b|byte|wchar_t|errr|[A-Za-z_][A-Za-z0-9_]*_t|[A-Za-z_][A-Za-z0-9_]*)\\s+)+",
    "\\**\\s*",
    "([A-Za-z_][A-Za-z0-9_]*)", // 1: name
    "\\s*\\(",
    "([^;{]*?)", // 2: params (may span lines)
    "\\)\\s*\\{",
  ].join(""),
  "gm",
);

function extractCFunctions() {
  const files = walk(REF_SRC, (p) => /\.[cm]$/.test(p)).filter((p) => {
    const b = basename(p);
    const r = rel(p);
    if (C_EXCLUDE_FILES.has(b)) return false;
    if (C_EXCLUDE_PREFIX.some((pre) => b.startsWith(pre))) return false;
    if (C_EXCLUDE_DIRS.some((d) => r.includes(`/${d}/`))) return false;
    return true;
  });
  const out = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lineOf = makeLineIndex(text);
    for (const m of text.matchAll(C_DEF)) {
      const name = m[1];
      if (!name || name === "main") continue;
      out.push({
        name,
        file: rel(f),
        bucket: bucketOf(rel(f)),
        line: lineOf(m.index),
        static: /^\s*static\b/.test(m[0]),
      });
    }
  }
  return out;
}

function makeLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/* ------------------------------------------------------- TS extraction */

/** Top-level declarations. Value declarations only -- types carry no behavior. */
const TS_DECLS = [
  [/^export\s+(?:async\s+)?function\s+\*?([A-Za-z_$][\w$]*)/gm, "function"],
  [/^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, "class"],
  [/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm, "const"],
  [/^export\s+enum\s+([A-Za-z_$][\w$]*)/gm, "enum"],
  [/^(?:async\s+)?function\s+\*?([A-Za-z_$][\w$]*)/gm, "local-function"],
  [/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm, "local-const"],
  /* Types are tracked separately: they matter for DATA parity, not wiring. */
  [/^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm, "type"],
];

function extractTsSymbols() {
  const files = [];
  for (const p of TS_PACKAGES) {
    const dir = join(REPO, "packages", p, "src");
    try { statSync(dir); } catch { continue; }
    files.push(...walk(dir, (f) => /\.ts$/.test(f)));
  }
  const symbols = [];
  const tokensByFile = new Map();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lineOf = makeLineIndex(text);
    if (!isTest(f)) {
      for (const [re, kind] of TS_DECLS) {
        for (const m of text.matchAll(re)) {
          symbols.push({
            name: m[1],
            kind,
            exported: kind.startsWith("local") ? false : true,
            file: rel(f),
            line: lineOf(m.index),
          });
        }
      }
    }
    tokensByFile.set(rel(f), new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []));
  }
  return { symbols, tokensByFile, files: files.map(rel) };
}

/* ------------------------------------------------- import reachability */

/** Resolve a TS relative/workspace import to a repo-relative file path. */
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith(".")) {
    base = join(REPO, dirname(fromFile), spec);
  } else if (spec.startsWith("@rpgm-tools/neo-angband-")) {
    const pkg = spec.slice("@rpgm-tools/neo-angband-".length).split("/")[0];
    const restParts = spec.slice("@rpgm-tools/neo-angband-".length).split("/").slice(1);
    base = join(REPO, "packages", pkg, "src", ...(restParts.length ? restParts : ["index"]));
  } else {
    return null; // node/npm dependency
  }
  for (const cand of [base + ".ts", join(base, "index.ts"), base]) {
    try { if (statSync(cand).isFile()) return rel(cand); } catch { /* keep trying */ }
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function buildReachable(allFiles) {
  const cache = new Map();
  const importsOf = (f) => {
    if (cache.has(f)) return cache.get(f);
    let text = "";
    try { text = readFileSync(join(REPO, f), "utf8"); } catch { /* generated */ }
    const list = [];
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const r = resolveImport(f, spec);
      if (r) list.push(r);
    }
    cache.set(f, list);
    return list;
  };
  const seen = new Set();
  const stack = TS_ENTRIES.filter((e) => allFiles.includes(e));
  const missingEntries = TS_ENTRIES.filter((e) => !allFiles.includes(e));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of importsOf(f)) if (!seen.has(d)) stack.push(d);
  }
  return { reachable: seen, missingEntries };
}

/* ---------------------------------------------------------- name match */

const snakeToCamel = (s) =>
  s.replace(/^_+/, "").replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function normKey(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* ------------------------------------------------------------------ run */

const cFns = extractCFunctions();
const { symbols, tokensByFile, files } = extractTsSymbols();
const { reachable, missingEntries } = buildReachable(files);

/* --- W1: C function -> port symbol, by normalized name, then by token --- */
const tsByKey = new Map();
for (const s of symbols) {
  const k = normKey(s.name);
  if (!tsByKey.has(k)) tsByKey.set(k, []);
  tsByKey.get(k).push(s);
}
/** Every identifier that appears anywhere in the port (comments included). */
const allTokens = new Set();
for (const [f, toks] of tokensByFile) { if (!isTest(f)) for (const t of toks) allTokens.add(t); }
const allTokenKeys = new Set([...allTokens].map(normKey));

const w1 = [];
for (const fn of cFns) {
  const cands = tsByKey.get(normKey(snakeToCamel(fn.name))) ?? tsByKey.get(normKey(fn.name)) ?? [];
  let status, evidence;
  if (cands.length) {
    status = "MATCH";
    evidence = cands.map((c) => `${c.file}:${c.line}`).join(" | ");
  } else if (allTokenKeys.has(normKey(snakeToCamel(fn.name)))) {
    /* Name appears but not as a top-level decl: inlined, a method, or only
     * mentioned in a comment. Needs a human/agent verdict. */
    status = "INLINE?";
    evidence = "identifier present in port sources but not a top-level decl";
  } else {
    status = "UNMATCHED";
    evidence = "";
  }
  w1.push({ ...fn, status, evidence });
}

/* --- W2: wiring.
 *
 * Two different questions, because module-local and exported symbols fail
 * differently:
 *   - a LOCAL decl is live if its own file uses it more than the declaration
 *     itself (a local used once is dead code);
 *   - an EXPORTED decl is live if some other non-test file uses it AND that
 *     file is import-reachable from a live entry point. Reachable-but-unused
 *     is the exact "helper the live path never calls" shape from the last audit.
 * Barrel re-exports are handled by the token scan: `export { x } from "./y"`
 * counts as a reference from the barrel, so the chain resolves naturally.
 */
const fileText = new Map();
const ownFileCount = (name, file) => {
  if (!fileText.has(file)) fileText.set(file, readFileSync(join(REPO, file), "utf8"));
  const text = fileText.get(file);
  return (text.match(new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`, "g")) ?? []).length;
};
const w2 = [];
for (const s of symbols) {
  if (s.kind === "type") continue;
  const local = s.kind.startsWith("local");
  const selfRefs = ownFileCount(s.name, s.file);
  let status, prodRefs = 0, testRefs = 0, reachableRefs = 0;
  if (local) {
    /* One occurrence = the declaration itself and nothing else. */
    status = selfRefs <= 1 ? "DEAD-LOCAL" : "LIVE";
  } else {
    for (const [f, toks] of tokensByFile) {
      if (f === s.file) continue;
      if (!toks.has(s.name)) continue;
      if (isTest(f)) testRefs++;
      else { prodRefs++; if (reachable.has(f)) reachableRefs++; }
    }
    const usedInOwnFile = selfRefs > 1;
    if (!reachable.has(s.file)) status = "MODULE-UNREACHABLE";
    else if (prodRefs > 0) status = reachableRefs === 0 ? "REF-UNREACHABLE" : "LIVE";
    /* Exported but nothing outside consumes it. Used inside its own file is
     * merely over-exported (fine); used ONLY by tests is the exact shape of
     * the last audit's dominant defect; used nowhere is dead code. */
    else if (testRefs > 0) status = usedInOwnFile ? "LIVE" : "TEST-ONLY";
    else status = usedInOwnFile ? "LIVE" : "ORPHAN";
  }
  if (status !== "LIVE") {
    w2.push({ ...s, status, prodRefs, testRefs, reachableRefs, selfRefs });
  }
}

/* ------------------------------------------------------------- reports */

mkdirSync(OUT, { recursive: true });

const tsv = (rows, cols) =>
  [cols.join("\t"), ...rows.map((r) => cols.map((c) => String(r[c] ?? "")).join("\t"))].join("\n") + "\n";

writeFileSync(
  join(OUT, "w1-c-symbol-coverage.tsv"),
  tsv(w1, ["status", "bucket", "name", "file", "line", "static", "evidence"]),
);
/* The adjudication queue, highest signal first: a NON-static C function with no
 * port symbol of that name is public API in the C -- other translation units
 * call it -- so a missing counterpart is a candidate real gap, not an inlining
 * artifact. Buckets proven by other means (data-init, oracle) are excluded. */
const queue = w1
  .filter((r) => r.status === "UNMATCHED" && !["data-init", "oracle"].includes(r.bucket))
  .sort((a, b) => Number(a.static) - Number(b.static) || a.file.localeCompare(b.file));
writeFileSync(
  join(OUT, "w1-adjudication-queue.tsv"),
  tsv(queue, ["bucket", "static", "name", "file", "line"]),
);
writeFileSync(
  join(OUT, "w2-wiring-suspects.tsv"),
  tsv(w2, ["status", "name", "kind", "file", "line", "prodRefs", "testRefs", "reachableRefs", "selfRefs"]),
);

const unreachableModules = files
  .filter((f) => !isTest(f) && !reachable.has(f))
  .sort();
writeFileSync(join(OUT, "w2-unreachable-modules.txt"), unreachableModules.join("\n") + "\n");

const count = (arr, key) =>
  arr.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});

/* Per-C-file worklist: how much of each reference file is still unaccounted
 * for. This is the tractable unit of adjudication -- an agent takes one file,
 * reads it against its port counterpart, and rules on every UNMATCHED name. */
const byFile = new Map();
for (const r of w1) {
  if (!byFile.has(r.file)) byFile.set(r.file, { file: r.file, bucket: r.bucket, MATCH: 0, "INLINE?": 0, UNMATCHED: 0, unmatchedStatic: 0, names: [] });
  const e = byFile.get(r.file);
  e[r.status]++;
  if (r.status === "UNMATCHED") {
    if (r.static) e.unmatchedStatic++;
    e.names.push(r.name + (r.static ? "(s)" : ""));
  }
}
const fileRows = [...byFile.values()]
  .map((e) => ({ ...e, total: e.MATCH + e["INLINE?"] + e.UNMATCHED, names: e.names.join(",") }))
  .sort((a, b) => b.UNMATCHED - a.UNMATCHED);
writeFileSync(
  join(OUT, "w1-unmatched-by-file.tsv"),
  tsv(fileRows, ["bucket", "file", "total", "MATCH", "INLINE?", "UNMATCHED", "unmatchedStatic", "names"]),
);

const summary = {
  generatedFrom: "parity/phase3-2026-07-25/tools/census.mjs",
  c: {
    filesScanned: new Set(cFns.map((f) => f.file)).size,
    functions: cFns.length,
    byStatus: count(w1, "status"),
    byBucket: count(cFns, "bucket"),
    unmatchedByBucket: count(w1.filter((r) => r.status === "UNMATCHED"), "bucket"),
    adjudicationQueue: {
      total: queue.length,
      nonStatic: queue.filter((r) => !r.static).length,
      files: new Set(queue.map((r) => r.file)).size,
    },
  },
  ts: {
    files: files.filter((f) => !isTest(f)).length,
    testFiles: files.filter(isTest).length,
    valueSymbols: symbols.filter((s) => s.kind !== "type").length,
    reachableModules: [...reachable].filter((f) => !isTest(f)).length,
    unreachableModules: unreachableModules.length,
    wiringSuspects: count(w2, "status"),
  },
  missingEntries,
};
writeFileSync(join(OUT, "census-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
