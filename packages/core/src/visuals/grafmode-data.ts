// Generated from reference/lib/tiles/list.txt by
// scripts/gen-grafmode.mjs. Do not edit.
//
// The graphics-mode catalog METADATA (functional data) from Angband's tile
// list. Faithful to grafmode.c's parse of name/directory/size/pref/extra.
//
// NO TILE IMAGE ASSETS are bundled: the tile art packs (adam-bolt, gervais,
// shockbolt, nomad) carry their own licenses - Shockbolt's is NOT freely
// redistributable for commercial use - so only this metadata is ported. A web
// front end loads a user-supplied tile pack from a configurable base URL and
// builds file paths from `directory`/`file` (see packages/web). ASCII is the
// default and the game runs fully with no tile pack present.

import type { GraphicsMode } from "./grafmode";

/** Every parsed graphics mode from list.txt, in file order (grafID 1..N). */
export const GRAPHICS_MODE_CATALOG: readonly GraphicsMode[] = [
  {
    grafID: 1,
    menuname: "Original Tiles",
    directory: "old",
    cellWidth: 8,
    cellHeight: 8,
    file: "8x8.png",
    pref: "graf-xxx.prf",
    alphablend: 0,
    overdrawRow: 0,
    overdrawMax: 0,
  },
  {
    grafID: 2,
    menuname: "Adam Bolt's tiles",
    directory: "adam-bolt",
    cellWidth: 16,
    cellHeight: 16,
    file: "16x16.png",
    pref: "graf-new.prf",
    alphablend: 0,
    overdrawRow: 0,
    overdrawMax: 0,
  },
  {
    grafID: 3,
    menuname: "David Gervais' tiles",
    directory: "gervais",
    cellWidth: 32,
    cellHeight: 32,
    file: "32x32.png",
    pref: "graf-dvg.prf",
    alphablend: 0,
    overdrawRow: 0,
    overdrawMax: 0,
  },
  {
    grafID: 4,
    menuname: "Nomad's tiles",
    directory: "nomad",
    cellWidth: 16,
    cellHeight: 16,
    file: "8x16.png",
    pref: "graf-nmd.prf",
    alphablend: 0,
    overdrawRow: 0,
    overdrawMax: 0,
  },
  {
    grafID: 5,
    menuname: "Shockbolt Dark",
    directory: "shockbolt",
    cellWidth: 64,
    cellHeight: 64,
    file: "64x64.png",
    pref: "graf-shb-dark.prf",
    alphablend: 1,
    overdrawRow: 27,
    overdrawMax: 31,
  },
  {
    grafID: 6,
    menuname: "Shockbolt Light",
    directory: "shockbolt",
    cellWidth: 64,
    cellHeight: 64,
    file: "64x64.png",
    pref: "graf-shb-light.prf",
    alphablend: 1,
    overdrawRow: 27,
    overdrawMax: 31,
  },
];
