import { describe, expect, it } from "vitest";
import { satisfies, SemverError } from "./semver.js";

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
