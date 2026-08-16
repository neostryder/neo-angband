/**
 * upkeep->total_weight: the player's carried weight, and the three things
 * upstream reads it for.
 *
 * WHY THIS FILE EXISTS AT ALL. The port had a faithful `weightLimit`, a
 * faithful `weightRemaining`, a faithful carrying-capacity speed penalty in
 * calc_bonuses, a faithful shield-bash quality term and a Burden line on the
 * character sheet - and nothing ever added an object's weight to the total. It
 * was set to 0 at birth and written afterwards only by the wizard's quantity
 * editor, so the speed penalty could not fire at any load, the bash was short by
 * a constant, and Burden always read `0.0 lb`. Every consumer was correct; the
 * producer did not exist. A whole test suite, three coverage guards and a lint
 * pass were green over it, because nothing they check can see a field that is
 * only ever read.
 *
 * So this file does not test the accounting statements. It tests the three
 * OBSERVABLE consequences, and it derives its ground truth by summing the gear
 * rather than declaring expected numbers - because the running total is
 * maintained incrementally, exactly as obj-gear.c maintains it, and the only way
 * to catch a future gear mutation that goes around a choke point is to compare
 * the accumulated number against the independent sum.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import { objectPrep } from "../obj/make.js";
import { objectWeightOne } from "../obj/object.js";
import type { GameObject, StackLimits } from "../obj/object.js";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import { calcBonuses, weightLimit, weightRemaining } from "../player/calcs.js";
import { Rng } from "../rng.js";
import { loadGame, saveGame, startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import type { SavedGame } from "../session/save.js";
import { characterPanels } from "./char-sheet.js";
import {
  gearObjectForUse,
  gearTotalWeight,
  invenCarry,
  newGear,
  wieldObject,
} from "./gear.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  obj: {
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

const reg = new ObjRegistry(pack.obj);
const constants = bindConstants(pack.constants);
const players = bindPlayer(pack.player);
const limits: StackLimits = {
  quiverSlotSize: constants.quiverSlotSize,
  thrownQuiverMult: constants.thrownQuiverMult,
};

function humanWarrior() {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  return blankPlayer(race, cls, players.bodies[race.body]!);
}

/** First ordinary (non-artifact-dummy) kind of a tval. */
function firstKind(tval: number) {
  const k = reg.kinds.find(
    (kk) => kk.tval === tval && kk.kidx < reg.ordinaryKindCount,
  );
  if (!k) throw new Error(`no ordinary kind for tval ${tval}`);
  return k;
}

function make(tval: number, number = 1, seed = 1): GameObject {
  const obj = objectPrep(new Rng(seed), reg, constants, firstKind(tval), 0, "minimise");
  obj.number = number;
  return obj;
}

describe("upkeep->total_weight is produced, not just consumed", () => {
  it("a born character's burden is the weight of the kit they carry", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const total = state.actor.player.upkeep.totalWeight;

    /* The claim that fails on a build with no producer: a character born with a
     * starting kit is carrying SOMETHING. */
    expect(total).toBeGreaterThan(0);
    expect(total).toBe(gearTotalWeight(state.gear));
  });

  it("equals the summed gear after every carry, split, drop and wield", () => {
    const gear = newGear();
    gear.curses = reg.curses;
    const player = humanWarrior();
    const check = (): void =>
      expect(player.upkeep.totalWeight).toBe(gearTotalWeight(gear));

    check(); /* Empty gear, empty burden. */

    /* Carry a stack: the whole stack's weight arrives at once. */
    const arrows = make(TV.ARROW, 20);
    const oneArrow = objectWeightOne(arrows, reg.curses);
    const hArrows = invenCarry(gear, player, arrows, limits);
    expect(player.upkeep.totalWeight).toBe(20 * oneArrow);
    check();

    /* A second stack merges, and its weight is added all the same. */
    invenCarry(gear, player, make(TV.ARROW, 5), limits);
    expect(player.upkeep.totalWeight).toBe(25 * oneArrow);
    check();

    /* Firing five: only the five that leave the gear stop counting. */
    gearObjectForUse(gear, player, hArrows, 5);
    expect(player.upkeep.totalWeight).toBe(20 * oneArrow);
    check();

    /* A weapon, then wielding it: wearing something does not change what the
     * player is carrying, because an equipped object is still in p->gear. */
    const sword = make(TV.SWORD);
    const hSword = invenCarry(gear, player, sword, limits);
    const withSword = player.upkeep.totalWeight;
    expect(wieldObject(gear, player, hSword)).toBeGreaterThanOrEqual(0);
    expect(player.upkeep.totalWeight).toBe(withSword);
    check();

    /* Dropping the whole remaining stack takes all of its weight with it. */
    gearObjectForUse(gear, player, hArrows, 20);
    expect(player.upkeep.totalWeight).toBe(objectWeightOne(sword, reg.curses));
    check();
  });

  it("makes the carrying-capacity speed penalty fire (player-calcs.c:2223-2227)", () => {
    const player = humanWarrior();
    const bind = () =>
      calcBonuses(player, {
        equipment: player.equipment.map(() => null),
        timedEffects: players.timed,
        curses: reg.curses,
        update: true,
      });

    /* Unburdened: the penalty branch is not taken. */
    player.upkeep.totalWeight = 0;
    const light = bind();
    const limit = weightLimit(light);
    expect(limit).toBeGreaterThan(0);

    /* Loaded to three quarters of the limit. The expected penalty is derived
     * from the upstream expression over the SAME numbers, not written down as a
     * constant: what is being tested is that the branch is reachable at all. */
    const load = Math.trunc((limit * 3) / 4);
    player.upkeep.totalWeight = load;
    const heavy = bind();
    const expected = Math.trunc(
      (load - Math.trunc(limit / 2)) / Math.trunc(limit / 10),
    );
    expect(expected).toBeGreaterThan(0);
    expect(light.speed - heavy.speed).toBe(expected);

    /* And weight_remaining, which the character sheet colours on, goes negative
     * exactly once the player is over the burdened threshold. */
    expect(weightRemaining(heavy, load)).toBeLessThan(
      weightRemaining(light, 0),
    );
  });

  it("shows the real burden on the character sheet's Burden line", () => {
    const { state } = startGame(pack, { seed: 321, depth: 1 });
    const total = state.actor.player.upkeep.totalWeight;
    expect(total).toBeGreaterThan(0);

    const panels = characterPanels(state, {
      weightRemaining: 100,
      restingTurn: 0,
    });
    const burden = panels
      .flatMap((p) => p.lines)
      .find((l) => l.label === "Burden");
    expect(burden).toBeDefined();
    expect(burden!.value).toBe(`${(total / 10).toFixed(1)} lb`);
    /* The line that used to read "0.0 lb" for every character at every load. */
    expect(burden!.value).not.toBe("0.0 lb");
  });

  it("is re-summed on load, so a save written without it is not weightless", () => {
    const game = startGame(pack, { seed: 777, depth: 2, className: "Ranger" });
    const born = game.state.actor.player.upkeep.totalWeight;
    expect(born).toBeGreaterThan(0);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    /* Exactly what a character saved by any build before this accounting
     * existed looks like on disk: real gear, and a stored burden of zero. */
    saved.player.upkeep.totalWeight = 0;

    const restored = loadGame(pack, saved).state;
    expect(restored.actor.player.upkeep.totalWeight).toBe(born);
    expect(restored.actor.player.upkeep.totalWeight).toBe(
      gearTotalWeight(restored.gear),
    );
  });
});
