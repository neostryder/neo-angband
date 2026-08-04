/**
 * lore.txt, both halves, against the reference C.
 *
 * The interesting assertions here are not "does it round-trip" - a writer and a
 * reader written together will always agree with each other. They are:
 *
 *   - the flag NAME TABLES, derived from reference/src/list-mon-*.h rather than
 *     declared here, because that is the one place an off-by-one would be
 *     invisible: MON_SPELL_ENTRIES keeps upstream's RSF_NONE at index 0 and
 *     MON_RACE_FLAG_ENTRIES drops RF_NONE, so a table built off either entry list
 *     would be right for one flag space and shifted for the other, and every
 *     flag name in the file would silently be its neighbour;
 *   - write_flags' exact line-breaking, including the two upstream details a
 *     tidy-up would remove;
 *   - and that lore.txt carries the CROSS-LIFE counters and NOT pkills/thefts,
 *     which is the whole reason the file exists.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { FlagSet } from "../bitflag.js";
import { RF, RSF } from "../generated/index.js";
import { RSF_SIZE } from "./types.js";
import type { MonsterRace } from "./types.js";
import { newMonsterLore } from "./lore.js";
import type { LoreStore } from "./lore.js";
import {
  RF_FLAG_NAMES,
  RSF_FLAG_NAMES,
  applyLoreFile,
  parseLoreFile,
  writeFlags,
  writeLoreEntries,
} from "./lore-file.js";

const REFERENCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "reference",
  "src",
);

/** The names in a list-*.h, in file order - upstream's own array literal. */
function headerNames(file: string, macro: string): string[] {
  const text = readFileSync(join(REFERENCE, file), "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`^${macro}\\(\\s*([A-Za-z0-9_]+)`, "gmu"))) {
    out.push(m[1] as string);
  }
  return out;
}

describe("the flag name tables are upstream's arrays", () => {
  it("r_info_flags: index == flag number, RF_NONE at 0", () => {
    /* #define RF(a, b, c) #a, over list-mon-race-flags.h, so the array index IS
     * the flag value and index 0 is the NONE the header opens with. */
    const names = headerNames("list-mon-race-flags.h", "RF");
    expect(names[0]).toBe("NONE");
    expect(names.length).toBeGreaterThan(80);
    for (let i = 1; i < names.length; i++) {
      expect(RF_FLAG_NAMES[i], `flag ${i}`).toBe(names[i]);
    }
    /* The spot check that would have caught the off-by-one on its own. */
    expect(RF_FLAG_NAMES[RF.UNIQUE]).toBe("UNIQUE");
  });

  it("r_info_spell_flags: index == flag number, RSF_NONE at 0", () => {
    const names = headerNames("list-mon-spells.h", "RSF");
    expect(names[0]).toBe("NONE");
    for (let i = 1; i < names.length; i++) {
      expect(RSF_FLAG_NAMES[i], `spell flag ${i}`).toBe(names[i]);
    }
    expect(RSF_FLAG_NAMES[RSF.SHRIEK]).toBe("SHRIEK");
  });
});

describe("write_flags (datafile.c:478-514)", () => {
  const names: (string | undefined)[] = [undefined];
  for (let i = 1; i <= 40; i++) names[i] = `F${String(i).padStart(2, "0")}`;

  it("joins with ' | ' and prefixes every line with the intro", () => {
    const set = new FlagSet(8);
    set.on(1);
    set.on(2);
    expect(writeFlags("flags:", set, 8, names)).toBe("flags:F01 | F02\n");
  });

  it("writes nothing at all for an empty set", () => {
    /* Gated on `pointer`, so no set flags means no line - not an empty "flags:". */
    expect(writeFlags("flags:", new FlagSet(8), 8, names)).toBe("");
  });

  it("breaks to a new intro-prefixed line once the run reaches 60", () => {
    const set = new FlagSet(8);
    for (let i = 1; i <= 20; i++) set.on(i);
    const lines = writeFlags("flags:", set, 8, names).trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.startsWith("flags:")).toBe(true);
    /* Names are 3 chars and separators 3, so after n names pointer is 6n-3: it
     * first reaches 60 at n=11 (63), and that eleventh name is appended BEFORE
     * the check. So the break lands at eleven names and the line is 65 characters
     * of flags - longer than the 60 the constant suggests, which is upstream's
     * behaviour and the reason this is pinned rather than described. */
    expect(lines[0]).toBe(
      `flags:${Array.from({ length: 11 }, (_, i) => names[i + 1]).join(" | ")}`,
    );
  });

  it("keeps the trailing separator when it runs past the named flags", () => {
    /* L497-499: the " | " is appended, THEN the name is looked up, and a missing
     * name breaks the loop with the separator already in the buffer. Reproduced
     * because the reader has to cope with what the writer emits, and because a
     * "tidier" writer would silently change the file format. */
    const short: (string | undefined)[] = [undefined, "AAA"];
    const set = new FlagSet(8);
    set.on(1);
    set.on(2); /* no name at 2 */
    expect(writeFlags("flags:", set, 8, short)).toBe("flags:AAA | \n");
  });
});

/* --- fixtures ------------------------------------------------------------- */

function fakeRace(ridx: number, name: string): MonsterRace {
  return {
    ridx,
    name,
    base: { name: "kobold" },
    blows: [],
    spellFlags: new FlagSet(RSF_SIZE),
    sleep: 0,
  } as unknown as MonsterRace;
}

function storeWith(race: MonsterRace, edit: (l: ReturnType<typeof newMonsterLore>) => void): LoreStore {
  const lore = newMonsterLore(race);
  edit(lore);
  return new Map([[race.ridx, lore]]);
}

describe("write_lore_entries (mon-lore.c:1743-1893)", () => {
  it("skips a race that has never been seen and is not fully known", () => {
    const race = fakeRace(3, "kobold");
    expect(writeLoreEntries([race], storeWith(race, () => undefined))).toBe("");
  });

  it("writes name and the seven counts, in upstream's order", () => {
    const race = fakeRace(3, "kobold");
    const store = storeWith(race, (l) => {
      l.sights = 4;
      l.deaths = 1;
      l.tkills = 9;
      l.wake = 2;
      l.ignore = 3;
      l.castInnate = 5;
      l.castSpell = 6;
    });
    expect(writeLoreEntries([race], store)).toBe(
      "name:kobold\ncounts:4:1:9:2:3:5:6\n\n",
    );
  });

  it("does NOT write pkills or thefts", () => {
    /* The load-bearing omission: those two are the savefile's, because they are
     * "in this life" counters and the file outlives the life. If they leaked into
     * lore.txt, a new character would inherit the last one's kill count. */
    const race = fakeRace(3, "kobold");
    const store = storeWith(race, (l) => {
      l.sights = 1;
      l.pkills = 77;
      l.thefts = 88;
    });
    const out = writeLoreEntries([race], store);
    expect(out).not.toContain("77");
    expect(out).not.toContain("88");
  });

  it("adds a base line only when everything is known", () => {
    const race = fakeRace(3, "kobold");
    const seen = storeWith(race, (l) => {
      l.sights = 1;
    });
    expect(writeLoreEntries([race], seen)).not.toContain("base:");

    const known = storeWith(race, (l) => {
      l.sights = 1;
      l.allKnown = true;
    });
    expect(writeLoreEntries([race], known)).toContain("base:kobold\n");
  });

  it("intersects the spell flags with the race's, mutating the lore (L1802)", () => {
    /* rsf_inter is a side effect of writing the file, and it changes what the
     * NEXT save contains. A wart, kept: core reproduces the C, and fixes go in
     * the bug-fixes mod. */
    const race = fakeRace(3, "kobold");
    race.spellFlags.on(RSF.SHRIEK);
    const store = storeWith(race, (l) => {
      l.sights = 1;
      l.spellFlags.on(RSF.SHRIEK);
      l.spellFlags.on(RSF.ARROW); /* the race does not have it */
    });
    const out = writeLoreEntries([race], store);
    expect(out).toContain("spells:SHRIEK\n");
    expect(out).not.toContain("ARROW");
    expect(store.get(3)?.spellFlags.has(RSF.ARROW)).toBe(false);
  });
});

describe("lore_parser (mon-init.c:2544-2580)", () => {
  it("reads the counts back", () => {
    const parsed = parseLoreFile("name:kobold\ncounts:4:1:9:2:3:5:6\n");
    const e = parsed.entries.get("kobold");
    expect(e?.sights).toBe(4);
    expect(e?.tkills).toBe(9);
    expect(e?.castSpell).toBe(6);
    expect(parsed.bad).toEqual([]);
  });

  it("treats a base line as know-everything plus every racial flag", () => {
    const e = parseLoreFile("name:kobold\nbase:kobold\n").entries.get("kobold");
    expect(e?.allKnown).toBe(true);
    expect(e?.flags.has(RF.UNIQUE)).toBe(true);
  });

  it("records a blow only when it was seen (mon-init.c:2345)", () => {
    const e = parseLoreFile(
      "name:kobold\nblow:HIT:HURT:0+1d4M0:3:1\nblow:BITE:HURT:0+1d4M0:0:2\n",
    ).entries.get("kobold");
    expect(e?.blowTimesSeen.get(1)).toBe(3);
    expect(e?.blowTimesSeen.has(2)).toBe(false);
  });

  it("splits flags on both spaces and pipes, and ignores names it does not know", () => {
    const e = parseLoreFile("name:kobold\nflags:UNIQUE | NOT_A_REAL_FLAG | MALE\n")
      .entries.get("kobold");
    expect(e?.flags.has(RF.UNIQUE)).toBe(true);
    expect(e?.flags.has(RF.MALE)).toBe(true);
  });

  it("counts the drop/friends/mimic echo instead of failing on it", () => {
    const parsed = parseLoreFile(
      "name:kobold\ndrop:sword:Dagger:100:1:1\nfriends:100:1d2:kobold\nmimic:light:Wooden Torch\n",
    );
    expect(parsed.ignored).toBe(3);
    expect(parsed.bad).toEqual([]);
  });

  it("names a line it cannot parse rather than dropping it silently", () => {
    expect(parseLoreFile("name:kobold\nzorkmid:3\n").bad).toEqual(["zorkmid:3"]);
  });

  it("round-trips what it writes", () => {
    const race = fakeRace(3, "kobold");
    const store = storeWith(race, (l) => {
      l.sights = 4;
      l.tkills = 9;
      l.flags.on(RF.UNIQUE);
    });
    const parsed = parseLoreFile(writeLoreEntries([race], store));
    const e = parsed.entries.get("kobold");
    expect(e?.sights).toBe(4);
    expect(e?.tkills).toBe(9);
    expect(e?.flags.has(RF.UNIQUE)).toBe(true);
    expect(parsed.bad).toEqual([]);
  });
});

describe("applyLoreFile: the file over the save, upstream's order", () => {
  it("overwrites the file's fields and leaves pkills/thefts from the save", () => {
    const race = fakeRace(3, "kobold");
    const store = storeWith(race, (l) => {
      l.sights = 1;
      l.tkills = 1;
      l.pkills = 12;
      l.thefts = 4;
    });
    const res = applyLoreFile([race], store, parseLoreFile("name:kobold\ncounts:9:0:40:0:0:0:0\n"));
    expect(res.applied).toBe(1);
    const lore = store.get(3);
    expect(lore?.tkills).toBe(40); /* the shared, cross-life count */
    expect(lore?.pkills).toBe(12); /* this life's, untouched */
    expect(lore?.thefts).toBe(4);
  });

  it("creates a record for a race the save never met", () => {
    /* The behaviour that was missing entirely: a NEW character inherits the
     * player's accumulated monster memory, which is what makes lore-describe's
     * "your ancestors have exterminated at least N" able to be true. */
    const race = fakeRace(3, "kobold");
    const store: LoreStore = new Map();
    applyLoreFile([race], store, parseLoreFile("name:kobold\ncounts:2:0:30:0:0:0:0\n"));
    expect(store.get(3)?.tkills).toBe(30);
    /* lore_update's derived fields, which the parser leaves unset. */
    expect(store.get(3)?.dropKnown).toBe(true);
  });

  it("names an entry whose race is gone instead of discarding it", () => {
    /* A mod that supplied the monster may simply be switched off; upstream has no
     * such case, so dropping the block the way the C does would forget lore a
     * re-enable should restore. */
    const res = applyLoreFile([], new Map(), parseLoreFile("name:frost wyrm\ncounts:1:0:0:0:0:0:0\n"));
    expect(res.unknownRaces).toEqual(["frost wyrm"]);
    expect(res.applied).toBe(0);
  });
});
