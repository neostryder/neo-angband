/**
 * P8.5 item/magic/recovery tests. Pure decision helpers are exercised against a
 * hand-built AgentView (the harness view overridden with inventory / equipment /
 * spellbooks), asserting faithful thresholds and the exact commands emitted.
 */

import { describe, expect, it } from "vitest";
import type {
  AgentView,
  ItemView,
  SpellbookView,
  SpellView,
} from "@neo-angband/core";
import { BorgWorld } from "../world/model";
import { makeScenarioView, makeFakeActions, type Scenario } from "../harness";
import { makeBorgRng } from "../rng";
import type { BorgContext } from "../context";
import { BI } from "../trait/trait-index";
import {
  SVAL,
  TV,
  Spell,
  borgSpellFailRate,
  borgSpellLegal,
  borgSpellOkay,
  borgSpell,
  borgGetSpellNumber,
  borgQuaffPotion,
  borgQuaffCrit,
  borgReadScroll,
  borgZapRod,
  borgMaintainLight,
  BorgNeed,
  borgRecover,
  borgCrushJunk,
  deviceFail,
} from "./index";

/** A complete ItemView from a partial. */
function item(p: Partial<ItemView>): ItemView {
  return {
    handle: p.handle ?? 1,
    label: p.label ?? "item",
    tval: p.tval ?? 0,
    sval: p.sval ?? 0,
    pval: p.pval ?? 0,
    number: p.number ?? 1,
    weight: p.weight ?? 0,
    ac: p.ac ?? 0,
    toA: p.toA ?? 0,
    toH: p.toH ?? 0,
    toD: p.toD ?? 0,
    dd: p.dd ?? 0,
    ds: p.ds ?? 0,
    ego: p.ego ?? false,
    artifact: p.artifact ?? false,
    flags: p.flags ?? [],
    modifiers: p.modifiers ?? [],
    brands: p.brands ?? [],
    slays: p.slays ?? [],
    resists: p.resists ?? [],
    curses: p.curses ?? [],
    egoName: p.egoName ?? null,
    artifactName: p.artifactName ?? null,
    activation: p.activation ?? false,
    timeout: p.timeout ?? 0,
    inscription: p.inscription ?? null,
    ...(p.value !== undefined ? { value: p.value } : {}),
  };
}

interface Loadout {
  inventory?: ItemView[];
  equipment?: Array<ItemView | null>;
  spellbooks?: SpellbookView[];
}

/** Build a BorgContext with a view carrying gear, and trait overrides. */
function makeCtx(
  scenario: Scenario,
  gear: Loadout = {},
  traits: Partial<Record<keyof typeof BI, number>> = {},
): BorgContext {
  const world = new BorgWorld();
  const base = makeScenarioView(scenario);
  const view: AgentView = {
    ...base,
    inventory: () => (gear.inventory ?? []).map((i) => ({ ...i })),
    equipment: () => (gear.equipment ?? []).map((i) => (i ? { ...i } : null)),
    spellbooks: () => gear.spellbooks ?? [],
  };
  // Seed self position/class from the view player.
  const p = view.player();
  world.self.c.x = p.grid.x;
  world.self.c.y = p.grid.y;
  for (const [k, v] of Object.entries(traits)) {
    world.self.trait[BI[k as keyof typeof BI]] = v;
  }
  return { world, view, act: makeFakeActions(), rng: makeBorgRng() };
}

/** A Mage spellbook (book 0) holding Magic Missile at sidx 0. */
function mageBook(overrides: Partial<SpellView> = {}): SpellbookView {
  const mm: SpellView = {
    name: "Magic Missile",
    sidx: 0,
    bidx: 0,
    level: 1,
    mana: 1,
    fail: 30,
    learned: true,
    worked: true,
    forgotten: false,
    ...overrides,
  };
  return {
    tval: TV.MAGIC_BOOK,
    name: "Magic for Beginners",
    realm: "arcane",
    spells: [mm],
  };
}

describe("sval identity table", () => {
  it("matches canonical object.txt svals", () => {
    expect(SVAL.potion.cure_critical).toBe(10);
    expect(SVAL.scroll.word_of_recall).toBe(24);
    expect(SVAL.rod.recall).toBe(24);
    expect(SVAL.staff.teleportation).toBe(21);
    expect(SVAL.wand.magic_missile).toBe(1);
    expect(SVAL.light.torch).toBe(1);
  });
});

describe("magic: identity & legality", () => {
  it("maps a Spell enum to the class sidx (mage Magic Missile == 0)", () => {
    const ctx = makeCtx({ player: { cls: "Mage" } });
    expect(borgGetSpellNumber(ctx, Spell.MAGIC_MISSILE)).toBe(0);
  });

  it("borg_spell_legal requires the book, known status and MAXSP", () => {
    const withBook: Loadout = {
      inventory: [item({ handle: 5, tval: TV.MAGIC_BOOK, sval: 1 })],
      spellbooks: [mageBook()],
    };
    const ctx = makeCtx({ player: { cls: "Mage" } }, withBook, {
      CLEVEL: 5,
      MAXSP: 20,
    });
    expect(borgSpellLegal(ctx, Spell.MAGIC_MISSILE)).toBe(true);

    // No book carried -> not legal.
    const noBook = makeCtx({ player: { cls: "Mage" } }, { spellbooks: [mageBook()] }, {
      CLEVEL: 5,
      MAXSP: 20,
    });
    expect(borgSpellLegal(noBook, Spell.MAGIC_MISSILE)).toBe(false);
  });

  it("borg_spell_fail_rate follows the borg formula", () => {
    // base 30, clevel 5, level 1 -> 30 - 3*(5-1) - FAIL1(0) = 18; mage=ZERO_FAIL
    const ctx = makeCtx(
      { player: { cls: "Mage" } },
      { inventory: [item({ tval: TV.MAGIC_BOOK, sval: 1 })], spellbooks: [mageBook()] },
      { CLEVEL: 5, FAIL1: 0, FAIL2: 0 },
    );
    expect(borgSpellFailRate(ctx, Spell.MAGIC_MISSILE)).toBe(18);
  });

  it("fear adds 20 and stun adds 15 to the fail rate", () => {
    const ctx = makeCtx(
      { player: { cls: "Mage" } },
      { inventory: [item({ tval: TV.MAGIC_BOOK, sval: 1 })], spellbooks: [mageBook()] },
      { CLEVEL: 5, FAIL1: 0, FAIL2: 0, ISAFRAID: 1, ISSTUN: 1 },
    );
    // 18 + 20 = 38, capped at 50 first? 38<50; then +15 stun = 53.
    expect(borgSpellFailRate(ctx, Spell.MAGIC_MISSILE)).toBe(53);
  });

  it("borg_spell_okay emits a cast command at the spell sidx", () => {
    const ctx = makeCtx(
      { player: { cls: "Mage" } },
      { inventory: [item({ tval: TV.MAGIC_BOOK, sval: 1 })], spellbooks: [mageBook()] },
      { CLEVEL: 5, MAXSP: 20, CURSP: 20, LIGHT: 1 },
    );
    expect(borgSpellOkay(ctx, Spell.MAGIC_MISSILE)).toBe(true);
    const cmd = borgSpell(ctx, Spell.MAGIC_MISSILE) as { code: string; args: { spell: number } };
    expect(cmd.code).toBe("cast");
    expect(cmd.args.spell).toBe(0);
  });

  it("borg_spell_okay fails when dark (no light)", () => {
    const ctx = makeCtx(
      { player: { cls: "Mage" } },
      { inventory: [item({ tval: TV.MAGIC_BOOK, sval: 1 })], spellbooks: [mageBook()] },
      { CLEVEL: 5, MAXSP: 20, CURSP: 20, LIGHT: 0 },
    );
    expect(borgSpellOkay(ctx, Spell.MAGIC_MISSILE)).toBe(false);
  });
});

describe("consumables", () => {
  it("borg_quaff_potion finds the potion by sval and quaffs it", () => {
    const ctx = makeCtx({}, {
      inventory: [
        item({ handle: 9, tval: TV.POTION, sval: SVAL.potion.cure_light! }),
      ],
    });
    const cmd = borgQuaffPotion(ctx, SVAL.potion.cure_light!) as {
      code: string;
      args: { handle: number };
    };
    expect(cmd.code).toBe("quaff");
    expect(cmd.args.handle).toBe(9);
  });

  it("borg_quaff_crit conserves the last two CCW (ACCW < 2)", () => {
    const inv: Loadout = {
      inventory: [item({ tval: TV.POTION, sval: SVAL.potion.cure_critical! })],
    };
    const low = makeCtx({}, inv, { ACCW: 1 });
    expect(borgQuaffCrit(low, false)).toBeNull();
    // no_check drinks regardless.
    expect(borgQuaffCrit(low, true)).not.toBeNull();
  });

  it("borg_read_scroll is blocked when blind", () => {
    const inv: Loadout = {
      inventory: [item({ tval: TV.SCROLL, sval: SVAL.scroll.phase_door! })],
    };
    const blind = makeCtx({}, inv, { LIGHT: 1, ISBLIND: 1 });
    expect(borgReadScroll(blind, SVAL.scroll.phase_door!)).toBeNull();
    const ok = makeCtx({}, inv, { LIGHT: 1 });
    expect(borgReadScroll(ok, SVAL.scroll.phase_door!)).not.toBeNull();
  });

  it("device fail formula matches the C (skill/level)", () => {
    // lev 0, DEV 30: 100*((30-0)-140)/((0-30)-90) = 100*(-110)/(-120) = 91 (trunc)
    const ctx = makeCtx({}, {}, { DEV: 30 });
    expect(deviceFail(ctx, 0)).toBe(91);
  });

  it("borg_zap_rod zaps a charged rod (and always allows Recall)", () => {
    const ctx = makeCtx(
      {},
      { inventory: [item({ handle: 3, tval: TV.ROD, sval: SVAL.rod.recall!, pval: 1 })] },
      { DEV: 30 },
    );
    const cmd = borgZapRod(ctx, SVAL.rod.recall!) as { code: string; args: { handle: number } };
    expect(cmd.code).toBe("zap-rod");
    expect(cmd.args.handle).toBe(3);
  });
});

describe("light maintenance", () => {
  it("refuels a low lantern from a flask of oil", () => {
    const ctx = makeCtx({}, {
      equipment: [item({ handle: 20, tval: TV.LIGHT, sval: SVAL.light.lantern!, timeout: 500 })],
      inventory: [item({ handle: 7, tval: TV.FLASK, sval: SVAL.flask.oil! })],
    });
    const res = borgMaintainLight(ctx);
    expect(res.need).toBe(BorgNeed.MET_NEED);
    expect(res.cmd?.code).toBe("refill");
  });

  it("reports UNMET_NEED with no light and none to wield", () => {
    const ctx = makeCtx({});
    expect(borgMaintainLight(ctx).need).toBe(BorgNeed.UNMET_NEED);
  });
});

describe("recovery", () => {
  it("rests to recover HP when hurt and safe", () => {
    const ctx = makeCtx({ player: { depth: 5 } }, {}, {
      CURHP: 10,
      MAXHP: 40,
      CDEPTH: 5,
    });
    const cmd = borgRecover(ctx);
    expect(cmd?.code).toBe("rest");
  });

  it("does not recover when danger is high", () => {
    const ctx = makeCtx({ player: { depth: 5 } }, {}, {
      CURHP: 10,
      MAXHP: 40,
      CDEPTH: 5,
    });
    expect(borgRecover(ctx, { danger: 100, avoidance: 100 })).toBeNull();
  });
});

describe("junk", () => {
  it("drops a worthless, known-value item", () => {
    const ctx = makeCtx({ player: { depth: 10 } }, {
      inventory: [
        item({ handle: 4, tval: TV.SWORD, sval: 1, value: 0, curses: [] }),
      ],
    }, { CDEPTH: 10, CURHP: 40, MAXCLEVEL: 30 });
    const cmd = borgCrushJunk(ctx) as { code: string; args: { handle: number } };
    expect(cmd.code).toBe("drop");
    expect(cmd.args.handle).toBe(4);
  });

  it("keeps an item of unknown value", () => {
    const ctx = makeCtx({ player: { depth: 10 } }, {
      inventory: [item({ handle: 4, tval: TV.SWORD, sval: 1 })], // no value field
    }, { CDEPTH: 10, CURHP: 40, MAXCLEVEL: 30 });
    expect(borgCrushJunk(ctx)).toBeNull();
  });
});
