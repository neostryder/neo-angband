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
 *
 * Also here: `installStoreCommands`, which registers the `shop-buy` /
 * `shop-sell` / `shop-exit` action-registry handlers `createAgentActions`
 * (agent/act.ts) builds commands for. Those three codes had no handler at
 * all until this was added (docs/PLANNED.md, "An agent cannot trade") - a
 * controller's shopping decisions reached the queue and were silently
 * dropped. The handlers use the guards above plus `storeAtGrid` to resolve
 * "which store" fresh from the player's grid, then commit through the same
 * `StartedGame.buy` / `.sell` closures the interactive shop screen calls.
 */

import { FEAT } from "../generated/index.js";
import { describeObject } from "../game/describe.js";
import type { GameState } from "../game/context.js";
import { gearGet } from "../game/gear.js";
import type { ActionRegistry } from "../game/player-turn.js";
import { ODESC } from "../obj/desc.js";
import type { GameObject } from "../obj/object.js";
import type { Store } from "./store.js";
import type { BuyResult, SellResult } from "./transact.js";

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

/**
 * store_at (store.c, read fresh from `square_shopnum`): the live store whose
 * entrance feature the player is standing on right now, or null. Every store
 * command below re-resolves this rather than trust a Store handed to it, for
 * the same reason the guards above exist - do_cmd_buy / do_cmd_sell /
 * do_cmd_retrieve / do_cmd_stash all call store_at(cave, player->grid) fresh,
 * every time (store.c:1665, :1795, :1872, :2014). The shell's own
 * `storeAtPlayer` (packages/web/src/main.ts) does the same lookup for the
 * interactive shop screen; this is the engine-side twin an agent's direct
 * commands need, since they carry no Store reference at all - only a stock
 * index or a gear handle.
 */
export function storeAtGrid(state: GameState): Store | null {
  const feat = state.chunk.feat(state.actor.grid);
  return state.stores?.find((s) => s.feat === feat) ?? null;
}

/**
 * The store transaction closures a `shop-buy` / `shop-sell` handler commits
 * through - the same `StartedGame.buy` / `.sell` a human's shop screen calls
 * (session/game.ts's makeStoreApi), so an agent's direct command and a
 * keystroke reach identical pack/gold/knowledge effects, artifact reveal and
 * quiver refresh included. Kept as an interface (not a StartedGame import)
 * so this module does not depend on session/game.ts.
 */
export interface StoreCommandDeps {
  buy: (store: Store, obj: GameObject, amt: number) => BuyResult;
  sell: (store: Store, handle: number, amt: number) => SellResult;
}

const BUY_FAILURE_SHOP: Record<string, string> = {
  "not-in-stock": "You cannot buy that item because it's not in the store.",
  "no-room": "You cannot carry that many items.",
  "cannot-afford": "You cannot afford that purchase.",
};

const BUY_FAILURE_HOME: Record<string, string> = {
  "not-in-stock": "You cannot retrieve that item because it's not in the home.",
  "no-room": "You cannot carry that many items.",
};

/**
 * Register `shop-buy`, `shop-sell` and `shop-exit` on the action registry -
 * the three command codes `createAgentActions` (agent/act.ts) builds and
 * nothing in the engine handled (docs/PLANNED.md, "An agent cannot trade").
 * On the same terms as every other verb: a plain `registry.register` entry
 * that runs whether the command arrived from a keystroke or an agent's
 * controller, and spends no energy - do_cmd_buy/_sell/_retrieve/_stash pass
 * no game turn (a shop visit does not let monsters act), and there is no
 * upstream leave-store command to spend one either.
 *
 * `shop-buy`/`shop-sell` carry no Store reference (an agent addresses a ware
 * by its stock index, an item by its gear handle - AgentView.stores()[n]
 * and view.inventory()[n], never a live object), so the handler resolves
 * "which store" itself via storeAtGrid and re-runs the entry guard
 * do_cmd_buy/_sell/_retrieve/_stash each run first, exactly as those C
 * functions do. `shop-exit` has no upstream engine counterpart at all - the
 * C command is a UI-only "close the shop screen" with no game-state effect -
 * so it is registered as a legitimate no-op rather than left unhandled.
 */
export function installStoreCommands(
  registry: ActionRegistry,
  deps: StoreCommandDeps,
): void {
  registry.register("shop-buy", (state, cmd) => {
    const args = cmd.args ?? {};
    const index = typeof args["index"] === "number" ? args["index"] : null;
    if (index === null) return 0;

    const store = storeAtGrid(state);
    if (!store) {
      state.msg?.(storeBuyGuard(null) ?? "You cannot purchase items when not in a store.");
      return 0;
    }
    const isHome = store.feat === FEAT.HOME;
    const refusal = isHome ? storeRetrieveGuard(store) : storeBuyGuard(store);
    if (refusal) {
      state.msg?.(refusal);
      return 0;
    }

    const obj = store.stock[index];
    if (!obj) {
      state.msg?.(
        isHome
          ? "You cannot retrieve that item because it's not in the home."
          : "You cannot buy that item because it's not in the store.",
      );
      return 0;
    }
    const rawQty = typeof args["quantity"] === "number" ? args["quantity"] : 1;
    const amt = Math.min(Math.max(1, rawQty), obj.number);

    const result = deps.buy(store, obj, amt);
    if (!result.ok) {
      const table = isHome ? BUY_FAILURE_HOME : BUY_FAILURE_SHOP;
      state.msg?.(table[result.failure ?? ""] ?? "The purchase failed.");
      return 0;
    }
    const bought = result.bought
      ? describeObject(state, result.bought, ODESC.PREFIX | ODESC.FULL)
      : "the item";
    /* comment_accept (do_cmd_buy L1717) prints before the sale line, exactly
     * as the interactive shop screen orders it. */
    if (result.acceptComment) state.msg?.(result.acceptComment);
    if (isHome) state.msg?.(`You have ${bought}.`);
    else state.msg?.(`You bought ${bought} for ${result.price} gold.`);
    if (result.emptied === "retired") state.msg?.("The shopkeeper retires.");
    else if (result.emptied === "restocked") {
      state.msg?.("The shopkeeper brings out some new stock.");
    }
    return 0;
  });

  registry.register("shop-sell", (state, cmd) => {
    const args = cmd.args ?? {};
    const handle = typeof args["handle"] === "number" ? args["handle"] : null;
    if (handle === null) return 0;

    const store = storeAtGrid(state);
    if (!store) {
      state.msg?.(storeSellGuard(null) ?? "You cannot sell items when not in a store.");
      return 0;
    }
    const isHome = store.feat === FEAT.HOME;
    const refusal = isHome ? storeStashGuard(store) : storeSellGuard(store);
    if (refusal) {
      state.msg?.(refusal);
      return 0;
    }

    const obj = gearGet(state.gear, handle);
    if (!obj) {
      state.msg?.("You do not have that item.");
      return 0;
    }
    const rawQty = typeof args["quantity"] === "number" ? args["quantity"] : obj.number;
    const amt = Math.min(Math.max(1, rawQty), obj.number);

    const result = deps.sell(store, handle, amt);
    if (!result.ok) {
      const why: Record<string, string> = {
        "no-item": "You do not have that item.",
        stuck: "Hmmm, it seems to be stuck.",
        refused: "I do not wish to purchase this item.",
        "no-room": isHome
          ? "Your home is full."
          : "I have not the room in my store to keep it.",
      };
      state.msg?.(why[result.failure ?? ""] ?? "The sale failed.");
      return 0;
    }
    const sold = result.sold
      ? describeObject(state, result.sold, ODESC.PREFIX | ODESC.FULL)
      : "the item";
    if (isHome) state.msg?.(`You have stashed ${sold}.`);
    else if (result.price) state.msg?.(`You sold ${sold} for ${result.price} gold.`);
    else state.msg?.(`You had ${sold}.`);
    /* purchase_analyze's reaction comment (do_cmd_sell L1972), same ordering
     * as the interactive shop screen. */
    if (result.reactionComment) state.msg?.(result.reactionComment);
    return 0;
  });

  /* leave_store (ui-store.c): a UI-only close with no upstream game-state
   * effect. Registered so the code has a real handler rather than falling
   * through to the base registry's no-op stub silently. */
  registry.register("shop-exit", () => 0);
}
