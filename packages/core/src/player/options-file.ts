/**
 * The customised-defaults option files, ported from reference/src/option.c
 * L207-L328: `options_save_custom`, `options_restore_custom` and
 * `options_restore_maintainer`, plus the `options_init_defaults` ordering that
 * makes them matter.
 *
 * WHAT THESE ARE, AND WHY THEY ARE NOT THE SAVEFILE
 *
 * Upstream keeps two entirely separate persistences for options:
 *
 *   - the SAVEFILE holds the options this character is playing with;
 *   - `customized_birth_options.txt` and `customized_interface_options.txt` in
 *     ANGBAND_DIR_USER hold the defaults the PLAYER wants every NEW character
 *     to start from.
 *
 * The second is read by `options_init_defaults` (option.c L192-199, called from
 * `player_init`, player.c:491) BEFORE any birth choice is made, so it sets what
 * the birth screen opens on. That is the whole point of it, and it is why the
 * port's previous position - recorded in web/src/options.ts as "the port has no
 * separate custom-defaults snapshot: the game save IS the persistence" - was a
 * behavioural gap rather than a filing decision. The savefile cannot seed the
 * NEXT character; there is no savefile yet.
 *
 * Only BIRTH and INTERFACE are restored at init. `options_init_defaults` names
 * those two pages and no others, so a `customized_cheat_options.txt` written by
 * hand is never read - and upstream cannot write one either, because
 * `option_toggle_menu` only gives `cmd_keys` containing S/R/X to the interface
 * page and the AT-BIRTH birth page (ui-options.c L333-348).
 *
 * SHAPE. These functions take `OptionOpts`, a plain name -> boolean map, which
 * is the port's spelling of `struct player_options.opt[]`. They deliberately do
 * NOT take an `OptionState`: `OptionState.set` refuses birth options after
 * construction (they lock at birth, as upstream's read-only in-game page shows),
 * and every one of upstream's calls here happens either before birth or on a
 * page whose options are not locked. Passing the raw map keeps the lock where it
 * belongs instead of adding a bypass to it.
 *
 * The grammar is `parser.c`'s, not a lookalike - see parser.ts Strtok for the
 * three strtok behaviours a `split(":")` gets wrong, all of which are reachable
 * from a hand-edited file.
 */

import { PARSE_ERROR } from "../generated/index.js";
import { OPTION_ENTRIES } from "../generated/options.js";
import { FileMode, FileType, HostDir } from "../host/io.js";
import type { HostIo } from "../host/io.js";
import {
  containsOnlySpaces,
  getParserErrorLimit,
  parserErrorText,
  parserSkipBlankOrComment,
  Strtok,
} from "../parser.js";
import type { ParserState } from "../parser.js";
import { DEFAULT_DELAY_FACTOR, DEFAULT_HITPOINT_WARN } from "./options.js";

/**
 * `struct player_options.opt[]` (player.h): every option's boolean value, keyed
 * by the option's internal name rather than its OPT_ index.
 */
export type OptionOpts = Record<string, boolean>;

/** The `type` field of OPTION_ENTRIES - upstream's OP_* option page. */
export type OptionPage = (typeof OPTION_ENTRIES)[number]["type"];

/**
 * option_type_name (option.c L280-311): the lower-case short name that goes in
 * the file name and in the file's own first line. The `unknown` arm is
 * upstream's `default:`; in the port the page is a string union, so it is only
 * reachable from a caller that widened the type.
 */
export function optionTypeName(page: string): string {
  switch (page) {
    case "INTERFACE":
      return "interface";
    case "BIRTH":
      return "birth";
    case "CHEAT":
      return "cheat";
    case "SCORE":
      return "score";
    case "SPECIAL":
      return "special";
    default:
      return "unknown";
  }
}

/**
 * `strnfmt(file_name, ..., "customized_%s_options.txt", page_name)` - the same
 * expression in both options_save_custom (L221) and options_restore_custom
 * (L271), which is why it is one function here.
 */
export function customOptionsFileName(page: string): string {
  return `customized_${optionTypeName(page)}_options.txt`;
}

/**
 * The options on one page, in table order. Upstream walks `opt` from 0 to
 * OPT_MAX and tests `options[opt].type == page`, so index 0 (OPT_none, type
 * SPECIAL, empty description) is included on the SPECIAL page exactly as it is
 * here.
 */
function pageEntries(page: string): readonly (typeof OPTION_ENTRIES)[number][] {
  return OPTION_ENTRIES.filter((e) => e.type === page);
}

/* ------------------------------------------------------------------------
 * The writer
 * ------------------------------------------------------------------------ */

/**
 * The exact bytes options_save_custom writes (option.c L226-246): a three-line
 * header naming the page, then two lines per option - its description as a
 * comment, then the `option:name:yes|no` line the reader parses back.
 *
 * Pure, so the file can be compared against the C's format string by eye and by
 * test without a host.
 */
export function optionsSaveCustomText(opts: Readonly<OptionOpts>, page: string): string {
  const pageName = optionTypeName(page);
  let out = `# These are customized defaults for the ${pageName} options.\n`;
  out += `# All lines begin with "option:" followed by the internal option name.\n`;
  out += `# After the name is a colon followed by yes or no for the option's state.\n`;
  for (const entry of pageEntries(page)) {
    out += `# ${entry.description}\n`;
    out += `option:${entry.name}:${opts[entry.name] ? "yes" : "no"}\n`;
  }
  return out;
}

/**
 * options_save_custom (option.c L212-254). Returns false when the file could
 * not be opened OR could not be closed - upstream folds both into one boolean
 * here (unlike wiz-spoil.c, which reports them separately), and the caller
 * prints "Save failed." either way.
 */
export function optionsSaveCustom(
  io: HostIo,
  opts: Readonly<OptionOpts>,
  page: string,
): boolean {
  const text = optionsSaveCustomText(opts, page);
  const outcome = io.write(
    HostDir.USER,
    customOptionsFileName(page),
    text,
    FileMode.WRITE,
    FileType.TEXT,
  );
  return outcome === "ok";
}

/* ------------------------------------------------------------------------
 * The reader
 * ------------------------------------------------------------------------ */

/**
 * parse_option (option.c L44-77) over one already-tokenised line, applied to
 * `opts`. Returns the parser_error code, or PARSE_ERROR.NONE.
 *
 * The name must be on THIS page: upstream's search loop tests
 * `options[opt].type == ctx->page` before comparing names, so
 * `option:birth_force_descend:yes` inside customized_interface_options.txt is
 * PARSE_ERROR_INVALID_OPTION rather than a cross-page write. That is the
 * mechanism that keeps a birth option out of the interface file.
 */
function applyOptionLine(
  opts: OptionOpts,
  page: string,
  name: string,
  yno: string,
): number {
  const entry = pageEntries(page).find((e) => e.name === name);
  if (!entry) return PARSE_ERROR.INVALID_OPTION;

  /* strncmp("yes", yno, 3) == 0 && contains_only_spaces(yno + 3). Prefix, NOT
   * equality: "yes   " is accepted and "yesterday" is not, and the tail may
   * hold only spaces and tabs. */
  if (yno.startsWith("yes") && containsOnlySpaces(yno.slice(3))) {
    opts[entry.name] = true;
    return PARSE_ERROR.NONE;
  }
  if (yno.startsWith("no") && containsOnlySpaces(yno.slice(2))) {
    opts[entry.name] = false;
    return PARSE_ERROR.NONE;
  }
  return PARSE_ERROR.INVALID_VALUE;
}

/**
 * `parser_parse` for the one grammar this file registers:
 * `parser_reg(p, "option sym name str yno", parse_option)` (option.c L288).
 *
 * `errmsg` is threaded through rather than reset per line, and that is
 * deliberate: upstream's `p->errmsg` is a buffer on the parser that only the
 * FIELD-level errors write to (parser.c L256, L284-298). A handler error
 * (INVALID_OPTION / INVALID_VALUE) leaves whatever the last field error put
 * there, so the first such error in a file reports an empty `msg` (mem_zalloc)
 * and a later one can inherit "name" or "yno" from an earlier bad line. It is
 * scruffy, it is only ever printed, and reproducing it costs one parameter.
 */
function parseOptionLine(
  raw: string,
  opts: OptionOpts,
  page: string,
  lineNo: number,
  errmsg: string,
): { state: ParserState | null; errmsg: string } {
  const line = parserSkipBlankOrComment(raw);
  if (line === null) return { state: null, errmsg };

  const tok = new Strtok(line);

  /* strtok(cline, ":") - the directive. */
  const directive = tok.next(":");
  if (directive === null) {
    return {
      state: { line: lineNo, col: 1, msg: errmsg, error: PARSE_ERROR.MISSING_FIELD },
      errmsg,
    };
  }
  if (directive !== "option") {
    return {
      state: {
        line: lineNo,
        col: 1,
        msg: directive,
        error: PARSE_ERROR.UNDEFINED_DIRECTIVE,
      },
      errmsg: directive,
    };
  }

  /* `sym name` - colon-tokenised (parser.c L272-274). colno is bumped per spec
   * BEFORE the token is taken, so a missing name reports column 2. */
  const name = tok.next(":");
  if (name === null) {
    return {
      state: { line: lineNo, col: 2, msg: "name", error: PARSE_ERROR.MISSING_FIELD },
      errmsg: "name",
    };
  }

  /* `str yno` - strtok(sp, "") takes the whole remainder, colons included. */
  const yno = tok.next("");
  if (yno === null) {
    return {
      state: { line: lineNo, col: 3, msg: "yno", error: PARSE_ERROR.MISSING_FIELD },
      errmsg: "yno",
    };
  }

  const error = applyOptionLine(opts, page, name, yno);
  if (error === PARSE_ERROR.NONE) return { state: null, errmsg };
  return { state: { line: lineNo, col: 3, msg: errmsg, error }, errmsg };
}

/**
 * The whole read loop of options_restore_custom (option.c L285-306) over
 * already-read text, applied to `opts`. Returns every error it reported, in
 * order, capped exactly as upstream caps it.
 *
 * The cap is not cosmetic. `if (maxe) { if (counte >= maxe - 1) break; ++counte; }`
 * BREAKS the read loop, so with the default limit of 20 upstream stops applying
 * the file after its twentieth bad line and everything below is ignored.
 */
export function parseCustomOptionsText(
  text: string,
  opts: OptionOpts,
  page: string,
  errorLimit = getParserErrorLimit(),
): ParserState[] {
  const errors: ParserState[] = [];
  let counte = 0;
  let errmsg = ""; /* mem_zalloc'd parser: the buffer starts empty. */
  let lineNo = 0;

  for (const rawLine of text.split("\n")) {
    lineNo++;
    /* file_getl strips the newline; a CRLF file leaves the CR behind on
     * platforms whose fgets does not, so drop it here as the pref reader does. */
    const line = rawLine.replace(/\r$/, "");
    const res = parseOptionLine(line, opts, page, lineNo, errmsg);
    errmsg = res.errmsg;
    if (res.state === null) continue;
    errors.push(res.state);
    if (errorLimit) {
      if (counte >= errorLimit - 1) break;
      counte++;
    }
  }
  /* A trailing newline makes split() yield one extra empty element, which
   * file_getl would never have returned. It parses as a blank line and is
   * skipped, so the only visible effect would be lineNo counting one line too
   * many - and it never reaches an error report, because a blank line cannot
   * produce one. */
  return errors;
}

/**
 * options_restore_maintainer (option.c L313-322): every option on the page back
 * to its table `normal`. No file, no failure mode, and no return value.
 */
export function optionsRestoreMaintainer(opts: OptionOpts, page: string): void {
  for (const entry of pageEntries(page)) {
    opts[entry.name] = entry.normal;
  }
}

/**
 * The plog_fmt an unparseable line produces (option.c L299-302). Identical in
 * shape to ui-prefs.c's print_error, because both print a parser_state.
 */
export function optionFileErrorMessage(path: string, e: ParserState): string {
  return `Parse error in ${path} line ${e.line} column ${e.col}: ${e.msg}: ${parserErrorText(
    e.error,
  )}`;
}

/**
 * options_restore_custom (option.c L263-309).
 *
 * Returns TRUE when there was nothing to restore (the page's file does not
 * exist, so the maintainer's defaults are applied instead) and true again when
 * the file was read, however badly it parsed. It returns FALSE for exactly one
 * case: the file is present but could not be opened. Upstream's caller reads
 * that distinction - "Restore failed." is printed only for the false.
 */
export function optionsRestoreCustom(
  io: HostIo,
  opts: OptionOpts,
  page: string,
  plog?: (message: string) => void,
): boolean {
  const name = customOptionsFileName(page);
  if (!io.exists(HostDir.USER, name)) {
    optionsRestoreMaintainer(opts, page);
    return true;
  }
  const text = io.read(HostDir.USER, name);
  if (text === null) return false;

  const errors = parseCustomOptionsText(text, opts, page);
  if (plog) {
    const path = io.displayPath(HostDir.USER, name);
    for (const e of errors) plog(optionFileErrorMessage(path, e));
  }
  return true;
}

/* ------------------------------------------------------------------------
 * options_init_defaults
 * ------------------------------------------------------------------------ */

/** What options_init_defaults produces: the opt[] map plus the two scalars. */
export interface InitialOptions {
  opts: OptionOpts;
  delayFactor: number;
  hitpointWarn: number;
}

/**
 * options_init_defaults (option.c L186-205), whole and in order: the table
 * defaults, then the player's customised BIRTH defaults, then their customised
 * INTERFACE defaults, then delay_factor = 40 and hitpoint_warn = 3.
 *
 * The order is the interesting part. The two scalars are set AFTER the files,
 * so a customised-options file cannot influence them - which is consistent,
 * because the files only carry booleans. And the two restore calls have their
 * return values discarded: an unreadable customised file leaves the page on the
 * table defaults and does not stop a character being made.
 */
export function optionsInitDefaults(
  io: HostIo,
  plog?: (message: string) => void,
): InitialOptions {
  const opts: OptionOpts = {};
  for (const entry of OPTION_ENTRIES) opts[entry.name] = entry.normal;
  optionsRestoreCustom(io, opts, "BIRTH", plog);
  optionsRestoreCustom(io, opts, "INTERFACE", plog);
  return {
    opts,
    delayFactor: DEFAULT_DELAY_FACTOR,
    hitpointWarn: DEFAULT_HITPOINT_WARN,
  };
}
