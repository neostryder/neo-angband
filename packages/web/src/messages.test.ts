import { describe, expect, it } from "vitest";
import { MessageLog, paginateMessages, format } from "./messages";

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

  it("a run-length count is rendered before packing (format())", () => {
    const pages = paginateMessages([m("You are hit.", 3)], 80);
    expect(pages).toEqual([format(m("You are hit.", 3))]);
    expect(pages[0]).toBe("You are hit. (x3)");
  });

  it("draws its fresh set from the MessageLog buffer tail (advance's preLen)", () => {
    const log = new MessageLog();
    log.push("old line");
    const preLen = log.all().length; // snapshot before the "turn"
    log.push("You hit the orc.");
    log.push("The orc dies.");
    const fresh = log.all().slice(preLen);
    expect(paginateMessages(fresh, 80)).toEqual(["You hit the orc. The orc dies."]);
  });
});
