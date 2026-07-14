/**
 * A small, dependency-free semver range matcher.
 *
 * This package bundles into a browser build, so it cannot pull in the
 * `semver` npm package; this file implements just enough of the range
 * grammar for pack manifests (MOD_LIFECYCLE.md section 3):
 *
 *  - `*` or `x` (any case): matches any version.
 *  - an exact version, `1.2.3`: matches only that version.
 *  - a partial version used bare, `1.2` or `1`: matches any version with
 *    that prefix (`1.2` matches `1.2.0`..`1.2.x`; `1` matches `1.0.0`..`1.x.x`).
 *  - caret ranges, `^1.2.3`: compatible-with, following npm's rule that the
 *    leftmost nonzero component may not change (`^1.2.3` allows up to but
 *    not including `2.0.0`; `^0.2.3` allows up to but not including `0.3.0`;
 *    `^0.0.3` allows only `0.0.3`).
 *  - tilde ranges, `~1.2.3`: patch-level allowed (up to but not including
 *    `1.3.0`); `~1.2` is the same; `~1` allows up to but not including `2.0.0`.
 *  - comparator sets: `>=`, `>`, `<=`, `<`, `=`, combined with spaces and
 *    ANDed together, e.g. `>=1.0.0 <2.0.0`.
 *
 * Limitation (documented, not fixed): prerelease tags (`1.0.0-beta.2`) are
 * compared naively as a single lexicographic string once the numeric
 * major.minor.patch triple is equal, rather than the full dot-separated,
 * numeric-vs-alphanumeric identifier comparison the semver spec defines.
 * A version with no prerelease is always treated as newer than one with a
 * prerelease at the same major.minor.patch, matching the spec; the ordering
 * among different prerelease strings themselves does not. Pack authors who
 * need exact prerelease ordering should not rely on it here.
 */

export class SemverError extends Error {}

interface FullVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

interface PartialVersion {
  major: number | null;
  minor: number | null;
  patch: number | null;
  prerelease: string | null;
}

const PARTIAL_RE =
  /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/;

function isWildcardToken(s: string): boolean {
  return s === "x" || s === "X" || s === "*";
}

/** Parse a (possibly partial, possibly wildcarded) version-shaped string. */
function parsePartial(s: string): PartialVersion {
  const match = PARTIAL_RE.exec(s);
  if (!match) {
    throw new SemverError(`malformed version: ${s}`);
  }
  const [, majorStr, minorStr, patchStr, prerelease] = match;
  const major =
    majorStr === undefined || isWildcardToken(majorStr) ? null : Number(majorStr);
  const minor =
    minorStr === undefined || isWildcardToken(minorStr) ? null : Number(minorStr);
  const patch =
    patchStr === undefined || isWildcardToken(patchStr) ? null : Number(patchStr);
  return { major, minor, patch, prerelease: prerelease ?? null };
}

/** Parse a full, exact version (all three components required); throws SemverError. */
function parseVersion(s: string): FullVersion {
  const p = parsePartial(s);
  if (p.major === null || p.minor === null || p.patch === null) {
    throw new SemverError(`expected a full major.minor.patch version, got: ${s}`);
  }
  return { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease };
}

/** -1 if a < b, 0 if equal, 1 if a > b. See the prerelease limitation above. */
function compareVersions(a: FullVersion, b: FullVersion): number {
  if (a.major !== b.major) return a.major - b.major < 0 ? -1 : 1;
  if (a.minor !== b.minor) return a.minor - b.minor < 0 ? -1 : 1;
  if (a.patch !== b.patch) return a.patch - b.patch < 0 ? -1 : 1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1; // no prerelease outranks any prerelease
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

type Checker = (v: FullVersion) => boolean;

/** Fill an absent minor/patch with 0, e.g. for comparator/caret/tilde bounds. */
function fullFromPartial(p: PartialVersion, major: number): FullVersion {
  return {
    major,
    minor: p.minor ?? 0,
    patch: p.patch ?? 0,
    prerelease: p.prerelease,
  };
}

function caretChecker(p: PartialVersion, major: number): Checker {
  const lower = fullFromPartial(p, major);
  let upper: FullVersion;
  if (major > 0) {
    upper = { major: major + 1, minor: 0, patch: 0, prerelease: null };
  } else if (lower.minor > 0) {
    upper = { major: 0, minor: lower.minor + 1, patch: 0, prerelease: null };
  } else {
    upper = { major: 0, minor: 0, patch: lower.patch + 1, prerelease: null };
  }
  return (v) => compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
}

function tildeChecker(p: PartialVersion, major: number): Checker {
  const lower = fullFromPartial(p, major);
  const upper: FullVersion =
    p.minor === null
      ? { major: major + 1, minor: 0, patch: 0, prerelease: null }
      : { major, minor: lower.minor + 1, patch: 0, prerelease: null };
  return (v) => compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
}

function comparatorChecker(op: string, p: PartialVersion, major: number): Checker {
  const bound = fullFromPartial(p, major);
  switch (op) {
    case ">=":
      return (v) => compareVersions(v, bound) >= 0;
    case ">":
      return (v) => compareVersions(v, bound) > 0;
    case "<=":
      return (v) => compareVersions(v, bound) <= 0;
    case "<":
      return (v) => compareVersions(v, bound) < 0;
    case "=":
      return (v) => compareVersions(v, bound) === 0;
    default:
      // Unreachable: parseToken only dispatches here with a known operator.
      throw new SemverError(`unknown comparator: ${op}`);
  }
}

/** A bare token with no operator: an exact version, or a wildcard prefix. */
function bareChecker(p: PartialVersion, major: number): Checker {
  if (p.minor === null) {
    const lower: FullVersion = { major, minor: 0, patch: 0, prerelease: null };
    const upper: FullVersion = { major: major + 1, minor: 0, patch: 0, prerelease: null };
    return (v) => compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
  }
  if (p.patch === null) {
    const lower: FullVersion = { major, minor: p.minor, patch: 0, prerelease: null };
    const upper: FullVersion = {
      major,
      minor: p.minor + 1,
      patch: 0,
      prerelease: null,
    };
    return (v) => compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
  }
  const exact: FullVersion = { major, minor: p.minor, patch: p.patch, prerelease: p.prerelease };
  return (v) => compareVersions(v, exact) === 0;
}

/** Parse one whitespace-delimited comparator token into a checker function. */
function parseToken(token: string): Checker {
  if (token === "*" || token.toLowerCase() === "x") {
    return () => true;
  }
  let op = "";
  let rest = token;
  if (rest.startsWith(">=")) {
    op = ">=";
    rest = rest.slice(2);
  } else if (rest.startsWith("<=")) {
    op = "<=";
    rest = rest.slice(2);
  } else if (rest.startsWith("^")) {
    op = "^";
    rest = rest.slice(1);
  } else if (rest.startsWith("~")) {
    op = "~";
    rest = rest.slice(1);
  } else if (rest.startsWith(">")) {
    op = ">";
    rest = rest.slice(1);
  } else if (rest.startsWith("<")) {
    op = "<";
    rest = rest.slice(1);
  } else if (rest.startsWith("=")) {
    op = "=";
    rest = rest.slice(1);
  }

  const partial = parsePartial(rest);
  if (partial.major === null) {
    // A wildcard major combined with an operator ("^x", ">=x") degrades to
    // "any version"; there is no meaningful bound to compute.
    return () => true;
  }
  switch (op) {
    case "^":
      return caretChecker(partial, partial.major);
    case "~":
      return tildeChecker(partial, partial.major);
    case ">=":
    case ">":
    case "<=":
    case "<":
    case "=":
      return comparatorChecker(op, partial, partial.major);
    default:
      return bareChecker(partial, partial.major);
  }
}

/**
 * Does `version` satisfy `range`? Throws SemverError if either string is
 * malformed (an unparseable version, or a range with an unparseable token).
 */
export function satisfies(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed.length === 0) {
    throw new SemverError("empty version range");
  }
  if (trimmed === "*" || trimmed.toLowerCase() === "x") {
    return true;
  }
  const v = parseVersion(version);
  const tokens = trimmed.split(/\s+/);
  return tokens.every((token) => parseToken(token)(v));
}
