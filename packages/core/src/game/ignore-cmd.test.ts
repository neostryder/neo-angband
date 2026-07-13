import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { ITYPE, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { IGNORE, IgnoreSettings, ignoreItemOk } from "../obj/ignore";
import { invenCarry } from "./gear";
import { invenWield } from "./obj-cmd";
import { makeState } from "./harness";
import type { GameState } from "./context";
import { ignoreDropTargets } from "./ignore-cmd";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const reg = new ObjRegistry({
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
const constants = bindConstants(loadJson("constants"));

function kindByName(name: string, tval: number) {
  const k = reg.kinds.find((kk) => kk.name === name && kk.tval === tval);
  if (!k) throw new Error(`no kind named ${name} of tval ${tval}`);
  return k;
}

/**
 * A plain (non-ego, non-artifact) sword with the given to-dam. Each caller
 * uses a DIFFERENT kind name (Dagger / Tulwar / Rapier / Short Sword) so the
 * otherwise-identical fixtures do not stack-merge in the pack (equal-bonus
 * plain weapons of the SAME kind are mergeable, faithfully).
 */
function makeSword(rng: Rng, kindName: string, toD: number): GameObject {
  const obj = objectPrep(rng, reg, constants, kindByName(kindName, TV.SWORD), 0, "minimise");
  obj.toD = toD;
  return obj;
}

function carry(state: GameState, obj: GameObject): number {
  return invenCarry(state.gear, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
}

describe("ignoreDropTargets (obj-ignore.c ignore_drop L651, scan half)", () => {
  it("collects only currently-ignored, undecorated pack/equipment gear", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    state.isIgnored = (obj) => ignoreItemOk(obj, state.ignore, true);

    const rng = new Rng(9);
    const bad = carry(state, makeSword(rng, "& Dagger~", -3)); // ignored
    const good = carry(state, makeSword(rng, "& Tulwar~", 4)); // not ignored (GOOD tier)
    const badInscribed = makeSword(rng, "& Rapier~", -3);
    badInscribed.note = "!d";
    const inscribedHandle = carry(state, badInscribed); // ignored, but !d excludes it

    const wornHandle = carry(state, makeSword(rng, "& Short Sword~", -3));
    invenWield(state, wornHandle);

    const targets = ignoreDropTargets(state);
    const handles = targets.map((t) => t.handle);

    expect(handles).toContain(bad);
    expect(handles).toContain(wornHandle);
    expect(handles).not.toContain(good);
    expect(handles).not.toContain(inscribedHandle);

    const wornTarget = targets.find((t) => t.handle === wornHandle);
    expect(wornTarget?.equipped).toBe(true);
    const packTarget = targets.find((t) => t.handle === bad);
    expect(packTarget?.equipped).toBe(false);
  });

  it("excludes everything while unignoring is active", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.ALL;
    state.isIgnored = (obj) => ignoreItemOk(obj, state.ignore, true);
    carry(state, makeSword(new Rng(3), "& Dagger~", -3));

    state.ignore.unignoring = true;
    expect(ignoreDropTargets(state)).toHaveLength(0);
  });

  it("draws no randomness from the state's rng", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    state.isIgnored = (obj) => ignoreItemOk(obj, state.ignore, true);
    carry(state, makeSword(state.rng, "& Dagger~", -3));
    carry(state, makeSword(state.rng, "& Tulwar~", 4));

    const before = JSON.stringify(state.rng.getState());
    ignoreDropTargets(state);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });
});
