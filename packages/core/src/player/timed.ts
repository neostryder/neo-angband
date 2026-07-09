/**
 * Player timed-effect runtime, ported from reference/src/player-timed.c
 * (Angband 4.2.6): player_set_timed (L787), player_inc_check (L923),
 * player_inc_timed (L1050), player_dec_timed (L1093), player_clear_timed
 * (L1123) and player_timed_grade_eq (L734).
 *
 * This is the shared primitive that the effect handlers (EF_TIMED_*, EF_CURE),
 * the game turn (poison/cut/stun ticks), combat, and monster attacks all funnel
 * player status changes through, so grade transitions, messages, disturbance,
 * and the NONSTACKING guard behave identically no matter the source. It backs
 * the effect interpreter's TimedHost capability (effects/interpreter.ts).
 *
 * The bound timed-effect table (player/bind.ts TimedEffect[]) is passed in, so
 * this module stays free of pack IO. player_inc_check's fail conditions resolve
 * against injected queries (PlayerIncCheckQueries) because the resist / object /
 * player-flag state they read lives in the player calc layer; a caller with no
 * queries lets every effect through, matching a bare, resistance-less player.
 *
 * Faithful deferrals (all notify-only or downstream, none change durations):
 * - The on_begin_effect / on_end_effect chains dispatched on a 0<->positive
 *   transition (they would recurse into the effect interpreter) are invoked via
 *   the optional onTransition hook.
 * - The "don't mention effects that duplicate known player state" notify
 *   suppression (temp_resist / oflag_syn) needs obj_k element / flag knowledge
 *   and is deferred; it only silences a message, never changes the value.
 * - print_custom_message's weapon-name substitution is deferred; messages are
 *   emitted verbatim (none of the ported effects substitute).
 * - disturb + PR_/PU_ redraw + handle_stuff collapse into the onNotify hook.
 */

import type { TimedEffect, TimedGrade } from "./types";

/** The minimal player shape this module mutates: the timed-duration array. */
export interface PlayerTimedTarget {
  /** timed[TMD_MAX]: current durations, indexed by the TMD enum. */
  timed: Int16Array;
}

/** msg() sink for the status messages; msgt is the MSG_ type name. */
export type PlayerTimedMessageSink = (text: string, msgt: string) => void;

/**
 * player_inc_check's fail-condition resolvers. Each returns the player's
 * current state for the named flag / element, so the check can decide whether
 * an incoming effect is inhibited. Names are the upstream symbolic names as
 * stored on TimedFail.flag (OF_ / element / PF_ / TMD_ without the prefix).
 */
export interface PlayerIncCheckQueries {
  /** player_of_has: an intrinsic or worn object flag (OF_ name). */
  objectFlag(name: string): boolean;
  /** el_info[elem].res_level: > 0 resists, < 0 is vulnerable. */
  resistLevel(name: string): number;
  /** player_has: a player (class/race) flag (PF_ name). */
  playerFlag(name: string): boolean;
  /** whether another timed effect (TMD_ name) is currently active. */
  timedActive(name: string): boolean;
}

/** The consequences a duration change can trigger, all optional. */
export interface PlayerTimedHooks {
  /** Emit a status message (print_custom_message). */
  onMessage?: PlayerTimedMessageSink;
  /**
   * disturb + redraw/update + handle_stuff, run once when notify is true;
   * `disturb` (from can_disturb) says whether the player is actually disturbed.
   */
  onNotify?: (idx: number, disturb: boolean) => void;
  /**
   * Dispatch the effect's on_begin_effect / on_end_effect chain on a
   * 0 <-> positive transition (begin = true when the effect starts).
   */
  onTransition?: (idx: number, begin: boolean) => void;
  /** player_inc_check result; when absent, every increase is allowed. */
  incCheck?: (idx: number) => boolean;
}

/** TMD_FAIL_ codes (player-timed.h): the meaning of a TimedFail.code. */
const TMD_FAIL_FLAG_OBJECT = 1;
const TMD_FAIL_FLAG_RESIST = 2;
const TMD_FAIL_FLAG_VULN = 3;
const TMD_FAIL_FLAG_PLAYER = 4;
const TMD_FAIL_FLAG_TIMED_EFFECT = 5;

/**
 * The grade a duration `v` falls into for a timed effect, walking the ordered
 * grade list exactly as player_set_timed / player_timed_grade_eq do (advance
 * while v exceeds the current grade's max, stopping at the last grade).
 */
export function playerTimedGrade(effect: TimedEffect, v: number): TimedGrade {
  const grades = effect.grades;
  let i = 0;
  while (v > grades[i]!.max) {
    i++;
    if (i >= grades.length - 1) break;
  }
  return grades[i]!;
}

/** player_timed_grade_eq: whether the active grade's name matches `match`. */
export function playerTimedGradeEq(
  p: PlayerTimedTarget,
  effect: TimedEffect,
  match: string,
): boolean {
  const v = p.timed[effect.index]!;
  if (!v) return false;
  const grade = playerTimedGrade(effect, v);
  return grade.name !== null && grade.name === match;
}

/**
 * player_inc_check: whether a timed effect is allowed to increase, given the
 * player's resistances and flags. Returns false when a fail condition inhibits
 * it. Learning / "You resist!" side effects are deferred (lore, messages).
 */
export function playerIncCheck(
  effect: TimedEffect,
  queries: PlayerIncCheckQueries,
): boolean {
  for (const f of effect.fail) {
    switch (f.code) {
      case TMD_FAIL_FLAG_OBJECT:
        if (queries.objectFlag(f.flag)) return false;
        break;
      case TMD_FAIL_FLAG_RESIST:
        if (queries.resistLevel(f.flag) > 0) return false;
        break;
      case TMD_FAIL_FLAG_VULN:
        if (queries.resistLevel(f.flag) < 0) return false;
        break;
      case TMD_FAIL_FLAG_PLAYER:
        if (queries.playerFlag(f.flag)) return false;
        break;
      case TMD_FAIL_FLAG_TIMED_EFFECT:
        if (queries.timedActive(f.flag)) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

/**
 * player_set_timed: set a timed effect to `v`, coercing it into the effect's
 * valid range, emitting grade-transition / begin / end / increase / decrease
 * messages, and notifying (disturb + redraw) as upstream does. Returns whether
 * the player was notified.
 */
export function playerSetTimed(
  p: PlayerTimedTarget,
  effect: TimedEffect,
  v: number,
  notify: boolean,
  canDisturb: boolean,
  hooks: PlayerTimedHooks = {},
): boolean {
  const idx = effect.index;
  const old = p.timed[idx]!;

  /* Lower bound */
  v = Math.max(v, effect.lowerBound);

  /* No change */
  if (old === v) return false;

  /* Find the grade we will be going to, and the current one. */
  const newGrade = playerTimedGrade(effect, v);
  const currentGrade = playerTimedGrade(effect, old);

  /* Upper bound */
  if (v > newGrade.max) {
    if (old === newGrade.max) {
      /* Already at the maximum possible; no change. */
      return false;
    }
    v = newGrade.max;
  }

  /*
   * The temp_resist / oflag_syn "already matches known state" notify
   * suppression is deferred (needs obj_k knowledge); it only silences a
   * message and never changes the value.
   */

  /* Always mention going up a grade, otherwise on request. */
  if (newGrade.grade > currentGrade.grade) {
    if (newGrade.upMsg) hooks.onMessage?.(newGrade.upMsg, effect.msgt);
    notify = true;
  } else if (newGrade.grade < currentGrade.grade && newGrade.downMsg) {
    hooks.onMessage?.(newGrade.downMsg, effect.msgt);
    notify = true;
  } else if (notify) {
    if (v === 0) {
      /* Finishing */
      if (effect.onEnd) hooks.onMessage?.(effect.onEnd, "RECOVER");
    } else if (old > v && effect.onDecrease) {
      /* Decrementing */
      hooks.onMessage?.(effect.onDecrease, effect.msgt);
    } else if (v > old && effect.onIncrease) {
      /* Incrementing */
      hooks.onMessage?.(effect.onIncrease, effect.msgt);
    }
  }

  /* Dispatch effects for 0 <-> positive transitions. */
  if (v > 0 && !old) {
    hooks.onTransition?.(idx, true);
  } else if (v === 0) {
    hooks.onTransition?.(idx, false);
  }

  /* Use the value */
  p.timed[idx] = v;

  if (notify) hooks.onNotify?.(idx, canDisturb);

  return notify;
}

/**
 * player_inc_timed: increase a timed effect by `v`. When `check` is true the
 * increase can be resisted (hooks.incCheck); NONSTACKING effects already active
 * block the increase entirely.
 */
export function playerIncTimed(
  p: PlayerTimedTarget,
  effect: TimedEffect,
  v: number,
  notify: boolean,
  canDisturb: boolean,
  check: boolean,
  hooks: PlayerTimedHooks = {},
): boolean {
  if (check === false || (hooks.incCheck ? hooks.incCheck(effect.index) : true)) {
    if (effect.nonStacking && p.timed[effect.index]! > 0) {
      /* Nonstacking and already active: block the increase. */
      return false;
    }
    return playerSetTimed(
      p,
      effect,
      p.timed[effect.index]! + v,
      notify,
      canDisturb,
      hooks,
    );
  }
  return false;
}

/** player_dec_timed: reduce a timed effect by `v` (always notifies if finishing). */
export function playerDecTimed(
  p: PlayerTimedTarget,
  effect: TimedEffect,
  v: number,
  notify: boolean,
  canDisturb: boolean,
  hooks: PlayerTimedHooks = {},
): boolean {
  const newValue = p.timed[effect.index]! - v;
  if (newValue > 0) {
    return playerSetTimed(p, effect, newValue, notify, canDisturb, hooks);
  }
  return playerSetTimed(p, effect, newValue, true, canDisturb, hooks);
}

/** player_clear_timed: clear a timed effect (set to 0). */
export function playerClearTimed(
  p: PlayerTimedTarget,
  effect: TimedEffect,
  notify: boolean,
  canDisturb: boolean,
  hooks: PlayerTimedHooks = {},
): boolean {
  return playerSetTimed(p, effect, 0, notify, canDisturb, hooks);
}
