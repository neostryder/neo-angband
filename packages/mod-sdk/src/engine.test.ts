import { describe, expect, it } from "vitest";
import { engineVerdict, newerGameCouldRun } from "./engine.js";

describe("engineVerdict: a pack that says nothing", () => {
  it("no engine range loads anywhere", () => {
    expect(engineVerdict({}, "0.10.0")).toEqual({ ok: true });
  });
});

describe("engineVerdict: a range this build satisfies", () => {
  it("an open lower bound the build clears", () => {
    expect(engineVerdict({ engine: ">=0.1.0" }, "0.10.0").ok).toBe(true);
  });

  it("a two-sided range the build sits inside", () => {
    expect(engineVerdict({ engine: ">=0.9.0 <0.11.0" }, "0.10.0").ok).toBe(true);
  });

  it("a caret range over the same minor", () => {
    expect(engineVerdict({ engine: "^0.10.0" }, "0.10.3").ok).toBe(true);
  });

  it("a wildcard", () => {
    expect(engineVerdict({ engine: "*" }, "0.10.0").ok).toBe(true);
  });
});

describe("engineVerdict: a range this build does not satisfy", () => {
  it("refuses a pack written for a newer game", () => {
    const v = engineVerdict({ engine: ">=0.20.0" }, "0.10.0");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.kind).toBe("out-of-range");
  });

  it("refuses a pack written for an older game", () => {
    const v = engineVerdict({ engine: "<0.5.0" }, "0.10.0");
    expect(v.ok === false && v.kind).toBe("out-of-range");
  });

  /* The exact shape two of the three first-party mods shipped: the ANGBAND baseline
   * written into a field that ranges over the PORT's version. It parses - "4.2.x" is
   * a perfectly good range - which is why nothing caught it by reading it, and why
   * only evaluating it could. */
  it("refuses the parity baseline written into an engine range", () => {
    const v = engineVerdict({ engine: "4.2.x" }, "0.10.0");
    expect(v.ok === false && v.kind).toBe("out-of-range");
  });

  it("names both versions, so the reader can see which way round it is", () => {
    const v = engineVerdict({ engine: ">=0.20.0" }, "0.10.0");
    expect(v.ok === false && v.why).toContain(">=0.20.0");
    expect(v.ok === false && v.why).toContain("0.10.0");
  });

  /* Named because the alternative is tempting and wrong: the gate cannot compute a
   * range's bounds, so a directional claim would be a guess, and it would be wrong
   * for exactly the mods that need a newer game. */
  it("claims nothing about WHICH side is behind", () => {
    const older = engineVerdict({ engine: "<0.5.0" }, "0.10.0");
    const newer = engineVerdict({ engine: ">=0.20.0" }, "0.10.0");
    for (const v of [older, newer]) {
      const why = v.ok === false ? v.why : "";
      expect(why).not.toMatch(/the mod needs (an )?updat/i);
      expect(why).not.toMatch(/the game needs (an )?updat/i);
    }
  });
});

describe("engineVerdict: a range that is not a range", () => {
  it("an empty string is an author error, not an absent field", () => {
    const v = engineVerdict({ engine: "" }, "0.10.0");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.kind).toBe("bad-manifest");
  });

  it("whitespace only is the same author error", () => {
    expect(engineVerdict({ engine: "   " }, "0.10.0").ok === false).toBe(true);
  });

  it("an unparseable token is an author error", () => {
    const v = engineVerdict({ engine: ">=banana" }, "0.10.0");
    expect(v.ok === false && v.kind).toBe("bad-manifest");
  });

  /* The two failures must not collapse into one message. A player reading
   * "one of them needs an update" about a typo would go looking for a mod update
   * that does not exist and never will. */
  it("a bad manifest is not reported as a version mismatch", () => {
    const bad = engineVerdict({ engine: "not a range" }, "0.10.0");
    const stale = engineVerdict({ engine: ">=0.20.0" }, "0.10.0");
    expect(bad.ok === false && bad.kind).not.toBe(stale.ok === false && stale.kind);
    expect(bad.ok === false && bad.why).toContain("manifest");
  });

  it("quotes the range it could not read, so the author can see it", () => {
    const v = engineVerdict({ engine: ">=banana" }, "0.10.0");
    expect(v.ok === false && v.why).toContain(">=banana");
  });
});

describe("newerGameCouldRun: whether updating the GAME is what would help", () => {
  /*
   * WHY THIS IS NOT PART OF THE VERDICT. `engineVerdict` refuses to say which side
   * is behind, and is right to: a range does not give that away in general. But a
   * screen that has decided to offer an OLDER version of a mod has to know whether
   * to point the player at the update screen or not, and pointing them there for a
   * mod that wants an older game sends them backwards. So the question is asked
   * separately, and answered by probing rather than by reasoning about a range the
   * matcher cannot decompose.
   */
  it("says yes for the ordinary case: a mod ahead of the game", () => {
    expect(newerGameCouldRun(">=0.23.0", "0.22.0")).toBe(true);
    expect(newerGameCouldRun("^1.0.0", "0.22.0")).toBe(true);
  });

  it("says yes when only a later PATCH satisfies it", () => {
    /* The near case the ladder exists for. A range pinned inside the current minor
     * is satisfied by a patch release, and answering "no" here would withhold the
     * one piece of advice that works. */
    expect(newerGameCouldRun(">=0.22.4 <0.23.0", "0.22.0")).toBe(true);
  });

  it("says no when the mod wants an OLDER game", () => {
    /* The case the wording must not get wrong. */
    expect(newerGameCouldRun("<0.5.0", "0.22.0")).toBe(false);
    expect(newerGameCouldRun(">=0.1.0 <0.2.0", "0.22.0")).toBe(false);
  });

  it("cannot tell, rather than saying no, when the range is unreadable", () => {
    /* A broken manifest is a different fact from a wrong game version, and the
     * caller says different words for each. */
    expect(newerGameCouldRun("not-a-range", "0.22.0")).toBeNull();
    expect(newerGameCouldRun(">=0.23.0", "not-a-version")).toBeNull();
  });

  it("is a bounded probe, and the bound is where it stops being able to answer", () => {
    /*
     * STATED RATHER THAN HIDDEN. The ladder tries the next nine patches, minors and
     * majors plus one far-future version, so a range that opens only beyond all of
     * those reads as "no". That is why a `false` must be worded as a fact about the
     * two versions and never as "this mod will never work" - and this test is the
     * record of exactly where the honesty runs out.
     */
    expect(newerGameCouldRun(">=0.22.15 <0.23.0", "0.22.0")).toBe(false);
  });
});
