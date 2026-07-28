/**
 * main.c's option loop, against the C.
 *
 * Every assertion here cites the line it comes from, because this file is where
 * the port decides what `-f` and friends MEAN - and the loop has two behaviours
 * that look like bugs and are not (`-g2` is a usage error; a switch's trailing
 * text is rejected for some letters and allowed for others). A future reader who
 * assumes those are port defects and "fixes" them breaks parity, so they are
 * asserted deliberately rather than left to be discovered.
 */

import { describe, expect, it } from "vitest";
import {
  CHANGE_PATH_VALUES,
  DEFAULT_LAUNCH_ARGS,
  PLAYER_NAME_LEN,
  hostDirOverrides,
  launchUsage,
  parseLaunchArgs,
} from "./args";
import type { LaunchArgs } from "./args";

/** The parsed args, or a failure the test did not expect. */
function run(argv: readonly string[]): LaunchArgs {
  const r = parseLaunchArgs(argv);
  if (r.kind !== "run") throw new Error(`expected run, got ${r.kind}`);
  return r.args;
}

const MODULES = [{ name: "web", help: "Canvas terminal" }];

describe("parseLaunchArgs: the plain switches", () => {
  it("takes no arguments as a plain start", () => {
    expect(run([])).toEqual(DEFAULT_LAUNCH_ARGS);
  });

  it("sets select_game for -c and new_game for -n (main.c:390,396)", () => {
    expect(run(["-c"]).selectGame).toBe(true);
    expect(run(["-n"]).newGame).toBe(true);
    /* Both are recorded; "overrides -n" is the caller's business - upstream
     * resolves it at the play_game call (main.c:581), not while parsing. */
    const both = run(["-n", "-c"]);
    expect(both.newGame).toBe(true);
    expect(both.selectGame).toBe(true);
  });

  it("sets arg_wizard for -w (main.c:403)", () => {
    expect(run(["-w"]).wizard).toBe(true);
  });

  it("sets arg_force_name for -f (main.c:436)", () => {
    expect(run(["-f"]).forceName).toBe(true);
    expect(run([]).forceName).toBe(false);
  });

  it("takes several switches in one command line", () => {
    const a = run(["-w", "-f", "-n"]);
    expect([a.wizard, a.forceName, a.newGame]).toEqual([true, true, true]);
  });
});

describe("parseLaunchArgs: -u<who> (main.c:414-431)", () => {
  it("sets arg_name", () => {
    expect(run(["-uBilbo"]).name).toBe("Bilbo");
  });

  it("requires a name", () => {
    /* `if (!*arg) goto usage;` (main.c:415). */
    expect(parseLaunchArgs(["-u"]).kind).toBe("usage");
  });

  it("truncates to PLAYER_NAME_LEN, like my_strcpy into arg_name", () => {
    const long = "x".repeat(PLAYER_NAME_LEN + 10);
    expect(run([`-u${long}`]).name).toHaveLength(PLAYER_NAME_LEN - 1);
  });

  it("accepts a name with characters the other switches would reject", () => {
    /* -u `continue`s past the trailing-text check, which is the whole reason a
     * suffix is legal here and not on -w. */
    expect(run(["-uSam Gamgee-2"]).name).toBe("Sam Gamgee-2");
  });
});

describe("parseLaunchArgs: -g, and why a number never reaches it", () => {
  it("requests graphics mode 2 for a bare -g (main.c:409)", () => {
    /* 2 is Adam Bolt's tiles in graphics.txt, per the comment at main.c:408. */
    expect(run(["-g"]).graphics).toBe(2);
    expect(run([]).graphics).toBe(0);
  });

  it("treats -g2 as a USAGE ERROR, not as mode 2", () => {
    /* Upstream reads the suffix into arg_graphics (main.c:410) and then the
     * loop's trailing `if (*arg) goto usage;` (main.c:491) fires on that same
     * suffix. So the numeric form of this switch is unreachable in the C. This
     * is deliberately asserted: it looks like a port bug and is not. */
    expect(parseLaunchArgs(["-g2"]).kind).toBe("usage");
    expect(parseLaunchArgs(["-g0"]).kind).toBe("usage");
    expect(parseLaunchArgs(["-gnonsense"]).kind).toBe("usage");
  });
});

describe("parseLaunchArgs: -m<sys> (main.c:439-442)", () => {
  it("sets the module, which becomes ANGBAND_SYS (main.c:536)", () => {
    expect(run(["-mweb"]).module).toBe("web");
    expect(run([]).module).toBeNull();
  });

  it("requires a name", () => {
    expect(parseLaunchArgs(["-m"]).kind).toBe("usage");
  });

  it("does not validate the name against the module list", () => {
    /* Upstream compares it inside the module loop (main.c:534) and quits with
     * "Unable to prepare any 'display module'!" if nothing matched - so an
     * unknown name is not a parse error. */
    expect(run(["-mnosuch"], ).module).toBe("nosuch");
  });
});

describe("parseLaunchArgs: -d<dir>=<path> (change_path, main.c:236-271)", () => {
  it("records a recognised directory", () => {
    expect(run(["-duser=/tmp/u"]).dirs).toEqual({ user: "/tmp/u" });
  });

  it("matches the name case-insensitively (my_stricmp)", () => {
    expect(run(["-dUSER=/tmp/u"]).dirs).toEqual({ user: "/tmp/u" });
    expect(run(["-dGameData=/g"]).dirs).toEqual({ gamedata: "/g" });
  });

  it("accepts every name in change_path_values", () => {
    for (const v of CHANGE_PATH_VALUES) {
      expect(run([`-d${v.name}=/p`]).dirs).toEqual({ [v.name]: "/p" });
    }
  });

  it("allows more than one, last wins per directory", () => {
    /* "Multiple -d options are allowed." (main.c:475). Upstream frees the old
     * string and stores the new one, so a repeat is last-wins. */
    expect(run(["-duser=/a", "-dsave=/b", "-duser=/c"]).dirs).toEqual({
      user: "/c",
      save: "/b",
    });
  });

  it("quits with upstream's message when the switch is bare", () => {
    expect(parseLaunchArgs(["-d"])).toEqual({
      kind: "quit",
      message: "Try '-d<dir>=<path>'.",
    });
  });

  it("quits naming an unrecognised directory", () => {
    expect(parseLaunchArgs(["-dnosuch=/p"])).toEqual({
      kind: "quit",
      message: "Unrecognised -d parameter nosuch",
    });
  });

  it("stops at the second '=', the way strtok does", () => {
    expect(run(["-duser=/a=/b"]).dirs).toEqual({ user: "/a" });
  });

  it("refuses a protected directory on a setgid build", () => {
    /* main.c:253-257. scores/save/panic are the three with setgid_ok false. */
    expect(parseLaunchArgs(["-dsave=/p"], { setgid: true })).toEqual({
      kind: "quit",
      message: "Can't redefine path to save dir on multiuser setup",
    });
    expect(parseLaunchArgs(["-duser=/p"], { setgid: true }).kind).toBe("run");
  });
});

describe("parseLaunchArgs: -l (main.c:393)", () => {
  it("reports list-saves and stops there", () => {
    const r = parseLaunchArgs(["-l"]);
    expect(r.kind).toBe("list-saves");
  });

  it("never examines what follows, because upstream exits immediately", () => {
    /* list_saves(); exit(0) - so -w after -l is not seen at all. */
    const r = parseLaunchArgs(["-l", "-w"]);
    if (r.kind !== "list-saves") throw new Error("expected list-saves");
    expect(r.args.wizard).toBe(false);
  });

  it("keeps a -u that came first", () => {
    const r = parseLaunchArgs(["-uBilbo", "-l"]);
    if (r.kind !== "list-saves") throw new Error("expected list-saves");
    expect(r.args.name).toBe("Bilbo");
  });
});

describe("parseLaunchArgs: the -- terminator (main.c:451-457, 493-496)", () => {
  it("passes everything after it through as subopts", () => {
    expect(run(["-w", "--", "-x", "whatever"])).toMatchObject({
      wizard: true,
      subopts: ["-x", "whatever"],
    });
  });

  it("stops parsing, so a switch after it is not a switch", () => {
    /* -qqq would otherwise be a usage error. */
    expect(run(["--", "-qqq"]).subopts).toEqual(["-qqq"]);
  });

  it("drops trailing arguments when there was no --", () => {
    /* `if (args) { argc = 1; argv[1] = NULL; }` - the module gets nothing. */
    expect(run(["-w"]).subopts).toEqual([]);
  });

  it("rejects text stuck to the terminator", () => {
    /* "--x": the trailing-text check still applies. */
    expect(parseLaunchArgs(["--x"]).kind).toBe("usage");
  });
});

describe("parseLaunchArgs: usage", () => {
  it("rejects an unknown switch", () => {
    expect(parseLaunchArgs(["-q"]).kind).toBe("usage");
  });

  it("rejects anything not starting with a dash", () => {
    /* `if (*arg++ != '-') goto usage;` - there are no positional arguments. */
    expect(parseLaunchArgs(["Bilbo"]).kind).toBe("usage");
    expect(parseLaunchArgs(["-w", "Bilbo"]).kind).toBe("usage");
  });

  it("rejects an empty argument and a bare dash", () => {
    expect(parseLaunchArgs([""]).kind).toBe("usage");
    expect(parseLaunchArgs(["-"]).kind).toBe("usage");
  });

  it("rejects trailing text on a switch that does not take any", () => {
    for (const bad of ["-wx", "-cx", "-nx", "-fx"]) {
      expect(parseLaunchArgs([bad]).kind).toBe("usage");
    }
  });

  it("prints upstream's first line and every switch", () => {
    const lines = launchUsage({ modules: MODULES });
    expect(lines[0]).toBe("Usage: angband [options] [-- subopts]");
    for (const sw of ["-c", "-n", "-l", "-w", "-g", "-u<who>", "-d<dir>=<path>", "-m<sys>"]) {
      expect(lines.some((l) => l.includes(sw))).toBe(true);
    }
    expect(lines).toContain("                 Multiple -d options are allowed.");
    expect(lines.some((l) => l.includes("web") && l.includes("Canvas terminal"))).toBe(
      true,
    );
  });

  it("lists every -d directory with its current default", () => {
    const lines = launchUsage({ dirDefaults: { user: "/home/x/user" } });
    for (const v of CHANGE_PATH_VALUES) {
      expect(lines.some((l) => l.trim().startsWith(`${v.name} (default is`))).toBe(true);
    }
    expect(lines).toContain("    user (default is /home/x/user)");
  });

  it("hides the protected directories on a setgid build", () => {
    const lines = launchUsage({ setgid: true }).join("\n");
    expect(lines).not.toMatch(/^\s+save \(default/m);
    expect(lines).not.toMatch(/^\s+panic \(default/m);
    expect(lines).not.toMatch(/^\s+scores \(default/m);
    expect(lines).toMatch(/^\s+user \(default/m);
  });

  it("offers no -s, because this build has no sound module", () => {
    /* Upstream's sound switch is inside #ifdef SOUND. Absent for the same
     * reason it is absent from a --disable-sound build, and the usage text must
     * not advertise a switch that would then be a usage error. */
    expect(launchUsage().some((l) => l.includes("-s<"))).toBe(false);
    expect(parseLaunchArgs(["-swav"]).kind).toBe("usage");
  });

  it("reports the usage error rather than the switches parsed before it", () => {
    /* A usage error is fatal in the C (it quits), so partial args must not leak
     * out as if the launch were going ahead. */
    const r = parseLaunchArgs(["-w", "-q"]);
    expect(r.kind).toBe("usage");
    expect("args" in r).toBe(false);
  });
});

describe("hostDirOverrides", () => {
  it("keeps only the five directories this port has", () => {
    const args = run([
      "-duser=/u",
      "-dsave=/s",
      "-dpanic=/p",
      "-dscores=/sc",
      "-darchive=/a",
      "-dgamedata=/g",
      "-dfonts=/f",
    ]);
    expect(hostDirOverrides(args)).toEqual({
      user: "/u",
      save: "/s",
      panic: "/p",
      scores: "/sc",
      archive: "/a",
    });
  });

  it("is empty when no -d was given", () => {
    expect(hostDirOverrides(run([]))).toEqual({});
  });

  it("still PARSES the read-only directories, so the switch is honest", () => {
    /* Upstream accepts -dgamedata; this port compiles its game data in, so the
     * override cannot be acted on. Recording it in `dirs` and dropping it here
     * keeps the difference visible instead of turning it into a usage error. */
    expect(run(["-dgamedata=/g"]).dirs).toEqual({ gamedata: "/g" });
  });
});
