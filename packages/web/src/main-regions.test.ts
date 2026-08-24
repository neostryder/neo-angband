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

  it("publishes what is drawn OVER the map, and subscribes to it changing (#261)", () => {
    /* THE SHIPPED PATH, which is the half a unit test cannot see. `world-view.ts`
     * can carry a stack and `samples/blueprint-view` can stand down for one, and
     * between them the game can still publish nothing - which is precisely the
     * "green tests on one side, nothing on the shipped path" failure this
     * repository keeps re-learning (#245, #246, #247).
     *
     * THE ORDER IS THE ASSERTION, not the presence. `relayoutStack` re-places
     * every region for this frame; reading `liveRegionStack()` before it would
     * hand a mod the PREVIOUS frame's composite, which is wrong in exactly the
     * case that matters - the frame on which a screen opened. */
    const render = bodyOf("render");
    expect(render).toMatch(/relayoutStack\(\{ cols, rows, base: regions/u);
    expect(render).toMatch(/stack: liveRegionStack\(\)/u);
    expect(render.indexOf("relayoutStack(")).toBeLessThan(
      render.indexOf("stack: liveRegionStack()"),
    );
    /* The HUD gets the same composite from the same relayout: a mod owning the
     * sidebar is covered by the things the map is covered by. */
    expect(bodyOf("currentHudFrame")).toContain("stack: liveRegionStack()");
    /* And the notification, which is what makes a screen opening an EVENT rather
     * than something a front end could only learn from a repaint that is not
     * coming while that screen owns the terminal. */
    expect(mainSource).toMatch(/onStackChanged\(\(stack\) => liveWorldSink\.restate\?\.\(stack\)\)/u);
  });

  it("paints the stack LAST in the frame, as the final statement of render() (#261)", () => {
    /* RISK 2, and it was unguarded until now: the order was correct and nothing
     * held it there. render() opens with term.clear(), so a stack painted
     * anywhere before the end is erased by the very frame that was supposed to
     * carry it. The symptom is not a missing window - it is a window that
     * flickers ONLY WHILE THE PLAYER IS MOVING, because that is when frames
     * come, and it reads as the mod being broken rather than the shell. A
     * reordering that caused it would pass every other test in this repository.
     *
     * ASSERTED ON THE STATEMENT LIST, not on string positions. `indexOf` would
     * be satisfied by the call appearing anywhere after the clear - including
     * inside an `if` in the middle of the function, which is exactly the shape a
     * well-meaning refactor produces. What has to be true is stronger and is a
     * fact about structure: it is the LAST thing render() does. */
    const declaration = source.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "render",
    );
    const body = declaration?.body?.statements;
    expect(body, "main.ts no longer declares render()").toBeDefined();
    const last = body![body!.length - 1]!;
    expect(
      last.getText(source).trim(),
      "paintRegionStack(term) must be the final statement of render(): render() " +
        "opens with term.clear(), so anything painted before the end of the frame " +
        "is erased by it, and the only symptom is a mod's region flickering while " +
        "the player moves.",
    ).toBe("paintRegionStack(term);");
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
 *
 * THE CENSUS IS IN THREE PARTS, NOT ONE LIST WITH COMMENTS (#253). Until now the
 * difference between "this erase is a region's own" and "this erase is still
 * loose" was carried by prose beside the entry, and the count of what is left
 * was something a reader had to reconstruct by reading every comment in the
 * table - which is the shape of a number that goes quietly wrong, because
 * nothing fails when the prose stops matching the code. Splitting the table
 * makes the state of each site a value rather than a remark: the ratchet still
 * checks the UNION, so it is exactly as strict as it was, and "how many are
 * left" is now derived from `TERM_CLEAR_PENDING` instead of counted by hand.
 * ------------------------------------------------------------------------- */

/**
 * The compositor's own frame: the full repaint every region is composed on top
 * of. It is not pending, it is not a region, and it is never going away.
 */
const TERM_CLEAR_COMPOSITOR: Readonly<Record<string, readonly string[]>> = {
  "main.ts": ["render"],
};

/**
 * Sites whose erase is A REGION'S OWN.
 *
 * The source text of these painters is unchanged and so is the picture: `term`
 * is the clipped surface the screen's `show*` half hands them, so `clear()`
 * erases the screen's own rectangle - which happens to be the whole terminal,
 * because that is what a 4.2.6 screen is. What changed is that everything else
 * on the display can now see it happen.
 *
 * THE ENTRY IS NOT THE EVIDENCE. Moving a line from `TERM_CLEAR_PENDING` to here
 * is a claim, and a claim made in a table is worth nothing on its own - so the
 * test below checks that every file named here actually declares a region
 * (`screenRegionSpec` + `pushRegion` + `regionSurface` + `popRegion`). That is
 * still source text and it is still coarse: it proves the file is wired to the
 * stack, not that THIS site is. What it catches is the entry moved by optimism.
 */
const TERM_CLEAR_REGIONS: Readonly<Record<string, readonly string[]>> = {
  /* #261 commit 3, and #261 commit 5 for the level map - the site where the risk
   * stopped being theoretical. 'M' takes the DIRECT modal path to
   * `showLevelMap` rather than going through `showTextScreen`, and
   * `renderBackground()` refuses to run `render()` while a modal is up, so that
   * erase was the one a mod could neither survive nor be told about. */
  "overlay.ts": [
    "paintViewOnTerminal > paint",
    "paintLevelMapOnTerminal > paint",
    "itemSelect > paint",
    "promptNumber > paint",
    "promptText > paint",
    "selectFromMenu > askTerminalOnTerminal > paint",
  ],
  /* #253. `drawBirthSheet` is the odd one: it is a shared painter rather than a
   * screen, with four callers (quickstart, name, history, final confirm), so it
   * is converted only because ALL FOUR now hand it a region's surface. One
   * caller left painting the raw terminal would have made this entry a lie that
   * no test in this file could see - which is why `nameStage` exists at all, and
   * why `historyStage`'s callback now takes the surface instead of closing over
   * the terminal. */
  "birth.ts": [
    "drawBirthSheet",
    "paintBirthMenuOnTerminal > paint",
    "paintPointBuyOnTerminal > paint",
    "paintStandardRollerOnTerminal > paint",
  ],
  /* #253. Both painters are two halves of ONE screen - which of them runs is a
   * width decision - so one push covers both. */
  "charsheet.ts": [
    "showCharacterSheet > paintSheetOnTerminal > paintNarrow",
    "showCharacterSheet > paintSheetOnTerminal > paintWide",
  ],
  /* #253. All four are wait screens held across an await rather than key loops,
   * and the install progress screen repaints several times a second at a moment
   * the player cannot interrupt - the worst possible time to wipe a front end
   * with no way for it to learn that it happened. */
  "mod-browse.ts": ["installOne > result", "openRegistry", "paintWhile", "showSource"],
  /* The install-choice screen ahead of "(I)nstall locally" needs two keys
   * (D and W) `showTextScreen` does not offer, so it paints itself - and is a
   * region from the start rather than a conversion, copying `showLevelMap`'s
   * show/paint split verbatim. */
  "main.ts": [
    "paintInstallChoiceOnTerminal > paint",
    "showReportPage > paint",
    "showUpdatePage > paint",
  ],
  "colors.ts": ["runColorsEditor > paint"],
  "equip-cmp.ts": ["showEquipCmp > paint"],
  "knowledge.ts": ["runGroupedBrowser > browsePanels > paint"],
  "loading.ts": ["paintScene"],
  "monster-list.ts": ["showMonsterListOnTerminal > paint"],
  "news.ts": ["paintTitleArt"],
  "options.ts": ["optionToggleScreen > paint", "runSidebarModePage > paint"],
  "prefs-ui.ts": ["getPrefPath", "loadPrefFileHack"],
  "score.ts": ["showScoreScreen > showScoresOnTerminal > paint"],
  "shop.ts": ["runStore > paint"],
  "wizard.ts": ["drawWizItem", "paintWizItemOnTerminal"],
};

/**
 * Sites that still erase the whole terminal without saying so. THIS IS THE
 * NUMBER: `docs/modding/MOD_REACH.md`'s gap-21 row quotes it, and the test below
 * pins it so that editing this table without editing that row fails here rather
 * than being noticed by nobody.
 */
const TERM_CLEAR_PENDING: Readonly<Record<string, readonly string[]>> = {};

/**
 * Every `term.clear()` call the shell is allowed to make, as "file::a > b > c"
 * where the path is the named functions enclosing it. The path rather than the
 * bare function name because `paint` is the name six different overlays give
 * their painter, and a table keyed on that would let a seventh through.
 *
 * The union of the three parts, so the ratchet is exactly as strict as it was
 * when they were one table: a site missing from all three fails, whatever its
 * state is claimed to be.
 */
const TERM_CLEAR_ALLOWED: Readonly<Record<string, readonly string[]>> = (() => {
  const merged: Record<string, string[]> = {};
  for (const part of [TERM_CLEAR_COMPOSITOR, TERM_CLEAR_REGIONS, TERM_CLEAR_PENDING]) {
    for (const [file, sites] of Object.entries(part)) {
      (merged[file] ??= []).push(...sites);
    }
  }
  return merged;
})();

function siteCount(table: Readonly<Record<string, readonly string[]>>): number {
  return Object.values(table).reduce((n, sites) => n + sites.length, 0);
}

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

/**
 * The methods that identify a receiver as a GRID SURFACE rather than a Map, a
 * Set, a canvas or a cache - all of which have a perfectly innocent `clear()`.
 *
 * This is how the guard stops being satisfiable by a rename. Matching the
 * identifier `term` was the original approach and this file used to admit, at
 * length, that renaming the receiver would silence it. That is not a blind spot
 * a comment fixes: `showLevelMap(term, ...)` became `paintLevelMapOnTerminal(
 * term, ...)` in this very commit, and a parameter rename in the same edit
 * would have taken a full-screen erase off the books with nothing to notice it.
 *
 * A receiver that is `print`ed to, `prt`ed to or `eraseToEol`d is a surface
 * whatever it is called, and a rename renames it at those call sites too - so
 * the two move together or the guard fires. It is still source text rather than
 * a type-checker, and the remaining way past it is to name a surface `x` and
 * never call anything else on it in that file, which is not an accident anybody
 * has.
 */
const SURFACE_METHODS = new Set(["print", "prt", "eraseToEol", "put", "eraseSpan"]);

/**
 * Every full-screen `clear()` in one file, as enclosing paths.
 *
 * TWO PASSES ON PURPOSE. The first learns which local names are surfaces in
 * this file; the second flags their `clear()` calls. One pass would miss a
 * surface whose `clear()` is written above its first `print()`, which is the
 * ordinary shape - every painter in this repository clears before it draws.
 */
function termClearSites(file: string): string[] {
  const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  const surfaces = new Set<string>();
  const learn = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      SURFACE_METHODS.has(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      surfaces.add(node.expression.expression.text);
    }
    ts.forEachChild(node, learn);
  };
  learn(tree);

  const found: string[] = [];
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "clear" &&
      ts.isIdentifier(node.expression.expression) &&
      surfaces.has(node.expression.expression.text)
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

  it("counts what is LEFT, and every file that claims a region has one", () => {
    /* TWO CLAIMS, because the census and the conversion fail in different ways.
     *
     * THE COUNT. 33 sites, one of them the compositor's own frame. The number
     * that matters is `TERM_CLEAR_PENDING`'s, because that is the one
     * `docs/modding/MOD_REACH.md` quotes for gap 21, and a doc quoting a number
     * nothing derives is a number that drifts. This does not read the doc - it
     * pins the arithmetic, so a table edited without the doc being edited fails
     * HERE, with the new number in the message. That is half the check and the
     * honest half: it fires on the edit, not on the drift.
     *
     * THE WIRING. A file whose sites are listed as regions must actually be
     * wired to the stack. Coarse on purpose - it is a whole-file check, not a
     * per-site one - but an entry moved into `TERM_CLEAR_REGIONS` by optimism,
     * with no push behind it anywhere in the file, is exactly the accident this
     * catches, and it is the accident a table of claims invites. */
    expect(siteCount(TERM_CLEAR_COMPOSITOR)).toBe(1);
    expect(siteCount(TERM_CLEAR_REGIONS)).toBe(33);
    expect(siteCount(TERM_CLEAR_PENDING), "MOD_REACH.md's gap-21 row quotes this").toBe(0);
    expect(siteCount(TERM_CLEAR_ALLOWED)).toBe(34);

    for (const file of Object.keys(TERM_CLEAR_REGIONS)) {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      for (const call of ["screenRegionSpec(", "pushRegion(", "regionSurface(", "popRegion("]) {
        expect(
          text.includes(call),
          `${file} lists sites as regions but never calls ${call}) - the entry is a claim ` +
            "with nothing behind it. Convert the screen (see overlay.ts's " +
            "showViewOnTerminal) or move the entry back to TERM_CLEAR_PENDING.",
        ).toBe(true);
      }
    }
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
