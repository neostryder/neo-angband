import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RF } from "../generated/index.js";
import { FlagSet } from "../bitflag.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { RF_SIZE } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson, Brand, Slay, ObjectKind } from "../obj/types.js";
import { objectNew } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import type { AttackModifier, BrandSlayTarget } from "./brand-slay.js";
import {
  getMonsterBrandMultiplier,
  improveAttackModifier,
  reactToSlay,
} from "./brand-slay.js";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}
function packJson<T>(name: string): T[] {
  return (load(name) as { records: T[] }).records;
}

const monPack: MonsterPackRecords = {
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
};
const monReg = bindMonsters(monPack);

const objPack: ObjPackJson = {
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
} as ObjPackJson;
const objReg = new ObjRegistry(objPack);
const weaponKind = objReg.kinds.find((k): k is ObjectKind => !!k) as ObjectKind;

/* Inline brand/slay tables with known multipliers. */
const FIRE_BRAND: Brand = {
  index: 1,
  code: "FIRE",
  name: "fire",
  verb: "burn",
  resistFlag: RF.IM_FIRE,
  vulnFlag: RF.HURT_FIRE,
  multiplier: 3,
  oMultiplier: 17,
  power: 15,
};
const brands: (Brand | null)[] = [null, FIRE_BRAND];

const EVIL_SLAY: Slay = {
  index: 1,
  code: "EVIL",
  name: "evil creatures",
  base: null,
  meleeVerb: "smite",
  rangeVerb: "pierces",
  raceFlag: RF.EVIL,
  multiplier: 2,
  oMultiplier: 15,
  power: 15,
};
const UNDEAD_SLAY: Slay = {
  index: 2,
  code: "UNDEAD",
  name: "undead",
  base: null,
  meleeVerb: "crush",
  rangeVerb: "pierces",
  raceFlag: RF.UNDEAD,
  multiplier: 5,
  oMultiplier: 20,
  power: 20,
};
const slays: (Slay | null)[] = [null, EVIL_SLAY, UNDEAD_SLAY];

const realRace = monReg.races.find((r) => r.base) as MonsterRace;

function target(...flagIdx: number[]): BrandSlayTarget {
  const flags = new FlagSet(RF_SIZE);
  for (const f of flagIdx) flags.on(f);
  return { race: { ...realRace, flags } };
}

function weapon(brandOn: boolean[], slayOn: boolean[]): GameObject {
  const o = objectNew(weaponKind);
  o.brands = brandOn;
  o.slays = slayOn;
  return o;
}

function mod(): AttackModifier {
  return { brand: 0, slay: 0, verb: "hit" };
}

describe("get_monster_brand_multiplier", () => {
  it("returns the base multiplier without vulnerability", () => {
    expect(getMonsterBrandMultiplier(target(RF.EVIL), FIRE_BRAND, false)).toBe(3);
  });

  it("doubles standard-combat damage against a vulnerable monster", () => {
    expect(getMonsterBrandMultiplier(target(RF.HURT_FIRE), FIRE_BRAND, false)).toBe(
      6,
    );
  });

  it("doubles only the extra damage in O-combat", () => {
    expect(getMonsterBrandMultiplier(target(), FIRE_BRAND, true)).toBe(17);
    /* 2 * (17 - 10) + 10 = 24 */
    expect(getMonsterBrandMultiplier(target(RF.HURT_FIRE), FIRE_BRAND, true)).toBe(
      24,
    );
  });
});

describe("improve_attack_modifier", () => {
  it("picks the higher-multiplier brand over a weaker slay", () => {
    const m = mod();
    /* Fire brand (x3) vs evil slay (x2) on an evil monster. */
    improveAttackModifier(weapon([false, true], [false, true, false]), target(RF.EVIL), brands, slays, m, false);
    expect(m.brand).toBe(1);
    expect(m.slay).toBe(0);
    expect(m.verb).toBe("burn");
  });

  it("uses vulnerability doubling in the best-of comparison", () => {
    const m = mod();
    /* Fire brand doubled to x6 on a fire-vulnerable evil monster beats x2 slay. */
    improveAttackModifier(
      weapon([false, true], [false, true, false]),
      target(RF.EVIL, RF.HURT_FIRE),
      brands,
      slays,
      m,
      false,
    );
    expect(m.brand).toBe(1);
    expect(m.slay).toBe(0);
  });

  it("zeroes a brand the monster is immune to and falls back to the slay", () => {
    const m = mod();
    /* Fire-immune undead: fire brand skipped, undead slay (x5) selected. */
    improveAttackModifier(
      weapon([false, true], [false, false, true]),
      target(RF.UNDEAD, RF.IM_FIRE),
      brands,
      slays,
      m,
      false,
    );
    expect(m.brand).toBe(0);
    expect(m.slay).toBe(2);
    expect(m.verb).toBe("crush");
  });

  it("selects a slay only against a matching monster", () => {
    const m = mod();
    /* Undead slay on a non-undead, non-evil monster: nothing applies. */
    improveAttackModifier(
      weapon([false, false], [false, false, true]),
      target(),
      brands,
      slays,
      m,
      false,
    );
    expect(m.brand).toBe(0);
    expect(m.slay).toBe(0);
  });

  it("appends 's' to the brand verb for ranged attacks", () => {
    const m = mod();
    improveAttackModifier(weapon([false, true], [false, false, false]), target(), brands, slays, m, true);
    expect(m.verb).toBe("burns");
  });
});

describe("react_to_slay (obj-slays.c L435)", () => {
  it("true when the object carries a slay matching the monster's race flag", () => {
    /* Undead slay on an undead monster: the theft/pickup is blocked. */
    expect(
      reactToSlay(weapon([false, false], [false, false, true]), target(RF.UNDEAD), slays),
    ).toBe(true);
  });

  it("false when no carried slay matches the monster", () => {
    /* Undead slay on a non-undead monster. */
    expect(
      reactToSlay(weapon([false, false], [false, false, true]), target(RF.EVIL), slays),
    ).toBe(false);
  });

  it("false for an object with no slays at all", () => {
    const o = weapon([false, false], [false, false, false]);
    o.slays = null;
    expect(reactToSlay(o, target(RF.UNDEAD), slays)).toBe(false);
  });
});
