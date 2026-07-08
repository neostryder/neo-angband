/**
 * Loads pack zero (the compiled core content) into a CorePack the engine
 * can boot. The pack JSON lives in @neo-angband/content; Vite's glob
 * import inlines every file into the bundle at build time, so the whole
 * game ships as one static asset with no runtime fetch.
 */

import type { CorePack } from "@neo-angband/core";

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

/** Assemble the parsed core pack for bootLevel/bindCore. */
export function loadCorePack(): CorePack {
  return {
    constants: file("constants"),
    terrain: records("terrain"),
    roomTemplates: records("room_template"),
    vaults: records("vault"),
    dungeonProfiles: records("dungeon_profile"),
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
  } as unknown as CorePack;
}
