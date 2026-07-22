/**
 * The per-projection player side effects, ported from the
 * project_player_handler_* table of reference/src/project-player.c (Angband
 * 4.2.6). Damage itself is applied by the projectPlayer driver
 * (game/project-player.ts); these handlers add the flavour that rides on
 * top - inventory damage, timed effects (blind/confusion/stun/cuts/poison/
 * slow/amnesia/hallucination/scramble), experience drain with the HOLD_LIFE
 * check, stat drains with the sustain check, mana and energy loss - and
 * return any extra damage (poison's acid sting).
 *
 * makePlayerSideEffects builds the ProjectPlayerHooks.onSideEffects hook
 * from the live GameState plus the timed-effect registry; wireGame installs
 * it on the cast context so every projection that reaches the player runs
 * the upstream consequences.
 *
 * The teleport branches run through the player slices of the teleport
 * handlers (effect-teleport.ts) with the injected TeleportEnv: GRAVITY's
 * blink (teleportPlayer 5), NEXUS's teleport-to-caster / teleport-level /
 * teleport-200 three-way, and FORCE's knockback via thrust_away
 * (game/thrust.ts) from the origin grid; DISEN runs disenchantEquipment
 * (game/effect-general.ts). DEFERRED (ledgered in
 * parity/ledger/game-player-side.yaml): the drain-stat "sustain but still
 * feel it" message variant is folded to the save message.
 */

import { ELEM, OF, PF, PROJ, STAT, TMD } from "../generated";
import { DDGRID_DDD, locEq, locSum } from "../loc";
import { SKILL, STAT_MAX } from "../player/types";
import type { ProjectionInfo } from "../world/projection";
import type { TimedEffect } from "../player/types";
import { playerIncCheck, playerIncTimed } from "../player/timed";
import type { PlayerIncCheckQueries } from "../player/timed";
import type { Player } from "../player/player";
import { playerExpLose, playerStatDec } from "../player/exp";
import type { ExpDeps } from "../player/exp";
import { equipLearnFlag } from "../obj/knowledge";
import { adjustDam } from "../world/projection";
import type { GameState } from "./context";
import type {
  PlayerProjActor,
  ProjectPlayerSideContext,
} from "./project-player";
import { invenDamage } from "./project-obj";
import { disenchantEquipment } from "./effect-general";
import {
  teleportPlayer,
  teleportPlayerLevel,
  teleportPlayerTo,
} from "./effect-teleport";
import type { TeleportEnv } from "./effect-teleport";
import { thrustAway } from "./thrust";

/**
 * makeIncCheckQueries: the player_inc_check fail-condition resolvers over the
 * live derived state (player-timed.c:923-1024). Shared by makePlayerSideEffects,
 * the effect-interpreter env, and the world-clock timed hooks so the over-
 * exertion / EF_TIMED_INC resist gate reads one source of truth. Object/player
 * flags and element resists come from state.playerState (the last calc_bonuses);
 * the timed check reads the live duration array.
 */
export function makeIncCheckQueries(state: GameState): PlayerIncCheckQueries {
  return {
    objectFlag: (name): boolean => {
      const i = (OF as Record<string, number>)[name];
      return i !== undefined && (state.playerState?.flags.has(i) ?? false);
    },
    resistLevel: (name): number => {
      const i = (ELEM as Record<string, number>)[name];
      return i !== undefined ? (state.playerState?.elInfo[i]?.resLevel ?? 0) : 0;
    },
    playerFlag: (name): boolean => {
      const i = (PF as Record<string, number>)[name];
      return i !== undefined && (state.playerState?.pflags.has(i) ?? false);
    },
    timedActive: (name): boolean => {
      const i = (TMD as Record<string, number>)[name];
      return i !== undefined && (state.actor.player.timed[i] ?? 0) > 0;
    },
  };
}

/** Everything the side-effect handlers need beyond the GameState. */
export interface PlayerSideDeps {
  /** The bound timed-effect registry (players.timed), TMD-indexed. */
  timed: readonly TimedEffect[];
  /** The projection view of the player (resists / immunities). */
  actor: PlayerProjActor;
  /** The bound projection table (poison's acid-sting adjust_dam). */
  projections: readonly ProjectionInfo[];
  /** Experience drains ripple levels through this. */
  expDeps: ExpDeps;
  /** z_info->life_drain_percent. */
  lifeDrainPercent: number;
  /** The teleport seams (no-teleport curse, post-move) for GRAVITY's blink. */
  teleport?: TeleportEnv;
  msg?(text: string): void;
}

const STAT_ADJECTIVE: readonly string[] = [
  "strong",
  "bright",
  "wise",
  "agile",
  "hale",
];

/** player_of_has: the racial flags plus every equipped item's. */
function playerOfHas(state: GameState, flag: number): boolean {
  const p = state.actor.player;
  if (p.race.flags.has(flag)) return true;
  for (let i = 0; i < p.body.count; i++) {
    if (state.runeEnv.slotObject(i)?.flags.has(flag)) return true;
  }
  return false;
}

/** sustain_flag(stat) over the OF_SUST_ block. */
function sustained(state: GameState, stat: number): boolean {
  return playerOfHas(state, OF.SUST_STR + stat);
}

export function makePlayerSideEffects(
  state: GameState,
  deps: PlayerSideDeps,
): (ctx: ProjectPlayerSideContext) => number {
  const p = (): Player => state.actor.player;
  const msg = (t: string): void => deps.msg?.(t);

  /** player_inc_timed through the bound registry (no fail-check hooks yet). */
  const incTimed = (idx: number, v: number, check: boolean): boolean => {
    const effect = deps.timed[idx];
    if (!effect) return false;
    return playerIncTimed(p(), effect, v, true, true, check, {
      ...(deps.msg
        ? { onMessage: (text: string): void => deps.msg?.(text) }
        : {}),
    });
  };

  /** Immunity / resist reads from the derived state. */
  const isImmune = (elem: number): boolean => deps.actor.resistLevel(elem) === 3;
  const resists = (elem: number): boolean => deps.actor.resistLevel(elem) > 0;

  /**
   * player_inc_check (project-player.c:259,328) as a pure predicate: whether a
   * timed increase would be allowed by the player's resists/flags, used to gate
   * the LIGHT "dazzled" / SOUND "disorients" messages so they are not shown when
   * the confusion is resisted. Queries mirror buildFailRuneEnv (game/mon-cast.ts).
   * The learning / smart-learn / resist-message side effects of the non-lore
   * check ride the timed-effect wiring (gap 2.8).
   */
  const incCheckQueries = makeIncCheckQueries(state);
  const incCheck = (idx: number): boolean => {
    const effect = deps.timed[idx];
    return effect ? playerIncCheck(effect, incCheckQueries) : true;
  };

  /** The drain-stat slice (effect_simple(EF_DRAIN_STAT)): sustain saves. */
  const drainStat = (stat: number): void => {
    if (sustained(state, stat)) {
      equipLearnFlag(p(), state.runeEnv, OF.SUST_STR + stat);
      return;
    }
    if (playerStatDec(p(), stat, false)) {
      msg(`You're not as ${STAT_ADJECTIVE[stat] ?? "good"} as you used to be...`);
    }
  };

  /** Life drain with the HOLD_LIFE gate (and its rune learning). */
  const drainLife = (amount: number, text: string): void => {
    if (playerOfHas(state, OF.HOLD_LIFE)) {
      equipLearnFlag(p(), state.runeEnv, OF.HOLD_LIFE);
      msg("You resist the effect!");
    } else {
      msg(text);
      playerExpLose(p(), amount, false, deps.expDeps);
    }
  };

  return (ctx: ProjectPlayerSideContext): number => {
    const rng = state.rng;
    const dam = ctx.dam;
    let xtra = 0;

    switch (ctx.typ) {
      case PROJ.ACID: {
        if (isImmune(ELEM.ACID)) break;
        invenDamage(state, ELEM.ACID, Math.min(dam * 5, 300), { msg });
        break;
      }
      case PROJ.ELEC: {
        if (isImmune(ELEM.ELEC)) break;
        invenDamage(state, ELEM.ELEC, Math.min(dam * 5, 300), { msg });
        break;
      }
      case PROJ.FIRE: {
        if (isImmune(ELEM.FIRE)) break;
        invenDamage(state, ELEM.FIRE, Math.min(dam * 5, 300), { msg });
        /* Occasional side-effects for powerful fire attacks. */
        if (ctx.power >= 80) {
          if (rng.randint0(dam) > 500) {
            msg("The intense heat saps you.");
            drainStat(STAT.STR);
          }
          if (rng.randint0(dam) > 500) {
            if (incTimed(TMD.BLIND, rng.randint1(Math.trunc(dam / 100)), true)) {
              msg("Your eyes fill with smoke!");
            }
          }
          if (rng.randint0(dam) > 500) {
            if (incTimed(TMD.POISONED, rng.randint1(Math.trunc(dam / 10)), true)) {
              msg("You are assailed by poisonous fumes!");
            }
          }
        }
        break;
      }
      case PROJ.COLD: {
        if (isImmune(ELEM.COLD)) break;
        invenDamage(state, ELEM.COLD, Math.min(dam * 5, 300), { msg });
        /* Occasional side-effects for powerful cold attacks. */
        if (ctx.power >= 80) {
          if (rng.randint0(dam) > 500) {
            msg("The cold seeps into your bones.");
            drainStat(STAT.DEX);
          }
          if (rng.randint0(dam) > 500) {
            drainLife(dam, "The cold withers your life force!");
          }
        }
        break;
      }
      case PROJ.POIS: {
        if (!incTimed(TMD.POISONED, 10 + rng.randint1(dam), true)) {
          msg("You resist the effect!");
        }
        /* Occasional side-effects for powerful poison attacks. */
        if (ctx.power >= 60) {
          if (rng.randint0(dam) > 200) {
            if (!isImmune(ELEM.ACID)) {
              const acidDam = Math.trunc(dam / 5);
              msg("The venom stings your skin!");
              invenDamage(state, ELEM.ACID, acidDam, { msg });
              xtra += adjustDam(
                state.rng,
                deps.projections,
                PROJ.ACID,
                acidDam,
                "randomise",
                deps.actor.resistLevel(ELEM.ACID),
              );
            }
          }
          if (rng.randint0(dam) > 200) {
            msg("The stench sickens you.");
            drainStat(STAT.CON);
          }
        }
        break;
      }
      case PROJ.LIGHT: {
        if (resists(ELEM.LIGHT)) {
          msg("You resist the effect!");
          break;
        }
        incTimed(TMD.BLIND, 2 + rng.randint1(5), true);
        if (dam > 300) {
          /* Check for resistance before issuing the message. */
          if (incCheck(TMD.CONFUSED)) msg("You are dazzled!");
          incTimed(TMD.CONFUSED, 2 + rng.randint1(Math.trunc(dam / 100)), true);
        }
        break;
      }
      case PROJ.DARK: {
        if (resists(ELEM.DARK)) {
          msg("You resist the effect!");
          break;
        }
        incTimed(TMD.BLIND, 2 + rng.randint1(5), true);
        /* Unresisted dark from powerful monsters is bad news. */
        if (ctx.power >= 70) {
          if (rng.randint0(dam) > 100) {
            drainLife(dam, "The darkness steals your life force!");
          }
          if (rng.randint0(dam) > 200) {
            msg("You feel unsure of yourself in the darkness.");
            incTimed(TMD.SLOW, Math.trunc(dam / 100), false);
          }
          if (rng.randint0(dam) > 300) {
            msg("Darkness penetrates your mind!");
            incTimed(TMD.AMNESIA, Math.trunc(dam / 100), false);
          }
        }
        break;
      }
      case PROJ.DARK_WEAK: {
        /* project-player.c project_player_handler_DARK_WEAK: unlit races
         * resist silently; everyone else who resists gets the message; the
         * rest are briefly blinded. */
        if (resists(ELEM.DARK)) {
          if (!(state.playerState?.pflags.has(PF.UNLIGHT) ?? false)) {
            msg("You resist the effect!");
          }
          break;
        }
        incTimed(TMD.BLIND, 3 + rng.randint1(5), true);
        break;
      }
      case PROJ.SOUND: {
        if (resists(ELEM.SOUND)) {
          msg("You resist the effect!");
          break;
        }
        if (!playerOfHas(state, OF.PROT_STUN)) {
          incTimed(TMD.STUN, Math.min(5 + rng.randint1(Math.trunc(dam / 3)), 35), true);
        } else {
          equipLearnFlag(p(), state.runeEnv, OF.PROT_STUN);
        }
        if (dam > 300) {
          /* Check for resistance before issuing the message. */
          if (incCheck(TMD.CONFUSED)) msg("The noise disorients you.");
          incTimed(TMD.CONFUSED, 2 + rng.randint1(Math.trunc(dam / 100)), true);
        }
        break;
      }
      case PROJ.SHARD: {
        if (resists(ELEM.SHARD)) {
          msg("You resist the effect!");
          break;
        }
        incTimed(TMD.CUT, rng.randint1(dam), false);
        break;
      }
      case PROJ.NEXUS: {
        if (resists(ELEM.NEXUS)) {
          msg("You resist the effect!");
          break;
        }
        /* Stat scramble unless saved. */
        if (rng.randint0(100) < (state.actor.combat.skills[SKILL.SAVE] ?? 0)) {
          msg("You avoid the effect!");
        } else {
          incTimed(TMD.SCRAMBLE, rng.randint0(20) + 20, true);
        }
        const tp = deps.teleport ?? {};
        if (rng.oneIn(3) && ctx.origin.isMonster && ctx.origin.grid) {
          /* Teleport to the caster. */
          teleportPlayerTo(state, ctx.origin.grid, tp, msg);
        } else if (rng.oneIn(4)) {
          /* Teleport level. */
          if (
            rng.randint0(100) < (state.actor.combat.skills[SKILL.SAVE] ?? 0)
          ) {
            msg("You avoid the effect!");
            break;
          }
          teleportPlayerLevel(state, tp, msg, ctx.origin.isMonster);
        } else {
          /* Teleport 200 grids. */
          teleportPlayer(state, 200, tp, msg);
        }
        break;
      }
      case PROJ.NETHER: {
        if (resists(ELEM.NETHER) || playerOfHas(state, OF.HOLD_LIFE)) {
          msg("You resist the effect!");
          equipLearnFlag(p(), state.runeEnv, OF.HOLD_LIFE);
          break;
        }
        const drain =
          200 + Math.trunc(p().exp / 100) * deps.lifeDrainPercent;
        msg("You feel your life force draining away!");
        playerExpLose(p(), drain, false, deps.expDeps);
        if (ctx.power >= 80) {
          if (rng.randint0(dam) > 100 && p().msp) {
            msg("Your mind is dulled.");
            p().csp -= Math.min(p().csp, Math.trunc(dam / 10));
          }
          if (rng.randint0(dam) > 200) {
            msg("Your energy is sapped!");
            state.actor.energy = 0;
          }
        }
        break;
      }
      case PROJ.CHAOS: {
        if (resists(ELEM.CHAOS)) {
          msg("You resist the effect!");
          break;
        }
        incTimed(TMD.IMAGE, rng.randint1(10), false);
        incTimed(TMD.CONFUSED, 10 + rng.randint0(20), true);
        if (!playerOfHas(state, OF.HOLD_LIFE)) {
          const drain =
            Math.trunc((p().exp * 3) / 200) * deps.lifeDrainPercent;
          msg("You feel your life force draining away!");
          playerExpLose(p(), drain, false, deps.expDeps);
        } else {
          equipLearnFlag(p(), state.runeEnv, OF.HOLD_LIFE);
        }
        break;
      }
      case PROJ.DISEN: {
        if (resists(ELEM.DISEN)) {
          msg("You resist the effect!");
          break;
        }
        /* Disenchant gear (effect_simple(EF_DISENCHANT)). */
        disenchantEquipment(state, { msg });
        break;
      }
      case PROJ.WATER: {
        incTimed(TMD.CONFUSED, 5 + rng.randint1(5), true);
        incTimed(TMD.STUN, rng.randint1(40), true);
        break;
      }
      case PROJ.ICE: {
        if (!isImmune(ELEM.COLD)) {
          invenDamage(state, ELEM.COLD, Math.min(dam * 5, 300), { msg });
        }
        if (!resists(ELEM.SHARD)) {
          incTimed(TMD.CUT, rng.damroll(5, 8), false);
        } else {
          msg("You resist the effect!");
        }
        incTimed(TMD.STUN, rng.randint1(15), true);
        break;
      }
      case PROJ.GRAVITY: {
        msg("Gravity warps around you.");
        /* Blink (effect_simple(EF_TELEPORT, "5")). */
        if (rng.randint1(127) > p().lev) {
          teleportPlayer(state, 5, deps.teleport ?? {}, msg);
        }
        incTimed(TMD.SLOW, 4 + rng.randint0(4), false);
        if (!playerOfHas(state, OF.PROT_STUN)) {
          incTimed(TMD.STUN, Math.min(5 + rng.randint1(Math.trunc(dam / 3)), 35), true);
        } else {
          equipLearnFlag(p(), state.runeEnv, OF.PROT_STUN);
        }
        break;
      }
      case PROJ.INERTIA: {
        incTimed(TMD.SLOW, 4 + rng.randint0(4), false);
        break;
      }
      case PROJ.FORCE: {
        let centre = ctx.origin.grid ?? ctx.grid;

        /* Player gets pushed in a random direction if on the trap. */
        if (ctx.origin.isTrap && locEq(state.actor.grid, centre)) {
          centre = locSum(centre, DDGRID_DDD[rng.randint0(8)]!);
        }

        incTimed(TMD.STUN, rng.randint1(20), true);

        /* Thrust player away. */
        thrustAway(state, centre, ctx.grid, 3 + Math.trunc(dam / 20), {
          msg,
          ...(deps.teleport?.onPlayerPostMove
            ? {
                onPlayerPostMove: (): void =>
                  deps.teleport!.onPlayerPostMove!(true),
              }
            : {}),
        });
        break;
      }
      case PROJ.TIME: {
        if (rng.oneIn(2)) {
          const drain =
            100 + Math.trunc(p().exp / 100) * deps.lifeDrainPercent;
          msg("You feel your life force draining away!");
          playerExpLose(p(), drain, false, deps.expDeps);
        } else if (!rng.oneIn(5)) {
          /* Drain two random stats. */
          for (let i = 0; i < 2; i++) {
            drainStat(rng.randint1(5) - 1);
          }
        } else {
          msg("You're not as powerful as you used to be...");
          for (let i = 0; i < STAT_MAX; i++) playerStatDec(p(), i, false);
        }
        break;
      }
      case PROJ.PLASMA: {
        if (!playerOfHas(state, OF.PROT_STUN)) {
          incTimed(
            TMD.STUN,
            Math.min(5 + rng.randint1(Math.trunc((dam * 3) / 4)), 35),
            true,
          );
        } else {
          equipLearnFlag(p(), state.runeEnv, OF.PROT_STUN);
        }
        break;
      }
      default:
        break;
    }
    return xtra;
  };
}
