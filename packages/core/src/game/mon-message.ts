/**
 * Monster message grammar, ported from reference/src/mon-msg.c (Angband 4.2.6):
 * get_subject, get_message_text and the pain-code selection of message_pain /
 * get_pain_msg_code. This is the display-layer (#25) piece that turns the
 * MON_MSG_* codes the projection emits ("the kobold dies", "shrugs off the
 * attack", "wakes up") into finished sentences.
 *
 * The port formats one visible monster at a time (count == 1, not invisible /
 * offscreen), which is what the game-layer message hooks deliver: the batching
 * / de-duplication / pluralisation of add_monster_message across a whole
 * projection is a UI-buffering concern the single-message web sink does not
 * need. The [singular|plural] bracket state machine is preserved verbatim so a
 * later batched front end can reuse it with do_plural = true.
 */

import { MON_MESSAGE_ENTRIES, MON_MSG, MSG, RF } from "../generated";
import type { Monster } from "../mon/monster";
import type { MonsterRace } from "../mon/types";

/**
 * get_message_text's bracket state machine (mon-msg.c L358): "[a|b]" selects a
 * for singular and b for plural; "[s]" is shorthand for "[|s]". Characters
 * outside brackets pass through. Our callers are always singular.
 */
function resolveBrackets(source: string, doPlural: boolean): string {
  const NORMAL = 0;
  const SINGLE = 1;
  const PLURAL = 2;
  let state = NORMAL;
  let out = "";
  for (const cur of source) {
    if (state === NORMAL && cur === "[") {
      state = SINGLE;
    } else if (state === SINGLE && cur === "|") {
      state = PLURAL;
    } else if (state !== NORMAL && cur === "]") {
      state = NORMAL;
    } else if (
      state === NORMAL ||
      (state === SINGLE && !doPlural) ||
      (state === PLURAL && doPlural)
    ) {
      out += cur;
    }
  }
  return out;
}

/**
 * get_subject (mon-msg.c L318) for one visible monster: the unique's own name,
 * else "The <race>"; a trailing comma for RF_NAME_COMMA races, then a space.
 */
function subjectOf(race: MonsterRace): string {
  let buf = race.flags.has(RF.UNIQUE) ? race.name : `The ${race.name}`;
  if (race.flags.has(RF.NAME_COMMA)) buf += ",";
  return `${buf} `;
}

/** The raw template for a code: the pain family for the graded pain codes. */
function sourceText(race: MonsterRace, msgCode: number): string {
  switch (msgCode) {
    case MON_MSG["95"]: return race.base.pain.messages[0] ?? "";
    case MON_MSG["75"]: return race.base.pain.messages[1] ?? "";
    case MON_MSG["50"]: return race.base.pain.messages[2] ?? "";
    case MON_MSG["35"]: return race.base.pain.messages[3] ?? "";
    case MON_MSG["20"]: return race.base.pain.messages[4] ?? "";
    case MON_MSG["10"]: return race.base.pain.messages[5] ?? "";
    case MON_MSG["0"]: return race.base.pain.messages[6] ?? "";
    default: return MON_MESSAGE_ENTRIES[msgCode]?.text ?? "";
  }
}

/**
 * Format a MON_MSG code into a finished sentence for one visible monster, or
 * null when the code has no text (e.g. MON_MSG_NONE handled elsewhere). Mirrors
 * show_message (mon-msg.c L469) for the count == 1, visible, on-screen case.
 */
export function formatMonsterMessage(mon: Monster, msgCode: number): string | null {
  const entry = MON_MESSAGE_ENTRIES[msgCode];
  if (!entry) return null;
  const body = resolveBrackets(sourceText(mon.race, msgCode), false);
  if (!body) return null;
  const subject = entry.omitSubject ? "" : subjectOf(mon.race);
  return subject + body;
}

/**
 * The timed-message sink passes a MON_MSG_* name string (mon/timed.ts): map it
 * to its code and format. Returns null for an unknown / empty name.
 */
export function formatMonsterMessageByName(mon: Monster, note: string): string | null {
  const key = note.replace(/^MON_MSG_/, "") as keyof typeof MON_MSG;
  const code = MON_MSG[key];
  if (typeof code !== "number") return null;
  return formatMonsterMessage(mon, code);
}

/**
 * get_pain_msg_code (mon-msg.c L96): the graded pain code from the damage taken
 * versus the monster's pre-hit hp. `mon.hp` is the post-damage value, matching
 * the upstream call site (message_pain runs after mon_take_hit).
 */
export function painMessageCode(mon: Monster, dam: number): number {
  if (dam <= 0) return MON_MSG.UNHARMED;
  const newhp = mon.hp;
  const oldhp = newhp + dam;
  const percentage = oldhp > 0 ? Math.trunc((newhp * 100) / oldhp) : 0;
  if (percentage > 95) return MON_MSG["95"];
  if (percentage > 75) return MON_MSG["75"];
  if (percentage > 50) return MON_MSG["50"];
  if (percentage > 35) return MON_MSG["35"];
  if (percentage > 20) return MON_MSG["20"];
  if (percentage > 10) return MON_MSG["10"];
  return MON_MSG["0"];
}

/** message_pain (mon-msg.c L123): the graded "it is hurt" line, or null. */
export function formatPainMessage(mon: Monster, dam: number): string | null {
  return formatMonsterMessage(mon, painMessageCode(mon, dam));
}

/**
 * get_message_type (mon-msg.c L448): the MSG_* sound type for a monster
 * message code (MSG_KILL for deaths, MSG_GENERIC for the rest). The
 * unique/Morgoth KILL_UNIQUE/KILL_KING refinement is DEFERRED (needs the
 * Morgoth base check). Returns a MSG index for state.sound.
 */
export function monMessageSoundType(msgCode: number): number {
  const name = MON_MESSAGE_ENTRIES[msgCode]?.msgType ?? "MSG_GENERIC";
  const key = name.replace(/^MSG_/, "") as keyof typeof MSG;
  return MSG[key] ?? MSG.GENERIC;
}
