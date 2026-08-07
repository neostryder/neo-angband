import { describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import { FlagSet } from "../bitflag.js";
import { ODESC } from "../obj/desc.js";
import { objectNew } from "../obj/object.js";
import { FlavorKnowledge, OBJ_NOTICE } from "../obj/knowledge.js";
import { ignoreItemOk } from "../obj/ignore.js";
import { KF_SIZE } from "../obj/types.js";
import type { ObjectKind } from "../obj/types.js";
import type { Artifact } from "../obj/types.js";
import type { GameObject } from "../obj/object.js";
import type { GameState } from "./context.js";
import { makeState } from "./harness.js";
import { describeObject, objectKnownView } from "./describe.js";

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

  it("shows combat bonuses from birth, and hides them only if the rune is cleared", () => {
    const state = freshState();
    const kind = makeKind("& Dagger~", TV.SWORD, { dd: 1, ds: 4 });
    const obj = makeObj(kind, {
      toH: 5,
      toD: 3,
      notice: OBJ_NOTICE.ASSESSED,
    });

    /* Combat runes are known from birth (do_cmd_accept_character, player-birth.c
     * L1264-1267), so the +to_h,+to_d show even on an unidentified item. */
    const shown = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
    expect(shown).toContain("+5,+3");

    /* The gating machinery is still real: clear the runes and the bonuses
     * vanish (the known-shadow multiplies each bonus by obj_k->to_h/to_d). */
    state.actor.player.objKnown.toH = 0;
    state.actor.player.objKnown.toD = 0;
    const hidden = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
    expect(hidden).not.toContain("+5");
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

/*
 * PORT_TODO 3.27. Two slots in obj_desc_inscrip (obj-desc.c:527, :536-538)
 * that object_desc has always had and knownDescOf never filled, even though
 * both suppliers were live: FlavorKnowledge.setTried is called on every device
 * use and is saved with the character, and ignoreItemOk drives pickup,
 * running and projection through state.isIgnored.
 *
 * The fixtures wire the REAL producers - a FlavorKnowledge the game's own
 * setTried marks, and state.isIgnored built exactly as session/game.ts:618
 * builds it - so these assert the wiring, not a stand-in for it.
 */
describe("the {tried} and {ignore} markers (PORT_TODO 3.27)", () => {
  function withFlavor(state: GameState): FlavorKnowledge {
    const flavor = new FlavorKnowledge(10_000);
    state.flavorKnown = flavor;
    state.isAware = (kind) => flavor.isAware(kind);
    return flavor;
  }

  it("marks an unaware kind {tried} once it has been used, and not before", () => {
    const state = freshState();
    const flavor = withFlavor(state);
    const kind = makeKind("& Wand~ of Nothing", TV.WAND);
    const obj = makeObj(kind, { number: 1, pval: 3 });

    expect(describeObject(state, obj)).not.toContain("{tried}");
    flavor.setTried(kind); /* object_flavor_tried, as a device use calls it */
    expect(describeObject(state, obj)).toContain("{tried}");
  });

  it("drops {tried} once the kind becomes aware, as the !aware gate requires", () => {
    const state = freshState();
    const flavor = withFlavor(state);
    const kind = makeKind("& Wand~ of Nothing", TV.WAND);
    const obj = makeObj(kind, { number: 1, pval: 3 });
    flavor.setTried(kind);
    expect(describeObject(state, obj)).toContain("{tried}");

    flavor.setAware(kind);
    expect(describeObject(state, obj)).not.toContain("{tried}");
  });

  it("marks an ignored item {ignore}, and stops while the player is unignoring", () => {
    const state = freshState();
    const flavor = withFlavor(state);
    const kind = makeKind("& Ration~ of Food", TV.FOOD);
    const obj = makeObj(kind, { number: 1 });
    /* The one binding session/game.ts installs. */
    state.isIgnored = (o) =>
      ignoreItemOk(o, objectKnownView(state, o), state.ignore, flavor.isAware(o.kind));

    expect(describeObject(state, obj)).not.toContain("{ignore}");

    /* object_is_ignored's first route: OBJ_NOTICE_IGNORE on the object. */
    obj.notice |= OBJ_NOTICE.IGNORE;
    expect(describeObject(state, obj)).toContain("{ignore}");

    /* p->unignoring suppresses it (obj-ignore.c:624). */
    state.ignore.unignoring = true;
    expect(describeObject(state, obj)).not.toContain("{ignore}");
  });

  it("keeps both markers out when no supplier is bound (worldless)", () => {
    const state = freshState();
    const kind = makeKind("& Wand~ of Nothing", TV.WAND);
    const obj = makeObj(kind, { number: 1, pval: 3 });
    obj.notice |= OBJ_NOTICE.IGNORE;
    const name = describeObject(state, obj);
    expect(name).not.toContain("{tried}");
    expect(name).not.toContain("{ignore}");
  });
});
