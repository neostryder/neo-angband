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
  /**
   * A picture at the head of the column, above `label`.
   *
   * The character sheet's flag grid has one column per equipment slot and draws
   * the WORN ITEM'S glyph over each (display_player_equippy, ui-player.c L365).
   * That is a fact about the column - what is in this slot - and not a row of
   * data, so it is published here rather than as a first row a presenter would
   * have to know to skip. A presenter with real art draws the item's icon.
   */
  readonly glyph?: ScreenRun;
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
   * The colour of the header row as CSS, where the game colours it. Absent means
   * the screen's default, which is what every listing uses; the character sheet's
   * stat table is the one that does not.
   */
  readonly headerColor?: string;
  /**
   * Blank rows the faithful terminal leaves after this table; none by default.
   *
   * A layout fact published BESIDE the data, for the same reason a column
   * publishes `width` and an art field publishes its row: the character sheet's
   * five panels are separated by a blank line, and the alternatives were to
   * append a fake all-empty row - data that says nothing is there - or to let the
   * one renderer guess a separator, which would move every other screen.
   */
  readonly gapAfter?: number;
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
  /**
   * The width upstream wraps this prose at, where it fixes one - a CLAMP on the
   * terminal's own width, never a minimum, exactly as `ScreenColumn.width` is.
   *
   * The character sheet's history block is `text_out_wrap = 72`
   * (display_player_xtra_info, ui-player.c L858) on an 80-column screen, so a
   * renderer that only knew the terminal width would lay it out eight columns
   * too wide. Absent - the usual case - means the prose fills the terminal.
   */
  readonly wrap?: number;
  /**
   * WHICH of Angband's two wrap algorithms laid this prose out.
   *
   * 4.2.6 has two, and they are not interchangeable. Almost every prose page -
   * the inspect pages, monster recall, object comparison, the knowledge
   * browser's seven recalls - is a textblock shown by `textui_textblock_show`,
   * which wraps with `textblock_calculate_lines` (z-textblock.c L238). Exactly
   * one modelled page is not: the character sheet's history, which upstream
   * pushes through `text_out_to_screen` (ui-output.c L279) with
   * `text_out_wrap = 72` (ui-player.c L866).
   *
   * They differ in two ways a player can see. `text_out_to_screen` writes a
   * non-space glyph only while `x < wrap - 1`, so it stops two columns short of
   * where `textblock_calculate_lines` stops; and after a sentence's double
   * space it never leaves the second space at the head of the next line, where
   * the textblock rule does. Measured on the shipped pack, the two disagree on
   * 5 of 1041 descriptions - every one of them the leading space.
   *
   * So this is a discriminator rather than a flag: absent means the textblock
   * rule, which is the overwhelming majority and the right default.
   */
  readonly flow?: "textblock" | "text-out";
  /**
   * The prose's default colour, for the parts no run speaks for: a paragraph
   * break, and the line-level fallback a consumer that ignores `runs` reads.
   *
   * The same field `art` carries, for the same reason - a block that is one
   * voice throughout should not have to repeat itself on every run.
   */
  readonly color?: string;
}

/**
 * One piece of text the game writes ON TOP of the art.
 *
 * The tombstone is the case this exists for. Upstream draws `dead.txt` and then
 * overwrites the character's name, class, level, experience, gold and the blow
 * that killed them into a band down the middle of the stone
 * (`put_str_centred`, ui-death.c L40-56). The result is one picture with the
 * epitaph BURNED INTO it, and a mod handed only that picture would have to know
 * that the name lives in columns 8-39 of row 7 to get it back out.
 *
 * So the art and the writing are published apart. `row`/`x1`/`x2` are where the
 * faithful terminal puts this - the renderer needs them and a presenter drawing
 * a real gravestone ignores them, reading `key`, `text` and `values` instead.
 */
export interface ScreenArtField {
  /** Stable: `name`, `title`, `class`, `level`, `exp`, `gold`, `death`, `date`. */
  readonly key: string;
  readonly text: string;
  /** The number behind the text, where the text is a formatted number. */
  readonly values?: ScreenValues;
  /** Row of `lines` this is centred over; a row past the end extends the art. */
  readonly row: number;
  /**
   * The column band it is centred in. Both absent means the full terminal width,
   * which is `put_str_centred(row, 0, wid, ...)` - what upstream does for the
   * winner's banner, and the reason the band is optional rather than always given.
   */
  readonly x1?: number;
  readonly x2?: number;
}

/**
 * Decorative ASCII the game draws as a picture: the tombstone, the winner's crown.
 *
 * Genuinely a rendering, and named so a presenter can swap the whole thing for an
 * image rather than try to read it - which is why anything that is DATA rather
 * than picture leaves through `fields` instead of being drawn into `lines`.
 */
export interface ScreenArtBlock {
  readonly kind: "art";
  readonly key: string;
  readonly lines: readonly string[];
  readonly color?: string;
  /** Text the game writes over the art; see `ScreenArtField`. */
  readonly fields?: readonly ScreenArtField[];
  /**
   * Whether the whole picture is centred in the terminal rather than drawn from
   * column 0. The crown is; the tombstone is not.
   */
  readonly center?: boolean;
  /**
   * The art's own declared width, where the file states one - `crown.txt`'s
   * first line is a width hint, and upstream centres by THAT rather than by the
   * longest row, so a picture with a short bottom row does not drift.
   */
  readonly width?: number;
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

/**
 * Something the player can DO on a screen, as data rather than as prose in the
 * footer.
 *
 * Most screens have none: a listing is dismissed, not answered, and that is the
 * whole of its contract. The character sheet is the first that does - upstream's
 * `do_cmd_change_name` offers renaming, a file dump and the page cycle from the
 * same modal (ui-player.c L1219) - and a presenter that took the screen without
 * being able to reach them would quietly take those commands away from the
 * player.
 *
 * `key` is the faithful terminal's key and is a fact about the GAME, not an
 * instruction: a presenter with a mouse offers a button and never reads it.
 */
export interface ScreenAction {
  /** Stable: `rename`, `file`, `page-next`, `page-prev`. */
  readonly id: string;
  /** The key the faithful terminal listens for. */
  readonly key: string;
  /** The game's own wording for it, lower case ("change name", "to file"). */
  readonly label: string;
}

/**
 * The way back in, for a presenter that has taken a screen with `actions`.
 *
 * `invoke` runs one of them - the game's own code, so a rename still goes through
 * the game's prompt and a dump still writes the game's file - and resolves with
 * what the player should be looking at NEXT. Usually that is the same screen with
 * new content (a renamed character's sheet) or the next page; `undefined` means
 * the game has taken the screen back and the presenter should resolve `dismissed`.
 *
 * One verb, because the alternative is a callback per action and a seam that has
 * to grow every time a screen learns a new command.
 */
export interface ScreenHost {
  invoke(id: string): Promise<ScreenView | undefined>;
}

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
  /**
   * What the player can do here beyond leaving; see `ScreenAction`. Absent on
   * every screen that is only dismissed, which is most of them.
   */
  readonly actions?: readonly ScreenAction[];
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
  /**
   * `host` is present only where `view.actions` is, and is how a presenter runs
   * one; a presenter written before actions existed ignores the argument, which
   * is why it is a second parameter rather than a field of the view. A view's
   * actions are data and can be frozen; a way back into the game cannot.
   */
  show(view: ScreenView, host?: ScreenHost): ScreenShown | undefined;
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
  "core:object-recall",
  "core:object-comparison",
  "core:monster-recall",
  "core:tombstone",
  "core:winner",
  "core:character",
  "core:character-flags",
  "core:rune-recall",
  "core:feature-recall",
  "core:trap-recall",
  "core:shape-recall",
  "core:artifact-recall",
  "core:ego-recall",
  "core:object-kind-recall",
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
    ...(view.actions === undefined
      ? {}
      : { actions: Object.freeze(view.actions.map((a) => Object.freeze({ ...a }))) }),
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
        columns: Object.freeze(
          block.columns.map((c) =>
            Object.freeze({
              ...c,
              ...(c.glyph === undefined ? {} : { glyph: Object.freeze({ ...c.glyph }) }),
            }),
          ),
        ),
        rows: Object.freeze(block.rows.map(freezeRow)),
        ...(block.headerColor === undefined ? {} : { headerColor: block.headerColor }),
        ...(block.gapAfter === undefined ? {} : { gapAfter: block.gapAfter }),
        ...(block.empty === undefined ? {} : { empty: Object.freeze({ ...block.empty }) }),
      });
    case "text":
      return Object.freeze({
        kind: "text" as const,
        paragraphs: Object.freeze(
          block.paragraphs.map((p) => Object.freeze(p.map((r) => Object.freeze({ ...r })))),
        ),
        ...(block.indent === undefined ? {} : { indent: block.indent }),
        ...(block.wrap === undefined ? {} : { wrap: block.wrap }),
        ...(block.flow === undefined ? {} : { flow: block.flow }),
        ...(block.color === undefined ? {} : { color: block.color }),
      });
    case "art":
      return Object.freeze({
        ...block,
        lines: Object.freeze([...block.lines]),
        ...(block.fields === undefined
          ? {}
          : {
              fields: Object.freeze(
                block.fields.map((f) =>
                  Object.freeze({
                    ...f,
                    ...(f.values === undefined ? {} : { values: Object.freeze({ ...f.values }) }),
                  }),
                ),
              ),
            }),
      });
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
  for (const block of view.blocks) out.push(...screenBlockLines(block, cols));
  return out;
}

/**
 * ONE block's rows.
 *
 * Exported because the character sheet's wide layout draws the same blocks at
 * upstream's own anchors rather than stacked - four flag regions tiled across the
 * screen at cols 0/20/40/60 - so it needs a block at a time. Rendering those by
 * hand beside the model is exactly the second transcription this file exists to
 * prevent.
 */
export function screenBlockLines(block: ScreenBlock, cols = 80): ScreenLine[] {
  switch (block.kind) {
    case "lines":
      return [...block.lines];
    case "art":
      return artBlockLines(block, cols);
    case "text":
      return textBlockLines(block, cols);
    case "table":
      return tableBlockLines(block);
  }
}

/**
 * put_str_centred (ui-death.c L40-56): centre `text` in the column band
 * [x1, x2] over `line`, overwriting whatever art is beneath it and extending
 * the row with spaces where it is short. `x = x1 + ((x2 - x1) / 2 - len / 2)`,
 * integer arithmetic exactly as the C.
 *
 * THIS IS THE GAME'S OWN PRIMITIVE, moved rather than written. It laid out the
 * tombstone from `screens.ts` before the tombstone had a model, and it lays it
 * out from here now, so the picture on the player's screen did not move when
 * the epitaph became data.
 */
function overwriteCentred(line: string, x1: number, x2: number, text: string): string {
  const x = x1 + (Math.trunc((x2 - x1) / 2) - Math.trunc(text.length / 2));
  const col = Math.max(0, x);
  const padded = line.length < col ? line + " ".repeat(col - line.length) : line;
  return padded.slice(0, col) + text + padded.slice(col + text.length);
}

/** The faithful terminal's rows for an `art` block: the picture, then the writing. */
function artBlockLines(block: ScreenArtBlock, cols: number): ScreenLine[] {
  /* Centred art shifts as a BLOCK, by its declared width, so its internal shape
   * survives; centring each row on its own length would bend the picture. */
  const pad =
    block.center === true
      ? " ".repeat(
          Math.max(
            0,
            Math.trunc(cols / 2) -
              Math.trunc((block.width ?? Math.max(0, ...block.lines.map((r) => r.length))) / 2),
          ),
        )
      : "";
  const rows = block.lines.map((l) => (pad !== "" && l !== "" ? pad + l : l));
  /* Fields are placed AFTER the shift, in absolute terminal columns - which is
   * what `put_str_centred` does in the C, and what makes an unbanded field the
   * full-width case rather than a special one. */
  for (const field of block.fields ?? []) {
    /* A field may sit one row PAST the picture - display_winner's banner does -
     * so the art grows to meet it rather than the field being dropped. */
    while (rows.length <= field.row) rows.push("");
    rows[field.row] = overwriteCentred(
      rows[field.row] ?? "",
      field.x1 ?? 0,
      field.x2 ?? cols,
      field.text,
    );
  }
  return rows.map((text) =>
    block.color === undefined ? { text } : { text, color: block.color },
  );
}

/** One character of a paragraph with the colour its run gave it. */
interface ProseChar {
  readonly ch: string;
  readonly color: string;
}

/** A paragraph flattened to characters, so a wrap can measure it the way the C does. */
function proseChars(
  paragraph: readonly ScreenRun[],
  base: string | undefined,
): ProseChar[] {
  const chars: ProseChar[] = [];
  for (const run of paragraph) {
    const color = run.color ?? base ?? "";
    for (const ch of run.text) chars.push({ ch, color });
  }
  return chars;
}

/** A `text` block's rows, by whichever of 4.2.6's two wraps laid it out. */
function textBlockLines(block: ScreenTextBlock, cols: number): ScreenLine[] {
  return block.flow === "text-out"
    ? textOutLines(block, cols)
    : textblockCalculatedLines(block, cols);
}

/**
 * textblock_calculate_lines (z-textblock.c L238), transcribed.
 *
 * This is the wrap behind `textui_textblock_show` / `_place`, and so behind all
 * but one modelled prose page. `region_calculate(SCREEN_REGION).width` is the
 * terminal's own width (ui-output.c L35 with `{0,0,0,0}`), so `cols` IS the
 * upstream width - not `cols - 1`, which is what this used to pass while citing
 * `text_out_to_screen` for it.
 *
 * That miscitation is worth a sentence, because it cost a whole investigation.
 * The two rules agree on every line that has a space in it, so passing width-1
 * to the wrong algorithm was invisible: 1041 of 1041 shipped descriptions came
 * out identical either way. They part on a line with NO space strictly inside
 * it, where upstream packs `width` characters and a width-1 wrap packs one
 * fewer. The longest unbroken token in the pack is 18 characters, so nothing a
 * player reads at 80 columns could show it - but a mod re-rendering a view at
 * 16 columns can, and did.
 *
 * The transcription itself: count characters, remembering the last space seen;
 * on reaching exactly `width`, break at that space and drop it, or hard-split
 * at `width` if the line holds no space past its own start.
 */
function textblockCalculatedLines(block: ScreenTextBlock, cols: number): ScreenLine[] {
  const indent = " ".repeat(block.indent ?? 0);
  const width = Math.max(1, Math.min(block.wrap ?? cols, cols - (block.indent ?? 0)));
  const base = block.color;
  const blank: ScreenLine = base === undefined ? { text: "" } : { text: "", color: base };
  const out: ScreenLine[] = [];
  const emit = (chars: readonly ProseChar[]): void => {
    out.push(chars.length === 0 && indent === "" ? { ...blank } : proseLine(chars, indent, base));
  };
  for (const paragraph of block.paragraphs) {
    const chars = proseChars(paragraph, base);
    let start = 0;
    let brk = -1;
    let len = 0;
    let i = 0;
    while (i < chars.length) {
      if (chars[i]!.ch === " ") brk = i;
      len++;
      if (len < width) {
        i++;
        continue;
      }
      /* `if (breaking_char_offset > current_line_start)` - a space AT the line's
       * own start is not a break, which is what makes a carried leading space
       * (the second of a sentence's two) hard-split rather than wrap. */
      const end = brk > start ? brk : start + width;
      emit(chars.slice(start, end));
      start = brk > start ? brk + 1 : end;
      i = start;
      len = 0;
    }
    /* UNCONDITIONALLY, even when the paragraph ended exactly on a break: `new_line`
     * has already opened the next line by then, and the C emits it. A paragraph
     * whose last word fills the line to the column therefore gets a blank row
     * after it, which is an upstream wart the port used to swallow. */
    emit(chars.slice(start));
  }
  /* `if ((*line_lengths)[total_lines - 1] == 0) total_lines--;` - exactly one
   * trailing empty line, which is the one the loop above always opens. */
  if (out.length > 0 && out[out.length - 1]!.text === indent) out.pop();
  return out;
}

/**
 * text_out_to_screen (ui-output.c L279-347), transcribed onto a cell grid.
 *
 * A GRID rather than a string builder, because that is what the function is: it
 * writes characters at terminal coordinates, and its wrap READS THEM BACK
 * (`Term_what`, L313) to find the word to carry down. Rewriting it as a
 * word-greedy string wrap would be a second transcription of a rendering, and
 * the one nobody looks at is the one that rots.
 *
 * The behaviour that string wrap would have missed: a non-space is written only
 * while `x < wrap - 1`, so the rightmost glyph lands two columns short of the
 * declared wrap - the character sheet's history reaches column 70, not 72; and
 * because the carried word is copied from `n` to `wrap - 2` and the new line
 * starts at the indent, a space that fell on the boundary is simply never
 * carried, which is why this rule leaves no leading space where the textblock
 * rule does.
 */
function textOutLines(block: ScreenTextBlock, cols: number): ScreenLine[] {
  const base = block.color;
  const indent = block.indent ?? 0;
  /* `if ((text_out_wrap > 0) && (text_out_wrap < wid)) wrap = text_out_wrap;`
   * (L272-276) - a clamp on the terminal, never a widening of it. */
  const wrap =
    block.wrap !== undefined && block.wrap > 0 && block.wrap < cols ? block.wrap : cols;
  const rows: (ProseChar | undefined)[][] = [[]];
  let x = indent;
  let y = 0;
  for (const [p, paragraph] of block.paragraphs.entries()) {
    /* Every paragraph break is one of the C's `\n` arms: back to the indent, one
     * row down, and the row cleared. */
    if (p > 0) {
      x = indent;
      rows[++y] = [];
    }
    for (const { ch, color } of proseChars(paragraph, base)) {
      if (x >= wrap - 1 && ch !== " ") {
        const row = rows[y]!;
        let n = 0;
        /* `if (x < wrap)` - x is clamped AT wrap once a space has been written
         * in the last column, and then the scan is skipped and nothing is
         * carried, because the break already fell on that space. */
        if (x < wrap) {
          for (let i = wrap - 2; i >= 0; i--) {
            if ((row[i]?.ch ?? " ") === " ") break;
            n = i;
          }
        }
        /* `if (n == 0) n = wrap;` - a word that filled the entire line has
         * nowhere to be carried to, so it is split where it stands. */
        if (n === 0) n = wrap;
        const carried = row.slice(n, wrap - 1);
        row.length = Math.min(row.length, n);
        x = indent;
        rows[++y] = [];
        for (const cell of carried) {
          rows[y]![x] = cell;
          if (++x > wrap) x = wrap;
        }
      }
      rows[y]![x] = { ch, color };
      if (++x > wrap) x = wrap;
    }
  }
  return rows.map((row) => textOutRowLine(row, base));
}

/**
 * One grid row as a line: holes are the spaces `Term_erase` left, and trailing
 * spaces are dropped because nothing was ever painted there.
 */
function textOutRowLine(
  row: readonly (ProseChar | undefined)[],
  base: string | undefined,
): ScreenLine {
  const cells = Array.from(row, (c) => c ?? { ch: " ", color: base ?? "" });
  while (cells.length > 0 && cells[cells.length - 1]!.ch === " ") cells.pop();
  const runs: { text: string; color: string }[] = [];
  for (const c of cells) appendRun(runs, c.ch, c.color);
  return {
    text: cells.map((c) => c.ch).join(""),
    ...(base === undefined ? {} : { color: base }),
    runs,
  };
}

/** One wrapped prose line: adjacent same-colour chars coalesced back into runs. */
function proseLine(
  chars: readonly { ch: string; color: string }[],
  indent: string,
  base: string | undefined,
): ScreenLine {
  const runs: { text: string; color: string }[] = [];
  if (indent !== "") runs.push({ text: indent, color: base ?? chars[0]?.color ?? "" });
  for (const c of chars) appendRun(runs, c.ch, c.color);
  const text = indent + chars.map((c) => c.ch).join("");
  return { text, ...(base === undefined ? {} : { color: base }), runs };
}

function appendRun(runs: { text: string; color: string }[], text: string, color: string): void {
  const last = runs[runs.length - 1];
  if (last && last.color === color) last.text += text;
  else runs.push({ text, color });
}

/**
 * Cut the trailing spaces off a run stream, run by run until one has content.
 *
 * A LOOP rather than a single pass because the last run is not the only one that
 * can be blank: the stat table's Cur column is empty on a stat that is not
 * drained, so dropping it leaves the single space of column gap before it as the
 * last run - and `runs` would then be one space longer than the `text` beside it,
 * which is the kind of disagreement nothing paints but everything that measures
 * trips over.
 */
function trimTrailingSpace(runs: { text: string; color: string }[]): void {
  while (runs.length > 0) {
    const last = runs[runs.length - 1]!;
    last.text = last.text.replace(/\s+$/u, "");
    if (last.text !== "") return;
    runs.pop();
  }
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
  /* The glyph row sits ABOVE the labels, which is the order upstream draws the
   * flag grid in: the equippy row, then the slot letters (ui-player.c L399-401). */
  if (block.columns.some((c) => c.glyph !== undefined)) {
    const runs: { text: string; color: string }[] = [];
    if (tagWidth !== 0) runs.push({ text: " ".repeat(tagWidth), color: "" });
    block.columns.forEach((c, i) => {
      const gap = gapBefore(block, i);
      if (gap !== "") appendRun(runs, gap, "");
      appendRun(runs, cell(c, i, c.glyph?.text ?? ""), c.glyph?.color ?? "");
    });
    trimTrailingSpace(runs);
    out.push({ text: runs.map((r) => r.text).join(""), runs });
  }
  if (block.columns.some((c) => c.label !== undefined)) {
    const header =
      " ".repeat(tagWidth) + joinCells(block, block.columns.map((c, i) => cell(c, i, c.label ?? "")));
    const text = header.replace(/\s+$/u, "");
    out.push(block.headerColor === undefined ? { text } : { text, color: block.headerColor });
  }
  if (block.rows.length === 0) {
    if (block.empty) out.push(runLine(block.empty));
    return withGap(out, block);
  }
  for (const row of block.rows) {
    const prefix = tagWidth === 0 ? "" : row.tag === undefined ? "   " : `${row.tag}) `;
    const parts = block.columns.map((c, i) => cell(c, i, row.cells[c.key]?.text ?? ""));
    const text = (prefix + joinCells(block, parts)).replace(/\s+$/u, "");
    out.push(rowLine(text, prefix, block, row, parts));
  }
  return withGap(out, block);
}

/** `gapAfter` blank rows under a table. */
function withGap(out: ScreenLine[], block: ScreenTableBlock): ScreenLine[] {
  for (let i = 0; i < (block.gapAfter ?? 0); i++) out.push({ text: "" });
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
    let width = Math.max(c.label?.length ?? 0, c.glyph?.text.length ?? 0);
    for (const row of block.rows) width = Math.max(width, row.cells[c.key]?.text.length ?? 0);
    return width;
  });
}
