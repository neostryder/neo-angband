import { describe, expect, it } from "vitest";
import { RF } from "../generated";
import { monReg } from "../game/harness";
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
