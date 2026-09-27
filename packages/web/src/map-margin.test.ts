import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMapMargin } from "./map-margin";

describe("main map margin", () => {
  const base = { x: 13, y: 1, width: 66, height: 22 };

  it("shrinks the map at each edge and restores the full viewport when cleared", () => {
    expect(applyMapMargin(base, { edge: "left", cells: 3 })).toEqual({ x: 16, y: 1, width: 63, height: 22 });
    expect(applyMapMargin(base, { edge: "top", cells: 2 })).toEqual({ x: 13, y: 3, width: 66, height: 20 });
    expect(applyMapMargin(base, { edge: "right", cells: 2 })).toEqual({ x: 13, y: 1, width: 64, height: 22 });
    expect(applyMapMargin(base, { edge: "bottom", cells: 2 })).toEqual({ x: 13, y: 1, width: 66, height: 20 });
    expect(applyMapMargin(base, null)).toEqual(base);
  });

  it("clamps the strip to four cells and preserves a usable narrow map", () => {
    expect(applyMapMargin(base, { edge: "right", cells: 99 }).width).toBe(62);
    expect(applyMapMargin({ x: 0, y: 0, width: 6, height: 5 }, { edge: "left", cells: 4 }).width).toBe(4);
    expect(applyMapMargin(base, { edge: "top", cells: Number.NaN })).toEqual(base);
  });

  it("feeds the main viewport and clears the reservation on mod teardown", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).toContain("const reserved = applyMapMargin({ x: mapOriginX, y: mapTop, width: mapCols, height: mapRows }, displayMapMargin);");
    expect(main).toContain("mapOriginX = reserved.x;");
    expect(main).toContain("mapRows = reserved.height;");
    expect(main).toContain("clearMapMargin: () => displayControl.setMapMargin?.(null)");
  });
});
