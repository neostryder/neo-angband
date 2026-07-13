import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ, RF, RSF } from "../generated";
import { monReg } from "../game/harness";
import { Rng } from "../rng";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import type { MonsterRace } from "./types";
import { cheatMonsterLore, newMonsterLore } from "./lore";
import type { MonsterLore } from "./lore";
import { LoreTextBuilder, loreDescription } from "./lore-describe";
import type { LoreDeps } from "./lore-describe";

function deps(): LoreDeps {
  return {
    playerLevel: 10,
    playerMaxDepth: 5,
    playerSpeed: 110,
    effectiveSpeed: false,
    spells: monReg.spells,
  };
}

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

/** The real element divisor/damage-cap table (world/projection.ts), for the
 * one piece of breath lore damage that lives outside mon/. */
const projections = bindProjections(packJson<ProjectionRecordJson>("projection"));

/** deps() plus the breath-projection lookup, for spells that breathe. */
function depsWithBreath(): LoreDeps {
  return { ...deps(), breathProjection: (subtype) => projections[subtype] };
}

/** The recall text of a race, flattened to one string. */
function recallText(race: MonsterRace, lore: MonsterLore): string {
  return loreDescription(race, lore, deps())
    .map((r) => r.text)
    .join("");
}

/** A placeable, non-unique race carrying flavor text and at least one blow. */
const normalRace = monReg.races.find(
  (r) =>
    r.rarity > 0 &&
    r.blows.length > 0 &&
    r.text.length > 0 &&
    !r.flags.has(RF.UNIQUE),
) as MonsterRace;

describe("LoreTextBuilder", () => {
  it("pushes non-empty runs in order and drops empty ones", () => {
    const b = new LoreTextBuilder();
    b.append("a").append("", 5).append("b", 4);
    expect(b.build()).toEqual([
      { text: "a", color: 1 },
      { text: "b", color: 4 },
    ]);
  });
});

describe("lore_description (ui-mon-lore.c L89)", () => {
  it("titles a non-unique with 'The ' and its name and glyph", () => {
    const runs = loreDescription(normalRace, newMonsterLore(normalRace), deps());
    expect(runs[0]!.text).toBe("The ");
    const text = runs.map((r) => r.text).join("");
    expect(text).toContain(normalRace.name);
    expect(text).toContain("('");
  });

  it("includes the flavor text and a kill line for fresh lore", () => {
    const text = recallText(normalRace, newMonsterLore(normalRace));
    expect(text).toContain(normalRace.text);
    expect(text).toContain("No battles to the death are recalled.");
  });

  it("states the experience reward and the player-level dependence", () => {
    const text = recallText(normalRace, newMonsterLore(normalRace));
    expect(text).toContain("is worth");
    expect(text).toContain("level character.");
  });

  it("announces full knowledge once everything is learned", () => {
    const lore = newMonsterLore(normalRace);
    cheatMonsterLore(normalRace, lore);
    const text = recallText(normalRace, lore);
    expect(text).toContain("You know everything about this monster.");
  });

  it("describes a unique's kills and does not prefix 'The '", () => {
    const unique = monReg.races.find(
      (r) => r.flags.has(RF.UNIQUE) && r.rarity > 0,
    ) as MonsterRace;
    const runs = loreDescription(unique, newMonsterLore(unique), deps());
    expect(runs[0]!.text).not.toBe("The ");
    expect(runs.map((r) => r.text).join("")).toContain(unique.name);
  });
});

describe("monSpellLoreDamage (mon-spell.c L698)", () => {
  /* A breathing race (hp-scaled damage via breath_dam), used to check the
   * know_hp (armour_known) gating. */
  const dragon = monReg.races.find(
    (r) => r.spellFlags.has(RSF.BR_POIS) && r.avgHp > 0,
  ) as MonsterRace;

  /* A caster with two SPELL_POWER-scaled damage spells (BA_ACID / BO_ACID,
   * reference/lib/gamedata/monster_spell.txt), for the non-breath (nonhp_dam)
   * path, which upstream never gates on know_hp. */
  const caster = monReg.races.find(
    (r) => r.spellFlags.has(RSF.BA_ACID) && r.spellFlags.has(RSF.BO_ACID),
  ) as MonsterRace;

  it("shows the avg-hp-scaled breath damage once armour is known, and hides it otherwise", () => {
    const proj = projections[PROJ.POIS]!;
    const expected = Math.min(Math.trunc(dragon.avgHp / proj.divisor), proj.damageCap);
    expect(expected).toBeGreaterThan(0);

    const known = newMonsterLore(dragon);
    known.spellFlags.on(RSF.BR_POIS);
    known.armourKnown = true;
    const knownText = loreDescription(dragon, known, depsWithBreath())
      .map((r) => r.text)
      .join("");
    expect(knownText).toContain(`poison (${expected})`);

    const unknown = newMonsterLore(dragon);
    unknown.spellFlags.on(RSF.BR_POIS);
    unknown.armourKnown = false;
    const unknownText = loreDescription(dragon, unknown, depsWithBreath())
      .map((r) => r.text)
      .join("");
    expect(unknownText).toContain("poison");
    expect(unknownText).not.toMatch(/poison \(\d+\)/);

    /* Without a breathProjection dependency wired at all, damage stays
     * hidden too (the DEFERRED default). */
    const unwiredText = loreDescription(dragon, known, deps())
      .map((r) => r.text)
      .join("");
    expect(unwiredText).not.toMatch(/poison \(\d+\)/);
  });

  it("shows dice-based spell damage from the SPELL_POWER expression regardless of know_hp", () => {
    /* BA_ACID: dice 15+1d$S, expr S = SPELL_POWER * 3 -> max 15 + 3*power. */
    const expectedBall = 15 + 3 * caster.spellPower;
    /* BO_ACID: dice $B+7d8, expr B = SPELL_POWER / 3 -> max trunc(power/3) + 56. */
    const expectedBolt = Math.trunc(caster.spellPower / 3) + 7 * 8;

    const lore = newMonsterLore(caster);
    lore.spellFlags.on(RSF.BA_ACID);
    lore.spellFlags.on(RSF.BO_ACID);
    lore.armourKnown = false; // nonhp damage must not depend on this

    const text = loreDescription(caster, lore, deps())
      .map((r) => r.text)
      .join("");
    expect(text).toContain(`(${expectedBall})`);
    expect(text).toContain(`(${expectedBolt})`);
  });

  it("draws no randomness while building the recall text (pure display)", () => {
    const rng = new Rng(12345);
    const before = rng.getState();

    const dragonLore = newMonsterLore(dragon);
    dragonLore.spellFlags.on(RSF.BR_POIS);
    dragonLore.armourKnown = true;
    loreDescription(dragon, dragonLore, depsWithBreath());

    const casterLore = newMonsterLore(caster);
    casterLore.spellFlags.on(RSF.BA_ACID);
    casterLore.spellFlags.on(RSF.BO_ACID);
    loreDescription(caster, casterLore, depsWithBreath());

    expect(rng.getState()).toEqual(before);
  });
});
