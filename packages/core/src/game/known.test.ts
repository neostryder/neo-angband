import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { MFLAG, RF, SQUARE, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { floorCarry, floorExcise, floorPile } from "./floor";
import {
  forgetMap,
  knownFeat,
  knownObject,
  noteSpots,
  squareForget,
  squareIsKnown,
  squareKnowPile,
  squareMemorize,
  squareMemoryBad,
  squareSensePile,
} from "./known";
import { FLOOR, GRANITE, addMon, makeRace, makeState } from "./harness";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objPack: ObjPackJson = {
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
} as ObjPackJson;

const reg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));

function makeObj(tval: number): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(9), reg, constants, kind, 0, "average");
}

describe("terrain memory (square_memorize / square_forget)", () => {
  it("remembers and forgets terrain", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    expect(squareIsKnown(state, grid)).toBe(false);
    expect(knownFeat(state, grid)).toBe(-1);

    squareMemorize(state, grid);
    expect(squareIsKnown(state, grid)).toBe(true);
    expect(knownFeat(state, grid)).toBe(FLOOR);

    squareForget(state, grid);
    expect(squareIsKnown(state, grid)).toBe(false);
  });

  it("memory goes stale when the world changes (square_ismemorybad)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    squareMemorize(state, grid);
    expect(squareMemoryBad(state, grid)).toBe(false);

    state.chunk.setFeat(grid, GRANITE);
    /* The player still remembers floor. */
    expect(knownFeat(state, grid)).toBe(FLOOR);
    expect(squareMemoryBad(state, grid)).toBe(true);
  });
});

describe("object memory (square_know_pile / square_sense_pile)", () => {
  it("knowPile remembers the pile head and forgets stale memories", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    const obj = makeObj(TV.POTION);
    floorCarry(state, grid, obj);

    squareKnowPile(state, grid);
    expect(knownObject(state, grid)).toEqual({
      ch: obj.kind.dChar,
      attr: obj.kind.dAttr,
    });

    /* The object is picked up: knowing the (empty) pile clears memory. */
    floorExcise(state, grid, obj);
    expect(floorPile(state, grid)).toEqual([]);
    squareKnowPile(state, grid);
    expect(knownObject(state, grid)).toBeNull();
  });

  it("sensePile marks an unknown something without identifying it", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    floorCarry(state, grid, makeObj(TV.SWORD));

    squareSensePile(state, grid);
    expect(knownObject(state, grid)).toEqual({ ch: null, attr: "" });

    /* An exact memory is not downgraded by a later sense. */
    squareKnowPile(state, grid);
    const exact = knownObject(state, grid);
    squareSensePile(state, grid);
    expect(knownObject(state, grid)).toEqual(exact);
  });

  it("a predicate restricts what is remembered", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    floorCarry(state, grid, makeObj(TV.SWORD));
    squareKnowPile(state, grid, (o) => o.tval === TV.POTION);
    /* Nothing matching: memory untouched, but the pile is not empty so
     * nothing is forgotten either. */
    expect(knownObject(state, grid)).toBeNull();
  });
});

describe("noteSpots (note_spot + update_mon reduced)", () => {
  it("memorizes seen grids with their piles", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    floorCarry(state, grid, makeObj(TV.POTION));
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);

    noteSpots(state);
    expect(squareIsKnown(state, grid)).toBe(true);
    expect(knownObject(state, grid)).not.toBeNull();
    /* An unseen grid stays unknown. */
    expect(squareIsKnown(state, loc(20, 10))).toBe(false);
  });

  it("keeps monster visibility flags in step with the view", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.SEEN);

    noteSpots(state);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(mon.mflag.has(MFLAG.MARK)).toBe(true);

    /* Out of view: the flags fade. */
    state.chunk.sqinfoOff(mon.grid, SQUARE.SEEN);
    noteSpots(state);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(false);
  });

  it("invisible monsters are not seen; detection marks fade after one refresh", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ghost = addMon(state, makeRace({ flags: [RF.INVISIBLE] }), loc(12, 10));
    state.chunk.sqinfoOn(ghost.grid, SQUARE.SEEN);

    noteSpots(state);
    expect(ghost.mflag.has(MFLAG.VISIBLE)).toBe(false);

    /* Detected: MARK + SHOW survive exactly one refresh, then fade. */
    ghost.mflag.on(MFLAG.MARK);
    ghost.mflag.on(MFLAG.SHOW);
    ghost.mflag.on(MFLAG.VISIBLE);
    noteSpots(state);
    expect(ghost.mflag.has(MFLAG.MARK)).toBe(true);
    noteSpots(state);
    expect(ghost.mflag.has(MFLAG.MARK)).toBe(false);
  });
});

describe("forgetMap (wiz_dark's forgetting half)", () => {
  it("erases all memory and DTRAP marks", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    squareMemorize(state, grid);
    floorCarry(state, grid, makeObj(TV.POTION));
    squareKnowPile(state, grid);
    state.chunk.sqinfoOn(grid, SQUARE.DTRAP);

    forgetMap(state);
    expect(squareIsKnown(state, grid)).toBe(false);
    expect(knownObject(state, grid)).toBeNull();
    expect(state.chunk.sqinfoHas(grid, SQUARE.DTRAP)).toBe(false);
  });
});
