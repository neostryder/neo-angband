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

import { projNameToIdx } from "../effects/effect.js";
import type { PrefExprVars } from "./pref-expr.js";
import type { ObjRegistry } from "../obj/bind.js";
import type { ObjectKind, Flavor } from "../obj/types.js";
import type { FeatureRegistry } from "../world/feature.js";
import type { TrapKind } from "../world/trap.js";

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
  /**
   * MonsterRegistry (or anything with lookup_monster's raceByName).
   *
   * `races` is optional because a caller that only resolves `monster:` lines
   * needs nothing more than the name lookup - but `monster-base:` lines and
   * `fillTilesFromKin` both walk the whole list, so a caller that omits it gets
   * those two behaviours skipped rather than a type error.
   */
  monsters: {
    raceByName(name: string): { ridx: number } | null;
    races?: readonly { ridx: number; base: { name: string } }[];
  };
  /** Bound trap kinds (t_idx order), or null when the pack has none. */
  traps: readonly TrapKind[] | null;
  /**
   * process_pref_file for `%` include lines (ui-prefs.c L429-441): given a
   * referenced pref filename, return its text, or null to skip it. Omitted,
   * `%` lines are ignored (the web front end loads graf and flvr explicitly).
   */
  loadFile?: (name: string) => string | null;
  /**
   * The `?:` expression variables (ui-prefs.c L553-560): $SYS, $RACE, $CLASS.
   *
   * This is how a pack's "special player pictures" are selected. Every bundled
   * pack ships an xtra-*.prf whose `monster:<player>` lines sit behind
   * `[AND [EQU $CLASS ...] [EQU $RACE ...] ]` blocks, and upstream evaluates
   * them against the LIVE character - reset_visuals(true) runs at
   * ui_leave_init, after birth (ui-display.c L2703), and again whenever the
   * graphics mode changes (main-win.c L1769). Omitted, those blocks all bypass
   * and the pack's unconditional player line stands, which is the correct
   * pre-character state.
   */
  vars?: PrefExprVars;
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

/**
 * The tile an object should DRAW with, which is not always its kind's.
 *
 * THE GLYPH PATH HAS ALWAYS KNOWN THIS AND THE TILE PATH DID NOT.
 * object_kind_attr / object_kind_char (ui-object.c:87-112) draw a flavoured
 * kind with its FLAVOUR's attr and char until the player is aware of it - that
 * is why an unidentified potion reads as "an Ochre Potion" and not as what it
 * turns out to be. The renderer implemented exactly that for glyphs and then
 * asked `tileForObject(map, o.kind)` for the tile, so a graphics player saw:
 *
 *   - nothing, and a fallback glyph, for every flavoured item, because tile
 *     sets key those by FLAVOUR and `map.object[kidx]` has no entry; or
 *   - worse, had the set carried a kind entry, the identified item's art on an
 *     object the player has not identified. A spoiler drawn in 32x32.
 *
 * `tileForFlavor` existed, was exported, was tested, and had no caller outside
 * its own test file. This is the caller.
 *
 * NO FALLING BACK from the flavour tile to the kind tile. A missing flavour
 * tile means the tile set does not draw this flavour, and the honest answer is
 * the flavour GLYPH - reaching past it to the kind's art would leak the very
 * thing the flavour exists to hide.
 */
export function tileForShownObject(
  map: TileMap,
  kind: Pick<ObjectKind, "kidx">,
  /** The flavour to draw as, or null to draw as the kind. */
  flavor: Pick<Flavor, "fidx"> | number | null,
): TileAtlas | null {
  return flavor === null ? tileForObject(map, kind) : tileForFlavor(map, flavor);
}

/* ------------------------------------------------------------------ *
 * Provisioning an ADDED entity with a tile.
 * ------------------------------------------------------------------ */

/** How many entries a kin fill supplied, by category. */
export interface KinTileFill {
  readonly monsters: number;
  readonly objects: number;
}

/** What a kin fill needs to know: who is kin to whom, and who added what. */
export interface KinTileDeps {
  readonly monsters: {
    readonly races?: readonly {
      ridx: number;
      base: { name: string };
      from?: { owner: string };
    }[];
  };
  readonly objects: {
    readonly kinds: readonly { kidx: number; tval: number; from?: { owner: string } }[];
  };
}

/**
 * The pack whose content is NOT provisioned - the base game. A record with no
 * provenance is core's own and unmodified, and a record owned by `baseId` is
 * core's own with a mod's patch applied; neither is something a tile pack could
 * not have known about.
 */
const BASE_PACK = "core";

/** Whether a record was ADDED by a mod, rather than being core's own. */
function addedByMod(rec: { from?: { owner: string } }, baseId: string): boolean {
  return rec.from !== undefined && rec.from.owner !== baseId;
}

/**
 * Give every entity with no tile of its own the tile of its nearest KIN: a
 * monster takes one from another race sharing its `base`, an object kind from
 * another kind sharing its `tval`.
 *
 * WHY THIS IS NOT A CONVENIENCE. A pref file assigns tiles by ATLAS
 * COORDINATE, and every tile pack lays its atlas out differently - so a mod
 * that adds a monster cannot name a cell that is correct in Linoleum and also
 * correct in a pack the author has never seen. The author's only portable
 * options were to ship one pref file per known pack, or to accept a coloured
 * glyph standing in a tiled dungeon. Neither is provisioning a creature; the
 * first is unmaintainable and the second is the wart. Kin resolution is
 * pack-independent because it copies whatever THAT pack already drew for the
 * family, so an added ant is an ant in every tile set at once.
 *
 * ONLY MOD-ADDED RECORDS ARE FILLED, and that restriction is the whole safety
 * argument. It was originally written to fill anything the pack had left blank,
 * on the assumption that a shipped pack draws everything core ships. Measured
 * against the real packs, that assumption is false twice over: rings, amulets,
 * mushrooms and food are drawn by FLAVOUR, so their kind slots are empty by
 * design and filling them would put art on an identified ring that the pack
 * never drew; and an older pack such as adam-bolt simply has no tile for
 * content added to the game after it was made - 19 monsters and a Knight's
 * Shield among them - where a glyph is the honest answer and a sibling's tile
 * would be a lie. Provenance is what separates the two cases: a record with no
 * `from`, or one owned by the base pack, is core's and is left alone, so this
 * cannot change how the unmodded game draws at all. An author who wants a
 * specific cell still says so in a `.prf` and that wins, because their pref
 * layers in before this runs.
 *
 * Donors are NOT restricted that way: core's art is exactly what a mod's ant
 * should borrow.
 *
 * Deterministic: the donor is the lowest-index kin carrying a tile, and both
 * registries are in bound order.
 */
export function fillTilesFromKin(
  map: TileMap,
  deps: KinTileDeps,
  baseId: string = BASE_PACK,
): KinTileFill {
  let monsters = 0;
  const races = deps.monsters.races;
  if (races) {
    const donor = new Map<string, TileAtlas>();
    for (const race of races) {
      const tile = map.monster[race.ridx];
      if (tile && !donor.has(race.base.name)) donor.set(race.base.name, tile);
    }
    for (const race of races) {
      if (map.monster[race.ridx] || !addedByMod(race, baseId)) continue;
      const tile = donor.get(race.base.name);
      if (!tile) continue;
      map.monster[race.ridx] = { ...tile };
      monsters++;
    }
  }

  let objects = 0;
  const donorByTval = new Map<number, TileAtlas>();
  for (const kind of deps.objects.kinds) {
    const tile = map.object[kind.kidx];
    if (tile && !donorByTval.has(kind.tval)) donorByTval.set(kind.tval, tile);
  }
  for (const kind of deps.objects.kinds) {
    if (map.object[kind.kidx] || !addedByMod(kind, baseId)) continue;
    const tile = donorByTval.get(kind.tval);
    if (!tile) continue;
    map.object[kind.kidx] = { ...tile };
    objects++;
  }

  return { monsters, objects };
}

/** Projection tile for a PROJ index and BOLT motion, or null. */
export function tileForProjection(
  map: TileMap,
  gf: number,
  motion: number,
): TileAtlas | null {
  return (map.gf[gf] as (TileAtlas | undefined)[] | undefined)?.[motion] ?? null;
}
