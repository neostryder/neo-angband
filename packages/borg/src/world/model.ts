/**
 * The Borg's aggregate world model - a faithful port of the upstream global
 * singletons: struct borg_struct `borg` (borg-trait.h), the borg_grids map, the
 * borg_kills / borg_takes tracking lists, and the per-level fact flags.
 *
 * Upstream these are file-scope globals; the port collects them into one
 * BorgWorld instance so multiple Borgs (or tests) can coexist and so nothing
 * leaks into module state. Field names and layout stay faithful so the ported
 * subsystems (flow, danger, power, fight, think) read the same shape.
 */

import { BorgMap } from "./grid";
import { BorgKills } from "./kill";
import { BorgTakes } from "./take";

/** Goal types (borg-trait.h). goal.type selects the active flow. */
export const GOAL_KILL = 1; /* Monsters */
export const GOAL_TAKE = 2; /* Objects */
export const GOAL_MISC = 3; /* Stores */
export const GOAL_DARK = 4; /* Exploring */
export const GOAL_XTRA = 5; /* Searching */
export const GOAL_BORE = 6; /* Leaving */
export const GOAL_FLEE = 7; /* Fleeing */
export const GOAL_VAULT = 8; /* Vaults */
export const GOAL_RECOVER = 9; /* Resting safely */
export const GOAL_DIGGING = 10; /* Anti-summon corridor */

/** struct goals - the Borg's current navigation/strategy intent. */
export interface Goals {
  /** Active goal type (GOAL_*), 0 for none. */
  type: number;
  /** Goal location. */
  g: { x: number; y: number };
  rising: boolean; /* returning to town */
  leaving: boolean; /* leaving the level */
  fleeing: boolean; /* fleeing the level */
  fleeingLunal: boolean;
  fleeingMunchkin: boolean;
  fleeingToTown: boolean;
  ignoring: boolean; /* ignoring monsters */
  less: boolean; /* return to, but don't use, the up stairs */
  waiting: boolean; /* waiting for an approaching monster */
  recalling: number; /* turns-left guess while waiting for recall */
  descending: number; /* waiting for deep descent */
  shop: number; /* next shop to visit */
  ware: number; /* next item to buy there */
  item: number; /* next item to sell there */
  doBest: boolean;
}

/** A fresh, zeroed goal set. */
export function makeGoals(): Goals {
  return {
    type: 0,
    g: { x: 0, y: 0 },
    rising: false,
    leaving: false,
    fleeing: false,
    fleeingLunal: false,
    fleeingMunchkin: false,
    fleeingToTown: false,
    ignoring: false,
    less: false,
    waiting: false,
    recalling: 0,
    descending: 0,
    shop: 0,
    ware: 0,
    item: 0,
    doBest: false,
  };
}

/** struct temp - transient buff/resistance state assumed during simulation. */
export interface Temp {
  needSeeInvis: number;
  seeInv: number;
  resFire: boolean;
  resCold: boolean;
  resAcid: boolean;
  resElec: boolean;
  resPois: boolean;
  protFromEvil: boolean;
  fast: boolean;
  bless: boolean;
  hero: boolean;
  berserk: boolean;
  fastcast: boolean;
  regen: boolean;
  smiteEvil: boolean;
  venom: boolean;
  shield: boolean;
}

/** A fresh, zeroed temp state. */
export function makeTemp(): Temp {
  return {
    needSeeInvis: 0,
    seeInv: 0,
    resFire: false,
    resCold: false,
    resAcid: false,
    resElec: false,
    resPois: false,
    protFromEvil: false,
    fast: false,
    bless: false,
    hero: false,
    berserk: false,
    fastcast: false,
    regen: false,
    smiteEvil: false,
    venom: false,
    shield: false,
  };
}

/**
 * struct borg_struct - everything the Borg knows about itself.
 *
 * `trait[]` (the ~350-entry BI_* derived-stat array), `has[]` and
 * `activation[]` are sized and filled by the self-model port (P8.3, borg_notice
 * / borg_power); the foundation allocates them empty so the shape exists.
 */
export interface BorgSelf {
  /** Derived traits, indexed by BI_* (filled by borg_notice, P8.3). */
  trait: number[];
  /** Counts of items the Borg has, indexed by the `has` enum (P8.3). */
  has: number[];
  /** Artifact activations available (P8.3). */
  activation: number[];
  /** How powerful the Borg thinks it is (borg_power, P8.3). */
  power: number;
  /** Current location. */
  c: { x: number; y: number };
  /** HP last game turn, to track change. */
  oldchp: number;

  /* activity flags */
  lunalMode: boolean;
  munchkinMode: boolean;
  stairLess: boolean; /* use the next up staircase */
  stairMore: boolean; /* use the next down staircase */
  inShop: boolean;
  /** 3-state: -1 unchecked, 0 not ready, 1 ready. */
  readyMorgoth: number;

  temp: Temp;
  goal: Goals;

  /* panel / shift */
  needShiftPanel: boolean;
  whenShiftPanel: number;
  timeThisPanel: number;

  /* timed activity flags */
  noRetreat: number;
  resistance: number;
  whenCallLight: number;
  whenWizardLight: number;
  whenDetectTraps: number;
  whenDetectDoors: number;
  whenDetectWalls: number;
  whenDetectEvil: number;
  whenDetectObj: number;
  whenLastKillMult: number;
  noRestPrep: number;

  /* anti-loop counters (load-bearing thresholds; preserved verbatim) */
  timesTwitch: number;
  escapes: number;
}

/** A fresh Borg self-model (borg_init leaves most fields zeroed). */
export function makeBorgSelf(): BorgSelf {
  return {
    trait: [],
    has: [],
    activation: [],
    power: 0,
    c: { x: 0, y: 0 },
    oldchp: 0,
    lunalMode: false,
    munchkinMode: false,
    stairLess: false,
    stairMore: false,
    inShop: false,
    readyMorgoth: -1,
    temp: makeTemp(),
    goal: makeGoals(),
    needShiftPanel: false,
    whenShiftPanel: 0,
    timeThisPanel: 0,
    noRetreat: 0,
    resistance: 0,
    whenCallLight: 0,
    whenWizardLight: 0,
    whenDetectTraps: 0,
    whenDetectDoors: 0,
    whenDetectWalls: 0,
    whenDetectEvil: 0,
    whenDetectObj: 0,
    whenLastKillMult: 0,
    noRestPrep: 0,
    timesTwitch: 0,
    escapes: 0,
  };
}

/** Per-level facts the Borg derives from what it perceives (borg-flow-kill.h). */
export interface LevelFacts {
  uniqueOnLevel: number;
  scaryGuyOnLevel: boolean;
  morgothOnLevel: boolean;
  breederLevel: boolean;
  vaultOnLevel: boolean;
  /** Depth the Borg believes it is on. */
  depth: number;
}

/** Fresh per-level facts. */
export function makeLevelFacts(): LevelFacts {
  return {
    uniqueOnLevel: 0,
    scaryGuyOnLevel: false,
    morgothOnLevel: false,
    breederLevel: false,
    vaultOnLevel: false,
    depth: 0,
  };
}

/**
 * The complete Borg world model, replacing the upstream file-scope globals with
 * one owned instance. Perception (perceive.ts) writes it; every decision
 * subsystem reads it.
 */
export class BorgWorld {
  readonly map = new BorgMap();
  readonly kills = new BorgKills();
  readonly takes = new BorgTakes();
  readonly self = makeBorgSelf();
  facts = makeLevelFacts();

  /**
   * borg_t: the Borg's own clock, incremented per decision. The anti-loop
   * heuristics (boredom, twitch, monster expiry) are gated on this, so it must
   * advance exactly once per think (see controller.ts).
   */
  clock = 0;

  /** True once at least one perception has populated the model. */
  seeded = false;

  /** Reset everything for a new level (borg_init_cave + list wipes). */
  wipeLevel(): void {
    this.map.wipe();
    this.kills.wipe();
    this.takes.wipe();
    this.facts = makeLevelFacts();
    this.self.goal = makeGoals();
    this.self.timeThisPanel = 0;
    this.self.timesTwitch = 0;
    this.self.escapes = 0;
  }
}
