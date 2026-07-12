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
import { blankMonster, GROUP_MAX } from "../mon/monster";
import type { Monster, MonsterGroupInfo } from "../mon/monster";
import type { MonsterLore } from "../mon/lore";
import type { MonsterRegistry } from "../mon/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import type { PlayerRegistry } from "../player/bind";
import type { TrapKind } from "../world/trap";
import type { GameState, MonsterGroup } from "../game/context";
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

/** The save format version this build writes. */
export const SAVE_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Objects.
 * ------------------------------------------------------------------ */

export interface SavedObject {
  kidx: number;
  ego: number | null;
  artifact: number | null;
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
  brands: boolean[] | null;
  slays: boolean[] | null;
  curses: Array<{ power: number; timeout: number }> | null;
  time: RandomValue;
  timeout: number;
  number: number;
  notice: number;
  heldMIdx: number;
  mimickingMIdx: number;
  origin: number;
  originDepth: number;
  originRace: number;
  note: string | null;
}

export function serializeObject(obj: GameObject): SavedObject {
  return {
    kidx: obj.kind.kidx,
    ego: obj.ego ? obj.ego.eidx : null,
    artifact: obj.artifact ? obj.artifact.aidx : null,
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
    brands: obj.brands ? [...obj.brands] : null,
    slays: obj.slays ? [...obj.slays] : null,
    curses: obj.curses ? obj.curses.map((c) => ({ ...c })) : null,
    time: { ...obj.time },
    timeout: obj.timeout,
    number: obj.number,
    notice: obj.notice,
    heldMIdx: obj.heldMIdx,
    mimickingMIdx: obj.mimickingMIdx,
    origin: obj.origin,
    originDepth: obj.originDepth,
    originRace: obj.originRace,
    note: obj.note,
  };
}

export function deserializeObject(
  data: SavedObject,
  reg: ObjRegistry,
): GameObject {
  const kind = reg.kinds[data.kidx];
  if (!kind) throw new Error(`save: unknown object kind ${data.kidx}`);
  return {
    kind,
    ego: data.ego !== null ? (reg.egos[data.ego] ?? null) : null,
    artifact: data.artifact !== null ? (reg.artifacts[data.artifact] ?? null) : null,
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
    brands: data.brands ? [...data.brands] : null,
    slays: data.slays ? [...data.slays] : null,
    curses: data.curses ? data.curses.map((c) => ({ ...c })) : null,
    /* Kind-owned data re-points at the bound kind. */
    effect: kind.effect,
    effectMsg: kind.effectMsg,
    activation:
      (data.artifact !== null
        ? reg.artifacts[data.artifact]?.activation
        : null) ?? kind.activation,
    time: { ...data.time },
    timeout: data.timeout,
    number: data.number,
    notice: data.notice,
    heldMIdx: data.heldMIdx,
    mimickingMIdx: data.mimickingMIdx,
    origin: data.origin,
    originDepth: data.originDepth,
    originRace: data.originRace,
    note: data.note,
  };
}

/* ------------------------------------------------------------------ *
 * Monsters and groups.
 * ------------------------------------------------------------------ */

export interface SavedMonster {
  ridx: number;
  originalRidx: number | null;
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

export function serializeMonster(mon: Monster): SavedMonster {
  return {
    ridx: mon.race.ridx,
    originalRidx: mon.originalRace ? mon.originalRace.ridx : null,
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
    heldObj: mon.heldObj.map(serializeObject),
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
): Monster {
  const race = monsters.races[data.ridx];
  if (!race) throw new Error(`save: unknown race ${data.ridx}`);
  const mon = blankMonster(race);
  mon.originalRace =
    data.originalRidx !== null
      ? (monsters.races[data.originalRidx] ?? null)
      : null;
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
  mon.heldObj = data.heldObj.map((o) => deserializeObject(o, objects));
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
    elInfo: ElementInfo[];
    flags: number[];
    brands: boolean[];
    slays: boolean[];
    curses: number[];
  };
  /** Legacy (save version 1 pre-#13): modifier runes only. */
  objKnownModifiers?: number[];
  shapeName: string | null;
  skills: number[];
  upkeep: { playing: boolean; newSpells: number; totalWeight: number };
}

export function serializePlayer(p: Player): SavedPlayer {
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
    equipment: [...p.equipment],
    objKnown: {
      modifiers: [...p.objKnown.modifiers],
      toA: p.objKnown.toA,
      toH: p.objKnown.toH,
      toD: p.objKnown.toD,
      elInfo: p.objKnown.elInfo.map((e) => ({ ...e })),
      flags: Array.from(p.objKnown.flags.bits),
      /* The live arrays are sparse (learned indices only); save densely. */
      brands: Array.from(p.objKnown.brands, (b) => b ?? false),
      slays: Array.from(p.objKnown.slays, (s) => s ?? false),
      curses: Array.from(p.objKnown.curses, (c) => c ?? 0),
    },
    shapeName: p.shape ? p.shape.name : null,
    skills: [...p.skills],
    upkeep: { ...p.upkeep },
  };
}

export function deserializePlayer(
  data: SavedPlayer,
  players: PlayerRegistry,
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
  p.equipment = [...data.equipment];
  if (data.objKnown) {
    p.objKnown = {
      modifiers: [...data.objKnown.modifiers],
      toA: data.objKnown.toA,
      toH: data.objKnown.toH,
      toD: data.objKnown.toD,
      elInfo: data.objKnown.elInfo.map((e) => ({ ...e })),
      flags: new FlagSet(Uint8Array.from(data.objKnown.flags)),
      brands: [...data.objKnown.brands],
      slays: [...data.objKnown.slays],
      curses: [...data.objKnown.curses],
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
  return p;
}

/* ------------------------------------------------------------------ *
 * The whole game.
 * ------------------------------------------------------------------ */

export interface SavedTrap {
  tidx: number;
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
   * Monster memory (mon/lore.ts), keyed by race.ridx. Optional: absent in
   * saves written before lore, which load with no memory. Upstream splits
   * this between the savefile (pkills/thefts) and the user lore file; the
   * JSON save carries the whole record.
   */
  lore?: Array<[number, SavedLore]>;
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

/** Serialize a live game (state + flavor knowledge) into plain JSON data. */
export function serializeGame(
  state: GameState,
  flavor: { snapshot(): { aware: number[]; tried: number[] } },
  seedFlavor: number,
  randartSeed = 0,
): SavedGame {
  const floor: SavedGame["floor"] = [];
  for (const pile of state.floor.values()) {
    const head = pile[0];
    if (!head || !head.grid) continue;
    floor.push({
      x: head.grid.x,
      y: head.grid.y,
      objs: pile.map(serializeObject),
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
        tidx: t.tidx,
        grid: { x: t.grid.x, y: t.grid.y },
        power: t.power,
        timeout: t.timeout,
        flags: Array.from(t.flags.bits),
      })),
    });
  }
  return {
    version: SAVE_VERSION,
    player: serializePlayer(state.actor.player),
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
        serializeObject(obj),
      ]),
    },
    chunk: state.chunk.snapshotSquares(),
    monsters: state.monsters.map((m) => (m ? serializeMonster(m) : null)),
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
    known: {
      feat: Array.from(state.known.feat),
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
      ridx,
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
): Map<number, MonsterLore> {
  const store = new Map<number, MonsterLore>();
  if (!data) return store;
  for (const [ridx, l] of data) {
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

/** Rebuild the map knowledge (absent in older saves: all unknown). */
export function deserializeKnown(
  data: SavedKnown | undefined,
  width: number,
  height: number,
): KnownMap {
  const known = newKnownMap(width, height);
  if (!data) return known;
  known.feat.set(data.feat.slice(0, known.feat.length));
  for (const [i, m] of data.objects) {
    known.objects.set(i, { ch: m.ch, attr: m.attr });
  }
  return known;
}

/** Rebuild a Gear store from its saved form. */
export function deserializeGear(
  data: SavedGame["gear"],
  reg: ObjRegistry,
): Gear {
  const store = new Map<number, GameObject>();
  for (const [h, saved] of data.store) {
    store.set(h, deserializeObject(saved, reg));
  }
  return { store, next: data.next, pack: [...data.pack] };
}

/** Rebuild the floor pile map (grid-keyed, pile order preserved). */
export function deserializeFloor(
  data: SavedGame["floor"],
  reg: ObjRegistry,
  width: number,
): Map<number, GameObject[]> {
  const floor = new Map<number, GameObject[]>();
  for (const entry of data) {
    floor.set(
      entry.y * width + entry.x,
      entry.objs.map((o) => deserializeObject(o, reg)),
    );
  }
  return floor;
}

/** Rebuild the trap map from saved instances against the bound kinds. */
export function deserializeTraps(
  data: SavedGame["traps"],
  kinds: readonly TrapKind[],
  width: number,
): Map<number, Trap[]> {
  const traps = new Map<number, Trap[]>();
  for (const entry of data) {
    traps.set(
      entry.y * width + entry.x,
      entry.traps.map((t) => {
        const kind = kinds[t.tidx];
        if (!kind) throw new Error(`save: unknown trap kind ${t.tidx}`);
        return {
          tidx: t.tidx,
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

/** Rebuild a chunk of the saved dimensions and restore its squares. */
export function deserializeChunk(
  data: ChunkSquaresData,
  features: Chunk["features"],
): Chunk {
  const chunk = new Chunk(features, data.height, data.width);
  chunk.restoreSquares(data);
  return chunk;
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
