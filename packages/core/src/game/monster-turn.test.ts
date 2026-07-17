import { describe, expect, it } from "vitest";
import { FEAT, MFLAG, MON_TMD, OF, RF, RSF, SQUARE, TMD, TRF, TV } from "../generated";
import { FlagSet } from "../bitflag";
import { Rng } from "../rng";
import { distance, loc, locDiff } from "../loc";
import type { Loc } from "../loc";
import { makeNoise } from "../world/flow";
import { GROUP_TYPE } from "../mon/monster";
import { MON_GROUP, RSF_SIZE } from "../mon/types";
import { newOfFlags } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { TRF_SIZE } from "../world/trap";
import type { GameState, RunState } from "./context";
import { updateMonsterDistances } from "./context";
import { monsterAddToGroup, monsterGroupStart } from "./mon-group";
import { squareIsWebbed } from "./trap";
import {
  STAGGER,
  getMove,
  getMoveBodyguard,
  getMoveChooseDirection,
  getMoveFindHiding,
  getMoveFindRange,
  monsterCheckActive,
  monsterNearPermwall,
  monsterTurn,
  monsterTurnMultiply,
  monsterTurnShouldStagger,
  processMonsterTimed,
  shortRange,
} from "./monster-turn";
import { GRANITE, featureReg, addMon, makeRace, makeBlow, makeState } from "./harness";

const LAVA = featureReg.byCodeName("LAVA").fidx;

/** Insert a bare trap carrying `flagIdx` at `grid` (bypasses the trap system). */
function putTrap(state: GameState, grid: Loc, tidx: number, flagIdx: number): void {
  const flags = new FlagSet(TRF_SIZE);
  flags.on(flagIdx);
  const trap = { tidx, grid, power: 0, timeout: 0, flags } as never;
  state.traps.set(grid.y * state.chunk.width + grid.x, [trap]);
}

/** A monster placed east of the player, its grid marked in view (so it beelines). */
function beeliner(
  overrides: { level?: number; flags?: number[] } = {},
): { state: GameState; mon: ReturnType<typeof addMon>; barrier: Loc } {
  const state = makeState({ playerGrid: loc(15, 10) });
  const race = makeRace({ level: overrides.level ?? 20, flags: overrides.flags ?? [] });
  const mon = addMon(state, race, loc(17, 10), { hp: 40 });
  state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
  updateMonsterDistances(state);
  return { state, mon, barrier: loc(16, 10) };
}

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

  it("a mod AI hook returning true consumes the turn before the ported AI (W2.2 registry:monster)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5, hearing: 30 });
    const mon = addMon(state, race, loc(25, 10));
    updateMonsterDistances(state);
    makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });
    const start = { x: mon.grid.x, y: mon.grid.y };

    let calls = 0;
    state.monsterTurnHook = (m) => {
      calls += 1;
      return m === mon;
    };
    monsterTurn(mon, state);

    expect(calls).toBe(1);
    // The whole faithful AI was skipped: the monster did not close on the player.
    expect({ x: mon.grid.x, y: mon.grid.y }).toEqual(start);
  });

  it("a mod AI hook returning false falls through to the faithful AI (control)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 5, hearing: 30 });
    const mon = addMon(state, race, loc(25, 10));
    updateMonsterDistances(state);
    makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });
    const before = distance(mon.grid, state.actor.grid);

    state.monsterTurnHook = () => false;
    monsterTurn(mon, state);

    // Same setup as the hold-true case, but the AI ran: the monster closed in.
    expect(distance(mon.grid, state.actor.grid)).toBeLessThan(before);
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

describe("group AI: bodyguard (get_move_bodyguard)", () => {
  function pack(guardGrid: Loc): {
    state: GameState;
    leader: ReturnType<typeof addMon>;
    guard: ReturnType<typeof addMon>;
  } {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 10 });
    const leader = addMon(state, race, loc(20, 10));
    const guard = addMon(state, race, guardGrid);
    monsterGroupStart(state, leader, GROUP_TYPE.PRIMARY);
    const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!.index;
    guard.groupInfo[GROUP_TYPE.PRIMARY]! = { index: gi, role: MON_GROUP.BODYGUARD };
    monsterAddToGroup(state, guard, state.groups[gi]!);
    updateMonsterDistances(state);
    return { state, leader, guard };
  }

  it("targets a grid closer to its leader and draws no RNG", () => {
    const { state, leader, guard } = pack(loc(23, 10));
    const before = JSON.stringify(state.rng.getState());

    expect(getMoveBodyguard(guard, state)).toBe(true);
    expect(distance(guard.target.grid, leader.grid)).toBeLessThan(
      distance(guard.grid, leader.grid),
    );
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });

  it("does not use a bodyguard move when already adjacent to its leader", () => {
    const { state, guard } = pack(loc(21, 10));
    expect(getMoveBodyguard(guard, state)).toBe(false);
  });

  it("a bodyguard steps toward its leader on its turn", () => {
    const { state, leader, guard } = pack(loc(23, 10));
    const before = distance(guard.grid, leader.grid);
    monsterTurn(guard, state);
    expect(distance(guard.grid, leader.grid)).toBeLessThan(before);
  });
});

describe("group AI: pack ambush (get_move_find_hiding)", () => {
  it("finds a hidden grid to lie in wait, drawing no RNG", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.GROUP_AI] }), loc(20, 10));
    updateMonsterDistances(state);
    const min = Math.trunc((distance(state.actor.grid, mon.grid) * 3) / 4) + 2;
    const before = JSON.stringify(state.rng.getState());

    expect(getMoveFindHiding(mon, state)).toBe(true);
    /* Out of the player's view and far enough away to be a real ambush spot. */
    expect(state.chunk.sqinfoHas(mon.target.grid, SQUARE.VIEW)).toBe(false);
    expect(distance(mon.target.grid, state.actor.grid)).toBeGreaterThanOrEqual(min);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });

  /**
   * Golden square derived by hand from mon-move.c L613-666 on the harness's
   * all-floor field (no SQUARE_VIEW anywhere, so !square_isview is always true;
   * every interior grid is empty and projectable from the monster).
   *
   * Player P=(15,10), monster M=(20,10). distance() is Angband's octagonal
   * metric max + min/2 (cave-view.c L38). distance(P,M) = 5, so
   *   min = 5 * 3 / 4 + 2 = 3 + 2 = 5   (integer division, L620).
   * Ring d=1 (dist_offsets, the 8 neighbours) is scanned in this exact order
   * (dx,dy = x_offsets[i],y_offsets[i]); dis = distance(grid, P):
   *   (19,9) dis 4  <min   (20,9) dis 5  -> best, gdis=5   (21,9) dis 6
   *   (19,10) dis 4 <min   (21,10) dis 6                   (19,11) dis 4 <min
   *   (20,11) dis 5 (not < gdis)         (21,11) dis 6
   * gdis < 999 after ring 1, so the scan returns with target = (20,9): the
   * FIRST grid at the closest allowed distance, straight north of the monster.
   */
  it("selects the exact upstream hiding square (20,9) by hand", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.GROUP_AI] }), loc(20, 10));
    updateMonsterDistances(state);

    expect(getMoveFindHiding(mon, state)).toBe(true);
    expect(mon.target.grid).toEqual(loc(20, 9));
  });

  /**
   * get_move's pack-ambush branch (mon-move.c L889-915): a healthy player who
   * is NOT in the open (fewer than 5 passable/room grids around them) lures a
   * pack monster to a hiding square. We box the player in so open < 5, mark the
   * monster's grid in view so get_move_advance beelines (no RNG on that path),
   * and confirm the branch overrides the advance target with the L613 hiding
   * square, clears MFLAG_TRACKING, and draws no RNG (the pack-ambush scan is
   * pure; the monster's grid is not in view here, so the RNG-drawing surround
   * branch at L932 does not run).
   */
  it("get_move diverts a boxed-in player's attacker to the ambush square", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    /* Wall the player into a 2-open pocket: only N and S stay passable. */
    for (const g of [
      loc(14, 9), loc(15, 9), loc(16, 9),
      loc(14, 10), loc(16, 10),
      loc(14, 11), loc(16, 11),
    ]) {
      state.chunk.setFeat(g, GRANITE);
    }
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.GROUP_AI] }), loc(20, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    updateMonsterDistances(state);
    const before = JSON.stringify(state.rng.getState());

    const decision = getMove(mon, state);

    expect(mon.target.grid).toEqual(loc(20, 9));
    expect(mon.mflag.has(MFLAG.TRACKING)).toBe(false);
    /* Grid diff (20,9)-(20,10) = (0,-1): a step north toward the ambush spot. */
    expect(decision.move).toBe(true);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });

  /**
   * The complement of the branch condition: a player standing in the open (>= 5
   * passable grids around them) is NOT ambushed, so get_move keeps the plain
   * beeline target set by get_move_advance instead of the hiding square.
   */
  it("get_move does not ambush a player standing in the open", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.GROUP_AI] }), loc(20, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    updateMonsterDistances(state);

    getMove(mon, state);

    /* Advance beelines straight at the player; no ambush diversion. */
    expect(mon.target.grid).toEqual(loc(15, 10));
  });

  /**
   * Group surround (mon-move.c L932): a healthy player in the OPEN and in the
   * monster's line of sight triggers the surround branch. We occupy 7 of the
   * player's 8 neighbours with filler monsters, leaving only (15,9) empty.
   * Monsters do not change passability, so the pack-ambush open-count stays
   * >= 5 and that branch is skipped; the monster is not afraid; and its grid is
   * in view. cdis (5) > 1, so the branch draws randint0(8) for a start offset
   * and then fills the first EMPTY neighbour of the player -- which, whatever
   * the roll, can only be (15,9). The chosen step is therefore deterministic
   * and cross-checks the port's square_isempty skip + fall-through.
   */
  it("surrounds a player in the open, filling the one empty neighbour (golden)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.GROUP_AI] }), loc(20, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    const filler = makeRace({ level: 1 });
    for (const g of [
      loc(14, 9), loc(16, 9),
      loc(14, 10), loc(16, 10),
      loc(14, 11), loc(15, 11), loc(16, 11),
    ]) {
      addMon(state, filler, g);
    }
    updateMonsterDistances(state);
    const before = JSON.stringify(state.rng.getState());

    const decision = getMove(mon, state);

    /* The branch executed and drew from the RNG (randint0(8)). */
    expect(JSON.stringify(state.rng.getState())).not.toBe(before);
    /* It steered toward the only empty neighbour of the player, (15,9). */
    const expectedDir = getMoveChooseDirection(locDiff(loc(15, 9), mon.grid), state.turn);
    expect(decision.move).toBe(true);
    expect(decision.dir).toBe(expectedDir);
  });
});

describe("glyph handling (monster_turn_attack_glyph)", () => {
  it("a high-level monster breaks a glyph of warding and steps onto it", () => {
    const { state, mon, barrier } = beeliner({ level: 600 });
    putTrap(state, barrier, 1, TRF.GLYPH);

    monsterTurn(mon, state);

    const key = barrier.y * state.chunk.width + barrier.x;
    expect(state.traps.get(key)).toBeUndefined();
    expect(mon.grid).toEqual(barrier);
  });

  it("a weak monster cannot break the glyph and never crosses it", () => {
    const { state, mon, barrier } = beeliner({ level: 1 });
    putTrap(state, barrier, 1, TRF.GLYPH);

    monsterTurn(mon, state);

    const key = barrier.y * state.chunk.width + barrier.x;
    expect(state.traps.get(key)).toBeDefined();
    expect(mon.grid).not.toEqual(barrier);
  });
});

describe("decoy handling (square_isdecoyed / square_destroy_decoy)", () => {
  it("a monster destroys a decoy it reaches and clears cave->decoy", () => {
    const { state, mon, barrier } = beeliner({ level: 20 });
    state.decoy = barrier;
    /* The decoy trap carries the GLYPH flag, like a glyph of warding. */
    putTrap(state, barrier, 2, TRF.GLYPH);

    monsterTurn(mon, state);

    expect(state.decoy).toBeNull();
    const key = barrier.y * state.chunk.width + barrier.x;
    expect(state.traps.get(key)).toBeUndefined();
    /* Destroying the decoy spends the turn; the monster stays put. */
    expect(mon.grid).toEqual(loc(17, 10));
  });
});

describe("web handling (square_iswebbed)", () => {
  function webbed(flags: number[]): {
    state: GameState;
    mon: ReturnType<typeof addMon>;
  } {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10, hearing: 30, flags }), loc(20, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    putTrap(state, mon.grid, 3, TRF.WEB);
    makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });
    updateMonsterDistances(state);
    return { state, mon };
  }

  it("a PASS_WEB monster ignores the web and still moves", () => {
    const { state, mon } = webbed([RF.PASS_WEB]);
    const start = mon.grid;
    monsterTurn(mon, state);
    expect(squareIsWebbed(state, start)).toBe(true);
    expect(mon.grid).not.toEqual(start);
  });

  it("a CLEAR_WEB monster clears the web and spends its turn", () => {
    const { state, mon } = webbed([RF.CLEAR_WEB]);
    const start = mon.grid;
    monsterTurn(mon, state);
    expect(squareIsWebbed(state, start)).toBe(false);
    expect(mon.grid).toEqual(start);
  });

  it("a monster with no web ability is stuck and does nothing", () => {
    const { state, mon } = webbed([]);
    const start = mon.grid;
    monsterTurn(mon, state);
    expect(squareIsWebbed(state, start)).toBe(true);
    expect(mon.grid).toEqual(start);
  });
});

describe("damaging terrain (monster_hates_grid / taking_terrain_damage)", () => {
  it("a monster on unresisted lava is active from terrain damage", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10 }), loc(30, 10));
    state.chunk.setFeat(mon.grid, LAVA);
    updateMonsterDistances(state);
    expect(monsterCheckActive(mon, state)).toBe(true);
  });

  it("a fire-immune monster on lava is not activated by the terrain", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.IM_FIRE] }), loc(30, 10));
    state.chunk.setFeat(mon.grid, LAVA);
    updateMonsterDistances(state);
    expect(monsterCheckActive(mon, state)).toBe(false);
  });

  it("a monster refuses to step into lava it cannot resist", () => {
    const { state, mon, barrier } = beeliner({ level: 20 });
    state.chunk.setFeat(barrier, LAVA);
    updateMonsterDistances(state);
    monsterTurn(mon, state);
    expect(mon.grid).not.toEqual(barrier);
  });

  it("a fire-immune monster will walk into lava", () => {
    const { state, mon, barrier } = beeliner({ level: 20, flags: [RF.IM_FIRE] });
    state.chunk.setFeat(barrier, LAVA);
    updateMonsterDistances(state);
    monsterTurn(mon, state);
    expect(mon.grid).toEqual(barrier);
  });
});

/** A running RunState with the given steps remaining. */
function runningState(running: number): RunState {
  return {
    curDir: 0,
    oldDir: 0,
    openArea: true,
    breakRight: false,
    breakLeft: false,
    running,
    firstStep: false,
    stepCount: 0,
  };
}

describe("monster-turn disturb (mon-move.c disturb sites)", () => {
  it("a visible monster acting in the player's view disturbs the run", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 20 });
    const mon = addMon(state, race, loc(17, 10), { hp: 40 });
    /* Grid in view so it beelines; marked visible + in view to the player. */
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    mon.mflag.on(MFLAG.VISIBLE);
    mon.mflag.on(MFLAG.VIEW);
    updateMonsterDistances(state);
    state.run = runningState(5);

    monsterTurn(mon, state);

    expect(mon.grid).not.toEqual(loc(17, 10)); // it moved (did something)
    expect(state.run!.running).toBe(0); // disturb() cancelled the run
  });

  it("does not disturb the run when the acting monster is out of view", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 20 });
    const mon = addMon(state, race, loc(17, 10), { hp: 40 });
    /* Beelines (grid in view) but not marked visible/in-view to the player. */
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    updateMonsterDistances(state);
    state.run = runningState(5);

    monsterTurn(mon, state);

    expect(mon.grid).not.toEqual(loc(17, 10)); // it still moved
    expect(state.run!.running).toBe(5); // but the run is not interrupted
  });

  it("a monster bursting a door open disturbs the run", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const race = makeRace({ level: 20, flags: [RF.BASH_DOOR] });
    const mon = addMon(state, race, loc(17, 10), { hp: 40 });
    state.chunk.setFeat(loc(16, 10), FEAT.CLOSED); // door between mon and player
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW); // beelines toward the player
    updateMonsterDistances(state);
    state.run = runningState(5);

    monsterTurn(mon, state);

    expect(state.chunk.feat(loc(16, 10))).toBe(FEAT.BROKEN); // door burst
    expect(state.run!.running).toBe(0); // disturb() from the burst
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

describe("get_move_find_range best_range (mon-move.c L285-300)", () => {
  function rangedMon(
    state: ReturnType<typeof makeState>,
    opts: { freqSpell?: number; freqInnate?: number; spells?: number[] },
  ): ReturnType<typeof addMon> {
    const race = makeRace({ level: 20 });
    race.freqSpell = opts.freqSpell ?? 0;
    race.freqInnate = opts.freqInnate ?? 0;
    const flags = new FlagSet(RSF_SIZE);
    for (const s of opts.spells ?? []) flags.on(s);
    race.spellFlags = flags;
    const mon = addMon(state, race, loc(25, 10), { hp: 40 });
    updateMonsterDistances(state);
    return mon;
  }

  it("a plain melee monster keeps best_range == min_range", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = rangedMon(state, {});
    getMoveFindRange(mon, state);
    expect(mon.bestRange).toBe(mon.minRange);
  });

  it("an infrequent spellcaster (freq_spell > 24) sits back +3", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = rangedMon(state, { freqSpell: 30, spells: [RSF.BA_FIRE] });
    getMoveFindRange(mon, state);
    expect(mon.bestRange).toBe(mon.minRange + 3);
  });

  it("a healthy breather with freq_innate > 24 clamps best_range at >= 1", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = rangedMon(state, { freqInnate: 30, spells: [RSF.BR_FIRE] });
    mon.hp = mon.maxhp; /* over half health */
    getMoveFindRange(mon, state);
    /* MAX(1, best_range): with min_range 1 the value stays 1 (no +3). */
    expect(mon.bestRange).toBe(Math.max(1, mon.minRange));
  });

  it("an archer (RST_ARCHERY, freq_innate < 4) prefers +3 distance", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = rangedMon(state, { freqInnate: 2, spells: [RSF.ARROW] });
    getMoveFindRange(mon, state);
    expect(mon.bestRange).toBe(mon.minRange + 3);
  });
});

describe("monster_near_permwall (mon-move.c L65) and the PASS_WALL beeline", () => {
  const PERM = featureReg.byCodeName("PERM").fidx;

  it("is false when the player is projectable (no wall in the way)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.PASS_WALL] }), loc(20, 10));
    updateMonsterDistances(state);
    expect(monsterNearPermwall(mon, state)).toBe(false);
    /* projectable short-circuits before the randint0(99) draw: the stream is
     * untouched, so the next draw equals a fresh probe's first draw. */
    expect(state.rng.randint0(1000000)).toBe(new Rng(1).randint0(1000000));
  });

  it("is true when a permanent wall blocks the direct rock path", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    /* A full PERM column between monster and player. */
    for (let y = 1; y < 24; y++) state.chunk.setFeat(loc(18, y), PERM);
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.PASS_WALL] }), loc(22, 10));
    updateMonsterDistances(state);
    expect(monsterNearPermwall(mon, state)).toBe(true);
  });

  it("with plain granite in the way, flows only on the 5% roll", () => {
    const seed = 12345;
    const state = makeState({ playerGrid: loc(15, 10), seed });
    for (let y = 1; y < 24; y++) state.chunk.setFeat(loc(18, y), GRANITE);
    const mon = addMon(state, makeRace({ level: 10, flags: [RF.PASS_WALL] }), loc(22, 10));
    updateMonsterDistances(state);
    /* The first draw after the failed projectable is randint0(99): the
     * outcome tracks the C branch exactly for this seed. */
    const probe = new Rng(seed);
    const expected = probe.randint0(99) < 5;
    expect(monsterNearPermwall(mon, state)).toBe(expected);
  });

  it("a PASS_WALL monster near perm walls falls back to the flow instead of beelining", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    /* A perm wall across the direct path, with a gap to the south so noise
     * can flow around it. */
    for (let y = 1; y < 19; y++) state.chunk.setFeat(loc(18, y), PERM);
    const race = makeRace({ level: 10, flags: [RF.PASS_WALL], hearing: 60 });
    const mon = addMon(state, race, loc(22, 10));
    updateMonsterDistances(state);
    /* Noise flows around the perm wall; the monster follows it rather than
     * targeting the player's grid directly through the wall. */
    makeNoise(state.chunk, { grid: state.actor.grid, covertTracks: false });
    const decision = getMove(mon, state);
    expect(decision.move).toBe(true);
    /* It tracked (sound), not beelined. */
    expect(decision.tracking).toBe(true);
  });
});

describe("TMD_COVERTRACKS hides a distant player (mon-move.c L95)", () => {
  it("a monster beyond max_sight / 4 loses sight of a covered player", () => {
    const base = (): { state: GameState; mon: ReturnType<typeof addMon> } => {
      const state = makeState({ playerGrid: loc(5, 10) });
      const race = makeRace({ level: 10, hearing: 0, smell: 0 });
      const mon = addMon(state, race, loc(25, 10));
      state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
      updateMonsterDistances(state);
      return { state, mon };
    };

    /* Without covering tracks: beelines at the player's grid. */
    const plain = base();
    getMove(plain.mon, plain.state);
    expect(plain.mon.target.grid).toEqual(plain.state.actor.grid);

    /* Covering tracks at distance 20 > max_sight / 4: cannot see. */
    const covered = base();
    covered.state.actor.player.timed[TMD.COVERTRACKS] = 10;
    getMove(covered.mon, covered.state);
    expect(covered.mon.target.grid).not.toEqual(covered.state.actor.grid);
  });

  it("shortRange quarters max_range while covering tracks", () => {
    const state = makeState();
    expect(shortRange(state)).toBe(state.z.maxRange);
    state.actor.player.timed[TMD.COVERTRACKS] = 5;
    expect(shortRange(state)).toBe(Math.trunc(state.z.maxRange / 4));
  });
});

describe("react_to_slay pickup safety (mon-move.c L1420)", () => {
  function slayState(raceFlags: number[]): {
    state: GameState;
    mon: ReturnType<typeof addMon>;
    barrier: Loc;
  } {
    const built = beeliningWest({ flags: [RF.TAKE_ITEM, ...raceFlags] });
    /* Register an anti-evil slay in slot 1 of the state's slay table. */
    (built.state.slays as unknown[]).push({
      index: 1,
      code: "EVIL_2",
      name: "evil creatures",
      base: null,
      meleeVerb: "smite",
      rangeVerb: "deeply pierces",
      raceFlag: RF.EVIL,
      multiplier: 2,
      oMultiplier: 15,
      power: 0,
    });
    return built;
  }

  it("a monster will not grab an object bearing a slay that hurts it", () => {
    const { state, mon, barrier } = slayState([RF.EVIL]);
    const item = putItem(state, barrier, TV.SWORD);
    item.slays = [false, true];

    monsterTurn(mon, state);

    expect(mon.grid).toEqual(barrier);
    /* The item stays on the floor; nothing is carried. */
    const pile = state.floor.get(barrier.y * state.chunk.width + barrier.x);
    expect(pile).toEqual([item]);
    expect(mon.heldObj).toHaveLength(0);
  });

  it("a non-evil monster grabs the same object freely", () => {
    const { state, mon, barrier } = slayState([]);
    const item = putItem(state, barrier, TV.SWORD);
    item.slays = [false, true];

    monsterTurn(mon, state);

    expect(mon.grid).toEqual(barrier);
    expect(mon.heldObj).toContain(item);
  });
});
