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

import { inputEvents } from "./input-door";
import { setActiveCellTap, type GridPointerInput, type GridSurface } from "./term";
import { screenRegionSpec } from "./overlay";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import {
  BASIC_COLORS,
  colorTextToAttr,
  colorToCss,
  COLOUR_WHITE,
  ENGINE_VERSION,
  t,
} from "@rpgm-tools/neo-angband-core";
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
function portCredit(): string {
  return `{light slate}${t("news.credit.port", "A port by {author} / {org}", {
    author: "neostryder",
    org: "RPGM Tools",
  })}{/}`;
}

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
function angbandCredit(): string {
  return `{slate}${t(
    "news.credit.angband",
    "Based on Angband {version} by the Angband developers",
    { version: BASELINE_VERSION },
  )}{/}`;
}

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
/**
 * A mod's replacement for news.txt, or null for core's own (MOD_REACH gap 7's
 * `art` resource, slot `splash`).
 *
 * Latched rather than passed, because `titleLines` is called from paint code
 * that has no argument to spare and no way to await a fetch. Set once by boot,
 * before the title is drawn; see installModResources for why that is sound.
 *
 * The mod's rows go through the SAME pipeline core's do - `$VERSION`
 * substitution, the two credit lines, the row budget - rather than replacing the
 * screen wholesale. Credit for what the game is built on is not a mod's to
 * remove, and the budget is the thing an edit here breaks silently.
 */
let splashOverride: readonly string[] | null = null;

/** Install (or clear, with null) the mod-supplied splash art. */
export function setSplashArt(lines: readonly string[] | null): void {
  splashOverride = lines === null || lines.length === 0 ? null : lines;
}

/** True when a mod has replaced news.txt, for a test and for the report. */
export function splashIsModded(): boolean {
  return splashOverride !== null;
}

/**
 * How many rows the title screen has for art, once the two credit lines are
 * taken out of the budget.
 *
 * The budget itself is 23 (0-22) with the prompt at row 23, which is upstream's
 * 80x24 terminal with nothing to spare - see the comment on titleLines. Core's
 * own art is woven at fixed indices because it was written to be; a mod's art is
 * any length, so it is CLAMPED and the credits are appended after it. Those are
 * two different problems and one formula cannot solve both: GROUND_ROW and
 * SPACER_ROW are positions inside news.txt's picture, and a mod's picture does
 * not have them.
 */
export const MOD_SPLASH_ROWS = 21;

export function titleLines(): readonly TitleLine[] {
  const out: TitleLine[] = [];
  if (splashOverride !== null) {
    /* CLAMPED, not scrolled and not rejected. Too much art is the author having
     * drawn for a taller screen, and showing the top of it beats showing none
     * of it - the same choice reflow mode makes when the grid does not fit.
     *
     * THE CREDITS ARE NOT OPTIONAL, and this is the only place that could have
     * quietly made them so. Weaving them at core's indices would have dropped
     * one or both for any art that is not exactly news.txt's shape: SPACER_ROW
     * is 20, so a 12-row splash would never reach it and the Angband credit
     * would vanish without a word. Appending is the form that cannot fail. */
    for (const raw of splashOverride.slice(0, MOD_SPLASH_ROWS)) {
      out.push({ markup: raw.replace("$VERSION", ENGINE_VERSION), centred: false });
    }
    out.push({ markup: portCredit(), centred: true });
    out.push({ markup: angbandCredit(), centred: true });
    return out;
  }
  for (let i = 0; i < NEWS.length; i++) {
    const raw = NEWS[i] ?? "";
    out.push({
      markup: i === SPACER_ROW ? angbandCredit() : raw.replace("$VERSION", ENGINE_VERSION),
      centred: i === SPACER_ROW,
    });
    if (i === GROUND_ROW) out.push({ markup: portCredit(), centred: true });
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
 *
 * "profile" is the other addition (neo-angband#163): player/testing profiles,
 * each its own options, mod loadout and save roster within one install. It goes
 * FIRST rather than in File-menu order, because with more than one profile it is
 * the row that decides which profile's roster every other row below it acts on.
 */
export type TitleChoice = "profile" | "new" | "open" | "load" | "quit" | "install" | "update";

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
  /**
   * Offer "install locally". Not upstream's at all - there is nothing in
   * main-win.c's File menu to port it from - so unlike every other row it is
   * ABSENT rather than greyed when it does not apply. Greying is how upstream
   * says "this item exists and cannot be used right now"; a desktop build has no
   * such item and never will, so a permanent dead row there would be advertising
   * something that is not coming.
   */
  canInstall: boolean;
  /**
   * This shell can update itself, so the row is worth having. Still ABSENT
   * rather than greyed where it is meaningless - a browser tab cannot replace
   * its own install.
   *
   * THIS USED TO MEAN "a newer version exists", and the row appeared only then,
   * reasoned as: a permanently dead "(U)pdate" would say an update might arrive
   * at any moment when the truth is there is no newer version today. On the
   * desktop that premise turned out to be false in both halves. An update CAN
   * arrive at any moment - the game asks GitHub every time it starts - and the
   * row is no longer only an announcement: it is the one door to the update
   * CHANNEL, and hiding the door whenever the player was up to date meant the
   * setting could only be changed in the moments when changing it mattered
   * least. Shimmering is what announces a waiting build; existing does not.
   */
  canUpdate: boolean;
  /**
   * ...and a build really is waiting. Only this may shimmer. Separated from
   * `canUpdate` so "there is something to install" cannot be inferred from a
   * row that is now present most of the time.
   */
  updateReady: boolean;
}

/** One title row: its key, its label, and whether it is enabled. */
interface TitleRow {
  choice: TitleChoice;
  key: string;
  label: string;
  enabled: boolean;
}

/**
 * The rows: (P)rofile first (neo-angband#163), then main-win.c's File menu
 * order - New, Open, [Save], Exit. "(R)esume" takes the Save slot, which is
 * greyed at the splash upstream (main-win.c:2962 disables IDM_FILE_SAVE and
 * only :2982 re-enables it in a running game). Labels are short: an 80-column
 * prompt line already has to fit up to seven rows (see ROW_GAPS below).
 */
export function titleRows(opts: TitleOptions): TitleRow[] {
  const rows: TitleRow[] = [
    { choice: "profile", key: "p", label: t("news.title.profile", "(P)rofile"), enabled: true },
    { choice: "new", key: "n", label: t("news.title.new", "(N)ew"), enabled: true },
    {
      choice: "open",
      key: "o",
      label: t("news.title.open", "(O)pen"),
      enabled: opts.canOpen,
    },
    {
      choice: "load",
      key: "r",
      label: t("news.title.resume", "(R)esume"),
      enabled: opts.canLoad,
    },
  ];
  /* Before Quit, because Quit is last in the File menu and this is not a File
   * menu item at all - putting it after Quit would read as though upstream had
   * one there. */
  if (opts.canInstall) {
    rows.push({
      choice: "install",
      key: "i",
      label: t("news.title.install", "(I)nstall"),
      enabled: true,
    });
  }
  if (opts.canUpdate) {
    rows.push({ choice: "update", key: "u", label: t("news.title.update", "(U)pdate"), enabled: true });
  }
  rows.push({ choice: "quit", key: "q", label: t("news.title.quit", "(Q)uit"), enabled: opts.canQuit });
  return rows;
}

/**
 * The shimmer, which is an RF_ATTR_MULTI monster's and not a new invention.
 *
 * do_animation gives a multi-hued monster `randint1(BASIC_COLORS - 1)` on every
 * animation frame (ui-display.c L1445-1447, engine.ts animateMonsterAttr), so a
 * shimmering row is the same call on the same 250ms cadence. Two properties
 * carry over deliberately:
 *
 *  - it never yields attr 0 (COLOUR_DARK), because randint1 is 1-based - a row
 *    that blinked to black would read as a rendering fault;
 *  - the RNG is INJECTED and the caller passes the display-only one, never the
 *    game RNG. Upstream draws on the game RNG here, but the number of frames is
 *    a front-end property: a browser at 250ms consumes draws a real terminal
 *    never would, and the determinism ratchet would break on how long the player
 *    left the title screen open.
 */
export function shimmerCss(randint1: (n: number) => number): string {
  return colorToCss(randint1(BASIC_COLORS - 1));
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

/**
 * The gap between rows on the single prompt line, widest first.
 *
 * It has to be able to shrink. The prompt is ONE line (main-win.c:5476), (P)rofile
 * is always present, and the rest of the row set is not fixed: a browser that can
 * install offers (I)nstall, and any shell can offer (U)pdate, so the worst case is
 * seven rows - which needs more columns than three-space gaps leave in an
 * 80-column term.
 *
 * The failure mode if it did not shrink is the one worth naming: the line is
 * printed left to right and clipped at `cols`, so the row that disappears is the
 * LAST one, which is (Q)uit. Nothing would look broken - the screen would simply
 * stop offering a way out - and that is exactly the shape of defect that hides.
 */
const ROW_GAPS = ["   ", "  ", " "] as const;

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
  const labels = rows.reduce((n, r) => n + r.label.length, 0);
  const widthAt = (gap: number): number => labels + gap * (rows.length - 1);
  const gap = ROW_GAPS.find((g) => widthAt(g.length) <= cols)?.length ?? 1;
  let x = Math.max(0, Math.floor((cols - widthAt(gap)) / 2));
  const out: { row: TitleRow; start: number; end: number }[] = [];
  for (const row of rows) {
    out.push({ row, start: x, end: x + row.label.length - 1 });
    x += row.label.length + gap;
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
/**
 * The animation cadence, matching main.ts's ANIM_INTERVAL_MS. Stated here rather
 * than imported because main.ts imports THIS module; the test asserts the two
 * agree, so the duplication cannot drift silently.
 */
export const TITLE_SHIMMER_MS = 250;

/** What showTitleScreen needs that is not a fact about the rows. */
export interface TitleDeps {
  /** The display-only RNG - never the game's. See shimmerCss. */
  readonly randint1: (n: number) => number;
  /** Injected so a test can drive frames without a real clock. */
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  /**
   * An update answer that had not arrived when the screen was painted.
   *
   * The title used to wait outright for the check, on the rule that a row must
   * not appear under the player's cursor. The rule is right; waiting was the
   * wrong way to keep it, because a cold check costs seconds (6.1s measured on
   * the shipped build) and the screen sat unfinished for all of them.
   *
   * This lights the shimmer late WITHOUT moving anything: it starts the same
   * animation on a row that is already drawn and already in its final place, and
   * does nothing at all when there is no enabled (U)pdate row to light - which is
   * exactly the case where honouring it would move the layout.
   */
  readonly updateReadyLater?: Promise<boolean>;
}

/**
 * The title screen MINUS its menu row: news.txt and the "Neo" overlay.
 *
 * Split out because of what the player saw on every launch. The boot sequence
 * paints the loaded character's map (main.ts's top-level render()) and only then
 * enters maybeTitle, which must await the update check and the mod check before
 * it can know whether the (U)pdate row is live - so the town sat on screen for
 * the length of a network round trip and the title arrived after it. Painting
 * the art FIRST costs nothing (it depends on no answer) and the awaits then
 * happen over the title rather than over the game.
 *
 * The menu row is deliberately NOT drawn here. A row that appears under the
 * player's cursor a moment after the screen does is how a menu gets mis-clicked,
 * so the rows still arrive together, in their final positions, once both checks
 * have answered. showTitleScreen repaints this art itself; the terminal diffs
 * against what is already on the canvas, so the second call draws nothing.
 */
export function paintTitleArt(term: GridSurface & GridPointerInput): void {
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
}

export function showTitleScreen(
  host: GridSurface & GridPointerInput,
  opts: TitleOptions,
  deps?: TitleDeps,
): Promise<TitleChoice> {
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
  return new Promise<TitleChoice>((resolve) => {
    const rows = titleRows(opts);
    let spans: { row: TitleRow; start: number; end: number }[] = [];
    let promptRow = 0;
    /* The shimmer's current colour. Held outside paint() so a full repaint (a
     * resize) keeps the frame the player is looking at rather than flashing
     * back to white. */
    let shimmer = colorToCss(COLOUR_WHITE);
    const paint = (): void => {
      const { cols, rows: height } = term.size();
      paintTitleArt(term);
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
          span.row.enabled ? (span.row.choice === "update" ? shimmer : white) : UI_DIM,
        );
      }
    };
    /* One row repainted, not the screen. The terminal diffs against what is on
     * the canvas anyway, but going through paint() four times a second would
     * re-derive the whole 80x24 grid - including the art - for eight columns. */
    const paintShimmer = (): void => {
      const span = spans.find((s) => s.row.choice === "update");
      const { cols } = term.size();
      if (!span || span.start >= cols) return;
      shimmer = shimmerCss(deps?.randint1 ?? (() => COLOUR_WHITE));
      term.print(span.start, promptRow, span.row.label.slice(0, cols - span.start), shimmer);
    };
    const every = deps?.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    const stop = deps?.clearInterval ?? ((h: unknown) => {
      clearInterval(h as ReturnType<typeof setInterval>);
    });
    let shimmerTimer: unknown = null;
    let closed = false;
    /** Start the shimmer, at most once, on a row that is already on screen. */
    const beginShimmer = (): void => {
      if (shimmerTimer !== null) return;
      paintShimmer();
      shimmerTimer = every(paintShimmer, TITLE_SHIMMER_MS);
    };
    const finish = (choice: TitleChoice): void => {
      closed = true;
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      /* The title screen is a promise that resolves once; a timer left running
       * would repaint row 23 over whatever screen comes next, forever. */
      if (shimmerTimer !== null) {
        stop(shimmerTimer);
        shimmerTimer = null;
      }
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
    inputEvents.addEventListener("keydown", onKey, true);
    setActiveCellTap(term, (cell) => {
      if (cell.row !== promptRow) return;
      const hit = spans.find((s) => cell.col >= s.start && cell.col <= s.end);
      if (hit?.row.enabled) finish(hit.row.choice);
    });
    paint();
    if (opts.updateReady) beginShimmer();
    /* THE ANSWER CAN ARRIVE AFTER THE SCREEN DOES - see TitleDeps.updateReadyLater.
     *
     * Three guards, each for a way this could reach past its own screen: `closed`
     * because a promise that settles after the player has already pressed a key
     * would start a timer repainting row 23 over whatever comes next, forever;
     * the enabled-row check because lighting a row that is not there would be the
     * layout change this whole arrangement exists to avoid; and beginShimmer's
     * own once-only guard, because a title that was ALREADY shimmering must not
     * end up with two timers on it. */
    void deps?.updateReadyLater
      ?.then((ready) => {
        if (!ready || closed) return;
        if (!spans.some((s) => s.row.choice === "update" && s.row.enabled)) return;
        beginShimmer();
      })
      .catch(() => {
        /* A check that threw is not an update. The (U)pdate screen reports it. */
      });
  }).finally(() => {
    popRegion(handle);
  });
}
