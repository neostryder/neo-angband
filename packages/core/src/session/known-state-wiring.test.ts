/**
 * PORT_TODO 2.6: p->known_state exists on a real game, and it is a SECOND
 * derive rather than an alias of the first.
 *
 * A wiring test on a booted game, because the failure mode is a seam nothing
 * fills. calcBonuses' `known_only` gate has its own unit tests (player/
 * bonuses.test.ts) and the view it reads has its own (obj/known-object.test.ts);
 * neither would notice if refreshDerived stopped calling the second derive, or
 * if the seed at the end of wireGame were removed and every display read the
 * real state until the player next changed a ring.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, OF } from "../generated/index.js";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  obj: {
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
  } as GamePack["obj"],
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

describe("p->known_state on a booted game (PORT_TODO 2.6)", () => {
  it("is present before anything has changed", () => {
    const { state } = startGame(pack, { seed: 11, depth: 1 });
    /* Seeded at the end of wireGame. Without that line it would be undefined
     * until the first equipment change, and every reader would silently answer
     * "nothing known" (lore) or keep the birth combat state (the panels). */
    expect(state.knownPlayerState).toBeDefined();
    expect(state.actor.knownCombat).toBeDefined();
  });

  it("is a separate object from p->state, refreshed together with it", () => {
    const { state } = startGame(pack, { seed: 11, depth: 1 });
    expect(state.knownPlayerState).not.toBe(state.playerState);

    const beforeReal = state.playerState;
    const beforeKnown = state.knownPlayerState;
    state.updateBonuses?.();
    expect(state.playerState).not.toBe(beforeReal);
    expect(
      state.knownPlayerState,
      "calc_bonuses(p, &known_state, TRUE, TRUE) runs on every update_bonuses",
    ).not.toBe(beforeKnown);
  });

  it("hides an unlearned resist from the known state and not from the real one", () => {
    const { state } = startGame(pack, { seed: 11, depth: 1 });
    const p = state.actor.player;

    /* Put a fire resist on a worn item without teaching the rune. Every worn
     * slot is walked by the same loop, so the first non-empty one will do. */
    const wornHandle = p.equipment.find((h) => h) ?? 0;
    const worn = state.gear.store.get(wornHandle);
    expect(worn, "fixture: the birth kit equips something").toBeDefined();
    worn!.elInfo[ELEM.FIRE]!.resLevel = 1;
    worn!.flags.on(OF.FEATHER);
    p.objKnown.elInfo[ELEM.FIRE]!.resLevel = 0;
    p.objKnown.flags.off(OF.FEATHER);

    state.updateBonuses?.();
    expect(state.playerState?.elInfo[ELEM.FIRE]?.resLevel).toBe(1);
    expect(state.playerState?.flags.has(OF.FEATHER)).toBe(true);
    expect(state.knownPlayerState?.elInfo[ELEM.FIRE]?.resLevel).toBe(0);
    expect(state.knownPlayerState?.flags.has(OF.FEATHER)).toBe(false);

    /* Learn both runes and the two states agree again - the control, without
     * which "they differ" could just mean the known derive is broken. */
    p.objKnown.elInfo[ELEM.FIRE]!.resLevel = 1;
    p.objKnown.flags.on(OF.FEATHER);
    state.updateBonuses?.();
    expect(state.knownPlayerState?.elInfo[ELEM.FIRE]?.resLevel).toBe(1);
    expect(state.knownPlayerState?.flags.has(OF.FEATHER)).toBe(true);
  });

  it("actor.knownCombat is the KNOWN derive's combat view", () => {
    const { state } = startGame(pack, { seed: 11, depth: 1 });
    const p = state.actor.player;
    const wornHandle = p.equipment.find((h) => h) ?? 0;
    const worn = state.gear.store.get(wornHandle);
    expect(worn, "fixture: the birth kit equips something").toBeDefined();

    /*
     * to_a is granted at birth (player-birth.c:1265) so it never hides in a
     * real game - taking it away here is the only way to make the two combat
     * views disagree, and disagreeing is the only way to prove which one the
     * panels read. The display sides are asserted in game/display.test.ts and
     * game/char-sheet.test.ts; this asserts the value they read is derived.
     */
    worn!.toA = 7;
    p.objKnown.toA = 0;
    /*
     * TWICE, and the second call is the one that matters. refreshDerived
     * computes the known state BEFORE it reassigns actor.combat, so a mutant
     * that writes `knownCombat = state.actor.combat` stores the PREVIOUS
     * turn's object - and after a single call that stale object happens to
     * hold the pre-+7 value, which is the right answer for the wrong reason.
     * It survived the first version of this test.
     */
    state.updateBonuses?.();
    state.updateBonuses?.();

    expect(state.actor.knownCombat).not.toBe(state.actor.combat);
    expect(state.actor.combat.toA - state.actor.knownCombat.toA).toBe(7);

    p.objKnown.toA = 1;
    state.updateBonuses?.();
    state.updateBonuses?.();
    expect(state.actor.knownCombat.toA).toBe(state.actor.combat.toA);
  });
});
