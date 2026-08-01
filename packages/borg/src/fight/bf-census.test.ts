/**
 * Every BF_* attack method must be dispatched.
 *
 * This exists because 61 of them were not. The BF enum was transcribed complete
 * and correct from borg-fight-attack.h - all 171 ids, in the load-bearing C
 * order - and borg_attack walks BF_REST..BF_MAX by integer, so the Borg dutifully
 * asked about every artifact activation it owns. The switch had no case for any
 * of them, they fell to `default: return 0`, and 0 is indistinguishable from
 * "that activation is not available". Nothing failed. The suite stayed green, the
 * enum census (had one existed) would have passed, and the only visible symptom
 * was a helper with no callers that a lint rule eventually noticed.
 *
 * So the test is a SOURCE census rather than a behavioural one. A behavioural
 * test cannot see this: without a host activation resolver every one of these
 * branches legitimately returns 0, which is exactly what the bug returned.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BF } from "./bf.js";

const attackSrc = readFileSync(
  fileURLToPath(new URL("./attack.ts", import.meta.url)),
  "utf8",
);

/** The enum's member NAMES, not its numeric reverse-mapping entries. */
function bfNames(): string[] {
  return Object.keys(BF).filter((k) => !/^\d+$/u.test(k));
}

describe("the BF dispatch census", () => {
  it("finds the enum and the switch, so a broken scan cannot pass", () => {
    // Both halves of the comparison have to be non-trivial, or "every member is
    // handled" is satisfied by finding no members at all.
    expect(bfNames().length).toBe(171);
    expect(attackSrc).toMatch(/case BF\./u);
  });

  it("dispatches every BF_* attack method", () => {
    const cased = new Set(
      [...attackSrc.matchAll(/case BF\.(\w+):/gu)].map((m) => m[1]!),
    );
    const missing = bfNames().filter((n) => n !== "MAX" && !cased.has(n));
    expect(missing).toEqual([]);
  });

  it("still covers the 61 activations specifically", () => {
    // Named on its own because ACT_ is the family that was missing, and a future
    // regression is far likelier to drop the block than to drop one id.
    const actNames = bfNames().filter((n) => n.startsWith("ACT_"));
    expect(actNames).toHaveLength(61);
    for (const n of actNames) expect(attackSrc).toContain(`case BF.${n}:`);
  });
});
