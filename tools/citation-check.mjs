#!/usr/bin/env node
/**
 * citation-check - a deterministic ratchet on upstream-C line citations.
 *
 * Every parity claim in this port cites a line (or range) of the vendored
 * Angband 4.2.6 C at `reference/` - `store.c:1924`, `ui-store.c L208-233`,
 * `Makefile:8`. Those citations are the ONLY evidence linking a piece of
 * ported TypeScript, or a parity document's claim, to the upstream behaviour
 * it says it reproduces. Two independent audits (2026-08-14) found 38+ wrong
 * ones by hand, including a citation to line 207 of a 149-line file. Hand
 * audits do not scale and an LLM sweep produced ~1,818 mostly-false verdicts
 * from a function-name extractor that matched prose, not code. This script
 * is the answer: no heuristic guessing, only checks that are mechanically
 * certain.
 *
 * THREE VERDICT CLASSES, and the fourth that is the point of the file:
 *
 *   OUT OF RANGE    The cited file does not exist under reference/, or the
 *                    cited line exceeds the file's length, or the range is
 *                    inverted (start > end). Always real. Highest-value
 *                    output - `--check` fails the build on any of these.
 *
 *   ANCHOR MISMATCH  ONLY computed where the citation sits immediately next
 *                    to a named C symbol - the pattern `symbol_name (file.c
 *                    L10-20)` that is this codebase's dominant citation
 *                    style. When that shape is unambiguous, the cited
 *                    line(s) must fall inside that symbol's function body OR
 *                    be a call to it; anything else is a citation pointing
 *                    at the wrong function, which is the failure mode this
 *                    file exists to catch (a line 4 off usually still lands
 *                    inside the right function and reads as correct; a line
 *                    in the WRONG function is the dangerous one).
 *
 *   UNCHECKED        Everything else: the line is in range, but there was no
 *                    symbol adjacent to check it against, or the filename
 *                    could not be resolved unambiguously. This is reported
 *                    OUT LOUD and prominently, on purpose. A checker that
 *                    silently covers 12% of citations while looking like it
 *                    covers 100% is worse than no checker - the design
 *                    constraint here is that a false positive (crying wolf)
 *                    is far more expensive than a miss, so anything not
 *                    mechanically certain is reported as unchecked rather
 *                    than guessed at.
 *
 * WHAT THIS DOES NOT DO. It does not check that a citation's prose actually
 * describes what the cited code does - that is a judgement call, and this
 * file refuses to make judgement calls. It only checks what is checkable
 * without semantic understanding: does the file exist, does the line exist,
 * and (when a symbol is named) does the line belong to that symbol.
 *
 * USAGE
 *   node tools/citation-check.mjs            human-readable report on stdout
 *   node tools/citation-check.mjs --check     same, exits 1 on any OUT OF RANGE
 *   node tools/citation-check.mjs --json      machine-readable dump instead
 *   node tools/citation-check.mjs --root DIR  scan a different tree (tests use
 *                                              this to point at an isolated
 *                                              fixture rather than the live repo)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..");

/* ------------------------------------------------------------------ *
 * CLI args
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = { check: false, json: false, root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opts.check = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--root") opts.root = argv[++i];
    else if (a.startsWith("--root=")) opts.root = a.slice("--root=".length);
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Filesystem walking (no glob dependency - the four input patterns are
 * concrete enough to walk by hand: packages/*\/src/**\/*.ts, parity/**\/*.md,
 * parity/ledger/*.yaml, docs/**\/*.md).
 * ------------------------------------------------------------------ */

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

/** Every source file the checker reads citations from. */
function collectSourceFiles(root) {
  const files = [];
  const pkgsDir = join(root, "packages");
  if (existsSync(pkgsDir)) {
    for (const pkg of readdirSync(pkgsDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const src = join(pkgsDir, pkg.name, "src");
      walk(src, (p) => p.endsWith(".ts"), files);
    }
  }
  walk(join(root, "parity"), (p) => p.endsWith(".md"), files);
  const ledgerDir = join(root, "parity", "ledger");
  if (existsSync(ledgerDir)) {
    for (const f of readdirSync(ledgerDir)) {
      if (f.endsWith(".yaml")) files.push(join(ledgerDir, f));
    }
  }
  walk(join(root, "docs"), (p) => p.endsWith(".md"), files);
  return files;
}

/** basename -> [{relPath, lineCount}], for everything under reference/. */
function buildReferenceIndex(root) {
  const refRoot = join(root, "reference");
  const byBasename = new Map();
  const all = walk(refRoot, () => true);
  for (const abs of all) {
    const relPath = relative(refRoot, abs).split(sep).join("/");
    const basename = relPath.split("/").pop();
    if (!byBasename.has(basename)) byBasename.set(basename, []);
    byBasename.get(basename).push({ relPath, abs });
  }
  return { refRoot, byBasename };
}

const contentCache = new Map();
function readLines(abs) {
  if (contentCache.has(abs)) return contentCache.get(abs);
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split(/\r\n|\r|\n/u);
  /* A trailing newline produces one trailing empty element; upstream files
   * end that way almost universally, and it must not count as an extra
   * line the citation checker considers "in range". */
  if (lines.length > 0 && lines[lines.length - 1] === "" && /\r?\n$/u.test(raw)) {
    lines.pop();
  }
  contentCache.set(abs, lines);
  return lines;
}

/* ------------------------------------------------------------------ *
 * Citation extraction
 * ------------------------------------------------------------------ */

/* Upstream C filenames this checker resolves. Extensions are a whitelist on
 * purpose: `.ts` / `.yaml` / `.md` self-references (e.g. `brand-slay.ts:69`,
 * `gamedata.yaml:502`) are citations to files IN THIS REPO, not upstream C,
 * and must never be treated as upstream citations. */
const FILE_TOKEN =
  "(?:reference/)?(?:src/|lib/gamedata/)?" +
  "([A-Za-z][\\w.-]*\\.(?:c|h|txt|ac)|Makefile(?:\\.[A-Za-z0-9]+)?|CMakeLists\\.txt)";

/* `store.c:1924`, `store.c:1646-1774`, `store.c L1646-1774`,
 * `store.c L1646–1774` (en dash), `Makefile:8`. The separator is either
 * a bare colon or one-or-more spaces then `L`; either side of a range may
 * carry its own leading `L` (`obj-randart.c L3164-L3171`). */
const CITATION_RE = new RegExp(
  FILE_TOKEN + "(?::|[ ]+L)(L?\\d+)(?:[-\\u2013](L?\\d+))?",
  "gu",
);

/* A same-line, comma-separated continuation of the PREVIOUS citation's file
 * - `obj-power.c:1117, :1144, :1153` or `option.c:171`, `:225-333`. Requires
 * an explicit leading `:` or `L` right after the comma so it is never
 * confused with an ordinary number in prose. */
const CONTINUATION_RE = /^[,]\s*(?:and\s+)?[`']?(?::|L)(L?\d+)(?:[-–](L?\d+))?[`']?/u;

function stripL(tok) {
  return tok === undefined ? undefined : parseInt(tok.replace(/^L/u, ""), 10);
}

/**
 * Every citation on one line of source text, extracted independent of the
 * anchor check (which needs the raw line for adjacency, so this returns
 * enough position info for that pass to run over the same line).
 */
function extractCitationsFromLine(lineText) {
  const results = [];
  CITATION_RE.lastIndex = 0;
  let m;
  while ((m = CITATION_RE.exec(lineText))) {
    const file = m[1];
    const l1 = stripL(m[2]);
    const l2 = stripL(m[3]);
    const start = m.index;
    let end = CITATION_RE.lastIndex;
    results.push({ file, l1, l2, start, end, isContinuation: false });

    /* Chase same-line comma continuations of this same file. */
    for (;;) {
      const rest = lineText.slice(end);
      const cm = CONTINUATION_RE.exec(rest);
      if (!cm) break;
      const cl1 = stripL(cm[1]);
      const cl2 = stripL(cm[2]);
      const cStart = end + rest.indexOf(cm[0]);
      const cEnd = end + cm[0].length;
      results.push({ file, l1: cl1, l2: cl2, start: cStart, end: cEnd, isContinuation: true });
      end = cEnd;
    }
    CITATION_RE.lastIndex = end;
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * Anchor detection: `symbol_name (file.c L10-20)` - the citation sits alone
 * inside a parenthetical immediately preceded by a bare (optionally
 * backtick-wrapped) identifier, and nothing else is inside that paren.
 * ------------------------------------------------------------------ */

const KEYWORD_STOPLIST = new Set([
  "if", "while", "for", "switch", "return", "else", "do", "sizeof", "case",
  "defined", "typedef", "struct", "enum", "union", "static", "const", "void",
  "int", "char", "bool", "goto", "break", "continue", "default", "at",
]);

const ANCHOR_BEFORE_RE = /(?:`)?([A-Za-z_][A-Za-z0-9_]*)(?:`)?\s*\($/u;

/*
 * Angband's C is snake_case throughout (`flavor_init`, `react_to_slay`,
 * `stats_lookup_index`). Requiring an underscore is what separates a real
 * function name from an ordinary English word that happens to sit before a
 * parenthetical citation - "at that depth (main-stats.c:644-645)" reads
 * exactly like an anchor citation but "depth" is prose, not a symbol. This
 * single rule is what keeps this checker out of the false-positive class
 * that sank the earlier LLM sweep (~1,818 verdicts, dominated by function
 * names that merely appeared in nearby prose): a bare single word is never
 * treated as an anchor, no matter how it is punctuated.
 */
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u;

function findAnchorSymbol(lineText, citationStart, citationEnd) {
  const before = lineText.slice(0, citationStart);
  const m = ANCHOR_BEFORE_RE.exec(before);
  if (!m) return null;
  const symbol = m[1];
  if (!SNAKE_CASE_RE.test(symbol) || KEYWORD_STOPLIST.has(symbol)) return null;
  /* The paren must close right after the citation (plus its continuations) -
   * i.e. the parenthetical's content IS the citation, nothing more. */
  if (lineText[citationEnd] !== ")") return null;
  return symbol;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/* Does a line look like it opens a real function DEFINITION (reaches `{`
 * before any `;`, scanning a short forward window for multi-line
 * signatures)? Shared by the global-symbol index and the per-symbol check
 * below so the two never disagree about what counts as a definition. */
function definitionBraceLine(lines, fromIdx) {
  for (let j = fromIdx; j < Math.min(lines.length, fromIdx + 8); j++) {
    const idxBrace = lines[j].indexOf("{");
    const idxSemi = lines[j].indexOf(";");
    if (idxBrace !== -1 && (idxSemi === -1 || idxBrace < idxSemi)) return j;
    if (idxSemi !== -1) return -1;
  }
  return -1;
}

const LEADING_IDENT_PAREN_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/u;

/**
 * Angband's convention is a `/** ... *​/` doc comment sitting directly above
 * a function, no blank line between - `do_cmd_wiz_create_obj` (cmd-wizard.c)
 * is a doc comment on line 869-872, then the signature on 874 with nothing
 * between. A citation to that comment line is citing the function - the
 * doc-comment IS the function's documentation - not a wrong-function
 * citation, so the checkable "body" is widened to include a comment block
 * that runs uninterrupted up to the signature line. Only an unbroken run of
 * comment/blank-inside-comment lines is walked; anything else (a blank line,
 * a statement, a previous function's closing brace) stops the walk, so this
 * cannot accidentally swallow the end of an unrelated preceding function.
 */
function commentStartAbove(lines, defLineIdx) {
  let k = defLineIdx - 1;
  if (k < 0 || !lines[k].includes("*/")) return defLineIdx;
  let j = k;
  const floor = Math.max(0, k - 60);
  while (j >= floor) {
    if (/\/\*/u.test(lines[j])) return j;
    j--;
  }
  return defLineIdx;
}

/**
 * Every name in `reference/` that is DEFINED as a real C function somewhere
 * (any .c file, brace-matched). Built once and used as a precondition before
 * an adjacent-word is ever trusted as a "named C symbol" - a bare English
 * word standing in front of a citation ("at that depth (main-stats.c:644-
 * 645)") will never appear in this set no matter how it is punctuated in the
 * prose, because it was never actually the identifier of a defined
 * function. This is the second half of what keeps ANCHOR MISMATCH
 * high-precision: `SNAKE_CASE_RE` filters the shape of the word, this filters
 * whether the word names something real.
 */
function buildGlobalFunctionSet(refIndex) {
  const set = new Set();
  const seenPaths = new Set();
  for (const candidates of refIndex.byBasename.values()) {
    for (const entry of candidates) {
      if (!entry.relPath.endsWith(".c") || seenPaths.has(entry.relPath)) continue;
      seenPaths.add(entry.relPath);
      const lines = readLines(entry.abs);
      for (let i = 0; i < lines.length; i++) {
        const m = LEADING_IDENT_PAREN_RE.exec(lines[i]);
        if (!m) continue;
        const name = m[1];
        if (name.length < 3 || KEYWORD_STOPLIST.has(name)) continue;
        if (definitionBraceLine(lines, i) !== -1) set.add(name);
      }
    }
  }
  return set;
}

/** Strip //-comments, /*...*\/ comments and string/char literals so brace
 * counting does not get confused by a `'{'` or a `"}"` in the source. Block
 * comment state carries across lines via the returned `inBlockComment`. */
function stripCComment(line, inBlockComment) {
  let out = "";
  let i = 0;
  let comment = inBlockComment;
  while (i < line.length) {
    if (comment) {
      const end = line.indexOf("*/", i);
      if (end === -1) { i = line.length; break; }
      i = end + 2;
      comment = false;
      continue;
    }
    const c = line[i];
    if (c === "/" && line[i + 1] === "*") { comment = true; i += 2; continue; }
    if (c === "/" && line[i + 1] === "/") break;
    if (c === '"' || c === "'") {
      const quote = c;
      out += " ";
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, inBlockComment: comment };
}

/**
 * Locate `symbol`'s definition body and call sites in a resolved reference
 * file, and decide whether a cited [l1, l2] range matches either.
 *
 * Returns "MATCH", "MISMATCH", or null if the symbol never appears in the
 * file at all in call-shape (`symbol(`) - callers treat null as MISMATCH
 * too, since neither "inside the body" nor "is a call to it" can hold for a
 * symbol that is not there, but they receive it separately so a future
 * caller could choose to soften it.
 */
function checkAnchor(lines, symbol, l1, l2) {
  const wordRe = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(symbol)}(?![A-Za-z0-9_])\\s*\\(`, "u");
  /* [start, end] (1-based, inclusive) per occurrence that is NOT the chosen
   * definition - a call site, OR (just as often in this codebase) a header
   * prototype, which is all a `.h` file ever has. Each range is widened over
   * an immediately-preceding, uninterrupted doc comment for the same reason
   * `defBodyStart` is: `file_exists (z-file.h:135)` cites the comment two
   * lines above the prototype at z-file.h:138, and that is the prototype's
   * own documentation, not a wrong line. */
  const callRanges = [];
  let defBodyStart = null;
  let defBodyEnd = null;

  for (let i = 0; i < lines.length; i++) {
    if (!wordRe.test(lines[i])) continue;
    /* Classify: does the signature (this line onward, up to 8 lines) reach
     * a `{` before a top-level `;`? If so, this is a definition. */
    const braceLineIdx = defBodyStart === null ? definitionBraceLine(lines, i) : -1;
    if (braceLineIdx !== -1) {
      /* Brace-count from braceLineIdx to find the matching close. */
      let depth = 0;
      let comment = false;
      let end = -1;
      for (let j = braceLineIdx; j < lines.length; j++) {
        const stripped = stripCComment(lines[j], comment);
        comment = stripped.inBlockComment;
        for (const ch of stripped.text) {
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) { end = j; break; }
          }
        }
        if (end !== -1) break;
      }
      if (end !== -1) {
        defBodyStart = commentStartAbove(lines, i) + 1; // 1-based
        defBodyEnd = end + 1;
        continue;
      }
    }
    callRanges.push([commentStartAbove(lines, i) + 1, i + 1]);
  }

  const citedLines = [];
  for (let n = l1; n <= (l2 ?? l1); n++) citedLines.push(n);

  if (defBodyStart !== null) {
    const inBody = citedLines.some((n) => n >= defBodyStart && n <= defBodyEnd);
    if (inBody) return "MATCH";
  }
  const isCall = citedLines.some((n) =>
    callRanges.some(([s, e]) => n >= s && n <= e),
  );
  if (isCall) return "MATCH";

  /* Last resort, and the most literal check of all: does the exact
   * identifier sit, as a bare word, on one of the cited lines themselves -
   * with no `(` required? Angband registers several handlers by name alone
   * in a table row (`{ ..., textui_quit, NULL, ... }`, `CMD_BROWSE_SPELL,
   * obj_can_browse,`) - that is a real, common, and entirely legitimate
   * citation shape in this codebase, and "the named symbol is textually
   * present at the cited location" needs no semantic understanding to be
   * certain about. */
  const bareRe = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(symbol)}(?![A-Za-z0-9_])`, "u");
  const isBareMention = citedLines.some((n) => n >= 1 && n <= lines.length && bareRe.test(lines[n - 1]));
  if (isBareMention) return "MATCH";

  return "MISMATCH";
}

/* ------------------------------------------------------------------ *
 * Resolution against reference/
 * ------------------------------------------------------------------ */

function resolveFile(refIndex, prefixedFull, basename) {
  const candidates = refIndex.byBasename.get(basename) ?? [];
  if (candidates.length === 0) return { status: "MISSING", candidates: [] };
  if (candidates.length === 1) return { status: "OK", entry: candidates[0] };

  /* Longest FULL path actually written in the citation wins. `message.c` is
   * ambiguous between `src/message.c` and `src/tests/message/message.c`, and
   * the `src/` test below picks the former for BOTH - so a correct citation to
   * `reference/src/tests/message/message.c:521` was resolved to a 452-line
   * file and reported OUT OF RANGE. Only an exact relPath suffix counts, so
   * this can never resolve a path the citation did not spell out. */
  let best = null;
  for (const c of candidates) {
    if (!prefixedFull.endsWith(c.relPath)) continue;
    if (!best || c.relPath.length > best.relPath.length) best = c;
  }
  if (best) return { status: "OK", entry: best };

  /* Try to disambiguate using any path prefix present in the citation. */
  if (prefixedFull.includes("lib/gamedata/")) {
    const hit = candidates.find((c) => c.relPath.startsWith("lib/gamedata/"));
    if (hit) return { status: "OK", entry: hit };
  }
  if (prefixedFull.includes("src/")) {
    const hit = candidates.find((c) => c.relPath === `src/${basename}`);
    if (hit) return { status: "OK", entry: hit };
  }
  return { status: "AMBIGUOUS", candidates };
}

function suggestSimilar(refIndex, basename) {
  const names = [...refIndex.byBasename.keys()];
  const stem = basename.replace(/\.[^.]+$/u, "");
  return names
    .filter((n) => n !== basename && n.includes(stem.slice(0, Math.max(4, stem.length - 2))))
    .slice(0, 3);
}

/* ------------------------------------------------------------------ *
 * Main pass
 * ------------------------------------------------------------------ */

function runCheck(root) {
  const refIndex = buildReferenceIndex(root);
  const sourceFiles = collectSourceFiles(root);
  const globalFunctions = buildGlobalFunctionSet(refIndex);

  const findings = [];
  const counts = { OUT_OF_RANGE: 0, ANCHOR_MISMATCH: 0, ANCHOR_OK: 0, UNCHECKED: 0 };
  const unrecognizedForms = [];
  let total = 0;

  for (const abs of sourceFiles) {
    const relSrc = relative(root, abs).split(sep).join("/");
    const lines = readFileSync(abs, "utf8").split(/\r\n|\r|\n/u);

    /* Bonus, best-effort: flag extension forms this checker's whitelist does
     * not cover, so coverage gaps stay visible rather than silent. Matches a
     * dotted filename + line number where the extension is plausibly a
     * build/project file this checker does not resolve. */
    const UNHANDLED_EXT_RE = /\b[\w-]+\.(vcxproj|filters|cmake|prf|m4|in)\b[: ]L?\d+/gu;
    let um;
    while ((um = UNHANDLED_EXT_RE.exec(lines.join("\n")))) {
      unrecognizedForms.push({ file: relSrc, text: um[0] });
      if (unrecognizedForms.length > 40) break; // cap; this is a bonus, not the deliverable
    }

    for (let li = 0; li < lines.length; li++) {
      const lineText = lines[li];
      const citations = extractCitationsFromLine(lineText);
      for (const c of citations) {
        total++;
        const basename = c.file.includes("/") ? c.file.split("/").pop() : c.file;
        const prefixMatchStr = lineText.slice(Math.max(0, c.start - 30), c.start);
        const resolved = resolveFile(refIndex, prefixMatchStr + c.file, basename);
        const loc = `${relSrc}:${li + 1}`;
        const citeText = c.l2 !== undefined ? `${c.file}:${c.l1}-${c.l2}` : `${c.file}:${c.l1}`;

        if (resolved.status === "MISSING") {
          counts.OUT_OF_RANGE++;
          findings.push({
            verdict: "OUT_OF_RANGE",
            loc,
            citation: citeText,
            reason: "file does not exist under reference/",
            suggestion: suggestSimilar(refIndex, basename),
          });
          continue;
        }
        if (resolved.status === "AMBIGUOUS") {
          counts.UNCHECKED++;
          findings.push({
            verdict: "UNCHECKED",
            loc,
            citation: citeText,
            reason: `ambiguous filename - ${resolved.candidates.length} candidates under reference/ (${resolved.candidates.map((x) => x.relPath).join(", ")})`,
          });
          continue;
        }

        const entry = resolved.entry;
        const fileLines = readLines(entry.abs);
        const l1 = c.l1;
        const l2 = c.l2 ?? c.l1;
        const outOfRange =
          l1 < 1 || l2 < l1 || l1 > fileLines.length || l2 > fileLines.length;

        if (outOfRange) {
          counts.OUT_OF_RANGE++;
          findings.push({
            verdict: "OUT_OF_RANGE",
            loc,
            citation: citeText,
            reason:
              l2 < l1
                ? `inverted range (start ${l1} > end ${l2})`
                : `reference/${entry.relPath} has ${fileLines.length} lines`,
            correctBound: fileLines.length,
            resolvedPath: `reference/${entry.relPath}`,
          });
          continue;
        }

        const symbol = findAnchorSymbol(lineText, c.start, c.end);
        if (!symbol || !globalFunctions.has(symbol)) {
          /* Either no adjacent word at all, or the adjacent word is not
           * anywhere in reference/ a real, brace-matched function
           * definition - e.g. a SQL table name or a struct field that
           * merely reads like one. Neither is a symbol this can check the
           * citation against with certainty, so it stays UNCHECKED rather
           * than guessed at. */
          counts.UNCHECKED++;
          continue;
        }
        let verdict = checkAnchor(fileLines, symbol, l1, l2);
        if (verdict !== "MATCH") {
          /* Angband dispatches several UI operations through a `*_hook`
           * indirection - `get_item`, `panel_contains` and similar are the
           * PUBLIC name a citation naturally uses, while the concrete text-
           * UI implementation this port actually ports is `textui_get_item`
           * / `textui_panel_contains`. Retrying under that prefix before
           * declaring a mismatch is what tells the two apart from a citation
           * that is actually wrong: this codebase's own convention, not a
           * guess about C in general. */
          const hookAlias = `textui_${symbol}`;
          if (globalFunctions.has(hookAlias)) {
            const aliasVerdict = checkAnchor(fileLines, hookAlias, l1, l2);
            if (aliasVerdict === "MATCH") verdict = "MATCH";
          }
        }
        if (verdict === "MATCH") {
          counts.ANCHOR_OK++;
        } else {
          counts.ANCHOR_MISMATCH++;
          findings.push({
            verdict: "ANCHOR_MISMATCH",
            loc,
            citation: citeText,
            symbol,
            resolvedPath: `reference/${entry.relPath}`,
            reason: `${symbol}(...) is not defined and not called at reference/${entry.relPath}:${citeText.split(":").pop()}`,
          });
        }
      }
    }
  }

  return { total, counts, findings, unrecognizedForms, refFileCount: [...refIndex.byBasename.values()].reduce((a, v) => a + v.length, 0) };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

function printReport(result) {
  const { total, counts, findings } = result;
  const checked = counts.OUT_OF_RANGE + counts.ANCHOR_MISMATCH + counts.ANCHOR_OK;
  const pct = total > 0 ? ((checked / total) * 100).toFixed(1) : "0.0";

  console.log(`citation-check: ${total} citation(s) extracted`);
  console.log(`  OUT OF RANGE     : ${counts.OUT_OF_RANGE}`);
  console.log(`  ANCHOR MISMATCH  : ${counts.ANCHOR_MISMATCH}`);
  console.log(`  anchor OK        : ${counts.ANCHOR_OK}  (checked and passed)`);
  console.log(`  UNCHECKED        : ${counts.UNCHECKED}  (in range, nothing checkable found)`);
  console.log(`  -> mechanically checked (not UNCHECKED): ${checked}/${total} (${pct}%)`);
  console.log("");

  const outOfRange = findings.filter((f) => f.verdict === "OUT_OF_RANGE");
  const mismatches = findings.filter((f) => f.verdict === "ANCHOR_MISMATCH");
  const ambiguous = findings.filter((f) => f.verdict === "UNCHECKED");

  if (outOfRange.length) {
    console.log(`OUT OF RANGE (${outOfRange.length}):`);
    for (const f of outOfRange) {
      console.log(`  OUT_OF_RANGE\t${f.loc}\t${f.citation}\t${f.reason}`);
      if (f.suggestion && f.suggestion.length) {
        console.log(`    did you mean: ${f.suggestion.join(", ")}?`);
      }
    }
    console.log("");
  }
  if (mismatches.length) {
    console.log(`ANCHOR MISMATCH (${mismatches.length}):`);
    for (const f of mismatches) {
      console.log(`  ANCHOR_MISMATCH\t${f.loc}\t${f.citation}\t${f.symbol}\t${f.reason}`);
    }
    console.log("");
  }
  if (ambiguous.length) {
    console.log(`UNCHECKED - ambiguous filename (${ambiguous.length}):`);
    for (const f of ambiguous) {
      console.log(`  UNCHECKED\t${f.loc}\t${f.citation}\t${f.reason}`);
    }
    console.log("");
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = runCheck(opts.root);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  if (opts.check && result.counts.OUT_OF_RANGE > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();

export { runCheck, extractCitationsFromLine, findAnchorSymbol, checkAnchor, buildReferenceIndex };
