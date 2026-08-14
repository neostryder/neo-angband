/**
 * The public, renderer-neutral shape of a full screen: a DOCUMENT of blocks.
 *
 * The fourth display seam, after `frontend.ts` (the dungeon), `hud.ts` (the
 * things drawn around it) and `menu.ts` (the questions). This one reaches the
 * CONTENT of the big screens - the inventory listing, the equipment slots, the
 * character sheet - which the other three did not.
 *
 * WHY IT HAD TO EXIST. Before this the game's screens were `ScreenLine[]`: a row
 * of characters and a colour. A mod handed those is parsing a rendering - it has
 * to know an inventory row is `a) ` then a name padded to 45 then a weight, and it
 * breaks the day a pref file changes a colour or a translation changes a width.
 * That is why an inventory drawn as sprites stayed out of reach even after the
 * menus opened: the PICKER was semantic and the LISTING was not.
 *
 * SO A LIST IS A TABLE. Columns have stable keys, cells are addressed by them, and
 * a row carries the same `MenuSemantics` a menu choice does - an item is the same
 * thing to you whether the game is listing it or asking you to pick one.
 *
 * NOT EVERY SCREEN HAS A MODEL YET, and the honest marker for that is in the data
 * rather than in a changelog: an unmodelled screen arrives with id `core:text` and
 * a single `lines` block of pre-wrapped rows. Enough to reskin a frame, not enough
 * to reimagine a listing. Check `view.id`.
 *
 * This module contains types only. A folder plugin may `import type` from the SDK
 * while its built JavaScript continues to have no bare engine import.
 */

import type { MenuSemantics } from "./menu.js";

/** One coloured segment of text. `color` is CSS; absent means the screen's default. */
export interface ScreenRun {
  readonly text: string;
  readonly color?: string;
}

/**
 * Named quantities behind a row or a cell.
 *
 * The HUD's convention, unchanged, so one rule covers both seams: `current` and
 * `max` TOGETHER mean the field is a proportion and can be drawn as a bar; every
 * other key is a plain named quantity. Absent means the game does not know the
 * number, which is never the same as zero.
 */
export type ScreenValues = Readonly<Record<string, number>>;

/**
 * One column of a `table` block.
 *
 * `key` is stable - `name`, `weight`, `fail` - and is what a cell is addressed by,
 * so a presenter that only wants names never learns the layout. `width` is the
 * faithful terminal's field width where upstream fixed one; ignore it if you lay
 * columns out yourself. It is published rather than baked into the text because
 * upstream's listings line up by writing at fixed offsets, and a faithful terminal
 * has to be able to reproduce that.
 */
export interface ScreenColumn {
  readonly key: string;
  /** The game's own header text, where the screen has one. */
  readonly label?: string;
  readonly width?: number;
  readonly align?: "left" | "right";
  /**
   * Columns of space between this column and the one before it; 1 by default,
   * ignored on the first column. Upstream's field layouts are not all
   * single-spaced - the history screen writes `"%10ld%7d'  %s"` - so a faithful
   * terminal needs this. Ignore it if you lay columns out yourself.
   */
  readonly gap?: number;
  /**
   * Whether cells in this column are padded out to the column's width; true by
   * default. `false` means the game does NOT line this column up - the object
   * list's location field follows the name rather than sitting under a column
   * stop. Another fact about the terminal that a presenter is free to ignore.
   */
  readonly pad?: boolean;
  /**
   * A picture at the head of the column, above `label`.
   *
   * The character sheet's flag grid has one column per equipment slot and draws
   * the WORN ITEM'S glyph over each. That is a fact about the column - what is in
   * this slot - not a row of data, so you get it here rather than as a first row
   * you would have to know to skip. Draw the item's icon instead.
   */
  readonly glyph?: ScreenRun;
}

/** One cell. Its own `color` overrides the row's; `values` are its numbers. */
export interface ScreenCell {
  readonly text: string;
  readonly color?: string;
  readonly values?: ScreenValues;
}

/** One row of a table. `id` and `semantic` are a `MenuChoice`'s identity, reused. */
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
  /** Addressed by column key. A column with no cell here is empty on this row. */
  readonly cells: Readonly<Record<string, ScreenCell>>;
}

/** A list or a listing: columns with stable keys, rows addressed by them. */
export interface ScreenTableBlock {
  readonly kind: "table";
  /** Stable identity for the table within its screen (`pack`, `slots`, `stats`). */
  readonly key: string;
  /** A heading above the table ("You can see 3 objects:"), with the game's colour. */
  readonly caption?: ScreenRun;
  /**
   * Whether rows in this table are lettered - a fact about the TABLE, not about
   * the rows it holds today. An equipment list on a character wearing nothing is
   * still a lettered table, and still indented by the width of a letter.
   */
  readonly tagged: boolean;
  readonly columns: readonly ScreenColumn[];
  readonly rows: readonly ScreenRow[];
  /** The header row's colour as CSS, where the game colours it. */
  readonly headerColor?: string;
  /**
   * Blank rows the faithful terminal leaves after this table; none by default.
   * A layout fact, like `width` - the character sheet's panels are separated by
   * one. Ignore it if you lay the blocks out yourself.
   */
  readonly gapAfter?: number;
  /** What the terminal shows when there are no rows ("(nothing carried)"). */
  readonly empty?: ScreenRun;
}

/**
 * Prose the game generated, UNWRAPPED - the wrapping is the rendering, which is
 * exactly what a presenter with its own font redoes. Paragraphs are logical.
 */
export interface ScreenTextBlock {
  readonly kind: "text";
  readonly paragraphs: readonly (readonly ScreenRun[])[];
  /** Columns of leading indent the faithful terminal uses. */
  readonly indent?: number;
  /**
   * The width upstream wraps this prose at, where it fixes one - a CLAMP on the
   * terminal's width, never a minimum. The character sheet's history is 72 on an
   * 80-column screen. Ignore it; you are measuring your own font.
   */
  readonly wrap?: number;
  /** The prose's default colour, for the parts no run speaks for (a break). */
  readonly color?: string;
}

/**
 * One piece of text the game writes ON TOP of the art.
 *
 * The tombstone is the case this exists for: upstream draws the stone and then
 * overwrites the name, class, level, experience, gold and killing blow into a
 * band down the middle of it, so the epitaph ends up burned into the picture.
 * Published apart, you can draw a real gravestone with the player's own name on
 * it instead of reading columns 8-39 of row 7 back out of ASCII.
 *
 * `row`/`x1`/`x2` are where the faithful terminal puts this. Ignore them and
 * read `key`, `text` and `values`.
 */
export interface ScreenArtField {
  /** Stable: `name`, `title`, `class`, `level`, `exp`, `gold`, `death`, `date`. */
  readonly key: string;
  readonly text: string;
  /** The number behind the text, where the text is a formatted number. */
  readonly values?: ScreenValues;
  readonly row: number;
  /** The column band it is centred in; both absent means the full width. */
  readonly x1?: number;
  readonly x2?: number;
}

/**
 * Decorative ASCII the game draws as a picture: the tombstone, the winner's
 * crown. Genuinely a rendering, and named so you can swap the whole thing for an
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
  /** Whether the picture is centred in the terminal. The crown is; the stone is not. */
  readonly center?: boolean;
  /** The art's own declared width, where the file states one. */
  readonly width?: number;
}

/** Pre-wrapped styled rows: prose the game already laid out, or a screen with no model yet. */
export interface ScreenLinesBlock {
  readonly kind: "lines";
  readonly lines: readonly {
    readonly text: string;
    readonly color?: string;
    readonly runs?: readonly { readonly text: string; readonly color: string }[];
  }[];
}

export type ScreenBlock = ScreenTableBlock | ScreenTextBlock | ScreenArtBlock | ScreenLinesBlock;

/** One full screen the game is showing. */
export interface ScreenView {
  /**
   * Stable screen id - `core:inventory`, `core:equipment`. Match on this to decide
   * whether you have a better way to show THIS screen. `core:text` is the shared
   * id of every screen that has no model yet; you get its title and its lines.
   */
  readonly id: string;
  readonly title: string;
  /** The game's own key legend. Wrong for a presenter with different keys. */
  readonly footer: string;
  readonly blocks: readonly ScreenBlock[];
  /**
   * What the player can DO here beyond leaving. Absent on every screen that is
   * only dismissed, which is most of them; see `ScreenAction`.
   */
  readonly actions?: readonly ScreenAction[];
}

/**
 * Something the player can do on a screen, as data rather than as prose in the
 * footer.
 *
 * The character sheet is the screen this exists for: the game offers renaming,
 * a character dump and the page cycle from the same modal, and a presenter that
 * took the sheet without being able to reach them would quietly take those
 * commands away from the player. Run one with `ScreenHost.invoke`.
 *
 * `key` is what the faithful terminal listens for - a fact about the GAME, not
 * an instruction. Offer a button and never read it.
 */
export interface ScreenAction {
  /** Stable: `rename`, `file`, `page-next`, `page-prev`. */
  readonly id: string;
  readonly key: string;
  /** The game's own wording, lower case ("change name", "to file"). */
  readonly label: string;
}

/**
 * The way back in, handed to `show` alongside a view that has `actions`.
 *
 * `invoke` runs one - the GAME's own code, so a rename still goes through the
 * game's prompt - and resolves with what the player should be looking at next:
 * usually the same screen with new content, or the next page. `undefined` means
 * the game has taken the screen back; resolve `dismissed` when you see it.
 *
 * An id this engine does not have is a no-op that hands the current view back,
 * so asking for a newer command cannot close the player's screen.
 */
export interface ScreenHost {
  invoke(id: string): Promise<ScreenView | undefined>;
}

/** A screen you have taken. Resolve `dismissed` when the player is done with it. */
export interface ScreenShown {
  readonly dismissed: Promise<void>;
}

/**
 * The consumer boundary for screens: one owner for all of them, offered per screen.
 *
 * Return `undefined` to DECLINE - the game shows it its own way, and that is the
 * expected case, not a failure. Declining is synchronous because a screen's
 * promise means "the player dismissed it", so unlike a menu's answer there is no
 * value left to say "not mine" with. Deciding never needs to be async anyway; you
 * match on `view.id`.
 */
export interface ScreenPresenter {
  /**
   * `host` arrives only where `view.actions` does. A presenter written before
   * actions existed ignores the argument - which is why it is a parameter rather
   * than a field of the view: the view is frozen data, and a way back into the
   * game cannot be.
   */
  show(view: ScreenView, host?: ScreenHost): ScreenShown | undefined;
}
