/**
 * Combat/defense/escape tests (P8.4). Golden values are derived by hand from
 * reference/src/borg/borg-fight-attack.c, feeding the ported damage estimators
 * exact r_info-equivalent MonsterFacts (via an injected resolver) and pinned
 * traits, so the melee/missile/spell damage math matches the C constants. The
 * orchestrators (borg_attack / borg_caution) are smoke-tested through the
 * harness for their yield/commit contract.
 */

import { describe, expect, it } from "vitest";
import type { ItemView } from "@neo-angband/core";
import { BorgWorld } from "../world/model";
import { perceive, makePerceiveMemo } from "../perceive";
import { makeScenarioView, makeFakeActions, type Scenario } from "../harness";
import { makeBorgRng } from "../rng";
import type { BorgContext } from "../context";
import { BI } from "../trait/trait-index";
import type { MonsterFacts } from "../danger";
import { getDangerGlobals, MONBLOW } from "../danger";
import { BA } from "./bf";
import { getFightState } from "./state";
import { borgThrustDamageOne, borgLaunchDamageOne, borgBestMult, borgAttack } from "./attack";
import { borgCaution } from "./caution";

/** Build a seeded BorgContext with trait overrides applied after perceive. */
function makeCtx(
  scenario: Scenario = {},
  traits: Partial<Record<keyof typeof BI, number>> = {},
): BorgContext {
  const world = new BorgWorld();
  const view = makeScenarioView(scenario);
  perceive(world, view, makePerceiveMemo());
  for (const [k, v] of Object.entries(traits)) {
    world.self.trait[BI[k as keyof typeof BI]] = v;
  }
  return { world, view, act: makeFakeActions(), rng: makeBorgRng() };
}

/** MonsterFacts builder with faithful empty defaults. */
function facts(over: Partial<MonsterFacts> = {}): MonsterFacts {
  return {
    rIdx: 1,
    flags: new Set<string>(),
    level: 1,
    sleep: 0,
    spellPower: 0,
    freqInnate: 0,
    freqSpell: 0,
    hasFriends: false,
    blows: [],
    spells: [],
    ...over,
  };
}

/** A minimal ItemView carrying only the fields the estimators read. */
function item(over: Partial<ItemView> = {}): ItemView {
  return {
    handle: 1,
    label: "x",
    tval: 0,
    sval: 0,
    pval: 0,
    number: 1,
    weight: 10,
    ac: 0,
    toA: 0,
    toH: 0,
    toD: 0,
    dd: 0,
    ds: 0,
    ego: false,
    artifact: false,
    flags: [],
    modifiers: [],
    brands: [],
    slays: [],
    resists: [],
    curses: [],
    egoName: null,
    artifactName: null,
    activation: false,
    timeout: 0,
    inscription: null,
    ...over,
  };
}

describe("borgBestMult (attack.c:374)", () => {
  it("fire brand vs non-immune -> x3", () => {
    expect(borgBestMult(item({ brands: ["FIRE"] }), facts())).toBe(3);
  });
  it("fire brand vs IM_FIRE -> x1 (no bonus)", () => {
    expect(borgBestMult(item({ brands: ["FIRE"] }), facts({ flags: new Set(["IM_FIRE"]) }))).toBe(1);
  });
  it("fire brand vs HURT_FIRE -> x6 (vuln doubles)", () => {
    expect(borgBestMult(item({ brands: ["FIRE"] }), facts({ flags: new Set(["HURT_FIRE"]) }))).toBe(6);
  });
  it("slay EVIL vs evil -> x2", () => {
    expect(borgBestMult(item({ slays: ["EVIL"] }), facts({ flags: new Set(["EVIL"]) }))).toBe(2);
  });
  it("slay UNDEAD vs undead -> x3", () => {
    expect(borgBestMult(item({ slays: ["UNDEAD"] }), facts({ flags: new Set(["UNDEAD"]) }))).toBe(3);
  });
  it("*slay* UNDEAD_5 vs undead -> x5", () => {
    expect(borgBestMult(item({ slays: ["UNDEAD_5"] }), facts({ flags: new Set(["UNDEAD"]) }))).toBe(5);
  });
});

describe("borgThrustDamageOne (attack.c:100)", () => {
  const traits = { WDD: 2, WDS: 6, BLOWS: 1, THN: 100, CLEVEL: 10, CDEPTH: 1 };
  it("2d6 warrior, chance capped at 95% -> 6", () => {
    const ctx = makeCtx({ monsters: [{ grid: { x: 21, y: 12 } }] }, traits);
    ctx.world.kills.at(1).power = 100;
    getDangerGlobals(ctx.world).resolveFacts = () => facts();
    /* base = 2*(6+1)/2 = 7; mult 1; *1 blow; chance 100->95; 7*95/100 = 6 */
    expect(borgThrustDamageOne(ctx, 1)).toBe(6);
  });
  it("unique below town gets the x6 targeting bonus (dam += dam*5)", () => {
    const ctx = makeCtx({ monsters: [{ grid: { x: 21, y: 12 } }] }, traits);
    ctx.world.kills.at(1).power = 100;
    getDangerGlobals(ctx.world).resolveFacts = () => facts({ flags: new Set(["UNIQUE"]) });
    /* 6 + 6*5 = 36 */
    expect(borgThrustDamageOne(ctx, 1)).toBe(36);
  });
});

describe("borgLaunchDamageOne resist switch (attack.c:437)", () => {
  const traits = { CDEPTH: 1, CLEVEL: 20 };
  function setup(fl: string[]) {
    const ctx = makeCtx({ monsters: [{ grid: { x: 25, y: 12 } }] }, traits);
    ctx.world.kills.at(1).power = 1000;
    getDangerGlobals(ctx.world).resolveFacts = () => facts({ flags: new Set(fl) });
    return ctx;
  }
  it("FIRE, no immunity -> full damage", () => {
    const ctx = setup([]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.FIRE, null)).toBe(100);
  });
  it("FIRE vs IM_FIRE -> 0", () => {
    const ctx = setup(["IM_FIRE"]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.FIRE, null)).toBe(0);
  });
  it("FIRE vs HURT_FIRE -> doubled", () => {
    const ctx = setup(["HURT_FIRE"]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.FIRE, null)).toBe(200);
  });
  it("HOLY_ORB vs EVIL -> doubled", () => {
    const ctx = setup(["EVIL"]);
    expect(borgLaunchDamageOne(ctx, getFightState(ctx.world), 1, 100, BA.HOLY_ORB, null)).toBe(200);
  });
});

describe("borgAttack (attack.c:5148)", () => {
  it("no monsters -> null (yield)", () => {
    const ctx = makeCtx();
    expect(borgAttack(ctx)).toBeNull();
  });
  it("adjacent monster, warrior -> a melee (walk) command", () => {
    const ctx = makeCtx(
      { monsters: [{ grid: { x: 21, y: 12 } }] },
      { WDD: 2, WDS: 6, BLOWS: 1, THN: 100, CLEVEL: 10, CDEPTH: 1, SPEED: 110 },
    );
    /* place the borg adjacent to the monster and mark the grid on-panel */
    ctx.world.self.c = { x: 20, y: 12 };
    ctx.world.kills.at(1).power = 30;
    ctx.world.kills.at(1).awake = true;
    ctx.world.map.at(21, 12).info |= 0x08 | 0x20; /* BORG_OKAY | BORG_VIEW */
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    const cmd = borgAttack(ctx);
    expect(cmd).not.toBeNull();
    expect(cmd!.code).toBe("walk");
  });
});

describe("borgCaution (caution.c:799)", () => {
  it("healthy, no monsters -> null (nothing to do)", () => {
    const ctx = makeCtx({}, { CURHP: 50, MAXHP: 50, CLEVEL: 20, CDEPTH: 5 });
    expect(borgCaution(ctx)).toBeNull();
  });
});
