import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { floorCarry, floorPile } from "./floor";
import { gearGet, invenCarry } from "./gear";
import type { GameState } from "./context";
import {
  autoPickupOkay,
  checkForInscrip,
  checkForInscripWithInt,
  doAutopickup,
  installPickup,
  playerPickupGold,
  playerPickupItem,
} from "./pickup";
import type { PickupDeps } from "./pickup";
import { createDefaultRegistry, processPlayer } from "./player-turn";
import { makeState } from "./harness";
import { OptionState } from "../player/options";

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
const deps: PickupDeps = { constants };

function makeObj(tval: number, nth = 0): GameObject {
  const kinds = reg.kinds.filter(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  const kind = kinds[nth];
  if (!kind) throw new Error(`no ordinary kind #${nth} for tval ${tval}`);
  return objectPrep(new Rng(9), reg, constants, kind, 0, "average");
}

function makeGold(pval: number): GameObject {
  const g = makeObj(TV.GOLD);
  g.pval = pval;
  return g;
}

/** Put an object on the player's grid. */
function underfoot(state: GameState, obj: GameObject): GameObject {
  expect(floorCarry(state, state.actor.grid, obj)).toBe(true);
  return obj;
}

describe("inscription checks (obj-util.c)", () => {
  it("counts occurrences and parses =g<n>", () => {
    const obj = makeObj(TV.POTION);
    obj.note = "=g5!g=g";
    expect(checkForInscrip(obj, "=g")).toBe(2);
    expect(checkForInscrip(obj, "!g")).toBe(1);
    const withInt = checkForInscripWithInt(obj, "=g");
    expect(withInt.count).toBe(1);
    expect(withInt.value).toBe(5);
  });
});

describe("playerPickupGold (cmd-pickup.c player_pickup_gold)", () => {
  it("collects all gold underfoot into the purse", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeGold(120));
    underfoot(state, makeObj(TV.POTION));
    const before = state.actor.player.au;

    let reported = 0;
    const total = playerPickupGold(state, {
      onGold: (t): void => {
        reported = t;
      },
    });
    expect(total).toBe(120);
    expect(reported).toBe(120);
    expect(state.actor.player.au).toBe(before + 120);
    /* The potion stays; the gold is gone. */
    expect(floorPile(state, loc(5, 5)).length).toBe(1);
  });
});

describe("autoPickupOkay (cmd-pickup.c auto_pickup_okay)", () => {
  it("does not auto-pick a plain object by default", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
  });

  it("pickup_always picks anything carryable", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    expect(
      autoPickupOkay(state, obj, { constants, env: { pickupAlways: true } }),
    ).toBe(obj.number);
  });

  it("reads pickup_always from the wired option store when env omits it", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    /* No env override: without a store, the shipped default (off) refuses. */
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
    /* Install an option store with pickup_always on: the seam consults it. */
    state.options = new OptionState({ overrides: { pickup_always: true } });
    expect(autoPickupOkay(state, obj, deps)).toBe(obj.number);
  });

  it("!g always refuses, even with pickup inscriptions", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    obj.note = "=g!g";
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
  });

  it("=g forces pickup", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    obj.note = "=g";
    expect(autoPickupOkay(state, obj, deps)).toBe(obj.number);
  });

  it("pickup_inven picks an object matching a pack stack", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const inPack = makeObj(TV.POTION);
    invenCarry(state.gear, inPack, {
      quiverSlotSize: constants.quiverSlotSize,
      thrownQuiverMult: constants.thrownQuiverMult,
    });
    const obj = underfoot(state, makeObj(TV.POTION));
    expect(autoPickupOkay(state, obj, deps)).toBe(obj.number);
  });

  it("=g<n> caps pickup by the count already in the pack", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const inPack = makeObj(TV.POTION);
    inPack.number = 3;
    inPack.note = "=g4";
    invenCarry(state.gear, inPack, {
      quiverSlotSize: constants.quiverSlotSize,
      thrownQuiverMult: constants.thrownQuiverMult,
    });
    const obj = underfoot(state, makeObj(TV.POTION));
    obj.number = 5;
    /* 4 wanted, 3 held -> only 1 more. */
    expect(autoPickupOkay(state, obj, deps)).toBe(1);
    inPack.number = 4;
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
  });
});

describe("doAutopickup / playerPickupItem", () => {
  it("autopickup takes gold and =g items, leaves the rest", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeGold(50));
    const wanted = underfoot(state, makeObj(TV.POTION, 0));
    wanted.note = "=g";
    underfoot(state, makeObj(TV.POTION, 1));

    const picked = doAutopickup(state, deps);
    expect(picked).toBe(1);
    expect(state.actor.player.au).toBeGreaterThan(0);
    const left = floorPile(state, loc(5, 5));
    expect(left.length).toBe(1);
    expect(left[0]!.note).toBeNull();
    /* The wanted potion is now a pack stack. */
    const inPack = state.gear.pack
      .map((h) => gearGet(state.gear, h))
      .find((o) => o === wanted);
    expect(inPack).toBe(wanted);
  });

  it("'g' picks up the single object underfoot", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    const picked = playerPickupItem(state, null, deps);
    expect(picked).toBe(1);
    expect(floorPile(state, loc(5, 5)).length).toBe(0);
    expect(obj.grid).toBeNull();
  });

  it("the chooseItem menu seam selects among several objects", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.POTION, 0));
    const sword = underfoot(state, makeObj(TV.SWORD));
    const picked = playerPickupItem(state, null, {
      constants,
      env: { chooseItem: (list) => list.find((o) => o.tval === TV.SWORD) ?? null },
    });
    expect(picked).toBe(1);
    expect(floorPile(state, loc(5, 5)).some((o) => o === sword)).toBe(false);
  });

  it("the registered pickup command charges move_energy / 10 per object", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.POTION));
    const registry = createDefaultRegistry();
    installPickup(state, registry, deps);

    state.nextCommand = (): { code: string } | null => ({ code: "pickup" });
    const startEnergy = state.actor.energy;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(Math.trunc(state.z.moveEnergy / 10));
    expect(state.actor.energy).toBe(startEnergy - result.energyUsed);
  });

  it("stepping onto a pile auto-collects gold (walk wiring)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    floorCarry(state, loc(6, 5), makeGold(75));
    const registry = createDefaultRegistry();
    installPickup(state, registry, deps);

    const commands = [{ code: "walk", dir: 6 }];
    state.nextCommand = (): { code: string; dir?: number } | null =>
      commands.shift() ?? null;
    processPlayer(state, registry);
    expect(state.actor.grid).toEqual(loc(6, 5));
    expect(state.actor.player.au).toBe(75);
    expect(floorPile(state, loc(6, 5)).length).toBe(0);
  });

  it("picking up an artifact fires state.onArtifactFound (object_touch)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const art = reg.artifacts.find((a) => a?.name === "of Galadriel")!;
    const obj = underfoot(state, makeObj(TV.LIGHT, 0));
    obj.artifact = art;

    let seen: typeof art | null = null;
    state.onArtifactFound = (a): void => {
      seen = a;
    };
    const picked = playerPickupItem(state, null, deps);
    expect(picked).toBe(1);
    expect(seen).toBe(art);
  });

  it("picking up a non-artifact does NOT fire onArtifactFound", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.POTION));
    let fired = false;
    state.onArtifactFound = (): void => {
      fired = true;
    };
    playerPickupItem(state, null, deps);
    expect(fired).toBe(false);
  });
});
