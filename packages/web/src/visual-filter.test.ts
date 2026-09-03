import { describe, expect, it } from "vitest";
import { setCanvasVisualFilter } from "./visual-filter";

describe("setCanvasVisualFilter", () => {
  it("sets and clears the terminal canvas post-processing filter", () => {
    const canvas = { style: { filter: "" } } as HTMLCanvasElement;
    setCanvasVisualFilter(canvas, "contrast(1.5)");
    expect(canvas.style.filter).toBe("contrast(1.5)");
    setCanvasVisualFilter(canvas, null);
    expect(canvas.style.filter).toBe("");
  });
});
