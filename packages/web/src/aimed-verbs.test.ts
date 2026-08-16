/**
 * WHICH item commands ask for a direction (cmd-obj.c).
 *
 * Upstream asks exactly once, inside use_aux (cmd-obj.c:431), which is reached
 * only from do_cmd_read_scroll, do_cmd_use_staff, do_cmd_aim_wand, do_cmd_zap_rod,
 * do_cmd_activate, do_cmd_eat_food and do_cmd_quaff_potion. do_cmd_wield,
 * do_cmd_takeoff and do_cmd_drop have no aim question at all.
 *
 * This shell had the question one level too high: dispatchItemVerb and
 * dispatchItemRef asked obj_needs_aim for WHATEVER code they were dispatching.
 * obj_needs_aim looks at the object's effect, not the command, so an item whose
 * effect happens to be aimed made every verb aim. Putting on a Ring of Flames
 * asked "Direction ('*' or <click> to target, "'" for closest, Escape to cancel)?"
 * before it would go on a hand - reported from play, 2026-08-13. Acid, Ice,
 * Lightning, Open Wounds and Digging carry the same `effect:` line, and taking
 * one off or dropping it asked too.
 *
 * That objNeedsAim really is true for such a ring is core's to prove and it does:
 * obj-cmd.test.ts, "per-object effect knowledge", asserts it for a Ring of Flames.
 * So the gate below is the whole of what stops the prompt, and if it goes the bug
 * comes straight back.
 *
 * Pinned by reading the source, the shape wield-prompts.test.ts established:
 * main.ts boots a real game at module scope and cannot be imported into a unit
 * test, so a call site is only checkable as text.
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

/** The literal members of `const AIMED_VERBS = new Set([...])`, in order. */
function aimedVerbs(): string[] {
  const m = /const AIMED_VERBS = new Set\(\[([\s\S]*?)\]\)/u.exec(MAIN);
  expect(m, "main.ts no longer declares AIMED_VERBS").not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/gu)].map((x) => x[1] ?? "");
}

describe("AIMED_VERBS is use_aux's caller list and nothing else", () => {
  it("holds the seven commands that reach use_aux (cmd-obj.c:739-932)", () => {
    expect(new Set(aimedVerbs())).toEqual(
      new Set(["read", "quaff", "eat", "use-staff", "aim-wand", "zap-rod", "activate"]),
    );
  });

  it("does NOT hold wield, takeoff or drop - the reported bug, three ways", () => {
    /* do_cmd_wield (cmd-obj.c:265), do_cmd_takeoff (:239), do_cmd_drop (:360).
     * None of the three calls use_aux, so none of them may ask a direction. */
    for (const verb of ["wield", "takeoff", "drop"]) {
      expect(aimedVerbs(), verb).not.toContain(verb);
    }
  });

  it("does not hold anything else the shell dispatches either", () => {
    /* The census: every code handed to dispatchItemVerb as a literal. A new verb
     * added here is out of the set by default, which is the safe direction - it
     * asks no direction until someone says it should. */
    const dispatched = new Set(
      [...stripComments(MAIN).matchAll(/dispatchItemVerb\("([^"]+)"/gu)].map((m) => m[1] ?? ""),
    );
    for (const verb of aimedVerbs()) {
      /* Every aimed verb is one this shell actually dispatches, or the set has
       * grown a member no path can reach - a rule about nothing. */
      expect(dispatched.has(verb), `${verb} is in AIMED_VERBS but nothing dispatches it`).toBe(true);
    }
  });
});

describe("the aim question is asked only for those verbs", () => {
  it("dispatchItemVerb gates objNeedsAim on the code", () => {
    const body = stripComments(functionBody(MAIN, "dispatchItemVerb"));
    expect(body).toMatch(/AIMED_VERBS\.has\(code\) && objNeedsAim\(/u);
    /* And the gate is on the same test, not a second unguarded one further down. */
    expect(body.match(/objNeedsAim\(/gu)?.length).toBe(1);
  });

  it("dispatchItemRef gates it too, so the picker path matches the menu path", () => {
    const body = stripComments(functionBody(MAIN, "dispatchItemRef"));
    expect(body).toMatch(/AIMED_VERBS\.has\(code\) && objNeedsAim\(/u);
    expect(body.match(/objNeedsAim\(/gu)?.length).toBe(1);
  });

  it("no call site asks objNeedsAim without either a gate or a reason", () => {
    /* The (A)ctivate screen is the one ungated call: it IS do_cmd_activate, so
     * the question is owed unconditionally and there is no `code` to test. Any
     * OTHER bare call is this bug reappearing somewhere new, so the count is
     * pinned rather than the shape. */
    const src = stripComments(MAIN);
    const all = src.match(/objNeedsAim\(/gu) ?? [];
    const gated = src.match(/AIMED_VERBS\.has\(code\) && objNeedsAim\(/gu) ?? [];
    expect(all.length - gated.length).toBe(1);
  });
});
