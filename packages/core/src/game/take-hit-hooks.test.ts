/**
 * Regression guard for audit 01 P1 CRITICAL: death by a monster blow, a
 * projection, an effect or a damage-over-time tick must NOT be silent, and it
 * must record the killer. Before the shared TakeHitHooks were wired at every
 * take_hit site, the projection and effect paths passed no death hook, so
 * p->died_from stayed empty (every death scored as "the dungeon") and the
 * "You die." line never printed.
 *
 * These tests drive a REAL wired game (startGame), not the take_hit primitive
 * or the makeTakeHitHooks factory in isolation - the whole point of the finding
 * was that the primitive worked but was not connected. They exercise two live
 * paths that hang off the same shared hooks object: the monster-melee env
 * (state.monBlowEnv) and the world clock (worldTakeHit, used by poison / lava /
 * over-exertion).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MSG } from "../generated";
import { startGame } from "../session/game";
import type { GamePack, StartedGame } from "../session/game";
import { worldTakeHit } from "./world";

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
  quest: loadRecords("quest"),
  store: loadRecords("store"),
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

/** Start a game and hook its message + sound sinks for capture. */
function startCaptured(seed: number, depth: number): {
  game: StartedGame;
  messages: string[];
  sounds: number[];
} {
  const game = startGame(pack, { seed, depth, className: "Warrior" });
  const messages: string[] = [];
  const sounds: number[] = [];
  game.state.msg = (t: string): void => {
    messages.push(t);
  };
  game.state.sound = (code: number): void => {
    sounds.push(code);
  };
  return { game, messages, sounds };
}

describe("take_hit consequences are wired into the live game (audit 01 P1)", () => {
  it("a fatal world-clock hit (poison/lava) records died_from and shows 'You die.'", () => {
    const { game, messages, sounds } = startCaptured(4242, 3);
    const p = game.state.actor.player;
    p.totalWinner = true; // prove death clears it
    p.diedFrom = ""; // prove death records it

    worldTakeHit(game.state, 9999, "a fatal wound");

    expect(game.state.isDead).toBe(true);
    expect(p.diedFrom).toBe("a fatal wound");
    expect(p.totalWinner).toBe(false);
    expect(messages).toContain("You die.");
    expect(sounds).toContain(MSG.DEATH);
  });

  it("a non-fatal blow below the warning threshold rings the bell and warns", () => {
    const { game, messages, sounds } = startCaptured(4243, 3);
    const p = game.state.actor.player;
    p.chp = p.mhp; // full health, so oldChp > warning

    /* Drop to exactly 0: not < 0 (alive), but below the (mhp*3/10) warning. */
    worldTakeHit(game.state, p.mhp, "a giant white louse");

    expect(game.state.isDead).toBe(false);
    expect(messages).toContain("*** LOW HITPOINT WARNING! ***");
    expect(sounds).toContain(MSG.BELL);
    expect(sounds).toContain(MSG.HITPOINT_WARN);
  });

  it("a fatal monster melee blow records the monster as the killer", () => {
    const { game } = startCaptured(4244, 5);
    const state = game.state;
    /* Any live monster from the generated level; only its identity is needed. */
    const mon = state.monsters.find((m, i) => i > 0 && !!m);
    expect(mon, "the depth-5 level should contain a monster").toBeTruthy();

    const env = state.monBlowEnv!(mon!);
    env.takeHit(9999);

    expect(state.isDead).toBe(true);
    expect(state.actor.player.diedFrom).toBe(mon!.race.name);
  });
});
