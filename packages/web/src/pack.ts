/**
 * Loads pack zero (the compiled core content) into a GamePack the engine
 * can start. The pack JSON lives in @neo-angband/content; Vite's glob
 * import inlines every file into the bundle at build time, so the whole
 * game ships as one static asset with no runtime fetch.
 */

import type { GamePack } from "@neo-angband/core";

// Eagerly import every compiled pack file. Keys are module paths; values
// are the parsed JSON (the file's default export).
const files = import.meta.glob("../../content/pack/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

function file(name: string): unknown {
  const key = Object.keys(files).find((k) => k.endsWith(`/${name}.json`));
  if (!key) throw new Error(`pack file not found: ${name}.json`);
  return files[key];
}

function records(name: string): unknown[] {
  return (file(name) as { records: unknown[] }).records;
}

/**
 * The compiled visuals.txt record (records[0] of visuals.json): the flicker
 * cycles and grouped color cycles the animation engine consumes. Returns null
 * if the pack ships no visuals.json, so the caller can degrade to no animation.
 */
export function loadVisualsRecord(): unknown {
  try {
    return records("visuals")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The per-race color-cycle assignments from monster.txt: each monster record's
 * `color-cycle:<group>:<cycle>`, keyed by ridx (the record index, which the
 * core binder uses as MonsterRace.ridx). Mirrors mon-init.c
 * parse_monster_color_cycle -> visuals_cycler_set_cycle_for_race.
 */
export function loadMonsterColorCycles(): {
  ridx: number;
  group: string;
  cycle: string;
}[] {
  const out: { ridx: number; group: string; cycle: string }[] = [];
  const monsters = records("monster") as {
    "color-cycle"?: { group: string; cycle: string };
  }[];
  for (let ridx = 0; ridx < monsters.length; ridx++) {
    const cc = monsters[ridx]?.["color-cycle"];
    if (cc && cc.group && cc.cycle) {
      out.push({ ridx, group: cc.group, cycle: cc.cycle });
    }
  }
  return out;
}

/** Assemble the parsed game pack for startGame (core content + player). */
export function loadGamePack(): GamePack {
  return {
    constants: file("constants"),
    terrain: records("terrain"),
    roomTemplates: records("room_template"),
    vaults: records("vault"),
    dungeonProfiles: records("dungeon_profile"),
    projection: records("projection"),
    trap: records("trap"),
    names: records("names"),
    obj: {
      objectBase: file("object_base"),
      object: file("object"),
      egoItem: file("ego_item"),
      artifact: file("artifact"),
      curse: file("curse"),
      brand: file("brand"),
      slay: file("slay"),
      activation: file("activation"),
      objectProperty: file("object_property"),
      flavor: file("flavor"),
    },
    mon: {
      pain: records("pain"),
      blowMethods: records("blow_methods"),
      blowEffects: records("blow_effects"),
      monsterSpells: records("monster_spell"),
      monsterBases: records("monster_base"),
      monsters: records("monster"),
      summons: records("summon"),
      pits: records("pit"),
    },
    player: {
      races: records("p_race"),
      classes: records("class"),
      properties: records("player_property"),
      timed: records("player_timed"),
      shapes: records("shape"),
      bodies: records("body"),
      history: records("history"),
      realms: records("realm"),
    },
  } as unknown as GamePack;
}
