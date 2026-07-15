/**
 * The Borg controller: an AgentController (the frozen decision seam) backed by
 * the Borg's world model, private RNG, and think ladder. This is what a host
 * installs via installController to hand the game over to the Borg.
 *
 * Per-think cycle (mirrors borg_think, borg-think.c:138-467):
 *   1. advance the Borg clock exactly once and the panel clock (:446).
 *   2. borgNotice: fill self.trait[] / power inputs from the view (:453).
 *   3. perceive: fold the current view into the world model, incl. the message
 *      stream and staleness/expiry (borg_update, :456).
 *   4. borgPower: score the current world (:459).
 *   5. track MAXCLEVEL / MAXDEPTH and the per-level "began" clock (:438).
 *   6. prime the wiring session (danger globals, flow avoidance) and think:
 *      run the store or dungeon ladder, returning one command (or null).
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
import { borgNotice, borgPower, BI } from "./trait";
import { getFightState } from "./fight";
import type { BorgContext } from "./context";
import {
  buildThinkSession,
  installThinkSession,
  type BorgResolvers,
} from "./think-session";

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
  /**
   * Host-supplied resolver seams for engine data the frozen AgentView cannot
   * surface: the monster-race danger resolver, artifact activation identity, the
   * "am I in shop N" signal, and the birth_force_descend option. All optional;
   * each defaults to faithful conservative behavior (see BorgResolvers).
   */
  resolvers?: BorgResolvers;
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
 * Build a Borg. The returned controller is stateful (owns the world model,
 * perception memo, and wiring session), so build one Borg per game session.
 */
export function createBorg(opts: BorgOptions = {}): Borg {
  const world = new BorgWorld();
  const rng = makeBorgRng(opts.rngSeed);
  const memo = makePerceiveMemo();
  const reseedEach = opts.reseedEachThink ?? true;

  /* Install the wiring session carrying the host resolvers so think() picks it
   * up (getThinkSession) with real seams instead of the inert defaults. */
  const session = buildThinkSession(opts.resolvers ?? {});
  installThinkSession(world, session);

  let lastDepth = -1;

  const controller: AgentController = (view, act) => {
    if (reseedEach) reseedBorgRng(rng, opts.rngSeed);
    const ctx: BorgContext = { world, view, act, rng };

    /* 1. Advance the clocks exactly once (borg-think.c:447). */
    world.clock += 1;
    world.self.timeThisPanel += 1;

    /* 2. Fill the self-model traits (borg_notice, :453). */
    borgNotice(ctx);

    /* 3. Fold the view (map/monsters/objects/messages) into the world (:456). */
    perceive(world, view, memo);

    /* 4. Score the world (borg_power, :459). */
    world.self.power = borgPower(ctx);

    /* 5. Running maxima + per-level "began" clock (:438, borg_update). */
    const t = world.self.trait;
    if ((t[BI.CLEVEL] ?? 0) > (t[BI.MAXCLEVEL] ?? 0)) t[BI.MAXCLEVEL] = t[BI.CLEVEL]!;
    if ((t[BI.CDEPTH] ?? 0) > (t[BI.MAXDEPTH] ?? 0)) t[BI.MAXDEPTH] = t[BI.CDEPTH]!;
    if (world.facts.depth !== lastDepth) {
      session.flow.state.borgBegan = world.clock;
      getFightState(world).began = world.clock;
      world.self.timeThisPanel = 1;
      lastDepth = world.facts.depth;
    }

    /* 6. Decide (store or dungeon ladder). */
    return think(ctx);
  };

  return { world, rng, controller };
}
