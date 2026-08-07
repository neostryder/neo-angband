/**
 * The terrain-shaping effect handlers, ported from
 * reference/src/effect-handler-general.c and effect-handler-attack.c
 * (Angband 4.2.6): EF_RUBBLE (general L2939, rubble falling into the empty
 * grids around the player), EF_GRANITE (L2991, a granite wall on the
 * originating trap's grid), EF_CREATE_STAIRS (L1975, stairs under the
 * player), EF_LIGHT_LEVEL / EF_DARKEN_LEVEL (L3003, wiz_light / wiz_dark),
 * EF_LIGHT_AREA / EF_DARKEN_AREA (L3026, light_room over the room's grids),
 * EF_DESTRUCTION (attack L1169, the *Destruction* circle that deletes
 * monsters and rebuilds the terrain) and EF_EARTHQUAKE (attack L1290, the
 * radius-r quake with player and monster displacement).
 *
 * light_room / wiz_light are ported here (cave-map.c): SQUARE_GLOW changes,
 * room flooding, illumination wake-up rolls, and player square memory.
 *
 * Like the other game-layer handlers these read their environment from
 * context.env.game and no-op when it is absent (the worldless rule).
 *
 * Simplifications, ledgered in parity/ledger/game-effect-terrain.yaml:
 * - No town or arena (depth 0 short-circuits like the town branch), no
 *   birth_levels_persist option (#30).
 * - expose_to_sun on the surface rides the day-night cycle.
 */

import { ELEM, FEAT, EF, MON_MSG, MON_TMD, RF, SQUARE, TF, TMD } from "../generated/index.js";
import type { Loc } from "../loc.js";
import { DDGRID_DDD, distance, loc, locEq, locSum } from "../loc.js";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
  Source,
} from "../effects/interpreter.js";
import { monsterIsSmart, monsterIsStupid } from "../mon/predicate.js";
import { monsterWake } from "../mon/take-hit.js";
import { MDESC_TARG, monsterDesc } from "../mon/desc.js";
import {
  addMonsterMessage,
  addMonsterMessageShowDamage,
} from "./mon-message.js";
import { liveObjectIsKnownArtifact } from "../obj/artifact-known.js";
import { equipLearnElement } from "../obj/knowledge.js";
import { featIsBright } from "../world/chunk.js";
import { los } from "../world/view.js";
import {
  caveFindDecoy,
  monsterIsDecoyed,
  monsterTargetMonster,
} from "./effect-mon-origin.js";
import type { GameState } from "./context.js";
import { squareIsEmptyLive } from "./mon-place.js";
import {
  deleteMonster,
  monsterSwap,
  movePlayer,
  squareMonster,
} from "./context.js";
import { gameEnv } from "./effect-game-env.js";
import type { GameEffectEnv } from "./effect-game-env.js";
import { floorExcise, floorPile } from "./floor.js";
import {
  squareForget,
  squareKnowPile,
  squareMemorize,
  squareMemoryBad,
  squareSensePile,
} from "./known.js";
import { pushObject } from "./project-feat.js";
import { squareIsVisibleTrap, squareIsWarded } from "./trap.js";

/** msg() over the effect context's optional message sink. */
function say(ctx: EffectHandlerContext, text: string): void {
  ctx.env.messages?.msg(text);
}

/** origin_get_loc: the grid an effect originates from. */
function originGrid(env: GameEffectEnv, origin: Source): Loc | null {
  switch (origin.what) {
    case "player":
      return env.state.actor.grid;
    case "monster":
      return env.state.monsters[origin.monster]?.grid ?? null;
    case "trap": {
      const trap = origin.trap as { grid?: Loc } | null;
      return trap?.grid ?? null;
    }
    default:
      return null;
  }
}

/**
 * light_room (cave-map.c L372): flood the room containing `grid` (walls get
 * lit but stop the spread) and light or darken every grid at once. Lighting
 * rolls the illumination wake-ups (smart monsters always, normal 1/4,
 * stupid 1/10); darkening spares internally-lit (BRIGHT) grids. The
 * square-memory half (PF_UNLIGHT memorize, floor forget) rides map memory.
 */
export function lightRoom(state: GameState, grid: Loc, light: boolean): void {
  const c = state.chunk;
  const pts: Loc[] = [];
  const seen = new Set<number>();
  const add = (g: Loc): void => {
    if (!c.inBounds(g)) return;
    const key = g.y * c.width + g.x;
    if (seen.has(key)) return;
    if (!c.sqinfoHas(g, SQUARE.ROOM)) return;
    seen.add(key);
    pts.push(g);
  };

  /* Add the initial grid, then spread along projectable room grids. */
  add(grid);
  for (let i = 0; i < pts.length; i++) {
    if (!c.isProjectable(pts[i]!)) continue;
    for (let d = 0; d < 8; d++) {
      add(locSum(pts[i]!, DDGRID_DDD[d]!));
    }
  }

  if (light) {
    /* cave_light: perma-light, then process the affected monsters. */
    for (const g of pts) c.sqinfoOn(g, SQUARE.GLOW);
    for (const g of pts) {
      const mon = squareMonster(state, g);
      if (!mon) continue;
      let chance = 25;
      if (monsterIsStupid(mon)) chance = 10;
      if (monsterIsSmart(mon)) chance = 100;
      if (
        (mon.mTimed[MON_TMD.SLEEP] ?? 0) > 0 &&
        state.rng.randint0(100) < chance
      ) {
        monsterWake(state.rng, mon, true, 100);
      }
    }
  } else {
    /* cave_unlight: darken all but internally-lit grids. */
    for (const g of pts) {
      if (!featIsBright(c.features, c.feat(g))) c.sqinfoOff(g, SQUARE.GLOW);
    }
  }

  state.updateFov?.(state);
}

/**
 * wiz_light (cave-map.c:417-479) and wiz_dark (cave-map.c:490-546).
 *
 * The two upstream bodies are line-for-line identical except for ONE
 * expression: wiz_light does `sqinfo_on(..., SQUARE_GLOW)` on each neighbour
 * (cave-map.c:435) where wiz_dark does `sqinfo_off` (cave-map.c:508). Both
 * MEMORIZE terrain, both know/sense the floor piles, and both run the same
 * mark / forget-misremembered / unmark passes. wiz_dark is therefore "light up
 * the map, but perma-DARK the grids" - it is not a forget-everything.
 *
 * Structure, guaranteed by the C:
 * - the neighbour loop is gated on `!square_seemslikewall(grid)` (TF_ROCK,
 *   cave-square.c:769), but the pile pass and the forget pass run for EVERY
 *   grid in 1..h-2 / 1..w-2, walls included (the `continue` at cave-map.c:426
 *   is dead: square_in_bounds_fully is always true in that range);
 * - a neighbour is memorized only when `!square_isfloor(a_grid) ||
 *   square_isvisibletrap(a_grid)` (cave-map.c:439-440 / :510-511), and each
 *   memorized neighbour is square_mark'ed (cave-square.c:1585);
 * - `full` picks square_know_pile over square_sense_pile (cave-map.c:448-452 /
 *   :519-523), threaded from context->value.base by both effect handlers
 *   (effect-handler-general.c:3005 / :3016) and true for the wizard command
 *   (cmd-wizard.c:2909);
 * - then `!square_ismark(grid) && square_ismemorybad(grid) ->
 *   square_forget(grid)` (cave-map.c:456-459 / :527-530);
 * - then a square_unmark sweep over 1..h-2 / 1..w-2 only (cave-map.c:463-470 /
 *   :534-541). Upstream WART preserved: a MARK set on row 0 / column 0 by the
 *   neighbour loop is never swept, so it survives into the savefile. It is
 *   never read again (square_ismark is only ever called on 1..h-2 grids), so
 *   the wart is inert; it is kept because core keeps warts.
 *
 * SQUARE_MARK's whole life in 4.2.6 is inside these two functions: it is set
 * only at cave-map.c:441 / :512, read only at cave-map.c:456 / :527, and
 * cleared by the sweep. The four other square_unmark calls
 * (project-feat.c:332/355/465/526, effect-handler-general.c:1263) are
 * vestigial no-ops - nothing marks those grids, and MAP_AREA's own forget check
 * (effect-handler-general.c:1252) deliberately omits the !square_ismark half.
 *
 * `isCurrentCave` is upstream's `c != cave` guard (square_memorize
 * cave-square.c:1576, square_forget :1582, square_know_pile :1169,
 * square_sense_pile :1147 all return early when c is not the live cave).
 * generate.c:1109 (arena) and :1256 (a "known" labyrinth) call
 * wiz_light(chunk, p, false) on a chunk that is not yet `cave`, so those calls
 * set SQUARE_GLOW and nothing else. Pass false to reproduce that.
 */
export function wizLightLevel(
  state: GameState,
  lit: boolean,
  full: boolean,
  isCurrentCave = true,
): void {
  const c = state.chunk;
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const grid = loc(x, y);
      /* Process all non-walls (square_seemslikewall, cave-square.c:769). */
      if (!c.feature(grid).flags.has(TF.ROCK)) {
        /* Scan all neighbors (ddgrid_ddd[8] is the grid itself). */
        for (let i = 0; i < 9; i++) {
          const a = locSum(grid, DDGRID_DDD[i]!);
          /* Perma-light / perma-darken: the ONLY difference between the two
           * upstream functions (cave-map.c:435 vs :508). */
          if (lit) c.sqinfoOn(a, SQUARE.GLOW);
          else c.sqinfoOff(a, SQUARE.GLOW);
          /* Memorize normal features (cave-map.c:439-442 / :510-513): only
           * non-floor terrain, or a floor grid carrying a VISIBLE trap. Plain
           * floor is lit but deliberately NOT remembered. */
          if (!c.isFloor(a) || squareIsVisibleTrap(state, a)) {
            if (isCurrentCave) squareMemorize(state, a);
            c.sqinfoOn(a, SQUARE.MARK);
          }
        }
      }
      /* Memorize objects (cave-map.c:445-452 / :516-523). */
      if (isCurrentCave) {
        if (full) squareKnowPile(state, grid);
        else squareSensePile(state, grid);
      }
      /* Forget grids that are both unprocessed and misremembered in the
       * mapping area (cave-map.c:456-459 / :527-530). */
      if (
        isCurrentCave &&
        !c.sqinfoHas(grid, SQUARE.MARK) &&
        squareMemoryBad(state, grid)
      ) {
        squareForget(state, grid);
      }
    }
  }
  /* Unmark grids (cave-map.c:463-470 / :534-541). */
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      c.sqinfoOff(loc(x, y), SQUARE.MARK);
    }
  }
  /*
   * cave-map.c:474 sets PU_UPDATE_VIEW; it does NOT call update_view. The
   * difference matters at generate.c:1109 and :1256, where wiz_light runs on a
   * chunk that is not yet `cave`: upstream's flag is serviced at the next
   * update_stuff, by which time the player has been placed on the new level. This
   * port has no PU_ flags and refreshes immediately, so on the not-current-cave
   * path it would build the view while `state.chunk` is the NEW level and the
   * player's grid is still the OLD one.
   *
   * That threw `square out of bounds: 75,31` on arena entry the moment core
   * acquired a default updateFov - a live crash in the web build, which has always
   * had one, reachable through EF_SINGLE_COMBAT. It was invisible for as long as
   * the seam could be absent. Deferring to the caller's own refresh (changeLevel
   * calls updateFov after placePlayer) is what upstream's flag does.
   */
  if (isCurrentCave) state.updateFov?.(state);
}

/** square_changeable: no perma-grids, shops, stairs or artifact piles. */
function squareChangeable(state: GameState, grid: Loc): boolean {
  const c = state.chunk;
  if (c.isPerm(grid) || c.isShop(grid) || c.isStairs(grid)) return false;
  for (const obj of floorPile(state, grid)) {
    if (obj.artifact) return false;
  }
  return true;
}

/**
 * EF_RUBBLE: rubble falls into the empty grids around the player.
 */
const handleRUBBLE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const c = state.chunk;
  const pgrid = state.actor.grid;

  /* Work out how many grids to fill, limited to the open neighbours. */
  let rubbleGrids = state.rng.randint1(3);
  let openGrids = 0;
  for (let d = 0; d < 8; d++) {
    const grid = locSum(pgrid, DDGRID_DDD[d]!);
    if (c.inBounds(grid) && squareIsEmptyLive(state, grid)) openGrids++;
  }
  if (rubbleGrids > openGrids) rubbleGrids = openGrids;

  /* Avoid infinite loops */
  let iterations = 0;
  while (rubbleGrids > 0 && iterations < 10) {
    /* Look around the player */
    for (let d = 0; d < 8; d++) {
      const grid = locSum(pgrid, DDGRID_DDD[d]!);
      if (!c.inBoundsFully(grid)) continue;
      if (!squareIsEmptyLive(state, grid)) continue;

      if (state.rng.oneIn(3)) {
        c.setFeat(grid, state.rng.oneIn(2) ? FEAT.PASS_RUBBLE : FEAT.RUBBLE);
        rubbleGrids--;
      }
    }
    iterations++;
  }

  ctx.ident = true;
  state.updateFov?.(state);
  return true;
};

/**
 * EF_GRANITE: a granite wall on the originating trap's grid (the earthquake
 * trap's wall-sealing effect).
 */
const handleGRANITE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  if (ctx.origin.what !== "trap") return true;
  const grid = originGrid(env, ctx.origin);
  if (!grid) return true;

  env.state.chunk.setFeat(grid, FEAT.GRANITE);
  env.state.updateFov?.(env.state);
  return true;
};

/**
 * EF_CREATE_STAIRS: stairs on the player's grid (square_add_stairs picks the
 * direction: always down in town, never down on quest or bottom levels).
 */
const handleCREATE_STAIRS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const grid = state.actor.grid;
  ctx.ident = true;

  /* Only allow stairs to be created on empty floor. This test comes FIRST
   * upstream (L1979-1983), before the persist/arena refusal, so standing on a
   * non-floor grid in an arena reports the floor, not "Nothing happens!". */
  if (!state.chunk.isFloor(grid)) {
    say(ctx, "There is no empty floor here.");
    return false;
  }

  /* Fails for persistent levels (for now) and arenas (L1985-1989). The
   * persistent half is not decoration: a staircase conjured after generation
   * is not in the level's join list, so the neighbour it appears to lead to
   * would be built without a matching stair. */
  if ((state.options?.get("birth_levels_persist") ?? false) || state.arenaLevel) {
    say(ctx, "Nothing happens!");
    return false;
  }

  /* Push objects off the grid. */
  if (floorPile(state, grid).length > 0) pushObject(state, grid);

  /* square_add_stairs */
  let down = state.rng.randint0(100) < 50;
  const depth = state.chunk.depth;
  if (depth === 0) {
    down = true;
  } else if (env.teleport?.isQuest?.(depth) || depth >= state.z.maxDepth - 1) {
    down = false;
  }
  state.chunk.setFeat(grid, down ? FEAT.MORE : FEAT.LESS);

  return true;
};

/**
 * EF_LIGHT_LEVEL: light the whole level (wiz_light); a nonzero value base is
 * the "full" clairvoyant form with its message.
 */
const handleLIGHT_LEVEL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  /* bool full = context->value.base ? true : false (effect-handler-general.c
   * :3005): the same flag gates the message AND square_know_pile vs
   * square_sense_pile inside wiz_light. */
  const full = ctx.value.base ? true : false;
  if (full) {
    say(ctx, "An image of your surroundings forms in your mind...");
  }
  wizLightLevel(env.state, true, full);
  ctx.ident = true;
  return true;
};

/**
 * EF_DARKEN_LEVEL: darken the whole level (wiz_dark).
 */
const handleDARKEN_LEVEL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  /* bool full = context->value.base (effect-handler-general.c:3016). */
  const full = ctx.value.base ? true : false;
  if (full) {
    say(ctx, "A great blackness rolls through the dungeon...");
  }
  wizLightLevel(env.state, false, full);
  ctx.ident = true;
  return true;
};

/**
 * EF_LIGHT_AREA: light the room around the player.
 */
const handleLIGHT_AREA: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* Message */
  if (!((state.actor.player.timed[TMD.BLIND] ?? 0) > 0)) {
    say(ctx, "You are surrounded by a white light.");
  }

  /* Light up the room */
  lightRoom(state, state.actor.grid, true);

  /* Assume seen */
  ctx.ident = true;
  return true;
};

/**
 * EF_DARKEN_AREA: darken the room around the player, a targeted monster, or
 * the player's decoy (effect-handler-general.c EF_DARKEN_AREA). A monster
 * caster targeting another monster darkens its room; a decoyed caster darkens
 * the decoy's room (and the effect is unseen if the decoy is out of sight or
 * the player is blind). The player-cast form blinds an unresisting caster.
 */
const handleDARKEN_AREA: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  let target = state.actor.grid;
  let message = !((state.actor.player.timed[TMD.BLIND] ?? 0) > 0);
  let decoyUnseen = false;

  const mon =
    ctx.origin.what === "monster"
      ? (state.monsters[ctx.origin.monster] ?? null)
      : null;

  /* Check for monster targeting another monster. */
  const tMon =
    ctx.origin.what === "monster"
      ? monsterTargetMonster(state, ctx.origin.monster)
      : null;
  if (tMon) {
    target = tMon.grid;
    if (message) {
      /* monster_desc(m_name, ..., t_mon, MDESC_TARG) (L3061). */
      say(ctx, `Darkness surrounds ${monsterDesc(tMon, MDESC_TARG)}.`);
      message = false;
    }
  }

  /* Check for a decoy. */
  if (mon && monsterIsDecoyed(state, mon)) {
    const decoy = caveFindDecoy(state);
    if (decoy) target = decoy;
    if (
      !decoy ||
      !los(state.chunk, state.actor.grid, decoy) ||
      (state.actor.player.timed[TMD.BLIND] ?? 0) > 0
    ) {
      decoyUnseen = true;
    }
    if (message && !decoyUnseen) {
      say(ctx, "Darkness surrounds the decoy.");
      message = false;
    }
  }

  if (message) {
    say(ctx, "Darkness surrounds you.");
  }

  /* Darken the room */
  lightRoom(state, target, false);

  /* Hack - blind the player directly if player-cast */
  if (
    ctx.origin.what === "player" &&
    env.cast.playerActor.resistLevel(ELEM.DARK) <= 0
  ) {
    const amount = 3 + state.rng.randint1(5);
    ctx.env.player?.timed?.incTimed(TMD.BLIND, amount, true, !ctx.aware, true);
  }

  /* Assume seen (unless the decoy was out of sight). */
  ctx.ident = !decoyUnseen;
  return true;
};

/**
 * EF_DESTRUCTION: the *Destruction* circle - monsters within the radius are
 * deleted (not killed), non-permanent terrain is rebuilt (square_destroy)
 * and a light or dark subtype blinds an unresisting player.
 */
const handleDESTRUCTION: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const c = state.chunk;
  const r = ctx.radius;
  const elem = ctx.subtype;
  const pgrid = state.actor.grid;

  ctx.ident = true;

  /* No effect in town or arena. */
  if (c.depth === 0 || state.arenaLevel) {
    say(ctx, "The ground shakes for a moment.");
    return true;
  }

  /* Big area of affect */
  for (let y = pgrid.y - r; y <= pgrid.y + r; y++) {
    for (let x = pgrid.x - r; x <= pgrid.x + r; x++) {
      const grid = loc(x, y);
      if (!c.inBoundsFully(grid)) continue;

      /* Stay in the circle of death */
      if (distance(pgrid, grid) > r) continue;

      /* Lose room and vault */
      c.sqinfoOff(grid, SQUARE.ROOM);
      c.sqinfoOff(grid, SQUARE.VAULT);

      /* Forget completely (effect-handler-attack.c:1201-1207). */
      if (!featIsBright(c.features, c.feat(grid))) {
        c.sqinfoOff(grid, SQUARE.GLOW);
      }
      c.sqinfoOff(grid, SQUARE.SEEN);
      squareForget(state, grid);

      /* Deal with player later */
      if (locEq(grid, pgrid)) continue;

      /* Delete the monster (if any) */
      const midx = c.mon(grid);
      if (midx > 0) deleteMonster(state, midx);

      /* Don't remove stairs */
      if (c.isStairs(grid)) continue;

      /* Destroy any grid that isn't a permanent wall */
      if (!c.isPerm(grid)) {
        /* Deal with artifacts before removing the pile
         * (effect-handler-attack.c:1220-1243). */
        const loseArts = state.options?.get("birth_lose_arts") ?? false;
        /* square_excise_pile (cave-square.c:1031): drop the whole pile. The
         * port's pile is a Map entry, so excising every member removes it -
         * there is no square_set_obj(c, grid, NULL) head pointer to clear. */
        for (const obj of [...floorPile(state, grid)]) {
          if (obj.artifact) {
            const lostForever = loseArts || liveObjectIsKnownArtifact(obj);
            if (lostForever) state.onArtifactLost?.(obj.artifact);
            state.artifacts?.markCreated(obj.artifact.aidx, lostForever);
          }
          floorExcise(state, grid, obj);
        }
        /* square_destroy */
        const roll = state.rng.randint0(200);
        let feat: number = FEAT.FLOOR;
        if (roll < 20) feat = FEAT.GRANITE;
        else if (roll < 70) feat = FEAT.QUARTZ;
        else if (roll < 100) feat = FEAT.MAGMA;
        c.setFeat(grid, feat);
      }
    }
  }

  /* Player is affected */
  if (elem === ELEM.LIGHT || elem === ELEM.DARK) {
    say(
      ctx,
      elem === ELEM.LIGHT
        ? "There is a searing blast of light!"
        : "Darkness seems to crush you!",
    );
    equipLearnElement(state.actor.player, state.runeEnv, elem);
    if (env.cast.playerActor.resistLevel(elem) <= 0) {
      const amount = 10 + state.rng.randint1(10);
      ctx.env.player?.timed?.incTimed(TMD.BLIND, amount, true, true, true);
    }
  }

  /* Fully update the visuals */
  state.updateFov?.(state);
  return true;
};

/**
 * EF_EARTHQUAKE: the radius-r quake centred on the instigator. Walls and
 * floors are shuffled (square_earthquake), the player jumps to a safe grid
 * or is crushed, and monsters that cannot coexist with rock take damage,
 * escape, or are buried (deleted).
 */
const handleEARTHQUAKE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const c = state.chunk;
  let r = ctx.radius;
  const targeted = ctx.subtype !== 0;
  const pgrid = state.actor.grid;
  let centre = originGrid(env, ctx.origin) ?? pgrid;

  ctx.ident = true;

  /* Sometimes ask for a target (get_aim_dir / target_get: the aimed seam). */
  if (targeted && env.aimed) centre = env.aimed;

  if (c.depth > 0 && (!state.arenaLevel || ctx.origin.what === "monster")) {
    say(ctx, "The ground shakes! The ceiling caves in!");
  } else {
    /* No effect in town or arena. */
    say(ctx, "The ground shakes for a moment.");
    return true;
  }

  /* Paranoia -- Enforce maximum range */
  if (r > 15) r = 15;

  /* A map of the maximal blast area, indexed [16 + dy][16 + dx]. */
  const map: boolean[][] = Array.from(
    { length: 32 },
    () => new Array<boolean>(32).fill(false),
  );
  const mapAt = (g: Loc): boolean =>
    map[16 + g.y - centre.y]?.[16 + g.x - centre.x] ?? false;
  const mapSet = (g: Loc, v: boolean): void => {
    const row = map[16 + g.y - centre.y];
    if (row) row[16 + g.x - centre.x] = v;
  };

  /* Check around the epicenter */
  let hurt = false;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const grid = locSum(centre, loc(dx, dy));
      if (!c.inBoundsFully(grid)) continue;
      if (distance(centre, grid) > r) continue;

      /* Lose room and vault; forget completely (memory rides #25). */
      c.sqinfoOff(grid, SQUARE.ROOM);
      c.sqinfoOff(grid, SQUARE.VAULT);
      if (!featIsBright(c.features, c.feat(grid))) {
        c.sqinfoOff(grid, SQUARE.GLOW);
      }
      c.sqinfoOff(grid, SQUARE.SEEN);

      /* Skip the epicenter */
      if (dx === 0 && dy === 0) continue;

      /* Skip most grids */
      if (state.rng.randint0(100) < 85) continue;

      /* Damage this grid */
      mapSet(grid, true);

      /* Take note of player damage */
      if (locEq(grid, pgrid)) hurt = true;
    }
  }

  /* First, determine the effects on the player (if necessary) */
  let damage = 0;
  if (hurt) {
    /* Check around the player */
    let safeGrids = 0;
    let safeGrid = loc(0, 0);
    for (let i = 0; i < 8; i++) {
      const grid = locSum(pgrid, DDGRID_DDD[i]!);
      /* square_isopen: skip non-empty grids (pushing into traps is fine). */
      if (!c.isFloor(grid) || c.mon(grid) !== 0) continue;
      /* Important -- Skip grids marked for damage */
      if (mapAt(grid)) continue;
      /* Count "safe" grids, apply the randomizer */
      if (++safeGrids > 1 && state.rng.randint0(safeGrids) !== 0) continue;
      safeGrid = grid;
    }

    /* Random message */
    switch (state.rng.randint1(3)) {
      case 1:
        say(ctx, "The cave ceiling collapses on you!");
        break;
      case 2:
        say(ctx, "The cave floor twists in an unnatural way!");
        break;
      default:
        say(ctx, "The cave quakes!");
        say(ctx, "You are pummeled with debris!");
        break;
    }

    const player = ctx.env.player;
    if (!safeGrids) {
      /* Hurt the player a lot */
      damage = player?.applyDamageReduction
        ? player.applyDamageReduction(300)
        : 300;
      say(ctx, "You are severely crushed!");
    } else {
      /* Destroy the grid, and push the player to (relative) safety */
      let hurtMsg = "";
      switch (state.rng.randint1(3)) {
        case 1:
          hurtMsg = "You nimbly dodge the blast!";
          damage = 0;
          break;
        case 2: {
          hurtMsg = "You are bashed by rubble!";
          damage = state.rng.damroll(10, 4);
          const stun = state.rng.randint1(50);
          player?.timed?.incTimed(TMD.STUN, stun, true, true, true);
          break;
        }
        default: {
          hurtMsg = "You are crushed between the floor and ceiling!";
          damage = state.rng.damroll(10, 4);
          const stun = state.rng.randint1(50);
          player?.timed?.incTimed(TMD.STUN, stun, true, true, true);
          break;
        }
      }

      if (damage > 0 && player?.applyDamageReduction) {
        damage = player.applyDamageReduction(damage);
      }
      say(ctx, hurtMsg);

      /* Move player (monster_swap into an open grid + post-move). */
      movePlayer(state, safeGrid);
      env.teleport?.onPlayerPostMove?.(true);
    }
  }

  /* Examine the quaked region: process monsters */
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const grid = locSum(centre, loc(dx, dy));

      /* Skip unaffected grids */
      if (!mapAt(grid)) continue;

      const mon = squareMonster(state, grid);
      if (!mon) continue;

      /* Most monsters cannot co-exist with rock */
      if (
        mon.race.flags.has(RF.KILL_WALL) ||
        mon.race.flags.has(RF.PASS_WALL)
      ) {
        continue;
      }

      /* Assume not safe */
      let safeGrids = 0;
      let safeGrid = loc(0, 0);

      /* Monster can move to escape the wall */
      if (!mon.race.flags.has(RF.NEVER_MOVE)) {
        /* Look for safety */
        for (let i = 0; i < 8; i++) {
          const safe = locSum(grid, DDGRID_DDD[i]!);
          /* Skip non-empty grids */
          if (!squareIsEmptyLive(state, safe)) continue;
          /* No safety on glyph of warding */
          if (squareIsWarded(state, safe)) continue;
          /* Important -- Skip quake grids */
          if (mapAt(safe)) continue;
          /* Count safe grids, apply the randomizer */
          if (++safeGrids > 1 && state.rng.randint0(safeGrids) !== 0) {
            continue;
          }
          safeGrid = safe;
        }
      }

      /* Take damage from the quake */
      const mDam = safeGrids ? state.rng.damroll(4, 8) : mon.hp + 1;

      /* Monster is certainly awake, not thinking about player */
      monsterWake(state.rng, mon, false, 0);

      /* Apply damage directly */
      mon.hp -= mDam;

      /* display_dam (effect-handler-attack.c:1524/1546): OPT show_damage
       * selects the _show_damage form of each message. add_monster_message
       * does the visibility gating itself, so there is no monsterIsVisible
       * test around these - which is what let a stand-in `msg` diverge. */
      const displayDam = ctx.env.showDamage ?? false;
      if (mon.hp < 0) {
        if (displayDam) {
          addMonsterMessageShowDamage(state, mon, MON_MSG.QUAKE_DEATH, false, mDam);
        } else {
          addMonsterMessage(state, mon, MON_MSG.QUAKE_DEATH, false);
        }
        /* Delete (not kill) "dead" monsters. */
        deleteMonster(state, mon.midx);
      } else {
        if (displayDam) {
          addMonsterMessageShowDamage(state, mon, MON_MSG.QUAKE_HURT, false, mDam);
        } else {
          addMonsterMessage(state, mon, MON_MSG.QUAKE_HURT, false);
        }
        /* Escape from the rock */
        if (safeGrids) monsterSwap(state, grid, safeGrid);
      }
    }
  }

  /* Important -- no wall on player */
  if (
    Math.abs(pgrid.x - centre.x) <= 15 &&
    Math.abs(pgrid.y - centre.y) <= 15
  ) {
    mapSet(pgrid, false);
  }

  /* Examine the quaked region and damage marked grids if possible */
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const grid = locSum(centre, loc(dx, dy));
      if (!c.inBoundsFully(grid)) continue;

      /* Unaffected grids only get their light redrawn (#25). */
      if (!mapAt(grid)) continue;

      /* Destroy location and all objects (if valid) */
      if (!squareChangeable(state, grid)) continue;
      for (const obj of [...floorPile(state, grid)]) {
        floorExcise(state, grid, obj);
      }
      /* square_earthquake */
      const t = state.rng.randint0(100);
      if (!c.isPassable(grid)) {
        c.setFeat(grid, FEAT.FLOOR);
        continue;
      }
      c.setFeat(grid, t < 20 ? FEAT.GRANITE : t < 70 ? FEAT.QUARTZ : FEAT.MAGMA);
    }
  }

  /* Apply damage to the player last, so messages are ordered properly. */
  if (damage > 0) ctx.env.player?.takeHit?.(damage, "an earthquake");

  /* Fully update the visuals */
  state.updateFov?.(state);
  return true;
};

/** The terrain handlers, keyed by upstream EF code. */
const TERRAIN_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.RUBBLE, handleRUBBLE],
  [EF.GRANITE, handleGRANITE],
  /* effect_handler_CREATE_STAIRS (effect-handler-general.c:1975) */
  [EF.CREATE_STAIRS, handleCREATE_STAIRS],
  /* effect_handler_LIGHT_LEVEL (effect-handler-general.c:3003) */
  [EF.LIGHT_LEVEL, handleLIGHT_LEVEL],
  /* effect_handler_DARKEN_LEVEL (effect-handler-general.c:3013) */
  [EF.DARKEN_LEVEL, handleDARKEN_LEVEL],
  /* effect_handler_LIGHT_AREA (effect-handler-general.c:3026) */
  [EF.LIGHT_AREA, handleLIGHT_AREA],
  /* effect_handler_DARKEN_AREA (effect-handler-general.c:3044) */
  [EF.DARKEN_AREA, handleDARKEN_AREA],
  /* effect_handler_DESTRUCTION (effect-handler-attack.c:1169) */
  [EF.DESTRUCTION, handleDESTRUCTION],
  [EF.EARTHQUAKE, handleEARTHQUAKE],
]);

/**
 * Register the terrain-shaping handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each
 * handler reads its game environment from context.env.game (attach it with
 * attachGameEnv) and no-ops when it is absent.
 */
export function registerTerrainHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of TERRAIN_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The terrain EF codes this module registers. */
export const TERRAIN_HANDLER_CODES: readonly number[] = [
  ...TERRAIN_HANDLERS.keys(),
];
