// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { panelDescription, panelPatch } from "./panel-schema";
import { createModWorkerPanelRenderer } from "./panels";
import { suspendModPanels } from "../panel-runtime";

describe("API-2 declarative panel schema", () => {
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
