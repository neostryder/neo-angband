import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, RF } from "../generated";
import { loc, locEq } from "../loc";
import { distance } from "../loc";
import type { Loc } from "../loc";
import { MonAllocTable } from "../mon/make";
import { SummonTable } from "../mon/summon";
import { MON_GROUP } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { GROUP_TYPE } from "../mon/monster";
import { deleteMonster, squareMonster } from "./context";
import type { GameState } from "./context";
import { summonGroup } from "./mon-group";
import {
  multiplyMonster,
  placeNewMonster,
  placeNewMonsterOne,
  squareAllowsSummon,
  summonSpecific,
  wipeMonsterCounts,
} from "./mon-place";
import type { MonPlaceDeps, SummonDeps } from "./mon-place";
import { GRANITE, addMon, makeRace, makeState, monReg } from "./harness";

const summons = new SummonTable(monReg.summons, monReg.bases);

function makeTable(): MonAllocTable {
  return new MonAllocTable(monReg.races, { maxDepth: 128 });
}

function deps(
  _state: GameState,
  extra: Partial<MonPlaceDeps> & Partial<SummonDeps> = {},
): SummonDeps {
  return { table: makeTable(), summons, ...extra };
}

function raceWhere(pred: (race: MonsterRace) => boolean): MonsterRace {
  const race = monReg.races.find((r, i) => i > 0 && pred(r));
  if (!race) throw new Error("no such race in the pack");
  return race;
}

/** A fresh non-unique race for placement (own curNum, real base). */
function plainRace(): MonsterRace {
  return makeRace({ level: 3 });
}

describe("squareAllowsSummon (cave-square.c L949)", () => {
  it("accepts an empty floor grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    expect(squareAllowsSummon(state, loc(12, 10))).toBe(true);
  });

  it("refuses walls, occupants, the player and the decoy", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addMon(state, plainRace(), loc(12, 10));
    expect(squareAllowsSummon(state, loc(0, 0))).toBe(false);
    expect(squareAllowsSummon(state, loc(12, 10))).toBe(false);
    expect(squareAllowsSummon(state, loc(10, 10))).toBe(false);
    state.decoy = loc(13, 10);
    expect(squareAllowsSummon(state, loc(13, 10))).toBe(false);
  });

  it("refuses warded and trapped grids through the predicates", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const warded = loc(12, 10);
    const trapped = loc(13, 10);
    const preds = {
      isPlayerTrap: (g: Loc) => locEq(g, trapped),
      isWebbed: () => false,
      isWarded: (g: Loc) => locEq(g, warded),
    };
    expect(squareAllowsSummon(state, warded, preds)).toBe(false);
    expect(squareAllowsSummon(state, trapped, preds)).toBe(false);
    expect(squareAllowsSummon(state, loc(14, 10), preds)).toBe(true);
  });
});

describe("placeNewMonsterOne (mon-make.c L1079, live)", () => {
  it("constructs and registers a monster, counting its race", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = plainRace();
    const before = race.curNum;
    const ok = placeNewMonsterOne(
      state,
      loc(14, 10),
      race,
      false,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state),
    );
    expect(ok).toBe(true);
    const mon = squareMonster(state, loc(14, 10));
    expect(mon).toBeTruthy();
    expect(mon!.race).toBe(race);
    expect(mon!.hp).toBeGreaterThan(0);
    expect(race.curNum).toBe(before + 1);
    /* The monster started its own group and leads it. */
    const group = state.groups[mon!.groupInfo[GROUP_TYPE.PRIMARY]!.index];
    expect(group?.leader).toBe(mon!.midx);
    /* deleteMonster forgets the racial occurrence. */
    deleteMonster(state, mon!.midx);
    expect(race.curNum).toBe(before);
  });

  it("sleep places the monster asleep with the racial value", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 5 });
    const race = { ...plainRace(), sleep: 20 };
    placeNewMonsterOne(
      state,
      loc(14, 10),
      race,
      true,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state),
    );
    const mon = squareMonster(state, loc(14, 10))!;
    /* (val * 2) + randint1(val * 10). */
    expect(mon.mTimed[MON_TMD.SLEEP]).toBeGreaterThanOrEqual(41);
  });

  it("refuses occupied grids, the player, walls and glyphs", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = plainRace();
    const info = { index: 0, role: MON_GROUP.LEADER };
    addMon(state, plainRace(), loc(12, 10));
    const d = deps(state);
    expect(placeNewMonsterOne(state, loc(12, 10), race, false, info, d)).toBe(false);
    expect(placeNewMonsterOne(state, loc(10, 10), race, false, info, d)).toBe(false);
    expect(placeNewMonsterOne(state, loc(0, 0), race, false, info, d)).toBe(false);
    const warded = loc(15, 10);
    const dp = deps(state, {
      preds: {
        isPlayerTrap: () => false,
        isWebbed: () => false,
        isWarded: (g: Loc) => locEq(g, warded),
      },
    });
    expect(placeNewMonsterOne(state, warded, race, false, info, dp)).toBe(false);
  });

  it("enforces uniqueness and FORCE_DEPTH", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const info = { index: 0, role: MON_GROUP.LEADER };
    const d = deps(state);

    const unique = makeRace({ level: 3, flags: [RF.UNIQUE] });
    unique.maxNum = 1;
    expect(placeNewMonsterOne(state, loc(14, 10), unique, false, info, d)).toBe(true);
    /* One at a time. */
    expect(placeNewMonsterOne(state, loc(16, 10), unique, false, info, d)).toBe(false);
    /* Dead (max_num 0) stays dead. */
    deleteMonster(state, squareMonster(state, loc(14, 10))!.midx);
    unique.maxNum = 0;
    expect(placeNewMonsterOne(state, loc(14, 10), unique, false, info, d)).toBe(false);

    /* FORCE_DEPTH refuses above the native depth (chunk depth 0 here). */
    const deep = makeRace({ level: 40, flags: [RF.FORCE_DEPTH] });
    expect(placeNewMonsterOne(state, loc(16, 10), deep, false, info, d)).toBe(false);
    state.chunk.depth = 40;
    expect(placeNewMonsterOne(state, loc(16, 10), deep, false, info, d)).toBe(true);
  });
});

describe("placeNewMonster (mon-make.c L1360, live groups)", () => {
  it("places a same-race friend group sharing one group", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 7 });
    state.chunk.depth = 10;
    /* A real pack race that brings same-race friends. */
    const race = raceWhere(
      (r) =>
        !r.flags.has(RF.UNIQUE) &&
        r.level <= 5 &&
        r.friends.length > 0 &&
        r.friends[0]!.race === r &&
        r.friends[0]!.percentChance === 100,
    );
    const ok = placeNewMonster(
      state,
      loc(20, 12),
      race,
      false,
      true,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state),
    );
    expect(ok).toBe(true);
    const placed = state.monsters.filter(Boolean);
    expect(placed.length).toBeGreaterThan(1);
    /* All in the leader's group. */
    const leader = squareMonster(state, loc(20, 12))!;
    const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!.index;
    for (const mon of placed) {
      expect(mon!.groupInfo[GROUP_TYPE.PRIMARY]!.index).toBe(gi);
    }
    expect(state.groups[gi]!.leader).toBe(leader.midx);
    /* Wiping the counts puts every race back. */
    wipeMonsterCounts(state);
    expect(race.curNum).toBe(0);
  });
});

describe("summonSpecific (mon-summon.c L402)", () => {
  it("summons an eligible monster near the grid and returns its level", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 11 });
    state.chunk.depth = 10;
    const level = summonSpecific(
      state,
      state.actor.grid,
      10,
      summons.nameToIdx("UNDEAD"),
      false,
      false,
      deps(state),
    );
    expect(level).toBeGreaterThan(0);
    const placed = state.monsters.filter(Boolean);
    expect(placed.length).toBe(1);
    const mon = placed[0]!;
    expect(mon.race.flags.has(RF.UNDEAD)).toBe(true);
    expect(distance(mon.grid, state.actor.grid)).toBeLessThanOrEqual(4);
    /* Summoned awake. */
    expect(mon.mTimed[MON_TMD.SLEEP] ?? 0).toBe(0);
  });

  it("returns 0 when no race is eligible", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    /* Ancient dragons do not allocate at depth 0 / low level. */
    const level = summonSpecific(
      state,
      state.actor.grid,
      1,
      summons.nameToIdx("HI_DRAGON"),
      false,
      false,
      deps(state),
    );
    expect(level).toBe(0);
    expect(state.monsters.filter(Boolean).length).toBe(0);
  });

  it("delay zeroes energy and holds only faster summons", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const state = makeState({ playerGrid: loc(10, 10), seed });
      state.chunk.depth = 15;
      const level = summonSpecific(
        state,
        state.actor.grid,
        15,
        summons.nameToIdx("MONSTER"),
        true,
        false,
        deps(state),
      );
      if (!level) continue;
      const mon = state.monsters.filter(Boolean)[0]!;
      expect(mon.energy).toBe(0);
      if (mon.mspeed > state.actor.speed) {
        expect(mon.mTimed[MON_TMD.HOLD] ?? 0).toBeGreaterThan(0);
      } else {
        expect(mon.mTimed[MON_TMD.HOLD] ?? 0).toBe(0);
      }
    }
  });

  it("call moves an out-of-sight eligible monster to the summon point", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 17 });
    state.chunk.depth = 10;
    /* Wall off a corner so the resident undead is out of LOS. */
    for (let y = 1; y < 24; y++) state.chunk.setFeat(loc(30, y), GRANITE);
    const undead = addMon(
      state,
      makeRace({ level: 8, flags: [RF.UNDEAD] }),
      loc(35, 10),
      { hp: 40 },
    );
    undead.mTimed[MON_TMD.SLEEP] = 50;
    const level = summonSpecific(
      state,
      state.actor.grid,
      8,
      summons.nameToIdx("UNDEAD"),
      false,
      true,
      deps(state),
    );
    expect(level).toBe(undead.race.level);
    /* The undead was moved beside the player, woken, drained of energy. */
    expect(distance(undead.grid, state.actor.grid)).toBeLessThanOrEqual(4);
    expect(undead.mTimed[MON_TMD.SLEEP]).toBe(0);
    expect(undead.energy).toBe(0);
    /* No new monster was created. */
    expect(state.monsters.filter(Boolean).length).toBe(1);
  });
});

describe("summoner group joining", () => {
  it("puts summons in the summoner's summon group", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 19 });
    state.chunk.depth = 10;
    const summoner = addMon(state, makeRace({ level: 20 }), loc(14, 10));
    const level = summonSpecific(
      state,
      summoner.grid,
      15,
      summons.nameToIdx("MONSTER"),
      false,
      false,
      deps(state, { monCurrent: summoner.midx }),
    );
    expect(level).toBeGreaterThan(0);
    const summoned = state.monsters.filter(
      (m) => m && m !== summoner,
    )[0]!;
    expect(summoned.groupInfo[GROUP_TYPE.PRIMARY]!.role).toBe(MON_GROUP.SUMMON);
    const group = summonGroup(state, summoner.midx);
    expect(summoned.groupInfo[GROUP_TYPE.PRIMARY]!.index).toBe(group!.index);
  });
});

describe("multiplyMonster (mon-make.c multiply_monster, L983) - become_aware", () => {
  it("reveals a camouflaged child when the (already-revealed) parent multiplies", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace({ flags: [RF.UNAWARE] });
    const mon = addMon(state, race, loc(20, 10));
    /* blankMonster leaves MFLAG_CAMOUFLAGE off - the parent is "already
     * revealed", matching monster_is_camouflaged(mon) == false upstream. */

    let revealedMidx: number | null = null;
    state.becomeAware = (m) => {
      revealedMidx = m.midx;
    };

    const ok = multiplyMonster(state, mon, deps(state));
    expect(ok).toBe(true);

    const child = state.monsters.find((m) => m && m !== mon && m.race === race);
    expect(child).toBeTruthy();
    expect(child!.mflag.has(MFLAG.CAMOUFLAGE)).toBe(true);
    expect(revealedMidx).toBe(child!.midx);
  });

  it("does not reveal the child when the parent is itself still camouflaged", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace({ flags: [RF.UNAWARE] });
    const mon = addMon(state, race, loc(20, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE); // parent still hidden

    let called = false;
    state.becomeAware = () => {
      called = true;
    };

    const ok = multiplyMonster(state, mon, deps(state));
    expect(ok).toBe(true);
    expect(called).toBe(false);
  });
});
