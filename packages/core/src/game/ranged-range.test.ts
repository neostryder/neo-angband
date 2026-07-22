/**
 * Regression guard for audit 01 R1/R2/R4 (player-attack.c ranged range +
 * terrain-break), the HIGH range-formula fixes plus the passable-non-projectable
 * break. These drive the REAL fire/throw commands (installRangedCommands) so a
 * monster placed just inside / outside the computed range proves the formula,
 * not the local arithmetic in isolation.
 *
 * - R2 (player-attack.c:1310): fire range = MIN(6 + 2 * ammo_mult, max_range).
 *   The old port used num_shots (rate of fire); this asserts the LAUNCHER
 *   multiplier drives it and num_shots does not.
 * - R1 (player-attack.c:1366,1402-1403): throw range = MIN(((adj_str_blow[
 *   stat_ind[STAT_STR]] + 20) * 10) / MAX(weight, 10), 10). The old port used
 *   player level with a bogus +1 and the wrong cap; this asserts STR-blow drives
 *   it and the hard cap is 10.
 * - R4 (player-attack.c:1204-1206): a missile breaks at a passable but
 *   non-projectable grid (e.g. rubble) instead of flying through it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TV } from "../generated";
import { loc } from "../loc";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { createDefaultRegistry } from "./player-turn";
import { installRangedCommands } from "./ranged-cmd";
import { gearAdd } from "./gear";
import type { GameState } from "./context";
import { addMon, featureReg, makeRace, makeState } from "./harness";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

const objReg = new ObjRegistry({
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as ObjPackJson);

function kindOfTval(tval: number): ObjectKind {
  const k = objReg.kinds.find((kk): kk is ObjectKind => kk !== null && kk.tval === tval);
  if (!k) throw new Error(`no kind for tval ${tval}`);
  return k;
}

function bareObject(tval: number): GameObject {
  const kind = kindOfTval(tval);
  const o = objectNew(kind);
  o.tval = kind.tval;
  o.sval = kind.sval;
  o.dd = kind.dd;
  o.ds = kind.ds;
  o.weight = kind.weight;
  o.number = 1;
  return o;
}

/** Equip a bow and carry arrows; returns the ammo handle. */
function armArcher(state: GameState, ammoMult: number, numShots: number): number {
  const p = state.actor.player;
  const bow = bareObject(TV.BOW);
  const bowHandle = gearAdd(state.gear, bow);
  const bowSlot = p.body.slots.findIndex((s) => s.type === "BOW");
  p.equipment[bowSlot] = bowHandle;

  const arrows = bareObject(TV.ARROW);
  arrows.number = 10;
  const handle = gearAdd(state.gear, arrows);

  state.actor.combat.ammoTval = TV.ARROW;
  state.actor.combat.ammoMult = ammoMult;
  state.actor.combat.numShots = numShots;
  return handle;
}

function fire(state: GameState, handle: number, dir: number): void {
  const registry = createDefaultRegistry();
  installRangedCommands(registry);
  registry.get("fire")!(state, { code: "fire", args: { handle, dir } });
}

function throwItem(state: GameState, handle: number, dir: number): void {
  const registry = createDefaultRegistry();
  installRangedCommands(registry);
  registry.get("throw")!(state, { code: "throw", args: { handle, dir } });
}

describe("fire range = MIN(6 + 2*ammo_mult, max_range) (player-attack.c:1310, R2)", () => {
  it("a monster inside 6 + 2*ammo_mult is hit", () => {
    const state = makeState({ playerGrid: loc(5, 12), w: 40 });
    const handle = armArcher(state, 2, 20); /* range 6 + 2*2 = 10 */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(5 + 9, 12), { hp: 5000 });
    state.rng.randFix(100); /* always hit */

    fire(state, handle, 6); /* due east */
    expect(mon.hp).toBeLessThan(5000);
  });

  it("range ignores num_shots (rate of fire): a distant monster is out of range", () => {
    const state = makeState({ playerGrid: loc(5, 12), w: 40 });
    /* ammo_mult 1 -> range 8. num_shots 200 would give 6 + 2*20 = 46 under the
     * OLD (wrong) formula, easily reaching distance 12. */
    const handle = armArcher(state, 1, 200);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(5 + 12, 12), { hp: 5000 });
    state.rng.randFix(100);

    fire(state, handle, 6);
    expect(mon.hp).toBe(5000); /* range 8 < 12: never reached */
  });
});

describe("throw range = MIN(((str+20)*10)/weight, 10) (player-attack.c:1402-1403, R1)", () => {
  /** Add a weight-`w` throwable to the pack; returns its handle. */
  function armThrower(state: GameState, w: number): number {
    const flask = bareObject(TV.FLASK);
    flask.weight = w;
    flask.number = 1;
    return gearAdd(state.gear, flask);
  }

  it("STR-blow adjustment drives range: a high-STR throw reaches a distant foe", () => {
    const state = makeState({ playerGrid: loc(5, 12), w: 40 });
    state.statInd = [16, 0, 0, 0, 0, 0]; /* adj_str_blow[16] = 30 */
    const handle = armThrower(state, 50); /* range = (30+20)*10/50 = 10 */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(5 + 7, 12), { hp: 5000 });
    state.actor.combat.toH = 100;
    state.rng.randFix(100);

    throwItem(state, handle, 6);
    expect(mon.hp).toBeLessThan(5000);
  });

  it("a low-STR throw of the same weight falls short", () => {
    const state = makeState({ playerGrid: loc(5, 12), w: 40 });
    state.statInd = [0, 0, 0, 0, 0, 0]; /* adj_str_blow[0] = 3 */
    const handle = armThrower(state, 50); /* range = (3+20)*10/50 = 4 */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(5 + 7, 12), { hp: 5000 });
    state.actor.combat.toH = 100;
    state.rng.randFix(100);

    throwItem(state, handle, 6);
    expect(mon.hp).toBe(5000); /* range 4 < 7: never reached */
  });

  it("range is hard-capped at 10 regardless of a huge STR/weight ratio", () => {
    const state = makeState({ playerGrid: loc(5, 12), w: 40 });
    state.statInd = [37, 0, 0, 0, 0, 0]; /* adj_str_blow[37] = 240 */
    const handle = armThrower(state, 10); /* uncapped = 2600; capped at 10 */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(5 + 12, 12), { hp: 5000 });
    state.actor.combat.toH = 100;
    state.rng.randFix(100);

    throwItem(state, handle, 6);
    expect(mon.hp).toBe(5000); /* dist 12 > cap 10: never reached */
  });
});

describe("missile breaks at a passable non-projectable grid (player-attack.c:1204, R4)", () => {
  it("a shot does not fly through rubble to a monster beyond it", () => {
    const state = makeState({ playerGrid: loc(5, 12), w: 40 });
    const handle = armArcher(state, 3, 20); /* range 12: reaches distance 9 */
    /* Rubble at distance 4: passable (can be walked/tunneled) but NOT
     * projectable, so the missile must stop there. */
    const rubble = featureReg.byCodeName("PASS_RUBBLE");
    const blockGrid = loc(5 + 4, 12);
    state.chunk.setFeat(blockGrid, rubble.fidx);
    expect(state.chunk.isPassable(blockGrid)).toBe(true);
    expect(state.chunk.isProjectable(blockGrid)).toBe(false);

    const mon = addMon(state, makeRace({ ac: 0 }), loc(5 + 9, 12), { hp: 5000 });
    state.rng.randFix(100);

    fire(state, handle, 6);
    expect(mon.hp).toBe(5000); /* missile broke at the rubble, distance 4 */
  });
});
