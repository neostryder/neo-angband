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
import { newElemInfo, newOfFlags, OBJ_MOD_MAX } from "../obj/types";
import type { ElementInfo } from "../obj/types";
import type { FlagSet } from "../bitflag";
import type { HistoryInfo } from "./history";

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
 * template). Every rune variety is modelled: the modifier runes gate real play
 * (calc_bonuses multiplies equipped modifiers by them), while the element, flag,
 * brand, slay and curse runes are learned by use exactly as upstream
 * (obj-knowledge.c) and will additionally feed the DISPLAYED known_state when
 * the display system lands. Most runes are UNKNOWN at birth; the exceptions,
 * all set at birth exactly as upstream, are the racial innates
 * (player_learn_innate), the dice/ac runes (obvious knowledge from
 * player_outfit) and the three combat runes to_a/to_h/to_d, which
 * do_cmd_accept_character marks known unconditionally ("Hack - player knows all
 * combat runes", player-birth.c L1264-1267), so their learn-by-use paths are
 * vestigial in real play.
 */
export interface PlayerObjectKnowledge {
  /**
   * modifiers[OBJ_MOD_MAX]: 1 if the player has learned this modifier's rune,
   * else 0. calc_bonuses multiplies each equipped item's modifier by this, so
   * a pval bonus is inert until its rune is known. UNKNOWN (all 0) at birth,
   * exactly as upstream (PORT_PLAN.md decision 25).
   */
  modifiers: number[];
  /**
   * obj_k->to_a / to_h / to_d: the three combat runes (0 or 1). Like dd/ds/ac
   * these are NOT learned by use in real play: do_cmd_accept_character sets all
   * three to 1 at birth ("Hack - player knows all combat runes", player-birth.c
   * L1264-1267), so an item's +to-hit/+to-dam/+AC show even when unidentified.
   */
  toA: number;
  toH: number;
  toD: number;
  /**
   * obj_k->dd / ds / ac: the "know dice" / "know ac" runes (0 or 1). Unlike the
   * combat runes these are NOT learned by use - player_outfit (player-birth.c
   * L584-596) gives them as obvious object knowledge at birth, so they are
   * ALWAYS 1. object_set_base_known / player_know_object multiply the object's
   * base dd/ds/ac by them (obj-knowledge.c L830-838, L1039-1041), so base
   * damage dice and armour of even an unidentified item are known from the start.
   */
  dd: number;
  ds: number;
  ac: number;
  /** obj_k->el_info[ELEM_MAX]: resLevel 1 = element rune known. */
  elInfo: ElementInfo[];
  /** obj_k->flags: OF_* rune knowledge. */
  flags: FlagSet;
  /** obj_k->brands[]: known brands by brand index (0 unused). */
  brands: boolean[];
  /** obj_k->slays[]: known slays by slay index (0 unused). */
  slays: boolean[];
  /** obj_k->curses[]: power 1 = curse rune known, by curse index (0 unused). */
  curses: number[];
}

/**
 * One entry in the player's quest history (struct quest, player-quest.h),
 * copied from the standard quest table at birth (player_quests_reset). The
 * quest race is held as its ridx (a stable index into the monster registry,
 * re-resolved on load) rather than a live MonsterRace reference, so the Player
 * stays independent of the monster domain and serializes cleanly.
 */
export interface PlayerQuest {
  /** quest->name: the guardian's display name ("Sauron", "Morgoth"). */
  name: string;
  /** quest->level: the dungeon depth this quest is fought on; 0 once done. */
  level: number;
  /** quest->race->ridx: the guardian monster race index. */
  race: number;
  /** quest->max_num: how many of the race must die to complete the quest. */
  maxNum: number;
  /** quest->cur_num: how many have died so far. */
  curNum: number;
}

/** A blank, nothing-learned object-knowledge block (birth state). */
export function blankObjKnowledge(): PlayerObjectKnowledge {
  return {
    modifiers: new Array<number>(OBJ_MOD_MAX).fill(0),
    /* Combat runes: do_cmd_accept_character sets all three to 1 at birth
     * ("Hack - player knows all combat runes", player-birth.c L1264-1267), so
     * they are known from the start and their learn-by-use paths never fire. */
    toA: 1,
    toH: 1,
    toD: 1,
    /* Obvious knowledge from player_outfit (player-birth.c L584-596): the dice
     * and ac runes are set at birth, never learned by use, so always 1. */
    dd: 1,
    ds: 1,
    ac: 1,
    elInfo: newElemInfo(),
    flags: newOfFlags(),
    brands: [],
    slays: [],
    curses: [],
  };
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

  /** max_depth: the deepest dungeon level reached. */
  maxDepth: number;
  /** recall_depth: where Word of Recall returns to. */
  recallDepth: number;
  /** word_recall: turns until a pending recall fires (0 = inactive). */
  wordRecall: number;
  /** deep_descent: turns until a pending deep descent fires (0 = inactive). */
  deepDescent: number;

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

  /**
   * player->full_name (save.c:422): the character's name. Persisted and fed to
   * the high-score table (buildScore's `who`). Empty until birth naming.
   */
  fullName: string;

  /**
   * player->died_from (save.c:424): the cause-of-death string ("Interrupting"
   * while alive, then the killer's name / "Retiring" / etc.). Persisted and fed
   * to the high-score table (buildScore's `how`) and enter_score's gating.
   */
  diedFrom: string;

  /**
   * player->noscore (player.h:92-100): the "ways a player can be marked a
   * cheater" bit mask (NOSCORE_WIZARD | NOSCORE_DEBUG | ...). Persisted as u16
   * (save.c:623). Any of the score-invalidating bits keeps the character off
   * the high-score table (noscoreInvalidatesScore, game/wizard.ts). 0 = clean.
   */
  noscore: number;

  /** Player history text (the birth background/bio paragraph). */
  history: string;

  /**
   * hist (player-history.h struct player_history): the runtime auto-history
   * event log (artifact finds/losses, level-ups, unique kills, birth) -
   * distinct from the `history` bio string above. Oldest-first; see
   * player/history.ts for the append/query API.
   */
  hist: HistoryInfo[];

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

  /**
   * quests (player->quests, player-quest.h): the per-character quest history,
   * seeded from the standard quest table at birth (player_quests_reset). A
   * quest whose level is 0 is complete; when none remain, the game is won.
   */
  quests: PlayerQuest[];

  /**
   * total_winner (player->total_winner): set once every quest is complete
   * (i.e. Morgoth is slain). The victory flag, persisted across saves.
   */
  totalWinner: boolean;

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
    maxDepth: 0,
    recallDepth: 0,
    wordRecall: 0,
    deepDescent: 0,
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
    fullName: "",
    diedFrom: "",
    noscore: 0,
    history: "",
    hist: [],
    body: { name: body.name, count: body.count, slots: body.slots.map((s) => ({ ...s })) },
    equipment: new Array<number>(body.count).fill(0),
    objKnown: blankObjKnowledge(),
    quests: [],
    totalWinner: false,
    shape: null,
    skills: new Array<number>(SKILL_MAX).fill(0),
    upkeep: { playing: false, newSpells: 0, totalWeight: 0 },
  };
}
