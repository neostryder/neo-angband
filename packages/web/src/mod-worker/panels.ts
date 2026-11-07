import { MOD_PERMISSION_TEXT } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModWorkerPanel, ModWorkerPanelNode, ModWorkerPanelPatch, WorkerJson } from "./protocol";
import { panelDescription, panelPatch } from "./panel-schema";
import { closeTopModPanel, createModUi, modPresentationSuspended as modPanelsSuspended, onModPanelSuspension, topModPanelId } from "../panel-runtime";
import { addControlDomOwner, inputEvents } from "../input-door";
import type { ModPanel } from "../mod-plugin";
import type { ModDisplay } from "../mod-plugin";
import type { WorkerTextLine, WorkerTextRegion } from "./protocol";
import { cloneWorkerJson } from "./clone";

interface MountedPanel {
  readonly root: HTMLDivElement;
  readonly title: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly emit: (panelId: string, action: string, value?: string | boolean) => void;
  readonly unsuspend: () => void;
  readonly close: () => void;
  readonly host?: ModPanel;
}

export interface ModWorkerPanelRenderer {
  apply(pluginId: string, operation: "mount" | "patch" | "unmount", payload: WorkerJson, patchId?: string, onAction?: (panelId: string, action: string, value?: string | boolean) => void, onDismiss?: () => void): WorkerJson;
  unmount(pluginId: string, panelId: string): void;
  teardown(pluginId: string): void;
}

/**
 * Render the API-2 panel grammar in the host DOM. The worker supplies neither
 * markup nor styles, and receives only a plain action name when a button is used.
 */
export function createModWorkerPanelRenderer(doc: Document = document): ModWorkerPanelRenderer {
  const panels = new Map<string, MountedPanel>();
  const key = (pluginId: string, panelId: string): string => `${pluginId}:${panelId}`;

  const mount = (pluginId: string, panel: ModWorkerPanel, emit: (panelId: string, action: string, value?: string | boolean) => void, onDismiss?: () => void): WorkerJson => {
    const panelKey = key(pluginId, panel.id);
    if ([...panels.keys()].filter((name) => name.startsWith(pluginId + ":")).length >= 8) throw new Error(MOD_PERMISSION_TEXT.quota);
    if (panels.has(panelKey)) throw new Error(`panel ${panel.id} is already mounted`);
    const root = doc.createElement("div");
    const title = doc.createElement("div");
    const body = doc.createElement("div");
    const host = panel.modal ? createModUi(pluginId, doc).openPanel({ id: panel.id, modal: true, ...(panel.title ? { label: panel.title } : {}) }) : undefined;
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", panel.title ?? `${pluginId} panel`);
    root.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:20;max-width:min(28rem,calc(100vw - 32px));background:#18181f;color:#d8d8dc;border:1px solid #404052;border-radius:6px;padding:12px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,0.35)"; // palette-exempt: host-owned DOM panel, matching crash-screen.ts
    title.style.cssText = "font-weight:600;margin-bottom:8px";
    body.style.cssText = "display:flex;flex-direction:column;gap:8px";
    root.append(title, body);
    (host?.root ?? doc.body ?? doc.documentElement).append(root);
    root.style.pointerEvents = "auto";
    if (host) root.style.cssText += ";inset:48px 16px 16px;max-width:none;overflow:auto";
    if (!host) {
      const dismiss = doc.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "Close";
      dismiss.addEventListener("click", () => {
        if (modPanelsSuspended()) return;
        close();
      });
      root.append(dismiss);
    }
    const unsuspend = onModPanelSuspension((suspended) => {
      root.style.visibility = suspended ? "hidden" : "";
      root.inert = suspended;
    });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      root.remove();
      host?.close();
      unsuspend();
      offOwner();
      inputEvents.removeEventListener("keydown", onKey, true);
      panels.delete(panelKey);
      onDismiss?.();
    };
    const active = () => !closed && root.isConnected && !root.hidden && !modPanelsSuspended() && (!host || (host.open && topModPanelId() === host.id));
    const offOwner = addControlDomOwner({
      owns: () => active() && root.contains(doc.activeElement),
      escape: (event) => {
        if (!active() || !root.contains(doc.activeElement) || event.repeat || event.isComposing) return false;
        close();
        return true;
      },
    });
    const onKey = (event: KeyboardEvent): void => {
      if (!active() || (!host && !root.contains(doc.activeElement))) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Escape") {
        if (event.repeat || event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        event.preventDefault(); event.stopImmediatePropagation();
        if (host) closeTopModPanel();
        close(); return;
      }
      const controls = [...root.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),a[href]")];
      if (["Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "2", "4", "6", "8"].includes(event.key)) {
        if (!controls.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const index = controls.indexOf((host?.root.activeElement ?? doc.activeElement) as HTMLElement);
        const step = ["ArrowUp", "ArrowLeft", "4", "8"].includes(event.key) || event.shiftKey ? -1 : 1;
        controls[(index + step + controls.length) % controls.length]!.focus();
      } else if (event.key === "Enter") {
        const control = host?.root.activeElement ?? doc.activeElement;
        if (control instanceof HTMLElement && control.matches("button,a[href],input[type=checkbox]")) {
          event.preventDefault(); event.stopImmediatePropagation(); control.click();
        }
      }
    };
    inputEvents.addEventListener("keydown", onKey, true);
    const mounted = { root, title, body, emit, unsuspend, close, ...(host ? { host } : {}) };
    panels.set(panelKey, mounted);
    draw(panel.id, mounted, panel);
    if (host) void host.closed.then(close);
    return { panelId: panel.id };
  };

  return {
    apply(pluginId, operation, payload, patchId, onAction, onDismiss): WorkerJson {
      if (operation === "mount") {
        const panel = panelDescription(payload);
        if (!panel) throw new Error("ui.mount needs a small declarative panel tree");
        return mount(pluginId, panel, onAction ?? (() => undefined), onDismiss);
      }
      if (operation === "unmount") {
        if (!patchId) throw new Error("ui.unmount needs a panel id");
        panels.get(key(pluginId, patchId))?.close();
        return null;
      }
      if (!patchId) throw new Error("ui.patch needs a panel id");
      const patch = panelPatch(payload);
      if (!patch) throw new Error("ui.patch needs a declarative panel patch");
      const mounted = panels.get(key(pluginId, patchId));
      if (!mounted) throw new Error(`panel ${patchId} is not mounted`);
      applyPatch(patchId, mounted, patch);
      return { panelId: patchId };
    },
    unmount(pluginId, panelId): void {
      panels.get(key(pluginId, panelId))?.close();
    },
    teardown(pluginId): void {
      for (const [panelKey, panel] of panels) {
        if (!panelKey.startsWith(`${pluginId}:`)) continue;
        panel.close();
      }
    },
  };
}

function draw(panelId: string, mounted: MountedPanel, panel: ModWorkerPanel): void {
  mounted.title.textContent = panel.title ?? "";
  mounted.title.hidden = panel.title === undefined;
  mounted.body.replaceChildren(renderNode(mounted.body.ownerDocument, panelId, panel.root, mounted.emit));
}

function applyPatch(panelId: string, mounted: MountedPanel, patch: ModWorkerPanelPatch): void {
  if (patch.title !== undefined) {
    mounted.title.textContent = patch.title ?? "";
    mounted.title.hidden = patch.title === null;
    mounted.root.setAttribute("aria-label", patch.title ?? "Worker panel");
  }
  if (patch.root !== undefined) mounted.body.replaceChildren(renderNode(mounted.body.ownerDocument, panelId, patch.root, mounted.emit));
  if (patch.visible === false && mounted.host) mounted.close();
  else if (patch.visible !== undefined) mounted.root.hidden = !patch.visible;
}

function renderNode(doc: Document, panelId: string, node: ModWorkerPanelNode, emit: (panelId: string, action: string, value?: string | boolean) => void): HTMLElement {
  if (node.type === "text") {
    const text = doc.createElement("div");
    text.textContent = node.text;
    return text;
  }
  if (node.type === "button") {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = node.label;
    button.disabled = node.disabled ?? false;
    button.style.cssText = "font:inherit;padding:6px 10px;background:#24242e;color:#d8d8dc;border:1px solid #56566a;border-radius:4px;cursor:pointer"; // palette-exempt: host-owned DOM panel button
    button.addEventListener("click", () => {
      if (!modPanelsSuspended() && !button.disabled) emit(panelId, node.action);
    });
    return button;
  }
  if (node.type === "input" || node.type === "checkbox") {
    const label = doc.createElement("label");
    label.textContent = node.label;
    const input = doc.createElement("input");
    input.type = node.type === "checkbox" ? "checkbox" : "text";
    input.disabled = node.disabled ?? false;
    if (node.type === "checkbox") input.checked = node.checked;
    else { input.value = node.value ?? ""; input.placeholder = node.placeholder ?? ""; }
    input.addEventListener(node.type === "checkbox" ? "change" : "input", () => {
      if (!modPanelsSuspended() && !input.disabled) emit(panelId, node.action, node.type === "checkbox" ? input.checked : input.value);
    });
    label.append(input);
    return label;
  }
  if (node.type === "download") {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = node.label;
    button.disabled = node.disabled ?? false;
    button.addEventListener("click", () => {
      if (modPanelsSuspended() || button.disabled) return;
      const url = URL.createObjectURL(new Blob([node.text], { type: "application/json" }));
      const anchor = doc.createElement("a");
      anchor.href = url;
      anchor.download = node.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
    return button;
  }
  const layout = doc.createElement("div");
  layout.style.cssText = `display:flex;${node.type === "row" ? "flex-direction:row;flex-wrap:wrap" : "flex-direction:column"};gap:8px`;
  layout.append(...node.children.map((child) => renderNode(doc, panelId, child, emit)));
  return layout;
}

type TextRegionName = "messages" | "sidebar" | "status";
const TEXT_COLORS = { normal: "#c0c0c0", muted: "#808080", warning: "#ffff00", danger: "#c00000", good: "#00ff00" } as const;

function textLines(value: unknown): readonly WorkerTextLine[] {
  const json = cloneWorkerJson(value);
  if (!Array.isArray(json) || json.length > 64) throw new Error("text output takes at most 64 lines");
  let length = 0;
  for (const line of json) {
    if (line === null || typeof line !== "object" || Array.isArray(line) ||
      Object.keys(line).some((key) => key !== "text" && key !== "style") || typeof line["text"] !== "string" ||
      line["text"].length > 512 || (line["style"] !== undefined && (typeof line["style"] !== "string" || !Object.hasOwn(TEXT_COLORS, line["style"])))) {
      throw new Error("a text line needs bounded text and a fixed style token");
    }
    length += line["text"].length;
  }
  if (length > 4096) throw new Error("text output exceeds 4096 characters");
  return json as unknown as readonly WorkerTextLine[];
}

/** Text stays below host dialogs and cannot take focus or receive input. */
export function createModWorkerTextRenderer(display: ModDisplay, held: (capability: string) => boolean, doc: Document = document) {
  type Entry = { root: HTMLDivElement; capability: string; name?: TextRegionName; rect?: WorkerTextRegion["rect"] };
  const entries = new Map<string, Entry>();
  let closed = false;
  const draw = (): void => {
    if (closed) return;
    const snapshot = display.snapshot();
    for (const entry of entries.values()) {
      const { root, rect } = entry;
      const named = entry.name ? snapshot.regions[entry.name] : undefined;
      const valid = !rect || (rect.col + rect.cols <= snapshot.grid.cols && rect.row + rect.rows <= snapshot.grid.rows);
      const pixels = named?.pixels ?? (rect && snapshot.surface ? {
        x: snapshot.surface.x + rect.col * snapshot.grid.cellWidth, y: snapshot.surface.y + rect.row * snapshot.grid.cellHeight,
        width: rect.cols * snapshot.grid.cellWidth, height: rect.rows * snapshot.grid.cellHeight,
      } : undefined);
      root.hidden = modPanelsSuspended() || snapshot.mode !== "play" || !valid || !pixels || !held(entry.capability);
      root.inert = true;
      if (!pixels) continue;
      root.style.left = `${pixels.x}px`;
      root.style.top = `${pixels.y}px`;
      root.style.width = `${pixels.width}px`;
      root.style.height = `${pixels.height}px`;
      root.style.fontSize = `${Math.max(1, snapshot.grid.cellHeight - 2)}px`;
      root.style.lineHeight = `${snapshot.grid.cellHeight}px`;
    }
  };
  const offSuspension = onModPanelSuspension(draw);
  const offFrame = display.onFrame?.(draw);
  const put = (id: string, lines: readonly WorkerTextLine[], capability: string, location: { name?: TextRegionName; rect?: WorkerTextRegion["rect"] }): void => {
    if (closed || modPanelsSuspended() || !held(capability)) throw new Error("this text region is suspended or revoked");
    if (!entries.has(id) && entries.size >= 8) throw new Error("a Worker may draw at most eight text regions");
    const body = doc.createDocumentFragment();
    for (const line of lines) {
      const row = doc.createElement("div");
      row.textContent = line.text;
      row.style.color = TEXT_COLORS[line.style ?? "normal"];
      body.append(row);
    }
    let entry = entries.get(id);
    if (!entry) {
      const root = doc.createElement("div");
      root.setAttribute("role", "region");
      root.style.cssText = "position:fixed;z-index:10;overflow:hidden;pointer-events:none;white-space:pre;background:#000000;font-family:monospace"; // palette-exempt: fixed host text styles cannot accept mod CSS.
      entry = { root, capability, ...location };
      entries.set(id, entry);
      doc.body.append(root);
    }
    if (location.rect) entry.rect = location.rect;
    entry.root.replaceChildren(body);
    draw();
  };
  const remove = (id: string): void => { entries.get(id)?.root.remove(); entries.delete(id); };
  return {
    replace(name: TextRegionName, value: WorkerJson): void {
      if (value === null) { remove(name); return; }
      put(name, textLines(value), `ui:${name}.replace`, { name });
    },
    create(value: WorkerJson): void {
      const json = cloneWorkerJson(value);
      if (json === null || typeof json !== "object" || Array.isArray(json) || Object.keys(json).some((key) => !["id", "rect", "lines"].includes(key)) ||
        typeof json["id"] !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(json["id"])) throw new Error("a region needs an owned id, a grid rectangle, and text lines");
      const rect = json["rect"];
      if (!rect || typeof rect !== "object" || Array.isArray(rect) || Object.keys(rect).length !== 4 ||
        !["col", "row", "cols", "rows"].every((key) => Number.isSafeInteger(rect[key]) && (rect[key] as number) >= (key === "col" || key === "row" ? 0 : 1))) throw new Error("the region rectangle must use nonnegative grid coordinates and positive dimensions");
      const snapshot = display.snapshot();
      if ((rect["col"] as number) + (rect["cols"] as number) > snapshot.grid.cols ||
        (rect["row"] as number) + (rect["rows"] as number) > snapshot.grid.rows) throw new Error("the region must fit within the game's character grid");
      put(`region:${json["id"]}`, textLines(json["lines"]), "ui:region.create", { rect: rect as unknown as WorkerTextRegion["rect"] });
    },
    remove(id: string): void { remove(`region:${id}`); },
    teardown(): void {
      closed = true;
      offSuspension();
      offFrame?.();
      for (const entry of entries.values()) entry.root.remove();
      entries.clear();
    },
  };
}
