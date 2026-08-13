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
  paintScene,
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
      expect(scene.x, `frame ${i}`).toBeGreaterThanOrEqual(0);
      expect(scene.y, `frame ${i}`).toBeLessThan(scene.rows);
      expect(scene.x, `frame ${i}`).toBeLessThan(scene.cols);
      expect(scene.y, `frame ${i}`).toBeGreaterThanOrEqual(0);
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
      seen.add(`${scene.x},${scene.y}`);
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
    const start = `${scene.x},${scene.y}`;
    for (let i = 0; i < 40; i++) advance(scene);
    expect(`${scene.x},${scene.y}`).not.toBe(start);
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
