/**
 * The project version, wherever it is written down.
 *
 * Fourteen files state it and three of them were enforced. The other eleven were
 * maintained by remembering, and they did not stay in sync - CHANGELOG.md said
 * `0.10.0` while every manifest said `0.11.0`, and core's README printed a stale
 * example output. Nothing broke, which is why nobody found it: a version in prose
 * has no build to fail, so the only person it reaches is the one reading the
 * documentation to learn what is true.
 *
 * tools/version.mjs owns the list of sites. These tests own the two claims that
 * make the list worth having: that no site disagrees today, and that the list is
 * still COMPLETE - a scan that quietly stopped finding packages would report the
 * same clean green as one that found them all and they all agreed.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain .mjs tooling, no types; see tools/version.mjs
import { increment, projectVersion, siteValue, successors, versionDrift, versionSites } from "../../../tools/version.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Site {
  readonly file: string;
  readonly what: string;
  readonly pattern: RegExp;
}

const sites = versionSites() as Site[];

describe("every place the version is written down agrees", () => {
  it("has no drift", () => {
    const drift = versionDrift() as { file: string; what: string; actual: string | null; why: string }[];
    expect(
      drift.map((d) => `${d.file} (${d.what}): ${d.actual ?? "<no match>"} - ${d.why}`),
      `run \`node tools/version.mjs set ${projectVersion()}\` to bring them back into line`,
    ).toEqual([]);
  });

  it("still matches the pattern for every site, so none is silently unmaintained", () => {
    /* A pattern that stops matching reads as agreement: the tool writes nothing,
     * nothing fails, and the file drifts from then on. Name the sites that broke
     * rather than counting them. */
    const unmatched = sites.filter((s) => siteValue(s) === null).map((s) => `${s.file} - ${s.what}`);
    expect(unmatched).toEqual([]);
  });
});

describe("the list of sites is complete", () => {
  it("covers every package manifest that exists on disk", () => {
    /* Discovered rather than listed, so this asserts the DISCOVERY works. If the
     * scan broke, the tool would check thirteen sites, find them consistent, and
     * report green while a new package drifted from day one. */
    const onDisk = readdirSync(join(repoRoot, "packages"))
      .filter((d) => existsSync(join(repoRoot, "packages", d, "package.json")))
      .map((d) => `packages/${d}/package.json`)
      .sort();
    const covered = sites.map((s) => s.file).filter((f) => f.startsWith("packages/") && f.endsWith("package.json")).sort();
    expect(covered).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(1);
  });

  it("covers the workspace root and the engine constant", () => {
    const files = sites.map((s) => s.file);
    expect(files).toContain("package.json");
    expect(files).toContain("packages/core/src/version.ts");
  });

  it("names a file that exists for every site", () => {
    const missing = sites.filter((s) => !existsSync(join(repoRoot, s.file))).map((s) => s.file);
    expect(missing).toEqual([]);
  });

  it("gives every site a pattern that matches one place, or says it matches all of them", () => {
    /* The failure this catches is not a pattern that stopped matching - the test
     * above covers that - but one that matches SEVERAL places while the tool
     * rewrites only the first. A non-global replacement is silent about the rest,
     * so the site drifts from the second occurrence onward while everything
     * reports green.
     *
     * It has happened. CHANGELOG.md's "Current state of the project at version
     * `X`" began as one greeting at the top of the file, then moved down into
     * each release's own section, where it is history rather than a claim about
     * today. Releases after 1.1.2 stopped writing one, so the pattern matched
     * 1.1.2's line, and every bump from 1.2.0 forward rewrote it until that
     * section announced itself as version 1.9.0 - a sentence about a release
     * from 2026-08-27 restated wrongly eight times, in the public repository,
     * by the tool whose whole job is to keep the version honest.
     *
     * A site with genuinely many occurrences is fine and both runbook tag sites
     * are exactly that; it just has to be GLOBAL, so the tool writes all of them
     * rather than one. */
    const ambiguous = sites
      .filter((s) => !s.pattern.flags.includes("g"))
      .map((s) => {
        const source = readFileSync(join(repoRoot, s.file), "utf8");
        const hits = [...source.matchAll(new RegExp(s.pattern.source, `${s.pattern.flags}g`))].length;
        return { site: `${s.file} - ${s.what}`, hits };
      })
      .filter((r) => r.hits > 1)
      .map((r) => `${r.site} matches ${String(r.hits)} places but is rewritten once`);
    expect(ambiguous).toEqual([]);
  });
});

describe("a version is derived, not picked", () => {
  it("offers exactly the three semver successors", () => {
    expect(successors("0.11.0")).toEqual({ patch: "0.11.1", minor: "0.12.0", major: "1.0.0" });
    expect(successors("0.9.0")).toEqual({ patch: "0.9.1", minor: "0.10.0", major: "1.0.0" });
  });

  it("recognises each increment", () => {
    expect(increment("0.11.0", "0.11.1")).toBe("patch");
    expect(increment("0.11.0", "0.12.0")).toBe("minor");
    expect(increment("0.11.0", "1.0.0")).toBe("major");
  });

  it("refuses a number that is not one of them", () => {
    /* The willy-nilly cases, all of which have happened to somebody: a skipped
     * minor, a version that goes backwards, and a fourth component. */
    expect(increment("0.11.0", "0.13.0")).toBeNull();
    expect(increment("0.11.0", "0.10.0")).toBeNull();
    expect(increment("0.11.0", "0.11.0")).toBeNull();
    expect(() => successors("0.11")).toThrow(/not a semver version/u);
    expect(() => successors("v0.11.0")).toThrow(/not a semver version/u);
  });

});

describe("the release runbook quotes the version this repository is at", () => {
  it("does not tell a reader to tag a version that has already shipped", () => {
    /* docs/RELEASING.md is read at the one moment a mistake is irreversible - npm
     * refuses an unpublish after 72 hours and never lets a version number be
     * reused - so a stale example tag in it is worse than a stale one anywhere
     * else. It is prose, so nothing else checks it. */
    const runbook = readFileSync(join(repoRoot, "docs", "RELEASING.md"), "utf8");
    const tags = [...runbook.matchAll(/git tag v(\d+\.\d+\.\d+)/gu)].map((m) => m[1]);
    expect(tags.length).toBeGreaterThan(0);
    expect([...new Set(tags)]).toEqual([projectVersion()]);
  });
});
