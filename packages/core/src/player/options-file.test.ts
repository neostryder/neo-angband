/**
 * The customised-defaults option files (PORT_TODO 5.3), against option.c
 * L207-L328 and the parser.c tokenisation those functions inherit.
 *
 * The expectations here are transcribed from the C's format strings and from
 * `strtok`'s documented behaviour, not read back off the implementation. Where
 * a case is only interesting because a `split(":")` reader would get it wrong,
 * the test says so.
 */

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { PARSE_ERROR } from "../generated/index.js";
import { OPTION_ENTRIES } from "../generated/options.js";
import { FileMode, HostDir, NULL_HOST } from "../host/io.js";
import type { HostIo, WriteOutcome } from "../host/io.js";
import { setParserErrorLimit } from "../parser.js";
import {
  customOptionsFileName,
  optionFileErrorMessage,
  optionsInitDefaults,
  optionsRestoreCustom,
  optionsRestoreMaintainer,
  optionsSaveCustom,
  optionsSaveCustomText,
  optionTypeName,
  parseCustomOptionsText,
} from "./options-file.js";
import type { OptionOpts } from "./options-file.js";
import { DEFAULT_DELAY_FACTOR, DEFAULT_HITPOINT_WARN } from "./options.js";

/** A HostIo over a Map, so the failure paths are reachable. */
function memHost(
  files: Map<string, string> = new Map(),
  opts: { writeOutcome?: WriteOutcome; unreadable?: Set<string> } = {},
): HostIo & { files: Map<string, string> } {
  return {
    ...NULL_HOST,
    files,
    displayPath: (dir, name) => `${dir}/${name}`,
    exists: (_dir, name) => files.has(name) || (opts.unreadable?.has(name) ?? false),
    read: (_dir, name) => (opts.unreadable?.has(name) ? null : (files.get(name) ?? null)),
    write: (_dir, name, text) => {
      if (opts.writeOutcome && opts.writeOutcome !== "ok") return opts.writeOutcome;
      files.set(name, text);
      return "ok";
    },
  };
}

/** The table defaults, as options_init_defaults' first loop builds them. */
function tableDefaults(): OptionOpts {
  const out: OptionOpts = {};
  for (const e of OPTION_ENTRIES) out[e.name] = e.normal;
  return out;
}

/* Every test that does not deliberately exercise the cap pins the limit, so a
 * PARSE_ERROR_LIMIT set in the developer's shell cannot change a result. */
beforeEach(() => setParserErrorLimit(0));
afterEach(() => setParserErrorLimit(undefined));

describe("option_type_name (option.c L280-311)", () => {
  it("names all five pages in lower case, and anything else 'unknown'", () => {
    expect(optionTypeName("INTERFACE")).toBe("interface");
    expect(optionTypeName("BIRTH")).toBe("birth");
    expect(optionTypeName("CHEAT")).toBe("cheat");
    expect(optionTypeName("SCORE")).toBe("score");
    expect(optionTypeName("SPECIAL")).toBe("special");
    expect(optionTypeName("NOT_A_PAGE")).toBe("unknown");
  });

  it("builds the file name option.c strnfmts twice (L220, L270)", () => {
    expect(customOptionsFileName("BIRTH")).toBe("customized_birth_options.txt");
    expect(customOptionsFileName("INTERFACE")).toBe("customized_interface_options.txt");
  });
});

describe("options_save_custom (option.c L212-254)", () => {
  it("writes the three header lines verbatim", () => {
    const text = optionsSaveCustomText(tableDefaults(), "INTERFACE");
    const lines = text.split("\n");
    expect(lines[0]).toBe("# These are customized defaults for the interface options.");
    expect(lines[1]).toBe(
      '# All lines begin with "option:" followed by the internal option name.',
    );
    expect(lines[2]).toBe(
      "# After the name is a colon followed by yes or no for the option's state.",
    );
  });

  it("writes description-then-option for every option ON THAT PAGE, in table order", () => {
    const opts = tableDefaults();
    const text = optionsSaveCustomText(opts, "CHEAT");
    const cheats = OPTION_ENTRIES.filter((e) => e.type === "CHEAT");
    /* Fixture guard: an empty page would make every assertion below vacuous. */
    expect(cheats.length).toBeGreaterThan(0);

    const body = text.split("\n").slice(3).filter((l) => l.length > 0);
    expect(body).toEqual(
      cheats.flatMap((e) => [`# ${e.description}`, `option:${e.name}:${e.normal ? "yes" : "no"}`]),
    );
    /* And nothing from another page leaked in. */
    expect(text).not.toContain("birth_");
  });

  it("writes yes/no from the VALUE, not from the table default", () => {
    const opts = tableDefaults();
    const first = OPTION_ENTRIES.find((e) => e.type === "INTERFACE")!;
    opts[first.name] = !first.normal;
    const text = optionsSaveCustomText(opts, "INTERFACE");
    expect(text).toContain(`option:${first.name}:${first.normal ? "no" : "yes"}`);
  });

  it("ends every line with a newline, including the last (file_putf '\\n')", () => {
    expect(optionsSaveCustomText(tableDefaults(), "SCORE").endsWith("\n")).toBe(true);
  });

  it("writes to ANGBAND_DIR_USER under the page's file name, in TEXT WRITE mode", () => {
    let seen: { dir: HostDir; name: string; mode?: number } | null = null;
    const io: HostIo = {
      ...NULL_HOST,
      write: (dir, name, _text, mode) => {
        seen = { dir, name, ...(mode !== undefined ? { mode } : {}) };
        return "ok";
      },
    };
    expect(optionsSaveCustom(io, tableDefaults(), "BIRTH")).toBe(true);
    expect(seen).toEqual({
      dir: HostDir.USER,
      name: "customized_birth_options.txt",
      mode: FileMode.WRITE,
    });
  });

  it("returns false when the file cannot be created OR cannot be closed", () => {
    /* option.c folds both into one `success` boolean (L228-249), unlike
     * wiz-spoil.c which reports them separately. */
    for (const outcome of ["create-failed", "close-failed"] as const) {
      const io = memHost(new Map(), { writeOutcome: outcome });
      expect(optionsSaveCustom(io, tableDefaults(), "BIRTH")).toBe(false);
    }
  });
});

describe("options_restore_maintainer (option.c L313-322)", () => {
  it("resets every option on the page and touches no other page", () => {
    const opts = tableDefaults();
    for (const e of OPTION_ENTRIES) opts[e.name] = !e.normal; /* all wrong */
    optionsRestoreMaintainer(opts, "INTERFACE");
    for (const e of OPTION_ENTRIES) {
      expect(opts[e.name], e.name).toBe(e.type === "INTERFACE" ? e.normal : !e.normal);
    }
  });
});

describe("parse_option (option.c L44-77)", () => {
  const parse = (text: string, page = "INTERFACE") => {
    const opts = tableDefaults();
    const errors = parseCustomOptionsText(text, opts, page);
    return { opts, errors };
  };
  /* A pair of INTERFACE options with opposite defaults, so "did it change?" is
   * answerable in both directions without hard-coding a name. */
  const IFACE = OPTION_ENTRIES.filter((e) => e.type === "INTERFACE");
  const NORMAL_TRUE = IFACE.find((e) => e.normal)!;
  const NORMAL_FALSE = IFACE.find((e) => !e.normal)!;

  it("has a fixture with an option defaulting each way", () => {
    expect(NORMAL_TRUE).toBeDefined();
    expect(NORMAL_FALSE).toBeDefined();
  });

  it("sets yes and no", () => {
    const { opts, errors } = parse(
      `option:${NORMAL_TRUE.name}:no\noption:${NORMAL_FALSE.name}:yes\n`,
    );
    expect(errors).toEqual([]);
    expect(opts[NORMAL_TRUE.name]).toBe(false);
    expect(opts[NORMAL_FALSE.name]).toBe(true);
  });

  it("skips blank lines and # comments, including the header it writes", () => {
    const written = optionsSaveCustomText(tableDefaults(), "INTERFACE");
    expect(parse(written).errors).toEqual([]);
    expect(parse("\n   \n\t\n# a comment\n   # indented comment\n").errors).toEqual([]);
  });

  it("round-trips its own writer", () => {
    const source = tableDefaults();
    for (const e of IFACE) source[e.name] = !e.normal;
    const { opts, errors } = parse(optionsSaveCustomText(source, "INTERFACE"));
    expect(errors).toEqual([]);
    for (const e of IFACE) expect(opts[e.name], e.name).toBe(!e.normal);
  });

  /* strncmp("yes", yno, 3) == 0 && contains_only_spaces(yno + 3): a PREFIX test
   * with a spaces-and-tabs-only tail, not an equality test. */
  it("accepts trailing spaces and tabs after yes/no", () => {
    expect(parse(`option:${NORMAL_FALSE.name}:yes  \t `).opts[NORMAL_FALSE.name]).toBe(true);
    expect(parse(`option:${NORMAL_TRUE.name}:no\t`).opts[NORMAL_TRUE.name]).toBe(false);
  });

  it("rejects a longer word that merely starts with yes/no", () => {
    /* Both arms, because they are two separate strncmp/contains_only_spaces
     * pairs in the C (L67, L71) and a mutation battery will find the one that
     * has no test. */
    const yes = parse(`option:${NORMAL_FALSE.name}:yesterday`);
    expect(yes.errors.map((e) => e.error)).toEqual([PARSE_ERROR.INVALID_VALUE]);
    expect(yes.opts[NORMAL_FALSE.name]).toBe(NORMAL_FALSE.normal);

    const no = parse(`option:${NORMAL_TRUE.name}:nope`);
    expect(no.errors.map((e) => e.error)).toEqual([PARSE_ERROR.INVALID_VALUE]);
    expect(no.opts[NORMAL_TRUE.name]).toBe(NORMAL_TRUE.normal);
  });

  it("rejects anything else as INVALID_VALUE and leaves the option alone", () => {
    for (const v of ["true", "1", "Yes", "NO", "y"]) {
      const { opts, errors } = parse(`option:${NORMAL_FALSE.name}:${v}`);
      expect(errors.map((e) => e.error), v).toEqual([PARSE_ERROR.INVALID_VALUE]);
      expect(opts[NORMAL_FALSE.name], v).toBe(NORMAL_FALSE.normal);
    }
  });

  it("rejects an option that exists but is on ANOTHER page", () => {
    /* The search loop tests `options[opt].type == ctx->page` BEFORE the name
     * compare (L57-63), which is what keeps a birth option out of the
     * interface file rather than silently writing it. */
    const birth = OPTION_ENTRIES.find((e) => e.type === "BIRTH")!;
    const { opts, errors } = parse(`option:${birth.name}:yes`, "INTERFACE");
    expect(errors.map((e) => e.error)).toEqual([PARSE_ERROR.INVALID_OPTION]);
    expect(opts[birth.name]).toBe(birth.normal);
    /* ...and the same line in the birth file is fine. */
    expect(parse(`option:${birth.name}:${birth.normal ? "no" : "yes"}`, "BIRTH").errors).toEqual(
      [],
    );
  });

  it("rejects an unknown name as INVALID_OPTION", () => {
    expect(parse("option:no_such_option:yes").errors.map((e) => e.error)).toEqual([
      PARSE_ERROR.INVALID_OPTION,
    ]);
  });

  it("rejects a directive that is not `option`", () => {
    const errors = parse("colour:red:1").errors;
    expect(errors.map((e) => e.error)).toEqual([PARSE_ERROR.UNDEFINED_DIRECTIVE]);
    /* p->errmsg is the offending token (parser.c L256). */
    expect(errors[0]!.msg).toBe("colour");
    expect(errors[0]!.col).toBe(1);
  });

  it("reports a missing name at column 2 and a missing value at column 3", () => {
    /* colno is bumped once per spec before that spec's token is taken
     * (parser.c L270), so the two missing fields report different columns. */
    const noName = parse("option").errors;
    expect(noName.map((e) => [e.error, e.col, e.msg])).toEqual([
      [PARSE_ERROR.MISSING_FIELD, 2, "name"],
    ]);
    const noValue = parse(`option:${NORMAL_TRUE.name}`).errors;
    expect(noValue.map((e) => [e.error, e.col, e.msg])).toEqual([
      [PARSE_ERROR.MISSING_FIELD, 3, "yno"],
    ]);
  });

  it("counts EVERY line for the line number, comments and blanks included", () => {
    /* p->lineno++ happens before the comment test (parser.c L234 vs L239). */
    const errors = parse("# one\n\n# three\noption:nope:yes\n").errors;
    expect(errors.map((e) => e.line)).toEqual([4]);
  });

  /* ---- the three strtok behaviours a split(":") reader gets wrong ---- */

  it("collapses a run of colons instead of seeing an empty field", () => {
    /* `option::name` is TWO tokens to strtok. A split would see three and read
     * the name as "", so this line would be an unknown-option error there;
     * upstream parses it as a normal set. */
    const { opts, errors } = parse(`option::${NORMAL_FALSE.name}:yes`);
    expect(errors).toEqual([]);
    expect(opts[NORMAL_FALSE.name]).toBe(true);
  });

  it("skips leading colons before the directive", () => {
    const { opts, errors } = parse(`::option:${NORMAL_FALSE.name}:yes`);
    expect(errors).toEqual([]);
    expect(opts[NORMAL_FALSE.name]).toBe(true);
  });

  it("gives the whole remainder to the value field, colons included", () => {
    /* PARSE_T_STR is strtok(sp, "") - it consumes the rest of the line. So
     * `:yes` arrives as ":yes" and fails, where a split reader would have
     * handed the handler a clean "yes" and set the option. */
    const { opts, errors } = parse(`option:${NORMAL_FALSE.name}::yes`);
    expect(errors.map((e) => e.error)).toEqual([PARSE_ERROR.INVALID_VALUE]);
    expect(opts[NORMAL_FALSE.name]).toBe(NORMAL_FALSE.normal);

    const trailing = parse(`option:${NORMAL_FALSE.name}:yes:extra`);
    expect(trailing.errors.map((e) => e.error)).toEqual([PARSE_ERROR.INVALID_VALUE]);
  });
});

describe("the parse error limit (parser.c L637-658, option.c L292-305)", () => {
  const bad = (n: number): string =>
    Array.from({ length: n }, (_, i) => `option:no_such_${i}:yes`).join("\n");

  it("defaults to 20, not to unlimited", () => {
    setParserErrorLimit(undefined); /* back to getenv/compile-time */
    const opts = tableDefaults();
    expect(parseCustomOptionsText(bad(25), opts, "INTERFACE")).toHaveLength(20);
  });

  it("BREAKS the read loop, so lines past the limit are never applied", () => {
    /* `if (counte >= maxe - 1) break` leaves the file. This is the half that
     * makes the limit behavioural rather than cosmetic. */
    const target = OPTION_ENTRIES.find((e) => e.type === "INTERFACE" && !e.normal)!;
    const opts = tableDefaults();
    const text = `${bad(3)}\noption:${target.name}:yes\n`;
    const errors = parseCustomOptionsText(text, opts, "INTERFACE", 3);
    expect(errors).toHaveLength(3);
    expect(opts[target.name]).toBe(false); /* the good line was never reached */

    /* Control: with a limit of 4 the same file gets there. */
    const opts2 = tableDefaults();
    parseCustomOptionsText(text, opts2, "INTERFACE", 4);
    expect(opts2[target.name]).toBe(true);
  });

  it("treats zero as no limit", () => {
    const opts = tableDefaults();
    expect(parseCustomOptionsText(bad(25), opts, "INTERFACE", 0)).toHaveLength(25);
  });
});

describe("options_restore_custom (option.c L263-309)", () => {
  it("falls back to the maintainer's defaults when the file is absent, and says true", () => {
    const io = memHost();
    const opts = tableDefaults();
    for (const e of OPTION_ENTRIES) opts[e.name] = !e.normal;
    expect(optionsRestoreCustom(io, opts, "INTERFACE")).toBe(true);
    for (const e of OPTION_ENTRIES) {
      expect(opts[e.name], e.name).toBe(e.type === "INTERFACE" ? e.normal : !e.normal);
    }
  });

  it("returns FALSE only when the file exists but cannot be opened", () => {
    const name = customOptionsFileName("INTERFACE");
    const io = memHost(new Map(), { unreadable: new Set([name]) });
    const opts = tableDefaults();
    const before = { ...opts };
    expect(optionsRestoreCustom(io, opts, "INTERFACE")).toBe(false);
    /* Nothing is applied, and crucially the maintainer defaults are NOT: the
     * early-return at L273 is the only path that resets. */
    expect(opts).toEqual(before);
  });

  it("returns true for a file that parsed badly, and applies the good lines", () => {
    const target = OPTION_ENTRIES.find((e) => e.type === "INTERFACE" && !e.normal)!;
    const io = memHost(
      new Map([
        [
          customOptionsFileName("INTERFACE"),
          `option:garbage:yes\noption:${target.name}:yes\n`,
        ],
      ]),
    );
    const opts = tableDefaults();
    const logged: string[] = [];
    expect(optionsRestoreCustom(io, opts, "INTERFACE", (m) => logged.push(m))).toBe(true);
    expect(opts[target.name]).toBe(true);
    /* The empty `msg` is upstream's: a HANDLER error leaves p->errmsg at
     * whatever the last FIELD error wrote, and this is the first error in the
     * file, so the buffer is still the mem_zalloc'd empty string. */
    expect(logged).toEqual([
      "Parse error in user/customized_interface_options.txt line 1 column 3: : invalid option",
    ]);
  });

  it("round-trips through a host: save, change everything, restore", () => {
    const io = memHost();
    const chosen = tableDefaults();
    for (const e of OPTION_ENTRIES) if (e.type === "INTERFACE") chosen[e.name] = !e.normal;
    expect(optionsSaveCustom(io, chosen, "INTERFACE")).toBe(true);

    const opts = tableDefaults();
    expect(optionsRestoreCustom(io, opts, "INTERFACE")).toBe(true);
    for (const e of OPTION_ENTRIES) {
      if (e.type === "INTERFACE") expect(opts[e.name], e.name).toBe(!e.normal);
    }
  });
});

describe("options_init_defaults (option.c L186-205)", () => {
  it("restores BIRTH and INTERFACE from file, and no other page", () => {
    const io = memHost();
    /* Write a customised file for all five pages with everything inverted. */
    const inverted = tableDefaults();
    for (const e of OPTION_ENTRIES) inverted[e.name] = !e.normal;
    for (const page of ["BIRTH", "INTERFACE", "CHEAT", "SCORE", "SPECIAL"]) {
      optionsSaveCustom(io, inverted, page);
    }

    const { opts } = optionsInitDefaults(io);
    for (const e of OPTION_ENTRIES) {
      const restored = e.type === "BIRTH" || e.type === "INTERFACE";
      expect(opts[e.name], `${e.type} ${e.name}`).toBe(restored ? !e.normal : e.normal);
    }
  });

  it("is the plain table defaults when no customised file exists", () => {
    expect(optionsInitDefaults(memHost()).opts).toEqual(tableDefaults());
  });

  it("sets delay_factor and hitpoint_warn AFTER the files, so no file can move them", () => {
    const io = memHost();
    /* The files carry booleans only, so this is a statement about ORDER: L201
     * and L204 run last and are unconditional. */
    const res = optionsInitDefaults(io);
    expect(res.delayFactor).toBe(DEFAULT_DELAY_FACTOR);
    expect(res.hitpointWarn).toBe(DEFAULT_HITPOINT_WARN);
  });

  it("survives an unreadable customised file rather than refusing to start", () => {
    /* The two restore calls' return values are discarded (L198-199). */
    const io = memHost(new Map(), {
      unreadable: new Set([customOptionsFileName("BIRTH")]),
    });
    expect(optionsInitDefaults(io).opts).toEqual(tableDefaults());
  });
});

describe("the plog line (option.c L299-302)", () => {
  it("formats line, column, token and the parser_error_str text", () => {
    expect(
      optionFileErrorMessage("user/customized_birth_options.txt", {
        line: 7,
        col: 2,
        msg: "name",
        error: PARSE_ERROR.MISSING_FIELD,
      }),
    ).toBe("Parse error in user/customized_birth_options.txt line 7 column 2: name: missing field");
  });
});
