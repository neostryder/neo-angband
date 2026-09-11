import { readFileSync } from "node:fs";
import { COLOUR_RED, colorToCss } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { MessageLog } from "./messages";
import {
  applySubwindowVisibility,
  MessageSubwindowPainter,
  paintSubwindowLines,
  readSubwindowSettings,
  SUBWINDOW_STORAGE_KEY,
  writeSubwindowSettings,
} from "./subwindows";
import type { GridSurface } from "./term";

function recordingTerm(cols: number, rows: number): GridSurface & {
  text(): string[];
  colors(): (string | undefined)[][];
} {
  const chars = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  const colors = Array.from({ length: rows }, () => new Array<string | undefined>(cols));
  return {
    size: () => ({ cols, rows }),
    invalidate: () => undefined,
    flush: () => undefined,
    clear: () => {
      for (const row of chars) row.fill(" ");
      for (const row of colors) row.fill(undefined);
    },
    setCursor: () => undefined,
    hideCursor: () => undefined,
    put: () => undefined,
    print: (x, y, text, color) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        chars[y]![x + i] = text[i]!;
        colors[y]![x + i] = color;
      }
    },
    eraseToEol: () => undefined,
    prt: () => undefined,
    text: () => chars.map((row) => row.join("").replace(/\s+$/u, "")),
    colors: () => colors,
  };
}

describe("subwindow settings", () => {
  it("defaults to the unchanged single-window layout and survives storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    expect(readSubwindowSettings(storage)).toEqual({
      messages: false,
      inventory: false,
      monsters: false,
      items: false,
    });
    writeSubwindowSettings(storage, {
      messages: true,
      inventory: true,
      monsters: false,
      items: true,
    });
    expect(readSubwindowSettings(storage)).toEqual({
      messages: true,
      inventory: true,
      monsters: false,
      items: true,
    });
    writeSubwindowSettings(storage, {
      messages: false,
      inventory: false,
      monsters: false,
      items: false,
    });
    expect(values.has(SUBWINDOW_STORAGE_KEY)).toBe(false);
  });

  it("shows only enabled slots and removes the whole column when all are off", () => {
    const column = { hidden: false, dataset: {} as DOMStringMap };
    const messages = { hidden: false };
    const inventory = { hidden: false };
    const monsters = { hidden: false };
    const items = { hidden: false };
    const slots = { messages, inventory, monsters, items };
    applySubwindowVisibility(column, slots, {
      messages: false,
      inventory: false,
      monsters: false,
      items: false,
    });
    expect(column.hidden).toBe(true);
    applySubwindowVisibility(column, slots, {
      messages: true,
      inventory: true,
      monsters: false,
      items: true,
    });
    expect({
      column: column.hidden,
      messages: messages.hidden,
      inventory: inventory.hidden,
      monsters: monsters.hidden,
      items: items.hidden,
    }).toEqual({ column: false, messages: false, inventory: false, monsters: true, items: false });
    expect(column.dataset.count).toBe("3");
  });
});

describe("subwindow terminal painting", () => {
  it("bottom-aligns the newest message rows", () => {
    const term = recordingTerm(20, 4);
    paintSubwindowLines(term, [{ text: "older" }, { text: "newest" }], true);
    expect(term.text()).toEqual(["", "", "older", "newest"]);
  });

  it("marks only messages since the previous refresh red", () => {
    const term = recordingTerm(30, 4);
    const log = new MessageLog();
    const painter = new MessageSubwindowPainter();
    log.push("older", "#00ff00");
    painter.paint(term, log);
    log.push("newest", "#00ffff");
    painter.paint(term, log);
    expect(term.text()).toEqual(["", "", "older", "newest"]);
    expect(term.colors()[2]![0]).toBe("#00ff00");
    expect(term.colors()[3]![0]).toBe(colorToCss(COLOUR_RED));
  });

  it("repaints unchanged messages after the panel grid changes size", () => {
    const first = recordingTerm(30, 4);
    const resized = recordingTerm(12, 2);
    const log = new MessageLog();
    const painter = new MessageSubwindowPainter();
    log.push("a message long enough to clip", "#00ff00");
    painter.paint(first, log);
    painter.paint(resized, log);
    expect(resized.text()).toEqual(["", "a message lo"]);
  });
});

describe("production subwindow wiring", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

  it("provides separate canvases and repaints them with each live game frame", () => {
    expect(html).toContain('id="subwindow-messages"');
    expect(html).toContain('id="subwindow-inventory"');
    expect(html).toContain('id="subwindow-monsters"');
    expect(html).toContain('id="subwindow-items"');
    expect(main).toContain("const messageSubwindowTerm = new GlyphTerm");
    expect(main).toContain("const inventorySubwindowTerm = new GlyphTerm");
    expect(main).toContain("const monsterSubwindowTerm = new GlyphTerm");
    expect(main).toContain("const itemListSubwindowTerm = new GlyphTerm");
    expect(main).toMatch(/renderSubwindows\(\);\s+paintRegionStack\(term\);/u);
  });
});
