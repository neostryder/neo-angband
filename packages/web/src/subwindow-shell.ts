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
  allDropZones,
  applyDrop,
  computeLayout,
  dropZoneAt,
  ratioFromPointer,
  resizeSplit,
  type DropZone,
  type LayoutNode,
  type Rect,
} from "./subwindow-layout";
import { addControlDomOwner } from "./input-door";

/** One mod-owned chrome control (neo-angband#241), rendered between the title label and the close button. */
export interface SubwindowControlSpec {
  readonly glyph: string;
  readonly title?: string;
  readonly onActivate: () => void;
}

/** A core selector in the same title-bar area as registered button controls. */
export interface SubwindowSelectSpec {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly { value: string; label: string }[];
  readonly onChange: (value: string) => void;
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
  setSelect(id: string, spec: SubwindowSelectSpec): void;
  /** The id of the panel that currently holds DOM focus, or null. */
  focusedId(): string | null;
  /**
   * Disable every splitter drag handle while a full-screen modal owns the
   * terminal - the Options Menu, a shop, the target loop, the "-more-"
   * pager, and anything else main.ts's modalDepth already tracks. Subwindow
   * panels are NOT hidden by this any more (neostryder/neo-angband#261):
   * a modal's own content renders through the main tile's own rect, which
   * this leaves untouched, so the other panels can safely keep showing
   * their last-painted content for the modal's whole duration.
   */
  setModalActive(active: boolean): void;
  /**
   * Whether a game is actually being played right now. False - the default,
   * matching the title screen and every pre-play screen (Open, Update,
   * Profile, character creation) - gives the main view the WHOLE host rect
   * and hides every other panel and splitter, since none of them have
   * anything to show before a game exists (neostryder/neo-angband#260).
   * True (set the moment main.ts's gameScreenLive does) restores the normal
   * tiled layout.
   */
  setGameLive(live: boolean): void;
  destroy(): void;
}

export interface SubwindowShellOptions {
  host: HTMLElement;
  mainSlot: HTMLElement;
  labels: Readonly<Record<string, string>>;
  onTreeChange: (tree: LayoutNode) => void;
  /** A panel's own close [x] was clicked (neo-angband#246); never fired for the main tile. */
  onClose?: (id: string) => void;
  /**
   * A mouse wheel or trackpad swipe over a tiled panel's body (neo-angband#258);
   * never fired for the main tile, which has its own zoom/pan handling. Positive
   * `deltaRows` scrolls toward newer/later content, negative toward older/earlier.
   */
  onScroll?: (id: string, deltaRows: number) => void;
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
  const { host, mainSlot, labels, onTreeChange, onClose, onScroll } = opts;
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
  const panelSelects = new Map<string, SubwindowSelectSpec>();
  const controlsContainers = new Map<string, HTMLElement>();
  let focusedId: string | null = null;
  const removeKeyboardOwner = addControlDomOwner({
    owns: (event) => event.target instanceof Element && host.contains(event.target)
      && event.target.matches(".tile-select"),
    escape: () => false,
  });

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

  function updateSelect(select: HTMLSelectElement, spec: SubwindowSelectSpec): void {
    select.title = spec.label;
    select.setAttribute("aria-label", spec.label);
    select.replaceChildren();
    for (const choice of spec.choices) {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      select.appendChild(option);
    }
    select.value = spec.value;
  }

  /** Re-render one panel's controls container from its current registered set. */
  function refreshControls(id: string): void {
    const container = controlsContainers.get(id);
    if (!container) return;
    container.replaceChildren();
    const spec = panelSelects.get(id);
    if (spec) {
      const select = document.createElement("select");
      select.className = "tile-select";
      updateSelect(select, spec);
      select.addEventListener("pointerdown", (event) => event.stopPropagation());
      select.addEventListener("change", () => panelSelects.get(id)?.onChange(select.value));
      container.appendChild(select);
    }
    for (const spec of controlsFor(id).values()) renderControl(container, spec);
  }

  let currentTree: LayoutNode = { kind: "leaf", id: MAIN_TILE_ID };
  const gutters: HTMLElement[] = [];
  const preview = document.createElement("div");
  preview.className = "tile-drop-preview";
  preview.hidden = true;
  host.appendChild(preview);

  /*
   * neo-angband#249: every reachable zone on every candidate panel, shown for
   * the whole span of a drag rather than only the one currently under the
   * pointer (which stays the separate `preview` div above, layered on top so
   * the active target still stands out). Rebuilt once when a drag starts (and
   * again on a resize mid-drag); tiles don't otherwise move during a plain
   * panel drag, so there's no need to recompute this on every pointer move.
   */
  const guides: HTMLElement[] = [];

  function clearGuides(): void {
    for (const guide of guides) guide.remove();
    guides.length = 0;
  }

  function renderGuides(zones: readonly DropZone[]): void {
    clearGuides();
    for (const zone of zones) {
      const guide = document.createElement("div");
      guide.className = "tile-drop-guide";
      guide.dataset.kind = zone.kind;
      setRect(guide, zone.preview);
      host.appendChild(guide);
      guides.push(guide);
    }
  }

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

  /*
   * neo-angband#258: a wheel/trackpad gesture over a tiled panel scrolls its
   * text content instead of the page. `deltaMode` 0 (the common pixel case)
   * yields large deltaY magnitudes, so this divides down to a small number of
   * rows per event; `deltaMode` 1 (line mode, some mice under Firefox) yields
   * deltaY values already close to 1-3, where the floor below still rounds up
   * to at least one row rather than getting lost to integer division.
   */
  const onLeafWheel = (event: WheelEvent): void => {
    if (!onScroll) return;
    const leaf = event.currentTarget;
    if (!(leaf instanceof HTMLElement)) return;
    const id = leaf.dataset.tile;
    if (!id || id === MAIN_TILE_ID) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    const rows = Math.sign(event.deltaY) * Math.max(1, Math.round(Math.abs(event.deltaY) / 40));
    onScroll(id, rows);
  };

  function bindLeafDrag(leaf: HTMLElement): void {
    leaf.addEventListener("pointerdown", onLeafPointerDown, true);
    leaf.addEventListener("contextmenu", onContextMenu);
    leaf.addEventListener("pointerdown", onLeafFocusClick);
    leaf.addEventListener("wheel", onLeafWheel, { passive: false });
  }

  function ensureSlot(id: string): HTMLElement {
    const existing = slots.get(id);
    if (existing) return existing;
    const leaf = document.createElement("section");
    leaf.className = "tile-leaf subwindow-slot";
    leaf.dataset.tile = id;
    leaf.tabIndex = 0;
    leaf.setAttribute("aria-label", labels[id] ?? id);
    /* neo-angband#249: the only hint anywhere that right-click-drag rearranges
     * a panel. Set on the whole leaf, not just the handle glyph below, so the
     * tooltip appears over the title bar and body alike; the close button and
     * any mod control below still carry their own, more specific title and
     * take precedence over this one where they overlap it. */
    leaf.title = "Right-click and drag to move this panel.";
    const title = document.createElement("div");
    title.className = "tile-title";
    const handle = document.createElement("span");
    handle.className = "tile-drag-handle";
    handle.textContent = "⠿";
    handle.setAttribute("aria-hidden", "true");
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
    close.title = `Close ${labels[id] ?? id}`;
    /* stopPropagation: the leaf's own pointerdown (drag-to-dock) listener is
     * capture-phase, so a plain click here would still start a drag. */
    close.addEventListener("pointerdown", (event) => event.stopPropagation());
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose?.(id);
    });
    title.appendChild(handle);
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
   * else currently owns the whole screen. That is fixed differently now
   * (#261): panels stay visible through a modal, so `modalActive` only
   * disables splitter drag handles below. `lastVisibleIds` (the tiling
   * answer) and `gameLive` (#260 - false before a game exists) are what drive
   * `applyLeafVisibility` instead.
   */
  let modalActive = false;
  let gameLive = false;
  let lastVisibleIds = new Set<string>([MAIN_TILE_ID]);

  function applyLeafVisibility(): void {
    for (const [id, leaf] of slots) {
      if (id === MAIN_TILE_ID) continue;
      leaf.hidden = !gameLive || !lastVisibleIds.has(id);
    }
  }

  function paint(tree: LayoutNode): void {
    currentTree = tree;
    if (!gameLive) {
      // #260: no game exists yet (the title screen, Open/Update/Profile,
      // character creation) - the main view takes the WHOLE host rect
      // regardless of the persisted tiling tree, since no other panel has
      // anything relevant to show.
      lastVisibleIds = new Set([MAIN_TILE_ID]);
      setRect(mainSlot, hostSize(host));
      if (!mainSlot.isConnected) host.appendChild(mainSlot);
      applyLeafVisibility();
      clearGutters();
      return;
    }
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
    if (event.target instanceof Element && event.target.closest(".tile-controls, .tile-close")) return;
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
      const { tiles } = computeLayout(currentTree, hostSize(host));
      renderGuides(allDropZones(tiles, drag.id));
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
    clearGuides();
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
    /* A window resize mid-drag moves every tile rect; the drag's own guides
     * (rendered once at drag-start, not recomputed per pointer move) would
     * otherwise go stale and point at the pre-resize geometry. */
    if (drag?.active) {
      const { tiles } = computeLayout(currentTree, hostSize(host));
      renderGuides(allDropZones(tiles, drag.id));
    }
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
    setSelect(id, spec) {
      panelSelects.set(id, spec);
      const select = controlsContainers.get(id)?.querySelector<HTMLSelectElement>(".tile-select");
      if (select) updateSelect(select, spec);
      else refreshControls(id);
    },
    focusedId() {
      return focusedId;
    },
    setModalActive(active) {
      modalActive = active;
      for (const gutter of gutters) gutter.hidden = modalActive;
    },
    setGameLive(live) {
      if (gameLive === live) return;
      gameLive = live;
      paint(currentTree);
    },
    destroy() {
      removeKeyboardOwner();
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
        leaf.removeEventListener("wheel", onLeafWheel);
      }
      clearGutters();
      clearGuides();
      preview.remove();
    },
  };
}
