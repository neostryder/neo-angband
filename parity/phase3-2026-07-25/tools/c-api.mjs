/**
 * The C public-API surface, and the port's symbol surface, for the coverage
 * ratchet in packages/core/src/c-api-coverage.test.ts.
 *
 * A function DECLARED in a reference header is public API: some other
 * translation unit calls it, so upstream considered it part of the engine's
 * contract. That makes header declarations a much better coverage unit than
 * every `.c` definition -- the ~1700 unmatched static helpers in the census are
 * mostly inlined at their one call site, while a missing public function is a
 * candidate real gap.
 *
 * Both extractors are regex-based and therefore approximate. They are used for a
 * RATCHET, not a verdict: the current shortfall is frozen in an allow-list that
 * may only shrink, so approximation costs us adjudication work but can never
 * silently pass a new gap.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

/** Front ends we do not ship, the Borg (its own phase), and generated lists. */
const EXCLUDE_DIRS = ["borg", "cocoa", "nds", "sdl2", "gcu", "x11", "cmake", "doc", "tests", "win", "stats"];
const EXCLUDE_FILES = new Set(["h-basic.h", "angband.h", "config.h"]);

/**
 * A function declaration at column 0 ending in `;`. Requires a return type, so
 * `foo(bar);` inside a macro body does not match, and rejects the keywords that
 * begin a statement rather than a declaration.
 */
const DECL = new RegExp(
  [
    "^",
    "(?!(?:if|for|while|switch|return|else|do|case|typedef|extern\\s+\"C\")\\b)",
    "(?:(?:extern|const|unsigned|signed|struct|enum|union|void|char|short|int|long|float|double|bool|size_t|u16b|u32b|s16b|s32b|byte|wchar_t|errr|[A-Za-z_][A-Za-z0-9_]*_t|[A-Za-z_][A-Za-z0-9_]*)\\s+)+",
    "\\**\\s*",
    "([A-Za-z_][A-Za-z0-9_]*)", // 1: name
    "\\s*\\(",
    "([^;{]*?)", // 2: params, may span lines
    "\\)\\s*;",
  ].join(""),
  "gm",
);

function walk(dir, pred, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!EXCLUDE_DIRS.includes(e)) walk(p, pred, acc);
    } else if (pred(p)) acc.push(p);
  }
  return acc;
}

function lineIndex(text) {
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

/** Every function declared in an in-scope reference header. */
export function extractCHeaderFunctions(repoRoot) {
  const dir = join(repoRoot, "reference", "src");
  const files = walk(dir, (p) => p.endsWith(".h")).filter((p) => {
    const b = basename(p);
    return !EXCLUDE_FILES.has(b) && !b.startsWith("list-") && !b.startsWith("borg");
  });
  const out = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lineOf = lineIndex(text);
    for (const m of text.matchAll(DECL)) {
      const name = m[1];
      if (!name || name === "main") continue;
      out.push({
        name,
        header: relative(repoRoot, f).replace(/\\/g, "/"),
        line: lineOf(m.index),
      });
    }
  }
  return out;
}

const TS_DECLS = [
  /^export\s+(?:async\s+)?function\s+\*?([A-Za-z_$][\w$]*)/gm,
  /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+enum\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm,
  /^\s{2}([A-Za-z_$][\w$]*)\s*\(/gm, // class methods, two-space indented
];

/** Every symbol name the port declares, plus every identifier it mentions. */
export function extractPortSymbols(repoRoot, packages = ["core", "content", "web", "cli", "mod-sdk"]) {
  const declared = new Set();
  const mentioned = new Set();
  for (const p of packages) {
    const dir = join(repoRoot, "packages", p, "src");
    let files;
    try { files = walk(dir, (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")); } catch { continue; }
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of TS_DECLS) {
        for (const m of text.matchAll(re)) declared.add(m[1]);
      }
      for (const t of text.match(/[A-Za-z_$][\w$]*/g) ?? []) mentioned.add(t);
    }
  }
  return { declared, mentioned };
}

/** snake_case -> camelCase, then strip everything but lowercase alphanumerics. */
export function normKey(s) {
  const camel = s.replace(/^_+/, "").replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  return camel.toLowerCase().replace(/[^a-z0-9]/g, "");
}
