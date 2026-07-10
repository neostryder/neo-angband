/**
 * The project_p driver, ported from reference/src/project-player.c (Angband
 * 4.2.6): project_p (L800). The player-side counterpart of project_m.
 *
 * It applies a projection's damage to the player: resolve seen/blind, adjust
 * the damage for resistance / immunity / vulnerability (adjust_dam), scale
 * self-inflicted damage, apply the player's damage reduction, and deal it with
 * take_hit - then run the per-type side effects and any extra damage they add.
 * It implements the onPlayer seam of project() (world/project.ts).
 *
 * The damage core is fully portable (adjust_dam, player_apply_damage_reduction
 * and take_hit are ported). The per-PROJ-type side effects
 * (project_player_handler_*) are heavily entangled with subsystems not yet
 * modelled - inven_damage (inventory, #20), EF_DRAIN_STAT (#18), player_exp_lose
 * (experience) - so they are injected as the onSideEffects hook, the same seam
 * discipline as the project_m driver's deferred consequences. The killer name
 * (monster_desc / trap name / "yourself") is resolved by the caller, since it
 * needs the monster-description and trap systems.
 */

import { PROJ, TMD } from "../generated";
import { locEq } from "../loc";
import type { Loc } from "../loc";
import type { Rng } from "../rng";
import { ELEM_MAX } from "../obj/types";
import {
  playerApplyDamageReduction,
  takeHit,
} from "../player/take-hit";
import type {
  DamageReduction,
  TakeHitHooks,
  TakeHitTarget,
} from "../player/take-hit";
import { adjustDam } from "../world/projection";
import type { ProjectionInfo } from "../world/projection";

/** The player state project_p reads and damages. */
export interface PlayerProjActor extends TakeHitTarget {
  /** el_info[type].res_level (3 immune, -1 vulnerable, >0 resist). */
  resistLevel(type: number): number;
  /** state.dam_red / state.perc_dam_red. */
  reduction: DamageReduction;
  /** minus_ac(p): whether acid damage is halved by damageable armour. */
  minusAc: boolean;
}

/** The projection source, resolved for the player driver. */
export interface ProjectPlayerSource {
  /** origin.what == SRC_PLAYER. */
  isPlayer: boolean;
  /** origin.what == SRC_MONSTER. */
  isMonster: boolean;
  /** Whether the source monster is visible (false hides the source). */
  monsterVisible?: boolean;
  /** The kb_str death cause ("yourself", a monster/trap name, "a bug"). */
  killer: string;
  /** origin_get_loc(origin): the projection's start grid (FORCE centre). */
  grid?: Loc;
  /** origin.what == SRC_TRAP (FORCE jitters an on-the-trap centre). */
  isTrap?: boolean;
}

/** Context passed to the per-type side-effect hook (upstream handler context). */
export interface ProjectPlayerSideContext {
  origin: ProjectPlayerSource;
  /** Distance from the blast centre. */
  r: number;
  grid: Loc;
  /** The adjusted (and self-scaled) damage the handler may key effects off. */
  dam: number;
  typ: number;
  /** Monster spell power (0 for non-monster sources). */
  power: number;
  /** Mutable: the handler clears it if the effect was not obvious. */
  obvious: boolean;
}

/** The consequences the driver defers to the caller. */
export interface ProjectPlayerHooks {
  /** msg(). */
  message?: (text: string) => void;
  /** disturb(p). */
  onDisturb?: () => void;
  /**
   * The per-PROJ-type player handler: inven damage, timed effects, stat / exp
   * drain, etc. Returns extra damage to apply (after damage reduction).
   */
  onSideEffects?: (ctx: ProjectPlayerSideContext) => number;
  /** take_hit consequences (onDeath, combatRegen, ...). */
  takeHit?: TakeHitHooks;
  /** OPT(player, show_damage). */
  showDamage?: boolean;
}

/** Everything the per-grid player driver needs. */
export interface ProjectPlayerCtx {
  rng: Rng;
  actor: PlayerProjActor;
  /** The player's grid (square_isplayer check). */
  playerGrid: Loc;
  projections: readonly ProjectionInfo[];
  origin: ProjectPlayerSource;
  /** Monster spell power, passed to the side-effect handler. */
  power: number;
  hooks: ProjectPlayerHooks;
}

/**
 * project_p for one grid: affect the player (if they are in `grid`) with
 * projection `typ` for `dam` damage at distance `dist`. `self` allows the
 * caster to be hit by their own projection (self damage is scaled down).
 * Returns whether the effect was obvious. Suitable as the onPlayer hook of
 * project().
 */
export function projectPlayer(
  pctx: ProjectPlayerCtx,
  dist: number,
  grid: Loc,
  dam: number,
  typ: number,
  self: boolean,
): boolean {
  const { rng, actor, hooks, origin } = pctx;

  const blind = actor.timed[TMD.BLIND]! > 0;
  let seen = !blind;

  /* No player here. */
  if (!locEq(grid, pctx.playerGrid)) return false;

  /* Don't affect the projector unless explicitly allowed. */
  if (origin.isPlayer && !self) return false;

  /* A projection from an unseen monster is not seen. */
  if (origin.isMonster && origin.monsterVisible === false) seen = false;

  /* Let the player know what is going on when they cannot see it. */
  if (!seen) {
    const bd = pctx.projections[typ]?.blindDesc ?? "something";
    hooks.message?.(`You are hit by ${bd}!`);
  }

  /* Adjust damage for resistance/immunity/vulnerability (ICE uses COLD res). */
  const resType = typ === PROJ.ICE ? PROJ.COLD : typ;
  const resLevel = typ < ELEM_MAX ? actor.resistLevel(resType) : 0;
  let d = adjustDam(
    rng,
    pctx.projections,
    typ,
    dam,
    "randomise",
    resLevel,
    actor.minusAc,
  );

  if (d) {
    /* Self-inflicted damage is scaled down. */
    if (self) d = Math.trunc(d / 10);

    /* Damage reduction affects only the dealt damage, not the side effects. */
    const reduced = playerApplyDamageReduction(actor, actor.reduction, d);
    if (reduced > 0 && hooks.showDamage) {
      hooks.message?.(`You take ${reduced} damage.`);
    }
    takeHit(actor, reduced, origin.killer, hooks.takeHit);
  }

  /* Handle side effects, possibly including extra damage. */
  const sideCtx: ProjectPlayerSideContext = {
    origin,
    r: dist,
    grid,
    dam: d,
    typ,
    power: pctx.power,
    obvious: true,
  };
  if (!actor.isDead && hooks.onSideEffects) {
    let xtra = hooks.onSideEffects(sideCtx);
    xtra = playerApplyDamageReduction(actor, actor.reduction, xtra);
    if (xtra > 0 && hooks.showDamage) {
      hooks.message?.(`You take an extra ${xtra} damage.`);
    }
    takeHit(actor, xtra, origin.killer, hooks.takeHit);
  }

  /* Disturb */
  hooks.onDisturb?.();

  return sideCtx.obvious;
}
