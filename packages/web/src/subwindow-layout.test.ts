import { describe, expect, it } from "vitest";
import {
  COMFORTABLE_MIN_PX,
  MAIN_TILE_ID,
  SPLITTER_PX,
  allDropZones,
  applyDrop,
  clampRatio,
  computeLayout,
  containsLeaf,
  dropZoneAt,
  fitForComfort,
  groupTabs,
  insertAtEdge,
  leafIds,
  parseLayoutTree,
  pruneTree,
  ratioFromPointer,
  removeLeaf,
  resizeSplit,
  selectTab,
  swapLeaves,
  tabInto,
  type LayoutNode,
  type LeafNode,
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

  it("lists the center targets plus all four dock zones for every tile except the excluded one (#249, #287)", () => {
    let tree = insertAtEdge(mainOnly, "messages", MAIN_TILE_ID, "bottom", 0.2);
    tree = insertAtEdge(tree, "inventory", MAIN_TILE_ID, "right", 0.3);
    const { tiles } = computeLayout(tree, VIEW);
    const zones = allDropZones(tiles, "messages");
    expect(zones.some((zone) => zone.id === "messages")).toBe(false);
    for (const id of [MAIN_TILE_ID, "inventory"]) {
      expect(zones.filter((zone) => zone.kind === "swap" && zone.id === id)).toHaveLength(1);
      for (const edge of ["left", "right", "top", "bottom"] as const) {
        expect(
          zones.filter((zone) => zone.kind === "dock" && zone.id === id && zone.edge === edge),
        ).toHaveLength(1);
      }
    }
    // The main view never takes a panel as a tab, so only inventory has one.
    expect(zones.filter((zone) => zone.kind === "tab" && zone.id === "inventory")).toHaveLength(1);
    expect(zones.filter((zone) => zone.kind === "tab" && zone.id === MAIN_TILE_ID)).toHaveLength(0);
    expect(zones).toHaveLength(5 + 6);
  });

  it("splits a panel's interior into Swap and Tab targets that match dropZoneAt (#287)", () => {
    const tree = insertAtEdge(mainOnly, "inventory", MAIN_TILE_ID, "right", 0.4);
    const { tiles } = computeLayout(tree, VIEW);
    const zones = allDropZones(tiles, "messages");
    const swap = zones.find((zone) => zone.kind === "swap" && zone.id === "inventory")!;
    const tab = zones.find((zone) => zone.kind === "tab" && zone.id === "inventory")!;
    expect(overlap(swap.preview, tab.preview)).toBe(0);
    const inSwap = dropZoneAt(tiles, swap.preview.x + swap.preview.w / 2, swap.preview.y + swap.preview.h / 2, { dragging: "messages" });
    const inTab = dropZoneAt(tiles, tab.preview.x + tab.preview.w / 2, tab.preview.y + tab.preview.h / 2, { dragging: "messages" });
    expect(inSwap).toEqual(swap);
    expect(inTab).toEqual(tab);
  });

  it("matches dropZoneAt's own geometry for the same tile and edge", () => {
    const { tiles } = computeLayout(mainOnly, VIEW);
    const zones = allDropZones(tiles, "nonexistent");
    const left = zones.find((zone) => zone.kind === "dock" && zone.edge === "left");
    const atEdge = dropZoneAt(tiles, 10, 400);
    expect(left?.preview).toEqual(atEdge?.preview);
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

describe("tab groups (#287)", () => {
  function twoPanels(): LayoutNode {
    let tree = insertAtEdge(mainOnly, "equipment", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "messages", MAIN_TILE_ID, "bottom", 0.2);
    return tree;
  }

  function groupOf(tree: LayoutNode, id: string): LeafNode {
    const find = (node: LayoutNode): LeafNode | null => {
      if (node.kind === "leaf") return groupTabs(node).includes(id) ? node : null;
      return find(node.first) ?? find(node.second);
    };
    return find(tree)!;
  }

  it("adds a panel to another panel's group as the shown tab", () => {
    const tree = tabInto(twoPanels(), "messages", "equipment");
    expect(groupOf(tree, "equipment")).toEqual({ kind: "leaf", id: "messages", tabs: ["equipment", "messages"] });
    const { tiles, splitters } = computeLayout(tree, VIEW);
    expect(tiles.map((tile) => tile.id).sort()).toEqual([MAIN_TILE_ID, "messages"]);
    expect(tiles.find((tile) => tile.id === "messages")?.tabs).toEqual(["equipment", "messages"]);
    tiled(tiles, splitters, VIEW);
    expect(leafIds(tree).sort()).toEqual(["equipment", MAIN_TILE_ID, "messages"].sort());
  });

  it("switches the shown tab without moving anything", () => {
    const grouped = tabInto(twoPanels(), "messages", "equipment");
    const selected = selectTab(grouped, "equipment");
    expect(groupOf(selected, "messages").id).toBe("equipment");
    expect(computeLayout(selected, VIEW).tiles.find((tile) => tile.id === "equipment")!.rect)
      .toEqual(computeLayout(grouped, VIEW).tiles.find((tile) => tile.id === "messages")!.rect);
    expect(selectTab(selected, "equipment")).toBe(selected);
  });

  it("keeps the rest of a group when one tab is removed, and shows the next tab", () => {
    let tree = tabInto(twoPanels(), "messages", "equipment");
    tree = insertAtEdge(tree, "inventory", MAIN_TILE_ID, "left", 0.3);
    tree = tabInto(tree, "inventory", "equipment");
    expect(groupTabs(groupOf(tree, "equipment"))).toEqual(["equipment", "messages", "inventory"]);
    const removed = removeLeaf(tree, "inventory");
    expect(groupOf(removed, "equipment")).toEqual({ kind: "leaf", id: "messages", tabs: ["equipment", "messages"] });
    const single = removeLeaf(removed, "messages");
    expect(groupOf(single, "equipment")).toEqual({ kind: "leaf", id: "equipment" });
  });

  it("never puts the main view in a group of tabs", () => {
    const grouped = tabInto(twoPanels(), "messages", "equipment");
    expect(tabInto(grouped, MAIN_TILE_ID, "equipment")).toBe(grouped);
    expect(tabInto(grouped, "equipment", MAIN_TILE_ID)).toBe(grouped);
    expect(swapLeaves(grouped, MAIN_TILE_ID, "equipment")).toBe(grouped);
    expect(parseLayoutTree({ kind: "split", axis: "v", ratio: 0.5,
      first: { kind: "leaf", id: MAIN_TILE_ID, tabs: [MAIN_TILE_ID, "map"] },
      second: { kind: "leaf", id: "x" } })).toBeNull();
  });

  it("swaps a grouped panel into another panel's place and the other into the group", () => {
    let tree = tabInto(twoPanels(), "messages", "equipment");
    tree = insertAtEdge(tree, "inventory", MAIN_TILE_ID, "left", 0.3);
    const swapped = swapLeaves(tree, "messages", "inventory");
    expect(groupTabs(groupOf(swapped, "equipment"))).toEqual(["equipment", "inventory"]);
    expect(groupOf(swapped, "messages")).toEqual({ kind: "leaf", id: "messages" });
  });

  it("docks a panel beside a whole group, keeping the group intact", () => {
    const grouped = tabInto(twoPanels(), "messages", "equipment");
    const docked = insertAtEdge(grouped, "inventory", "equipment", "top", 0.3);
    expect(groupTabs(groupOf(docked, "equipment"))).toEqual(["equipment", "messages"]);
    expect(containsLeaf(docked, "inventory")).toBe(true);
  });

  it("drops the Tab target's panel into the group through applyDrop", () => {
    const tree = twoPanels();
    const { tiles } = computeLayout(tree, VIEW);
    const zone = allDropZones(tiles, "messages").find((entry) => entry.kind === "tab" && entry.id === "equipment")!;
    expect(applyDrop(tree, "messages", zone)).toEqual(tabInto(tree, "messages", "equipment"));
  });

  it("prunes disabled panels out of a group", () => {
    const grouped = tabInto(twoPanels(), "messages", "equipment");
    const pruned = pruneTree(grouped, new Set([MAIN_TILE_ID, "equipment"]))!;
    expect(groupOf(pruned, "equipment")).toEqual({ kind: "leaf", id: "equipment" });
  });

  it("round-trips a group through JSON and loads a saved tree from before groups", () => {
    const grouped = tabInto(twoPanels(), "messages", "equipment");
    expect(parseLayoutTree(JSON.parse(JSON.stringify(grouped)))).toEqual(grouped);
    const legacy = JSON.parse(JSON.stringify(twoPanels()));
    expect(parseLayoutTree(legacy)).toEqual(twoPanels());
    expect(parseLayoutTree({ kind: "split", axis: "v", ratio: 0.5,
      first: { kind: "leaf", id: MAIN_TILE_ID },
      second: { kind: "leaf", id: "a", tabs: ["b", "c"] } })).toBeNull();
  });
});

describe("fitForComfort (#275, #287)", () => {
  it("is a byte-identical no-op when every panel already fits comfortably", () => {
    const tree = insertAtEdge(mainOnly, "messages", MAIN_TILE_ID, "bottom", 0.2);
    const result = fitForComfort(tree, VIEW);
    expect(result.merged).toEqual([]);
    // Same object, not just an equal one: the common case must not even
    // allocate a new tree.
    expect(result.tree).toBe(tree);
  });

  it("merges cramped groups as tabs until every group clears COMFORTABLE_MIN_PX, hiding no panel", () => {
    const viewport: Rect = { x: 0, y: 0, w: 340, h: 800 };
    let tree: LayoutNode = mainOnly;
    tree = insertAtEdge(tree, "a", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "b", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "c", MAIN_TILE_ID, "right", 0.3);

    const before = computeLayout(tree, viewport);
    const tooSmallBefore = before.tiles
      .filter((tile) => tile.id !== MAIN_TILE_ID)
      .some((tile) => Math.min(tile.rect.w, tile.rect.h) < COMFORTABLE_MIN_PX);
    expect(tooSmallBefore).toBe(true); // sanity: this viewport is genuinely too small

    const result = fitForComfort(tree, viewport);
    expect(result.merged.length).toBeGreaterThan(0);
    // Every panel is still in the tree; merging moves panels, it never hides them.
    expect(leafIds(result.tree).sort()).toEqual(leafIds(tree).sort());

    const after = computeLayout(result.tree, viewport);
    const groups = after.tiles.filter((tile) => tile.id !== MAIN_TILE_ID);
    for (const tile of groups) {
      expect(Math.min(tile.rect.w, tile.rect.h) >= COMFORTABLE_MIN_PX || groups.length === 1).toBe(true);
    }
    tiled(after.tiles, after.splitters, viewport);
  });

  it("merges into the open group closest in shape", () => {
    // Two tall panels on the right and one wide panel along the bottom. In a
    // cramped window the thinner tall panel joins the other tall one.
    const viewport: Rect = { x: 0, y: 0, w: 700, h: 600 };
    let tree: LayoutNode = mainOnly;
    tree = insertAtEdge(tree, "wide", MAIN_TILE_ID, "bottom", 0.34);
    tree = insertAtEdge(tree, "tall-a", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "tall-b", "tall-a", "right", 0.3);
    const result = fitForComfort(tree, viewport);
    expect(result.merged.length).toBeGreaterThan(0);
    const first = result.merged[0]!;
    expect(first.id.startsWith("tall-")).toBe(true);
    expect(first.into.startsWith("tall-")).toBe(true);
  });

  it("keeps a tab chosen inside a merged group", () => {
    const viewport: Rect = { x: 0, y: 0, w: 340, h: 800 };
    let tree: LayoutNode = mainOnly;
    tree = insertAtEdge(tree, "a", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "b", MAIN_TILE_ID, "right", 0.3);
    const plain = fitForComfort(tree, viewport);
    expect(plain.merged).toHaveLength(1);
    const { into, id } = plain.merged[0]!;
    const preferred = fitForComfort(tree, viewport, { prefer: [id] });
    expect(computeLayout(preferred.tree, viewport).tiles.some((tile) => tile.id === id)).toBe(true);
    expect(computeLayout(plain.tree, viewport).tiles.some((tile) => tile.id === into)).toBe(true);
  });

  it("stops at one group beside the main view, even in an absurdly tiny viewport", () => {
    const tiny: Rect = { x: 0, y: 0, w: 60, h: 60 };
    let tree: LayoutNode = mainOnly;
    tree = insertAtEdge(tree, "a", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "b", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "c", MAIN_TILE_ID, "right", 0.3);
    tree = insertAtEdge(tree, "d", MAIN_TILE_ID, "bottom", 0.3);

    const result = fitForComfort(tree, tiny);
    const { tiles, splitters } = computeLayout(result.tree, tiny);
    expect(tiles.map((tile) => tile.id)).toContain(MAIN_TILE_ID);
    expect(tiles).toHaveLength(2);
    expect(result.merged).toHaveLength(3);
    expect(leafIds(result.tree).sort()).toEqual(leafIds(tree).sort());
    tiled(tiles, splitters, tiny);
  });
});
