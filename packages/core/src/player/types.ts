/**
 * Player domain types, ported from reference/src/player.h (Angband 4.2.6):
 * struct player_race, player_class, class_magic / class_book / class_spell,
 * magic_realm, player_shape, player_body / equip_slot, start_item, the
 * history_chart graph, plus the player_property and timed_effect_data /
 * timed_grade shapes bound from the compiled pack JSON.
 *
 * These are the typed, bound shapes produced by bind.ts. World coupling stays
 * out of this module: starting inventory and spell effects keep object/effect
 * references as tval/sval names and raw records, to be resolved by the obj and
 * effects domains later (see the "deferred" notes and parity/ledger).
 */

import type { FlagSet } from "../bitflag";
import { flagSize } from "../bitflag";
import { OF, PLAYER_FLAG_ENTRIES, PLAYER_TIMED_ENTRIES } from "../generated";

/** Number of timed effects (player-timed.h TMD_MAX); no MAX in the enum. */
export const TMD_MAX = PLAYER_TIMED_ENTRIES.length;

/** Number of stats (player.h STAT_MAX). */
export const STAT_MAX = 5;

/**
 * Number of stat-table slots (player.h STAT_RANGE): 3..17 give indices 0..14,
 * then 18/00 .. 18/210+ give 15..37. Every adj_* table has exactly this many
 * entries, indexed by state->stat_ind.
 */
export const STAT_RANGE = 38;

/** Maximum character level (player.h PY_MAX_LEVEL). */
export const PY_MAX_LEVEL = 50;

/**
 * Player skills (player.h SKILL_ enum). The order is the C enum order, which
 * is NOT the order of the skill-* directives in p_race.txt / class.txt: note
 * SEARCH precedes STEALTH here but the reverse in the data files, so binding
 * maps by directive name rather than position.
 */
export const SKILL = {
  DISARM_PHYS: 0,
  DISARM_MAGIC: 1,
  DEVICE: 2,
  SAVE: 3,
  SEARCH: 4,
  STEALTH: 5,
  TO_HIT_MELEE: 6,
  TO_HIT_BOW: 7,
  TO_HIT_THROW: 8,
  DIGGING: 9,
} as const;
export type SkillIndex = (typeof SKILL)[keyof typeof SKILL];

/** Number of skills (player.h SKILL_MAX). */
export const SKILL_MAX = 10;

/** Byte size of an object flag set (OF_SIZE = FLAG_SIZE(OF_MAX)). */
export const OF_SIZE = flagSize(OF.MAX);

/** Byte size of a player flag set (PF_SIZE = FLAG_SIZE(PF_MAX)). */
export const PF_SIZE = flagSize(PLAYER_FLAG_ENTRIES.length);

/**
 * Per-element resist state for a race (struct element_info). Player races only
 * set res_level via `values` lines; the ignore/hate flags used on objects are
 * not relevant here.
 */
export interface PlayerElementInfo {
  resLevel: number;
}

/**
 * struct player_race (player.h), bound from p_race.json.
 * `historyChart` is the starting chart index; `body` is a body registry index.
 */
export interface PlayerRace {
  /** Index in the race array; record order mirrors p_race.txt. */
  ridx: number;
  name: string;
  /** r_mhp: hit-dice modifier (the race's contribution to hitdie). */
  hitdie: number;
  /** r_exp: experience factor percentage. */
  expFactor: number;
  /** Base and modifier for the age roll (b_age + 1dm_age). */
  baseAge: number;
  modAge: number;
  /** Base and modifier for the height/weight normal rolls. */
  baseHeight: number;
  modHeight: number;
  baseWeight: number;
  modWeight: number;
  /** Infravision range in grids (infra). */
  infravision: number;
  /** Body registry index (always 0 in stock data: the single Humanoid body). */
  body: number;
  /** r_adj[STAT_MAX]: stat bonuses, indexed by STAT. */
  statAdj: number[];
  /** r_skills[SKILL_MAX]: skill bonuses, indexed by SKILL. */
  skills: number[];
  /** Racial object flags (OF_*). */
  flags: FlagSet;
  /** Racial player flags (PF_*). */
  pflags: FlagSet;
  /** Starting history chart index (r->history idx). */
  historyChart: number;
  /** Per-element resist info (el_info), length ELEM_MAX. */
  elInfo: PlayerElementInfo[];
}

/**
 * struct magic_realm (player.h), bound from realm.json. The pack stores only
 * the realm's name, which serves as the lookup code (lookup_realm matches by
 * name); no separate display code exists in 4.2.6 data.
 */
export interface MagicRealm {
  /** realm.txt name, used as the lookup key from class books. */
  name: string;
  /** Spell stat as a STAT index (stat_name_to_idx). */
  stat: number;
  verb: string;
  spellNoun: string;
  bookNoun: string;
}

/**
 * struct class_spell (player.h), bound minimally. The spell's effect chain is
 * preserved verbatim as raw pack records (effectsRaw) rather than compiled
 * into the effects domain; that binding is deferred.
 */
export interface ClassSpell {
  name: string;
  /** sidx: class-wide spell index (assigned in declaration order). */
  sidx: number;
  /** bidx: index of the owning book in the class books array. */
  bidx: number;
  /** slevel: required level to learn. */
  level: number;
  /** smana: mana to cast. */
  mana: number;
  /** sfail: base failure chance. */
  fail: number;
  /** sexp: encoded experience bonus. */
  exp: number;
  /** The realm of the owning book. */
  realm: MagicRealm;
  /** Raw effect records, preserved for later compilation (deferred). */
  effectsRaw: unknown[];
  /**
   * spell->text (player-spell.c): the spell's flavour description, joined
   * verbatim from the class data's desc: lines (string_append semantics -
   * concatenated with no separator, so each line must carry its own leading
   * space where the upstream data wants one). Shown by the cast/study/browse
   * menu's '?' toggle (ui-spell.c spell_menu_browser).
   */
  text: string;
}

/**
 * struct class_book (player.h), bound minimally. The object kind (sval,
 * graphics, cost/rarity) is resolved by the object domain; those fields are
 * preserved as raw data here.
 */
export interface ClassBook {
  /** tval name from the pack (object domain resolves the numeric tval). */
  tval: string;
  /** Numeric tval, stamped by registerBookKinds (0 until registered). */
  tvalIdx: number;
  /** The book kind's sval, stamped by registerBookKinds (write_book_kind). */
  sval: number;
  /** dungeon: true when quality is "dungeon" rather than "town". */
  dungeon: boolean;
  /** The book's display name (used by write_book_kind to find its sval). */
  name: string;
  /** The magic realm of this book. */
  realm: MagicRealm;
  /** Declared spell count. */
  numSpells: number;
  spells: ClassSpell[];
  /** Preserved book-graphics record (glyph/color), deferred to obj. */
  graphics: unknown;
  /** Preserved book-properties record (cost/common/minmax), deferred to obj. */
  properties: unknown;
}

/** struct class_magic (player.h). */
export interface ClassMagic {
  /** Level of the class's first spell (0 for non-casters). */
  spellFirst: number;
  /** Max armor weight before mana penalties. */
  spellWeight: number;
  /** Number of spellbooks. */
  numBooks: number;
  /** Total spells across all books. */
  totalSpells: number;
  books: ClassBook[];
}

/**
 * struct start_item (player.h), bound minimally: the object kind is kept as
 * tval/sval names for the object domain to resolve (deferred).
 */
export interface StartItem {
  tval: string;
  sval: string;
  min: number;
  max: number;
  /** Birth-option exclusion codes from the eopts field ("none" -> []). */
  eopts: string[];
}

/** struct player_class (player.h), bound from class.json. */
export interface PlayerClass {
  /** Index in the class array; record order mirrors class.txt. */
  cidx: number;
  name: string;
  /** Up to ten level titles. */
  titles: string[];
  /** c_adj[STAT_MAX]: stat modifiers, indexed by STAT. */
  statAdj: number[];
  /** c_skills[SKILL_MAX]: base skills, indexed by SKILL. */
  skills: number[];
  /** x_skills[SKILL_MAX]: per-level skill increments (per 10 levels). */
  extraSkills: number[];
  /** c_mhp: hit-dice adjustment. */
  hitdie: number;
  /** c_exp: experience factor percentage. */
  expFactor: number;
  flags: FlagSet;
  pflags: FlagSet;
  maxAttacks: number;
  minWeight: number;
  /** att_multiply: strength multiplier for blow calculation. */
  attMultiply: number;
  startItems: StartItem[];
  magic: ClassMagic;
}

/** struct player_property (player-properties, from player_property.json). */
export interface PlayerProperty {
  /** "player", "object", or "element". */
  type: string;
  /** PF_/OF_ code, or undefined for element rows. */
  code: string | null;
  name: string;
  desc: string;
  /** Whether the property is shown in the UI birth/character screens. */
  bindui: boolean;
  /** Element value (resist rows), when present. */
  value: number | null;
}

/**
 * struct timed_grade (player-timed.c). The registry always prepends the
 * implicit "off" grade (grade 0, max 0, no name/message), so a timed effect
 * with N pack grades has N + 1 entries here.
 */
export interface TimedGrade {
  /** 0 for the implicit off grade, then 1..N in ascending order. */
  grade: number;
  /** Resolved colour attribute (color_char/text_to_attr); 0 for off. */
  color: number;
  /** Upper bound of this grade (inclusive); 0 for the off grade. */
  max: number;
  /** Display name, or null (single-char pack names are dummies -> null). */
  name: string | null;
  /** Message shown when entering the grade from below, or null. */
  upMsg: string | null;
  /** Message shown when dropping into the grade from above, or null. */
  downMsg: string | null;
}

/** One entry of a timed effect's fail directive ("fail uint code str flag"). */
export interface TimedFail {
  code: number;
  flag: string;
}

/**
 * One step of an on-begin-effect / on-end-effect chain (player-timed.c
 * parse_player_timed_effect). The effect code and subtype are resolved at bind
 * time; the dice string, when present, overrides the effect's own dice.
 */
export interface TimedEffectStep {
  /** EF_ effect code (generated EF enum value). */
  effect: number;
  /** effect_subtype(effect, type) result (param2 / subtype), or 0 for none. */
  subtype: number;
  /** effect-dice string, or undefined to use the effect's default dice. */
  dice?: string;
}

/** struct timed_effect_data (player-timed.c), bound from player_timed.json. */
export interface TimedEffect {
  /** TMD_ index; matches the generated TMD enum. */
  index: number;
  name: string;
  desc: string;
  /** on-end message (shown when the effect wears off). */
  onEnd: string;
  /** MSG_ type name (kept as a name; obj/effects resolve the int). */
  msgt: string;
  /** on-increase message (shown when the duration grows), or empty. */
  onIncrease: string;
  /** on-decrease message (shown when the duration shrinks), or empty. */
  onDecrease: string;
  /** TMD_FLAG_NONSTACKING: a fresh increase is blocked while already active. */
  nonStacking: boolean;
  /** lower-bound directive: values below this floor are raised to it. */
  lowerBound: number;
  /**
   * temp_resist (player-timed.c parse_player_timed_resist): the ELEM_ index
   * this effect grants a temporary resist against, or -1 when none. Bound
   * from the pack `resist` field via ELEM[name]. On the five OPP_* effects.
   */
  tempResist: number;
  /**
   * oflag_dup (parse_player_timed_flag_synonym): the OF_ index this effect
   * duplicates into the player's object flags while active, or 0 (OF_NONE)
   * when none. Bound from the pack `flag-synonym[0].code` via OF[name].
   */
  oflagDup: number;
  /**
   * oflag_syn: whether the flag synonym is an exact duplicate (used only by
   * the deferred notify-suppression). Bound from `flag-synonym[0].exact`.
   */
  oflagSyn: boolean;
  grades: TimedGrade[];
  fail: TimedFail[];
  /**
   * on_begin_effect (player-timed.c:875): the effect chain dispatched when the
   * effect starts (a 0 -> positive transition), e.g. SCRAMBLE's SCRAMBLE_STATS.
   * Undefined when the effect defines none.
   */
  onBeginEffect?: TimedEffectStep[];
  /**
   * on_end_effect (player-timed.c:884): the chain dispatched when the effect
   * lapses (positive -> 0), e.g. SCRAMBLE's UNSCRAMBLE_STATS and SPRINT's
   * ending TIMED_INC_NO_RES:SLOW. Undefined when the effect defines none.
   */
  onEndEffect?: TimedEffectStep[];
}

/**
 * struct player_shape (player.h L216), fully bound from shape.json:
 * combat bonuses, skills, object/player flags, the OBJ_MOD modifier
 * array, elemental resists, the assume-shape effect chain and the shape
 * blow verbs (the shape unarmed attack rides combat).
 */
export interface Shape {
  /** Index in the shape array; record order mirrors shape.txt. */
  sidx: number;
  name: string;
  /** Plusses to AC / hit / damage. */
  toA: number;
  toH: number;
  toD: number;
  /** skills[SKILL_MAX]. */
  skills: number[];
  /** Shape (object) flags. */
  flags: FlagSet;
  /** Shape (player) flags. */
  pflags: FlagSet;
  /** Stat and other modifiers (the OBJ_MOD index space). */
  modifiers: number[];
  /** Elemental resists (res_level per element). */
  elInfo: PlayerElementInfo[];
  /** The effect on taking this shape (raw records; chain built on cast). */
  effects: readonly ShapeEffectJson[];
  /** The effect's message, if any. */
  effectMsg: string | null;
  /** Shape blow verbs ("bite", "claw", ...). */
  blows: readonly string[];
}

/** One raw shape-effect record (the object-effect record shape). */
export interface ShapeEffectJson {
  eff: string;
  type?: string;
  radius?: number;
  other?: number;
  dice?: string;
  expr?: Array<{ name: string; base: string; expr: string }>;
}

/** One equipment slot of a body (struct equip_slot). */
export interface BodySlot {
  /** EQUIP_ slot type name from the pack (e.g. "WEAPON", "RING"). */
  type: string;
  /** Slot label (e.g. "right hand"). */
  name: string;
}

/** struct player_body (player.h), bound from body.json. */
export interface PlayerBody {
  name: string;
  count: number;
  slots: BodySlot[];
}

/** struct history_entry (player.h): one weighted branch of a chart. */
export interface HistoryEntry {
  /** Cumulative roll threshold (1..100); chosen when roll <= this. */
  roll: number;
  /** Successor chart index (isucc); 0 terminates the walk. */
  isucc: number;
  /** Resolved successor chart, or null for terminal entries. */
  succ: HistoryChart | null;
  text: string;
}

/** struct history_chart (player.h): a node in the history graph. */
export interface HistoryChart {
  idx: number;
  entries: HistoryEntry[];
}
