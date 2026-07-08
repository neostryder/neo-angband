/**
 * Monster domain types, ported from reference/src/monster.h and
 * reference/src/mon-blows.h (Angband 4.2.6).
 *
 * These are the bound, typed shapes produced by bind.ts from the compiled
 * pack JSON (monster.json, monster_base.json, monster_spell.json,
 * blow_methods.json, blow_effects.json, pain.json, summon.json, pit.json).
 * World coupling stays out of this module: races reference each other and
 * their bases directly, but objects (mimic kinds, drops) are kept as tval
 * and sval names, to be resolved by the object domain later.
 */

import type { FlagSet } from "../bitflag";
import type { Dice } from "../dice";
import {
  MON_RACE_FLAG_ENTRIES,
  MON_SPELL_ENTRIES,
  MON_TEMP_FLAG_ENTRIES,
} from "../generated";
import { flagSize } from "../bitflag";
import { RSF } from "../generated";

/** Byte size of a race FlagSet (upstream RF_SIZE = FLAG_SIZE(RF_MAX)). */
export const RF_SIZE = flagSize(MON_RACE_FLAG_ENTRIES.length);

/** Byte size of a spell FlagSet (upstream RSF_SIZE = FLAG_SIZE(RSF_MAX)). */
export const RSF_SIZE = flagSize(RSF.MAX);

/** Byte size of a temp-flag FlagSet (upstream MFLAG_SIZE). */
export const MFLAG_SIZE = flagSize(MON_TEMP_FLAG_ENTRIES.length);

/**
 * struct monster_pain: one pain-message family; pain.txt `type` values are
 * the pain_idx keys monster_base pain: refers to.
 */
export interface Pain {
  painIdx: number;
  /** Up to seven messages, ordered from least to most hurt. */
  messages: string[];
}

/** struct blow_method (mon-blows.h), bound from blow_methods.json. */
export interface BlowMethod {
  name: string;
  cut: boolean;
  stun: boolean;
  miss: boolean;
  phys: boolean;
  /** MSG_ type name (upstream stores the resolved msgt int). */
  msgt: string;
  /** Action messages ({target} substitution done by combat code later). */
  messages: string[];
  desc: string;
}

/** struct blow_effect (mon-blows.h), bound from blow_effects.json. */
export interface BlowEffect {
  name: string;
  power: number;
  eval: number;
  desc: string;
  /** Lore colors kept as color names (upstream resolves to attrs). */
  loreColorBase: string;
  loreColorResist: string;
  loreColorImmune: string;
  effectType: string;
  /** Element name for resist checks (upstream resolves to an index). */
  resist: string | null;
  /** Projection type name used by LASH. */
  lashType: string | null;
}

/** struct monster_blow: one melee blow of a race. */
export interface MonsterBlow {
  method: BlowMethod;
  effect: BlowEffect;
  /** Damage dice, or null when the blow has no damage (upstream zero rand). */
  dice: Dice | null;
  /** The raw damage string from monster.txt, e.g. "20d10", or null. */
  diceRaw: string | null;
}

/** One effect line of a monster spell (kept close to the pack record). */
export interface MonsterSpellEffect {
  eff: string;
  type: string | null;
  radius: number;
  other: number;
  /** Parsed dice (expressions bound where present), or null. */
  dice: Dice | null;
  diceRaw: string | null;
  /** expr bindings as written: name, base value name, operations string. */
  exprs: Array<{ name: string; base: string; expr: string }>;
}

/**
 * struct monster_spell_level: power-cutoff dependent lore and messages.
 * The first level always has power 0; power-cutoff directives append more.
 */
export interface MonsterSpellLevel {
  power: number;
  loreDesc: string;
  loreColorBase: string;
  loreColorResist: string;
  loreColorImmune: string;
  message: string;
  blindMessage: string;
  missMessage: string;
  saveMessage: string;
}

/** struct monster_spell: one RSF_ spell bound from monster_spell.json. */
export interface MonsterSpell {
  /** RSF_ index. */
  index: number;
  name: string;
  /** MSG_ type name for message coloring. */
  msgt: string;
  /** To-hit level of the attack. */
  hit: number;
  effects: MonsterSpellEffect[];
  levels: MonsterSpellLevel[];
}

/** struct monster_base: race template bound from monster_base.json. */
export interface MonsterBase {
  name: string;
  /** In-game name (desc line). */
  text: string;
  flags: FlagSet;
  /** Default display glyph. */
  glyph: string;
  pain: Pain;
}

/** enum monster_group_role. */
export const MON_GROUP = {
  LEADER: 0,
  SERVANT: 1,
  BODYGUARD: 2,
  MEMBER: 3,
  SUMMON: 4,
} as const;
export type MonsterGroupRole = (typeof MON_GROUP)[keyof typeof MON_GROUP];

/** struct monster_friends: specific-race companion line. */
export interface MonsterFriends {
  /** Raw name; "same" binds to the owning race. */
  name: string;
  /** Resolved after all races bind. */
  race: MonsterRace | null;
  role: MonsterGroupRole;
  percentChance: number;
  numberDice: number;
  numberSide: number;
}

/** struct monster_friends_base: base-template companion line. */
export interface MonsterFriendsBase {
  base: MonsterBase;
  role: MonsterGroupRole;
  percentChance: number;
  numberDice: number;
  numberSide: number;
}

/**
 * struct monster_drop, minimal model: object kinds stay unresolved names
 * until the object domain binds them (drop-base lines have sval null).
 */
export interface MonsterDrop {
  tval: string;
  sval: string | null;
  percentChance: number;
  min: number;
  max: number;
}

/** struct monster_mimic, minimal: kind kept as tval/sval names. */
export interface MonsterMimic {
  tval: string;
  sval: string;
}

/** struct monster_shape: race resolved second-pass; base wins if it names one. */
export interface MonsterShape {
  name: string;
  race: MonsterRace | null;
  base: MonsterBase | null;
}

/** struct monster_altmsg: per-race override of a spell message. */
export type MonsterAltMsgType = "seen" | "unseen" | "miss";
export interface MonsterAltMsg {
  /** RSF_ index of the spell. */
  index: number;
  msgType: MonsterAltMsgType;
  message: string;
}

/** struct monster_race (monster.h), bound from monster.json. */
export interface MonsterRace {
  /** Index in the race array; record order mirrors monster.txt. */
  ridx: number;
  name: string;
  text: string;
  plural: string | null;
  base: MonsterBase;
  /** Average hit points (4.2 stores avg_hp, not hdice). */
  avgHp: number;
  ac: number;
  sleep: number;
  /** Scaled by max_sight / 20 at bind time, as parse_monster_hearing. */
  hearing: number;
  smell: number;
  speed: number;
  light: number;
  mexp: number;
  /** Stored as 100 / pct like upstream freq_innate / freq_spell. */
  freqInnate: number;
  freqSpell: number;
  /** Defaults to level; overridden by spell-power. */
  spellPower: number;
  flags: FlagSet;
  spellFlags: FlagSet;
  blows: MonsterBlow[];
  level: number;
  rarity: number;
  /** Display attr (COLOUR_ index) and glyph. */
  dAttr: number;
  dChar: string;
  /** Population cap: 100, or 1 for uniques (player-birth.c). */
  maxNum: number;
  /** Mutable per-level population count. */
  curNum: number;
  spellMsgs: MonsterAltMsg[];
  drops: MonsterDrop[];
  friends: MonsterFriends[];
  friendsBase: MonsterFriendsBase[];
  mimicKinds: MonsterMimic[];
  shapes: MonsterShape[];
}

/** summon.txt record, loaded with minimal binding (details deferred). */
export interface SummonType {
  name: string;
  msgt: string;
  uniquesAllowed: boolean;
  baseNames: string[];
  raceFlag: string | null;
  fallbackName: string | null;
  desc: string;
}

/** pit.txt record, loaded with minimal binding (details deferred). */
export interface PitProfile {
  name: string;
  room: number;
  allocRarity: number;
  allocLevel: number;
  objRarity: number;
  baseNames: string[];
  colors: string[];
  flagsReq: string[];
  flagsBan: string[];
  spellReq: string[];
  spellBan: string[];
  monBan: string[];
  freqInnate: number;
}

/**
 * The RSF_ index whose list-mon-spells.h type expression contains any of
 * the given RST_ names (create_mon_spell_mask). Entry i of
 * MON_SPELL_ENTRIES is RSF value i.
 */
export function monSpellsOfTypes(...types: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < MON_SPELL_ENTRIES.length; i++) {
    const entry = MON_SPELL_ENTRIES[i];
    if (!entry || typeof entry.type !== "string") continue;
    const parts = entry.type.split("|").map((s) => s.trim());
    if (types.some((t) => parts.includes(t))) out.push(i);
  }
  return out;
}
