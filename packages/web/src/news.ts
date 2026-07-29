/**
 * The title / news screen (reference/lib/screens/news.txt), shown at boot before
 * any game interaction. This is the faithful equivalent of the GUI ports
 * displaying news.txt and then waiting on "[Choose 'New' or 'Open' from the
 * 'File' menu]" (main-win.c:5475, main-cocoa.m:5886): the game does not
 * auto-start into the dungeon - the player sees the title first and presses a
 * key to begin.
 *
 * The art below is reproduced verbatim from reference/lib/screens/news.txt (the
 * upstream 4.2.6 file); do not edit it here - regenerate from that file. Each
 * line uses the loader's {colour}...{/} markup, drawn run by run; bare text
 * outside any tag is COLOUR_WHITE, matching the file loader's default.
 */

import type { GlyphTerm } from "./term";
import {
  colorTextToAttr,
  colorToCss,
  COLOUR_WHITE,
  ENGINE_VERSION,
} from "@neo-angband/core";
import { UI_DIM } from "./ui-colors";

/**
 * The Angband baseline this port reproduces, substituted for the file's
 * $VERSION token exactly as the upstream title screen shows it. (The port's own
 * version is reported by the 'V' command, do_cmd_version.)
 */
const BASELINE_VERSION = "4.2.6";

/** news.txt verbatim (reference/lib/screens/news.txt); $VERSION is filled in. */
const NEWS: readonly string[] = [
  "",
  "{mud}                                       ^                        {/}",
  "{mud}                                      ^^^                       {/}",
  "{mud}                ^                    ^^^^^                   ^  {/}",
  "{mud}               ^^^                  ^^^^^^^                 ^^^ {/}",
  "{mud}              ^^^^^                ^^^^^^^^^               ^^^^^{/}",
  "{mud}             ^^^^  {/}{red}_{/}{mud}              ^ {/}{red}_{/}{mud}  ^^^^^^             {/}{red}_{/}{mud}  ^^^^{/}",
  "{mud}            ^^^^ {/}{red} / \\   _ __   __ _| |__   __ _ _ __   __| | {/}{mud}^^^^^   {/}",
  "{mud}           ^^^^ {/}{red} / _ \\ | '_ \\ / _` | '_ \\ / _` | '_ \\ / _` | {/}{mud}^^^^^^  {/}",
  "{mud}          ^^^^  {/}{red}/ ___ \\| | | | (_| | |_) | (_| | | | | (_| | {/}{mud}^^^^^^^ {/}",
  "{mud}         ^^^^  {/}{red}/_/   \\_\\_| |_|\\__, |_.__/ \\__,_|_| |_|\\__,_| {/}{mud}^^^^^^^^{/}",
  "{mud}        ^^^^^                {/}{red} |___/{/}  $VERSION",
  "{mud}       ^^^^^^^^^^^^^^^^^^                     ^^^^  ^^^^^^^^^^^^^^^^^^^ {/}",
  "{light slate}         \"When the world is old and the Powers grow weary, then Morgoth,{/}",
  "{light slate}          seeing that the guard sleepeth, shall come back through the   {/}",
  "{light slate}          Door of Night out of the Timeless Void.  Then shall the Last  {/}",
  "{light slate}          Battle be gathered...\"                                        {/}",
  "",
  "{light slate}                         Website: http://rephial.org/           {/}",
  "{light slate}                     Forums: https://angband.live/forums/       {/}",
  "              ",
  "                           For help press '?' in-game",
];

/**
 * "Neo" in the same figlet family as news.txt's "Angband", drawn OVER the art
 * rather than edited into NEWS above - the array stays a verbatim copy of
 * reference/lib/screens/news.txt, so a diff against that file still passes.
 *
 * Placement is measured, not guessed: the art's own letters start at column 18
 * (rows 6-11), and rows 1-4 are clear sky between column 19 and column 34 (the
 * left ridge tops out at column 17 on row 4, the centre peak starts at 36). So
 * this block sits directly above the "A" and touches no mountain.
 */
const NEO_ART: readonly string[] = [
  " _  _           ",
  "| \\| | ___  ___ ",
  "| .` |/ -_)/ _ \\",
  "|_|\\_|\\___|\\___/",
];
/** Top row and left column of NEO_ART on the title grid (see NEO_ART). */
const NEO_ROW = 1;
const NEO_COL = 19;
/** news.txt colours the "Angband" letters red; "Neo" joins them. */
const NEO_COLOUR = "red";

/**
 * The port's own credit line, below the upstream art. Deliberately separate
 * from the art itself: the art is Angband's, this line is not.
 */
const ATTRIBUTION = `Neo Angband ${ENGINE_VERSION} - a port by neostryder / RPGM Tools`;

/**
 * What the player chose at the title screen. These are main-win.c's File menu
 * items (win/angband.rc:8-13, handled at main-win.c:3501-3568) - the only place
 * upstream defines what a splash screen can do, because the splash itself takes
 * no keys at all: it paints news.txt and waits on the window's File menu
 * ("[Choose 'New' or 'Open' from the 'File' menu]", main-win.c:5475).
 *
 * "load" is the one addition, and it is the port's, not upstream's: IDM_FILE_OPEN
 * raises a file dialog over ANGBAND_DIR_SAVE, and there is no most-recent
 * shortcut to port. It exists because the port's own previous behaviour - any key
 * resumes the most recent character - was worth keeping as a named row rather
 * than as the meaning of every key on the keyboard.
 */
export type TitleChoice = "new" | "open" | "load" | "quit";

/** Which title rows are live, mirroring main-win.c's EnableMenuItem calls. */
export interface TitleOptions {
  /** A living character can be resumed. */
  canLoad: boolean;
  /** Some character is saved, so there is something to open. */
  canOpen: boolean;
  /**
   * The host can actually exit. IDM_FILE_EXIT is enabled whenever no game is in
   * progress (main-win.c:2987), which at the splash is always - but a browser
   * tab has nothing to exit to, so the row greys out there instead of lying.
   */
  canQuit: boolean;
}

/** One title row: its key, its label, and whether it is enabled. */
interface TitleRow {
  choice: TitleChoice;
  key: string;
  label: string;
  enabled: boolean;
}

/**
 * The rows in main-win.c's File menu order: New, Open, [Save], Exit. "Load last
 * save" takes the Save slot, which is greyed at the splash upstream
 * (main-win.c:2962 disables IDM_FILE_SAVE and only :2982 re-enables it in a
 * running game).
 */
export function titleRows(opts: TitleOptions): TitleRow[] {
  return [
    { choice: "new", key: "n", label: "(N)ew game", enabled: true },
    { choice: "open", key: "o", label: "(O)pen a save", enabled: opts.canOpen },
    { choice: "load", key: "l", label: "(L)oad last save", enabled: opts.canLoad },
    { choice: "quit", key: "q", label: "(Q)uit", enabled: opts.canQuit },
  ];
}

/**
 * main-win.c's File accelerators (main-win.c:4453-4455): Ctrl-N is New, Ctrl-O
 * is Open, Ctrl-X is Exit. They work at the splash upstream, so they work here.
 * Ctrl-S has no accelerator upstream, so "load" has no control-key form.
 */
const ACCELERATORS: Readonly<Record<string, TitleChoice>> = {
  n: "new",
  o: "open",
  x: "quit",
};

/**
 * Resolve a keydown to a choice, or null to ignore the key. Modifier-only
 * presses (Shift, Control, Alt, Meta, CapsLock and friends) resolve to null:
 * KeyboardEvent.key for those is the modifier's own name, never a single
 * character, and the old screen advanced on any of them.
 */
export function titleKeyChoice(
  key: string,
  rows: readonly TitleRow[],
  ctrl: boolean,
): TitleChoice | null {
  if (key.length !== 1) return null;
  const k = key.toLowerCase();
  const wanted = ctrl ? ACCELERATORS[k] : rows.find((r) => r.key === k)?.choice;
  if (!wanted) return null;
  /* A greyed row does nothing, as a greyed menu item does nothing. */
  return rows.find((r) => r.choice === wanted && r.enabled)?.choice ?? null;
}

/** A coloured span within a title line. */
interface Run {
  text: string;
  css: string;
}

/**
 * Parse one {colour}...{/} markup line into coloured runs. `{/}` resets to the
 * default (COLOUR_WHITE); a `{name}` opens that colour (colorTextToAttr resolves
 * the name, e.g. "mud", "red", "light slate"). Text outside any tag is white.
 * Spaces are preserved so the file's baked-in centring survives.
 */
export function parseNewsLine(line: string): Run[] {
  const white = colorToCss(COLOUR_WHITE);
  const runs: Run[] = [];
  const re = /\{([^}]*)\}/g;
  let last = 0;
  let cur = white;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const before = line.slice(last, m.index);
    if (before) runs.push({ text: before, css: cur });
    const tag = m[1] ?? "";
    cur = tag === "/" ? white : colorToCss(colorTextToAttr(tag));
    last = re.lastIndex;
  }
  const tail = line.slice(last);
  if (tail) runs.push({ text: tail, css: cur });
  return runs;
}

/** The gap between rows on the single prompt line. */
const ROW_GAP = "   ";

/**
 * Lay the rows out along one line and report where each one's text sits, so a
 * tap can be matched to the row it landed on. Upstream's splash prompt is a
 * single line at (Term->hgt - 23) / 5 + 23 (main-win.c:5476) - row 23 on an
 * 80x24 term - so this is one line too, not a framed menu box over the art.
 */
export function titleRowSpans(
  rows: readonly TitleRow[],
  cols: number,
): { row: TitleRow; start: number; end: number }[] {
  const width = rows.reduce((n, r) => n + r.label.length, 0) + ROW_GAP.length * (rows.length - 1);
  let x = Math.max(0, Math.floor((cols - width) / 2));
  const out: { row: TitleRow; start: number; end: number }[] = [];
  for (const row of rows) {
    out.push({ row, start: x, end: x + row.label.length - 1 });
    x += row.label.length + ROW_GAP.length;
  }
  return out;
}

/**
 * Paint the title screen and resolve with the player's choice.
 *
 * Three things changed from the "press any key to begin" version this replaces,
 * all of them because upstream's splash takes NO keys: it paints news.txt and
 * waits on the window's File menu (main-win.c:5475). Since the port has to
 * invent a keyboard route to that menu, it invents the menu's own keys rather
 * than "any key" - so a bare Shift no longer starts a game; a click no longer
 * starts a game (nothing in main-win starts one from a click in the client
 * area); and the rows a player cannot use are greyed rather than absent, the way
 * EnableMenuItem greys them (main-win.c:2957-2990).
 *
 * A tap ON a row still works: clicking a File menu item IS how upstream starts a
 * game. A tap anywhere else does nothing.
 */
export function showTitleScreen(
  term: GlyphTerm,
  opts: TitleOptions,
): Promise<TitleChoice> {
  return new Promise<TitleChoice>((resolve) => {
    const rows = titleRows(opts);
    let spans: { row: TitleRow; start: number; end: number }[] = [];
    let promptRow = 0;
    const paint = (): void => {
      const { cols, rows: height } = term.size();
      term.clear();
      for (let y = 0; y < NEWS.length && y < height; y++) {
        const raw = (NEWS[y] ?? "").replace("$VERSION", BASELINE_VERSION);
        let x = 0;
        for (const run of parseNewsLine(raw)) {
          if (x >= cols) break;
          const chunk = run.text.slice(0, cols - x);
          term.print(x, y, chunk, run.css);
          x += chunk.length;
        }
      }
      /* "Neo", over the art (see NEO_ART). */
      const neoCss = colorToCss(colorTextToAttr(NEO_COLOUR));
      for (let i = 0; i < NEO_ART.length; i++) {
        const y = NEO_ROW + i;
        if (y >= height) break;
        term.print(NEO_COL, y, (NEO_ART[i] ?? "").slice(0, Math.max(0, cols - NEO_COL)), neoCss);
      }
      /* The credit line, then the prompt line on upstream's own row. */
      promptRow = Math.min(height - 1, 23);
      const creditRow = promptRow - 1;
      if (creditRow > NEWS.length - 1) {
        const cx = Math.max(0, Math.floor((cols - ATTRIBUTION.length) / 2));
        term.print(cx, creditRow, ATTRIBUTION.slice(0, cols), UI_DIM);
      }
      spans = titleRowSpans(rows, cols);
      const white = colorToCss(COLOUR_WHITE);
      for (const span of spans) {
        if (span.start >= cols) break;
        term.print(
          span.start,
          promptRow,
          span.row.label.slice(0, cols - span.start),
          span.row.enabled ? white : UI_DIM,
        );
      }
    };
    const finish = (choice: TitleChoice): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap(null);
      resolve(choice);
    };
    const onKey = (ev: KeyboardEvent): void => {
      const choice = titleKeyChoice(ev.key, rows, ev.ctrlKey || ev.metaKey);
      /* An unrecognised key is swallowed, not passed through: the screen under
       * this one is not ready for input yet. */
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (choice) finish(choice);
    };
    window.addEventListener("keydown", onKey, true);
    term.onCellTap((cell) => {
      if (cell.row !== promptRow) return;
      const hit = spans.find((s) => cell.col >= s.start && cell.col <= s.end);
      if (hit?.row.enabled) finish(hit.row.choice);
    });
    paint();
  });
}
