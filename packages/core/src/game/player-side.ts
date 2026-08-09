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
 * (game/effect-general.ts). The two upstream stat-drain paths are kept
 * distinct: drainStat is effect_simple(EF_DRAIN_STAT) (sustain saves with the
 * "You feel very %s..." messages), drainStatsRandom is
 * project_player_drain_stats (no sustain, always "You're not as %s...").
 *
 * THE DISPATCH IS A REGISTRY, as of 2026-08-09. It was a 21-case switch, and
 * the last of the three - project_f's 37 and project_o's 11 were converted the
 * day before, so a mod's projection reached terrain and objects but not the
 * player, which is the half that matters. PLAYER_SIDE_HANDLERS is keyed by
 * projection CODE exactly as the other two are, and `deps.playerHandlers` is
 * the table the game actually dispatches through - supplied by wireGame from
 * the per-game ProjectionHandlerRegistry (game/projection-handlers.ts), which a
 * mod writes one code at a time through "registry:projection".
 *
 * What made this one a real refactor rather than a mechanical lift: the arms
 * read ten helpers built per game, and `incCheck` reads a `currentSource`
 * stamped per PROJECTION. `PlayerSideCtx` is those helpers made explicit, which
 * is what lets the arms be ordinary top-level functions.
 *
 * The 6,912 vectors in player-side-vectors.json were recorded from the SWITCH
 * and are replayed against the table, because the conversion bought moddability
 * and was required to change nothing else - including the number of rng draws,
 * which no visible value would have shown.
 */

import { ELEM, OF, PF, PROJ, STAT, TMD } from "../generated/index.js";
import { DDGRID_DDD, locEq, locSum } from "../loc.js";
import { SKILL, STAT_MAX } from "../player/types.js";
import type { ProjectionInfo } from "../world/projection.js";
import type { TimedEffect } from "../player/types.js";
import { playerIncCheck, playerIncTimed } from "../player/timed.js";
import type {
  PlayerIncCheckHooks,
  PlayerIncCheckQueries,
  TimedNotifyQueries,
} from "../player/timed.js";
import type { Monster } from "../mon/monster.js";
import { updateSmartLearn } from "../mon/spell.js";
import { buildSmartLearnEnv } from "./mon-cast.js";
import type { Player } from "../player/player.js";
import { playerExpLose, playerStatDec } from "../player/exp.js";
import { playerFlags } from "../player/calcs.js";
import type { ExpDeps } from "../player/exp.js";
import { equipLearnElement, equipLearnFlag } from "../obj/knowledge.js";
import { adjustDam, projectionCodeFor } from "../world/projection.js";
import type { Rng } from "../rng.js";
import { ODESC } from "../obj/desc.js";
import { minusAc } from "./gear.js";
import { describeObject } from "./describe.js";
import type { GameState } from "./context.js";
import { playerOfHas } from "./context.js";
import type {
  PlayerProjActor,
  ProjectPlayerSideContext,
} from "./project-player.js";
import { invenDamage } from "./project-obj.js";
import { disenchantEquipment } from "./effect-general.js";
import {
  teleportPlayer,
  teleportPlayerLevel,
  teleportPlayerTo,
} from "./effect-teleport.js";
import type { TeleportEnv } from "./effect-teleport.js";
import { thrustAway } from "./thrust.js";

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

/**
 * makeTimedNotifyQueries: the obj_k reads player_set_timed's notify suppression
 * needs (player-timed.c:828-839).
 *
 * "Don't mention effects which already match the known player state" - a
 * temporary resist you are KNOWN to be immune to, or a flag synonym you are
 * KNOWN to have from worn gear. It silences a message and never changes the
 * duration, which is why it went unnoticed: nothing supplied these queries in
 * production, so every such effect announced itself.
 *
 * hasFlagNotTimed is player_of_has_not_timed (player-timed.c:747-763): the
 * player's own flags UNION every equipped object's, deliberately WITHOUT timed
 * effects - that exclusion is the whole point of the predicate.
 */
export function makeTimedNotifyQueries(state: GameState): TimedNotifyQueries {
  const p = (): Player => state.actor.player;
  return {
    /* p->obj_k->el_info[elem].res_level != 0. */
    knownResist: (elem): boolean =>
      (p().objKnown.elInfo[elem]?.resLevel ?? 0) !== 0,
    /* player_is_immune(p, elem): res_level 3 on the DERIVED state. */
    isImmune: (elem): boolean =>
      (state.playerState?.elInfo[elem]?.resLevel ?? 0) === 3,
    /* of_has(p->obj_k->flags, of). */
    knownFlag: (of): boolean => p().objKnown.flags.has(of),
    hasFlagNotTimed: (of): boolean => {
      /* player_flags(p) is race UNION class plus the BRAVERY_30 promotion
       * (player.c:290-300); player/calcs.ts playerFlags is that exactly. */
      if (playerFlags(p()).has(of)) return true;
      for (let i = 0; i < p().body.count; i++) {
        if (state.runeEnv.slotObject(i)?.flags.has(of)) return true;
      }
      return false;
    },
  };
}

/**
 * makeIncCheckHooks: player_inc_check's SIDE EFFECTS over the live state
 * (player-timed.c:945-953 for object flags, :967 and :985 for resists and
 * vulnerabilities).
 *
 * The two equip-learn calls are UNCONDITIONAL in upstream's non-lore branch -
 * a trap you are immune to, a potion, a monster's breath and a monster's blow
 * all teach the rune the same way. Only update_smart_learn and the "You resist
 * the effect!" line are gated on `cave->mon_current > 0`, which is what
 * `monster` supplies here.
 *
 * Everything below is RNG-free: equipLearnFlag / equipLearnElement walk the
 * worn slots and write knowledge (obj/knowledge.ts:773, :795), and neither they
 * nor playerLearnFlagRune / objectCursesFindFlags draw. That was measured
 * rather than assumed, because supplying these on paths that previously had no
 * hooks would otherwise move the RNG stream under every seeded test.
 */
export function makeIncCheckHooks(
  state: GameState,
  opts: {
    /** The message sink for "You resist the effect!" (monster sources only). */
    msg?: (text: string) => void;
    /** cave->mon_current: the acting monster, when one is acting. */
    monster?: Monster | null;
  } = {},
): PlayerIncCheckHooks {
  const p = (): Player => state.actor.player;
  const mon = opts.monster ?? null;
  const smartEnv = mon ? buildSmartLearnEnv(state) : null;
  return {
    equipLearnFlag: (name: string): void => {
      const of = (OF as Record<string, number>)[name];
      if (of !== undefined) equipLearnFlag(p(), state.runeEnv, of);
    },
    equipLearnElement: (name: string): void => {
      const elem = (ELEM as Record<string, number>)[name];
      if (elem !== undefined) equipLearnElement(p(), state.runeEnv, elem);
    },
    ...(mon
      ? {
          monsterSource: true,
          updateSmartLearn: (name: string): void => {
            const of = (OF as Record<string, number>)[name];
            if (of !== undefined && smartEnv) {
              updateSmartLearn(state.rng, mon, smartEnv, of, 0, -1);
            }
          },
          ...(opts.msg
            ? { resistMessage: (): void => opts.msg!("You resist the effect!") }
            : {}),
        }
      : {}),
  };
}

/**
 * What one per-projection player handler is handed: the projection being
 * resolved, and the toolkit the arms used to close over.
 *
 * THE TOOLKIT IS THE WHOLE REASON THIS TYPE EXISTS. project_f's and project_o's
 * handlers took (state, grid, dam) and a bag of env, so lifting them to module
 * level was mechanical. project_p's arms read ten helpers built per game -
 * player_inc_timed bound to the timed registry, player_inc_check bound to the
 * live derived state, the two distinct stat drains, the HOLD_LIFE life drain -
 * and one of them, `incCheck`, reads a `currentSource` that is stamped per
 * PROJECTION. Passing those in explicitly is what lets the arms below be
 * ordinary top-level functions, and lets a mod supply its own.
 */
export interface PlayerSideCtx {
  readonly state: GameState;
  readonly deps: PlayerSideDeps;
  /** The upstream handler context: origin, grid, typ, power, obvious. */
  readonly proj: ProjectPlayerSideContext;
  /** context->dam, which nine arms scale their effects off. */
  readonly dam: number;
  /** Monster spell power: the >= 60 / 70 / 80 gates on the bonus arms. */
  readonly power: number;
  readonly rng: Rng;
  /** The player, so an arm does not spell out state.actor.player every line. */
  p(): Player;
  msg(text: string): void;
  /** player_inc_timed through the bound registry. */
  incTimed(idx: number, v: number, check: boolean): boolean;
  /** player_inc_check as a pure predicate, for the pre-message resist test. */
  incCheck(idx: number): boolean;
  /** el_info[elem].res_level === 3. */
  isImmune(elem: number): boolean;
  /** el_info[elem].res_level > 0. */
  resists(elem: number): boolean;
  /** effect_simple(EF_DRAIN_STAT): the sustain saves it. */
  drainStat(stat: number): void;
  /** project_player_drain_stats(num): no sustain, always the message. */
  drainStatsRandom(num: number): void;
  /** Experience drain with the HOLD_LIFE gate. */
  drainLife(amount: number, text: string): void;
  /**
   * Extra damage applied after damage reduction. Mutable and written in place,
   * exactly as `ProjectObjCtx.out` is - POIS's acid sting is the only writer.
   */
  xtra: number;
}

/** One projection's side effects on the player. Writes `ctx.xtra` if any. */
export type PlayerSideHandler = (ctx: PlayerSideCtx) => void;

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
  /**
   * The player-handler table to dispatch through, defaulting to
   * PLAYER_SIDE_HANDLERS. Supplied by wireGame from
   * `GameState.projectionHandlers`, by identity, exactly as `featHandlers` and
   * `objHandlers` are - see game/projection-handlers.ts.
   */
  playerHandlers?: ReadonlyMap<string, PlayerSideHandler>;
  msg?(text: string): void;
}

const STAT_ADJECTIVE: readonly string[] = [
  "strong",
  "bright",
  "wise",
  "agile",
  "hale",
];

/**
 * desc_stat(stat, false): the negative adjective per stat (object_property.txt
 * neg-adjective), used by EF_DRAIN_STAT's "You feel very %s." messages
 * (effect-handler-general.c L820/L840). STR/INT/WIS/DEX/CON order.
 */
const STAT_NEG_ADJECTIVE: readonly string[] = [
  "weak",
  "stupid",
  "naive",
  "clumsy",
  "sickly",
];


/** sustain_flag(stat) over the OF_SUST_ block. */
function sustained(state: GameState, stat: number): boolean {
  return playerOfHas(state, OF.SUST_STR + stat);
}

/* ------------------------------------------------------------------ */
/* project_player_handler_* (project-player.c L133-L500)                */
/* ------------------------------------------------------------------ */

/**
 * The elemental arm shared by ACID and ELEC: immunity spares the pack, and
 * nothing else happens. FIRE and COLD start the same way and then add their
 * powerful-attack bonuses, so they are written out in full rather than wrapping
 * this - the shared prefix is two lines and the difference is the whole arm.
 */
const packOnly =
  (element: number): PlayerSideHandler =>
  (c) => {
    if (c.isImmune(element)) return;
    invenDamage(c.state, element, Math.min(c.dam * 5, 300), { msg: c.msg });
  };

const fire: PlayerSideHandler = (c) => {
  if (c.isImmune(ELEM.FIRE)) return;
  invenDamage(c.state, ELEM.FIRE, Math.min(c.dam * 5, 300), { msg: c.msg });
  /* Occasional side-effects for powerful fire attacks. */
  if (c.power >= 80) {
    if (c.rng.randint0(c.dam) > 500) {
      c.msg("The intense heat saps you.");
      c.drainStat(STAT.STR);
    }
    if (c.rng.randint0(c.dam) > 500) {
      if (c.incTimed(TMD.BLIND, c.rng.randint1(Math.trunc(c.dam / 100)), true)) {
        c.msg("Your eyes fill with smoke!");
      }
    }
    if (c.rng.randint0(c.dam) > 500) {
      if (c.incTimed(TMD.POISONED, c.rng.randint1(Math.trunc(c.dam / 10)), true)) {
        c.msg("You are assailed by poisonous fumes!");
      }
    }
  }
};

const cold: PlayerSideHandler = (c) => {
  if (c.isImmune(ELEM.COLD)) return;
  invenDamage(c.state, ELEM.COLD, Math.min(c.dam * 5, 300), { msg: c.msg });
  /* Occasional side-effects for powerful cold attacks. */
  if (c.power >= 80) {
    if (c.rng.randint0(c.dam) > 500) {
      c.msg("The cold seeps into your bones.");
      c.drainStat(STAT.DEX);
    }
    if (c.rng.randint0(c.dam) > 500) {
      c.drainLife(c.dam, "The cold withers your life force!");
    }
  }
};

const pois: PlayerSideHandler = (c) => {
  if (!c.incTimed(TMD.POISONED, 10 + c.rng.randint1(c.dam), true)) {
    c.msg("You resist the effect!");
  }
  /* Occasional side-effects for powerful poison attacks. */
  if (c.power >= 60) {
    if (c.rng.randint0(c.dam) > 200) {
      if (!c.isImmune(ELEM.ACID)) {
        const acidDam = Math.trunc(c.dam / 5);
        c.msg("The venom stings your skin!");
        invenDamage(c.state, ELEM.ACID, acidDam, { msg: c.msg });
        /* adjust_dam(PROJ_ACID) calls minus_ac(p): a real armour-damage
         * roll (message + to_a-- + PU_BONUS) that also halves the sting
         * (project-player.c L232 -> adjust_dam L69). P2. */
        const hitAc = minusAc(c.p(), c.state.gear, c.state.rng, {
          msg: c.msg,
          describe: (o) => describeObject(c.state, o, ODESC.BASE),
          updateBonuses: () => c.state.updateBonuses?.(),
        });
        c.xtra += adjustDam(
          c.state.rng,
          c.deps.projections,
          PROJ.ACID,
          acidDam,
          "randomise",
          c.deps.actor.resistLevel(ELEM.ACID),
          hitAc,
        );
      }
    }
    if (c.rng.randint0(c.dam) > 200) {
      c.msg("The stench sickens you.");
      c.drainStat(STAT.CON);
    }
  }
};

const light: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.LIGHT)) {
    c.msg("You resist the effect!");
    return;
  }
  c.incTimed(TMD.BLIND, 2 + c.rng.randint1(5), true);
  if (c.dam > 300) {
    /* Check for resistance before issuing the message. */
    if (c.incCheck(TMD.CONFUSED)) c.msg("You are dazzled!");
    c.incTimed(TMD.CONFUSED, 2 + c.rng.randint1(Math.trunc(c.dam / 100)), true);
  }
};

/** project_player_handler_DARK (project-player.c:268). */
const dark: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.DARK)) {
    c.msg("You resist the effect!");
    return;
  }
  c.incTimed(TMD.BLIND, 2 + c.rng.randint1(5), true);
  /* Unresisted dark from powerful monsters is bad news. */
  if (c.power >= 70) {
    if (c.rng.randint0(c.dam) > 100) {
      c.drainLife(c.dam, "The darkness steals your life force!");
    }
    if (c.rng.randint0(c.dam) > 200) {
      c.msg("You feel unsure of yourself in the darkness.");
      c.incTimed(TMD.SLOW, Math.trunc(c.dam / 100), false);
    }
    if (c.rng.randint0(c.dam) > 300) {
      c.msg("Darkness penetrates your mind!");
      c.incTimed(TMD.AMNESIA, Math.trunc(c.dam / 100), false);
    }
  }
};

const darkWeak: PlayerSideHandler = (c) => {
  /* project-player.c project_player_handler_DARK_WEAK: unlit races resist
   * silently; everyone else who resists gets the message; the rest are
   * briefly blinded. */
  if (c.resists(ELEM.DARK)) {
    if (!(c.state.playerState?.pflags.has(PF.UNLIGHT) ?? false)) {
      c.msg("You resist the effect!");
    }
    return;
  }
  c.incTimed(TMD.BLIND, 3 + c.rng.randint1(5), true);
};

const sound: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.SOUND)) {
    c.msg("You resist the effect!");
    return;
  }
  if (!playerOfHas(c.state, OF.PROT_STUN)) {
    c.incTimed(TMD.STUN, Math.min(5 + c.rng.randint1(Math.trunc(c.dam / 3)), 35), true);
  } else {
    equipLearnFlag(c.p(), c.state.runeEnv, OF.PROT_STUN);
  }
  if (c.dam > 300) {
    /* Check for resistance before issuing the message. */
    if (c.incCheck(TMD.CONFUSED)) c.msg("The noise disorients you.");
    c.incTimed(TMD.CONFUSED, 2 + c.rng.randint1(Math.trunc(c.dam / 100)), true);
  }
};

const shard: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.SHARD)) {
    c.msg("You resist the effect!");
    return;
  }
  c.incTimed(TMD.CUT, c.rng.randint1(c.dam), false);
};

const nexus: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.NEXUS)) {
    c.msg("You resist the effect!");
    return;
  }
  /* Stat scramble unless saved. */
  if (c.rng.randint0(100) < (c.state.actor.combat.skills[SKILL.SAVE] ?? 0)) {
    c.msg("You avoid the effect!");
  } else {
    c.incTimed(TMD.SCRAMBLE, c.rng.randint0(20) + 20, true);
  }
  const tp = c.deps.teleport ?? {};
  if (c.rng.oneIn(3) && c.proj.origin.isMonster && c.proj.origin.grid) {
    /* Teleport to the caster. */
    teleportPlayerTo(c.state, c.proj.origin.grid, tp, c.msg);
  } else if (c.rng.oneIn(4)) {
    /* Teleport level. */
    if (c.rng.randint0(100) < (c.state.actor.combat.skills[SKILL.SAVE] ?? 0)) {
      c.msg("You avoid the effect!");
      return;
    }
    teleportPlayerLevel(c.state, tp, c.msg, c.proj.origin.isMonster);
  } else {
    /* Teleport 200 grids. */
    teleportPlayer(c.state, 200, tp, c.msg);
  }
};

const nether: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.NETHER) || playerOfHas(c.state, OF.HOLD_LIFE)) {
    c.msg("You resist the effect!");
    equipLearnFlag(c.p(), c.state.runeEnv, OF.HOLD_LIFE);
    return;
  }
  const drain =
    200 + Math.trunc(c.p().exp / 100) * c.deps.lifeDrainPercent;
  c.msg("You feel your life force draining away!");
  playerExpLose(c.p(), drain, false, c.deps.expDeps);
  if (c.power >= 80) {
    if (c.rng.randint0(c.dam) > 100 && c.p().msp) {
      c.msg("Your mind is dulled.");
      c.p().csp -= Math.min(c.p().csp, Math.trunc(c.dam / 10));
    }
    if (c.rng.randint0(c.dam) > 200) {
      c.msg("Your energy is sapped!");
      c.state.actor.energy = 0;
    }
  }
};

const chaos: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.CHAOS)) {
    c.msg("You resist the effect!");
    return;
  }
  c.incTimed(TMD.IMAGE, c.rng.randint1(10), false);
  c.incTimed(TMD.CONFUSED, 10 + c.rng.randint0(20), true);
  if (!playerOfHas(c.state, OF.HOLD_LIFE)) {
    const drain =
      Math.trunc((c.p().exp * 3) / 200) * c.deps.lifeDrainPercent;
    c.msg("You feel your life force draining away!");
    playerExpLose(c.p(), drain, false, c.deps.expDeps);
  } else {
    equipLearnFlag(c.p(), c.state.runeEnv, OF.HOLD_LIFE);
  }
};

const disen: PlayerSideHandler = (c) => {
  if (c.resists(ELEM.DISEN)) {
    c.msg("You resist the effect!");
    return;
  }
  /* Disenchant gear (effect_simple(EF_DISENCHANT)). */
  disenchantEquipment(c.state, { msg: c.msg });
};

const water: PlayerSideHandler = (c) => {
  c.incTimed(TMD.CONFUSED, 5 + c.rng.randint1(5), true);
  c.incTimed(TMD.STUN, c.rng.randint1(40), true);
};

const ice: PlayerSideHandler = (c) => {
  if (!c.isImmune(ELEM.COLD)) {
    invenDamage(c.state, ELEM.COLD, Math.min(c.dam * 5, 300), { msg: c.msg });
  }
  if (!c.resists(ELEM.SHARD)) {
    c.incTimed(TMD.CUT, c.rng.damroll(5, 8), false);
  } else {
    c.msg("You resist the effect!");
  }
  c.incTimed(TMD.STUN, c.rng.randint1(15), true);
};

const gravity: PlayerSideHandler = (c) => {
  c.msg("Gravity warps around you.");
  /* Blink (effect_simple(EF_TELEPORT, "5")). */
  if (c.rng.randint1(127) > c.p().lev) {
    teleportPlayer(c.state, 5, c.deps.teleport ?? {}, c.msg);
  }
  c.incTimed(TMD.SLOW, 4 + c.rng.randint0(4), false);
  if (!playerOfHas(c.state, OF.PROT_STUN)) {
    c.incTimed(TMD.STUN, Math.min(5 + c.rng.randint1(Math.trunc(c.dam / 3)), 35), true);
  } else {
    equipLearnFlag(c.p(), c.state.runeEnv, OF.PROT_STUN);
  }
};

const inertia: PlayerSideHandler = (c) => {
  c.incTimed(TMD.SLOW, 4 + c.rng.randint0(4), false);
};

const force: PlayerSideHandler = (c) => {
  let centre = c.proj.origin.grid ?? c.proj.grid;

  /* Player gets pushed in a random direction if on the trap. */
  if (c.proj.origin.isTrap && locEq(c.state.actor.grid, centre)) {
    centre = locSum(centre, DDGRID_DDD[c.rng.randint0(8)]!);
  }

  c.incTimed(TMD.STUN, c.rng.randint1(20), true);

  /* Thrust player away. */
  thrustAway(c.state, centre, c.proj.grid, 3 + Math.trunc(c.dam / 20), {
    msg: c.msg,
    ...(c.deps.teleport?.onPlayerPostMove
      ? {
          onPlayerPostMove: (): void =>
            c.deps.teleport!.onPlayerPostMove!(true),
        }
      : {}),
  });
};

const time: PlayerSideHandler = (c) => {
  if (c.rng.oneIn(2)) {
    const drain =
      100 + Math.trunc(c.p().exp / 100) * c.deps.lifeDrainPercent;
    c.msg("You feel your life force draining away!");
    playerExpLose(c.p(), drain, false, c.deps.expDeps);
  } else if (!c.rng.oneIn(5)) {
    /* Drain two random stats (project_player_drain_stats(2): no sustain). */
    c.drainStatsRandom(2);
  } else {
    c.msg("You're not as powerful as you used to be...");
    for (let i = 0; i < STAT_MAX; i++) playerStatDec(c.p(), i, false);
  }
};

const plasma: PlayerSideHandler = (c) => {
  if (!playerOfHas(c.state, OF.PROT_STUN)) {
    c.incTimed(
      TMD.STUN,
      Math.min(5 + c.rng.randint1(Math.trunc((c.dam * 3) / 4)), 35),
      true,
    );
  } else {
    equipLearnFlag(c.p(), c.state.runeEnv, OF.PROT_STUN);
  }
};

/**
 * project_player_handler_f[]: the per-projection player side effects, keyed by
 * projection CODE.
 *
 * KEYED BY CODE, NOT BY PROJ VALUE, and the same way project_f's and
 * project_o's tables are. A mod's own projection is appended to the bound
 * projection table at a slot core never compiled in, so a numeric key would put
 * its handler somewhere nothing looks; the code is the identity that survives.
 *
 * A projection with NO entry does nothing to the player, which is upstream's
 * empty handler and is why there is no default arm here to write.
 */
export const PLAYER_SIDE_HANDLERS: ReadonlyMap<string, PlayerSideHandler> =
  new Map<string, PlayerSideHandler>([
    ["ACID", packOnly(ELEM.ACID)],
    ["ELEC", packOnly(ELEM.ELEC)],
    ["FIRE", fire],
    ["COLD", cold],
    ["POIS", pois],
    ["LIGHT", light],
    ["DARK", dark],
    ["DARK_WEAK", darkWeak],
    ["SOUND", sound],
    ["SHARD", shard],
    ["NEXUS", nexus],
    ["NETHER", nether],
    ["CHAOS", chaos],
    ["DISEN", disen],
    ["WATER", water],
    ["ICE", ice],
    ["GRAVITY", gravity],
    ["INERTIA", inertia],
    ["FORCE", force],
    ["TIME", time],
    ["PLASMA", plasma],
  ]);

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
      /* player_set_timed's "don't mention what already matches known player
       * state" suppression (player-timed.c:828-839). Unsupplied, it never
       * fired. */
      notifyQueries: notifyQueries,
      /* player_inc_timed's `check` argument is honoured ONLY through this hook
       * (player/timed.ts:391). Without it every projection side effect applied
       * regardless of the player's flags and resists: Free Action did not stop
       * a paralysing breath, PROT_CONF did not stop confusion, PROT_BLIND did
       * not stop blindness. The `check` argument was being passed and dropped.
       *
       * The draw for `v` happens at the call site before this runs, so gating
       * the application does not move the RNG stream. */
      incCheck,
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
  /* The equip-learn half of player_inc_check's side effects. This used to pass
   * NO hooks, so a monster's light or sound breath that you shrugged off taught
   * you nothing - upstream's non-lore branch runs equip_learn_flag /
   * equip_learn_element unconditionally (player-timed.c:945, :967, :985).
   *
   * The cave->mon_current half (update_smart_learn and "You resist the
   * effect!") is NOT supplied here: this closure is built once per game, while
   * the acting monster is per projection, so it needs the origin threaded down.
   * Named rather than quietly dropped - see game-project-player.yaml. */
  /**
   * cave->mon_current for the projection currently being resolved. The hook
   * below is built once per game while the acting monster is per projection, so
   * the returned handler stamps it on entry and the inc-check hooks read it
   * here. Null for a trap or a player-sourced projection, which is what makes
   * update_smart_learn and "You resist the effect!" correctly stay silent.
   */
  const notifyQueries = makeTimedNotifyQueries(state);
  let currentSource: Monster | null = null;
  const incCheck = (idx: number): boolean => {
    const effect = deps.timed[idx];
    if (!effect) return true;
    return playerIncCheck(
      effect,
      incCheckQueries,
      makeIncCheckHooks(state, {
        ...(deps.msg ? { msg: deps.msg } : {}),
        monster: currentSource,
      }),
    );
  };

  /**
   * effect_simple(EF_DRAIN_STAT) slice (effect-handler-general.c L803-846): the
   * sustain saves the stat with "You feel very %s for a moment, but the feeling
   * passes.", otherwise the stat drops with "You feel very %s." (the dice value
   * is 0 at these call sites, so there is no bonus damage / take_hit). Both
   * branches learn the sustain rune. P3.
   */
  const drainStat = (stat: number): void => {
    const flag = OF.SUST_STR + stat;
    const negAdj = STAT_NEG_ADJECTIVE[stat] ?? "bad";
    if (sustained(state, stat)) {
      equipLearnFlag(p(), state.runeEnv, flag);
      msg(`You feel very ${negAdj} for a moment, but the feeling passes.`);
      return;
    }
    if (playerStatDec(p(), stat, false)) {
      equipLearnFlag(p(), state.runeEnv, flag);
      msg(`You feel very ${negAdj}.`);
    }
  };

  /**
   * project_player_drain_stats(num) (project-player.c L111-130): drain `num`
   * random stats with NO sustain check and ALWAYS the "You're not as %s as you
   * used to be..." line - distinct from EF_DRAIN_STAT above. Used by TIME. Draws
   * randint1(5) per point exactly as upstream (stat pick doubles as the word). P3.
   */
  const drainStatsRandom = (num: number): void => {
    for (let i = 0; i < num; i++) {
      const stat = state.rng.randint1(5) - 1;
      msg(`You're not as ${STAT_ADJECTIVE[stat] ?? "good"} as you used to be...`);
      playerStatDec(p(), stat, false);
    }
  };

  /**
   * Life drain with the HOLD_LIFE gate. The resisted branch only learns the
   * HOLD_LIFE rune - it prints NO message (project-player.c COLD L204-205 /
   * DARK: equip_learn_flag only). P4.
   */
  const drainLife = (amount: number, text: string): void => {
    if (playerOfHas(state, OF.HOLD_LIFE)) {
      equipLearnFlag(p(), state.runeEnv, OF.HOLD_LIFE);
    } else {
      msg(text);
      playerExpLose(p(), amount, false, deps.expDeps);
    }
  };

  return (ctx: ProjectPlayerSideContext): number => {
    /* Stamp cave->mon_current for this projection before any handler runs. */
    const srcIdx = ctx.origin.monster ?? 0;
    /* The `> 0` mirrors upstream's `cave->mon_current > 0` and is REDUNDANT
     * here - index 0 of state.monsters is the null sentinel, so the lookup
     * returns null either way. Kept for structural fidelity, and recorded
     * because a mutation that drops it survives the suite on purpose. */
    currentSource = srcIdx > 0 ? (state.monsters[srcIdx] ?? null) : null;

    /* This was a 21-case switch until 2026-08-09; it is now a lookup in
     * PLAYER_SIDE_HANDLERS, which a mod can replace through
     * `deps.playerHandlers`. Every arm, every message and every rng draw is
     * unchanged - the 6,912 vectors in player-side-vectors.json are replayed
     * against it for exactly that reason. */
    const code = projectionCodeFor(ctx.typ, deps.projections);
    const table = deps.playerHandlers ?? PLAYER_SIDE_HANDLERS;
    const handler = code === undefined ? undefined : table.get(code);
    /* A projection with no handler does nothing to the player: upstream's
     * empty project_player_handler_ entries, and the default arm the switch
     * used to spell out. */
    if (!handler) return 0;

    const c: PlayerSideCtx = {
      state,
      deps,
      proj: ctx,
      dam: ctx.dam,
      power: ctx.power,
      rng: state.rng,
      p,
      msg,
      incTimed,
      incCheck,
      isImmune,
      resists,
      drainStat,
      drainStatsRandom,
      drainLife,
      xtra: 0,
    };
    handler(c);
    return c.xtra;
  };
}
