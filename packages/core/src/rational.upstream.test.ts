/**
 * Upstream unit tests from reference/src/tests/z-util/rational.c (suite
 * z-util/rational) and reference/src/tests/z-util/meanvar.c (suite
 * z-util/meanvar).
 *
 * Mapping: my_rational_construct -> myRationalConstruct;
 * my_rational_to_uint -> myRationalToUint (the `remainder` out-parameter
 * becomes an optional { remainder } object, and omitting it is the C's NULL);
 * my_rational_product -> myRationalProduct; my_rational_sum -> myRationalSum;
 * mean -> mean; variance -> variance. The `struct my_rational *frac`
 * out-parameter of mean/variance stays an out-parameter (a MyRational the
 * callee mutates) because passing NULL vs non-NULL selects a DIFFERENT ROUNDING
 * RULE upstream, and both rules are asserted here.
 *
 * UINT_MAX / INT_MAX behaviour is asserted, not skipped. The C reaches those
 * rails through a 16-bit-limb multiprecision fallback; rational.ts reaches the
 * same values through BigInt, so the saturation points and the deliberately
 * APPROXIMATE overflow results (rescale to the largest fitting denominator,
 * then round to nearest) are the same values here as there.
 */

import { describe, expect, it } from "vitest";
import { INT_MAX, INT_MIN, UINT32_MAX } from "./guard.js";
import {
  mean,
  myRationalConstruct,
  myRationalProduct,
  myRationalSum,
  myRationalToUint,
  variance,
} from "./rational.js";
import type { MyRational } from "./rational.js";

/** A fresh out-parameter; the C declares `struct my_rational f;` uninitialised. */
function outFrac(): MyRational {
  return { n: -1, d: -1 };
}

const UINT_MAX = UINT32_MAX;

describe("z-util/rational upstream", () => {
  // C: test_rational_construct
  it("test_rational_construct", () => {
    let result = myRationalConstruct(0, 1);
    expect(result.n).toBe(0);
    expect(result.d).toBe(1);
    result = myRationalConstruct(1, 1);
    expect(result.n).toBe(1);
    expect(result.d).toBe(1);
    result = myRationalConstruct(105, 441);
    expect(result.n).toBe(5);
    expect(result.d).toBe(21);
  });

  // C: test_rational_to_uint
  it("test_rational_to_uint", () => {
    const rem = { remainder: -1 };

    let arg = myRationalConstruct(0, 1);
    expect(myRationalToUint(arg, 0)).toBe(0);
    expect(myRationalToUint(arg, 0, rem)).toBe(0);
    expect(rem.remainder).toBe(0);
    expect(myRationalToUint(arg, 1)).toBe(0);
    expect(myRationalToUint(arg, 1, rem)).toBe(0);
    expect(rem.remainder).toBe(0);
    expect(myRationalToUint(arg, 100)).toBe(0);
    expect(myRationalToUint(arg, 100, rem)).toBe(0);
    expect(rem.remainder).toBe(0);

    arg = myRationalConstruct(9, 5);
    expect(myRationalToUint(arg, 1)).toBe(1);
    expect(myRationalToUint(arg, 1, rem)).toBe(1);
    expect(rem.remainder).toBe(4);
    expect(myRationalToUint(arg, 4)).toBe(7);
    expect(myRationalToUint(arg, 4, rem)).toBe(7);
    expect(rem.remainder).toBe(1);
    expect(myRationalToUint(arg, 17)).toBe(30);
    expect(myRationalToUint(arg, 17, rem)).toBe(30);
    expect(rem.remainder).toBe(3);

    /* Saturation at UINT_MAX, and the remainder is zeroed when it saturates. */
    arg = myRationalConstruct(UINT_MAX - 5, 8);
    expect(myRationalToUint(arg, 15)).toBe(UINT_MAX);
    expect(myRationalToUint(arg, 15, rem)).toBe(UINT_MAX);
    expect(rem.remainder).toBe(0);

    /* Hits the multiprecision remainder-product branch (z-util.c L1751). */
    arg = myRationalConstruct(UINT_MAX - 7, UINT_MAX - 6);
    expect(myRationalToUint(arg, 24)).toBe(23);
    expect(myRationalToUint(arg, 24, rem)).toBe(23);
    expect(rem.remainder).toBe(UINT_MAX - 30);

    arg = myRationalConstruct(UINT_MAX, UINT_MAX - 1);
    expect(myRationalToUint(arg, UINT_MAX)).toBe(UINT_MAX);
    expect(myRationalToUint(arg, UINT_MAX, rem)).toBe(UINT_MAX);
    expect(rem.remainder).toBe(0);

    arg = myRationalConstruct(3, 8);
    /* 3 * 2^(32-3) - 1 */
    const expected = 3 * 2 ** 29 - 1;
    expect(myRationalToUint(arg, UINT_MAX)).toBe(expected);
    expect(myRationalToUint(arg, UINT_MAX, rem)).toBe(expected);
    expect(rem.remainder).toBe(5);
  });

  // C: test_rational_product
  it("test_rational_product", () => {
    let arg1 = myRationalConstruct(0, 5);
    let arg2 = myRationalConstruct(1, 1);
    expect(myRationalProduct(arg1, arg2).n).toBe(0);
    expect(myRationalProduct(arg2, arg1).n).toBe(0);

    arg1 = myRationalConstruct(1, 9);
    arg2 = myRationalConstruct(2, 7);
    expect(myRationalProduct(arg1, arg2)).toEqual({ n: 2, d: 63 });
    expect(myRationalProduct(arg2, arg1)).toEqual({ n: 2, d: 63 });

    arg1 = myRationalConstruct(39, 64);
    arg2 = myRationalConstruct(7, 13);
    expect(myRationalProduct(arg1, arg2)).toEqual({ n: 21, d: 64 });
    expect(myRationalProduct(arg2, arg1)).toEqual({ n: 21, d: 64 });

    arg1 = myRationalConstruct(5, 4);
    arg2 = myRationalConstruct(6, 35);
    expect(myRationalProduct(arg1, arg2)).toEqual({ n: 3, d: 14 });
    expect(myRationalProduct(arg2, arg1)).toEqual({ n: 3, d: 14 });

    /* From here the C falls back to multiprecision and APPROXIMATES. */
    arg1 = myRationalConstruct(UINT_MAX - 1, UINT_MAX);
    arg2 = myRationalConstruct(UINT_MAX - 1, UINT_MAX - 2);
    expect(myRationalProduct(arg1, arg2)).toEqual({ n: 1, d: 1 });
    expect(myRationalProduct(arg2, arg1)).toEqual({ n: 1, d: 1 });

    arg1 = myRationalConstruct(1, UINT_MAX);
    arg2 = myRationalConstruct(1, UINT_MAX - 1);
    expect(myRationalProduct(arg1, arg2)).toEqual({ n: 0, d: 1 });

    arg1 = myRationalConstruct(UINT_MAX, 3);
    arg2 = myRationalConstruct(UINT_MAX - 1, 7);
    expect(myRationalProduct(arg1, arg2)).toEqual({ n: UINT_MAX, d: 1 });
  });

  // C: test_rational_sum
  it("test_rational_sum", () => {
    let arg1 = myRationalConstruct(0, 7);
    let arg2 = myRationalConstruct(1, 1);
    expect(myRationalSum(arg1, arg2)).toEqual({ n: 1, d: 1 });
    expect(myRationalSum(arg2, arg1)).toEqual({ n: 1, d: 1 });

    arg1 = myRationalConstruct(9, 17);
    arg2 = myRationalConstruct(3, 5);
    expect(myRationalSum(arg1, arg2)).toEqual({ n: 96, d: 85 });
    expect(myRationalSum(arg2, arg1)).toEqual({ n: 96, d: 85 });

    arg1 = myRationalConstruct(3, 8);
    arg2 = myRationalConstruct(5, 4);
    expect(myRationalSum(arg1, arg2)).toEqual({ n: 13, d: 8 });
    expect(myRationalSum(arg2, arg1)).toEqual({ n: 13, d: 8 });

    arg1 = myRationalConstruct(3, 14);
    arg2 = myRationalConstruct(7, 30);
    expect(myRationalSum(arg1, arg2)).toEqual({ n: 47, d: 105 });
    expect(myRationalSum(arg2, arg1)).toEqual({ n: 47, d: 105 });

    /* The approximating path, including its round-to-nearest step. */
    arg1 = myRationalConstruct(UINT_MAX - 1, UINT_MAX);
    arg2 = myRationalConstruct(UINT_MAX - 2, UINT_MAX);
    expect(myRationalSum(arg1, arg2)).toEqual({
      n: UINT_MAX - 2,
      d: Math.trunc(UINT_MAX / 2),
    });

    arg1 = myRationalConstruct(1, UINT_MAX);
    arg2 = myRationalConstruct(1, UINT_MAX - 1);
    expect(myRationalSum(arg1, arg2)).toEqual({ n: 2, d: UINT_MAX });

    arg1 = myRationalConstruct(UINT_MAX - 1, 1);
    arg2 = myRationalConstruct(17, 8);
    expect(myRationalSum(arg1, arg2)).toEqual({ n: UINT_MAX, d: 1 });
  });
});

describe("z-util/meanvar upstream", () => {
  // C: test_mean_trivial
  it("test_mean_trivial", () => {
    const f = outFrac();
    /* A non-positive size returns zero and a zero fraction, reading nothing. */
    expect(mean([], -10, null)).toBe(0);
    expect(mean([], -10, f)).toBe(0);
    expect(f).toEqual({ n: 0, d: 1 });
    expect(mean([], 0, null)).toBe(0);
    expect(mean([], 0, f)).toBe(0);
    expect(f).toEqual({ n: 0, d: 1 });
  });

  // C: test_mean_simple
  it("test_mean_simple", () => {
    const case1 = [5];
    const case2 = [0, 0, 0, 0];
    const case3 = [-3, 4, -7];
    const case4 = [4, -7, 5, -1, 3];
    const case5 = [2, 3, 2, 2, 2, 3];
    const case6 = [-1, 0, 1, -1];
    const case7 = [-4, -5, -6, -4, -5];
    const f = outFrac();

    expect(mean(case1, case1.length, null)).toBe(5);
    expect(mean(case1, case1.length, f)).toBe(5);
    expect(f).toEqual({ n: 0, d: 1 });

    expect(mean(case2, case2.length, null)).toBe(0);
    expect(mean(case2, case2.length, f)).toBe(0);
    expect(f).toEqual({ n: 0, d: 1 });

    expect(mean(case3, case3.length, null)).toBe(-2);
    expect(mean(case3, case3.length, f)).toBe(-2);
    expect(f).toEqual({ n: 0, d: 1 });

    /* 4/5: round-to-nearest gives 1, floor-plus-fraction gives 0 + 4/5. */
    expect(mean(case4, case4.length, null)).toBe(1);
    expect(mean(case4, case4.length, f)).toBe(0);
    expect(f).toEqual({ n: 4, d: 5 });

    expect(mean(case5, case5.length, null)).toBe(2);
    expect(mean(case5, case5.length, f)).toBe(2);
    expect(f).toEqual({ n: 1, d: 3 });

    /* -1/4: nearest is 0, but the floor is -1 with a fraction of 3/4. */
    expect(mean(case6, case6.length, null)).toBe(0);
    expect(mean(case6, case6.length, f)).toBe(-1);
    expect(f).toEqual({ n: 3, d: 4 });

    expect(mean(case7, case7.length, null)).toBe(-5);
    expect(mean(case7, case7.length, f)).toBe(-5);
    expect(f).toEqual({ n: 1, d: 5 });
  });

  // C: test_mean_overflow
  it("test_mean_overflow", () => {
    /* Combinations that would trigger overflow with naive implementations. */
    const case1 = [INT_MIN, INT_MIN, INT_MIN];
    const case2 = [INT_MAX, INT_MAX, INT_MAX, INT_MAX];
    const case3 = [INT_MAX, INT_MAX, INT_MAX, INT_MIN, INT_MIN, INT_MIN];
    const f = outFrac();

    expect(mean(case1, case1.length, null)).toBe(INT_MIN);
    expect(mean(case1, case1.length, f)).toBe(INT_MIN);
    expect(f).toEqual({ n: 0, d: 1 });

    expect(mean(case2, case2.length, null)).toBe(INT_MAX);
    expect(mean(case2, case2.length, f)).toBe(INT_MAX);
    expect(f).toEqual({ n: 0, d: 1 });

    /*
     * INT_MIN + INT_MAX is -1, so the C takes its `< 0` branch with an odd
     * total: round-to-nearest is trunc(-1/2) == 0 and the floor is -1 with a
     * fraction of 1/2.
     */
    expect(INT_MIN + INT_MAX).toBe(-1);
    expect(mean(case3, case3.length, null)).toBe(-1);
    expect(mean(case3, case3.length, f)).toBe(-1);
    expect(f).toEqual({ n: 1, d: 2 });
  });

  // C: test_variance_trivial
  it("test_variance_trivial", () => {
    const f = outFrac();
    /* Sizes below 2 have no variance, for every flag combination. */
    for (const size of [-8, 0, 1]) {
      for (const unbiased of [false, true]) {
        for (const ofMean of [false, true]) {
          expect(variance([], size, unbiased, ofMean, null)).toBe(0);
          expect(variance([], size, unbiased, ofMean, f)).toBe(0);
          expect(f).toEqual({ n: 0, d: 1 });
        }
      }
    }
  });

  // C: test_variance_simple
  it("test_variance_simple", () => {
    const f = outFrac();
    /*
     * Each row is [values, then for (unbiased, ofMean) in
     * (F,F) (T,F) (F,T) (T,T): the round-to-nearest result, then the floored
     * result with its fraction]. Taken assertion-for-assertion from the C.
     */
    type Row = {
      nums: number[];
      nearest: [number, number, number, number];
      floored: [number, number, number, number];
      frac: [[number, number], [number, number], [number, number], [number, number]];
    };
    const rows: Row[] = [
      {
        nums: [3, 4],
        nearest: [0, 1, 0, 0],
        floored: [0, 0, 0, 0],
        frac: [
          [1, 4],
          [1, 2],
          [1, 8],
          [1, 4],
        ],
      },
      {
        nums: [0, 0, 0, 0],
        nearest: [0, 0, 0, 0],
        floored: [0, 0, 0, 0],
        frac: [
          [0, 1],
          [0, 1],
          [0, 1],
          [0, 1],
        ],
      },
      {
        nums: [-3, 4, -7],
        nearest: [21, 31, 7, 10],
        floored: [20, 31, 6, 10],
        frac: [
          [2, 3],
          [0, 1],
          [8, 9],
          [1, 3],
        ],
      },
      {
        nums: [4, -7, 5, -1, 3],
        nearest: [19, 24, 4, 5],
        floored: [19, 24, 3, 4],
        frac: [
          [9, 25],
          [1, 5],
          [109, 125],
          [21, 25],
        ],
      },
      {
        nums: [2, 3, 2, 2, 2, 3],
        nearest: [0, 0, 0, 0],
        floored: [0, 0, 0, 0],
        frac: [
          [2, 9],
          [4, 15],
          [1, 27],
          [2, 45],
        ],
      },
      {
        nums: [-1, 0, 1, -1],
        nearest: [1, 1, 0, 0],
        floored: [0, 0, 0, 0],
        frac: [
          [11, 16],
          [11, 12],
          [11, 64],
          [11, 48],
        ],
      },
      {
        nums: [-4, -5, -6, -4, -5],
        nearest: [1, 1, 0, 0],
        floored: [0, 0, 0, 0],
        frac: [
          [14, 25],
          [7, 10],
          [14, 125],
          [7, 50],
        ],
      },
    ];
    const flags: [boolean, boolean][] = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ];

    for (const row of rows) {
      const n = row.nums.length;
      for (let k = 0; k < 4; k++) {
        const [unbiased, ofMean] = flags[k] as [boolean, boolean];
        expect(variance(row.nums, n, unbiased, ofMean, null)).toBe(row.nearest[k]);
        expect(variance(row.nums, n, unbiased, ofMean, f)).toBe(row.floored[k]);
        const [fn, fd] = row.frac[k] as [number, number];
        expect(f).toEqual({ n: fn, d: fd });
      }
    }
  });

  // C: test_variance_overflow
  it("test_variance_overflow", () => {
    const case1 = [INT_MIN, INT_MIN, INT_MIN];
    const case2 = [INT_MAX, INT_MAX, INT_MAX, INT_MAX];
    const case3 = [INT_MIN, INT_MAX, INT_MIN, INT_MAX, INT_MIN, INT_MAX];
    /* 1 << (32 / 2 - 1), alternating sign: squares sum past 2^32. */
    const half = 1 << 15;
    const case4 = [half, -half, half, -half, half, -half];
    const f = outFrac();
    const flags: [boolean, boolean][] = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ];

    /* All values identical: zero variance despite each square overflowing. */
    for (const [unbiased, ofMean] of flags) {
      expect(variance(case1, case1.length, unbiased, ofMean, null)).toBe(0);
      expect(variance(case1, case1.length, unbiased, ofMean, f)).toBe(0);
      expect(f).toEqual({ n: 0, d: 1 });
      expect(variance(case2, case2.length, unbiased, ofMean, null)).toBe(0);
      expect(variance(case2, case2.length, unbiased, ofMean, f)).toBe(0);
      expect(f).toEqual({ n: 0, d: 1 });
    }

    /* A variance above INT_MAX saturates to INT_MAX with a zero fraction. */
    for (const [unbiased, ofMean] of flags) {
      expect(variance(case3, case3.length, unbiased, ofMean, null)).toBe(INT_MAX);
      expect(variance(case3, case3.length, unbiased, ofMean, f)).toBe(INT_MAX);
      expect(f).toEqual({ n: 0, d: 1 });
    }

    /*
     * case4 is the interesting one: the C builds the expectations out of its own
     * rational helpers, which reduce to these values for a 32-bit int.
     *   sum == 0, sum of squares == 6 * 2^30.
     */
    const sq = half * half;
    const n4 = case4.length;
    /* (false, false): 6 * 2^30 / 6 exactly. */
    expect(variance(case4, n4, false, false, f)).toBe(sq);
    expect(f).toEqual({ n: 0, d: 1 });
    expect(variance(case4, n4, false, false, null)).toBe(sq);
    /*
     * (true, false): divided by 5 instead, leaving 4/5. The C spells the
     * expectation out as trunc(sq / 5) * 6 + trunc((sq % 5) * 6 / 5) so that it
     * stays in integer arithmetic; reproduced literally.
     */
    const vTF = Math.trunc(sq / 5) * n4 + Math.trunc(((sq % 5) * n4) / 5);
    expect(variance(case4, n4, true, false, f)).toBe(vTF);
    expect(f).toEqual({ n: 4, d: 5 });
    /* Round-to-nearest: 4 >= (5 + 1) / 2, so the floor is stepped up. */
    expect(variance(case4, n4, true, false, null)).toBe(vTF + 1);
    /* (false, true): a further division by 6, leaving 2/3. */
    expect(variance(case4, n4, false, true, f)).toBe(Math.trunc(sq / n4));
    expect(f).toEqual({ n: 2, d: 3 });
    expect(variance(case4, n4, false, true, null)).toBe(Math.trunc(sq / n4) + 1);
    /* (true, true): 4/5 scaled by 1/6 plus 4/6 is 4/5 again. */
    expect(variance(case4, n4, true, true, f)).toBe(Math.trunc(vTF / n4));
    expect(f).toEqual({ n: 4, d: 5 });
    expect(variance(case4, n4, true, true, null)).toBe(Math.trunc(vTF / n4) + 1);
  });
});
