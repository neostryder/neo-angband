import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { FEAT } from "../generated";
import { addMon, makeRace, makeState, monReg } from "./harness";
import {
  bindQuests,
  isQuest,
  playerQuestsReset,
  questCheck,
} from "./quest";
import type { QuestRecordJson } from "./quest";

/** The shipped quest table (quest.txt / quest.json). */
const QUEST_RECORDS: QuestRecordJson[] = [
  { name: "Sauron", level: 99, race: "Sauron, the Sorcerer", number: 1 },
  { name: "Morgoth", level: 100, race: "Morgoth, Lord of Darkness", number: 1 },
];

const quests = bindQuests(QUEST_RECORDS, monReg);
const sauronRace = monReg.raceByName("Sauron, the Sorcerer")!;
const morgothRace = monReg.raceByName("Morgoth, Lord of Darkness")!;

describe("bindQuests", () => {
  it("resolves guardian races by name in file order", () => {
    expect(quests).toHaveLength(2);
    expect(quests[0]!.name).toBe("Sauron");
    expect(quests[0]!.index).toBe(0);
    expect(quests[0]!.level).toBe(99);
    expect(quests[0]!.race).toBe(sauronRace);
    expect(quests[0]!.maxNum).toBe(1);
    expect(quests[1]!.race).toBe(morgothRace);
    expect(quests[1]!.level).toBe(100);
  });
});

describe("isQuest (player-quest.c L140)", () => {
  it("is true on quest depths, false in town and elsewhere", () => {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    const p = state.actor.player;

    expect(isQuest(p, 99)).toBe(true);
    expect(isQuest(p, 100)).toBe(true);
    /* Town (0) is never a quest, even though it would never match anyway. */
    expect(isQuest(p, 0)).toBe(false);
    expect(isQuest(p, 50)).toBe(false);
    expect(isQuest(p, 98)).toBe(false);
  });

  it("stops being a quest depth once the quest is completed", () => {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    const p = state.actor.player;
    /* Simulate Sauron's quest being finished (level cleared). */
    p.quests[0]!.level = 0;
    expect(isQuest(p, 99)).toBe(false);
    expect(isQuest(p, 100)).toBe(true);
  });
});

describe("playerQuestsReset (player-quest.c L157)", () => {
  it("copies the standard quests with zeroed kill counts", () => {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    const q = state.actor.player.quests;
    expect(q).toHaveLength(2);
    expect(q[0]).toEqual({
      name: "Sauron",
      level: 99,
      race: sauronRace.ridx,
      maxNum: 1,
      curNum: 0,
    });
    expect(q[1]!.race).toBe(morgothRace.ridx);
  });
});

describe("questCheck (player-quest.c L219)", () => {
  it("wins the game only after the LAST quest guardian falls", () => {
    const msgs: string[] = [];
    const state = makeState();
    state.msg = (t): void => {
      msgs.push(t);
    };
    playerQuestsReset(state.actor.player, quests);
    const p = state.actor.player;

    /* Slay Sauron on depth 99: quest completes, stairs appear, but Morgoth
     * remains so the game is not yet won. */
    state.chunk.depth = 99;
    const sauronGrid = loc(10, 10);
    const sauron = addMon(state, sauronRace, sauronGrid);
    expect(questCheck(state, p, sauron)).toBe(true);
    expect(p.quests[0]!.curNum).toBe(1);
    expect(p.quests[0]!.level).toBe(0); // completed
    expect(p.totalWinner).toBe(false); // Morgoth still alive
    /* build_quest_stairs placed a down staircase on the death grid. */
    expect(state.chunk.feat(sauronGrid)).toBe(FEAT.MORE);
    expect(state.chunk.isDownstairs(sauronGrid)).toBe(true);
    expect(msgs).toContain("A magical staircase appears...");
    expect(msgs).not.toContain("You have won the game!");

    /* Slay Morgoth on depth 100: the last quest, so the game is won. */
    state.chunk.depth = 100;
    const morgothGrid = loc(20, 12);
    const morgoth = addMon(state, morgothRace, morgothGrid);
    expect(questCheck(state, p, morgoth)).toBe(true);
    expect(p.quests[1]!.level).toBe(0);
    expect(p.totalWinner).toBe(true);
    expect(state.chunk.feat(morgothGrid)).toBe(FEAT.MORE);
    expect(msgs).toContain("*** CONGRATULATIONS ***");
    expect(msgs).toContain("You have won the game!");
  });

  it("does nothing when the guardian dies on the wrong depth", () => {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    const p = state.actor.player;

    state.chunk.depth = 50; // not Morgoth's quest level
    const grid = loc(10, 10);
    const morgoth = addMon(state, morgothRace, grid);
    expect(questCheck(state, p, morgoth)).toBe(false);
    expect(p.quests[1]!.curNum).toBe(0);
    expect(p.quests[1]!.level).toBe(100); // still active
    expect(p.totalWinner).toBe(false);
    expect(state.chunk.feat(grid)).not.toBe(FEAT.MORE);
  });

  it("is a no-op for a non-quest monster on a quest depth", () => {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    const p = state.actor.player;

    state.chunk.depth = 100; // Morgoth's depth
    const grid = loc(10, 10);
    const rat = addMon(state, makeRace({ level: 1 }), grid);
    expect(questCheck(state, p, rat)).toBe(false);
    expect(p.quests[0]!.curNum).toBe(0);
    expect(p.quests[1]!.curNum).toBe(0);
    expect(p.totalWinner).toBe(false);
    expect(state.chunk.feat(grid)).not.toBe(FEAT.MORE);
  });

  it("consumes no RNG on a non-completing death (scatter is not reached)", () => {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    const p = state.actor.player;

    state.chunk.depth = 50;
    const before = JSON.stringify(state.rng.getState());
    const morgoth = addMon(state, morgothRace, loc(10, 10));
    questCheck(state, p, morgoth);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });

  it("consumes no RNG completing on open floor (build_quest_stairs skips scatter)", () => {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    const p = state.actor.player;
    /* Only Morgoth remains, so this kill wins outright. */
    p.quests[0]!.level = 0;

    state.chunk.depth = 100;
    /* An open floor grid is square_changeable, so the stagger loop never runs
     * and no scatter draw is made. */
    const grid = loc(15, 12);
    const before = JSON.stringify(state.rng.getState());
    const morgoth = addMon(state, morgothRace, grid);
    expect(questCheck(state, p, morgoth)).toBe(true);
    expect(p.totalWinner).toBe(true);
    expect(state.chunk.feat(grid)).toBe(FEAT.MORE);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });
});
