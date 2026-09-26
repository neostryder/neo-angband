/**
 * The screenText mod seam (core mod/hooks.ts), host side: `restateView` over a
 * built screen, and the prompt restater in overlay.ts's row-0 prompts.
 *
 * The fixtures are the texts the seam exists for: the help symbols page (a
 * paragraph line and a table cell), the equipment-comparison selection help's
 * page-down legend, and its code-entry prompt, which a core constant supplies.
 * Each is checked twice: reachable with the exact text and a site precise
 * enough to match it alone, and untouched when no mod contributes the hook.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EQUIP_CMP_FILTER_PROMPT, type ScreenTextSite } from "@rpgm-tools/neo-angband-core";
import { getChar, getString, promptTextInline, showTextScreen } from "./overlay";
import { helpSymbolsScreen } from "./help";
import { equipCmpSelectHelpScreen } from "./equip-cmp";
import { restateView, screenBodyLines, type ScreenTextRestate } from "./screen-view";
import { PROMPT_SITE, restateScreen, setScreenTextSource } from "./screen-text";
import type { GlyphTerm } from "./term";

/* No jsdom here (help.test.ts explains why): a fake `window` and a plain
 * string grid stand in, as overlay.test.ts's own fixtures do. */
interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ type: string; fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

function makeTerm(cols = 80, rows = 24): GlyphTerm & { snapshot(): string[] } {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const put = (x: number, y: number, text: string): void => {
    const row = grid[y];
    if (!row) return;
    for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
  };
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => put(x, y, text),
    eraseToEol: (x: number, y: number) => {
      const row = grid[y];
      if (row) for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
    },
    prt: (x: number, y: number, text: string) => {
      const row = grid[y];
      if (row) for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
      put(x, y, text);
    },
    setCursor: () => {},
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
  } as unknown as GlyphTerm & { snapshot(): string[] };
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

/** Every piece of text the hook was offered, with its site. */
function recorder(
  answer: (raw: string, site: ScreenTextSite) => string = (raw) => raw,
): { hook: ScreenTextRestate; seen: { raw: string; site: ScreenTextSite }[] } {
  const seen: { raw: string; site: ScreenTextSite }[] = [];
  return {
    seen,
    hook: (raw, site) => {
      seen.push({ raw, site });
      return answer(raw, site);
    },
  };
}

/** The bug-fixes correction for ui-equip-cmp.c:925, matched the way a mod would match it. */
const pageDownFix: ScreenTextRestate = (raw, site) =>
  site.screen === "core:equip-cmp-select-help" &&
  site.part === "cell" &&
  site.row?.key1 === "n, PgDn" &&
  raw === "move selection one page up"
    ? "move selection one page down"
    : raw;

/** The qol restatement for ui-equip-cmp.c:1258. */
const QOL_PROMPT = "Enter 2-character code (3 for a stat) and Return, or just Return to clear ";

afterEach(() => {
  setScreenTextSource(null);
  delete (globalThis as { window?: unknown }).window;
});

describe("restateView: the help pages, line by line and cell by cell", () => {
  it("offers a symbols paragraph line and a symbols table cell, each with its site", () => {
    const { hook, seen } = recorder();
    restateView(helpSymbolsScreen(), hook);
    expect(seen).toContainEqual({
      raw: "picked up such as treasure, weapons, magical devices, etc; and creatures",
      site: { screen: "core:help-symbols", part: "line" },
    });
    const smith = seen.find((s) => s.raw === "Entrance to Weapon Smith");
    expect(smith?.site).toMatchObject({ screen: "core:help-symbols", part: "cell", column: "desc2" });
    expect(smith?.site.row).toMatchObject({ glyph: "^", desc: "A trap (known)", glyph2: "3" });
    expect(seen.some((s) => s.raw === "Lights, Tools, Chests, etc" && s.site.part === "cell")).toBe(true);
    expect(seen.some((s) => s.site.part === "title")).toBe(true);
  });

  it("draws what the hook answers, and leaves every other row byte-identical", () => {
    const faithful = screenBodyLines(helpSymbolsScreen());
    const restated = screenBodyLines(
      restateView(helpSymbolsScreen(), (raw) =>
        raw === "character's well being." ? "character's well-being." : raw,
      ),
    );
    expect(restated.map((l) => l.text)).toEqual(
      faithful.map((l) => (l.text === "character's well being." ? "character's well-being." : l.text)),
    );
  });

  it("an identity hook changes nothing at all", () => {
    const view = helpSymbolsScreen();
    expect(screenBodyLines(restateView(view, (raw) => raw))).toEqual(screenBodyLines(view));
  });

  it("with no mod contributing the hook, restateScreen hands back the same view object", () => {
    const view = helpSymbolsScreen();
    expect(restateScreen(view)).toBe(view);
  });
});

describe("restateView: the equipment-comparison page-down legend", () => {
  it("tells the page-down row's cell from the page-up row's identical text by its row", () => {
    const rows = screenBodyLines(restateView(equipCmpSelectHelpScreen(), pageDownFix)).map((l) => l.text);
    expect(rows).toContain("n, PgDn   move selection one page down");
    expect(rows).toContain("p, PgUp   move selection one page up");
    const faithful = screenBodyLines(equipCmpSelectHelpScreen()).map((l) => l.text);
    expect(faithful).toContain("n, PgDn   move selection one page up");
  });
});

describe("showTextScreen restates the view once, before it is drawn", () => {
  it("draws the restated legend on the faithful terminal", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { hook, seen } = recorder(pageDownFix);
    setScreenTextSource(() => hook);
    const term = makeTerm();
    void showTextScreen(term, equipCmpSelectHelpScreen());
    const screen = term.snapshot();
    expect(screen).toContain("n, PgDn   move selection one page down");
    expect(screen).toContain("p, PgUp   move selection one page up");
    /* Once per piece, not once per repaint. */
    const pieces = seen.filter((s) => s.raw === "move selection one page up");
    expect(pieces).toHaveLength(2);
    press(win, "Escape");
  });

  it("draws the faithful legend when no mod contributes the hook", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void showTextScreen(term, equipCmpSelectHelpScreen());
    expect(term.snapshot()).toContain("n, PgDn   move selection one page up");
    press(win, "Escape");
  });
});

describe("row-0 prompts pass their prompt through the hook once", () => {
  it("reaches the equipment-comparison code-entry prompt, a core constant", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { hook, seen } = recorder((raw) => (raw === EQUIP_CMP_FILTER_PROMPT ? QOL_PROMPT : raw));
    setScreenTextSource(() => hook);
    const term = makeTerm();
    const done = promptTextInline(term, EQUIP_CMP_FILTER_PROMPT, "", 3);
    expect(seen).toEqual([{ raw: EQUIP_CMP_FILTER_PROMPT, site: PROMPT_SITE }]);
    expect(term.snapshot()[0]).toBe(QOL_PROMPT.trimEnd());
    press(win, "S");
    press(win, "t");
    press(win, "r");
    /* The answer field starts where the SHOWN prompt ends. */
    expect(term.snapshot()[0]).toBe(`${QOL_PROMPT}Str`);
    press(win, "Enter");
    expect(await done).toBe("Str");
    expect(seen).toHaveLength(1);
  });

  it("draws the prompt as given when no mod contributes the hook", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void promptTextInline(term, EQUIP_CMP_FILTER_PROMPT, "", 3);
    expect(term.snapshot()[0]).toBe(EQUIP_CMP_FILTER_PROMPT.trimEnd());
    press(win, "Escape");
  });

  it("get_string narrows its answer to what fits after the SHOWN prompt", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    /* A 70-column restatement leaves room for 10 - 1 = 9 characters on an
     * 80-column row (askfor_aux, ui-input.c:881-882). */
    setScreenTextSource(() => (raw) => (raw === "File name: " ? "x".repeat(70) : raw));
    const term = makeTerm();
    const done = getString(term, "File name: ", "", 160);
    for (const ch of "abcdefghijkl") press(win, ch);
    press(win, "Enter");
    expect(await done).toBe("abcdefghi");
  });

  it("getChar restates the caller's prompt once, before adding its options", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { hook, seen } = recorder((raw) => (raw === "Pick one " ? "Choose one " : raw));
    setScreenTextSource(() => hook);
    const term = makeTerm();
    const done = getChar(term, "Pick one ", "ab");
    expect(term.snapshot()[0]).toBe("Choose one [ab]");
    press(win, "a");
    expect(await done).toBe("a");
    expect(seen.map((s) => s.raw)).toEqual(["Pick one "]);
  });
});
