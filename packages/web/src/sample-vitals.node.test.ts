/**
 * The `samples/vitals-panel` mod, exercised as a mod.
 *
 * WHY THIS EXISTS AT ALL. The same reason its sibling does: a sample in a docs
 * folder is code nobody runs, and this repository has shipped seams whose tests
 * were green while the shipped path did nothing (#245, #246, #247). So the
 * sample is loaded from DISK by its real path, validated by the real manifest
 * validator, selected through the real HUD selection, and driven with a real
 * `HudFrame` - and what it draws is recorded, so "it drew" is an assertion.
 *
 * What it proves that `hud-runtime.test.ts` cannot is that the seam is USABLE:
 * the runtime tests hand fabricated sinks to fabricated candidates, which will
 * pass for as long as the two agree with each other. This one is a real mod
 * written against the documented shape, and it fails if that shape is wrong.
 *
 * What it canNOT prove is pixels in the installed build; that needs the desktop
 * build over CDP and is recorded separately in MOD_REACH gap 21.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { screenRegions, type ScreenRegions } from "./regions";
import { buildHudFrame, type HudFrame } from "./hud-view";
import {
  CORE_HUD_ID,
  coreHudCandidate,
  hudFrameSink,
  installHud,
  type HudPlugin,
} from "./hud-runtime";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";

const SAMPLE = fileURLToPath(new URL("../../../samples/vitals-panel/", import.meta.url));

const manifest = JSON.parse(readFileSync(`${SAMPLE}manifest.json`, "utf8")) as Record<
  string,
  unknown
>;

interface Draw {
  readonly op: string;
  readonly args: readonly unknown[];
}

function recordingDocument(draws: Draw[]): {
  readonly doc: unknown;
  readonly element: { readonly style: Record<string, string> };
  readonly created: string[];
} {
  const created: string[] = [];
  const ctx2d = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: unknown[]) => void draws.push({ op: String(prop), args });
      },
      set(_t, prop: string, value: unknown) {
        draws.push({ op: `set:${prop}`, args: [value] });
        return true;
      },
    },
  );
  /* No clientWidth/clientHeight, deliberately: the sample must take its size
   * from the region the section carries, and a plausible element size here would
   * let a regression back to "fill whatever the canvas happens to be" pass. */
  const element = {
    id: "",
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === "2d" ? ctx2d : null),
  };
  return {
    doc: {
      createElement: (tag: string) => {
        created.push(tag);
        return element;
      },
      body: { appendChild: () => undefined },
    },
    element,
    created,
  };
}

/**
 * A small Left-sidebar screen with real geometry: an 18x8 terminal whose vitals
 * column is 13 cells wide at column 0 row 1. Cells are 12x20 CSS pixels at a
 * letterbox offset of (4, 6), so the sidebar region lands at (4, 26) and is
 * 156x140. Built by the SAME producer main.ts calls.
 */
const REGIONS = screenRegions(
  {
    cols: 18,
    rows: 8,
    sidebar: "left",
    sidebarWidth: 13,
    mapOriginX: 13,
    mapTop: 1,
    mapCols: 4,
    mapRows: 6,
  },
  { cellWidth: 12, cellHeight: 20, originX: 4, originY: 6 },
);

const RED = 4;
const L_GREEN = 13;

/* `null` for "this host published none", not `undefined` - passing undefined to
 * a defaulted parameter selects the DEFAULT, so the no-region test would have
 * quietly run with regions and passed for the wrong reason. */
function frame(regions: ScreenRegions | null = REGIONS): HudFrame {
  return buildHudFrame({
    layout: "left",
    cols: 18,
    rows: 8,
    sidebarWidth: 13,
    mapOriginX: 13,
    mapCols: 4,
    vitals: [
      {
        key: "hp",
        runs: [{ text: "HP  ", color: RED, css: "#f00" }, { text: "7/20", color: L_GREEN, css: "#0f0" }],
        /* The pair that means "proportion". The text beside it is deliberately
         * a DIFFERENT rendering of the same fact, so a panel that quietly went
         * back to parsing the string is visible in what it drew. */
        values: { current: 7, max: 20 },
      },
      {
        key: "str",
        runs: [{ text: "STR:  ", color: RED, css: "#f00" }, { text: "18/100", color: L_GREEN, css: "#0f0" }],
        /* Three numbers, none of them the `current`/`max` pair - because 118 is
         * an encoding meaning 18/100 and a bar over it would read 15%. */
        values: { use: 118, cur: 118, max: 118 },
      },
      { key: "depth", runs: [{ text: "50 feet", color: L_GREEN, css: "#0f0" }] },
      /* A field with no text at all: a warrior's spell points. The panel must
       * skip it rather than drawing an empty labelled row. */
      { key: "sp", runs: [{ text: "", color: L_GREEN, css: "#0f0" }] },
    ],
    placements: [
      { key: "hp", row: 2 },
      { key: "str", row: 3 },
      { key: "sp", row: 4 },
      { key: "depth", row: 5 },
    ],
    compactKeys: ["hp"],
    indicators: [{ key: "state", runs: [{ text: "Fed 89 % ", color: 1, css: "#fff" }] }],
    message: { text: "You have a mushroom.", css: "#fff" },
    regions: regions ?? { map: REGIONS.map },
  });
}

async function loadSample(): Promise<ModPlugin> {
  const mod = (await import(`${SAMPLE}plugin.js`)) as { default: ModPlugin };
  return mod.default;
}

function context(doc: unknown): ModPluginContext {
  (globalThis as { document?: unknown }).document = doc;
  return {
    id: "vitals-panel",
    api: 1,
    engine: "0.19.1",
    flags: {},
    /* Only the colour attributes are read, and by NAME - exactly the surface the
     * sample documents itself as depending on. */
    core: { COLOUR_RED: RED, COLOUR_L_GREEN: L_GREEN } as never,
    assetUrl: async () => null,
    data: {},
    prefs: { get: () => undefined, set: () => undefined } as never,
    newCharacter: false,
    log: () => undefined,
  } as unknown as ModPluginContext;
}

async function install(doc: unknown, faults: string[] = []) {
  const plugin = await loadSample();
  const candidate: HudPlugin = { id: "vitals-panel", manifest: manifest as never, plugin };
  return installHud(
    [coreHudCandidate({ present: () => undefined }), candidate],
    () => context(doc),
    (id, message) => faults.push(`${id}: ${message}`),
  );
}

describe("samples/vitals-panel, as the game would load it", () => {
  it("lives in a folder named for its own id", () => {
    /* readPack refuses a mismatch outright, because every other surface (the
     * enabled set, the load order, a save's provenance) keys off the manifest
     * id. A sample is the folder people copy, so the rule holds here first. */
    expect(basename(SAMPLE.replace(/[\\/]$/u, ""))).toBe(manifest.id);
  });

  it("declares the ONE capability its own hud() needs, and no more", () => {
    /* Not the wildcard: a sample that asked for the whole interface to draw one
     * region would teach exactly the habit the per-region grant exists to break. */
    expect(manifest.capabilities).toEqual(["ui:sidebar.replace"]);
    expect(manifest.shape).toBe("plugin");
    expect(typeof manifest.repository).toBe("string");
    expect(typeof manifest.author).toBe("string");
    expect(typeof manifest.engine).toBe("string");
  });

  it("wins the vitals, leaves the rest with the game, and draws what it is given", async () => {
    const draws: Draw[] = [];
    const { doc, created } = recordingDocument(draws);
    const faults: string[] = [];
    const installed = await install(doc, faults);

    expect(faults).toEqual([]);
    expect(installed.owners.sidebar.id).toBe("vitals-panel");
    /* THE POINT OF THE WHOLE SEAM: it took one region. */
    expect(installed.owners.messages.id).toBe(CORE_HUD_ID);
    expect(installed.owners.status.id).toBe(CORE_HUD_ID);
    expect(created).toEqual(["canvas"]);

    hudFrameSink(installed, () => undefined).present(frame());

    /* Its own ground first - the panel OWNS the region rather than decorating
     * over the terminal's drawing of it. */
    expect(draws[0]?.op).toBe("setTransform");
    const box = REGIONS.sidebar!.pixels!;
    expect(draws.find((d) => d.op === "fillRect")?.args).toEqual([0, 0, box.width, box.height]);

    /* Three fields drawn, not four: the blank `sp` is skipped rather than
     * rendered as an empty labelled row. Each drawn field is a label plus its
     * value. `hp` writes its numbers from `values`, so "7/20" and not the
     * "HP  7/20" its runs spell. */
    const texts = draws.filter((d) => d.op === "fillText").map((d) => String(d.args[0]));
    expect(texts).toEqual(["Health", "7/20", "STR", "STR:  18/100", "Depth", "50 feet"]);
  });

  it("draws a bar for the field that is a proportion, and only that field", async () => {
    /* The reason `values` exists (MOD_REACH gap 21). Before it, the only source
     * for a bar was `"HP   20/  20"` - a rendering, and one that changes when a
     * pref file is loaded or the game is played in another language.
     *
     * What is pinned is the RULE, not the field: the panel asks every entry for
     * a `current`/`max` pair. `hp` has one and gets a bar; `str` publishes three
     * numbers that are not a ratio and correctly gets text. A panel keyed on
     * `entry.key === "hp"` would pass a weaker version of this test and would
     * draw nothing for a field a content pack adds. */
    const draws: Draw[] = [];
    const { doc } = recordingDocument(draws);
    hudFrameSink(await install(doc), () => undefined).present(frame());

    const box = REGIONS.sidebar!.pixels!;
    /* The panel's own ground, then exactly two bar rects: a track and a fill.
     * The str row adds none. */
    const rects = draws.filter((d) => d.op === "fillRect").map((d) => d.args);
    expect(rects[0]).toEqual([0, 0, box.width, box.height]);
    expect(rects).toHaveLength(3);

    const [, track, fill] = rects as [unknown, number[], number[]];
    /* Same origin, same height; the fill is 7/20 of the track's width. Rounded
     * by the panel, so this is derived from the track rather than asserted as a
     * pixel count that would move if the fixture's geometry did. */
    expect(fill[0]).toBe(track[0]);
    expect(fill[1]).toBe(track[1]);
    expect(fill[3]).toBe(track[3]);
    expect(fill[2]).toBe(Math.round(track[2]! * (7 / 20)));
    expect(fill[2]).toBeGreaterThan(0);
    expect(fill[2]).toBeLessThan(track[2]!);
  });

  it("clamps a proportion rather than drawing outside its own region", async () => {
    /* `chp > mhp` is reachable: a potion of Cure Critical Wounds heals past the
     * maximum for a moment, and prt_hp prints it happily. An unclamped fill
     * would paint over the map - and the region seam exists to make that
     * impossible even when a mod is careless. */
    const draws: Draw[] = [];
    const { doc } = recordingDocument(draws);
    const overfull = frame();
    const hp = overfull.sidebar!.entries.find((e) => e.key === "hp")!;
    (hp as { values?: Record<string, number> }).values = { current: 30, max: 20 };
    hudFrameSink(await install(doc), () => undefined).present(overfull);

    const rects = draws.filter((d) => d.op === "fillRect").map((d) => d.args);
    const [, track, fill] = rects as [unknown, number[], number[]];
    expect(fill[2]).toBe(track[2]);
  });

  it("colours from the ENGINE's attribute, through its own palette", async () => {
    /* The claim of the seam, made falsifiable. `run.css` in this frame is
     * "#f00"/"#0f0"; the panel's palette has neither, so a sample that had
     * quietly used the terminal's colour would show up here. */
    const draws: Draw[] = [];
    const { doc } = recordingDocument(draws);
    hudFrameSink(await install(doc), () => undefined).present(frame());

    const styles = draws.filter((d) => d.op === "set:fillStyle").map((d) => String(d.args[0]));
    /* HP's first run is COLOUR_RED, and the panel's own red is what came out. */
    expect(styles).toContain("#c8404a");
    expect(styles).not.toContain("#f00");
    expect(styles).not.toContain("#0f0");
  });

  it("puts its canvas on the vitals region, and nowhere else", async () => {
    const draws: Draw[] = [];
    const { doc, element } = recordingDocument(draws);
    hudFrameSink(await install(doc), () => undefined).present(frame());

    const box = REGIONS.sidebar!.pixels!;
    expect(element.style.left).toBe(`${box.x}px`);
    expect(element.style.top).toBe(`${box.y}px`);
    expect(element.style.width).toBe(`${box.width}px`);
    expect(element.style.height).toBe(`${box.height}px`);
    expect(element.style.display).toBe("block");
    expect(element.style.inset).toBeUndefined();
  });

  it("draws nothing at all when the host publishes no region", async () => {
    /* A panel that fell back to a guess whenever geometry was missing would land
     * over the map - INTERMITTENTLY, which is worse than always. */
    const draws: Draw[] = [];
    const { doc, element } = recordingDocument(draws);
    hudFrameSink(await install(doc), () => undefined).present(frame(null));

    expect(draws).toEqual([]);
    expect(element.style.display).toBe("none");
  });

  it("is never called under the None sidebar layout", async () => {
    /* The player turned the vitals off. A mod putting them back would be
     * overriding a choice rather than styling one. */
    const draws: Draw[] = [];
    const { doc } = recordingDocument(draws);
    const installed = await install(doc);
    hudFrameSink(installed, () => undefined).present(
      buildHudFrame({
        layout: "none",
        cols: 18,
        rows: 8,
        sidebarWidth: 13,
        mapOriginX: 0,
        mapCols: 17,
        vitals: [],
        placements: [],
        compactKeys: [],
        indicators: [],
        message: { text: "", css: "#fff" },
        regions: { map: REGIONS.map },
      }),
    );
    expect(draws).toEqual([]);
  });

  it("reads the SEMANTIC fields, never the terminal's own projection", () => {
    /* A sample that read `run.css` and `entry.screen` would draw a
     * correct-looking panel and would prove nothing, so this is asserted against
     * the source rather than against the output. */
    const raw = readFileSync(`${SAMPLE}plugin.js`, "utf8");
    /* Comments stripped first, or the docblock explaining that it does not read
     * `run.css` is itself the match that fails this. */
    const source = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(source).not.toMatch(/\.css\b/u);
    expect(source).not.toMatch(/\.screen\b/u);
    expect(source).toMatch(/\.key\b/u);
    expect(source).toMatch(/\.color\b/u);
    expect(source).toMatch(/\.values\b/u);
    /* And no imports: a folder plugin gets the engine through ctx. */
    expect(source).not.toMatch(/^\s*import\s/mu);
  });

  it("declines rather than throwing where there is no DOM", async () => {
    /* A throwing factory costs the mod its region AND is reported as its fault.
     * "Not here" is not a fault, and the sample is what authors will copy. */
    const faults: string[] = [];
    const installed = await install(undefined, faults);
    expect(faults).toEqual([]);
    expect(installed.owners.sidebar.id).toBe(CORE_HUD_ID);
  });
});
