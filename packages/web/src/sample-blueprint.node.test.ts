/**
 * The `samples/blueprint-view` mod, exercised as a mod.
 *
 * WHY THIS EXISTS AT ALL. A sample in a docs folder is code nobody runs, and
 * this repository has now shipped three seams whose tests were green while the
 * shipped path did nothing (#245, #246, #247). So the sample is loaded from
 * DISK by its real path, validated by the real manifest validator, selected
 * through the real front-end selection, and driven with a real `WorldFrame` -
 * and what it draws is recorded, so "it drew" is an assertion rather than a
 * screenshot somebody looked at once.
 *
 * What this canNOT prove is pixels in the installed build; that needs the
 * desktop build over CDP and is recorded separately in MOD_REACH gap 9. This is
 * the half that can fail in CI.
 *
 * The other half HAS since been run (2026-08-13, 0.19.0 desktop, character
 * loaded, mod enabled through the manager's own consent flow): it drew, and it
 * found two things this file could not. The folder-name rule is now the first
 * test below. The second was a hole in the seam rather than a bug in the sample:
 * a front end covered the whole window, hiding the sidebar, the message line and
 * every menu the game was still drawing underneath - including the Mods screen
 * you would use to turn it off. `frame.regions` closed it (#234), and the two
 * tests at the end of this file are what hold it closed: the sample is placed on
 * the region it was given, and draws NOTHING when it is given none.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildWorldFrame, type WorldCell, type WorldFrame } from "./world-view";
import { baseRegionStack, screenRegions, type LiveRegion, type ScreenRegions } from "./regions";
import {
  coreFrontendCandidate,
  frontendWorldFrameSink,
  installFrontend,
  CORE_FRONTEND_ID,
  type FrontendPlugin,
} from "./frontend-runtime";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";

const SAMPLE = fileURLToPath(new URL("../../../samples/blueprint-view/", import.meta.url));

const manifest = JSON.parse(readFileSync(`${SAMPLE}manifest.json`, "utf8")) as Record<
  string,
  unknown
>;

/** Every 2d call the sample makes, in order, with its arguments. */
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
        if (prop === "setTransform" || typeof prop === "symbol") {
          return (...args: unknown[]) => void draws.push({ op: String(prop), args });
        }
        return (...args: unknown[]) => void draws.push({ op: prop, args });
      },
      set(_t, prop: string, value: unknown) {
        draws.push({ op: `set:${prop}`, args: [value] });
        return true;
      },
    },
  );
  /* No clientWidth/clientHeight: since #234 the sample takes its size from the
   * region the frame carries, and leaving a plausible element size here would
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
 * A frame with one of everything the sample branches on.
 *
 * Built through `buildWorldFrame`, the same producer `render()` uses, so a
 * change to the frame's shape breaks this rather than leaving the sample
 * reading fields that no longer exist.
 */
/**
 * A screen with the classic Left sidebar, small enough to reason about: an
 * 18x5 terminal, so the map is 4x3 at column 13 row 1 - `18 - 13 - 1` wide by
 * `5 - 1 - 1` high, which is the map the frame below actually carries. Cells
 * are 12x20 CSS pixels at a letterbox offset of (4, 6), so the map region lands
 * at (160, 26) and is 48x60. Built by the SAME producer main.ts calls, so a
 * change to how the screen is divided reaches the sample rather than only
 * reaching a copy of the numbers written out here.
 */
const REGIONS = screenRegions(
  {
    cols: 18,
    rows: 5,
    sidebar: "left",
    sidebarWidth: 13,
    mapOriginX: 13,
    mapTop: 1,
    mapCols: 4,
    mapRows: 3,
  },
  { cellWidth: 12, cellHeight: 20, originX: 4, originY: 6 },
);

/** The four base tiles as the live stack carries them: map at 13,1 and 4x3. */
const BASE_STACK = baseRegionStack(REGIONS);

/* `null` for "this host published none", not `undefined` - passing undefined to
 * a defaulted parameter selects the DEFAULT, so the no-region test would have
 * quietly run with regions and passed for the wrong reason. */
function frame(
  regions: ScreenRegions | null = REGIONS,
  stack: readonly LiveRegion[] | null = null,
): WorldFrame {
  const GRANITE = 21;
  const FLOOR = 1;
  return buildWorldFrame({
    width: 4,
    height: 3,
    origin: { x: 0, y: 0 },
    size: { width: 4, height: 3 },
    screenOrigin: { x: 13, y: 1 },
    ...(regions ? { regions } : {}),
    ...(stack ? { stack } : {}),
    resolveCell: (grid, screen): WorldCell => {
      if (grid.y === 0) {
        return { grid, screen, visibility: "seen", terrain: { kind: "terrain", id: GRANITE }, overlays: [], cursor: false };
      }
      if (grid.y === 1 && grid.x === 1) {
        return {
          grid,
          screen,
          visibility: "seen",
          terrain: { kind: "terrain", id: FLOOR },
          overlays: [{ kind: "monster", id: 7 }],
          cursor: false,
        };
      }
      if (grid.y === 2 && grid.x === 0) {
        return { grid, screen, visibility: "unknown", overlays: [], cursor: false };
      }
      return {
        grid,
        screen,
        visibility: "remembered",
        terrain: { kind: "terrain", id: FLOOR },
        overlays: [],
        cursor: false,
      };
    },
    player: {
      grid: { x: 2, y: 1 },
      screen: { x: 15, y: 2 },
      layer: { kind: "player" },
      visual: { ch: "@", fg: "w" },
      cursor: false,
    },
  });
}

async function loadSample(): Promise<ModPlugin> {
  const mod = (await import(`${SAMPLE}plugin.js`)) as { default: ModPlugin };
  return mod.default;
}

function context(doc: unknown): ModPluginContext {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = doc;
  void previous;
  return {
    id: "blueprint-view",
    api: 1,
    engine: "0.19.1",
    flags: {},
    /* Only FEAT is read, and by CODE - which is exactly the surface the sample
     * documents itself as depending on. */
    core: { FEAT: { SECRET: 15, MAGMA: 17, QUARTZ: 18, MAGMA_K: 19, QUARTZ_K: 20, GRANITE: 21, PERM: 22 } } as never,
    assetUrl: async () => null,
    data: {},
    prefs: { get: () => undefined, set: () => undefined } as never,
    newCharacter: false,
    log: () => undefined,
  } as unknown as ModPluginContext;
}

describe("samples/blueprint-view, as the game would load it", () => {
  it("lives in a folder named for its own id", () => {
    /* THE ONE THE SHIPPED PATH CAUGHT AND THIS FILE DID NOT (2026-08-13). The
     * sample shipped in `samples/frontend-blueprint/` declaring id
     * "blueprint-view", and readPack refuses that outright - `manifest says id
     * "blueprint-view"; rename the folder to match` - because every other
     * surface (the enabled set, the load order, a save's provenance) keys off
     * the manifest id. Every test below passed while the game would not load
     * the folder at all, because they reach the plugin by PATH and the path is
     * exactly what the rule is about.
     *
     * A sample is the folder people copy, so the rule has to hold here first. */
    expect(basename(SAMPLE.replace(/[\\/]$/u, ""))).toBe(manifest.id);
  });

  it("declares the capability its own frontend() requires", () => {
    /* The gate refuses a mod that declares frontend without display:replace,
     * and a sample that tripped its own gate would teach the wrong lesson. */
    expect(manifest.capabilities).toContain("display:replace");
    expect(manifest.shape).toBe("plugin");
    /* The three fields every real mod must carry - a sample is the file people
     * copy, so it has to be exemplary rather than minimal. */
    expect(typeof manifest.repository).toBe("string");
    expect(typeof manifest.author).toBe("string");
    expect(typeof manifest.engine).toBe("string");
  });

  it("wins the slot from core, and draws the frame it is given", async () => {
    const draws: Draw[] = [];
    const { doc, created } = recordingDocument(draws);
    const plugin = await loadSample();

    const faults: string[] = [];
    const core = coreFrontendCandidate({ present: () => faults.push("core drew") });
    const candidate: FrontendPlugin = {
      id: "blueprint-view",
      manifest: manifest as never,
      plugin,
    };
    const installed = installFrontend([core, candidate], () => context(doc), (id, message) =>
      faults.push(`${id}: ${message}`),
    );

    expect(faults).toEqual([]);
    expect(installed.id).toBe("blueprint-view");
    expect(installed.recovery).not.toBe(installed.sink);
    expect(created).toEqual(["canvas"]);

    installed.sink.present(frame());

    /* It painted its own ground first - the sample OWNS the display rather than
     * decorating over the terminal's. */
    expect(draws[0]?.op).toBe("setTransform");
    expect(draws.some((d) => d.op === "fillRect")).toBe(true);

    /* One wall row of 4 filled cells, plus the player's strokeRect. The counts
     * are the part that would silently go to zero if the sample started reading
     * a field the frame no longer has. */
    const fills = draws.filter((d) => d.op === "fillRect");
    expect(fills.length).toBe(1 /* paper */ + 4 /* the granite row */);
    expect(draws.filter((d) => d.op === "arc").length).toBe(1 /* the monster */);
    expect(draws.filter((d) => d.op === "strokeRect").length).toBe(1 /* the player */);
    /* 12 grids, minus the 4 that are granite and the 1 that is unknown, leaves
     * 7 hatched - the unknown grid being absent is the visibility branch doing
     * its job, and is the number that would go wrong first if the sample
     * started drawing space the player has not seen. */
    expect(draws.filter((d) => d.op === "stroke").length).toBe(7);

    const label = draws.find((d) => d.op === "fillText");
    expect(String(label?.args[0])).toContain("4x3");
    expect(String(label?.args[0])).toContain("12 cells");
  });

  it("puts its canvas on the map region, and nowhere else (#234)", async () => {
    /* THE DEFECT THIS IS ABOUT. Before regions, this sample was `position:
     * fixed; inset: 0` - it covered the window, so the sidebar, the message row,
     * the status line and every menu the game was still drawing went with it,
     * and the player could not reach the Mods screen to turn it off again.
     *
     * The numbers are the region's own, not a repeat of them: REGIONS is built
     * by the producer main.ts uses, so if the screen is divided differently
     * tomorrow this test follows it. What is pinned is that the canvas is placed
     * from the frame at all - `inset` and a percentage size are what it must
     * never go back to. */
    const draws: Draw[] = [];
    const { doc, element } = recordingDocument(draws);
    const plugin = await loadSample();
    const installed = installFrontend(
      [
        coreFrontendCandidate({ present: () => undefined }),
        { id: "blueprint-view", manifest: manifest as never, plugin },
      ],
      () => context(doc),
      () => undefined,
    );

    installed.sink.present(frame());

    const box = REGIONS.map.pixels!;
    expect(element.style.left).toBe(`${box.x}px`);
    expect(element.style.top).toBe(`${box.y}px`);
    expect(element.style.width).toBe(`${box.width}px`);
    expect(element.style.height).toBe(`${box.height}px`);
    expect(element.style.display).toBe("block");
    expect(element.style.inset).toBeUndefined();

    /* And it drew inside it: the paper fill is the region's size, not the
     * window's. A canvas placed correctly and then filled at 100vw would look
     * right in the style assertions above and still cover the game. */
    const paper = draws.find((d) => d.op === "fillRect");
    expect(paper?.args).toEqual([0, 0, box.width, box.height]);
  });

  it("draws nothing at all when the host publishes no region (#234)", async () => {
    /* A front end that fell back to the window whenever geometry was missing
     * would have the covering defect back on every host that has no fitted
     * surface - and it would have it INTERMITTENTLY, which is worse. The sample
     * hides its canvas instead, and this is the assertion that says so. */
    const draws: Draw[] = [];
    const { doc, element } = recordingDocument(draws);
    const plugin = await loadSample();
    const installed = installFrontend(
      [
        coreFrontendCandidate({ present: () => undefined }),
        { id: "blueprint-view", manifest: manifest as never, plugin },
      ],
      () => context(doc),
      () => undefined,
    );

    installed.sink.present(frame(null));

    expect(draws).toEqual([]);
    expect(element.style.display).toBe("none");
  });

  it("reads the SEMANTIC layers, never the terminal's glyph projection", () => {
    /* The whole claim of the seam. A sample that reverse-parsed `cell.visual.ch`
     * would still draw a correct-looking map and would prove nothing, so this
     * is asserted against the source rather than against the output. */
    const raw = readFileSync(`${SAMPLE}plugin.js`, "utf8");
    /* Comments stripped first, or the docblock explaining that it does not read
     * `cell.visual` is itself the match that fails this. */
    const source = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(source).not.toMatch(/\.visual\b/u);
    expect(source).toMatch(/\.visibility\b/u);
    expect(source).toMatch(/\.overlays\b/u);
    expect(source).toMatch(/\.terrain\b/u);
    /* And no imports: a folder plugin gets the engine through ctx. */
    expect(source).not.toMatch(/^\s*import\s/mu);
  });

  /* ----------------------------------------------------------------------- *
   * #261: the sample stands its canvas down when a screen opens over the map.
   *
   * EVERY ASSERTION IN THIS BLOCK GOES THROUGH `frontendWorldFrameSink`, and
   * that is the point rather than tidiness. The tests above call
   * `installed.sink.present` directly, which is the ADAPTER - it does not
   * snapshot. `snapshotWorldFrame` enumerates the frame's fields by hand, so the
   * failure this commit is most likely to ship is a live frame that carries
   * `stack` and a snapshot that quietly does not, with every live-frame test
   * still green. Reading the stack through the sink a mod is really given is the
   * only assertion that can see that, so this is where the defect is pinned.
   * ----------------------------------------------------------------------- */

  /** The sample, behind the exact sink the shipped path hands a mod. */
  async function modFacingSample(): Promise<{
    readonly present: (frame: WorldFrame) => void;
    readonly restate: (stack: readonly LiveRegion[]) => void;
    readonly element: { readonly style: Record<string, string> };
    readonly draws: Draw[];
    readonly faults: string[];
  }> {
    const draws: Draw[] = [];
    const { doc, element } = recordingDocument(draws);
    const plugin = await loadSample();
    const faults: string[] = [];
    const report = (id: string, message: string): void => void faults.push(`${id}: ${message}`);
    const installed = installFrontend(
      [
        coreFrontendCandidate({ present: () => faults.push("core drew") }),
        { id: "blueprint-view", manifest: manifest as never, plugin },
      ],
      () => context(doc),
      report,
    );
    const sink = frontendWorldFrameSink(installed, report);
    /* A MOD holds the display, so the stream is restatable. Core's is not, and
     * asserting that here would be asserting the wrong branch - the control for
     * it is in frontend-mod.node.test.ts. */
    expect(typeof sink.restate).toBe("function");
    return {
      present: (f) => sink.present(f),
      restate: (stack) => sink.restate!(stack),
      element,
      draws,
      faults,
    };
  }

  /** A screen that covers the whole 18x5 terminal, which core's do. */
  const SCREEN: LiveRegion = {
    id: "core:screen",
    layer: "modal",
    cells: { col: 0, row: 0, cols: 18, rows: 5 },
  };
  /* A region that is genuinely on screen and genuinely NOT over the map: the
   * sidebar columns, 0..12, where the map starts at 13. Without this the "stand
   * down" test would pass just as well against a sample that hid whenever the
   * stack had more than four entries in it. */
  const BESIDE: LiveRegion = {
    id: "mod:vitals",
    layer: "overlay",
    cells: { col: 0, row: 1, cols: 13, rows: 3 },
  };

  it("keeps drawing while nothing is over the map (#261)", async () => {
    const sample = await modFacingSample();
    sample.present(frame(REGIONS, [...BASE_STACK, BESIDE]));

    expect(sample.faults).toEqual([]);
    expect(sample.element.style.display).toBe("block");
    /* The same counts the ordinary draw test pins, so "it stood down" cannot be
     * confused with "it drew nothing because the frame was broken". */
    expect(sample.draws.filter((d) => d.op === "fillRect").length).toBe(5);
    expect(sample.draws.filter((d) => d.op === "stroke").length).toBe(7);
  });

  it("draws nothing at all once a screen covers the map (#261)", async () => {
    /* THE LIVE DEFECT. Placing the canvas on the map region (#234) stopped this
     * mod covering the sidebar, the messages and the menus BESIDE the map. It
     * did nothing about what covers the map itself: the inventory, the knowledge
     * browser and the Mods screen you would use to turn this off all repaint the
     * terminal underneath this canvas, so the last dungeon it drew stayed
     * floating over the middle of every screen the player opened. */
    const sample = await modFacingSample();
    sample.present(frame(REGIONS, [...BASE_STACK, SCREEN]));

    expect(sample.faults).toEqual([]);
    expect(sample.draws).toEqual([]);
    expect(sample.element.style.display).toBe("none");
  });

  it("is TOLD, with no repaint behind it, and stands down then (#261)", async () => {
    /* The half a type cannot close. A world frame is produced by render(), and
     * render() does not run while a screen owns the terminal - a screen repaints
     * from its own key loop. So at the moment this mod most needs to hear "you
     * are covered", no frame is coming. The host re-presents the last frame with
     * the new stack instead, which is what makes this an event. */
    const sample = await modFacingSample();
    sample.present(frame(REGIONS, [...BASE_STACK]));
    expect(sample.element.style.display).toBe("block");
    const drawnBefore = sample.draws.length;
    expect(drawnBefore).toBeGreaterThan(0);

    sample.restate([...BASE_STACK, SCREEN]);
    expect(sample.element.style.display).toBe("none");
    expect(sample.draws.length).toBe(drawnBefore);

    /* And back again when the screen closes, without a repaint either. */
    sample.restate([...BASE_STACK]);
    expect(sample.element.style.display).toBe("block");
    expect(sample.draws.length).toBeGreaterThan(drawnBefore);
    expect(sample.faults).toEqual([]);
  });

  it("stands down for a stack that does not describe the map at all (#261)", async () => {
    /* `occludersOf` returns undefined rather than [] for an id that is not in
     * the stack, because collapsing the two reports a misspelled name as good
     * news. The sample takes the same side of that distinction the same way: a
     * host that published a stack with no `map` in it has stopped describing the
     * map, and a front end that read that as "nothing is covering me" would
     * paint over whatever replaced it for ever. */
    const sample = await modFacingSample();
    sample.present(frame(REGIONS, [BESIDE]));
    expect(sample.draws).toEqual([]);
    expect(sample.element.style.display).toBe("none");
  });

  it("declines rather than throwing where there is no DOM", async () => {
    /* A throwing factory costs the mod the slot AND is reported as its fault.
     * "Not here" is not a fault, and the sample is what authors will copy. */
    const plugin = await loadSample();
    const faults: string[] = [];
    const core = coreFrontendCandidate({ present: () => undefined });
    const installed = installFrontend(
      [core, { id: "blueprint-view", manifest: manifest as never, plugin }],
      () => context(undefined),
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(faults).toEqual([]);
    expect(installed.id).toBe(CORE_FRONTEND_ID);
  });
});
