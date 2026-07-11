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
