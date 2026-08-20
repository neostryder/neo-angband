/**
 * Port of the upstream unit test reference/src/tests/parse/z-info.c
 * ("parse/z-info"), which exercises reference/src/init.c's constants.txt
 * parser (init_parse_constants / parse_constants_*).
 *
 * The port has no runtime constants parser: `content` compiles constants.txt
 * to a single JSON record of {label, value} lists per section, and
 * `bindConstants` (packages/core/src/constants.ts) does the label lookup and
 * range checking that upstream's handlers do. So this is where z-info.c's two
 * rejection families land.
 *
 * Nothing here is reachable from the shipped constants.txt, which is why the
 * W5 data-exactness suite cannot see any of it (see
 * parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-parse.md).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bindConstants } from "./constants.js";
import type { ConstantsJson } from "./constants.js";

const packJson = JSON.parse(
  readFileSync(new URL("../../content/pack/constants.json", import.meta.url), "utf8"),
) as ConstantsJson;

type Entry = { label: string; value: number };

/** A deep copy of the shipped constants record, safe to mutate per test. */
function freshPack(): ConstantsJson {
  return JSON.parse(JSON.stringify(packJson)) as ConstantsJson;
}

function section(json: ConstantsJson, name: string): Entry[] {
  const rec = json.records[0];
  if (rec === undefined) throw new Error("constants.json has no record");
  const entries = rec[name];
  if (!Array.isArray(entries)) throw new Error(`no "${name}" section in constants.json`);
  return entries as Entry[];
}

/** The nine sections whose handlers reject a negative value upstream. */
const NEGATIVE_CASES: ReadonlyArray<readonly [string, string]> = [
  ["level-max", "monsters"],
  ["mon-gen", "chance"],
  ["mon-play", "mult-rate"],
  ["dun-gen", "wall-max"],
  ["world", "dungeon-hgt"],
  ["carry-cap", "pack-size"],
  ["store", "shuffle"],
  ["obj-make", "great-obj"],
  ["player", "max-sight"],
];

/**
 * The thirteen sections whose handlers reject an unrecognised label upstream.
 * z-info.c uses "xyzzy" for all but level-max, which it probes with "D".
 */
const BAD_LABEL_CASES: ReadonlyArray<readonly [string, string]> = [
  ["level-max", "D"],
  ["mon-gen", "xyzzy"],
  ["mon-play", "xyzzy"],
  ["dun-gen", "xyzzy"],
  ["world", "xyzzy"],
  ["carry-cap", "xyzzy"],
  ["store", "xyzzy"],
  ["obj-make", "xyzzy"],
  ["player", "xyzzy"],
  ["melee-critical", "xyzzy"],
  ["ranged-critical", "xyzzy"],
  ["o-melee-critical", "xyzzy"],
  ["o-ranged-critical", "xyzzy"],
];

describe("parse/z-info test_negative: a negative scalar is PARSE_ERROR_INVALID_VALUE", () => {
  it("covers all nine sections z-info.c probes", () => {
    expect(NEGATIVE_CASES).toHaveLength(9);
  });

  it.each(NEGATIVE_CASES)("rejects %s:%s = -1", (name, label) => {
    /* init.c's parse_constants_* handlers all do
     *   if (value < 0) return PARSE_ERROR_INVALID_VALUE;
     * after grabbing the named field. */
    const json = freshPack();
    const entries = section(json, name);
    const target = entries.find((e) => e.label === label);
    expect(target, `${name}:${label} must exist in the shipped data`).toBeDefined();
    (target as Entry).value = -1;
    expect(() => bindConstants(json)).toThrow(/negative value/);
  });

  it("accepts the shipped values unchanged", () => {
    expect(() => bindConstants(freshPack())).not.toThrow();
  });
});

describe("parse/z-info test_baddirective: an unknown label is PARSE_ERROR_UNDEFINED_DIRECTIVE", () => {
  it("covers all thirteen sections z-info.c probes", () => {
    expect(BAD_LABEL_CASES).toHaveLength(13);
  });

  it.each(BAD_LABEL_CASES)("rejects %s:%s", (name, label) => {
    const json = freshPack();
    section(json, name).push({ label, value: 1 });
    expect(() => bindConstants(json)).toThrow(
      new RegExp(`unknown label ${name}:${label}`),
    );
  });
});

describe("parse/z-info test_m_crit_level: critical levels keep file order", () => {
  it("appends melee-critical-level rows in the order they appear", () => {
    /* Upstream walks to the tail of m_crit_level_head and links the new
     * level there (init.c parse_constants_melee_critical_level), so the
     * list is in file order, not reversed. */
    const z = bindConstants(freshPack());
    expect(z.meleeCritical.levels.length).toBeGreaterThan(1);

    const raw = section(freshPack(), "melee-critical-level") as unknown as Array<{
      cutoff: number;
      mult: number;
      add: number;
      msg: string;
    }>;
    expect(z.meleeCritical.levels.map((l) => [l.cutoff, l.mult, l.add, l.msg])).toEqual(
      raw.map((r) => [r.cutoff, r.mult, r.add, r.msg]),
    );
  });

  /*
   * finish_parse_constants (init.c L1006-1020) -> check_critical_levels
   * (L986-1004). z-info.c has no case for this - it is a whole-file check
   * rather than a directive handler - but it is the half of the finish hook
   * that changes what a bad pack does, so it lands here with the rest of the
   * constants rejections.
   *
   * Unreachable from the shipped constants.txt (400/700/900/1300 then the -1
   * catch-all), reachable from a mod: `melee-critical-level` is a top-level
   * key of the constants record and composition replaces an array wholesale,
   * so a mod can hand the game any cutoff order it likes.
   */
  describe("check_critical_levels: cutoffs must strictly increase", () => {
    type Level = { cutoff: number; mult: number; add: number; msg: string };

    function levels(json: ConstantsJson, name: string): Level[] {
      const rec = json.records[0];
      if (rec === undefined) throw new Error("constants.json has no record");
      return rec[name] as unknown as Level[];
    }

    it("accepts the shipped tables", () => {
      expect(() => bindConstants(freshPack())).not.toThrow();
    });

    it.each([
      ["melee-critical-level", "melee"],
      ["ranged-critical-level", "ranged"],
    ])("rejects a non-increasing %s", (name, which) => {
      const json = freshPack();
      const rows = levels(json, name);
      /* Make the second cutoff equal the first: `<=` is the rejection, so
       * equal is as bad as descending. */
      (rows[1] as Level).cutoff = (rows[0] as Level).cutoff;
      expect(() => bindConstants(json)).toThrow(
        `constants: the cutoffs for ${which} criticals in constants.txt are ` +
          `not strictly increasing (PARSE_ERROR_NON_SEQUENTIAL_RECORDS)`,
      );
    });

    it("exempts the last row's cutoff, which nothing reads", () => {
      /* Upstream only compares a level against its predecessor while that
       * level still has a successor, so the final cutoff is dead - which is
       * why the shipped tables can end with -1 at all. criticalLevel
       * (combat/hit.ts) stops at `i < last` for the same reason. */
      const json = freshPack();
      const rows = levels(json, "melee-critical-level");
      const last = rows.length - 1;
      (rows[last] as Level).cutoff = -99999;
      expect(() => bindConstants(json)).not.toThrow();
    });

    it("does not check the o-combat tables, which have no cutoff", () => {
      /* finish_parse_constants checks m_crit_level_head and r_crit_level_head
       * only. The o- rows carry `chance` and are picked by a one-in-chance
       * roll (critical_o_shot/melee), so their order is not a comparison. */
      const json = freshPack();
      const rows = levels(json, "o-melee-critical-level") as unknown as Array<{
        chance: number;
      }>;
      const first = rows[0] as { chance: number };
      const second = rows[1] as { chance: number };
      second.chance = first.chance;
      expect(() => bindConstants(json)).not.toThrow();
    });
  });

  it("keeps critical sections' negative values, unlike the scalar sections", () => {
    /* melee-critical:chance-offset is -60 in constants.txt (line 236), so
     * the critical handlers must NOT apply the value < 0 rejection the
     * scalar handlers do. (ranged-critical:chance-offset is 0, line 291.) */
    const z = bindConstants(freshPack());
    expect(z.meleeCritical.chanceOffset).toBe(-60);
    expect(z.rangedCritical.chanceOffset).toBe(0);
  });
});
