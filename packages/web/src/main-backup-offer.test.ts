/**
 * Ticket #24's checkpoint, asserted on main.ts's own source.
 *
 * main.ts boots a game on import and cannot be imported in a test (see
 * main-boot-order.test.ts's own header for the same constraint) - these are
 * source-shape assertions rather than behavioural ones, in the same style
 * main-boot-order.test.ts already uses for bootMenus()'s other unconditional
 * top-of-function call (stopLoading).
 *
 * Two claims: the checkpoint runs ONCE, wired into bootMenus() as an
 * unconditional statement before any menu logic - not a poll, and not buried
 * in a branch a future edit could route around - and it never becomes a
 * timer, which "once per game launch" would silently turn into if a
 * setInterval/setTimeout ever crept into it.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);

function decl(name: string): ts.FunctionDeclaration | undefined {
  return source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

describe("checkBackupArrivals (#24)", () => {
  it("is declared, once, in main.ts", () => {
    const fn = decl("checkBackupArrivals");
    expect(fn?.body, "main.ts no longer declares checkBackupArrivals").toBeDefined();
  });

  it("is called unconditionally at the top of bootMenus(), before the menu loop", () => {
    /* Same shape as the stopLoading() assertion above it in main.ts:
     * a DIRECT child of the function body, and before the `for` loop -
     * nested in an `if` or a `try`, or run after the loop starts, it would no
     * longer be the one-shot, always-checked entry point this test pins. */
    const bootMenus = decl("bootMenus");
    expect(bootMenus?.body, "main.ts no longer declares bootMenus").toBeDefined();
    const body = bootMenus!.body!.statements;

    const callsCheckpoint = (node: ts.Node): boolean =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "checkBackupArrivals";

    /* Wrapped in openModal(() => checkBackupArrivals()), so the direct child
     * statement is an ExpressionStatement over an awaited openModal call, and
     * the checkpoint's own name shows up somewhere inside that one statement. */
    const checkpointAt = body.findIndex((statement) => {
      let found = false;
      const visit = (node: ts.Node): void => {
        if (callsCheckpoint(node)) found = true;
        ts.forEachChild(node, visit);
      };
      visit(statement);
      return found;
    });
    expect(checkpointAt, "bootMenus() no longer calls checkBackupArrivals").toBeGreaterThan(-1);

    const loopAt = body.findIndex((statement) => ts.isForStatement(statement));
    expect(loopAt, "bootMenus() no longer runs its menu loop").toBeGreaterThan(-1);
    expect(checkpointAt).toBeLessThan(loopAt);

    /* And a DIRECT child, not nested inside a conditional - the same "no
     * branch to hide behind" property main-boot-order.test.ts already pins
     * for stopLoading(). Only maybeTitle's own suppression logic (?agent=,
     * SKIP_TITLE, BIRTH_DONE) may gate what happens AFTER this point; the
     * checkpoint itself must not be behind any of it. */
    const checkpointStatement = body[checkpointAt]!;
    expect(ts.isIfStatement(checkpointStatement)).toBe(false);
    expect(ts.isTryStatement(checkpointStatement)).toBe(false);
  });

  it("never becomes a poll: no setInterval/setTimeout anywhere in its body", () => {
    const fn = decl("checkBackupArrivals");
    expect(fn?.body).toBeDefined();
    let found: string | null = null;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "setInterval" || node.expression.text === "setTimeout")
      ) {
        found = node.expression.text;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn!, visit);
    expect(found, "checkBackupArrivals contains a timer - this was meant to be one pass, not a poll").toBeNull();
  });

  it("reuses importCharacter rather than writing a second import path", () => {
    const fn = decl("checkBackupArrivals");
    let callsImportCharacter = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "importCharacter"
      ) {
        callsImportCharacter = true;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn!, visit);
    expect(callsImportCharacter, "checkBackupArrivals no longer calls the real importCharacter").toBe(true);

    /* And it never calls decodeTransfer or writeSlot itself - those belong to
     * importCharacter alone; a caller doing either of those things directly
     * would be exactly the second import path this ticket says not to build. */
    const noComments = mainSource.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
    const at = noComments.search(/async function checkBackupArrivals/u);
    expect(at).toBeGreaterThan(-1);
    const end = noComments.indexOf("\nasync function importCharacter", at);
    const body = noComments.slice(at, end > -1 ? end : at + 3000);
    expect(body).not.toMatch(/decodeTransfer\(/u);
    expect(body).not.toMatch(/writeSlot\(/u);
  });
});
