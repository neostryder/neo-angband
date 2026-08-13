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
 * display-wiring.test.ts uses on the sidebar, and for the same reason. What is
 * pinned is that the call sites use the same expressions the region table is
 * built from, not that they contain particular numbers.
 *
 * Since #253 the HUD's half of this is checkable rather than merely pinned: each
 * section carries the region it plays the role of, so `hud-view.test.ts` can
 * compare the rectangle core draws in against the rectangle core published. What
 * still needs source text is that main.ts builds those sections from THE SAME
 * viewport call the map was drawn with.
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
    /* One viewport() call, ONE region table, and both halves of the screen read
     * it. The map's frame carries it to whoever owns the map; the HUD's sections
     * are the roles it names (#253). A second currentScreenRegions(vp) call for
     * the HUD would let a mid-frame layout change put the two descriptions of
     * one screen at odds - and each would look self-consistent. */
    const render = bodyOf("render");
    expect(render).toMatch(/const vp = viewport\(/u);
    expect(render).toMatch(/const regions = currentScreenRegions\(vp\)/u);
    /* Anchored on `= currentScreenRegions(` so the prose in render()'s own
     * comment about not calling it twice does not count as calling it twice. */
    expect(render.match(/=\s*currentScreenRegions\(/gu)?.length).toBe(1);
    expect(render).toMatch(/currentHudFrame\(vp, cols, rows, regions, targeting\)/u);
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

  it("builds the HUD from the same viewport numbers the regions came from", () => {
    /* WHERE the sections go is hud-view.ts's, and hud-view.test.ts drives it at
     * four sizes in three layouts - including the comparison against the region
     * rectangles, which no source-text guard could ever make. What is left for
     * this file is the wiring that a pure test cannot see: that main.ts feeds
     * that producer the LIVE geometry rather than a second opinion about it.
     * `mapOriginX` is the one that would silently ruin the status line - it is
     * 13 in the Left layout and 0 in the other two, so a hard-coded 0 looks
     * right in exactly the layout most people test in. */
    const hud = bodyOf("currentHudFrame");
    expect(hud).toContain("layout: vp.layout");
    expect(hud).toContain("mapOriginX: vp.mapOriginX");
    expect(hud).toContain("mapCols: vp.mapCols");
    expect(hud).toContain("sidebarWidth: SIDEBAR_W");
    /* And the region table itself, which is what makes "core draws inside what
     * it publishes" checkable at all: without the regions reaching the sections,
     * that claim is about two numbers that never meet. */
    expect(hud).toContain("regions,");
  });

  it("feeds the HUD the engine's own display models, not a copy of them", () => {
    /* The sidebar's placement is core's update_sidebar port, and its fields are
     * core's ui-display port. A shell that recomputed either would be a second
     * transcription of the C, which is what display-wiring.test.ts exists to
     * prevent and what this keeps true through the frame. */
    const hud = bodyOf("currentHudFrame");
    expect(hud).toContain("sidebarModel(state, deps)");
    expect(hud).toContain("sidebarLayout(rows)");
    expect(hud).toContain("statusLineModel(state, deps)");
  });
});
