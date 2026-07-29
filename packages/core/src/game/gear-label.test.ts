/**
 * The letter a message quotes must be the letter the pack listing shows.
 *
 * Reported by Aaron, 2026-07-28: "I picked up a scroll and was shown that it was
 * placed in slot i, but when I went to read it, it was in slot e. A torch was in
 * i." Both halves of that were true, because the port had two different orderings
 * and read the wrong one for the message:
 *
 *   - gear.pack is the master gear list (upstream p->gear): raw insertion order.
 *   - gear.inven is the LISTING (upstream p->upkeep->inven[]): earlier_object
 *     order, rebuilt by calc_inventory, and what every inventory display walks.
 *
 * gear_to_label reads the listing (obj-gear.c L462-466). All three of the port's
 * copies read the pack. A scroll appended to the pack behind a torch and a few
 * other things therefore announced its RAW index while the picker showed its
 * SORTED one - and the torch that sorted into the raw index owned the letter the
 * message had just named.
 *
 * These tests fix the invariant rather than the symptom: whatever the pack order,
 * the letter in the message is the letter of the row in the listing.
 */

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
import { floorCarry } from "./floor";
import { GEAR_LABELS, calcInventory, gearToLabel, invenCarry } from "./gear";
import { playerPickupItem } from "./pickup";
import type { PickupDeps } from "./pickup";
import { makeState } from "./harness";
import type { GameState } from "./context";

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

function makeObj(tval: number): GameObject {
  const kind = reg.kinds.find((k) => k.tval === tval);
  if (!kind) throw new Error(`no kind with tval ${tval}`);
  return objectPrep(new Rng(11), reg, constants, kind, 0, "average");
}

function carry(state: GameState, obj: GameObject): number {
  const h = invenCarry(state.gear, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
  calcInventory(state.gear, constants);
  return h;
}

/** The letters the pack LISTING shows, in order: what a player reads on screen. */
function listingLabels(state: GameState): Map<number, string> {
  const out = new Map<number, string>();
  (state.gear.inven ?? []).forEach((h, i) => out.set(h, GEAR_LABELS[i]!));
  return out;
}

const deps = (state: GameState, onPickup: (m: string) => void): PickupDeps => ({
  constants,
  refreshInventory: () => calcInventory(state.gear, constants),
  env: { onPickup },
});

describe("gear_to_label reads the listing, not the storage order", () => {
  it("labels every held object exactly as the listing does", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Insert in an order the listing will NOT preserve: earlier_object sorts by
     * tval among other things, so a sword inserted first sorts behind consumables. */
    for (const tval of [TV.SWORD, TV.LIGHT, TV.SCROLL, TV.POTION, TV.FOOD]) {
      carry(state, makeObj(tval));
    }

    const listing = listingLabels(state);
    expect(listing.size).toBe(5);
    for (const [handle, expected] of listing) {
      expect(gearToLabel(state.gear, handle)).toBe(expected);
    }
    /* And the two orderings really do differ here - otherwise this proves nothing. */
    expect(state.gear.inven).not.toEqual(state.gear.pack);
  });

  it("the pickup message quotes the letter the item is actually at", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Aaron's pack, in the shape that produced the wrong letter: a handful of
     * things carried first, then a scroll picked up off the floor. */
    for (const tval of [TV.SWORD, TV.SOFT_ARMOR, TV.LIGHT, TV.POTION, TV.FOOD]) {
      carry(state, makeObj(tval));
    }

    const scroll = makeObj(TV.SCROLL);
    scroll.number = 1;
    floorCarry(state, loc(5, 5), scroll);

    let msg = "";
    playerPickupItem(state, null, deps(state, (m) => (msg = m)));

    const quoted = /\(([a-zA-Z0-9])\)\.$/.exec(msg)?.[1];
    expect(quoted, `message was ${JSON.stringify(msg)}`).toBeDefined();

    /* Find the scroll in the listing and demand the same letter. */
    const listing = listingLabels(state);
    const scrollHandle = [...listing.keys()].find(
      (h) => state.gear.store.get(h)?.tval === TV.SCROLL,
    );
    expect(scrollHandle).toBeDefined();
    expect(quoted).toBe(listing.get(scrollHandle!));

    /* The bug's signature: the letter the message used must not belong to some
     * OTHER item. Before the fix the scroll was announced at the torch's letter. */
    const atQuoted = (state.gear.inven ?? [])[GEAR_LABELS.indexOf(quoted!)];
    expect(state.gear.store.get(atQuoted!)?.tval).toBe(TV.SCROLL);
  });

  it("refreshes the listing before the message, not after the command", () => {
    /* The timing half. inven_carry sets PU_INVEN and calls update_stuff four
     * lines above its own message (obj-gear.c L889-893); with the refresh left to
     * the command layer, the letter named the pre-pickup listing. Without a
     * refreshInventory the label is empty rather than wrong - an honest absence,
     * which is the deliberate choice in gearToLabel. */
    const state = makeState({ playerGrid: loc(5, 5) });
    carry(state, makeObj(TV.POTION));
    const scroll = makeObj(TV.SCROLL);
    floorCarry(state, loc(5, 5), scroll);

    let msg = "";
    playerPickupItem(state, null, { constants, env: { onPickup: (m) => (msg = m) } });
    expect(msg).not.toMatch(/\([a-zA-Z0-9]\)\.$/);

    /* With it wired, as the session wires it, the letter is there and correct. */
    const state2 = makeState({ playerGrid: loc(5, 5) });
    carry(state2, makeObj(TV.POTION));
    floorCarry(state2, loc(5, 5), makeObj(TV.SCROLL));
    let msg2 = "";
    playerPickupItem(state2, null, deps(state2, (m) => (msg2 = m)));
    const quoted = /\(([a-zA-Z0-9])\)\.$/.exec(msg2)?.[1];
    const listing = listingLabels(state2);
    const scrollHandle = [...listing.keys()].find(
      (h) => state2.gear.store.get(h)?.tval === TV.SCROLL,
    );
    expect(quoted).toBe(listing.get(scrollHandle!));
  });

  it("prefers a quiver digit over a listing letter, as upstream does", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const arrow = makeObj(TV.ARROW);
    arrow.number = 10;
    const h = carry(state, arrow);
    /* calc_inventory routed it into the quiver, so I2D wins (obj-gear.c L455-460). */
    expect(state.gear.quiver?.[0]).toBe(h);
    expect(gearToLabel(state.gear, h)).toBe("0");
  });

  it("gives an unheld handle no letter at all", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    expect(gearToLabel(state.gear, 9999)).toBe("");
  });
});
