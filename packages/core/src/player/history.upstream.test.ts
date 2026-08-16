/**
 * Upstream unit tests from reference/src/tests/player/history.c
 *
 * Mapping: get_history -> generateHistory (player/birth.ts).
 * Builds the same three-chart fixture as the C setup_tests.
 */

import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { generateHistory } from "./birth.js";
import type { HistoryChart, HistoryEntry } from "./types.js";

function entry(
  roll: number,
  text: string,
  succ: HistoryChart | null,
): HistoryEntry {
  return { roll, isucc: succ?.idx ?? 0, succ, text };
}

describe("player/history (reference/src/tests/player/history.c)", () => {
  // upstream: test_0
  it("0", () => {
    const ca: HistoryChart = { idx: 1, entries: [] };
    const cb: HistoryChart = { idx: 2, entries: [] };
    const cc: HistoryChart = { idx: 3, entries: [] };

    ca.entries = [
      entry(50, "A0", cb),
      entry(100, "A1", cc),
    ];
    cb.entries = [
      entry(50, "B0", cc),
      entry(100, "B1", null),
    ];
    cc.entries = [
      entry(50, "C0", null),
      entry(100, "C1", null),
    ];

    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const h = generateHistory(ca, new Rng(i + 1));
      expect(h.length).toBeGreaterThanOrEqual(4);
      expect(h[0]).toBe("A");
      expect(h[1]).toMatch(/\d/);
      expect(h[2] === "B" || h[2] === "C").toBe(true);
      expect(h[3]).toMatch(/\d/);
      if (h[2] === "B" && h[4]) {
        expect(h[4]).toBe("C");
        expect(h[5]).toMatch(/\d/);
      }
      seen.add(h[2]!);
    }
    /* Not upstream, but upstream's assertions are vacuous if the walk only
     * ever takes one successor: both A0 -> cb and A1 -> cc must occur across
     * the (deterministic) seeds, or the chart is not being followed. */
    expect([...seen].sort()).toEqual(["B", "C"]);
  });
});
