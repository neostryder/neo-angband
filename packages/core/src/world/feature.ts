/**
 * Terrain features, ported from reference/src/cave.h struct feature and
 * the terrain.txt binding in init.c (Angband 4.2.6).
 *
 * Features bind from the compiled terrain.json; indices (fidx) follow
 * the generated FEAT codes from list-terrain.h so square feats stay
 * numerically identical to upstream.
 */

import { FlagSet } from "../bitflag.js";
import { FEAT, RF, TERRAIN_ENTRIES, TERRAIN_FLAG_ENTRIES, TF } from "../generated/index.js";
import type { ModExtensible } from "../mod/extension.js";
import { attachExt } from "../mod/extension.js";

/** Byte size of a terrain FlagSet (upstream TF_SIZE). */
export const TF_SIZE = Math.ceil(TERRAIN_FLAG_ENTRIES.length / 8);

export interface Feature extends ModExtensible {
  /** FEAT_* index (position in list-terrain.h). */
  fidx: number;
  /** The list-terrain.h code, e.g. "FLOOR", "GRANITE". */
  code: string;
  name: string;
  desc: string;
  /** Feature code to mimic for display, resolved to fidx, or null. */
  mimic: number | null;
  priority: number;
  /** How hard to dig through (1..5 scale from digging:). */
  dig: number;
  flags: FlagSet;
  /** Default display attr (color char) and glyph. */
  dAttr: string;
  dChar: string;
  walkMsg: string;
  runMsg: string;
  hurtMsg: string;
  dieMsg: string;
  confusedMsg: string;
  lookPrefix: string;
  lookInPreposition: string;
  /** RF_* monster resist flag index required to enter, or 0. */
  resistFlag: number;
  /**
   * finish_parse_feat (init.c L2251-2256): which shop this entrance leads to,
   * 1-based, assigned in FEAT order to every TF_SHOP feature once the terrain
   * parse has finished; 0 for everything that is not a shop. square_shopnum
   * (cave-square.c L1512) reads it as `shopnum - 1`, and the number of them is
   * z_info->store_max (L2275).
   */
  shopnum: number;
}

/** The compiled terrain.json record shape. */
export interface TerrainRecordJson {
  code: string;
  name: string;
  graphics?: { glyph: string; color: string };
  priority?: number;
  flags?: string[];
  desc?: string[];
  digging?: number;
  mimic?: string;
  "walk-msg"?: string[];
  "run-msg"?: string[];
  "hurt-msg"?: string[];
  "die-msg"?: string[];
  "confused-msg"?: string[];
  /*
   * These three are single-token directives, but the spec (like every other
   * `repeat: true` field) compiles them to a one-element string array rather
   * than a bare string; joinLines/resolveResistFlag below unwrap that.
   */
  "look-prefix"?: string[];
  "look-in-preposition"?: string[];
  "resist-flag"?: string[];
}

function parseFlagNames(lines: string[] | undefined): FlagSet {
  const flags = new FlagSet(TF_SIZE);
  if (!lines) return flags;
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = (TF as Record<string, number>)[name];
      if (value === undefined || value === 0) {
        throw new Error(`terrain: unknown flag ${name}`);
      }
      flags.on(value);
    }
  }
  return flags;
}

function joinLines(lines: string[] | undefined): string {
  // string_append semantics: multi-line values concatenate with no
  // separator; trailing spaces in the source lines are load-bearing.
  return lines ? lines.join("") : "";
}

/**
 * finish_parse_feat (init.c L2256-2272): "Ensure the prefixes and
 * prepositions end with a space for ease of use with the targeting code."
 * terrain.txt itself carries no trailing space on any of them, so the
 * targeting code's `<preposition><prefix><name>` concatenation only reads
 * correctly because of this normalisation - without it the look UI renders
 * "theArmoury", "inan open door" and "somelava".
 */
function ensureTrailingSpace(value: string): string {
  if (!value || value.endsWith(" ")) return value;
  return value + " ";
}

/**
 * player.h's digging enum: DIGGING_RUBBLE = 0 .. DIGGING_DOORS = 4,
 * DIGGING_MAX = 5. parse_feat_digging (init.c) accepts only
 * `DIGGING_RUBBLE + 1 .. DIGGING_MAX`, i.e. 1..5 -- 0 and DIGGING_MAX + 1
 * are both PARSE_ERROR_OUT_OF_BOUNDS (f-info.c test_digging_bad0). f->dig
 * indexes calc_digging_chances()' `chances[DIGGING_MAX]`, so an
 * out-of-range value is a live out-of-bounds read upstream too; upstream
 * refuses the data rather than clamping, and so does this.
 */
const DIGGING_MIN_VALID = 1;
const DIGGING_MAX_VALID = 5;

function resolveDigging(code: string, dig: number | undefined): number {
  if (dig === undefined) return 0;
  if (dig < DIGGING_MIN_VALID || dig > DIGGING_MAX_VALID) {
    throw new Error(
      `terrain: ${code}: digging ${String(dig)} is out of bounds ` +
        `(PARSE_ERROR_OUT_OF_BOUNDS; init.c parse_feat_digging accepts ` +
        `${String(DIGGING_MIN_VALID)}..${String(DIGGING_MAX_VALID)})`,
    );
  }
  return dig;
}

function resolveResistFlag(name: string | undefined): number {
  if (!name) return 0;
  const value = (RF as Record<string, number>)[name];
  if (value === undefined) {
    throw new Error(`terrain: unknown resist flag ${name}`);
  }
  return value;
}

/**
 * The feature registry: features indexed by fidx (FEAT order) with
 * lookups by code and name.
 */
export class FeatureRegistry {
  private byIdx: (Feature | undefined)[] = [];
  private byCode = new Map<string, Feature>();
  private byName = new Map<string, Feature>();
  /** fidx of each shop entrance, indexed by store number (shopnum - 1). */
  private shopFeatIdx: number[] = [];

  constructor(records: TerrainRecordJson[]) {
    const featMap = FEAT as Record<string, number>;
    for (const rec of records) {
      const fidx = featMap[rec.code];
      if (fidx === undefined) {
        throw new Error(`terrain: code not in list-terrain.h: ${rec.code}`);
      }
      const feature: Feature = {
        fidx,
        code: rec.code,
        name: rec.name,
        desc: joinLines(rec.desc),
        mimic: null,
        priority: rec.priority ?? 0,
        dig: resolveDigging(rec.code, rec.digging),
        flags: parseFlagNames(rec.flags),
        dAttr: rec.graphics?.color ?? "w",
        dChar: rec.graphics?.glyph ?? " ",
        walkMsg: joinLines(rec["walk-msg"]),
        runMsg: joinLines(rec["run-msg"]),
        hurtMsg: joinLines(rec["hurt-msg"]),
        dieMsg: joinLines(rec["die-msg"]),
        confusedMsg: joinLines(rec["confused-msg"]),
        lookPrefix: ensureTrailingSpace(joinLines(rec["look-prefix"])),
        lookInPreposition: ensureTrailingSpace(joinLines(rec["look-in-preposition"])),
        resistFlag: resolveResistFlag(rec["resist-flag"]?.[0]),
        shopnum: 0, /* assigned by the finish_parse_feat pass below */
      };
      attachExt("terrain", rec, feature);
      this.byIdx[fidx] = feature;
      this.byCode.set(rec.code, feature);
      this.byName.set(rec.name, feature);
    }
    // Second pass: resolve mimic references by code.
    for (const rec of records) {
      if (rec.mimic !== undefined) {
        const f = this.byCode.get(rec.code) as Feature;
        const target = this.byCode.get(rec.mimic);
        if (!target) throw new Error(`terrain: mimic not found: ${rec.mimic}`);
        f.mimic = target.fidx;
      }
    }
    /*
     * finish_parse_feat (init.c L2249-2257, L2275): "Assign shop index based
     * on the order within the other terrain" - one pass in FEAT order over
     * every feature, ++shop_idx for each TF_SHOP one, and the final count is
     * z_info->store_max.
     *
     * DERIVED, not listed. The SHOP flag is data: a mod that patches a
     * terrain record's `flags:` to add SHOP gains a store the town has to lay
     * out, and one that clears it loses a store - which is exactly what
     * upstream's derivation does and what a hard-coded feature list cannot.
     */
    for (let fidx = 0; fidx < TERRAIN_ENTRIES.length; fidx++) {
      const f = this.byIdx[fidx];
      if (!f || !f.flags.has(TF.SHOP)) continue;
      this.shopFeatIdx.push(fidx);
      f.shopnum = this.shopFeatIdx.length;
    }
  }

  get(fidx: number): Feature {
    const f = this.byIdx[fidx];
    if (!f) throw new Error(`feature index not bound: ${fidx}`);
    return f;
  }

  byCodeName(code: string): Feature {
    const f = this.byCode.get(code);
    if (!f) throw new Error(`feature code not bound: ${code}`);
    return f;
  }

  /** Every bound feature, in code-registration order (for id enumeration). */
  allFeatures(): Feature[] {
    return [...this.byCode.values()];
  }

  /** lookup by full name (used by gamedata cross-references). */
  lookupByName(name: string): Feature | null {
    return this.byName.get(name) ?? null;
  }

  /**
   * lookup_feat_code (cave.c L315): the feature with the given list-terrain.h
   * code, or null (the C returns -1). Non-throwing companion to byCodeName,
   * used by the graphics pref parser where an unknown code is skipped rather
   * than fatal.
   */
  lookupByCode(code: string): Feature | null {
    return this.byCode.get(code) ?? null;
  }

  count(): number {
    return this.byCode.size;
  }

  /**
   * z_info->store_max (finish_parse_feat L2275): how many shop entrances the
   * terrain data defines, and so how many store lots town_gen_layout builds.
   */
  get storeMax(): number {
    return this.shopFeatIdx.length;
  }

  /**
   * The shop entrances by store number (index = shopnum - 1), i.e. the
   * `f_info[feat].shopnum == n + 1` lookup build_store (gen-cave.c L2449)
   * does for lot `n`.
   */
  shopFeats(): readonly number[] {
    return this.shopFeatIdx;
  }

  /** Whether the feature has a terrain flag (feat_is_* style helper). */
  featHas(fidx: number, tf: number): boolean {
    return this.get(fidx).flags.has(tf);
  }
}
