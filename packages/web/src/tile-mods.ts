/**
 * Discover the graphics tile packs contributed by enabled `tiles`-shape mods.
 *
 * This is the MOD half of the tile-mode list, and only the mod half. Core's own
 * tile sets - the upstream `lib/tiles/list.txt` catalog, which is core game data
 * in 4.2.6 - come from tile-catalog.ts and are offered with no mod enabled. A
 * tiles mod ADDS to that list (or re-skins a row of it); nothing here is
 * required for the game to render in graphics mode, and the game neither knows
 * nor expects any particular mod.
 *
 * A `shape:"tiles"` manifest declares `tilePacks`, each entry naming
 * - `grafID`: the mode's serial number, as a list.txt entry has;
 * - `path`: the BASE its art hangs under, site-root-relative;
 * - `engine`: which renderer draws it - omitted/`tilesheet` for upstream's own
 *   scheme, `linoleum` for a loose pack (this is the pack's RENDERER, not the
 *   manifest's top-level `engine`, which is the game version the mod targets);
 * - `menuname`: the row's label, for a mode the core catalog does not have.
 *
 * The two engines constrain a pack differently, because a tilesheet's metadata
 * (cell size, atlas filename, pref file) lives in upstream's catalog while a
 * loose pack carries its own inside the pack:
 * - a `tilesheet` pack must claim a grafID the CORE catalog knows, and re-skins
 *   that row: the atlas is `<path>/<directory>/<file>` from the catalog entry;
 * - a `linoleum` pack needs only `path` and `menuname` and may claim a grafID of
 *   its own (use >= 100 to stay clear of upstream's list.txt numbering), which
 *   ADDS a row - everything else comes from the pack's manifest.txt.
 *
 * The pure `enabledTileModes` does the work over already-discovered inputs so it
 * is unit-testable; `discoverEnabledTileModes` is the thin browser wrapper that
 * globs the manifests and reads the enabled set from URL/localStorage.
 */

import { getGraphicsMode, GRAPHICS_NONE } from "@neo-angband/core";
import { isShippedMod, resolveEnabledIds } from "./mod-store";
import type { TileEngine } from "./tile-catalog";

/** One selectable tile mode contributed by a tiles mod. */
export interface TileModePack {
  /** grafID (list.txt id) the pack renders as; the atlas metadata source. */
  grafID: number;
  /** Menu label: the mod's own, or the core catalog's for a re-skinned row. */
  menuname: string;
  /** The engine that draws it; absent means the classic tilesheet. */
  engine?: TileEngine;
  /**
   * Base URL the pack's art hangs under (the manifest's `path`), or undefined
   * when it declares none - the shell then falls back to its own tile base,
   * which is only right for a mod that re-registers already-present art.
   */
  baseUrl?: string;
  /** The mod id that contributed this pack. */
  modId: string;
  /**
   * The contributing mod's display name (manifest `name`), falling back to its
   * id. The Graphics menu tags the row with it, so it is visible that the row
   * is not stock content and which mod to disable to be rid of it.
   */
  modName: string;
}

/** A raw tilePacks entry as authored in a tiles mod's manifest.json. */
interface RawTilePack {
  grafID?: unknown;
  path?: unknown;
  engine?: unknown;
  menuname?: unknown;
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
 * The tile modes contributed by the enabled tiles mods, in enabled/load order,
 * deduped by grafID (first contributor wins). Pure: it takes the discovered
 * id->manifest map and the resolved enabled-id list, so it needs no glob or
 * storage. Only `shape:"tiles"` mods contribute, and GRAPHICS_NONE is never
 * takeable - ASCII is not a mod's to replace.
 *
 * A pack is skipped when it could not be rendered anyway: a tilesheet whose
 * grafID the core catalog does not know or that has no atlas filename (its cell
 * size and pref file would be unknown), or a loose pack with no `path` (there
 * would be nowhere to fetch its manifest.txt and assets from).
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
      const path = typeof entry.path === "string" && entry.path ? entry.path : null;
      const declared = typeof entry.menuname === "string" ? entry.menuname.trim() : "";
      const found = getGraphicsMode(grafID);
      const catalogued =
        found && found.grafID !== GRAPHICS_NONE && found.file ? found : null;

      if (entry.engine === "linoleum") {
        // A loose pack brings its own metadata; all it needs from the manifest
        // is where it lives and what to call it (or a catalog row to re-skin).
        if (path === null) continue;
        const menuname = declared || catalogued?.menuname || "";
        if (menuname === "") continue;
        seen.add(grafID);
        out.push({
          grafID,
          menuname,
          engine: "linoleum",
          baseUrl: path,
          modId: id,
          modName,
        });
        continue;
      }

      if (catalogued === null) continue;
      seen.add(grafID);
      out.push({
        grafID,
        menuname: declared || catalogued.menuname,
        ...(path === null ? {} : { baseUrl: path }),
        modId: id,
        modName,
      });
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
 * Glob every bundled mod manifest and resolve the enabled set - the browser-side
 * input for the entry point below.
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
 * call at any time; returns [] when no tiles mod is enabled/discovered, which
 * leaves the Graphics menu showing core's own tile sets.
 */
export function discoverEnabledTileModes(): TileModePack[] {
  return enabledTileModes(discover());
}
