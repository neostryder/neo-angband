import { describe, expect, it } from "vitest";
import { TV } from "../generated";
import { loc } from "../loc";
import {
  COLOUR_RED,
  COLOUR_SLATE,
  COLOUR_VIOLET,
  COLOUR_WHITE,
} from "../color";
import type { Loc } from "../loc";
import type { GameObject } from "../obj/object";
import type { Artifact } from "../obj/types";
import type { GameState } from "./context";
import { makeState } from "./harness";
import {
  OBJECT_LIST_SECTION_LOS,
  OBJECT_LIST_SECTION_NO_LOS,
  objectListCollect,
  objectListEntryLineAttribute,
  objectListEntryName,
  objectListSort,
  objectListStandardCompare,
} from "./obj-list";

interface FakeOpts {
  name?: string;
  tval?: number;
  sval?: number;
  cost?: number;
  number?: number;
  artifact?: Artifact | null;
}

/** Drop a minimal floor object at a grid and mark the grid as known. */
function putFloor(state: GameState, at: Loc, opts: FakeOpts = {}): GameObject {
  const kind = {
    name: opts.name ?? "Ration of Food",
    dChar: ",",
    dAttr: "w",
    cost: opts.cost ?? 3,
  };
  const obj = {
    kind,
    tval: opts.tval ?? 80 /* not money */,
    sval: opts.sval ?? 1,
    number: opts.number ?? 1,
    artifact: opts.artifact ?? null,
    grid: at,
  } as unknown as GameObject;

  const idx = at.y * state.chunk.width + at.x;
  const pile = state.floor.get(idx) ?? [];
  pile.push(obj);
  state.floor.set(idx, pile);
  state.known.objects.set(idx, { ch: kind.dChar, attr: kind.dAttr });
  return obj;
}

/** Mark a grid as sensed-but-unidentified (detection marker, no glyph). */
function senseUnknown(state: GameState, at: Loc): void {
  const idx = at.y * state.chunk.width + at.x;
  state.known.objects.set(idx, { ch: null, attr: "" });
}

describe("object_list_collect (obj-list.c L156)", () => {
  it("lists known floor objects with stack counts", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    putFloor(state, loc(22, 12), { name: "Ration of Food", number: 5 });
    putFloor(state, loc(23, 12), { name: "Wooden Torch" });

    const list = objectListCollect(state);
    expect(list.distinctEntries).toBe(2);
    expect(list.totalObjects[OBJECT_LIST_SECTION_LOS]).toBe(6);
  });

  it("skips money", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    putFloor(state, loc(22, 12), { name: "Gold", tval: TV.GOLD });
    const list = objectListCollect(state);
    expect(list.distinctEntries).toBe(0);
  });

  it("skips objects the session marks ignored", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const junk = putFloor(state, loc(22, 12), { name: "Broken Dagger" });
    state.isIgnored = (o) => o === junk;
    const list = objectListCollect(state);
    expect(list.distinctEntries).toBe(0);
  });

  it("emits an unknown entry for a sensed-but-unidentified grid", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    senseUnknown(state, loc(22, 12));
    const list = objectListCollect(state);
    expect(list.distinctEntries).toBe(1);
    expect(list.entries[0]!.unknown).toBe(true);
    expect(objectListEntryName(list.entries[0]!)).toBe("(unknown)");
  });

  it("places a far object in the out-of-view section", () => {
    /* Distance 35 > max_range 20 => not projectable => NO_LOS. */
    const state = makeState({ w: 60, playerGrid: loc(5, 12) });
    putFloor(state, loc(40, 12), { name: "Ration of Food" });
    const list = objectListCollect(state);
    expect(list.totalObjects[OBJECT_LIST_SECTION_NO_LOS]).toBe(1);
    expect(list.totalObjects[OBJECT_LIST_SECTION_LOS]).toBe(0);
  });
});

describe("object_list sorting + colour", () => {
  it("orders artifacts first, worthless last", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    putFloor(state, loc(21, 12), { name: "Worthless", cost: 0 });
    putFloor(state, loc(22, 12), { name: "Normal", cost: 50 });
    putFloor(state, loc(23, 12), {
      name: "Artifact",
      artifact: {} as Artifact,
    });

    const list = objectListCollect(state);
    objectListSort(list, objectListStandardCompare(state));
    const names = list.entries.map((e) => e.object!.kind.name);
    expect(names[0]).toBe("Artifact");
    expect(names[names.length - 1]).toBe("Worthless");
  });

  it("colours artifact violet, worthless slate, unknown red, else white", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const art = putFloor(state, loc(21, 12), { artifact: {} as Artifact });
    const worthless = putFloor(state, loc(22, 12), { cost: 0 });
    const normal = putFloor(state, loc(23, 12), { cost: 5 });

    const mk = (o: GameObject) =>
      objectListEntryLineAttribute(
        { object: o, unknown: false, count: [1, 0], dx: 0, dy: 0 },
        state,
      );
    expect(mk(art)).toBe(COLOUR_VIOLET);
    expect(mk(worthless)).toBe(COLOUR_SLATE);
    expect(mk(normal)).toBe(COLOUR_WHITE);
    expect(
      objectListEntryLineAttribute(
        { object: null, unknown: true, count: [1, 0], dx: 0, dy: 0 },
        state,
      ),
    ).toBe(COLOUR_RED);
  });

  it("formats a stack name with its count", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    putFloor(state, loc(22, 12), { name: "Ration of Food", number: 3 });
    const list = objectListCollect(state);
    expect(objectListEntryName(list.entries[0]!)).toBe("3 Ration of Food");
  });
});
