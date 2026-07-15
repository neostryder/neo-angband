/**
 * Danger / threat-evaluation tests (P8.2). Golden values are derived by hand
 * from reference/src/borg/borg-danger.c, feeding the ported estimators exact
 * r_info-equivalent MonsterFacts (via an injected resolver) so the melee/spell
 * damage math is pinned to the C constants, then exercising the geometry
 * (energy/speed model, distance, LOS) and the fear caches through the harness.
 */

import { describe, expect, it } from "vitest";
import { BorgWorld } from "../world/model";
import { perceive, makePerceiveMemo } from "../perceive";
import { makeScenarioView, makeFakeActions, type Scenario } from "../harness";
import { makeBorgRng } from "../rng";
import type { BorgContext } from "../context";
import { RSF, FEAT } from "@neo-angband/core";
import { BI } from "../trait/trait-index";
import { MONBLOW } from "./tables";
import type { MonsterFacts } from "./facts";
import {
  borgDanger,
  borgDangerOneKill,
  borgDangerPhysical,
  borgDangerSpell,
} from "./danger";
import { getDangerGlobals, getFearCaches } from "./state";
import { borgFearRegional } from "./fear";

/** Build a seeded BorgContext, applying trait overrides after perceive. */
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

/** A MonsterFacts builder with faithful empty defaults. */
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

describe("borgDangerPhysical (borg-danger.c:63)", () => {
  it("HURT 1d4 -> dice*sides, no resist, full damage", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const f = facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    expect(borgDangerPhysical(ctx.world, g, f, true)).toBe(4);
  });

  it("FIRE 3d6 doubles (z*2), no resist", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const f = facts({ blows: [{ dice: 3, sides: 6, effect: MONBLOW.FIRE }] });
    /* z = 18; z*2 = 36 */
    expect(borgDangerPhysical(ctx.world, g, f, true)).toBe(36);
  });

  it("FIRE 3d6 with RFIRE reduces then doubles: (18+2)/3=6, *2=12", () => {
    const ctx = makeCtx({}, { RFIRE: 1 });
    const g = getDangerGlobals(ctx.world);
    const f = facts({ blows: [{ dice: 3, sides: 6, effect: MONBLOW.FIRE }] });
    expect(borgDangerPhysical(ctx.world, g, f, true)).toBe(12);
  });

  it("ACID 2d3 adds +200 armour-corrosion fear", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const f = facts({ blows: [{ dice: 2, sides: 3, effect: MONBLOW.ACID }] });
    /* z = 6 + 200 = 206 */
    expect(borgDangerPhysical(ctx.world, g, f, true)).toBe(206);
  });

  it("sums multiple blows (HURT 1d4 + FIRE 3d6 = 40)", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const f = facts({
      blows: [
        { dice: 1, sides: 4, effect: MONBLOW.HURT },
        { dice: 3, sides: 6, effect: MONBLOW.FIRE },
      ],
    });
    expect(borgDangerPhysical(ctx.world, g, f, true)).toBe(40);
  });

  it("partial damage scales by hit chance (HURT 1d4, lvl1 pow60, ac0 -> 0)", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const f = facts({
      level: 1,
      blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }],
    });
    /* chance = 150 - (0 + (1+60)*3) = -33 -> 5; z = 4*5/100 = 0 */
    expect(borgDangerPhysical(ctx.world, g, f, false)).toBe(0);
  });

  it("DAM_RED subtracts from each blow's damage", () => {
    const ctx = makeCtx({}, { DAM_RED: 3 });
    const g = getDangerGlobals(ctx.world);
    const f = facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    /* z = 4 - 3 = 1 */
    expect(borgDangerPhysical(ctx.world, g, f, true)).toBe(1);
  });

  it("unknown race (rIdx 0) is worth 1000", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    expect(borgDangerPhysical(ctx.world, g, facts({ rIdx: 0 }), true)).toBe(1000);
  });
});

describe("borgDangerSpell (borg-danger.c:556)", () => {
  it("BR_FIRE = hp/3 + 40 fear, no resist", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const kill = ctx.world.kills.at(0);
    kill.power = 300;
    const f = facts({ spellPower: 50, spells: [RSF.BR_FIRE] });
    /* z = 300/3 = 100; p = 40 + 100 = 140; av = 140 */
    expect(borgDangerSpell(ctx.world, g, f, kill, 12, 20, 1, true)).toBe(140);
  });

  it("BR_FIRE with RFIRE: z=(100+2)/3=34; p=40+34=74", () => {
    const ctx = makeCtx({}, { RFIRE: 1 });
    const g = getDangerGlobals(ctx.world);
    const kill = ctx.world.kills.at(0);
    kill.power = 300;
    const f = facts({ spellPower: 50, spells: [RSF.BR_FIRE] });
    expect(borgDangerSpell(ctx.world, g, f, kill, 12, 20, 1, true)).toBe(74);
  });

  it("no ranged attacks -> 0", () => {
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const kill = ctx.world.kills.at(0);
    expect(borgDangerSpell(ctx.world, g, facts(), kill, 12, 20, 1, true)).toBe(0);
  });

  it("BO_FIRE bolt reaches the borg over open floor: 72+30/3=82, +40 fear", () => {
    /* borg at the map centre (20,12); kill at (0,0). The harness map is all
     * floor, so borg_projectable_pure succeeds and the bolt damage stands. */
    const ctx = makeCtx();
    const g = getDangerGlobals(ctx.world);
    const kill = ctx.world.kills.at(0);
    kill.pos.x = 0;
    kill.pos.y = 0;
    kill.power = 300;
    const f = facts({ spellPower: 30, spells: [RSF.BO_FIRE] });
    /* z = 9*8 + 30/3 = 82; p = 40 + 82 = 122 */
    expect(borgDangerSpell(ctx.world, g, f, kill, 12, 20, 5, true)).toBe(122);
  });

  it("BO_FIRE bolt is zeroed when a wall blocks the path (only fear remains)", () => {
    /* Same as above but the intervening grids are granite -> no projection. */
    const ctx = makeCtx({ floorFeat: FEAT.GRANITE });
    const g = getDangerGlobals(ctx.world);
    const kill = ctx.world.kills.at(0);
    kill.pos.x = 0;
    kill.pos.y = 0;
    kill.power = 300;
    const f = facts({ spellPower: 30, spells: [RSF.BO_FIRE] });
    /* bolt blocked -> z = 0; only the +40 fear remains. */
    expect(borgDangerSpell(ctx.world, g, f, kill, 12, 20, 5, true)).toBe(40);
  });
});

describe("borgDangerOneKill (borg-danger.c:2288)", () => {
  it("adjacent HURT 1d4 monster at normal speed -> 4", () => {
    const ctx = makeCtx(
      { monsters: [{ grid: { x: 21, y: 12 }, speed: 110 }] },
      { SPEED: 110 },
    );
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    expect(borgDangerOneKill(ctx, 12, 20, 1, 1, true, true)).toBe(4);
  });

  it("monster beyond distance 20 contributes 0", () => {
    const ctx = makeCtx(
      { width: 60, monsters: [{ grid: { x: 55, y: 12 }, speed: 110 }] },
      { SPEED: 110 },
    );
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    /* d = 35 > 20 -> 0 */
    expect(borgDangerOneKill(ctx, 12, 20, 1, 1, true, true)).toBe(0);
  });

  it("NEVER_MOVE monster at range 2 threatens nothing", () => {
    const ctx = makeCtx(
      { monsters: [{ grid: { x: 22, y: 12 }, speed: 110 }] },
      { SPEED: 110 },
    );
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({
        flags: new Set(["NEVER_MOVE"]),
        blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }],
      });
    expect(borgDangerOneKill(ctx, 12, 20, 1, 1, true, true)).toBe(0);
  });

  it("dead slot (kill.rIdx 0) contributes 0", () => {
    const ctx = makeCtx(
      { monsters: [{ grid: { x: 21, y: 12 }, speed: 110 }] },
      { SPEED: 110 },
    );
    /* Simulate a cleared kill record (borg_delete_kill leaves r_idx 0). */
    ctx.world.kills.at(1).rIdx = 0;
    expect(borgDangerOneKill(ctx, 12, 20, 1, 1, true, true)).toBe(0);
  });
});

describe("borgDanger (borg-danger.c:2825)", () => {
  it("sums adjacent monster danger over the grid", () => {
    const ctx = makeCtx(
      { monsters: [{ grid: { x: 21, y: 12 }, speed: 110 }] },
      { SPEED: 110 },
    );
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({ blows: [{ dice: 1, sides: 4, effect: MONBLOW.HURT }] });
    expect(borgDanger(ctx, 12, 20, 1, true, false)).toBe(4);
  });

  it("clamps total danger to 2000", () => {
    const ctx = makeCtx(
      { monsters: [{ grid: { x: 21, y: 12 }, speed: 110 }] },
      { SPEED: 110 },
    );
    getDangerGlobals(ctx.world).resolveFacts = () =>
      facts({ blows: [{ dice: 100, sides: 100, effect: MONBLOW.HURT }] });
    expect(borgDanger(ctx, 12, 20, 1, true, false)).toBe(2000);
  });

  it("out-of-bounds grid is maximally dangerous (2000)", () => {
    const ctx = makeCtx();
    expect(borgDanger(ctx, -1, -1, 1, true, false)).toBe(2000);
  });

  it("adds regional fear scaled by turns", () => {
    const ctx = makeCtx({}, { CDEPTH: 1 });
    borgFearRegional(ctx.world, getFearCaches(ctx.world), 11, 11, 100, true);
    /* borg_fear_region[1][1] = 100; borg_danger adds region * c. */
    expect(borgDanger(ctx, 11, 11, 1, true, false)).toBe(100);
    expect(borgDanger(ctx, 11, 11, 2, true, false)).toBe(200);
  });
});
