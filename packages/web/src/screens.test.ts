import { describe, expect, it } from "vitest";
import { colorToCss } from "@neo-angband/core";
import type { Textblock } from "@neo-angband/core";
import { wrapRuns } from "./screens";

const WHITE = 1;
const L_GREEN = 13;
const L_RED = 12;

describe("wrapRuns (object-info Textblock -> ScreenLine[])", () => {
  it("keeps multiple colours on a single row", () => {
    const tb: Textblock = {
      runs: [
        { text: "Intensity ", attr: WHITE },
        { text: "3", attr: L_GREEN },
        { text: " light.", attr: WHITE },
      ],
    };
    const lines = wrapRuns(tb, 80);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.text).toBe("Intensity 3 light.");
    expect(line.runs).toEqual([
      { text: "Intensity ", color: colorToCss(WHITE) },
      { text: "3", color: colorToCss(L_GREEN) },
      { text: " light.", color: colorToCss(WHITE) },
    ]);
  });

  it("splits on embedded newlines into separate rows (and blank spacers)", () => {
    const tb: Textblock = {
      runs: [{ text: "Combat info:\n1.1 blows/round.\n\nDone", attr: WHITE }],
    };
    const lines = wrapRuns(tb, 80);
    expect(lines.map((l) => l.text)).toEqual([
      "Combat info:",
      "1.1 blows/round.",
      "",
      "Done",
    ]);
  });

  it("word-wraps at cols-1, preserving run colours across the wrap", () => {
    /* Two coloured words that must land on separate wrapped rows. */
    const tb: Textblock = {
      runs: [
        { text: "aaaa ", attr: L_GREEN },
        { text: "bbbb", attr: L_RED },
      ],
    };
    /* cols = 6 -> width 5: "aaaa" fits, the break space is dropped, "bbbb"
       wraps to the next row keeping its own colour. */
    const lines = wrapRuns(tb, 6);
    expect(lines.map((l) => l.text)).toEqual(["aaaa", "bbbb"]);
    expect(lines[0]!.runs).toEqual([{ text: "aaaa", color: colorToCss(L_GREEN) }]);
    expect(lines[1]!.runs).toEqual([{ text: "bbbb", color: colorToCss(L_RED) }]);
  });

  it("hard-breaks a word longer than the width", () => {
    const tb: Textblock = { runs: [{ text: "abcdefgh", attr: WHITE }] };
    const lines = wrapRuns(tb, 5); /* width 4 */
    expect(lines.map((l) => l.text)).toEqual(["abcd", "efgh"]);
  });
});
