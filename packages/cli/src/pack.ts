/**
 * Content-pack loader for the developer harnesses.
 *
 * Reads the compiled core content pack (packages/content/pack/*.json) off
 * disk and assembles the GamePack shape startGame / bindCore expect. This is
 * the same pack-zero assembly the core test suite performs
 * (packages/core/src/session/{boot,game}.test.ts); it lives here so the stats
 * harness, the golden-scenario runner and the parity test all share one
 * loader instead of each re-listing the ~40 pack files.
 *
 * Pure Node fs - no web, no fetch. The relative URL resolves the same from the
 * TypeScript source (vitest) and the built dist/ module: two levels up from
 * either packages/cli/src or packages/cli/dist lands on packages/, and
 * content/pack is packages/content/pack.
 */

import { readFileSync } from "node:fs";
import type { GamePack } from "@neo-angband/core";

/** packages/content/pack, resolved relative to this module (src or dist). */
const PACK_DIR = new URL("../../content/pack/", import.meta.url);

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`${name}.json`, PACK_DIR), "utf8")) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

/**
 * Assemble the full game pack (core content plus the player-domain records)
 * exactly as a host would hand it to startGame.
 */
export function loadGamePack(): GamePack {
  return {
    constants: loadJson("constants"),
    terrain: loadRecords("terrain"),
    roomTemplates: loadRecords("room_template"),
    vaults: loadRecords("vault"),
    dungeonProfiles: loadRecords("dungeon_profile"),
    projection: loadRecords("projection"),
    trap: loadRecords("trap"),
    names: loadRecords("names"),
    store: loadRecords("store"),
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
  };
}
