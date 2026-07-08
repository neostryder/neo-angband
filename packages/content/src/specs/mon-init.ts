/**
 * Specs for the gamedata files whose upstream parsers live in
 * src/mon-init.c: blow_methods (meth_parser), blow_effects (eff_parser),
 * pain, monster_spell, monster_base, monster, pit.
 *
 * Format strings are copied verbatim from the parser_reg() calls.
 */

import type { FileSpec } from "../records.js";

export const blowMethodsSpec: FileSpec = {
  name: "blow_methods",
  upstream: ["src/mon-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "cut uint cut" },
    { fmt: "stun uint stun" },
    { fmt: "miss uint miss" },
    { fmt: "phys uint phys" },
    { fmt: "msg ?str msg" },
    { fmt: "act str act", repeat: true },
    { fmt: "desc str desc", repeat: true },
  ],
};

export const blowEffectsSpec: FileSpec = {
  name: "blow_effects",
  upstream: ["src/mon-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "power int power" },
    { fmt: "eval int eval" },
    { fmt: "desc str desc", repeat: true },
    { fmt: "lore-color-base sym color" },
    { fmt: "lore-color-resist sym color" },
    { fmt: "lore-color-immune sym color" },
    { fmt: "effect-type str type" },
    { fmt: "resist str resist" },
    { fmt: "lash-type str type" },
  ],
};

export const painSpec: FileSpec = {
  name: "pain",
  upstream: ["src/mon-init.c"],
  recordStart: "type",
  directives: [
    { fmt: "type uint index" },
    { fmt: "message str message", repeat: true },
  ],
};

/**
 * monster_spell.txt: each spell has an implicit first "level"; the
 * power-cutoff directive starts another level, and the lore/message
 * directives attach to the most recent level (the record itself until the
 * first power-cutoff appears).
 */
export const monsterSpellSpec: FileSpec = {
  name: "monster_spell",
  upstream: ["src/mon-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "msgt sym type" },
    { fmt: "hit uint hit" },
    { fmt: "effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "effect-yx int y int x", childOf: ["effect"] },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "power-cutoff int power", repeat: true },
    { fmt: "lore str text", childOf: ["power-cutoff"], repeat: true },
    { fmt: "lore-color-base sym color", childOf: ["power-cutoff"] },
    { fmt: "lore-color-resist sym color", childOf: ["power-cutoff"] },
    { fmt: "lore-color-immune sym color", childOf: ["power-cutoff"] },
    { fmt: "message-vis str text", childOf: ["power-cutoff"], repeat: true },
    { fmt: "message-invis str text", childOf: ["power-cutoff"], repeat: true },
    { fmt: "message-miss str text", childOf: ["power-cutoff"], repeat: true },
    { fmt: "message-save str text", childOf: ["power-cutoff"], repeat: true },
  ],
};

export const monsterBaseSpec: FileSpec = {
  name: "monster_base",
  upstream: ["src/mon-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "glyph char glyph" },
    { fmt: "pain uint pain" },
    { fmt: "flags ?str flags", repeat: true },
    { fmt: "desc str desc", repeat: true },
  ],
};

export const monsterSpec: FileSpec = {
  name: "monster",
  upstream: ["src/mon-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "plural ?str plural" },
    { fmt: "base sym base" },
    { fmt: "glyph char glyph" },
    { fmt: "color sym color" },
    { fmt: "speed int speed" },
    { fmt: "hit-points int hp" },
    { fmt: "light int light" },
    { fmt: "hearing int hearing" },
    { fmt: "smell int smell" },
    { fmt: "armor-class int ac" },
    { fmt: "sleepiness int sleep" },
    { fmt: "depth int level" },
    { fmt: "rarity int rarity" },
    { fmt: "experience int mexp" },
    { fmt: "blow sym method ?sym effect ?rand damage", repeat: true },
    { fmt: "flags ?str flags", repeat: true },
    { fmt: "flags-off ?str flags", repeat: true },
    { fmt: "desc str desc", repeat: true },
    { fmt: "innate-freq int freq" },
    { fmt: "spell-freq int freq" },
    { fmt: "spell-power uint power" },
    { fmt: "spells str spells", repeat: true },
    { fmt: "message-vis sym spell ?str message", repeat: true },
    { fmt: "message-invis sym spell ?str message", repeat: true },
    { fmt: "message-miss sym spell ?str message", repeat: true },
    { fmt: "drop sym tval sym sval uint chance uint min uint max", repeat: true },
    { fmt: "drop-base sym tval uint chance uint min uint max", repeat: true },
    { fmt: "friends uint chance rand number sym name ?sym role", repeat: true },
    { fmt: "friends-base uint chance rand number sym name ?sym role", repeat: true },
    { fmt: "mimic sym tval sym sval", repeat: true },
    { fmt: "shape str name", repeat: true },
    { fmt: "color-cycle sym group sym cycle" },
  ],
};

export const pitSpec: FileSpec = {
  name: "pit",
  upstream: ["src/mon-init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "room uint type" },
    { fmt: "alloc uint rarity uint level" },
    { fmt: "obj-rarity uint obj_rarity" },
    { fmt: "mon-base sym base", repeat: true },
    { fmt: "mon-ban sym race", repeat: true },
    { fmt: "color sym color", repeat: true },
    { fmt: "flags-req ?str flags", repeat: true },
    { fmt: "flags-ban ?str flags", repeat: true },
    { fmt: "innate-freq int freq" },
    { fmt: "spell-req ?str spells", repeat: true },
    { fmt: "spell-ban ?str spells", repeat: true },
  ],
};
