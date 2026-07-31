import { describe, expect, it } from "vitest";
import { engineVerdict } from "./engine.js";

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
