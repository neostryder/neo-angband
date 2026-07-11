/**
 * Graphics-mode catalog + lookup, ported from reference/src/grafmode.c
 * (Angband 4.2.6).
 *
 * The catalog is metadata only (mode id, menu name, tile dimensions,
 * directory + image/pref filenames, double-height rows) parsed from
 * lib/tiles/list.txt. NO tile IMAGE assets are bundled - the art packs carry
 * their own (partly non-commercial) licenses, so a user supplies a tile pack
 * at runtime and the web renderer builds URLs from this metadata. ASCII stays
 * the default and the game runs fully with no tile pack present.
 *
 * Ported here:
 *  - struct graphics_mode -> GraphicsMode.
 *  - GRAPHICS_NONE (grafmode.h) + the hardcoded "None" fallback entry the C
 *    appends in finish_parse_grafmode (L137-146).
 *  - get_graphics_mode (L223): find a mode by grafID.
 *  - graphics_mode_high_id (L148): the highest catalog grafID.
 *  - is_dh_tile (L241): double-height tile test.
 *
 * The list.txt parse itself is done ahead of time by
 * scripts/gen-grafmode.mjs, which emits grafmode-data.ts.
 */

import { GRAPHICS_MODE_CATALOG } from "./grafmode-data";

export { GRAPHICS_MODE_CATALOG } from "./grafmode-data";

/** grafmode.h GRAPHICS_NONE: the ASCII (no-tiles) mode id. */
export const GRAPHICS_NONE = 0;

/**
 * struct graphics_mode (grafmode.h). The C stores a fully-built absolute
 * `path` under ANGBAND_DIR_TILES; here we keep the raw `directory` name and
 * leave path/URL construction to the platform (no bundled assets).
 */
export interface GraphicsMode {
  /** grafID: the serial number / mode id (uint on the `name` line). */
  grafID: number;
  /** menuname: the display name (the `name` line's str field). */
  menuname: string;
  /** The tile directory name (the `directory` line), e.g. "old". */
  directory: string;
  /** cell_width: tile width in pixels (the `size` line). */
  cellWidth: number;
  /** cell_height: tile height in pixels (the `size` line). */
  cellHeight: number;
  /** file: the tileset image filename (the `size` line's str field). */
  file: string;
  /** pref: the pref file name (the `pref` line), or "none". */
  pref: string;
  /** alphablend: whether the tileset needs alpha blending (the `extra` line). */
  alphablend: number;
  /** overdrawRow: first double-height tile row (the `extra` line). */
  overdrawRow: number;
  /** overdrawMax: last double-height tile row (the `extra` line). */
  overdrawMax: number;
}

/**
 * The hardcoded no-graphics fallback (grafmode.c L137-146). Appended after the
 * parsed catalog and used as the initial current_graphics_mode.
 */
export const GRAPHICS_MODE_NONE: GraphicsMode = {
  grafID: GRAPHICS_NONE,
  menuname: "None",
  directory: "",
  cellWidth: 0,
  cellHeight: 0,
  file: "",
  pref: "none",
  alphablend: 0,
  overdrawRow: 0,
  overdrawMax: 0,
};

/**
 * The full graphics-mode list: the parsed catalog plus the "None" entry at the
 * end, exactly as finish_parse_grafmode builds graphics_modes[] (parsed modes
 * followed by the hardcoded None fallback).
 */
export const GRAPHICS_MODES: readonly GraphicsMode[] = [
  ...GRAPHICS_MODE_CATALOG,
  GRAPHICS_MODE_NONE,
];

/**
 * graphics_mode_high_id (grafmode.c L148): the highest grafID among the
 * parsed modes (the None entry is excluded, matching the C's `max` scan which
 * runs before None is appended).
 */
export const GRAPHICS_MODE_HIGH_ID: number = GRAPHICS_MODE_CATALOG.reduce(
  (max, m) => (m.grafID > max ? m.grafID : max),
  0,
);

/**
 * get_graphics_mode (grafmode.c L223): the mode with the given id, or
 * undefined (the C returns NULL) if none matches. GRAPHICS_NONE resolves to
 * the None fallback entry.
 */
export function getGraphicsMode(id: number): GraphicsMode | undefined {
  for (const mode of GRAPHICS_MODES) {
    if (mode.grafID === id) return mode;
  }
  return undefined;
}

/**
 * is_dh_tile (grafmode.c L241): whether an attr/char pair is a double-height
 * tile under the given mode. True only for a tile attr (high bit set) whose
 * tileset row falls in the mode's double-height band. `current` may be
 * undefined (no mode selected), matching the C's !current_graphics_mode guard.
 */
export function isDoubleHeightTile(
  current: GraphicsMode | undefined,
  attr: number,
): boolean {
  if ((attr & 0x80) === 0 || !current || !current.overdrawRow) return false;
  const tilesetRow = attr & 0x7f;
  return (
    tilesetRow >= current.overdrawRow && tilesetRow <= current.overdrawMax
  );
}
