/**
 * MILESTONE 6: a mod creates a region, and the map goes on being drawn under it.
 *
 * THE SHAPE IS `sample-blueprint.node.test.ts`'s, deliberately. That file proves
 * commit 4 by loading a real sample from DISK by its real path, validating its
 * real manifest, putting it through the real selection and driving it with a
 * real frame. This one does the same for commit 5, because the failure this
 * repository keeps re-learning is a seam whose unit tests are green while the
 * shipped path does nothing (#245, #246, #247) - and a region seam proved with a
 * hand-written spec object would be exactly that. Nothing here is a mock: the
 * declaration comes out of `samples/sprite-inventory/plugin.js`, the capability
 * comes out of its manifest, `installRegions` is the shell's own installer, and
 * the picture is read off a real cell grid after `paintRegionStack`.
 *
 * WHAT "BESIDE A LIVE MAP" HAS TO MEAN TO BE WORTH ASSERTING. A panel drawn on a
 * blank terminal proves nothing - the interesting claim is that core is STILL
 * DRAWING THE DUNGEON while a mod's rectangle sits on it. So the map is painted
 * first, by hand, into the cells `screenRegions` says the map occupies; the
 * stack is then composited over it; and what is checked is that the map survived
 * everywhere the panel is not. A region that had called `term.clear()` - which is
 * what every screen in this shell did before #261 - would wipe that map, and the
 * assertion below is what would see it.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { baseRegionStack, occludersOf, screenRegions } from "./regions";
import { installRegions, REGION_CAPABILITY, type RegionPlugin } from "./region-runtime";
import { liveRegionStack, paintRegionStack, relayoutStack, resetRegionStack } from "./ui-stack";
import type { ClippableSurface } from "./region-surface";
import type { Glyph, TermSize } from "./term";
import type { ModPluginContext } from "./mod-plugin";

const SAMPLE = fileURLToPath(new URL("../../../samples/sprite-inventory/", import.meta.url));

const manifest = JSON.parse(readFileSync(`${SAMPLE}manifest.json`, "utf8")) as Record<
  string,
  unknown
>;

const COLS = 60;
const ROWS = 14;

/**
 * The Left layout at 60x14: sidebar 0..12, map at column 13, 46 wide, 12 tall.
 * Built by the SAME producer `main.ts` calls, so a change to how the screen is
 * divided reaches this test rather than only a copy of the numbers.
 */
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

/** A real cell grid. The question is what is on screen, not who was called. */
class GridDouble implements ClippableSurface {
  readonly cells: (string | null)[][];
  constructor(
    readonly cols = COLS,
    readonly rows = ROWS,
  ) {
    this.cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, (): string | null => null),
    );
  }
  /* DELIBERATELY ABSENT: no `eraseSpan`. The sample anchors its panel to the
   * right edge precisely so that it needs no bounded erase, and a double that
   * supplied one would let a regression to a floating, mid-screen panel pass
   * here and then be refused on a real host. */
  row(y: number): string {
    return (this.cells[y] ?? []).map((c) => c ?? " ").join("").replace(/\s+$/u, "");
  }
  size(): TermSize {
    return { cols: this.cols, rows: this.rows };
  }
  invalidate(): void {}
  flush(): void {}
  clear(): void {
    for (const row of this.cells) row.fill(null);
  }
  setCursor(): void {}
  hideCursor(): void {}
  put(x: number, y: number, glyph: Glyph): void {
    const row = this.cells[y];
    if (!row || x < 0 || x >= this.cols) return;
    row[x] = glyph.ch;
  }
  print(x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) this.put(x + i, y, { ch: text[i]!, fg: "#fff" });
  }
  eraseToEol(x: number, y: number): void {
    const row = this.cells[y];
    if (!row) return;
    for (let cx = Math.max(0, x); cx < this.cols; cx++) row[cx] = null;
  }
  prt(x: number, y: number, text: string): void {
    this.eraseToEol(x, y);
    this.print(x, y, text);
  }
}

/** Core drawing the dungeon, into exactly the cells the map region names. */
function paintLiveMap(term: GridDouble): void {
  const { col, row, cols, rows } = LAYOUT.map.cells;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) term.put(col + x, row + y, { ch: "#", fg: "#fff" });
  }
}

interface ScreenRow {
  readonly tag: string;
  readonly cells: { readonly name: { readonly text: string } };
  readonly color: string;
}

/** The inventory as the screen seam publishes it - a table with keyed cells. */
function inventoryView(rows: readonly ScreenRow[]): unknown {
  return {
    id: "core:inventory",
    title: "Inventory",
    footer: "",
    blocks: [{ kind: "table", columns: [{ key: "name" }], rows }],
  };
}

function item(tag: string, name: string, color = "#d7dde8"): ScreenRow {
  return { tag, cells: { name: { text: name } }, color };
}

const CONTEXT = { id: "sprite-inventory", api: 1, log: () => undefined } as unknown as ModPluginContext;

/**
 * Enough `document` for the sample's SCREEN half to mount, so the region can be
 * driven from the listing the screen seam really hands it.
 *
 * Only the screen half needs this. The region draws on the character grid and
 * needs no DOM at all, which is a property worth having and is asserted on its
 * own below - so this fixture is scoped to the one test that opens a screen
 * rather than installed for the file.
 */
function withFakeDocument<T>(body: () => T): T {
  const g = globalThis as { document?: unknown };
  const previous = g.document;
  const ctx2d = new Proxy({}, { get: () => () => undefined, set: () => true });
  const element = {
    id: "",
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === "2d" ? ctx2d : null),
  };
  g.document = {
    createElement: () => element,
    body: { appendChild: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  try {
    return body();
  } finally {
    if (previous === undefined) delete g.document;
    else g.document = previous;
  }
}

interface SamplePlugin {
  readonly api: number;
  regions?(ctx: ModPluginContext): unknown;
  screen?(ctx: ModPluginContext): { show(view: unknown, host?: unknown): unknown } | undefined;
}

async function loadSample(): Promise<SamplePlugin> {
  const mod = (await import(`${SAMPLE}plugin.js`)) as { default: SamplePlugin };
  return mod.default;
}

/** The sample as a candidate the shell's own installer will accept. */
function candidate(plugin: SamplePlugin): RegionPlugin {
  return { id: "sprite-inventory", manifest: manifest as never, plugin: plugin as never };
}

beforeEach(() => {
  resetRegionStack();
});

describe("samples/sprite-inventory, as the game would load its region", () => {
  it("lives in a folder named for its own id", () => {
    /* The rule the shipped path caught for `blueprint-view` and its own test did
     * not: `readPack` refuses a folder whose name is not the manifest id, and a
     * sample is the folder people copy. */
    expect(basename(SAMPLE.replace(/[\\/]$/u, ""))).toBe(manifest.id);
  });

  it("declares the capability its own regions() requires, and it is not a replace", () => {
    /* THE CONSENT, and the reason it is a separate string. `ui:*.replace` would
     * not have granted this even though this mod holds a `ui:` capability
     * already - the wildcard ranges over which of the GAME's regions changes
     * hands, and adding one of your own is a different sentence. */
    expect(manifest.capabilities).toContain(REGION_CAPABILITY);
    expect(manifest.capabilities).not.toContain("ui:*.replace");
    expect(manifest.shape).toBe("plugin");
  });

  it("declares a region only in a band a mod is allowed to have", () => {
    /* Read off the SOURCE the sample ships, not off a copy: a sample asking for
     * `system` would be teaching authors to reach for the one band that is
     * reserved so the player can always turn a mod off. */
    const raw = readFileSync(`${SAMPLE}plugin.js`, "utf8");
    const source = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(source).toMatch(/layer:\s*"overlay"/u);
    expect(source).not.toMatch(/layer:\s*"system"/u);
    /* And no imports: a folder plugin gets everything through ctx. */
    expect(source).not.toMatch(/^\s*import\s/mu);
  });

  it("goes on the stack under its own mod's name, above the base layout", async () => {
    const plugin = await loadSample();
    const faults: string[] = [];
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });

    const installed = installRegions(
      [candidate(plugin)],
      () => CONTEXT,
      (id, message) => void faults.push(`${id}: ${message}`),
      { cols: COLS, rows: ROWS },
    );

    expect(faults).toEqual([]);
    expect(installed.map((r) => r.id)).toEqual(["sprite-inventory:carried"]);
    /* The four base tiles first, the mod's panel above them - by construction,
     * because `base` is the bottom band and the mod asked for `overlay`. */
    expect(liveRegionStack().map((r) => r.id)).toEqual([
      ...baseRegionStack(LAYOUT).map((r) => r.id),
      "sprite-inventory:carried",
    ]);
  });

  it("DRAWS BESIDE A LIVE MAP: the panel appears and the dungeon survives it", async () => {
    /* THE MILESTONE. Core paints the dungeon; the mod's region is composited
     * over it; and the map is still there everywhere the panel is not. Before
     * #261 the only way a screen knew how to start was `term.clear()`, and any
     * one of those would have taken the whole picture below with it. */
    const plugin = await loadSample();
    const term = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });

    /* The sample learns what is carried from the listing the SCREEN seam already
     * hands it - the same object `showTextScreen` publishes, not a side channel
     * this test invented. */
    withFakeDocument(() => {
      const presenter = plugin.screen!(CONTEXT);
      presenter!.show(
        inventoryView([item("a", "a Potion of Cure Light Wounds"), item("b", "a Scroll of Light")]),
      );
    });

    installRegions([candidate(plugin)], () => CONTEXT, () => {}, { cols: COLS, rows: ROWS });
    paintLiveMap(term);
    paintRegionStack(term);

    /* The panel: a title row and one row per item, right-anchored. */
    const width = 24;
    const left = COLS - width;
    expect(term.row(1).slice(left)).toBe("Inventory");
    expect(term.row(2).slice(left)).toBe("a) a Potion of Cure Ligh");
    expect(term.row(3).slice(left)).toBe("b) a Scroll of Light");

    /* THE MAP IS STILL LIVE UNDERNEATH. Every map row outside the panel's three
     * rows is untouched granite, and inside those three rows the map survives up
     * to the panel's left edge. A region that erased the terminal, or that
     * clamped its writes instead of dropping them, fails here. */
    const map = LAYOUT.map.cells;
    for (let y = map.row; y < map.row + map.rows; y++) {
      const covered = y >= 1 && y <= 3;
      const expectedRight = covered ? left : map.col + map.cols;
      const dungeon = term.row(y).slice(map.col, expectedRight);
      expect(dungeon, `map row ${y} lost its cells`).toBe("#".repeat(expectedRight - map.col));
    }
    /* And the sidebar columns, which belong to core and which nothing here
     * touched, were never written at all - checked on the CELLS rather than on
     * a rendered row, because a row of thirteen spaces and thirteen cells that
     * nobody wrote read the same once they are a string, and only one of them
     * is "the mod stayed off core's furniture". */
    for (let y = 0; y < ROWS; y++) {
      expect(
        term.cells[y]!.slice(0, 13).every((c) => c === null),
        `the mod wrote into core's sidebar on row ${y}`,
      ).toBe(true);
    }
  });

  it("is HONEST about covering the map, so a front end can stand down", async () => {
    /* The panel does overlap the map's right-hand columns, and the seam says so
     * rather than hiding it. This is the question `samples/blueprint-view` asks
     * on every frame, and the answer has to name the mod that is in the way -
     * otherwise a player with two mods has no idea which one to turn off. */
    const plugin = await loadSample();
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });
    installRegions([candidate(plugin)], () => CONTEXT, () => {}, { cols: COLS, rows: ROWS });

    const over = occludersOf(liveRegionStack(), "map");
    expect(over).toBeDefined();
    expect(over!.map((r) => r.id)).toEqual(["sprite-inventory:carried"]);
  });

  it("survives a resize by re-placing, not by remembering where it was", async () => {
    /* `place()` runs on every layout change, which is the whole reason its
     * contract is "return a rectangle and do no work". A panel that had cached
     * its rectangle would be hanging off the edge here - or worse, be refused as
     * off-grid and vanish, which is what the player would actually report. */
    const plugin = await loadSample();
    relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });
    const [installed] = installRegions([candidate(plugin)], () => CONTEXT, () => {}, {
      cols: COLS,
      rows: ROWS,
    });
    expect(installed!.handle.cells()!.col).toBe(COLS - 24);

    relayoutStack({ cols: 30, rows: 8 });
    expect(installed!.handle.fault()).toBeUndefined();
    expect(installed!.handle.cells()!.col).toBe(30 - 24);

    /* Narrower and shorter than the panel wants: it clamps rather than running
     * off, because `place()` must be TOTAL. An off-grid rectangle is refused
     * with a named fault, and a sample that tripped that would teach the wrong
     * lesson. Asserted as the INVARIANT rather than as one rectangle, because
     * the panel's height depends on how many items it last saw - a number this
     * file changes in an earlier test, so a hard-coded height here would be a
     * fact about test ordering wearing a fact about placement's clothes. */
    for (const [cols, rows] of [
      [10, 4],
      [4, 2],
      [1, 1],
    ] as const) {
      relayoutStack({ cols, rows });
      expect(installed!.handle.fault(), `faulted at ${cols}x${rows}`).toBeUndefined();
      const at = installed!.handle.cells()!;
      expect(at.col).toBeGreaterThanOrEqual(0);
      expect(at.row).toBeGreaterThanOrEqual(0);
      expect(at.col + at.cols).toBeLessThanOrEqual(cols);
      expect(at.row + at.rows).toBeLessThanOrEqual(rows);
      expect(at.cols).toBeGreaterThan(0);
      expect(at.rows).toBeGreaterThan(0);
    }
  });
});
