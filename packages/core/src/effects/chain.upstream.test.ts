/**
 * Upstream unit tests from reference/src/tests/effects/chain.c
 *
 * Mapping:
 * - effect_do / RANDOM / SELECT chain control -> EffectRegistry.effectDo
 *   (packages/core/src/effects/interpreter.ts)
 * - effect_damages / effect_avg_damage / effect_projection / effect_next
 *   -> effect-info.ts (same as effects/info.c)
 * - Full angband init + player birth is replaced by a minimal EffectContext
 *   with a live player HP host (effect-env style) so DAMAGE/HEAL_HP/TIMED_INC
 *   run for real. SELECT list_index is injected via chooseEffect.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EF, TMD } from "../generated/index.js";
import { Rng } from "../rng.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { EffectBuilder } from "./effect.js";
import type { Effect } from "./effect.js";
import {
  effectAvgDamage,
  effectDamages,
  effectNext,
  effectProjection,
} from "./effect-info.js";
import type { EffectContext, EffectPlayer, HasHp, TimedHost } from "./interpreter.js";
import {
  EffectRegistry,
  sourcePlayer,
} from "./interpreter.js";
import { registerCoreHandlers } from "./handlers.js";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as { records: T[] };
  return parsed.records;
}

const projections = bindProjections(packJson<ProjectionRecordJson>("projection"));

class FakeTimed implements TimedHost {
  values = new Map<number, number>();
  timed(idx: number): number {
    return this.values.get(idx) ?? 0;
  }
  setTimed(idx: number, v: number, _n: boolean, _d: boolean): boolean {
    this.values.set(idx, v);
    return true;
  }
  incTimed(idx: number, v: number, _n: boolean, _d: boolean, _c: boolean): boolean {
    this.values.set(idx, this.timed(idx) + v);
    return true;
  }
  decTimed(idx: number, v: number, _n: boolean, _d: boolean): boolean {
    this.values.set(idx, Math.max(this.timed(idx) - v, 0));
    return true;
  }
  clearTimed(idx: number, _n: boolean, _d: boolean): boolean {
    this.values.set(idx, 0);
    return true;
  }
}

function makeEnv(
  seed = 1,
  extra: Partial<EffectContext> = {},
): {
  env: EffectContext;
  hp: HasHp;
  timed: FakeTimed;
} {
  const hp: HasHp = { chp: 50, mhp: 50, chpFrac: 0 };
  const timed = new FakeTimed();
  const player: EffectPlayer = {
    hp,
    timed,
    applyDamageReduction: (dam: number) => dam,
    takeHit: (dam: number) => {
      hp.chp = Math.max(0, hp.chp - dam);
    },
  };
  return {
    env: { rng: new Rng(seed), player, ...extra },
    hp,
    timed,
  };
}

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  return r;
}

function chain(...parts: string[]): Effect {
  let b = new EffectBuilder();
  for (const p of parts) {
    // "CODE" or "CODE:SUB:dice" style is not used; dice is separate arg pairs.
    b = b.effect(p);
  }
  return b.build()!;
}

function chainWithDice(specs: { effect: string; dice?: string }[]): Effect {
  let b = new EffectBuilder();
  for (const s of specs) {
    b = b.effect(s.effect);
    if (s.dice) b = b.dice(s.dice);
  }
  return b.build()!;
}

describe("effects/chain (reference/src/tests/effects/chain.c)", () => {
  // upstream: test_chain1_execute
  it("chain1_execute", () => {
    const { env, hp } = makeEnv();
    const ec = chainWithDice([{ effect: "DAMAGE", dice: "1" }]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(ec).toBeTruthy();
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    expect(hp.chp).toBe(hp.mhp - 1);
  });

  // upstream: test_chain2_execute
  it("chain2_execute", () => {
    const { env, hp } = makeEnv();
    const ec = chainWithDice([
      { effect: "DAMAGE", dice: "2" },
      { effect: "HEAL_HP", dice: "1" },
    ]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    expect(hp.chp).toBe(hp.mhp - 1);
  });

  // upstream: test_chain3_execute
  it("chain3_execute", () => {
    const { env, hp } = makeEnv();
    const ec = chainWithDice([
      { effect: "DAMAGE", dice: "5" },
      { effect: "HEAL_HP", dice: "4" },
      { effect: "DAMAGE", dice: "2" },
    ]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    expect(hp.chp).toBe(hp.mhp - 3);
  });

  // upstream: test_randomneg_execute
  it("randomneg_execute", () => {
    const { env } = makeEnv();
    const ec = chainWithDice([{ effect: "RANDOM", dice: "-4+1d2" }]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
  });

  // upstream: test_random0_execute
  it("random0_execute", () => {
    const { env } = makeEnv();
    const ec = chainWithDice([{ effect: "RANDOM", dice: "0" }]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
  });

  // upstream: test_random1_execute
  it("random1_execute", () => {
    const { env, hp } = makeEnv();
    const ec = chainWithDice([
      { effect: "RANDOM", dice: "1" },
      { effect: "DAMAGE", dice: "1" },
    ]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    expect(hp.chp).toBe(hp.mhp - 1);
  });

  // upstream: test_random2_execute
  it("random2_execute", () => {
    const { env, hp, timed } = makeEnv(99);
    timed.values.set(TMD.BOLD, 0);
    const ec = chainWithDice([
      { effect: "RANDOM", dice: "2" },
      { effect: "DAMAGE", dice: "1" },
      { effect: "TIMED_INC:BOLD", dice: "10" },
    ]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    const dmg = hp.chp === hp.mhp - 1;
    const bold = timed.timed(TMD.BOLD) > 0;
    expect((dmg || bold) && !(dmg && bold)).toBe(true);
  });

  // upstream: test_randomover_execute
  it("randomover_execute", () => {
    const { env } = makeEnv();
    const ec = chainWithDice([{ effect: "RANDOM", dice: "10" }]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
  });

  // upstream: test_nested_random_execute
  it("nested_random_execute", () => {
    const { env, hp, timed } = makeEnv(3);
    timed.values.set(TMD.BOLD, 0);
    const ec = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "DAMAGE", dice: "1" },
      { effect: "RANDOM", dice: "5" },
      { effect: "TIMED_INC:BOLD", dice: "10" },
    ]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    const dmg = hp.chp === hp.mhp - 1;
    const bold = timed.timed(TMD.BOLD) > 0;
    const none = hp.chp === hp.mhp && !bold;
    expect((dmg || bold || none) && !(dmg && bold)).toBe(true);
  });

  // upstream: test_random_stats (Chernoff bound, n=1000, p=0.5 -> [432,568])
  it("test_random_stats", () => {
    const ec = chainWithDice([
      { effect: "RANDOM", dice: "2" },
      { effect: "DAMAGE", dice: "1" },
      { effect: "DAMAGE", dice: "2" },
    ]);
    const nsim = 1000;
    const bins = [0, 0];
    const reg = registry();
    for (let i = 0; i < nsim; i++) {
      const { env, hp } = makeEnv(i + 1);
      const completed = reg.effectDo(ec, env, {
        origin: sourcePlayer(),
        aware: true,
      });
      expect(completed).toBe(true);
      const lost = hp.mhp - hp.chp;
      if (lost === 1) bins[0]!++;
      else if (lost === 2) bins[1]!++;
      else throw new Error(`unexpected damage ${lost}`);
    }
    expect(bins[0]! + bins[1]!).toBe(nsim);
    expect(bins[0]!).toBeGreaterThanOrEqual(432);
    expect(bins[0]!).toBeLessThanOrEqual(568);
  });

  // upstream: test_selectneg_execute
  it("selectneg_execute", () => {
    const { env } = makeEnv();
    const ec = chainWithDice([{ effect: "SELECT", dice: "-4+1d2" }]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
  });

  // upstream: test_select0_execute
  it("select0_execute", () => {
    const { env } = makeEnv();
    const ec = chainWithDice([{ effect: "SELECT", dice: "0" }]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
  });

  // upstream: test_select1_execute
  it("select1_execute", () => {
    const { env, hp } = makeEnv();
    const ec = chainWithDice([
      { effect: "SELECT", dice: "1" },
      { effect: "DAMAGE", dice: "1" },
    ]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    expect(hp.chp).toBe(hp.mhp - 1);
  });

  // upstream: test_select2_execute (list_index via chooseEffect)
  it("select2_execute", () => {
    for (const choice of [0, 1] as const) {
      const { env, hp, timed } = makeEnv(7);
      timed.values.set(TMD.BOLD, 0);
      const ec = chainWithDice([
        { effect: "SELECT", dice: "2" },
        { effect: "DAMAGE", dice: "1" },
        { effect: "TIMED_INC:BOLD", dice: "10" },
      ]);
      env.chooseEffect = () => choice;
      const ident = { value: true };
      const completed = registry().effectDo(ec, env, {
        origin: sourcePlayer(),
        ident,
        aware: true,
      });
      expect(completed).toBe(true);
      expect(ident.value).toBe(true);
      if (choice === 0) {
        expect(hp.chp).toBe(hp.mhp - 1);
        expect(timed.timed(TMD.BOLD)).toBe(0);
      } else {
        expect(hp.chp).toBe(hp.mhp);
        expect(timed.timed(TMD.BOLD) > 0).toBe(true);
      }
    }
  });

  // upstream: test_selectover_execute
  it("selectover_execute", () => {
    const { env } = makeEnv();
    env.chooseEffect = () => 0;
    const ec = chainWithDice([{ effect: "SELECT", dice: "5" }]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
  });

  // upstream: test_nested_select_execute
  it("nested_select_execute", () => {
    const { env, hp, timed } = makeEnv(11);
    timed.values.set(TMD.BOLD, 0);
    const ec = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "DAMAGE", dice: "1" },
      { effect: "SELECT", dice: "5" },
      { effect: "TIMED_INC:BOLD", dice: "10" },
    ]);
    const ident = { value: true };
    const completed = registry().effectDo(ec, env, {
      origin: sourcePlayer(),
      ident,
      aware: true,
    });
    expect(completed).toBe(true);
    expect(ident.value).toBe(true);
    const dmg = hp.chp === hp.mhp - 1;
    const bold = timed.timed(TMD.BOLD) > 0;
    const none = hp.chp === hp.mhp && !bold;
    expect((dmg || bold || none) && !(dmg && bold)).toBe(true);
  });

  // upstream: test_random_select_damages
  it("random_select_damages", () => {
    const ec1 = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "HEAL_HP", dice: "5" },
      { effect: "BOLT:ACID", dice: "1" },
      { effect: "TIMED_INC:BOLD", dice: "10" },
    ]);
    const ec2 = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "HEAL_HP", dice: "5" },
      { effect: "TIMED_INC:FAST", dice: "8" },
      { effect: "TIMED_INC:BOLD", dice: "10" },
    ]);
    const expected = [true, true, false, false];
    const results = [
      effectDamages(ec1),
      (() => {
        ec1.index = EF.SELECT;
        return effectDamages(ec1);
      })(),
      effectDamages(ec2),
      (() => {
        ec2.index = EF.SELECT;
        return effectDamages(ec2);
      })(),
    ];
    expect(results).toEqual(expected);
  });

  // upstream: test_random_select_avg_damage  expected [3,3,5,5]
  it("random_select_avg_damage", () => {
    const ec1 = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "HEAL_HP", dice: "5" },
      { effect: "BOLT:ACID", dice: "3d5" },
      { effect: "TIMED_INC:BOLD", dice: "10" },
    ]);
    const ec2 = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "BOLT:FIRE", dice: "1d7" },
      { effect: "ARC:COLD", dice: "3+1d3" },
      { effect: "BOLT_OR_BEAM:POIS", dice: "6" },
    ]);
    const expected = [3, 3, 5, 5];
    const results = [
      effectAvgDamage(ec1, null),
      (() => {
        ec1.index = EF.SELECT;
        return effectAvgDamage(ec1, null);
      })(),
      effectAvgDamage(ec2, null),
      (() => {
        ec2.index = EF.SELECT;
        return effectAvgDamage(ec2, null);
      })(),
    ];
    expect(results).toEqual(expected);
  });

  // upstream: test_random_select_projection  expected ["acid","acid","",""]
  it("random_select_projection", () => {
    const ec1 = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "BALL:ACID", dice: "5" },
      { effect: "BOLT:ACID", dice: "1" },
      { effect: "ARC:ACID", dice: "10" },
    ]);
    // radius on first ball
    ec1.next!.radius = 3;
    const ec2 = chainWithDice([
      { effect: "RANDOM", dice: "3" },
      { effect: "BOLT:FIRE", dice: "5" },
      { effect: "BREATH:ELEC", dice: "8" },
      { effect: "LASH:POIS", dice: "10" },
    ]);
    const expected = ["acid", "acid", "", ""];
    const results = [
      effectProjection(ec1, projections),
      (() => {
        ec1.index = EF.SELECT;
        return effectProjection(ec1, projections);
      })(),
      effectProjection(ec2, projections),
      (() => {
        ec2.index = EF.SELECT;
        return effectProjection(ec2, projections);
      })(),
    ];
    expect(results).toEqual(expected);
  });

  // upstream: test_iterate1 — effect_next skips RANDOM/SELECT subeffects
  it("iterate1", () => {
    const ec = chainWithDice([
      { effect: "DAMAGE", dice: "0" },
      { effect: "RANDOM", dice: "3" },
      { effect: "DAMAGE", dice: "1" },
      { effect: "HEAL_HP", dice: "2" },
      { effect: "TIMED_INC:BOLD", dice: "10" },
      { effect: "DAMAGE", dice: "1" },
      { effect: "SELECT", dice: "2" },
      { effect: "TIMED_INC:STUN", dice: "5" },
      { effect: "TIMED_INC:FAST", dice: "5" },
      { effect: "HEAL_HP", dice: "2" },
    ]);
    const flat: Effect[] = [];
    for (let e: Effect | null = ec; e; e = e.next) flat.push(e);
    const expectedIdx = [0, 1, 5, 6, 9];
    const iter: Effect[] = [];
    for (let e: Effect | null = ec; e; e = effectNext(e)) iter.push(e);
    expect(iter.length).toBe(expectedIdx.length);
    for (let i = 0; i < expectedIdx.length; i++) {
      expect(iter[i]).toBe(flat[expectedIdx[i]!]);
    }
  });
});

void chain;
