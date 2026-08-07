/**
 * Monster polymorph, ported from reference/src/project-mon.c: the static
 * `poly_race` helper (L45) and the delete-then-place swap its one caller
 * performs (L1216-1229).
 *
 * These live here rather than in project-monster.ts because the swap needs the
 * live allocation table and placeNewMonster, which the projection driver is
 * deliberately kept free of - it reaches them through ProjectMonsterHooks. The
 * driver owns the saving throw, the unique / arena gate and the message order;
 * this module owns "which race" and "make the swap happen".
 */

import { RF } from "../generated/index.js";
import { ORIGIN } from "../generated/index.js";
import type { MonsterRace } from "../mon/types.js";
import type { Monster } from "../mon/monster.js";
import type { GameState } from "./context.js";
import { deleteMonster } from "./context.js";
import { placeNewMonster } from "./mon-place.js";
import type { MonPlaceDeps } from "./mon-place.js";

/**
 * poly_race (project-mon.c L45): pick a "nearby" race to polymorph into.
 *
 * Upstream calls this one of the more dangerous functions in the game, and the
 * numbers are the reason - the goal level is the midpoint of the current depth
 * and the monster's own level plus five, so a deep monster in a shallow dungeon
 * stays roughly as dangerous as it was.
 *
 * Returns the ORIGINAL race when no legal replacement turned up in a thousand
 * tries (L79), which is upstream's signal for "nothing changed".
 */
export function polyRace(
  state: GameState,
  race: MonsterRace,
  currentLevel: number,
  deps: MonPlaceDeps,
): MonsterRace {
  /* Uniques never polymorph (L54). */
  if (race.flags.has(RF.UNIQUE)) return race;

  /* Allowable range of "levels" for the resulting monster (L57-59). */
  const goal = Math.trunc((currentLevel + race.level) / 2) + 5;
  const minlvl = Math.min(race.level - 10, Math.trunc((race.level * 3) / 4));
  let maxlvl = Math.max(race.level + 10, Math.trunc((race.level * 5) / 4));

  /* Small chance to allow something really strong (L62). */
  if (state.rng.oneIn(100)) maxlvl = 100;

  /* Try to pick a new, non-unique race within our level range (L65-77). */
  for (let i = 0; i < 1000; i++) {
    const next = deps.table.getMonNum(state.rng, goal, currentLevel);
    if (!next || next === race) continue;
    if (next.flags.has(RF.UNIQUE)) continue;
    if (next.level < minlvl || next.level > maxlvl) continue;
    /* "Avoid force-depth monsters, since it might cause a crash in
     * project_m()" (L74-75).
     *
     * UNREACHABLE ON STOCK DATA, and measured rather than assumed: all five
     * RF_FORCE_DEPTH races in monster.txt (Sauron, his three shapes, and
     * Morgoth) also carry RF_UNIQUE, and the unique filter above returns first.
     * Kept because upstream keeps it and because a mod's race need not be
     * unique - so a mutation that deletes this line survives the test suite,
     * on purpose. */
    if (next.flags.has(RF.FORCE_DEPTH) && currentLevel < next.level) continue;
    return next;
  }

  /* No new race found (L79-80). */
  return race;
}

/**
 * The swap half of project-mon.c L1225-1229: delete the old monster and place
 * the new race on the same grid with ORIGIN_DROP_POLY, then hand back whatever
 * now stands there.
 *
 * Returns null when placement failed, which is upstream's
 * `context->mon = square_monster(cave, grid)` reading NULL - the old monster is
 * already gone by then either way, so the caller must not keep using it.
 */
export function polymorphMonster(
  state: GameState,
  mon: Monster,
  race: MonsterRace,
  deps: MonPlaceDeps,
): Monster | null {
  const grid = mon.grid;

  /* Upstream passes a zeroed monster_group_info (L1220), so the new monster
   * starts its own group rather than joining the old one's. */
  deleteMonster(state, mon.midx);
  placeNewMonster(
    state,
    grid,
    race,
    false,
    false,
    { index: 0, role: 0 },
    deps,
    ORIGIN.DROP_POLY,
  );

  /* square_monster(cave, grid) (L1229). */
  const midx = state.chunk.mon(grid);
  return midx > 0 ? (state.monsters[midx] ?? null) : null;
}
