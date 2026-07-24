import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { MFLAG, MON_TMD, OF } from "../generated";
import { OF_SIZE, PF_SIZE } from "../player/types";
import type { PlayerState } from "../player/calcs";
import { MDESC, monsterDesc } from "../mon/desc";
import { loc } from "../loc";
import {
  ActionRegistry,
  attackMonster,
  createDefaultRegistry,
  descendAction,
  holdAction,
  processPlayer,
  walkAction,
} from "./player-turn";
import { GRANITE, addMon, makeRace, makeState } from "./harness";
import type { GameState, PlayerCommand } from "./context";

/** Give the player the OF_AFRAID flag, as calc_bonuses would when fear is up. */
function setAfraid(state: GameState): void {
  const flags = new FlagSet(OF_SIZE);
  flags.on(OF.AFRAID);
  state.playerState = {
    flags,
    pflags: new FlagSet(PF_SIZE),
    seeInfra: 0,
  } as unknown as PlayerState;
}

describe("built-in player actions", () => {
  it("walk steps onto a passable grid for move_energy and fires the FOV hook", () => {
    let fovCalls = 0;
    const state = makeState({
      playerGrid: loc(15, 10),
      updateFov: () => {
        fovCalls++;
      },
    });

    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(state.z.moveEnergy);
    expect(state.actor.grid).toEqual(loc(16, 10));
    expect(fovCalls).toBe(1);
  });

  it("walk into a wall spends no energy and does not move", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), GRANITE);

    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(0);
    expect(state.actor.grid).toEqual(loc(15, 10));
  });

  it("walk into a monster attacks it (py_attack)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.actor.combat.numBlows = 300; /* land several blows this turn */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 200 });

    const spent = walkAction(state, { code: "walk", dir: 6 });
    /* py_attack energy (player-attack.c:991,1017-1019): blow_energy =
     * 100 * move_energy / num_blows = 33; three blows fit a turn -> 99,
     * NOT a flat move_energy. */
    expect(spent).toBe(99);
    expect(mon.hp).toBeLessThan(200);
    /* The player did not step onto the monster's grid. */
    expect(state.actor.grid).toEqual(loc(15, 10));
  });

  it("walk into a camouflaged monster reveals it instead of attacking (move_player, cmd-cave.c L1071)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 200 });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mTimed[MON_TMD.SLEEP] = 20;

    let revealed: number | null = null;
    state.becomeAware = (m) => {
      revealed = m.midx;
    };

    const spent = walkAction(state, { code: "walk", dir: 6 });

    expect(spent).toBe(state.z.moveEnergy);
    expect(revealed).toBe(mon.midx);
    expect(mon.hp).toBe(200); // not attacked
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0); // monster_wake(mon, false, 100)
    expect(mon.mflag.has(MFLAG.AWARE)).toBe(true);
    /* The player did not step onto the monster's grid. */
    expect(state.actor.grid).toEqual(loc(15, 10));
  });

  it("afraid: walking into an obvious monster refuses (do_cmd_walk_test, cmd-cave.c L1215)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    setAfraid(state);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 30 });
    mon.mflag.on(MFLAG.VISIBLE); /* obvious = visible && !camouflaged */
    const msgs: string[] = [];
    state.msg = (t): void => {
      msgs.push(t);
    };

    const spent = walkAction(state, { code: "walk", dir: 6 });
    /* No attack, no move, no energy (energy is set only after the test passes). */
    expect(spent).toBe(0);
    expect(mon.hp).toBe(30);
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(msgs).toContain(`You are too afraid to attack ${monsterDesc(mon, MDESC.DEFAULT)}!`);
  });

  it("afraid: an invisible monster falls through to py_attack's own afraid branch", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    setAfraid(state);
    /* Not obvious (VISIBLE unset), so do_cmd_walk_test does not short-circuit. */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 30 });
    const afraidBlows: boolean[] = [];
    state.onMelee = (_m, result): void => {
      for (const b of result.blows) afraidBlows.push(b.verb === "afraid");
    };

    const spent = walkAction(state, { code: "walk", dir: 6 });
    /* py_attack ran (energy spent per blow) but every blow was refused by fear:
     * no damage, and each blow carries the "afraid" verb the shell renders. */
    expect(spent).toBeGreaterThan(0);
    expect(mon.hp).toBe(30);
    expect(afraidBlows.length).toBeGreaterThan(0);
    expect(afraidBlows.every((v) => v)).toBe(true);
  });

  it("afraid: attackMonster (open/tunnel-into-monster) refuses every blow", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    setAfraid(state);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 30 });
    mon.mflag.on(MFLAG.VISIBLE);
    let sawAfraid = false;
    state.onMelee = (_m, result): void => {
      if (result.blows.some((b) => b.verb === "afraid")) sawAfraid = true;
    };

    attackMonster(state, mon);
    expect(mon.hp).toBe(30);
    expect(sawAfraid).toBe(true);
  });

  it("not afraid: walking into an obvious monster still attacks normally", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 200 });
    mon.mflag.on(MFLAG.VISIBLE);

    walkAction(state, { code: "walk", dir: 6 });
    expect(mon.hp).toBeLessThan(200);
  });

  it("hold spends a turn in place; descend signals a level change", () => {
    const state = makeState();
    expect(holdAction(state, { code: "hold" })).toBe(state.z.moveEnergy);

    expect(descendAction(state, { code: "descend" })).toBe(state.z.moveEnergy);
    expect(state.generateLevel).toBe(true);
  });
});

describe("action registry dispatch", () => {
  it("dispatches a mod-added custom action and accounts its energy", () => {
    const reg = createDefaultRegistry();
    reg.register("smite", (s) => {
      s.actor.player.chp -= 7;
      return s.z.moveEnergy;
    });

    const commands: PlayerCommand[] = [{ code: "smite" }];
    const state = makeState({ commands });
    const startHp = state.actor.player.chp;

    const res = processPlayer(state, reg);
    expect(res.energyUsed).toBe(state.z.moveEnergy);
    expect(state.actor.player.chp).toBe(startHp - 7);
    expect(state.actor.totalEnergy).toBe(state.z.moveEnergy);
  });

  it("a mod can replace a built-in action", () => {
    const reg = createDefaultRegistry();
    let custom = 0;
    reg.register("walk", () => {
      custom++;
      return 42;
    });
    const state = makeState({ commands: [{ code: "walk", dir: 6 }] });

    const res = processPlayer(state, reg);
    expect(custom).toBe(1);
    expect(res.energyUsed).toBe(42);
  });

  it("drains free commands and then reports needsInput on an empty queue", () => {
    const reg = createDefaultRegistry();
    /* "look" is a deferred stub (0 energy), then the queue empties. */
    const state = makeState({ commands: [{ code: "look" }] });

    const res = processPlayer(state, reg);
    expect(res.needsInput).toBe(true);
    expect(res.energyUsed).toBe(0);
  });

  it("an empty registry falls back to the no-op stub", () => {
    const reg = new ActionRegistry();
    const state = makeState({ commands: [{ code: "anything" }] });
    const res = processPlayer(state, reg);
    expect(res.needsInput).toBe(true);
  });
});
