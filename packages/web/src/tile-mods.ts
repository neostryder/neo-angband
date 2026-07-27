/**
 * Discover the graphics tile packs contributed by enabled `tiles`-shape mods.
 *
 * The bundled freely-licensed tilesets (old / adam-bolt / gervais / nomad) live
 * under public/tiles/ and are catalogued as graphics-mode METADATA in core
 * (visuals/grafmode). The neo-linoleum mod (packages/web/mods/linoleum) is the
 * REGISTRY of record for which of those packs are offered: its manifest.json
 * enumerates them as `tilePacks` (by grafID + path). This module reads the
 * enabled-mod set exactly the way the content composer does (mod-store's shared
 * resolver) and, for every enabled tiles mod, turns its `tilePacks` into the
 * selectable tile modes the Options tile-mode selector shows - so a user picks
 * a graphics set from the mod, not only via the ?tiles=/?graf= URL override.
 *
 * When the linoleum mod is disabled (or removed), it contributes nothing and
 * the selector falls back to ASCII-only (plus any URL override), which is the
 * point of shipping graphics AS a removable mod. Shockbolt is never surfaced:
 * the manifest does not list it, and any grafID that resolves to the shockbolt
 * directory is filtered out here as defence in depth (its licence forbids
 * redistribution, so its assets are not bundled).
 *
 * The pure `enabledTileModes` does the work over already-discovered inputs so
 * it is unit-testable; `discoverEnabledTileModes` is the thin browser wrapper
 * that globs the manifests and reads the enabled set from URL/localStorage.
 */

import { getGraphicsMode, GRAPHICS_NONE } from "@neo-angband/core";
import { isShippedMod, resolveEnabledIds } from "./mod-store";

/** One selectable tile mode contributed by a tiles mod. */
export interface TileModePack {
  /** grafID (list.txt id) the pack renders as; the atlas metadata source. */
  grafID: number;
  /** Menu label (from the core graphics-mode catalog). */
  menuname: string;
  /** The mod id that contributed this pack. */
  modId: string;
  /**
   * The contributing mod's display name (manifest `name`, e.g. "neo-linoleum"),
   * falling back to its id. The Graphics menu shows this beside the pack so it
   * is visible WHERE the tiles come from: the packs are not core content, and a
   * bare "Original Tiles / Adam Bolt's tiles / ..." list gives the player no way
   * to tell that they appeared because a mod is enabled - or which mod to
   * disable to make them go away.
   */
  modName: string;
}

/** A tiles mod that is installed, whether or not it is currently enabled. */
export interface TileModProvider {
  id: string;
  /** manifest `name`, falling back to the id. */
  name: string;
  /** How many tile packs it declares (before licence/unknown-grafID filtering). */
  packCount: number;
  enabled: boolean;
}

/** A raw tilePacks entry as authored in a tiles mod's manifest.json. */
interface RawTilePack {
  grafID?: unknown;
}

/** Read a tiles mod manifest's tilePacks array, tolerating any shape. */
function readTilePacks(raw: unknown): RawTilePack[] {
  const packs = (raw as { tilePacks?: unknown } | null)?.tilePacks;
  return Array.isArray(packs) ? (packs as RawTilePack[]) : [];
}

/** A manifest's display name, or the mod id when it declares none. */
function readModName(raw: unknown, id: string): string {
  const name = (raw as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() !== "" ? name : id;
}

/** True for a `shape:"tiles"` manifest (the only shape contributing tile packs). */
function isTilesMod(raw: unknown): boolean {
  return (raw as { shape?: unknown } | null)?.shape === "tiles";
}

/**
 * Every installed tiles mod with its enabled state, in discovery order. The
 * Graphics menu uses the DISABLED ones to explain an otherwise dead-end screen:
 * with no tiles mod on, that menu offers ASCII and nothing else, and the player
 * has no way to know the tilesets live in a mod they have to enable first.
 */
export function tileModProviders(input: {
  manifests: ReadonlyMap<string, unknown>;
  enabledIds: readonly string[];
}): TileModProvider[] {
  const out: TileModProvider[] = [];
  for (const [id, raw] of input.manifests) {
    if (!isTilesMod(raw)) continue;
    out.push({
      id,
      name: readModName(raw, id),
      packCount: readTilePacks(raw).length,
      enabled: input.enabledIds.includes(id),
    });
  }
  return out;
}

/**
 * The tile modes contributed by the enabled tiles mods, in enabled/load order,
 * deduped by grafID (first contributor wins). Pure: it takes the discovered
 * id->manifest map and the resolved enabled-id list, so it needs no glob or
 * storage. Only `shape:"tiles"` mods contribute; a grafID that is unknown,
 * GRAPHICS_NONE, or resolves to the (unbundled) shockbolt directory is skipped.
 */
export function enabledTileModes(input: {
  manifests: ReadonlyMap<string, unknown>;
  enabledIds: readonly string[];
}): TileModePack[] {
  const out: TileModePack[] = [];
  const seen = new Set<number>();
  for (const id of input.enabledIds) {
    const raw = input.manifests.get(id);
    if (!raw) continue;
    if (!isTilesMod(raw)) continue;
    const modName = readModName(raw, id);
    for (const entry of readTilePacks(raw)) {
      const grafID = typeof entry.grafID === "number" ? entry.grafID : NaN;
      if (!Number.isFinite(grafID) || grafID === GRAPHICS_NONE) continue;
      if (seen.has(grafID)) continue;
      const mode = getGraphicsMode(grafID);
      if (!mode || mode.grafID === GRAPHICS_NONE || !mode.file) continue;
      if (mode.directory === "shockbolt") continue; // never bundled
      seen.add(grafID);
      out.push({ grafID, menuname: mode.menuname, modId: id, modName });
    }
  }
  return out;
}

/**
 * Read the effective enabled-mod id list from URL (?mods=a,b) / localStorage /
 * first-run defaults, using the same shared resolver as the content composer
 * (mod-store.resolveEnabledIds) so both surfaces agree on what is enabled.
 */
function readEnabledIds(discovered: readonly string[]): string[] {
  let url: string[] | null = null;
  try {
    const raw = new URLSearchParams(location.search).get("mods");
    if (raw !== null) url = raw.split(",").map((s) => s.trim()).filter(Boolean);
  } catch {
    /* no location (non-browser host) */
  }
  let stored: string[] | null = null;
  try {
    const raw = localStorage.getItem("neo:enabledMods");
    if (raw !== null) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        stored = arr.filter((s): s is string => typeof s === "string");
      }
    }
  } catch {
    /* no localStorage */
  }
  return resolveEnabledIds({ url, stored, discovered });
}

/**
 * Glob every bundled mod manifest and resolve the enabled set - the shared
 * browser-side input for both public entry points below.
 */
function discover(): {
  manifests: Map<string, unknown>;
  enabledIds: readonly string[];
} {
  const manifestGlob = import.meta.glob("../mods/*/manifest.json", {
    eager: true,
    import: "default",
  }) as Record<string, unknown>;

  const manifests = new Map<string, unknown>();
  for (const [key, val] of Object.entries(manifestGlob)) {
    const m = /\/mods\/([^/]+)\/manifest\.json$/.exec(key);
    if (m && m[1] && isShippedMod(m[1])) manifests.set(m[1], val);
  }

  return { manifests, enabledIds: readEnabledIds([...manifests.keys()]) };
}

/**
 * Browser entry point: glob every bundled mod manifest, resolve the enabled
 * set, and return the tile modes the enabled tiles mods contribute. Safe to
 * call at any time; returns [] when no tiles mod is enabled/discovered.
 */
export function discoverEnabledTileModes(): TileModePack[] {
  return enabledTileModes(discover());
}

/**
 * Browser entry point: every installed tiles mod with its enabled state, so the
 * Graphics menu can name the mod a pack comes from and point at the one that
 * would supply more.
 */
export function discoverTileModProviders(): TileModProvider[] {
  return tileModProviders(discover());
}
