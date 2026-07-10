import { describe, expect, it } from "vitest";
import { FEAT, MFLAG, MON_TMD, RF, SQUARE, TMD } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import { deleteMonster } from "./context";
import type { GameState } from "./context";
import { squareMemorize } from "./known";
import { addMon, makeRace, makeState } from "./harness";
import {
  TARGET,
  coordsDesc,
  lookMonDesc,
  targetAble,
  targetAccept,
  targetFix,
  targetGet,
  targetGetMonster,
  targetGetMonsters,
  targetIsSet,
  targetOkay,
  targetPick,
  targetRelease,
  targetSetClosest,
  targetSetLocation,
  targetSetMonster,
  targetSighted,
} from "./target";

/** A visible (target-able) monster of the given race flags. */
function addVisible(
  state: GameState,
  at: Loc,
  flags: number[] = [],
  hp = 60,
): Monster {
  const mon = addMon(state, makeRace({ flags }), at, { hp });
  mon.mflag.on(MFLAG.VISIBLE);
  return mon;
}

describe("target_able (target.c L110)", () => {
  it("accepts an obvious, projectable monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    expect(targetAble(state, mon)).toBe(true);
  });

  it("rejects a monster the player cannot see", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(14, 10), { hp: 30 });
    expect(targetAble(state, mon)).toBe(false);
  });

  it("rejects everything while hallucinating", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    state.actor.player.timed[TMD.IMAGE] = 10;
    expect(targetAble(state, mon)).toBe(false);
  });

  it("rejects a monster beyond max_range", () => {
    const state = makeState({ w: 60, playerGrid: loc(5, 12) });
    const mon = addVisible(state, loc(30, 12)); /* distance 25 > 20 */
    expect(targetAble(state, mon)).toBe(false);
  });
});

describe("target_set_monster / target_okay / target_get", () => {
  it("sets a monster target and follows it as it moves", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    expect(targetSetMonster(state, mon)).toBe(true);
    expect(targetIsSet(state)).toBe(true);
    expect(targetGetMonster(state)).toBe(mon);

    /* The monster moves; target_okay refreshes the grid. */
    state.chunk.setMon(mon.grid, 0);
    mon.grid = loc(13, 11);
    state.chunk.setMon(mon.grid, mon.midx);
    expect(targetOkay(state)).toBe(true);
    expect(targetGet(state)).toEqual(loc(13, 11));
  });

  it("clears the target when passed nobody", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    targetSetMonster(state, mon);
    expect(targetSetMonster(state, null)).toBe(false);
    expect(targetIsSet(state)).toBe(false);
    expect(targetOkay(state)).toBe(false);
  });
});

describe("target_set_location (L180)", () => {
  it("targets a legal grid (a direction without a monster)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    targetSetLocation(state, loc(15, 12));
    expect(targetIsSet(state)).toBe(true);
    expect(targetOkay(state)).toBe(true);
    expect(targetGet(state)).toEqual(loc(15, 12));
    expect(targetGetMonster(state)).toBeNull();
  });

  it("resets on an out-of-bounds grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    targetSetLocation(state, loc(0, 0)); /* border: not fully in bounds */
    expect(targetIsSet(state)).toBe(false);
  });
});

describe("the fix/release lifecycle (L211/L220) and monster death", () => {
  it("an unfixed target dies: the target is cancelled", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    targetSetMonster(state, mon);
    deleteMonster(state, mon.midx);
    expect(targetIsSet(state)).toBe(false);
    expect(targetGetMonster(state)).toBeNull();
  });

  it("a fixed target dies mid-spell: the grid survives until release", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    targetSetMonster(state, mon);
    targetFix(state);
    deleteMonster(state, mon.midx);

    /* Further effects of the spell still have a target grid. */
    expect(targetOkay(state)).toBe(true);
    expect(targetGet(state)).toEqual(loc(14, 10));

    /* Release: the old target is a now-dead monster, cancel the grid. */
    targetRelease(state);
    expect(targetOkay(state)).toBe(false);
  });

  it("release keeps a target that is still alive and in view", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    mon.mflag.on(MFLAG.VIEW);
    targetSetMonster(state, mon);
    targetFix(state);
    targetRelease(state);
    expect(targetOkay(state)).toBe(true);
    expect(targetGetMonster(state)).toBe(mon);
  });
});

describe("target_accept (L325)", () => {
  it("finds the player, obvious monsters, memory and stairs interesting", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));

    /* Player and monster grids. */
    expect(targetAccept(state, loc(10, 10))).toBe(true);
    expect(targetAccept(state, mon.grid)).toBe(true);

    /* Plain, unremembered floor is not. */
    expect(targetAccept(state, loc(12, 12))).toBe(false);

    /* A remembered floor object. */
    state.known.objects.set(13 * state.chunk.width + 13, { ch: "?", attr: "w" });
    expect(targetAccept(state, loc(13, 13))).toBe(true);

    /* Remembered interesting terrain (a staircase). */
    state.chunk.setFeat(loc(15, 15), FEAT.LESS);
    expect(targetAccept(state, loc(15, 15))).toBe(false); /* not yet known */
    squareMemorize(state, loc(15, 15));
    expect(targetAccept(state, loc(15, 15))).toBe(true);
  });

  it("hallucination blanks everything but the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    state.actor.player.timed[TMD.IMAGE] = 10;
    expect(targetAccept(state, loc(10, 10))).toBe(true);
    expect(targetAccept(state, mon.grid)).toBe(false);
  });
});

describe("target_get_monsters / target_set_closest (L437/L493)", () => {
  it("KILL mode lists target-able monsters closest first", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(18, 10));
    addVisible(state, loc(13, 10));
    addMon(state, makeRace(), loc(12, 10), { hp: 30 }); /* not visible */
    const targets = targetGetMonsters(state, TARGET.KILL);
    expect(targets).toEqual([loc(13, 10), loc(18, 10)]);
  });

  it("targets the closest matching monster, announcing and tracking it", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    addVisible(state, loc(18, 10), [RF.UNDEAD]);
    const near = addVisible(state, loc(13, 10), [RF.UNDEAD]);
    addVisible(state, loc(12, 10)); /* closer but living */

    expect(
      targetSetClosest(state, TARGET.KILL, (m) => m.race.flags.has(RF.UNDEAD)),
    ).toBe(true);
    expect(targetGetMonster(state)).toBe(near);
    expect(state.healthWho).toBe(near);
    expect(msgs.some((m) => m.endsWith("is targeted."))).toBe(true);
  });

  it("QUIET suppresses the announcement", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    addVisible(state, loc(13, 10));
    expect(targetSetClosest(state, TARGET.KILL | TARGET.QUIET)).toBe(true);
    expect(msgs).toEqual([]);
  });

  it("reports No Available Target when nothing qualifies", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    expect(targetSetClosest(state, TARGET.KILL)).toBe(false);
    expect(msgs).toContain("No Available Target.");
    expect(targetIsSet(state)).toBe(false);
  });
});

describe("target_pick (L276)", () => {
  it("picks the closest interesting point in the given direction", () => {
    const targets = [loc(15, 10), loc(12, 10), loc(10, 14)];
    /* East from (10, 10): the nearer of the two easterly points. */
    expect(targetPick(10, 10, 0, 1, targets)).toBe(1);
    /* South: only the southern point qualifies. */
    expect(targetPick(10, 10, 1, 0, targets)).toBe(2);
    /* West: nothing that way. */
    expect(targetPick(10, 10, 0, -1, targets)).toBe(-1);
  });
});

describe("target_sighted (L414)", () => {
  it("a visible monster target is sighted; an unseen grid is not", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addVisible(state, loc(14, 10));
    targetSetMonster(state, mon);
    expect(targetSighted(state)).toBe(true);

    targetSetLocation(state, loc(16, 12));
    expect(targetSighted(state)).toBe(false); /* grid not SEEN */
    state.chunk.sqinfoOn(loc(16, 12), SQUARE.SEEN);
    expect(targetSighted(state)).toBe(true);
  });
});

describe("look_mon_desc (L56) and coords_desc (L370)", () => {
  it("describes health bands, living vs destroyed, and status", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const living = addVisible(state, loc(14, 10), [], 100);
    expect(lookMonDesc(living)).toBe("unhurt");
    living.hp = 50;
    expect(lookMonDesc(living)).toBe("wounded");
    living.hp = 5;
    expect(lookMonDesc(living)).toBe("almost dead");

    const undead = addVisible(state, loc(15, 10), [RF.UNDEAD], 100);
    expect(lookMonDesc(undead)).toBe("undamaged");

    living.hp = 100;
    living.mTimed[MON_TMD.SLEEP] = 5;
    living.mTimed[MON_TMD.FEAR] = 5;
    expect(lookMonDesc(living)).toBe("unhurt, asleep, afraid");
  });

  it("describes a location relative to the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    expect(coordsDesc(state, loc(14, 7))).toBe("3 N, 4 E");
    expect(coordsDesc(state, loc(8, 12))).toBe("2 S, 2 W");
  });
});
