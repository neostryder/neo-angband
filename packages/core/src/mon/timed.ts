/**
 * Monster timed effects, ported from reference/src/mon-timed.c (Angband
 * 4.2.6): the resist roll, mon_set_timed, and the inc/dec/clear wrappers that
 * drive a monster's m_timed[] array (sleep, stun, confusion, fear, slow,
 * haste, hold, disenchant, command, shapechange).
 *
 * The effect table (gets_save / stacking / resist flag / max timer / begin-
 * end-increase messages) is the generated MON_TIMED_ENTRIES (from
 * list-mon-timed.h). Two upstream couplings are handled as follows, both
 * faithful in reachable states:
 * - Messages: the monster-message queue (mon-msg.c add_monster_message) is not
 *   ported, so mon_set_timed emits through an optional MonTimedMessageSink
 *   instead. The decision of WHICH message fires (and its NOTIFY/NOMESSAGE/
 *   visibility gate) is preserved exactly; callers that have a sink pass one.
 * - MON_TMD_CHANGED shapechange (monster_change_shape / _revert_shape,
 *   mon-util.c) is DEFERRED: the timer is still set, but the form is not
 *   swapped. CHANGED is only set by an effect that is not ported yet, so this
 *   path is currently unreachable.
 *
 * The lore learn on a flag-resist (lore_learn_flag_if_visible) and the
 * health-bar / monster-list redraw (upkeep masks) are UI/lore concerns and are
 * DEFERRED.
 */

import type { Rng } from "../rng";
import { MON_TIMED_ENTRIES, RF } from "../generated";
import { MON_TMD } from "../generated";
import type { Monster } from "./monster";
import { monsterIsObvious, monsterIsUnique } from "./predicate";

/** mon-timed.h flags. */
export const MON_TMD_FLG_NOTIFY = 0x01;
export const MON_TMD_FLG_NOMESSAGE = 0x04;
export const MON_TMD_FLG_NOFAIL = 0x08;

/** Minimum number of turns a new timed effect can last (MON_INC_MIN_TURNS). */
const MON_INC_MIN_TURNS = 2;

/**
 * A sink for the monster message that mon_set_timed would queue. `note` is the
 * MON_MSG_* name (or the synthetic "MON_MSG_UNAFFECTED" / "MON_MSG_SHAPE_FAIL")
 * upstream would pass to add_monster_message; `add` mirrors its 3rd argument.
 */
/**
 * monster_change_shape / monster_revert_shape (game/mon-shape.ts), passed
 * by the game-layer timed calls for MON_TMD_CHANGED.
 */
export interface MonShapeHooks {
  change: (mon: Monster) => boolean;
  revert: (mon: Monster) => boolean;
}

export type MonTimedMessageSink = (
  mon: Monster,
  note: string,
  add: boolean,
) => void;

/** Resolve an effect entry's resistFlag ("RF_NO_SLEEP" | 0) to an RF index. */
function resistFlagIndex(resistFlag: string | number): number {
  if (typeof resistFlag !== "string") return -1;
  const key = resistFlag.replace(/^RF_/, "") as keyof typeof RF;
  const idx = RF[key];
  return typeof idx === "number" ? idx : -1;
}

/**
 * mon_timed_name_to_idx: the MON_TMD_ index for an effect name, or -1.
 */
export function monTimedNameToIdx(name: string): number {
  for (let i = 0; i < MON_TMD.MAX; i++) {
    if (MON_TIMED_ENTRIES[i]?.name === name) return i;
  }
  return -1;
}

/** saving_throw: level- and timer-scaled resist, doubled for uniques. */
function savingThrow(rng: Rng, mon: Monster, timer: number): boolean {
  const resistChance = Math.min(
    90,
    mon.race.level + Math.max(0, 25 - Math.trunc(timer / 2)),
  );
  /* Give unique monsters a double check. */
  if (monsterIsUnique(mon) && rng.randint0(100) < resistChance) return true;
  return rng.randint0(100) < resistChance;
}

/** does_resist: NOFAIL override, then flag immunity, then the optional save. */
function doesResist(
  rng: Rng,
  mon: Monster,
  effectType: number,
  timer: number,
  flag: number,
): boolean {
  const effect = MON_TIMED_ENTRIES[effectType]!;

  /* The game can override the monster's innate resistance. */
  if (flag & MON_TMD_FLG_NOFAIL) return false;

  /* Resistance from a monster race flag (lore learn DEFERRED). */
  const rflag = resistFlagIndex(effect.resistFlag);
  if (rflag >= 0 && mon.race.flags.has(rflag)) return true;

  /* Some effects get a saving throw; others do not. */
  return effect.save ? savingThrow(rng, mon, timer) : false;
}

/**
 * mon_set_timed: set effect `effectType`'s timer to `timer`, honouring
 * resistance, the begin/end/increase message selection, and the COMMAND-expiry
 * and CHANGED special cases. Returns true if the monster was affected.
 */
export function monSetTimed(
  rng: Rng,
  mon: Monster,
  effectType: number,
  timer: number,
  flag = 0,
  onMessage?: MonTimedMessageSink,
  shape?: MonShapeHooks,
): boolean {
  const effect = MON_TIMED_ENTRIES[effectType]!;
  const oldTimer = mon.mTimed[effectType]!;

  let resisted = false;
  let update = false;
  let checkResist: boolean;
  let note: string | number = 0;

  /* Limit the time of the effect. */
  if (timer > effect.time) timer = effect.time;

  /* No change. */
  if (oldTimer === timer) {
    return false;
  } else if (timer === 0) {
    /* Turning off, usually mention. */
    note = effect.messageEnd;
    flag |= MON_TMD_FLG_NOTIFY;
    checkResist = false;
    /* Necromancer COMMAND expiring: drop the stale monster -> monster target. */
    if (effectType === MON_TMD.COMMAND) mon.target.midx = 0;
  } else if (oldTimer === 0) {
    /* Turning on, usually mention. */
    note = effect.messageBegin;
    flag |= MON_TMD_FLG_NOTIFY;
    checkResist = true;
  } else if (timer > oldTimer) {
    /* Increase: a different message, but do not auto-mention. */
    note = effect.messageIncrease;
    checkResist = true;
  } else {
    /* Decreases get no message and never resist. */
    checkResist = false;
  }

  /* Resolve resistance, when appropriate. */
  if (checkResist && doesResist(rng, mon, effectType, timer, flag)) {
    resisted = true;
    note = "MON_MSG_UNAFFECTED";
  } else {
    mon.mTimed[effectType] = timer;
    update = true;
  }

  /* Special case - deal with monster shapechanges (mon-timed.c L195).
   * The swap functions live in game/mon-shape.ts; the game-layer timed
   * calls pass them as hooks (the layering keeps this module below
   * game/). Without hooks, the timer stands and the form is unchanged. */
  if (effectType === MON_TMD.CHANGED && shape) {
    if (timer > oldTimer) {
      if (!shape.change(mon)) {
        note = "MON_MSG_SHAPE_FAIL";
        mon.mTimed[effectType] = oldTimer;
      }
    } else if (timer === 0) {
      shape.revert(mon);
    }
  }

  /* Queue a message if there is one, it is allowed, and the monster is seen. */
  if (
    note &&
    !(flag & MON_TMD_FLG_NOMESSAGE) &&
    flag & MON_TMD_FLG_NOTIFY &&
    monsterIsObvious(mon)
  ) {
    onMessage?.(mon, String(note), true);
  }

  /* update -> health-bar / monster-list redraw is UI upkeep (DEFERRED). */
  void update;

  return !resisted;
}

/**
 * mon_inc_timed: raise effect `effectType` by `timer` (min 2 turns for a new
 * effect), stacking per the effect's rule, then mon_set_timed.
 */
export function monIncTimed(
  rng: Rng,
  mon: Monster,
  effectType: number,
  timer: number,
  flag = 0,
  onMessage?: MonTimedMessageSink,
  shape?: MonShapeHooks,
): boolean {
  const effect = MON_TIMED_ENTRIES[effectType]!;

  /* Make a new effect last a minimum number of turns. */
  if (mon.mTimed[effectType] === 0 && timer < MON_INC_MIN_TURNS) {
    timer = MON_INC_MIN_TURNS;
  }

  let newValue = timer;
  switch (effect.stack) {
    case "NO":
      newValue = mon.mTimed[effectType]! === 0 ? timer : mon.mTimed[effectType]!;
      break;
    case "MAX":
      newValue = Math.max(mon.mTimed[effectType]!, timer);
      break;
    case "INCR":
      newValue = mon.mTimed[effectType]! + timer;
      break;
  }

  return monSetTimed(rng, mon, effectType, newValue, flag, onMessage, shape);
}

/**
 * mon_dec_timed: lower effect `effectType` by `timer` (never below 0). A
 * decrease never fails.
 */
export function monDecTimed(
  rng: Rng,
  mon: Monster,
  effectType: number,
  timer: number,
  flag = 0,
  onMessage?: MonTimedMessageSink,
  shape?: MonShapeHooks,
): boolean {
  const newLevel = Math.max(0, mon.mTimed[effectType]! - timer);
  return monSetTimed(rng, mon, effectType, newLevel, flag, onMessage, shape);
}

/** mon_clear_timed: clear effect `effectType` (no-op if already 0). */
export function monClearTimed(
  rng: Rng,
  mon: Monster,
  effectType: number,
  flag = 0,
  onMessage?: MonTimedMessageSink,
  shape?: MonShapeHooks,
): boolean {
  if (mon.mTimed[effectType] === 0) return false;
  return monSetTimed(rng, mon, effectType, 0, flag, onMessage, shape);
}

/**
 * monster_effect_level: the 0 (unaffected) .. 5 (max) intensity band an effect
 * is currently at for the monster.
 */
export function monsterEffectLevel(mon: Monster, effectType: number): number {
  const effect = MON_TIMED_ENTRIES[effectType]!;
  const divisor = Math.max(Math.trunc(effect.time / 5), 1);
  return Math.min(
    Math.trunc((mon.mTimed[effectType]! + divisor - 1) / divisor),
    5,
  );
}
