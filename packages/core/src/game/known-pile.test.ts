/**
 * The remembered floor PILE (PORT_TODO 2.9).
 *
 * The port stored ONE memory per grid. Upstream keeps a shadow object per
 * remembered object in `player->cave`, and three things read that list:
 * map_info's object loop (cave-map.c:155-169), object_list_collect
 * (obj-list.c:167), and forget_remembered_objects (cave-square.c:1104).
 *
 * With one memory per grid none of them could be faithful, and the two
 * consumers papered over it by reading the LIVE pile instead - which is a
 * knowledge leak, because the live pile is the level, not what the player
 * knows about it.
 */
import { describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import type { GameObject } from "../obj/object.js";
import type { GameState } from "./context.js";
import { makeState } from "./harness.js";
import { knownObject, squareKnowPile, squareSensePile } from "./known.js";
import { objectListCollect } from "./obj-list.js";

let nextKidx = 1;

/** A floor object with just enough on it for map_info and the object list. */
function makeObj(name: string, tval = 80): GameObject {
  const kind = { name, dChar: ",", dAttr: "w", cost: 3, kidx: nextKidx++ };
  return {
    kind,
    tval,
    sval: 1,
    number: 1,
    artifact: null,
    notice: 0,
    grid: null,
  } as unknown as GameObject;
}

/** Drop `obj` on the live floor at `at`. */
function drop(state: GameState, at: Loc, obj: GameObject): GameObject {
  const idx = at.y * state.chunk.width + at.x;
  obj.grid = at;
  const pile = state.floor.get(idx) ?? [];
  pile.push(obj);
  state.floor.set(idx, pile);
  return obj;
}

const NAMES = (state: GameState): string[] =>
  objectListCollect(state).entries.map((e) =>
    e.object ? (e.object.kind as { name: string }).name : "<unknown>",
  );

describe("object_list_collect reports knowledge, not the level", () => {
  it("an object dropped out of view is NOT listed", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(20, 20);
    /* The player saw a ration here. */
    drop(state, g, makeObj("Ration of Food"));
    squareKnowPile(state, g);

    /* A monster then drops a sword here, far away and out of view: no
     * square_know_pile fires, so the shadow pile still holds one object. */
    drop(state, g, makeObj("Long Sword"));

    /* This listed the sword the moment it landed - the `[` screen announced
     * loot nobody had witnessed. */
    expect(NAMES(state)).toEqual(["Ration of Food"]);
  });

  it("an object taken out of view is STILL listed, until the grid is re-seen", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(20, 20);
    const ration = drop(state, g, makeObj("Ration of Food"));
    squareKnowPile(state, g);

    /* Something picks it up while the player is elsewhere. */
    state.floor.set(20 * state.chunk.width + 20, []);
    expect(NAMES(state)).toEqual(["Ration of Food"]);

    /* Looking again is what corrects the memory - forget_remembered_objects. */
    squareKnowPile(state, g);
    expect(NAMES(state)).toEqual([]);
    expect(knownObject(state, g)).toBeNull();
    void ration;
  });

  it("every object of a seen pile gets its own row", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    drop(state, g, makeObj("Ration of Food"));
    drop(state, g, makeObj("Long Sword"));
    squareKnowPile(state, g);

    expect(NAMES(state)).toEqual(["Ration of Food", "Long Sword"]);
  });
});

describe("map_info's object loop (cave-map.c:155-169)", () => {
  it("sets multiple_objects for a remembered pile of two", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    const first = drop(state, g, makeObj("Ration of Food"));
    drop(state, g, makeObj("Long Sword"));
    squareKnowPile(state, g);

    const mem = knownObject(state, g);
    /* first_kind is the FIRST displayable object, and multiple_objects is what
     * makes ui-map.c:216 draw the `<pile>` glyph instead of that object's. The
     * port could not express this at all, which is why ObjRegistry.pileKind
     * was bound and read by nothing. */
    expect(mem).toEqual({ seen: true, kidx: first.kind.kidx, multiple: true });
  });

  it("one remembered object is not a pile", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    const only = drop(state, g, makeObj("Ration of Food"));
    squareKnowPile(state, g);

    expect(knownObject(state, g)).toEqual({
      seen: true,
      kidx: only.kind.kidx,
      multiple: false,
    });
  });

  it("an ignored item on top falls through to the one under it", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    const junk = drop(state, g, makeObj("Broken Sword"));
    const wanted = drop(state, g, makeObj("Ration of Food"));
    squareKnowPile(state, g);
    state.isIgnored = (o) => o === junk;

    /* "Item stays hidden" (cave-map.c:162) SKIPS the entry - it does not
     * consume the first_kind slot and it does not blank the grid. */
    const mem = knownObject(state, g);
    expect(mem).toEqual({ seen: true, kidx: wanted.kind.kidx, multiple: false });
  });

  it("a grid whose every remembered object is ignored draws nothing", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    drop(state, g, makeObj("Broken Sword"));
    squareKnowPile(state, g);
    state.isIgnored = () => true;

    expect(knownObject(state, g)).toBeNull();
  });

  it("a sensed marker outranks an exact memory on the same grid", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    drop(state, g, makeObj("Ration of Food"));
    squareKnowPile(state, g);
    /* Detection turns up something else here that the player cannot see. */
    const hidden = drop(state, g, makeObj("Long Sword"));
    squareSensePile(state, g, (o) => o === hidden);

    /* ui-map.c:200-212 tests unseen_money and unseen_object BEFORE first_kind,
     * so the red star wins over the ration's glyph. */
    expect(knownObject(state, g)).toEqual({ seen: false, money: false });
  });

  it("sensed money takes the gold star over the item star", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    drop(state, g, makeObj("gold", TV.GOLD));
    squareSensePile(state, g);

    const mem = knownObject(state, g);
    expect(mem).not.toBeNull();
    expect(mem!.seen).toBe(false);
    expect((mem as { money: boolean }).money).toBe(true);
  });

  it("seeing a sensed pile upgrades the marker to the real kind", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    const obj = drop(state, g, makeObj("Ration of Food"));
    squareSensePile(state, g);
    expect(knownObject(state, g)).toEqual({ seen: false, money: false });

    squareKnowPile(state, g);
    expect(knownObject(state, g)).toEqual({
      seen: true,
      kidx: obj.kind.kidx,
      multiple: false,
    });
  });

  it("sensing a pile already SEEN does not downgrade it back to a star", () => {
    /* object_sense's guard: it only acts when the object has no twin on this
     * grid (obj-knowledge.c:869-870). */
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    const obj = drop(state, g, makeObj("Ration of Food"));
    squareKnowPile(state, g);
    squareSensePile(state, g);

    expect(knownObject(state, g)).toEqual({
      seen: true,
      kidx: obj.kind.kidx,
      multiple: false,
    });
  });
});

describe("forget_remembered_objects respects the predicate", () => {
  it("a know of one class does not clear another class's memory", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const g = loc(12, 9);
    const sword = drop(state, g, makeObj("Long Sword", 23));
    const ration = drop(state, g, makeObj("Ration of Food", 80));
    squareKnowPile(state, g);

    /* Both are gone from the level, but the player only looks for swords. */
    state.floor.set(9 * state.chunk.width + 12, []);
    squareKnowPile(state, g, (o) => o.tval === 23);

    /* Upstream excises only entries whose ORIGINAL matches the predicate, so
     * the ration is still remembered. The port used to drop the whole grid the
     * moment the live pile went empty, whatever the predicate said. */
    const pile = state.known.objects.get(9 * state.chunk.width + 12);
    expect(pile?.map((e) => e.obj)).toEqual([ration]);
    void sword;
  });
});
