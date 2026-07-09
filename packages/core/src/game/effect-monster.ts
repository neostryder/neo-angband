/**
 * Monster-targeting general effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_WAKE (L2205),
 * EF_BANISH (L2337) and EF_MASS_BANISH (L2401). Each iterates the live
 * monsters, so like the attack handlers they live in game/ and are registered
 * into the EffectRegistry from here (registerMonsterHandlers), overriding the
 * NOT_IMPLEMENTED stubs. They read their game environment from
 * context.env.game (effect-game-env.ts) and no-op when it is absent.
 *
 * All the primitives they need are already ported: monster iteration and
 * removal (game/context.ts monsterMax / deleteMonster), waking (mon/take-hit.ts
 * monsterWake), the uniqueness test (mon/predicate.ts monsterIsUnique) and the
 * shared player-damage primitive (player/take-hit.ts). The banish symbol prompt
 * (get_com) is an injected chooser on the game env; absent, EF_BANISH aborts,
 * mirroring a cancelled prompt. The arena-level guard is omitted (arenas are
 * not modelled).
 */

import { EF } from "../generated";
import { distance } from "../loc";
import { monsterIsUnique } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter";
import {
  playerApplyDamageReduction,
  takeHit,
} from "../player/take-hit";
import { deleteMonster, monsterMax } from "./context";
import { gameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";

/** take_hit through the player-projection actor, with the show-damage message. */
function hurtPlayer(
  ctx: EffectHandlerContext,
  env: GameEffectEnv,
  dam: number,
  killer: string,
): void {
  const actor = env.cast.playerActor;
  const reduced = playerApplyDamageReduction(actor, actor.reduction, dam);
  if (reduced > 0 && ctx.env.showDamage) {
    ctx.env.messages?.msg(`You take ${reduced} damage.`);
  }
  takeHit(actor, reduced, killer, env.takeHitHooks);
}

/** EF_WAKE: wake every sleeping monster near the effect origin. */
const handleWAKE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* origin_get_loc: a monster source wakes from its own grid. */
  const origin =
    ctx.origin.what === "monster"
      ? (state.monsters[ctx.origin.monster]?.grid ?? state.actor.grid)
      : state.actor.grid;

  const radius = state.z.maxSight * 2;
  let woken = false;
  const max = monsterMax(state);
  for (let i = 1; i < max; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    const dist = distance(origin, mon.grid);
    if (dist < radius && mon.mTimed[0]! > 0) {
      /* MON_TMD.SLEEP: closer means likelier to become aware. */
      monsterWake(state.rng, mon, false, 100 - 2 * dist);
      woken = true;
    }
  }

  if (woken) ctx.env.messages?.msg("You hear a sudden stirring in the distance!");
  ctx.ident = true;
  return true;
};

/**
 * EF_BANISH: delete all non-unique monsters whose display glyph matches a
 * player-chosen symbol, costing the player 1d4 hitpoints per monster. Returns
 * false (aborting the effect) when no symbol is chosen.
 */
const handleBANISH: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;

  const typ = env.banishSymbol ? env.banishSymbol() : null;
  if (typ === null) return false;

  const { state } = env;
  let dam = 0;
  const max = monsterMax(state);
  for (let i = 1; i < max; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (monsterIsUnique(mon)) continue;
    /* Shape-shifters banish by their original race's glyph. */
    const glyph = (mon.originalRace ?? mon.race).dChar;
    if (glyph !== typ) continue;
    deleteMonster(state, i);
    dam += state.rng.randint1(4);
  }

  hurtPlayer(ctx, env, dam, "the strain of casting Banishment");
  return true;
};

/**
 * EF_MASS_BANISH: delete all nearby non-unique monsters (within context->radius,
 * else the player's sight radius), costing the player 1d3 hitpoints per monster.
 */
const handleMASS_BANISH: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;

  const { state } = env;
  const radius = ctx.radius ? ctx.radius : state.z.maxSight;
  let dam = 0;
  const max = monsterMax(state);
  for (let i = 1; i < max; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (monsterIsUnique(mon)) continue;
    if (mon.cdis > radius) continue;
    deleteMonster(state, i);
    dam += state.rng.randint1(3);
  }

  hurtPlayer(ctx, env, dam, "the strain of casting Mass Banishment");
  return true;
};

/** The monster-effect handlers, keyed by upstream EF code. */
const MONSTER_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.WAKE, handleWAKE],
  [EF.BANISH, handleBANISH],
  [EF.MASS_BANISH, handleMASS_BANISH],
]);

/**
 * Register the monster-targeting general effect handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers.
 */
export function registerMonsterHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of MONSTER_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The monster-effect EF codes this module registers. */
export const MONSTER_HANDLER_CODES: readonly number[] = [
  ...MONSTER_HANDLERS.keys(),
];
