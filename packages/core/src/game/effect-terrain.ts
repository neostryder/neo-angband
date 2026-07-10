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
 * light_room / wiz_light are ported here (cave-map.c) reduced to their world
 * halves: the SQUARE_GLOW changes, the room flood, and the illumination
 * wake-up rolls. The player square-memory half (square_memorize / mark /
 * know_pile / forget) rides the map-memory layer (#24/#25) - the core keeps
 * no player square memory yet (the web renderer holds its own explored set).
 *
 * Like the other game-layer handlers these read their environment from
 * context.env.game and no-op when it is absent (the worldless rule).
 *
 * Simplifications, ledgered in parity/ledger/game-effect-terrain.yaml:
 * - No town or arena (depth 0 short-circuits like the town branch), no
 *   birth_levels_persist / show_damage options (#30).
 * - expose_to_sun on the surface rides the day-night cycle.
 * - Artifact created-mark preservation in DESTRUCTION rides artifact
 *   upkeep (#24); EARTHQUAKE's square_changeable artifact check is ported.
 * - MDESC monster names and MON_MSG grammar ride the display layer (#25);
 *   the race name stands in for the quake messages.
 * - DARKEN_AREA's monster-target (#19) and decoy (#24) branches.
 */

import { ELEM, FEAT, EF, MON_TMD, RF, SQUARE, TF, TMD } from "../generated";
import type { Loc } from "../loc";
import { DDGRID_DDD, distance, loc, locEq, locSum } from "../loc";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
  Source,
} from "../effects/interpreter";
import { monsterIsSmart, monsterIsStupid, monsterIsVisible } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { equipLearnElement } from "../obj/knowledge";
import { featIsBright } from "../world/chunk";
import type { GameState } from "./context";
import {
  deleteMonster,
  monsterSwap,
  movePlayer,
  squareIsEmpty,
  squareMonster,
} from "./context";
import { gameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { floorExcise, floorPile } from "./floor";
import { forgetMap, squareKnowPile, squareMemorize } from "./known";
import { pushObject } from "./project-feat";
import { squareIsWarded } from "./trap";

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
 * wiz_light / wiz_dark (cave-map.c L417 / L488): perma-light (or darken)
 * the neighbourhood of every grid that does not seem like a wall (TF_ROCK).
 * Lighting also memorizes the level (the clairvoyance half: terrain and
 * floor piles); darkening forgets the whole remembered map.
 */
export function wizLightLevel(state: GameState, lit: boolean): void {
  const c = state.chunk;
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const grid = loc(x, y);
      /* Process all non-walls (square_seemslikewall). */
      if (c.feature(grid).flags.has(TF.ROCK)) continue;
      if (!c.inBoundsFully(grid)) continue;
      /* Scan all neighbors (ddgrid_ddd[8] is the grid itself). */
      for (let i = 0; i < 9; i++) {
        const a = locSum(grid, DDGRID_DDD[i]!);
        if (lit) {
          c.sqinfoOn(a, SQUARE.GLOW);
          squareMemorize(state, a);
        } else {
          c.sqinfoOff(a, SQUARE.GLOW);
        }
      }
      if (lit) squareKnowPile(state, grid);
    }
  }
  if (!lit) forgetMap(state);
  state.updateFov?.(state);
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
    if (c.inBounds(grid) && squareIsEmpty(state, grid)) openGrids++;
  }
  if (rubbleGrids > openGrids) rubbleGrids = openGrids;

  /* Avoid infinite loops */
  let iterations = 0;
  while (rubbleGrids > 0 && iterations < 10) {
    /* Look around the player */
    for (let d = 0; d < 8; d++) {
      const grid = locSum(pgrid, DDGRID_DDD[d]!);
      if (!c.inBoundsFully(grid)) continue;
      if (!squareIsEmpty(state, grid)) continue;

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

  /* Only allow stairs to be created on empty floor. */
  if (!state.chunk.isFloor(grid)) {
    say(ctx, "There is no empty floor here.");
    return false;
  }

  /* birth_levels_persist (#30) and arenas are not modelled. */

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
  if (ctx.value.base) {
    say(ctx, "An image of your surroundings forms in your mind...");
  }
  wizLightLevel(env.state, true);
  ctx.ident = true;
  return true;
};

/**
 * EF_DARKEN_LEVEL: darken the whole level (wiz_dark).
 */
const handleDARKEN_LEVEL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  if (ctx.value.base) {
    say(ctx, "A great blackness rolls through the dungeon...");
  }
  wizLightLevel(env.state, false);
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
 * EF_DARKEN_AREA: darken the room around the player. The monster-target
 * (#19) and decoy (#24) branches are deferred with their subsystems; the
 * player-cast form blinds an unresisting caster.
 */
const handleDARKEN_AREA: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const target = state.actor.grid;

  if (!((state.actor.player.timed[TMD.BLIND] ?? 0) > 0)) {
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

  /* Assume seen */
  ctx.ident = true;
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

  /* No effect in town (arenas are not modelled). */
  if (c.depth === 0) {
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

      /* Forget completely (square_forget rides map memory, #25). */
      if (!featIsBright(c.features, c.feat(grid))) {
        c.sqinfoOff(grid, SQUARE.GLOW);
      }
      c.sqinfoOff(grid, SQUARE.SEEN);

      /* Deal with player later */
      if (locEq(grid, pgrid)) continue;

      /* Delete the monster (if any) */
      const midx = c.mon(grid);
      if (midx > 0) deleteMonster(state, midx);

      /* Don't remove stairs */
      if (c.isStairs(grid)) continue;

      /* Destroy any grid that isn't a permanent wall */
      if (!c.isPerm(grid)) {
        /* Artifact created-mark preservation rides artifact upkeep (#24). */
        for (const obj of [...floorPile(state, grid)]) {
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

  if (c.depth > 0) {
    say(ctx, "The ground shakes! The ceiling caves in!");
  } else {
    /* No effect in town (arenas are not modelled). */
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
          if (!squareIsEmpty(state, safe)) continue;
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

      if (mon.hp < 0) {
        /* MON_MSG_QUAKE_DEATH; the race name stands in for MDESC (#25). */
        if (monsterIsVisible(mon)) {
          say(ctx, `${mon.race.name} is embedded in rock!`);
        }
        /* Delete (not kill) "dead" monsters. */
        deleteMonster(state, mon.midx);
      } else {
        if (monsterIsVisible(mon)) {
          say(ctx, `${mon.race.name} wails out in pain!`);
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
  [EF.CREATE_STAIRS, handleCREATE_STAIRS],
  [EF.LIGHT_LEVEL, handleLIGHT_LEVEL],
  [EF.DARKEN_LEVEL, handleDARKEN_LEVEL],
  [EF.LIGHT_AREA, handleLIGHT_AREA],
  [EF.DARKEN_AREA, handleDARKEN_AREA],
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
