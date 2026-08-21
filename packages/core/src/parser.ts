/**
 * reference/src/parser.c's shared machinery: the parts that are grammar-
 * independent and were, until now, re-decided by each grammar that needed them.
 *
 * WHY THIS EXISTS
 *
 * Upstream has ONE `struct parser`. Every data file, every pref file and the
 * customised-options files all go through `parser_parse`, so they share a
 * tokeniser and an error table. The port has no single parser object (each
 * grammar is a plain function over already-read text, which is the right shape
 * for a bundled-JSON game), but the pieces those grammars must agree on are
 * still one thing, and this module is where they live: the `parser_state`
 * shape, `parser_error_str[]`, `strtok` and the two little z-util predicates
 * the read loops share.
 *
 * WHAT USED TO BE HERE, AND WHY IT IS NOT (#272)
 *
 * A `PARSE_ERROR_LIMIT = 20`, a `PARSE_ERROR_LIMIT` environment override and a
 * getter/setter pair around them. THE LIMIT HAD NO 4.2.6 COUNTERPART (citation
 * sweep, #268): there is no `PARSE_ERROR_LIMIT`, no `get_parser_error_limit`
 * and no error COUNT anywhere in Angband 4.2.6. `process_pref_file_named`
 * (ui-prefs.c L1225-1231) `break`s out of the file on the FIRST bad line, and
 * `print_error` (ui-prefs.c L1195-1202) reports that one error. The citations
 * that used to sit on those declarations pointed at the `PARSE_T_*` enum
 * (parser.c L38) and at a range past the end of that 617-line file.
 *
 * So it was a port EXTENSION - a convenience, and the port adds nothing. The
 * owner's ruling (2026-08-14) was "if this parse error limit is a QoL
 * improvement, move it to the mod; if not, strike it", and it moved: core now
 * stops at the first bad line, and `visuals/prefs.ts`'s `setPrefErrorPolicy` is
 * the seam a mod installs the forgiving behaviour through. The four removed
 * exports are recorded in docs/modding/MOD_COMPATIBILITY.md.
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
 * parser_error_str[] (datafile.c L34-37), generated straight from
 * list-parser-errors.h - the codegen'd table, NOT a hand-typed copy. Upstream
 * spells several of these differently from the handler names ("invalid colour",
 * "unrecognized tval"), which is exactly the sort of thing a transcription gets
 * wrong.
 */
export function parserErrorText(code: number): string {
  return PARSER_ERROR_ENTRIES[code]?.description ?? "generic error";
}

/**
 * C's `strtok` over one line, with the state it keeps between calls.
 *
 * Reproduced rather than approximated because `parser_parse` (parser.c
 * L210-348) leans on three behaviours a `String.split(":")` does not have, and
 * all three are reachable from a hand-edited options or pref file:
 *
 *   1. **Leading delimiters are skipped.** `::option:x:yes` parses, because the
 *      first `strtok` call steps over both colons before taking a token.
 *   2. **Runs of delimiters collapse.** `option::show_damage` yields the two
 *      tokens `option` and `show_damage`, not three with an empty middle.
 *   3. **An empty delimiter set consumes the whole remainder.** That is how
 *      PARSE_T_STR takes the rest of the line, colons included. It returns
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
   * strtok(NULL, delims), or strtok(s, delims) for the first call, which is
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
 * `isspace` is the C locale's set, which includes \v and \f. `String.trimStart`
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
