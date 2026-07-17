/**
 * The web shell's message log: the platform half of msg.c's message buffer.
 *
 * The core emits messages through the plain `state.msg` sink and per-command
 * `env.msg` hooks (a typed msg.ts MessageLog + GameEvents bus exists in core but
 * the live turn loop does not route through it yet - that seam is a separate
 * task that also unlocks first-class typed sound). Until then this shell-side
 * log is where every message the engine emits during a turn is collected, so
 * the player sees a scrollable history instead of a single overwritten line.
 *
 * It keeps a rolling buffer (like message__buf) with duplicate run-length
 * squashing (msg "you hit it. (x3)"), surfaces the messages emitted since the
 * last render as the top status line, and feeds the full history screen.
 */

export interface LoggedMessage {
  text: string;
  /** CSS color; defaults applied by the renderer. */
  color?: string;
  /** Run-length count for repeated identical messages (message__count). */
  count: number;
}

const MAX_MESSAGES = 2048; // message_max, the upstream rolling cap.

export class MessageLog {
  private readonly buf: LoggedMessage[] = [];
  /** Count of messages appended since the last `takeFresh()` (this turn). */
  private freshFrom = 0;

  /** Append a message, squashing an immediate duplicate into a (xN) run. */
  push(text: string, color?: string): void {
    if (!text) return;
    const last = this.buf[this.buf.length - 1];
    if (last && last.text === text && last.color === color) {
      last.count += 1;
      return;
    }
    this.buf.push(color === undefined ? { text, count: 1 } : { text, color, count: 1 });
    if (this.buf.length > MAX_MESSAGES) {
      const dropped = this.buf.length - MAX_MESSAGES;
      this.buf.splice(0, dropped);
      this.freshFrom = Math.max(0, this.freshFrom - dropped);
    }
  }

  /** The most recent message, formatted with its run count, or "". */
  latest(): string {
    const m = this.buf[this.buf.length - 1];
    return m ? format(m) : "";
  }

  /** The single most recent LoggedMessage (for coloring the top line), or null. */
  latestEntry(): LoggedMessage | null {
    return this.buf[this.buf.length - 1] ?? null;
  }

  /**
   * Messages appended since the previous call, oldest-first: the set to show
   * (and, when more than one, page through with -more-) for the current turn.
   * Marks them consumed so the next turn starts fresh.
   */
  takeFresh(): LoggedMessage[] {
    const fresh = this.buf.slice(this.freshFrom);
    this.freshFrom = this.buf.length;
    return fresh;
  }

  /** Mark all current messages as seen without returning them. */
  markSeen(): void {
    this.freshFrom = this.buf.length;
  }

  /** The whole history, newest last (for the recall screen). */
  all(): readonly LoggedMessage[] {
    return this.buf;
  }
}

/** "text" or "text (xN)" for a run of N identical messages. */
export function format(m: LoggedMessage): string {
  return m.count > 1 ? `${m.text} (x${m.count})` : m.text;
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
 */
export function paginateMessages(msgs: readonly LoggedMessage[], width: number): string[] {
  const wrap = Math.max(1, width - 8); // upstream w - 8
  const pages: string[] = [];
  let line = "";
  let column = 0; // message_column: includes the trailing space per message
  for (const m of msgs) {
    const text = format(m);
    const n = text.length;
    if (column > 0 && column + n > wrap) {
      pages.push(line);
      line = "";
      column = 0;
    }
    line = line === "" ? text : `${line} ${text}`;
    column += n + 1;
  }
  if (line !== "") pages.push(line);
  return pages;
}
