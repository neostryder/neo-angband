/**
 * Region ownership is a fact about the cells the compositor actually painted,
 * not about a declaration's rectangle. The shipped inventory sample is the
 * regression fixture because its panel overlaps the map in a real game.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { screenRegions } from "./regions";
import { installRegions, type RegionPlugin } from "./region-runtime";
import { paintRegionStack, pushRegion, regionInputAt, relayoutStack, resetRegionStack } from "./ui-stack";
import type { ClippableSurface } from "./region-surface";
import type { Glyph, TermSize } from "./term";
import type { ModPluginContext } from "./mod-plugin";

const SAMPLE = fileURLToPath(new URL("../../../samples/sprite-inventory/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${SAMPLE}manifest.json`, "utf8")) as Record<string, unknown>;
const COLS = 60;
const ROWS = 14;
const LAYOUT = screenRegions({
  cols: COLS,
  rows: ROWS,
  sidebar: "left",
  sidebarWidth: 13,
  mapOriginX: 13,
  mapTop: 1,
  mapCols: COLS - 14,
  mapRows: ROWS - 2,
});

class GridDouble implements ClippableSurface {
  readonly cells = Array.from({ length: ROWS }, () => Array<string | null>(COLS).fill(null));

  size(): TermSize {
    return { cols: COLS, rows: ROWS };
  }
  invalidate(): void {}
  flush(): void {}
  clear(): void {
    for (const row of this.cells) row.fill(null);
  }
  setCursor(): void {}
  hideCursor(): void {}
  put(x: number, y: number, glyph: Glyph): void {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) this.cells[y]![x] = glyph.ch;
  }
  print(x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) this.put(x + i, y, { ch: text[i]!, fg: "#fff" });
  }
  eraseToEol(x: number, y: number): void {
    this.eraseSpan(x, y, COLS - x);
  }
  eraseSpan(x: number, y: number, len: number): void {
    if (y < 0 || y >= ROWS) return;
    for (let col = Math.max(0, x); col < Math.min(COLS, x + len); col++) this.cells[y]![col] = null;
  }
  prt(x: number, y: number, text: string): void {
    this.eraseToEol(x, y);
    this.print(x, y, text);
  }
}

function paintLiveMap(term: GridDouble): void {
  const { col, row, cols, rows } = LAYOUT.map.cells;
  for (let y = row; y < row + rows; y++) {
    for (let x = col; x < col + cols; x++) term.put(x, y, { ch: "#", fg: "#fff" });
  }
}

function withFakeDocument<T>(body: () => T): T {
  const global = globalThis as { document?: unknown };
  const previous = global.document;
  const context = new Proxy({}, { get: () => () => undefined, set: () => true });
  const element = {
    id: "",
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    getContext: () => context,
  };
  global.document = {
    createElement: () => element,
    body: { appendChild: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  try {
    return body();
  } finally {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  }
}

interface SamplePlugin {
  regions?(ctx: ModPluginContext): unknown;
  screen?(ctx: ModPluginContext): { show(view: unknown): unknown } | undefined;
}

async function loadSample(): Promise<SamplePlugin> {
  return (await import(`${SAMPLE}plugin.js`) as { default: SamplePlugin }).default;
}

const context = { id: "sprite-inventory", api: 1, log: () => undefined } as unknown as ModPluginContext;
const candidate = (plugin: SamplePlugin): RegionPlugin => ({
  id: "sprite-inventory",
  manifest: manifest as never,
  plugin: plugin as never,
});

function inventoryView(): unknown {
  return {
    id: "core:inventory",
    title: "Inventory",
    footer: "",
    blocks: [
      {
        kind: "table",
        columns: [{ key: "name" }],
        rows: [{ tag: "a", cells: { name: { text: "a Potion of Cure Light Wounds" } }, color: "#d7dde8" }],
      },
    ],
  };
}

beforeEach(() => {
  resetRegionStack();
});

describe("region input ownership", () => {
  it("MILESTONE 7: a tap on the shipped panel does not walk the player", async () => {
    const plugin = await loadSample();
    const term = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });
    withFakeDocument(() => plugin.screen!(context)!.show(inventoryView()));
    installRegions([candidate(plugin)], () => context, () => {}, { cols: COLS, rows: ROWS });
    paintLiveMap(term);
    paintRegionStack(term);

    const map = LAYOUT.map.cells;
    const col = COLS - 24;
    const row = map.row;
    expect(
      col >= map.col && col < map.col + map.cols && row >= map.row && row < map.row + map.rows,
      "the fixture stopped placing the panel over the map, where core would walk",
    ).toBe(true);
    expect(term.cells[row]![col], "the sample stopped drawing its panel").not.toBeNull();

    const owner = regionInputAt(col, row);
    expect(owner?.region.id).toBe("sprite-inventory:carried");
    expect(owner?.local).toEqual({ col: 0, row: 0 });
    expect(owner?.spec.input).toBeUndefined();
  });

  it("leaves an unclaimed map cell for core", () => {
    const term = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });
    paintLiveMap(term);
    paintRegionStack(term);
    expect(regionInputAt(LAYOUT.map.cells.col, LAYOUT.map.cells.row)).toBeUndefined();
  });

  it("does not claim a cell inside a region rectangle that it did not draw", () => {
    const term = new GridDouble();
    const cells = { col: 20, row: 3, cols: 5, rows: 5 };
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });
    pushRegion({
      id: "mod:ring",
      layer: "overlay",
      place: () => cells,
      paint: (surface) => {
        for (let row = 0; row < cells.rows; row++) {
          for (let col = 0; col < cells.cols; col++) {
            if (row === 0 || col === 0 || row === cells.rows - 1 || col === cells.cols - 1) {
              surface.put(col, row, { ch: "O", fg: "#fff" });
            }
          }
        }
      },
    });
    paintLiveMap(term);
    paintRegionStack(term);

    expect(term.cells[cells.row + 2]![cells.col + 2]).toBe("#");
    expect(regionInputAt(cells.col + 2, cells.row + 2)).toBeUndefined();
    expect(regionInputAt(cells.col, cells.row)?.region.id).toBe("mod:ring");
  });

  it("gives an overdrawn cell to the higher region", () => {
    const term = new GridDouble();
    const cells = { col: 20, row: 3, cols: 1, rows: 1 };
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });
    pushRegion({
      id: "mod:under",
      layer: "overlay",
      place: () => cells,
      paint: (surface) => surface.put(0, 0, { ch: "U", fg: "#fff" }),
    });
    pushRegion({
      id: "mod:over",
      layer: "modal",
      place: () => cells,
      paint: (surface) => surface.put(0, 0, { ch: "O", fg: "#fff" }),
    });
    paintLiveMap(term);
    paintRegionStack(term);

    expect(term.cells[cells.row]![cells.col]).toBe("O");
    expect(regionInputAt(cells.col, cells.row)?.region.id).toBe("mod:over");
  });
});
