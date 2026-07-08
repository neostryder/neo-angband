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
 * Not ported here: message_lookup_by_name / by_sound_name (they need the
 * generated list-message table; they land with the pref-file loader).
 * C's printf-style formatting is dropped; callers use template strings.
 */

import type { GameEvents } from "./events";

/** COLOUR_DARK and COLOUR_WHITE from z-color.h. */
export const COLOUR_DARK = 0;
export const COLOUR_WHITE = 1;

/** MSG_GENERIC: the default message type (index 0 of list-message.h). */
export const MSG_GENERIC = 0;

interface LogEntry {
  str: string;
  type: number;
  count: number;
}

/** The rolling message memory (msgqueue_t). */
export class MessageLog {
  /** Newest first, index 0 = age 0 (upstream walks head -> older). */
  private entries: LogEntry[] = [];
  private colors = new Map<number, number>();

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
export const MSG_BELL = 1;

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

  /** sound: EVENT_SOUND only, gated by the use_sound option. */
  sound(type: number): void {
    if (!this.soundEnabled()) return;
    this.events.emit("sound", { msg: "", type });
  }

  /** bell: EVENT_BELL. */
  bell(): void {
    this.events.emit("bell", { msg: "", type: MSG_BELL });
  }
}
