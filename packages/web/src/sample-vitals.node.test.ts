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
      { key: "hp", runs: [{ text: "HP ", color: RED, css: "#f00" }, { text: "20/20", color: L_GREEN, css: "#0f0" }] },
      { key: "depth", runs: [{ text: "50 feet", color: L_GREEN, css: "#0f0" }] },
      /* A field with no text at all: a warrior's spell points. The panel must
       * skip it rather than drawing an empty labelled row. */
      { key: "sp", runs: [{ text: "", color: L_GREEN, css: "#0f0" }] },
    ],
    placements: [
      { key: "hp", row: 2 },
      { key: "sp", row: 3 },
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

    /* Two fields drawn, not three: the blank `sp` is skipped rather than
     * rendered as an empty labelled row. Each drawn field is a label plus its
     * value, so four fillText calls. */
    const texts = draws.filter((d) => d.op === "fillText").map((d) => String(d.args[0]));
    expect(texts).toEqual(["Health", "HP 20/20", "Depth", "50 feet"]);
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
