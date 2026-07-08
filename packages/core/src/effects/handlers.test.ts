import { describe, expect, it } from "vitest";

import { EF, EFFECT_ENTRIES, TMD } from "../generated";
import { Rng } from "../rng";
import { EffectBuilder } from "./effect";
import type {
  EffectContext,
  EffectPlayer,
  HasHp,
  StubCall,
  TimedHost,
} from "./interpreter";
import { EffectRegistry, sourceMonster, sourceNone, sourcePlayer } from "./interpreter";
import { EFFECT_HANDLER_MANIFEST, registerCoreHandlers } from "./handlers";

interface TimedCall {
  op: "set" | "inc" | "dec" | "clear";
  idx: number;
  v: number;
  notify: boolean;
  canDisturb: boolean;
  check: boolean | null;
}

class FakeTimed implements TimedHost {
  values = new Map<number, number>();
  calls: TimedCall[] = [];

  timed(idx: number): number {
    return this.values.get(idx) ?? 0;
  }
  setTimed(idx: number, v: number, notify: boolean, canDisturb: boolean) {
    this.calls.push({ op: "set", idx, v, notify, canDisturb, check: null });
    this.values.set(idx, v);
    return true;
  }
  incTimed(
    idx: number,
    v: number,
    notify: boolean,
    canDisturb: boolean,
    check: boolean,
  ) {
    this.calls.push({ op: "inc", idx, v, notify, canDisturb, check });
    this.values.set(idx, this.timed(idx) + v);
    return true;
  }
  decTimed(idx: number, v: number, notify: boolean, canDisturb: boolean) {
    this.calls.push({ op: "dec", idx, v, notify, canDisturb, check: null });
    this.values.set(idx, Math.max(this.timed(idx) - v, 0));
    return true;
  }
  clearTimed(idx: number, notify: boolean, canDisturb: boolean) {
    this.calls.push({ op: "clear", idx, v: 0, notify, canDisturb, check: null });
    this.values.set(idx, 0);
    return true;
  }
}

function makeWorld(seed = 42): {
  registry: EffectRegistry;
  env: EffectContext;
  hp: HasHp;
  timed: FakeTimed;
  player: EffectPlayer & { hits: { dam: number; killer: string }[] };
  logged: string[];
  stubLog: StubCall[];
} {
  const registry = new EffectRegistry();
  registerCoreHandlers(registry);
  const hp: HasHp = { chp: 20, mhp: 50, chpFrac: 7 };
  const timed = new FakeTimed();
  const hits: { dam: number; killer: string }[] = [];
  const player = {
    hp,
    timed,
    hits,
    applyDamageReduction: (dam: number) => dam - 1,
    takeHit: (dam: number, killer: string) => {
      hits.push({ dam, killer });
    },
  };
  const logged: string[] = [];
  const stubLog: StubCall[] = [];
  const env: EffectContext = {
    rng: new Rng(seed),
    messages: { msg: (t) => logged.push(t) },
    player,
    foodValue: 100,
    showDamage: true,
    stubLog,
  };
  return { registry, env, hp, timed, player, logged, stubLog };
}

describe("EF_HEAL_HP", () => {
  it("heals by max(minimum roll, percentage of wounds)", () => {
    const { registry, env, hp, logged } = makeWorld();
    const ident = { value: false };
    const chain = new EffectBuilder().effect("HEAL_HP").dice("30").build();
    const done = registry.effectDo(chain, env, {
      origin: sourcePlayer(),
      ident,
    });
    expect(done).toBe(true);
    expect(ident.value).toBe(true);
    expect(hp.chp).toBe(50);
    expect(hp.chpFrac).toBe(0);
    expect(logged).toEqual(["You feel much better."]);
  });

  it("uses m_bonus as a percentage of damage taken", () => {
    const { registry, env, hp, logged } = makeWorld();
    hp.chp = 10;
    hp.mhp = 110;
    /* dice "1+m50": m_bonus 50 -> heal (110-10)*50/100 = 50 > base 1. */
    const chain = new EffectBuilder().effect("HEAL_HP").dice("1+m50").build();
    registry.effectDo(chain, env, { origin: sourcePlayer() });
    expect(hp.chp).toBe(60);
    expect(logged).toEqual(["You feel very good."]);
  });

  it("identifies but does nothing at full health", () => {
    const { registry, env, hp } = makeWorld();
    hp.chp = hp.mhp;
    const ident = { value: false };
    const chain = new EffectBuilder().effect("HEAL_HP").dice("30").build();
    registry.effectDo(chain, env, { origin: sourcePlayer(), ident });
    expect(hp.chp).toBe(hp.mhp);
    expect(ident.value).toBe(true);
  });

  it("message tiers follow the healed amount", () => {
    for (const [dice, expected] of [
      ["4", "You feel a little better."],
      ["14", "You feel better."],
      ["34", "You feel much better."],
    ] as const) {
      const { registry, env, hp, logged } = makeWorld();
      hp.chp = 1;
      hp.mhp = 100;
      const chain = new EffectBuilder().effect("HEAL_HP").dice(dice).build();
      registry.effectDo(chain, env, { origin: sourcePlayer() });
      expect(logged).toEqual([expected]);
    }
  });
});

describe("EF_DAMAGE", () => {
  it("applies reduction, reports, and hits with the right killer", () => {
    const { registry, env, player, logged } = makeWorld();
    const chain = new EffectBuilder().effect("DAMAGE").dice("10").build();
    const ident = { value: false };
    registry.effectDo(chain, env, { origin: sourcePlayer(), ident });
    expect(ident.value).toBe(true);
    expect(player.hits).toEqual([{ dam: 9, killer: "yourself" }]);
    expect(logged).toEqual(["You take 9 damage."]);
  });

  it("uses the effect msg as killer for player sources", () => {
    const { registry, env, player } = makeWorld();
    const chain = new EffectBuilder()
      .effect("DAMAGE")
      .dice("5")
      .effectMsg("hubris")
      .build();
    registry.effectDo(chain, env, { origin: sourcePlayer() });
    expect(player.hits[0]?.killer).toBe("hubris");
  });

  it("attributes SRC_NONE damage to a bug", () => {
    const { registry, env, player } = makeWorld();
    const chain = new EffectBuilder().effect("DAMAGE").dice("5").build();
    registry.effectDo(chain, env, { origin: sourceNone() });
    expect(player.hits[0]?.killer).toBe("a bug");
  });
});

describe("EF_TIMED_* family", () => {
  it("TIMED_INC rolls dice and passes check=true", () => {
    const { registry, env, timed } = makeWorld();
    const chain = new EffectBuilder()
      .effect("TIMED_INC:OPP_FIRE")
      .dice("20+1d20")
      .build();
    const ident = { value: false };
    registry.effectDo(chain, env, { origin: sourcePlayer(), ident, aware: true });
    expect(ident.value).toBe(true);
    expect(timed.calls).toHaveLength(1);
    const call = timed.calls[0] as TimedCall;
    expect(call.op).toBe("inc");
    expect(call.idx).toBe(TMD.OPP_FIRE);
    expect(call.v).toBeGreaterThanOrEqual(21);
    expect(call.v).toBeLessThanOrEqual(40);
    expect(call.notify).toBe(true);
    expect(call.canDisturb).toBe(false);
    expect(call.check).toBe(true);
  });

  it("TIMED_INC uses `other` when the status is already active", () => {
    const { registry, env, timed } = makeWorld();
    timed.values.set(TMD.OPP_FIRE, 10);
    const chain = new EffectBuilder()
      .effect("TIMED_INC:OPP_FIRE:0:5")
      .dice("100")
      .build();
    registry.effectDo(chain, env, { origin: sourcePlayer(), aware: true });
    expect((timed.calls[0] as TimedCall).v).toBe(5);
  });

  it("TIMED_INC_NO_RES passes check=false", () => {
    const { registry, env, timed } = makeWorld();
    const chain = new EffectBuilder()
      .effect("TIMED_INC_NO_RES:STUN")
      .dice("8")
      .build();
    registry.effectDo(chain, env, { origin: sourcePlayer(), aware: true });
    expect((timed.calls[0] as TimedCall).check).toBe(false);
  });

  it("TIMED_SET clamps at zero and sets", () => {
    const { registry, env, timed } = makeWorld();
    const chain = new EffectBuilder()
      .effect("TIMED_SET:BLESSED")
      .dice("12")
      .build();
    registry.effectDo(chain, env, { origin: sourcePlayer(), aware: true });
    const call = timed.calls[0] as TimedCall;
    expect(call.op).toBe("set");
    expect(call.idx).toBe(TMD.BLESSED);
    expect(call.v).toBe(12);
  });

  it("TIMED_DEC divides the current value when `other` is set", () => {
    const { registry, env, timed } = makeWorld();
    timed.values.set(TMD.CUT, 30);
    const chain = new EffectBuilder()
      .effect("TIMED_DEC:CUT:0:4")
      .dice("999")
      .build();
    registry.effectDo(chain, env, { origin: sourcePlayer(), aware: true });
    const call = timed.calls[0] as TimedCall;
    expect(call.op).toBe("dec");
    expect(call.v).toBe(7); /* 30 / 4, truncated */
  });

  it("CURE clears the condition", () => {
    const { registry, env, timed } = makeWorld();
    const chain = new EffectBuilder().effect("CURE:POISONED").build();
    const ident = { value: false };
    registry.effectDo(chain, env, { origin: sourcePlayer(), ident, aware: true });
    const call = timed.calls[0] as TimedCall;
    expect(call.op).toBe("clear");
    expect(call.idx).toBe(TMD.POISONED);
    expect(ident.value).toBe(true);
  });

  it("marks disturbance for unaware or non-player sources", () => {
    const { registry, env, timed } = makeWorld();
    const chain = new EffectBuilder()
      .effect("TIMED_INC:POISONED")
      .dice("6")
      .build();
    registry.effectDo(chain, env, { origin: sourceMonster(3), aware: true });
    expect((timed.calls[0] as TimedCall).canDisturb).toBe(true);
  });
});

describe("EF_NOURISH", () => {
  function nourishChain(spec: string, dice: string) {
    return new EffectBuilder().effect(spec).dice(dice).build();
  }

  it("INC_BY feeds by amount * food_value with notify=false", () => {
    const { registry, env, timed } = makeWorld();
    registry.effectDo(nourishChain("NOURISH:INC_BY", "5"), env, {
      origin: sourcePlayer(),
      aware: true,
    });
    const call = timed.calls[0] as TimedCall;
    expect(call.op).toBe("inc");
    expect(call.idx).toBe(TMD.FOOD);
    expect(call.v).toBe(500);
    expect(call.notify).toBe(false);
    expect(call.check).toBe(false);
  });

  it("DEC_BY starves by amount", () => {
    const { registry, env, timed } = makeWorld();
    registry.effectDo(nourishChain("NOURISH:DEC_BY", "3"), env, {
      origin: sourcePlayer(),
      aware: true,
    });
    const call = timed.calls[0] as TimedCall;
    expect(call.op).toBe("dec");
    expect(call.v).toBe(300);
  });

  it("SET_TO vomits when losing food", () => {
    const { registry, env, timed, logged } = makeWorld();
    timed.values.set(TMD.FOOD, 900);
    registry.effectDo(nourishChain("NOURISH:SET_TO", "4"), env, {
      origin: sourcePlayer(),
      aware: true,
    });
    expect(logged).toEqual(["You vomit!"]);
    expect(timed.timed(TMD.FOOD)).toBe(400);
  });

  it("INC_TO only raises, to amount + 1", () => {
    const { registry, env, timed } = makeWorld();
    timed.values.set(TMD.FOOD, 350);
    registry.effectDo(nourishChain("NOURISH:INC_TO", "3"), env, {
      origin: sourcePlayer(),
      aware: true,
    });
    expect(timed.calls).toHaveLength(0); /* 350 >= 300: no-op */

    registry.effectDo(nourishChain("NOURISH:INC_TO", "9"), env, {
      origin: sourcePlayer(),
      aware: true,
    });
    expect(timed.timed(TMD.FOOD)).toBe(901);
  });
});

describe("EF_CRUNCH", () => {
  it("prints one of the two crunch messages", () => {
    const { registry, env, logged } = makeWorld();
    const chain = new EffectBuilder().effect("CRUNCH").build();
    const ident = { value: false };
    registry.effectDo(chain, env, { origin: sourcePlayer(), ident });
    expect(ident.value).toBe(true);
    expect([
      "It's crunchy.",
      "It nearly breaks your tooth!",
    ]).toContain(logged[0]);
  });
});

describe("EF_SET_VALUE / EF_CLEAR_VALUE", () => {
  it("pins the value for the chain until cleared", () => {
    const { registry, env, timed, hp } = makeWorld();
    hp.chp = 1;
    hp.mhp = 400;
    /*
     * Like the elixir entries in object.txt: SET_VALUE, resistances
     * using the fixed value, CLEAR_VALUE, then HEAL_HP with own dice.
     */
    const chain = new EffectBuilder()
      .effect("SET_VALUE")
      .dice("50")
      .effect("TIMED_INC:OPP_FIRE")
      .dice("1d10")
      .effect("TIMED_INC:OPP_COLD")
      .effect("CLEAR_VALUE")
      .effect("HEAL_HP")
      .dice("200")
      .build();
    registry.effectDo(chain, env, { origin: sourcePlayer(), aware: true });
    expect(timed.calls.map((c) => c.v)).toEqual([50, 50]);
    expect(hp.chp).toBe(201);
  });

  it("clears state between chains via CLEAR_VALUE only", () => {
    const { registry, env, timed } = makeWorld();
    const setOnly = new EffectBuilder().effect("SET_VALUE").dice("7").build();
    registry.effectDo(setOnly, env, { origin: sourcePlayer() });
    /* The value survives into the next chain, as the upstream static. */
    const inc = new EffectBuilder()
      .effect("TIMED_INC:STUN")
      .dice("1d4")
      .build();
    registry.effectDo(inc, env, { origin: sourcePlayer(), aware: true });
    expect((timed.calls[0] as TimedCall).v).toBe(7);

    const clear = new EffectBuilder().effect("CLEAR_VALUE").build();
    registry.effectDo(clear, env, { origin: sourcePlayer() });
    registry.effectDo(
      new EffectBuilder().effect("TIMED_INC:STUN").dice("5").build(),
      env,
      { origin: sourcePlayer(), aware: true },
    );
    expect((timed.calls[1] as TimedCall).v).toBe(5);
  });
});

describe("stub handlers", () => {
  it("record dispatches with their parameters", () => {
    const { registry, env, stubLog } = makeWorld();
    const chain = new EffectBuilder()
      .effect("EARTHQUAKE:TARGETED:10")
      .dice("0")
      .build();
    const done = registry.effectDo(chain, env, { origin: sourcePlayer() });
    expect(done).toBe(true);
    expect(stubLog).toHaveLength(1);
    const call = stubLog[0] as StubCall;
    expect(call.name).toBe("EARTHQUAKE");
    expect(call.code).toBe(EF.EARTHQUAKE);
    expect(call.subtype).toBe(1);
    expect(call.radius).toBe(10);
  });

  it("leave ident untouched", () => {
    const { registry, env } = makeWorld();
    const ident = { value: false };
    const chain = new EffectBuilder().effect("DETECT_TRAPS").build();
    registry.effectDo(chain, env, { origin: sourcePlayer(), ident });
    expect(ident.value).toBe(false);
  });
});

describe("coverage manifest", () => {
  it("accounts for every upstream effect exactly once", () => {
    const { implemented, partial, stubbed, total } = EFFECT_HANDLER_MANIFEST;
    expect(total).toBe(EFFECT_ENTRIES.length);
    expect(implemented.length + partial.length + stubbed.length).toBe(total);
    const all = new Set([...implemented, ...partial, ...stubbed]);
    expect(all.size).toBe(total);
  });

  it("matches the registry's registered coverage", () => {
    const registry = new EffectRegistry();
    registerCoreHandlers(registry);
    const coverage = registry.coverage();
    expect(coverage.implemented).toBe(
      EFFECT_HANDLER_MANIFEST.implemented.length,
    );
    expect(coverage.partial).toBe(EFFECT_HANDLER_MANIFEST.partial.length);
    expect(coverage.stub).toBe(EFFECT_HANDLER_MANIFEST.stubbed.length);
    expect(registry.codes()).toHaveLength(EFFECT_ENTRIES.length);
  });
});
