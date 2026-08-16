import { describe, expect, it } from "vitest";
import { loc } from "../loc.js";
import { FEAT } from "../generated/index.js";
import { addMon, makeRace, makeState, monReg } from "./harness.js";
import {
  bindQuests,
  dungeonGetNextLevel,
  isQuest,
  playerQuestsReset,
  playerSetRecallDepth,
  questCheck,
} from "./quest.js";
import type { QuestRecordJson } from "./quest.js";
import type { Player } from "../player/player.js";

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

describe("playerSetRecallDepth (player-util.c L79)", () => {
  /* z_info: stair_skip 1, max_depth 128 - the shipped constants. */
  const z = { stairSkip: 1, maxDepth: 128 };

  function player(maxDepth: number, recallDepth: number): Player {
    const state = makeState();
    playerQuestsReset(state.actor.player, quests);
    state.actor.player.maxDepth = maxDepth;
    state.actor.player.recallDepth = recallDepth;
    return state.actor.player;
  }

  it("leaves an already-chosen recall depth alone without force_descend", () => {
    /* The whole point of the function upstream: outside force_descend it is a
     * floor, not an assignment. The port used to overwrite recallDepth with
     * maxDepth here, which threw away the destination a persistent-levels
     * player had just been prompted for. */
    const p = player(40, 17);
    playerSetRecallDepth(p, false, z);
    expect(p.recallDepth).toBe(17);
    expect(p.maxDepth).toBe(40);
  });

  it("sends a character who has never descended to level 1, not the town", () => {
    const p = player(0, 0);
    playerSetRecallDepth(p, false, z);
    expect(p.recallDepth).toBe(1);
  });

  it("force_descend recalls one level BELOW max_depth", () => {
    const p = player(40, 40);
    playerSetRecallDepth(p, true, z);
    expect(p.recallDepth).toBe(41);
    /* Derived, not written down: whatever dungeon_get_next_level says. */
    expect(p.recallDepth).toBe(dungeonGetNextLevel(p, 40, 1, z));
  });

  it("force_descend does NOT step past an unfinished quest at max_depth", () => {
    /* Sauron alive at max_depth: the step-down arm is skipped ENTIRELY, so
     * recall_depth keeps whatever it held.
     *
     * recall_depth is deliberately not 99 here. With recall_depth == max_depth
     * this guard cannot be observed at all, because dungeonGetNextLevel's own
     * intermediate-quest scan already returns 99 for (99, +1) - the same answer
     * the guard produces by doing nothing. See the MUTATION NOTE in quest.ts:
     * in play the two are always equal, so this is a contract test on the
     * exported function, not a reachable scenario. */
    const p = player(99, 40);
    expect(isQuest(p, 99)).toBe(true);
    playerSetRecallDepth(p, true, z);
    expect(p.recallDepth).toBe(40);
  });

  it("force_descend steps past a quest depth once it is completed", () => {
    const p = player(99, 99);
    p.quests[0]!.level = 0; /* Sauron slain. */
    playerSetRecallDepth(p, true, z);
    expect(p.recallDepth).toBe(100);
  });

  it("force_descend does not step below the bottom of the dungeon", () => {
    /* Same shape as the quest guard above: with recall_depth == max_depth the
     * guard is shadowed by dungeonGetNextLevel's own max_depth - 1 clamp, so
     * the separating input is a recall_depth that differs. */
    const p = player(z.maxDepth - 1, 40);
    playerSetRecallDepth(p, true, z);
    expect(p.recallDepth).toBe(40);

    /* And the in-play state, which the clamp answers identically. */
    const q = player(z.maxDepth - 1, z.maxDepth - 1);
    playerSetRecallDepth(q, true, z);
    expect(q.recallDepth).toBe(z.maxDepth - 1);
  });

  it("applies the level-1 floor even under force_descend", () => {
    /* max_depth 0 in town: the step-down arm runs (0 < 127, town is never a
     * quest) and lands on 1 by itself; the floor is what guarantees it. */
    const p = player(0, 0);
    playerSetRecallDepth(p, true, z);
    expect(p.recallDepth).toBe(1);
  });
});
