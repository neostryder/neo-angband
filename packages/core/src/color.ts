/**
 * The Angband color palette, ported from reference/src/z-color.h and
 * z-color.c (Angband 4.2.6): 28 named colors plus the shade background,
 * their pref-file attr characters, the classic RGB values front ends
 * render with, and the color_table[].color_translate[] matrix (z-color.c
 * L66-155) used by get_color() to remap colors for mono/16-color terms,
 * torchlight/darkness, mouse highlight, and metallic shimmer.
 */

export const COLOUR_DARK = 0;
export const COLOUR_WHITE = 1;
export const COLOUR_SLATE = 2;
export const COLOUR_ORANGE = 3;
export const COLOUR_RED = 4;
export const COLOUR_GREEN = 5;
export const COLOUR_BLUE = 6;
export const COLOUR_UMBER = 7;
export const COLOUR_L_DARK = 8;
export const COLOUR_L_WHITE = 9;
export const COLOUR_L_PURPLE = 10;
export const COLOUR_YELLOW = 11;
export const COLOUR_L_RED = 12;
export const COLOUR_L_GREEN = 13;
export const COLOUR_L_BLUE = 14;
export const COLOUR_L_UMBER = 15;
export const COLOUR_PURPLE = 16;
export const COLOUR_VIOLET = 17;
export const COLOUR_TEAL = 18;
export const COLOUR_MUD = 19;
export const COLOUR_L_YELLOW = 20;
export const COLOUR_MAGENTA = 21;
export const COLOUR_L_TEAL = 22;
export const COLOUR_L_VIOLET = 23;
export const COLOUR_L_PINK = 24;
export const COLOUR_MUSTARD = 25;
export const COLOUR_BLUE_SLATE = 26;
export const COLOUR_DEEP_L_BLUE = 27;
export const COLOUR_SHADE = 28;

export const MAX_COLORS = 29;

/**
 * Column indices into ColorInfo.translate, matching z-color.h's
 * ATTR_* defines (MAX_ATTR = 9). The column order mirrors the
 * "full mono vga blind lighter darker highlight metallic misc"
 * comment above color_table[] in z-color.c.
 */
export const ATTR_FULL = 0;
export const ATTR_MONO = 1;
export const ATTR_VGA = 2;
export const ATTR_BLIND = 3;
export const ATTR_LIGHT = 4;
export const ATTR_DARK = 5;
export const ATTR_HIGH = 6;
export const ATTR_METAL = 7;
export const ATTR_MISC = 8;
export const MAX_ATTR = 9;

export interface ColorInfo {
  /** The pref-file attr character (color_table[].index_char). */
  char: string;
  /** The human-readable name (color_table[].name). */
  name: string;
  /** RGB from angband_color_table (the leading 0x00 byte dropped). */
  rgb: readonly [number, number, number];
  /**
   * color_table[].color_translate[]: one COLOUR_* index per ATTR_*
   * column (full/mono/vga/blind/lighter/darker/highlight/metallic/misc).
   * Index 28 (Shade) has no explicit row in z-color.c -- the C array
   * relies on static zero-initialization, so it translates to
   * COLOUR_DARK (0) in every column here as well.
   */
  translate: readonly number[];
}

/** Indexed by COLOUR_* value. */
export const COLOR_TABLE: readonly ColorInfo[] = [
  // full mono vga blind lighter darker highlight metallic misc
  { char: "d", name: "Dark", rgb: [0x00, 0x00, 0x00],
    translate: [0, 0, 0, 0, 8, 0, 8, 8, 0] },
  { char: "w", name: "White", rgb: [0xff, 0xff, 0xff],
    translate: [1, 1, 1, 1, 11, 9, 14, 11, 1] },
  { char: "s", name: "Slate", rgb: [0x80, 0x80, 0x80],
    translate: [2, 1, 2, 2, 9, 8, 9, 9, 2] },
  { char: "o", name: "Orange", rgb: [0xff, 0x80, 0x00],
    translate: [3, 1, 3, 9, 11, 2, 11, 11, 3] },
  { char: "r", name: "Red", rgb: [0xc0, 0x00, 0x00],
    translate: [4, 1, 4, 2, 12, 2, 12, 12, 4] },
  { char: "g", name: "Green", rgb: [0x00, 0x80, 0x40],
    translate: [5, 1, 5, 2, 13, 2, 13, 13, 5] },
  { char: "b", name: "Blue", rgb: [0x00, 0x40, 0xff],
    translate: [6, 1, 6, 2, 14, 2, 14, 14, 6] },
  { char: "u", name: "Umber", rgb: [0x80, 0x40, 0x00],
    translate: [7, 1, 7, 8, 15, 8, 15, 15, 7] },
  { char: "D", name: "Light Dark", rgb: [0x60, 0x60, 0x60],
    translate: [8, 1, 8, 8, 2, 8, 2, 2, 8] },
  { char: "W", name: "Light Slate", rgb: [0xc0, 0xc0, 0xc0],
    translate: [9, 1, 9, 9, 1, 2, 1, 1, 2] },
  { char: "P", name: "Light Purple", rgb: [0xff, 0x00, 0xff],
    translate: [10, 1, 10, 2, 11, 2, 11, 11, 10] },
  { char: "y", name: "Yellow", rgb: [0xff, 0xff, 0x00],
    translate: [11, 1, 11, 9, 20, 9, 1, 1, 11] },
  { char: "R", name: "Light Red", rgb: [0xff, 0x40, 0x40],
    translate: [12, 1, 12, 9, 11, 4, 11, 11, 12] },
  { char: "G", name: "Light Green", rgb: [0x00, 0xff, 0x00],
    translate: [13, 1, 13, 9, 11, 5, 11, 11, 13] },
  { char: "B", name: "Light Blue", rgb: [0x00, 0xff, 0xff],
    translate: [14, 1, 14, 9, 11, 6, 11, 11, 14] },
  { char: "U", name: "Light Umber", rgb: [0xc0, 0x80, 0x40],
    translate: [15, 1, 15, 9, 11, 7, 11, 11, 15] },
  { char: "p", name: "Purple", rgb: [0x90, 0x00, 0x90],
    translate: [16, 1, 10, 2, 10, 2, 10, 10, 10] },
  { char: "v", name: "Violet", rgb: [0x90, 0x20, 0xff],
    translate: [17, 1, 10, 2, 10, 2, 10, 10, 10] },
  { char: "t", name: "Teal", rgb: [0x00, 0xa0, 0xa0],
    translate: [18, 1, 6, 2, 22, 2, 22, 22, 14] },
  { char: "m", name: "Mud", rgb: [0x6c, 0x6c, 0x30],
    translate: [19, 1, 5, 2, 25, 2, 25, 25, 7] },
  { char: "Y", name: "Light Yellow", rgb: [0xff, 0xff, 0x90],
    translate: [20, 1, 11, 1, 1, 11, 1, 1, 20] },
  { char: "i", name: "Magenta-Pink", rgb: [0xff, 0x00, 0xa0],
    translate: [21, 1, 12, 2, 24, 4, 24, 24, 10] },
  { char: "T", name: "Light Teal", rgb: [0x20, 0xff, 0xdc],
    translate: [22, 1, 14, 9, 11, 18, 11, 11, 14] },
  { char: "V", name: "Light Violet", rgb: [0xb8, 0xa8, 0xff],
    translate: [23, 1, 10, 9, 11, 17, 11, 11, 10] },
  { char: "I", name: "Light Pink", rgb: [0xff, 0x80, 0x80],
    translate: [24, 1, 12, 9, 11, 21, 11, 11, 10] },
  { char: "M", name: "Mustard", rgb: [0xb4, 0xb4, 0x00],
    translate: [25, 1, 11, 2, 11, 2, 11, 11, 11] },
  { char: "z", name: "Blue Slate", rgb: [0xa0, 0xc0, 0xd0],
    translate: [26, 1, 9, 2, 27, 2, 27, 27, 9] },
  { char: "Z", name: "Deep Light Blue", rgb: [0x00, 0xb0, 0xff],
    translate: [27, 1, 14, 9, 14, 26, 14, 14, 14] },
  { char: " ", name: "Shade", rgb: [0x28, 0x28, 0x28],
    translate: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
];

/** color_char_to_attr: attr character -> COLOUR_* index, -1 if unknown. */
export function colorCharToAttr(ch: string): number {
  for (let i = 0; i < COLOR_TABLE.length; i++) {
    const info = COLOR_TABLE[i];
    if (info && info.char === ch) return i;
  }
  return -1;
}

/** color_text_to_attr: color name (case-insensitive) -> index, -1 if unknown. */
export function colorTextToAttr(name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < COLOR_TABLE.length; i++) {
    const info = COLOR_TABLE[i];
    if (info && info.name.toLowerCase() === lower) return i;
  }
  return -1;
}

/**
 * angband_color_table (z-color.c): the LIVE colour values, mutable exactly like
 * the C global, one [K, R, G, B] row per COLOUR_* index. Initialised from
 * COLOR_TABLE with K = 0 (upstream's leading 0x00 byte). do_cmd_colors
 * (colors_modify) edits these bytes and colorToCss reads R,G,B from here, so an
 * edit takes effect immediately (Term_xtra REACT + redraw). K is the extra
 * "kv" channel upstream keeps for palette backends; the web renderer ignores it
 * but the editor still shows and edits it for faithfulness. Persisted by the
 * front end as a user pref (like graphics/font), not in the character save.
 */
const angbandColorTable: [number, number, number, number][] = COLOR_TABLE.map(
  (c) => [0, c.rgb[0], c.rgb[1], c.rgb[2]],
);

/** Clamp to a uint8 with C wraparound (colors_modify's (uint8_t)(x +/- 1)). */
function u8(n: number): number {
  return ((n % 256) + 256) % 256;
}

/** angband_color_table[attr][channel] (0=K, 1=R, 2=G, 3=B). */
export function colorChannel(attr: number, channel: 0 | 1 | 2 | 3): number {
  return angbandColorTable[attr]?.[channel] ?? 0;
}

/** Set one live colour channel (wraps uint8), like colors_modify's k/K/r/R/... */
export function setColorChannel(attr: number, channel: 0 | 1 | 2 | 3, value: number): void {
  const row = angbandColorTable[attr];
  if (row) row[channel] = u8(value);
}

/** The live [K,R,G,B] rows, copied - for persisting the user's colour edits. */
export function colorTableSnapshot(): [number, number, number, number][] {
  return angbandColorTable.map((r) => [r[0], r[1], r[2], r[3]]);
}

/** Restore live colours from a snapshot (front-end pref load); ignores extras. */
export function restoreColorTable(rows: readonly (readonly number[])[]): void {
  for (let i = 0; i < angbandColorTable.length && i < rows.length; i++) {
    const src = rows[i];
    const dst = angbandColorTable[i];
    if (src && dst) {
      dst[0] = u8(src[0] ?? 0);
      dst[1] = u8(src[1] ?? dst[1]);
      dst[2] = u8(src[2] ?? dst[2]);
      dst[3] = u8(src[3] ?? dst[3]);
    }
  }
}

/** Reset every live colour to its COLOR_TABLE default (K = 0). */
export function resetColorTable(): void {
  for (let i = 0; i < COLOR_TABLE.length; i++) {
    const c = COLOR_TABLE[i]!;
    angbandColorTable[i] = [0, c.rgb[0], c.rgb[1], c.rgb[2]];
  }
}

/** CSS hex string for a COLOUR_* index (front-end convenience). Reads the LIVE
 * angband_color_table so do_cmd_colors edits are reflected immediately. */
export function colorToCss(attr: number): string {
  const row = angbandColorTable[attr] ?? angbandColorTable[COLOUR_WHITE]!;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(row[1])}${hex(row[2])}${hex(row[3])}`;
}

/**
 * get_color(a, attr, n): translate color `a` through the color_translate
 * matrix, `n` times, using the `attr` column (one of ATTR_*).
 *
 * Graphical tile attrs (high bit set, a & 0x80) pass through unchanged,
 * and attr === ATTR_FULL (0) is treated as "no translation" -- matching
 * upstream's `if (!attr) return (a);` full-color-term short-circuit, so
 * ATTR_FULL is never actually used to index color_translate[0] at runtime.
 */
export function getColor(a: number, attr: number, n: number): number {
  if (a & 0x80) return a;
  if (!attr) return a;

  let result = a;
  for (let i = 0; i < n; i++) {
    const info = COLOR_TABLE[result];
    if (!info) return result;
    const next = info.translate[attr];
    if (next === undefined) return result;
    result = next;
  }
  return result;
}
