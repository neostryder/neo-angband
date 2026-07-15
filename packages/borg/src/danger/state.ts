/**
 * Per-Borg danger state: the danger evaluator's mutable globals, the fear
 * caches, and the cached z_info->max_range, bundled and keyed by BorgWorld.
 *
 * Upstream borg_danger read a set of file-scope globals (the simulation flags,
 * borg_fear_region/monsters, z_info). This port keeps them per BorgWorld via a
 * WeakMap so that multiple Borgs and tests stay isolated - the same isolation
 * BorgWorld gives the rest of the upstream globals - while borgDanger(ctx, ...)
 * keeps its exact upstream signature (the state is reached through ctx.world).
 */

import type { BorgWorld } from "../world/model";
import { createDangerGlobals, type DangerGlobals } from "./globals";
import { FearCaches } from "./fear";

/** The bundle of danger-time state owned by one Borg. */
export interface DangerState {
  globals: DangerGlobals;
  fear: FearCaches;
  /** z_info->max_range (cached from view.constants(); 20 in 4.2.6). */
  maxRange: number;
}

const STATES = new WeakMap<BorgWorld, DangerState>();

/**
 * The danger state for a world, created lazily on first use (borg_init). The
 * globals' fearRegion is linked to the same FearCaches so borg_projectable can
 * read borg_fear_region exactly as the C did.
 */
export function getDangerState(world: BorgWorld): DangerState {
  let st = STATES.get(world);
  if (!st) {
    const globals = createDangerGlobals();
    const fear = new FearCaches();
    globals.fearRegion = fear;
    st = { globals, fear, maxRange: 20 };
    STATES.set(world, st);
  }
  return st;
}

/** Convenience: the danger globals for a world (fight/think set flags here). */
export function getDangerGlobals(world: BorgWorld): DangerGlobals {
  return getDangerState(world).globals;
}

/** Convenience: the fear caches for a world. */
export function getFearCaches(world: BorgWorld): FearCaches {
  return getDangerState(world).fear;
}
