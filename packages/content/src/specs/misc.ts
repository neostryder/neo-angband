/**
 * Specs for gamedata files whose upstream parsers live in single-purpose
 * sources: summon (src/mon-summon.c), chest_trap (src/obj-chest.c), quest
 * (src/player-quest.c), player_timed (src/player-timed.c), store
 * (src/store.c).
 *
 * Format strings are copied verbatim from the parser_reg() calls.
 */

import type { FileSpec } from "../records.js";

export const summonSpec: FileSpec = {
  name: "summon",
  upstream: ["src/mon-summon.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "msgt sym type" },
    { fmt: "uniques int allowed" },
    { fmt: "base sym base", repeat: true },
    { fmt: "race-flag sym flag" },
    { fmt: "fallback str fallback" },
    { fmt: "desc str desc" },
  ],
};

export const chestTrapSpec: FileSpec = {
  name: "chest_trap",
  upstream: ["src/obj-chest.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "code str code" },
    { fmt: "level int level" },
    { fmt: "effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "destroy int val" },
    { fmt: "magic int val" },
    { fmt: "msg str text", repeat: true },
    { fmt: "msg-death str text", repeat: true },
  ],
};

export const questSpec: FileSpec = {
  name: "quest",
  upstream: ["src/player-quest.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "level uint level" },
    { fmt: "race str race" },
    { fmt: "number uint number" },
  ],
};

/**
 * player_timed.txt: the effect-* directives attach to whichever of
 * on-begin-effect / on-end-effect was seen most recently, mirroring the
 * upstream parse state.
 */
export const playerTimedSpec: FileSpec = {
  name: "player_timed",
  upstream: ["src/player-timed.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "desc str text", repeat: true },
    { fmt: "on-end str text", repeat: true },
    { fmt: "on-increase str text", repeat: true },
    { fmt: "on-decrease str text", repeat: true },
    { fmt: "msgt sym type" },
    { fmt: "fail uint code str flag", repeat: true },
    { fmt: "grade sym color int max sym name sym up_msg ?sym down_msg", repeat: true },
    { fmt: "resist sym elem" },
    { fmt: "brand sym name", repeat: true },
    { fmt: "slay sym name", repeat: true },
    { fmt: "flag-synonym sym code int exact", repeat: true },
    { fmt: "on-begin-effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "on-end-effect sym eff ?sym type ?int radius ?int other", repeat: true },
    /* Unlike class.txt / object.txt / trap.txt, all four of player-timed.c's
     * effect-detail handlers return PARSE_ERROR_MISSING_RECORD_HEADER when
     * ps->e is NULL (player-timed.c L480, L496, L524, L557) instead of
     * tolerating the orphan - hence requireParent (ptimed.c
     * test_missing_effect0). `effect-dice` also dice_free()s any previous
     * dice (L503-505), so a repeat is legal and the last wins
     * (ptimed.c test_effectdice0). */
    {
      fmt: "effect-yx int y int x",
      childOf: ["on-begin-effect", "on-end-effect"],
      requireParent: true,
    },
    {
      fmt: "effect-dice str dice",
      childOf: ["on-begin-effect", "on-end-effect"],
      requireParent: true,
      lastWins: true,
    },
    {
      fmt: "effect-expr sym name sym base str expr",
      childOf: ["on-begin-effect", "on-end-effect"],
      requireParent: true,
      repeat: true,
    },
    {
      fmt: "effect-msg str text",
      childOf: ["on-begin-effect", "on-end-effect"],
      requireParent: true,
      repeat: true,
    },
    { fmt: "flags ?str flags", repeat: true },
    { fmt: "lower-bound int bound" },
  ],
};

/**
 * store.txt: the grammar half of parse_store (store.c:132) and its sibling
 * directive handlers. The semantic half - resolving the entrance feature, the
 * owners and the stocking tables - is packages/core/src/store/bind.ts bindStore.
 */
export const storeSpec: FileSpec = {
  name: "store",
  upstream: ["src/store.c"],
  recordStart: "store",
  directives: [
    { fmt: "store str feat" },
    { fmt: "owner uint purse str name", repeat: true },
    { fmt: "slots uint min uint max" },
    { fmt: "turnover uint turnover" },
    { fmt: "normal sym tval sym sval", repeat: true },
    { fmt: "always sym tval ?sym sval", repeat: true },
    { fmt: "buy str base", repeat: true },
    { fmt: "buy-flag sym flag str base", repeat: true },
  ],
};

/**
 * ui_knowledge.txt: the thematic monster-knowledge categories for the '~' ->
 * Monsters browser (upstream ui-knowledge.c init_ui_knowledge_parser). Each
 * 'monster-category' begins a category; the mcat-include-* directives attach
 * to it. The reserved "***Unclassified***" catch-all is appended by the
 * consumer, not the file (finish_ui_knowledge_parser).
 */
export const uiKnowledgeSpec: FileSpec = {
  name: "ui_knowledge",
  upstream: ["src/ui-knowledge.c"],
  recordStart: "monster-category",
  directives: [
    { fmt: "monster-category str name" },
    { fmt: "mcat-include-base str name", repeat: true },
    { fmt: "mcat-include-flag ?str flags", repeat: true },
    { fmt: "mcat-include-other str name", repeat: true },
  ],
};
