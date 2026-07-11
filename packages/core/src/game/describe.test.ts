import { describe, expect, it } from "vitest";
import { TV } from "../generated";
import { FlagSet } from "../bitflag";
import { ODESC } from "../obj/desc";
import { objectNew } from "../obj/object";
import { OBJ_NOTICE } from "../obj/knowledge";
import { KF_SIZE } from "../obj/types";
import type { ObjectKind } from "../obj/types";
import type { Artifact } from "../obj/types";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";
import { makeState } from "./harness";
import { describeObject } from "./describe";

function rv(base = 0) {
  return { base, dice: 0, sides: 0, mBonus: 0 };
}

let kidx = 1;
function makeKind(name: string, tval: number, over: Partial<ObjectKind> = {}): ObjectKind {
  return {
    kidx: kidx++,
    tval,
    sval: 1,
    name,
    dChar: "?",
    dAttr: "w",
    cost: 10,
    dd: 0,
    ds: 0,
    ac: 0,
    toH: rv(0),
    kindFlags: new FlagSet(KF_SIZE),
    ...over,
  } as unknown as ObjectKind;
}

function makeObj(kind: ObjectKind, over: Partial<GameObject> = {}): GameObject {
  const obj = objectNew(kind);
  obj.tval = kind.tval; /* object_prep sets this; objectNew leaves 0. */
  obj.sval = kind.sval;
  obj.number = 1;
  return Object.assign(obj, over);
}

/** A game state where nothing is known (blank objKnown, no flavor awareness). */
function freshState(): GameState {
  return makeState();
}

describe("describeObject / object_desc (obj-desc.c L607)", () => {
  it("applies the &/~ plural grammar and the number prefix", () => {
    const state = freshState();
    const kind = makeKind("& Ration~ of Food", TV.FOOD);
    const one = makeObj(kind, { number: 1 });
    const many = makeObj(kind, { number: 5 });
    expect(describeObject(state, one, ODESC.PREFIX | ODESC.FULL)).toBe(
      "a Ration of Food",
    );
    expect(describeObject(state, many, ODESC.PREFIX | ODESC.FULL)).toBe(
      "5 Rations of Food",
    );
  });

  it("hides combat bonuses until their runes are known", () => {
    const state = freshState();
    const kind = makeKind("& Dagger~", TV.SWORD, { dd: 1, ds: 4 });
    const obj = makeObj(kind, {
      toH: 5,
      toD: 3,
      notice: OBJ_NOTICE.ASSESSED,
    });

    /* Blank knowledge: the +to_h,+to_d rune is unknown, so no (+5,+3). */
    const hidden = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
    expect(hidden).not.toContain("+5");

    /* Learn the combat runes: the bonuses now show. */
    state.actor.player.objKnown.toH = 1;
    state.actor.player.objKnown.toD = 1;
    const shown = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
    expect(shown).toContain("+5,+3");
  });

  it("does not leak a flavoured kind's identity while unaware", () => {
    const state = freshState();
    const kind = makeKind("& Potion~ of Cure Light Wounds", TV.POTION);
    const obj = makeObj(kind);
    const name = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
    /* Unaware -> generic base ("a Potion"), never the real kind name. */
    expect(name).toBe("a Potion");
    expect(name).not.toContain("Cure Light Wounds");
  });

  it("reveals an artifact's name on touch (assessed), not before", () => {
    const state = freshState();
    const kind = makeKind("& Ring~", TV.RING);
    const artifact = { name: "of Power" } as Artifact;

    /* Not yet touched (unassessed): artifact-ness is unknown -> "a Ring". */
    const untouched = makeObj(kind, { artifact, notice: 0 });
    const hidden = describeObject(state, untouched, ODESC.PREFIX | ODESC.FULL);
    expect(hidden).not.toContain("of Power");

    /* Touched (assessed): object_touch reveals the artifact name even before
     * its powers are learned - exactly as upstream. */
    const touched = makeObj(kind, { artifact, notice: OBJ_NOTICE.ASSESSED });
    const shown = describeObject(state, touched, ODESC.PREFIX | ODESC.FULL);
    expect(shown).toContain("of Power");
    expect(shown.startsWith("the ")).toBe(true);
  });
});
