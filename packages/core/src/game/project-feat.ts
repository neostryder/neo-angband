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
 * NOTES (ledgered in parity/ledger/game-project-feat.yaml):
 * - square_forget / square_unmark and the PU_UPDATE_VIEW | PU_MONSTERS
 *   redraw requests: the core keeps no player square-memory yet (the web
 *   renderer holds its own explored set); FOV refresh rides the state
 *   updateFov hook the loop already runs after player actions.
 * - The decoy branch of trap handling (decoys ride mon-desire, #24).
 */

import type { Loc } from "../loc.js";
import { FEAT, ORIGIN, PROJ, SQUARE, TMD } from "../generated/index.js";
import { squareIsSeen, squareIsView } from "../world/view.js";
import { featIsBright, featIsTreasure } from "../world/chunk.js";
import { lookupTrap } from "../world/trap.js";
import { isDaytime } from "./world.js";
import type { GameState } from "./context.js";
import { squareIsEmptyLive } from "./mon-place.js";
import { deleteMonster, monsterSwap, squareIsPlayer, squareMonster } from "./context.js";
import { dropNear, floorExcise, floorPile, floorCarry } from "./floor.js";
import { scatterExt } from "../world/scatter.js";
import type { GameObject } from "../obj/object.js";
import type { MakeDeps } from "../obj/make.js";
import { squareIsSecretDoor } from "./cave-cmd.js";
import {
  placeTrap,
  squareDoorPower,
  squareIsDisarmableTrap,
  squareIsTrap,
  squareRemoveAllTraps,
  squareRevealTrap,
  squareSetDoorLock,
  squareIsPlayerTrap,
  squareSetTrapTimeout,
  } from "./trap.js";
import type { TrapDeps } from "./trap.js";
import { makeObject, makeGold } from "../obj/make.js";
import type { ProjectWorldEnv } from "./project-obj.js";
import { projectionCodeFor } from "../world/projection.js";

/** The seams the terrain handlers need beyond the GameState. */
export interface ProjectFeatEnv extends ProjectWorldEnv {
  /** Object generation for rubble finds and gold-vein payouts. */
  makeDeps?: MakeDeps;
  /** Trap system access for MAKE_TRAP / KILL_TRAP / webs / door locks. */
  trapDeps?: TrapDeps;
  /**
   * The handler table to dispatch through, defaulting to
   * PROJECT_FEAT_HANDLERS.
   *
   * SUPPLIED BY wireGame, by identity, from `GameState.projectionHandlers`
   * (game/projection-handlers.ts) - so a mod that installs a handler through
   * `registry:projection` after the game is wired is dispatched to on the next
   * projection. Composition is per CODE, in that registry: a whole table handed
   * over here cannot compose, because the second mod to do it would discard the
   * first. Absent only in the harnesses and the direct-call tests, which get
   * core's compiled-in table.
   */
  featHandlers?: ReadonlyMap<string, ProjectFeatHandler>;
}

/** What a terrain handler is handed. Fields mirror project_f's parameters. */
export interface ProjectFeatCtx {
  readonly state: GameState;
  /** The grid being affected. */
  readonly grid: Loc;
  /** Damage, which several handlers roll against. */
  readonly dam: number;
  /** The PROJ_ value, for the handlers core shares between two codes. */
  readonly typ: number;
  readonly env: ProjectFeatEnv;
}

/**
 * One projection's effect on terrain: upstream's project_f handler bodies,
 * one function per switch arm. Returns `obvious` - whether the player saw
 * something happen - which is project_f's return value for that arm.
 */
export type ProjectFeatHandler = (ctx: ProjectFeatCtx) => boolean;

/** Is the grid in view and the player able to see (not blind)? */
function observed(state: GameState, grid: Loc): boolean {
  return (
    squareIsView(state.chunk, grid) &&
    (state.actor.player.timed[TMD.BLIND] ?? 0) === 0
  );
}

/**
 * push_object's unrevealed-mimic arm (obj-pile.c:1213-1256).
 *
 * An object with a mimicking monster behind it may not simply be dropped: the
 * monster IS the object as far as the player can tell, so upstream keeps the
 * pair together. It scatters outward from d=1 looking for an empty grid that
 * will take the object, then MOVES THE MONSTER onto it with monster_swap and
 * re-links the two. At d >= 4 it gives up and destroys both rather than let
 * them part.
 *
 * The C resets mimicked_obj to NULL up front because its queued object is a
 * COPY and the pointer it holds has just been freed. The port has no copy -
 * the same GameObject is excised and re-placed - so nothing dangles here. The
 * clear is kept anyway, because monster_swap reads the link three times and
 * one of those readings is observable:
 *
 * - become_aware and move_mimicked_object both resolve the object through the
 *   monster's OLD grid, which push_object has already emptied, so neither can
 *   tell whether the link is up. (In the C they read the pointer directly and
 *   still cannot: it is NULL there for the same stretch.)
 * - update_mon can. A monster still mimicking a non-ignored item KEEPS
 *   MFLAG_VISIBLE when it drops out of sight (mon-util.c L429-433), because
 *   what the player is looking at is the item. Leave the link up and the mimic
 *   stays marked visible in transit, where upstream clears the mark.
 *
 * game/push-object.test.ts pins that third case; without the clear it fails.
 */
function pushMimic(state: GameState, grid: Loc, obj: GameObject): void {
  const midx = obj.mimickingMIdx;
  const mimic = state.monsters[midx];
  /* Upstream asserts the monster exists. A live game cannot reach this with a
   * dangling index, but a mod or a hand-built save could; dropping the stale
   * link and treating it as an ordinary object beats aborting the turn. */
  if (!mimic) {
    obj.mimickingMIdx = 0;
    dropNear(state, obj, 0, grid, false, false);
    return;
  }

  mimic.mimickedObj = 0;

  for (let d = 1; ; d++) {
    if (d >= 4) {
      /* Give up: destroy both the mimic and the object. The object is already
       * excised, so letting the reference go IS object_delete - and the
       * player's memory of it, which upstream deletes alongside, is dropped by
       * forget_remembered_objects the next time this grid is known (its
       * original is no longer held here). */
      deleteMonster(state, midx);
      obj.mimickingMIdx = 0;
      return;
    }
    const [newgrid] = scatterExt(state.chunk, state.rng, 1, grid, d, true, (_c, g) =>
      squareIsEmptyLive(state, g),
    );
    if (newgrid && floorCarry(state, newgrid, obj)) {
      /* Move the monster and give it the object back. */
      monsterSwap(state, grid, newgrid);
      mimic.mimickedObj = 1;
      return;
    }
  }
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
  /* square_force_floor (cave-square.c:1507) then square_add_door(closed=false)
   * (cave-square.c:1347) - obj-pile.c:1204-1205 - collapse to one setFeat(OPEN):
   * the intermediate FEAT_FLOOR is transient and its featCount delta cancels. */
  c.setFeat(grid, FEAT.OPEN);
  /* square_excise_pile (cave-square.c:1031) + square_set_obj(c, grid, NULL)
   * (cave-square.c:1291, obj-pile.c:1201): the port's pile is a Map entry, so
   * excising every member removes the entry - there is no head pointer to null. */
  for (const obj of [...floorPile(state, grid)]) {
    floorExcise(state, grid, obj);
    /* "Unrevealed mimics require special handling, as always" (:1211). */
    if (obj.mimickingMIdx) pushMimic(state, grid, obj);
    else dropNear(state, obj, 0, grid, false, false);
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

/**
 * square_disable_trap (cave-square.c:1395-1399): every trap at the grid seizes
 * up for 10 turns - but ONLY if a player trap is there. The port open-coded the
 * loop and dropped that gate, so a glyph of warding or a web could be disabled
 * where upstream leaves it alone. Now it goes through the real
 * square_set_trap_timeout, which is what the C calls.
 */
function disableTraps(state: GameState, grid: Loc): void {
  if (!squareIsPlayerTrap(state, grid)) return;
  squareSetTrapTimeout(state, grid, -1, 10);
}

/* ------------------------------------------------------------------ *
 * The handlers. One function per project_f switch arm (project-feat.c),
 * bodies unchanged from the switch they came out of - including the ORDER of
 * every rng draw, which the 6,552 committed vectors in
 * project-feat-vectors.json replay.
 * ------------------------------------------------------------------ */

/** LIGHT / LIGHT_WEAK: turn the grid's glow on. */
const light: ProjectFeatHandler = ({ state, grid }) => {
  const c = state.chunk;
  let obvious = false;
  c.sqinfoOn(grid, SQUARE.GLOW);
  if (squareIsView(c, grid)) {
    if ((state.actor.player.timed[TMD.BLIND] ?? 0) === 0) obvious = true;
    state.updateFov?.(state);
  }
  return obvious;
};

/** DARK / DARK_WEAK: turn it off, but not lava and not a daylit surface. */
const dark: ProjectFeatHandler = ({ state, grid }) => {
  const c = state.chunk;
  let obvious = false;
  /* project-feat.c L73: (depth != 0 || !is_daytime()) && !square_isbright. PR2. */
  const daylit = c.depth === 0 && isDaytime(state.turn, state.z.dayLength);
  if (!daylit && !featIsBright(c.features, c.feat(grid))) {
    c.sqinfoOff(grid, SQUARE.GLOW);
  }
  if (squareIsView(c, grid)) {
    obvious = true;
    state.updateFov?.(state);
  }
  return obvious;
};

/** KILL_WALL: stone to mud, with rubble finds and gold-vein payouts. */
const killWall: ProjectFeatHandler = ({ state, grid, env }) => {
  const c = state.chunk;
  let obvious = false;
  /* Non-walls (etc). */
  if (c.isPassable(grid) && !c.isRubble(grid)) return false;
  /* Permanent walls. */
  if (c.isPerm(grid)) return false;

  const seen = squareIsSeen(c, grid);
  if (c.isRubble(grid)) {
    if (seen) {
      env.msg?.("The rubble turns into mud!");
      obvious = true;
    }
    /* square_destroy_rubble (cave-square.c:1502): set_feat(FEAT_FLOOR). */
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
  return obvious;
};

/** KILL_DOOR: destroy a door. */
const killDoor: ProjectFeatHandler = ({ state, grid, env }) => {
  const c = state.chunk;
  let obvious = false;
  if (c.isDoor(grid)) {
    if (squareIsView(c, grid)) {
      env.msg?.("There is a bright flash of light!");
      obvious = true;
    }
    /* square_destroy_door (cave-square.c:1382): drop the "door lock" trap and
     * set FEAT_FLOOR. The lock removal rides the setFeat hook here (FEAT_FLOOR
     * cannot hold a lock), so only the set_feat is explicit. */
    c.setFeat(grid, FEAT.FLOOR);
    /* On the surface, new terrain may be exposed to the sun. */
    if (c.depth === 0) exposeToSun(state, grid, isDaytime(state.turn, state.z.dayLength));
    state.updateFov?.(state);
  }
  return obvious;
};

/** KILL_TRAP: reveal secret doors, disable traps, unlock doors. */
const killTrap: ProjectFeatHandler = ({ state, grid, env }) => {
  const c = state.chunk;
  let obvious = false;
  /* Reveal secret doors. */
  if (squareIsSecretDoor(state, grid)) {
    c.setFeat(grid, FEAT.CLOSED);
    if (squareIsSeen(c, grid)) obvious = true;
  }
  /* Disable traps, unlock doors. Gate on square_isdisarmabletrap
   * (project-feat.c L230): enabled + visible + player trap, so an
   * already-disabled or non-player visible trap falls through to the door-lock
   * branch instead of "seizing up" again. PR1. */
  if (squareIsDisarmableTrap(state, grid)) {
    if (squareIsSeen(c, grid)) {
      env.msg?.("The trap seizes up.");
      obvious = true;
    }
    disableTraps(state, grid);
  } else if (env.trapDeps && squareDoorPower(state, grid, env.trapDeps) > 0) {
    /* square_unlock_door (cave-square.c:1377-1380) = square_set_door_lock(c,
     * grid, 0), and square_set_door_lock (trap.c:706-726) KEEPS the "door lock"
     * trap and sets its power to 0 - it does not delete it. The trap object must
     * survive: square_istrap / square_isplayertrap and the savefile's trap block
     * both see it upstream. */
    squareSetDoorLock(state, grid, 0, env.trapDeps);
    if (squareIsView(c, grid)) {
      env.msg?.("Click!");
      obvious = true;
    }
  }
  return obvious;
};

/** MAKE_DOOR: a closed door on an unoccupied floor grid. */
const makeDoor: ProjectFeatHandler = ({ state, grid }) => {
  const c = state.chunk;
  /* Require a floor grid without monsters or the player. */
  if (squareMonster(state, grid) || squareIsPlayer(state, grid)) return false;
  if (!c.isFloor(grid)) return false;
  /* Push objects off the grid, then create a closed door:
   * square_add_door(c, grid, true) (cave-square.c:1347). */
  pushObject(state, grid);
  c.setFeat(grid, FEAT.CLOSED);
  const obvious = squareIsSeen(c, grid);
  state.updateFov?.(state);
  return obvious;
};

/** MAKE_TRAP: one in four on an empty, trapless floor grid. */
const makeTrap: ProjectFeatHandler = ({ state, grid, env }) => {
  const c = state.chunk;
  /* Require an empty floor grid with no existing traps. */
  if (!squareIsEmptyLive(state, grid)) return false;
  if (squareIsTrap(state, grid)) return false;
  if (state.rng.oneIn(4) && env.trapDeps) {
    /* square_add_trap (cave-square.c:1304) = place_trap(c, grid, -1, depth). */
    placeTrap(state, grid, -1, c.depth, env.trapDeps);
    squareRevealTrap(state, grid, false, env.trapDeps);
  }
  return true;
};

/** FIRE / PLASMA: fire clears webs, and either can make lava if huge. */
const fire: ProjectFeatHandler = ({ state, grid, dam, typ, env }) => {
  const c = state.chunk;
  const obvious = observed(state, grid);
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
  return obvious;
};

/** COLD / ICE: intense cold solidifies lava. */
const cold: ProjectFeatHandler = ({ state, grid, dam }) => {
  const c = state.chunk;
  const obvious = observed(state, grid);
  /* Sufficiently intense cold can solidify lava. */
  if (dam > state.rng.randint1(900) + 300 && c.isFiery(grid)) {
    /* square_isoccupied (cave-square.c:391): square->mon != 0, i.e. either a
     * monster (positive midx) or the player (-1). */
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
  return obvious;
};

/**
 * The monster-directed projections have EMPTY feature handlers upstream: they
 * never touch terrain and never set obvious (project-feat.c:581-675), so the
 * player observes nothing from them at the grid level. Registered explicitly
 * rather than left to fall through, because the fallback is observe-only and
 * would hand them an `obvious` upstream does not give them.
 */
const inert: ProjectFeatHandler = () => false;

/**
 * The fallback, and upstream's `default`: the remaining damage / elemental
 * projections only give the player a chance to observe. This is also what a
 * mod's projection gets until it registers a handler, which is why adding one
 * is safe with no code at all.
 */
const observeOnly: ProjectFeatHandler = ({ state, grid }) => observed(state, grid);

/** The 24 monster-directed codes whose upstream feature handler is empty. */
const INERT_CODES = [
  "AWAY_UNDEAD",
  "AWAY_EVIL",
  "AWAY_SPIRIT",
  "AWAY_ALL",
  "TURN_UNDEAD",
  "TURN_EVIL",
  "TURN_LIVING",
  "TURN_ALL",
  "DISP_UNDEAD",
  "DISP_EVIL",
  "DISP_ALL",
  "SLEEP_UNDEAD",
  "SLEEP_EVIL",
  "SLEEP_ALL",
  "MON_CLONE",
  "MON_POLY",
  "MON_HEAL",
  "MON_SPEED",
  "MON_SLOW",
  "MON_CONF",
  "MON_HOLD",
  "MON_STUN",
  "MON_DRAIN",
  "MON_CRUSH",
] as const;

/**
 * project_f's switch, as a table keyed by projection CODE.
 *
 * KEYED BY CODE, NOT BY THE PROJ NUMBER, and that is the whole point. A PROJ_
 * value is an index into a compiled-in enum; a mod's projection is appended
 * past the end of it (bindProjections), so its number depends on what else is
 * installed. Its `code` does not - that is the identity the record itself
 * declares, and the same string composition keys projection.json by
 * (mod-sdk/src/record-key.ts).
 *
 * Every code core ships appears here, INCLUDING the 24 that do nothing, so the
 * table is a complete statement of the switch it replaced rather than a partial
 * one with a catch-all behind it. project-feat-registry.test.ts asserts that in
 * both directions against the bound projection table.
 */
export const PROJECT_FEAT_HANDLERS: ReadonlyMap<string, ProjectFeatHandler> =
  new Map<string, ProjectFeatHandler>([
    ["LIGHT_WEAK", light],
    ["LIGHT", light],
    ["DARK_WEAK", dark],
    ["DARK", dark],
    ["KILL_WALL", killWall],
    ["KILL_DOOR", killDoor],
    ["KILL_TRAP", killTrap],
    ["MAKE_DOOR", makeDoor],
    ["MAKE_TRAP", makeTrap],
    ["FIRE", fire],
    ["PLASMA", fire],
    ["COLD", cold],
    ["ICE", cold],
    ...INERT_CODES.map((code): [string, ProjectFeatHandler] => [code, inert]),
  ]);

/**
 * project_f: affect the terrain at `grid` (PROJECT_GRID). Returns whether
 * anything the player can see happened.
 *
 * This was a 37-case switch until 2026-08-08; it is now a lookup in
 * PROJECT_FEAT_HANDLERS, and a mod reaches it through the per-game
 * ProjectionHandlerRegistry that wireGame supplies as `env.featHandlers`.
 * The signature, the arms and every rng draw are unchanged - the 6,552 vectors
 * in project-feat-vectors.json are replayed against it for exactly that reason.
 */
export function projectFeature(
  state: GameState,
  _r: number,
  grid: Loc,
  dam: number,
  typ: number,
  env: ProjectFeatEnv = {},
): boolean {
  const code = projectionCodeFor(typ, env.projections);
  const table = env.featHandlers ?? PROJECT_FEAT_HANDLERS;
  const handler = (code === undefined ? undefined : table.get(code)) ?? observeOnly;
  return handler({ state, grid, dam, typ, env });
}
