import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, RF } from "../generated";
import { loc } from "../loc";
import {
  COLOUR_RED,
  COLOUR_VIOLET,
  COLOUR_WHITE,
} from "../color";
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import type { GameState } from "./context";
import { addMon, makeRace, makeState } from "./harness";
import {
  MONSTER_LIST_SECTION_ESP,
  MONSTER_LIST_SECTION_LOS,
  monsterListCollect,
  monsterListCompareExp,
  monsterListEntryLineColor,
  monsterListSort,
  monsterListStandardCompare,
} from "./mon-list";

/** A visible monster of the given race at a grid. */
function addVisible(
  state: GameState,
  race: ReturnType<typeof makeRace>,
  at: Loc,
): Monster {
  const mon = addMon(state, race, at, { hp: 30 });
  mon.mflag.on(MFLAG.VISIBLE);
  return mon;
}

describe("monster_list_collect (mon-list.c L138)", () => {
  it("groups visible monsters by race in the LOS section", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const race = makeRace({ level: 5 });
    addVisible(state, race, loc(22, 12));
    addVisible(state, race, loc(23, 12));
    addVisible(state, makeRace({ level: 9 }), loc(21, 12));

    const list = monsterListCollect(state);
    expect(list.distinctEntries).toBe(2);
    expect(list.totalMonsters[MONSTER_LIST_SECTION_LOS]).toBe(3);
    const same = list.entries.find((e) => e.race === race)!;
    expect(same.count[MONSTER_LIST_SECTION_LOS]).toBe(2);
  });

  it("skips invisible and camouflaged monsters", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    /* Not marked visible. */
    addMon(state, makeRace(), loc(22, 12), { hp: 30 });
    /* Visible but camouflaged (unrecognised mimic). */
    const mimic = addVisible(state, makeRace(), loc(23, 12));
    mimic.mflag.on(MFLAG.CAMOUFLAGE);

    const list = monsterListCollect(state);
    expect(list.distinctEntries).toBe(0);
  });

  it("tallies asleep monsters", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const race = makeRace();
    const sleeper = addVisible(state, race, loc(22, 12));
    sleeper.mTimed[MON_TMD.SLEEP] = 500;
    addVisible(state, race, loc(23, 12));

    const list = monsterListCollect(state);
    const e = list.entries[0]!;
    expect(e.count[MONSTER_LIST_SECTION_LOS]).toBe(2);
    expect(e.asleep[MONSTER_LIST_SECTION_LOS]).toBe(1);
  });

  it("places out-of-view (ESP) monsters in the telepathy section", () => {
    /* Distance 35 > max_range 20 => not projectable => ESP. */
    const state = makeState({ w: 60, playerGrid: loc(5, 12) });
    addVisible(state, makeRace(), loc(40, 12));

    const list = monsterListCollect(state);
    expect(list.totalMonsters[MONSTER_LIST_SECTION_ESP]).toBe(1);
    expect(list.totalMonsters[MONSTER_LIST_SECTION_LOS]).toBe(0);
  });
});

describe("monster_list sorting + colour", () => {
  it("standard compare orders by depth descending", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    addVisible(state, makeRace({ level: 3 }), loc(22, 12));
    addVisible(state, makeRace({ level: 12 }), loc(23, 12));
    addVisible(state, makeRace({ level: 7 }), loc(24, 12));

    const list = monsterListCollect(state);
    monsterListSort(list, monsterListStandardCompare);
    expect(list.entries.map((e) => e.race.level)).toEqual([12, 7, 3]);
    expect(list.sorted).toBe(true);
  });

  it("exp compare orders by experience yielded", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    addVisible(state, makeRace({ level: 2, mexp: 5 }), loc(22, 12));
    addVisible(state, makeRace({ level: 2, mexp: 500 }), loc(23, 12));

    const list = monsterListCollect(state);
    monsterListSort(list, monsterListCompareExp(state.actor.player.lev));
    expect(list.entries[0]!.race.mexp).toBe(500);
  });

  it("colours uniques violet, over-depth red, else white", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const unique = makeRace({ flags: [RF.UNIQUE], level: 1 });
    const deep = makeRace({ level: 40 });
    const shallow = makeRace({ level: 1 });
    expect(monsterListEntryLineColor({ race: unique } as never, 5)).toBe(
      COLOUR_VIOLET,
    );
    expect(monsterListEntryLineColor({ race: deep } as never, 5)).toBe(
      COLOUR_RED,
    );
    expect(monsterListEntryLineColor({ race: shallow } as never, 5)).toBe(
      COLOUR_WHITE,
    );
  });
});
