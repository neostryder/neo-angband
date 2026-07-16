/**
 * The new-character INTERFACE-defaults seam (StartGameOptions.interfaceDefaults),
 * the mechanism behind the bundled qol content mod. Proves:
 *  (a) a new character born with interfaceDefaults gets those INTERFACE values;
 *  (b) without them, the character gets the stock OPTION_ENTRIES table defaults;
 *  (c) the seam REFUSES to change any BIRTH / CHEAT / SCORE option even when one
 *      is present in the supplied data (the defensive filterInterfaceOverrides).
 *
 * The exact option set the qol mod ships lives in packages/web/mods/qol/
 * options.json + docs/modding/QOL.md; this test pins the seam behaviour, not
 * that particular list.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game";
import type { GamePack } from "./game";
import { OptionState, filterInterfaceOverrides } from "../player/options";

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
  quest: loadRecords("quest"),
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
} as unknown as GamePack;

// The qol mod's recommended INTERFACE-option defaults (all `normal:false` in
// the table, so flipping them to true is observable).
const QOL_DEFAULTS: Record<string, boolean> = {
  show_damage: true,
  show_flavors: true,
  center_player: true,
  purple_uniques: true,
  effective_speed: true,
  notify_recharge: true,
};

describe("startGame interfaceDefaults seam (qol mod mechanism)", () => {
  it("(a) a new character with interfaceDefaults gets the QoL INTERFACE values", () => {
    const { state } = startGame(pack, {
      seed: 123,
      depth: 1,
      interfaceDefaults: QOL_DEFAULTS,
    });
    const opts = state.options!;
    for (const name of Object.keys(QOL_DEFAULTS)) {
      expect(opts.get(name)).toBe(true);
    }
  });

  it("(b) without interfaceDefaults a new character keeps the stock table defaults", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const opts = state.options!;
    // Every one of these is `normal:false` in OPTION_ENTRIES.
    for (const name of Object.keys(QOL_DEFAULTS)) {
      expect(opts.get(name)).toBe(false);
    }
  });

  it("(c) the seam refuses BIRTH/CHEAT/SCORE options present in the data", () => {
    const { state } = startGame(pack, {
      seed: 123,
      depth: 1,
      interfaceDefaults: {
        // A legitimate interface default is still applied...
        show_damage: true,
        // ...but these rules/scoring options must be ignored by the filter.
        birth_randarts: true,
        birth_no_artifacts: true,
        cheat_hear: true,
        score_hear: true,
      },
    });
    const opts = state.options!;
    expect(opts.get("show_damage")).toBe(true); // interface: applied
    expect(opts.get("birth_randarts")).toBe(false); // birth: table default
    expect(opts.get("birth_no_artifacts")).toBe(false);
    expect(opts.get("cheat_hear")).toBe(false); // cheat: never set
    expect(opts.get("score_hear")).toBe(false); // score: never set
    // The scoring gate is untouched: no score_* option was flipped.
    expect(opts.anyScoreSet()).toBe(false);
  });
});

describe("filterInterfaceOverrides (defensive gate)", () => {
  it("keeps only INTERFACE-type options and drops everything else", () => {
    const filtered = filterInterfaceOverrides({
      show_damage: true,
      purple_uniques: false,
      birth_randarts: true, // BIRTH
      cheat_hear: true, // CHEAT
      score_hear: true, // SCORE
      does_not_exist: true, // unknown
    });
    expect(filtered).toEqual({ show_damage: true, purple_uniques: false });
  });

  it("ignores non-boolean values", () => {
    const filtered = filterInterfaceOverrides({
      show_damage: "yes" as unknown as boolean,
      show_flavors: 1 as unknown as boolean,
      center_player: true,
    });
    expect(filtered).toEqual({ center_player: true });
  });

  it("an OptionState built from the filter matches a direct new-character build", () => {
    const viaFilter = new OptionState({
      overrides: filterInterfaceOverrides({
        show_damage: true,
        cheat_hear: true, // must be dropped
      }),
    });
    expect(viaFilter.get("show_damage")).toBe(true);
    expect(viaFilter.get("cheat_hear")).toBe(false);
    expect(viaFilter.anyScoreSet()).toBe(false);
  });
});
