/**
 * Selling and home-stashing - a faithful port of borg-store-sell.c.
 *
 * Two families:
 *  - HOME (Step 1, borg_think_home_sell_useful:529): the single best pack->home
 *    move that raises borg_power_home. The home power is computed directly
 *    (home.ts); the "does removing it from the pack keep borg.power" gate
 *    (borg_think_home_sell_bad:322) is the sellHomeBadEval seam (default: treat
 *    as a loss, so nothing is stashed without a seam - conservative).
 *  - SHOPS (Step 2, borg_think_shop_sell_useless:946): sell a pack item a shop
 *    buys whose removal does not lower borg.power (the sellEval seam; default:
 *    treated as a loss, so nothing is sold without a seam).
 *
 * Plus the acting borg_think_shop_sell:1087 (emits act.shopSell) and the
 * stair-choice helper borg_count_sell:1163.
 *
 * These functions SET ctx.world.self.goal (shop/ware/item) and return a boolean,
 * exactly like the C (which sets borg.goal and returns bool); the acting
 * borgThinkShopSell reads the goal and returns an AgentCommand. Sentinel -1 for
 * "no goal" follows the C convention.
 */

import type { BorgContext } from "../context";
import type { ItemView, AgentCommand } from "@neo-angband/core";
import { BI, CLASS_WARRIOR } from "../trait/trait-index";
import { mod as modOf, resLevel } from "../trait/item-util";
import { TV, SVAL } from "../item/svals";
import {
  type StoreDeps,
  BORG_HOME,
  st,
  iqty,
  isAware,
  isIdent,
  itemValue,
  needsIdent,
  noteNeedsId,
  worthId,
  maxStackOf,
  storeInvenMax,
  borgMinItemQuantity,
  borgFirstEmptyInventorySlot,
  homeStore,
  homeWares,
  isBookTval,
  recordSold,
  createStoreMemory,
} from "./store";
import {
  borgNoticeHome,
  borgPowerHomeFrom,
  noticeHomeEmpty,
  noticeHomeFull,
  noticeHomeSingle,
} from "./home";

const ELEMENTS = [
  "ACID", "ELEC", "FIRE", "COLD", "POIS", "LIGHT", "DARK",
  "SOUND", "SHARD", "NEXUS", "NETHER", "CHAOS", "DISEN",
] as const;

const OBJ_MODS = [
  "STR", "INT", "WIS", "DEX", "CON", "STEALTH", "SEARCH", "INFRA", "TUNNEL",
  "SPEED", "BLOWS", "SHOTS", "MIGHT", "LIGHT", "DAM_RED", "MOVES",
] as const;

/**
 * borg_object_similar (borg-store-sell.c:75): can `o` absorb one of `j`?
 * Faithful to the C's per-tval rules. The el_info HATES/IGNORE bits the C also
 * compares are not on the frozen ItemView; only res_level is compared (a benign
 * narrowing - two items with the same resist profile).
 */
export function borgObjectSimilar(
  o: ItemView,
  j: ItemView,
  d?: StoreDeps,
): boolean {
  const total = iqty(o) + 1;

  /* Require identical object kind (tval + sval) (:82). */
  if (o.tval !== j.tval || o.sval !== j.sval) return false;

  /* Different flags don't stack (:86). */
  if (!setEqual(o.flags, j.flags)) return false;

  /* Different elements don't stack (:91). */
  for (const el of ELEMENTS) {
    if (resLevel(o, el) !== resLevel(j, el)) return false;
  }

  switch (o.tval) {
    case TV.CHEST:
      return false;
    case TV.FOOD:
    case TV.POTION:
    case TV.SCROLL:
      break;
    case TV.STAFF:
    case TV.WAND:
      if (!isAware(o, d) || !isAware(j, d)) return false;
      break;
    case TV.ROD:
      break;
    case TV.BOW:
    case TV.DIGGING:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.SWORD:
    case TV.BOOTS:
    case TV.GLOVES:
    case TV.HELM:
    case TV.CROWN:
    case TV.SHIELD:
    case TV.CLOAK:
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
      /* fall through to the rings/missiles bonus checks (:139-233). */
    /* falls through */
    case TV.RING:
    case TV.AMULET:
    case TV.LIGHT:
      if (
        (o.tval === TV.RING || o.tval === TV.AMULET || o.tval === TV.LIGHT) &&
        (!isAware(o, d) || !isAware(j, d))
      )
        return false;
    /* falls through */
    case TV.BOLT:
    case TV.ARROW:
    case TV.SHOT: {
      if (
        o.tval === TV.BOW || o.tval === TV.DIGGING || o.tval === TV.HAFTED ||
        o.tval === TV.POLEARM || o.tval === TV.SWORD || o.tval === TV.BOOTS ||
        o.tval === TV.GLOVES || o.tval === TV.HELM || o.tval === TV.CROWN ||
        o.tval === TV.SHIELD || o.tval === TV.CLOAK || o.tval === TV.SOFT_ARMOR ||
        o.tval === TV.HARD_ARMOR || o.tval === TV.DRAG_ARMOR ||
        o.tval === TV.RING || o.tval === TV.AMULET || o.tval === TV.LIGHT ||
        o.tval === TV.BOLT || o.tval === TV.ARROW || o.tval === TV.SHOT
      ) {
        /* identical bonuses (:177). */
        if (o.toH !== j.toH) return false;
        if (o.toD !== j.toD) return false;
        if (o.toA !== j.toA) return false;
        for (const m of OBJ_MODS) if (modOf(o, m) !== modOf(j, m)) return false;
        /* identical curses (:195). */
        if (!setEqual(o.curses, j.curses)) return false;
        /* identical artifact / ego (:207). */
        if ((o.artifactName ?? null) !== (j.artifactName ?? null)) return false;
        if ((o.egoName ?? null) !== (j.egoName ?? null)) return false;
        /* never stack "powerful" (flagged) items (:215). */
        if (o.flags.length !== 0 || j.flags.length !== 0) return false;
        /* never stack recharging items (:219). */
        if (o.timeout || j.timeout) return false;
        if (o.ac !== j.ac) return false;
        if (o.dd !== j.dd) return false;
        if (o.ds !== j.ds) return false;
      }
      break;
    }
    default:
      if (!isAware(o, d) || !isAware(j, d)) return false;
      break;
  }

  /* identical "broken"/ident status (:247). */
  if (isIdent(o, d) !== isIdent(j, d)) return false;

  /* semi-matching inscriptions (:255). */
  const on = o.inscription;
  const jn = j.inscription;
  if ((on && !jn) || (!on && jn)) return false;
  if (on && jn && on !== jn) return false;

  /* max-stack limit (:269). */
  if (total >= maxStackOf(o, d)) return false;

  return true;
}

function setEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  for (const x of a) if (!sb.has(x)) return false;
  return true;
}

/**
 * borg_has_mutiple (borg-store-sell.c:649): more than one of this item across
 * pack and equipment (for un-IDd gear, only true stacks count).
 */
export function borgHasMultiple(
  ctx: BorgContext,
  inItem: ItemView,
  d?: StoreDeps,
): boolean {
  if (iqty(inItem) > 1) return true;

  if (!isIdent(inItem, d)) {
    switch (inItem.tval) {
      case TV.BOOTS:
      case TV.GLOVES:
      case TV.HELM:
      case TV.CROWN:
      case TV.SHIELD:
      case TV.SOFT_ARMOR:
      case TV.HARD_ARMOR:
      case TV.SHOT:
      case TV.BOLT:
      case TV.ARROW:
      case TV.BOW:
      case TV.DIGGING:
      case TV.HAFTED:
      case TV.POLEARM:
      case TV.SWORD:
        return false;
    }
  }

  for (const item of ctx.view.inventory()) {
    if (item === inItem) continue;
    if (item.tval === inItem.tval && item.sval === inItem.sval && iqty(item) !== 0)
      return true;
  }
  for (const item of ctx.view.equipment()) {
    if (!item) continue;
    if (item.tval === inItem.tval && item.sval === inItem.sval && iqty(item) !== 0)
      return true;
  }
  return false;
}

/**
 * borg_store_buys (borg-store-sell.c:701): does shop `who` (0-based) buy this
 * item type? Uses `who + 1` exactly as the C switch.
 */
export function borgStoreBuys(
  item: ItemView,
  who: number,
  d?: StoreDeps,
): boolean {
  switch (who + 1) {
    case 1: /* General Store */
      switch (item.tval) {
        case TV.FOOD:
        case TV.MUSHROOM:
        case TV.FLASK:
        case TV.SHOT:
        case TV.BOLT:
        case TV.ARROW:
        case TV.DIGGING:
          return true;
      }
      return false;
    case 2: /* Armory */
      switch (item.tval) {
        case TV.BOOTS:
        case TV.GLOVES:
        case TV.HELM:
        case TV.CROWN:
        case TV.SHIELD:
        case TV.SOFT_ARMOR:
        case TV.HARD_ARMOR:
        case TV.DRAG_ARMOR:
          return true;
      }
      return false;
    case 3: /* Weapon Shop */
      switch (item.tval) {
        case TV.SHOT:
        case TV.BOLT:
        case TV.ARROW:
        case TV.BOW:
        case TV.DIGGING:
        case TV.HAFTED:
        case TV.POLEARM:
        case TV.SWORD:
          return true;
      }
      return false;
    case 4: /* Bookstore */
      switch (item.tval) {
        case TV.PRAYER_BOOK:
        case TV.MAGIC_BOOK:
        case TV.NATURE_BOOK:
        case TV.SHADOW_BOOK:
        case TV.OTHER_BOOK:
          return true;
      }
      return false;
    case 5: /* Alchemist */
      switch (item.tval) {
        case TV.SCROLL:
        case TV.POTION:
          return true;
      }
      return false;
    case 6: /* Magic Shop */
      switch (item.tval) {
        case TV.AMULET:
        case TV.RING:
        case TV.STAFF:
        case TV.WAND:
        case TV.ROD:
        case TV.MAGIC_BOOK:
          return true;
      }
      return false;
    case 7: /* Black Market */
      if (d?.noSelling ?? false) return true;
      switch (item.tval) {
        case TV.LIGHT:
        case TV.CLOAK:
        case TV.FOOD:
          return true;
      }
      return false;
  }
  return false;
}

/** borg_good_sell (borg-store-sell.c:816): should this item be sold to shop `who`? */
export function borgGoodSell(
  ctx: BorgContext,
  item: ItemView,
  who: number,
  d?: StoreDeps,
): boolean {
  const mem = d?.mem ?? createStoreMemory();
  let multiple = false;

  /* Never sell worthless items (shops won't buy) except unIDd potions/scrolls (:824). */
  if (itemValue(item, d) <= 0) {
    if (
      !(
        (item.tval === TV.POTION || item.tval === TV.SCROLL) &&
        !isIdent(item, d)
      )
    )
      return false;
  }

  /* Must be a shop that buys this (:833). */
  if (!borgStoreBuys(item, who, d)) return false;

  /* Never sell valuable non-IDd items unless we have a stack (:838). */
  if (noteNeedsId(item, d)) {
    multiple = borgHasMultiple(ctx, item, d);
    if (!multiple) return false;
  }

  const worshipsGold = d?.worshipsGold ?? false;
  const scumActive =
    mem.moneyScumAmount < st(ctx, BI.GOLD) && mem.moneyScumAmount !== 0;

  if (
    itemValue(item, d) > 0 &&
    (worshipsGold || st(ctx, BI.MAXCLEVEL) < 10 || scumActive)
  ) {
    /* allowed to continue to sell */
  } else {
    switch (item.tval) {
      case TV.POTION:
      case TV.SCROLL:
        if (!isIdent(item, d)) return true;
        if (
          item.tval === TV.POTION &&
          item.sval === SVAL.potion.restore_mana &&
          st(ctx, BI.MAXSP) > 100
        )
          return false;
        break;
      case TV.FOOD:
      case TV.ROD:
      case TV.WAND:
      case TV.STAFF:
      case TV.RING:
      case TV.AMULET:
      case TV.LIGHT:
        if (worthId(item, d) && st(ctx, BI.MAXDEPTH) < 35 && !multiple)
          return false;
        break;
      case TV.BOW:
      case TV.DIGGING:
      case TV.HAFTED:
      case TV.POLEARM:
      case TV.SWORD:
      case TV.BOOTS:
      case TV.GLOVES:
      case TV.HELM:
      case TV.CROWN:
      case TV.SHIELD:
      case TV.CLOAK:
      case TV.SOFT_ARMOR:
      case TV.HARD_ARMOR:
      case TV.DRAG_ARMOR:
        if (worthId(item, d) && !multiple) return false;
        break;
    }
  }

  /* Do not sell un-IDd randarts (:913). */
  if ((d?.randarts ?? false) && item.artifact && !isIdent(item, d)) return false;

  /* Do not sell an un-IDd random-power ego with only one (:920). Approximate the
   * random-power check by needs_ident (frozen view lacks ego random-power data). */
  if (!isIdent(item, d) && item.ego && iqty(item) < 2 && needsIdent(item, d))
    return false;

  /* Do not sell it if I just bought one (:929). */
  for (let i = 0; i < mem.boughtNum; i++) {
    if (
      mem.boughtTval[i] === item.tval &&
      mem.boughtSval[i] === item.sval &&
      (mem.boughtStore[i] === who || who !== BORG_HOME)
    )
      return false;
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Step 1 -- sell "useful" things to the home (home optimiser).
 * ------------------------------------------------------------------ */

/** borg_think_home_sell_bad (borg-store-sell.c:322): true = do NOT stash item i. */
function homeSellBad(
  ctx: BorgContext,
  item: ItemView,
  emptyHomePower: number,
  d?: StoreDeps,
): boolean {
  const mem = d?.mem ?? createStoreMemory();

  if (iqty(item) === 0 || !isAware(item, d)) return true;
  /* Swap slots are not modelled here (swap subsystem out of scope). */
  if ((d?.randarts ?? false) && item.artifact && !isIdent(item, d)) return true;
  if (!itemValue(item, d)) return true;

  /* If just bought from the house, do not sell it back (:349). */
  for (let p = 0; p < mem.boughtNum; p++) {
    if (
      mem.boughtTval[p] === item.tval &&
      mem.boughtSval[p] === item.sval &&
      mem.boughtPval[p] === item.pval &&
      mem.boughtStore[p] === BORG_HOME
    )
      return true;
  }

  /* Item must add value to an empty home (:357). */
  const single = noticeHomeSingle(ctx, item, d);
  if (borgPowerHomeFrom(ctx, single) <= emptyHomePower) return true;

  /* Removing one from the pack must not lower borg.power (:376). Default: no
   * seam -> treat as a loss (bad), so nothing is stashed. */
  if (!d?.sellHomeBadEval) return true;
  if (d.sellHomeBadEval(ctx, item) < ctx.world.self.power) return true;

  return false;
}

/** The single best pack->home move (borg-store-sell.c:398 borg_think_home_sell_best). */
interface HomeMove {
  slot: number; /* home slot index (0..W = new slot). */
  packIndex: number; /* pack index of the item to move. */
  power: number; /* resulting borg_power_home. */
}

function homeSellBest(ctx: BorgContext, d?: StoreDeps): HomeMove | null {
  const emptyHomePower = borgPowerHomeFrom(ctx, noticeHomeEmpty(ctx, d));
  let bestPower = borgPowerHomeFrom(ctx, noticeHomeFull(ctx, d));

  const home = homeWares(ctx);
  const W = home.length;
  const invMax = storeInvenMax(d);
  /* first_empty: occupied slots plus one empty new slot (:419). */
  let firstEmpty = W;
  if (firstEmpty < invMax) firstEmpty++;

  const pack = ctx.view.inventory();
  let best: HomeMove | null = null;

  for (let n = 0; n < firstEmpty; n++) {
    const item2 = n < W ? home[n]! : null; /* null = the empty new slot. */
    for (let i = 0; i < pack.length; i++) {
      const item = pack[i]!;
      if (homeSellBad(ctx, item, emptyHomePower, d)) continue;

      /* Build the hypothetical home ware list for this single move. */
      const trial: ItemView[] = [...home];
      if (item2 && borgObjectSimilar(item2, item, d)) {
        /* stacking: bump the slot's quantity. */
        trial[n] = withQty(item2, iqty(item2) + 1);
      } else {
        /* replace/new: skip if it would stack elsewhere in the home (:449). */
        let stacksElsewhere = false;
        for (let k = 0; k < home.length; k++) {
          if (borgObjectSimilar(home[k]!, item, d)) {
            stacksElsewhere = true;
            break;
          }
        }
        if (stacksElsewhere) continue;
        if (item2) trial[n] = withQty(item, 1);
        else trial.push(withQty(item, 1));
      }

      const power = borgPowerHomeFrom(
        ctx,
        borgNoticeHome(ctx, { items: trial, includeEquip: true }, d),
      );
      if (power > bestPower) {
        bestPower = power;
        best = { slot: n, packIndex: i, power };
      }
    }
  }
  return best;
}

/** A shallow item clone with a new quantity (for hypothetical home lists). */
function withQty(item: ItemView, n: number): ItemView {
  return { ...item, number: n };
}

/**
 * borg_think_home_sell_useful (borg-store-sell.c:529). Finds the single best
 * pack->home move and sets the goal. Sets bestHomePower (out param analog via
 * the returned object). Returns true when a move was chosen.
 */
export function borgThinkHomeSellUseful(
  ctx: BorgContext,
  d?: StoreDeps,
): { chosen: boolean; bestHomePower: number } {
  const home = homeStore(ctx);
  const mem = d?.mem ?? createStoreMemory();

  /* Home full AND pack full -> nothing to do (:537). */
  if (
    homeWares(ctx).length >= storeInvenMax(d) &&
    borgFirstEmptyInventorySlot(ctx, d) === -1
  ) {
    return { chosen: false, bestHomePower: -1 };
  }
  if (!home) return { chosen: false, bestHomePower: -1 };

  const move = homeSellBest(ctx, d);
  const bestHomePower = move ? move.power : borgPowerHomeFrom(ctx, noticeHomeFull(ctx, d));

  if (!move) return { chosen: false, bestHomePower };

  const wares = homeWares(ctx);
  const pack = ctx.view.inventory();
  const item = pack[move.packIndex]!;
  const item2 = move.slot < wares.length ? wares[move.slot]! : null;
  const packFull = borgFirstEmptyInventorySlot(ctx, d) === -1;

  /* (1) Drop stuff that will STACK in the home (:564). */
  if (item2 && borgObjectSimilar(item2, item, d) && iqty(item2) <= 90) {
    ctx.world.self.goal.shop = BORG_HOME;
    ctx.world.self.goal.item = move.packIndex;
    ctx.world.self.goal.ware = -1;
    return { chosen: true, bestHomePower };
  }

  /* (2) Grab the OLD home item out to make room, if the pack is not full (:589). */
  if (!packFull && item2 && !borgObjectSimilar(item, item2, d)) {
    for (let p = 0; p < mem.soldNum; p++) {
      if (
        mem.soldTval[p] === item2.tval &&
        mem.soldSval[p] === item2.sval &&
        mem.soldStore[p] === BORG_HOME
      )
        return { chosen: false, bestHomePower };
    }
    ctx.world.self.goal.shop = BORG_HOME;
    ctx.world.self.goal.ware = move.slot;
    ctx.world.self.goal.item = -1;
    return { chosen: true, bestHomePower };
  }

  /* (3) Drop the pack item into the (empty) home slot (:622). */
  if (iqty(item) > 0) {
    ctx.world.self.goal.shop = BORG_HOME;
    ctx.world.self.goal.item = move.packIndex;
    ctx.world.self.goal.ware = -1;
    return { chosen: true, bestHomePower };
  }

  return { chosen: false, bestHomePower };
}

/* ------------------------------------------------------------------ *
 * Step 2 -- sell "useless" items to a shop (for cash).
 * ------------------------------------------------------------------ */

/** borg_think_shop_sell_useless (borg-store-sell.c:946). Sets the goal. */
export function borgThinkShopSellUseless(
  ctx: BorgContext,
  d?: StoreDeps,
): boolean {
  const stores = ctx.view.stores();
  const pack = ctx.view.inventory();
  const invMax = storeInvenMax(d);

  let bK = -1;
  let bI = -1;
  let bP = ctx.world.self.power;
  let bC = 30001;

  for (let k = 0; k < stores.length; k++) {
    const shop = stores[k]!;
    if (shop.isHome) continue; /* shops only (store_max - 1). */
    /* Skip full shops (:965). */
    if (shop.stock.length >= invMax) continue;

    for (let i = 0; i < pack.length; i++) {
      const item = pack[i]!;
      if (iqty(item) === 0) continue;

      /* Protect important item types (:977). */
      if (item.tval === st(ctx, BI.AMMO_TVAL) && st(ctx, BI.AMISSILES) < 45)
        continue;
      if (
        item.tval === TV.ROD &&
        item.sval === SVAL.rod.healing &&
        countHas(ctx, TV.ROD, SVAL.rod.healing) <= 3
      )
        continue;
      if (
        st(ctx, BI.CLASS) === CLASS_WARRIOR &&
        item.tval === TV.ROD &&
        item.sval === SVAL.rod.mapping &&
        iqty(item) <= 2
      )
        continue;
      if (
        item.tval === TV.WAND &&
        st(ctx, BI.CLEVEL) < 35 &&
        (item.sval === SVAL.wand.magic_missile ||
          item.sval === SVAL.wand.stinking_cloud ||
          item.sval === SVAL.wand.annihilation) &&
        item.pval !== 0
      )
        continue;
      /* Swap slots not modelled (out of scope). */

      if (!borgGoodSell(ctx, item, k, d)) continue;

      const qty = borgMinItemQuantity(ctx, item, d);

      /* Power after selling qty (:1034); default: a loss, so nothing sells. */
      const p = d?.sellEval ? d.sellEval(ctx, item, qty) : ctx.world.self.power - 1;

      if (p < bP) continue;

      const c = itemValue(item, d) < 30000 ? itemValue(item, d) : 30000;
      /* sell cheap items first (:1052). */
      if (p === bP && c >= bC) continue;

      bK = k;
      bI = i;
      bP = p;
      bC = c;
    }
  }

  if (bK >= 0 && bI >= 0) {
    ctx.world.self.goal.shop = bK;
    ctx.world.self.goal.item = bI;
    ctx.world.self.goal.ware = -1;
    return true;
  }
  return false;
}

/** Count carried items of a tval/sval (borg.has proxy). */
function countHas(ctx: BorgContext, tval: number, sval: number): number {
  let n = 0;
  for (const item of ctx.view.inventory())
    if (item.tval === tval && item.sval === sval) n += iqty(item);
  return n;
}

/* ------------------------------------------------------------------ *
 * The acting sell (borg-store-sell.c:1087).
 * ------------------------------------------------------------------ */

/**
 * borg_think_shop_sell: if the goal targets a pack item to sell at the shop the
 * borg is currently in (shopNum), emit the sell command and record it. Returns
 * the command, or null.
 */
export function borgThinkShopSell(
  ctx: BorgContext,
  shopNum: number,
  d?: StoreDeps,
): AgentCommand | null {
  const goal = ctx.world.self.goal;
  if (goal.shop !== shopNum || goal.item < 0) return null;

  const pack = ctx.view.inventory();
  const item = pack[goal.item];
  if (!item) return null;

  const qty = borgMinItemQuantity(ctx, item, d);
  const cmd = ctx.act.shopSell(item.handle, qty);

  const mem = d?.mem;
  if (mem) recordSold(mem, item, goal.shop);

  goal.shop = -1;
  goal.ware = -1;
  goal.item = -1;
  ctx.world.self.timeThisPanel++;
  ctx.world.self.inShop = false;
  return cmd;
}

/* ------------------------------------------------------------------ *
 * borg_count_sell (borg-store-sell.c:1163): count sellable pack items.
 * ------------------------------------------------------------------ */

/** How many pack items are worth selling (drives the stair choice). */
export function borgCountSell(ctx: BorgContext, d?: StoreDeps): number {
  const gold = st(ctx, BI.GOLD);
  const clevel = st(ctx, BI.CLEVEL);
  const maxdepth = st(ctx, BI.MAXDEPTH);

  let greed = Math.trunc(gold / 100) + 100;
  if (greed < 1000) greed = 1000;
  if (greed > 25000) greed = 25000;
  if (maxdepth >= 50) greed = 75000;
  if (clevel < 25) greed = Math.trunc(gold / 100) + 50;
  if (clevel < 20) greed = Math.trunc(gold / 100) + 35;
  if (clevel < 15) greed = Math.trunc(gold / 100) + 20;
  if (clevel < 13) greed = Math.trunc(gold / 100) + 10;
  if (clevel < 10) greed = Math.trunc(gold / 100) + 5;
  if (clevel < 5) greed = Math.trunc(gold / 100);

  let k = 0;
  const ammoTval = st(ctx, BI.AMMO_TVAL);
  const P = SVAL.potion;
  const St = SVAL.staff;
  const W = SVAL.wand;
  const Sc = SVAL.scroll;

  for (const item of ctx.view.inventory()) {
    if (iqty(item) === 0) continue;
    if (itemValue(item, d) <= 0) continue;
    /* swap slots not modelled. */
    if (item.tval === ammoTval) continue;
    if (isBookTval(item.tval)) continue;

    if (noteNeedsId(item, d)) {
      if (!borgHasMultiple(ctx, item, d)) return 0; /* faithful: returns false==0 */
    }

    /* protected consumable collection (:1229). */
    if (
      (item.tval === TV.POTION && item.sval === P.cure_serious) ||
      (item.tval === TV.POTION && item.sval === P.cure_critical) ||
      (item.tval === TV.POTION && item.sval === P.healing) ||
      (item.tval === TV.POTION && item.sval === P.star_healing) ||
      (item.tval === TV.POTION && item.sval === P.life) ||
      (item.tval === TV.POTION && item.sval === P.speed) ||
      (item.tval === TV.STAFF && item.sval === St.teleportation) ||
      (item.tval === TV.WAND && item.sval === W.drain_life) ||
      (item.tval === TV.WAND && item.sval === W.annihilation) ||
      (item.tval === TV.SCROLL && item.sval === Sc.teleport)
    )
      continue;

    const price = itemValue(item, d) < 30000 ? itemValue(item, d) : 30000;
    if (price * iqty(item) < greed && !noteNeedsId(item, d)) continue;

    /* only sellable if removing it does not lose much power (:1248). Default: no
     * seam -> treat as a loss (p == power - 51 < power - 50), so not counted. */
    const p = d?.sellEval ? d.sellEval(ctx, item, iqty(item)) : ctx.world.self.power - 51;
    if (p + 50 < ctx.world.self.power) continue;

    k++;
  }
  return k;
}
