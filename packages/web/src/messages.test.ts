import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorToCss, COLOUR_ORANGE, MessageLog as CoreMessageLog, MSG } from "@rpgm-tools/neo-angband-core";
import {
  MessageLog,
  messageTypeCode,
  packMessages,
  paginateMessages,
  pushTypedMessage,
  format,
} from "./messages";
import { messageHistoryLines } from "./screens";

/**
 * paginateMessages ports display_message / msg_flush (ui-input.c L385-595): a
 * turn's messages share the top line until the running column would pass
 * (width - 8), at which point the line so far becomes a "page" upstream caps
 * with a "-more-" prompt. The final page just persists on the top line.
 */
describe("paginateMessages (-more- packing, ui-input.c display_message)", () => {
  const m = (text: string, count = 1) => ({ text, count });

  it("keeps messages that fit on one line as a single page (no -more-)", () => {
    const pages = paginateMessages([m("You hit it."), m("It dies.")], 80);
    expect(pages).toEqual(["You hit it. It dies."]);
  });

  it("returns one page per message when each fills the line", () => {
    // width 20 -> wrap at 12. "aaaaaaaa" (8) then " bbbbbbbb" would push the
    // column (8+1 + 8 = 17) past 12, so it starts a new page.
    const pages = paginateMessages([m("aaaaaaaa"), m("bbbbbbbb")], 20);
    expect(pages).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    // Only the boundary between pages carries a -more- pause; pages.length-1 = 1.
    expect(pages.length - 1).toBe(1);
  });

  it("packs as many messages onto a line as fit before breaking", () => {
    // width 24 -> wrap 16. "ab"(2) "cd"(col 3+2=5) "ef"(6+2=8) fit; "ghijkl"(6)
    // would be col 9+6=15 <= 16 so it fits too; a 7th "mnop" (16+4=20 > 16)
    // breaks to a new page.
    const pages = paginateMessages(
      [m("ab"), m("cd"), m("ef"), m("ghijkl"), m("mnop")],
      24,
    );
    expect(pages).toEqual(["ab cd ef ghijkl", "mnop"]);
  });

  it("no messages -> no pages (nothing to flush)", () => {
    expect(paginateMessages([], 80)).toEqual([]);
  });

  it("draws its fresh set from the raw event stream (advance's cursor)", () => {
    const log = new MessageLog();
    log.push("old line");
    const preLen = log.rawLength(); // snapshot before the "turn"
    log.push("You hit the orc.");
    log.push("The orc dies.");
    const fresh = log.rawSince(preLen);
    expect(paginateMessages(fresh, 80)).toEqual(["You hit the orc. The orc dies."]);
  });

  it("reports where the still-pending final page starts (message_column carry)", () => {
    // width 20 -> wrap 12. "aaaaaaaa" then "bbbbbbbb" breaks; the second is the
    // pending line upstream leaves on row 0 with no -more- after it.
    const packed = packMessages([m("aaaaaaaa"), m("bbbbbbbb")], 20);
    expect(packed.pages).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(packed.pendingFrom).toBe(1);
  });
});

/**
 * The defect this pins: upstream's msg() runs message_add (message.c L124,
 * which collapses an identical repeat into a run-length count) and
 * event_signal_message (message.c L444, which fires UNCONDITIONALLY) as two
 * separate jobs. display_message therefore redraws the top line for every
 * single occurrence and paginates once the running column passes w - 8, while
 * the recall screen shows one entry with "<Nx>".
 */
describe("a long repeated action (message_add vs event_signal_message)", () => {
  // 26 chars. A swarm biting a resting character emits this once per bite, and
  // several land in the same game turn.
  const BITE = "The cave spider bites you.";
  const repeat = (log: MessageLog, n: number): void => {
    for (let i = 0; i < n; i++) log.push(BITE);
  };

  it("collapses the history to one entry with the run count (message_add)", () => {
    const log = new MessageLog();
    repeat(log, 5);
    expect(log.all()).toHaveLength(1);
    expect(log.all()[0]!.count).toBe(5);
    expect(format(log.all()[0]!)).toBe(`${BITE} <5x>`);
  });

  it("keeps every occurrence as its own top-line event (event_signal_message)", () => {
    const log = new MessageLog();
    const cursor = log.rawLength();
    repeat(log, 5);
    const fresh = log.rawSince(cursor);
    expect(fresh).toHaveLength(5);
    expect(fresh.every((e) => e.count === 1)).toBe(true);
  });

  it("pages the repeats the way display_message does, not as one <Nx> line", () => {
    const log = new MessageLog();
    const cursor = log.rawLength();
    repeat(log, 5);
    // width 80 -> wrap 72. col 0 -> 27; 27+26=53 fits -> 54; 54+26=80 > 72, so
    // the third breaks. Two 26-char messages share a line and every third
    // starts a new page: 5 repeats are 3 pages, hence 2 "-more-" pauses.
    const pages = paginateMessages(log.rawSince(cursor), 80);
    expect(pages).toEqual([`${BITE} ${BITE}`, `${BITE} ${BITE}`, BITE]);
    expect(pages.length - 1).toBe(2); // -more- pauses
  });

  it("never puts a <Nx> count on the top line (message_str(0) has no count)", () => {
    const log = new MessageLog();
    repeat(log, 5);
    // do_cmd_message_one prints `format("> %s", message_str(0))`
    // (ui-knowledge.c:3712), and message_str returns the stored text alone.
    expect(log.latest()).toBe(BITE);
    expect(paginateMessages(log.rawSince(0), 80).join(" ")).not.toContain("<5x>");
  });

  /**
   * The cadence across the steps of a self-continuing command. Upstream resets
   * `message_column` only where `msg_flag` is cleared, and a run, a rest or a
   * pathfind reaches neither of the two places that do it: `textui_get_command`
   * (ui-input.c:1824) needs a key, and `repeated_command_display`
   * (ui-display.c:2495) needs `cmd_get_nrepeats() > 0`, which those commands
   * never have (auto_repeat_n 0, cmd-core.c L77/89/91). So the pending partial
   * line carries into the next step and the "-more-" fires the moment the
   * running column overflows, not once at the end.
   */
  it("carries the pending line across the steps of a run or a rest", () => {
    const log = new MessageLog();
    let cursor = log.rawLength(); // reset once, at the keypress that started it
    let pauses = 0;
    const lines: string[] = [];
    for (let step = 0; step < 5; step++) {
      log.push(BITE); // one engine step
      const fresh = log.rawSince(cursor);
      const { pages, pendingFrom } = packMessages(fresh, 80);
      pauses += pages.length - 1; // one -more- per completed page
      lines.push(pages[pages.length - 1] ?? "");
      cursor += pendingFrom; // only the unflushed tail stays pending
    }
    expect(pauses).toBe(2);
    expect(lines).toEqual([BITE, `${BITE} ${BITE}`, BITE, `${BITE} ${BITE}`, BITE]);
    // and the history is still one collapsed entry, untouched by any of it
    expect(log.all()).toHaveLength(1);
    expect(log.all()[0]!.count).toBe(5);
  });

  /**
   * The other branch. A command repeating on its own count - tunnel, open,
   * close, disarm, alter (auto_repeat_n 99, cmd-core.c L82-87) - makes
   * process_player signal EVENT_COMMAND_REPEAT (game-world.c:973), and
   * repeated_command_display clears msg_flag and erases row 0. So a long dig
   * shows one fresh line per attempt and never reaches a "-more-", even though
   * the history collapses it exactly as it collapses the bites above.
   */
  it("starts a counted repeat's step on a clean line, so a dig never pages", () => {
    const DIG = "You tunnel into the granite wall."; // cmd-cave.c
    const log = new MessageLog();
    let pauses = 0;
    const lines: string[] = [];
    for (let step = 0; step < 5; step++) {
      const cursor = log.rawLength(); // repeated_command_display: msg_flag = false
      log.push(DIG);
      const { pages } = packMessages(log.rawSince(cursor), 80);
      pauses += pages.length - 1;
      lines.push(pages[pages.length - 1] ?? "");
    }
    expect(pauses).toBe(0);
    expect(lines).toEqual([DIG, DIG, DIG, DIG, DIG]);
    expect(log.all()).toHaveLength(1);
    expect(log.all()[0]!.count).toBe(5);
  });
});

/**
 * The shell half of the same split. main.ts boots a game at module scope and
 * cannot be imported, so these read its source, the way run-interrupt.test.ts
 * holds the pump's own invariants.
 */
describe("the shell feeds the top line from the raw stream", () => {
  const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const body = (name: string): string => {
    const start = MAIN.search(new RegExp(`function ${name}\\s*\\(`));
    expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
    const open = MAIN.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < MAIN.length; i++) {
      if (MAIN[i] === "{") depth++;
      else if (MAIN[i] === "}" && --depth === 0) return MAIN.slice(open, i + 1);
    }
    throw new Error(`unbalanced braces reading ${name}()`);
  };

  it("pages the raw events, not the collapsed history", () => {
    // msglog.all() is message_add's copy and belongs to the recall screen; the
    // pager reading it was the whole defect.
    const pump = body("pumpMessages");
    expect(pump).toContain("msglog.rawSince(preLen)");
    expect(pump).not.toContain("msglog.all()");
  });

  it("resets the pending cursor on a new command and on a counted repeat", () => {
    // textui_get_command (ui-input.c:1824) and repeated_command_display
    // (ui-display.c:2495) are the only two places upstream clears msg_flag.
    const adv = body("advance");
    expect(adv).toContain("const continuing = pumping;");
    expect(adv).toMatch(/repeatRemaining \?\? 0\) > 0/);
    expect(adv).toContain("const startsClean = !continuing || repeating;");
    expect(adv).toContain("if (startsClean) msgPending = msglog.rawLength();");
    // and the same condition erases row 0, because that is the other half of
    // what repeated_command_display does (prt("", 0, 0)).
    expect(adv).toContain('if (startsClean) message = "";');
  });

  it("flushes the pending line too when the screen is about to be replaced", () => {
    // message_flush (ui-input.c L609-635) prompts for the pending line as well,
    // then erases row 0 - unlike ordinary paging, which leaves it standing.
    const pump = body("pumpMessages");
    expect(pump).toContain("msgPending = force ? msglog.rawLength() : preLen + pendingFrom;");
    expect(pump).toContain("const prompts = autoMore ? 0 : force ? pages.length : pages.length - 1;");
  });
});

describe("typed live message display", () => {
  it("routes message.prf orange types through the shell log and history colors", () => {
    const core = new CoreMessageLog();
    const shell = new MessageLog();
    for (const type of ["BELL", "HITPOINT_WARN", "AFRAID"] as const) {
      pushTypedMessage(shell, type, type, (code) => core.typeColor(code), colorToCss);
      expect(messageTypeCode(type)).toBe(MSG[type]);
    }

    expect(shell.all().every((entry) => entry.color === colorToCss(COLOUR_ORANGE))).toBe(true);
    expect(messageHistoryLines(shell).every((line) => line.color === colorToCss(COLOUR_ORANGE))).toBe(true);
  });
});
