/**
 * The two copies of the plugin ABI check must agree.
 *
 * There are two on purpose. `validateModPlugin` (packages/web/src/mod-plugin.ts)
 * is what the HOST runs on a plugin a player downloaded; `pluginProblem`
 * (packages/mod-sdk/bin/neo-angband-mod-build.mjs) is what the BUILDER runs on a
 * plugin an author just compiled. The builder cannot import the host's copy - it
 * is a plain script the SDK ships, and the host's module lives in the web front
 * end, so importing it would tie building a mod to whether the front end had
 * been built. The duplication is deliberate and stays.
 *
 * WHAT IS NOT ALLOWED IS DISAGREEMENT, and they disagreed. When ModPlugin grew
 * `controller`, the host learned it and the builder did not, so a plugin whose
 * only member is a controller - which is exactly the Borg - passed the host's
 * check and was refused by the builder as "would do nothing". A mod author sees
 * only the builder, so the ABI had effectively not grown at all.
 *
 * This reads both FILES rather than calling both functions, because the builder
 * is an executable script with side effects at import. That is a weaker check
 * than executing them, and it is the strongest one available without splitting
 * the script - so it checks the two things a drift actually shows up as: the
 * member list, and the sentence the author reads.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const builderSrc = readFileSync(
  fileURLToPath(new URL("../bin/neo-angband-mod-build.mjs", import.meta.url)),
  "utf8",
);
const hostSrc = readFileSync(
  fileURLToPath(new URL("../../web/src/mod-plugin.ts", import.meta.url)),
  "utf8",
);

/** The optional function members ModPlugin declares, read from the interface. */
function hostMembers(): string[] {
  const body = /export interface ModPlugin \{([\s\S]*?)\n\}/u.exec(hostSrc)?.[1] ?? "";
  return [...body.matchAll(/^\s{2}(\w+)\?\(/gmu)].map((m) => m[1]!).sort();
}

/** The member list the builder type-checks in its `for (const name of [...])`. */
function builderTypeChecked(): string[] {
  const list = /for \(const name of \[([^\]]*)\]\)/u.exec(builderSrc)?.[1] ?? "";
  return [...list.matchAll(/"(\w+)"/gu)].map((m) => m[1]!).sort();
}

describe("the host and the builder implement the same plugin ABI", () => {
  it("finds both copies, so an empty scan cannot pass", () => {
    expect(hostMembers().length).toBeGreaterThan(2);
    expect(builderTypeChecked().length).toBeGreaterThan(2);
  });

  it("type-checks the same members", () => {
    // migrateBag is the one member the builder does not type-check, because it is
    // the only one that cannot be called at build time (it needs a save bag).
    expect(builderTypeChecked()).toEqual(
      hostMembers().filter((m) => m !== "migrateBag"),
    );
  });

  it("refuses a do-nothing plugin on the same grounds, in the same words", () => {
    /* The sentence matters as much as the rule: it is what a mod author reads,
     * and the two tools disagreeing about which members count is exactly how
     * this broke. Comparing the strings catches a rule change that forgets the
     * message and a message change that forgets the rule. */
    const sentence = "declares no hooks, register or controller, so it would do nothing";
    expect(hostSrc).toContain(sentence);
    expect(builderSrc).toContain(sentence);

    const members = ["hooks", "register", "controller"];
    for (const m of members) {
      expect(hostSrc).toContain(`p.${m} === undefined`);
      expect(builderSrc).toContain(`plugin.${m} === undefined`);
    }
  });
});
