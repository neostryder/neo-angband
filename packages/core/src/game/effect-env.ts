/**
 * The effect-interpreter environment adapters: build a live EffectContext
 * (effects/interpreter.ts) from the GameState so the already-ported general
 * effect handlers (effects/handlers.ts: EF_HEAL_HP, EF_CURE, the EF_TIMED_*
 * family, EF_NOURISH, EF_DAMAGE, ...) run end to end against a real player
 * instead of no-opping on an absent slot.
 *
 * These are the concrete backing for the narrow capability interfaces the
 * interpreter defines:
 * - TimedHost is backed by the player-timed runtime (player/timed.ts) over the
 *   bound timed-effect table, so grade transitions, messages, disturbance and
 *   the NONSTACKING guard behave identically to every other status change.
 * - EffectPlayer.hp is a live view of the player's hitpoints; takeHit and
 *   applyDamageReduction route through the shared player-damage primitive
 *   (player/take-hit.ts), the same one the projection player driver uses.
 *
 * The bound timed table (player/bind.ts) is passed in because GameState does
 * not carry it; the same is true of the food value, depth, damage reduction
 * and player_inc_check queries (all calc_bonuses / pack state that lives
 * outside the turn-loop state). A caller that supplies no incQueries lets every
 * timed increase through, matching a bare resistance-less player.
 */

import type { GameEvents } from "../events";
import type {
  EffectContext,
  EffectMessages,
  EffectPlayer,
  HasHp,
  TimedHost,
} from "../effects/interpreter";
import {
  playerClearTimed,
  playerDecTimed,
  playerIncCheck,
  playerIncTimed,
  playerSetTimed,
} from "../player/timed";
import type {
  PlayerIncCheckQueries,
  PlayerTimedHooks,
} from "../player/timed";
import {
  playerApplyDamageReduction,
  takeHit,
} from "../player/take-hit";
import type {
  DamageReduction,
  TakeHitHooks,
  TakeHitTarget,
} from "../player/take-hit";
import type { TimedEffect } from "../player/types";
import { DEFAULT_HITPOINT_WARN } from "./project-cast";
import type { GameState } from "./context";

/** What the effect-environment adapters need beyond the GameState. */
export interface EffectEnvDeps {
  /** The bound player timed-effect table (player/bind.ts), any order. */
  timedTable: readonly TimedEffect[];
  /** msg(): status / damage messages. */
  onMessage?: (text: string) => void;
  /** GameEvents bus, if the caller wires effect events. */
  events?: GameEvents;
  /** z_info->food_value; defaults to state.z.foodValue. */
  foodValue?: number;
  /** Dungeon depth, for handlers/expressions that read it. */
  level?: number;
  /** OPT(player, show_damage). */
  showDamage?: boolean;
  /** player_inc_check resolvers; when absent every increase is allowed. */
  incQueries?: PlayerIncCheckQueries;
  /** Extra player-timed hooks (onNotify / onTransition). */
  timedHooks?: PlayerTimedHooks;
  /** take_hit consequences (onDeath, combatRegen, ...). */
  takeHitHooks?: TakeHitHooks;
  /** state.dam_red / perc_dam_red (calc_bonuses); default zero. */
  reduction?: DamageReduction;
}

/** A TakeHitTarget view whose chp / is_dead mutations write back to the state. */
function takeHitTarget(state: GameState): TakeHitTarget {
  const p = state.actor.player;
  return {
    get chp(): number {
      return p.chp;
    },
    set chp(v: number) {
      p.chp = v;
    },
    mhp: p.mhp,
    lev: p.lev,
    get isDead(): boolean {
      return state.isDead;
    },
    set isDead(v: boolean) {
      state.isDead = v;
    },
    timed: p.timed,
    hitpointWarn: DEFAULT_HITPOINT_WARN,
  };
}

/**
 * buildTimedHost: the interpreter's TimedHost over the live player, dispatching
 * through the player-timed runtime with the bound effect table (looked up by
 * the effect's index, so the table may be in any order).
 */
export function buildTimedHost(
  state: GameState,
  deps: EffectEnvDeps,
): TimedHost {
  const p = state.actor.player;
  const byIndex = new Map<number, TimedEffect>();
  for (const e of deps.timedTable) byIndex.set(e.index, e);

  const effect = (idx: number): TimedEffect => {
    const e = byIndex.get(idx);
    if (!e) throw new Error(`no bound timed effect for index ${idx}`);
    return e;
  };

  const hooks: PlayerTimedHooks = {
    ...(deps.onMessage ? { onMessage: (t: string) => deps.onMessage!(t) } : {}),
    ...(deps.timedHooks ?? {}),
    ...(deps.incQueries
      ? { incCheck: (idx: number) => playerIncCheck(effect(idx), deps.incQueries!) }
      : {}),
  };

  return {
    timed: (idx) => p.timed[idx] ?? 0,
    setTimed: (idx, v, notify, canDisturb) =>
      playerSetTimed(p, effect(idx), v, notify, canDisturb, hooks),
    incTimed: (idx, v, notify, canDisturb, check) =>
      playerIncTimed(p, effect(idx), v, notify, canDisturb, check, hooks),
    decTimed: (idx, v, notify, canDisturb) =>
      playerDecTimed(p, effect(idx), v, notify, canDisturb, hooks),
    clearTimed: (idx, notify, canDisturb) =>
      playerClearTimed(p, effect(idx), notify, canDisturb, hooks),
  };
}

/**
 * buildEffectPlayer: the interpreter's EffectPlayer slot over the live player -
 * a live hitpoint view, the timed host, and take_hit / damage-reduction routed
 * through the shared player-damage primitive.
 */
export function buildEffectPlayer(
  state: GameState,
  deps: EffectEnvDeps,
): EffectPlayer {
  const p = state.actor.player;
  const target = takeHitTarget(state);
  const reduction = deps.reduction ?? { damRed: 0, percDamRed: 0 };

  const hp: HasHp = {
    get chp(): number {
      return p.chp;
    },
    set chp(v: number) {
      p.chp = v;
    },
    get mhp(): number {
      return p.mhp;
    },
    set mhp(v: number) {
      p.mhp = v;
    },
    get chpFrac(): number {
      return p.chpFrac;
    },
    set chpFrac(v: number) {
      p.chpFrac = v;
    },
  };

  return {
    hp,
    timed: buildTimedHost(state, deps),
    applyDamageReduction: (dam) =>
      playerApplyDamageReduction(target, reduction, dam),
    takeHit: (dam, killer) => takeHit(target, dam, killer, deps.takeHitHooks),
  };
}

/**
 * buildEffectContext: a full EffectContext for effect_do / effect_simple, built
 * from the live GameState. rng comes from the state; the player slot and food
 * value are populated so the general handlers act for real.
 */
export function buildEffectContext(
  state: GameState,
  deps: EffectEnvDeps,
): EffectContext {
  const messages: EffectMessages | undefined = deps.onMessage
    ? { msg: deps.onMessage }
    : undefined;

  return {
    rng: state.rng,
    ...(messages ? { messages } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    player: buildEffectPlayer(state, deps),
    foodValue: deps.foodValue ?? state.z.foodValue,
    ...(deps.level !== undefined ? { level: deps.level } : {}),
    ...(deps.showDamage !== undefined ? { showDamage: deps.showDamage } : {}),
  };
}
