import { describe, expect, it } from "vitest";
import { createKeyRepeatTracker, MIN_HUMAN_KEYPRESS_INTERVAL_MS, type ClassifiableKeydown } from "./key-repeat";

function keydown(key: string, timeStamp: number, repeat = false): ClassifiableKeydown {
  return { key, repeat, timeStamp };
}

describe("createKeyRepeatTracker", () => {
  it("reports no verdict before the first keydown", () => {
    expect(createKeyRepeatTracker().last()).toBeNull();
  });

  it("treats a lone fresh keydown as not a repeat", () => {
    const tracker = createKeyRepeatTracker();
    const verdict = tracker.classify(keydown("j", 1000));
    expect(verdict.isRepeat).toBe(false);
    expect(verdict.reportedRepeat).toBe(false);
    expect(verdict.intervalMs).toBeNull();
  });

  it("treats a browser-flagged repeat as a repeat regardless of timing", () => {
    const tracker = createKeyRepeatTracker();
    tracker.classify(keydown("j", 1000));
    // Comfortably slower than MIN_HUMAN_KEYPRESS_INTERVAL_MS - only the flag should matter here.
    const verdict = tracker.classify(keydown("j", 1000 + MIN_HUMAN_KEYPRESS_INTERVAL_MS + 500, true));
    expect(verdict.isRepeat).toBe(true);
    expect(verdict.reportedRepeat).toBe(true);
  });

  it("treats a same-key keydown arriving faster than a human can react as a repeat, even when unflagged", () => {
    // #35's real-world case: a browser or test harness that fails to set `repeat`
    // on a genuine auto-repeat event still gets caught by the interval alone.
    const tracker = createKeyRepeatTracker();
    tracker.classify(keydown("j", 1000));
    const verdict = tracker.classify(keydown("j", 1000 + MIN_HUMAN_KEYPRESS_INTERVAL_MS - 1, false));
    expect(verdict.isRepeat).toBe(true);
    expect(verdict.reportedRepeat).toBe(false);
    expect(verdict.intervalMs).toBe(MIN_HUMAN_KEYPRESS_INTERVAL_MS - 1);
  });

  it("does not treat a same-key keydown at a human pace as a repeat", () => {
    const tracker = createKeyRepeatTracker();
    tracker.classify(keydown("j", 1000));
    const verdict = tracker.classify(keydown("j", 1000 + MIN_HUMAN_KEYPRESS_INTERVAL_MS + 200, false));
    expect(verdict.isRepeat).toBe(false);
    expect(verdict.reportedRepeat).toBe(false);
    expect(verdict.intervalMs).toBe(MIN_HUMAN_KEYPRESS_INTERVAL_MS + 200);
  });

  it("does not treat two DIFFERENT keys pressed in quick succession as a repeat of either", () => {
    // Rapid diagonal-style input (e.g. two direction keys) must never read as
    // one key's own auto-repeat.
    const tracker = createKeyRepeatTracker();
    tracker.classify(keydown("h", 1000));
    const verdict = tracker.classify(keydown("j", 1001));
    expect(verdict.isRepeat).toBe(false);
    expect(verdict.intervalMs).toBeNull();
  });

  it("restarts the interval baseline once a different key interrupts the sequence", () => {
    const tracker = createKeyRepeatTracker();
    tracker.classify(keydown("j", 1000));
    tracker.classify(keydown("k", 1001)); // interrupts - a fresh key, not a repeat of j
    // Same absolute gap from the ORIGINAL "j" press, but the last keydown was "k".
    const verdict = tracker.classify(keydown("j", 1002));
    expect(verdict.intervalMs).toBeNull();
    expect(verdict.isRepeat).toBe(false);
  });

  it("computes ageMs from the supplied 'now', for a caller measuring processing lag", () => {
    const tracker = createKeyRepeatTracker();
    const verdict = tracker.classify(keydown("j", 1000), 1350);
    expect(verdict.ageMs).toBe(350);
  });

  it("does not let staleness alone flip isRepeat (a legitimately delayed single press is still a press)", () => {
    const tracker = createKeyRepeatTracker();
    const verdict = tracker.classify(keydown("j", 1000), 5000);
    expect(verdict.ageMs).toBe(4000);
    expect(verdict.isRepeat).toBe(false);
  });

  it("remembers the most recent verdict via last()", () => {
    const tracker = createKeyRepeatTracker();
    expect(tracker.last()).toBeNull();
    const first = tracker.classify(keydown("j", 1000));
    expect(tracker.last()).toEqual(first);
    const second = tracker.classify(keydown("j", 1000 + MIN_HUMAN_KEYPRESS_INTERVAL_MS + 200));
    expect(tracker.last()).toEqual(second);
    expect(tracker.last()).not.toEqual(first);
  });
});
