/**
 * thrust_away, ported from reference/src/project-mon.c L87 (Angband 4.2.6):
 * knock the player or a monster away from the source of a projection
 * (PROJ_FORCE), travelling up to gridsAway grids along the caster-to-target
 * angle (rejecting directions more than 44 degrees off), passing weaker
 * occupants by swapping places, entering but not leaving passable
 * non-projectable grids, and stopping at walls.
 *
 * The angle table is world/project.ts GET_ANGLE_TO_GRID (gen-util.c); the
 * direction order is DDGRID_DDD, and the RNG draw (randint0(8) per step)
 * matches upstream so a seeded run reproduces the path. The occupant
 * strength rules are exact: a monster cannot pass a monster with more mexp
 * or a character with lev*2 > its level; the player cannot pass a monster
 * with level > lev*2.
 *
 * player_handle_post_move (FOV refresh, traps at the landing grid) is the
 * injected onPlayerPostMove hook, fired as upstream does whenever a swap
 * leaves the player on the vacated grid or moves the player. The lava
 * message fires from square_isfiery; taking the fire damage itself is the
 * terrain-damage pass that runs on movement.
 */

import { SQUARE } from "../generated";
import { DDGRID_DDD, loc, locSum } from "../loc";
import type { Loc } from "../loc";
import { GET_ANGLE_TO_GRID } from "../world/project";
import { monsterSwap } from "./context";
import type { GameState } from "./context";

/** The seams thrust_away needs beyond the GameState. */
export interface ThrustEnv {
  msg?: (text: string) => void;
  /** player_handle_post_move(player, true, true) after the player moves. */
  onPlayerPostMove?: () => void;
}

/** monster_swap that also keeps the player's actor grid in step. */
function swapOccupants(state: GameState, g1: Loc, g2: Loc): void {
  const m1 = state.chunk.mon(g1);
  const m2 = state.chunk.mon(g2);
  monsterSwap(state, g1, g2);
  if (m1 < 0) state.actor.grid = g2;
  else if (m2 < 0) state.actor.grid = g1;
}

/**
 * The per-direction angle rejection (project-mon.c L110): each of the eight
 * DDD directions covers a 44-degree window of the (half-)angle table.
 */
function angleRejects(k: number, angle: number): boolean {
  switch (k) {
    case 0: /* 135 */
      return angle > 157 || angle < 114;
    case 1: /* 45 */
      return angle > 66 || angle < 23;
    case 2: /* 0 */
      return angle > 21 && angle < 159;
    case 3: /* 90 */
      return angle > 112 || angle < 68;
    case 4: /* 158 */
      return angle > 179 || angle < 136;
    case 5: /* 113 */
      return angle > 134 || angle < 91;
    case 6: /* 22 */
      return angle > 44 || angle < 1;
    case 7: /* 67 */
      return angle > 89 || angle < 46;
    default:
      return true;
  }
}

/**
 * thrust_away: force whatever occupies `target` away from `centre` for up to
 * `gridsAway` grids.
 */
export function thrustAway(
  state: GameState,
  centre: Loc,
  target: Loc,
  gridsAway: number,
  env: ThrustEnv = {},
): void {
  const c = state.chunk;

  /* Determine where target is in relation to caster, extend. */
  const rel = loc(target.x - centre.x + 20, target.y - centre.y + 20);
  /* The angle (/2) of the line from caster to target. */
  const angle = GET_ANGLE_TO_GRID[rel.y]?.[rel.x] ?? 0;

  /* Start at the target grid. */
  let grid = target;

  for (let i = 0; i < gridsAway; i++) {
    /* Randomize initial direction. */
    const firstD = state.rng.randint0(8);

    /* Look around (two possibilities for most angles). */
    for (let d = firstD; d < 8 + firstD; d++) {
      const k = d % 8;
      /* Reject angles more than 44 degrees from desired direction. */
      if (angleRejects(k, angle)) continue;

      /* Extract adjacent location */
      const next = locSum(grid, DDGRID_DDD[k]!);
      if (!c.inBounds(next)) continue;

      /* There's someone there, try to switch places. */
      if (c.mon(next) !== 0) {
        /* A monster is trying to pass. */
        if (c.mon(grid) > 0) {
          const mon = state.monsters[c.mon(grid)];
          if (c.mon(next) > 0) {
            const mon1 = state.monsters[c.mon(next)];
            /* Monsters cannot pass by stronger monsters. */
            if (mon && mon1 && mon1.race.mexp > mon.race.mexp) continue;
          } else {
            /* Monsters cannot pass by stronger characters. */
            if (mon && state.actor.player.lev * 2 > mon.race.level) continue;
          }
        }

        /* The player is trying to pass. */
        if (c.mon(grid) < 0 && c.mon(next) > 0) {
          const mon1 = state.monsters[c.mon(next)];
          /* Players cannot pass by stronger monsters. */
          if (mon1 && mon1.race.level > state.actor.player.lev * 2) continue;
        }
      }

      /* Check for obstruction. */
      if (!c.isProjectable(next)) {
        /* Some features allow entrance, but not exit. */
        if (c.isPassable(next)) {
          /* Travel down the path. */
          swapOccupants(state, grid, next);
          if (c.mon(grid) < 0) env.onPlayerPostMove?.();

          /* Jump to new location; we can't travel any more. */
          grid = next;
          i = gridsAway;
          break;
        } else if (d === 8 + firstD - 1) {
          /* If there are walls everywhere, stop here. */
          if (c.mon(grid) < 0) env.msg?.("You come to rest next to a wall.");
          i = gridsAway;
        }
      } else {
        /* Travel down the path. */
        swapOccupants(state, grid, next);
        if (c.mon(grid) < 0) env.onPlayerPostMove?.();

        /* Jump to new location. */
        grid = next;
        break;
      }
    }
  }

  /* Some special messages or effects for player or monster. */
  if (c.isFiery(grid) && c.mon(grid) < 0) {
    env.msg?.("You are thrown into molten lava!");
  }

  /* Clear the projection mark. */
  c.sqinfoOff(grid, SQUARE.PROJECT);
}
