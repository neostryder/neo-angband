import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("main boot order", () => {
  it("initializes the frontend slot before the module's first render reads it", () => {
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
  });
});
