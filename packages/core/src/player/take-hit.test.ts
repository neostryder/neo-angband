import { describe, expect, it } from "vitest";
import { TMD } from "../generated";
import { Rng } from "../rng";
import { TMD_MAX } from "./types";
import type { TakeHitTarget, TakeHitHooks } from "./take-hit";
import { playerApplyDamageReduction, takeHit } from "./take-hit";

function target(overrides: Partial<TakeHitTarget> = {}): TakeHitTarget {
  return {
    chp: 100,
    mhp: 100,
    lev: 10,
    isDead: false,
    timed: new Int16Array(TMD_MAX),
    hitpointWarn: 3,
    ...overrides,
  };
}

/** Hooks that record everything take_hit reports. */
function recorder(extra: Partial<TakeHitHooks> = {}) {
  const messages: string[] = [];
  let deaths = 0;
  let bells = 0;
  let regen = 0;
  const hooks: TakeHitHooks = {
    onMessage: (t) => messages.push(t),
    onDeath: () => deaths++,
    bell: () => bells++,
    combatRegenReward: () => regen++,
    ...extra,
  };
  return {
    hooks,
    messages,
    get deaths() {
      return deaths;
    },
    get bells() {
      return bells;
    },
    get regen() {
      return regen;
    },
  };
}

describe("playerApplyDamageReduction", () => {
  it("invulnerability zeroes sub-9000 damage", () => {
    const t = target();
    t.timed[TMD.INVULN] = 5;
    expect(playerApplyDamageReduction(t, { damRed: 0, percDamRed: 0 }, 500)).toBe(
      0,
    );
    /* ...but not a 9000+ hit */
    expect(
      playerApplyDamageReduction(t, { damRed: 0, percDamRed: 0 }, 9000),
    ).toBe(9000);
  });

  it("applies the flat reduction then the percentage", () => {
    const t = target();
    /* 100 - 10 = 90, then -25% -> 90 - 22 = 68 */
    expect(
      playerApplyDamageReduction(t, { damRed: 10, percDamRed: 25 }, 100),
    ).toBe(68);
  });

  it("never returns negative", () => {
    const t = target();
    expect(
      playerApplyDamageReduction(t, { damRed: 50, percDamRed: 0 }, 30),
    ).toBe(0);
  });
});

describe("takeHit", () => {
  it("does nothing for non-positive damage or an already dead player", () => {
    const t = target();
    const rec = recorder();
    takeHit(t, 0, "a rat", rec.hooks);
    expect(t.chp).toBe(100);

    t.isDead = true;
    takeHit(t, 20, "a rat", rec.hooks);
    expect(t.chp).toBe(100);
  });

  it("reduces hit points and rewards COMBAT_REGEN mana for normal killers", () => {
    const t = target();
    const rec = recorder();
    takeHit(t, 30, "an orc", rec.hooks);
    expect(t.chp).toBe(70);
    expect(rec.regen).toBe(1);
    expect(t.isDead).toBe(false);
  });

  it("does not reward COMBAT_REGEN mana for poison / fatal wound / starvation", () => {
    for (const killer of ["poison", "a fatal wound", "starvation"]) {
      const rec = recorder();
      takeHit(target(), 30, killer, rec.hooks);
      expect(rec.regen).toBe(0);
    }
  });

  it("kills the player and runs onDeath when hit below zero", () => {
    const t = target({ chp: 10 });
    const rec = recorder();
    takeHit(t, 25, "a dragon", rec.hooks);
    expect(t.isDead).toBe(true);
    expect(rec.deaths).toBe(1);
    expect(rec.messages).toContain("You die.");
  });

  it("bloodlust keeps the player alive below zero", () => {
    const t = target({ chp: 5, lev: 10 });
    t.timed[TMD.BLOODLUST] = 20; /* chp(5) - 30 = -25; -25 + 20 + 10 = 5 >= 0 */
    const rec = recorder({ rng: new Rng(1) });
    takeHit(t, 30, "a troll", rec.hooks);
    expect(t.isDead).toBe(false);
    expect(rec.deaths).toBe(0);
    expect(
      rec.messages.some((m) => m.includes("keeps you alive") || m.includes("Mormegil")),
    ).toBe(true);
  });

  it("cheat-death survives a fatal blow when the hook allows it", () => {
    const t = target({ chp: 10 });
    const rec = recorder({ cheatDeath: () => true });
    takeHit(t, 25, "a lich", rec.hooks);
    expect(t.isDead).toBe(false);
    expect(rec.deaths).toBe(0);
  });

  it("warns and rings the bell when crossing the low-hitpoint threshold", () => {
    const t = target({ chp: 100, mhp: 100, hitpointWarn: 3 }); /* warn at 30 */
    const rec = recorder();
    takeHit(t, 80, "a kobold", rec.hooks); /* chp 20 < 30, from 100 > 30 */
    expect(t.chp).toBe(20);
    expect(rec.bells).toBe(1);
    expect(rec.messages).toContain("*** LOW HITPOINT WARNING! ***");
  });

  it("does not re-ring the bell when already below the threshold", () => {
    const t = target({ chp: 25, mhp: 100, hitpointWarn: 3 }); /* already < 30 */
    const rec = recorder();
    takeHit(t, 5, "a kobold", rec.hooks); /* chp 20, oldChp 25 not > 30 */
    expect(rec.bells).toBe(0);
    expect(rec.messages).toContain("*** LOW HITPOINT WARNING! ***");
  });
});
