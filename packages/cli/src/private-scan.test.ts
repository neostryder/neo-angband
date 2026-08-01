/**
 * The private-information gate (tools/private-scan.mjs), tested in BOTH
 * directions.
 *
 * This repository is public, and a handful of things must never appear in it.
 * A pre-commit hook enforces that (.githooks/pre-commit), but a hook is a
 * courtesy, not a control: it has to be enabled per clone and `--no-verify`
 * walks straight past it. This test is the control - it runs in CI, over the
 * whole tracked tree, on every push.
 *
 * The "clean tree" assertion alone would be worthless. A scanner broken to
 * always pass would satisfy it, which is the failure mode every gate in this
 * project has been bitten by. So the detector is also made to FAIL on planted
 * fixtures, once per rule tier plus both directions of the baseline. A gate
 * nobody has watched fail is not known to work.
 *
 * The scanner is deliberately dependency-free plain .mjs so the git hook can run
 * it with bare node, before any build. That is why this spawns it rather than
 * importing it.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SCANNER = fileURLToPath(new URL("../../../tools/private-scan.mjs", import.meta.url));
const BASELINE = fileURLToPath(
  new URL("../../../tools/private-scan-baseline.json", import.meta.url),
);

const scratch = mkdtempSync(join(tmpdir(), "private-scan-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(...args: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [SCANNER, ...args], { encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A fixture file whose content the scanner is meant to object to. */
function plant(name: string, body: string): string {
  const p = join(scratch, name);
  writeFileSync(p, body, "utf8");
  return p;
}

/* The terms are assembled from pieces so that this test file does not itself
 * contain the strings it is testing for - otherwise the whole-tree run below
 * would fail on this very file, and exempting it by path would leave a hole
 * exactly where the gate is verified. */
const NAME = ["Aa", "ron"].join("");
const SURNAME = ["West", "over"].join("");
const EMPLOYER = ["G", "CE"].join("");
const CODENAME = ["Stew", "ard"].join("");
const WIZARD = ["Gan", "dalf"].join("");
const PRIVATE_DIR = ["_neo-angband", "-private"].join("");
const HOME = ["C:/Us", "ers/someone/x"].join("");

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HOOK = readFileSync(join(REPO_ROOT, ".githooks", "pre-commit"), "utf8");
/**
 * The hook with its comments removed. Asserting against the whole file is a trap
 * that caught this test once already: the comment block explains what `--root`
 * is for, so `HOOK.includes("--root")` stayed true after the flag was deleted
 * from the command. Prose is not behaviour.
 */
const HOOK_CODE = HOOK.split("\n")
  .filter((l) => !/^\s*#/u.test(l))
  .join("\n");

describe("private-scan over the tracked tree", () => {
  /* 30s, and not because the scan is slow to think. It spawns a Node process
   * that reads every tracked file in the repository - 1301 of them - and under
   * the full suite's parallel load that ran past vitest's 5s default and failed
   * on how busy the machine was rather than on anything in the tree. A privacy
   * gate that goes red at random is a gate people learn to re-run instead of
   * read, which is the opposite of what this one is for. */
  it("is clean", () => {
    const { code, out } = run();
    expect(out).toContain("clean");
    expect(code, out).toBe(0);
  }, 30_000);
});

describe("private-scan actually bites", () => {
  it.each([
    ["legal-name (first)", `// reported by ${NAME} today`],
    ["legal-name (surname)", `// see the ${SURNAME} note`],
    ["work-email", `// mail: a${NAME.toLowerCase().slice(1)}@${EMPLOYER.toLowerCase()}.com`],
    ["employer", `// an internal ${EMPLOYER} decision`],
    ["codename", `// tracked in ${CODENAME}`],
    ["private-workspace", `// see C:/Repositories/${PRIVATE_DIR}/NOTES.md`],
  ])("rejects %s", (_label, body) => {
    const { code, out } = run("--files", plant("bad.ts", body));
    expect(code, out).toBe(1);
    expect(out).toContain("PUBLIC");
  });

  it("rejects an absolute path naming a user account", () => {
    const { code, out } = run("--files", plant("path.ts", `const p = "${HOME}";`));
    expect(code, out).toBe(1);
    expect(out).toContain("user-home-path");
  });

  it("accepts an ordinary line", () => {
    const { code, out } = run("--files", plant("ok.ts", "export const answer = 42;\n"));
    expect(code, out).toBe(0);
  });

  it("flags a baselined term in a file the baseline does not cover", () => {
    /* The point of the baselined tier: this term is legitimate in Angband's own
     * data and a codename anywhere else, so a NEW file using it must be looked
     * at rather than waved through. */
    const { code, out } = run("--files", plant("new.ts", `const n = "${WIZARD}";`));
    expect(code, out).toBe(1);
    expect(out).toContain("unlisted");
  });

  it("flags a baseline entry that no longer matches - the other direction", () => {
    /* An allowlist that only fails one way keeps passing long after the thing it
     * excused is gone, and then excuses whatever moves into the same file. This
     * proves the stale check fires: a baseline pointing at a path with no such
     * term must be an error, not silence. */
    const doctored = join(scratch, "baseline.json");
    writeFileSync(
      doctored,
      JSON.stringify({
        entries: [
          {
            rule: `codename-${WIZARD.toLowerCase()}`,
            path: "packages/cli/src/index.ts",
            count: 3,
            why: "deliberately wrong, for this test",
          },
        ],
      }),
      "utf8",
    );
    const { code, out } = run("--baseline", doctored);
    expect(code, out).toBe(1);
    expect(out).toContain("stale");
  });

  it("the real baseline explains every entry", () => {
    /* A bare allowlist teaches nobody why the exception is legitimate, and the
     * next reader either deletes a good entry or copies a bad one. */
    const baseline = JSON.parse(
      spawnSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(BASELINE)},'utf8'))`], {
        encoding: "utf8",
      }).stdout,
    ) as { entries: { rule: string; path: string; count: number; why?: string }[] };
    expect(baseline.entries.length).toBeGreaterThan(0);
    for (const e of baseline.entries) {
      expect(e.why, `${e.rule} ${e.path} has no why`).toBeTruthy();
      expect((e.why ?? "").length, `${e.rule} ${e.path}'s why is too short to be a reason`).toBeGreaterThan(30);
      expect(e.count).toBeGreaterThan(0);
    }
  });
});

describe("the pre-commit hook is wired to the scanner", () => {
  it("runs the same scan the tree is judged by", () => {
    expect(HOOK_CODE).toContain("tools/private-scan.mjs");
    expect(HOOK_CODE, "the hook must judge the staged blobs, not the working tree").toContain(
      "--staged",
    );
  });
});

/**
 * --root, which is how the companion mod repositories are gated.
 *
 * Those repositories are public too, they are small enough to have no build of
 * their own, and a vendored copy of the scanner in each would be three rule
 * lists drifting apart. So one scanner reads several trees. The thing that can
 * go wrong is specific and silent: if --root were ignored, every mod repository
 * would be reported clean forever, because the scan would be re-reading THIS
 * repository, which is clean. So the tests below check that a leak planted in
 * another tree is actually found there.
 */
describe("private-scan gates another repository via --root", () => {
  /** A throwaway git repo with `files` in it, staged so `ls-files` sees them. */
  function fixtureRepo(name: string, files: Record<string, string>): string {
    const root = join(scratch, name);
    mkdirSync(root, { recursive: true });
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body, "utf8");
    // No commit: `git ls-files` reads the index, so `add` is enough - and this
    // avoids needing a user.name/user.email in the test environment.
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["add", "-A"], { cwd: root });
    return root;
  }

  it("finds a leak in the other tree, at that tree's path", () => {
    const root = fixtureRepo("mod-leaky", {
      "README.md": `# A mod\n\nMaintained by ${NAME}.\n`,
    });
    const { code, out } = run("--root", root);
    expect(code, out).toBe(1);
    expect(out).toContain("README.md:3");
    /* If --root were quietly ignored this run would have scanned THIS repo and
     * said "clean (NNNN tracked files)". Naming the root is what tells the two
     * apart in a CI log. */
    expect(out).toContain(root);
  });

  it("passes a clean tree, and reports the count for THAT tree", () => {
    const root = fixtureRepo("mod-clean", { "README.md": "# A mod\n" });
    const { code, out } = run("--root", root);
    expect(code, out).toBe(0);
    expect(out).toContain("clean (1 tracked files");
  });

  it("refuses a --root that is not a directory instead of falling back", () => {
    /* The dangerous handling of a mis-wired root is to scan this repository
     * instead: the run would pass, having read a tree nobody asked about. */
    const { code, out } = run("--root", join(scratch, "no-such-tree"));
    expect(code, out).toBe(2);
    expect(out).not.toContain("clean");
  });

  it("keeps each tree's baseline separate", () => {
    /* A term legitimate here (Angband's own default character name, recorded in
     * this repo's baseline) is NOT accounted for in a mod repo that has no
     * baseline, and must be looked at rather than inherited. */
    const root = fixtureRepo("mod-baselined", { "data.txt": `name:${WIZARD}\n` });
    const { code, out } = run("--root", root);
    expect(code, out).toBe(1);
    expect(out).toContain("unlisted");
    /* And the baseline must have been read from the OTHER tree, where there is
     * none. Loading this repository's baseline while scanning that tree would
     * report every entry here as stale, since none of those paths exist there -
     * exit 1 either way, so only the absence of "stale" tells them apart. */
    expect(out, "the baseline must come from the scanned root, not from here").not.toContain(
      "stale",
    );
  });

  it("the hook locates the scanner relative to ITSELF, not to the repo being committed to", () => {
    /* This is the whole mechanism by which a mod clone needs no files: it sets
     * core.hooksPath to this repo's .githooks. If the hook resolved the scanner
     * from `git rev-parse --show-toplevel` it would look inside the MOD repo,
     * find nothing, and (before the fail-closed branch) pass every commit. */
    expect(HOOK_CODE).toContain("dirname");
    expect(HOOK_CODE, "the tree being committed to must be passed, not assumed").toMatch(
      /--root "\$\(git rev-parse --show-toplevel\)"/u,
    );
    expect(
      HOOK_CODE,
      "the SCANNER must not be resolved from the repo being committed to",
    ).not.toMatch(/SCANNER=.*rev-parse/u);
    expect(HOOK_CODE, "a hook that cannot find its scanner must fail, not exit 0").toMatch(
      /if \[ ! -f "\$SCANNER" \]/u,
    );
  });

  it("the composite action runs this scanner, and fails closed if it cannot find it", () => {
    /* CI in a mod repo reaches the scanner through .github/actions/private-scan.
     * A missing scanner there must be a red step, not a green tick for a check
     * that never ran. */
    const action = readFileSync(
      fileURLToPath(new URL("../../../.github/actions/private-scan/action.yml", import.meta.url)),
      "utf8",
    );
    expect(action).toContain("tools/private-scan.mjs");
    expect(action).toContain("--root");
    expect(action, "a missing scanner must fail the step").toMatch(/exit 1/u);
  });
});
