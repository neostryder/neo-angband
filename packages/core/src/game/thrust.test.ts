import { describe, expect, it } from "vitest";
import { RF } from "../generated";
import { distance, loc, locEq } from "../loc";
import { addMon, makeState, monReg } from "./harness";
import { thrustAway } from "./thrust";

const plainRace = monReg.races.find(
  (r) => r.rarity > 0 && !r.flags.has(RF.UNIQUE),
)!;

describe("thrust_away (project-mon.c L87)", () => {
  it("knocks a monster away from the projection centre", () => {
    const state = makeState({ playerGrid: loc(30, 5), seed: 11 });
    const mon = addMon(state, plainRace, loc(10, 10), { hp: 30 });
    const centre = loc(7, 10);
    const before = distance(mon.grid, centre);

    thrustAway(state, centre, mon.grid, 3);

    expect(distance(mon.grid, centre)).toBeGreaterThan(before);
    /* The occupancy marker follows the monster. */
    expect(state.chunk.mon(mon.grid)).toBe(mon.midx);
    expect(state.chunk.isPassable(mon.grid)).toBe(true);
  });

  it("knocks the player away and keeps the actor grid in step", () => {
    const start = loc(12, 12);
    const state = makeState({ playerGrid: start, seed: 5 });
    const centre = loc(12, 9);

    /* The post-move hook fires only for a DISPLACED player (upstream checks
     * the vacated grid after the swap), so it stays silent here. */
    thrustAway(state, centre, start, 4, {});

    expect(locEq(state.actor.grid, start)).toBe(false);
    expect(distance(state.actor.grid, centre)).toBeGreaterThan(3);
    expect(state.chunk.mon(state.actor.grid)).toBe(-1);
    expect(state.chunk.mon(start)).toBe(0);
  });

  it("stops at the map edge instead of leaving the level", () => {
    /* Push hard toward the east wall: the target comes to rest inside. */
    const state = makeState({ playerGrid: loc(36, 12), seed: 3 });
    thrustAway(state, loc(30, 12), loc(36, 12), 10, { msg: () => {} });
    expect(state.chunk.inBoundsFully(state.actor.grid)).toBe(true);
    expect(state.chunk.isPassable(state.actor.grid)).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const run = (): string => {
      const s = makeState({ playerGrid: loc(12, 12), seed: 17 });
      thrustAway(s, loc(12, 9), loc(12, 12), 4);
      return `${s.actor.grid.x},${s.actor.grid.y}`;
    };
    expect(run()).toBe(run());
  });
});
