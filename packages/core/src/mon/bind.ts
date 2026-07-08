/**
 * Monster registries, ported from the gamedata binding semantics in
 * reference/src/mon-init.c (Angband 4.2.6).
 *
 * bindMonsters() takes parsed pack JSON records (no fs here) and produces
 * a MonsterRegistry. Binding follows the upstream parser actions exactly;
 * the important subtleties are noted inline:
 *
 * - Base inheritance (parse_monster_base): the race first copies the
 *   base's display glyph and ORs in the base's flags; the race's own
 *   flags: lines then OR on top and flags-off: lines remove flags (which
 *   may remove inherited base flags, e.g. green glutton ghost drops the
 *   ghost base's IM_COLD).
 * - depth: sets spell_power = level as a default; a later spell-power:
 *   line overrides it (parse_monster_depth / parse_monster_spell_power).
 * - innate-freq / spell-freq percentages are stored as 100 / pct with C
 *   integer division (parse_monster_innate_freq / parse_monster_spell_freq).
 * - spells: after ORing the RSF flags, parse_monster_spells defaults
 *   freq_innate to 4 when the race has innate spells but no innate-freq,
 *   and freq_spell to 4 when it has non-(breath|innate) spells but no
 *   spell-freq. Breaths count as innate for frequency purposes.
 * - Monster spells (parse_mon_spell_*): each spell starts with one level
 *   record at power 0; every power-cutoff: line appends a level, and lore
 *   and message lines always apply to the last level.
 * - finish_parse_monster resolves friends names to races afterwards
 *   ("same", case-insensitive, binds the race to itself) and shape names
 *   to a base if one matches, else a race.
 * - max_num is not gamedata: player-birth.c resets it to 100, or 1 for
 *   uniques. Binding applies that rule so allocation can use it.
 *
 * Moddability: registries accept any record arrays of the same shapes;
 * mods extend the game by concatenating their records onto the pack's
 * before binding.
 */

import { FlagSet } from "../bitflag";
import { colorCharToAttr, colorTextToAttr } from "../color";
import { Dice } from "../dice";
import { MFLAG_SIZE, monSpellsOfTypes, MON_GROUP, RF_SIZE, RSF_SIZE } from "./types";
import type {
  BlowEffect,
  BlowMethod,
  MonsterAltMsg,
  MonsterBase,
  MonsterBlow,
  MonsterDrop,
  MonsterFriends,
  MonsterFriendsBase,
  MonsterGroupRole,
  MonsterMimic,
  MonsterRace,
  MonsterShape,
  MonsterSpell,
  MonsterSpellEffect,
  MonsterSpellLevel,
  Pain,
  PitProfile,
  SummonType,
} from "./types";
import { RF, RSF } from "../generated";

/* re-export for consumers that reach the domain through bind */
export { MFLAG_SIZE, RF_SIZE, RSF_SIZE };

/** pain.json record. */
export interface PainRecordJson {
  type: number;
  message: string[];
}

/** blow_methods.json record. */
export interface BlowMethodRecordJson {
  name: string;
  cut?: number;
  stun?: number;
  miss?: number;
  phys?: number;
  msg?: string;
  act?: string[];
  desc?: string[];
}

/** blow_effects.json record. */
export interface BlowEffectRecordJson {
  name: string;
  power?: number;
  eval?: number;
  desc?: string[];
  "lore-color-base"?: string;
  "lore-color-resist"?: string;
  "lore-color-immune"?: string;
  "effect-type"?: string;
  resist?: string;
  "lash-type"?: string;
}

/** monster_spell.json effect line. */
export interface SpellEffectJson {
  eff: string;
  type?: string;
  radius?: number;
  other?: number;
  dice?: string;
  expr?: Array<{ name: string; base: string; expr: string }>;
}

/** monster_spell.json power-cutoff entry (same lore/message fields). */
export interface SpellCutoffJson {
  power: number;
  lore?: string[];
  "lore-color-base"?: string;
  "lore-color-resist"?: string;
  "lore-color-immune"?: string;
  "message-vis"?: string[];
  "message-invis"?: string[];
  "message-miss"?: string[];
  "message-save"?: string[];
}

/** monster_spell.json record. */
export interface MonsterSpellRecordJson {
  name: string;
  msgt?: string;
  hit?: number;
  effect?: SpellEffectJson[];
  lore?: string[];
  "lore-color-base"?: string;
  "lore-color-resist"?: string;
  "lore-color-immune"?: string;
  "message-vis"?: string[];
  "message-invis"?: string[];
  "message-miss"?: string[];
  "message-save"?: string[];
  "power-cutoff"?: SpellCutoffJson[];
}

/** monster_base.json record. */
export interface MonsterBaseRecordJson {
  name: string;
  glyph: string;
  pain: number;
  flags?: string[];
  desc?: string[];
}

/** monster.json blow line. */
export interface MonsterBlowJson {
  method: string;
  effect?: string;
  damage?: string;
}

/** monster.json drop / drop-base lines. */
export interface MonsterDropJson {
  tval: string;
  sval?: string;
  chance: number;
  min: number;
  max: number;
}

/** monster.json friends / friends-base lines. */
export interface MonsterFriendsJson {
  chance: number;
  number: string;
  name: string;
  role?: string;
}

/** monster.json message-vis / message-invis / message-miss lines. */
export interface MonsterAltMsgJson {
  spell: string;
  message?: string;
}

/** monster.json record. */
export interface MonsterRecordJson {
  name: string;
  plural?: string;
  base: string;
  glyph?: string;
  color: string;
  speed?: number;
  "hit-points"?: number;
  light?: number;
  hearing?: number;
  smell?: number;
  "armor-class"?: number;
  sleepiness?: number;
  depth?: number;
  rarity?: number;
  experience?: number;
  blow?: MonsterBlowJson[];
  flags?: string[];
  "flags-off"?: string[];
  desc?: string[];
  "innate-freq"?: number;
  "spell-freq"?: number;
  "spell-power"?: number;
  spells?: string[];
  "message-vis"?: MonsterAltMsgJson[];
  "message-invis"?: MonsterAltMsgJson[];
  "message-miss"?: MonsterAltMsgJson[];
  drop?: MonsterDropJson[];
  "drop-base"?: MonsterDropJson[];
  friends?: MonsterFriendsJson[];
  "friends-base"?: MonsterFriendsJson[];
  mimic?: Array<{ tval: string; sval: string }>;
  shape?: string[];
  "color-cycle"?: { group: string; cycle: string };
}

/** summon.json record. */
export interface SummonRecordJson {
  name: string;
  msgt?: string;
  uniques?: number;
  base?: string[];
  "race-flag"?: string;
  fallback?: string;
  desc?: string;
}

/** pit.json record. */
export interface PitRecordJson {
  name: string;
  room?: number;
  alloc?: { rarity: number; level: number };
  "obj-rarity"?: number;
  "mon-base"?: string[];
  color?: string[];
  "flags-req"?: string[];
  "flags-ban"?: string[];
  "spell-req"?: string[];
  "spell-ban"?: string[];
  "mon-ban"?: string[];
  "innate-freq"?: number;
}

/** All pack inputs bindMonsters needs; each is the file's records array. */
export interface MonsterPackRecords {
  pain: PainRecordJson[];
  blowMethods: BlowMethodRecordJson[];
  blowEffects: BlowEffectRecordJson[];
  monsterSpells: MonsterSpellRecordJson[];
  monsterBases: MonsterBaseRecordJson[];
  monsters: MonsterRecordJson[];
  summons: SummonRecordJson[];
  pits: PitRecordJson[];
}

export interface BindMonstersOptions {
  /** z_info->max_sight; hearing/smell scale by maxSight / 20. */
  maxSight?: number;
}

/** string_append semantics: desc lines concatenate without a separator. */
function joinLines(lines: string[] | undefined): string {
  return lines ? lines.join("") : "";
}

/** grab_flag over RF names ("A | B" segments); throws on unknown names. */
function raceFlagsOn(flags: FlagSet, lines: string[] | undefined): void {
  if (!lines) return;
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = (RF as Record<string, number>)[name];
      if (value === undefined || value === 0) {
        throw new Error(`mon: bad monster race flag: ${name}`);
      }
      flags.on(value);
    }
  }
}

/** remove_flag over RF names (flags-off). */
function raceFlagsOff(flags: FlagSet, lines: string[] | undefined): void {
  if (!lines) return;
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = (RF as Record<string, number>)[name];
      if (value === undefined || value === 0) {
        throw new Error(`mon: bad monster race flag: ${name}`);
      }
      flags.off(value);
    }
  }
}

/** grab_flag over RSF names. */
function spellFlagsOn(flags: FlagSet, lines: string[] | undefined): void {
  if (!lines) return;
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = (RSF as Record<string, number>)[name];
      if (value === undefined || value === 0) {
        throw new Error(`mon: bad monster spell flag: ${name}`);
      }
      flags.on(value);
    }
  }
}

function parseDice(raw: string | undefined): Dice | null {
  if (raw === undefined) return null;
  const dice = new Dice();
  if (!dice.parseString(raw)) {
    throw new Error(`mon: invalid dice string: ${raw}`);
  }
  return dice;
}

/** friends role: servant / bodyguard, default member (parse_monster_friends). */
function friendRole(role: string | undefined): MonsterGroupRole {
  if (role === undefined) return MON_GROUP.MEMBER;
  if (role === "servant") return MON_GROUP.SERVANT;
  if (role === "bodyguard") return MON_GROUP.BODYGUARD;
  throw new Error(`mon: invalid monster role: ${role}`);
}

/** parser rand "2d1" -> dice/side pair for friends counts. */
function parseNumberPair(raw: string): { dice: number; side: number } {
  const d = new Dice();
  if (!d.parseString(raw)) {
    throw new Error(`mon: invalid number dice: ${raw}`);
  }
  const rv = d.randomValue();
  return { dice: rv.dice, side: rv.sides };
}

function bindPains(records: PainRecordJson[]): Map<number, Pain> {
  const map = new Map<number, Pain>();
  for (const rec of records) {
    if (rec.message.length > 7) {
      throw new Error(`mon: pain ${rec.type} has too many messages`);
    }
    map.set(rec.type, { painIdx: rec.type, messages: [...rec.message] });
  }
  return map;
}

function bindBlowMethods(
  records: BlowMethodRecordJson[],
): Map<string, BlowMethod> {
  const map = new Map<string, BlowMethod>();
  for (const rec of records) {
    map.set(rec.name, {
      name: rec.name,
      cut: rec.cut === 1,
      stun: rec.stun === 1,
      miss: rec.miss === 1,
      phys: rec.phys === 1,
      msgt: rec.msg ?? "GENERIC",
      messages: rec.act ? [...rec.act] : [],
      desc: joinLines(rec.desc),
    });
  }
  return map;
}

function bindBlowEffects(
  records: BlowEffectRecordJson[],
): Map<string, BlowEffect> {
  const map = new Map<string, BlowEffect>();
  for (const rec of records) {
    map.set(rec.name, {
      name: rec.name,
      power: rec.power ?? 0,
      eval: rec.eval ?? 0,
      desc: joinLines(rec.desc),
      loreColorBase: rec["lore-color-base"] ?? "",
      loreColorResist: rec["lore-color-resist"] ?? "",
      loreColorImmune: rec["lore-color-immune"] ?? "",
      effectType: rec["effect-type"] ?? "",
      resist: rec.resist ?? null,
      lashType: rec["lash-type"] ?? null,
    });
  }
  return map;
}

function bindSpellLevel(
  power: number,
  rec: SpellCutoffJson | MonsterSpellRecordJson,
): MonsterSpellLevel {
  return {
    power,
    loreDesc: joinLines(rec.lore),
    loreColorBase: rec["lore-color-base"] ?? "",
    loreColorResist: rec["lore-color-resist"] ?? "",
    loreColorImmune: rec["lore-color-immune"] ?? "",
    message: joinLines(rec["message-vis"]),
    blindMessage: joinLines(rec["message-invis"]),
    missMessage: joinLines(rec["message-miss"]),
    saveMessage: joinLines(rec["message-save"]),
  };
}

function bindSpells(
  records: MonsterSpellRecordJson[],
): Map<number, MonsterSpell> {
  const map = new Map<number, MonsterSpell>();
  for (const rec of records) {
    const index = (RSF as Record<string, number>)[rec.name];
    if (index === undefined) {
      throw new Error(`mon: invalid spell name: ${rec.name}`);
    }
    const effects: MonsterSpellEffect[] = [];
    for (const e of rec.effect ?? []) {
      const dice = parseDice(e.dice);
      const exprs = e.expr ? e.expr.map((x) => ({ ...x })) : [];
      effects.push({
        eff: e.eff,
        type: e.type ?? null,
        radius: e.radius ?? 0,
        other: e.other ?? 0,
        dice,
        diceRaw: e.dice ?? null,
        exprs,
      });
    }
    const levels: MonsterSpellLevel[] = [bindSpellLevel(0, rec)];
    for (const cut of rec["power-cutoff"] ?? []) {
      levels.push(bindSpellLevel(cut.power, cut));
    }
    map.set(index, {
      index,
      name: rec.name,
      msgt: rec.msgt ?? "GENERIC",
      hit: rec.hit ?? 0,
      effects,
      levels,
    });
  }
  return map;
}

function bindBases(
  records: MonsterBaseRecordJson[],
  pains: Map<number, Pain>,
): Map<string, MonsterBase> {
  const map = new Map<string, MonsterBase>();
  for (const rec of records) {
    const pain = pains.get(rec.pain);
    if (!pain) {
      throw new Error(`mon: base ${rec.name}: pain ${rec.pain} out of bounds`);
    }
    const flags = new FlagSet(RF_SIZE);
    raceFlagsOn(flags, rec.flags);
    map.set(rec.name, {
      name: rec.name,
      text: joinLines(rec.desc),
      flags,
      glyph: rec.glyph,
      pain,
    });
  }
  return map;
}

/** RSF mask of innate spells (create_mon_spell_mask(RST_INNATE)). */
function innateMask(): FlagSet {
  const mask = new FlagSet(RSF_SIZE);
  for (const f of monSpellsOfTypes("RST_INNATE")) mask.on(f);
  return mask;
}

/** RSF mask of breath or innate spells. */
function breathOrInnateMask(): FlagSet {
  const mask = new FlagSet(RSF_SIZE);
  for (const f of monSpellsOfTypes("RST_BREATH", "RST_INNATE")) mask.on(f);
  return mask;
}

function bindAltMsgs(
  out: MonsterAltMsg[],
  lines: MonsterAltMsgJson[] | undefined,
  msgType: MonsterAltMsg["msgType"],
): void {
  if (!lines) return;
  for (const line of lines) {
    const index = (RSF as Record<string, number>)[line.spell];
    if (index === undefined || index === 0) {
      throw new Error(`mon: invalid spell name in message: ${line.spell}`);
    }
    const message = line.message ?? "";
    out.push({
      index,
      msgType,
      message: message.trim().length === 0 ? "" : message,
    });
  }
}

function bindDrops(
  out: MonsterDrop[],
  lines: MonsterDropJson[] | undefined,
): void {
  if (!lines) return;
  for (const d of lines) {
    out.push({
      tval: d.tval,
      sval: d.sval ?? null,
      percentChance: d.chance,
      min: d.min,
      max: d.max,
    });
  }
}

function pctToFreq(pct: number, what: string): number {
  if (pct < 1 || pct > 100) {
    throw new Error(`mon: invalid ${what} percentage: ${pct}`);
  }
  return Math.trunc(100 / pct);
}

/** Registry of everything the monster domain binds from the pack. */
export class MonsterRegistry {
  readonly pains: Map<number, Pain>;
  readonly blowMethods: Map<string, BlowMethod>;
  readonly blowEffects: Map<string, BlowEffect>;
  /** RSF index -> spell. */
  readonly spells: Map<number, MonsterSpell>;
  readonly bases: Map<string, MonsterBase>;
  /** Record order mirrors monster.txt; ridx is the array index. */
  readonly races: MonsterRace[];
  readonly summons: SummonType[];
  readonly pits: PitProfile[];

  private readonly racesByName: Map<string, MonsterRace>;

  constructor(pack: MonsterPackRecords, options: BindMonstersOptions = {}) {
    const maxSight = options.maxSight ?? 20;

    this.pains = bindPains(pack.pain);
    this.blowMethods = bindBlowMethods(pack.blowMethods);
    this.blowEffects = bindBlowEffects(pack.blowEffects);
    this.spells = bindSpells(pack.monsterSpells);
    this.bases = bindBases(pack.monsterBases, this.pains);

    const innate = innateMask();
    const breathOrInnate = breathOrInnateMask();

    this.races = [];
    this.racesByName = new Map();
    for (const rec of pack.monsters) {
      const race = this.bindRace(rec, maxSight, innate, breathOrInnate);
      this.races.push(race);
      this.racesByName.set(race.name.toLowerCase(), race);
    }

    /* finish_parse_monster: resolve friends and shape names to races. */
    for (const race of this.races) {
      for (const f of race.friends) {
        f.race =
          f.name.toLowerCase() === "same" ? race : this.raceByName(f.name);
        if (!f.race) {
          throw new Error(
            `mon: could not find friend named '${f.name}' for '${race.name}'`,
          );
        }
      }
      for (const s of race.shapes) {
        if (s.base) continue;
        s.race = this.raceByName(s.name);
        if (!s.race) {
          throw new Error(
            `mon: could not find shape named '${s.name}' for '${race.name}'`,
          );
        }
      }
    }

    this.summons = pack.summons.map((rec) => ({
      name: rec.name,
      msgt: rec.msgt ?? "GENERIC",
      uniquesAllowed: rec.uniques === 1,
      baseNames: rec.base ? [...rec.base] : [],
      raceFlag: rec["race-flag"] ?? null,
      fallbackName: rec.fallback ?? null,
      desc: rec.desc ?? "",
    }));

    this.pits = pack.pits.map((rec) => ({
      name: rec.name,
      room: rec.room ?? 0,
      allocRarity: rec.alloc?.rarity ?? 0,
      allocLevel: rec.alloc?.level ?? 0,
      objRarity: rec["obj-rarity"] ?? 0,
      baseNames: rec["mon-base"] ? [...rec["mon-base"]] : [],
      colors: rec.color ? [...rec.color] : [],
      flagsReq: rec["flags-req"] ? [...rec["flags-req"]] : [],
      flagsBan: rec["flags-ban"] ? [...rec["flags-ban"]] : [],
      spellReq: rec["spell-req"] ? [...rec["spell-req"]] : [],
      spellBan: rec["spell-ban"] ? [...rec["spell-ban"]] : [],
      monBan: rec["mon-ban"] ? [...rec["mon-ban"]] : [],
      freqInnate: rec["innate-freq"] ?? 0,
    }));
  }

  /**
   * lookup_monster (mon-util.c): exact case-insensitive match first,
   * else the first race (lowest ridx) whose name contains the query as
   * a case-insensitive substring. The shipped monster.txt relies on the
   * substring fallback ("friends:100:4d4:spider" on ancient spider).
   */
  raceByName(name: string): MonsterRace | null {
    const exact = this.racesByName.get(name.toLowerCase());
    if (exact) return exact;
    const query = name.toLowerCase();
    for (const race of this.races) {
      if (race.name.toLowerCase().includes(query)) return race;
    }
    return null;
  }

  private bindRace(
    rec: MonsterRecordJson,
    maxSight: number,
    innate: FlagSet,
    breathOrInnate: FlagSet,
  ): MonsterRace {
    const base = this.bases.get(rec.base);
    if (!base) {
      throw new Error(`mon: race ${rec.name}: invalid base ${rec.base}`);
    }

    /* parse_monster_base: default glyph and ORed base flags. */
    const flags = new FlagSet(RF_SIZE);
    flags.union(base.flags);
    let dChar = base.glyph;

    /* parse_monster_glyph: explicit glyph overrides the template. */
    if (rec.glyph !== undefined) dChar = rec.glyph;

    /* parse_monster_color: single chars and full names both allowed. */
    const dAttr =
      rec.color.length > 1
        ? colorTextToAttr(rec.color)
        : colorCharToAttr(rec.color);
    if (dAttr < 0) {
      throw new Error(`mon: race ${rec.name}: invalid color ${rec.color}`);
    }

    /* flags: then flags-off:, applied after base inheritance. */
    raceFlagsOn(flags, rec.flags);
    raceFlagsOff(flags, rec["flags-off"]);

    const blows: MonsterBlow[] = [];
    for (const b of rec.blow ?? []) {
      const method = this.blowMethods.get(b.method);
      if (!method) {
        throw new Error(`mon: race ${rec.name}: unrecognised blow ${b.method}`);
      }
      const effect = this.blowEffects.get(b.effect ?? "NONE");
      if (!effect) {
        throw new Error(
          `mon: race ${rec.name}: invalid blow effect ${b.effect}`,
        );
      }
      blows.push({
        method,
        effect,
        dice: parseDice(b.damage),
        diceRaw: b.damage ?? null,
      });
    }

    const level = rec.depth ?? 0;

    /* innate-freq / spell-freq stored as 100 / pct (C int division). */
    let freqInnate =
      rec["innate-freq"] !== undefined
        ? pctToFreq(rec["innate-freq"], "innate frequency")
        : 0;
    let freqSpell =
      rec["spell-freq"] !== undefined
        ? pctToFreq(rec["spell-freq"], "spell frequency")
        : 0;

    /* depth defaults spell_power to level; spell-power overrides. */
    const spellPower = rec["spell-power"] ?? level;

    const spellFlags = new FlagSet(RSF_SIZE);
    if (rec.spells) {
      spellFlagsOn(spellFlags, rec.spells);

      /* parse_monster_spells frequency defaults. */
      const current = spellFlags.clone();
      current.inter(innate);
      if (!current.isEmpty() && freqInnate === 0) freqInnate = 4;

      const nonInnate = spellFlags.clone();
      nonInnate.diff(breathOrInnate);
      if (!nonInnate.isEmpty() && freqSpell === 0) freqSpell = 4;
    }

    const spellMsgs: MonsterAltMsg[] = [];
    bindAltMsgs(spellMsgs, rec["message-vis"], "seen");
    bindAltMsgs(spellMsgs, rec["message-invis"], "unseen");
    bindAltMsgs(spellMsgs, rec["message-miss"], "miss");

    const drops: MonsterDrop[] = [];
    bindDrops(drops, rec.drop);
    bindDrops(drops, rec["drop-base"]);

    const friends: MonsterFriends[] = [];
    for (const f of rec.friends ?? []) {
      const num = parseNumberPair(f.number);
      friends.push({
        name: f.name,
        race: null,
        role: friendRole(f.role),
        percentChance: f.chance,
        numberDice: num.dice,
        numberSide: num.side,
      });
    }

    const friendsBase: MonsterFriendsBase[] = [];
    for (const f of rec["friends-base"] ?? []) {
      const fb = this.bases.get(f.name);
      if (!fb) {
        throw new Error(
          `mon: race ${rec.name}: invalid friends base ${f.name}`,
        );
      }
      const num = parseNumberPair(f.number);
      friendsBase.push({
        base: fb,
        role: friendRole(f.role),
        percentChance: f.chance,
        numberDice: num.dice,
        numberSide: num.side,
      });
    }

    const mimicKinds: MonsterMimic[] = (rec.mimic ?? []).map((m) => ({
      tval: m.tval,
      sval: m.sval,
    }));

    /* parse_monster_shape: a base name wins; races resolve second-pass. */
    const shapes: MonsterShape[] = (rec.shape ?? []).map((name) => ({
      name,
      race: null,
      base: this.bases.get(name) ?? null,
    }));

    const unique = flags.has(RF.UNIQUE);

    return {
      ridx: this.races.length,
      name: rec.name,
      text: joinLines(rec.desc),
      plural: rec.plural ?? null,
      base,
      avgHp: rec["hit-points"] ?? 0,
      ac: rec["armor-class"] ?? 0,
      sleep: rec.sleepiness ?? 0,
      hearing: Math.trunc(((rec.hearing ?? 0) * maxSight) / 20),
      smell: Math.trunc(((rec.smell ?? 0) * maxSight) / 20),
      speed: rec.speed ?? 0,
      light: rec.light ?? 0,
      mexp: rec.experience ?? 0,
      freqInnate,
      freqSpell,
      spellPower,
      flags,
      spellFlags,
      blows,
      level,
      rarity: rec.rarity ?? 0,
      dAttr,
      dChar,
      maxNum: unique ? 1 : 100,
      curNum: 0,
      spellMsgs,
      drops,
      friends,
      friendsBase,
      mimicKinds,
      shapes,
    };
  }
}

/** Bind all monster-domain pack records into a registry. */
export function bindMonsters(
  pack: MonsterPackRecords,
  options: BindMonstersOptions = {},
): MonsterRegistry {
  return new MonsterRegistry(pack, options);
}
