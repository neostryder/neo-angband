/**
 * EF_SUMMON, ported from reference/src/effect-handler-general.c
 * effect_handler_SUMMON (L2241, Angband 4.2.6), over the live summoning
 * engine (game/mon-place.ts summonSpecific and the mon/summon.ts table).
 *
 * A monster-origin summon keeps calling until the summoned levels' squares
 * pass depth * rlev or the attempts run out, falling back to the type's
 * fallback on total failure ("But nothing comes." when even that fails); a
 * player-origin summon (scroll / staff / trap) simply rolls `value` times,
 * delayed so the player acts first, each with a 1-in-4 chance of calling an
 * off-screen monster instead of creating one. The blind player hears
 * something (or many things) appear nearby.
 *
 * Like the other game-layer handlers it reads context.env.game and no-ops
 * without it; it additionally needs the summon seam (GameEffectEnv.summon)
 * for the bound table and allocation deps, without which it also no-ops.
 * The arena-level guard is omitted (arenas are not modelled); sound(msgt)
 * rides the sound system (#26).
 */

import { EF, TMD } from "../generated";
import type {
  EffectHandler,
  EffectRegistry,
} from "../effects/interpreter";
import { effectCalculateValue } from "../effects/interpreter";
import type { SummonTable } from "../mon/summon";
import { summonSpecific } from "./mon-place";
import type { MonPlaceDeps, SummonDeps } from "./mon-place";
import { gameEnv } from "./effect-game-env";

/** The summoning seam on the game effect environment. */
export interface SummonEffectEnv {
  /** The bound summon table (mon/summon.ts). */
  summons: SummonTable;
  /** Live placement deps (allocation table, trap predicates, group caps). */
  place: MonPlaceDeps;
}

/** EF_SUMMON: summon context->value monsters of context->subtype type. */
const handleSUMMON: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const senv = env.summon;
  if (!senv) return true;
  const { state } = env;

  let summonMax = effectCalculateValue(ctx, false);
  const type = ctx.subtype;
  const levelBoost = ctx.other;
  const fallbackType = senv.summons.fallbackType(type);
  let count = 0;

  /* Monster summon. */
  if (ctx.origin.what === "monster") {
    const mon = state.monsters[ctx.origin.monster];
    if (!mon) return true;

    /* Set the kin_base if necessary. */
    const deps: SummonDeps = {
      ...senv.place,
      summons: senv.summons,
      monCurrent: ctx.origin.monster,
      kinBase:
        type === senv.summons.nameToIdx("KIN") ? mon.race.base : null,
    };

    /* Continue summoning until we reach the current dungeon level. */
    const rlev = mon.race.level;
    let val = 0;
    let attempts = 0;
    while (val < state.chunk.depth * rlev && attempts < summonMax) {
      /* Get a monster. */
      const temp = summonSpecific(
        state,
        mon.grid,
        rlev + levelBoost,
        type,
        false,
        false,
        deps,
      );
      val += temp * temp;

      /* Increase the attempt in case no monsters were available. */
      attempts++;

      /* Increase count of summoned monsters. */
      if (val > 0) count++;
    }

    /* If the summon failed and there's a fallback type, use that. */
    if (count === 0 && fallbackType >= 0) {
      attempts = 0;
      while (val < state.chunk.depth * rlev && attempts < summonMax) {
        const temp = summonSpecific(
          state,
          mon.grid,
          rlev + levelBoost,
          fallbackType,
          false,
          false,
          deps,
        );
        val += temp * temp;
        attempts++;
        if (val > 0) count++;
      }
    }

    /* Summoner failed. */
    if (!count) ctx.env.messages?.msg("But nothing comes.");
  } else {
    /* If not a monster summon, it's simple. */
    const deps: SummonDeps = { ...senv.place, summons: senv.summons };
    while (summonMax) {
      count += summonSpecific(
        state,
        state.actor.grid,
        state.chunk.depth + levelBoost,
        type,
        true,
        state.rng.oneIn(4),
        deps,
      );
      summonMax--;
    }
  }

  /* Identify. */
  ctx.ident = true;

  /* Message for the blind. */
  if (count && (env.cast.playerActor.timed[TMD.BLIND] ?? 0) > 0) {
    ctx.env.messages?.msg(
      `You hear ${count > 1 ? "many things" : "something"} appear nearby.`,
    );
  }

  return true;
};

/**
 * Register the summoning handler, overriding the stub registerCoreHandlers
 * installed. Call after registerCoreHandlers.
 */
export function registerSummonHandlers(registry: EffectRegistry): void {
  registry.register(EF.SUMMON, { handler: handleSUMMON, status: "implemented" });
}

/** The EF codes this module registers. */
export const SUMMON_HANDLER_CODES: readonly number[] = [EF.SUMMON];
