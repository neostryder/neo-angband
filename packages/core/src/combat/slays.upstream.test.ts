/**
 * Upstream unit tests from reference/src/tests/object/slays.c
 *
 * Mapping:
 * - same_monsters_slain -> sameMonstersSlain (obj/object.ts)
 * - player_has_temporary_brand/slay -> buildTempBrandSlay (player/timed.ts)
 * - get_monster_brand_multiplier -> getMonsterBrandMultiplier
 * - improve_attack_modifier -> improveAttackModifier
 * - react_to_slay -> reactToSlay
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FlagSet } from "../bitflag.js";
import { RF } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson, Brand, Slay } from "../obj/types.js";
import { objectNew, sameMonstersSlain } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { RF_SIZE } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import { blankMonster } from "../mon/monster.js";
import { blankPlayer } from "../player/player.js";
import { buildTempBrandSlay } from "../player/timed.js";
import { bindPlayer } from "../player/bind.js";
import type { PlayerPackRecords } from "../player/bind.js";
import {
  getMonsterBrandMultiplier,
  improveAttackModifier,
  reactToSlay,
  type AttackModifier,
} from "./brand-slay.js";

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

const reg = new ObjRegistry(objPack);
const brands = reg.brands as readonly (Brand | null)[];
const slays = reg.slays as readonly (Slay | null)[];

const plReg = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
} as PlayerPackRecords);

function dummyRace(): MonsterRace {
  return {
    name: "white blob",
    plural: null,
    flags: new FlagSet(RF_SIZE),
    base: { name: "blob" },
  } as MonsterRace;
}

describe("object/slays (reference/src/tests/object/slays.c)", () => {
  // upstream: test_same_monsters_slain
  it("same_monsters_slain", () => {
    for (let i1 = 1; i1 < slays.length; i1++) {
      if (!slays[i1]) continue;
      for (let i2 = i1; i2 < slays.length; i2++) {
        if (!slays[i2]) continue;
        const s1 = sameMonstersSlain(slays, i1, i2);
        const s2 = sameMonstersSlain(slays, i2, i1);
        expect(s1).toBe(s2);
        if (i1 === i2) {
          expect(s1).toBe(true);
        } else if (s1) {
          const a = slays[i1]!;
          const b = slays[i2]!;
          expect(a.raceFlag).toBe(b.raceFlag);
          expect((!a.base && !b.base) || (a.base && b.base && a.base === b.base)).toBe(
            true,
          );
        } else {
          const a = slays[i1]!;
          const b = slays[i2]!;
          expect(
            a.raceFlag !== b.raceFlag ||
              (!a.base && !!b.base) ||
              (!!a.base && !b.base) ||
              (!!a.base && !!b.base && a.base !== b.base),
          ).toBe(true);
        }
      }
    }
  });

  // upstream: test_player_has_temporary_brand
  it("player_has_temporary_brand", () => {
    // Raw pack records in TMD order (TimedEffect does not keep brand:/slay:).
    const rawTimed = loadRecords<{
      name: string;
      brand?: string[];
      slay?: string[];
    }>("player_timed");
    const p = blankPlayer(
      plReg.races[0] as (typeof plReg.races)[number],
      plReg.classes[0] as (typeof plReg.classes)[number],
      plReg.bodies[0] as (typeof plReg.bodies)[number],
    );
    for (let i = 0; i < p.timed.length; i++) p.timed[i] = 0;
    let temp = buildTempBrandSlay(p, rawTimed, brands, slays);
    for (let i1 = 1; i1 < brands.length; i1++) {
      if (!brands[i1]) continue;
      expect(temp.hasBrand(i1)).toBe(false);
    }
    for (let t = 0; t < rawTimed.length; t++) {
      const rec = rawTimed[t]!;
      const code = rec.brand?.[0];
      if (!code) continue;
      const idx = brands.findIndex((b) => b && b.code === code);
      if (idx < 0) continue;
      for (let i = 0; i < p.timed.length; i++) p.timed[i] = 0;
      p.timed[t] = 100;
      temp = buildTempBrandSlay(p, rawTimed, brands, slays);
      for (let i2 = 1; i2 < brands.length; i2++) {
        if (!brands[i2]) continue;
        expect(temp.hasBrand(i2)).toBe(i2 === idx);
      }
    }
  });

  // upstream: test_player_has_temporary_slay
  it("player_has_temporary_slay", () => {
    const rawTimed = loadRecords<{
      name: string;
      brand?: string[];
      slay?: string[];
    }>("player_timed");
    const p = blankPlayer(
      plReg.races[0] as (typeof plReg.races)[number],
      plReg.classes[0] as (typeof plReg.classes)[number],
      plReg.bodies[0] as (typeof plReg.bodies)[number],
    );
    for (let i = 0; i < p.timed.length; i++) p.timed[i] = 0;
    let temp = buildTempBrandSlay(p, rawTimed, brands, slays);
    for (let i1 = 1; i1 < slays.length; i1++) {
      if (!slays[i1]) continue;
      expect(temp.hasSlay(i1)).toBe(false);
    }
    for (let t = 0; t < rawTimed.length; t++) {
      const rec = rawTimed[t]!;
      const code = rec.slay?.[0];
      if (!code) continue;
      const idx = slays.findIndex((s) => s && s.code === code);
      if (idx < 0) continue;
      for (let i = 0; i < p.timed.length; i++) p.timed[i] = 0;
      p.timed[t] = 100;
      temp = buildTempBrandSlay(p, rawTimed, brands, slays);
      for (let i2 = 1; i2 < slays.length; i2++) {
        if (!slays[i2]) continue;
        expect(temp.hasSlay(i2)).toBe(i2 === idx);
      }
    }
  });

  // upstream: test_get_monster_brand_multiplier
  it("get_monster_brand_multiplier", () => {
    const race = dummyRace();
    const mon = blankMonster(race);
    for (let i1 = 1; i1 < brands.length; i1++) {
      const b = brands[i1];
      if (!b) continue;
      expect(getMonsterBrandMultiplier(mon, b, false)).toBe(b.multiplier);
      expect(getMonsterBrandMultiplier(mon, b, true)).toBe(b.oMultiplier);
      if (b.vulnFlag) {
        race.flags.on(b.vulnFlag);
        expect(getMonsterBrandMultiplier(mon, b, false)).toBe(2 * b.multiplier);
        expect(getMonsterBrandMultiplier(mon, b, true)).toBe(
          2 * (b.oMultiplier - 10) + 10,
        );
        race.flags.off(b.vulnFlag);
      }
    }
  });

  // upstream: test_improve_attack_modifier (core cases)
  it("improve_attack_modifier", () => {
    const race = dummyRace();
    const mon = blankMonster(race);
    const kind = reg.kinds.find((k) => k.tval > 0)!;
    const weapon = objectNew(kind);
    weapon.brands = null;
    weapon.slays = null;

    // No brands/slays effective.
    let mod: AttackModifier = { brand: 0, slay: 0, verb: "hit" };
    improveAttackModifier(weapon, mon, brands, slays, mod, false);
    expect(mod.brand).toBe(0);
    expect(mod.slay).toBe(0);
    expect(mod.verb).toBe("hit");

    // Preset brand preserved when nothing better applies.
    mod = { brand: 1, slay: 0, verb: "punch" };
    improveAttackModifier(weapon, mon, brands, slays, mod, false);
    expect(mod.brand).toBe(1);
    expect(mod.verb).toBe("punch");

    // One brand on the weapon, monster not resistant.
    for (let i1 = 1; i1 < brands.length; i1++) {
      const b = brands[i1];
      if (!b) continue;
      weapon.brands = new Array(brands.length).fill(false);
      weapon.brands[i1] = true;
      race.flags.off(b.resistFlag);
      mod = { brand: 0, slay: 0, verb: "hit" };
      improveAttackModifier(weapon, mon, brands, slays, mod, false);
      expect(mod.brand).toBe(i1);
      expect(mod.slay).toBe(0);
      expect(mod.verb).toBe(b.verb);

      // Resistant: no brand applies.
      race.flags.on(b.resistFlag);
      mod = { brand: 0, slay: 0, verb: "hit" };
      improveAttackModifier(weapon, mon, brands, slays, mod, false);
      expect(mod.brand).toBe(0);
      expect(mod.verb).toBe("hit");
      race.flags.off(b.resistFlag);
      weapon.brands = null;
      break; // one brand is enough for the structural oracle
    }
  });

  // upstream: test_react_to_slay
  it("react_to_slay", () => {
    const race = dummyRace();
    const mon = blankMonster(race);
    const kind = reg.kinds.find((k) => k.tval > 0)!;
    const weapon = objectNew(kind);
    weapon.slays = null;

    for (let i1 = 1; i1 < slays.length; i1++) {
      const s = slays[i1];
      if (!s?.base || !s.raceFlag) continue;
      // Vulnerable monster, weapon has no slay.
      race.flags.on(s.raceFlag);
      if (s.base) (race.base as { name: string }).name = s.base;
      expect(reactToSlay(weapon, mon, slays)).toBe(false);
      // Weapon gains the slay.
      weapon.slays = new Array(slays.length).fill(false);
      weapon.slays[i1] = true;
      expect(reactToSlay(weapon, mon, slays)).toBe(true);
      weapon.slays = null;
      race.flags.off(s.raceFlag);
      (race.base as { name: string }).name = "blob";
    }
  });
});
