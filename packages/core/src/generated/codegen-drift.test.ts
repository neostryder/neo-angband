/**
 * The registry proof: every entry in all 31 `reference/src/list-*.h` headers is
 * still present, in upstream order, in the committed `generated/` modules.
 *
 * `lists.test.ts` next door pins counts and spot entries by hand, which covers
 * about a third of the headers and cannot notice an entry appearing or vanishing
 * in one it does not name. This runs the real codegen in `--check` mode instead,
 * so all 1174 entries -- every effect, monster spell, projection, message type,
 * timed effect, terrain, tval, option and flag the game dispatches on -- are
 * compared against the oracle on every test run.
 *
 * A failure here means one of two things, and the message says which line
 * differs so you can tell them apart:
 *   - `generated/` was hand-edited (it says "Do not edit" for this reason), or
 *   - the reference moved and the committed modules are stale.
 * Either way the fix is to re-run the codegen and review the diff, never to
 * relax this test.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("generated list modules vs reference/src/list-*.h", () => {
  it("has not drifted from the upstream headers", () => {
    let out: string;
    try {
      out = execFileSync(
        process.execPath,
        [join(packageRoot, "scripts", "codegen-lists.mjs"), "--check"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      expect.fail(
        `codegen drift check failed:\n${e.stderr ?? ""}${e.stdout ?? ""}`,
      );
    }
    /* Guard the guard: a codegen that silently found no headers would also
     * print no drift, so require the entry count it actually compared. */
    expect(out).toMatch(/matches reference\/src\/list-\*\.h/);
    const counts = /\((\d+) headers, (\d+) entries\)/.exec(out);
    expect(counts, `unexpected --check output: ${out}`).not.toBeNull();
    expect(Number(counts![1])).toBe(31);
    expect(Number(counts![2])).toBeGreaterThanOrEqual(1174);
  }, 60_000);
});
