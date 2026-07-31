import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { colorCharToAttr, colorTextToAttr, COLOUR_RED } from "../color.js";
import { FEAT } from "../generated/index.js";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import { GlyphTable } from "./glyph-table.js";
import { LIGHTING } from "./tile-prefs.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: CorePack = {
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
  } as CorePack["obj"],
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
  trap: loadRecords("trap"),
};

const reg = bindCore(pack);

function table(): GlyphTable {
  return new GlyphTable({
    features: reg.features.allFeatures(),
    kinds: reg.objects.kinds,
    races: reg.monsters.races,
    traps: reg.traps,
    flavors: reg.objects.flavors,
  });
}

describe("GlyphTable: reset_visuals (ui-prefs.c L1352-1421)", () => {
  it("seeds every lighting variant of a feature from its single gamedata default", () => {
    const t = table();
    const fidx = FEAT["FLOOR"] as number;
    const feat = reg.features.get(fidx);
    for (let j = 0; j < LIGHTING.MAX; j++) {
      expect(t.featGlyph(j, fidx)).toEqual({
        attr: colorCharToAttr(feat.dAttr),
        char: feat.dChar,
      });
    }
  });

  it("seeds the player's own glyph from r_info[0] (<player> in monster.txt)", () => {
    const race0 = reg.monsters.races[0]!;
    expect(race0.name).toBe("<player>");
    expect(table().monsterGlyph(0)).toEqual({ attr: race0.dAttr, char: race0.dChar });
  });

  it("normalises all four attr spellings to the numeric COLOUR_* code", () => {
    const t = table();
    /* Monster races already carry a numeric attr; kinds and features carry a
     * colour CHAR; flavours carry a colour NAME. All must come out numeric. */
    const kind = reg.objects.kinds.find((k) => k.dAttr !== "")!;
    expect(t.kindGlyph(kind.kidx)!.attr).toBe(colorCharToAttr(kind.dAttr));
    const flavor = reg.objects.flavors[0]!;
    expect(t.flavorGlyph(flavor.fidx)!.attr).toBe(colorTextToAttr(flavor.dAttr));
    expect(typeof t.monsterGlyph(1)!.attr).toBe("number");
  });

  it("seeds every trap's lighting variants", () => {
    const t = table();
    const trap = reg.traps![1]!;
    for (let j = 0; j < LIGHTING.MAX; j++) {
      expect(t.trapGlyph(j, trap.tidx)).toEqual({
        attr: colorCharToAttr(trap.color),
        char: trap.glyph,
      });
    }
  });

  it("an unbound index reads back undefined rather than throwing", () => {
    expect(table().monsterGlyph(99999)).toBeUndefined();
    expect(table().featGlyph(LIGHTING.MAX, 0)).toBeUndefined();
  });
});

describe("GlyphTable: the writes a pref file / the glyph picker make", () => {
  it("a monster override survives until reset(), then reverts", () => {
    const t = table();
    const before = t.monsterGlyph(1)!;
    t.setMonsterGlyph(1, { attr: COLOUR_RED, char: "Z" });
    expect(t.monsterGlyph(1)).toEqual({ attr: COLOUR_RED, char: "Z" });
    t.reset();
    expect(t.monsterGlyph(1)).toEqual(before);
  });

  it("setFeatGlyph with LIGHTING.MAX writes every variant (the prf `*` field)", () => {
    const t = table();
    const fidx = FEAT["FLOOR"] as number;
    t.setFeatGlyph(LIGHTING.MAX, fidx, { attr: COLOUR_RED, char: "%" });
    for (let j = 0; j < LIGHTING.MAX; j++) {
      expect(t.featGlyph(j, fidx)).toEqual({ attr: COLOUR_RED, char: "%" });
    }
  });

  it("setFeatGlyph with one lighting leaves the other three alone", () => {
    const t = table();
    const fidx = FEAT["FLOOR"] as number;
    const other = t.featGlyph(LIGHTING.DARK, fidx)!;
    t.setFeatGlyph(LIGHTING.LOS, fidx, { attr: COLOUR_RED, char: "%" });
    expect(t.featGlyph(LIGHTING.LOS, fidx)).toEqual({ attr: COLOUR_RED, char: "%" });
    expect(t.featGlyph(LIGHTING.DARK, fidx)).toEqual(other);
  });

  it("setTrapGlyph with LIGHTING.MAX writes every variant (set_trap_graphic)", () => {
    const t = table();
    const tidx = reg.traps![1]!.tidx;
    t.setTrapGlyph(LIGHTING.MAX, tidx, { attr: COLOUR_RED, char: "!" });
    for (let j = 0; j < LIGHTING.MAX; j++) {
      expect(t.trapGlyph(j, tidx)).toEqual({ attr: COLOUR_RED, char: "!" });
    }
  });

  it("stores a copy, so a later mutation of the caller's pair cannot leak in", () => {
    const t = table();
    const pair = { attr: COLOUR_RED, char: "Z" };
    t.setMonsterGlyph(1, pair);
    pair.char = "Q";
    expect(t.monsterGlyph(1)!.char).toBe("Z");
  });
});
