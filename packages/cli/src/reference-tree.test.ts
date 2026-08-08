/**
 * `reference/` IS Angband 4.2.6, and this is the check that says so.
 *
 * Every parity claim in this repository is stated against 4.2.6 - the ledgers'
 * `baseline:` fields, DIVERGENCES.md, the text census, the directive guard, the
 * C-vs-TS statistical harness. All of them read `reference/`. None of them, until
 * this file, checked that `reference/` was 4.2.6.
 *
 * It was not. Measured 2026-08-07: the vendored tree sat at upstream master, 139
 * commits past the 4.2.6 tag, so core shipped 138 commits of post-tag work -
 * different room templates, a different vault.txt, a parser the release does not
 * have - while every document said 4.2.6. That is the failure this file exists to
 * make impossible: a baseline nobody can check is a baseline nobody is keeping.
 *
 * WHAT IT COMPARES. The tag's tree, file by file, against `reference/`, by blob
 * hash - so a one-character edit inside a vendored file is caught, which is how
 * the two-hand description edit hid in `lib/gamedata/object.txt` for weeks
 * looking like upstream's own text.
 *
 * WHAT IS DELIBERATELY ABSENT, and why absence needs a list. `reference/` is not
 * a plain checkout: it drops upstream's CI and repo plumbing, which describe how
 * to build a C program this repository does not build. Every such path is named
 * in EXCLUDED below, and the test requires each entry to MATCH SOMETHING - a
 * stale exclusion is a hole you cannot see, so an entry that stops matching is a
 * failure and not a shrug.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** The official upstream release this port reproduces. */
const BASELINE_VERSION = "4.2.6";

/**
 * ...pinned by COMMIT, not by tag name. Two reasons, and both were learned here:
 *
 *  - the tag is not in this clone. #220 deleted the ~1,442 upstream tags this
 *    history carries, so `git rev-parse 4.2.6` fails while `reference/` sits
 *    happily on that tree. A check keyed on a name that does not resolve is a
 *    check that cannot run.
 *  - a tag is a movable ref and a SHA is not.
 *
 * The name is then EARNED rather than asserted: the version test below reads
 * configure.ac out of this very commit and requires it to say 4.2.6, so "this
 * SHA is 4.2.6" is measured from upstream's own tree.
 */
const BASELINE_COMMIT = "f3082213b73f3e463e3d0d60bff4b00462beae6e";

/**
 * Paths under the tag's root that `reference/` does not carry, each with the
 * reason. Prefixes end with "/"; anything else is an exact path.
 *
 * These are upstream's own repository plumbing: how ANGBAND's CI builds a C
 * program, and what its checkout ignores. Nothing here is game behaviour, game
 * data, documentation of the game, or C the port reads, which is the line.
 */
const EXCLUDED: readonly { path: string; why: string }[] = [
  {
    path: ".github/",
    why: "upstream's own GitHub Actions, which build and release the C game. This repository has its own workflows and never runs these.",
  },
  {
    path: ".gitignore",
    why: "an ignore file for a C build tree (object files, autotools output). Vendored under reference/ it would apply to this repository's checkout.",
  },
  {
    path: ".readthedocs.yaml",
    why: "publishes upstream's docs to readthedocs.org under upstream's account.",
  },
  {
    path: ".travis.yml",
    why: "a Travis CI config for the C build, dead upstream too.",
  },
];

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"),
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
}

/** Non-empty, trimmed lines of a git command's output. */
function splitLines(out: string): string[] {
  return out.split(/\r?\n/u).map((l) => l.trimEnd()).filter(Boolean);
}

/** `path -> blob sha`, for every file in a tree. */
function treeBlobs(rev: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of git("ls-tree", "-r", rev).trim().split("\n")) {
    /* "<mode> blob <sha>\t<path>" */
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const sha = line.slice(0, tab).split(/\s+/u)[2];
    if (sha) out.set(line.slice(tab + 1), sha);
  }
  return out;
}

/**
 * `path -> blob sha` for reference/ AS IT IS NOW, read from the INDEX rather
 * than from HEAD.
 *
 * HEAD would be the wrong source and the mistake is easy to make: a working
 * tree that has just been re-vendored, and not yet committed, gets compared
 * against the PREVIOUS commit's reference/ - so the check passes on a tree
 * nobody is going to ship, or fails on one that is already right. The index
 * tracks the edit; the test above asserts the working tree matches the index,
 * so between them nothing is invisible.
 */
function indexBlobs(prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of splitLines(git("ls-files", "-s", "--", prefix))) {
    /* "<mode> <sha> <stage>\t<path>" */
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const sha = line.slice(0, tab).split(/\s+/u)[1];
    const filePath = line.slice(tab + 1);
    if (sha && filePath.startsWith(`${prefix}/`)) {
      out.set(filePath.slice(prefix.length + 1), sha);
    }
  }
  return out;
}

const isExcluded = (p: string): boolean =>
  EXCLUDED.some((e) => (e.path.endsWith("/") ? p.startsWith(e.path) : p === e.path));

describe(`reference/ is upstream ${BASELINE_VERSION}`, () => {
  it("is the commit upstream itself calls 4.2.6", () => {
    /* A missing commit must FAIL, not skip: a skip would quietly retire every
     * assertion below, and this whole file exists because a claim nobody
     * checked stayed wrong for weeks. */
    expect(
      git("cat-file", "-t", BASELINE_COMMIT).trim(),
      `${BASELINE_COMMIT} is not a commit in this clone`,
    ).toBe("commit");
    /* And it is 4.2.6 because upstream's own configure.ac says so at this
     * commit - not because a constant in this file is named that. */
    expect(
      git("show", `${BASELINE_COMMIT}:configure.ac`),
      `configure.ac at ${BASELINE_COMMIT} does not declare ${BASELINE_VERSION}`,
    ).toContain(`AC_INIT([Angband],[${BASELINE_VERSION}]`);
  });

  const tag = treeBlobs(BASELINE_COMMIT);
  const ref = indexBlobs("reference");

  it("has no unstaged edit hiding under it", () => {
    /* The comparison below reads the INDEX. An edit in the working tree that
     * has not been staged would be invisible to it, which is exactly the state
     * a hand-edit of a vendored file arrives in. */
    expect(
      splitLines(git("diff", "--name-only", "--", "reference")),
      "reference/ differs between the working tree and the index",
    ).toEqual([]);
  });

  it("carries every file of the tag except the excluded plumbing", () => {
    const missing = [...tag.keys()].filter((p) => !isExcluded(p) && !ref.has(p));
    expect(
      missing,
      `${missing.length} file(s) of ${BASELINE_VERSION} are absent from reference/ ` +
        `and not listed in EXCLUDED. Vendor them, or add the path with the reason ` +
        `it does not belong here.`,
    ).toEqual([]);
  });

  it("carries nothing the tag does not", () => {
    const extra = [...ref.keys()].filter((p) => !tag.has(p));
    expect(
      extra,
      `${extra.length} file(s) under reference/ are not in ${BASELINE_VERSION}. ` +
        `reference/ is a verbatim vendor of the tag; anything of ours belongs ` +
        `outside it.`,
    ).toEqual([]);
  });

  it("is byte-identical to the tag, file for file", () => {
    /* Blob hashes, so this catches an edit inside a vendored file. The two-hand
     * description change lived in lib/gamedata/object.txt and read as upstream's
     * own text; the content pack is compiled from that directory, so it shipped
     * in the game. Nothing short of comparing contents finds that. */
    const edited = [...ref.entries()]
      .filter(([p, sha]) => tag.has(p) && tag.get(p) !== sha)
      .map(([p]) => p);
    expect(
      edited,
      `${edited.length} vendored file(s) differ from ${BASELINE_VERSION}: ` +
        `${edited.join(", ")}. reference/ is upstream's tree, not ours - a fix ` +
        `belongs in the bug-fixes mod, and a change to gamedata here silently ` +
        `changes the compiled content pack.`,
    ).toEqual([]);
  });

  it("has no stale exclusion", () => {
    const unused = EXCLUDED.filter((e) => ![...tag.keys()].some((p) => isExcluded(p) && (e.path.endsWith("/") ? p.startsWith(e.path) : p === e.path)));
    expect(
      unused.map((e) => e.path),
      `these EXCLUDED entries match nothing in ${BASELINE_VERSION}, so they are ` +
        `hiding nothing and would silently cover a future path of the same name`,
    ).toEqual([]);
  });
});
