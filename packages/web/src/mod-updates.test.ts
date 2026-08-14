/**
 * The one rule two screens must not disagree about: what counts as an update.
 *
 * This file used to be three times as long, because mod-updates.ts used to hold the
 * update CHECK as well - a comparison against a catalogue compiled into the build,
 * which could never offer anything newer than the game itself. That check and its
 * screen are gone; the answer now comes from each mod's own repository
 * (mod-refresh.ts, mod-browse.ts). What survives is the classifier, because a row
 * saying "update" and a bulk "update all" have to reach the same verdict.
 */

import { describe, expect, it } from "vitest";
import { classifyModPin, classifyModTag, type ModPinStanding, type ModTagStanding } from "./mod-updates";

describe("where an installed tag stands against the one on offer", () => {
  const cases: [string | null, string, ModTagStanding][] = [
    [null, "v0.13.0", "absent"],
    ["v0.13.0", "v0.13.0", "same"],
    ["v0.12.0", "v0.13.0", "behind"],
    ["v0.13.0", "v0.14.0", "behind"],
    /* The one that used to roll a player backwards: a mod author on their own
     * newer tag, offered an older one with the word "update". */
    ["v0.14.0", "v0.13.0", "ahead"],
    ["v1.0.0", "v0.13.0", "ahead"],
    /* Prerelease ordering is the comparator's job, not this module's, but the
     * answer has to be right for an edge build of a mod. */
    ["v0.13.0-beta.1", "v0.13.0", "behind"],
    ["v0.13.0", "v0.13.0-beta.1", "ahead"],
    /* A tag need not be a version. */
    ["nightly", "v0.13.0", "unorderable"],
    ["v0.13.0", "shiny", "unorderable"],
  ];
  for (const [installed, offered, expected] of cases) {
    it(`${installed ?? "(not installed)"} vs ${offered} is ${expected}`, () => {
      expect(classifyModTag(installed, offered)).toBe(expected);
    });
  }

  it("never calls anything but 'behind' an update", () => {
    /* The property the table above is FOR, stated once so a future case added to
     * the table cannot quietly introduce a fourth thing that means "offer it". */
    const offerable = cases.filter(([i, o]) => classifyModTag(i, o) === "behind");
    for (const [installed, offered] of offerable) {
      expect(installed).not.toBeNull();
      expect((compare(installed as string, offered) ?? 0) < 0).toBe(true);
    }
  });
});

describe("where an installed SHA stands against the one a tag resolves to now", () => {
  const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const cases: [string | null | undefined, string | null | undefined, ModPinStanding][] = [
    [A, A, "confirmed"],
    /* THE CASE THIS FUNCTION EXISTS FOR: the same tag, a different commit. */
    [A, B, "moved"],
    /* Missing on either side is UNKNOWN, never "moved" and never "confirmed" - a
     * gap in what was recorded is not evidence either way. */
    [undefined, B, "unknown"],
    [A, null, "unknown"],
    [undefined, undefined, "unknown"],
    [null, null, "unknown"],
  ];
  for (const [recorded, current, expected] of cases) {
    it(`${String(recorded)} recorded vs ${String(current)} now is ${expected}`, () => {
      expect(classifyModPin(recorded, current)).toBe(expected);
    });
  }

  it("never calls two DIFFERENT known SHAs anything but 'moved'", () => {
    /* The property the table is for: 'confirmed' only when they are the SAME known
     * value, so a table entry that quietly introduced a third way to reach
     * 'confirmed' would be caught here rather than by inspection. */
    const known = cases.filter(([r, c]) => r != null && c != null);
    for (const [recorded, current, expected] of known) {
      expect(expected).toBe(recorded === current ? "confirmed" : "moved");
    }
  });
});

/** The comparator, reached the long way so this assertion is not the code under it. */
function compare(a: string, b: string): number | null {
  const strip = (t: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-.*)?$/u.exec(t);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), t.includes("-") ? 0 : 1] : null;
  };
  const x = strip(a);
  const y = strip(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) {
    if ((x[i] as number) !== (y[i] as number)) return (x[i] as number) - (y[i] as number);
  }
  return 0;
}
