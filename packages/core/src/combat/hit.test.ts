import { describe, expect, it } from "vitest";
import { MON_TMD } from "../generated";
import { Rng } from "../rng";
import type { CritActor, DebuffTarget } from "./hit";
import {
  criticalMelee,
  criticalShot,
  getHitChance,
  hitChance,
  isDebuffed,
  MELEE_CRIT_LEVELS,
  RANGED_CRIT_LEVELS,
  selectCritLevel,
  testHit,
} from "./hit";

function notDebuffed(): DebuffTarget {
  return { mTimed: new Int16Array(MON_TMD.MAX) };
}

describe("hit_chance (player-attack.c)", () => {
  it("caps the success rate at 95% (5% always-miss band)", () => {
    /* to_hit floored at 9, ac 0: the full scaled term applies. */
    const c = hitChance(9, 0);
    expect(c.denominator).toBe(10000);
    /* 10000 * 8300/10000 + 1200 = 9500 => 95%. */
    expect(c.numerator).toBe(9500);
  });

  it("floors the success rate at 12% (always-hit band)", () => {
    /* to_hit 9, ac 100: 9 - (100*2/3=66) < 0, so only ALWAYS_HIT remains. */
    const c = hitChance(9, 100);
    expect(c.numerator).toBe(1200);
  });

  it("puts a floor of 9 on the to-hit value", () => {
    expect(hitChance(3, 0)).toEqual(hitChance(9, 0));
    expect(hitChance(-50, 0)).toEqual(hitChance(9, 0));
  });

  it("computes a mid-range chance with exact integer arithmetic", () => {
    /* to_hit 50, ac 30: num=50-20=30, /50 -> 6000, *8300/10000 -> 4980, +1200. */
    const c = hitChance(50, 30);
    expect(c.numerator).toBe(6180);
    expect(getHitChance(50, 30)).toBe(61);
  });
});

describe("test_hit determinism", () => {
  it("misses in the bottom band and hits above it (rand_fix)", () => {
    /* hitChance(9, 0) = {9500, 10000}: hit unless the roll lands below 500. */
    const miss = new Rng(1);
    miss.randFix(0); // roll -> 0, in the 5% miss band
    expect(testHit(miss, 9, 0)).toBe(false);

    const hit = new Rng(1);
    hit.randFix(100); // roll -> 9999, a hit
    expect(testHit(hit, 9, 0)).toBe(true);
  });

  it("still hits 12% of the time even at hopeless to-hit", () => {
    /* hitChance(9, 100) = {1200, 10000}: only the top 12% hits. */
    const top = new Rng(1);
    top.randFix(100);
    expect(testHit(top, 9, 100)).toBe(true);

    const bottom = new Rng(1);
    bottom.randFix(0);
    expect(testHit(bottom, 9, 100)).toBe(false);
  });
});

describe("selectCritLevel (critical-level cutoffs)", () => {
  it("buckets melee power by cutoff", () => {
    expect(selectCritLevel(399, MELEE_CRIT_LEVELS).msg).toBe("HIT_GOOD");
    expect(selectCritLevel(400, MELEE_CRIT_LEVELS).msg).toBe("HIT_GREAT");
    expect(selectCritLevel(700, MELEE_CRIT_LEVELS).msg).toBe("HIT_SUPERB");
    expect(selectCritLevel(900, MELEE_CRIT_LEVELS).msg).toBe("HIT_HI_GREAT");
    expect(selectCritLevel(1300, MELEE_CRIT_LEVELS).msg).toBe("HIT_HI_SUPERB");
    expect(selectCritLevel(99999, MELEE_CRIT_LEVELS).msg).toBe("HIT_HI_SUPERB");
  });

  it("buckets ranged power by cutoff", () => {
    expect(selectCritLevel(0, RANGED_CRIT_LEVELS).msg).toBe("HIT_GOOD");
    expect(selectCritLevel(500, RANGED_CRIT_LEVELS).msg).toBe("HIT_GREAT");
    expect(selectCritLevel(1000, RANGED_CRIT_LEVELS).msg).toBe("HIT_SUPERB");
  });

  it("carries the add/mult of the selected level", () => {
    const good = selectCritLevel(0, MELEE_CRIT_LEVELS);
    expect(good.add).toBe(5);
    expect(good.mult).toBe(2);
    const superb = selectCritLevel(900, MELEE_CRIT_LEVELS);
    expect(superb.add).toBe(20);
    expect(superb.mult).toBe(3);
  });
});

describe("critical_melee (player-attack.c)", () => {
  const actor: CritActor = {
    lev: 1,
    toH: 0,
    meleeSkill: 0,
    bowSkill: 0,
    throwSkill: 0,
  };

  it("returns the base damage and HIT when no critical triggers", () => {
    /* chance = weight(0) + 5*0 + 0 + 0 - 60 = -60; randint1(5000) always > -60. */
    const rng = new Rng(1);
    const res = criticalMelee(rng, actor, notDebuffed(), 0, 0, 10);
    expect(res.damage).toBe(10);
    expect(res.msg).toBe("HIT");
  });

  it("applies the selected critical level when it triggers", () => {
    /* weight 1000 -> chance 940; randFix(0) rolls 1 (<=940) then power 1001. */
    const rng = new Rng(1);
    rng.randFix(0);
    const res = criticalMelee(rng, actor, notDebuffed(), 1000, 0, 10);
    /* power 1001 -> HIT_HI_GREAT (mult 3, add 20): 20 + 3*10 = 50. */
    expect(res.damage).toBe(50);
    expect(res.msg).toBe("HIT_HI_GREAT");
  });

  it("shooting criticals report SHOOT_HIT when none triggers", () => {
    const rng = new Rng(1);
    const res = criticalShot(rng, actor, notDebuffed(), 0, 0, 8, true);
    expect(res.damage).toBe(8);
    expect(res.msg).toBe("SHOOT_HIT");
  });
});

describe("is_debuffed", () => {
  it("is true when the monster is confused/held/afraid/stunned", () => {
    const mon = notDebuffed();
    expect(isDebuffed(mon)).toBe(false);
    mon.mTimed[MON_TMD.STUN] = 3;
    expect(isDebuffed(mon)).toBe(true);
  });
});
