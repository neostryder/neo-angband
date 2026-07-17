/**
 * Two things this suite pins after the mod-scope reset (2026-07-16):
 *
 *  1. FAITHFUL CORE OPTIONS. Every upstream Angband option ships in core with
 *     its upstream default (OPTION_ENTRIES.normal) - the qol mod does NOT
 *     redefine option defaults (that was the earlier mistake). A new character
 *     gets exactly the table defaults; there is no interface-defaults override
 *     seam any more.
 *
 *  2. THE modRules SEAM. startGame / loadGame accept the host-resolved mod-rule
 *     flags and seed GameState.modRules with a COPY; absent = faithful (no map).
 *     This is the declarative bundled-mod mechanism (qol / bug-fixes).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game";
import type { GamePack } from "./game";
import { OPTION_ENTRIES } from "../generated/options";

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

describe("faithful core option defaults", () => {
  it("a new character gets the upstream OPTION_ENTRIES.normal default for every option", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const opts = state.options!;
    for (const entry of OPTION_ENTRIES) {
      expect(opts.get(entry.name)).toBe(entry.normal);
    }
  });

  it("options that were briefly mislabelled QoL are plain core options at their upstream default", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const opts = state.options!;
    // These are all upstream INTERFACE options; core ships them at the exact
    // upstream default, whatever it is (the qol mod must not touch them).
    for (const name of [
      "show_damage",
      "show_flavors",
      "center_player",
      "purple_uniques",
      "effective_speed",
      "notify_recharge",
      "auto_more",
    ]) {
      const entry = OPTION_ENTRIES.find((e) => e.name === name)!;
      expect(opts.get(name)).toBe(entry.normal);
    }
  });
});

describe("startGame modRules seam (declarative bundled-mod mechanism)", () => {
  it("seeds GameState.modRules from opts.modRules", () => {
    const { state } = startGame(pack, {
      seed: 123,
      depth: 1,
      modRules: { "qol.autoDig": true, "bugfix.duplicateArtifact": true },
    });
    expect(state.modRules).toEqual({
      "qol.autoDig": true,
      "bugfix.duplicateArtifact": true,
    });
  });

  it("leaves modRules absent (faithful 4.2.6) when none are supplied", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    expect(state.modRules).toBeUndefined();
  });

  it("copies the map so later menu toggles do not mutate the caller's object", () => {
    const supplied = { "qol.autoDig": true };
    const { state } = startGame(pack, { seed: 123, depth: 1, modRules: supplied });
    state.modRules!["qol.autoDig"] = false;
    expect(supplied["qol.autoDig"]).toBe(true); // caller's copy untouched
  });
});
