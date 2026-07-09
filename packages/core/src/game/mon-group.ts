/**
 * Monster group behaviours, ported from reference/src/mon-group.c (Angband
 * 4.2.6): the pack bookkeeping that lets monsters share a leader, split when the
 * leader dies, rouse each other and track the player as a group. Groups live on
 * the GameState (state.groups, parallel to state.monsters), so this is a game-
 * layer module.
 *
 * The upstream member list is a linked list whose head is the most recently
 * added member; here it is an array with the same head-first order (add
 * prepends), so the leader-succession scan and the split behaviour match. The
 * group model (Monster.group_info primary/summon slots and the MON_GROUP roles)
 * is already on the monster (mon/monster.ts).
 *
 * Divergences: state.groups grows on demand rather than being capped at
 * z_info->level_monster_max (monster_group_index_new never "fails" here); the
 * rouse visibility test uses line of sight (monster_can_see, which also weighs
 * range and light, is not ported). Placement assignment and delete removal are
 * wired by their callers (monster generation / deleteMonster); the AI consumers
 * (rouse in the monster turn, group tracking in get_move) are wired separately.
 */

import { MFLAG, MON_TMD } from "../generated";
import { distance } from "../loc";
import { los } from "../world/view";
import { monsterIsUnique } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { GROUP_MAX, GROUP_TYPE } from "../mon/monster";
import type { Monster, MonsterGroupInfo } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import type { GameState, MonsterGroup } from "./context";

/** Allocate a new (empty) monster group with the given index. */
export function monsterGroupNew(index: number): MonsterGroup {
  return { index, leader: 0, members: [] };
}

/** monster_group_by_index. */
export function monsterGroupByIndex(
  state: GameState,
  index: number,
): MonsterGroup | null {
  return state.groups[index] ?? null;
}

/** monster_group_index. */
export function monsterGroupIndex(group: MonsterGroup): number {
  return group.index;
}

/** monster_group_leader_idx. */
export function monsterGroupLeaderIdx(group: MonsterGroup): number {
  return group.leader;
}

/** monster_group_leader: the leader monster of a monster's primary group. */
export function monsterGroupLeader(
  state: GameState,
  mon: Monster,
): Monster | null {
  const group = state.groups[mon.groupInfo[GROUP_TYPE.PRIMARY]!.index];
  if (!group) return null;
  return state.monsters[group.leader] ?? null;
}

/** monster_group_index_new: the next free group slot (grows the array). */
export function monsterGroupIndexNew(state: GameState): number {
  for (let i = 1; i < state.groups.length; i++) {
    if (!state.groups[i]) return i;
  }
  return state.groups.length;
}

/** monster_add_to_group: prepend the monster to a group's member list. */
export function monsterAddToGroup(
  state: GameState,
  mon: Monster,
  group: MonsterGroup,
): void {
  group.members.unshift(mon.midx);
}

/** monster_group_start: make a one-monster group led by `mon` in slot `which`. */
export function monsterGroupStart(
  state: GameState,
  mon: Monster,
  which: number,
): void {
  const index = monsterGroupIndexNew(state);
  const group = monsterGroupNew(index);
  state.groups[index] = group;
  group.leader = mon.midx;
  group.members = [mon.midx];
  mon.groupInfo[which] = { index, role: MON_GROUP.LEADER };
}

/** monster_group_split: break a leaderless group into race-based pieces. */
function monsterGroupSplit(state: GameState, group: MonsterGroup): void {
  const temp: number[] = [];
  for (const midx of [...group.members]) {
    const mon = state.monsters[midx];
    if (!mon) continue;

    /* Join an already-made split group of the same race. */
    for (const gi of temp) {
      const newGroup = state.groups[gi]!;
      const head = state.monsters[newGroup.members[0]!];
      if (head && head.race === mon.race) {
        mon.groupInfo[GROUP_TYPE.PRIMARY]!.index = gi;
        mon.groupInfo[GROUP_TYPE.PRIMARY]!.role = MON_GROUP.MEMBER;
        monsterAddToGroup(state, mon, newGroup);
        break;
      }
    }

    /* Still in the old group -> start a fresh one. */
    if (mon.groupInfo[GROUP_TYPE.PRIMARY]!.index === group.index) {
      monsterGroupStart(state, mon, GROUP_TYPE.PRIMARY);
      temp.push(mon.groupInfo[GROUP_TYPE.PRIMARY]!.index);
    }
  }
}

/** monster_group_remove_leader: appoint a successor or fracture the group. */
function monsterGroupRemoveLeader(
  state: GameState,
  leader: Monster,
  group: MonsterGroup,
): void {
  let possLeader = 0;
  for (const midx of group.members) {
    const mon = state.monsters[midx];
    if (!mon) continue;
    /* Same-race non-summon members can take over. */
    if (
      leader.race === mon.race &&
      !possLeader &&
      mon.groupInfo[GROUP_TYPE.PRIMARY]!.role !== MON_GROUP.SUMMON
    ) {
      possLeader = mon.midx;
    }
    /* Uniques always take over. */
    if (monsterIsUnique(mon)) possLeader = mon.midx;
  }

  if (!possLeader) {
    /* No successor: the group fractures and is removed. */
    monsterGroupSplit(state, group);
    state.groups[group.index] = null;
  } else {
    group.leader = possLeader;
    for (const midx of group.members) {
      const mon = state.monsters[midx];
      if (mon && mon.midx === possLeader) {
        mon.groupInfo[GROUP_TYPE.PRIMARY]!.role = MON_GROUP.LEADER;
        break;
      }
    }
  }
  monsterGroupsVerify(state);
}

/**
 * monster_remove_from_groups: drop a monster from its groups, removing an empty
 * group and handling the loss of a leader.
 */
export function monsterRemoveFromGroups(state: GameState, mon: Monster): void {
  for (let i = 0; i < GROUP_MAX; i++) {
    const index = mon.groupInfo[i]!.index;
    const group = state.groups[index];

    /* Most monsters have no second (summon) group. */
    if (!group) return;

    /* Only member -> remove the whole group. */
    if (group.members.length === 1 && group.members[0] === mon.midx) {
      state.groups[index] = null;
      continue;
    }

    const at = group.members.indexOf(mon.midx);
    if (at >= 0) group.members.splice(at, 1);
    if (group.leader === mon.midx) {
      monsterGroupRemoveLeader(state, mon, group);
    }
  }
  monsterGroupsVerify(state);
}

/**
 * monster_group_assign: place a monster into its group(s). For a freshly
 * created monster (loading=false) start or join the primary group; when loading
 * a savefile build both slots by hand from the saved info.
 */
export function monsterGroupAssign(
  state: GameState,
  mon: Monster,
  info: MonsterGroupInfo[],
  loading: boolean,
): void {
  if (!loading) {
    const index = info[GROUP_TYPE.PRIMARY]!.index;
    const group = monsterGroupByIndex(state, index);
    if (group) monsterAddToGroup(state, mon, group);
    else monsterGroupStart(state, mon, GROUP_TYPE.PRIMARY);
    return;
  }

  for (let i = 0; i < GROUP_MAX; i++) {
    const index = info[i]!.index;
    if (!index) {
      if (i === GROUP_TYPE.PRIMARY) {
        throw new Error(`monster ${mon.midx} has no group`);
      }
      return;
    }
    let group = monsterGroupByIndex(state, index);
    if (!group) {
      group = monsterGroupNew(index);
      state.groups[index] = group;
    }
    if (info[i]!.role === MON_GROUP.LEADER) group.leader = mon.midx;
    group.members.unshift(mon.midx);
  }
}

/**
 * monster_group_change_index: rewrite a monster's midx in its group(s) (used
 * when the monster list is compacted). Returns whether the old midx was found.
 */
export function monsterGroupChangeIndex(
  state: GameState,
  newMidx: number,
  oldMidx: number,
): boolean {
  const mon = state.monsters[oldMidx];
  if (!mon) return false;
  const group0 = state.groups[mon.groupInfo[GROUP_TYPE.PRIMARY]!.index];
  const group1 = state.groups[mon.groupInfo[GROUP_TYPE.SUMMON]!.index];

  if (group0) {
    if (group0.leader === oldMidx) group0.leader = newMidx;
    for (let i = 0; i < group0.members.length; i++) {
      if (group0.members[i] === oldMidx) {
        group0.members[i] = newMidx;
        if (!group1) return true;
      }
    }
  }
  if (group1) {
    if (group1.leader === oldMidx) group1.leader = newMidx;
    for (let i = 0; i < group1.members.length; i++) {
      if (group1.members[i] === oldMidx) {
        group1.members[i] = newMidx;
        return true;
      }
    }
  }
  return false;
}

/** summon_group: the group summoned creatures join for a given summoner. */
export function summonGroup(
  state: GameState,
  midx: number,
): MonsterGroup | null {
  const mon = state.monsters[midx];
  if (!mon) return null;

  let index: number;
  if (mon.groupInfo[GROUP_TYPE.PRIMARY]!.role === MON_GROUP.LEADER) {
    /* A group leader summons into its own primary group. */
    index = mon.groupInfo[GROUP_TYPE.PRIMARY]!.index;
  } else {
    index = mon.groupInfo[GROUP_TYPE.SUMMON]!.index;
    if (!index) {
      monsterGroupStart(state, mon, GROUP_TYPE.SUMMON);
      index = mon.groupInfo[GROUP_TYPE.SUMMON]!.index;
    }
  }
  return monsterGroupByIndex(state, index);
}

/**
 * monster_group_rouse: an aware monster tries to wake sleeping group-mates it
 * can see, more likely the closer they are. Visibility uses line of sight.
 */
export function monsterGroupRouse(state: GameState, mon: Monster): void {
  if (!mon.mflag.has(MFLAG.AWARE)) return;
  const group = state.groups[mon.groupInfo[GROUP_TYPE.PRIMARY]!.index];
  if (!group) return;

  for (const midx of group.members) {
    const friend = state.monsters[midx];
    if (!friend) continue;
    if ((friend.mTimed[MON_TMD.SLEEP] ?? 0) > 0 && los(state.chunk, mon.grid, friend.grid)) {
      const dist = distance(mon.grid, friend.grid);
      if (state.rng.oneIn(dist * 20)) monsterWake(state.rng, friend, true, 50);
    }
  }
}

/** monster_primary_group_size: the member count of a monster's primary group. */
export function monsterPrimaryGroupSize(
  state: GameState,
  mon: Monster,
): number {
  const group = state.groups[mon.groupInfo[GROUP_TYPE.PRIMARY]!.index];
  return group ? group.members.length : 0;
}

/**
 * group_monster_tracking: a group-mate that is actively tracking the player
 * (so a monster with no direct trail can follow the pack), or null.
 */
export function groupMonsterTracking(
  state: GameState,
  mon: Monster,
): Monster | null {
  const group = state.groups[mon.groupInfo[GROUP_TYPE.PRIMARY]!.index];
  if (!group) return null;
  for (const midx of group.members) {
    const tracker = state.monsters[midx];
    if (
      tracker &&
      tracker !== mon &&
      tracker.mflag.has(MFLAG.TRACKING) &&
      tracker.mflag.has(MFLAG.ACTIVE)
    ) {
      return tracker;
    }
  }
  return null;
}

/**
 * monster_groups_verify: assert every group member's group_info points back at
 * the group it is listed in (throws on an inconsistency, as upstream quits).
 */
export function monsterGroupsVerify(state: GameState): void {
  for (let i = 0; i < state.groups.length; i++) {
    const group = state.groups[i];
    if (!group) continue;
    for (const midx of group.members) {
      const mon = state.monsters[midx];
      if (!mon) continue;
      const info = mon.groupInfo;
      if (info[GROUP_TYPE.PRIMARY]!.index !== i) {
        if (info[GROUP_TYPE.SUMMON]!.index) {
          if (info[GROUP_TYPE.SUMMON]!.index !== i) {
            throw new Error(`bad group index: group ${i}, monster ${midx}`);
          }
          if (info[GROUP_TYPE.SUMMON]!.role !== MON_GROUP.LEADER) {
            throw new Error(`bad monster role: group ${i}, monster ${midx}`);
          }
        } else {
          throw new Error(`bad group index: group ${i}, monster ${midx}`);
        }
      }
    }
  }
}
