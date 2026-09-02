import { afterEach, describe, expect, it } from "vitest";
import {
  beginTileConversion,
  finishTileConversion,
  paintTileConversionIndicator,
  tileConversionFinishedNotice,
  tileConversionInProgress,
  tileConversionSpinner,
  tileConversionStartedNotice,
} from "./tile-conversion-indicator";

const FIRST = "linoleum-gervais";
const SECOND = "linoleum-shockbolt";

afterEach(() => {
  finishTileConversion(FIRST);
  finishTileConversion(SECOND);
});

describe("Linoleum conversion HUD feedback", () => {
  it("appears and rotates while a conversion runs, then disappears when it finishes", () => {
    expect(tileConversionSpinner(0)).toBeNull();

    beginTileConversion(FIRST);
    expect(tileConversionInProgress()).toBe(true);
    expect(tileConversionSpinner(0)).toBe("|");
    expect(tileConversionSpinner(1)).toBe("/");
    expect(tileConversionSpinner(2)).toBe("-");
    expect(tileConversionSpinner(3)).toBe("\\");

    finishTileConversion(FIRST);
    expect(tileConversionInProgress()).toBe(false);
    expect(tileConversionSpinner(4)).toBeNull();
  });

  it("stays visible until every concurrent conversion has finished", () => {
    beginTileConversion(FIRST);
    beginTileConversion(SECOND);
    finishTileConversion(FIRST);
    expect(tileConversionSpinner(0)).not.toBeNull();
    finishTileConversion(SECOND);
    expect(tileConversionSpinner(0)).toBeNull();
  });

  it("paints the live glyph into the lower-right terminal HUD corner", () => {
    const prints: Array<[number, number, string, string]> = [];
    const surface = { print: (x: number, y: number, text: string, fg: string) => prints.push([x, y, text, fg]) };

    paintTileConversionIndicator(surface, 80, 24, 1, "gold");
    expect(prints).toEqual([]);

    beginTileConversion(FIRST);
    paintTileConversionIndicator(surface, 80, 24, 1, "gold");
    expect(prints).toEqual([[78, 23, "/", "gold"]]);
  });

  it("uses concise start and finish notifications naming the tile pack", () => {
    expect(tileConversionStartedNotice("Shockbolt Dark")).toBe("Converting Shockbolt Dark tiles...");
    expect(tileConversionFinishedNotice("Shockbolt Dark")).toBe("Shockbolt Dark tiles are ready.");
  });
});
