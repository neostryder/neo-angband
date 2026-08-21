import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, RF } from "../generated/index.js";
import { Rng } from "../rng.js";
import { blankMonster } from "./monster.js";
import { makeRace } from "../game/harness.js";
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
} from "./lore.js";
import type { LoreStore } from "./lore.js";
import { bindMonsters } from "./bind.js";

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

/**
 * finish_parse_lore's base-flag union (mon-init.c:2570-2575).
 *
 * Upstream walks every race at startup and does
 * `rf_union(l->flags, r->base->flags)` before `lore_update`, so a player who
 * has never met a giant black ant still knows ants are ANIMAL and WEIRD_MIND.
 *
 * IT IS A FINISH HOOK, and the port did not have it. Measured 2026-08-20
 * against the shipped pack: a fresh lore for a giant black ant knew neither of
 * its base's flags, which made monster recall quieter than upstream's for every
 * monster the player has not met - 54 of the 56 shipped bases carry flags. The
 * race side of the inheritance was ported (mon/bind.ts unions the base's flags
 * into the RACE), which is exactly why nothing noticed: the flags were there,
 * they were simply never known.
 *
 * Run against the REAL monster pack rather than a fixture, because the claim is
 * about what a player of the shipped game knows, and a fixture base whose flags
 * this test chose would assert nothing about that.
 */
describe("a monster's base flags are known before meeting it", () => {
  const packJson = <T,>(name: string): T[] =>
    (
      JSON.parse(
        readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
      ) as { records: T[] }
    ).records;
  const registry = bindMonsters({
    pain: packJson("pain"),
    blowMethods: packJson("blow_methods"),
    blowEffects: packJson("blow_effects"),
    monsterSpells: packJson("monster_spell"),
    monsterBases: packJson("monster_base"),
    monsters: packJson("monster"),
    summons: packJson("summon"),
    pits: packJson("pit"),
  } as never);

  it("knows the flags an ant's base carries", () => {
    const ant = registry.races.find((r) => r.name === "giant black ant")!;
    expect(ant.base.name).toBe("ant");
    /* The base really does carry them - otherwise the assertions below would
     * pass for the wrong reason. */
    expect(ant.base.flags.has(RF.ANIMAL)).toBe(true);
    expect(ant.base.flags.has(RF.WEIRD_MIND)).toBe(true);

    const lore = newMonsterLore(ant);
    expect(lore.flags.has(RF.ANIMAL)).toBe(true);
    expect(lore.flags.has(RF.WEIRD_MIND)).toBe(true);
    /* And a flag the base does NOT carry is still unknown, so this is a union
     * and not a `setall` wearing one's clothes. */
    expect(lore.flags.has(RF.UNIQUE)).toBe(false);
  });

  it("does NOT come back after a wizard wipe, exactly as upstream", () => {
    /* The half that pins the placement. Upstream unions the base flags ONCE at
     * startup, so `wipe_monster_lore` genuinely loses them and `lore_update` on
     * the next blow does not restore them. Doing the union in `loreUpdate`
     * instead - which was the first thing tried here - would have made the
     * port's wizard wipe less complete than the C's. */
    const ant = registry.races.find((r) => r.name === "giant black ant")!;
    const lore = newMonsterLore(ant);
    expect(lore.flags.has(RF.ANIMAL)).toBe(true);

    wipeMonsterLore(ant, lore);
    expect(lore.flags.isEmpty()).toBe(true);
    loreUpdate(ant, lore);
    expect(lore.flags.has(RF.ANIMAL)).toBe(false);
  });

  it("does it for every race in the pack", () => {
    /* The whole claim, on the whole pack: no race's base flags are unknown to a
     * fresh lore. A per-race loop rather than one spot check, because the union
     * reads `race.base` and a race with an odd base is exactly what would slip
     * past a single example. */
    for (const race of registry.races) {
      const lore = newMonsterLore(race);
      for (let i = 0; i < race.base.flags.bits.length; i++) {
        expect(
          (lore.flags.bits[i]! & race.base.flags.bits[i]!) === race.base.flags.bits[i]!,
          `${race.name}: lore is missing a flag from base ${race.base.name}`,
        ).toBe(true);
      }
    }
  });
});
