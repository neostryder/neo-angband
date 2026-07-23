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
 * - disturb + PR_/PU_ redraw + handle_stuff collapse into the onNotify hook.
 *
 * Ported (obj-util.c:1118 print_custom_message, player-timed.c:828-843,945-953):
 * - print_custom_message's {name}/{kind}/{s}/{is} weapon-name substitution
 *   (obj-util.c:1118) runs on every emitted message via the optional
 *   hooks.weapon descriptor; with no weapon the tags resolve to the obj == NULL
 *   forms ("hands", no "s", "are"), matching a bare-handed player.
 * - The temp_resist / oflag_syn "already matches known state" notify
 *   suppression (player-timed.c:828-843) runs when hooks supplies the obj_k
 *   knowledge queries; absent them (obj_k twin deferred, gap 4.8) no message is
 *   suppressed. It only silences a message, never changes the value.
 * - player_inc_check's equip_learn / update_smart_learn / "You resist the
 *   effect!" side effects (player-timed.c:945-953) run through the optional
 *   PlayerIncCheckHooks; absent them the check stays a pure predicate.
 */

import type { TimedEffect, TimedGrade } from "./types";

/**
 * The equipped-weapon descriptor print_custom_message (obj-util.c:1118)
 * substitutes into a status message's {tags}. `name` is object_desc(
 * ODESC_PREFIX | ODESC_BASE), `kind` is object_kind_name, `number` is the
 * stack size (drives {s} / {is}). Undefined means no weapon (the obj == NULL
 * path: "hands", no verb "s", "are").
 */
export interface TimedWeaponDesc {
  name: string;
  kind: string;
  number: number;
}

/**
 * print_custom_message (obj-util.c:1118): substitute the object tags in a
 * status string. {name} -> weapon name or "hands"; {kind} -> weapon kind or
 * "hands"; {s} -> "s" for a single weapon, else ""; {is} -> "is" for a single
 * weapon, else "are" (also "are" with no weapon). Text without tags is returned
 * unchanged.
 */
export function substituteTimedMessage(
  text: string,
  weapon?: TimedWeaponDesc,
): string {
  if (text.indexOf("{") < 0) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    /* Scan an all-alpha tag body ending in '}'. */
    let j = open + 1;
    while (j < text.length && /[A-Za-z]/.test(text[j]!)) j++;
    if (text[j] === "}") {
      const tag = text.slice(open + 1, j);
      /* msg_tag_lookup: name/kind (4 chars), then "s", then "is". */
      if (tag.startsWith("name")) {
        out += weapon ? weapon.name : "hands";
      } else if (tag.startsWith("kind")) {
        out += weapon ? weapon.kind : "hands";
      } else if (tag.startsWith("s")) {
        if (weapon && weapon.number === 1) out += "s";
      } else if (tag.startsWith("is")) {
        out += !weapon || weapon.number > 1 ? "are" : "is";
      }
      i = j + 1;
    } else {
      /* Invalid tag: drop the '{' and continue after it (obj-util.c:1178
         sets string = next + 1, never copying the stray brace). */
      i = open + 1;
    }
  }
  return out;
}

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

/**
 * obj_k knowledge queries for player_set_timed's notify suppression
 * (player-timed.c:828-843). When present, a message that only duplicates
 * already-known player state is silenced. The obj_k twin is deferred (gap 4.8),
 * so callers usually omit this and no message is suppressed.
 */
export interface TimedNotifyQueries {
  /** p->obj_k->el_info[elem].res_level != 0 (element resist is known). */
  knownResist(elem: number): boolean;
  /** player_is_immune(p, elem). */
  isImmune(elem: number): boolean;
  /** of_has(p->obj_k->flags, of) (the object flag's presence is known). */
  knownFlag(of: number): boolean;
  /** player_of_has_not_timed(p, of): has the flag from a non-timed source. */
  hasFlagNotTimed(of: number): boolean;
}

/** The consequences a duration change can trigger, all optional. */
export interface PlayerTimedHooks {
  /** Emit a status message (print_custom_message). */
  onMessage?: PlayerTimedMessageSink;
  /**
   * The equipped weapon, for print_custom_message's {name}/{kind}/{s}/{is}
   * substitution. Omit for a bare-handed player (the obj == NULL tag forms).
   */
  weapon?: TimedWeaponDesc;
  /**
   * obj_k queries for the temp_resist / oflag_syn notify suppression. Omit to
   * suppress nothing (the obj_k twin is deferred).
   */
  notifyQueries?: TimedNotifyQueries;
  /**
   * disturb + redraw/update + handle_stuff, run once when notify is true;
   * `disturb` (from can_disturb) says whether the player is actually disturbed.
   */
  onNotify?: (idx: number, disturb: boolean) => void;
  /**
   * Dispatch the effect's on_begin_effect / on_end_effect chain on a
   * 0 <-> positive transition (begin = true when the effect starts).
   * canDisturb mirrors player_set_timed's argument: upstream runs the chain
   * with source_none() when it is true and source_player() otherwise.
   */
  onTransition?: (idx: number, begin: boolean, canDisturb: boolean) => void;
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
 * The learning / message side effects of a non-lore player_inc_check
 * (player-timed.c:945-953), all optional. Present them for a real effect
 * application; omit them for a lore-only check (the port's lore path passes no
 * hooks, matching the C `lore` branch that skips them).
 */
export interface PlayerIncCheckHooks {
  /** cave->mon_current > 0: the effect originates from a monster action. */
  monsterSource?: boolean;
  /** equip_learn_flag(p, of): learn the object flag from worn gear. */
  equipLearnFlag?: (name: string) => void;
  /** equip_learn_element(p, elem): learn the element resist from worn gear. */
  equipLearnElement?: (name: string) => void;
  /** update_smart_learn(mon, p, of, 0, -1): teach the monster the player flag. */
  updateSmartLearn?: (name: string) => void;
  /** msg("You resist the effect!") when a monster's effect is resisted. */
  resistMessage?: () => void;
}

/**
 * player_inc_check: whether a timed effect is allowed to increase, given the
 * player's resistances and flags. Returns false when a fail condition inhibits
 * it. With `hooks` (a real, non-lore check) it also runs the learning and
 * "You resist the effect!" side effects (player-timed.c:945-953): the object /
 * element flag is learned from worn gear on every OBJECT / RESIST / VULN check,
 * a monster source is taught via update_smart_learn, and a resisted monster
 * effect prints the resist message.
 */
export function playerIncCheck(
  effect: TimedEffect,
  queries: PlayerIncCheckQueries,
  hooks?: PlayerIncCheckHooks,
): boolean {
  for (const f of effect.fail) {
    switch (f.code) {
      case TMD_FAIL_FLAG_OBJECT:
        /* Learn the flag from worn gear and teach a monster source, then
         * inhibit if the player has the flag (with a message from a monster). */
        hooks?.equipLearnFlag?.(f.flag);
        if (hooks?.monsterSource) hooks.updateSmartLearn?.(f.flag);
        if (queries.objectFlag(f.flag)) {
          if (hooks?.monsterSource) hooks.resistMessage?.();
          return false;
        }
        break;
      case TMD_FAIL_FLAG_RESIST:
        hooks?.equipLearnElement?.(f.flag);
        if (queries.resistLevel(f.flag) > 0) return false;
        break;
      case TMD_FAIL_FLAG_VULN:
        hooks?.equipLearnElement?.(f.flag);
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
   * Don't mention effects which already match the known player state
   * (player-timed.c:828-843): a temporary resist the player is known to be
   * immune to, or a flag synonym the player is known to have from worn gear.
   * Only silences a message; never changes the value. Requires the obj_k twin
   * queries (deferred, gap 4.8), so with none supplied nothing is suppressed.
   */
  const q = hooks.notifyQueries;
  if (q) {
    if (
      effect.tempResist !== -1 &&
      q.knownResist(effect.tempResist) &&
      q.isImmune(effect.tempResist)
    ) {
      notify = false;
    }
    if (
      effect.oflagSyn &&
      effect.oflagDup !== 0 &&
      q.knownFlag(effect.oflagDup) &&
      q.hasFlagNotTimed(effect.oflagDup)
    ) {
      notify = false;
    }
  }

  /* print_custom_message: substitute weapon-name tags in every status line. */
  const say = (text: string, msgt: string): void =>
    hooks.onMessage?.(substituteTimedMessage(text, hooks.weapon), msgt);

  /* Always mention going up a grade, otherwise on request. */
  if (newGrade.grade > currentGrade.grade) {
    if (newGrade.upMsg) say(newGrade.upMsg, effect.msgt);
    notify = true;
  } else if (newGrade.grade < currentGrade.grade && newGrade.downMsg) {
    say(newGrade.downMsg, effect.msgt);
    notify = true;
  } else if (notify) {
    if (v === 0) {
      /* Finishing */
      if (effect.onEnd) say(effect.onEnd, "RECOVER");
    } else if (old > v && effect.onDecrease) {
      /* Decrementing */
      say(effect.onDecrease, effect.msgt);
    } else if (v > old && effect.onIncrease) {
      /* Incrementing */
      say(effect.onIncrease, effect.msgt);
    }
  }

  /* Dispatch effects for 0 <-> positive transitions (player-timed.c:873-891). */
  if (v > 0 && !old) {
    hooks.onTransition?.(idx, true, canDisturb);
  } else if (v === 0) {
    hooks.onTransition?.(idx, false, canDisturb);
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

/* ------------------------------------------------------------------ *
 * Temporary brands and slays (obj-slays.c:287-317).
 * ------------------------------------------------------------------ */

/**
 * The raw player_timed pack fields naming a temporary brand/slay (the
 * `brand:` / `slay:` directives, player-timed.c:361-405). The bound
 * TimedEffect does not carry them, so the wiring passes the raw pack records
 * (in TMD order) alongside the brand/slay tables.
 */
export interface TimedTempBrandSlayRecord {
  brand?: readonly string[];
  slay?: readonly string[];
}

/**
 * player_has_temporary_brand / player_has_temporary_slay (obj-slays.c:287-317)
 * over the live timed array: an active timed effect whose data binds the
 * brand/slay index grants it temporarily. The records' brand/slay codes are
 * resolved against the bound tables once, mirroring the temp_brand/temp_slay
 * fields upstream stamps at parse time (player-timed.c:380,403).
 */
export function buildTempBrandSlay(
  p: PlayerTimedTarget,
  records: readonly TimedTempBrandSlayRecord[],
  brands: readonly ({ code: string } | null)[],
  slays: readonly ({ code: string } | null)[],
): { hasBrand(idx: number): boolean; hasSlay(idx: number): boolean } {
  const tempBrand = records.map((r) => {
    const code = r.brand?.[0];
    return code ? brands.findIndex((b) => b !== null && b.code === code) : -1;
  });
  const tempSlay = records.map((r) => {
    const code = r.slay?.[0];
    return code ? slays.findIndex((s) => s !== null && s.code === code) : -1;
  });
  return {
    hasBrand(idx: number): boolean {
      for (let i = 0; i < tempBrand.length; i++) {
        if (tempBrand[i] === idx && p.timed[i]) return true;
      }
      return false;
    },
    hasSlay(idx: number): boolean {
      for (let i = 0; i < tempSlay.length; i++) {
        if (tempSlay[i] === idx && p.timed[i]) return true;
      }
      return false;
    },
  };
}
