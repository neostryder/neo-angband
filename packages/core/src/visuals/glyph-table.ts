/**
 * The runtime attr/char override tables, ported from reference/src/ui-prefs.c
 * (Angband 4.2.6): the `monster_x_attr` / `monster_x_char` /
 * `kind_x_attr` / `kind_x_char` / `feat_x_attr[LIGHTING_MAX]` /
 * `feat_x_char[LIGHTING_MAX]` / `trap_x_attr[LIGHTING_MAX]` /
 * `trap_x_char[LIGHTING_MAX]` / `flavor_x_attr` / `flavor_x_char` globals
 * (ui-prefs.c L46-56), their allocation (textui_prefs_init, L1427-1452) and
 * their (re)initialisation from gamedata (reset_visuals, L1352-1421).
 *
 * WHY THIS IS A SEPARATE LAYER FROM THE GAMEDATA. Upstream never draws a
 * monster with `race->d_attr`: every draw goes through the x_attr/x_char
 * table, which merely STARTS at the gamedata default. Three things write to it
 * after that - a pref file (`process_pref_file`'s parse_prefs_monster and
 * friends, L602-928), the knowledge browser's glyph picker (`glyph_command`,
 * ui-knowledge.c L513-690), and the graphics pref of the active tile mode -
 * and four things read it back out (the map, the knowledge screens, the
 * monster-list sidebar, and the `dump_*` pref writers). A port that reads
 * `race.dAttr` at the draw site cannot express any of that, which is why the
 * glyph picker and the four "Save ... attr/chars" rows were both absent.
 *
 * RELATIONSHIP TO TileMap (tile-prefs.ts). Upstream keeps ONE set of arrays
 * and lets a graf-*.prf write high-bit values into them, so in graphics mode
 * the very same slot holds an atlas (row, col) instead of an (attr, glyph).
 * This port splits the two: TileMap holds the graphics mapping, this table
 * holds the ASCII one. That is behaviourally equivalent because upstream only
 * ever has one of the two interpretations live at a time (`use_graphics`
 * gates it, and display_knowledge picks the tile picker or the glyph picker on
 * the same flag, ui-knowledge.c L945-958) - but it means the glyph picker
 * edits this table and the tile picker edits the TileMap, rather than both
 * editing one array.
 *
 * ATTR NORMALISATION. Upstream's `d_attr` is already a uint8_t COLOUR_* code
 * for every entity type. The port's compiled gamedata keeps the source text's
 * spelling instead: a colour CHAR for features / kinds / traps (`"w"`), a
 * colour NAME for flavours (`"Light Green"`), and an already-numeric attr for
 * monster races. resetVisuals normalises all four to the numeric attr, so from
 * here on the table is uniform exactly as the C's arrays are.
 *
 * Determinism: no RNG anywhere in this module.
 */

import { colorCharToAttr, colorTextToAttr } from "../color.js";
import type { AgentGlyphSource } from "../agent/types.js";
import type { Flavor, ObjectKind } from "../obj/types.js";
import type { MonsterRace } from "../mon/types.js";
import type { Feature } from "../world/feature.js";
import type { TrapKind } from "../world/trap.js";
import { LIGHTING } from "./tile-prefs.js";

/** One (attr, char) pair - upstream's parallel uint8_t/wchar_t slot pair. */
export interface GlyphPair {
  attr: number;
  char: string;
}

/** The gamedata reset_visuals reads its defaults out of. */
export interface GlyphTableDeps {
  /** f_info, indexed by fidx (FEAT_MAX slots upstream). */
  features: readonly Feature[];
  /** k_info in kidx order. */
  kinds: readonly ObjectKind[];
  /** r_info in ridx order. */
  races: readonly MonsterRace[];
  /** trap_info in tidx order; null when the pack binds no traps. */
  traps: readonly TrapKind[] | null;
  /** The flavor list (upstream walks the `flavors` linked list by fidx). */
  flavors: readonly Flavor[];
}

/**
 * The x_attr/x_char arrays as one object. Sparse-safe: a read for an index the
 * gamedata never bound falls back to the caller's default rather than
 * throwing, because upstream's arrays are FEAT_MAX / r_max / k_max long and
 * simply hold the zeroed slot for an unbound entry.
 */
export class GlyphTable {
  /** monster_x_attr / monster_x_char[ridx]. */
  private readonly monster: GlyphPair[] = [];
  /** kind_x_attr / kind_x_char[kidx]. */
  private readonly kind: GlyphPair[] = [];
  /** feat_x_attr / feat_x_char[lighting][fidx]. */
  private readonly feat: GlyphPair[][] = [[], [], [], []];
  /** trap_x_attr / trap_x_char[lighting][tidx]. */
  private readonly trap: GlyphPair[][] = [[], [], [], []];
  /** flavor_x_attr / flavor_x_char[fidx]. */
  private readonly flavor: GlyphPair[] = [];

  constructor(private readonly deps: GlyphTableDeps) {
    this.reset();
  }

  /**
   * reset_visuals(false) (ui-prefs.c L1352): re-extract every default
   * attr/char from the gamedata, discarding any pref-file or picker override.
   * The `load_prefs` half of the C's signature is the caller's job here (the
   * front end re-runs its own pref load, exactly as reset_visuals(true) then
   * calls process_pref_file("font.prf") or the tile mode's graphics pref).
   *
   * WART KEPT: upstream resets flavours from the CURRENT flavor list, which is
   * the shuffled per-game one, not a canonical order - so a reset restores the
   * glyphs this savefile was born with, not the file order.
   */
  reset(): void {
    for (const f of this.deps.features) {
      const pair = { attr: colorCharToAttr(f.dAttr), char: f.dChar };
      for (let j = 0; j < LIGHTING.MAX; j++) {
        this.feat[j]![f.fidx] = { ...pair };
      }
    }
    for (const k of this.deps.kinds) {
      this.kind[k.kidx] = { attr: colorCharToAttr(k.dAttr), char: k.dChar };
    }
    for (const r of this.deps.races) {
      this.monster[r.ridx] = { attr: r.dAttr, char: r.dChar };
    }
    for (const t of this.deps.traps ?? []) {
      const pair = { attr: colorCharToAttr(t.color), char: t.glyph };
      for (let j = 0; j < LIGHTING.MAX; j++) {
        this.trap[j]![t.tidx] = { ...pair };
      }
    }
    for (const f of this.deps.flavors) {
      this.flavor[f.fidx] = { attr: colorTextToAttr(f.dAttr), char: f.dChar };
    }
  }

  /* ----- reads (the draw sites and the dump writers) ----- */

  monsterGlyph(ridx: number): GlyphPair | undefined {
    return this.monster[ridx];
  }

  kindGlyph(kidx: number): GlyphPair | undefined {
    return this.kind[kidx];
  }

  featGlyph(lighting: number, fidx: number): GlyphPair | undefined {
    return this.feat[lighting]?.[fidx];
  }

  trapGlyph(lighting: number, tidx: number): GlyphPair | undefined {
    return this.trap[lighting]?.[tidx];
  }

  flavorGlyph(fidx: number): GlyphPair | undefined {
    return this.flavor[fidx];
  }

  /* ----- writes (the pref parser and the glyph picker) ----- */

  setMonsterGlyph(ridx: number, pair: GlyphPair): void {
    this.monster[ridx] = { ...pair };
  }

  setKindGlyph(kidx: number, pair: GlyphPair): void {
    this.kind[kidx] = { ...pair };
  }

  /**
   * parse_prefs_feat (ui-prefs.c L798-849): a `*` lighting field writes every
   * variant, which is why this takes LIGHTING.MAX as "all".
   */
  setFeatGlyph(lighting: number, fidx: number, pair: GlyphPair): void {
    if (lighting === LIGHTING.MAX) {
      for (let j = 0; j < LIGHTING.MAX; j++) this.feat[j]![fidx] = { ...pair };
      return;
    }
    const row = this.feat[lighting];
    if (row) row[fidx] = { ...pair };
  }

  /** set_trap_graphic (ui-prefs.c L733-743), with the same `*` convention. */
  setTrapGlyph(lighting: number, tidx: number, pair: GlyphPair): void {
    if (lighting === LIGHTING.MAX) {
      for (let j = 0; j < LIGHTING.MAX; j++) this.trap[j]![tidx] = { ...pair };
      return;
    }
    const row = this.trap[lighting];
    if (row) row[tidx] = { ...pair };
  }

  setFlavorGlyph(fidx: number, pair: GlyphPair): void {
    this.flavor[fidx] = { ...pair };
  }

  /**
   * This table as the agent API's AgentGlyphSource (agent/types.ts, 1.1.0).
   *
   * The characters only: an agent draws text, and the attr half of each pair is
   * a colour a terminal renderer owns. Handing the LIVE table over (not a copy)
   * is deliberate - a pref file loaded mid-session must change what an agent
   * sees at the same moment it changes what the player sees.
   */
  agentGlyphs(): AgentGlyphSource {
    return {
      featChar: (lighting, fidx) => this.featGlyph(lighting, fidx)?.char,
      trapChar: (lighting, tidx) => this.trapGlyph(lighting, tidx)?.char,
      kindChar: (kidx) => this.kindGlyph(kidx)?.char,
      flavorChar: (fidx) => this.flavorGlyph(fidx)?.char,
      monsterChar: (ridx) => this.monsterGlyph(ridx)?.char,
    };
  }

  /* ----- enumeration (the dump_* writers walk the whole table) ----- */

  /** The gamedata this table was built from, for the dump writers' names. */
  get gamedata(): GlyphTableDeps {
    return this.deps;
  }
}
