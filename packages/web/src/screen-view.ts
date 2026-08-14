/**
 * A full screen as a DOCUMENT, rather than as styled text on a grid.
 *
 * WHY THIS EXISTS. Gap 21's other three seams reached the map (`display:replace`),
 * the HUD (`ui:<region>.replace`) and the menus (`ui:menu.replace`). The screens
 * were still out: ~50 builders in `screens.ts`, `knowledge.ts` and `help.ts` all
 * answer `ScreenLine[]`, which is a row of characters with a colour. A mod handed
 * those lines is parsing a rendering - it would have to know that an inventory row
 * is `a) ` then a name padded to 45 then a weight, and it would break the day a
 * pref file changes a colour or a translation changes a width. That is why an
 * inventory drawn as sprites was out of reach even after the menus opened: the
 * picker was semantic and the LISTING was not.
 *
 * SO A SCREEN IS BLOCKS, AND A LIST IS A TABLE. A `table` block carries columns
 * with stable keys and rows whose cells are addressed BY THAT KEY, so a presenter
 * reads `row.cells.name` and never counts characters. A row carries the same
 * `MenuSemantics` a menu choice does - `{ kind: "item", ref: handle }` - so a mod
 * that knows how to draw an item in a picker already knows how to draw one here.
 * And a row carries `values` under the HUD's convention (`current` + `max`
 * together mean a proportion, everything else is a named quantity), so a screen
 * can grow a bar without growing an API.
 *
 * THE COLUMN WIDTHS ARE STILL PUBLISHED, and that is deliberate rather than a
 * leak. Upstream's listings line up because `OLIST_WEIGHT` writes its figures at a
 * fixed offset, and a faithful terminal has to reproduce that. A presenter with a
 * proportional font ignores `width` and lays the column out its own way; the point
 * is that it can, because the width is a hint beside the data instead of padding
 * baked into it.
 *
 * `lines` IS THE HONEST ESCAPE HATCH. A block of pre-wrapped styled rows, for a
 * screen nobody has modelled yet. It is not a lie and it is not invisible:
 * `MODELLED_SCREENS` names every screen that has given up its model, a test pins
 * that list, and a screen still on `lines` is a screen a presenter can reskin the
 * frame of but not reimagine. Prose the game already laid out (a mod's
 * description, an error) is finished at `lines`; a list or a table on `lines` is
 * work not yet done.
 *
 * PURE. Nothing here reads a terminal or a game state, so a view can be built and
 * rendered by a test with no canvas.
 */

import type { MenuSemantics } from "@rpgm-tools/neo-angband-core";
import type { ScreenLine } from "./overlay";

/** One coloured segment of text. `color` is CSS; absent means the screen's default. */
export interface ScreenRun {
  readonly text: string;
  readonly color?: string;
}

/** Named quantities behind a row or a cell; see `HudValues` for the convention. */
export type ScreenValues = Readonly<Record<string, number>>;

/**
 * One column of a `table` block.
 *
 * `key` is stable and is what a cell is addressed by - `name`, `weight`, `fail` -
 * so a presenter that only wants names never learns the layout. `width` is the
 * faithful terminal's field width where upstream fixed one, and absent where the
 * column is as wide as its widest cell.
 */
export interface ScreenColumn {
  readonly key: string;
  /** The game's own header text, where the screen has one. */
  readonly label?: string;
  readonly width?: number;
  readonly align?: "left" | "right";
  /**
   * Columns of space between this column and the one before it; 1 by default,
   * ignored on the first column.
   *
   * Upstream's field layouts are not all single-spaced - the history screen writes
   * `"%10ld%7d'  %s"`, no gap before the depth and two before the note - so a
   * renderer that assumes one space cannot reproduce them.
   */
  readonly gap?: number;
  /**
   * Whether cells in this column are padded out to the column's width; true by
   * default. `false` renders each cell at its natural length, which is what the
   * object list does: its location field FOLLOWS the name rather than lining up
   * under one, and padding it into a column would be the port adding something.
   *
   * A declared `width` still clamps, and `align` has nothing to do when false.
   */
  readonly pad?: boolean;
}

/** One cell. Its own `color` overrides the row's; `values` are its numbers. */
export interface ScreenCell {
  readonly text: string;
  readonly color?: string;
  readonly values?: ScreenValues;
}

/**
 * One row of a table.
 *
 * `id` and `semantic` are the same identity a `MenuChoice` carries, on purpose: an
 * inventory LISTING and an inventory PICKER are the same objects seen twice, and a
 * mod should not need two vocabularies for them.
 */
export interface ScreenRow {
  readonly id?: string;
  readonly semantic?: MenuSemantics;
  /** The letter the faithful terminal offers for this row, where it offers one. */
  readonly tag?: string;
  /** The row's colour as CSS - the object's own attr, for a gear listing. */
  readonly color?: string;
  /** Shown but not actionable: an empty equipment slot, an unreadable book. */
  readonly disabled?: boolean;
  readonly values?: ScreenValues;
  /** Addressed by column key. A column with no cell here renders empty. */
  readonly cells: Readonly<Record<string, ScreenCell>>;
}

/** A list or a listing: columns with stable keys, rows addressed by them. */
export interface ScreenTableBlock {
  readonly kind: "table";
  /** Stable identity for the table within its screen (`pack`, `slots`, `stats`). */
  readonly key: string;
  /**
   * A heading above the table, where the screen has one - the object list's
   * "You can see 3 objects:". A run rather than a string because the game colours
   * it, exactly as it colours `empty`.
   */
  readonly caption?: ScreenRun;
  /**
   * Whether rows in this table are lettered - a fact about the TABLE, never about
   * the rows it happens to hold today.
   *
   * Required, and required for a reason that cost a regression to find: derived
   * from "does any row have a tag", an equipment list on a character wearing
   * nothing loses the three columns of indent that every filled row has, and the
   * whole listing slides left. A layout fact that changes with the data is not a
   * layout fact.
   */
  readonly tagged: boolean;
  readonly columns: readonly ScreenColumn[];
  readonly rows: readonly ScreenRow[];
  /**
   * What the terminal shows when there are no rows ("(nothing carried)"). A
   * presenter is free to draw its own empty state instead.
   */
  readonly empty?: ScreenRun;
}

/**
 * Prose the game generated, UNWRAPPED.
 *
 * The wrapping is the rendering, which is exactly what a presenter with its own
 * font has to redo. `paragraphs` are logical: a run stream per paragraph, split
 * where the game meant a break and nowhere else.
 */
export interface ScreenTextBlock {
  readonly kind: "text";
  readonly paragraphs: readonly (readonly ScreenRun[])[];
  /** Columns of leading indent the faithful terminal uses. */
  readonly indent?: number;
}

/**
 * Decorative ASCII the game draws as a picture: the tombstone, the winner's crown.
 *
 * Genuinely a rendering, and named so a presenter can swap the whole thing for an
 * image rather than try to read it.
 */
export interface ScreenArtBlock {
  readonly kind: "art";
  readonly key: string;
  readonly lines: readonly string[];
  readonly color?: string;
}

/**
 * Pre-wrapped styled rows - the escape hatch. See the module header: correct for
 * prose the game already laid out, and a marker of work not done for anything else.
 */
export interface ScreenLinesBlock {
  readonly kind: "lines";
  readonly lines: readonly ScreenLine[];
}

export type ScreenBlock =
  | ScreenTableBlock
  | ScreenTextBlock
  | ScreenArtBlock
  | ScreenLinesBlock;

/** One full screen the game is showing. */
export interface ScreenView {
  /**
   * Stable screen id - `core:inventory`, `core:equipment`. Match on this to
   * decide whether you have a better way to show THIS screen.
   *
   * `core:text` is the shared id of every unmodelled prose page; a presenter can
   * reskin its frame but has nothing but the title to tell one from another. That
   * is a statement about how much of the game has been modelled, not a design.
   */
  readonly id: string;
  readonly title: string;
  /** The game's own key legend. Wrong for a presenter with different keys. */
  readonly footer: string;
  readonly blocks: readonly ScreenBlock[];
}

/**
 * The consumer boundary for screens.
 *
 * `show` returns `undefined` to DECLINE - the game shows the screen its own way,
 * and that is the expected case, not a failure. Taking it returns a handle whose
 * `dismissed` resolves when the player is done with it.
 *
 * WHY DECLINING IS SYNCHRONOUS while a menu's is not. `MenuPresenter.ask` can
 * decline from inside a promise because its resolution IS the answer. Here the
 * resolution means "the player dismissed it", so there is no value left to say
 * "not mine" with. Deciding never needs to be async anyway - a presenter matches
 * on `view.id` - and drawing obviously does, which is what the handle is for.
 */
export interface ScreenPresenter {
  show(view: ScreenView): ScreenShown | undefined;
}

/** A screen a presenter has taken. */
export interface ScreenShown {
  readonly dismissed: Promise<void>;
}

/**
 * Every screen that has given up its model, so "which screens are still lines" is
 * a question with an answer rather than a survey.
 *
 * Pinned by `screen-view.test.ts` against the builders that actually exist, so
 * adding an id here without building it fails, and modelling a screen without
 * listing it fails too.
 */
export const MODELLED_SCREENS = [
  "core:inventory",
  "core:equipment",
  "core:quiver",
  "core:objects-in-view",
  "core:messages",
  "core:player-history",
] as const;

/** The id every unmodelled prose page shares. See `ScreenView.id`. */
export const UNMODELLED_SCREEN = "core:text";

/**
 * The key legend the faithful terminal shows under a screen, and `showTextScreen`'s
 * default. Spelled once so a modelled screen and a prose page cannot disagree
 * about how the player gets out.
 */
export const SCREEN_FOOTER = "[ Press ESC to return ]";

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

/**
 * A view over pre-wrapped lines - the `showTextScreen(term, title, lines)` path.
 *
 * Every one of these shares `UNMODELLED_SCREEN` as its id rather than getting one
 * derived from its title, because a title here is a display string that a
 * translation or a mod's own name changes (`${m.name}  v${m.version}`). A derived
 * id would look stable and would not be.
 */
export function linesScreen(title: string, lines: readonly ScreenLine[], footer: string): ScreenView {
  return freezeView({
    id: UNMODELLED_SCREEN,
    title,
    footer,
    blocks: [{ kind: "lines", lines }],
  });
}

/**
 * One screen, frozen, at the boundary.
 *
 * Frozen for the reason `snapshotHudFrame` copies and `buildMenuQuestion` freezes:
 * a presenter may hold a view while it animates it in, and what crossed the
 * boundary must not be an array the next screen reuses. Rows and cells are frozen
 * too - a table's rows are the part a presenter is most likely to keep.
 */
export function freezeView(view: ScreenView): ScreenView {
  return Object.freeze({
    id: view.id,
    title: view.title,
    footer: view.footer,
    blocks: Object.freeze(view.blocks.map(freezeBlock)),
  });
}

function freezeBlock(block: ScreenBlock): ScreenBlock {
  switch (block.kind) {
    case "table":
      return Object.freeze({
        kind: "table" as const,
        key: block.key,
        tagged: block.tagged,
        ...(block.caption === undefined ? {} : { caption: Object.freeze({ ...block.caption }) }),
        columns: Object.freeze(block.columns.map((c) => Object.freeze({ ...c }))),
        rows: Object.freeze(block.rows.map(freezeRow)),
        ...(block.empty === undefined ? {} : { empty: Object.freeze({ ...block.empty }) }),
      });
    case "text":
      return Object.freeze({
        kind: "text" as const,
        paragraphs: Object.freeze(
          block.paragraphs.map((p) => Object.freeze(p.map((r) => Object.freeze({ ...r })))),
        ),
        ...(block.indent === undefined ? {} : { indent: block.indent }),
      });
    case "art":
      return Object.freeze({ ...block, lines: Object.freeze([...block.lines]) });
    case "lines":
      return Object.freeze({
        kind: "lines" as const,
        lines: Object.freeze(block.lines.map(freezeLine)),
      });
  }
}

function freezeRow(row: ScreenRow): ScreenRow {
  const cells: Record<string, ScreenCell> = {};
  for (const [key, cell] of Object.entries(row.cells)) {
    cells[key] = Object.freeze({
      text: cell.text,
      ...(cell.color === undefined ? {} : { color: cell.color }),
      ...(cell.values === undefined ? {} : { values: Object.freeze({ ...cell.values }) }),
    });
  }
  return Object.freeze({
    ...(row.id === undefined ? {} : { id: row.id }),
    ...(row.semantic === undefined ? {} : { semantic: Object.freeze({ ...row.semantic }) }),
    ...(row.tag === undefined ? {} : { tag: row.tag }),
    ...(row.color === undefined ? {} : { color: row.color }),
    ...(row.disabled === undefined ? {} : { disabled: row.disabled }),
    ...(row.values === undefined ? {} : { values: Object.freeze({ ...row.values }) }),
    cells: Object.freeze(cells),
  });
}

function freezeLine(line: ScreenLine): ScreenLine {
  return Object.freeze({
    text: line.text,
    ...(line.color === undefined ? {} : { color: line.color }),
    ...(line.runs === undefined ? {} : { runs: Object.freeze(line.runs.map((r) => Object.freeze({ ...r }))) }),
  });
}

/* ------------------------------------------------------------------ */
/* Rendering, for the terminal that stays faithful                     */
/* ------------------------------------------------------------------ */

/**
 * The faithful terminal's rows for a view's BODY - no title and no footer, which
 * `showTextScreen` draws itself.
 *
 * This is the one renderer. The point of routing core's own painting through it
 * is the lesson the HUD taught: a model beside a second hand-laid drawing of the
 * same thing is two transcriptions, and the one nobody looks at is the one that
 * rots. So `inventoryLines` is now this function applied to `inventoryScreen`,
 * and a column that loses its width loses it on the player's screen too.
 */
export function screenBodyLines(view: ScreenView, cols = 80): ScreenLine[] {
  const out: ScreenLine[] = [];
  for (const block of view.blocks) {
    switch (block.kind) {
      case "lines":
        out.push(...block.lines);
        break;
      case "art":
        for (const line of block.lines) {
          out.push(block.color === undefined ? { text: line } : { text: line, color: block.color });
        }
        break;
      case "text":
        out.push(...textBlockLines(block, cols));
        break;
      case "table":
        out.push(...tableBlockLines(block));
        break;
    }
  }
  return out;
}

/** Greedy word-wrap of a run stream, carrying colours across the break. */
function textBlockLines(block: ScreenTextBlock, cols: number): ScreenLine[] {
  const indent = " ".repeat(block.indent ?? 0);
  const width = Math.max(1, cols - 1 - (block.indent ?? 0));
  const out: ScreenLine[] = [];
  for (const paragraph of block.paragraphs) {
    let runs: { text: string; color: string }[] = [];
    let used = 0;
    const flush = (): void => {
      if (runs.length === 0) {
        out.push({ text: "" });
        return;
      }
      const text = indent + runs.map((r) => r.text).join("");
      out.push({ text, runs: [{ text: indent, color: runs[0]!.color }, ...runs] });
      runs = [];
      used = 0;
    };
    for (const run of paragraph) {
      const color = run.color ?? "";
      for (const word of run.text.split(/(\s+)/u)) {
        if (word === "") continue;
        if (/^\s+$/u.test(word)) {
          if (used > 0) {
            appendRun(runs, " ", color);
            used += 1;
          }
          continue;
        }
        if (used > 0 && used + word.length > width) {
          trimTrailingSpace(runs);
          flush();
        }
        appendRun(runs, word, color);
        used += word.length;
      }
    }
    trimTrailingSpace(runs);
    flush();
  }
  return out;
}

function appendRun(runs: { text: string; color: string }[], text: string, color: string): void {
  const last = runs[runs.length - 1];
  if (last && last.color === color) last.text += text;
  else runs.push({ text, color });
}

function trimTrailingSpace(runs: { text: string; color: string }[]): void {
  const last = runs[runs.length - 1];
  if (!last) return;
  last.text = last.text.replace(/\s+$/u, "");
  if (last.text === "") runs.pop();
}

/**
 * A table as the faithful terminal lays it out: `tag) ` then each column padded to
 * its width, single-spaced, with the trailing run of spaces cut.
 *
 * The trailing cut matters for a reason that is not cosmetic: an empty equipment
 * slot has no weight, and padding it out to the weight column would put 12 spaces
 * of "row" where upstream ends the line. Nothing paints differently, but a test
 * that reads the row back sees the difference, and so does anything that measures.
 */
function tableBlockLines(block: ScreenTableBlock): ScreenLine[] {
  const out: ScreenLine[] = [];
  if (block.caption !== undefined) out.push(runLine(block.caption));
  const widths = columnWidths(block);
  const tagWidth = block.tagged ? 3 : 0;
  const cell = (c: ScreenColumn, i: number, text: string): string =>
    pad(text, widths[i]!, c.align, c.width !== undefined, c.pad !== false);
  /* The header comes BEFORE the empty state, and for the reason `tagged` is a
   * required field: a table's columns are a fact about the table, not about the
   * rows it holds today. The player history of a character who has done nothing
   * yet still has a Turn column, and upstream still prints its header. */
  if (block.columns.some((c) => c.label !== undefined)) {
    const header =
      " ".repeat(tagWidth) + joinCells(block, block.columns.map((c, i) => cell(c, i, c.label ?? "")));
    out.push({ text: header.replace(/\s+$/u, "") });
  }
  if (block.rows.length === 0) {
    if (block.empty) out.push(runLine(block.empty));
    return out;
  }
  for (const row of block.rows) {
    const prefix = tagWidth === 0 ? "" : row.tag === undefined ? "   " : `${row.tag}) `;
    const parts = block.columns.map((c, i) => cell(c, i, row.cells[c.key]?.text ?? ""));
    const text = (prefix + joinCells(block, parts)).replace(/\s+$/u, "");
    out.push(rowLine(text, prefix, block, row, parts));
  }
  return out;
}

/**
 * One row's `ScreenLine`, with per-run colours ONLY where the cells disagree.
 *
 * A gear listing colours the whole row by the object's attr, and emitting that as
 * a one-run `runs` array would be the same pixels through a different code path in
 * `showTextScreen`. Same picture, more to go wrong; so a row whose cells carry no
 * colour of their own stays a plain coloured line, exactly as it was drawn before
 * any of this existed.
 */
function rowLine(
  text: string,
  prefix: string,
  block: ScreenTableBlock,
  row: ScreenRow,
  parts: readonly string[],
): ScreenLine {
  const coloured = block.columns.some((c) => row.cells[c.key]?.color !== undefined);
  if (!coloured) return row.color === undefined ? { text } : { text, color: row.color };
  const runs: { text: string; color: string }[] = [];
  const base = row.color ?? "";
  if (prefix !== "") runs.push({ text: prefix, color: base });
  block.columns.forEach((c, i) => {
    const gap = gapBefore(block, i);
    if (gap !== "") appendRun(runs, gap, base);
    appendRun(runs, parts[i]!, row.cells[c.key]?.color ?? base);
  });
  trimTrailingSpace(runs);
  return { text, ...(row.color === undefined ? {} : { color: row.color }), runs };
}

/** One standalone run - a caption, an empty state - as a line. */
function runLine(run: ScreenRun): ScreenLine {
  return run.color === undefined ? { text: run.text } : { text: run.text, color: run.color };
}

/** The spaces before column `i`: its own `gap`, one by default, none on the first. */
function gapBefore(block: ScreenTableBlock, i: number): string {
  return i === 0 ? "" : " ".repeat(block.columns[i]?.gap ?? 1);
}

function joinCells(block: ScreenTableBlock, parts: readonly string[]): string {
  return parts.map((part, i) => gapBefore(block, i) + part).join("");
}

function pad(
  text: string,
  width: number,
  align: ScreenColumn["align"],
  clamp: boolean,
  padded: boolean,
): string {
  const kept = clamp && text.length > width ? text.slice(0, width) : text;
  if (!padded) return kept;
  return align === "right" ? kept.padStart(width) : kept.padEnd(width);
}

/**
 * Each column's rendered width: the declared one where upstream fixed it, else the
 * widest cell. A declared width is a CLAMP, not a minimum - `withWeight` truncated
 * a long object name to 45 to keep the weights in their column, and a table that
 * only ever grew would push them off the right edge of an 80-column terminal.
 */
function columnWidths(block: ScreenTableBlock): number[] {
  return block.columns.map((c) => {
    if (c.width !== undefined) return c.width;
    let width = c.label?.length ?? 0;
    for (const row of block.rows) width = Math.max(width, row.cells[c.key]?.text.length ?? 0);
    return width;
  });
}
