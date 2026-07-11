import { readFileSync } from "node:fs";
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
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
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

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

/* A real object registry so entry names can flow through object_desc. */
const objReg = new ObjRegistry({
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson);

/** Drop a real kind (from the pack) on a known floor grid. */
function putRealFloor(
  state: GameState,
  at: Loc,
  kindName: string,
  number: number,
): GameObject {
  const kind = objReg.kinds.find((k) => k.name === kindName) as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.number = number;
  obj.grid = at;
  const idx = at.y * state.chunk.width + at.x;
  const pile = state.floor.get(idx) ?? [];
  pile.push(obj);
  state.floor.set(idx, pile);
  state.known.objects.set(idx, {
    ch: kind.dChar ?? ",",
    attr: kind.dAttr ?? "w",
  });
  return obj;
}

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
    expect(objectListEntryName(list.entries[0]!, state)).toBe("(unknown)");
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

  it("formats a stack name with its count through object_desc", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    /* A real kind so the name flows through object_desc: the accumulated
     * count drives the article and the "~" plural (Ration -> Rations). */
    putRealFloor(state, loc(22, 12), "& Ration~ of Food", 3);
    const list = objectListCollect(state);
    expect(objectListEntryName(list.entries[0]!, state)).toBe(
      "3 Rations of Food",
    );
  });
});
