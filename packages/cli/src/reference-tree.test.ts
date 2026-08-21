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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The repository root, as a path git and node both accept on Windows. */
const ROOT = new URL("../../../", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/u,
  "$1",
);

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
  {
    path: "src/win/dll/",
    why: "prebuilt third-party Windows DLLs (libpng12, zlib1) that only upstream's MSVC build links. libpng 1.2.x is long EOL with a substantial CVE history; nothing in this repository builds, loads or reads them, and a public repo should not carry unowned binaries a scanner will rightly flag. The C that would link them (src/Makefile.nmake, the vs2019 project, PNG_Detection.cmake) is still vendored and still says so.",
  },
  {
    path: "src/win/lib/",
    why: "the import libraries for the same two DLLs, absent for the same reason.",
  },
];

/**
 * Vendored tile files the game does NOT serve at runtime, each with the reason.
 *
 * "Not served" has to be earned the same way "not vendored" is. A tile file the
 * game silently fails to ship is a tileset that renders wrong for a player, and
 * the whole point of the check below is that nobody has to remember.
 */
const NOT_SERVED: readonly { what: string; why: string; match: (p: string) => boolean }[] = [
  {
    what: "Makefile",
    why: "upstream's per-tileset build glue, run only by its C build to install the tiles. Nothing here builds a C program.",
    match: (p) => p.endsWith("Makefile"),
  },
  {
    what: "list.txt",
    why: "the graphics-mode catalogue, and it IS read - but at BUILD time. packages/core/scripts/gen-grafmode.mjs parses reference/lib/tiles/list.txt into grafmode-data.ts, so the modes are compiled in and the game never fetches the file. Serving a second copy would be a second thing to keep in step with the generated table.",
    match: (p) => p === "list.txt",
  },
];

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
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
      `${BASELINE_COMMIT} is not a commit in this clone. A SHALLOW clone does ` +
        `not have it - actions/checkout is shallow by default, and this is ` +
        `precisely how the check first failed. Fetch the one object rather than ` +
        `the whole history (this repo descends from Angband's):\n` +
        `    git fetch --no-tags --depth=1 origin ${BASELINE_COMMIT}`,
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
        `reference/ is a verbatim vendor of the tag; anything of this project's belongs ` +
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
        `${edited.join(", ")}. reference/ is upstream's tree, not this project's - a fix ` +
        `belongs in the bug-fixes mod, and a change to gamedata here silently ` +
        `changes the compiled content pack.`,
    ).toEqual([]);
  });

  /**
   * The tiles the GAME serves are upstream's tiles, byte for byte.
   *
   * `packages/web/public/tiles/` is a second copy of `reference/lib/tiles/`,
   * because Vite serves `public/` and cannot reach outside the package. A second
   * copy is a second thing to keep right, and it was not right: the five
   * `graf-*.prf` files were upstream MASTER's while every PNG beside them was
   * 4.2.6's, so the game shipped post-tag tile assignments (Beorn's bear form,
   * the Knight's Shield, Sip of Miruvor, Draught of the Ents, and eight
   * previously-unused Adam Bolt tiles) under a 4.2.6 banner. Nothing noticed,
   * because nothing compared the two copies.
   *
   * Post-tag tile assignments are not forbidden - they are simply not CORE.
   * They belong to the bug-fixes mod, which is where they now live.
   */
  it("serves the vendored tiles, byte for byte", () => {
    /* This RUNS sync-tiles.mjs rather than inspecting what it produced last
     * time. The distinction matters and it nearly went wrong here: the served
     * tree is no longer committed, so a check that read the git index would
     * have found one file (CREDITS.md), filtered it out, compared an empty set
     * and passed forever. --check reports every difference and exits non-zero,
     * so execFileSync throws with the generator's own message attached. */
    expect(() =>
      execFileSync(
        process.execPath,
        ["packages/web/scripts/sync-tiles.mjs", "--check"],
        { cwd: ROOT, encoding: "utf8", stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("regenerates the served tiles on every build, so they cannot go stale", () => {
    /* The generator is only a guarantee if the build actually calls it. Without
     * this, someone drops the prefix from one script and the served tree
     * silently freezes at whatever was on disk. */
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "packages", "web", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const missing = ["build", "dev", "bundle"].filter(
      (s) => !pkg.scripts[s]?.includes("sync-tiles.mjs"),
    );
    expect(
      missing,
      `packages/web script(s) ${missing.join(", ")} no longer run ` +
        `sync-tiles.mjs. The served tiles are generated, not committed - a ` +
        `build that skips the sync serves whatever happens to be on disk.`,
    ).toEqual([]);
  });

  it("serves every vendored tile, so no tileset goes missing", () => {
    const wanted = [...ref.keys()]
      .filter((p) => p.startsWith("lib/tiles/"))
      .map((p) => p.slice("lib/tiles/".length))
      .filter((p) => !NOT_SERVED.some((e) => e.match(p)));
    const absent = wanted.filter(
      (p) => !existsSync(join(ROOT, "packages", "web", "public", "tiles", p)),
    );
    expect(
      absent,
      `${absent.length} vendored tile file(s) are not served by the game: ` +
        `${absent.join(", ")}. Every upstream tileset ships with Neo Angband, ` +
        `so either the generator should copy it or it belongs in NOT_SERVED ` +
        `with the reason the game does not need it at runtime.`,
    ).toEqual([]);
  });

  it("has no stale NOT_SERVED entry", () => {
    /* Same rule as EXCLUDED: an entry that matches nothing is hiding nothing
     * today and would silently cover a future file of the same shape. */
    const vendored = [...ref.keys()]
      .filter((p) => p.startsWith("lib/tiles/"))
      .map((p) => p.slice("lib/tiles/".length));
    const unused = NOT_SERVED.filter((e) => !vendored.some((p) => e.match(p)));
    expect(
      unused.map((e) => e.what),
      `these NOT_SERVED entries match no vendored tile file`,
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
