/**
 * The pref-file subsystem, ported from reference/src/ui-prefs.c (Angband
 * 4.2.6): the writer half (`prefs_save`, `remove_old_dump`, `pref_header` /
 * `pref_footer` and the eight `dump_*` functions) and the reader half
 * (`init_parse_prefs`'s line grammar, `process_pref_file_named`'s loop and
 * `print_error`).
 *
 * ONE grammar, TWO consumers. Upstream has a single set of x_attr/x_char arrays
 * and a single parser that writes into them; whether a value means "colour +
 * glyph" or "atlas row + column" depends only on whether graphics are on. The
 * port splits the STORAGE (GlyphTable for ASCII, TileMap for tiles - see
 * glyph-table.ts for why) but must not split the GRAMMAR, so this module owns
 * the decoders and drives an injected `PrefSink`; tile-prefs.ts is one sink over
 * it and glyphTableSink() is the other. That keeps the `object:tval:*` wildcard,
 * the `feat`/`trap` `*` lighting field, the `GF` `|` type list and the base-0
 * integer rules in exactly one place.
 *
 * Values stay NUMERIC through the sink, as upstream's wchar_t does: the pref
 * grammar writes the glyph as an integer (`0x%02X` for monsters, `%d` for
 * feat/object/flavor) and a graphics pack's "char" is an atlas column, not text.
 * The GlyphTable sink is what turns a code point into a string.
 *
 * Determinism: no RNG. Parsing and dumping are pure functions of their inputs.
 */

import { colorCharToAttr, colorChannel, colorTextToAttr, COLOR_TABLE, BASIC_COLORS, MAX_COLORS } from "../color.js";
import { projNameToIdx } from "../effects/effect.js";
import { PARSE_ERROR, PARSER_ERROR_ENTRIES } from "../generated/index.js";
import { tvalFindIdx, tvalFindName } from "../obj/bind.js";
import type { ObjRegistry } from "../obj/bind.js";
import { messageLookupByName } from "../sound/engine.js";
import { lookupTrap } from "../world/trap.js";
import type { TrapKind } from "../world/trap.js";
import type { FeatureRegistry } from "../world/feature.js";
import { GlyphTable } from "./glyph-table.js";
import { prefExprBypasses } from "./pref-expr.js";
import type { PrefExprVars } from "./pref-expr.js";
import { BOLT, LIGHTING, TileMap } from "./tile-prefs.js";
import type { TileAtlas, TilePrefsDeps } from "./tile-prefs.js";

/* ------------------------------------------------------------------------
 * Shared grammar
 * ------------------------------------------------------------------------ */

/** The registries a pref line resolves names/tvals against. */
export interface PrefDeps {
  features: FeatureRegistry;
  objects: ObjRegistry;
  /** MonsterRegistry: lookup_monster plus lookup_monster_base. */
  monsters: {
    raceByName(name: string): { ridx: number } | null;
    races?: readonly { ridx: number; base: { name: string } }[];
  };
  /** Bound trap kinds (t_idx order), or null when the pack has none. */
  traps: readonly TrapKind[] | null;
}

/**
 * One `parser_error`, as print_error formats it (ui-prefs.c L1195-1202).
 * `msg` is the offending token (parser_state.msg) and `error` the enum_parser
 * error CODE, resolved to parser_error_str[]'s text by prefErrorMessage.
 */
export interface PrefError {
  line: number;
  col: number;
  msg: string;
  error: number;
}

/**
 * parser_error_str[] (parser.c L36-100), generated straight from
 * list-parser-errors.h - the codegen'd table, NOT a hand-typed copy. Upstream
 * spells several of these differently from the handler names ("invalid colour",
 * "unrecognized tval"), which is exactly the sort of thing a transcription gets
 * wrong.
 */
export function parserErrorText(code: number): string {
  return PARSER_ERROR_ENTRIES[code]?.description ?? "generic error";
}

/**
 * Everything a parsed pref line can change. The six glyph directives are
 * required (they are the reason both consumers exist); the rest are optional so
 * a graphics-only sink can ignore them exactly as a graf-*.prf never uses them.
 */
export interface PrefSink {
  setFeat(lighting: number, fidx: number, attr: number, char: number): void;
  setTrap(lighting: number, tidx: number, attr: number, char: number): void;
  setMonster(ridx: number, attr: number, char: number): void;
  setKind(kidx: number, attr: number, char: number): void;
  setFlavor(fidx: number, attr: number, char: number): void;
  setProjection(proj: number, motion: number, attr: number, char: number): void;

  /** parse_prefs_inscribe -> add_autoinscription(kidx, text, true). */
  addAutoinscription?(kidx: number, text: string): void;
  /** parse_prefs_keymap_action: stash the action text for the next input line. */
  keymapAct?(text: string): void;
  /** parse_prefs_keymap_input -> keymap_add(mode, key, buffer, user). */
  keymapInput?(mode: number, key: string, act: string): void;
  /** parse_prefs_message -> message_color_define(msg_index, attr). */
  messageColor?(msgIndex: number, attr: number): void;
  /** parse_prefs_color -> angband_color_table[idx] = {k,r,g,b}. */
  colorTable?(idx: number, k: number, r: number, g: number, b: number): void;
  /** parse_prefs_window: the subwindow flag set finish_parse_prefs applies. */
  windowFlag?(window: number, flag: number, value: number): void;
  /** parse_prefs_entry_renderer -> ui_entry_renderer_customize. */
  entryRenderer?(
    name: string,
    colors: string | null,
    labelColors: string | null,
    symbols: string | null,
  ): void;
  /** `%` include (parse_prefs_load): the referenced file's text, or null. */
  loadFile?(name: string): string | null;
}

/**
 * parse_int / parse_uint (parser.c L313-320: `strtol(tok, &z, 0)`), including
 * strtol's LENIENCY, which is load-bearing: it skips leading whitespace, takes
 * an optional sign, reads the longest valid base-0 digit run (0x/0X hex, a
 * leading 0 as octal, otherwise decimal) and simply STOPS at the first
 * character it cannot use. The parser reports NOT_NUMBER only when nothing at
 * all was consumed (`z == tok`) - trailing text is discarded in silence.
 *
 * Requiring a clean token instead - which this did until 2026-07-31 - throws
 * away every pref line with a trailing comment. Measured across the five
 * bundled packs' 16 pref files: 132 such lines, ALL of them in
 * shockbolt/xtra-shb.prf, and all 132 of them are the `monster:<player>` lines
 * that end `0x83:0x87 #  `. So Shockbolt's special player pictures never reached
 * the tile map at all, whatever the character was.
 *
 * "0x" with no hex digits reads as the plain 0 that precedes it, and "08" as 0,
 * both exactly as strtol does.
 */
export function parsePrefNum(tok: string): number | null {
  const m = /^\s*([-+]?)(?:0[xX]([0-9a-fA-F]+)|0([0-7]*)|([0-9]+))/.exec(tok);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const mag =
    m[2] !== undefined
      ? parseInt(m[2], 16)
      : m[3] !== undefined
        ? m[3] === ""
          ? 0
          : parseInt(m[3], 8)
        : parseInt(m[4]!, 10);
  return sign * mag;
}

/**
 * The lighting keyword -> LIGHTING index, LIGHTING.MAX for `*` ("all
 * variants"), or -1 for an invalid keyword (ui-prefs.c L824-836).
 */
export function prefLightingIdx(kw: string): number {
  switch (kw) {
    case "torch":
      return LIGHTING.TORCH;
    case "los":
      return LIGHTING.LOS;
    case "lit":
      return LIGHTING.LIT;
    case "dark":
      return LIGHTING.DARK;
    case "*":
      return LIGHTING.MAX;
    default:
      return -1;
  }
}

/** proj_name_to_idx("MAX") is PROJ_MAX, the projection table length. */
const PROJ_MAX = projNameToIdx("MAX");

/* ------------------------------------------------------------------------
 * The line handlers
 * ------------------------------------------------------------------------ */

/** A handler returns null on success, or an enum parser_error code. */
type Handler = (fields: string[], sink: PrefSink, deps: PrefDeps) => number | null;

/** Read the trailing `int attr int char` pair every glyph directive ends with. */
function attrChar(
  fields: string[],
  at: number,
): { attr: number; char: number } | number {
  const a = parsePrefNum(fields[at] ?? "");
  const c = parsePrefNum(fields[at + 1] ?? "");
  if (fields[at] === undefined || fields[at + 1] === undefined) {
    return PARSE_ERROR.MISSING_FIELD;
  }
  if (a === null || c === null) return PARSE_ERROR.NOT_NUMBER;
  return { attr: a, char: c };
}

/** parse_prefs_feat (ui-prefs.c L798-849). */
const parseFeat: Handler = (fields, sink, deps) => {
  const [sym, lighting] = fields;
  if (sym === undefined || lighting === undefined) return PARSE_ERROR.MISSING_FIELD;
  const ac = attrChar(fields, 2);
  if (typeof ac === "number") return ac;
  /* lookup_feat_code, falling back to the printable name for pref files
   * written before the post-4.2.4 terrain codes (L809-819). */
  const feature = deps.features.lookupByCode(sym) ?? deps.features.lookupByName(sym);
  if (!feature) return PARSE_ERROR.OUT_OF_BOUNDS;
  const light = prefLightingIdx(lighting);
  if (light < 0) return PARSE_ERROR.INVALID_LIGHTING;
  sink.setFeat(light, feature.fidx, ac.attr, ac.char);
  return null;
};

/** parse_prefs_trap (ui-prefs.c L745-796). */
const parseTrap: Handler = (fields, sink, deps) => {
  const [idxSym, lighting] = fields;
  if (idxSym === undefined || lighting === undefined) return PARSE_ERROR.MISSING_FIELD;
  const ac = attrChar(fields, 2);
  if (typeof ac === "number") return ac;
  /* Upstream resolves the trap BEFORE the lighting keyword (L757-767). */
  let tidx = -1;
  if (idxSym !== "*") {
    const trap = deps.traps ? lookupTrap(deps.traps, idxSym) : null;
    if (!trap) return PARSE_ERROR.UNRECOGNISED_TRAP;
    tidx = trap.tidx;
  }
  const light = prefLightingIdx(lighting);
  if (light < 0) return PARSE_ERROR.INVALID_LIGHTING;
  if (tidx < 0) {
    /* trap:*: every trap kind (L784-789). */
    for (let i = 0; i < (deps.traps?.length ?? 0); i++) {
      sink.setTrap(light, i, ac.attr, ac.char);
    }
  } else {
    sink.setTrap(light, tidx, ac.attr, ac.char);
  }
  return null;
};

/** parse_prefs_monster (ui-prefs.c L682-700). */
const parseMonster: Handler = (fields, sink, deps) => {
  const name = fields[0];
  if (name === undefined) return PARSE_ERROR.MISSING_FIELD;
  const ac = attrChar(fields, 1);
  if (typeof ac === "number") return ac;
  const race = deps.monsters.raceByName(name);
  if (!race) return PARSE_ERROR.NO_KIND_FOUND;
  sink.setMonster(race.ridx, ac.attr, ac.char);
  return null;
};

/**
 * parse_prefs_monster_base (ui-prefs.c L702-731): re-glyph every race sharing
 * a monster base. Never used by the bundled packs, but a user pref file can.
 */
const parseMonsterBase: Handler = (fields, sink, deps) => {
  const name = fields[0];
  if (name === undefined) return PARSE_ERROR.MISSING_FIELD;
  const ac = attrChar(fields, 1);
  if (typeof ac === "number") return ac;
  const races = deps.monsters.races;
  if (!races) return PARSE_ERROR.NO_KIND_FOUND;
  let found = false;
  for (const race of races) {
    if (race.base.name !== name) continue;
    found = true;
    sink.setMonster(race.ridx, ac.attr, ac.char);
  }
  /* lookup_monster_base misses -> NO_KIND_FOUND (L713-714). A base with no
   * races cannot occur in bound gamedata, so "no race matched" IS the miss. */
  return found ? null : PARSE_ERROR.NO_KIND_FOUND;
};

/** parse_prefs_object (ui-prefs.c L602-680), including both `*` wildcards. */
const parseObject: Handler = (fields, sink, deps) => {
  const [tval, sval] = fields;
  if (tval === undefined || sval === undefined) return PARSE_ERROR.MISSING_FIELD;
  const ac = attrChar(fields, 2);
  if (typeof ac === "number") return ac;

  if (tval === "*") {
    /* object:*:* - every kind AND every flavor (L614-634). */
    if (sval !== "*") return PARSE_ERROR.UNRECOGNISED_SVAL;
    for (const kind of deps.objects.kinds) sink.setKind(kind.kidx, ac.attr, ac.char);
    for (const flavor of deps.objects.flavors) {
      sink.setFlavor(flavor.fidx, ac.attr, ac.char);
    }
    return null;
  }

  const tvi = tvalFindIdx(tval);
  if (tvi < 0) return PARSE_ERROR.UNRECOGNISED_TVAL;

  if (sval === "*") {
    /* object:tval:* - every kind and flavor of that tval (L640-661). */
    for (const kind of deps.objects.kinds) {
      if (kind.tval === tvi) sink.setKind(kind.kidx, ac.attr, ac.char);
    }
    for (const flavor of deps.objects.flavors) {
      if (flavor.tval === tvi) sink.setFlavor(flavor.fidx, ac.attr, ac.char);
    }
    return null;
  }

  /* WART KEPT: an unknown sval is NOT an error here, deliberately - "no error
   * at incorrect sval to stop failure due to outdated pref files" (L663-665),
   * unlike parse_prefs_inscribe, which does report it. */
  const svi = deps.objects.lookupSval(tvi, sval);
  if (svi < 0) return null;
  const kind = deps.objects.lookupKind(tvi, svi);
  if (!kind) return null;
  sink.setKind(kind.kidx, ac.attr, ac.char);
  return null;
};

/** parse_prefs_flavor (ui-prefs.c L908-928): by flavour index. */
const parseFlavor: Handler = (fields, sink, deps) => {
  const idx = parsePrefNum(fields[0] ?? "");
  if (fields[0] === undefined) return PARSE_ERROR.MISSING_FIELD;
  if (idx === null) return PARSE_ERROR.NOT_NUMBER;
  const ac = attrChar(fields, 1);
  if (typeof ac === "number") return ac;
  /* The C walks the flavor list and stores only when the fidx exists; an
   * unknown fidx is silently dropped, not reported (L921-926). */
  if (!deps.objects.flavors.some((f) => f.fidx === idx)) return null;
  sink.setFlavor(idx, ac.attr, ac.char);
  return null;
};

/** parse_prefs_gf (ui-prefs.c L851-906). */
const parseGf: Handler = (fields, sink) => {
  const [type, direction] = fields;
  if (type === undefined || direction === undefined) return PARSE_ERROR.MISSING_FIELD;
  const ac = attrChar(fields, 2);
  if (typeof ac === "number") return ac;

  /* A `|`- (or space-) separated list of PROJ_ names, or `*` for all. */
  const projIdxs: number[] = [];
  let all = false;
  for (const t of type.split(/[| ]+/)) {
    if (t.length === 0) continue;
    if (t === "*") {
      all = true;
      break;
    }
    const idx = projNameToIdx(t);
    if (idx === -1) return PARSE_ERROR.INVALID_VALUE;
    projIdxs.push(idx);
  }

  let motion: number;
  switch (direction) {
    case "static":
      motion = BOLT.NO_MOTION;
      break;
    case "0":
      motion = BOLT.D0;
      break;
    case "45":
      motion = BOLT.D45;
      break;
    case "90":
      motion = BOLT.D90;
      break;
    case "135":
      motion = BOLT.D135;
      break;
    default:
      return PARSE_ERROR.INVALID_VALUE;
  }

  if (all) {
    for (let i = 0; i < PROJ_MAX; i++) sink.setProjection(i, motion, ac.attr, ac.char);
  } else {
    for (const i of projIdxs) sink.setProjection(i, motion, ac.attr, ac.char);
  }
  return null;
};

/** parse_prefs_inscribe (ui-prefs.c L930-954). */
const parseInscribe: Handler = (fields, sink, deps) => {
  const [tval, sval] = fields;
  if (tval === undefined || sval === undefined) return PARSE_ERROR.MISSING_FIELD;
  /* `str text` swallows the rest of the line, colons included. */
  const text = fields.slice(2).join(":");
  const tvi = tvalFindIdx(tval);
  if (tvi < 0) return PARSE_ERROR.UNRECOGNISED_TVAL;
  const svi = deps.objects.lookupSval(tvi, sval);
  if (svi < 0) return PARSE_ERROR.UNRECOGNISED_SVAL;
  const kind = deps.objects.lookupKind(tvi, svi);
  if (!kind) return PARSE_ERROR.UNRECOGNISED_SVAL;
  sink.addAutoinscription?.(kind.kidx, text);
  return null;
};

/** parse_prefs_message (ui-prefs.c L994-1023). */
const parseMessage: Handler = (fields, sink) => {
  const [type, attr] = fields;
  if (type === undefined || attr === undefined) return PARSE_ERROR.MISSING_FIELD;
  const msgIndex = messageLookupByName(type);
  if (msgIndex < 0) return PARSE_ERROR.INVALID_MESSAGE;
  /* A multi-character token is a colour NAME, one character a colour CHAR. */
  const a = attr.length > 1 ? colorTextToAttr(attr) : colorCharToAttr(attr[0] ?? "");
  if (a < 0) return PARSE_ERROR.INVALID_COLOR;
  sink.messageColor?.(msgIndex, a);
  return null;
};

/** parse_prefs_color (ui-prefs.c L1025-1052). */
const parseColor: Handler = (fields, sink) => {
  const idx = parsePrefNum(fields[0] ?? "");
  if (fields[0] === undefined) return PARSE_ERROR.MISSING_FIELD;
  if (idx === null) return PARSE_ERROR.NOT_NUMBER;
  if (idx >= MAX_COLORS) {
    /* Indices that were in bounds for 4.2.4's 256-entry table are silently
     * ignored for backwards compatibility; anything larger is reported. */
    return idx < 256 ? null : PARSE_ERROR.OUT_OF_BOUNDS;
  }
  const nums: number[] = [];
  for (let i = 1; i <= 4; i++) {
    if (fields[i] === undefined) return PARSE_ERROR.MISSING_FIELD;
    const n = parsePrefNum(fields[i] ?? "");
    if (n === null) return PARSE_ERROR.NOT_NUMBER;
    nums.push(n);
  }
  sink.colorTable?.(idx, nums[0]!, nums[1]!, nums[2]!, nums[3]!);
  return null;
};

/**
 * parse_prefs_window (ui-prefs.c L1054-1083). The port has ONE terminal, so the
 * bound is ANGBAND_TERM_MAX purely to keep the grammar's error behaviour; the
 * sink is what decides whether a subwindow flag means anything.
 */
const ANGBAND_TERM_MAX = 8;
/** window_flag_desc[] length (ui-prefs.h / ui-display.c window_flag_desc). */
const WINDOW_FLAG_MAX = 32;

const parseWindow: Handler = (fields, sink) => {
  const win = parsePrefNum(fields[0] ?? "");
  const flag = parsePrefNum(fields[1] ?? "");
  const value = parsePrefNum(fields[2] ?? "");
  if (fields[0] === undefined || fields[1] === undefined || fields[2] === undefined) {
    return PARSE_ERROR.MISSING_FIELD;
  }
  if (win === null || flag === null || value === null) return PARSE_ERROR.NOT_NUMBER;
  if (win <= 0 || win >= ANGBAND_TERM_MAX) return PARSE_ERROR.OUT_OF_BOUNDS;
  if (flag >= WINDOW_FLAG_MAX) return PARSE_ERROR.OUT_OF_BOUNDS;
  sink.windowFlag?.(win, flag, value);
  return null;
};

/** parse_prefs_entry_renderer (ui-prefs.c L1085-1122). */
const parseEntryRenderer: Handler = (fields, sink) => {
  const name = fields[0];
  if (name === undefined) return PARSE_ERROR.MISSING_FIELD;
  const star = (v: string | undefined): string | null =>
    v === undefined || v === "*" ? null : v;
  sink.entryRenderer?.(name, star(fields[1]), star(fields[2]), fields[3] ?? null);
  return null;
};

/* ------------------------------------------------------------------------
 * process_pref_file
 * ------------------------------------------------------------------------ */

const HANDLERS: Readonly<Record<string, Handler>> = {
  object: parseObject,
  monster: parseMonster,
  "monster-base": parseMonsterBase,
  feat: parseFeat,
  trap: parseTrap,
  GF: parseGf,
  flavor: parseFlavor,
  inscribe: parseInscribe,
  message: parseMessage,
  color: parseColor,
  window: parseWindow,
  "entry-renderer": parseEntryRenderer,
};

/** Options process_pref_file_named's caller controls. */
export interface ProcessPrefOptions {
  /**
   * The $VAR values `?` expression lines test. Upstream has exactly three -
   * SYS, RACE and CLASS (ui-prefs.c L553-560) - and the graphics packs' player
   * pictures are selected entirely by RACE and CLASS, so a caller that omits
   * them gets whatever the pack's unconditional lines set.
   */
  vars?: PrefExprVars;
  /**
   * get_parser_error_limit(): stop after this many bad lines (0 = no limit).
   * Upstream's default is 0 (ui-init.c / z-util), so every error is reported.
   */
  errorLimit?: number;
  /** Recursion guard for `%` includes; upstream relies on the filesystem. */
  depth?: number;
}

/**
 * process_pref_file_named's parse loop (ui-prefs.c L1212-1262) over already-read
 * text. Returns every parse error in order, so the caller can print each one
 * through `print_error` and decide the boolean result (upstream: false if ANY
 * line failed).
 *
 * A `#` line is a comment, a blank line is skipped, `%` includes another file
 * through sink.loadFile, and `?` sets the bypass flag that makes every
 * following handler a no-op until the next `?`.
 */
export function processPrefText(
  text: string,
  deps: PrefDeps,
  sink: PrefSink,
  opts: ProcessPrefOptions = {},
): PrefError[] {
  const errors: PrefError[] = [];
  const limit = opts.errorLimit ?? 0;
  const depth = opts.depth ?? 0;
  let bypass = false;
  let keymapAct = "";
  let lineNo = 0;

  for (const raw of text.split("\n")) {
    lineNo++;
    const line = raw.replace(/\r$/, "");
    if (line.length === 0 || line.startsWith("#")) continue;
    const parts = line.split(":");
    const dir = parts[0] ?? "";
    const fields = parts.slice(1);
    if (dir.length === 0) continue;

    /* `?` is evaluated even inside a bypassed block - that is how a block ends
     * (parse_prefs_expr has no bypass guard, ui-prefs.c L577). */
    if (dir === "?") {
      bypass = prefExprBypasses(fields.join(":"), opts.vars ?? {});
      continue;
    }
    if (bypass) continue;

    if (dir === "%") {
      if (depth < 8) {
        const nested = sink.loadFile?.(fields.join(":"));
        if (nested !== null && nested !== undefined) {
          errors.push(
            ...processPrefText(nested, deps, sink, { ...opts, depth: depth + 1 }),
          );
        }
      }
      continue;
    }
    /* keymap-act stores into the parser's buffer; keymap-input consumes it. */
    if (dir === "keymap-act") {
      keymapAct = fields.join(":");
      sink.keymapAct?.(keymapAct);
      continue;
    }
    if (dir === "keymap-input") {
      const mode = parsePrefNum(fields[0] ?? "");
      if (fields[0] === undefined || fields[1] === undefined) {
        errors.push(err(lineNo, dir, PARSE_ERROR.MISSING_FIELD));
      } else if (mode === null) {
        errors.push(err(lineNo, dir, PARSE_ERROR.NOT_NUMBER));
      } else if (mode < 0 || mode >= 2) {
        /* KEYMAP_MODE_MAX is 2 (ui-keymap.h). */
        errors.push(err(lineNo, dir, PARSE_ERROR.OUT_OF_BOUNDS));
      } else {
        sink.keymapInput?.(mode, fields.slice(1).join(":"), keymapAct);
      }
      if (limit && errors.length >= limit) break;
      continue;
    }

    const handler = HANDLERS[dir];
    /* An unknown directive is upstream's PARSE_ERROR_UNDEFINED_DIRECTIVE; the
     * sound parser registers its own, so an unhandled one is only an error when
     * it is not a sound line. Keep it quiet, as the bundled prf files carry
     * `sound:` lines this port has no mixer for. */
    if (!handler) continue;
    const e = handler(fields, sink, deps);
    if (e !== null) {
      errors.push(err(lineNo, dir, e));
      if (limit && errors.length >= limit) break;
    }
  }
  return errors;
}

/**
 * parser_state's line/col/msg: upstream reports the column of the failing
 * token, which its tokeniser tracks. This port reports the directive as `msg`
 * and column 1, since it splits the whole line at once - the line number and
 * the error text, which are what identify the bad line, are exact.
 */
function err(line: number, directive: string, error: number): PrefError {
  return { line, col: 1, msg: directive, error };
}

/** print_error's exact text (ui-prefs.c L1195-1202). */
export function prefErrorMessage(name: string, e: PrefError): string {
  return `Parse error in ${name} line ${e.line} column ${e.col}: ${e.msg}: ${parserErrorText(
    e.error,
  )}`;
}

/* ------------------------------------------------------------------------
 * The GlyphTable sink
 * ------------------------------------------------------------------------ */

/**
 * A PrefSink that writes the six glyph directives into a GlyphTable, turning
 * each numeric char field into the string the table stores. The non-glyph
 * directives are the caller's to supply (spread `...extra` over the result).
 */
export function glyphTableSink(table: GlyphTable, extra: Partial<PrefSink> = {}): PrefSink {
  const ch = (code: number): string => {
    /* A pref file may write 0 for "leave blank"; String.fromCodePoint(0) is a
     * NUL that no terminal draws, so keep it as a space, which is what a
     * zeroed wchar_t renders as in the C's terminals. */
    if (code <= 0) return " ";
    try {
      return String.fromCodePoint(code);
    } catch {
      return " ";
    }
  };
  return {
    setFeat: (lighting, fidx, attr, char) =>
      table.setFeatGlyph(lighting, fidx, { attr, char: ch(char) }),
    setTrap: (lighting, tidx, attr, char) =>
      table.setTrapGlyph(lighting, tidx, { attr, char: ch(char) }),
    setMonster: (ridx, attr, char) =>
      table.setMonsterGlyph(ridx, { attr, char: ch(char) }),
    setKind: (kidx, attr, char) => table.setKindGlyph(kidx, { attr, char: ch(char) }),
    setFlavor: (fidx, attr, char) =>
      table.setFlavorGlyph(fidx, { attr, char: ch(char) }),
    /* The port keeps projection graphics in the TileMap only (there is no ASCII
     * projection glyph table - the bolt animation draws its own character), so
     * a GF line has nothing to write here. */
    setProjection: () => {},
    ...extra,
  };
}

/* ------------------------------------------------------------------------
 * The writer half
 * ------------------------------------------------------------------------ */

/** dump_separator (ui-prefs.c L66). */
export const DUMP_SEPARATOR = "#=#=#=#=#=#=#=#=#=#=#=#=#=#=#=#=#=#=#=#";

/** pref_header (ui-prefs.c L153-163). */
export function prefHeader(mark: string): string {
  return (
    `${DUMP_SEPARATOR} begin ${mark}\n` +
    "# *Warning!*  The lines below are an automatic dump.\n" +
    "# Don't edit them; changes will be deleted and replaced automatically.\n"
  );
}

/** pref_footer (ui-prefs.c L165-176). */
export function prefFooter(mark: string): string {
  return (
    "# *Warning!*  The lines above are an automatic dump.\n" +
    "# Don't edit them; changes will be deleted and replaced automatically.\n" +
    `${DUMP_SEPARATOR} end ${mark}\n`
  );
}

/**
 * remove_old_dump (ui-prefs.c L75-146) over text rather than two file handles:
 * strip the lines between `<sep> begin <mark>` and `<sep> end <mark>`, the end
 * marker included (`skip_one`). Returns null when nothing was between marks, so
 * the caller can skip the file rotation exactly as the C destroys its temp file
 * when `changed` stayed false.
 */
export function removeOldDump(text: string, mark: string): string | null {
  const startLine = `${DUMP_SEPARATOR} begin ${mark}`;
  const endLine = `${DUMP_SEPARATOR} end ${mark}`;
  let betweenMarks = false;
  let changed = false;
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    let skipOne = false;
    if (line === startLine) {
      betweenMarks = true;
    } else if (line === endLine) {
      betweenMarks = false;
      skipOne = true;
      changed = true;
    }
    if (!betweenMarks && !skipOne) out.push(line);
  }
  if (!changed) return null;
  /* file_getl drops the final newline, and the C writes each kept line back
   * with file_putf("%s\n"), so a trailing empty element must not become a
   * doubled blank line. */
  if (out[out.length - 1] === "") out.pop();
  return out.length > 0 ? `${out.join("\n")}\n` : "";
}

/**
 * prefs_save (ui-prefs.c L391-421) against an injected file layer: strip any
 * previous dump with the same title, then APPEND header + body + footer.
 * Returns false when the file cannot be opened for append, exactly as the C
 * does - which is what makes the caller print "Failed to save %s.".
 */
export interface PrefsFileIO {
  /** file_exists + a full read, or null when there is no such file. */
  read(path: string): string | null;
  /** file_open(MODE_WRITE) + write + close; false on any failure. */
  write(path: string, text: string): boolean;
}

export function prefsSave(
  io: PrefsFileIO,
  path: string,
  dump: () => string,
  title: string,
): boolean {
  const existing = io.read(path);
  let base = existing ?? "";
  if (existing !== null) {
    const stripped = removeOldDump(existing, title);
    if (stripped !== null) base = stripped;
  }
  const body = `${prefHeader(title)}\n${dump()}\n${prefFooter(title)}`;
  return io.write(path, base + body);
}

/* ----- the dump_* writers ----- */

/** The gamedata + live table a dump writer walks. */
export interface DumpDeps {
  table: GlyphTable;
  objects: ObjRegistry;
  features: FeatureRegistry;
  monsters: { races: readonly { ridx: number; name: string }[] };
  /** get_autoinscription(kind, true): the AWARE note, or null. */
  autoinscription?: (kidx: number) => string | null;
  /** ui_entry_renderer_* enumeration, in index order. */
  entryRenderers?: readonly {
    name: string;
    colors: string;
    labelColors: string;
    symbols: string;
  }[];
}

/** The code point the pref grammar writes for a stored glyph string. */
function charCode(s: string): number {
  return s.length > 0 ? (s.codePointAt(0) ?? 0) : 0;
}

/** dump_monsters (ui-prefs.c L178-192): `monster:%s:0x%02X:0x%02X`. */
export function dumpMonsters(deps: DumpDeps): string {
  let out = "";
  for (const race of deps.monsters.races) {
    if (!race.name) continue;
    const g = deps.table.monsterGlyph(race.ridx);
    const attr = g?.attr ?? 0;
    const chr = charCode(g?.char ?? "");
    out += `monster:${race.name}:${hex2(attr)}:${hex2(chr)}\n`;
  }
  return out;
}

function hex2(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * dump_objects (ui-prefs.c L197-215): a `# Objects` header then one line per
 * named kind with a real tval, naming the kind by object_short_name.
 */
export function dumpObjects(deps: DumpDeps): string {
  let out = "# Objects\n";
  for (const kind of deps.objects.kinds) {
    if (!kind.name || !kind.tval) continue;
    const g = deps.table.kindGlyph(kind.kidx);
    out += `object:${tvalFindName(kind.tval)}:${objectShortName(kind.name)}:${
      g?.attr ?? 0
    }:${charCode(g?.char ?? "")}\n`;
  }
  return out;
}

/**
 * object_short_name (obj-util.c L233-249): strip a leading `& ` article and
 * every `~` pluralisation marker - the form a pref file's `object:` and
 * `inscribe:` lines name a kind by, and the form parse_prefs_object's
 * lookup_sval matches against.
 */
export function objectShortName(name: string): string {
  const body = name.startsWith("& ") ? name.slice(2) : name;
  return body.replace(/~/g, "");
}

/** dump_autoinscriptions (ui-prefs.c L218-236): only AWARE notes are dumped. */
export function dumpAutoinscriptions(deps: DumpDeps): string {
  let out = "";
  for (const kind of deps.objects.kinds) {
    if (!kind.name || !kind.tval) continue;
    const note = deps.autoinscription?.(kind.kidx) ?? null;
    if (note === null) continue;
    out += `inscribe:${tvalFindName(kind.tval)}:${objectShortName(kind.name)}:${note}\n`;
  }
  return out;
}

/**
 * dump_features (ui-prefs.c L239-276): a `# Terrain:` comment then one `feat:`
 * line per lighting variant, skipping nameless and MIMIC features. The name in
 * the line is the terrain CODE (get_feat_code_name), not the printable name.
 *
 * The C's keyword chain reads oddly - `if (TORCH) light="torch"; if (LOS)
 * light="los"; else if (LIT) ... else if (DARK) ...` - the second `if` is not
 * an `else if`. Re-derived: it is nonetheless correct, because none of LOS /
 * LIT / DARK can equal TORCH, so the else-chain never runs on the pass that
 * set "torch". Transcribed in the same shape rather than tidied, so the next
 * reader can check the same thing against the same lines.
 */
export function dumpFeatures(deps: DumpDeps): string {
  const keyword = (j: number): string => {
    let light = "";
    if (j === LIGHTING.TORCH) light = "torch";
    if (j === LIGHTING.LOS) light = "los";
    else if (j === LIGHTING.LIT) light = "lit";
    else if (j === LIGHTING.DARK) light = "dark";
    return light;
  };
  let out = "";
  for (const feat of deps.features.allFeatures()) {
    if (!feat.name) continue;
    if (feat.mimic !== null) continue;
    out += `# Terrain: ${feat.name}\n`;
    for (let j = 0; j < LIGHTING.MAX; j++) {
      const g = deps.table.featGlyph(j, feat.fidx);
      out += `feat:${feat.code}:${keyword(j)}:${g?.attr ?? 0}:${charCode(
        g?.char ?? "",
      )}\n`;
    }
  }
  return out;
}

/** dump_flavors (ui-prefs.c L279-292): a comment plus a blank line per flavour. */
export function dumpFlavors(deps: DumpDeps): string {
  let out = "";
  for (const flavor of deps.objects.flavors) {
    const g = deps.table.flavorGlyph(flavor.fidx);
    out += `# Item flavor: ${flavor.text}\n`;
    out += `flavor:${flavor.fidx}:${g?.attr ?? 0}:${charCode(g?.char ?? "")}\n\n`;
  }
  return out;
}

/**
 * dump_colors (ui-prefs.c L295-320): every colour row, skipping all-zero rows
 * at or past BASIC_COLORS. Only basic colours get their table name.
 */
export function dumpColors(): string {
  let out = "";
  for (let i = 0; i < MAX_COLORS; i++) {
    const kv = colorChannel(i, 0);
    const rv = colorChannel(i, 1);
    const gv = colorChannel(i, 2);
    const bv = colorChannel(i, 3);
    if (!kv && !rv && !gv && !bv && i >= BASIC_COLORS) continue;
    const name = i < BASIC_COLORS ? COLOR_TABLE[i]?.name ?? "unknown" : "unknown";
    out += `# Color: ${name}\n`;
    out += `color:${i}:${kv}:${rv}:${gv}:${bv}\n\n`;
  }
  return out;
}

/** dump_ui_entry_renderers (ui-prefs.c L323-349). */
export function dumpUiEntryRenderers(deps: DumpDeps): string {
  let out =
    "# Renderers for parts of the character screen.\n" +
    "# Format entry-renderer:name:colors:label_colors:symbols\n" +
    "# Use * for colors or label_colors to leave those unchanged\n" +
    "# Leave off symbols and the colon before it to leave those unchanged\n" +
    "# Look at lib/gamedata/ui_entry_renderers.txt for more information\n" +
    "# about how colors, label_colors, and symbols are used\n";
  for (const r of deps.entryRenderers ?? []) {
    out += `entry-renderer:${r.name}:${r.colors}:${r.labelColors}:${r.symbols}\n`;
  }
  return out;
}

/**
 * option_dump (ui-prefs.c L352-386): the SUBWINDOW flag set, not the game
 * options - the row that drives it is labelled "Save subwindow setup to pref
 * file". The port is one terminal with no subwindows, so there is nothing to
 * enumerate and the dump is its header alone, which is exactly what upstream
 * writes when no angband_term[i>0] exists (a single-window build).
 */
export function optionDump(): string {
  return "# Options\n\n";
}

/* ------------------------------------------------------------------------
 * The TileMap sink (the graphics interpretation of the same grammar)
 * ------------------------------------------------------------------------ */

/**
 * A PrefSink (prefs.ts) that writes into a TileMap: the graphics-mode
 * interpretation of the very same x_attr/x_char slots the ASCII GlyphTable
 * sink fills. The grammar - the `object:tval:*` wildcards, the `*` lighting
 * field, the `GF` `|` type list, base-0 integers, `%` includes - lives in
 * prefs.ts and is shared, because upstream has exactly one parser for it.
 * Values stay raw here (high bit and all): decoding attr/char to an atlas
 * (row, col) is the front end's job, exactly as upstream keeps the raw bytes.
 *
 * setProjection is the one slot the ASCII sink has nothing to write to, since
 * the port's bolt animation draws its own character rather than reading a
 * proj_to_char table.
 */
export function tileMapSink(map: TileMap, deps: TilePrefsDeps): PrefSink {
  const setPerLighting = (
    table: (TileAtlas | undefined)[][],
    lightIdx: number,
    idx: number,
    atlas: TileAtlas,
  ): void => {
    if (lightIdx < LIGHTING.MAX) {
      (table[lightIdx] as (TileAtlas | undefined)[])[idx] = atlas;
    } else {
      for (let j = 0; j < LIGHTING.MAX; j++) {
        (table[j] as (TileAtlas | undefined)[])[idx] = atlas;
      }
    }
  };
  return {
    setFeat: (lighting, fidx, attr, char) =>
      setPerLighting(map.feat, lighting, fidx, { attr, char }),
    setTrap: (lighting, tidx, attr, char) =>
      setPerLighting(map.trap, lighting, tidx, { attr, char }),
    setMonster: (ridx, attr, char) => {
      map.monster[ridx] = { attr, char };
    },
    setKind: (kidx, attr, char) => {
      map.object[kidx] = { attr, char };
    },
    setFlavor: (fidx, attr, char) => {
      map.flavor[fidx] = { attr, char };
    },
    setProjection: (proj, motion, attr, char) => {
      (map.gf[proj] as (TileAtlas | undefined)[])[motion] = { attr, char };
    },
    ...(deps.loadFile ? { loadFile: deps.loadFile } : {}),
  };
}

/**
 * Parse a graf-*.prf or flvr-*.prf text INTO an existing TileMap (so a graf
 * file and its flvr file layer into one map). Later lines overwrite earlier
 * ones for the same entity, exactly as the C reassigns the x_attr/x_char slot.
 *
 * Parse errors are dropped rather than reported: a graphics pref is loaded by
 * reset_visuals(true) with `quiet` semantics, and an entity this build does not
 * know simply keeps its ASCII glyph. `processPrefText` returns them for the
 * user-pref path, which does print them.
 */
export function parseTilePrefsInto(
  map: TileMap,
  text: string,
  deps: TilePrefsDeps,
): void {
  /* deps.vars is what selects the pack's player picture: the `?:` blocks in
   * xtra-*.prf test $RACE and $CLASS, and with neither supplied only the pack's
   * unconditional monster:<player> line survives. */
  processPrefText(text, deps as PrefDeps, tileMapSink(map, deps), {
    ...(deps.vars ? { vars: deps.vars } : {}),
  });
}

/** Parse pref text into a fresh TileMap. */
export function parseTilePrefs(text: string, deps: TilePrefsDeps): TileMap {
  const map = new TileMap();
  parseTilePrefsInto(map, text, deps);
  return map;
}
