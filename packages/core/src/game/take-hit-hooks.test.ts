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
import { MON_TMD, MSG, PF, RF, SQUARE } from "../generated/index.js";
import { loc, locEq } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import { startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import type { GameState } from "./context.js";
import { movePlayer, updateMonsterDistances } from "./context.js";
import { monsterTurn } from "./monster-turn.js";
import { worldTakeHit } from "./world.js";

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

/**
 * THE ESCAPE THAT WORKED EVERYWHERE EXCEPT WHERE IT MATTERS.
 *
 * Reported from play: all four cheat options on, including "Cheat: Allow player
 * to avoid death", and a death that went straight to the tombstone with no
 * "Die?" prompt and no trip back to town.
 *
 * The cheat_live escape leaves the player ALIVE WITH NEGATIVE HP while
 * state.pendingDeath waits for the shell's get_check("Die? ") - that is how the
 * escape is spelled. monsterTurn then read `chp < 0` as death in its own right
 * and set state.isDead, and loopStop tests isDead BEFORE pendingDeath, so the
 * loop answered DEAD. Death by breath, trap or poison tick could be cheated;
 * death by a melee blow, which is how most characters in Angband die, could
 * not.
 *
 * This drives the REAL wired game - startGame, the real monBlowEnv, the real
 * monsterTurn - because the take_hit primitive and makeTakeHitHooks were both
 * already correct, and the existing melee test above calls env.takeHit()
 * directly, which is precisely the one step that skips the broken line.
 */
describe("cheat_live survives the commonest death in Angband: a melee blow", () => {
  /**
   * Stand the player next to `mon`, awake and looking.
   *
   * The player is MOVED to the monster rather than the monster to the player:
   * startGame's player placement can be a one-square pocket with eight walls
   * around it, so there is no guaranteed free grid beside the player, while a
   * monster the generator walked into place always has open ground around it.
   */
  function standBeside(state: GameState, mon: Monster): boolean {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ] as const) {
      const grid = loc(mon.grid.x + dx, mon.grid.y + dy);
      /*
       * "Can the player stand here", which is NOT square_isempty. This used to
       * call context.ts's squareIsEmpty, and that only worked because THAT
       * predicate was weaker than upstream's: passable / no monster / not the
       * player, which is exactly the question being asked here. Once it was
       * corrected (PORT_TODO 2.1) this loop started rejecting any neighbour
       * holding an object - common on a real generated level - and both tests in
       * this describe block failed on the setup rather than on the behaviour.
       * The question is spelled out inline so it cannot silently follow a
       * predicate it never meant to share.
       */
      if (!state.chunk.inBounds(grid)) continue;
      if (!state.chunk.isPassable(grid)) continue;
      if (state.chunk.mon(grid) !== 0) continue;
      if (locEq(grid, state.actor.grid)) continue;
      movePlayer(state, grid);
      mon.mTimed[MON_TMD.SLEEP] = 0;
      mon.mTimed[MON_TMD.FEAR] = 0;
      state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
      updateMonsterDistances(state);
      return true;
    }
    return false;
  }

  /** A real monster from a real level that has at least one blow to land. */
  function armedMonster(state: GameState): Monster | undefined {
    return state.monsters.find(
      (m, i): m is Monster =>
        i > 0 && !!m && m.race.blows.length > 0 && !m.race.flags.has(RF.NEVER_BLOW),
    );
  }

  it("waits for 'Die?' instead of killing, and cheating returns to town", () => {
    const { game, messages } = startCaptured(4244, 5);
    const state = game.state;
    state.options!.set("cheat_live", true);
    const p = state.actor.player;

    const mon = armedMonster(state);
    expect(mon, "the depth-5 level should contain a monster with blows").toBeTruthy();
    expect(standBeside(state, mon!), "no free square beside the monster").toBe(true);

    /* One hit point, so the first blow that connects is fatal. Several turns,
     * because a blow may miss - the assertion below proves one landed. */
    let armed = false;
    for (let turn = 0; turn < 40 && !armed; turn++) {
      p.chp = 1;
      state.isDead = false;
      monsterTurn(mon!, state);
      armed = state.pendingDeath !== undefined || state.isDead;
    }
    expect(armed, "40 turns beside a monster landed no fatal blow").toBe(true);

    /* THE ASSERTION. The blow was fatal, so the escape must be on offer. */
    expect(state.isDead).toBe(false);
    expect(state.pendingDeath?.killer).toBe(mon!.race.name);
    expect(p.chp).toBeLessThan(0);

    /* And answering "no" is wiz_cheat_death: full HP, back to the town. */
    state.pendingDeath!.resolve(false);
    expect(state.isDead).toBe(false);
    expect(p.chp).toBe(p.mhp);
    expect(state.targetDepth).toBe(0);
    expect(state.generateLevel).toBe(true);
    expect(messages.some((m) => m.includes("cheat death"))).toBe(true);
    /* wiz-debug.c L78: the killer's name is replaced on the way out, so the
     * character does not carry the name of a monster it did not die to. */
    expect(p.diedFrom).toBe("Cheating death");
  });

  it("without the option, the same blow is final", () => {
    /* The guard that makes the test above mean something: the setup is
     * identical apart from cheat_live, and here the character really dies. */
    const { game } = startCaptured(4244, 5);
    const state = game.state;
    expect(state.options!.get("cheat_live")).toBe(false);
    const p = state.actor.player;

    const mon = armedMonster(state);
    expect(standBeside(state, mon!)).toBe(true);

    for (let turn = 0; turn < 40 && !state.isDead; turn++) {
      if (!state.isDead) p.chp = 1;
      monsterTurn(mon!, state);
    }
    expect(state.isDead).toBe(true);
    expect(state.pendingDeath).toBeUndefined();
    expect(p.diedFrom).toBe(mon!.race.name);
  });
});

describe("PF_COMBAT_REGEN mana reward is wired into take_hit (audit 01 C1)", () => {
  it("a COMBAT_REGEN character gains rage-mana from a non-excluded hit", () => {
    const { game } = startCaptured(7007, 2);
    const p = game.state.actor.player;
    /* Grant the flag on the live derived state and give the caster mana room. */
    game.state.playerState!.pflags.on(PF.COMBAT_REGEN);
    p.msp = 20;
    p.csp = 0;
    p.cspFrac = 0;
    p.mhp = 100;
    p.chp = 100;

    worldTakeHit(game.state, 20, "a giant white mouse");

    expect(game.state.isDead).toBe(false);
    expect(p.csp).toBeGreaterThan(0); // sp_gain = (MAX(msp,10)*65536)/mhp*dam
  });

  it("no reward for poison / fatal wound / starvation killers", () => {
    const { game } = startCaptured(7007, 2);
    const p = game.state.actor.player;
    game.state.playerState!.pflags.on(PF.COMBAT_REGEN);
    p.msp = 20;
    p.csp = 0;
    p.cspFrac = 0;
    p.mhp = 100;
    p.chp = 100;

    worldTakeHit(game.state, 20, "poison");

    expect(p.csp).toBe(0);
  });
});
