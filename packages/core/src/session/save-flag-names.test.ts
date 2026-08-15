/**
 * Object properties, race lore and element info are persisted BY NAME (#273).
 *
 * Until SAVE_VERSION 6 the savefile stored raw POSITIONS for four generated
 * tables: `SavedLore.flags` was the bytes of an RF FlagSet, `SavedObject.flags`
 * (and `SavedPlayer.objKnown.flags`, and `SavedMonster.knownPstateFlags`) the
 * bytes of an OF FlagSet, `modifiers` a dense array indexed by `OBJ_MOD` and
 * `elInfo` a dense array indexed by `ELEM`. That is the same defect #269
 * removed for `MON_SPELL_ENTRIES`, and it is why none of those four tables
 * could be reordered or trimmed without silently re-pointing every existing
 * character's items and monster memory at different properties.
 *
 * TWO THINGS THIS FILE PROVES THAT A ROUND TRIP DOES NOT.
 *
 * 1. THE INDEX BASE. The three generated ENTRIES tuples do not share one:
 *    `MON_RACE_FLAG_ENTRIES` keeps upstream's NONE at [0], `OBJECT_FLAG_ENTRIES`
 *    drops OF_NONE so `OF_<name> === index + 1`, and `OBJECT_MODIFIER_ENTRIES`
 *    starts five values in because list-stats.h comes first. An off-by-one here
 *    writes every character's flags one slot over and round-trips perfectly,
 *    because both halves would be wrong the same way. Each table is therefore
 *    pinned against its OWN tuple at its OWN base, and against an independent
 *    inversion of the generated enum - two derivations that can disagree.
 *
 * 2. THE RENUMBER CONTROL, once per table. It renumbers the table and reads the
 *    same pre-existing data under both schemes: the position-keyed read names
 *    different properties, and the name-keyed read is unmoved. A test that only
 *    exercised the happy path would pass just as well against the shape this
 *    ticket removed.
 *
 * That the real serializers WRITE these fields is proved elsewhere and on real
 * data: `save-fields.test.ts` resolves `gear.store[0][1].flagNames`,
 * `.modifierValues`, `.elementInfo`, `player.objKnown.*` and
 * `monsters[1].knownPstate*` in a mid-game document and round-trips it through
 * the real loader.
 */

import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag.js";
import {
  ELEM,
  ELEMENT_ENTRIES,
  MON_RACE_FLAG_ENTRIES,
  OBJECT_FLAG_ENTRIES,
  OBJECT_MODIFIER_ENTRIES,
  OBJ_MOD,
  OF,
  RF,
} from "../generated/index.js";
import { ELEMENT_NAMES, OBJ_MOD_NAMES } from "../obj/bind.js";
import { RF_FLAG_NAMES } from "../mon/lore-file.js";
import { ELEM_MAX, OBJ_MOD_MAX, OF_SIZE, newElemInfo } from "../obj/types.js";
import { RF_SIZE } from "../mon/types.js";
import type { ElementInfo } from "../obj/types.js";
import {
  OF_FLAG_NAMES,
  deserializeElementLevels,
  deserializeLoreFlags,
  deserializeObjectElements,
  deserializeObjectFlags,
  deserializeObjectModifiers,
  serializeElementLevels,
  serializeLoreFlags,
  serializeObjectElements,
  serializeObjectFlags,
  serializeObjectModifiers,
} from "./save.js";

/**
 * The enum inverted, derived here rather than imported, so this is a SECOND
 * derivation of every table below and not a restatement of the first.
 */
function inverted(en: Readonly<Record<string, number>>): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  for (const [name, value] of Object.entries(en)) out[value] = name;
  return out;
}

function ofFlags(...flags: number[]): FlagSet {
  const set = new FlagSet(OF_SIZE);
  for (const f of flags) set.on(f);
  return set;
}

function rfFlags(...flags: number[]): FlagSet {
  const set = new FlagSet(RF_SIZE);
  for (const f of flags) set.on(f);
  return set;
}

/* ------------------------------------------------------------------ *
 * 1. The index bases, each stated against its own generated tuple.
 * ------------------------------------------------------------------ */

describe("each name table is pinned at its own index base", () => {
  it("OF: OBJECT_FLAG_ENTRIES drops OF_NONE, so the tuple is OFFSET BY ONE", () => {
    expect(OF_FLAG_NAMES[0]).toBe("NONE");
    expect(OBJECT_FLAG_ENTRIES[0]!.name).toBe("SUST_STR");
    expect(OF.SUST_STR).toBe(1);
    for (let flag = 1; flag <= OF.MAX; flag++) {
      expect(OF_FLAG_NAMES[flag], `OF flag ${flag}`).toBe(
        OBJECT_FLAG_ENTRIES[flag - 1]!.name,
      );
    }
    expect(OF_FLAG_NAMES).toEqual(inverted(OF));
    /* The last entry is the enum's own sentinel, not a property. */
    expect(OF_FLAG_NAMES[OF.MAX]).toBe("MAX");
  });

  it("RF: MON_RACE_FLAG_ENTRIES keeps RF_NONE, so there is NO offset", () => {
    expect(MON_RACE_FLAG_ENTRIES[0]!.name).toBe("NONE");
    expect(RF.UNIQUE).toBe(1);
    for (let flag = 0; flag < MON_RACE_FLAG_ENTRIES.length; flag++) {
      expect(RF_FLAG_NAMES[flag], `RF flag ${flag}`).toBe(
        MON_RACE_FLAG_ENTRIES[flag]!.name,
      );
    }
    expect(Array.from(RF_FLAG_NAMES)).toEqual(inverted(RF));
    /* RF has no MAX member: the table ends at the last real flag. */
    expect(RF_FLAG_NAMES).toHaveLength(MON_RACE_FLAG_ENTRIES.length);
    expect(RF_FLAG_NAMES[MON_RACE_FLAG_ENTRIES.length]).toBeUndefined();
  });

  it("OBJ_MOD: the five stats come first, so the tuple is OFFSET BY FIVE", () => {
    expect(OBJ_MOD_NAMES[0]).toBe("STR");
    expect(OBJ_MOD.STEALTH).toBe(5);
    expect(OBJECT_MODIFIER_ENTRIES[0]!.name).toBe("STEALTH");
    for (let i = OBJ_MOD.STEALTH; i < OBJ_MOD_MAX; i++) {
      expect(OBJ_MOD_NAMES[i], `modifier ${i}`).toBe(
        OBJECT_MODIFIER_ENTRIES[i - OBJ_MOD.STEALTH]!.name,
      );
    }
    expect(Array.from(OBJ_MOD_NAMES)).toEqual(inverted(OBJ_MOD));
    expect(OBJ_MOD_NAMES).toHaveLength(OBJ_MOD_MAX);
  });

  it("ELEM: ELEMENT_ENTRIES starts at ACID, so there is NO offset", () => {
    expect(ELEMENT_NAMES[0]).toBe("ACID");
    expect(ELEM.ACID).toBe(0);
    for (let i = 0; i < ELEM_MAX; i++) {
      expect(ELEMENT_NAMES[i], `element ${i}`).toBe(ELEMENT_ENTRIES[i]!.name);
    }
    expect(Array.from(ELEMENT_NAMES)).toEqual(inverted(ELEM));
    expect(ELEMENT_NAMES).toHaveLength(ELEM_MAX);
  });
});

/* ------------------------------------------------------------------ *
 * 2. What each helper does with ordinary, empty and hostile input.
 * ------------------------------------------------------------------ */

describe("serializeObjectFlags / deserializeObjectFlags (OF)", () => {
  it("writes OF names, ascending by flag number", () => {
    const names = serializeObjectFlags(
      ofFlags(OF.FREE_ACT, OF.SUST_STR, OF.TELEPATHY),
    );
    expect(names).toEqual(["SUST_STR", "TELEPATHY", "FREE_ACT"]);
  });

  it("round-trips an arbitrary set exactly", () => {
    const before = ofFlags(OF.SUST_CON, OF.PROT_FEAR, OF.THROWING, OF.DIG_3);
    const after = deserializeObjectFlags(serializeObjectFlags(before));
    expect(Array.from(after.bits)).toEqual(Array.from(before.bits));
    expect(after.size).toBe(OF_SIZE);
  });

  it("knows nothing from an empty set, and nothing from a missing field", () => {
    expect(serializeObjectFlags(new FlagSet(OF_SIZE))).toEqual([]);
    expect(deserializeObjectFlags([]).isEmpty()).toBe(true);
    expect(deserializeObjectFlags(undefined).isEmpty()).toBe(true);
  });

  it("skips the padding bits at and above OF.MAX, sentinel included", () => {
    /* OF_SIZE rounds 39 flags up to 5 bytes, so a set has 40 addressable bits.
     * Index 39 is the enum's own MAX sentinel and 40 names nothing; neither may
     * reach the save, and neither may come back in through the reader. */
    const all = new FlagSet(OF_SIZE);
    all.setall();
    const names = serializeObjectFlags(all);
    expect(names).toHaveLength(OF.MAX - 1);
    expect(names).not.toContain("MAX");
    expect(deserializeObjectFlags(["MAX"]).isEmpty()).toBe(true);
    expect(deserializeObjectFlags(["NONE"]).isEmpty()).toBe(true);
  });

  it("drops a name this build does not have instead of guessing a bit", () => {
    const set = deserializeObjectFlags(["SUST_STR", "SOME_MOD_FLAG", "REGEN"]);
    expect(serializeObjectFlags(set)).toEqual(["SUST_STR", "REGEN"]);
  });
});

describe("serializeLoreFlags / deserializeLoreFlags (RF)", () => {
  it("writes RF names, ascending by flag number", () => {
    expect(serializeLoreFlags(rfFlags(RF.EVIL, RF.UNIQUE, RF.BASH_DOOR))).toEqual([
      "UNIQUE",
      "BASH_DOOR",
      "EVIL",
    ]);
  });

  it("round-trips an arbitrary learned set exactly", () => {
    const before = rfFlags(RF.UNIQUE, RF.IM_FIRE, RF.NO_SLOW, RF.PASS_WALL);
    const after = deserializeLoreFlags(serializeLoreFlags(before));
    expect(Array.from(after.bits)).toEqual(Array.from(before.bits));
    expect(after.size).toBe(RF_SIZE);
  });

  it("knows nothing from an empty set, and nothing from a missing field", () => {
    expect(serializeLoreFlags(new FlagSet(RF_SIZE))).toEqual([]);
    expect(deserializeLoreFlags([]).isEmpty()).toBe(true);
    expect(deserializeLoreFlags(undefined).isEmpty()).toBe(true);
  });

  it("skips the padding bits above the last RF flag", () => {
    /* RF_SIZE rounds 85 entries up to 11 bytes, so a set has 88 addressable
     * bits for 84 real flags. RF has no MAX member, so "has a name" IS the
     * bound - and RF_NONE at [0] is never yielded by a FlagSet either way. */
    const all = new FlagSet(RF_SIZE);
    all.setall();
    const names = serializeLoreFlags(all);
    expect(names).toHaveLength(MON_RACE_FLAG_ENTRIES.length - 1);
    expect(names).not.toContain("NONE");
    expect(deserializeLoreFlags(["NONE"]).isEmpty()).toBe(true);
  });

  it("drops a mod's race flag this build no longer has", () => {
    const set = deserializeLoreFlags(["UNIQUE", "FROST_AURA", "EVIL"]);
    expect(serializeLoreFlags(set)).toEqual(["UNIQUE", "EVIL"]);
  });
});

describe("serializeObjectModifiers / deserializeObjectModifiers (OBJ_MOD)", () => {
  const withMods = (pairs: Array<[number, number]>): number[] => {
    const out = new Array<number>(OBJ_MOD_MAX).fill(0);
    for (const [i, v] of pairs) out[i] = v;
    return out;
  };

  it("writes only the non-zero modifiers, in ascending index order", () => {
    const saved = serializeObjectModifiers(
      withMods([
        [OBJ_MOD.BLOWS, 1],
        [OBJ_MOD.STR, 3],
        [OBJ_MOD.SPEED, -2],
      ]),
    );
    expect(saved).toEqual({ STR: 3, SPEED: -2, BLOWS: 1 });
    /* Ascending, so an unchanged object writes identical bytes. */
    expect(Object.keys(saved)).toEqual(["STR", "SPEED", "BLOWS"]);
  });

  /**
   * THE ZERO-INDEX TRAP, stated as a test. `OBJ_MOD.STR` is 0, which is a
   * SENTINEL in the two flag tables and a real modifier here; a `> 0` guard
   * copied across from the flag helpers would silently strip the strength
   * bonus off every ring in the game and pass every round-trip that did not
   * happen to use one.
   */
  it("keeps OBJ_MOD_STR, which is index 0 and NOT a sentinel", () => {
    const saved = serializeObjectModifiers(withMods([[OBJ_MOD.STR, 4]]));
    expect(saved).toEqual({ STR: 4 });
    expect(deserializeObjectModifiers(saved)[OBJ_MOD.STR]).toBe(4);
  });

  it("round-trips to a full-length array, zero where the save said nothing", () => {
    const before = withMods([
      [OBJ_MOD.STR, 2],
      [OBJ_MOD.LIGHT, 1],
      [OBJ_MOD.MOVES, -1],
    ]);
    expect(deserializeObjectModifiers(serializeObjectModifiers(before))).toEqual(
      before,
    );
  });

  it("takes its length from THIS build, not from the document", () => {
    /* A save written against a longer table would otherwise hand back an array
     * the engine's own OBJ_MOD_MAX loops run off the end of. */
    expect(deserializeObjectModifiers(undefined)).toHaveLength(OBJ_MOD_MAX);
    expect(
      deserializeObjectModifiers({ STR: 1, SOME_MOD_MODIFIER: 9 }),
    ).toHaveLength(OBJ_MOD_MAX);
  });

  it("drops a modifier name this build does not have", () => {
    const out = deserializeObjectModifiers({ SPEED: 5, FROST_AURA: 7 });
    expect(serializeObjectModifiers(out)).toEqual({ SPEED: 5 });
  });
});

describe("serializeObjectElements / deserializeObjectElements (ELEM)", () => {
  const withEl = (pairs: Array<[number, ElementInfo]>): ElementInfo[] => {
    const out = newElemInfo();
    for (const [i, e] of pairs) out[i] = e;
    return out;
  };

  it("writes only the touched elements, in ascending index order", () => {
    const saved = serializeObjectElements(
      withEl([
        [ELEM.POIS, { resLevel: 1, flags: 0 }],
        [ELEM.ACID, { resLevel: 0, flags: 4 }],
        [ELEM.FIRE, { resLevel: 3, flags: 2 }],
      ]),
    );
    expect(Object.keys(saved)).toEqual(["ACID", "FIRE", "POIS"]);
    expect(saved.FIRE).toEqual({ resLevel: 3, flags: 2 });
    /* An element touched only by its EL_INFO_ flags is still touched. */
    expect(saved.ACID).toEqual({ resLevel: 0, flags: 4 });
  });

  it("keeps ELEM_ACID, which is index 0 and NOT a sentinel", () => {
    const out = deserializeObjectElements({ ACID: { resLevel: 2, flags: 0 } });
    expect(out[ELEM.ACID]).toEqual({ resLevel: 2, flags: 0 });
  });

  it("round-trips to a full-length array, zeroed where the save said nothing", () => {
    const before = withEl([
      [ELEM.COLD, { resLevel: 1, flags: 0 }],
      [ELEM.NEXUS, { resLevel: -1, flags: 8 }],
    ]);
    const after = deserializeObjectElements(serializeObjectElements(before));
    expect(after).toEqual(before);
    expect(after).toHaveLength(ELEM_MAX);
    expect(deserializeObjectElements(undefined)).toEqual(newElemInfo());
  });

  it("drops an element name this build does not have", () => {
    const out = deserializeObjectElements({
      FIRE: { resLevel: 1, flags: 0 },
      RADIANCE: { resLevel: 1, flags: 0 },
    });
    expect(Object.keys(serializeObjectElements(out))).toEqual(["FIRE"]);
  });

  it("the res_level-only form (a monster's known_pstate) behaves the same", () => {
    const levels = new Int16Array(ELEM_MAX);
    levels[ELEM.ACID] = 1;
    levels[ELEM.DARK] = -1;
    const saved = serializeElementLevels(levels);
    expect(saved).toEqual({ ACID: 1, DARK: -1 });
    expect(deserializeElementLevels(saved)).toEqual(Array.from(levels));
    expect(deserializeElementLevels({ RADIANCE: 3 })).toEqual(
      Array.from(new Int16Array(ELEM_MAX)),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. THE CONTROLS. Model the thing each table was blocked from doing -
 *    one entry inserted, so everything above it moves up by one - and
 *    read data written BEFORE it under both schemes.
 * ------------------------------------------------------------------ */

describe("a renumbered OF table", () => {
  /** OF_FLAG_NAMES as it would read with one flag inserted at position 1. */
  const renumbered: readonly (string | undefined)[] = [
    OF_FLAG_NAMES[0],
    "MOD_SUST_LUCK",
    ...OF_FLAG_NAMES.slice(1),
  ];

  it("re-points the BIT POSITIONS a version-5 save stored", () => {
    const stored = ofFlags(OF.TELEPATHY, OF.FREE_ACT);
    /* Version 5's reader was "these bit numbers, through the current table". */
    const nowMeans = Array.from(stored).map((f) => renumbered[f]);
    expect(nowMeans).toEqual(["REGEN", "SEE_INVIS"]);
    /* Which is the bug, stated as an assertion: the same bytes, different
     * properties. Nothing about the save changed. */
    expect(nowMeans).not.toEqual(["TELEPATHY", "FREE_ACT"]);
  });

  it("cannot re-point the NAMES a version-6 save stores", () => {
    const written = serializeObjectFlags(ofFlags(OF.TELEPATHY, OF.FREE_ACT));
    expect(written).toEqual(["TELEPATHY", "FREE_ACT"]);
    const read = written.map((n) => renumbered.indexOf(n));
    expect(read.map((f) => renumbered[f])).toEqual(["TELEPATHY", "FREE_ACT"]);
    /* The flag NUMBERS moved, which is exactly what inserting does - and the
     * item's properties did not, which is what this ticket bought. */
    expect(read).toEqual([OF.TELEPATHY + 1, OF.FREE_ACT + 1]);
  });
});

describe("a renumbered RF table", () => {
  const renumbered: readonly (string | undefined)[] = [
    RF_FLAG_NAMES[0],
    "MOD_FROST_AURA",
    ...RF_FLAG_NAMES.slice(1),
  ];

  it("re-points the BIT POSITIONS a version-5 save stored", () => {
    const stored = rfFlags(RF.EVIL, RF.UNDEAD);
    const nowMeans = Array.from(stored).map((f) => renumbered[f]);
    expect(nowMeans).toEqual(["ANIMAL", "EVIL"]);
    /* A character who had learned "this thing is evil, and it is undead" now
     * remembers "it is an animal, and it is evil". */
    expect(nowMeans).not.toEqual(["EVIL", "UNDEAD"]);
  });

  it("cannot re-point the NAMES a version-6 save stores", () => {
    const written = serializeLoreFlags(rfFlags(RF.EVIL, RF.UNDEAD));
    expect(written).toEqual(["EVIL", "UNDEAD"]);
    const read = written.map((n) => renumbered.indexOf(n));
    expect(read.map((f) => renumbered[f])).toEqual(["EVIL", "UNDEAD"]);
    expect(read).toEqual([RF.EVIL + 1, RF.UNDEAD + 1]);
  });
});

describe("a renumbered OBJ_MOD table", () => {
  /** One modifier inserted at index 0, ahead of even the stats. */
  const renumbered: readonly (string | undefined)[] = [
    "MOD_LUCK",
    ...OBJ_MOD_NAMES,
  ];

  const stored = ((): number[] => {
    const out = new Array<number>(OBJ_MOD_MAX).fill(0);
    out[OBJ_MOD.SPEED] = 2;
    out[OBJ_MOD.BLOWS] = 1;
    return out;
  })();

  it("re-points the INDICES a version-5 save stored", () => {
    /* Version 5's reader was "this dense array, through the current table". */
    const nowMeans = stored.flatMap((v, i) => (v === 0 ? [] : [[renumbered[i], v]]));
    expect(nowMeans).toEqual([
      ["TUNNEL", 2],
      ["SPEED", 1],
    ]);
    /* A +2 speed, +1 blows weapon has become +2 tunnelling, +1 speed. */
    expect(nowMeans).not.toEqual([
      ["SPEED", 2],
      ["BLOWS", 1],
    ]);
  });

  it("cannot re-point the NAMES a version-6 save stores", () => {
    const written = serializeObjectModifiers(stored);
    expect(written).toEqual({ SPEED: 2, BLOWS: 1 });
    const read = Object.entries(written).map(
      ([n, v]) => [renumbered[renumbered.indexOf(n)], v] as const,
    );
    expect(read).toEqual([
      ["SPEED", 2],
      ["BLOWS", 1],
    ]);
    /* The indices moved by one, and the weapon did not. */
    expect(renumbered.indexOf("SPEED")).toBe(OBJ_MOD.SPEED + 1);
  });
});

describe("a renumbered ELEM table", () => {
  const renumbered: readonly (string | undefined)[] = [
    "MOD_RADIANCE",
    ...ELEMENT_NAMES,
  ];

  const stored = ((): ElementInfo[] => {
    const out = newElemInfo();
    out[ELEM.FIRE] = { resLevel: 1, flags: 0 };
    out[ELEM.POIS] = { resLevel: 1, flags: 0 };
    return out;
  })();

  it("re-points the INDICES a version-5 save stored", () => {
    const nowMeans = stored.flatMap((e, i) =>
      e.resLevel === 0 && e.flags === 0 ? [] : [renumbered[i]],
    );
    expect(nowMeans).toEqual(["ELEC", "COLD"]);
    /* Resist fire and poison has silently become resist lightning and cold. */
    expect(nowMeans).not.toEqual(["FIRE", "POIS"]);
  });

  it("cannot re-point the NAMES a version-6 save stores", () => {
    const written = serializeObjectElements(stored);
    expect(Object.keys(written)).toEqual(["FIRE", "POIS"]);
    const read = Object.keys(written).map((n) => renumbered[renumbered.indexOf(n)]);
    expect(read).toEqual(["FIRE", "POIS"]);
    expect(renumbered.indexOf("FIRE")).toBe(ELEM.FIRE + 1);
  });
});
