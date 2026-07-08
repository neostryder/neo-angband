#!/usr/bin/env node
/**
 * neo-linoleum: convert the bundled legacy tilesheets into Linoleum
 * loose packs.
 *
 * Usage:
 *   neo-linoleum [--tiles <dir>] [--out <dir>] [--packs key1,key2]
 *
 * Defaults: tiles = <repo>/reference/lib/tiles, out = <repo>/build/linoleum.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertPacks } from "./convert.js";
import { ALL_PACKS, selectPacks } from "./packs.js";

const USAGE = [
  "Usage: neo-linoleum [--tiles <dir>] [--out <dir>] [--packs key1,key2]",
  "",
  "Options:",
  "  --tiles <dir>   Legacy tiles root (default: <repo>/reference/lib/tiles)",
  "  --out <dir>     Output root (default: <repo>/build/linoleum)",
  "  --packs <keys>  Comma-separated pack keys (default: all packs)",
  "  --help          Show this help",
  "",
  `Pack keys: ${ALL_PACKS.map((pack) => pack.key).join(", ")}`,
].join("\n");

/**
 * Licensing summaries per pack key. No license or readme files ship inside
 * the individual reference/lib/tiles/<dir>/ folders (they hold only the
 * tilesheet, pref files, and a Makefile); the authoritative statements live
 * in reference/docs/copying.rst.
 */
const LICENSE_NOTES: Record<string, readonly string[]> = {
  "original-tiles": [
    "Original 8x8 tiles: no separate licence exception in",
    "reference/docs/copying.rst, so they are covered by Angband's dual",
    "licence (GNU GPL v2 or the Angband licence).",
  ],
  "adam-bolt": [
    "Adam Bolt's 16x16 tiles: per reference/docs/copying.rst they may be",
    "redistributed and used for any purpose, with or without modification.",
  ],
  gervais: [
    "David Gervais' 32x32 tiles: per reference/docs/copying.rst they are",
    "licensed under Creative Commons Attribution 3.0 (CC BY 3.0).",
  ],
  nomad: [
    "Nomad's 8x16 tiles: no separate licence exception in",
    "reference/docs/copying.rst, so they are covered by Angband's dual",
    "licence (GNU GPL v2 or the Angband licence).",
  ],
};

const SHOCKBOLT_WARNING: readonly string[] = [
  "WARNING: Shockbolt's 64x64 tiles are restrictively licensed",
  "(copyright (C) Raymond Gaustadnes 2012; see reference/docs/copying.rst).",
  "Modification of the tileset and use or distribution outside Angband are",
  "NOT permitted. The converted pack is derived from that tileset, so it is",
  "for PERSONAL USE ONLY and must not be redistributed.",
];

interface CliArguments {
  tiles: string | null;
  out: string | null;
  packs: readonly string[] | null;
  help: boolean;
}

function parseArguments(argv: readonly string[]): CliArguments {
  const parsed: CliArguments = { tiles: null, out: null, packs: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--tiles" || arg === "--out" || arg === "--packs") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}.`);
      }
      i += 1;
      if (arg === "--tiles") {
        parsed.tiles = value;
      } else if (arg === "--out") {
        parsed.out = value;
      } else {
        parsed.packs = value
          .split(",")
          .map((key) => key.trim())
          .filter((key) => key.length > 0);
      }
      continue;
    }
    throw new Error(`Unknown argument '${arg}'.`);
  }

  return parsed;
}

/** Walk up from a directory to the pnpm workspace root. */
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function printLicenseNotes(packKeys: readonly string[]): void {
  console.log("License notes for the selected tilesets:");
  console.log("");
  let shockboltWarned = false;
  for (const key of packKeys) {
    if (key === "shockbolt-dark" || key === "shockbolt-light") {
      if (!shockboltWarned) {
        for (const line of SHOCKBOLT_WARNING) {
          console.log(`  ${line}`);
        }
        console.log("");
        shockboltWarned = true;
      }
      continue;
    }
    const note = LICENSE_NOTES[key];
    if (note !== undefined) {
      for (const line of note) {
        console.log(`  ${line}`);
      }
      console.log("");
    }
  }
  console.log("Converted packs are not shipped with the port; convert locally.");
  console.log("");
}

function main(): number {
  let args: CliArguments;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(USAGE);
    return 1;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(scriptDir) ?? process.cwd();
  const tilesRoot = resolve(args.tiles ?? join(repoRoot, "reference", "lib", "tiles"));
  const outputRoot = resolve(args.out ?? join(repoRoot, "build", "linoleum"));

  let selectedKeys: readonly string[];
  try {
    selectedKeys = selectPacks(args.packs ?? undefined).map((pack) => pack.key);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(USAGE);
    return 1;
  }

  if (!existsSync(tilesRoot)) {
    console.error(`Tiles root not found: ${tilesRoot}`);
    return 1;
  }

  console.log(`Tiles root: ${tilesRoot}`);
  console.log(`Output root: ${outputRoot}`);
  console.log("");
  printLicenseNotes(selectedKeys);

  try {
    convertPacks({
      tilesRoot,
      outputRoot,
      packKeys: selectedKeys,
      log: (message) => {
        console.log(message);
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  return 0;
}

process.exitCode = main();
