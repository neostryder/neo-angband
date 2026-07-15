/**
 * Enchant weapons/armour and brand ammo - a faithful port of borg-item-enchant.c.
 *
 * borg_enchanting is the entry point: decurse first, then (only in town) brand
 * ammo, enchant to-hit, to-dam and to-ac. Each enchant helper picks the LEAST
 * enchanted eligible item and returns the read-scroll / cast command; the engine
 * menu then selects the item (the C pressed the item letter afterward).
 *
 * FIDELITY: the swap-weapon and quiver-ammo branches (weapon_swap /
 * QUIVER_START..QUIVER_END) need the swap subsystem and quiver view that the
 * frozen contract does not surface here, so those branches are omitted; the
 * primary equipped-weapon/armour enchant path is preserved verbatim including
 * the +8 vs BORG_ENCHANT_LIMIT thresholds and the "skip a weak bow" rule.
 */

import type { BorgContext, ItemView, AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import { TV, SVAL } from "./svals";
import type { ItemDeps } from "./deps";
import { trait, isIdent } from "./deps";
import { Spell, borgSpellOkayFail, borgSpellFail } from "./magic";
import { borgReadScroll } from "./item-use";
import { borgDecurseAny } from "./item-decurse";

/** borg_cfg[BORG_ENCHANT_LIMIT] stock default (borg.txt / trait config). */
const ENCHANT_LIMIT = 12;

/** Enchant equipped armour to-ac (borg_enchant_to_a, enchant.c:111). */
function borgEnchantToA(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (!trait(ctx, BI.NEED_ENCHANT_TO_A)) return null;
  if (!trait(ctx, BI.AENCH_ARM) && !trait(ctx, BI.AENCH_SARM)) return null;

  const canSpell =
    borgSpellOkayFail(ctx, Spell.ENCHANT_ARMOUR, 65, playerHas) ||
    trait(ctx, BI.AENCH_SARM) >= 1;

  let best: ItemView | null = null;
  let bestA = 99;
  /* Worn armour slots (body..feet); on our view these are equipment items. */
  for (const item of ctx.view.equipment()) {
    if (!item || item.number <= 0) continue;
    if (!isArmourSlot(item)) continue;
    if (!isIdent(item, d)) continue;
    const a = item.toA;
    if (canSpell ? a >= ENCHANT_LIMIT : a >= 8) continue;
    if (best && bestA < a) continue;
    best = item;
    bestA = a;
  }
  if (!best) return null;

  return (
    borgReadScroll(ctx, SVAL.scroll.star_enchant_armor!, d) ||
    borgReadScroll(ctx, SVAL.scroll.enchant_armor!, d) ||
    borgSpellFail(ctx, Spell.ENCHANT_ARMOUR, 65, playerHas)
  );
}

/** Enchant the equipped weapon/bow to-hit (borg_enchant_to_h, enchant.c:179). */
function borgEnchantToH(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (!trait(ctx, BI.NEED_ENCHANT_TO_H)) return null;
  if (!trait(ctx, BI.AENCH_TOH) && !trait(ctx, BI.AENCH_SWEP)) return null;
  const item = pickLeastEnchantedWeapon(ctx, d, playerHas, (it) => it.toH);
  if (!item) return null;
  return (
    borgReadScroll(ctx, SVAL.scroll.star_enchant_weapon!, d) ||
    borgReadScroll(ctx, SVAL.scroll.enchant_weapon_to_hit!, d) ||
    borgSpellFail(ctx, Spell.ENCHANT_WEAPON, 65, playerHas)
  );
}

/** Enchant the equipped weapon/bow to-dam (borg_enchant_to_d, enchant.c:343). */
function borgEnchantToD(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (!trait(ctx, BI.NEED_ENCHANT_TO_D)) return null;
  if (!trait(ctx, BI.AENCH_TOD) && !trait(ctx, BI.AENCH_SWEP)) return null;
  const item = pickLeastEnchantedWeapon(ctx, d, playerHas, (it) => it.toD);
  if (!item) return null;
  return (
    borgReadScroll(ctx, SVAL.scroll.star_enchant_weapon!, d) ||
    borgReadScroll(ctx, SVAL.scroll.enchant_weapon_to_dam!, d) ||
    borgSpellFail(ctx, Spell.ENCHANT_WEAPON, 65, playerHas)
  );
}

/** Shared weapon/bow least-enchanted selection (enchant.c:192-245). */
function pickLeastEnchantedWeapon(
  ctx: BorgContext,
  d: ItemDeps | undefined,
  playerHas: ((flag: string) => boolean) | undefined,
  bonus: (it: ItemView) => number,
): ItemView | null {
  const canSpell =
    borgSpellOkayFail(ctx, Spell.ENCHANT_WEAPON, 65, playerHas) ||
    trait(ctx, BI.AENCH_SWEP) >= 1;

  let best: ItemView | null = null;
  let bestA = 99;
  for (const item of ctx.view.equipment()) {
    if (!item || item.number <= 0) continue;
    if (item.tval !== TV.BOW && !isMeleeWeapon(item)) continue;
    if (!isIdent(item, d)) continue;
    if (item.tval === TV.DIGGING) continue; /* skip the swap digger */
    const a = bonus(item);
    if (canSpell ? a >= ENCHANT_LIMIT : a >= 8) continue;
    /* Skip a weak (< x3) non-artifact/ego bow (enchant.c:233). */
    if (
      item.tval === TV.BOW &&
      trait(ctx, BI.AMMO_POWER) < 3 &&
      !item.artifact &&
      !item.ego
    )
      continue;
    if (best && bestA < a) continue;
    best = item;
    bestA = a;
  }
  return best;
}

/** Brand ammo (borg_brand_weapon, enchant.c:513): quiver access unavailable. */
function borgBrandWeapon(
  ctx: BorgContext,
  _d?: ItemDeps,
): AgentCommand | null {
  if (!trait(ctx, BI.NEED_BRAND_WEAPON)) return null;
  if (!trait(ctx, BI.ABRAND)) return null;
  /* The eligible items live in the quiver (QUIVER_START..QUIVER_END), which the
   * frozen AgentView does not expose here; nothing to brand from the pack. */
  return null;
}

function isArmourSlot(item: ItemView): boolean {
  switch (item.tval) {
    case TV.BOOTS:
    case TV.GLOVES:
    case TV.HELM:
    case TV.CROWN:
    case TV.SHIELD:
    case TV.CLOAK:
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
      return true;
    default:
      return false;
  }
}

function isMeleeWeapon(item: ItemView): boolean {
  switch (item.tval) {
    case TV.DIGGING:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.SWORD:
      return true;
    default:
      return false;
  }
}

/**
 * borg_enchanting (enchant.c:578): decurse, then (town only) brand/enchant.
 * The "sitting on a level forever" time guards are P8.6 clock concerns and are
 * omitted; the decurse-then-town-only-enchant ordering is preserved.
 */
export function borgEnchanting(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISCONFUSED)) return null;

  const decurse = borgDecurseAny(ctx, d, playerHas);
  if (decurse) return decurse;

  /* Only in town. */
  if (trait(ctx, BI.CDEPTH)) return null;

  return (
    borgBrandWeapon(ctx, d) ||
    borgEnchantToH(ctx, d, playerHas) ||
    borgEnchantToD(ctx, d, playerHas) ||
    borgEnchantToA(ctx, d, playerHas)
  );
}
