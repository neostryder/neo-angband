/**
 * The mod-supplied monster spell table (#281, census row 22).
 *
 * The assertions that matter here are the two the table's shape makes easy to
 * get wrong, and both are pinned rather than described:
 *
 *  - the first mod slot is `RSF.MAX`, the SENTINEL's own index, not
 *    `MON_SPELL_ENTRIES.length`. Those two numbers differ by exactly one and
 *    both read plausibly, so a test that only checked "the mod spell got an
 *    index" would pass with the off-by-one in place and leave every mod spell
 *    one slot too high forever.
 *  - `spellNameAt` at that index answers the MOD's name, where the inverted
 *    enum answers `"MAX"`. That is the whole reason this module exists as a
 *    chokepoint instead of callers reading `RSF_FLAG_NAMES` by position.
 */

import { afterEach, describe, expect, it } from "vitest";
import { MON_SPELL_ENTRIES, RSF } from "../generated/index.js";
import { RSF_FLAG_NAMES } from "./lore-file.js";
import {
  FIRST_MOD_SPELL_INDEX,
  monSpells,
  rsfMax,
  rsfSize,
  spellIndexOf,
  spellNameAt,
} from "./spell-registry.js";

afterEach(() => {
  monSpells.clear();
});

describe("the compiled table this appends to", () => {
  it("has one MORE row than RSF.MAX, because both sentinels are rows", () => {
    expect(RSF.MAX).toBe(92);
    expect(MON_SPELL_ENTRIES.length).toBe(RSF.MAX + 1);
    expect(MON_SPELL_ENTRIES[0]?.name).toBe("NONE");
    expect(MON_SPELL_ENTRIES[RSF.MAX]?.name).toBe("MAX");
  });

  it("puts the first mod slot ON the sentinel, not after the last row", () => {
    expect(FIRST_MOD_SPELL_INDEX).toBe(RSF.MAX);
    expect(FIRST_MOD_SPELL_INDEX).not.toBe(MON_SPELL_ENTRIES.length);
  });
});

describe("with nothing registered", () => {
  it("answers exactly as the compiled table does", () => {
    expect(rsfMax()).toBe(RSF.MAX);
    expect(spellIndexOf("BR_FIRE")).toBe(RSF.BR_FIRE);
    expect(spellIndexOf("NOT_A_SPELL")).toBe(-1);
    expect(spellNameAt(RSF.BR_FIRE)).toBe("BR_FIRE");
  });

  it("sizes a spell FlagSet the way upstream's FLAG_SIZE(RSF_MAX) does", () => {
    expect(rsfSize()).toBe(12);
  });
});

describe("a mod's spell", () => {
  it("takes the sentinel's slot and answers by name there", () => {
    const added = monSpells.add("MY_BREATH", "RST_BREATH | RST_INNATE", "mymod");
    expect(added.refused).toBeNull();
    expect(added.index).toBe(RSF.MAX);

    expect(spellIndexOf("MY_BREATH")).toBe(RSF.MAX);
    expect(spellNameAt(RSF.MAX)).toBe("MY_BREATH");
    expect(rsfMax()).toBe(RSF.MAX + 1);
  });

  it("is what the inverted enum gets WRONG at that index", () => {
    monSpells.add("MY_BREATH", "RST_BREATH | RST_INNATE", "mymod");
    /* The defect this chokepoint exists to prevent, stated as a fact about the
     * generated table rather than as a warning in a comment: read by position,
     * the mod's first spell is named after the end marker. */
    expect(RSF_FLAG_NAMES[RSF.MAX]).toBe("MAX");
    expect(spellNameAt(RSF.MAX)).toBe("MY_BREATH");
  });

  it("keeps its RST_ type expression, so the masks can see it", () => {
    monSpells.add("MY_BREATH", "RST_BREATH | RST_INNATE", "mymod");
    expect(monSpells.typeAt(RSF.MAX)).toBe("RST_BREATH | RST_INNATE");
    expect(monSpells.added()).toEqual([
      { name: "MY_BREATH", type: "RST_BREATH | RST_INNATE", owner: "mymod" },
    ]);
  });

  it("grows the FlagSet once the count crosses a byte boundary", () => {
    /* 92 spells fit in 12 bytes with four bits spare, so the first four mod
     * spells are free and the fifth is not. A caller that captured the size at
     * module evaluation would allocate 12 bytes for a 13-byte table. */
    for (let i = 0; i < 4; i++) monSpells.add(`SPELL_${i}`, "", "mymod");
    expect(rsfMax()).toBe(96);
    expect(rsfSize()).toBe(12);
    monSpells.add("SPELL_4", "", "mymod");
    expect(rsfMax()).toBe(97);
    expect(rsfSize()).toBe(13);
  });
});

describe("refusals, none of which throw", () => {
  it("refuses a name Angband already has, rather than shadowing it", () => {
    const added = monSpells.add("BR_FIRE", "RST_BREATH", "mymod");
    expect(added.index).toBe(-1);
    expect(added.refused).toContain("already one of Angband's own");
    expect(spellIndexOf("BR_FIRE")).toBe(RSF.BR_FIRE);
  });

  it("refuses both sentinels by name", () => {
    expect(monSpells.add("NONE", "", "mymod").refused).toContain("end marker");
    expect(monSpells.add("MAX", "", "mymod").refused).toContain("end marker");
    expect(rsfMax()).toBe(RSF.MAX);
  });

  it("refuses a duplicate mod name, keeping the first registration", () => {
    expect(monSpells.add("MY_BREATH", "RST_BREATH", "one").index).toBe(RSF.MAX);
    const second = monSpells.add("MY_BREATH", "RST_BALL", "two");
    expect(second.index).toBe(-1);
    expect(second.refused).toContain("duplicate");
    expect(monSpells.typeAt(RSF.MAX)).toBe("RST_BREATH");
  });

  it("refuses an empty name", () => {
    expect(monSpells.add("", "", "mymod").refused).toContain("needs a name");
  });
});

describe("clear()", () => {
  it("puts the table back to upstream's, so one character cannot reach the next", () => {
    monSpells.add("MY_BREATH", "RST_BREATH", "mymod");
    monSpells.clear();
    expect(rsfMax()).toBe(RSF.MAX);
    expect(spellIndexOf("MY_BREATH")).toBe(-1);
    /* Null, not "MAX". The sentinel is an end marker rather than a spell, so
     * the chokepoint answers "no spell there" where the inverted enum answers
     * with the marker's name - which is the confusion this whole module is
     * built to keep out of the callers. */
    expect(spellNameAt(RSF.MAX)).toBeNull();
  });
});
