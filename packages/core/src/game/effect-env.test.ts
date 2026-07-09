import { describe, expect, it } from "vitest";
import { EF, TMD } from "../generated";
import {
  EffectRegistry,
  sourcePlayer,
} from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { makeState, plReg } from "./harness";
import type { GameState } from "./context";
import {
  buildEffectContext,
  buildTimedHost,
} from "./effect-env";
import type { EffectEnvDeps } from "./effect-env";

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  return r;
}

function deps(state: GameState, extra: Partial<EffectEnvDeps> = {}): EffectEnvDeps {
  return { timedTable: plReg.timed, ...extra };
}

describe("effect env - timed effects through the registry", () => {
  it("EF_CURE clears a live player status", () => {
    const state = makeState();
    state.actor.player.timed[TMD.POISONED] = 10;
    const env = buildEffectContext(state, deps(state));
    registry().effectSimple(EF.CURE, env, {
      origin: sourcePlayer(),
      subtype: TMD.POISONED,
    });
    expect(state.actor.player.timed[TMD.POISONED]).toBe(0);
  });

  it("EF_TIMED_INC raises a live player status (default allow)", () => {
    const state = makeState();
    const env = buildEffectContext(state, deps(state));
    registry().effectSimple(EF.TIMED_INC, env, {
      origin: sourcePlayer(),
      diceString: "10",
      subtype: TMD.POISONED,
    });
    expect(state.actor.player.timed[TMD.POISONED]).toBe(10);
  });

  it("EF_NOURISH raises the food level", () => {
    const state = makeState();
    state.actor.player.timed[TMD.FOOD] = 0;
    const env = buildEffectContext(state, deps(state));
    registry().effectSimple(EF.NOURISH, env, {
      origin: sourcePlayer(),
      diceString: "5",
      subtype: 0,
    });
    expect(state.actor.player.timed[TMD.FOOD]).toBeGreaterThan(0);
  });
});

describe("effect env - hitpoints through the registry", () => {
  it("EF_HEAL_HP heals the live player", () => {
    const state = makeState();
    state.actor.player.mhp = 100;
    state.actor.player.chp = 50;
    const env = buildEffectContext(state, deps(state));
    registry().effectSimple(EF.HEAL_HP, env, {
      origin: sourcePlayer(),
      diceString: "20",
    });
    expect(state.actor.player.chp).toBe(70);
  });

  it("EF_DAMAGE hurts the live player through take_hit", () => {
    const state = makeState();
    state.actor.player.chp = 100;
    const env = buildEffectContext(state, deps(state));
    registry().effectSimple(EF.DAMAGE, env, {
      origin: sourcePlayer(),
      diceString: "30",
    });
    expect(state.actor.player.chp).toBe(70);
  });

  it("a fatal EF_DAMAGE flags death and fires the death hook", () => {
    const state = makeState();
    state.actor.player.chp = 10;
    let died = 0;
    const env = buildEffectContext(
      state,
      deps(state, { takeHitHooks: { onDeath: () => died++ } }),
    );
    registry().effectSimple(EF.DAMAGE, env, {
      origin: sourcePlayer(),
      diceString: "30",
    });
    expect(state.isDead).toBe(true);
    expect(died).toBe(1);
  });
});

describe("buildTimedHost", () => {
  it("decTimed reduces a live status", () => {
    const state = makeState();
    state.actor.player.timed[TMD.POISONED] = 10;
    const host = buildTimedHost(state, deps(state));
    host.decTimed(TMD.POISONED, 4, false, false);
    expect(state.actor.player.timed[TMD.POISONED]).toBe(6);
  });
});
