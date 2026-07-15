/**
 * Buying and retrieving-from-home - a faithful port of borg-store-buy.c.
 *
 * Steps (borg-think-store.c ordering):
 *  - 3 borg_think_shop_buy_useful:222  - buy gear that raises borg.power.
 *  - 4 borg_think_home_buy_useful:445  - retrieve home gear that raises power.
 *  - 5 borg_think_shop_grab_interesting:715 - buy stockpile for the home.
 *  - 6 borg_think_home_grab_useless:856  - grab home junk to sell.
 *  - 7A borg_think_home_buy_swap_weapon:953 / 7B _armour:1071 - buy a swap.
 *  - acting borg_think_shop_buy:1179 - emit act.shopBuy.
 *
 * borg.power deltas over a hypothetical PACK are the buyShopEval / buyHomeEval /
 * swap seams (default: no gain -> buys nothing). borg_power_home deltas are
 * computed directly (home.ts), so the home-stockpile (Step 5) and home-declutter
 * (Step 6) decisions function without seams.
 */

import type { BorgContext } from "../context";
import type { ItemView, StoreItemView, AgentCommand } from "@neo-angband/core";
import {
  BI,
  CLASS_PRIEST, CLASS_PALADIN, CLASS_DRUID, CLASS_RANGER, CLASS_MAGE, CLASS_ROGUE,
} from "../trait/trait-index";
import { hasFlag } from "../trait/item-util";
import { TV, SVAL } from "../item/svals";
import {
  type StoreDeps,
  type BuySim,
  BORG_HOME,
  SHOP_BLACK,
  SHOP_TEMPLE,
  st,
  iqty,
  shopCost,
  canBrowse,
  borgMinItemQuantity,
  borgFirstEmptyInventorySlot,
  borgPrimarilyCaster,
  packSlots,
  homeWares,
  recordBought,
  createStoreMemory,
} from "./store";
import {
  borgNoticeHome,
  borgPowerHomeFrom,
  noticeHomeEmpty,
  noticeHomeFull,
  noticeHomeSingle,
} from "./home";

/* ------------------------------------------------------------------ *
 * Wield-slot detection (borg_wield_slot proxy).
 * ------------------------------------------------------------------ */

type Slot =
  | "weapon" | "bow" | "ring" | "amulet" | "light" | "body"
  | "cloak" | "shield" | "helm" | "gloves" | "boots";

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

/** The currently-worn light source (for the torch buy special cases). */
function wornLight(ctx: BorgContext): ItemView | null {
  for (const item of ctx.view.equipment())
    if (item && item.tval === TV.LIGHT) return item;
  return null;
}

/**
 * Would the borg wield this ware rather than pocket it, given the torch/digging
 * exceptions in borg_think_shop_buy_useful:311-341?
 */
function buyWields(ctx: BorgContext, item: ItemView, d?: StoreDeps): boolean {
  const hole = borgFirstEmptyInventorySlot(ctx, d);
  /* require two empty slots to consider wielding (:311). */
  if (hole === -1 || hole + 1 >= packSlots(ctx, d)) return false;
  let slot = wieldSlot(item);
  if (slot === null) return false;

  if (item.tval === TV.LIGHT && item.sval === SVAL.light.torch) {
    const light = wornLight(ctx);
    /* do not replace a Brightness torch with a plain one (:325). */
    if (light && hasFlag(light, "BURNS_OUT")) slot = null;
    /* do not "replace" a lantern with a torch - refuel instead (:332). */
    if (light && light.sval === SVAL.light.lantern && hasFlag(light, "TAKES_FUEL"))
      slot = null;
  }
  /* diggers are a back-up, never a weapon swap (:340). */
  if (item.tval === TV.DIGGING) slot = null;

  return slot !== null;
}

/* ------------------------------------------------------------------ *
 * borg_good_buy (borg-store-buy.c:68).
 * ------------------------------------------------------------------ */

/** Should the borg buy this ware from shop `who` (0-based), stock index `ware`? */
export function borgGoodBuy(
  ctx: BorgContext,
  item: StoreItemView,
  who: number,
  ware: number,
  d?: StoreDeps,
): boolean {
  const mem = d?.mem ?? createStoreMemory();

  switch (item.tval) {
    case TV.SHOT:
    case TV.ARROW:
    case TV.BOLT:
      if (st(ctx, BI.CLEVEL) < 35) {
        if (item.toH) return false;
        if (item.toD) return false;
      }
      break;
    case TV.PRAYER_BOOK:
    case TV.MAGIC_BOOK:
    case TV.NATURE_BOOK:
    case TV.SHADOW_BOOK:
    case TV.OTHER_BOOK:
      if (!canBrowse(item, d)) return false;
      break;
  }

  /* Black market: only buy from it when rich, or the special list (:95). */
  if (who === SHOP_BLACK) {
    const P = SVAL.potion;
    const Ro = SVAL.rod;
    const Sc = SVAL.scroll;
    const cls = st(ctx, BI.CLASS);

    if (
      item.tval === TV.SCROLL &&
      item.sval === Sc.remove_curse &&
      st(ctx, BI.FIRST_CURSED)
    )
      return true;

    const special =
      (item.tval === TV.POTION &&
        (item.sval === P.star_healing ||
          item.sval === P.life ||
          item.sval === P.healing ||
          (item.sval === P.inc_str && st(ctx, BI.CSTR) < 18 + 100) ||
          (item.sval === P.inc_int && st(ctx, BI.CINT) < 18 + 100) ||
          (item.sval === P.inc_wis && st(ctx, BI.CWIS) < 18 + 100) ||
          (item.sval === P.inc_dex && st(ctx, BI.CDEX) < 18 + 100) ||
          (item.sval === P.inc_con && st(ctx, BI.CCON) < 18 + 100))) ||
      (item.tval === TV.ROD &&
        (item.sval === Ro.healing ||
          (item.sval === Ro.recall &&
            cls !== CLASS_PRIEST &&
            cls !== CLASS_PALADIN) ||
          (item.sval === Ro.speed && cls !== CLASS_DRUID && cls !== CLASS_RANGER) ||
          (item.sval === Ro.teleport_other &&
            cls !== CLASS_MAGE &&
            cls === CLASS_ROGUE) /* upstream quirk: == ROGUE (borg-store-buy.c:131) */ ||
          (item.sval === Ro.illumination && !st(ctx, BI.ALITE)))) ||
      (canBrowse(item, d) &&
        (d?.amtBook ? d.amtBook(item) : 0) === 0 &&
        (d?.isDungeonBook ? d.isDungeonBook(item) : false)) ||
      (item.tval === TV.SCROLL &&
        (item.sval === Sc.teleport_level || item.sval === Sc.teleport));

    if (special) {
      /* self-scum toward this item (:141). Inert unless selfScum enabled. */
      if (
        (d?.selfScum ?? false) &&
        st(ctx, BI.CLEVEL) >= 10 &&
        st(ctx, BI.LIGHT) &&
        st(ctx, BI.FOOD) + 0 >= 100 && /* num_food seam folded to 0 by default */
        shopCost(item) <= 85000
      ) {
        const dexSafe = 0; /* adj_dex_safe[DEX_INDEX] seam; default 0. */
        if (dexSafe + st(ctx, BI.CLEVEL) > 90) {
          mem.moneyScumAmount = shopCost(item);
          mem.moneyScumWho = who;
          mem.moneyScumWare = ware;
        }
      }
      return true;
    }

    if (st(ctx, BI.CLEVEL) < 15 && st(ctx, BI.GOLD) < 20000) return false;
    if (st(ctx, BI.CLEVEL) < 35 && st(ctx, BI.GOLD) < 15000) return false;
    if (st(ctx, BI.GOLD) < 10000) return false;
  }

  /* Do not buy back something just sold (:171). */
  for (let p = 0; p < mem.soldNum; p++) {
    if (
      mem.soldTval[p] === item.tval &&
      mem.soldSval[p] === item.sval &&
      mem.soldStore[p] === who
    )
      return false;
  }

  /* Do not buy a second digger (:182). */
  if (item.tval === TV.DIGGING) {
    for (const it of ctx.view.inventory()) if (it.tval === TV.DIGGING) return false;
  }

  /* Low-level borgs waste no money on extra books (:202). */
  if (st(ctx, BI.MAXCLEVEL) < 5) {
    if (canBrowse(item, d) && item.sval >= 1) return false;
  }
  if (!borgPrimarilyCaster(ctx, d) && st(ctx, BI.MAXCLEVEL) <= 8) {
    if (canBrowse(item, d) && item.sval >= 1) return false;
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Step 3 -- buy "useful" things from a shop (to be used).
 * ------------------------------------------------------------------ */

/** borg_think_shop_buy_useful (borg-store-buy.c:222). Sets the goal. */
export function borgThinkShopBuyUseful(
  ctx: BorgContext,
  d?: StoreDeps,
): boolean {
  const hole = borgFirstEmptyInventorySlot(ctx, d);
  if (hole === -1) return false; /* require one empty slot (:236). */
  if (ctx.world.self.goal.ware !== -1) return false; /* already targeting (:241). */

  const mem = d?.mem ?? createStoreMemory();
  const stores = ctx.view.stores();
  let bK = -1;
  let bN = -1;
  let bP = ctx.world.self.power;
  let bC = 0;

  const light0food0 = st(ctx, BI.LIGHT) === 0 || st(ctx, BI.FOOD) === 0;
  const hurt = st(ctx, BI.ISCUT) || st(ctx, BI.ISPOISONED);

  for (let k = 0; k < stores.length; k++) {
    const shop = stores[k]!;
    if (shop.isHome) continue; /* store_max - 1 (:248). */
    /* bad-shape shop restriction (:251). */
    if (light0food0 && k !== 0 && k !== BORG_HOME) continue;
    if (hurt && k !== SHOP_TEMPLE) continue;

    for (let n = 0; n < shop.stock.length; n++) {
      const item = shop.stock[n]!;
      if (iqty(item) === 0) continue;
      if (!borgGoodBuy(ctx, item, k, n, d)) continue;

      /* money-scum focus (:271). */
      if (
        mem.moneyScumAmount &&
        (k !== mem.moneyScumWho || n !== mem.moneyScumWare)
      )
        continue;

      /* sufficient cash (:276). */
      if (st(ctx, BI.GOLD) < shopCost(item)) continue;

      /* immediate-shopping food gate (:282, reproduced verbatim). */
      if (
        st(ctx, BI.FOOD) === 0 &&
        item.tval !== TV.FOOD &&
        item.tval !== TV.SCROLL &&
        item.sval !== SVAL.scroll.satisfy_hunger
      )
        continue;

      /* attack-wand caps (:289). */
      if (
        item.tval === TV.WAND &&
        (item.sval === SVAL.wand.magic_missile ||
          item.sval === SVAL.wand.stinking_cloud) &&
        st(ctx, BI.GOOD_W_CHG) > 40
      )
        continue;
      if (
        item.tval === TV.WAND &&
        (item.sval === SVAL.wand.magic_missile ||
          item.sval === SVAL.wand.stinking_cloud) &&
        st(ctx, BI.MAXCLEVEL) > 30
      )
        continue;

      const qty = borgMinItemQuantity(ctx, item, d);
      const wields = buyWields(ctx, item, d);
      const sim: BuySim = { item, qty, wields };
      const p = d?.buyShopEval ? d.buyShopEval(ctx, sim) : ctx.world.self.power;
      const c = shopCost(item) * qty;

      if (p <= bP) continue;
      if (p === bP && c >= bC) continue;

      bK = k;
      bN = n;
      bP = p;
      bC = c;
    }
  }

  if (bK >= 0 && bN >= 0) {
    ctx.world.self.goal.shop = bK;
    ctx.world.self.goal.ware = bN;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Step 4 -- buy "useful" things from the home (to be used).
 * ------------------------------------------------------------------ */

/** borg_think_home_buy_useful (borg-store-buy.c:445). Sets the goal. */
export function borgThinkHomeBuyUseful(
  ctx: BorgContext,
  d?: StoreDeps,
): boolean {
  const mem = d?.mem ?? createStoreMemory();
  const wares = homeWares(ctx);
  let bN = -1;
  let bP = ctx.world.self.power;

  for (let n = 0; n < wares.length; n++) {
    const item = wares[n]!;
    if (iqty(item) === 0) continue;

    /* skip if just sold (:472). */
    let skip = false;
    for (let i = 0; i < mem.soldNum; i++) {
      if (mem.soldTval[i] === item.tval && mem.soldSval[i] === item.sval)
        skip = true;
    }
    if (skip) continue;

    if (borgFirstEmptyInventorySlot(ctx, d) === -1) continue; /* need a hole (:488). */

    const qty = borgMinItemQuantity(ctx, item, d);
    const wields = wieldSlot(item) !== null;
    const sim: BuySim = { item, qty, wields };
    const p = d?.buyHomeEval ? d.buyHomeEval(ctx, sim) : ctx.world.self.power;

    if (p <= bP) continue;
    bN = n;
    bP = p;
  }

  if (bN >= 0 && bP > ctx.world.self.power) {
    ctx.world.self.goal.shop = BORG_HOME;
    ctx.world.self.goal.ware = bN;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Step 5 -- buy "interesting" things from a shop (for the home).
 * ------------------------------------------------------------------ */

/**
 * borg_think_shop_grab_interesting (borg-store-buy.c:715). Buys a ware to
 * stockpile at the home when doing so raises borg_power_home.
 *
 * Faithful simplification: the C temporarily inserts the ware into the pack and
 * calls borg_think_home_sell_useful to score the best resulting home. Since the
 * player-power gate in that optimiser defaults to inert here, this port scores
 * `s` directly as borg_power_home with the ware added to the real home - the same
 * quantity the optimiser would settle on - which keeps the decision functional
 * and is documented as an intentional deviation.
 */
export function borgThinkShopGrabInteresting(
  ctx: BorgContext,
  d?: StoreDeps,
): boolean {
  if (st(ctx, BI.SAURON_DEAD)) return false;
  if (st(ctx, BI.CLEVEL) < 15) return false;

  const hole = borgFirstEmptyInventorySlot(ctx, d);
  if (hole === -1) return false;
  if (hole + 1 >= packSlots(ctx, d)) return false;

  const emptyHomePower = borgPowerHomeFrom(ctx, noticeHomeEmpty(ctx, d));
  const wares = homeWares(ctx);
  let bS = borgPowerHomeFrom(ctx, noticeHomeFull(ctx, d));
  let bC = 0;

  const stores = ctx.view.stores();
  let bK = -1;
  let bN = -1;

  for (let k = 0; k < stores.length; k++) {
    const shop = stores[k]!;
    if (shop.isHome) continue;

    for (let n = 0; n < shop.stock.length; n++) {
      const item = shop.stock[n]!;
      if (iqty(item) === 0) continue;
      if (!borgGoodBuy(ctx, item, k, n, d)) continue;

      /* require some spare cash (:769). */
      if (st(ctx, BI.GOLD) < 1000 + shopCost(item) * 5) continue;

      const qty = borgMinItemQuantity(ctx, item, d);
      const added = { ...item, number: qty };

      /* item must help an empty home (:792). */
      const single = noticeHomeSingle(ctx, added, d);
      if (emptyHomePower >= borgPowerHomeFrom(ctx, single)) continue;

      /* score the home with the ware added (see doc note). */
      const s0 = borgPowerHomeFrom(
        ctx,
        borgNoticeHome(ctx, { items: [...wares, added], includeEquip: true }, d),
      );
      let s = s0;
      const c = shopCost(item) * qty;
      if (c > Math.trunc(st(ctx, BI.GOLD) / 10)) s -= c;

      if (s < bS) continue;
      if (s === bS && c >= bC) continue;

      bK = k;
      bN = n;
      bS = s;
      bC = c;
    }
  }

  /* clear any goal an inner optimise would have set (:834). */
  ctx.world.self.goal.shop = -1;
  ctx.world.self.goal.ware = -1;
  ctx.world.self.goal.item = -1;

  if (bK >= 0 && bN >= 0) {
    ctx.world.self.goal.shop = bK;
    ctx.world.self.goal.ware = bN;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Step 6 -- grab "useless" things from the home (to be sold).
 * ------------------------------------------------------------------ */

/** borg_think_home_grab_useless (borg-store-buy.c:856). Sets the goal. */
export function borgThinkHomeGrabUseless(
  ctx: BorgContext,
  d?: StoreDeps,
): boolean {
  const mem = d?.mem ?? createStoreMemory();
  const hole = borgFirstEmptyInventorySlot(ctx, d);
  if (hole === -1) return false;
  if (hole + 1 >= packSlots(ctx, d)) return false;

  const wares = homeWares(ctx);
  let bS = borgPowerHomeFrom(ctx, noticeHomeFull(ctx, d));
  let bN = -1;

  for (let n = 0; n < wares.length; n++) {
    const item = wares[n]!;
    if (iqty(item) === 0) continue;

    /* skip stuff we sold/bought (:886). */
    let skip = false;
    for (let p = 0; p < mem.soldNum; p++) {
      if (
        mem.soldTval[p] === item.tval &&
        mem.soldSval[p] === item.sval &&
        mem.soldStore[p] === BORG_HOME
      )
        skip = true;
    }
    if (skip) continue;

    const qty = borgMinItemQuantity(ctx, item, d);
    /* home value with qty removed from slot n. */
    const trial: ItemView[] = [];
    for (let m = 0; m < wares.length; m++) {
      if (m === n) {
        const left = iqty(item) - qty;
        if (left > 0) trial.push({ ...item, number: left });
      } else {
        trial.push(wares[m]!);
      }
    }
    const s = borgPowerHomeFrom(
      ctx,
      borgNoticeHome(ctx, { items: trial, includeEquip: true }, d),
    );
    if (s < bS) continue;
    bN = n;
    bS = s;
  }

  if (bN >= 0) {
    ctx.world.self.goal.shop = BORG_HOME;
    ctx.world.self.goal.ware = bN;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Steps 7A / 7B -- buy a weapon / armour swap from the home.
 * The swap subsystem is out of scope (as in trait/power.ts), so these fire only
 * when a *SwapEval seam is supplied; default 0 -> never.
 * ------------------------------------------------------------------ */

function borgThinkHomeBuySwap(
  ctx: BorgContext,
  weapon: boolean,
  d?: StoreDeps,
): boolean {
  const evalFn = weapon ? d?.weaponSwapEval : d?.armourSwapEval;
  if (!evalFn) return false; /* no swap valuation -> never buys a swap. */

  const wares = homeWares(ctx);
  let bN = -1;
  let bP = 0;

  for (let n = 0; n < wares.length; n++) {
    const item = wares[n]!;
    if (iqty(item) === 0) continue;
    if (weapon && wieldSlot(item) !== "weapon") continue;
    const p = evalFn(ctx, item);
    if (p <= bP) continue;
    bN = n;
    bP = p;
  }

  if (bN >= 0 && bP > 0) {
    ctx.world.self.goal.shop = BORG_HOME;
    ctx.world.self.goal.ware = bN;
    return true;
  }
  return false;
}

/** borg_think_home_buy_swap_weapon (borg-store-buy.c:953). */
export function borgThinkHomeBuySwapWeapon(
  ctx: BorgContext,
  d?: StoreDeps,
): boolean {
  return borgThinkHomeBuySwap(ctx, true, d);
}

/** borg_think_home_buy_swap_armour (borg-store-buy.c:1071). */
export function borgThinkHomeBuySwapArmour(
  ctx: BorgContext,
  d?: StoreDeps,
): boolean {
  return borgThinkHomeBuySwap(ctx, false, d);
}

/* ------------------------------------------------------------------ *
 * The acting buy (borg-store-buy.c:1179).
 * ------------------------------------------------------------------ */

/**
 * borg_think_shop_buy: if the goal targets a ware at the shop the borg is in
 * (shopNum), emit the buy/retrieve command and record it. Returns the command,
 * or null.
 */
export function borgThinkShopBuy(
  ctx: BorgContext,
  shopNum: number,
  d?: StoreDeps,
): AgentCommand | null {
  const goal = ctx.world.self.goal;
  if (goal.shop !== shopNum || goal.ware < 0) return null;

  const shop = ctx.view.stores()[goal.shop];
  if (!shop) return null;
  const item = shop.stock[goal.ware];
  if (!item || item.tval === 0) {
    goal.shop = -1;
    goal.ware = -1;
    goal.item = -1;
    ctx.world.self.timeThisPanel++;
    return null;
  }

  const cmd = ctx.act.shopBuy(item.index);

  const mem = d?.mem;
  if (mem) {
    /* money-scum reset once the target is bought (:1216). */
    if (
      mem.moneyScumAmount &&
      shopCost(item) >= Math.trunc((mem.moneyScumAmount * 9) / 10)
    ) {
      mem.moneyScumAmount = 0;
    }
    recordBought(mem, item, goal.shop);
  }

  goal.shop = -1;
  goal.ware = -1;
  goal.item = -1;
  ctx.world.self.timeThisPanel++;
  ctx.world.self.inShop = false;
  return cmd;
}
