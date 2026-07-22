/**
 * Regression guard for audit 03 KN-03 HIGH / KN-04 MED: the cross-object
 * rune-learn awareness sweep (obj-knowledge.c update_player_object_knowledge,
 * L1218) was UNWIRED. Upstream re-runs player_know_object over every carried and
 * floor object on EVERY rune learn (player_learn_rune tail-calls it at L1373),
 * which fires object_flavor_aware for a jewel whose non-curse runes are all now
 * known (L1163-1167) and prints the "You have %s (%c)." / "On the ground: %s."
 * reveal (L1184-1198). The port learned runes at the wield / equip-defend paths
 * but never ran the sweep, so wielding e.g. a Ring of Strength learned its STR
 * modifier rune yet left the KIND unaware - it kept the flavour name and base
 * pricing.
 *
 * These drive the REAL wired game (startGame) through the live wield command
 * (game/obj-cmd.ts invenWield), not the sweep in isolation - the finding was
 * that the primitive worked but nothing connected it to the learn sites.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "../session/game";
import type { GamePack, StartedGame } from "../session/game";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind } from "../obj/types";
import { objectNew, tvalIsJewelry } from "../obj/object";
import { OBJ_MOD } from "../generated";
import { OBJ_NOTICE } from "../obj/knowledge";
import { gearAdd } from "./gear";
import { floorCarry } from "./floor";
import { squareKnowPile } from "./known";
import { invenWield } from "./obj-cmd";
import { describeObject } from "./describe";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const objPack = {
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

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  quest: loadRecords("quest"),
  store: loadRecords("store"),
  obj: objPack as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

const reg = new ObjRegistry(objPack);

/** The flavoured "Ring of Strength" kind from the pack (there is also a potion
 * named "Strength", so gate on jewelry). */
function ringOfStrengthKind(): ObjectKind {
  const ring = reg.kinds.find(
    (kk) => kk.name === "Strength" && tvalIsJewelry(kk.tval),
  );
  if (!ring) throw new Error("no Ring of Strength kind in pack");
  return ring;
}

/**
 * A ring whose ONLY non-curse rune is the STR modifier, so wielding (which
 * learns that rune) completes its non-curse runes and makes the kind aware. We
 * deliberately do not copy the kind's SUST_STR flag: it would just be a second
 * rune to learn and is not needed to exercise the sweep.
 */
function mkStrRing(kind: ObjectKind) {
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.weight = kind.weight;
  obj.number = 1;
  obj.notice = 0;
  obj.modifiers[OBJ_MOD.STR] = 3;
  return obj;
}

function start(seed: number, depth: number): StartedGame {
  return startGame(pack, { seed, depth, className: "Warrior" });
}

/** Put an object in the pack under a fresh handle, returning that handle. */
function carry(game: StartedGame, obj: ReturnType<typeof mkStrRing>): number {
  const handle = gearAdd(game.state.gear, obj);
  game.state.gear.pack.push(handle);
  return handle;
}

describe("update_player_object_knowledge sweep is wired (audit 03 KN-03/KN-04)", () => {
  it("wielding a Ring of Strength makes the kind flavour-aware and names it", () => {
    const game = start(6301, 2);
    const kind = ringOfStrengthKind();
    const ring = mkStrRing(kind);
    const handle = carry(game, ring);
    ring.notice |= OBJ_NOTICE.ASSESSED; // as pickup/object_touch would set.

    /* Before: the kind is unidentified, so no "of Strength" name. */
    expect(game.state.isAware!(kind)).toBe(false);
    expect(describeObject(game.state, ring)).not.toContain("Strength");

    const msgs: string[] = [];
    game.state.msg = (t) => msgs.push(t);

    const slot = invenWield(game.state, handle);
    expect(slot).toBeGreaterThanOrEqual(0);

    /* After: the wield learned the STR rune, and the sweep made the kind aware. */
    expect(game.state.isAware!(kind)).toBe(true);
    expect(describeObject(game.state, ring)).toContain("Strength");
    /* KN-04: the reveal reported the newly-named carried object. */
    expect(msgs.some((m) => /^You have .*Strength.* \(.\)\.$/.test(m))).toBe(true);
  });

  it("does nothing for an unassessed ring (player_know_object L1033 gate)", () => {
    const game = start(6302, 2);
    const kind = ringOfStrengthKind();
    const ring = mkStrRing(kind);
    const handle = carry(game, ring);
    /* NOT assessed: the ID gate must hold, so no awareness even after wield. */

    invenWield(game.state, handle);
    expect(game.state.isAware!(kind)).toBe(false);
  });

  it("propagates awareness to a same-kind ring lying on the floor", () => {
    const game = start(6303, 2);
    const kind = ringOfStrengthKind();

    /* A ring on the player's own grid, assessed via the live touch path. */
    const floorRing = mkStrRing(kind);
    floorRing.notice |= OBJ_NOTICE.ASSESSED;
    floorCarry(game.state, game.state.actor.grid, floorRing);
    squareKnowPile(game.state, game.state.actor.grid);
    expect(game.state.isAware!(kind)).toBe(false);

    /* A second ring of the same kind in the pack, which we wield. */
    const wornRing = mkStrRing(kind);
    wornRing.notice |= OBJ_NOTICE.ASSESSED;
    const handle = carry(game, wornRing);

    const msgs: string[] = [];
    game.state.msg = (t) => msgs.push(t);
    invenWield(game.state, handle);

    /* The kind is aware, so the floor ring is now named too, and the floor
     * instance won the first-reveal report (swept before gear, L1223<L1229). */
    expect(game.state.isAware!(kind)).toBe(true);
    expect(describeObject(game.state, floorRing)).toContain("Strength");
    expect(msgs.some((m) => /^On the ground: .*Strength.*\.$/.test(m))).toBe(true);
  });
});
