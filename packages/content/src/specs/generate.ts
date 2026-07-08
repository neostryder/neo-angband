/**
 * Specs for the gamedata files whose upstream parsers live in
 * src/generate.c: dungeon_profile (profile_parser), room_template
 * (room_parser), vault (vault_parser).
 *
 * Format strings are copied verbatim from the parser_reg() calls.
 */

import type { FileSpec } from "../records.js";

export const dungeonProfileSpec: FileSpec = {
  name: "dungeon_profile",
  upstream: ["src/generate.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "params int block int rooms int unusual int rarity" },
    { fmt: "tunnel int rnd int chg int con int pen int jct" },
    { fmt: "streamer int den int rng int mag int mc int qua int qc" },
    {
      fmt: "room sym name int rating int height int width int level int pit int rarity int cutoff",
      repeat: true,
    },
    { fmt: "min-level int min" },
    { fmt: "alloc int alloc" },
  ],
};

export const roomTemplateSpec: FileSpec = {
  name: "room_template",
  upstream: ["src/generate.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "type uint type" },
    { fmt: "rating int rating" },
    { fmt: "rows uint height" },
    { fmt: "columns uint width" },
    { fmt: "doors uint doors" },
    { fmt: "tval sym tval" },
    { fmt: "flags str flags", repeat: true },
    { fmt: "D str text", repeat: true },
  ],
};

export const vaultSpec: FileSpec = {
  name: "vault",
  upstream: ["src/generate.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "type str type" },
    { fmt: "rating int rating" },
    { fmt: "rows uint height" },
    { fmt: "columns uint width" },
    { fmt: "min-depth uint min_lev" },
    { fmt: "max-depth uint max_lev" },
    { fmt: "flags str flags", repeat: true },
    { fmt: "D str text", repeat: true },
  ],
};
