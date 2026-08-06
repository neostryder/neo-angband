/**
 * The project_m driver, ported from reference/src/project-mon.c (Angband 4.2.6):
 * project_m (L1328) and its appliers project_m_player_attack (L1102),
 * project_m_monster_attack (L1034) and project_m_apply_side_effects (L1177).
 *
 * This is the game-layer half of the monster projection: it operates on the
 * live GameState (monster-by-grid lookup, damage, removal), wiring together the
 * pure effect-computation core (mon/project-mon.ts runMonsterHandler), the
 * shared damage primitive (mon/take-hit.ts monTakeHit), and the projection
 * behaviour data (world/projection.ts obvious / wake). It implements the
 * onMonster seam of project() (world/project.ts).
 *
 * mon/ must not depend on game/, so the driver lives here (it mutates
 * GameState). The genuinely downstream consequences are injected as hooks, so
 * this ships and is tested before their subsystems land:
 * - onKill / onMonsterDeath (player_kill_monster / monster_death: experience,
 *   drops, quests - blocked on floor objects, lore, experience, quests). The
 *   minimal removal (delete_monster_idx) is done here; the hook does the rest.
 * - polymorph (poly_race + place_new_monster: needs monster generation).
 * - teleport (effect_simple EF_TELEPORT: an effect handler, #18).
 * - thrustAway (thrust_away: the cave-mutating knockback).
 * - becomeAware / revertShape / message / messagePain / lore learning: the
 *   knowledge, shapechange and message-list systems.
 */

import { MON_MSG, MON_TMD, PROJ } from "../generated/index.js";
import type { Loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import {
  monsterIsCamouflaged,
  monsterIsDestroyed,
  monsterIsInView,
  monsterIsUnique,
  monsterIsVisible,
} from "../mon/predicate.js";
import { newMonProjectContext, runMonsterHandler } from "../mon/project-mon.js";
import type { MonProjectContext } from "../mon/project-mon.js";
import { monsterWake, monTakeHit } from "../mon/take-hit.js";
import { MON_TMD_FLG_NOTIFY, monIncTimed } from "../mon/timed.js";
import type { MonTimedMessageSink } from "../mon/timed.js";
import { PROJECT } from "../world/project.js";
import type { MonsterHitResult } from "../world/project.js";
import type { ProjectionInfo } from "../world/projection.js";
import { arenaInterceptDeath, deleteMonster, gameTakeHitHooks } from "./context.js";
import type { GameState } from "./context.js";

/** The player-facing / downstream consequences the driver defers to the caller. */
export interface ProjectMonsterHooks {
  /**
   * add_monster_message(mon, msg_code, delay): queue a message about the monster
   * (by MON_MSG index). `delay` is upstream's third argument (what_delay,
   * mon-msg.c:238), not a comma flag, and is REQUIRED - upstream writes it out
   * at every call site, and a default here would silently move a line from the
   * delayed pass into the immediate one. When `damage` is given the caller must
   * use add_monster_message_show_damage (mon-msg.c:288) and append " (N)".
   */
  message?: (
    mon: Monster,
    msg: number,
    delay: boolean,
    damage?: number,
  ) => void;
  /**
   * message_pain: a graded "it is hurt" message from the damage amount. With
   * `showDamage` the caller must use message_pain_show_damage (mon-msg.c:132).
   */
  messagePain?: (mon: Monster, dam: number, showDamage?: boolean) => void;
  /**
   * OPT(player, show_damage) (list-options.h): project_m_player_attack combines
   * it with origin.what == SRC_PLAYER into its `display_dam`
   * (project-mon.c:1111-1112), which selects the *_show_damage message calls.
   */
  showDamage?: boolean;
  /** Timed-effect messages emitted while applying side-effect timers. */
  timedMessage?: MonTimedMessageSink;
  /** player_kill_monster: experience, drops, quests (removal is done here). */
  onKill?: (mon: Monster) => void;
  /** monster_death for a monster-vs-monster kill (drops; removal done here). */
  onMonsterDeath?: (mon: Monster) => void;
  /** become_aware: reveal a camouflaged monster. */
  becomeAware?: (mon: Monster) => void;
  /** monster_revert_shape: a shapechanged monster reverts on death. */
  revertShape?: (mon: Monster) => void;
  /** rf_on(lore): learn a race flag when seen. */
  learnRaceFlag?: (mon: Monster, flag: number) => void;
  /** rsf_on(lore): learn a spell flag when seen. */
  learnSpellFlag?: (mon: Monster, flag: number) => void;
  /** multiply_monster (PROJ_MON_CLONE). */
  multiplyMonster?: (mon: Monster) => boolean;
  /**
   * poly_race + place_new_monster: replace the monster with a polymorphed one.
   * Returns the new monster, or null if the polymorph failed / is unmodelled.
   */
  polymorph?: (mon: Monster, power: number, directPoly: boolean) => Monster | null;
  /** effect_simple EF_TELEPORT: teleport the monster up to `distance` grids. */
  teleport?: (mon: Monster, distance: number) => void;
  /** thrust_away(centre, target, gridsAway): knock a monster back (PROJ_FORCE). */
  thrustAway?: (centre: Loc, target: Loc, gridsAway: number) => void;
  /** update_mon + square_light_spot + PR_MONSTER: refresh a surviving monster. */
  onUpdate?: (mon: Monster) => void;
}

/** The projection source, resolved for the driver. */
export interface ProjectMonsterSource {
  /** origin.what == SRC_PLAYER (routes to project_m_player_attack). */
  isPlayer: boolean;
  /** origin.which.monster for SRC_MONSTER (0 otherwise). */
  monster: number;
  /** origin_get_loc(origin): thrust-away centre. */
  grid: Loc;
  /** player_has(PF_CHARM): boosts effects vs animals. */
  charm: boolean;
}

/** Everything the per-grid driver needs, built once per project() call. */
export interface ProjectMonsterCtx {
  state: GameState;
  projections: readonly ProjectionInfo[];
  origin: ProjectMonsterSource;
  hooks: ProjectMonsterHooks;
}

const NO_HIT: MonsterHitResult = { didHit: false, wasObvious: false };

/**
 * project_m for one grid: affect the monster (if any) in `grid` with projection
 * `typ` for `dam` damage at distance `dist`. Returns project_m's out-parameters
 * (did_hit / was_obvious, plus the monster's post-hit grid). Suitable as the
 * onMonster hook of project().
 */
export function projectMonster(
  pctx: ProjectMonsterCtx,
  dist: number,
  grid: Loc,
  dam: number,
  typ: number,
  flg: number,
): MonsterHitResult {
  const { state, hooks, origin } = pctx;

  /* Walls protect monsters. */
  if (!state.chunk.isPassable(grid)) return NO_HIT;

  const mIdx = state.chunk.mon(grid);
  /* No monster here. */
  if (mIdx <= 0) return NO_HIT;

  /* Never affect the projecting monster. */
  if (origin.monster !== 0 && origin.monster === mIdx) return NO_HIT;

  const mon = state.monsters[mIdx];
  if (!mon) return NO_HIT;

  /* See visible monsters (camouflaged ones only when in view). */
  let seen = monsterIsCamouflaged(mon)
    ? monsterIsInView(mon)
    : monsterIsVisible(mon);

  /* Breathers may not blast members of the same race. */
  if (origin.monster !== 0 && flg & PROJECT.SAFE) {
    const caster = state.monsters[origin.monster];
    if (!caster) return NO_HIT;
    if (caster.race === mon.race) return NO_HIT;
  }

  const ctx = newMonProjectContext(state.rng, mon, typ, dam, {
    originIsMonster: origin.monster !== 0,
    r: dist,
    grid,
    charm: origin.charm,
    seen,
    obvious: (flg & PROJECT.AWARE) !== 0,
    hooks: {
      ...(hooks.learnRaceFlag ? { learnRaceFlag: hooks.learnRaceFlag } : {}),
      ...(hooks.learnSpellFlag ? { learnSpellFlag: hooks.learnSpellFlag } : {}),
      ...(hooks.multiplyMonster
        ? { multiplyMonster: hooks.multiplyMonster }
        : {}),
      ...(hooks.timedMessage ? { onMessage: hooks.timedMessage } : {}),
    },
  });

  /* Some monsters get "destroyed" rather than slain. */
  if (monsterIsDestroyed(mon)) ctx.dieMsg = MON_MSG.DESTROYED;

  /* Reveal a camouflaged monster that stopped an effect. */
  if (flg & PROJECT.STOP && monsterIsCamouflaged(mon) && monsterIsInView(mon)) {
    hooks.becomeAware?.(mon);
    if (monsterIsVisible(mon)) {
      seen = true;
      ctx.seen = true;
    }
  }

  /* Force obviousness for certain projection types if seen. */
  const info = pctx.projections[typ];
  if (info && info.obvious && ctx.seen) ctx.obvious = true;

  /* Run the type handler (accumulates damage / timers / poly / teleport). */
  runMonsterHandler(ctx);

  /* PROJ_FORCE thrust happens in the handler upstream, before wake / damage. */
  if (ctx.thrustGridsAway > 0) {
    hooks.thrustAway?.(origin.grid, grid, ctx.thrustGridsAway);
  }

  /* Wake the monster if the projection type forces it. */
  if (info && info.wake) monsterWake(state.rng, mon, false, 100);

  /* Absolutely no effect. */
  if (ctx.skipped) return NO_HIT;

  /* Apply damage, based on who did the damage. */
  const monDied = origin.monster !== 0
    ? monsterAttack(pctx, ctx, mIdx, seen)
    : playerAttack(pctx, ctx, mIdx, seen);

  if (!monDied) applySideEffects(pctx, ctx, typ, flg, seen);

  /* The side-effect appliers can change ctx.mon (polymorph) or remove it. */
  const finalMon = ctx.mon;
  if (finalMon && !monDied) hooks.onUpdate?.(finalMon);

  return {
    didHit: true,
    wasObvious: ctx.obvious,
    grid: finalMon ? finalMon.grid : grid,
  };
}

/**
 * project_m_player_attack: damage from the player (or a trap), routed through
 * mon_take_hit so death, fear and waking match every other player attack.
 */
function playerAttack(
  pctx: ProjectMonsterCtx,
  ctx: MonProjectContext,
  mIdx: number,
  seen: boolean,
): boolean {
  const { state, hooks } = pctx;
  const mon = ctx.mon;
  const dam = ctx.dam;

  /* display_dam (project-mon.c:1111-1112): only the PLAYER's own damage gets
   * the " (N)" suffix, and only with OPT(player, show_damage) on - a trap also
   * routes here (origin.what == SRC_TRAP) and must stay bare. */
  const displayDam = pctx.origin.isPlayer && (hooks.showDamage ?? false);

  /* Lethal blow: show the death message before mon_take_hit (which is passed
   * an empty note, so it prints none, keeping message order correct). */
  if (dam > mon.hp) {
    hooks.revertShape?.(mon);
    const dieMsg = seen ? ctx.dieMsg : MON_MSG.MORIA_DEATH;
    /* add_monster_message_show_damage vs add_monster_message
     * (project-mon.c:1127-1132). */
    if (displayDam) hooks.message?.(mon, dieMsg, false, dam);
    else hooks.message?.(mon, dieMsg, false);
  }

  let died = false;
  let fear = false;
  if (dam) {
    const res = monTakeHit(state.rng, mon, dam, "", {
      ...gameTakeHitHooks(state, mon),
      onKill: (m) => {
        hooks.onKill?.(m);
        deleteMonster(state, mIdx);
      },
      ...(hooks.becomeAware ? { becomeAware: hooks.becomeAware } : {}),
      /* Single combat: the kill waits for the arena exit. */
      ...(state.arenaLevel
        ? { onArenaDeath: (m: Monster) => void arenaInterceptDeath(state, m) }
        : {}),
    });
    died = res.died;
    fear = res.fear;
  }

  if (!died) {
    /* project-mon.c:1145-1159: the display_dam branch swaps both the specific
     * hurt message and the fallback pain message for their damage-showing
     * twins. The FLEE_IN_TERROR line never shows damage. */
    if (seen && ctx.hurtMsg !== MON_MSG.NONE) {
      if (displayDam) hooks.message?.(mon, ctx.hurtMsg, false, dam);
      else hooks.message?.(mon, ctx.hurtMsg, false);
    } else if (dam > 0) {
      hooks.messagePain?.(mon, dam, displayDam);
    }
    if (seen && fear) hooks.message?.(mon, MON_MSG.FLEE_IN_TERROR, true);
  }

  return died;
}

/**
 * project_m_monster_attack: damage from another monster. Like mon_take_hit but
 * without the player-oriented handling; uniques are reduced to but not killed.
 */
function monsterAttack(
  pctx: ProjectMonsterCtx,
  ctx: MonProjectContext,
  mIdx: number,
  seen: boolean,
): boolean {
  const { state, hooks } = pctx;
  const mon = ctx.mon;
  let dam = ctx.dam;

  /* "Unique" or arena monsters can only be killed by the player. */
  if ((monsterIsUnique(mon) || state.arenaLevel) && dam > mon.hp) dam = mon.hp;

  /* Wake the monster up, don't notice the player. */
  monsterWake(state.rng, mon, false, 0);

  mon.hp -= dam;

  if (mon.hp < 0) {
    hooks.revertShape?.(mon);
    const dieMsg = seen ? ctx.dieMsg : MON_MSG.MORIA_DEATH;
    hooks.message?.(mon, dieMsg, false);
    hooks.onMonsterDeath?.(mon);
    deleteMonster(state, mIdx);
    return true;
  }

  if (!monsterIsCamouflaged(mon)) {
    if (ctx.hurtMsg !== MON_MSG.NONE && seen) {
      hooks.message?.(mon, ctx.hurtMsg, false);
    } else if (dam > 0) {
      hooks.messagePain?.(mon, dam);
    }
  }

  return false;
}

/**
 * project_m_apply_side_effects: polymorph, teleport, or apply the accumulated
 * timed effects. Polymorph and teleport are checked first since they may
 * invalidate applying status effects to a changed monster.
 */
function applySideEffects(
  pctx: ProjectMonsterCtx,
  ctx: MonProjectContext,
  typ: number,
  _flg: number,
  seen: boolean,
): void {
  const { state, hooks } = pctx;
  const mon = ctx.mon;

  if (ctx.doPoly) {
    /* Uniques cannot be polymorphed, nor can anything on an arena level
     * (project-mon.c L1197: monster_is_unique(mon) || player->arena_level). PR3. */
    if (monsterIsUnique(mon) || state.arenaLevel) {
      if (seen) hooks.message?.(mon, MON_MSG.UNAFFECTED, false);
      return;
    }

    if (seen) ctx.obvious = true;

    /* Saving throw: damage-based for direct poly, random for chaos. */
    const savelvl =
      typ === PROJ.MON_POLY
        ? state.rng.randint1(Math.max(1, ctx.doPoly - 10)) + 10
        : state.rng.randint1(90);
    if (mon.race.level > savelvl) {
      if (seen) {
        hooks.message?.(
          mon,
          typ === PROJ.MON_POLY ? MON_MSG.MAINTAIN_SHAPE : MON_MSG.UNAFFECTED,
          false,
        );
      }
      return;
    }

    const newMon =
      hooks.polymorph?.(mon, ctx.doPoly, typ === PROJ.MON_POLY) ?? null;
    if (newMon && newMon !== mon) {
      if (seen) hooks.message?.(mon, MON_MSG.CHANGE, false);
      ctx.mon = newMon;
    } else if (seen) {
      hooks.message?.(mon, MON_MSG.MAINTAIN_SHAPE, false);
    }
  } else if (ctx.teleportDistance > 0) {
    hooks.teleport?.(mon, ctx.teleportDistance);
    /* Wake the monster up, don't notice the player. */
    monsterWake(state.rng, mon, false, 0);
  } else {
    for (let i = 0; i < MON_TMD.MAX; i++) {
      if (ctx.monTimed[i]! > 0) {
        monIncTimed(
          state.rng,
          mon,
          i,
          ctx.monTimed[i]!,
          ctx.flag | MON_TMD_FLG_NOTIFY,
          hooks.timedMessage,
        );
        if (seen) ctx.obvious = true;
      }
    }
  }
}
