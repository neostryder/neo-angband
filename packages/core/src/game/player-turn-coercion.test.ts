/**
 * Locks gaps 2.3, 2.4 (melee flee message) and 2.10, ported from
 * reference/src (Angband 4.2.6):
 * - 2.3: energy_per_move (player-util.c:323-328) - extra moves make steps
 *   cheaper: energy * (1 + |num| - num) / (1 + |num|).
 * - 2.10: player_attack_random_monster (player-util.c:794-813) and the
 *   bloodlust command coercion that invokes it (cmd-core.c:371-374):
 *   randint0(200) < timed[TMD_BLOODLUST] hijacks an energy-capable command
 *   into "You angrily lash out at a nearby foe!".
 * - 2.4: the delayed "flees in terror" message after a frightening melee
 *   attack (player-attack.c:1023-1025).
 */
import { describe, expect, it } from "vitest";
import { MON_TMD, TMD } from "../generated";
import { loc } from "../loc";
import type { PlayerState } from "../player/calcs";
import {
  createDefaultRegistry,
  energyPerMove,
  playerAttackRandomMonster,
  processPlayer,
  walkAction,
} from "./player-turn";
import { addMon, makeRace, makeState } from "./harness";

describe("energy_per_move (player-util.c:323-328, gap 2.3)", () => {
  it("two extra moves cost a third of a turn per step", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.playerState = { numMoves: 2 } as unknown as PlayerState;
    /* (100 * (1 + 2 - 2)) / (1 + 2) = 33. */
    expect(energyPerMove(state)).toBe(33);
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(33);
  });

  it("negative num_moves makes steps slower", () => {
    const state = makeState();
    state.playerState = { numMoves: -1 } as unknown as PlayerState;
    /* (100 * (1 + 1 + 1)) / (1 + 1) = 150. */
    expect(energyPerMove(state)).toBe(150);
  });

  it("defaults to move_energy with no derived state", () => {
    const state = makeState();
    expect(energyPerMove(state)).toBe(state.z.moveEnergy);
  });
});

describe("player_attack_random_monster (player-util.c:794-813, gap 2.10)", () => {
  it("attacks an adjacent monster and reports the energy used", () => {
    const msgs: string[] = [];
    const state = makeState({ playerGrid: loc(15, 10) });
    state.msg = (t): void => {
      msgs.push(t);
    };
    const mon = addMon(state, makeRace({ ac: 0 }), loc(14, 10), { hp: 500 });
    state.rng.randFix(100); /* deterministic hit */

    const spent = playerAttackRandomMonster(state);
    expect(spent).toBeGreaterThan(0);
    expect(mon.hp).toBeLessThan(500);
    expect(msgs).toContain("You angrily lash out at a nearby foe!");
  });

  it("confused players get a free pass", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ ac: 0 }), loc(14, 10), { hp: 500 });
    state.actor.player.timed[TMD.CONFUSED] = 5;

    expect(playerAttackRandomMonster(state)).toBe(-1);
    expect(mon.hp).toBe(500);
  });

  it("returns -1 with no adjacent monster", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    expect(playerAttackRandomMonster(state)).toBe(-1);
  });
});

describe("bloodlust command coercion (cmd-core.c:371-374)", () => {
  it("hijacks an energy-capable command into a random attack", () => {
    const msgs: string[] = [];
    const state = makeState({
      playerGrid: loc(15, 10),
      commands: [{ code: "walk", dir: 6 }],
    });
    state.msg = (t): void => {
      msgs.push(t);
    };
    /* Monster to the WEST; the dropped command walked EAST. */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(14, 10), { hp: 500 });
    /* randint0(200) < 200 always coerces. */
    state.actor.player.timed[TMD.BLOODLUST] = 200;
    state.rng.randFix(100); /* deterministic hit */

    const res = processPlayer(state, createDefaultRegistry());
    expect(res.energyUsed).toBeGreaterThan(0);
    /* The walk was dropped: the player did not move east. */
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(mon.hp).toBeLessThan(500);
    expect(msgs).toContain("You angrily lash out at a nearby foe!");
  });

  it("a confused bloodlust player executes the command normally", () => {
    const state = makeState({
      playerGrid: loc(15, 10),
      commands: [{ code: "walk", dir: 6 }],
    });
    addMon(state, makeRace({ ac: 0 }), loc(14, 10), { hp: 500 });
    state.actor.player.timed[TMD.BLOODLUST] = 200;
    state.actor.player.timed[TMD.CONFUSED] = 5;

    processPlayer(state, createDefaultRegistry());
    /* player_attack_random_monster returned false: the walk ran. */
    expect(state.actor.grid).toEqual(loc(16, 10));
  });

  it("no coercion at zero bloodlust", () => {
    const state = makeState({
      playerGrid: loc(15, 10),
      commands: [{ code: "walk", dir: 6 }],
    });
    processPlayer(state, createDefaultRegistry());
    expect(state.actor.grid).toEqual(loc(16, 10));
  });
});

describe("delayed flee message (player-attack.c:1023-1025, gap 2.4)", () => {
  it("a frightening blow prints the flee line after the attack", () => {
    const msgs: string[] = [];
    const state = makeState({ playerGrid: loc(15, 10) });
    state.msg = (t): void => {
      msgs.push(t);
    };
    state.rng.randFix(100);
    /* 100/1000 hp: the surviving monster fails its low-hp fear save. */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 1000 });
    mon.hp = 100;

    walkAction(state, { code: "walk", dir: 6 });
    expect(mon.mTimed[MON_TMD.FEAR]).toBeGreaterThan(0);
    expect(msgs.some((m) => m.includes("flees in terror"))).toBe(true);
  });
});
