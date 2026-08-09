/**
 * Replay the project_p golden vectors.
 *
 * CHECK ONLY. There is no regenerate-if-missing branch and no environment flag
 * that would let a failing run rewrite its own expectation - a marker that can
 * disable its own check is not a check. Regenerating is a separate, committed
 * script whose header says outright that it overwrites the evidence.
 *
 * The vectors were recorded from `makePlayerSideEffects` BEFORE its 21-case
 * switch became a registry. Replaying them identically is the whole claim: the
 * conversion bought moddability and changed no player behaviour.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ } from "../generated/index.js";
import {
  recordAllPlayerSide,
  PACK_DAMAGE_ELEMENTS,
  VECTOR_DEPTH,
  VECTOR_PROJECTIONS,
  VECTOR_RESISTS,
} from "./player-side-vectors.js";
import type { PlayerSideVector } from "./player-side-vectors.js";
import { playerSideFixtures } from "./player-side-vectors.fixtures.js";

const vectors = JSON.parse(
  readFileSync(new URL("./player-side-vectors.json", import.meta.url), "utf8"),
) as PlayerSideVector[];

/* Replayed through the SAME grid builder the generator uses, once, then
 * compared group by group. Re-listing the dimensions here would let the check
 * and the recording drift apart on a dimension neither would then cover. */
const fixtures = playerSideFixtures();
const replayed = recordAllPlayerSide(fixtures);

/** Rows whose handler is one of the three that do nothing to the player. */
const EMPTY_HANDLERS = ["METEOR", "MISSILE", "MANA"];

/**
 * COULD THIS FAIL?
 *
 * IT ALREADY DIDN'T, TWICE. The first recording ran 2,304 scenarios in which
 * the pack was never damaged, the worn gear never disenchanted, minus_ac never
 * bit and every single teleport reported failure - four whole handler arms
 * captured as dead code, in a file that would then have replayed forever while
 * proving nothing about any of them. The causes were all in the fixture, not
 * the handlers: object_prep ORs the object BASE's el_info in, so filtering on
 * the kind's alone found nothing that hates acid; minus_ac and
 * disenchant_equipment pick a slot BY TYPE, so a suit of armour in slot 0
 * (WEAPON) was invisible to both; a 40x25 harness field has nowhere to put a
 * 200-grid teleport; and the harness builds at depth 0, the town, where
 * teleport_player_level has no UP to choose.
 *
 * The second recording still had NEXUS's 1-in-4 teleport-level arm empty in all
 * 96 of its rows, because NEXUS reads neither `dam` nor `power` - so the whole
 * rest of the grid collapsed onto two rng streams. Six seeds, not two.
 *
 * Every assertion below pins one of the arms those passes missed. They are here
 * so that a fixture which stops reaching the code fails loudly instead of
 * quietly recording nothing.
 */
describe("project_p vectors: the recording can disagree", () => {
  const messages = vectors.flatMap((v) => v.messages);

  it("has a destroyable pack item for every element inven_damage takes", () => {
    /* The selection is derived from the content pack, so an element that found
     * no kind is a silently empty arm rather than an error. */
    for (const elem of PACK_DAMAGE_ELEMENTS) {
      expect(
        fixtures.destroyedByElement.has(elem),
        `element ${String(elem)} has a kind that hates it`,
      ).toBe(true);
    }
  });

  it("actually destroyed pack items", () => {
    const most = Math.max(...vectors.map((v) => v.packItems));
    const lost = vectors.filter((v) => v.packItems < most);
    expect(lost.length).toBeGreaterThan(0);
    expect(messages.some((m) => /was destroyed!$/.test(m))).toBe(true);
    expect(messages.some((m) => /were destroyed!$/.test(m))).toBe(true);
  });

  it("actually disenchanted worn gear, and actually ran minus_ac", () => {
    /* Two different writers of the same field, and they say different things:
     * disenchant_equipment names the slot label, minus_ac does not. */
    expect(messages.some((m) => /was disenchanted!$/.test(m))).toBe(true);
    expect(messages.some((m) => /^Your .* is damaged!$/.test(m))).toBe(true);
    const most = Math.max(...vectors.map((v) => v.gearEnchant));
    expect(vectors.filter((v) => v.gearEnchant < most).length).toBeGreaterThan(0);
  });

  it("actually teleported the player, and actually changed level", () => {
    const home = vectors.find((v) => EMPTY_HANDLERS.includes(v.proj));
    expect(home, "an untouched row to compare against").toBeDefined();
    const moved = vectors.filter(
      (v) => v.grid[0] !== home?.grid[0] || v.grid[1] !== home?.grid[1],
    );
    expect(moved.length).toBeGreaterThan(0);
    /* No row may report the search giving up: that was the signature of a
     * harness field too small to teleport across, and it made every NEXUS and
     * GRAVITY row record a failure instead of a move. */
    expect(messages).not.toContain("Failed to find teleport destination!");
    const levelled = vectors.filter((v) => v.levelChangeTo !== null);
    expect(levelled.length).toBeGreaterThan(0);
    /* Down from the recorded depth: the arm ran in a dungeon, not the town. */
    expect(new Set(levelled.map((v) => v.levelChangeTo))).toContain(
      VECTOR_DEPTH + 1,
    );
  });

  it("reaches the drains: stats, experience, mana and energy", () => {
    expect(vectors.filter((v) => v.statCur.some((s) => s < 15)).length)
      .toBeGreaterThan(0);
    expect(vectors.filter((v) => v.exp < 50_000).length).toBeGreaterThan(0);
    expect(vectors.filter((v) => v.csp < 40).length).toBeGreaterThan(0);
    expect(vectors.filter((v) => v.energy === 0).length).toBeGreaterThan(0);
    /* POIS's acid sting is the only source of extra damage, and it runs
     * adjust_dam - the one call in this file that evaluates a dice
     * denominator. */
    expect(vectors.filter((v) => v.xtra > 0).length).toBeGreaterThan(0);
  });

  it("reaches BOTH arms of the sustain and HOLD_LIFE checks", () => {
    /* A grid that only ran unwarded rows would record every drain landing and
     * never the save, which is half of three handlers. */
    expect(messages.some((m) => /but the feeling passes\.$/.test(m))).toBe(true);
    expect(messages.some((m) => /^You feel very \w+\.$/.test(m))).toBe(true);
    expect(messages).toContain("You feel your life force draining away!");
  });

  it("leaves timed effects, and learns runes", () => {
    expect(vectors.filter((v) => v.timed.length > 0).length).toBeGreaterThan(0);
    expect(vectors.filter((v) => v.learnedFlags > 0).length).toBeGreaterThan(0);
  });

  it("records the empty handlers as doing NOTHING", () => {
    /* The control for the control. These three fall to the default arm, so if a
     * row of theirs ever shows an effect the recorder is attributing someone
     * else's work - or the dispatch is landing on the wrong handler, which is
     * precisely the failure a registry conversion can introduce. */
    for (const row of vectors.filter((v) => EMPTY_HANDLERS.includes(v.proj))) {
      expect(row.messages, row.id).toEqual([]);
      expect(row.timed, row.id).toEqual([]);
      expect(row.xtra, row.id).toBe(0);
      expect(row.exp, row.id).toBe(50_000);
    }
  });

  it("holds one vector per scenario in the declared grid, and no more", () => {
    /* Both directions: a scenario dropped from the grid and a stale row left in
     * the file are the same kind of silent coverage loss. */
    expect(vectors).toHaveLength(replayed.length);
    expect(new Set(vectors.map((v) => v.id)).size).toBe(vectors.length);
  });

  it("covers every switch arm project_p had", () => {
    /* The 21 handled types are named individually; the recording is worthless
     * if one silently left the grid. */
    const recorded = new Set(vectors.map((v) => v.proj));
    for (const [name] of VECTOR_PROJECTIONS) expect(recorded).toContain(name);
    expect(recorded.size).toBe(VECTOR_PROJECTIONS.length);
    expect(VECTOR_PROJECTIONS.length - EMPTY_HANDLERS.length).toBe(21);
  });
});

/**
 * One `it()` per (projection, resist level). Finer than per-file and coarser
 * than per-row: a divergence names the handler and the resist profile in the
 * test title, and the diff carries the scenario id, without minting 6,912 test
 * cases.
 */
describe("project_p vectors replay identically", () => {
  for (const [projName] of VECTOR_PROJECTIONS) {
    for (const [resistName] of VECTOR_RESISTS) {
      it(`${projName} at resist=${resistName}`, () => {
        const pick = (rows: readonly PlayerSideVector[]): PlayerSideVector[] =>
          rows.filter((v) => v.proj === projName && v.resist === resistName);
        const expected = pick(vectors);
        expect(expected.length, "the grid still holds this pair").toBeGreaterThan(0);
        expect(pick(replayed)).toEqual(expected);
      });
    }
  }
});

/** The census the vectors exist to protect: 21 arms, and what they dispatch on. */
describe("project_p is the third member of the projection family", () => {
  it("dispatches on the same PROJ space project_f and project_o do", () => {
    /* Not decoration: the registries are keyed by projection CODE, and a mod's
     * own projection reaches its handler only because all three resolve the
     * same way. */
    const handled = VECTOR_PROJECTIONS.filter(
      ([name]) => !EMPTY_HANDLERS.includes(name),
    );
    for (const [name, typ] of handled) {
      expect((PROJ as Record<string, number>)[name], name).toBe(typ);
    }
  });
});
