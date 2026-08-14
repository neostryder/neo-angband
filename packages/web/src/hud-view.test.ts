/**
 * The HUD, driven.
 *
 * These are the tests that could not be written before #253. The vitals, the
 * message line and the status line were three closures inside main.ts, and
 * main.ts boots a whole game against a canvas on import - so every rule they
 * carried (which fields survive a short screen, where the compact header's
 * separators go, what the targeting loop takes over, how far a run is allowed
 * to reach) was only ever checked by a human looking at a screenshot, or by a
 * source-text guard that proves a call is written rather than that it is right.
 *
 * The interesting one is the last describe: core has published a table of screen
 * regions since #234, and until now nothing could compare it against where core
 * actually draws its own furniture. A section carries the region it plays the
 * role of, so that comparison is now an assertion instead of an argument.
 */

import { describe, expect, it } from "vitest";
import {
  TARGET_HELP_PROMPT,
  buildHudFrame,
  flowEntries,
  hudSections,
  paintHudFrame,
  paintHudSection,
  snapshotHudFrame,
  type HudFrameParams,
  type HudModel,
  type HudSection,
} from "./hud-view";
import { screenRegions, type LiveRegion } from "./regions";

/** A surface that records what was printed, in order. */
function recorder(): {
  calls: { x: number; y: number; text: string; fg: string }[];
  print(x: number, y: number, text: string, fg: string): void;
} {
  const calls: { x: number; y: number; text: string; fg: string }[] = [];
  return { calls, print: (x, y, text, fg) => calls.push({ x, y, text, fg }) };
}

/** The text a section paints on one row, with gaps filled in. */
function rowText(
  calls: readonly { x: number; y: number; text: string }[],
  row: number,
  width: number,
): string {
  const cells = Array.from({ length: width }, () => " ");
  for (const call of calls) {
    if (call.y !== row) continue;
    for (let i = 0; i < call.text.length; i++) {
      const at = call.x + i;
      if (at >= 0 && at < width) cells[at] = call.text[i]!;
    }
  }
  return cells.join("").replace(/\s+$/u, "");
}

const WHITE = "#ffffff";
function model(key: string, ...texts: string[]): HudModel {
  return { key, runs: texts.map((text) => ({ text, css: WHITE })) };
}

/** A frame's worth of parameters, with every field overridable. */
function params(over: Partial<HudFrameParams> = {}): HudFrameParams {
  const cols = over.cols ?? 80;
  const rows = over.rows ?? 24;
  const layout = over.layout ?? "left";
  const sidebarWidth = over.sidebarWidth ?? 13;
  const mapOriginX = over.mapOriginX ?? (layout === "left" ? sidebarWidth : 0);
  const mapTop = layout === "top" ? 2 : 1;
  return {
    layout,
    cols,
    rows,
    sidebarWidth,
    mapOriginX,
    mapCols: cols - mapOriginX - 1,
    vitals: [model("hp", "HP 34/34"), model("sp", ""), model("depth", "50 feet")],
    placements: [
      { key: "hp", row: 1 },
      { key: "sp", row: 2 },
      { key: "depth", row: rows - 1 },
    ],
    compactKeys: ["hp", "sp", "depth"],
    indicators: [model("state", " "), model("hunger", "Fed ")],
    message: { text: "You hit the kobold.", css: WHITE },
    regions: screenRegions({
      cols,
      rows,
      sidebar: layout,
      sidebarWidth,
      mapOriginX,
      mapTop,
      mapCols: cols - mapOriginX - 1,
      mapRows: rows - mapTop - 1,
    }),
    ...over,
  };
}

describe("laying entries out", () => {
  it("charges the separator for a field that is currently blank", () => {
    /* The compact vitals row reserves its gap for a field with nothing to say -
     * a warrior's spell points. Skipping the gap instead would slide every
     * field after it one column left the moment SP went quiet, so the header
     * would twitch sideways as the character changed class-relevant state. */
    const entries = flowEntries(
      [model("hp", "HP 34/34"), model("sp", ""), model("depth", "50 feet")],
      { col: 0, row: 1 },
      1,
    );
    expect(entries.map((e) => e.screen.col)).toEqual([0, 9, 10]);
    expect(entries.every((e) => e.screen.row === 1)).toBe(true);
  });

  it("flows from wherever it is told to start, not from column zero", () => {
    /* The status line starts at the map's own column, not at the screen's. */
    const entries = flowEntries([model("a", "ab"), model("b", "cd")], { col: 13, row: 23 }, 0);
    expect(entries.map((e) => e.screen.col)).toEqual([13, 15]);
  });
});

describe("painting a section", () => {
  const section = (over: Partial<HudSection> = {}): HudSection => ({
    name: "sidebar",
    entries: [{ key: "hp", runs: [{ text: "HP 34/34", css: WHITE }], screen: { col: 0, row: 1 } }],
    clip: { col: 0, row: 1, cols: 13, rows: 23 },
    ...over,
  });

  it("never draws in the section's last column", () => {
    /* SCREEN_WID reserves the rightmost column (ui-term.h, `wid - COL_MAP - 1`).
     * A 13-wide sidebar therefore has 12 usable columns, which is why the
     * classic column truncates a long field one character early rather than
     * running flush to the map. */
    const surface = recorder();
    paintHudSection(
      surface,
      section({
        entries: [
          { key: "race", runs: [{ text: "0123456789abcdef", css: WHITE }], screen: { col: 0, row: 1 } },
        ],
      }),
    );
    expect(surface.calls).toEqual([{ x: 0, y: 1, text: "0123456789ab", fg: WHITE }]);
  });

  it("keeps clipping across the runs of one entry, not per run", () => {
    /* A field is many coloured runs (`Str: 18/70` is a label and a value in two
     * colours). The budget belongs to the field: the second run has to know how
     * far the first one already got, or a two-run field overruns a one-run
     * field of the same width. */
    const surface = recorder();
    paintHudSection(
      surface,
      section({
        entries: [
          {
            key: "str",
            runs: [
              { text: "Str: ", css: WHITE },
              { text: "18/70xxxx", css: "#00ff00" },
            ],
            screen: { col: 0, row: 1 },
          },
        ],
      }),
    );
    /* 12 columns, not 13: the field spends 5 on the label and the value gets
     * the remaining 7, so the pair together stops exactly where a single 12-
     * character run would have. */
    expect(rowText(surface.calls, 1, 20)).toBe("Str: 18/70xx");
    expect(surface.calls).toHaveLength(2);
  });

  it("drops an entry placed off the section's rows", () => {
    /* sidebarLayout is given the height, but a from-bottom priority on a table
     * a MOD supplied can still compute a row outside it. Nothing else bounds
     * this: the terminal's own put() would silently drop it, and a section
     * whose entries land outside its rectangle is exactly the bug the region
     * table exists to prevent. */
    const surface = recorder();
    paintHudSection(
      surface,
      section({
        entries: [
          { key: "a", runs: [{ text: "in", css: WHITE }], screen: { col: 0, row: 1 } },
          { key: "b", runs: [{ text: "above", css: WHITE }], screen: { col: 0, row: 0 } },
          { key: "c", runs: [{ text: "below", css: WHITE }], screen: { col: 0, row: 24 } },
        ],
      }),
    );
    expect(surface.calls.map((c) => c.text)).toEqual(["in"]);
  });

  it("draws nothing for an entry with no runs", () => {
    const surface = recorder();
    paintHudSection(surface, section({ entries: [{ key: "sp", runs: [], screen: { col: 0, row: 1 } }] }));
    expect(surface.calls).toEqual([]);
  });
});

describe("the frame core builds", () => {
  it("places the left sidebar with the layout it is given, top to bottom", () => {
    const frame = buildHudFrame(params({ layout: "left" }));
    expect(frame.sidebar?.entries.map((e) => [e.key, e.screen.row])).toEqual([
      ["hp", 1],
      ["sp", 2],
      ["depth", 23],
    ]);
    expect(frame.sidebar?.clip).toEqual({ col: 0, row: 1, cols: 13, rows: 23 });
  });

  it("drops a placement the model has no field for", () => {
    /* Core's own table cannot produce this. A mod-supplied side_handlers[] can,
     * and the alternative to dropping it is an entry with undefined runs that
     * every consumer has to guard. */
    const frame = buildHudFrame(
      params({ placements: [{ key: "hp", row: 1 }, { key: "invented-by-a-mod", row: 2 }] }),
    );
    expect(frame.sidebar?.entries.map((e) => e.key)).toEqual(["hp"]);
  });

  it("gives the compact layout a one-line header on row 1", () => {
    const frame = buildHudFrame(params({ layout: "top" }));
    expect(frame.sidebar?.clip).toEqual({ col: 0, row: 1, cols: 80, rows: 1 });
    expect(frame.sidebar?.entries.every((e) => e.screen.row === 1)).toBe(true);
  });

  it("has no sidebar at all when the player turned the vitals off", () => {
    /* Absent, not empty. A consumer that has to tell "there is no sidebar in
     * this layout" from "the sidebar happens to have nothing to say" would have
     * to inspect every entry to find out, and would get it wrong the first time
     * a real layout produced an all-blank column. */
    const frame = buildHudFrame(params({ layout: "none" }));
    expect(frame.sidebar).toBeUndefined();
    expect(frame.messages).toBeDefined();
    expect(frame.status).toBeDefined();
    expect(hudSections(frame)).toHaveLength(2);
  });

  it("puts the message line across the full width of row 0", () => {
    /* Not indented to the map: row 0 starts at column 0 and runs over the
     * sidebar, which begins at row 1 (c_prt at 0,0). */
    const frame = buildHudFrame(params());
    expect(frame.messages.clip).toEqual({ col: 0, row: 0, cols: 80, rows: 1 });
    expect(frame.messages.entries[0]?.key).toBe("message");
  });

  it("flows the status indicators from the map's column with no added gap", () => {
    /* Each handler already bakes its single trailing column into its own text
     * (update_statusline_aux advances col by the handler's return value), so a
     * gap here would double every separator on the status line. */
    const frame = buildHudFrame(params());
    expect(frame.status.entries.map((e) => e.screen.col)).toEqual([13, 14]);
    expect(frame.status.entries.every((e) => e.screen.row === 23)).toBe(true);
  });
});

describe("while the targeting loop owns the screen", () => {
  const targeting = {
    desc: "a kobold [r,t,p,g]",
    descCss: "#ffd700",
    helpLines: null,
    helpCss: "#cccccc",
    promptCss: "#888888",
  };

  it("files the look description as a look, not as a message", () => {
    /* A replacement that renders `messages` into a scrolling log must not file
     * a cursor description in it: the description changes on every keypress of
     * the loop, so a log would fill with dozens of them per look. */
    const frame = buildHudFrame(params({ targeting }));
    expect(frame.targeting).toBe(true);
    expect(frame.messages.entries[0]?.key).toBe("look");
    expect(frame.messages.entries[0]?.runs[0]?.text).toBe("a kobold [r,t,p,g]");
  });

  it("offers the help prompt on the status row", () => {
    const frame = buildHudFrame(params({ targeting }));
    expect(frame.status.entries).toHaveLength(1);
    expect(frame.status.entries[0]?.runs[0]?.text).toBe(TARGET_HELP_PROMPT);
    expect(frame.status.clip.rows).toBe(1);
  });

  it("grows the status section upward for the help text rather than cropping it", () => {
    /* The one place core draws a section TALLER than the region it plays the
     * role of. Clipping it to the status region's single row would have shown
     * the last line of the help and nothing else - and it would have looked
     * like a rendering bug rather than a region that was too small. */
    const helpLines = ["Press 't' to target.", "Press 'r' to recall.", "ESC to exit."];
    const frame = buildHudFrame(params({ targeting: { ...targeting, helpLines } }));
    expect(frame.status.clip).toEqual({ col: 13, row: 21, cols: 66, rows: 3 });
    expect(frame.status.entries.map((e) => e.screen.row)).toEqual([21, 22, 23]);

    const surface = recorder();
    paintHudFrame(surface, frame);
    expect(rowText(surface.calls, 21, 80)).toBe(" ".repeat(13) + "Press 't' to target.");
    /* The bottom row carries the sidebar's own last field beside the help: the
     * Left column runs down to row 23 in the columns the status line never
     * reaches, which is why `status` starts at column 13 rather than 0. */
    expect(rowText(surface.calls, 23, 80)).toBe("50 feet      ESC to exit.");
  });
});

describe("core draws its furniture inside the regions core publishes", () => {
  /* THE JOIN. #234 published a table of named rectangles so a front end could
   * find the map's pixels, and its own test proves that table is internally
   * consistent. What no test could reach was whether core's HUD agrees with it,
   * because the drawing lived in three closures behind a canvas boot. This is
   * that comparison, at every layout and a range of sizes - and it is the
   * assertion that will fail first if somebody moves the status line without
   * moving `status`. */
  const sizes = [
    [80, 24],
    [100, 40],
    [46, 20], // narrow enough that main.ts falls back from Left to Top
    [80, 12], // short enough that sidebarLayout starts culling rows
  ] as const;

  for (const layout of ["left", "top", "none"] as const) {
    for (const [cols, rows] of sizes) {
      it(`agrees in the ${layout} layout at ${cols}x${rows}`, () => {
        const frame = buildHudFrame(params({ layout, cols, rows }));
        for (const section of hudSections(frame)) {
          expect(section.region, `${section.name} has no region`).toBeDefined();
          expect(section.clip, `${section.name}'s clip is not its region`).toEqual(
            section.region!.cells,
          );
        }
      });
    }
  }

  it("gives no two sections the same cell", () => {
    /* True of every core layout today and NOT a global invariant - the decision
     * on gap 21 is that a screen is composed of regions that overlap and are
     * ordered, so a mod's floating window sits over the map on purpose. This
     * pins core's own furniture, which has never overlapped and would be a bug
     * if it started: two sections writing one cell means whichever paints last
     * wins, silently. */
    for (const layout of ["left", "top", "none"] as const) {
      const frame = buildHudFrame(params({ layout }));
      const owner = new Map<string, string>();
      for (const section of hudSections(frame)) {
        const { col, row, cols, rows } = section.clip;
        for (let r = row; r < row + rows; r++) {
          for (let c = col; c < col + cols; c++) {
            const cell = `${c},${r}`;
            expect(owner.get(cell), `${cell} is in two sections`).toBeUndefined();
            owner.set(cell, section.name);
          }
        }
      }
    }
  });
});

/**
 * The numbers behind the text.
 *
 * The producer's job here is narrow and easy to lose: carry `values` from the
 * model to the entry, unchanged, on every layout. A field's numbers going
 * missing looks like nothing at all - the terminal never reads them, so the
 * screen is identical and only a replacement HUD notices.
 */
describe("values reach the entry that was placed", () => {
  const withValues = (key: string, values: Record<string, number>, ...texts: string[]): HudModel => ({
    ...model(key, ...texts),
    values,
  });

  const vitals = [
    withValues("hp", { current: 7, max: 34 }, "HP  7/34"),
    withValues("depth", { depth: 1, feet: 50 }, "50 feet"),
    model("race", "Half-Troll"),
  ];

  it("carries them through the placed left sidebar", () => {
    const frame = buildHudFrame(params({ vitals, placements: [{ key: "hp", row: 1 }] }));
    expect(frame.sidebar?.entries[0]?.values).toEqual({ current: 7, max: 34 });
  });

  it("carries them through the flowed compact header too", () => {
    /* Two different code paths place an entry - `placements` and `flowEntries` -
     * and only one of them is exercised by the layout most people run. */
    const frame = buildHudFrame(
      params({ layout: "top", vitals, compactKeys: ["hp", "depth"] }),
    );
    expect(frame.sidebar?.entries.map((e) => e.values)).toEqual([
      { current: 7, max: 34 },
      { depth: 1, feet: 50 },
    ]);
  });

  it("leaves a field that has no numbers without the key at all", () => {
    /* `undefined` rather than `{}`: a consumer's "does this have a proportion"
     * check reads a missing object, and an empty one would answer the same
     * question a slower and less obvious way. */
    const frame = buildHudFrame(params({ vitals, placements: [{ key: "race", row: 1 }] }));
    expect(frame.sidebar?.entries[0]).not.toHaveProperty("values");
  });

  it("survives the snapshot, frozen, as its own object", async () => {
    const { snapshotHudFrame } = await import("./hud-view");
    const frame = buildHudFrame(params({ vitals, placements: [{ key: "hp", row: 1 }] }));
    const copy = snapshotHudFrame(frame);
    const values = copy.sidebar!.entries[0]!.values!;
    expect(values).toEqual({ current: 7, max: 34 });
    /* The whole reason the snapshot exists: a plugin may retain a frame, so what
     * crossed the boundary must not be the object the next repaint mutates. */
    expect(values).not.toBe(frame.sidebar!.entries[0]!.values);
    expect(Object.isFrozen(values)).toBe(true);
  });
});

describe("what is drawn OVER the HUD (#261)", () => {
  const stack: readonly LiveRegion[] = [
    { id: "sidebar", layer: "base", cells: { col: 0, row: 1, cols: 13, rows: 23 } },
    {
      id: "core:screen",
      layer: "modal",
      cells: { col: 0, row: 0, cols: 80, rows: 24 },
      pixels: { x: 0, y: 0, width: 800, height: 480 },
    },
  ];

  it("is carried on the frame, and absent is not empty", () => {
    /* A mod that has taken `sidebar` and draws it as a DOM panel has the map's
     * problem in miniature: a screen opens, core repaints the terminal
     * underneath, and no HUD frame is produced to say so. Same distinction as on
     * the world frame - `[]` is an answer, `undefined` is silence. */
    expect(buildHudFrame(params()).stack).toBeUndefined();
    expect(buildHudFrame(params({ stack: [] })).stack).toEqual([]);
    expect(buildHudFrame(params({ stack })).stack?.map((r) => r.id)).toEqual([
      "sidebar",
      "core:screen",
    ]);
  });

  it("survives the snapshot a plugin receives, copied and frozen", () => {
    /* THE NAMED RISK. `snapshotHudFrame` enumerates its fields by hand, so a
     * field added to the type is carried by the LIVE frame and silently dropped
     * from the snapshot - with every test that reads the live frame still
     * passing. This one reads the snapshot, which is the only side a mod sees. */
    const copy = snapshotHudFrame(buildHudFrame(params({ stack })));
    expect(copy.stack?.map((r) => r.id)).toEqual(["sidebar", "core:screen"]);
    expect(copy.stack?.[1]).toEqual(stack[1]);
    expect(copy.stack?.[1]).not.toBe(stack[1]);
    expect(Object.hasOwn(copy.stack![0]!, "pixels")).toBe(false);
    expect(Object.isFrozen(copy.stack)).toBe(true);
    expect(Object.isFrozen(copy.stack?.[1]?.cells)).toBe(true);
  });
});
