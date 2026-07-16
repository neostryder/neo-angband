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
import { tvalFindIdx } from "../obj/bind";
import type { ObjRegistry } from "../obj/bind";
import type { ObjectKind, Flavor } from "../obj/types";
import type { FeatureRegistry } from "../world/feature";
import type { TrapKind } from "../world/trap";
import { lookupTrap } from "../world/trap";

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

/**
 * parse_int/parse_uint (parser.c L315: strtol(tok, &z, 0)): base-0 integer
 * parsing - 0x/0X hex, a leading 0 as octal, otherwise decimal, with an
 * optional sign. The whole token (after trimming) must be a clean number, or
 * the value is rejected (null), matching the parser's NOT_NUMBER check.
 */
function parseNum(tok: string): number | null {
  const s = tok.trim();
  if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
  if (/^[-+]?0[0-7]+$/.test(s)) {
    const neg = s.startsWith("-");
    const digits = s.replace(/^[-+]/, "");
    const v = parseInt(digits, 8);
    return neg ? -v : v;
  }
  if (/^[-+]?\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

/**
 * The lighting keyword -> LIGHTING index, or LIGHTING.MAX for `*` (meaning all
 * variants), or -1 for an invalid keyword (ui-prefs.c L824-836).
 */
function lightingIdx(kw: string): number {
  switch (kw) {
    case "torch":
      return LIGHTING.TORCH;
    case "los":
      return LIGHTING.LOS;
    case "lit":
      return LIGHTING.LIT;
    case "dark":
      return LIGHTING.DARK;
    case "*":
      return LIGHTING.MAX;
    default:
      return -1;
  }
}

/** Store a tile at every lighting variant, or just one (set_trap_graphic-style). */
function setPerLighting(
  table: (TileAtlas | undefined)[][],
  lightIdx: number,
  idx: number,
  atlas: TileAtlas,
): void {
  if (lightIdx < LIGHTING.MAX) {
    (table[lightIdx] as (TileAtlas | undefined)[])[idx] = atlas;
  } else {
    for (let j = 0; j < LIGHTING.MAX; j++) {
      (table[j] as (TileAtlas | undefined)[])[idx] = atlas;
    }
  }
}

/* parse_prefs_feat (ui-prefs.c L798-849). */
function parseFeat(
  map: TileMap,
  fields: string[],
  deps: TilePrefsDeps,
): void {
  const [sym, lighting, attrTok, charTok] = fields;
  if (sym === undefined || lighting === undefined) return;
  /* lookup_feat_code, then lookup_feat by printable name (L809-819). */
  const feature =
    deps.features.lookupByCode(sym) ?? deps.features.lookupByName(sym);
  if (!feature) return;
  const lightIdx = lightingIdx(lighting);
  if (lightIdx < 0) return;
  const attr = parseNum(attrTok ?? "");
  const chr = parseNum(charTok ?? "");
  if (attr === null || chr === null) return;
  setPerLighting(map.feat, lightIdx, feature.fidx, { attr, char: chr });
}

/* parse_prefs_trap (ui-prefs.c L745-796). */
function parseTrap(
  map: TileMap,
  fields: string[],
  deps: TilePrefsDeps,
): void {
  const [idxSym, lighting, attrTok, charTok] = fields;
  if (idxSym === undefined || lighting === undefined) return;
  if (!deps.traps) return;
  const lightIdx = lightingIdx(lighting);
  if (lightIdx < 0) return;
  const attr = parseNum(attrTok ?? "");
  const chr = parseNum(charTok ?? "");
  if (attr === null || chr === null) return;
  if (idxSym === "*") {
    /* trap:*: apply to every trap kind (L784-789). */
    for (let i = 0; i < deps.traps.length; i++) {
      setPerLighting(map.trap, lightIdx, i, { attr, char: chr });
    }
    return;
  }
  const trap = lookupTrap(deps.traps, idxSym);
  if (!trap) return;
  setPerLighting(map.trap, lightIdx, trap.tidx, { attr, char: chr });
}

/* parse_prefs_monster (ui-prefs.c L682-700). */
function parseMonster(
  map: TileMap,
  fields: string[],
  deps: TilePrefsDeps,
): void {
  const [name, attrTok, charTok] = fields;
  if (name === undefined) return;
  const race = deps.monsters.raceByName(name);
  if (!race) return;
  const attr = parseNum(attrTok ?? "");
  const chr = parseNum(charTok ?? "");
  if (attr === null || chr === null) return;
  map.monster[race.ridx] = { attr, char: chr };
}

/* parse_prefs_object (ui-prefs.c L602-680), including the tval/sval `*`
 * wildcards that set every matching kind and flavor. */
function parseObject(
  map: TileMap,
  fields: string[],
  deps: TilePrefsDeps,
): void {
  const [tval, sval, attrTok, charTok] = fields;
  if (tval === undefined || sval === undefined) return;
  const attr = parseNum(attrTok ?? "");
  const chr = parseNum(charTok ?? "");
  if (attr === null || chr === null) return;
  const atlas: TileAtlas = { attr, char: chr };

  if (tval === "*") {
    /* object:*:* - every object and flavor (L614-634). */
    if (sval !== "*") return;
    for (const kind of deps.objects.kinds) map.object[kind.kidx] = atlas;
    for (const flavor of deps.objects.flavors) map.flavor[flavor.fidx] = atlas;
    return;
  }

  const tvi = tvalFindIdx(tval);
  if (tvi < 0) return; // L636-638: unknown tval is skipped

  if (sval === "*") {
    /* object:tval:* - every kind and flavor with this tval (L640-661). */
    for (const kind of deps.objects.kinds) {
      if (kind.tval === tvi) map.object[kind.kidx] = atlas;
    }
    for (const flavor of deps.objects.flavors) {
      if (flavor.tval === tvi) map.flavor[flavor.fidx] = atlas;
    }
    return;
  }

  const svi = deps.objects.lookupSval(tvi, sval);
  if (svi < 0) return; // L666-668: unknown sval is silently skipped
  const kind = deps.objects.lookupKind(tvi, svi);
  if (!kind) return;
  map.object[kind.kidx] = atlas;
}

/* parse_prefs_flavor (ui-prefs.c L908-928): by flavor index (fidx). */
function parseFlavor(map: TileMap, fields: string[]): void {
  const [idxTok, attrTok, charTok] = fields;
  const idx = parseNum(idxTok ?? "");
  const attr = parseNum(attrTok ?? "");
  const chr = parseNum(charTok ?? "");
  if (idx === null || attr === null || chr === null) return;
  /* The C only stores when a flavor with that fidx exists; we accept any
   * non-negative fidx and let the caller's lookup miss when there is none. */
  if (idx < 0) return;
  map.flavor[idx] = { attr, char: chr };
}

/* parse_prefs_gf (ui-prefs.c L851-906). */
function parseGf(map: TileMap, fields: string[]): void {
  const [type, direction, attrTok, charTok] = fields;
  if (type === undefined || direction === undefined) return;
  const attr = parseNum(attrTok ?? "");
  const chr = parseNum(charTok ?? "");
  if (attr === null || chr === null) return;

  /* The type is a | (or space) separated list of PROJ_ names, or `*`. */
  const projIdxs: number[] = [];
  let all = false;
  for (const t of type.split(/[| ]+/)) {
    if (t.length === 0) continue;
    if (t === "*") {
      all = true;
      break;
    }
    const idx = projNameToIdx(t);
    if (idx === -1) return; // L873-874: an invalid PROJ name fails the line
    projIdxs.push(idx);
  }

  let motion: number;
  switch (direction) {
    case "static":
      motion = BOLT.NO_MOTION;
      break;
    case "0":
      motion = BOLT.D0;
      break;
    case "45":
      motion = BOLT.D45;
      break;
    case "90":
      motion = BOLT.D90;
      break;
    case "135":
      motion = BOLT.D135;
      break;
    default:
      return; // L895-896: invalid direction fails the line
  }

  const atlas: TileAtlas = { attr, char: chr };
  if (all) {
    for (let i = 0; i < PROJ_MAX; i++) {
      (map.gf[i] as (TileAtlas | undefined)[])[motion] = atlas;
    }
  } else {
    for (const i of projIdxs) {
      (map.gf[i] as (TileAtlas | undefined)[])[motion] = atlas;
    }
  }
}

/**
 * Split a pref line into its directive and colon-delimited fields, faithful to
 * the colon-separated pref grammar (parser.c). A `#` line is a comment and a
 * blank line is skipped (returns null).
 */
function splitLine(line: string): { dir: string; fields: string[] } | null {
  const trimmed = line.replace(/\r$/, "");
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("#")) return null;
  const parts = trimmed.split(":");
  const dir = parts[0] ?? "";
  if (dir.length === 0) return null;
  return { dir, fields: parts.slice(1) };
}

/**
 * Parse a graf-*.prf or flvr-*.prf text INTO an existing TileMap (so a graf
 * file and its flvr file layer into one map). Later lines overwrite earlier
 * ones for the same entity, exactly as the C reassigns the x_attr/x_char slot.
 */
export function parseTilePrefsInto(
  map: TileMap,
  text: string,
  deps: TilePrefsDeps,
): void {
  for (const raw of text.split("\n")) {
    const parsed = splitLine(raw);
    if (!parsed) continue;
    const { dir, fields } = parsed;
    switch (dir) {
      case "feat":
        parseFeat(map, fields, deps);
        break;
      case "trap":
        parseTrap(map, fields, deps);
        break;
      case "monster":
        parseMonster(map, fields, deps);
        break;
      case "object":
        parseObject(map, fields, deps);
        break;
      case "flavor":
        parseFlavor(map, fields);
        break;
      case "GF":
        parseGf(map, fields);
        break;
      case "%":
        /* process_pref_file include (ui-prefs.c L429-441): pull in the
         * referenced file when a resolver is provided, else skip. */
        if (deps.loadFile && fields[0]) {
          const included = deps.loadFile(fields[0]);
          if (included !== null) parseTilePrefsInto(map, included, deps);
        }
        break;
      default:
        /* Non-graphics line (color/message/keymap/window/...) - skip. */
        break;
    }
  }
}

/** Parse pref text into a fresh TileMap. */
export function parseTilePrefs(text: string, deps: TilePrefsDeps): TileMap {
  const map = new TileMap();
  parseTilePrefsInto(map, text, deps);
  return map;
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
