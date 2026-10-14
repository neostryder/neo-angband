import type { ModWorkerPanel, ModWorkerPanelNode, ModWorkerPanelPatch, WorkerJson } from "./protocol";
import { panelDescription, panelPatch } from "./panel-schema";
import { closeTopModPanel, createModUi, modPanelsSuspended, onModPanelSuspension, topModPanelId } from "../panel-runtime";
import { addControlDomOwner, inputEvents } from "../input-door";
import type { ModPanel } from "../mod-plugin";

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
