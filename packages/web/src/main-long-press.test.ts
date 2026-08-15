/**
 * The touch long-press, run rather than read.
 *
 * `main-region-input.test.ts` pins the SHAPE of these listeners out of the AST,
 * and that instrument is why #277 survived: the block carried a comment saying a
 * second pointer cancelled the press, no line anywhere compared `ev.pointerId`,
 * and a source-order assertion cannot tell those two apart. So this file
 * compiles the real block out of `main.ts` and drives it with two distinct
 * pointerIds. What fails here is behaviour, not text.
 *
 * `main.ts` is a module-scope shell that boots a canvas and a game, so importing
 * it is out. The extraction is the same one `command-menu.test.ts` uses on
 * `buildCommandTable` - slice the statements, `transpileModule`, hand the free
 * variables in as arguments - except that the free variables here are the shell
 * closures the listeners read, and `canvas` is a bare `EventTarget` the test
 * dispatches on. If the block is ever moved or renamed, the slice fails loudly
 * instead of silently measuring nothing.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.ES2023, true);

/** `let longPressTimer` through the `pointermove` registration, inclusive. */
function longPressSource(): string {
  const startAt = source.statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === "longPressTimer",
      ),
  );
  const endAt = source.statements.findIndex((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      return false;
    }
    const call = statement.expression;
    const event = call.arguments[0];
    return (
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === "addEventListener" &&
      event !== undefined &&
      ts.isStringLiteral(event) &&
      event.text === "pointermove"
    );
  });
  expect(startAt, "main.ts no longer declares longPressTimer at module scope").toBeGreaterThan(-1);
  expect(endAt, "main.ts no longer registers a pointermove listener").toBeGreaterThan(startAt);
  return mainSource.slice(source.statements[startAt]!.getStart(source), source.statements[endAt]!.getEnd());
}

interface Press {
  /** Grids `dispatchContextClick` was asked to open a menu on, in order. */
  readonly opened: Array<{ readonly x: number; readonly y: number }>;
  /** Dispatch a touch pointer event at a cell, which is also its grid here. */
  readonly send: (type: string, pointerId: number, col: number, row: number) => void;
}

/**
 * Compile the real block and wire it to stubs. `cellAt` and `contextClickGrid`
 * are the identity on the coordinates, so a test names a cell and reads the same
 * numbers back out of `opened` - the press's IDENTITY is what is under test, not
 * the shell's hit-testing, which `main-regions.test.ts` covers.
 */
function press(): Press {
  const emitted = ts.transpileModule(longPressSource(), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  const canvas = new EventTarget();
  const opened: Array<{ readonly x: number; readonly y: number }> = [];
  new Function(
    "canvas",
    "term",
    "regionInputAt",
    "contextClickGrid",
    "openModal",
    "dispatchContextClick",
    "regionPointerOwners",
    "scoresOpen",
    "dead",
    "modalDepth",
    emitted,
  )(
    canvas,
    { cellAt: (x: number, y: number) => ({ col: x, row: y }) },
    () => null,
    (x: number, y: number) => ({ x, y }),
    (act: () => void) => {
      act();
    },
    (grid: { readonly x: number; readonly y: number }) => {
      opened.push(grid);
    },
    new WeakMap(),
    false,
    false,
    0,
  );
  return {
    opened,
    send: (type, pointerId, col, row) => {
      canvas.dispatchEvent(
        Object.assign(new Event(type), {
          pointerId,
          pointerType: "touch",
          clientX: col,
          clientY: row,
        }),
      );
    },
  };
}

const HOLD = 450;

describe("main.ts long-press belongs to the finger that started it (#277)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not cancel when a SECOND finger lifts", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointerdown", 2, 9, 9);
    send("pointerup", 2, 9, 9);
    vi.advanceTimersByTime(HOLD);
    /* Before the fix, pointer 2's lift ran the bare `cancelLongPress` and the
     * menu never opened - `opened` was empty. */
    expect(opened).toEqual([{ x: 5, y: 5 }]);
  });

  it("does not cancel when a SECOND finger drags away", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointerdown", 2, 9, 9);
    send("pointermove", 2, 12, 12);
    vi.advanceTimersByTime(HOLD);
    expect(opened).toEqual([{ x: 5, y: 5 }]);
  });

  it("does not let a second finger steal the pressed cell", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointerdown", 2, 9, 9);
    vi.advanceTimersByTime(HOLD);
    /* Before the fix, the second pointerdown overwrote `longPressTarget` and
     * left the first timer running, so the menu opened on 9,9 - the cell nobody
     * had held. One menu, and it is the first finger's. */
    expect(opened).toEqual([{ x: 5, y: 5 }]);
  });

  /* The controls. Without these, "ignore the other pointer" is indistinguishable
   * from "ignore every pointer", which would pass the three above by never
   * cancelling anything at all. */
  it("still cancels when the PRESSING finger lifts", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointerup", 1, 5, 5);
    vi.advanceTimersByTime(HOLD);
    expect(opened).toEqual([]);
  });

  it("still cancels when the PRESSING finger drags off its cell", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointermove", 1, 7, 7);
    vi.advanceTimersByTime(HOLD);
    expect(opened).toEqual([]);
  });

  it("still cancels when the PRESSING finger's touch is cancelled", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointercancel", 1, 5, 5);
    vi.advanceTimersByTime(HOLD);
    expect(opened).toEqual([]);
  });

  /* And the baseline: a lone finger held for the full 450ms opens the menu. A
   * harness that opened nothing would pass every cancellation test above. */
  it("opens the menu on the pressed cell when one finger holds", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    vi.advanceTimersByTime(HOLD - 1);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual([{ x: 5, y: 5 }]);
  });
});
