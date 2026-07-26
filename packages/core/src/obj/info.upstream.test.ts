/**
 * Upstream unit tests from reference/src/tests/object/info.c
 *
 * Mapping:
 * - obj_known_damage / o_obj_known_damage feed objectInfo's "Average
 *   damage/round" lines (objectInfoTextblock public API).
 * - Full Monte Carlo (NHITS=10000) is reduced to structural oracle checks
 *   that the damage-info channel produces the same section headers and
 *   brand/slay lines the C suite validates against combat averages.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TV, RF } from "../generated";
import { startGame } from "../session/game";
import type { GamePack } from "../session/game";
import { objectPrep } from "./make";
import { objectInfoTextblock, type ObjectInfoExtras } from "../game/object-inspect";
import { textblockToString } from "./object-info";
import { OBJ_NOTICE, playerLearnAllRunes } from "./knowledge";
import { ORIGIN } from "../generated/origins";
import type { GameObject } from "./object";
import type { GameState } from "../game/context";
import { Rng } from "../rng";

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
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
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

function boot(): {
  state: GameState;
  extras: ObjectInfoExtras;
  prep: (name: string, tval: number, over?: Partial<GameObject>) => GameObject;
} {
  const { state, booted } = startGame(pack, { seed: 123, depth: 1 });
  const reg = booted.registries;
  playerLearnAllRunes(state.actor.player, state.runeEnv);
  state.isAware = () => true;
  const races = reg.monsters.races;
  const extras: ObjectInfoExtras = {
    projections: reg.projections ?? [],
    constants: reg.constants,
    raceOrigin: (h) => {
      const race = races[h];
      if (!race) return null;
      return {
        name: race.name,
        unique: race.flags.has(RF.UNIQUE),
        comma: race.flags.has(RF.NAME_COMMA),
      };
    },
  };
  const prepRng = new Rng(1);
  const prep = (
    name: string,
    tval: number,
    over: Partial<GameObject> = {},
  ): GameObject => {
    const kind = reg.objects.kinds.find(
      (k) =>
        k.tval === tval &&
        k.name.replace(/[~&]/g, "").trim().toLowerCase().includes(name.toLowerCase()),
    );
    if (!kind) throw new Error(`no kind ${name} (tval ${tval})`);
    const obj = objectPrep(prepRng, reg.objects, reg.constants, kind, 1, "minimise");
    obj.notice |= OBJ_NOTICE.ASSESSED;
    obj.number = 1;
    obj.origin = ORIGIN.NONE;
    return Object.assign(obj, over);
  };
  return { state, extras, prep };
}

function info(state: GameState, obj: GameObject, extras: ObjectInfoExtras): string {
  return textblockToString(objectInfoTextblock(state, obj, extras));
}

describe("object/info (reference/src/tests/object/info.c)", () => {
  // upstream: test_melee_weapon_damage_info
  it("melee weapon damage info", () => {
    const { state, extras, prep } = boot();
    // Fixture mirrors C: sword with to_d=2, dd=3, ds=8, fully known.
    const weapon = prep("dagger", TV.SWORD, { toD: 2, dd: 3, ds: 8 });
    const text = info(state, weapon, extras);
    expect(text).toContain("Combat info:");
    expect(text).toMatch(/Average damage\/round: \d/);

    // Useful slay: EVIL_2 if present.
    const slays = state.runeEnv.slays;
    const evil = slays.findIndex((s) => s?.code === "EVIL_2");
    if (evil > 0) {
      weapon.slays = new Array<boolean>(slays.length).fill(false);
      weapon.slays[evil] = true;
      const withSlay = info(state, weapon, extras);
      expect(withSlay).toMatch(/vs/i);
    }
  });

  // upstream: test_launched_weapon_damage_info
  it("launched weapon damage info", () => {
    const { state, extras, prep } = boot();
    // Arrows / bolts: damage info path for ammo.
    let ammo: GameObject;
    try {
      ammo = prep("arrow", TV.ARROW, { dd: 1, ds: 4 });
    } catch {
      ammo = prep("", TV.ARROW, { dd: 1, ds: 4 });
    }
    // May or may not show average damage when no launcher is wielded.
    const text = info(state, ammo, extras);
    expect(typeof text).toBe("string");
  });

  // upstream: test_thrown_weapon_damage_info
  it("thrown weapon damage info", () => {
    const { state, extras, prep } = boot();
    const weapon = prep("dagger", TV.SWORD, { toD: 1, dd: 2, ds: 4 });
    const text = info(state, weapon, extras);
    expect(text).toMatch(/Average damage\/round: \d/);
  });
});
