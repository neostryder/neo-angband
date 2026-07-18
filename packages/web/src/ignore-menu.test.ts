/**
 * Tests for the per-item ignore menu (ui-object.c:1701-1837
 * textui_cmd_ignore_menu). buildIgnoreItemMenu is asserted against the exact
 * upstream labels and row order for representative items; applyIgnoreItemChoice
 * against the resulting ignore-engine mutation (obj-ignore.c:1801-1818);
 * ignoreItemMenuCtx against the row guards, including the jewelry special-case
 * (ui-object.c:1774-1777).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loc,
  Rng,
  Chunk,
  FeatureRegistry,
  bindPlayer,
  blankPlayer,
  newGear,
  newKnownMap,
  newTargetState,
  IgnoreSettings,
  makeRuneEnv,
  DEFAULT_GAME_CONSTANTS,
  placePlayer,
  ObjRegistry,
  objectNew,
  OBJ_NOTICE,
  IGNORE,
  ITYPE,
  TV,
} from "@neo-angband/core";
import type {
  GameState,
  GameObject,
  ObjectKind,
  EgoItem,
  ObjPackJson,
  TerrainRecordJson,
  PlayerPackRecords,
} from "@neo-angband/core";
import {
  buildIgnoreItemMenu,
  applyIgnoreItemChoice,
  ignoreItemMenuCtx,
  IGNORE_ACTION,
} from "./ignore-menu";
import type { IgnoreItemMenuCtx, IgnoreMenuGame } from "./ignore-menu";

/* ------------------------------------------------------------------ */
/* Content-pack registry + a minimal real GameState (as screens.test). */
/* ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const featureReg = new FeatureRegistry(loadRecords<TerrainRecordJson>("terrain"));
const FLOOR = featureReg.byCodeName("FLOOR").fidx;
const GRANITE = featureReg.byCodeName("GRANITE").fidx;

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
} as PlayerPackRecords);

const objReg = new ObjRegistry({
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson);

function openField(w: number, h: number) {
  const c = new Chunk(featureReg, h, w);
  c.fill(GRANITE);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) c.setFeat(loc(x, y), FLOOR);
  }
  return c;
}

function makeTestState(): GameState {
  const w = 20;
  const h = 20;
  const chunk = openField(w, h);
  const player = blankPlayer(players.races[0]!, players.classes[0]!, players.bodies[0]!);
  const gear = newGear();
  const rng = new Rng(1);
  const actor = {
    player,
    grid: loc(5, 5),
    energy: 0,
    speed: 110,
    totalEnergy: 0,
    combat: {
      toH: 0, toD: 0, ac: 0, toA: 0, skills: [],
      numBlows: 1, ammoMult: 1, numShots: 0, ammoTval: 0, blessWield: false,
    },
    defense: { ac: 0, toA: 0 },
    weapon: null,
    stealth: 0,
    light: 0,
    unlight: false,
  };
  const state = {
    rng,
    chunk,
    actor,
    gear,
    monsters: [null],
    groups: [null],
    floor: new Map(),
    traps: new Map(),
    known: newKnownMap(w, h),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    lore: new Map(),
    turn: 0,
    z: DEFAULT_GAME_CONSTANTS,
    brands: [null],
    slays: [null],
    runeEnv: makeRuneEnv(
      (slot: number) => gear.store.get(player.equipment[slot] ?? 0) ?? null,
      (v) => rng.randcalcVaries(v),
    ),
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: () => null,
  } as unknown as GameState;
  placePlayer(state, loc(5, 5));
  return state;
}

/** A plain object of a tval with neutral combat values (as ignore.test.ts). */
function neutral(tval: number): GameObject {
  const kind = objReg.kinds.find(
    (k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount,
  ) as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.toH = 0;
  obj.toD = 0;
  obj.toA = 0;
  return obj;
}

/** Awareness stub for applyIgnoreItemChoice / ignoreItemMenuCtx. */
const awareGame: IgnoreMenuGame = { flavor: { isAware: () => true } };

/* ================================================================== */
/* buildIgnoreItemMenu - exact labels + order (ui-object.c:1724-1784). */
/* ================================================================== */

describe("buildIgnoreItemMenu (ui-object.c:1724-1784)", () => {
  it("plain item (no flavour/ego/quality rows) offers only the basic option", () => {
    const ctx: IgnoreItemMenuCtx = { itemIgnored: false };
    expect(buildIgnoreItemMenu(ctx)).toEqual([
      { label: "This item only", action: IGNORE_ACTION.ITEM },
    ]);
  });

  it("already-ignored item shows the Unignore variant", () => {
    const ctx: IgnoreItemMenuCtx = { itemIgnored: true };
    expect(buildIgnoreItemMenu(ctx)).toEqual([
      { label: "Unignore this item", action: IGNORE_ACTION.UNIGNORE_ITEM },
    ]);
  });

  it("aware flavour row wraps the base name as 'All %s' (ui-object.c:1744)", () => {
    const ctx: IgnoreItemMenuCtx = {
      itemIgnored: false,
      flavor: { label: "Potions of Cure Light Wounds", ignored: false },
    };
    expect(buildIgnoreItemMenu(ctx)).toEqual([
      { label: "This item only", action: IGNORE_ACTION.ITEM },
      { label: "All Potions of Cure Light Wounds", action: IGNORE_ACTION.FLAVOR },
    ]);
  });

  it("ignored flavour row wraps as 'Unignore all %s' (ui-object.c:1747)", () => {
    const ctx: IgnoreItemMenuCtx = {
      itemIgnored: false,
      flavor: { label: "Potions of Cure Light Wounds", ignored: true },
    };
    expect(buildIgnoreItemMenu(ctx)[1]).toEqual({
      label: "Unignore all Potions of Cure Light Wounds",
      action: IGNORE_ACTION.UNIGNORE_FLAVOR,
    });
  });

  it("ego row wraps the type+ego name as 'All %s' (ui-object.c:1765)", () => {
    const ctx: IgnoreItemMenuCtx = {
      itemIgnored: false,
      ego: { name: "Sharp Melee Weapons of Slaying", ignored: false },
    };
    expect(buildIgnoreItemMenu(ctx)).toEqual([
      { label: "This item only", action: IGNORE_ACTION.ITEM },
      { label: "All Sharp Melee Weapons of Slaying", action: IGNORE_ACTION.EGO },
    ]);
  });

  it("ignored ego row wraps as 'Unignore all %s' (ui-object.c:1768)", () => {
    const ctx: IgnoreItemMenuCtx = {
      itemIgnored: false,
      ego: { name: "Sharp Melee Weapons of Slaying", ignored: true },
    };
    expect(buildIgnoreItemMenu(ctx)[1]).toEqual({
      label: "Unignore all Sharp Melee Weapons of Slaying",
      action: IGNORE_ACTION.UNIGNORE_EGO,
    });
  });

  it("quality-tiered weapon row is 'All <tier> <type>' (ui-object.c:1780)", () => {
    const ctx: IgnoreItemMenuCtx = {
      itemIgnored: false,
      quality: { tierName: "average", typeName: "Sharp Melee Weapons" },
    };
    expect(buildIgnoreItemMenu(ctx)).toEqual([
      { label: "This item only", action: IGNORE_ACTION.ITEM },
      { label: "All average Sharp Melee Weapons", action: IGNORE_ACTION.QUALITY },
    ]);
  });

  it("emits basic, flavour, ego, quality strictly in that order", () => {
    const ctx: IgnoreItemMenuCtx = {
      itemIgnored: false,
      flavor: { label: "Rings", ignored: false },
      ego: { name: "Rings of Power", ignored: false },
      quality: { tierName: "bad", typeName: "Rings" },
    };
    expect(buildIgnoreItemMenu(ctx).map((e) => e.action)).toEqual([
      IGNORE_ACTION.ITEM,
      IGNORE_ACTION.FLAVOR,
      IGNORE_ACTION.EGO,
      IGNORE_ACTION.QUALITY,
    ]);
  });
});

/* ================================================================== */
/* applyIgnoreItemChoice - the ignore-engine mutation (obj-ignore.c).  */
/* ================================================================== */

describe("applyIgnoreItemChoice (ui-object.c:1801-1818)", () => {
  it("This item only / Unignore this item flip OBJ_NOTICE_IGNORE", () => {
    const state = makeTestState();
    const obj = neutral(TV.SWORD);

    applyIgnoreItemChoice(IGNORE_ACTION.ITEM, obj, state, awareGame);
    expect(obj.notice & OBJ_NOTICE.IGNORE).toBe(OBJ_NOTICE.IGNORE);

    applyIgnoreItemChoice(IGNORE_ACTION.UNIGNORE_ITEM, obj, state, awareGame);
    expect(obj.notice & OBJ_NOTICE.IGNORE).toBe(0);
  });

  it("All <flavour> sets the aware kind bit when flavour-aware (obj-ignore.c:370)", () => {
    const state = makeTestState();
    const obj = neutral(TV.POTION);

    applyIgnoreItemChoice(IGNORE_ACTION.FLAVOR, obj, state, awareGame);
    expect(state.ignore.kindIsIgnoredAware(obj.kind.kidx)).toBe(true);
    expect(state.ignore.kindIsIgnoredUnaware(obj.kind.kidx)).toBe(false);

    applyIgnoreItemChoice(IGNORE_ACTION.UNIGNORE_FLAVOR, obj, state, awareGame);
    expect(state.ignore.kindIsIgnoredAware(obj.kind.kidx)).toBe(false);
  });

  it("All <flavour> sets the unaware kind bit when unaware", () => {
    const state = makeTestState();
    const obj = neutral(TV.POTION);
    const unawareGame: IgnoreMenuGame = { flavor: { isAware: () => false } };

    applyIgnoreItemChoice(IGNORE_ACTION.FLAVOR, obj, state, unawareGame);
    expect(state.ignore.kindIsIgnoredUnaware(obj.kind.kidx)).toBe(true);
    expect(state.ignore.kindIsIgnoredAware(obj.kind.kidx)).toBe(false);
  });

  it("All <ego> toggles the ego+type on, Unignore toggles it off (obj-ignore.c:525/532)", () => {
    const state = makeTestState();
    const obj = neutral(TV.SWORD);
    obj.ego = { eidx: 3, name: "of Slaying" } as EgoItem;

    applyIgnoreItemChoice(IGNORE_ACTION.EGO, obj, state, awareGame);
    expect(state.ignore.egoIsIgnored(3, ITYPE.SHARP)).toBe(true);

    applyIgnoreItemChoice(IGNORE_ACTION.UNIGNORE_EGO, obj, state, awareGame);
    expect(state.ignore.egoIsIgnored(3, ITYPE.SHARP)).toBe(false);
  });

  it("All <quality> <type> sets ignore_level[type] to the object's tier (ui-object.c:1817)", () => {
    const state = makeTestState();
    const bad = neutral(TV.SWORD);
    bad.toD = -3; /* ignore_level_of -> IGNORE_BAD */

    applyIgnoreItemChoice(IGNORE_ACTION.QUALITY, bad, state, awareGame);
    expect(state.ignore.level[ITYPE.SHARP]).toBe(IGNORE.BAD);
  });
});

/* ================================================================== */
/* ignoreItemMenuCtx - the per-row guards on real objects.            */
/* ================================================================== */

describe("ignoreItemMenuCtx (ui-object.c:1724-1784 guards)", () => {
  it("a neutral sword has no flavour row, an average quality row, no ego row", () => {
    const state = makeTestState();
    const ctx = ignoreItemMenuCtx(neutral(TV.SWORD), state, awareGame);
    expect(ctx.itemIgnored).toBe(false);
    expect(ctx.flavor).toBeUndefined(); /* SWORD is not an sval-ignore tval */
    expect(ctx.ego).toBeUndefined();
    expect(ctx.quality).toEqual({
      tierName: "average",
      typeName: "Sharp Melee Weapons",
    });
  });

  it("an ego sword adds the ego row named '<type> <ego name>' (ui-object.c:1763)", () => {
    const state = makeTestState();
    const obj = neutral(TV.SWORD);
    obj.ego = { eidx: 3, name: "of Slaying" } as EgoItem;
    const ctx = ignoreItemMenuCtx(obj, state, awareGame);
    expect(ctx.ego).toEqual({
      name: "Sharp Melee Weapons of Slaying",
      ignored: false,
    });
    /* An ego is graded IGNORE_ALL -> the quality row reads 'non-artifact'. */
    expect(ctx.quality).toEqual({
      tierName: "non-artifact",
      typeName: "Sharp Melee Weapons",
    });
  });

  it("jewelry special-case: an average ring gets NO quality row (ui-object.c:1776)", () => {
    const state = makeTestState();
    const ring = neutral(TV.RING); /* ignore_level_of -> AVERAGE (!= BAD) */
    const ctx = ignoreItemMenuCtx(ring, state, awareGame);
    /* RING is an sval-ignore tval, so the flavour row is present... */
    expect(ctx.flavor).toBeDefined();
    /* ...but AVERAGE != BAD forces value = IGNORE_MAX, dropping the quality row. */
    expect(ctx.quality).toBeUndefined();
  });

  it("jewelry special-case: a bad ring keeps a 'bad Rings' quality row", () => {
    const state = makeTestState();
    const ring = neutral(TV.RING);
    ring.toA = -1; /* ignore_level_of -> BAD */
    const ctx = ignoreItemMenuCtx(ring, state, awareGame);
    expect(ctx.quality).toEqual({ tierName: "bad", typeName: "Rings" });
  });

  it("reports itemIgnored from OBJ_NOTICE_IGNORE (ui-object.c:1728)", () => {
    const state = makeTestState();
    const obj = neutral(TV.SWORD);
    obj.notice |= OBJ_NOTICE.IGNORE;
    expect(ignoreItemMenuCtx(obj, state, awareGame).itemIgnored).toBe(true);
    expect(buildIgnoreItemMenu(ignoreItemMenuCtx(obj, state, awareGame))[0]).toEqual({
      label: "Unignore this item",
      action: IGNORE_ACTION.UNIGNORE_ITEM,
    });
  });
});
