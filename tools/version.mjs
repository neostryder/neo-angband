#!/usr/bin/env node
/**
 * One version, and every place that writes it down.
 *
 * The project version is stated in fourteen files. Three of them were enforced -
 * the publishable manifests against the git tag, in the release workflow - and the
 * rest were maintained by remembering. They did not stay in sync: CHANGELOG.md
 * greeted every reader with "Current state of the project at version `0.10.0`"
 * while every manifest said 0.11.0, and core's README printed an ENGINE_VERSION
 * example output that was a release behind.
 *
 * None of those break a build, which is the problem. A version that only appears
 * in prose has no test, so it drifts silently and the person it misleads is the
 * one reading the documentation to find out what is true.
 *
 * THE SOURCE OF TRUTH IS `ENGINE_VERSION` in packages/core/src/version.ts, because
 * it is the only copy with behaviour attached: a mod manifest's `engine` range is
 * resolved against it, so a wrong value there refuses to load a mod or admits one
 * it should not. Every other site is a copy, and this file is the list of them.
 *
 * The package manifests are DISCOVERED by scanning packages/, not listed, so a new
 * package is covered the day it is created rather than the day someone remembers.
 *
 * Usage:
 *   node tools/version.mjs              # print every site; exit 1 on drift
 *   node tools/version.mjs set 0.12.0   # rewrite every site
 *   node tools/version.mjs set minor    # ...or name the increment
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The one site that is read rather than written; everything else copies it. */
const SOURCE = "packages/core/src/version.ts";

/**
 * Every place the project version is written down.
 *
 * A pattern has three groups: what comes before the version, the version, and what
 * comes after. Writing uses the same pattern that reads, so a site cannot be
 * updated by a rule that no longer describes the file - a replace that matches
 * nothing is a thrown error here, not a silent no-op.
 */
export function versionSites() {
  const manifestPattern = /("version":\s*")([^"]+)(")/u;
  const sites = [
    { file: SOURCE, what: "ENGINE_VERSION", pattern: /(ENGINE_VERSION = ")([^"]+)(")/u },
    { file: "package.json", what: "the workspace root manifest", pattern: manifestPattern },
  ];

  /* Discovered, not listed. packages/ is the set of things that carry a version;
   * enumerating them here would make "we forgot to add the new package" a thing
   * that can happen, and it is exactly the class of miss this tool exists for. */
  for (const dir of readdirSync(join(repoRoot, "packages")).sort()) {
    if (!existsSync(join(repoRoot, "packages", dir, "package.json"))) continue;
    sites.push({
      file: `packages/${dir}/package.json`,
      what: `the ${dir} manifest`,
      pattern: manifestPattern,
    });
  }

  sites.push(
    {
      file: "packages/linoleum/src/version.ts",
      what: "LINOLEUM_TOOLS_VERSION",
      pattern: /(LINOLEUM_TOOLS_VERSION = ")([^"]+)(")/u,
    },
    {
      file: "packages/core/README.md",
      what: "the ENGINE_VERSION example output",
      pattern: /(console\.log\(ENGINE_VERSION, PARITY_BASELINE\); \/\/ )(\d+\.\d+\.\d+)( )/u,
    },
    {
      file: "CHANGELOG.md",
      what: "the Unreleased summary",
      pattern: /(Current state of the project at version `)([^`]+)(`)/u,
    },
    /* version-sync.test.ts already REQUIRED the runbook's example tag to equal
     * the project version, but nothing maintained it - so every bump broke CI
     * until somebody remembered to hand-edit the runbook. A check whose subject
     * the tool does not own is a chore wearing a test's clothes.
     *
     * TWO sites, not one, because the example is `git tag vX && git push origin
     * master vX` and the replacement rewrites a single capture group. Covering
     * only the first would leave the push half naming the previous version -
     * which is worse than not covering it at all, since the line would then be
     * self-contradicting while the test went green. */
    {
      file: "docs/RELEASING.md",
      what: "the example tag in the runbook",
      pattern: /(git tag v)(\d+\.\d+\.\d+)( &&)/u,
    },
    {
      file: "docs/RELEASING.md",
      what: "the example push in the runbook",
      pattern: /(git push origin master v)(\d+\.\d+\.\d+)/u,
    },
  );
  return sites;
}

function read(rel) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/** What a site currently says, or null when its pattern no longer matches. */
export function siteValue(site, text = read(site.file)) {
  const match = site.pattern.exec(text);
  return match === null ? null : match[2];
}

/** The version this repository is at. */
export function projectVersion() {
  const value = siteValue({ file: SOURCE, pattern: versionSites()[0].pattern });
  if (value === null) throw new Error(`${SOURCE} no longer declares ENGINE_VERSION`);
  return value;
}

/**
 * Every site that disagrees with the source, or whose pattern stopped matching.
 *
 * A site that stopped matching is reported as loudly as one that disagrees. Both
 * mean the same thing - this tool is no longer maintaining that file - and the
 * quiet one is worse, because it looks like agreement.
 */
export function versionDrift() {
  const expected = projectVersion();
  const drift = [];
  for (const site of versionSites()) {
    const actual = siteValue(site);
    if (actual === null) drift.push({ ...site, actual: null, expected, why: "pattern matched nothing" });
    else if (actual !== expected) drift.push({ ...site, actual, expected, why: "says a different version" });
  }
  return drift;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/u;

function parse(version) {
  const m = SEMVER.exec(version);
  if (m === null) throw new Error(`not a semver version: ${version}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * The three versions that may legally follow this one, by semver increment.
 *
 * This is what stops a version being picked rather than derived. Any other number
 * is refused: a skipped patch, a typo, a second digit that went backwards.
 */
export function successors(version) {
  const [major, minor, patch] = parse(version);
  return {
    patch: `${major}.${minor}.${patch + 1}`,
    minor: `${major}.${minor + 1}.0`,
    major: `${major + 1}.0.0`,
  };
}

/**
 * Which increment turns `from` into `to`, or null if none does.
 *
 * On 0.x the MINOR number carries breaking changes, which is semver's own rule for
 * an unstable line and the reason this project can rename an engine export in a
 * 0.x MINOR. It also means `major` here would be `1.0.0`, which is reserved for
 * the game's public release - `set` refuses it without --release for that reason
 * and not because the arithmetic is different.
 */
export function increment(from, to) {
  const next = successors(from);
  for (const [name, value] of Object.entries(next)) if (value === to) return name;
  return null;
}

function usage(message) {
  console.error(`[version] ${message}`);
  console.error("");
  console.error("  node tools/version.mjs              print every site, fail on drift");
  console.error("  node tools/version.mjs set <version|patch|minor|major>");
  console.error("  node tools/version.mjs edge <n>     stamp an edge build (CI only)");
  console.error("");
  process.exit(2);
}

/** Write `target` to all fourteen sites, refusing a pattern that matches nothing. */
function writeEverywhere(target) {
  for (const site of versionSites()) {
    const text = read(site.file);
    if (site.pattern.exec(text) === null) {
      throw new Error(
        `${site.file}: the pattern for ${site.what} matched nothing, so the edit ` +
          `would have silently done nothing. Fix the pattern in tools/version.mjs.`,
      );
    }
    writeFileSync(
      join(repoRoot, site.file),
      text.replace(site.pattern, (_all, before, _old, after) => `${before}${target}${after}`),
    );
  }
}

/**
 * Stamp a throwaway version for an `early` channel build: `0.16.1-edge.42`.
 *
 * A SEPARATE VERB, not a looser `set`. `set` refuses anything that is not one of
 * the three legal successors, and that guard is the reason a release cannot be
 * a typo - weakening it so CI could pass a prerelease string would trade a real
 * protection for the convenience of one caller. Nothing here is ever committed:
 * the workflow stamps, builds, and throws the working tree away.
 *
 * The PATCH is bumped before the suffix is attached, because a prerelease sorts
 * BELOW its own triple. `0.16.0-edge.1` would be older than the 0.16.0 the
 * player already has, so the update would never be offered; `0.16.1-edge.1` is
 * above 0.16.0 and below both 0.16.1 and 0.17.0, which is exactly what an
 * unreleased build off master is.
 */
function edge(nRaw) {
  if (!/^\d+$/u.test(nRaw)) usage(`edge needs a build number, got: ${nRaw}`);
  const current = projectVersion();
  const target = `${successors(current).patch}-edge.${nRaw}`;
  writeEverywhere(target);
  console.log(`[version] ${current} -> ${target} across ${versionSites().length} sites`);
  /* The workflow reads this line to learn the tag it should create. */
  console.log(`::edge-version::${target}`);
}

function set(requested, { release }) {
  const current = projectVersion();
  const next = successors(current);
  const target = requested in next ? next[requested] : requested;

  const kind = increment(current, target);
  if (kind === null) {
    usage(
      `${current} -> ${target} is not a semver increment.\n` +
        `        The only versions that may follow ${current} are:\n` +
        `          patch  ${next.patch}\n` +
        `          minor  ${next.minor}\n` +
        `          major  ${next.major}`,
    );
  }
  if (kind === "major" && !release) {
    usage(
      `${target} is the public release, and it is reserved for the game shipping.\n` +
        `        0.x is the pre-release line: a feature release takes a MINOR bump\n` +
        `        (${next.minor}). Pass --release if this really is 1.0.0.`,
    );
  }

  writeEverywhere(target);
  console.log(`[version] ${current} -> ${target} (${kind}) across ${versionSites().length} sites`);
  /* NEVER --tags or --follow-tags here. This history descends from Angband's,
   * so ~1,442 upstream tags are genuine ancestors of master and either flag
   * pushes all of them. The tag goes by NAME, alongside the branch. */
  console.log(
    `[version] next: update CHANGELOG.md, then \`git tag v${target} && git push origin master v${target}\``,
  );
  console.log("[version] never `git push --tags` here - it would push ~1,442 inherited upstream tags");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("version.mjs")) {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const positional = args.filter((a) => !a.startsWith("--"));

  if (positional[0] === "set") {
    if (positional[1] === undefined) usage("set needs a version or an increment name");
    set(positional[1], { release: flags.includes("--release") });
  } else if (positional[0] === "edge") {
    if (positional[1] === undefined) usage("edge needs a build number");
    edge(positional[1]);
  } else if (positional.length > 0) {
    usage(`unknown command: ${positional[0]}`);
  } else {
    const expected = projectVersion();
    const drift = versionDrift();
    for (const site of versionSites()) {
      const actual = siteValue(site);
      const mark = actual === expected ? "  " : "!!";
      console.log(`${mark} ${(actual ?? "<no match>").padEnd(12)} ${site.file} - ${site.what}`);
    }
    if (drift.length > 0) {
      console.error(`\n[version] ${drift.length} site(s) disagree with ${SOURCE} (${expected})`);
      process.exit(1);
    }
    console.log(`\n[version] ${versionSites().length} sites agree on ${expected}`);
  }
}
