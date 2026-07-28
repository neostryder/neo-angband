/**
 * wr_description (save.c:47-66), asserted character for character.
 *
 * These are player-visible strings, so the bar is transcription rather than
 * paraphrase: a reworded description would fill the slot where a census could
 * have seen an absence, and would then disagree with whatever a later screen
 * formats (see the paraphrase findings in parity/PLATFORM.md). Every expectation
 * below is written out in full for that reason - there is no helper building the
 * expected string from the same pieces the implementation uses, because such a
 * helper passes whatever the implementation does.
 */

import { describe, expect, it } from "vitest";
import { SAVEFILE_DESC_LEN, saveDescription } from "./description";

const ALIVE = {
  fullName: "Thorin",
  isDead: false,
  diedFrom: "",
  level: 12,
  raceName: "Dwarf",
  className: "Warrior",
  depth: 25,
};

describe("saveDescription", () => {
  it("formats a living character exactly as save.c:58-63 does", () => {
    expect(saveDescription(ALIVE)).toBe("Thorin, L12 Dwarf Warrior, at DL25");
  });

  it("formats a dead character exactly as save.c:53-56 does", () => {
    /* The dead branch drops the level, race, class and depth entirely and names
     * the killer instead. Getting this wrong by reusing the living format with a
     * suffix would look reasonable and be wrong. */
    expect(
      saveDescription({
        ...ALIVE,
        isDead: true,
        diedFrom: "a Cave spider",
      }),
    ).toBe("Thorin, dead (a Cave spider)");
  });

  it("says DL0 in town rather than naming the town", () => {
    /* player->depth is 0 there and the format has no special case for it. */
    expect(saveDescription({ ...ALIVE, level: 1, depth: 0 })).toBe(
      "Thorin, L1 Dwarf Warrior, at DL0",
    );
  });

  it("keeps a two-word class and race name intact", () => {
    /* Nothing is abbreviated, and the separators are single spaces - so the two
     * names run together readably rather than being comma-separated. */
    expect(
      saveDescription({
        ...ALIVE,
        raceName: "Half-Troll",
        className: "Blackguard",
      }),
    ).toBe("Thorin, L12 Half-Troll Blackguard, at DL25");
  });

  it("truncates to what a savefile can store and read back", () => {
    /* savefile_desc is char[120] (savefile.c:588) and rd_string truncates into
     * it. Applied on write so a description cannot change by making the round
     * trip - upstream's buf[1024] would let a long name through, and the value
     * read back would then differ from the value written. */
    const long = saveDescription({ ...ALIVE, fullName: "N".repeat(200) });
    expect(long.length).toBe(SAVEFILE_DESC_LEN - 1);
    expect(long.startsWith("NNN")).toBe(true);
  });

  it("does not truncate a description that fits", () => {
    const desc = saveDescription(ALIVE);
    expect(desc.length).toBeLessThan(SAVEFILE_DESC_LEN - 1);
    expect(desc.endsWith("DL25")).toBe(true);
  });

  it("reads diedFrom only when dead", () => {
    /* Upstream's living branch never touches died_from, so a stale value left on
     * the player from a cheated death must not leak into the description. */
    expect(saveDescription({ ...ALIVE, diedFrom: "something old" })).toBe(
      "Thorin, L12 Dwarf Warrior, at DL25",
    );
  });
});
