/**
 * Renderer-neutral description of the live HUD: the message line, the vitals,
 * and the status line.
 *
 * WHY THIS EXISTS. #234 gave the map a frame and a sink, so a mod can replace
 * the world. Everything drawn AROUND the map stayed where it always was -
 * `renderSidebar`, `renderCompactVitals` and `renderStatusLine` are closures in
 * main.ts's module body, reachable only by booting the whole game against a
 * canvas. Core's own display model was never the problem: `sidebarModel` and
 * `statusLineModel` have produced the real fields for a year. The problem is
 * that the only thing that could reach them flattened them straight into
 * `term.print` calls, so a mod asking "what are the player's hit points, and
 * where does this layout put them" had nowhere to ask. That is MOD_REACH gap 21,
 * and this module is the answer's first half: the HUD as data.
 *
 * THE MIRROR OF WorldFrame IS DELIBERATE. A world cell carries both its
 * semantic layers and the faithful terminal's resolved `visual`, so one frame
 * serves an isometric renderer and the glyph grid. A HUD entry does the same:
 * `key` and `runs[].color` are the engine's own words (`hp`, `depth`,
 * `COLOUR_L_GREEN`), while `screen` and `runs[].css` are where the faithful
 * terminal puts it and what colour it resolves to. A replacement reads the
 * first pair and ignores the second; the glyph painter below reads the second
 * and ignores the first.
 *
 * THE SECTION NAMES ARE ROLES, exactly as `regions.ts`'s are. `sidebar` is "the
 * vitals" - a 13-column column in the Left layout, a one-line header in Top,
 * and absent in None. A consumer asks for the role and gets whatever this
 * layout does with it.
 *
 * A SECTION'S `clip` IS NOT ALWAYS ITS REGION. It usually is, and
 * `hud-view.test.ts` asserts that for every ordinary frame - core drawing
 * outside the rectangles it publishes is the bug this pins. The exception is
 * real rather than sloppy: while the '*' / 'l' targeting loop owns the screen,
 * its '?' help text takes as many rows as it needs above the status row, which
 * is upstream's behaviour and something a replacement has to be told rather
 * than have hidden from it.
 *
 * PURE, and takes its models as arguments. Nothing here reads a terminal, a
 * game state or the colour table, so the whole HUD can be built and painted by
 * a test with no canvas - which is the point, since the thing it replaces
 * could not be.
 */

import type { GridSurface } from "./term";
import type { LiveRegion, RegionCells, ScreenRegion, ScreenRegions } from "./regions";

/** The parts of the HUD that have a name. Every one of them is core's today. */
export type HudSectionName = "messages" | "sidebar" | "status";

/** In paint order. Core's sections never overlap, so this is presentation, not
 * a compositing rule - the ordering that will matter is #253's overlap work. */
export const HUD_SECTION_NAMES: readonly HudSectionName[] = ["messages", "sidebar", "status"];

/** One coloured run of text. */
export interface HudRun {
  readonly text: string;
  /**
   * The engine's own COLOUR_* attribute (core's `color.ts`).
   *
   * Absent for the message line, and only there: the web message log stores the
   * colour it was pushed with already resolved to CSS (`messages.ts`), so the
   * attribute is genuinely not known at this point. Fabricating one by reversing
   * the palette would hand a consumer a number that is right until somebody
   * loads a pref file; an absent field is a fact, a wrong number is a trap.
   */
  readonly color?: number;
  /** The faithful terminal's resolved colour, as a CSS string. */
  readonly css: string;
}

/**
 * The numbers a HUD entry's text was formatted from, where it has any.
 *
 * `runs` is the sentence; this is what the sentence is about. `"HP   20/  20"`
 * is a string a replacement has to parse - and parsing it is how a mod breaks
 * the day someone loads a pref file or plays in another language - so the same
 * entry carries `{ current: 20, max: 20 }` beside it.
 *
 * ONE CONVENTION, core's own (`DisplayValues`, display.ts): `current` and `max`
 * TOGETHER mean this is a proportion and `current / max` is meaningful. Any
 * other key is a plain named quantity. A field with two numbers that are not a
 * ratio - a stat's 18/118 encoding, a drained character's level - deliberately
 * does not use those two names, so a bar-drawing consumer finds no proportion
 * and correctly declines to draw one.
 *
 * Absent means "this display does not know", never zero. The monster health bar
 * publishes nothing while it reads `[----------]`.
 */
export type HudValues = Readonly<Record<string, number>>;

/** Where one entry starts, in terminal cells. */
export interface HudPlacement {
  readonly col: number;
  readonly row: number;
}

/**
 * One named piece of the HUD: a sidebar field, a status indicator, the message
 * line. `key` is the engine's handler name where there is one - the
 * `side_handlers[]` / `status_handlers[]` name minus its `prt_` prefix - so a
 * consumer matches on `hp` rather than on the text beside it.
 */
export interface HudEntry {
  readonly key: string;
  readonly runs: readonly HudRun[];
  readonly screen: HudPlacement;
  /** The numbers behind `runs`, where this entry has any. */
  readonly values?: HudValues;
}

export interface HudSection {
  readonly name: HudSectionName;
  readonly entries: readonly HudEntry[];
  /**
   * The rectangle the faithful terminal will draw this section inside. Its last
   * column is reserved and never drawn into, which is upstream's rule rather
   * than a rounding here (SCREEN_WID, ui-term.h) and is why the status line
   * stops one short of the screen.
   */
  readonly clip: RegionCells;
  /** The published region this section plays the role of, when there is one. */
  readonly region?: ScreenRegion;
}

/**
 * One frame of everything core draws that is not the map.
 *
 * `sidebar` is absent under the None layout because the player turned the
 * vitals furniture off - the same "missing means genuinely absent" rule
 * `ScreenRegions` follows, and for the same reason: a consumer needs that fact
 * rather than an empty section it has to distinguish from a quiet one.
 */
export interface HudFrame {
  readonly layout: "left" | "top" | "none";
  /**
   * True while the '*' / 'l' targeting loop owns the message and status rows.
   * A replacement HUD needs to know it is looking at a look-description and a
   * help overlay rather than at the ordinary message and status lines.
   */
  readonly targeting: boolean;
  readonly messages: HudSection;
  readonly sidebar?: HudSection;
  readonly status: HudSection;
  /**
   * Everything on screen, bottom to top - the same live stack `WorldFrame.stack`
   * carries, and carried here for the same reason (#261).
   *
   * A REGION OWNER IS COVERED BY EXACTLY THE SAME THINGS THE MAP IS. A mod that
   * has taken `sidebar` and draws it as a DOM panel has the map's problem in
   * miniature: a screen opens, core repaints the terminal underneath, and no HUD
   * frame is produced to tell it. `occludersOf(stack, "sidebar")` is the
   * question, and the section's own `region.name` is the id to ask it with,
   * because `baseRegionStack` puts the four base tiles in under their names.
   *
   * Optional and ABSENT-IS-NOT-EMPTY, exactly as on the world frame.
   */
  readonly stack?: readonly LiveRegion[];
}

/** The one consumer boundary for a produced HUD frame. */
export interface HudFrameSink {
  present(frame: HudFrame): void;
}

/**
 * The consumer boundary for ONE region.
 *
 * This is the unit ownership is sold in (`hud-runtime.ts`): a mod that draws hit
 * points as a bar takes `sidebar` and leaves the message line alone. It gets the
 * frame as well as its own section because context changes what a section means -
 * `targeting` says the message row is a look description, `layout` says whether
 * the vitals are a column, a header, or turned off. The section it is handed is
 * the same object as the matching field of that frame, so `section ===
 * frame.sidebar` holds and a consumer can use either.
 */
export interface HudSectionSink {
  present(section: HudSection, frame: HudFrame): void;
}

/**
 * What `ModPlugin.hud` returns: a sink for each region it is taking.
 *
 * Omit a region to leave it with the game. `{}` and `undefined` are both a
 * decline, which is the right answer on a host you cannot draw on - and a much
 * better one than throwing, which costs the mod its regions AND is reported as
 * its fault when the honest answer is "not here".
 */
export type HudOwnership = {
  readonly [K in HudSectionName]?: HudSectionSink;
};

/** One named model as the engine produces it, its colours already resolved. */
export interface HudModel {
  readonly key: string;
  readonly runs: readonly HudRun[];
  readonly values?: HudValues;
}

/**
 * The '*' / 'l' loop's takeover of the message and status rows, which is
 * upstream's (target_set_interactive owns both while it runs).
 */
export interface HudTargeting {
  /** The look description; it takes the message row. */
  readonly desc: string;
  readonly descCss: string;
  /** The '?' help text while it is up, or null for the prompt that offers it. */
  readonly helpLines: readonly string[] | null;
  readonly helpCss: string;
  readonly promptCss: string;
}

/** The prompt the status row carries while targeting and the help is down. */
export const TARGET_HELP_PROMPT = "Press '?' for help.";

/**
 * Everything `buildHudFrame` needs, as values.
 *
 * Deliberately not a game state, a terminal or a colour table: the producer is
 * pure so the whole HUD can be built and inspected by a test with no canvas,
 * which is exactly what the three closures this replaces could not do. main.ts
 * is the adapter that fills this in from the live game.
 */
export interface HudFrameParams {
  readonly layout: "left" | "top" | "none";
  readonly cols: number;
  readonly rows: number;
  /** The Left layout's column width (SIDEBAR_W). Ignored by the other two. */
  readonly sidebarWidth: number;
  /** Where the map - and so the status line - starts. */
  readonly mapOriginX: number;
  readonly mapCols: number;
  /** `sidebarModel`'s fields, in table order. */
  readonly vitals: readonly HudModel[];
  /** `sidebarLayout`'s answer for this height: which fields survive, and where. */
  readonly placements: readonly { readonly key: string; readonly row: number }[];
  /** The keys the compact header shows, in the order it shows them. */
  readonly compactKeys: readonly string[];
  /** `statusLineModel`'s indicators, in table order. */
  readonly indicators: readonly HudModel[];
  readonly message: { readonly text: string; readonly css: string };
  readonly targeting?: HudTargeting;
  readonly regions: ScreenRegions;
  /** The live region stack for this frame, when the host has one to publish. */
  readonly stack?: readonly LiveRegion[];
}

/**
 * The vitals, in whichever shape this layout gives them.
 *
 * Left is the classic 13-column column, and WHERE each field goes is
 * `placements` - core's `sidebarLayout`, the port of update_sidebar (L844),
 * which culls by priority at short heights and counts the four blank grouping
 * rows of side_handlers[]. That is what produces the classic gaps. It starts at
 * row 1 (ui-display.c:866 `for (i = 0, row = 1; ...)`), leaving row 0 as the
 * full-width message line and aligning the first field with the map's top row
 * (ROW_MAP = row_top_map[SIDEBAR_LEFT] = 1, ui-term.c).
 *
 * Top is a one-line header of selected fields flowed left to right. None has no
 * vitals at all and returns undefined rather than an empty section: the player
 * turned the furniture off, which is a fact a consumer needs rather than one it
 * has to infer from a section that happens to be quiet.
 *
 * A placement whose key is not in the model is dropped. That cannot happen for
 * core's own table, and can for a mod-supplied one.
 */
export function hudSidebarSection(p: HudFrameParams): HudSection | undefined {
  if (p.layout === "none") return undefined;
  const byKey = new Map(p.vitals.map((model) => [model.key, model]));
  const region = p.regions.sidebar ? { region: p.regions.sidebar } : {};
  if (p.layout === "top") {
    return {
      name: "sidebar",
      entries: flowEntries(
        p.compactKeys.flatMap((key) => byKey.get(key) ?? []),
        { col: 0, row: 1 },
        1,
      ),
      clip: { col: 0, row: 1, cols: p.cols, rows: 1 },
      ...region,
    };
  }
  return {
    name: "sidebar",
    entries: p.placements.flatMap(({ key, row }) => {
      const model = byKey.get(key);
      return model ? [hudEntry(model, { col: 0, row })] : [];
    }),
    clip: { col: 0, row: 1, cols: p.sidebarWidth, rows: p.rows - 1 },
    ...region,
  };
}

/**
 * The bottom status line from `statusLineModel` (ui-display.c): the active
 * indicators (level feeling, timed effects, DTrap, terrain, ...) laid left to
 * right in status_handlers[] order. Segments render back-to-back with NO extra
 * gap, so this flows with gap 0: each segment's text already bakes exactly one
 * trailing gap column, so its width equals the reference handler's return value
 * (update_statusline_aux advances col by that width). An idle prt_state
 * reserves one blank column, which `statusLineModel` emits as a single-space run.
 *
 * While the targeting loop runs it owns this row instead. Its help text is the
 * one place core draws a section TALLER than the region it plays the role of,
 * so the clip says so rather than silently cropping it.
 *
 * update_statusline (ui-display.c:1316) is the event handler that picks the row;
 * here it is always the terminal's last. KNOWN DIVERGENCE, recorded not fixed by
 * W1-CITED (parity/phase3-2026-07-25/findings/W1-CITED.md): upstream moves the
 * status line to row 3 when Term->sidebar_mode is SIDEBAR_TOP.
 */
export function hudStatusSection(p: HudFrameParams): HudSection {
  const col = p.mapOriginX;
  const cols = p.mapCols;
  const region = p.regions.status ? { region: p.regions.status } : {};
  const help = p.targeting?.helpLines;
  if (help) {
    return {
      name: "status",
      entries: help.map((line, i) => ({
        key: `help:${i}`,
        runs: [{ text: line, css: p.targeting!.helpCss }],
        screen: { col, row: p.rows - help.length + i },
      })),
      clip: { col, row: p.rows - help.length, cols, rows: help.length },
      ...region,
    };
  }
  const clip = { col, row: p.rows - 1, cols, rows: 1 };
  const entries: HudEntry[] = p.targeting
    ? [
        {
          key: "help",
          runs: [{ text: TARGET_HELP_PROMPT, css: p.targeting.promptCss }],
          screen: { col, row: p.rows - 1 },
        },
      ]
    : flowEntries(p.indicators, { col, row: p.rows - 1 }, 0);
  return { name: "status", entries, clip, ...region };
}

/**
 * The message line owns the full width of row 0 from column 0 (c_prt at 0,0),
 * above the sidebar (which starts at row 1) - it is NOT indented to the map.
 * During the targeting loop the look description takes it, which is why the
 * entry is keyed `look` there: a consumer rendering messages into a scrolling
 * log must not file a cursor description as one.
 */
export function hudMessagesSection(p: HudFrameParams): HudSection {
  const runs: HudRun[] = p.targeting
    ? [{ text: p.targeting.desc, css: p.targeting.descCss }]
    : [{ text: p.message.text, css: p.message.css }];
  return {
    name: "messages",
    entries: [{ key: p.targeting ? "look" : "message", runs, screen: { col: 0, row: 0 } }],
    clip: { col: 0, row: 0, cols: p.cols, rows: 1 },
    ...(p.regions.messages ? { region: p.regions.messages } : {}),
  };
}

/** Everything core draws that is not the map, for one frame. */
export function buildHudFrame(p: HudFrameParams): HudFrame {
  const sidebar = hudSidebarSection(p);
  return {
    layout: p.layout,
    targeting: p.targeting !== undefined,
    messages: hudMessagesSection(p),
    ...(sidebar ? { sidebar } : {}),
    status: hudStatusSection(p),
    ...(p.stack ? { stack: p.stack } : {}),
  };
}

/** The frame's sections, in paint order, skipping the ones this layout has not. */
export function hudSections(frame: HudFrame): readonly HudSection[] {
  return [frame.messages, ...(frame.sidebar ? [frame.sidebar] : []), frame.status];
}

/**
 * Place entries left to right from a starting column, advancing by the width of
 * what was drawn plus `gap`.
 *
 * The gap is charged for an entry with NO runs too, and that is not an
 * oversight: the compact vitals row reserves its separator for a field that is
 * currently blank (a warrior's spell points), so the fields after it do not
 * slide left the moment one goes quiet. The status line passes gap 0 because
 * each of its handlers already bakes its single trailing column into its own
 * text (`statusLineModel`, ui-display.c update_statusline_aux).
 */
export function flowEntries(
  models: readonly HudModel[],
  start: HudPlacement,
  gap: number,
): HudEntry[] {
  const out: HudEntry[] = [];
  let col = start.col;
  for (const model of models) {
    out.push(hudEntry(model, { col, row: start.row }));
    for (const run of model.runs) col += run.text.length;
    col += gap;
  }
  return out;
}

/**
 * One model placed at one spot. The single place a model becomes an entry, so a
 * field the engine publishes numbers for cannot silently lose them on the way to
 * a consumer - which is exactly what happened to the text for a year.
 */
function hudEntry(model: HudModel, screen: HudPlacement): HudEntry {
  return {
    key: model.key,
    runs: model.runs,
    screen,
    ...(model.values ? { values: model.values } : {}),
  };
}

/**
 * The default terminal projection of one section.
 *
 * This is the exact clipping the four hand-written draw sites did, in one
 * place: an entry outside the section's rows is skipped (a mod-supplied
 * `side_handlers[]` with a from-bottom priority can compute a row off the
 * screen), and a run is truncated at the section's reserved last column.
 */
export function paintHudSection(
  surface: Pick<GridSurface, "print">,
  section: HudSection,
): void {
  const { col, row, cols, rows } = section.clip;
  const bound = col + cols - 1;
  for (const entry of section.entries) {
    if (entry.screen.row < row || entry.screen.row >= row + rows) continue;
    let x = entry.screen.col;
    for (const run of entry.runs) {
      if (x >= bound) break;
      surface.print(x, entry.screen.row, run.text.slice(0, bound - x), run.css);
      x += run.text.length;
    }
  }
}

/** The default terminal projection of a whole frame. */
export function paintHudFrame(surface: Pick<GridSurface, "print">, frame: HudFrame): void {
  for (const section of hudSections(frame)) paintHudSection(surface, section);
}

/** The unmodded renderer's sink; it is an ordinary consumer of the live frame. */
export function glyphHudFrameSink(surface: Pick<GridSurface, "print">): HudFrameSink {
  return { present: (frame) => paintHudFrame(surface, frame) };
}

/**
 * The unmodded renderer as a REGION owner - candidate zero's sink, and the one a
 * faulting replacement hands its region back to.
 *
 * It ignores the frame argument, because the terminal's projection of a section
 * needs nothing but the section. A replacement generally does need it, which is
 * why the argument is in the interface rather than shaped around this one.
 */
export function glyphHudSectionSink(surface: Pick<GridSurface, "print">): HudSectionSink {
  return { present: (section) => paintHudSection(surface, section) };
}

/**
 * Make a consumer-owned snapshot of one live frame.
 *
 * The mirror of `snapshotWorldFrame`, and it exists for the same reason: a
 * plugin may retain a frame to animate from, so what crosses the boundary must
 * not be an object the next repaint mutates. Everything here is plain data -
 * strings, numbers, rectangles - so this is a structural copy with no opaque
 * values to preserve, unlike the world frame's render assets.
 *
 * The default glyph sink keeps consuming the live frame directly; only the
 * cross-plugin boundary pays for this.
 */
export function snapshotHudFrame(frame: HudFrame): HudFrame {
  const copyRun = (run: HudRun): HudRun =>
    Object.freeze(run.color === undefined
      ? { text: run.text, css: run.css }
      : { text: run.text, color: run.color, css: run.css });
  const copyCells = (cells: RegionCells): RegionCells =>
    Object.freeze({ col: cells.col, row: cells.row, cols: cells.cols, rows: cells.rows });
  const copySection = (section: HudSection): HudSection =>
    Object.freeze({
      name: section.name,
      entries: Object.freeze(section.entries.map((entry) =>
        Object.freeze({
          key: entry.key,
          runs: Object.freeze(entry.runs.map(copyRun)),
          screen: Object.freeze({ col: entry.screen.col, row: entry.screen.row }),
          ...(entry.values ? { values: Object.freeze({ ...entry.values }) } : {}),
        }))),
      clip: copyCells(section.clip),
      ...(section.region
        ? {
            region: Object.freeze({
              name: section.region.name,
              cells: copyCells(section.region.cells),
              ...(section.region.pixels ? { pixels: Object.freeze({ ...section.region.pixels }) } : {}),
            }),
          }
        : {}),
    });
  /**
   * The stack, copied region by region.
   *
   * BY HAND like everything else in this function, and that is the risk rather
   * than the design: a hand-enumerated copy silently drops a field added to the
   * type, and the live frame would keep carrying it while the snapshot a mod
   * receives quietly did not. Every test that inspects the LIVE frame would go
   * on passing. `hud-view.test.ts` therefore asserts this side, and
   * `sample-blueprint.node.test.ts` asserts the world frame's through the
   * mod-facing sink for the same reason.
   */
  const copyStack = (stack: readonly LiveRegion[]): readonly LiveRegion[] =>
    Object.freeze(stack.map((region) =>
      Object.freeze({
        id: region.id,
        layer: region.layer,
        cells: copyCells(region.cells),
        ...(region.pixels ? { pixels: Object.freeze({ ...region.pixels }) } : {}),
      })));
  const sidebar = frame.sidebar ? copySection(frame.sidebar) : undefined;
  return Object.freeze({
    layout: frame.layout,
    targeting: frame.targeting,
    messages: copySection(frame.messages),
    ...(sidebar ? { sidebar } : {}),
    status: copySection(frame.status),
    ...(frame.stack === undefined ? {} : { stack: copyStack(frame.stack) }),
  });
}

/**
 * The live production path: hand one built frame to the sink and return it, so
 * main.ts's producer and the consumer boundary are a single call rather than
 * two statements that can drift apart. The mirror of `renderWorldFrame`.
 */
export function renderHudFrame(frame: HudFrame, sink: HudFrameSink): HudFrame {
  sink.present(frame);
  return frame;
}
