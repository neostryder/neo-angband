/**
 * The DATA half of the second character screen's resist / ability / sustain /
 * modifier grid, ported from Angband 4.2.6:
 *   - reference/src/ui-entry.c            (the config engine + value compute)
 *   - reference/src/ui-entry-combiner.c   (the 9 value combiners)
 *   - reference/src/ui-entry-renderers.c  (value -> symbol + palette-index)
 *   - reference/src/ui-player.c           (display_resistance_panel /
 *     display_player_sust_info assembly + configure_char_sheet layout)
 *
 * The upstream files split naturally into an engine (build a table of ui_entry
 * records from ui_entry.txt / ui_entry_base.txt, bind object/player properties
 * to them via the bindui directive, then for a given object or player combine
 * the bound property values) and a renderer (turn a per-column (val, auxval)
 * pair into a cell symbol + a palette-index colour, and colour the row label by
 * the combined value). This module ports both halves as DATA: characterGrid()
 * returns, per panel, an ordered list of rows; each row is a 6-char label, its
 * colour, and one {symbol, color} cell per equipment slot then the player.
 *
 * The DRAW half stays with the shell: the Term_putch / Term_putstr row/col
 * placement, region_erase, the screen-size priority culling of
 * configure_char_sheet's "fit in 24 rows" clamp beyond what the row cap
 * reproduces, the equippy header row and the "abcdefgimnop@" column header.
 *
 * Seams the port does not carry on GameState arrive through UiEntryDeps; each
 * has a documented default and is listed in parity/ledger/ui-entry.yaml. The
 * per-object known twin (obj->known) and player_flags_timed() are not ported,
 * so the timed player-flag / timed element contributions default to "no timed
 * effect" - faithful for a character with no active buffs.
 */

import { colorCharToAttr } from "../color";
import { FlagSet } from "../bitflag";
import { OF } from "../generated/object-flags";
import { PF } from "../generated/player-flags";
import { TMD } from "../generated/player-timed";
import { OBJ_MOD } from "../generated/object-modifiers";
import { STAT } from "../generated/stats";
import { ELEM, ELEMENT_ENTRIES } from "../generated/elements";
import {
  UI_ENTRY_RENDERER,
  UI_ENTRY_RENDERER_ENTRIES,
} from "../generated/ui-entry-renderers";
import { EL_INFO_IGNORE, OF_SIZE } from "../obj/types";
import { SKILL } from "../player/types";
import { playerFlags } from "../player/calcs";
import { gearGet } from "./gear";
import type { Player } from "../player/player";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";

/* ------------------------------------------------------------------ */
/* Special values (ui-entry-combiner.h)                                */
/* ------------------------------------------------------------------ */

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/** ui-entry-combiner.h: real value unknown to the player. */
export const UI_ENTRY_UNKNOWN_VALUE = INT_MAX;
/** ui-entry-combiner.h: value is to be treated as not present. */
export const UI_ENTRY_VALUE_NOT_PRESENT = INT_MAX - 1;
/** ui-entry-combiner.h: resist + vulnerability but not immunity, same element. */
export const UI_ENTRY_RESIST0_RES_VUL = INT_MAX - 2;

/* Sign handling (ui-entry-renderers.c enum). */
const UI_ENTRY_NO_SIGN = 0;
const UI_ENTRY_ALWAYS_SIGN = 1;
const UI_ENTRY_NEGATIVE_SIGN = 2;

/* Object property types (obj/types.ts OBJ_PROPERTY). */
const OP_STAT = 1;
const OP_MOD = 2;
const OP_FLAG = 3;
const OP_IGNORE = 4;
const OP_RESIST = 5;
const OP_VULN = 6;
const OP_IMM = 7;

/* Entry flag bit (ui-entry.c ENTRY_FLAG_TIMED_AUX). */
const ENTRY_FLAG_TIMED_AUX = 1;

/* ------------------------------------------------------------------ */
/* Combiners (ui-entry-combiner.c)                                     */
/* ------------------------------------------------------------------ */

interface CombinerState {
  work: number[] | null;
  accum: number;
  accumAux: number;
}

interface CombinerFuncs {
  init: (v: number, a: number, st: CombinerState) => void;
  accum: (v: number, a: number, st: CombinerState) => void;
  finish: (st: CombinerState) => void;
  vec: (vals: number[], auxs: number[]) => { accum: number; accumAux: number };
}

function simpleInit(v: number, a: number, st: CombinerState): void {
  st.work = null;
  st.accum = v;
  st.accumAux = a;
}

function dummyAccum(): void {
  /* Do nothing. */
}

function dummyFinish(): void {
  /* Do nothing. */
}

/* ADD */
function addHelp(x: number, accum: number): number {
  if (x === UI_ENTRY_VALUE_NOT_PRESENT) return accum;
  if (x === UI_ENTRY_UNKNOWN_VALUE) {
    return accum === UI_ENTRY_VALUE_NOT_PRESENT ? UI_ENTRY_UNKNOWN_VALUE : accum;
  }
  if (accum === UI_ENTRY_UNKNOWN_VALUE || accum === UI_ENTRY_VALUE_NOT_PRESENT) {
    return x;
  }
  if (x > 0) {
    return accum <= INT_MAX - 2 - x ? accum + x : INT_MAX - 2;
  }
  if (x < 0) {
    return accum >= INT_MIN - x ? accum + x : INT_MIN;
  }
  return accum;
}

const ADD: CombinerFuncs = {
  init: simpleInit,
  accum(v, a, st) {
    st.accum = addHelp(v, st.accum);
    st.accumAux = addHelp(a, st.accumAux);
  },
  finish: dummyFinish,
  vec(vals, auxs) {
    let accum = vals.length > 0 ? vals[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < vals.length; i++) accum = addHelp(vals[i]!, accum);
    let accumAux = auxs.length > 0 ? auxs[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < auxs.length; i++) accumAux = addHelp(auxs[i]!, accumAux);
    return { accum, accumAux };
  },
};

/* BITWISE_OR */
function bitwiseOrHelp(x: number, accum: number): number {
  if (x === UI_ENTRY_VALUE_NOT_PRESENT) return accum;
  if (x === UI_ENTRY_UNKNOWN_VALUE) {
    return accum === UI_ENTRY_VALUE_NOT_PRESENT ? UI_ENTRY_UNKNOWN_VALUE : accum;
  }
  if (accum === UI_ENTRY_UNKNOWN_VALUE || accum === UI_ENTRY_VALUE_NOT_PRESENT) {
    return x;
  }
  return accum | x;
}

const BITWISE_OR: CombinerFuncs = {
  init: simpleInit,
  accum(v, a, st) {
    st.accum = bitwiseOrHelp(v, st.accum);
    st.accumAux = bitwiseOrHelp(a, st.accumAux);
  },
  finish: dummyFinish,
  vec(vals, auxs) {
    let accum = vals.length > 0 ? vals[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < vals.length; i++) accum = bitwiseOrHelp(vals[i]!, accum);
    let accumAux = auxs.length > 0 ? auxs[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < auxs.length; i++) accumAux = bitwiseOrHelp(auxs[i]!, accumAux);
    return { accum, accumAux };
  },
};

/* FIRST */
const FIRST: CombinerFuncs = {
  init: simpleInit,
  accum: dummyAccum,
  finish: dummyFinish,
  vec(vals, auxs) {
    if (vals.length > 0) return { accum: vals[0]!, accumAux: auxs[0]! };
    return { accum: UI_ENTRY_VALUE_NOT_PRESENT, accumAux: UI_ENTRY_VALUE_NOT_PRESENT };
  },
};

/* LARGEST */
function largestHelp(x: number, accum: number): number {
  if (x === UI_ENTRY_VALUE_NOT_PRESENT) return accum;
  if (x === UI_ENTRY_UNKNOWN_VALUE) {
    return accum === UI_ENTRY_VALUE_NOT_PRESENT ? UI_ENTRY_UNKNOWN_VALUE : accum;
  }
  if (
    accum === UI_ENTRY_UNKNOWN_VALUE ||
    accum === UI_ENTRY_VALUE_NOT_PRESENT ||
    accum < x
  ) {
    return x;
  }
  return accum;
}

const LARGEST: CombinerFuncs = {
  init: simpleInit,
  accum(v, a, st) {
    st.accum = largestHelp(v, st.accum);
    st.accumAux = largestHelp(a, st.accumAux);
  },
  finish: dummyFinish,
  vec(vals, auxs) {
    let accum = vals.length > 0 ? vals[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < vals.length; i++) accum = largestHelp(vals[i]!, accum);
    let accumAux = auxs.length > 0 ? auxs[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < auxs.length; i++) accumAux = largestHelp(auxs[i]!, accumAux);
    return { accum, accumAux };
  },
};

/* LAST */
const LAST: CombinerFuncs = {
  init: simpleInit,
  accum(v, a, st) {
    st.accum = v;
    st.accumAux = a;
  },
  finish: dummyFinish,
  vec(vals, auxs) {
    if (vals.length > 0) {
      return { accum: vals[vals.length - 1]!, accumAux: auxs[auxs.length - 1]! };
    }
    return { accum: UI_ENTRY_VALUE_NOT_PRESENT, accumAux: UI_ENTRY_VALUE_NOT_PRESENT };
  },
};

/* LOGICAL_OR */
function logicalInit(v: number, a: number, st: CombinerState): void {
  st.work = null;
  st.accum =
    v === UI_ENTRY_UNKNOWN_VALUE || v === UI_ENTRY_VALUE_NOT_PRESENT ? v : v !== 0 ? 1 : 0;
  st.accumAux =
    a === UI_ENTRY_UNKNOWN_VALUE || a === UI_ENTRY_VALUE_NOT_PRESENT ? a : a !== 0 ? 1 : 0;
}

function logicalOrHelp(x: number, accum: number): number {
  if (x === UI_ENTRY_VALUE_NOT_PRESENT) return accum;
  if (x === UI_ENTRY_UNKNOWN_VALUE) {
    return accum === UI_ENTRY_VALUE_NOT_PRESENT ? UI_ENTRY_UNKNOWN_VALUE : accum;
  }
  if (accum === UI_ENTRY_UNKNOWN_VALUE || accum === UI_ENTRY_VALUE_NOT_PRESENT) {
    return x !== 0 ? 1 : 0;
  }
  return accum || x !== 0 ? 1 : 0;
}

const LOGICAL_OR: CombinerFuncs = {
  init: logicalInit,
  accum(v, a, st) {
    st.accum = logicalOrHelp(v, st.accum);
    st.accumAux = logicalOrHelp(a, st.accumAux);
  },
  finish: dummyFinish,
  vec(vals, auxs) {
    let accum = UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 0; i < vals.length; i++) accum = logicalOrHelp(vals[i]!, accum);
    let accumAux = UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 0; i < auxs.length; i++) accumAux = logicalOrHelp(auxs[i]!, accumAux);
    return { accum, accumAux };
  },
};

/* LOGICAL_OR_WITH_CANCEL */
function locInit(v: number, a: number, st: CombinerState): void {
  st.work = null;
  st.accum =
    v === UI_ENTRY_UNKNOWN_VALUE || v === UI_ENTRY_VALUE_NOT_PRESENT
      ? v
      : v > 0
        ? 1
        : v < 0
          ? 2
          : 0;
  st.accumAux =
    a === UI_ENTRY_UNKNOWN_VALUE || a === UI_ENTRY_VALUE_NOT_PRESENT
      ? a
      : a > 0
        ? 1
        : a < 0
          ? 2
          : 0;
}

function locHelp(x: number, accum: number): number {
  if (x === UI_ENTRY_VALUE_NOT_PRESENT) return accum;
  if (x === UI_ENTRY_UNKNOWN_VALUE) {
    return accum === UI_ENTRY_VALUE_NOT_PRESENT ? UI_ENTRY_UNKNOWN_VALUE : accum;
  }
  if (accum === UI_ENTRY_UNKNOWN_VALUE || accum === UI_ENTRY_VALUE_NOT_PRESENT) {
    return x > 0 ? 1 : x < 0 ? 2 : 0;
  }
  if (x > 0) return accum | 1;
  if (x < 0) return accum | 2;
  return accum;
}

function locResolve(v: number): number {
  if (v !== UI_ENTRY_UNKNOWN_VALUE && v !== UI_ENTRY_VALUE_NOT_PRESENT) {
    if ((v & 2) !== 0) return -1;
  }
  return v;
}

const LOGICAL_OR_WITH_CANCEL: CombinerFuncs = {
  init: locInit,
  accum(v, a, st) {
    st.accum = locHelp(v, st.accum);
    st.accumAux = locHelp(a, st.accumAux);
  },
  finish(st) {
    st.accum = locResolve(st.accum);
    st.accumAux = locResolve(st.accumAux);
  },
  vec(vals, auxs) {
    let accum = UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 0; i < vals.length; i++) accum = locHelp(vals[i]!, accum);
    accum = locResolve(accum);
    let accumAux = UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 0; i < auxs.length; i++) accumAux = locHelp(auxs[i]!, accumAux);
    accumAux = locResolve(accumAux);
    return { accum, accumAux };
  },
};

/* RESIST_0 (uses work[0]=most negative for val, work[1]=most negative for aux) */
function resist0Seed(x: number): { pos: number; neg: number } {
  if (x === UI_ENTRY_UNKNOWN_VALUE || x === UI_ENTRY_VALUE_NOT_PRESENT) {
    return { pos: x, neg: x };
  }
  if (x === UI_ENTRY_RESIST0_RES_VUL) return { pos: 1, neg: -1 };
  if (x > 0) return { pos: x, neg: 0 };
  return { pos: 0, neg: x };
}

function resist0Help(x: number, pos: number, neg: number): { pos: number; neg: number } {
  if (x === UI_ENTRY_VALUE_NOT_PRESENT) return { pos, neg };
  if (x === UI_ENTRY_UNKNOWN_VALUE) {
    if (pos === UI_ENTRY_VALUE_NOT_PRESENT) {
      return { pos: UI_ENTRY_UNKNOWN_VALUE, neg: UI_ENTRY_UNKNOWN_VALUE };
    }
    return { pos, neg };
  }
  if (x === UI_ENTRY_RESIST0_RES_VUL) {
    if (pos === UI_ENTRY_UNKNOWN_VALUE || pos === UI_ENTRY_VALUE_NOT_PRESENT) {
      return { pos: 1, neg: -1 };
    }
    return { pos: pos < 1 ? 1 : pos, neg: neg > -1 ? -1 : neg };
  }
  if (x > 0) {
    if (pos === UI_ENTRY_UNKNOWN_VALUE || pos === UI_ENTRY_VALUE_NOT_PRESENT) {
      return { pos: x, neg: 0 };
    }
    return { pos: pos < x ? x : pos, neg };
  }
  if (neg === UI_ENTRY_UNKNOWN_VALUE || neg === UI_ENTRY_VALUE_NOT_PRESENT) {
    return { pos: 0, neg: x };
  }
  return { pos, neg: neg > x ? x : neg };
}

function resist0Finish(pos: number, neg: number): number {
  if (neg < 0 && neg !== UI_ENTRY_UNKNOWN_VALUE && neg !== UI_ENTRY_VALUE_NOT_PRESENT) {
    /* A vulnerability cancels a resist but not an immunity. */
    if (pos < 3 && pos !== UI_ENTRY_UNKNOWN_VALUE && pos !== UI_ENTRY_VALUE_NOT_PRESENT) {
      return pos === 0 ? -1 : UI_ENTRY_RESIST0_RES_VUL;
    }
  }
  return pos;
}

const RESIST_0: CombinerFuncs = {
  init(v, a, st) {
    const sv = resist0Seed(v);
    const sa = resist0Seed(a);
    st.work = [sv.neg, sa.neg];
    st.accum = sv.pos;
    st.accumAux = sa.pos;
  },
  accum(v, a, st) {
    const work = st.work as number[];
    const rv = resist0Help(v, st.accum, work[0]!);
    st.accum = rv.pos;
    work[0] = rv.neg;
    const ra = resist0Help(a, st.accumAux, work[1]!);
    st.accumAux = ra.pos;
    work[1] = ra.neg;
  },
  finish(st) {
    const work = st.work as number[];
    st.accum = resist0Finish(st.accum, work[0]!);
    st.accumAux = resist0Finish(st.accumAux, work[1]!);
    st.work = null;
  },
  vec(vals, auxs) {
    let accum = UI_ENTRY_VALUE_NOT_PRESENT;
    let neg = UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 0; i < vals.length; i++) {
      const r = resist0Help(vals[i]!, accum, neg);
      accum = r.pos;
      neg = r.neg;
    }
    accum = resist0Finish(accum, neg);
    let accumAux = UI_ENTRY_VALUE_NOT_PRESENT;
    let negA = UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 0; i < auxs.length; i++) {
      const r = resist0Help(auxs[i]!, accumAux, negA);
      accumAux = r.pos;
      negA = r.neg;
    }
    accumAux = resist0Finish(accumAux, negA);
    return { accum, accumAux };
  },
};

/* SMALLEST */
function smallestHelp(x: number, accum: number): number {
  if (x === UI_ENTRY_VALUE_NOT_PRESENT) return accum;
  if (x === UI_ENTRY_UNKNOWN_VALUE) {
    return accum === UI_ENTRY_VALUE_NOT_PRESENT ? UI_ENTRY_UNKNOWN_VALUE : accum;
  }
  if (
    accum === UI_ENTRY_UNKNOWN_VALUE ||
    accum === UI_ENTRY_VALUE_NOT_PRESENT ||
    accum > x
  ) {
    return x;
  }
  return accum;
}

const SMALLEST: CombinerFuncs = {
  init: simpleInit,
  accum(v, a, st) {
    st.accum = smallestHelp(v, st.accum);
    st.accumAux = smallestHelp(a, st.accumAux);
  },
  finish: dummyFinish,
  vec(vals, auxs) {
    let accum = vals.length > 0 ? vals[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < vals.length; i++) accum = smallestHelp(vals[i]!, accum);
    let accumAux = auxs.length > 0 ? auxs[0]! : UI_ENTRY_VALUE_NOT_PRESENT;
    for (let i = 1; i < auxs.length; i++) accumAux = smallestHelp(auxs[i]!, accumAux);
    return { accum, accumAux };
  },
};

/** combiners[], sorted alphabetically by name (ui-entry-combiner.c L83). */
const COMBINERS: ReadonlyArray<{ name: string; funcs: CombinerFuncs }> = [
  { name: "ADD", funcs: ADD },
  { name: "BITWISE_OR", funcs: BITWISE_OR },
  { name: "FIRST", funcs: FIRST },
  { name: "LARGEST", funcs: LARGEST },
  { name: "LAST", funcs: LAST },
  { name: "LOGICAL_OR", funcs: LOGICAL_OR },
  { name: "LOGICAL_OR_WITH_CANCEL", funcs: LOGICAL_OR_WITH_CANCEL },
  { name: "RESIST_0", funcs: RESIST_0 },
  { name: "SMALLEST", funcs: SMALLEST },
];

/** ui_entry_combiner_lookup: 1-based index, 0 if unknown. */
export function combinerLookup(name: string): number {
  for (let i = 0; i < COMBINERS.length; i++) {
    if (COMBINERS[i]!.name === name) return i + 1;
  }
  return 0;
}

function combinerFuncs(index: number): CombinerFuncs {
  const c = COMBINERS[index - 1];
  if (!c) throw new Error(`bad combiner index ${index}`);
  return c.funcs;
}

/** Run a combiner over parallel arrays (its vec_func); exported for tests. */
export function combineValues(
  combinerName: string,
  vals: number[],
  auxs: number[],
): { accum: number; accumAux: number } {
  const idx = combinerLookup(combinerName);
  if (idx === 0) throw new Error(`unknown combiner ${combinerName}`);
  return combinerFuncs(idx).vec(vals, auxs);
}

/* ------------------------------------------------------------------ */
/* Raw pack record shapes (input to buildUiEntryConfig)               */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

interface UiEntryRecord extends Json {
  name: string;
}

/** The pack JSON needed to build the config. */
export interface UiEntryPackRecords {
  uiEntry: UiEntryRecord[];
  uiEntryBase: UiEntryRecord[];
  uiEntryRenderer: Json[];
  objectProperty: Json[];
  playerProperty: Json[];
}

/* ------------------------------------------------------------------ */
/* Renderer table (ui-entry-renderers.c)                               */
/* ------------------------------------------------------------------ */

interface RendererInfo {
  name: string;
  backendIndex: number; // 0..5 into UI_ENTRY_RENDERER_ENTRIES
  combinerIndex: number;
  colors: number[]; // COLOUR_* per palette slot
  labelColors: number[];
  symbols: string; // one code unit per palette slot
  ndigit: number;
  sign: number;
  combinedRendererIndex: number; // 1-based, 0 if none
}

function signNameToInt(name: string): number {
  if (name === "NO_SIGN") return UI_ENTRY_NO_SIGN;
  if (name === "ALWAYS_SIGN") return UI_ENTRY_ALWAYS_SIGN;
  if (name === "NEGATIVE_SIGN") return UI_ENTRY_NEGATIVE_SIGN;
  return UI_ENTRY_NO_SIGN;
}

function colorsFromChars(chars: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const a = colorCharToAttr(chars[i]!);
    out.push(a >= 0 ? a : 1 /* COLOUR_WHITE */);
  }
  return out;
}

/** augment_colors: extend attr[] with the default palette tail if shorter. */
function augmentColors(defaults: string, attr: number[]): number[] {
  if (attr.length < defaults.length) {
    const tail = colorsFromChars(defaults.slice(attr.length));
    return attr.concat(tail);
  }
  return attr;
}

/** augment_symbols: extend symbols with the default tail if shorter. */
function augmentSymbols(defaults: string, sym: string): string {
  return sym.length < defaults.length ? sym + defaults.slice(sym.length) : sym;
}

function buildRenderers(records: Json[]): RendererInfo[] {
  const out: RendererInfo[] = [];
  const byName = new Map<string, number>();
  /* First pass: create renderer_info, resolving the backend. */
  for (const rec of records) {
    const name = String(rec["name"]);
    const code = String(rec["code"]);
    const backendIndex = (UI_ENTRY_RENDERER as Record<string, number>)[code] ?? -1;
    const backend = backendIndex >= 0 ? UI_ENTRY_RENDERER_ENTRIES[backendIndex]! : null;

    let colors = rec["colors"] !== undefined ? colorsFromChars(String(rec["colors"])) : [];
    let labelColors =
      rec["labelcolors"] !== undefined ? colorsFromChars(String(rec["labelcolors"])) : [];
    let symbols = rec["symbols"] !== undefined ? String(rec["symbols"]) : "";

    /* finish_parse: default combiner + augment with backend defaults. */
    let combinerIndex = rec["combine"] !== undefined ? combinerLookup(String(rec["combine"])) : 0;
    if (backend) {
      if (combinerIndex === 0) combinerIndex = combinerLookup(backend.defaultCombinerName);
      colors = augmentColors(backend.defaultColors, colors);
      labelColors = augmentColors(backend.defaultLabelColors, labelColors);
      symbols = augmentSymbols(backend.defaultSymbols, symbols);
    }
    const ndigit =
      rec["ndigit"] !== undefined ? Number(rec["ndigit"]) : (backend?.defaultNDigit ?? 1);
    const sign =
      rec["sign"] !== undefined
        ? signNameToInt(String(rec["sign"]))
        : signNameToInt(backend?.defaultSign ?? "NO_SIGN");

    byName.set(name, out.length + 1);
    out.push({
      name,
      backendIndex,
      combinerIndex,
      colors,
      labelColors,
      symbols,
      ndigit,
      sign,
      combinedRendererIndex: 0,
    });
  }
  /* Second pass: resolve combined-renderer links. */
  for (let i = 0; i < records.length; i++) {
    const cr = records[i]!["combined-renderer"];
    if (cr !== undefined) {
      out[i]!.combinedRendererIndex = byName.get(String(cr)) ?? 0;
    }
  }
  return out;
}

/** ui_entry_renderer_lookup: 1-based renderer index, 0 if unknown. */
function rendererLookup(renderers: RendererInfo[], name: string): number {
  for (let i = 0; i < renderers.length; i++) {
    if (renderers[i]!.name === name) return i + 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Concrete ui_entry table (ui-entry.c)                                */
/* ------------------------------------------------------------------ */

const MAX_SHORTENED = 10;

interface CategoryRef {
  name: string;
  priority: number;
}

interface BoundObjProp {
  type: number;
  index: number;
  value: number;
  haveValue: boolean;
  isaux: boolean;
}

interface BoundPlayerAbility {
  abilityType: string; // "player" | "object" | "element"
  index: number;
  value: number;
  haveValue: boolean;
  isaux: boolean;
}

interface UiEntry {
  name: string;
  categories: CategoryRef[]; // sorted by name
  objProps: BoundObjProp[];
  pAbilities: BoundPlayerAbility[];
  label: string;
  nlabel: number;
  shortened: string[]; // index 0..9 -> length 1..10
  nshortened: number[];
  rendererIndex: number;
  combinerIndex: number;
  defaultPriority: number;
  paramIndex: number;
  flags: number;
  templateOnly: boolean;
}

export interface UiEntryConfig {
  entries: UiEntry[]; // sorted by name (ui_entry_search order)
  renderers: RendererInfo[];
}

/** Priority scheme index: 0=default, 1=index, 2=negative_index. */
function priorityScheme(name: string): number {
  if (name === "index") return 1;
  if (name === "negative_index") return 2;
  return 0;
}
function applyPriorityScheme(scheme: number, i: number): number {
  if (scheme === 1) return i;
  if (scheme === 2) return -i;
  return 0;
}

/** Parameter kind: 0=none, 1=element, 2=stat. */
function parameterKind(name: string | undefined): number {
  if (name === "element") return 1;
  if (name === "stat") return 2;
  return 0;
}
function paramCount(kind: number): number {
  if (kind === 1) return ELEMENT_ENTRIES.length;
  if (kind === 2) return 5; /* STAT_MAX */
  return 1;
}
function paramName(kind: number, i: number): string {
  if (kind === 1) return ELEMENT_ENTRIES[i]!.name;
  if (kind === 2) return ["STR", "INT", "WIS", "DEX", "CON"][i]!;
  return "";
}

/** fill_out_shortened (ui-entry.c L1756): fill every shortened slot. */
function fillOutShortened(entry: UiEntry): void {
  for (let i = 0; i < MAX_SHORTENED; i++) {
    if (entry.nshortened[i] !== 0) continue;
    let n: number;
    let src: string;
    let j = i + 1;
    for (;;) {
      if (j >= MAX_SHORTENED) {
        n = entry.nlabel;
        src = entry.label;
        break;
      }
      if (entry.nshortened[j] !== 0) {
        n = entry.nshortened[j]!;
        src = entry.shortened[j]!;
        break;
      }
      j++;
    }
    const take = n < i + 1 ? n : i + 1;
    entry.nshortened[i] = take;
    entry.shortened[i] = src.slice(0, take);
  }
}

/**
 * get_ui_entry_label (ui-entry.c L337): the visible (length-1)-char label,
 * padded left or right. The final null slot is the caller's business.
 */
function getUiEntryLabel(entry: UiEntry, length: number, padLeft: boolean): string {
  if (length <= 1) return "";
  let src: string;
  let n: number;
  if (length <= MAX_SHORTENED + 1) {
    src = entry.shortened[length - 2]!;
    n = entry.nshortened[length - 2]!;
  } else {
    src = entry.label;
    n = entry.nlabel;
  }
  const content = length - 1;
  if (n < content) {
    const pad = " ".repeat(content - n);
    return padLeft ? pad + src.slice(0, n) : src.slice(0, n) + pad;
  }
  return src.slice(0, content);
}

function blankEntry(name: string): UiEntry {
  return {
    name,
    categories: [],
    objProps: [],
    pAbilities: [],
    label: "",
    nlabel: 0,
    shortened: new Array<string>(MAX_SHORTENED).fill(""),
    nshortened: new Array<number>(MAX_SHORTENED).fill(0),
    rendererIndex: 0,
    combinerIndex: 0,
    defaultPriority: 0,
    paramIndex: -1,
    flags: 0,
    templateOnly: false,
  };
}

/** search_categories on a UiEntry: insert if absent (kept sorted by name). */
function addCategory(entry: UiEntry, name: string, priority: number): void {
  let lo = 0;
  let hi = entry.categories.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const cmp = entry.categories[mid]!.name < name ? -1 : entry.categories[mid]!.name > name ? 1 : 0;
    if (cmp === 0) return; /* already present */
    if (cmp < 0) lo = mid + 1;
    else hi = mid;
  }
  entry.categories.splice(lo, 0, { name, priority });
}

function categoryPriority(entry: UiEntry, name: string): number | null {
  for (const c of entry.categories) {
    if (c.name === name) return c.priority;
  }
  return null;
}

/**
 * Build the ui_entry table from ui_entry_base.txt (templates) then
 * ui_entry.txt, mirroring run_parse_ui_entry / hatch_embryo. Records are keyed
 * by name; a record whose name already exists edits that entry, otherwise a new
 * one is created (and, if it carries a parameter, expanded per element/stat).
 */
function buildEntries(
  baseRecords: UiEntryRecord[],
  entryRecords: UiEntryRecord[],
  renderers: RendererInfo[],
): Map<string, UiEntry> {
  const table = new Map<string, UiEntry>();

  const strField = (rec: Json, key: string): string | undefined =>
    rec[key] !== undefined ? String(rec[key]) : undefined;
  const arrField = (rec: Json, key: string): string[] => {
    const v = rec[key];
    if (v === undefined) return [];
    return Array.isArray(v) ? v.map(String) : [String(v)];
  };

  const hatch = (rec: UiEntryRecord, templateOnlyDefault: boolean): void => {
    const name = rec.name;
    const existing = table.get(name);

    if (existing) {
      /* Edit an existing entry. */
      applyRecordToEntry(rec, existing, renderers, strField, arrField, -1, 0);
      return;
    }

    const kind = parameterKind(strField(rec, "parameter"));
    /* Determine the priority scheme source for a fresh (possibly generic) entry. */
    const priorityStr = strField(rec, "priority");
    const psource = priorityStr !== undefined ? priorityScheme(priorityStr) : 0;

    if (kind === 0) {
      const entry = blankEntry(name);
      entry.templateOnly = templateOnlyDefault;
      applyRecordToEntry(rec, entry, renderers, strField, arrField, -1, 0);
      table.set(name, entry);
      return;
    }

    /* Generic entry: expand into one concrete entry per parameter value. */
    const n = paramCount(kind);
    for (let i = 0; i < n; i++) {
      const pname = paramName(kind, i);
      const entry = blankEntry(`${name}<${pname}>`);
      entry.templateOnly = templateOnlyDefault;
      entry.paramIndex = i;
      applyRecordToEntry(rec, entry, renderers, strField, arrField, i, psource);
      /* Default label is the parameter name unless one was set. */
      if (entry.nlabel === 0) {
        entry.label = pname;
        entry.nlabel = pname.length;
      }
      table.set(entry.name, entry);
    }
  };

  for (const rec of baseRecords) hatch(rec, false);
  /* After the base file, all entries so far become templates-only. */
  for (const e of table.values()) e.templateOnly = true;
  for (const rec of entryRecords) hatch(rec, false);

  /* finish_parse: default labels from name, fill shortened, fill priorities. */
  for (const entry of table.values()) {
    if (entry.nlabel === 0) {
      entry.label = entry.name;
      entry.nlabel = entry.name.length;
    }
    fillOutShortened(entry);
    /*
     * finish_parse (ui-entry.c L2389): categories with no explicit per-category
     * priority inherit the entry's final default priority. The shipped data
     * never sets a per-category priority (priority always precedes any category
     * line, so it sets the default), so every category takes defaultPriority -
     * which is what makes the priority line seen after a template's categories
     * still order the row correctly.
     */
    for (const c of entry.categories) {
      c.priority = entry.defaultPriority;
    }
  }

  return table;
}

/**
 * Apply one parsed record's fields to an entry, resolving template, renderer,
 * combiner, labels, categories, priority and flags. paramIdx/psource drive the
 * generic priority scheme (negative_index etc.) for expanded entries.
 */
function applyRecordToEntry(
  rec: UiEntryRecord,
  entry: UiEntry,
  renderers: RendererInfo[],
  strField: (rec: Json, key: string) => string | undefined,
  arrField: (rec: Json, key: string) => string[],
  paramIdx: number,
  psource: number,
): void {
  /* Template first: copy simple fields and merge its categories. */
  const template = strField(rec, "template");
  if (template !== undefined) {
    const t = TEMPLATE_LOOKUP.get(template);
    if (t) {
      entry.rendererIndex = t.rendererIndex;
      entry.combinerIndex = t.combinerIndex;
      entry.defaultPriority = t.defaultPriority;
      entry.flags = t.flags & ~0; /* TEMPLATE_ONLY is not a data flag here */
      for (const c of t.categories) addCategory(entry, c.name, entry.defaultPriority);
    }
  }

  const renderer = strField(rec, "renderer");
  if (renderer !== undefined) entry.rendererIndex = rendererLookup(renderers, renderer);
  const combine = strField(rec, "combine");
  if (combine !== undefined) entry.combinerIndex = combinerLookup(combine);

  const label = strField(rec, "label");
  if (label !== undefined) {
    entry.label = label;
    entry.nlabel = label.length;
  }
  for (let k = 1; k <= MAX_SHORTENED; k++) {
    const s = strField(rec, `label${k}`);
    if (s !== undefined) {
      const take = s.length < k ? s.length : k;
      entry.shortened[k - 1] = s.slice(0, take);
      entry.nshortened[k - 1] = take;
    }
  }

  /* Priority (before any category in the shipped data -> default priority). */
  const priorityStr = strField(rec, "priority");
  if (priorityStr !== undefined) {
    const scheme = priorityScheme(priorityStr);
    if (scheme !== 0) {
      entry.defaultPriority = applyPriorityScheme(scheme, paramIdx >= 0 ? paramIdx : entry.paramIndex >= 0 ? entry.paramIndex : 0);
    } else {
      const v = parseInt(priorityStr, 10);
      if (!Number.isNaN(v)) entry.defaultPriority = v;
    }
  } else if (psource !== 0 && paramIdx >= 0) {
    entry.defaultPriority = applyPriorityScheme(psource, paramIdx);
  }

  /* Categories: added with the (now-resolved) default priority. */
  for (const cat of arrField(rec, "category")) {
    addCategory(entry, cat, entry.defaultPriority);
  }

  /* Flags. */
  for (const fl of arrField(rec, "flags")) {
    for (const tok of fl.split(/[\s|]+/)) {
      if (tok === "TIMED_AS_AUX") entry.flags |= ENTRY_FLAG_TIMED_AUX;
    }
  }
}

/** Lookup used by applyRecordToEntry for template resolution. */
let TEMPLATE_LOOKUP: Map<string, UiEntry> = new Map();

/* ------------------------------------------------------------------ */
/* Binding object / player properties to entries (the bindui directive) */
/* ------------------------------------------------------------------ */

function objPropType(typeStr: string): number {
  switch (typeStr) {
    case "stat":
      return OP_STAT;
    case "mod":
      return OP_MOD;
    case "flag":
      return OP_FLAG;
    case "ignore":
      return OP_IGNORE;
    case "resistance":
      return OP_RESIST;
    case "vulnerability":
      return OP_VULN;
    case "immunity":
      return OP_IMM;
    default:
      return 0;
  }
}

/** Resolve an object property's code to its index within its type. */
function objPropIndex(typeStr: string, code: string): number {
  switch (typeStr) {
    case "stat":
      return (STAT as Record<string, number>)[code] ?? -1;
    case "mod":
      return (OBJ_MOD as Record<string, number>)[code] ?? -1;
    case "flag":
      return (OF as Record<string, number>)[code] ?? -1;
    case "ignore":
    case "resistance":
    case "vulnerability":
    case "immunity":
      return (ELEM as Record<string, number>)[code] ?? -1;
    default:
      return -1;
  }
}

function bindObjectProperties(table: Map<string, UiEntry>, records: Json[]): void {
  for (const rec of records) {
    const bindui = rec["bindui"] as Json | undefined;
    if (!bindui) continue;
    const uiName = String(bindui["ui"]);
    const entry = table.get(uiName);
    if (!entry) continue;
    const typeStr = String(rec["type"]);
    const code = String(rec["code"]);
    const type = objPropType(typeStr);
    const index = objPropIndex(typeStr, code);
    if (type === 0 || index < 0) continue;
    const haveValue = bindui["uival"] !== undefined;
    const value = haveValue ? Number(bindui["uival"]) : 0;
    const isaux = Number(bindui["aux"]) !== 0;
    entry.objProps.push({ type, index, value, haveValue, isaux });
  }
}

function bindPlayerProperties(table: Map<string, UiEntry>, records: Json[]): void {
  const elementCount = ELEMENT_ENTRIES.length;
  for (const rec of records) {
    const bindui = rec["bindui"] as Json | undefined;
    if (!bindui) continue;
    const abilityType = String(rec["type"]);
    const uiName = String(bindui["ui"]);
    const uival = bindui["uival"] !== undefined ? String(bindui["uival"]) : "";
    const isspecial = uival === "special";
    const haveValue = !isspecial;
    const value = isspecial ? 0 : parseInt(uival, 10) || 0;
    const isaux = Number(bindui["aux"]) !== 0;

    if (abilityType === "element") {
      /* finish_parse_player_prop (init.c L1362): one ability per element,
         excluding the last, bound to "<ui><ELEM>". */
      for (let i = 0; i < elementCount - 1; i++) {
        const name = `${uiName}<${ELEMENT_ENTRIES[i]!.name}>`;
        const entry = table.get(name);
        if (!entry) continue;
        entry.pAbilities.push({ abilityType: "element", index: i, value, haveValue, isaux });
      }
    } else {
      const entry = table.get(uiName);
      if (!entry) continue;
      const code = rec["code"] !== undefined ? String(rec["code"]) : "";
      let index = -1;
      if (abilityType === "player") index = (PF as Record<string, number>)[code] ?? -1;
      else if (abilityType === "object") index = (OF as Record<string, number>)[code] ?? -1;
      if (index < 0) continue;
      entry.pAbilities.push({ abilityType, index, value, haveValue, isaux });
    }
  }
}

/** Build the whole ui_entry config from the compiled pack records. */
export function buildUiEntryConfig(packs: UiEntryPackRecords): UiEntryConfig {
  const renderers = buildRenderers(packs.uiEntryRenderer);

  /* The base file's entries become the template pool. */
  TEMPLATE_LOOKUP = new Map();
  const baseTable = buildEntries(packs.uiEntryBase, [], renderers);
  TEMPLATE_LOOKUP = baseTable;

  /* Now build the full table: base entries (templates) plus ui_entry.txt. */
  const table = buildEntries(packs.uiEntryBase, packs.uiEntry, renderers);
  TEMPLATE_LOOKUP = table;

  bindObjectProperties(table, packs.objectProperty);
  bindPlayerProperties(table, packs.playerProperty);

  const entries = [...table.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { entries, renderers };
}

/* ------------------------------------------------------------------ */
/* Iterator (initialize_ui_entry_iterator + cmp_desc_prio)             */
/* ------------------------------------------------------------------ */

/** Entries with both categories, ordered by descending sortcategory priority. */
function iterateEntries(
  config: UiEntryConfig,
  cat0: string,
  cat1: string,
  sortCategory: string,
): UiEntry[] {
  const selected = config.entries.filter(
    (e) =>
      !e.templateOnly &&
      categoryPriority(e, cat0) !== null &&
      categoryPriority(e, cat1) !== null,
  );
  selected.sort((left, right) => {
    const lp = categoryPriority(left, sortCategory);
    const rp = categoryPriority(right, sortCategory);
    if (lp !== null && rp !== null) {
      if (lp > rp) return -1;
      if (lp < rp) return 1;
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    }
    if (lp !== null) return -1;
    if (rp !== null) return 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
  return selected;
}

/* ------------------------------------------------------------------ */
/* is_ui_entry_for_known_rune (ui-entry.c L591)                        */
/* ------------------------------------------------------------------ */

export function isUiEntryForKnownRune(entry: UiEntry, p: Player): boolean {
  const objKnown = p.objKnown;
  for (const op of entry.objProps) {
    const ind = op.index;
    switch (op.type) {
      case OP_STAT:
      case OP_MOD:
        if ((objKnown.modifiers[ind] ?? 0) === 0) return false;
        break;
      case OP_FLAG:
        if (!objKnown.flags.has(ind)) return false;
        break;
      case OP_IGNORE:
      case OP_RESIST:
      case OP_VULN:
      case OP_IMM:
        if ((objKnown.elInfo[ind]?.resLevel ?? 0) === 0) return false;
        break;
      default:
        return false;
    }
  }
  for (const pa of entry.pAbilities) {
    const ind = pa.index;
    if (pa.abilityType === "player") {
      continue;
    } else if (pa.abilityType === "object") {
      if (!objKnown.flags.has(ind)) return false;
    } else if (pa.abilityType === "element") {
      if ((objKnown.elInfo[ind]?.resLevel ?? 0) === 0) return false;
    } else {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Timed helpers (ui-entry.c)                                          */
/* ------------------------------------------------------------------ */

/** get_timed_modifier_effect (ui-entry.c L1370): fully self-contained. */
function getTimedModifierEffect(p: Player, ind: number): number {
  switch (ind) {
    case OBJ_MOD.BLOWS:
      return p.timed[TMD.BLOODLUST] ? Math.trunc(p.timed[TMD.BLOODLUST]! / 20) : 0;
    case OBJ_MOD.INFRA:
      return p.timed[TMD.SINFRA] ? 5 : 0;
    case OBJ_MOD.SPEED: {
      let result = p.timed[TMD.FAST] || p.timed[TMD.SPRINT] ? 10 : 0;
      if (p.timed[TMD.STONESKIN]) result -= 5;
      if (p.timed[TMD.SLOW]) result -= 10;
      if (p.timed[TMD.TERROR]) result += 10;
      return result;
    }
    case OBJ_MOD.STEALTH:
      return p.timed[TMD.STEALTH] ? 10 : 0;
    default:
      return 0;
  }
}

/** modifier_to_skill (ui-entry.c L1317): only TUNNEL -> digging/20 is live. */
function modifierToSkill(modind: number): { skill: number; num: number; den: number } {
  if (modind === OBJ_MOD.TUNNEL) return { skill: SKILL.DIGGING, num: 1, den: 20 };
  return { skill: -1, num: 1, den: 1 };
}

/* ------------------------------------------------------------------ */
/* compute_ui_entry_values_for_object (ui-entry.c L708)                */
/* ------------------------------------------------------------------ */

/**
 * The per-object combined (val, auxval). obj may be null (NOT_PRESENT). p is
 * used to gate knowledge via p.objKnown. The upstream separate curse-object
 * iteration is deferred (see the ledger); this reads the object's own
 * flags/modifiers/el_info, which already fold in merged curse data in the port.
 */
export function computeObjectValues(
  entry: UiEntry,
  obj: GameObject | null,
  p: Player,
): { val: number; auxval: number } {
  if (!obj || entry.objProps.length === 0) {
    return { val: UI_ENTRY_VALUE_NOT_PRESENT, auxval: UI_ENTRY_VALUE_NOT_PRESENT };
  }
  const combiner = combinerFuncs(entry.combinerIndex);
  const st: CombinerState = { work: null, accum: 0, accumAux: 0 };
  let first = true;
  let anyAux = false;
  let allAux = true;

  for (const op of entry.objProps) {
    const ind = op.index;
    let v = 0;
    let a = 0;

    if (op.isaux) {
      if (entry.flags & ENTRY_FLAG_TIMED_AUX) continue;
      anyAux = true;
    } else {
      allAux = false;
    }

    switch (op.type) {
      case OP_STAT:
      case OP_MOD:
        if ((p.objKnown.modifiers[ind] ?? 0) !== 0 || (obj.modifiers[ind] ?? 0) === 0) {
          v = obj.modifiers[ind] ?? 0;
          if (v && op.haveValue) v = op.value;
        } else {
          v = UI_ENTRY_UNKNOWN_VALUE;
          a = UI_ENTRY_UNKNOWN_VALUE;
        }
        break;
      case OP_FLAG:
        if (p.objKnown.flags.has(ind)) {
          v = obj.flags.has(ind) ? 1 : 0;
          if (v && op.haveValue) v = op.value;
        } else {
          v = UI_ENTRY_UNKNOWN_VALUE;
          a = UI_ENTRY_UNKNOWN_VALUE;
        }
        break;
      case OP_IGNORE:
        if ((p.objKnown.elInfo[ind]?.resLevel ?? 0) !== 0) {
          v = ((obj.elInfo[ind]?.flags ?? 0) & EL_INFO_IGNORE) !== 0 ? 1 : 0;
          if (v && op.haveValue) v = op.value;
        } else {
          v = UI_ENTRY_UNKNOWN_VALUE;
          a = UI_ENTRY_UNKNOWN_VALUE;
        }
        break;
      case OP_RESIST:
      case OP_VULN:
      case OP_IMM:
        if ((p.objKnown.elInfo[ind]?.resLevel ?? 0) !== 0) {
          v = obj.elInfo[ind]?.resLevel ?? 0;
          if (v && op.haveValue) v = op.value;
        } else {
          v = UI_ENTRY_UNKNOWN_VALUE;
          a = UI_ENTRY_UNKNOWN_VALUE;
        }
        break;
      default:
        v = 0;
        break;
    }

    if (v) {
      if (op.isaux) {
        const t = a;
        a = v;
        v = t;
      }
      if (first) {
        combiner.init(v, a, st);
        first = false;
      } else {
        combiner.accum(v, a, st);
      }
    }
  }

  if (!first) combiner.finish(st);
  return {
    val: allAux ? 0 : st.accum,
    auxval: anyAux ? st.accumAux : 0,
  };
}

/* ------------------------------------------------------------------ */
/* compute_ui_entry_values_for_player (ui-entry.c L910)                */
/* ------------------------------------------------------------------ */

/** UiEntryDeps: seams the port does not carry; each defaults per the ledger. */
export interface UiEntryDeps {
  /**
   * player_flags_timed(p) (compute L928): the OF flags contributed by active
   * timed effects. Default: empty (no timed OF-flag dups are ported), except
   * OF_TRAP_IMMUNE which is added here from p->timed[TMD_TRAPSAFE] directly.
   */
  timedObjectFlags?: FlagSet;
  /**
   * get_timed_element_effect(p, elem) (compute L1064): 1 if a timed effect
   * grants a temporary resist to elem. Default () => 0 (temp_resist is not on
   * the ported timed registry).
   */
  timedElementEffect?: (elem: number) => number;
  /**
   * player_has(p, PF_*) (compute L945): whether the player has an intrinsic
   * ability flag. Default reads p.pflags if present, else false.
   */
  playerHas?: (flag: number) => boolean;
}

interface ResolvedUiDeps {
  timedObjectFlags: FlagSet;
  timedElementEffect: (elem: number) => number;
  playerHas: (flag: number) => boolean;
}

export function resolveUiDeps(p: Player, deps: UiEntryDeps): ResolvedUiDeps {
  const timed = deps.timedObjectFlags ?? new FlagSet(OF_SIZE);
  if (p.timed[TMD.TRAPSAFE]) timed.on(OF.TRAP_IMMUNE);
  const pflags = (p as unknown as { pflags?: FlagSet }).pflags;
  return {
    timedObjectFlags: timed,
    timedElementEffect: deps.timedElementEffect ?? (() => 0),
    playerHas: deps.playerHas ?? ((flag: number) => (pflags ? pflags.has(flag) : false)),
  };
}

export function computePlayerValues(
  entry: UiEntry,
  p: Player,
  deps: ResolvedUiDeps,
  cache: { untimed: FlagSet },
): { val: number; auxval: number } {
  const combiner = combinerFuncs(entry.combinerIndex);
  const st: CombinerState = { work: null, accum: 0, accumAux: 0 };
  let first = true;
  const timedAux = (entry.flags & ENTRY_FLAG_TIMED_AUX) !== 0;

  /* init_func for the first contribution, accum_func for the rest (the caller
     order matches the C, where the shape/skill/infra adds are never first). */
  const push = (v0: number, a0: number, isaux: boolean): void => {
    let v = v0;
    let a = a0;
    if (isaux) {
      const t = v;
      v = a;
      a = t;
    }
    if (first) {
      combiner.init(v, a, st);
      first = false;
    } else {
      combiner.accum(v, a, st);
    }
  };

  for (const pa of entry.pAbilities) {
    const ind = pa.index;
    if (timedAux && pa.isaux) continue;

    if (pa.abilityType === "player") {
      if (!deps.playerHas(ind)) continue;
      if (pa.haveValue) {
        push(pa.value, UI_ENTRY_VALUE_NOT_PRESENT, pa.isaux);
      } else {
        /* Special-case abilities that bound no value (uival "special"). */
        if (ind === PF.FAST_SHOT) {
          /* Needs the equipped launcher + KF_SHOOTS_ARROWS; deferred -> 0. */
          push(0, 0, pa.isaux);
        } else if (ind === PF.BRAVERY_30) {
          push(p.lev >= 30 ? 1 : 0, 0, pa.isaux);
        }
      }
    } else if (pa.abilityType === "object") {
      let v = cache.untimed.has(ind) ? 1 : 0;
      let a = timedAux ? (deps.timedObjectFlags.has(ind) ? 1 : 0) : 0;
      push(v, a, pa.isaux);
      /* Shape contribution. */
      const shape = p.shape;
      if (shape) {
        v = shape.flags.has(ind) ? 1 : 0;
        a = 0;
        if (v && p.objKnown.flags.has(ind)) {
          push(v, a, pa.isaux);
        }
      }
    } else if (pa.abilityType === "element") {
      let v = p.race.elInfo[ind]?.resLevel ?? 0;
      let a = timedAux ? deps.timedElementEffect(ind) : 0;
      push(v, a, pa.isaux);
      const shape = p.shape;
      if (shape) {
        v = shape.elInfo[ind]?.resLevel ?? 0;
        a = 0;
        if (v !== 0 && (p.objKnown.elInfo[ind]?.resLevel ?? 0)) {
          push(v, a, pa.isaux);
        }
      }
    }
  }

  /* Stats / modifiers aren't in the ability list; add intrinsic values. */
  for (const op of entry.objProps) {
    const ind = op.index;
    if (op.isaux && timedAux) continue;
    if (op.type === OP_STAT || op.type === OP_MOD) {
      const shape = p.shape;
      let v = shape ? (shape.modifiers[ind] ?? 0) : 0;
      let a = timedAux ? getTimedModifierEffect(p, ind) : 0;
      push(v, a, op.isaux);
      const conv = modifierToSkill(ind);
      if (conv.skill >= 0) {
        v = Math.trunc(((p.race.skills[conv.skill] ?? 0) * conv.num) / conv.den);
        a = 0;
        push(v, a, op.isaux);
      }
      if (ind === OBJ_MOD.INFRA) {
        v = p.race.infravision;
        a = 0;
        push(v, a, op.isaux);
      }
    }
  }

  if (first) {
    return { val: UI_ENTRY_VALUE_NOT_PRESENT, auxval: UI_ENTRY_VALUE_NOT_PRESENT };
  }
  combiner.finish(st);
  return { val: st.accum, auxval: st.accumAux };
}

/* ------------------------------------------------------------------ */
/* Renderer apply DATA (ui-entry-renderers.c)                          */
/* ------------------------------------------------------------------ */

/** One rendered cell: a symbol and its COLOUR_* index. */
export interface UiEntryCell {
  symbol: string;
  color: number;
}

/** convert_vanilla_res_level (ui-entry-renderers.c L549). */
function convertVanillaResLevel(i: number): number {
  if (i === UI_ENTRY_UNKNOWN_VALUE) return 4;
  if (i === UI_ENTRY_VALUE_NOT_PRESENT) return 5;
  if (i === UI_ENTRY_RESIST0_RES_VUL) return 6;
  if (i >= 3) return 3;
  if (i >= 1) return 1;
  if (i <= -1) return 2;
  return 0;
}

const COMBINED_EFFECT_TBL: number[][] = [
  [2, 6, 9, 11, 2, 2, 18],
  [3, 7, 10, 12, 3, 3, 19],
  [4, 8, 4, 13, 4, 4, 20],
  [5, 5, 5, 5, 5, 5, 5],
  [0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [14, 15, 16, 17, 14, 14, 21],
];

const COMBINED_LABEL_TBL: number[][] = [
  [1, 5, 8, 10, 1, 1, 1],
  [2, 6, 9, 11, 2, 2, 2],
  [3, 7, 3, 12, 3, 3, 3],
  [4, 4, 4, 4, 4, 4, 4],
  [1, 5, 8, 10, 1, 1, 1],
  [1, 5, 8, 10, 1, 1, 1],
  [1, 5, 8, 10, 1, 1, 1],
];

/**
 * format_int (ui-entry-renderers.c L462): render an integer into nbuf chars
 * using zero/overflow symbols, optional +1, optional sign. Returns the string.
 */
function formatInt(
  i: number,
  addOne: boolean,
  zero: string,
  overflow: string,
  nonneg: boolean,
  useSign: boolean,
  nbuf: number,
): string {
  const digits = "0123456789+- ";
  const buf = new Array<string>(nbuf).fill("");
  let j = nbuf - 1;
  let quot: number;
  let rem: number;

  if (i === 0 && !addOne) {
    quot = 0;
    rem = 0;
    buf[j] = zero;
  } else {
    quot = Math.trunc(i / 10);
    rem = i % 10;
    if (addOne) {
      rem++;
      if (rem === 10) {
        rem = 0;
        quot++;
      }
    }
    buf[j] = digits[rem]!;
  }
  j--;

  while (quot > 0 && j >= 0) {
    rem = quot % 10;
    quot = Math.trunc(quot / 10);
    buf[j] = digits[rem]!;
    j--;
  }

  if (quot > 0 || (useSign && j === -1)) {
    if (useSign) {
      buf[0] = nonneg ? digits[10]! : digits[11]!;
      j = 1;
    } else {
      j = 0;
    }
    while (j < nbuf) {
      buf[j] = overflow;
      j++;
    }
  } else {
    if (useSign && (i !== 0 || addOne || zero === digits[0])) {
      buf[j] = nonneg ? digits[10]! : digits[11]!;
      j--;
    }
    while (j >= 0) {
      buf[j] = digits[12]!;
      j--;
    }
  }
  return buf.join("");
}

/** Details controlling a render (the char screen always uses these values). */
interface RenderDetails {
  knownRune: boolean;
  alternateColorFirst: boolean;
}

/** The rendered output of one entry row: cells plus the label colour. */
export interface RenderedRow {
  cells: UiEntryCell[];
  labelColor: number;
  labelColorIndex: number;
}

/**
 * ui_entry_renderer_apply (ui-entry-renderers.c L309), DATA half: for each
 * (val, aux) pair produce a cell {symbol, color}, and colour the label by the
 * combined value. The Term drawing (positions, combined cell) is the shell's.
 */
export function applyRenderer(
  renderer: RendererInfo,
  vals: number[],
  auxvals: number[],
  details: RenderDetails,
): RenderedRow {
  const backend = renderer.backendIndex;
  const cells: UiEntryCell[] = [];
  const combiner = combinerFuncs(renderer.combinerIndex);

  const cellColor = (paletteIndex: number, offset: number): number =>
    renderer.colors[paletteIndex + offset] ?? 1;
  const sym = (paletteIndex: number): string => renderer.symbols[paletteIndex] ?? " ";

  if (backend === UI_ENTRY_RENDERER.COMPACT_RESIST_RENDERER_WITH_COMBINED_AUX) {
    let colorOffset = details.alternateColorFirst ? 22 : 0;
    for (let i = 0; i < vals.length; i++) {
      const untimed = convertVanillaResLevel(vals[i]!);
      const timed = convertVanillaResLevel(auxvals[i]!);
      const pi = COMBINED_EFFECT_TBL[untimed]![timed]!;
      cells.push({ symbol: sym(pi), color: cellColor(pi, colorOffset) });
      colorOffset ^= 22;
    }
    const { accum: vc, accumAux: ac } = combiner.vec(vals, auxvals);
    let labelPI = 0;
    if (details.knownRune) {
      labelPI = COMBINED_LABEL_TBL[convertVanillaResLevel(vc)]![convertVanillaResLevel(ac)]!;
    }
    return {
      cells,
      labelColorIndex: labelPI,
      labelColor: renderer.labelColors[labelPI] ?? 1,
    };
  }

  if (backend === UI_ENTRY_RENDERER.COMPACT_FLAG_RENDERER_WITH_COMBINED_AUX) {
    let colorOffset = details.alternateColorFirst ? 5 : 0;
    for (let i = 0; i < vals.length; i++) {
      let pi = 2;
      if (vals[i] === UI_ENTRY_UNKNOWN_VALUE) pi = 0;
      else if (vals[i] === UI_ENTRY_VALUE_NOT_PRESENT) pi = 1;
      else if (vals[i]) pi = 3;
      const av = auxvals[i]!;
      if (av && av !== UI_ENTRY_UNKNOWN_VALUE && av !== UI_ENTRY_VALUE_NOT_PRESENT) {
        if (vals[i] === 0) pi = 4;
      }
      cells.push({ symbol: sym(pi), color: cellColor(pi, colorOffset) });
      colorOffset ^= 5;
    }
    const { accum: vc, accumAux: ac } = combiner.vec(vals, auxvals);
    let labelPI = 1;
    if (!details.knownRune) labelPI = 0;
    else if (vc && vc !== UI_ENTRY_UNKNOWN_VALUE && vc !== UI_ENTRY_VALUE_NOT_PRESENT) labelPI = 2;
    else if (ac && ac !== UI_ENTRY_UNKNOWN_VALUE && ac !== UI_ENTRY_VALUE_NOT_PRESENT) labelPI = 3;
    return { cells, labelColorIndex: labelPI, labelColor: renderer.labelColors[labelPI] ?? 1 };
  }

  if (backend === UI_ENTRY_RENDERER.COMPACT_FLAG_WITH_CANCEL_RENDERER_WITH_COMBINED_AUX) {
    let colorOffset = details.alternateColorFirst ? 11 : 0;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]!;
      const av = auxvals[i]!;
      let pi: number;
      if (v === UI_ENTRY_UNKNOWN_VALUE || av === UI_ENTRY_UNKNOWN_VALUE) pi = 0;
      else if (v === UI_ENTRY_VALUE_NOT_PRESENT && av === UI_ENTRY_VALUE_NOT_PRESENT) pi = 1;
      else if (av === UI_ENTRY_VALUE_NOT_PRESENT || av === 0) {
        if (v === UI_ENTRY_VALUE_NOT_PRESENT || v === 0) pi = 2;
        else if (v > 0) pi = 3;
        else pi = 4;
      } else if (av > 0) {
        if (v === UI_ENTRY_VALUE_NOT_PRESENT || v === 0) pi = 5;
        else if (v > 0) pi = 6;
        else pi = 7;
      } else {
        if (v === UI_ENTRY_VALUE_NOT_PRESENT || v === 0) pi = 8;
        else if (v > 0) pi = 9;
        else pi = 10;
      }
      cells.push({ symbol: sym(pi), color: cellColor(pi, colorOffset) });
      colorOffset ^= 11;
    }
    const { accum: vc, accumAux: ac } = combiner.vec(vals, auxvals);
    let labelPI: number;
    if (!details.knownRune) labelPI = 0;
    else if (vc === UI_ENTRY_VALUE_NOT_PRESENT || vc === UI_ENTRY_UNKNOWN_VALUE || vc === 0) {
      if (ac === UI_ENTRY_VALUE_NOT_PRESENT || ac === UI_ENTRY_UNKNOWN_VALUE || ac === 0) labelPI = 4;
      else if (ac > 0) labelPI = 6;
      else labelPI = 2;
    } else if (vc > 0) {
      if (ac === UI_ENTRY_VALUE_NOT_PRESENT || ac === UI_ENTRY_UNKNOWN_VALUE || ac >= 0) labelPI = 5;
      else labelPI = 3;
    } else labelPI = 1;
    return { cells, labelColorIndex: labelPI, labelColor: renderer.labelColors[labelPI] ?? 1 };
  }

  if (backend === UI_ENTRY_RENDERER.NUMERIC_AS_SIGN_RENDERER_WITH_COMBINED_AUX) {
    let colorOffset = details.alternateColorFirst ? 7 : 0;
    for (let i = 0; i < vals.length; i++) {
      const cst: CombinerState = { work: null, accum: 0, accumAux: 0 };
      combiner.init(vals[i]!, 0, cst);
      combiner.accum(auxvals[i]!, 0, cst);
      combiner.finish(cst);
      let pi: number;
      if (vals[i] === UI_ENTRY_UNKNOWN_VALUE || (vals[i] === 0 && auxvals[i] === UI_ENTRY_UNKNOWN_VALUE)) {
        pi = 0;
      } else if (cst.accum === UI_ENTRY_VALUE_NOT_PRESENT) {
        pi = 1;
      } else {
        pi =
          (cst.accum > 0 ? 5 : cst.accum < 0 ? 8 : 2) +
          (auxvals[i]! > 0 ? 1 : auxvals[i]! < 0 ? 2 : 0);
      }
      cells.push({ symbol: sym(pi), color: cellColor(pi, colorOffset) });
      colorOffset ^= 11;
    }
    const { accum: vc, accumAux: ac } = combiner.vec(vals, auxvals);
    let labelPI: number;
    if (!details.knownRune) labelPI = 0;
    else {
      const cst: CombinerState = { work: null, accum: 0, accumAux: 0 };
      combiner.init(vc, 0, cst);
      combiner.accum(ac, 0, cst);
      combiner.finish(cst);
      if (cst.accum === UI_ENTRY_UNKNOWN_VALUE || cst.accum === UI_ENTRY_VALUE_NOT_PRESENT) labelPI = 1;
      else labelPI = (cst.accum > 0 ? 4 : cst.accum < 0 ? 7 : 1) + (ac > 0 ? 1 : ac < 0 ? 2 : 0);
    }
    return { cells, labelColorIndex: labelPI, labelColor: renderer.labelColors[labelPI] ?? 1 };
  }

  if (backend === UI_ENTRY_RENDERER.NUMERIC_RENDERER_WITH_COMBINED_AUX) {
    const nbuf = renderer.ndigit + (renderer.sign === UI_ENTRY_NO_SIGN ? 0 : 1);
    let colorOffset = details.alternateColorFirst ? 11 : 0;
    for (let i = 0; i < vals.length; i++) {
      const cst: CombinerState = { work: null, accum: 0, accumAux: 0 };
      combiner.init(vals[i]!, 0, cst);
      combiner.accum(auxvals[i]!, 0, cst);
      combiner.finish(cst);
      let pi: number;
      let text: string;
      if (vals[i] === UI_ENTRY_UNKNOWN_VALUE || (vals[i] === 0 && auxvals[i] === UI_ENTRY_UNKNOWN_VALUE)) {
        pi = 0;
        text = formatInt(0, false, sym(0), sym(0), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      } else if (cst.accum === UI_ENTRY_VALUE_NOT_PRESENT) {
        pi = 1;
        text = formatInt(0, false, sym(1), sym(1), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      } else if (cst.accum === 0) {
        pi = auxvals[i]! > 0 ? 3 : auxvals[i]! < 0 ? 4 : 2;
        text = formatInt(0, false, sym(pi), sym(pi), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      } else if (cst.accum > 0) {
        pi = auxvals[i]! > 0 ? 6 : auxvals[i]! < 0 ? 7 : 5;
        text = formatInt(cst.accum, false, sym(2), sym(5), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      } else {
        pi = auxvals[i]! > 0 ? 9 : auxvals[i]! < 0 ? 10 : 8;
        let vv: number;
        let o: boolean;
        if (vals[i] === INT_MIN) {
          vv = -(INT_MIN + 1);
          o = true;
        } else {
          vv = -vals[i]!;
          o = false;
        }
        text = formatInt(vv, o, sym(2), sym(6), false, renderer.sign !== UI_ENTRY_NO_SIGN, nbuf);
      }
      cells.push({ symbol: text, color: cellColor(pi, colorOffset) });
      colorOffset ^= 11;
    }
    const { accum: vc, accumAux: ac } = combiner.vec(vals, auxvals);
    let labelPI: number;
    if (!details.knownRune) labelPI = 0;
    else {
      const cst: CombinerState = { work: null, accum: 0, accumAux: 0 };
      combiner.init(vc, 0, cst);
      combiner.accum(ac, 0, cst);
      combiner.finish(cst);
      if (cst.accum === UI_ENTRY_UNKNOWN_VALUE || cst.accum === UI_ENTRY_VALUE_NOT_PRESENT) labelPI = 1;
      else labelPI = (cst.accum > 0 ? 4 : cst.accum < 0 ? 7 : 1) + (ac > 0 ? 1 : ac < 0 ? 2 : 0);
    }
    return { cells, labelColorIndex: labelPI, labelColor: renderer.labelColors[labelPI] ?? 1 };
  }

  if (backend === UI_ENTRY_RENDERER.NUMERIC_RENDERER_WITH_BOOL_AUX) {
    const nbuf = renderer.ndigit + (renderer.sign === UI_ENTRY_NO_SIGN ? 0 : 1);
    let colorOffset = details.alternateColorFirst ? 8 : 0;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]!;
      const av = auxvals[i]!;
      const auxOn = av !== 0 && av !== UI_ENTRY_UNKNOWN_VALUE && av !== UI_ENTRY_VALUE_NOT_PRESENT;
      let pi: number;
      let text: string;
      if (v === UI_ENTRY_UNKNOWN_VALUE || (v === 0 && av === UI_ENTRY_UNKNOWN_VALUE)) {
        pi = 0;
        text = formatInt(0, false, sym(0), sym(0), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      } else if (v === UI_ENTRY_VALUE_NOT_PRESENT) {
        pi = 1;
        text = formatInt(0, false, sym(1), sym(1), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      } else if (v > 0) {
        pi = auxOn ? 5 : 4;
        text = formatInt(v, false, sym(2), sym(4), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      } else if (v < 0) {
        pi = auxOn ? 7 : 6;
        let vv: number;
        let o: boolean;
        if (v === INT_MIN) {
          vv = -(INT_MIN + 1);
          o = true;
        } else {
          vv = -v;
          o = false;
        }
        text = formatInt(vv, o, sym(2), sym(5), false, renderer.sign !== UI_ENTRY_NO_SIGN, nbuf);
      } else {
        const zerosym = auxOn ? 3 : 2;
        pi = auxOn ? 3 : 2;
        text = formatInt(0, false, sym(zerosym), sym(4), true, renderer.sign === UI_ENTRY_ALWAYS_SIGN, nbuf);
      }
      cells.push({ symbol: text, color: cellColor(pi, colorOffset) });
      colorOffset ^= 8;
    }
    const { accum: vc, accumAux: ac } = combiner.vec(vals, auxvals);
    const acbool = ac !== 0 && ac !== UI_ENTRY_UNKNOWN_VALUE && ac !== UI_ENTRY_VALUE_NOT_PRESENT;
    let labelPI: number;
    if (!details.knownRune) labelPI = 0;
    else if (vc === 0 || vc === UI_ENTRY_UNKNOWN_VALUE || vc === UI_ENTRY_VALUE_NOT_PRESENT)
      labelPI = acbool ? 6 : 5;
    else if (vc > 0) labelPI = acbool ? 2 : 1;
    else labelPI = acbool ? 4 : 3;
    return { cells, labelColorIndex: labelPI, labelColor: renderer.labelColors[labelPI] ?? 1 };
  }

  return { cells, labelColorIndex: 0, labelColor: 1 };
}

/* ------------------------------------------------------------------ */
/* Grid assembly (ui-player.c)                                         */
/* ------------------------------------------------------------------ */

/** One row of a character-screen grid panel. */
export interface UiGridRow {
  /** The concrete ui_entry name (e.g. "resist_ui_compact_0<ACID>"). */
  name: string;
  /** The 6-char label with trailing ':' (resist panels), or "" (stat panel). */
  label: string;
  /** COLOUR_* of the label (coloured by the combined value). */
  labelColor: number;
  /** One cell per equipment slot then the player column. */
  cells: UiEntryCell[];
}

/** One panel: its category key and ordered rows. */
export interface UiGridPanel {
  key: string;
  rows: UiGridRow[];
}

const STAT_MAX = 5;
/** configure_char_sheet region_categories (ui-player.c L187). */
const REGION_CATEGORIES = ["resistances", "abilities", "hindrances", "modifiers"] as const;

function slotObject(state: GameState, slot: number): GameObject | null {
  const handle = state.actor.player.equipment[slot] ?? 0;
  return gearGet(state.gear, handle);
}

/**
 * The label for a resist-panel row: get_ui_entry_label(entry, 6, pad_left) with
 * the null slot overwritten by ':' (configure_char_sheet L252-253).
 */
function resistRowLabel(entry: UiEntry): string {
  return `${getUiEntryLabel(entry, 6, true)}:`;
}

/**
 * characterGrid: the ui-entry grid of the second character screen. Returns the
 * four resist/ability/hindrance/modifier panels (display_player_flag_info ->
 * display_resistance_panel) and the stat-modifier panel (display_player_sust_
 * info). Row ordering matches the priority-sorted ui_entry iterator; each row
 * has its equipment-slot cells then the player cell, and the combined-coloured
 * label. The Term draw half (positions, headers, equippy row) is the shell's.
 */
export function characterGrid(
  state: GameState,
  config: UiEntryConfig,
  deps: UiEntryDeps = {},
): { resistPanels: UiGridPanel[]; statModPanel: UiGridPanel } {
  const p = state.actor.player;
  const bodyCount = p.body.count;
  const rd = resolveUiDeps(p, deps);
  const untimedCache = { untimed: playerFlags(p) };

  const equipment: (GameObject | null)[] = [];
  for (let i = 0; i < bodyCount; i++) equipment.push(slotObject(state, i));

  const renderRow = (
    entry: UiEntry,
    forcePlayerValZero: boolean,
    withLabel: boolean,
  ): UiGridRow => {
    const vals: number[] = [];
    const auxs: number[] = [];
    for (let j = 0; j < bodyCount; j++) {
      const r = computeObjectValues(entry, equipment[j]!, p);
      vals.push(r.val);
      auxs.push(r.auxval);
    }
    const pr = computePlayerValues(entry, p, rd, untimedCache);
    vals.push(forcePlayerValZero ? 0 : pr.val);
    auxs.push(pr.auxval);

    const renderer = config.renderers[entry.rendererIndex - 1];
    const knownRune = withLabel ? isUiEntryForKnownRune(entry, p) : true;
    const rendered = renderer
      ? applyRenderer(renderer, vals, auxs, { knownRune, alternateColorFirst: false })
      : { cells: [], labelColor: 1, labelColorIndex: 0 };
    return {
      name: entry.name,
      label: withLabel ? resistRowLabel(entry) : "",
      labelColor: rendered.labelColor,
      cells: rendered.cells,
    };
  };

  /* Four resist regions (display_resistance_panel per region). */
  const region0Row = 2 + STAT_MAX;
  const resistPanels: UiGridPanel[] = [];
  for (const cat of REGION_CATEGORIES) {
    const iter = iterateEntries(config, "CHAR_SCREEN1", cat, cat);
    /* configure_char_sheet row cap: fit in 24 rows, one blank before prompt. */
    let n = iter.length;
    if (n + 2 + region0Row > 22) n = 20 - region0Row;
    const rows: UiGridRow[] = [];
    for (let i = 0; i < n; i++) rows.push(renderRow(iter[i]!, false, true));
    resistPanels.push({ key: cat, rows });
  }

  /* Stat-modifier panel (display_player_sust_info): stat_mod entries, player
     column shows only the sustain (val forced to 0), no label drawn. */
  const statIter = iterateEntries(config, "CHAR_SCREEN1", "stat_modifiers", "stat_modifiers");
  const nStat = statIter.length > STAT_MAX ? STAT_MAX : statIter.length;
  const statRows: UiGridRow[] = [];
  for (let i = 0; i < nStat; i++) statRows.push(renderRow(statIter[i]!, true, false));

  return { resistPanels, statModPanel: { key: "stat_modifiers", rows: statRows } };
}

/* ------------------------------------------------------------------ */
/* Equip-cmp support (ui-equip-cmp.c initialize_summary /               */
/* compute_player_and_equipment_values): shared plumbing the           */
/* equip-cmp.ts model needs but that lives on the private UiEntry /     */
/* RendererInfo shapes, so it is exposed here rather than duplicated.   */
/* ------------------------------------------------------------------ */

/** initialize_summary's five property categories (L2394), each intersected
 * with category "EQUIPCMP_SCREEN" (the equip-cmp screen's own category tag,
 * distinct from the character screen's "CHAR_SCREEN1"). */
const EQUIPCMP_CATEGORIES = [...REGION_CATEGORIES, "stat_modifiers"] as const;

/** One equip-cmp property category and its ordered (priority-sorted) entries. */
export interface EquipCmpCategory {
  key: (typeof EQUIPCMP_CATEGORIES)[number];
  entries: UiEntry[];
}

/**
 * The equip-cmp screen's property columns (initialize_summary L2434-2469):
 * the same five categories as the character screen's resist/ability/
 * hindrance/modifier/stat-modifier panels, but scoped to "EQUIPCMP_SCREEN"
 * instead of "CHAR_SCREEN1".
 */
export function equipCmpCategories(config: UiEntryConfig): EquipCmpCategory[] {
  return EQUIPCMP_CATEGORIES.map((cat) => ({
    key: cat,
    entries: iterateEntries(config, "EQUIPCMP_SCREEN", cat, cat),
  }));
}

/** get_ui_entry_label(entry, nproplab + 1, true) with nproplab hardwired to 2
 * (ui-equip-cmp.c initialize_summary L2421): the equip-cmp column header. */
export function equipCmpColumnLabel(entry: UiEntry): string {
  return getUiEntryLabel(entry, 3, true);
}

/**
 * compute_player_and_equipment_values's per-property accumulation (ui-equip-
 * cmp.c L2279), condensed to the vectorized form combineValues already uses:
 * combine the player's own value with every equipped item's value for one
 * property entry into the equip-cmp "@" row's single combined (val, auxval).
 * Uses the entry's own (already-resolved) combinerIndex rather than looking
 * it up via the renderer - computePlayerValues does the same (L1323).
 */
export function combineEntryValues(
  entry: UiEntry,
  vals: number[],
  auxs: number[],
): { accum: number; accumAux: number } {
  return combinerFuncs(entry.combinerIndex).vec(vals, auxs);
}
