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

import type { Constants } from "../constants.js";
import { FEAT, OF, ORIGIN, TV } from "../generated/index.js";
import type { ObjRegistry } from "../obj/bind.js";
import type { MakeDeps } from "../obj/make.js";
import { applyMagic, objectPrep } from "../obj/make.js";
import type { GameObject, StackLimits } from "../obj/object.js";
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
} from "../obj/object.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import type { Artifact, ObjectKind } from "../obj/types.js";
import type { PlayerClass } from "../player/types.js";
import { objectValue, objectValueReal } from "../obj/value.js";
import type { Rng } from "../rng.js";
import type { BoundStore, ObjectBuy, StoreOwner } from "./types.js";

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
  /**
   * store_update's cheat_xtra readouts (store.c:1424, :1444). The option is in
   * scope per the exact-parity mandate; the session supplies this sink only
   * when cheat_xtra is on, so faithful play stays silent.
   */
  cheatMsg?: (text: string) => void;
  /**
   * history_lose_artifact (store.c:1091 inside store_delete_random, and :1307
   * in the black-market purge). Those are the only two of upstream's four
   * store_delete callers that log a loss - do_cmd_buy's two (L1754, L1847) do
   * not, because the player is taking the artifact, not losing it.
   *
   * Reachable in this port only through an artifact the PLAYER sold into stock:
   * store generation never produces one (applyMagic is called with
   * allowArtifacts false). Absent for worldless callers.
   */
  onArtifactLost?: (art: Artifact) => void;
  /**
   * Store behaviour a mod may have added to (StoreBehaviourRegistry). wireGame
   * builds one per game and seeds it with core's; absent means the core-only
   * fallback, which is what the worldless harnesses want.
   */
  behaviour?: StoreBehaviourRegistry;
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

/**
 * store_shuffle (L1493): swap in a different proprietor.
 *
 * C store.c:1497-1498 retries until the owner changes and assumes more than
 * one owner. A one-owner table (accepted by the port's data model) would spin
 * forever. Keep the multi-owner draw loop identical to C; terminate cleanly
 * when there is only one owner (randint0(1) is a no-op on the WELL stream).
 */
export function storeShuffle(rng: Rng, store: Store): void {
  if (store.owners.length <= 1) {
    if (store.owners.length === 1) store.owner = storeChooseOwner(rng, store);
    return;
  }
  let o = store.owner;
  while (o === store.owner) o = storeChooseOwner(rng, store);
  store.owner = o;
}

/**
 * object_kind_to_book branch of parse_always (store.c:208-231): every TOWN
 * (non-dungeon) book kind of `tval`, deduped. A book is a town book when some
 * class lists it as a non-dungeon book (object_kind_to_book, player-spell.c).
 * The bookseller's no-sval `always:` lines are expanded here, which needs
 * the class-book metadata unavailable at parse time.
 */
function townBooksOfTval(
  reg: ObjRegistry,
  classes: readonly PlayerClass[],
  tval: number,
): ObjectKind[] {
  const out: ObjectKind[] = [];
  const seen = new Set<number>();
  for (const cls of classes) {
    for (const b of cls.magic.books) {
      if (b.tvalIdx !== tval || b.dungeon) continue;
      const kind = reg.lookupKind(b.tvalIdx, b.sval);
      if (kind && !seen.has(kind.kidx)) {
        seen.add(kind.kidx);
        out.push(kind);
      }
    }
  }
  return out;
}

/**
 * Create a live Store from a bound definition. The proprietor is a provisional
 * placeholder (owners[0]); store_reset assigns the real owner with a single
 * randint0, matching C store_shuffle against a NULL initial owner (store.c
 * L340-357, L1493-1501). When `reg`/`classes` are supplied, the bookseller's
 * deferred town-book `always:` lines (bound.alwaysBookTvals) are expanded into
 * the runtime alwaysTable so the shop stocks the town spellbooks
 * (parse_always, store.c:208-231).
 *
 * `rng` is accepted for call-site compatibility but is not consumed here - the
 * first owner draw happens in storeReset.
 */
export function bindStoreRuntime(
  bound: BoundStore,
  _rng: Rng,
  storeInvenMax: number,
  reg?: ObjRegistry,
  classes?: readonly PlayerClass[],
): Store {
  /* A fresh array so the parse-time bound.alwaysTable stays pristine (the
   * expansion is per store instance / per new game). */
  const alwaysTable = [...bound.alwaysTable];
  if (reg && classes && bound.alwaysBookTvals.length) {
    for (const tval of bound.alwaysBookTvals) {
      for (const kind of townBooksOfTval(reg, classes, tval)) {
        if (!alwaysTable.includes(kind)) alwaysTable.push(kind);
      }
    }
  }
  const provisional = bound.owners[0];
  if (!provisional) throw new Error(`store ${bound.featName} has no owners`);
  return {
    feat: bound.feat,
    featName: bound.featName,
    owners: bound.owners,
    owner: provisional,
    alwaysTable,
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
 * no-selling worthless exception.
 *
 * `flagKnown` is object_flag_is_known(player, obj, flag) bound to this object
 * (PORT_TODO 2.10 / 5.8). It is REQUIRED rather than optional so the compiler
 * enumerates the supplier set: an optional knowledge seam on a store check is
 * how the gate came to be commented out in the first place, and a defaulted one
 * would have re-created the same hole silently.
 *
 * The branch is unreachable on 4.2.6 data — every `buy:` line in
 * `lib/gamedata/store.txt` is a bare tval and `buy-flag:` appears only in the
 * file's own format comment — but "no shipped data reaches it" is a fact about
 * the data, not about the code. A mod that adds a `buy-flag:` line gets
 * upstream's behaviour now instead of a store that buys on a rune the player has
 * never learned.
 */
export function storeWillBuy(
  reg: ObjRegistry,
  store: { feat: number; buy: ObjectBuy[] | null },
  obj: GameObject,
  aware: boolean,
  noSelling: boolean,
  runesKnown: boolean,
  flagKnown: (flag: number) => boolean,
  behaviour: StoreBehaviourRegistry = fallbackStoreBehaviour(),
): boolean {
  const handler =
    behaviour.willBuyFor(store.feat) ?? behaviour.willBuyFor(ANY_STORE);
  /* An emptied registry refuses rather than becoming permissive: "nobody
   * decides" must not read as "every store buys anything". */
  if (handler === null) return false;
  return handler({ reg, store, obj, aware, noSelling, runesKnown, flagKnown });
}

/**
 * store_will_buy's faithful 4.2.6 body, registered under ANY_STORE so that it
 * is both the default AND something a mod can take hold of and wrap.
 */
function coreWillBuy(ctx: StoreWillBuyContext): boolean {
  const { reg, store, obj, aware, noSelling, runesKnown, flagKnown } = ctx;

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
    /* OK if the object is known to have the flag (L550-551): BOTH conjuncts. */
    if (obj.flags.has(buy.flag) && flagKnown(buy.flag)) return true;
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

/**
 * mass_produce (L696): set a stack size for cheap store items.
 *
 * The 27-case tval switch is a registry now, so a mod can give its own object
 * type a stack rule or change one of core's. The maxStack clamp stays here
 * rather than in the handlers: it is the object base's limit, not the store's
 * decision, and a mod should not have to remember it to avoid breaking piles.
 */
export function massProduce(
  reg: ObjRegistry,
  rng: Rng,
  obj: GameObject,
  behaviour: StoreBehaviourRegistry = fallbackStoreBehaviour(),
): void {
  const cost = objectValueReal(reg, obj, 1);
  const handler = behaviour.massProduceFor(obj.tval);
  /* No handler is upstream's `default: break` - the stack stays 1. */
  const size =
    handler === null
      ? 1
      : handler({
          rng,
          obj,
          cost,
          massRoll: (times, max) => massRoll(rng, times, max),
        });
  obj.number = Math.min(size, obj.kind.base.maxStack);
}

/* ------------------------------------------------------------------ *
 * The store-behaviour registry
 * ------------------------------------------------------------------ *
 *
 * Two dispatch points lived here as switches: what a store WILL BUY, and how
 * many of a thing it stocks. Neither could be reached from outside its
 * function, so "my mod adds a shop that deals in X" was a data record with no
 * behaviour behind it - the same gap the blow-effect registry closed for
 * monsters, in the other half of the game.
 */

/** The wildcard key: the buy decision every store falls back to. */
export const ANY_STORE = "*" as const;

/** What `mass_produce` is deciding, handed to one tval's handler. */
export interface MassProduceContext {
  rng: Rng;
  obj: GameObject;
  /** object_value_real(obj, 1) - the cost band every core arm keys on. */
  cost: number;
  /** mass_roll(times, max): the sum of `times` rolls of randint0(max). */
  massRoll: (times: number, max: number) => number;
}

/** Returns the stack size, BEFORE the object base's maxStack clamp. */
export type MassProduceHandler = (ctx: MassProduceContext) => number;

/** What `store_will_buy` is deciding, handed to one store's handler. */
export interface StoreWillBuyContext {
  reg: ObjRegistry;
  store: { feat: number; buy: ObjectBuy[] | null };
  obj: GameObject;
  /** Feeds object_value. */
  aware: boolean;
  /** birth_no_selling. */
  noSelling: boolean;
  /** object_runes_known(obj), for the no-selling worthless exception. */
  runesKnown: boolean;
  /** object_flag_is_known(player, obj, flag), bound to this object. */
  flagKnown: (flag: number) => boolean;
}

export type WillBuyHandler = (ctx: StoreWillBuyContext) => boolean;

/**
 * Store behaviour a mod can add to, override or wrap.
 *
 * Keyed the way each decision is actually made: stack size by TVAL, because
 * that is what upstream's switch keys on, and the buy decision by store FEAT
 * with a wildcard, because upstream has one body that every store shares.
 * Registering core's body under the wildcard is what makes wrapping possible -
 * a mod takes `willBuyFor(ANY_STORE)` and calls through it, instead of
 * reimplementing the worthless-item and buy-list rules and hoping they stay
 * correct.
 */
export class StoreBehaviourRegistry {
  private readonly mass = new Map<number, MassProduceHandler>();
  private readonly buy = new Map<number | typeof ANY_STORE, WillBuyHandler>();

  /** Install (or replace) the stack rule for a tval. */
  registerMassProduce(tval: number, handler: MassProduceHandler): void {
    this.mass.set(tval, handler);
  }

  /** The stack rule currently installed for a tval, or null. */
  massProduceFor(tval: number): MassProduceHandler | null {
    return this.mass.get(tval) ?? null;
  }

  /** Every tval that has a stack rule. */
  massProduceTvals(): readonly number[] {
    return [...this.mass.keys()];
  }

  /** Install the buy decision for one store feat, or for ANY_STORE. */
  registerWillBuy(feat: number | typeof ANY_STORE, handler: WillBuyHandler): void {
    this.buy.set(feat, handler);
  }

  /** The buy decision installed for that key, or null. Wrap by re-registering. */
  willBuyFor(feat: number | typeof ANY_STORE): WillBuyHandler | null {
    return this.buy.get(feat) ?? null;
  }
}

/**
 * The registry used when a caller supplied none: the worldless harnesses and
 * the direct-call tests. `wireGame` builds a fresh one per game, so one
 * character's mod cannot leak into the next, and a mod never reaches this one
 * because the facade refuses to register when the host wired no registry.
 */
let storeFallback: StoreBehaviourRegistry | null = null;
function fallbackStoreBehaviour(): StoreBehaviourRegistry {
  if (storeFallback === null) {
    storeFallback = new StoreBehaviourRegistry();
    registerCoreStoreBehaviour(storeFallback);
  }
  return storeFallback;
}

/**
 * Seed a registry with 4.2.6's own behaviour: the buy decision, and the five
 * arms of the mass_produce switch, lifted arm by arm with nothing rewritten.
 * `mass-produce-vectors.json` is what proves none of them moved.
 */
export function registerCoreStoreBehaviour(reg: StoreBehaviourRegistry): void {
  reg.registerWillBuy(ANY_STORE, coreWillBuy);

  const arm = (tvals: readonly number[], handler: MassProduceHandler): void => {
    for (const tval of tvals) reg.registerMassProduce(tval, handler);
  };

  arm([TV.FOOD, TV.MUSHROOM, TV.FLASK, TV.LIGHT], ({ cost, massRoll: roll }) => {
    let size = 1;
    if (cost <= 5) size += roll(3, 5);
    if (cost <= 20) size += roll(3, 5);
    return size;
  });

  arm([TV.POTION, TV.SCROLL], ({ cost, massRoll: roll }) => {
    let size = 1;
    if (cost <= 60) size += roll(3, 5);
    if (cost <= 240) size += roll(1, 5);
    return size;
  });

  /* Unreachable with 4.2.6 data - every shipped book costs more than the 500
   * ceiling - and kept faithful regardless. A mod adding a cheap book reaches
   * it; mass-produce-vectors.test.ts asserts the absence so that the day a
   * pack change makes books stack, somebody finds out. */
  arm(
    [TV.MAGIC_BOOK, TV.PRAYER_BOOK, TV.NATURE_BOOK, TV.SHADOW_BOOK, TV.OTHER_BOOK],
    ({ cost, massRoll: roll }) => {
      let size = 1;
      if (cost <= 50) size += roll(2, 3);
      if (cost <= 500) size += roll(1, 3);
      return size;
    },
  );

  arm(
    [
      TV.SOFT_ARMOR,
      TV.HARD_ARMOR,
      TV.SHIELD,
      TV.GLOVES,
      TV.BOOTS,
      TV.CLOAK,
      TV.HELM,
      TV.CROWN,
      TV.SWORD,
      TV.POLEARM,
      TV.HAFTED,
      TV.DIGGING,
      TV.BOW,
    ],
    ({ obj, cost, massRoll: roll }) => {
      /* An ego item is never mass-produced: upstream breaks out of the case
       * BEFORE either roll, so no RNG is drawn either. */
      if (obj.ego) return 1;
      let size = 1;
      if (cost <= 10) size += roll(3, 5);
      if (cost <= 100) size += roll(3, 5);
      return size;
    },
  );

  /* Ammo ASSIGNS rather than adds, which is why it cannot share the arm above. */
  arm([TV.SHOT, TV.ARROW, TV.BOLT], ({ rng, cost }) => {
    if (cost <= 5) return rng.randint1(2) * 20;
    if (cost > 5 && cost <= 50) return rng.randint1(4) * 10;
    if (cost > 50 && cost <= 500) return rng.randint1(4) * 5;
    return 1;
  });
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
function storeDeleteRandom(
  rng: Rng,
  store: Store,
  onArtifactLost?: (art: Artifact) => void,
): void {
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

  /* store.c:1090-1092, AFTER num is settled and before the delete. */
  if (obj.artifact) onArtifactLost?.(obj.artifact);

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
    /* depth 0: store stock is generated at the player's town depth, so no
     * artifacts (allowArtifacts is false regardless). */
    applyMagic(rng, deps, obj, level, false, false, false, false, 0);

    /* Reject 'damaged' items (negative combat mods, curses). */
    if (
      (tvalIsWeapon(obj.tval) && (obj.toH < 0 || obj.toD < 0)) ||
      (tvalIsArmor(obj.tval) && obj.toA < 0) ||
      obj.curses
    ) {
      continue;
    }

    /* The player knows everything about store stock (store.c L1216-1219:
     * obj->known->notice |= OBJ_NOTICE_ASSESSED; player_know_object). The port
     * keeps the assessed bit on the live object, where objectKnownShadow reads
     * it to fill combat/mod details, so a mundane enchanted item shows its
     * (+h,+d)/[+a] with no "{??}" and only unlearned ego runes flag "{??}". */
    obj.notice |= OBJ_NOTICE.ASSESSED;
    obj.origin = ORIGIN.NONE;

    /* Black markets have expensive tastes. */
    if (store.feat === FEAT.STORE_BLACK && !blackMarketOk(reg, obj, stores)) {
      continue;
    }

    /* No worthless items. */
    if (objectValueReal(reg, obj, 1) < 1) continue;

    massProduce(reg, rng, obj, ctx.behaviour);

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
  /* Store stock is fully assessed (store.c L1274-1276); see storeCreateRandom. */
  obj.notice |= OBJ_NOTICE.ASSESSED;
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
        /* store.c:1305-1310. */
        if (obj.artifact) ctx.onArtifactLost?.(obj.artifact);
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
    while (store.stock.length > stock) {
      storeDeleteRandom(rng, store, ctx.onArtifactLost);
    }
  } else if (alwaysNum && store.stock.length) {
    /* For the Bookseller, occasionally sell a book. */
    let sales = rng.randint1(store.stock.length);
    while (sales--) storeDeleteRandom(rng, store, ctx.onArtifactLost);
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
 * store_update (L1422): on the return to town, catch the stores up on the days
 * that elapsed while the player was in the dungeon. For each accrued day, run
 * store_maint on every non-home store, then occasionally (one_in_(store_shuffle))
 * shuffle one random non-home shopkeeper. The home is never maintained. The
 * caller zeroes daycount afterwards (upstream sets `daycount = 0` at the end).
 *
 * RNG order is faithful: all maintenance draws for the day precede the single
 * shuffle-chance draw, and the store picked to shuffle is randint0(n_non_home).
 */
export function storeUpdate(ctx: StoreMaintContext, daycount: number): void {
  const shuffle = ctx.deps.constants.storeShuffle;
  ctx.cheatMsg?.("Updating Shops...");
  let dc = daycount;
  while (dc-- > 0) {
    /* Maintain each shop (except home). */
    for (const store of ctx.stores) {
      if (store.feat === FEAT.HOME) continue;
      storeMaint(ctx, store);
    }
    /* Sometimes, shuffle the shop-keepers. */
    if (ctx.rng.oneIn(shuffle)) {
      ctx.cheatMsg?.("Shuffling a Shopkeeper...");
      const nonHome = ctx.stores.filter((s) => s.feat !== FEAT.HOME);
      if (nonHome.length > 0) {
        const n = ctx.rng.randint0(nonHome.length);
        storeShuffle(ctx.rng, nonHome[n]!);
      }
    }
  }
}

/**
 * store_reset (L340): (re)initialise every non-home store's stock, running
 * store_maint ten times to fill it. Home is left empty.
 *
 * Owner assignment matches C store_shuffle against a NULL initial owner: a
 * single randint0(n_owners) per store, not a force-different re-draw (the port
 * used to choose at bind and again in storeShuffle, over-drawing the stream).
 * Later re-shuffles (store_update / empty-store) still use storeShuffle.
 */
export function storeReset(ctx: StoreMaintContext): void {
  for (const store of ctx.stores) {
    store.stock = [];
    store.owner = storeChooseOwner(ctx.rng, store);
    if (store.feat === FEAT.HOME) continue;
    for (let j = 0; j < 10; j++) storeMaint(ctx, store);
  }
}

/**
 * store_init + store_reset for a fresh town: build every store's live instance
 * from the bound registry and stock it. Returns the stores in registry order
 * (the session holds them on GameState; a shell looks one up by entrance feat).
 */
export function createTownStores(
  bound: BoundStore[],
  deps: MakeDeps,
  rng: Rng,
  maxDepth: number,
  classes?: readonly PlayerClass[],
): Store[] {
  const stores = bound.map((b) =>
    bindStoreRuntime(b, rng, deps.constants.storeInvenMax, deps.reg, classes),
  );
  storeReset({ rng, deps, maxDepth, stores });
  return stores;
}
