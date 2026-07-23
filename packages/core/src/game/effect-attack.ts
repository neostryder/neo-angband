/**
 * The attack effect handlers, ported from reference/src/effect-handler-attack.c
 * (Angband 4.2.6): the EF_BOLT / BEAM / BOLT_OR_BEAM / LINE / ALTER / BALL /
 * BREATH / ARC / SHORT_BEAM / SPOT / SPHERE / STRIKE / STAR / STAR_BALL / SWARM
 * / TOUCH / TOUCH_AWARE / PROJECT_LOS family. Each reads its damage and
 * parameters from the effect handler context and dispatches a projection
 * through the casting spine (game/project-cast.ts), which wires project() to the
 * two projection drivers over the live GameState.
 *
 * These handlers cannot live in effects/handlers.ts: they need the GameState
 * (the layering rule keeps effects/ below game/). Instead they are registered
 * into the EffectRegistry from here with registerAttackHandlers, overriding the
 * NOT_IMPLEMENTED stubs registerCoreHandlers installed. They find their game
 * environment on context.env.game (a GameEffectEnv the caller attaches with
 * attachGameEnv, effect-game-env.ts); with no such env they no-op (the
 * worldless rule).
 *
 * Both the player and monster paths are complete. resolveAimedTarget
 * (project-cast.ts) resolves a monster caster's aim through monsterGetTarget:
 * confusion's random-direction draw, then a targeted monster, the decoy, or
 * the player. LASH picks its target directly (no get_target draw). breath_dam
 * scales a monster breath by the breather's hitpoints, and the powerful-monster
 * radius bonus is applied for ball/breath. Trap / object / chest origins for
 * attack projections are rare and resolve to a bare source.
 */

import { EF, PROJ, TMD } from "../generated";
import type { Loc } from "../loc";
import { monsterIsPowerful } from "../mon/predicate";
import { breathDam } from "../mon/spell";
import { DIR_TARGET, effectCalculateValue } from "../effects/interpreter";
import type {
  EffectHandler,
  EffectRegistry,
  Source,
} from "../effects/interpreter";
import {
  damageEffectApplyToPlayer,
  handleDAMAGE as baseHandleDAMAGE,
} from "../effects/handlers";
import { gameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import {
  caveFindDecoy,
  destroyDecoy,
  monTakeNonplayerHit,
  monsterIsDecoyed,
  monsterTargetMonster,
} from "./effect-mon-origin";
import {
  castAlter,
  castArc,
  castBall,
  castBeam,
  castBolt,
  castBreath,
  castLash,
  castLine,
  castProjectLos,
  castProjection,
  castShortBeam,
  castSpot,
  castSphere,
  castStar,
  castStarBall,
  castStrike,
  castSwarm,
  castTouch,
  monsterCastSource,
  playerCastSource,
  resolveAimedTarget,
} from "./project-cast";
import type { CastSource } from "./project-cast";
import { PROJECT, projectable } from "../world/project";

/** Build a CastSource from the effect origin. */
function sourceFor(env: GameEffectEnv, origin: Source): CastSource {
  switch (origin.what) {
    case "player":
      return playerCastSource(env.state, env.charm !== undefined ? { charm: env.charm } : {});
    case "monster":
      return monsterCastSource(env.state, origin.monster);
    default:
      /* Trap / object / chest / none: a bare player-grid source (PLAY added by
       * the shape helper for a non-player source). */
      return {
        isPlayer: false,
        isMonster: false,
        monster: 0,
        grid: env.state.actor.grid,
        killer: origin.what === "trap" ? "a trap" : "a bug",
        isTrap: origin.what === "trap",
      };
  }
}

/** Whether the player is currently blind. */
function playerBlind(env: GameEffectEnv): boolean {
  return (env.cast.playerActor.timed[TMD.BLIND] ?? 0) > 0;
}

/** The player's level, for the level-scaled radius bonuses. */
function playerLevel(env: GameEffectEnv): number {
  return env.state.actor.player.lev;
}

/* ------------------------------------------------------------------ *
 * The handlers. Each returns true (the effect "ran") as upstream.
 * ------------------------------------------------------------------ */

const handleBOLT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  castBolt(env.state, env.cast, source, grid, dam, ctx.subtype);
  if (!playerBlind(env)) ctx.ident = true;
  return true;
};

const handleBEAM: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  castBeam(env.state, env.cast, source, grid, dam, ctx.subtype);
  if (!playerBlind(env)) ctx.ident = true;
  return true;
};

/**
 * EF_BOLT_STATUS / EF_BOLT_STATUS_DAM: as BOLT, but only identifies on
 * noticing an effect (project() reporting something visible happened). The
 * two are distinct upstream codes purely to aid effect descriptions.
 */
const handleBoltStatusFlagged =
  (extraFlg: number): EffectHandler =>
  (ctx) => {
    const env = gameEnv(ctx);
    if (!env) return true;
    const dam = effectCalculateValue(ctx, true);
    const source = sourceFor(env, ctx.origin);
    const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
    if (castBolt(env.state, env.cast, source, grid, dam, ctx.subtype, extraFlg))
      ctx.ident = true;
    return true;
  };

const handleBOLT_STATUS: EffectHandler = handleBoltStatusFlagged(0);

/**
 * EF_BOLT_AWARE (effect-handler-attack.c:398-406): as BOLT_STATUS, but adds
 * PROJECT_AWARE when the caster is aware of the effect, so the hit registers as
 * "obvious" (project-mon.c:1339) and does not try to ID its own source.
 */
const handleBOLT_AWARE: EffectHandler = (ctx) =>
  handleBoltStatusFlagged(ctx.aware ? PROJECT.AWARE : 0)(ctx);

const handleBOLT_OR_BEAM: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const beam = ctx.beam + ctx.other;
  return env.state.rng.randint0(100) < beam ? handleBEAM(ctx) : handleBOLT(ctx);
};

const handleLINE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  if (castLine(env.state, env.cast, source, grid, dam, ctx.subtype)) ctx.ident = true;
  return true;
};

const handleALTER: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  if (castAlter(env.state, env.cast, source, grid, ctx.subtype)) ctx.ident = true;
  return true;
};

const handleBALL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);

  let rad = ctx.radius ? ctx.radius : 2;
  if (source.isMonster) {
    const mon = env.state.monsters[source.monster];
    if (mon && monsterIsPowerful(mon)) rad++;
  } else if (source.isPlayer && ctx.other) {
    rad += Math.trunc(playerLevel(env) / ctx.other);
  }

  const aimedAtTarget = source.isPlayer && ctx.dir === DIR_TARGET && env.aimed !== undefined;
  if (castBall(env.state, env.cast, source, grid, dam, ctx.subtype, rad, { aimedAtTarget }))
    ctx.ident = true;
  return true;
};

const handleBREATH: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  /* A player breath uses the dice value; a monster breath scales with the
   * breather's current hitpoints (breath_dam, mon/spell.ts). */
  let dam = effectCalculateValue(ctx, false);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);

  let powerful = false;
  if (source.isMonster) {
    const mon = env.state.monsters[source.monster];
    if (mon) {
      powerful = monsterIsPowerful(mon);
      const proj = env.cast.projections[ctx.subtype];
      if (proj) dam = breathDam(proj, mon.hp);
    }
  } else if (source.isPlayer) {
    /* A3 (effect-handler-attack.c:740-741): a player breath announces itself.
     * msgt channel rides projections[type].msgt (display); the text is the
     * parity artifact. */
    const proj = env.cast.projections[ctx.subtype];
    if (proj) ctx.env.messages?.msg(`You breathe ${proj.desc}.`);
  }

  const opts: { radius?: number; powerful?: boolean } = { powerful };
  if (ctx.radius) opts.radius = ctx.radius;
  if (castBreath(env.state, env.cast, source, grid, dam, ctx.subtype, ctx.other, opts))
    ctx.ident = true;
  return true;
};

const handleARC: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  /* A1 (effect-handler-attack.c:811-814): a monster ARC targets the player's
   * grid directly with NO random draw - unlike BREATH/BOLT/BALL it has no
   * confused-dir / target-monster branch. Routing it through resolveAimedTarget
   * (monsterGetTarget) would inject a spurious randint1(100) and desync the RNG.
   * Player and no-source cases keep the ordinary target resolution. */
  const grid = source.isMonster
    ? env.state.actor.grid
    : resolveAimedTarget(env.state, source, ctx.dir, env.aimed).grid;
  if (castArc(env.state, env.cast, source, grid, dam, ctx.subtype, ctx.radius, ctx.other))
    ctx.ident = true;
  return true;
};

const handleSHORT_BEAM: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, false);
  const source = sourceFor(env, ctx.origin);
  /* A2 (effect-handler-attack.c:868-870): as with ARC, a monster SHORT_BEAM
   * targets the player's grid directly with no random draw. */
  const grid = source.isMonster
    ? env.state.actor.grid
    : resolveAimedTarget(env.state, source, ctx.dir, env.aimed).grid;
  const addons = source.isPlayer && ctx.other > 0;
  const rad = ctx.radius + (addons ? Math.trunc(playerLevel(env) / ctx.other) : 0);
  if (castShortBeam(env.state, env.cast, source, grid, dam, ctx.subtype, rad))
    ctx.ident = true;
  return true;
};

const handleSPOT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, false);
  const source = sourceFor(env, ctx.origin);
  let rad = ctx.radius ? ctx.radius : 0;
  if (ctx.other && source.isPlayer) rad += Math.trunc(playerLevel(env) / ctx.other);
  if (castSpot(env.state, env.cast, source, dam, ctx.subtype, rad)) ctx.ident = true;
  return true;
};

const handleSPHERE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, false);
  const source = sourceFor(env, ctx.origin);
  const rad = ctx.radius ? ctx.radius : 0;
  const diameter = ctx.other ? ctx.other : 0;
  if (castSphere(env.state, env.cast, source, dam, ctx.subtype, rad, diameter))
    ctx.ident = true;
  return true;
};

const handleSTRIKE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  /* STRIKE targets the acquired grid, but reverts to the player if that grid is
   * not projectable from the player (effect-handler-attack.c L1012-1016). A5. */
  let target = env.state.actor.grid;
  if (source.isPlayer && ctx.dir === DIR_TARGET && env.aimed) {
    target = env.aimed;
    if (
      !projectable(
        env.state.chunk,
        env.state.actor.grid,
        target,
        PROJECT.NONE,
        env.state.z.maxRange,
      )
    ) {
      target = env.state.actor.grid;
    }
  }
  if (castStrike(env.state, env.cast, source, target, dam, ctx.subtype, ctx.radius))
    ctx.ident = true;
  return true;
};

const handleSTAR: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  if (castStar(env.state, env.cast, source, dam, ctx.subtype)) ctx.ident = true;
  return true;
};

const handleSTAR_BALL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  if (castStarBall(env.state, env.cast, source, dam, ctx.subtype, ctx.radius))
    ctx.ident = true;
  return true;
};

/**
 * EF_LASH: crack a whip, or spit at the player - a finite-length beam whose
 * element comes from the monster's first blow (lash_type, default MISSILE)
 * and whose damage sums the full first blow plus half of every other blow.
 * Monsters only. LASH picks its target directly (not through get_target, so
 * no confused-direction draw): another targeted monster, else the player's
 * decoy if the caster can see it, else the player.
 */
const handleLASH: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  let dam = effectCalculateValue(ctx, false);

  /* Monsters only */
  if (ctx.origin.what !== "monster") return false;
  const { state } = env;
  const mon = state.monsters[ctx.origin.monster];
  if (!mon) return false;

  const source = sourceFor(env, ctx.origin);

  /* Target player or monster? (project-cast marks the non-player source so
   * PROJECT_PLAY is set, matching the upstream flg |= PROJECT_PLAY.) */
  const tMon = monsterTargetMonster(state, ctx.origin.monster);
  let target: Loc;
  if (tMon) {
    target = tMon.grid;
  } else if (monsterIsDecoyed(state, mon)) {
    target = caveFindDecoy(state) ?? state.actor.grid;
  } else {
    target = state.actor.grid;
  }

  /* Paranoia */
  let rad = ctx.radius;
  if (rad > env.cast.maxRange) rad = env.cast.maxRange;

  /* Get the type (default is PROJ_MISSILE) */
  const lashName = mon.race.blows[0]?.effect.lashType ?? null;
  const typ =
    lashName !== null
      ? (PROJ[lashName as keyof typeof PROJ] ?? PROJ.MISSILE)
      : PROJ.MISSILE;

  /* Scan through all blows: full damage of the first, half of the others. */
  for (let i = 0; i < mon.race.blows.length; i++) {
    const dice = mon.race.blows[i]!.dice;
    const roll = dice ? dice.roll(state.rng) : 0;
    dam += Math.trunc(roll / (i ? 2 : 1));
  }

  /* No damaging blows */
  if (!dam) return false;

  if (castLash(env.state, env.cast, source, target, dam, typ, rad))
    ctx.ident = true;
  return true;
};

const handleSWARM: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  const num = ctx.value.mBonus;
  if (castSwarm(env.state, env.cast, source, grid, dam, ctx.subtype, ctx.radius, num))
    ctx.ident = true;
  return true;
};

const handleTOUCH: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const rad = ctx.radius ? ctx.radius : 1;

  /* A4 (effect-handler-attack.c:416-434): a monster TOUCH does not always hit
   * the player - it strikes the player's decoy (trap-sourced), or another
   * monster it is targeting, before falling through to the player. The grid ball
   * uses GRID|KILL|HIDE|ITEM|THRU. */
  if (ctx.origin.what === "monster") {
    const { state } = env;
    const flg =
      PROJECT.GRID | PROJECT.KILL | PROJECT.HIDE | PROJECT.ITEM | PROJECT.THRU;
    const decoy = caveFindDecoy(state);
    if (decoy) {
      const trapSource: CastSource = {
        isPlayer: false,
        isMonster: false,
        monster: 0,
        grid: decoy,
        isTrap: true,
        killer: "a trap",
      };
      return castProjection(state, env.cast, trapSource, decoy, dam, ctx.subtype, flg, rad);
    }
    const tMon = monsterTargetMonster(state, ctx.origin.monster);
    if (tMon) {
      /* C sources the ball at mon->target.midx (the target monster itself),
       * not the caster (effect-handler-attack.c L431). */
      const monSource = monsterCastSource(state, tMon.midx);
      return castProjection(state, env.cast, monSource, tMon.grid, dam, ctx.subtype, flg, rad);
    }
  }

  const source = sourceFor(env, ctx.origin);
  if (castTouch(env.state, env.cast, source, dam, ctx.subtype, rad, false))
    ctx.ident = true;
  return true;
};

const handleTOUCH_AWARE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  if (castTouch(env.state, env.cast, source, dam, ctx.subtype, ctx.radius, ctx.aware))
    ctx.ident = true;
  return true;
};

const makeProjectLos = (aware: boolean): EffectHandler => (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, ctx.other ? true : false);
  /* A6/A9 (effect-handler-attack.c:1088-1159). PROJECT_LOS: LOS from the
   * ORIGIN's grid (origin_get_loc - the monster's grid when a monster casts
   * it). PROJECT_LOS_AWARE: gates on square_isview (the player's FOV) and adds
   * PROJECT_AWARE when the caster is aware. Both ALWAYS project from
   * source_player() (the "hack - NRM"): damage is attributed to the player. */
  const opts: {
    originGrid?: Loc;
    excludeMonster?: number;
    useView?: boolean;
    aware?: boolean;
  } = aware
    ? { useView: true, aware: ctx.aware }
    : { originGrid: sourceFor(env, ctx.origin).grid };
  if (env.monCurrent !== undefined) opts.excludeMonster = env.monCurrent;
  castProjectLos(env.state, env.cast, playerCastSource(env.state), dam, ctx.subtype, opts);
  ctx.ident = true;
  return true;
};

/**
 * EF_WONDER (L1988): a random effect chosen by the die roll (the chain's
 * dice add plev/5, so the worst results fade with experience). Each row
 * re-dispatches to another registered handler with a synthetic context,
 * exactly upstream's direct effect_handler_* calls; the very rare tail
 * (die >= 110) runs the dispel/slow/sleep/heal effect_simple batch.
 */
const handleWONDER: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const plev = env.state.actor.player.lev;
  const die = effectCalculateValue(ctx, false);
  let subtype = 0;
  let radius = 0;
  let beam = ctx.beam;
  let code = 0;
  const value = { base: 0, dice: 0, sides: 0, mBonus: 0 };

  ctx.ident = true;

  if (die > 100) ctx.env.messages?.msg("You feel a surge of power!");

  if (die < 8) {
    subtype = PROJ.MON_CLONE;
    code = EF.BOLT;
  } else if (die < 14) {
    subtype = PROJ.MON_SPEED;
    value.base = 100;
    code = EF.BOLT;
  } else if (die < 26) {
    subtype = PROJ.MON_HEAL;
    value.dice = 4;
    value.sides = 6;
    code = EF.BOLT;
  } else if (die < 31) {
    subtype = PROJ.MON_POLY;
    value.base = plev;
    code = EF.BOLT;
  } else if (die < 36) {
    beam -= 10;
    subtype = PROJ.MISSILE;
    value.dice = 3 + Math.trunc((plev - 1) / 5);
    value.sides = 4;
    code = EF.BOLT_OR_BEAM;
  } else if (die < 41) {
    subtype = PROJ.MON_CONF;
    value.base = plev;
    code = EF.BOLT;
  } else if (die < 46) {
    subtype = PROJ.POIS;
    value.base = 20 + Math.trunc(plev / 2);
    radius = 3;
    code = EF.BALL;
  } else if (die < 51) {
    subtype = PROJ.LIGHT_WEAK;
    value.dice = 6;
    value.sides = 8;
    code = EF.LINE;
  } else if (die < 56) {
    subtype = PROJ.ELEC;
    value.dice = 3 + Math.trunc((plev - 5) / 6);
    value.sides = 6;
    code = EF.BEAM;
  } else if (die < 61) {
    beam -= 10;
    subtype = PROJ.COLD;
    value.dice = 5 + Math.trunc((plev - 5) / 4);
    value.sides = 8;
    code = EF.BOLT_OR_BEAM;
  } else if (die < 66) {
    subtype = PROJ.ACID;
    value.dice = 6 + Math.trunc((plev - 5) / 4);
    value.sides = 8;
    code = EF.BOLT_OR_BEAM;
  } else if (die < 71) {
    subtype = PROJ.FIRE;
    value.dice = 8 + Math.trunc((plev - 5) / 4);
    value.sides = 8;
    code = EF.BOLT_OR_BEAM;
  } else if (die < 76) {
    subtype = PROJ.MON_DRAIN;
    value.base = 75;
    code = EF.BOLT;
  } else if (die < 81) {
    subtype = PROJ.ELEC;
    value.base = 30 + Math.trunc(plev / 2);
    radius = 2;
    code = EF.BALL;
  } else if (die < 86) {
    subtype = PROJ.ACID;
    value.base = 40 + plev;
    radius = 2;
    code = EF.BALL;
  } else if (die < 91) {
    subtype = PROJ.ICE;
    value.base = 70 + plev;
    radius = 3;
    code = EF.BALL;
  } else if (die < 96) {
    subtype = PROJ.FIRE;
    value.base = 80 + plev;
    radius = 3;
    code = EF.BALL;
  } else if (die < 101) {
    subtype = PROJ.MON_DRAIN;
    value.base = 100 + plev;
    code = EF.BOLT;
  } else if (die < 104) {
    radius = 12;
    code = EF.EARTHQUAKE;
  } else if (die < 106) {
    radius = 15;
    code = EF.DESTRUCTION;
  } else if (die < 108) {
    code = EF.BANISH;
  } else if (die < 110) {
    subtype = PROJ.DISP_ALL;
    value.base = 120;
    code = EF.PROJECT_LOS;
  }

  const handler = code ? ctx.registry.handlerFor(code) : null;
  if (handler) {
    return handler({
      ...ctx,
      effect: code,
      beam,
      value,
      subtype,
      radius,
      other: 0,
      y: 0,
      x: 0,
      msg: null,
    });
  }

  /* RARE */
  const simple = { origin: ctx.origin } as const;
  ctx.registry.effectSimple(EF.PROJECT_LOS, ctx.env, {
    ...simple,
    diceString: "150",
    subtype: PROJ.DISP_ALL,
  });
  ctx.registry.effectSimple(EF.PROJECT_LOS, ctx.env, {
    ...simple,
    diceString: "20",
    subtype: PROJ.MON_SLOW,
  });
  ctx.registry.effectSimple(EF.PROJECT_LOS, ctx.env, {
    ...simple,
    diceString: "40",
    subtype: PROJ.SLEEP_ALL,
  });
  ctx.registry.effectSimple(EF.HEAL_HP, ctx.env, {
    ...simple,
    diceString: "300",
  });
  return true;
};

/**
 * EF_DAMAGE (effect-handler-attack.c L456): deal damage from the current
 * monster or trap to the player. The game-layer override adds the SRC_MONSTER
 * sub-branches the worldless base cannot reach: a monster casting at another
 * monster (monster_target_monster -> mon_take_nonplayer_hit) or at the
 * player's decoy (square_destroy_decoy). Everything else (player / trap /
 * object / chest / none origins, and a monster origin that falls through to
 * the player) delegates to the base handler so the player take_hit path stays
 * single-sourced.
 */
const handleDAMAGE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env || ctx.origin.what !== "monster") return baseHandleDAMAGE(ctx);

  const { state } = env;
  const dam = effectCalculateValue(ctx, false);

  /* Always ID */
  ctx.ident = true;

  const tMon = monsterTargetMonster(state, ctx.origin.monster);

  /* Damage another monster. */
  if (tMon) {
    monTakeNonplayerHit(env, tMon, dam);
    return true;
  }

  /* Destroy a decoy. */
  if (caveFindDecoy(state)) {
    destroyDecoy(state, env.general?.trapDeps, (t) => state.msg?.(t));
    return true;
  }

  /* Otherwise damage the player. monster_desc(MDESC_DIED_FROM) is deferred
   * (8.9); the caster's race name stands in as the death cause. */
  const mon = state.monsters[ctx.origin.monster];
  const killer = mon ? mon.race.name : "a monster";
  damageEffectApplyToPlayer(ctx, dam, killer);
  return true;
};

/** The attack handlers, keyed by upstream EF code. */
const ATTACK_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.DAMAGE, handleDAMAGE],
  [EF.BOLT, handleBOLT],
  [EF.BEAM, handleBEAM],
  [EF.BOLT_OR_BEAM, handleBOLT_OR_BEAM],
  [EF.BOLT_STATUS, handleBOLT_STATUS],
  [EF.BOLT_STATUS_DAM, handleBOLT_STATUS],
  [EF.BOLT_AWARE, handleBOLT_AWARE],
  [EF.LASH, handleLASH],
  [EF.LINE, handleLINE],
  [EF.ALTER, handleALTER],
  [EF.BALL, handleBALL],
  [EF.BREATH, handleBREATH],
  [EF.ARC, handleARC],
  [EF.SHORT_BEAM, handleSHORT_BEAM],
  [EF.SPOT, handleSPOT],
  [EF.SPHERE, handleSPHERE],
  [EF.STRIKE, handleSTRIKE],
  [EF.STAR, handleSTAR],
  [EF.STAR_BALL, handleSTAR_BALL],
  [EF.SWARM, handleSWARM],
  [EF.TOUCH, handleTOUCH],
  [EF.TOUCH_AWARE, handleTOUCH_AWARE],
  [EF.PROJECT_LOS, makeProjectLos(false)],
  [EF.PROJECT_LOS_AWARE, makeProjectLos(true)],
  [EF.WONDER, handleWONDER],
]);

/**
 * Register the attack projection handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each handler
 * reads its game environment from context.env.game (attach it with
 * attachGameEnv), and no-ops when it is absent.
 */
export function registerAttackHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of ATTACK_HANDLERS) {
    registry.register(code, { handler, status: "partial" });
  }
}

/** The attack EF codes this module registers, by upstream name. */
export const ATTACK_HANDLER_CODES: readonly number[] = [...ATTACK_HANDLERS.keys()];
