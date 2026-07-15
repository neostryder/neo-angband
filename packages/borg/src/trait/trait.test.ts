/**
 * P8.3 self-model tests: the BI_* index space, borg_notice derivation from the
 * perceive view, the borg_power fitness weights, and the borg_prepared depth
 * gate. Golden values are read straight off the C (cited inline) so the port
 * stays behaviour-faithful.
 */

import { describe, expect, it } from "vitest";
import type {
  AgentView,
  ItemView,
  PlayerView,
} from "@neo-angband/core";
import type { BorgContext } from "../context";
import { BorgWorld } from "../world/model";
import { makeScenarioView, makeFakeActions } from "../harness";
import { makeBorgRng } from "../rng";
import {
  BI,
  BI_MAX,
  PREFIX_PREF,
  CLASS_MAGE,
  CLASS_WARRIOR,
} from "./trait-index";
import { borgNotice } from "./trait";
import { borgPower } from "./power";
import { borgPrepared } from "./prepared";
import { getDerived } from "./state";

/* A complete ItemView from a partial. */
function item(o: Partial<ItemView>): ItemView {
  return {
    handle: 0, label: "", tval: 0, sval: 0, pval: 0, number: 1, weight: 0,
    ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
    flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
    egoName: null, artifactName: null, activation: false, timeout: 0,
    inscription: null, ...o,
  };
}

/* A 12-slot equipment array (weapon..boots) from a slot->item map. */
function equipArray(slots: Record<number, ItemView>): Array<ItemView | null> {
  const a: Array<ItemView | null> = new Array<ItemView | null>(12).fill(null);
  for (const [k, v] of Object.entries(slots)) a[Number(k)] = v;
  return a;
}

/* A BorgContext wrapping a scenario view, with optional item overrides. */
function mkCtx(
  player: Partial<PlayerView> = {},
  equip: Array<ItemView | null> = [],
  inven: ItemView[] = [],
): BorgContext {
  const base = makeScenarioView({ player });
  const view: AgentView = {
    ...base,
    equipment: () => equip,
    inventory: () => inven,
  };
  return { world: new BorgWorld(), view, act: makeFakeActions(), rng: makeBorgRng() };
}

describe("BI_* index space", () => {
  it("is contiguous and in the borg-trait.h order", () => {
    expect(BI.STR).toBe(0);
    expect(BI.CON).toBe(4);
    expect(BI.ASTR).toBe(5);
    expect(BI.CSTR).toBe(10);
    expect(BI.STR_INDEX).toBe(15);
    expect(BI.CLASS).toBe(25);
    expect(BI.PREP_BIG_FIGHT).toBe(BI_MAX - 1);
  });

  it("has one label per trait", () => {
    expect(PREFIX_PREF.length).toBe(BI_MAX);
  });

  it("keeps the offset-addressed stat groups aligned", () => {
    /* borg-trait.c addresses BI_STR + i, BI_ASTR + i, etc. across 5 stats. */
    expect(BI.INT - BI.STR).toBe(1);
    expect(BI.AINT - BI.ASTR).toBe(1);
    expect(BI.CINT - BI.CSTR).toBe(1);
    expect(BI.INT_INDEX - BI.STR_INDEX).toBe(1);
  });
});

describe("borg_notice_player", () => {
  it("maps the player frame from the perceive view", () => {
    const ctx = mkCtx({
      cls: "Mage",
      level: 12,
      maxLevel: 12,
      depth: 5,
      maxDepth: 7,
      hp: 15,
      maxHp: 40,
      sp: 8,
      maxSp: 20,
      gold: 1234,
      status: {
        blind: 0, confused: 0, afraid: 0, poisoned: 3, cut: 0, stun: 0,
        paralyzed: 0, food: 5000,
      },
    });
    borgNotice(ctx);
    const t = ctx.world.self.trait;
    expect(t[BI.CLASS]).toBe(CLASS_MAGE);
    expect(t[BI.CLEVEL]).toBe(12);
    expect(t[BI.CDEPTH]).toBe(5);
    expect(t[BI.MAXDEPTH]).toBe(7);
    expect(t[BI.CURHP]).toBe(15);
    expect(t[BI.MAXHP]).toBe(40);
    expect(t[BI.HP_ADJ]).toBe(40); /* mapped to maxHp */
    expect(t[BI.GOLD]).toBe(1234);
    expect(t[BI.ISPOISONED]).toBe(1);
    expect(t[BI.ISHUNGRY]).toBe(0); /* food 5000 is "normal" */
  });

  it("classifies food thresholds (PY_FOOD_*)", () => {
    const weak = mkCtx({ status: { blind: 0, confused: 0, afraid: 0, poisoned: 0, cut: 0, stun: 0, paralyzed: 0, food: 500 } });
    borgNotice(weak);
    expect(weak.world.self.trait[BI.ISWEAK]).toBe(1);
    expect(weak.world.self.trait[BI.ISHUNGRY]).toBe(1);

    const gorged = mkCtx({ status: { blind: 0, confused: 0, afraid: 0, poisoned: 0, cut: 0, stun: 0, paralyzed: 0, food: 10000 } });
    borgNotice(gorged);
    expect(gorged.world.self.trait[BI.ISGORGED]).toBe(1);
    expect(gorged.world.self.trait[BI.ISFULL]).toBe(1);
  });
});

describe("borg_notice equipment derivation", () => {
  it("folds resists, brands, armor, and weapon dice from items", () => {
    const ring = item({ tval: 21, resists: [{ element: "POIS", level: 1 }] });
    const weapon = item({
      tval: 9, dd: 2, ds: 5, weight: 50, toH: 5, toD: 3, brands: ["FIRE_3"],
    });
    const body = item({ tval: 16, ac: 20, toA: 5, weight: 200 });
    const ctx = mkCtx({}, equipArray({ 0: weapon, 2: ring, 6: body }));
    borgNotice(ctx);
    const t = ctx.world.self.trait;
    expect(t[BI.RPOIS]).toBe(1);
    expect(t[BI.WB_FIRE]).toBe(1);
    expect(t[BI.WTOHIT]).toBe(5);
    expect(t[BI.WTODAM]).toBe(3);
    expect(t[BI.WDD]).toBe(2);
    expect(t[BI.WDS]).toBe(5);
    /* armor = body ac(20) + to_a(5) + dex_ta[7]=0 (DEX 10). Weapon ac not added. */
    expect(t[BI.ARMOR]).toBe(25);
    /* weight = 50 (weapon) + 200 (body) + 0 (ring). */
    expect(t[BI.WEIGHT]).toBe(250);
  });

  it("ignores _2 brands (borg only sees the _3 element brand)", () => {
    const weapon = item({ tval: 9, dd: 1, ds: 4, weight: 30, brands: ["ACID_2"] });
    const ctx = mkCtx({}, equipArray({ 0: weapon }));
    borgNotice(ctx);
    expect(ctx.world.self.trait[BI.WB_ACID]).toBe(0);
  });

  it("reads slay multipliers per race flag (last-writer-wins)", () => {
    const weapon = item({ tval: 9, dd: 1, ds: 4, weight: 30, slays: ["EVIL_2", "UNDEAD_5"] });
    const ctx = mkCtx({}, equipArray({ 0: weapon }));
    borgNotice(ctx);
    expect(ctx.world.self.trait[BI.WS_EVIL]).toBe(2);
    expect(ctx.world.self.trait[BI.WS_UNDEAD]).toBe(5);
  });
});

describe("borg_power weights (borg-power.c)", () => {
  /* A zeroed trait with the borg_notice defaults; MAXDEPTH 0 keeps the
   * depth-gated bonuses out so a single weight can be isolated. */
  function zeroTrait(): number[] {
    const t = new Array<number>(BI_MAX).fill(0);
    t[BI.SPEED] = 110;
    t[BI.BLOWS] = 1;
    t[BI.AMMO_TVAL] = -1;
    t[BI.AMMO_SIDES] = 4;
    t[BI.CLASS] = CLASS_WARRIOR;
    return t;
  }

  it("computes the fixed baseline for an empty warrior", () => {
    /* speed@110 = 55000 (power.c:298), low-level blows bonus = 45000
     * (power.c:167, CLEVEL<=10 * BLOWS 1), max-stat rewards = 190000
     * (power.c:1687), deep-prep bonus = 40000 (town ok, dlvl 2 blocked on
     * light). 55000 + 45000 + 190000 + 40000 = 330000. */
    const ctx = mkCtx({}, [], []);
    ctx.world.self.trait = zeroTrait();
    expect(borgPower(ctx)).toBe(330000);
    expect(ctx.world.self.power).toBe(330000);
  });

  it("rewards resist/immunity flags by their exact weights", () => {
    const base = () => {
      const ctx = mkCtx({}, [], []);
      ctx.world.self.trait = zeroTrait();
      return ctx;
    };
    const p0 = borgPower(base());

    const withRpois = base();
    withRpois.world.self.trait[BI.RPOIS] = 1;
    expect(borgPower(withRpois) - p0).toBe(20000); /* power.c:461 */

    const withRfire = base();
    withRfire.world.self.trait[BI.RFIRE] = 1;
    expect(borgPower(withRfire) - p0).toBe(8000); /* power.c:453 */

    const withIcold = base();
    withIcold.world.self.trait[BI.ICOLD] = 1;
    expect(borgPower(withIcold) - p0).toBe(65000); /* power.c:437 */

    const withEsp = base();
    withEsp.world.self.trait[BI.ESP] = 1;
    expect(borgPower(withEsp) - p0).toBe(80000); /* power.c:433 */
  });

  it("penalizes curses by their exact weights", () => {
    const ctx = mkCtx({}, [], []);
    ctx.world.self.trait = zeroTrait();
    const p0 = borgPower(ctx);
    ctx.world.self.trait[BI.CRSTELE] = 1;
    expect(borgPower(ctx) - p0).toBe(-100000); /* power.c:635 */
  });
});

describe("borg_prepared (borg-prepared.c)", () => {
  /* A trait array kitted out to clear every band up to depth 99 for a warrior. */
  function decked(): number[] {
    const t = new Array<number>(BI_MAX).fill(0);
    t[BI.CLASS] = CLASS_WARRIOR;
    t[BI.MAXCLEVEL] = 50;
    t[BI.CLEVEL] = 50;
    t[BI.MAXDEPTH] = 90;
    t[BI.CDEPTH] = 90;
    t[BI.LIGHT] = 3;
    t[BI.FOOD] = 20;
    t[BI.AFUEL] = 10;
    t[BI.MAXHP] = 800;
    t[BI.SPEED] = 130;
    t[BI.ACCW] = 10;
    t[BI.ACSW] = 5;
    t[BI.APHASE] = 5;
    t[BI.RECALL] = 5;
    t[BI.ATELEPORT] = 6;
    t[BI.AESCAPE] = 3;
    t[BI.ATELEPORTLVL] = 2;
    t[BI.ESP] = 1;
    t[BI.FRACT] = 1;
    t[BI.SRFIRE] = t[BI.SRCOLD] = t[BI.SRELEC] = t[BI.SRACID] = 1;
    t[BI.RACID] = t[BI.RCOLD] = t[BI.RELEC] = 1;
    t[BI.SRPOIS] = t[BI.SRCONF] = t[BI.SRBLIND] = 1;
    t[BI.SRKAOS] = t[BI.SRDIS] = 1;
    t[BI.STR] = 78;
    t[BI.DEX] = 78;
    t[BI.CON] = 78;
    t[BI.AHEAL] = 3;
    t[BI.AEZHEAL] = 10; /* clears the depth-82 *heal* scum gate */
    return t;
  }

  function ctxWith(trait: number[]): BorgContext {
    const ctx = mkCtx({}, [], []);
    ctx.world.self.trait = trait;
    getDerived(ctx.world); /* fresh derived (has[] empty) */
    return ctx;
  }

  it("is always ready for town and depth 1", () => {
    expect(borgPrepared(ctxWith(decked()), 1)).toBeNull();
  });

  it("is ready at depth 99 when fully decked", () => {
    expect(borgPrepared(ctxWith(decked()), 99)).toBeNull();
  });

  it("flags a missing light as a restock need", () => {
    const t = decked();
    t[BI.LIGHT] = 0;
    expect(borgPrepared(ctxWith(t), 2)).toBe("restock light radius < 1");
  });

  it("requires free action from depth 20", () => {
    const t = decked();
    t[BI.FRACT] = 0;
    expect(borgPrepared(ctxWith(t), 25)).toBe("free action");
  });

  it("requires resist fire from depth 25", () => {
    const t = decked();
    t[BI.SRFIRE] = 0;
    expect(borgPrepared(ctxWith(t), 25)).toBe("resist fire");
  });

  it("requires +10 speed by depth 61-80", () => {
    const t = decked();
    t[BI.SPEED] = 118;
    expect(borgPrepared(ctxWith(t), 65)).toBe("+10 speed");
  });
});
