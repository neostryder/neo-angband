/**
 * #281: a mod could not declare a monster spell in time for its own records to
 * bind to it.
 *
 * Mirrors mod/message-declarations.test.ts's ordering proof for message types
 * (#266). The binder resolves spell names through spellIndexOf; an undeclared
 * name throws `mon: invalid spell name` and takes the whole bind down. The
 * declaration must run inside bindCore BEFORE bindMonsters - presence alone is
 * not the property; POSITION is.
 *
 * The controls are built by REMOVING the mechanism, never by feeding it input
 * assumed to be inert:
 *   - "no declaration pass" - the same pack, bindCore without pack.monsterSpells.
 *     The bind dies.
 *   - "declared after the bind" - declare after a failing bind would still die
 *     if the declaration is not inside bindCore first.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import {
  monSpells,
  rsfMax,
  spellIndexOf,
  spellNameAt,
} from "./spell-registry.js";
import { monSpellsOfTypes } from "./types.js";
import { declareModMonsterSpells } from "./spell-declarations.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

/** The RSF_ name only the mod knows. */
const MOD_SPELL = "MOD_TEST_BOLT";
const OWNER = "spell-pack";

/** A pack whose monster_spell table and one monster name the mod's spell. */
function moddedPack(): CorePack {
  const mon = {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: [
      ...loadRecords<Record<string, unknown>>("monster_spell"),
      {
        name: MOD_SPELL,
        hit: 100,
        effect: [{ eff: "BOLT", type: "FIRE", dice: "3d8" }],
        lore: ["cast a test bolt"],
        "message-vis": ["{name} casts a test bolt."],
      },
    ],
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords<Record<string, unknown>>("monster").map((r) =>
      r.name === "kobold"
        ? { ...r, spells: [MOD_SPELL] }
        : r,
    ),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  };
  return {
    constants: loadJson("constants"),
    terrain: loadRecords("terrain"),
    roomTemplates: loadRecords("room_template"),
    vaults: loadRecords("vault"),
    dungeonProfiles: loadRecords("dungeon_profile"),
    projection: loadRecords("projection"),
    trap: loadRecords("trap"),
    names: loadRecords("names"),
    quest: loadRecords("quest"),
    store: loadRecords("store"),
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
    },
    mon,
  } as unknown as CorePack;
}

afterEach(() => {
  monSpells.clear();
});

describe("#281 THE ORDERING PROOF: a declared spell binds the pack's own records", () => {
  it("bindCore with pack.monsterSpells binds a monster that names the mod spell", () => {
    const pack = moddedPack() as CorePack & { monsterSpells: unknown[] };
    pack.monsterSpells = [{ name: MOD_SPELL, type: "RST_BOLT" }];
    expect(() => bindCore(pack)).not.toThrow();
    expect(spellIndexOf(MOD_SPELL)).toBeGreaterThanOrEqual(0);
  });

  it("the bound race's spellFlags has the mod bit set", () => {
    const pack = moddedPack() as CorePack & { monsterSpells: unknown[] };
    pack.monsterSpells = [{ name: MOD_SPELL, type: "RST_BOLT" }];
    const reg = bindCore(pack);
    const kobold = reg.monsters.races.find((r) => r.name === "kobold");
    expect(kobold).toBeDefined();
    const idx = spellIndexOf(MOD_SPELL);
    expect(kobold!.spellFlags.has(idx)).toBe(true);
  });
});

describe("#281 NEGATIVE CONTROL: remove the mechanism and the bind dies", () => {
  it("without the declaration, the same pack throws mon: invalid spell name", () => {
    /* Built by REMOVING the declaration, not by supplying an inert input:
     * identical pack, identical bind, pack.monsterSpells never set. */
    const pack = moddedPack();
    expect(() => bindCore(pack)).toThrow(/mon: invalid spell name/);
    expect(spellIndexOf(MOD_SPELL)).toBe(-1);
  });

  it("a spell the pack never declared is still refused", () => {
    const pack = moddedPack() as CorePack & { monsterSpells: unknown[] };
    pack.monsterSpells = [{ name: "OTHER_MOD_SPELL", type: "RST_BOLT" }];
    expect(() => bindCore(pack)).toThrow(/mon: invalid spell name: MOD_TEST_BOLT/);
  });
});

describe("#281 declareModMonsterSpells never throws", () => {
  it("reports refusals rather than taking the boot down", () => {
    const result = declareModMonsterSpells(
      [
        { name: "BR_FIRE", type: "RST_BREATH" },
        { name: MOD_SPELL, type: "RST_BOLT" },
        { name: "" },
        "not a record",
      ] as unknown[],
      OWNER,
    );
    expect(result.declared).toEqual([MOD_SPELL]);
    expect(result.refused.length).toBeGreaterThanOrEqual(2);
    expect(result.refused.some((r) => /already one of Angband's own/.test(r))).toBe(true);
  });

  it("a missing or non-array file is not an error a boot can die of", () => {
    expect(declareModMonsterSpells(undefined)).toEqual({
      declared: [],
      refused: [],
    });
    const bad = declareModMonsterSpells({ nope: true } as unknown as unknown[]);
    expect(bad.refused).toHaveLength(1);
    expect(bad.refused[0]).toMatch(/must be an array/);
  });
});

/**
 * End-to-end proof that closes row 22: a real pack, one extra monster_spell
 * record, a monsterSpells declaration, run through the real bindCore. Without
 * this the registry is the unwired table MOD_REACH warned about for row 21.
 */
describe("#281 end-to-end: pack with a mod monster_spell boots through bindCore", () => {
  it("declares, binds, round-trips the name, and places the spell in its RST_ mask", () => {
    const pack = moddedPack() as CorePack & { monsterSpells: unknown[] };
    pack.monsterSpells = [{ name: MOD_SPELL, type: "RST_BOLT" }];

    /* (a) bindCore does not throw */
    let reg: ReturnType<typeof bindCore>;
    expect(() => {
      reg = bindCore(pack);
    }).not.toThrow();

    /* (c) name ↔ index round-trip through the live registry */
    const idx = spellIndexOf(MOD_SPELL);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(spellNameAt(idx)).toBe(MOD_SPELL);
    expect(rsfMax()).toBeGreaterThan(idx);

    /* (b) the monster's spellFlags has the mod bit set */
    const kobold = reg!.monsters.races.find((r) => r.name === "kobold");
    expect(kobold).toBeDefined();
    expect(kobold!.spellFlags.has(idx)).toBe(true);

    /* the full monster_spell record is bound under the mod index */
    expect(reg!.monsters.spells.get(idx)?.name).toBe(MOD_SPELL);

    /* (d) monSpellsOfTypes sees the mod's RST_ expression */
    expect(monSpellsOfTypes("RST_BOLT")).toContain(idx);
    expect(monSpellsOfTypes("RST_BREATH")).not.toContain(idx);
  });
});
