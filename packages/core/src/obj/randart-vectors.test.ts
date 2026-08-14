/**
 * Replay of the random-artifact golden vectors.
 *
 * WHAT THIS EXISTS TO CATCH. The four switches that build every random artifact
 * are about to become keyed registries so a mod can define a new ability or a
 * new item class (MOD_REACH gap 14). `randart-vectors.json` was recorded from
 * the code BEFORE that, so a vector that still matches is evidence the refactor
 * changed nothing, and one that does not names the artifact - or the ability -
 * that moved.
 *
 * WHY THE EXISTING DETERMINISM TEST IS NOT THIS. `randart.test.ts` runs
 * `doRandart` twice in one process and compares. That is a real property, but a
 * refactor that moves every artifact moves both runs identically, so it cannot
 * fail here. Agreement is symmetric; a fixture on disk is not.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ART_IDX, TV } from "../generated/index.js";
import { randartRegistry } from "./randart-registry.js";
import {
  computeRandartVectors,
  RANDART_ARM_SEEDS,
  RANDART_TARGET_POWERS,
  RANDART_VECTOR_SEEDS,
} from "./randart-vectors.js";
import type { RandartVector } from "./randart-vectors.js";
import { randartVectorFixtures } from "./randart-vectors.fixtures.js";

/** TV index -> the name the prep family records, so the compare is by name. */
function tvalName(tval: number): string {
  for (const [name, value] of Object.entries(TV as unknown as Record<string, number>)) {
    if (value === tval) return name;
  }
  return String(tval);
}

const recorded = JSON.parse(
  readFileSync(new URL("./randart-vectors.json", import.meta.url), "utf8"),
) as RandartVector[];

describe("random artifact construction", () => {
  const fresh = computeRandartVectors(randartVectorFixtures());

  it("records the same number of scenarios as when the fixture was taken", () => {
    /* An artifact leaving the pack, or a seed or target power dropping out of
     * the grid, would otherwise silently shrink the evidence rather than fail
     * it. */
    expect(fresh.length).toBe(recorded.length);
    expect(recorded.length).toBeGreaterThan(800);
  });

  it("runs every ART_IDX ability through the grid", () => {
    /* A handler no scenario reaches is a handler no vector can defend. The
     * ability family is the per-arm coverage for the 87-case switch, so the
     * count has to be exactly one vector per (ability, seed, power). */
    const ability = fresh.filter((v) => v.kind === "ability");
    /* ART_IDX.TOTAL is the enum terminator, so the index space is 0..TOTAL. */
    const abilities = ART_IDX.TOTAL + 1;
    expect(ability.length).toBe(
      abilities * RANDART_ARM_SEEDS.length * RANDART_TARGET_POWERS.length,
    );
    expect(new Set(ability.map((v) => v.subject)).size).toBe(abilities);
  });

  it("reaches the arms a single low target power cannot", () => {
    /* THE HOLE THIS GRID WAS WIDENED TO CLOSE. WEAPON_AGGR and NONWEAPON_AGGR
     * only grant AGGRAVATE above AGGR_POWER (300), so at power 100 they record
     * an artifact identical to doing nothing - indistinguishable from the
     * *_SUPER indices that genuinely have no case. Asserted, not trusted: the
     * high-power vector must DIFFER from the low-power one. */
    for (const subject of ["WEAPON_AGGR", "NONWEAPON_AGGR"]) {
      const low = fresh.find(
        (v) => v.kind === "ability" && v.subject === subject && v.scenario.includes("power=100"),
      );
      const high = fresh.find(
        (v) => v.kind === "ability" && v.subject === subject && v.scenario.includes("power=500"),
      );
      expect({ subject, differs: low?.out !== high?.out }).toEqual({
        subject,
        differs: true,
      });
    }
  });

  it("is measuring something: full sets, flags included", () => {
    /* Control for the RECORDER itself. A fingerprint that serialised every
     * artifact to the same string would replay perfectly forever - which is
     * not hypothetical here: the first recording wrote "[object Object]" for
     * the flag set in all 644 rows, so an ability that stopped granting its
     * flag would have moved nothing. */
    const set = fresh.filter((v) => v.kind === "set" && v.out !== "null");
    expect(set.length).toBeGreaterThan(300);
    const withFlags = set.filter(
      (v) => (JSON.parse(v.out) as { flags: number[] }).flags.length > 0,
    );
    expect(withFlags.length).toBeGreaterThan(200);
    /* And the sets are genuinely different from each other, seed to seed. */
    const bySeed = RANDART_VECTOR_SEEDS.map((seed) =>
      fresh
        .filter((v) => v.kind === "set" && v.scenario.startsWith(`seed=${String(seed)} `))
        .map((v) => v.out)
        .join("\n"),
    );
    expect(new Set(bySeed).size).toBe(RANDART_VECTOR_SEEDS.length);
  });

  it("runs every key core registers through at least one scenario", () => {
    /* A handler no scenario reaches is a handler no vector can defend. Derived
     * from the registry rather than from a list written here, so a new arm
     * cannot be added without the grid growing to cover it. */
    const registry = randartRegistry();

    /* The ability family iterates 0..ART_IDX.TOTAL, so a key inside that range
     * is reached and one outside it never would be. */
    expect({
      table: "abilities",
      unreached: registry.abilities
        .keys()
        .filter((k) => k < 0 || k > ART_IDX.TOTAL),
    }).toEqual({ table: "abilities", unreached: [] });

    /* The prep family names its tvals; every registered one must be among
     * them, or that item class's starting stats are recorded by nothing. */
    const prepTvals = new Set(
      fresh
        .filter((v) => v.kind === "prep")
        .map((v) => v.scenario.replace(/^tval=/, "").split(" ")[0]),
    );
    expect({
      table: "prep",
      unreached: registry.prep
        .keys()
        .filter((k) => !prepTvals.has(tvalName(k))),
    }).toEqual({ table: "prep", unreached: [] });

    /* The census family runs over the standard set, so a bucket core
     * registers has to actually receive artifacts - except TV.NULL, whose
     * whole job is to count nothing. */
    const totals = JSON.parse(
      fresh.find((v) => v.subject === "totals")?.out ?? "{}",
    ) as Record<string, number>;
    const empty = Object.entries(totals).filter(
      ([name, n]) => n === 0 && name !== "negPower",
    );
    expect({ table: "census", empty }).toEqual({ table: "census", empty: [] });
  });

  it("builds exactly the artifacts recorded before the registries existed", () => {
    const moved: string[] = [];
    for (let i = 0; i < fresh.length; i++) {
      const a = recorded[i];
      const b = fresh[i];
      if (!a || !b) {
        moved.push(`#${String(i)}: missing`);
        continue;
      }
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        moved.push(
          `${b.kind} ${b.subject} [${b.scenario}]` +
            (a.probe !== b.probe
              ? `: RNG POSITION MOVED, probe ${String(a.probe)} -> ${String(b.probe)}`
              : ": output moved"),
        );
      }
    }
    expect(moved.slice(0, 10)).toEqual([]);
    expect(moved.length).toBe(0);
  });
});
