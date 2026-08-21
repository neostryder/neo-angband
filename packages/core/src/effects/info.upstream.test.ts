/**
 * Upstream unit tests from reference/src/tests/effects/info.c
 *
 * Mapping:
 * - effect_damages / effect_avg_damage / effect_projection / effect_get_menu_name
 *   -> effectDamages / effectAvgDamage / effectProjection / effectMenuName
 *   in packages/core/src/effects/effect-info.ts
 * - Effect construction via EffectBuilder (effects/effect.ts) instead of
 *   mem_zalloc + effect_subtype.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PLAYER_TIMED_ENTRIES } from "../generated/index.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { EffectBuilder } from "./effect.js";
import type { Effect } from "./effect.js";
import {
  effectAvgDamage,
  effectDamages,
  effectMenuName,
  effectProjection,
} from "./effect-info.js";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as { records: T[] };
  return parsed.records;
}

const projections = bindProjections(packJson<ProjectionRecordJson>("projection"));

/** timed_effects[i].desc, the first desc string from player_timed.json, by TMD index. */
const timedDescByIdx: string[] = (() => {
  const recs = packJson<{ name: string; desc?: string[] }>("player_timed");
  const byName = new Map(recs.map((r) => [r.name, r.desc?.[0] ?? ""]));
  return PLAYER_TIMED_ENTRIES.map((e) => byName.get(e.name) ?? "");
})();

const menuDeps = {
  projections,
  timedDesc: (i: number) => timedDescByIdx[i] ?? "",
};

function build(index: string, dice?: string, radius = 0, other = 0): Effect {
  let b = new EffectBuilder().effect(index);
  if (dice) b = b.dice(dice);
  const e = b.build()!;
  e.radius = radius;
  e.other = other;
  return e;
}

/** Fixtures from effects/info.c setup_tests (avg damage precomputed upstream). */
const acidBolt = build("BOLT:ACID", "2d8");
const fireArc = build("ARC:FIRE", "4+1d5");
const coldSphere = build("SPHERE:COLD", "2+3d1", 5);
const lightningBall = build("BALL:ELEC", "5+8d3", 3);
const drainBolt = build("BOLT_STATUS_DAM:MON_DRAIN", "10");
const curseMon = build("CURSE", "6d4");
const slowBolt = build("BOLT_STATUS:MON_SLOW", "15+1d5");
const heal = build("HEAL_HP", "13");
const food = build("NOURISH:INC_BY", "5");
const cureStun = build("CURE:STUN");
const incFear = build("TIMED_INC:AFRAID", "30+1d10");
const incNoresBlind = build("TIMED_INC_NO_RES:BLIND", "40");
const decFast = build("TIMED_DEC:FAST", "15");
const detectGold = build("DETECT_GOLD");
const setValue = build("SET_VALUE", "5+8d10");

const avgdAcidBolt = 9;
const avgdFireArc = 7;
const avgdColdSphere = 5;
const avgdLightningBall = 21;
const avgdDrainBolt = 10;
const avgdCurseMon = 15;
const avgSetValue = 49;

describe("effects/info (reference/src/tests/effects/info.c)", () => {
  // upstream: test_damages
  it("damages", () => {
    expect(effectDamages(acidBolt)).toBe(true);
    expect(effectDamages(fireArc)).toBe(true);
    expect(effectDamages(coldSphere)).toBe(true);
    expect(effectDamages(lightningBall)).toBe(true);
    expect(effectDamages(drainBolt)).toBe(true);
    expect(effectDamages(curseMon)).toBe(true);
    expect(effectDamages(slowBolt)).toBe(false);
    expect(effectDamages(heal)).toBe(false);
    expect(effectDamages(food)).toBe(false);
    expect(effectDamages(cureStun)).toBe(false);
    expect(effectDamages(incFear)).toBe(false);
    expect(effectDamages(incNoresBlind)).toBe(false);
    expect(effectDamages(decFast)).toBe(false);
    expect(effectDamages(detectGold)).toBe(false);
    expect(effectDamages(setValue)).toBe(false);
  });

  // upstream: test_avg_damage
  it("average damage", () => {
    expect(effectAvgDamage(acidBolt, null)).toBe(avgdAcidBolt);
    expect(effectAvgDamage(fireArc, null)).toBe(avgdFireArc);
    expect(effectAvgDamage(coldSphere, null)).toBe(avgdColdSphere);
    expect(effectAvgDamage(lightningBall, null)).toBe(avgdLightningBall);
    expect(effectAvgDamage(drainBolt, null)).toBe(avgdDrainBolt);
    expect(effectAvgDamage(curseMon, null)).toBe(avgdCurseMon);
    expect(effectAvgDamage(slowBolt, null)).toBe(0);
    expect(effectAvgDamage(heal, null)).toBe(0);
    expect(effectAvgDamage(food, null)).toBe(0);
    expect(effectAvgDamage(cureStun, null)).toBe(0);
    expect(effectAvgDamage(incFear, null)).toBe(0);
    expect(effectAvgDamage(incNoresBlind, null)).toBe(0);
    expect(effectAvgDamage(decFast, null)).toBe(0);
    expect(effectAvgDamage(detectGold, null)).toBe(0);
    // Shared SET_VALUE dice replaces the lightning ball's own dice.
    expect(effectAvgDamage(lightningBall, setValue.dice)).toBe(avgSetValue);
  });

  // upstream: test_projection
  it("projection", () => {
    expect(effectProjection(acidBolt, projections)).toBe("acid");
    expect(effectProjection(fireArc, projections)).toBe("fire");
    expect(effectProjection(coldSphere, projections)).toBe("frost");
    expect(effectProjection(lightningBall, projections)).toBe("lightning");
    expect(effectProjection(drainBolt, projections)).toBe("");
    expect(effectProjection(curseMon, projections)).toBe("");
    expect(effectProjection(slowBolt, projections)).toBe("");
    expect(effectProjection(heal, projections)).toBe("");
    expect(effectProjection(food, projections)).toBe("");
    expect(effectProjection(cureStun, projections)).toBe("");
    expect(effectProjection(incFear, projections)).toBe("");
    expect(effectProjection(incNoresBlind, projections)).toBe("");
    expect(effectProjection(decFast, projections)).toBe("");
    expect(effectProjection(detectGold, projections)).toBe("");
  });

  // upstream: test_menu_name
  it("menu name", () => {
    expect(effectMenuName(acidBolt, menuDeps)).toBe("cast a bolt of acid");
    expect(effectMenuName(fireArc, menuDeps)).toBe("produce a cone of fire");
    expect(effectMenuName(coldSphere, menuDeps)).toBe("project frost");
    expect(effectMenuName(lightningBall, menuDeps)).toBe("fire a ball of lightning");
    expect(effectMenuName(drainBolt, menuDeps)).toBe(
      "cast a bolt which damages living monsters",
    );
    expect(effectMenuName(curseMon, menuDeps)).toBe("curse");
    expect(effectMenuName(slowBolt, menuDeps)).toBe(
      "cast a bolt which attempts to slow monsters",
    );
    expect(effectMenuName(heal, menuDeps)).toBe("heal self");
    expect(effectMenuName(food, menuDeps)).toBe("feed yourself");
    expect(effectMenuName(cureStun, menuDeps)).toBe("cure stunning");
    expect(effectMenuName(incFear, menuDeps)).toBe("extend fear");
    expect(effectMenuName(incNoresBlind, menuDeps)).toBe("extend blindness");
    expect(effectMenuName(decFast, menuDeps)).toBe("reduce haste");
    expect(effectMenuName(detectGold, menuDeps)).toBe("detect gold");
  });
});
