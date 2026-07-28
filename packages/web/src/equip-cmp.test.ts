/**
 * Guards for the equipment-comparison screen's keyboard ownership and its quick
 * filter. showEquipCmp draws to a live GlyphTerm and installs a window listener,
 * so like render-background.test.ts this reads the source and asserts the two
 * properties that were wrong:
 *
 *  1. Nested overlays must run with this screen's listener DETACHED. Every
 *     overlay here listens on window in the capture phase and this screen's
 *     handler - registered first - opens with stopImmediatePropagation(), so
 *     while it stayed attached the item picker 'x' opens never saw a single key
 *     and ESC tore down the whole screen from underneath it. Seen live.
 *  2. The 'q' / '!' quick filter (prompt_for_easy_filter, ui-equip-cmp.c:1229)
 *     exists at all - it was called a "UI convenience" and skipped.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./equip-cmp.ts", import.meta.url), "utf8");

describe("the equip-cmp screen's keyboard ownership", () => {
  it("detaches its own listener around a nested overlay, and reattaches after", () => {
    const nested = SRC.slice(SRC.indexOf("const nested ="));
    const body = nested.slice(0, nested.indexOf("\n    };") + 7);
    expect(body).toContain('window.removeEventListener("keydown", onKey, true)');
    expect(body).toMatch(/finally \{\s*window\.addEventListener\("keydown", onKey, true\);/);
  });

  it("routes the compare picker and the help screen through it", () => {
    expect(SRC).toMatch(/await nested\(runSelect\)/);
    expect(SRC).toMatch(/await nested\(showHelp\)/);
  });

  it("prompts for the filter code through it too", () => {
    const fn = SRC.slice(SRC.indexOf("const runFilterPrompt ="));
    expect(fn.slice(0, 400)).toMatch(/nested\(\(\) =>\s*promptTextInline\(term, EQUIP_CMP_FILTER_PROMPT/);
  });
});

describe("the equip-cmp quick filter keys", () => {
  it("binds q and ! to the filter prompt, with ! as the inverted sense", () => {
    expect(SRC).toMatch(/case "q":[\s\S]{0,120}runFilterPrompt\(false\)/);
    expect(SRC).toMatch(/case "!":[\s\S]{0,120}runFilterPrompt\(true\)/);
  });

  it("clears the filter on an empty answer and leaves it alone on ESC", () => {
    const fn = SRC.slice(SRC.indexOf("const runFilterPrompt ="));
    const body = fn.slice(0, fn.indexOf("\n    };") + 7);
    // ESC (null) returns before anything is touched; "" clears.
    expect(body).toMatch(/if \(code === null\) return;/);
    expect(body).toMatch(/if \(code === ""\) \{\s*filter = null;/);
    // A code that names nothing reports it and changes nothing.
    expect(body).toMatch(/if \(!match\) \{\s*dlgMsg = EQUIP_CMP_FILTER_NO_MATCH;\s*return;/);
  });

  it("feeds the filter into the model and lets R reset it", () => {
    expect(SRC).toMatch(/const summaryOpts = \(\): EquipCmpOptions => \(\{[\s\S]{0,120}filter,/);
    const reset = SRC.slice(SRC.indexOf('case "R":'));
    expect(reset.slice(0, 200)).toContain("filter = null");
  });
});
