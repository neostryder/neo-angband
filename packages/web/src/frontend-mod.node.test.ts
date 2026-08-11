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
import { diskPacks, readModDir, resetDiskPacks, setDiskPacks } from "./disk-packs";
import { frontendWorldFrameSink, installFrontend } from "./frontend-runtime";
import { activeModCode, loadModCode, PLUGIN_FILE, resetModCode, setModCode } from "./mod-code";
import { modPluginContext } from "./mod-context";
import { defaultModStore } from "./mod-store";
import { enabledModIds } from "./pack";
import { projectLiveWorld, type LiveWorldRead, type ResolvedGlyph } from "./world-render-data";
import { glyphWorldFrameSink, type WorldFrame } from "./world-view";

const ids = ["early-view", "late-view"] as const;
const root = new URL("../test-fixtures/frontend-mods/", import.meta.url);

type FrontendGlobal = typeof globalThis & {
  __neoFrontendFrames?: Array<{ owner: string; badge: string; frame: WorldFrame }>;
};

afterEach(() => {
  delete (globalThis as FrontendGlobal).__neoFrontendFrames;
  resetDiskPacks();
  resetModCode();
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

/**
 * The disk-code portion of main.ts's boot block, with the physical fixture
 * folder standing in for the desktop shell's already-enumerated folder.  Keep
 * this deliberately literal: the latches and the enabled/consent gates are
 * part of the shipped route, and omitting `importer` makes loadModCode use its
 * production dynamic import rather than a test substitute.
 */
async function bootDiskFrontendCode() {
  setDiskPacks(await readModDir(fixtureSource()));
  const disk = diskPacks();
  const store = defaultModStore();
  setModCode(
    await loadModCode({
      packs: disk.packs,
      codeUrl: disk.codeUrl,
      enabled: (id) => enabledModIds().includes(id),
      consented: (id) => store.getConsent(id),
    }),
  );
  return { disk, code: activeModCode() };
}

function reads(
  playerGrid: { x: number; y: number },
  cave: { width: number; height: number } = { width: 2, height: 1 },
  viewport: { width: number; height: number; origin: { x: number; y: number } } = { width: 2, height: 1, origin: { x: 0, y: 0 } },
): LiveWorldRead<never, never> {
  const caveKey = ({ x, y }: { x: number; y: number }) => y * cave.width + x;
  const terrain = new Map<number, ResolvedGlyph>();
  for (let y = 0; y < cave.height; y++) {
    for (let x = 0; x < cave.width; x++) {
      const id = 1 + (x + y * 2) % 3;
      terrain.set(caveKey({ x, y }), { ch: ".", attr: id, css: `#77${id}`, layer: { kind: "terrain", id } });
    }
  }
  const terrainAt = (grid: { x: number; y: number }): ResolvedGlyph => {
    const glyph = terrain.get(caveKey(grid));
    if (!glyph) throw new RangeError(`test cave has no terrain at ${grid.x},${grid.y}`);
    return glyph;
  };
  return {
    width: cave.width, height: cave.height, origin: viewport.origin,
    size: { width: viewport.width, height: viewport.height }, screenOrigin: { x: 4, y: 3 },
    playerGrid, cursorBackground: "#123", unknownForeground: "#000", pathColours: new Map(),
    gridKey: caveKey,
    css: () => "#777", seen: () => true, knownFeature: () => -1,
    remembered: (grid) => ({ terrain: terrainAt(grid), visual: terrainAt(grid) }), rememberedObjectAt: () => undefined,
    rememberedObjectGlyph: () => terrainAt(viewport.origin), terrainAt,
    traps: new Map<number, ResolvedGlyph>(), objects: new Map<number, ResolvedGlyph>(), monsters: new Map<number, never>(),
    monsterGlyph: (_under, monster) => monster, playerGlyph: () => ({ ch: "@", css: "#fff" }), playerTerrain: terrainAt,
  };
}

describe("a disk-loaded frontend plugin", () => {
  it("follows the shipped disk loader into a safely owned live WorldFrame", async () => {
    (globalThis as FrontendGlobal).__neoFrontendFrames = [];
    const { disk, code } = await bootDiskFrontendCode();
    expect(disk.problems).toEqual([]);
    expect(disk.order).toEqual(ids);
    expect(code.problems).toEqual([]);
    expect(code.skipped).toEqual([]);
    expect(code.plugins.map((plugin) => plugin.id)).toEqual(ids);
    expect(code.plugins.map((plugin) => new URL(plugin.url).protocol)).toEqual(["file:", "file:"]);
    const faults: string[] = [];
    const frontend = installFrontend(
      code.plugins,
      (id) => modPluginContext(id, {}),
      (id, message) => faults.push(`${id}: ${message}`),
    );
    expect(frontend?.id).toBe("late-view");
    expect(faults).toEqual([]);

    const cave = { width: 198, height: 66 };
    const dungeon = { width: 66, height: 22, origin: { x: 100, y: 22 } };
    expect(dungeon.origin.x + dungeon.width).toBeLessThanOrEqual(cave.width);
    expect(dungeon.origin.y + dungeon.height).toBeLessThanOrEqual(cave.height);
    const playerGrid = { x: dungeon.origin.x + 33, y: dungeon.origin.y + 11 };
    const producedFrame = projectLiveWorld(
      reads(playerGrid, cave, dungeon),
      frontendWorldFrameSink(
        glyphWorldFrameSink({ put: () => { throw new Error("selected frontend should replace glyph paint"); } }),
        frontend,
        (id, message) => faults.push(`${id}: ${message}`),
      ),
    );

    const received = (globalThis as FrontendGlobal).__neoFrontendFrames!;
    expect(received).toHaveLength(1);
    expect(received[0]?.owner).toBe("late-view");
    expect(producedFrame.viewport.size).toEqual({ width: dungeon.width, height: dungeon.height });
    expect(producedFrame.cells).toHaveLength(1_452);
    expect(producedFrame.cells).toHaveLength(dungeon.width * dungeon.height);
    const expectedBadge = `WorldFrame ${producedFrame.viewport.size.width}x${producedFrame.viewport.size.height} (${producedFrame.cells.length} cells)`;
    expect(received[0]?.badge).toBe(expectedBadge);
    expect(received[0]?.badge).not.toContain("undefined");
    const frame = received[0]!.frame;
    expect(frame).toEqual(producedFrame);
    expect(frame).not.toBe(producedFrame);
    expect(frame.cells).toHaveLength(dungeon.width * dungeon.height);
    expect(new Set(frame.cells.map((cell) => cell.terrain?.id))).toEqual(new Set([1, 2, 3]));
    expect(frame.player).toMatchObject({ grid: playerGrid, layer: { kind: "player" } });
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.player?.grid)).toBe(true);
    playerGrid.x = 9;
    expect(frame.player?.grid).toEqual({ x: dungeon.origin.x + 33, y: dungeon.origin.y + 11 });

    const frameWithMissingWidth = {
      ...producedFrame,
      viewport: { ...producedFrame.viewport, size: { ...producedFrame.viewport.size, width: undefined } },
    } as unknown as WorldFrame;
    expect(() => frontend!.sink.present(frameWithMissingWidth))
      .toThrow("WorldFrame viewport.size.width must be a finite number");
    const frameWithNonNumericWidth = {
      ...producedFrame,
      viewport: { ...producedFrame.viewport, size: { ...producedFrame.viewport.size, width: "two" } },
    } as unknown as WorldFrame;
    expect(() => frontend!.sink.present(frameWithNonNumericWidth))
      .toThrow("WorldFrame viewport.size.width must be a finite number");
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
