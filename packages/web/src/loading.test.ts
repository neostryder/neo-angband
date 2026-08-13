/**
 * The loading screen, driven without a clock.
 *
 * The point of building it out of pure functions is that "does it hang", "does
 * it draw outside its grid" and "does it ever stop being interesting" are
 * answerable here rather than by watching it. An animation nobody can test is an
 * animation that gets shipped stuck on frame one.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LOADING_CAPTIONS,
  LOADING_FRAME_MS,
  advance,
  captionFor,
  isFloor,
  makeScene,
  monsterTurn,
  paintScene,
  playerTurn,
  startLoading,
} from "./loading";
import type { GridSurface } from "./term";

/** A grid that records what was printed, and nothing else. */
function recorder(cols = 80, rows = 24): {
  term: GridSurface;
  cells: string[][];
  writes: { x: number; y: number; text: string }[];
  clears: number;
} {
  const cells: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => " "));
  const writes: { x: number; y: number; text: string }[] = [];
  let clears = 0;
  const term: GridSurface = {
    size: () => ({ cols, rows }),
    invalidate: () => undefined,
    flush: () => undefined,
    clear: () => {
      clears++;
      for (const row of cells) row.fill(" ");
    },
    setCursor: () => undefined,
    hideCursor: () => undefined,
    put: () => undefined,
    print: (x, y, text) => {
      writes.push({ x, y, text });
      const row = cells[y];
      if (!row) return;
      for (let i = 0; i < text.length; i++) row[x + i] = text[i] ?? " ";
    },
    eraseToEol: () => undefined,
    prt: () => undefined,
  };
  return {
    term,
    cells,
    writes,
    get clears() {
      return clears;
    },
  };
}

describe("the scene carves a dungeon and stays inside it", () => {
  it("starts with one carved square, not an empty screen", () => {
    const scene = makeScene(40, 12, 99);
    expect(isFloor(scene, scene.x, scene.y)).toBe(true);
  });

  it("keeps the digger inside the grid over a long boot", () => {
    /* 600 frames is about a minute at LOADING_FRAME_MS - longer than any boot
     * that is not already broken, and the range a reflecting walk has to survive
     * without ever leaving the grid. */
    const scene = makeScene(80, 22, 7);
    for (let i = 0; i < 600; i++) {
      advance(scene);
      expect(scene.digX, `frame ${i}`).toBeGreaterThanOrEqual(0);
      expect(scene.digY, `frame ${i}`).toBeLessThan(scene.rows);
      expect(scene.digX, `frame ${i}`).toBeLessThan(scene.cols);
      expect(scene.digY, `frame ${i}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps digging - the digger is somewhere new across a run of frames", () => {
    /* The failure this catches is a walk that reflects into a two-square
     * oscillation and animates forever without going anywhere. Positions are
     * counted rather than compared pairwise, because a healthy walk DOES revisit
     * squares; what it does not do is visit only two of them. */
    const scene = makeScene(60, 18, 4242);
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      advance(scene);
      seen.add(`${scene.digX},${scene.digY}`);
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it("its wanderers only ever stand on carved floor", () => {
    const scene = makeScene(70, 20, 1234);
    for (let i = 0; i < 300; i++) {
      advance(scene);
      for (const w of scene.wanderers) {
        expect(isFloor(scene, w.x, w.y), `${w.glyph} at ${w.x},${w.y}`).toBe(true);
      }
    }
  });

  it("does not fill the screen with monsters over a slow boot", () => {
    const scene = makeScene(70, 20, 88);
    for (let i = 0; i < 1000; i++) advance(scene);
    expect(scene.wanderers.length).toBeLessThanOrEqual(7);
  });

  it("is deterministic from its seed, and different between seeds", () => {
    const run = (seed: number): string => {
      const s = makeScene(40, 12, seed);
      for (let i = 0; i < 50; i++) advance(s);
      return `${s.x},${s.y},${s.cells.join("")}`;
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it("survives a seed of zero, which would otherwise freeze the LCG", () => {
    /* An LCG at zero stays at zero for this multiplier-and-increment pair only if
     * the increment is zero, but a caller passing 0 is common enough (a clock
     * that has not ticked, a missing option) that the still image is worth
     * ruling out directly. */
    const scene = makeScene(40, 12, 0);
    const start = `${scene.digX},${scene.digY}`;
    for (let i = 0; i < 40; i++) advance(scene);
    expect(`${scene.digX},${scene.digY}`).not.toBe(start);
  });
});

describe("the `@` walks the dungeon rather than digging through it (#252)", () => {
  /* The defect: `scene.x/y` WAS the digger, and the digger is the one thing in
   * the scene that is allowed through rock - so the glyph advertising the game
   * was a player ignoring walls, on a screen whose entire subject is a dungeon.
   * Everything below is about the two being separate now. */

  it("carves nothing: it walks the dungeon the digger made", () => {
    /* THE regression test, and it took a second attempt to write. The obvious
     * one - "the `@` is always standing on floor" - PASSES FOR THE BUG, because
     * the digger carves the square it steps onto, so the old `@` was on floor
     * every single frame while walking through solid rock.
     *
     * What separates them is who creates the floor. So the map is frozen (the
     * digger is not run) and the cells are compared byte for byte: a `@` that
     * digs cannot leave them alone, and a `@` that walks cannot help it. */
    const scene = makeScene(60, 18, 7);
    for (let i = 0; i < 80; i++) advance(scene);
    scene.wanderers.length = 0;
    for (let i = 0; i < 500; i++) {
      const before = Uint8Array.from(scene.cells);
      playerTurn(scene);
      expect(scene.cells, `frame ${i}: the @ changed the map`).toEqual(before);
      expect(isFloor(scene, scene.x, scene.y), `frame ${i} at ${scene.x},${scene.y}`).toBe(true);
    }
  });

  it("moves one square at a time, so it never crosses a wall it could not walk through", () => {
    /* Standing on floor is not the same as never crossing rock: a two-square
     * hop can start and land on floor with a wall between. The map is frozen
     * again, and the wanderers cleared - the one legitimate jump is the escape
     * in hurtPlayer, and nothing here can land a blow. */
    const scene = makeScene(70, 20, 31337);
    for (let i = 0; i < 80; i++) advance(scene);
    scene.wanderers.length = 0;
    for (let i = 0; i < 500; i++) {
      const from = { x: scene.x, y: scene.y };
      playerTurn(scene);
      const dx = Math.abs(scene.x - from.x);
      const dy = Math.abs(scene.y - from.y);
      expect(Math.max(dx, dy), `frame ${i}: ${from.x},${from.y} -> ${scene.x},${scene.y}`).toBeLessThanOrEqual(1);
    }
  });

  it("stays on floor through a whole boot, with everything else running too", () => {
    /* The frozen-map tests above are precise about the `@` alone. This one is
     * the sloppy long run that catches a branch they do not reach - a flee into
     * a corner, an escape landing, a dead end - over more frames than any boot
     * that is not already broken. */
    const scene = makeScene(80, 22, 7);
    expect(isFloor(scene, scene.x, scene.y), "frame 0").toBe(true);
    for (let i = 0; i < 900; i++) {
      advance(scene);
      expect(isFloor(scene, scene.x, scene.y), `frame ${i} at ${scene.x},${scene.y}`).toBe(true);
    }
  });

  it("is not the digger: the two are in different places within a few frames", () => {
    /* They start on the same square, which is correct - the `@` stands where
     * the first spadeful was. What must not happen is that they stay welded. */
    const scene = makeScene(60, 18, 909);
    expect(`${scene.x},${scene.y}`).toBe(`${scene.digX},${scene.digY}`);
    let apart = 0;
    for (let i = 0; i < 60; i++) {
      advance(scene);
      if (scene.x !== scene.digX || scene.y !== scene.digY) apart++;
    }
    expect(apart).toBeGreaterThan(50);
  });

  it("gets somewhere: it explores rather than shuffling between two squares", () => {
    const scene = makeScene(60, 18, 4242);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      advance(scene);
      seen.add(`${scene.x},${scene.y}`);
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it("fights: a wanderer standing next to it does not stay there for long", () => {
    const scene = makeScene(60, 18, 12);
    /* Carve a room to fight in, then stage the fight rather than waiting for
     * one - a test that waits for the scene to arrange its own encounter is
     * measuring the spawn rate, not the combat. */
    for (let i = 0; i < 40; i++) advance(scene);
    scene.wanderers.length = 0;
    const spot = { x: scene.x + 1, y: scene.y };
    if (!isFloor(scene, spot.x, spot.y)) {
      spot.x = scene.x;
      spot.y = scene.y;
    }
    scene.wanderers.push({ x: spot.x, y: spot.y, glyph: "k", hp: 3 });
    let killedBy = -1;
    for (let i = 0; i < 30 && killedBy < 0; i++) {
      advance(scene);
      if (scene.wanderers.length === 0) killedBy = i;
    }
    expect(killedBy, "the kobold outlived thirty frames next to an unhurt @").toBeGreaterThanOrEqual(0);
  });

  it("runs when it is hurt instead of trading blows it cannot win", () => {
    const scene = makeScene(60, 18, 77);
    for (let i = 0; i < 40; i++) advance(scene);
    scene.wanderers.length = 0;
    scene.hp = 1;
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    const at = steps.map(([dx, dy]) => ({ x: scene.x + dx, y: scene.y + dy })).find((p) => isFloor(scene, p.x, p.y));
    expect(at, "no floor next to the @ after 40 frames of digging").toBeDefined();
    const bully = { x: (at as { x: number; y: number }).x, y: (at as { x: number; y: number }).y, glyph: "p", hp: 99 };
    scene.wanderers.push(bully);
    advance(scene);
    /* Either it moved away, or it was hit and escaped. Both are "did not stand
     * there swinging", which is the behaviour under test; asserting one exact
     * square would be asserting the flee heuristic instead. */
    expect(bully.hp, "a frightened @ attacked anyway").toBe(99);
  });

  it("never dies, because there is no character to kill yet", () => {
    /* A tombstone on a loading screen would be a death notice for somebody who
     * has not been rolled. The `@` escapes at zero instead, and this is the
     * assertion that keeps that from quietly becoming a real death. */
    const scene = makeScene(70, 20, 5150);
    for (let i = 0; i < 1500; i++) {
      advance(scene);
      expect(scene.hp, `frame ${i}`).toBeGreaterThan(0);
      expect(isFloor(scene, scene.x, scene.y), `frame ${i}`).toBe(true);
    }
  });

  it("is chased: a wanderer that has noticed it closes the distance every step", () => {
    /* THIS TEST WAS WRONG FIRST TIME and the control is why it is written this
     * way. It used to run whole frames and wait for something to end up next to
     * the `@` - which passed with chasing disabled entirely, because the idle
     * shuffle produces an adjacency on its own within a boot. "Something touched
     * me eventually" is not evidence of pursuit.
     *
     * So: dig a while, find a straight open run of floor leading away from the
     * `@`, stand a monster at the far end of it, and hold everything else still.
     * A chaser walks the corridor and arrives on schedule; a drunkard does not. */
    const scene = makeScene(70, 20, 2024);
    for (let i = 0; i < 150; i++) advance(scene);
    scene.wanderers.length = 0;

    const RUN = 4;
    let start: { x: number; y: number } | null = null;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      let n = 0;
      while (n < RUN && isFloor(scene, scene.x + dx * (n + 1), scene.y + dy * (n + 1))) n++;
      if (n === RUN) {
        start = { x: scene.x + dx * RUN, y: scene.y + dy * RUN };
        break;
      }
    }
    expect(start, "no straight run of floor to stage a chase down").not.toBeNull();

    const hunter = { x: (start as { x: number; y: number }).x, y: (start as { x: number; y: number }).y, glyph: "k", hp: 99 };
    scene.wanderers.push(hunter);
    const distance = (): number => Math.max(Math.abs(hunter.x - scene.x), Math.abs(hunter.y - scene.y));
    expect(distance()).toBe(RUN);
    for (let step = RUN - 1; step >= 1; step--) {
      monsterTurn(scene);
      expect(distance(), `after ${RUN - step} step(s) of pursuit`).toBe(step);
    }
  });
});

describe("the caption", () => {
  it("cycles through every line rather than sitting on one", () => {
    const seen = new Set<string>();
    for (let f = 0; f < 40 * LOADING_CAPTIONS.length; f++) {
      seen.add(captionFor(f).replace(/\.+$/u, ""));
    }
    expect(seen.size).toBe(LOADING_CAPTIONS.length);
  });

  it("animates its ellipsis between one and three dots", () => {
    const dots = new Set<number>();
    for (let f = 0; f < 24; f++) dots.add((/\.+$/u.exec(captionFor(f))?.[0] ?? "").length);
    expect([...dots].sort()).toEqual([1, 2, 3]);
  });

  it("promises no percentage, because nothing here knows one", () => {
    for (const line of LOADING_CAPTIONS) {
      expect(line).not.toMatch(/%|\bloading\b.*\d/iu);
    }
  });
});

describe("painting", () => {
  it("draws the player, the caption and nothing off the grid", () => {
    const { term, cells, writes } = recorder(80, 24);
    const scene = makeScene(80, 22, 31337);
    for (let i = 0; i < 80; i++) advance(scene);
    paintScene(term, scene);
    for (const w of writes) {
      expect(w.y, JSON.stringify(w)).toBeLessThan(24);
      expect(w.x + w.text.length, JSON.stringify(w)).toBeLessThanOrEqual(80);
    }
    expect(cells[scene.y]?.[scene.x]).toBe("@");
    /* The caption for THIS frame, not the first one - by frame 80 the cycle has
     * moved on twice, and pinning line 0 would only pass while the scene was
     * young. */
    expect(cells[22]?.join("")).toContain(captionFor(scene.frame));
  });

  it("clears first, so a previous screen cannot show through the rock", () => {
    const rec = recorder(40, 12);
    paintScene(rec.term, makeScene(40, 10, 5));
    expect(rec.clears).toBe(1);
  });
});

describe("starting and stopping", () => {
  it("paints once immediately, then on every tick", () => {
    const rec = recorder(40, 12);
    const ticks: (() => void)[] = [];
    const stop = startLoading(rec.term, {
      seed: 11,
      setInterval: (fn, ms) => {
        expect(ms).toBe(LOADING_FRAME_MS);
        ticks.push(fn);
        return 1;
      },
      clearInterval: () => undefined,
    });
    expect(rec.clears).toBe(1); // the first frame is up before any timer fires
    expect(ticks).toHaveLength(1);
    ticks[0]?.();
    ticks[0]?.();
    expect(rec.clears).toBe(3);
    stop();
  });

  it("stops idempotently, because boot has more than one way out", () => {
    const rec = recorder(40, 12);
    let cleared = 0;
    const stop = startLoading(rec.term, {
      seed: 3,
      setInterval: () => 7,
      clearInterval: (h) => {
        expect(h).toBe(7);
        cleared++;
      },
    });
    stop();
    stop();
    stop();
    expect(cleared).toBe(1);
  });

  it("never touches the game's RNG", () => {
    /* This runs before a character exists. Drawing from the game's stream would
     * move a position a save re-derives the world from - the one class of change
     * docs/PARITY.md says is a defect rather than a refactor. */
    const text = readFileSync(new URL("./loading.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/state\.rng|randint0\(|randint1\(/u);
    expect(text).not.toMatch(/Math\.random/u);
  });
});
