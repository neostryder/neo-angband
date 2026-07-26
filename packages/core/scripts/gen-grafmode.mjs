// Regenerates packages/core/src/visuals/grafmode-data.ts from the upstream
// reference/lib/tiles/list.txt (the graphics-mode catalog).
//
// This extracts ONLY the catalog METADATA - mode id, menu name, directory
// name, tile pixel dimensions, image/pref FILENAMES, and the double-height
// tile rows. It does NOT copy, bundle, or reference any tile IMAGE asset
// (.png/.bmp). The tile art packs (adam-bolt, gervais, shockbolt, nomad) have
// their own licenses (Shockbolt's is NOT freely redistributable for
// commercial use), so no image bytes ever enter packages/**. A user supplies
// their own tile pack at runtime and the web renderer builds URLs from this
// metadata (see packages/web); ASCII stays the default.
//
// Faithful to grafmode.c init_parse_grafmode (L92-103): the directives are
//   name uint index str menuname
//   directory sym dirname
//   size uint wid uint hgt str filename
//   pref str prefname
//   extra uint alpha uint row uint max
//
// Usage (from repo root):
//   node packages/core/scripts/gen-grafmode.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const listPath = resolve(here, "../../../reference/lib/tiles/list.txt");
const outPath = resolve(here, "../src/visuals/grafmode-data.ts");

const text = readFileSync(listPath, "utf8");

/** @type {any[]} */
const modes = [];
/** @type {any} */
let mode = null;

for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (line.length === 0 || line.startsWith("#")) continue;
  const parts = line.split(":");
  const directive = parts[0];
  if (directive === "name") {
    // name:index:menuname  (menuname is str = the rest of the line)
    mode = {
      grafID: Number(parts[1]),
      menuname: parts.slice(2).join(":"),
      directory: "",
      cellWidth: 0,
      cellHeight: 0,
      file: "",
      pref: "none",
      alphablend: 0,
      overdrawRow: 0,
      overdrawMax: 0,
    };
    modes.push(mode);
  } else if (mode === null) {
    continue;
  } else if (directive === "directory") {
    mode.directory = parts[1];
  } else if (directive === "size") {
    // size:wid:hgt:filename  (filename is str = the rest)
    mode.cellWidth = Number(parts[1]);
    mode.cellHeight = Number(parts[2]);
    mode.file = parts.slice(3).join(":");
  } else if (directive === "pref") {
    mode.pref = parts.slice(1).join(":");
  } else if (directive === "extra") {
    mode.alphablend = Number(parts[1]);
    mode.overdrawRow = Number(parts[2]);
    mode.overdrawMax = Number(parts[3]);
  }
}

const body = modes
  .map(
    (m) =>
      `  {\n` +
      `    grafID: ${m.grafID},\n` +
      `    menuname: ${JSON.stringify(m.menuname)},\n` +
      `    directory: ${JSON.stringify(m.directory)},\n` +
      `    cellWidth: ${m.cellWidth},\n` +
      `    cellHeight: ${m.cellHeight},\n` +
      `    file: ${JSON.stringify(m.file)},\n` +
      `    pref: ${JSON.stringify(m.pref)},\n` +
      `    alphablend: ${m.alphablend},\n` +
      `    overdrawRow: ${m.overdrawRow},\n` +
      `    overdrawMax: ${m.overdrawMax},\n` +
      `  },`,
  )
  .join("\n");

const out = `// Generated from reference/lib/tiles/list.txt by
// scripts/gen-grafmode.mjs. Do not edit.
//
// The graphics-mode catalog METADATA (functional data) from Angband's tile
// list. Faithful to grafmode.c's parse of name/directory/size/pref/extra.
//
// NO TILE IMAGE ASSETS are bundled: the tile art packs (adam-bolt, gervais,
// shockbolt, nomad) carry their own licenses - Shockbolt's is NOT freely
// redistributable for commercial use - so only this metadata is ported. A web
// front end loads a user-supplied tile pack from a configurable base URL and
// builds file paths from \`directory\`/\`file\` (see packages/web). ASCII is the
// default and the game runs fully with no tile pack present.

import type { GraphicsMode } from "./grafmode";

/** Every parsed graphics mode from list.txt, in file order (grafID 1..N). */
export const GRAPHICS_MODE_CATALOG: readonly GraphicsMode[] = [
${body}
];
`;

writeFileSync(outPath, out, "utf8");
console.log(`Wrote ${modes.length} graphics modes to ${outPath}`);
