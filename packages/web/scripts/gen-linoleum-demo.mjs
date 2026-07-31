#!/usr/bin/env node
/**
 * Build the Linoleum loose packs the bundled tiles mod declares.
 *
 * WHY THESE ARE GENERATED AND NOT COMMITTED. A loose pack is one PNG per tile.
 * Measured: the 8x8 Original set converts to 1499 files / 2.3 MiB, and the 64x64
 * Shockbolt set to 1584 files / 15 MiB. Committing ~9000 generated binaries to
 * demonstrate a format would be repository noise, and every pack is a pure
 * function of art already in the tree - packages/web/public/tiles/ - so they are
 * derived at build time instead, from the game's OWN art. That is also the point:
 * the same tiles, drawn by the other engine, should look identical.
 *
 * WHICH PACKS. The mod declares all six (grafID 101-106). This script builds a
 * subset by default, because the packs it does not build are not free:
 *
 *   - DEFAULT (`original-tiles`): ~2.3 MiB. Cheap enough to sit in every dev
 *     build and every Pages deploy.
 *   - ALL SIX (`--packs all`, or NEO_LINOLEUM_PACKS=all): measured at 42 MiB
 *     across 9124 files, in 9 seconds. The nine seconds are free; the 9124 files
 *     are not - that is a real cost on a static host, thousands of tiny objects to
 *     upload on every deploy. So it is opt-in rather than the default, and the
 *     packs that are not built simply have no row to select. Use it when testing
 *     the other five, and on the desktop build where the packs are local files.
 *
 * A pack that is not built is not a broken row: composeTileModes offers a
 * declared pack, the engine finds no manifest.txt, and that row falls back to
 * ASCII exactly as a missing tilesheet does. What used to make that dangerous was
 * this script's silence - see NOISE below.
 *
 * NOISE. Every skip prints, and `--strict` turns skips into a non-zero exit, so a
 * release build can refuse to ship art-less. Without --strict a missing converter
 * or missing source art warns and exits 0, because a plain `pnpm dev` before the
 * first `pnpm build` should not be a hard failure.
 *
 * Run automatically by the web package's `dev` and `bundle` scripts, and cheap to
 * re-run: it skips a pack whose manifest.txt is already there (delete
 * packages/web/public/mods/neo-linoleum/ to force a rebuild). It never touches core's
 * public/tiles/ - it only writes under public/mods/.
 *
 * ATTRIBUTION. This script is the only thing that ever produces converted art, so
 * it is what has to credit it. public/tiles/CREDITS.md covers the TILESHEETS - the
 * form the game itself draws - and cutting a sheet into one PNG per tile is a
 * second, different use of the same art, belonging to the neo-linoleum mod. So the
 * credit is written HERE, into the output directory, beside the packs. Wherever the
 * loose files go the credit goes with them, which a file back in public/tiles/
 * could not promise: these bytes are gitignored and land in a Pages deploy only
 * when someone passes --packs all.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tilesRoot = join(webRoot, "public", "tiles");
const outputRoot = join(webRoot, "public", "mods", "neo-linoleum");

/** The one pack cheap enough to build unconditionally (see WHICH PACKS). */
const DEFAULT_PACK_KEYS = ["original-tiles"];

function note(message) {
  console.log(`[linoleum-demo] ${message}`);
}

/**
 * `--packs a,b` / `--packs all`, else NEO_LINOLEUM_PACKS, else the default.
 * Returns null for "every pack in ALL_PACKS".
 */
function requestedKeys(argv, env) {
  const flag = argv.indexOf("--packs");
  const raw = flag >= 0 ? argv[flag + 1] : env.NEO_LINOLEUM_PACKS;
  if (raw === undefined || raw === "") return DEFAULT_PACK_KEYS;
  if (raw === "all") return null;
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

const strict = process.argv.includes("--strict");
const wanted = requestedKeys(process.argv, process.env);

/** Report a skip; under --strict this is fatal. */
const skips = [];
function skip(message) {
  note(`skipped - ${message}`);
  skips.push(message);
}

let linoleum;
try {
  linoleum = await import("@neo-angband/linoleum");
} catch (error) {
  /* Not a skip we can attribute to one pack, and under --strict a build that
   * cannot even load the converter has nothing to gate. */
  note(`stopped - the converter is not built yet (run pnpm build): ${error.message}`);
  process.exit(strict ? 1 : 0);
}

const selected =
  wanted === null
    ? linoleum.ALL_PACKS
    : wanted.map((key) => {
        const pack = linoleum.ALL_PACKS.find((p) => p.key === key);
        if (pack === undefined) {
          /* A typo'd key is a build-script bug, not a missing asset: fail loudly
           * whatever --strict says, rather than silently building nothing. */
          note(`FATAL - no pack named '${key}' in ALL_PACKS`);
          process.exit(1);
        }
        return pack;
      });

note(`building ${selected.length} pack(s): ${selected.map((p) => p.key).join(", ")}`);

/**
 * The attribution that travels with converted art (see ATTRIBUTION above).
 *
 * `present` is the pack keys actually on disk when this is written, so the file
 * credits what is there rather than what the mod declares - a static list would
 * claim Shockbolt in a default build that never converted it.
 *
 * Deliberately no email address: the author consented to being contactable, which
 * is not consent to having his address published, and Angband's own docs carry
 * none for him either.
 */
function creditsText(present) {
  const rows = present.length > 0 ? present.map((k) => `- \`${k}/\``).join("\n") : "- (none built)";
  return `# Converted tile packs - credits and licences

The packs in this directory are **converted art**, not new art. Each is one PNG per
tile, cut from the tilesheet of the tile set it is named for, by
\`packages/web/scripts/gen-linoleum-demo.mjs\` in the Neo Angband repository. They are
generated at build time and committed nowhere.

They belong to the **neo-linoleum** mod: nothing here is drawn with no mod enabled,
and the game's own graphics come from \`public/tiles/\` instead, as tilesheets. That
directory's \`CREDITS.md\` is the credit for the tilesheets. This file is the credit for
cutting them up, which is a separate use of the same art.

Present in this build:

${rows}

## The art's terms are the source set's terms

Converting does not change who owns a tile or what may be done with it, and **a
conversion is a modification** - it cuts one sheet into hundreds of separate images,
so a licence that permits redistribution but not modification does not permit a
converted pack at all. Each pack carries whatever its source set carried, and the
five sets' terms differ from each other; they are stated per set in
\`public/tiles/CREDITS.md\`. Two that matter here:

- **David Gervais' tiles** (\`gervais/\`) - Creative Commons Attribution 3.0, which
  permits modification. \`public/tiles/CREDITS.md\` is the attribution.
- **Shockbolt's tiles** (\`shockbolt-dark/\`, \`shockbolt-light/\`) - copyright (C)
  Raymond "Shockbolt" Gaustadnes 2012. Angband's licence for this set grants no
  right to modify it, so the conversion is **not** covered by that licence. It is
  bundled under permission the author granted **Neo Angband specifically**, for use
  both as the Angband tilesheet and as separate converted tiles, conditional on the
  project remaining non-commercial. That permission is this project's and travels
  with neither a fork nor a pack you extract from here. **If you want to use this
  tileset in a project of your own, contact the author for permission.**

## Packs you build yourself

The same rule, and it is the reason this file exists rather than a blanket licence:
convert your own copies freely for your own use, and check the source art's licence
before you share one. State the art's licence in any pack you publish.

The format, the engine and the converter are separate from the art and carry Neo
Angband's own dual licence (GPL v2 or the Angband licence). See
https://github.com/neostryder/neo-angband-mod-linoleum
`;
}

for (const packConfig of selected) {
  const packRoot = join(outputRoot, packConfig.key);
  if (existsSync(join(packRoot, "manifest.txt"))) {
    note(`already built: ${relative(webRoot, packRoot)}`);
    continue;
  }

  const sourceDir = join(tilesRoot, packConfig.sourceDirectory);
  if (!existsSync(join(sourceDir, packConfig.imageFile))) {
    skip(`${packConfig.key}: source art missing (${relative(webRoot, sourceDir)})`);
    continue;
  }

  try {
    mkdirSync(outputRoot, { recursive: true });
    const result = linoleum.buildPackExport(packConfig, tilesRoot, outputRoot);
    note(
      `built ${result.displayName} from ${relative(webRoot, sourceDir)} -> ` +
        `${relative(webRoot, result.packRoot)} (${result.exactSelectorCount} target rules)`,
    );
  } catch (error) {
    skip(`${packConfig.key}: conversion failed - ${error.message}`);
  }
}

/* Written every run, after the loop, so it names the packs that are actually there
 * - including ones an earlier run built and this one skipped as "already built". */
const present = linoleum.ALL_PACKS.map((p) => p.key).filter((key) =>
  existsSync(join(outputRoot, key, "manifest.txt")),
);
if (present.length > 0) {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, "CREDITS.md"), creditsText(present), "utf8");
  note(`wrote CREDITS.md for ${present.length} pack(s): ${present.join(", ")}`);
}

if (skips.length > 0 && strict) {
  note(`FAILING: --strict and ${skips.length} pack(s) did not build`);
  process.exit(1);
}
