/**
 * strftime, for the one format string upstream actually uses on a player-visible
 * path: `"-%Y-%m-%d-%H-%M.txt"` (ui-input.c:1364).
 *
 * A separate module rather than an inline template because the parts that make
 * it correct are easy to get wrong and worth testing on their own: `%m` is
 * 1-based where JavaScript's `getMonth()` is 0-based, every field is
 * zero-padded to a fixed width, and the values are LOCAL time (`localtime`),
 * not UTC - so `toISOString()` would silently shift a dump's name by the
 * player's offset.
 */

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/**
 * `strftime(buf, size, "-%Y-%m-%d-%H-%M.txt", localtime(&ltime))`.
 *
 * `%Y` is the full year with no padding in C, but padStart(4) matches it for
 * every year a clock will report and keeps the field width fixed.
 */
export function localTimestampSuffix(when: Date): string {
  const y = pad(when.getFullYear(), 4);
  const m = pad(when.getMonth() + 1);
  const d = pad(when.getDate());
  const h = pad(when.getHours());
  const min = pad(when.getMinutes());
  return `-${y}-${m}-${d}-${h}-${min}.txt`;
}
