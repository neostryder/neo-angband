/**
 * Tests for makeCoreResolvers: the host wiring that turns core MonsterRace
 * records into the MonsterFacts the danger evaluator needs. Proves the bridge
 * reads blows (dice/sides/effect), flags, spell list, and the spell/frequency
 * fields the frozen AgentView cannot surface.
 */

import { describe, expect, it } from "vitest";
import { RF, RSF } from "@neo-angband/core";
import type { MonsterRace } from "@neo-angband/core";
import { makeCoreResolvers } from "./resolvers";
import { BorgWorld } from "./world/model";
import { makeScenarioView, makeFakeActions } from "./harness";
import { MONBLOW } from "./danger/tables";
import type { BorgContext } from "./context";

/** A minimal MonsterRace carrying only the fields the resolver reads. */
function fakeRace(over: Partial<MonsterRace> = {}): MonsterRace {
  const blow = {
    method: {} as never,
    effect: { name: "FIRE" } as never,
    dice: { randomValue: () => ({ base: 0, dice: 3, sides: 6, mBonus: 0 }) } as never,
    diceRaw: "3d6",
  };
  return {
    ridx: 7,
    name: "test-drake",
    flags: [RF.UNIQUE] as unknown as MonsterRace["flags"],
    spellFlags: [RSF.BR_FIRE] as unknown as MonsterRace["spellFlags"],
    level: 20,
    sleep: 10,
    spellPower: 25,
    freqInnate: 4,
    freqSpell: 4,
    friends: [],
    friendsBase: [],
    blows: [blow] as unknown as MonsterRace["blows"],
    ...over,
  } as MonsterRace;
}

/** A context whose world has one tracked kill of race ridx 7. */
function ctxWithKill(): BorgContext {
  const world = new BorgWorld();
  const idx = world.kills.alloc();
  const k = world.kills.at(idx);
  k.rIdx = 7;
  k.mIdx = 101;
  k.pos = { x: 5, y: 5 };
  return { world, view: makeScenarioView(), act: makeFakeActions(), rng: undefined as never };
}

describe("makeCoreResolvers", () => {
  it("builds MonsterFacts from a core race (blows, flags, spells, freq)", () => {
    const resolvers = makeCoreResolvers({ races: [fakeRace()] });
    const ctx = ctxWithKill();
    const facts = resolvers.resolveMonsterFacts!(ctx, 1);

    expect(facts.rIdx).toBe(7);
    expect(facts.level).toBe(20);
    expect(facts.sleep).toBe(10);
    expect(facts.spellPower).toBe(25);
    expect(facts.freqInnate).toBe(4);
    expect(facts.flags.has("UNIQUE")).toBe(true);
    // The single fire blow: 3d6, MONBLOW.FIRE.
    expect(facts.blows).toHaveLength(1);
    expect(facts.blows[0]).toEqual({ dice: 3, sides: 6, effect: MONBLOW.FIRE });
    // The spell list carries the BR_FIRE ordinal.
    expect(facts.spells).toContain(RSF.BR_FIRE as unknown as number);
  });

  it("falls back to MonsterView-derived facts for an unknown race", () => {
    const resolvers = makeCoreResolvers({ races: [] }); // no race ridx 7
    const ctx = ctxWithKill();
    const facts = resolvers.resolveMonsterFacts!(ctx, 1);
    // Unknown race -> default resolver: no blows, zero freq (conservative).
    expect(facts.rIdx).toBe(7);
    expect(facts.blows).toHaveLength(0);
    expect(facts.freqInnate).toBe(0);
  });

  it("marks races with companions as hasFriends", () => {
    const resolvers = makeCoreResolvers({
      races: [fakeRace({ friends: [{} as never] })],
    });
    const facts = resolvers.resolveMonsterFacts!(ctxWithKill(), 1);
    expect(facts.hasFriends).toBe(true);
  });
});
