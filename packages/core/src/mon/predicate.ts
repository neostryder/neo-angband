/**
 * Monster predicates, ported from reference/src/mon-predicate.c (Angband
 * 4.2.6): the permanent (race-flag / spell-flag derived) properties and the
 * temporary (mflag derived) properties of a live monster.
 *
 * These are pure queries over a Monster and its race, used throughout the AI,
 * combat, effects, and spell systems. create_mon_spell_mask is expressed via
 * monSpellsOfTypes (mon/types.ts); mflag / race-flag reads use the generated
 * MFLAG / RF enums.
 *
 * One divergence, one deferral (both faithful in reachable states):
 * - monster_can_be_scared's group-size branch takes primaryGroupSize as an
 *   argument (default 1 = "no group"), because monster groups are not tracked
 *   in the cave yet; primaryGroupSize=1 gives count=0, so the group fear-save
 *   loop never runs, matching a lone monster exactly.
 * - monster_is_decoyed is DEFERRED: it needs cave_find_decoy + los + a live
 *   cave, and a decoy only exists once the create-decoy effect is ported.
 */

import { FlagSet } from "../bitflag";
import type { Rng } from "../rng";
import { MFLAG, RF } from "../generated";
import { MON_GROUP, monSpellsOfTypes, RSF_SIZE } from "./types";
import type { Monster } from "./monster";
import { GROUP_TYPE } from "./monster";

/* ------------------------------------------------------------------ */
/* Permanent monster properties                                        */
/* ------------------------------------------------------------------ */

/** Any of the given RST_ spell types are set in the race's spell flags. */
function raceHasSpellType(mon: Monster, ...types: string[]): boolean {
  const flags = mon.race.spellFlags;
  return monSpellsOfTypes(...types).some((i) => flags.has(i));
}

/** monster_is_undead. */
export function monsterIsUndead(mon: Monster): boolean {
  return mon.race.flags.has(RF.UNDEAD);
}

/** monster_is_nonliving: undead or explicitly nonliving; immune to drain. */
export function monsterIsNonliving(mon: Monster): boolean {
  return monsterIsUndead(mon) || mon.race.flags.has(RF.NONLIVING);
}

/** monster_is_living. */
export function monsterIsLiving(mon: Monster): boolean {
  return !monsterIsNonliving(mon);
}

/** monster_is_destroyed: nonliving or stupid monsters are destroyed, not slain. */
export function monsterIsDestroyed(mon: Monster): boolean {
  return monsterIsNonliving(mon) || mon.race.flags.has(RF.STUPID);
}

/** monster_passes_walls: PASS_WALL / KILL_WALL / SMASH_WALL. */
export function monsterPassesWalls(mon: Monster): boolean {
  return (
    mon.race.flags.has(RF.PASS_WALL) ||
    mon.race.flags.has(RF.KILL_WALL) ||
    mon.race.flags.has(RF.SMASH_WALL)
  );
}

/** monster_is_invisible. */
export function monsterIsInvisible(mon: Monster): boolean {
  return mon.race.flags.has(RF.INVISIBLE);
}

/** monster_is_not_invisible. */
export function monsterIsNotInvisible(mon: Monster): boolean {
  return !mon.race.flags.has(RF.INVISIBLE);
}

/** monster_is_unique: the unshifted (original) form is unique. */
export function monsterIsUnique(mon: Monster): boolean {
  const race = mon.originalRace ?? mon.race;
  return race.flags.has(RF.UNIQUE);
}

/** monster_is_shape_unique: the current form is unique. */
export function monsterIsShapeUnique(mon: Monster): boolean {
  return mon.race.flags.has(RF.UNIQUE);
}

/** monster_is_stupid. */
export function monsterIsStupid(mon: Monster): boolean {
  return mon.race.flags.has(RF.STUPID);
}

/** monster_is_smart: the monster is (or was, before a shapechange) smart. */
export function monsterIsSmart(mon: Monster): boolean {
  if (mon.originalRace && mon.originalRace.flags.has(RF.SMART)) return true;
  return mon.race.flags.has(RF.SMART);
}

/**
 * monster_is_esp_detectable: detectable by telepathy. EMPTY_MIND (in both the
 * current and original form) blocks it; WEIRD_MIND makes only one in ten
 * individuals (midx % 10 == 5) detectable.
 */
export function monsterIsEspDetectable(mon: Monster): boolean {
  const flags = mon.race.flags.clone();
  if (mon.originalRace) flags.inter(mon.originalRace.flags);
  if (flags.has(RF.EMPTY_MIND)) return false;
  if (mon.race.flags.has(RF.WEIRD_MIND)) {
    if (mon.midx % 10 !== 5) return false;
  }
  return true;
}

/** monster_has_spirit. */
export function monsterHasSpirit(mon: Monster): boolean {
  return mon.race.flags.has(RF.SPIRIT);
}

/** monster_is_evil. */
export function monsterIsEvil(mon: Monster): boolean {
  return mon.race.flags.has(RF.EVIL);
}

/** monster_is_fearful: can be frightened at all (no NO_FEAR flag). */
export function monsterIsFearful(mon: Monster): boolean {
  return !mon.race.flags.has(RF.NO_FEAR);
}

/** monster_is_powerful. */
export function monsterIsPowerful(mon: Monster): boolean {
  return mon.race.flags.has(RF.POWERFUL);
}

/** monster_has_spells: any spell flag at all. */
export function monsterHasSpells(mon: Monster): boolean {
  return !mon.race.spellFlags.isEmpty();
}

/** monster_breathes: has a damaging-breath spell. */
export function monsterBreathes(mon: Monster): boolean {
  return raceHasSpellType(mon, "RST_BREATH");
}

/** monster_has_innate_spells. */
export function monsterHasInnateSpells(mon: Monster): boolean {
  return raceHasSpellType(mon, "RST_INNATE");
}

/** monster_has_non_innate_spells: any spell set that is not innate. */
export function monsterHasNonInnateSpells(mon: Monster): boolean {
  const monSpells = mon.race.spellFlags.clone();
  const innate = new FlagSet(RSF_SIZE);
  for (const i of monSpellsOfTypes("RST_INNATE")) innate.on(i);
  monSpells.diff(innate);
  return !monSpells.isEmpty();
}

/** monster_loves_archery: has archery spells and casts them often. */
export function monsterLovesArchery(mon: Monster): boolean {
  if (!raceHasSpellType(mon, "RST_ARCHERY")) return false;
  return mon.race.freqInnate < 4;
}

/* ------------------------------------------------------------------ */
/* Temporary monster properties                                        */
/* ------------------------------------------------------------------ */

/** monster_is_in_view: in the player's field of view. */
export function monsterIsInView(mon: Monster): boolean {
  return mon.mflag.has(MFLAG.VIEW);
}

/** monster_is_visible. */
export function monsterIsVisible(mon: Monster): boolean {
  return mon.mflag.has(MFLAG.VISIBLE);
}

/** monster_is_camouflaged: not recognised as a monster. */
export function monsterIsCamouflaged(mon: Monster): boolean {
  return mon.mflag.has(MFLAG.CAMOUFLAGE);
}

/** monster_is_obvious: visible and not camouflaged. */
export function monsterIsObvious(mon: Monster): boolean {
  return monsterIsVisible(mon) && !monsterIsCamouflaged(mon);
}

/** monster_is_mimicking: camouflaged as a specific item. */
export function monsterIsMimicking(mon: Monster): boolean {
  return mon.mflag.has(MFLAG.CAMOUFLAGE) && mon.mimickedObj !== 0;
}

/**
 * monster_can_be_scared: NO_FEAR blocks fear outright; bodyguards are
 * fearless; servants dodge fear one time in three; others get a per-member
 * one-in-twenty save across the group.
 *
 * `primaryGroupSize` is monster_primary_group_size(cave, mon); it defaults to
 * 1 (lone monster) until monster-group tracking is ported, which gives count=0
 * and no group save - exactly a solitary monster.
 */
export function monsterCanBeScared(
  rng: Rng,
  mon: Monster,
  primaryGroupSize = 1,
): boolean {
  if (mon.race.flags.has(RF.NO_FEAR)) return false;
  switch (mon.groupInfo[GROUP_TYPE.PRIMARY]?.role) {
    case MON_GROUP.BODYGUARD:
      return false;
    case MON_GROUP.SERVANT:
      return rng.oneIn(3) ? false : true;
    default: {
      let count = primaryGroupSize - 1;
      while (count-- > 0) {
        if (rng.oneIn(20)) return false;
      }
    }
  }
  return true;
}
