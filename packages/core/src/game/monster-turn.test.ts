import { describe, expect, it } from "vitest";
import { FEAT, MFLAG, MON_TMD, OF, RF, SQUARE, TV } from "../generated";
import { distance, loc } from "../loc";
import type { Loc } from "../loc";
import { makeNoise } from "../world/flow";
import { GROUP_TYPE } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import { newOfFlags } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";
import { updateMonsterDistances } from "./context";
import { monsterAddToGroup, monsterGroupStart } from "./mon-group";
import {
  STAGGER,
  monsterTurn,
  monsterTurnMultiply,
  monsterTurnShouldStagger,
  processMonsterTimed,
} from "./monster-turn";
import { GRANITE, addMon, makeRace, makeBlow, makeState } from "./harness";

/** A minimal floor object placed directly into the pile (bypasses floorCarry). */
function putItem(state: GameState, grid: Loc, tval: number): GameObject {
  const obj = objectNew({} as never);
  obj.tval = tval;
  obj.number = 1;
  obj.grid = grid;
  state.floor.set(grid.y * state.chunk.width + grid.x, [obj]);
  return obj;
}

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

describe("camouflage/mimic reveal (become_aware)", () => {
  it("reveals a camouflaged blocker before it is trampled (monster_turn_try_push, mon-move.c L1352)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const strong = makeRace({ level: 20, mexp: 1000, flags: [RF.KILL_BODY] });
    const weak = makeRace({ level: 1, mexp: 1 });
    const mover = addMon(state, strong, loc(17, 10));
    const blocker = addMon(state, weak, loc(16, 10));
    const blockerIdx = blocker.midx;
    blocker.mflag.on(MFLAG.CAMOUFLAGE);
    state.chunk.sqinfoOn(mover.grid, SQUARE.VIEW);
    updateMonsterDistances(state);

    let revealed: number | null = null;
    state.becomeAware = (m) => {
      revealed = m.midx;
    };

    monsterTurn(mover, state);

    expect(revealed).toBe(blockerIdx);
    /* The stronger KILL_BODY monster trampled the weaker one. */
    expect(state.monsters[blockerIdx]).toBeNull();
  });

  it("reveals a camouflaged monster that did something on its own turn (mon-move.c L1680)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5, hearing: 30 });
    const mon = addMon(state, race, loc(25, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    updateMonsterDistances(state);
    makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });

    let revealed: number | null = null;
    state.becomeAware = (m) => {
      revealed = m.midx;
    };

    monsterTurn(mon, state);

    expect(revealed).toBe(mon.midx);
  });

  it("does not call becomeAware for a normal (non-camouflaged) monster that moves", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5, hearing: 30 });
    const mon = addMon(state, race, loc(25, 10));
    updateMonsterDistances(state);
    makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });

    let called = false;
    state.becomeAware = () => {
      called = true;
    };

    monsterTurn(mon, state);

    expect(called).toBe(false);
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

/**
 * Place a monster east of the player so its beeline step is due west onto the
 * grid at `barrier`, with its own grid marked in view so it beelines.
 */
function beeliningWest(
  opts: { flags?: number[]; monHp?: number } = {},
): { state: GameState; mon: ReturnType<typeof addMon>; barrier: Loc } {
  const state = makeState({ playerGrid: loc(15, 10) });
  const race = makeRace({ level: 20, flags: opts.flags ?? [] });
  const mon = addMon(state, race, loc(17, 10), { hp: opts.monHp ?? 40 });
  state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
  updateMonsterDistances(state);
  return { state, mon, barrier: loc(16, 10) };
}

describe("terrain manipulation (monster_turn_can_move)", () => {
  it("an OPEN_DOOR monster opens a closed door and spends the turn", () => {
    const { state, mon, barrier } = beeliningWest({ flags: [RF.OPEN_DOOR] });
    state.chunk.setFeat(barrier, FEAT.CLOSED);

    monsterTurn(mon, state);

    /* Door opened, monster did not step through this turn. */
    expect(state.chunk.feat(barrier)).toBe(FEAT.OPEN);
    expect(mon.grid).toEqual(loc(17, 10));
  });

  it("a BASH_DOOR monster bashes a door open and falls into the doorway", () => {
    const { state, mon, barrier } = beeliningWest({ flags: [RF.BASH_DOOR] });
    state.chunk.setFeat(barrier, FEAT.CLOSED);

    monsterTurn(mon, state);

    /* Door destroyed (broken), monster moved onto the doorway. */
    expect(state.chunk.feat(barrier)).toBe(FEAT.BROKEN);
    expect(mon.grid).toEqual(barrier);
  });

  it("a KILL_WALL monster bores a granite wall to floor and moves in", () => {
    const { state, mon, barrier } = beeliningWest({ flags: [RF.KILL_WALL] });
    state.chunk.setFeat(barrier, GRANITE);
    updateMonsterDistances(state);

    monsterTurn(mon, state);

    expect(state.chunk.feat(barrier)).toBe(FEAT.FLOOR);
    expect(mon.grid).toEqual(barrier);
  });

  it("a SMASH_WALL monster clears the wall and can crumble neighbours", () => {
    const { state, mon, barrier } = beeliningWest({ flags: [RF.SMASH_WALL] });
    state.chunk.setFeat(barrier, GRANITE);
    updateMonsterDistances(state);

    monsterTurn(mon, state);

    /* The target wall is always cleared (the adjacent survival rolls are
     * random, so only the target grid is asserted). */
    expect(state.chunk.feat(barrier)).toBe(FEAT.FLOOR);
    expect(mon.grid).toEqual(barrier);
  });

  it("a plain monster cannot open a closed door (it stays shut)", () => {
    const { state, mon, barrier } = beeliningWest({});
    state.chunk.setFeat(barrier, FEAT.CLOSED);

    monsterTurn(mon, state);

    /* The door is never opened; the monster may side-step around it, but it
     * never ends up on the (still closed) door grid. */
    expect(state.chunk.feat(barrier)).toBe(FEAT.CLOSED);
    expect(mon.grid).not.toEqual(barrier);
  });
});

describe("reproduction (monster_turn_multiply)", () => {
  function breeder(rate = 1): {
    state: GameState;
    mon: ReturnType<typeof addMon>;
    calls: number[];
  } {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.z = { ...state.z, reproMonsterRate: rate };
    const mon = addMon(state, makeRace({ flags: [RF.MULTIPLY] }), loc(20, 10));
    mon.mflag.on(MFLAG.VISIBLE);
    updateMonsterDistances(state);
    const calls: number[] = [];
    state.monsterMultiply = (m): boolean => {
      calls.push(m.midx);
      return true;
    };
    return { state, mon, calls };
  }

  it("a breeder under the num_repro cap multiplies", () => {
    const { state, mon, calls } = breeder();
    state.numRepro = 0;
    expect(monsterTurnMultiply(mon, state)).toBe(true);
    expect(calls).toEqual([mon.midx]);
  });

  it("a breeder at the num_repro cap does not multiply and draws no RNG", () => {
    const { state, mon, calls } = breeder();
    state.numRepro = state.z.reproMonsterMax;
    const before = JSON.stringify(state.rng.getState());

    expect(monsterTurnMultiply(mon, state)).toBe(false);
    expect(calls).toEqual([]);
    /* The cap gate returns before the crowd count / chance roll. */
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });

  it("no breeding in single combat (arena), and no RNG is drawn", () => {
    const { state, mon, calls } = breeder();
    state.numRepro = 0;
    state.arenaLevel = true;
    const before = JSON.stringify(state.rng.getState());

    expect(monsterTurnMultiply(mon, state)).toBe(false);
    expect(calls).toEqual([]);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });

  it("a non-breeder that passes the crowd roll learns the flag but does not spawn", () => {
    const { state, mon, calls } = breeder();
    /* Swap to a non-breeder race that is otherwise identical. */
    const plain = addMon(state, makeRace({ flags: [] }), loc(25, 10));
    plain.mflag.on(MFLAG.VISIBLE);
    state.numRepro = 0;
    expect(monsterTurnMultiply(plain, state)).toBe(false);
    expect(calls).toEqual([]);
    void mon;
  });
});

describe("item pickup / crush (monster_turn_grab_objects)", () => {
  it("a TAKE_ITEM monster picks up a floor item as it steps onto it", () => {
    const { state, mon, barrier } = beeliningWest({ flags: [RF.TAKE_ITEM] });
    const item = putItem(state, barrier, TV.POTION);

    monsterTurn(mon, state);

    expect(mon.grid).toEqual(barrier);
    expect(state.floor.get(barrier.y * state.chunk.width + barrier.x)).toBeUndefined();
    expect(mon.heldObj).toContain(item);
  });

  it("a KILL_ITEM monster crushes the floor item (not carried)", () => {
    const { state, mon, barrier } = beeliningWest({ flags: [RF.KILL_ITEM] });
    putItem(state, barrier, TV.POTION);

    monsterTurn(mon, state);

    expect(mon.grid).toEqual(barrier);
    expect(state.floor.get(barrier.y * state.chunk.width + barrier.x)).toBeUndefined();
    expect(mon.heldObj).toHaveLength(0);
  });

  it("a plain monster leaves floor items alone", () => {
    const { state, mon, barrier } = beeliningWest({});
    const item = putItem(state, barrier, TV.POTION);

    monsterTurn(mon, state);

    expect(mon.grid).toEqual(barrier);
    const pile = state.floor.get(barrier.y * state.chunk.width + barrier.x);
    expect(pile).toEqual([item]);
    expect(mon.heldObj).toHaveLength(0);
  });

  it("a TAKE_ITEM monster leaves gold on the floor", () => {
    const { state, mon, barrier } = beeliningWest({ flags: [RF.TAKE_ITEM] });
    putItem(state, barrier, TV.GOLD);

    monsterTurn(mon, state);

    expect(mon.grid).toEqual(barrier);
    const pile = state.floor.get(barrier.y * state.chunk.width + barrier.x);
    expect(pile).toHaveLength(1);
  });
});

describe("aggravation (monster_reduce_sleep)", () => {
  function sleeper(aggravate: boolean): {
    state: GameState;
    mon: ReturnType<typeof addMon>;
  } {
    /* High stealth so the ordinary notice roll almost never wakes it. */
    const state = makeState({ playerGrid: loc(15, 10), stealth: 30 });
    const mon = addMon(state, makeRace({ level: 5 }), loc(20, 10));
    mon.mTimed[MON_TMD.SLEEP] = 500;
    if (aggravate) {
      const flags = newOfFlags();
      flags.on(OF.AGGRAVATE);
      state.playerState = { flags } as never;
    }
    updateMonsterDistances(state);
    return { state, mon };
  }

  it("an aggravating player wakes a sleeper outright", () => {
    const { state, mon } = sleeper(true);
    const skipped = processMonsterTimed(mon, state);
    expect(skipped).toBe(true); /* still skips this turn, but now awake */
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
    expect(mon.mflag.has(MFLAG.AWARE)).toBe(true);
  });

  it("without aggravation a stealthy player leaves the sleeper asleep", () => {
    const { state, mon } = sleeper(false);
    processMonsterTimed(mon, state);
    expect(mon.mTimed[MON_TMD.SLEEP]).toBeGreaterThan(0);
  });
});

describe("monster-turn RNG-order determinism", () => {
  it("same seed + same setup gives identical behaviour over many turns", () => {
    function run(seed: number): string {
      const state = makeState({ seed, playerGrid: loc(15, 10) });
      const race = makeRace({ level: 5, hearing: 30, flags: [RF.MULTIPLY] });
      const mon = addMon(state, race, loc(25, 10));
      const trail: string[] = [];
      for (let step = 0; step < 8; step++) {
        updateMonsterDistances(state);
        makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });
        monsterTurn(mon, state);
        trail.push(`${mon.grid.x},${mon.grid.y}`);
      }
      return trail.join("|");
    }
    expect(run(777)).toBe(run(777));
  });
});
