/**
 * `main.ts` boots a canvas and a game at module scope, so listener wiring is
 * pinned structurally. The compositor test drives the hit-test itself; this
 * prevents the shell from forgetting to ask it before it walks or opens core's
 * context menu.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);

function listenerBodies(event: string): string[] {
  const bodies: string[] = [];
  const visit = (node: ts.Node): void => {
    const eventArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener" &&
      eventArgument !== undefined &&
      ts.isStringLiteral(eventArgument) &&
      eventArgument.text === event
    ) {
      const listener = node.arguments[1];
      if (listener && (ts.isArrowFunction(listener) || ts.isFunctionExpression(listener))) {
        bodies.push(listener.body.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bodies;
}

function listener(event: string, marker: string): string {
  const body = listenerBodies(event).find((candidate) => candidate.includes(marker));
  expect(body, `main.ts has no ${event} listener containing ${marker}`).toBeDefined();
  return body!;
}

/**
 * These are SOURCE-ORDER assertions, and the blind spot is written down here
 * rather than left to be discovered: they prove `regionInputAt` is CALLED
 * before core decides, not that its answer GATES the decision. A handler that
 * asks the question and drops the reply passes every test in this file.
 *
 * The behavioural half lives in `region-input.node.test.ts`, which drives the
 * real shipped sample and asserts the ownership plane answers correctly - so
 * between them the call exists, is ordered first, and returns the right owner.
 * What neither covers is the wire from that answer to the early return. That
 * gap is the reason the guards below are ordering comparisons rather than a
 * bare `toContain`: an ordering test at least fails when someone moves the call
 * after the walk, which is the likelier regression than deleting the `if`.
 */
describe("main.ts routes pointer gestures through region ownership", () => {
  it("consults the cell owner before core decides what each gesture means", () => {
    const tap = listener("pointerdown", "queueWalk");
    const context = listener("contextmenu", "dispatchContextClick");
    const longPress = listener("pointerdown", "pointerType !== \"touch\"");

    expect(tap).toContain("regionInputAt(");
    expect(tap.indexOf("regionInputAt(")).toBeLessThan(tap.indexOf("mouse_movement"));
    expect(tap.indexOf("regionInputAt(")).toBeLessThan(tap.indexOf("queueWalk("));

    expect(context).toContain("regionInputAt(");
    expect(context.indexOf("regionInputAt(")).toBeLessThan(context.indexOf("contextClickGrid("));

    expect(longPress).toContain("regionInputAt(");
    expect(longPress.indexOf("regionInputAt(")).toBeLessThan(longPress.indexOf("contextClickGrid("));
  });

  it("keeps long-press targets distinct for core cells and region cells", () => {
    expect(mainSource).toContain('kind: "core-grid"');
    expect(mainSource).toContain('kind: "region-cell"');
    expect(mainSource).toContain("longPressTarget");
  });
});
