/**
 * The join between where core DRAWS and what `screenRegions()` says it drew.
 *
 * `regions.test.ts` proves the division is self-consistent. It cannot prove it
 * is the division main.ts actually paints, and that is the failure that matters:
 * a region table that quietly stopped matching the renderer would hand every
 * front end a rectangle over somebody else's furniture, and nothing would look
 * wrong until a mod drew there.
 *
 * main.ts's render() is a closure-heavy module body that boots the whole game
 * against a canvas, so this reads its SOURCE - the same instrument
 * display-wiring.test.ts uses on renderSidebar, and for the same reason. What is
 * pinned is that the four call sites use the same expressions the region table
 * is built from, not that they contain particular numbers.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);

function bodyOf(name: string): string {
  const declaration = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  expect(declaration, `main.ts no longer declares ${name}()`).toBeDefined();
  return declaration!.getText(source);
}

describe("main.ts and the region table describe the same screen", () => {
  it("hands every frame the regions built from the viewport it was drawn with", () => {
    /* One viewport() call, one region table, one frame. If render() built its
     * regions from a SECOND viewport() call, a mid-frame layout change would
     * put the map somewhere the frame's own cells are not. */
    const render = bodyOf("render");
    expect(render).toMatch(/const vp = viewport\(/u);
    expect(render).toMatch(/regions: currentScreenRegions\(vp\)/u);
  });

  it("builds the regions from the live layout and the surface's own metrics", () => {
    const build = bodyOf("currentScreenRegions");
    /* Every rectangle comes from viewport()'s numbers... */
    for (const field of ["mapOriginX", "mapTop", "mapCols", "mapRows"]) {
      expect(build, `currentScreenRegions no longer reads vp.${field}`).toContain(`vp.${field}`);
    }
    expect(build).toContain("vp.layout");
    expect(build).toContain("SIDEBAR_W");
    /* ...and the pixels from the terminal rather than from a guess about it.
     * A hard-coded cell size here would be wrong on every zoom level and every
     * device pixel ratio, and would look right in a test that supplied one. */
    expect(build).toContain("term.metrics()");
  });

  it("draws the status line exactly where the status region says it is", () => {
    /* screenRegions() gives `status` the last row, starting at the map's own
     * column and as wide as the map. This is the call it is describing. */
    expect(bodyOf("render")).toMatch(/renderStatusLine\(mapOriginX, rows - 1, mapCols\)/u);
  });

  it("draws the message line across the full width of row 0, above the sidebar", () => {
    /* The one people reimplement wrongly: the message row is NOT indented to
     * the map, so the `messages` region starts at column 0 and is `cols` wide. */
    expect(bodyOf("render")).toMatch(/term\.print\(0, 0, message/u);
  });

  it("puts the compact vitals on row 1, which is where the Top sidebar region is", () => {
    /* The sidebar region is a ROLE. In the Top layout the role is this one-line
     * header, and the region has to follow it there rather than describing a
     * left column that this layout does not have. */
    expect(bodyOf("render")).toMatch(/renderCompactVitals\(1, cols\)/u);
  });

  it("keeps the left sidebar inside the width the sidebar region publishes", () => {
    /* renderSidebar truncates each field at SIDEBAR_W, and the region is
     * SIDEBAR_W wide. Two numbers that must agree, from one constant. */
    const sidebar = bodyOf("renderSidebar");
    expect(sidebar).toContain("SIDEBAR_W");
    expect(sidebar).toMatch(/for \(const \{ key, row: y \} of sidebarLayout\(rows\)\)/u);
  });
});
