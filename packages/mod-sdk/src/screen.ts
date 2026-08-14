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
  /** The prose's default colour, for the parts no run speaks for (a break). */
  readonly color?: string;
}

/**
 * Decorative ASCII the game draws as a picture: the tombstone, the winner's
 * crown. Genuinely a rendering, and named so you can swap the whole thing for an
 * image rather than try to read it.
 */
export interface ScreenArtBlock {
  readonly kind: "art";
  readonly key: string;
  readonly lines: readonly string[];
  readonly color?: string;
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
  show(view: ScreenView): ScreenShown | undefined;
}
