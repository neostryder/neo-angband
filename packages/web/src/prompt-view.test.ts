/**
 * The vocabulary of "the game is about to use the terminal".
 *
 * These tests are cheap on purpose - the module is constants and two numbers -
 * but two of them are load-bearing. The freeze is what makes "a presenter cannot
 * alter what the game announced" true rather than aspirational, and `clip` being
 * `RegionCells` is what makes this design and #261's region stack meet instead of
 * collide, so it is asserted through `regions.ts`'s own functions rather than by
 * counting four fields.
 */

import { describe, expect, it } from "vitest";
import { promptRequest, type PromptExtent, type PromptRequest } from "./prompt-view";
import { regionContains, regionGridFault, type RegionCells } from "./regions";

const SIZE = { cols: 80, rows: 24 };

describe("what a prompt announces", () => {
  it("keeps the id, the action, the extent and the game's own wording", () => {
    const req = promptRequest(
      "charsheet:rename",
      "rename",
      "screen",
      "Enter your character's name",
      SIZE,
    );
    expect(req.id).toBe("charsheet:rename");
    expect(req.action).toBe("rename");
    expect(req.extent).toBe("screen");
    expect(req.label).toBe("Enter your character's name");
  });

  it("gives a line prompt row 0 at the full width, which is where prt(...,0,0) lands", () => {
    const clip = promptRequest("charsheet:file", "file", "line", "File name: ", SIZE).clip;
    expect(clip).toEqual({ col: 0, row: 0, cols: 80, rows: 1 });
    /* Stated as the question a presenter asks: is the row it must keep clear the
     * top one, and only the top one. */
    expect(regionContains(clip, 79, 0)).toBe(true);
    expect(regionContains(clip, 0, 1)).toBe(false);
  });

  it("gives a screen prompt the whole grid, which is what term.clear() takes", () => {
    const clip = promptRequest("charsheet:rename", "rename", "screen", "name", SIZE).clip;
    expect(clip).toEqual({ col: 0, row: 0, cols: 80, rows: 24 });
    expect(regionContains(clip, 79, 23)).toBe(true);
  });

  it("cuts a rectangle the region stack will accept, at any terminal size", () => {
    /* The point of sharing `RegionCells`: #261's own validator has to pass this
     * rectangle, or a prompt could never be pushed into the `system` band. */
    for (const size of [
      { cols: 80, rows: 24 },
      { cols: 40, rows: 12 },
      { cols: 240, rows: 67 },
      { cols: 1, rows: 1 },
    ]) {
      for (const extent of ["line", "screen"] as const) {
        const req = promptRequest("p", "a", extent, "l", size);
        expect(regionGridFault(req.clip, size.cols, size.rows), `${extent} at ${size.cols}`).
          toBeUndefined();
        expect(req.clip.cols).toBe(size.cols);
        expect(req.clip.rows).toBe(extent === "line" ? 1 : size.rows);
      }
    }
  });

  it("is pure: the same arguments give the same request, and nothing is read from outside", () => {
    const a = promptRequest("report:describe", "describe", "line", "Line 1 of 3", SIZE);
    const b = promptRequest("report:describe", "describe", "line", "Line 1 of 3", SIZE);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("a request cannot be edited by whoever receives it", () => {
  const req: PromptRequest = promptRequest("update:mods", "mods", "screen", "mod updates", SIZE);

  it("freezes the request itself", () => {
    expect(Object.isFrozen(req)).toBe(true);
    /* Not `expect(() => ...).toThrow()`: the sources here are not modules and a
     * mod's plugin may be running sloppy-mode, where a write to a frozen object
     * is silently dropped rather than thrown. The assertion that holds in both
     * is that the value did not move. */
    const mutable = req as { extent: PromptExtent; label: string };
    try {
      mutable.extent = "line";
      mutable.label = "something else";
    } catch {
      /* strict mode: the throw IS the enforcement. */
    }
    expect(req.extent).toBe("screen");
    expect(req.label).toBe("mod updates");
  });

  it("freezes the clip separately, because Object.freeze is shallow", () => {
    /* The field a presenter is most likely to hold on to and lay its own
     * geometry out from. A frozen request whose rectangle is not frozen would
     * read as safe and would not be. */
    expect(Object.isFrozen(req.clip)).toBe(true);
    const mutable = req.clip as { cols: number; rows: number };
    try {
      mutable.cols = 1;
      mutable.rows = 1;
    } catch {
      /* as above */
    }
    expect(req.clip).toEqual({ col: 0, row: 0, cols: 80, rows: 24 });
  });

  it("has exactly the five fields the ABI names, and no optional drift", () => {
    /* KEY SETS, not `toEqual`: with `exactOptionalPropertyTypes` an absent
     * optional is the normal shape, so `toEqual` treats `{a:1}` and
     * `{a:1,b:undefined}` as the same object and a field added to the producer
     * and forgotten everywhere else drifts straight past. */
    expect(Object.keys(req).sort()).toEqual(["action", "clip", "extent", "id", "label"]);
    const clip: RegionCells = req.clip;
    expect(Object.keys(clip).sort()).toEqual(["col", "cols", "row", "rows"]);
  });
});
