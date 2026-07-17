import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { EF, KF, SQUARE, TMD, TV } from "../generated";
import { OBJ_NOTICE } from "../obj/knowledge";
import { loc } from "../loc";
import {
  EffectRegistry,
} from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { bindTraps } from "../world/trap";
import type { TrapRecordJson } from "../world/trap";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { ArtifactState, ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { FlavorKnowledge } from "../obj/knowledge";
import { MonAllocTable } from "../mon/make";
import { getLore } from "../mon/lore";
import type { ExpDeps } from "../player/exp";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { registerGeneralHandlers } from "./effect-general";
import { registerTeleportHandlers } from "./effect-teleport";
import { registerTerrainHandlers } from "./effect-terrain";
import { registerSummonHandlers } from "./effect-summon";
import { registerDetectHandlers } from "./effect-detect";
import { registerAttackHandlers } from "./effect-attack";
import { registerMonsterHandlers } from "./effect-monster";
import { registerItemHandlers } from "./effect-item";
import type { EffectEnvDeps } from "./effect-env";
import type { MonPlaceDeps } from "./mon-place";
import type { TrapDeps } from "./trap";
import { squareTrap } from "./trap";
import { floorPile } from "./floor";
import { squareIsKnown } from "./known";
import { updateMonsterDistances } from "./context";
import type { GameState } from "./context";
import { FLOOR, addMon, makeRace, makeState, monReg, plReg } from "./harness";
import {
  NOSCORE,
  NOSCORE_SCORE_INVALIDATING,
  markNoscore,
  noscoreInvalidatesScore,
  wizAcquire,
  wizAdvance,
  wizBanish,
  wizCheatDeath,
  wizCreateObj,
  wizCreateTrap,
  wizCureAll,
  wizCurseItem,
  wizDetectAllMonsters,
  wizDisplayItem,
  wizDumpLevelMap,
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
} from "./wizard";
import type { WizardDeps, WizEffectDeps } from "./wizard";

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

/** A full wizard deps bundle for `state`; toggle the gate with `wizard`. */
function wizDeps(
  state: GameState,
  wizard: boolean,
  msgs?: string[],
): WizardDeps {
  return {
    wizard,
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

describe("the wizard gate (ALLOW_DEBUG / NOSCORE_WIZARD)", () => {
  it("blocks a non-wizard call: no object is created", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ind = ordinaryKindIndex(TV.FOOD);
    const ran = wizCreateObj(state, { index: ind }, wizDeps(state, false));
    expect(ran).toBe(false);
    expect(floorPile(state, loc(10, 10)).length).toBe(0);
  });

  it("permits the same call in wizard mode", () => {
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
    expect(wizDumpLevelMap(state, wizDeps(state, false))).toEqual([]);
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
  it("lights and knows the level", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    wizWizardLight(state, wizDeps(state, true));
    expect(state.chunk.sqinfoHas(loc(10, 10), SQUARE.GLOW)).toBe(true);
    expect(squareIsKnown(state, loc(10, 10))).toBe(true);
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
    wizWizardLight(state, wizDeps(state, true));
    expect(
      wizQuerySquareFlag(state, { flag: 0 }, wizDeps(state, true)).length,
    ).toBeGreaterThan(0);
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

  it("wizDumpLevelMap returns a feature grid of the right size", () => {
    const state = makeState({ w: 20, h: 15 });
    const rows = wizDumpLevelMap(state, wizDeps(state, true));
    expect(rows.length).toBe(15);
    expect(rows[0]!.length).toBe(20);
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

  it("wizJumpLevel marks NOSCORE_JUMPING through the seam", () => {
    const state = makeState();
    const bits: number[] = [];
    const deps: WizardDeps = {
      ...wizDeps(state, true),
      markNoscore: (b) => bits.push(b),
    };
    const ran = wizJumpLevel(state, { level: 5 }, deps);
    expect(ran).toBe(true);
    expect(bits).toContain(NOSCORE.JUMPING);
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
});
