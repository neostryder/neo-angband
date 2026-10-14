// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { panelDescription, panelPatch } from "./panel-schema";
import { createModWorkerPanelRenderer } from "./panels";
import { suspendModPanels } from "../panel-runtime";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { api2Plugin } from "../mod-api2-shim";
import { modPluginContext } from "../mod-context";

describe("API-2 declarative panel schema", () => {
  it("cleans an API 2 mod's panels even when its stop callback throws", async () => {
    const renderer = createModWorkerPanelRenderer();
    const grants = CapabilitySet.fromManifest({ id: "probe", name: "Probe", version: "1.0.0", shape: "plugin", capabilities: ["ui:panel.mount"] });
    const plugin = api2Plugin({ api: ">=2.0.0 <3.0.0", start: async (mod) => {
      await mod.ui.mount({ id: "status", root: { type: "text", text: "Ready" } });
      await mod.ui.unmount("status");
      await mod.ui.mount({ id: "status", root: { type: "text", text: "Again" } });
    }, stop: () => { throw new Error("stop failed"); } }, () => ({ grants, panels: renderer }));
    plugin.register!({} as never, modPluginContext("probe", {}));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(document.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(() => plugin.uninstall!()).toThrow("stop failed");
    expect(document.querySelectorAll('[role="region"]')).toHaveLength(0);
  });
  it("unmounts one owner's panel and reports player dismissal once", () => {
    const renderer = createModWorkerPanelRenderer();
    const dismissed = vi.fn();
    const panel = { id: "status", title: "Status", root: { type: "text", text: "Ready" } };
    renderer.apply("one", "mount", panel, undefined, undefined, dismissed);
    renderer.apply("two", "mount", panel);
    renderer.unmount("two", "status");
    expect(document.querySelectorAll('[role="region"]')).toHaveLength(1);
    const close = document.querySelector<HTMLButtonElement>('[role="region"] button')!;
    close.click();
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[role="region"]')).toHaveLength(0);
    renderer.apply("one", "mount", panel);
    renderer.teardown("one");
    expect(document.querySelectorAll('[role="region"]')).toHaveLength(0);
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
