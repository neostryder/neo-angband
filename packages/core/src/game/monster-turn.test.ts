import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, RF, SQUARE } from "../generated";
import { distance, loc } from "../loc";
import { makeNoise } from "../world/flow";
import { GROUP_TYPE } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import { updateMonsterDistances } from "./context";
import { monsterAddToGroup, monsterGroupStart } from "./mon-group";
import { STAGGER, monsterTurn, monsterTurnShouldStagger } from "./monster-turn";
import { addMon, makeBlow, makeRace, makeState } from "./harness";

describe("monster movement AI", () => {
  it("follows the noise flow, closing on the player each turn", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5, hearing: 30 });
    const mon = addMon(state, race, loc(25, 10));

    let prev = distance(mon.grid, state.actor.grid);
    for (let step = 0; step < 5; step++) {
      updateMonsterDistances(state);
      makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });
      monsterTurn(mon, state);
      const now = distance(mon.grid, state.actor.grid);
      expect(now).toBeLessThan(prev);
      prev = now;
    }
    /* Never walked onto the player. */
    expect(prev).toBeGreaterThanOrEqual(1);
  });

  it("beelines to a visible player and melees when adjacent", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const blow = makeBlow("HIT", "HURT", "5d5");
    const race = makeRace({ level: 20, blows: [blow, blow, blow] });
    const mon = addMon(state, race, loc(16, 10));
    /* Make the monster's grid visible so it can "see" the player. */
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    updateMonsterDistances(state);

    const startHp = state.actor.player.chp;
    monsterTurn(mon, state);

    /* It attacked rather than moved, and the player took damage. */
    expect(mon.grid).toEqual(loc(16, 10));
    expect(state.actor.player.chp).toBeLessThan(startHp);
  });

  it("flees directly away from the player when afraid", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5 });
    const mon = addMon(state, race, loc(20, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    mon.mTimed[MON_TMD.FEAR] = 20;
    updateMonsterDistances(state);

    const before = distance(mon.grid, state.actor.grid);
    monsterTurn(mon, state);
    const after = distance(mon.grid, state.actor.grid);
    expect(after).toBeGreaterThan(before);
  });

  it("a NEVER_MOVE monster holds its ground", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5, hearing: 30, flags: [RF.NEVER_MOVE] });
    const mon = addMon(state, race, loc(20, 10));
    makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });
    updateMonsterDistances(state);

    monsterTurn(mon, state);
    expect(mon.grid).toEqual(loc(20, 10));
  });

  it("an aware monster's turn rouses sleeping group-mates (monster_group_rouse)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5, flags: [RF.NEVER_MOVE] });
    const leader = addMon(state, race, loc(20, 10));
    const friend = addMon(state, race, loc(20, 11));

    monsterGroupStart(state, leader, GROUP_TYPE.PRIMARY);
    const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!.index;
    friend.groupInfo[GROUP_TYPE.PRIMARY]! = { index: gi, role: MON_GROUP.MEMBER };
    monsterAddToGroup(state, friend, state.groups[gi]!);

    leader.mflag.on(MFLAG.AWARE);
    friend.mTimed[MON_TMD.SLEEP] = 500;
    updateMonsterDistances(state);

    for (let i = 0; i < 2000 && (friend.mTimed[MON_TMD.SLEEP] ?? 0) > 0; i++) {
      monsterTurn(leader, state);
    }
    expect(friend.mTimed[MON_TMD.SLEEP]).toBe(0);
  });
});

describe("erratic movement (RAND_25 / RAND_50)", () => {
  const N = 2000;

  function staggerCount(flags: number[]): number {
    const state = makeState({ seed: 12345 });
    const mon = addMon(state, makeRace({ flags }), loc(20, 10));
    let staggers = 0;
    for (let i = 0; i < N; i++) {
      if (monsterTurnShouldStagger(mon, state) !== STAGGER.NO) staggers++;
    }
    return staggers;
  }

  it("a non-random monster never staggers", () => {
    expect(staggerCount([])).toBe(0);
  });

  it("a RAND_50 monster staggers about half the time", () => {
    const count = staggerCount([RF.RAND_50]);
    expect(count).toBeGreaterThan(N * 0.4);
    expect(count).toBeLessThan(N * 0.6);
  });

  it("a RAND_25 monster staggers about a quarter of the time", () => {
    const count = staggerCount([RF.RAND_25]);
    expect(count).toBeGreaterThan(N * 0.17);
    expect(count).toBeLessThan(N * 0.33);
  });
});
