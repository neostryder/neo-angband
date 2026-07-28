/**
 * The graphics pref-map subsystem, ported from reference/src/ui-prefs.c
 * (Angband 4.2.6): the parser that turns a graf-*.prf / flvr-*.prf pref file
 * into the per-entity attr/char tile-atlas mapping.
 *
 * Upstream stores the mapping in the global x_attr/x_char arrays
 * (monster_x_attr, kind_x_attr, feat_x_attr[LIGHTING], trap_x_attr[LIGHTING],
 * flavor_x_attr, proj_to_attr[PROJ][BOLT]) and fills them from the pref file
 * in the parse_prefs_* handlers (ui-prefs.c L602-928). This module keeps the
 * same shape in a queryable TileMap and ports the line grammar those handlers
 * register (init_parse_prefs, ui-prefs.c L1129-1160).
 *
 * The graphics-relevant line types that actually appear in the four bundled
 * packs (old, adam-bolt, gervais, nomad) are: feat, monster, object, trap, GF
 * (in graf-*.prf) and flavor (in flvr-*.prf), plus the `%` include and `#`
 * comment lines. Colour/keymap/message/window/entry-renderer lines are not
 * graphics data and are ignored here (a real prf that mixes them still parses;
 * the non-graphics lines are simply skipped).
 *
 * Names/tvals resolve through the same core registries the rest of the port
 * uses: features by terrain code then printable name (lookup_feat_code then
 * lookup_feat, ui-prefs.c L809-819), monsters by race name (lookup_monster),
 * objects by tval+sval (tval_find_idx / lookup_sval / lookup_kind), flavors by
 * fidx, projections by element/projection name (proj_name_to_idx), and traps
 * by desc (lookup_trap). Unknown or unmapped entities are skipped, so a lookup
 * miss returns null and the caller falls back to ASCII.
 *
 * Determinism: parsing and lookup draw no game RNG.
 */

import { projNameToIdx } from "../effects/effect";
import type { ObjRegistry } from "../obj/bind";
import type { ObjectKind, Flavor } from "../obj/types";
import type { FeatureRegistry } from "../world/feature";
import type { TrapKind } from "../world/trap";

/**
 * grid_light_level (cave.h L137-143): the lighting variants a feat/trap tile
 * may specify. LIGHTING_MAX in a `*` lighting field means "all variants".
 */
export const LIGHTING = {
  LOS: 0,
  TORCH: 1,
  LIT: 2,
  DARK: 3,
  MAX: 4,
} as const;

/**
 * bolt_motion (project.h L53-59): the projection graphic's motion variant.
 * `static` is BOLT_NO_MOTION; the four numeric directions map to BOLT_0..135.
 */
export const BOLT = {
  NO_MOTION: 0,
  D0: 1,
  D45: 2,
  D90: 3,
  D135: 4,
  MAX: 5,
} as const;

/** proj_name_to_idx("MAX") yields PROJ_MAX (the projection table length). */
const PROJ_MAX = projNameToIdx("MAX");

/**
 * One tile-atlas cell: the raw (attr, char) pair as written in the pref file.
 * These keep the high bit set (e.g. attr 0x85, char 0xA0); decoding to an
 * atlas (row, col) via row = attr & 0x7F, col = char & 0x7F is the front end's
 * job (see packages/web tiles.ts tileCode), exactly as upstream keeps the raw
 * bytes in the x_attr/x_char arrays and the port half decodes them at blit.
 */
export interface TileAtlas {
  attr: number;
  char: number;
}

/**
 * The parsed tile mapping: the port of the x_attr/x_char globals as one
 * queryable object. Entries are sparse - only entities the pref file names are
 * populated; everything else stays undefined and reads back as null.
 */
export class TileMap {
  /** feat_x_attr/char[LIGHTING][fidx]: terrain tiles per lighting variant. */
  readonly feat: (TileAtlas | undefined)[][] = [[], [], [], []];
  /** trap_x_attr/char[LIGHTING][tidx]: trap tiles per lighting variant. */
  readonly trap: (TileAtlas | undefined)[][] = [[], [], [], []];
  /** monster_x_attr/char[ridx]. */
  readonly monster: (TileAtlas | undefined)[] = [];
  /** kind_x_attr/char[kidx]. */
  readonly object: (TileAtlas | undefined)[] = [];
  /** flavor_x_attr/char[fidx]. */
  readonly flavor: (TileAtlas | undefined)[] = [];
  /** proj_to_attr/char[PROJ][BOLT]. */
  readonly gf: (TileAtlas | undefined)[][] = Array.from(
    { length: PROJ_MAX },
    () => [] as (TileAtlas | undefined)[],
  );
}

/** The registries a pref parse resolves names/tvals against. */
export interface TilePrefsDeps {
  features: FeatureRegistry;
  objects: ObjRegistry;
  /** MonsterRegistry (or anything with lookup_monster's raceByName). */
  monsters: { raceByName(name: string): { ridx: number } | null };
  /** Bound trap kinds (t_idx order), or null when the pack has none. */
  traps: readonly TrapKind[] | null;
  /**
   * process_pref_file for `%` include lines (ui-prefs.c L429-441): given a
   * referenced pref filename, return its text, or null to skip it. Omitted,
   * `%` lines are ignored (the web front end loads graf and flvr explicitly).
   */
  loadFile?: (name: string) => string | null;
}

/* ------------------------------------------------------------------ */
/* Lookups: given a game entity, return its tile atlas or null.         */
/* ------------------------------------------------------------------ */

/** Terrain tile for a feature index at a lighting variant, or null. */
export function tileForFeature(
  map: TileMap,
  fidx: number,
  lighting: number,
): TileAtlas | null {
  const l = lighting >= 0 && lighting < LIGHTING.MAX ? lighting : LIGHTING.LOS;
  return (map.feat[l] as (TileAtlas | undefined)[])[fidx] ?? null;
}

/** Trap tile for a trap index at a lighting variant, or null. */
export function tileForTrap(
  map: TileMap,
  tidx: number,
  lighting: number,
): TileAtlas | null {
  const l = lighting >= 0 && lighting < LIGHTING.MAX ? lighting : LIGHTING.LOS;
  return (map.trap[l] as (TileAtlas | undefined)[])[tidx] ?? null;
}

/** Monster tile for a race index (ridx), or null. */
export function tileForMonster(map: TileMap, ridx: number): TileAtlas | null {
  return map.monster[ridx] ?? null;
}

/** Object tile for an object kind, or null. */
export function tileForObject(
  map: TileMap,
  kind: Pick<ObjectKind, "kidx">,
): TileAtlas | null {
  return map.object[kind.kidx] ?? null;
}

/** Flavor tile for a flavor (by fidx), or null. */
export function tileForFlavor(
  map: TileMap,
  flavor: Pick<Flavor, "fidx"> | number,
): TileAtlas | null {
  const fidx = typeof flavor === "number" ? flavor : flavor.fidx;
  return map.flavor[fidx] ?? null;
}

/** Projection tile for a PROJ index and BOLT motion, or null. */
export function tileForProjection(
  map: TileMap,
  gf: number,
  motion: number,
): TileAtlas | null {
  return (map.gf[gf] as (TileAtlas | undefined)[] | undefined)?.[motion] ?? null;
}
