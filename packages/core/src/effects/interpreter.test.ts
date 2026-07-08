import { describe, expect, it } from "vitest";

import { EF } from "../generated";
import { Rng } from "../rng";
import { EffectBuilder, effectNew } from "./effect";
import type {
  EffectContext,
  EffectHandlerContext,
  StubCall,
} from "./interpreter";
import {
  DIR_TARGET,
  EffectRegistry,
  effectCalculateValue,
  sourceMonster,
  sourceNone,
  sourcePlayer,
} from "./interpreter";
import { registerCoreHandlers } from "./handlers";

function makeEnv(seed = 42): EffectContext {
  return { rng: new Rng(seed) };
}

function coreRegistry(): EffectRegistry {
  const registry = new EffectRegistry();
  registerCoreHandlers(registry);
  return registry;
}

/** A registry where every named code records dispatch order. */
function recordingRegistry(codes: (number | string)[]): {
  registry: EffectRegistry;
  calls: { code: number | string; value: number }[];
} {
  const registry = new EffectRegistry();
  const calls: { code: number | string; value: number }[] = [];
  for (const code of codes) {
    registry.register(code, {
      handler: (context: EffectHandlerContext) => {
        calls.push({
          code,
          value: effectCalculateValue(context, false),
        });
        return true;
      },
    });
  }
  return { registry, calls };
}

describe("effectDo chain walking", () => {
  it("walks the chain in order and reports completion", () => {
    const { registry, calls } = recordingRegistry([
      EF.DETECT_TRAPS,
      EF.DETECT_DOORS,
      EF.DETECT_STAIRS,
    ]);
    const chain = new EffectBuilder()
      .effect("DETECT_TRAPS")
      .effect("DETECT_DOORS")
      .effect("DETECT_STAIRS")
      .build();
    const done = registry.effectDo(chain, makeEnv(), {
      origin: sourcePlayer(),
    });
    expect(done).toBe(true);
    expect(calls.map((c) => c.code)).toEqual([
      EF.DETECT_TRAPS,
      EF.DETECT_DOORS,
      EF.DETECT_STAIRS,
    ]);
  });

  it("reports the bad-effect message and false on an invalid chain", () => {
    const registry = coreRegistry();
    const logged: string[] = [];
    const env: EffectContext = {
      rng: new Rng(1),
      messages: { msg: (t) => logged.push(t) },
    };
    expect(
      registry.effectDo(effectNew(0), env, { origin: sourceNone() }),
    ).toBe(false);
    expect(logged).toEqual([
      "Bad effect passed to effect_do(). Please report this bug.",
    ]);
  });

  it("skips valid upstream codes with no registered handler", () => {
    const { registry, calls } = recordingRegistry([EF.DETECT_DOORS]);
    /* DETECT_TRAPS is valid but unregistered here: handler NULL, skip. */
    const chain = new EffectBuilder()
      .effect("DETECT_TRAPS")
      .effect("DETECT_DOORS")
      .build();
    const done = registry.effectDo(chain, makeEnv(), {
      origin: sourcePlayer(),
    });
    expect(done).toBe(true);
    expect(calls.map((c) => c.code)).toEqual([EF.DETECT_DOORS]);
  });
});

describe("EF_RANDOM selection", () => {
  function randomChain() {
    return new EffectBuilder()
      .effect("RANDOM")
      .dice("3")
      .effect("DETECT_TRAPS")
      .effect("DETECT_DOORS")
      .effect("DETECT_STAIRS")
      .effect("DETECT_GOLD")
      .build();
  }

  it("picks with randint0(choice_count) exactly as upstream", () => {
    const seed = 1234;
    const driver = new Rng(seed);
    const mirror = new Rng(seed);
    const subCodes = [EF.DETECT_TRAPS, EF.DETECT_DOORS, EF.DETECT_STAIRS];

    for (let trial = 0; trial < 200; trial++) {
      const { registry, calls } = recordingRegistry([
        ...subCodes,
        EF.DETECT_GOLD,
      ]);
      const done = registry.effectDo(randomChain(), { rng: driver }, {
        origin: sourcePlayer(),
      });
      expect(done).toBe(true);

      /*
       * Mirror the upstream algorithm: dice "3" is pure base so the
       * roll consumes no RNG; the choice is randint0(3).
       */
      const expected = mirror.randint0(3);
      expect(calls.map((c) => c.code)).toEqual([
        subCodes[expected],
        EF.DETECT_GOLD,
      ]);
    }
  });

  it("covers all subeffects over many trials", () => {
    const rng = new Rng(777);
    const seen = new Set<number | string>();
    for (let trial = 0; trial < 100; trial++) {
      const { registry, calls } = recordingRegistry([
        EF.DETECT_TRAPS,
        EF.DETECT_DOORS,
        EF.DETECT_STAIRS,
        EF.DETECT_GOLD,
      ]);
      registry.effectDo(randomChain(), { rng }, { origin: sourcePlayer() });
      expect(calls).toHaveLength(2);
      seen.add((calls[0] as { code: number | string }).code);
    }
    expect(seen).toEqual(
      new Set([EF.DETECT_TRAPS, EF.DETECT_DOORS, EF.DETECT_STAIRS]),
    );
  });

  it("continues after the subeffect block via leftover skipping", () => {
    /* RANDOM with 2 subeffects, then a tail effect that must always run. */
    const { registry, calls } = recordingRegistry([
      EF.DETECT_TRAPS,
      EF.DETECT_DOORS,
      EF.LIGHT_AREA,
    ]);
    const chain = new EffectBuilder()
      .effect("RANDOM")
      .dice("2")
      .effect("DETECT_TRAPS")
      .effect("DETECT_DOORS")
      .effect("LIGHT_AREA")
      .build();
    const rng = new Rng(9);
    for (let trial = 0; trial < 25; trial++) {
      calls.length = 0;
      registry.effectDo(chain, { rng }, { origin: sourcePlayer() });
      expect(calls).toHaveLength(2);
      expect([EF.DETECT_TRAPS, EF.DETECT_DOORS]).toContain(
        (calls[0] as { code: number | string }).code,
      );
      expect((calls[1] as { code: number | string }).code).toBe(EF.LIGHT_AREA);
    }
  });

  it("treats RANDOM with no subeffects as completed", () => {
    const { registry, calls } = recordingRegistry([EF.LIGHT_AREA]);
    const chain = new EffectBuilder()
      .effect("RANDOM")
      .effect("LIGHT_AREA")
      .build();
    /* RANDOM has no dice: choice_count 0, acts completed, moves on. */
    const done = registry.effectDo(chain, makeEnv(), {
      origin: sourcePlayer(),
    });
    expect(done).toBe(true);
    expect(calls.map((c) => c.code)).toEqual([EF.LIGHT_AREA]);
  });

  it("acts completed when there are fewer subeffects than the count", () => {
    const { registry, calls } = recordingRegistry([EF.DETECT_TRAPS]);
    const chain = new EffectBuilder()
      .effect("RANDOM")
      .dice("5")
      .effect("DETECT_TRAPS")
      .build();
    /* Find a trial where the choice overruns the single subeffect. */
    const rng = new Rng(5);
    let sawOverrun = false;
    for (let trial = 0; trial < 40 && !sawOverrun; trial++) {
      calls.length = 0;
      const done = registry.effectDo(chain, { rng }, {
        origin: sourcePlayer(),
      });
      expect(done).toBe(true);
      if (calls.length === 0) sawOverrun = true;
    }
    expect(sawOverrun).toBe(true);
  });
});

describe("EF_SELECT semantics", () => {
  function selectChain() {
    return new EffectBuilder()
      .effect("SELECT")
      .dice("2")
      .effect("DETECT_TRAPS")
      .effect("DETECT_DOORS")
      .build();
  }

  it("honors an injected chooser for player-sourced selects", () => {
    const { registry, calls } = recordingRegistry([
      EF.DETECT_TRAPS,
      EF.DETECT_DOORS,
    ]);
    const ident = { value: false };
    const env: EffectContext = {
      rng: new Rng(3),
      chooseEffect: (first, count) => {
        expect(first?.index).toBe(EF.DETECT_TRAPS);
        expect(count).toBe(2);
        return 1;
      },
    };
    const done = registry.effectDo(selectChain(), env, {
      origin: sourcePlayer(),
      ident,
    });
    expect(done).toBe(true);
    expect(calls.map((c) => c.code)).toEqual([EF.DETECT_DOORS]);
    /* Presenting a choice allows identification even before dispatch. */
    expect(ident.value).toBe(true);
  });

  it("aborts and returns false when the chooser returns -1", () => {
    const { registry, calls } = recordingRegistry([
      EF.DETECT_TRAPS,
      EF.DETECT_DOORS,
    ]);
    const env: EffectContext = { rng: new Rng(3), chooseEffect: () => -1 };
    const done = registry.effectDo(selectChain(), env, {
      origin: sourcePlayer(),
    });
    expect(done).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rolls randomly when the chooser answers -2 or is absent", () => {
    for (const env of [
      { rng: new Rng(11), chooseEffect: () => -2 } as EffectContext,
      { rng: new Rng(11) } as EffectContext,
    ]) {
      const { registry, calls } = recordingRegistry([
        EF.DETECT_TRAPS,
        EF.DETECT_DOORS,
      ]);
      const done = registry.effectDo(selectChain(), env, {
        origin: sourcePlayer(),
      });
      expect(done).toBe(true);
      expect(calls).toHaveLength(1);
    }
  });

  it("treats non-player selects as random (no chooser consulted)", () => {
    const { registry, calls } = recordingRegistry([
      EF.DETECT_TRAPS,
      EF.DETECT_DOORS,
    ]);
    let consulted = false;
    const env: EffectContext = {
      rng: new Rng(3),
      chooseEffect: () => {
        consulted = true;
        return 0;
      },
    };
    registry.effectDo(selectChain(), env, { origin: sourceMonster(4) });
    expect(consulted).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("dice and value passing", () => {
  it("hands the rolled RandomValue to the handler, not the total", () => {
    const registry = new EffectRegistry();
    let seen: EffectHandlerContext | null = null;
    registry.register(EF.DAMAGE, {
      handler: (context) => {
        seen = context;
        return true;
      },
    });
    const chain = new EffectBuilder().effect("DAMAGE").dice("4d6").build();
    registry.effectDo(chain, makeEnv(), { origin: sourceNone() });
    const context = seen as unknown as EffectHandlerContext;
    expect(context.value).toEqual({ base: 0, dice: 4, sides: 6, mBonus: 0 });
  });

  it("carries the previous roll into a dice-less next effect", () => {
    /* Upstream keeps `value` across the loop; no dice means no re-roll. */
    const { registry, calls } = recordingRegistry([
      EF.DAMAGE,
      EF.DETECT_TRAPS,
    ]);
    const chain = new EffectBuilder()
      .effect("DAMAGE")
      .dice("25")
      .effect("DETECT_TRAPS")
      .build();
    registry.effectDo(chain, makeEnv(), { origin: sourceNone() });
    expect(calls.map((c) => c.value)).toEqual([25, 25]);
  });

  it("effectCalculateValue applies the device boost with int division", () => {
    const registry = new EffectRegistry();
    const results: number[] = [];
    registry.register(EF.DAMAGE, {
      handler: (context) => {
        results.push(effectCalculateValue(context, true));
        return true;
      },
    });
    const chain = new EffectBuilder().effect("DAMAGE").dice("10").build();
    registry.effectDo(chain, makeEnv(), {
      origin: sourceNone(),
      boost: 17,
    });
    /* 10 * 117 / 100 = 11 (trunc). */
    expect(results).toEqual([11]);
  });
});

describe("ident semantics", () => {
  it("accumulates ident across the chain and never resets it", () => {
    const registry = new EffectRegistry();
    const observed: boolean[] = [];
    registry.register(EF.DETECT_TRAPS, {
      handler: (context) => {
        observed.push(context.ident);
        context.ident = true;
        return true;
      },
    });
    registry.register(EF.DETECT_DOORS, {
      handler: (context) => {
        observed.push(context.ident);
        /* Attempting to clear it must not propagate as false... */
        return true;
      },
    });
    const ident = { value: false };
    const chain = new EffectBuilder()
      .effect("DETECT_TRAPS")
      .effect("DETECT_DOORS")
      .build();
    registry.effectDo(chain, makeEnv(), { origin: sourcePlayer(), ident });
    expect(observed).toEqual([false, true]);
    expect(ident.value).toBe(true);
  });
});

describe("mod effects (runtime registration)", () => {
  it("dispatches a custom string-coded effect inside a chain", () => {
    const registry = coreRegistry();
    const sparkles: number[] = [];
    registry.register("MOD_SPARKLE", {
      handler: (context) => {
        sparkles.push(effectCalculateValue(context, false));
        context.ident = true;
        return true;
      },
      aim: false,
      desc: "sparkles brightly",
    });

    const chain = new EffectBuilder({
      lookupEffect: (name) => (name === "MOD_SPARKLE" ? name : null),
    })
      .effect("MOD_SPARKLE")
      .dice("15")
      .effect("CRUNCH")
      .build();

    const ident = { value: false };
    const env: EffectContext = { rng: new Rng(2), messages: { msg: () => {} } };
    const done = registry.effectDo(chain, env, {
      origin: sourcePlayer(),
      ident,
    });
    expect(done).toBe(true);
    expect(sparkles).toEqual([15]);
    expect(ident.value).toBe(true);
    expect(registry.isValidEffect(effectNew("MOD_SPARKLE"))).toBe(true);
    expect(registry.isValidEffect(effectNew("MOD_UNKNOWN"))).toBe(false);
    expect(registry.effectDesc(effectNew("MOD_SPARKLE"))).toBe(
      "sparkles brightly",
    );
  });

  it("rejects degenerate codes", () => {
    const registry = new EffectRegistry();
    expect(() => registry.register(0, { handler: () => true })).toThrow();
    expect(() => registry.register("", { handler: () => true })).toThrow();
  });
});

describe("effectAim and metadata", () => {
  it("uses list-effects.h aim data and chain semantics", () => {
    const registry = coreRegistry();
    const notAimed = new EffectBuilder().effect("HEAL_HP").build();
    expect(registry.effectAim(notAimed)).toBe(false);
    const aimed = new EffectBuilder()
      .effect("HEAL_HP")
      .effect("BOLT:FIRE")
      .build();
    expect(registry.effectAim(aimed)).toBe(true);
    expect(registry.effectInfo(new EffectBuilder().effect("HEAL_HP").build()))
      .toBe("heal");
  });
});

describe("effectSimple", () => {
  it("builds a one-shot effect and runs it", () => {
    const registry = coreRegistry();
    const stubLog: StubCall[] = [];
    const env: EffectContext = { rng: new Rng(6), stubLog };
    const ident = { value: false };
    const done = registry.effectSimple(EF.DETECT_TRAPS, env, {
      origin: sourcePlayer(),
      diceString: "0",
      radius: 3,
      ident,
    });
    expect(done).toBe(true);
    expect(stubLog).toHaveLength(1);
    expect(stubLog[0]?.name).toBe("DETECT_TRAPS");
    expect(stubLog[0]?.radius).toBe(3);
    expect(stubLog[0]?.dir).toBe(DIR_TARGET);
  });

  it("asks the injected aim provider for aimed effects", () => {
    const registry = coreRegistry();
    const stubLog: StubCall[] = [];
    const env: EffectContext = {
      rng: new Rng(6),
      stubLog,
      getAimDir: () => 2,
    };
    registry.effectSimple(EF.BOLT, env, {
      origin: sourcePlayer(),
      diceString: "4d6",
      subtype: 1,
    });
    expect(stubLog[0]?.dir).toBe(2);
  });
});
