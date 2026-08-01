import { describe, expect, it } from "vitest";
import { compareSemver, satisfies, SemverError } from "./semver.js";

describe("satisfies: wildcard", () => {
  it("* matches anything", () => {
    expect(satisfies("0.0.1", "*")).toBe(true);
    expect(satisfies("9.9.9", "*")).toBe(true);
  });

  it("x / X matches anything, case-insensitively", () => {
    expect(satisfies("1.2.3", "x")).toBe(true);
    expect(satisfies("1.2.3", "X")).toBe(true);
  });
});

describe("satisfies: exact and prefix", () => {
  it("exact x.y.z matches only that version", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "1.2.3")).toBe(false);
  });

  it("bare major.minor matches any patch", () => {
    expect(satisfies("1.2.0", "1.2")).toBe(true);
    expect(satisfies("1.2.9", "1.2")).toBe(true);
    expect(satisfies("1.3.0", "1.2")).toBe(false);
    expect(satisfies("1.1.9", "1.2")).toBe(false);
  });

  it("bare major matches any minor.patch", () => {
    expect(satisfies("1.0.0", "1")).toBe(true);
    expect(satisfies("1.9.9", "1")).toBe(true);
    expect(satisfies("2.0.0", "1")).toBe(false);
  });
});

describe("satisfies: caret ranges", () => {
  it("^1.2.3 allows same major, excludes next major", () => {
    expect(satisfies("1.2.3", "^1.2.3")).toBe(true);
    expect(satisfies("1.9.9", "^1.2.3")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
  });

  it("^0.2.3 only allows same minor when major is 0", () => {
    expect(satisfies("0.2.3", "^0.2.3")).toBe(true);
    expect(satisfies("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfies("0.2.2", "^0.2.3")).toBe(false);
  });

  it("^0.0.3 only allows that exact patch when major and minor are 0", () => {
    expect(satisfies("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfies("0.0.4", "^0.0.3")).toBe(false);
    expect(satisfies("0.0.2", "^0.0.3")).toBe(false);
  });
});

describe("satisfies: tilde ranges", () => {
  it("~1.2.3 allows patch-level changes only", () => {
    expect(satisfies("1.2.3", "~1.2.3")).toBe(true);
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "~1.2.3")).toBe(false);
  });

  it("~1.2 behaves the same as ~1.2.0", () => {
    expect(satisfies("1.2.5", "~1.2")).toBe(true);
    expect(satisfies("1.3.0", "~1.2")).toBe(false);
  });

  it("~1 allows any minor.patch within major 1", () => {
    expect(satisfies("1.9.9", "~1")).toBe(true);
    expect(satisfies("2.0.0", "~1")).toBe(false);
  });
});

describe("satisfies: comparator sets", () => {
  it("single comparators", () => {
    expect(satisfies("2.0.0", ">1.9.9")).toBe(true);
    expect(satisfies("2.0.0", ">2.0.0")).toBe(false);
    expect(satisfies("2.0.0", ">=2.0.0")).toBe(true);
    expect(satisfies("1.9.9", ">=2.0.0")).toBe(false);
    expect(satisfies("2.0.0", "<=2.0.0")).toBe(true);
    expect(satisfies("2.0.1", "<=2.0.0")).toBe(false);
    expect(satisfies("1.9.9", "<2.0.0")).toBe(true);
    expect(satisfies("2.0.0", "<2.0.0")).toBe(false);
    expect(satisfies("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "=1.2.3")).toBe(false);
  });

  it("AND-combined comparator sets", () => {
    expect(satisfies("1.5.0", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
    expect(satisfies("0.9.9", ">=1.0.0 <2.0.0")).toBe(false);
    expect(satisfies("1.4.0", ">=2.0.0")).toBe(false);
  });
});

describe("satisfies: malformed input", () => {
  it("throws SemverError for an unparseable version", () => {
    expect(() => satisfies("not-a-version", "^1.0.0")).toThrow(SemverError);
  });

  it("throws SemverError for an unparseable range token", () => {
    expect(() => satisfies("1.0.0", "^not-a-version")).toThrow(SemverError);
  });

  it("throws SemverError for an empty range", () => {
    expect(() => satisfies("1.0.0", "   ")).toThrow(SemverError);
  });
});

describe("satisfies: prerelease (documented, naive comparison)", () => {
  it("a release outranks a prerelease at the same major.minor.patch", () => {
    expect(satisfies("1.0.0", ">1.0.0-beta")).toBe(true);
    expect(satisfies("1.0.0-beta", ">=1.0.0")).toBe(false);
  });

  it("exact prerelease strings match", () => {
    expect(satisfies("1.0.0-beta.1", "1.0.0-beta.1")).toBe(true);
    expect(satisfies("1.0.0-beta.2", "1.0.0-beta.1")).toBe(false);
  });
});

describe("compareSemver", () => {
  /* Public because the catalogue asks a question `satisfies` cannot answer: not
   * "is this in range" but "which of these two is newer". The host had been
   * answering it with `!==`, which cannot tell an update from a rollback. */

  it("orders by component, so 0.9.0 is BELOW 0.10.0", () => {
    /* The pair that breaks a string compare, and the pair this port shipped. */
    expect(compareSemver("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareSemver("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });

  it("compares major, then minor, then patch", () => {
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0", "1.1.99")).toBeGreaterThan(0);
    expect(compareSemver("1.1.2", "1.1.10")).toBeLessThan(0);
  });

  it("reports equality as exactly 0", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("puts a release above a prerelease at the same triple", () => {
    /* The same rule satisfies() follows, from the one comparator - two orderings
     * that disagreed about this would be worse than none. */
    expect(compareSemver("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-beta", "1.0.0")).toBeLessThan(0);
  });

  it("returns null rather than throwing on anything that is not a full version", () => {
    /* Both sides are author-supplied strings from a catalogue. "These cannot be
     * ordered" is a real answer the caller has to render; a throw would push every
     * caller into a try/catch that means the same thing. */
    expect(compareSemver("1.0", "1.0.0")).toBeNull();
    expect(compareSemver("1.0.0", "latest")).toBeNull();
    expect(compareSemver("", "1.0.0")).toBeNull();
    expect(compareSemver("1.x", "1.0.0")).toBeNull();
  });
});
