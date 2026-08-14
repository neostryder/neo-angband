/**
 * The fifth owner runtime: a mod adding furniture of its own.
 *
 * `ui-stack.test.ts` drives the stack with specs written by hand, which is the
 * right instrument for the compositor and the wrong one for this file: what is
 * on trial here is everything BETWEEN a mod's declaration and that spec - the
 * capability gate, the per-declaration validation, the namespacing, and what
 * happens to the region whose painter throws.
 *
 * EVERY ASSERTION GOES THROUGH THE REAL STACK. `installRegions` calls
 * `pushRegion` itself rather than handing specs back for somebody else to push,
 * so these tests read `liveRegionStack()` and `paintRegionStack()` - the same
 * two functions `render()` calls. A version of this file that inspected the
 * returned specs would pass just as well against a runtime that built them
 * correctly and pushed none of them, which is precisely the class of failure
 * this repository keeps re-learning (#245, #246, #247).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { RegionCells, RegionDeclaration } from "@rpgm-tools/neo-angband-mod-sdk";
import { MOD_REGION_LAYERS, REGION_LAYERS } from "./regions";
import {
  installRegions,
  regionClaimants,
  regionDeclarationFault,
  regionsClaimed,
  REGION_CAPABILITY,
  type RegionPlugin,
} from "./region-runtime";
import { liveRegionStack, paintRegionStack, relayoutStack, resetRegionStack } from "./ui-stack";
import type { ClippableSurface } from "./region-surface";
import type { Glyph, TermSize } from "./term";
import type { ModPluginContext } from "./mod-plugin";

const COLS = 40;
const ROWS = 12;

/** A real cell grid, so "it drew" is read off the screen rather than off a spy. */
class GridDouble implements ClippableSurface {
  readonly cells: (string | null)[][];
  constructor(
    readonly cols = COLS,
    readonly rows = ROWS,
  ) {
    this.cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, (): string | null => null),
    );
  }
  eraseSpan(x: number, y: number, len: number): void {
    const row = this.cells[y];
    if (!row) return;
    for (let cx = Math.max(0, x); cx < Math.min(this.cols, x + len); cx++) row[cx] = null;
  }
  row(y: number): string {
    return (this.cells[y] ?? []).map((c) => c ?? " ").join("").replace(/\s+$/u, "");
  }
  size(): TermSize {
    return { cols: this.cols, rows: this.rows };
  }
  invalidate(): void {}
  flush(): void {}
  clear(): void {
    for (const row of this.cells) row.fill(null);
  }
  setCursor(): void {}
  hideCursor(): void {}
  put(x: number, y: number, glyph: Glyph): void {
    const row = this.cells[y];
    if (!row || x < 0 || x >= this.cols) return;
    row[x] = glyph.ch;
  }
  print(x: number, y: number, text: string, fg = "#fff"): void {
    for (let i = 0; i < text.length; i++) this.put(x + i, y, { ch: text[i]!, fg });
  }
  eraseToEol(x: number, y: number): void {
    this.eraseSpan(x, y, this.cols - x);
  }
  prt(x: number, y: number, text: string): void {
    this.eraseToEol(x, y);
    this.print(x, y, text);
  }
}

const CONTEXT = { id: "test", api: 1 } as unknown as ModPluginContext;
const contextFor = (): ModPluginContext => CONTEXT;

interface Fault {
  readonly id: string;
  readonly message: string;
}

function faultsInto(into: Fault[]): (id: string, message: string) => void {
  return (id, message) => void into.push({ id, message });
}

/** A mod declaring one region, with `ui:region.create` unless told otherwise. */
function mod(
  id: string,
  declarations: unknown,
  capabilities: readonly string[] = [REGION_CAPABILITY],
): RegionPlugin {
  return {
    id,
    manifest: { id, name: id, version: "1.0.0", shape: "plugin", capabilities: [...capabilities] } as never,
    plugin: {
      api: 1,
      regions: () => declarations as readonly RegionDeclaration[],
    },
  };
}

/** A one-row strip along the bottom, which is a rectangle every terminal has. */
function strip(id: string, text = "hello", layer: "base" | "overlay" | "modal" = "overlay"): RegionDeclaration {
  return {
    id,
    layer,
    place: (grid): RegionCells => ({ col: 0, row: grid.rows - 1, cols: grid.cols, rows: 1 }),
    paint: (surface) => surface.print(0, 0, text, "#fff"),
  };
}

beforeEach(() => {
  resetRegionStack();
});

describe("the capability is the gate", () => {
  it("refuses a mod that declares regions() without ui:region.create, and says how to fix it", () => {
    const faults: Fault[] = [];
    const installed = installRegions(
      [mod("no-grant", [strip("carried")], [])],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    expect(installed).toEqual([]);
    expect(liveRegionStack()).toEqual([]);
    expect(faults).toHaveLength(1);
    expect(faults[0]!.id).toBe("no-grant");
    expect(faults[0]!.message).toContain(REGION_CAPABILITY);
  });

  it("does NOT accept ui:*.replace in its place (#261)", () => {
    /* THE ESCALATION, asserted at the seam a mod actually reaches rather than
     * only at `CapabilitySet.has`. Before the `grantCovers` fix this mod's
     * region appeared on the player's screen on the strength of a consent line
     * that said "draw the vitals instead of the game". */
    const faults: Fault[] = [];
    installRegions(
      [mod("wildcard", [strip("carried")], ["ui:*.replace"])],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    expect(liveRegionStack()).toEqual([]);
    expect(faults.map((f) => f.id)).toEqual(["wildcard"]);
  });

  it("stays silent about a mod that declares no regions() at all", () => {
    const faults: Fault[] = [];
    const quiet: RegionPlugin = { id: "quiet", manifest: { id: "quiet", name: "q", version: "1", shape: "plugin" } as never, plugin: { api: 1 } };
    expect(regionsClaimed(quiet, faultsInto(faults))).toBe(false);
    expect(faults).toEqual([]);
    expect(regionClaimants([quiet, mod("keen", [strip("a")])])).toEqual(["keen"]);
  });
});

describe("a mod may not ask for the top band", () => {
  it("refuses layer \"system\" by name, with the recovery reason", () => {
    const fault = regionDeclarationFault({
      id: "takeover",
      layer: "system",
      place: () => ({ col: 0, row: 0, cols: 1, rows: 1 }),
      paint: () => {},
    });
    expect(fault).toContain("reserved to the game");
    expect(fault).toContain("mod manager");
  });

  it("refuses it through the whole seam, not only in the validator", () => {
    const faults: Fault[] = [];
    installRegions(
      [mod("takeover", [{ ...strip("top"), layer: "system" as never }])],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    expect(liveRegionStack()).toEqual([]);
    expect(faults[0]!.message).toContain("system");
  });

  it("allows every band that is not the top one, and that is all of them", () => {
    /* Derived rather than listed: a band added to `REGION_LAYERS` and forgotten
     * in `MOD_REGION_LAYERS` fails here rather than becoming a band nobody can
     * ask for and nobody notices is missing. */
    expect([...MOD_REGION_LAYERS]).toEqual(REGION_LAYERS.filter((l) => l !== "system"));
    for (const layer of MOD_REGION_LAYERS) {
      expect(
        regionDeclarationFault({
          id: "ok",
          layer,
          place: () => ({ col: 0, row: 0, cols: 1, rows: 1 }),
          paint: () => {},
        }),
      ).toBeUndefined();
    }
  });
});

describe("one bad declaration costs one region", () => {
  it("keeps the mod's other regions when one of them is malformed", () => {
    /* PER-REGION FAULT ISOLATION is the whole reason this runtime validates a
     * list rather than an object. A mod shipping three panels and a typo must
     * lose the typo. */
    const faults: Fault[] = [];
    const installed = installRegions(
      [
        mod("three", [
          strip("good-one"),
          { id: "no-painter", layer: "overlay", place: () => ({ col: 0, row: 0, cols: 4, rows: 1 }) },
          strip("good-two", "second", "modal"),
        ]),
      ],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    expect(installed.map((r) => r.id)).toEqual(["three:good-one", "three:good-two"]);
    expect(faults).toHaveLength(1);
    expect(faults[0]!.message).toContain("no-painter");
    expect(faults[0]!.message).toContain("paint(surface)");
  });

  it("keeps every OTHER mod's regions when one mod's regions() throws", () => {
    const faults: Fault[] = [];
    const thrower: RegionPlugin = {
      ...mod("angry", []),
      plugin: {
        api: 1,
        regions: () => {
          throw new Error("boom");
        },
      },
    };
    const installed = installRegions(
      [mod("first", [strip("a")]), thrower, mod("last", [strip("b")])],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    expect(installed.map((r) => r.id)).toEqual(["first:a", "last:b"]);
    expect(faults.map((f) => f.id)).toEqual(["angry"]);
  });

  it("refuses a second region under the same name, and keeps the first", () => {
    const faults: Fault[] = [];
    const installed = installRegions(
      [mod("twin", [strip("carried", "one"), strip("carried", "two")])],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    expect(installed.map((r) => r.id)).toEqual(["twin:carried"]);
    expect(faults[0]!.message).toContain("two regions called");
  });
});

describe("the id belongs to the host", () => {
  it("namespaces every region with its mod's id", () => {
    installRegions([mod("my-mod", [strip("carried")])], contextFor, () => {}, {
      cols: COLS,
      rows: ROWS,
    });
    expect(liveRegionStack().map((r) => r.id)).toEqual(["my-mod:carried"]);
  });

  it("makes a mod calling its region \"map\" unable to shadow the real one", () => {
    /* THE REASON THE PREFIX IS NOT COSMETIC. `occludersOf` finds the FIRST entry
     * with a matching id, so a second `map` in the stack would silently start
     * answering the one question every replacement front end asks. */
    const base = relayoutStack({
      cols: COLS,
      rows: ROWS,
      base: {
        map: { name: "map", cells: { col: 0, row: 1, cols: COLS, rows: ROWS - 2 } },
      },
    });
    expect(base.map((r) => r.id)).toEqual(["map"]);
    installRegions([mod("sneaky", [strip("map")])], contextFor, () => {}, {
      cols: COLS,
      rows: ROWS,
    });
    const ids = liveRegionStack().map((r) => r.id);
    expect(ids).toEqual(["map", "sneaky:map"]);
    expect(ids.filter((id) => id === "map")).toHaveLength(1);
  });

  it("refuses a declared id that carries its own colon", () => {
    expect(
      regionDeclarationFault({
        id: "core:screen",
        layer: "modal",
        place: () => ({ col: 0, row: 0, cols: 1, rows: 1 }),
        paint: () => {},
      }),
    ).toContain("prefixes your mod id");
  });
});

describe("nobody wins: two mods' regions coexist, in load order", () => {
  it("puts both on screen, the later-loaded one on top of its own band", () => {
    installRegions(
      [mod("early", [strip("a")]), mod("late", [strip("b")])],
      contextFor,
      () => {},
      { cols: COLS, rows: ROWS },
    );
    /* Both, in load order - not one winner. This is the assertion that says
     * this runtime is not a selection. */
    expect(liveRegionStack().map((r) => r.id)).toEqual(["early:a", "late:b"]);
  });

  it("orders by BAND first and load order second", () => {
    installRegions(
      [
        mod("early", [strip("modal-one", "x", "modal")]),
        mod("late", [strip("overlay-one", "y", "overlay")]),
      ],
      contextFor,
      () => {},
      { cols: COLS, rows: ROWS },
    );
    /* `late` loaded second and is still UNDER `early`, because bands outrank
     * load order. A z-index would have let the earlier mod be outbid. */
    expect(liveRegionStack().map((r) => r.id)).toEqual(["late:overlay-one", "early:modal-one"]);
  });
});

describe("a region that draws, and one that stops", () => {
  it("paints through the compositor into its own rectangle and nowhere else", () => {
    const term = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS });
    installRegions([mod("panel", [strip("carried", "TORCH")])], contextFor, () => {}, {
      cols: COLS,
      rows: ROWS,
    });
    term.print(0, 0, "a live map row", "#fff");
    paintRegionStack(term);
    expect(term.row(ROWS - 1)).toBe("TORCH");
    /* And it did NOT erase the rest: transparency is a cell that was not
     * written, so everything outside the strip survives the paint. */
    expect(term.row(0)).toBe("a live map row");
  });

  it("withdraws a region whose paint() throws, and reports it ONCE", () => {
    /* A region left in the stack after its painter died is a PHANTOM OCCLUDER:
     * `occludersOf(stack, "map")` would go on reporting the map as covered, and
     * a replacement front end would keep its canvas down for a rectangle that
     * has drawn nothing since the first frame. */
    const faults: Fault[] = [];
    const term = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS });
    let calls = 0;
    installRegions(
      [
        mod("brittle", [
          {
            ...strip("boom"),
            paint: () => {
              calls++;
              throw new Error("nope");
            },
          },
        ]),
      ],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    expect(liveRegionStack().map((r) => r.id)).toEqual(["brittle:boom"]);

    paintRegionStack(term);
    expect(liveRegionStack()).toEqual([]);
    expect(faults).toHaveLength(1);
    expect(faults[0]!.id).toBe("brittle");
    expect(faults[0]!.message).toContain("has been removed for this session");

    /* Three more frames: no second call, and no second report. */
    paintRegionStack(term);
    paintRegionStack(term);
    paintRegionStack(term);
    expect(calls).toBe(1);
    expect(faults).toHaveLength(1);
  });

  it("does not take another mod's region down with it", () => {
    const faults: Fault[] = [];
    const term = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS });
    installRegions(
      [
        mod("brittle", [
          {
            id: "boom",
            layer: "overlay" as const,
            place: (grid: { readonly cols: number; readonly rows: number }): RegionCells => ({
              col: 0,
              row: 0,
              cols: grid.cols,
              rows: 1,
            }),
            paint: () => {
              throw new Error("nope");
            },
          },
        ]),
        mod("sturdy", [strip("fine", "STILL HERE")]),
      ],
      contextFor,
      faultsInto(faults),
      { cols: COLS, rows: ROWS },
    );
    paintRegionStack(term);
    expect(liveRegionStack().map((r) => r.id)).toEqual(["sturdy:fine"]);
    expect(term.row(ROWS - 1)).toBe("STILL HERE");
    expect(faults.map((f) => f.id)).toEqual(["brittle"]);
  });
});
