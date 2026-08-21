/**
 * The public, renderer-neutral data a replacement HUD consumes.
 *
 * The companion to `frontend.ts`: that one describes the MAP, this one describes
 * everything around it - the message line, the vitals, the status line. They are
 * separate seams because they are separately ownable. A mod that wants to draw
 * hit points as a bar has no business taking the dungeon with it, and until this
 * existed that was the only offer on the table.
 *
 * OWNERSHIP IS PER REGION, which is the whole shape of this file. A plugin's
 * `hud()` returns a sink per region name it wants, each one gated by its own
 * `ui:<region>.replace` capability, and it receives ONLY those regions. The
 * others stay core's and keep being drawn. That follows the rule that a screen
 * is COMPOSED of regions rather than covering them.
 *
 * This module contains types only. A folder plugin may `import type` from the
 * SDK while its built JavaScript continues to have no bare engine import.
 */

import type { LiveRegion, ScreenRegion, RegionCells } from "./frontend.js";

/**
 * The parts of the HUD a plugin may own, by role.
 *
 * `map` is deliberately NOT here: the dungeon is `display:replace`'s, through
 * `ModPlugin.frontend`. One region, one seam that owns it.
 */
export type HudRegionName = "messages" | "sidebar" | "status";

/** One coloured run of text inside an entry. */
export interface HudRun {
  readonly text: string;
  /**
   * The engine's own COLOUR_* attribute - the SEMANTIC colour, the one to read
   * if you are mapping the game's palette onto your own.
   *
   * Absent for the message line, and only there: the web message log stores its
   * colour already resolved, so the attribute is genuinely unknown at that
   * point. An absent field is a fact; a fabricated one would be a trap.
   */
  readonly color?: number;
  /** The faithful terminal's resolved colour, as CSS. Its projection, not yours. */
  readonly css: string;
}

/**
 * The numbers behind one entry's text.
 *
 * ONE CONVENTION, and reading it wrong is the only way to misuse this: `current`
 * and `max` TOGETHER mean this field is a PROPORTION, and `current / max` is
 * meaningful. Every other key is a plain named quantity.
 *
 * A field with two numbers that are not a ratio deliberately does not use those
 * names. A stat publishes `use`, `cur` and `max` because 18/118 is an encoding
 * where 118 means 18/100 - `use / max` would report a maxed character as 15%.
 * A drained character's level publishes `level` and `maxLevel` for the same
 * reason. So a generic bar-drawing consumer can safely say "if it has `current`
 * and `max`, draw a bar; otherwise draw the runs" and never draw a wrong one.
 *
 * The keys per field, as core ships them:
 *
 * - `hp`, `sp` - `current`, `max`. The two real bars. `sp` is ABSENT for a class
 *   with no mana, which is not the same fact as having zero.
 * - `health` (the tracked monster) - `current`, `max`, and absent whenever the
 *   bar reads `[----------]`: unseen, dead, or hallucinated. The game does not
 *   know the number there, and a zero would draw as "nearly dead".
 * - `level` - `level`, `maxLevel`.
 * - `exp` - `exp`, `maxExp`, `advance` (what the next level still needs; 0 at
 *   the level cap, where the field shows the total instead).
 * - `gold` - `au`. `ac` - `ac`, `armour`, `bonus`.
 * - `str` / `int` / `wis` / `dex` / `con` - `use`, `cur`, `max`.
 * - `speed` - `speed`, `relative` (`speed - 110`). Published at normal speed
 *   too, where the game's own field is deliberately blank.
 * - `depth` - `depth` (dungeon level, 0 in town), `feet`.
 * - `level_feeling` - `object`, `monster` (indices, not the printed digits),
 *   `squares`, `need`.
 *
 * Absent always means "this display does not know", never zero. Treat an
 * unrecognised key as data you may ignore: fields gain numbers over time, and
 * nothing here is removed without an ABI note.
 */
export type HudValues = Readonly<Record<string, number>>;

/** Where an entry starts, in terminal cells. */
export interface HudPlacement {
  readonly col: number;
  readonly row: number;
}

/**
 * One named piece of the HUD.
 *
 * `key` is the engine's own handler name where there is one - `hp`, `sp`,
 * `depth`, `state`, the `side_handlers[]` / `status_handlers[]` name minus its
 * `prt_` prefix - so a replacement matches on the field rather than on the text
 * printed beside it. Match on `key`; anything you cannot match, draw as text.
 */
export interface HudEntry {
  readonly key: string;
  readonly runs: readonly HudRun[];
  readonly screen: HudPlacement;
  /**
   * The numbers `runs` was formatted from, where this entry has any.
   *
   * `runs` is the game's sentence about the field; this is what the sentence is
   * about. Draw a health bar from `values.current / values.max`, never from
   * parsing `"HP   20/  20"` - that string is a rendering, and it changes when
   * somebody loads a pref file or plays the game in another language.
   */
  readonly values?: HudValues;
}

export interface HudSection {
  readonly name: HudRegionName;
  readonly entries: readonly HudEntry[];
  /**
   * The rectangle the faithful terminal draws this section inside. USUALLY the
   * same as `region.cells`, and not always: the targeting loop's '?' help takes
   * as many rows as it needs above the status row, which is upstream's
   * behaviour. The clip is what core would actually paint.
   */
  readonly clip: RegionCells;
  /** The published region this section plays the role of, when there is one. */
  readonly region?: ScreenRegion;
}

/**
 * One frame of everything the game draws that is not the map.
 *
 * A section sink receives its own section AND the whole frame, because context
 * changes what a section means: `targeting` says the message row is a look
 * description rather than a message, and `layout` says whether the vitals are a
 * column, a header, or turned off entirely.
 *
 * `sidebar` is absent under the "none" layout because the player turned the
 * vitals off - the same "missing means genuinely absent" rule `ScreenRegions`
 * follows, and for the same reason: that is a fact, not an empty section.
 */
export interface HudFrame {
  readonly layout: "left" | "top" | "none";
  /** True while the '*' / 'l' targeting loop owns the message and status rows. */
  readonly targeting: boolean;
  readonly messages: HudSection;
  readonly sidebar?: HudSection;
  readonly status: HudSection;
  /**
   * Everything on screen, bottom to top - the same live stack
   * `WorldFrame.stack` carries, and for the same reason.
   *
   * A region you own is covered by exactly the things the map is. If you draw
   * your section outside the terminal - a DOM panel, your own canvas - find the
   * entry whose `id` is your section's `region.name` and hide when anything
   * after it overlaps its `cells`. ABSENT IS NOT EMPTY, as on the world frame.
   */
  readonly stack?: readonly LiveRegion[];
}

/**
 * The consumer of ONE region. You get the section you own and the frame it came
 * from; you do not get to draw the sections you do not own.
 *
 * Called on every repaint of the HUD. The section and frame are a frozen,
 * structurally owned snapshot, so retaining one for an animation is safe.
 */
export interface HudSectionSink {
  present(section: HudSection, frame: HudFrame): void;
}

/**
 * What `ModPlugin.hud` returns: a sink for each region it is taking.
 *
 * Omit a region to leave it with the game. Returning `{}` or `undefined` is a
 * decline, and is the right answer on a host you cannot draw on.
 */
export type HudOwnership = {
  readonly [K in HudRegionName]?: HudSectionSink;
};
