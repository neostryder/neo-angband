/**
 * Count every large `switch` in the source tree, so the moddability gap list
 * has a DENOMINATOR nobody maintains by hand.
 *
 * MOD_REACH.md's inventory of dispatch switches was written by reading the
 * code, and a hand-written inventory only ever gets smaller: a switch converted
 * to a registry gets its row updated, a switch ADDED gets no row at all and the
 * list silently stops being a census. This makes the list checkable - every
 * switch of >= THRESHOLD cases must appear in switch-census.json with a verdict,
 * and a new or resized one fails the test until somebody adjudicates it.
 *
 * Deliberately syntactic and deliberately crude: it counts `case` labels
 * between braces, and it does not know what a switch dispatches ON. That is the
 * point - a tool that tried to be clever about which switches "matter" would be
 * a tool that could decide a new one does not.
 *
 * task #260: a switch can leave this census two ways - a genuine conversion to
 * a registry, or a plain RESHAPE that is exactly as closed to a mod as the
 * switch was (an if/else chain over one discriminant, or an index into a
 * module-level lookup array), and those two exits used to look identical: the
 * row just disappeared. So two more shapes are counted here, at the same
 * THRESHOLD, tagged with `kind` so a reader can tell "the dispatch is gone" from
 * "the dispatch just changed clothes":
 *   - SWITCH: what the tool always counted.
 *   - IF_CHAIN: `if (x === A) {...}`, chained by `else if` or by sibling `if`
 *     statements at the same depth, all testing the SAME discriminant.
 *   - ARRAY_LOOKUP: a module-level `const` array of >= THRESHOLD elements that
 *     is indexed somewhere by a non-literal expression (a variable, not a
 *     hard-coded slot) - the signature of a lookup table standing in for a
 *     dispatch, as opposed to a plain data array nothing ever indexes into.
 *
 *   node tools/switch-census.mjs           # report, exit 1 on drift
 *   node tools/switch-census.mjs --update  # rewrite the manifest
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Dispatch shapes smaller than this are control flow, not a dispatch table. */
export const THRESHOLD = 8;

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "tools", "switch-census.json");

/** Every .ts under packages/<pkg>/src, excluding tests and generated output. */
export function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
      if (entry.includes(".test.") || entry.includes(".fixtures.")) continue;
      out.push(full);
    }
  };
  const packages = join(root, "packages");
  for (const pkg of readdirSync(packages)) {
    const src = join(packages, pkg, "src");
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {
      /* a package with no src/ (content) */
    }
  }
  return out.sort();
}

/** Strip comments and string/template literals so neither can be mistaken for
 * the syntax being scanned. Line breaks are preserved so line numbers stay
 * correct. */
export function stripCode(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => m.replace(/[^\n]/g, " "));
}

/** depth[i] = brace nesting depth immediately BEFORE index i. Tracks only
 * `{`/`}`, which is what "same statement depth" means throughout this file. */
function depthProfile(stripped) {
  const depth = new Int32Array(stripped.length + 1);
  let d = 0;
  for (let i = 0; i < stripped.length; i++) {
    depth[i] = d;
    if (stripped[i] === "{") d++;
    else if (stripped[i] === "}") d--;
  }
  depth[stripped.length] = d;
  return depth;
}

function matchParen(stripped, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  while (i < stripped.length && depth > 0) {
    if (stripped[i] === "(") depth++;
    else if (stripped[i] === ")") depth--;
    i++;
  }
  return i - 1;
}

function matchBrace(stripped, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  while (i < stripped.length && depth > 0) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") depth--;
    i++;
  }
  return i - 1;
}

function matchBracket(stripped, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  while (i < stripped.length && depth > 0) {
    if (stripped[i] === "[") depth++;
    else if (stripped[i] === "]") depth--;
    i++;
  }
  return i - 1;
}

/**
 * Find `switch (...) {` and count the `case` labels in its block, tracking
 * brace depth so a nested switch is counted separately rather than folded into
 * its parent. Strings and comments are skipped first, crudely but adequately -
 * a `case` inside a string literal would otherwise inflate a count.
 */
export function switchesIn(text) {
  const stripped = stripCode(text);

  const found = [];
  const re = /\bswitch\s*\(/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    /* Walk to the opening brace of the block. */
    let i = m.index + m[0].length;
    let paren = 1;
    while (i < stripped.length && paren > 0) {
      if (stripped[i] === "(") paren++;
      else if (stripped[i] === ")") paren--;
      i++;
    }
    while (i < stripped.length && stripped[i] !== "{") i++;
    if (i >= stripped.length) continue;

    let depth = 0;
    let cases = 0;
    let hasDefault = false;
    const start = i;
    for (; i < stripped.length; i++) {
      const ch = stripped[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1 && stripped.startsWith("case ", i)) cases++;
      else if (depth === 1 && stripped.startsWith("default:", i)) hasDefault = true;
    }
    const line = stripped.slice(0, start).split("\n").length;
    found.push({ line, cases, hasDefault, kind: "SWITCH" });
  }
  return found;
}

/** The condition of a braced `if (` at `parenOpen` (index of its `(`), if it
 * is a plain equality test against a simple (possibly dotted) identifier -
 * `if (x === A)`, `if (op.type === B)`. Anything else (a call, a boolean
 * combination, `typeof`, `in`) returns null: this heuristic only chases the
 * shape a switch's discriminant would have taken. */
function conditionIdent(stripped, parenOpen) {
  const parenClose = matchParen(stripped, parenOpen);
  const condText = stripped.slice(parenOpen + 1, parenClose);
  const m = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(===|==)\s*\S/.exec(condText);
  if (!m) return null;
  return { ident: m[1], parenClose };
}

/** Walk one if/else-if/sibling-if chain forward from `ifStart`/`parenOpen`
 * (the first `if`'s keyword and its `(`), returning the arm count, whether it
 * ends in a plain catch-all `else`, and the index just past the chain - or
 * null if the first `if` is not itself a candidate (no braced block, or its
 * condition is not a simple equality). */
function tryIfChain(stripped, depth, ifStart, parenOpen) {
  const first = conditionIdent(stripped, parenOpen);
  if (!first) return null;
  const ident = first.ident;
  let arms = 0;
  let hasDefault = false;
  let parenClose = first.parenClose;

  for (;;) {
    let j = parenClose + 1;
    while (j < stripped.length && /\s/.test(stripped[j])) j++;
    if (stripped[j] !== "{") return arms >= 1 ? { arms, hasDefault, end: j } : null;
    const braceClose = matchBrace(stripped, j);
    arms++;

    let k = braceClose + 1;
    while (k < stripped.length && /\s/.test(stripped[k])) k++;

    if (stripped.startsWith("else", k) && !/[\w$]/.test(stripped[k + 4] ?? "")) {
      let p = k + 4;
      while (p < stripped.length && /\s/.test(stripped[p])) p++;
      if (stripped.startsWith("if", p) && !/[\w$]/.test(stripped[p + 2] ?? "")) {
        /* else if (...) - same chain, possibly a different discriminant, in
         * which case the chain ends here (arms already includes this block). */
        let q = p + 2;
        while (q < stripped.length && /\s/.test(stripped[q])) q++;
        if (stripped[q] !== "(") return { arms, hasDefault, end: braceClose + 1 };
        const cond = conditionIdent(stripped, q);
        if (!cond || cond.ident !== ident) return { arms, hasDefault, end: braceClose + 1 };
        parenClose = cond.parenClose;
        continue;
      }
      if (stripped[p] === "{") {
        /* trailing plain `else { ... }` - a default arm, chain ends here. */
        const elseBrace = matchBrace(stripped, p);
        return { arms: arms + 1, hasDefault: true, end: elseBrace + 1 };
      }
      return { arms, hasDefault, end: braceClose + 1 };
    }

    /* Not `else` - a sibling `if (ident ...)` at the SAME statement depth,
     * immediately following (only whitespace between), continues the chain.
     * This is the shape ui-entry.ts's applyRenderer actually uses: separate
     * top-level `if`s, each returning, rather than `else if`. */
    if (
      stripped.startsWith("if", k) &&
      !/[\w$]/.test(stripped[k + 2] ?? "") &&
      depth[k] === depth[ifStart]
    ) {
      let p = k + 2;
      while (p < stripped.length && /\s/.test(stripped[p])) p++;
      if (stripped[p] === "(") {
        const cond = conditionIdent(stripped, p);
        if (cond && cond.ident === ident) {
          parenClose = cond.parenClose;
          continue;
        }
      }
    }
    return { arms, hasDefault, end: braceClose + 1 };
  }
}

/**
 * Find if/else-if chains (and sibling-if chains) of >= THRESHOLD arms over a
 * single discriminant - the reshape ui-entry.ts's `applyRenderer` used to turn
 * a switch into a chain of `if (backend === UI_ENTRY_RENDERER.X)` blocks.
 *
 * Deliberately conservative: only a braced `if (IDENT === literal-ish)` starts
 * or continues a chain. A call (`if (isFoo(x))`), a boolean combination, or a
 * chain that changes discriminant partway through, ends the chain where the
 * mismatch is found rather than mis-attributing arms to it.
 */
export function ifChainsIn(text) {
  const stripped = stripCode(text);
  const depth = depthProfile(stripped);
  const found = [];
  const ifRe = /\bif\s*\(/g;
  let i = 0;

  for (;;) {
    ifRe.lastIndex = i;
    const m = ifRe.exec(stripped);
    if (!m) break;
    const ifStart = m.index;
    const parenOpen = m.index + m[0].length - 1;

    /* An `if` immediately preceded by `else` belongs to a chain that should
     * have already been walked from its true first `if` - don't re-start one
     * here (that would double count, or wrongly truncate the real chain). */
    if (/else\s*$/.test(stripped.slice(Math.max(0, ifStart - 12), ifStart))) {
      i = ifStart + 2;
      continue;
    }

    const chain = tryIfChain(stripped, depth, ifStart, parenOpen);
    if (chain && chain.arms >= THRESHOLD) {
      found.push({
        line: stripped.slice(0, ifStart).split("\n").length,
        cases: chain.arms,
        hasDefault: chain.hasDefault,
        kind: "IF_CHAIN",
      });
    }
    i = chain ? chain.end : ifStart + 2;
  }
  return found;
}

function countTopLevelElements(body) {
  if (/^\s*$/.test(body)) return 0;
  let depth = 0;
  let count = 1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  if (/,\s*$/.test(body)) count--;
  return count;
}

/**
 * Find module-level `const IDENT = [...]` arrays of >= THRESHOLD elements that
 * are searched elsewhere by a manual LINEAR SCAN comparing an element's field
 * to an external key - `IDENT[i]!.name === key`, or `IDENT.find((c) => c.name
 * === key)` - and using the matched element (or its index) to select
 * behaviour. This is the shape ui-entry.ts's `COMBINERS` + `combinerLookup` /
 * `combinerFuncs` turned a switch-like dispatch into: an element is chosen by
 * KEY, not by position, which is what makes it a stand-in for a dispatch
 * rather than an ordinary lookup table.
 *
 * Deliberately NOT triggered by mere indexing (`TABLE[level]`, a binary-search
 * midpoint, a reduce over the array): those select an element by POSITION,
 * which is what a plain data table looks like from any array of size >= 8,
 * and an earlier version of this heuristic that only asked "is this array
 * indexed by a variable anywhere" fired on RNG tables, MD5 constants, XP
 * tables and colour palettes - every sizeable array in the tree, in other
 * words, because that is what arrays are FOR. Requiring a field comparison
 * (`.prop ===`) or `.find`/`.findIndex` is the difference between "reads a
 * data table" and "looks something up by name."
 *
 * Module-level only (brace depth 0): a lookup array local to one function is
 * that function's own business, not a mod-facing dispatch table.
 */
export function arrayLookupsIn(text) {
  const stripped = stripCode(text);
  const depth = depthProfile(stripped);
  const found = [];
  /* The optional type annotation is skipped char-by-char, but a bare `[^=]*?`
   * breaks on a function-typed field's own `=>` (e.g. `run: () => number`) -
   * that IS an `=` character, and a negated class can't skip past one to
   * reach the real assignment `=` beyond it. Treating `=>` as a two-char unit
   * lets the skip consume it without mistaking it for the end of the type. */
  const declRe = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::(?:=>|[^=])*?)?=\s*\[/g;
  let m;
  while ((m = declRe.exec(stripped)) !== null) {
    if (depth[m.index] !== 0) continue;
    const ident = m[1];
    const bracketOpen = m.index + m[0].length - 1;
    const bracketClose = matchBracket(stripped, bracketOpen);
    const elementCount = countTopLevelElements(stripped.slice(bracketOpen + 1, bracketClose));
    if (elementCount < THRESHOLD) continue;

    const escaped = ident.replace(/[$]/g, "\\$");
    /* `IDENT[loopvar]!.prop ===` / `IDENT[loopvar].prop ==` - a linear scan
     * comparing a field, the manual equivalent of `.find`. The bracketed
     * index must be a bare identifier (a loop variable), not a literal, or
     * this would fire on `TABLE[0].prop` too. */
    const fieldSearchRe = new RegExp(
      `\\b${escaped}\\s*\\[\\s*[A-Za-z_$][\\w$]*\\s*\\]\\s*!?\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*(===|==)`,
    );
    /* `IDENT.find(`/`IDENT.findIndex(` - the same search, spelled the
     * built-in way instead of a hand-rolled loop. */
    const findRe = new RegExp(`\\b${escaped}\\s*\\.\\s*(?:find|findIndex)\\s*\\(`);

    if (!fieldSearchRe.test(stripped) && !findRe.test(stripped)) continue;

    found.push({
      line: stripped.slice(0, m.index).split("\n").length,
      cases: elementCount,
      hasDefault: false,
      kind: "ARRAY_LOOKUP",
    });
  }
  return found;
}

function census() {
  const rows = [];
  for (const file of sources()) {
    const text = readFileSync(file, "utf8");
    const rel = relative(root, file).split(sep).join("/");
    for (const s of [...switchesIn(text), ...ifChainsIn(text), ...arrayLookupsIn(text)]) {
      if (s.cases < THRESHOLD) continue;
      rows.push({ file: rel, cases: s.cases, hasDefault: s.hasDefault, kind: s.kind });
    }
  }
  /* Line numbers are deliberately NOT recorded: they churn on every edit and a
   * manifest that churns is a manifest nobody reads. File + case count is
   * enough to notice a switch appearing, growing or shrinking. */
  return rows.sort(
    (a, b) => b.cases - a.cases || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind),
  );
}

function main() {
  const rows = census();

  if (process.argv.includes("--update")) {
    const existing = {};
    try {
      const prior = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const r of prior.switches ?? []) {
        /* Older manifests (pre task #260) have no `kind` - every row in them
         * was a SWITCH, so default to that when matching verdicts forward. */
        const kind = r.kind ?? "SWITCH";
        existing[`${kind}|${r.file}|${String(r.cases)}`] = r.verdict;
      }
    } catch {
      /* first run */
    }
    const out = {
      threshold: THRESHOLD,
      note:
        "Generated by tools/switch-census.mjs. `verdict` is written by hand: what a mod can do about this dispatch. `kind` is SWITCH, IF_CHAIN (an if/else chain of >= threshold arms over one discriminant) or ARRAY_LOOKUP (a module-level const array of >= threshold elements, indexed dynamically) - three syntactic shapes that are equally closed to a mod. A new or resized row arrives as UNADJUDICATED.",
      switches: rows.map((r) => ({
        ...r,
        verdict: existing[`${r.kind}|${r.file}|${String(r.cases)}`] ?? "UNADJUDICATED",
      })),
    };
    writeFileSync(manifestPath, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`switch-census: recorded ${String(rows.length)} dispatch points of >= ${String(THRESHOLD)}`);
  } else {
    console.log(`switch-census: ${String(rows.length)} dispatch points of >= ${String(THRESHOLD)}`);
    for (const r of rows) console.log(`  ${String(r.cases).padStart(4)}  ${r.kind.padEnd(12)}  ${r.file}`);
  }
}

/* Only run the CLI when this file is executed directly - importing it (as
 * switch-census.test.ts does, to unit-test the detectors against literal
 * fixtures) must not walk the tree or touch the manifest. */
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (isMain) main();
