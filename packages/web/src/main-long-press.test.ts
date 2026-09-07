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
          ts.isIdentifier(declaration.name) && declaration.name.text === "touchPointers",
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
  readonly walked: number[];
  readonly opened: Array<{ readonly x: number; readonly y: number }>;
  /** How many times the hold asked for the command wheel. */
  readonly wheeled: number[];
  /** Dispatch a touch pointer event at a cell, which is also its grid here. */
  readonly send: (type: string, pointerId: number, col: number, row: number) => void;
}

/**
 * Compile the real block and wire it to stubs. `cellAt` and `contextClickGrid`
 * are the identity on the coordinates, so a test names a cell and reads the same
 * numbers back out of `opened` - the press's IDENTITY is what is under test, not
 * the shell's hit-testing, which `main-regions.test.ts` covers.
 */
function press(
  options: {
    readonly onGrid?: boolean;
    /** False makes `cellAt` answer null, which is the term's letterbox. */
    readonly onCell?: boolean;
    /** Column and row at or past which `cellAt` starts answering again. */
    readonly cellFrom?: number;
  } = {},
): Press {
  const emitted = ts.transpileModule(longPressSource(), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  const canvas = new EventTarget();
  const opened: Array<{ readonly x: number; readonly y: number }> = [];
  const walked: number[] = [];
  const wheeled: number[] = [];
  const onGrid = options.onGrid ?? true;
  const onCell = options.onCell ?? true;
  const cellFrom = options.cellFrom ?? Number.POSITIVE_INFINITY;
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
    "state",
    "queueWalk",
    "pointerCommandWheel",
    emitted,
  )(
    canvas,
    {
      cellAt: (x: number, y: number) =>
        (onCell || x >= cellFrom ? { col: x, row: y } : null),
    },
    () => null,
    // `onGrid: false` is the sidebar, the status lines and the letterbox
    // margins: a cell the term owns with no map grid behind it.
    (x: number, y: number) => (onGrid ? { x, y } : null),
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
    { actor: { grid: { x: 0, y: 0 } } },
    (dir: number) => { walked.push(dir); },
    () => { wheeled.push(1); },
  );
  return {
    walked,
    opened,
    wheeled,
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

describe("main.ts touch release and hold ownership (#145, #277)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels the gesture when a second finger joins then lifts", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointerdown", 2, 9, 9);
    send("pointerup", 2, 9, 9);
    vi.advanceTimersByTime(HOLD);
    // Two fingers belong to zoom/pan, even after one lifts.
    expect(opened).toEqual([]);
  });

  it("cancels the gesture when a second finger joins then drags", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointerdown", 2, 9, 9);
    send("pointermove", 2, 12, 12);
    vi.advanceTimersByTime(HOLD);
    expect(opened).toEqual([]);
  });

  it("does not let a second finger steal the pressed cell", () => {
    const { opened, send } = press();
    send("pointerdown", 1, 5, 5);
    send("pointerdown", 2, 9, 9);
    vi.advanceTimersByTime(HOLD);
    // Neither finger can claim a single-finger action after multitouch.
    expect(opened).toEqual([]);
  });

  /* The controls. Without these, "ignore the other pointer" is indistinguishable
   * from "ignore every pointer", which would pass the three above by never
   * cancelling anything at all. */
  it("moves once on quick release and never opens a hold menu", () => {
    const { opened, walked, send } = press();
    send("pointerdown", 1, 5, 5);
    expect(walked).toEqual([]);
    send("pointerup", 1, 5, 5);
    expect(walked).toEqual([3]);
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
  it("opens the menu without moving before or after release", () => {
    const { opened, walked, wheeled, send } = press();
    send("pointerdown", 1, 5, 5);
    vi.advanceTimersByTime(HOLD - 1);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual([{ x: 5, y: 5 }]);
    send("pointerup", 1, 5, 5);
    expect(walked).toEqual([]);
    // A grid answered the hold, so the wheel was never asked for it.
    expect(wheeled).toEqual([]);
  });
});

/**
 * The wheel's own half of the same rule (#65).
 *
 * A grid keeps the hold, because upstream's menu is a menu about a grid. What
 * the wheel takes is everywhere a grid is not: the sidebar, the message and
 * status lines, the letterbox margins. These drive the real block with
 * `contextClickGrid` answering null, which is what the term reports for a cell
 * outside the map viewport.
 */
describe("main.ts opens the command wheel where no grid claims the hold (#65)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the wheel rather than a grid menu", () => {
    const { opened, wheeled, send } = press({ onGrid: false });
    send("pointerdown", 1, 2, 2);
    vi.advanceTimersByTime(HOLD - 1);
    expect(wheeled).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(wheeled).toEqual([1]);
    expect(opened).toEqual([]);
  });

  it("does not also commit or step when the finger that opened it lifts", () => {
    const { walked, wheeled, send } = press({ onGrid: false });
    send("pointerdown", 1, 2, 2);
    vi.advanceTimersByTime(HOLD);
    send("pointerup", 1, 2, 2);
    // Release is neither a choice nor a cancellation, and there is no grid
    // under the sidebar to step toward either.
    expect(wheeled).toEqual([1]);
    expect(walked).toEqual([]);
  });

  it("cancels before the hold like any other press", () => {
    const { wheeled, send } = press({ onGrid: false });
    send("pointerdown", 1, 2, 2);
    send("pointermove", 1, 4, 4);
    vi.advanceTimersByTime(HOLD);
    expect(wheeled).toEqual([]);
  });

  it("gives a second finger to zoom and pan rather than to the wheel", () => {
    const { wheeled, send } = press({ onGrid: false });
    send("pointerdown", 1, 2, 2);
    send("pointerdown", 2, 6, 6);
    vi.advanceTimersByTime(HOLD);
    expect(wheeled).toEqual([]);
  });

  it("takes a quick release off the map as nothing at all", () => {
    const { walked, wheeled, send } = press({ onGrid: false });
    send("pointerdown", 1, 2, 2);
    send("pointerup", 1, 2, 2);
    expect(walked).toEqual([]);
    expect(wheeled).toEqual([]);
  });

  /* The letterbox: the term owns no cell there at all, which is a THIRD answer
   * from `cellAt` beside a map cell and a HUD cell. The right-click reads it as
   * the wheel; a hold has to read it the same way or the one rule is two. */
  it("reads a hold in the letterbox, where there is no cell, as the wheel", () => {
    const { opened, wheeled, send } = press({ onCell: false });
    send("pointerdown", 1, 2, 2);
    vi.advanceTimersByTime(HOLD);
    expect(wheeled).toEqual([1]);
    expect(opened).toEqual([]);
  });

  it("still cancels a letterbox hold once the finger reports a cell", () => {
    const { wheeled, send } = press({ onCell: false, cellFrom: 5 });
    send("pointerdown", 1, 2, 2);
    send("pointermove", 1, 6, 6);
    vi.advanceTimersByTime(HOLD);
    expect(wheeled).toEqual([]);
  });
});
