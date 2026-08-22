/**
 * The web shell's message log: the platform half of msg.c's message buffer.
 *
 * The core emits messages through the plain `state.msg` sink and per-command
 * `env.msg` hooks. This shell-side log is where every message the engine emits
 * during a turn is collected, with the core MSG type resolved to CSS at the
 * presentation boundary, so the player sees a colored scrollable history
 * instead of a single overwritten line.
 *
 * It keeps a rolling buffer (like message__buf) with duplicate run-length
 * squashing (msg "you hit it. <3x>"), surfaces the messages emitted since the
 * last render as the top status line, and feeds the full history screen.
 *
 * TWO RECORDS, BECAUSE UPSTREAM'S msg() DOES TWO SEPARATE JOBS. `message_add`
 * (message.c L124) collapses an identical repeat into a run-length count, so
 * the recall screen shows one entry reading "<5x>". `event_signal_message`
 * (message.c L444) fires UNCONDITIONALLY on the same call, so `display_message`
 * (ui-input.c L484) redraws the top line for every single occurrence and
 * paginates with "-more-" once the running column passes w - 8. Folding those
 * into one buffer is why a long dig used to tick a counter instead of pausing:
 * the top-line path never saw a repeat as an event at all. So `all()` is the
 * collapsed history and `rawSince()` is the uncollapsed event stream, and only
 * the history carries a count above 1.
 */

import { MSG } from "@rpgm-tools/neo-angband-core";
import type { MessageType } from "@rpgm-tools/neo-angband-core";

export interface LoggedMessage {
  text: string;
  /** CSS color; defaults applied by the renderer. */
  color?: string;
  /** Run-length count for repeated identical messages (message__count). */
  count: number;
}

const MAX_MESSAGES = 2048; // message_max, the upstream rolling cap.

/** Resolve an engine MSG_* name or number at the presentation boundary. */
export function messageTypeCode(type?: MessageType): number {
  if (typeof type === "number") return type;
  if (type === undefined) return MSG.GENERIC;
  const key = type.replace(/^MSG_/, "") as keyof typeof MSG;
  return MSG[key] ?? MSG.GENERIC;
}

/** Push a typed engine message with the core message.c color resolution. */
export function pushTypedMessage(
  log: MessageLog,
  text: string,
  type: MessageType | undefined,
  typeColor: (type: number) => number,
  colorToCss: (attr: number) => string,
): void {
  log.push(text, colorToCss(typeColor(messageTypeCode(type))));
}

export class MessageLog {
  private readonly buf: LoggedMessage[] = [];
  /** Every push as its own event (event_signal_message), never collapsed. */
  private readonly raw: LoggedMessage[] = [];
  /** Raw events already dropped by the rolling cap, so cursors stay absolute. */
  private rawBase = 0;
  /** Absolute raw cursor: events already consumed by `takeFresh()`. */
  private freshFrom = 0;

  /**
   * Record a message: append it to the raw event stream unconditionally, and
   * append it to the history buffer unless it repeats the previous entry, in
   * which case that entry's run count rises instead. The two halves of
   * upstream's msg() (message.c L440-444), kept apart.
   *
   * The repeat test compares text and COLOR where `message_add` compares text
   * and TYPE. It differs only for two distinct MSG types that share a color and
   * produce byte-identical text, which nothing in 4.2.6 does: the text is built
   * from the situation that chose the type.
   */
  push(text: string, color?: string): void {
    if (!text) return;
    this.raw.push(color === undefined ? { text, count: 1 } : { text, color, count: 1 });
    if (this.raw.length > MAX_MESSAGES) {
      const dropped = this.raw.length - MAX_MESSAGES;
      this.raw.splice(0, dropped);
      this.rawBase += dropped;
      if (this.freshFrom < this.rawBase) this.freshFrom = this.rawBase;
    }
    const last = this.buf[this.buf.length - 1];
    if (last && last.text === text && last.color === color) {
      last.count += 1;
      return;
    }
    this.buf.push(color === undefined ? { text, count: 1 } : { text, color, count: 1 });
    if (this.buf.length > MAX_MESSAGES) this.buf.splice(0, this.buf.length - MAX_MESSAGES);
  }

  /**
   * The most recent message's text, with no run count on it - message_str(0)
   * (message.c L182) returns the stored string, and the "<Nx>" form belongs to
   * the recall screen alone. This is what the top line and ^O
   * (do_cmd_message_one, ui-knowledge.c:3712) print.
   */
  latest(): string {
    return this.raw[this.raw.length - 1]?.text ?? "";
  }

  /** The single most recent event (for coloring the top line), or null. */
  latestEntry(): LoggedMessage | null {
    return this.raw[this.raw.length - 1] ?? null;
  }

  /**
   * How many raw events have ever been recorded: the absolute cursor a caller
   * snapshots before a command so it can page everything that command emits.
   */
  rawLength(): number {
    return this.rawBase + this.raw.length;
  }

  /**
   * The raw events from absolute cursor `from` onwards, oldest first: the set
   * `display_message` would have drawn, one entry per occurrence.
   */
  rawSince(from: number): readonly LoggedMessage[] {
    return this.raw.slice(Math.max(0, from - this.rawBase));
  }

  /**
   * Raw events since the previous call, oldest-first: the set to show (and,
   * when more than one, page through with -more-) for the current turn. Marks
   * them consumed so the next turn starts fresh.
   */
  takeFresh(): readonly LoggedMessage[] {
    const fresh = this.rawSince(this.freshFrom);
    this.freshFrom = this.rawLength();
    return fresh;
  }

  /** Mark all current events as seen without returning them. */
  markSeen(): void {
    this.freshFrom = this.rawLength();
  }

  /** The whole collapsed history, newest last (for the recall screen). */
  all(): readonly LoggedMessage[] {
    return this.buf;
  }
}

/** "text" or "text <Nx>" for a run of N identical messages (ui-knowledge.c "%s <%dx>"). */
export function format(m: LoggedMessage): string {
  return m.count > 1 ? `${m.text} <${m.count}x>` : m.text;
}

/**
 * Pack a turn's messages onto the top line the way display_message / msg_flush
 * do (ui-input.c L487-595): messages SHARE the top line, separated by a space,
 * until the next one would push the running column past (width - 8). At that
 * point the line so far is a completed "page" - upstream caps it with the
 * L_BLUE "-more-" prompt (msg_flush, L388-400) and waits for a keypress before
 * starting the next line. This returns the sequence of page strings; the caller
 * shows each and pauses with "-more-" BETWEEN pages (the final page just
 * persists on the top line, exactly as the last message does in play). When
 * auto_more (or a keymap's auto-more) is set, msg_flush skips the anykey(), so
 * the caller shows only the final page with no pauses.
 *
 * The threshold reproduces upstream's column arithmetic: message_column tracks
 * the next free column INCLUDING the trailing space after each message (column
 * += n + 1), and the overflow test is `message_column && message_column + n >
 * w - 8`. A single message longer than the line is not split further here (the
 * web top line truncates on render); upstream's intra-message split loop is the
 * only divergence, and it is cosmetic.
 *
 * `pendingFrom` is the index of the first message on the FINAL page, which is
 * the part `message_column` still holds when the caller stops. A self-continuing
 * command (a run, a repeated dig) does not reset that column between its steps,
 * because upstream clears `msg_flag` only when `textui_get_command` reads a key
 * (ui-input.c:1824). So a caller stepping through such a command re-packs from
 * `pendingFrom` on the next step, and the partial line grows until it overflows
 * and takes its "-more-" mid-run instead of all at once at the end.
 */
export interface PackedMessages {
  /** One string per page; the last one is still pending on the top line. */
  pages: string[];
  /** Index into `msgs` of the first message on that final, unflushed page. */
  pendingFrom: number;
}

export function packMessages(msgs: readonly LoggedMessage[], width: number): PackedMessages {
  const wrap = Math.max(1, width - 8); // upstream w - 8
  const pages: string[] = [];
  let line = "";
  let column = 0; // message_column: includes the trailing space per message
  let lineFrom = 0; // index of the first message on the line being built
  for (let i = 0; i < msgs.length; i++) {
    const text = format(msgs[i]!);
    const n = text.length;
    if (column > 0 && column + n > wrap) {
      pages.push(line);
      line = "";
      column = 0;
      lineFrom = i;
    }
    line = line === "" ? text : `${line} ${text}`;
    column += n + 1;
  }
  if (line !== "") pages.push(line);
  return { pages, pendingFrom: line === "" ? msgs.length : lineFrom };
}

/** `packMessages` when only the page strings are wanted. */
export function paginateMessages(msgs: readonly LoggedMessage[], width: number): string[] {
  return packMessages(msgs, width).pages;
}
