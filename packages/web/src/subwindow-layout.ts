/**
 * Binary-space-partition tiling for the game view and its subwindows.
 *
 * A node is either a leaf (one panel) or a split (two children sharing an
 * axis). The root always covers the viewport, so the computed rectangles have
 * no gaps and no overlaps. Drag-docking replaces a leaf with a split; removing
 * a leaf collapses its parent. This is the same shape as a tiling window
 * manager, not free-floating OS windows.
 */

export const MAIN_TILE_ID = "main";

export type TileId = string;
export type SplitAxis = "h" | "v";
export type DockEdge = "left" | "right" | "top" | "bottom";

export interface SplitNode {
  kind: "split";
  axis: SplitAxis;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export interface LeafNode {
  kind: "leaf";
  id: TileId;
}

export type LayoutNode = SplitNode | LeafNode;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileRect {
  id: TileId;
  rect: Rect;
}

export interface SplitterRect {
  axis: SplitAxis;
  path: readonly number[];
  rect: Rect;
  parent: Rect;
}

export interface LayoutRects {
  tiles: TileRect[];
  splitters: SplitterRect[];
}

export type DropZone =
  | { kind: "dock"; id: TileId; edge: DockEdge; preview: Rect }
  | { kind: "swap"; id: TileId; preview: Rect };

export const SPLITTER_PX = 6;
export const MIN_TILE_PX = 96;

export function isSplit(node: LayoutNode): node is SplitNode {
  return node.kind === "split";
}

export function isLeaf(node: LayoutNode): node is LeafNode {
  return node.kind === "leaf";
}

export function leafIds(node: LayoutNode): TileId[] {
  if (node.kind === "leaf") return [node.id];
  return [...leafIds(node.first), ...leafIds(node.second)];
}

export function containsLeaf(node: LayoutNode, id: TileId): boolean {
  if (node.kind === "leaf") return node.id === id;
  return containsLeaf(node.first, id) || containsLeaf(node.second, id);
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.92, Math.max(0.08, ratio));
}

function splitSizes(
  parent: number,
  ratio: number,
  splitter: number,
  min: number,
): [number, number] {
  const inner = Math.max(0, parent - splitter);
  if (inner <= 0) return [0, 0];
  if (inner < min * 2) {
    const first = Math.floor(inner / 2);
    return [first, inner - first];
  }
  let first = Math.round(inner * clampRatio(ratio));
  first = Math.max(min, Math.min(inner - min, first));
  return [first, inner - first];
}

export function computeLayout(
  tree: LayoutNode,
  viewport: Rect,
  opts: { splitterPx?: number; minPx?: number } = {},
): LayoutRects {
  const splitterPx = opts.splitterPx ?? SPLITTER_PX;
  const minPx = opts.minPx ?? MIN_TILE_PX;
  const tiles: TileRect[] = [];
  const splitters: SplitterRect[] = [];
  walk(tree, viewport, [], splitterPx, minPx, tiles, splitters);
  return { tiles, splitters };
}

function walk(
  node: LayoutNode,
  rect: Rect,
  path: readonly number[],
  splitterPx: number,
  minPx: number,
  tiles: TileRect[],
  splitters: SplitterRect[],
): void {
  if (node.kind === "leaf") {
    tiles.push({ id: node.id, rect });
    return;
  }
  if (node.axis === "v") {
    const [firstW, secondW] = splitSizes(rect.w, node.ratio, splitterPx, minPx);
    const firstRect = { x: rect.x, y: rect.y, w: firstW, h: rect.h };
    const gutter = { x: rect.x + firstW, y: rect.y, w: splitterPx, h: rect.h };
    const secondRect = {
      x: rect.x + firstW + splitterPx,
      y: rect.y,
      w: secondW,
      h: rect.h,
    };
    splitters.push({ axis: "v", path, rect: gutter, parent: rect });
    walk(node.first, firstRect, [...path, 0], splitterPx, minPx, tiles, splitters);
    walk(node.second, secondRect, [...path, 1], splitterPx, minPx, tiles, splitters);
    return;
  }
  const [firstH, secondH] = splitSizes(rect.h, node.ratio, splitterPx, minPx);
  const firstRect = { x: rect.x, y: rect.y, w: rect.w, h: firstH };
  const gutter = { x: rect.x, y: rect.y + firstH, w: rect.w, h: splitterPx };
  const secondRect = {
    x: rect.x,
    y: rect.y + firstH + splitterPx,
    w: rect.w,
    h: secondH,
  };
  splitters.push({ axis: "h", path, rect: gutter, parent: rect });
  walk(node.first, firstRect, [...path, 0], splitterPx, minPx, tiles, splitters);
  walk(node.second, secondRect, [...path, 1], splitterPx, minPx, tiles, splitters);
}

function replaceAt(
  node: LayoutNode,
  path: readonly number[],
  replacement: LayoutNode,
): LayoutNode {
  if (path.length === 0) return replacement;
  if (node.kind !== "split") return node;
  const [head, ...rest] = path;
  if (head === 0) return { ...node, first: replaceAt(node.first, rest, replacement) };
  if (head === 1) return { ...node, second: replaceAt(node.second, rest, replacement) };
  return node;
}

function findPath(node: LayoutNode, id: TileId, path: number[] = []): number[] | null {
  if (node.kind === "leaf") return node.id === id ? path : null;
  const first = findPath(node.first, id, [...path, 0]);
  if (first) return first;
  return findPath(node.second, id, [...path, 1]);
}

export function removeLeaf(tree: LayoutNode, id: TileId): LayoutNode {
  if (id === MAIN_TILE_ID) return tree;
  if (tree.kind === "leaf") return tree;
  if (tree.first.kind === "leaf" && tree.first.id === id) return tree.second;
  if (tree.second.kind === "leaf" && tree.second.id === id) return tree.first;
  return {
    ...tree,
    first: removeLeaf(tree.first, id),
    second: removeLeaf(tree.second, id),
  };
}

function splitOnEdge(
  target: LeafNode,
  incoming: LeafNode,
  edge: DockEdge,
  incomingRatio: number,
): SplitNode {
  const ratio = clampRatio(incomingRatio);
  switch (edge) {
    case "left":
      return { kind: "split", axis: "v", ratio, first: incoming, second: target };
    case "right":
      return { kind: "split", axis: "v", ratio: 1 - ratio, first: target, second: incoming };
    case "top":
      return { kind: "split", axis: "h", ratio, first: incoming, second: target };
    case "bottom":
      return { kind: "split", axis: "h", ratio: 1 - ratio, first: target, second: incoming };
  }
}

export function insertAtEdge(
  tree: LayoutNode,
  incomingId: TileId,
  targetId: TileId,
  edge: DockEdge,
  incomingRatio = 0.3,
): LayoutNode {
  if (incomingId === targetId) return tree;
  const stripped = incomingId === MAIN_TILE_ID ? tree : removeLeaf(tree, incomingId);
  const path = findPath(stripped, targetId);
  if (!path) return tree;
  const incoming: LeafNode = { kind: "leaf", id: incomingId };
  const target: LeafNode = { kind: "leaf", id: targetId };
  return replaceAt(stripped, path, splitOnEdge(target, incoming, edge, incomingRatio));
}

export function swapLeaves(tree: LayoutNode, a: TileId, b: TileId): LayoutNode {
  if (a === b) return tree;
  const pathA = findPath(tree, a);
  const pathB = findPath(tree, b);
  if (!pathA || !pathB) return tree;
  const withA = replaceAt(tree, pathA, { kind: "leaf", id: b });
  return replaceAt(withA, pathB, { kind: "leaf", id: a });
}

function nodeAt(tree: LayoutNode, path: readonly number[]): LayoutNode | null {
  let node: LayoutNode = tree;
  for (const step of path) {
    if (node.kind !== "split") return null;
    node = step === 0 ? node.first : node.second;
  }
  return node;
}

export function resizeSplit(
  tree: LayoutNode,
  path: readonly number[],
  ratio: number,
): LayoutNode {
  const node = nodeAt(tree, path);
  if (!node || node.kind !== "split") return tree;
  return replaceAt(tree, path, { ...node, ratio: clampRatio(ratio) });
}

export function ratioFromPointer(
  axis: SplitAxis,
  parent: Rect,
  pointer: { x: number; y: number },
  splitterPx = SPLITTER_PX,
): number {
  if (axis === "v") {
    const inner = Math.max(1, parent.w - splitterPx);
    return clampRatio((pointer.x - parent.x) / inner);
  }
  const inner = Math.max(1, parent.h - splitterPx);
  return clampRatio((pointer.y - parent.y) / inner);
}

function pointInRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function edgeBand(rect: Rect, edge: DockEdge, fraction: number, minPx: number, maxPx: number): Rect {
  const depth = Math.min(maxPx, Math.max(minPx, (edge === "left" || edge === "right" ? rect.w : rect.h) * fraction));
  switch (edge) {
    case "left":
      return { x: rect.x, y: rect.y, w: depth, h: rect.h };
    case "right":
      return { x: rect.x + rect.w - depth, y: rect.y, w: depth, h: rect.h };
    case "top":
      return { x: rect.x, y: rect.y, w: rect.w, h: depth };
    case "bottom":
      return { x: rect.x, y: rect.y + rect.h - depth, w: rect.w, h: depth };
  }
}

export function dropZoneAt(
  tiles: readonly TileRect[],
  x: number,
  y: number,
  opts: { fraction?: number; minPx?: number; maxPx?: number } = {},
): DropZone | null {
  const fraction = opts.fraction ?? 0.25;
  const minPx = opts.minPx ?? 12;
  const maxPx = opts.maxPx ?? 56;
  const hit = tiles.find((tile) => pointInRect(tile.rect, x, y));
  if (!hit) return null;
  const edges: DockEdge[] = ["left", "right", "top", "bottom"];
  for (const edge of edges) {
    const preview = edgeBand(hit.rect, edge, fraction, minPx, maxPx);
    if (pointInRect(preview, x, y)) {
      return { kind: "dock", id: hit.id, edge, preview };
    }
  }
  return { kind: "swap", id: hit.id, preview: hit.rect };
}

/**
 * Every zone `dropZoneAt` could ever return against `tiles`, for every tile
 * except `excludeId` (the panel being dragged) - the swap (center) zone plus
 * all four dock (edge) zones per remaining tile, computed exhaustively rather
 * than by hit-testing one pointer position. Shares dropZoneAt's own geometry
 * (same defaults, same edgeBand math) so a rendered guide always lines up with
 * where a drop actually lands; used to show every candidate at once during a
 * drag instead of only the one currently under the pointer (neo-angband#249).
 */
export function allDropZones(
  tiles: readonly TileRect[],
  excludeId: TileId,
  opts: { fraction?: number; minPx?: number; maxPx?: number } = {},
): DropZone[] {
  const fraction = opts.fraction ?? 0.25;
  const minPx = opts.minPx ?? 12;
  const maxPx = opts.maxPx ?? 56;
  const edges: DockEdge[] = ["left", "right", "top", "bottom"];
  const zones: DropZone[] = [];
  for (const tile of tiles) {
    if (tile.id === excludeId) continue;
    zones.push({ kind: "swap", id: tile.id, preview: tile.rect });
    for (const edge of edges) {
      zones.push({ kind: "dock", id: tile.id, edge, preview: edgeBand(tile.rect, edge, fraction, minPx, maxPx) });
    }
  }
  return zones;
}

export function applyDrop(
  tree: LayoutNode,
  incomingId: TileId,
  zone: DropZone,
  incomingRatio = 0.3,
): LayoutNode {
  if (zone.id === incomingId) return tree;
  if (zone.kind === "swap") return swapLeaves(tree, incomingId, zone.id);
  return insertAtEdge(tree, incomingId, zone.id, zone.edge, incomingRatio);
}

export function pruneTree(node: LayoutNode, keep: ReadonlySet<TileId>): LayoutNode | null {
  if (node.kind === "leaf") return keep.has(node.id) ? node : null;
  const first = pruneTree(node.first, keep);
  const second = pruneTree(node.second, keep);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function parseLayoutTree(raw: unknown): LayoutNode | null {
  const node = parseNode(raw);
  if (!node) return null;
  const ids = leafIds(node);
  if (!ids.includes(MAIN_TILE_ID)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return node;
}

function parseNode(raw: unknown): LayoutNode | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.kind === "leaf") {
    if (typeof rec.id !== "string" || rec.id.length === 0) return null;
    return { kind: "leaf", id: rec.id };
  }
  if (rec.kind === "split") {
    if (rec.axis !== "h" && rec.axis !== "v") return null;
    const first = parseNode(rec.first);
    const second = parseNode(rec.second);
    if (!first || !second) return null;
    return {
      kind: "split",
      axis: rec.axis,
      ratio: clampRatio(typeof rec.ratio === "number" ? rec.ratio : 0.5),
      first,
      second,
    };
  }
  return null;
}
