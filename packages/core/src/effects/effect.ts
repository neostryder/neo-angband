/**
 * Effect data model, ported from reference/src/effects.h struct effect and
 * the lookup/parsing utilities of effects.c and init.c grab_effect_data
 * (Angband 4.2.6).
 *
 * Divergences by design: effect indices are `number | string` so that mods
 * can register new effect codes at runtime (upstream is a compiled enum);
 * subtype categories whose registries are not yet ported (summons, player
 * shapes) resolve through an explicit injection point instead of global
 * lookups; the gamedata parser directives (effect / effect-yx / dice /
 * expr / effect-msg) are exposed as an EffectBuilder rather than being
 * scattered over per-file parsers.
 */

import { Dice } from "../dice";
import { Expression } from "../expression";
import {
  EF,
  EFFECT_ENTRIES,
  MON_TMD,
  MON_TIMED_ENTRIES,
  PLAYER_TIMED_ENTRIES,
  PROJ,
  STAT_ENTRIES,
} from "../generated";

/**
 * An effect code: an upstream EF_* numeric index, or a string code for a
 * runtime-registered mod effect.
 */
export type EffectCode = number | string;

/** Upstream EF_MAX (EF_NONE + every list-effects.h entry + 1). */
export const EF_MAX = EFFECT_ENTRIES.length + 1;

/**
 * Bit flags for the enchant() function (effect-handler.h).
 */
export const ENCH_TOHIT = 0x01;
export const ENCH_TODAM = 0x02;
export const ENCH_TOBOTH = 0x03;
export const ENCH_TOAC = 0x04;

/** Types of glyph (trap.h enum: GLYPH_NONE, GLYPH_WARDING, GLYPH_DECOY). */
export const GLYPH_WARDING = 1;
export const GLYPH_DECOY = 2;

/**
 * struct effect. `diceString` keeps the raw gamedata text alongside the
 * parsed Dice for serialization and parity checks (upstream discards it).
 */
export interface Effect {
  /** effect_index (or a mod string code). */
  index: EffectCode;
  /** Dice expression, or null. */
  dice: Dice | null;
  /** Raw gamedata dice text, or null. */
  diceString: string | null;
  /** Y coordinate or distance. */
  y: number;
  /** X coordinate or distance. */
  x: number;
  /** Projection type, timed effect type, etc. */
  subtype: number;
  /** Radius of the effect (if it has one). */
  radius: number;
  /** Extra parameter to be passed to the handler. */
  other: number;
  /** Message for deth or whatever (upstream comment, typo and all). */
  msg: string | null;
  /** Next effect in the chain. */
  next: Effect | null;
}

/** Create a zeroed effect (upstream mem_zalloc of struct effect). */
export function effectNew(index: EffectCode): Effect {
  return {
    index,
    dice: null,
    diceString: null,
    y: 0,
    x: 0,
    subtype: 0,
    radius: 0,
    other: 0,
    msg: null,
    next: null,
  };
}

/**
 * effect_valid for upstream numeric codes: EF_NONE < index < EF_MAX.
 * String (mod) codes are not covered here; registry-aware validity lives
 * on EffectRegistry.isValidEffect, which also accepts registered codes.
 */
export function effectValidUpstream(effect: Effect | null): boolean {
  if (!effect) return false;
  return (
    typeof effect.index === "number" &&
    effect.index > EF.NONE &&
    effect.index < EF_MAX
  );
}

/**
 * effect_lookup: name -> effect index. Case-sensitive (upstream streq).
 * Returns EF_MAX when the name is unknown, as upstream.
 */
export function effectLookup(name: string): number {
  for (let i = 0; i < EFFECT_ENTRIES.length; i++) {
    if ((EFFECT_ENTRIES[i] as { name: string }).name === name) return i + 1;
  }
  return EF_MAX;
}

/* ------------------------------------------------------------------ *
 * Subtype resolution (effect_subtype and the name_to_idx lookups it
 * dispatches to).
 * ------------------------------------------------------------------ */

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/** z-util.c contains_only_spaces: only ' ' and '\t' remain. */
function containsOnlySpaces(s: string): boolean {
  for (const ch of s) {
    if (ch !== " " && ch !== "\t") return false;
  }
  return true;
}

/**
 * C strtol(s, &pe, 10): skip isspace(), optional sign, base-10 digits.
 * `consumed` is 0 when no digits were found (endptr == nptr upstream).
 */
function strtolBase10(s: string): { value: number; consumed: number } {
  let i = 0;
  while (i < s.length && " \t\n\v\f\r".includes(s[i] as string)) i++;
  let sign = 1;
  if (s[i] === "+" || s[i] === "-") {
    if (s[i] === "-") sign = -1;
    i++;
  }
  let value = 0;
  let any = false;
  while (i < s.length) {
    const c = s[i] as string;
    if (c < "0" || c > "9") break;
    value = value * 10 + (c.charCodeAt(0) - 48);
    any = true;
    i++;
  }
  if (!any) return { value: 0, consumed: 0 };
  return { value: sign * value, consumed: i };
}

/** my_stricmp equality. */
function striEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * proj_name_to_idx (project.c): elements, then projections, then "MAX",
 * matched case-insensitively. "MAX" is reachable and yields PROJ_MAX.
 */
const PROJ_NAMES: readonly string[] = [...Object.keys(PROJ), "MAX"];

export function projNameToIdx(name: string): number {
  for (let i = 0; i < PROJ_NAMES.length; i++) {
    if (striEq(name, PROJ_NAMES[i] as string)) return i;
  }
  return -1;
}

/** timed_name_to_idx (player-timed.c): case-insensitive over TMD names. */
export function timedNameToIdx(name: string): number {
  for (let i = 0; i < PLAYER_TIMED_ENTRIES.length; i++) {
    if (striEq(name, (PLAYER_TIMED_ENTRIES[i] as { name: string }).name)) {
      return i;
    }
  }
  return -1;
}

/**
 * mon_timed_name_to_idx (mon-timed.c): case-SENSITIVE (streq), and only
 * indices below MON_TMD_MAX are reachable (the "MAX" row is excluded).
 */
export function monTimedNameToIdx(name: string): number {
  for (let i = 0; i < MON_TMD.MAX; i++) {
    if ((MON_TIMED_ENTRIES[i] as { name: string }).name === name) return i;
  }
  return -1;
}

/**
 * stat_name_to_idx (player.c): the stat list plus a trailing "MAX" entry,
 * matched case-insensitively; "MAX" is reachable and yields STAT_MAX.
 */
const STAT_NAMES: readonly string[] = [
  ...STAT_ENTRIES.map((e) => e.name),
  "MAX",
];

export function statNameToIdx(name: string): number {
  for (let i = 0; i < STAT_NAMES.length; i++) {
    if (striEq(name, STAT_NAMES[i] as string)) return i;
  }
  return -1;
}

/**
 * Injection points for subtype categories whose registries are not yet
 * ported, and for mod effect codes.
 *
 * - summonNameToIdx: upstream summon_name_to_idx (mon-summon.c) reads the
 *   summon table built from list-summon-types.h; supply it once the
 *   monster domain lands. Absent, EF_SUMMON subtypes resolve to -1
 *   (upstream behavior for an unknown summon name).
 * - shapeNameToIdx: upstream shape_name_to_idx (player-util.c) walks the
 *   parsed shapes list; supply it once player shapes land. Absent,
 *   EF_SHAPECHANGE subtypes resolve to -1.
 * - custom: consulted for string (mod) effect codes before the default
 *   branch, so mods can define their own subtype vocabularies.
 */
export interface SubtypeInjections {
  summonNameToIdx?: (name: string) => number;
  shapeNameToIdx?: (name: string) => number;
  custom?: (index: EffectCode, type: string) => number;
}

/** Effects whose subtype is a projection name. */
const PROJECTION_SUBTYPE_EFFECTS: ReadonlySet<number> = new Set([
  EF.PROJECT_LOS,
  EF.PROJECT_LOS_AWARE,
  EF.DESTRUCTION,
  EF.SPOT,
  EF.SPHERE,
  EF.BALL,
  EF.BREATH,
  EF.ARC,
  EF.SHORT_BEAM,
  EF.LASH,
  EF.SWARM,
  EF.STRIKE,
  EF.STAR,
  EF.STAR_BALL,
  EF.BOLT,
  EF.BEAM,
  EF.BOLT_OR_BEAM,
  EF.LINE,
  EF.ALTER,
  EF.BOLT_STATUS,
  EF.BOLT_STATUS_DAM,
  EF.BOLT_AWARE,
  EF.MELEE_BLOWS,
  EF.TOUCH,
  EF.TOUCH_AWARE,
]);

/** Effects whose subtype is a player timed effect name. */
const TIMED_SUBTYPE_EFFECTS: ReadonlySet<number> = new Set([
  EF.CURE,
  EF.TIMED_SET,
  EF.TIMED_INC,
  EF.TIMED_INC_NO_RES,
  EF.TIMED_DEC,
]);

/** Effects whose subtype is a stat name. */
const STAT_SUBTYPE_EFFECTS: ReadonlySet<number> = new Set([
  EF.RESTORE_STAT,
  EF.DRAIN_STAT,
  EF.LOSE_RANDOM_STAT,
  EF.GAIN_STAT,
]);

/**
 * effect_subtype: translate a string to an effect parameter subtype index.
 *
 * A plain numeric value (base-10, possibly followed by spaces/tabs) is
 * accepted for any effect; otherwise the string is resolved according to
 * the effect's subtype category. Returns -1 on failure, as upstream.
 */
export function effectSubtype(
  index: EffectCode,
  type: string,
  inject: SubtypeInjections = {},
): number {
  const { value: lv, consumed } = strtolBase10(type);
  if (consumed > 0) {
    /*
     * Got a plain numeric value. Verify that there isn't garbage after
     * it and that it doesn't overflow (INT_MIN/INT_MAX are rejected).
     */
    return containsOnlySpaces(type.slice(consumed)) &&
      lv < INT_MAX &&
      lv > INT_MIN
      ? lv
      : -1;
  }

  /* Mod codes: consult the injected resolver before the default branch. */
  if (typeof index === "string") {
    if (inject.custom) return inject.custom(index, type);
    return type === "NONE" ? 0 : -1;
  }

  /* If not a numerical value, assign according to effect index. */
  if (PROJECTION_SUBTYPE_EFFECTS.has(index)) return projNameToIdx(type);
  if (TIMED_SUBTYPE_EFFECTS.has(index)) return timedNameToIdx(type);
  if (STAT_SUBTYPE_EFFECTS.has(index)) return statNameToIdx(type);

  switch (index) {
    /* Nourishment types */
    case EF.NOURISH:
      if (type === "INC_BY") return 0;
      if (type === "DEC_BY") return 1;
      if (type === "SET_TO") return 2;
      if (type === "INC_TO") return 3;
      break;

    /* Monster timed effect name */
    case EF.MON_TIMED_INC:
      return monTimedNameToIdx(type);

    /* Summon name (registry not yet ported: injection point) */
    case EF.SUMMON:
      return inject.summonNameToIdx ? inject.summonNameToIdx(type) : -1;

    /* Enchant type name - not worth a separate function */
    case EF.ENCHANT:
      if (type === "TOBOTH") return ENCH_TOBOTH;
      if (type === "TOHIT") return ENCH_TOHIT;
      if (type === "TODAM") return ENCH_TODAM;
      if (type === "TOAC") return ENCH_TOAC;
      break;

    /* Player shape name (registry not yet ported: injection point) */
    case EF.SHAPECHANGE:
      return inject.shapeNameToIdx ? inject.shapeNameToIdx(type) : -1;

    /* Targeted earthquake */
    case EF.EARTHQUAKE:
      if (type === "TARGETED") return 1;
      if (type === "NONE") return 0;
      break;

    /* Inscribe a glyph */
    case EF.GLYPH:
      if (type === "WARDING") return GLYPH_WARDING;
      if (type === "DECOY") return GLYPH_DECOY;
      break;

    /* Allow teleport away */
    case EF.TELEPORT:
      if (type === "AWAY") return 1;
      break;

    /* Allow monster teleport toward */
    case EF.TELEPORT_TO:
      if (type === "SELF") return 1;
      break;

    /* Some effects only want a radius, so this is a dummy */
    default:
      if (type === "NONE") return 0;
      break;
  }

  return -1;
}

/* ------------------------------------------------------------------ *
 * Expression base values (effect_value_base_by_name).
 * ------------------------------------------------------------------ */

/**
 * The seven upstream base value names (effects.c value_bases table). The
 * upstream functions read globals (player, cave, z_info, ref_race, the
 * target); this port takes them as injected providers instead.
 */
export const EFFECT_VALUE_BASE_NAMES = [
  "SPELL_POWER",
  "PLAYER_LEVEL",
  "DUNGEON_LEVEL",
  "MAX_SIGHT",
  "WEAPON_DAMAGE",
  "PLAYER_HP",
  "MONSTER_PERCENT_HP_GONE",
] as const;

/** Injected providers for expression base values, keyed by upstream name. */
export type EffectValueBaseProviders = Readonly<
  Record<string, () => number>
>;

/**
 * effect_value_base_by_name: case-insensitive provider lookup. Returns
 * null when unknown or when no providers are supplied (upstream returns
 * NULL and the expression then evaluates its base as 0).
 */
export function effectValueBaseByName(
  name: string,
  providers?: EffectValueBaseProviders,
): (() => number) | null {
  if (!providers) return null;
  for (const key of Object.keys(providers)) {
    if (striEq(name, key)) return providers[key] as () => number;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Builder for the gamedata textual form.
 * ------------------------------------------------------------------ */

/** Configuration for EffectBuilder (all injection points optional). */
export interface EffectBuilderInjections extends SubtypeInjections {
  /**
   * Resolve effect names beyond the upstream EF set (mod codes). Called
   * only after effect_lookup fails; return null to reject the name.
   */
  lookupEffect?: (name: string) => EffectCode | null;
  /** Expression base value providers for expr() lines. */
  baseValues?: EffectValueBaseProviders;
}

function parseIntStrict(text: string, what: string): number {
  if (!/^[+-]?\d+$/.test(text.trim())) {
    throw new Error(`invalid ${what} "${text}" (PARSE_ERROR_NOT_NUMBER)`);
  }
  return parseInt(text, 10);
}

/**
 * Builds effect chains from gamedata-style directives, mirroring the
 * upstream parsers (grab_effect_data in init.c plus the effect / effect-yx
 * / dice / expr / effect-msg directives of obj-init.c and init.c):
 *
 *   new EffectBuilder()
 *     .effect("TIMED_INC:OPP_FIRE")   // effect:<name>[:<type>[:<radius>[:<other>]]]
 *     .dice("20+1d20")                // dice:<string>, applies to last effect
 *     .expr("D", "PLAYER_LEVEL", "/ 2")
 *     .build();
 *
 * Where upstream parsers return PARSE_ERROR_* codes this throws Errors
 * naming the upstream code; where upstream silently tolerates orphan
 * directives (dice/expr/effect-yx before any effect line), so does this.
 */
export class EffectBuilder {
  private head: Effect | null = null;

  constructor(private readonly inject: EffectBuilderInjections = {}) {}

  private last(): Effect | null {
    let e = this.head;
    while (e && e.next) e = e.next;
    return e;
  }

  /** effect:<name>[:<type>[:<radius>[:<other>]]] */
  effect(spec: string): this {
    const parts = spec.split(":");
    const name = parts[0] ?? "";

    let index: EffectCode = effectLookup(name);
    if (index === EF_MAX) {
      const mod = this.inject.lookupEffect
        ? this.inject.lookupEffect(name)
        : null;
      if (mod === null) {
        throw new Error(
          `invalid effect "${name}" (PARSE_ERROR_INVALID_EFFECT)`,
        );
      }
      index = mod;
    }

    const eff = effectNew(index);

    const type = parts[1];
    if (type !== undefined && type !== "") {
      const val = effectSubtype(index, type, this.inject);
      if (val < 0) {
        throw new Error(
          `invalid subtype "${type}" for effect "${name}" ` +
            `(PARSE_ERROR_INVALID_VALUE)`,
        );
      }
      eff.subtype = val;
    }
    const radius = parts[2];
    if (radius !== undefined && radius !== "") {
      eff.radius = parseIntStrict(radius, "radius");
    }
    const other = parts[3];
    if (other !== undefined && other !== "") {
      eff.other = parseIntStrict(other, "other");
    }

    const tail = this.last();
    if (tail) tail.next = eff;
    else this.head = eff;
    return this;
  }

  /** effect-yx:<y>:<x>, applied to the last effect (no-op when none). */
  effectYx(y: number, x: number): this {
    const eff = this.last();
    if (!eff) return this;
    eff.y = y;
    eff.x = x;
    return this;
  }

  /** dice:<string>, applied to the last effect (no-op when none). */
  dice(diceString: string): this {
    const eff = this.last();
    if (!eff) return this;
    const dice = new Dice();
    if (!dice.parseString(diceString)) {
      throw new Error(
        `invalid dice "${diceString}" (PARSE_ERROR_INVALID_DICE)`,
      );
    }
    eff.dice = dice;
    eff.diceString = diceString;
    return this;
  }

  /**
   * expr:<name>:<base>:<expr>, bound into the last effect's dice.
   * No-op when there is no effect or no dice (upstream tolerance).
   */
  expr(name: string, base: string, exprString: string): this {
    const eff = this.last();
    if (!eff || !eff.dice) return this;

    const expression = new Expression();
    const fn = effectValueBaseByName(base, this.inject.baseValues);
    if (fn) expression.setBaseValue(fn);
    if (expression.addOperationsString(exprString) < 0) {
      throw new Error(
        `bad expression "${exprString}" (PARSE_ERROR_BAD_EXPRESSION_STRING)`,
      );
    }
    if (eff.dice.bindExpression(name, expression) < 0) {
      throw new Error(
        `unbound expression variable "${name}" ` +
          `(PARSE_ERROR_UNBOUND_EXPRESSION)`,
      );
    }
    return this;
  }

  /**
   * effect-msg:<text>, appended (string_append) to the last effect's msg.
   * No-op when there is no effect.
   */
  effectMsg(text: string): this {
    const eff = this.last();
    if (!eff) return this;
    eff.msg = (eff.msg ?? "") + text;
    return this;
  }

  /** Return the chain head (null when no effect lines were given). */
  build(): Effect | null {
    return this.head;
  }
}
