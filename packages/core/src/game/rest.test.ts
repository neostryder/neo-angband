/**
 * do_cmd_rest (cmd-cave.c:1619-1669): the genuine multi-turn rest command.
 *
 * Before this, "rest" in the command registry was an alias for holdAction - one
 * turn per call, with state.resting never populated at all outside the web
 * shell's own bespoke driveRest loop. That meant every OTHER caller (an agent,
 * a headless harness, a mod) got a rest that never earned the x2
 * regenerate-while-resting bonus (player_resting_can_regenerate,
 * player-util.c:1461; loop.ts playerRestingCanRegenerate), because the bonus
 * reads state.resting.turnsRested and nothing was ever writing it.
 *
 * restAction (game/player-turn.ts) is a real port of do_cmd_rest: one call is
 * one game turn, and it re-queues its own continuation on state.cmdQueue -
 * exactly the same self-continuation shape runAction already uses for running
 * (player-path.ts) - so a caller who does not pause (a headless harness, an
 * agent, these tests) gets every turn of a whole rest for one initial command,
 * with disturb() (elsewhere) the only thing that can cut it short.
 */

import { describe, expect, it } from "vitest";
import { TMD } from "../generated/index.js";
import { makeState } from "./harness.js";
import type { GameState, PlayerCommand } from "./context.js";
import {
  REST_ALL_POINTS,
  REST_COMPLETE,
  REST_SOME_POINTS,
  playerIsResting,
} from "./context.js";
import { disturb } from "./player-path.js";
import { restAction } from "./player-turn.js";
import { playerRegenHp } from "./loop.js";
import { playerRestingCompleteSpecial } from "./world.js";

/**
 * Drive a rest to completion the way processPlayerChecked/runGameLoop would:
 * playerRestingCompleteSpecial before every queued continuation (upstream's
 * own order, game-world.c:936-937), then pop and run it. Returns the number of
 * turns actually taken (energy-spending calls to restAction).
 */
function driveRest(state: GameState, count: number): number {
  const first: PlayerCommand = { code: "rest", args: { count } };
  let turns = 0;
  if (restAction(state, first) > 0) turns++;

  let guard = 0;
  while (state.cmdQueue && state.cmdQueue.length > 0 && guard++ < 20000) {
    playerRestingCompleteSpecial(state);
    if (!state.cmdQueue || state.cmdQueue.length === 0) break;
    const cmd = state.cmdQueue.shift()!;
    if (restAction(state, cmd) > 0) turns++;
  }
  return turns;
}

describe("restAction: a timed rest", () => {
  it("takes exactly N turns via self-continuation, then stops", () => {
    const state = makeState();
    const turns = driveRest(state, 7);

    expect(turns).toBe(7);
    expect(playerIsResting(state), "resting must end when the count runs out").toBe(false);
    expect(state.resting).toBeUndefined();
  });

  it("bumps both rested counters once per turn", () => {
    const state = makeState();
    driveRest(state, 4);

    /* restingTurn (player->resting_turn, the lifetime character-sheet total)
     * survives the rest ending; turnsRested (the per-rest x2-regen gate) does
     * not, because it lives inside state.resting, which is deleted. */
    expect(state.restingTurn).toBe(4);
  });

  it("no count at all is a silent no-op (cmd_get_arg_choice not CMD_OK)", () => {
    const state = makeState();
    const used = restAction(state, { code: "rest" });
    expect(used).toBe(0);
    expect(state.resting).toBeUndefined();
  });

  it("only the three REST_ codes are valid negative counts", () => {
    const state = makeState();
    const used = restAction(state, { code: "rest", args: { count: -7 } });
    expect(used).toBe(0);
    expect(state.resting).toBeUndefined();
  });

  it("a count of 1 with nothing remembered is a no-op (player_resting_repeat_count starts at 0)", () => {
    const state = makeState();
    const used = restAction(state, { code: "rest", args: { count: 1 } });
    expect(used).toBe(0);
    expect(state.resting).toBeUndefined();
  });

  it("remembers a count > 1 so a later count === 1 repeats it", () => {
    const state = makeState();
    driveRest(state, 5);
    expect(state.restingTurn).toBe(5);

    const turns = driveRest(state, 1);
    expect(turns, "count 1 should have replayed the remembered 5").toBe(5);
    expect(state.restingTurn).toBe(10);
  });

  it("disturb() mid-rest empties the queued continuation and it never fires", () => {
    const state = makeState();
    const first: PlayerCommand = { code: "rest", args: { count: 100 } };
    restAction(state, first);
    expect(playerIsResting(state)).toBe(true);
    expect(state.cmdQueue?.length ?? 0).toBeGreaterThan(0);

    disturb(state);
    expect(state.resting).toBeUndefined();
    expect(state.cmdQueue?.length ?? 0).toBe(0);

    /* Nothing left to pop: a caller draining cmdQueue the way processPlayer
     * does simply stops here, exactly as upstream's stale queued CMD_REST does
     * nothing once player_rest_disturb has fired. */
  });
});

describe("restAction: the REST_ conditional modes", () => {
  it("REST_ALL_POINTS stops after exactly one turn once HP and SP are already full", () => {
    const state = makeState();
    state.actor.player.chp = state.actor.player.mhp;
    state.actor.player.csp = state.actor.player.msp;

    const turns = driveRest(state, REST_ALL_POINTS);
    expect(turns).toBe(1);
    expect(state.resting).toBeUndefined();
  });

  it("REST_SOME_POINTS stops as soon as EITHER HP or SP is full", () => {
    const state = makeState();
    state.actor.player.chp = state.actor.player.mhp; /* HP already full. */
    state.actor.player.csp = 0;
    state.actor.player.msp = 0; /* No SP pool at all: csp === msp too. */

    const turns = driveRest(state, REST_SOME_POINTS);
    expect(turns).toBe(1);
    expect(state.resting).toBeUndefined();
  });

  it("REST_COMPLETE keeps going while a bad status remains, even at full HP/SP", () => {
    const state = makeState();
    state.actor.player.chp = state.actor.player.mhp;
    state.actor.player.csp = state.actor.player.msp;
    state.actor.player.timed[TMD.CUT] = 5;

    const first: PlayerCommand = { code: "rest", args: { count: REST_COMPLETE } };
    restAction(state, first);
    playerRestingCompleteSpecial(state);
    /* Still resting: the cut has not healed, so REST_COMPLETE's own condition
     * (player-util.c:1504-1512) is not yet satisfied. */
    expect(playerIsResting(state)).toBe(true);

    state.actor.player.timed[TMD.CUT] = 0;
    playerRestingCompleteSpecial(state);
    expect(playerIsResting(state), "clearing the cut should let REST_COMPLETE end").toBe(false);
  });
});

describe("playerRestingCanRegenerate's effect (player-util.c:1461)", () => {
  /* Chosen so the doubling is exact after fixed-point truncation: food=800
   * (>= foodWeak) with foodValue=100 gives a fed bonus of trunc(8/3)=2, so
   * percent = trunc(197 * 102 / 100) = 200 (400 once doubled). mhp=1000 makes
   * hpGain 201442 / 401442 sixty-fifth-thousandths - which truncate to +3 hp
   * and +6 hp respectively in one call, an exact 2x with no rounding slop. */
  function primedPlayer(state: GameState): void {
    const p = state.actor.player;
    p.mhp = 1000;
    p.chp = 500;
    p.chpFrac = 0;
    p.timed[TMD.FOOD] = 800;
  }

  it("gives no bonus before turnsRested reaches REST_REQUIRED_FOR_REGEN", () => {
    const state = makeState();
    primedPlayer(state);
    state.resting = { count: 10, turnsRested: 4 };

    playerRegenHp(state);
    expect(state.actor.player.chp).toBe(503);
  });

  it("doubles the regen percent once turnsRested reaches the threshold", () => {
    const state = makeState();
    primedPlayer(state);
    state.resting = { count: 10, turnsRested: 5 };

    playerRegenHp(state);
    expect(state.actor.player.chp).toBe(506);
  });

  it("applies immediately for a conditional REST_ mode, no threshold needed", () => {
    const state = makeState();
    primedPlayer(state);
    state.resting = { count: REST_COMPLETE, turnsRested: 0 };

    playerRegenHp(state);
    expect(state.actor.player.chp).toBe(506);
  });

  it("gives no bonus at all when not resting", () => {
    const state = makeState();
    primedPlayer(state);

    playerRegenHp(state);
    expect(state.actor.player.chp).toBe(503);
  });
});
