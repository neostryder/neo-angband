/**
 * Curse removal - a faithful port of borg-item-decurse.c.
 *
 * Each helper checks for a decurse means (Remove Curse scroll / staff / spell /
 * *Remove Curse* / an act_remove_curse activation) and, if found, returns the
 * command. The specific cursed item is then chosen by the engine menu (the C
 * pressed the item letter after invoking the effect); that selection is deferred.
 *
 * The swap subsystem (weapon_swap / armour_swap / decurse_*_swap) is a separate
 * borg module (borg-trait-swap) not part of P8.5, so borg_decurse_armour/weapon
 * are gated behind a swap seam and inert by default (borg_uses_swaps aside, there
 * is no swap item to decurse). borg_decurse_any (driven by BI_FIRST_CURSED) is
 * ported fully.
 */

import type { BorgContext, AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import { TV, SVAL } from "./svals";
import type { ItemDeps } from "./deps";
import { hasSlot } from "./deps";
import { Spell, borgSpell, borgSpellOkayFail } from "./magic";
import {
  borgReadScroll,
  borgUseStaff,
  borgActivateItem,
  borgEquipsStaffFail,
} from "./item-use";

/** True when any Remove-Curse means is available (decurse.c:43 guard). */
function decurseMeans(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): boolean {
  return (
    hasSlot(ctx, TV.SCROLL, SVAL.scroll.remove_curse!, d) ||
    borgEquipsStaffFail(ctx, SVAL.staff.remove_curse!, d) ||
    borgSpellOkayFail(ctx, Spell.REMOVE_CURSE, 40, playerHas) ||
    hasSlot(ctx, TV.SCROLL, SVAL.scroll.star_remove_curse!, d) ||
    borgEquipsItemPresent(ctx, d)
  );
}

function borgEquipsItemPresent(ctx: BorgContext, d?: ItemDeps): boolean {
  return (
    borgActivateItem(ctx, "act_remove_curse", d) !== null ||
    borgActivateItem(ctx, "act_remove_curse2", d) !== null
  );
}

/** Emit the actual decurse command from whatever means is available. */
function decurseCommand(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  return (
    borgReadScroll(ctx, SVAL.scroll.remove_curse!, d) ||
    borgUseStaff(ctx, SVAL.staff.remove_curse!, d) ||
    borgSpell(ctx, Spell.REMOVE_CURSE) ||
    borgReadScroll(ctx, SVAL.scroll.star_remove_curse!, d) ||
    borgActivateItem(ctx, "act_remove_curse", d) ||
    borgActivateItem(ctx, "act_remove_curse2", d)
  );
}

/**
 * borg_decurse_any (decurse.c:111): if any equipped/carried item is cursed
 * (BI_FIRST_CURSED) and a decurse means exists, use it.
 */
export function borgDecurseAny(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (!ctx.world.self.trait[BI.FIRST_CURSED]) return null;
  if (!decurseMeans(ctx, d, playerHas)) return null;
  return decurseCommand(ctx, d, playerHas);
}
