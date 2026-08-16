/**
 * The shell hands the verb table to both places that need it (#284).
 *
 * Core owns the seam and the sentence, and proves both by running them:
 * `session/command-verb-wiring.test.ts` installs a mod's verb through the
 * capability-gated facade and reads the rendered "Really dance with ...? ". What
 * core CANNOT prove is that the SHELL ever passes the table along - a perfectly
 * correct `CommandVerbTable` that main.ts never wires reads exactly like a
 * finished feature, and there are two independent places to forget it:
 *
 *   1. `allowChosenItem` must pass `state.commandVerbs` into `itemAllowPrompt`,
 *      or every prompt still resolves out of core's closed COMMAND_INFO and a
 *      mod's command reads "do that with" however well the mod named it.
 *   2. BOTH `createModRegistryHost` call sites - the trusted one and the
 *      enabled-mods loop - must wire `commandVerbs`, or `setVerb` throws "the
 *      command registry is not available in this game" for that half of the
 *      mods and the failure is per-door rather than global.
 *
 * main.ts boots a real game at module scope and cannot be imported into a unit
 * test, so these are pinned by reading the source - the shape exit-to-title.test.ts
 * established and wield-prompts.test.ts follows.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*[(<]`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

/** Source with line and block comments stripped, so a citation cannot score. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

const SRC = stripComments(MAIN);

describe("get_item_allow reads the game's verb table", () => {
  const body = stripComments(functionBody(MAIN, "allowChosenItem"));

  it("passes state.commandVerbs into itemAllowPrompt", () => {
    expect(body).toContain("itemAllowPrompt(");
    expect(body).toContain("state.commandVerbs");
  });

  it("does NOT narrow the code back to core's closed CommandCode union", () => {
    /* The cast was the bug's other half: a mod's command code is a plain string
     * and casting it to CommandCode only hid that COMMAND_INFO could never
     * answer for it. itemAllowPrompt takes a string now, so nothing here needs
     * to lie about the type. */
    expect(body).not.toContain("as CommandCode");
    /* Scoped to this function's body ON PURPOSE. An earlier draft asserted the
     * name appeared nowhere in main.ts at all, which is a tripwire the size of
     * an 11,000-line file: the first legitimate use fires it, and a ratchet that
     * fires on unrelated work gets deleted wholesale rather than narrowed. The
     * cast HERE is the thing that hid the defect, so here is where it is
     * pinned. */
  });
});

describe("both registry hosts wire the verb table", () => {
  it("every createModRegistryHost target list carries commandVerbs", () => {
    /* Counted, not spot-checked: a THIRD door added later without the field
     * would leave that door's mods unable to name their commands, and no
     * assertion on the first two would notice. */
    const hosts = SRC.split("createModRegistryHost(").slice(1);
    expect(hosts.length, "main.ts should build a registry host at each mod door").toBe(2);
    for (const call of hosts) {
      const targets = call.slice(0, call.indexOf("},"));
      expect(targets).toContain("commands: registry");
      expect(targets).toContain("commandVerbs: state.commandVerbs");
    }
  });
});
