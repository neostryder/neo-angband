import { describe, expect, it } from "vitest";
import { filterSubwindowContent } from "./subwindow-shell";

describe("tiled subwindow visual filter", () => {
  it("filters the title and body while preserving host controls", () => {
    const nodes = new Map<string, { style: { filter?: string } }>();
    for (const name of [".tile-drag-handle", ".tile-title-label", ".tile-body", ".tile-close", ".tile-controls"]) {
      nodes.set(name, { style: {} });
    }
    const leaf = {
      querySelector: (selector: string) => nodes.get(selector) ?? null,
    } as unknown as HTMLElement;
    filterSubwindowContent(leaf, "saturate(0.4)");
    for (const name of [".tile-drag-handle", ".tile-title-label", ".tile-body"]) {
      expect(nodes.get(name)?.style.filter).toBe("saturate(0.4)");
    }
    expect(nodes.get(".tile-close")?.style.filter).toBeUndefined();
    expect(nodes.get(".tile-controls")?.style.filter).toBeUndefined();
    filterSubwindowContent(leaf, null);
    expect(nodes.get(".tile-body")?.style.filter).toBe("");
  });
});
