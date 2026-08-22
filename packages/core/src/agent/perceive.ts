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
  FEAT,
  MON_RACE_FLAG_ENTRIES,
  MON_SPELL_ENTRIES,
  MON_TMD,
  SQUARE,
  TRF,
} from "../generated/index.js";
import type { FlagSet } from "../bitflag.js";
import { useFlavorGlyph } from "../visuals/object-glyph.js";
import type { GameState } from "../game/context.js";
import { gearGet } from "../game/gear.js";
import { LIGHTING } from "../visuals/tile-prefs.js";
import { monsterIsVisible } from "../mon/predicate.js";
import { PY_SPELL, spellChance } from "../player/spell.js";
import { makeSpellChanceEnv } from "../game/spell-cmd.js";
import { priceItem } from "../store/price.js";
import { squareIsDisarmableTrap } from "../game/trap.js";
import { itemView, playerViewFor } from "./entity-views.js";
import { simulateLoadout } from "./loadout.js";
import { AGENT_API_VERSION, AGENT_STATE_DOMAINS, AgentCapabilityError } from "./types.js";
import type {
  AgentCapabilities,
  AgentGlyphSource,
  AgentView,
  AgentViewDeps,
  CellView,
  ItemView,
  LoadoutChange,
  LoadoutSimulation,
  MonsterView,
  SpellbookView,
  SpellView,
  StoreItemView,
  StoreView,
  TargetView,
} from "./types.js";

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
    if (deps.resolver) {
      const raceId = deps.resolver.raceIdOrNull(m.race.ridx);
      if (raceId !== null) view.raceId = raceId;
    }
    if (deps.glyphs) {
      view.glyph = deps.glyphs.monsterChar(m.race.ridx) ?? m.race.dChar;
    }
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
    /* square_isdisarmabletrap, not "the trap list is non-empty": a closed door's
     * lock, a glyph of warding, a web and a decoy are all trap records, and none
     * of them is a trap the player sees or the disarm command will act on. See
     * CellView.trap. */
    trap: squareIsDisarmableTrap(state, grid),
  };
  if (deps.resolver) {
    const code = deps.resolver.featIdOrNull(feat);
    if (code !== null) view.featCode = code;
  }
  if (deps.glyphs) addGlyphs(view, state, grid, idx, deps.glyphs, deps);
  return view;
}

/**
 * The three drawn layers of a square (1.1.0), each read through the host's live
 * x_char table rather than the gamedata - see AgentGlyphSource on why.
 *
 * LIGHTING.LOS throughout. reset_visuals writes the same character into all
 * four lighting rows (glyph-table.ts reset()), so only a pref file that sets
 * one lighting variant apart can make the choice observable in the CHARACTER;
 * the thing lighting really varies is the attr, which this layer does not
 * report. LOS is what the shell's terrainGlyph defaults to.
 */
function addGlyphs(
  view: CellView,
  state: GameState,
  grid: { x: number; y: number },
  idx: number,
  glyphs: AgentGlyphSource,
  deps: AgentViewDeps,
): void {
  const c = state.chunk;

  /* THE MIMIC MUST BE RESOLVED, and this is the whole reason a hand-written
   * feature->character map cannot be right: a secret door's own feature is
   * FEAT_SECRET, and what the player sees is the granite it mimics. Drawing
   * the real feature would put every secret door on an agent's map.
   * (grid_data_as_text resolves the mimic before the table read, ui-map.c:180;
   * the shell's terrainGlyph does the same.) */
  const f = c.feature(grid);
  const disp = f.mimic !== null ? c.features.get(f.mimic) : f;
  view.glyph = glyphs.featChar(LIGHTING.LOS, disp.fidx) ?? disp.dChar;

  /* get_trap_graphics (ui-map.c:98) draws only a trap the player can SEE. An
   * unknown trap is not on the screen, so it is not in the view either. */
  const trap = (state.traps.get(idx) ?? []).find(
    (t) => t.flags.has(TRF["VISIBLE"]) && t.kind.glyph.trim() !== "",
  );
  if (trap) {
    view.trapGlyph = glyphs.trapChar(LIGHTING.LOS, trap.kind.tidx) ?? trap.kind.glyph;
  }

  /* map_info's object loop (cave-map.c:156-170): the first object in the pile
   * the player has not ignored draws; an ignored kind vanishes from the map
   * rather than staying visible on the floor. */
  const obj = (state.floor.get(idx) ?? []).find((o) => !state.isIgnored?.(o));
  if (obj) {
    /* object_kind_char (ui-object.c:87-112): a flavoured kind draws with its
     * FLAVOUR glyph until identified - and for a scroll, only while unaware,
     * because a scroll's flavour is its title rather than its appearance. */
    const flavor = state.flavorGlyph?.(obj.kind);
    const aware = deps.aware ?? state.isAware ?? ((): boolean => true);
    const useFlavor = useFlavorGlyph(obj.kind, flavor, aware(obj.kind));
    view.objectGlyph =
      (useFlavor ? glyphs.flavorChar(flavor.fidx) : glyphs.kindChar(obj.kind.kidx)) ??
      (useFlavor ? flavor.char : obj.kind.dChar);
  }
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
  /* Live cast-failure needs the derived stat indices; absent (before the first
   * calc_bonuses / worldless harness) the chance field is simply omitted. */
  const statInd = state.statInd;
  /* Same env as the cast/display paths so the perceived fail rate carries the
     OF_AFRAID / PF_UNLIGHT penalties (spell_chance is shared upstream). */
  const chanceEnv = makeSpellChanceEnv(state);
  return p.cls.magic.books.map((book) => ({
    tval: book.tvalIdx,
    name: book.name,
    realm: book.realm.name,
    spells: book.spells.map((s) => {
      const flags = p.spellFlags[s.sidx] ?? 0;
      const view: SpellView = {
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
      if (statInd) view.chance = spellChance(p, statInd, s.sidx, chanceEnv);
      return view;
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
/**
 * Wrap an accessor so it throws AgentCapabilityError unless the caller was
 * granted "state:<domain>.read" (the "state:*.read" wildcard covers all). With
 * no AgentCapabilities (a trusted in-process host) the accessor is returned
 * unchanged - every domain is granted.
 */
function gateRead<A extends unknown[], R>(
  caps: AgentCapabilities | undefined,
  domain: string,
  fn: (...args: A) => R,
): (...args: A) => R {
  if (!caps) return fn;
  const cap = `state:${domain}.read`;
  return (...args: A): R => {
    // Accept the specific domain or the explicit "state:*.read" wildcard, so
    // enforcement holds for any AgentCapabilities, not only one that expands
    // wildcards itself (mod-sdk CapabilitySet does; a bare stub may not).
    if (!caps.has(cap) && !caps.has("state:*.read")) {
      throw new AgentCapabilityError(
        `agent perceive: capability "${cap}" is not granted`,
      );
    }
    return fn(...args);
  };
}

export function createAgentView(
  state: GameState,
  messageBuffer?: { drain(): string[] },
  deps: AgentViewDeps = {},
  caps?: AgentCapabilities,
): AgentView {
  const D = AGENT_STATE_DOMAINS;
  return {
    apiVersion: AGENT_API_VERSION,
    turn: gateRead(caps, D.turn, () => state.turn),
    player: gateRead(caps, D.player, () => playerViewFor(state, deps)),
    monsters: gateRead(caps, D.monsters, () => monsterViews(state, deps)),
    cell: gateRead(caps, D.map, (x: number, y: number) =>
      cellView(state, x, y, deps),
    ),
    mapBounds: gateRead(caps, D.map, () => ({
      width: state.chunk.width,
      height: state.chunk.height,
    })),
    inventory: gateRead(caps, D.inventory, () => {
      const out: ItemView[] = [];
      for (const handle of state.gear.pack) {
        const obj = gearGet(state.gear, handle);
        if (obj) out.push(itemView(handle, obj, state, deps));
      }
      return out;
    }),
    equipment: gateRead(caps, D.inventory, () =>
      state.actor.player.equipment.map((handle) => {
        if (!handle) return null;
        const obj = gearGet(state.gear, handle);
        return obj ? itemView(handle, obj, state, deps) : null;
      }),
    ),
    floorItems: gateRead(caps, D.floor, (x: number, y: number) => {
      const pile = state.floor.get(y * state.chunk.width + x) ?? [];
      return pile.map((obj) => itemView(0, obj, state, deps));
    }),
    target: gateRead(caps, D.target, (): TargetView | null => {
      const t = state.target;
      if (!t.set && !t.fixed) return null;
      return { midx: t.midx, grid: { x: t.grid.x, y: t.grid.y } };
    }),
    messages: gateRead(caps, D.messages, () => messageBuffer?.drain() ?? []),
    stores: gateRead(caps, D.stores, () => storeViews(state, deps)),
    spellbooks: gateRead(caps, D.spells, () => spellbookViews(state)),
    constants: gateRead(caps, D.constants, () => ({ ...state.z })),
    /* The same deps as every accessor above, on purpose: an ItemView from a
     * simulated loadout has to be interchangeable with one from the live pack,
     * or an agent's decision would depend on which read produced the object.
     * Gated on the player domain, since what it answers is a question about the
     * player. */
    simulateLoadout: gateRead(
      caps,
      D.player,
      (change: LoadoutChange): LoadoutSimulation | null =>
        simulateLoadout(state, change, { viewDeps: deps }),
    ),
  };
}
