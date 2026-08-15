/**
 * The customised-defaults option files (PORT_TODO 5.3), against option.c:148-345.
 *
 * The expectations here are transcribed from the C's format strings and from
 * its hand-rolled read loop, not read back off the implementation. 4.2.6 says
 * in a comment why that loop is not a `struct parser` (option.c:284-287), and
 * the cases below are chosen for the places where a tidier reader - a
 * `split(":")`, a `startsWith("option:")`, a trim - would quietly disagree with
 * it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OPTION_ENTRIES } from "../generated/options.js";
import { FileMode, HostDir, NULL_HOST } from "../host/io.js";
import type { HostIo, WriteOutcome } from "../host/io.js";
import {
  customOptionsFileName,
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

describe("option_type_name (option.c:42-73)", () => {
  it("names all five pages in lower case, and anything else 'unknown'", () => {
    expect(optionTypeName("INTERFACE")).toBe("interface");
    expect(optionTypeName("BIRTH")).toBe("birth");
    expect(optionTypeName("CHEAT")).toBe("cheat");
    expect(optionTypeName("SCORE")).toBe("score");
    expect(optionTypeName("SPECIAL")).toBe("special");
    expect(optionTypeName("NOT_A_PAGE")).toBe("unknown");
  });

  it("builds the file name option.c strnfmts twice (:177, :232)", () => {
    expect(customOptionsFileName("BIRTH")).toBe("customized_birth_options.txt");
    expect(customOptionsFileName("INTERFACE")).toBe("customized_interface_options.txt");
  });
});

describe("options_save_custom (option.c:171-215)", () => {
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
    /* option.c folds both into one `success` boolean (:185-210), unlike
     * wiz-spoil.c which reports them separately. */
    for (const outcome of ["create-failed", "close-failed"] as const) {
      const io = memHost(new Map(), { writeOutcome: outcome });
      expect(optionsSaveCustom(io, tableDefaults(), "BIRTH")).toBe(false);
    }
  });
});

describe("options_restore_maintainer (option.c:338-345)", () => {
  it("resets every option on the page and touches no other page", () => {
    const opts = tableDefaults();
    for (const e of OPTION_ENTRIES) opts[e.name] = !e.normal; /* all wrong */
    optionsRestoreMaintainer(opts, "INTERFACE");
    for (const e of OPTION_ENTRIES) {
      expect(opts[e.name], e.name).toBe(e.type === "INTERFACE" ? e.normal : !e.normal);
    }
  });
});

describe("the read loop of options_restore_custom (option.c:292-331)", () => {
  const parse = (text: string, page = "INTERFACE") => {
    const opts = tableDefaults();
    const msgs = parseCustomOptionsText(text, opts, page);
    return { opts, msgs };
  };
  const NOT_PARSEABLE = (n: number, page = "interface"): string =>
    `Line ${n} of the customized ${page} options is not parseable.`;
  const UNRECOGNIZED = (n: number, page = "interface"): string =>
    `Unrecognized option at line ${n} of the customized ${page} options.`;
  const BAD_VALUE = (n: number, page = "interface"): string =>
    `Value at line ${n} of the customized ${page} options is not yes or no.`;
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
    const { opts, msgs } = parse(
      `option:${NORMAL_TRUE.name}:no\noption:${NORMAL_FALSE.name}:yes\n`,
    );
    expect(msgs).toEqual([]);
    expect(opts[NORMAL_TRUE.name]).toBe(false);
    expect(opts[NORMAL_FALSE.name]).toBe(true);
  });

  it("skips blank lines and # comments, including the header it writes", () => {
    const written = optionsSaveCustomText(tableDefaults(), "INTERFACE");
    expect(parse(written).msgs).toEqual([]);
    expect(parse("\n   \n\t\n# a comment\n   # indented comment\n").msgs).toEqual([]);
  });

  it("round-trips its own writer", () => {
    const source = tableDefaults();
    for (const e of IFACE) source[e.name] = !e.normal;
    const { opts, msgs } = parse(optionsSaveCustomText(source, "INTERFACE"));
    expect(msgs).toEqual([]);
    for (const e of IFACE) expect(opts[e.name], e.name).toBe(!e.normal);
  });

  /* strncmp("yes", sub + lname + 1, 3) == 0 && contains_only_spaces(...): a
   * PREFIX test with a spaces-and-tabs-only tail, not an equality test. */
  it("accepts trailing spaces and tabs after yes/no", () => {
    expect(parse(`option:${NORMAL_FALSE.name}:yes  \t `).opts[NORMAL_FALSE.name]).toBe(true);
    expect(parse(`option:${NORMAL_TRUE.name}:no\t`).opts[NORMAL_TRUE.name]).toBe(false);
  });

  it("rejects a longer word that merely starts with yes/no", () => {
    /* Both arms, because they are two separate strncmp/contains_only_spaces
     * pairs in the C (:313, :316) and a mutation battery will find the one that
     * has no test. */
    const yes = parse(`option:${NORMAL_FALSE.name}:yesterday`);
    expect(yes.msgs).toEqual([BAD_VALUE(1)]);
    expect(yes.opts[NORMAL_FALSE.name]).toBe(NORMAL_FALSE.normal);

    const no = parse(`option:${NORMAL_TRUE.name}:nope`);
    expect(no.msgs).toEqual([BAD_VALUE(1)]);
    expect(no.opts[NORMAL_TRUE.name]).toBe(NORMAL_TRUE.normal);
  });

  it("reports anything else as a bad value and leaves the option alone", () => {
    for (const v of ["true", "1", "Yes", "NO", "y", ""]) {
      const { opts, msgs } = parse(`option:${NORMAL_FALSE.name}:${v}`);
      expect(msgs, v).toEqual([BAD_VALUE(1)]);
      expect(opts[NORMAL_FALSE.name], v).toBe(NORMAL_FALSE.normal);
    }
  });

  it("rejects an option that exists but is on ANOTHER page", () => {
    /* The search loop tests `options[opt].type != page` BEFORE the name
     * compare (:293-296), which is what keeps a birth option out of the
     * interface file rather than silently writing it. */
    const birth = OPTION_ENTRIES.find((e) => e.type === "BIRTH")!;
    const { opts, msgs } = parse(`option:${birth.name}:yes`, "INTERFACE");
    expect(msgs).toEqual([UNRECOGNIZED(1)]);
    expect(opts[birth.name]).toBe(birth.normal);
    /* ...and the same line in the birth file is fine. */
    expect(parse(`option:${birth.name}:${birth.normal ? "no" : "yes"}`, "BIRTH").msgs).toEqual(
      [],
    );
  });

  it("names the PAGE in every message, not just the line", () => {
    /* The three format strings all take page_name, and a birth file that
     * complains about "interface options" would send its reader to the wrong
     * file. */
    expect(parse("option:no_such_option:yes", "BIRTH").msgs).toEqual([UNRECOGNIZED(1, "birth")]);
  });

  it("reports an unknown name as Unrecognized", () => {
    expect(parse("option:no_such_option:yes").msgs).toEqual([UNRECOGNIZED(1)]);
  });

  it("counts EVERY line for the line number, comments and blanks included", () => {
    /* ++linenum runs on every path through the loop, including the two that
     * `continue` without a message. */
    expect(parse("# one\n\n# three\noption:nope:yes\n").msgs).toEqual([UNRECOGNIZED(4)]);
  });

  it("has no error cap: every bad line in a long file is reported and the file is read to the end", () => {
    /* 4.2.6's customised-options reader is not a `struct parser` at all
     * (option.c:284-287) - it is a hand-rolled `while (file_getl(...))` that
     * `continue`s past a line it does not understand - so a bad line costs that
     * line and nothing else. Upstream MASTER's replacement runs the file through
     * run_parser instead, which stops on the first error, and the good line at
     * the end would be lost. That difference is the whole of #149 in one
     * assertion.
     *
     * Contrast visuals/prefs.ts, which models a DIFFERENT loop
     * (process_pref_file_named) and does stop on the first bad line. The port
     * briefly had a 20-error cap shared between the two; #272 removed it as an
     * extension, and this reader was never the one that wanted it. */
    const target = OPTION_ENTRIES.find((e) => e.type === "INTERFACE" && !e.normal)!;
    const bad = Array.from({ length: 25 }, (_, i) => `option:no_such_${i}:yes`).join("\n");
    const { opts, msgs } = parse(`${bad}\noption:${target.name}:yes\n`);
    expect(msgs).toHaveLength(25);
    expect(opts[target.name]).toBe(true);
  });

  /* ---- what `strstr(buf, "option:")` does that a startsWith does not ---- */

  it("finds the directive anywhere on the line, so leading whitespace is fine", () => {
    /* Not a trim: the C never strips anything. It finds "option:" and then
     * requires that what came BEFORE it be spaces and tabs only. */
    const { opts, msgs } = parse(`  \t option:${NORMAL_FALSE.name}:yes`);
    expect(msgs).toEqual([]);
    expect(opts[NORMAL_FALSE.name]).toBe(true);
  });

  it("ignores the directive when it sits inside a comment, silently", () => {
    /* The reason the writer's own `# <description>` lines are safe: a
     * description is free text and could contain the word. No message, because
     * everything before the '#' is spaces. */
    const { opts, msgs } = parse(`# see option:${NORMAL_FALSE.name}:yes for details`);
    expect(msgs).toEqual([]);
    expect(opts[NORMAL_FALSE.name]).toBe(NORMAL_FALSE.normal);
  });

  it("complains when there is real text before the '#' that hid the directive", () => {
    expect(parse(`junk # option:${NORMAL_FALSE.name}:yes`).msgs).toEqual([NOT_PARSEABLE(1)]);
  });

  it("complains when there is real text before the directive and no comment", () => {
    const { opts, msgs } = parse(`junk option:${NORMAL_FALSE.name}:yes`);
    expect(msgs).toEqual([NOT_PARSEABLE(1)]);
    expect(opts[NORMAL_FALSE.name]).toBe(NORMAL_FALSE.normal);
  });

  it("calls a line with no directive at all unparseable, up to its '#'", () => {
    expect(parse("colour:red:1").msgs).toEqual([NOT_PARSEABLE(1)]);
    expect(parse("colour:red:1 # trailing comment").msgs).toEqual([NOT_PARSEABLE(1)]);
    /* ...and the same line with nothing but a comment on it is silent. */
    expect(parse("   # colour:red:1").msgs).toEqual([]);
  });

  it("treats a bare `option` with no colon as unparseable, not as a missing field", () => {
    /* There is no field machinery here to be missing: `strstr` simply does not
     * match, so the line falls into the comment-or-whitespace branch. */
    expect(parse("option").msgs).toEqual([NOT_PARSEABLE(1)]);
  });

  it("requires the colon straight after the name, so a name with no value is Unrecognized", () => {
    /* `sub[lname] == ':'` fails at end-of-string, so no option matches at all
     * and the loop runs off the end of the table. */
    expect(parse(`option:${NORMAL_TRUE.name}`).msgs).toEqual([UNRECOGNIZED(1)]);
  });

  it("does not collapse a run of colons the way strtok would", () => {
    /* The master parser tokenised with strtok, which treats "::" as one
     * separator and so accepted `option::name:yes`. This reader compares the
     * name against the text immediately after "option:", so the leading colon
     * is part of what has to match - and nothing does. */
    expect(parse(`option::${NORMAL_FALSE.name}:yes`).msgs).toEqual([UNRECOGNIZED(1)]);
  });

  it("requires the colon right after the name, so a longer name is not the shorter one", () => {
    /* The name test is a PREFIX compare plus `sub[lname] == ':'`, and the
     * colon is the whole disambiguation. Without it `show_damageX` would set
     * `show_damage`. */
    const { opts, msgs } = parse(`option:${NORMAL_FALSE.name}X:yes`);
    expect(msgs).toEqual([UNRECOGNIZED(1)]);
    expect(opts[NORMAL_FALSE.name]).toBe(NORMAL_FALSE.normal);
  });

  it("has no option name that prefixes another, which is why table ORDER cannot matter", () => {
    /* Recorded rather than assumed. The C takes the FIRST match walking the
     * table, so if 4.2.6 ever grew `pickup` beside `pickup_always` the order of
     * OPTION_ENTRIES would become load-bearing - and this test would say so
     * before a player found out by having the wrong option flipped. */
    const names = OPTION_ENTRIES.map((e) => e.name);
    const collisions = names.flatMap((a) =>
      names.filter((b) => b !== a && b.startsWith(a)).map((b) => `${a} <- ${b}`),
    );
    expect(collisions).toEqual([]);
  });

  it("gives the whole remainder to the value, colons included", () => {
    /* Everything after the name's colon is the value, so `::yes` is not `yes`
     * and `yes:extra` is not `yes`. */
    expect(parse(`option:${NORMAL_FALSE.name}::yes`).msgs).toEqual([BAD_VALUE(1)]);
    expect(parse(`option:${NORMAL_FALSE.name}:yes:extra`).msgs).toEqual([BAD_VALUE(1)]);
  });
});

describe("options_restore_custom (option.c:225-333)", () => {
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
     * early-return at :239 is the only path that resets. */
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
    /* msg(), verbatim - no path in it, because option.c's three format strings
     * name the PAGE and never the file. */
    expect(logged).toEqual([
      "Unrecognized option at line 1 of the customized interface options.",
    ]);
  });

  it("says nothing at all when the sink is omitted", () => {
    /* The sink is optional because options_init_defaults runs before there is
     * anywhere to print; the messages must not become a throw when it does. */
    const io = memHost(new Map([[customOptionsFileName("INTERFACE"), "garbage\n"]]));
    expect(optionsRestoreCustom(io, tableDefaults(), "INTERFACE")).toBe(true);
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

describe("options_init_defaults (option.c:148-164)", () => {
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
    /* The files carry booleans only, so this is a statement about ORDER: :159
     * and :162 run last and are unconditional. */
    const res = optionsInitDefaults(io);
    expect(res.delayFactor).toBe(DEFAULT_DELAY_FACTOR);
    expect(res.hitpointWarn).toBe(DEFAULT_HITPOINT_WARN);
  });

  it("survives an unreadable customised file rather than refusing to start", () => {
    /* The two restore calls' return values are discarded (:155-156). */
    const io = memHost(new Map(), {
      unreadable: new Set([customOptionsFileName("BIRTH")]),
    });
    expect(optionsInitDefaults(io).opts).toEqual(tableDefaults());
  });
});

describe("the three msg() lines, against the C rather than against a transcription", () => {
  /* Everything above this point compares the port to strings I typed out of
   * option.c, which is exactly the mistake that let the port ship MASTER's
   * parser under 4.2.6's name for months. So: read the C, recover its three
   * format strings, and substitute the arguments IN THE ORDER THE C PASSES
   * THEM. That last part is what the text census cannot do - it proves a
   * literal is present somewhere in the port, not that the port fills %d and
   * %s the right way round. */
  const SRC = readFileSync(
    new URL("../../../../reference/src/option.c", import.meta.url),
    "utf8",
  );
  /* Adjacent string literals are one string in C, and all three of these are
   * wrapped across source lines. */
  const JOINED = SRC.replace(/"[\t ]*\n[\t ]*"/gu, "");
  const formats = [
    ...JOINED.matchAll(/\bmsg\("([^"]*)",\s*linenum,\s*page_name\)/gu),
  ].map((m) => m[1]!);

  it("finds all five msg() calls in options_restore_custom, three distinct", () => {
    /* A fixture guard: if reference/ moves or the regex rots, every assertion
     * below would pass vacuously against an empty list. Five calls, because
     * "not parseable" is written out three times from three branches. */
    expect(formats).toHaveLength(5);
    expect(new Set(formats).size).toBe(3);
  });

  const fill = (fmt: string, n: number, page: string): string =>
    fmt.replace("%d", String(n)).replace("%s", page);

  it("emits the unparseable line exactly, with the line number and the page in the C's order", () => {
    const fmt = formats.find((f) => f.includes("not parseable"))!;
    const opts = tableDefaults();
    expect(parseCustomOptionsText("\n\ngarbage\n", opts, "BIRTH")).toEqual([
      fill(fmt, 3, "birth"),
    ]);
  });

  it("emits the unrecognized-option line exactly", () => {
    const fmt = formats.find((f) => f.startsWith("Unrecognized"))!;
    const opts = tableDefaults();
    expect(parseCustomOptionsText("option:no_such:yes\n", opts, "SCORE")).toEqual([
      fill(fmt, 1, "score"),
    ]);
  });

  it("emits the bad-value line exactly", () => {
    const fmt = formats.find((f) => f.startsWith("Value"))!;
    const target = OPTION_ENTRIES.find((e) => e.type === "CHEAT")!;
    const opts = tableDefaults();
    expect(
      parseCustomOptionsText(`# a header\noption:${target.name}:maybe\n`, opts, "CHEAT"),
    ).toEqual([fill(fmt, 2, "cheat")]);
  });
});
