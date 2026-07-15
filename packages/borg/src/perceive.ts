/**
 * Perception: fold what the Borg can see (the frozen AgentView) into its own
 * world model (BorgWorld). This is the port of borg_update / borg_update_map
 * (reference/src/borg/borg-update.c) adapted from the C borg's screen-scrape to
 * our clean perceive facade.
 *
 * FIDELITY NOTE. The C borg re-derives monster/object identity from on-screen
 * symbols and consumes parsed game messages; that symbol-ambiguity and the
 * message pipeline (borg_parse, observe_kill_move) are behaviorally load-bearing
 * and are completed by P8.6 (think ladder + borg_update). This foundation
 * establishes the data flow and the staleness model faithfully: it folds the
 * perceivable map, monsters, and floor objects into borg_grids / borg_kills /
 * borg_takes, marks grids MARK/VIEW/GLOW, tracks when-last-seen, and detects
 * level changes. Decision subsystems read BorgWorld, never the live engine.
 */

import type { AgentView } from "@neo-angband/core";
import { BORG_MARK, BORG_VIEW, BORG_GLOW } from "./world/grid";
import type { BorgWorld } from "./world/model";
import { makeLevelFacts } from "./world/model";

/** Track the depth we last perceived, to detect level changes. */
interface PerceiveMemo {
  lastDepth: number;
  initialized: boolean;
}

/** Create a fresh perception memo (one per Borg session). */
export function makePerceiveMemo(): PerceiveMemo {
  return { lastDepth: -1, initialized: false };
}

/**
 * Fold the current view into `world`. Call once at the start of each decision,
 * before the think ladder runs. Advances nothing on the game side (read-only).
 */
export function perceive(
  world: BorgWorld,
  view: AgentView,
  memo: PerceiveMemo,
): void {
  const p = view.player();

  // Level change: depth changed (or first sight) -> forget the old level.
  if (!memo.initialized || p.depth !== memo.lastDepth) {
    world.wipeLevel();
    memo.lastDepth = p.depth;
    memo.initialized = true;
  }

  // Self.
  world.self.c.x = p.grid.x;
  world.self.c.y = p.grid.y;
  world.facts.depth = p.depth;

  ingestMap(world, view);
  ingestMonsters(world, view);
  ingestFloor(world, view);

  world.seeded = true;
}

/** Fold visible/known cells into borg_grids, setting feat + info flags. */
function ingestMap(world: BorgWorld, view: AgentView): void {
  const bounds = view.mapBounds();
  const maxY = Math.min(bounds.height, world.map.height);
  const maxX = Math.min(bounds.width, world.map.width);

  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < maxX; x++) {
      const c = view.cell(x, y);
      if (!c) continue;
      // The Borg only records grids it has seen or remembers, mirroring the
      // known-map fog-of-war (borg_update_map skips unknown grids).
      if (!c.known && !c.inView) continue;

      const g = world.map.at(x, y);
      g.feat = c.feat;
      g.trap = c.trap;

      let info = g.info | BORG_MARK;
      if (c.inView) info |= BORG_VIEW;
      else info &= ~BORG_VIEW;
      if (c.glow) info |= BORG_GLOW;
      g.info = info;
    }
  }
}

/**
 * Rebuild the monster-tracking list from perceivable monsters. Monsters no
 * longer visible keep their record (with a stale `when`) until the expiry pass
 * (P8.6) removes them, matching the C borg's follow/forget behavior.
 */
function ingestMonsters(world: BorgWorld, view: AgentView): void {
  // Clear the grid.kill back-pointers; rebuilt below from live positions.
  for (const [, k] of world.kills.entries()) {
    if (world.map.inBounds(k.pos.x, k.pos.y)) {
      world.map.at(k.pos.x, k.pos.y).kill = 0;
    }
  }

  // Index existing records by game m_idx so we update in place (preserving the
  // Borg's accumulated belief) rather than churning slots.
  const byMidx = new Map<number, number>();
  for (const [i, k] of world.kills.entries()) {
    if (k.mIdx !== 0) byMidx.set(k.mIdx, i);
  }

  let uniques = 0;
  for (const m of view.monsters()) {
    if (!m.visible) continue;

    let idx = byMidx.get(m.id);
    if (idx === undefined) {
      idx = world.kills.alloc();
      byMidx.set(m.id, idx);
    }
    const k = world.kills.at(idx);
    k.mIdx = m.id;
    k.rIdx = m.raceIndex;
    k.known = true;
    k.ox = k.pos.x;
    k.oy = k.pos.y;
    k.pos.x = m.grid.x;
    k.pos.y = m.grid.y;
    k.awake = !m.asleep;
    k.afraid = m.afraid;
    k.confused = m.confused;
    k.stunned = m.stunned;
    k.speed = m.speed;
    k.power = m.hp;
    k.injury = m.maxHp > 0 ? Math.trunc(((m.maxHp - m.hp) * 100) / m.maxHp) : 0;
    k.level = m.level;
    k.seen = true;
    k.when = world.clock;

    if (world.map.inBounds(m.grid.x, m.grid.y)) {
      world.map.at(m.grid.x, m.grid.y).kill = idx;
    }
    // RF_UNIQUE detection is refined in P8.6; count raceFlags marker for now.
    if (m.raceFlags.includes("UNIQUE")) uniques += 1;
  }

  world.facts.uniqueOnLevel = uniques;
}

/**
 * Fold floor objects into the take-tracking list. Identity resolution to a real
 * k_idx and want/junk valuation happen in P8.5; here we record presence, tval,
 * and position so flow-to-item (P8.1) has targets.
 */
function ingestFloor(world: BorgWorld, view: AgentView): void {
  // Clear grid.take back-pointers; rebuilt below.
  for (const [, t] of world.takes.entries()) {
    if (world.map.inBounds(t.pos.x, t.pos.y)) {
      world.map.at(t.pos.x, t.pos.y).take = 0;
    }
  }
  world.takes.wipe();

  const bounds = view.mapBounds();
  const maxY = Math.min(bounds.height, world.map.height);
  const maxX = Math.min(bounds.width, world.map.width);

  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < maxX; x++) {
      const c = view.cell(x, y);
      if (!c || c.objectCount <= 0) continue;
      const items = view.floorItems(x, y);
      const head = items[0];
      if (!head) continue;

      const idx = world.takes.alloc();
      const t = world.takes.at(idx);
      // kIdx is a nonzero "present, unresolved" marker until P8.5 binds the
      // real object kind; tval carries the broad category for early filtering.
      t.kIdx = head.tval > 0 ? head.tval : 1;
      t.tval = head.tval;
      t.known = false;
      t.pos.x = x;
      t.pos.y = y;
      t.when = world.clock;
      if (world.map.inBounds(x, y)) world.map.at(x, y).take = idx;
    }
  }
}

/** Reset perception facts (used by tests / explicit level resets). */
export function resetFacts(world: BorgWorld): void {
  world.facts = makeLevelFacts();
}
