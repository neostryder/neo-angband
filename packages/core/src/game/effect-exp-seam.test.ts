/**
 * A mod effect handler can take experience away, as 4.1.3's LOSE_EXP did
 * (effects.c:1108), using only what the core namespace exports. Before
 * player/exp.js and effectExpDeps were exported, a mod had no way to lower
 * experience without making the loss permanent.
 */

import { describe, expect, it } from "vitest";
import * as core from "../index.js";
import type { EffectHandler } from "../index.js";
import { makeState } from "./harness.js";
import { basicPlayerActor } from "./project-cast.js";

/** 4.1.3's effect_handler_LOSE_EXP, written against the namespace a plugin gets. */
const loseExp: EffectHandler = (ctx) => {
  const env = core.gameEnv(ctx);
  if (!env) return true;
  const p = env.state.actor.player;
  if (!core.playerOfHas(env.state, core.OF.HOLD_LIFE) && p.exp > 0) {
    ctx.env.messages?.msg("You feel your memories fade.");
    core.playerExpLose(p, Math.trunc(p.exp / 4), false, core.effectExpDeps(ctx, env));
  }
  ctx.ident = true;
  return true;
};

function run(state: ReturnType<typeof makeState>, msgs: string[]) {
  const reg = new core.EffectRegistry();
  reg.register("feature-restoration:LOSE_EXP", { handler: loseExp });
  const env = core.attachGameEnv(
    { rng: state.rng, messages: { msg: (t: string) => msgs.push(t) } },
    { state, cast: { projections: [], maxRange: 20, playerActor: basicPlayerActor(state) }, general: {} },
  );
  reg.effectSimple("feature-restoration:LOSE_EXP", env, { origin: core.sourcePlayer() });
}

describe("experience loss from a mod effect", () => {
  it("drains a quarter of the current experience and keeps the maximum", () => {
    const state = makeState({ seed: 7 });
    const p = state.actor.player;
    core.playerExpGain(p, 1000, { rng: state.rng });
    const msgs: string[] = [];
    run(state, msgs);
    expect(p.exp).toBe(750);
    expect(p.maxExp).toBe(1000);
    expect(msgs).toContain("You feel your memories fade.");
  });

  it("recomputes the level as the experience falls", () => {
    const state = makeState({ seed: 8 });
    const p = state.actor.player;
    Object.assign(p, { lev: 1, maxLev: 1, exp: 0, maxExp: 0, expFactor: 100 });
    core.playerExpGain(p, 90, { rng: state.rng });
    expect(p.lev).toBe(5);
    run(state, []);
    expect(p.exp).toBe(68);
    expect(p.lev).toBe(4);
    expect(p.maxLev).toBe(5);
  });
});
