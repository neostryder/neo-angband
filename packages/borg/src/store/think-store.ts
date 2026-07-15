/**
 * The in-shop decision tree - a faithful port of borg-think-store.c
 * (borg_choose_shop:87 and borg_think_store:286).
 *
 * borg_choose_shop is the priority ladder that decides WHICH shop to visit and
 * WHAT to do there, in the exact order the C documents (borg-think-store.c:42):
 *   1 sell to home  2 sell to shops  3 buy from shops  4 buy from home
 *   5 grab home junk 6 buy for home  7A/7B buy a home swap.
 * It sets ctx.world.self.goal (shop/ware/item) and returns a boolean, exactly as
 * the C sets borg.goal and returns bool. Sentinel -1 = "no goal".
 *
 * borg_think_store is the per-think entry the ladder (P8.6) calls once the borg
 * is physically inside a shop: it runs borg_choose_shop, then tries to act on the
 * goal via the sell/buy verbs, and otherwise leaves. It returns the AgentCommand
 * to execute this think (or shopExit).
 *
 * OUT OF SCOPE here (handled by the ladder BEFORE store logic in the C): the
 * borg_best_stuff / borg_wear_stuff equipment optimisation at the top of
 * borg_think_store:308-318, and the borg_notice(true) refresh - both belong to
 * the P8.5 item/wear and P8.3 trait subsystems and are driven by the caller.
 */

import type { BorgContext } from "../context";
import type { AgentCommand } from "@neo-angband/core";
import { BI } from "../trait/trait-index";
import {
  type StoreDeps,
  BORG_HOME,
  SHOP_GENERAL,
  SHOP_TEMPLE,
  st,
  borgHomeFull,
  borgInventoryFull,
  borgUsesSwaps,
  createStoreMemory,
} from "./store";
import {
  borgThinkHomeSellUseful,
  borgThinkShopSellUseless,
  borgThinkShopSell,
} from "./sell";
import {
  borgThinkShopBuyUseful,
  borgThinkHomeBuyUseful,
  borgThinkShopGrabInteresting,
  borgThinkHomeGrabUseless,
  borgThinkHomeBuySwapWeapon,
  borgThinkHomeBuySwapArmour,
  borgThinkShopBuy,
} from "./buy";

/**
 * borg_choose_shop (borg-think-store.c:87). Decide the next shop/ware/item goal.
 * Returns true when a goal was set.
 *
 * TIME GUARDS: the C also bails on `borg_t - borg_began > 2000` (a per-level
 * boredom timer). borg_began is not modelled in the world foundation, so that
 * guard is omitted; the `time_this_panel > 1350` guard IS applied.
 */
export function borgChooseShop(ctx: BorgContext, d?: StoreDeps): boolean {
  const goal = ctx.world.self.goal;
  const mem = d?.mem ?? createStoreMemory();

  /* Must be in town (:92). */
  if (st(ctx, BI.CDEPTH)) return false;
  /* Anti-loop panel timer (:99). */
  if (ctx.world.self.timeThisPanel > 1350) return false;

  /* Already flowing to a store to sell something (:103). */
  if (goal.shop !== -1 && goal.ware !== -1) return true;

  /* If poisoned or bleeding -- flow to temple (:107). */
  if (st(ctx, BI.ISCUT) || st(ctx, BI.ISPOISONED)) goal.shop = SHOP_TEMPLE;

  /* If starving or dark (clevel>=2) -- flow to general store (:111). */
  if (
    st(ctx, BI.FOOD) === 0 ||
    (st(ctx, BI.LIGHT) === 0 && st(ctx, BI.CLEVEL) >= 2)
  )
    goal.shop = SHOP_GENERAL;

  /* No lantern + some cash -- general store (:118). */
  if (st(ctx, BI.LIGHT) === 1 && st(ctx, BI.GOLD) >= 100) goal.shop = SHOP_GENERAL;

  /* Immediate shopping: buy straight away without touring every shop (:124). */
  if (
    st(ctx, BI.LIGHT) === 0 ||
    st(ctx, BI.FOOD) === 0 ||
    st(ctx, BI.ISCUT) ||
    st(ctx, BI.ISPOISONED) ||
    (st(ctx, BI.LIGHT) === 1 &&
      st(ctx, BI.GOLD) >= 100 &&
      st(ctx, BI.CLEVEL) < 10)
  ) {
    if (borgThinkShopBuyUseful(ctx, d)) return true;
    if (borgThinkHomeBuyUseful(ctx, d)) return true;
  }

  /* Already flowing to a shop (:150). */
  if (goal.shop !== -1 && goal.ware !== -1) return true;

  /* Assume no important shop (:154). */
  goal.shop = -1;
  goal.ware = -1;
  goal.item = -1;

  /* Put on best stuff at home if we have free slots (:158). */
  if (goal.doBest && !borgHomeFull(ctx, d) && !borgInventoryFull(ctx, d)) {
    goal.shop = BORG_HOME;
    return true;
  }

  /* Money-scumming for the human player: don't touch the home (:166). */
  if (
    st(ctx, BI.GOLD) < mem.moneyScumAmount &&
    mem.moneyScumAmount !== 0 &&
    !st(ctx, BI.CDEPTH) &&
    st(ctx, BI.LIGHT) &&
    !(d?.selfScum ?? false)
  ) {
    if (borgThinkShopBuyUseful(ctx, d)) return true;
    return false;
  }

  /* Step 1 -- Sell items to the home (:182). */
  if (borgThinkHomeSellUseful(ctx, d).chosen) return true;
  /* Step 2 -- Sell items to the shops (:196). */
  if (borgThinkShopSellUseless(ctx, d)) return true;
  /* Step 3 -- Buy items from the shops (for the player) (:207). */
  if (borgThinkShopBuyUseful(ctx, d)) return true;
  /* Step 4 -- Buy items from the home (for the player) (:220). */
  if (borgThinkHomeBuyUseful(ctx, d)) return true;
  /* Step 5 -- Grab items from the home (for the shops) (:235). */
  if (borgThinkHomeGrabUseless(ctx, d)) return true;

  /* Do not stock up the home while money scumming (:246). */
  if (mem.moneyScumAmount) return false;

  /* Step 6 -- Buy items from the shops (for the home) (:249). */
  if (borgThinkShopGrabInteresting(ctx, d)) return true;

  /* Step 7A/7B -- Buy a swap from the home (:260). */
  if (borgUsesSwaps(ctx, d) && borgThinkHomeBuySwapWeapon(ctx, d)) return true;
  if (borgUsesSwaps(ctx, d) && borgThinkHomeBuySwapArmour(ctx, d)) return true;

  return false;
}

/**
 * borg_think_store (borg-think-store.c:286): the in-shop entry. `shopNum` is the
 * store the borg is currently inside (the C's file-scope shop_num). Returns the
 * command to execute this think, or shopExit when there is nothing to do.
 */
export function borgThinkStore(
  ctx: BorgContext,
  shopNum: number,
  d?: StoreDeps,
): AgentCommand | null {
  /* Clock-wrap hack (:288): near the clock wrap, just leave the store. */
  if (ctx.world.clock >= 20000 && ctx.world.clock <= 20010) {
    return ctx.act.shopExit();
  }

  if (borgChooseShop(ctx, d)) {
    /* Try to sell/stash, then to buy/retrieve (:331). */
    const sell = borgThinkShopSell(ctx, shopNum, d);
    if (sell) return sell;
    const buy = borgThinkShopBuy(ctx, shopNum, d);
    if (buy) return buy;
  }

  /* No shop business: clear the goal and leave (:341). */
  ctx.world.self.goal.shop = -1;
  ctx.world.self.goal.ware = -1;
  ctx.world.self.goal.item = -1;
  return ctx.act.shopExit();
}
