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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("private-scan over the tracked tree", () => {
  it("is clean", () => {
    const { code, out } = run();
    expect(out).toContain("clean");
    expect(code, out).toBe(0);
  });
});

describe("private-scan actually bites", () => {
  /* The terms are assembled from pieces so that this test file does not itself
   * contain the strings it is testing for - otherwise the whole-tree run above
   * would fail on this very file, and exempting it by path would leave a hole
   * exactly where the gate is verified. */
  const NAME = ["Aa", "ron"].join("");
  const SURNAME = ["West", "over"].join("");
  const EMPLOYER = ["G", "CE"].join("");
  const CODENAME = ["Stew", "ard"].join("");
  const WIZARD = ["Gan", "dalf"].join("");
  const PRIVATE_DIR = ["_neo-angband", "-private"].join("");
  const HOME = ["C:/Us", "ers/someone/x"].join("");

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
    const hook = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(require('fs').readFileSync('.githooks/pre-commit','utf8'))"],
      { encoding: "utf8", cwd: fileURLToPath(new URL("../../../", import.meta.url)) },
    ).stdout;
    expect(hook).toContain("tools/private-scan.mjs");
    expect(hook, "the hook must judge the staged blobs, not the working tree").toContain(
      "--staged",
    );
  });
});
