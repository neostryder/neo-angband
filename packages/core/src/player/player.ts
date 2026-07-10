/**
 * Live player instance, ported from struct player in reference/src/player.h
 * (Angband 4.2.6).
 *
 * This is the savefile-relevant core: stats (birth/cur/max plus the swap map),
 * skills, hitpoints/mana, level/experience, gold, the equipment body with
 * per-slot object handles, the timed-effect array, race/class/shape references,
 * and a minimal upkeep block. UI-only and world-only members of struct player
 * (grid, cave, gear lists, known_state, redraw/update masks, quests) are NOT
 * modelled here; they belong to the world and UI layers.
 *
 * Field names for hitpoints (chp / mhp / chpFrac) and the timed array match
 * what the effects domain's EffectPlayer / HpHolder interfaces expect, so a
 * Player can back those narrow interfaces without adaptation.
 */

import { PY_MAX_LEVEL, SKILL_MAX, STAT_MAX, TMD_MAX } from "./types";
import type { PlayerBody, PlayerClass, PlayerRace, Shape } from "./types";
import { OBJ_MOD_MAX } from "../obj/types";

/**
 * Minimal struct player_upkeep: only the derived counters the headless core
 * needs. The full upkeep (trackees, redraw/update/notice masks, inventory and
 * quiver arrays) is DEFERRED to the world/UI integration.
 */
export interface PlayerUpkeep {
  playing: boolean;
  /** Number of spells available to learn. */
  newSpells: number;
  /** Total weight of carried gear (tenths of a pound). */
  totalWeight: number;
}

/**
 * obj_k: the player's cumulative object-knowledge, i.e. the learned "rune"
 * mask (ported from struct player's obj_k, a struct object used as a knowledge
 * template). Only the modifier runes are modelled so far, because they are the
 * sole input to the REAL-state calc_bonuses gate; flag, element, and combat-
 * bonus knowledge (which upstream also stores here but reads only for the
 * DISPLAYED known_state) join it when the knowledge/display system lands.
 */
export interface PlayerObjectKnowledge {
  /**
   * modifiers[OBJ_MOD_MAX]: 1 if the player has learned this modifier's rune,
   * else 0. calc_bonuses multiplies each equipped item's modifier by this, so
   * a pval bonus is inert until its rune is known. UNKNOWN (all 0) at birth,
   * exactly as upstream (PORT_PLAN.md decision 25).
   */
  modifiers: number[];
}

/** struct player core (player.h), world/UI-only members omitted. */
export interface Player {
  race: PlayerRace;
  cls: PlayerClass;

  /** hitdie sides = r_mhp + c_mhp. */
  hitdie: number;
  /** expfact = r_exp + c_exp. */
  expFactor: number;

  age: number;
  ht: number;
  wt: number;

  au: number;

  maxLev: number;
  lev: number;

  maxExp: number;
  exp: number;
  /** exp_frac (times 2^16). */
  expFrac: number;

  mhp: number;
  chp: number;
  chpFrac: number;

  msp: number;
  csp: number;
  cspFrac: number;

  /** stat_max[STAT_MAX]: current maximal ("natural" ceiling) stats. */
  statMax: number[];
  /** stat_cur[STAT_MAX]: current natural stats. */
  statCur: number[];
  /** stat_map[STAT_MAX]: remap from temporary stat swaps (identity at birth). */
  statMap: number[];
  /** stat_birth[STAT_MAX]: birth natural stats. */
  statBirth: number[];

  /** timed[TMD_MAX]: timed effect durations. */
  timed: Int16Array;

  /** spell_flags[total_spells]: PY_SPELL_ bits (player_spells_init sizes). */
  spellFlags: number[];
  /** spell_order[total_spells]: sidx in learn order (99 = unused slot). */
  spellOrder: number[];

  /** player_hp[PY_MAX_LEVEL]: cumulative hitpoint rolls per level. */
  playerHp: number[];

  /** au_birth, ht_birth, wt_birth: quickstart saved values. */
  auBirth: number;
  htBirth: number;
  wtBirth: number;

  /** Player history text. */
  history: string;

  /** Equipment slots available (copied from the race's body). */
  body: PlayerBody;
  /**
   * Object handle per body slot (0 = empty), length body.count. Real objects
   * live in the object domain; this holds only handles, filled at wield time.
   */
  equipment: number[];

  /**
   * obj_k: learned object-knowledge ("rune") mask. Gates equipment modifiers
   * in calcBonuses; all runes UNKNOWN at birth (PORT_PLAN.md decision 25).
   */
  objKnown: PlayerObjectKnowledge;

  /** Current shape (defaults to "normal"). */
  shape: Shape | null;

  /**
   * Derived level-based skills (calc_bonuses non-equipment part). Computed by
   * calcs.calcSkills; length SKILL_MAX.
   */
  skills: number[];

  upkeep: PlayerUpkeep;
}

/**
 * A zeroed player of the given race/class/body (player_init + player_embody).
 * Stats/HP/level are left at zero for the birth pipeline (birth.ts) to fill;
 * shape defaults to null (the "normal" shape) and every equipment slot empty.
 */
export function blankPlayer(
  race: PlayerRace,
  cls: PlayerClass,
  body: PlayerBody,
): Player {
  return {
    race,
    cls,
    hitdie: 0,
    expFactor: 0,
    age: 0,
    ht: 0,
    wt: 0,
    au: 0,
    maxLev: 1,
    lev: 1,
    maxExp: 0,
    exp: 0,
    expFrac: 0,
    mhp: 0,
    chp: 0,
    chpFrac: 0,
    msp: 0,
    csp: 0,
    cspFrac: 0,
    statMax: new Array<number>(STAT_MAX).fill(0),
    statCur: new Array<number>(STAT_MAX).fill(0),
    statMap: new Array<number>(STAT_MAX).fill(0),
    statBirth: new Array<number>(STAT_MAX).fill(0),
    timed: new Int16Array(TMD_MAX),
    spellFlags: [],
    spellOrder: [],
    playerHp: new Array<number>(PY_MAX_LEVEL).fill(0),
    auBirth: 0,
    htBirth: 0,
    wtBirth: 0,
    history: "",
    body: { name: body.name, count: body.count, slots: body.slots.map((s) => ({ ...s })) },
    equipment: new Array<number>(body.count).fill(0),
    objKnown: { modifiers: new Array<number>(OBJ_MOD_MAX).fill(0) },
    shape: null,
    skills: new Array<number>(SKILL_MAX).fill(0),
    upkeep: { playing: false, newSpells: 0, totalWeight: 0 },
  };
}
