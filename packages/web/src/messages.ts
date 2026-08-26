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
 * w - 8`.
 *
 * A single message longer than the line is split too, mirroring
 * display_message's own inner loop (ui-input.c L547-582): while the message
 * still overflows the line, cut it at the rightmost space that leaves room for
 * the "-more-" margin (never below the halfway column), push everything up to
 * the cut as its own page, and carry on with the rest as if it were the start
 * of a fresh line. A cut with no qualifying space falls back to a hard break at
 * the margin, exactly as upstream does. Left out of scope: msg_flush_split_existing
 * (ui-input.c L407-449), which re-splits an already-accumulated multi-message
 * line when a later, unrelated message pushes it over the "-more-" margin - the
 * accumulated line there is never truncated or corrupted, it is simply flushed
 * whole a little earlier than upstream would, which is cosmetic in the same way
 * upstream's own mid-word hard-cut placement is.
 *
 * `pendingFrom` names the first message on the FINAL page - the part
 * `message_column` still holds when the caller stops - and `pendingOffset` is
 * how many characters of THAT message's formatted text were already shown on a
 * page that already got its own "-more-" (0 unless the message itself was
 * split). Together they are a cursor that can land inside a message rather
 * than only at a message boundary: a caller resuming from `pendingFrom` passes
 * `pendingOffset` back in as `resumeOffset` so the still-unread tail is what
 * gets re-packed, not the whole message from its start again. A self-continuing
 * command (a run, a repeated dig) does not reset that column between its steps,
 * because upstream clears `msg_flag` only when `textui_get_command` reads a key
 * (ui-input.c:1824). So a caller stepping through such a command re-packs from
 * `pendingFrom`/`pendingOffset` on the next step, and the partial line grows
 * until it overflows and takes its "-more-" mid-run instead of all at once at
 * the end.
 */
export interface PackedMessages {
  /** One string per page; the last one is still pending on the top line. */
  pages: string[];
  /** Index into `msgs` of the first message on that final, unflushed page. */
  pendingFrom: number;
  /**
   * Characters of `msgs[pendingFrom]`'s formatted text already shown on an
   * earlier, already-"-more-"'d page. 0 unless that message was itself split.
   */
  pendingOffset: number;
}

export function packMessages(
  msgs: readonly LoggedMessage[],
  width: number,
  resumeOffset = 0,
): PackedMessages {
  const w8 = Math.max(1, width - 8); // upstream w - 8: room reserved for "-more-"
  const w1 = Math.max(1, width - 1); // upstream w - 1: the hard limit of a line
  const half = Math.max(0, Math.floor(width / 2)); // upstream w / 2: never split below here
  const pages: string[] = [];
  let line = "";
  let column = 0; // message_column: includes the trailing space per message
  let lineFromIndex = 0; // index of the first message on the line being built
  let lineFromOffset = resumeOffset; // its already-shown prefix, if it is a resumed split

  for (let i = 0; i < msgs.length; i++) {
    const full = format(msgs[i]!);
    // Only msgs[0] can be a resumption: everything after it is unseen so far.
    const baseOffset = i === 0 ? Math.min(resumeOffset, full.length) : 0;
    let t = full.slice(baseOffset);
    if (t === "") continue; // a resume offset that exactly exhausted the message
    let n = t.length;

    // This message would overflow the line as it stands: flush what is there
    // first (display_message ui-input.c L518-529, simple-flush branch).
    if (column > 0 && column + n > w8) {
      if (line !== "") pages.push(line);
      line = "";
      column = 0;
      lineFromIndex = i;
      lineFromOffset = baseOffset;
    }

    // The message itself is longer than a line: cut it as many times as it
    // takes, at the rightmost space in reach (ui-input.c L547-582).
    while (column + n > w1) {
      let split = Math.max(w8 - column, 0);
      if (split <= 0) split = 1; // always make progress, even at a tiny width
      const searchFloor = Math.max(half - column, 0);
      let check = split;
      while (check > searchFloor) {
        check--;
        if (t[check] === " ") {
          split = check;
          break;
        }
      }
      const shown = t.slice(0, split);
      line = column === 0 ? shown : `${line} ${shown}`;
      pages.push(line);
      // Skip the space itself when the cut landed on one (so the continuation
      // does not start with a stray blank column); a hard cut with no
      // qualifying space keeps every character - nothing upstream would show
      // is lost here, unlike the mid-word single-char casualty of upstream's
      // own pointer trick (see the file header comment for why that is not
      // reproduced).
      t = t.slice(t[split] === " " ? split + 1 : split);
      n = t.length;
      line = "";
      column = 0;
      lineFromIndex = i;
      lineFromOffset = full.length - t.length;
    }

    line = column === 0 ? t : `${line} ${t}`;
    column += n + 1;
  }
  if (line !== "") pages.push(line);
  return {
    pages,
    pendingFrom: line === "" ? msgs.length : lineFromIndex,
    pendingOffset: line === "" ? 0 : lineFromOffset,
  };
}

/** `packMessages` when only the page strings are wanted. */
export function paginateMessages(msgs: readonly LoggedMessage[], width: number): string[] {
  return packMessages(msgs, width).pages;
}
