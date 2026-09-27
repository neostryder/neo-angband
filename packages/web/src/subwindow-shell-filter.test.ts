import { describe, expect, it } from "vitest";
import { filterSubwindowContent, SUBWINDOW_CONTENT_FILTER } from "./subwindow-shell";

describe("tiled subwindow visual filter", () => {
  it("filters the title and body while preserving host controls", () => {
    const nodes = new Map<string, { style: { filter?: string; properties: Map<string, string>; setProperty(name: string, value: string): void; removeProperty(name: string): void } }>();
    for (const name of [".tile-drag-handle", ".tile-title-label", ".tile-body", ".tile-close", ".tile-controls"]) {
      const properties = new Map<string, string>();
      nodes.set(name, { style: { properties, setProperty: (key, value) => { properties.set(key, value); }, removeProperty: (key) => { properties.delete(key); } } });
    }
    const leaf = {
      querySelector: (selector: string) => nodes.get(selector) ?? null,
    } as unknown as HTMLElement;
    filterSubwindowContent(leaf, "saturate(0.4)");
    for (const name of [".tile-drag-handle", ".tile-title-label"]) {
      expect(nodes.get(name)?.style.filter).toBe("saturate(0.4)");
    }
    expect(nodes.get(".tile-body")?.style.properties.get(SUBWINDOW_CONTENT_FILTER)).toBe("saturate(0.4)");
    expect(nodes.get(".tile-close")?.style.filter).toBeUndefined();
    expect(nodes.get(".tile-controls")?.style.filter).toBeUndefined();
    filterSubwindowContent(leaf, null);
    expect(nodes.get(".tile-body")?.style.properties.has(SUBWINDOW_CONTENT_FILTER)).toBe(false);
  });

  it("never puts a filter on the body itself, which would move its fixed canvas", () => {
    const body = { style: { filter: "", setProperty: () => {}, removeProperty: () => {} } };
    const leaf = { querySelector: (selector: string) => (selector === ".tile-body" ? body : null) } as unknown as HTMLElement;
    filterSubwindowContent(leaf, "contrast(1.1)");
    expect(body.style.filter).toBe("");
  });
});
