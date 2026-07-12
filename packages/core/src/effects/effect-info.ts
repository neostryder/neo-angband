/**
 * Effect display/description helpers, ported from reference/src/effects-info.c
 * (Angband 4.2.6): effect_info (effects.c L103, re-exposed here as a pure
 * function over the generated EFFECT_ENTRIES table), effect_damages (L742),
 * effect_avg_damage (L773), effect_projection (L804), effect_next (L721),
 * effect_describe / create_nested_effect_description (L122-572), plus the
 * per-row spell comment builder of reference/src/player-spell.c
 * (append_random_value_string L570, spell_effect_append_value_info L593,
 * get_spell_info L708) and the "Inflicts an average of ... damage." summary
 * of reference/src/ui-spell.c spell_menu_browser (L147-208).
 *
 * PURE DISPLAY PATH, RNG-SAFE BY CONSTRUCTION: nothing in this module reads
 * or advances the game RNG. Upstream's effect_describe / get_spell_info call
 * dice_roll(effect->dice, &value) to populate the random_value it formats;
 * dice_roll itself calls damroll() and so draws real entropy (harmless for
 * the "roll" it discards but a determinism hazard if replicated here, since
 * rendering a menu row or a spell description must never perturb future RNG
 * draws - the project's #1 anxiety per its save-scum policy). This port
 * substitutes Dice.randomValue() (dice_random_value: base/dice/sides/mBonus
 * extraction with no rolling) at every such call site, and reimplements the
 * AVERAGE/MINIMISE/MAXIMISE aspect math locally (rvAverage/rvMin/rvMax) so
 * that not even an Rng instance needs to be threaded through this file.
 * effect_next's random/select "how many sub-effects" count and
 * effect_damages/effect_avg_damage/effect_projection's dice_evaluate(...,
 * AVERAGE, ...) calls are all replaced the same way.
 *
 * Divergences by design:
 * - No textblock/colour markup: describeEffect returns a plain string.
 *   Upstream's digit-highlighting (copy_to_textblock_with_coloring) is a
 *   rendering concern left to whatever UI layer consumes the string.
 * - Globals the upstream reads (timed_effects[], the object property
 *   registry, the summon table, player->lev, z_info->food_value,
 *   z_info->max_range) are passed in as dependency bags instead
 *   (EffectDescribeDeps, SpellInfoDeps) with sensible defaults so callers
 *   that don't need a given case can omit it.
 */

import type { Dice } from "../dice";
import { EF, EFFECT_ENTRIES } from "../generated";
import { MAX_RAND_DEPTH, type RandomValue } from "../rng";
import type { ProjectionInfo } from "../world/projection";
import type { Effect, EffectCode } from "./effect";
import { effectValidUpstream } from "./effect";

/* ------------------------------------------------------------------ *
 * Generated-table access (base_descs[] in effects-info.c).
 * ------------------------------------------------------------------ */

interface EffectEntryShape {
  name: string;
  aim: boolean;
  info: string | null;
  args: number;
  infoFlags: string;
  description: string;
  menuName: string;
}

function effectEntryFor(index: number): EffectEntryShape {
  return EFFECT_ENTRIES[index - 1] as EffectEntryShape;
}

/** effect_info (effects.c L103): the short info-type string ("dam", "heal", ...). */
export function effectInfo(effect: Effect | null): string | null {
  if (!effectValidUpstream(effect) || !effect) return null;
  return effectEntryFor(effect.index as number).info;
}

/** effect_desc (effects.c L111): the raw description format string. */
function effectDesc(effect: Effect | null): string | null {
  if (!effectValidUpstream(effect) || !effect) return null;
  return effectEntryFor(effect.index as number).description;
}

/** base_descs[e->index].efinfo_flag, defaulting to EFINFO_NONE when invalid. */
function infoFlagFor(index: EffectCode): string {
  if (typeof index !== "number" || index <= EF.NONE || index >= EFFECT_ENTRIES.length + 1) {
    return "EFINFO_NONE";
  }
  return effectEntryFor(index).infoFlags;
}

/* ------------------------------------------------------------------ *
 * Deterministic dice math (no RNG instance touched; see module doc).
 * ------------------------------------------------------------------ */

const ZERO_RV: Readonly<RandomValue> = { base: 0, dice: 0, sides: 0, mBonus: 0 };

/** randcalc(v, level, AVERAGE) without drawing from the RNG. */
function rvAverage(v: RandomValue, level = 0): number {
  const dam = Math.trunc((v.dice * (v.sides + 1)) / 2);
  const bonus = Math.trunc((v.mBonus * level) / MAX_RAND_DEPTH);
  return v.base + dam + bonus;
}

/** randcalc(v, 0, MINIMISE). */
function rvMin(v: RandomValue): number {
  return v.base + v.dice;
}

/** randcalc(v, 0, MAXIMISE). */
function rvMax(v: RandomValue): number {
  return v.base + v.dice * v.sides + v.mBonus;
}

/** randcalc_varies(v). */
function rvVaries(v: RandomValue): boolean {
  return rvMin(v) !== rvMax(v);
}

/** dice_evaluate(dice, level, AVERAGE, NULL): dice_random_value then rvAverage. */
function diceAverage(dice: Dice | null, level = 0): number {
  return dice ? rvAverage(dice.randomValue(), level) : 0;
}

/* ------------------------------------------------------------------ *
 * effect_next, effect_damages, effect_avg_damage, effect_projection.
 * ------------------------------------------------------------------ */

/**
 * effect_next (effects-info.c L721): the next effect in the chain, skipping
 * over all the sub-effects of a random/select effect.
 */
export function effectNext(effect: Effect): Effect | null {
  if (effect.index === EF.RANDOM || effect.index === EF.SELECT) {
    let e: Effect | null = effect;
    const numSubeffects = Math.max(0, diceAverage(effect.dice));
    for (let i = 0; e !== null && i < numSubeffects + 1; i++) {
      e = e.next;
    }
    return e;
  }
  return effect.next;
}

/**
 * effect_damages (effects-info.c L742): whether the effect (or, for a
 * random/select effect, any sub-effect) deals damage.
 */
export function effectDamages(effect: Effect): boolean {
  if (effect.index === EF.RANDOM || effect.index === EF.SELECT) {
    const numSubeffects = diceAverage(effect.dice);
    let e: Effect | null = effect.next;
    for (let i = 0; e !== null && i < numSubeffects; i++) {
      if (effectDamages(e)) return true;
      e = e.next;
    }
    return false;
  }
  const info = effectInfo(effect);
  return info !== null && info === "dam";
}

/**
 * effect_avg_damage (effects-info.c L773): the average damage dealt, using
 * `sharedDice` in place of the effect's own dice when a prior SET_VALUE
 * effect supplied one (pass null when there wasn't one).
 */
export function effectAvgDamage(effect: Effect, sharedDice: Dice | null): number {
  if (effect.index === EF.RANDOM || effect.index === EF.SELECT) {
    let total = 0;
    let nActual = 0;
    const nStated = diceAverage(sharedDice ?? effect.dice);
    let e: Effect | null = effect.next;
    for (let i = 0; e !== null && i < nStated; i++) {
      total += effectAvgDamage(e, sharedDice);
      nActual++;
      e = e.next;
    }
    return nActual > 0 ? Math.trunc(total / nActual) : 0;
  }
  if (effectDamages(effect)) {
    return diceAverage(sharedDice ?? effect.dice);
  }
  return 0;
}

/**
 * effect_projection (effects-info.c L804): the element/projection name for
 * the damage segment, or "" if the effect has none (or, for a random/select
 * effect, its sub-effects don't all share the same one).
 */
export function effectProjection(
  effect: Effect,
  projections: readonly Pick<ProjectionInfo, "playerDesc">[],
): string {
  if (effect.index === EF.RANDOM || effect.index === EF.SELECT) {
    const numSubeffects = diceAverage(effect.dice);
    if (numSubeffects <= 0 || !effect.next) return "";
    let e: Effect | null = effect.next;
    const subeffectProj = effectProjection(e, projections);
    for (let i = 0; e !== null && i < numSubeffects; i++) {
      if (subeffectProj !== effectProjection(e, projections)) return "";
      e = e.next;
    }
    return subeffectProj;
  }
  const proj = projections[effect.subtype];
  if (proj && proj.playerDesc !== null) {
    switch (infoFlagFor(effect.index)) {
      case "EFINFO_BALL":
      case "EFINFO_BOLTD":
      case "EFINFO_BREATH":
      case "EFINFO_SHORT":
      case "EFINFO_SPOT":
        return proj.playerDesc;
      default:
        break;
    }
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * effect_describe / create_nested_effect_description.
 * ------------------------------------------------------------------ */

/** A minimal sprintf: substitutes %s/%d left to right with String(arg). */
function sprintf(fmt: string, ...args: Array<string | number>): string {
  let i = 0;
  return fmt.replace(/%[sd]/g, () => {
    const a = args[i++];
    return a === undefined ? "" : String(a);
  });
}

/** format_dice_string (effects-info.c L51). multiplier is 1 except for EFINFO_FOOD's turn count. */
function formatDiceString(v: RandomValue, multiplier = 1): string {
  if (v.dice && v.base) {
    if (multiplier === 1) return `${v.base}+${v.dice}d${v.sides}`;
    return `${multiplier * v.base}+${multiplier}*(${v.dice}d${v.sides})`;
  }
  if (v.dice) {
    if (multiplier === 1) return `${v.dice}d${v.sides}`;
    return `${multiplier}*(${v.dice}d${v.sides})`;
  }
  return `${multiplier * v.base}`;
}

/** append_damage (effects-info.c L81). */
function appendDamage(value: RandomValue, devSkillBoost: number): string {
  let s = "";
  if (devSkillBoost !== 0) {
    s += `, which your device skill increases by ${devSkillBoost}%`;
  }
  if (rvVaries(value) || devSkillBoost > 0) {
    const dam = Math.trunc(((100 + devSkillBoost) * rvAverage(value)) / 10);
    s += ` for an average of ${Math.trunc(dam / 10)}.${Math.abs(dam % 10)} damage`;
  }
  return s;
}

/**
 * Dependencies effect_describe reads from globals upstream. All optional
 * except `projections`, defaulting to "" (no case in the EFINFO_* switch
 * treats an empty string specially, matching an absent lookup gracefully).
 */
export interface EffectDescribeDeps {
  /** projections[] indexed by PROJ value (or subtype for mod codes). */
  projections: readonly Pick<ProjectionInfo, "desc" | "playerDesc" | "lashDesc">[];
  /** timed_effects[idx].desc (player-timed.c), for EFINFO_CURE / EFINFO_TIMED. */
  timedDesc?: (tmdIndex: number) => string;
  /** lookup_obj_property(OBJ_PROPERTY_STAT, idx)->name, for EFINFO_STAT. */
  statName?: (statIndex: number) => string;
  /** summon_desc(idx) (mon-summon.c), for EFINFO_SUMM. */
  summonDesc?: (summonIndex: number) => string;
  /** player->lev; scales EFINFO_SHORT's displayed length. */
  playerLevel?: number;
  /** z_info->food_value; the EFINFO_FOOD turn-count multiplier (100 upstream). */
  foodValue?: number;
}

/** The big EFINFO_* description switch (effect_describe's inner body, L384-548). */
function formatEffectDesc(
  e: Effect,
  edesc: string,
  value: RandomValue,
  diceString: string,
  devSkillBoost: number,
  deps: EffectDescribeDeps,
): string {
  const proj = deps.projections[e.subtype];
  const rawDesc = proj?.desc ?? "";
  const playerDesc = proj?.playerDesc ?? "";
  const lashDesc = proj?.lashDesc ?? "";

  switch (infoFlagFor(e.index)) {
    case "EFINFO_DICE":
      return sprintf(edesc, diceString);

    case "EFINFO_HEAL": {
      const minString = value.mBonus
        ? ` (or ${value.mBonus}%, whichever is greater)`
        : "";
      return sprintf(edesc, diceString, minString);
    }

    case "EFINFO_CONST":
      return sprintf(edesc, Math.trunc(value.base / 2));

    case "EFINFO_FOOD": {
      const fed = e.subtype
        ? e.subtype === 1
          ? "uses enough food value"
          : "leaves you nourished"
        : "feeds you";
      const turnDiceString = formatDiceString(value, deps.foodValue ?? 100);
      return sprintf(edesc, fed, turnDiceString, diceString);
    }

    case "EFINFO_CURE":
      return sprintf(edesc, deps.timedDesc ? deps.timedDesc(e.subtype) : "");

    case "EFINFO_TIMED":
      return sprintf(edesc, deps.timedDesc ? deps.timedDesc(e.subtype) : "", diceString);

    case "EFINFO_STAT":
      return sprintf(edesc, deps.statName ? deps.statName(e.subtype) : "");

    case "EFINFO_SEEN":
      return sprintf(edesc, rawDesc);

    case "EFINFO_SUMM":
      return sprintf(edesc, deps.summonDesc ? deps.summonDesc(e.subtype) : "");

    case "EFINFO_TELE": {
      const dist = value.mBonus ? "a level-dependent distance" : `${value.base} grids`;
      return sprintf(edesc, e.subtype ? "a monster" : "you", dist);
    }

    case "EFINFO_QUAKE":
      return sprintf(edesc, e.radius);

    case "EFINFO_BALL":
      return sprintf(edesc, playerDesc, e.radius, diceString) + appendDamage(value, devSkillBoost);

    case "EFINFO_SPOT": {
      const iRadius = e.other ? e.other : e.radius;
      return (
        sprintf(edesc, playerDesc, e.radius, iRadius, diceString) +
        appendDamage(value, devSkillBoost)
      );
    }

    case "EFINFO_BREATH":
      return (
        sprintf(edesc, playerDesc, e.other, diceString) +
        appendDamage(value, e.index === EF.BREATH ? 0 : devSkillBoost)
      );

    case "EFINFO_SHORT": {
      const playerLevel = deps.playerLevel ?? 0;
      const radius = e.radius + (e.other ? Math.trunc(playerLevel / e.other) : 0);
      return sprintf(edesc, playerDesc, radius, diceString);
    }

    case "EFINFO_LASH":
      return sprintf(edesc, lashDesc, e.subtype);

    case "EFINFO_BOLT":
      return sprintf(edesc, rawDesc);

    case "EFINFO_BOLTD":
      return sprintf(edesc, rawDesc, diceString) + appendDamage(value, devSkillBoost);

    case "EFINFO_TOUCH":
      return sprintf(edesc, rawDesc);

    case "EFINFO_NONE":
      return edesc;

    default:
      /* Unreachable: infoFlags only ever holds one of the cases above
       * (upstream's fallback here reports a bug and returns ""). */
      return "";
  }
}

interface NestedResult {
  text: string | null;
  next: Effect | null;
}

/**
 * create_nested_effect_description (effects-info.c L122): describes the
 * random/select effect's next `count` sub-effects, either as a single
 * combined "breathes a cone of X, Y, or Z" sentence (when they're all
 * EFINFO_BREATH effects with matching dice/other) or as an "or"/","-joined
 * list of their individual descriptions.
 */
function createNestedEffectDescription(
  effectsIn: Effect | null,
  count: number,
  prefix: string | null,
  typePrefix: string | null,
  devSkillBoost: number,
  deps: EffectDescribeDeps,
): NestedResult {
  let e: Effect | null = effectsIn;
  let irand = 0;
  for (;;) {
    if (!e || irand >= count) {
      return { text: null, next: e };
    }
    if (effectDesc(e) !== null && e.index !== EF.RANDOM && e.index !== EF.SELECT) {
      break;
    }
    e = e.next;
    irand++;
  }

  const efirst = e;
  const firstInd = e.index;
  const firstOther = e.other;
  const firstDice = e.dice;
  const firstRv: RandomValue = e.dice ? e.dice.randomValue() : { ...ZERO_RV };

  let nvalid = 1;
  let sameInd = true;
  let sameOther = true;
  let sameDice = true;
  let jrand = irand + 1;
  let cursor: Effect | null = efirst.next;
  for (; cursor && jrand < count; cursor = cursor.next, jrand++) {
    if (effectDesc(cursor) === null || cursor.index === EF.RANDOM || cursor.index === EF.SELECT) {
      continue;
    }
    nvalid++;
    if (cursor.index !== firstInd) sameInd = false;
    if (cursor.other !== firstOther) sameOther = false;
    if (cursor.dice) {
      if (firstDice) {
        const thisRv = cursor.dice.randomValue();
        if (
          thisRv.base !== firstRv.base ||
          thisRv.dice !== firstRv.dice ||
          thisRv.sides !== firstRv.sides ||
          thisRv.mBonus !== firstRv.mBonus
        ) {
          sameDice = false;
        }
      } else {
        sameDice = false;
      }
    } else if (firstDice) {
      sameDice = false;
    }
  }
  const nexte = cursor;

  if (sameInd && infoFlagFor(firstInd) === "EFINFO_BREATH" && sameDice && sameOther) {
    let breaths = deps.projections[efirst.subtype]?.playerDesc ?? "";
    let ivalid = 1;
    let bc: Effect | null = efirst.next;
    let bj = irand + 1;
    for (; bc && bj < count; bc = bc.next, bj++) {
      if (effectDesc(bc) === null || bc.index === EF.RANDOM || bc.index === EF.SELECT) {
        continue;
      }
      breaths += ivalid === nvalid - 1 ? (nvalid > 2 ? ", or " : " or ") : ", ";
      breaths += deps.projections[bc.subtype]?.playerDesc ?? "";
      ivalid++;
    }

    const diceString = formatDiceString(firstRv);
    const desc =
      sprintf(effectDesc(efirst) ?? "", breaths, firstOther, diceString) +
      appendDamage(firstRv, firstInd === EF.BREATH ? 0 : devSkillBoost);

    return { text: (prefix ?? "") + (typePrefix ?? "") + desc, next: nexte };
  }

  /* Concatenate the individual effect descriptions. */
  let text: string | null = null;
  let ivalid = 0;
  const firstTb = describeEffect(efirst, typePrefix, devSkillBoost, true, deps);
  if (firstTb !== null) {
    ivalid = 1;
    text = prefix !== null ? prefix + firstTb : firstTb;
  } else {
    nvalid--;
  }

  let dc: Effect | null = efirst.next;
  let dj = irand + 1;
  for (; dc && dj < count; dc = dc.next, dj++) {
    if (effectDesc(dc) === null || dc.index === EF.RANDOM || dc.index === EF.SELECT) {
      continue;
    }
    const tbi = describeEffect(dc, ivalid === 0 ? typePrefix : null, devSkillBoost, true, deps);
    if (tbi === null) {
      nvalid--;
      continue;
    }
    if (prefix !== null && text === null) {
      text = prefix;
    }
    if (text !== null) {
      if (ivalid > 0) {
        text += ivalid === nvalid - 1 ? " or " : ", ";
      }
      text += tbi;
    } else {
      text = tbi;
    }
    ivalid++;
  }

  return { text, next: nexte };
}

/**
 * effect_describe (effects-info.c L319): a description of `effectHead` (and
 * any effects chained after it via EF_RANDOM/EF_SELECT) if `onlyFirst`, or of
 * the whole remaining chain otherwise. Returns null when nothing in range has
 * a description (mirrors upstream's NULL textblock). `prefix` is prepended
 * once, before the first description added.
 */
export function describeEffect(
  effectHead: Effect | null,
  prefix: string | null,
  devSkillBoost: number,
  onlyFirst: boolean,
  deps: EffectDescribeDeps,
): string | null {
  let tb: string | null = null;
  let nadded = 0;
  let value: RandomValue = { ...ZERO_RV };
  let valueSet = false;
  let e: Effect | null = effectHead;

  while (e) {
    if (e.index === EF.CLEAR_VALUE) {
      valueSet = false;
      e = e.next;
      continue;
    }
    if (e.index === EF.SET_VALUE) {
      value = e.dice ? e.dice.randomValue() : { ...ZERO_RV };
      valueSet = true;
      e = e.next;
      continue;
    }
    /*
     * roll mirrors upstream's per-iteration "int roll = 0;" then
     * "if (e->dice && !value_set) roll = dice_roll(e->dice, &value);":
     * it stays 0 (not the node's own dice average) whenever a still-active
     * SET_VALUE is shadowing it, exactly as upstream, since dice_roll is
     * only invoked under that same condition.
     */
    let roll = 0;
    if (e.dice !== null && !valueSet) {
      value = e.dice.randomValue();
      roll = diceAverage(e.dice);
    }

    if (e.index === EF.RANDOM || e.index === EF.SELECT) {
      const count = roll;
      const { text: tbe, next: nexte } = createNestedEffectDescription(
        e.next,
        count,
        nadded === 0 ? prefix : null,
        e.index === EF.RANDOM ? "randomly " : null,
        devSkillBoost,
        deps,
      );
      e = onlyFirst ? null : nexte;
      if (tbe !== null) {
        tb = tb === null ? tbe : tb + (e ? ", " : " and ") + tbe;
        nadded++;
      }
      continue;
    }

    const edesc = effectDesc(e);
    if (edesc === null) {
      e = onlyFirst ? null : e.next;
      continue;
    }

    const diceString = formatDiceString(value);
    const desc = formatEffectDesc(e, edesc, value, diceString, devSkillBoost, deps);

    e = onlyFirst ? null : e.next;

    if (desc !== "") {
      if (tb !== null) {
        tb += e ? ", " : " and ";
        tb += desc;
      } else {
        tb = (prefix ?? "") + desc;
      }
      nadded++;
    }
  }

  return tb;
}

/* ------------------------------------------------------------------ *
 * Per-row spell comment (player-spell.c) and browse summary (ui-spell.c).
 * ------------------------------------------------------------------ */

/** append_random_value_string (player-spell.c L570). */
export function appendRandomValueString(rv: RandomValue): string {
  let s = "";
  if (rv.base > 0) {
    s += String(rv.base);
    if (rv.dice > 0 && rv.sides > 0) s += "+";
  }
  if (rv.dice === 1 && rv.sides > 0) {
    s += `d${rv.sides}`;
  } else if (rv.dice > 1 && rv.sides > 0) {
    s += `${rv.dice}d${rv.sides}`;
  }
  return s;
}

/** struct spell_info_iteration_state (player-spell.c L38). */
interface SpellInfoIterationState {
  pre: Effect | null;
  preSpecial: string;
  preRv: RandomValue;
  sharedRv: RandomValue;
  haveShared: boolean;
}

/** Dependencies get_spell_info reads from the live player upstream. */
export interface SpellInfoDeps {
  /** player->lev; scales the displayed EF_BALL radius / EF_SHORT_BEAM length. */
  playerLevel?: number;
  /** z_info->max_range; caps the displayed EF_SHORT_BEAM length. */
  maxRange?: number;
}

/** spell_effect_append_value_info (player-spell.c L593): one effect's row segment, or "". */
function spellEffectAppendValueInfo(
  effect: Effect,
  ist: SpellInfoIterationState,
  deps: SpellInfoDeps,
): string {
  if (effect.index === EF.CLEAR_VALUE) {
    ist.haveShared = false;
    return "";
  }
  if (effect.index === EF.SET_VALUE) {
    if (effect.dice) {
      ist.haveShared = true;
      ist.sharedRv = effect.dice.randomValue();
    }
    return "";
  }

  const type = effectInfo(effect);
  if (type === null) return "";

  let rv: RandomValue = { ...ZERO_RV };
  if (effect.dice !== null) {
    rv = effect.dice.randomValue();
  } else if (ist.haveShared) {
    rv = ist.sharedRv;
  }

  const playerLevel = deps.playerLevel ?? 0;
  const maxRange = deps.maxRange ?? Number.POSITIVE_INFINITY;
  let special = "";

  switch (effect.index) {
    case EF.HEAL_HP:
      if (rv.mBonus) special = `/${rv.mBonus}%`;
      break;
    case EF.TELEPORT:
      if (rv.mBonus) special = "random";
      break;
    case EF.SPHERE:
      special = effect.radius ? `, rad ${effect.radius}` : ", rad 2";
      break;
    case EF.BALL: {
      if (effect.radius) {
        let rad = effect.radius;
        if (effect.other) rad += Math.trunc(playerLevel / effect.other);
        special = `, rad ${rad}`;
      } else {
        special = "rad 2";
      }
      break;
    }
    case EF.STRIKE:
      if (effect.radius) special = `, rad ${effect.radius}`;
      break;
    case EF.SHORT_BEAM: {
      let beamLen = effect.radius;
      if (effect.other) {
        beamLen += Math.trunc(playerLevel / effect.other);
        beamLen = Math.min(beamLen, maxRange);
      }
      special = `, len ${beamLen}`;
      break;
    }
    case EF.SWARM:
      special = `x${rv.mBonus}`;
      break;
    default:
      break;
  }

  const hasDice = rv.base > 0 || (rv.dice > 0 && rv.sides > 0);
  const redundant =
    ist.pre !== null &&
    ist.pre.index === effect.index &&
    special === ist.preSpecial &&
    ist.preRv.base === rv.base &&
    (!((ist.preRv.dice > 0 && ist.preRv.sides > 0) || (rv.dice > 0 && rv.sides > 0)) ||
      (ist.preRv.dice === rv.dice && ist.preRv.sides === rv.sides));

  if (!hasDice || redundant) return "";

  let out = ` ${type} ${appendRandomValueString(rv)}`;
  if (special.length > 1) out += special;

  ist.pre = effect;
  ist.preSpecial = special;
  ist.preRv = rv;
  return out;
}

/**
 * get_spell_info (player-spell.c L708): the per-spell comment shown after the
 * fail% column in the spell menu, e.g. " dam 3d4" or " dam 2d8; heal 15".
 */
export function getSpellInfo(effect: Effect | null, deps: SpellInfoDeps = {}): string {
  const ist: SpellInfoIterationState = {
    pre: null,
    preSpecial: "",
    preRv: { ...ZERO_RV },
    sharedRv: { ...ZERO_RV },
    haveShared: false,
  };
  let out = "";
  let e = effect;
  while (e) {
    const seg = spellEffectAppendValueInfo(e, ist, deps);
    if (seg) out += (out.length > 0 ? ";" : "") + seg;
    e = e.next;
  }
  return out;
}

/**
 * The damaging-effects half of spell_menu_browser (ui-spell.c L164-201): the
 * "Inflicts an average of N element[, M element and ...] damage." sentence,
 * or null when the spell has no damaging effects at all (upstream skips the
 * whole block in that case).
 */
export function spellDamageSummary(
  effect: Effect | null,
  projections: readonly Pick<ProjectionInfo, "playerDesc">[],
): string | null {
  const damaging: Effect[] = [];
  for (let e = effect; e; e = effectNext(e)) {
    if (effectDamages(e)) damaging.push(e);
  }
  if (damaging.length === 0) return null;

  let sharedDice: Dice | null = null;
  let i = 0;
  let out = "";
  for (let e = effect; e; e = effectNext(e)) {
    if (e.index === EF.SET_VALUE) sharedDice = e.dice;
    else if (e.index === EF.CLEAR_VALUE) sharedDice = null;
    if (effectDamages(e)) {
      if (damaging.length > 2 && i > 0) out += ",";
      if (damaging.length > 1 && i === damaging.length - 1) out += " and";
      out += ` ${effectAvgDamage(e, sharedDice)}`;
      const proj = effectProjection(e, projections);
      if (proj.length > 0) out += ` ${proj}`;
      i++;
    }
  }
  return `Inflicts an average of${out} damage.`;
}
