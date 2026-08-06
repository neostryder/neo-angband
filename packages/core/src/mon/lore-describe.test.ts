import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ, RF, RSF } from "../generated/index.js";
import { monReg } from "../game/harness.js";
import { Rng } from "../rng.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import type { MonsterRace } from "./types.js";
import { cheatMonsterLore, newMonsterLore } from "./lore.js";
import type { MonsterLore } from "./lore.js";
import { LoreTextBuilder, loreDescription } from "./lore-describe.js";
import type { LoreDeps, LoreTextRun } from "./lore-describe.js";
import { COLOUR_VIOLET } from "../color.js";

function deps(): LoreDeps {
  return {
    playerLevel: 10,
    playerMaxDepth: 5,
    playerSpeed: 110,
    effectiveSpeed: false,
    purpleUniques: false,
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

describe("lore_title and purple_uniques (ui-mon-lore.c L38-60, PORT_TODO 3.22)", () => {
  /** The title's glyph run: the single-char run right after " ('". */
  function titleGlyph(race: MonsterRace, purpleUniques: boolean): LoreTextRun {
    const lore = newMonsterLore(race);
    cheatMonsterLore(race, lore);
    const text = loreDescription(race, lore, { ...deps(), purpleUniques });
    const open = text.findIndex((r) => r.text === " ('");
    expect(open, "the title emits the \" ('\" opener").toBeGreaterThanOrEqual(0);
    const glyph = text[open + 1];
    expect(glyph, "a glyph run follows the opener").toBeDefined();
    return glyph as LoreTextRun;
  }

  /* Derive the fixture from the pack rather than declaring it: the test can only
   * see the recolour if the unique's own d_attr is NOT already violet, and it can
   * only see the non-unique exemption on a race whose d_attr differs too. Both
   * are asserted, so a pack change that erases the contrast fails here instead of
   * silently making the test vacuous. */
  const uniqueRace = monReg.races.find(
    (r) => r.flags.has(RF.UNIQUE) && r.dAttr !== COLOUR_VIOLET,
  );
  const plainRace = monReg.races.find(
    (r) => !r.flags.has(RF.UNIQUE) && r.dAttr !== COLOUR_VIOLET,
  );

  it("recolours a unique's title glyph violet when the option is on", () => {
    expect(uniqueRace, "fixture: a non-violet unique exists in the pack").toBeDefined();
    const race = uniqueRace as MonsterRace;

    expect(titleGlyph(race, false).color, "option off: the race's own colour")
      .toBe(race.dAttr);
    expect(titleGlyph(race, true).color, "option on: violet").toBe(COLOUR_VIOLET);
    /* The character never changes - only the attr (L57). */
    expect(titleGlyph(race, true).text).toBe(race.dChar);
  });

  it("leaves a non-unique alone with the option on", () => {
    expect(plainRace, "fixture: a non-violet ordinary monster exists").toBeDefined();
    const race = plainRace as MonsterRace;

    expect(titleGlyph(race, true).color, "the L56 branch is an `else if` on !UNIQUE")
      .toBe(race.dAttr);
    expect(titleGlyph(race, false).color).toBe(race.dAttr);
  });

  it('only a non-unique gets the "The " prefix', () => {
    const ur = uniqueRace as MonsterRace;
    const pr = plainRace as MonsterRace;
    const u = loreDescription(ur, newMonsterLore(ur), deps());
    const p = loreDescription(pr, newMonsterLore(pr), deps());
    expect(u[0]?.text).not.toBe("The ");
    expect(p[0]?.text).toBe("The ");
  });
});

/**
 * lore_description's `spoilers` argument (ui-mon-lore.c L90), PORT_TODO 5.6.
 *
 * It gates FOUR sections, and the port used to have none of them: game/spoil.ts
 * passed no flag and sliced the first line off the result, which removed the
 * title and left the kill counts, the toughness block and the experience reward
 * in a file that has no player to be subjective about.
 *
 * Every expectation below is DERIVED from the same race's player-view text
 * rather than declared, so the test says "the spoiler view drops what the
 * player view shows" and cannot drift with the content pack.
 */
describe("lore_description spoilers (ui-mon-lore.c L90)", () => {
  /** A race whose player view exercises all four gated sections. */
  const race = normalRace;

  function view(spoilers: boolean): string {
    const lore = newMonsterLore(race);
    cheatMonsterLore(race, lore);
    /* Kills are lore, not race data: give the player some to count, so the
     * kills section has something to print in the player view. Without this
     * the "dropped" assertion would pass against an empty section. */
    lore.pkills = 7;
    lore.tkills = 9;
    return loreDescription(race, lore, deps(), spoilers)
      .map((r) => r.text)
      .join("");
  }

  const player = view(false);
  const spoiler = view(true);

  it("drops the title, so the caller needs no slice", () => {
    expect(player.startsWith("The ")).toBe(true);
    expect(spoiler.startsWith("The ")).toBe(false);
    expect(spoiler).not.toContain(`The ${race.name} ('`);
  });

  it("drops the kill counts", () => {
    /* lore_append_kills' player-view sentence names the count; the spoiler
     * view has no player whose kills could be counted. */
    expect(player).toMatch(/killed at least 7 of these/u);
    expect(spoiler).not.toMatch(/killed at least/u);
  });

  it("drops the toughness and experience blocks", () => {
    /* toughness: the life / armour sentence, which also carries the player's
       own melee hit chance - subjective twice over. */
    expect(player).toMatch(/armor rating/u);
    expect(player).toMatch(/chance to hit such a creature/u);
    expect(spoiler).not.toMatch(/armor rating/u);
    expect(spoiler).not.toMatch(/chance to hit such a creature/u);
    /* exp: "worth N points for a Kth level character" - scaled by the player's
       level, so upstream leaves it out of a file with no player. */
    expect(player).toMatch(/points for a \d+\w+ level character/u);
    expect(spoiler).not.toMatch(/points for a/u);
  });

  it("keeps everything that is not about the player", () => {
    /* The control. If `spoilers` suppressed too much, this would catch it:
     * flavour, movement, drops, abilities and attacks all survive. */
    expect(spoiler.length).toBeGreaterThan(0);
    expect(spoiler).toContain(race.text.slice(0, 24));
    /* lore_append_movement's opening clause is in both views. */
    const moves = /moves|never moves/u;
    expect(player).toMatch(moves);
    expect(spoiler).toMatch(moves);
  });
});
