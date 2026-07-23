import { describe, expect, it } from "vitest";
import { RF } from "../generated";
import {
  bindMonsterCategories,
  monsterKnowledgeGroups,
  UNCLASSIFIED_CATEGORY,
} from "./knowledge-groups";
import type { UiKnowledgeRecordJson } from "./knowledge-groups";
import type { MonsterRace } from "./types";

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

/** The real ui_knowledge.txt shape: Uniques (flag), Not Fully Known (other),
 *  then two base categories. */
const RECORDS: UiKnowledgeRecordJson[] = [
  { "monster-category": "Uniques", "mcat-include-flag": ["UNIQUE"] },
  { "monster-category": "Not Fully Known", "mcat-include-other": ["not-fully-known"] },
  { "monster-category": "Dragons", "mcat-include-base": ["dragon", "ancient dragon"] },
  { "monster-category": "Ants", "mcat-include-base": ["ant"] },
];

describe("bindMonsterCategories (ui-knowledge.c parser)", () => {
  it("parses names, bases, flag lists and the fully/not-fully-known others", () => {
    const cats = bindMonsterCategories([
      { "monster-category": "X", "mcat-include-flag": ["UNIQUE | MALE"] },
      { "monster-category": "Y", "mcat-include-other": ["fully-known", "not-fully-known"] },
      { "monster-category": "Z", "mcat-include-base": ["dragon"] },
    ]);
    expect(cats[0]!.incFlags).toEqual([RF.UNIQUE, RF.MALE]);
    expect(cats[1]!.includeFullyKnown).toBe(true);
    expect(cats[1]!.includeNotFullyKnown).toBe(true);
    expect(cats[2]!.incBases).toEqual(["dragon"]);
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

  it("routes a not-fully-known non-unique into Not Fully Known", () => {
    const ant = race("giant ant", "ant", 3, [], 6);
    const groups = monsterKnowledgeGroups(cats, [{ race: ant, allKnown: false }]);
    const names = groups.map((g) => g.name);
    /* An unlearned ant appears under both Not Fully Known and Ants. */
    expect(names).toContain("Not Fully Known");
    expect(names).toContain("Ants");
  });
});
