/**
 * main.c's command line, ported.
 *
 * `main()` (reference/src/main.c:342-491) is not platform-specific code - it is
 * the shared entry point every front end without its own `main` uses, and its
 * option loop is the only place the `arg_*` globals are ever set:
 *
 *   arg_wizard      (ui-game.c:79)   -w
 *   arg_graphics    (ui-prefs.c)     -g
 *   arg_name        (ui-prefs.c:41)  -u<who>
 *   arg_force_name  (ui-birth.c:97)  -f
 *   ANGBAND_SYS     (init.c:84)      -m<sys>
 *
 * Those five reach thirteen call sites between them, and `-f` alone reaches
 * eight. The text census sees only ONE of them (ui-player.c:1250, "You are not
 * allowed to change your name!") because the rest are branches rather than
 * strings, so "add the message" would have been the wrong-shaped fix: what is
 * missing is the switch that makes any of it reachable.
 *
 * Parsing is pure. The three things upstream does at parse time that touch the
 * world - printing usage, listing savefiles, creating a `-d` directory - are
 * reported as OUTCOMES for the front end to carry out, because only the front
 * end has a console and a filesystem. Nothing here quits or writes.
 */

import { ALL_HOST_DIRS } from "./raw";
import type { HostDir } from "./io";

/** option.h:23. Upstream truncates -u<who> into a buffer of this size. */
export const PLAYER_NAME_LEN = 32;

/**
 * change_path_values (main.c:209-227), in upstream's order - which is the order
 * the usage text lists them in.
 *
 * `setgidOk` is carried even though this port has no setgid build, because the
 * flag is what decides whether a directory appears in the usage listing at all
 * on such a build, and dropping it would quietly delete that behaviour. The
 * three false entries are the ones a multi-user install must not let a player
 * redirect: scores, save and panic.
 */
export const CHANGE_PATH_VALUES: readonly {
  readonly name: string;
  readonly setgidOk: boolean;
}[] = [
  { name: "scores", setgidOk: false },
  { name: "gamedata", setgidOk: true },
  { name: "screens", setgidOk: true },
  { name: "help", setgidOk: true },
  { name: "pref", setgidOk: true },
  { name: "fonts", setgidOk: true },
  { name: "tiles", setgidOk: true },
  { name: "sounds", setgidOk: true },
  { name: "icons", setgidOk: true },
  { name: "user", setgidOk: true },
  { name: "save", setgidOk: false },
  { name: "panic", setgidOk: false },
  { name: "archive", setgidOk: true },
];

/** A display module, as `modules[]` (main.c:63-95) describes one. */
export interface LaunchModule {
  /** The name `-m` matches, and the value ANGBAND_SYS takes. */
  readonly name: string;
  /** The one-line help the usage text prints beside it. */
  readonly help: string;
}

/** The `arg_*` globals, gathered. */
export interface LaunchArgs {
  /** -c: play_game(GAME_SELECT). Overrides -n, per the usage text. */
  readonly selectGame: boolean;
  /** -n: play_game(GAME_NEW). */
  readonly newGame: boolean;
  /** -w: arg_wizard, passed to savefile_load (ui-game.c:733). */
  readonly wizard: boolean;
  /**
   * -g: arg_graphics. 0 is "not requested"; upstream's default when the switch
   * IS given is 2, which graphics.txt maps to Adam Bolt's tiles.
   */
  readonly graphics: number;
  /** -u<who>: arg_name, truncated to PLAYER_NAME_LEN. */
  readonly name: string;
  /** -f: arg_force_name. The eight-call-site one. */
  readonly forceName: boolean;
  /** -m<sys>: ANGBAND_SYS. Null leaves init.c's "xxx". */
  readonly module: string | null;
  /** -d<dir>=<path>, last one wins per directory. */
  readonly dirs: Readonly<Partial<Record<string, string>>>;
  /** Everything after `--`, which upstream hands to the module's init. */
  readonly subopts: readonly string[];
}

export const DEFAULT_LAUNCH_ARGS: LaunchArgs = {
  selectGame: false,
  newGame: false,
  wizard: false,
  graphics: 0,
  name: "",
  forceName: false,
  module: null,
  dirs: {},
  subopts: [],
};

/**
 * What the front end must do next. Upstream's three non-returning paths become
 * three outcomes rather than a `quit()` inside a parser.
 */
export type LaunchOutcome =
  /** Ordinary start. */
  | { readonly kind: "run"; readonly args: LaunchArgs }
  /** -l: print the savefile list, then exit(0). Args parsed so far are kept. */
  | { readonly kind: "list-saves"; readonly args: LaunchArgs }
  /** `goto usage`: print these lines, then quit(NULL). */
  | { readonly kind: "usage"; readonly lines: readonly string[] }
  /** quit_fmt(): print this and stop. */
  | { readonly kind: "quit"; readonly message: string };

export interface LaunchParseOptions {
  /** modules[], in the order they are tried. */
  readonly modules?: readonly LaunchModule[];
  /** Current directory defaults, printed in the usage text's -d listing. */
  readonly dirDefaults?: Readonly<Partial<Record<string, string>>>;
  /**
   * Is this a setgid build? Upstream's usage text hides the three non-setgid_ok
   * directories on one, and change_path refuses them outright.
   */
  readonly setgid?: boolean;
}

/**
 * atoi, for `-g`.
 *
 * DEAD BY CONSTRUCTION, and ported anyway. main.c:409-411 reads a numeric suffix
 * into arg_graphics - but the loop's trailing `if (*arg) goto usage;`
 * (main.c:491) then fires on that very suffix, so `-g2` prints the usage text
 * and quits and the parsed number can never be observed. Only a bare `-g`
 * survives, leaving the hard-coded 2. That is upstream's behaviour, warts
 * included, so it is what this reproduces - and the tests assert the usage path
 * rather than the number, which is the part a player can actually reach. It is
 * kept visible instead of dropped so the wart is not mistaken for a port bug
 * later.
 */
function atoi(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?[0-9]+)/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : 0;
}

/** my_strcpy into a buffer of `len`: copy, truncating to len-1 characters. */
function strncpy(s: string, len: number): string {
  return s.length < len ? s : s.slice(0, len - 1);
}

/** The usage text (main.c:461-489), verbatim, with the two runtime listings. */
export function launchUsage(opts: LaunchParseOptions = {}): readonly string[] {
  const lines: string[] = [
    "Usage: angband [options] [-- subopts]",
    "  -c             Select savefile with a menu; overrides -n",
    "  -n             Start a new character (WARNING: overwrites default savefile without -u)",
    "  -l             Lists all savefiles you can play",
    "  -w             Resurrect dead character (marks savefile)",
    "  -g             Request graphics mode",
    "  -u<who>        Use your <who> savefile",
    "  -d<dir>=<path> Override a specific directory with <path>. <path> can be:",
  ];
  for (const v of CHANGE_PATH_VALUES) {
    if (opts.setgid === true && !v.setgidOk) continue;
    lines.push(`    ${v.name} (default is ${opts.dirDefaults?.[v.name] ?? ""})`);
  }
  lines.push("                 Multiple -d options are allowed.");
  /* No `-s`: upstream's sound switch is inside #ifdef SOUND and this port has no
   * sound module, so the switch is absent for the same reason it is absent from
   * a --disable-sound build - not as an omission. */
  lines.push("  -m<sys>        Use module <sys>, where <sys> can be:");
  for (const m of opts.modules ?? []) lines.push(`     ${m.name}   ${m.help}`);
  return lines;
}

/**
 * main.c's option loop (main.c:380-491).
 *
 * `argv` is upstream's argv MINUS the program name, which is what HostIo.argv()
 * reports - so the loop starts at 0 here where upstream starts at 1.
 */
export function parseLaunchArgs(
  argv: readonly string[],
  opts: LaunchParseOptions = {},
): LaunchOutcome {
  let selectGame = false;
  let newGame = false;
  let wizard = false;
  let graphics = 0;
  let name = "";
  let forceName = false;
  let module: string | null = null;
  const dirs: Partial<Record<string, string>> = {};
  let subopts: readonly string[] = [];
  let args = true;

  const usage = (): LaunchOutcome => ({ kind: "usage", lines: launchUsage(opts) });
  const gathered = (): LaunchArgs => ({
    selectGame,
    newGame,
    wizard,
    graphics,
    name,
    forceName,
    module,
    dirs,
    subopts,
  });

  for (let i = 0; args && i < argv.length; i++) {
    const whole = argv[i] ?? "";
    /* `if (*arg++ != '-') goto usage;` - an argument not starting with a dash,
     * including an empty one, is a usage error rather than a positional. */
    if (whole[0] !== "-") return usage();
    /* `switch (*arg++)`: the switch letter, then whatever follows it. */
    const letter = whole[1] ?? "";
    const rest = whole.slice(2);

    switch (letter) {
      case "c":
        selectGame = true;
        break;

      case "l":
        /* list_saves(); exit(0) - immediately, so later switches are never
         * examined, and an earlier -u has already been applied. */
        return { kind: "list-saves", args: gathered() };

      case "n":
        newGame = true;
        break;

      case "w":
        wizard = true;
        break;

      case "g":
        graphics = 2;
        if (rest !== "") graphics = atoi(rest);
        break;

      case "u": {
        if (rest === "") return usage();
        name = strncpy(rest, PLAYER_NAME_LEN);
        /* `continue`: the trailing *arg check is skipped, which is how a suffix
         * is allowed here and not on -w. The savefile itself is set by the
         * caller, since that needs the save directory. */
        continue;
      }

      case "f":
        forceName = true;
        break;

      case "m":
        if (rest === "") return usage();
        module = rest;
        continue;

      case "d": {
        /* change_path (main.c:236-271). */
        if (rest === "") return { kind: "quit", message: "Try '-d<dir>=<path>'." };
        /* strtok on "=": the name is up to the first '=', the path is the next
         * token - so a second '=' and anything after it is dropped, and a
         * missing '=' leaves the path undefined (strtok returns NULL, and
         * string_make(NULL) yields an empty directory). */
        const eq = rest.indexOf("=");
        const dirName = eq < 0 ? rest : rest.slice(0, eq);
        const dirPath = eq < 0 ? "" : rest.slice(eq + 1).split("=")[0] ?? "";
        /* my_stricmp: the match is case-insensitive. */
        const entry = CHANGE_PATH_VALUES.find(
          (v) => v.name.toLowerCase() === dirName.toLowerCase(),
        );
        if (!entry) {
          return { kind: "quit", message: `Unrecognised -d parameter ${dirName}` };
        }
        if (opts.setgid === true && !entry.setgidOk) {
          return {
            kind: "quit",
            message: `Can't redefine path to ${dirName} dir on multiuser setup`,
          };
        }
        dirs[entry.name] = dirPath;
        continue;
      }

      case "-":
        /* The `--` terminator: the rest of the command line belongs to the
         * module's init, and the loop stops. */
        subopts = argv.slice(i + 1);
        args = false;
        break;

      default:
        return usage();
    }

    /* `if (*arg) goto usage;` (main.c:491). This is what makes `-g2` a usage
     * error, and `--x` too. */
    if (rest !== "") return usage();
  }

  /* `if (args) { argc = 1; argv[1] = NULL; }`: without an explicit `--`, nothing
   * is passed on to the module. */
  if (args) subopts = [];

  return { kind: "run", args: gathered() };
}

/**
 * The `-d` names, as the five host directories this port actually has.
 *
 * Upstream has thirteen directories; five of them are writable and modelled by
 * HostDir, and the other eight are read-only game data that this port compiles
 * in rather than reading from disk. A `-d gamedata=...` is therefore accepted
 * and parsed - the switch exists and reports honestly - but only these five can
 * be acted on, and `hostDirOverrides` is what a front end applies.
 */
export function hostDirOverrides(
  args: LaunchArgs,
): Readonly<Partial<Record<HostDir, string>>> {
  const out: Partial<Record<HostDir, string>> = {};
  for (const d of ALL_HOST_DIRS) {
    const v = args.dirs[d];
    if (typeof v === "string") out[d] = v;
  }
  return out;
}
