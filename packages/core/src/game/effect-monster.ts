/**
 * Monster-targeting general effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_WAKE (L2205),
 * EF_BANISH (L2337) and EF_MASS_BANISH (L2401), plus the monster self-heal
 * family from effect-handler-attack.c: EF_MON_HEAL_HP (L254) and
 * EF_MON_HEAL_KIN (L311, healing a nearby injured same-base monster found
 * by choose_nearby_injured_kin's reservoir sample). Each touches the live
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

import { EF, MON_TMD, TMD } from "../generated";
import { distance, loc, locEq } from "../loc";
import { monsterIsUnique, monsterIsVisible } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { MON_TMD_FLG_NOMESSAGE, monClearTimed } from "../mon/timed";
import type { Monster } from "../mon/monster";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter";
import { effectCalculateValue } from "../effects/interpreter";
import {
  playerApplyDamageReduction,
  takeHit,
} from "../player/take-hit";
import { los } from "../world/view";
import { deleteMonster, monsterMax } from "./context";
import type { GameState } from "./context";
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

/**
 * The shared heal-a-monster body of MON_HEAL_HP / MON_HEAL_KIN
 * (effect-handler-attack.c L254/L311): heal, message by visibility (the
 * MDESC name rides the display layer; the race name stands in), and cancel
 * fear.
 */
function healMonster(
  ctx: EffectHandlerContext,
  env: GameEffectEnv,
  mon: Monster,
  amount: number,
): void {
  const { state } = env;
  const blind = (env.cast.playerActor.timed[TMD.BLIND] ?? 0) > 0;
  const seen = !blind && monsterIsVisible(mon);
  const name = mon.race.name;

  /* Heal some */
  mon.hp += amount;

  if (mon.hp >= mon.maxhp) {
    mon.hp = mon.maxhp;
    ctx.env.messages?.msg(
      seen ? `${name} looks REALLY healthy!` : `${name} sounds REALLY healthy!`,
    );
  } else {
    ctx.env.messages?.msg(
      seen ? `${name} looks healthier.` : `${name} sounds healthier.`,
    );
  }

  /* Cancel fear */
  if ((mon.mTimed[MON_TMD.FEAR] ?? 0) > 0) {
    monClearTimed(state.rng, mon, MON_TMD.FEAR, MON_TMD_FLG_NOMESSAGE);
    ctx.env.messages?.msg(`${name} recovers its courage.`);
  }

  ctx.ident = true;
}

/** EF_MON_HEAL_HP: the casting monster heals itself. */
const handleMON_HEAL_HP: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  if (ctx.origin.what !== "monster") return true;
  const mon = env.state.monsters[ctx.origin.monster];
  if (!mon) return true;
  healMonster(ctx, env, mon, effectCalculateValue(ctx, false));
  return true;
};

/**
 * choose_nearby_injured_kin (mon-util.c L907): one injured same-base monster
 * in LOS within MAX_KIN_RADIUS/DISTANCE (both 5) of the caster, chosen by
 * reservoir sampling with k = 1 (RNG draws as upstream).
 */
function chooseNearbyInjuredKin(
  state: GameState,
  mon: Monster,
): Monster | null {
  const KIN_RANGE = 5; /* MAX_KIN_RADIUS == MAX_KIN_DISTANCE == 5 */
  let nseen = 0;
  let found: Monster | null = null;

  for (let y = mon.grid.y - KIN_RANGE; y <= mon.grid.y + KIN_RANGE; y++) {
    for (let x = mon.grid.x - KIN_RANGE; x <= mon.grid.x + KIN_RANGE; x++) {
      const grid = loc(x, y);
      /* get_injured_kin: not itself, same base, LOS, injured, in range. */
      if (!state.chunk.inBounds(grid)) continue;
      if (locEq(grid, mon.grid)) continue;
      const midx = state.chunk.mon(grid);
      if (midx <= 0) continue;
      const kin = state.monsters[midx];
      if (!kin) continue;
      if (kin.race.base !== mon.race.base) continue;
      if (!los(state.chunk, mon.grid, grid)) continue;
      if (kin.hp === kin.maxhp) continue;
      if (distance(mon.grid, grid) > KIN_RANGE) continue;

      nseen++;
      if (state.rng.randint0(nseen) === 0) found = kin;
    }
  }
  return found;
}

/** EF_MON_HEAL_KIN: the casting monster heals a nearby injured kin. */
const handleMON_HEAL_KIN: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  if (ctx.origin.what !== "monster") return true;
  const caster = env.state.monsters[ctx.origin.monster];
  if (!caster) return true;

  /* Find a nearby injured monster of the same base. */
  const kin = chooseNearbyInjuredKin(env.state, caster);
  if (!kin) return true;

  healMonster(ctx, env, kin, effectCalculateValue(ctx, false));
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
  [EF.MON_HEAL_HP, handleMON_HEAL_HP],
  [EF.MON_HEAL_KIN, handleMON_HEAL_KIN],
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
