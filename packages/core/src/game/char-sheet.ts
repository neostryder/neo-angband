/**
 * The DATA half of the classic character screen, ported from the panel /
 * stat-table builders of reference/src/ui-player.c (Angband 4.2.6).
 *
 * Upstream get_panel_* builds a `struct panel` of panel_line(attr,label,fmt,..)
 * rows (plus panel_space separators), and display_player_stat_info draws the
 * six stat rows; display_panel / display_player_xtra_info then place them in
 * fixed screen regions. This module ports only the COMPUTATION: for every panel
 * it returns the ordered CharSheetLine rows (label + preformatted value +
 * COLOUR_* attr), and for the stat block it returns the per-STAT StatRow. The
 * terminal draw half - the region layout table (panels[], L849), the left/right
 * column alignment of display_panel, the "Self/RB/CB/EB/Best" column headers of
 * display_player_stat_info, and the history text_out - stays with each shell.
 *
 * A panel_space() separator is kept as an explicit blank line (label "" value
 * "") so row alignment matches upstream, mirroring display.ts's empty-runs
 * philosophy.
 *
 * EXCLUDED (the separate ui-entry.c slice): display_player_flag_info /
 * display_resistance_panel / display_player_sust_info - the resist / ability /
 * sustain grid - all use the ui_entry.c system (compute_ui_entry_values_*,
 * ui_entry_renderer_apply, char_sheet_config from ui_entry.txt) and are NOT
 * ported here; see parity/ledger/ui-player.yaml.
 *
 * struct player / player_state members the port does not carry arrive through
 * CharSheetDeps; each has a documented default and is listed in the ledger.
 */

import {
  COLOUR_DARK,
  COLOUR_GREEN,
  COLOUR_L_BLUE,
  COLOUR_L_GREEN,
  COLOUR_L_RED,
  COLOUR_L_UMBER,
  COLOUR_ORANGE,
  COLOUR_RED,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "../color";
import { TMD } from "../generated";
import { EXTRACT_ENERGY } from "../mon/monster";
import { BTH_PLUS_ADJ } from "../combat/hit";
import { objectToDam, objectToHit } from "../combat/brand-slay";
import { PY_MAX_LEVEL, SKILL, STAT_MAX } from "../player/types";
import { modifyStatValue, player_exp } from "../player/calcs";
import { cnvStat } from "./display";
import type { Player } from "../player/player";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";

/** One computed panel row: a label, its preformatted value, and a COLOUR_*. */
export interface CharSheetLine {
  label: string;
  value: string;
  /** COLOUR_* attribute (see color.ts). */
  color: number;
}

/** One computed panel: its get_panel_* key and its ordered lines. */
export interface CharSheetPanel {
  /** The get_panel_* name minus the "get_panel_" prefix. */
  key: string;
  lines: CharSheetLine[];
}

/** One row of display_player_stat_info: the five columns plus the indicators. */
export interface StatRow {
  /** Lower-case stat key ("str".."con"). */
  key: string;
  /** stat_names[i] / stat_names_reduced[i] (lower-case when drained). */
  label: string;
  /** cnv_stat(stat_max[i]): the natural "Self" value. */
  natural: string;
  /** "%+3d" race->r_adj[i]. */
  raceBonus: string;
  /** "%+3d" class->c_adj[i]. */
  classBonus: string;
  /** "%+3d" state.stat_add[i]. */
  equipBonus: string;
  /** cnv_stat(state.stat_top[i]): the modified "Best" maximum. */
  best: string;
  /** cnv_stat(state.stat_use[i]) when drained, else null. */
  reduced: string | null;
  /** stat_max[i] == 18+100: the "!" natural-maximum indicator. */
  naturalMax: boolean;
  /** stat_cur[i] < stat_max[i]. */
  drained: boolean;
}

/**
 * The struct player / player_state / world members the character screen reads
 * that the port does not carry on GameState, Player or PlayerCombatState. Every
 * field is optional and defaults (in resolveDeps) to the value reproducing a
 * freshly born, headless character; see parity/ledger/ui-player.yaml.
 */
export interface CharSheetDeps {
  /** player->full_name (get_panel_topleft L697). Default "" (not on Player). */
  fullName?: string;
  /** player->resting_turn (get_panel_misc L836). Default 0 (not on the port). */
  restingTurn?: number;
  /**
   * weight_remaining(player) (get_panel_midleft L709): carry capacity left, in
   * tenths of a pound; negative means overweight. Default 0 - calc_bonuses /
   * the encumbrance formula is deferred (player/calcs.ts).
   */
  weightRemaining?: number;
  /** player->state.num_shots (get_panel_combat L773). Default 0. */
  numShots?: number;
  /**
   * player->state.see_infra (get_panel_skills L814). Default
   * player->race->infra - at birth calc_bonuses seeds see_infra from the race.
   */
  seeInfra?: number;
  /**
   * player->state.stat_add[STAT_MAX] (display_player_stat_info L496): the
   * equipment stat bonuses. Default all-zero (no computed player_state; the
   * equipment contribution is deferred like display.ts's statUse).
   */
  statAdd?: readonly number[];
  /**
   * player->state.stat_top[STAT_MAX] (L500): the modified maximum ("Best").
   * Default modify_stat_value(stat_max, race+class adj) - the equipment / timed
   * contributions are deferred.
   */
  statTop?: readonly number[];
  /**
   * player->state.stat_use[STAT_MAX] (L505): the modified current value shown
   * only when drained. Default modify_stat_value(stat_cur, race+class adj).
   */
  statUse?: readonly number[];
  /** OPT(player, effective_speed) (show_speed L671). Default false. */
  effectiveSpeed?: boolean;
  /** player->wizard (show_title L628). Default false (UI/debug member). */
  wizard?: boolean;
  /** player->total_winner (show_title L630). Default false. */
  totalWinner?: boolean;
  /**
   * equipped_item_by_slot_name(player, "weapon") (get_panel_combat L739): the
   * wielded melee weapon, or null. Default state.actor.weapon. Upstream reads
   * obj->known (the rune-gated known item); the port uses the real object, the
   * same known_state deferral display.ts's prt_ac took.
   */
  meleeWeapon?: GameObject | null;
  /**
   * equipped_item_by_slot_name(player, "shooting") (L760): the wielded
   * launcher, or null. Default null - actor carries no launcher accessor.
   */
  launcher?: GameObject | null;
}

/** CharSheetDeps with every default filled in. */
interface ResolvedDeps {
  fullName: string;
  restingTurn: number;
  weightRemaining: number;
  numShots: number;
  seeInfra: number;
  statAdd: readonly number[];
  statTop: readonly number[];
  statUse: readonly number[];
  effectiveSpeed: boolean;
  wizard: boolean;
  totalWinner: boolean;
  meleeWeapon: GameObject | null;
  launcher: GameObject | null;
}

/**
 * Apply only the race + class stat modifiers to a base stat array, matching
 * calc_bonuses when the character wears nothing and carries no timed effect
 * (the same fallback display.ts uses for stat_use).
 */
function defaultStatMod(player: Player, base: readonly number[]): number[] {
  const out = new Array<number>(STAT_MAX).fill(0);
  for (let i = 0; i < STAT_MAX; i++) {
    const add = (player.race.statAdj[i] ?? 0) + (player.cls.statAdj[i] ?? 0);
    out[i] = modifyStatValue(base[i] ?? 0, add);
  }
  return out;
}

function resolveDeps(state: GameState, deps: CharSheetDeps): ResolvedDeps {
  const player = state.actor.player;
  return {
    fullName: deps.fullName ?? "",
    restingTurn: deps.restingTurn ?? 0,
    weightRemaining: deps.weightRemaining ?? 0,
    numShots: deps.numShots ?? 0,
    seeInfra: deps.seeInfra ?? player.race.infravision,
    statAdd: deps.statAdd ?? new Array<number>(STAT_MAX).fill(0),
    statTop: deps.statTop ?? defaultStatMod(player, player.statMax),
    statUse: deps.statUse ?? defaultStatMod(player, player.statCur),
    effectiveSpeed:
      deps.effectiveSpeed ?? state.options?.get("effective_speed") ?? false,
    wizard: deps.wizard ?? false,
    totalWinner: deps.totalWinner ?? false,
    meleeWeapon: deps.meleeWeapon ?? state.actor.weapon,
    launcher: deps.launcher ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Small formatting helpers                                            */
/* ------------------------------------------------------------------ */

/** printf "%+d": a signed decimal with an explicit leading sign. */
function pf(n: number): string {
  return n < 0 ? String(n) : `+${n}`;
}

/** printf "%+3d": "%+d" right-justified into at least three columns. */
function pf3(n: number): string {
  return pf(n).padStart(3, " ");
}

/** A panel_line: label + preformatted value + attr. */
function line(color: number, label: string, value: string): CharSheetLine {
  return { label, value, color };
}

/** A panel_space separator: an explicit blank line (kept for alignment). */
function space(): CharSheetLine {
  return { label: "", value: "", color: COLOUR_DARK };
}

/* ------------------------------------------------------------------ */
/* Panel helpers (ui-player.c)                                         */
/* ------------------------------------------------------------------ */

/** stat_names[STAT_MAX] (ui-display.c L98; shared by display_player_stat_info). */
const STAT_NAMES = ["STR: ", "INT: ", "WIS: ", "DEX: ", "CON: "] as const;
/** stat_names_reduced[STAT_MAX] (ui-display.c L107). */
const STAT_NAMES_REDUCED = ["Str: ", "Int: ", "Wis: ", "Dex: ", "Con: "] as const;
/** Lower-case stat keys, in STAT order. */
const STAT_KEYS = ["str", "int", "wis", "dex", "con"] as const;

/**
 * likert (ui-player.c L274): a "rating" of x depending on y, and its colour.
 * y is floored at 1; a negative x is always "Very Bad"; otherwise the bucket
 * is x / y (integer division).
 */
export function likert(x: number, y: number): { desc: string; color: number } {
  if (y <= 0) y = 1;
  if (x < 0) return { desc: "Very Bad", color: COLOUR_RED };
  switch (Math.trunc(x / y)) {
    case 0:
    case 1:
      return { desc: "Bad", color: COLOUR_RED };
    case 2:
      return { desc: "Poor", color: COLOUR_RED };
    case 3:
    case 4:
      return { desc: "Fair", color: COLOUR_YELLOW };
    case 5:
      return { desc: "Good", color: COLOUR_YELLOW };
    case 6:
      return { desc: "Very Good", color: COLOUR_YELLOW };
    case 7:
    case 8:
      return { desc: "Excellent", color: COLOUR_L_GREEN };
    case 9:
    case 10:
    case 11:
    case 12:
    case 13:
      return { desc: "Superb", color: COLOUR_L_GREEN };
    case 14:
    case 15:
    case 16:
    case 17:
      return { desc: "Heroic", color: COLOUR_L_GREEN };
    default:
      return { desc: "Legendary", color: COLOUR_L_GREEN };
  }
}

/**
 * show_title (ui-player.c L626): wizard, winner, or the class level title.
 * NOTE: unlike ui-display.c's fmt_title there is NO shape branch here.
 */
export function showTitle(player: Player, deps: ResolvedDeps): string {
  if (deps.wizard) return "[=-WIZARD-=]";
  if (deps.totalWinner || player.lev > PY_MAX_LEVEL) return "***WINNER***";
  return player.cls.titles[Math.trunc((player.lev - 1) / 5)] ?? "";
}

/**
 * show_adv_exp (ui-player.c L636): the experience needed to advance, or
 * "********" at the level maximum. advance = player_exp[lev-1] * expfact / 100.
 */
export function showAdvExp(player: Player): string {
  if (player.lev < PY_MAX_LEVEL) {
    const advance = Math.trunc(
      ((player_exp[player.lev - 1] ?? 0) * player.expFactor) / 100,
    );
    return String(advance);
  }
  return "********";
}

/**
 * show_depth (ui-player.c L650): "Town" at max_depth 0, else "<feet>' (L<n>)"
 * using player->max_depth (NOT the live cave depth).
 */
export function showDepth(player: Player): string {
  if (player.maxDepth === 0) return "Town";
  return `${player.maxDepth * 50}' (L${player.maxDepth})`;
}

/**
 * show_speed (ui-player.c L661): applies the TMD_FAST -10 / TMD_SLOW +10
 * adjustment, returns "Normal" at 110, else the multiplier / delta text. With
 * effective_speed the "%d.%dx (%d)" form, otherwise "%d (%d.%dx)".
 */
export function showSpeed(state: GameState, deps: ResolvedDeps): string {
  const player = state.actor.player;
  let tmp = state.actor.speed;
  if (player.timed[TMD.FAST]) tmp -= 10;
  if (player.timed[TMD.SLOW]) tmp += 10;
  if (tmp === 110) return "Normal";
  const cur = EXTRACT_ENERGY[tmp] ?? 0;
  const norm = EXTRACT_ENERGY[110] as number;
  const multiplier = Math.trunc((10 * cur) / norm);
  const intMul = Math.trunc(multiplier / 10);
  const decMul = multiplier % 10;
  return deps.effectiveSpeed
    ? `${intMul}.${decMul}x (${tmp - 110})`
    : `${tmp - 110} (${intMul}.${decMul}x)`;
}

/** max_color (ui-player.c L678): val < max ? YELLOW : L_GREEN. */
export function maxColor(val: number, max: number): number {
  return val < max ? COLOUR_YELLOW : COLOUR_L_GREEN;
}

/**
 * colour_table[] (ui-player.c L686): eleven colours indexed by skill/10 (saving
 * throw, disarm, search) or skill/13 (magic devices).
 */
const COLOUR_TABLE: readonly number[] = [
  COLOUR_RED,
  COLOUR_RED,
  COLOUR_RED,
  COLOUR_L_RED,
  COLOUR_ORANGE,
  COLOUR_YELLOW,
  COLOUR_YELLOW,
  COLOUR_GREEN,
  COLOUR_GREEN,
  COLOUR_L_GREEN,
  COLOUR_L_BLUE,
];

/** MIN(max, MAX(min, x)): the BOUND(x,min,max) macro (get_panel_skills L786). */
function bound(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function skill(state: GameState, idx: number): number {
  return state.actor.combat.skills[idx] ?? 0;
}

/* ------------------------------------------------------------------ */
/* Panel builders (ui-player.c)                                        */
/* ------------------------------------------------------------------ */

/** get_panel_topleft (ui-player.c L694). */
function panelTopleft(state: GameState, deps: ResolvedDeps): CharSheetLine[] {
  const p = state.actor.player;
  return [
    line(COLOUR_L_BLUE, "Name", deps.fullName),
    line(COLOUR_L_BLUE, "Race", p.race.name),
    line(COLOUR_L_BLUE, "Class", p.cls.name),
    line(COLOUR_L_BLUE, "Title", showTitle(p, deps)),
    line(COLOUR_L_BLUE, "HP", `${p.chp}/${p.mhp}`),
    line(COLOUR_L_BLUE, "SP", `${p.csp}/${p.msp}`),
  ];
}

/** get_panel_misc (ui-player.c L826). */
function panelMisc(state: GameState, deps: ResolvedDeps): CharSheetLine[] {
  const p = state.actor.player;
  const attr = COLOUR_L_BLUE;
  return [
    line(attr, "Age", `${p.age}`),
    line(attr, "Height", `${Math.trunc(p.ht / 12)}'${p.ht % 12}"`),
    line(attr, "Weight", `${Math.trunc(p.wt / 14)}st ${p.wt % 14}lb`),
    line(attr, "Turns used:", ""),
    line(attr, "Game", `${state.turn}`),
    line(attr, "Standard", `${Math.trunc(state.actor.totalEnergy / 100)}`),
    line(attr, "Resting", `${deps.restingTurn}`),
  ];
}

/** get_panel_midleft (ui-player.c L707). */
function panelMidleft(state: GameState, deps: ResolvedDeps): CharSheetLine[] {
  const p = state.actor.player;
  const diff = deps.weightRemaining;
  const attr = diff < 0 ? COLOUR_L_RED : COLOUR_L_GREEN;
  return [
    line(maxColor(p.lev, p.maxLev), "Level", `${p.lev}`),
    line(maxColor(p.exp, p.maxExp), "Cur Exp", `${p.exp}`),
    line(COLOUR_L_GREEN, "Max Exp", `${p.maxExp}`),
    line(COLOUR_L_GREEN, "Adv Exp", showAdvExp(p)),
    space(),
    line(COLOUR_L_GREEN, "Gold", `${p.au}`),
    line(attr, "Burden", `${(p.upkeep.totalWeight / 10).toFixed(1)} lb`),
    line(attr, "Overweight", `${Math.trunc(-diff / 10)}.${Math.abs(diff) % 10} lb`),
    line(COLOUR_L_GREEN, "Max Depth", showDepth(p)),
  ];
}

/** get_panel_combat (ui-player.c L728). */
function panelCombat(state: GameState, deps: ResolvedDeps): CharSheetLine[] {
  const c = state.actor.combat;

  /* Melee */
  const melee = deps.meleeWeapon;
  let meleeDice = 1;
  let meleeSides = 1;
  let dam = c.toD;
  let hit = c.toH;
  if (melee) {
    meleeDice = melee.dd;
    meleeSides = melee.ds;
    dam += objectToDam(melee);
    hit += objectToHit(melee);
  }
  if (c.blessWield) hit += 2;
  const bthMelee = Math.trunc((skill(state, SKILL.TO_HIT_MELEE) * 10) / BTH_PLUS_ADJ);

  /* Ranged */
  const launcher = deps.launcher;
  let damR = 0;
  let hitR = c.toH;
  if (launcher) {
    damR += objectToDam(launcher);
    hitR += objectToHit(launcher);
  }
  const bthBow = Math.trunc((skill(state, SKILL.TO_HIT_BOW) * 10) / BTH_PLUS_ADJ);

  return [
    line(COLOUR_L_BLUE, "Armor", `[${c.ac},${pf(c.toA)}]`),
    space(),
    line(COLOUR_L_BLUE, "Melee", `${meleeDice}d${meleeSides},${pf(dam)}`),
    line(COLOUR_L_BLUE, "To-hit", `${Math.trunc(bthMelee / 10)},${pf(hit)}`),
    line(
      COLOUR_L_BLUE,
      "Blows",
      `${Math.trunc(c.numBlows / 100)}.${Math.trunc(c.numBlows / 10) % 10}/turn`,
    ),
    space(),
    line(COLOUR_L_BLUE, "Shoot to-dam", pf(damR)),
    line(COLOUR_L_BLUE, "To-hit", `${Math.trunc(bthBow / 10)},${pf(hitR)}`),
    line(
      COLOUR_L_BLUE,
      "Shots",
      `${Math.trunc(deps.numShots / 10)}.${deps.numShots % 10}/turn`,
    ),
  ];
}

/** get_panel_skills (ui-player.c L778). */
function panelSkills(state: GameState, deps: ResolvedDeps): CharSheetLine[] {
  const p = state.actor.player;
  const depth = state.chunk.depth;
  const lines: CharSheetLine[] = [];

  /* Saving throw */
  let s = bound(skill(state, SKILL.SAVE), 0, 100);
  lines.push(line(COLOUR_TABLE[Math.trunc(s / 10)] ?? COLOUR_WHITE, "Saving Throw", `${s}%`));

  /* Stealth */
  const st = likert(skill(state, SKILL.STEALTH), 1);
  lines.push(line(st.color, "Stealth", st.desc));

  /* Physical disarming (assume a dungeon trap) */
  s = bound(skill(state, SKILL.DISARM_PHYS) - Math.trunc(depth / 5), 2, 100);
  lines.push(line(COLOUR_TABLE[Math.trunc(s / 10)] ?? COLOUR_WHITE, "Disarm - phys.", `${s}%`));

  /* Magical disarming */
  s = bound(skill(state, SKILL.DISARM_MAGIC) - Math.trunc(depth / 5), 2, 100);
  lines.push(line(COLOUR_TABLE[Math.trunc(s / 10)] ?? COLOUR_WHITE, "Disarm - magic", `${s}%`));

  /* Magic devices */
  s = skill(state, SKILL.DEVICE);
  lines.push(line(COLOUR_TABLE[Math.trunc(s / 13)] ?? COLOUR_WHITE, "Magic Devices", `${s}`));

  /* Searching */
  s = bound(skill(state, SKILL.SEARCH), 0, 100);
  lines.push(line(COLOUR_TABLE[Math.trunc(s / 10)] ?? COLOUR_WHITE, "Searching", `${s}%`));

  /* Infravision */
  lines.push(line(COLOUR_L_GREEN, "Infravision", `${deps.seeInfra * 10} ft`));

  /* Speed (attr from the TMD-adjusted net speed, text from show_speed) */
  let sp = state.actor.speed;
  if (p.timed[TMD.FAST]) sp -= 10;
  if (p.timed[TMD.SLOW]) sp += 10;
  const spAttr = sp < 110 ? COLOUR_L_UMBER : COLOUR_L_GREEN;
  lines.push(line(spAttr, "Speed", showSpeed(state, deps)));

  return lines;
}

/**
 * characterPanels: the five panels[] entries (ui-player.c L849) in table order
 * - topleft, misc, midleft, combat, skills. panel_space separators are kept as
 * explicit blank lines so a shell can map line -> screen row faithfully.
 */
export function characterPanels(
  state: GameState,
  deps: CharSheetDeps = {},
): CharSheetPanel[] {
  const d = resolveDeps(state, deps);
  return [
    { key: "topleft", lines: panelTopleft(state, d) },
    { key: "misc", lines: panelMisc(state, d) },
    { key: "midleft", lines: panelMidleft(state, d) },
    { key: "combat", lines: panelCombat(state, d) },
    { key: "skills", lines: panelSkills(state, d) },
  ];
}

/**
 * statTable: the STAT_MAX rows of display_player_stat_info (ui-player.c L449),
 * in STAT order. Each row carries the five columns (Self / RB / CB / EB / Best)
 * plus the drained "reduced" value and the natural-maximum "!" indicator.
 */
export function statTable(
  state: GameState,
  deps: CharSheetDeps = {},
): StatRow[] {
  const d = resolveDeps(state, deps);
  const p = state.actor.player;
  const rows: StatRow[] = [];
  for (let i = 0; i < STAT_MAX; i++) {
    const cur = p.statCur[i] ?? 0;
    const max = p.statMax[i] ?? 0;
    const drained = cur < max;
    rows.push({
      key: STAT_KEYS[i] ?? "",
      label: (drained ? STAT_NAMES_REDUCED[i] : STAT_NAMES[i]) ?? "",
      natural: cnvStat(max),
      raceBonus: pf3(p.race.statAdj[i] ?? 0),
      classBonus: pf3(p.cls.statAdj[i] ?? 0),
      equipBonus: pf3(d.statAdd[i] ?? 0),
      best: cnvStat(d.statTop[i] ?? 0),
      reduced: drained ? cnvStat(d.statUse[i] ?? 0) : null,
      naturalMax: max === 18 + 100,
      drained,
    });
  }
  return rows;
}
