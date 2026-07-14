/**
 * The perceive facade (P7.7): build a read-only AgentView over a live GameState,
 * covering the BORG_AS_MOD section-3 read surface. Every accessor returns fresh
 * plain data (no references into live engine objects), so the view is read-only
 * by construction and already serializable across a future sandbox boundary.
 *
 * This is the first faithful breadth: player vitals + status, visible monsters,
 * map cells, carried/worn/floor items, the target, and the per-decision message
 * stream (fed by the controller's message tap). A second breadth adds object
 * flags/brands/slays/resists/curses detail on ItemView, store stock, the
 * class spellbook/spell tables, and namespaced ids (raceId/kindId/featCode) -
 * every one of the second-breadth fields is behind an optional AgentViewDeps so
 * the worldless test harness (no resolver/registry/playerState/stores) stays
 * total: absent deps degrade to [] / false / omission, never a throw.
 */

import {
  ELEMENT_ENTRIES,
  FEAT,
  MON_RACE_FLAG_ENTRIES,
  MON_SPELL_ENTRIES,
  MON_TMD,
  OBJECT_FLAG_ENTRIES,
  SQUARE,
  TMD,
} from "../generated";
import type { FlagSet } from "../bitflag";
import type { GameState } from "../game/context";
import { gearGet } from "../game/gear";
import type { GameObject } from "../obj/object";
import { OBJ_MOD_NAMES } from "../obj/bind";
import { objectValue } from "../obj/value";
import { monsterIsVisible } from "../mon/predicate";
import { PY_SPELL } from "../player/spell";
import { priceItem } from "../store/price";
import { AGENT_API_VERSION } from "./types";
import type {
  AgentView,
  AgentViewDeps,
  CellView,
  ItemView,
  MonsterView,
  PlayerView,
  SpellbookView,
  StoreItemView,
  StoreView,
  TargetView,
} from "./types";

/** OF_* codes for the set flags in an object-flag FlagSet (OF is 1-indexed). */
function ofCodes(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const entry = OBJECT_FLAG_ENTRIES[f - 1];
    if (entry) out.push(entry.name);
  }
  return out;
}

/** RF_* codes for the set flags in a race-flag FlagSet (entry index == RF value). */
function raceFlagCodes(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const entry = MON_RACE_FLAG_ENTRIES[f];
    if (entry) out.push(entry.name);
  }
  return out;
}

/** RSF_* codes for the set flags in a spell-flag FlagSet (entry index == RSF value). */
function spellFlagCodes(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const entry = MON_SPELL_ENTRIES[f];
    if (entry) out.push(entry.name);
  }
  return out;
}

function itemView(
  handle: number,
  obj: GameObject,
  state: GameState,
  deps: AgentViewDeps,
): ItemView {
  const modifiers: Array<{ code: string; value: number }> = [];
  for (let i = 0; i < obj.modifiers.length; i++) {
    const value = obj.modifiers[i] ?? 0;
    if (value === 0) continue;
    const code = OBJ_MOD_NAMES[i];
    if (code) modifiers.push({ code, value });
  }

  const brands: string[] = [];
  if (obj.brands) {
    for (let i = 0; i < obj.brands.length; i++) {
      if (!obj.brands[i]) continue;
      const code = state.brands[i]?.code;
      if (code) brands.push(code);
    }
  }

  const slays: string[] = [];
  if (obj.slays) {
    for (let i = 0; i < obj.slays.length; i++) {
      if (!obj.slays[i]) continue;
      const code = state.slays[i]?.code;
      if (code) slays.push(code);
    }
  }

  const resists: Array<{ element: string; level: number }> = [];
  for (let i = 0; i < obj.elInfo.length; i++) {
    const level = obj.elInfo[i]?.resLevel ?? 0;
    if (level === 0) continue;
    const name = ELEMENT_ENTRIES[i]?.name;
    if (name) resists.push({ element: name, level });
  }

  const curses: string[] = [];
  if (obj.curses) {
    for (let i = 0; i < obj.curses.length; i++) {
      const power = obj.curses[i]?.power ?? 0;
      if (power <= 0) continue;
      /* Real curse names come from the bound registry (already threaded for
       * pricing); fall back to the numeric index when no registry dep was
       * supplied. */
      curses.push(deps.reg?.curses[i]?.name ?? String(i));
    }
  }

  const view: ItemView = {
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
    flags: ofCodes(obj.flags),
    modifiers,
    brands,
    slays,
    resists,
    curses,
    egoName: obj.ego?.name ?? null,
    artifactName: obj.artifact?.name ?? null,
    activation: obj.activation !== null,
    timeout: obj.timeout,
    inscription: obj.note ?? null,
  };
  if (deps.resolver) view.kindId = deps.resolver.kindId(obj.kind.kidx);
  if (deps.reg) {
    const aware = deps.aware ?? ((): boolean => true);
    view.value = objectValue(deps.reg, obj, obj.number, aware(obj.kind));
  }
  return view;
}

function playerView(state: GameState): PlayerView {
  const p = state.actor.player;
  const combat = state.actor.combat;
  const playerState = state.playerState;
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
    skills: [...p.skills],
    shape: p.shape?.name ?? null,
    objectFlags: playerState ? ofCodes(playerState.flags) : [],
    seeInfra: playerState?.seeInfra ?? p.race.infravision,
    blows: combat.numBlows,
    shots: combat.numShots,
  };
}

function monsterViews(state: GameState, deps: AgentViewDeps): MonsterView[] {
  const out: MonsterView[] = [];
  for (let i = 1; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    if (!m) continue;
    const view: MonsterView = {
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
      level: m.race.level,
      /* No MON_TMD_* poison timer exists upstream (monsters are never
       * "poisoned" as a timed status in 4.2.6); always false. */
      poisoned: false,
      raceFlags: raceFlagCodes(m.race.flags),
      spellFlags: spellFlagCodes(m.race.spellFlags),
    };
    if (deps.resolver) view.raceId = deps.resolver.raceId(m.race.ridx);
    out.push(view);
  }
  return out;
}

function cellView(
  state: GameState,
  x: number,
  y: number,
  deps: AgentViewDeps,
): CellView | null {
  const grid = { x, y };
  const c = state.chunk;
  if (!c.inBounds(grid)) return null;
  const idx = y * c.width + x;
  const feat = c.feat(grid);
  const view: CellView = {
    x,
    y,
    feat,
    passable: c.isPassable(grid),
    inView: c.sqinfoHas(grid, SQUARE["VIEW"]),
    known: (state.known.feat[idx] ?? -1) >= 0,
    monster: c.mon(grid),
    objectCount: (state.floor.get(idx) ?? []).length,
    glow: c.sqinfoHas(grid, SQUARE["GLOW"]),
    trap: (state.traps.get(idx)?.length ?? 0) > 0,
  };
  if (deps.resolver) {
    const code = deps.resolver.featIdOrNull(feat);
    if (code !== null) view.featCode = code;
  }
  return view;
}

function storeViews(state: GameState, deps: AgentViewDeps): StoreView[] {
  const stores = state.stores ?? [];
  return stores.map((store) => {
    const isHome = store.feat === FEAT.HOME;
    const aware = deps.aware ?? ((): boolean => true);
    const stock: StoreItemView[] = store.stock.map((obj, index) => {
      const item = itemView(0, obj, state, deps);
      const view: StoreItemView = { ...item, index };
      if (deps.reg && !isHome) {
        view.price = priceItem(
          deps.reg,
          store,
          store.owner,
          obj,
          false,
          1,
          aware(obj.kind),
          deps.noSelling ?? false,
        );
      }
      return view;
    });
    return {
      feat: store.feat,
      featName: store.featName,
      isHome,
      owner: { name: store.owner.name, purse: store.owner.maxCost },
      stock,
    };
  });
}

function spellbookViews(state: GameState): SpellbookView[] {
  const p = state.actor.player;
  return p.cls.magic.books.map((book) => ({
    tval: book.tvalIdx,
    name: book.name,
    realm: book.realm.name,
    spells: book.spells.map((s) => {
      const flags = p.spellFlags[s.sidx] ?? 0;
      return {
        name: s.name,
        sidx: s.sidx,
        bidx: s.bidx,
        level: s.level,
        mana: s.mana,
        fail: s.fail,
        learned: (flags & PY_SPELL.LEARNED) !== 0,
        worked: (flags & PY_SPELL.WORKED) !== 0,
        forgotten: (flags & PY_SPELL.FORGOTTEN) !== 0,
      };
    }),
  }));
}

/**
 * Build a perceive view over a live state. `messageBuffer` is the controller's
 * per-decision message tap (drained by messages()); absent, the stream is
 * empty. `deps` unlocks the richer fields (namespaced ids, store pricing,
 * object value); every field of AgentViewDeps is optional and degrades
 * gracefully when absent (see module docs).
 */
export function createAgentView(
  state: GameState,
  messageBuffer?: { drain(): string[] },
  deps: AgentViewDeps = {},
): AgentView {
  return {
    apiVersion: AGENT_API_VERSION,
    turn: () => state.turn,
    player: () => playerView(state),
    monsters: () => monsterViews(state, deps),
    cell: (x, y) => cellView(state, x, y, deps),
    mapBounds: () => ({ width: state.chunk.width, height: state.chunk.height }),
    inventory: () => {
      const out: ItemView[] = [];
      for (const handle of state.gear.pack) {
        const obj = gearGet(state.gear, handle);
        if (obj) out.push(itemView(handle, obj, state, deps));
      }
      return out;
    },
    equipment: () =>
      state.actor.player.equipment.map((handle) => {
        if (!handle) return null;
        const obj = gearGet(state.gear, handle);
        return obj ? itemView(handle, obj, state, deps) : null;
      }),
    floorItems: (x, y) => {
      const pile = state.floor.get(y * state.chunk.width + x) ?? [];
      return pile.map((obj) => itemView(0, obj, state, deps));
    },
    target: (): TargetView | null => {
      const t = state.target;
      if (!t.set && !t.fixed) return null;
      return { midx: t.midx, grid: { x: t.grid.x, y: t.grid.y } };
    },
    messages: () => messageBuffer?.drain() ?? [],
    stores: () => storeViews(state, deps),
    spellbooks: () => spellbookViews(state),
    constants: () => ({ ...state.z }),
  };
}
