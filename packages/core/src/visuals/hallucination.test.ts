import { describe, expect, it } from "vitest";
import {
  hallucinateGrid,
  hallucinatoryMonster,
  hallucinatoryObject,
  type HallucinationRandom,
} from "./hallucination.js";

/**
 * A scripted stand-in for the display stream. `oneIn` consumes from a queue of
 * booleans and `randint0` from a queue of numbers, so a test states exactly
 * which upstream branch it is exercising - and `counts` proves how many draws
 * were actually taken, which is the only way to catch an arm that short-circuits
 * when upstream's does not.
 */
function scripted(oneIn: boolean[], randint0: number[] = []): HallucinationRandom & {
  counts: { oneIn: number; randint0: number };
} {
  const counts = { oneIn: 0, randint0: 0 };
  return {
    counts,
    oneIn: () => {
      const v = oneIn[counts.oneIn++];
      if (v === undefined) throw new Error("oneIn: script exhausted");
      return v;
    },
    randint0: () => {
      const v = randint0[counts.randint0++];
      if (v === undefined) throw new Error("randint0: script exhausted");
      return v;
    },
  };
}

const EMPTY = { image: true, monster: false, object: false, sensed: false, permanentWall: false };

describe("hallucinateGrid (cave-map.c L179-188)", () => {
  it("does nothing at all when the player is not hallucinating", () => {
    const rand = scripted([]);
    expect(hallucinateGrid({ ...EMPTY, image: false }, rand)).toEqual({
      hallucinate: false,
      monsterGlyph: false,
      objectGlyph: false,
    });
    /* Not one draw: upstream never reaches the block with TMD_IMAGE clear. */
    expect(rand.counts).toEqual({ oneIn: 0, randint0: 0 });
  });

  it("substitutes for whatever is really there, with no roll at all", () => {
    const rand = scripted([]);
    expect(hallucinateGrid({ ...EMPTY, monster: true }, rand)).toEqual({
      hallucinate: true, monsterGlyph: true, objectGlyph: false,
    });
    expect(hallucinateGrid({ ...EMPTY, object: true }, rand)).toEqual({
      hallucinate: true, monsterGlyph: false, objectGlyph: true,
    });
    expect(hallucinateGrid({ ...EMPTY, monster: true, object: true }, rand)).toEqual({
      hallucinate: true, monsterGlyph: true, objectGlyph: true,
    });
    /* The placeholder block is guarded by `m_idx == 0 && first_kind == 0`. */
    expect(rand.counts.oneIn).toBe(0);
  });

  it("invents a monster on the first 1/128, and stops there", () => {
    const rand = scripted([true]);
    expect(hallucinateGrid(EMPTY, rand)).toEqual({
      hallucinate: true, monsterGlyph: true, objectGlyph: false,
    });
    /* Upstream's second test is an `else if`, so it is never evaluated. */
    expect(rand.counts.oneIn).toBe(1);
  });

  it("invents an object only on the second 1/128", () => {
    const rand = scripted([false, true]);
    expect(hallucinateGrid(EMPTY, rand)).toEqual({
      hallucinate: true, monsterGlyph: false, objectGlyph: true,
    });
    expect(rand.counts.oneIn).toBe(2);
  });

  it("turns hallucination OFF for an empty grid that misses both", () => {
    const rand = scripted([false, false]);
    /* This is the common case, and it is why hallucination is a sparse
     * scatter rather than a screen of noise - and why the trap on such a grid
     * still draws. */
    expect(hallucinateGrid(EMPTY, rand)).toEqual({
      hallucinate: false, monsterGlyph: false, objectGlyph: false,
    });
  });

  it("gives a permanent wall nothing, but still consumes both draws", () => {
    /* one_in_(128) is evaluated BEFORE the FEAT_PERM test in each arm, so a
     * successful roll on an outer wall is spent and discarded. Asserting the
     * draw COUNT is the point: a port that tested the wall first would pass an
     * assertion on the result and still have the wrong stream position. */
    const rand = scripted([true, true]);
    expect(hallucinateGrid({ ...EMPTY, permanentWall: true }, rand)).toEqual({
      hallucinate: false, monsterGlyph: false, objectGlyph: false,
    });
    expect(rand.counts.oneIn).toBe(2);
  });

  it("keeps an invented object off a grid that already shows a sensed marker", () => {
    /* grid_data_as_text tests unseen_money/unseen_object BEFORE the first_kind
     * arm (ui-map.c L199-212), so the star wins and the invented object is
     * never drawn. The grid still hallucinates - which suppresses its trap. */
    const rand = scripted([false, true]);
    expect(hallucinateGrid({ ...EMPTY, sensed: true }, rand)).toEqual({
      hallucinate: true, monsterGlyph: false, objectGlyph: false,
    });
  });
});

describe("hallucinatoryMonster (ui-map.c L41-55)", () => {
  const pool = (names: (string | null)[]) => ({
    count: names.length,
    named: (i: number) => names[i] !== null,
  });

  it("retries past nameless holes until it lands on a real race", () => {
    const rand = scripted([], [0, 1, 2]);
    expect(hallucinatoryMonster(pool([null, null, "orc"]), rand)).toBe(2);
    expect(rand.counts.randint0).toBe(3);
  });

  it("includes index 0, the <player> pseudo-race", () => {
    /* Upstream draws randint0(r_max) with no lower bound, so a hallucinating
     * player really does see stray '@'s. Excluding index 0 here would look like
     * a tidy-up and would silently remove one of the effect's glyphs. */
    const rand = scripted([], [0]);
    expect(hallucinatoryMonster(pool(["<player>", "orc"]), rand)).toBe(0);
  });

  it("gives up rather than spinning forever on a table with no named entry", () => {
    /* Upstream writes `while (1)` and is safe because r_info is compiled in.
     * Here a mod supplies the table, and a hang inside the render loop draws no
     * frame and cannot be escaped. */
    const rand: HallucinationRandom = { oneIn: () => false, randint0: () => 0 };
    expect(hallucinatoryMonster(pool([null, null]), rand)).toBeNull();
    expect(hallucinatoryMonster({ count: 0, named: () => true }, rand)).toBeNull();
  });
});

describe("hallucinatoryObject (ui-map.c L61-80)", () => {
  const pool = (kinds: ({ attr: number; char: string } | null)[]) => ({
    count: kinds.length,
    named: (i: number) => kinds[i] !== null,
    glyph: (i: number) => kinds[i] ?? null,
  });

  it("never selects index 0, the sentinel map_info uses for an invented object", () => {
    /* randint0(k_max - 1) + 1. With a 3-slot table the draw is over 0..1 and
     * the result is 1..2, so slot 0 is unreachable however the roll falls. */
    const kinds = [
      { attr: 1, char: "!" },
      { attr: 2, char: "?" },
      { attr: 3, char: "-" },
    ];
    for (const roll of [0, 1]) {
      const rand = scripted([], [roll]);
      expect(hallucinatoryObject(pool(kinds), rand)).toBe(roll + 1);
    }
  });

  it("rejects a nameless kind AND a named kind with an empty glyph slot", () => {
    /* Upstream has two separate `continue`s and both matter: a kind can be
     * named and still have attr 0 in the x_attr table. */
    const kinds = [
      { attr: 9, char: "&" },        // 0: unreachable
      null,                          // 1: nameless
      { attr: 0, char: "?" },        // 2: named, no attr
      { attr: 4, char: "" },         // 3: named, no char
      { attr: 5, char: "=" },        // 4: the only valid pick
    ];
    const rand = scripted([], [0, 1, 2, 3]);
    expect(hallucinatoryObject(pool(kinds), rand)).toBe(4);
    expect(rand.counts.randint0).toBe(4);
  });

  it("gives up on a table with no selectable kind", () => {
    const rand: HallucinationRandom = { oneIn: () => false, randint0: () => 0 };
    expect(hallucinatoryObject(pool([{ attr: 1, char: "!" }, null]), rand)).toBeNull();
    expect(hallucinatoryObject(pool([{ attr: 1, char: "!" }]), rand)).toBeNull();
  });
});
