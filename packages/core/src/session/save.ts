/**
 * JSON save/load (PORT_PLAN.md decision 9): the entity serializers that
 * turn a live GameState into plain JSON and back. The format is the port's
 * own (the C binary blocks of save.c/load.c are replaced by design); WHAT
 * is saved follows upstream savefile semantics - notably the RNG state is
 * persisted (save.c wr_randomizer), which is what the no-save-scum posture
 * rides on (decisions 16/22): reloading resumes the same stream.
 *
 * References into bound registries (races, kinds, egos, artifacts, trap
 * kinds, classes) are saved as stable indices/names and re-resolved against
 * the pack on load, so a save is data + pack, never code. Raw effect chains
 * and kind-owned text re-point at the kind on load rather than being
 * copied into the save.
 *
 * Integrity: serializeGame produces the JSON payload; callers stamp/verify
 * bytes with save/integrity.ts (stampSavefile / verifyStampedSavefile),
 * the decision-16b tamper deterrent.
 */

import type { Loc } from "../loc";
import { loc } from "../loc";
import type { RngState } from "../rng";
import type { RandomValue } from "../rng";
import { FlagSet } from "../bitflag";
import { Chunk } from "../world/chunk";
import type { ChunkSquaresData } from "../world/chunk";
import type { GameObject } from "../obj/object";
import type { ObjRegistry } from "../obj/bind";
import type { ElementInfo } from "../obj/types";
import type { AutoinscriptionRegistry } from "../obj/knowledge";
import { blankMonster, GROUP_MAX } from "../mon/monster";
import type { Monster, MonsterGroupInfo } from "../mon/monster";
import type { MonsterLore } from "../mon/lore";
import type { MonsterRegistry } from "../mon/bind";
import { blankPlayer } from "../player/player";
import type { Player, PlayerQuest } from "../player/player";
import type { PlayerRegistry } from "../player/bind";
import type { HistoryInfo } from "../player/history";
import type { TrapKind } from "../world/trap";
import type { GameState, MonsterGroup, StoredLevel } from "../game/context";
import type { Trap } from "../game/trap";
import type { Gear } from "../game/gear";
import { newKnownMap } from "../game/known";
import type { KnownMap } from "../game/known";
import {
  fnv1aIntegrity,
  stampSavefile,
  verifyStampedSavefile,
} from "../save/integrity";
import type { SaveIntegrity } from "../save/integrity";
import type { ContentIdResolver } from "../mod/ids";
import type {
  ModBag,
  OrphanStore,
  SaveManifest,
} from "../mod/save-blocks";

/**
 * The save format version this build writes. Version 2 replaced every numeric
 * content index (kidx/eidx/aidx/ridx/tidx/feat, and the positional curse/
 * brand/slay arrays) with the namespaced string ids of mod/ids.ts, the
 * load-bearing rule of the mod substrate (MOD_LIFECYCLE decision 1). Version-1
 * saves are not migrated: the game is pre-1.0 and the save format is still
 * settling, so loadGame rejects them and the host starts a fresh game.
 */
export const SAVE_VERSION = 2;

/* ------------------------------------------------------------------ *
 * Objects.
 * ------------------------------------------------------------------ */

export interface SavedObject {
  /** Namespaced kind id (mod/ids.ts), e.g. "core:sword:dagger". */
  kindId: string;
  /** Ego id, or null when the object has no ego. */
  egoId: string | null;
  /** Artifact id, or null when the object is not an artifact. */
  artifactId: string | null;
  grid: { x: number; y: number } | null;
  tval: number;
  sval: number;
  pval: number;
  weight: number;
  dd: number;
  ds: number;
  ac: number;
  toA: number;
  toH: number;
  toD: number;
  flags: number[];
  modifiers: number[];
  elInfo: ElementInfo[];
  /** Brand ids present on the object (the sparse form of the boolean array). */
  brands: string[] | null;
  /** Slay ids present on the object. */
  slays: string[] | null;
  /** Curse ids with their rolled power/timeout (sparse form). */
  curses: Array<{ id: string; power: number; timeout: number }> | null;
  time: RandomValue;
  timeout: number;
  number: number;
  notice: number;
  heldMIdx: number;
  mimickingMIdx: number;
  origin: number;
  originDepth: number;
  /** Origin monster race id, or null when there is no origin race. */
  originRaceId: string | null;
  note: string | null;
}

export function serializeObject(
  obj: GameObject,
  ids: ContentIdResolver,
): SavedObject {
  return {
    kindId: ids.kindId(obj.kind.kidx),
    egoId: obj.ego ? ids.egoId(obj.ego.eidx) : null,
    artifactId: obj.artifact ? ids.artifactId(obj.artifact.aidx) : null,
    grid: obj.grid ? { x: obj.grid.x, y: obj.grid.y } : null,
    tval: obj.tval,
    sval: obj.sval,
    pval: obj.pval,
    weight: obj.weight,
    dd: obj.dd,
    ds: obj.ds,
    ac: obj.ac,
    toA: obj.toA,
    toH: obj.toH,
    toD: obj.toD,
    flags: Array.from(obj.flags.bits),
    modifiers: [...obj.modifiers],
    elInfo: obj.elInfo.map((e) => ({ ...e })),
    brands: serializeBrandList(obj.brands, ids),
    slays: serializeSlayList(obj.slays, ids),
    curses: serializeCurseList(obj.curses, ids),
    time: { ...obj.time },
    timeout: obj.timeout,
    number: obj.number,
    notice: obj.notice,
    heldMIdx: obj.heldMIdx,
    mimickingMIdx: obj.mimickingMIdx,
    origin: obj.origin,
    originDepth: obj.originDepth,
    originRaceId: obj.originRace ? ids.raceId(obj.originRace) : null,
    note: obj.note,
  };
}

/** Brand booleans -> the ids of the set brands (drops the dense zeroes). */
function serializeBrandList(
  brands: boolean[] | null,
  ids: ContentIdResolver,
): string[] | null {
  if (!brands) return null;
  const out: string[] = [];
  for (let i = 1; i < brands.length; i++) if (brands[i]) out.push(ids.brandId(i));
  return out;
}

/** Slay booleans -> the ids of the set slays. */
function serializeSlayList(
  slays: boolean[] | null,
  ids: ContentIdResolver,
): string[] | null {
  if (!slays) return null;
  const out: string[] = [];
  for (let i = 1; i < slays.length; i++) if (slays[i]) out.push(ids.slayId(i));
  return out;
}

/** Curse data array -> {id,power,timeout} for the powered curses only. */
function serializeCurseList(
  curses: Array<{ power: number; timeout: number }> | null,
  ids: ContentIdResolver,
): Array<{ id: string; power: number; timeout: number }> | null {
  if (!curses) return null;
  const out: Array<{ id: string; power: number; timeout: number }> = [];
  for (let i = 1; i < curses.length; i++) {
    const c = curses[i];
    if (c && c.power > 0) {
      out.push({ id: ids.curseId(i), power: c.power, timeout: c.timeout });
    }
  }
  return out.length > 0 ? out : null;
}

/** obj_k->curses (power 1 = rune known) -> the ids of the known curses. */
function serializeKnownCurseList(
  curses: number[],
  ids: ContentIdResolver,
): string[] {
  const out: string[] = [];
  for (let i = 1; i < curses.length; i++) if (curses[i]) out.push(ids.curseId(i));
  return out;
}

export function deserializeObject(
  data: SavedObject,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): GameObject {
  const kidx = ids.kindIndex(data.kindId);
  const kind = kidx !== undefined ? reg.kinds[kidx] : undefined;
  if (!kind) throw new Error(`save: unknown object kind ${data.kindId}`);
  const aIdx =
    data.artifactId !== null ? ids.artifactIndex(data.artifactId) : undefined;
  const artifact = aIdx !== undefined ? (reg.artifacts[aIdx] ?? null) : null;
  const eIdx = data.egoId !== null ? ids.egoIndex(data.egoId) : undefined;
  const ego = eIdx !== undefined ? (reg.egos[eIdx] ?? null) : null;
  const originIdx =
    data.originRaceId !== null ? ids.raceIndex(data.originRaceId) : undefined;
  return {
    kind,
    ego,
    artifact,
    grid: data.grid ? loc(data.grid.x, data.grid.y) : null,
    tval: data.tval,
    sval: data.sval,
    pval: data.pval,
    weight: data.weight,
    dd: data.dd,
    ds: data.ds,
    ac: data.ac,
    toA: data.toA,
    toH: data.toH,
    toD: data.toD,
    flags: new FlagSet(Uint8Array.from(data.flags)),
    modifiers: [...data.modifiers],
    elInfo: data.elInfo.map((e) => ({ ...e })),
    brands: deserializeBrandList(data.brands, reg, ids),
    slays: deserializeSlayList(data.slays, reg, ids),
    curses: deserializeCurseList(data.curses, reg, ids),
    /* Kind-owned data re-points at the bound kind. */
    effect: kind.effect,
    effectMsg: kind.effectMsg,
    activation: (artifact ? artifact.activation : null) ?? kind.activation,
    time: { ...data.time },
    timeout: data.timeout,
    number: data.number,
    notice: data.notice,
    heldMIdx: data.heldMIdx,
    mimickingMIdx: data.mimickingMIdx,
    origin: data.origin,
    originDepth: data.originDepth,
    originRace: originIdx ?? 0,
    note: data.note,
  };
}

/** Brand ids -> the dense boolean array (length brandMax), or null. */
function deserializeBrandList(
  saved: string[] | null,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): boolean[] | null {
  if (!saved) return null;
  const out = new Array<boolean>(reg.brandMax).fill(false);
  for (const id of saved) {
    const i = ids.brandIndex(id);
    if (i !== undefined) out[i] = true;
  }
  return out;
}

/** Slay ids -> the dense boolean array (length slayMax), or null. */
function deserializeSlayList(
  saved: string[] | null,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): boolean[] | null {
  if (!saved) return null;
  const out = new Array<boolean>(reg.slayMax).fill(false);
  for (const id of saved) {
    const i = ids.slayIndex(id);
    if (i !== undefined) out[i] = true;
  }
  return out;
}

/** Curse id list -> the dense CurseData array (length curseMax), or null. */
function deserializeCurseList(
  saved: Array<{ id: string; power: number; timeout: number }> | null,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): Array<{ power: number; timeout: number }> | null {
  if (!saved) return null;
  const out: Array<{ power: number; timeout: number }> = [];
  for (let i = 0; i < reg.curseMax; i++) out.push({ power: 0, timeout: 0 });
  for (const c of saved) {
    const i = ids.curseIndex(c.id);
    if (i !== undefined) out[i] = { power: c.power, timeout: c.timeout };
  }
  return out;
}

/** Known-curse ids -> the dense obj_k->curses array (power 1 = known). */
function deserializeKnownCurseList(
  saved: string[],
  reg: ObjRegistry,
  ids: ContentIdResolver,
): number[] {
  const out = new Array<number>(reg.curseMax).fill(0);
  for (const id of saved) {
    const i = ids.curseIndex(id);
    if (i !== undefined) out[i] = 1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Monsters and groups.
 * ------------------------------------------------------------------ */

export interface SavedMonster {
  /** Namespaced monster race id, e.g. "core:kobold". */
  raceId: string;
  /** Original race id (for a polymorphed/shaped monster), or null. */
  originalRaceId: string | null;
  midx: number;
  grid: { x: number; y: number };
  hp: number;
  maxhp: number;
  mTimed: number[];
  mspeed: number;
  energy: number;
  cdis: number;
  mflag: number[];
  mimickedObj: number;
  heldObj: SavedObject[];
  attr: number;
  target: { grid: { x: number; y: number }; midx: number };
  groupInfo: MonsterGroupInfo[];
  minRange: number;
  bestRange: number;
}

export function serializeMonster(
  mon: Monster,
  ids: ContentIdResolver,
): SavedMonster {
  return {
    raceId: ids.raceId(mon.race.ridx),
    originalRaceId: mon.originalRace ? ids.raceId(mon.originalRace.ridx) : null,
    midx: mon.midx,
    grid: { x: mon.grid.x, y: mon.grid.y },
    hp: mon.hp,
    maxhp: mon.maxhp,
    mTimed: Array.from(mon.mTimed),
    mspeed: mon.mspeed,
    energy: mon.energy,
    cdis: mon.cdis,
    mflag: Array.from(mon.mflag.bits),
    mimickedObj: mon.mimickedObj,
    heldObj: mon.heldObj.map((o) => serializeObject(o, ids)),
    attr: mon.attr,
    target: {
      grid: { x: mon.target.grid.x, y: mon.target.grid.y },
      midx: mon.target.midx,
    },
    groupInfo: mon.groupInfo.map((g) => ({ ...g })),
    minRange: mon.minRange,
    bestRange: mon.bestRange,
  };
}

export function deserializeMonster(
  data: SavedMonster,
  monsters: MonsterRegistry,
  objects: ObjRegistry,
  ids: ContentIdResolver,
): Monster {
  const ridx = ids.raceIndex(data.raceId);
  const race = ridx !== undefined ? monsters.races[ridx] : undefined;
  if (!race) throw new Error(`save: unknown race ${data.raceId}`);
  const mon = blankMonster(race);
  const origRidx =
    data.originalRaceId !== null
      ? ids.raceIndex(data.originalRaceId)
      : undefined;
  mon.originalRace = origRidx !== undefined ? (monsters.races[origRidx] ?? null) : null;
  mon.midx = data.midx;
  mon.grid = loc(data.grid.x, data.grid.y);
  mon.hp = data.hp;
  mon.maxhp = data.maxhp;
  mon.mTimed.set(data.mTimed);
  mon.mspeed = data.mspeed;
  mon.energy = data.energy;
  mon.cdis = data.cdis;
  mon.mflag.bits.set(data.mflag);
  mon.mimickedObj = data.mimickedObj;
  mon.heldObj = data.heldObj.map((o) => deserializeObject(o, objects, ids));
  mon.attr = data.attr;
  mon.target = {
    grid: loc(data.target.grid.x, data.target.grid.y),
    midx: data.target.midx,
  };
  for (let i = 0; i < GROUP_MAX; i++) {
    const g = data.groupInfo[i];
    if (g) mon.groupInfo[i] = { ...g };
  }
  mon.minRange = data.minRange;
  mon.bestRange = data.bestRange;
  return mon;
}

/* ------------------------------------------------------------------ *
 * Player.
 * ------------------------------------------------------------------ */

export interface SavedPlayer {
  raceName: string;
  clsName: string;
  hitdie: number;
  expFactor: number;
  age: number;
  ht: number;
  wt: number;
  au: number;
  maxLev: number;
  lev: number;
  maxExp: number;
  exp: number;
  expFrac: number;
  /** Recall / descent state (absent in older saves; default 0). */
  maxDepth?: number;
  recallDepth?: number;
  wordRecall?: number;
  deepDescent?: number;
  mhp: number;
  chp: number;
  chpFrac: number;
  msp: number;
  csp: number;
  cspFrac: number;
  statMax: number[];
  statCur: number[];
  statMap: number[];
  statBirth: number[];
  timed: number[];
  spellFlags: number[];
  spellOrder: number[];
  playerHp: number[];
  auBirth: number;
  htBirth: number;
  wtBirth: number;
  history: string;
  /**
   * hist (player-history.h struct player_history): the runtime auto-history
   * event log - absent in saves predating this field, which load as an
   * empty log (SAVEFILE_IMPORT-tolerant posture, matching load.c's
   * best-effort read of older savefiles).
   */
  hist?: HistoryInfo[];
  equipment: number[];
  /**
   * obj_k, every rune variety (wr_player's object knowledge). Older saves
   * (pre rune learn-by-use) carried only objKnownModifiers; the reader
   * accepts both.
   */
  objKnown?: {
    modifiers: number[];
    toA: number;
    toH: number;
    toD: number;
    /**
     * obj_k->dd / ds / ac (the "know dice"/"know ac" runes). Optional: saves
     * written before these fields existed omit them; the reader defaults each
     * to 1 (obvious birth knowledge, always correct - see player_outfit).
     */
    dd?: number;
    ds?: number;
    ac?: number;
    elInfo: ElementInfo[];
    flags: number[];
    /** Ids of the brand runes the player has learned. */
    brands: string[];
    /** Ids of the slay runes the player has learned. */
    slays: string[];
    /** Ids of the curse runes the player has learned. */
    curses: string[];
  };
  /** Legacy (save version 1 pre-#13): modifier runes only. */
  objKnownModifiers?: number[];
  shapeName: string | null;
  skills: number[];
  upkeep: { playing: boolean; newSpells: number; totalWeight: number };
  /**
   * quests (player-quest.h): the per-character quest history. Optional: absent
   * in saves written before the quest system, which reload with no quests (and
   * hence no win condition until re-birthed) - the SAVEFILE_IMPORT-tolerant
   * posture matching the other late-added fields.
   */
  quests?: PlayerQuest[];
  /** total_winner: the victory flag. Optional; absent saves load as false. */
  totalWinner?: boolean;
}

export function serializePlayer(
  p: Player,
  ids: ContentIdResolver,
): SavedPlayer {
  return {
    raceName: p.race.name,
    clsName: p.cls.name,
    hitdie: p.hitdie,
    expFactor: p.expFactor,
    age: p.age,
    ht: p.ht,
    wt: p.wt,
    au: p.au,
    maxLev: p.maxLev,
    lev: p.lev,
    maxExp: p.maxExp,
    exp: p.exp,
    expFrac: p.expFrac,
    maxDepth: p.maxDepth,
    recallDepth: p.recallDepth,
    wordRecall: p.wordRecall,
    deepDescent: p.deepDescent,
    mhp: p.mhp,
    chp: p.chp,
    chpFrac: p.chpFrac,
    msp: p.msp,
    csp: p.csp,
    cspFrac: p.cspFrac,
    statMax: [...p.statMax],
    statCur: [...p.statCur],
    statMap: [...p.statMap],
    statBirth: [...p.statBirth],
    timed: Array.from(p.timed),
    spellFlags: [...p.spellFlags],
    spellOrder: [...p.spellOrder],
    playerHp: [...p.playerHp],
    auBirth: p.auBirth,
    htBirth: p.htBirth,
    wtBirth: p.wtBirth,
    history: p.history,
    hist: p.hist.map((e) => ({ ...e })),
    equipment: [...p.equipment],
    objKnown: {
      modifiers: [...p.objKnown.modifiers],
      toA: p.objKnown.toA,
      toH: p.objKnown.toH,
      toD: p.objKnown.toD,
      dd: p.objKnown.dd,
      ds: p.objKnown.ds,
      ac: p.objKnown.ac,
      elInfo: p.objKnown.elInfo.map((e) => ({ ...e })),
      flags: Array.from(p.objKnown.flags.bits),
      /* The learned runes save as the ids of the known brands/slays/curses. */
      brands: serializeBrandList(p.objKnown.brands, ids) ?? [],
      slays: serializeSlayList(p.objKnown.slays, ids) ?? [],
      curses: serializeKnownCurseList(p.objKnown.curses, ids),
    },
    shapeName: p.shape ? p.shape.name : null,
    skills: [...p.skills],
    upkeep: { ...p.upkeep },
    quests: p.quests.map((q) => ({ ...q })),
    totalWinner: p.totalWinner,
  };
}

export function deserializePlayer(
  data: SavedPlayer,
  players: PlayerRegistry,
  objReg: ObjRegistry,
  ids: ContentIdResolver,
): Player {
  const race = players.raceByName(data.raceName);
  const cls = players.classByName(data.clsName);
  if (!race || !cls) {
    throw new Error(`save: unknown race/class ${data.raceName}/${data.clsName}`);
  }
  const body = players.bodies[race.body] ?? players.bodies[0]!;
  const p = blankPlayer(race, cls, body);
  p.hitdie = data.hitdie;
  p.expFactor = data.expFactor;
  p.age = data.age;
  p.ht = data.ht;
  p.wt = data.wt;
  p.au = data.au;
  p.maxLev = data.maxLev;
  p.lev = data.lev;
  p.maxExp = data.maxExp;
  p.exp = data.exp;
  p.expFrac = data.expFrac;
  p.maxDepth = data.maxDepth ?? 0;
  p.recallDepth = data.recallDepth ?? 0;
  p.wordRecall = data.wordRecall ?? 0;
  p.deepDescent = data.deepDescent ?? 0;
  p.mhp = data.mhp;
  p.chp = data.chp;
  p.chpFrac = data.chpFrac;
  p.msp = data.msp;
  p.csp = data.csp;
  p.cspFrac = data.cspFrac;
  p.statMax = [...data.statMax];
  p.statCur = [...data.statCur];
  p.statMap = [...data.statMap];
  p.statBirth = [...data.statBirth];
  p.timed.set(data.timed);
  p.spellFlags = [...data.spellFlags];
  p.spellOrder = [...data.spellOrder];
  p.playerHp = [...data.playerHp];
  p.auBirth = data.auBirth;
  p.htBirth = data.htBirth;
  p.wtBirth = data.wtBirth;
  p.history = data.history;
  p.hist = data.hist ? data.hist.map((e) => ({ ...e })) : [];
  p.equipment = [...data.equipment];
  if (data.objKnown) {
    p.objKnown = {
      modifiers: [...data.objKnown.modifiers],
      toA: data.objKnown.toA,
      toH: data.objKnown.toH,
      toD: data.objKnown.toD,
      /* Default to 1 for pre-field saves: dd/ds/ac are obvious birth knowledge
       * (player_outfit), always 1, so an absent value restores exactly. */
      dd: data.objKnown.dd ?? 1,
      ds: data.objKnown.ds ?? 1,
      ac: data.objKnown.ac ?? 1,
      elInfo: data.objKnown.elInfo.map((e) => ({ ...e })),
      flags: new FlagSet(Uint8Array.from(data.objKnown.flags)),
      brands: deserializeBrandList(data.objKnown.brands, objReg, ids) ?? [],
      slays: deserializeSlayList(data.objKnown.slays, objReg, ids) ?? [],
      curses: deserializeKnownCurseList(data.objKnown.curses, objReg, ids),
    };
  } else if (data.objKnownModifiers) {
    /* Legacy pre-#13 save: only the modifier runes were tracked. */
    p.objKnown.modifiers = [...data.objKnownModifiers];
  }
  p.shape =
    data.shapeName !== null
      ? (players.shapes.find((s) => s.name === data.shapeName) ?? null)
      : null;
  p.skills = [...data.skills];
  p.upkeep = { ...data.upkeep };
  p.quests = data.quests ? data.quests.map((q) => ({ ...q })) : [];
  p.totalWinner = data.totalWinner ?? false;
  return p;
}

/* ------------------------------------------------------------------ *
 * The whole game.
 * ------------------------------------------------------------------ */

export interface SavedTrap {
  /** Namespaced trap-kind id, e.g. "core:trap-door". */
  trapId: string;
  grid: { x: number; y: number };
  power: number;
  timeout: number;
  flags: number[];
}

export interface SavedGame {
  version: number;
  player: SavedPlayer;
  actor: {
    grid: { x: number; y: number };
    energy: number;
    totalEnergy: number;
  };
  gear: { next: number; pack: number[]; store: Array<[number, SavedObject]> };
  chunk: ChunkSquaresData;
  /**
   * Feature legend: every terrain index that appears in chunk.feats or
   * known.feat, paired with its namespaced feature id. The grid stays a
   * compact numeric array (one small legend, not a string per cell); on load
   * the numeric feats are remapped through the legend to the current pack's
   * indices, so terrain references survive pack changes exactly like every
   * other content reference (MOD_LIFECYCLE decision 1). Optional only for the
   * degenerate empty-level case.
   */
  featLegend?: Array<[number, string]>;
  monsters: Array<SavedMonster | null>;
  groups: Array<MonsterGroup | null>;
  /** Floor piles in pile order (head first), keyed by grid. */
  floor: Array<{ x: number; y: number; objs: SavedObject[] }>;
  traps: Array<{ x: number; y: number; traps: SavedTrap[] }>;
  rng: RngState;
  turn: number;
  playing: boolean;
  isDead: boolean;
  flavor: { aware: number[]; tried: number[] };
  /**
   * seed_flavor (game-world.c): the seed flavor_init used to assign object
   * colours/titles. Optional: absent in saves written before flavour
   * assignment, which reload with a stable seed-0 assignment.
   */
  seedFlavor?: number;
  /**
   * The player's map knowledge (game/known.ts). Optional: absent in
   * version-1 saves written before the knowledge layer, which load with
   * an all-unknown map.
   */
  known?: SavedKnown;
  /**
   * Monster memory (mon/lore.ts), keyed by monster race id. Optional: absent
   * in saves written before lore, which load with no memory. Upstream splits
   * this between the savefile (pkills/thefts) and the user lore file; the
   * JSON save carries the whole record.
   */
  lore?: Array<[string, SavedLore]>;
  /**
   * Single combat in progress (upkeep->arena_level + player->old_grid).
   * The stashed pre-arena level does not survive the save boundary:
   * winning after a reload exits to a fresh level of the same depth.
   */
  arena?: { oldGrid: { x: number; y: number } };
  /**
   * The player's ignore settings (obj-ignore.c). Optional: absent in saves
   * written before ignoring, which load with everything shown.
   */
  ignore?: import("../obj/ignore").IgnoreSettingsData;
  /**
   * The player option store (option.c): every option value, hitpoint_warn /
   * delay_factor, and the immutable birth-option snapshot. Optional: absent in
   * saves written before the option store, which load with the table defaults.
   */
  options?: import("../player/options").OptionStateData;
  /**
   * randart_seed (obj-randart.c): the seed do_randart used when birth_randarts
   * is on. Optional / 0 when the standard artifact set is in use. Persisted so
   * a reload rebuilds the identical random artifact set.
   */
  randartSeed?: number;
  /**
   * aup_info[] (obj-make.c): the ids of the artifacts already created. Stored
   * as an id list (not a by-aidx boolean array) so the created set survives
   * pack changes. Optional / absent in saves written before artifact
   * generation landed, which load with an all-false set.
   */
  artifactsCreated?: string[];
  /**
   * The manifest block (mod/save-blocks.ts, P7.2): the pack set + resolved load
   * order + core-owned determinism mode that produced this save - its profile
   * fingerprint. Optional: absent in saves written before the mod substrate,
   * which load as core-only + deterministic (coreOnlyManifest).
   */
  manifest?: SaveManifest;
  /**
   * Per-mod private bags (mod:<id>), keyed by pack id: opaque JSON the engine
   * never interprets, versioned by each mod's saveSchema. Absent when no mod
   * persisted state. Round-tripped verbatim; migrated only by the owning mod.
   */
  mods?: Record<string, ModBag>;
  /**
   * The orphans store (orphans:<id>@<version>): entities quarantined because
   * their defining pack is missing or shadowed (mod/save-blocks.ts). Frozen and
   * inert, restored by rehydrateSave when the pack returns. Absent when nothing
   * is quarantined.
   */
  orphans?: OrphanStore;
  /**
   * decision-8 seam: whether the one-time keep/purge orphan prompt has already
   * been shown for this save. Core computes the orphan count; the UI shows the
   * prompt once and sets this so it never nags again. Absent = not yet shown.
   */
  orphansAcknowledged?: boolean;
  /**
   * birth_levels_persist (#30) frozen-level cache (game/context.ts StoredLevel),
   * one entry per cached depth, reusing the same chunk / monster / floor / trap /
   * known serializers as the current level. Optional / absent when the option is
   * off (the default) or no level has been frozen: older and default saves load
   * with an empty cache (back-compat, like every other optional field here).
   */
  levelCache?: SavedStoredLevel[];
  /**
   * The per-kind autoinscription registry (obj-ignore.c note_aware/note_unaware,
   * obj/knowledge.ts AutoinscriptionRegistry). Keyed by the namespaced kind id
   * (like every other content reference, MOD_LIFECYCLE decision 1) so notes
   * survive pack reordering. Optional / absent when nothing is registered:
   * older saves and the default (no autoinscriptions) load with an empty
   * registry, back-compat like every other optional field here.
   */
  autoinscriptions?: SavedAutoinscription[];
}

/** One serialized per-kind autoinscription entry (namespaced kind id + notes). */
export interface SavedAutoinscription {
  kindId: string;
  aware?: string;
  unaware?: string;
}

/** Serialized map knowledge (remembered terrain and floor objects). */
export interface SavedKnown {
  feat: number[];
  objects: Array<[number, { ch: string | null; attr: string }]>;
}

/** One serialized race-lore record. */
export interface SavedLore {
  sights: number;
  deaths: number;
  pkills: number;
  thefts: number;
  tkills: number;
  wake: number;
  ignore: number;
  dropGold: number;
  dropItem: number;
  castInnate: number;
  castSpell: number;
  blowTimesSeen: number[];
  blowKnown: boolean[];
  flags: number[];
  spellFlags: number[];
  allKnown: boolean;
  armourKnown: boolean;
  dropKnown: boolean;
  sleepKnown: boolean;
  spellFreqKnown: boolean;
  innateFreqKnown: boolean;
}

/** Build the feature legend for every fidx appearing in the terrain grids. */
function buildFeatLegend(
  feats: readonly number[],
  known: readonly number[],
  ids: ContentIdResolver,
): Array<[number, string]> {
  const present = new Set<number>();
  for (const f of feats) present.add(f);
  for (const f of known) present.add(f);
  const legend: Array<[number, string]> = [];
  for (const f of present) {
    /* Skip sentinels (an unset cell is -1): they carry no feature id and are
     * pack-independent, so remapFeats leaves them untouched. */
    const id = ids.featIdOrNull(f);
    if (id !== null) legend.push([f, id]);
  }
  return legend;
}

/** aup_info boolean[] (by aidx) -> the ids of the created artifacts. */
function serializeArtifactsCreated(
  created: readonly boolean[],
  ids: ContentIdResolver,
): string[] {
  const out: string[] = [];
  for (let i = 1; i < created.length; i++) {
    if (created[i]) out.push(ids.artifactId(i));
  }
  return out;
}

/** Serialize a live game (state + flavor knowledge) into plain JSON data. */
export function serializeGame(
  state: GameState,
  flavor: { snapshot(): { aware: number[]; tried: number[] } },
  seedFlavor: number,
  ids: ContentIdResolver,
  randartSeed = 0,
): SavedGame {
  const floor: SavedGame["floor"] = [];
  for (const pile of state.floor.values()) {
    const head = pile[0];
    if (!head || !head.grid) continue;
    floor.push({
      x: head.grid.x,
      y: head.grid.y,
      objs: pile.map((o) => serializeObject(o, ids)),
    });
  }
  const traps: SavedGame["traps"] = [];
  for (const list of state.traps.values()) {
    const head = list[0];
    if (!head) continue;
    traps.push({
      x: head.grid.x,
      y: head.grid.y,
      traps: list.map((t) => ({
        trapId: ids.trapId(t.tidx),
        grid: { x: t.grid.x, y: t.grid.y },
        power: t.power,
        timeout: t.timeout,
        flags: Array.from(t.flags.bits),
      })),
    });
  }
  const chunk = state.chunk.snapshotSquares();
  const knownFeat = Array.from(state.known.feat);
  const savedLevelCache = serializeLevelCache(state.levelCache, ids);
  const autoinscriptions = state.autoinscribe
    ? serializeAutoinscriptions(state.autoinscribe, ids)
    : undefined;
  return {
    version: SAVE_VERSION,
    player: serializePlayer(state.actor.player, ids),
    actor: {
      grid: { x: state.actor.grid.x, y: state.actor.grid.y },
      energy: state.actor.energy,
      totalEnergy: state.actor.totalEnergy,
    },
    gear: {
      next: state.gear.next,
      pack: [...state.gear.pack],
      store: Array.from(state.gear.store.entries()).map(([h, obj]) => [
        h,
        serializeObject(obj, ids),
      ]),
    },
    chunk,
    featLegend: buildFeatLegend(chunk.feats, knownFeat, ids),
    monsters: state.monsters.map((m) => (m ? serializeMonster(m, ids) : null)),
    groups: state.groups.map((g) =>
      g ? { index: g.index, leader: g.leader, members: [...g.members] } : null,
    ),
    floor,
    traps,
    rng: state.rng.getState(),
    turn: state.turn,
    playing: state.playing,
    isDead: state.isDead,
    flavor: flavor.snapshot(),
    seedFlavor,
    ...(state.options ? { options: state.options.snapshot() } : {}),
    ...(randartSeed ? { randartSeed } : {}),
    ...(state.artifacts
      ? {
          artifactsCreated: serializeArtifactsCreated(
            state.artifacts.snapshot(),
            ids,
          ),
        }
      : {}),
    ...(savedLevelCache ? { levelCache: savedLevelCache } : {}),
    ...(autoinscriptions ? { autoinscriptions } : {}),
    known: {
      feat: knownFeat,
      objects: Array.from(state.known.objects.entries()).map(([i, m]) => [
        i,
        { ch: m.ch, attr: m.attr },
      ]),
    },
    ...(state.arenaLevel
      ? {
          arena: {
            oldGrid: {
              x: state.oldGrid?.x ?? state.actor.grid.x,
              y: state.oldGrid?.y ?? state.actor.grid.y,
            },
          },
        }
      : {}),
    ignore: state.ignore.snapshot(),
    lore: Array.from(state.lore.entries()).map(([ridx, l]) => [
      ids.raceId(ridx),
      {
        sights: l.sights,
        deaths: l.deaths,
        pkills: l.pkills,
        thefts: l.thefts,
        tkills: l.tkills,
        wake: l.wake,
        ignore: l.ignore,
        dropGold: l.dropGold,
        dropItem: l.dropItem,
        castInnate: l.castInnate,
        castSpell: l.castSpell,
        blowTimesSeen: [...l.blowTimesSeen],
        blowKnown: [...l.blowKnown],
        flags: Array.from(l.flags.bits),
        spellFlags: Array.from(l.spellFlags.bits),
        allKnown: l.allKnown,
        armourKnown: l.armourKnown,
        dropKnown: l.dropKnown,
        sleepKnown: l.sleepKnown,
        spellFreqKnown: l.spellFreqKnown,
        innateFreqKnown: l.innateFreqKnown,
      },
    ]),
  };
}

/** Rebuild the monster memory (absent in older saves: none). */
export function deserializeLore(
  data: SavedGame["lore"],
  ids: ContentIdResolver,
): Map<number, MonsterLore> {
  const store = new Map<number, MonsterLore>();
  if (!data) return store;
  for (const [raceId, l] of data) {
    const ridx = ids.raceIndex(raceId);
    if (ridx === undefined) continue; // race gone (mod removed): drop its lore
    store.set(ridx, {
      sights: l.sights,
      deaths: l.deaths,
      pkills: l.pkills,
      thefts: l.thefts,
      tkills: l.tkills,
      wake: l.wake,
      ignore: l.ignore,
      dropGold: l.dropGold,
      dropItem: l.dropItem,
      castInnate: l.castInnate,
      castSpell: l.castSpell,
      blowTimesSeen: [...l.blowTimesSeen],
      blowKnown: [...l.blowKnown],
      flags: new FlagSet(Uint8Array.from(l.flags)),
      spellFlags: new FlagSet(Uint8Array.from(l.spellFlags)),
      allKnown: l.allKnown,
      armourKnown: l.armourKnown,
      dropKnown: l.dropKnown,
      sleepKnown: l.sleepKnown,
      spellFreqKnown: l.spellFreqKnown,
      innateFreqKnown: l.innateFreqKnown,
    });
  }
  return store;
}

/**
 * Serialize the per-kind autoinscription registry (obj/knowledge.ts): every
 * kind with a registered note, keyed by its namespaced kind id (mod-stable,
 * like serializeObject). Returns undefined when nothing is registered, so a
 * clean game omits the block entirely. A kind whose id no longer resolves
 * (unbound in this pack) is dropped.
 */
export function serializeAutoinscriptions(
  registry: AutoinscriptionRegistry,
  ids: ContentIdResolver,
): SavedAutoinscription[] | undefined {
  const out: SavedAutoinscription[] = [];
  for (const [kidx, note] of registry.entries()) {
    const kindId = ids.kindIdOrNull(kidx);
    if (kindId === null) continue; // kind unbound in this pack: drop
    const entry: SavedAutoinscription = { kindId };
    if (note.aware !== undefined) entry.aware = note.aware;
    if (note.unaware !== undefined) entry.unaware = note.unaware;
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Restore serialized autoinscriptions into a registry (absent in older saves:
 * nothing to restore). A kind whose id is gone (its defining pack was removed)
 * is dropped, exactly like deserializeLore drops a removed race's memory.
 */
export function deserializeAutoinscriptions(
  data: SavedAutoinscription[],
  registry: AutoinscriptionRegistry,
  ids: ContentIdResolver,
): void {
  for (const entry of data) {
    const kidx = ids.kindIndex(entry.kindId);
    if (kidx === undefined) continue; // kind gone (mod removed): drop its notes
    if (entry.aware !== undefined) registry.set(kidx, entry.aware, true);
    if (entry.unaware !== undefined) registry.set(kidx, entry.unaware, false);
  }
}

/**
 * Build the feature index remap from a save's legend: each saved fidx maps to
 * the current pack's index for the same feature id. When the save and the
 * running pack agree (the common case), every entry is the identity; the map
 * is still applied so a re-ordered or extended terrain set loads correctly.
 * Throws on a legend id the current pack cannot resolve (a removed terrain -
 * graceful degradation is a Phase 2 quarantine concern).
 */
export function buildFeatRemap(
  legend: Array<[number, string]> | undefined,
  ids: ContentIdResolver,
): Map<number, number> {
  const remap = new Map<number, number>();
  if (!legend) return remap;
  for (const [oldFidx, id] of legend) {
    const newFidx = ids.featIndex(id);
    if (newFidx === undefined) {
      throw new Error(`save: unknown terrain feature ${id}`);
    }
    remap.set(oldFidx, newFidx);
  }
  return remap;
}

/** Apply a feature remap to a terrain index array in place (identity-safe). */
function remapFeats(feats: number[], remap: Map<number, number>): void {
  if (remap.size === 0) return;
  for (let i = 0; i < feats.length; i++) {
    const to = remap.get(feats[i] as number);
    if (to !== undefined) feats[i] = to;
  }
}

/** Rebuild the map knowledge (absent in older saves: all unknown). */
export function deserializeKnown(
  data: SavedKnown | undefined,
  width: number,
  height: number,
  featRemap: Map<number, number>,
): KnownMap {
  const known = newKnownMap(width, height);
  if (!data) return known;
  const feat = data.feat.slice(0, known.feat.length);
  remapFeats(feat, featRemap);
  known.feat.set(feat);
  for (const [i, m] of data.objects) {
    known.objects.set(i, { ch: m.ch, attr: m.attr });
  }
  return known;
}

/** Rebuild a Gear store from its saved form. */
export function deserializeGear(
  data: SavedGame["gear"],
  reg: ObjRegistry,
  ids: ContentIdResolver,
): Gear {
  const store = new Map<number, GameObject>();
  for (const [h, saved] of data.store) {
    store.set(h, deserializeObject(saved, reg, ids));
  }
  return { store, next: data.next, pack: [...data.pack] };
}

/** Rebuild the floor pile map (grid-keyed, pile order preserved). */
export function deserializeFloor(
  data: SavedGame["floor"],
  reg: ObjRegistry,
  width: number,
  ids: ContentIdResolver,
): Map<number, GameObject[]> {
  const floor = new Map<number, GameObject[]>();
  for (const entry of data) {
    floor.set(
      entry.y * width + entry.x,
      entry.objs.map((o) => deserializeObject(o, reg, ids)),
    );
  }
  return floor;
}

/** Rebuild the trap map from saved instances against the bound kinds. */
export function deserializeTraps(
  data: SavedGame["traps"],
  kinds: readonly TrapKind[],
  width: number,
  ids: ContentIdResolver,
): Map<number, Trap[]> {
  const traps = new Map<number, Trap[]>();
  for (const entry of data) {
    traps.set(
      entry.y * width + entry.x,
      entry.traps.map((t) => {
        const tidx = ids.trapIndex(t.trapId);
        const kind = tidx !== undefined ? kinds[tidx] : undefined;
        if (kind === undefined || tidx === undefined) {
          throw new Error(`save: unknown trap kind ${t.trapId}`);
        }
        return {
          tidx,
          kind,
          grid: loc(t.grid.x, t.grid.y),
          power: t.power,
          timeout: t.timeout,
          flags: new FlagSet(Uint8Array.from(t.flags)),
        };
      }),
    );
  }
  return traps;
}

/** aup_info id list -> the boolean[] by aidx that ArtifactState.restore wants. */
export function deserializeArtifactsCreated(
  saved: string[] | undefined,
  length: number,
  ids: ContentIdResolver,
): boolean[] {
  const out = new Array<boolean>(length).fill(false);
  if (!saved) return out;
  for (const id of saved) {
    const i = ids.artifactIndex(id);
    if (i !== undefined && i < length) out[i] = true;
  }
  return out;
}

/**
 * Rebuild a chunk of the saved dimensions and restore its squares, remapping
 * the terrain grid through the save's feature legend so feature references
 * survive a pack change.
 */
export function deserializeChunk(
  data: ChunkSquaresData,
  features: Chunk["features"],
  featRemap: Map<number, number>,
): Chunk {
  const chunk = new Chunk(features, data.height, data.width);
  if (featRemap.size > 0) {
    remapFeats(data.feats, featRemap);
  }
  chunk.restoreSquares(data);
  return chunk;
}

/* ------------------------------------------------------------------ *
 * birth_levels_persist frozen-level cache (game/context.ts StoredLevel).
 * ------------------------------------------------------------------ */

/** One serialized frozen level: the same field-set as the current level. */
export interface SavedStoredLevel {
  depth: number;
  /** Game turn the level was frozen at (restore_monsters recovery baseline). */
  turn: number;
  chunk: ChunkSquaresData;
  featLegend?: Array<[number, string]>;
  monsters: Array<SavedMonster | null>;
  groups: Array<MonsterGroup | null>;
  floor: Array<{ x: number; y: number; objs: SavedObject[] }>;
  traps: Array<{ x: number; y: number; traps: SavedTrap[] }>;
  known: SavedKnown;
  decoy?: { x: number; y: number } | null;
}

/** Serialize one frozen level, reusing the current-level serializers. */
function serializeStoredLevel(
  depth: number,
  level: StoredLevel,
  ids: ContentIdResolver,
): SavedStoredLevel {
  const floor: SavedStoredLevel["floor"] = [];
  for (const pile of level.floor.values()) {
    const head = pile[0];
    if (!head || !head.grid) continue;
    floor.push({
      x: head.grid.x,
      y: head.grid.y,
      objs: pile.map((o) => serializeObject(o, ids)),
    });
  }
  const traps: SavedStoredLevel["traps"] = [];
  for (const list of level.traps.values()) {
    const head = list[0];
    if (!head) continue;
    traps.push({
      x: head.grid.x,
      y: head.grid.y,
      traps: list.map((t) => ({
        trapId: ids.trapId(t.tidx),
        grid: { x: t.grid.x, y: t.grid.y },
        power: t.power,
        timeout: t.timeout,
        flags: Array.from(t.flags.bits),
      })),
    });
  }
  const chunk = level.chunk.snapshotSquares();
  const knownFeat = Array.from(level.known.feat);
  return {
    depth,
    turn: level.turn,
    chunk,
    featLegend: buildFeatLegend(chunk.feats, knownFeat, ids),
    monsters: level.monsters.map((m) => (m ? serializeMonster(m, ids) : null)),
    groups: level.groups.map((g) =>
      g ? { index: g.index, leader: g.leader, members: [...g.members] } : null,
    ),
    floor,
    traps,
    known: {
      feat: knownFeat,
      objects: Array.from(level.known.objects.entries()).map(([i, m]) => [
        i,
        { ch: m.ch, attr: m.attr },
      ]),
    },
    decoy: level.decoy ? { x: level.decoy.x, y: level.decoy.y } : null,
  };
}

/** Serialize the whole frozen-level cache (empty / absent => omitted). */
export function serializeLevelCache(
  cache: Map<number, StoredLevel> | undefined,
  ids: ContentIdResolver,
): SavedStoredLevel[] | undefined {
  if (!cache || cache.size === 0) return undefined;
  return Array.from(cache.entries()).map(([depth, level]) =>
    serializeStoredLevel(depth, level, ids),
  );
}

/**
 * Rebuild the frozen-level cache (absent in older / default saves: empty).
 * Reuses the current-level deserializers so a cached level round-trips exactly
 * like the live one, including per-level feature-legend remapping.
 */
export function deserializeLevelCache(
  data: SavedStoredLevel[] | undefined,
  features: Chunk["features"],
  monsters: MonsterRegistry,
  objects: ObjRegistry,
  traps: readonly TrapKind[] | null | undefined,
  ids: ContentIdResolver,
): Map<number, StoredLevel> {
  const cache = new Map<number, StoredLevel>();
  if (!data) return cache;
  for (const entry of data) {
    const featRemap = buildFeatRemap(entry.featLegend, ids);
    const chunk = deserializeChunk(entry.chunk, features, featRemap);
    chunk.turn = entry.turn;
    cache.set(entry.depth, {
      chunk,
      monsters: entry.monsters.map((m) =>
        m ? deserializeMonster(m, monsters, objects, ids) : null,
      ),
      groups: entry.groups.map((g) =>
        g
          ? { index: g.index, leader: g.leader, members: [...g.members] }
          : null,
      ),
      floor: deserializeFloor(entry.floor, objects, chunk.width, ids),
      traps: traps
        ? deserializeTraps(entry.traps, traps, chunk.width, ids)
        : new Map(),
      known: deserializeKnown(entry.known, chunk.width, chunk.height, featRemap),
      decoy: entry.decoy ? loc(entry.decoy.x, entry.decoy.y) : null,
      turn: entry.turn,
    });
  }
  return cache;
}

/* ------------------------------------------------------------------ *
 * Stamped bytes (the file/localStorage form).
 * ------------------------------------------------------------------ */

/** JSON-encode a save and stamp it with the integrity trailer (16b). */
export function encodeSavedGame(
  save: SavedGame,
  provider: SaveIntegrity = fnv1aIntegrity,
): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(save));
  return stampSavefile(bytes, provider);
}

/** The decoded form of a stamped save. */
export interface DecodedSave {
  save: SavedGame | null;
  /** The integrity digest matched. */
  verified: boolean;
  /** No trailer was present at all. */
  unstamped: boolean;
}

/**
 * Verify and parse stamped save bytes. A failed digest still parses (the
 * warn-and-label posture of decision 16b - the deterrent is honest, not a
 * lock), with verified=false for the caller to surface.
 */
export function decodeSavedGame(
  bytes: Uint8Array,
  provider: SaveIntegrity = fnv1aIntegrity,
): DecodedSave {
  const result = verifyStampedSavefile(bytes, provider);
  let save: SavedGame | null = null;
  try {
    save = JSON.parse(new TextDecoder().decode(result.payload)) as SavedGame;
  } catch {
    save = null;
  }
  return {
    save,
    verified: result.verified,
    unstamped: result.unstamped ?? false,
  };
}
