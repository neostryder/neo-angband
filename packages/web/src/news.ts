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
 * The Angband baseline this port reproduces.
 *
 * This no longer fills news.txt's `$VERSION` slot. The slot sits beside art that
 * now reads "Neo Angband", so stamping Angband's release number there told the
 * player the wrong thing about what they were running - and the port's version is
 * the one that changes, so it is the one worth showing. ENGINE_VERSION takes the
 * slot; Angband's number moves to ANGBAND_CREDIT, in the grey block at the foot
 * of the screen where the project's own links already are.
 *
 * The substitution stays a substitution either way: NEWS below is still a
 * verbatim copy of reference/lib/screens/news.txt, token included.
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
 * "Neo", drawn OVER news.txt's art rather than edited into NEWS above - the array
 * stays a verbatim copy of reference/lib/screens/news.txt, so a diff against that
 * file still passes.
 *
 * FONT. This must be figlet **standard**, because that is the font news.txt's own
 * "Angband" is set in: its capital A occupies FIVE rows (NEWS rows 6-10, the '_'
 * row through the '/_/   \_\' baseline). The first version of this block was
 * figlet **small**, whose capitals are four rows, so "Neo" sat a row short beside
 * a five-row "Angband" and the letters read as squashed - two figlet families
 * side by side. Generated authoritatively rather than hand-drawn:
 *
 *     npx -y figlet-cli -f standard "Neo"
 *
 * then ONE leading space stripped from every row and trailing spaces trimmed, so
 * the block paints no blanks over the mountains to its right.
 *
 * PLACEMENT is measured, not guessed. Stripping the {colour} markup (the same
 * rule parseNewsLine applies - a tag occupies no columns, so a naive index into
 * the raw literal is wrong) and scanning for '^' gives the mountain columns:
 *
 *     row 0: (none)                 row 3: 16, 37-41, 61
 *     row 1: 39                     row 4: 15-17, 36-42, 60-62
 *     row 2: 38-40                  row 5: 14-18, 35-43, 59-63
 *
 * The art rows are 6, 16, 17, 18 and 17 columns wide, and the sky gap NARROWS
 * going down, so at NEO_COL = 19:
 *
 *     art row 0 (w 6)  -> NEWS row 0, cols 19-24  - the blank line, free
 *     art row 1 (w 16) -> NEWS row 1, cols 19-34  - next caret at 39
 *     art row 2 (w 17) -> NEWS row 2, cols 19-35  - next caret at 38
 *     art row 3 (w 18) -> NEWS row 3, cols 19-36  - next caret at 37  <- ONE column
 *     art row 4 (w 17) -> NEWS row 4, cols 19-35  - next caret at 36  <- ONE column
 *
 * The last two clear the centre peak by EXACTLY ONE COLUMN: one more character of
 * art on either row, or NEO_COL one higher, and it paints over the mountain. That
 * is the fact a future edit will break silently, so news.test.ts asserts it.
 * NEO_ROW = 1 is NOT free - it slides both of those rows down into the wider part
 * of the peak and collides at columns 36 and 35 - which is why the row moved from
 * 1 to 0 when the art grew from four rows to five. It also puts "Neo"'s five rows
 * (0-4) at the same cap height as "Angband"'s five (6-10), which is what the
 * squashed look was really about.
 */
const NEO_ART: readonly string[] = [
  " _   _",
  "| \\ | | ___  ___",
  "|  \\| |/ _ \\/ _ \\",
  "| |\\  |  __/ (_) |",
  "|_| \\_|\\___|\\___/",
];
/** Top row and left column of NEO_ART on the title grid (see NEO_ART). */
const NEO_ROW = 0;
const NEO_COL = 19;
/** news.txt colours the "Angband" letters red; "Neo" joins them. */
const NEO_COLOUR = "red";

/**
 * news.txt's last mountain row: the long ground ridge that closes the scene.
 * The port's credit is inserted directly BELOW it, which pushes everything from
 * the Morgoth quote down one row.
 */
const GROUND_ROW = 12;

/**
 * news.txt's near-blank spacer (fourteen spaces) between the Forums link and the
 * help line. Angband's credit takes it over rather than being inserted, so the
 * screen gains exactly ONE row overall and still ends above the prompt on a
 * 24-row terminal - see titleLines.
 */
const SPACER_ROW = 20;

/**
 * The port's own credit, painted directly under the mountain scene.
 *
 * It used to sit at the foot of the screen, one row above the prompt, where it
 * read as a footnote to Angband's links rather than as whose game this is. The
 * art is Angband's; this line is not, which is exactly why it belongs against
 * the title and not buried in the credit block.
 *
 * No version number here - it is already beside the title, two rows up.
 */
const PORT_CREDIT = "{light slate}A port by neostryder / RPGM Tools{/}";

/**
 * Angband's own credit, in the grey block at the foot of the screen beside the
 * links, carrying the baseline release the port reproduces.
 *
 * Slate (0x808080) is Angband's own mid-grey, so this is grey by the game's
 * palette rather than by a CSS colour invented for the web build.
 *
 * Deliberately NOT a partial copyright notice: the full statement (Ben Harrison,
 * James E. Wilson, Robert A. Koeneke, and the licence choice) ships in the
 * licence files, and a three-name notice trimmed to fit 80 columns would be worse
 * than a line that points at the real one.
 */
const ANGBAND_CREDIT = `{slate}Based on Angband ${BASELINE_VERSION} by the Angband developers{/}`;

/** One painted title row. */
export interface TitleLine {
  /** `{colour}...{/}` markup, as news.txt writes it. */
  markup: string;
  /**
   * Centre the line for the terminal width instead of painting from column 0.
   * news.txt's own rows carry baked-in centring as leading spaces and must NOT
   * be re-centred; the two lines the port adds have no such padding and must.
   */
  centred: boolean;
}

/**
 * The full painted screen: news.txt with the port's two credit lines woven in.
 *
 * Pure, and separate from the paint loop, so the row budget is checkable without
 * a terminal. That budget is the thing an edit here breaks silently: NEWS is 22
 * rows (0-21), the insert after GROUND_ROW makes 23 (0-22), and the prompt sits
 * at row 23 - so on upstream's 80x24 terminal this fits with nothing to spare.
 * That is why Angband's credit REPLACES the spacer instead of being inserted:
 * a second insert would put the help line under the prompt. news.test.ts asserts
 * the count.
 */
export function titleLines(): readonly TitleLine[] {
  const out: TitleLine[] = [];
  for (let i = 0; i < NEWS.length; i++) {
    const raw = NEWS[i] ?? "";
    out.push({
      markup: i === SPACER_ROW ? ANGBAND_CREDIT : raw.replace("$VERSION", ENGINE_VERSION),
      centred: i === SPACER_ROW,
    });
    if (i === GROUND_ROW) out.push({ markup: PORT_CREDIT, centred: true });
  }
  return out;
}

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
      const lines = titleLines();
      for (let y = 0; y < lines.length && y < height; y++) {
        const line = lines[y];
        if (!line) continue;
        const runs = parseNewsLine(line.markup);
        /* Centring measures the RUNS, not the markup: a {colour} tag occupies no
         * columns, so centring on the raw string's length would shift the line
         * left by the width of its tags. */
        let x = line.centred
          ? Math.max(0, Math.floor((cols - runs.reduce((n, r) => n + r.text.length, 0)) / 2))
          : 0;
        for (const run of runs) {
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
      /* The prompt line, on upstream's own row. Both credits are part of the
       * painted screen above (titleLines) rather than being dropped in here, so
       * there is one place where the layout is decided and one place to check it
       * against the row budget. */
      promptRow = Math.min(height - 1, 23);
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
