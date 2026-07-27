/**
 * The graphics-mode list the Graphics menu shows: CORE's tile sets first, then
 * whatever `tiles`-shape mods add on top.
 *
 * Upstream, the tile sets are core game data. `lib/tiles/list.txt` is parsed by
 * grafmode.c (init_graphics_modes L175-183 -> finish_parse_grafmode L105) into
 * `graphics_modes`, and each frontend builds its Graphics menu by walking that
 * list - every mode but GRAPHICS_NONE, straight from the catalog
 * (main-win.c:2897-2905). No mod is involved and none can be: 4.2.6 has no mod
 * system. So the port's Graphics menu MUST offer the upstream tile sets with
 * nothing enabled, and the game must not know that a tiles mod exists.
 *
 * (It briefly did not. A bundled tiles mod was made the "registry of record" for
 * the four bundled packs, so a stock install - all mods off, which is faithful
 * 4.2.6 - offered ASCII and nothing else. That was a port-vs-C disparity, not a
 * labelling problem. Nothing in the graphics subsystem names a mod now, by
 * design: a tiles mod is one more contributor, never a prerequisite. See
 * tile-catalog.test.ts, which pins both halves.)
 *
 * Core modes come from the ported catalog (core visuals/grafmode), restricted
 * to the tile art that actually ships - the one necessary deviation, since
 * Shockbolt's licence forbids redistribution (public/tiles/CREDITS.md). Point
 * the game at your own pack with `?tiles=<base-url>` and the full catalog is
 * offered, Shockbolt included: with a user-supplied pack we cannot know what is
 * in it, and upstream does not check either - it lists whatever list.txt says
 * and degrades if an image is missing.
 *
 * Everything here is pure, over injected inputs; main.ts supplies the live ones.
 */

import { GRAPHICS_MODE_CATALOG, GRAPHICS_NONE } from "@neo-angband/core";
import type { GraphicsMode } from "@neo-angband/core";
import type { TileModePack } from "./tile-mods";

/**
 * The tile-pack directories whose art is bundled under packages/web/public/
 * tiles/ (verbatim upstream packs; see that directory's CREDITS.md for each
 * licence). These are the catalog `directory` values, so this list is what
 * decides which core modes are offerable on a stock install.
 *
 * Shockbolt (`shockbolt`) is deliberately absent: its licence forbids
 * redistribution "with other games or projects", so its art is not bundled and
 * its two modes are unreachable until the player supplies a pack of their own.
 * tile-catalog.test.ts holds this list to the actual contents of public/tiles/,
 * in both directions, so it cannot drift from what ships.
 */
export const BUNDLED_TILE_DIRECTORIES: readonly string[] = [
  "old",
  "adam-bolt",
  "gervais",
  "nomad",
];

/** One selectable row of the Graphics menu. */
export interface TileModeEntry {
  /** grafID (the list.txt serial number); GRAPHICS_NONE = ASCII. */
  grafID: number;
  /** The catalog menu name (grafmode.c's `menuname`). */
  menuname: string;
  /**
   * Base URL the pack's art hangs under - the atlas is
   * `<baseUrl>/<directory>/<file>`. Undefined for core modes, which use the
   * shell's own tile base; a mod mode carries the base its manifest declared,
   * so a mod's pack is loaded from the MOD's assets, not core's.
   */
  baseUrl?: string;
  /** The contributing mod's id, when a mod supplied this mode. */
  modId?: string;
  /**
   * The contributing mod's display name, when a mod supplied this mode. The
   * menu tags such rows with it, so it is visible that the row is not stock
   * content and which mod to disable to be rid of it. Core rows leave it unset
   * and are shown plain - they are the upstream tile sets.
   */
  modName?: string;
}

/**
 * The tile sets CORE offers: the catalog modes whose art is available, in
 * catalog (grafID) order. `customBaseUrl` means the player pointed the shell at
 * their own pack (`?tiles=`), in which case the whole catalog is offered
 * because the bundled-art restriction no longer applies.
 *
 * GRAPHICS_NONE is not returned - ASCII is added by the caller as the first row
 * (upstream's menu likewise skips GRAPHICS_NONE when walking the catalog and
 * carries its own "None" item, main-win.c:2897-2905).
 */
export function coreTileModes(input: {
  catalog?: readonly GraphicsMode[];
  bundled?: readonly string[];
  customBaseUrl?: boolean;
}): TileModeEntry[] {
  const catalog = input.catalog ?? GRAPHICS_MODE_CATALOG;
  const bundled = input.bundled ?? BUNDLED_TILE_DIRECTORIES;
  const out: TileModeEntry[] = [];
  for (const mode of catalog) {
    if (mode.grafID === GRAPHICS_NONE || !mode.file) continue;
    if (!input.customBaseUrl && !bundled.includes(mode.directory)) continue;
    out.push({ grafID: mode.grafID, menuname: mode.menuname });
  }
  return out;
}

/**
 * Core's modes with the enabled mods' modes layered on top - the Graphics menu
 * list, ASCII excluded.
 *
 * A mod contributing a grafID core already offers REPLACES that row in place
 * (keeping catalog order) and the row is tagged with the mod: re-skinning an
 * upstream tile set is ordinary modding, and the replacement must be visible.
 * Any other mod mode is appended in contribution order - that is how a player
 * who owns Shockbolt can package it as a mod and have modes 5/6 appear.
 *
 * A mod may override CORE's row but never another mod's: the first contributor
 * of a grafID keeps it, the same first-wins rule enabledTileModes already
 * applies while gathering them.
 */
export function composeTileModes(input: {
  core: readonly TileModeEntry[];
  mods: readonly TileModePack[];
}): TileModeEntry[] {
  const out: TileModeEntry[] = input.core.map((m) => ({ ...m }));
  const claimed = new Set<number>(); // grafIDs a mod has already taken
  for (const pack of input.mods) {
    if (claimed.has(pack.grafID)) continue;
    claimed.add(pack.grafID);
    const entry: TileModeEntry = {
      grafID: pack.grafID,
      menuname: pack.menuname,
      ...(pack.baseUrl === undefined ? {} : { baseUrl: pack.baseUrl }),
      modId: pack.modId,
      modName: pack.modName,
    };
    const at = out.findIndex((m) => m.grafID === pack.grafID);
    if (at >= 0) out[at] = entry;
    else out.push(entry);
  }
  return out;
}
