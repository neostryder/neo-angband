// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { panelDescription, panelPatch } from "./panel-schema";
import { createModWorkerPanelRenderer } from "./panels";
import { resetModPanels, suspendModPanels } from "../panel-runtime";
import { dispatchUiInput } from "../input-door";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { createApi2Host, disposeApi2Host } from "../mod-api2-host";
import { modPluginContext } from "../mod-context";

afterEach(() => { resetModPanels(); });

describe("API-2 declarative panel schema", () => {
  it("hands first-party pages a host-owned root and releases them on dismissal and teardown", async () => {
    const caps = CapabilitySet.fromManifest({ id: "pages", name: "Pages", version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: ["ui:panel.mount"] });
    const ctx = modPluginContext("pages", {}, undefined, {}, { capabilities: caps });
    const api = createApi2Host(ctx, { grants: caps, tier: "first-party", firstParty: { presentation: true } });
    const opened = await api.ui.mountPage!("order", (root) => {
      const button = document.createElement("button");
      button.textContent = "Send";
      root.append(button);
    }, { modal: true, label: "Order" });
    if (!opened.ok) throw new Error("refused");
    expect(opened.value.root.querySelector("button")?.textContent).toBe("Send");
    opened.value.close();
    await opened.value.closed;
    expect(opened.value.open).toBe(false);
    const overlay = await api.ui.overlay!();
    if (!overlay.ok) throw new Error("refused");
    expect(overlay.value.root).toBeInstanceOf(ShadowRoot);
    disposeApi2Host(api);
    expect(overlay.value.open).toBe(false);
    expect(createApi2Host(ctx, { grants: caps, tier: "public" }).ui.overlay).toBeUndefined();
    expect(createApi2Host(ctx, { grants: caps, tier: "public" }).ui.mountPage).toBeUndefined();
  });
  it("renders editable controls, reports typed values and refuses disabled buttons", () => {
    const renderer = createModWorkerPanelRenderer();
    const action = vi.fn();
    const dismissed = vi.fn();
    renderer.apply("form", "mount", { id: "settings", root: { type: "column", children: [
      { type: "input", label: "Key", action: "key", value: "F2" },
      { type: "checkbox", label: "Remember", action: "remember", checked: false },
      { type: "button", label: "Bind", action: "bind", disabled: true },
    ] } }, undefined, action, dismissed);
    const root = document.querySelector<HTMLElement>('[aria-label="form panel"]')!;
    const input = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = "F3";
    input.dispatchEvent(new Event("input"));
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    root.querySelector("button")!.click();
    expect(action.mock.calls).toEqual([["settings", "key", "F3"], ["settings", "remember", true]]);
    renderer.apply("form", "unmount", null, "settings");
    renderer.apply("form", "unmount", null, "settings");
    expect(dismissed).toHaveBeenCalledOnce();
    expect(root.isConnected).toBe(false);
    renderer.apply("form", "mount", { id: "settings", root: { type: "text", text: "Again" } });
    renderer.teardown("form");
  });

  it("owns a modal shadow root and accepts navigation and dismissal through the shared input door", () => {
    const renderer = createModWorkerPanelRenderer();
    const shadow = vi.spyOn(HTMLElement.prototype, "attachShadow");
    const action = vi.fn();
    const dismissed = vi.fn();
    try {
      renderer.apply("modal", "mount", { id: "order", modal: true, title: "Order", root: { type: "button", label: "Send", action: "send" } }, undefined, action, dismissed);
      const root = shadow.mock.results[0]!.value as ShadowRoot;
      expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
      const key = (value: string) => dispatchUiInput({ key: { key: value, modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } });
      key("2");
      expect(root.activeElement?.textContent).toBe("Send");
      key("Enter");
      expect(action).toHaveBeenCalledWith("order", "send");
      key("Escape");
      expect(dismissed).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      renderer.teardown("modal");
      shadow.mockRestore();
    }
  });

  it("accepts downloads as text and rejects paths and malformed control values", () => {
    expect(panelDescription({ id: "export", modal: true, root: { type: "download", label: "Export", name: "settings.json", text: "{}" } })).not.toBeNull();
    expect(panelDescription({ id: "export", root: { type: "download", label: "Export", name: "../settings.json", text: "{}" } })).toBeNull();
    expect(panelDescription({ id: "settings", root: { type: "checkbox", label: "Remember", action: "remember", checked: "yes" } })).toBeNull();
    expect(panelDescription({ id: "settings", root: { type: "input", label: "Key", action: "key", value: 1 } })).toBeNull();
    expect(panelDescription({ id: "settings", root: { type: "button", label: "Bind", action: "bind", disabled: "yes" } })).toBeNull();
  });

  it("downloads a JSON blob and releases its URL", async () => {
    const renderer = createModWorkerPanelRenderer();
    const create = vi.fn(() => "blob:export");
    const revoke = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      expect(this.download).toBe("settings.json");
      expect(this.href).toBe("blob:export");
    });
    try {
      renderer.apply("download", "mount", { id: "export", root: { type: "download", label: "Export", name: "settings.json", text: "{}" } });
      document.querySelector<HTMLButtonElement>('[aria-label="download panel"] button')!.click();
      expect(create).toHaveBeenCalledOnce();
      expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe("application/json");
      await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:export"));
    } finally {
      renderer.teardown("download");
      click.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
  it("suspends mounted and newly mounted API-2 panels through patches and input", () => {
    const renderer = createModWorkerPanelRenderer();
    const action = vi.fn();
    const panel = { id: "status", root: { type: "button", label: "Run", action: "run" } };
    renderer.apply("old", "mount", panel, undefined, action);
    const restore = suspendModPanels();
    const nested = suspendModPanels();
    try {
      renderer.apply("new", "mount", panel, undefined, action);
      renderer.apply("old", "patch", { visible: true }, "status");
      restore();
      for (const root of document.querySelectorAll<HTMLElement>('[role="region"]')) {
        expect(root.style.visibility).toBe("hidden");
        expect(root.inert).toBe(true);
        root.querySelector("button")!.click();
      }
      expect(action).not.toHaveBeenCalled();
      renderer.apply("new", "patch", { visible: false }, "status");
    } finally {
      restore();
      nested();
    }
    const roots = document.querySelectorAll<HTMLElement>('[role="region"]');
    expect(roots[0]!.style.visibility).toBe("");
    expect(roots[1]!.hidden).toBe(true);
    roots[0]!.querySelector("button")!.click();
    expect(action).toHaveBeenCalledOnce();
    renderer.teardown("old");
    renderer.teardown("new");
  });
  it("accepts only text, buttons, and simple layout", () => {
    expect(panelDescription({
      id: "status",
      title: "Status",
      root: { type: "row", children: [
        { type: "text", text: "Ready" },
        { type: "button", label: "Refresh", action: "refresh" },
      ] },
    })).not.toBeNull();
    expect(panelDescription({ id: "status", root: { type: "html", markup: "<b>no</b>" } })).toBeNull();
    expect(panelPatch({ visible: false })).not.toBeNull();
    expect(panelPatch({ style: "position:fixed" })).toBeNull();
  });
});
