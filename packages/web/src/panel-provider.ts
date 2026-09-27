/** Host-owned tiled DOM panels. The saved tree carries identity, not mod code. */
import type { PanelKindSpec, PanelMount } from "./mod-plugin";
import { SUBWINDOW_LAYOUT_IDS } from "@rpgm-tools/neo-angband-mod-sdk";
import { t } from "@rpgm-tools/neo-angband-core";
import { addTiledPanelRoot } from "./input-door";
import { leafIds, removeLeaf, selectTab, type LayoutNode } from "./subwindow-layout";
import type { SubwindowShell } from "./subwindow-shell";

export interface RegisteredPanelKind {
  readonly id: string;
  readonly spec: PanelKindSpec;
}

const kinds = new Map<string, RegisteredPanelKind>();
let changed: (() => void) | undefined;

export function panelKinds(): readonly RegisteredPanelKind[] {
  return [...kinds.values()];
}

export function registerPanelKind(modId: string, spec: PanelKindSpec): () => void {
  if (!/^[a-z][a-z0-9-]*$/.test(modId) || !/^[a-z][a-z0-9-]*$/.test(spec.kind) || modId === "core") {
    throw new Error("panel kind requires lowercase mod and kind names");
  }
  if (!spec.label.trim() || typeof spec.mount !== "function" ||
    (spec.tab !== undefined && !spec.tab.trim()) ||
    (spec.minSize && (!Number.isFinite(spec.minSize.width) || !Number.isFinite(spec.minSize.height) || spec.minSize.width <= 0 || spec.minSize.height <= 0)) ||
    (spec.fitHeight !== undefined && (!Number.isFinite(spec.fitHeight) || spec.fitHeight <= 0))) {
    throw new Error("panel kind requires a label, mount function, and positive size hints");
  }
  const place = spec.preferredPlacement;
  if (place && (place.kind !== "dock" && place.kind !== "tab" ||
    place.target !== "main" && !(SUBWINDOW_LAYOUT_IDS as readonly string[]).includes(place.target) ||
    place.kind === "tab" && place.target === "main" ||
    (place.kind === "dock" && !["left", "right", "top", "bottom"].includes(place.edge)))) {
    throw new Error("preferred placement must target a native panel or main");
  }
  const id = `${modId}:${spec.kind}`;
  if (kinds.has(id)) throw new Error(`panel kind ${id} is already registered`);
  const entry = { id, spec };
  kinds.set(id, entry);
  changed?.();
  return () => {
    if (kinds.get(id) !== entry) return;
    kinds.delete(id);
    changed?.();
  };
}

interface Mounted {
  readonly container: HTMLElement;
  readonly removeInput: () => void;
  readonly listeners: Set<(state: PanelState) => void>;
  cleanup: (() => void) | undefined;
  state: PanelState;
}

type PanelState = Readonly<{ bounds: Readonly<{ width: number; height: number }>; active: boolean; focused: boolean }>;

export interface PanelProviderHost {
  readonly shell: SubwindowShell;
  tree(): LayoutNode;
  changeTree(tree: LayoutNode): void;
  forgetPanel?(id: string): void;
}

/** Bind once to the game shell; registrations may arrive before or after it. */
export function bindPanelProviders(host: PanelProviderHost): () => void {
  const mounted = new Map<string, Mounted>();
  const placeholders = new Map<string, HTMLElement>();
  const hinted = new Set<string>();
  let syncing = false;
  let again = false;

  function discard(id: string): void {
    const live = mounted.get(id);
    if (live) {
      mounted.delete(id);
      live.removeInput();
      live.cleanup?.();
      live.listeners.clear();
      live.container.remove();
      host.shell.setFitHeight(id, null);
    }
    host.shell.setPanelMinSize(id, null);
    hinted.delete(id);
    placeholders.get(id)?.remove();
    placeholders.delete(id);
  }

  function stateFor(id: string, body: HTMLElement, slot: HTMLElement): PanelState {
    return {
      bounds: { width: body.clientWidth, height: body.clientHeight },
      active: !slot.hidden,
      focused: host.shell.focusedId() === id && !slot.hidden,
    };
  }

  function syncOnce(): void {
    const tree = host.tree();
    const ids = new Set(leafIds(tree).filter((id) => id.includes(":")));
    for (const id of hinted) if (!ids.has(id) || !kinds.has(id)) {
      host.shell.setPanelMinSize(id, null);
      hinted.delete(id);
    }
    for (const id of mounted.keys()) if (!ids.has(id) || !kinds.has(id)) discard(id);
    for (const id of placeholders.keys()) if (!ids.has(id) || kinds.has(id)) discard(id);
    for (const id of ids) {
      const slot = host.shell.slot(id);
      const body = host.shell.bounds(id);
      if (!slot || !body) continue;
      const canvas = host.shell.canvas(id);
      if (canvas) canvas.hidden = true;
      const registered = kinds.get(id);
      if (!registered) {
        host.shell.setPanelMinSize(id, null);
        if (placeholders.has(id)) continue;
        const box = document.createElement("div");
        box.className = "tile-panel-placeholder";
        const message = document.createElement("p");
        message.textContent = t("subwindows.placeholder.missingMod", "This panel's mod, {mod}, is not loaded.", { mod: id.split(":")[0] ?? id });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = t("subwindows.placeholder.remove", "Remove");
        remove.addEventListener("click", () => {
          host.forgetPanel?.(id);
          host.changeTree(removeLeaf(host.tree(), id));
        });
        box.append(message, remove);
        body.appendChild(box);
        placeholders.set(id, box);
        continue;
      }
      host.shell.setPanelLabel(id, registered.spec.label, registered.spec.tab);
      if (registered.spec.minSize) {
        host.shell.setPanelMinSize(id, registered.spec.minSize);
        hinted.add(id);
      }
      if (slot.hidden && !mounted.has(id)) continue;
      let live = mounted.get(id);
      if (!live) {
        const container = document.createElement("div");
        container.className = "tile-provider-content";
        body.appendChild(container);
        const root = container.attachShadow({ mode: "closed" });
        const listeners = new Set<(state: PanelState) => void>();
        live = { container, removeInput: addTiledPanelRoot(root), listeners, state: stateFor(id, body, slot), cleanup: undefined };
        mounted.set(id, live);
        const record = live;
        const mount: PanelMount = {
          id,
          root,
          get bounds() { return record.state.bounds; },
          get active() { return record.state.active; },
          get focused() { return record.state.focused; },
          onStateChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          requestFocus() {
            const selected = selectTab(host.tree(), id);
            if (selected !== host.tree()) host.changeTree(selected);
            slot.focus();
          },
          requestClose() { host.changeTree(removeLeaf(host.tree(), id)); },
          setFitHeight(px) { host.shell.setFitHeight(id, px); },
        };
        try {
          record.cleanup = registered.spec.mount(mount) || undefined;
          if (registered.spec.fitHeight !== undefined) host.shell.setFitHeight(id, registered.spec.fitHeight);
        } catch (error) {
          discard(id);
          throw error;
        }
      }
      const next = stateFor(id, body, slot);
      const before = live.state;
      if (before.active !== next.active || before.focused !== next.focused ||
        before.bounds.width !== next.bounds.width || before.bounds.height !== next.bounds.height) {
        live.state = next;
        for (const listener of live.listeners) listener(next);
      }
    }
  }

  function sync(): void {
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      do { again = false; syncOnce(); } while (again);
    } finally {
      syncing = false;
    }
  }

  changed = sync;
  sync();
  return () => {
    if (changed === sync) changed = undefined;
    for (const id of [...mounted.keys(), ...placeholders.keys()]) discard(id);
    for (const id of hinted) host.shell.setPanelMinSize(id, null);
    hinted.clear();
  };
}

export function syncPanelProviders(): void {
  changed?.();
}

export function unregisterAllPanelKinds(): void {
  kinds.clear();
  changed?.();
}
