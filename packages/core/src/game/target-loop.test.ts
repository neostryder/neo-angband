import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { MFLAG, RF, SQUARE, TMD, TV } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import { ObjRegistry } from "../obj/bind";
import { ODESC } from "../obj/desc";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import type { ObjPackJson } from "../obj/types";
import { Rng } from "../rng";
import { COLOUR_BLUE, COLOUR_L_DARK, COLOUR_L_RED, COLOUR_WHITE } from "../color";
import type { GameState } from "./context";
import { describeObject } from "./describe";
import { floorCarry } from "./floor";
import { squareMemorize } from "./known";
import { addMon, FLOOR, GRANITE, featureReg, makeRace, makeState } from "./harness";
import { TARGET, targetGetMonsters, targetIsSet } from "./target";
import {
  computePathColours,
  currentLoopGrid,
  describeLookGrid,
  initTargetLoopUi,
  monsterLookName,
  stepTargetLoop,
  targetDirAllow,
  useInterestingLoopMode,
} from "./target-loop";

/** A visible (target-able) monster of the given race flags. */
function addVisible(state: GameState, at: Loc, flags: number[] = [], hp = 60): Monster {
  const mon = addMon(state, makeRace({ flags }), at, { hp });
  mon.mflag.on(MFLAG.VISIBLE);
  return mon;
}

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
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

/** An unflavoured object (a light source, so awareness never gates its name). */
function makeLight(): { obj: GameObject; name: string } {
  const kind = reg.kinds.find(
    (k) => k.tval === TV.LIGHT && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error("no ordinary LIGHT kind in the content pack");
  return { obj: objectPrep(new Rng(9), reg, constants, kind, 0, "average"), name: kind.name };
}

/** A second, unflavoured, non-stacking-with-light object kind. */
function makeFlask(): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === TV.FLASK && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error("no ordinary FLASK kind in the content pack");
  return objectPrep(new Rng(9), reg, constants, kind, 0, "average");
}

describe("monsterLookName (monster_desc MDESC_IND_VIS)", () => {
  it("gives an indefinite article for a consonant-starting race", () => {
    const mon = addVisible(makeState(), loc(11, 10));
    mon.race = { ...mon.race, name: "kobold" };
    expect(monsterLookName(mon)).toBe("a kobold");
  });

  it("gives 'an' before a vowel-starting race name", () => {
    const mon = addVisible(makeState(), loc(11, 10));
    mon.race = { ...mon.race, name: "orc" };
    expect(monsterLookName(mon)).toBe("an orc");
  });

  it("uses the proper name (no article) for a unique", () => {
    const state = makeState();
    const mon = addVisible(state, loc(11, 10), [RF.UNIQUE]);
    mon.race = { ...mon.race, name: "Grip, Farmer Maggot's Dog" };
    expect(monsterLookName(mon)).toBe("Grip, Farmer Maggot's Dog");
  });
});

describe("describeLookGrid (target_set_interactive_aux + aux_*)", () => {
  it("describes the player's own grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    // Standing on it, the player always knows their own terrain; real play
    // keeps this memorized via noteSpots. squareIsSeen does not gate the
    // "You are on ..." phrasing (chunk.mon(grid) < 0 takes priority).
    squareMemorize(state, loc(10, 10));
    const { text, mon } = describeLookGrid(state, loc(10, 10), TARGET.LOOK);
    expect(mon).toBeNull();
    expect(text).toBe("You are on an open floor, 0 N, 0 E.");
  });

  it("names a visible monster with its health and coords", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const m = addVisible(state, loc(15, 10));
    m.race = { ...m.race, name: "kobold" };
    state.chunk.sqinfoOn(m.grid, SQUARE.SEEN); // lit grid -> "You see"
    const { text, mon } = describeLookGrid(state, loc(15, 10), TARGET.KILL);
    expect(mon).toBe(m);
    expect(text).toBe("You see a kobold (unhurt), 0 N, 5 E.");
  });

  it("names a wounded monster's status", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const m = addVisible(state, loc(15, 10), [], 100);
    m.hp = 50; // 50% of max -> "wounded"
    m.race = { ...m.race, name: "kobold" };
    const { text } = describeLookGrid(state, loc(15, 10), TARGET.KILL);
    expect(text).toContain("(wounded)");
  });

  it("describes a single known object on a seen floor grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(11, 10);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);
    const { obj } = makeLight();
    floorCarry(state, grid, obj);
    const { text, mon } = describeLookGrid(state, grid, TARGET.LOOK);
    expect(mon).toBeNull();
    expect(text).toBe(`You see ${describeObject(state, obj, ODESC.PREFIX | ODESC.FULL)}, 0 N, 1 E.`);
  });

  it("describes a pile of more than one DISTINCT object as 'a pile of N objects'", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(11, 10);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);
    // Two different kinds so floorCarry's stacking never merges them into
    // one pile entry (matching upstream's scan_distant_floor over distinct
    // objects, not a stacked quantity).
    floorCarry(state, grid, makeLight().obj);
    floorCarry(state, grid, makeFlask());
    const { text } = describeLookGrid(state, grid, TARGET.LOOK);
    expect(text).toBe("You see a pile of 2 objects, 0 N, 1 E.");
  });

  it("shows hallucination text over any non-player grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.timed[TMD.IMAGE] = 10;
    state.chunk.sqinfoOn(loc(15, 10), SQUARE.SEEN);
    const { text, mon } = describeLookGrid(state, loc(15, 10), TARGET.LOOK);
    expect(mon).toBeNull();
    expect(text).toBe("You see something strange, 0 N, 5 E.");
  });

  it("describes a memorized down staircase (an interesting feature)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, featureReg.byCodeName("MORE").fidx);
    squareMemorize(state, grid);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);
    const { text } = describeLookGrid(state, grid, TARGET.LOOK);
    expect(text).toBe("You see a down staircase, 0 N, 2 E.");
  });
});

describe("initTargetLoopUi / currentLoopGrid / useInterestingLoopMode", () => {
  it("starts on the player in interesting mode with no start grid given", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ui = initTargetLoopUi(state);
    expect(ui).toEqual({ x: 10, y: 10, showInteresting: true, targetIndex: 0, help: false });
  });

  it("honours a valid start grid in free mode", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ui = initTargetLoopUi(state, 14, 12);
    expect(ui.showInteresting).toBe(false);
    expect(ui.x).toBe(14);
    expect(ui.y).toBe(12);
  });

  it("cancels any existing target on init", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const m = addVisible(state, loc(11, 10));
    state.target.set = true;
    state.target.midx = m.midx;
    state.target.grid = m.grid;
    initTargetLoopUi(state);
    expect(targetIsSet(state)).toBe(false);
  });

  it("currentLoopGrid follows the interesting-list index; free mode follows x/y", () => {
    const targets = [loc(11, 10), loc(12, 10)];
    const ui = { x: 5, y: 5, showInteresting: true, targetIndex: 1, help: false };
    expect(currentLoopGrid(ui, targets)).toEqual(loc(12, 10));
    expect(useInterestingLoopMode(ui, targets)).toBe(true);

    const free = { ...ui, showInteresting: false };
    expect(currentLoopGrid(free, targets)).toEqual(loc(5, 5));
    expect(useInterestingLoopMode(free, targets)).toBe(false);
  });
});

describe("stepTargetLoop: cycling the interesting-grid list (space/+/-)", () => {
  it("cycles forward through targets in distance order, wrapping", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const near = addVisible(state, loc(12, 10));
    const mid = addVisible(state, loc(15, 10));
    const far = addVisible(state, loc(19, 10));
    const targets = targetGetMonsters(state, TARGET.KILL);
    expect(targets).toEqual([near.grid, mid.grid, far.grid]);

    let ui = initTargetLoopUi(state);
    let step = stepTargetLoop(state, targets, ui, " ");
    expect(step.bell).toBe(false);
    ui = step.ui;
    expect(currentLoopGrid(ui, targets)).toEqual(mid.grid);

    step = stepTargetLoop(state, targets, ui, "+");
    ui = step.ui;
    expect(currentLoopGrid(ui, targets)).toEqual(far.grid);

    // Wraps back to the nearest.
    step = stepTargetLoop(state, targets, ui, "*");
    ui = step.ui;
    expect(currentLoopGrid(ui, targets)).toEqual(near.grid);
  });

  it("cycles backward with '-', wrapping to the last entry", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(12, 10));
    const far = addVisible(state, loc(19, 10));
    const targets = targetGetMonsters(state, TARGET.KILL);
    const ui = initTargetLoopUi(state);
    const step = stepTargetLoop(state, targets, ui, "-");
    expect(currentLoopGrid(step.ui, targets)).toEqual(far.grid);
  });
});

describe("stepTargetLoop: free-cursor direction movement", () => {
  it("moves the free cursor by a keypad direction", () => {
    const state = makeState({ playerGrid: loc(10, 10), w: 40, h: 25 });
    let ui = initTargetLoopUi(state);
    ui = stepTargetLoop(state, [], ui, "o").ui; // free mode
    expect(ui.showInteresting).toBe(false);

    const step = stepTargetLoop(state, [], ui, "6"); // east
    expect(step.bell).toBe(false);
    expect(step.ui.x).toBe(11);
    expect(step.ui.y).toBe(10);
  });

  it("clamps the free cursor to 1 away from the map edge", () => {
    const state = makeState({ playerGrid: loc(1, 1), w: 40, h: 25 });
    let ui = initTargetLoopUi(state);
    ui = stepTargetLoop(state, [], ui, "o").ui;
    const step = stepTargetLoop(state, [], ui, "4"); // west, would go to x=0
    expect(step.ui.x).toBe(1);
  });

  it("targetDirAllow maps digits and arrows, and rejects anything else", () => {
    expect(targetDirAllow("8")).toBe(8);
    expect(targetDirAllow("ArrowUp")).toBe(8);
    expect(targetDirAllow("ArrowDown")).toBe(2);
    expect(targetDirAllow("ArrowLeft")).toBe(4);
    expect(targetDirAllow("ArrowRight")).toBe(6);
    expect(targetDirAllow("g")).toBe(0);
    expect(targetDirAllow("5")).toBe(5);
  });

  it("picks the nearest interesting grid in the pressed direction", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const north = addVisible(state, loc(10, 6));
    addVisible(state, loc(14, 10));
    const targets = targetGetMonsters(state, TARGET.KILL);
    const ui = initTargetLoopUi(state); // starts on the nearest target
    const step = stepTargetLoop(state, targets, ui, "8"); // north
    expect(step.bell).toBe(false);
    expect(currentLoopGrid(step.ui, targets)).toEqual(north.grid);
  });

  it("stays silent (no bell) when a direction finds no candidate", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(14, 10)); // only east
    const targets = targetGetMonsters(state, TARGET.KILL);
    const ui = initTargetLoopUi(state);
    const before = ui.targetIndex;
    const step = stepTargetLoop(state, targets, ui, "8"); // north: nothing there
    expect(step.bell).toBe(false);
    expect(step.ui.targetIndex).toBe(before);
  });

  it("bells on an unrecognized key", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ui = initTargetLoopUi(state);
    const step = stepTargetLoop(state, [], ui, "z");
    expect(step.bell).toBe(true);
    expect(step.done).toBe(false);
  });
});

describe("stepTargetLoop: selecting a target ('t'/'5'/'0'/'.')", () => {
  it("sets a monster target from interesting mode and finishes", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const m = addVisible(state, loc(14, 10));
    const targets = targetGetMonsters(state, TARGET.KILL);
    const ui = initTargetLoopUi(state);
    const step = stepTargetLoop(state, targets, ui, "t");
    expect(step.done).toBe(true);
    expect(step.bell).toBe(false);
    expect(targetIsSet(state)).toBe(true);
    expect(state.target.midx).toBe(m.midx);
    expect(state.target.grid).toEqual(m.grid);
  });

  it("bells and stays open when the cursor is on a non-target-able grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    // A hand-built "interesting" list pointing at an empty grid: never
    // target-able, so 't' should bell rather than crash or finish.
    const targets = [loc(14, 10)];
    const ui = initTargetLoopUi(state);
    const step = stepTargetLoop(state, targets, ui, "t");
    expect(step.done).toBe(false);
    expect(step.bell).toBe(true);
    expect(targetIsSet(state)).toBe(false);
  });

  it("free-mode location target: 'o' then a direction, then 't'", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    let ui = initTargetLoopUi(state);
    ui = stepTargetLoop(state, [], ui, "o").ui;
    ui = stepTargetLoop(state, [], ui, "6").ui; // step east onto an empty floor
    const step = stepTargetLoop(state, [], ui, "t");
    expect(step.done).toBe(true);
    expect(targetIsSet(state)).toBe(true);
    expect(state.target.midx).toBe(0);
    expect(state.target.grid).toEqual(loc(11, 10));
  });

  it("Escape/q cancel without setting a target", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ui = initTargetLoopUi(state);
    const step = stepTargetLoop(state, [], ui, "Escape");
    expect(step.done).toBe(true);
    expect(targetIsSet(state)).toBe(false);
  });
});

describe("stepTargetLoop: 'p' (focus player) and 'm' (back to interesting)", () => {
  it("'p' focuses the player and switches to free mode", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(14, 10));
    const targets = targetGetMonsters(state, TARGET.KILL);
    const ui = initTargetLoopUi(state);
    const step = stepTargetLoop(state, targets, ui, "p");
    expect(step.ui.showInteresting).toBe(false);
    expect(step.ui.x).toBe(10);
    expect(step.ui.y).toBe(10);
  });

  it("'m' switches back to interesting mode, picking the nearest to the cursor", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const m1 = addVisible(state, loc(20, 10));
    addVisible(state, loc(21, 10));
    const targets = targetGetMonsters(state, TARGET.KILL);
    let ui = initTargetLoopUi(state);
    ui = stepTargetLoop(state, targets, ui, "o").ui; // free mode, cursor stays on player
    ui = { ...ui, x: 19, y: 10 }; // move the free cursor near m1
    const step = stepTargetLoop(state, targets, ui, "m");
    expect(step.ui.showInteresting).toBe(true);
    expect(currentLoopGrid(step.ui, targets)).toEqual(m1.grid);
  });
});

describe("RNG invariance: the loop never draws from the game RNG", () => {
  it("leaves the RNG stream untouched across a full interaction", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(12, 10));
    addVisible(state, loc(10, 14));
    const before = state.rng.getState();

    let ui = initTargetLoopUi(state, 12, 8);
    const targets = targetGetMonsters(state, TARGET.KILL);
    for (const key of [" ", "-", "8", "o", "6", "p", "m", "?", "z", "t"]) {
      ui = stepTargetLoop(state, targets, ui, key).ui;
      describeLookGrid(state, currentLoopGrid(ui, targets), TARGET.KILL);
    }
    computePathColours(state, [loc(11, 10), loc(12, 10)]);

    expect(state.rng.getState()).toEqual(before);
  });
});

describe("computePathColours (draw_path colour rules)", () => {
  it("colours plain known floor white", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(11, 10);
    squareMemorize(state, grid);
    expect(computePathColours(state, [grid])).toEqual([COLOUR_WHITE]);
  });

  it("colours a visible, non-camouflaged monster red", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(11, 10);
    addVisible(state, grid);
    squareMemorize(state, grid);
    expect(computePathColours(state, [grid])).toEqual([COLOUR_L_RED]);
  });

  it("colours a known, non-projectable wall blue", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(11, 10);
    state.chunk.setFeat(grid, GRANITE);
    squareMemorize(state, grid);
    expect(computePathColours(state, [grid])).toEqual([COLOUR_BLUE]);
  });

  it("colours an unmemorized grid dark, and everything after it dark too", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const unknown = loc(11, 10);
    const knownFloor = loc(12, 10);
    squareMemorize(state, knownFloor); // memorized, but AFTER the unknown grid in path order
    expect(computePathColours(state, [unknown, knownFloor])).toEqual([
      COLOUR_L_DARK,
      COLOUR_L_DARK,
    ]);
  });
});

describe("harness fixture sanity", () => {
  it("open field is all floor", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    expect(state.chunk.feat(loc(11, 10))).toBe(FLOOR);
  });
});
