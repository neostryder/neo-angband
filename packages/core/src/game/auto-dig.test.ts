/**
 * The WALK-INTO-A-WALL SEAM (mod/hooks.ts walkBlockedByDiggable), and core's two
 * public digging primitives.
 *
 * What core owns, and all this file may assert about behaviour:
 *
 *  - faithful 4.2.6 bumps the wall, spends nothing, and draws NO RNG;
 *  - a hook may take the walk over and its returned energy is what the turn
 *    spends;
 *  - a hook may decline (null) and the walk falls back to the faithful bump;
 *  - movementTunnelTest / tunnelAux are public and behave, so a mod can make a
 *    REAL dig attempt instead of reimplementing the roll.
 *
 * What core does NOT own: auto-dig itself. That is the `qol` mod's patch
 * ("qol.autoDig"), its code lives in packages/web/mods/qol/hooks.ts, and its
 * behaviour is proven there (one attempt, spends a move, never steps onto the
 * grid). No `qol.*` string appears in core. The hook written inline below is
 * stated as the CONTRACT core offers, not as core's behaviour.
 */

import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { SKILL } from "../player/types";
import { walkAction } from "./player-turn";
import { movementAutoDig, movementTunnelTest, tunnelAux } from "./cave-cmd";
import type { CaveCmdDeps } from "./cave-cmd";
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

describe("the walk-into-a-wall seam (walkBlockedByDiggable)", () => {
  it("faithful bump with no mod loaded: no dig, no move, no energy, no RNG", () => {
    const state = rubbleState(); // no state.modHooks -> the hook is ABSENT
    const rngBefore = JSON.stringify(state.rng.getState());
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(0);
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(state.chunk.isRubble(loc(16, 10))).toBe(true); // still there
    /* The load-bearing half: an absent hook is one undefined check, so the
     * stream is exactly where 4.2.6 leaves it. */
    expect(JSON.stringify(state.rng.getState())).toBe(rngBefore);
  });

  it("spends exactly the energy the hook returns, and does not step onto the grid", () => {
    const state = rubbleState();
    /* A stub, deliberately NOT a digger: core must honour whatever energy the
     * hook reports without knowing why, and must not move the player. */
    state.modHooks = { walkBlockedByDiggable: () => 37 };
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(37);
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(state.chunk.isRubble(loc(16, 10))).toBe(true); // the stub dug nothing
  });

  it("falls back to the faithful bump when the hook declines (null)", () => {
    const state = rubbleState();
    let asked = 0;
    state.modHooks = {
      walkBlockedByDiggable: () => {
        asked++;
        return null;
      },
    };
    const rngBefore = JSON.stringify(state.rng.getState());
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(asked).toBe(1);
    expect(spent).toBe(0);
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(state.chunk.isRubble(loc(16, 10))).toBe(true);
    /* Declining is free of observable effect - that is the hook's documented
     * contract, and it is what lets a mod be enabled mid-character. */
    expect(JSON.stringify(state.rng.getState())).toBe(rngBefore);
  });

  it("hands the hook the blocked grid and the live CaveCmdDeps", () => {
    const state = rubbleState();
    const deps: CaveCmdDeps = { env: { msg: () => {} } };
    state.autoDigStep = (s, g): number => movementAutoDig(s, g, deps);
    const seen: { grid: Loc | null; deps: unknown } = { grid: null, deps: null };
    state.modHooks = {
      walkBlockedByDiggable: (s, g, d) => {
        expect(s).toBe(state);
        seen.grid = loc(g.x, g.y);
        seen.deps = d;
        return null;
      },
    };
    walkAction(state, { code: "walk", dir: 6 });
    expect(seen.grid).toEqual(loc(16, 10)); // the grid walked INTO, not the player's
    expect(seen.deps).toBe(deps); // the same object, not a copy
  });

  it("offers enough for a real digging hook: movementTunnelTest + tunnelAux", () => {
    /* What the qol mod's own hook does, stated here as the CONTRACT core offers
     * rather than as core's behaviour: decide with the RNG-free test, then make
     * ONE real attempt with the tunnel command's own roll and payouts, and spend
     * a full move without stepping onto the grid. */
    const state = rubbleState();
    state.modHooks = {
      walkBlockedByDiggable: (s, g, d): number | null => {
        if (!movementTunnelTest(s, g)) return null;
        tunnelAux(s, g, d as CaveCmdDeps);
        return s.z.moveEnergy;
      },
    };
    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(state.z.moveEnergy);
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(state.chunk.isRubble(loc(16, 10))).toBe(false); // dug out (skill 200)
  });

  it("a hook that declines on an unknown or permanent grid bumps faithfully", () => {
    /* The gates live in movementTunnelTest, which is core's; these two cases are
     * the ones a mod must decline, and core's job is only to accept the null. */
    const unknown = makeState({ playerGrid: loc(15, 10) });
    unknown.chunk.setFeat(loc(16, 10), RUBBLE); // NOT memorized
    (unknown.actor.combat.skills as number[])[SKILL.DIGGING] = 200;
    expect(movementTunnelTest(unknown, loc(16, 10))).toBe(false);

    const perm = rubbleState();
    perm.chunk.setFeat(loc(16, 10), PERM);
    squareMemorize(perm, loc(16, 10));
    expect(movementTunnelTest(perm, loc(16, 10))).toBe(false);

    for (const state of [unknown, perm]) {
      state.autoDigStep = (s, g): number => movementAutoDig(s, g, { env: {} });
      state.modHooks = {
        walkBlockedByDiggable: (s, g, d): number | null => {
          if (!movementTunnelTest(s, g)) return null;
          tunnelAux(s, g, d as CaveCmdDeps);
          return s.z.moveEnergy;
        },
      };
      expect(walkAction(state, { code: "walk", dir: 6 })).toBe(0);
    }
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

  it("draws no RNG, so a hook can decline for free", () => {
    const state = rubbleState();
    const before = JSON.stringify(state.rng.getState());
    movementTunnelTest(state, loc(16, 10));
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });
});
