/**
 * make_ranged_attack and its spell-selection helpers, ported from
 * reference/src/mon-attack.c (Angband 4.2.6): the AI that decides whether and
 * which spell a monster casts on its turn, then hands the chosen spell to
 * do_mon_spell (game/mon-cast.ts). This is the decider; do_mon_spell is the
 * executor. It lives in game/ because it reads and mutates the GameState (the
 * monster, the player, the chunk) and drives the effect stack.
 *
 * The default-play path is complete: the frequency / range / line-of-sight gate
 * (monster_can_cast), the "ineffective spell" pruning (remove_bad_spells: heal /
 * haste / teleport-to / whip / spit by range and status), the clean-bolt and
 * summon-room checks, the random pick and the spell-failure roll. The pieces
 * that ride on subsystems not yet ported are injected or deferred: the
 * birth_ai_learn knowledge filter (unset_spells), RSF_HEAL_KIN's injured-kin
 * scan (monster groups), the monster-lore updates and become_aware (lore, #24),
 * the decoy target and the monster-vs-monster witness path.
 */

import { MFLAG, MON_TMD, RSF, TMD } from "../generated";
import { distance } from "../loc";
import type { Loc } from "../loc";
import { los } from "../world/view";
import { PROJECT, projectable } from "../world/project";
import { monsterIsSmart, monsterIsStupid } from "../mon/predicate";
import {
  RST,
  RST_DAMAGE,
  ignoreSpells,
  monSpellIsInnate,
  testSpells,
} from "../mon/spell";
import type { FlagSet } from "../bitflag";
import type { Monster } from "../mon/monster";
import { squareIsEmpty } from "./context";
import type { GameState } from "./context";
import { doMonSpell } from "./mon-cast";
import type { DoMonSpellDeps } from "./mon-cast";

/** Extra configuration for make_ranged_attack beyond the do_mon_spell deps. */
export interface MakeRangedAttackConfig {
  /** (player not blind) && monster visible: the seen flag for do_mon_spell. */
  seen?: boolean;
  /** find_any_nearby_injured_kin (monster groups, #19): keep RSF_HEAL_KIN. */
  hasInjuredKin?: (midx: number) => boolean;
  /** become_aware when a camouflaged monster casts (lore, #24). */
  becomeAware?: (midx: number) => void;
  /** The "tries to cast a spell, but fails" message (spell failure). */
  failMessage?: (midx: number) => void;
}

/**
 * monster_get_target_dist_grid: the distance to and grid of the monster's
 * target. Decoys are not modelled, so the target is always the player.
 */
function targetDist(state: GameState, mon: Monster): number {
  return mon.cdis;
}
function targetGrid(state: GameState): Loc {
  return state.actor.grid;
}

/**
 * summon_possible: whether a summoned creature could appear near a grid (an
 * empty floor grid within 2, in line of sight). Glyph-of-warding and arena
 * exclusions are deferred (traps #21 / arenas not modelled).
 */
export function summonPossible(state: GameState, grid: Loc): boolean {
  const c = state.chunk;
  for (let y = grid.y - 2; y <= grid.y + 2; y++) {
    for (let x = grid.x - 2; x <= grid.x + 2; x++) {
      const near = { x, y };
      if (!c.inBounds(near)) continue;
      if (distance(grid, near) > 2) continue;
      if (squareIsEmpty(state, near) && los(c, grid, near)) return true;
    }
  }
  return false;
}

/** monster_spell_failrate: the chance a (non-innate) spell fizzles. */
export function monsterSpellFailrate(mon: Monster): number {
  /* MIN(spell_power, 1) as upstream (sic). */
  const power = Math.min(mon.race.spellPower, 1);
  let failrate = 0;
  if (!monsterIsStupid(mon)) {
    failrate = 25 - Math.trunc((power + 3) / 4);
    if ((mon.mTimed[MON_TMD.FEAR] ?? 0) > 0) failrate += 20;
    if ((mon.mTimed[MON_TMD.CONF] ?? 0) > 0 || (mon.mTimed[MON_TMD.DISEN] ?? 0) > 0) {
      failrate += 50;
    }
  }
  return failrate;
}

/**
 * remove_bad_spells: strip spells that would be wasted this turn (a full-health
 * caster's heal, an out-of-range whip, a teleport-to when adjacent, ...). The
 * birth_ai_learn knowledge filter (unset_spells) is deferred.
 */
export function removeBadSpells(
  state: GameState,
  mon: Monster,
  f: FlagSet,
  config: MakeRangedAttackConfig,
): void {
  const tdist = targetDist(state, mon);

  /* Don't heal if full. */
  if (mon.hp >= mon.maxhp) f.off(RSF.HEAL);

  /* Don't heal others with no injured kin nearby (groups, #19). */
  if (f.has(RSF.HEAL_KIN) && !(config.hasInjuredKin?.(mon.midx) ?? false)) {
    f.off(RSF.HEAL_KIN);
  }

  /* Don't haste if already well-hasted. */
  if ((mon.mTimed[MON_TMD.FAST] ?? 0) > 10) f.off(RSF.HASTE);

  /* Don't teleport-to a player who is already adjacent. */
  if (tdist === 1) {
    f.off(RSF.TELE_TO);
    f.off(RSF.TELE_SELF_TO);
  }

  /* Don't use the reach attacks when the player is too far. */
  if (tdist > 2) f.off(RSF.WHIP);
  if (tdist > 3) f.off(RSF.SPIT);
}

/**
 * choose_attack_spell: pick a random spell from the flagset, filtered by
 * whether innate and/or non-innate spells are wanted. Returns RSF_NONE when the
 * (filtered) set is empty.
 */
export function chooseAttackSpell(
  state: GameState,
  f: FlagSet,
  innate: boolean,
  nonInnate: boolean,
): number {
  const spells: number[] = [];
  for (let i = RSF.NONE + 1; i < RSF.MAX; i++) {
    if (!innate && monSpellIsInnate(i)) continue;
    if (!nonInnate && !monSpellIsInnate(i)) continue;
    if (f.has(i)) spells.push(i);
  }
  if (spells.length === 0) return RSF.NONE;
  return spells[state.rng.randint0(spells.length)]!;
}

/**
 * monster_can_cast: whether a monster has a chance to cast (innate or not) this
 * turn - a frequency roll gated by the NICE flag, taunt, preferred range, the
 * maximum range and a clear short-range path. The witness path for a non-player
 * target is deferred (the target is always the player here).
 */
export function monsterCanCast(
  state: GameState,
  mon: Monster,
  innate: boolean,
  maxRange: number,
): boolean {
  let chance = innate ? mon.race.freqInnate : mon.race.freqSpell;
  const tdist = targetDist(state, mon);
  const tgrid = targetGrid(state);

  /* Cannot cast when nice, or with no frequency. */
  if (mon.mflag.has(MFLAG.NICE)) return false;
  if (!chance) return false;

  /* A taunted player draws more melee; a preferred-range target draws spells. */
  if ((state.actor.player.timed[TMD.TAUNT] ?? 0) > 0) chance = Math.trunc(chance / 2);
  if (tdist === mon.bestRange) chance *= 2;

  /* Only cast occasionally, in range, with a clear path. */
  if (state.rng.randint0(100) >= chance) return false;
  if (tdist > maxRange) return false;
  if (!projectable(state.chunk, mon.grid, tgrid, PROJECT.SHORT, maxRange)) {
    return false;
  }

  return true;
}

/**
 * make_ranged_attack: a monster casts a spell, shoots a missile or breathes.
 * Returns whether an attempt was made (which spends the monster's turn).
 */
export function makeRangedAttack(
  state: GameState,
  midx: number,
  deps: DoMonSpellDeps,
  config: MakeRangedAttackConfig = {},
): boolean {
  const mon = state.monsters[midx];
  if (!mon) return false;
  const maxRange = deps.cast.maxRange;
  const seen = config.seen ?? true;

  /* Cast this turn? Try non-innate, then innate. */
  let innate = false;
  if (!monsterCanCast(state, mon, false, maxRange)) {
    if (!monsterCanCast(state, mon, true, maxRange)) return false;
    innate = true;
  }

  /* Work on a copy of the racial spell flags. */
  const f = mon.race.spellFlags.clone();

  /* Smart, badly-hurt monsters save their damage spells for escape. */
  if (
    monsterIsSmart(mon) &&
    mon.hp < Math.trunc(mon.maxhp / 10) &&
    state.rng.oneIn(2)
  ) {
    ignoreSpells(f, RST_DAMAGE);
  }

  /* Non-stupid monsters filter out ineffective spells. */
  if (!monsterIsStupid(mon)) {
    removeBadSpells(state, mon, f, config);

    /* A bolt needs a clear, stopping path to the target. */
    const tgrid = targetGrid(state);
    if (
      testSpells(f, RST.BOLT) &&
      !projectable(state.chunk, mon.grid, tgrid, PROJECT.STOP, maxRange)
    ) {
      ignoreSpells(f, RST.BOLT);
    }

    /* A summon needs somewhere to put the summoned creature. */
    if (!summonPossible(state, mon.grid)) ignoreSpells(f, RST.SUMMON);
  }

  /* No spells left. */
  if (f.isEmpty()) return false;

  /* Choose a spell to cast. */
  const thrown = chooseAttackSpell(state, f, innate, !innate);
  if (!thrown) return false;

  /* A hidden caster reveals itself (lore, #24). */
  config.becomeAware?.(midx);

  /* Spell failure (innate attacks never fail). */
  const failrate = monsterSpellFailrate(mon);
  if (!monSpellIsInnate(thrown) && state.rng.randint0(100) < failrate) {
    config.failMessage?.(midx);
    return true;
  }

  /* Cast it. */
  doMonSpell(state, midx, thrown, seen, deps);
  return true;
}
