import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import { loc } from "../loc.js";
import {
  COLOUR_RED,
  COLOUR_SLATE,
  COLOUR_VIOLET,
  COLOUR_WHITE,
} from "../color.js";
import type { Loc } from "../loc.js";
import { ObjRegistry } from "../obj/bind.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import type { ObjPackJson, ObjectKind } from "../obj/types.js";
import { objectNew } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import type { Artifact } from "../obj/types.js";
import type { GameState } from "./context.js";
import { makeState } from "./harness.js";
import {
  OBJECT_LIST_SECTION_LOS,
  OBJECT_LIST_SECTION_NO_LOS,
  objectListCollect,
  objectListEntryLineAttribute,
  objectListEntryName,
  objectListSort,
  objectListStandardCompare,
} from "./obj-list.js";

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
  remember(state, idx, obj);
  return obj;
}

/** The player has SEEN `obj` at this grid: one entry in the remembered pile. */
function remember(state: GameState, idx: number, obj: GameObject): void {
  const known = state.known.objects.get(idx) ?? [];
  known.push({ obj, sensed: false });
  state.known.objects.set(idx, known);
}

interface FakeOpts {
  name?: string;
  tval?: number;
  sval?: number;
  cost?: number;
  number?: number;
  artifact?: Artifact | null;
  /** obj->notice bits (OBJ_NOTICE.*); default 0 = unassessed. */
  notice?: number;
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
    notice: opts.notice ?? 0,
    grid: at,
  } as unknown as GameObject;

  const idx = at.y * state.chunk.width + at.x;
  const pile = state.floor.get(idx) ?? [];
  pile.push(obj);
  state.floor.set(idx, pile);
  remember(state, idx, obj);
  return obj;
}

/**
 * Mark a grid as sensed-but-unidentified (detection marker, no glyph). A
 * sensed memory is still a memory OF an object, so this puts one on the floor
 * and remembers it with the fake kind, exactly as object_sense does.
 */
function senseUnknown(state: GameState, at: Loc): void {
  const obj = putFloor(state, at);
  const idx = at.y * state.chunk.width + at.x;
  const known = state.known.objects.get(idx) ?? [];
  const entry = known.find((e) => e.obj === obj);
  if (entry) entry.sensed = true;
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
  it("orders assessed artifacts first, worthless last", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    putFloor(state, loc(21, 12), { name: "Worthless", cost: 0 });
    putFloor(state, loc(22, 12), { name: "Normal", cost: 50 });
    putFloor(state, loc(23, 12), {
      name: "Artifact",
      artifact: {} as Artifact,
      notice: OBJ_NOTICE.ASSESSED,
    });

    const list = objectListCollect(state);
    objectListSort(list, objectListStandardCompare(state));
    const names = list.entries.map((e) => e.object!.kind.name);
    expect(names[0]).toBe("Artifact");
    expect(names[names.length - 1]).toBe("Worthless");
  });

  it("does not sort a not-yet-assessed artifact as a known artifact", () => {
    /* obj-list.c compare_items gates on obj->known->artifact (the ASSESSED
     * bit), not obj->artifact - an unassessed floor artifact must fall through
     * to the normal branches, not jump to the front. Here the artifact is a
     * worthless-cost kind, so it should sort LAST, not first. */
    const state = makeState({ playerGrid: loc(20, 12) });
    putFloor(state, loc(21, 12), { name: "Normal", cost: 50 });
    putFloor(state, loc(22, 12), {
      name: "UnknownArtifact",
      cost: 0,
      artifact: {} as Artifact,
      /* notice defaults to 0: not ASSESSED. */
    });

    const list = objectListCollect(state);
    objectListSort(list, objectListStandardCompare(state));
    const names = list.entries.map((e) => e.object!.kind.name);
    expect(names[0]).toBe("Normal");
    expect(names[names.length - 1]).toBe("UnknownArtifact");
  });

  it("colours assessed artifact violet, worthless slate, unknown red, else white", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const art = putFloor(state, loc(21, 12), {
      artifact: {} as Artifact,
      notice: OBJ_NOTICE.ASSESSED,
    });
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

  it("does not colour a not-yet-assessed artifact violet", () => {
    /* Colour must match the name: an unassessed artifact whose in-list name
     * reads as an unknown item must not render as a known-artifact (violet).
     * It falls through to the value-based branches (here cost 5 => white). */
    const state = makeState({ playerGrid: loc(20, 12) });
    const unassessed = putFloor(state, loc(21, 12), {
      artifact: {} as Artifact,
      cost: 5,
      /* notice defaults to 0: not ASSESSED. */
    });
    expect(
      objectListEntryLineAttribute(
        { object: unassessed, unknown: false, count: [1, 0], dx: 0, dy: 0 },
        state,
      ),
    ).toBe(COLOUR_WHITE);
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

describe("objectListStandardCompare - the objectListTiebreak seam", () => {
  /*
   * Core's side of the seam only. The GEOMETRIC key is the bug-fixes mod's patch
   * (#4664, "bugfix.objectListOrder"), lives in packages/web/mods/bug-fixes/
   * hooks.ts, and is proven there; core holds no opinion about how a tie breaks
   * and no `bugfix.*` string. What core owes is: upstream's keys first, the hook
   * only for a real tie, and the hook's answer honoured as given.
   */
  /* Two DISTINCT entries of the same kind at the SAME squared distance from the
   * player but different offsets: compareTypes ties, distanceCompare ties. */
  function sameDistancePair(): [
    import("./obj-list.js").ObjectListEntry,
    import("./obj-list.js").ObjectListEntry,
  ] {
    const obj = {
      kind: { name: "Ration of Food", dChar: ",", dAttr: "w", cost: 3 },
      tval: 80,
      sval: 1,
      number: 1,
      artifact: null,
      notice: 0,
    } as unknown as GameObject;
    // (dx=3, dy=4) and (dx=4, dy=3) are both 25 units away.
    const a = { object: obj, unknown: false, count: [1, 0], dx: 3, dy: 4 };
    const b = { object: obj, unknown: false, count: [1, 0], dx: 4, dy: 3 };
    return [a as never, b as never];
  }

  it("faithful with no mod loaded: equal-distance distinct entries are order-equivalent", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const [a, b] = sameDistancePair();
    const cmp = objectListStandardCompare(state);
    expect(cmp(a, b)).toBe(0);
    expect(cmp(b, a)).toBe(0);
  });

  it("honours whatever order the hook reports, without imposing one", () => {
    /* Deliberately NOT the mod's key: rightmost-first on dx alone. If core were
     * quietly applying a geometric order of its own, this would disagree. */
    const state = makeState({ playerGrid: loc(20, 12) });
    state.modHooks = { objectListTiebreak: (x, y) => Math.sign(y.dx - x.dx) };
    const [a, b] = sameDistancePair(); // a.dx=3, b.dx=4
    const cmp = objectListStandardCompare(state);
    expect(cmp(a, b)).toBeGreaterThan(0); // b (dx=4) sorts first
    expect(cmp(b, a)).toBeLessThan(0);
    expect(Math.sign(cmp(a, b))).toBe(-Math.sign(cmp(b, a)));
  });

  it("consults the hook ONLY after every upstream key, distance included", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const asked: Array<[number, number, number, number]> = [];
    state.modHooks = {
      objectListTiebreak: (x, y) => {
        asked.push([x.dy, x.dx, y.dy, y.dx]);
        return 0;
      },
    };
    const cmp = objectListStandardCompare(state);
    const [a, b] = sameDistancePair();

    /* Different DISTANCE: upstream's own keys settle it, so the hook is never
     * reached - a mod cannot override upstream ordering, only extend it. */
    const far = { ...(b as { dx: number; dy: number }), dx: 9, dy: 9 } as typeof b;
    expect(cmp(a, far)).toBeLessThan(0);
    expect(asked).toEqual([]);

    /* A real tie: now it is asked, with both entries' offsets. */
    expect(cmp(a, b)).toBe(0); // the hook returned 0 -> still equal, as faithful
    expect(asked).toEqual([[4, 3, 3, 4]]);
  });
});
