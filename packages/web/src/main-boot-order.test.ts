import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("main boot order", () => {
  it("does not paint the map at module scope (#249)", () => {
    /* There used to be a bare top-level `render()` here, and this file's other
     * test was built around it. What it actually drew was the map of whichever
     * character boot had loaded - measured on the shipped Windows build,
     * 2026-08-13, a generated town was on screen from 6.9s to 12.7s after launch,
     * over startup work that had not finished and a character nobody had chosen.
     *
     * The loading screen replaced it. This asserts the replacement did not get
     * quietly undone, which is the only way the town comes back. */
    const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);
    const topLevelRender = source.statements.find(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        ts.isIdentifier(statement.expression.expression) &&
        statement.expression.expression.text === "render",
    );
    expect(topLevelRender, "main.ts paints the map at module scope again").toBeUndefined();
    /* And what stands in its place. */
    expect(mainSource).toMatch(/const stopLoading = startLoading\(term, \{/u);
  });

  it("takes the loading screen down at the menu stack's one entry (#251)", () => {
    /* The loading screen repaints the whole terminal every 90ms. Whoever stops
     * it therefore decides whether the NEXT screen is visible at all, and for
     * one release that decision sat inside maybeTitle - which has four returns
     * and reached the stop on one of them. (N)ew game takes one of the other
     * three: birth ran, took keys, and was erased eleven times a second, so no
     * character could be created on the shipped build.
     *
     * What is pinned here is the SHAPE that made it impossible, not the fix's
     * text: the stop is an unconditional statement of bootMenus itself - one
     * entry, no branch to hide behind - and it is not back inside maybeTitle,
     * where a fourth exit could be added tomorrow and inherit the same bug. */
    const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);
    const decl = (name: string): ts.FunctionDeclaration | undefined =>
      source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && statement.name?.text === name,
      );

    const bootMenus = decl("bootMenus");
    expect(bootMenus?.body, "main.ts no longer declares bootMenus()").toBeDefined();
    const body = bootMenus!.body!.statements;

    /* A DIRECT child of the function body: nested in an `if`, a `try` or the
     * loop, it is conditional again and this test has to fail. */
    const stopAt = body.findIndex(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        ts.isIdentifier(statement.expression.expression) &&
        statement.expression.expression.text === "stopLoading",
    );
    expect(stopAt, "bootMenus() does not stop the loading screen unconditionally").toBeGreaterThan(
      -1,
    );

    /* And before the menu loop, because a screen painted inside it is exactly
     * what the animation was erasing. */
    const loopAt = body.findIndex((statement) => ts.isForStatement(statement));
    expect(loopAt, "bootMenus() no longer runs its menu loop").toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(loopAt);

    const maybeTitle = decl("maybeTitle");
    expect(maybeTitle, "main.ts no longer declares maybeTitle()").toBeDefined();
    let inMaybeTitle = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "stopLoading"
      ) {
        inMaybeTitle = true;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(maybeTitle!, visit);
    expect(inMaybeTitle, "the stop is back behind one of maybeTitle's exits").toBe(false);
  });

  it("initializes both display sinks before anything that will read them", async () => {
    const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);
    const render = source.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "render",
    );
    expect(render).toBeDefined();

    /* WHAT render() ACTUALLY READS moved (#253). It used to hold the front-end
     * slot and build a sink from it on every frame; it now reads the two sinks
     * directly, because rebuilding them per frame discarded their "this mod
     * faulted, stop calling it" memory. So the reader this test follows is
     * `liveWorldSink` / `liveHudSink`, and the TDZ chain behind each is longer
     * by one link rather than different in kind. */
    const readsIn = (fn: ts.Node, name: string): boolean => {
      let found = false;
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === name) found = true;
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(fn, visit);
      return found;
    };
    expect(readsIn(render!, "liveWorldSink")).toBe(true);
    expect(readsIn(render!, "liveHudSink")).toBe(true);

    const declOf = (name: string): ts.Statement | undefined =>
      source.statements.find((statement) =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
        ),
      );
    const initialized = (name: string): ts.Statement | undefined =>
      source.statements.find((statement) =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name &&
            declaration.initializer !== undefined &&
            /* The slots used to be `null` and this test pinned that literal.
             * They are now candidate zero - core's own renderer and core's own
             * terminal, each selected through the same install the mod boot uses
             * (#140, #253) - so what matters is that they are initialized to
             * SOMETHING, and specifically not back to null. */
            declaration.initializer.kind !== ts.SyntaxKind.NullKeyword,
        ),
      );

    /* Nothing here initializes to a literal: each link initializes FROM another
     * module-level binding, which is a real temporal-dead-zone edge the old
     * `= null` had no way to hit. Both chains come into the slice, and the
     * evaluation below is what proves the order holds. */
    const chain = [
      "coreWorldSink",
      "coreHudSink",
      "coreFrontendSlot",
      "coreHudSlot",
      "installedFrontend",
      "installedHud",
    ].map(declOf);
    const sinks = ["liveWorldSink", "liveHudSink"].map(initialized);

    expect(sinks.every((statement) => statement !== undefined)).toBe(true);
    expect(chain.every((statement) => statement !== undefined)).toBe(true);
    for (const link of chain) {
      for (const sink of sinks) {
        expect(link!.getStart(source)).toBeLessThan(sink!.getStart(source));
      }
    }

    /*
     * This is deliberately an ES-module evaluation, not a call to a helper.
     * Keep the statements in their exact source order, and append the read that
     * used to be a top-level `render()` in main.ts itself. If the slot is moved
     * above the candidate it is built from, importing this module throws the same
     * temporal-dead-zone ReferenceError the shipped module would.
     *
     * The anchor moved because the reader did (#249): boot no longer paints the
     * map, so there is no top-level render() to sit below the slot. The TDZ edge
     * between the slot and the chain it is built from is unchanged and still
     * live, and the reader is written here so a re-added boot render inherits a
     * test that was already about it.
     *
     * The stubs stand in for what the slice CALLS, never for what it ORDERS:
     * every declaration whose position this test is about comes from main.ts's
     * own text, so a reordering there reaches here.
     */
    const bootSlice = [...chain.map((statement) => statement!), ...sinks.map((s) => s!)]
      .sort((a, b) => a.getStart(source) - b.getStart(source))
      .map((statement) => statement.getText(source))
      .concat("render();")
      .join("\n");
    const stubs = [
      "type InstalledFrontend = unknown;",
      "type InstalledHud = unknown;",
      "const term = {};",
      "const glyphWorldFrameSink = (s: unknown): unknown => s;",
      "const glyphHudSectionSink = (s: unknown): unknown => s;",
      "const coreOnlyFrontend = (s: unknown): unknown => s;",
      "const coreOnlyHud = (s: unknown): unknown => s;",
      "const frontendWorldFrameSink = (s: unknown, _r: unknown): unknown => s;",
      "const hudFrameSink = (s: unknown, _r: unknown): unknown => s;",
      "const reportDisplayFault = (): void => undefined;",
    ].join("\n");
    const emitted = ts.transpileModule(
      `${stubs}\nfunction render(): unknown { return [liveWorldSink, liveHudSink]; }\n${bootSlice}`,
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } },
    ).outputText;
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`;
    await expect(import(moduleUrl)).resolves.toBeDefined();
  });

  /**
   * Core drops a mod's unresolvable shop line and records it; THIS is where the
   * record becomes something a player can read.
   *
   * Without this line the fix is a green-and-dead seam of exactly the kind this
   * repository has shipped three times (#245, #246, #247): `StoreRegistry.refused`
   * would be correct, tested, and read by nobody, and the observable behaviour
   * would be a shop quietly one line short with no explanation anywhere - which
   * is worse than the crash it replaced, because at least the crash said
   * something. main.ts boots a game on import and cannot be imported here, so the
   * call is asserted on its source with comments stripped: a citation must not be
   * able to satisfy a claim about code.
   */
  it("reports every dropped store stock line as a mod fault", () => {
    const noComments = mainSource
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/[^\n]*/gu, "");
    const at = noComments.search(/stores\?\.refused/u);
    expect(at, "main.ts never reads StoreRegistry.refused").toBeGreaterThan(-1);
    expect(noComments.slice(at, at + 200)).toMatch(/reportModFault\(/u);
  });
  /**
   * And every OTHER registry that refuses, for the same reason.
   *
   * Named one registry at a time on purpose. A test that only asserted "some
   * `.refused` is read" would go green the moment the store's line existed and
   * would never notice the next binder's list being collected and dropped on
   * the floor - the same green-and-dead seam, one level out. Each name here is a
   * registry that HAS a `refused` list; adding one to a third binder without
   * adding it here is what this is meant to catch.
   */
  it.each([["stores"], ["objects"]])(
    "reports the %s registry's refusals as mod faults",
    (registry) => {
      const noComments = mainSource
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/\/\/[^\n]*/gu, "");
      const at = noComments.search(new RegExp(`${registry}\\?\\.refused`, "u"));
      expect(at, `main.ts never reads the ${registry} registry's refusals`).toBeGreaterThan(-1);
      expect(noComments.slice(at, at + 300)).toMatch(/reportModFault\(/u);
    },
  );

  /**
   * The quarantine store had a complete, tested save half and no reader for a
   * whole release - exactly the green-and-dead seam the three tests above exist
   * for, and the reason issue #76 was filed. Three lines make it observable, and
   * every one of them is in this file, which cannot be imported here because it
   * boots a game on import. So they are asserted on the source with comments
   * stripped: a citation must not be able to satisfy a claim about code.
   */
  const stripped = (): string =>
    mainSource.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");

  it("says so on the load that quarantines something (#76)", () => {
    const src = stripped();
    const at = src.search(/loaded\.quarantined/u);
    expect(at, "main.ts never reads StartedGame.quarantined").toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toMatch(/describeQuarantine\(/u);
    /* Folded into the load note rather than replacing it, so a migration note
     * and a quarantine note on the same load do not silently cancel out. */
    expect(src.slice(at, at + 400)).toMatch(/loadedNote/u);
  });

  it("gives the mod manager the live orphan store, so the stash view has one (#76)", () => {
    /* Either signature is fine - the live `() => game.orphans` is what the
    // stash reads, and the setStore callback (when present) is what
    // viewOrphanStash writes through. */
    expect(stripped()).toMatch(
      /orphans:\s*orphanViewDeps\(\(\)\s*=>\s*game\.orphans(?:,\s*\w+)?\)/u,
    );
  });

  it("asks the one-time keep/purge question from the boot chain (#76)", () => {
    const src = stripped();
    /* In the chain, not merely declared: a declared-and-uncalled prompt is the
     * same dead seam one layer up. */
    expect(src).toMatch(/\.then\(offerOrphanChoice\)/u);
    const at = src.search(/async function offerOrphanChoice/u);
    expect(at, "main.ts never declares offerOrphanChoice").toBeGreaterThan(-1);
    const body = src.slice(at, at + 1200);
    expect(body).toMatch(/orphanPromptDue\(/u);
    expect(body).toMatch(/purgeOrphans\(\)/u);
    expect(body).toMatch(/orphansAcknowledged = true/u);
  });

  it("gives the home its own door into the real stash view, gated on FEAT.HOME (#76)", () => {
    /* Follow-up to the two tests above: until this landed the stash view was
     * reachable only from Mods. enterStoreModal's deps object is the only
     * place a second door could be wired, and the same green-and-dead risk
     * applies here - a `viewStash` field that exists but is not actually the
     * real screen, or is not gated on the home, would pass a shallower check. */
    const src = stripped();
    const at = src.search(/async function enterStoreModal/u);
    expect(at, "main.ts no longer declares enterStoreModal").toBeGreaterThan(-1);
    const body = src.slice(at, at + 6000);
    const viewStashAt = body.search(/viewStash:/u);
    expect(viewStashAt, "enterStoreModal never wires viewStash").toBeGreaterThan(-1);
    // The gate reads as `...(store.feat === FEAT.HOME ? { viewStash: {...} } : {})`,
    // so the condition sits BEFORE the key itself; widen the window to cover it.
    const clause = body.slice(Math.max(0, viewStashAt - 200), viewStashAt + 500);
    // Only offered in the home - an ordinary shop never gets the field at all.
    expect(clause).toMatch(/store\.feat === FEAT\.HOME/u);
    // hasItems reads the same live stash the Mods row reads, not a stub.
    expect(clause).toMatch(
      /stashOf\(orphanViewDeps\(\(\)\s*=>\s*game\.orphans,\s*applyOrphanStore\)\)\.total > 0/u,
    );
    // open() is the actual stash view, not a placeholder screen.
    expect(clause).toMatch(
      /viewOrphanStash\(term,\s*orphanViewDeps\(\(\)\s*=>\s*game\.orphans,\s*applyOrphanStore\)\)/u,
    );
  });
});
