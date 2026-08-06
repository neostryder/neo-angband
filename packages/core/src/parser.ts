/**
 * reference/src/parser.c's shared machinery — the parts that are grammar-
 * independent and were, until now, re-decided by each grammar that needed them.
 *
 * WHY THIS EXISTS
 *
 * Upstream has ONE `struct parser`. Every data file, every pref file and the
 * customised-options files below all go through `parser_parse`, so they share a
 * tokeniser, an error table and an error LIMIT. The port has no single parser
 * object (each grammar is a plain function over already-read text, which is the
 * right shape for a bundled-JSON game), but the pieces those grammars must agree
 * on are still one thing, and this module is where they live.
 *
 * The error limit is the reason this file was written. `visuals/prefs.ts` had
 * carried `const limit = opts.errorLimit ?? 0` under a comment reading
 * "Upstream's default is 0 (ui-init.c / z-util), so every error is reported".
 * It is 20 (parser.c:38), it is not in either of those files, and the
 * difference is behavioural rather than cosmetic: ui-prefs.c:1222's loop
 * `break`s out of the FILE when the limit is reached, so upstream stops
 * applying a pref file after its twentieth bad line and the port applied every
 * line to the end. See getParserErrorLimit.
 */

import { PARSER_ERROR_ENTRIES } from "./generated/index.js";

/**
 * One `struct parser_state` (parser.h), as `parser_getstate` fills it: the line
 * and column the parser had reached, the offending token (`p->errmsg`) and the
 * `enum parser_error` CODE. Every grammar in the port reports errors in this
 * shape because upstream has exactly one of them.
 */
export interface ParserState {
  line: number;
  col: number;
  msg: string;
  error: number;
}

/**
 * parser_error_str[] (parser.c L36-100), generated straight from
 * list-parser-errors.h - the codegen'd table, NOT a hand-typed copy. Upstream
 * spells several of these differently from the handler names ("invalid colour",
 * "unrecognized tval"), which is exactly the sort of thing a transcription gets
 * wrong.
 */
export function parserErrorText(code: number): string {
  return PARSER_ERROR_ENTRIES[code]?.description ?? "generic error";
}

/**
 * PARSE_ERROR_LIMIT (parser.c L30-39): the compile-time cap on how many parse
 * errors are reported for one file. Zero means "no limit" — which is what the
 * port used to assume the DEFAULT was.
 */
export const PARSE_ERROR_LIMIT = 20;

/** C's INT_MAX, the clamp get_parser_error_limit applies to the env value. */
const INT_MAX = 2147483647;

let overrideLimit: number | null | undefined;

/**
 * `getenv("PARSE_ERROR_LIMIT")` for a core that must also run in a browser.
 *
 * Reached through `globalThis` and a computed key ON PURPOSE. Vite rewrites the
 * literal member expression `process.env.PARSE_ERROR_LIMIT` at build time, which
 * would bake the BUILDER's environment into the shipped bundle; a computed index
 * off a `globalThis` lookup is left alone, so this reads the real environment in
 * node and in the Electron main process, and yields undefined in the renderer
 * and on the web. Undefined is the same answer an upstream build gets when the
 * variable is not set.
 */
function getenvParseErrorLimit(): string | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    return proc?.env?.["PARSE_ERROR_LIMIT"];
  } catch {
    return undefined; /* a locked-down env proxy, e.g. a hardened worker */
  }
}

/**
 * get_parser_error_limit (parser.c L637-658): the environment's value if it is
 * a whole non-negative decimal integer, else the compile-time 20. Zero means no
 * limit.
 *
 * Computed ONCE and cached, as upstream's function-static `elimit` is — a limit
 * that changed mid-run would report a different number of errors for two
 * identical files.
 */
export function getParserErrorLimit(): number {
  if (overrideLimit === undefined) {
    overrideLimit = parseParserErrorLimitEnv(getenvParseErrorLimit());
  }
  return overrideLimit ?? PARSE_ERROR_LIMIT;
}

/**
 * Force the limit, or pass `undefined` to drop back to the cached-getenv path.
 * The seam exists for the tests that have to exercise both sides of the cap;
 * nothing in the game calls it.
 */
export function setParserErrorLimit(limit: number | null | undefined): void {
  overrideLimit = limit;
}

/**
 * strtol(s, &end, 10), enough of it for the env parse: leading whitespace, an
 * optional sign, then base-10 digits. `end` is the index one past the last
 * digit consumed, or 0 when no digits were found at all — C sets `end == nptr`
 * in that case, NOT the post-whitespace position, and the caller's `!*end` test
 * depends on the difference.
 */
function strtol10(s: string): { value: number; end: number } {
  let i = 0;
  while (i < s.length && " \t\n\v\f\r".includes(s[i]!)) i++;
  let sign = 1;
  if (s[i] === "+" || s[i] === "-") {
    if (s[i] === "-") sign = -1;
    i++;
  }
  const first = i;
  let value = 0;
  while (i < s.length && s[i]! >= "0" && s[i]! <= "9") {
    value = value * 10 + (s.charCodeAt(i) - 48);
    if (value > INT_MAX) value = INT_MAX; /* LONG_MAX saturation, then clamped */
    i++;
  }
  if (i === first) return { value: 0, end: 0 };
  return { value: sign * value, end: i };
}

/**
 * The env half of get_parser_error_limit: `PARSE_ERROR_LIMIT` must be a whole
 * non-negative decimal integer with nothing after it, or it is ignored
 * (`envlimit && *envlimit && strtol(...) >= 0 && !*end`). Returns the limit to
 * install, or null to keep the compile-time default.
 *
 * Exported so the node host can parse without owning the rule.
 */
export function parseParserErrorLimitEnv(raw: string | undefined): number | null {
  if (raw === undefined || raw.length === 0) return null;
  const { value, end } = strtol10(raw);
  if (end === 0 || end !== raw.length) return null;
  if (value < 0) return null;
  return Math.min(value, INT_MAX);
}

/**
 * C's `strtok` over one line, with the state it keeps between calls.
 *
 * Reproduced rather than approximated because `parser_parse` (parser.c
 * L246-296) leans on three behaviours a `String.split(":")` does not have, and
 * all three are reachable from a hand-edited options or pref file:
 *
 *   1. **Leading delimiters are skipped.** `::option:x:yes` parses, because the
 *      first `strtok` call steps over both colons before taking a token.
 *   2. **Runs of delimiters collapse.** `option::show_damage` yields the two
 *      tokens `option` and `show_damage`, not three with an empty middle.
 *   3. **An empty delimiter set consumes the whole remainder** — that is how
 *      PARSE_T_STR takes the rest of the line, colons included — and returns
 *      null rather than "" when nothing is left.
 *
 * A split-based reader gets (2) and (3) wrong in the direction that ACCEPTS
 * malformed input, which is the direction that matters: `option:show_damage::yes`
 * is an error upstream and would have silently set the option here.
 */
export class Strtok {
  private pos = 0;

  constructor(private readonly s: string) {}

  /**
   * strtok(NULL, delims) — or strtok(s, delims) for the first call, which is
   * the same thing since the cursor starts at 0. Returns null at end of string,
   * exactly as C does when only delimiters remain.
   */
  next(delims: string): string | null {
    while (this.pos < this.s.length && delims.includes(this.s[this.pos]!)) this.pos++;
    if (this.pos >= this.s.length) return null;
    const start = this.pos;
    while (this.pos < this.s.length && !delims.includes(this.s[this.pos]!)) this.pos++;
    const token = this.s.slice(start, this.pos);
    /* C writes a '\0' over the terminating delimiter and resumes past it. */
    if (this.pos < this.s.length) this.pos++;
    return token;
  }
}

/** contains_only_spaces (z-util.c L801-806): spaces and TABS, nothing else. */
export function containsOnlySpaces(s: string): boolean {
  for (const ch of s) {
    if (ch !== " " && ch !== "\t") return false;
  }
  return true;
}

/**
 * parser_parse's comment/blank test (parser.c L239-242): leading whitespace is
 * stepped over with `isspace`, then an empty rest or a leading `#` is a skip.
 * Returns the line with that leading whitespace removed, or null to skip it.
 *
 * `isspace` is the C locale's set, which includes \v and \f — `String.trimStart`
 * would additionally eat NBSP and the Unicode space separators, so it is not a
 * substitute.
 */
export function parserSkipBlankOrComment(line: string): string | null {
  let i = 0;
  while (i < line.length && " \t\n\v\f\r".includes(line[i]!)) i++;
  const rest = line.slice(i);
  if (rest.length === 0 || rest.startsWith("#")) return null;
  return rest;
}
