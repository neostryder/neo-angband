/**
 * Golden vectors for EFFECT INFO: the five closed switches of MOD_REACH gap 17.
 *
 * WHY THIS EXISTS. Five `switch` statements decide everything the game says
 * about an effect, and each one is closed against a code it has never heard of:
 *
 *   - `effectMenuName`   (effect-info.ts, keyed on the EFINFO_* flag) - the row
 *     text in the "Activate which item?" / spell menus.
 *   - `formatEffectDesc` (effect-info.ts, same key) - effect_describe's body,
 *     the sentence in object recall and spell descriptions.
 *   - the activation summary walker (obj/effects-info.ts, keyed on the effect
 *     CODE) - which object properties an activation grants, read by
 *     remove_contradictory_activation.
 *   - `effectSubtype`    (effect.ts, keyed on the EF index) - how a gamedata
 *     `type:` NAME becomes the integer subtype.
 *
 * Turning them into keyed registries is a refactor of every string the player
 * reads about an effect, so what has to be proven is not "the effect tests still
 * pass" but "every effect, at every subtype and dice shape the port can build,
 * still produces exactly the same text".
 *
 * NO RNG PROBE HERE, AND THAT IS A MEASURED CLAIM, NOT AN OVERSIGHT. The glyph
 * vectors carry one because level generation draws; this path does not. Upstream
 * `effect_describe` calls `dice_roll()` to populate the random_value it formats;
 * the port substitutes `Dice.randomValue()` at every such site precisely so that
 * rendering a menu row cannot perturb the stream (see effect-info.ts's header).
 * There is no Rng threaded into any of these functions to probe. What is at risk
 * is the TEXT, so the text is what is recorded.
 *
 * THE DEPS ARE SYNTHETIC ON PURPOSE. `timedDesc`, `statName`, `summonDesc` and
 * the projection table are injected, so the real pack would add nothing to
 * dispatch coverage - and stub values that are DISTINCT per index ("tmd7",
 * "proj3-player") are strictly better at catching an arm that reads the wrong
 * field, which real prose ("poison", "a lash of fire") can hide. The activation
 * summary is the exception: it resolves TMD names through the real compiled
 * player_timed records, so those are injected as fixtures.
 *
 * Regenerate with `node packages/core/scripts/gen-effect-info-vectors.mjs` -
 * which OVERWRITES the evidence, so only do it when the change is intended and
 * say so in the commit.
 */

import { Dice } from "../dice.js";
import { EFFECT_ENTRIES } from "../generated/index.js";
import type { EffectRecordJson } from "../obj/types.js";
import type { ActivationSummarizerDeps } from "../obj/effects-info.js";
import { makeActivationSummarizer } from "../obj/effects-info.js";
import { describeEffect, effectMenuName } from "./effect-info.js";
import type { EffectDescribeDeps, EffectMenuNameDeps } from "./effect-info.js";
import { effectNew, effectSubtype } from "./effect.js";
import type { Effect } from "./effect.js";

/**
 * One recorded call. Flat and all-string so a diff names the effect and the
 * scenario that moved rather than reflowing a nested object.
 */
export interface EffectInfoVector {
  /** Which switch this exercises: "menu" | "desc" | "summary" | "subtype". */
  kind: string;
  /** The effect: an EFFECT_ENTRIES name, or a chain label for "summary". */
  effect: string;
  /** The inputs, spelled out. */
  scenario: string;
  /** What the code produced, as a string ("null" for a null return). */
  out: string;
}

/** What the activation-summary vectors need from the shipped pack. */
export interface EffectInfoVectorFixtures {
  /** The real deps makeActivationSummarizer is bound with at the session site. */
  summarizerDeps(): ActivationSummarizerDeps;
  /** Every TMD name of the pack, in index order - the summary's real keys. */
  timedNames(): readonly string[];
}

/* ------------------------------------------------------------------ *
 * Synthetic dependency bags. Distinct per index, so a wrong field shows.
 * ------------------------------------------------------------------ */

const PROJECTIONS = Array.from({ length: 24 }, (_unused, i) => ({
  desc: `proj${i}-desc`,
  playerDesc: `proj${i}-player`,
  lashDesc: `proj${i}-lash`,
}));

const MENU_DEPS: EffectMenuNameDeps = {
  projections: PROJECTIONS,
  timedDesc: (i) => `tmd${i}`,
  statName: (i) => `stat${i}`,
  summonDesc: (i) => `summ${i}`,
};

const DESC_DEPS: EffectDescribeDeps = {
  projections: PROJECTIONS,
  timedDesc: (i) => `tmd${i}`,
  statName: (i) => `stat${i}`,
  summonDesc: (i) => `summ${i}`,
  playerLevel: 23,
};

/* ------------------------------------------------------------------ *
 * Scenario axes.
 * ------------------------------------------------------------------ */

/**
 * Subtypes. 0-3 are the whole domain of the hand-rolled cases (NOURISH's four
 * modes, EARTHQUAKE's TARGETED, GLYPH's two); 7 lands inside the synthetic
 * projection / timed / stat tables so those lookups are distinguishable.
 */
const SUBTYPES = [0, 1, 2, 3, 7] as const;

/**
 * Dice shapes: absent, a plain roll, and one with both a base and an m_bonus -
 * the only combination that reaches EFINFO_HEAL's "(or N%, whichever is
 * greater)" and EFINFO_TELE's level-dependent-distance arms.
 */
const DICE: readonly (string | null)[] = [null, "3d4", "2+5d6M20"];

/** (radius, other): EFINFO_QUAKE, _SPOT, _BREATH and _SHORT read these. */
const SHAPES: readonly (readonly [number, number])[] = [
  [0, 0],
  [3, 4],
];

/** Device-skill boost: zero and non-zero are different arms of append_damage. */
const BOOSTS = [0, 25] as const;

function diceFor(text: string | null): Dice | null {
  if (text === null) return null;
  const d = new Dice();
  d.parseString(text);
  return d;
}

function makeEffect(
  index: number,
  subtype: number,
  dice: string | null,
  radius: number,
  other: number,
): Effect {
  const e = effectNew(index);
  e.subtype = subtype;
  e.dice = diceFor(dice);
  e.diceString = dice;
  e.radius = radius;
  e.other = other;
  return e;
}

/* ------------------------------------------------------------------ *
 * The four vector families.
 * ------------------------------------------------------------------ */

/** effect_get_menu_name over every effect at every scenario. */
export function computeMenuVectors(): EffectInfoVector[] {
  const out: EffectInfoVector[] = [];
  for (let index = 1; index <= EFFECT_ENTRIES.length; index++) {
    const name = (EFFECT_ENTRIES[index - 1] as { name: string }).name;
    for (const subtype of SUBTYPES) {
      for (const dice of DICE) {
        const e = makeEffect(index, subtype, dice, 0, 0);
        out.push({
          kind: "menu",
          effect: name,
          scenario: `subtype=${subtype} dice=${dice ?? "-"}`,
          out: effectMenuName(e, MENU_DEPS),
        });
      }
    }
  }
  return out;
}

/**
 * effect_describe over every effect at every scenario, `onlyFirst` so exactly
 * one pass through formatEffectDesc is recorded per vector.
 */
export function computeDescVectors(): EffectInfoVector[] {
  const out: EffectInfoVector[] = [];
  for (let index = 1; index <= EFFECT_ENTRIES.length; index++) {
    const name = (EFFECT_ENTRIES[index - 1] as { name: string }).name;
    for (const subtype of SUBTYPES) {
      for (const dice of DICE) {
        for (const [radius, other] of SHAPES) {
          for (const boost of BOOSTS) {
            const e = makeEffect(index, subtype, dice, radius, other);
            out.push({
              kind: "desc",
              effect: name,
              scenario: `subtype=${subtype} dice=${dice ?? "-"} r=${radius} o=${other} boost=${boost}`,
              out: String(describeEffect(e, null, boost, true, DESC_DEPS)),
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * The chained arms of effect_describe - RANDOM and SELECT walk their
 * sub-effects through create_nested_effect_description, which calls the same
 * switch from a second call site. A chain of BREATHs with matching dice is the
 * combining arm; a mixed chain is the "or"-joined arm.
 */
export function computeChainVectors(): EffectInfoVector[] {
  const byName = new Map<string, number>();
  EFFECT_ENTRIES.forEach((entry, i) => {
    byName.set((entry as { name: string }).name, i + 1);
  });
  const idx = (n: string): number => byName.get(n) ?? 1;

  const chain = (label: string, names: readonly string[], head: string, count: string): EffectInfoVector => {
    const headEffect = makeEffect(idx(head), 0, count, 0, 0);
    let cursor = headEffect;
    for (const [i, n] of names.entries()) {
      const sub = makeEffect(idx(n), i + 1, "4d6", 2, 3);
      cursor.next = sub;
      cursor = sub;
    }
    return {
      kind: "chain",
      effect: label,
      scenario: `${head}(${count}) -> ${names.join(",")}`,
      out: String(describeEffect(headEffect, "prefix: ", 10, false, DESC_DEPS)),
    };
  };

  return [
    chain("random-breaths", ["BREATH", "BREATH", "BREATH"], "RANDOM", "3"),
    chain("select-breaths", ["BREATH", "BREATH"], "SELECT", "2"),
    chain("random-mixed", ["BALL", "TIMED_INC", "CURE"], "RANDOM", "3"),
    chain("select-mixed", ["BOLT", "HEAL_HP", "TELEPORT"], "SELECT", "3"),
    chain("random-overrun", ["SPOT"], "RANDOM", "4"),
  ];
}

/**
 * effect_summarize_properties over chains that reach all twelve arms of the
 * activation walker, against the real compiled player_timed records.
 */
export function computeSummaryVectors(
  fixtures: EffectInfoVectorFixtures,
): EffectInfoVector[] {
  const summarize = makeActivationSummarizer(fixtures.summarizerDeps());
  const names = fixtures.timedNames();
  const out: EffectInfoVector[] = [];

  const record = (label: string, chain: readonly EffectRecordJson[]): void => {
    const { props, unsummarizedCount } = summarize(chain);
    out.push({
      kind: "summary",
      effect: label,
      scenario: chain.map((e) => `${e.eff}${e.type ? `:${e.type}` : ""}${e.dice ? `(${e.dice})` : ""}`).join(" "),
      out: JSON.stringify({ props, unsummarizedCount }),
    });
  };

  /* Every TMD name through each of the timed arms: this is the exhaustive
   * half, because which properties a cure or an increase yields is entirely a
   * function of the record, and a record with no fail directives and a record
   * with three take different paths through summarize_cure. */
  for (const name of names) {
    record(`CURE ${name}`, [{ eff: "CURE", type: name }]);
    record(`TIMED_INC ${name}`, [{ eff: "TIMED_INC", type: name, dice: "20" }]);
    record(`TIMED_INC_NO_RES ${name}`, [
      { eff: "TIMED_INC_NO_RES", type: name, dice: "20" },
    ]);
    record(`TIMED_DEC ${name}`, [{ eff: "TIMED_DEC", type: name, dice: "20" }]);
    record(`TIMED_SET+ ${name}`, [{ eff: "TIMED_SET", type: name, dice: "20" }]);
    record(`TIMED_SET0 ${name}`, [{ eff: "TIMED_SET", type: name, dice: "0" }]);
  }

  /* The structural arms, which do not vary per TMD name. */
  const anyTimed = names[0] ?? "FAST";
  record("teleport-family", [
    { eff: "TELEPORT", dice: "10" },
    { eff: "TELEPORT_TO" },
    { eff: "TELEPORT_LEVEL" },
  ]);
  record("random-skips", [
    { eff: "RANDOM", dice: "2" },
    { eff: "TIMED_INC", type: anyTimed, dice: "20" },
  ]);
  record("select-skips", [
    { eff: "SELECT", dice: "2" },
    { eff: "CURE", type: anyTimed },
  ]);
  record("set-then-clear", [
    { eff: "SET_VALUE", dice: "30" },
    { eff: "TIMED_INC", type: anyTimed },
    { eff: "CLEAR_VALUE" },
    { eff: "TIMED_INC", type: anyTimed },
  ]);
  record("unsummarized", [{ eff: "DAMAGE", dice: "5d5" }, { eff: "LIGHT_AREA" }]);
  record("unknown-tmd", [{ eff: "TIMED_INC", type: "NOT_A_TIMED_EFFECT", dice: "5" }]);
  record("no-type", [{ eff: "CURE" }, { eff: "TIMED_INC", dice: "5" }]);

  return out;
}

/**
 * effect_subtype: every effect index against every subtype NAME any effect
 * accepts, plus the numeric and garbage paths. -1 means "no such subtype for
 * this effect", and a refactor that widens or narrows that is exactly what
 * this catches.
 */
export function computeSubtypeVectors(): EffectInfoVector[] {
  /* Every literal name the hand-rolled arms accept, plus a representative of
   * each table-driven family and two inputs that must fail. */
  const NAMES = [
    "NONE",
    "INC_BY",
    "DEC_BY",
    "SET_TO",
    "INC_TO",
    "TOBOTH",
    "TOHIT",
    "TODAM",
    "TOAC",
    "TARGETED",
    "WARDING",
    "DECOY",
    "AWAY",
    "SELF",
    "FIRE",
    "POIS",
    "STR",
    "CON",
    "FAST",
    "POISONED",
    "12",
    " 12 ",
    "12x",
    "NOT_A_NAME",
    "",
  ];
  /* SUMMON and SHAPECHANGE resolve through injected lookups the session binds
   * from the summon and shape registries. Left unsupplied they return -1 for
   * every input, which would make those two arms indistinguishable from the
   * "no such subtype" default - a vector that cannot disagree. Distinct stubs
   * keep them measurable. */
  const inject = {
    summonNameToIdx: (type: string): number => 900 + type.length,
    shapeNameToIdx: (type: string): number => 800 + type.length,
  };

  const out: EffectInfoVector[] = [];
  for (let index = 1; index <= EFFECT_ENTRIES.length; index++) {
    const name = (EFFECT_ENTRIES[index - 1] as { name: string }).name;
    for (const type of NAMES) {
      out.push({
        kind: "subtype",
        effect: name,
        scenario: `type=${JSON.stringify(type)}`,
        out: String(effectSubtype(index, type, inject)),
      });
    }
  }
  return out;
}

/** Every family, in a stable order. */
export function computeEffectInfoVectors(
  fixtures: EffectInfoVectorFixtures,
): EffectInfoVector[] {
  return [
    ...computeMenuVectors(),
    ...computeDescVectors(),
    ...computeChainVectors(),
    ...computeSummaryVectors(fixtures),
    ...computeSubtypeVectors(),
  ];
}
