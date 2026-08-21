/**
 * The customised-defaults option files, ported from reference/src/option.c
 * 148-345: `options_save_custom`, `options_restore_custom` and
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
 * The second is read by `options_init_defaults` (option.c:148-164, called from
 * `player_init`, player.c:491) BEFORE any birth choice is made, so it sets what
 * the birth screen opens on. That is the whole point of it, and it is why the
 * port's previous position - recorded in web/src/options.ts as "the port has no
 * separate custom-defaults snapshot: the game save IS the persistence" - was a
 * behavioural gap rather than a filing decision. The savefile cannot seed the
 * NEXT character; there is no savefile yet.
 *
 * Only BIRTH and INTERFACE are restored at init. `options_init_defaults` (:155-156) names
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
 * THE READER IS NOT A `struct parser`, AND THAT IS THE POINT. 4.2.6 says so in
 * a comment of its own (option.c:284-287): "Could use run_parser(), but that
 * exits the application if there are syntax errors.  Therefore, use our own
 * parsing." So `options_restore_custom` hand-rolls a read loop over `file_getl`
 * - `strstr` for "option:", a prefix match against the page's option names, and
 * a `msg()` per bad line with no error cap and no parser_state anywhere.
 *
 * Upstream MASTER later replaced that loop with `parser_reg(p, "option sym name
 * str yno", parse_option)`, and until 2026-08-12 this file was a careful port of
 * THAT - PARSE_ERROR codes, colno bookkeeping and the errmsg-buffer wart
 * included. It was found by #143, which moved reference/ back to the 4.2.6 tag,
 * and it is now written down as the divergence it was: the three msg() lines
 * below are 4.2.6's, and the parser-shaped reader is gone rather than kept
 * behind a switch, because nothing a player can see was better about it. See
 * docs/modding/MOD_COMPATIBILITY.md for the one export that went with it.
 */

import { OPTION_ENTRIES } from "../generated/options.js";
import { FileMode, FileType, HostDir } from "../host/io.js";
import type { HostIo } from "../host/io.js";
import { containsOnlySpaces } from "../parser.js";
import { DEFAULT_DELAY_FACTOR, DEFAULT_HITPOINT_WARN } from "./options.js";

/**
 * `struct player_options.opt[]` (player.h): every option's boolean value, keyed
 * by the option's internal name rather than its OPT_ index.
 */
export type OptionOpts = Record<string, boolean>;

/** The `type` field of OPTION_ENTRIES - upstream's OP_* option page. */
export type OptionPage = (typeof OPTION_ENTRIES)[number]["type"];

/**
 * option_type_name (option.c:42-73): the lower-case short name that goes in
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
 * expression in both options_save_custom (:177) and options_restore_custom
 * (:232), which is why it is one function here.
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
 * The exact bytes options_save_custom writes (option.c:185-205): a three-line
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
 * options_save_custom (option.c:171-215). Returns false when the file could
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
 * The whole read loop of options_restore_custom (option.c:292-331) over
 * already-read text, applied to `opts`. Returns the `msg()` lines it produced,
 * in order - there is no error cap and no `struct parser_state`, because there
 * is no parser (option.c:284-287, quoted at the top of this file).
 *
 * The shape of a line is `strstr(buf, "option:")`, which is why so much of this
 * is about what comes BEFORE the match:
 *
 *   - no match at all: the line has to be a comment or whitespace. Everything
 *     up to the first `#` is judged, so `foo # bar` is unparseable and
 *     `   # anything` is fine.
 *   - a match with a `#` before it: the directive is inside a comment, so the
 *     line is skipped entirely - and only the text before the `#` is judged.
 *     This is what lets the writer's own `# <description>` lines carry the word
 *     `option:` without the reader choking on them.
 *   - a match with non-space text before it and no `#`: unparseable.
 *
 * The name search is a PREFIX match against the page's options requiring a
 * colon immediately after (`sub[lname] == ':'`), not a split-then-compare, and
 * it walks the table in order. Restricting it to the page is the mechanism that
 * keeps a birth option out of the interface file: an option that exists but
 * lives elsewhere is "Unrecognized" here rather than a cross-page write.
 */
export function parseCustomOptionsText(
  text: string,
  opts: OptionOpts,
  page: string,
): string[] {
  const pageName = optionTypeName(page);
  const messages: string[] = [];
  const entries = pageEntries(page);
  let lineNo = 1;

  for (const rawLine of text.split("\n")) {
    /* file_getl strips the newline; a CRLF file leaves the CR behind on
     * platforms whose fgets does not, so drop it here as the pref reader does. */
    const line = rawLine.replace(/\r$/, "");
    /* `msg("Line %d of the customized %s options is not parseable.", ...)`,
     * which the C writes out three times from three branches (:302, :317, :325). */
    const unparseable = (): void => {
      messages.push(
        `Line ${lineNo} of the customized ${pageName} options is not parseable.`,
      );
    };

    const at = line.indexOf("option:");
    if (at < 0) {
      /* Not an option, so it should be a comment or whitespace. */
      const hash = line.indexOf("#");
      if (!containsOnlySpaces(hash < 0 ? line : line.slice(0, hash))) unparseable();
      lineNo++;
      continue;
    }

    /* `*sub = '\0'` - from here on the C is judging the HEAD of the line. */
    const head = line.slice(0, at);
    const hash = head.indexOf("#");
    if (hash >= 0) {
      /* Ignore if the "option:" is embedded in a comment. */
      if (!containsOnlySpaces(head.slice(0, hash))) unparseable();
      lineNo++;
      continue;
    }
    if (!containsOnlySpaces(head)) {
      unparseable();
      lineNo++;
      continue;
    }

    /* Try to find the option. `sub += 7` steps over "option:". */
    const rest = line.slice(at + 7);
    let found = false;
    for (const entry of entries) {
      /* `!options[opt].name` - 4.2.6's table has no nameless row, so this is
       * the C's guard kept rather than a case anything can reach. */
      if (!entry.name) continue;
      const lname = entry.name.length;
      if (!rest.startsWith(entry.name) || rest[lname] !== ":") continue;
      found = true;

      /* strncmp("yes", sub + lname + 1, 3) == 0 && contains_only_spaces(...).
       * Prefix, NOT equality: "yes   " is accepted and "yesterday" is not, and
       * the tail may hold only spaces and tabs. */
      const value = rest.slice(lname + 1);
      if (value.startsWith("yes") && containsOnlySpaces(value.slice(3))) {
        opts[entry.name] = true;
      } else if (value.startsWith("no") && containsOnlySpaces(value.slice(2))) {
        opts[entry.name] = false;
      } else {
        messages.push(
          `Value at line ${lineNo} of the customized ${pageName} options is not yes or no.`,
        );
      }
      break;
    }
    if (!found) {
      messages.push(
        `Unrecognized option at line ${lineNo} of the customized ${pageName} options.`,
      );
    }
    lineNo++;
  }
  /* A trailing newline makes split() yield one extra empty element, which
   * file_getl would never have returned. It parses as a blank line and is
   * skipped, so the only visible effect would be lineNo counting one line too
   * many - and it never reaches a message, because a blank line cannot produce
   * one. */
  return messages;
}

/**
 * options_restore_maintainer (option.c:338-345): every option on the page back
 * to its table `normal`. No file, no failure mode, and no return value.
 */
export function optionsRestoreMaintainer(opts: OptionOpts, page: string): void {
  for (const entry of pageEntries(page)) {
    opts[entry.name] = entry.normal;
  }
}

/**
 * options_restore_custom (option.c:225-333).
 *
 * Returns TRUE when there was nothing to restore (the page's file does not
 * exist, so the maintainer's defaults are applied instead) and true again when
 * the file was read, however badly it parsed. It returns FALSE for exactly one
 * case: the file is present but could not be opened. Upstream's caller reads
 * that distinction - "Restore failed." is printed only for the false.
 *
 * (Upstream has a second false, from a failing `file_close` at :329. HostIo
 * reads a whole file in one call and has no handle to close, so there is no
 * counterpart and nothing is lost: a close that fails on a READ has already
 * delivered the bytes.)
 */
export function optionsRestoreCustom(
  io: HostIo,
  opts: OptionOpts,
  page: string,
  msg?: (message: string) => void,
): boolean {
  const name = customOptionsFileName(page);
  if (!io.exists(HostDir.USER, name)) {
    optionsRestoreMaintainer(opts, page);
    return true;
  }
  const text = io.read(HostDir.USER, name);
  if (text === null) return false;

  const messages = parseCustomOptionsText(text, opts, page);
  if (msg) for (const m of messages) msg(m);
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
 * options_init_defaults (option.c:148-164), whole and in order: the table
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
  msg?: (message: string) => void,
): InitialOptions {
  const opts: OptionOpts = {};
  for (const entry of OPTION_ENTRIES) opts[entry.name] = entry.normal;
  optionsRestoreCustom(io, opts, "BIRTH", msg);
  optionsRestoreCustom(io, opts, "INTERFACE", msg);
  return {
    opts,
    delayFactor: DEFAULT_DELAY_FACTOR,
    hitpointWarn: DEFAULT_HITPOINT_WARN,
  };
}
