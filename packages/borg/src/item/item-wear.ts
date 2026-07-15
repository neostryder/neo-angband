/**
 * Wear/equip decisions - a faithful port of borg-item-wear.c (borg_wear_stuff)
 * and the ammo predicate borg_is_ammo.
 *
 * borg_wear_stuff simulates wearing each carried item (borg_notice/borg_power on
 * the swapped loadout) and wears whichever raises borg.power the most. The frozen
 * contract cannot re-run notice on a hypothetical loadout here, so the power of a
 * candidate loadout is provided by the `wearEval` seam; every guard, slot rule
 * and threshold the C applies BEFORE the simulation is preserved verbatim.
 * Without the seam nothing improves on the current power, so the borg wears
 * nothing (the safe default). borg_remove_stuff lives in junk.ts (borgRemoveStuff).
 */

import type { BorgContext, ItemView, AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import { TV } from "./svals";
import type { ItemDeps } from "./deps";
import { trait, isAware, isIdent, itemValue } from "./deps";
import { mod as modOf } from "../trait/item-util";

/** Wear-specific seams. */
export interface WearDeps extends ItemDeps {
  /** A free pack slot exists to push equipment into (borg_first_empty; def true). */
  hasHole?: boolean;
  /** birth_randarts option (skip un-IDd randart artifacts); default false. */
  randarts?: boolean;
  /** borg.power if `item` were worn (the C's borg_notice/borg_power sim). */
  wearEval?: (item: ItemView) => number;
}

/** borg_is_ammo(tval) (wear.c:1541). */
export function borgIsAmmo(tval: number): boolean {
  return tval === TV.SHOT || tval === TV.ARROW || tval === TV.BOLT;
}

/** The equipment "category" an item wields into, or null if unwearable. */
type Slot =
  | "weapon"
  | "bow"
  | "ring"
  | "amulet"
  | "light"
  | "body"
  | "cloak"
  | "shield"
  | "helm"
  | "gloves"
  | "boots";

function wieldSlot(item: ItemView): Slot | null {
  switch (item.tval) {
    case TV.DIGGING:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.SWORD:
      return "weapon";
    case TV.BOW:
      return "bow";
    case TV.RING:
      return "ring";
    case TV.AMULET:
      return "amulet";
    case TV.LIGHT:
      return "light";
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
      return "body";
    case TV.CLOAK:
      return "cloak";
    case TV.SHIELD:
      return "shield";
    case TV.HELM:
    case TV.CROWN:
      return "helm";
    case TV.GLOVES:
      return "gloves";
    case TV.BOOTS:
      return "boots";
    default:
      return null;
  }
}

/** The item currently worn in the same category, or null. */
function wornInSlot(ctx: BorgContext, slot: Slot): ItemView | null {
  for (const item of ctx.view.equipment()) {
    if (item && item.number > 0 && wieldSlot(item) === slot) return item;
  }
  return null;
}

/**
 * borg_wear_stuff (wear.c:745): wear the carried item that most improves power.
 * Returns the wear command, or null.
 */
export function borgWearStuff(
  ctx: BorgContext,
  d?: WearDeps,
): AgentCommand | null {
  /* Hack against the swap-till-you-drop loop (wear.c:770). */
  if (trait(ctx, BI.ISHUNGRY) || trait(ctx, BI.ISWEAK)) return null;

  /* Need an empty slot to simulate pushing equipment (wear.c:774). */
  if (d?.hasHole === false) return null;

  const currentPower = ctx.world.self.power;
  let bestPower = currentPower;
  let best: ItemView | null = null;

  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (!isAware(item, d)) continue;
    if (itemValue(item, d) <= 0) continue; /* worthless (wear.c:801) */

    /* Do not wear un-*IDd* randart artifacts (wear.c:805). */
    if ((d?.randarts ?? false) && item.artifact && !isIdent(item, d)) continue;

    const slot = wieldSlot(item);
    if (!slot) continue;

    /* Over weight limit: only swap in more-STR items (wear.c:836). */
    if (trait(ctx, BI.ISENCUMB)) {
      const worn = wornInSlot(ctx, slot);
      if (worn && modOf(worn, "STR") > modOf(item, "STR")) continue;
    }

    /* Evaluate the loadout (wear.c:858). Without the seam, no improvement. */
    const p = d?.wearEval ? d.wearEval(item) : currentPower;
    if (p > bestPower) {
      bestPower = p;
      best = item;
    }
  }

  if (best) return ctx.act.wear(best.handle);
  return null;
}
