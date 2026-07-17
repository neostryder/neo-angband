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
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import type { MonsterAltMsg, MonsterRace, MonsterSpell } from "../mon/types";
import { MDESC, MDESC_TARG, monsterDesc, pluralAux } from "../mon/desc";

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
 * get_subject (mon-msg.c L318): the sentence subject for a monster message
 * batch. Invisible: "It" (count 1) or "N monsters". Visible: the unique name,
 * "The <race>" (count 1), or "N <plural>" (race plural, else plural_aux). A
 * trailing comma for RF_NAME_COMMA races, an optional "(offscreen)" tag, then a
 * separating space. The port's single-message sink passes count 1, visible,
 * on-screen; the count / invisible / offscreen parameters make the full
 * get_subject grammar available (and testable) for a later batched front end.
 */
function subjectOf(
  race: MonsterRace,
  count = 1,
  invisible = false,
  offscreen = false,
): string {
  let buf: string;
  if (invisible) {
    buf = count === 1 ? "It" : `${count} monsters`;
  } else if (race.flags.has(RF.UNIQUE)) {
    buf = race.name;
  } else if (count === 1) {
    buf = `The ${race.name}`;
  } else if (race.plural !== null) {
    buf = `${count} ${race.plural}`;
  } else {
    buf = pluralAux(`${count} ${race.name}`);
  }
  if (!invisible && race.flags.has(RF.NAME_COMMA)) buf += ",";
  if (offscreen) buf += " (offscreen)";
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

/* ------------------------------------------------------------------ */
/* Spell casting messages (mon-spell.c spell_message)                  */
/* ------------------------------------------------------------------ */

/** The punctuation set spell_message (mon-spell.c L98) checks after a tag. */
const SPELL_PUNCT = ".!?;:,'";

/** Everything spellMessageText needs beyond the caster and spell. */
export interface SpellMessageDeps {
  /** cave_monster(cave, mon->target.midx): the caster's monster target, if any. */
  targetMon?: Monster | null;
  /** panel_contains, threaded into monster_desc for the "(offscreen)" tag. */
  panelContains?: (grid: Loc) => boolean;
  /**
   * projections[type].lash_desc for the {type} / {oftype} tags, where type is
   * the caster's first blow's lash_type. Defaults to null (those tags expand to
   * nothing), which is only reachable for LASH/WHIP casters whose message uses
   * the tag - the wiring supplies a real resolver from the projection registry.
   */
  lashDesc?: (projectionName: string) => string | null;
}

/**
 * find_alternate_spell_message (mon-spell.c L72): a race-specific override of a
 * spell message, or null. The empty-string override ("") is a real value
 * upstream treats as "suppress this message" - kept, not coalesced to null.
 */
function findAlternateSpellMessage(
  msgs: readonly MonsterAltMsg[],
  spellIndex: number,
  msgType: MonsterAltMsg["msgType"],
): string | null {
  for (const am of msgs) {
    if (am.index === spellIndex && am.msgType === msgType) return am.message;
  }
  return null;
}

/**
 * spell_message (mon-spell.c L94): build the finished spell-cast line for a
 * monster, filling {name} / {pronoun} / {target} / {type} / {oftype} tags and
 * choosing the seen / blind / miss variant (per-race alt message first, then the
 * power-level message). Returns the text and its MSG_* sound type name, or null
 * when the message is suppressed (an empty override) or missing (no message for
 * the state - upstream logs a bug and returns; the port returns null).
 */
export function spellMessageText(
  mon: Monster,
  spell: MonsterSpell,
  seen: boolean,
  hits: boolean,
  deps: SpellMessageDeps = {},
): { text: string; msgt: string } | null {
  /* Get the right level of message (mon-spell.c L110). */
  let level = spell.levels[0]!;
  for (let i = 1; i < spell.levels.length; i++) {
    const next = spell.levels[i]!;
    if (mon.race.spellPower >= next.power) level = next;
    else break;
  }

  const tMon = deps.targetMon ?? null;

  /* Select the source template, per-race alt message first (L120-168). */
  let inCursor: string | null;
  if (!seen) {
    if (tMon) return null;
    inCursor = findAlternateSpellMessage(mon.race.spellMsgs, spell.index, "unseen");
    if (inCursor === null) {
      inCursor = level.blindMessage || null;
      if (inCursor === null) return null;
    } else if (inCursor === "") {
      return null;
    }
  } else if (!hits) {
    inCursor = findAlternateSpellMessage(mon.race.spellMsgs, spell.index, "miss");
    if (inCursor === null) {
      inCursor = level.missMessage || null;
      if (inCursor === null) return null;
    } else if (inCursor === "") {
      return null;
    }
  } else {
    inCursor = findAlternateSpellMessage(mon.race.spellMsgs, spell.index, "seen");
    if (inCursor === null) {
      inCursor = level.message || null;
      if (inCursor === null) return null;
    } else if (inCursor === "") {
      return null;
    }
  }

  const panel = deps.panelContains;
  const lashType = mon.race.blows[0]?.effect.lashType ?? null;
  const lashDesc = lashType ? (deps.lashDesc?.(lashType) ?? null) : null;

  /* Tag substitution (mon-spell.c L170-271). */
  let buf = "";
  let cursor = inCursor;
  let nextBrace = cursor.indexOf("{");
  let isLeading = nextBrace === 0;
  while (nextBrace >= 0) {
    /* Copy the text leading up to this {. */
    buf += cursor.slice(0, nextBrace);

    /* Find the end of the alphabetic tag name. */
    let s = nextBrace + 1;
    while (s < cursor.length && /[a-zA-Z]/.test(cursor[s]!)) s++;

    if (cursor[s] === "}") {
      const tag = cursor.slice(nextBrace + 1, s);
      cursor = cursor.slice(s + 1);
      /* The character immediately following the tag (for COMMA gating). */
      const followedByPunct = cursor.length > 0 && SPELL_PUNCT.includes(cursor[0]!);

      if (tag.startsWith("name")) {
        let mode = MDESC.IND_HID | MDESC.PRO_HID;
        if (isLeading) mode |= MDESC.CAPITAL;
        if (!followedByPunct) mode |= MDESC.COMMA;
        buf += monsterDesc(mon, mode, panel);
      } else if (tag.startsWith("pronoun")) {
        buf += monsterDesc(mon, MDESC.PRO_VIS | MDESC.POSS, panel);
      } else if (tag.startsWith("target")) {
        if (tMon) {
          let mode = MDESC_TARG;
          if (!followedByPunct) mode |= MDESC.COMMA;
          buf += monsterDesc(tMon, mode, panel);
        } else {
          buf += "you";
        }
      } else if (tag.startsWith("type")) {
        if (lashDesc) buf += lashDesc;
      } else if (tag.startsWith("oftype")) {
        if (lashDesc) buf += ` of ${lashDesc}`;
      }
      /* SPELL_TAG_NONE: an unrecognised tag contributes nothing. */
    } else {
      /* An invalid tag, skip the brace and continue. */
      cursor = cursor.slice(nextBrace + 1);
    }

    nextBrace = cursor.indexOf("{");
    isLeading = false;
  }
  buf += cursor;

  return { text: buf, msgt: spell.msgt };
}
