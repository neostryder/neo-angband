/**
 * Both engines, same pixels - for every tile set the game ships.
 *
 * The requirement for the loose-pack engine was that a Linoleum pack "work just
 * the same as the original tilesheet versions". This test is that claim,
 * mechanically, over every bundled pack:
 *
 *   1. take a tile set the game ships (public/tiles/<dir>, drawn by the
 *      TILESHEET engine from its atlas PNG + graf-*.prf);
 *   2. convert it to a Linoleum loose pack with the real converter - the same
 *      call the build step makes for the pack the tiles mod ships;
 *   3. build BOTH maps: the sheet's TileMap exactly as the shell loads it
 *      (graf prefs + their `%:` includes), and the loose pack's index exactly as
 *      the loose engine builds it (manifest maps -> slots);
 *   4. for every entity either map draws - features at all four lightings,
 *      traps, monsters, object kinds, flavours, projections - assert the two
 *      engines resolve to the SAME PICTURE: the sheet's crop of the atlas at
 *      (row, col) and the loose pack's asset PNG must be pixel-identical;
 *   5. assert the loose pack covers everything the sheet covers, so no cell
 *      that used to draw a tile silently falls back to ASCII;
 *   6. assert both engines call the same entities DOUBLE-HEIGHT. The pixel
 *      comparison in step 4 cannot see this - it compares the art and never
 *      asks how many cells that art covers - and the two engines reach the
 *      answer by different routes, which is the point: the sheet tests the
 *      mode's overdraw band, the loose pack reads its own maps/tall.txt.
 *
 * It has already earned its keep: it caught an asset-name collision that made
 * two different scrolls share one file (so one drew the other's tile) and the
 * dropped decimal-byte `<pile>` line, both now fixed in @rpgm-tools/neo-angband-linoleum.
 * It did NOT catch the third change made there - writing target rules in source
 * order instead of alphabetically - because on these four packs that changes no
 * tile; convert.test.ts pins that one.
 *
 * What it proves and does not prove: it proves the engines RESOLVE alike (which
 * entity draws which art) and that the art is identical. Two entities whose
 * tiles happen to be pixel-identical could be swapped without this noticing -
 * but a swap between identical pictures is invisible on screen, which is the
 * property under test.
 *
 * Two deliberate, asserted exceptions:
 * - `monster:<player>` (ridx 0): the legacy xtra-*.prf remaps it behind `?:`
 *   conditions that NEITHER engine evaluates, and the map render never draws
 *   that placeholder race.
 * - pref lines that assign an ASCII (colour, char) pair instead of a tile:
 *   nomad does this for two joke monsters. The sheet engine draws the glyph
 *   (tileDrawFor rejects a non-tile pair) and so does the loose engine (it has
 *   no asset for them) - equivalent by a different route, so they are counted,
 *   not compared, and the counts are pinned per pack below.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bindCore,
  GRAPHICS_MODE_CATALOG,
  LIGHTING,
  parseTilePrefsInto,
  TileMap,
  tileForMonster,
} from "@rpgm-tools/neo-angband-core";
import type { TileAtlas, TilePrefsDeps } from "@rpgm-tools/neo-angband-core";
import { ALL_PACKS, buildPackExport } from "@rpgm-tools/neo-angband-linoleum";
import type { PackConfig } from "@rpgm-tools/neo-angband-linoleum";
import { parseTargetsFile } from "@rpgm-tools/neo-angband-linoleum/targets";
import {
  atlasToSlot,
  buildLinoleumIndex,
  LinoleumPack,
  parseFamiliesFile,
  parseLinoleumManifest,
  parseTallFile,
} from "./linoleum-pack";
import type { LinoleumIndex } from "./linoleum-pack";
import { createTileRenderer, isTile, tileCode } from "./tiles";
import type { TileBlitter } from "./tiles";
import { loadGamePack } from "./pack";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const tilesRoot = join(webRoot, "public", "tiles");
/* Unique per process, not a fixed `.test-out` under webRoot: two vitest
 * invocations against the same checkout (two agent worktrees, or a rerun
 * overlapping a still-running one) used to share this path and race on it -
 * one run's rmSync/mkdir could delete or read the other's mid-write output.
 * mkdtempSync's random suffix means concurrent processes never collide, and
 * os.tmpdir() keeps it off the checkout entirely so nothing here needs
 * gitignoring. See #67. */
const outputRoot = mkdtempSync(join(tmpdir(), "neo-linoleum-equiv-"));

const registries = bindCore(loadGamePack());
const deps: TilePrefsDeps = {
  features: registries.features,
  objects: registries.objects,
  monsters: registries.monsters,
  traps: registries.traps,
};

/**
 * Every pack whose art ships (BUNDLED_TILE_DIRECTORIES), with how many of its
 * pref lines assign an ASCII pair rather than a tile - see `ascii` below.
 */
const PACKS: readonly {
  key: string;
  ascii: number;
  tall: number;
  tallEntities: number;
}[] = [
  { key: "original-tiles", ascii: 0, tall: 0, tallEntities: 0 },
  { key: "adam-bolt", ascii: 0, tall: 0, tallEntities: 0 },
  { key: "gervais", ascii: 0, tall: 0, tallEntities: 0 },
  // nomad's graf-nmd.prf gives its two joke monsters (Red-Hatted Elf, Father
  // Christmas) a plain colour/char pair instead of a tile.
  { key: "nomad", ascii: 2, tall: 0, tallEntities: 0 },
  // Shockbolt was missing from this list until 2026-07-31, and it is the pack
  // that matters most for the conditional rules: its xtra-shb.prf carries 132
  // `monster:<player>` remaps, more than the other four packs put together.
  //
  // It is also the ONLY source mode with an overdraw band (list.txt
  // `extra:1:27:31` on both Shockbolt rows, `extra:0:0:0` on every other), so
  // `tall` is the whole double-height population of the game: 247 monsters in
  // both packs, plus five shop entrances the DARK pack alone puts in the band -
  // light maps STORE_BOOK/ALCHEMY/MAGIC/BLACK/HOME at 0x99, a row outside it.
  // That asymmetry is why the light pack has to be here too. It was missing,
  // and tools/tall-tile-probe.mjs photographs exactly those five entrances, so
  // the one pixel proof of #241 was a proof about dark and nothing else.
  //
  // `tall` counts distinct ASSETS (one per selector in the band).
  // `tallEntities` counts entity SLOTS, which is what a map render draws: a
  // monster is one, a feature is one PER LIGHTING VARIANT, so dark's five shop
  // entrances are 247 + 5 * LIGHTING.MAX = 267.
  { key: "shockbolt-dark", ascii: 0, tall: 252, tallEntities: 267 },
  { key: "shockbolt-light", ascii: 0, tall: 247, tallEntities: 247 },
];

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** A pixel region as a comparable string of RGBA bytes. */
function regionKey(png: PNG, x0: number, y0: number, w: number, h: number): string {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * png.width + (x0 + x)) * 4;
      const a = png.data[i + 3] as number;
      // A fully transparent pixel carries no visible colour, so normalise its
      // RGB: a crop and a re-encoded crop must compare equal whatever is under
      // alpha 0.
      out.push(
        a === 0 ? 0 : (png.data[i] as number),
        a === 0 ? 0 : (png.data[i + 1] as number),
        a === 0 ? 0 : (png.data[i + 2] as number),
        a,
      );
    }
  }
  return out.join(",");
}

/**
 * The `?:` variables both engines are given, so the comparison covers the packs'
 * conditional (xtra-*.prf `monster:<player>`) rules rather than bypassing them on
 * both sides. Every bundled pack defines a tile for this pair.
 */
const EQUIV_VARS = { RACE: "Hobbit", CLASS: "Ranger" } as const;

/** One pack under test: both engines' views of it, plus a pixel comparator. */
interface Subject {
  config: PackConfig;
  sheetMap: TileMap;
  loose: LinoleumIndex;
  /** The TILESHEET engine itself, so isTall is asked through production code. */
  sheetEngine: TileBlitter;
  /** The LOOSE engine itself, built over the converter's real output. */
  looseEngine: TileBlitter;
  sheetPixels(atlas: TileAtlas): string | null;
  loosePixels(atlas: TileAtlas): string | null;
}

function prepare(key: string): Subject {
  const found = ALL_PACKS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`no pack config for ${key}`);
  const config: PackConfig = found;
  const sourceDir = join(tilesRoot, config.sourceDirectory);
  const result = buildPackExport(config, tilesRoot, outputRoot);
  const packRoot = result.packRoot;

  const sheet = PNG.sync.read(readFileSync(join(sourceDir, config.imageFile)));
  const tileWidth = config.tileWidth ?? config.resolution;
  const tileHeight = config.tileHeight ?? config.resolution;

  // The sheet map, loaded the way the shell loads it: the mode's graf prefs,
  // with its `%:` includes resolved (tiles.ts loadTilePrefs pre-fetches them).
  const sheetMap = new TileMap();
  parseTilePrefsInto(sheetMap, readText(join(sourceDir, config.primaryPref)), {
    ...deps,
    vars: EQUIV_VARS,
    loadFile: (name: string) => {
      const path = join(sourceDir, name);
      return existsSync(path) ? readText(path) : null;
    },
  });

  // The loose index, built the way the loose engine builds it.
  const targets = parseTargetsFile(readText(join(packRoot, "maps", "targets.txt")));
  const familiesPath = join(packRoot, "maps", "families.txt");
  const families = existsSync(familiesPath)
    ? parseFamiliesFile(readText(familiesPath))
    : new Map<string, string>();
  /* Read the way loadLinoleumPack reads it: the manifest names the map, and a
   * pack with no overdraw band writes none. Going through the manifest rather
   * than straight to the path is the point - a converter that stopped listing
   * `map:tall:` would leave the file on disk and every tall tile would quietly
   * go flat again, which is exactly the failure this is here to catch. */
  const manifest = parseLinoleumManifest(readText(join(packRoot, "manifest.txt")));
  if (manifest === null) throw new Error(`unreadable manifest for ${key}`);
  const tallPath = manifest.maps.get("tall");
  const tall =
    tallPath === undefined
      ? new Set<string>()
      : parseTallFile(readText(join(packRoot, tallPath)));

  const loose = buildLinoleumIndex({
    rules: targets,
    families,
    tall,
    deps: { ...deps, vars: EQUIV_VARS },
  });

  /* Both engines as the shell holds them. The tilesheet's resolver answers null
   * so no atlas image is fetched - this asks only what a code MEANS, which the
   * mode settles before any pixel arrives. */
  const mode = GRAPHICS_MODE_CATALOG.find(
    (m) => m.directory === config.sourceDirectory && m.pref === config.primaryPref,
  );
  if (mode === undefined) throw new Error(`no catalog mode for ${key}`);
  const noArt = (): Promise<string | null> => Promise.resolve(null);
  const sheetEngine = createTileRenderer({ resolve: noArt, grafID: mode.grafID });
  if (sheetEngine === null) throw new Error(`no tilesheet renderer for ${key}`);
  const looseEngine = new LinoleumPack({
    menuname: config.displayName,
    resolve: noArt,
    manifest,
    index: loose,
  });

  const assetPixels = new Map<string, string | null>();
  return {
    config,
    sheetMap,
    loose,
    sheetEngine,
    looseEngine,
    sheetPixels: (atlas: TileAtlas): string | null => {
      const code = tileCode(atlas.attr, atlas.char);
      /* sourceTileRectangle (convert.ts L224-241): a row inside a pack's legacy
       * OVERDRAW band is a double-height tile whose upper half lives in the row
       * ABOVE it, and the exporter keeps the whole bottom-anchored rectangle. So
       * the comparator has to read the same rectangle - cropping one cell here
       * compared a 64x64 window against a 64x128 asset and called the pack
       * wrong. That is what kept Shockbolt, the only pack with an overdraw band,
       * out of this list: its five shop entrances sit on row 27. */
      const x0 = code.col * tileWidth;
      const tall =
        (config.overdrawRow ?? 0) > 0 &&
        code.row >= (config.overdrawRow ?? 0) &&
        code.row <= (config.overdrawMax ?? 0);
      const y0 = (code.row - (tall ? 1 : 0)) * tileHeight;
      const h = tileHeight * (tall ? 2 : 1);
      if (x0 + tileWidth > sheet.width || y0 < 0 || y0 + h > sheet.height) return null;
      return regionKey(sheet, x0, y0, tileWidth, h);
    },
    loosePixels: (atlas: TileAtlas): string | null => {
      const slot = loose.slots[atlasToSlot(tileCode(atlas.attr, atlas.char))];
      if (!slot || slot.kind !== "asset") return null;
      const cached = assetPixels.get(slot.asset);
      if (cached !== undefined) return cached;
      const path = join(packRoot, "images", String(config.resolution), `${slot.asset}.png`);
      let pixels: string | null = null;
      if (existsSync(path)) {
        const png = PNG.sync.read(readFileSync(path));
        pixels = regionKey(png, 0, 0, png.width, png.height);
      }
      assetPixels.set(slot.asset, pixels);
      return pixels;
    },
  };
}

/** Every entity slot a map populates, labelled by its coordinates. */
function entitiesOf(map: TileMap): { label: string; atlas: TileAtlas }[] {
  const out: { label: string; atlas: TileAtlas }[] = [];
  const push = (label: string, atlas: TileAtlas | undefined): void => {
    if (atlas) out.push({ label, atlas });
  };
  for (let light = 0; light < LIGHTING.MAX; light++) {
    const feats = map.feat[light] ?? [];
    for (let i = 0; i < feats.length; i++) push(`feat ${i} light ${light}`, feats[i]);
    const traps = map.trap[light] ?? [];
    for (let i = 0; i < traps.length; i++) push(`trap ${i} light ${light}`, traps[i]);
  }
  for (let i = 1; i < map.monster.length; i++) push(`monster ${i}`, map.monster[i]);
  for (let i = 0; i < map.object.length; i++) push(`object ${i}`, map.object[i]);
  for (let i = 0; i < map.flavor.length; i++) push(`flavor ${i}`, map.flavor[i]);
  for (let proj = 0; proj < map.gf.length; proj++) {
    const motions = map.gf[proj] ?? [];
    for (let m = 0; m < motions.length; m++) push(`GF ${proj} motion ${m}`, motions[m]);
  }
  return out;
}

/** The same entity's atlas in another map, by the same coordinates. */
function atlasByLabel(map: TileMap, label: string): TileAtlas | undefined {
  const feat = /^feat (\d+) light (\d+)$/.exec(label);
  if (feat) return map.feat[Number(feat[2])]?.[Number(feat[1])];
  const trap = /^trap (\d+) light (\d+)$/.exec(label);
  if (trap) return map.trap[Number(trap[2])]?.[Number(trap[1])];
  const mon = /^monster (\d+)$/.exec(label);
  if (mon) return map.monster[Number(mon[1])];
  const obj = /^object (\d+)$/.exec(label);
  if (obj) return map.object[Number(obj[1])];
  const flv = /^flavor (\d+)$/.exec(label);
  if (flv) return map.flavor[Number(flv[1])];
  const gf = /^GF (\d+) motion (\d+)$/.exec(label);
  if (gf) return map.gf[Number(gf[1])]?.[Number(gf[2])];
  throw new Error(`unlabelled entity: ${label}`);
}

/* outputRoot is freshly created by mkdtempSync above, so there is nothing
 * stale to clear before use; only clean it up afterward. */
afterAll(() => {
  rmSync(outputRoot, { recursive: true, force: true });
});

/**
 * True when a pref entry actually addresses a tile. A pack may assign a plain
 * (colour, char) pair instead - nomad does for two monsters - and then the
 * SHEET engine draws the ASCII glyph (tileDrawFor rejects a non-tile pair),
 * which is exactly what the loose engine does with an entity it has no asset
 * for. Both show the glyph, so these are equivalent by a different route and
 * are counted rather than compared.
 */
function drawsATile(atlas: TileAtlas): boolean {
  return isTile(atlas.attr, atlas.char);
}

for (const { key, ascii, tall, tallEntities } of PACKS) {
  describe(`${key}: a converted loose pack draws what its tilesheet draws`, () => {
    let subject: Subject;

    beforeAll(() => {
      subject = prepare(key);
    }, 120_000);

    it("covers every entity the tilesheet draws as a tile", () => {
      const missing = entitiesOf(subject.sheetMap)
        .filter(({ atlas }) => drawsATile(atlas))
        .filter(({ label }) => atlasByLabel(subject.loose.map, label) === undefined)
        .map(({ label }) => label);
      expect(missing).toEqual([]);
    });

    it("adds no entity the tilesheet does not have", () => {
      const extra = entitiesOf(subject.loose.map)
        .filter(({ label }) => atlasByLabel(subject.sheetMap, label) === undefined)
        .map(({ label }) => label);
      expect(extra).toEqual([]);
    });

    it("resolves every covered entity to a pixel-identical tile", () => {
      const entities = entitiesOf(subject.sheetMap);
      // Guard against a vacuous pass: every bundled pack maps well over a
      // thousand entities, so a low count means the setup broke, not the
      // engines.
      expect(entities.length).toBeGreaterThan(1000);

      const mismatches: string[] = [];
      const asciiPairs: string[] = [];
      const offAtlas: string[] = [];
      let compared = 0;
      for (const { label, atlas } of entities) {
        if (!drawsATile(atlas)) {
          // Both engines show the glyph here; assert the loose pack really has
          // no tile for it rather than inventing one.
          asciiPairs.push(label);
          expect(
            atlasByLabel(subject.loose.map, label),
            `${label} is an ASCII pair, so the loose pack should not map it`,
          ).toBeUndefined();
          continue;
        }
        const looseAtlas = atlasByLabel(subject.loose.map, label);
        if (looseAtlas === undefined) continue; // reported by the coverage test
        const want = subject.sheetPixels(atlas);
        const got = subject.loosePixels(looseAtlas);
        if (want === null) {
          offAtlas.push(label);
          continue;
        }
        if (got === null) {
          mismatches.push(`${label}: no loose asset`);
          continue;
        }
        compared += 1;
        if (want !== got) mismatches.push(`${label}: different pixels`);
      }

      expect(mismatches.slice(0, 20)).toEqual([]);
      // No tile-addressing selector may point off its own atlas, and the ASCII
      // pairs are pinned so a new one cannot slip in as a silent exception.
      expect(offAtlas).toEqual([]);
      expect(asciiPairs.length).toBe(ascii);
      expect(compared).toBe(entities.length - ascii);
    });

    it("reads every rule the pack declares, dropping none of them", () => {
      // Nothing is dropped, so no tile can go missing. The conditional rules -
      // the xtra-*.prf <player> remaps - are no longer among the casualties:
      // they are emitted as `?:` blocks and decided by the same evaluator the
      // sheet uses, which is why the player row above compares at all.
      expect(subject.loose.skipped.unresolved).toBe(0);
      expect(subject.loose.skipped.overflow).toBe(0);
      expect(subject.loose.conditional).toBeGreaterThan(0);
    });

    it("both engines call the SAME entities double-height", () => {
      /* #243. Each engine is asked through the object the shell holds, and each
       * reads its OWN authority: the tilesheet reads the mode's overdraw band
       * (is_dh_tile over the atlas row), the loose pack reads maps/tall.txt,
       * which the converter wrote from the rectangle it actually cropped. Two
       * independent derivations of one fact, so a converter that stops
       * extending a crop and an engine that stops reporting the flag are both
       * caught - and neither can be caught by the pixel comparison above, which
       * compares the ART and never asks how many cells it covers.
       *
       * This is also the check that would have failed the day the linoleum
       * engine was asked `getGraphicsMode(105)` and answered "nothing is ever
       * tall": every entity below would disagree. */
      const disagreements: string[] = [];
      let tallCount = 0;
      for (const { label, atlas } of entitiesOf(subject.sheetMap)) {
        if (!drawsATile(atlas)) continue;
        const looseAtlas = atlasByLabel(subject.loose.map, label);
        if (looseAtlas === undefined) continue; // reported by the coverage test
        const bySheet = subject.sheetEngine.isTall(tileCode(atlas.attr, atlas.char));
        const byPack = subject.looseEngine.isTall(
          tileCode(looseAtlas.attr, looseAtlas.char),
        );
        if (bySheet) tallCount += 1;
        if (bySheet !== byPack) {
          disagreements.push(`${label}: sheet ${String(bySheet)}, loose ${String(byPack)}`);
        }
      }
      expect(disagreements.slice(0, 20)).toEqual([]);
      /* Entity SLOTS, not selectors: a feat is counted once per lighting
       * variant, so shockbolt-dark's five shop entrances contribute twenty. A
       * bare "they agree" would pass just as well with both engines answering
       * `false` everywhere, which is the exact bug, so the population is pinned
       * too - and pinned at zero for the four packs that must have none. */
      expect(tallCount).toBe(tallEntities);
    });

    it("declares double-height assets only where the source mode has a band", () => {
      /* The pack's own record, straight from maps/tall.txt, in distinct ASSETS -
       * one per selector in the band for these packs. Zero for the four modes
       * list.txt gives `extra:0:0:0`, and a zero is a real assertion here: the
       * converter must not invent a band, and the reader must not conjure one
       * out of an absent file. */
      expect(subject.loose.tall.size).toBe(tall);
    });

    it("both engines pick the SAME player tile for this race and class", () => {
      // The point of threading $RACE/$CLASS through both: race 0 is the player,
      // and a pack whose xtra file remaps it must move BOTH engines or neither.
      const sheet = tileForMonster(subject.sheetMap, 0);
      const loose = tileForMonster(subject.loose.map, 0);
      expect(sheet, "the sheet maps the player").not.toBeNull();
      expect(loose, "the loose pack maps the player").not.toBeNull();
      expect(subject.loosePixels(loose!)).toBe(subject.sheetPixels(sheet!));
    });
  });
}
