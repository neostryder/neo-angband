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
 * environment on context.env.attack (an AttackEffectEnv the caller attaches
 * with attachAttackEnv); with no such env they no-op (the worldless rule).
 *
 * The player path is complete. The monster-origin refinements that belong to
 * the monster-spell layer are deferred there (#19): confused-direction /
 * target-monster / decoy targeting (resolveAimedTarget targets the player),
 * breath_dam for monster breath (the dice value is used until then), and the
 * powerful-monster ball radius bonus (applied here from monsterIsPowerful for
 * ball, left to #19 for breath diameter). Trap / object / chest origins for
 * attack projections are rare and resolve to a bare source.
 */

import { EF, TMD } from "../generated";
import type { Loc } from "../loc";
import { monsterIsPowerful } from "../mon/predicate";
import { DIR_TARGET, effectCalculateValue } from "../effects/interpreter";
import type {
  EffectContext,
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
  Source,
} from "../effects/interpreter";
import type { GameState } from "./context";
import {
  castAlter,
  castArc,
  castBall,
  castBeam,
  castBolt,
  castBreath,
  castLine,
  castProjectLos,
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
import type { CastContext, CastSource } from "./project-cast";

/** The game environment the attack handlers read from context.env.attack. */
export interface AttackEffectEnv {
  state: GameState;
  cast: CastContext;
  /** target_get result for a DIR_TARGET player cast (targeting deferred, #24). */
  aimed?: Loc;
  /** cave->mon_current: the acting monster, excluded by PROJECT_LOS. */
  monCurrent?: number;
  /** player_has(PF_CHARM). */
  charm?: boolean;
}

/** Attach an attack environment to an effect context for the attack handlers. */
export function attachAttackEnv(
  env: EffectContext,
  attack: AttackEffectEnv,
): EffectContext {
  return { ...env, attack };
}

/** Read the attack env off the context, or null for a worldless interpreter. */
function attackEnv(ctx: EffectHandlerContext): AttackEffectEnv | null {
  return (ctx.env.attack as AttackEffectEnv | undefined) ?? null;
}

/** Build a CastSource from the effect origin. */
function sourceFor(env: AttackEffectEnv, origin: Source): CastSource {
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
        killer: "a bug",
      };
  }
}

/** Whether the player is currently blind. */
function playerBlind(env: AttackEffectEnv): boolean {
  return (env.cast.playerActor.timed[TMD.BLIND] ?? 0) > 0;
}

/** The player's level, for the level-scaled radius bonuses. */
function playerLevel(env: AttackEffectEnv): number {
  return env.state.actor.player.lev;
}

/* ------------------------------------------------------------------ *
 * The handlers. Each returns true (the effect "ran") as upstream.
 * ------------------------------------------------------------------ */

const handleBOLT: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  castBolt(env.state, env.cast, source, grid, dam, ctx.subtype);
  if (!playerBlind(env)) ctx.ident = true;
  return true;
};

const handleBEAM: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  castBeam(env.state, env.cast, source, grid, dam, ctx.subtype);
  if (!playerBlind(env)) ctx.ident = true;
  return true;
};

const handleBOLT_OR_BEAM: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const beam = ctx.beam + ctx.other;
  return env.state.rng.randint0(100) < beam ? handleBEAM(ctx) : handleBOLT(ctx);
};

const handleLINE: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  if (castLine(env.state, env.cast, source, grid, dam, ctx.subtype)) ctx.ident = true;
  return true;
};

const handleALTER: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  if (castAlter(env.state, env.cast, source, grid, ctx.subtype)) ctx.ident = true;
  return true;
};

const handleBALL: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
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
  const env = attackEnv(ctx);
  if (!env) return true;
  /* breath_dam(type, mon->hp) is the monster-spell layer's (#19); the dice
   * value stands in until then. */
  const dam = effectCalculateValue(ctx, false);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);

  let powerful = false;
  if (source.isMonster) {
    const mon = env.state.monsters[source.monster];
    powerful = !!mon && monsterIsPowerful(mon);
  }

  const opts: { radius?: number; powerful?: boolean } = { powerful };
  if (ctx.radius) opts.radius = ctx.radius;
  if (castBreath(env.state, env.cast, source, grid, dam, ctx.subtype, ctx.other, opts))
    ctx.ident = true;
  return true;
};

const handleARC: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  if (castArc(env.state, env.cast, source, grid, dam, ctx.subtype, ctx.radius, ctx.other))
    ctx.ident = true;
  return true;
};

const handleSHORT_BEAM: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, false);
  const source = sourceFor(env, ctx.origin);
  const { grid } = resolveAimedTarget(env.state, source, ctx.dir, env.aimed);
  const addons = source.isPlayer && ctx.other > 0;
  const rad = ctx.radius + (addons ? Math.trunc(playerLevel(env) / ctx.other) : 0);
  if (castShortBeam(env.state, env.cast, source, grid, dam, ctx.subtype, rad))
    ctx.ident = true;
  return true;
};

const handleSPOT: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, false);
  const source = sourceFor(env, ctx.origin);
  let rad = ctx.radius ? ctx.radius : 0;
  if (ctx.other && source.isPlayer) rad += Math.trunc(playerLevel(env) / ctx.other);
  if (castSpot(env.state, env.cast, source, dam, ctx.subtype, rad)) ctx.ident = true;
  return true;
};

const handleSPHERE: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
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
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  /* STRIKE targets the acquired grid if projectable, else the player. */
  const target = source.isPlayer && ctx.dir === DIR_TARGET && env.aimed ? env.aimed : env.state.actor.grid;
  if (castStrike(env.state, env.cast, source, target, dam, ctx.subtype, ctx.radius))
    ctx.ident = true;
  return true;
};

const handleSTAR: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  if (castStar(env.state, env.cast, source, dam, ctx.subtype)) ctx.ident = true;
  return true;
};

const handleSTAR_BALL: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  if (castStarBall(env.state, env.cast, source, dam, ctx.subtype, ctx.radius))
    ctx.ident = true;
  return true;
};

const handleSWARM: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
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
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  if (castTouch(env.state, env.cast, source, dam, ctx.subtype, ctx.radius, false))
    ctx.ident = true;
  return true;
};

const handleTOUCH_AWARE: EffectHandler = (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, true);
  const source = sourceFor(env, ctx.origin);
  if (castTouch(env.state, env.cast, source, dam, ctx.subtype, ctx.radius, ctx.aware))
    ctx.ident = true;
  return true;
};

const makeProjectLos = (aware: boolean): EffectHandler => (ctx) => {
  const env = attackEnv(ctx);
  if (!env) return true;
  const dam = effectCalculateValue(ctx, ctx.other ? true : false);
  const source =
    ctx.origin.what === "player" ? playerCastSource(env.state) : sourceFor(env, ctx.origin);
  const opts: { originGrid?: Loc; excludeMonster?: number } = {};
  if (env.monCurrent !== undefined) opts.excludeMonster = env.monCurrent;
  castProjectLos(env.state, env.cast, source, dam, ctx.subtype, opts);
  ctx.ident = true;
  void aware; /* PROJECT_LOS_AWARE only affects awareness-gated notice (UI). */
  return true;
};

/** The attack handlers, keyed by upstream EF code. */
const ATTACK_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.BOLT, handleBOLT],
  [EF.BEAM, handleBEAM],
  [EF.BOLT_OR_BEAM, handleBOLT_OR_BEAM],
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
]);

/**
 * Register the attack projection handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each handler
 * reads its game environment from context.env.attack (attach it with
 * attachAttackEnv), and no-ops when it is absent.
 */
export function registerAttackHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of ATTACK_HANDLERS) {
    registry.register(code, { handler, status: "partial" });
  }
}

/** The attack EF codes this module registers, by upstream name. */
export const ATTACK_HANDLER_CODES: readonly number[] = [...ATTACK_HANDLERS.keys()];
