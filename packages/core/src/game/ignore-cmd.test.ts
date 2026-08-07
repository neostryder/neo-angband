import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { ITYPE, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { IGNORE, IgnoreSettings, ignoreItemOk } from "../obj/ignore.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { gearGet, invenCarry } from "./gear.js";
import { invenWield } from "./obj-cmd.js";
import { objectKnownView } from "./describe.js";
import { makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { ignoreDropTargets } from "./ignore-cmd.js";

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

/**
 * Learn everything about `obj`, so ignore_level_of grades it by its combat
 * bonuses rather than returning IGNORE_MAX (obj-ignore.c:489 - the good / bad /
 * average tiers are behind object_fully_known).
 *
 * This is not decoration: a Dagger carries OF_THROWING, whose id-type is "on
 * wield" (object_property.txt:740-744), so an un-wielded one is NOT fully known
 * and upstream will not quality-ignore it at any threshold below IGNORE_ALL.
 * These tests are about the drop pass, so they identify their fixtures rather
 * than test the knowledge gate; the gate has its own tests in obj/ignore.test.ts.
 */
function identify(state: GameState, obj: GameObject): GameObject {
  obj.notice |= OBJ_NOTICE.ASSESSED;
  for (const flag of obj.flags) state.actor.player.objKnown.flags.on(flag);
  return obj;
}

function carry(state: GameState, obj: GameObject): number {
  return invenCarry(state.gear, state.actor.player, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
}

describe("ignoreDropTargets (obj-ignore.c ignore_drop L651, scan half)", () => {
  it("collects only currently-ignored, undecorated pack/equipment gear", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    state.isIgnored = (obj) =>
      ignoreItemOk(obj, objectKnownView(state, obj), state.ignore, true);

    const rng = new Rng(9);
    const bad = carry(state, identify(state, makeSword(rng, "& Dagger~", -3))); // ignored
    const good = carry(state, identify(state, makeSword(rng, "& Tulwar~", 4))); // not ignored (GOOD tier)
    const badInscribed = identify(state, makeSword(rng, "& Rapier~", -3));
    badInscribed.note = "!d";
    const inscribedHandle = carry(state, badInscribed); // ignored, but !d excludes it

    const wornHandle = carry(state, identify(state, makeSword(rng, "& Short Sword~", -3)));
    invenWield(state, wornHandle, constants);

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

  /**
   * The gate the drop pass inherits, exercised through the wire session/game.ts
   * actually installs rather than through obj/ignore.ts directly. Before the
   * known-twin fix this pair was indistinguishable: ignoreLevelOf read the live
   * object, so the game auto-dropped an unidentified weapon for a to-dam the
   * player had no way to see.
   */
  it("leaves an UNIDENTIFIED bad weapon alone, and takes its identified twin", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    state.isIgnored = (obj) =>
      ignoreItemOk(obj, objectKnownView(state, obj), state.ignore, true);

    const rng = new Rng(11);
    const unknown = carry(state, makeSword(rng, "& Dagger~", -3));
    expect(ignoreDropTargets(state).map((t) => t.handle)).not.toContain(unknown);

    /* Same object, same -3: only the knowledge changes. */
    identify(state, gearGet(state.gear, unknown)!);
    expect(ignoreDropTargets(state).map((t) => t.handle)).toContain(unknown);
  });

  it("excludes everything while unignoring is active", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.ALL;
    state.isIgnored = (obj) =>
      ignoreItemOk(obj, objectKnownView(state, obj), state.ignore, true);
    carry(state, makeSword(new Rng(3), "& Dagger~", -3));

    state.ignore.unignoring = true;
    expect(ignoreDropTargets(state)).toHaveLength(0);
  });

  it("draws no randomness from the state's rng", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    state.isIgnored = (obj) =>
      ignoreItemOk(obj, objectKnownView(state, obj), state.ignore, true);
    carry(state, identify(state, makeSword(state.rng, "& Dagger~", -3)));
    carry(state, identify(state, makeSword(state.rng, "& Tulwar~", 4)));

    const before = JSON.stringify(state.rng.getState());
    ignoreDropTargets(state);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });
});
