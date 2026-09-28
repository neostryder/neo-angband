/**
 * DOM host for the BSP tiling tree: absolute tiles, tab strips, splitter
 * drags, and right-click docking. The algorithm is in subwindow-layout.ts;
 * this file only applies rectangles and pointer events.
 *
 * Every panel keeps its own slot and canvas. A tab group shows its active
 * panel's slot, with the group's tab strip in that slot's title bar, and
 * hides the slots of its other panels.
 *
 * Left-click stays reserved for game input. The main view is not a docking
 * source - its right-click already opens the command wheel.
 */

import {
  DROP_ZONE_LABELS,
  MAIN_TILE_ID,
  allDropZones,
  applyDrop,
  computeLayout,
  containsLeaf,
  dropZoneAt,
  fitForComfort,
  leafIds,
  insertAtEdge,
  restoreDockPlace,
  ratioFromPointer,
  resizeSplit,
  selectTab,
  unsizeSplit,
  type ComfortMerge,
  type DropZone,
  type LayoutNode,
  type Rect,
  type FloatRect,
  type RememberedPlace,
} from "./subwindow-layout";
import { addControlDomOwner, blurTiledPanelFocus, setTiledPanelInputBlocked } from "./input-door";
import { t } from "@rpgm-tools/neo-angband-core";

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
  apply(tree: LayoutNode, floats?: readonly FloatRect[], places?: Readonly<Record<string, RememberedPlace>>): void;
  floatingIds(): readonly string[];
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
  /** Filter tiled game content while keeping its host controls legible. */
  setVisualFilter(filter: string | null): void;
  /**
   * Turn individual window-manager features on or off (#287). Turning a
   * feature off never changes the saved arrangement: tab groups that already
   * exist keep working with tabs off, and no new ones can be made by drag.
   */
  setFeatures(features: SubwindowFeatures): void;
  /**
   * Ask for a height, in CSS pixels, that fits a panel's content (#287), or
   * pass null to withdraw the request. The request moves a stacked divider
   * next to the panel until the player drags that divider.
   */
  setFitHeight(id: string, height: number | null): void;
  setPanelLabel(id: string, label: string, tab?: string): void;
  setPanelMinSize(id: string, size: Readonly<{ width: number; height: number }> | null): void;
  destroy(): void;
}

export interface SubwindowFeatures {
  /** Offer the Tab drop target. */
  readonly tabs: boolean;
  /** Fold cramped groups into tabs in a small window (fitForComfort). */
  readonly fitSmallWindows: boolean;
  /** Keep dividers from being dragged. */
  readonly lockDividers: boolean;
  /** Show the dungeon view's grip, which drags it to another place. */
  readonly moveDungeonView: boolean;
  /** Size panels that ask for a content height to that height. */
  readonly fitToContent: boolean;
  readonly floatingWindows: boolean;
}

export interface SubwindowShellOptions {
  host: HTMLElement;
  mainSlot: HTMLElement;
  labels: Readonly<Record<string, string>>;
  /** Short names for tab strips; a panel without one uses its label. */
  tabLabels?: Readonly<Record<string, string>>;
  onTreeChange: (tree: LayoutNode) => void;
  onFloat?: (id: string, rect: FloatRect) => void;
  onDockFloat?: (id: string, zone?: DropZone) => void;
  onFloatsChange?: (floats: FloatRect[]) => void;
  dockFallback?: (tree: LayoutNode, id: string) => LayoutNode;
  onViewChange?: () => void;
  /** A panel's own close [x] was clicked (neo-angband#246); never fired for the main tile. */
  onClose?: (id: string) => void;
  /**
   * A mouse wheel or trackpad swipe over a tiled panel's body (neo-angband#258);
   * never fired for the main tile, which has its own zoom/pan handling. Positive
   * `deltaRows` scrolls toward newer/later content, negative toward older/earlier.
   */
  onScroll?: (id: string, deltaRows: number) => void;
  /**
   * The small-viewport pass (neo-angband#275, #287; see subwindow-layout.ts's
   * `fitForComfort`) merged one or more groups into others as tabs because
   * the real viewport is too small to give every group a legible size. Fired
   * only when the set of merges actually changes from the previous paint -
   * never on every resize tick a viewport settle produces, and never when
   * nothing is merged.
   */
  onMerged?: (merges: readonly ComfortMerge[]) => void;
}

const DRAG_THRESHOLD = 6;

/** The custom property index.html applies as a filter to each child of a panel body. */
export const SUBWINDOW_CONTENT_FILTER = "--tile-content-filter";

/**
 * Leave the close button and mod controls outside the filtered content.
 *
 * The body is filtered through its children rather than itself. A panel's
 * terminal canvas is position: fixed in viewport coordinates, and a filter on
 * an ancestor becomes the containing block for fixed descendants, which moves
 * the canvas by the body's own offset and off the panel.
 */
export function filterSubwindowContent(leaf: HTMLElement, filter: string | null): void {
  for (const selector of [".tile-drag-handle", ".tile-title-label", ".tile-tabs"]) {
    const content = leaf.querySelector<HTMLElement>(selector);
    if (content) content.style.filter = filter ?? "";
  }
  const body = leaf.querySelector<HTMLElement>(".tile-body");
  if (!body) return;
  if (filter) body.style.setProperty(SUBWINDOW_CONTENT_FILTER, filter);
  else body.style.removeProperty(SUBWINDOW_CONTENT_FILTER);
}

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
  const { host, mainSlot, onTreeChange, onClose, onScroll, onMerged } = opts;
  const labels = { ...opts.labels };
  const tabLabels = { ...opts.tabLabels };
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
    blurTiledPanelFocus();
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== mainSlot && active.closest(".tile-leaf")) active.blur();
    focusedId = null;
    opts.onViewChange?.();
  };
  mainSlot.addEventListener("pointerdown", onMainPointerDown);

  /* #287: the dungeon view has no title bar, and a right-click on it already
   * opens the grid's context menu or the command wheel, so it moves by a grip
   * of its own. Either button drags from the grip, since the grip is never
   * game input. */
  const mainGrip = document.createElement("button");
  mainGrip.type = "button";
  mainGrip.className = "tile-main-grip";
  mainGrip.textContent = "=";
  mainGrip.title = "Drag here to move the dungeon view. Drop it on a panel edge to dock beside it, or on Swap to trade places.";
  mainGrip.setAttribute("aria-label", "Move the dungeon view");
  mainGrip.hidden = true;
  mainSlot.appendChild(mainGrip);
  const onGripContextMenu = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  mainGrip.addEventListener("contextmenu", onGripContextMenu);

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
  let visualFilter: string | null = null;

  function filterSlot(leaf: HTMLElement): void {
    filterSubwindowContent(leaf, visualFilter);
  }
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
  let currentFloats: FloatRect[] = [];
  let currentPlaces: Readonly<Record<string, RememberedPlace>> = {};
  /* The tree actually on screen: `currentTree` after the small-viewport pass.
   * Drop zones, guides and dividers are measured against this one, because
   * it is the geometry the player sees. */
  let visibleTree: LayoutNode = currentTree;
  /* Tabs the player picked, most recent first. A merged group exists only on
   * screen, so its active tab cannot live in the saved tree; this list keeps
   * a choice made inside one across repaints. */
  let preferredTabs: string[] = [];
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
      guide.textContent = zoneLabel(zone);
      setRect(guide, zone.preview);
      host.appendChild(guide);
      guides.push(guide);
    }
  }

  let resize: { path: readonly number[]; pointerId: number } | null = null;
  /* Dividers follow the saved tree's paths, which differ from the on-screen
   * tree while groups are merged for space, so they rest until the viewport
   * has room again. */
  let dividersLocked = false;
  let features: SubwindowFeatures = {
    tabs: true,
    fitSmallWindows: true,
    lockDividers: false,
    moveDungeonView: true,
    fitToContent: true,
    floatingWindows: true,
  };
  const fitHeights = new Map<string, number>();
  const minSizes = new Map<string, Readonly<{ width: number; height: number }>>();
  const floatMinSizes = new Map<string, Readonly<{ width: number; height: number }>>();
  const layoutOf = (layoutTree: LayoutNode, viewport: Rect) =>
    computeLayout(layoutTree, viewport, { minSizes, ...(features.fitToContent ? { fit: fitHeights } : {}) });
  let drag: {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null = null;
  let floatDrag: { id: string; pointerId: number; startX: number; startY: number;
    original: FloatRect; mode: "move" | "resize"; moved: boolean } | null = null;

  function floatPixels(entry: FloatRect): Rect {
    const view = hostSize(host);
    const min = floatMinSizes.get(entry.id);
    const w = Math.min(view.w, Math.max(min?.width ?? 96, entry.width * view.w));
    const h = Math.min(view.h, Math.max(min?.height ?? 96, entry.height * view.h));
    return { x: Math.min(Math.max(0, entry.x * view.w), Math.max(0, view.w - w)),
      y: Math.min(Math.max(0, entry.y * view.h), Math.max(0, view.h - h)), w, h };
  }

  function fractionRect(id: string, rect: Rect): FloatRect {
    const view = hostSize(host);
    return { id, x: rect.x / view.w, y: rect.y / view.h,
      width: rect.w / view.w, height: rect.h / view.h };
  }

  function raiseFloat(id: string): void {
    const index = currentFloats.findIndex((entry) => entry.id === id);
    if (index < 0 || index === currentFloats.length - 1) return;
    currentFloats.push(currentFloats.splice(index, 1)[0]!);
    opts.onFloatsChange?.([...currentFloats]);
    paint(currentTree);
  }

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
  function selectPanelTab(id: string): void {
    preferredTabs = [id, ...preferredTabs.filter((entry) => entry !== id)].slice(0, 16);
    const next = selectTab(currentTree, id);
    const changed = next !== currentTree;
    paint(next);
    if (changed) onTreeChange(next);
  }

  function renderTabs(leaf: HTMLElement, tabs: readonly string[] | undefined, active: string): void {
    const strip = leaf.querySelector<HTMLElement>(".tile-tabs");
    const label = leaf.querySelector<HTMLElement>(".tile-title-label");
    if (!strip || !label) return;
    if (!tabs || tabs.length < 2) {
      strip.hidden = true;
      strip.replaceChildren();
      label.hidden = false;
      return;
    }
    label.hidden = true;
    strip.hidden = false;
    strip.replaceChildren();
    for (const tab of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile-tab";
      button.dataset.tab = tab;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", tab === active ? "true" : "false");
      button.textContent = tabLabels?.[tab] ?? labels[tab] ?? tab;
      button.title = labels[tab] ?? tab;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        selectPanelTab(tab);
      });
      strip.appendChild(button);
    }
  }

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
    leaf.addEventListener("pointerdown", () => {
      const id = leaf.dataset.tile;
      if (id && currentFloats.some((entry) => entry.id === id)) raiseFloat(id);
    }, true);
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
    leaf.title = "Right-click and drag to move this panel. Drop it on the Tab target to add it as a tab.";
    const title = document.createElement("div");
    title.className = "tile-title";
    const handle = document.createElement("span");
    handle.className = "tile-drag-handle";
    handle.textContent = "=";
    handle.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "tile-title-label";
    label.textContent = labels[id] ?? id;
    const tabs = document.createElement("span");
    tabs.className = "tile-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.hidden = true;
    const controls = document.createElement("span");
    controls.className = "tile-controls";
    controlsContainers.set(id, controls);
    refreshControls(id);
    const float = document.createElement("button");
    float.type = "button";
    float.className = "tile-float-action";
    float.textContent = t("subwindows.float", "Float");
    float.addEventListener("pointerdown", (event) => event.stopPropagation());
    float.addEventListener("click", (event) => {
      event.stopPropagation();
      const saved = currentPlaces[id]?.float;
      const rect = saved ? { id, ...saved } : { id, x: 0.31, y: 0.22, width: 0.38, height: 0.42 };
      opts.onFloat?.(id, rect);
    });
    const dock = document.createElement("button");
    dock.type = "button";
    dock.className = "tile-dock-action";
    dock.textContent = t("subwindows.dock", "Dock");
    dock.addEventListener("pointerdown", (event) => event.stopPropagation());
    dock.addEventListener("click", (event) => { event.stopPropagation(); opts.onDockFloat?.(id); });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tile-close";
    close.textContent = "x";
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
    title.appendChild(tabs);
    title.appendChild(controls);
    title.appendChild(float);
    title.appendChild(dock);
    title.appendChild(close);
    title.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !features.floatingWindows || !currentFloats.some((entry) => entry.id === id) ||
        event.target instanceof Element && event.target.closest("button, select")) return;
      const entry = currentFloats.find((item) => item.id === id)!;
      raiseFloat(id);
      floatDrag = { id, pointerId: event.pointerId, startX: event.clientX,
        startY: event.clientY, original: entry, mode: "move", moved: false };
      event.preventDefault();
      leaf.setPointerCapture(event.pointerId);
    });
    const body = document.createElement("div");
    body.className = "tile-body";
    const canvas = document.createElement("canvas");
    canvas.id = `subwindow-${id}`;
    body.appendChild(canvas);
    leaf.appendChild(title);
    leaf.appendChild(body);
    const grip = document.createElement("div");
    grip.className = "tile-float-resize";
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-label", t("subwindows.resizeFloat", "Resize floating window"));
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const entry = currentFloats.find((item) => item.id === id);
      if (!entry) return;
      raiseFloat(id);
      floatDrag = { id, pointerId: event.pointerId, startX: event.clientX,
        startY: event.clientY, original: entry, mode: "resize", moved: false };
      event.preventDefault();
      event.stopPropagation();
      grip.setPointerCapture(event.pointerId);
    });
    leaf.appendChild(grip);
    filterSlot(leaf);
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
  /* neo-angband#275: the merges as of the last paint, so onMerged fires on a
   * real change only - not on every resize tick a viewport settle produces
   * (main.ts's ResizeObserver-driven `resize` event can fire several times
   * while a window is being dragged). */
  let lastMergeKey = "";

  function mergeKey(merges: readonly ComfortMerge[]): string {
    return merges.map((merge) => `${merge.id}>${merge.into}`).sort().join("|");
  }

  function applyLeafVisibility(): void {
    for (const [id, leaf] of slots) {
      if (id === MAIN_TILE_ID) continue;
      leaf.hidden = !gameLive || !lastVisibleIds.has(id);
    }
  }

  function paint(tree: LayoutNode): void {
    currentTree = tree;
    let displayTree = tree;
    if (!features.floatingWindows) {
      for (const entry of currentFloats) {
        const fallback = () => opts.dockFallback?.(displayTree, entry.id) ??
          insertAtEdge(displayTree, entry.id, MAIN_TILE_ID, "right");
        displayTree = currentPlaces[entry.id]?.dock
          ? restoreDockPlace(displayTree, entry.id, currentPlaces[entry.id]!.dock!) ?? fallback()
          : fallback();
      }
    }
    visibleTree = displayTree;
    if (!gameLive) {
      // #260: no game exists yet (the title screen, Open/Update/Profile,
      // character creation) - the main view takes the WHOLE host rect
      // regardless of the persisted tiling tree, since no other panel has
      // anything relevant to show.
      lastVisibleIds = new Set([MAIN_TILE_ID]);
      mainGrip.hidden = true;
      setRect(mainSlot, hostSize(host));
      if (!mainSlot.isConnected) host.appendChild(mainSlot);
      applyLeafVisibility();
      clearGutters();
      opts.onViewChange?.();
      return;
    }
    const viewport = hostSize(host);
    /* #275, #287: decide which tree to actually render. The saved `tree` (and
     * `currentTree` above) is never changed by this, so growing the window
     * back out separates merged groups again with nothing to undo. */
    const fitted = features.fitSmallWindows
      ? fitForComfort(displayTree, viewport, { prefer: preferredTabs })
      : { tree: displayTree, merged: [] };
    visibleTree = fitted.tree;
    dividersLocked = features.lockDividers || fitted.merged.length > 0 || !features.floatingWindows && currentFloats.length > 0;
    const key = mergeKey(fitted.merged);
    if (key !== lastMergeKey) {
      lastMergeKey = key;
      if (fitted.merged.length > 0) onMerged?.(fitted.merged);
    }
    const layout = layoutOf(visibleTree, viewport);
    lastVisibleIds = new Set(layout.tiles.map((tile) => tile.id));
    for (const id of leafIds(tree)) {
      if (id.includes(":")) ensureSlot(id);
    }
    for (const entry of currentFloats) ensureSlot(entry.id);
    mainGrip.hidden = !features.moveDungeonView || layout.tiles.length < 2;
    for (const tile of layout.tiles) {
      const leaf = tile.id === MAIN_TILE_ID ? mainSlot : ensureSlot(tile.id);
      setRect(leaf, tile.rect);
      if (!leaf.isConnected) host.appendChild(leaf);
      if (tile.id !== MAIN_TILE_ID) renderTabs(leaf, tile.tabs, tile.id);
    }
    if (features.floatingWindows) {
      for (const [index, entry] of currentFloats.entries()) {
        const leaf = ensureSlot(entry.id);
        renderTabs(leaf, undefined, entry.id);
        setRect(leaf, floatPixels(entry));
        leaf.style.zIndex = String(10 + index);
        leaf.classList.add("tile-floating");
        leaf.querySelector<HTMLElement>(".tile-float-action")!.hidden = true;
        leaf.querySelector<HTMLElement>(".tile-dock-action")!.hidden = false;
        if (!leaf.isConnected) host.appendChild(leaf);
        lastVisibleIds.add(entry.id);
      }
    }
    for (const [id, leaf] of slots) {
      if (id === MAIN_TILE_ID || features.floatingWindows && currentFloats.some((entry) => entry.id === id)) continue;
      leaf.style.zIndex = "";
      leaf.classList.remove("tile-floating");
      const float = leaf.querySelector<HTMLElement>(".tile-float-action");
      const dock = leaf.querySelector<HTMLElement>(".tile-dock-action");
      if (float) float.hidden = !features.floatingWindows;
      if (dock) dock.hidden = true;
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
      if (dividersLocked) {
        gutter.classList.add("tile-gutter-locked");
        gutter.style.cursor = "";
      }
      setRect(gutter, splitter.rect);
      gutter.addEventListener("pointerdown", onGutterPointerDown);
      gutter.addEventListener("dblclick", onGutterDoubleClick);
      host.appendChild(gutter);
      gutters.push(gutter);
    }
    opts.onViewChange?.();
  }

  function zoneFromEvent(event: PointerEvent, dragging: string): DropZone | null {
    const point = pointerInHost(host, event);
    const { tiles } = layoutOf(visibleTree, hostSize(host));
    return dropZoneAt(tiles, point.x, point.y, { dragging, tabs: features.tabs });
  }

  function zoneLabel(zone: DropZone): string {
    return zone.kind === "dock" ? "" : DROP_ZONE_LABELS[zone.kind];
  }

  function showPreview(zone: DropZone | null): void {
    if (!zone) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    preview.dataset.kind = zone.kind;
    preview.textContent = zoneLabel(zone);
    setRect(preview, zone.preview);
  }

  const onGutterPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || dividersLocked) return;
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

  /* #287: a double-click hands a dragged divider back to the panel's
   * fit-to-content height. A divider with no fitted panel beside it is
   * unaffected apart from forgetting that it was dragged. */
  const onGutterDoubleClick = (event: MouseEvent): void => {
    if (dividersLocked) return;
    const gutter = event.currentTarget;
    if (!(gutter instanceof HTMLElement)) return;
    const path = (gutter.dataset.path ?? "")
      .split(".")
      .filter((part) => part.length > 0)
      .map((part) => Number(part));
    const next = unsizeSplit(currentTree, path);
    if (next === currentTree) return;
    paint(next);
    onTreeChange(next);
  };

  const onGripPointerDown = (event: PointerEvent): void => {
    if ((event.button !== 0 && event.button !== 2) || !features.moveDungeonView || !gameLive) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      id: MAIN_TILE_ID,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    mainGrip.setPointerCapture(event.pointerId);
  };
  mainGrip.addEventListener("pointerdown", onGripPointerDown);

  const onLeafPointerDown = (event: PointerEvent): void => {
    if (event.button !== 2) return;
    const source = event.currentTarget;
    if (source instanceof HTMLElement && currentFloats.some((entry) => entry.id === source.dataset.tile)) return;
    if (event.target instanceof Element && event.target.closest(".tile-controls, .tile-close, .tile-float-action, .tile-dock-action, .tile-float-resize")) return;
    const leaf = event.currentTarget;
    if (!(leaf instanceof HTMLElement)) return;
    /* A right-drag that starts on a tab moves that tab's panel, not the one
     * the group is showing. */
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>(".tile-tab") : null;
    const id = tab?.dataset.tab ?? leaf.dataset.tile;
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
    if (floatDrag && event.pointerId === floatDrag.pointerId) {
      const active = floatDrag;
      const view = hostSize(host);
      const start = floatPixels(active.original);
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      active.moved ||= dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD;
      const min = floatMinSizes.get(active.id);
      const rect = active.mode === "move"
        ? { ...start, x: Math.min(Math.max(0, start.x + dx), Math.max(0, view.w - start.w)),
          y: Math.min(Math.max(0, start.y + dy), Math.max(0, view.h - start.h)) }
        : { ...start, w: Math.min(view.w - start.x, Math.max(min?.width ?? 96, start.w + dx)),
          h: Math.min(view.h - start.y, Math.max(min?.height ?? 96, start.h + dy)) };
      currentFloats = currentFloats.map((entry) => entry.id === active.id ? fractionRect(active.id, rect) : entry);
      paint(currentTree);
      if (active.mode === "move" && active.moved) {
        const { tiles } = layoutOf(visibleTree, view);
        renderGuides(allDropZones(tiles, active.id, { tabs: features.tabs }));
        const point = pointerInHost(host, event);
        showPreview(dropZoneAt(tiles, point.x, point.y, { dragging: active.id, tabs: features.tabs }));
      }
      return;
    }
    if (resize && event.pointerId === resize.pointerId) {
      const { splitters } = layoutOf(currentTree, hostSize(host));
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
      const { tiles } = layoutOf(visibleTree, hostSize(host));
      renderGuides(allDropZones(tiles, drag.id, { tabs: features.tabs }));
    }
    if (drag.active) showPreview(zoneFromEvent(event, drag.id));
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (floatDrag && event.pointerId === floatDrag.pointerId) {
      const active = floatDrag;
      floatDrag = null;
      preview.hidden = true;
      clearGuides();
      const point = pointerInHost(host, event);
      const original = floatPixels(active.original);
      const leftOriginal = point.x < original.x || point.x > original.x + original.w ||
        point.y < original.y || point.y > original.y + original.h;
      const zone = active.mode === "move" && active.moved && leftOriginal
        ? zoneFromEvent(event, active.id) : null;
      if (zone) opts.onDockFloat?.(active.id, zone);
      else opts.onFloatsChange?.([...currentFloats]);
      return;
    }
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
    const zone = zoneFromEvent(event, incoming);
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
      const { tiles } = layoutOf(visibleTree, hostSize(host));
      renderGuides(allDropZones(tiles, drag.id, { tabs: features.tabs }));
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
    opts.onViewChange?.();
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onResize);
  document.addEventListener("focusin", onFocusIn);

  return {
    apply(tree, floats = [], places = {}) {
      currentFloats = floats.filter((entry) => entry.id !== MAIN_TILE_ID && !containsLeaf(tree, entry.id));
      currentPlaces = places;
      paint(tree);
    },
    floatingIds() { return currentFloats.map((entry) => entry.id); },
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
      setTiledPanelInputBlocked(active);
      for (const gutter of gutters) gutter.hidden = modalActive;
    },
    setGameLive(live) {
      if (gameLive === live) return;
      gameLive = live;
      paint(currentTree);
    },
    setFeatures(next) {
      features = { ...next };
      paint(currentTree);
    },
    setFitHeight(id, height) {
      const had = fitHeights.get(id);
      if (height === null || !Number.isFinite(height) || height <= 0) {
        if (had === undefined) return;
        fitHeights.delete(id);
      } else {
        const px = Math.round(height);
        if (had === px) return;
        fitHeights.set(id, px);
      }
      if (features.fitToContent) paint(currentTree);
    },
    setPanelLabel(id, label, tab) {
      if (labels[id] === label && tabLabels[id] === (tab ?? label)) return;
      labels[id] = label;
      tabLabels[id] = tab ?? label;
      const slot = slots.get(id);
      if (slot) {
        slot.setAttribute("aria-label", label);
        const title = slot.querySelector(".tile-title-label");
        if (title) title.textContent = label;
        const close = slot.querySelector(".tile-close");
        if (close) {
          close.setAttribute("aria-label", `Close ${label}`);
          close.setAttribute("title", `Close ${label}`);
        }
      }
      paint(currentTree);
    },
    setPanelMinSize(id, size) {
      const oldFloatMin = floatMinSizes.get(id);
      if (size) floatMinSizes.set(id, size);
      else floatMinSizes.delete(id);
      const normalized = size ? { width: Math.min(800, Math.max(96, size.width)), height: Math.min(600, Math.max(96, size.height)) } : null;
      const before = minSizes.get(id);
      if (before?.width === normalized?.width && before?.height === normalized?.height &&
        oldFloatMin?.width === size?.width && oldFloatMin?.height === size?.height) return;
      if (normalized) minSizes.set(id, normalized);
      else minSizes.delete(id);
      paint(currentTree);
    },
    setVisualFilter(filter) {
      visualFilter = filter;
      for (const [id, leaf] of slots) {
        if (id !== MAIN_TILE_ID) filterSlot(leaf);
      }
    },
    destroy() {
      removeKeyboardOwner();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("focusin", onFocusIn);
      mainSlot.removeEventListener("pointerdown", onMainPointerDown);
      mainGrip.removeEventListener("pointerdown", onGripPointerDown);
      mainGrip.removeEventListener("contextmenu", onGripContextMenu);
      mainGrip.remove();
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
