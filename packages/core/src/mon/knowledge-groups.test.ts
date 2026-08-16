import { describe, expect, it } from "vitest";
import { RF } from "../generated/index.js";
import {
  bindMonsterCategories,
  monsterKnowledgeGroups,
  UNCLASSIFIED_CATEGORY,
} from "./knowledge-groups.js";
import type { UiKnowledgeRecordJson } from "./knowledge-groups.js";
import type { MonsterRace } from "./types.js";

/** A flag set that answers has(idx) from a name list, matching FlagSet.has. */
function flags(...names: string[]): { has: (i: number) => boolean } {
  const set = new Set(names.map((n) => (RF as Record<string, number>)[n]));
  return { has: (i: number): boolean => set.has(i) };
}

function race(
  name: string,
  baseName: string,
  level: number,
  flagNames: string[] = [],
  ridx = 0,
): MonsterRace {
  return {
    ridx,
    name,
    base: { name: baseName } as MonsterRace["base"],
    flags: flags(...flagNames) as unknown as MonsterRace["flags"],
    level,
  } as unknown as MonsterRace;
}

/** The real 4.2.6 ui_knowledge.txt shape: Uniques (flag), then base categories.
 *  4.2.6 has no `mcat-include-other` - that directive is post-tag upstream work
 *  and left core with #143; see the note on matchesFlagOrOther. */
const RECORDS: UiKnowledgeRecordJson[] = [
  { "monster-category": "Uniques", "mcat-include-flag": ["UNIQUE"] },
  { "monster-category": "Dragons", "mcat-include-base": ["dragon", "ancient dragon"] },
  { "monster-category": "Ants", "mcat-include-base": ["ant"] },
];

describe("bindMonsterCategories (ui-knowledge.c parser)", () => {
  it("parses names, bases and flag lists", () => {
    const cats = bindMonsterCategories([
      { "monster-category": "X", "mcat-include-flag": ["UNIQUE | MALE"] },
      { "monster-category": "Z", "mcat-include-base": ["dragon"] },
    ]);
    expect(cats[0]!.incFlags).toEqual([RF.UNIQUE, RF.MALE]);
    expect(cats[1]!.incBases).toEqual(["dragon"]);
  });

  it("registers only the two directives 4.2.6's ui-knowledge.c does", () => {
    /* The guard on the removal. MonsterCategory used to carry
     * includeFullyKnown / includeNotFullyKnown from `mcat-include-other`, a
     * directive 4.2.6 does not register - so core was shipping an upstream
     * feature newer than its own baseline. If it comes back, it comes back
     * deliberately: this asserts the shape of what the binder produces. */
    const cat = bindMonsterCategories([{ "monster-category": "X" }])[0]!;
    expect(Object.keys(cat).sort()).toEqual(["incBases", "incFlags", "name"]);
  });
});

describe("monsterKnowledgeGroups (do_cmd_knowledge_monsters)", () => {
  const cats = bindMonsterCategories(RECORDS);

  it("puts a unique dragon in BOTH Uniques and Dragons (multi-membership)", () => {
    const smaug = race("Smaug", "ancient dragon", 60, ["UNIQUE"], 1);
    const groups = monsterKnowledgeGroups(cats, [{ race: smaug, allKnown: true }]);
    const names = groups.map((g) => g.name);
    expect(names).toContain("Uniques");
    expect(names).toContain("Dragons");
    expect(groups.find((g) => g.name === "Dragons")!.members[0]!.race).toBe(smaug);
  });

  it("orders a base group by base position, then level, then name", () => {
    const young = race("young dragon", "dragon", 20, [], 2);
    const ancient = race("ancient wyrm", "ancient dragon", 40, [], 3);
    const oldToo = race("old dragon", "dragon", 20, [], 4);
    const groups = monsterKnowledgeGroups(cats, [
      { race: ancient, allKnown: true },
      { race: young, allKnown: true },
      { race: oldToo, allKnown: true },
    ]);
    const dragons = groups.find((g) => g.name === "Dragons")!;
    /* "dragon" base (pos 0) before "ancient dragon" (pos 1); within "dragon",
       level 20 ties break by name: "old dragon" < "young dragon". */
    expect(dragons.members.map((m) => m.race.name)).toEqual([
      "old dragon",
      "young dragon",
      "ancient wyrm",
    ]);
  });

  it("falls back to ***Unclassified*** and drops empty groups", () => {
    const blob = race("gelatinous blob", "jelly", 5, [], 5);
    const groups = monsterKnowledgeGroups(cats, [{ race: blob, allKnown: true }]);
    /* jelly matches no category -> only the catch-all shows. */
    expect(groups.map((g) => g.name)).toEqual([UNCLASSIFIED_CATEGORY]);
  });

  it("does not sort by how much lore is known: 4.2.6 has no such category", () => {
    /* This asserted that an unlearned ant ALSO appeared under "Not Fully
     * Known". That category is driven by mcat-include-other, which 4.2.6's
     * ui-knowledge.c does not register and its ui_knowledge.txt does not use;
     * it arrived in core from upstream master and left again with #143.
     *
     * The check is kept, inverted: an ant is an ant whether or not its lore is
     * complete, and `allKnown` must not change which groups it lands in. */
    const ant = race("giant ant", "ant", 3, [], 6);
    const unlearned = monsterKnowledgeGroups(cats, [{ race: ant, allKnown: false }]);
    const learned = monsterKnowledgeGroups(cats, [{ race: ant, allKnown: true }]);
    expect(unlearned.map((g) => g.name)).toEqual(["Ants"]);
    expect(learned.map((g) => g.name)).toEqual(unlearned.map((g) => g.name));
  });
});
