import { describe, expect, it } from "vitest";
import {
  colorToCss,
  colorTextToAttr,
  COLOUR_RED,
  COLOUR_MUD,
  COLOUR_WHITE,
  COLOUR_L_WHITE,
} from "@neo-angband/core";
import { parseNewsLine, titleKeyChoice, titleRows, titleRowSpans } from "./news";

describe("news title screen markup (news.txt {colour}...{/})", () => {
  it("colours bare text (outside any tag) COLOUR_WHITE", () => {
    expect(parseNewsLine("For help press '?' in-game")).toEqual([
      { text: "For help press '?' in-game", css: colorToCss(COLOUR_WHITE) },
    ]);
  });

  it("resolves a single {name}...{/} span by colour name", () => {
    expect(parseNewsLine("{red}Angband{/}")).toEqual([
      { text: "Angband", css: colorToCss(COLOUR_RED) },
    ]);
    expect(colorTextToAttr("red")).toBe(COLOUR_RED);
  });

  it("splits multiple spans on one line and returns to white after {/}", () => {
    expect(parseNewsLine("{mud}^^^{/}{red}_{/}  x")).toEqual([
      { text: "^^^", css: colorToCss(COLOUR_MUD) },
      { text: "_", css: colorToCss(COLOUR_RED) },
      { text: "  x", css: colorToCss(COLOUR_WHITE) },
    ]);
  });

  it("resolves the multi-word 'light slate' name used by the quote lines", () => {
    // news.txt draws the quote / website / forums in {light slate} = Light Slate.
    expect(parseNewsLine("{light slate}Website{/}")).toEqual([
      { text: "Website", css: colorToCss(COLOUR_L_WHITE) },
    ]);
    expect(colorTextToAttr("light slate")).toBe(COLOUR_L_WHITE);
  });

  it("preserves leading spaces (the art's baked-in centring)", () => {
    const runs = parseNewsLine("{mud}   ^   {/}");
    expect(runs).toEqual([{ text: "   ^   ", css: colorToCss(COLOUR_MUD) }]);
  });
});

/**
 * The title screen's keys are main-win.c's File menu (win/angband.rc:8-13),
 * because the splash itself takes no keys at all - it paints news.txt and waits
 * on that menu (main-win.c:5475). The screen it replaced advanced on ANY key,
 * including a bare Shift, and on a click anywhere.
 */
describe("title screen keys (main-win.c File menu)", () => {
  const ALL = { canLoad: true, canOpen: true, canQuit: true };

  it("offers New / Open / Load / Quit in the File menu's order", () => {
    expect(titleRows(ALL).map((r) => r.choice)).toEqual(["new", "open", "load", "quit"]);
    expect(titleRows(ALL).map((r) => r.key)).toEqual(["n", "o", "l", "q"]);
  });

  it("maps each row's letter, in either case", () => {
    for (const [key, want] of [["n", "new"], ["o", "open"], ["l", "load"], ["q", "quit"]] as const) {
      expect(titleKeyChoice(key, titleRows(ALL), false)).toBe(want);
      expect(titleKeyChoice(key.toUpperCase(), titleRows(ALL), false)).toBe(want);
    }
  });

  // main-win.c:4453-4455: KTRL('N') is New, KTRL('O') is Open, KTRL('X') is Exit.
  it("honours upstream's Ctrl accelerators, and Ctrl-X is Quit not 'x'", () => {
    expect(titleKeyChoice("n", titleRows(ALL), true)).toBe("new");
    expect(titleKeyChoice("o", titleRows(ALL), true)).toBe("open");
    expect(titleKeyChoice("x", titleRows(ALL), true)).toBe("quit");
    /* Bare 'x' is not a row. */
    expect(titleKeyChoice("x", titleRows(ALL), false)).toBeNull();
    /* Ctrl-L is not an upstream accelerator, so it is not one here. */
    expect(titleKeyChoice("l", titleRows(ALL), true)).toBeNull();
  });

  // The reported bug: "Even pressing a modifier key on the title screen advances
  // it to character selection."
  it("ignores modifier-only presses", () => {
    for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]) {
      expect(titleKeyChoice(key, titleRows(ALL), false)).toBeNull();
    }
  });

  it("ignores every other key, including Enter, Space and Escape", () => {
    for (const key of ["Enter", " ", "Escape", "a", "z", "F1", "ArrowDown"]) {
      expect(titleKeyChoice(key, titleRows(ALL), false)).toBeNull();
    }
  });

  // EnableMenuItem greys rows that do not apply (main-win.c:2957-2990); a greyed
  // item does nothing when picked.
  it("a disabled row is inert, by key and by accelerator", () => {
    const none = titleRows({ canLoad: false, canOpen: false, canQuit: false });
    expect(none.filter((r) => r.enabled).map((r) => r.choice)).toEqual(["new"]);
    expect(titleKeyChoice("l", none, false)).toBeNull();
    expect(titleKeyChoice("o", none, false)).toBeNull();
    expect(titleKeyChoice("q", none, false)).toBeNull();
    expect(titleKeyChoice("o", none, true)).toBeNull();
    expect(titleKeyChoice("x", none, true)).toBeNull();
    /* New is always live at the splash (main-win.c:2973). */
    expect(titleKeyChoice("n", none, false)).toBe("new");
  });

  it("lays the rows out centred, in order, without overlapping", () => {
    const spans = titleRowSpans(titleRows(ALL), 80);
    expect(spans.map((s) => s.row.choice)).toEqual(["new", "open", "load", "quit"]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThan(spans[i - 1]!.end);
    }
    /* Centred: the leading gap matches the trailing one within a column. */
    const lead = spans[0]!.start;
    const trail = 80 - 1 - spans[spans.length - 1]!.end;
    expect(Math.abs(lead - trail)).toBeLessThanOrEqual(1);
    /* Every span is a real label's worth of columns. */
    for (const s of spans) expect(s.end - s.start + 1).toBe(s.row.label.length);
  });
});
