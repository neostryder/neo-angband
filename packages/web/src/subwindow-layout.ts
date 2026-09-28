/**
 * Binary-space-partition tiling for the game view and its subwindows.
 *
 * A node is either a leaf or a split (two children sharing an axis). A leaf is
 * a tab group: `id` is the panel it shows, and `tabs`, present only when the
 * group holds more than one panel, lists every panel in tab order. A saved
 * tree from before tab groups is a tree of one-tab groups and loads as is.
 * The root always covers the viewport, so the computed rectangles have no gaps
 * and no overlaps. Drag-docking replaces a leaf with a split; removing the
 * last panel of a leaf collapses its parent. This is the same shape as a
 * tiling window manager, not free-floating OS windows.
 *
 * The main view never joins a group of more than one tab: an inactive tab is
 * hidden, and the dungeon view is never hidden. It can still move: it docks
 * against another panel's edge or trades places with a panel like any other.
 */

export const MAIN_TILE_ID = "main";

export type TileId = string;
export interface FloatRect {
  id: TileId;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RememberedPlace {
  dock?: LayoutNode;
  float?: Omit<FloatRect, "id">;
  last: "dock" | "float";
  /** Set aside by the host while its mod stopped providing it (#296); it returns here when the kind is registered again. */
  parked?: boolean;
}
export type SplitAxis = "h" | "v";
export type DockEdge = "left" | "right" | "top" | "bottom";

export interface SplitNode {
  kind: "split";
  axis: SplitAxis;
  ratio: number;
  /**
   * The player dragged this divider, so a panel's fit-to-content height no
   * longer moves it (#287). Double-clicking the divider clears it.
   */
  sized?: true;
  first: LayoutNode;
  second: LayoutNode;
}

export interface LeafNode {
  kind: "leaf";
  /** The panel this group shows: its active tab. */
  id: TileId;
  /** Every panel in the group, in tab order, when it holds more than one. */
  tabs?: readonly TileId[];
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
  /** The group's panels in tab order; absent for a single panel. */
  tabs?: readonly TileId[];
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
  | { kind: "swap"; id: TileId; preview: Rect }
  | { kind: "tab"; id: TileId; preview: Rect };

/** What a center drop zone does with the dragged panel, shown on its guide. */
export const DROP_ZONE_LABELS: Readonly<Record<"swap" | "tab", string>> = {
  swap: "Swap",
  tab: "Tab",
};

export const SPLITTER_PX = 6;
export const MIN_TILE_PX = 96;

/**
 * A second, more generous floor used only to decide whether a panel should be
 * dropped from a cramped layout (neo-angband#275) - never passed to
 * `splitSizes`, and never changing what `computeLayout` actually renders a
 * tile at. `MIN_TILE_PX` is an anti-invisibility floor: it stops a panel
 * collapsing to nothing, but 96px of a term whose own `minCols` floor is 20
 * (see main.ts's `ensureSubwindowTerm`) forces the term's font-shrink loop
 * (`fitReflow` in term.ts) most of the way to its own 11px floor, which is
 * legible only in the sense that pixels are lit. `COMFORTABLE_MIN_PX` is
 * picked well clear of that: enough margin above `MIN_TILE_PX` that a panel
 * sitting at or a little above it is not fighting the term's own shrink loop
 * for every frame. It is not a precise inverse of the font math above - this
 * is a defensible, documented margin, not a pixel-exact derivation.
 */
export const COMFORTABLE_MIN_PX = 140;

export function isSplit(node: LayoutNode): node is SplitNode {
  return node.kind === "split";
}

export function isLeaf(node: LayoutNode): node is LeafNode {
  return node.kind === "leaf";
}

/** A group's panels in tab order; a single panel is a group of one. */
export function groupTabs(leaf: LeafNode): readonly TileId[] {
  return leaf.tabs && leaf.tabs.length > 1 ? leaf.tabs : [leaf.id];
}

/** Build a group, dropping `tabs` when only one panel is left in it. */
function makeGroup(tabs: readonly TileId[], active: TileId): LeafNode {
  const id = tabs.includes(active) ? active : tabs[0]!;
  return tabs.length > 1 ? { kind: "leaf", id, tabs: [...tabs] } : { kind: "leaf", id };
}

/** Every panel in the tree, including inactive tabs. */
export function leafIds(node: LayoutNode): TileId[] {
  if (node.kind === "leaf") return [...groupTabs(node)];
  return [...leafIds(node.first), ...leafIds(node.second)];
}

export function containsLeaf(node: LayoutNode, id: TileId): boolean {
  if (node.kind === "leaf") return groupTabs(node).includes(id);
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
  firstMin: number,
  secondMin = firstMin,
): [number, number] {
  const inner = Math.max(0, parent - splitter);
  if (inner <= 0) return [0, 0];
  if (inner < firstMin + secondMin) {
    const first = Math.floor(inner / 2);
    return [first, inner - first];
  }
  let first = Math.round(inner * clampRatio(ratio));
  first = Math.max(firstMin, Math.min(inner - secondMin, first));
  return [first, inner - first];
}

export interface LayoutOptions {
  splitterPx?: number;
  minPx?: number;
  minSizes?: ReadonlyMap<TileId, Readonly<{ width: number; height: number }>>;
  /**
   * Heights in CSS pixels that panels ask for to fit their content (#287),
   * keyed by panel id. A request applies when the panel is the active tab of
   * one side of a stacked split whose divider the player has not dragged.
   */
  fit?: ReadonlyMap<TileId, number>;
}

export function computeLayout(
  tree: LayoutNode,
  viewport: Rect,
  opts: LayoutOptions = {},
): LayoutRects {
  const splitterPx = opts.splitterPx ?? SPLITTER_PX;
  const minPx = opts.minPx ?? MIN_TILE_PX;
  const tiles: TileRect[] = [];
  const splitters: SplitterRect[] = [];
  walk(tree, viewport, [], splitterPx, minPx, opts.fit, opts.minSizes, tiles, splitters);
  return { tiles, splitters };
}

/**
 * The ratio that gives a fitted panel its requested height, or the saved
 * ratio when no request applies. The result is kept inside the same minimum
 * sizes as a dragged divider.
 */
function fittedRatio(node: SplitNode, height: number, splitterPx: number, fit?: ReadonlyMap<TileId, number>): number {
  if (!fit || fit.size === 0 || node.sized) return node.ratio;
  const inner = height - splitterPx;
  if (inner <= 0) return node.ratio;
  const want = (child: LayoutNode): number | undefined => {
    if (child.kind !== "leaf" || child.id === MAIN_TILE_ID) return undefined;
    const px = fit.get(child.id);
    return px !== undefined && Number.isFinite(px) && px > 0 ? px : undefined;
  };
  const first = want(node.first);
  if (first !== undefined) return clampRatio(first / inner);
  const second = want(node.second);
  if (second !== undefined) return clampRatio(1 - second / inner);
  return node.ratio;
}

function walk(
  node: LayoutNode,
  rect: Rect,
  path: readonly number[],
  splitterPx: number,
  minPx: number,
  fit: ReadonlyMap<TileId, number> | undefined,
  minSizes: ReadonlyMap<TileId, Readonly<{ width: number; height: number }>> | undefined,
  tiles: TileRect[],
  splitters: SplitterRect[],
): void {
  if (node.kind === "leaf") {
    const tabs = groupTabs(node);
    tiles.push(tabs.length > 1 ? { id: node.id, rect, tabs } : { id: node.id, rect });
    return;
  }
  if (node.axis === "v") {
    const [firstW, secondW] = splitSizes(rect.w, node.ratio, splitterPx,
      minimum(node.first, "width", minPx, splitterPx, minSizes),
      minimum(node.second, "width", minPx, splitterPx, minSizes));
    const firstRect = { x: rect.x, y: rect.y, w: firstW, h: rect.h };
    const gutter = { x: rect.x + firstW, y: rect.y, w: splitterPx, h: rect.h };
    const secondRect = {
      x: rect.x + firstW + splitterPx,
      y: rect.y,
      w: secondW,
      h: rect.h,
    };
    splitters.push({ axis: "v", path, rect: gutter, parent: rect });
    walk(node.first, firstRect, [...path, 0], splitterPx, minPx, fit, minSizes, tiles, splitters);
    walk(node.second, secondRect, [...path, 1], splitterPx, minPx, fit, minSizes, tiles, splitters);
    return;
  }
  const ratio = fittedRatio(node, rect.h, splitterPx, fit);
  const [firstH, secondH] = splitSizes(rect.h, ratio, splitterPx,
    minimum(node.first, "height", minPx, splitterPx, minSizes),
    minimum(node.second, "height", minPx, splitterPx, minSizes));
  const firstRect = { x: rect.x, y: rect.y, w: rect.w, h: firstH };
  const gutter = { x: rect.x, y: rect.y + firstH, w: rect.w, h: splitterPx };
  const secondRect = {
    x: rect.x,
    y: rect.y + firstH + splitterPx,
    w: rect.w,
    h: secondH,
  };
  splitters.push({ axis: "h", path, rect: gutter, parent: rect });
  walk(node.first, firstRect, [...path, 0], splitterPx, minPx, fit, minSizes, tiles, splitters);
  walk(node.second, secondRect, [...path, 1], splitterPx, minPx, fit, minSizes, tiles, splitters);
}

function minimum(node: LayoutNode, axis: "width" | "height", floor: number, splitter: number,
  hints: ReadonlyMap<TileId, Readonly<{ width: number; height: number }>> | undefined): number {
  if (node.kind === "leaf") return Math.max(floor, ...groupTabs(node).map((id) => hints?.get(id)?.[axis] ?? floor));
  const first = minimum(node.first, axis, floor, splitter, hints);
  const second = minimum(node.second, axis, floor, splitter, hints);
  return (axis === "width" && node.axis === "v") || (axis === "height" && node.axis === "h")
    ? first + second + splitter : Math.max(first, second);
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

/** The path to the group holding `id`, whether or not it is the active tab. */
function findPath(node: LayoutNode, id: TileId, path: number[] = []): number[] | null {
  if (node.kind === "leaf") return groupTabs(node).includes(id) ? path : null;
  const first = findPath(node.first, id, [...path, 0]);
  if (first) return first;
  return findPath(node.second, id, [...path, 1]);
}

/**
 * Take one panel out of the tree. A panel sharing a group leaves the rest of
 * the group in place, and the next tab becomes active if the removed panel was
 * the one shown. The last panel of a group takes the group with it and
 * collapses its parent split.
 */
export function removeLeaf(tree: LayoutNode, id: TileId): LayoutNode {
  if (id === MAIN_TILE_ID) return tree;
  return removeFrom(tree, id) ?? tree;
}

/** Restore a panel beside its former neighbor while keeping current panels. */
export function restoreDockPlace(tree: LayoutNode, id: TileId, saved: LayoutNode): LayoutNode | null {
  function find(node: LayoutNode): LayoutNode | null {
    if (node.kind === "leaf") {
      if (!groupTabs(node).includes(id)) return null;
      const neighbor = groupTabs(node).find((tab) => tab !== id && containsLeaf(tree, tab));
      return neighbor ? tabInto(tree, id, neighbor) : null;
    }
    const inFirst = containsLeaf(node.first, id);
    const inSecond = containsLeaf(node.second, id);
    if (!inFirst && !inSecond) return null;
    const nested = find(inFirst ? node.first : node.second);
    if (nested) return nested;
    const target = leafIds(inFirst ? node.second : node.first).find((candidate) => containsLeaf(tree, candidate));
    if (!target) return null;
    const edge = node.axis === "v" ? (inFirst ? "left" : "right") : (inFirst ? "top" : "bottom");
    return insertAtEdge(tree, id, target, edge, inFirst ? node.ratio : 1 - node.ratio);
  }
  return containsLeaf(saved, id) && !containsLeaf(tree, id) ? find(saved) : null;
}

function removeFrom(node: LayoutNode, id: TileId): LayoutNode | null {
  if (node.kind === "leaf") {
    const tabs = groupTabs(node);
    const index = tabs.indexOf(id);
    if (index < 0) return node;
    const rest = tabs.filter((tab) => tab !== id);
    if (rest.length === 0) return null;
    return makeGroup(rest, node.id === id ? rest[Math.min(index, rest.length - 1)]! : node.id);
  }
  const first = removeFrom(node.first, id);
  const second = removeFrom(node.second, id);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function splitOnEdge(
  target: LayoutNode,
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
  /* removeLeaf keeps the main view in place for every caller that closes or
   * prunes panels; a move takes it out so it can land somewhere else. */
  const stripped = removeFrom(tree, incomingId) ?? tree;
  const path = findPath(stripped, targetId);
  if (!path) return tree;
  const target = nodeAt(stripped, path);
  if (!target) return tree;
  const incoming: LeafNode = { kind: "leaf", id: incomingId };
  return replaceAt(stripped, path, splitOnEdge(target, incoming, edge, incomingRatio));
}

function groupCount(node: LayoutNode): number {
  return node.kind === "leaf" ? 1 : groupCount(node.first) + groupCount(node.second);
}

/**
 * Open a panel on one side of the main view without shrinking the main view
 * again for every panel (#297). When panels already sit on that side, the new
 * one joins the nearest of them at the far end, taking an equal share of their
 * space. Only the first panel on a side splits the main view, with
 * `incomingRatio` as its share. Dragging a panel onto the main view's edge
 * still uses `insertAtEdge`, which puts it exactly where it was dropped.
 */
export function dockBesideMain(
  tree: LayoutNode,
  incomingId: TileId,
  edge: DockEdge,
  incomingRatio = 0.3,
): LayoutNode {
  if (incomingId === MAIN_TILE_ID) return tree;
  const stripped = removeFrom(tree, incomingId) ?? tree;
  const mainPath = findPath(stripped, MAIN_TILE_ID);
  if (!mainPath) return tree;
  const axis: SplitAxis = edge === "left" || edge === "right" ? "v" : "h";
  const mainStep = edge === "right" || edge === "bottom" ? 0 : 1;
  for (let depth = mainPath.length - 1; depth >= 0; depth--) {
    const splitPath = mainPath.slice(0, depth);
    const node = nodeAt(stripped, splitPath);
    if (node?.kind !== "split" || node.axis !== axis || mainPath[depth] !== mainStep) continue;
    const sidePath = [...splitPath, mainStep === 0 ? 1 : 0];
    const side = mainStep === 0 ? node.second : node.first;
    const along: DockEdge = axis === "v" ? "bottom" : "right";
    const incoming: LeafNode = { kind: "leaf", id: incomingId };
    return replaceAt(stripped, sidePath, splitOnEdge(side, incoming, along, 1 / (groupCount(side) + 1)));
  }
  return insertAtEdge(stripped, incomingId, MAIN_TILE_ID, edge, incomingRatio);
}

function mapIds(node: LayoutNode, map: (id: TileId) => TileId): LayoutNode {
  if (node.kind === "leaf") return makeGroup(groupTabs(node).map(map), map(node.id));
  return { ...node, first: mapIds(node.first, map), second: mapIds(node.second, map) };
}

/**
 * Exchange two panels. Each takes the other's position, including its place in
 * a tab group. The main view does not trade places with a panel that shares a
 * group, because that would put the main view inside the group.
 */
export function swapLeaves(tree: LayoutNode, a: TileId, b: TileId): LayoutNode {
  if (a === b) return tree;
  const pathA = findPath(tree, a);
  const pathB = findPath(tree, b);
  if (!pathA || !pathB) return tree;
  const other = a === MAIN_TILE_ID ? pathB : b === MAIN_TILE_ID ? pathA : null;
  if (other) {
    const group = nodeAt(tree, other);
    if (group?.kind === "leaf" && groupTabs(group).length > 1) return tree;
  }
  return mapIds(tree, (id) => (id === a ? b : id === b ? a : id));
}

/** Move a panel into another panel's group as that group's active tab. */
export function tabInto(tree: LayoutNode, incomingId: TileId, targetId: TileId): LayoutNode {
  if (incomingId === targetId || incomingId === MAIN_TILE_ID || targetId === MAIN_TILE_ID) return tree;
  if (!containsLeaf(tree, targetId)) return tree;
  const stripped = removeLeaf(tree, incomingId);
  const path = findPath(stripped, targetId);
  if (!path) return tree;
  const group = nodeAt(stripped, path);
  if (group?.kind !== "leaf") return tree;
  return replaceAt(stripped, path, makeGroup([...groupTabs(group), incomingId], incomingId));
}

/** Show `id` in its group. A panel alone in its group is already shown. */
export function selectTab(tree: LayoutNode, id: TileId): LayoutNode {
  const path = findPath(tree, id);
  if (!path) return tree;
  const group = nodeAt(tree, path);
  if (group?.kind !== "leaf" || group.id === id) return tree;
  return replaceAt(tree, path, makeGroup(groupTabs(group), id));
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
  return replaceAt(tree, path, { ...node, ratio: clampRatio(ratio), sized: true });
}

/** Hand a dragged divider back to fit-to-content sizing. */
export function unsizeSplit(tree: LayoutNode, path: readonly number[]): LayoutNode {
  const node = nodeAt(tree, path);
  if (!node || node.kind !== "split" || !node.sized) return tree;
  const { sized: _sized, ...rest } = node;
  return replaceAt(tree, path, rest);
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

export interface DropZoneOptions {
  fraction?: number;
  minPx?: number;
  maxPx?: number;
  /** The panel being dragged. The main view never becomes a tab. */
  dragging?: TileId;
  /** Offer the Tab target. False leaves the whole interior as Swap. */
  tabs?: boolean;
}

/**
 * The interior of a tile, inside its four edge bands, split into the Swap
 * target and the Tab target: side by side in a wide tile, stacked in a tall
 * one. When the main view is either end of the drop, the whole interior is
 * Swap.
 */
function centerZones(tile: TileRect, opts: ResolvedZoneOptions): DropZone[] {
  const { rect } = tile;
  const left = edgeBand(rect, "left", opts.fraction, opts.minPx, opts.maxPx).w;
  const top = edgeBand(rect, "top", opts.fraction, opts.minPx, opts.maxPx).h;
  const inner = {
    x: rect.x + left,
    y: rect.y + top,
    w: Math.max(0, rect.w - left * 2),
    h: Math.max(0, rect.h - top * 2),
  };
  if (!opts.tabs || tile.id === MAIN_TILE_ID || opts.dragging === MAIN_TILE_ID) {
    return [{ kind: "swap", id: tile.id, preview: inner }];
  }
  if (inner.w >= inner.h) {
    const half = Math.floor(inner.w / 2);
    return [
      { kind: "swap", id: tile.id, preview: { ...inner, w: half } },
      { kind: "tab", id: tile.id, preview: { ...inner, x: inner.x + half, w: inner.w - half } },
    ];
  }
  const half = Math.floor(inner.h / 2);
  return [
    { kind: "swap", id: tile.id, preview: { ...inner, h: half } },
    { kind: "tab", id: tile.id, preview: { ...inner, y: inner.y + half, h: inner.h - half } },
  ];
}

type ResolvedZoneOptions = Required<Omit<DropZoneOptions, "dragging">> & { dragging?: TileId | undefined };

function zoneOptions(opts: DropZoneOptions): ResolvedZoneOptions {
  return {
    fraction: opts.fraction ?? 0.25,
    minPx: opts.minPx ?? 12,
    maxPx: opts.maxPx ?? 56,
    dragging: opts.dragging,
    tabs: opts.tabs ?? true,
  };
}

export function dropZoneAt(
  tiles: readonly TileRect[],
  x: number,
  y: number,
  opts: DropZoneOptions = {},
): DropZone | null {
  const resolved = zoneOptions(opts);
  const hit = tiles.find((tile) => pointInRect(tile.rect, x, y));
  if (!hit) return null;
  const edges: DockEdge[] = ["left", "right", "top", "bottom"];
  for (const edge of edges) {
    const preview = edgeBand(hit.rect, edge, resolved.fraction, resolved.minPx, resolved.maxPx);
    if (pointInRect(preview, x, y)) {
      return { kind: "dock", id: hit.id, edge, preview };
    }
  }
  const center = centerZones(hit, resolved);
  return center.find((zone) => pointInRect(zone.preview, x, y)) ?? center[0]!;
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
  opts: DropZoneOptions = {},
): DropZone[] {
  const resolved = zoneOptions({ ...opts, dragging: opts.dragging ?? excludeId });
  const edges: DockEdge[] = ["left", "right", "top", "bottom"];
  const zones: DropZone[] = [];
  for (const tile of tiles) {
    if (tile.id === excludeId) continue;
    zones.push(...centerZones(tile, resolved));
    for (const edge of edges) {
      zones.push({
        kind: "dock",
        id: tile.id,
        edge,
        preview: edgeBand(tile.rect, edge, resolved.fraction, resolved.minPx, resolved.maxPx),
      });
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
  if (zone.kind === "tab") return tabInto(tree, incomingId, zone.id);
  /* A docked panel takes the smaller share of the split. The dungeon view is
   * the play area, so when it is the one moving it takes the larger share. */
  const ratio = incomingId === MAIN_TILE_ID ? 1 - incomingRatio : incomingRatio;
  return insertAtEdge(tree, incomingId, zone.id, zone.edge, ratio);
}

export function pruneTree(node: LayoutNode, keep: ReadonlySet<TileId>): LayoutNode | null {
  if (node.kind === "leaf") {
    const tabs = groupTabs(node);
    const kept = tabs.filter((id) => keep.has(id));
    if (kept.length === 0) return null;
    if (kept.length === tabs.length) return node;
    return makeGroup(kept, node.id);
  }
  const first = pruneTree(node.first, keep);
  const second = pruneTree(node.second, keep);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export interface ComfortMerge {
  /** The panel that was shown in the group moved. */
  id: TileId;
  /** The panel shown in the group it joined. */
  into: TileId;
}

export interface ComfortResult {
  /** The tree to actually render, with 0 or more groups merged together. */
  tree: LayoutNode;
  /** Each merge, in the order it happened (smallest group first). */
  merged: ComfortMerge[];
}

/** How far apart two rectangles' shapes are: 0 for the same aspect ratio. */
function shapeDistance(a: Rect, b: Rect): number {
  const ratio = (r: Rect): number => Math.max(1, r.w) / Math.max(1, r.h);
  return Math.abs(Math.log(ratio(a)) - Math.log(ratio(b)));
}

/** Remove a whole group at `path`, collapsing its parent split. */
function removeGroupAt(tree: LayoutNode, path: readonly number[]): LayoutNode | null {
  if (path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(tree, parentPath);
  if (!parent || parent.kind !== "split") return tree;
  const survivor = path[path.length - 1] === 0 ? parent.second : parent.first;
  return replaceAt(tree, parentPath, survivor);
}

/**
 * Small-viewport pass (neo-angband#275, #287): given the tree a player
 * actually arranged and the real viewport it is about to be rendered into,
 * repeatedly take the smallest group that is too cramped to read and merge
 * all of its panels as tabs into the open group whose shape is closest to it
 * (a tall panel joins a tall panel, a wide one a wide one), until every group
 * clears `COMFORTABLE_MIN_PX` or only one group besides the main view is left.
 * No panel is hidden by this pass: a merged panel is one tab away.
 *
 * The saved tree is never changed. The pass decides which render tree to
 * hand to the ordinary `computeLayout` path, so growing the viewport back out
 * separates the groups again with nothing to undo. A layout that already fits
 * runs the loop once, finds nothing to merge, and returns the same tree object.
 *
 * `prefer` lists panels to show in whichever merged group they end up in, so
 * a tab chosen inside a merged group stays chosen across repaints.
 *
 * A group counts as comfortable only when its narrower side clears the
 * threshold, whichever edge it is docked on. The main view never merges and
 * is never merged into, matching the rule that it never shares a group.
 */
export function fitForComfort(
  tree: LayoutNode,
  viewport: Rect,
  opts: { splitterPx?: number; minPx?: number; comfortablePx?: number; prefer?: readonly TileId[] } = {},
): ComfortResult {
  const comfortablePx = opts.comfortablePx ?? COMFORTABLE_MIN_PX;
  const merged: ComfortMerge[] = [];
  let current = tree;
  for (;;) {
    const { tiles } = computeLayout(current, viewport, opts);
    const groups = tiles.filter((tile) => tile.id !== MAIN_TILE_ID);
    if (groups.length <= 1) break;
    let smallest: TileRect | null = null;
    let smallestSize = Infinity;
    for (const tile of groups) {
      const size = Math.min(tile.rect.w, tile.rect.h);
      if (size >= comfortablePx) continue;
      if (size < smallestSize) {
        smallest = tile;
        smallestSize = size;
      }
    }
    if (!smallest) break;
    let target: TileRect | null = null;
    let best = Infinity;
    for (const tile of groups) {
      if (tile === smallest) continue;
      const distance = shapeDistance(smallest.rect, tile.rect);
      const area = tile.rect.w * tile.rect.h;
      const bestArea = target ? target.rect.w * target.rect.h : -1;
      if (distance < best - 1e-9 || (Math.abs(distance - best) <= 1e-9 && area > bestArea)) {
        target = tile;
        best = distance;
      }
    }
    if (!target) break;
    const fromPath = findPath(current, smallest.id);
    const fromNode = fromPath ? nodeAt(current, fromPath) : null;
    if (!fromPath || !fromNode || fromNode.kind !== "leaf") break;
    const without = removeGroupAt(current, fromPath);
    if (!without) break;
    const intoPath = findPath(without, target.id);
    const intoNode = intoPath ? nodeAt(without, intoPath) : null;
    if (!intoPath || !intoNode || intoNode.kind !== "leaf") break;
    const tabs = [...groupTabs(intoNode), ...groupTabs(fromNode)];
    const preferred = opts.prefer?.find((id) => tabs.includes(id));
    current = replaceAt(without, intoPath, makeGroup(tabs, preferred ?? intoNode.id));
    merged.push({ id: smallest.id, into: target.id });
  }
  return { tree: current, merged };
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
    if (rec.tabs === undefined) return { kind: "leaf", id: rec.id };
    if (!Array.isArray(rec.tabs)) return null;
    const tabs = rec.tabs as unknown[];
    if (!tabs.every((tab): tab is string => typeof tab === "string" && tab.length > 0)) return null;
    if (!tabs.includes(rec.id) || new Set(tabs).size !== tabs.length) return null;
    if (tabs.length > 1 && tabs.includes(MAIN_TILE_ID)) return null;
    return makeGroup(tabs, rec.id);
  }
  if (rec.kind === "split") {
    if (rec.axis !== "h" && rec.axis !== "v") return null;
    const first = parseNode(rec.first);
    const second = parseNode(rec.second);
    if (!first || !second) return null;
    const split: SplitNode = {
      kind: "split",
      axis: rec.axis,
      ratio: clampRatio(typeof rec.ratio === "number" ? rec.ratio : 0.5),
      first,
      second,
    };
    if (rec.sized === true) split.sized = true;
    return split;
  }
  return null;
}
