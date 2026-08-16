/**
 * player_inc_check's equip-learn side effects reach the INTERPRETER path.
 *
 * Upstream's non-lore branch runs equip_learn_flag / equip_learn_element
 * unconditionally (player-timed.c:945, :967, :985) - the source does not matter,
 * so a trap you are immune to or a potion you shrug off teaches the rune just
 * as a monster's blow does. Only game/mon-cast.ts ever supplied incHooks, so
 * every effect that went through the interpreter (traps, potions, wands, player
 * spells) learned nothing.
 *
 * The hooks are reached through the same envDeps wireGame builds, so this reads
 * them off the booted game rather than trusting a stub.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import { ELEM, OF, PF } from "../generated/index.js";

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

describe("the interpreter path carries player_inc_check's learn hooks", () => {
  it("wireGame supplies incHooks on envDeps", () => {
    const game = startGame(pack, { seed: 88, depth: 2 });
    const hooks = game.wizardBundles.effect?.envDeps?.incHooks;
    /* The defect was "declared, consumed, never supplied on this path", so the
     * presence check IS the regression test. The behavioural half follows. */
    expect(hooks, "envDeps.incHooks is supplied").toBeDefined();
    expect(typeof hooks?.equipLearnFlag).toBe("function");
    expect(typeof hooks?.equipLearnElement).toBe("function");
  });

  it("they are the real equip_learn calls, and carry NO monster source", () => {
    const game = startGame(pack, { seed: 88, depth: 2 });
    const hooks = game.wizardBundles.effect!.envDeps!.incHooks!;
    const p = game.state.actor.player;

    /* A trap or a potion is not cave->mon_current, so update_smart_learn and
     * "You resist the effect!" must stay silent on this path. */
    expect(hooks.monsterSource).toBeUndefined();
    expect(hooks.updateSmartLearn).toBeUndefined();
    expect(hooks.resistMessage).toBeUndefined();

    /* Equip something carrying a flag, then let the hook learn it. Ground truth
     * first: unknown before, and the item really does carry it. */
    const worn = game.state.actor.player.equipment.find((h) => h) ?? 0;
    const obj = worn ? game.state.gear.store.get(worn) : undefined;
    expect(obj, "fixture: the player starts with something equipped").toBeDefined();
    obj!.flags.on(OF.FREE_ACT);
    expect(p.objKnown.flags.has(OF.FREE_ACT)).toBe(false);

    hooks.equipLearnFlag!("FREE_ACT");
    expect(p.objKnown.flags.has(OF.FREE_ACT)).toBe(true);

    /* The element half, which had no update_smart_learn fallback anywhere. */
    const el = obj!.elInfo[ELEM.FIRE];
    expect(el, "fixture: the object has element info").toBeDefined();
    el!.resLevel = 1;
    expect(p.objKnown.elInfo[ELEM.FIRE]?.resLevel ?? 0).toBe(0);

    hooks.equipLearnElement!("FIRE");
    expect(p.objKnown.elInfo[ELEM.FIRE]?.resLevel ?? 0).toBeGreaterThan(0);
  });
});

describe("player_set_timed's notify suppression is supplied (player-timed.c:828)", () => {
  /**
   * "Don't mention effects which already match the known player state" was
   * IMPLEMENTED (player/timed.ts:319-336) and supplied by nothing but tests, so
   * it never fired. The source comment even named a supplier - and named the
   * wrong one: makeIncCheckQueries builds a different interface entirely.
   */
  it("wireGame supplies notifyQueries on envDeps", () => {
    const game = startGame(pack, { seed: 91, depth: 2 });
    const q = game.wizardBundles.effect?.envDeps?.notifyQueries;
    expect(q, "envDeps.notifyQueries is supplied").toBeDefined();
    for (const k of ["knownResist", "isImmune", "knownFlag", "hasFlagNotTimed"]) {
      expect(typeof (q as unknown as Record<string, unknown>)[k]).toBe("function");
    }
  });

  it("the world clock carries it too", () => {
    const game = startGame(pack, { seed: 91, depth: 2 });
    expect(game.state.world?.timedHooks?.notifyQueries).toBeDefined();
  });

  it("hasFlagNotTimed is player_flags UNION worn gear, and excludes timers", () => {
    const game = startGame(pack, { seed: 91, depth: 2 });
    const q = game.wizardBundles.effect!.envDeps!.notifyQueries!;
    const p = game.state.actor.player;

    /* A flag from neither race/class nor gear reads false... */
    const worn = p.equipment.find((h) => h) ?? 0;
    const obj = worn ? game.state.gear.store.get(worn) : undefined;
    expect(obj, "fixture: the player starts with something equipped").toBeDefined();
    obj!.flags.off(OF.FEATHER);
    expect(q.hasFlagNotTimed(OF.FEATHER)).toBe(false);

    /* ...and true once WORN gear carries it (player_of_has_not_timed's union). */
    obj!.flags.on(OF.FEATHER);
    expect(q.hasFlagNotTimed(OF.FEATHER)).toBe(true);

    /* The player_flags half. NO shipped class carries an OF_ flag - class.txt
     * has only player-flags - so race.flags and playerFlags agree for every
     * stock character EXCEPT through one path: PF_BRAVERY_30 promotes to
     * OF_PROT_FEAR at level 30 (player.c:296-299), and only playerFlags applies
     * it. That is the single case that can tell this apart from a race-only
     * read, so it is the one worth asserting. */
    obj!.flags.off(OF.PROT_FEAR);
    const brave =
      p.race.pflags.has(PF.BRAVERY_30) || p.cls.pflags.has(PF.BRAVERY_30);
    expect(brave, "fixture: a BRAVERY_30 character (Warrior)").toBe(true);

    p.lev = 29;
    expect(q.hasFlagNotTimed(OF.PROT_FEAR), "not yet at level 29").toBe(false);
    p.lev = 30;
    expect(q.hasFlagNotTimed(OF.PROT_FEAR), "granted at level 30").toBe(true);

    /* The "not_timed" half needs no case: the implementation reads playerFlags
     * plus the worn slots and never touches p.timed, so there is no timed path
     * to exclude. Asserting one would be a test of absence the code cannot
     * fail. */
  });
});
