/**
 * Replay of the effect-info golden vectors.
 *
 * WHAT THIS EXISTS TO CATCH. Five closed `switch` statements decided everything
 * the game says about an effect - the menu row, the recall sentence, which
 * object properties an activation grants, and how a gamedata `type:` name
 * becomes an integer. They are now keyed registries so a mod's own effect can
 * say those things too. A registry changes WHO CAN REGISTER, never what the
 * unmodded game prints - and "never" is a claim that needs evidence, not an
 * assertion.
 *
 * `effect-info-vectors.json` was recorded from the code BEFORE the registry
 * existed (see the module header of `effect-info-vectors.ts`). Every vector
 * here re-runs the same call and compares the exact string.
 *
 * NO RNG PROBE, deliberately: this path draws nothing (effect-info.ts
 * substitutes `Dice.randomValue()` for upstream's `dice_roll` precisely so
 * rendering cannot perturb the stream). The text is what is at risk, so the
 * text is what is compared.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EFFECT_ENTRIES } from "../generated/index.js";
import { effectInfoRegistry } from "./effect-info-registry.js";
import { computeEffectInfoVectors } from "./effect-info-vectors.js";
import type { EffectInfoVector } from "./effect-info-vectors.js";
import { effectInfoVectorFixtures } from "./effect-info-vectors.fixtures.js";

const recorded = JSON.parse(
  readFileSync(new URL("./effect-info-vectors.json", import.meta.url), "utf8"),
) as EffectInfoVector[];

describe("effect info: menu name, description, activation summary, subtype", () => {
  const fresh = computeEffectInfoVectors(effectInfoVectorFixtures());

  it("records the same number of scenarios as when the fixture was taken", () => {
    /* An effect leaving EFFECT_ENTRIES, or a scenario axis losing a value,
     * would otherwise silently shrink the evidence rather than fail it. */
    expect(fresh.length).toBe(recorded.length);
    expect(recorded.length).toBeGreaterThan(10000);
  });

  it("covers all five families", () => {
    const counts = new Map<string, number>();
    for (const v of fresh) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
    for (const kind of ["menu", "desc", "chain", "summary", "subtype"]) {
      expect({ kind, n: counts.get(kind) ?? 0 }).toEqual({
        kind,
        n: expect.any(Number) as number,
      });
      expect(counts.get(kind) ?? 0).toBeGreaterThan(0);
    }
  });

  it("does not consist of scenarios that cannot disagree", () => {
    /* A vector whose output is "" / "null" / "-1" for every input proves
     * nothing about the arm it was meant to exercise. Most subtype rows are
     * legitimately -1 (that effect takes no such name), so the bar is that
     * each family carries a healthy body of DISTINCT non-trivial outputs. */
    const trivial = new Set(["", "null", "-1"]);
    for (const kind of ["menu", "desc", "chain", "summary", "subtype"]) {
      const outs = new Set(
        fresh.filter((v) => v.kind === kind && !trivial.has(v.out)).map((v) => v.out),
      );
      expect({ kind, distinct: outs.size > 3 }).toEqual({ kind, distinct: true });
    }
  });

  it("runs every key core registers through at least one scenario", () => {
    /* WHY: a handler no scenario reaches is a handler no vector can defend.
     * The glyph work learned this the expensive way - its first control run
     * PASSED because nothing in the grid reached the arm that was broken. */
    const reg = effectInfoRegistry();

    const flagsUsed = new Set(
      EFFECT_ENTRIES.map((e) => (e as { infoFlags: string }).infoFlags),
    );
    expect({
      table: "text",
      unreached: reg.text.keys().filter((k) => !flagsUsed.has(k)),
    }).toEqual({ table: "text", unreached: [] });

    const codesUsed = new Set(
      fresh
        .filter((v) => v.kind === "summary")
        .flatMap((v) => v.scenario.split(" ").map((tok) => tok.split(":")[0]?.split("(")[0] ?? "")),
    );
    expect({
      table: "summary",
      unreached: reg.summary.keys().filter((k) => !codesUsed.has(k)),
    }).toEqual({ table: "summary", unreached: [] });

    /* Every index 1..EFFECT_ENTRIES.length is iterated by the subtype family,
     * so a key inside that range is reached; one outside it never would be. */
    expect({
      table: "subtype",
      unreached: reg.subtype
        .keys()
        .filter(
          (k) => typeof k !== "number" || k < 1 || k > EFFECT_ENTRIES.length,
        ),
    }).toEqual({ table: "subtype", unreached: [] });
  });

  it("produces exactly the text recorded before the registry existed", () => {
    const moved: string[] = [];
    for (let i = 0; i < fresh.length; i++) {
      const a = recorded[i];
      const b = fresh[i];
      if (!a || !b) {
        moved.push(`#${String(i)}: missing`);
        continue;
      }
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        moved.push(`${b.kind} ${b.effect} [${b.scenario}]: ${a.out} -> ${b.out}`);
      }
    }
    expect(moved.slice(0, 10)).toEqual([]);
    expect(moved.length).toBe(0);
  });
});
