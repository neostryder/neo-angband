/**
 * Overflow-guarded integer arithmetic, ported from reference/src/z-util.c
 * (Angband 4.2.6): add_guardi/sub_guardi coerce to the 32-bit int range and
 * add_guardi16/sub_guardi16 to the signed 16-bit range when the exact result
 * would overflow.
 *
 * The object power/pricing engine and the curse-attribute merge rely on these
 * saturating semantics (a curse can push a bonus to the INT16 rail, and the
 * curse-power delta arithmetic saturates at INT32), so the port reproduces the
 * clamping exactly rather than letting JS doubles run unbounded.
 */

/** INT_MAX (32-bit signed). */
export const INT_MAX = 2147483647;
/** INT_MIN (32-bit signed). */
export const INT_MIN = -2147483648;
/** INT16_MAX. */
export const INT16_MAX = 32767;
/** INT16_MIN. */
export const INT16_MIN = -32768;

/** add_guardi: a + b coerced into [INT_MIN, INT_MAX] on overflow. */
export function addGuardi(a: number, b: number): number {
  if (a < 0) {
    return b >= 0 || (b > INT_MIN && a >= INT_MIN - b) ? a + b : INT_MIN;
  }
  return b <= 0 || a <= INT_MAX - b ? a + b : INT_MAX;
}

/** sub_guardi: a - b coerced into [INT_MIN, INT_MAX] on overflow. */
export function subGuardi(a: number, b: number): number {
  if (a < 0) {
    return b <= 0 || a >= INT_MIN + b ? a - b : INT_MIN;
  }
  return b >= 0 || a <= INT_MAX + b ? a - b : INT_MAX;
}

/** add_guardi16: a + b coerced into [-32768, 32767] on overflow. */
export function addGuardi16(a: number, b: number): number {
  if (a < 0) {
    return b >= 0 || (b > INT16_MIN && a >= INT16_MIN - b) ? a + b : INT16_MIN;
  }
  return b <= 0 || a <= INT16_MAX - b ? a + b : INT16_MAX;
}

/** sub_guardi16: a - b coerced into [-32768, 32767] on overflow. */
export function subGuardi16(a: number, b: number): number {
  if (a < 0) {
    return b <= 0 || a >= INT16_MIN + b ? a - b : INT16_MIN;
  }
  return b >= 0 || a <= INT16_MAX + b ? a - b : INT16_MAX;
}
