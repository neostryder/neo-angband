#!/usr/bin/env node
/**
 * Build the demonstration Linoleum loose pack the bundled tiles mod declares.
 *
 * WHY THIS IS GENERATED AND NOT COMMITTED. A loose pack is one PNG per tile:
 * converting the 8x8 Original Tiles sheet (a 220 KiB image) yields ~1500 files
 * and ~2.3 MiB. Committing that many generated binaries to demonstrate a format
 * would be repository noise, and the pack is a pure function of art that is
 * already in the tree - packages/web/public/tiles/old/, the same tile set the
 * game draws with the tilesheet engine. So it is derived at build time instead,
 * from the game's OWN art, which is also the point of the demo: the same tiles,
 * drawn by the other engine, should look identical.
 *
 * Run automatically by the web package's `dev` and `bundle` scripts, and cheap
 * to re-run: it skips the work when the pack's manifest.txt is already there
 * (delete packages/web/public/mods/linoleum/ to force a rebuild).
 *
 * Best-effort by design. If the converter is not built yet (`pnpm build`) or the
 * source art is missing, this warns and exits 0 rather than failing the build:
 * the tile mod's row then finds no pack and the game falls back to ASCII for
 * that row, exactly as a missing tilesheet does. It never touches core's
 * public/tiles/ - it only writes under public/mods/.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The pack key to build, from @neo-angband/linoleum's ALL_PACKS table. */
const PACK_KEY = "original-tiles";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tilesRoot = join(webRoot, "public", "tiles");
const outputRoot = join(webRoot, "public", "mods", "linoleum");
const packRoot = join(outputRoot, PACK_KEY);

function note(message) {
  console.log(`[linoleum-demo] ${message}`);
}

if (existsSync(join(packRoot, "manifest.txt"))) {
  note(`already built: ${relative(webRoot, packRoot)}`);
  process.exit(0);
}

let linoleum;
try {
  linoleum = await import("@neo-angband/linoleum");
} catch (error) {
  note(`skipped - the converter is not built yet (run pnpm build): ${error.message}`);
  process.exit(0);
}

const packConfig = linoleum.ALL_PACKS.find((pack) => pack.key === PACK_KEY);
if (packConfig === undefined) {
  note(`skipped - no pack named '${PACK_KEY}' in ALL_PACKS`);
  process.exit(0);
}

const sourceDir = join(tilesRoot, packConfig.sourceDirectory);
if (!existsSync(join(sourceDir, packConfig.imageFile))) {
  note(`skipped - source art missing: ${relative(webRoot, sourceDir)}`);
  process.exit(0);
}

try {
  mkdirSync(outputRoot, { recursive: true });
  const result = linoleum.buildPackExport(packConfig, tilesRoot, outputRoot);
  note(
    `built ${result.displayName} from ${relative(webRoot, sourceDir)} -> ` +
      `${relative(webRoot, result.packRoot)} (${result.exactSelectorCount} target rules)`,
  );
} catch (error) {
  note(`skipped - conversion failed: ${error.message}`);
}
