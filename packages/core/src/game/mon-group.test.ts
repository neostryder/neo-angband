import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD } from "../generated";
import { loc } from "../loc";
import { GROUP_TYPE } from "../mon/monster";
import type { Monster } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { addMon, makeState, makeRace } from "./harness";
import type { GameState } from "./context";
import { deleteMonster } from "./context";
import {
  groupMonsterTracking,
  monsterAddToGroup,
  monsterGroupAssign,
  monsterGroupChangeIndex,
  monsterGroupLeader,
  monsterGroupLeaderIdx,
  monsterGroupRouse,
  monsterGroupStart,
  monsterGroupsVerify,
  monsterPrimaryGroupSize,
  monsterRemoveFromGroups,
  summonGroup,
} from "./mon-group";

/** Start a primary group led by `leader` and add `members` to it. */
function makeGroup(state: GameState, leader: Monster, members: Monster[]): number {
  monsterGroupStart(state, leader, GROUP_TYPE.PRIMARY);
  const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!.index;
  for (const m of members) {
    m.groupInfo[GROUP_TYPE.PRIMARY]!.index = gi;
    m.groupInfo[GROUP_TYPE.PRIMARY]!.role = MON_GROUP.MEMBER;
    monsterAddToGroup(state, m, state.groups[gi]!);
  }
  return gi;
}

describe("monster group membership", () => {
  it("tracks size, leader and members", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const a = addMon(state, race, loc(10, 11));
    const b = addMon(state, race, loc(10, 12));
    const gi = makeGroup(state, leader, [a, b]);

    expect(monsterPrimaryGroupSize(state, leader)).toBe(3);
    expect(monsterGroupLeaderIdx(state.groups[gi]!)).toBe(leader.midx);
    expect(monsterGroupLeader(state, b)).toBe(leader);
    monsterGroupsVerify(state);
  });

  it("removing a non-leader shrinks the group", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const a = addMon(state, race, loc(10, 11));
    const gi = makeGroup(state, leader, [a]);

    monsterRemoveFromGroups(state, a);
    expect(monsterPrimaryGroupSize(state, leader)).toBe(1);
    expect(state.groups[gi]!.leader).toBe(leader.midx);
  });

  it("removing the only member deletes the group", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const solo = addMon(state, makeRace({ flags: [] }), loc(10, 10));
    monsterGroupStart(state, solo, GROUP_TYPE.PRIMARY);
    const gi = solo.groupInfo[GROUP_TYPE.PRIMARY]!.index;
    monsterRemoveFromGroups(state, solo);
    expect(state.groups[gi]).toBeNull();
  });
});

describe("leader succession", () => {
  it("a same-race member takes over when the leader dies", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const heir = addMon(state, race, loc(10, 11));
    const gi = makeGroup(state, leader, [heir]);

    monsterRemoveFromGroups(state, leader);
    expect(state.groups[gi]!.leader).toBe(heir.midx);
    expect(heir.groupInfo[GROUP_TYPE.PRIMARY]!.role).toBe(MON_GROUP.LEADER);
    monsterGroupsVerify(state);
  });

  it("a different-race group fractures when the leader dies", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const raceA = makeRace({ flags: [] });
    const raceB = makeRace({ flags: [] });
    const leader = addMon(state, raceA, loc(10, 10));
    const other = addMon(state, raceB, loc(10, 11));
    const gi = makeGroup(state, leader, [other]);

    monsterRemoveFromGroups(state, leader);
    expect(state.groups[gi]).toBeNull(); // old group gone
    expect(other.groupInfo[GROUP_TYPE.PRIMARY]!.index).not.toBe(gi);
    expect(monsterPrimaryGroupSize(state, other)).toBe(1);
    expect(other.groupInfo[GROUP_TYPE.PRIMARY]!.role).toBe(MON_GROUP.LEADER);
    monsterGroupsVerify(state);
  });
});

describe("summonGroup", () => {
  it("a leader summons into its primary group; a member gets a summon group", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const member = addMon(state, race, loc(10, 11));
    const gi = makeGroup(state, leader, [member]);

    expect(summonGroup(state, leader.midx)!.index).toBe(gi);

    const sg = summonGroup(state, member.midx);
    expect(sg).not.toBeNull();
    expect(sg!.index).not.toBe(gi);
    expect(member.groupInfo[GROUP_TYPE.SUMMON]!.index).toBe(sg!.index);
  });
});

describe("monsterGroupRouse", () => {
  it("an unaware monster rouses nobody", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const friend = addMon(state, race, loc(10, 11));
    makeGroup(state, leader, [friend]);
    friend.mTimed[MON_TMD.SLEEP] = 500;

    monsterGroupRouse(state, leader); // leader not AWARE
    expect(friend.mTimed[MON_TMD.SLEEP]).toBe(500);
  });

  it("an aware monster eventually wakes a sleeping group-mate in sight", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const friend = addMon(state, race, loc(10, 11));
    makeGroup(state, leader, [friend]);
    friend.mTimed[MON_TMD.SLEEP] = 500;
    leader.mflag.on(MFLAG.AWARE);

    for (let i = 0; i < 2000 && (friend.mTimed[MON_TMD.SLEEP] ?? 0) > 0; i++) {
      monsterGroupRouse(state, leader);
    }
    expect(friend.mTimed[MON_TMD.SLEEP]).toBe(0);
  });
});

describe("groupMonsterTracking", () => {
  it("returns an active, tracking group-mate", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const tracker = addMon(state, race, loc(10, 11));
    makeGroup(state, leader, [tracker]);

    expect(groupMonsterTracking(state, leader)).toBeNull();
    tracker.mflag.on(MFLAG.TRACKING);
    tracker.mflag.on(MFLAG.ACTIVE);
    expect(groupMonsterTracking(state, leader)).toBe(tracker);
  });
});

describe("monsterGroupChangeIndex", () => {
  it("rewrites a monster's midx in its group", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const member = addMon(state, race, loc(10, 11));
    const gi = makeGroup(state, leader, [member]);

    expect(monsterGroupChangeIndex(state, 999, member.midx)).toBe(true);
    expect(state.groups[gi]!.members).toContain(999);
    expect(state.groups[gi]!.members).not.toContain(member.midx);
  });
});

describe("deleteMonster group integration", () => {
  it("removes the dead monster from its group and promotes an heir", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const heir = addMon(state, race, loc(10, 11));
    const gi = makeGroup(state, leader, [heir]);

    deleteMonster(state, leader.midx);
    expect(state.monsters[leader.midx]).toBeNull();
    expect(state.chunk.mon(loc(10, 10))).toBe(0);
    expect(state.groups[gi]!.leader).toBe(heir.midx);
    expect(state.groups[gi]!.members).not.toContain(leader.midx);
    monsterGroupsVerify(state);
  });

  it("is a no-op for a monster that was never assigned a group", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const solo = addMon(state, makeRace({ flags: [] }), loc(10, 10));
    deleteMonster(state, solo.midx); // groupInfo index 0 -> no group work
    expect(state.monsters[solo.midx]).toBeNull();
  });
});

describe("monsterGroupAssign", () => {
  it("joins an existing primary group or starts a new one", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    monsterGroupStart(state, leader, GROUP_TYPE.PRIMARY);
    const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!.index;

    const joiner = addMon(state, race, loc(10, 11));
    joiner.groupInfo[GROUP_TYPE.PRIMARY]!.index = gi;
    monsterGroupAssign(state, joiner, joiner.groupInfo, false);
    expect(monsterPrimaryGroupSize(state, leader)).toBe(2);

    const fresh = addMon(state, race, loc(10, 12));
    monsterGroupAssign(state, fresh, fresh.groupInfo, false); // index 0 -> start new
    expect(fresh.groupInfo[GROUP_TYPE.PRIMARY]!.index).not.toBe(0);
    expect(monsterPrimaryGroupSize(state, fresh)).toBe(1);
  });
});
