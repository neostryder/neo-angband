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
 *
 * The second half of this file is the `term.clear()` ratchet, which is the same
 * instrument pointed at the whole shell rather than at one function. It lives
 * here because it is the same question one step out: the first half asks whether
 * core draws where it says it does, and the ratchet asks whether anything else
 * is still allowed to erase all of it without saying anything at all.
 */

import { readdirSync, readFileSync } from "node:fs";
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

/* ------------------------------------------------------------------------- *
 * THE `term.clear()` RATCHET.
 *
 * `term.clear()` erases the WHOLE terminal, so any site that calls it is a site
 * that cannot coexist with anything else on screen. The failure it produces is
 * the quiet kind: a mod's window is drawn, the player presses 'M' for the level
 * map, and the window is gone - no exception, no console entry, nothing to
 * search for. Every one of the sites below is a screen that will become a region
 * and will erase its own rectangle through `clipSurface` instead.
 *
 * WHY AN ALLOW-LIST AND NOT A BAN. Converting them is a screen at a time, and a
 * ban would mean converting all of them in one commit or not starting. What this
 * pins instead is the DIRECTION: the list may only shrink. Removing a site does
 * not require touching this table (a stale entry is harmless and expected as the
 * conversion proceeds); adding one anywhere fails, so a new full-screen erase
 * has to be argued for rather than remembered.
 * ------------------------------------------------------------------------- */

/**
 * Every `term.clear()` call in the shell's own sources, as "file::a > b > c"
 * where the path is the named functions enclosing it. The path rather than the
 * bare function name because `paint` is the name six different overlays give
 * their painter, and a table keyed on that would let a seventh through.
 *
 * The receiver is matched syntactically on the identifier `term`, which is the
 * name every one of these uses. That is the guard's one blind spot and a
 * deliberate one: a site that renamed its surface to dodge this would be doing
 * so on purpose, and no source-text guard survives an author who means to defeat
 * it. What it catches is the accident.
 */
const TERM_CLEAR_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  /* render() is the compositor's own frame, and the ONE site that is not
   * pending: it is the full repaint every region is composed on top of. */
  "main.ts": ["render", "showReportPage > paint", "showUpdatePage > paint"],
  /* Already a region (#261 commit 3). `term` here is the clipped surface
   * `showViewOnTerminal` hands its painter, so this clear() erases the screen's
   * own rectangle - which happens to be the whole terminal, because that is
   * what a 4.2.6 screen is. The source text is unchanged and so is the picture;
   * what changed is that something else can now see it. */
  "overlay.ts": [
    "paintViewOnTerminal > paint",
    /* Pending. */
    "itemSelect > paint",
    "promptNumber > paint",
    "promptText > paint",
    "selectFromMenu > askTerminal > paint",
    "showLevelMap > paint",
  ],
  "birth.ts": [
    "birthMenu > paint",
    "drawBirthSheet",
    "pointBuyStats > paint",
    "standardRoller > paint",
  ],
  "charsheet.ts": [
    "showCharacterSheet > showSheetOnTerminal > paintNarrow",
    "showCharacterSheet > showSheetOnTerminal > paintWide",
  ],
  "colors.ts": ["runColorsEditor > paint"],
  "equip-cmp.ts": ["showEquipCmp > paint"],
  "knowledge.ts": ["runGroupedBrowser > browsePanels > paint"],
  "loading.ts": ["paintScene"],
  "mod-browse.ts": ["installOne > result", "openRegistry", "paintWhile", "showSource"],
  "monster-list.ts": ["showMonsterListOnTerminal > paint"],
  "news.ts": ["paintTitleArt"],
  "options.ts": ["optionToggleScreen > paint", "runSidebarModePage > paint"],
  "prefs-ui.ts": ["getPrefPath", "loadPrefFileHack"],
  "score.ts": ["showScoreScreen > showScoresOnTerminal > paint"],
  "shop.ts": ["runStore > paint"],
  "wizard.ts": ["drawWizItem", "paintWizItemOnTerminal"],
};

function enclosingName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return node.name?.text;
  if (
    ts.isMethodDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    return ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  return undefined;
}

function enclosingPath(node: ts.Node): string {
  const parts: string[] = [];
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    const name = enclosingName(n);
    if (name !== undefined) parts.unshift(name);
  }
  return parts.length > 0 ? parts.join(" > ") : "<module>";
}

/** Every `term.clear()` in one file, as enclosing paths. */
function termClearSites(file: string): string[] {
  const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "clear" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "term"
    ) {
      found.push(enclosingPath(node));
    }
    ts.forEachChild(node, walk);
  };
  walk(tree);
  return found;
}

describe("term.clear() is a ratchet: the list of full-screen erases may only shrink", () => {
  const shellSources = readdirSync(new URL(".", import.meta.url))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .sort();

  it("scans a source set that actually contains the known sites", () => {
    /* A guard that quietly scanned nothing would pass forever. Two anchors: the
     * directory listing reached a file with a known site in it, and the AST walk
     * finds render() - the one call that is never going away. */
    expect(shellSources).toContain("overlay.ts");
    expect(shellSources.length).toBeGreaterThan(30);
    expect(termClearSites("main.ts")).toContain("render");
  });

  it("has no term.clear() outside the enumerated sites", () => {
    const added: string[] = [];
    for (const file of shellSources) {
      const allowed = new Set(TERM_CLEAR_ALLOWED[file] ?? []);
      for (const site of termClearSites(file)) {
        if (!allowed.has(site)) added.push(`${file}::${site}`);
      }
    }
    expect(
      added,
      "A NEW full-screen term.clear() appeared. It erases the whole terminal, " +
        "including any region a mod has drawn - and it does so silently. Give " +
        "the screen a region (pushRegion + clipSurface, see ui-stack.ts) and " +
        "erase the rectangle instead. If it genuinely must erase everything, " +
        "add it to TERM_CLEAR_ALLOWED in this file with the reason.",
    ).toEqual([]);
  });
});
