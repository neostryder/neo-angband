/**
 * Message handling, ported from reference/src/message.c and message.h
 * (Angband 4.2.6).
 *
 * MessageLog stores the rolling log (most recent first, duplicate
 * squashing with counts, capacity 2048). Messages is the engine-facing
 * facade: msg()/msgt() add to the log and signal the event bus; sound()
 * and bell() are event-only. Message types are numeric MSG_* indices
 * (the generated list-message module supplies names); colors are numeric
 * COLOUR_* indices as upstream.
 *
 * Not in THIS module: message_lookup_by_name / by_sound_name are ported in
 * sound/engine.ts (L77) because they need the
 * generated list-message table; they land with the pref-file loader).
 * C's printf-style formatting is dropped; callers use template strings.
 */

import { colorCharToAttr, COLOUR_DARK, COLOUR_WHITE } from "./color.js";
import { MSG } from "./generated/message.js";
import type { GameEvents } from "./events.js";

/** A message type as it appears at engine call sites or after codegen. */
export type MessageType = number | string;

/** MSG_GENERIC: the default message type (index 0 of list-message.h). */
export const MSG_GENERIC = 0;

/**
 * message.prf:103,115,196: these are the three non-white default message
 * colours. All other listed defaults are `w`, so message.c:269-285's white
 * fallback gives the same result without duplicating a 100-line table.
 */
const DEFAULT_MESSAGE_COLORS = new Map<number, number>([
  [MSG.BELL, colorCharToAttr("o")],
  [MSG.HITPOINT_WARN, colorCharToAttr("o")],
  [MSG.AFRAID, colorCharToAttr("o")],
]);

interface LogEntry {
  str: string;
  type: number;
  count: number;
}

/** The rolling message memory (msgqueue_t). */
export class MessageLog {
  /** Newest first, index 0 = age 0 (upstream walks head -> older). */
  private entries: LogEntry[] = [];
  // message.c:269-285: message types start with their loaded defaults and
  // an explicit COLOUR_DARK remains the unset/white sentinel.
  private colors = new Map(DEFAULT_MESSAGE_COLORS);

  constructor(private max = 2048) {}

  /** messages_num. */
  num(): number {
    return this.entries.length;
  }

  /**
   * message_add: append, or bump the count when identical to the newest
   * entry (count saturates at 0xFFFF exactly like the uint16_t check).
   */
  add(str: string, type: number): void {
    const head = this.entries[0];
    if (head && head.type === type && head.str === str && head.count !== 0xffff) {
      head.count++;
      return;
    }
    this.entries.unshift({ str, type, count: 1 });
    if (this.entries.length > this.max) this.entries.pop();
  }

  /** message_str: text of the message of the given age ("" if absent). */
  str(age: number): string {
    return this.entries[age]?.str ?? "";
  }

  /** message_count: repeat count of the message of the given age. */
  count(age: number): number {
    return this.entries[age]?.count ?? 0;
  }

  /** message_type. */
  type(age: number): number {
    return this.entries[age]?.type ?? 0;
  }

  /** message_color. */
  color(age: number): number {
    const e = this.entries[age];
    return e ? this.typeColor(e.type) : COLOUR_WHITE;
  }

  /** message_color_define. */
  colorDefine(type: number, color: number): void {
    this.colors.set(type, color);
  }

  /** message_type_color: COLOUR_DARK means "unset" and yields white. */
  typeColor(type: number): number {
    const c = this.colors.get(type);
    return c !== undefined && c !== COLOUR_DARK ? c : COLOUR_WHITE;
  }
}

/** MSG_BELL index in list-message.h; bell() signals with this type. */
export const MSG_BELL = MSG.BELL;

/**
 * Resolve a MSG_* name or index to its numeric code, accepting either spelling
 * ("SHOOT_HIT", "MSG_SHOOT_HIT", 42) and defaulting to MSG_GENERIC.
 *
 * Core's own answer, because core needs it: this used to exist only in the web
 * shell (web/messages.ts) while five core modules open-coded
 * `(MSG as Record<string, number>)[name] ?? 0` inline.
 */
export function messageTypeCode(type?: MessageType): number {
  if (typeof type === "number") return type;
  if (type === undefined) return MSG_GENERIC;
  const key = type.replace(/^MSG_/, "") as keyof typeof MSG;
  return MSG[key] ?? MSG_GENERIC;
}

/**
 * The two sinks msgt drives. Declared structurally so GameState satisfies it
 * without this module importing game/context.ts (which imports this one).
 */
export interface MessageSinks {
  msg?: (text: string, type?: MessageType) => void;
  sound?: (type: number) => void;
}

/**
 * msgt (message.c:428): print a message AND play the sound its type names.
 *
 * The pair is the whole reason upstream has this function - `msg()` is the
 * silent one - and the port had been spelling it out at thirteen call sites
 * instead. Predictably, some sites wrote only the first half: every teleport
 * in the game (PORT_TODO 3.26) printed its line and played nothing, and the
 * MSG_TELEPORT / MSG_TPOTHER / MSG_TPLEVEL codes sat in the generated table
 * with no caller at all.
 *
 * `Messages.msgt` below is the same C function ported against the event-bus
 * facade. That facade has no production caller - the live message path is the
 * shell's `state.msg` binding, which also runs the mod messageText hook and
 * the renderer - so this free function is the one the game uses.
 *
 * ONE ORDERING DIVERGENCE: upstream is message_add, sound, then the display
 * event; the port's `state.msg` does the add and the event together, so sound
 * cannot land between them. It goes after, which keeps the log order (what
 * Ctrl-P shows) exact and moves the sound event one slot later on the bus.
 */
export function msgt(
  sinks: MessageSinks,
  type: MessageType,
  text: string,
): void {
  sinks.msg?.(text, type);
  sinks.sound?.(messageTypeCode(type));
}

/**
 * The msg()/msgt()/sound()/bell() facade: adds to the log and signals the
 * event bus, honoring the use_sound option via an injected getter.
 */
export class Messages {
  constructor(
    readonly log: MessageLog,
    private events: GameEvents,
    private soundEnabled: () => boolean = () => false,
  ) {}

  /** msg: log with MSG_GENERIC and signal EVENT_MESSAGE. */
  msg(text: string): void {
    this.log.add(text, MSG_GENERIC);
    this.events.emit("message", { msg: text, type: MSG_GENERIC });
  }

  /** msgt: log with a type, make the type's sound, signal EVENT_MESSAGE. */
  msgt(type: number, text: string): void {
    this.log.add(text, type);
    this.sound(type);
    this.events.emit("message", { msg: text, type });
  }

  /**
   * sound: EVENT_SOUND only, gated by the use_sound option. The payload's
   * message is null, not "" -- message.c:374 passes NULL.
   */
  sound(type: number): void {
    if (!this.soundEnabled()) return;
    this.events.emit("sound", { msg: null, type });
  }

  /** bell: EVENT_BELL, likewise with a NULL message (message.c:381). */
  bell(): void {
    this.events.emit("bell", { msg: null, type: MSG_BELL });
  }
}
