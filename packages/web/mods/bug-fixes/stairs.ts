/**
 * "Always a reachable up and down staircase" (bugfix.stairsReachable) - the
 * bug-fixes mod's level repair, and the mod's own code. Core has no part of it.
 *
 * THE DEFECT. Upstream 4.2.6 makes no reachability promise and really does
 * strand floors: alloc_stairs (gen-util.c:629) picks any square_isempty grid and
 * does not exclude vault interiors, while ensure_connectedness runs with
 * allow_vault_disconnect = true at five of its six sites (gen-cave.c:1271, 2836,
 * 3083, 3693, 3953; only 3464 passes false), so a vault the tunneller never
 * joined can swallow a staircase. Measured on this port with the repair off: 53
 * stranded levels in 520 (10.2%), overwhelmingly the UP stair, because a level
 * gets 3-4 down stairs against only 1-2 up (gen-cave.c:958 -> rand_range(3,4) /
 * rand_range(1,2)), so a single bad roll strands the floor. 37 of the 53 had the
 * orphaned stair inside SQUARE_VAULT.
 *
 * WHY IT IS A MOD AND NOT A PORT FIX. It was briefly a core guarantee (owner
 * ruling 2026-07-25) and was withdrawn the next day once the owner learned the C
 * behaves this way: "We can't fix bugs in the port. Those will belong in the bug
 * fixes mod... Core must retain all warts of the reference code." core's
 * gen/gen.test.ts keeps a CONTROL test pinning the wart, so moving this back
 * into core fails the suite and says why.
 *
 * RNG-FREE, which the levelGenerated hook requires and this file must not break.
 * The repair takes no draws at all, so a level that already satisfies the
 * invariant - the overwhelming majority - is BIT-IDENTICAL to faithful core with
 * the patch on, and only the stranded minority is touched, by one grid. A single
 * draw here would shift every draw after it and a seed would stop reproducing
 * its dungeon. hooks.test.ts ratchets it.
 *
 * Levels with zero stairs of a direction are left alone, which is exactly what
 * exempts the town (place_stairs forces FEAT_MORE at depth 0) and the
 * quest/Morgoth floors (forced FEAT_LESS), with no depth special-casing.
 *
 * Everything it needs is core's PUBLIC API - the same primitives any third-party
 * level mod would reach for.
 */

import type { Chunk, Gen, Loc } from "@rpgm-tools/neo-angband-core";

/**
 * The engine primitives this fix needs, HANDED IN rather than imported.
 *
 * The mod's entry point receives the live core namespace as `ctx.core` and passes
 * it down. A folder-loaded plugin.js cannot resolve "@rpgm-tools/neo-angband-core", and even
 * where it could - a bundled build - importing it would risk a second copy of the
 * engine's registries and singletons. See src/mod-plugin.ts's header.
 *
 * Declared as a Pick of core's own module type, so it can never drift from what
 * core actually exports; `typeof import(...)` is type-only syntax and leaves no
 * trace in the built plugin.js.
 */
export type StairsCore = Pick<
  typeof import("@rpgm-tools/neo-angband-core"),
  | "FEAT"
  | "loc"
  | "placeStairs"
  | "squareIsEmpty"
  | "squareIsNoStairs"
  | "squareNumWallsAdjacent"
>;

/**
 * Terrain the player can eventually get through: passable grids, plus doors
 * (openable) and rubble (diggable). Walls are deliberately excluded - the
 * player can tunnel granite, but counting that as "reachable" would make the
 * guarantee vacuous.
 */
function stairWalkable(c: Chunk, grid: Loc): boolean {
  return c.isPassable(grid) || c.isDoor(grid) || c.isRubble(grid);
}

/**
 * ddgrid_ddd order: S, N, E, W, SE, SW, NE, NW.
 *
 * A function rather than a module constant because `loc` now arrives with the
 * engine, and a module-scope constant would have to run before the host had handed
 * anything over. Called once per repair, which is eight object literals against a
 * flood fill.
 */
function stairDirs(core: StairsCore): readonly Loc[] {
  const { loc } = core;
  return [
    loc(0, 1),
    loc(0, -1),
    loc(1, 0),
    loc(-1, 0),
    loc(1, 1),
    loc(-1, 1),
    loc(1, -1),
    loc(-1, -1),
  ];
}

/** Flood the region the player can walk from `start`, 8-directionally. */
function walkableRegion(c: Chunk, start: Loc, core: StairsCore): Uint8Array {
  const { loc } = core;
  const dirs = stairDirs(core);
  const seen = new Uint8Array(c.width * c.height);
  const stack: Loc[] = [start];
  seen[start.y * c.width + start.x] = 1;
  while (stack.length > 0) {
    const cur = stack.pop() as Loc;
    for (const dir of dirs) {
      const n = loc(cur.x + dir.x, cur.y + dir.y);
      if (!c.inBounds(n)) continue;
      const idx = n.y * c.width + n.x;
      if (seen[idx] || !stairWalkable(c, n)) continue;
      seen[idx] = 1;
      stack.push(n);
    }
  }
  return seen;
}

/**
 * Pick the grid for a replacement staircase: inside the walkable region, legal
 * for a stair by alloc_stairs' own rules, and as close as possible to the
 * stranded stair it stands in for (so it surfaces just outside the vault that
 * swallowed the original rather than in some unrelated corner).
 *
 * Deterministic - no RNG draws. Walls are tried 3 -> 0 exactly as alloc_stairs
 * does, so the replacement sits in a corner or alcove like any other stair.
 */
function findReachableStairSpot(
  g: Gen,
  seen: Uint8Array,
  near: Loc,
  core: StairsCore,
): Loc | null {
  const { loc, squareIsEmpty, squareIsNoStairs, squareNumWallsAdjacent } = core;
  const c = g.c;
  const player = g.playerSpot;
  for (let walls = 3; walls >= 0; walls--) {
    let best: Loc | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let y = 1; y <= c.height - 2; y++) {
      for (let x = 1; x <= c.width - 2; x++) {
        if (!seen[y * c.width + x]) continue;
        const grid = loc(x, y);
        if (player && grid.x === player.x && grid.y === player.y) continue;
        if (!squareIsEmpty(g, grid)) continue;
        if (squareIsNoStairs(c, grid)) continue;
        if (squareNumWallsAdjacent(c, grid) !== walls) continue;
        const dy = y - near.y;
        const dx = x - near.x;
        const dist = dy * dy + dx * dx;
        if (dist < bestDist) {
          bestDist = dist;
          best = grid;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Ensure the player can reach a staircase in each direction the level actually
 * has one. Returns false when the level cannot be repaired, which makes
 * cave_generate reject and re-roll it (the same treatment it gives a level that
 * overflows the monster maximum).
 *
 * This is the levelGenerated hook's body; it is exported so the mod's own tests
 * can drive it on a synthetic level as well as through a real generation.
 */
export function ensureStairsReachable(
  g: Gen,
  quest: boolean,
  core: StairsCore,
): boolean {
  const { FEAT, loc, placeStairs, squareIsEmpty, squareIsNoStairs } = core;
  const c = g.c;
  const start = g.playerSpot;
  /* Sub-chunks (gauntlet's halves, the hard centre's caverns) have no player
   * spot; they are checked once assembled, not in pieces. */
  if (!start) return true;
  if (!stairWalkable(c, start)) return false;

  const seen = walkableRegion(c, start, core);

  for (const feat of [FEAT.MORE, FEAT.LESS]) {
    let total = 0;
    let reached = 0;
    let stranded: Loc | null = null;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const grid = loc(x, y);
        if (c.feat(grid) !== feat) continue;
        total++;
        if (seen[y * c.width + x]) reached++;
        else if (!stranded) stranded = grid;
      }
    }
    /* No stairs of this kind by design (town has no up, Morgoth no down):
     * nothing to guarantee. One already reachable: nothing to do. */
    if (total === 0 || reached > 0) continue;

    let spot = findReachableStairSpot(g, seen, stranded ?? start, core);
    if (!spot && squareIsEmpty(g, start) && !squareIsNoStairs(c, start)) {
      /*
       * Last resort: the player's own grid. Upstream already lays a stair there
       * under birth_connect_stairs (gen-util.c:427-433, new_player_spot), so a
       * staircase underfoot is a legal arrival state rather than a hack. This
       * only fires when the walkable region holds nothing else a stair can go
       * on - measured once in ~230 levels, and it saves that level from a full
       * re-roll, which would perturb it far more than one grid does.
       */
      spot = start;
    }
    if (!spot) return false;
    /* place_stairs, not setFeat: it applies the town / max-depth / quest
     * overrides, so this can never mint a down stair on a Morgoth floor. */
    placeStairs(g, spot, quest, feat);
    if (c.feat(spot) !== feat) return false;
  }
  return true;
}
