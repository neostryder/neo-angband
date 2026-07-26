/**
 * Specs for the gamedata files whose upstream parsers live in
 * src/obj-init.c: projection, object_base, slay, brand, curse, activation
 * (act_parser), object, ego_item, artifact, object_property.
 *
 * Format strings are copied verbatim from the parser_reg() calls.
 */

import type { FileSpec } from "../records.js";

export const projectionSpec: FileSpec = {
  name: "projection",
  upstream: ["src/obj-init.c"],
  recordStart: "code",
  directives: [
    { fmt: "code str code" },
    { fmt: "name str name" },
    { fmt: "type str type" },
    { fmt: "desc str desc" },
    { fmt: "player-desc str desc" },
    { fmt: "blind-desc str desc" },
    { fmt: "lash-desc str desc" },
    { fmt: "numerator uint num" },
    { fmt: "denominator rand denom" },
    { fmt: "divisor uint div" },
    { fmt: "damage-cap uint cap" },
    { fmt: "msgt sym type" },
    { fmt: "obvious uint answer" },
    { fmt: "wake uint answer" },
    { fmt: "color sym color" },
  ],
};

export const objectBaseSpec: FileSpec = {
  name: "object_base",
  upstream: ["src/obj-init.c"],
  recordStart: "name",
  header: ["default"],
  directives: [
    { fmt: "default sym label int value", repeat: true },
    { fmt: "name sym tval ?str name" },
    { fmt: "graphics sym color" },
    { fmt: "break int breakage" },
    { fmt: "max-stack int size" },
    { fmt: "flags str flags", repeat: true },
  ],
};

export const slaySpec: FileSpec = {
  name: "slay",
  upstream: ["src/obj-init.c"],
  recordStart: "code",
  directives: [
    { fmt: "code str code" },
    { fmt: "name str name" },
    { fmt: "race-flag sym flag" },
    { fmt: "base sym base" },
    { fmt: "multiplier uint multiplier" },
    { fmt: "o-multiplier uint multiplier" },
    { fmt: "power uint power" },
    { fmt: "melee-verb str verb" },
    { fmt: "range-verb str verb" },
  ],
};

export const brandSpec: FileSpec = {
  name: "brand",
  upstream: ["src/obj-init.c"],
  recordStart: "code",
  directives: [
    { fmt: "code str code" },
    { fmt: "name str name" },
    { fmt: "verb str verb" },
    { fmt: "multiplier uint multiplier" },
    { fmt: "o-multiplier uint multiplier" },
    { fmt: "power uint power" },
    { fmt: "resist-flag sym flag" },
    { fmt: "vuln-flag sym flag" },
  ],
};

export const curseSpec: FileSpec = {
  name: "curse",
  upstream: ["src/obj-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "type sym tval", repeat: true },
    { fmt: "weight int adj" },
    { fmt: "combat int to-h int to-d int to-a" },
    { fmt: "effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "effect-yx int y int x", childOf: ["effect"] },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "msg str text", repeat: true },
    { fmt: "time rand time" },
    { fmt: "flags str flags", repeat: true },
    { fmt: "values str values", repeat: true },
    { fmt: "desc str desc", repeat: true },
    { fmt: "conflict str conf", repeat: true },
    { fmt: "conflict-flags str flags", repeat: true },
  ],
};

export const activationSpec: FileSpec = {
  name: "activation",
  upstream: ["src/obj-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "aim uint aim" },
    { fmt: "level int level" },
    { fmt: "power uint power" },
    { fmt: "effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "effect-yx int y int x", childOf: ["effect"] },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "msg str msg", repeat: true },
    { fmt: "desc str desc", repeat: true },
  ],
};

export const objectSpec: FileSpec = {
  name: "object",
  upstream: ["src/obj-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "type sym tval" },
    { fmt: "graphics char glyph sym color" },
    { fmt: "level int level" },
    { fmt: "weight int weight" },
    { fmt: "cost int cost" },
    { fmt: "alloc int common str minmax" },
    { fmt: "attack rand hd rand to-h rand to-d" },
    { fmt: "armor int ac rand to-a" },
    { fmt: "charges rand charges" },
    /* Repeats once in the data (Dragon Breath); upstream last-wins. */
    { fmt: "pile int prob rand stack", repeat: true },
    { fmt: "flags str flags", repeat: true },
    { fmt: "power int power" },
    { fmt: "effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "effect-yx int y int x", childOf: ["effect"] },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "msg str text", repeat: true },
    { fmt: "vis-msg str text", repeat: true },
    { fmt: "time rand time" },
    { fmt: "pval rand pval" },
    { fmt: "values str values", repeat: true },
    { fmt: "desc str text", repeat: true },
    { fmt: "slay str code", repeat: true },
    { fmt: "brand str code", repeat: true },
    { fmt: "curse sym name int power", repeat: true },
  ],
};

export const egoItemSpec: FileSpec = {
  name: "ego_item",
  upstream: ["src/obj-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "info int cost int rating" },
    { fmt: "alloc int common str minmax" },
    { fmt: "type sym tval", repeat: true },
    { fmt: "item sym tval sym sval", repeat: true },
    { fmt: "combat rand th rand td rand ta" },
    { fmt: "min-combat int th int td int ta" },
    { fmt: "act str name" },
    { fmt: "time rand time" },
    { fmt: "flags ?str flags", repeat: true },
    { fmt: "flags-off ?str flags", repeat: true },
    { fmt: "values str values", repeat: true },
    { fmt: "min-values str min_values", repeat: true },
    { fmt: "desc str text", repeat: true },
    { fmt: "slay str code", repeat: true },
    { fmt: "brand str code", repeat: true },
    { fmt: "curse sym name int power", repeat: true },
  ],
};

export const artifactSpec: FileSpec = {
  name: "artifact",
  upstream: ["src/obj-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "base-object sym tval sym sval" },
    { fmt: "graphics char glyph sym color" },
    { fmt: "level int level" },
    { fmt: "weight int weight" },
    { fmt: "cost int cost" },
    { fmt: "alloc int common str minmax" },
    { fmt: "attack rand hd int to-h int to-d" },
    { fmt: "armor int ac int to-a" },
    { fmt: "flags ?str flags", repeat: true },
    { fmt: "act str name" },
    { fmt: "time rand time" },
    { fmt: "msg str text", repeat: true },
    { fmt: "values str values", repeat: true },
    { fmt: "desc str text", repeat: true },
    { fmt: "slay str code", repeat: true },
    { fmt: "brand str code", repeat: true },
    { fmt: "curse sym name int power", repeat: true },
  ],
};

export const objectPropertySpec: FileSpec = {
  name: "object_property",
  upstream: ["src/obj-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "code str code" },
    { fmt: "type str type" },
    { fmt: "subtype str subtype" },
    { fmt: "id-type str id" },
    { fmt: "power int power" },
    { fmt: "mult int mult" },
    { fmt: "type-mult sym type int mult", repeat: true },
    { fmt: "adjective str adj" },
    { fmt: "neg-adjective str neg_adj" },
    { fmt: "msg str msg" },
    { fmt: "desc str desc" },
    { fmt: "bindui sym ui int aux ?int uival" },
  ],
};
