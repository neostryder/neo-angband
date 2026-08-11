import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("main boot order", () => {
  it("initializes the frontend slot before the module's first render reads it", async () => {
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
          declaration.initializer.kind === ts.SyntaxKind.NullKeyword,
      ),
    );
    const bootRender = source.statements.find(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        ts.isIdentifier(statement.expression.expression) &&
        statement.expression.expression.text === "render",
    );

    expect(slot).toBeDefined();
    expect(bootRender).toBeDefined();
    expect(slot!.getStart(source)).toBeLessThan(bootRender!.getStart(source));

    /*
     * This is deliberately an ES-module evaluation, not a call to a helper.
     * Keep the two statements in their exact source order, but replace the
     * renderer's large browser-only body with its relevant live read.  If the
     * boot render is moved above the initialized slot, importing this module
     * throws the same temporal-dead-zone ReferenceError as the shipped module.
     */
    const bootSlice = [slot!, bootRender!]
      .sort((a, b) => a.getStart(source) - b.getStart(source))
      .map((statement) => statement.getText(source))
      .join("\n");
    const emitted = ts.transpileModule(
      `function render(): unknown { return installedFrontend; }\n${bootSlice}`,
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } },
    ).outputText;
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`;
    await expect(import(moduleUrl)).resolves.toBeDefined();
  });
});
