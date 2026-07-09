/**
 * Projection effects on monsters, ported from reference/src/project-mon.c
 * (Angband 4.2.6): the per-PROJ-type handler table and its resist / hurt /
 * status helpers.
 *
 * This module is the pure effect-computation core of project_m: given a monster
 * and a projection type, it accumulates the outcome into a context - the final
 * damage (after resistances and vulnerabilities), the timed effects to apply
 * (fear, stun, confusion, ...), a polymorph or teleport request, the hurt / die
 * messages, and whether the effect was obvious. It does NOT apply the damage,
 * move or kill the monster, or resolve polymorph / teleport; those belong to the
 * project_m driver (project_m_player_attack via mon_take_hit,
 * project_m_apply_side_effects) and land in the next increment, on top of this.
 *
 * Faithful seams for subsystems not yet modelled:
 * - Monster lore is deferred (see the port plan's late subsystems), so the
 *   rf_on(lore) / rsf_on(lore) learning is injected as learnRaceFlag /
 *   learnSpellFlag hooks. They fire on exactly the same "seen" condition as
 *   upstream, so wiring lore in later needs no change here.
 * - multiply_monster (PROJ_MON_CLONE) is a monster-placement routine; it is
 *   injected as the multiplyMonster hook.
 * - thrust_away (PROJ_FORCE) mutates the cave (monster_swap, feature checks); the
 *   handler only records the requested distance in context.thrustGridsAway and
 *   the driver performs the thrust.
 * - PR_HEALTH redraw (PROJ_MON_HEAL) is a UI concern; the "looks healthier"
 *   message branch is taken unconditionally, matching an untracked monster.
 */

import { MON_MSG, MON_TMD, PROJ, RF, RSF } from "../generated";
import type { Loc } from "../loc";
import type { Rng } from "../rng";
import type { Monster } from "./monster";
import {
  monsterHasNonInnateSpells,
  monsterIsLiving,
  monsterIsNonliving,
} from "./predicate";
import { monsterWake } from "./take-hit";
import { MON_TMD_FLG_NOTIFY, monIncTimed } from "./timed";
import type { MonTimedMessageSink } from "./timed";

/** The player-facing / world-mutating consequences the handlers defer. */
export interface MonProjectHooks {
  /** rf_on(lore->flags, flag): learn a race flag when the effect is seen. */
  learnRaceFlag?: (mon: Monster, flag: number) => void;
  /** rsf_on(lore->spell_flags, flag): learn a spell flag when seen. */
  learnSpellFlag?: (mon: Monster, flag: number) => void;
  /** multiply_monster: attempt to clone; returns true on a successful spawn. */
  multiplyMonster?: (mon: Monster) => boolean;
  /** Emit a monster message (only PROJ_MON_CLONE's haste notify reaches here). */
  onMessage?: MonTimedMessageSink;
}

/**
 * The accumulating state of a projection's effect on one monster - upstream's
 * project_monster_handler_context_t. Built by the driver per affected grid; the
 * handlers mutate it in place. `rng` and `hooks` are carried here so every
 * handler has a single, uniform signature.
 */
export interface MonProjectContext {
  rng: Rng;
  hooks: MonProjectHooks;
  /** origin.what == SRC_MONSTER: routes attack / thrust handling in the driver. */
  originIsMonster: boolean;
  /** Distance from the centre of the effect (adjust_radius uses it). */
  r: number;
  /** The grid the monster is in (used by the driver, not the handlers here). */
  grid: Loc;
  /** Current, mutable damage; distance-adjusted before it reaches here. */
  dam: number;
  /** PROJ_ projection type. */
  type: number;
  /** The monster being affected. */
  mon: Monster;
  /** Source is an extra-charming player (PF_CHARM): boosts effects vs animals. */
  charm: boolean;
  /** Whether the player can see the monster (drives lore learning + obvious). */
  seen: boolean;
  /** The effect was obvious to the player. */
  obvious: boolean;
  /** The handler chose to skip: no damage and no effect applied. */
  skipped: boolean;
  /** MON_TMD flag OR'd into every applied timer (upstream context->flag; 0). */
  flag: number;
  /** Polymorph "power" (0 = no polymorph); resolved by the driver. */
  doPoly: number;
  /** Teleport distance (0 = none); resolved by the driver. */
  teleportDistance: number;
  /** PROJ_FORCE thrust distance (0 = none); performed by the driver. */
  thrustGridsAway: number;
  /** Message shown when the monster is hurt but survives. */
  hurtMsg: number;
  /** Message shown when the monster dies. */
  dieMsg: number;
  /** Per-MON_TMD timer amounts to apply after damage (length MON_TMD.MAX). */
  monTimed: number[];
}

/** Options for newMonProjectContext; all optional with upstream-neutral defaults. */
export interface MonProjectContextOptions {
  originIsMonster?: boolean;
  r?: number;
  grid?: Loc;
  charm?: boolean;
  seen?: boolean;
  obvious?: boolean;
  hooks?: MonProjectHooks;
}

/**
 * Build a fresh handler context for a monster about to be hit by projection
 * `type` for `dam` damage, mirroring project_m's local initialisation.
 */
export function newMonProjectContext(
  rng: Rng,
  mon: Monster,
  type: number,
  dam: number,
  opts: MonProjectContextOptions = {},
): MonProjectContext {
  return {
    rng,
    hooks: opts.hooks ?? {},
    originIsMonster: opts.originIsMonster ?? false,
    r: opts.r ?? 0,
    grid: opts.grid ?? mon.grid,
    dam,
    type,
    mon,
    charm: opts.charm ?? false,
    seen: opts.seen ?? false,
    obvious: opts.obvious ?? false,
    skipped: false,
    flag: 0,
    doPoly: 0,
    teleportDistance: 0,
    thrustGridsAway: 0,
    hurtMsg: MON_MSG.NONE,
    dieMsg: MON_MSG.DIE,
    monTimed: new Array<number>(MON_TMD.MAX).fill(0),
  };
}

/** adjust_radius: reduce an amount by distance from the blast centre. */
function adjustRadius(ctx: MonProjectContext, amount: number): number {
  return Math.trunc((amount + ctx.r) / (ctx.r + 1));
}

/* ------------------------------------------------------------------ */
/* Resist / hurt helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * project_monster_resist_element: a monster with the given RF_ flag resists,
 * dividing damage by `factor`. Learns the flag if the effect is seen.
 */
function resistElement(
  ctx: MonProjectContext,
  flag: number,
  factor: number,
): void {
  if (ctx.seen) ctx.hooks.learnRaceFlag?.(ctx.mon, flag);
  if (ctx.mon.race.flags.has(flag)) {
    ctx.hurtMsg = MON_MSG.RESIST_A_LOT;
    ctx.dam = Math.trunc(ctx.dam / factor);
  }
}

/**
 * project_monster_resist_other: a monster with the given RF_ flag has its
 * damage multiplied by `factor` (a factor of 0 gives immunity) and, when
 * `reduce` is set, further reduced by a small random amount.
 */
function resistOther(
  ctx: MonProjectContext,
  flag: number,
  factor: number,
  reduce: boolean,
  msg: number,
): void {
  if (ctx.seen) ctx.hooks.learnRaceFlag?.(ctx.mon, flag);
  if (ctx.mon.race.flags.has(flag)) {
    ctx.hurtMsg = msg;
    ctx.dam *= factor;
    if (reduce) ctx.dam = Math.trunc(ctx.dam / (ctx.rng.randint1(6) + 6));
  }
}

/**
 * project_monster_hurt_immune: resist (divide by imm_factor) if the monster has
 * imm_flag, else take extra damage (multiply by hurt_factor) if it has
 * hurt_flag. Learns both flags if seen.
 */
function hurtImmune(
  ctx: MonProjectContext,
  hurtFlag: number,
  immFlag: number,
  hurtFactor: number,
  immFactor: number,
  hurtMsg: number,
  dieMsg: number,
): void {
  if (ctx.seen) {
    ctx.hooks.learnRaceFlag?.(ctx.mon, immFlag);
    ctx.hooks.learnRaceFlag?.(ctx.mon, hurtFlag);
  }

  if (ctx.mon.race.flags.has(immFlag)) {
    ctx.hurtMsg = MON_MSG.RESIST_A_LOT;
    ctx.dam = Math.trunc(ctx.dam / immFactor);
  } else if (ctx.mon.race.flags.has(hurtFlag)) {
    ctx.hurtMsg = hurtMsg;
    ctx.dieMsg = dieMsg;
    ctx.dam *= hurtFactor;
  }
}

/**
 * project_monster_hurt_only: the monster is only affected if it has the given
 * flag; otherwise the damage is zeroed. Learns the flag if seen.
 */
function hurtOnly(
  ctx: MonProjectContext,
  flag: number,
  hurtMsg: number,
  dieMsg: number,
): void {
  if (ctx.seen) ctx.hooks.learnRaceFlag?.(ctx.mon, flag);

  if (ctx.mon.race.flags.has(flag)) {
    ctx.hurtMsg = hurtMsg;
    ctx.dieMsg = dieMsg;
  } else {
    ctx.dam = 0;
  }
}

/**
 * project_monster_breath: a breather of the given RSF_ spell resists, its
 * damage multiplied by `factor` then reduced by a small random amount. Learns
 * the breath if seen.
 */
function breath(ctx: MonProjectContext, flag: number, factor: number): void {
  if (ctx.mon.race.spellFlags.has(flag)) {
    if (ctx.seen) ctx.hooks.learnSpellFlag?.(ctx.mon, flag);

    ctx.hurtMsg = MON_MSG.RESIST;
    ctx.dam *= factor;
    ctx.dam = Math.trunc(ctx.dam / (ctx.rng.randint1(6) + 6));
  }
}

/**
 * project_monster_teleport_away: teleport a monster that has the given flag
 * (using dam as the distance); otherwise the projection is skipped. No damage.
 */
function teleportAway(ctx: MonProjectContext, flag: number): void {
  if (ctx.seen) ctx.hooks.learnRaceFlag?.(ctx.mon, flag);

  if (ctx.mon.race.flags.has(flag)) {
    ctx.teleportDistance = ctx.dam;
    ctx.hurtMsg = MON_MSG.DISAPPEAR;
    monsterWake(ctx.rng, ctx.mon, false, 100);
    if (ctx.seen) ctx.obvious = true;
  } else {
    ctx.skipped = true;
  }

  ctx.dam = 0;
}

/**
 * project_monster_scare: frighten a monster that has the given flag (using dam
 * as the power); otherwise the projection is skipped. No damage.
 */
function scare(ctx: MonProjectContext, flag: number): void {
  if (ctx.seen) ctx.hooks.learnRaceFlag?.(ctx.mon, flag);

  if (ctx.mon.race.flags.has(flag)) {
    ctx.monTimed[MON_TMD.FEAR] = adjustRadius(ctx, ctx.dam);
    monsterWake(ctx.rng, ctx.mon, false, 100);
    if (ctx.seen) ctx.obvious = true;
  } else {
    ctx.skipped = true;
  }

  ctx.dam = 0;
}

/**
 * project_monster_dispel: a monster with the given flag takes the (already
 * computed) damage with dispel messaging; otherwise the projection is skipped.
 */
function dispel(ctx: MonProjectContext, flag: number): void {
  if (ctx.seen) ctx.hooks.learnRaceFlag?.(ctx.mon, flag);

  if (ctx.mon.race.flags.has(flag)) {
    ctx.hurtMsg = MON_MSG.SHUDDER;
    ctx.dieMsg = MON_MSG.DISSOLVE;
    if (ctx.seen) ctx.obvious = true;
  } else {
    ctx.skipped = true;
    ctx.dam = 0;
  }
}

/**
 * project_monster_sleep: put a monster to sleep. A non-zero flag restricts the
 * effect to monsters with that flag (RF_NONE = affect all). No damage.
 */
function sleep(ctx: MonProjectContext, flag: number): void {
  if (ctx.seen && flag) ctx.hooks.learnRaceFlag?.(ctx.mon, flag);

  if (flag && !ctx.mon.race.flags.has(flag)) {
    ctx.skipped = true;
    ctx.dam = 0;
  }

  if (ctx.charm && ctx.mon.race.flags.has(RF.ANIMAL)) {
    ctx.dam += Math.trunc(ctx.dam / 2);
  }
  ctx.monTimed[MON_TMD.SLEEP] = ctx.dam;
  if (ctx.dam > 0 && ctx.seen) ctx.obvious = true;
  ctx.dam = 0;
}

/** charm bonus vs animals, shared by the status projections that grant it. */
function charmAnimalBoost(ctx: MonProjectContext): void {
  if (ctx.charm && ctx.mon.race.flags.has(RF.ANIMAL)) {
    ctx.dam += Math.trunc(ctx.dam / 2);
  }
}

/* ------------------------------------------------------------------ */
/* Per-PROJ-type handlers                                              */
/* ------------------------------------------------------------------ */

type MonHandler = (ctx: MonProjectContext) => void;

/* Acid */
function hAcid(ctx: MonProjectContext): void {
  resistElement(ctx, RF.IM_ACID, 9);
}

/* Electricity */
function hElec(ctx: MonProjectContext): void {
  resistElement(ctx, RF.IM_ELEC, 9);
}

/* Fire damage */
function hFire(ctx: MonProjectContext): void {
  hurtImmune(
    ctx,
    RF.HURT_FIRE,
    RF.IM_FIRE,
    2,
    9,
    MON_MSG.CATCH_FIRE,
    MON_MSG.DISINTEGRATES,
  );
}

/* Cold */
function hCold(ctx: MonProjectContext): void {
  hurtImmune(
    ctx,
    RF.HURT_COLD,
    RF.IM_COLD,
    2,
    9,
    MON_MSG.BADLY_FROZEN,
    MON_MSG.FREEZE_SHATTER,
  );
}

/* Poison */
function hPois(ctx: MonProjectContext): void {
  resistElement(ctx, RF.IM_POIS, 9);
}

/* Light -- opposite of Dark */
function hLight(ctx: MonProjectContext): void {
  if (ctx.seen) ctx.hooks.learnRaceFlag?.(ctx.mon, RF.HURT_LIGHT);

  if (ctx.mon.race.spellFlags.has(RSF.BR_LIGHT)) {
    /* Learn about breathers through resistance */
    if (ctx.seen) ctx.hooks.learnSpellFlag?.(ctx.mon, RSF.BR_LIGHT);

    ctx.hurtMsg = MON_MSG.RESIST;
    ctx.dam *= 2;
    ctx.dam = Math.trunc(ctx.dam / (ctx.rng.randint1(6) + 6));
  } else if (ctx.mon.race.flags.has(RF.HURT_LIGHT)) {
    ctx.hurtMsg = MON_MSG.CRINGE_LIGHT;
    ctx.dieMsg = MON_MSG.SHRIVEL_LIGHT;
    ctx.dam *= 2;
  }
}

/* Dark -- opposite of Light */
function hDark(ctx: MonProjectContext): void {
  breath(ctx, RSF.BR_DARK, 2);
}

/* Sound -- Sound breathers resist */
function hSound(ctx: MonProjectContext): void {
  if (ctx.rng.oneIn(3)) {
    ctx.monTimed[MON_TMD.STUN] = adjustRadius(ctx, 5 + ctx.rng.randint1(10));
  }

  breath(ctx, RSF.BR_SOUN, 2);
}

/* Shards -- Shard breathers resist */
function hShard(ctx: MonProjectContext): void {
  breath(ctx, RSF.BR_SHAR, 3);
}

/* Nexus */
function hNexus(ctx: MonProjectContext): void {
  resistOther(ctx, RF.IM_NEXUS, 3, true, MON_MSG.RESIST);

  if (ctx.rng.oneIn(3)) {
    /* Blink */
    ctx.teleportDistance = 10;
  } else if (ctx.rng.oneIn(4)) {
    /* Teleport */
    ctx.teleportDistance = 50;
  }
}

/* Nether -- undead are immune, evil resists, nether breathers resist */
function hNether(ctx: MonProjectContext): void {
  /* Update the lore */
  if (ctx.seen) {
    ctx.hooks.learnRaceFlag?.(ctx.mon, RF.UNDEAD);
    ctx.hooks.learnRaceFlag?.(ctx.mon, RF.IM_NETHER);

    /* If it isn't undead, acquire extra knowledge */
    if (!ctx.mon.race.flags.has(RF.UNDEAD)) {
      if (ctx.mon.race.spellFlags.has(RSF.BR_NETH)) {
        ctx.hooks.learnSpellFlag?.(ctx.mon, RSF.BR_NETH);
      } else {
        ctx.hooks.learnRaceFlag?.(ctx.mon, RF.EVIL);
      }
    }
  }

  if (ctx.mon.race.flags.has(RF.UNDEAD)) {
    ctx.hurtMsg = MON_MSG.IMMUNE;
    ctx.dam = 0;
  } else if (ctx.mon.race.flags.has(RF.IM_NETHER)) {
    ctx.hurtMsg = MON_MSG.RESIST;
    ctx.dam *= 3;
    ctx.dam = Math.trunc(ctx.dam / (ctx.rng.randint1(6) + 6));
  } else if (ctx.mon.race.flags.has(RF.EVIL)) {
    ctx.dam = Math.trunc(ctx.dam / 2);
    ctx.hurtMsg = MON_MSG.RESIST_SOMEWHAT;
  }
}

/* Chaos -- Chaos breathers resist; polymorphs and confuses */
function hChaos(ctx: MonProjectContext): void {
  /* Prevent polymorph on chaos breathers. */
  if (ctx.mon.race.spellFlags.has(RSF.BR_CHAO)) {
    ctx.doPoly = 0;
  } else {
    ctx.doPoly = 1;
  }

  /* Hide resistance message (as assigned in breath()). */
  ctx.monTimed[MON_TMD.CONF] = adjustRadius(ctx, 10 + ctx.rng.randint1(10));
  breath(ctx, RSF.BR_CHAO, 3);
  ctx.hurtMsg = MON_MSG.NONE;
}

/* Disenchantment */
function hDisen(ctx: MonProjectContext): void {
  resistOther(ctx, RF.IM_DISEN, 3, true, MON_MSG.RESIST);

  /* Affect monsters which don't resist, and have non-innate spells */
  if (
    !ctx.mon.race.flags.has(RF.IM_DISEN) &&
    monsterHasNonInnateSpells(ctx.mon)
  ) {
    ctx.monTimed[MON_TMD.DISEN] = adjustRadius(ctx, 5 + ctx.rng.randint1(10));
  }
}

/* Water damage */
function hWater(ctx: MonProjectContext): void {
  /* Zero out the damage because this is an immunity flag. */
  resistOther(ctx, RF.IM_WATER, 0, false, MON_MSG.IMMUNE);
}

/* Ice -- Cold + Stun */
function hIce(ctx: MonProjectContext): void {
  if (ctx.rng.oneIn(3)) {
    ctx.monTimed[MON_TMD.STUN] = adjustRadius(ctx, 5 + ctx.rng.randint1(10));
  }

  hurtImmune(
    ctx,
    RF.HURT_COLD,
    RF.IM_COLD,
    2,
    9,
    MON_MSG.BADLY_FROZEN,
    MON_MSG.FREEZE_SHATTER,
  );
}

/* Gravity -- breathers resist */
function hGravity(ctx: MonProjectContext): void {
  /* Higher level monsters can resist the teleportation better */
  if (ctx.rng.randint1(127) > ctx.mon.race.level) {
    ctx.teleportDistance = 10;
  }

  /* Prevent displacement on gravity breathers. */
  if (ctx.mon.race.spellFlags.has(RSF.BR_GRAV)) {
    ctx.teleportDistance = 0;
  }

  breath(ctx, RSF.BR_GRAV, 3);
}

/* Inertia -- breathers resist */
function hInertia(ctx: MonProjectContext): void {
  breath(ctx, RSF.BR_INER, 3);
}

/* Force -- stuns, breathers resist, others are thrust away */
function hForce(ctx: MonProjectContext): void {
  if (ctx.rng.oneIn(3)) {
    ctx.monTimed[MON_TMD.STUN] = adjustRadius(ctx, 5 + ctx.rng.randint1(10));
  }

  breath(ctx, RSF.BR_WALL, 3);

  /* Prevent thrusting force breathers. */
  if (ctx.mon.race.spellFlags.has(RSF.BR_WALL)) return;

  /* Thrust monster away (executed by the driver). */
  ctx.thrustGridsAway = 3 + Math.trunc(ctx.dam / 20);
}

/* Time -- breathers resist */
function hTime(ctx: MonProjectContext): void {
  breath(ctx, RSF.BR_TIME, 3);
}

/* Plasma */
function hPlasma(ctx: MonProjectContext): void {
  resistOther(ctx, RF.IM_PLASMA, 3, true, MON_MSG.RESIST);
}

/* Meteor / Missile / Mana / Arrow -- raw damage, no special handling */
function hNoop(_ctx: MonProjectContext): void {
  /* Deliberately empty, matching upstream's empty handlers. */
}

/* Holy Orb -- hurts Evil */
function hHolyOrb(ctx: MonProjectContext): void {
  resistOther(ctx, RF.EVIL, 2, false, MON_MSG.HIT_HARD);
}

/* Light, but only hurts susceptible creatures */
function hLightWeak(ctx: MonProjectContext): void {
  hurtOnly(ctx, RF.HURT_LIGHT, MON_MSG.CRINGE_LIGHT, MON_MSG.SHRIVEL_LIGHT);
}

/* Dark, but does nothing to monsters */
function hDarkWeak(ctx: MonProjectContext): void {
  ctx.skipped = true;
  ctx.dam = 0;
}

/* Stone to Mud */
function hKillWall(ctx: MonProjectContext): void {
  hurtOnly(ctx, RF.HURT_ROCK, MON_MSG.LOSE_SKIN, MON_MSG.DISSOLVE);
}

/* Feature-only projections that never affect monsters */
function hSkip(ctx: MonProjectContext): void {
  ctx.skipped = true;
  ctx.dam = 0;
}

/* Teleport undead / evil / spirit / all (dam used as power) */
function hAwayUndead(ctx: MonProjectContext): void {
  teleportAway(ctx, RF.UNDEAD);
}
function hAwaySpirit(ctx: MonProjectContext): void {
  teleportAway(ctx, RF.SPIRIT);
}
function hAwayEvil(ctx: MonProjectContext): void {
  teleportAway(ctx, RF.EVIL);
}
function hAwayAll(ctx: MonProjectContext): void {
  /* Prepare to teleport */
  ctx.teleportDistance = ctx.dam;

  /* No "real" damage */
  ctx.dam = 0;
  ctx.hurtMsg = MON_MSG.DISAPPEAR;
}

/* Turn undead / evil / living / all (dam used as power) */
function hTurnUndead(ctx: MonProjectContext): void {
  scare(ctx, RF.UNDEAD);
}
function hTurnEvil(ctx: MonProjectContext): void {
  scare(ctx, RF.EVIL);
}
function hTurnLiving(ctx: MonProjectContext): void {
  if (ctx.seen) {
    ctx.hooks.learnRaceFlag?.(ctx.mon, RF.NONLIVING);
    ctx.hooks.learnRaceFlag?.(ctx.mon, RF.UNDEAD);
  }

  if (monsterIsLiving(ctx.mon)) {
    ctx.monTimed[MON_TMD.FEAR] = adjustRadius(ctx, ctx.dam);
    if (ctx.seen) ctx.obvious = true;
  } else {
    ctx.skipped = true;
  }

  ctx.dam = 0;
}
function hTurnAll(ctx: MonProjectContext): void {
  ctx.monTimed[MON_TMD.FEAR] = ctx.dam;
  ctx.dam = 0;
}

/* Dispel undead / evil / all */
function hDispUndead(ctx: MonProjectContext): void {
  dispel(ctx, RF.UNDEAD);
}
function hDispEvil(ctx: MonProjectContext): void {
  dispel(ctx, RF.EVIL);
}
function hDispAll(ctx: MonProjectContext): void {
  ctx.hurtMsg = MON_MSG.SHUDDER;
  ctx.dieMsg = MON_MSG.DISSOLVE;
}

/* Sleep undead / evil / all (dam used as power) */
function hSleepUndead(ctx: MonProjectContext): void {
  sleep(ctx, RF.UNDEAD);
}
function hSleepEvil(ctx: MonProjectContext): void {
  sleep(ctx, RF.EVIL);
}
function hSleepAll(ctx: MonProjectContext): void {
  sleep(ctx, RF.NONE);
}

/* Clone monsters (ignore dam) */
function hMonClone(ctx: MonProjectContext): void {
  /* Heal fully */
  ctx.mon.hp = ctx.mon.maxhp;

  /* Speed up */
  monIncTimed(
    ctx.rng,
    ctx.mon,
    MON_TMD.FAST,
    50,
    MON_TMD_FLG_NOTIFY,
    ctx.hooks.onMessage,
  );

  /* Attempt to clone. */
  if (ctx.hooks.multiplyMonster?.(ctx.mon) && ctx.seen) {
    ctx.hurtMsg = MON_MSG.SPAWN;
  }

  /* No "real" damage */
  ctx.dam = 0;
}

/* Polymorph monster (dam used as power) */
function hMonPoly(ctx: MonProjectContext): void {
  charmAnimalBoost(ctx);
  /* Polymorph later */
  ctx.doPoly = ctx.dam;

  /* No "real" damage */
  ctx.dam = 0;
}

/* Heal monster (dam used as amount of healing) */
function hMonHeal(ctx: MonProjectContext): void {
  /* Heal */
  ctx.mon.hp += ctx.dam;

  /* No overflow */
  if (ctx.mon.hp > ctx.mon.maxhp) ctx.mon.hp = ctx.mon.maxhp;

  /* The PR_HEALTH-tracked branch is a UI concern; take the message branch. */
  ctx.hurtMsg = MON_MSG.HEALTHIER;

  /* No "real" damage */
  ctx.dam = 0;
}

/* Speed monster (ignore dam) */
function hMonSpeed(ctx: MonProjectContext): void {
  ctx.monTimed[MON_TMD.FAST] = ctx.dam;
  ctx.dam = 0;
}

/* Slow monster (dam used as power) */
function hMonSlow(ctx: MonProjectContext): void {
  charmAnimalBoost(ctx);
  ctx.monTimed[MON_TMD.SLOW] = ctx.dam;
  ctx.dam = 0;
}

/* Confusion (dam used as power) */
function hMonConf(ctx: MonProjectContext): void {
  charmAnimalBoost(ctx);
  ctx.monTimed[MON_TMD.CONF] = ctx.dam;
  ctx.dam = 0;
}

/* Hold (dam used as power) */
function hMonHold(ctx: MonProjectContext): void {
  charmAnimalBoost(ctx);
  ctx.monTimed[MON_TMD.HOLD] = ctx.dam;
  ctx.dam = 0;
}

/* Stun (dam used as power) */
function hMonStun(ctx: MonProjectContext): void {
  charmAnimalBoost(ctx);
  ctx.monTimed[MON_TMD.STUN] = ctx.dam;
  ctx.dam = 0;
}

/* Drain life */
function hMonDrain(ctx: MonProjectContext): void {
  if (ctx.seen) {
    ctx.obvious = true;
    ctx.hooks.learnRaceFlag?.(ctx.mon, RF.UNDEAD);
  }
  if (monsterIsNonliving(ctx.mon)) {
    ctx.hurtMsg = MON_MSG.UNAFFECTED;
    ctx.obvious = false;
    ctx.dam = 0;
  }
}

/* Crush -- kills monsters below a hitpoint threshold */
function hMonCrush(ctx: MonProjectContext): void {
  if (ctx.seen) ctx.obvious = true;
  if (ctx.mon.hp >= ctx.dam) {
    ctx.hurtMsg = MON_MSG.UNAFFECTED;
    ctx.obvious = false;
    ctx.skipped = true;
    ctx.dam = 0;
  }
}

/**
 * The monster handler table, indexed by PROJ_ type (upstream builds it from
 * list-elements.h then list-projections.h). Assigned by name so the ordering
 * exactly follows the generated PROJ map.
 */
export const MONSTER_HANDLERS: Array<MonHandler | null> = (() => {
  const t: Array<MonHandler | null> = new Array<MonHandler | null>(56).fill(
    null,
  );
  t[PROJ.ACID] = hAcid;
  t[PROJ.ELEC] = hElec;
  t[PROJ.FIRE] = hFire;
  t[PROJ.COLD] = hCold;
  t[PROJ.POIS] = hPois;
  t[PROJ.LIGHT] = hLight;
  t[PROJ.DARK] = hDark;
  t[PROJ.SOUND] = hSound;
  t[PROJ.SHARD] = hShard;
  t[PROJ.NEXUS] = hNexus;
  t[PROJ.NETHER] = hNether;
  t[PROJ.CHAOS] = hChaos;
  t[PROJ.DISEN] = hDisen;
  t[PROJ.WATER] = hWater;
  t[PROJ.ICE] = hIce;
  t[PROJ.GRAVITY] = hGravity;
  t[PROJ.INERTIA] = hInertia;
  t[PROJ.FORCE] = hForce;
  t[PROJ.TIME] = hTime;
  t[PROJ.PLASMA] = hPlasma;
  t[PROJ.METEOR] = hNoop;
  t[PROJ.MISSILE] = hNoop;
  t[PROJ.MANA] = hNoop;
  t[PROJ.HOLY_ORB] = hHolyOrb;
  t[PROJ.ARROW] = hNoop;
  t[PROJ.LIGHT_WEAK] = hLightWeak;
  t[PROJ.DARK_WEAK] = hDarkWeak;
  t[PROJ.KILL_WALL] = hKillWall;
  t[PROJ.KILL_DOOR] = hSkip;
  t[PROJ.KILL_TRAP] = hSkip;
  t[PROJ.MAKE_DOOR] = hSkip;
  t[PROJ.MAKE_TRAP] = hSkip;
  t[PROJ.AWAY_UNDEAD] = hAwayUndead;
  t[PROJ.AWAY_SPIRIT] = hAwaySpirit;
  t[PROJ.AWAY_EVIL] = hAwayEvil;
  t[PROJ.AWAY_ALL] = hAwayAll;
  t[PROJ.TURN_UNDEAD] = hTurnUndead;
  t[PROJ.TURN_EVIL] = hTurnEvil;
  t[PROJ.TURN_LIVING] = hTurnLiving;
  t[PROJ.TURN_ALL] = hTurnAll;
  t[PROJ.DISP_UNDEAD] = hDispUndead;
  t[PROJ.DISP_EVIL] = hDispEvil;
  t[PROJ.DISP_ALL] = hDispAll;
  t[PROJ.SLEEP_UNDEAD] = hSleepUndead;
  t[PROJ.SLEEP_EVIL] = hSleepEvil;
  t[PROJ.SLEEP_ALL] = hSleepAll;
  t[PROJ.MON_CLONE] = hMonClone;
  t[PROJ.MON_POLY] = hMonPoly;
  t[PROJ.MON_HEAL] = hMonHeal;
  t[PROJ.MON_SPEED] = hMonSpeed;
  t[PROJ.MON_SLOW] = hMonSlow;
  t[PROJ.MON_CONF] = hMonConf;
  t[PROJ.MON_HOLD] = hMonHold;
  t[PROJ.MON_STUN] = hMonStun;
  t[PROJ.MON_DRAIN] = hMonDrain;
  t[PROJ.MON_CRUSH] = hMonCrush;
  return t;
})();

/**
 * Run the monster handler for the projection type recorded in the context,
 * mutating it with the accumulated effect. A type with no handler (there are
 * none in the 56-entry space) leaves the context unchanged, matching upstream's
 * `if (monster_handler != NULL)` guard.
 */
export function runMonsterHandler(ctx: MonProjectContext): void {
  const handler = MONSTER_HANDLERS[ctx.type];
  if (handler) handler(ctx);
}
