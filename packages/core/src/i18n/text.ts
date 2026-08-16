/**
 * How wide a string is ON A GRID - the part of localization that is not about
 * words at all.
 *
 * Angband draws into a fixed 80x24 character grid. Every column position in
 * every screen of this game is computed by counting characters, and that
 * arithmetic is correct exactly while one character occupies one cell. It stops
 * being true the moment a translation arrives: a CJK ideograph is drawn two
 * cells wide by every terminal that has ever existed, and a combining accent is
 * drawn in the cell of the letter it sits on and takes none of its own.
 *
 * So a Japanese translation of a 40-character status line does not overflow by
 * a few characters - it overflows by its own length again, and the sidebar
 * writes over the map. `String.length` is worse still, because it counts UTF-16
 * code UNITS: an emoji or a rare CJK ideograph outside the Basic Multilingual
 * Plane counts as two before anyone has thought about display at all.
 *
 * This module is the answer to "how many cells", and it is deliberately the
 * whole answer rather than a hook: the rule is Unicode's (East Asian Width,
 * UAX #11) and not a language's, so a locale has nothing to override here. What
 * a locale DOES get to change is direction, which is a property of its script.
 *
 * The ranges below are the standard Wide (W) and Fullwidth (F) blocks. They are
 * spelled out rather than derived from a property escape because
 * `\p{East_Asian_Width=Wide}` is not a regular expression property JavaScript
 * exposes - the ECMAScript property list has General_Category and Script, and
 * East_Asian_Width is not on it. A table is the only option; keeping it short
 * and citing the blocks is the next best thing to deriving it.
 */

/** Ranges of code points a terminal draws two cells wide (UAX #11 W and F). */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK Radicals, Kangxi, CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul Compatibility, CJK compat
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables and Radicals
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms, Small Form Variants
  [0xff00, 0xff60], // Fullwidth ASCII variants
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Miscellaneous Symbols and Pictographs, Emoticons
  [0x1f900, 0x1f9ff], // Supplemental Symbols and Pictographs
  [0x20000, 0x2fffd], // CJK Extension B and beyond
  [0x30000, 0x3fffd], // CJK Extension G and beyond
];

/**
 * How many grid cells one code point occupies: 2 for East Asian Wide and
 * Fullwidth, 0 for a combining mark or a zero-width control, 1 otherwise.
 *
 * Zero for combining marks matters as much as two for ideographs: `e` followed
 * by U+0301 is ONE cell showing `é`, and counting it as two pushes every
 * subsequent column along by one for the rest of the row. Latin languages with
 * decomposed accents hit this long before anyone gets to CJK.
 */
export function charCells(codePoint: number): number {
  /* C0/C1 controls and the zero-width family occupy nothing. */
  if (codePoint === 0x200b || codePoint === 0xfeff) return 0;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  /* Combining marks: the three blocks a terminal composes onto the previous
   * cell. Mn/Me would be the exact answer and IS available as a property
   * escape, so it is used - unlike East Asian Width, General_Category is on
   * ECMAScript's list. */
  const ch = String.fromCodePoint(codePoint);
  if (/\p{Mn}|\p{Me}/u.test(ch)) return 0;
  for (const [lo, hi] of WIDE_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return 2;
  }
  return 1;
}

/**
 * How many grid cells a string occupies.
 *
 * Iterates by CODE POINT (`for...of` on a string does), not by index, so an
 * astral character counts once rather than twice. Use this anywhere the port
 * currently uses `.length` to decide a column - padding, centring, truncation,
 * and every "does this fit" test.
 */
export function textCells(s: string): number {
  let cells = 0;
  for (const ch of s) cells += charCells(ch.codePointAt(0) ?? 0);
  return cells;
}

/**
 * The longest prefix of `s` that fits in `cells`, never splitting a wide
 * character across the boundary.
 *
 * Truncating by index is what puts half an ideograph in the last column and the
 * other half nowhere. A wide character that would straddle the edge is dropped
 * whole, so the result may be one cell short of the budget - which is correct:
 * the alternative is one cell over, and the cell after the budget belongs to
 * something else.
 */
export function truncateToCells(s: string, cells: number): string {
  if (cells <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of s) {
    const w = charCells(ch.codePointAt(0) ?? 0);
    if (used + w > cells) break;
    out += ch;
    used += w;
  }
  return out;
}

/** Pad `s` on the right to `cells` grid cells (a no-op when it already fits). */
export function padToCells(s: string, cells: number): string {
  const used = textCells(s);
  return used >= cells ? s : s + " ".repeat(cells - used);
}
