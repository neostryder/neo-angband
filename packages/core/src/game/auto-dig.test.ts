/**
 * QoL auto-dig (the bundled `qol` mod, flag "qol.autoDig"), ported from
 * AIngband's do_cmd_movement_tunnel_test / move_player change. Walking into
 * known diggable terrain the player can dig begins one tunnel attempt instead
 * of the faithful no-energy bump. Gated so core is byte-identical when the flag
 * is off (no mod / turned off in the Fixes & tweaks menu).
 */

import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { SKILL } from "../player/types";
import { walkAction } from "./player-turn";
import { movementAutoDig, movementTunnelTest } from "./cave-cmd";
import { squareMemorize } from "./known";
import { featureReg, makeState, GRANITE } from "./harness";
import type { GameState } from "./context";

const RUBBLE = featureReg.byCodeName("RUBBLE").fidx;
const PERM = featureReg.byCodeName("PERM").fidx;

/** A state with a known rubble wall east of the player and a strong digger. */
function rubbleState(): GameState {
  const state = makeState({ playerGrid: loc(15, 10) });
  const wall = loc(16, 10);
  state.chunk.setFeat(wall, RUBBLE);
  squareMemorize(state, wall); // square_isknown gate
  (state.actor.combat.skills as number[])[SKILL.DIGGING] = 200; // rubble chance = 8*skill -> always
  // Install the seam the session normally wires (harness does not run wireGame).
  state.autoDigStep = (s, g): number => movementAutoDig(s, g, { env: {} });
  return state;
}

describe("QoL auto-dig on walk", () => {
  it("faithful bump when the flag is off: no dig, no move, no energy", () => {
    const state = rubbleState(); // no state.modRules -> qol.autoDig off
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(0);
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(state.chunk.isRubble(loc(16, 10))).toBe(true); // still there
  });

  it("with the flag on: one dig attempt, spends a move, does not step onto the grid", () => {
    const state = rubbleState();
    state.modRules = { "qol.autoDig": true };
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(state.z.moveEnergy);
    expect(state.actor.grid).toEqual(loc(15, 10)); // AIngband: dig, don't step
    expect(state.chunk.isRubble(loc(16, 10))).toBe(false); // dug out (skill 200)
  });

  it("with the flag on but the grid unknown: faithful bump (square_isknown gate)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), RUBBLE); // NOT memorized
    (state.actor.combat.skills as number[])[SKILL.DIGGING] = 200;
    state.autoDigStep = (s, g): number => movementAutoDig(s, g, { env: {} });
    state.modRules = { "qol.autoDig": true };
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(0);
    expect(state.chunk.isRubble(loc(16, 10))).toBe(true);
  });

  it("with the flag on but permanent rock: faithful bump", () => {
    const state = rubbleState();
    state.chunk.setFeat(loc(16, 10), PERM);
    squareMemorize(state, loc(16, 10));
    state.modRules = { "qol.autoDig": true };
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(0);
  });
});

describe("movementTunnelTest", () => {
  it("false for granite the player cannot dig (chance 0 at low skill)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), GRANITE);
    squareMemorize(state, loc(16, 10));
    (state.actor.combat.skills as number[])[SKILL.DIGGING] = 20; // granite chance = (20-40) -> 0
    expect(movementTunnelTest(state, loc(16, 10))).toBe(false);
  });

  it("true for known rubble the player can dig", () => {
    const state = rubbleState();
    expect(movementTunnelTest(state, loc(16, 10))).toBe(true);
  });
});
