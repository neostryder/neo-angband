/**
 * The world-touching general effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_GLYPH (L700, a
 * glyph of warding or a decoy on the player's grid), EF_WEB (L732, a web
 * spinner filling its surroundings), and EF_DISENCHANT (L2003, disenchanting
 * a random piece of worn equipment). Like the other game-layer handlers they
 * read their environment from context.env.game and no-op when it is absent
 * (the worldless rule); GLYPH and WEB additionally need the trap system
 * (env.general.trapDeps) since glyphs and webs ARE trap kinds upstream.
 *
 * disenchantEquipment is exported separately: project-player.c's DISEN
 * handler applies the same disenchantment through effect_simple, so the
 * player side-effect table (game/player-side.ts) calls it directly.
 *
 * Simplifications, ledgered: the equipment letter in the disenchant message
 * (gear_to_label) and the ODESC_BASE description ride the display layer
 * (#25) - the kind's base name is used; obj->known->to_h/to_d/to_a display
 * sync likewise (knowledge is rune-based here). The decoy grid lives on
 * GameState.decoy; the monster-AI decoy targeting is deferred with lore
 * (#24).
 */

import { EF } from "../generated";
import { distance, loc } from "../loc";
import { GLYPH_DECOY } from "../effects/effect";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter";
import { objBaseName } from "../obj/knowledge";
import { featIsTrapHolding } from "../world/chunk";
import { lookupTrap } from "../world/trap";
import type { GameState } from "./context";
import { gameEnv } from "./effect-game-env";
import { floorPile } from "./floor";
import { pushObject } from "./project-feat";
import { placeTrap, squareIsTrap } from "./trap";
import type { TrapDeps } from "./trap";

/**
 * The general-handler seams, grouped on the game effect environment
 * (effect-game-env.ts GameEffectEnv.general). trapDeps backs glyph and web
 * creation; absent, those handlers no-op (the trap system is not wired).
 */
export interface GeneralEffectEnv {
  trapDeps?: TrapDeps;
}

/** msg() over the effect context's optional message sink. */
function say(ctx: EffectHandlerContext, text: string): void {
  ctx.env.messages?.msg(text);
}

/**
 * EF_GLYPH: create a glyph of warding (or a decoy) under the player.
 */
const handleGLYPH: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* Always notice */
  ctx.ident = true;

  /* Only one decoy at a time */
  if (state.decoy && ctx.subtype === GLYPH_DECOY) {
    say(ctx, "You can only deploy one decoy at a time.");
    return false;
  }

  /* See if the effect works */
  const grid = state.actor.grid;
  if (!featIsTrapHolding(state.chunk.features, state.chunk.feat(grid))) {
    say(ctx, "There is no clear floor on which to cast the spell.");
    return false;
  }

  const trapDeps = env.general?.trapDeps;
  if (!trapDeps) return true;

  /* Push objects off the grid */
  if (floorPile(state, grid).length > 0) pushObject(state, grid);

  /* Create a glyph (square_add_glyph: the glyph kinds are traps). */
  const kind = lookupTrap(
    trapDeps.kinds,
    ctx.subtype === GLYPH_DECOY ? "decoy" : "glyph of warding",
  );
  if (!kind) return true;
  placeTrap(state, grid, kind.tidx, 0, trapDeps);
  if (ctx.subtype === GLYPH_DECOY) state.decoy = grid;

  return true;
};

/**
 * EF_WEB: the acting monster spins webs over its surroundings.
 */
const handleWEB: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* Get the creating monster; the player can't currently create webs. */
  const midx = env.monCurrent ?? 0;
  const mon = midx > 0 ? state.monsters[midx] : null;
  if (!mon) return false;

  /* Always notice */
  ctx.ident = true;

  const trapDeps = env.general?.trapDeps;
  if (!trapDeps) return true;
  const web = lookupTrap(trapDeps.kinds, "web");
  if (!web) return true;

  /* Increase the radius for higher spell power */
  let rad = 1;
  if (mon.race.spellPower > 40) rad++;
  if (mon.race.spellPower > 80) rad++;

  /* Check within the radius for clear floor */
  for (let y = mon.grid.y - rad; y <= mon.grid.y + rad; y++) {
    for (let x = mon.grid.x - rad; x <= mon.grid.x + rad; x++) {
      const grid = loc(x, y);
      if (distance(grid, mon.grid) > rad || !state.chunk.inBoundsFully(grid))
        continue;

      /* square_iswebbable: a floor grid with no existing trap or glyph. */
      if (squareIsTrap(state, grid)) continue;
      if (!state.chunk.isFloor(grid)) continue;

      /* Create a web */
      placeTrap(state, grid, web.tidx, 0, trapDeps);
    }
  }

  return true;
};

/**
 * The EF_DISENCHANT body, shared with the PROJ_DISEN player side effect
 * (project-player.c dispatches it through effect_simple): pick a random
 * disenchantable equipment slot (not rings, amulets or lights), let
 * artifacts resist 60% of the time, and knock a point (sometimes two) off
 * the item's enchantment.
 */
export function disenchantEquipment(
  state: GameState,
  opts: { msg?: (text: string) => void } = {},
): void {
  const p = state.actor.player;
  const rng = state.rng;
  const skip = (i: number): boolean => {
    const type = p.body.slots[i]?.type;
    return type === "RING" || type === "AMULET" || type === "LIGHT";
  };

  /* Count disenchantable slots */
  let count = 0;
  for (let i = 0; i < p.body.count; i++) {
    if (skip(i)) continue;
    count++;
  }

  /* Pick one at random */
  let slot = -1;
  for (let i = p.body.count - 1; i >= 0; i--) {
    if (skip(i)) continue;
    slot = i;
    if (rng.oneIn(count--)) break;
  }
  if (slot < 0) return;

  /* Get the item; no item, nothing happens */
  const obj = state.runeEnv.slotObject(slot);
  if (!obj) return;

  /* Nothing to disenchant */
  if (obj.toH <= 0 && obj.toD <= 0 && obj.toA <= 0) return;

  const name = objBaseName(obj);

  /* Artifacts have a 60% chance to resist */
  if (obj.artifact && rng.randint0(100) < 60) {
    opts.msg?.(
      `Your ${name} resist${obj.number !== 1 ? "" : "s"} disenchantment!`,
    );
    return;
  }

  /* Apply disenchantment, depending on which kind of equipment */
  const type = p.body.slots[slot]?.type;
  if (type === "WEAPON" || type === "BOW") {
    /* Disenchant to-hit */
    if (obj.toH > 0) obj.toH--;
    if (obj.toH > 5 && rng.randint0(100) < 20) obj.toH--;

    /* Disenchant to-dam */
    if (obj.toD > 0) obj.toD--;
    if (obj.toD > 5 && rng.randint0(100) < 20) obj.toD--;
  } else {
    /* Disenchant to-ac */
    if (obj.toA > 0) obj.toA--;
    if (obj.toA > 5 && rng.randint0(100) < 20) obj.toA--;
  }

  opts.msg?.(
    `Your ${name} ${obj.number !== 1 ? "were" : "was"} disenchanted!`,
  );

  /* Recalculate bonuses (PU_BONUS) */
  state.updateBonuses?.();
}

/**
 * EF_DISENCHANT: apply disenchantment to the player's equipment.
 */
const handleDISENCHANT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;
  disenchantEquipment(env.state, {
    msg: (text): void => say(ctx, text),
  });
  return true;
};

/** The general handlers, keyed by upstream EF code. */
const GENERAL_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.GLYPH, handleGLYPH],
  [EF.WEB, handleWEB],
  [EF.DISENCHANT, handleDISENCHANT],
]);

/**
 * Register the general world-touching handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each
 * handler reads its game environment from context.env.game (attach it with
 * attachGameEnv) and no-ops when it is absent.
 */
export function registerGeneralHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of GENERAL_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The general EF codes this module registers. */
export const GENERAL_HANDLER_CODES: readonly number[] = [
  ...GENERAL_HANDLERS.keys(),
];
