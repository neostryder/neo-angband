import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, PROJ } from "../generated";
import { tvalFindIdx } from "../obj/bind";
import { bindCore } from "../session/boot";
import type { CorePack } from "../session/boot";
import {
  BOLT,
  LIGHTING,
  parseTilePrefs,
  parseTilePrefsInto,
  TileMap,
  tileForFeature,
  tileForFlavor,
  tileForMonster,
  tileForObject,
  tileForProjection,
  tileForTrap,
} from "./tile-prefs";

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

function readTiles(rel: string): string {
  return readFileSync(
    new URL(`../../../../reference/lib/tiles/${rel}`, import.meta.url),
    "utf8",
  );
}

// Assemble a full pack (with traps) so name/tval resolution is exercised
// against the real registries, exactly as the game binds them.
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
const deps = {
  features: reg.features,
  objects: reg.objects,
  monsters: reg.monsters,
  traps: reg.traps,
};

// The Original ("old") pack: graf + flvr layered into one map, as the game
// loads them (graf-xxx.prf pulls in flvr-xxx.prf via the % include).
const oldMap = (() => {
  const map = new TileMap();
  parseTilePrefsInto(map, readTiles("old/graf-xxx.prf"), deps);
  parseTilePrefsInto(map, readTiles("old/flvr-xxx.prf"), deps);
  return map;
})();

describe("parseTilePrefs: feat lines (old/graf-xxx.prf)", () => {
  it("maps FLOOR per lighting variant to its exact atlas cells", () => {
    // feat:FLOOR:dark:0x80:0xA0 / lit:0x80:0xA1 / los:0x80:0xA2 / torch:0x80:0xA2
    const fidx = FEAT["FLOOR"] as number;
    expect(tileForFeature(oldMap, fidx, LIGHTING.DARK)).toEqual({
      attr: 0x80,
      char: 0xa0,
    });
    expect(tileForFeature(oldMap, fidx, LIGHTING.LIT)).toEqual({
      attr: 0x80,
      char: 0xa1,
    });
    expect(tileForFeature(oldMap, fidx, LIGHTING.LOS)).toEqual({
      attr: 0x80,
      char: 0xa2,
    });
    expect(tileForFeature(oldMap, fidx, LIGHTING.TORCH)).toEqual({
      attr: 0x80,
      char: 0xa2,
    });
  });

  it("resolves a feat by its terrain CODE (lookup_feat_code)", () => {
    // feat:GRANITE:* would blanket all lightings; assert GRANITE resolves.
    const fidx = FEAT["GRANITE"] as number;
    expect(tileForFeature(oldMap, fidx, LIGHTING.LOS)).not.toBeNull();
  });

  it("a `*` lighting fills every variant identically", () => {
    // A lone feat:FLOOR:*:... sets all four lighting variants (in the real
    // pack per-lighting lines follow and override, so assert in isolation).
    const map = parseTilePrefs("feat:FLOOR:*:0x80:0x80\n", deps);
    const fidx = FEAT["FLOOR"] as number;
    for (const l of [
      LIGHTING.LOS,
      LIGHTING.TORCH,
      LIGHTING.LIT,
      LIGHTING.DARK,
    ]) {
      expect(tileForFeature(map, fidx, l)).toEqual({ attr: 0x80, char: 0x80 });
    }
  });
});

describe("parseTilePrefs: monster lines", () => {
  it("maps a named monster to its atlas via lookup_monster (ridx)", () => {
    // monster:Filthy street urchin:0x9B:0x8A
    const race = reg.monsters.raceByName("Filthy street urchin");
    expect(race).not.toBeNull();
    expect(tileForMonster(oldMap, race!.ridx)).toEqual({
      attr: 0x9b,
      char: 0x8a,
    });
  });
});

describe("parseTilePrefs: object lines", () => {
  it("maps an object by tval+sval (lookup_kind, hex atlas)", () => {
    // object:light:Wooden Torch:0x8B:0x86
    const tval = tvalFindIdx("light");
    const sval = reg.objects.lookupSval(tval, "Wooden Torch");
    const kind = reg.objects.lookupKind(tval, sval);
    expect(kind).not.toBeNull();
    expect(tileForObject(oldMap, kind!)).toEqual({ attr: 0x8b, char: 0x86 });
  });

  it("parses DECIMAL attr/char (object:none:<pile>:131:159)", () => {
    const pile = reg.objects.pileKind;
    expect(pile).not.toBeNull();
    expect(tileForObject(oldMap, pile!)).toEqual({ attr: 131, char: 159 });
  });
});

describe("parseTilePrefs: flavor lines (old/flvr-xxx.prf)", () => {
  it("maps a flavor by fidx", () => {
    // flavor:1:0xB5:0x8A
    expect(tileForFlavor(oldMap, 1)).toEqual({ attr: 0xb5, char: 0x8a });
    expect(tileForFlavor(oldMap, { fidx: 1 })).toEqual({
      attr: 0xb5,
      char: 0x8a,
    });
  });
});

describe("parseTilePrefs: trap lines", () => {
  it("maps a trap by desc (lookup_trap) per lighting", () => {
    // trap:glyph of warding:dark:0x84:0xA3 / lit:0x84:0xA4 / los:0x84:0xA5
    const glyph = reg.traps!.find((t) => t.desc === "glyph of warding");
    expect(glyph).toBeDefined();
    expect(tileForTrap(oldMap, glyph!.tidx, LIGHTING.DARK)).toEqual({
      attr: 0x84,
      char: 0xa3,
    });
    expect(tileForTrap(oldMap, glyph!.tidx, LIGHTING.LIT)).toEqual({
      attr: 0x84,
      char: 0xa4,
    });
    expect(tileForTrap(oldMap, glyph!.tidx, LIGHTING.LOS)).toEqual({
      attr: 0x84,
      char: 0xa5,
    });
  });
});

describe("parseTilePrefs: GF (projection) lines", () => {
  it("maps a named element+direction (GF:ELEC:0)", () => {
    // GF:ELEC:0:0x84:0x90
    expect(tileForProjection(oldMap, PROJ["ELEC"] as number, BOLT.D0)).toEqual({
      attr: 0x84,
      char: 0x90,
    });
  });

  it("a `*` type applies to every projection for that motion", () => {
    // A lone GF:*:static line sets BOLT_NO_MOTION for every PROJ (in the real
    // pack later per-element static lines override some of these, so assert the
    // wildcard's effect in isolation).
    const map = parseTilePrefs("GF:*:static:0x85:0x92\n", deps);
    const projTable = PROJ as Record<string, number>;
    for (const p of ["ACID", "FIRE", "COLD", "POIS", "MON_CRUSH"]) {
      expect(
        tileForProjection(map, projTable[p] as number, BOLT.NO_MOTION),
      ).toEqual({ attr: 0x85, char: 0x92 });
    }
  });
});

describe("parseTilePrefs: misses and other packs", () => {
  it("returns null for unmapped entities (caller falls back to ASCII)", () => {
    const empty = new TileMap();
    expect(tileForFeature(empty, FEAT["FLOOR"] as number, LIGHTING.LOS)).toBeNull();
    expect(tileForMonster(empty, 3)).toBeNull();
    expect(tileForFlavor(empty, 1)).toBeNull();
    expect(tileForProjection(empty, PROJ["FIRE"] as number, BOLT.D0)).toBeNull();
  });

  it("ignores comment (#) and non-graphics lines", () => {
    const map = parseTilePrefs(
      "# a comment\ncolor:1:0:0:0:0\nfeat:FLOOR:los:0x80:0xA2\n",
      deps,
    );
    expect(tileForFeature(map, FEAT["FLOOR"] as number, LIGHTING.LOS)).toEqual({
      attr: 0x80,
      char: 0xa2,
    });
  });

  it("parses the other three bundled packs without error", () => {
    for (const [dir, graf, flvr] of [
      ["adam-bolt", "graf-new.prf", "flvr-new.prf"],
      ["gervais", "graf-dvg.prf", "flvr-dvg.prf"],
      ["nomad", "graf-nmd.prf", "flvr-nmd.prf"],
    ] as const) {
      const map = new TileMap();
      parseTilePrefsInto(map, readTiles(`${dir}/${graf}`), deps);
      parseTilePrefsInto(map, readTiles(`${dir}/${flvr}`), deps);
      // FLOOR terrain is mapped in every pack.
      expect(
        tileForFeature(map, FEAT["FLOOR"] as number, LIGHTING.LOS),
      ).not.toBeNull();
    }
  });
});
