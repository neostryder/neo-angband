/**
 * The store COMMANDS' entry guards, ported from reference/src/store.c's
 * do_cmd_buy (L1650), do_cmd_retrieve (L1783), do_cmd_sell (L1869) and
 * do_cmd_stash (L2009), plus enter_store (ui-store.c L1255) - Angband 4.2.6.
 *
 * Each of those four commands begins by resolving `store_at(cave, player->grid)`
 * AFRESH and refusing if the player is not standing in a store of the right
 * kind. The transactions themselves (store/transact.ts storeBuy / storeSell)
 * already model every later failure; these are the checks that come first, and
 * the port had none of them: its shop screen captured one Store when the player
 * stepped onto the tile and then called the transaction directly, so a command
 * naming a store the player is not in was inexpressible.
 *
 * That was an argument from the port's current UI, not from the C. Upstream's
 * commands take the store from the grid every time, so a mod adding remote trade
 * - or anything that moves the player mid-transaction - reaches these. They are
 * therefore real guards on the command path, returning upstream's message or
 * null to proceed, rather than assertions.
 */

import { FEAT } from "../generated/index.js";
import type { Store } from "./store.js";

/**
 * do_cmd_buy (store.c:1667-1670): purchasing requires standing in a store.
 * Returns the refusal message, or null when the command may proceed.
 */
export function storeBuyGuard(store: Store | null): string | null {
  if (!store) return "You cannot purchase items when not in a store.";
  return null;
}

/**
 * do_cmd_retrieve (store.c:1793-1800): taking from the Home requires being at
 * the Home. Upstream returns SILENTLY when there is no store at all (L1794) and
 * only speaks when the store is not the Home, so a null store says nothing.
 */
export function storeRetrieveGuard(store: Store | null): string | null {
  if (!store) return null;
  if (store.feat !== FEAT.HOME) return "You are not currently at home.";
  return null;
}

/**
 * do_cmd_sell (store.c:1902-1905): selling requires standing in a store. Note
 * upstream checks this AFTER the stuck-item check (L1889-1893), so a stuck item
 * outside a store reports being stuck, not the absent store.
 */
export function storeSellGuard(store: Store | null): string | null {
  if (!store) return "You cannot sell items when not in a store.";
  return null;
}

/**
 * do_cmd_stash (store.c:2031-2034): stashing requires the Home, and unlike
 * retrieve this one speaks for a null store too - the condition is
 * `!store || store->feat != FEAT_HOME`.
 */
export function storeStashGuard(store: Store | null): string | null {
  if (!store || store.feat !== FEAT.HOME) return "You are not in your home.";
  return null;
}

/**
 * enter_store (ui-store.c:1257-1262): the store screen refuses to open when the
 * player's grid holds no store. The port opens the screen as a post-move
 * consequence, so this fires only if the grid stops holding a store between the
 * step and the screen opening - which is exactly the case upstream guards.
 */
export function enterStoreGuard(store: Store | null): string | null {
  if (!store) return "You see no store here.";
  return null;
}
