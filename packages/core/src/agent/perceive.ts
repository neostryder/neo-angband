/**
 * The perceive facade (P7.7): build a read-only AgentView over a live GameState,
 * covering the BORG_AS_MOD section-3 read surface. Every accessor returns fresh
 * plain data (no references into live engine objects), so the view is read-only
 * by construction and already serializable across a future sandbox boundary.
 *
 * This is the first faithful breadth: player vitals + status, visible monsters,
 * map cells, carried/worn/floor items, the target, and the per-decision message
 * stream (fed by the controller's message tap). Documented follow-ups toward the
 * full section-3 surface: namespaced race/kind ids (instead of names+indices),
 * store/home stock, the race/class spell tables, and object flags/brands/slays
 * detail on ItemView.
 */

import { MON_TMD, SQUARE, TMD } from "../generated";
import type { GameState } from "../game/context";
import { gearGet } from "../game/gear";
import type { GameObject } from "../obj/object";
import { monsterIsVisible } from "../mon/predicate";
import { AGENT_API_VERSION } from "./types";
import type {
  AgentView,
  CellView,
  ItemView,
  MonsterView,
  PlayerView,
  TargetView,
} from "./types";

function itemView(handle: number, obj: GameObject): ItemView {
  return {
    handle,
    label: obj.kind.name,
    tval: obj.tval,
    sval: obj.sval,
    pval: obj.pval,
    number: obj.number,
    weight: obj.weight,
    ac: obj.ac,
    toA: obj.toA,
    toH: obj.toH,
    toD: obj.toD,
    dd: obj.dd,
    ds: obj.ds,
    ego: obj.ego !== null,
    artifact: obj.artifact !== null,
  };
}

function playerView(state: GameState): PlayerView {
  const p = state.actor.player;
  const combat = state.actor.combat;
  return {
    race: p.race.name,
    cls: p.cls.name,
    level: p.lev,
    maxLevel: p.maxLev,
    exp: p.exp,
    maxExp: p.maxExp,
    gold: p.au,
    depth: state.chunk.depth,
    maxDepth: p.maxDepth,
    hp: p.chp,
    maxHp: p.mhp,
    sp: p.csp,
    maxSp: p.msp,
    speed: state.actor.speed,
    /* Displayed AC is state->ac + state->to_a. */
    ac: combat.ac + combat.toA,
    toHit: combat.toH,
    toDam: combat.toD,
    stats: [...p.statCur],
    light: state.actor.light,
    grid: { x: state.actor.grid.x, y: state.actor.grid.y },
    status: {
      blind: p.timed[TMD.BLIND] ?? 0,
      confused: p.timed[TMD.CONFUSED] ?? 0,
      afraid: p.timed[TMD.AFRAID] ?? 0,
      poisoned: p.timed[TMD.POISONED] ?? 0,
      cut: p.timed[TMD.CUT] ?? 0,
      stun: p.timed[TMD.STUN] ?? 0,
      paralyzed: p.timed[TMD.PARALYZED] ?? 0,
      food: p.timed[TMD.FOOD] ?? 0,
    },
    dead: state.isDead,
    winner: p.totalWinner,
  };
}

function monsterViews(state: GameState): MonsterView[] {
  const out: MonsterView[] = [];
  for (let i = 1; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    if (!m) continue;
    out.push({
      id: m.midx,
      race: m.race.name,
      raceIndex: m.race.ridx,
      grid: { x: m.grid.x, y: m.grid.y },
      visible: monsterIsVisible(m),
      hp: m.hp,
      maxHp: m.maxhp,
      speed: m.mspeed,
      asleep: (m.mTimed[MON_TMD.SLEEP] ?? 0) > 0,
      afraid: (m.mTimed[MON_TMD.FEAR] ?? 0) > 0,
      confused: (m.mTimed[MON_TMD.CONF] ?? 0) > 0,
      stunned: (m.mTimed[MON_TMD.STUN] ?? 0) > 0,
    });
  }
  return out;
}

function cellView(state: GameState, x: number, y: number): CellView | null {
  const grid = { x, y };
  const c = state.chunk;
  if (!c.inBounds(grid)) return null;
  const idx = y * c.width + x;
  return {
    x,
    y,
    feat: c.feat(grid),
    passable: c.isPassable(grid),
    inView: c.sqinfoHas(grid, SQUARE["VIEW"]),
    known: (state.known.feat[idx] ?? -1) >= 0,
    monster: c.mon(grid),
    objectCount: (state.floor.get(idx) ?? []).length,
  };
}

/**
 * Build a perceive view over a live state. `messageBuffer` is the controller's
 * per-decision message tap (drained by messages()); absent, the stream is empty.
 */
export function createAgentView(
  state: GameState,
  messageBuffer?: { drain(): string[] },
): AgentView {
  return {
    apiVersion: AGENT_API_VERSION,
    turn: () => state.turn,
    player: () => playerView(state),
    monsters: () => monsterViews(state),
    cell: (x, y) => cellView(state, x, y),
    mapBounds: () => ({ width: state.chunk.width, height: state.chunk.height }),
    inventory: () => {
      const out: ItemView[] = [];
      for (const handle of state.gear.pack) {
        const obj = gearGet(state.gear, handle);
        if (obj) out.push(itemView(handle, obj));
      }
      return out;
    },
    equipment: () =>
      state.actor.player.equipment.map((handle) => {
        if (!handle) return null;
        const obj = gearGet(state.gear, handle);
        return obj ? itemView(handle, obj) : null;
      }),
    floorItems: (x, y) => {
      const pile = state.floor.get(y * state.chunk.width + x) ?? [];
      return pile.map((obj) => itemView(0, obj));
    },
    target: (): TargetView | null => {
      const t = state.target;
      if (!t.set && !t.fixed) return null;
      return { midx: t.midx, grid: { x: t.grid.x, y: t.grid.y } };
    },
    messages: () => messageBuffer?.drain() ?? [],
  };
}
