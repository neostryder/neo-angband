/**
 * Side state the self-model derives alongside borg.trait[] but which has no home
 * in the frozen BorgSelf shape: the has[] kind-count map (indexed in C by k_idx,
 * here keyed by role name so we need no kind registry), the stat-gain bookkeeping
 * (borg.need_statgain / borg.amt_statgain), and the spellbook counts
 * (borg.amt_book). borg_notice fills it; borg_power / borg_prepared read it.
 *
 * It is stashed in a WeakMap keyed by the BorgWorld so multiple Borgs coexist
 * and world/model.ts stays untouched (the file is off-limits to this port).
 */

import type { BorgWorld } from "../world/model";
import { STAT_MAX } from "./trait-index";

/** Derived side-state produced by borg_notice. */
export interface BorgDerived {
  /** borg.has[k_idx] modelled as role-name -> count (see BorgSvals roles). */
  has: Map<string, number>;
  /** borg.need_statgain[STAT_MAX]. */
  needStatgain: boolean[];
  /** borg.amt_statgain[STAT_MAX]. */
  amtStatgain: number[];
  /** borg.amt_book[9]. */
  amtBook: number[];
}

/** A fresh, zeroed derived-state block. */
export function makeDerived(): BorgDerived {
  return {
    has: new Map(),
    needStatgain: new Array<boolean>(STAT_MAX).fill(false),
    amtStatgain: new Array<number>(STAT_MAX).fill(0),
    amtBook: new Array<number>(9).fill(0),
  };
}

const store = new WeakMap<BorgWorld, BorgDerived>();

/** Get (creating if needed) the derived side-state for a world. */
export function getDerived(world: BorgWorld): BorgDerived {
  let d = store.get(world);
  if (!d) {
    d = makeDerived();
    store.set(world, d);
  }
  return d;
}

/** Reset and return a fresh derived block for a world (borg_notice start). */
export function resetDerived(world: BorgWorld): BorgDerived {
  const d = makeDerived();
  store.set(world, d);
  return d;
}

/** borg.has[role] read helper (0 when absent). */
export function has(d: BorgDerived, role: string): number {
  return d.has.get(role) ?? 0;
}

/** borg.has[role] += n. */
export function addHas(d: BorgDerived, role: string, n: number): void {
  d.has.set(role, (d.has.get(role) ?? 0) + n);
}
