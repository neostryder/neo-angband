/**
 * The consent notices are drawn by Core on the terminal, and the painter keeps
 * the rightmost cell free, so every row has to fit in `cols - 1` or its end is
 * cut off mid-word (neostryder/neo-angband#481).
 */

import { afterEach, describe, expect, it } from "vitest";

import { coreDrawnBodyLines, showTextScreen } from "./overlay";
import { linesScreen, SCREEN_FOOTER } from "./screen-view";
import { unreviewedNoticeScreen } from "./mods";
import { buildCatalog } from "./mod-store";
import { assignTier } from "./mod-tier";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { GridPointerInput, GridSurface } from "./term";

const LONG_BULLET =
  "  - Add new menu rows and replace what existing menu rows do, including the rows of the game's own menus  [powerful]";
const LONG_SENTENCE =
  "You allowed an earlier version of this mod, and this one wants more than that, so its code is not running until you say yes to the rest of what it asks for.";

function regrantView() {
  return {
    ...linesScreen("Imported v2.0.0", [
      { text: LONG_SENTENCE, color: "w" },
      { text: "", color: "w" },
      { text: LONG_BULLET, color: "y" },
    ], SCREEN_FOOTER),
    id: "core:mod-capability-regrant",
  };
}

const words = (text: string): string[] => text.split(/\s+/u).filter(Boolean);

describe("Core-drawn notices wrap inside the painted width (#481)", () => {
  it("wraps a long lines row at spaces, and hangs a bullet's text under itself", () => {
    const rows = coreDrawnBodyLines(regrantView(), 80);
    for (const row of rows) expect(row.text.length, row.text).toBeLessThanOrEqual(79);
    expect(words(rows.map((r) => r.text).join(" "))).toEqual([...words(LONG_SENTENCE), ...words(LONG_BULLET)]);
    const bullet = rows.findIndex((r) => r.text.startsWith("  - Add"));
    expect(rows[bullet + 1]?.text.startsWith("    ")).toBe(true);
    expect(rows[bullet + 1]?.color).toBe("y");
  });

  it("wraps the unreviewed notice's prose to the painted width too", () => {
    const manifest = { id: "imported", name: "An Imported Mod With A Long Name", version: "1.0.0", shape: "plugin" } as PackManifest;
    const tier = assignTier({ id: "imported", source: "installed", execution: "worker", listing: "file" });
    const row = buildCatalog({ content: [], sandbox: [], trusted: [manifest], enabled: [], consents: {}, tierOf: () => tier })[0]!;
    for (const cols of [40, 64, 80]) {
      for (const line of coreDrawnBodyLines(unreviewedNoticeScreen(row), cols)) {
        expect(line.text.length, `${String(cols)}: ${line.text}`).toBeLessThanOrEqual(cols - 1);
      }
    }
  });

  describe("on the terminal", () => {
    interface FakeWindow {
      addEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
      removeEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
      dispatchEvent(ev: Event): void;
    }
    afterEach(() => {
      delete (globalThis as { window?: unknown }).window;
    });

    it("shows every word of a long consent line", async () => {
      const listeners: { t: string; fn: (ev: Event) => void }[] = [];
      const win: FakeWindow = {
        addEventListener: (t, fn) => void listeners.push({ t, fn }),
        removeEventListener: (t, fn) => {
          const i = listeners.findIndex((l) => l.t === t && l.fn === fn);
          if (i >= 0) listeners.splice(i, 1);
        },
        dispatchEvent: (ev) => {
          for (const l of [...listeners].filter((x) => x.t === ev.type)) l.fn(ev);
        },
      };
      (globalThis as { window?: unknown }).window = win;
      const cols = 80;
      const grid: string[][] = Array.from({ length: 24 }, () => new Array<string>(cols).fill(" "));
      const term = {
        size: () => ({ cols, rows: 24 }),
        clear: () => grid.forEach((r) => r.fill(" ")),
        print: (x: number, y: number, text: string) => {
          for (let i = 0; i < text.length && x + i < cols; i++) grid[y]![x + i] = text[i] ?? " ";
        },
        eraseToEol: () => undefined,
        prt: () => undefined,
        setCursor: () => undefined,
        onCellTap: () => () => undefined,
      } as unknown as GridSurface & GridPointerInput;
      const done = showTextScreen(term, regrantView());
      await Promise.resolve();
      const shown = grid.map((r) => r.join("").trimEnd()).join(" ");
      for (const word of [...words(LONG_SENTENCE), ...words(LONG_BULLET)]) {
        expect(words(shown), word).toContain(word);
      }
      const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
      ev.key = "Escape";
      win.dispatchEvent(ev);
      await done;
    });
  });
});
