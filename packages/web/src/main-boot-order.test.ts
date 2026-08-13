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

  it("initializes the frontend slot before anything that will read it", async () => {
    const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);
    const render = source.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === "render",
    );
    expect(render).toBeDefined();

    let renderReadsFrontend = false;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "installedFrontend") renderReadsFrontend = true;
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(render!, visit);
    expect(renderReadsFrontend).toBe(true);

    const slot = source.statements.find((statement) =>
      ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "installedFrontend" &&
          declaration.initializer !== undefined &&
          /* It used to be `null` and this test pinned that literal. It is now
           * candidate zero - core's own renderer, selected through the same
           * installFrontend the mod boot uses (#140) - so what matters is that
           * it is initialized to SOMETHING before the boot render below, and
           * specifically not back to null. */
          declaration.initializer.kind !== ts.SyntaxKind.NullKeyword,
      ),
    );
    /* The slot no longer initializes to a literal - it initializes FROM another
     * module-level const (#140), which is a real temporal-dead-zone edge the
     * old `= null` had no way to hit. So the source it depends on comes into
     * the slice too, and the evaluation below is what proves the order holds. */
    const declOf = (name: string): ts.Statement | undefined =>
      source.statements.find((statement) =>
        ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
        ),
      );
    /* The whole chain the slot is built from: candidate zero, then the
     * selection over it, then the slot. Each link is a real TDZ edge. */
    const chain = ["coreWorldSink", "coreFrontendSlot"].map(declOf);

    expect(slot).toBeDefined();
    expect(chain.every((statement) => statement !== undefined)).toBe(true);
    for (const link of chain) {
      expect(link!.getStart(source)).toBeLessThan(slot!.getStart(source));
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
    const bootSlice = [...chain.map((statement) => statement!), slot!]
      .sort((a, b) => a.getStart(source) - b.getStart(source))
      .map((statement) => statement.getText(source))
      .concat("render();")
      .join("\n");
    const stubs = [
      "type InstalledFrontend = unknown;",
      "const term = {};",
      "const glyphWorldFrameSink = (s: unknown): unknown => s;",
      "const coreOnlyFrontend = (s: unknown): unknown => s;",
    ].join("\n");
    const emitted = ts.transpileModule(
      `${stubs}\nfunction render(): unknown { return installedFrontend; }\n${bootSlice}`,
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } },
    ).outputText;
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`;
    await expect(import(moduleUrl)).resolves.toBeDefined();
  });
});
