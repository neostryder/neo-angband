/**
 * The Borg test harness: a scenario-driven fake AgentView / AgentActions built
 * against the FROZEN agent contract (core/src/agent/types.ts), so every Borg
 * subsystem can be unit-tested without booting a live engine.
 *
 * WHY A FAKE VIEW, NOT A REAL GAMESTATE: the Borg only ever sees the world
 * through the frozen perceive/act facade. Testing against a hand-built view of
 * that exact contract (a) keeps Borg tests fast and deterministic, (b) decouples
 * them from core's internal harness, and (c) is the natural substrate for the
 * golden-master checks the bulk subsystems add (feed a known scenario, assert
 * the ported flow/danger/power output matches the reference-derived value).
 *
 * The fake act builders return the SAME command shapes the real facade emits
 * (verified against agent.test.ts): move/melee -> {code:"walk",dir}, hold ->
 * {code:"hold"}, quaff -> {code:"quaff",args:{handle}}, etc. If the frozen
 * contract ever gains a verb, mirror it here.
 */

import type {
  AgentView,
  AgentActions,
  AgentCommand,
  PlayerView,
  MonsterView,
  CellView,
  ItemView,
  GameConstants,
} from "@neo-angband/core";

/** A cell override in a scenario (all fields optional; sensible floor default). */
export type ScenarioCell = Partial<CellView>;

/** A compact scenario spec; every field has a faithful default. */
export interface Scenario {
  width?: number;
  height?: number;
  /** Player overrides (position defaults to the map center). */
  player?: Partial<PlayerView>;
  /** Monsters present (each needs at least a grid; other fields default). */
  monsters?: Array<Partial<MonsterView> & { grid: { x: number; y: number } }>;
  /** Per-grid cell overrides, keyed "x,y". Absent grids default to known floor. */
  cells?: Record<string, ScenarioCell>;
  /** Floor items, keyed "x,y". */
  floor?: Record<string, ItemView[]>;
  /** Messages "since last decision". */
  messages?: string[];
  /** Turn counter. */
  turn?: number;
  /** Feature index a default (unoverridden) floor cell reports. */
  floorFeat?: number;
}

const DEFAULT_W = 40;
const DEFAULT_H = 25;

/** A complete PlayerView with faithful, alive-at-full-health defaults. */
function defaultPlayer(w: number, h: number): PlayerView {
  return {
    race: "Human",
    cls: "Warrior",
    level: 1,
    maxLevel: 1,
    exp: 0,
    maxExp: 0,
    gold: 0,
    depth: 0,
    maxDepth: 0,
    hp: 20,
    maxHp: 20,
    sp: 0,
    maxSp: 0,
    speed: 110,
    ac: 0,
    toHit: 0,
    toDam: 0,
    stats: [10, 10, 10, 10, 10],
    light: 1,
    grid: { x: Math.floor(w / 2), y: Math.floor(h / 2) },
    status: {
      blind: 0,
      confused: 0,
      afraid: 0,
      poisoned: 0,
      cut: 0,
      stun: 0,
      paralyzed: 0,
      food: 5000,
    },
    dead: false,
    winner: false,
    skills: [],
    shape: null,
    objectFlags: [],
    seeInfra: 0,
    blows: 100,
    shots: 0,
  };
}

/** A complete MonsterView from a partial (grid required). */
function completeMonster(
  m: Partial<MonsterView> & { grid: { x: number; y: number } },
  idx: number,
): MonsterView {
  return {
    id: m.id ?? idx + 1,
    race: m.race ?? "monster",
    raceIndex: m.raceIndex ?? 1,
    grid: m.grid,
    visible: m.visible ?? true,
    hp: m.hp ?? 10,
    maxHp: m.maxHp ?? 10,
    speed: m.speed ?? 110,
    asleep: m.asleep ?? false,
    afraid: m.afraid ?? false,
    confused: m.confused ?? false,
    stunned: m.stunned ?? false,
    level: m.level ?? 1,
    poisoned: m.poisoned ?? false,
    raceFlags: m.raceFlags ?? [],
    spellFlags: m.spellFlags ?? [],
    ...(m.raceId !== undefined ? { raceId: m.raceId } : {}),
  };
}

/** A minimal GameConstants clone for scenarios that read constants(). */
function minimalConstants(): GameConstants {
  // The foundation's think stub does not read constants; scenarios that need
  // specific z_info values set them via the returned object in the test.
  return {} as GameConstants;
}

/** Build a fake AgentView from a scenario. */
export function makeScenarioView(scenario: Scenario = {}): AgentView {
  const width = scenario.width ?? DEFAULT_W;
  const height = scenario.height ?? DEFAULT_H;
  const floorFeat = scenario.floorFeat ?? 1;
  const player = { ...defaultPlayer(width, height), ...scenario.player };
  const monsters = (scenario.monsters ?? []).map(completeMonster);
  const cells = scenario.cells ?? {};
  const floor = scenario.floor ?? {};
  const messages = scenario.messages ?? [];
  const turn = scenario.turn ?? 0;
  const constants = minimalConstants();

  // A monster occupies its grid (mirrors CellView.monster back-reference).
  const monsterAt = new Map<string, number>();
  for (const m of monsters) monsterAt.set(`${m.grid.x},${m.grid.y}`, m.id);

  let messagesDrained = false;

  const defaultCell = (x: number, y: number): CellView => ({
    x,
    y,
    feat: floorFeat,
    passable: true,
    inView: true,
    known: true,
    monster: monsterAt.get(`${x},${y}`) ?? 0,
    objectCount: (floor[`${x},${y}`]?.length ?? 0) > 0 ? 1 : 0,
    glow: false,
    trap: false,
  });

  return {
    apiVersion: "1.0.0",
    turn: () => turn,
    player: () => structuredClone(player),
    monsters: () => monsters.map((m) => structuredClone(m)),
    cell: (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return null;
      const base = defaultCell(x, y);
      const override = cells[`${x},${y}`];
      return override ? { ...base, ...override } : base;
    },
    mapBounds: () => ({ width, height }),
    inventory: () => [],
    equipment: () => [],
    floorItems: (x, y) =>
      (floor[`${x},${y}`] ?? []).map((i) => structuredClone(i)),
    target: () => null,
    messages: () => {
      if (messagesDrained) return [];
      messagesDrained = true;
      return [...messages];
    },
    stores: () => [],
    spellbooks: () => [],
    constants: () => structuredClone(constants),
  };
}

/**
 * A fake AgentActions whose builders match the frozen command shapes. Records
 * every command it built (for assertions) on `.log`.
 */
export interface FakeActions extends AgentActions {
  /** Commands built so far, in order. */
  readonly log: AgentCommand[];
  /** Targets set via setTargetMonster / setTargetLocation. */
  readonly targets: Array<{ midx?: number; x?: number; y?: number }>;
}

/** Build a recording fake act facade. */
export function makeFakeActions(): FakeActions {
  const log: AgentCommand[] = [];
  const targets: Array<{ midx?: number; x?: number; y?: number }> = [];
  const rec = (c: AgentCommand): AgentCommand => {
    log.push(c);
    return c;
  };
  const withArgs = (
    code: string,
    args: Record<string, unknown>,
  ): AgentCommand => rec({ code, args });

  return {
    log,
    targets,
    move: (dir) => rec({ code: "walk", dir }),
    melee: (dir) => rec({ code: "walk", dir }),
    hold: () => rec({ code: "hold" }),
    rest: () => rec({ code: "rest" }),
    descend: () => rec({ code: "descend" }),
    ascend: () => rec({ code: "ascend" }),
    tunnel: (dir) => rec({ code: "tunnel", dir }),
    open: (dir) => rec({ code: "open", dir }),
    close: (dir) => rec({ code: "close", dir }),
    disarm: (dir) => rec({ code: "disarm", dir }),
    quaff: (handle) => withArgs("quaff", { handle }),
    read: (handle) => withArgs("read", { handle }),
    eat: (handle) => withArgs("eat", { handle }),
    wear: (handle) => withArgs("wield", { handle }),
    takeoff: (handle) => withArgs("takeoff", { handle }),
    drop: (handle, number) =>
      withArgs("drop", { handle, quantity: number ?? 1 }),
    pickup: () => rec({ code: "pickup" }),
    destroy: (handle) => withArgs("destroy", { handle }),
    aimWand: (handle) => withArgs("aim-wand", { handle }),
    zapRod: (handle) => withArgs("zap-rod", { handle }),
    useStaff: (handle) => withArgs("use-staff", { handle }),
    activate: (handle) => withArgs("activate", { handle }),
    fire: (handle) => withArgs("fire", { handle }),
    throw: (handle) => withArgs("throw", { handle }),
    cast: (spell) => withArgs("cast", { spell }),
    setTargetMonster: (midx) => {
      targets.push({ midx });
      return true;
    },
    setTargetLocation: (x, y) => {
      targets.push({ x, y });
    },
    shopBuy: (index, number) =>
      withArgs("shop-buy", { index, quantity: number ?? 1 }),
    shopSell: (handle, number) =>
      withArgs("shop-sell", { handle, quantity: number ?? 1 }),
    shopExit: () => rec({ code: "shop-exit" }),
    raw: (code, args) => rec(args ? { code, args } : { code }),
  };
}
