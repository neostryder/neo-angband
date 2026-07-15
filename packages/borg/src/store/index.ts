/**
 * @neo-angband/borg stores / shopping / home subsystem (P8.7).
 *
 * A faithful port of the Angband 4.2.6 borg's shop-interaction decisions
 * (reference/src/borg/borg-store*.c, borg-think-store.c, borg-home-notice.c,
 * borg-home-power.c). The think-ladder (P8.6) drives it via:
 *   - borgThinkStore(ctx, shopNum, deps?) - the in-shop decision entry, returns
 *     the AgentCommand to execute (buy / sell / retrieve / stash / exit).
 *   - borgChooseShop(ctx, deps?) - the shop-priority ladder; sets
 *     ctx.world.self.goal.{shop,ware,item} and returns whether a goal was set.
 * plus the individual step helpers, the home valuation (borgPowerHome), and the
 * anti-loop memory (createStoreMemory).
 *
 * Power-delta seam: player-inventory power deltas are injected via StoreDeps
 * (buyShopEval / buyHomeEval / sellEval / ...), defaulting to "no gain" so the
 * borg buys/sells nothing on that path without a seam (mirrors item-wear.ts
 * wearEval / junk.ts simDrop). The home-power path is computed directly and works
 * without any seam.
 *
 * BARREL DISCIPLINE: names that live at the package root (BI, trait, distance,
 * TV, SVAL, ...) are imported internally, never re-exported here.
 */

export {
  /* identities */
  BORG_HOME,
  SHOP_GENERAL,
  SHOP_TEMPLE,
  SHOP_BLACK,
  SHOP_MENU_ITEMS,
  STORE_INVEN_MAX,
  PACK_SIZE,
  DEFAULT_MAX_STACK,
  /* anti-loop memory */
  createStoreMemory,
  recordSold,
  recordBought,
  /* occupancy / quantity helpers */
  borgHomeFull,
  borgInventoryFull,
  borgFirstEmptyInventorySlot,
  borgMinItemQuantity,
  borgPrimarilyCaster,
  borgUsesSwaps,
  homeStore,
  homeWares,
  packSlots,
} from "./store";
export type { StoreMemory, StoreDeps, HomeExtras, BuySim } from "./store";

export {
  borgNoticeHome,
  borgPowerHome,
  borgPowerHomeFrom,
  noticeHomeFull,
  noticeHomeEmpty,
  noticeHomeSingle,
} from "./home";
export type { HomeCounts, NoticeHomeOpts } from "./home";

export {
  borgObjectSimilar,
  borgHasMultiple,
  borgStoreBuys,
  borgGoodSell,
  borgThinkHomeSellUseful,
  borgThinkShopSellUseless,
  borgThinkShopSell,
  borgCountSell,
} from "./sell";

export {
  borgGoodBuy,
  borgThinkShopBuyUseful,
  borgThinkHomeBuyUseful,
  borgThinkShopGrabInteresting,
  borgThinkHomeGrabUseless,
  borgThinkHomeBuySwapWeapon,
  borgThinkHomeBuySwapArmour,
  borgThinkShopBuy,
} from "./buy";

export { borgChooseShop, borgThinkStore } from "./think-store";
