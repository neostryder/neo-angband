/**
 * Shared seams and low-level accessors for the P8.5 item/magic/recovery port.
 *
 * The frozen ItemView (core/src/agent/types.ts) deliberately omits a few fields
 * the C borg_item carries and that several decisions read: the object kind
 * `level` (device fail math), the `aware`/`ident`/`needs_ident` knowledge flags,
 * and the object `value`. Rather than hack the frozen contract these are modelled
 * as OPTIONAL hooks with faithful, conservative defaults:
 *  - itemLevel: defaults to 0 (device fail then only depends on skill; devices
 *    are treated as low-level, i.e. easiest to use - a benign optimism).
 *  - aware/ident/needsIdent: default to "the borg knows its carried gear"
 *    (aware=true, ident=true, needsIdent=false). ItemView already gives concrete
 *    tval/sval so treating carried consumables as identified is the faithful
 *    reading when knowledge is unavailable.
 *  - value: defaults to ItemView.value ?? 0.
 * The `danger` at the borg's grid (borg_danger, P8.2) is taken as a plain number
 * defaulting to 0 (no danger), per the P8.5 architecture note - never imported.
 */

import type { BorgContext, ItemView } from "./types";
import { BI } from "../trait/trait-index";

/** borg.trait[bi], default 0 before borg_notice has run. */
export function trait(ctx: BorgContext, bi: BI): number {
  return ctx.world.self.trait[bi] ?? 0;
}

/** The optional knowledge/level/danger seams (see module header). */
export interface ItemDeps {
  /** Danger at the borg's grid this think (borg_danger); default 0. */
  danger?: number;
  /** avoidance threshold (borg.avoidance); default 0 so p>avoidance/4 is rare. */
  avoidance?: number;
  /** Object kind level for an item (device fail math); default 0. */
  itemLevel?: (item: ItemView) => number;
  /** object_flavor_is_aware; default true (carried gear is known). */
  isAware?: (item: ItemView) => boolean;
  /** item is fully identified; default true. */
  isIdent?: (item: ItemView) => boolean;
  /** item still needs identifying (has unknown runes); default false. */
  needsIdent?: (item: ItemView) => boolean;
  /** object value (gold); default ItemView.value ?? 0. */
  itemValue?: (item: ItemView) => number;
  /** player_has(PF_*): class ability query; default derived from class. */
  playerHas?: (flag: string) => boolean;
  /** borg_check_rest(y,x): safe to rest here; default true. */
  canRest?: boolean;
  /** borg_fear_region[y/11][x/11] at the borg's grid; default +inf (no fear). */
  fearRegion?: number;
  /** borg_t: the borg clock; default ctx.world.clock. */
  clock?: number;
  /**
   * borg_equips_item(act, checkCharge): an equipped item grants activation
   * `act` (a charged one when checkCharge). ItemView exposes only a boolean
   * `activation`, not its index, so this is a seam; default false (the borg has
   * no identified artifact activations). Mirrors the trait subsystem's seam.
   */
  equipsItem?: (act: string, checkCharge: boolean) => boolean;
  /**
   * borg_activate_item(act): the gear handle of the equipped, charged item that
   * bears activation `act`, or null. Default null. Same fidelity boundary.
   */
  activateItem?: (act: string) => number | null;
}

/** borg_check_rest(y,x): default true (safe to rest). */
export function canRest(d?: ItemDeps): boolean {
  return d?.canRest ?? true;
}
/** borg_equips_item seam (default: none). */
export function equipsItem(act: string, checkCharge: boolean, d?: ItemDeps): boolean {
  return d?.equipsItem ? d.equipsItem(act, checkCharge) : false;
}
/** borg_activate_item seam -> handle (default: none). */
export function activateHandle(act: string, d?: ItemDeps): number | null {
  return d?.activateItem ? d.activateItem(act) : null;
}

export function danger(d?: ItemDeps): number {
  return d?.danger ?? 0;
}
export function avoidance(d?: ItemDeps): number {
  return d?.avoidance ?? 0;
}
export function itemLevel(item: ItemView, d?: ItemDeps): number {
  return d?.itemLevel ? d.itemLevel(item) : 0;
}
export function isAware(item: ItemView, d?: ItemDeps): boolean {
  return d?.isAware ? d.isAware(item) : true;
}
export function isIdent(item: ItemView, d?: ItemDeps): boolean {
  return d?.isIdent ? d.isIdent(item) : true;
}
export function needsIdent(item: ItemView, d?: ItemDeps): boolean {
  return d?.needsIdent ? d.needsIdent(item) : false;
}
export function itemValue(item: ItemView, d?: ItemDeps): number {
  if (d?.itemValue) return d.itemValue(item);
  return item.value ?? 0;
}
export function clockOf(ctx: BorgContext, d?: ItemDeps): number {
  return d?.clock ?? ctx.world.clock;
}

/**
 * borg_slot(tval, sval): find the best pack item of a given tval+sval, or null.
 * Faithful to borg-inventory.c: aware-only, prefer smallest pile, then larger
 * pval on a smaller pile (borg_slot loop). Returns the ItemView (whose `handle`
 * drives the act verbs).
 */
export function borgSlot(
  ctx: BorgContext,
  tval: number,
  sval: number,
  d?: ItemDeps,
): ItemView | null {
  let best: ItemView | null = null;
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (!isAware(item, d)) continue;
    if (item.tval !== tval) continue;
    if (item.sval !== sval) continue;
    if (best) {
      /* Prefer smallest pile */
      if (item.number > best.number) continue;
      /* Prefer largest pval (even on a smaller pile) */
      if (item.pval < best.pval && item.number > best.number) continue;
    }
    best = item;
  }
  return best;
}

/** True when the pack holds a matching, aware item (borg_slot >= 0). */
export function hasSlot(
  ctx: BorgContext,
  tval: number,
  sval: number,
  d?: ItemDeps,
): boolean {
  return borgSlot(ctx, tval, sval, d) !== null;
}

/**
 * The device fail formula shared by rods/staves/wands/dragon/ring/activation
 * (borg-item-use.c, e.g. borg_zap_rod:478). Returns the relative fail number
 * (lower is better; 500 is the borg's usability cutoff). Integer arithmetic via
 * Math.trunc to match C's `/`.
 */
export function deviceFail(ctx: BorgContext, lev: number): number {
  let skill = trait(ctx, BI.DEV);
  if (trait(ctx, BI.ISCONFUSED)) skill = Math.trunc((skill * 75) / 100);
  const numerator = skill - lev - (141 - 1);
  let denominator = lev - skill - (100 - 10);
  /* borg_equips_dragon guards div-by-zero; other sites cannot hit 0 here but we
   * guard uniformly to avoid NaN (faithful: sign of numerator decides). */
  if (denominator === 0) denominator = numerator > 0 ? 1 : -1;
  return Math.trunc((100 * numerator) / denominator);
}
