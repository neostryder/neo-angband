import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

describe("Linoleum entity precaching", () => {
  it("keeps the existing known-terrain warmup", () => {
    const body = functionBody(MAIN, "precacheTilesNear");
    expect(body).toContain("knownFeat(state, loc(x, y))");
    expect(body).toContain("tileForFeature(tileMap, disp.fidx, LIGHTING.LOS)");
  });

  it("warms nearby live monsters and the live floor display", () => {
    const body = functionBody(MAIN, "precacheTilesNear");
    expect(body).toMatch(/for \(let i = 1; i < state\.monsters\.length; i\+\+\)/);
    expect(body).toContain("tileForMonster(tileMap, mon.race.ridx)");
    expect(body).toContain("for (const pile of state.floor.values())");
    expect(body).toContain("floorDisplay(pile, state.isIgnored)");
    expect(body).toContain("shown.multiple ? (pileKind ?? shown.obj.kind) : shown.obj.kind");
    expect(body).toContain("preload(shownObjectTile(kind).atlas, grid.x, grid.y)");
  });

  it("shares the flavor-aware item tile decision with live drawing", () => {
    const display = functionBody(MAIN, "shownObjectTile");
    expect(display).toContain("useFlavorGlyph(kind, flavor, game.flavor?.isAware(kind) ?? false)");
    expect(display).toContain("tileForShownObject(tileMap, kind, shownFlavor ? shownFlavor.fidx : null)");
    const cell = functionBody(MAIN, "objectKindCell");
    expect(cell).toContain("const { shownFlavor, atlas } = shownObjectTile(kind, graphics)");
    expect(cell).toContain("tileDrawFor(atlas, gx, gy, dimmed, graphics)");
  });

  it("warms revealed traps through their own tileForTrap path (#224)", () => {
    const body = functionBody(MAIN, "precacheTilesNear");
    expect(body).toContain("for (const list of state.traps.values())");
    expect(body).toContain("t.flags.has(TRF.VISIBLE)");
    expect(body).toContain("t.kind.glyph.trim()");
    expect(body).toContain("tileForTrap(tileMap, t.kind.tidx, LIGHTING.LOS)");
  });

  it("warms the player's own tile, including a mod's shapechange override (#224)", () => {
    const body = functionBody(MAIN, "precacheTilesNear");
    expect(body).toContain(
      "preload(playerTileOverride() ?? tileForMonster(tileMap, 0), state.actor.grid.x, state.actor.grid.y)",
    );
  });
});
