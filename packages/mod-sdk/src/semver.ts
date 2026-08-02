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
 * Prerelease tags (`1.0.0-beta.2`) are ordered by the spec's rule: split on
 * dots, compare identifier by identifier, numeric identifiers numerically and
 * ranking below alphanumeric ones, and a longer identifier list wins a tie
 * against its own prefix. A version with no prerelease outranks any prerelease
 * of the same major.minor.patch.
 *
 * THIS USED TO BE A DOCUMENTED LIMITATION - one lexicographic string compare -
 * and the note said pack authors needing exact prerelease ordering should not
 * rely on it. That was honest while nothing did. Then the updater's `early`
 * channel started naming builds `0.16.1-edge.7`, and a string compare puts
 * `edge.9` ABOVE `edge.10`: the tenth build of the day would not be offered to
 * anyone running the ninth, and the game would sit there reporting itself up to
 * date. A documented limitation stops being documentation the moment something
 * depends on it, so it is implemented rather than described.
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

const NUMERIC_ID = /^\d+$/u;

/**
 * Order two prerelease tags by semver's rule (spec item 11.4).
 *
 * Identifier by identifier: two numeric identifiers compare as numbers, two
 * alphanumeric ones compare as ASCII, and a numeric identifier always ranks
 * BELOW an alphanumeric one. Running out of identifiers first loses, so
 * `1.0.0-alpha` precedes `1.0.0-alpha.1`.
 */
function comparePrerelease(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i];
    const r = right[i];
    /* One side ran out: the shorter list is the lower precedence. */
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNum = NUMERIC_ID.test(l);
    const rNum = NUMERIC_ID.test(r);
    /* Numeric identifiers always have lower precedence than alphanumeric ones,
     * which is why this cannot be a string compare with a numeric special case:
     * `beta` outranks `2`, and "2" < "beta" in ASCII only by luck of the table. */
    if (lNum !== rNum) return lNum ? -1 : 1;
    if (lNum && rNum) {
      /* Number(), not localeCompare: `edge.9` vs `edge.10` is the case that
       * made this function exist, and it is the one a string compare gets
       * backwards. Leading zeroes are not legal semver, so parsing is safe. */
      return Number(l) < Number(r) ? -1 : 1;
    }
    return l < r ? -1 : 1;
  }
  return 0;
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
function compareVersions(a: FullVersion, b: FullVersion): number {
  if (a.major !== b.major) return a.major - b.major < 0 ? -1 : 1;
  if (a.minor !== b.minor) return a.minor - b.minor < 0 ? -1 : 1;
  if (a.patch !== b.patch) return a.patch - b.patch < 0 ? -1 : 1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1; // no prerelease outranks any prerelease
  if (b.prerelease === null) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Order two version strings: negative if `a` is older, 0 if equal, positive if
 * `a` is newer. `null` when either side is not a full `major.minor.patch`.
 *
 * WHY THIS IS PUBLIC AND WHY IT RETURNS NULL. `satisfies` answers "does this
 * version fall in that range", which is the question a manifest asks. It is not
 * the question a CATALOGUE asks - "is the version on offer newer than the one
 * installed" - and the host had been answering that with `!==`, which cannot tell
 * an update from a downgrade. Nothing else in the port could order two versions,
 * so the alternative to exporting this was a second comparator somewhere that
 * would disagree with this one about prereleases.
 *
 * Null rather than a throw because the inputs are author-supplied strings from a
 * catalogue, not something this build controls: a tag that is not a version is a
 * real case and the honest answer is "these cannot be ordered", which the caller
 * has to render differently anyway. A throw would push every caller into a
 * try/catch that ends up meaning the same thing.
 */
export function compareSemver(a: string, b: string): number | null {
  let left: FullVersion;
  let right: FullVersion;
  try {
    left = parseVersion(a);
    right = parseVersion(b);
  } catch {
    return null;
  }
  return compareVersions(left, right);
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
