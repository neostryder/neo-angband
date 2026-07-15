/**
 * Store state model, helpers and shared seams for the P8.7 stores/shopping port
 * (reference/src/borg/borg-store.c/.h, borg-store-sell.c borg_min_item_quantity,
 * plus the sold_item / bought_item anti-loop ring buffers spread across
 * borg-store-buy.c and borg-store-sell.c).
 *
 * WHAT THE C DID vs WHAT THE PORT DOES
 * ------------------------------------
 * The C borg mirrored the whole town into borg_shops[] via borg_cheat_store
 * (borg-store.c:147) and priced every ware with a private copy of store.c's
 * price_item (borg-store.c:59). The frozen perceive facade already delivers both:
 * view.stores() -> StoreView[] with per-ware StoreItemView.price (the player buy
 * price, priceItem(store_buying=false, qty 1), exactly what borg_cheat_store
 * stored in b_item->cost). So this port reads the live StoreView directly rather
 * than re-scraping/re-pricing; borg_cheat_store and borg_price_item have no
 * analog beyond that mapping (documented, not reimplemented).
 *
 * The C addressed shops by fixed index (store_num); the mapping is preserved:
 * view.stores()[k] IS store k, the home is the entry with isHome === true
 * (index BORG_HOME == 7). Shop-loop steps that "skip the home" skip that entry.
 *
 * POWER-DELTA SEAM (mirrors item/deps.ts + item-wear.ts wearEval, junk.ts
 * simDrop): the buy/sell decisions diff borg.power before vs after a hypothetical
 * loadout change (borg_notice + borg_power on the swapped pack). The frozen view
 * cannot re-run borg_notice on a hypothetical inventory, so every player-power
 * delta is an injected seam that DEFAULTS TO "no improvement" -> the borg buys
 * nothing / sells nothing on the player-power path (the safe, conservative
 * default). The HOME-power path (borg_power_home) is pure arithmetic over the
 * home wares + worn gear and is computed directly (home.ts), so the home
 * declutter/optimise decisions function without any seam.
 */

import type { BorgContext } from "../context";
import type { ItemView, StoreView, StoreItemView } from "@neo-angband/core";
import { BI } from "../trait/trait-index";
import { TV, SVAL, type BorgSvalTable } from "../item/svals";

/* ------------------------------------------------------------------ *
 * Fixed store identities (borg-store.h:31, borg-think-store.c, borg-store-buy.c).
 * ------------------------------------------------------------------ */

/** The store number of HOME (borg-store.h:31: #define BORG_HOME 7). */
export const BORG_HOME = 7;
/** General store (borg-store-buy.c:251 immediate-shopping, borg_store_buys case 1). */
export const SHOP_GENERAL = 0;
/** The shop cut/poison sends the borg to (borg-think-store.c:108, :254: k == 3). */
export const SHOP_TEMPLE = 3;
/** Black market (borg-store-buy.c:95: who == 6; borg_store_buys case 7). */
export const SHOP_BLACK = 6;

/**
 * SHOP_MENU_ITEMS (borg-store.c:36): the letter each ware slot maps to in the
 * store menu. Kept for parity/HUD; the act facade buys by numeric index, so the
 * port does not keypress these.
 */
export const SHOP_MENU_ITEMS = "acfhjmnoqruvyzABDFGHJKLMNOPQRSTUVWXYZ";

/* z_info values the frozen GameConstants does not surface
 * (reference/lib/gamedata/constants.txt). Faithful literals, overridable via
 * StoreDeps for a modded ruleset. */
/** z_info->store_inven_max (constants.txt: store:inven-max:24). */
export const STORE_INVEN_MAX = 24;
/** z_info->pack_size (constants.txt: carry-cap:pack-size:23). */
export const PACK_SIZE = 23;
/** default object_base max-stack (object_base.txt: default:max-stack:40). */
export const DEFAULT_MAX_STACK = 40;

/* ------------------------------------------------------------------ *
 * Anti-loop memory: the sold_item_* / bought_item_* ring buffers.
 * ------------------------------------------------------------------ */

/**
 * The 10-deep sold/bought ring buffers (borg-store-sell.c:42, borg-store-buy.c:46).
 * Upstream these are file-scope globals persisting across thinks so the borg does
 * not immediately buy back what it just sold (and vice-versa). The port keeps
 * them in one owned object (no globals); the integration layer (P8.8) allocates
 * one and threads it through StoreDeps.mem so the memory lives across thinks.
 *
 * Fidelity note: the C reads these with `for (p = 0; p < num; p++)`, where `num`
 * is the index of the MOST RECENT write - so the most recent entry is never
 * re-examined. That off-by-one is upstream behaviour and is preserved verbatim.
 */
export interface StoreMemory {
  soldTval: number[];
  soldSval: number[];
  soldPval: number[];
  soldStore: number[];
  soldNum: number; /* index of last write, -1 = none (borg-store-sell.c:46) */
  soldNxt: number;

  boughtTval: number[];
  boughtSval: number[];
  boughtPval: number[];
  boughtStore: number[];
  boughtNum: number; /* borg-store-buy.c:50 */
  boughtNxt: number;

  /* borg_cfg[BORG_MONEY_SCUM_AMOUNT] and the who/ware it targets
   * (borg-store-buy.c:43-44, :152-154). Mutated by good_buy / cleared by buy. */
  moneyScumAmount: number;
  moneyScumWho: number;
  moneyScumWare: number;
}

/** A fresh, empty store memory (matches the C initialisers). */
export function createStoreMemory(): StoreMemory {
  return {
    soldTval: [],
    soldSval: [],
    soldPval: [],
    soldStore: [],
    soldNum: -1,
    soldNxt: 0,
    boughtTval: [],
    boughtSval: [],
    boughtPval: [],
    boughtStore: [],
    boughtNum: -1,
    boughtNxt: 0,
    moneyScumAmount: 0,
    moneyScumWho: -1,
    moneyScumWare: -1,
  };
}

/** Record a sale (borg_think_shop_sell, borg-store-sell.c:1128). */
export function recordSold(
  mem: StoreMemory,
  item: ItemView,
  store: number,
): void {
  if (mem.soldNxt >= 9) mem.soldNxt = 0;
  mem.soldPval[mem.soldNxt] = item.pval;
  mem.soldTval[mem.soldNxt] = item.tval;
  mem.soldSval[mem.soldNxt] = item.sval;
  mem.soldStore[mem.soldNxt] = store;
  mem.soldNum = mem.soldNxt;
  mem.soldNxt++;
}

/** Record a purchase (borg_think_shop_buy, borg-store-buy.c:1226). */
export function recordBought(
  mem: StoreMemory,
  item: ItemView,
  store: number,
): void {
  if (mem.boughtNxt >= 9) mem.boughtNxt = 0;
  mem.boughtPval[mem.boughtNxt] = item.pval;
  mem.boughtTval[mem.boughtNxt] = item.tval;
  mem.boughtSval[mem.boughtNxt] = item.sval;
  mem.boughtStore[mem.boughtNxt] = store;
  mem.boughtNum = mem.boughtNxt;
  mem.boughtNxt++;
}

/* ------------------------------------------------------------------ *
 * The seam bundle.
 * ------------------------------------------------------------------ */

/**
 * A hypothetical loadout the borg wants borg.power for. Only the fields a given
 * decision varies are set; the seam should read them and return the resulting
 * borg.power. Absent a seam the port returns "no change" so nothing is bought or
 * sold on the player-power path.
 */
export interface BuySim {
  /** The candidate ware being evaluated. */
  item: StoreItemView;
  /** Quantity considered (borg_min_item_quantity). */
  qty: number;
  /** True when the item would be wielded (an equipment upgrade candidate). */
  wields: boolean;
}

/** All seams and config the store decisions read. Every field is optional. */
export interface StoreDeps {
  /* --- persistent anti-loop memory (see StoreMemory). --- */
  mem?: StoreMemory;

  /* --- z_info overrides (defaults: the faithful literals above). --- */
  storeInvenMax?: number;
  packSize?: number;
  /** k_info[kind].base->max_stack for an item (default 40, chest 1). */
  maxStack?: (item: ItemView) => number;

  /* --- knowledge seams (mirror item/deps.ts; same defaults). --- */
  /** object value in gold (borg_item.value); default ItemView.value ?? 0. */
  itemValue?: (item: ItemView) => number;
  /** object_flavor_is_aware; default true. */
  isAware?: (item: ItemView) => boolean;
  /** item fully identified; default true. */
  isIdent?: (item: ItemView) => boolean;
  /** item still needs identifying (borg_item.needs_ident); default false. */
  needsIdent?: (item: ItemView) => boolean;
  /** borg_item_note_needs_id: valuable + unknown-rune; default needsIdent. */
  noteNeedsId?: (item: ItemView) => boolean;
  /** borg_item_worth_id: worth identifying; default false. */
  worthId?: (item: ItemView) => boolean;
  /** The One Ring is worn in this slot (borg_item.one_ring); default artifactName. */
  isOneRing?: (item: ItemView) => boolean;

  /* --- borg_cfg[] (borg.txt). --- */
  /** borg_cfg[BORG_WORSHIPS_GOLD]; default false. */
  worshipsGold?: boolean;
  /** borg_cfg[BORG_SELF_SCUM]; default false. */
  selfScum?: boolean;
  /** borg_cfg[BORG_USES_SWAPS] && MAXDEPTH<90 (borg_uses_swaps); default true<90. */
  usesSwaps?: boolean;
  /** OPT(player, birth_no_selling); default false. */
  noSelling?: boolean;
  /** OPT(player, birth_randarts); default false. */
  randarts?: boolean;

  /* --- class/book seams (borg-magic.c). --- */
  /** borg_primarily_caster (num_books>3); default MAGE/PRIEST/DRUID/NECRO. */
  primarilyCaster?: boolean;
  /** amt_book[borg_get_book_num(sval)] carried count; default 0. */
  amtBook?: (item: ItemView) => number;
  /** obj_kind_can_browse(kind): the borg can read this book; default by tval. */
  canBrowse?: (item: ItemView) => boolean;
  /** borg_is_dungeon_book(tval, sval); default false. */
  isDungeonBook?: (item: ItemView) => boolean;

  /* --- player-power delta seams (see BuySim; default: no change). --- */
  /** borg.power if the ware were bought (borg_think_shop_buy_useful:363/388). */
  buyShopEval?: (ctx: BorgContext, sim: BuySim) => number;
  /** borg.power if the home ware were taken (borg_think_home_buy_useful). */
  buyHomeEval?: (ctx: BorgContext, sim: BuySim) => number;
  /** borg.power after selling qty of a pack item (borg_think_shop_sell_useless). */
  sellEval?: (ctx: BorgContext, item: ItemView, qty: number) => number;
  /**
   * borg.power after removing ONE of a pack item, for borg_think_home_sell_bad
   * (borg-store-sell.c:376). Default undefined -> the item is treated as "bad"
   * to stash (removing it would lower power), so the home optimiser stashes
   * nothing without a seam - the conservative default.
   */
  sellHomeBadEval?: (ctx: BorgContext, item: ItemView) => number;
  /** weapon_swap_value if a home weapon were taken (borg_think_home_buy_swap_weapon). */
  weaponSwapEval?: (ctx: BorgContext, item: ItemView) => number;
  /** armour_swap_value if a home armour were taken (borg_think_home_buy_swap_armour). */
  armourSwapEval?: (ctx: BorgContext, item: ItemView) => number;

  /* --- home-notice seams (see home.ts HomeExtras). --- */
  home?: HomeExtras;
}

/**
 * The parts of borg_notice_home (borg-home-notice.c) that read engine internals
 * the frozen view does not surface: castable spells (borg_spell_legal), an
 * equipped glyph activation (borg_equips_item), and the player race's innate
 * element resists / sustains (player->race->el_info, player_flags). Default:
 * nothing legal, no innate resists - so those additions are 0 (the borg relies
 * on the home wares + worn gear alone, a faithful "unaware" reading).
 */
export interface HomeExtras {
  spellLegal?: (spell: string) => boolean;
  spellLegalFail?: (spell: string, fail: number) => boolean;
  equipsGlyph?: boolean;
  /** player->race->el_info[ELEM_<name>].res_level. */
  raceResist?: (element: string) => number;
  /** player_flags contains OF_<name> (innate free-action, feather, etc.). */
  playerFlag?: (flag: string) => boolean;
}

/* ------------------------------------------------------------------ *
 * Seam accessors (defaults faithful to item/deps.ts).
 * ------------------------------------------------------------------ */

/** borg.trait[bi], 0 before borg_notice has run. */
export function st(ctx: BorgContext, bi: BI): number {
  return ctx.world.self.trait[bi] ?? 0;
}

export function storeInvenMax(d?: StoreDeps): number {
  return d?.storeInvenMax ?? STORE_INVEN_MAX;
}
export function packSize(d?: StoreDeps): number {
  return d?.packSize ?? PACK_SIZE;
}
export function maxStackOf(item: ItemView, d?: StoreDeps): number {
  if (d?.maxStack) return d.maxStack(item);
  return item.tval === TV.CHEST ? 1 : DEFAULT_MAX_STACK;
}
export function iqty(item: ItemView): number {
  return item.number;
}
export function itemValue(item: ItemView, d?: StoreDeps): number {
  if (d?.itemValue) return d.itemValue(item);
  return item.value ?? 0;
}
export function isAware(item: ItemView, d?: StoreDeps): boolean {
  return d?.isAware ? d.isAware(item) : true;
}
export function isIdent(item: ItemView, d?: StoreDeps): boolean {
  return d?.isIdent ? d.isIdent(item) : true;
}
export function needsIdent(item: ItemView, d?: StoreDeps): boolean {
  return d?.needsIdent ? d.needsIdent(item) : false;
}
export function noteNeedsId(item: ItemView, d?: StoreDeps): boolean {
  if (d?.noteNeedsId) return d.noteNeedsId(item);
  return needsIdent(item, d);
}
export function worthId(item: ItemView, d?: StoreDeps): boolean {
  return d?.worthId ? d.worthId(item) : false;
}
export function isOneRing(item: ItemView, d?: StoreDeps): boolean {
  if (d?.isOneRing) return d.isOneRing(item);
  return item.artifactName === "The One Ring";
}
export function svals(d?: StoreDeps): BorgSvalTable {
  void d;
  return SVAL;
}

/**
 * The buy price the borg stored as b_item->cost (borg-store.c:201). It is the
 * frozen StoreItemView.price. When absent (no registry dep) the borg cannot
 * afford it: treated as Infinity so it is skipped - the safe default.
 */
export function shopCost(item: StoreItemView): number {
  return item.price ?? Infinity;
}

/* ------------------------------------------------------------------ *
 * obj_kind_can_browse / the store's book set.
 * ------------------------------------------------------------------ */

/** A spellbook tval. */
export function isBookTval(tval: number): boolean {
  return (
    tval === TV.MAGIC_BOOK ||
    tval === TV.PRAYER_BOOK ||
    tval === TV.NATURE_BOOK ||
    tval === TV.SHADOW_BOOK ||
    tval === TV.OTHER_BOOK
  );
}

/**
 * obj_kind_can_browse(kind): true when the borg's class can read this book.
 * ItemView does not carry the class realm, so absent a seam the port treats any
 * spellbook as browsable (the black-market and low-level book guards then use
 * the other, sval-based checks). Supply canBrowse for exact per-class filtering.
 */
export function canBrowse(item: ItemView, d?: StoreDeps): boolean {
  if (d?.canBrowse) return d.canBrowse(item);
  return isBookTval(item.tval);
}

/* ------------------------------------------------------------------ *
 * Inventory / home occupancy (borg-store.c:46-56, borg-item.h PACK_SLOTS).
 * ------------------------------------------------------------------ */

/** PACK_SLOTS = z_info->pack_size - BI_QUIVER_SLOTS (borg-item.h:153). */
export function packSlots(ctx: BorgContext, d?: StoreDeps): number {
  return packSize(d) - st(ctx, BI.QUIVER_SLOTS);
}

/**
 * borg_first_empty_inventory_slot: index of the first empty pack slot, or -1.
 * The frozen inventory() lists occupied slots only, so the first empty is the
 * count (when below PACK_SLOTS).
 */
export function borgFirstEmptyInventorySlot(
  ctx: BorgContext,
  d?: StoreDeps,
): number {
  const used = ctx.view.inventory().filter((i) => i.number > 0).length;
  return used < packSlots(ctx, d) ? used : -1;
}

/** borg_inventory_full (borg-store.c:53). */
export function borgInventoryFull(ctx: BorgContext, d?: StoreDeps): boolean {
  return borgFirstEmptyInventorySlot(ctx, d) === -1;
}

/** The home StoreView, or null when not in town (borg-store.c BORG_HOME). */
export function homeStore(ctx: BorgContext): StoreView | null {
  const stores = ctx.view.stores();
  for (const s of stores) if (s.isHome) return s;
  return stores[BORG_HOME] ?? null;
}

/** The occupied home wares (borg_shops[BORG_HOME].ware with iqty != 0). */
export function homeWares(ctx: BorgContext): StoreItemView[] {
  const home = homeStore(ctx);
  if (!home) return [];
  return home.stock.filter((i) => i.number > 0);
}

/** borg_home_full (borg-store.c:46): the last home slot is occupied. */
export function borgHomeFull(ctx: BorgContext, d?: StoreDeps): boolean {
  return homeWares(ctx).length >= storeInvenMax(d);
}

/* ------------------------------------------------------------------ *
 * borg_min_item_quantity (borg-store-sell.c:281).
 * ------------------------------------------------------------------ */

/**
 * The minimum quantity of an item to buy/sell in one go. 1 for most; bunches of
 * cheap, known ammo/food (borg-store-sell.c:281).
 */
export function borgMinItemQuantity(
  ctx: BorgContext,
  item: ItemView,
  d?: StoreDeps,
): number {
  /* Only trade in bunches if sufficient cash (:284). */
  if (st(ctx, BI.GOLD) < 250) return 1;
  /* Don't trade expensive items in bunches (:288). */
  if (itemValue(item, d) > 5) return 1;
  /* Don't trade non-known items in bunches (:292). */
  if (!isAware(item, d)) return 1;

  switch (item.tval) {
    case TV.SHOT:
    case TV.ARROW:
    case TV.BOLT:
      if (iqty(item) < 5) return iqty(item);
      return 5;
    case TV.FOOD:
      if (iqty(item) < 3) return iqty(item);
      return 3;
    default:
      return 1;
  }
}

/**
 * borg_primarily_caster (borg-magic.c:264: class->magic.num_books > 3). Absent a
 * seam, true for the four primary casters (mage/priest/druid/necromancer).
 */
export function borgPrimarilyCaster(ctx: BorgContext, d?: StoreDeps): boolean {
  if (d?.primarilyCaster !== undefined) return d.primarilyCaster;
  const cls = st(ctx, BI.CLASS);
  /* CLASS_MAGE=1, CLASS_DRUID=2, CLASS_PRIEST=3, CLASS_NECROMANCER=4. */
  return cls === 1 || cls === 2 || cls === 3 || cls === 4;
}

/** borg_uses_swaps (borg-trait.c:1030): cfg && MAXDEPTH < 90. */
export function borgUsesSwaps(ctx: BorgContext, d?: StoreDeps): boolean {
  const cfg = d?.usesSwaps ?? true;
  return cfg && st(ctx, BI.MAXDEPTH) < 90;
}
