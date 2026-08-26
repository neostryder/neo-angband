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
import { equipCmpHelpScreen, equipCmpSelectHelpScreen } from "./equip-cmp";
import { MODELLED_SCREENS, screenBodyLines, type ScreenTableBlock } from "./screen-view";

const SRC = readFileSync(new URL("./equip-cmp.ts", import.meta.url), "utf8");

describe("the equip-cmp screen's keyboard ownership", () => {
  it("detaches its own listener around a nested overlay, and reattaches after", () => {
    const nested = SRC.slice(SRC.indexOf("const nested ="));
    const body = nested.slice(0, nested.indexOf("\n    };") + 7);
    expect(body).toContain('inputEvents.removeEventListener("keydown", onKey, true)');
    expect(body).toMatch(/finally \{\s*inputEvents\.addEventListener\("keydown", onKey, true\);/);
  });

  it("routes both help screens and the comparison through it", () => {
    /* runSelect is gone: select mode is an input STATE over the same table now,
     * not a nested overlay (see the select-mode block below). What still nests is
     * the comparison it ends in, and the two help screens. */
    expect(SRC).toMatch(/await nested\(showHelp\)/);
    expect(SRC).toMatch(/await nested\(showSelHelp\)/);
    expect(SRC).toMatch(/nested\(\(\) => compare\(/);
    expect(SRC).not.toContain("runSelect");
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

/**
 * The screen's TEXT, checked against reference/src/ui-equip-cmp.c itself rather
 * than against a second copy written here - a pin that quotes my own transcription
 * proves only that I copied it twice. Every prt() literal in the two help
 * functions and every menu_display_state prompt has to appear verbatim.
 *
 * The two help screens are now `ScreenView` tables (`equipCmpHelpScreen` /
 * `equipCmpSelectHelpScreen`, in equip-cmp.ts), not a `ScreenLine[]` built
 * inline, so "appears verbatim" is checked by RENDERING the view through the
 * one renderer (`screenBodyLines`) and comparing the actual terminal rows it
 * produces to the C's own `prt()` calls - the whole reason the table model is
 * allowed to replace the transcription is that this comparison holds.
 *
 * This whole block exists because "is `?` wired?" turned out to be the wrong
 * question: it WAS wired, and everything it showed was invented.
 */
const C_SRC = readFileSync(
  new URL("../../../reference/src/ui-equip-cmp.c", import.meta.url),
  "utf8",
);

/** Every prt("...") literal inside one C function body, in source order. */
function prtLiterals(fn: string): string[] {
  const start = C_SRC.indexOf(`static void ${fn}(void)\n{`);
  expect(start, `${fn} not found in the C`).toBeGreaterThan(-1);
  const body = C_SRC.slice(start, C_SRC.indexOf("\n}\n", start));
  const out: string[] = [];
  for (const m of body.matchAll(/prt\("((?:[^"\\]|\\.)*)"/g)) {
    const text = JSON.parse(`"${m[1]!}"`) as string;
    /* The trailing "Press any key to continue" is showTextScreen's own footer. */
    if (text && text !== "Press any key to continue") out.push(text);
  }
  expect(out.length, `no prt() literals parsed out of ${fn}`).toBeGreaterThan(5);
  return out;
}

describe("the help screens are transcribed, not paraphrased", () => {
  it("renders display_equip_cmp_help byte-identical to the C's prt() calls (L377-414)", () => {
    /* The port's own added "left, right" line (see equip-cmp.ts's header note
     * and equipCmpHelpScreen's comment) is the one line in this screen the C
     * never draws, so it is spliced into the expected sequence at the same
     * spot the model puts it - right after "space    one page down" - rather
     * than pulled from prtLiterals, which only sees what the C actually wrote. */
    const upstream = prtLiterals("display_equip_cmp_help");
    const spliceAt = upstream.indexOf("space    one page down") + 1;
    const expected = [
      ...upstream.slice(0, spliceAt),
      "left, right  scroll the property columns",
      ...upstream.slice(spliceAt),
    ];
    const rendered = screenBodyLines(equipCmpHelpScreen(), 80).map((l) => l.text);
    expect(rendered).toEqual(expected);
  });

  it("renders display_equip_cmp_sel_help byte-identical to the C's prt() calls (L894-918)", () => {
    const rendered = screenBodyLines(equipCmpSelectHelpScreen(), 80).map((l) => l.text);
    expect(rendered).toEqual(prtLiterals("display_equip_cmp_sel_help"));
  });

  it("does not keep the old invented wording", () => {
    /* The paraphrase's own giveaways: it described 'c' by listing the four
     * sources and named the arrow keys "Left/Right". */
    expect(SRC).not.toContain("cycle equipment source (none / only store");
    expect(SRC).not.toContain("Left/Right  scroll property columns");
  });

  it("uses the two menu_display_state prompts verbatim (L313-324)", () => {
    for (const p of [
      "[k/up, j/down, p/PgUp, n/PgDn to move; ? for help; ESC to exit]",
      "[k/up, j/down, p/PgUp, n/PgDn to move; return to accept]",
    ]) {
      /* Present in the C with its line wrap, so compare on collapsed spaces. */
      const flat = C_SRC.replace(/"\s*\n\s*"/g, "");
      expect(flat, "prompt is not the C's").toContain(p);
      expect(SRC).toContain(`"${p}"`);
    }
    /* The invented footer key list is gone. */
    expect(SRC).not.toContain("[j/k move; n/p page;");
  });

  it("has the row-0 messages the C sets there, and no invented title", () => {
    expect(SRC).toContain('"No items; use q, !, c, or R to change filter"');
    expect(SRC).toContain('"Unknown key pressed; ? will list available keys"');
    /* prt() on row 0 never writes a screen title (L347-363). */
    expect(SRC).not.toMatch(/HEADER_ROW,\s*dlgMsg \|\| "Equipment comparison"/);
  });
});

describe("the two help screens are separate ScreenView documents", () => {
  it("carry different ids, both listed in MODELLED_SCREENS", () => {
    /* One title ("Equipment comparison - help") covers both, but the browsing
     * screen's help and select mode's are different CONTENT with different
     * commands available - a presenter drawing a tailored command palette
     * needs to tell them apart, which a shared id would hide. */
    expect(equipCmpHelpScreen().id).toBe("core:equip-cmp-help");
    expect(equipCmpSelectHelpScreen().id).toBe("core:equip-cmp-select-help");
    expect(MODELLED_SCREENS).toContain("core:equip-cmp-help");
    expect(MODELLED_SCREENS).toContain("core:equip-cmp-select-help");
  });

  it("gives a paired line's second key and description as their own cells, not a substring", () => {
    /* The upstream line "j, down  one line down    k, up    one line up" is ONE
     * row (screenBodyLines must reproduce it as one line - see the byte-identical
     * test above), but a presenter reading it never has to split a string to get
     * "k, up" and its description: they are cells `key2` / `desc2` on the row. */
    const block = equipCmpHelpScreen().blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table" && b.key === "movement-pairs",
    );
    const row = block?.rows[0];
    expect(row?.cells.key1?.text).toBe("j, down");
    expect(row?.cells.desc1?.text).toBe("one line down");
    expect(row?.cells.key2?.text).toBe("k, up");
    expect(row?.cells.desc2?.text).toBe("one line up");
  });

  it("treats the '---' section rules as table captions, never as a row", () => {
    const block = equipCmpHelpScreen().blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table" && b.key === "movement-pairs",
    );
    expect(block?.caption?.text).toBe("Movement/scrolling ---------------------------------");
    /* Only two rows - the caption is not a third one wearing a dashed disguise. */
    expect(block?.rows.length).toBe(2);
  });
});

describe("select mode is an input state over the table (L920-1225)", () => {
  const block = (() => {
    const at = SRC.indexOf("if (selState !== null) {");
    expect(at, "the select-mode branch is gone").toBeGreaterThan(-1);
    return SRC.slice(at, SRC.indexOf("\n      if (nav === \"up\")", at));
  })();

  it("is entered by x/I with work_sel at the top of the page (L810-815)", () => {
    const at = SRC.indexOf('case "I":');
    expect(at, 'x/I no longer starts select mode').toBeGreaterThan(-1);
    const enter = SRC.slice(at, at + 500);
    expect(enter).toContain("workSel = top");
    expect(enter).toContain("selState = 0");
    expect(enter).toContain('dlgMsg = t("equipCmp.select.firstPrompt", "Select first item to examine")');
  });

  it("takes the C's key set, and Enter accepts", () => {
    for (const k of ['"j"', '"k"', '"n"', '"p"', '"x"', '"Enter"', '"?"', '"Escape"']) {
      expect(block, `select mode ignores ${k}`).toContain(`case ${k}`);
    }
  });

  it("chains SEL0 -> SEL1 with upstream's second prompt", () => {
    expect(block).toMatch(
      /selState = 1;\s*dlgMsg = t\("equipCmp\.select\.secondPrompt", "Select second item; x to skip"\)/,
    );
  });

  it("x from SEL1 shows just the first item, and from SEL0 escapes (L1182-1191)", () => {
    const skip = block.slice(block.indexOf('case "x":'));
    expect(skip).toMatch(/if \(selState === 1\)/);
    expect(skip).toMatch(/compare\(first, null\)/);
  });

  it("reports an unrecognised key instead of swallowing it (L1220-1222)", () => {
    expect(block).toMatch(/default:\s*dlgMsg = unknownKeyMsg\(\);/);
    /* And so does general mode - the whole point of the message. */
    const general = SRC.slice(SRC.indexOf("/* ACT_CTX_EQUIPCMP_UNKNOWN"));
    expect(general.slice(0, 300)).toContain("dlgMsg = unknownKeyMsg()");
  });

  it("lights the already-chosen row while the second is picked (L222-224)", () => {
    expect(SRC).toMatch(/const selected = i === focus \|\| i === isel0;/);
  });

  it("does not paraphrase the prompts it replaced", () => {
    expect(SRC).not.toContain("Select first item to compare");
    expect(SRC).not.toContain("ESC to show just the first");
  });
});

describe("the 'd' dump (L765-783)", () => {
  it("exists at all, keyed to d", () => {
    /* The file's own header used to claim this worked. There was no case "d". */
    expect(SRC).toMatch(/case "d":[\s\S]{0,120}dumpToFile\(\)/);
  });

  it("offers player_safe_name + _equip.txt through get_file", () => {
    expect(SRC).toMatch(/getFile\(term, dumpFileName\(deps\.playerName, "_equip\.txt"\)\)/);
  });

  it("reports with the C's own two messages", () => {
    expect(SRC).toContain('"Successfully saved to file"');
    expect(SRC).toContain('"Failed to save to file!"');
  });

  it("writes the label rows, the combined row and every item (L1509-1545)", () => {
    const fn = SRC.slice(SRC.indexOf("const dumpText ="));
    const body = fn.slice(0, fn.indexOf("\n    };") + 7);
    expect(body).toMatch(/for \(const which of \[0, 1\]\)/); // the two label rows
    expect(body).toContain("model.combinedCells");
    expect(body).toContain("for (const item of model.items)");
    /* "Back up over spaces" (L1528-1530). */
    expect(body).toMatch(/replace\(\/ \+\$\/, ""\)/);
  });
});
