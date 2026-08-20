#!/usr/bin/env node
/**
 * Build the next public commits and (optionally) push them.
 *
 * WHY THIS EXISTS AT ALL. The public repository and this one do not share a
 * history. `origin/master` starts at `ea5d5b3e4`, a squash of the curated tree
 * on top of upstream Angband, and this repository's own thousand-plus commits
 * have never been pushed and are not meant to be. So `git push origin master`
 * is rejected as a non-fast-forward, and the obvious next move - `--force` - is
 * the one that publishes everything the squash was made to curate. The rejection
 * is a safety net, not a nuisance, and this script exists so that nobody has to
 * be standing next to it deciding what to type.
 *
 * WHAT CHANGED ON 2026-08-20. Publishing used to be one squashed commit per
 * release: `git commit-tree master^{tree} -p origin/master`. From now on the
 * public history takes ONE COMMIT PER LOCAL COMMIT, so a reader of the public
 * repository sees the same changes in the same steps with the same messages -
 * an ordinary git history - while the pre-squash development history still never
 * travels.
 *
 * HOW IT WORKS, and why it is not `cherry-pick`. Every local commit after the
 * last published one is replayed with `git commit-tree`, taking that commit's
 * TREE verbatim and parenting it on the public tip built so far. Nothing is
 * checked out, nothing is merged, and no patch is ever applied - so there is no
 * conflict to resolve and the published tree at every step is byte for byte the
 * tree this repository had at that commit. A cherry-pick would have to touch the
 * working tree and could conflict; this cannot.
 *
 * THE ANCHOR is found by TREE, not by message or date: the newest local commit
 * whose tree equals `origin/master`'s tree is the one already published, and
 * everything after it is what has not been. If no local commit has that tree,
 * the two sides have drifted apart in some way this script must not guess at,
 * and it refuses.
 *
 * Usage:
 *   node tools/publish.mjs           # show what would be published, build nothing
 *   node tools/publish.mjs --build   # build the commits, print the tip, push nothing
 *   node tools/publish.mjs --push    # build and push to origin master
 *
 * Never `git push --tags` or `--follow-tags` from this repository: it carries
 * ~1,442 inherited upstream tags. Tag a release explicitly, by name, as
 * docs/RELEASING.md says.
 */

import { execFileSync } from "node:child_process";

const NAME = "neostryder";
const EMAIL = "61663569+neostryder@users.noreply.github.com";

function git(args, opts = {}) {
  /* `stdio: "inherit"` makes execFileSync return null rather than the output,
   * which is fine for the calls made for their effect - but it has to be said
   * here, or the first one takes `.trim()` of null. */
  const out = execFileSync("git", args, { encoding: "utf8", ...opts });
  return out === null ? "" : out.trim();
}

function fail(message) {
  process.stderr.write(`publish: ${message}\n`);
  process.exit(1);
}

const mode = process.argv.includes("--push")
  ? "push"
  : process.argv.includes("--build")
    ? "build"
    : "dry";

/* A dirty tree means the local commits are not the whole story, and the tree
 * being published would not be the tree anybody tested. */
if (git(["status", "--porcelain"]) !== "") {
  fail("working tree is dirty - commit or stash before publishing");
}

git(["fetch", "origin", "master"], { stdio: "inherit" });

const publicTip = git(["rev-parse", "origin/master"]);
const publicTree = git(["rev-parse", `${publicTip}^{tree}`]);

/* The newest local commit already published, identified by its tree. */
const localLine = git(["rev-list", "--max-count=400", "master"]).split("\n");
const anchor = localLine.find((sha) => git(["rev-parse", `${sha}^{tree}`]) === publicTree);
if (!anchor) {
  fail(
    `no local commit has origin/master's tree (${publicTree.slice(0, 9)}).\n` +
      `  The public tip may have been built from a tree this branch never had, or\n` +
      `  the last publish did not come from here. Resolve it by hand - do NOT force.`,
  );
}

/* Oldest first: each becomes a commit parented on the one before it. */
const pending = git(["rev-list", "--reverse", `${anchor}..master`]).split("\n").filter(Boolean);

if (pending.length === 0) {
  process.stdout.write(`publish: nothing to publish - origin/master is at ${anchor.slice(0, 9)}\n`);
  process.exit(0);
}

process.stdout.write(
  `publish: origin/master ${publicTip.slice(0, 9)} == local ${anchor.slice(0, 9)}\n` +
    `publish: ${pending.length} commit(s) to publish:\n`,
);
for (const sha of pending) {
  process.stdout.write(`  ${sha.slice(0, 9)}  ${git(["log", "-1", "--format=%s", sha])}\n`);
}

if (mode === "dry") {
  process.stdout.write("publish: dry run - pass --build to build them, --push to push.\n");
  process.exit(0);
}

let parent = publicTip;
for (const sha of pending) {
  const tree = git(["rev-parse", `${sha}^{tree}`]);
  const message = git(["log", "-1", "--format=%B", sha]);
  /* commit-tree does not read `-c user.name`; the identity has to be in the
   * environment. The author DATE is carried over so the public history keeps
   * the order and spacing the work actually had. */
  const authored = git(["log", "-1", "--format=%aI", sha]);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: NAME,
    GIT_AUTHOR_EMAIL: EMAIL,
    GIT_COMMITTER_NAME: NAME,
    GIT_COMMITTER_EMAIL: EMAIL,
    GIT_AUTHOR_DATE: authored,
  };
  parent = git(["commit-tree", tree, "-p", parent, "-m", message], { env });
  /* Verify each step rather than the last one only: a wrong tree anywhere in
   * the stack publishes the wrong content, and it is free to check. */
  if (git(["rev-parse", `${parent}^{tree}`]) !== tree) {
    fail(`built commit ${parent.slice(0, 9)} does not carry ${sha.slice(0, 9)}'s tree`);
  }
}

if (git(["rev-parse", `${parent}^{tree}`]) !== git(["rev-parse", "master^{tree}"])) {
  fail("the built tip's tree does not match master's - refusing to push");
}

process.stdout.write(`publish: built ${parent.slice(0, 9)}, tree matches master\n`);

if (mode === "build") {
  process.stdout.write(`publish: push it with\n  git push origin ${parent}:refs/heads/master\n`);
  process.exit(0);
}

git(["push", "origin", `${parent}:refs/heads/master`], { stdio: "inherit" });
process.stdout.write(`publish: pushed ${parent.slice(0, 9)} to origin/master\n`);
