import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_RAND_DEPTH, RAND_DEG, Rng, RngStreams, randomChanceScaled } from "./rng";

interface SeedVectors {
  state_after_init: number[];
  state_i_after_init: number;
  raw28: number[];
  div10: number[];
  div6: number[];
  div100: number[];
  normal_100_10: number[];
  damroll_3d6: number[];
  mbonus_10_50: number[];
  rand_range_5_15: number[];
  sample_10_20_0_15_10: number[];
}

interface Vectors {
  baseline: string;
  source: string;
  seeds: Record<string, SeedVectors>;
  quick_seed_42: { div100: number[]; final_value: number };
  fixed: Record<string, Record<string, number>>;
}

const vectors: Vectors = JSON.parse(
  readFileSync(new URL("../vectors/rng-vectors.json", import.meta.url), "utf8"),
);

describe("Rng golden vectors (oracle: scripts/gen-rng-vectors.py)", () => {
  for (const [seedText, v] of Object.entries(vectors.seeds)) {
    const seed = Number(seedText);
    it(`replays the full sequence for seed ${seedText}`, () => {
      const rng = new Rng(seed);
      const snap = rng.getState();
      expect(snap.state).toEqual(v.state_after_init);
      expect(snap.stateI).toBe(v.state_i_after_init);

      // Order matters: one stream, consumed exactly like the oracle.
      expect(v.raw28.map(() => rng.randDiv(0x10000000))).toEqual(v.raw28);
      expect(v.div10.map(() => rng.randDiv(10))).toEqual(v.div10);
      expect(v.div6.map(() => rng.randDiv(6))).toEqual(v.div6);
      expect(v.div100.map(() => rng.randDiv(100))).toEqual(v.div100);
      expect(v.normal_100_10.map(() => rng.randNormal(100, 10))).toEqual(
        v.normal_100_10,
      );
      expect(v.damroll_3d6.map(() => rng.damroll(3, 6))).toEqual(
        v.damroll_3d6,
      );
      expect(v.mbonus_10_50.map(() => rng.mBonus(10, 50))).toEqual(
        v.mbonus_10_50,
      );
      expect(v.rand_range_5_15.map(() => rng.randRange(5, 15))).toEqual(
        v.rand_range_5_15,
      );
      expect(
        v.sample_10_20_0_15_10.map(() => rng.randSample(10, 20, 0, 15, 10)),
      ).toEqual(v.sample_10_20_0_15_10);
    });
  }

  it("replays the quick (LCRNG) stream for seed 42", () => {
    const rng = new Rng(42, { quick: true });
    const q = vectors.quick_seed_42;
    expect(q.div100.map(() => rng.randDiv(100))).toEqual(q.div100);
    expect(rng.getState().value).toBe(q.final_value);
  });

  it("matches rand_fix uint32 wrap semantics", () => {
    for (const [valText, byM] of Object.entries(vectors.fixed)) {
      const rng = new Rng(1);
      rng.randFix(Number(valText));
      for (const [mText, expected] of Object.entries(byM)) {
        expect(rng.randDiv(Number(mText))).toBe(expected);
      }
    }
  });
});

describe("Rng invariants", () => {
  it("randint0/randint1/oneIn relate as the upstream macros do", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 200; i++) {
      expect(a.randint1(6)).toBe(b.randint0(6) + 1);
    }
    const c = new Rng(9);
    const d = new Rng(9);
    for (let i = 0; i < 200; i++) {
      expect(c.oneIn(4)).toBe(d.randint0(4) === 0);
    }
  });

  it("randSpread stays within [A-D, A+D]", () => {
    const rng = new Rng(11);
    for (let i = 0; i < 500; i++) {
      const x = rng.randSpread(10, 3);
      expect(x).toBeGreaterThanOrEqual(7);
      expect(x).toBeLessThanOrEqual(13);
    }
  });

  it("randDiv edge cases match upstream", () => {
    const rng = new Rng(1);
    expect(rng.randDiv(0)).toBe(0);
    expect(rng.randDiv(1)).toBe(0);
    expect(() => rng.randDiv(0x10000001)).toThrow(RangeError);
  });

  it("state round-trips through getState/setState", () => {
    const rng = new Rng(31415);
    for (let i = 0; i < 37; i++) rng.randDiv(100);
    const snap = rng.getState();
    const replay = new Rng(0);
    replay.setState(snap);
    const expected = Array.from({ length: 50 }, () => rng.randDiv(1000));
    const actual = Array.from({ length: 50 }, () => replay.randDiv(1000));
    expect(actual).toEqual(expected);
  });

  it("damcalc/mBonusCalc/randcalc aspects match upstream formulas", () => {
    const rng = new Rng(5);
    expect(rng.damcalc(3, 6, "maximise")).toBe(18);
    expect(rng.damcalc(3, 6, "minimise")).toBe(3);
    expect(rng.damcalc(3, 6, "average")).toBe(10);
    expect(rng.mBonusCalc(10, 64, "average")).toBe(5);
    expect(rng.mBonusCalc(10, 64, "maximise")).toBe(10);
    const v = { base: 2, dice: 3, sides: 6, mBonus: 4 };
    expect(rng.randcalc(v, 0, "minimise")).toBe(5);
    expect(rng.randcalc(v, 0, "maximise")).toBe(24);
    expect(rng.randcalcValid(v, 5)).toBe(true);
    expect(rng.randcalcValid(v, 4)).toBe(false);
    expect(rng.randcalcValid(v, 25)).toBe(false);
    expect(rng.randcalcVaries(v)).toBe(true);
    expect(
      rng.randcalcVaries({ base: 5, dice: 0, sides: 0, mBonus: 0 }),
    ).toBe(false);
  });

  it("randomChanceScaled matches the upstream example", () => {
    expect(randomChanceScaled({ numerator: 7, denominator: 13 }, 100)).toBe(
      53,
    );
    expect(randomChanceScaled({ numerator: 7, denominator: 13 }, 1000)).toBe(
      538,
    );
  });

  it("exports upstream constants", () => {
    expect(MAX_RAND_DEPTH).toBe(128);
    expect(RAND_DEG).toBe(32);
  });
});

describe("RngStreams", () => {
  it("streams are independent and serializable", () => {
    const streams = new RngStreams();
    streams.create("game", 1);
    streams.create("flavor", 2);
    const before = streams.get("game").randDiv(1000);
    // Consuming one stream must not disturb another.
    const fresh = new Rng(2);
    expect(streams.get("flavor").randDiv(1000)).toBe(fresh.randDiv(1000));

    const snap = streams.getState();
    const restored = new RngStreams();
    restored.setState(snap);
    expect(restored.names().sort()).toEqual(["flavor", "game"]);
    const a = Array.from({ length: 20 }, () =>
      streams.get("game").randDiv(500),
    );
    const b = Array.from({ length: 20 }, () =>
      restored.get("game").randDiv(500),
    );
    expect(b).toEqual(a);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it("get throws on unknown stream", () => {
    expect(() => new RngStreams().get("nope")).toThrow();
  });
});
