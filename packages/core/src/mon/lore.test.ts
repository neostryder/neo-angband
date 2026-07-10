import { describe, expect, it } from "vitest";
import { MFLAG, RF } from "../generated";
import { Rng } from "../rng";
import { blankMonster } from "./monster";
import { makeRace } from "../game/harness";
import {
  cheatMonsterLore,
  createMonFlagMask,
  getLore,
  loreDoProbe,
  loreIsFullyKnown,
  loreLearnFlagIfVisible,
  loreLearnSpellIfHas,
  loreTreasure,
  loreUpdate,
  monsterFlagsKnown,
  newMonsterLore,
  wipeMonsterLore,
} from "./lore";
import type { LoreStore } from "./lore";

describe("get_lore (mon-lore.c L1735) and the flag mask", () => {
  it("creates a blank record lazily and reuses it", () => {
    const store: LoreStore = new Map();
    const race = makeRace();
    const lore = getLore(store, race);
    expect(lore.sights).toBe(0);
    expect(lore.blowKnown.length).toBe(race.blows.length);
    expect(getLore(store, race)).toBe(lore);
  });

  it("create_mon_flag_mask unions a category's flags", () => {
    const mask = createMonFlagMask("RFT_OBV");
    expect(mask.has(RF.UNIQUE)).toBe(true);
    expect(mask.has(RF.GROUP_AI)).toBe(true);
    expect(mask.has(RF.FORCE_DEPTH)).toBe(false); /* RFT_GEN */
  });
});

describe("lore_update (L303)", () => {
  it("assumes the obvious flags and knows seen blows", () => {
    const race = makeRace();
    const lore = newMonsterLore(race);
    lore.blowTimesSeen[0] = 1;
    loreUpdate(race, lore);
    expect(lore.flags.has(RF.UNIQUE)).toBe(true); /* known, not present */
    expect(lore.blowKnown[0]).toBe(true);
    expect(lore.armourKnown).toBe(false);
  });

  it("a kill reveals armour, drops and the racial/drop flags", () => {
    const race = makeRace();
    const lore = newMonsterLore(race);
    lore.tkills = 1;
    loreUpdate(race, lore);
    expect(lore.armourKnown).toBe(true);
    expect(lore.dropKnown).toBe(true);
    expect(lore.flags.has(RF.FORCE_DEPTH)).toBe(true);
  });

  it("watching wakes and 50+ casts reveal sleep and frequency", () => {
    const race = makeRace();
    race.sleep = 20;
    const lore = newMonsterLore(race);
    lore.wake = 5; /* 25 > 20 */
    lore.castSpell = 51;
    loreUpdate(race, lore);
    expect(lore.sleepKnown).toBe(true);
    expect(lore.spellFreqKnown).toBe(true);
    expect(lore.innateFreqKnown).toBe(false);
  });
});

describe("probe / cheat / wipe / fully-known", () => {
  it("lore_do_probe learns everything about the race", () => {
    const store: LoreStore = new Map();
    const race = makeRace();
    const mon = blankMonster(race);
    loreDoProbe(store, mon);
    const lore = getLore(store, race);
    expect(lore.allKnown).toBe(true);
    expect(lore.flags.isFull()).toBe(true);
    expect(lore.spellFlags.isEqual(race.spellFlags)).toBe(true);
    expect(loreIsFullyKnown(store, race)).toBe(true);
  });

  it("cheat then wipe forgets everything", () => {
    const race = makeRace();
    const lore = newMonsterLore(race);
    cheatMonsterLore(race, lore);
    expect(lore.allKnown).toBe(true);
    wipeMonsterLore(race, lore);
    expect(lore.allKnown).toBe(false);
    expect(lore.flags.isEmpty()).toBe(true);
    expect(lore.blowKnown.every((b) => !b)).toBe(true);
  });

  it("a fresh race is not fully known", () => {
    const store: LoreStore = new Map();
    expect(loreIsFullyKnown(store, makeRace())).toBe(false);
  });
});

describe("lore_treasure (L502) and observation helpers", () => {
  it("notes drop maxima, quality flags and eventually ONLY_ITEM", () => {
    const rng = new Rng(7);
    const race = makeRace();
    const lore = newMonsterLore(race);
    for (let i = 0; i < 20; i++) loreTreasure(rng, lore, 2, 0);
    expect(lore.dropItem).toBe(2);
    expect(lore.dropGold).toBe(0);
    expect(lore.flags.has(RF.DROP_GOOD)).toBe(true);
    expect(lore.flags.has(RF.DROP_GREAT)).toBe(true);
    expect(lore.flags.has(RF.ONLY_ITEM)).toBe(true); /* one_in_(4) hit */
    expect(lore.flags.has(RF.ONLY_GOLD)).toBe(false);
  });

  it("lore_learn_flag_if_visible gates on visibility", () => {
    const race = makeRace({ flags: [RF.EVIL] });
    const lore = newMonsterLore(race);
    const mon = blankMonster(race);
    loreLearnFlagIfVisible(lore, mon, RF.EVIL);
    expect(lore.flags.has(RF.EVIL)).toBe(false);
    mon.mflag.on(MFLAG.VISIBLE);
    loreLearnFlagIfVisible(lore, mon, RF.EVIL);
    expect(lore.flags.has(RF.EVIL)).toBe(true);
  });

  it("lore_learn_spell_if_has learns only spells the race has", () => {
    const race = makeRace();
    const lore = newMonsterLore(race);
    const spell = race.spellFlags.next(1);
    if (spell > 0) {
      loreLearnSpellIfHas(lore, race, spell);
      expect(lore.spellFlags.has(spell)).toBe(true);
    }
    /* A spell the race lacks is not learned. */
    const missing = 1;
    if (!race.spellFlags.has(missing)) {
      loreLearnSpellIfHas(lore, race, missing);
      expect(lore.spellFlags.has(missing)).toBe(false);
    }
  });

  it("monster_flags_known masks the race flags to observations", () => {
    const race = makeRace({ flags: [RF.EVIL] });
    const lore = newMonsterLore(race);
    expect(monsterFlagsKnown(race, lore).has(RF.EVIL)).toBe(false);
    lore.flags.on(RF.EVIL);
    expect(monsterFlagsKnown(race, lore).has(RF.EVIL)).toBe(true);
    /* Knowing a flag the race lacks does not invent it. */
    lore.flags.on(RF.UNDEAD);
    expect(monsterFlagsKnown(race, lore).has(RF.UNDEAD)).toBe(false);
  });
});
