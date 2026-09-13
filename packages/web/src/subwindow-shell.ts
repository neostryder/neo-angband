/**
 * DOM host for the BSP tiling tree: absolute tiles, splitter drags, and
 * right-click docking. The algorithm is in subwindow-layout.ts; this file
 * only applies rectangles and pointer events.
 *
 * Left-click stays reserved for game input. The main view is not a docking
 * source - its right-click already opens the command wheel.
 */

import {
  MAIN_TILE_ID,
  applyDrop,
  computeLayout,
  dropZoneAt,
  ratioFromPointer,
  resizeSplit,
  type DropZone,
  type LayoutNode,
  type Rect,
} from "./subwindow-layout";

export interface SubwindowShell {
  apply(tree: LayoutNode): void;
  slot(id: string): HTMLElement | undefined;
  canvas(id: string): HTMLCanvasElement | undefined;
  bounds(id: string): HTMLElement | undefined;
  tree(): LayoutNode;
  destroy(): void;
}

export interface SubwindowShellOptions {
  host: HTMLElement;
  mainSlot: HTMLElement;
  labels: Readonly<Record<string, string>>;
  onTreeChange: (tree: LayoutNode) => void;
}

const DRAG_THRESHOLD = 6;

function setRect(el: HTMLElement, rect: Rect): void {
  el.style.position = "absolute";
  el.style.left = `${String(rect.x)}px`;
  el.style.top = `${String(rect.y)}px`;
  el.style.width = `${String(rect.w)}px`;
  el.style.height = `${String(rect.h)}px`;
}

function hostSize(host: HTMLElement): Rect {
  return { x: 0, y: 0, w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
}

function pointerInHost(host: HTMLElement, event: PointerEvent): { x: number; y: number } {
  const bounds = host.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

export function mountSubwindowShell(opts: SubwindowShellOptions): SubwindowShell {
  const { host, mainSlot, labels, onTreeChange } = opts;
  host.classList.add("tile-host");
  mainSlot.classList.add("tile-leaf");
  mainSlot.dataset.tile = MAIN_TILE_ID;

  const slots = new Map<string, HTMLElement>();
  const canvases = new Map<string, HTMLCanvasElement>();
  slots.set(MAIN_TILE_ID, mainSlot);
  const mainCanvas = mainSlot.querySelector("canvas");
  if (mainCanvas instanceof HTMLCanvasElement) canvases.set(MAIN_TILE_ID, mainCanvas);

  let currentTree: LayoutNode = { kind: "leaf", id: MAIN_TILE_ID };
  const gutters: HTMLElement[] = [];
  const preview = document.createElement("div");
  preview.className = "tile-drop-preview";
  preview.hidden = true;
  host.appendChild(preview);

  let resize: { path: readonly number[]; pointerId: number } | null = null;
  let drag: {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null = null;

  function bindLeafDrag(leaf: HTMLElement): void {
    leaf.addEventListener("pointerdown", onLeafPointerDown, true);
    leaf.addEventListener("contextmenu", onContextMenu);
  }

  function ensureSlot(id: string): HTMLElement {
    const existing = slots.get(id);
    if (existing) return existing;
    const leaf = document.createElement("section");
    leaf.className = "tile-leaf subwindow-slot";
    leaf.dataset.tile = id;
    leaf.setAttribute("aria-label", labels[id] ?? id);
    const title = document.createElement("div");
    title.className = "tile-title";
    title.textContent = labels[id] ?? id;
    const body = document.createElement("div");
    body.className = "tile-body";
    const canvas = document.createElement("canvas");
    canvas.id = `subwindow-${id}`;
    body.appendChild(canvas);
    leaf.appendChild(title);
    leaf.appendChild(body);
    bindLeafDrag(leaf);
    host.appendChild(leaf);
    slots.set(id, leaf);
    canvases.set(id, canvas);
    return leaf;
  }

  function clearGutters(): void {
    for (const gutter of gutters) gutter.remove();
    gutters.length = 0;
  }

  function paint(tree: LayoutNode): void {
    currentTree = tree;
    const layout = computeLayout(tree, hostSize(host));
    const visible = new Set(layout.tiles.map((tile) => tile.id));
    for (const tile of layout.tiles) {
      const leaf = tile.id === MAIN_TILE_ID ? mainSlot : ensureSlot(tile.id);
      leaf.hidden = false;
      setRect(leaf, tile.rect);
      if (!leaf.isConnected) host.appendChild(leaf);
    }
    for (const [id, leaf] of slots) {
      if (id === MAIN_TILE_ID) continue;
      if (!visible.has(id)) leaf.hidden = true;
    }
    clearGutters();
    for (const splitter of layout.splitters) {
      const gutter = document.createElement("div");
      gutter.className = "tile-gutter";
      gutter.dataset.axis = splitter.axis;
      gutter.dataset.path = splitter.path.join(".");
      gutter.setAttribute("role", "separator");
      gutter.style.cursor = splitter.axis === "v" ? "col-resize" : "row-resize";
      setRect(gutter, splitter.rect);
      gutter.addEventListener("pointerdown", onGutterPointerDown);
      host.appendChild(gutter);
      gutters.push(gutter);
    }
  }

  function zoneFromEvent(event: PointerEvent): DropZone | null {
    const point = pointerInHost(host, event);
    const { tiles } = computeLayout(currentTree, hostSize(host));
    return dropZoneAt(tiles, point.x, point.y);
  }

  function showPreview(zone: DropZone | null): void {
    if (!zone) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    preview.dataset.kind = zone.kind;
    setRect(preview, zone.preview);
  }

  const onGutterPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const gutter = event.currentTarget;
    if (!(gutter instanceof HTMLElement)) return;
    event.preventDefault();
    const path = (gutter.dataset.path ?? "")
      .split(".")
      .filter((part) => part.length > 0)
      .map((part) => Number(part));
    resize = { path, pointerId: event.pointerId };
    gutter.setPointerCapture(event.pointerId);
  };

  const onLeafPointerDown = (event: PointerEvent): void => {
    if (event.button !== 2) return;
    const leaf = event.currentTarget;
    if (!(leaf instanceof HTMLElement)) return;
    const id = leaf.dataset.tile;
    if (!id || id === MAIN_TILE_ID) return;
    event.preventDefault();
    drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    leaf.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (resize && event.pointerId === resize.pointerId) {
      const { splitters } = computeLayout(currentTree, hostSize(host));
      const splitter = splitters.find(
        (entry) => entry.path.join(".") === resize!.path.join("."),
      );
      if (!splitter) return;
      const point = pointerInHost(host, event);
      const ratio = ratioFromPointer(splitter.axis, splitter.parent, point);
      paint(resizeSplit(currentTree, resize.path, ratio));
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active && dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
      drag.active = true;
      host.classList.add("tile-host-dragging");
    }
    if (drag.active) showPreview(zoneFromEvent(event));
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (resize && event.pointerId === resize.pointerId) {
      resize = null;
      onTreeChange(currentTree);
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    const incoming = drag.id;
    const wasActive = drag.active;
    drag = null;
    host.classList.remove("tile-host-dragging");
    preview.hidden = true;
    if (!wasActive) return;
    const zone = zoneFromEvent(event);
    if (!zone || zone.id === incoming) return;
    const next = applyDrop(currentTree, incoming, zone);
    paint(next);
    onTreeChange(next);
  };

  const onContextMenu = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const leaf = target.closest(".tile-leaf");
    if (!(leaf instanceof HTMLElement)) return;
    if (leaf.dataset.tile === MAIN_TILE_ID) return;
    event.preventDefault();
  };

  const onResize = (): void => {
    paint(currentTree);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onResize);

  return {
    apply(tree) {
      paint(tree);
    },
    slot(id) {
      return slots.get(id);
    },
    canvas(id) {
      return canvases.get(id);
    },
    bounds(id) {
      const leaf = slots.get(id);
      if (!leaf) return undefined;
      if (id === MAIN_TILE_ID) return leaf;
      return (leaf.querySelector(".tile-body") as HTMLElement | null) ?? leaf;
    },
    tree() {
      return currentTree;
    },
    destroy() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onResize);
      for (const leaf of slots.values()) {
        if (leaf === mainSlot) continue;
        leaf.removeEventListener("pointerdown", onLeafPointerDown, true);
        leaf.removeEventListener("contextmenu", onContextMenu);
      }
      clearGutters();
      preview.remove();
    },
  };
}
