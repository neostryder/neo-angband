/**
 * Terrain features, ported from reference/src/cave.h struct feature and
 * the terrain.txt binding in init.c (Angband 4.2.6).
 *
 * Features bind from the compiled terrain.json; indices (fidx) follow
 * the generated FEAT codes from list-terrain.h so square feats stay
 * numerically identical to upstream.
 */

import { FlagSet } from "../bitflag";
import { FEAT, RF, TERRAIN_FLAG_ENTRIES, TF } from "../generated";

/** Byte size of a terrain FlagSet (upstream TF_SIZE). */
export const TF_SIZE = Math.ceil(TERRAIN_FLAG_ENTRIES.length / 8);

export interface Feature {
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
        dig: rec.digging ?? 0,
        flags: parseFlagNames(rec.flags),
        dAttr: rec.graphics?.color ?? "w",
        dChar: rec.graphics?.glyph ?? " ",
        walkMsg: joinLines(rec["walk-msg"]),
        runMsg: joinLines(rec["run-msg"]),
        hurtMsg: joinLines(rec["hurt-msg"]),
        dieMsg: joinLines(rec["die-msg"]),
        confusedMsg: joinLines(rec["confused-msg"]),
        lookPrefix: joinLines(rec["look-prefix"]),
        lookInPreposition: joinLines(rec["look-in-preposition"]),
        resistFlag: resolveResistFlag(rec["resist-flag"]?.[0]),
      };
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

  /** lookup by full name (used by gamedata cross-references). */
  lookupByName(name: string): Feature | null {
    return this.byName.get(name) ?? null;
  }

  count(): number {
    return this.byCode.size;
  }

  /** Whether the feature has a terrain flag (feat_is_* style helper). */
  featHas(fidx: number, tf: number): boolean {
    return this.get(fidx).flags.has(tf);
  }
}
