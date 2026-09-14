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

/** One mod-owned chrome control (neo-angband#241), rendered between the title label and the close button. */
export interface SubwindowControlSpec {
  readonly glyph: string;
  readonly title?: string;
  readonly onActivate: () => void;
}

export interface SubwindowShell {
  apply(tree: LayoutNode): void;
  slot(id: string): HTMLElement | undefined;
  canvas(id: string): HTMLCanvasElement | undefined;
  bounds(id: string): HTMLElement | undefined;
  tree(): LayoutNode;
  /**
   * Add (or replace) one chrome control on a panel's title bar, keyed by
   * `key` - re-adding the same key updates it in place. Returns an unregister
   * function. A panel not currently tiled still remembers the control and
   * renders it as soon as the panel reappears.
   */
  addControl(id: string, key: string, control: SubwindowControlSpec): () => void;
  /** The id of the panel that currently holds DOM focus, or null. */
  focusedId(): string | null;
  /**
   * Hide (or restore) every non-main panel and splitter while a full-screen
   * modal owns the terminal - the Options Menu, a shop, the target loop, and
   * anything else main.ts's modalDepth already tracks. A panel remembers its
   * own tiling visibility and returns to exactly that once cleared.
   */
  setModalActive(active: boolean): void;
  destroy(): void;
}

export interface SubwindowShellOptions {
  host: HTMLElement;
  mainSlot: HTMLElement;
  labels: Readonly<Record<string, string>>;
  onTreeChange: (tree: LayoutNode) => void;
  /** A panel's own close [x] was clicked (neo-angband#246); never fired for the main tile. */
  onClose?: (id: string) => void;
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
  const { host, mainSlot, labels, onTreeChange, onClose } = opts;
  host.classList.add("tile-host");
  mainSlot.classList.add("tile-leaf");
  mainSlot.dataset.tile = MAIN_TILE_ID;
  /*
   * neo-angband#241: the main view is not focusable (it has no tabIndex, and
   * gains none here - left-click stays reserved for game input), so a click
   * on it leaves whatever subwindow leaf was last focused as
   * document.activeElement instead of moving focus away, which is the
   * browser's ordinary behaviour for a click on a non-focusable element.
   * Without this, `focusedId()` would keep reporting a panel long after the
   * player returned to ordinary play. Blurring on the main view's own
   * pointerdown clears it without adding a focus stop of its own.
   */
  const onMainPointerDown = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== mainSlot && active.closest(".tile-leaf")) active.blur();
  };
  mainSlot.addEventListener("pointerdown", onMainPointerDown);

  const slots = new Map<string, HTMLElement>();
  const canvases = new Map<string, HTMLCanvasElement>();
  slots.set(MAIN_TILE_ID, mainSlot);
  const mainCanvas = mainSlot.querySelector("canvas");
  if (mainCanvas instanceof HTMLCanvasElement) canvases.set(MAIN_TILE_ID, mainCanvas);

  /* neo-angband#241: mod-owned chrome controls, keyed per panel then per
   * caller-supplied key so a mod can register more than one (e.g. "-" and
   * "+") without colliding with another mod's. Kept even for a panel not
   * currently tiled, so re-enabling it restores its controls. */
  const panelControls = new Map<string, Map<string, SubwindowControlSpec>>();
  const controlsContainers = new Map<string, HTMLElement>();
  let focusedId: string | null = null;

  function controlsFor(id: string): Map<string, SubwindowControlSpec> {
    let byKey = panelControls.get(id);
    if (!byKey) {
      byKey = new Map();
      panelControls.set(id, byKey);
    }
    return byKey;
  }

  function renderControl(container: HTMLElement, spec: SubwindowControlSpec): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile-control";
    button.textContent = spec.glyph;
    if (spec.title) button.title = spec.title;
    /* Same stopPropagation reasoning as .tile-close: the leaf's own
     * pointerdown (drag-to-dock) listener is capture-phase. */
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      spec.onActivate();
    });
    container.appendChild(button);
  }

  /** Re-render one panel's controls container from its current registered set. */
  function refreshControls(id: string): void {
    const container = controlsContainers.get(id);
    if (!container) return;
    container.replaceChildren();
    for (const spec of controlsFor(id).values()) renderControl(container, spec);
  }

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

  /*
   * neo-angband#241: a plain left click focuses the leaf (a canvas has no
   * tabIndex of its own, so a click on it would otherwise never move focus),
   * which is how a mod tells this panel apart from the main view for a
   * "focus + Ctrl-keystroke" zoom gesture. Left-click still does not
   * otherwise act on the leaf - see the header on why it stays reserved.
   */
  const onLeafFocusClick = (event: PointerEvent): void => {
    const leaf = event.currentTarget;
    if (event.button === 0 && leaf instanceof HTMLElement) leaf.focus();
  };

  function bindLeafDrag(leaf: HTMLElement): void {
    leaf.addEventListener("pointerdown", onLeafPointerDown, true);
    leaf.addEventListener("contextmenu", onContextMenu);
    leaf.addEventListener("pointerdown", onLeafFocusClick);
  }

  function ensureSlot(id: string): HTMLElement {
    const existing = slots.get(id);
    if (existing) return existing;
    const leaf = document.createElement("section");
    leaf.className = "tile-leaf subwindow-slot";
    leaf.dataset.tile = id;
    leaf.tabIndex = 0;
    leaf.setAttribute("aria-label", labels[id] ?? id);
    const title = document.createElement("div");
    title.className = "tile-title";
    const label = document.createElement("span");
    label.className = "tile-title-label";
    label.textContent = labels[id] ?? id;
    const controls = document.createElement("span");
    controls.className = "tile-controls";
    controlsContainers.set(id, controls);
    refreshControls(id);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tile-close";
    close.textContent = "×";
    close.setAttribute("aria-label", `Close ${labels[id] ?? id}`);
    /* stopPropagation: the leaf's own pointerdown (drag-to-dock) listener is
     * capture-phase, so a plain click here would still start a drag. */
    close.addEventListener("pointerdown", (event) => event.stopPropagation());
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose?.(id);
    });
    title.appendChild(label);
    title.appendChild(controls);
    title.appendChild(close);
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

  /*
   * neo-angband#241 follow-up: a subwindow panel used to keep drawing over a
   * full-screen modal (the Options Menu, a shop, ...) because visibility here
   * was driven purely by BSP-tree membership, with no notion that something
   * else currently owns the whole screen. `lastVisibleIds` is the tiling
   * answer; `modalActive` (set via setModalActive, driven by main.ts's
   * modalDepth) overrides it to hide every non-main leaf without losing track
   * of what should reappear once the modal closes.
   */
  let modalActive = false;
  let lastVisibleIds = new Set<string>([MAIN_TILE_ID]);

  function applyLeafVisibility(): void {
    for (const [id, leaf] of slots) {
      if (id === MAIN_TILE_ID) continue;
      leaf.hidden = modalActive || !lastVisibleIds.has(id);
    }
  }

  function paint(tree: LayoutNode): void {
    currentTree = tree;
    const layout = computeLayout(tree, hostSize(host));
    lastVisibleIds = new Set(layout.tiles.map((tile) => tile.id));
    for (const tile of layout.tiles) {
      const leaf = tile.id === MAIN_TILE_ID ? mainSlot : ensureSlot(tile.id);
      setRect(leaf, tile.rect);
      if (!leaf.isConnected) host.appendChild(leaf);
    }
    applyLeafVisibility();
    clearGutters();
    for (const splitter of layout.splitters) {
      const gutter = document.createElement("div");
      gutter.className = "tile-gutter";
      gutter.dataset.axis = splitter.axis;
      gutter.dataset.path = splitter.path.join(".");
      gutter.setAttribute("role", "separator");
      gutter.style.cursor = splitter.axis === "v" ? "col-resize" : "row-resize";
      gutter.hidden = modalActive;
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

  /*
   * neo-angband#241: `focusin` bubbles (unlike `focus`), so one delegated
   * listener on the host tracks which panel - if any - currently holds DOM
   * focus. Every focus change fires a `focusin` somewhere, including one that
   * lands outside any leaf, so there is no matching `focusout` case to handle
   * separately.
   */
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    const leaf = target instanceof Element ? target.closest(".tile-leaf") : null;
    const id = leaf instanceof HTMLElement ? leaf.dataset.tile : undefined;
    focusedId = id && id !== MAIN_TILE_ID ? id : null;
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onResize);
  host.addEventListener("focusin", onFocusIn);

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
    addControl(id, key, control) {
      controlsFor(id).set(key, control);
      refreshControls(id);
      return () => {
        controlsFor(id).delete(key);
        refreshControls(id);
      };
    },
    focusedId() {
      return focusedId;
    },
    setModalActive(active) {
      modalActive = active;
      applyLeafVisibility();
      for (const gutter of gutters) gutter.hidden = modalActive;
    },
    destroy() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onResize);
      host.removeEventListener("focusin", onFocusIn);
      mainSlot.removeEventListener("pointerdown", onMainPointerDown);
      for (const leaf of slots.values()) {
        if (leaf === mainSlot) continue;
        leaf.removeEventListener("pointerdown", onLeafPointerDown, true);
        leaf.removeEventListener("contextmenu", onContextMenu);
        leaf.removeEventListener("pointerdown", onLeafFocusClick);
      }
      clearGutters();
      preview.remove();
    },
  };
}
