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
 * - `path`: the pack's directory INSIDE THE MOD FOLDER (`original-tiles`,
 *   `tiles/my-set`), or omitted for a pack that is the mod folder itself;
 * - `engine`: which renderer draws it - omitted/`tilesheet` for upstream's own
 *   scheme, `linoleum` for a loose pack (this is the pack's RENDERER, not the
 *   manifest's top-level `engine`, which is the game version the mod targets);
 * - `menuname`: the row's label, for a mode the core catalog does not have.
 *
 * `path` USED TO BE a site-root-relative base URL, and that was wrong in a way
 * only a mod outside the bundle could show: a mod's manifest had to spell out
 * where the SHELL serves it from (`mods/linoleum/original-tiles`), which is
 * something only a bundled mod can know. A mod in a folder the player picked has
 * no URL for its files at all until their bytes are wrapped in a blob:, and one
 * installed from GitHub lives in IndexedDB, which has no path. Declaring a
 * directory inside the mod and letting the SOURCE say how its bytes are reached
 * is the only form that is true for all three. Both engines take the resolver
 * (see PackFileResolver); changing one and not the other would have given the
 * field two meanings depending on which renderer read it.
 *
 * The two engines constrain a pack differently, because a tilesheet's metadata
 * (cell size, atlas filename, pref file) lives in upstream's catalog while a
 * loose pack carries its own inside the pack:
 * - a `tilesheet` pack must claim a grafID the CORE catalog knows, and re-skins
 *   that row: the atlas is `<directory>/<file>` from the catalog entry, resolved
 *   against the pack;
 * - a `linoleum` pack needs only `path` and `menuname` and may claim a grafID of
 *   its own (use >= 100 to stay clear of upstream's list.txt numbering), which
 *   ADDS a row - everything else comes from the pack's manifest.txt.
 *
 * The pure `enabledTileModes` / `mergeModSources` / `contributedTileModes` do the
 * work over already-discovered inputs so they are unit-testable;
 * `discoverEnabledTileModes` is the thin browser wrapper that globs the bundled
 * manifests and reads the enabled set from URL/localStorage.
 */

import { getGraphicsMode, GRAPHICS_NONE } from "@rpgm-tools/neo-angband-core";
import {
  diskPacks,
  type AssetUrlResolver,
  type DiskPackReport,
} from "./disk-packs";
import { engineAllows } from "./mod-engine";
import { isShippedMod, readEnabledModIds } from "./mod-store";
import {
  subPackResolver,
  urlBaseResolver,
  type PackFileResolver,
} from "./pack-files";
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
   * The pack's directory inside the MOD FOLDER (the manifest's `path`), or
   * undefined when the manifest declares none - the shell then falls back to its
   * own tile base, which is only right for a mod that re-registers art already
   * present there.
   */
  path?: string;
  /**
   * How to reach the pack's files, by path relative to the PACK root - the mod's
   * own source composed with `path` (tilePackResolver). Absent when the manifest
   * declared no `path`, or when the mod's source cannot serve assets at all; the
   * shell then falls back to its own tile base.
   *
   * A function rather than a string because two of the three sources have no
   * string to give: see PackFileResolver. `enabledTileModes` is pure and sets no
   * resolver - contributedTileModes attaches one, since only it knows which
   * source each mod came from.
   */
  resolve?: PackFileResolver;
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

/**
 * A manifest's top-level `engine` range, if it declares a readable one.
 *
 * TOP-LEVEL, and that distinction is the whole reason this is a named function: a
 * tiles manifest carries `engine` TWICE with two unrelated meanings. At the root it
 * is a semver range over the GAME's version; inside each `tilePacks` entry it is
 * which renderer draws that pack ("tilesheet" or "linoleum"). Reaching for the wrong
 * one would hand the version gate the string "linoleum".
 */
function readEngineRange(raw: unknown): string | undefined {
  const e = (raw as { engine?: unknown } | null)?.engine;
  return typeof e === "string" ? e : undefined;
}

/**
 * True for a manifest declaring the `tiles` FACET - its `shape`, or a `facets`
 * list containing it. Reads the raw JSON rather than a validated PackManifest
 * because tile discovery runs over the glob before normalisation, so it checks
 * both fields itself instead of borrowing hasFacet.
 */
function isTilesMod(raw: unknown): boolean {
  const m = raw as { shape?: unknown; facets?: unknown } | null;
  if (Array.isArray(m?.facets)) return m.facets.includes("tiles");
  return m?.shape === "tiles";
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
 * size and pref file would be unknown), or a loose pack with no `path` (a loose
 * pack's manifest.txt exists only inside the pack, so there would be nothing to
 * read its metadata from).
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
    /* The third door the engine gate has to cover. A tiles pack is bytes the
     * renderer indexes by grafID and by target name, so one written for a build
     * whose catalogue or naming has moved does not degrade gracefully - it draws
     * the wrong thing, or nothing, with no error anywhere. Same gate, same wording,
     * same single implementation as the content and code paths (mod-engine.ts);
     * pack.ts's engineRefusalsFor is what tells the player, since it runs over
     * every enabled mod regardless of what the mod contributes. */
    const range = readEngineRange(raw);
    if (!engineAllows({ id, ...(range === undefined ? {} : { engine: range }) })) {
      continue;
    }
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
          path,
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
        ...(path === null ? {} : { path }),
        modId: id,
        modName,
      });
    }
  }
  return out;
}

/**
 * Where a mod's own files are reached from - one case per place a mod can come
 * from, and the whole reason `path` is mod-relative.
 *
 * `bundle` is a mod compiled into the site: its folder is copied to
 * `public/mods/<id>/`, so its files have a plain site path and the resolver is
 * string work. `dir` is any mod that arrived through disk-packs.ts - the desktop
 * shell's folder, a folder the player picked, or a mod installed from GitHub -
 * and the only thing that knows how to reach its bytes is the report's own
 * `assetUrl`, which may mint a blob or read IndexedDB.
 */
export type ModAssetSource =
  | { kind: "bundle"; base: string }
  | { kind: "dir"; assetUrl: AssetUrlResolver };

/**
 * The resolver for one contributed tile pack, or null when the pack names no
 * directory of its own.
 *
 * Null is not a failure: a tilesheet mod may re-register a grafID whose art is
 * already where the shell's own tile base points (that is what a `path`-less
 * `tilePacks` entry has always meant), and the caller supplies its own base for
 * that case. A LOOSE pack is never in that position - enabledTileModes drops one
 * with no `path` - because a loose pack's manifest.txt only exists inside the pack.
 *
 * Pure over the source, so the bundle case and the three directory cases are
 * testable without a browser or a mods folder.
 */
export function tilePackResolver(input: {
  source: ModAssetSource;
  modId: string;
  path: string | undefined;
}): PackFileResolver | null {
  if (input.path === undefined || input.path === "") return null;
  if (input.source.kind === "bundle") {
    return urlBaseResolver(`${input.source.base}/${input.modId}/${input.path}`);
  }
  const assetUrl = input.source.assetUrl;
  const modId = input.modId;
  return subPackResolver((rel) => assetUrl(modId, rel), input.path);
}

/**
 * Where the BUNDLE serves a mod's folder from, site-root-relative.
 *
 * `packages/web/mods/<id>/` is copied to `public/mods/<id>/` at build time (and
 * the generated demo tile pack is written straight there), so this is the one
 * place the site path a bundled mod's assets hang under is spelled out. It used
 * to be spelled out in the mod's own manifest, which is what made `path`
 * meaningless for every mod that is not bundled.
 */
export const BUNDLED_MODS_BASE = "mods";

/** Every discoverable mod's manifest, plus where each one's files are reached. */
export interface DiscoveredMods {
  manifests: Map<string, unknown>;
  sources: Map<string, ModAssetSource>;
}

/**
 * Merge the bundled manifests with the packs read from the mods DIRECTORY, and
 * record which source each mod came from.
 *
 * The disk half used to be missing, and the effect was measurable: a player could
 * drop a `shape:"tiles"` pack in the mods folder, see it listed in the manager,
 * enable it, and get no Graphics row, because only the bundle glob was ever
 * consulted (docs/modding/MOD_REACH.md gap 8). The bytes were already served; the
 * registration was not.
 *
 * A disk pack with a bundled pack's id LOSES, the same first-wins rule pack.ts
 * applies when it merges the same two sources - shadowing a first-party mod would
 * let a folder silently redefine what "linoleum" is.
 *
 * Pure over both inputs, so the merge and the resolver it implies are testable
 * without a build-time glob or a real mods folder.
 */
export function mergeModSources(input: {
  bundled: ReadonlyMap<string, unknown>;
  disk: DiskPackReport;
}): DiscoveredMods {
  const manifests = new Map<string, unknown>(input.bundled);
  const sources = new Map<string, ModAssetSource>();
  for (const id of input.bundled.keys()) {
    sources.set(id, { kind: "bundle", base: BUNDLED_MODS_BASE });
  }
  for (const pack of input.disk.packs) {
    const id = pack.manifest.id;
    if (manifests.has(id)) continue;
    manifests.set(id, pack.manifest);
    /* A report with no assetUrl cannot serve a pack's art at all (a data-only
     * source), so such a mod contributes no resolver and its packs fall back to
     * the shell's tile base - which is right for a re-skin and draws nothing for
     * a loose pack, rather than silently reading core's files as if they were
     * the mod's. */
    if (input.disk.assetUrl !== null) {
      sources.set(id, { kind: "dir", assetUrl: input.disk.assetUrl });
    }
  }
  return { manifests, sources };
}

/**
 * The tile modes the enabled tiles mods contribute, each carrying the resolver
 * that reaches ITS files - enabledTileModes plus the per-source resolver.
 *
 * Separate from enabledTileModes so that stays pure over manifests alone, and
 * separate from discover() so the whole chain - merge, select, resolve - is
 * testable without a browser. The only thing left in discover() is reading the
 * glob and the enabled set.
 */
export function contributedTileModes(
  input: DiscoveredMods & { enabledIds: readonly string[] },
): TileModePack[] {
  return enabledTileModes(input).map((pack) => {
    const source = input.sources.get(pack.modId);
    const resolve =
      source === undefined
        ? null
        : tilePackResolver({ source, modId: pack.modId, path: pack.path });
    return resolve === null ? pack : { ...pack, resolve };
  });
}

/**
 * Glob every bundled mod manifest, merge in the mods directory, and resolve the
 * enabled set - the browser-side input for the entry point below.
 */
function discover(): DiscoveredMods & { enabledIds: readonly string[] } {
  const manifestGlob = import.meta.glob("../mods/*/manifest.json", {
    eager: true,
    import: "default",
  }) as Record<string, unknown>;

  const bundled = new Map<string, unknown>();
  for (const [key, val] of Object.entries(manifestGlob)) {
    const m = /\/mods\/([^/]+)\/manifest\.json$/.exec(key);
    if (m && m[1] && isShippedMod(m[1])) bundled.set(m[1], val);
  }

  const disk = diskPacks();
  const merged = mergeModSources({ bundled, disk });
  return {
    ...merged,
    enabledIds: readEnabledModIds({
      discovered: [...merged.manifests.keys()],
      diskOrder: disk.order,
    }),
  };
}

/**
 * Browser entry point: gather every discoverable mod manifest (bundled and from
 * the mods directory), resolve the enabled set, and return the tile modes the
 * enabled tiles mods contribute, each with the resolver that reaches ITS files.
 * Safe to call at any time; returns [] when no tiles mod is enabled/discovered,
 * which leaves the Graphics menu showing core's own tile sets.
 */
export function discoverEnabledTileModes(): TileModePack[] {
  return contributedTileModes(discover());
}
