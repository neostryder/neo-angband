/**
 * Specs for the gamedata files whose upstream parsers live in src/init.c:
 * constants, world, player_property, names, trap, terrain (feat), body,
 * history, p_race, realm, shape, class, flavor, hints.
 *
 * Format strings are copied verbatim from the parser_reg() calls.
 */

import type { FileSpec } from "../records.js";

function validIntRange(range: string): boolean {
  const match = /^\s*(-?\d+)\s+to\s+(-?\d+)\s*$/.exec(range);
  if (!match) return false;
  const lo = BigInt(match[1]!);
  const hi = BigInt(match[2]!);
  /* grab_int_range rejects INT_MIN and INT_MAX too (datafile.c:328-331). */
  return lo > -2147483648n && lo < 2147483647n && hi > -2147483648n && hi < 2147483647n;
}

export const constantsSpec: FileSpec = {
  name: "constants",
  upstream: ["src/init.c"],
  /* constants.txt fills a single struct angband_constants; the whole file
   * compiles to one record of grouped, labelled values. */
  recordStart: null,
  directives: [
    { fmt: "level-max sym label int value", repeat: true },
    { fmt: "mon-gen sym label int value", repeat: true },
    { fmt: "mon-play sym label int value", repeat: true },
    { fmt: "dun-gen sym label int value", repeat: true },
    { fmt: "world sym label int value", repeat: true },
    { fmt: "carry-cap sym label int value", repeat: true },
    { fmt: "store sym label int value", repeat: true },
    { fmt: "obj-make sym label int value", repeat: true },
    { fmt: "player sym label int value", repeat: true },
    { fmt: "melee-critical sym label int value", repeat: true },
    { fmt: "melee-critical-level int cutoff int mult int add str msg", repeat: true },
    { fmt: "ranged-critical sym label int value", repeat: true },
    { fmt: "ranged-critical-level int cutoff int mult int add str msg", repeat: true },
    { fmt: "o-melee-critical sym label int value", repeat: true },
    { fmt: "o-melee-critical-level uint chance uint dice str msg", repeat: true },
    { fmt: "o-ranged-critical sym label int value", repeat: true },
    { fmt: "o-ranged-critical-level uint chance uint dice str msg", repeat: true },
  ],
};

export const worldSpec: FileSpec = {
  name: "world",
  upstream: ["src/init.c"],
  recordStart: "level",
  directives: [{ fmt: "level int depth sym name sym up sym down" }],
};

export const playerPropertySpec: FileSpec = {
  name: "player_property",
  upstream: ["src/init.c"],
  recordStart: "type",
  directives: [
    { fmt: "type str type" },
    { fmt: "code str code" },
    { fmt: "desc str desc", repeat: true },
    { fmt: "name str desc" },
    { fmt: "value int value" },
    { fmt: "bindui sym ui int aux sym uival" },
  ],
};

export const namesSpec: FileSpec = {
  name: "names",
  upstream: ["src/init.c"],
  recordStart: "section",
  directives: [
    { fmt: "section uint section" },
    { fmt: "word str name", repeat: true },
  ],
};

export const trapSpec: FileSpec = {
  name: "trap",
  upstream: ["src/init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name sym name str desc" },
    { fmt: "graphics char glyph sym color" },
    { fmt: "appear uint rarity uint mindepth uint maxnum" },
    { fmt: "visibility str visibility" },
    { fmt: "flags ?str flags", repeat: true },
    { fmt: "effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "effect-yx int y int x", childOf: ["effect"] },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "effect-xtra sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "effect-yx-xtra int y int x", childOf: ["effect-xtra"] },
    { fmt: "dice-xtra str dice", childOf: ["effect-xtra"] },
    { fmt: "expr-xtra sym name sym base str expr", childOf: ["effect-xtra"], repeat: true },
    { fmt: "save str flags" },
    { fmt: "desc str text", repeat: true },
    { fmt: "msg str text", repeat: true },
    { fmt: "msg-good str text", repeat: true },
    { fmt: "msg-bad str text", repeat: true },
    { fmt: "msg-xtra str text", repeat: true },
  ],
};

export const terrainSpec: FileSpec = {
  name: "terrain",
  upstream: ["src/init.c"],
  recordStart: "code",
  directives: [
    { fmt: "code str code" },
    /* parse_feat_name returns PARSE_ERROR_REPEATED_DIRECTIVE when f->name is set
     * (init.c:2059-2060). */
    { fmt: "name str name", rejectRepeated: () => true },
    { fmt: "graphics char glyph sym color" },
    { fmt: "mimic str feat" },
    { fmt: "priority uint priority" },
    { fmt: "flags ?str flags", repeat: true },
    { fmt: "digging int dig" },
    { fmt: "desc str text", repeat: true },
    { fmt: "walk-msg str text", repeat: true },
    { fmt: "run-msg str text", repeat: true },
    { fmt: "hurt-msg str text", repeat: true },
    { fmt: "die-msg str text", repeat: true },
    { fmt: "confused-msg str text", repeat: true },
    { fmt: "look-prefix str text", repeat: true },
    { fmt: "look-in-preposition str text", repeat: true },
    { fmt: "resist-flag sym flag", repeat: true },
  ],
};

export const bodySpec: FileSpec = {
  name: "body",
  upstream: ["src/init.c"],
  recordStart: "body",
  directives: [
    { fmt: "body str name" },
    { fmt: "slot sym slot sym name", repeat: true },
  ],
};

export const historySpec: FileSpec = {
  name: "history",
  upstream: ["src/init.c"],
  recordStart: "chart",
  directives: [
    { fmt: "chart uint chart int next int roll" },
    { fmt: "phrase str text", repeat: true },
  ],
};

export const pRaceSpec: FileSpec = {
  name: "p_race",
  upstream: ["src/init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "stats int str int int int wis int dex int con" },
    { fmt: "skill-disarm-phys int disarm" },
    { fmt: "skill-disarm-magic int disarm" },
    { fmt: "skill-device int device" },
    { fmt: "skill-save int save" },
    { fmt: "skill-stealth int stealth" },
    { fmt: "skill-search int search" },
    { fmt: "skill-melee int melee" },
    { fmt: "skill-shoot int shoot" },
    { fmt: "skill-throw int throw" },
    { fmt: "skill-dig int dig" },
    { fmt: "hitdie int mhp" },
    { fmt: "exp int exp" },
    { fmt: "infravision int infra" },
    { fmt: "history uint hist" },
    { fmt: "age int base_age int mod_age" },
    { fmt: "height int base_hgt int mod_hgt" },
    { fmt: "weight int base_wgt int mod_wgt" },
    { fmt: "obj-flags ?str flags", repeat: true },
    { fmt: "player-flags ?str flags", repeat: true },
    { fmt: "values str values", repeat: true },
  ],
};

export const realmSpec: FileSpec = {
  name: "realm",
  upstream: ["src/init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "stat sym stat" },
    { fmt: "verb str verb" },
    { fmt: "spell-noun str spell" },
    { fmt: "book-noun str book" },
  ],
};

export const shapeSpec: FileSpec = {
  name: "shape",
  upstream: ["src/init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "combat int to-h int to-d int to-a" },
    { fmt: "skill-disarm-phys int disarm" },
    { fmt: "skill-disarm-magic int disarm" },
    { fmt: "skill-save int save" },
    { fmt: "skill-stealth int stealth" },
    { fmt: "skill-search int search" },
    { fmt: "skill-melee int melee" },
    { fmt: "skill-throw int throw" },
    { fmt: "skill-dig int dig" },
    { fmt: "obj-flags ?str flags", repeat: true },
    { fmt: "player-flags ?str flags", repeat: true },
    { fmt: "values str values", repeat: true },
    { fmt: "effect sym eff ?sym type ?int radius ?int other", repeat: true },
    { fmt: "effect-yx int y int x", childOf: ["effect"] },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "effect-msg str text", childOf: ["effect"], repeat: true },
    { fmt: "blow str blow", repeat: true },
  ],
};

export const classSpec: FileSpec = {
  name: "class",
  upstream: ["src/init.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "stats int str int int int wis int dex int con" },
    { fmt: "skill-disarm-phys int base int incr" },
    { fmt: "skill-disarm-magic int base int incr" },
    { fmt: "skill-device int base int incr" },
    { fmt: "skill-save int base int incr" },
    { fmt: "skill-stealth int base int incr" },
    { fmt: "skill-search int base int incr" },
    { fmt: "skill-melee int base int incr" },
    { fmt: "skill-shoot int base int incr" },
    { fmt: "skill-throw int base int incr" },
    { fmt: "skill-dig int base int incr" },
    { fmt: "hitdie int mhp" },
    { fmt: "exp int exp" },
    { fmt: "max-attacks int max-attacks" },
    { fmt: "min-weight int min-weight" },
    { fmt: "strength-multiplier int att-multiply" },
    { fmt: "title str title", repeat: true },
    { fmt: "equip sym tval sym sval uint min uint max sym eopts", repeat: true },
    { fmt: "obj-flags ?str flags", repeat: true },
    { fmt: "player-flags ?str flags", repeat: true },
    /* parse_class_magic rejects once c->magic.books is non-NULL
     * (init.c:3714-3716). */
    { fmt: "magic uint first uint weight uint books", rejectRepeated: (prior) =>
      (prior as { books?: number }).books !== 0 },
    {
      fmt: "book sym tval sym quality sym name uint spells str realm",
      repeat: true,
      /* parse_class_book checks the allocated magic-book capacity after tval
       * resolution (init.c:3735-3746).  The registry-dependent tval half is
       * intentionally deferred; this structural half is available here. */
      validate: ({ record }) => {
        const magic = record.magic as { books?: number } | undefined;
        const books = (record.book as unknown[] | undefined)?.length ?? 0;
        return magic === undefined || books >= (magic.books ?? 0)
          ? "TOO_MANY_ENTRIES"
          : undefined;
      },
    },
    { fmt: "book-graphics char glyph sym color", childOf: ["book"], requireParent: true },
    {
      fmt: "book-properties int cost int common str minmax",
      childOf: ["book"],
      requireParent: true,
      /* grab_int_range(..., "to") failures are INVALID_ALLOCATION
       * (init.c:3823-3826). */
      validate: ({ values }) =>
        validIntRange(String(values.minmax))
          ? undefined
          : "INVALID_ALLOCATION",
    },
    {
      fmt: "spell sym name int level int mana int fail int exp",
      childOf: ["book"],
      orphanError: "TOO_MANY_ENTRIES",
      repeat: true,
      /* parse_class_spell uses the current book's declared spell capacity
       * (init.c:3842-3854). */
      validate: ({ target }) => {
        const spells = (target.spell as unknown[] | undefined)?.length ?? 0;
        return spells >= Number(target.spells) ? "TOO_MANY_ENTRIES" : undefined;
      },
    },
    /* parse_class_effect requires a preceding spell (and therefore a book and
     * magic), while its effect-detail successors intentionally tolerate a
     * missing effect (init.c:3877-3905, 3925-3939). */
    {
      fmt: "effect sym eff ?sym type ?int radius ?int other",
      childOf: ["spell"],
      requireParent: true,
      repeat: true,
    },
    { fmt: "effect-yx int y int x", childOf: ["effect"] },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
    { fmt: "effect-msg str text", childOf: ["effect"], repeat: true },
    { fmt: "desc str desc", childOf: ["spell"], requireParent: true, repeat: true },
  ],
};

export const flavorSpec: FileSpec = {
  name: "flavor",
  upstream: ["src/init.c"],
  recordStart: "kind",
  directives: [
    { fmt: "kind sym tval char glyph" },
    /*
     * `flavor:` and `fixed:` both build ONE list upstream (C prepends both
     * onto the same flavor_type linked list, parse_flavor_flavor,
     * init.c). mergeInto keeps that: instead of splitting them into two
     * per-directive arrays, the pack emits one "entries" array per record,
     * each entry tagged kind: "flavor" | "fixed", in the file's own line
     * order - so a mod's flavor.txt that interleaves the two directives
     * (issue #2) is reproducible from the compiled shape, not just the
     * shipped file's own fixed-then-random layout.
     */
    { fmt: "flavor uint index sym attr ?str desc", mergeInto: "entries" },
    { fmt: "fixed uint index sym sval sym attr ?str desc", mergeInto: "entries" },
  ],
};

export const hintsSpec: FileSpec = {
  name: "hints",
  upstream: ["src/init.c"],
  recordStart: "H",
  directives: [{ fmt: "H str text" }],
};
