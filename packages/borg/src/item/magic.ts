/**
 * Spellbook model, legality and fail rates - a faithful port of
 * reference/src/borg/borg-magic.c (and the learn logic in borg-magic-play.c).
 *
 * This is the surface the fight (P8.4) and think (P8.6) ladders call:
 * borgSpellLegal / borgSpellOkay / borgSpellOkayFail / borgSpellFailRate. The
 * fail-rate math is the borg's OWN idealised formula (borg_spell_fail_rate,
 * magic.c:498) driven by the derived traits (BI_CLEVEL, BI_FAIL1, BI_FAIL2,
 * status flags), NOT the engine's live spell_chance - preserving fidelity.
 *
 * SPELL IDENTITY. The C addresses spells by the borg_spells enum and maps it to
 * a class-wide spell index (sidx) via borg_get_spell_number, using the per-class
 * borg_spell_ratings[] arrays which are ordered by sidx (borg_init_spell asserts
 * ratings[sidx].name == spell_by_index(player,sidx).name, magic.c:747). We
 * reproduce that mapping exactly: ratings position == sidx, so a Spell enum maps
 * to the SpellView whose sidx equals its position in the class ratings array. No
 * name matching (avoids locale/diacritic issues in Priest spells).
 */

import type { BorgContext, SpellView } from "./types";
import type { AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import {
  classIndexFromName,
  CLASS_MAGE,
  CLASS_DRUID,
  CLASS_PRIEST,
  CLASS_NECROMANCER,
  CLASS_PALADIN,
  CLASS_ROGUE,
  CLASS_RANGER,
  CLASS_BLACKGUARD,
} from "../trait/trait-index";
import { trait } from "./deps";

/* Spell method values (borg-magic.h:30-35) - kept for effect classification. */
export const BORG_MAGIC_ICK = 0;
export const BORG_MAGIC_NOP = 1;
export const BORG_MAGIC_EXT = 2;
export const BORG_MAGIC_AIM = 3;
export const BORG_MAGIC_OBJ = 4;
export const BORG_MAGIC_WHO = 5;

/* Spell status values (borg-magic.h:41-46). */
export const BORG_MAGIC_ICKY = 0; /* illegible */
export const BORG_MAGIC_LOST = 1; /* forgotten */
export const BORG_MAGIC_HIGH = 2; /* too high level */
export const BORG_MAGIC_OKAY = 3; /* learnable */
export const BORG_MAGIC_TEST = 4; /* untried */
export const BORG_MAGIC_KNOW = 5; /* known */

/** enum borg_spells, transcribed 1:1 from borg-magic.h:48-182. Do not reorder. */
export enum Spell {
  MAGIC_MISSILE,
  LIGHT_ROOM,
  FIND_TRAPS_DOORS_STAIRS,
  PHASE_DOOR,
  ELECTRIC_ARC,
  DETECT_MONSTERS,
  FIRE_BALL,
  RECHARGING,
  IDENTIFY_RUNE,
  TREASURE_DETECTION,
  FROST_BOLT,
  REVEAL_MONSTERS,
  ACID_SPRAY,
  DISABLE_TRAPS_DESTROY_DOORS,
  TELEPORT_SELF,
  TELEPORT_OTHER,
  RESISTANCE,
  TAP_MAGICAL_ENERGY,
  MANA_CHANNEL,
  DOOR_CREATION,
  MANA_BOLT,
  TELEPORT_LEVEL,
  DETECTION,
  DIMENSION_DOOR,
  THRUST_AWAY,
  SHOCK_WAVE,
  EXPLOSION,
  BANISHMENT,
  MASS_BANISHMENT,
  MANA_STORM,
  DETECT_LIFE,
  FOX_FORM,
  REMOVE_HUNGER,
  STINKING_CLOUD,
  CONFUSE_MONSTER,
  SLOW_MONSTER,
  CURE_POISON,
  RESIST_POISON,
  TURN_STONE_TO_MUD,
  SENSE_SURROUNDINGS,
  LIGHTNING_STRIKE,
  EARTH_RISING,
  TRANCE,
  MASS_SLEEP,
  BECOME_PUKEL_MAN,
  EAGLES_FLIGHT,
  BEAR_FORM,
  TREMOR,
  HASTE_SELF,
  REVITALIZE,
  RAPID_REGENERATION,
  HERBAL_CURING,
  METEOR_SWARM,
  RIFT,
  ICE_STORM,
  VOLCANIC_ERUPTION,
  RIVER_OF_LIGHTNING,
  CALL_LIGHT,
  DETECT_EVIL,
  MINOR_HEALING,
  BLESS,
  SENSE_INVISIBLE,
  HEROISM,
  ORB_OF_DRAINING,
  SPEAR_OF_LIGHT,
  DISPEL_UNDEAD,
  DISPEL_EVIL,
  PROTECTION_FROM_EVIL,
  REMOVE_CURSE,
  PORTAL,
  REMEMBRANCE,
  WORD_OF_RECALL,
  HEALING,
  RESTORATION,
  CLAIRVOYANCE,
  ENCHANT_WEAPON,
  ENCHANT_ARMOUR,
  SMITE_EVIL,
  GLYPH_OF_WARDING,
  DEMON_BANE,
  BANISH_EVIL,
  WORD_OF_DESTRUCTION,
  HOLY_WORD,
  SPEAR_OF_OROME,
  LIGHT_OF_MANWE,
  NETHER_BOLT,
  CREATE_DARKNESS,
  BAT_FORM,
  READ_MINDS,
  TAP_UNLIFE,
  CRUSH,
  SLEEP_EVIL,
  SHADOW_SHIFT,
  DISENCHANT,
  FRIGHTEN,
  VAMPIRE_STRIKE,
  DISPEL_LIFE,
  DARK_SPEAR,
  WARG_FORM,
  BANISH_SPIRITS,
  ANNIHILATE,
  GRONDS_BLOW,
  UNLEASH_CHAOS,
  FUME_OF_MORDOR,
  STORM_OF_DARKNESS,
  POWER_SACRIFICE,
  ZONE_OF_UNMAGIC,
  VAMPIRE_FORM,
  CURSE,
  COMMAND,
  SINGLE_COMBAT,
  OBJECT_DETECTION,
  DETECT_STAIRS,
  HIT_AND_RUN,
  COVER_TRACKS,
  CREATE_ARROWS,
  DECOY,
  BRAND_AMMUNITION,
  SEEK_BATTLE,
  BERSERK_STRENGTH,
  WHIRLWIND_ATTACK,
  SHATTER_STONE,
  LEAP_INTO_BATTLE,
  GRIM_PURPOSE,
  MAIM_FOE,
  HOWL_OF_THE_DAMNED,
  RELENTLESS_TAUNTING,
  VENOM,
  WEREWOLF_FORM,
  BLOODLUST,
  UNHOLY_REPRIEVE,
  FORCEFUL_BLOW,
  QUAKE,
}

/** One entry in a class's borg_spell_ratings[] table (magic.c:44-231). */
interface Rating {
  rating: number;
  spell: Spell;
}
const R = (rating: number, spell: Spell): Rating => ({ rating, spell });

/* Per-class ratings, ordered by sidx (magic.c:44-231). Names in comments. */
const RATINGS_MAGE: Rating[] = [
  R(95, Spell.MAGIC_MISSILE),
  R(65, Spell.LIGHT_ROOM),
  R(85, Spell.FIND_TRAPS_DOORS_STAIRS),
  R(95, Spell.PHASE_DOOR),
  R(85, Spell.ELECTRIC_ARC),
  R(85, Spell.DETECT_MONSTERS),
  R(75, Spell.FIRE_BALL),
  R(65, Spell.RECHARGING),
  R(95, Spell.IDENTIFY_RUNE),
  R(5, Spell.TREASURE_DETECTION),
  R(75, Spell.FROST_BOLT),
  R(85, Spell.REVEAL_MONSTERS),
  R(75, Spell.ACID_SPRAY),
  R(95, Spell.DISABLE_TRAPS_DESTROY_DOORS),
  R(95, Spell.TELEPORT_SELF),
  R(75, Spell.TELEPORT_OTHER),
  R(90, Spell.RESISTANCE),
  R(5, Spell.TAP_MAGICAL_ENERGY),
  R(95, Spell.MANA_CHANNEL),
  R(65, Spell.DOOR_CREATION),
  R(95, Spell.MANA_BOLT),
  R(65, Spell.TELEPORT_LEVEL),
  R(95, Spell.DETECTION),
  R(95, Spell.DIMENSION_DOOR),
  R(55, Spell.THRUST_AWAY),
  R(85, Spell.SHOCK_WAVE),
  R(85, Spell.EXPLOSION),
  R(75, Spell.BANISHMENT),
  R(65, Spell.MASS_BANISHMENT),
  R(75, Spell.MANA_STORM),
];
const RATINGS_DRUID: Rating[] = [
  R(95, Spell.DETECT_LIFE),
  R(5, Spell.FOX_FORM),
  R(85, Spell.REMOVE_HUNGER),
  R(95, Spell.STINKING_CLOUD),
  R(55, Spell.CONFUSE_MONSTER),
  R(65, Spell.SLOW_MONSTER),
  R(55, Spell.CURE_POISON),
  R(60, Spell.RESIST_POISON),
  R(80, Spell.TURN_STONE_TO_MUD),
  R(80, Spell.SENSE_SURROUNDINGS),
  R(85, Spell.LIGHTNING_STRIKE),
  R(70, Spell.EARTH_RISING),
  R(55, Spell.TRANCE),
  R(80, Spell.MASS_SLEEP),
  R(5, Spell.BECOME_PUKEL_MAN),
  R(5, Spell.EAGLES_FLIGHT),
  R(5, Spell.BEAR_FORM),
  R(80, Spell.TREMOR),
  R(90, Spell.HASTE_SELF),
  R(95, Spell.REVITALIZE),
  R(55, Spell.RAPID_REGENERATION),
  R(90, Spell.HERBAL_CURING),
  R(90, Spell.METEOR_SWARM),
  R(90, Spell.RIFT),
  R(85, Spell.ICE_STORM),
  R(60, Spell.VOLCANIC_ERUPTION),
  R(90, Spell.RIVER_OF_LIGHTNING),
];
const RATINGS_PRIEST: Rating[] = [
  R(65, Spell.CALL_LIGHT),
  R(85, Spell.DETECT_EVIL),
  R(65, Spell.MINOR_HEALING),
  R(85, Spell.BLESS),
  R(75, Spell.SENSE_INVISIBLE),
  R(75, Spell.HEROISM),
  R(95, Spell.ORB_OF_DRAINING),
  R(75, Spell.SPEAR_OF_LIGHT),
  R(65, Spell.DISPEL_UNDEAD),
  R(65, Spell.DISPEL_EVIL),
  R(85, Spell.PROTECTION_FROM_EVIL),
  R(85, Spell.REMOVE_CURSE),
  R(85, Spell.PORTAL),
  R(75, Spell.REMEMBRANCE),
  R(95, Spell.WORD_OF_RECALL),
  R(95, Spell.HEALING),
  R(75, Spell.RESTORATION),
  R(85, Spell.CLAIRVOYANCE),
  R(75, Spell.ENCHANT_WEAPON),
  R(75, Spell.ENCHANT_ARMOUR),
  R(75, Spell.SMITE_EVIL),
  R(95, Spell.GLYPH_OF_WARDING),
  R(85, Spell.DEMON_BANE),
  R(85, Spell.BANISH_EVIL),
  R(75, Spell.WORD_OF_DESTRUCTION),
  R(85, Spell.HOLY_WORD),
  R(85, Spell.SPEAR_OF_OROME),
  R(85, Spell.LIGHT_OF_MANWE),
];
const RATINGS_NECROMANCER: Rating[] = [
  R(95, Spell.NETHER_BOLT),
  R(85, Spell.SENSE_INVISIBLE),
  R(5, Spell.CREATE_DARKNESS),
  R(5, Spell.BAT_FORM),
  R(85, Spell.READ_MINDS),
  R(85, Spell.TAP_UNLIFE),
  R(95, Spell.CRUSH),
  R(85, Spell.SLEEP_EVIL),
  R(95, Spell.SHADOW_SHIFT),
  R(25, Spell.DISENCHANT),
  R(85, Spell.FRIGHTEN),
  R(75, Spell.VAMPIRE_STRIKE),
  R(65, Spell.DISPEL_LIFE),
  R(65, Spell.DARK_SPEAR),
  R(5, Spell.WARG_FORM),
  R(65, Spell.BANISH_SPIRITS),
  R(95, Spell.ANNIHILATE),
  R(85, Spell.GRONDS_BLOW),
  R(85, Spell.UNLEASH_CHAOS),
  R(75, Spell.FUME_OF_MORDOR),
  R(65, Spell.STORM_OF_DARKNESS),
  R(5, Spell.POWER_SACRIFICE),
  R(5, Spell.ZONE_OF_UNMAGIC),
  R(5, Spell.VAMPIRE_FORM),
  R(65, Spell.CURSE),
  R(5, Spell.COMMAND),
];
const RATINGS_PALADIN: Rating[] = [
  R(95, Spell.BLESS),
  R(85, Spell.DETECT_EVIL),
  R(85, Spell.CALL_LIGHT),
  R(95, Spell.MINOR_HEALING),
  R(65, Spell.SENSE_INVISIBLE),
  R(85, Spell.HEROISM),
  R(85, Spell.PROTECTION_FROM_EVIL),
  R(65, Spell.REMOVE_CURSE),
  R(95, Spell.WORD_OF_RECALL),
  R(95, Spell.HEALING),
  R(85, Spell.CLAIRVOYANCE),
  R(55, Spell.SMITE_EVIL),
  R(55, Spell.DEMON_BANE),
  R(75, Spell.ENCHANT_WEAPON),
  R(85, Spell.ENCHANT_ARMOUR),
  R(95, Spell.SINGLE_COMBAT),
];
const RATINGS_ROGUE: Rating[] = [
  R(85, Spell.DETECT_MONSTERS),
  R(95, Spell.PHASE_DOOR),
  R(55, Spell.OBJECT_DETECTION),
  R(55, Spell.DETECT_STAIRS),
  R(85, Spell.RECHARGING),
  R(85, Spell.REVEAL_MONSTERS),
  R(95, Spell.TELEPORT_SELF),
  R(15, Spell.HIT_AND_RUN),
  R(85, Spell.TELEPORT_OTHER),
  R(75, Spell.TELEPORT_LEVEL),
];
const RATINGS_RANGER: Rating[] = [
  R(95, Spell.REMOVE_HUNGER),
  R(85, Spell.DETECT_LIFE),
  R(95, Spell.HERBAL_CURING),
  R(85, Spell.RESIST_POISON),
  R(85, Spell.TURN_STONE_TO_MUD),
  R(75, Spell.SENSE_SURROUNDINGS),
  R(25, Spell.COVER_TRACKS),
  R(85, Spell.CREATE_ARROWS),
  R(95, Spell.HASTE_SELF),
  R(5, Spell.DECOY),
  R(95, Spell.BRAND_AMMUNITION),
];
const RATINGS_BLACKGUARD: Rating[] = [
  R(55, Spell.SEEK_BATTLE),
  R(95, Spell.BERSERK_STRENGTH),
  R(85, Spell.WHIRLWIND_ATTACK),
  R(95, Spell.SHATTER_STONE),
  R(65, Spell.LEAP_INTO_BATTLE),
  R(65, Spell.GRIM_PURPOSE),
  R(75, Spell.MAIM_FOE),
  R(55, Spell.HOWL_OF_THE_DAMNED),
  R(5, Spell.RELENTLESS_TAUNTING),
  R(55, Spell.VENOM),
  R(5, Spell.WEREWOLF_FORM),
  R(5, Spell.BLOODLUST),
  R(95, Spell.UNHOLY_REPRIEVE),
  R(5, Spell.FORCEFUL_BLOW),
  R(95, Spell.QUAKE),
];

/** borg_prepare_book_info dispatch (magic.c:770). null for non-casters. */
export function ratingsForClass(cls: number): Rating[] | null {
  switch (cls) {
    case CLASS_MAGE: return RATINGS_MAGE;
    case CLASS_DRUID: return RATINGS_DRUID;
    case CLASS_PRIEST: return RATINGS_PRIEST;
    case CLASS_NECROMANCER: return RATINGS_NECROMANCER;
    case CLASS_PALADIN: return RATINGS_PALADIN;
    case CLASS_ROGUE: return RATINGS_ROGUE;
    case CLASS_RANGER: return RATINGS_RANGER;
    case CLASS_BLACKGUARD: return RATINGS_BLACKGUARD;
    default: return null;
  }
}

/** The borg class index this think (BI_CLASS, else derived from the view). */
function classOf(ctx: BorgContext): number {
  const t = ctx.world.self.trait[BI.CLASS];
  if (t !== undefined && t !== 0) return t;
  return classIndexFromName(ctx.view.player().cls);
}

/** borg_can_cast(): the class has any spells (magic.c:253). */
export function borgCanCast(ctx: BorgContext): boolean {
  return ratingsForClass(classOf(ctx)) !== null;
}

/**
 * borg_get_spell_number(spell): the sidx for a Spell enum, or -1 (magic.c:344).
 * ratings position == sidx, so this is the index of the enum in the ratings.
 */
export function borgGetSpellNumber(ctx: BorgContext, spell: Spell): number {
  const ratings = ratingsForClass(classOf(ctx));
  if (!ratings) return -1;
  return ratings.findIndex((r) => r.spell === spell);
}

/** Find the SpellView for a class-wide sidx (across all books), or null. */
function spellViewBySidx(ctx: BorgContext, sidx: number): SpellView | null {
  for (const book of ctx.view.spellbooks()) {
    for (const s of book.spells) if (s.sidx === sidx) return s;
  }
  return null;
}

/**
 * Compute the borg spell status (BORG_MAGIC_*) from the SpellView knowledge
 * flags and clevel, following borg_cheat_spell's priority chain (magic.c:634).
 */
export function borgSpellStatus(ctx: BorgContext, s: SpellView): number {
  const clevel = trait(ctx, BI.CLEVEL) || ctx.view.player().level;
  if (s.forgotten) return BORG_MAGIC_LOST;
  if (clevel < s.level) return BORG_MAGIC_HIGH;
  if (!s.learned) return BORG_MAGIC_OKAY;
  if (!s.worked) return BORG_MAGIC_TEST;
  return BORG_MAGIC_KNOW;
}

/**
 * borg.book_idx[bidx] >= 0: the borg carries the book that holds this spell.
 * The frozen ItemView carries the book's tval and (via file order) its sval; the
 * sval of the bidx-th book equals its 1-based position among same-tval books in
 * spellbooks() (matching object.txt / core sval assignment). Checks the pack.
 */
export function borgBookPossessed(ctx: BorgContext, bidx: number): boolean {
  const books = ctx.view.spellbooks();
  const book = books[bidx];
  if (!book) return false;
  let svalPos = 0;
  for (let i = 0; i <= bidx; i++) {
    if (books[i] && books[i]!.tval === book.tval) svalPos++;
  }
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (item.tval === book.tval && item.sval === svalPos) return true;
  }
  return false;
}

/** borg_get_spell_power(spell): sp cost, or -1 (magic.c:362). */
export function borgGetSpellPower(ctx: BorgContext, spell: Spell): number {
  const sidx = borgGetSpellNumber(ctx, spell);
  if (sidx < 0) return -1;
  const s = spellViewBySidx(ctx, sidx);
  return s ? s.mana : -1;
}

/** borg_heroism_level(): level Heroism grants the Heroism effect (magic.c:272). */
export function borgHeroismLevel(ctx: BorgContext): number {
  const cls = classOf(ctx);
  if (cls === CLASS_PRIEST) return 20;
  if (cls === CLASS_PALADIN) return 15;
  return 99;
}

/**
 * borg_spell_legal(spell): castable when fully rested (magic.c:376).
 * book possessed, status >= TEST, power <= MAXSP.
 */
export function borgSpellLegal(ctx: BorgContext, spell: Spell): boolean {
  const sidx = borgGetSpellNumber(ctx, spell);
  if (sidx < 0) return false;
  const s = spellViewBySidx(ctx, sidx);
  if (!s) return false;
  if (!borgBookPossessed(ctx, s.bidx)) return false;
  if (borgSpellStatus(ctx, s) < BORG_MAGIC_TEST) return false;
  if (s.mana > trait(ctx, BI.MAXSP)) return false;
  return true;
}

/** Effect classification used by borg_spell_okay's reserve-mana exceptions. */
function spellHasNourish(spell: Spell): boolean {
  return spell === Spell.REMOVE_HUNGER || spell === Spell.HERBAL_CURING;
}
function spellHasTeleport(spell: Spell): boolean {
  switch (spell) {
    case Spell.PHASE_DOOR:
    case Spell.TELEPORT_SELF:
    case Spell.PORTAL:
    case Spell.DIMENSION_DOOR:
    case Spell.SHADOW_SHIFT:
    case Spell.HIT_AND_RUN:
    case Spell.TELEPORT_LEVEL:
      return true;
    default:
      return false;
  }
}

/**
 * borg_spell_okay(spell): castable right now (magic.c:418). Not dark, not
 * blind/confused, affordable, and does not cut into class reserve mana (with the
 * nourish/teleport/low-depth-magic-missile exceptions).
 *
 * "dark" (no_light) is read from BI_LIGHT (light radius 0 => dark), the faithful
 * derived-trait reading.
 */
export function borgSpellOkay(ctx: BorgContext, spell: Spell): boolean {
  const sidx = borgGetSpellNumber(ctx, spell);
  if (sidx < 0) return false;
  const s = spellViewBySidx(ctx, sidx);
  if (!s) return false;

  /* Dark */
  if (trait(ctx, BI.LIGHT) <= 0) return false;

  /* Reserve mana per class (magic.c:433). */
  let reserveMana = 0;
  switch (classOf(ctx)) {
    case CLASS_MAGE: reserveMana = 6; break;
    case CLASS_RANGER: reserveMana = 22; break;
    case CLASS_ROGUE: reserveMana = 20; break;
    case CLASS_NECROMANCER: reserveMana = 10; break;
    case CLASS_PRIEST: reserveMana = 8; break;
    case CLASS_PALADIN: reserveMana = 20; break;
    case CLASS_BLACKGUARD: reserveMana = 0; break;
  }
  if (trait(ctx, BI.CLEVEL) < 35) reserveMana = 0;

  if (!borgSpellLegal(ctx, spell)) return false;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return false;
  if (s.mana > trait(ctx, BI.CURSP)) return false;

  if (trait(ctx, BI.CURSP) - s.mana < reserveMana) {
    if (spellHasNourish(spell)) return true;
    if (spellHasTeleport(spell)) return true;
    if (spell === Spell.MAGIC_MISSILE && trait(ctx, BI.CDEPTH) <= 35) return true;
    return false;
  }
  return true;
}

/**
 * borg_spell_fail_rate(spell): the borg's idealised fail% (magic.c:498). Uses
 * BI_CLEVEL/BI_FAIL1/BI_FAIL2, PF_ZERO_FAIL (min-fail floor), necromancer
 * lit-square penalty, fear/stun/amnesia adjustments. Returns 100 if unknown.
 */
export function borgSpellFailRate(
  ctx: BorgContext,
  spell: Spell,
  playerHas?: (flag: string) => boolean,
): number {
  const sidx = borgGetSpellNumber(ctx, spell);
  if (sidx < 0) return 100;
  const s = spellViewBySidx(ctx, sidx);
  if (!s) return 100;

  let chance = s.fail;
  chance -= 3 * (trait(ctx, BI.CLEVEL) - s.level);
  chance -= trait(ctx, BI.FAIL1);
  if (trait(ctx, BI.ISAFRAID)) chance += 20;

  let minfail = trait(ctx, BI.FAIL2);
  const zeroFail = playerHas
    ? playerHas("ZERO_FAIL")
    : classOf(ctx) === CLASS_MAGE; /* only mage has PF_ZERO_FAIL in 4.2.6 */
  if (!zeroFail) {
    if (minfail < 5) minfail = 5;
  }

  /* Necromancers punished on lit squares (magic.c:532). */
  if (classOf(ctx) === CLASS_NECROMANCER && borgOnLitGrid(ctx)) {
    chance += 25;
  }

  if (chance < minfail) chance = minfail;
  if (chance > 50) chance = 50;

  if (trait(ctx, BI.ISHEAVYSTUN)) chance += 25;
  if (trait(ctx, BI.ISSTUN)) chance += 15;
  if (trait(ctx, BI.ISFORGET)) chance *= 2;

  if (chance > 95) chance = 95;
  return chance;
}

/** borg_grids[y][x].info & BORG_LIGHT at the borg's grid (necro fail penalty). */
function borgOnLitGrid(ctx: BorgContext): boolean {
  const { x, y } = ctx.world.self.c;
  if (!ctx.world.map.inBounds(x, y)) return false;
  /* BORG_LIGHT (0x10) | BORG_GLOW (0x02): lit by torch or perma-lit. */
  return (ctx.world.map.at(x, y).info & 0x12) !== 0;
}

/** borg_spell_okay_fail(spell, allowFail) (magic.c:565). */
export function borgSpellOkayFail(
  ctx: BorgContext,
  spell: Spell,
  allowFail: number,
  playerHas?: (flag: string) => boolean,
): boolean {
  if (borgSpellFailRate(ctx, spell, playerHas) > allowFail) return false;
  return borgSpellOkay(ctx, spell);
}

/** borg_spell_legal_fail(spell, allowFail) (magic.c:585). */
export function borgSpellLegalFail(
  ctx: BorgContext,
  spell: Spell,
  allowFail: number,
  playerHas?: (flag: string) => boolean,
): boolean {
  if (borgSpellFailRate(ctx, spell, playerHas) > allowFail) return false;
  return borgSpellLegal(ctx, spell);
}

/**
 * borg_spell(spell): emit the cast command if castable now, else null
 * (magic.c:595). The engine addresses the spell by class-wide sidx (args.spell).
 */
export function borgSpell(ctx: BorgContext, spell: Spell): AgentCommand | null {
  if (!borgSpellOkay(ctx, spell)) return null;
  const sidx = borgGetSpellNumber(ctx, spell);
  if (sidx < 0) return null;
  return ctx.act.cast(sidx);
}

/** borg_spell_fail(spell, allowFail): cast if okay AND fail<=allow (magic.c:575). */
export function borgSpellFail(
  ctx: BorgContext,
  spell: Spell,
  allowFail: number,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (borgSpellFailRate(ctx, spell, playerHas) > allowFail) return null;
  return borgSpell(ctx, spell);
}
