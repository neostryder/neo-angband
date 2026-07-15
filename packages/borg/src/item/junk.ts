/**
 * Drop/destroy junk and make pack space - a faithful port of borg-junk.c
 * (borg_drop_junk) and the equipment-shedding borg_remove_stuff.
 *
 * borg_drop_junk values every carried item, applies the depth-scaled "keep"
 * thresholds and the never-crush protections, then in the C confirms with a
 * power simulation (borg_notice/borg_power on the reduced pack). The frozen
 * contract cannot re-run notice on a hypothetical pack here, so that final
 * confirmation is expressed as the optional `simDrop` seam; without it the borg
 * crushes an item the value ladder has deemed worthless (value known and below
 * the depth cutoff). Items whose value is UNKNOWN (no registry/seam) are never
 * crushed - a deliberately safe deviation.
 */

import type { BorgContext, ItemView, AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import { CLASS_WARRIOR } from "../trait/trait-index";
import { TV, SVAL } from "./svals";
import type { ItemDeps } from "./deps";
import { trait, danger } from "./deps";

/** Options controlling the junk pass. */
export interface JunkDeps extends ItemDeps {
  /** borg_do_crush_junk gate (default true). */
  doCrushJunk?: boolean;
  /** borg.goal.recalling: mid-recall, don't crush (default from self.goal). */
  recalling?: boolean;
  /**
   * The C's power-sim confirmation: return true if dropping `item` is a net win
   * (removing it does not lower borg.power). Default: true for value-known junk.
   */
  simDrop?: (item: ItemView) => boolean;
  /** borg_remove_stuff's sim: removing this equipped item keeps power. */
  simRemove?: (item: ItemView) => boolean;
}

/** True when the item's value is knowable from the seams/view. */
function valueKnown(item: ItemView, d?: ItemDeps): boolean {
  return !!d?.itemValue || item.value !== undefined;
}
function valueOf(item: ItemView, d?: ItemDeps): number {
  if (d?.itemValue) return d.itemValue(item);
  return item.value ?? 0;
}

/** A book tval (obj_kind_can_browse proxy). */
function isBook(tval: number): boolean {
  return (
    tval === TV.MAGIC_BOOK ||
    tval === TV.PRAYER_BOOK ||
    tval === TV.NATURE_BOOK ||
    tval === TV.SHADOW_BOOK ||
    tval === TV.OTHER_BOOK
  );
}

/**
 * borg_drop_junk (junk.c:248): drop the worst worthless carried item. Returns
 * the drop command, or null.
 */
export function borgCrushJunk(
  ctx: BorgContext,
  d?: JunkDeps,
): AgentCommand | null {
  if (d?.doCrushJunk === false) return null;

  const recalling = d?.recalling ?? ctx.world.self.goal.recalling > 0;
  if (recalling) return null;

  /* No crush if even slightly dangerous (junk.c:265). */
  if (danger(d) > Math.trunc(trait(ctx, BI.CURHP) / 10)) return null;

  const depth = trait(ctx, BI.CDEPTH);
  const ammoTval = trait(ctx, BI.AMMO_TVAL);
  const cls = trait(ctx, BI.CLASS);
  const maxCLevel = trait(ctx, BI.MAXCLEVEL);

  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (isBook(item.tval)) continue; /* never crush books */
    if (item.tval === TV.SCROLL && item.value === undefined) continue; /* unaware scroll */

    if (!valueKnown(item, d)) continue; /* safe: never crush unknown-value gear */
    let value = valueOf(item, d);

    /* Empty stacked wands/staves (junk.c:308). */
    if ((item.tval === TV.STAFF || item.tval === TV.WAND) && item.number > item.pval) {
      value = 0;
    }

    /* Only worthless "gear" (tval >= CHEST) is subject to crushing (junk.c:314). */
    if (item.tval >= TV.CHEST) {
      /* Stat-bonus items are worth more (junk.c:322). */
      if (
        value > 0 &&
        (modv(item, "STR") > 0 ||
          modv(item, "INT") > 0 ||
          modv(item, "WIS") > 0 ||
          modv(item, "DEX") > 0 ||
          modv(item, "CON") > 0)
      )
        value += 2000;

      /* Keep our ammo (junk.c:333). */
      if (item.tval === ammoTval && value > 0) value += 5000;

      /* Keep known-useful consumables (junk.c:338). */
      if (isProtectedConsumable(ctx, item, cls)) value += 5000;

      if (item.tval === TV.DIGGING) value = 0;
      if (
        (item.tval === TV.SHOT ||
          item.tval === TV.ARROW ||
          item.tval === TV.BOLT) &&
        item.tval !== ammoTval
      )
        value = 0;

      /* Low-level gold worship keep (junk.c:384, with stock cfg: worships_gold
       * false, money_scum 0 -> reduces to maxclevel<10 && !cursed). */
      if (
        value > 0 &&
        maxCLevel < 10 &&
        maxCLevel <= 20 &&
        item.curses.length === 0
      )
        continue;

      /* Depth-scaled keep thresholds (junk.c:392-421). */
      if (depth < 5 && value > 0) continue;
      if (depth < 10 && value > 15) continue;
      if (depth < 15 && value > 100) continue;
      if (depth < 30 && value > 500) continue;
      if (depth < 40 && value > 1000) continue;
      if (depth < 60 && value > 1200) continue;
      if (depth < 80 && value > 1400) continue;
      if (depth < 90 && value > 1600) continue;
      if (depth < 95 && value > 4800) continue;
      if (depth < 127 && value > 5600) continue;

      /* Confirm with the power-sim seam (junk.c:437), else crush value-0 junk. */
      const drop = d?.simDrop ? d.simDrop(item) : value === 0;
      if (!drop) continue;

      return ctx.act.drop(item.handle, 1);
    }
  }
  return null;
}

/** modifier value on an item (OBJ_MOD_<code>). */
function modv(item: ItemView, code: string): number {
  for (const m of item.modifiers) if (m.code === code) return m.value;
  return 0;
}

/** The never-crush consumables list (junk.c:338-364). */
function isProtectedConsumable(
  ctx: BorgContext,
  item: ItemView,
  cls: number,
): boolean {
  const P = SVAL.potion;
  const Ro = SVAL.rod;
  const St = SVAL.staff;
  const W = SVAL.wand;
  const Sc = SVAL.scroll;
  if (item.tval === TV.POTION) {
    if (item.sval === P.restore_mana && trait(ctx, BI.MAXSP) >= 1) return true;
    if (item.sval === P.healing) return true;
    if (item.sval === P.star_healing) return true;
    if (item.sval === P.life) return true;
    if (item.sval === P.speed) return true;
  }
  if (item.tval === TV.ROD) {
    if (item.sval === Ro.drain_life) return true;
    if (item.sval === Ro.healing) return true;
    if (item.sval === Ro.mapping && cls === CLASS_WARRIOR) return true;
  }
  if (item.tval === TV.STAFF) {
    if (item.sval === St.dispel_evil) return true;
    if (item.sval === St.power) return true;
    if (item.sval === St.holiness) return true;
  }
  if (item.tval === TV.WAND) {
    if (item.sval === W.drain_life) return true;
    if (item.sval === W.annihilation) return true;
    if (item.sval === W.teleport_away && cls === CLASS_WARRIOR) return true;
  }
  if (item.tval === TV.SCROLL) {
    if (item.sval === Sc.teleport_level && trait(ctx, BI.ATELEPORTLVL) < 1000)
      return true;
    if (item.sval === Sc.protection_from_evil) return true;
  }
  return false;
}

/**
 * borg_remove_stuff (junk.c:1259): take off an equipped item whose removal does
 * not lower power (dead weight / a curse). The C confirms with a power sim; here
 * the simRemove seam does, defaulting to "remove a cursed, non-one-ring item".
 * Hunger/weak and the sit-forever time guards from the C are preserved (the time
 * guards are P8.6 concerns and omitted).
 */
export function borgRemoveStuff(
  ctx: BorgContext,
  d?: JunkDeps,
): AgentCommand | null {
  if (trait(ctx, BI.ISHUNGRY) || trait(ctx, BI.ISWEAK)) return null;

  for (const item of ctx.view.equipment()) {
    if (!item || item.number <= 0) continue;
    const remove = d?.simRemove
      ? d.simRemove(item)
      : item.curses.length > 0; /* default: shed a cursed item */
    if (!remove) continue;
    return ctx.act.takeoff(item.handle);
  }
  return null;
}
