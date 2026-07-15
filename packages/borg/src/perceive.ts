/**
 * Perception: fold what the Borg can see (the frozen AgentView) into its own
 * world model (BorgWorld). This is the port of borg_update / borg_update_map
 * (reference/src/borg/borg-update.c) adapted from the C borg's screen-scrape to
 * our clean perceive facade.
 *
 * FIDELITY MODEL. The C borg re-derives monster/object identity from on-screen
 * symbols (observe_kill_move / borg_locate_kill) because it only sees glyphs;
 * the frozen AgentView instead hands the port exact monster ids and per-cell
 * visibility, so the symbol-correlation guessing is unnecessary and the port
 * updates records in place by m_idx. What IS behaviorally load-bearing - and is
 * ported faithfully here - is:
 *   - the known-map fog-of-war (only seen/remembered grids are recorded),
 *   - the staleness model: records persist after leaving view and expire on the
 *     2000-borg-turn clock (borg-update.c:1553 / :1591),
 *   - deletion of floor objects under the borg and while hallucinating
 *     (borg-update.c:1583),
 *   - message consumption (deaths / blinks) pruning tracked monsters
 *     (borg-update.c:2785, via perceive-messages.ts).
 * The per-level facts (unique/scary/morgoth/summoner) are derived by
 * borg_near_monster_type (perceive-facts.ts), which the think ladder invokes at
 * the faithful point (borg-think-dungeon.c:1268).
 *
 * Decision subsystems read BorgWorld, never the live engine.
 */

import type { AgentView } from "@neo-angband/core";
import { BORG_MARK, BORG_VIEW, BORG_GLOW } from "./world/grid";
import type { BorgWorld } from "./world/model";
import { makeLevelFacts } from "./world/model";
import { borgReactMessages } from "./perceive-messages";

/** borg_update expires a tracked record after this many borg-turns unseen. */
export const BORG_EXPIRE_TURNS = 2000;

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

  /* Old position, for the "delete objects I just stepped off" rule. */
  const oldX = world.self.c.x;
  const oldY = world.self.c.y;

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
  const visibleIds = ingestMonsters(world, view);
  ingestFloor(world, view, oldX, oldY);

  // Consume the message stream (drains view.messages() exactly once). The C
  // also force-deletes all records while hallucinating (borg-update.c:1557);
  // PlayerView exposes no hallucination flag, so that branch is omitted (the
  // borg simply trusts the exact-id view it is given).
  borgReactMessages(world, view.messages(), visibleIds);

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
 * Rebuild the monster-tracking list from perceivable monsters, updating records
 * in place by m_idx (belief accumulation). Records for monsters no longer
 * visible are preserved and expire on the 2000-turn clock, matching the C borg's
 * follow / forget behavior (borg-update.c:1541-1567).
 *
 * Returns the set of game m_idx values visible this tick (for message pruning).
 */
function ingestMonsters(world: BorgWorld, view: AgentView): Set<number> {
  // Clear the grid.kill back-pointers; rebuilt below from live positions.
  for (const [, k] of world.kills.entries()) {
    if (world.map.inBounds(k.pos.x, k.pos.y)) {
      world.map.at(k.pos.x, k.pos.y).kill = 0;
    }
    // Clear per-tick flags (borg-update.c:1549).
    k.seen = false;
    k.used = false;
  }

  // Index existing records by game m_idx so we update in place (preserving the
  // Borg's accumulated belief) rather than churning slots.
  const byMidx = new Map<number, number>();
  for (const [i, k] of world.kills.entries()) {
    if (k.mIdx !== 0) byMidx.set(k.mIdx, i);
  }

  const visibleIds = new Set<number>();
  for (const m of view.monsters()) {
    if (!m.visible) continue;
    visibleIds.add(m.id);

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
  }

  // Expiry pass: forget records unseen for >= 2000 borg-turns
  // (borg-update.c:1553). Visible records were just refreshed (when == clock).
  for (const [i, k] of world.kills.entries()) {
    if (world.clock - k.when < BORG_EXPIRE_TURNS) continue;
    world.kills.delete(i);
  }

  return visibleIds;
}

/**
 * Fold floor objects into the take-tracking list, updating in place by position
 * so unseen objects persist and expire on the 2000-turn clock, and deleting
 * objects under the borg (or its previous grid) as the C does
 * (borg-update.c:1569-1601). Identity resolution to a real k_idx and want/junk
 * valuation happen in the item subsystem (P8.5); here we record presence, tval,
 * and position so flow-to-item (P8.1) has targets.
 */
function ingestFloor(
  world: BorgWorld,
  view: AgentView,
  oldX: number,
  oldY: number,
): void {
  // Clear grid.take back-pointers; rebuilt below.
  for (const [, t] of world.takes.entries()) {
    if (world.map.inBounds(t.pos.x, t.pos.y)) {
      world.map.at(t.pos.x, t.pos.y).take = 0;
    }
  }

  // Index existing records by position for in-place update.
  const byPos = new Map<string, number>();
  for (const [i, t] of world.takes.entries()) {
    byPos.set(`${t.pos.x},${t.pos.y}`, i);
  }

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

      const key = `${x},${y}`;
      let idx = byPos.get(key);
      if (idx === undefined) {
        idx = world.takes.alloc();
        byPos.set(key, idx);
      }
      const t = world.takes.at(idx);
      // kIdx is a nonzero "present, unresolved" marker until the item subsystem
      // binds the real object kind; tval carries the broad category.
      t.kIdx = head.tval > 0 ? head.tval : 1;
      t.tval = head.tval;
      t.known = false;
      t.pos.x = x;
      t.pos.y = y;
      t.when = world.clock;
    }
  }

  // Delete objects under the borg / its old grid, then expire stale ones
  // (borg-update.c:1583-1600), then rebuild the surviving back-pointers.
  for (const [i, t] of world.takes.entries()) {
    const underMe =
      (t.pos.x === world.self.c.x && t.pos.y === world.self.c.y) ||
      (t.pos.x === oldX && t.pos.y === oldY);
    if (underMe) {
      world.takes.delete(i);
      continue;
    }
    if (world.clock - t.when >= BORG_EXPIRE_TURNS) {
      world.takes.delete(i);
      continue;
    }
    if (world.map.inBounds(t.pos.x, t.pos.y)) {
      world.map.at(t.pos.x, t.pos.y).take = i;
    }
  }
}

/** Reset perception facts (used by tests / explicit level resets). */
export function resetFacts(world: BorgWorld): void {
  world.facts = makeLevelFacts();
}
