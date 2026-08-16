/**
 * Monster message grammar, ported from reference/src/mon-msg.c (Angband 4.2.6):
 * get_subject, get_message_text and the pain-code selection of message_pain /
 * get_pain_msg_code. This is the display-layer (#25) piece that turns the
 * MON_MSG_* codes the projection emits ("the kobold dies", "shrugs off the
 * attack", "wakes up") into finished sentences, and the mon_msg[] QUEUE those
 * sentences are stacked in until notice_stuff flushes them.
 *
 * The queue is the whole point of the file upstream, and it is what makes the
 * output read like Angband: ten kobolds hit by one breath produce "10 kobolds
 * die." rather than ten identical lines, a monster that takes two hits in one
 * projection is named once, and deaths are held back until last. Nothing here
 * emits at its call site - add_monster_message stacks and raises
 * PN_MON_MESSAGE, and show_monster_messages (game/notice.ts) drains it.
 */

import { MON_MESSAGE_ENTRIES, MON_MSG, MSG, RF } from "../generated/index.js";
import type { Loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import type { MonsterAltMsg, MonsterRace, MonsterSpell } from "../mon/types.js";
import { MDESC, MDESC_TARG, monsterDesc, pluralAux } from "../mon/desc.js";
import { monsterIsObvious } from "../mon/predicate.js";
import { PN } from "../player/types.js";
import type { GameState } from "./context.js";

/**
 * get_message_text's bracket state machine (mon-msg.c L376): "[a|b]" selects a
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
 * get_subject (mon-msg.c L320): the sentence subject for a monster message
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
 * show_message's text (mon-msg.c L471) for one queue entry: the subject (unless
 * the code omits it) followed by the singular-or-plural body. Returns null when
 * the code has no text at all - MON_MSG_NONE and any entry whose template is
 * empty - which upstream cannot express (it msgt()s the empty string) and the
 * port uses to mean "say nothing".
 */
function messageText(
  race: MonsterRace,
  msgCode: number,
  count: number,
  invisible: boolean,
  offscreen: boolean,
): string | null {
  const entry = MON_MESSAGE_ENTRIES[msgCode];
  if (!entry) return null;
  const body = resolveBrackets(sourceText(race, msgCode), count > 1);
  if (!body) return null;
  const subject = entry.omitSubject
    ? ""
    : subjectOf(race, count, invisible, offscreen);
  return subject + body;
}

/**
 * Format a MON_MSG code into a finished sentence for one visible, on-screen
 * monster. The queue is what the game uses; this is the count == 1 shorthand
 * for callers that are not going through it - the knowledge/lore screens and
 * the tests that pin the grammar.
 */
export function formatMonsterMessage(mon: Monster, msgCode: number): string | null {
  return messageText(mon.race, msgCode, 1, false, false);
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

/**
 * KEPT FOR MODS, NOT USED BY CORE. These four formatted a line and handed it
 * straight back for the caller to print, which is how the port emitted monster
 * messages before the mon_msg[] queue existed (PORT_TODO 3.1). Core now stacks
 * instead - addMonsterMessage / messagePain and their show-damage twins - but a
 * plugin that only wants the SENTENCE (a HUD, a log exporter, a Borg reading
 * what it just did) still has no other way to get one, and packages/web/src
 * mod-core-surface.test.ts is the promise that a name a plugin calls does not
 * vanish under it. Deliberate public surface; not dead code.
 */
export function formatMonsterMessageShowDamage(
  mon: Monster,
  msgCode: number,
  damage: number,
): string | null {
  const base = formatMonsterMessage(mon, msgCode);
  return base === null ? null : `${base} (${damage})`;
}

/** message_pain's sentence (mon-msg.c L123), unqueued. See above. */
export function formatPainMessage(mon: Monster, dam: number): string | null {
  return formatMonsterMessage(mon, painMessageCode(mon, dam));
}

/** message_pain_show_damage's sentence (mon-msg.c L132), unqueued. See above. */
export function formatPainMessageShowDamage(
  mon: Monster,
  dam: number,
): string | null {
  const code = painMessageCode(mon, dam);
  if (dam > 0) return formatMonsterMessageShowDamage(mon, code, dam);
  return formatMonsterMessage(mon, code);
}

/** A MON_MSG_* name's sentence (mon/timed.ts's note form), unqueued. */
export function formatMonsterMessageByName(
  mon: Monster,
  note: string,
): string | null {
  const code = monMessageCodeByName(note);
  return code === null ? null : formatMonsterMessage(mon, code);
}

/**
 * The timed layer names its message as a MON_MSG_* string rather than an index
 * (mon/timed.ts, from monster_timed_effect's `m_note`): resolve it to a code,
 * or null for an unknown / empty name.
 */
export function monMessageCodeByName(note: string): number | null {
  const key = note.replace(/^MON_MSG_/, "") as keyof typeof MON_MSG;
  const code = MON_MSG[key];
  return typeof code === "number" ? code : null;
}

/**
 * get_message_type (mon-msg.c L450): the MSG_* sound type for a monster message
 * code (MSG_KILL for deaths, MSG_GENERIC for the rest). Upstream then refines
 * MSG_KILL for a unique: MSG_KILL_KING when its base is Morgoth's, else
 * MSG_KILL_UNIQUE (mon-msg.c L454-463). `race` is optional only so the older
 * race-less callers keep compiling; pass it to get the unique sounds.
 *
 * The upstream check is `race->base == lookup_monster_base("Morgoth")`
 * (mon-util.c:146, a name lookup over the unique-per-name rb_info list), so
 * comparing the bound base's name is the same test.
 */
export function monMessageSoundType(
  msgCode: number,
  race?: MonsterRace,
): number {
  const name = MON_MESSAGE_ENTRIES[msgCode]?.msgType ?? "MSG_GENERIC";
  const key = name.replace(/^MSG_/, "") as keyof typeof MSG;
  let type = MSG[key] ?? MSG.GENERIC;
  if (type === MSG.KILL && race && race.flags.has(RF.UNIQUE)) {
    type = race.base.name === "Morgoth" ? MSG.KILL_KING : MSG.KILL_UNIQUE;
  }
  return type;
}

/* ------------------------------------------------------------------ */
/* The mon_msg[] queue (mon-msg.c L207-311, L505-525)                  */
/* ------------------------------------------------------------------ */

/** MAX_STORED_MON_MSG / MAX_STORED_MON_CODES (mon-msg.c L30-31). */
const MAX_STORED_MON_MSG = 200;
const MAX_STORED_MON_CODES = 400;

/** C's INT_MAX / INT_MIN, which stack_message saturates the damage total at. */
const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/**
 * MON_MSG_FLAG_* (mon-msg.c L38-40). Part of the stacking KEY, not just
 * presentation: two monsters of one race combine into a counted line only if
 * they are both offscreen or both on, both obvious or both not.
 */
export const MON_MSG_FLAG = {
  OFFSCREEN: 0x01,
  INVISIBLE: 0x02,
  DAMAGE: 0x04,
} as const;

/** struct monster_race_message (mon-msg.c L45). */
interface MonRaceMessage {
  race: MonsterRace;
  flags: number;
  msgCode: number;
  count: number;
  /** what_delay's bucket: 0 immediate, 1 delayed, 2 deaths. */
  delay: number;
  damage: number;
}

/**
 * The per-game queue: mon_msg[] plus the mon_message_hist[] duplicate log.
 *
 * Upstream these are FILE STATICS, and a WeakMap keyed on the GameState is the
 * closest thing to that which two games in one process can both have - the same
 * shape mon-death.ts uses for its non-player-hit deps. Deliberately not a
 * GameState field and deliberately not serialised: `size_mon_msg` is transient
 * within a turn, and every path that fills it drains it before the player is
 * asked for input.
 */
interface MonMsgQueue {
  msgs: MonRaceMessage[];
  hist: { mon: Monster; msgCode: number }[];
}

const QUEUES = new WeakMap<GameState, MonMsgQueue>();

function queueOf(state: GameState): MonMsgQueue {
  let q = QUEUES.get(state);
  if (!q) {
    q = { msgs: [], hist: [] };
    QUEUES.set(state, q);
  }
  return q;
}

/**
 * message_flags (mon-msg.c L167).
 *
 * `panelContains` is the viewport test, and NOTHING SUPPLIES IT YET - the port's
 * camera lives in the web shell (packages/web/src/main.ts viewport()), not in
 * core, so the default here says "on screen" and the "(offscreen)" tag never
 * appears. That is a real remaining gap, recorded as such rather than hidden:
 * the mechanism is faithful and one binding closes it.
 */
function messageFlags(state: GameState, mon: Monster): number {
  let flags = 0;
  if (!(state.panelContains?.(mon.grid) ?? true)) flags |= MON_MSG_FLAG.OFFSCREEN;
  if (!monsterIsObvious(mon)) flags |= MON_MSG_FLAG.INVISIBLE;
  return flags;
}

/** store_monster (mon-msg.c L185): log the pair for duplicate checking. */
function storeMonster(q: MonMsgQueue, mon: Monster, msgCode: number): void {
  if (q.hist.length < MAX_STORED_MON_CODES) q.hist.push({ mon, msgCode });
}

/**
 * redundant_monster_message (mon-msg.c L147): has THIS monster already produced
 * THIS code since the last flush? Upstream's reason is monster-versus-monster
 * splash damage hitting one monster twice in a single projection; the effect is
 * that a monster is never described twice for the same thing in one breath.
 */
function redundantMonsterMessage(
  q: MonMsgQueue,
  mon: Monster,
  msgCode: number,
): boolean {
  return q.hist.some((h) => h.mon === mon && h.msgCode === msgCode);
}

/** stack_message (mon-msg.c L200): fold into an existing line, or fail. */
function stackMessage(
  q: MonMsgQueue,
  mon: Monster,
  msgCode: number,
  flags: number,
  damage: number,
): boolean {
  for (const msg of q.msgs) {
    if (msg.race !== mon.race || msg.flags !== flags || msg.msgCode !== msgCode) {
      continue;
    }
    msg.count++;
    if (flags & MON_MSG_FLAG.DAMAGE) {
      /* Saturating add (L211-229). C has to write this out because signed
       * overflow is undefined; the port has to write it out because a total
       * past 2^31 would otherwise print a number no C build could. */
      if (damage >= 0) {
        msg.damage =
          msg.damage <= 0 || msg.damage < INT_MAX - damage
            ? msg.damage + damage
            : INT_MAX;
      } else {
        msg.damage =
          msg.damage >= 0 || msg.damage > INT_MIN - damage
            ? msg.damage + damage
            : INT_MIN;
      }
    }
    storeMonster(q, mon, msgCode);
    return true;
  }
  return false;
}

/**
 * what_delay (mon-msg.c L238): which of the three passes a line belongs to.
 * Deaths always go last, so a breath that kills half a pit reads "N kobolds
 * cower in fear." before "M kobolds die." however the projection ordered them.
 */
function whatDelay(msgCode: number, delay: boolean): number {
  if (msgCode === MON_MSG.DIE || msgCode === MON_MSG.DESTROYED) return 2;
  return delay ? 1 : 0;
}

function pushMessage(
  state: GameState,
  mon: Monster,
  msgCode: number,
  flags: number,
  delay: boolean,
  damage: number,
): boolean {
  const q = queueOf(state);
  if (
    redundantMonsterMessage(q, mon, msgCode) ||
    stackMessage(q, mon, msgCode, flags, damage) ||
    q.msgs.length >= MAX_STORED_MON_MSG
  ) {
    return false;
  }
  q.msgs.push({
    race: mon.race,
    flags,
    msgCode,
    count: 1,
    delay: whatDelay(msgCode, delay),
    damage,
  });
  storeMonster(q, mon, msgCode);
  state.actor.player.upkeep.notice |= PN.MON_MESSAGE;
  return true;
}

/**
 * add_monster_message (mon-msg.c L252): stack a codified message for a monster
 * and raise PN_MON_MESSAGE. Returns true when a NEW line was created (upstream's
 * return value; a stack or a duplicate returns false).
 *
 * `delay` is upstream's "hold this until the second pass" hint - the fear lines
 * use it so "The kobold flees in terror!" follows the blow that caused it
 * rather than interleaving with other monsters' reactions.
 */
export function addMonsterMessage(
  state: GameState,
  mon: Monster,
  msgCode: number,
  delay: boolean,
): boolean {
  return pushMessage(state, mon, msgCode, messageFlags(state, mon), delay, 0);
}

/**
 * add_monster_message_show_damage (mon-msg.c L288): the same, carrying a damage
 * total that show_message renders as " (N)" for one monster and " (average N)"
 * once several stacked. Only reached under OPT(player, show_damage).
 */
export function addMonsterMessageShowDamage(
  state: GameState,
  mon: Monster,
  msgCode: number,
  delay: boolean,
  damage: number,
): boolean {
  const flags = messageFlags(state, mon) | MON_MSG_FLAG.DAMAGE;
  return pushMessage(state, mon, msgCode, flags, delay, damage);
}

/** message_pain (mon-msg.c L123): queue the graded "it is hurt" line. */
export function messagePain(state: GameState, mon: Monster, dam: number): void {
  addMonsterMessage(state, mon, painMessageCode(mon, dam), false);
}

/**
 * message_pain_show_damage (mon-msg.c L132). Upstream only takes the
 * show-damage branch when dam > 0, so MON_MSG_UNHARMED never carries a " (0)".
 */
export function messagePainShowDamage(
  state: GameState,
  mon: Monster,
  dam: number,
): void {
  const code = painMessageCode(mon, dam);
  if (dam > 0) addMonsterMessageShowDamage(state, mon, code, false, dam);
  else addMonsterMessage(state, mon, code, false);
}

/** show_message (mon-msg.c L471) for one entry, or null if it has no text. */
function showMessage(state: GameState, msg: MonRaceMessage): void {
  const msgType = monMessageSoundType(msg.msgCode, msg.race);
  const text = messageText(
    msg.race,
    msg.msgCode,
    msg.count,
    !!(msg.flags & MON_MSG_FLAG.INVISIBLE),
    !!(msg.flags & MON_MSG_FLAG.OFFSCREEN),
  );
  if (text === null) return;
  let line = text;
  if (msg.flags & MON_MSG_FLAG.DAMAGE) {
    if (msg.count <= 1) {
      line = `${text} (${msg.damage})`;
    } else {
      /* Rounded mean (L497-501), in C integer arithmetic: truncating divide
       * plus one when the remainder is at least half a share. */
      const share = Math.trunc(msg.damage / msg.count);
      const rem = msg.damage - share * msg.count;
      const half = Math.trunc((msg.count + 1) / 2);
      line = `${text} (average ${share + (rem >= half ? 1 : 0)})`;
    }
  }
  state.msg?.(line, msgType);
}

/**
 * show_monster_messages (mon-msg.c L511): emit every stacked line in delay
 * order, then clear the queue AND the duplicate history. Called only from
 * noticeStuff's PN_MON_MESSAGE branch and from the port's player_kill_monster
 * analogue, which flushes so the kill line lands after the pain it caused.
 */
export function showMonsterMessages(state: GameState): void {
  const q = QUEUES.get(state);
  if (!q) return;
  for (let delay = 0; delay < 3; delay++) {
    for (const msg of q.msgs) {
      if (msg.delay === delay) showMessage(state, msg);
    }
  }
  q.msgs.length = 0;
  q.hist.length = 0;
}

/**
 * The queue's pending lines, for tests and for the agent API's turn digest.
 * Returns the live entries; callers must not mutate them.
 */
export function pendingMonsterMessages(
  state: GameState,
): readonly Readonly<MonRaceMessage>[] {
  return QUEUES.get(state)?.msgs ?? [];
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
