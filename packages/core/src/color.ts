/**
 * The Angband color palette, ported from reference/src/z-color.h and
 * z-color.c (Angband 4.2.6): 28 named colors plus the shade background,
 * their pref-file attr characters, and the classic RGB values front ends
 * render with.
 *
 * The full translation matrix (mono/vga/blind/lighter/darker/highlight/
 * metallic/misc columns of color_table) is deferred until the modules
 * that consume it (lighting, accessibility modes) are ported; see the
 * parity ledger.
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

export interface ColorInfo {
  /** The pref-file attr character (color_table[].index_char). */
  char: string;
  /** The human-readable name (color_table[].name). */
  name: string;
  /** RGB from angband_color_table (the leading 0x00 byte dropped). */
  rgb: readonly [number, number, number];
}

/** Indexed by COLOUR_* value. */
export const COLOR_TABLE: readonly ColorInfo[] = [
  { char: "d", name: "Dark", rgb: [0x00, 0x00, 0x00] },
  { char: "w", name: "White", rgb: [0xff, 0xff, 0xff] },
  { char: "s", name: "Slate", rgb: [0x80, 0x80, 0x80] },
  { char: "o", name: "Orange", rgb: [0xff, 0x80, 0x00] },
  { char: "r", name: "Red", rgb: [0xc0, 0x00, 0x00] },
  { char: "g", name: "Green", rgb: [0x00, 0x80, 0x40] },
  { char: "b", name: "Blue", rgb: [0x00, 0x40, 0xff] },
  { char: "u", name: "Umber", rgb: [0x80, 0x40, 0x00] },
  { char: "D", name: "Light Dark", rgb: [0x60, 0x60, 0x60] },
  { char: "W", name: "Light Slate", rgb: [0xc0, 0xc0, 0xc0] },
  { char: "P", name: "Light Purple", rgb: [0xff, 0x00, 0xff] },
  { char: "y", name: "Yellow", rgb: [0xff, 0xff, 0x00] },
  { char: "R", name: "Light Red", rgb: [0xff, 0x40, 0x40] },
  { char: "G", name: "Light Green", rgb: [0x00, 0xff, 0x00] },
  { char: "B", name: "Light Blue", rgb: [0x00, 0xff, 0xff] },
  { char: "U", name: "Light Umber", rgb: [0xc0, 0x80, 0x40] },
  { char: "p", name: "Purple", rgb: [0x90, 0x00, 0x90] },
  { char: "v", name: "Violet", rgb: [0x90, 0x20, 0xff] },
  { char: "t", name: "Teal", rgb: [0x00, 0xa0, 0xa0] },
  { char: "m", name: "Mud", rgb: [0x6c, 0x6c, 0x30] },
  { char: "Y", name: "Light Yellow", rgb: [0xff, 0xff, 0x90] },
  { char: "i", name: "Magenta-Pink", rgb: [0xff, 0x00, 0xa0] },
  { char: "T", name: "Light Teal", rgb: [0x20, 0xff, 0xdc] },
  { char: "V", name: "Light Violet", rgb: [0xb8, 0xa8, 0xff] },
  { char: "I", name: "Light Pink", rgb: [0xff, 0x80, 0x80] },
  { char: "M", name: "Mustard", rgb: [0xb4, 0xb4, 0x00] },
  { char: "z", name: "Blue Slate", rgb: [0xa0, 0xc0, 0xd0] },
  { char: "Z", name: "Deep Light Blue", rgb: [0x00, 0xb0, 0xff] },
  { char: " ", name: "Shade", rgb: [0x28, 0x28, 0x28] },
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

/** CSS hex string for a COLOUR_* index (front-end convenience). */
export function colorToCss(attr: number): string {
  const info = COLOR_TABLE[attr] ?? COLOR_TABLE[COLOUR_WHITE];
  const [r, g, b] = (info as ColorInfo).rgb;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
