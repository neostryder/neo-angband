#!/usr/bin/env node
/**
 * mod-reach-citation-check - a deterministic ratchet on MOD_REACH.md's own
 * file:line citations into this repo's TypeScript source.
 *
 * `docs/modding/MOD_REACH.md` is the running log of which surfaces a mod can
 * reach. Every claim there cites a file and line in this repo's source -
 * `packages/core/src/mod/hooks.ts:84`, `main.ts:10256`, `game/cave-cmd.ts:680`
 * - so that the prose is anchored to the bytes it claims to describe. Those
 * citations rot silently when the cited function moves: the document itself
 * records the failure (`:8821` and `:10985` moved after a re-measure), and
 * hand audits do not scale. This script is the answer: no heuristic guessing,
 * only checks that are mechanically certain.
 *
 * THIS IS A DIFFERENT CHECK FROM `tools/citation-check.mjs`. That one audits
 * citations FROM ported TypeScript INTO the vendored upstream C at
 * `reference/` (parity claims); this one audits citations FROM a single doc
 * (MOD_REACH.md) INTO this repo's own TypeScript. The check itself is
 * correspondingly simpler - does the TS file exist, is the line in range -
 * and intentionally has no "which C symbol does this belong to" step,
 * because there is none.
 *
 * FOUR VERDICT CLASSES:
 *
 *   OK             The file resolved to exactly one path under the known
 *                  source roots, and the cited line (or the start of a
 *                  range) does not exceed the file's current line count.
 *
 *   OUT_OF_RANGE   The cited file resolved, but the cited line (or the
 *                  start of a range) exceeds the file's current line count.
 *                  Always real. Highest-value output - `--check` fails on
 *                  any of these.
 *
 *   AMBIGUOUS      A bare filename (no `packages/<name>/src/` prefix)
 *                  matched more than one source root. The script will NOT
 *                  guess which one was meant. `--check` fails on these too.
 *
 *   UNRESOLVED     A bare filename matched zero source roots. `--check`
 *                  fails on these too.
 *
 * WHAT THIS DOES NOT DO. It does not check that a citation's prose actually
 * describes what the cited code does - that is a judgement call, and this
 * file refuses to make judgement calls. It also does not check that the
 * END of a range is still in range; only the START is gated, because that
 * is the anchor the prose typically names and the END tends to be a span
 * that may legitimately drift without anyone meaning to point at a new
 * function. If the END has fallen off the file, `--check` will still flag
 * it via the START check once the START does too.
 *
 * USAGE
 *   node tools/mod-reach-citation-check.mjs            human-readable report
 *   node tools/mod-reach-citation-check.mjs --check     same, exits 1 on any
 *                                                       OUT_OF_RANGE / AMBIGUOUS
 *                                                       / UNRESOLVED
 *   node tools/mod-reach-citation-check.mjs --json      machine-readable dump
 *   node tools/mod-reach-citation-check.mjs --doc PATH  check a different doc
 *                                                       (default: docs/modding/MOD_REACH.md)
 *   node tools/mod-reach-citation-check.mjs --root DIR  scan a different tree
 *                                                       (tests use this to point
 *                                                       at an isolated fixture)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..");
const DEFAULT_DOC = join(DEFAULT_ROOT, "docs", "modding", "MOD_REACH.md");

/* ------------------------------------------------------------------ *
 * CLI args
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    check: false,
    json: false,
    root: DEFAULT_ROOT,
    doc: DEFAULT_DOC,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opts.check = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--root") opts.root = argv[++i];
    else if (a.startsWith("--root=")) opts.root = a.slice("--root=".length);
    else if (a === "--doc") opts.doc = argv[++i];
    else if (a.startsWith("--doc=")) opts.doc = a.slice("--doc=".length);
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Source roots: every package's src/ directory the resolver may search.
 * The 8 packages under packages/ that have a src/ tree.
 * ------------------------------------------------------------------ */

const SOURCE_ROOTS = [
  "packages/core/src",
  "packages/web/src",
  "packages/content/src",
  "packages/cli/src",
  "packages/mod-sdk/src",
  "packages/linoleum/src",
  "packages/mcp/src",
  "packages/desktop/src",
];

/* ------------------------------------------------------------------ *
 * Citation extraction
 * ------------------------------------------------------------------ */

/* MOD_REACH.md cites TypeScript source. The path may be:
 *   - fully qualified: `packages/core/src/mod/hooks.ts:84`
 *   - partially qualified (subdir only): `game/cave-cmd.ts:680`,
 *     `gen/generate.ts:415`
 *   - bare (filename only): `main.ts:10256`, `cave-cmd.ts:885`
 *
 * The file extension whitelist is `.ts` on purpose: `.c`, `.h`, `.yaml`,
 * `.md` self-references would not be MOD_REACH citations and must not be
 * treated as such. */
/* A filename segment may contain dots - `resolve.test.ts`, `compose.test.ts`
 * - so the basename group allows `[A-Za-z0-9_.-]+`. The whole thing still
 * has to end in `.ts`. */
const PATH_TOKEN =
  "((?:packages/[a-zA-Z0-9_-]+/src/)?(?:[a-zA-Z0-9_./-]+/)?[a-zA-Z0-9_.-]+\\.ts)";

/* Primary pattern: backtick-fenced `path:line` or `path:line-line`. The
 * leading backtick is required - MOD_REACH.md's own convention is to fence
 * citations in backticks, and the two real non-backtick `.ts:NNN` matches
 * in the file (gen/generate.ts:415, spell-cmd.ts:291) are mid-list items
 * inside the same backtick span as their siblings, so they still match
 * via the secondary continuation pattern below. */
const CITE_PRIMARY_RE = new RegExp(
  "`" + PATH_TOKEN + ":(\\d+)(?:-(\\d+))?`",
  "gu",
);

/* Same-line, comma-separated continuation of the PREVIOUS citation's file
 * - `gen/generate.ts:415,419` (bare), or `spell-cmd.ts:291,351`, or
 *   `pack.ts:118-124, :145-148` and `pack.ts:118-124, `:145-148``
 *   (backtick-fenced with no filename elided). The pattern requires an
 * explicit `:NNN` (or `:NNN-NNN`) right after the comma so it is never
 * confused with an ordinary number in prose; the surrounding backtick is
 * optional on both sides because MOD_REACH.md uses both styles. Borrowed
 * from the same idea in tools/citation-check.mjs (CONTINUATION_RE). */
const CITE_CONT_RE = /,\s*`?:(\d+)(?:-(\d+))?`?/gu;

/* Walk a single line and produce an array of {file, l1, l2} citations. The
 * continuation pattern only fires after a primary match in the same line,
 * because it depends on which file is being continued.
 *
 * BUG FIXED (found while applying this script's own findings, not by the
 * model that wrote it): a continuation chase must stop at the START of the
 * NEXT primary match, not run to end-of-line. `packages/core/src/mod/ids.ts:183`;
 * callers `session/game.ts:3226`, `:3312`, has TWO primary matches on one
 * line - the old code let the FIRST match's chase read all the way past the
 * second primary match and steal its trailing `:3312` continuation,
 * attributing a `session/game.ts` line to `ids.ts` (and, since the second
 * primary match's own chase would find the same `:3312` again, silently
 * double-counting it too). All primary matches are collected up front so
 * each one's chase can be bounded by where the next one starts. */
function extractCitationsFromLine(lineText) {
  const out = [];
  CITE_PRIMARY_RE.lastIndex = 0;
  const primaries = [];
  let m;
  while ((m = CITE_PRIMARY_RE.exec(lineText))) {
    primaries.push({
      file: m[1],
      l1: parseInt(m[2], 10),
      l2: m[3] !== undefined ? parseInt(m[3], 10) : undefined,
      start: m.index,
      end: CITE_PRIMARY_RE.lastIndex,
    });
  }

  for (let i = 0; i < primaries.length; i++) {
    const p = primaries[i];
    out.push({ file: p.file, l1: p.l1, l2: p.l2 });

    /* Chase same-line comma continuations of THIS file only, bounded so it
     * cannot run into the next primary citation's own text. */
    const boundEnd = i + 1 < primaries.length ? primaries[i + 1].start : lineText.length;
    const slice = lineText.slice(p.end, boundEnd);
    CITE_CONT_RE.lastIndex = 0;
    let cm;
    while ((cm = CITE_CONT_RE.exec(slice))) {
      const cl1 = parseInt(cm[1], 10);
      const cl2 = cm[2] !== undefined ? parseInt(cm[2], 10) : undefined;
      out.push({ file: p.file, l1: cl1, l2: cl2 });
      /* Guard against zero-width matches - exec would otherwise re-match
       * the same empty range forever. */
      if (CITE_CONT_RE.lastIndex === cm.index) {
        CITE_CONT_RE.lastIndex += 1;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * File resolution
 * ------------------------------------------------------------------ */

/* Recursively walk `<root>/src/` and yield every file's path. */
function walkSrc(srcDir) {
  const out = [];
  if (!existsSync(srcDir)) return out;
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(srcDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSrc(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/* Per-root basename index: rootDir -> basename -> [absPath, ...]. Built
 * lazily on first need. Used by the suffix-search resolver below. */
const basenameIndexCache = new Map();
function buildBasenameIndex(root) {
  if (basenameIndexCache.has(root)) return basenameIndexCache.get(root);
  const byBasename = new Map();
  for (const rootRel of SOURCE_ROOTS) {
    const srcDir = join(root, rootRel);
    for (const abs of walkSrc(srcDir)) {
      const base = abs.split(sep).pop();
      if (!byBasename.has(base)) byBasename.set(base, []);
      byBasename.get(base).push(abs);
    }
  }
  basenameIndexCache.set(root, byBasename);
  return byBasename;
}

/* Given a path token from a citation, resolve it to an absolute path on
 * disk under the repo root. Returns:
 *   { status: "OK",            abs, relPath }
 *   { status: "AMBIGUOUS",     candidates: [relPath, ...] }
 *   { status: "UNRESOLVED" }
 *
 * Resolution rules, in order:
 *
 *   1. Fully-qualified (`packages/<pkg>/src/...`): taken literally.
 *
 *   2. Subdir-prefixed (`game/foo.ts`, `mon/project-mon.ts`,
 *      `generated/effects.ts`): the path is treated as a suffix relative
 *      to every `<root>/src/` literal - so `game/cave-cmd.ts` matches
 *      `<root>/packages/core/src/game/cave-cmd.ts` and only that.
 *      AMBIGUOUS if it matches under more than one root with distinct
 *      absolute paths.
 *
 *   3. Pure basename (`foo.ts`): recursively searched under every
 *      `<root>/src/`. AMBIGUOUS if the same basename appears at multiple
 *      distinct paths across or within roots. The most common AMBIGUOUS
 *      case is `main.ts` (web + desktop) and `pack.ts` (web + content +
 *      cli). */
function resolveFile(root, fileToken) {
  /* Normalise separators: the citation may use POSIX or native Windows
   * separators when the prose was written from a different terminal. Both
   * are treated as POSIX for matching. */
  const normalised = fileToken.split(sep).join("/");

  if (normalised.startsWith("packages/")) {
    const abs = join(root, normalised);
    if (existsSync(abs)) {
      return { status: "OK", abs, relPath: normalised };
    }
    return { status: "UNRESOLVED" };
  }

  if (normalised.includes("/")) {
    /* Subdir-prefixed: try every SOURCE_ROOT literal first. A match here
     * is exact and unambiguous - the path's directory parts pin it. */
    const matches = new Set();
    const candidateRels = [];
    for (const rootRel of SOURCE_ROOTS) {
      const abs = join(root, rootRel, normalised);
      if (existsSync(abs)) {
        const rel = rootRel + "/" + normalised;
        if (!matches.has(abs)) {
          matches.add(abs);
          candidateRels.push(rel);
        }
      }
    }
    if (matches.size === 1) {
      return { status: "OK", abs: [...matches][0], relPath: candidateRels[0] };
    }
    if (matches.size > 1) {
      return { status: "AMBIGUOUS", candidates: candidateRels };
    }
    /* No literal hit - fall through to the basename search below, which
     * will at least surface UNRESOLVED if nothing matches anywhere. */
  }

  /* Pure basename (or subdir-prefixed that did not hit literally):
   * recursive search. */
  const byBasename = buildBasenameIndex(root);
  const hits = byBasename.get(normalised) || [];
  if (hits.length === 0) {
    return { status: "UNRESOLVED" };
  }
  if (hits.length === 1) {
    const abs = hits[0];
    return { status: "OK", abs, relPath: relative(root, abs).split(sep).join("/") };
  }
  /* Multiple distinct hits: AMBIGUOUS. Map back to repo-relative paths. */
  return {
    status: "AMBIGUOUS",
    candidates: hits.map((a) => relative(root, a).split(sep).join("/")),
  };
}

/* ------------------------------------------------------------------ *
 * Line counting (same defensive convention as tools/citation-check.mjs:
 * a trailing newline must not count as an extra line).
 * ------------------------------------------------------------------ */

const contentCache = new Map();
function readLines(abs) {
  if (contentCache.has(abs)) return contentCache.get(abs);
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split(/\r\n|\r|\n/u);
  if (lines.length > 0 && lines[lines.length - 1] === "" && /\r?\n$/u.test(raw)) {
    lines.pop();
  }
  contentCache.set(abs, lines);
  return lines;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function runCheck(opts) {
  const root = opts.root;
  const docAbs = opts.doc;

  if (!existsSync(docAbs)) {
    throw new Error(`doc not found: ${docAbs}`);
  }

  const raw = readFileSync(docAbs, "utf8");
  const lines = raw.split(/\r\n|\r|\n/u);

  const findings = [];
  const counts = { OK: 0, OUT_OF_RANGE: 0, AMBIGUOUS: 0, UNRESOLVED: 0 };
  let total = 0;

  for (let li = 0; li < lines.length; li++) {
    const lineText = lines[li];
    const citations = extractCitationsFromLine(lineText);
    for (const c of citations) {
      total++;
      const citeText =
        c.l2 !== undefined
          ? `${c.file}:${c.l1}-${c.l2}`
          : `${c.file}:${c.l1}`;
      const docLoc = `${relative(root, docAbs).split(sep).join("/")}:${li + 1}`;

      const resolved = resolveFile(root, c.file);

      if (resolved.status === "AMBIGUOUS") {
        counts.AMBIGUOUS++;
        findings.push({
          verdict: "AMBIGUOUS",
          loc: docLoc,
          citation: citeText,
          reason: `bare filename matched ${resolved.candidates.length} source roots`,
          candidates: resolved.candidates,
        });
        continue;
      }
      if (resolved.status === "UNRESOLVED") {
        counts.UNRESOLVED++;
        findings.push({
          verdict: "UNRESOLVED",
          loc: docLoc,
          citation: citeText,
          reason: "no source root contains this path",
        });
        continue;
      }

      const fileLines = readLines(resolved.abs);
      const l1 = c.l1;
      const l2 = c.l2 ?? c.l1;
      const outOfRange =
        l1 < 1 || l2 < l1 || l1 > fileLines.length;

      if (outOfRange) {
        counts.OUT_OF_RANGE++;
        findings.push({
          verdict: "OUT_OF_RANGE",
          loc: docLoc,
          citation: citeText,
          reason:
            l2 < l1
              ? `inverted range (start ${l1} > end ${l2})`
              : `${resolved.relPath} has ${fileLines.length} lines`,
          resolvedPath: resolved.relPath,
          fileLength: fileLines.length,
        });
        continue;
      }

      counts.OK++;
    }
  }

  return {
    total,
    counts,
    findings,
    docPath: relative(root, docAbs).split(sep).join("/"),
  };
}

function printReport(result) {
  const { total, counts, findings, docPath } = result;
  const failed =
    counts.OUT_OF_RANGE + counts.AMBIGUOUS + counts.UNRESOLVED;
  const passedPct = total > 0 ? ((counts.OK / total) * 100).toFixed(1) : "0.0";

  console.log(`mod-reach-citation-check: ${total} citation(s) extracted from ${docPath}`);
  console.log(`  OK             : ${counts.OK}  (${passedPct}%)`);
  console.log(`  OUT_OF_RANGE   : ${counts.OUT_OF_RANGE}`);
  console.log(`  AMBIGUOUS      : ${counts.AMBIGUOUS}`);
  console.log(`  UNRESOLVED     : ${counts.UNRESOLVED}`);
  console.log(`  -> failed (--check exits 1): ${failed}`);
  console.log("");

  const groups = ["OUT_OF_RANGE", "AMBIGUOUS", "UNRESOLVED"];
  for (const verdict of groups) {
    const list = findings.filter((f) => f.verdict === verdict);
    if (!list.length) continue;
    console.log(`${verdict} (${list.length}):`);
    for (const f of list) {
      let extra = "";
      if (verdict === "AMBIGUOUS") {
        extra = `\tcandidates=[${f.candidates.join(", ")}]`;
      } else if (verdict === "OUT_OF_RANGE") {
        extra = `\tresolved=${f.resolvedPath}\t${f.reason}`;
      }
      console.log(`  ${verdict}\t${f.loc}\t${f.citation}${extra}`);
    }
    console.log("");
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = runCheck(opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  const failed =
    result.counts.OUT_OF_RANGE +
    result.counts.AMBIGUOUS +
    result.counts.UNRESOLVED;
  if (opts.check && failed > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();

export { runCheck, extractCitationsFromLine, resolveFile, parseArgs };
