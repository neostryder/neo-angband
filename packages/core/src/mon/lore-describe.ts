/**
 * Monster recall text, ported from the recall half of
 * reference/src/mon-lore.c (Angband 4.2.6): the description helpers
 * (awareness / speed / sex / pronouns), the clause builders, and the
 * lore_append_* section functions, plus the top-level recall assembly that
 * upstream keeps in ui-mon-lore.c (lore_description). The two small spell
 * lore helpers from mon-spell.c (mon_spell_lore_description /
 * mon_spell_lore_damage) live here too, since lore_append_spells needs them.
 *
 * This engine is headless, so upstream's z-textblock output is modelled as a
 * flat list of colored runs (LoreText) instead of a wrapped terminal buffer.
 * Every textblock_append becomes LoreTextBuilder.append(text) (COLOUR_WHITE)
 * and every textblock_append_c(COLOUR_X, ...) becomes append(text, COLOUR_X).
 * Wording, punctuation, the two-space sentence separators, number words and
 * the pronoun / sex logic are kept verbatim.
 *
 * Player-derived state (level, depth, speed, and the combat hit chances /
 * spell&blow danger colors that upstream reads off the global player) is not
 * available in this module, so it is injected through the LoreDeps object.
 * Colors default to the datum's base lore color when no danger evaluator is
 * supplied; the two hit-chance callbacks and the spell damage callback are the
 * integration seams for the combat layer.
 */

import { FlagSet, FLAG_START, NO_FLAG } from "../bitflag";
import {
  COLOUR_BLUE,
  COLOUR_DARK,
  COLOUR_GREEN,
  COLOUR_L_BLUE,
  COLOUR_L_GREEN,
  COLOUR_L_RED,
  COLOUR_L_UMBER,
  COLOUR_ORANGE,
  COLOUR_RED,
  COLOUR_VIOLET,
  COLOUR_WHITE,
  colorTextToAttr,
} from "../color";
import { MON_RACE_FLAG_ENTRIES, RF } from "../generated";
import { createMonFlagMask, monsterFlagsKnown } from "./lore";
import type { MonsterLore } from "./lore";
import { EXTRACT_ENERGY } from "./monster";
import { createMonSpellMask, monSpellHasDamage, monSpellIsValid, RST } from "./spell";
import { RF_SIZE, RSF_SIZE } from "./types";
import type { BlowEffect, MonsterRace, MonsterSpell } from "./types";

const SHRT_MAX = 32767;
const UCHAR_MAX = 255;

/** m_bonus_calc uses MAX_RAND_DEPTH; unused here because lore rolls at level 0. */

/* ------------------------------------------------------------------ *
 * The headless textblock reduction.
 * ------------------------------------------------------------------ */

/** One colored run of recall text (color is a COLOUR_* from ../color). */
export interface LoreTextRun {
  text: string;
  color: number;
}

/** The finished recall: a flat, front-end-agnostic list of colored runs. */
export type LoreText = LoreTextRun[];

/**
 * A minimal stand-in for z-textblock: append() pushes one colored run in the
 * order it is written. There is no wrapping or indent - that is the front
 * end's job.
 */
export class LoreTextBuilder {
  runs: LoreTextRun[] = [];

  /** textblock_append / textblock_append_c: push a run of text. */
  append(text: string, color = COLOUR_WHITE): this {
    if (text.length > 0) this.runs.push({ text, color });
    return this;
  }

  build(): LoreText {
    return this.runs;
  }
}

/* ------------------------------------------------------------------ *
 * Dependencies injected from the player / world / combat layers.
 * ------------------------------------------------------------------ */

/**
 * The player-, world-, and combat-derived inputs the recall reads. Upstream
 * pulls these off the global `player`, the bound spell list, and the
 * player-attack combat math; here they are passed in so the module stays pure.
 */
export interface LoreDeps {
  /** player->lev (used for the experience calculation). */
  playerLevel: number;
  /** player->max_depth in levels (colors the "found at depths of" line). */
  playerMaxDepth: number;
  /** player->state.speed (used by the effective-speed multiplier form). */
  playerSpeed: number;
  /** OPT(player, effective_speed): multiplier form vs. adjective form. */
  effectiveSpeed: boolean;
  /** monster_spell_by_index: the bound spell list, keyed by RSF_ index. */
  spells: ReadonlyMap<number, MonsterSpell>;
  /**
   * spell_color(player, race, spellIndex): the danger color of a spell.
   * Defaults to the spell level's base lore color when omitted.
   */
  spellColor?: (race: MonsterRace, spellIndex: number) => number;
  /**
   * blow_color(player, blowEffect): the danger color of a melee blow effect.
   * Defaults to the effect's base lore color when omitted.
   */
  blowColor?: (effect: BlowEffect) => number;
  /**
   * The player's percent chance to hit this race in melee
   * (random_chance_scaled of hit_chance(chance_of_melee_hit_base, ac)).
   * DEFERRED: defaults to 0 when the combat layer does not supply it.
   */
  meleeHitPercent?: (race: MonsterRace) => number;
  /**
   * The monster's percent chance to land the given blow on the player
   * (random_chance_scaled of hit_chance(chance_of_monster_hit_base, ac+to_a)).
   * DEFERRED: defaults to 0 when the combat layer does not supply it.
   */
  monsterHitPercent?: (race: MonsterRace, effect: BlowEffect) => number;
  /**
   * mon_spell_lore_damage(index, race, know_hp): the max damage shown next to
   * a spell. DEFERRED: defaults to 0 (mon_spell_dam / nonhp_dam are not yet
   * ported - see mon/spell.ts, which defers them for the same reason).
   */
  spellLoreDamage?: (index: number, race: MonsterRace, knowHp: boolean) => number;
}

/* ------------------------------------------------------------------ *
 * Small string helpers mirroring the upstream macros.
 * ------------------------------------------------------------------ */

/** PLURAL(c): "" when c == 1, else "s". */
function plural(c: number): string {
  return c === 1 ? "" : "s";
}

/** VERB_AGREEMENT(c, singular, plural): singular when c == 1, else plural. */
function verbAgreement(c: number, singular: string, pluralForm: string): string {
  return c === 1 ? singular : pluralForm;
}

/** describe_race_flag (mon-util.c L69): the monster_flag_table desc string. */
function describeRaceFlag(flag: number): string {
  if (flag <= RF.NONE || flag >= MON_RACE_FLAG_ENTRIES.length) return "";
  return MON_RACE_FLAG_ENTRIES[flag]!.description;
}

/** The set flags of a FlagSet in ascending order. */
function flagList(f: FlagSet): number[] {
  return [...f];
}

/* ------------------------------------------------------------------ *
 * Monster sex and pronouns.
 * ------------------------------------------------------------------ */

/** enum monster_sex (mon-lore.c L43). */
export const MON_SEX = {
  NEUTER: 0,
  MALE: 1,
  FEMALE: 2,
} as const;
export type MonsterSex = (typeof MON_SEX)[keyof typeof MON_SEX];

/** lore_monster_sex (mon-lore.c L695). */
export function loreMonsterSex(race: MonsterRace): MonsterSex {
  if (race.flags.has(RF.FEMALE)) return MON_SEX.FEMALE;
  if (race.flags.has(RF.MALE)) return MON_SEX.MALE;
  return MON_SEX.NEUTER;
}

const LORE_PRONOUN_NOMINATIVE: readonly [string, string][] = [
  ["it", "It"],
  ["he", "He"],
  ["she", "She"],
];

const LORE_PRONOUN_POSSESSIVE: readonly [string, string][] = [
  ["its", "Its"],
  ["his", "His"],
  ["her", "Her"],
];

/** lore_pronoun_nominative (mon-lore.c L715). */
export function lorePronounNominative(sex: MonsterSex, titleCase: boolean): string {
  const row = LORE_PRONOUN_NOMINATIVE[sex] ?? LORE_PRONOUN_NOMINATIVE[MON_SEX.NEUTER]!;
  return row[titleCase ? 1 : 0];
}

/** lore_pronoun_possessive (mon-lore.c L744). */
export function lorePronounPossessive(sex: MonsterSex, titleCase: boolean): string {
  const row = LORE_PRONOUN_POSSESSIVE[sex] ?? LORE_PRONOUN_POSSESSIVE[MON_SEX.NEUTER]!;
  return row[titleCase ? 1 : 0];
}

/* ------------------------------------------------------------------ *
 * Awareness / speed description tables.
 * ------------------------------------------------------------------ */

/** lore_describe_awareness (mon-lore.c L558). */
export function loreDescribeAwareness(awareness: number): string {
  const table: readonly [number, string][] = [
    [200, "prefers to ignore"],
    [95, "pays very little attention to"],
    [75, "pays little attention to"],
    [45, "tends to overlook"],
    [25, "takes quite a while to see"],
    [10, "takes a while to see"],
    [5, "is fairly observant of"],
    [3, "is observant of"],
    [1, "is very observant of"],
    [0, "is vigilant for"],
  ];
  for (const [threshold, description] of table) {
    if (threshold === SHRT_MAX) break;
    if (awareness > threshold) return description;
  }
  return "is ever vigilant for";
}

/** lore_describe_speed (mon-lore.c L599). */
export function loreDescribeSpeed(speed: number): string {
  const table: readonly [number, string][] = [
    [130, "incredibly quickly"],
    [120, "very quickly"],
    [115, "quickly"],
    [110, "fairly quickly"],
    [109, "normal speed"] /* 110 is normal speed */,
    [99, "slowly"],
    [89, "very slowly"],
    [0, "incredibly slowly"],
  ];
  for (const [threshold, description] of table) {
    if (threshold === UCHAR_MAX) break;
    if (speed > threshold) return description;
  }
  return "erroneously";
}

/** lore_adjective_speed (mon-lore.c L636). */
export function loreAdjectiveSpeed(b: LoreTextBuilder, race: MonsterRace): void {
  /* "at" is separate so it uses the normal text colour. */
  if (race.speed === 110) b.append("at ");
  b.append(loreDescribeSpeed(race.speed), COLOUR_GREEN);
}

/** lore_multiplier_speed (mon-lore.c L652). */
export function loreMultiplierSpeed(
  b: LoreTextBuilder,
  race: MonsterRace,
  deps: LoreDeps,
): void {
  // moves at 2.3x normal speed (0.9x your current speed)
  b.append("at ");

  const energy = (speed: number): number => EXTRACT_ENERGY[speed] ?? 0;

  let multiplier = Math.trunc((10 * energy(race.speed)) / energy(110));
  let intMul = Math.trunc(multiplier / 10);
  let decMul = multiplier % 10;
  b.append(`${intMul}.${decMul}x`, COLOUR_L_BLUE);

  b.append(" normal speed, which is ");
  multiplier = Math.trunc((100 * energy(race.speed)) / energy(deps.playerSpeed));
  intMul = Math.trunc(multiplier / 100);
  decMul = multiplier % 100;
  let buf: string;
  if (!decMul) {
    buf = `${intMul}x`;
  } else if (!(decMul % 10)) {
    buf = `${intMul}.${Math.trunc(decMul / 10)}x`;
  } else {
    buf = `${intMul}.${String(decMul).padStart(2, "0")}x`;
  }

  let attr = COLOUR_ORANGE;
  if (deps.playerSpeed > race.speed) attr = COLOUR_L_GREEN;
  else if (deps.playerSpeed < race.speed) attr = COLOUR_RED;

  if (deps.playerSpeed === race.speed) {
    b.append("the same as you");
  } else {
    b.append(buf, attr);
    b.append(" your speed");
  }
}

/* ------------------------------------------------------------------ *
 * Clause builders.
 * ------------------------------------------------------------------ */

/** lore_append_clause (mon-lore.c L777): a serial-comma list of race flags. */
export function loreAppendClause(
  b: LoreTextBuilder,
  f: FlagSet,
  attr: number,
  start: string,
  conjunction: string,
  end: string,
): void {
  const flags = flagList(f);
  const count = flags.length;
  const comma = count > 2;

  if (count) {
    b.append(start);
    for (let i = 0; i < flags.length; i++) {
      if (i !== 0) {
        if (comma) b.append(",");
        /* Last entry */
        if (i === flags.length - 1) {
          b.append(" ");
          b.append(conjunction);
        }
        b.append(" ");
      }
      b.append(describeRaceFlag(flags[i]!), attr);
    }
    b.append(end);
  }
}

/** lore_append_spell_clause (mon-lore.c L819): the spell-formatted variant. */
export function loreAppendSpellClause(
  b: LoreTextBuilder,
  f: FlagSet,
  knowHp: boolean,
  race: MonsterRace,
  deps: LoreDeps,
  conjunction: string,
  end: string,
): void {
  const spells = flagList(f);
  const count = spells.length;
  const comma = count > 2;

  if (count) {
    for (let i = 0; i < spells.length; i++) {
      const spell = spells[i]!;
      const color = spellColor(deps, race, spell);
      const damage = monSpellLoreDamage(spell, race, knowHp, deps.spellLoreDamage);

      if (i !== 0) {
        if (comma) b.append(",");
        if (i === spells.length - 1) {
          b.append(" ");
          b.append(conjunction);
        }
        b.append(" ");
      }
      b.append(monSpellLoreDescription(spell, race, deps.spells), color);
      if (damage > 0) b.append(` (${damage})`, color);
    }
    b.append(end);
  }
}

/* ------------------------------------------------------------------ *
 * mon-spell.c lore helpers (local port; upstream mon-spell.c L681/L698).
 * ------------------------------------------------------------------ */

/**
 * Select the monster_spell_level for a race's spell power (the shared
 * "while (level->next && spell_power >= level->next->power)" walk).
 */
function spellLevelFor(spell: MonsterSpell, race: MonsterRace) {
  let level = spell.levels[0]!;
  for (let i = 1; i < spell.levels.length; i++) {
    const next = spell.levels[i]!;
    if (race.spellPower >= next.power) level = next;
    else break;
  }
  return level;
}

/** mon_spell_lore_description (mon-spell.c L681). */
export function monSpellLoreDescription(
  index: number,
  race: MonsterRace,
  spells: ReadonlyMap<number, MonsterSpell>,
): string {
  if (monSpellIsValid(index)) {
    const spell = spells.get(index);
    if (!spell) return "";
    return spellLevelFor(spell, race).loreDesc;
  }
  return "";
}

/**
 * mon_spell_lore_damage (mon-spell.c L698).
 *
 * DEFERRED: the actual damage number comes from mon_spell_dam / nonhp_dam
 * (mon-spell.c L637 / L571), which roll spell-effect dice whose expressions
 * reference the casting race (upstream ref_race) and, for breaths, read the
 * projections table. mon/spell.ts defers those for the same reason (the
 * spell-effect dice are parsed but their expressions are not yet bound to the
 * race). Until the combat layer supplies `spellLoreDamage`, this returns 0 and
 * the "(N)" is omitted, exactly as upstream does when damage is 0.
 */
export function monSpellLoreDamage(
  index: number,
  race: MonsterRace,
  knowHp: boolean,
  spellLoreDamage?: (index: number, race: MonsterRace, knowHp: boolean) => number,
): number {
  if (monSpellIsValid(index) && monSpellHasDamage(index)) {
    if (spellLoreDamage) return spellLoreDamage(index, race, knowHp);
    return 0;
  }
  return 0;
}

/** spell_color default (mon-lore.c L59): the spell level's base lore color. */
function spellColor(deps: LoreDeps, race: MonsterRace, spellIndex: number): number {
  if (deps.spellColor) return deps.spellColor(race, spellIndex);
  const spell = deps.spells.get(spellIndex);
  if (!spell) return COLOUR_DARK;
  const attr = colorTextToAttr(spellLevelFor(spell, race).loreColorBase);
  return attr < 0 ? COLOUR_WHITE : attr;
}

/** blow_color default (mon-lore.c L178): the blow effect's base lore color. */
function blowColor(deps: LoreDeps, effect: BlowEffect): number {
  if (deps.blowColor) return deps.blowColor(effect);
  const attr = colorTextToAttr(effect.loreColorBase);
  return attr < 0 ? COLOUR_WHITE : attr;
}

/* ------------------------------------------------------------------ *
 * lore_append_* section functions.
 * ------------------------------------------------------------------ */

/** lore_append_kills (mon-lore.c L867). */
export function loreAppendKills(
  b: LoreTextBuilder,
  race: MonsterRace,
  lore: MonsterLore,
  knownFlags: FlagSet,
): void {
  const msex = loreMonsterSex(race);
  let out = true;

  if (knownFlags.has(RF.UNIQUE)) {
    const dead = race.maxNum === 0;

    if (lore.deaths) {
      b.append(
        `${lorePronounNominative(msex, true)} has slain ${lore.deaths} of your ancestors`,
      );
      if (dead) {
        b.append(", but you have taken revenge!  ");
      } else {
        b.append(
          `, who ${verbAgreement(lore.deaths, "remains", "remain")} unavenged.  `,
        );
      }
    } else if (dead) {
      b.append("You have slain this foe.  ");
    } else {
      out = false;
    }
  } else if (lore.deaths) {
    b.append(
      `${lore.deaths} of your ancestors ${verbAgreement(lore.deaths, "has", "have")} been killed by this creature, `,
    );

    if (lore.pkills) {
      b.append(
        `and you have exterminated at least ${lore.pkills} of the creatures.  `,
      );
    } else if (lore.tkills) {
      b.append(
        `and your ancestors have exterminated at least ${lore.tkills} of the creatures.  `,
      );
    } else {
      b.append(
        `and ${lorePronounNominative(msex, false)} is not ever known to have been defeated.  `,
        COLOUR_RED,
      );
    }
  } else {
    if (lore.pkills) {
      b.append(`You have killed at least ${lore.pkills} of these creatures.  `);
    } else if (lore.tkills) {
      b.append(
        `Your ancestors have killed at least ${lore.tkills} of these creatures.  `,
      );
    } else {
      b.append("No battles to the death are recalled.  ");
    }
  }

  if (out) b.append("\n");
}

/** lore_append_flavor (mon-lore.c L943). */
export function loreAppendFlavor(b: LoreTextBuilder, race: MonsterRace): void {
  b.append(`${race.text}\n`);
}

/** lore_append_movement (mon-lore.c L961). */
export function loreAppendMovement(
  b: LoreTextBuilder,
  race: MonsterRace,
  _lore: MonsterLore,
  knownFlags: FlagSet,
  deps: LoreDeps,
): void {
  b.append("This");

  /* Adjectives (from race->flags directly, as upstream). */
  const adj = createMonFlagMask("RFT_RACE_A");
  adj.inter(race.flags);
  for (const f of adj) {
    b.append(` ${describeRaceFlag(f)}`, COLOUR_L_BLUE);
  }

  /* Noun (first race-noun flag, else "creature"). */
  const noun = createMonFlagMask("RFT_RACE_N");
  noun.inter(race.flags);
  const nounFlag = noun.next(FLAG_START);
  if (nounFlag !== NO_FLAG) {
    b.append(` ${describeRaceFlag(nounFlag)}`, COLOUR_L_BLUE);
  } else {
    b.append(" creature", COLOUR_L_BLUE);
  }

  /* Location. */
  if (race.level === 0) {
    b.append(" lives in the town");
  } else {
    const colour = race.level > deps.playerMaxDepth ? COLOUR_RED : COLOUR_L_BLUE;
    if (knownFlags.has(RF.FORCE_DEPTH)) b.append(" is found ");
    else b.append(" is normally found ");
    b.append("at depths of ");
    b.append(`${race.level * 50}`, colour);
    b.append(" feet (level ");
    b.append(`${race.level}`, colour);
    b.append(")");
  }

  b.append(", and moves");

  /* Random-ness. */
  if (knownFlags.test(RF.RAND_50, RF.RAND_25)) {
    const r50 = knownFlags.has(RF.RAND_50);
    const r25 = knownFlags.has(RF.RAND_25);
    if (r50 && r25) b.append(" extremely");
    else if (r50) b.append(" somewhat");
    else if (r25) b.append(" a bit");

    b.append(" erratically");

    if (race.speed !== 110) b.append(", and");
  }

  /* Speed. */
  b.append(" ");
  if (deps.effectiveSpeed) loreMultiplierSpeed(b, race, deps);
  else loreAdjectiveSpeed(b, race);

  /* Attack speed also. */
  if (knownFlags.has(RF.NEVER_MOVE)) {
    b.append(", but ");
    b.append("does not deign to chase intruders", COLOUR_L_GREEN);
  }

  b.append(".  ");
}

/** lore_append_toughness (mon-lore.c L1057). */
export function loreAppendToughness(
  b: LoreTextBuilder,
  race: MonsterRace,
  lore: MonsterLore,
  knownFlags: FlagSet,
  deps: LoreDeps,
): void {
  const msex = loreMonsterSex(race);

  if (lore.armourKnown) {
    b.append(`${lorePronounNominative(msex, true)} has a`);
    if (!knownFlags.has(RF.UNIQUE)) b.append("n average");
    b.append(" life rating of ");
    b.append(`${race.avgHp}`, COLOUR_L_BLUE);

    b.append(", and an armor rating of ");
    b.append(`${race.ac}`, COLOUR_L_BLUE);
    b.append(".  ");

    /* Player's base chance to hit.
     * DEFERRED: hit_chance(chance_of_melee_hit_base(player, weapon), ac)
     * needs the player-attack combat math and the equipped weapon, neither of
     * which is available here; defaults to 0 unless deps.meleeHitPercent is
     * supplied. Upstream mon-lore.c L1086-1094. */
    const percent = deps.meleeHitPercent ? deps.meleeHitPercent(race) : 0;
    b.append("You have a");
    if (percent === 8 || Math.trunc(percent / 10) === 8) b.append("n");
    b.append(` ${percent}`, COLOUR_L_BLUE);
    b.append("% chance to hit such a creature in melee (if you can see it).  ");
  }
}

/** lore_append_exp (mon-lore.c L1109). */
export function loreAppendExp(
  b: LoreTextBuilder,
  race: MonsterRace,
  _lore: MonsterLore,
  knownFlags: FlagSet,
  deps: LoreDeps,
): void {
  if (!race.rarity) return;

  if (knownFlags.has(RF.UNIQUE)) b.append("Killing");
  else b.append("A kill of");

  b.append(" this creature");

  const lev = deps.playerLevel;

  /* Integer and (x100) fractional experience, long arithmetic upstream. */
  const expInteger = Math.trunc((race.mexp * race.level) / lev);
  const expFraction = Math.trunc(
    (Math.trunc((((race.mexp * race.level) % lev) * 1000) / lev) + 5) / 10,
  );

  let buf = `${expInteger}`;
  if (expFraction) buf += `.${String(expFraction).padStart(2, "0")}`;

  b.append(" is worth ");
  b.append(
    `${buf} point${plural(expInteger === 1 && expFraction === 0 ? 1 : 2)}`,
    COLOUR_BLUE,
  );

  /* Annoying English ordinals. */
  let ordinal = "th";
  const level = lev % 10;
  if (Math.trunc(lev / 10) === 1) {
    /* nothing */
  } else if (level === 1) ordinal = "st";
  else if (level === 2) ordinal = "nd";
  else if (level === 3) ordinal = "rd";

  /* Leading vowels. */
  let article = "a";
  if (lev === 8 || lev === 11 || lev === 18) article = "an";

  b.append(` for ${article} ${lev}${ordinal} level character.  `);
}

/**
 * mon_create_drop_count (mon-make.c L699), maximize=true, specific=false path.
 * This path is deterministic (no RNG), so it is ported inline. The port's
 * MonsterRace carries the drop list, so the specific-drop maximum is summed.
 */
function monCreateDropCountMax(race: MonsterRace): { number: number; nspec: number } {
  const DROP_4_MAX = 6;
  const DROP_3_MAX = 4;
  const DROP_2_MAX = 3;
  let number = 0;
  let nspec = 0;

  if (race.flags.has(RF.DROP_20)) number++;
  if (race.flags.has(RF.DROP_40)) number++;
  if (race.flags.has(RF.DROP_60)) number++;
  if (race.flags.has(RF.DROP_4)) number += DROP_4_MAX;
  if (race.flags.has(RF.DROP_3)) number += DROP_3_MAX;
  if (race.flags.has(RF.DROP_2)) number += DROP_2_MAX;
  if (race.flags.has(RF.DROP_1)) number++;
  for (const drop of race.drops) nspec += drop.max;

  return { number, nspec };
}

/** lore_append_drop (mon-lore.c L1177). */
export function loreAppendDrop(
  b: LoreTextBuilder,
  race: MonsterRace,
  lore: MonsterLore,
  knownFlags: FlagSet,
): void {
  if (!lore.dropKnown) return;

  const msex = loreMonsterSex(race);
  const { number: n, nspec } = monCreateDropCountMax(race);

  if (n > 0 || nspec > 0) {
    b.append(`${lorePronounNominative(msex, true)} may carry`);

    if (n > 0) {
      const onlyItem = knownFlags.has(RF.ONLY_ITEM);
      const onlyGold = knownFlags.has(RF.ONLY_GOLD);

      if (n === 1) {
        b.append(" a single ", COLOUR_BLUE);
      } else if (n === 2) {
        b.append(" one or two ", COLOUR_BLUE);
      } else {
        b.append(" up to ");
        b.append(`${n} `, COLOUR_BLUE);
      }

      if (knownFlags.has(RF.DROP_GREAT)) {
        b.append("exceptional ", COLOUR_BLUE);
      } else if (knownFlags.has(RF.DROP_GOOD)) {
        b.append("good ", COLOUR_BLUE);
      }

      if (onlyItem && onlyGold) {
        b.append(`error${plural(n)}`, COLOUR_BLUE);
      } else if (onlyItem && !onlyGold) {
        b.append(`object${plural(n)}`, COLOUR_BLUE);
      } else if (!onlyItem && onlyGold) {
        b.append(`treasure${plural(n)}`, COLOUR_BLUE);
      } else {
        b.append(`object${plural(n)} or treasure${plural(n)}`, COLOUR_BLUE);
      }
    }

    if (nspec > 0) {
      if (n > 0) b.append(" and");
      if (nspec === 1) {
        b.append(" a single");
      } else if (nspec === 2) {
        b.append(" one or two");
      } else {
        b.append(" up to");
        b.append(` ${nspec}`, COLOUR_BLUE);
      }
      b.append(" specific items");
    }

    b.append(".  ");
  }
}

/** lore_append_abilities (mon-lore.c L1276). */
export function loreAppendAbilities(
  b: LoreTextBuilder,
  race: MonsterRace,
  lore: MonsterLore,
  knownFlags: FlagSet,
): void {
  const msex = loreMonsterSex(race);
  const pronoun = lorePronounNominative(msex, true);
  let prev = false;

  const known = (types: string[]): FlagSet => {
    const f = createMonFlagMask(...types);
    f.inter(knownFlags);
    return f;
  };

  /* Environment-shaping abilities. */
  loreAppendClause(b, known(["RFT_ALTER"]), COLOUR_WHITE, `${pronoun} can `, "and", ".  ");

  /* Detection traits. */
  loreAppendClause(b, known(["RFT_DET"]), COLOUR_WHITE, `${pronoun} is `, "and", ".  ");

  /* Special things. */
  if (knownFlags.has(RF.UNAWARE))
    b.append(`${pronoun} disguises itself as something else.  `);
  if (knownFlags.has(RF.MULTIPLY))
    b.append(`${pronoun} breeds explosively.  `, COLOUR_ORANGE);
  if (knownFlags.has(RF.REGENERATE)) b.append(`${pronoun} regenerates quickly.  `);

  /* Light. */
  if (race.light > 1) {
    b.append(
      `${pronoun} illuminates ${lorePronounPossessive(msex, false)} surroundings.  `,
    );
  } else if (race.light === 1) {
    b.append(`${pronoun} is illuminated.  `);
  } else if (race.light === -1) {
    b.append(`${pronoun} is darkened.  `);
  } else if (race.light < -1) {
    b.append(
      `${pronoun} shrouds ${lorePronounPossessive(msex, false)} surroundings in darkness.  `,
    );
  }

  /* Susceptibilities. */
  let current = known(["RFT_VULN", "RFT_VULN_I"]);
  loreAppendClause(b, current, COLOUR_VIOLET, `${pronoun} is hurt by `, "and", "");
  if (!current.isEmpty()) prev = true;

  /* Immunities and resistances (plus lack of a vulnerability). */
  current = known(["RFT_RES"]);
  {
    const testFlags = createMonFlagMask("RFT_VULN");
    for (const flag of testFlags) {
      if (lore.flags.has(flag) && !knownFlags.has(flag)) current.on(flag);
    }
  }
  loreAppendClause(
    b,
    current,
    COLOUR_L_UMBER,
    prev ? ", but resists " : `${pronoun} resists `,
    "and",
    "",
  );
  if (!current.isEmpty()) prev = true;

  /* Known-but-average susceptibilities (resistances known to be absent). */
  current = new FlagSet(RF_SIZE);
  {
    const testFlags = createMonFlagMask("RFT_RES");
    for (const flag of testFlags) {
      if (lore.flags.has(flag) && !knownFlags.has(flag)) current.on(flag);
    }
  }
  /* Vulnerabilities need to be specifically removed (by description match). */
  {
    const testFlags = createMonFlagMask("RFT_VULN_I");
    testFlags.inter(knownFlags);
    const susc = flagList(current);
    for (const flag of testFlags) {
      for (const suscFlag of susc) {
        if (describeRaceFlag(flag) === describeRaceFlag(suscFlag)) current.off(suscFlag);
      }
    }
  }
  /* Special case for undead. */
  if (knownFlags.has(RF.UNDEAD)) current.off(RF.IM_NETHER);

  loreAppendClause(
    b,
    current,
    COLOUR_L_UMBER,
    prev ? ", and does not resist " : `${pronoun} does not resist `,
    "or",
    "",
  );
  if (!current.isEmpty()) prev = true;

  /* Non-effects (cannot be X'd). */
  current = known(["RFT_PROT"]);
  loreAppendClause(
    b,
    current,
    COLOUR_L_UMBER,
    prev ? ", and cannot be " : `${pronoun} cannot be `,
    "or",
    "",
  );
  if (!current.isEmpty()) prev = true;

  if (prev) b.append(".  ");
}

/** lore_append_awareness (mon-lore.c L1425). */
export function loreAppendAwareness(
  b: LoreTextBuilder,
  race: MonsterRace,
  lore: MonsterLore,
  _knownFlags: FlagSet,
): void {
  const msex = loreMonsterSex(race);

  if (lore.sleepKnown) {
    const aware = loreDescribeAwareness(race.sleep);
    b.append(
      `${lorePronounNominative(msex, true)} ${aware} intruders, which ${lorePronounNominative(msex, false)} may notice from `,
    );
    b.append(`${10 * race.hearing}`, COLOUR_L_BLUE);
    b.append(" feet.  ");
  }
}

/** lore_append_friends (mon-lore.c L1458). */
export function loreAppendFriends(
  b: LoreTextBuilder,
  race: MonsterRace,
  _lore: MonsterLore,
  knownFlags: FlagSet,
): void {
  const msex = loreMonsterSex(race);

  if (race.friends.length > 0 || race.friendsBase.length > 0) {
    b.append(`${lorePronounNominative(msex, true)} may appear with other monsters`);
    if (knownFlags.has(RF.GROUP_AI)) b.append(" and hunts in packs");
    b.append(".  ");
  }
}

/** lore_append_spells (mon-lore.c L1491). */
export function loreAppendSpells(
  b: LoreTextBuilder,
  race: MonsterRace,
  lore: MonsterLore,
  knownFlags: FlagSet,
  deps: LoreDeps,
): void {
  let innate = false;
  let breath = false;

  const knowHp = lore.armourKnown;
  const msex = loreMonsterSex(race);
  const pronoun = lorePronounNominative(msex, true);

  /* Innate (non-breath) attacks. */
  let current = createMonSpellMask(RST.INNATE);
  current.inter(lore.spellFlags);
  current.diff(createMonSpellMask(RST.BREATH));
  if (!current.isEmpty()) {
    b.append(`${pronoun} may `);
    loreAppendSpellClause(b, current, knowHp, race, deps, "or", "");
    innate = true;
  }

  /* Breaths. */
  current = createMonSpellMask(RST.BREATH);
  current.inter(lore.spellFlags);
  if (!current.isEmpty()) {
    if (innate) b.append(", and may ");
    else b.append(`${pronoun} may `);
    b.append("breathe ", COLOUR_L_RED);
    loreAppendSpellClause(b, current, knowHp, race, deps, "or", "");
    breath = true;
  }

  /* Frequency of innate spells / breaths. */
  if ((innate || breath) && race.freqInnate) {
    if (lore.innateFreqKnown) {
      b.append("; ");
      b.append("1", COLOUR_L_GREEN);
      b.append(" time in ");
      b.append(`${Math.trunc(100 / race.freqInnate)}`, COLOUR_L_GREEN);
    } else if (lore.castInnate) {
      const approx = Math.max(Math.trunc((race.freqInnate + 9) / 10) * 10, 1);
      b.append("; about ");
      b.append("1", COLOUR_L_GREEN);
      b.append(" time in ");
      b.append(`${Math.trunc(100 / approx)}`, COLOUR_L_GREEN);
    }
    b.append(".  ");
  }

  /* Other (non-innate, non-breath) spells. */
  current = lore.spellFlags.clone();
  current.diff(createMonSpellMask(RST.BREATH, RST.INNATE));
  if (!current.isEmpty()) {
    b.append(`${pronoun} may `);
    b.append("cast spells", COLOUR_L_RED);
    if (knownFlags.has(RF.SMART)) b.append(" intelligently");
    b.append(" which ");
    loreAppendSpellClause(b, current, knowHp, race, deps, "or", "");

    if (race.freqSpell) {
      if (lore.spellFreqKnown) {
        b.append("; ");
        b.append("1", COLOUR_L_GREEN);
        b.append(" time in ");
        b.append(`${Math.trunc(100 / race.freqSpell)}`, COLOUR_L_GREEN);
      } else if (lore.castSpell) {
        const approx = Math.max(Math.trunc((race.freqSpell + 9) / 10) * 10, 1);
        b.append("; about ");
        b.append("1", COLOUR_L_GREEN);
        b.append(" time in ");
        b.append(`${Math.trunc(100 / approx)}`, COLOUR_L_GREEN);
      }
    }

    b.append(".  ");
  }
}

/** randcalc(dice, 0, AVERAGE): deterministic average (m_bonus term is 0 at level 0). */
function randcalcAverage(base: number, dice: number, sides: number): number {
  return base + Math.trunc((dice * (sides + 1)) / 2);
}

/** lore_append_attack (mon-lore.c L1621). */
export function loreAppendAttack(
  b: LoreTextBuilder,
  race: MonsterRace,
  lore: MonsterLore,
  knownFlags: FlagSet,
  deps: LoreDeps,
): void {
  const msex = loreMonsterSex(race);

  /* Notice lack of attacks. */
  if (knownFlags.has(RF.NEVER_BLOW)) {
    b.append(`${lorePronounNominative(msex, true)} has no physical attacks.  `);
    return;
  }

  let totalAttacks = 0;
  let knownAttacks = 0;

  for (let i = 0; i < race.blows.length; i++) {
    totalAttacks++;
    if (lore.blowKnown[i]) knownAttacks++;
  }

  if (knownAttacks === 0) {
    b.append(
      `Nothing is known about ${lorePronounPossessive(msex, false)} attack.  `,
      COLOUR_ORANGE,
    );
    return;
  }

  let describedCount = 0;
  let totalCentidamage = 99; // round the final result up to the next point

  for (let i = 0; i < race.blows.length; i++) {
    if (!lore.blowKnown[i]) continue;

    const blow = race.blows[i]!;
    const rv = blow.dice
      ? blow.dice.randomValue()
      : { base: 0, dice: 0, sides: 0, mBonus: 0 };
    const effectStr = blow.effect.desc;

    if (describedCount === 0) {
      b.append(`${lorePronounNominative(msex, true)} can `);
    } else if (describedCount < knownAttacks - 1) {
      b.append(", ");
    } else {
      b.append(", and ");
    }

    /* Method. */
    b.append(blow.method.desc);

    /* Effect (if any). */
    if (effectStr && effectStr.length > 0) {
      b.append(" to ");
      b.append(effectStr, blowColor(deps, blow.effect));

      b.append(" (");
      /* Damage (if known). */
      if (rv.base || (rv.dice && rv.sides) || rv.mBonus) {
        if (rv.base) b.append(`${rv.base}`, COLOUR_L_GREEN);
        if (rv.dice && rv.sides) b.append(`${rv.dice}d${rv.sides}`, COLOUR_L_GREEN);
        if (rv.mBonus) b.append(`M${rv.mBonus}`, COLOUR_L_GREEN);
        b.append(", ");
      }

      /* Hit chance.
       * DEFERRED: hit_chance(chance_of_monster_hit_base(race, effect),
       * player ac+to_a) needs the player's defensive combat state; defaults to
       * 0 unless deps.monsterHitPercent is supplied. mon-lore.c L1710-1715. */
      const percent = deps.monsterHitPercent ? deps.monsterHitPercent(race, blow.effect) : 0;
      b.append(`${percent}`, COLOUR_L_BLUE);
      b.append("%)");

      totalCentidamage += percent * randcalcAverage(rv.base, rv.dice, rv.sides);
    }

    describedCount++;
  }

  b.append(", averaging");
  if (knownAttacks < totalAttacks) b.append(" at least", COLOUR_ORANGE);
  b.append(` ${Math.trunc(totalCentidamage / 100)}`, COLOUR_L_GREEN);
  b.append(` damage on each of ${lorePronounPossessive(msex, false)} turns.  `);
}

/* ------------------------------------------------------------------ *
 * Top-level assembly (ui-mon-lore.c lore_description, non-spoiler path).
 * ------------------------------------------------------------------ */

/**
 * lore_is_fully_known body (mon-lore.c L441), read against the supplied lore
 * without the store lookup or the mutating side effects.
 */
function isFullyKnown(race: MonsterRace, lore: MonsterLore): boolean {
  if (lore.allKnown) return true;
  if (!lore.armourKnown) return false;
  if (!lore.spellFreqKnown && race.freqInnate + race.freqSpell) return false;
  if (!lore.dropKnown) return false;
  if (!lore.sleepKnown) return false;
  for (let i = 0; i < race.blows.length; i++) {
    if (!lore.blowKnown[i]) return false;
  }
  for (let i = 0; i < RF_SIZE; i++) {
    if (!lore.flags.bits[i]) return false;
  }
  for (let i = 0; i < RSF_SIZE; i++) {
    if (lore.spellFlags.bits[i] !== race.spellFlags.bits[i]) return false;
  }
  return true;
}

/**
 * lore_title (ui-mon-lore.c L38), reduced to what the headless model can
 * express: "The " for non-uniques, the name, and the primary glyph.
 *
 * DEFERRED: the optional secondary glyph (monster_x_char / monster_x_attr,
 * ui-mon-lore.c L47/L51), OPT(purple_uniques) recoloring (L56), and tile
 * width/height gating (L69) are all presentation state not modelled here.
 */
function loreTitle(b: LoreTextBuilder, race: MonsterRace): void {
  if (!race.flags.has(RF.UNIQUE)) b.append("The ");
  b.append(race.name);
  b.append(" ('");
  b.append(race.dChar, race.dAttr);
  b.append("')");
}

/**
 * lore_description (ui-mon-lore.c L89), non-spoiler path: assemble the full
 * recall for what the player knows. Returns the finished flat run list.
 *
 * The order of sections is transcribed from ui-mon-lore.c L110-150:
 *   title, kills, flavor, movement, toughness, exp, drop, abilities,
 *   awareness, friends, spells, attack, fully-known note, questor note.
 */
export function loreDescription(
  race: MonsterRace,
  lore: MonsterLore,
  deps: LoreDeps,
): LoreText {
  const b = new LoreTextBuilder();
  const knownFlags = monsterFlagsKnown(race, lore);

  /* Title (only in the non-spoiler player view). */
  loreTitle(b, race);
  b.append("\n");

  /* Kills of monster vs. player(s). */
  loreAppendKills(b, race, lore, knownFlags);

  loreAppendFlavor(b, race);

  /* Type, location, speed. */
  loreAppendMovement(b, race, lore, knownFlags, deps);

  /* Life and armor, and player's hit chance. */
  loreAppendToughness(b, race, lore, knownFlags, deps);

  /* Experience reward. */
  loreAppendExp(b, race, lore, knownFlags, deps);

  loreAppendDrop(b, race, lore, knownFlags);

  /* Special properties. */
  loreAppendAbilities(b, race, lore, knownFlags);
  loreAppendAwareness(b, race, lore, knownFlags);
  loreAppendFriends(b, race, lore, knownFlags);

  /* Spells, spell-like abilities and melee attacks. */
  loreAppendSpells(b, race, lore, knownFlags, deps);
  loreAppendAttack(b, race, lore, knownFlags, deps);

  if (isFullyKnown(race, lore))
    b.append("You know everything about this monster.");

  if (race.flags.has(RF.QUESTOR))
    b.append("You feel an intense desire to kill this monster...  ");

  b.append("\n");

  return b.build();
}
