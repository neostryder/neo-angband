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
import {
  composeContentPacks,
  computeConflictReport,
  resolveLoadOrder,
} from "@neo-angband/mod-sdk";
import type { LoadedPack, PackContent, PackManifest } from "@neo-angband/mod-sdk";

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

/* ------------------------------------------------------------------ *
 * Mods (W1.3): bundled packs under packages/web/mods/<id>/, disabled by
 * default. Enable with ?mods=a,b (wins) or localStorage neo:enabledMods.
 * The full mod-manager UI (enable/reorder/consent) is W2.4.
 * ------------------------------------------------------------------ */

const modManifestGlob = import.meta.glob("../mods/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const modFileGlob = import.meta.glob("../mods/*/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** modId -> { manifest, files } gathered from packages/web/mods/<id>/. */
function discoverMods(): Map<
  string,
  { manifest: unknown; files: Record<string, unknown> }
> {
  const mods = new Map<
    string,
    { manifest: unknown; files: Record<string, unknown> }
  >();
  for (const [key, val] of Object.entries(modManifestGlob)) {
    const m = /\/mods\/([^/]+)\/manifest\.json$/.exec(key);
    if (m && m[1]) mods.set(m[1], { manifest: val, files: {} });
  }
  for (const [key, val] of Object.entries(modFileGlob)) {
    const m = /\/mods\/([^/]+)\/([^/]+)\.json$/.exec(key);
    if (!m || !m[1] || !m[2] || m[2] === "manifest") continue;
    const mod = mods.get(m[1]);
    if (mod) mod.files[m[2]] = val;
  }
  return mods;
}

/**
 * The manifests of every bundled CONTENT/tiles mod under packages/web/mods/,
 * for the mod-manager catalog (W2.4). Normalized via modManifest so callers get
 * a real PackManifest; the manager merges these with the plugin/trusted lists.
 */
export function discoverContentModManifests(): PackManifest[] {
  const out: PackManifest[] = [];
  for (const [, mod] of discoverMods()) {
    const m = modManifest(mod.manifest);
    // Plugins are surfaced by discoverPlugins/discoverTrustedPlugins; here we
    // list only content/tiles packs so the catalog does not double-count.
    if (m.shape !== "plugin") out.push(m);
  }
  return out;
}

/**
 * The human-readable conflict lines (P7.6) for a chosen enabled CONTENT set,
 * for the mod-manager conflicts pane. Builds the ordered LoadedPack set for the
 * given ids (core + enabled content mods), resolves load order, and runs
 * computeConflictReport, returning its prebuilt humanLines. Add-only mods and a
 * single contributor produce none. Returns the error text (not a throw) when a
 * dependency is missing or the order cannot resolve, so the UI can show it.
 */
export function modConflictLines(enabledIds: readonly string[]): string[] {
  const mods = discoverMods();
  const packs: LoadedPack[] = [coreLoadedPack()];
  for (const id of enabledIds) {
    const mod = mods.get(id);
    if (!mod) continue;
    const manifest = modManifest(mod.manifest);
    if (manifest.shape === "plugin") continue; // plugins contribute no records
    packs.push({
      manifest,
      files: mod.files as unknown as LoadedPack["files"],
    });
  }
  try {
    const ordered = resolveLoadOrder(packs.map((p) => p.manifest));
    const byId = new Map(packs.map((p) => [p.manifest.id, p]));
    const contents = ordered.map((m) => {
      const p = byId.get(m.id) as LoadedPack;
      return { manifest: p.manifest, files: p.files } as unknown as PackContent;
    });
    return computeConflictReport(contents).records.flatMap((r) => r.humanLines);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
}

/** Enabled mod ids: URL ?mods=a,b wins; else localStorage; else none. */
function enabledModIds(): string[] {
  try {
    const url = new URLSearchParams(location.search).get("mods");
    if (url !== null) {
      return url.split(",").map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    /* no location (non-browser host) */
  }
  try {
    const raw = localStorage.getItem("neo:enabledMods");
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        return arr.filter((s): s is string => typeof s === "string");
      }
    }
  } catch {
    /* no localStorage */
  }
  return [];
}

function modManifest(raw: unknown): PackManifest {
  const m = raw as Partial<PackManifest> & { id?: string };
  return {
    id: m.id ?? "mod",
    name: m.name ?? m.id ?? "mod",
    version: m.version ?? "0.0.0",
    shape: m.shape ?? "content",
    ...(m.engine ? { engine: m.engine } : {}),
    ...(m.dependencies ? { dependencies: m.dependencies } : {}),
  };
}

/** The ordered LoadedPack set: core first, then each enabled mod. */
function activePackSet(): LoadedPack[] {
  const packs: LoadedPack[] = [coreLoadedPack()];
  const mods = discoverMods();
  for (const id of enabledModIds()) {
    const mod = mods.get(id);
    if (!mod) {
      console.warn(`[mods] enabled mod "${id}" not found; skipping`);
      continue;
    }
    packs.push({
      manifest: modManifest(mod.manifest),
      files: mod.files as unknown as LoadedPack["files"],
    });
  }
  return packs;
}

/**
 * The active pack set, composed once at module load. Core alone is
 * record-identical; enabled mods add/patch/replace/remove through the
 * mod-sdk compose engine.
 */
const composed = composeContentPacks(activePackSet());

// DEV-only diagnostic: proves an enabled mod's changes reach the running
// game's content. Stripped from production builds (import.meta.env.DEV).
if (import.meta.env.DEV) {
  const monsters = composed.records["monster"] as
    | { name?: string; "hit-points"?: number }[]
    | undefined;
  const grip = monsters?.find(
    (r) => typeof r.name === "string" && r.name.startsWith("Grip"),
  );
  (globalThis as Record<string, unknown>)["__neoPack"] = {
    enabledMods: enabledModIds(),
    monsterCount: monsters?.length ?? 0,
    grip: grip ? { name: grip.name, hp: grip["hit-points"] } : null,
    hasModberry: !!monsters?.some((r) => r.name === "Modberry Slime"),
  };
}

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
