import type { ModWorkerPanel, ModWorkerPanelNode, ModWorkerPanelPatch, WorkerJson } from "./protocol";
import { panelDescription, panelPatch } from "./panel-schema";

interface MountedPanel {
  readonly root: HTMLDivElement;
  readonly title: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly emit: (panelId: string, action: string) => void;
}

export interface ModWorkerPanelRenderer {
  apply(pluginId: string, operation: "mount" | "patch", payload: WorkerJson, patchId?: string, onAction?: (panelId: string, action: string) => void): WorkerJson;
  teardown(pluginId: string): void;
}

/**
 * Render the API-2 panel grammar in the host DOM. The worker supplies neither
 * markup nor styles, and receives only a plain action name when a button is used.
 */
export function createModWorkerPanelRenderer(doc: Document = document): ModWorkerPanelRenderer {
  const panels = new Map<string, MountedPanel>();
  const key = (pluginId: string, panelId: string): string => `${pluginId}:${panelId}`;

  const mount = (pluginId: string, panel: ModWorkerPanel, emit: (panelId: string, action: string) => void): WorkerJson => {
    const panelKey = key(pluginId, panel.id);
    if (panels.has(panelKey)) throw new Error(`panel ${panel.id} is already mounted`);
    const root = doc.createElement("div");
    const title = doc.createElement("div");
    const body = doc.createElement("div");
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", panel.title ?? `${pluginId} panel`);
    root.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:20;max-width:min(28rem,calc(100vw - 32px));background:#18181f;color:#d8d8dc;border:1px solid #404052;border-radius:6px;padding:12px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,0.35)"; // palette-exempt: host-owned DOM panel, matching crash-screen.ts
    title.style.cssText = "font-weight:600;margin-bottom:8px";
    body.style.cssText = "display:flex;flex-direction:column;gap:8px";
    root.append(title, body);
    (doc.body ?? doc.documentElement).append(root);
    const mounted = { root, title, body, emit };
    panels.set(panelKey, mounted);
    draw(panel.id, mounted, panel);
    return { panelId: panel.id };
  };

  return {
    apply(pluginId, operation, payload, patchId, onAction): WorkerJson {
      if (operation === "mount") {
        const panel = panelDescription(payload);
        if (!panel) throw new Error("ui.mount needs a small declarative panel tree");
        return mount(pluginId, panel, onAction ?? (() => undefined));
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
        panel.root.remove();
        panels.delete(panelKey);
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
  if (patch.visible !== undefined) mounted.root.hidden = !patch.visible;
}

function renderNode(doc: Document, panelId: string, node: ModWorkerPanelNode, emit: (panelId: string, action: string) => void): HTMLElement {
  if (node.type === "text") {
    const text = doc.createElement("div");
    text.textContent = node.text;
    return text;
  }
  if (node.type === "button") {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = node.label;
    button.style.cssText = "font:inherit;padding:6px 10px;background:#24242e;color:#d8d8dc;border:1px solid #56566a;border-radius:4px;cursor:pointer"; // palette-exempt: host-owned DOM panel button
    button.addEventListener("click", () => emit(panelId, node.action));
    return button;
  }
  const layout = doc.createElement("div");
  layout.style.cssText = `display:flex;${node.type === "row" ? "flex-direction:row;flex-wrap:wrap" : "flex-direction:column"};gap:8px`;
  layout.append(...node.children.map((child) => renderNode(doc, panelId, child, emit)));
  return layout;
}
