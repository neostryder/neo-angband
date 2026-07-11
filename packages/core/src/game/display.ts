/**
 * The DATA half of the sidebar and status line, ported from the display
 * functions of reference/src/ui-display.c (Angband 4.2.6).
 *
 * Upstream each prt_* handler both COMPUTES a coloured string and DRAWS it
 * with Term_* at a fixed row/column. This module ports only the computation:
 * for every sidebar field and status-line indicator it returns the ordered
 * list of coloured text runs. The terminal draw half - row/column positioning,
 * the inter-indicator gap (each status handler advances col by strlen + 1),
 * the "%-11s" / "%-13s" field padding of prt_speed / prt_depth, and the
 * screen-size priority culling of update_sidebar (L844) - stays with each
 * front-end shell.
 *
 * sidebarModel returns the 18 real fields of side_handlers[] (L810, the four
 * NULL spacer rows are not fields), in table order. statusLineModel returns
 * the 11 entries of status_handlers[] (L1296) in table order. A field or
 * indicator that upstream would draw as blank / return 0 for is represented by
 * an EMPTY runs array rather than being dropped, so the returned order always
 * matches the handler tables and a shell simply skips the empty ones.
 *
 * Seams for the struct player / world members the port does not carry on
 * GameState arrive through DisplayDeps; each has a sensible default and is
 * listed in parity/ledger/ui-display.yaml.
 */

import {
  COLOUR_BLUE,
  COLOUR_DARK,
  COLOUR_GREEN,
  COLOUR_L_BLUE,
  COLOUR_L_DARK,
  COLOUR_L_GREEN,
  COLOUR_L_PURPLE,
  COLOUR_L_RED,
  COLOUR_L_TEAL,
  COLOUR_L_UMBER,
  COLOUR_ORANGE,
  COLOUR_PURPLE,
  COLOUR_RED,
  COLOUR_UMBER,
  COLOUR_VIOLET,
  COLOUR_WHITE,
  COLOUR_YELLOW,
  colorCharToAttr,
} from "../color";
import { MON_TMD, SQUARE, STAT, TMD } from "../generated";
import { nextGrid } from "../world/view";
import { EXTRACT_ENERGY } from "../mon/monster";
import { monsterIsVisible } from "../mon/predicate";
import { PY_MAX_LEVEL, STAT_MAX, TMD_MAX } from "../player/types";
import type { TimedEffect } from "../player/types";
import { modifyStatValue, player_exp, playerHpAttr, playerSpAttr } from "../player/calcs";
import type { Loc } from "../loc";
import type { Player } from "../player/player";
import type { Monster } from "../mon/monster";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";

/** One coloured run of text; color is a COLOUR_* value (see color.ts). */
export interface DisplayRun {
  text: string;
  color: number;
}

/** One computed sidebar field: its handler key and its ordered runs. */
export interface SidebarField {
  /** The side_handlers[] prt_* name minus the "prt_" prefix. */
  key: string;
  runs: DisplayRun[];
}

/** One computed status-line indicator: its handler key and its runs. */
export interface StatusIndicator {
  /** The status_handlers[] prt_* name minus the "prt_" prefix. */
  key: string;
  runs: DisplayRun[];
}

/**
 * The struct player / world / option members the display reads that the port
 * does not carry on GameState, Player or Chunk. Every field is optional and
 * defaults (below, in resolveDeps) to the value that reproduces a freshly born,
 * headless character; see parity/ledger/ui-display.yaml.
 */
export interface DisplayDeps {
  /**
   * op_ptr->hitpoint_warn (0..9), read by player_hp_attr / player_sp_attr.
   * Default 3 (options.c DEFAULT_HITPOINT_WARN / game DEFAULT_HITPOINT_WARN).
   */
  hitpointWarn?: number;
  /** OPT(player, effective_speed): show speed as a multiplier. Default false. */
  effectiveSpeed?: boolean;
  /** OPT(player, birth_feelings): show level feelings. Default true. */
  birthFeelings?: boolean;
  /** z_info->feeling_need (constants.txt world:feeling-need). Default 10. */
  feelingNeed?: number;
  /**
   * timed_effects[] indexed by TMD_* (player/bind.ts). Each entry's grades
   * array is walked by prt_tmd. Default [] (no timed effect is ever named).
   */
  timedEffects?: readonly TimedEffect[];
  /**
   * player->state.stat_use[STAT_MAX]: the current modified stats prt_stat
   * shows. Default derived from Player.statCur with the race + class modifiers
   * only (equipment / timed contributions are DEFERRED - no stored
   * player_state on GameState).
   */
  statUse?: readonly number[];
  /**
   * player->state.num_moves (calc_bonuses), read by prt_moves. Default 0
   * (one move, no display) - PlayerCombatState omits num_moves.
   */
  numMoves?: number;
  /**
   * player->upkeep->health_who: the tracked monster, or null. Default
   * state.healthWho.
   */
  healthWho?: Monster | null;
  /**
   * player->unignoring (prt_unignore, L1282). Default false - struct player's
   * unignoring flag is not carried on the port's Player / upkeep.
   */
  unignoring?: boolean;
  /** player_is_resting(player) (player-util.c L1397). Default false. */
  isResting?: boolean;
  /** player_resting_count(player) = upkeep->resting (L1406). Default 0. */
  restingCount?: number;
  /** cmd_get_nrepeats() (cmd-core.c). Default 0. */
  nRepeats?: number;
  /**
   * player->wizard: the wizard-mode flag (fmt_title, L178). Default false -
   * struct player's wizard/noscore members are UI/debug-only, not on Player.
   */
  wizard?: boolean;
  /** player->total_winner (fmt_title, L180). Default false. */
  totalWinner?: boolean;
  /**
   * player_book_has_unlearned_spells(player) (prt_study, L1235). Default true;
   * the spell-book carry check needs the pack, which is not on GameState.
   */
  bookHasUnlearnedSpells?: boolean;
  /**
   * object_attr(obj): the display colour of a worn item (prt_equippy, L286).
   * Default colorCharToAttr(obj.kind.dAttr) - the flavour-aware / pref x_attr
   * override is a presentation concern each shell supplies.
   */
  objectAttr?: (obj: GameObject) => number;
  /** object_char(obj): the display glyph of a worn item. Default obj.kind.dChar. */
  objectChar?: (obj: GameObject) => string;
}

/** DisplayDeps with every default filled in. */
interface ResolvedDeps {
  hitpointWarn: number;
  effectiveSpeed: boolean;
  birthFeelings: boolean;
  feelingNeed: number;
  timedEffects: readonly TimedEffect[];
  statUse: readonly number[];
  numMoves: number;
  healthWho: Monster | null;
  unignoring: boolean;
  isResting: boolean;
  restingCount: number;
  nRepeats: number;
  wizard: boolean;
  totalWinner: boolean;
  bookHasUnlearnedSpells: boolean;
  objectAttr: (obj: GameObject) => number;
  objectChar: (obj: GameObject) => string;
}

/**
 * player->state.stat_use fallback: apply only the race + class stat modifiers
 * to stat_cur (modify_stat_value), matching calc_bonuses when the character
 * wears nothing and carries no timed effect.
 */
function defaultStatUse(player: Player): number[] {
  const out = new Array<number>(STAT_MAX).fill(0);
  for (let i = 0; i < STAT_MAX; i++) {
    const add = (player.race.statAdj[i] ?? 0) + (player.cls.statAdj[i] ?? 0);
    out[i] = modifyStatValue(player.statCur[i] ?? 0, add);
  }
  return out;
}

function resolveDeps(state: GameState, deps: DisplayDeps): ResolvedDeps {
  const player = state.actor.player;
  return {
    hitpointWarn: deps.hitpointWarn ?? state.options?.hitpointWarn ?? 3,
    effectiveSpeed:
      deps.effectiveSpeed ?? state.options?.get("effective_speed") ?? false,
    birthFeelings:
      deps.birthFeelings ?? state.options?.get("birth_feelings") ?? true,
    feelingNeed: deps.feelingNeed ?? 10,
    timedEffects: deps.timedEffects ?? [],
    statUse: deps.statUse ?? defaultStatUse(player),
    numMoves: deps.numMoves ?? 0,
    healthWho: deps.healthWho ?? state.healthWho ?? null,
    unignoring: deps.unignoring ?? false,
    isResting: deps.isResting ?? false,
    restingCount: deps.restingCount ?? 0,
    nRepeats: deps.nRepeats ?? 0,
    wizard: deps.wizard ?? false,
    totalWinner: deps.totalWinner ?? false,
    bookHasUnlearnedSpells: deps.bookHasUnlearnedSpells ?? true,
    objectAttr:
      deps.objectAttr ?? ((obj) => colorCharToAttr(obj.kind.dAttr)),
    objectChar: deps.objectChar ?? ((obj) => obj.kind.dChar),
  };
}

/* ------------------------------------------------------------------ */
/* Small formatting helpers                                            */
/* ------------------------------------------------------------------ */

/** printf "%<width>d": right-justify a base-ten integer, space-padded. */
function rjust(value: number, width: number): string {
  return String(value).padStart(width, " ");
}

/** my_strcap: capitalise the first character. */
function strcap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * cnv_stat (ui-display.c L115): a modified stat value as a six-char, right-
 * justified string. Values over 18 use the "18/NN" encoding.
 */
export function cnvStat(val: number): string {
  if (val > 18) {
    const bonus = val - 18;
    if (bonus >= 220) return "18/***";
    if (bonus >= 100) return `18/${String(bonus).padStart(3, "0")}`;
    return ` 18/${String(bonus).padStart(2, "0")}`;
  }
  return `    ${rjust(val, 2)}`;
}

/**
 * fmt_title (ui-display.c L173), short_mode == false: the character title -
 * wizard, winner, shape name, or the class level title. Returns "" only if a
 * shape has an empty name (never in stock data).
 */
export function fmtTitle(player: Player, deps: ResolvedDeps): string {
  if (deps.wizard) return "[=-WIZARD-=]";
  if (deps.totalWinner || player.lev > PY_MAX_LEVEL) return "***WINNER***";
  if (playerIsShapechanged(player)) return strcap(player.shape?.name ?? "");
  const idx = Math.trunc((player.lev - 1) / 5);
  return player.cls.titles[idx] ?? "";
}

/** player_is_shapechanged (player-util.c L1065): a non-"normal" shape. */
function playerIsShapechanged(player: Player): boolean {
  return player.shape !== null && player.shape.name !== "normal";
}

/**
 * fmt_depth (ui-display.c L519): "Town" at depth 0, else "<feet>' (L<depth>)".
 * The port's current depth is the live chunk depth (upstream player->depth ==
 * cave->depth).
 */
export function fmtDepth(depth: number): string {
  if (!depth) return "Town";
  return `${depth * 50}' (L${depth})`;
}

/**
 * prt_speed_aux (ui-display.c L475): the speed label ("Fast" / "Slow") and its
 * colour, or an empty string at normal speed (110). With effectiveSpeed the
 * "(%d.%dx)" multiplier form is used, otherwise the "(%+d)" delta form.
 */
export function prtSpeedAux(
  speed: number,
  effectiveSpeed: boolean,
): { text: string; color: number } {
  let color = COLOUR_WHITE;
  let type: string | null = null;
  if (speed > 110) {
    color = COLOUR_L_GREEN;
    type = "Fast";
  } else if (speed < 110) {
    color = COLOUR_L_UMBER;
    type = "Slow";
  }
  if (!type) return { text: "", color };
  if (!effectiveSpeed) {
    const delta = speed - 110;
    return { text: `${type} (${delta >= 0 ? "+" : ""}${delta})`, color };
  }
  const norm = EXTRACT_ENERGY[110] as number;
  const cur = EXTRACT_ENERGY[Math.min(Math.max(speed, 0), EXTRACT_ENERGY.length - 1)] as number;
  const multiplier = Math.trunc((10 * cur) / norm);
  const intMul = Math.trunc(multiplier / 10);
  const decMul = multiplier % 10;
  return { text: `${type} (${intMul}.${decMul}x)`, color };
}

/**
 * monster_health_attr (ui-display.c L365): the colour of a tracked monster's
 * health bar. `image` is whether the player is hallucinating (TMD_IMAGE).
 */
export function monsterHealthAttr(mon: Monster | null, image: boolean): number {
  if (!mon) return COLOUR_DARK;
  if (!monsterIsVisible(mon) || mon.hp < 0 || image) return COLOUR_WHITE;

  let attr = COLOUR_RED;
  const pct = Math.trunc((100 * mon.hp) / mon.maxhp);
  if (pct >= 10) attr = COLOUR_L_RED;
  if (pct >= 25) attr = COLOUR_ORANGE;
  if (pct >= 60) attr = COLOUR_YELLOW;
  if (pct >= 100) attr = COLOUR_L_GREEN;
  if (mon.mTimed[MON_TMD.FEAR]) attr = COLOUR_VIOLET;
  if (mon.mTimed[MON_TMD.DISEN]) attr = COLOUR_L_UMBER;
  if (mon.mTimed[MON_TMD.COMMAND]) attr = COLOUR_L_PURPLE;
  if (mon.mTimed[MON_TMD.CONF]) attr = COLOUR_UMBER;
  if (mon.mTimed[MON_TMD.STUN]) attr = COLOUR_L_BLUE;
  if (mon.mTimed[MON_TMD.SLEEP]) attr = COLOUR_BLUE;
  if (mon.mTimed[MON_TMD.HOLD]) attr = COLOUR_BLUE;
  return attr;
}

/* ------------------------------------------------------------------ */
/* Sidebar (side_handlers[], ui-display.c L810)                        */
/* ------------------------------------------------------------------ */

/** stat_names[STAT_MAX] (ui-display.c L98). */
const STAT_NAMES = ["STR: ", "INT: ", "WIS: ", "DEX: ", "CON: "] as const;
/** stat_names_reduced[STAT_MAX] (ui-display.c L107). */
const STAT_NAMES_REDUCED = ["Str: ", "Int: ", "Wis: ", "Dex: ", "Con: "] as const;

/** prt_field text as a single COLOUR_L_BLUE run, or empty runs when blank. */
function field(text: string): DisplayRun[] {
  return text ? [{ text, color: COLOUR_L_BLUE }] : [];
}

/** prt_stat (ui-display.c L153) for one stat index. */
function statRuns(player: Player, stat: number, deps: ResolvedDeps): DisplayRun[] {
  const cur = player.statCur[stat] ?? 0;
  const max = player.statMax[stat] ?? 0;
  const drained = cur < max;
  let label = drained
    ? STAT_NAMES_REDUCED[stat] ?? ""
    : STAT_NAMES[stat] ?? "";
  /* Natural maximum indicator: put_str("!", col + 3) overwrites the label's
     fourth character (L169). */
  if (max === 18 + 100) {
    label = label.slice(0, 3) + "!" + label.slice(4);
  }
  const value = cnvStat(deps.statUse[stat] ?? 0);
  return [
    { text: label, color: COLOUR_WHITE },
    { text: value, color: drained ? COLOUR_YELLOW : COLOUR_L_GREEN },
  ];
}

/** prt_level (ui-display.c L207). */
function levelRuns(player: Player): DisplayRun[] {
  const value = rjust(player.lev, 6);
  const atMax = player.lev >= player.maxLev;
  return [
    { text: atMax ? "LEVEL " : "Level ", color: COLOUR_WHITE },
    { text: value, color: atMax ? COLOUR_L_GREEN : COLOUR_YELLOW },
  ];
}

/** prt_exp (ui-display.c L226). */
function expRuns(player: Player): DisplayRun[] {
  const levMax = player.lev === PY_MAX_LEVEL;
  let xp = player.exp;
  if (!levMax) {
    const base = player_exp[player.lev - 1] ?? 0;
    xp = Math.trunc((base * player.expFactor) / 100) - player.exp;
  }
  const value = rjust(xp, 8);
  const atMax = player.exp >= player.maxExp;
  const label = levMax ? (atMax ? "EXP" : "Exp") : atMax ? "NXT" : "Nxt";
  return [
    { text: label, color: COLOUR_WHITE },
    { text: value, color: atMax ? COLOUR_L_GREEN : COLOUR_YELLOW },
  ];
}

/** prt_gold (ui-display.c L256). */
function goldRuns(player: Player): DisplayRun[] {
  return [
    { text: "AU ", color: COLOUR_WHITE },
    { text: rjust(player.au, 9), color: COLOUR_L_GREEN },
  ];
}

/** prt_equippy (ui-display.c L269): one single-char run per body slot. */
function equippyRuns(state: GameState, deps: ResolvedDeps): DisplayRun[] {
  const player = state.actor.player;
  const runs: DisplayRun[] = [];
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    const obj = state.gear.store.get(handle) ?? null;
    if (obj) {
      runs.push({ text: deps.objectChar(obj), color: deps.objectAttr(obj) });
    } else {
      runs.push({ text: " ", color: COLOUR_WHITE });
    }
  }
  return runs;
}

/** prt_ac (ui-display.c L301): "Cur AC " + (ac + to_a). */
function acRuns(state: GameState): DisplayRun[] {
  const c = state.actor.combat;
  return [
    { text: "Cur AC ", color: COLOUR_WHITE },
    { text: rjust(c.ac + c.toA, 5), color: COLOUR_L_GREEN },
  ];
}

/** prt_hp (ui-display.c L314). */
function hpRuns(player: Player, deps: ResolvedDeps): DisplayRun[] {
  return [
    { text: "HP ", color: COLOUR_WHITE },
    { text: rjust(player.chp, 4), color: playerHpAttr(player, deps.hitpointWarn) },
    { text: "/", color: COLOUR_WHITE },
    { text: rjust(player.mhp, 4), color: COLOUR_L_GREEN },
  ];
}

/** prt_sp (ui-display.c L332): empty unless the class has mana at this level. */
function spRuns(player: Player, deps: ResolvedDeps): DisplayRun[] {
  const magic = player.cls.magic;
  if (!magic.totalSpells || player.lev < magic.spellFirst) {
    /* An experience-drain clear (L344) leaves the field blank either way. */
    return [];
  }
  return [
    { text: "SP ", color: COLOUR_WHITE },
    { text: rjust(player.csp, 4), color: playerSpAttr(player, deps.hitpointWarn) },
    { text: "/", color: COLOUR_WHITE },
    { text: rjust(player.msp, 4), color: COLOUR_L_GREEN },
  ];
}

/** prt_health / prt_health_aux (ui-display.c L425). */
function healthRuns(player: Player, deps: ResolvedDeps): DisplayRun[] {
  const mon = deps.healthWho;
  if (!mon) return [];
  const image = (player.timed[TMD.IMAGE] ?? 0) > 0;
  const attr = monsterHealthAttr(mon, image);
  if (!monsterIsVisible(mon) || image || mon.hp < 0) {
    return [{ text: "[----------]", color: attr }];
  }
  const pct = Math.trunc((100 * mon.hp) / mon.maxhp);
  const len = pct < 10 ? 1 : pct < 90 ? Math.trunc(pct / 10) + 1 : 10;
  const runs: DisplayRun[] = [{ text: "[", color: COLOUR_WHITE }];
  if (len > 0) runs.push({ text: "*".repeat(len), color: attr });
  if (len < 10) runs.push({ text: "-".repeat(10 - len), color: COLOUR_WHITE });
  runs.push({ text: "]", color: COLOUR_WHITE });
  return runs;
}

/** prt_speed (ui-display.c L508). */
function speedRuns(state: GameState, deps: ResolvedDeps): DisplayRun[] {
  const s = prtSpeedAux(state.actor.speed, deps.effectiveSpeed);
  return s.text ? [{ text: s.text, color: s.color }] : [];
}

/** prt_depth (ui-display.c L532). */
function depthRuns(state: GameState): DisplayRun[] {
  return [{ text: fmtDepth(state.chunk.depth), color: COLOUR_WHITE }];
}

/**
 * sidebarModel: the 18 real side_handlers[] fields in table order (the four
 * NULL spacer rows are not represented). update_sidebar's priority culling is
 * a draw-half concern each shell applies.
 */
export function sidebarModel(
  state: GameState,
  deps: DisplayDeps = {},
): SidebarField[] {
  const d = resolveDeps(state, deps);
  const player = state.actor.player;
  const shape = playerIsShapechanged(player);
  return [
    { key: "race", runs: field(shape ? "" : player.race.name) },
    { key: "title", runs: field(fmtTitle(player, d)) },
    { key: "class", runs: field(shape ? "" : player.cls.name) },
    { key: "level", runs: levelRuns(player) },
    { key: "exp", runs: expRuns(player) },
    { key: "gold", runs: goldRuns(player) },
    { key: "equippy", runs: equippyRuns(state, d) },
    { key: "str", runs: statRuns(player, STAT.STR, d) },
    { key: "int", runs: statRuns(player, STAT.INT, d) },
    { key: "wis", runs: statRuns(player, STAT.WIS, d) },
    { key: "dex", runs: statRuns(player, STAT.DEX, d) },
    { key: "con", runs: statRuns(player, STAT.CON, d) },
    { key: "ac", runs: acRuns(state) },
    { key: "hp", runs: hpRuns(player, d) },
    { key: "sp", runs: spRuns(player, d) },
    { key: "health", runs: healthRuns(player, d) },
    { key: "speed", runs: speedRuns(state, d) },
    { key: "depth", runs: depthRuns(state) },
  ];
}

/* ------------------------------------------------------------------ */
/* Status line (status_handlers[], ui-display.c L1296)                 */
/* ------------------------------------------------------------------ */

/** obj_feeling_color[] (ui-display.c L1019). */
const OBJ_FEELING_COLOR = [
  COLOUR_WHITE,
  COLOUR_L_PURPLE,
  COLOUR_L_RED,
  COLOUR_ORANGE,
  COLOUR_YELLOW,
  COLOUR_YELLOW,
  COLOUR_L_GREEN,
  COLOUR_L_GREEN,
  COLOUR_L_GREEN,
  COLOUR_L_BLUE,
  COLOUR_L_BLUE,
] as const;

/** mon_feeling_color[] (ui-display.c L1035). */
const MON_FEELING_COLOR = [
  COLOUR_WHITE,
  COLOUR_RED,
  COLOUR_ORANGE,
  COLOUR_ORANGE,
  COLOUR_YELLOW,
  COLOUR_YELLOW,
  COLOUR_GREEN,
  COLOUR_GREEN,
  COLOUR_BLUE,
  COLOUR_BLUE,
] as const;

/** prt_level_feeling (ui-display.c L1053). */
function levelFeelingRuns(state: GameState, deps: ResolvedDeps): DisplayRun[] {
  if (!deps.birthFeelings) return [];
  const depth = state.chunk.depth;
  if (!depth) return [];

  const objFeeling = Math.trunc(state.chunk.feeling / 10);
  const monFeeling = state.chunk.feeling - 10 * objFeeling;

  let objStr: string;
  let objColor: number;
  if (state.chunk.feelingSquares < deps.feelingNeed) {
    objStr = "?";
    objColor = COLOUR_WHITE;
  } else {
    objColor = OBJ_FEELING_COLOR[objFeeling] ?? COLOUR_WHITE;
    if (objFeeling === 0) objStr = "*";
    else if (objFeeling === 1) objStr = "$";
    else objStr = String(11 - objFeeling);
  }

  const monStr = monFeeling === 0 ? "?" : String(10 - monFeeling);
  const monColor = MON_FEELING_COLOR[monFeeling] ?? COLOUR_WHITE;

  return [
    { text: "LF:", color: COLOUR_WHITE },
    { text: monStr, color: monColor },
    { text: "-", color: COLOUR_WHITE },
    { text: objStr, color: objColor },
  ];
}

/** prt_light (ui-display.c L1129). */
function lightRuns(state: GameState): DisplayRun[] {
  const light = state.chunk.light(state.actor.grid);
  return [
    {
      text: `Light ${light} `,
      color: light > 0 ? COLOUR_YELLOW : COLOUR_PURPLE,
    },
  ];
}

/** prt_moves (ui-display.c L1145). */
function movesRuns(deps: ResolvedDeps): DisplayRun[] {
  const i = deps.numMoves;
  if (i > 0) return [{ text: `Moves +${i} `, color: COLOUR_L_TEAL }];
  if (i < 0) return [{ text: `Moves -${Math.abs(i)} `, color: COLOUR_L_TEAL }];
  return [];
}

/** prt_unignore (ui-display.c L1280). */
function unignoreRuns(deps: ResolvedDeps): DisplayRun[] {
  return deps.unignoring
    ? [{ text: "Unignoring", color: COLOUR_WHITE }]
    : [];
}

/** prt_recall (ui-display.c L925). */
function recallRuns(player: Player): DisplayRun[] {
  return player.wordRecall
    ? [{ text: "Recall", color: COLOUR_WHITE }]
    : [];
}

/** prt_descent (ui-display.c L939). */
function descentRuns(player: Player): DisplayRun[] {
  return player.deepDescent
    ? [{ text: "Descent", color: COLOUR_WHITE }]
    : [];
}

/** I2D: a decimal digit as its character (util.c). */
function i2d(n: number): string {
  return String.fromCharCode("0".charCodeAt(0) + n);
}

/**
 * prt_state (ui-display.c L957): "Rest" plus a ten-char count field, or the
 * repeat count. The rest field is always exactly ten characters wide.
 */
function stateRuns(deps: ResolvedDeps): DisplayRun[] {
  let text = "";
  if (deps.isResting) {
    const n = deps.restingCount;
    /* "Rest" followed by six spaces (a ten-char field). */
    const t = "Rest      ".split("");
    if (n >= 1000) {
      let i = Math.trunc(n / 100);
      t[9] = "0";
      t[8] = "0";
      t[7] = i2d(i % 10);
      if (i >= 10) {
        i = Math.trunc(i / 10);
        t[6] = i2d(i % 10);
        if (i >= 10) t[5] = i2d(Math.trunc(i / 10));
      }
    } else if (n >= 100) {
      let i = n;
      t[9] = i2d(i % 10);
      i = Math.trunc(i / 10);
      t[8] = i2d(i % 10);
      t[7] = i2d(Math.trunc(i / 10));
    } else if (n >= 10) {
      t[9] = i2d(n % 10);
      t[8] = i2d(Math.trunc(n / 10));
    } else if (n > 0) {
      t[9] = i2d(n);
    } else if (n === -1) {
      /* REST_ALL_POINTS (player-util.h L54). */
      t[5] = t[6] = t[7] = t[8] = t[9] = "*";
    } else if (n === -2) {
      /* REST_COMPLETE (player-util.h L53). */
      t[5] = t[6] = t[7] = t[8] = t[9] = "&";
    } else if (n === -3) {
      /* REST_SOME_POINTS (player-util.h L55). */
      t[5] = t[6] = t[7] = t[8] = t[9] = "!";
    }
    text = t.join("");
  } else if (deps.nRepeats) {
    const n = deps.nRepeats;
    text =
      n > 999
        ? `Rep. ${rjust(Math.trunc(n / 100), 3)}00`
        : `Repeat ${rjust(n, 3)}`;
  }
  return text ? [{ text, color: COLOUR_WHITE }] : [];
}

/** prt_study (ui-display.c L1226). */
function studyRuns(player: Player, deps: ResolvedDeps): DisplayRun[] {
  const n = player.upkeep.newSpells;
  if (!n) return [];
  const color = deps.bookHasUnlearnedSpells ? COLOUR_WHITE : COLOUR_L_DARK;
  return [{ text: `Study (${n})`, color }];
}

/**
 * prt_tmd (ui-display.c L1251): walk every active timed effect to the grade
 * whose max covers the current duration, and emit its name (and, for
 * TMD_FOOD, the percentage meter). Each named piece carries a trailing space,
 * reproducing upstream's "len += strlen + 1" internal spacing.
 */
function tmdRuns(player: Player, deps: ResolvedDeps): DisplayRun[] {
  const runs: DisplayRun[] = [];
  for (let i = 0; i < TMD_MAX; i++) {
    const dur = player.timed[i] ?? 0;
    if (!dur) continue;
    const effect = deps.timedEffects[i];
    if (!effect) continue;
    const grades = effect.grades;
    let k = 0;
    while (k < grades.length - 1 && dur > (grades[k] as { max: number }).max) {
      k++;
    }
    const grade = grades[k];
    if (!grade || grade.name === null) continue;
    runs.push({ text: `${grade.name} `, color: grade.color });
    if (i === TMD.FOOD) {
      runs.push({ text: `${Math.trunc(dur / 100)} % `, color: grade.color });
    }
  }
  return runs;
}

/** prt_dtrap (ui-display.c L1207). */
function dtrapRuns(state: GameState): DisplayRun[] {
  const grid = state.actor.grid;
  if (!squareIsDtrap(state, grid)) return [];
  const color = squareDtrapEdge(state, grid) ? COLOUR_YELLOW : COLOUR_L_GREEN;
  return [{ text: "DTrap ", color }];
}

/** square_isdtrap (cave-square.c L570). */
function squareIsDtrap(state: GameState, grid: Loc): boolean {
  return state.chunk.sqinfoHas(grid, SQUARE.DTRAP);
}

/** square_dtrap_edge (cave-square.c L841): a dtrap grid bordering a non-dtrap. */
function squareDtrapEdge(state: GameState, grid: Loc): boolean {
  if (!squareIsDtrap(state, grid)) return false;
  const c = state.chunk;
  /* Keypad DIR_S/E/N/W = 2/6/8/4 (next_grid). */
  for (const dir of [2, 6, 8, 4]) {
    const g = nextGrid(grid, dir);
    if (c.inBoundsFully(g) && !squareIsDtrap(state, g)) return true;
  }
  return false;
}

/**
 * prt_terrain (ui-display.c L1184): the player's trap (unless invisible) or
 * feature name, capitalised, in its display colour, with a trailing space.
 */
function terrainRuns(state: GameState): DisplayRun[] {
  const grid = state.actor.grid;
  const idx = grid.y * state.chunk.width + grid.x;
  const trap = state.traps.get(idx)?.[0] ?? null;
  let name: string;
  let color: number;
  if (trap && !state.chunk.sqinfoHas(grid, SQUARE.INVIS)) {
    name = trap.kind.name;
    color = colorCharToAttr(trap.kind.color);
  } else {
    const feat = state.chunk.feature(grid);
    name = feat.name;
    color = colorCharToAttr(feat.dAttr);
  }
  return [{ text: `${strcap(name)} `, color }];
}

/**
 * statusLineModel: the 11 status_handlers[] indicators in table order. An
 * indicator upstream returns 0 for is represented by an empty runs array
 * (shells skip it). The inter-indicator gap (col += return + 1) is a draw-half
 * concern.
 */
export function statusLineModel(
  state: GameState,
  deps: DisplayDeps = {},
): StatusIndicator[] {
  const d = resolveDeps(state, deps);
  const player = state.actor.player;
  return [
    { key: "level_feeling", runs: levelFeelingRuns(state, d) },
    { key: "light", runs: lightRuns(state) },
    { key: "moves", runs: movesRuns(d) },
    { key: "unignore", runs: unignoreRuns(d) },
    { key: "recall", runs: recallRuns(player) },
    { key: "descent", runs: descentRuns(player) },
    { key: "state", runs: stateRuns(d) },
    { key: "study", runs: studyRuns(player, d) },
    { key: "tmd", runs: tmdRuns(player, d) },
    { key: "dtrap", runs: dtrapRuns(state) },
    { key: "terrain", runs: terrainRuns(state) },
  ];
}
