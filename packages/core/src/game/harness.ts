/**
 * Shared test fixtures for the game turn-loop suites. Not part of the public
 * API; it binds the content pack once and builds GameState instances so the
 * colocated *.test.ts files stay focused on behaviour rather than setup.
 */

import { readFileSync } from "node:fs";
import { FlagSet } from "../bitflag";
import { Dice } from "../dice";
import { Rng } from "../rng";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { SKILL } from "../player/types";
import { RF_SIZE } from "../mon/types";
import type { MonsterBlow, MonsterRace } from "../mon/types";
import { blankMonster } from "../mon/monster";
import type { Monster } from "../mon/monster";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { Chunk } from "../world/chunk";
import { FeatureRegistry } from "../world/feature";
import type { TerrainRecordJson } from "../world/feature";
import type { PlayerCombatState } from "../combat/melee";
import type { DefenderState } from "../combat/mon-melee";
import { DEFAULT_GAME_CONSTANTS, addMonster, placePlayer } from "./context";
import type { GameState, PlayerActor, PlayerCommand } from "./context";
import { newGear } from "./gear";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}
function packJson<T>(name: string): T[] {
  return (load(name) as { records: T[] }).records;
}

const terrain = load("terrain") as { records: TerrainRecordJson[] };
export const featureReg = new FeatureRegistry(terrain.records);
export const FLOOR = featureReg.byCodeName("FLOOR").fidx;
export const GRANITE = featureReg.byCodeName("GRANITE").fidx;

export const monReg = bindMonsters({
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
} as MonsterPackRecords);

export const plReg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
} as PlayerPackRecords);

/** A real race carrying a base and at least one blow, used as a template. */
const baseRace = monReg.races.find(
  (r) => r.base && r.blows.length > 0,
) as MonsterRace;

/** Build a monster blow from named pack method/effect and a dice string. */
export function makeBlow(
  methodName: string,
  effectName: string,
  diceStr: string,
): MonsterBlow {
  const method = monReg.blowMethods.get(methodName);
  const effect = monReg.blowEffects.get(effectName);
  if (!method || !effect) throw new Error(`missing blow ${methodName}/${effectName}`);
  const d = new Dice();
  d.parseString(diceStr);
  return { method, effect, dice: d, diceRaw: diceStr };
}

export interface RaceOverrides {
  level?: number;
  speed?: number;
  hearing?: number;
  smell?: number;
  mexp?: number;
  ac?: number;
  flags?: number[];
  blows?: MonsterBlow[];
}

/** A MonsterRace derived from the template, with a fresh flag set. */
export function makeRace(overrides: RaceOverrides = {}): MonsterRace {
  const flags = new FlagSet(RF_SIZE);
  for (const f of overrides.flags ?? []) flags.on(f);
  return {
    ...baseRace,
    level: overrides.level ?? 5,
    speed: overrides.speed ?? 110,
    hearing: overrides.hearing ?? 20,
    smell: overrides.smell ?? 0,
    mexp: overrides.mexp ?? 100,
    ac: overrides.ac ?? 10,
    flags,
    blows: overrides.blows ?? baseRace.blows,
  };
}

/** A level-1 player with full HP. */
export function makePlayer(): Player {
  const p = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  p.lev = 1;
  p.mhp = 1000;
  p.chp = 1000;
  return p;
}

/** A player combat state that hits reliably (calc_bonuses is deferred). */
export function defaultCombat(): PlayerCombatState {
  const skills = new Array<number>(SKILL.DIGGING + 1).fill(20);
  return {
    toH: 20,
    toD: 10,
    ac: 0,
    toA: 0,
    skills,
    numBlows: 100,
    ammoMult: 1,
    blessWield: false,
  };
}

export function defaultDefense(): DefenderState {
  return { ac: 0, toA: 0 };
}

/** An open floor field enclosed by granite, like the flow test's fixture. */
export function openField(w: number, h: number): Chunk {
  const c = new Chunk(featureReg, h, w);
  c.fill(GRANITE);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      c.setFeat(loc(x, y), FLOOR);
    }
  }
  return c;
}

export interface StateOptions {
  seed?: number;
  w?: number;
  h?: number;
  playerGrid?: Loc;
  speed?: number;
  stealth?: number;
  commands?: PlayerCommand[];
  updateFov?: (state: GameState) => void;
}

/** Build a GameState on an open field with the player placed and marked. */
export function makeState(opts: StateOptions = {}): GameState {
  const w = opts.w ?? 40;
  const h = opts.h ?? 25;
  const chunk = openField(w, h);
  const playerGrid = opts.playerGrid ?? loc(Math.floor(w / 2), Math.floor(h / 2));
  const commands = opts.commands ?? [];

  const actor: PlayerActor = {
    player: makePlayer(),
    grid: playerGrid,
    energy: 0,
    speed: opts.speed ?? 110,
    totalEnergy: 0,
    combat: defaultCombat(),
    defense: defaultDefense(),
    weapon: null,
    stealth: opts.stealth ?? 0,
  };

  const state: GameState = {
    rng: new Rng(opts.seed ?? 1),
    chunk,
    actor,
    gear: newGear(),
    monsters: [null],
    turn: 0,
    z: { ...DEFAULT_GAME_CONSTANTS },
    brands: [null],
    slays: [null],
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: () => commands.shift() ?? null,
    ...(opts.updateFov ? { updateFov: opts.updateFov } : {}),
  };

  placePlayer(state, playerGrid);
  return state;
}

/** Create a monster of `race` at `grid`, awake, and register it in the state. */
export function addMon(
  state: GameState,
  race: MonsterRace,
  grid: Loc,
  opts: { energy?: number; hp?: number } = {},
): Monster {
  const mon = blankMonster(race);
  mon.grid = grid;
  mon.maxhp = opts.hp ?? race.avgHp ?? 30;
  mon.hp = mon.maxhp;
  mon.mspeed = race.speed;
  mon.energy = opts.energy ?? 0;
  mon.mTimed[0] = 0; /* MON_TMD.SLEEP: awake. */
  addMonster(state, mon);
  return mon;
}
