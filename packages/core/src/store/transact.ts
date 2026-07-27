/**
 * Store transactions, ported from reference/src/store.c (Angband 4.2.6): the
 * buy/sell/retrieve/stash commands and home_carry. This is the behavioural
 * other half of the store subsystem, sitting on the stocking layer (store.ts),
 * the pricing layer (price.ts), and the player pack model (game/gear.ts).
 *
 * The upstream commands are driven by the command queue (do_cmd_buy etc. read
 * cmd_get_arg_item / cmd_get_arg_number); here each is a plain function that
 * takes the object (or a pack handle) and amount directly, so the headless
 * core can run a transaction without the UI command layer. The economic and
 * inventory effects are faithful; the EVENT_* signals remain the caller's.
 *
 * LIVE vs DEFERRED (ledgered in parity/ledger/store-transact.yaml):
 * - LIVE: the gold debit/credit, the pack-room gate (inven_carry_num), the
 *   price (price_item), the buy decision (store_will_buy), the stack split /
 *   excise (gear_object_for_use), store_carry / store_delete / store_check_num,
 *   the empty-store restock (store_maint x10 with the shopkeeper-shuffle roll),
 *   the ORIGIN_STORE stamp, the OF_STICKY "stuck" refusal, home_carry, and the
 *   comment_accept / purchase_analyze ONE_OF draws on the game RNG.
 * - DEFERRED: the rune learn-on-transaction loop (object_learn_unknown_rune /
 *   player_know_object -> the knowledge/display system, task #13); flavor
 *   awareness IS applied when a FlavorKnowledge is supplied. The obj->known
 *   twin, total_weight upkeep, autoinscription, and history_find/lose_artifact
 *   are DEFERRED.
 */

import type { Constants } from "../constants";
import { FEAT, OF, ORIGIN } from "../generated";
import type { GameObject, StackLimits } from "../obj/object";
import {
  distributeCharges,
  objectAbsorb,
  objectMergeable,
  OSTACK_PACK,
  tvalCanHaveCharges,
} from "../obj/object";
import { NOOP_FLAVOR_AWARE_DEPS } from "../obj/knowledge";
import type { FlavorAwareDeps, FlavorKnowledge } from "../obj/knowledge";
import type { Gear } from "../game/gear";
import {
  gearObjectForUse,
  invenCarry,
  invenCarryNum,
  objectCopyAmt,
} from "../game/gear";
import type { Player } from "../player/player";
import { objectValue, objectValueReal } from "../obj/value";
import { priceItem } from "./price";
import {
  storeCarry,
  storeCheckNum,
  storeDelete,
  storeMaint,
  storeSaleShouldReduceStock,
  storeShuffle,
  storeWillBuy,
} from "./store";
import type { Store, StoreMaintContext } from "./store";

/** Pack stacking limits derived from the bound constants. */
function packLimits(constants: Constants): StackLimits {
  return {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  };
}

/** object_is_equipped: is the gear handle currently worn in a body slot? */
function isEquipped(player: Player, handle: number): boolean {
  return player.equipment.includes(handle);
}

/** obj_can_takeoff (obj-util.c L794): only non-sticky items come off. */
function objCanTakeoff(obj: GameObject): boolean {
  return !obj.flags.has(OF.STICKY);
}

/** Knowledge learned by transacting an item; runes are DEFERRED (task #13). */
export interface TxnKnowledge {
  /** When supplied, buying/selling makes the kind's flavor known. */
  flavor?: FlavorKnowledge;
  /**
   * The ignore/notice side effects of becoming aware (object_flavor_aware
   * L2276-2279, #89). Only meaningful alongside `flavor`; the in-play caller
   * (session/game.ts) supplies the real ignore-settings-backed deps, tests
   * and other non-interactive callers fall back to NOOP_FLAVOR_AWARE_DEPS.
   */
  flavorDeps?: FlavorAwareDeps;
  /** object_flavor_is_aware(obj), fed to object_value in price_item. */
  aware: boolean;
  /** OPT(player, birth_no_selling): the shop pays 0 and keeps the item. */
  noSelling: boolean;
  /** object_runes_known(obj), for store_will_buy's no-selling exception. */
  runesKnown?: boolean;
}

/* ------------------------------------------------------------------ */
/* do_cmd_buy (store.c L1650)                                          */
/* ------------------------------------------------------------------ */

/** Why a purchase could not complete. */
export type BuyFailure = "not-in-stock" | "no-room" | "cannot-afford";

/**
 * purchase_analyze's verbal-reaction bucket (store.c L491-508): how the paid
 * price compared to the item's real value and the store's apparent guess.
 */
export type SaleReaction = "worthless" | "bad" | "good" | "great";

/** comment_accept (store.c L453-461): ONE_OF pool for a successful buy. */
const COMMENT_ACCEPT = ["Okay.", "Fine.", "Accepted!", "Agreed!", "Done!", "Taken!"];

/** purchase_analyze reaction arrays (store.c L435-479). */
const COMMENT_WORTHLESS = [
  "Arrgghh!",
  "You bastard!",
  "You hear someone sobbing...",
  "The shopkeeper howls in agony!",
  "The shopkeeper wails in anguish!",
  "The shopkeeper beats his head against the counter.",
];
const COMMENT_BAD = [
  "Damn!",
  "You fiend!",
  "The shopkeeper curses at you.",
  "The shopkeeper glares at you.",
];
const COMMENT_GOOD = [
  "Cool!",
  "You've made my day!",
  "The shopkeeper sniggers.",
  "The shopkeeper giggles.",
  "The shopkeeper laughs loudly.",
];
const COMMENT_GREAT = [
  "Yipee!",
  "I think I'll retire!",
  "The shopkeeper jumps for joy.",
  "The shopkeeper smiles gleefully.",
  "Wow.  I'm going to name my new villa in your honour.",
];
const REACTION_COMMENTS: Record<SaleReaction, readonly string[]> = {
  worthless: COMMENT_WORTHLESS,
  bad: COMMENT_BAD,
  good: COMMENT_GOOD,
  great: COMMENT_GREAT,
};

/** The outcome of storeBuy. */
export interface BuyResult {
  ok: boolean;
  failure?: BuyFailure;
  /** Gold paid (present on success). */
  price?: number;
  /** The object added to the player's pack (present on success). */
  bought?: GameObject;
  /**
   * comment_accept line (do_cmd_buy L1717): set when one_in_(3) fires, drawn
   * from the game RNG BEFORE any empty-store shuffle/maint so the stream order
   * matches C. Absent when the Home retrieves or the roll fails.
   */
  acceptComment?: string;
  /**
   * store.c:1757-1763: when the purchase empties the store, the shopkeeper
   * either retires (the shuffle roll) or brings out new stock, and SAYS so.
   * "retired" | "restocked", absent when the store did not empty.
   */
  emptied?: "retired" | "restocked";
}

/**
 * do_cmd_buy (L1650): buy `amt` of the store-stock object `obj`. Copies the
 * desired amount, checks pack room and affordability, pays, carries it to the
 * player, and reduces the store stock (restocking an emptied store). The knows
 * flavor of the purchase; rune learning is DEFERRED (task #13).
 */
export function storeBuy(
  ctx: StoreMaintContext,
  store: Store,
  obj: GameObject,
  amt: number,
  player: Player,
  gear: Gear,
  know: TxnKnowledge,
): BuyResult {
  const { rng, deps } = ctx;
  const { reg, constants } = deps;

  if (!store.stock.includes(obj)) return { ok: false, failure: "not-in-stock" };

  /* Get the desired object. */
  const bought = objectCopyAmt(obj, amt);

  /* Ensure we have room. */
  if (bought.number > invenCarryNum(gear, bought, constants)) {
    return { ok: false, failure: "no-room" };
  }

  /* Extract the price for the entire stack. */
  const price = priceItem(
    reg,
    store,
    store.owner,
    bought,
    false,
    bought.number,
    know.aware,
    know.noSelling,
  );

  if (price > player.au) return { ok: false, failure: "cannot-afford" };

  /* Spend the money. */
  player.au -= price;

  /* Erase the inscription; give it a store origin. */
  bought.note = null;
  if (bought.origin === ORIGIN.NONE) bought.origin = ORIGIN.STORE;

  /* Reduce the number of charges in the original store stack. */
  if (tvalCanHaveCharges(obj.tval)) obj.pval -= bought.pval;

  /* Learn flavor (object_flavor_aware, including the #89 ignore fix); runes
   * are DEFERRED (task #13). */
  if (know.flavor) {
    know.flavor.objectFlavorAware(bought.kind, know.flavorDeps ?? NOOP_FLAVOR_AWARE_DEPS);
  }

  /* Give it to the player. */
  invenCarry(gear, bought, packLimits(constants));

  /* comment_accept (do_cmd_buy L1717): one_in_(3) then ONE_OF, BEFORE any
   * empty-store shuffle/maint so the main stream matches C statement order. */
  let acceptComment: string | undefined;
  if (rng.oneIn(3)) {
    acceptComment = COMMENT_ACCEPT[rng.randint0(COMMENT_ACCEPT.length)];
  }

  /* Remove the bought objects unless a readily-replaced staple. */
  let emptied: "retired" | "restocked" | undefined;
  if (storeSaleShouldReduceStock(store, obj)) {
    storeDelete(store, obj, amt);

    /* Store is empty: maybe shuffle the shopkeeper, then restock. */
    if (store.stock.length === 0) {
      if (rng.oneIn(constants.storeShuffle)) {
        storeShuffle(rng, store);
        emptied = "retired";
      } else {
        emptied = "restocked";
      }
      for (let i = 0; i < 10; i++) storeMaint(ctx, store);
    }
  }

  return {
    ok: true,
    price,
    bought,
    ...(acceptComment ? { acceptComment } : {}),
    ...(emptied ? { emptied } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* do_cmd_sell (store.c L1869)                                         */
/* ------------------------------------------------------------------ */

/** Why a sale could not complete. */
export type SellFailure = "no-item" | "stuck" | "refused" | "no-room";

/** The outcome of storeSell. */
export interface SellResult {
  ok: boolean;
  failure?: SellFailure;
  /** Gold received (0 under birth_no_selling; present on success). */
  price?: number;
  /** The object handed to the store (present on success). */
  sold?: GameObject;
  /** True when the whole pack stack was sold. */
  noneLeft?: boolean;
  /**
   * Whether store_carry accepted the sold object (do_cmd_sell L1985-1998).
   * false means the store discarded it as worthless / no-room; the caller uses
   * this to fire history_lose_artifact for a sold artifact the store rejected.
   */
  carried?: boolean;
  /**
   * purchase_analyze bucket (do_cmd_sell L1972): set on a successful non-Home
   * sale when birth_no_selling is off. undefined for the Home, no-selling, or
   * when no reaction fires.
   */
  reaction?: SaleReaction;
  /**
   * ONE_OF(comment_*) line drawn from the game RNG when a reaction fires
   * (purchase_analyze L491-508). The shell prints this; the draw is spent here
   * so Math.random never touches the main stream.
   */
  reactionComment?: string;
}

/**
 * purchase_analyze (store.c L491-508): classify the shopkeeper's reaction from
 * the gold paid, the item's real value, and its apparent (guessed) value.
 */
export function purchaseAnalyze(price: number, value: number, guess: number): SaleReaction | undefined {
  if (value <= 0 && price > value) return "worthless";
  if (value < guess && price > value) return "bad";
  if (value > guess && value < 4 * guess && price < value) return "good";
  if (value > guess && price < value) return "great";
  return undefined;
}

/**
 * do_cmd_sell (L1869): sell `amt` of the gear object at `handle` to the store.
 * Refuses stuck equipped items and items the store will not buy, checks the
 * store has room, pays the player, detaches the items, and hands them to the
 * store. Flavor becomes known; rune learning is DEFERRED (task #13).
 */
export function storeSell(
  ctx: StoreMaintContext,
  store: Store,
  handle: number,
  amt: number,
  player: Player,
  gear: Gear,
  know: TxnKnowledge,
): SellResult {
  const obj = gear.store.get(handle);
  if (!obj) return { ok: false, failure: "no-item" };

  /* Cannot remove stuck (sticky-cursed) equipped objects (ui-store.c L522). */
  if (isEquipped(player, handle) && !objCanTakeoff(obj)) {
    return { ok: false, failure: "stuck" };
  }

  /* gear_object_for_use handles the pack / equipment / quiver split-or-excise. */
  return sellObject(ctx, store, obj, amt, player, know, (n) =>
    gearObjectForUse(gear, player, handle, n),
  );
}

/**
 * store_sell for a FLOOR object (USE_FLOOR, ui-store.c L487 get_mode): the
 * player's own grid can hold a pile when a store is entered (entering does not
 * move the player onto the store feature), so a floor item is a valid sell
 * source. No equip/stuck guard applies (a floor object is never equipped); the
 * caller supplies the floor_object_for_use detach (game.ts owns GameState, so
 * transact.ts stays free of a game/floor import).
 */
export function storeSellFloor(
  ctx: StoreMaintContext,
  store: Store,
  obj: GameObject,
  amt: number,
  player: Player,
  know: TxnKnowledge,
  detach: (n: number) => { obj: GameObject; noneLeft: boolean },
): SellResult {
  return sellObject(ctx, store, obj, amt, player, know, detach);
}

/**
 * The shared body of do_cmd_sell (store.c L1869), after the source-specific item
 * pick and stuck guard: check the store wants it, that it has room, pay the
 * player, learn flavor, detach the sold copy from its source, hand it to the
 * store, and classify the shopkeeper reaction. `detach` removes `amt` from the
 * chosen source (gear_object_for_use for pack/equip/quiver, floor_object_for_use
 * for a floor pile).
 */
function sellObject(
  ctx: StoreMaintContext,
  store: Store,
  obj: GameObject,
  amt: number,
  player: Player,
  know: TxnKnowledge,
  detach: (n: number) => { obj: GameObject; noneLeft: boolean },
): SellResult {
  const { rng, deps } = ctx;
  const { reg, constants } = deps;

  amt = Math.min(amt, obj.number);

  /* Check the store wants the items being sold. */
  if (!storeWillBuy(reg, store, obj, know.aware, know.noSelling, know.runesKnown ?? false)) {
    return { ok: false, failure: "refused" };
  }

  /* A copy representing the number being sold, to test store room. */
  const dummy = objectCopyAmt(obj, amt);
  if (!storeCheckNum(store, dummy)) return { ok: false, failure: "no-room" };

  const price = priceItem(reg, store, store.owner, dummy, true, amt, know.aware, know.noSelling);

  /* purchase_analyze's "apparent" value (do_cmd_sell L1940, object_value on the
   * dummy): the guess, taken with the PRE-sale knowledge (know.aware) before the
   * item becomes fully known below. The "actual" value is computed from the sold
   * copy after the sale (L1959, object_value_real). */
  const guess = objectValue(reg, obj, amt, know.aware);

  /* Get some money. */
  player.au += price;

  /* Learn flavor (object_flavor_aware, including the #89 ignore fix); runes
   * are DEFERRED (task #13). */
  if (know.flavor) {
    know.flavor.objectFlavorAware(obj.kind, know.flavorDeps ?? NOOP_FLAVOR_AWARE_DEPS);
  }

  /* Take a proper copy of the now known-about object out of its source. */
  const { obj: sold, noneLeft } = detach(amt);

  /* The store gets that object (or, if worthless/no room, discards it). The
   * caller reads `carried` (whether store_carry accepted it) so it can fire
   * history_lose_artifact for a rejected artifact (do_cmd_sell L1985-1998). */
  const carried = storeCarry(rng, reg, constants, store, sold, true) !== null;

  /* purchase_analyze (do_cmd_sell L1966-1972): only a real store reacts, and
   * only when birth_no_selling is off (the no-selling branch just says "You had
   * ..."). value = object_value_real(sold, amt). ONE_OF(comment_*) draws from
   * the game RNG at this position (store.c L495-507). */
  let reaction: SaleReaction | undefined;
  let reactionComment: string | undefined;
  if (store.feat !== FEAT.HOME && !know.noSelling) {
    reaction = purchaseAnalyze(price, objectValueReal(reg, sold, amt), guess);
    if (reaction) {
      const arr = REACTION_COMMENTS[reaction];
      reactionComment = arr[rng.randint0(arr.length)];
    }
  }

  return {
    ok: true,
    price,
    sold,
    noneLeft,
    carried,
    ...(reaction ? { reaction } : {}),
    ...(reactionComment ? { reactionComment } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* do_cmd_retrieve (store.c L1783)                                     */
/* ------------------------------------------------------------------ */

/** The outcome of homeRetrieve / homeStash. */
export interface HomeResult {
  ok: boolean;
  failure?: "no-item" | "no-room" | "stuck";
  /** The moved object (present on success). */
  obj?: GameObject;
  /** True when the whole source stack was moved. */
  noneLeft?: boolean;
}

/**
 * do_cmd_retrieve (L1783): take `amt` of a home-stock object into the pack.
 * Copies the amount, checks pack room, redistributes charges out of the home
 * stack, carries it to the player, and reduces the home stock. No gold.
 */
export function homeRetrieve(
  store: Store,
  obj: GameObject,
  amt: number,
  gear: Gear,
  constants: Constants,
): HomeResult {
  if (!store.stock.includes(obj)) return { ok: false, failure: "no-item" };

  /* Get the desired object. */
  const picked = objectCopyAmt(obj, amt);

  /* Ensure we have room. */
  if (picked.number > invenCarryNum(gear, picked, constants)) {
    return { ok: false, failure: "no-room" };
  }

  /* Whether the whole home stack is leaving (before store_delete mutates it). */
  const noneLeft = amt >= obj.number;

  /* Distribute charges of wands, staves, or rods. */
  distributeCharges(obj, picked, amt, true);

  /* Give it to the player. */
  invenCarry(gear, picked, packLimits(constants));

  /* Reduce or remove the item. */
  storeDelete(store, obj, amt);

  return { ok: true, obj: picked, noneLeft };
}

/* ------------------------------------------------------------------ */
/* do_cmd_stash / home_carry (store.c L2009 / L870)                    */
/* ------------------------------------------------------------------ */

/**
 * home_carry (L870): add an object to the home's inventory, merging into a
 * compatible stack (OSTACK_PACK - the home acts like the player) or taking a
 * free slot. The object is dropped (lost) if the home is full.
 */
export function homeCarry(
  store: Store,
  obj: GameObject,
  constants: Constants,
): void {
  const limits = packLimits(constants);

  /* Try to combine with an existing home stack. */
  for (const stockObj of store.stock) {
    if (objectMergeable(stockObj, obj, OSTACK_PACK, limits)) {
      objectAbsorb(stockObj, obj, ORIGIN.MIXED);
      return;
    }
  }

  /* No space? Then the object is lost (upstream frees it). */
  if (store.stock.length >= store.stockSize) return;

  store.stock.push(obj);
}

/**
 * do_cmd_stash (L2009): drop `amt` of the gear object at `handle` into the
 * home. Refuses stuck equipped items, checks the home has room, detaches the
 * items, and lets the home carry them. No gold.
 */
export function homeStash(
  store: Store,
  handle: number,
  amt: number,
  player: Player,
  gear: Gear,
  constants: Constants,
): HomeResult {
  const obj = gear.store.get(handle);
  if (!obj) return { ok: false, failure: "no-item" };

  /* Cannot remove stuck (sticky-cursed) equipped objects. */
  if (isEquipped(player, handle) && !objCanTakeoff(obj)) {
    return { ok: false, failure: "stuck" };
  }

  amt = Math.min(amt, obj.number);

  /* A copy representing the number being stashed, to test home room. */
  const dummy = objectCopyAmt(obj, amt);
  if (!storeCheckNum(store, dummy)) return { ok: false, failure: "no-room" };

  /* Now get the real item and let the home carry it. */
  const { obj: dropped, noneLeft } = gearObjectForUse(gear, player, handle, amt);
  homeCarry(store, dropped, constants);

  return { ok: true, obj: dropped, noneLeft };
}
