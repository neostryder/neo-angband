/**
 * Upstream unit tests from reference/src/tests/z-textblock/textblock.c
 * (suite z-textblock/textblock).
 *
 * WHAT THIS FILE IS AND IS NOT. z-textblock has two halves. The ACCUMULATOR half
 * (textblock_new / _append / _append_c / _append_textblock / _text / _attrs) is
 * what these four upstream cases exercise, and it is what the port models as a
 * stream of coloured runs in obj/object-info.ts. The WRAPPING half
 * (textblock_calculate_lines, z-textblock.c L237, and textui_textblock_show,
 * ui-output.c) is NOT touched by this upstream suite and is not covered here.
 *
 * Mapping:
 * - textblock_new -> tbNew
 * - textblock_append(tb, fmt, ...) -> tbAppend(tb, text). Upstream vformats;
 *   the port's call sites interpolate before appending, so the format arguments
 *   of test_append become an interpolated string on this side. What survives is
 *   the property the case is really about: successive appends CONCATENATE.
 * - textblock_append_c -> tbAppendC
 * - textblock_append_textblock -> tbAppendTextblock
 * - textblock_text(tb) -> textblockToString(tb)
 * - textblock_attrs(tb) -> textblockAttrs(tb). Upstream keeps text and attrs as
 *   two parallel per-CHARACTER arrays; the port keeps runs, and textblockAttrs
 *   is the flattening. attrs[i] is therefore the colour of
 *   textblockToString(tb)[i], exactly as upstream's arrays line up.
 * - textblock_free -> nothing (garbage collected). test_alloc is the C's
 *   allocation smoke test and has no counterpart.
 */

import { describe, expect, it } from "vitest";
import { COLOUR_L_BLUE, COLOUR_L_GREEN, COLOUR_WHITE } from "../color";
import {
  tbAppend,
  tbAppendC,
  tbAppendTextblock,
  tbNew,
  textblockAttrs,
  textblockToString,
} from "./object-info";

describe("z-textblock/textblock upstream", () => {
  // C: test_append
  it("test_append", () => {
    const tb = tbNew();
    expect(textblockToString(tb)).toBe("");

    tbAppend(tb, "Hello");
    expect(textblockToString(tb)).toBe("Hello");

    /* C: textblock_append(tb, "%d", 20) -- the port interpolates first. */
    tbAppend(tb, `${20}`);
    expect(textblockToString(tb)).toBe("Hello20");

    /* Uncoloured appends are COLOUR_WHITE, which is what the C's attr is. */
    expect(textblockAttrs(tb)).toEqual(new Array(7).fill(COLOUR_WHITE));
  });

  // C: test_colour
  it("test_colour", () => {
    const tb = tbNew();
    const text = "two";
    const attrs = [COLOUR_L_GREEN, COLOUR_L_GREEN, COLOUR_L_GREEN];

    tbAppendC(tb, COLOUR_L_GREEN, text);

    /* The colour applies to EVERY character of the appended text, not just
     * the first -- upstream memsets the whole span (z-textblock.c L132). */
    expect(textblockAttrs(tb)).toEqual(attrs);
    expect(textblockToString(tb)).toBe("two");
  });

  // C: test_length
  it("test_length", () => {
    const tb = tbNew();
    const text = "1234567";

    /* Add it 32 times to make sure that appending definitely works. */
    for (let i = 0; i < 32; i++) tbAppend(tb, text);

    /* Now make sure it's all right. */
    const tbText = textblockToString(tb);
    const n = text.length;
    for (let i = 0; i < 32; i++) {
      expect(tbText.slice(i * n, i * n + n)).toBe(text);
    }
    expect(tbText).toHaveLength(32 * n);
  });

  // C: test_append_textblock
  it("test_append_textblock", () => {
    const attrs = [
      COLOUR_L_BLUE,
      COLOUR_L_BLUE,
      COLOUR_L_BLUE,
      COLOUR_L_GREEN,
      COLOUR_L_GREEN,
      COLOUR_L_GREEN,
      COLOUR_L_GREEN,
    ];
    const tb1 = tbNew();
    const tb2 = tbNew();

    tbAppendC(tb1, COLOUR_L_BLUE, "Hey");
    tbAppendC(tb2, COLOUR_L_GREEN, " you");
    tbAppendTextblock(tb1, tb2);

    expect(textblockToString(tb1)).toBe("Hey you");
    expect(textblockAttrs(tb1)).toEqual(attrs);

    /*
     * The SOURCE is left intact. Upstream's callers (obj-info.c L2135,
     * effects-info.c L262/L296/L367, ui-equip-cmp.c L1457/L1462,
     * ui-knowledge.c L3052) all textblock_free the source right after
     * appending it, which is only correct because the merge copies.
     */
    expect(textblockToString(tb2)).toBe(" you");
    expect(textblockAttrs(tb2)).toEqual(attrs.slice(3));
  });

  /*
   * Not an upstream case, but the C gets it for free and a runs model does not:
   * the merge must COPY each run, not alias it. Upstream memcpys into tb's own
   * buffer, so after textblock_append_textblock the two textblocks share no
   * storage at all and either can be written or freed independently. Pushing the
   * source's run objects by reference would look identical until something
   * edited a run in place, so this edits one to prove the independence.
   */
  it("append_textblock copies the source's runs rather than aliasing them", () => {
    const tb1 = tbNew();
    const tb2 = tbNew();
    tbAppendC(tb2, COLOUR_L_GREEN, " you");
    tbAppendTextblock(tb1, tb2);

    expect(tb1.runs[0]).not.toBe(tb2.runs[0]);
    /* Rewriting the destination's run must not reach into the source. */
    tb1.runs[0]!.text = "CLOBBERED";
    tb1.runs[0]!.attr = COLOUR_L_BLUE;
    expect(textblockToString(tb2)).toBe(" you");
    expect(textblockAttrs(tb2)).toEqual(new Array(4).fill(COLOUR_L_GREEN));

    /* And appending to the destination must not grow the source. */
    tbAppend(tb1, "!");
    expect(tb2.runs).toHaveLength(1);
  });
});
