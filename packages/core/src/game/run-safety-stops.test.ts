/**
 * The two run safety-stops of move_player, and the hold/rest split.
 *
 * These are behaviour tests for three of the twelve disturb() sites that had no
 * port (see game/disturb-census.test.ts for the census, and why a grep found
 * three wrong answers before it existed). They are the three whose absence a
 * player would feel most, and the third is here because I got it wrong once:
 *
 *  - `cmd-cave.c:1084-1088` - a run walks the player ONTO their own detected
 *    traps. The trap is known; nothing stopped.
 *  - `cmd-cave.c:1141-1152` - a run carries the player OUT of the detected-traps
 *    zone. That stop is the entire point of the DTrap indicator on the move side.
 *  - `cmd-cave.c:1580` vs `:1615` - do_cmd_hold picks things up and can walk into
 *    a shop; do_cmd_rest does neither. The port serves both from holdAction, and
 *    the obvious discriminator - `cmd.code === "hold"` - is WRONG, because the
 *    host's rest loop drives every rest turn by pushing `{ code: "hold" }`. A rest
 *    would have looted the floor under it and cancelled itself on a shop tile.
 */

import { describe, expect, it, vi } from "vitest";
import { loc } from "../loc.js";
import { SQUARE } from "../generated/index.js";
import { holdAction, walkAction } from "./player-turn.js";
import { featureReg, makeState } from "./harness.js";
import { FlagSet } from "../bitflag.js";
import { TRF_SIZE } from "../world/trap.js";
import { TRF } from "../generated/index.js";
import type { GameState } from "./context.js";

const HERE = loc(15, 10);
const EAST = loc(16, 10);

/** A running state: `running` positive, past the first step. */
function running(state: GameState): void {
  state.run = {
    curDir: 6,
    oldDir: 6,
    openArea: true,
    breakRight: false,
    breakLeft: false,
    running: 5,
    firstStep: false,
    stepCount: 0,
  };
}

function walkEast(state: GameState): number {
  return walkAction(state, { code: "walk", dir: 6, args: { fromRun: true } });
}

describe("a run stops in front of a known trap (cmd-cave.c:1084-1088)", () => {
  /**
   * A bare visible player trap, inserted straight into state.traps. The trap
   * SYSTEM is not what is under test - square_isdisarmabletrap is (TRF_TRAP +
   * TRF_VISIBLE, no disable timeout), and an unknown trap deliberately does NOT
   * stop a run, which is how running into an undetected one still happens.
   */
  function withTrapEast(): GameState {
    const state = makeState({ playerGrid: HERE });
    state.chunk.setFeat(EAST, featureReg.byCodeName("FLOOR").fidx);
    const flags = new FlagSet(TRF_SIZE);
    flags.on(TRF.TRAP);
    flags.on(TRF.VISIBLE);
    state.traps.set(EAST.y * state.chunk.width + EAST.x, [
      { tidx: 1, grid: EAST, power: 0, timeout: 0, flags } as never,
    ]);
    return state;
  }

  it("refuses the step and cancels the run", () => {
    const state = withTrapEast();
    running(state);

    const used = walkEast(state);

    expect(used, "the step must be refunded, not spent").toBe(0);
    expect(state.actor.grid).toEqual(HERE);
    expect(state.run?.running, "disturb() did not cancel the run").toBe(0);
  });

  it("does not stop a deliberate walk - only a run", () => {
    const state = withTrapEast();
    /* No run in progress: upstream's condition is `trap && running && !trapsafe`,
     * so a player who walks onto their own trap on purpose still may. */
    walkAction(state, { code: "walk", dir: 6 });

    expect(state.actor.grid).toEqual(EAST);
  });

  it("does not stop a run for an UNSEEN trap", () => {
    const state = withTrapEast();
    for (const t of state.traps.get(EAST.y * state.chunk.width + EAST.x) ?? []) {
      t.flags.off(TRF.VISIBLE);
    }
    running(state);

    walkEast(state);

    expect(state.actor.grid, "an undetected trap must not stop a run").toEqual(EAST);
  });
});

describe("a run stops at the edge of the detected-traps zone (cmd-cave.c:1141-1152)", () => {
  function atTheEdge(): GameState {
    const state = makeState({ playerGrid: HERE });
    state.chunk.setFeat(EAST, featureReg.byCodeName("FLOOR").fidx);
    /* Inside the zone, stepping out of it. */
    state.chunk.sqinfoOn(HERE, SQUARE.DTRAP);
    state.chunk.sqinfoOff(EAST, SQUARE.DTRAP);
    return state;
  }

  it("refuses the step and cancels the run", () => {
    const state = atTheEdge();
    running(state);

    const used = walkEast(state);

    expect(used).toBe(0);
    expect(state.actor.grid, "the player left the detected zone mid-run").toEqual(HERE);
    expect(state.run?.running).toBe(0);
  });

  it("lets a run that STARTED on the edge leave (running_firststep)", () => {
    const state = atTheEdge();
    running(state);
    state.run!.firstStep = true;

    walkEast(state);

    expect(state.actor.grid, "a run beginning on the edge must be able to start").toEqual(EAST);
  });

  it("does not stop a step further into the zone", () => {
    const state = atTheEdge();
    state.chunk.sqinfoOn(EAST, SQUARE.DTRAP);
    running(state);

    walkEast(state);

    expect(state.actor.grid).toEqual(EAST);
    expect(state.run?.running).toBeGreaterThan(0);
  });
});

describe("hold picks up, rest does not (cmd-cave.c:1580 vs :1615)", () => {
  it("a hold turn runs do_autopickup", () => {
    const state = makeState({ playerGrid: HERE });
    const picked = vi.fn(() => 0);
    state.autoPickup = picked;

    holdAction(state, { code: "hold" });

    expect(picked).toHaveBeenCalledOnce();
  });

  it("a REST turn does not, even though the host pushes code 'hold'", () => {
    const state = makeState({ playerGrid: HERE });
    const picked = vi.fn(() => 0);
    state.autoPickup = picked;
    /* Exactly what the host's rest loop does: state.resting set for the whole
     * rest, and each turn driven by a `hold` command. */
    state.resting = { count: 50, turnsRested: 0 };

    holdAction(state, { code: "hold" });

    expect(
      picked,
      "a rest looted the floor under the player - the code is not the discriminator",
    ).not.toHaveBeenCalled();
  });

  it("a rest is not cancelled by standing on a shop", () => {
    const state = makeState({ playerGrid: HERE });
    state.chunk.setFeat(HERE, featureReg.byCodeName("STORE_GENERAL").fidx);
    state.resting = { count: 50, turnsRested: 0 };

    holdAction(state, { code: "hold" });

    expect(state.resting, "resting on a shop tile cancelled itself").toBeDefined();
  });
});
