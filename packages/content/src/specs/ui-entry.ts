/**
 * Specs for the second-character-screen configuration files whose upstream
 * parsers live in src/ui-entry.c (ui_entry_parser, shared by ui_entry_base.txt
 * and ui_entry.txt) and src/ui-entry-renderers.c (ui_entry_renderer_parser).
 *
 * Format strings are copied verbatim from the parser_reg() calls
 * (init_parse_ui_entry L2283-2296, init_parse_ui_entry_renderer L1639-1649).
 *
 * The engine that consumes these (packages/core/src/game/ui-entry.ts) performs
 * template resolution, generic (element/stat) expansion, category/priority
 * association and the shortened-label fill; the compiler only mirrors the raw
 * directives faithfully. category accumulates (multiple category lines), so it
 * is marked repeat; priority appears at most once per record in the shipped
 * data (always before any category, i.e. a default priority) so it is a scalar.
 * The MAX_SHORTENED (10) label overrides are registered by the upstream loop
 * `parser_reg(p, format("label%d str label%d", i, i), ...)`.
 */

import type { FileSpec } from "../records.js";

const uiEntryDirectives = [
  { fmt: "name str name" },
  { fmt: "template str template" },
  { fmt: "parameter str parameter" },
  { fmt: "renderer str renderer" },
  { fmt: "combine str combine" },
  { fmt: "label str label" },
  { fmt: "label1 str label1" },
  { fmt: "label2 str label2" },
  { fmt: "label3 str label3" },
  { fmt: "label4 str label4" },
  { fmt: "label5 str label5" },
  { fmt: "label6 str label6" },
  { fmt: "label7 str label7" },
  { fmt: "label8 str label8" },
  { fmt: "label9 str label9" },
  { fmt: "label10 str label10" },
  { fmt: "category str category", repeat: true },
  { fmt: "priority str priority" },
  { fmt: "flags ?str flags", repeat: true },
  { fmt: "desc str desc", repeat: true },
] as const;

export const uiEntryBaseSpec: FileSpec = {
  name: "ui_entry_base",
  upstream: ["src/ui-entry.c"],
  recordStart: "name",
  directives: [...uiEntryDirectives],
};

export const uiEntrySpec: FileSpec = {
  name: "ui_entry",
  upstream: ["src/ui-entry.c"],
  recordStart: "name",
  directives: [...uiEntryDirectives],
};

export const uiEntryRendererSpec: FileSpec = {
  name: "ui_entry_renderer",
  upstream: ["src/ui-entry-renderers.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "code str code" },
    { fmt: "combine str combine" },
    { fmt: "colors str colors" },
    { fmt: "labelcolors str colors" },
    { fmt: "symbols str symbols" },
    { fmt: "ndigit int ndigit" },
    { fmt: "sign str sign" },
    { fmt: "units str units" },
    { fmt: "combined-renderer str name" },
  ],
};
