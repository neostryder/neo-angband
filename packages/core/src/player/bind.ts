/**
 * Player registries, ported from the gamedata binding semantics in
 * reference/src/init.c and reference/src/player-timed.c (Angband 4.2.6).
 *
 * bindPlayer() takes parsed pack JSON records (no fs here) and produces a
 * PlayerRegistry. Binding follows the upstream parser actions exactly; the
 * important subtleties are noted inline:
 *
 * - Skills bind by directive name, not position: the SKILL_ enum orders SEARCH
 *   before STEALTH, but p_race.txt / class.txt list stealth before search.
 * - Class skills carry a base (c_skills) and a per-10-levels increment
 *   (x_skills); race skills are a single racial bonus.
 * - Magic realms are resolved by name (lookup_realm). Class spells get a
 *   class-wide sidx assigned in declaration order and a bidx pointing at their
 *   book; the spell effect chain is preserved raw (compilation deferred).
 * - Timed effects prepend an implicit "off" grade (grade 0, max 0), matching
 *   parse_player_timed_grade's zero-grade; FOOD grade maxima are scaled by
 *   z_info->food_value (100 in the stock pack).
 * - History charts form a graph: entries are grouped by chart id in file order
 *   and each entry's successor chart (isucc) is resolved in a second pass.
 *
 * Moddability: every bind* function accepts plain record arrays of the pack
 * shapes, so a mod extends the game by concatenating its records onto the
 * pack's before binding (see the extension test).
 */

import { FlagSet } from "../bitflag";
import { colorCharToAttr, colorTextToAttr } from "../color";
import {
  ELEMENT_ENTRIES,
  OBJECT_MODIFIER_ENTRIES,
  STAT_ENTRIES,
  ELEM,
  OF,
  PF,
  STAT,
  TMD,
} from "../generated";
import {
  OF_SIZE,
  PF_SIZE,
  SKILL,
  SKILL_MAX,
  STAT_MAX,
} from "./types";
import type {
  ClassBook,
  ClassMagic,
  ClassSpell,
  PlayerElementInfo,
  HistoryChart,
  HistoryEntry,
  MagicRealm,
  PlayerBody,
  PlayerClass,
  PlayerProperty,
  PlayerRace,
  Shape,
  StartItem,
  TimedEffect,
  TimedFail,
  TimedGrade,
} from "./types";

/* re-export sizes for consumers that reach the domain through bind. */
export { OF_SIZE, PF_SIZE };

/** z_info->food_value: FOOD timed-grade maxima scale by this (constants.txt). */
export const FOOD_VALUE = 100;

/** ELEM_ names indexed by element value (for RES_ value lines). */
const ELEMENT_NAMES = ELEMENT_ENTRIES.map((e) => e.name);

/** Number of elements (ELEM_MAX). */
export const ELEM_MAX = ELEMENT_ENTRIES.length;

/* ------------------------------------------------------------------ */
/* Pack record shapes (compiled JSON)                                  */
/* ------------------------------------------------------------------ */

/** stats block shared by p_race.json and class.json records. */
interface StatsJson {
  str: number;
  int: number;
  wis: number;
  dex: number;
  con: number;
}

/** p_race.json record. */
export interface PRaceRecordJson {
  name: string;
  stats: StatsJson;
  "skill-disarm-phys": number;
  "skill-disarm-magic": number;
  "skill-device": number;
  "skill-save": number;
  "skill-stealth": number;
  "skill-search": number;
  "skill-melee": number;
  "skill-shoot": number;
  "skill-throw": number;
  "skill-dig": number;
  hitdie: number;
  exp: number;
  infravision: number;
  history: number;
  age: { base_age: number; mod_age: number };
  height: { base_hgt: number; mod_hgt: number };
  weight: { base_wgt: number; mod_wgt: number };
  "obj-flags"?: string[];
  "player-flags"?: string[];
  values?: string[];
}

/** A class skill directive: base value plus per-level increment. */
interface ClassSkillJson {
  base: number;
  incr: number;
}

/** class.json spell record (effect chain preserved raw). */
export interface ClassSpellJson {
  name: string;
  level: number;
  mana: number;
  fail: number;
  exp: number;
  effect?: unknown[];
  /** desc: lines (player-spell.c spell->text), joined verbatim by joinLines. */
  desc?: string[];
}

/** class.json book record. */
export interface ClassBookJson {
  tval: string;
  quality: string;
  name: string;
  spells: number;
  realm: string;
  "book-graphics"?: unknown;
  "book-properties"?: unknown;
  spell?: ClassSpellJson[];
}

/** class.json equip (start item) record. */
export interface ClassEquipJson {
  tval: string;
  sval: string;
  min: number;
  max: number;
  eopts: string;
}

/** class.json magic block. */
export interface ClassMagicJson {
  first: number;
  weight: number;
  books: number;
}

/** class.json record. */
export interface ClassRecordJson {
  name: string;
  stats: StatsJson;
  "skill-disarm-phys": ClassSkillJson;
  "skill-disarm-magic": ClassSkillJson;
  "skill-device": ClassSkillJson;
  "skill-save": ClassSkillJson;
  "skill-stealth": ClassSkillJson;
  "skill-search": ClassSkillJson;
  "skill-melee": ClassSkillJson;
  "skill-shoot": ClassSkillJson;
  "skill-throw": ClassSkillJson;
  "skill-dig": ClassSkillJson;
  hitdie: number;
  exp?: number;
  "max-attacks": number;
  "min-weight": number;
  "strength-multiplier": number;
  title?: string[];
  equip?: ClassEquipJson[];
  "obj-flags"?: string[];
  "player-flags"?: string[];
  magic?: ClassMagicJson;
  book?: ClassBookJson[];
  desc?: string[];
}

/** player_property.json record. */
export interface PlayerPropertyRecordJson {
  type: string;
  code?: string;
  name: string;
  desc?: string[];
  bindui?: boolean;
  value?: number;
}

/** player_timed.json grade record. */
export interface TimedGradeJson {
  color: string;
  max: number;
  name: string;
  up_msg?: string;
  down_msg?: string;
}

/** player_timed.json fail record. */
export interface TimedFailJson {
  code: number;
  flag: string;
}

/** player_timed.json flag-synonym record ("flag-synonym code exact"). */
export interface TimedFlagSynonymJson {
  code: string;
  exact: number;
}

/** player_timed.json record. */
export interface PlayerTimedRecordJson {
  name: string;
  desc?: string[];
  "on-end"?: string[];
  "on-increase"?: string[];
  "on-decrease"?: string[];
  msgt?: string;
  flags?: string[];
  "lower-bound"?: number;
  fail?: TimedFailJson[];
  grade?: TimedGradeJson[];
  /** Temporary elemental resist granted while active (ELEM_ name). */
  resist?: string;
  /** Object flag(s) duplicated while active; only the first is bound. */
  "flag-synonym"?: TimedFlagSynonymJson[];
}

/** shape.json record (bound raw beyond name; see Shape). */
export interface ShapeRecordJson {
  name: string;
  [key: string]: unknown;
}

/** body.json slot record. */
export interface BodySlotJson {
  slot: string;
  name: string;
}

/** body.json record. */
export interface BodyRecordJson {
  body: string;
  slot: BodySlotJson[];
}

/** history.json record: one entry, tagged with its chart. */
export interface HistoryRecordJson {
  chart: { chart: number; next: number; roll: number };
  phrase?: string[];
}

/** realm.json record. */
export interface RealmRecordJson {
  name: string;
  stat: string;
  verb: string;
  "spell-noun": string;
  "book-noun": string;
}

/** All pack inputs bindPlayer needs; each is the file's records array. */
export interface PlayerPackRecords {
  races: PRaceRecordJson[];
  classes: ClassRecordJson[];
  properties: PlayerPropertyRecordJson[];
  timed: PlayerTimedRecordJson[];
  shapes: ShapeRecordJson[];
  bodies: BodyRecordJson[];
  history: HistoryRecordJson[];
  realms: RealmRecordJson[];
}

/* ------------------------------------------------------------------ */
/* Binding helpers                                                     */
/* ------------------------------------------------------------------ */

/** string_append semantics: multi-line text concatenates without separator. */
function joinLines(lines: string[] | undefined): string {
  return lines ? lines.join("") : "";
}

/** grab_flag over a NAME -> value table for "A | B" segments; throws on error. */
function grabFlags(
  flags: FlagSet,
  table: Record<string, number>,
  lines: string[] | undefined,
  what: string,
): void {
  if (!lines) return;
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = table[name];
      if (value === undefined || value === 0) {
        throw new Error(`player: bad ${what} flag: ${name}`);
      }
      flags.on(value);
    }
  }
}

/** stat_name_to_idx: STAT name ("STR"..) -> index; throws on unknown. */
function statNameToIdx(name: string): number {
  const idx = (STAT as Record<string, number>)[name];
  if (idx === undefined) {
    throw new Error(`player: unknown stat name: ${name}`);
  }
  return idx;
}

/** findValueArg: "RES_LIGHT[1]" -> { name: "RES_LIGHT", arg: "1" }, or null. */
function findValueArg(token: string): { name: string; arg: string } | null {
  const open = token.indexOf("[");
  if (open < 0 || !token.endsWith("]")) return null;
  return { name: token.slice(0, open), arg: token.slice(open + 1, -1) };
}

/** newElemInfo: fresh el_info array of resLevel 0, length ELEM_MAX. */
function newElemInfo(): PlayerElementInfo[] {
  const out: PlayerElementInfo[] = [];
  for (let i = 0; i < ELEM_MAX; i++) out.push({ resLevel: 0 });
  return out;
}

/**
 * parse_p_race_values: apply "RES_<ELEM>[n]" tokens, setting el_info[i].res_level
 * = n (grab_index_and_int with the "RES_" prefix over element names).
 */
function applyRaceValues(elInfo: PlayerElementInfo[], lines: string[] | undefined): void {
  if (!lines) return;
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const token = raw.trim();
      if (!token) continue;
      const parsed = findValueArg(token);
      if (!parsed) {
        throw new Error(`player: invalid race value: ${token}`);
      }
      const m = /^\s*([-+]?\d+)\s*$/.exec(parsed.arg);
      if (!m) throw new Error(`player: invalid race value int: ${token}`);
      let matched = false;
      for (let i = 0; i < ELEMENT_NAMES.length; i++) {
        if ("RES_" + (ELEMENT_NAMES[i] as string) === parsed.name) {
          (elInfo[i] as PlayerElementInfo).resLevel = Number(m[1]);
          matched = true;
          break;
        }
      }
      if (!matched) throw new Error(`player: unknown race value: ${token}`);
    }
  }
}

/** obj_mods[]: the five stats then the object modifiers, index = value. */
const SHAPE_MOD_NAMES: readonly string[] = [
  ...STAT_ENTRIES.map((e) => e.name),
  ...OBJECT_MODIFIER_ENTRIES.map((e) => e.name),
];

/** shape.txt skill-<name> keys -> SKILL indices (parse_shape_skill_*). */
const SHAPE_SKILL_KEYS: ReadonlyArray<[string, number]> = [
  ["skill-disarm-phys", SKILL.DISARM_PHYS],
  ["skill-disarm-magic", SKILL.DISARM_MAGIC],
  ["skill-save", SKILL.SAVE],
  ["skill-stealth", SKILL.STEALTH],
  ["skill-search", SKILL.SEARCH],
  ["skill-melee", SKILL.TO_HIT_MELEE],
  ["skill-throw", SKILL.TO_HIT_THROW],
  ["skill-dig", SKILL.DIGGING],
];

/**
 * parse_shape_* (init.c L3013): bind one shape.json record - the combat
 * bonuses, skills, object/player flags, the modifier/resist values
 * ("STR[-3] | STEALTH[5]" over obj_mods, "RES_<ELEM>[n]" over elements)
 * and the raw assume-shape effect records.
 */
function bindShape(rec: ShapeRecordJson, sidx: number): Shape {
  const combat = (rec["combat"] ?? {}) as Record<string, number>;
  const skills = new Array<number>(SKILL_MAX).fill(0);
  for (const [key, skill] of SHAPE_SKILL_KEYS) {
    if (typeof rec[key] === "number") skills[skill] = rec[key] as number;
  }

  const flags = new FlagSet(OF_SIZE);
  for (const line of (rec["obj-flags"] as string[] | undefined) ?? []) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = OF[name as keyof typeof OF];
      if (typeof value !== "number") {
        throw new Error(`player: unknown shape obj-flag: ${name}`);
      }
      flags.on(value);
    }
  }
  const pflags = new FlagSet(PF_SIZE);
  for (const line of (rec["player-flags"] as string[] | undefined) ?? []) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = PF[name as keyof typeof PF];
      if (typeof value !== "number") {
        throw new Error(`player: unknown shape player-flag: ${name}`);
      }
      pflags.on(value);
    }
  }

  const modifiers = new Array<number>(SHAPE_MOD_NAMES.length).fill(0);
  const elInfo = newElemInfo();
  for (const line of (rec["values"] as string[] | undefined) ?? []) {
    for (const raw of line.split("|")) {
      const token = raw.trim();
      if (!token) continue;
      const parsed = findValueArg(token);
      if (!parsed) throw new Error(`player: invalid shape value: ${token}`);
      const m = /^\s*([-+]?\d+)\s*$/.exec(parsed.arg);
      if (!m) throw new Error(`player: invalid shape value int: ${token}`);
      const mod = SHAPE_MOD_NAMES.indexOf(parsed.name);
      if (mod >= 0) {
        modifiers[mod] = Number(m[1]);
        continue;
      }
      let matched = false;
      for (let i = 0; i < ELEMENT_ENTRIES.length; i++) {
        if ("RES_" + ELEMENT_ENTRIES[i]!.name === parsed.name) {
          (elInfo[i] as PlayerElementInfo).resLevel = Number(m[1]);
          matched = true;
          break;
        }
      }
      if (!matched) throw new Error(`player: unknown shape value: ${token}`);
    }
  }

  return {
    sidx,
    name: rec.name,
    toA: combat["to-a"] ?? 0,
    toH: combat["to-h"] ?? 0,
    toD: combat["to-d"] ?? 0,
    skills,
    flags,
    pflags,
    modifiers,
    elInfo,
    effects: (rec["effect"] as Shape["effects"] | undefined) ?? [],
    effectMsg: (rec["effect-msg"] as string | undefined) ?? null,
    blows: (rec["blow"] as string[] | undefined) ?? [],
  };
}

/** Resolve a colour token (single char or full name) to an attr; throws. */
function colorToAttr(color: string): number {
  const attr = color.length > 1 ? colorTextToAttr(color) : colorCharToAttr(color);
  if (attr < 0) throw new Error(`player: invalid color: ${color}`);
  return attr;
}

/** Split an eopts field like "birth_no_recall" or "none" into codes. */
function parseEopts(eopts: string): string[] {
  const out: string[] = [];
  for (const raw of eopts.split(/[ |]+/)) {
    const tok = raw.trim();
    if (tok.length > 0 && tok !== "none") out.push(tok);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/** Everything the player domain binds from the pack. */
export class PlayerRegistry {
  /** Record order mirrors p_race.txt; ridx is the array index. */
  readonly races: PlayerRace[];
  /** Record order mirrors class.txt; cidx is the array index. */
  readonly classes: PlayerClass[];
  readonly properties: PlayerProperty[];
  /** TMD index -> timed effect. */
  readonly timed: TimedEffect[];
  readonly shapes: Shape[];
  readonly bodies: PlayerBody[];
  /** chart idx -> chart. */
  readonly histories: Map<number, HistoryChart>;
  /** realm name -> realm. */
  readonly realms: Map<string, MagicRealm>;

  private readonly racesByName: Map<string, PlayerRace>;
  private readonly classesByName: Map<string, PlayerClass>;

  constructor(pack: PlayerPackRecords) {
    this.realms = bindRealms(pack.realms);
    this.histories = bindHistories(pack.history);
    this.bodies = bindBodies(pack.bodies);
    this.properties = bindProperties(pack.properties);
    this.timed = bindTimed(pack.timed);
    this.shapes = pack.shapes.map((rec, sidx) => bindShape(rec, sidx));

    this.races = pack.races.map((rec, ridx) => bindRace(rec, ridx));
    this.classes = pack.classes.map((rec, cidx) =>
      bindClass(rec, cidx, this.realms),
    );

    this.racesByName = new Map();
    for (const r of this.races) this.racesByName.set(r.name.toLowerCase(), r);
    this.classesByName = new Map();
    for (const c of this.classes) this.classesByName.set(c.name.toLowerCase(), c);
  }

  /** player_id2race by name (case-insensitive), or null. */
  raceByName(name: string): PlayerRace | null {
    return this.racesByName.get(name.toLowerCase()) ?? null;
  }

  /** player_id2class by name (case-insensitive), or null. */
  classByName(name: string): PlayerClass | null {
    return this.classesByName.get(name.toLowerCase()) ?? null;
  }

  /** Starting chart for a race, resolved from its historyChart index. */
  historyChart(race: PlayerRace): HistoryChart | null {
    return this.histories.get(race.historyChart) ?? null;
  }
}

/** Bind all player-domain pack records into a registry. */
export function bindPlayer(pack: PlayerPackRecords): PlayerRegistry {
  return new PlayerRegistry(pack);
}

/* ------------------------------------------------------------------ */
/* Per-file binders                                                    */
/* ------------------------------------------------------------------ */

function bindRealms(records: RealmRecordJson[]): Map<string, MagicRealm> {
  const map = new Map<string, MagicRealm>();
  for (const rec of records) {
    map.set(rec.name, {
      name: rec.name,
      stat: statNameToIdx(rec.stat),
      verb: rec.verb,
      spellNoun: rec["spell-noun"],
      bookNoun: rec["book-noun"],
    });
  }
  return map;
}

function bindHistories(records: HistoryRecordJson[]): Map<number, HistoryChart> {
  const map = new Map<number, HistoryChart>();
  /* Group entries by chart id, preserving file order within a chart. */
  for (const rec of records) {
    const id = rec.chart.chart;
    let chart = map.get(id);
    if (!chart) {
      chart = { idx: id, entries: [] };
      map.set(id, chart);
    }
    chart.entries.push({
      roll: rec.chart.roll,
      isucc: rec.chart.next,
      succ: null,
      text: joinLines(rec.phrase),
    });
  }
  /* finish_parse_history: resolve successor charts. */
  for (const chart of map.values()) {
    for (const entry of chart.entries) {
      if (entry.isucc === 0) continue;
      const succ = map.get(entry.isucc);
      if (!succ) {
        throw new Error(
          `player: history entry references missing chart ${entry.isucc}`,
        );
      }
      entry.succ = succ;
    }
  }
  return map;
}

function bindBodies(records: BodyRecordJson[]): PlayerBody[] {
  return records.map((rec) => ({
    name: rec.body,
    count: rec.slot.length,
    slots: rec.slot.map((s) => ({ type: s.slot, name: s.name })),
  }));
}

function bindProperties(records: PlayerPropertyRecordJson[]): PlayerProperty[] {
  return records.map((rec) => ({
    type: rec.type,
    code: rec.code ?? null,
    name: rec.name,
    desc: joinLines(rec.desc),
    bindui: rec.bindui ?? false,
    value: rec.value ?? null,
  }));
}

function bindTimed(records: PlayerTimedRecordJson[]): TimedEffect[] {
  const out: TimedEffect[] = [];
  for (const rec of records) {
    const index = (TMD as Record<string, number>)[rec.name];
    if (index === undefined) {
      throw new Error(`player: unknown timed effect name: ${rec.name}`);
    }
    const foodScale = rec.name === "FOOD" ? FOOD_VALUE : 1;

    /* Implicit "off" grade (parse_player_timed_grade's zero grade). */
    const grades: TimedGrade[] = [
      { grade: 0, color: 0, max: 0, name: null, upMsg: null, downMsg: null },
    ];
    for (const g of rec.grade ?? []) {
      /* Single-char names/messages are upstream dummies -> null. */
      const name = g.name.length === 1 ? null : g.name;
      const upMsg = g.up_msg !== undefined && g.up_msg.length > 1 ? g.up_msg : null;
      const grade: TimedGrade = {
        grade: grades.length,
        color: colorToAttr(g.color),
        max: g.max * foodScale,
        name,
        upMsg,
        downMsg: g.down_msg ?? null,
      };
      grades.push(grade);
    }

    const fail: TimedFail[] = (rec.fail ?? []).map((f) => ({
      code: f.code,
      flag: f.flag,
    }));

    /*
     * temp_resist (parse_player_timed_resist): the pack `resist` name maps to
     * an element index via proj_name_to_idx upstream. For the five OPP_*
     * effects the resist name is one of ACID/ELEC/FIRE/COLD/POIS, whose ELEM_
     * indices (0..4) coincide with the PROJ_ indices proj_name_to_idx returns,
     * so ELEM[name] is the faithful equivalent. Absent -> -1 (no resist).
     */
    const tempResist =
      rec.resist !== undefined
        ? ((ELEM as Record<string, number>)[rec.resist] ?? -1)
        : -1;

    /*
     * oflag_dup / oflag_syn (parse_player_timed_flag_synonym): the first
     * flag-synonym's code maps to an OF_ index (code_index_in_array); a valid
     * synonym is always > OF_NONE(0). Absent -> 0 (OF_NONE, no synonym).
     */
    const synonym = rec["flag-synonym"]?.[0];
    const oflagDup =
      synonym !== undefined
        ? ((OF as Record<string, number>)[synonym.code] ?? 0)
        : 0;
    const oflagSyn = synonym !== undefined && synonym.exact !== 0;

    out.push({
      index,
      name: rec.name,
      desc: joinLines(rec.desc),
      onEnd: joinLines(rec["on-end"]),
      onIncrease: joinLines(rec["on-increase"]),
      onDecrease: joinLines(rec["on-decrease"]),
      msgt: rec.msgt ?? "GENERIC",
      nonStacking: (rec.flags ?? []).includes("NONSTACKING"),
      lowerBound: rec["lower-bound"] ?? 0,
      tempResist,
      oflagDup,
      oflagSyn,
      grades,
      fail,
    });
  }
  return out;
}

/** Read the ten skill-* directives (race form: plain ints) into a skills array. */
function raceSkills(rec: PRaceRecordJson): number[] {
  const skills = new Array<number>(SKILL_MAX).fill(0);
  skills[SKILL.DISARM_PHYS] = rec["skill-disarm-phys"];
  skills[SKILL.DISARM_MAGIC] = rec["skill-disarm-magic"];
  skills[SKILL.DEVICE] = rec["skill-device"];
  skills[SKILL.SAVE] = rec["skill-save"];
  skills[SKILL.STEALTH] = rec["skill-stealth"];
  skills[SKILL.SEARCH] = rec["skill-search"];
  skills[SKILL.TO_HIT_MELEE] = rec["skill-melee"];
  skills[SKILL.TO_HIT_BOW] = rec["skill-shoot"];
  skills[SKILL.TO_HIT_THROW] = rec["skill-throw"];
  skills[SKILL.DIGGING] = rec["skill-dig"];
  return skills;
}

/** statAdj array in STAT order from a stats block. */
function statAdj(stats: StatsJson): number[] {
  const adj = new Array<number>(STAT_MAX).fill(0);
  adj[STAT.STR] = stats.str;
  adj[STAT.INT] = stats.int;
  adj[STAT.WIS] = stats.wis;
  adj[STAT.DEX] = stats.dex;
  adj[STAT.CON] = stats.con;
  return adj;
}

function bindRace(rec: PRaceRecordJson, ridx: number): PlayerRace {
  const flags = new FlagSet(OF_SIZE);
  grabFlags(flags, OF as unknown as Record<string, number>, rec["obj-flags"], "race object");
  const pflags = new FlagSet(PF_SIZE);
  grabFlags(pflags, PF as unknown as Record<string, number>, rec["player-flags"], "race player");
  const elInfo = newElemInfo();
  applyRaceValues(elInfo, rec.values);

  return {
    ridx,
    name: rec.name,
    hitdie: rec.hitdie,
    expFactor: rec.exp,
    baseAge: rec.age.base_age,
    modAge: rec.age.mod_age,
    baseHeight: rec.height.base_hgt,
    modHeight: rec.height.mod_hgt,
    baseWeight: rec.weight.base_wgt,
    modWeight: rec.weight.mod_wgt,
    infravision: rec.infravision,
    body: 0,
    statAdj: statAdj(rec.stats),
    skills: raceSkills(rec),
    flags,
    pflags,
    historyChart: rec.history,
    elInfo,
  };
}

/** Read the ten skill-* directives (class form: base + incr). */
function classSkills(rec: ClassRecordJson): {
  skills: number[];
  extra: number[];
} {
  const skills = new Array<number>(SKILL_MAX).fill(0);
  const extra = new Array<number>(SKILL_MAX).fill(0);
  const put = (idx: number, s: ClassSkillJson): void => {
    skills[idx] = s.base;
    extra[idx] = s.incr;
  };
  put(SKILL.DISARM_PHYS, rec["skill-disarm-phys"]);
  put(SKILL.DISARM_MAGIC, rec["skill-disarm-magic"]);
  put(SKILL.DEVICE, rec["skill-device"]);
  put(SKILL.SAVE, rec["skill-save"]);
  put(SKILL.STEALTH, rec["skill-stealth"]);
  put(SKILL.SEARCH, rec["skill-search"]);
  put(SKILL.TO_HIT_MELEE, rec["skill-melee"]);
  put(SKILL.TO_HIT_BOW, rec["skill-shoot"]);
  put(SKILL.TO_HIT_THROW, rec["skill-throw"]);
  put(SKILL.DIGGING, rec["skill-dig"]);
  return { skills, extra };
}

function bindClassMagic(
  rec: ClassRecordJson,
  realms: Map<string, MagicRealm>,
): ClassMagic {
  const magic = rec.magic;
  if (!magic) {
    return { spellFirst: 0, spellWeight: 0, numBooks: 0, totalSpells: 0, books: [] };
  }
  const books: ClassBook[] = [];
  let sidx = 0;
  const bookRecs = rec.book ?? [];
  for (let bidx = 0; bidx < bookRecs.length; bidx++) {
    const b = bookRecs[bidx] as ClassBookJson;
    const realm = realms.get(b.realm);
    if (!realm) {
      throw new Error(`player: class ${rec.name}: unknown realm ${b.realm}`);
    }
    const spells: ClassSpell[] = [];
    for (const s of b.spell ?? []) {
      spells.push({
        name: s.name,
        sidx: sidx++,
        bidx,
        level: s.level,
        mana: s.mana,
        fail: s.fail,
        exp: s.exp,
        realm,
        effectsRaw: s.effect ? [...s.effect] : [],
        text: joinLines(s.desc),
      });
    }
    books.push({
      tval: b.tval,
      tvalIdx: 0,
      sval: 0,
      dungeon: b.quality === "dungeon",
      name: b.name,
      realm,
      numSpells: b.spells,
      spells,
      graphics: b["book-graphics"] ?? null,
      properties: b["book-properties"] ?? null,
    });
  }
  return {
    spellFirst: magic.first,
    spellWeight: magic.weight,
    numBooks: magic.books,
    totalSpells: sidx,
    books,
  };
}

function bindClass(
  rec: ClassRecordJson,
  cidx: number,
  realms: Map<string, MagicRealm>,
): PlayerClass {
  const flags = new FlagSet(OF_SIZE);
  grabFlags(flags, OF as unknown as Record<string, number>, rec["obj-flags"], "class object");
  const pflags = new FlagSet(PF_SIZE);
  grabFlags(pflags, PF as unknown as Record<string, number>, rec["player-flags"], "class player");

  const { skills, extra } = classSkills(rec);

  const startItems: StartItem[] = (rec.equip ?? []).map((e) => ({
    tval: e.tval,
    sval: e.sval,
    min: e.min,
    max: e.max,
    eopts: parseEopts(e.eopts),
  }));

  return {
    cidx,
    name: rec.name,
    titles: rec.title ? [...rec.title] : [],
    statAdj: statAdj(rec.stats),
    skills,
    extraSkills: extra,
    hitdie: rec.hitdie,
    expFactor: rec.exp ?? 0,
    flags,
    pflags,
    maxAttacks: rec["max-attacks"],
    minWeight: rec["min-weight"],
    attMultiply: rec["strength-multiplier"],
    startItems,
    magic: bindClassMagic(rec, realms),
  };
}
