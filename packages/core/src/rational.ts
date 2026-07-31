/**
 * Exact rational arithmetic and the mean/variance estimators, ported from
 * reference/src/z-util.c (Angband 4.2.6): gcd (L1679),
 * my_rational_construct (L1694), my_rational_to_uint (L1722),
 * my_rational_product (L1823), my_rational_sum (L1923), mean (L1389) and
 * variance (L1516).
 *
 * WHY THESE ARE CORE AND NOT PLUMBING. Three upstream call sites depend on the
 * exact values these return:
 *  - obj-info.c (L435 sum_o_criticals, L563/L725 the O-combat crit averages,
 *    L1271-L1488 the damage-per-blow readout) prints numbers derived from
 *    my_rational_to_uint, so a rounding difference is a visibly wrong number on
 *    the item-inspect screen.
 *  - obj-randart.c L278-L282 store_base_power calls mean()/variance() over the
 *    standard artifact set; those become the generator's power baselines.
 *  - player-path.c L135/L195/L269 converts turn penalties through
 *    my_rational_to_uint, which feeds the pathfinder's terrain penalties.
 *
 * FIDELITY. The C works in `unsigned int` (32-bit) and falls back to a
 * hand-rolled 16-bit-limb multiprecision library (ini_u16n/mul_u16n/div_u16n,
 * z-util.c L1000-L1380) whenever a product would overflow. This port keeps the
 * SAME saturation and approximation behaviour, using BigInt for exactly the
 * intermediates the C computes in multiprecision. That matters because the
 * fallback is not just "a bigger integer": my_rational_product and
 * my_rational_sum deliberately APPROXIMATE (they rescale to the largest
 * denominator that still fits and then round to nearest), and
 * my_rational_to_uint / variance SATURATE at UINT_MAX / INT_MAX. A port that
 * merely used JS doubles would silently return the unsaturated value.
 *
 * The 32-bit rails are the point, so they are named rather than implied:
 * a `number` here stands for a C `unsigned int` unless stated otherwise.
 */

import { INT_MAX, UINT32_MAX } from "./guard.js";

/** struct my_rational (z-util.h): a fraction in lowest terms, d > 0. */
export interface MyRational {
  /** numerator (unsigned int) */
  n: number;
  /** denominator (unsigned int), always > 0 */
  d: number;
}

/** Bit length, i.e. msb_u16n (z-util.c L1059): 0 for zero, else 1-based msb. */
function msb(x: bigint): number {
  return x === 0n ? 0 : x.toString(2).length;
}

/**
 * gcd (z-util.c L1679): the division-based Euclid. Note gcd(0, d) === d, which
 * my_rational_product relies on when a numerator is zero.
 */
export function gcd(a: number, b: number): number {
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * my_rational_construct (z-util.c L1694). Zero is always 0/1; otherwise the
 * fraction is divided through by the gcd. The C asserts denominator > 0.
 */
export function myRationalConstruct(numerator: number, denominator: number): MyRational {
  if (numerator === 0) {
    /* Use 0 / 1 as the way to represent zero. */
    return { n: 0, d: 1 };
  }
  const g = gcd(numerator, denominator);
  return { n: Math.trunc(numerator / g), d: Math.trunc(denominator / g) };
}

/** The out-parameter shape for my_rational_to_uint's `remainder`. */
export interface UintRemainder {
  remainder: number;
}

/**
 * my_rational_to_uint (z-util.c L1722): a->n / a->d scaled by `scale`, floored,
 * saturating at UINT_MAX. When `out` is given it receives the numerator of the
 * part that was dropped (over the same denominator a.d) so the caller can round.
 *
 * Every early return that saturates ALSO zeroes the remainder — upstream does
 * that at four separate points and a caller that rounds on the remainder would
 * round differently if any were missed, so they are each reproduced.
 */
export function myRationalToUint(
  a: MyRational,
  scale: number,
  out?: UintRemainder,
): number {
  if (!scale) {
    if (out) out.remainder = 0;
    return 0;
  }
  let result = Math.trunc(a.n / a.d);
  if (result > Math.trunc(UINT32_MAX / scale)) {
    if (out) out.remainder = 0;
    return UINT32_MAX;
  }
  result *= scale;
  const r = a.n % a.d;
  const q = Math.trunc(scale / a.d);
  /* q * r cannot overflow: q <= scale / a.d and r < a.d, so q * r < scale. */
  if (result > UINT32_MAX - q * r) {
    if (out) out.remainder = 0;
    return UINT32_MAX;
  }
  result += q * r;
  const r2 = scale - q * a.d;
  if (r && r2 > Math.trunc(UINT32_MAX / r)) {
    /*
     * The product of the remainders overflows in the native arithmetic, so the
     * C switches to multiprecision integers (L1756-L1803). BigInt is exact here
     * for the same reason: r < a.d and r2 < a.d, both under 2^32.
     */
    const t = BigInt(r) * BigInt(r2);
    const bd = BigInt(a.d);
    const mq = Number(t / bd);
    if (result <= UINT32_MAX - mq) {
      result += mq;
      if (out) out.remainder = Number(t % bd);
    } else {
      result = UINT32_MAX;
      if (out) out.remainder = 0;
    }
    return result;
  }
  const t = r * r2;
  const q2 = Math.trunc(t / a.d);
  if (result > UINT32_MAX - q2) {
    if (out) out.remainder = 0;
    return UINT32_MAX;
  }
  result += q2;
  if (out) out.remainder = t - q2 * a.d;
  return result;
}

/**
 * The shared tail of my_rational_product and my_rational_sum's overflow paths
 * (z-util.c L1872-L1911 and L1985-L2027). Given the exact fraction n / d that
 * does not fit in 32 bits, return the best 32-bit approximation the C would:
 * take the integer quotient, pick the LARGEST denominator that still fits
 * alongside it, scale the remainder into that denominator, and round to nearest
 * by comparing bit lengths (which is why this is an approximation and not the
 * true value).
 */
function approximate(n: bigint, d: bigint, guardSum: boolean): MyRational {
  const q = n / d;
  if (q > BigInt(UINT32_MAX)) return myRationalConstruct(UINT32_MAX, 1);
  const r = n % d;
  let resn = Number(q);
  const resd = resn < UINT32_MAX ? Math.trunc(UINT32_MAX / (resn + 1)) : 1;
  resn *= resd;
  const scaled = r * BigInt(resd);
  const t = Number(scaled / d);
  const rr = scaled % d;
  if (guardSum && resn > UINT32_MAX - t) {
    /* my_rational_sum guards this addition (L2015) where product asserts it. */
    return myRationalConstruct(UINT32_MAX, 1);
  }
  resn += t;
  /* Approximate rounding to the nearest. */
  if (msb(rr) + 1 >= msb(d) && resn < UINT32_MAX) resn += 1;
  return myRationalConstruct(resn, resd);
}

/** my_rational_product (z-util.c L1823): a * b, approximating on overflow. */
export function myRationalProduct(a: MyRational, b: MyRational): MyRational {
  const g1 = gcd(a.n, b.d);
  const g2 = gcd(a.d, b.n);
  const anr = Math.trunc(a.n / g1);
  const adr = Math.trunc(a.d / g2);
  const bnr = Math.trunc(b.n / g2);
  const bdr = Math.trunc(b.d / g1);

  if (
    (bnr && anr > Math.trunc(UINT32_MAX / bnr)) ||
    adr > Math.trunc(UINT32_MAX / bdr)
  ) {
    return approximate(BigInt(anr) * BigInt(bnr), BigInt(adr) * BigInt(bdr), false);
  }
  /* Note: the native path does NOT re-reduce; anr/adr and bnr/bdr already are. */
  return { n: anr * bnr, d: adr * bdr };
}

/** my_rational_sum (z-util.c L1923): a + b, approximating on overflow. */
export function myRationalSum(a: MyRational, b: MyRational): MyRational {
  const g = gcd(a.d, b.d);
  const adr = Math.trunc(a.d / g);
  const bdr = Math.trunc(b.d / g);

  if (
    adr <= Math.trunc(UINT32_MAX / b.d) &&
    a.n <= Math.trunc(UINT32_MAX / bdr) &&
    b.n <= Math.trunc(UINT32_MAX / adr) &&
    a.n * bdr <= UINT32_MAX - b.n * adr
  ) {
    return myRationalConstruct(a.n * bdr + b.n * adr, adr * b.d);
  }
  return approximate(
    BigInt(a.n) * BigInt(bdr) + BigInt(adr) * BigInt(b.n),
    BigInt(adr) * BigInt(b.d),
    true,
  );
}

/**
 * Split the entries of `nums[0 .. size-1]` into the positive and negative
 * contributions to the sum, the way mean() and variance() both do (the C keeps
 * two multiprecision accumulators so that INT_MIN never has to be negated in
 * an `int`). Also returns the sum of squares, which only variance() reads.
 */
function accumulate(
  nums: readonly number[],
  size: number,
): { sp: bigint; sn: bigint; ss: bigint } {
  let sp = 0n;
  let sn = 0n;
  let ss = 0n;
  for (let i = 0; i < size; i++) {
    const v = nums[i] as number;
    if (v === 0) continue;
    const bv = BigInt(v);
    if (v > 0) sp += bv;
    else sn -= bv;
    ss += bv * bv;
  }
  return { sp, sn, ss };
}

/**
 * mean (z-util.c L1389): the arithmetic mean of nums[0 .. size-1].
 *
 * The `frac` out-parameter selects between TWO DIFFERENT ROUNDING RULES, which
 * is the whole reason it exists:
 *  - frac === null: the result is rounded to NEAREST, ties away from zero
 *    (the C tests `f.n >= (f.d + 1) / 2` on the magnitude).
 *  - frac given: the result is FLOORED (rounded toward negative infinity, not
 *    toward zero) and *frac is the non-negative remainder over `size`, so that
 *    `return + frac` is the exact mean. For a negative mean the C therefore
 *    increments the magnitude and stores `(d - n) / d`.
 *
 * store_base_power (obj-randart.c L278) passes a non-null frac, so the artifact
 * power baselines use the FLOOR, not round-to-nearest.
 */
export function mean(
  nums: readonly number[],
  size: number,
  frac: MyRational | null,
): number {
  if (size <= 0) {
    if (frac) {
      frac.n = 0;
      frac.d = 1;
    }
    return 0;
  }

  const { sp, sn } = accumulate(nums, size);
  const sz = BigInt(size);

  if (sp < sn) {
    /* The mean is negative; work with the magnitude, like the C does. */
    const mag = sn - sp;
    let result = mag / sz;
    const f = myRationalConstruct(Number(mag % sz), size);
    if (frac) {
      if (f.n > 0) {
        /*
         * Will be negating the result, but the returned fraction must be
         * non-negative, so step the magnitude up and complement the fraction.
         */
        result += 1n;
        frac.n = f.d - f.n;
        frac.d = f.d;
      } else {
        frac.n = f.n;
        frac.d = f.d;
      }
    } else if (f.n >= Math.trunc((f.d + 1) / 2)) {
      result += 1n;
    }
    return result === 0n ? 0 : -Number(result);
  }

  const mag = sp - sn;
  let result = mag / sz;
  const f = myRationalConstruct(Number(mag % sz), size);
  if (frac) {
    frac.n = f.n;
    frac.d = f.d;
  } else if (f.n >= Math.trunc((f.d + 1) / 2)) {
    result += 1n;
  }
  return Number(result);
}

/**
 * variance (z-util.c L1516) of nums[0 .. size-1].
 *
 * `unbiased` divides by size - 1 instead of size; `ofMean` scales by a further
 * 1 / size to give the variance of the estimate of the mean. `frac` selects
 * floor + exact remainder over round-to-nearest, as in mean(). A result above
 * INT_MAX saturates to INT_MAX with a zero fraction.
 *
 * The C computes this as (sum(x^2) - sum(x)^2 / size) / norm rather than from
 * the deviations, and it rounds sum(x)^2 / size UP before subtracting (L1591),
 * converting the remainder to `size - r0` so every later fractional term stays
 * non-negative. Both are reproduced: the ceiling changes the floored result by
 * one for some inputs.
 */
export function variance(
  nums: readonly number[],
  size: number,
  unbiased: boolean,
  ofMean: boolean,
  frac: MyRational | null,
): number {
  if (size <= 1) {
    if (frac) {
      frac.n = 0;
      frac.d = 1;
    }
    return 0;
  }

  const norm = size - (unbiased ? 1 : 0);
  const { sp, sn, ss: sumSq } = accumulate(nums, size);
  const sz = BigInt(size);
  const nm = BigInt(norm);

  const diff = sp >= sn ? sp - sn : sn - sp;
  const sqs = diff * diff;

  let q = sqs / sz;
  let r0 = sqs % sz;
  if (r0 > 0n) {
    /*
     * Since this remainder is subtracted, add one to the quotient and turn the
     * remainder into size - r0 so later terms are all non-negative.
     */
    q += 1n;
    r0 = sz - r0;
  }

  const ss = sumSq - q;
  let v = ss / nm;
  const r1 = ss % nm;
  let r2 = 0n;
  if (ofMean) {
    r2 = v % sz;
    v = v / sz;
  }

  if (v > BigInt(UINT32_MAX) || Number(v) > INT_MAX) {
    if (frac) {
      frac.n = 0;
      frac.d = 1;
    }
    return INT_MAX;
  }
  let result = Number(v);

  /*
   * Account for the fractional part. With ofMean false that is
   * r1 / norm + r0 / (size * norm); with ofMean true it is
   * r2 / size + r1 / (size * norm) + r0 / (size * size * norm).
   */
  let f = myRationalConstruct(Number(r0), size);
  f = myRationalProduct(f, myRationalConstruct(1, norm));
  f = myRationalSum(f, myRationalConstruct(Number(r1), norm));
  if (ofMean) {
    f = myRationalProduct(f, myRationalConstruct(1, size));
    f = myRationalSum(f, myRationalConstruct(Number(r2), size));
  }

  if (frac) {
    frac.n = f.n;
    frac.d = f.d;
  } else if (f.n >= Math.trunc((f.d + 1) / 2) && result < INT_MAX) {
    result += 1;
  }
  return result;
}
