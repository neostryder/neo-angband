import { describe, expect, it } from "vitest";
import { FEAT, MFLAG, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import { objectNew } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";
import type { Monster } from "../mon/monster.js";
import { deleteMonster } from "./context.js";
import type { GameState } from "./context.js";
import { addMon, makeState, monReg } from "./harness.js";
import { floorCarry, floorPile } from "./floor.js";
import { pushObject } from "./project-feat.js";

/** A bare object of a synthetic kind. */
let nextKidx = 1;
function makeObj(tval: number): GameObject {
  const kind = {
    kidx: nextKidx++,
    tval,
    name: "Widget",
    toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    base: { maxStack: 40 },
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = tval;
  return obj;
}

/**
 * A real unrevealed mimic: the monster on the grid, the fake object on the
 * same grid, and the two-way link both halves of the port read - mon-place.ts
 * monCreateMimickedObject sets exactly this pair.
 */
function placeMimic(
  state: GameState,
  grid: Loc,
): { mon: Monster; fake: GameObject } {
  const race = monReg.races.find((r) => r.rarity > 0)!;
  const mon = addMon(state, race, grid, { hp: 20 });
  mon.mflag.on(MFLAG.CAMOUFLAGE);
  const fake = makeObj(TV.SCROLL);
  floorCarry(state, grid, fake);
  fake.mimickingMIdx = mon.midx;
  mon.mimickedObj = 1;
  return { mon, fake };
}

/** Wall off every grid within Chebyshev distance d, leaving the centre. */
function boxIn(state: GameState, grid: Loc, d: number): void {
  for (let y = grid.y - d; y <= grid.y + d; y++) {
    for (let x = grid.x - d; x <= grid.x + d; x++) {
      if (x === grid.x && y === grid.y) continue;
      state.chunk.setFeat(loc(x, y), FEAT.GRANITE);
    }
  }
}

/** Where the object is now, by search - obj.grid is what we want to check. */
function gridOf(state: GameState, obj: GameObject): Loc | null {
  for (const [idx, pile] of state.floor) {
    if (pile.includes(obj)) {
      return loc(idx % state.chunk.width, Math.floor(idx / state.chunk.width));
    }
  }
  return null;
}

describe("push_object's unrevealed-mimic arm (obj-pile.c:1213-1256)", () => {
  /* Seeded, so these are deterministic: the scatter can pick the centre grid
   * (an open door, which floor_carry refuses) and retry at a wider d, and the
   * assertions below hold for every outcome of that draw rather than for one
   * lucky destination. */
  for (const seed of [1, 2, 3, 7, 11]) {
    it(`keeps the monster with its object (seed ${seed})`, () => {
      const state = makeState({ seed });
      const grid = loc(10, 10);
      const { mon, fake } = placeMimic(state, grid);

      pushObject(state, grid);

      const landed = gridOf(state, fake);
      expect(landed).not.toBeNull();
      /* The grid stopped holding objects, which is why push_object ran. */
      expect(landed).not.toEqual(grid);
      /* The whole point: the monster went with it. */
      expect(mon.grid).toEqual(landed);
      expect(state.chunk.mon(landed!)).toBe(mon.midx);
      expect(state.chunk.mon(grid)).toBe(0);
      /* And the pair is still linked, so the mimicry survives the move. */
      expect(fake.mimickingMIdx).toBe(mon.midx);
      expect(mon.mimickedObj).not.toBe(0);
    });
  }

  /**
   * The C nulls mimicked_obj before the scatter and restores it after the
   * swap. Two of the three readers inside monster_swap - become_aware and
   * move_mimicked_object - cannot tell either way here, because both look at
   * the monster's OLD grid and push_object emptied it. The third can:
   * update_mon keeps MFLAG_VISIBLE for a monster that is still mimicking a
   * non-ignored item (mon-util.c L429-433), and with the link down it does
   * not. Skipping the clear leaves the mimic marked visible where upstream
   * clears the mark.
   */
  it("the mimic is not left marked visible while it is in transit", () => {
    const state = makeState();
    const grid = loc(10, 10);
    const { mon } = placeMimic(state, grid);
    /* An unrevealed mimic in view IS flagged visible - the player can see the
     * item. The harness runs no FOV, so update_mon inside the swap recomputes
     * "not seen now", which is the branch under test. */
    mon.mflag.on(MFLAG.VISIBLE);

    pushObject(state, grid);

    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(false);
  });

  it("destroys both when nothing within d < 4 will take the object", () => {
    const state = makeState();
    const grid = loc(10, 10);
    const { mon, fake } = placeMimic(state, grid);
    const midx = mon.midx;
    /* scatter_ext searches d = 1, 2, 3 before giving up, so granite out to 3
     * leaves only the centre - an open door, which floor_carry refuses. */
    boxIn(state, grid, 3);

    pushObject(state, grid);

    expect(state.monsters[midx]).toBeNull();
    expect(state.chunk.mon(grid)).toBe(0);
    expect(gridOf(state, fake)).toBeNull();
  });

  /**
   * The granite fixture above proves the give-up happens, but not WHERE: walls
   * block line of sight, so scatter_ext finds nothing at any d and widening the
   * cutoff changes nothing. This one puts a perfectly good destination at
   * distance 4 - reachable, in sight, empty floor - and blocks d = 1..3 with
   * clutter instead of stone, which stops square_isempty without stopping los.
   * Upstream gives up anyway, because the cutoff is d >= 4 and not d >= 5.
   */
  it("gives up at d = 4 even when a grid one ring further would take it", () => {
    const state = makeState();
    const grid = loc(10, 10);
    const { mon, fake } = placeMimic(state, grid);
    const midx = mon.midx;
    for (let y = grid.y - 3; y <= grid.y + 3; y++) {
      for (let x = grid.x - 3; x <= grid.x + 3; x++) {
        if (x === grid.x && y === grid.y) continue;
        floorCarry(state, loc(x, y), makeObj(TV.SWORD));
      }
    }

    pushObject(state, grid);

    expect(state.monsters[midx]).toBeNull();
    expect(gridOf(state, fake)).toBeNull();
  });

  it("still drops an ordinary object through drop_near", () => {
    const state = makeState();
    const grid = loc(10, 10);
    const obj = makeObj(TV.SWORD);
    floorCarry(state, grid, obj);

    pushObject(state, grid);

    const landed = gridOf(state, obj);
    expect(landed).not.toBeNull();
    expect(landed).not.toEqual(grid);
  });

  it("a mimic index pointing at no monster drops the object instead of throwing", () => {
    const state = makeState();
    const grid = loc(10, 10);
    const orphan = makeObj(TV.SCROLL);
    floorCarry(state, grid, orphan);
    orphan.mimickingMIdx = 99; /* no such monster */

    expect(() => pushObject(state, grid)).not.toThrow();
    expect(gridOf(state, orphan)).not.toBeNull();
    expect(orphan.mimickingMIdx).toBe(0);
  });

  it("the pushed pile leaves the grid whether or not a mimic is in it", () => {
    const state = makeState();
    const grid = loc(10, 10);
    placeMimic(state, grid);
    floorCarry(state, grid, makeObj(TV.SWORD));
    expect(floorPile(state, grid)).toHaveLength(2);

    pushObject(state, grid);

    expect(floorPile(state, grid)).toHaveLength(0);
  });
});

/**
 * delete_monster_idx's "Delete mimicked objects" (mon-make.c:385-387) - the
 * other half of 2.14. monster_death has always deleted the fake item, but 17
 * of the 18 places that remove a monster go through delete_monster_idx and
 * never touch it.
 */
describe("delete_monster_idx takes the mimicked object with it", () => {
  it("removes the fake item when the mimic is deleted without dying", () => {
    const state = makeState();
    const grid = loc(10, 10);
    const { mon, fake } = placeMimic(state, grid);
    const real = makeObj(TV.SWORD);
    floorCarry(state, grid, real);

    deleteMonster(state, mon.midx);

    /* The fake goes; a genuine object sharing the grid does not. */
    expect(floorPile(state, grid)).toEqual([real]);
    expect(gridOf(state, fake)).toBeNull();
    expect(mon.mimickedObj).toBe(0);
  });

  it("leaves an ordinary monster's grid alone", () => {
    const state = makeState();
    const grid = loc(10, 10);
    const race = monReg.races.find((r) => r.rarity > 0)!;
    const mon = addMon(state, race, grid, { hp: 20 });
    const obj = makeObj(TV.SWORD);
    floorCarry(state, grid, obj);

    deleteMonster(state, mon.midx);

    expect(floorPile(state, grid)).toEqual([obj]);
  });
});
