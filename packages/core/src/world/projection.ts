/**
 * Projection runtime data and player damage-vs-resistance scaling, ported from
 * reference/src/project.h (struct projection, loaded from projection.txt) and
 * reference/src/project-player.c adjust_dam (L48), Angband 4.2.6.
 *
 * The generated projections.ts carries only the PROJ names / enum. The
 * behavioural data - the resistance numerator / denominator, the damage
 * divisor and cap, and the obvious / wake flags project_m and project_p read -
 * lives in projection.json and is bound here into ProjectionInfo[], indexed by
 * PROJ value.
 *
 * adjust_dam is the player-side analog of project-mon.c's resist helpers: it
 * scales incoming damage by the player's resistance level for the projection
 * type. It stays pure - the caller looks up the resistance (with the ICE->COLD
 * remap and equip_learn side effect) and passes it in, exactly the split the
 * effect handlers and project_p need.
 *
 * desc / playerDesc / lashDesc are the display-only strings (struct
 * projection's desc / player_desc / lash_desc) consumed by
 * effects/effect-info.ts (effect_projection, effect_describe): desc is always
 * present; playerDesc and lashDesc are absent (null) for projection types the
 * pack never gives a "player-desc" / "lash-desc" line, exactly as upstream
 * leaves those fields NULL.
 */

import { Dice } from "../dice";
import type { Aspect, Rng } from "../rng";
import { PROJ, PROJECTION_ENTRIES } from "../generated";

/** struct projection: the behavioural data for one PROJ_ type. */
export interface ProjectionInfo {
  /** PROJ_ value (index into the table). */
  index: number;
  /** Upstream code, e.g. "ACID". */
  code: string;
  /** In-game name, e.g. "acid". */
  name: string;
  /** "element" | "environs" | "monster". */
  type: string;
  /** Resistance numerator (0 when the type has no variable resistance). */
  numerator: number;
  /** Resistance denominator dice ("3", "8+1d4"), or null when absent. */
  denominator: Dice | null;
  /** diameter-of-source divisor (default 1). */
  divisor: number;
  /** Maximum damage the projection can deal (0 when uncapped/absent). */
  damageCap: number;
  /** Whether the effect's nature is obvious to the player. */
  obvious: boolean;
  /** Whether the projection forces affected monsters awake. */
  wake: boolean;
  /** MSG_ type name for messaging, or null. */
  msgt: string | null;
  /** Colour name (resolved to an attr by the render layer). */
  color: string | null;
  /** "hit by X" description used when the player cannot see the source. */
  blindDesc: string | null;
  /** Generic description ("acid", "fear", ...); always present. */
  desc: string;
  /** Description as experienced by the player ("acid", "frost", ...), or null. */
  playerDesc: string | null;
  /** Description for the LASH effect handler ("acid", "venom", ...), or null. */
  lashDesc: string | null;
}

/** One projection.json record (only the fields bound here are typed). */
export interface ProjectionRecordJson {
  code: string;
  name?: string;
  type: string;
  numerator?: number;
  denominator?: string;
  divisor?: number;
  "damage-cap"?: number;
  obvious?: number;
  wake?: number;
  msgt?: string;
  color?: string;
  desc?: string;
  "player-desc"?: string;
  "lash-desc"?: string;
  "blind-desc"?: string;
}

/**
 * Bind projection.json into a ProjectionInfo table indexed by PROJ value. The
 * projection.txt / .json record order does NOT match the PROJ enum (upstream
 * matches records to slots by code at load), so each record is placed at its
 * resolved PROJ[code] slot. An unknown code, or an unfilled or duplicated slot,
 * throws so pack / codegen drift is caught at load.
 */
export function bindProjections(
  records: ProjectionRecordJson[],
): ProjectionInfo[] {
  /* 25 elements (list-elements.h) precede the list-projections.h entries. */
  const total = PROJECTION_ENTRIES.length + 25;
  const out: Array<ProjectionInfo | null> = new Array<ProjectionInfo | null>(
    total,
  ).fill(null);

  for (const rec of records) {
    const index = (PROJ as Record<string, number>)[rec.code];
    if (index === undefined) {
      throw new Error(`projection: unknown code ${rec.code}`);
    }
    if (out[index]) {
      throw new Error(`projection: duplicate code ${rec.code}`);
    }
    let denominator: Dice | null = null;
    if (rec.denominator !== undefined) {
      denominator = new Dice();
      denominator.parseString(rec.denominator);
    }
    out[index] = {
      index,
      code: rec.code,
      name: rec.name ?? rec.code,
      type: rec.type,
      numerator: rec.numerator ?? 0,
      denominator,
      divisor: rec.divisor ?? 1,
      damageCap: rec["damage-cap"] ?? 0,
      obvious: (rec.obvious ?? 0) !== 0,
      wake: (rec.wake ?? 0) !== 0,
      msgt: rec.msgt ?? null,
      color: rec.color ?? null,
      blindDesc: rec["blind-desc"] ?? null,
      desc: rec.desc ?? "",
      playerDesc: rec["player-desc"] ?? null,
      lashDesc: rec["lash-desc"] ?? null,
    };
  }

  for (let i = 0; i < total; i++) {
    if (!out[i]) throw new Error(`projection: no record for PROJ value ${i}`);
  }
  return out as ProjectionInfo[];
}

/** RES_LEVEL that means full immunity (el_info res_level 3). */
const RESIST_IMMUNE = 3;
/** RES_LEVEL that means vulnerability. */
const RESIST_VULNERABLE = -1;

/**
 * adjust_dam: scale `dam` for the player's `resistLevel` against projection
 * `type`. resistLevel is the caller-supplied el_info[res_type].res_level (the
 * caller applies the ICE->COLD remap and any equip-learn side effect): 3 is
 * immune, -1 vulnerable, positive values each divide by numerator/denominator.
 *
 * `minusAc` is minus_ac(p): acid damage is halved when the player has armour
 * that acid can damage. Immunity and vulnerability short-circuit exactly as
 * upstream; the variable-resist denominator is evaluated with the aspect
 * inverted (least damage uses the largest divisor).
 */
export function adjustDam(
  rng: Rng,
  projections: readonly ProjectionInfo[],
  type: number,
  dam: number,
  aspect: Aspect,
  resistLevel: number,
  minusAc = false,
): number {
  /* Immune */
  if (resistLevel === RESIST_IMMUNE) return 0;

  /* Hack - acid damage is halved by armour. */
  if (type === PROJ.ACID && minusAc) dam = Math.trunc((dam + 1) / 2);

  /* Vulnerable */
  if (resistLevel === RESIST_VULNERABLE) return Math.trunc((dam * 4) / 3);

  const info = projections[type];
  let denom = 0;
  if (info && info.denominator) {
    /*
     * Variable resists vary the denominator, so invert the aspect: the
     * minimum damage uses the maximum divisor and vice versa.
     */
    let denomAspect: Aspect = aspect;
    if (aspect === "minimise") denomAspect = "maximise";
    else if (aspect === "maximise") denomAspect = "minimise";
    denom = info.denominator.evaluate(rng, 0, denomAspect);
  }

  const numerator = info ? info.numerator : 0;
  for (let i = resistLevel; i > 0; i--) {
    if (denom) dam = Math.trunc((dam * numerator) / denom);
  }

  return dam;
}
