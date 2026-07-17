/**
 * Applying damage to a monster, ported from reference/src/mon-util.c (Angband
 * 4.2.6): mon_take_hit (L1264) and its helpers monster_wake (L686) and
 * monster_scared_by_damage (L1137). This is the shared "a monster is hurt"
 * primitive that projections (project_m), melee, ranged attacks, and the effect
 * handlers all funnel damage through, so death, fear, and waking behave
 * identically no matter what dealt the blow.
 *
 * The heavy player-facing consequences are injected as hooks so the damage /
 * fear / wake logic ships and is tested independently of them:
 * - onKill (player_kill_monster): experience, drops, death messages,
 *   uniqueness, quest completion - a large routine ported with the effect /
 *   command layer.
 * - becomeAware (become_aware): revealing a camouflaged mimic - knowledge/UI.
 * - coverTracksBroken: clearing the player's TMD_COVERTRACKS - player state.
 *
 * Deferred: the arena-level branch (arena mode is not modelled) and the
 * PR_HEALTH redraw (a UI concern) are omitted; both are unreached by the ported
 * callers.
 */

import { MON_TMD } from "../generated";
import { MFLAG } from "../generated";
import type { Rng } from "../rng";
import type { Monster } from "./monster";
import { monsterCanBeScared, monsterIsCamouflaged } from "./predicate";
import {
  MON_TMD_FLG_NOFAIL,
  MON_TMD_FLG_NOMESSAGE,
  MON_TMD_FLG_NOTIFY,
  monClearTimed,
  monDecTimed,
  monIncTimed,
} from "./timed";

/**
 * monster_wake (mon-util.c L686): clear a monster's sleep timer and, with the
 * given percentage chance, mark it aware of the player. `notify` selects
 * whether the sleep clear emits a waking-up message.
 */
export function monsterWake(
  rng: Rng,
  mon: Monster,
  notify: boolean,
  awareChance: number,
): void {
  const flag = notify ? MON_TMD_FLG_NOTIFY : MON_TMD_FLG_NOMESSAGE;
  monClearTimed(rng, mon, MON_TMD.SLEEP, flag);
  if (rng.randint0(100) < awareChance) {
    mon.mflag.on(MFLAG.AWARE);
  }
}

/**
 * monster_scared_by_damage (mon-util.c L1137): pain can reduce, cancel, or
 * newly cause fear. Returns true only when the hit newly frightens the monster.
 * Called after the monster's hp has already been reduced by `dam`.
 * `primaryGroupSize` is monster_primary_group_size(cave, mon), threaded into
 * monster_can_be_scared's per-member group fear save; game callers pass the
 * live group size (game/mon-group.ts), worldless callers default to 1 (lone).
 */
export function monsterScaredByDamage(
  rng: Rng,
  mon: Monster,
  dam: number,
  primaryGroupSize = 1,
): boolean {
  const currentFear = mon.mTimed[MON_TMD.FEAR]!;

  /* Pain can reduce or cancel existing fear, or cause fear. */
  if (currentFear) {
    const tmp = rng.randint1(dam);

    if (tmp < currentFear) {
      /* Reduce fear. */
      monDecTimed(rng, mon, MON_TMD.FEAR, tmp, MON_TMD_FLG_NOMESSAGE);
    } else {
      /* Cure fear. */
      monClearTimed(rng, mon, MON_TMD.FEAR, MON_TMD_FLG_NOMESSAGE);
      return false;
    }
  } else if (monsterCanBeScared(rng, mon, primaryGroupSize)) {
    /* Percentage of fully healthy. */
    const percentage = Math.floor((100 * mon.hp) / mon.maxhp);

    /* Run (sometimes) at 10% or less of max hp... */
    const lowHp = rng.randint1(10) >= percentage;

    /* ...or (usually) when hit for half its current hit points. */
    const bigHit = dam >= mon.hp && rng.randint0(100) < 80;

    if (lowHp || bigHit) {
      let time = rng.randint1(10);
      if (dam >= mon.hp && percentage > 7) {
        time += 20;
      } else {
        time += (11 - percentage) * 5;
      }

      /* Note fear. */
      monIncTimed(
        rng,
        mon,
        MON_TMD.FEAR,
        time,
        MON_TMD_FLG_NOMESSAGE | MON_TMD_FLG_NOFAIL,
      );
      return true;
    }
  }

  return false;
}

/** The player-facing consequences of a hit, supplied by the caller. */
export interface MonTakeHitHooks {
  /** player_kill_monster: experience, drops, death messages, uniqueness. */
  onKill?: (mon: Monster, note: string | null) => void;
  /** become_aware: reveal a camouflaged mimic. */
  becomeAware?: (mon: Monster) => void;
  /** Clear the player's TMD_COVERTRACKS (a hit ends stealthy movement). */
  coverTracksBroken?: () => void;
  /**
   * The arena branch (mon-util.c L1290): a lethal blow in single combat
   * signals the level change instead of killing - the monster stays (at
   * negative hp) until the arena exit finishes it. Passed by game
   * callers while state.arenaLevel is set.
   */
  onArenaDeath?: (mon: Monster) => void;
  /**
   * monster_primary_group_size(cave, mon) for the fear roll's per-member
   * group save (mon-predicate.c L296). Game callers pass the live size
   * (game/mon-group.ts monsterPrimaryGroupSize); absent, 1 (a lone monster).
   */
  primaryGroupSize?: () => number;
}

/** The outcome of a hit: whether the monster died and whether it took fright. */
export interface MonTakeHitResult {
  /** The monster's hp reached below zero and it was killed. */
  died: boolean;
  /** The monster was newly frightened by the blow (meaningless if it died). */
  fear: boolean;
}

/**
 * mon_take_hit (mon-util.c L1264): inflict `dam` damage on a monster from the
 * player. Wakes the monster and clears any Hold when the blow is non-fatal,
 * reveals camouflaged mimics, then applies the damage - killing the monster (via
 * the onKill hook) if its hp drops below zero, or rolling fear otherwise.
 * Returns whether the monster died and whether it was newly frightened.
 */
export function monTakeHit(
  rng: Rng,
  mon: Monster,
  dam: number,
  note: string | null,
  hooks: MonTakeHitHooks = {},
): MonTakeHitResult {
  /* If the hit doesn't kill, wake it up and make it aware of the player. */
  if (dam <= mon.hp) {
    monsterWake(rng, mon, false, 100);
    monClearTimed(rng, mon, MON_TMD.HOLD, MON_TMD_FLG_NOTIFY);
  }

  /* Become aware of its presence. */
  if (monsterIsCamouflaged(mon)) {
    hooks.becomeAware?.(mon);
  }

  /* No damage, we're done. */
  if (dam === 0) return { died: false, fear: false };

  /* Covering tracks is no longer possible. */
  hooks.coverTracksBroken?.();

  /* Hurt it. */
  mon.hp -= dam;
  if (mon.hp < 0) {
    /* Deal with arena monsters: the kill waits for the arena exit. */
    if (hooks.onArenaDeath) {
      hooks.onArenaDeath(mon);
      return { died: true, fear: false };
    }
    /* It is dead now. */
    hooks.onKill?.(mon, note);
    return { died: true, fear: false };
  }

  /* Not dead yet; did it get frightened? */
  return {
    died: false,
    fear: monsterScaredByDamage(rng, mon, dam, hooks.primaryGroupSize?.() ?? 1),
  };
}
