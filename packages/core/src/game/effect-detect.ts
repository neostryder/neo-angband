/**
 * Detection and mapping effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_MAP_AREA
 * (L1201), EF_READ_MINDS (L1286), EF_DETECT_TRAPS (L1321), EF_DETECT_DOORS
 * (L1398), EF_DETECT_STAIRS (L1467), EF_DETECT_ORE (L1519), EF_SENSE_GOLD
 * (L1682) / EF_DETECT_GOLD (L1699), EF_SENSE_OBJECTS (L1725) /
 * EF_DETECT_OBJECTS (L1746), and the detect_monsters family (L1768):
 * EF_DETECT_LIVING_MONSTERS, EF_DETECT_VISIBLE_MONSTERS,
 * EF_DETECT_INVISIBLE_MONSTERS, EF_DETECT_FEARFUL_MONSTERS, EF_DETECT_EVIL
 * and EF_DETECT_SOUL.
 *
 * They write the player's map knowledge (game/known.ts) and the monster
 * MARK/SHOW display flags, so detection is visible wherever the renderer
 * draws from the knowledge layer. The detection rectangles keep the
 * upstream bounds exactly, including the terrain scans' exclusive upper
 * bounds (y < y2, x < x2 - the bottom/right edge is genuinely not scanned
 * upstream) against the object/monster scans' inclusive ones.
 *
 * Trap revealing and the secret-door lock roll reach the trap system
 * through the general env's trapDeps; without a trap system those parts
 * no-op. Chest-trap identification (obj->known pval) rides object
 * knowledge, the DTRAP border display and the item/monster list redraws
 * ride presentation (#25), and ignore_item_ok rides ignore (#24) - all
 * ledgered.
 */

import { EF, FEAT, MFLAG, SQUARE, TF } from "../generated";
import type { Loc } from "../loc";
import { loc } from "../loc";
import { DDGRID_DDD } from "../loc";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter";
import type { Monster } from "../mon/monster";
import {
  monsterIsCamouflaged,
  monsterIsEvil,
  monsterIsFearful,
  monsterHasSpirit,
  monsterIsInvisible,
  monsterIsLiving,
  monsterIsNotInvisible,
} from "../mon/predicate";
import { tvalIsMoney } from "../obj/object";
import type { GameObject } from "../obj/object";
import { monsterMax } from "./context";
import type { GameState } from "./context";
import { gameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import {
  squareForget,
  squareKnowPile,
  squareMemorize,
  squareMemoryBad,
  squareSensePile,
  knownFeat,
} from "./known";
import { squareRevealTrap, squareSetDoorLock } from "./trap";

/** The clamped detection rectangle around a centre. */
interface Bounds {
  y1: number;
  y2: number;
  x1: number;
  x2: number;
}

function bounds(state: GameState, centre: Loc, dy: number, dx: number): Bounds {
  const c = state.chunk;
  return {
    y1: Math.max(centre.y - dy, 0),
    y2: Math.min(centre.y + dy, c.height - 1),
    x1: Math.max(centre.x - dx, 0),
    x2: Math.min(centre.x + dx, c.width - 1),
  };
}

/** square_seemslikewall: rocky terrain (TF_ROCK). */
function seemsLikeWall(state: GameState, grid: Loc): boolean {
  return state.chunk.feature(grid).flags.has(TF.ROCK);
}

/**
 * The body of MAP_AREA around a centre (shared with READ_MINDS, which maps
 * around each detected monster).
 */
function mapArea(
  state: GameState,
  centre: Loc,
  distY: number,
  distX: number,
): void {
  const c = state.chunk;
  const b = bounds(state, centre, distY, distX);

  /* Scan the dungeon (exclusive upper bounds, as upstream). */
  for (let y = b.y1; y < b.y2; y++) {
    for (let x = b.x1; x < b.x2; x++) {
      const grid = loc(x, y);

      /* Some squares can't be mapped. */
      if (c.sqinfoHas(grid, SQUARE.NO_MAP)) continue;

      /* All non-walls are "checked". */
      if (!seemsLikeWall(state, grid)) {
        if (!c.inBoundsFully(grid)) continue;

        /* Memorize normal features. */
        if (!c.isFloor(grid)) squareMemorize(state, grid);

        /* Memorize known walls. */
        for (let i = 0; i < 8; i++) {
          const d = DDGRID_DDD[i] as Loc;
          const near = loc(x + d.x, y + d.y);
          if (c.inBounds(near) && seemsLikeWall(state, near)) {
            squareMemorize(state, near);
          }
        }
      }

      /* Forget misremembered grids in the mapping area. */
      if (squareMemoryBad(state, grid)) squareForget(state, grid);
    }
  }
}

/** context->y/x, defaulting to the value dice/sides (the area-size hack). */
function areaDists(ctx: EffectHandlerContext): { dy: number; dx: number } {
  return {
    dy: ctx.y ? ctx.y : ctx.value.dice,
    dx: ctx.x ? ctx.x : ctx.value.sides,
  };
}

/** EF_MAP_AREA: magically map the surroundings of the effect origin. */
const handleMAP_AREA: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const { dy, dx } = areaDists(ctx);

  /* origin_get_loc: a monster origin maps around the monster. */
  const centre =
    ctx.origin.what === "monster"
      ? (state.monsters[ctx.origin.monster]?.grid ?? state.actor.grid)
      : state.actor.grid;

  mapArea(state, centre, dy, dx);
  ctx.ident = true;
  return true;
};

/** EF_READ_MINDS: map an area around every detection-marked monster. */
const handleREAD_MINDS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const { dy, dx } = areaDists(ctx);
  let found = false;

  const max = monsterMax(state);
  for (let i = 1; i < max; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (mon.mflag.has(MFLAG.MARK)) {
      mapArea(state, mon.grid, dy, dx);
      found = true;
    }
  }

  if (found) {
    ctx.env.messages?.msg("Images form in your mind!");
    ctx.ident = true;
  }
  return true;
};

/** EF_DETECT_TRAPS: reveal traps and mark the region trap-detected. */
const handleDETECT_TRAPS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const b = bounds(state, state.actor.grid, ctx.y, ctx.x);
  const trapDeps = env.general?.trapDeps;
  let detect = false;

  for (let y = b.y1; y < b.y2; y++) {
    for (let x = b.x1; x < b.x2; x++) {
      const grid = loc(x, y);
      if (!state.chunk.inBoundsFully(grid)) continue;

      /* Reveal traps (chest-trap identification rides obj knowledge). */
      if (trapDeps && squareRevealTrap(state, grid, true, trapDeps)) {
        detect = true;
      }

      /* Mark as trap-detected. */
      state.chunk.sqinfoOn(grid, SQUARE.DTRAP);
    }
  }

  ctx.env.messages?.msg(
    detect ? "You sense the presence of traps!" : "You sense no traps.",
  );
  ctx.ident = true;
  return true;
};

/** EF_DETECT_DOORS: find secret doors, remember all doors in range. */
const handleDETECT_DOORS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const c = state.chunk;
  const b = bounds(state, state.actor.grid, ctx.y, ctx.x);
  const trapDeps = env.general?.trapDeps;
  let doors = false;

  for (let y = b.y1; y < b.y2; y++) {
    for (let x = b.x1; x < b.x2; x++) {
      const grid = loc(x, y);
      if (!c.inBoundsFully(grid)) continue;

      if (c.feat(grid) === FEAT.SECRET) {
        /* Detect secret doors: put an actual door (place_closed_door,
         * with its one-in-four lock roll when traps are live). */
        c.setFeat(grid, FEAT.CLOSED);
        if (trapDeps && state.rng.oneIn(4)) {
          squareSetDoorLock(state, grid, state.rng.randint1(7), trapDeps);
        }
        squareMemorize(state, grid);
        doors = true;
      } else if (c.isDoor(grid)) {
        /* Detect other types of doors. */
        if (squareMemoryBad(state, grid)) {
          squareMemorize(state, grid);
          doors = true;
        }
      } else {
        /* Forget misremembered doors in the mapping area. */
        const remembered = knownFeat(state, grid);
        if (
          remembered >= 0 &&
          c.features.get(remembered).flags.has(TF.DOOR_ANY) &&
          squareMemoryBad(state, grid)
        ) {
          squareForget(state, grid);
        }
      }
    }
  }

  if (doors) ctx.env.messages?.msg("You sense the presence of doors!");
  else if (ctx.aware) ctx.env.messages?.msg("You sense no doors.");
  ctx.ident = true;
  return true;
};

/** EF_DETECT_STAIRS: remember every staircase in range. */
const handleDETECT_STAIRS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const b = bounds(state, state.actor.grid, ctx.y, ctx.x);
  let stairs = false;

  for (let y = b.y1; y < b.y2; y++) {
    for (let x = b.x1; x < b.x2; x++) {
      const grid = loc(x, y);
      if (!state.chunk.inBoundsFully(grid)) continue;
      if (state.chunk.isStairs(grid)) {
        squareMemorize(state, grid);
        stairs = true;
      }
    }
  }

  if (stairs) ctx.env.messages?.msg("You sense the presence of stairs!");
  else if (ctx.aware) ctx.env.messages?.msg("You sense no stairs.");
  ctx.ident = true;
  return true;
};

/** square_hasgoldvein: mineral wall with treasure (TF_GOLD). */
function hasGoldVein(state: GameState, grid: Loc): boolean {
  return state.chunk.feature(grid).flags.has(TF.GOLD);
}

/** EF_DETECT_ORE: remember buried treasure veins in range. */
const handleDETECT_ORE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const b = bounds(state, state.actor.grid, ctx.y, ctx.x);
  let goldBuried = false;

  for (let y = b.y1; y < b.y2; y++) {
    for (let x = b.x1; x < b.x2; x++) {
      const grid = loc(x, y);
      if (!state.chunk.inBoundsFully(grid)) continue;

      if (hasGoldVein(state, grid)) {
        squareMemorize(state, grid);
        goldBuried = true;
      } else {
        /* Something removed previously seen or detected buried gold. */
        const remembered = knownFeat(state, grid);
        if (
          remembered >= 0 &&
          state.chunk.features.get(remembered).flags.has(TF.GOLD)
        ) {
          squareForget(state, grid);
        }
      }
    }
  }

  /* Message unless we're silently detecting. */
  if (ctx.origin.what !== "none") {
    if (goldBuried) {
      ctx.env.messages?.msg("You sense the presence of buried treasure!");
    } else if (ctx.aware) {
      ctx.env.messages?.msg("You sense no buried treasure.");
    }
  }
  ctx.ident = true;
  return true;
};

/**
 * sense_stuff / detect_stuff: walk the (inclusive) rectangle applying
 * squareSensePile / squareKnowPile, reporting whether anything matched.
 */
function stuff(
  env: GameEffectEnv,
  ctx: EffectHandlerContext,
  pred: (obj: GameObject) => boolean,
  know: boolean,
): boolean {
  const { state } = env;
  const b = bounds(state, state.actor.grid, ctx.y, ctx.x);
  let haveStuff = false;

  for (let y = b.y1; y <= b.y2; y++) {
    for (let x = b.x1; x <= b.x2; x++) {
      const grid = loc(x, y);
      const pile = state.floor.get(y * state.chunk.width + x);
      if (pile?.some(pred)) haveStuff = true;
      if (know) squareKnowPile(state, grid, pred);
      else squareSensePile(state, grid, pred);
    }
  }
  return haveStuff;
}

const isMoney = (obj: GameObject): boolean => tvalIsMoney(obj.tval);
const isNotMoney = (obj: GameObject): boolean => !tvalIsMoney(obj.tval);

/** EF_SENSE_GOLD: sense (without identifying) money on the floor. */
const handleSENSE_GOLD: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const money = stuff(env, ctx, isMoney, false);
  if (money) ctx.env.messages?.msg("You sense the presence of gold!");
  else if (ctx.aware) ctx.env.messages?.msg("You sense no gold.");
  ctx.ident = true;
  return true;
};

/** EF_DETECT_GOLD: detect money on the floor. */
const handleDETECT_GOLD: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const money = stuff(env, ctx, isMoney, true);
  if (money) ctx.env.messages?.msg("You detect the presence of gold!");
  else if (ctx.aware) ctx.env.messages?.msg("You detect no gold.");
  ctx.ident = true;
  return true;
};

/** EF_SENSE_OBJECTS: sense (without identifying) non-money objects. */
const handleSENSE_OBJECTS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const objects = stuff(env, ctx, isNotMoney, false);
  if (objects) ctx.env.messages?.msg("You sense the presence of objects!");
  else if (ctx.aware) ctx.env.messages?.msg("You sense no objects.");
  ctx.ident = true;
  return true;
};

/** EF_DETECT_OBJECTS: detect non-money objects. */
const handleDETECT_OBJECTS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const objects = stuff(env, ctx, isNotMoney, true);
  if (objects) ctx.env.messages?.msg("You detect the presence of objects!");
  else if (ctx.aware) ctx.env.messages?.msg("You detect no objects.");
  ctx.ident = true;
  return true;
};

/**
 * detect_monsters: mark every non-camouflaged monster in the rectangle
 * that satisfies the predicate (MARK + SHOW, displayed until the mark
 * fades). Invisible-monster lore learning rides lore (#24).
 */
function detectMonsters(
  state: GameState,
  yDist: number,
  xDist: number,
  pred: (mon: Monster) => boolean,
): boolean {
  const b = bounds(state, state.actor.grid, yDist, xDist);
  let monsters = false;

  const max = monsterMax(state);
  for (let i = 1; i < max; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    const { x, y } = mon.grid;
    if (x < b.x1 || y < b.y1 || x > b.x2 || y > b.y2) continue;

    if (pred(mon) && !monsterIsCamouflaged(mon)) {
      mon.mflag.on(MFLAG.MARK);
      mon.mflag.on(MFLAG.SHOW);
      mon.mflag.on(MFLAG.VISIBLE);
      monsters = true;
    }
  }
  return monsters;
}

function monsterDetector(
  pred: (mon: Monster) => boolean,
  foundMsg: string,
  noneMsg: string,
): EffectHandler {
  return (ctx) => {
    const env = gameEnv(ctx);
    if (!env) return true;
    const monsters = detectMonsters(env.state, ctx.y, ctx.x, pred);
    if (monsters) ctx.env.messages?.msg(foundMsg);
    else if (ctx.aware) ctx.env.messages?.msg(noneMsg);
    ctx.ident = true;
    return true;
  };
}

/** The detection handlers, keyed by upstream EF code. */
const DETECT_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.MAP_AREA, handleMAP_AREA],
  [EF.READ_MINDS, handleREAD_MINDS],
  [EF.DETECT_TRAPS, handleDETECT_TRAPS],
  [EF.DETECT_DOORS, handleDETECT_DOORS],
  [EF.DETECT_STAIRS, handleDETECT_STAIRS],
  [EF.DETECT_ORE, handleDETECT_ORE],
  [EF.SENSE_GOLD, handleSENSE_GOLD],
  [EF.DETECT_GOLD, handleDETECT_GOLD],
  [EF.SENSE_OBJECTS, handleSENSE_OBJECTS],
  [EF.DETECT_OBJECTS, handleDETECT_OBJECTS],
  [
    EF.DETECT_LIVING_MONSTERS,
    monsterDetector(monsterIsLiving, "You sense life!", "You sense no life."),
  ],
  [
    EF.DETECT_VISIBLE_MONSTERS,
    monsterDetector(
      monsterIsNotInvisible,
      "You sense the presence of monsters!",
      "You sense no monsters.",
    ),
  ],
  [
    EF.DETECT_INVISIBLE_MONSTERS,
    monsterDetector(
      monsterIsInvisible,
      "You sense the presence of invisible creatures!",
      "You sense no invisible creatures.",
    ),
  ],
  [
    EF.DETECT_FEARFUL_MONSTERS,
    monsterDetector(
      monsterIsFearful,
      "These monsters could provide good sport.",
      "You smell no fear in the air.",
    ),
  ],
  [
    EF.DETECT_EVIL,
    monsterDetector(
      monsterIsEvil,
      "You sense the presence of evil creatures!",
      "You sense no evil creatures.",
    ),
  ],
  [
    EF.DETECT_SOUL,
    monsterDetector(
      monsterHasSpirit,
      "You sense the presence of spirits!",
      "You sense no spirits.",
    ),
  ],
]);

/**
 * Register the detection/mapping handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers.
 */
export function registerDetectHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of DETECT_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The detection EF codes this module registers. */
export const DETECT_HANDLER_CODES: readonly number[] = [
  ...DETECT_HANDLERS.keys(),
];
