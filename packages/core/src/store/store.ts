/**
 * Store runtime and stock maintenance, ported from reference/src/store.c
 * (Angband 4.2.6): the live store instance plus store_maint and its helpers
 * (store_carry, store_object_absorb, store_check_num, mass_produce,
 * store_create_random, store_get_choice, store_create_item,
 * store_delete_random, store_find_kind, store_choose_owner, store_shuffle,
 * store_reset).
 *
 * Model divergences, all faithful in reachable states:
 * - The stock is a GameObject[] rather than upstream's doubly-linked pile;
 *   store->stock_num is the array length and store->stock_size is
 *   z_info->store_inven_max.
 * - There is no obj->known twin, so the parallel stock_k pile and every
 *   obj->known assignment are dropped (they mirror the real object; the
 *   knowledge/display system is a separate increment).
 * - player->max_depth (used only to pick generation levels) is threaded in as
 *   `maxDepth`, since dungeon progress is not modelled on Player yet.
 * - The buy/sell commands and home_carry live in store/transact.ts (they use
 *   the player pack model in game/gear.ts); this module is the stocking half.
 */

import type { Constants } from "../constants";
import { FEAT, OF, ORIGIN, TV } from "../generated";
import type { ObjRegistry } from "../obj/bind";
import type { MakeDeps } from "../obj/make";
import { applyMagic, objectPrep } from "../obj/make";
import type { GameObject, StackLimits } from "../obj/object";
import {
  distributeCharges,
  objectMergeable,
  objectOriginCombine,
  OSTACK_PACK,
  OSTACK_STORE,
  tvalCanHaveCharges,
  tvalCanHaveTimeout,
  tvalHasVariablePower,
  tvalIsAmmo,
  tvalIsArmor,
  tvalIsLauncher,
  tvalIsLight,
  tvalIsWeapon,
} from "../obj/object";
import type { ObjectKind } from "../obj/types";
import { objectValue, objectValueReal } from "../obj/value";
import type { Rng } from "../rng";
import type { BoundStore, ObjectBuy, StoreOwner } from "./types";

/**
 * A live store: a BoundStore's tables plus a mutable stock and the currently
 * selected proprietor.
 */
export interface Store {
  feat: number;
  featName: string;
  owners: StoreOwner[];
  /** The current proprietor (store->owner), chosen at bind/shuffle. */
  owner: StoreOwner;
  alwaysTable: ObjectKind[];
  normalTable: ObjectKind[];
  buy: ObjectBuy[] | null;
  turnover: number;
  normalStockMin: number;
  normalStockMax: number;
  /** Live stock (store->stock); its length is store->stock_num. */
  stock: GameObject[];
  /** store->stock_size = z_info->store_inven_max. */
  stockSize: number;
}

/** Context shared by the maintenance routines. */
export interface StoreMaintContext {
  rng: Rng;
  deps: MakeDeps;
  /** player->max_depth: the deepest dungeon level reached (0 in a fresh town). */
  maxDepth: number;
  /** Every live store, for black_market_ok's cross-store check. */
  stores: Store[];
}

/** OSTACK_STORE/PACK never read the quiver limits, so these go unused here. */
const STORE_LIMITS: StackLimits = { quiverSlotSize: 1, thrownQuiverMult: 1 };

/* ------------------------------------------------------------------ */
/* Owners (store.c L1465)                                              */
/* ------------------------------------------------------------------ */

/** store_choose_owner (L1478): a uniformly random proprietor. */
export function storeChooseOwner(
  rng: Rng,
  store: { owners: StoreOwner[]; featName: string },
): StoreOwner {
  const n = rng.randint0(store.owners.length);
  const owner = store.owners[n];
  if (!owner) throw new Error(`store ${store.featName} has no owners`);
  return owner;
}

/** store_shuffle (L1493): swap in a different proprietor. */
export function storeShuffle(rng: Rng, store: Store): void {
  let o = store.owner;
  while (o === store.owner) o = storeChooseOwner(rng, store);
  store.owner = o;
}

/** Create a live Store from a bound definition, choosing a proprietor. */
export function bindStoreRuntime(
  bound: BoundStore,
  rng: Rng,
  storeInvenMax: number,
): Store {
  return {
    feat: bound.feat,
    featName: bound.featName,
    owners: bound.owners,
    owner: storeChooseOwner(rng, bound),
    alwaysTable: bound.alwaysTable,
    normalTable: bound.normalTable,
    buy: bound.buy,
    turnover: bound.turnover,
    normalStockMin: bound.normalStockMin,
    normalStockMax: bound.normalStockMax,
    stock: [],
    stockSize: storeInvenMax,
  };
}

/* ------------------------------------------------------------------ */
/* Stock classification (store.c L373)                                 */
/* ------------------------------------------------------------------ */

/** store_is_staple (L373): is the kind on the store's always list? */
function storeIsStaple(store: Store, kind: ObjectKind): boolean {
  return store.alwaysTable.includes(kind);
}

/** store_can_carry (L391): is the kind on the normal or always list? */
function storeCanCarry(store: Store, kind: ObjectKind): boolean {
  return store.normalTable.includes(kind) || storeIsStaple(store, kind);
}

/** store_sale_should_reduce_stock (L405). */
export function storeSaleShouldReduceStock(store: Store, obj: GameObject): boolean {
  if (obj.artifact || obj.ego) return true;
  if (tvalIsWeapon(obj.tval) && (obj.toH || obj.toD)) return true;
  if (tvalIsArmor(obj.tval) && obj.toA) return true;
  return !storeIsStaple(store, obj.kind);
}

/* ------------------------------------------------------------------ */
/* Buy decision (store.c L524)                                         */
/* ------------------------------------------------------------------ */

/**
 * store_will_buy (L524): will this store purchase the object? The home accepts
 * anything; a normal store refuses apparently worthless items (except unknown
 * variable-power items when birth_no_selling is on) and, if it has a buy list,
 * only buys listed tvals.
 *
 * `aware` feeds object_value; `runesKnown` is object_runes_known(obj) for the
 * no-selling worthless exception. The buy-list flag branch's
 * object_flag_is_known check is DEFERRED (needs the knowledge system); 4.2.6
 * data uses only bare tvals (flag 0), so it is unreached at the baseline.
 */
export function storeWillBuy(
  reg: ObjRegistry,
  store: { feat: number; buy: ObjectBuy[] | null },
  obj: GameObject,
  aware: boolean,
  noSelling: boolean,
  runesKnown: boolean,
): boolean {
  /* Home accepts anything. */
  if (store.feat === FEAT.HOME) return true;

  /* Ignore apparently worthless items, except no-selling unknown items. */
  const value = objectValue(reg, obj, 1, aware);
  if (
    value <= 0 &&
    !(noSelling && tvalHasVariablePower(obj.tval) && !runesKnown)
  ) {
    return false;
  }

  /* No buy list means we buy anything. */
  if (!store.buy) return true;

  /* Run through the buy list. */
  for (const buy of store.buy) {
    if (buy.tval !== obj.tval) continue;
    if (!buy.flag) return true;
    /* DEFERRED: && object_flag_is_known(player, obj, buy.flag). */
    if (obj.flags.has(buy.flag)) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Mass production (store.c L680)                                      */
/* ------------------------------------------------------------------ */

/** mass_roll (L680): sum of `times` rolls of randint0(max). */
function massRoll(rng: Rng, times: number, max: number): number {
  let t = 0;
  for (let i = 0; i < times; i++) t += rng.randint0(max);
  return t;
}

/** mass_produce (L696): set a stack size for cheap store items. */
export function massProduce(reg: ObjRegistry, rng: Rng, obj: GameObject): void {
  let size = 1;
  const cost = objectValueReal(reg, obj, 1);

  switch (obj.tval) {
    case TV.FOOD:
    case TV.MUSHROOM:
    case TV.FLASK:
    case TV.LIGHT:
      if (cost <= 5) size += massRoll(rng, 3, 5);
      if (cost <= 20) size += massRoll(rng, 3, 5);
      break;
    case TV.POTION:
    case TV.SCROLL:
      if (cost <= 60) size += massRoll(rng, 3, 5);
      if (cost <= 240) size += massRoll(rng, 1, 5);
      break;
    case TV.MAGIC_BOOK:
    case TV.PRAYER_BOOK:
    case TV.NATURE_BOOK:
    case TV.SHADOW_BOOK:
    case TV.OTHER_BOOK:
      if (cost <= 50) size += massRoll(rng, 2, 3);
      if (cost <= 500) size += massRoll(rng, 1, 3);
      break;
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.SHIELD:
    case TV.GLOVES:
    case TV.BOOTS:
    case TV.CLOAK:
    case TV.HELM:
    case TV.CROWN:
    case TV.SWORD:
    case TV.POLEARM:
    case TV.HAFTED:
    case TV.DIGGING:
    case TV.BOW:
      if (obj.ego) break;
      if (cost <= 10) size += massRoll(rng, 3, 5);
      if (cost <= 100) size += massRoll(rng, 3, 5);
      break;
    case TV.SHOT:
    case TV.ARROW:
    case TV.BOLT:
      if (cost <= 5) size = rng.randint1(2) * 20;
      else if (cost > 5 && cost <= 50) size = rng.randint1(4) * 10;
      else if (cost > 50 && cost <= 500) size = rng.randint1(4) * 5;
      else size = 1;
      break;
    default:
      break;
  }

  obj.number = Math.min(size, obj.kind.base.maxStack);
}

/* ------------------------------------------------------------------ */
/* Carrying / removing stock (store.c L813)                            */
/* ------------------------------------------------------------------ */

/** store_object_absorb (L813): merge `newObj` into `old`, losing excess. */
function storeObjectAbsorb(old: GameObject, newObj: GameObject): void {
  const change =
    old.number < old.kind.base.maxStack
      ? Math.min(newObj.number, old.kind.base.maxStack - old.number)
      : 0;
  distributeCharges(newObj, old, change, false);
  old.number += change;
  objectOriginCombine(old, newObj, ORIGIN.MIXED);
  /* newObj is fully absorbed; the caller drops it (excess is lost). */
}

/** store_check_num (L836): will the store hold this object (room or merge)? */
export function storeCheckNum(store: Store, obj: GameObject): boolean {
  if (store.stock.length < store.stockSize) return true;
  const mode = store.feat === FEAT.HOME ? OSTACK_PACK : OSTACK_STORE;
  for (const stockObj of store.stock) {
    if (objectMergeable(stockObj, obj, mode, STORE_LIMITS)) return true;
  }
  return false;
}

/**
 * store_carry (L912): add a store-generated object to a real store, merging
 * into an existing stack when possible. Returns the resulting stack, or null
 * when the store rejects it (worthless, or no room). The player-carried value
 * branch and the obj->known pile are deferred to the transactions increment;
 * maintenance always passes fresh, non-carried objects.
 */
export function storeCarry(
  rng: Rng,
  reg: ObjRegistry,
  constants: Constants,
  store: Store,
  obj: GameObject,
  maintain: boolean,
): GameObject | null {
  const kind = obj.kind;

  /* Evaluate the object (store-generated -> real value). */
  const value = objectValueReal(reg, obj, 1);

  /* Cursed/worthless items "disappear" when sold. */
  if (value <= 0) return null;

  /* Erase the inscription. */
  obj.note = null;

  /* Some item types require maintenance. */
  if (tvalIsLight(obj.tval)) {
    if (!obj.flags.has(OF.NO_FUEL)) {
      if (obj.flags.has(OF.BURNS_OUT)) obj.timeout = constants.fuelTorch;
      else if (obj.flags.has(OF.TAKES_FUEL)) obj.timeout = constants.defaultLamp;
    }
  } else if (tvalCanHaveTimeout(obj.tval)) {
    obj.timeout = 0;
  } else if (tvalIsLauncher(obj.tval)) {
    /* obj->known->pval = obj->pval (no known twin; nothing to do). */
  } else if (tvalCanHaveCharges(obj.tval)) {
    /* If the store can stock this kind, recharge. */
    if (maintain && storeCanCarry(store, kind)) {
      let charges = 0;
      for (let i = 0; i < obj.number; i++) {
        charges += rng.randcalc(kind.charge, 0, "randomise");
      }
      /* Use the recharged value only if greater. */
      if (charges > obj.pval) obj.pval = charges;
    }
  }

  /* Try to merge into an existing stack. */
  for (const stockObj of store.stock) {
    if (objectMergeable(stockObj, obj, OSTACK_STORE, STORE_LIMITS)) {
      storeObjectAbsorb(stockObj, obj);
      return stockObj;
    }
  }

  /* No space? */
  if (store.stock.length >= store.stockSize) return null;

  store.stock.push(obj);
  return obj;
}

/** store_delete (L989): remove `amt` of a stack, or the whole stack. */
export function storeDelete(store: Store, obj: GameObject, amt: number): void {
  if (obj.number > amt) {
    obj.number -= amt;
  } else {
    const idx = store.stock.indexOf(obj);
    if (idx >= 0) store.stock.splice(idx, 1);
  }
}

/** store_find_kind (L1011): first stock of a kind, optionally excluded. */
function storeFindKind(
  store: Store,
  kind: ObjectKind,
  fexclude?: (s: Store, o: GameObject) => boolean,
): GameObject | null {
  for (const obj of store.stock) {
    if (obj.kind === kind && (!fexclude || !fexclude(store, obj))) return obj;
  }
  return null;
}

/** store_delete_random (L1040): imitate a non-PC buyer taking some stock. */
function storeDeleteRandom(rng: Rng, store: Store): void {
  if (store.stock.length === 0) return;
  const what = rng.randint0(store.stock.length);
  const obj = store.stock[what];
  if (!obj) return;

  let num = obj.number;
  if (num > 1) {
    if (tvalIsAmmo(obj.tval)) {
      if (rng.randint0(100) < 50 || num < 10) num = obj.number;
      else num = rng.randint1(Math.trunc(num / 5)) * 5 + (num % 5);
    } else {
      if (rng.randint0(100) < 50) num = 1;
      else if (rng.randint0(100) < 50) num = Math.trunc((num + 1) / 2);
      else num = obj.number;

      if (tvalCanHaveCharges(obj.tval)) {
        obj.pval -= Math.trunc((num * obj.pval) / obj.number);
      }
    }
  }

  storeDelete(store, obj, num);
}

/* ------------------------------------------------------------------ */
/* Random stock creation (store.c L1105)                               */
/* ------------------------------------------------------------------ */

/**
 * black_market_ok (L1105): the black market only stocks items other stores
 * do not, unless they are ego or notably enchanted.
 */
function blackMarketOk(
  reg: ObjRegistry,
  obj: GameObject,
  stores: Store[],
): boolean {
  if (obj.ego) return true;
  if (obj.toA > 2) return true;
  if (obj.toH > 1) return true;
  if (obj.toD > 2) return true;
  if (objectValueReal(reg, obj, 1) < 10) return false;

  for (const s of stores) {
    if (s.feat === FEAT.STORE_BLACK || s.feat === FEAT.HOME) continue;
    for (const stockObj of s.stock) {
      if (obj.kind === stockObj.kind) return false;
    }
  }
  return true;
}

/** store_get_choice (L1146): a random kind from the normal table. */
function storeGetChoice(rng: Rng, store: Store): ObjectKind {
  const kind = store.normalTable[rng.randint0(store.normalTable.length)];
  if (!kind) throw new Error(`store ${store.featName} has an empty normal table`);
  return kind;
}

/** store_create_random (L1156): make a random object and give it to the store. */
export function storeCreateRandom(ctx: StoreMaintContext, store: Store): boolean {
  const { rng, deps, maxDepth, stores } = ctx;
  const reg = deps.reg;
  const constants = deps.constants;

  let minLevel: number;
  let maxLevel: number;
  if (store.feat === FEAT.STORE_BLACK) {
    minLevel = maxDepth + 5;
    maxLevel = maxDepth + 20;
  } else {
    minLevel = 1;
    maxLevel = constants.storeMagicLevel + Math.max(maxDepth - 20, 0);
  }
  if (minLevel > 55) minLevel = 55;
  if (maxLevel > 70) maxLevel = 70;

  for (let tries = 0; tries < 6; tries++) {
    const level = rng.randRange(minLevel, maxLevel);

    const kind =
      store.feat === FEAT.STORE_BLACK
        ? deps.alloc.getObjNum(rng, constants, level, false, 0)
        : storeGetChoice(rng, store);

    /* No chests in stores. */
    if (!kind || kind.tval === TV.CHEST) continue;

    const obj = objectPrep(rng, reg, constants, kind, level, "randomise");
    applyMagic(rng, deps, obj, level, false, false, false, false);

    /* Reject 'damaged' items (negative combat mods, curses). */
    if (
      (tvalIsWeapon(obj.tval) && (obj.toH < 0 || obj.toD < 0)) ||
      (tvalIsArmor(obj.tval) && obj.toA < 0) ||
      obj.curses
    ) {
      continue;
    }

    obj.origin = ORIGIN.NONE;

    /* Black markets have expensive tastes. */
    if (store.feat === FEAT.STORE_BLACK && !blackMarketOk(reg, obj, stores)) {
      continue;
    }

    /* No worthless items. */
    if (objectValueReal(reg, obj, 1) < 1) continue;

    massProduce(reg, rng, obj);

    if (!storeCarry(rng, reg, constants, store, obj, true)) continue;

    return true;
  }

  return false;
}

/** store_create_item (L1262): make a specific always-stocked kind. */
export function storeCreateItem(
  ctx: StoreMaintContext,
  store: Store,
  kind: ObjectKind,
): GameObject | null {
  const reg = ctx.deps.reg;
  const constants = ctx.deps.constants;
  const obj = objectPrep(ctx.rng, reg, constants, kind, 0, "randomise");
  obj.origin = ORIGIN.NONE;
  return storeCarry(ctx.rng, reg, constants, store, obj, true);
}

/* ------------------------------------------------------------------ */
/* Maintenance (store.c L1294)                                         */
/* ------------------------------------------------------------------ */

/** store_maint (L1294): keep a store's stock between its bounds. */
export function storeMaint(ctx: StoreMaintContext, store: Store): void {
  const { rng, deps } = ctx;

  /* Ignore home. */
  if (store.feat === FEAT.HOME) return;

  /* Destroy crappy black market items. */
  if (store.feat === FEAT.STORE_BLACK) {
    for (const obj of [...store.stock]) {
      if (!blackMarketOk(deps.reg, obj, ctx.stores)) {
        storeDelete(store, obj, obj.number);
      }
    }
  }

  const alwaysNum = store.alwaysTable.length;

  if (store.turnover) {
    let stock = store.stock.length - rng.randint1(store.turnover);
    const min = 0;
    const max = store.normalStockMax;
    if (stock < min) stock = min;
    if (stock > max) stock = max;
    while (store.stock.length > stock) storeDeleteRandom(rng, store);
  } else if (alwaysNum && store.stock.length) {
    /* For the Bookseller, occasionally sell a book. */
    let sales = rng.randint1(store.stock.length);
    while (sales--) storeDeleteRandom(rng, store);
  }

  /* Ensure staples exist. */
  if (alwaysNum) {
    for (const kind of store.alwaysTable) {
      let obj = storeFindKind(store, kind, storeSaleShouldReduceStock);
      if (!obj) {
        obj = storeCreateItem(ctx, store, kind);
        if (!obj) continue;
      }
      /* Ensure a full stack. */
      obj.number = obj.kind.base.maxStack;
    }
  }

  if (store.turnover) {
    let stock = store.stock.length + rng.randint1(store.turnover);
    const min = store.normalStockMin + alwaysNum;
    const max = store.normalStockMax + alwaysNum;
    if (stock > max) stock = max;
    if (stock < min) stock = min;

    let restockAttempts = 100000;
    while (store.stock.length < stock && --restockAttempts) {
      storeCreateRandom(ctx, store);
    }
  }
}

/**
 * store_reset (L340): (re)initialise every non-home store's stock, running
 * store_maint ten times to fill it. Home is left empty.
 */
export function storeReset(ctx: StoreMaintContext): void {
  for (const store of ctx.stores) {
    store.stock = [];
    storeShuffle(ctx.rng, store);
    if (store.feat === FEAT.HOME) continue;
    for (let j = 0; j < 10; j++) storeMaint(ctx, store);
  }
}
