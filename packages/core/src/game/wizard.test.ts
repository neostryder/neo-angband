import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { EF, KF, SQUARE, TMD, TV } from "../generated/index.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { loc } from "../loc.js";
import {
  EffectRegistry,
} from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { bindTraps } from "../world/trap.js";
import type { TrapRecordJson } from "../world/trap.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { ArtifactState, ObjAllocState } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { FlavorKnowledge } from "../obj/knowledge.js";
import { MonAllocTable } from "../mon/make.js";
import { getLore } from "../mon/lore.js";
import type { ExpDeps } from "../player/exp.js";
import { basicPlayerActor } from "./project-cast.js";
import type { CastContext } from "./project-cast.js";
import { registerGeneralHandlers } from "./effect-general.js";
import { registerTeleportHandlers } from "./effect-teleport.js";
import { registerTerrainHandlers } from "./effect-terrain.js";
import { registerSummonHandlers } from "./effect-summon.js";
import { registerDetectHandlers } from "./effect-detect.js";
import { registerAttackHandlers } from "./effect-attack.js";
import { registerMonsterHandlers } from "./effect-monster.js";
import { registerItemHandlers } from "./effect-item.js";
import type { EffectEnvDeps } from "./effect-env.js";
import type { MonPlaceDeps } from "./mon-place.js";
import type { TrapDeps } from "./trap.js";
import { squareTrap } from "./trap.js";
import { floorCarry, floorPile } from "./floor.js";
import { gearAdd } from "./gear.js";
import { knownObject, squareIsKnown } from "./known.js";
import { updateMonsterDistances } from "./context.js";
import type { GameState } from "./context.js";
import { FLOOR, GRANITE, addMon, makeRace, makeState, monReg, plReg } from "./harness.js";
import {
  NOSCORE,
  NOSCORE_SCORE_INVALIDATING,
  markNoscore,
  noscoreInvalidatesScore,
  wizAcquire,
  wizAdvance,
  wizBanish,
  wizChangeItemQuantity,
  wizCheatDeath,
  wizCreateObj,
  wizCreateTrap,
  wizCureAll,
  wizCurseItem,
  wizDetectAllMonsters,
  wizDisplayItem,
  wizEditPlayerExp,
  wizEditPlayerGold,
  wizEditPlayerStart,
  wizEditPlayerStat,
  wizJumpLevel,
  wizLearnObjectKinds,
  wizMagicMap,
  wizPeekFlow,
  wizPlayItemAccept,
  wizPlayItemBegin,
  wizPlayItemReject,
  wizQueryFeature,
  wizQuerySquareFlag,
  wizRecallMonster,
  wizRerate,
  wizRerollItem,
  wizStatItem,
  wizSummonNamed,
  wizTeleportRandom,
  wizWipeRecall,
  wizWizardLight,
} from "./wizard.js";
import type { WizardDeps, WizEffectDeps } from "./wizard.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const projections = bindProjections(
  (loadJson("projection") as { records: ProjectionRecordJson[] }).records,
);
const trapKinds = bindTraps(
  (loadJson("trap") as { records: TrapRecordJson[] }).records,
);
const objPack: ObjPackJson = {
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
} as ObjPackJson;
const objReg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));

const makeDeps: MakeDeps = {
  reg: objReg,
  alloc: new ObjAllocState(objReg, constants),
  constants,
  artifacts: new ArtifactState(objReg.artifacts.length),
  noArtifacts: false,
};

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerAttackHandlers(r);
  registerMonsterHandlers(r);
  registerTeleportHandlers(r);
  registerGeneralHandlers(r);
  registerTerrainHandlers(r);
  registerItemHandlers(r);
  registerSummonHandlers(r);
  registerDetectHandlers(r);
  return r;
}

function effectDeps(state: GameState): WizEffectDeps {
  const cast: CastContext = {
    projections,
    maxRange: 20,
    playerActor: basicPlayerActor(state),
  };
  const envDeps: EffectEnvDeps = { timedTable: plReg.timed };
  const item = { reg: objReg, makeDeps };
  return { registry: registry(), cast, envDeps, item };
}

function expDeps(state: GameState): ExpDeps {
  return { rng: state.rng };
}

function monPlace(): MonPlaceDeps {
  return { table: new MonAllocTable(monReg.races, { maxDepth: 128 }) };
}

function trapDeps(): TrapDeps {
  return { kinds: trapKinds };
}

/**
 * A full wizard deps bundle for `state`; toggle the gate with `gate`. Both flags
 * move together here so the pre-existing gate assertions keep their meaning; the
 * "debug consent and wizard mode are separate gates" describe block below drives
 * them independently, which is what proves the split.
 */
function wizDeps(
  state: GameState,
  gate: boolean,
  msgs?: string[],
): WizardDeps {
  return {
    wizard: gate,
    debug: gate,
    makeDeps,
    expDeps: expDeps(state),
    effect: effectDeps(state),
    trapDeps: trapDeps(),
    monPlace: monPlace(),
    flavor: new FlavorKnowledge(objReg.ordinaryKindCount),
    races: monReg.races,
    artifacts: objReg.artifacts,
    curses: objReg.curses,
    ...(msgs ? { msg: (t: string) => msgs.push(t) } : {}),
  };
}

/** An ordinary (non instant-artifact) kind index of the given tval. */
function ordinaryKindIndex(tval: number): number {
  const idx = objReg.kinds.findIndex(
    (k) =>
      k.tval === tval &&
      k.kidx < objReg.ordinaryKindCount &&
      !k.kindFlags.has(KF.INSTA_ART),
  );
  if (idx < 0) throw new Error(`no ordinary kind for tval ${tval}`);
  return idx;
}

describe("the debug-consent gate (player_can_debug_prereq, player-util.c L1296)", () => {
  it("blocks a call without debug consent: no object is created", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ind = ordinaryKindIndex(TV.FOOD);
    const ran = wizCreateObj(state, { index: ind }, wizDeps(state, false));
    expect(ran).toBe(false);
    expect(floorPile(state, loc(10, 10)).length).toBe(0);
  });

  it("permits the same call once debug consent is given", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ind = ordinaryKindIndex(TV.FOOD);
    const ran = wizCreateObj(state, { index: ind }, wizDeps(state, true));
    expect(ran).toBe(true);
    const pile = floorPile(state, loc(10, 10));
    expect(pile.length).toBe(1);
    expect(pile[0]!.kind).toBe(objReg.kinds[ind]);
  });

  it("gates the map-query data commands too", () => {
    const state = makeState();
    expect(
      wizQueryFeature(state, { features: [FLOOR] }, wizDeps(state, false)),
    ).toEqual([]);
  });
});

describe("do_cmd_wiz_create_obj (cmd-wizard.c L873)", () => {
  it("drops the requested kind on the floor near the player", () => {
    const state = makeState({ playerGrid: loc(8, 8) });
    const ind = ordinaryKindIndex(TV.POTION);
    wizCreateObj(state, { index: ind }, wizDeps(state, true));
    const pile = floorPile(state, loc(8, 8));
    expect(pile.length).toBe(1);
    expect(pile[0]!.tval).toBe(TV.POTION);
  });

  it("refuses an out-of-range index", () => {
    const state = makeState();
    const msgs: string[] = [];
    const ran = wizCreateObj(
      state,
      { index: 999999 },
      wizDeps(state, true, msgs),
    );
    expect(ran).toBe(false);
    expect(msgs).toContain("That's not a valid kind of object.");
  });
});

describe("do_cmd_wiz_advance (L414)", () => {
  it("maxes stats, level, gold and restores HP/SP", () => {
    const state = makeState();
    const p = state.actor.player;
    p.chp = 1;
    p.csp = 0;
    p.msp = 20;
    wizAdvance(state, wizDeps(state, true));
    for (let i = 0; i < p.statMax.length; i++) {
      expect(p.statMax[i]).toBe(118);
      expect(p.statCur[i]).toBe(118);
    }
    expect(p.au).toBe(1000000);
    expect(p.lev).toBe(50);
    expect(p.chp).toBe(p.mhp);
    expect(p.csp).toBe(p.msp);
  });
});

describe("do_cmd_wiz_cure_all (L941)", () => {
  it("clears the affliction timers", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.POISONED] = 10;
    p.timed[TMD.CONFUSED] = 5;
    p.chp = 1;
    const ran = wizCureAll(state, wizDeps(state, true));
    expect(ran).toBe(true);
    expect(p.timed[TMD.POISONED]).toBe(0);
    expect(p.timed[TMD.CONFUSED]).toBe(0);
    expect(p.chp).toBe(p.mhp);
  });
});

describe("do_cmd_wiz_banish (L449)", () => {
  it("deletes monsters within range and spares distant ones", () => {
    const state = makeState({ playerGrid: loc(20, 12), w: 60 });
    const near = addMon(state, makeRace(), loc(22, 12));
    const far = addMon(state, makeRace(), loc(50, 12));
    updateMonsterDistances(state);
    wizBanish(state, { range: 5 }, wizDeps(state, true));
    expect(state.monsters[near.midx]).toBeNull();
    expect(state.monsters[far.midx]).not.toBeNull();
  });
});

describe("do_cmd_wiz_acquire (L389)", () => {
  it("drops the requested number of objects near the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 5;
    wizAcquire(state, { quantity: 3, great: true }, wizDeps(state, true));
    /* The acquired objects land on or around the player's grid. */
    let total = 0;
    for (const pile of state.floor.values()) total += pile.length;
    expect(total).toBe(3);
  });
});

describe("do_cmd_wiz_curse_item (L1004)", () => {
  it("adds a curse and then removes it", () => {
    const state = makeState();
    const kind = objReg.kinds.find(
      (k) => k.tval === TV.SWORD && k.kidx < objReg.ordinaryKindCount,
    )!;
    const obj = objectPrep(state.rng, objReg, constants, kind, 5, "average");
    const deps = wizDeps(state, true);
    /* Pick any real curse index. */
    const curseIdx = objReg.curses.findIndex((c) => c !== null && c !== undefined);
    const added = wizCurseItem(
      state,
      { obj, index: curseIdx, power: 40 },
      deps,
    );
    expect(added).toBe(true);
    expect(obj.curses?.[curseIdx]?.power).toBe(40);
    const removed = wizCurseItem(
      state,
      { obj, index: curseIdx, power: 0 },
      deps,
    );
    expect(removed).toBe(true);
  });
});

describe("do_cmd_wiz_change_item_quantity (cmd-wizard.c L484)", () => {
  /** An ordinary wand (charge-carrying, stackable) prepped at depth 5. */
  function wand(state: GameState): GameObject {
    const kind = objReg.kinds.find(
      (k) => k.tval === TV.WAND && k.kidx < objReg.ordinaryKindCount,
    )!;
    return objectPrep(state.rng, objReg, constants, kind, 5, "average");
  }

  it("sets the number and scales charges by integer division (L523-527)", () => {
    const state = makeState();
    const obj = wand(state);
    obj.number = 2;
    obj.pval = 7;
    const res = wizChangeItemQuantity(
      state,
      { obj, quantity: 5 },
      wizDeps(state, true),
    );
    expect(res).not.toBeNull();
    expect(obj.number).toBe(5);
    /* (7 * 5) / 2 == 17 after truncation, NOT 17.5 and not a per-item rescale. */
    expect(obj.pval).toBe(17);
  });

  it("clamps to [1, max_stack] (L520)", () => {
    const state = makeState();
    const obj = wand(state);
    obj.pval = 0; /* no charge ceiling, so max_stack is the only bound */
    const max = obj.kind.base.maxStack;
    expect(
      wizChangeItemQuantity(state, { obj, quantity: 9999 }, wizDeps(state, true))
        ?.number,
    ).toBe(max);
    expect(
      wizChangeItemQuantity(state, { obj, quantity: -4 }, wizDeps(state, true))
        ?.number,
    ).toBe(1);
  });

  it("caps the count so scaled charges cannot exceed MAX_PVAL (L507-511)", () => {
    const state = makeState();
    const obj = wand(state);
    obj.number = 1;
    obj.pval = 1000;
    /* nmax = MIN((32767 * 1) / 1000, max_stack) = MIN(32, max_stack). */
    const expected = Math.min(32, obj.kind.base.maxStack);
    const res = wizChangeItemQuantity(
      state,
      { obj, quantity: 9999 },
      wizDeps(state, true),
    );
    expect(res?.max).toBe(expected);
    expect(obj.number).toBe(expected);
  });

  it("refuses an artifact with upstream's message (L499-503)", () => {
    const state = makeState();
    const msgs: string[] = [];
    const obj = wand(state);
    obj.artifact = objReg.artifacts.find((a) => a) ?? null;
    obj.number = 1;
    expect(
      wizChangeItemQuantity(state, { obj, quantity: 4 }, wizDeps(state, true, msgs)),
    ).toBeNull();
    expect(obj.number).toBe(1);
    expect(msgs).toContain("Can not modify the quantity of an artifact.");
  });

  it("leaves an unchanged count entirely alone, charges included (L522)", () => {
    const state = makeState();
    const obj = wand(state);
    obj.number = 3;
    obj.pval = 5;
    const res = wizChangeItemQuantity(
      state,
      { obj, quantity: 3 },
      wizDeps(state, true),
    );
    expect(res?.changed).toBe(false);
    expect(obj.pval).toBe(5);
  });

  it("is a no-op outside wizard mode", () => {
    const state = makeState();
    const obj = wand(state);
    obj.number = 1;
    expect(
      wizChangeItemQuantity(state, { obj, quantity: 6 }, wizDeps(state, false)),
    ).toBeNull();
    expect(obj.number).toBe(1);
  });

  it("refuses a supplied equipped-item handle with upstream's message (L494-497)", () => {
    const state = makeState();
    const msgs: string[] = [];
    const obj = wand(state);
    obj.number = 1;
    const handle = gearAdd(state.gear, obj);
    state.actor.player.equipment[0] = handle;
    expect(
      wizChangeItemQuantity(
        state,
        { obj, handle, quantity: 4 },
        wizDeps(state, true, msgs),
      ),
    ).toBeNull();
    expect(obj.number).toBe(1);
    expect(msgs).toContain("Can not change the quantity of an equipped item.");
  });
});

describe("do_cmd_wiz_edit_player_* (L1137 / L1169 / L1247)", () => {
  it("sets exp, gold and a stat within their bounds", () => {
    const state = makeState();
    const p = state.actor.player;
    wizEditPlayerGold(state, { value: -50 }, wizDeps(state, true));
    expect(p.au).toBe(0);
    wizEditPlayerGold(state, { value: 12345 }, wizDeps(state, true));
    expect(p.au).toBe(12345);
    wizEditPlayerStat(state, { stat: 0, value: 200 }, wizDeps(state, true));
    expect(p.statMax[0]).toBe(118);
    wizEditPlayerStat(state, { stat: 0, value: 1 }, wizDeps(state, true));
    expect(p.statMax[0]).toBe(3);
    wizEditPlayerExp(state, { value: 5000 }, wizDeps(state, true));
    expect(p.exp).toBe(5000);
  });
});

describe("do_cmd_wiz_learn_object_kinds (L1386)", () => {
  it("makes the player aware of low-level kinds", () => {
    const state = makeState();
    const flavor = new FlavorKnowledge(objReg.ordinaryKindCount);
    const deps: WizardDeps = { ...wizDeps(state, true), flavor };
    wizLearnObjectKinds(state, { level: 100 }, deps);
    const kind = objReg.kinds.find(
      (k) => k.name && k.level <= 100 && k.kidx < objReg.ordinaryKindCount,
    )!;
    expect(flavor.isAware(kind)).toBe(true);
  });
});

describe("do_cmd_wiz_recall_monster / wipe_recall (L2161 / L2860)", () => {
  it("learns then forgets a race's lore", () => {
    const state = makeState();
    const race = makeRace();
    const deps = wizDeps(state, true);
    wizRecallMonster(state, { race }, deps);
    const lore = getLore(state.lore, race);
    expect(lore.allKnown).toBe(true);
    wizWipeRecall(state, { race }, deps);
    expect(getLore(state.lore, race).allKnown).toBe(false);
  });
});

describe("do_cmd_wiz_summon_named (L2569)", () => {
  it("places the named race next to the player", () => {
    const state = makeState({ playerGrid: loc(15, 12), w: 40 });
    const race = { ...makeRace(), friends: [] };
    const before = state.monsters.filter((m) => m !== null).length;
    const ran = wizSummonNamed(state, { race }, wizDeps(state, true));
    expect(ran).toBe(true);
    const after = state.monsters.filter((m) => m !== null).length;
    expect(after).toBe(before + 1);
  });
});

describe("do_cmd_wiz_create_trap (L904)", () => {
  it("places a trap under the player in the dungeon", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 5;
    const validIdx = trapKinds.findIndex((t, i) => i > 0 && t && t.name);
    const ran = wizCreateTrap(state, { index: validIdx }, wizDeps(state, true));
    expect(ran).toBe(true);
    expect(squareTrap(state, loc(10, 10)).length).toBe(1);
  });

  it("refuses to place a trap in town", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    const msgs: string[] = [];
    const validIdx = trapKinds.findIndex((t, i) => i > 0 && t && t.name);
    const ran = wizCreateTrap(
      state,
      { index: validIdx },
      wizDeps(state, true, msgs),
    );
    expect(ran).toBe(false);
    expect(msgs).toContain("You can't place a trap in the town!");
  });
});

describe("effect-backed wizard commands", () => {
  it("wizTeleportRandom moves the player (EF_TELEPORT)", () => {
    const state = makeState({ playerGrid: loc(20, 12), w: 60, h: 25 });
    const from = { ...state.actor.grid };
    const ran = wizTeleportRandom(state, { range: 100 }, wizDeps(state, true));
    expect(ran).toBe(true);
    expect(state.actor.grid).not.toEqual(from);
  });

  it("wizMagicMap runs (EF_MAP_AREA)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ran = wizMagicMap(state, wizDeps(state, true));
    expect(ran).toBe(true);
  });

  it("wizDetectAllMonsters marks monsters (EF_DETECT_*)", () => {
    const state = makeState({ playerGrid: loc(10, 10), w: 40 });
    addMon(state, makeRace(), loc(14, 10));
    const ran = wizDetectAllMonsters(state, wizDeps(state, true));
    expect(ran).toBe(true);
  });
});

describe("do_cmd_wiz_wizard_light (L2907)", () => {
  it("lights the level and memorizes only its non-floor terrain", () => {
    /*
     * wiz_light(cave, player, true) (cmd-wizard.c:2909). Every non-wall grid is
     * perma-lit, but a neighbour is MEMORIZED only when
     * `!square_isfloor(a_grid) || square_isvisibletrap(a_grid)`
     * (cave-map.c:439-440), so open floor stays unremembered - it is the walls
     * bounding the lit area that get mapped.
     */
    const state = makeState({ playerGrid: loc(10, 10) });
    wizWizardLight(state, wizDeps(state, true));
    expect(state.chunk.sqinfoHas(loc(10, 10), SQUARE.GLOW)).toBe(true);
    /* Open floor away from any wall: lit, not remembered. */
    expect(squareIsKnown(state, loc(10, 10))).toBe(false);
    /* The granite border neighbouring the field: remembered. */
    expect(state.chunk.isFloor(loc(0, 10))).toBe(false);
    expect(squareIsKnown(state, loc(0, 10))).toBe(true);
  });

  it("is the `full` form: square_know_pile, not sense_pile (cmd-wizard.c:2909)", () => {
    /* wiz_light(cave, player, true): `full` is TRUE for the wizard command, so
     * the floor piles are KNOWN (the real glyph) rather than merely SENSED (the
     * "something is here" null-glyph marker, cave-map.c:445-452). */
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    const potion = objectPrep(
      state.rng,
      objReg,
      constants,
      objReg.kinds.find((k) => k && k.tval === TV.POTION)!,
      0,
      "average",
    );
    potion.number = 1;
    expect(floorCarry(state, grid, potion)).toBe(true);
    wizWizardLight(state, wizDeps(state, true));
    expect(knownObject(state, grid)?.ch).not.toBeNull();
  });
});

describe("do_cmd_wiz_rerate (L2209)", () => {
  it("rerolls the hp table and reports a life rating in range", () => {
    const state = makeState();
    state.actor.player.hitdie = 10;
    const rating = wizRerate(state, wizDeps(state, true));
    expect(rating).not.toBeNull();
    /* The rerate band (min/max_value) maps to a life rating in roughly
     * [87, 133] for hitdie 10 (top * 200 / (hitdie * PY_MAX_LEVEL)). */
    expect(rating!).toBeGreaterThanOrEqual(80);
    expect(rating!).toBeLessThanOrEqual(140);
  });
});

describe("do_cmd_wiz_reroll_item (L2254)", () => {
  it("rerolls a non-artifact item in place", () => {
    const state = makeState();
    const kind = objReg.kinds.find(
      (k) => k.tval === TV.SWORD && k.kidx < objReg.ordinaryKindCount,
    )!;
    const obj: GameObject = objectPrep(
      state.rng,
      objReg,
      constants,
      kind,
      1,
      "average",
    );
    const ran = wizRerollItem(state, { obj, roll: 2 }, wizDeps(state, true));
    expect(ran).toBe(true);
    expect(obj.kind).toBe(kind);
  });
});

describe("map-query DATA commands", () => {
  it("wizQueryFeature returns the floor grids", () => {
    const state = makeState({ w: 20, h: 15 });
    const grids = wizQueryFeature(
      state,
      { features: [FLOOR] },
      wizDeps(state, true),
    );
    /* The open field is floor inside its granite border. */
    expect(grids.length).toBe((20 - 2) * (15 - 2));
  });

  it("wizQuerySquareFlag(flag=0) returns known grids", () => {
    const state = makeState({ w: 20, h: 15 });
    /* Nothing known yet. */
    expect(
      wizQuerySquareFlag(state, { flag: 0 }, wizDeps(state, true)).length,
    ).toBe(0);
    /*
     * wiz_light memorizes only non-floor neighbours (cave-map.c:439-440), and
     * wiz_hack_map scans square_in_bounds_fully grids only (cmd-wizard.c:333) -
     * the same 1..h-2 range - so an open field has NOTHING to report. Put a
     * granite pillar inside the field and it is the pillar that is known.
     */
    state.chunk.setFeat(loc(5, 5), GRANITE);
    wizWizardLight(state, wizDeps(state, true));
    const known = wizQuerySquareFlag(state, { flag: 0 }, wizDeps(state, true));
    expect(known.length).toBeGreaterThan(0);
    expect(known.some((g) => g.x === 5 && g.y === 5)).toBe(true);
    expect(known.some((g) => g.x === 12 && g.y === 8)).toBe(false);
  });

  it("wizPeekFlow returns grids at a noise depth", () => {
    const state = makeState({ w: 20, h: 15 });
    state.chunk.noise[12 * state.chunk.width + 10] = 3;
    const grids = wizPeekFlow(
      state,
      { depth: 3, which: "noise" },
      wizDeps(state, true),
    );
    expect(grids).toContainEqual({ x: 10, y: 12 });
  });

});

/** A prepped, average non-artifact sword for the item-shell tests. */
function makeSword(state: GameState): GameObject {
  const kind = objReg.kinds.find(
    (k) => k.tval === TV.SWORD && k.kidx < objReg.ordinaryKindCount,
  )!;
  return objectPrep(state.rng, objReg, constants, kind, 5, "average");
}

describe("wiz_display_item DATA half (cmd-wizard.c L190)", () => {
  it("returns the scalar item facts the debug panel prints", () => {
    const state = makeState();
    const obj = makeSword(state);
    const disp = wizDisplayItem(obj, wizDeps(state, true), { all: true });
    expect(disp).not.toBeNull();
    expect(disp!.dd).toBe(obj.dd);
    expect(disp!.ds).toBe(obj.ds);
    expect(disp!.kidx).toBe(obj.kind.kidx);
    expect(disp!.tval).toBe(obj.tval);
    expect(disp!.sval).toBe(obj.sval);
    expect(disp!.number).toBe(obj.number);
    /* No artifact / ego on a plain sword: name1 == 0, egoidx == -1. */
    expect(disp!.name1).toBe(0);
    expect(disp!.egoidx).toBe(-1);
  });

  it("is gated: no wizard mode returns null", () => {
    const state = makeState();
    const obj = makeSword(state);
    expect(wizDisplayItem(obj, wizDeps(state, false))).toBeNull();
  });
});

describe("do_cmd_wiz_play_item begin / reject / accept (cmd-wizard.c L1642)", () => {
  it("reject restores the snapshotted item after an edit", () => {
    const state = makeState();
    const obj = makeSword(state);
    const deps = wizDeps(state, true);
    const original = wizPlayItemBegin(obj, deps)!;
    expect(original).not.toBeNull();
    obj.toH = 99;
    obj.toD = 88;
    wizPlayItemReject(obj, original, deps);
    expect(obj.toH).toBe(original.toH);
    expect(obj.toD).toBe(original.toD);
  });

  it("accept re-runs wield learning on a changed equipped item", () => {
    /* Upstream clears the WORN gate then re-runs object_learn_on_wield so the
     * edited properties are re-learned; the learn re-marks WORN. Starting
     * unworn, an accepted equipped edit therefore ends up WORN-marked. */
    const state = makeState();
    const obj = makeSword(state);
    expect(obj.notice & OBJ_NOTICE.WORN).toBe(0);
    const ran = wizPlayItemAccept(
      state,
      obj,
      { changed: true, equipped: true },
      wizDeps(state, true),
    );
    expect(ran).toBe(true);
    expect(obj.notice & OBJ_NOTICE.WORN).toBe(OBJ_NOTICE.WORN);
  });

  it("accept is a no-op when nothing changed", () => {
    const state = makeState();
    const obj = makeSword(state);
    const ran = wizPlayItemAccept(
      state,
      obj,
      { changed: false, equipped: true },
      wizDeps(state, true),
    );
    expect(ran).toBe(true);
    expect(obj.notice & OBJ_NOTICE.WORN).toBe(0);
  });
});

describe("do_cmd_wiz_stat_item (cmd-wizard.c L2386)", () => {
  it("classifies every same-tval roll as match/better/worse/other", () => {
    const state = makeState();
    const obj = makeSword(state);
    const res = wizStatItem(
      state,
      { obj, roll: 0, level: 1, nRolls: 300 },
      wizDeps(state, true),
    );
    expect(res).not.toBeNull();
    expect(res!.rolls).toBe(300);
    /* Only same-tval/sval rolls are bucketed; the buckets cannot exceed the
     * number of rolls performed. */
    const bucketed = res!.matches + res!.better + res!.worse + res!.other;
    expect(bucketed).toBeLessThanOrEqual(res!.rolls);
  });
});

describe("do_cmd_wiz_edit_player_start (cmd-wizard.c L1202)", () => {
  it("applies the batch stat / gold / exp edits with their clamps", () => {
    const state = makeState();
    const p = state.actor.player;
    wizEditPlayerStart(
      state,
      { stats: [200, undefined, 1], gold: 4242, exp: 1500 },
      wizDeps(state, true),
    );
    expect(p.statMax[0]).toBe(118); /* clamped high. */
    expect(p.statMax[2]).toBe(3); /* clamped low. */
    expect(p.au).toBe(4242);
    expect(p.exp).toBe(1500);
  });
});

describe("NOSCORE cheat-flag model (player.h L95-99, score.c L289)", () => {
  it("mirrors the upstream bit values exactly", () => {
    expect(NOSCORE.WIZARD).toBe(0x0002);
    expect(NOSCORE.DEBUG).toBe(0x0008);
    expect(NOSCORE.JUMPING).toBe(0x0010);
    expect(NOSCORE.BORG).toBe(0x0020);
    expect(NOSCORE_SCORE_INVALIDATING).toBe(
      NOSCORE.WIZARD | NOSCORE.DEBUG | NOSCORE.BORG,
    );
  });

  it("markNoscore ORs bits and masks to 16 bits", () => {
    expect(markNoscore(0, NOSCORE.WIZARD)).toBe(0x0002);
    expect(markNoscore(NOSCORE.WIZARD, NOSCORE.DEBUG)).toBe(0x000a);
    expect(markNoscore(0x1_0000, NOSCORE.BORG)).toBe(0x0020);
  });

  it("only WIZARD/DEBUG/BORG invalidate the score, not JUMPING", () => {
    expect(noscoreInvalidatesScore(NOSCORE.WIZARD)).toBe(true);
    expect(noscoreInvalidatesScore(NOSCORE.DEBUG)).toBe(true);
    expect(noscoreInvalidatesScore(NOSCORE.BORG)).toBe(true);
    expect(noscoreInvalidatesScore(NOSCORE.JUMPING)).toBe(false);
    expect(noscoreInvalidatesScore(0)).toBe(false);
  });

  it("wizJumpLevel marks NOSCORE_JUMPING only when a profile was asked for", () => {
    /* cmd-wizard.c:1360-1367: the bit is set inside `if (choose_gen)`, i.e. only
     * when "Choose cave profile? " was answered yes. It is not really a cheat
     * marker - choose_profile (generate.c:824) consumes it as the one-shot
     * signal to ask which profile to build - so setting it unconditionally, as
     * this used to, both mis-flags the savefile and would make every jump ask. */
    const plain = makeState();
    const plainBits: number[] = [];
    const ran = wizJumpLevel(plain, { level: 5 }, {
      ...wizDeps(plain, true),
      markNoscore: (b) => plainBits.push(b),
    });
    expect(ran).toBe(true);
    expect(plainBits).not.toContain(NOSCORE.JUMPING);

    const chosen = makeState();
    const chosenBits: number[] = [];
    wizJumpLevel(chosen, { level: 5, chooseGen: true }, {
      ...wizDeps(chosen, true),
      markNoscore: (b) => chosenBits.push(b),
    });
    expect(chosenBits).toContain(NOSCORE.JUMPING);
  });

  it("wizCheatDeath marks NOSCORE_WIZARD through the seam", () => {
    const state = makeState();
    state.isDead = true;
    const bits: number[] = [];
    const deps: WizardDeps = {
      ...wizDeps(state, true),
      markNoscore: (b) => bits.push(b),
    };
    const ran = wizCheatDeath(state, deps);
    expect(ran).toBe(true);
    expect(bits).toContain(NOSCORE.WIZARD);
    expect(state.isDead).toBe(false);
  });

  it("wizCheatDeath cancels a pending recall and deep descent, and says so", () => {
    /* wiz-debug.c L56-74. The port used to leave both counters running, so a
     * cheated death dropped you in town with a word of recall still ticking -
     * which would then fire and yank you back down. The census entry for
     * "The air around you stops swirling..." was sitting on that. */
    const state = makeState();
    state.isDead = true;
    const p = state.actor.player;
    p.wordRecall = 12;
    p.deepDescent = 3;
    const said: string[] = [];
    wizCheatDeath(state, { ...wizDeps(state, true), msg: (t) => said.push(t) });
    expect(p.wordRecall).toBe(0);
    expect(p.deepDescent).toBe(0);
    expect(said).toContain("A tension leaves the air around you...");
    expect(said).toContain("The air around you stops swirling...");
  });

  it("wizCheatDeath says nothing about recall when none is pending", () => {
    const state = makeState();
    state.isDead = true;
    state.actor.player.wordRecall = 0;
    state.actor.player.deepDescent = 0;
    const said: string[] = [];
    wizCheatDeath(state, { ...wizDeps(state, true), msg: (t) => said.push(t) });
    expect(said.join("|")).not.toContain("air around you");
  });
});

/**
 * The two gates are independent, which is the whole point of the split.
 *
 * player_can_debug_prereq (player-util.c L1296-1307) consults ONLY
 * `player->noscore & NOSCORE_DEBUG`, and all 41 rows of the cmd_debug_* tables
 * (ui-game.c L247-322) use it as their sole prereq. Nothing on that path reads
 * player->wizard. Conversely cheat death is gated on `player->wizard ||
 * OPT(player, cheat_live)` (player-util.c L246) and never on debug consent.
 *
 * The port collapsed both into one `wizard` boolean, so a non-wizard character
 * who accepted the debug warning got 41 commands that silently did nothing.
 * These cases drive the flags in opposition, so restoring the collapse fails.
 */
describe("debug consent and wizard mode are separate gates", () => {
  it("a debug command runs on debug consent alone, with wizard mode OFF", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.POISONED] = 10;
    p.chp = 1;
    const ran = wizCureAll(state, { ...wizDeps(state, true), wizard: false, debug: true });
    expect(ran).toBe(true);
    expect(p.timed[TMD.POISONED]).toBe(0);
    expect(p.chp).toBe(p.mhp);
  });

  it("a debug command refuses without debug consent, even in wizard mode", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.POISONED] = 10;
    p.chp = 1;
    const ran = wizCureAll(state, { ...wizDeps(state, true), wizard: true, debug: false });
    expect(ran).toBe(false);
    expect(p.timed[TMD.POISONED]).toBe(10); // untouched
    expect(p.chp).toBe(1);
  });

  it("cheat death follows wizard mode, not debug consent", () => {
    const withDebugOnly = makeState();
    withDebugOnly.isDead = true;
    expect(
      wizCheatDeath(withDebugOnly, { ...wizDeps(withDebugOnly, true), wizard: false, debug: true }),
    ).toBe(false);
    expect(withDebugOnly.isDead).toBe(true);

    const withWizardOnly = makeState();
    withWizardOnly.isDead = true;
    expect(
      wizCheatDeath(withWizardOnly, {
        ...wizDeps(withWizardOnly, true),
        wizard: true,
        debug: false,
      }),
    ).toBe(true);
    expect(withWizardOnly.isDead).toBe(false);
  });
});
