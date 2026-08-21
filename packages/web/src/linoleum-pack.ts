/**
 * The loose-pack tile ENGINE: the second of the two ways this shell can draw
 * graphics.
 *
 * Engine one is the classic tilesheet (tiles.ts TileSet): one big PNG, and a
 * graf-*.prf that maps every entity to an (attr, char) pair whose low 7 bits
 * are the atlas row and column - upstream's own scheme (ui-prefs.c x_attr /
 * x_char, decoded at blit exactly as main-win.c does). Every tile set the game
 * itself ships is drawn that way, and always will be: it is what upstream data
 * describes.
 *
 * Engine two is this one. A loose pack is a DIRECTORY of individual PNGs plus
 * readable text maps, addressed by name instead of by pixel coordinate:
 *
 *   manifest.txt          pack:<id>:<display>, format:png, resolution:<n>,
 *                         map:targets|families|pools|tall:<relative path>
 *   maps/targets.txt      target:<type>:<selector>:asset|family|pool:<value>
 *   maps/pools.txt        pool:<id>:selection:stable|index, pool:<id>:member:<asset>
 *   maps/families.txt     family:<id>:asset:<asset> (+ effect metadata)
 *   maps/tall.txt         tall:<asset>, the double-height (overdraw) assets
 *   images/<res>/<asset>.png
 *
 * The point of the format is authoring: a set can be edited one file at a time,
 * a `pool` lets ONE selector draw from several tiles (chosen by map position, so
 * it is identical on every replay of a seed), and nothing has to be packed into
 * a sheet at fixed coordinates. The format, its parsers and the converter that
 * builds a pack out of a legacy tilesheet live in @rpgm-tools/neo-angband-linoleum; this
 * module is the part that draws one.
 *
 * HOW IT REUSES THE PORTED LOOKUP. A loose pack's `selector` is exactly the
 * middle of the legacy pref line it came from (`FLOOR:lit`, `Farmer Maggot`,
 * `ELEC:0`, `light:Wooden Torch`), so resolving a selector to an entity is the
 * work core's pref parser already does faithfully (visuals/tile-prefs.ts, the
 * port of ui-prefs.c parse_prefs_*: features by code then name, monsters by
 * race name, objects by tval+sval including the sval globs, flavours by fidx,
 * projections by PROJ name, traps by desc, and the feat/trap lighting
 * variants). So instead of re-implementing all of that against the target maps,
 * this module hands the target rules BACK to that parser as pref lines whose
 * two tile bytes are a synthetic SLOT number, and keeps a table from slot to
 * "which asset (or pool) does this rule draw". The result is a real core
 * TileMap: the live map render, the lighting variants and the ASCII fallback
 * are one code path for both engines, and the only engine-specific step is
 * turning a slot back into a picture at blit time (drawTile below).
 *
 * Conditional rules - a legacy `?:` expression, carried in a selector as
 * `:when:<expr>` - are RE-EMITTED as `?:` lines and decided by core's shared
 * evaluator (visuals/pref-expr.ts) against the character's race and class, so
 * the loose pack picks the same per-race player picture the tilesheet does. This
 * header carried two wrong claims about that before 2026-07-31, and both were
 * the kind of wrong that stops a bug being found, so they are recorded here:
 * - It said `<player>` was "the placeholder race at index 0, which the map
 *   render never draws". Race 0 is exactly what the map render draws the player
 *   from (grid_data_as_text's is_player branch, ported in visuals/map-text.ts
 *   playerGlyph). What was missing was the caller - the player draw site passed
 *   no tile at all.
 * - It said conditional rules "are not evaluated and are skipped", which was
 *   true of this engine and became a reason not to look at the shared parser -
 *   where the real defects were: an expression evaluator that could not read a
 *   nested bracket, and a number parser strict enough to drop every pref line
 *   with a trailing comment.
 *
 * KNOWN LIMITS, all shared with the tilesheet engine so the two agree:
 * - `family` effect metadata (glow/tint/pulse) is parsed but not applied; a
 *   family draws its base asset, which is what the tilesheet shows.
 *
 * Double-height tiles USED TO be on that list and are not any more, in two
 * steps that are worth keeping apart. #241 taught both engines to draw one;
 * #243 found this one was still never told it had any, because the flag was
 * computed from the core graphics catalog and a pack contributed by a mod holds
 * a grafID the catalog has never heard of. The answer now comes from the pack
 * itself (maps/tall.txt, isTall below), which is the only authority that can
 * speak for a pack the game does not ship.
 *
 * Nothing here can crash the game: every parse and fetch failure returns null
 * or degrades to ASCII, and a missing asset simply leaves that cell as its
 * glyph. No RNG - pool choice is a hash of the pool id and the grid.
 */

import { fillTilesFromKin, parseTilePrefsInto, TileMap } from "@rpgm-tools/neo-angband-core";
import type { KinTileFill } from "@rpgm-tools/neo-angband-core";
import type { TilePrefsDeps } from "@rpgm-tools/neo-angband-core";
// Deliberately the `targets` subpath, not the package root: the root also
// exports the converter, which imports node:fs and must never reach a browser
// bundle. This subpath is pure format code (its md5 is portable - md5.ts).
import {
  parsePoolsFile,
  parseTargetsFile,
  selectPoolMember,
} from "@rpgm-tools/neo-angband-linoleum/targets";
import type { PoolDefinition, TargetRule } from "@rpgm-tools/neo-angband-linoleum/targets";
import type { PackFileResolver } from "./pack-files";
import type { ModPrefText, TileBlitter, TileCode } from "./tiles";

/** A pack's manifest.txt, parsed. */
export interface LinoleumManifest {
  /** Stable pack id (`pack:<id>:<display>`). */
  packId: string;
  /** Human-readable pack name from the same line. */
  displayName: string;
  /** Asset container format; only "png" is understood. */
  format: string;
  /** Nominal tile resolution - also the images/<res>/ directory name. */
  resolution: number;
  /** Pack-relative paths of the text maps, by kind (targets/pools/families/tall). */
  maps: ReadonlyMap<string, string>;
}

/**
 * Parse maps/tall.txt: the assets whose image is two cells tall and
 * bottom-anchored (`tall:<asset>` per line).
 *
 * A pack converted from a mode with no overdraw band writes no such file, and a
 * hand-authored pack need not either - an absent map means no asset is tall,
 * which is the right answer for both. Declared per ASSET rather than by tileset
 * row because a loose pack has no rows: the picture is addressed by name, and
 * the runtime's slot number is synthetic.
 */
export function parseTallFile(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(":");
    if (parts.length < 2 || parts[0] !== "tall") continue;
    const asset = parts.slice(1).join(":");
    if (asset.length > 0) out.add(asset);
  }
  return out;
}

/**
 * What one slot draws: a single asset, a pool resolved per grid, or another
 * slot's picture recoloured.
 *
 * `derived` is the only one a PACK cannot declare. It is allocated at load time
 * for a mod-added monster or item that the pack has no tile for, on top of the
 * kin tile core would otherwise have copied verbatim - see `deriveKinSlot`.
 */
export type LinoleumSlot =
  | { kind: "asset"; asset: string }
  | { kind: "pool"; pool: PoolDefinition }
  | { kind: "derived"; from: number; hue: number; of: `${"monster" | "object"}:${number}` };

/** Rules a pack declared that this runtime could not turn into a slot. */
export interface LinoleumSkipped {
  /** A family/pool id the pack never defines, or a pool with no members. */
  unresolved: number;
  /** Rules past the synthetic slot space (a pack with >16384 distinct tiles). */
  overflow: number;
}

/** A pack's target maps, resolved into a core TileMap plus its slot table. */
export interface LinoleumIndex {
  /** The synthetic pref map: entity -> slot, in core's own TileMap shape. */
  map: TileMap;
  /** Slot table, indexed by slot number (the decoded atlas row/col). */
  slots: readonly LinoleumSlot[];
  skipped: LinoleumSkipped;
  /**
   * How many rules carried a `:when:<expr>` condition. These are EMITTED, each
   * behind its own `?:` line, so core's evaluator decides them against the
   * current character - the count is diagnostics, not a shortfall.
   */
  conditional: number;
  /**
   * The assets maps/tall.txt declared double-height. Empty for a pack converted
   * from a mode with no overdraw band, and for every hand-authored pack that
   * says nothing - both of which mean "no asset overdraws", so the empty set is
   * the correct default rather than a missing answer.
   */
  tall: ReadonlySet<string>;
}

/**
 * Slots are encoded in the same 7-bit row/column an atlas tile code uses
 * (tiles.ts tileCode), so 128 * 128 distinct tiles fit. The four packs the game
 * ships convert to ~1500 assets each, so this is roomy, and a pack that
 * exceeds it still renders its first 16384 rules.
 */
export const LINOLEUM_MAX_SLOTS = 128 * 128;

/** The (attr, char) pair that addresses a slot - both high bits set (isTile). */
export function slotToAtlas(slot: number): { attr: number; char: number } {
  return { attr: 0x80 | (slot >> 7), char: 0x80 | (slot & 0x7f) };
}

/** The slot an (attr, char) pair addresses, straight off a core TileMap entry. */
export function slotFromAtlas(atlas: { attr: number; char: number }): number {
  return ((atlas.attr & 0x7f) << 7) | (atlas.char & 0x7f);
}

/**
 * The hue rotations a derived tile can take, in the order they are handed out.
 *
 * Eight, spread around the wheel and none of them near zero, because a rotation
 * of nothing is a tile indistinguishable from its donor and that is the whole
 * failure this exists to fix. They are handed out per donor rather than per
 * entity, so the first eight mod-added creatures sharing one base all differ
 * from each other as well as from the base's own art; the ninth repeats the
 * first, which is a better answer than a ninth colour nobody can name.
 *
 * A HUE ROTATION IS A NO-OP ON GREY. A donor tile with no saturation - stone,
 * iron, bone, a black-and-white glyph-like tile - comes back the same colour it
 * went in, so a derived tile is distinctive exactly when its donor has colour to
 * turn. The saturation lift below helps a nearly-grey donor and cannot invent
 * colour in a fully grey one. This is a limit, not a defect to chase: the
 * alternative is compositing a mark onto somebody's art, which is a bigger lie
 * than a similar colour.
 */
export const LINOLEUM_DERIVED_HUES: readonly number[] = [30, 60, 90, 135, 180, 225, 270, 315];

/** The slot a decoded tile code addresses (the inverse of slotToAtlas). */
export function atlasToSlot(code: TileCode): number {
  return (code.row << 7) | code.col;
}

/** Parse manifest.txt. Returns null when the pack line or resolution is absent. */
export function parseLinoleumManifest(text: string): LinoleumManifest | null {
  let packId: string | null = null;
  let displayName = "";
  let format = "png";
  let resolution = 0;
  const maps = new Map<string, string>();
  for (const line of text.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(":");
    const head = parts[0] ?? "";
    if (head === "pack" && parts.length >= 3) {
      packId = parts[1] ?? "";
      displayName = parts.slice(2).join(":");
    } else if (head === "format" && parts[1]) {
      format = parts[1];
    } else if (head === "resolution" && parts[1]) {
      const n = Number.parseInt(parts[1], 10);
      if (Number.isFinite(n) && n > 0) resolution = n;
    } else if (head === "map" && parts.length >= 3 && parts[1]) {
      maps.set(parts[1], parts.slice(2).join(":"));
    }
  }
  if (packId === null || packId.length === 0 || resolution === 0) return null;
  return { packId, displayName, format, resolution, maps };
}

/**
 * Parse maps/families.txt down to what this renderer uses: the family's base
 * asset. The effect metadata (glow-alpha/tint/pulse) is deliberately read and
 * dropped - see the header's known limits.
 */
export function parseFamiliesFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r\n|\n|\r/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(":");
    if (parts.length < 4 || parts[0] !== "family" || parts[2] !== "asset") continue;
    const id = parts[1] ?? "";
    const asset = parts.slice(3).join(":");
    if (id.length === 0 || asset.length === 0) continue;
    out.set(id, asset);
  }
  return out;
}

/**
 * A feat/trap selector with no `:<variant>` suffix means "every lighting
 * variant", which the pref grammar spells `*` (ui-prefs.c L824-836). The
 * converter emits exactly these unsuffixed rules as its compatibility aliases,
 * so they must become `feat:<name>:*:...`, not a malformed 4-field line.
 */
function prefSelector(rule: TargetRule): string {
  const type = rule.type.toLowerCase();
  if ((type === "feat" || type === "trap") && !rule.selector.includes(":")) {
    return `${rule.selector}:*`;
  }
  return rule.selector;
}

function hexByte(value: number): string {
  return `0x${value.toString(16).padStart(2, "0")}`;
}

/**
 * Turn target rules into pref lines over synthetic slot bytes, allocating a
 * slot per distinct mapping. Rule order is preserved, so a pack's later rule
 * overrides an earlier one for the same entity exactly as a pref file's later
 * line does (parseTilePrefsInto) - which is how the converter's compatibility
 * aliases (written first) stay underneath its exact per-variant rules.
 */
export function linoleumPrefLines(input: {
  rules: readonly TargetRule[];
  pools?: readonly PoolDefinition[] | undefined;
  families?: ReadonlyMap<string, string> | undefined;
}): {
  lines: string[];
  slots: LinoleumSlot[];
  skipped: LinoleumSkipped;
  conditional: number;
} {
  const poolById = new Map<string, PoolDefinition>();
  for (const pool of input.pools ?? []) poolById.set(pool.poolId, pool);
  const families = input.families ?? new Map<string, string>();

  const lines: string[] = [];
  const slots: LinoleumSlot[] = [];
  const slotOf = new Map<string, number>();
  const skipped: LinoleumSkipped = { unresolved: 0, overflow: 0 };
  let conditional = 0;

  for (const rule of input.rules) {
    /* `<selector>:when:<expr>` - the converter's record of an xtra-*.prf `?:`
     * block. Emit it AS a `?:` line and let core's evaluator decide it, so the
     * loose pack honours $RACE/$CLASS exactly as the tilesheet does. */
    const whenAt = rule.selector.indexOf(":when:");
    const when = whenAt < 0 ? null : rule.selector.slice(whenAt + ":when:".length);
    const bare: TargetRule =
      whenAt < 0 ? rule : { ...rule, selector: rule.selector.slice(0, whenAt) };
    if (when !== null) conditional += 1;
    let slot: LinoleumSlot | null = null;
    if (rule.kind === "asset") {
      slot = { kind: "asset", asset: rule.value };
    } else if (rule.kind === "family") {
      const asset = families.get(rule.value);
      if (asset !== undefined) slot = { kind: "asset", asset };
    } else {
      const pool = poolById.get(rule.value);
      if (pool && pool.members.length > 0) slot = { kind: "pool", pool };
    }
    if (slot === null) {
      skipped.unresolved += 1;
      continue;
    }

    const key = slot.kind === "asset" ? `a:${slot.asset}` : `p:${slot.pool.poolId}`;
    let index = slotOf.get(key);
    if (index === undefined) {
      if (slots.length >= LINOLEUM_MAX_SLOTS) {
        skipped.overflow += 1;
        continue;
      }
      index = slots.length;
      slots.push(slot);
      slotOf.set(key, index);
    }
    const { attr, char } = slotToAtlas(index);
    /* The `?:1` after a conditional line closes its block. A generated file has
     * no later `?:` to reset the bypass flag the way an authored pref file does,
     * and without it one false condition would swallow every rule after it. */
    if (when !== null) lines.push(`?:${when}`);
    lines.push(`${bare.type}:${prefSelector(bare)}:${hexByte(attr)}:${hexByte(char)}`);
    if (when !== null) lines.push("?:1");
  }

  return { lines, slots, skipped, conditional };
}

/**
 * Build a pack's index: the slot table plus the core TileMap that maps every
 * entity the pack names to its slot. Pure - the caller supplies the already-read
 * map texts and the registries to resolve names against.
 */
export function buildLinoleumIndex(input: {
  rules: readonly TargetRule[];
  pools?: readonly PoolDefinition[] | undefined;
  families?: ReadonlyMap<string, string> | undefined;
  tall?: ReadonlySet<string> | undefined;
  deps: TilePrefsDeps;
}): LinoleumIndex {
  const { lines, slots, skipped, conditional } = linoleumPrefLines(input);
  const map = new TileMap();
  parseTilePrefsInto(map, lines.join("\n"), input.deps);
  return { map, slots, skipped, conditional, tall: input.tall ?? new Set() };
}

/** One cached asset image and its load state. */
interface CachedAsset {
  image: HTMLImageElement | null;
  loaded: boolean;
}

/**
 * A loaded loose pack, ready to blit. Assets load lazily: the first cell that
 * wants an asset starts its fetch and draws ASCII for that frame, and the
 * repaint that follows (onReady, coalesced to one per frame) draws the tile. A
 * pack with 1500 assets therefore costs only the few dozen its level actually
 * shows.
 */
export class LinoleumPack implements TileBlitter {
  readonly menuname: string;
  readonly manifest: LinoleumManifest;
  readonly index: LinoleumIndex;
  /** Called after assets finish loading, coalesced to one call per frame. */
  onReady: (() => void) | null = null;

  private readonly imageDir: string;
  private readonly resolve: PackFileResolver;
  private readonly cache = new Map<string, CachedAsset>();
  /** Recoloured copies, keyed `<asset>#<hue>`. A null entry is one that failed. */
  private readonly recolours = new Map<string, CanvasImageSource | null>();
  private notifyScheduled = false;

  constructor(input: {
    menuname: string;
    resolve: PackFileResolver;
    manifest: LinoleumManifest;
    index: LinoleumIndex;
  }) {
    this.menuname = input.menuname;
    this.manifest = input.manifest;
    this.index = input.index;
    this.resolve = input.resolve;
    this.imageDir = `images/${input.manifest.resolution}/`;
  }

  /**
   * True once the pack's maps are usable, i.e. it has at least one slot. Unlike
   * the tilesheet engine there is no single image to wait for; an asset that
   * has not arrived yet leaves its own cell as ASCII, nothing more.
   */
  get ready(): boolean {
    return this.index.slots.length > 0;
  }

  /** How many distinct assets have been asked for so far (diagnostics). */
  get requestedAssets(): number {
    return this.cache.size;
  }

  /** How many of those have finished loading (diagnostics). */
  get loadedAssets(): number {
    let n = 0;
    for (const entry of this.cache.values()) if (entry.loaded) n += 1;
    return n;
  }

  /** The asset a slot draws for a grid, or null (empty pool / unknown slot). */
  assetFor(slot: number, grid?: { x: number; y: number }): string | null {
    return this.slotDraw(slot, grid)?.asset ?? null;
  }

  /**
   * What a slot draws for a grid: which asset, and how far to rotate its hue.
   *
   * Split out of `assetFor` because a derived slot needs BOTH halves and every
   * other caller needs only the asset - `isTall` asks about the picture's shape,
   * which a recolour does not change, and `preload` warms the same file either
   * way. So a derived slot answers `isTall` with its donor's own declaration for
   * free, which is the correct answer and not a coincidence: it is the same
   * image.
   */
  private slotDraw(
    slot: number,
    grid?: { x: number; y: number },
  ): { asset: string; hue: number } | null {
    const entry = this.index.slots[slot];
    if (!entry) return null;
    if (entry.kind === "asset") return { asset: entry.asset, hue: 0 };
    if (entry.kind === "pool") {
      const member = selectPoolMember(entry.pool, { x: grid?.x ?? 0, y: grid?.y ?? 0 });
      return member === null ? null : { asset: member, hue: 0 };
    }
    /* One level, deliberately. A derived slot is always allocated over a slot the
     * PACK declared (deriveKinSlot reads the pack's own table, which is fixed
     * before any derivation happens), so a chain of them is not a case to
     * support - it is a bug, and returning null makes it visible as a cell that
     * stayed ASCII rather than as a wrong colour nobody questions. */
    const base = this.slotDraw(entry.from, grid);
    if (base === null || base.hue !== 0) return null;
    return { asset: base.asset, hue: entry.hue };
  }

  /**
   * Does the asset this slot draws overdraw the cell above (TileBlitter.isTall)?
   *
   * Answered from the pack's OWN declaration, per asset, because a loose pack's
   * code is a synthetic slot with no tileset row in it - the mode-band test the
   * tilesheet engine uses has nothing to read here. It is also per asset rather
   * than per slot so a POOL of mixed heights answers correctly, which is why
   * `grid` is taken: the member depends on the cell.
   *
   * Sniffing the loaded image's aspect instead was considered and is WRONG, not
   * merely unavailable: Nomad's cells are 8 wide by 16 high (list.txt), so every
   * normal asset in that pack is exactly twice as tall as it is wide.
   */
  isTall(code: TileCode, grid?: { x: number; y: number }): boolean {
    if (this.index.tall.size === 0) return false;
    const asset = this.assetFor(atlasToSlot(code), grid);
    return asset !== null && this.index.tall.has(asset);
  }

  /**
   * Blit the tile a synthetic code addresses, or return false so the caller
   * keeps the cell's ASCII glyph. The whole asset is scaled into the cell rect,
   * so a pack may mix tile sizes freely.
   *
   * `tall` is a double-height tile and is BOTTOM-ANCHORED: the asset covers two
   * cells and the one it is queued at is the lower half, so it is drawn one
   * cell higher and twice as tall. The converter already preserves Shockbolt's
   * tall assets whole, as bottom-anchored 64x128 images (docs/LINOLEUM.md), and
   * scaling one of those into a single cell is what squashed them.
   *
   * The flag comes from the MODE's double-height band (is_dh_tile) and not from
   * the asset, which is why no per-asset metadata is needed here: a pack whose
   * mode declares no overdraw row can never be passed `tall`, so its drawing is
   * unchanged. Aspect-sniffing the loaded image was considered and rejected -
   * it guesses at what the mode already states.
   */
  drawTile(
    ctx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    code: TileCode,
    grid?: { x: number; y: number },
    tall = false,
  ): boolean {
    const draw = this.slotDraw(atlasToSlot(code), grid);
    if (draw === null) return false;
    const cached = this.request(draw.asset);
    if (!cached.loaded || cached.image === null) return false;
    /* A derived slot draws a recoloured COPY, built once per asset and hue and
     * kept. Falling back to the donor's own image when the copy cannot be made
     * is deliberate: the tile is then merely indistinguishable, which is what it
     * was before this existed, rather than absent. */
    const source =
      draw.hue === 0
        ? cached.image
        : (this.recoloured(draw.asset, draw.hue, cached.image) ?? cached.image);
    try {
      ctx.drawImage(
        source,
        dx,
        tall ? dy - dh : dy,
        dw,
        tall ? dh * 2 : dh,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** One asset recoloured, built on first use and cached (null once it failed). */
  private recoloured(
    asset: string,
    hue: number,
    image: HTMLImageElement,
  ): CanvasImageSource | null {
    const key = `${asset}#${hue}`;
    const have = this.recolours.get(key);
    if (have !== undefined) return have;
    const made = renderRecoloured(image, hue);
    this.recolours.set(key, made);
    return made;
  }

  /**
   * Start this slot's asset loading without drawing it (TileBlitter.preload).
   *
   * `drawTile` already calls `request` as a side effect, so a cell already on
   * screen warms itself the moment it is first painted - the race this exists
   * to avoid is the frame BEFORE that: a cell not yet in view starts cold, and
   * request() is what turns "in view" and "loaded" into the same moment
   * instead of two, one frame apart. Calling this ahead of a cell entering
   * view (main.ts's precacheTilesNear) gives its Image() a head start.
   */
  preload(code: TileCode, grid?: { x: number; y: number }): void {
    const asset = this.assetFor(atlasToSlot(code), grid);
    if (asset !== null) this.request(asset);
  }

  /**
   * Start (or reuse) an asset's image load. Never throws, and returns the cache
   * entry synchronously so the caller can draw ASCII for this frame.
   *
   * The entry is registered BEFORE the resolver is awaited, which is what keeps a
   * pack from asking for the same tile once per frame while its URL is in flight:
   * resolving can take a turn of the event loop now (an installed mod reads its
   * bytes out of IndexedDB), where a base URL was pure string work.
   */
  private request(asset: string): CachedAsset {
    const existing = this.cache.get(asset);
    if (existing) return existing;
    const entry: CachedAsset = { image: null, loaded: false };
    this.cache.set(asset, entry);
    void this.startLoad(entry, `${this.imageDir}${asset}.png`);
    return entry;
  }

  /**
   * Resolve one asset to a URL and hand it to an Image. A resolver that returns
   * null (or throws) leaves the entry unloaded, which draws that cell as ASCII -
   * the same outcome as a 404, and deliberately not an error: a pack is allowed
   * to name a tile it does not ship.
   */
  private async startLoad(entry: CachedAsset, relPath: string): Promise<void> {
    let url: string | null;
    try {
      url = await this.resolve(relPath);
    } catch {
      url = null;
    }
    if (url === null) return;
    try {
      const img = new Image();
      img.addEventListener("load", () => {
        entry.loaded = true;
        this.scheduleNotify();
      });
      img.addEventListener("error", () => {
        entry.image = null;
      });
      img.src = url;
      entry.image = img;
    } catch {
      entry.image = null;
    }
  }

  /**
   * Coalesce the repaint: a first paint of a fresh level asks for dozens of
   * assets at once, and one render after the batch is enough.
   *
   * A timer, deliberately NOT requestAnimationFrame: rAF does not fire while
   * the page is not compositing (a background tab, an undisplayed pane), so the
   * repaint that turns the just-loaded assets into pixels would never happen and
   * the map would sit in ASCII until something else forced a render. The game's
   * own render path is synchronous, so a macrotask is the right granularity.
   */
  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    setTimeout(() => {
      this.notifyScheduled = false;
      this.onReady?.();
    }, 0);
  }
}

/**
 * One image redrawn with its hue rotated, or null where that cannot be done.
 *
 * A canvas filter rather than per-pixel arithmetic, because the browser's own
 * `hue-rotate` is the same matrix a hand-rolled loop would apply and it does not
 * need the image to be same-origin readable - nothing here calls
 * `getImageData`, so an asset served from an installed mod's blob URL recolours
 * without a taint error.
 *
 * Returns null in a document-less environment (the node tests) and on any
 * failure, and the caller then draws the donor's own picture. A browser too old
 * for `filter` is not a case to detect: it ignores the assignment, the copy comes
 * out identical to its source, and the outcome is the undistinguished tile that
 * was there before.
 */
function renderRecoloured(image: HTMLImageElement, hue: number): CanvasImageSource | null {
  if (typeof document === "undefined") return null;
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w === 0 || h === 0) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (g === null) return null;
    /* The saturation lift is what makes a muted donor's rotation readable at a
     * 16x16 tile. It is small on purpose: a big one turns somebody's carefully
     * lit art into a poster. */
    g.filter = `hue-rotate(${hue}deg) saturate(1.25)`;
    g.drawImage(image, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

/** Fetch text, or null on any failure (404, offline, CORS). Never throws. */
async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** Resolve a pack-relative path and read it as text, or null on any failure. */
async function readPackText(
  resolve: PackFileResolver,
  relPath: string,
): Promise<string | null> {
  let url: string | null;
  try {
    url = await resolve(relPath);
  } catch {
    return null;
  }
  return url === null ? null : await fetchText(url);
}

/**
 * Load a loose pack through a file resolver: manifest.txt, then the text maps it
 * names, then the index built off core's pref parser. Returns null when the
 * pack is absent or unreadable, which leaves the game in ASCII exactly as a
 * missing tilesheet does.
 *
 * Takes a resolver rather than a base URL so the same loader serves a pack served
 * from the site, a pack in a folder the player picked, and a pack installed from
 * GitHub - see PackFileResolver. For the plain site case pass
 * `urlBaseResolver(base)`. Mod pref texts replay over the generated slot map in
 * enabled load order, so their synthetic tile assignments override pack targets.
 */
/**
 * Give a pack's kin fill DISTINCTIVE tiles instead of duplicate ones.
 *
 * WHAT THIS IS FOR. `fillTilesFromKin` (core) gives a mod-added monster or item
 * the tile of its nearest kin, which is what stops a mod's content being a
 * coloured letter in a tiled dungeon. It leaves half the problem: the added ant
 * is now pixel-for-pixel the base game's ant, so a player who meets both cannot
 * tell them apart, and neither can a mod author checking their own work. The
 * tilesheet engine has no way out of that - its tiles are cells of a fixed
 * atlas and there is no spare cell to put a variant in. This engine does: a
 * loose pack's tiles are individual images, so a new slot can be allocated that
 * draws an existing image with its hue turned.
 *
 * WHY IT IS SAFE, in the same terms the core fill earns it. Only entities the
 * core fill decided to fill are touched, and that decision is restricted to
 * records a MOD ADDED, by provenance. So no tile the pack declares is changed,
 * nothing core ships is recoloured, and a pack with no mods installed builds no
 * derived slots at all. An author who names a specific asset for their monster
 * in a pref file wins outright, because their pref layers in before the fill
 * runs and the fill only ever writes where there is nothing.
 *
 * DETERMINISTIC, which a tile has to be. Hues are handed out per donor slot in
 * the order the core fill walks the registries, and both registries are in bound
 * order, so the same set of installed mods produces the same colours every
 * launch. Nothing here reads the RNG, the clock, or the save.
 *
 * Returns the slot table to use, which is the pack's own plus whatever was
 * appended. The pack's own slots are never rewritten, so a derived slot cannot
 * change what an existing rule draws.
 */
export function deriveKinSlots(input: {
  map: TileMap;
  slots: readonly LinoleumSlot[];
  deps: TilePrefsDeps;
}): { slots: readonly LinoleumSlot[]; fill: KinTileFill; derived: number; overflow: number } {
  const slots: LinoleumSlot[] = [...input.slots];
  /* How many variants a donor has already handed out, which is what makes two
   * creatures sharing one base differ from each other and not just from it. */
  const handedOut = new Map<number, number>();
  /* One slot per (donor, hue), so the ninth creature on a donor shares the
   * first's colour AND its slot rather than allocating an identical one. */
  const bySignature = new Map<string, number>();
  let overflow = 0;

  const fill = fillTilesFromKin(input.map, input.deps, undefined, (d) => {
    const donorSlot = slotFromAtlas(d.donor);
    /* A donor tile this pack did not put there - a mod pref naming a raw atlas
     * cell, say - has no asset to recolour, so it is copied as it was. */
    if (input.slots[donorSlot] === undefined) return { ...d.donor };

    const seen = handedOut.get(donorSlot) ?? 0;
    handedOut.set(donorSlot, seen + 1);
    const hue = LINOLEUM_DERIVED_HUES[seen % LINOLEUM_DERIVED_HUES.length] as number;
    const signature = `${donorSlot}#${hue}`;

    let slot = bySignature.get(signature);
    if (slot === undefined) {
      if (slots.length >= LINOLEUM_MAX_SLOTS) {
        overflow += 1;
        return { ...d.donor };
      }
      slot = slots.length;
      slots.push({ kind: "derived", from: donorSlot, hue, of: `${d.kind}:${d.index}` });
      bySignature.set(signature, slot);
    }
    return slotToAtlas(slot);
  });

  return { slots, fill, derived: slots.length - input.slots.length, overflow };
}

export async function loadLinoleumPack(input: {
  resolve: PackFileResolver;
  menuname: string;
  deps: TilePrefsDeps;
  modPrefTexts?: readonly ModPrefText[];
}): Promise<LinoleumPack | null> {
  const manifestText = await readPackText(input.resolve, "manifest.txt");
  if (manifestText === null) return null;
  const manifest = parseLinoleumManifest(manifestText);
  if (manifest === null) return null;

  const targetsPath = manifest.maps.get("targets");
  if (targetsPath === undefined) return null;
  const targetsText = await readPackText(input.resolve, targetsPath);
  if (targetsText === null) return null;
  const rules: TargetRule[] = parseTargetsFile(targetsText);

  const poolsPath = manifest.maps.get("pools");
  const poolsText =
    poolsPath === undefined ? null : await readPackText(input.resolve, poolsPath);
  const pools: PoolDefinition[] = poolsText === null ? [] : parsePoolsFile(poolsText);

  const familiesPath = manifest.maps.get("families");
  const familiesText =
    familiesPath === undefined ? null : await readPackText(input.resolve, familiesPath);
  const families = familiesText === null ? new Map<string, string>() : parseFamiliesFile(familiesText);

  /* Absent in every pack converted before 2026-08-13 and in every pack whose
   * source mode has no overdraw band, so a missing file is ordinary rather than
   * a failure: the set is empty and nothing overdraws. */
  const tallPath = manifest.maps.get("tall");
  const tallText =
    tallPath === undefined ? null : await readPackText(input.resolve, tallPath);
  const tall = tallText === null ? new Set<string>() : parseTallFile(tallText);

  const index = buildLinoleumIndex({ rules, pools, families, tall, deps: input.deps });
  for (const mod of input.modPrefTexts ?? []) {
    parseTilePrefsInto(index.map, mod.text, {
      ...input.deps,
      loadFile: (name: string) => mod.includes.get(name) ?? null,
    });
  }
  /*
   * The same kin fill the tilesheet engine runs, for the same reason and in the
   * same position - after the pack and after any mod pref, so an assignment
   * somebody actually made is never overwritten. BOTH ENGINES OR NEITHER: a
   * mod's monster drawn from its family here and left as a glyph there would
   * make "does my mod look right" depend on which tile engine the player picked,
   * which is exactly the split the two-engine seam exists to hide.
   */
  if (index.slots.length === 0) return null;
  /* Derived rather than duplicated, which is this engine's own half of the
   * answer and is why the fill runs through deriveKinSlots here and plainly in
   * tiles.ts. Both engines still fill the same entities from the same kin; this
   * one can also tell them apart afterwards. */
  const derived = deriveKinSlots({ map: index.map, slots: index.slots, deps: input.deps });
  return new LinoleumPack({
    menuname: input.menuname,
    resolve: input.resolve,
    manifest,
    index: { ...index, slots: derived.slots },
  });
}
