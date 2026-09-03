import { describe, expect, it } from "vitest";
import { panelDescription, panelPatch } from "./panel-schema";

describe("API-2 declarative panel schema", () => {
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
