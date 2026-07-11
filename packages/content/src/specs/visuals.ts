/**
 * Spec for lib/gamedata/visuals.txt, whose upstream parser lives in
 * src/ui-visuals.c (visuals_file_parser_init, L1038-1053).
 *
 * Format strings are copied verbatim from the four parser_reg() calls:
 *   parser_reg(parser, "flicker sym color str name", ...)
 *   parser_reg(parser, "flicker-color sym color", ...)
 *   parser_reg(parser, "cycle sym group sym name", ...)
 *   parser_reg(parser, "cycle-color sym color", ...)
 *
 * visuals.txt holds TWO record kinds in one file: legacy "flicker" cycles
 * (a `flicker:` line followed by its `flicker-color:` steps) and the newer
 * grouped "cycle" cycles (a `cycle:` line followed by its `cycle-color:`
 * steps). There is no single record-start directive, so this is modelled as
 * a singleton file (recordStart: null): the whole file compiles to one
 * record whose `flicker` and `cycle` arrays hold the entries in file order,
 * each carrying its color steps as a nested array. The stateful
 * interpretation the C parser performs (indexing the flicker table by the
 * selection color's attr, building/replacing cycles within named groups) is
 * NOT done here - it lives in the front-end-agnostic engine
 * (packages/core/src/visuals), exactly as the C keeps it in ui-visuals.c.
 * The compiler only mirrors the raw directives faithfully.
 */

import type { FileSpec } from "../records.js";

export const visualsSpec: FileSpec = {
  name: "visuals",
  upstream: ["src/ui-visuals.c"],
  recordStart: null,
  directives: [
    { fmt: "flicker sym color str name", repeat: true },
    { fmt: "flicker-color sym color", childOf: ["flicker"], repeat: true },
    { fmt: "cycle sym group sym name", repeat: true },
    { fmt: "cycle-color sym color", childOf: ["cycle"], repeat: true },
  ],
};
