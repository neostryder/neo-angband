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
 * test below. The second is not a bug in the sample and has no test here,
 * because it is a hole in the seam: a front end covers the whole window, so it
 * hides the sidebar, the message line and every menu the game is still drawing
 * underneath - including the Mods screen you would use to turn it off. See
 * MOD_REACH gap 9.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildWorldFrame, type WorldCell, type WorldFrame } from "./world-view";
import {
  coreFrontendCandidate,
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
  const element = {
    id: "",
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    clientWidth: 1200,
    clientHeight: 800,
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
function frame(): WorldFrame {
  const GRANITE = 21;
  const FLOOR = 1;
  return buildWorldFrame({
    width: 4,
    height: 3,
    origin: { x: 0, y: 0 },
    size: { width: 4, height: 3 },
    screenOrigin: { x: 0, y: 0 },
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
      screen: { x: 2, y: 1 },
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
