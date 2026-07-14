/**
 * Loads the active pack set into a GamePack the engine can start.
 *
 * The compiled pack JSON lives in @neo-angband/content; Vite's glob import
 * inlines every file into the bundle at build time, so the whole game ships as
 * one static asset with no runtime fetch.
 *
 * As of MOD_INTEGRATION_PLAN.md Wave 1, the base game is no longer bound
 * directly: it flows through the mod compose pipeline as "pack zero"
 * (composeContentPacks -> merged per-file records -> GamePack -> core
 * bindCore). With only core loaded the composed output is record-identical, so
 * this is a no-op today; it is the seam mods plug into (W1.3). Core stays
 * mod-sdk-agnostic - this host module owns the glue.
 */

import type { GamePack, UiEntryPackRecords } from "@neo-angband/core";
import { composeContentPacks } from "@neo-angband/mod-sdk";
import type { LoadedPack, PackManifest } from "@neo-angband/mod-sdk";

// Eagerly import every compiled pack file. Keys are module paths; values
// are the parsed JSON (the file's default export).
const files = import.meta.glob("../../content/pack/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** Parsed pack files keyed by basename without extension ("monster", ...). */
const byName = new Map<string, unknown>();
for (const [key, val] of Object.entries(files)) {
  const m = /([^/]+)\.json$/.exec(key);
  if (m && m[1]) byName.set(m[1], val);
}

function rawFile(name: string): unknown {
  const f = byName.get(name);
  if (f === undefined) throw new Error(`pack file not found: ${name}.json`);
  return f;
}

/** The on-disk manifest (manifest.json) adapted to a PackManifest. */
function coreManifest(): PackManifest {
  const m = byName.get("manifest") as
    | { id?: string; name?: string; version?: string; engine?: string }
    | undefined;
  return {
    id: m?.id ?? "core",
    name: m?.name ?? "Angband",
    version: m?.version ?? "0.0.0",
    shape: "content",
    ...(m?.engine ? { engine: m.engine } : {}),
  };
}

/** The base game as a LoadedPack: every record-bearing file, records-only. */
function coreLoadedPack(): LoadedPack {
  const contrib: Record<string, { records: unknown[] }> = {};
  for (const [name, val] of byName) {
    if (name === "manifest") continue;
    const recs = (val as { records?: unknown[] }).records;
    if (Array.isArray(recs)) contrib[name] = { records: recs };
  }
  return { manifest: coreManifest(), files: contrib } as unknown as LoadedPack;
}

/**
 * The active pack set, composed once at module load. Today it is core alone;
 * W1.3 discovers and appends enabled mod packs before this call. With one pack
 * the merge is record-identical to the raw content.
 */
const composed = composeContentPacks([coreLoadedPack()]);

function records(name: string): unknown[] {
  const recs = composed.records[name];
  if (!recs) throw new Error(`pack file not found: ${name}.json`);
  return recs;
}

/**
 * A whole-file object with its records replaced by the composed set, keeping
 * any file-level header/source. Used for the files the binders consume as a
 * `{ header?, records }` object rather than a bare record array (constants and
 * the object sub-files).
 */
function composedFile(name: string): unknown {
  return { ...(rawFile(name) as object), records: records(name) };
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

/**
 * The ui_entry* + object_property/player_property record sets buildUiEntryConfig
 * needs (game/ui-entry.ts): the property-grid backend behind the equip-cmp
 * screen and the (not yet shell-wired) second character screen.
 */
export function loadUiEntryPacks(): UiEntryPackRecords {
  return {
    uiEntry: records("ui_entry"),
    uiEntryBase: records("ui_entry_base"),
    uiEntryRenderer: records("ui_entry_renderer"),
    objectProperty: records("object_property"),
    playerProperty: records("player_property"),
  } as unknown as UiEntryPackRecords;
}

/** Assemble the parsed game pack for startGame (core content + player). */
export function loadGamePack(): GamePack {
  return {
    constants: composedFile("constants"),
    terrain: records("terrain"),
    roomTemplates: records("room_template"),
    vaults: records("vault"),
    dungeonProfiles: records("dungeon_profile"),
    projection: records("projection"),
    trap: records("trap"),
    names: records("names"),
    store: records("store"),
    obj: {
      objectBase: composedFile("object_base"),
      object: composedFile("object"),
      egoItem: composedFile("ego_item"),
      artifact: composedFile("artifact"),
      curse: composedFile("curse"),
      brand: composedFile("brand"),
      slay: composedFile("slay"),
      activation: composedFile("activation"),
      objectProperty: composedFile("object_property"),
      flavor: composedFile("flavor"),
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
