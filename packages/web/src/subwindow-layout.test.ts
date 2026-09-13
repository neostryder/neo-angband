import { describe, expect, it } from "vitest";
import {
  MAIN_TILE_ID,
  SPLITTER_PX,
  applyDrop,
  clampRatio,
  computeLayout,
  containsLeaf,
  dropZoneAt,
  insertAtEdge,
  leafIds,
  parseLayoutTree,
  pruneTree,
  ratioFromPointer,
  removeLeaf,
  resizeSplit,
  swapLeaves,
  type LayoutNode,
  type Rect,
  type TileRect,
} from "./subwindow-layout";

const VIEW: Rect = { x: 0, y: 0, w: 1000, h: 800 };

function area(rect: Rect): number {
  return rect.w * rect.h;
}

function overlap(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function tiled(tiles: readonly TileRect[], splitters: readonly { rect: Rect }[], viewport: Rect): void {
  for (const tile of tiles) {
    expect(tile.rect.x).toBeGreaterThanOrEqual(viewport.x);
    expect(tile.rect.y).toBeGreaterThanOrEqual(viewport.y);
    expect(tile.rect.x + tile.rect.w).toBeLessThanOrEqual(viewport.x + viewport.w);
    expect(tile.rect.y + tile.rect.h).toBeLessThanOrEqual(viewport.y + viewport.h);
  }
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      expect(overlap(tiles[i]!.rect, tiles[j]!.rect), `${tiles[i]!.id} overlaps ${tiles[j]!.id}`).toBe(0);
    }
  }
  const covered =
    tiles.reduce((sum, tile) => sum + area(tile.rect), 0) +
    splitters.reduce((sum, splitter) => sum + area(splitter.rect), 0);
  expect(covered).toBe(area(viewport));
}

const mainOnly: LayoutNode = { kind: "leaf", id: MAIN_TILE_ID };

describe("computeLayout", () => {
  it("gives the main view the whole viewport when it is the only tile", () => {
    const { tiles, splitters } = computeLayout(mainOnly, VIEW);
    expect(tiles).toEqual([{ id: MAIN_TILE_ID, rect: VIEW }]);
    expect(splitters).toEqual([]);
    tiled(tiles, splitters, VIEW);
  });

  it("splits the viewport between main and a docked panel with no gap", () => {
    const tree = insertAtEdge(mainOnly, "messages", MAIN_TILE_ID, "bottom", 0.25);
    const { tiles, splitters } = computeLayout(tree, VIEW);
    expect(splitters).toHaveLength(1);
    tiled(tiles, splitters, VIEW);
    const main = tiles.find((tile) => tile.id === MAIN_TILE_ID)!.rect;
    const messages = tiles.find((tile) => tile.id === "messages")!.rect;
    expect(messages.y).toBeGreaterThan(main.y);
    expect(messages.x).toBe(main.x);
    expect(messages.w).toBe(main.w);
    expect(main.y + main.h + SPLITTER_PX).toBe(messages.y);
    expect(messages.y + messages.h).toBe(VIEW.h);
  });
});

describe("insertAtEdge and removeLeaf", () => {
  it("docks a panel onto each edge of main and still tiles", () => {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const tree = insertAtEdge(mainOnly, "inventory", MAIN_TILE_ID, edge, 0.3);
      const { tiles, splitters } = computeLayout(tree, VIEW);
      tiled(tiles, splitters, VIEW);
      expect(leafIds(tree).sort()).toEqual(["inventory", MAIN_TILE_ID].sort());
    }
  });

  it("moves an already-present panel instead of duplicating it", () => {
    const first = insertAtEdge(mainOnly, "messages", MAIN_TILE_ID, "bottom", 0.2);
    const moved = insertAtEdge(first, "messages", MAIN_TILE_ID, "right", 0.3);
    expect(leafIds(moved).filter((id) => id === "messages")).toHaveLength(1);
    const { tiles, splitters } = computeLayout(moved, VIEW);
    tiled(tiles, splitters, VIEW);
    const main = tiles.find((tile) => tile.id === MAIN_TILE_ID)!.rect;
    const messages = tiles.find((tile) => tile.id === "messages")!.rect;
    expect(messages.x).toBeGreaterThan(main.x);
  });

  it("collapses the parent split when a panel is removed", () => {
    const tree = insertAtEdge(mainOnly, "monsters", MAIN_TILE_ID, "right", 0.3);
    expect(removeLeaf(tree, "monsters")).toEqual(mainOnly);
  });

  it("refuses to remove the main view", () => {
    const tree = insertAtEdge(mainOnly, "items", MAIN_TILE_ID, "left", 0.2);
    expect(removeLeaf(tree, MAIN_TILE_ID)).toEqual(tree);
  });
});

describe("resizeSplit", () => {
  it("changes both children's sizes and keeps the viewport covered", () => {
    const tree = insertAtEdge(mainOnly, "messages", MAIN_TILE_ID, "bottom", 0.25);
    const before = computeLayout(tree, VIEW).tiles.find((tile) => tile.id === "messages")!.rect.h;
    const resized = resizeSplit(tree, [], 0.5);
    const after = computeLayout(resized, VIEW);
    tiled(after.tiles, after.splitters, VIEW);
    const messages = after.tiles.find((tile) => tile.id === "messages")!.rect;
    expect(messages.h).toBeGreaterThan(before);
  });

  it("clamps a pointer-derived ratio into a usable split", () => {
    expect(clampRatio(-2)).toBe(0.08);
    expect(clampRatio(2)).toBe(0.92);
    expect(ratioFromPointer("v", VIEW, { x: 250, y: 10 })).toBeCloseTo(0.25, 2);
  });
});

describe("dropZoneAt and applyDrop", () => {
  it("snaps a pointer near a tile edge into a dock preview", () => {
    const { tiles } = computeLayout(mainOnly, VIEW);
    const zone = dropZoneAt(tiles, 10, 400);
    expect(zone).toEqual({
      kind: "dock",
      id: MAIN_TILE_ID,
      edge: "left",
      preview: expect.objectContaining({ x: 0, y: 0, h: 800 }),
    });
  });

  it("treats the interior of a tile as a swap target", () => {
    const { tiles } = computeLayout(mainOnly, VIEW);
    const zone = dropZoneAt(tiles, 500, 400);
    expect(zone?.kind).toBe("swap");
    expect(zone?.id).toBe(MAIN_TILE_ID);
  });

  it("drag-docking a panel onto another tile's edge moves it and still fills the viewport", () => {
    let tree = insertAtEdge(mainOnly, "messages", MAIN_TILE_ID, "bottom", 0.2);
    tree = insertAtEdge(tree, "inventory", MAIN_TILE_ID, "right", 0.3);
    const before = computeLayout(tree, VIEW);
    const inventory = before.tiles.find((tile) => tile.id === "inventory")!;
    const zone = dropZoneAt(before.tiles, inventory.rect.x + 8, inventory.rect.y + inventory.rect.h / 2);
    expect(zone).toMatchObject({ kind: "dock", id: "inventory", edge: "left" });
    const afterTree = applyDrop(tree, "messages", zone!);
    const after = computeLayout(afterTree, VIEW);
    tiled(after.tiles, after.splitters, VIEW);
    expect(containsLeaf(afterTree, "messages")).toBe(true);
  });

  it("swapping two panels exchanges their rectangles", () => {
    const tree = insertAtEdge(mainOnly, "overhead", MAIN_TILE_ID, "left", 0.3);
    const before = computeLayout(tree, VIEW);
    const swapped = computeLayout(swapLeaves(tree, MAIN_TILE_ID, "overhead"), VIEW);
    const mainBefore = before.tiles.find((tile) => tile.id === MAIN_TILE_ID)!.rect;
    const mainAfter = swapped.tiles.find((tile) => tile.id === MAIN_TILE_ID)!.rect;
    const overheadAfter = swapped.tiles.find((tile) => tile.id === "overhead")!.rect;
    expect(mainAfter).toEqual(before.tiles.find((tile) => tile.id === "overhead")!.rect);
    expect(overheadAfter).toEqual(mainBefore);
    tiled(swapped.tiles, swapped.splitters, VIEW);
  });
});

describe("pruneTree and parseLayoutTree", () => {
  it("drops disabled leaves and collapses the splits they occupied", () => {
    const full = insertAtEdge(
      insertAtEdge(mainOnly, "messages", MAIN_TILE_ID, "bottom", 0.2),
      "inventory",
      MAIN_TILE_ID,
      "right",
      0.3,
    );
    const pruned = pruneTree(full, new Set([MAIN_TILE_ID, "messages"]));
    expect(pruned).not.toBeNull();
    expect(leafIds(pruned!).sort()).toEqual(["messages", MAIN_TILE_ID].sort());
    const { tiles, splitters } = computeLayout(pruned!, VIEW);
    tiled(tiles, splitters, VIEW);
  });

  it("round-trips a tree through JSON and rejects one with no main view", () => {
    const tree = insertAtEdge(mainOnly, "items", MAIN_TILE_ID, "top", 0.2);
    expect(parseLayoutTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
    expect(parseLayoutTree({ kind: "leaf", id: "messages" })).toBeNull();
    expect(parseLayoutTree({ kind: "split", axis: "v", ratio: 0.5 })).toBeNull();
  });
});
