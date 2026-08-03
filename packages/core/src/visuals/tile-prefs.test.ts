import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, PROJ } from "../generated/index.js";
import { tvalFindIdx } from "../obj/bind.js";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import {
  BOLT,
  LIGHTING,
  TileMap,
  tileForFeature,
  tileForFlavor,
  tileForShownObject,
  tileForMonster,
  tileForObject,
  tileForProjection,
  tileForTrap,
} from "./tile-prefs.js";
import { parseTilePrefs, parseTilePrefsInto } from "./prefs.js";

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

/**
 * WHICH tile a flavoured object draws with, which is the whole bug.
 *
 * The renderer worked out correctly that an unidentified potion draws with its
 * FLAVOUR's glyph, and then asked for the KIND's tile two lines earlier. Tile
 * sets key flavoured items by flavour, so `map.object[kidx]` was empty and
 * every potion, scroll, ring and wand fell back to an ASCII glyph in the
 * middle of a fully drawn tile map.
 */
describe("the tile a flavoured object shows", () => {
  const kind = reg.objects.lookupKind(tvalFindIdx("light"), reg.objects.lookupSval(tvalFindIdx("light"), "Wooden Torch"))!;

  it("draws the flavour's tile while the player is unaware", () => {
    expect(tileForShownObject(oldMap, kind, 1)).toEqual({ attr: 0xb5, char: 0x8a });
  });

  it("draws the kind's tile once there is no flavour to hide behind", () => {
    expect(tileForShownObject(oldMap, kind, null)).toEqual({ attr: 0x8b, char: 0x86 });
  });

  /**
   * The leak this must never spring. A tile set that has no art for a flavour
   * must produce NOTHING - so the caller falls back to the flavour glyph. If
   * it reached past to the kind's tile, an unidentified potion would be drawn
   * with the art of whatever it turns out to be: the identity the flavour
   * system exists to conceal, rendered at 32x32.
   */
  it("never falls back to the kind's art for a flavour the set does not draw", () => {
    const missing = 9999;
    expect(tileForFlavor(oldMap, missing)).toBeNull();
    expect(tileForShownObject(oldMap, kind, missing)).toBeNull();
    /* ...and the kind's tile really is there to be leaked, so this is a
     * statement about the rule and not about an empty map. */
    expect(tileForObject(oldMap, kind)).not.toBeNull();
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
    for (const [dir, graf, flvr] of OTHER_PACKS) {
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

/** The bundled packs other than "old", which oldMap above already covers. */
const OTHER_PACKS = [
  ["adam-bolt", "graf-new.prf", "flvr-new.prf"],
  ["gervais", "graf-dvg.prf", "flvr-dvg.prf"],
  ["nomad", "graf-nmd.prf", "flvr-nmd.prf"],
] as const;

/**
 * The PLAYER has a tile, and it lives in the monster table at race 0.
 *
 * Every graf-*.prf carries one unconditional `monster:<player>` line (old/
 * graf-xxx.prf L927, and its equivalent in each of the others). `<player>` is
 * r_info[0], the same slot grid_data_as_text's is_player branch reads the '@'
 * from - so a player tile is an ordinary tileForMonster(map, 0) lookup and needs
 * no separate player-tile path.
 *
 * This is here because the port resolved that slot correctly for years and then
 * drew a text '@' on top of the art anyway: the renderer's player draw site
 * passed no tile. The bug was one call site, not the mapping - so what is worth
 * pinning is that ridx 0 IS mapped in every pack the game ships, which is the
 * fact that makes the missing call a defect rather than a design choice.
 */
describe("parseTilePrefs: the player (monster:<player> = race 0)", () => {
  it("maps race 0 in the Original pack", () => {
    /* graf-xxx.prf L927: monster:<player>:0x8C:0x80 */
    expect(tileForMonster(oldMap, 0)).toEqual({ attr: 0x8c, char: 0x80 });
  });

  it("maps race 0 in every other bundled pack too", () => {
    for (const [dir, graf, flvr] of OTHER_PACKS) {
      const map = new TileMap();
      parseTilePrefsInto(map, readTiles(`${dir}/${graf}`), deps);
      parseTilePrefsInto(map, readTiles(`${dir}/${flvr}`), deps);
      const tile = tileForMonster(map, 0);
      expect(tile, `${dir} has no player tile`).not.toBeNull();
      /* And it is a TILE, not a re-glyphed '@': the 0x80 bit is what makes the
       * front end blit art instead of drawing a character. */
      expect(tile!.attr & 0x80, `${dir}'s player tile lacks the 0x80 bit`).toBe(0x80);
    }
  });
});
