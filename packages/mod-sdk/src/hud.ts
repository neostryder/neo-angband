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
 * others stay core's and keep being drawn. That follows the ruling that a screen
 * is COMPOSED of regions rather than covering them.
 *
 * This module contains types only. A folder plugin may `import type` from the
 * SDK while its built JavaScript continues to have no bare engine import.
 */

import type { ScreenRegion, RegionCells } from "./frontend.js";

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
