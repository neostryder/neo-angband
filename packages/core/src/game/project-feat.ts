/**
 * Projection effects on terrain, ported from reference/src/project-feat.c
 * (Angband 4.2.6): the project_f driver and the feature handlers - grid
 * lighting (LIGHT/LIGHT_WEAK, DARK/DARK_WEAK), stone-to-mud (KILL_WALL with
 * rubble finds and gold-vein payouts), door destruction (KILL_DOOR), trap
 * disabling / door unlocking / secret-door reveal (KILL_TRAP), door and trap
 * creation (MAKE_DOOR, MAKE_TRAP), fire clearing webs and very hot or cold
 * projections converting floor to lava and lava to floor/rubble, plus the
 * observe-only elemental handlers.
 *
 * expose_to_sun / is_daytime are ported (exposeToSun below): the KILL_WALL,
 * KILL_DOOR, FIRE and COLD/ICE handlers re-expose freshly changed surface
 * terrain to the sun, guarded on cave->depth == 0. That guard never fires yet
 * (the port has no surface/town), so the branch is dormant but faithful.
 *
 * DEFERRED (ledgered in parity/ledger/game-project-feat.yaml):
 * - square_forget / square_unmark and the PU_UPDATE_VIEW | PU_MONSTERS
 *   redraw requests: the core keeps no player square-memory yet (the web
 *   renderer holds its own explored set); FOV refresh rides the state
 *   updateFov hook the loop already runs after player actions.
 * - square_isbright's daytime interplay for DARK on the surface.
 * - The decoy branch of trap handling (decoys ride mon-desire, #24).
 */

import type { Loc } from "../loc";
import { FEAT, ORIGIN, PROJ, SQUARE, TMD } from "../generated";
import { squareIsSeen, squareIsView } from "../world/view";
import { featIsBright, featIsTreasure } from "../world/chunk";
import { lookupTrap } from "../world/trap";
import { isDaytime } from "./world";
import type { GameState } from "./context";
import { squareIsEmpty, squareIsPlayer, squareMonster } from "./context";
import { dropNear, floorExcise, floorPile, floorCarry } from "./floor";
import type { MakeDeps } from "../obj/make";
import { squareIsSecretDoor } from "./cave-cmd";
import {
  placeTrap,
  squareDoorPower,
  squareIsTrap,
  squareIsVisibleTrap,
  squareRemoveAllTraps,
  squareRevealTrap,
  squareTrap,
} from "./trap";
import type { TrapDeps } from "./trap";
import { makeObject, makeGold } from "../obj/make";
import type { ProjectWorldEnv } from "./project-obj";

/** The seams the terrain handlers need beyond the GameState. */
export interface ProjectFeatEnv extends ProjectWorldEnv {
  /** Object generation for rubble finds and gold-vein payouts. */
  makeDeps?: MakeDeps;
  /** Trap system access for MAKE_TRAP / KILL_TRAP / webs / door locks. */
  trapDeps?: TrapDeps;
}

/** Is the grid in view and the player able to see (not blind)? */
function observed(state: GameState, grid: Loc): boolean {
  return (
    squareIsView(state.chunk, grid) &&
    (state.actor.player.timed[TMD.BLIND] ?? 0) === 0
  );
}

/**
 * push_object (obj-pile.c): move the pile off a grid that stopped holding
 * objects. As upstream, the grid temporarily becomes an open door so
 * drop_near cannot land anything back on it; the caller's feature change
 * happens after.
 */
export function pushObject(state: GameState, grid: Loc): void {
  const c = state.chunk;
  const featOld = c.feat(grid);
  c.setFeat(grid, FEAT.OPEN);
  for (const obj of [...floorPile(state, grid)]) {
    floorExcise(state, grid, obj);
    dropNear(state, obj, 0, grid, false);
  }
  c.setFeat(grid, featOld);
}

/**
 * expose_to_sun (cave-map.c L621): on the surface, freshly revealed terrain
 * either lights up (daytime, or a non-floor grid) or goes dark (night floor
 * that is not intrinsically bright). Only ever called on the surface
 * (cave->depth == 0), which the port cannot reach yet, so this is dormant.
 */
function exposeToSun(state: GameState, grid: Loc, daytime: boolean): void {
  const c = state.chunk;
  if (daytime || !c.isFloor(grid)) {
    c.sqinfoOn(grid, SQUARE.GLOW);
  } else if (!featIsBright(c.features, c.feat(grid))) {
    c.sqinfoOff(grid, SQUARE.GLOW);
  }
}

/** square_disable_trap: every player trap at the grid seizes up a while. */
function disableTraps(state: GameState, grid: Loc): void {
  for (const t of squareTrap(state, grid)) {
    t.timeout = 10;
  }
}

/**
 * project_f: affect the terrain at `grid` (PROJECT_GRID). Returns whether
 * anything the player can see happened.
 */
export function projectFeature(
  state: GameState,
  _r: number,
  grid: Loc,
  dam: number,
  typ: number,
  env: ProjectFeatEnv = {},
): boolean {
  const c = state.chunk;
  let obvious = false;

  switch (typ) {
    case PROJ.LIGHT_WEAK:
    case PROJ.LIGHT: {
      /* Turn on the light. */
      c.sqinfoOn(grid, SQUARE.GLOW);
      if (squareIsView(c, grid)) {
        if ((state.actor.player.timed[TMD.BLIND] ?? 0) === 0) obvious = true;
        state.updateFov?.(state);
      }
      break;
    }

    case PROJ.DARK_WEAK:
    case PROJ.DARK: {
      /* Turn off the light (no surface daytime yet: depth > 0 always). */
      c.sqinfoOff(grid, SQUARE.GLOW);
      if (squareIsView(c, grid)) {
        obvious = true;
        state.updateFov?.(state);
      }
      break;
    }

    case PROJ.KILL_WALL: {
      /* Non-walls (etc). */
      if (c.isPassable(grid) && !c.isRubble(grid)) break;
      /* Permanent walls. */
      if (c.isPerm(grid)) break;

      const seen = squareIsSeen(c, grid);
      if (c.isRubble(grid)) {
        if (seen) {
          env.msg?.("The rubble turns into mud!");
          obvious = true;
        }
        c.setFeat(grid, FEAT.FLOOR);
        /* Hidden find: 10% chance of a buried object. */
        if (state.rng.randint0(100) < 10 && env.makeDeps) {
          const found = makeObject(
            state.rng,
            env.makeDeps,
            c.depth,
            false,
            false,
            false,
            0,
            c.depth,
          );
          if (found) {
            found.origin = ORIGIN.RUBBLE;
            found.originDepth = c.depth;
            floorCarry(state, grid, found);
            if (seen) {
              env.msg?.("There was something buried in the rubble!");
              obvious = true;
            }
          }
        }
      } else if (c.isDoor(grid)) {
        if (seen) {
          env.msg?.("The door turns into mud!");
          obvious = true;
        }
        c.setFeat(grid, FEAT.FLOOR);
      } else if (featIsTreasure(c.features, c.feat(grid))) {
        if (seen) {
          env.msg?.("The vein turns into mud!");
          env.msg?.("You have found something!");
          obvious = true;
        }
        c.setFeat(grid, FEAT.FLOOR);
        /* Place some gold. */
        if (env.makeDeps) {
          const money = makeGold(state.rng, env.makeDeps, c.depth, "any");
          money.origin = ORIGIN.FLOOR;
          money.originDepth = c.depth;
          floorCarry(state, grid, money);
        }
      } else if (c.isMagma(grid) || c.isQuartz(grid)) {
        if (seen) {
          env.msg?.("The vein turns into mud!");
          obvious = true;
        }
        c.setFeat(grid, FEAT.FLOOR);
      } else if (c.isGranite(grid)) {
        if (seen) {
          env.msg?.("The wall turns into mud!");
          obvious = true;
        }
        c.setFeat(grid, FEAT.FLOOR);
      }
      /* On the surface, new terrain may be exposed to the sun. */
      if (c.depth === 0) exposeToSun(state, grid, isDaytime(state.turn, state.z.dayLength));
      state.updateFov?.(state);
      break;
    }

    case PROJ.KILL_DOOR: {
      if (c.isDoor(grid)) {
        if (squareIsView(c, grid)) {
          env.msg?.("There is a bright flash of light!");
          obvious = true;
        }
        c.setFeat(grid, FEAT.FLOOR);
        /* On the surface, new terrain may be exposed to the sun. */
        if (c.depth === 0) exposeToSun(state, grid, isDaytime(state.turn, state.z.dayLength));
        state.updateFov?.(state);
      }
      break;
    }

    case PROJ.KILL_TRAP: {
      /* Reveal secret doors. */
      if (squareIsSecretDoor(state, grid)) {
        c.setFeat(grid, FEAT.CLOSED);
        if (squareIsSeen(c, grid)) obvious = true;
      }
      /* Disable traps, unlock doors. */
      if (squareIsVisibleTrap(state, grid)) {
        if (squareIsSeen(c, grid)) {
          env.msg?.("The trap seizes up.");
          obvious = true;
        }
        disableTraps(state, grid);
      } else if (env.trapDeps && squareDoorPower(state, grid, env.trapDeps) > 0) {
        const lock = lookupTrap(env.trapDeps.kinds, "door lock");
        if (lock) squareRemoveAllTraps(state, grid, lock.tidx);
        if (squareIsView(c, grid)) {
          env.msg?.("Click!");
          obvious = true;
        }
      }
      break;
    }

    case PROJ.MAKE_DOOR: {
      /* Require a floor grid without monsters or the player. */
      if (squareMonster(state, grid) || squareIsPlayer(state, grid)) break;
      if (!c.isFloor(grid)) break;
      /* Push objects off the grid, then create a closed door. */
      pushObject(state, grid);
      c.setFeat(grid, FEAT.CLOSED);
      if (squareIsSeen(c, grid)) obvious = true;
      state.updateFov?.(state);
      break;
    }

    case PROJ.MAKE_TRAP: {
      /* Require an empty floor grid with no existing traps. */
      if (!squareIsEmpty(state, grid)) break;
      if (squareIsTrap(state, grid)) break;
      if (state.rng.oneIn(4) && env.trapDeps) {
        placeTrap(state, grid, -1, c.depth, env.trapDeps);
        squareRevealTrap(state, grid, false, env.trapDeps);
      }
      obvious = true;
      break;
    }

    case PROJ.FIRE:
    case PROJ.PLASMA: {
      if (observed(state, grid)) obvious = true;
      /* Fire removes webs. */
      if (typ === PROJ.FIRE && env.trapDeps) {
        const web = lookupTrap(env.trapDeps.kinds, "web");
        if (web) squareRemoveAllTraps(state, grid, web.tidx);
      }
      /* Can create lava if extremely powerful. */
      if (dam > state.rng.randint1(1800) + 600 && c.isFloor(grid)) {
        c.setFeat(grid, FEAT.LAVA);
        if (c.depth === 0) exposeToSun(state, grid, isDaytime(state.turn, state.z.dayLength));
        pushObject(state, grid);
      }
      break;
    }

    case PROJ.COLD:
    case PROJ.ICE: {
      if (observed(state, grid)) obvious = true;
      /* Sufficiently intense cold can solidify lava. */
      if (dam > state.rng.randint1(900) + 300 && c.isFiery(grid)) {
        const occupied =
          squareMonster(state, grid) !== null || squareIsPlayer(state, grid);
        if (state.rng.oneIn(2)) {
          c.setFeat(grid, FEAT.FLOOR);
        } else if (state.rng.oneIn(2) && !occupied) {
          c.setFeat(grid, FEAT.RUBBLE);
        } else {
          c.setFeat(grid, FEAT.PASS_RUBBLE);
        }
        if (c.depth === 0) exposeToSun(state, grid, isDaytime(state.turn, state.z.dayLength));
      }
      break;
    }

    /* The monster-directed projections have empty feature handlers upstream:
     * they never touch terrain and never set obvious (project-feat.c:581-675),
     * so the player observes nothing from them at the grid level. */
    case PROJ.AWAY_UNDEAD:
    case PROJ.AWAY_EVIL:
    case PROJ.AWAY_SPIRIT:
    case PROJ.AWAY_ALL:
    case PROJ.TURN_UNDEAD:
    case PROJ.TURN_EVIL:
    case PROJ.TURN_LIVING:
    case PROJ.TURN_ALL:
    case PROJ.DISP_UNDEAD:
    case PROJ.DISP_EVIL:
    case PROJ.DISP_ALL:
    case PROJ.SLEEP_UNDEAD:
    case PROJ.SLEEP_EVIL:
    case PROJ.SLEEP_ALL:
    case PROJ.MON_CLONE:
    case PROJ.MON_POLY:
    case PROJ.MON_HEAL:
    case PROJ.MON_SPEED:
    case PROJ.MON_SLOW:
    case PROJ.MON_CONF:
    case PROJ.MON_HOLD:
    case PROJ.MON_STUN:
    case PROJ.MON_DRAIN:
    case PROJ.MON_CRUSH:
      break;

    /* The remaining (damage / elemental) projections only give the player a
     * chance to observe. */
    default: {
      if (observed(state, grid)) obvious = true;
      break;
    }
  }

  return obvious;
}
