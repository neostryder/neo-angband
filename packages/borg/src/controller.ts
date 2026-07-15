/**
 * The Borg controller: an AgentController (the frozen decision seam) backed by
 * the Borg's world model, private RNG, and think ladder. This is what a host
 * installs via installController to hand the game over to the Borg.
 *
 * Per-think cycle (mirrors internal_borg_inkey -> borg_think, borg.c):
 *   1. perceive: fold the current view into the world model.
 *   2. advance the Borg clock exactly once (anti-loop thresholds depend on it).
 *   3. think: run the decision ladder, returning one command (or null to yield).
 *
 * The controller is deterministic: it draws only its private RNG (reseeded per
 * think), so a host installs it WITHOUT nondeterministic:true and the save's
 * determinism ratchet stays untripped - a faithful, replayable autoplayer.
 */

import type { AgentController, Rng } from "@neo-angband/core";
import { BorgWorld } from "./world/model";
import { makeBorgRng, reseedBorgRng } from "./rng";
import { perceive, makePerceiveMemo } from "./perceive";
import { think } from "./think";
import type { BorgContext } from "./context";

/** Options for building a Borg. */
export interface BorgOptions {
  /** Seed for the Borg's private simulation RNG (default BORG_LOCAL_SEED). */
  rngSeed?: number;
  /**
   * Reseed the private RNG at the start of every think so a decision's
   * simulations are a pure function of its inputs (matches the C borg's per-
   * think seed swap). Default true. Set false to let sim rolls carry across
   * decisions (rarely wanted).
   */
  reseedEachThink?: boolean;
}

/** A live Borg: its world model, RNG, and the controller to install. */
export interface Borg {
  /** The Borg's remembered world (inspectable by tests / a debug HUD). */
  world: BorgWorld;
  /** The Borg's private simulation RNG. */
  rng: Rng;
  /** The controller to hand to installController. */
  controller: AgentController;
}

/**
 * Build a Borg. The returned controller is stateful (owns the world model and
 * perception memo), so build one Borg per game session.
 */
export function createBorg(opts: BorgOptions = {}): Borg {
  const world = new BorgWorld();
  const rng = makeBorgRng(opts.rngSeed);
  const memo = makePerceiveMemo();
  const reseedEach = opts.reseedEachThink ?? true;

  const controller: AgentController = (view, act) => {
    perceive(world, view, memo);
    world.clock += 1;
    if (reseedEach) reseedBorgRng(rng, opts.rngSeed);

    const ctx: BorgContext = { world, view, act, rng };
    return think(ctx);
  };

  return { world, rng, controller };
}
