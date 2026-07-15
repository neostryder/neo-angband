/**
 * Public API of the Borg flow/pathfinding subsystem (P8.1), a faithful port of
 * reference/src/borg/borg-flow*.c.
 *
 * Two layers are exported:
 *  1. The low-level primitives (borgFlowSpread / Commit / Old / EnqueueGrid /
 *     Clear, borgCanDig, the FlowState + FlowHooks types) for callers that want
 *     to drive the BFS directly.
 *  2. A bound Flow object (createFlow) whose methods take only the BorgContext,
 *     matching the think-ladder-facing shape the P8.6 task will call --
 *     flow.toStairs(ctx, down), flow.toTakes(ctx), flow.toKills(ctx, nearness),
 *     flow.toDark(ctx), etc. Each closes over one persistent FlowState (the
 *     borg_init_flow scratch state, allocated once and reused across thinks).
 *
 * Every method returns the next AgentCommand for this think, or null when the
 * flow does not apply (yield to the next ladder stage).
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import { GOAL_BORE } from "../world/model";
import {
  createFlowState,
  defaultFlowHooks,
  type FlowHooks,
  type FlowState,
} from "./flow";
import {
  borgFlowStairBoth,
  borgFlowStairLess,
  borgFlowStairMore,
} from "./flow-stairs";
import { borgFlowTake, borgFlowTakeScum } from "./flow-take";
import {
  borgFlowKill,
  borgFlowKillAim,
  borgFlowKillCorridor,
  borgFlowKillDirect,
} from "./flow-kill";
import { borgFlowDark } from "./flow-dark";
import { borgFlowGlyph } from "./flow-glyph";
import {
  borgFlowLight,
  borgFlowRecover,
  borgFlowShopEntry,
  borgFlowSpastic,
  borgFlowVault,
  borgFlowVein,
  borgTwitchy,
} from "./flow-misc";

export * from "./flow-consts";
export * from "./flow";
export * from "./flow-stairs";
export * from "./flow-take";
export * from "./flow-kill";
export * from "./flow-dark";
export * from "./flow-glyph";
export * from "./flow-misc";

/**
 * The bound flow facade the think ladder drives. Holds one FlowState; every
 * method realises one C borg_flow_* goal-seed and returns the resulting step.
 */
export interface Flow {
  /** The persistent scratch state (avoidance/tracks/flags are set on this). */
  readonly state: FlowState;

  /** Flow to stairs: down -> borg_flow_stair_more, else borg_flow_stair_less. */
  toStairs(
    ctx: BorgContext,
    down: boolean,
    why?: number,
    sneak?: boolean,
    brave?: boolean,
  ): AgentCommand | null;
  /** borg_flow_stair_both: flee via the nearest usable stair. */
  toStairsBoth(ctx: BorgContext, why?: number, sneak?: boolean): AgentCommand | null;

  /** borg_flow_take: flow to wanted floor objects. */
  toTakes(ctx: BorgContext, viewable?: boolean, nearness?: number): AgentCommand | null;
  /** borg_flow_take_scum. */
  toTakesScum(ctx: BorgContext, viewable?: boolean, nearness?: number): AgentCommand | null;

  /** borg_flow_kill: flow to a monster worth engaging. */
  toKills(ctx: BorgContext, nearness: number, viewable?: boolean): AgentCommand | null;
  /** borg_flow_kill_aim: step to line up a ranged shot. */
  toKillAim(ctx: BorgContext, viewable?: boolean): AgentCommand | null;
  /** borg_flow_kill_corridor: dig an anti-summon corridor. */
  toKillCorridor(ctx: BorgContext): AgentCommand | null;
  /** borg_flow_kill_direct: dig straight to the closest monster. */
  toKillDirect(ctx: BorgContext, twitchy?: boolean): AgentCommand | null;

  /** borg_flow_dark: explore (near methods, else far methods). */
  toDark(ctx: BorgContext, near?: boolean): AgentCommand | null;

  /** borg_flow_glyph: build the sea of runes. */
  toGlyph(ctx: BorgContext): AgentCommand | null;

  /** borg_flow_light: flow to a perma-lit area. */
  toLight(ctx: BorgContext, why?: number): AgentCommand | null;
  /** borg_flow_recover: flow to a safe grid to heal. */
  toRecover(ctx: BorgContext, dist?: number): AgentCommand | null;
  /** borg_flow_vein: flow to a treasure vein. */
  toVein(ctx: BorgContext, viewable?: boolean, nearness?: number): AgentCommand | null;
  /** borg_flow_vault: flow to an excavatable vault wall. */
  toVault(ctx: BorgContext, nearness?: number): AgentCommand | null;
  /** borg_flow_shop_entry: flow to shop i's door (town). */
  toShop(ctx: BorgContext, shopIndex: number): AgentCommand | null;
  /** borg_flow_spastic: search for secret doors. */
  spastic(ctx: BorgContext, bored: boolean): AgentCommand | null;
  /** borg_twitchy: last-ditch random-direction move. */
  twitchy(ctx: BorgContext): AgentCommand | null;
}

/** Build a Flow facade over a fresh FlowState (borg_init_flow). */
export function createFlow(hooks: FlowHooks = defaultFlowHooks()): Flow {
  const state = createFlowState(hooks);
  return {
    state,
    toStairs: (ctx, down, why = GOAL_BORE, sneak = false, brave = false) =>
      down
        ? borgFlowStairMore(ctx, state, why, sneak, brave)
        : borgFlowStairLess(ctx, state, why, sneak),
    toStairsBoth: (ctx, why = GOAL_BORE, sneak = false) =>
      borgFlowStairBoth(ctx, state, why, sneak),
    toTakes: (ctx, viewable = true, nearness = 250) =>
      borgFlowTake(ctx, state, viewable, nearness),
    toTakesScum: (ctx, viewable = true, nearness = 250) =>
      borgFlowTakeScum(ctx, state, viewable, nearness),
    toKills: (ctx, nearness, viewable = true) =>
      borgFlowKill(ctx, state, viewable, nearness),
    toKillAim: (ctx, viewable = true) => borgFlowKillAim(ctx, state, viewable),
    toKillCorridor: (ctx) => borgFlowKillCorridor(ctx, state),
    toKillDirect: (ctx, twitchy = false) => borgFlowKillDirect(ctx, state, twitchy),
    toDark: (ctx, near = true) => borgFlowDark(ctx, state, near),
    toGlyph: (ctx) => borgFlowGlyph(ctx, state),
    toLight: (ctx, why = GOAL_BORE) => borgFlowLight(ctx, state, why),
    toRecover: (ctx, dist = 250) => borgFlowRecover(ctx, state, dist),
    toVein: (ctx, viewable = true, nearness = 250) =>
      borgFlowVein(ctx, state, viewable, nearness),
    toVault: (ctx, nearness = 30) => borgFlowVault(ctx, state, nearness),
    toShop: (ctx, shopIndex) => borgFlowShopEntry(ctx, state, shopIndex),
    spastic: (ctx, bored) => borgFlowSpastic(ctx, state, bored),
    twitchy: (ctx) => borgTwitchy(ctx, state),
  };
}
