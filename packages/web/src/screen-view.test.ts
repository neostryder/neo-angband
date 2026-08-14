/**
 * The screen document model and the one renderer that turns it back into rows.
 *
 * WHY THE RENDERER IS TESTED AS HARD AS THE MODEL. `inventoryLines` is now
 * `screenBodyLines(inventoryScreen(...))`, so this function draws what the player
 * sees. Every rule it gets wrong - a width that stops clamping, a trailing run of
 * spaces that stops being cut, a row that starts emitting `runs` where it used to
 * emit one colour - is a change to the shipped terminal, not to an abstraction.
 * The parity of the two listings against their upstream column stops is checked
 * where the fixtures are, in `screens.test.ts`.
 *
 * Pure: no game state, no canvas.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  freezeView,
  linesScreen,
  MODELLED_SCREENS,
  screenBodyLines,
  SCREEN_FOOTER,
  UNMODELLED_SCREEN,
  type ScreenRow,
  type ScreenTableBlock,
  type ScreenView,
} from "./screen-view";

function table(block: Partial<ScreenTableBlock> & Pick<ScreenTableBlock, "columns" | "rows">): ScreenView {
  return freezeView({
    id: "test:screen",
    title: "Test",
    footer: SCREEN_FOOTER,
    blocks: [{ kind: "table", key: "t", tagged: true, ...block }],
  });
}

const ROW = (cells: ScreenRow["cells"], rest: Partial<ScreenRow> = {}): ScreenRow => ({ cells, ...rest });

describe("a table renders on the faithful terminal's column stops", () => {
  it("puts the tag first and pads every cell to its column", () => {
    const view = table({
      columns: [{ key: "name", width: 10 }, { key: "weight" }],
      rows: [
        ROW({ name: { text: "Ration" }, weight: { text: "  0.5 lb" } }, { tag: "a" }),
        ROW({ name: { text: "Lantern" }, weight: { text: " 12.0 lb" } }, { tag: "b" }),
      ],
    });
    expect(screenBodyLines(view).map((l) => l.text)).toEqual([
      "a) Ration       0.5 lb",
      "b) Lantern     12.0 lb",
    ]);
  });

  it("indents a row with no tag by the width of one, so the columns still line up", () => {
    /* An empty equipment slot has no letter and must not slide three columns
     * left; upstream writes the three spaces (ui-object.c L304-318). */
    const view = table({
      columns: [{ key: "slot", width: 8 }, { key: "name" }],
      rows: [
        ROW({ slot: { text: "Wielding" }, name: { text: "a Dagger" } }, { tag: "a" }),
        ROW({ slot: { text: "On body" }, name: { text: "(nothing)" } }),
      ],
    });
    const [worn, empty] = screenBodyLines(view).map((l) => l.text);
    expect(worn).toBe("a) Wielding a Dagger");
    expect(empty).toBe("   On body  (nothing)");
    expect(empty!.indexOf("(nothing)")).toBe(worn!.indexOf("a Dagger"));
  });

  it("cuts the trailing run of spaces rather than padding out to the last column", () => {
    /* Not cosmetic: a row that ends where the game ends it is a row anything
     * measuring - a test, a width calculation, a screen reader - reads the same
     * way the player does. */
    const view = table({
      columns: [{ key: "name", width: 6 }, { key: "weight", width: 8 }],
      rows: [ROW({ name: { text: "Wand" } }, { tag: "a" })],
    });
    expect(screenBodyLines(view)[0]!.text).toBe("a) Wand");
  });

  it("CLAMPS a declared width and GROWS an underived one", () => {
    /* The two halves of one rule. `OLIST_WEIGHT` truncates a long object name so
     * the weights stay in their column; a column with no declared width is as
     * wide as its widest cell, because nothing upstream fixed it. */
    const view = table({
      columns: [{ key: "name", width: 6 }, { key: "note" }],
      rows: [
        ROW({ name: { text: "Ring of Digging" }, note: { text: "x" } }, { tag: "a" }),
        ROW({ name: { text: "Rod" }, note: { text: "longer note" } }, { tag: "b" }),
      ],
    });
    expect(screenBodyLines(view).map((l) => l.text)).toEqual([
      "a) Ring o x",
      "b) Rod    longer note",
    ]);
  });

  it("shows the empty state only when there are no rows", () => {
    const empty = table({
      columns: [{ key: "name" }],
      rows: [],
      empty: { text: "(nothing carried)", color: "#888" },
    });
    expect(screenBodyLines(empty)).toEqual([{ text: "(nothing carried)", color: "#888" }]);

    const nothingAtAll = table({ columns: [{ key: "name" }], rows: [] });
    expect(screenBodyLines(nothingAtAll)).toEqual([]);
  });

  it("draws a header row only where a column has a label", () => {
    const view = table({
      columns: [{ key: "name", label: "Item", width: 6 }, { key: "weight", label: "Wt" }],
      rows: [ROW({ name: { text: "Rod" }, weight: { text: "5" } }, { tag: "a" })],
    });
    expect(screenBodyLines(view).map((l) => l.text)).toEqual(["   Item   Wt", "a) Rod    5"]);
  });
});

describe("a row emits runs only when its cells disagree about colour", () => {
  it("stays one coloured line when the whole row is one colour", () => {
    /* The gear listings are like this, and emitting a one-run `runs` array would
     * be the same pixels through a different path in showTextScreen - same
     * picture, more to go wrong. */
    const view = table({
      columns: [{ key: "name" }],
      rows: [ROW({ name: { text: "a Dagger" } }, { tag: "a", color: "#c0c0c0" })],
    });
    expect(screenBodyLines(view)).toEqual([{ text: "a) a Dagger", color: "#c0c0c0" }]);
  });

  it("emits runs whose concatenation is exactly the row's text", () => {
    /* showTextScreen advances the column run by run and slices on `text`'s
     * length, so a runs array that does not reconstruct `text` paints one thing
     * and scrolls as another. */
    const view = table({
      columns: [{ key: "name", width: 8 }, { key: "fail" }],
      rows: [
        ROW(
          { name: { text: "a Wand" }, fail: { text: "23% fail", color: "#ff5555" } },
          { tag: "a", color: "#c0c0c0" },
        ),
      ],
    });
    const line = screenBodyLines(view)[0]!;
    expect(line.runs).toBeDefined();
    expect(line.runs!.map((r) => r.text).join("")).toBe(line.text);
    expect(line.runs!.at(-1)).toEqual({ text: "23% fail", color: "#ff5555" });
  });
});

describe("a text block publishes prose, and the wrapping is the rendering", () => {
  it("wraps to the terminal's width and indents every row it produces", () => {
    const view = freezeView({
      id: "test:text",
      title: "T",
      footer: SCREEN_FOOTER,
      blocks: [{ kind: "text", indent: 1, paragraphs: [[{ text: "one two three four five" }]] }],
    });
    expect(screenBodyLines(view, 12).map((l) => l.text)).toEqual([
      " one two",
      " three four",
      " five",
    ]);
  });

  it("carries a colour across a wrap it did not know was coming", () => {
    const view = freezeView({
      id: "test:text",
      title: "T",
      footer: SCREEN_FOOTER,
      blocks: [
        {
          kind: "text",
          paragraphs: [[{ text: "aaa ", color: "#111" }, { text: "bbbbb ccccc", color: "#222" }]],
        },
      ],
    });
    const lines = screenBodyLines(view, 11);
    expect(lines.map((l) => l.text)).toEqual(["aaa bbbbb", "ccccc"]);
    expect(lines[1]!.runs!.some((r) => r.color === "#222" && r.text === "ccccc")).toBe(true);
  });

  it("keeps a paragraph break as a break", () => {
    const view = freezeView({
      id: "test:text",
      title: "T",
      footer: SCREEN_FOOTER,
      blocks: [{ kind: "text", paragraphs: [[{ text: "one" }], [], [{ text: "two" }]] }],
    });
    expect(screenBodyLines(view, 80).map((l) => l.text)).toEqual(["one", "", "two"]);
  });

  it("keeps a word that ends exactly AT the wrap column", () => {
    /* Upstream wraps on `(x >= wrap - 1) && (ch != ' ')` (ui-output.c L301), so a
     * space landing on the boundary is written rather than wrapped on and the
     * word before it stays. The port scanned backwards from `end - 1` and never
     * saw that space, so it pushed a word that fit exactly onto the next line.
     * Traced against 4.2.6 rather than reasoned about: at wrap 11 the C breaks at
     * column 8 for "three", then writes the space after "four" at column 10 and
     * takes the wrap on the following 'f' with `x == wrap`, which skips the
     * backward scan entirely and carries nothing down. */
    const view = freezeView({
      id: "test:text",
      title: "T",
      footer: SCREEN_FOOTER,
      blocks: [{ kind: "text", paragraphs: [[{ text: "one two three four five" }]] }],
    });
    expect(screenBodyLines(view, 11).map((l) => l.text)).toEqual([
      "one two",
      "three four",
      "five",
    ]);
  });

  it("still breaks early for a word that does NOT fit exactly", () => {
    /* The negative control for the rule above: move the boundary by one and the
     * backward scan has to do its job again, or the fix would just be "never
     * wrap", which passes the test above for the wrong reason. */
    const view = freezeView({
      id: "test:text",
      title: "T",
      footer: SCREEN_FOOTER,
      blocks: [{ kind: "text", paragraphs: [[{ text: "one two threex four" }]] }],
    });
    expect(screenBodyLines(view, 11).map((l) => l.text)).toEqual(["one two", "threex", "four"]);
  });

  it("a blank paragraph speaks with the block's own colour", () => {
    /* `color` is what the parts no run speaks for are drawn in - a paragraph
     * break has no runs at all, and a line with no colour at all would be the
     * terminal's default rather than the prose's. */
    const view = freezeView({
      id: "test:text",
      title: "T",
      footer: SCREEN_FOOTER,
      blocks: [
        { kind: "text", color: "#abcdef", paragraphs: [[{ text: "one" }], [], [{ text: "two" }]] },
      ],
    });
    const lines = screenBodyLines(view, 80);
    expect(lines[1]).toEqual({ text: "", color: "#abcdef" });
    expect(lines[0]!.runs).toEqual([{ text: "one", color: "#abcdef" }]);
  });
});

describe("what crosses the boundary is frozen", () => {
  it("freezes the rows and the cells a presenter is most likely to keep", () => {
    /* A presenter may hold a view while it animates it in; what it holds must not
     * be an array the next screen reuses. Same reason snapshotHudFrame copies. */
    const view = table({
      columns: [{ key: "name" }],
      rows: [ROW({ name: { text: "a Dagger" } }, { tag: "a" })],
    });
    const block = view.blocks[0] as ScreenTableBlock;
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(block.rows)).toBe(true);
    expect(Object.isFrozen(block.rows[0])).toBe(true);
    expect(Object.isFrozen(block.rows[0]!.cells)).toBe(true);
    expect(Object.isFrozen(block.rows[0]!.cells.name)).toBe(true);
  });

  it("drops an absent optional rather than carrying it as undefined", () => {
    /* `exactOptionalPropertyTypes` is on, and a presenter checking `"tag" in row`
     * has to get the same answer as one checking `row.tag !== undefined`. */
    const view = table({ columns: [{ key: "name" }], rows: [ROW({ name: { text: "x" } })] });
    const row = (view.blocks[0] as ScreenTableBlock).rows[0]!;
    expect(Object.keys(row)).toEqual(["cells"]);
  });
});

describe("the unmodelled path is honest about being unmodelled", () => {
  it("gives every prose page the same id and passes its lines through untouched", () => {
    const lines = [{ text: "one" }, { text: "two", color: "#abc" }];
    const view = linesScreen("Mods folder", lines, "[ ESC ]");
    expect(view.id).toBe(UNMODELLED_SCREEN);
    expect(view.title).toBe("Mods folder");
    expect(view.footer).toBe("[ ESC ]");
    expect(screenBodyLines(view)).toEqual(lines);
  });

  it("names every screen that HAS given up its model, derived from the source", () => {
    /* Derived, not declared: the list is read off the `freezeView` calls that
     * exist. Adding an id to MODELLED_SCREENS without building it fails here, and
     * so does modelling a screen and forgetting to list it - which is the failure
     * that would let "the screens are replaceable" quietly mean two of them. */
    const dir = fileURLToPath(new URL("./", import.meta.url));
    const built = new Set<string>();
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const src = readFileSync(`${dir}${name}`, "utf8");
      /* Whitespace-tolerant on purpose: pinned to a newline after `freezeView({`,
       * it silently missed the object list, whose call fits on one line. A
       * derived check that a reformat can blind is a declared check wearing a
       * disguise. */
      for (const m of src.matchAll(/freezeView\(\s*\{\s*id:\s*"(core:[^"]+)"/gu)) {
        built.add(m[1]!);
      }
    }
    expect([...built].sort()).toEqual([...MODELLED_SCREENS].sort());
  });
});
