/**
 * The shared game-layer effect environment. Game effect handlers (the attack
 * projections in effect-attack.ts, the monster effects in effect-monster.ts,
 * and later batches) need access to the live GameState, which the effects/
 * layer's EffectContext deliberately keeps opaque (the layering rule keeps
 * effects/ below game/). This module owns the concrete environment those
 * handlers read and the plumbing that attaches it to an EffectContext.
 *
 * A handler reads the environment from context.env.game (an opaque slot on
 * EffectContext) via gameEnv(); when it is absent the handler no-ops (the
 * worldless rule the effects/ handlers already follow). The caller attaches it
 * with attachGameEnv after building the base context (game/effect-env.ts
 * buildEffectContext).
 */

import type { Loc } from "../loc";
import type { EffectContext, EffectHandlerContext } from "../effects/interpreter";
import type { TakeHitHooks } from "../player/take-hit";
import type { GameState } from "./context";
import type { CastContext } from "./project-cast";
import type { TeleportEnv } from "./effect-teleport";
import type { GeneralEffectEnv } from "./effect-general";
import type { ItemEffectEnv } from "./effect-item";
import type { SummonEffectEnv } from "./effect-summon";

/** Everything the game-layer effect handlers need beyond the EffectContext. */
export interface GameEffectEnv {
  /** The live game state (monsters, chunk, player actor, rng). */
  state: GameState;
  /** The projection casting context (bound projections, range, player actor). */
  cast: CastContext;
  /**
   * target_get for a DIR_TARGET player cast. The command layers back it
   * with a live getter over game/target.ts (targetOkay + targetGet), so a
   * target that moves or dies mid-chain is re-read per handler exactly as
   * upstream's per-handler target_get; tests may pass a plain grid.
   */
  aimed?: Loc | undefined;
  /** cave->mon_current: the acting monster, excluded by PROJECT_LOS. */
  monCurrent?: number;
  /** player_has(PF_CHARM). */
  charm?: boolean;
  /** take_hit consequences for effects that damage the player (BANISH, ...). */
  takeHitHooks?: TakeHitHooks;
  /**
   * get_com symbol chooser for EF_BANISH: return the chosen monster glyph, or
   * null to abort. Absent means the effect aborts (no UI wired).
   */
  banishSymbol?: () => string | null;
  /** Teleport-family hooks and unmodelled-subsystem seams (effect-teleport.ts). */
  teleport?: TeleportEnv;
  /** General-handler seams: trap access for glyphs/webs (effect-general.ts). */
  general?: GeneralEffectEnv;
  /** Item-targeting seams: get_item and the ego/curse tables (effect-item.ts). */
  item?: ItemEffectEnv;
  /**
   * Per-game flavor knowledge, so an item-identifying effect (EF_IDENTIFY ->
   * object_learn_unknown_rune -> player_know_object) can fire the
   * object_flavor_aware side effect. Absent, awareness is left unchanged (the
   * worldless rule); the ignore/notice consequences ride flavorDeps.
   */
  flavor?: import("../obj/knowledge").FlavorKnowledge;
  /** object_flavor_aware's ignore/notice side effects, used with `flavor`. */
  flavorDeps?: import("../obj/knowledge").FlavorAwareDeps;
  /** Summoning seams: the summon table and live placement (effect-summon.ts). */
  summon?: SummonEffectEnv;
  /**
   * monster_change_shape / monster_revert_shape (game/mon-shape.ts), for
   * the MON_TMD_CHANGED timer (the SHAPECHANGE monster spell). Built by
   * wireGame; absent, the timer stands and the form is unchanged.
   */
  monShape?: import("../mon/timed").MonShapeHooks;
}

/** Attach a game environment to an effect context for the game handlers. */
export function attachGameEnv(
  env: EffectContext,
  game: GameEffectEnv,
): EffectContext {
  return { ...env, game };
}

/** Read the game env off the context, or null for a worldless interpreter. */
export function gameEnv(ctx: EffectHandlerContext): GameEffectEnv | null {
  return (ctx.env.game as GameEffectEnv | undefined) ?? null;
}
