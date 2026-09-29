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
 *   ADDS a row - everything else comes from the pack's pack.json.
 *
 * The pure `enabledTileModes` / `mergeModSources` / `contributedTileModes` do the
 * work over already-discovered inputs so they are unit-testable;
 * `discoverEnabledTileModes` is the thin browser wrapper that globs the bundled
 * manifests and reads the enabled set from URL/localStorage.
 */

import { getGraphicsMode, GRAPHICS_NONE } from "@rpgm-tools/neo-angband-core";
import type {
  RestoredArt,
  RestoredFlavorArt,
  RestoredItemArt,
  RestoredItemTile,
  RestoredMonsterArt,
} from "@rpgm-tools/neo-angband-core";
import { manifestFields, type LinoleumTilesheetSource } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  diskPacks,
  sessionPacks,
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
  /** Compact source data to turn into this loose pack on its first selection. */
  tilesheet?: LinoleumTilesheetSource;
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
  tilesheet?: unknown;
}

/** Read the validated, compact source declaration without trusting arbitrary JSON. */
function readLinoleumTilesheet(value: unknown): LinoleumTilesheetSource | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source["key"] !== "string" ||
    typeof source["packId"] !== "string" ||
    typeof source["cacheKey"] !== "string" ||
    typeof source["image"] !== "string" ||
    !Array.isArray(source["prefFiles"]) ||
    source["prefFiles"].some((file) => typeof file !== "string") ||
    typeof source["resolution"] !== "number"
  ) {
    return undefined;
  }
  const optional = ["tileWidth", "tileHeight", "overdrawRow", "overdrawMax"] as const;
  if (optional.some((key) => source[key] !== undefined && typeof source[key] !== "number")) return undefined;
  return source as unknown as LinoleumTilesheetSource;
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
 * Dedupe contributed modes by grafID: the LAST contributor's pack wins, at the
 * FIRST claimant's position in the list.
 *
 * THIS USED TO BE FIRST-WINS, AND THAT WAS A DEFECT RATHER THAN A CONVENTION.
 * The mod manager offers a row reading "Move later (loads last, wins conflicts)"
 * (mods.ts), and every other composition layer means it: a content field patch,
 * a coarse patch and a rule flag are all decided by the last writer in load
 * order. Tiles alone did the opposite, so moving a tiles mod later made it LOSE -
 * the player's one lever ran backwards, silently, with no report saying so
 * (grafID collisions were invisible to the conflict report as well).
 *
 * The POSITION stays with the first claimant so the Graphics menu does not
 * reshuffle when the player reorders mods; only which pack draws the mode
 * changes. That mirrors composeTileModes replacing a core row in place.
 */
function lastClaimWins(packs: readonly TileModePack[]): TileModePack[] {
  const at = new Map<number, number>();
  const out: TileModePack[] = [];
  for (const pack of packs) {
    const seen = at.get(pack.grafID);
    if (seen === undefined) {
      at.set(pack.grafID, out.length);
      out.push(pack);
    } else {
      out[seen] = pack;
    }
  }
  return out;
}

/**
 * The tile modes contributed by the enabled tiles mods, in enabled/load order,
 * deduped by grafID (the LAST contributor wins - see lastClaimWins). Pure: it
 * takes the discovered id->manifest map and the resolved enabled-id list, so it
 * needs no glob or storage. Only `shape:"tiles"` mods contribute, and
 * GRAPHICS_NONE is never takeable - ASCII is not a mod's to replace.
 *
 * A pack is skipped when it could not be rendered anyway: a tilesheet whose
 * grafID the core catalog does not know or that has no atlas filename (its cell
 * size and pref file would be unknown), or a loose pack with no `path` (a loose
 * pack's pack.json exists only inside the pack, so there would be nothing to
 * read its metadata from).
 */
export function enabledTileModes(input: {
  manifests: ReadonlyMap<string, unknown>;
  enabledIds: readonly string[];
}): TileModePack[] {
  return lastClaimWins(enabledTileModeClaims(input));
}

/**
 * The same list BEFORE deduping: every mode every enabled tiles mod claims,
 * losers included, in enabled/load order.
 *
 * The conflict report needs the losers - that is the whole point of it - and
 * `enabledTileModes` has already thrown them away. Two mods contesting a grafID
 * used to be invisible: one of them simply did not appear in the Graphics menu
 * and nothing anywhere said which, or why.
 */
export function enabledTileModeClaims(input: {
  manifests: ReadonlyMap<string, unknown>;
  enabledIds: readonly string[];
}): TileModePack[] {
  const out: TileModePack[] = [];
  for (const id of input.enabledIds) {
    const raw = input.manifests.get(id);
    if (!raw) continue;
    if (!isTilesMod(raw)) continue;
    /* The third door the engine gate has to cover. Same gate, same wording, same
     * single implementation as the content and code paths (mod-engine.ts);
     * pack.ts's engineProblemsFor is what tells the player, since it runs over
     * every enabled mod regardless of what the mod contributes.
     *
     * A TILES PACK IS DATA, so as of 2026-08-02 an out-of-range `engine` labels
     * it and does not skip it - and that reverses what this comment used to
     * argue. The old claim was that a tiles pack written for a build whose
     * naming has moved "does not degrade gracefully - it draws the wrong thing,
     * or nothing, with no error anywhere". Weighed against the alternative, that
     * is the better failure: a stale mapping loses individual tiles to the ASCII
     * fallback, which the player can SEE, whereas refusing the pack loses all of
     * them and is the outcome the player cannot fix. Pictures are the least
     * version-sensitive thing a mod ships; making a tileset go dark on an engine
     * patch its author never saw is the exact cost this pass exists to remove. */
    const range = readEngineRange(raw);
    if (!engineAllows({ id, ...(range === undefined ? {} : { engine: range }) })) {
      continue;
    }
    const modName = readModName(raw, id);
    for (const entry of readTilePacks(raw)) {
      const grafID = typeof entry.grafID === "number" ? entry.grafID : NaN;
      if (!Number.isFinite(grafID) || grafID === GRAPHICS_NONE) continue;
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
        const tilesheet = readLinoleumTilesheet(entry.tilesheet);
        out.push({
          grafID,
          menuname,
          engine: "linoleum",
          path,
          ...(tilesheet === undefined ? {} : { tilesheet }),
          modId: id,
          modName,
        });
        continue;
      }

      if (catalogued === null) continue;
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
 * with no `path` - because a loose pack's pack.json only exists inside the pack.
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
  /* Unwrapped here, so every reader of the map sees the manifest fields whether
   * the file is a bare manifest or a neo-angband/mod/manifest document. */
  const manifests = new Map<string, unknown>([...input.bundled].map(([id, raw]) => [id, manifestFields(raw) ?? raw]));
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
 *
 * EXPORTED, because tiles are no longer the only thing discovered this way: the
 * resource seam (mod-resources.ts) needs the identical merge of bundle and disk,
 * the identical enabled-set resolution, and the identical per-source asset
 * resolver. A second copy of this glob would be a second answer to "which mods
 * are there", and the two would part the first time either changed. The disk
 * report rides along because a report knows which FILES each pack holds, which
 * is how a declared resource can be checked for existence without fetching it.
 */
export function discoverMods(): DiscoveredMods & {
  enabledIds: readonly string[];
  disk: DiskPackReport;
} {
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
    disk,
    enabledIds: readEnabledModIds({
      discovered: [...merged.manifests.keys()],
      diskOrder: disk.order,
      /* Same forced set the composer uses (pack.ts): a tiles mod staged for this
       * session has to contribute its Graphics row, or it would be enabled by one
       * answer and disabled by the other in the same launch - which is the exact
       * drift readEnabledModIds was made one function to prevent. */
      forced: sessionPacks().packs.map((p) => p.manifest.id),
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
  return contributedTileModes(discoverMods());
}

/**
 * Every grafID every enabled tiles mod claims, LOSERS INCLUDED, for the conflict
 * report. No resolver is attached: nothing here is going to be drawn, it is
 * going to be described.
 */
export function discoverEnabledTileModeClaims(): TileModePack[] {
  return enabledTileModeClaims(discoverMods());
}

/** One pack's tile off a raw manifest entry, or undefined when it is malformed. */
function readRestoredTile(value: unknown): RestoredItemTile | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const tile = value as { row?: unknown; col?: unknown; asset?: unknown };
  if (Number.isInteger(tile.row) && Number.isInteger(tile.col)) {
    return { row: tile.row as number, col: tile.col as number };
  }
  if (typeof tile.asset === "string") return { asset: tile.asset };
  return undefined;
}

function readRestoredPacks(value: unknown): Record<string, RestoredItemTile> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const packs: Record<string, RestoredItemTile> = {};
  for (const [pack, raw] of Object.entries(value)) {
    const tile = readRestoredTile(raw);
    if (tile !== undefined) packs[pack] = tile;
  }
  return packs;
}

function readHue(value: unknown): { hue?: number } {
  return typeof value === "number" && Number.isFinite(value) ? { hue: value } : {};
}

/** The three restored-art lists off a raw manifest, skipping malformed entries. */
function readRestoredArt(raw: unknown): {
  items: RestoredItemArt[];
  monsters: RestoredMonsterArt[];
  flavors: RestoredFlavorArt[];
} {
  const m = (raw ?? {}) as { restoredItemArt?: unknown; restoredMonsterArt?: unknown; restoredFlavorArt?: unknown };
  const entries = (list: unknown): Record<string, unknown>[] =>
    Array.isArray(list)
      ? list.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
      : [];
  const items: RestoredItemArt[] = [];
  for (const e of entries(m.restoredItemArt)) {
    const packs = readRestoredPacks(e["packs"]);
    if (typeof e["kind"] === "string" && packs) items.push({ kind: e["kind"], packs, ...readHue(e["hue"]) });
  }
  const monsters: RestoredMonsterArt[] = [];
  for (const e of entries(m.restoredMonsterArt)) {
    const packs = readRestoredPacks(e["packs"]);
    if (typeof e["race"] === "string" && packs) monsters.push({ race: e["race"], packs, ...readHue(e["hue"]) });
  }
  const flavors: RestoredFlavorArt[] = [];
  for (const e of entries(m.restoredFlavorArt)) {
    if (!Number.isInteger(e["flavor"])) continue;
    const packs = readRestoredPacks(e["packs"]);
    flavors.push({
      flavor: e["flavor"] as number,
      ...(packs ? { packs } : {}),
      ...(Number.isInteger(e["drawAs"]) ? { drawAs: e["drawAs"] as number } : {}),
      ...readHue(e["hue"]),
    });
  }
  return { items, monsters, flavors };
}

function modAssetResolver(source: ModAssetSource, modId: string): PackFileResolver {
  if (source.kind === "bundle") return urlBaseResolver(`${source.base}/${modId}`);
  return (rel) => source.assetUrl(modId, rel);
}

/**
 * Resolve enabled mods' restored art (kinds, races, flavours) for the active
 * pack before fillers run. Each declaration keeps only the active pack's tile,
 * with an asset path turned into a URL the renderer can load; an asset that
 * does not resolve is dropped, leaving the slot to the fillers.
 */
export async function restoredArtForPack(pack: string): Promise<Required<RestoredArt>> {
  const discovered = discoverMods();
  const out = {
    items: [] as RestoredItemArt[],
    monsters: [] as RestoredMonsterArt[],
    flavors: [] as RestoredFlavorArt[],
  };
  for (const id of discovered.enabledIds) {
    const raw = discovered.manifests.get(id);
    if (raw === undefined) continue;
    /* Only an asset path needs the mod's files; a cell or a drawAs does not. */
    const source = discovered.sources.get(id);
    const resolve = source === undefined ? null : modAssetResolver(source, id);
    const forPack = async (packs: Readonly<Record<string, RestoredItemTile>> | undefined) => {
      const tile = packs?.[pack];
      if (tile === undefined) return undefined;
      if (!("asset" in tile)) return { [pack]: tile };
      let asset: string | null;
      try { asset = resolve === null ? null : await resolve(tile.asset); } catch { asset = null; }
      return asset === null ? null : { [pack]: { asset } };
    };
    const art = readRestoredArt(raw);
    for (const item of art.items) {
      const packs = await forPack(item.packs);
      if (packs) out.items.push({ ...item, packs });
    }
    for (const monster of art.monsters) {
      const packs = await forPack(monster.packs);
      if (packs) out.monsters.push({ ...monster, packs });
    }
    for (const flavor of art.flavors) {
      const packs = await forPack(flavor.packs);
      if (packs) out.flavors.push({ ...flavor, packs });
      else if (flavor.drawAs !== undefined) {
        const { packs: _unused, ...rest } = flavor;
        out.flavors.push(rest);
      }
    }
  }
  return out;
}
