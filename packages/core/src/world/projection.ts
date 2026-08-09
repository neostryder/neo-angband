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

import { Dice } from "../dice.js";
import type { Aspect, Rng } from "../rng.js";
import { ELEMENT_ENTRIES, PROJ, PROJECTION_ENTRIES } from "../generated/index.js";
import { messageLookupByName } from "../sound/engine.js";
import type { ModExtensible } from "../mod/extension.js";
import { attachExt } from "../mod/extension.js";

/** struct projection: the behavioural data for one PROJ_ type. */
export interface ProjectionInfo extends ModExtensible {
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

/** The number of PROJ slots the compiled-in enum accounts for. */
export const CORE_PROJECTION_COUNT =
  PROJECTION_ENTRIES.length + ELEMENT_ENTRIES.length;

/**
 * Bind projection.json into a ProjectionInfo table indexed by PROJ value. The
 * projection.txt / .json record order does NOT match the PROJ enum (upstream
 * matches records to slots by code at load), so each record is placed at its
 * resolved PROJ[code] slot. An unfilled or duplicated slot throws so pack /
 * codegen drift is caught at load.
 *
 * A CODE THE ENUM HAS NEVER HEARD OF IS A MOD'S, AND IT IS BOUND (2026-08-08).
 * This used to throw `projection: unknown code X`, which made adding a
 * projection the one content change that took the game down rather than being
 * ignored - and composition merges projection.json per record (keyed by `code`,
 * see mod-sdk/src/record-key.ts), so the record reached here intact and then
 * killed the bind. Unknown codes are now appended after the compiled-in ones,
 * in record order, which is the same rule objects get: core is pack zero, so
 * every index below CORE_PROJECTION_COUNT is exactly where the enum says it is
 * and nothing upstream indexes can move.
 *
 * TWO THINGS ARE STILL REFUSED, because they would break core rather than
 * extend it:
 *  - `type: "element"`. The first 25 slots are list-elements.h and el_info[] is
 *    indexed by ELEM value; an element in slot 56 has no resistance entry to
 *    read, so it would be an element the player can never resist.
 *  - a code that is not a plain own property of the enum table. `code:
 *    "constructor"` used to resolve through Object.prototype and bind at
 *    index `function Object()`. Unreachable while codes came only from core's
 *    own file; a mod-supplied code is what makes it reachable.
 */
export function bindProjections(
  records: ProjectionRecordJson[],
): ProjectionInfo[] {
  /* 25 elements (list-elements.h) precede the list-projections.h entries. */
  const total = CORE_PROJECTION_COUNT;
  const out: Array<ProjectionInfo | null> = new Array<ProjectionInfo | null>(
    total,
  ).fill(null);
  /* Codes the enum does not carry, and the slot each was appended at, so a
   * second record with the same new code is a duplicate rather than a second
   * slot. */
  const added = new Map<string, number>();

  /*
   * parse_projection_code (obj-init.c) numbers records sequentially and
   * returns PARSE_ERROR_ELEMENT_NAME_MISMATCH when a record whose position is
   * below ELEM_MAX does not carry element_names[position] as its code
   * (proj.c test_code_mismatch0). Binding below is by code, so position would
   * otherwise be free - but el_info[] is indexed by ELEM value and the
   * ordering invariant is what upstream relies on to keep the two in step, so
   * the port enforces it too, on the same input, before binding anything.
   *
   * A record that is absent entirely is NOT this error: upstream never runs
   * the check for a position no record reached, and reports the short file as
   * PARSE_ERROR_TOO_FEW_ENTRIES from finish_parse_projection instead. That is
   * the "no record for PROJ value" throw at the bottom of this function, so
   * missing positions are deliberately skipped here.
   */
  for (let i = 0; i < ELEMENT_ENTRIES.length && i < records.length; i++) {
    const rec = records[i] as ProjectionRecordJson;
    const expected = (ELEMENT_ENTRIES[i] as { name: string }).name;
    if (rec.code !== expected) {
      throw new Error(
        `projection: record ${String(i)} is ${rec.code}, expected the ` +
          `element ${expected} (PARSE_ERROR_ELEMENT_NAME_MISMATCH)`,
      );
    }
  }

  for (const rec of records) {
    /* Object.hasOwn, not a bare lookup: `code: "constructor"` would otherwise
     * resolve through Object.prototype to a function. */
    let index = Object.hasOwn(PROJ, rec.code)
      ? (PROJ as Record<string, number>)[rec.code]
      : added.get(rec.code);
    if (index === undefined) {
      if (rec.type === "element") {
        throw new Error(
          `projection: ${rec.code} is a new projection with type "element", ` +
            `but the ${String(ELEMENT_ENTRIES.length)} elements are fixed ` +
            `(el_info is indexed by ELEM value, so a new one has no ` +
            `resistance entry) - use "environs" or "monster"`,
        );
      }
      index = out.length;
      added.set(rec.code, index);
      out.push(null);
    }
    if (out[index]) {
      throw new Error(`projection: duplicate code ${rec.code}`);
    }
    /* parse_projection_message_type: an unknown MSG_ name is
     * PARSE_ERROR_INVALID_MESSAGE (proj.c test_msgt_bad0). */
    if (rec.msgt !== undefined && messageLookupByName(rec.msgt) < 0) {
      throw new Error(
        `projection: ${rec.code}: invalid msgt ${rec.msgt} ` +
          `(PARSE_ERROR_INVALID_MESSAGE)`,
      );
    }
    let denominator: Dice | null = null;
    if (rec.denominator !== undefined) {
      denominator = new Dice();
      denominator.parseString(rec.denominator);
    }
    out[index] = attachExt<ProjectionInfo>("projection", rec, {
      index,
      code: rec.code,
      name: rec.name ?? rec.code,
      type: rec.type,
      numerator: rec.numerator ?? 0,
      denominator,
      divisor: rec.divisor ?? 1,
      damageCap: rec["damage-cap"] ?? 0,
      obvious: rec.obvious === 1,
      wake: rec.wake === 1,
      msgt: rec.msgt ?? null,
      color: rec.color ?? null,
      blindDesc: rec["blind-desc"] ?? null,
      desc: rec.desc ?? "",
      playerDesc: rec["player-desc"] ?? null,
      lashDesc: rec["lash-desc"] ?? null,
    });
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
