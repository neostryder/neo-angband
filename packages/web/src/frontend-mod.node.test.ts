/**
 * Phase 5's front-end seam through actual plugin folders on disk.
 *
 * The runtime test below deliberately uses the real dynamic-import loader, not
 * an object shaped like a plugin: a replacement front end is useful only if the
 * code a player put in a folder can receive the same WorldFrame that the live
 * repaint producer emits. The second folder is later in the source's order and
 * must be the only frontend whose sink is constructed or called.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ModDirEntry, ModDirSource } from "./disk-packs";
import { readModDir } from "./disk-packs";
import { frontendWorldFrameSink, installFrontend } from "./frontend-runtime";
import { loadModCode, PLUGIN_FILE } from "./mod-code";
import { modPluginContext } from "./mod-context";
import { projectLiveWorld, type LiveWorldRead, type ResolvedGlyph } from "./world-render-data";
import { glyphWorldFrameSink, type WorldFrame } from "./world-view";

const ids = ["early-view", "late-view"] as const;
const root = new URL("../test-fixtures/frontend-mods/", import.meta.url);

type FrontendGlobal = typeof globalThis & { __neoFrontendFrames?: Array<{ owner: string; frame: WorldFrame }> };

afterEach(() => {
  delete (globalThis as FrontendGlobal).__neoFrontendFrames;
});

/** A real filesystem implementation of the same disk-folder reader contract. */
function fixtureSource(): ModDirSource {
  const entries: ModDirEntry[] = ids.map((id) => ({ id, files: ["manifest.json"], code: [PLUGIN_FILE] }));
  return {
    kind: "app",
    dir: () => fileURLToPath(root),
    list: () => Promise.resolve(entries),
    readJson: async (id, file) => JSON.parse(readFileSync(new URL(`${id}/${file}`, root), "utf8")) as unknown,
    order: () => Promise.resolve([...ids]),
    codeUrl: (id, file) => Promise.resolve(pathToFileURL(fileURLToPath(new URL(`${id}/${file}`, root))).href),
  };
}

function reads(playerGrid: { x: number; y: number }): LiveWorldRead<never, never> {
  const terrain: ResolvedGlyph = { ch: ".", attr: 1, css: "#777", layer: { kind: "terrain", id: 1 } };
  return {
    width: 2, height: 1, origin: { x: 0, y: 0 }, size: { width: 2, height: 1 }, screenOrigin: { x: 4, y: 3 },
    playerGrid, cursorBackground: "#123", unknownForeground: "#000", pathColours: new Map(),
    gridKey: ({ x, y }) => y * 2 + x, css: () => "#777", seen: () => true, knownFeature: () => -1,
    remembered: () => ({ terrain, visual: terrain }), rememberedObjectAt: () => undefined,
    rememberedObjectGlyph: () => terrain, terrainAt: () => terrain,
    traps: new Map<number, ResolvedGlyph>(), objects: new Map<number, ResolvedGlyph>(), monsters: new Map<number, never>(),
    monsterGlyph: (_under, monster) => monster, playerGlyph: () => ({ ch: "@", css: "#fff" }), playerTerrain: () => terrain,
  };
}

describe("a disk-loaded frontend plugin", () => {
  it("receives a safely owned live WorldFrame, with the last folder winning", async () => {
    (globalThis as FrontendGlobal).__neoFrontendFrames = [];
    const disk = await readModDir(fixtureSource());
    expect(disk.problems).toEqual([]);
    const code = await loadModCode({
      packs: disk.packs,
      codeUrl: disk.codeUrl,
      enabled: () => true,
      consented: () => [],
      importer: (url) => import(url),
    });
    expect(code.problems).toEqual([]);
    const faults: string[] = [];
    const frontend = installFrontend(
      code.plugins,
      (id) => modPluginContext(id, {}),
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(frontend?.id).toBe("late-view");
    expect(faults).toEqual([]);

    const playerGrid = { x: 1, y: 0 };
    projectLiveWorld(
      reads(playerGrid),
      frontendWorldFrameSink(
        glyphWorldFrameSink({ put: () => { throw new Error("selected frontend should replace glyph paint"); } }),
        frontend,
        (id, message) => faults.push(`${id}: ${message}`),
      ),
    );

    const received = (globalThis as FrontendGlobal).__neoFrontendFrames!;
    expect(received).toHaveLength(1);
    expect(received[0]?.owner).toBe("late-view");
    const frame = received[0]!.frame;
    expect(frame.cells[0]).toMatchObject({ terrain: { id: 1 }, visibility: "seen" });
    expect(frame.player).toMatchObject({ grid: { x: 1, y: 0 }, layer: { kind: "player" } });
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.player?.grid)).toBe(true);
    playerGrid.x = 9;
    expect(frame.player?.grid).toEqual({ x: 1, y: 0 });
  });

  it("THE CONTROL: no frontend leaves the existing glyph sink active", () => {
    const calls: string[] = [];
    projectLiveWorld(
      reads({ x: 1, y: 0 }),
      frontendWorldFrameSink(
        glyphWorldFrameSink({ put: (_x, _y, glyph) => calls.push(glyph.ch) }),
        null,
        () => { throw new Error("an absent frontend cannot fault"); },
      ),
    );
    expect(calls).toEqual([".", ".", "@"]);
  });
});
