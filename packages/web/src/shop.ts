/**
 * The store screen (ui-store.c): browse a shop's stock, buy an item, sell one
 * from the pack, or leave. The core owns the runtime - pricing (price_item),
 * the buy/sell transactions, and restocking - exposed as game.buy / game.sell /
 * game.price (session/game.ts); this is the presentation loop over them.
 *
 * Entering a shop is not a game turn (do_cmd_store runs its own input loop), so
 * the screen reuses the modal menu primitive: each pass shows the current stock
 * and gold, so a purchase or sale is reflected immediately.
 */

import {
  describeObject,
  ODESC,
  gearGet,
  invenCarryNum,
  tvalIsWearable,
  tvalIsAmmo,
  tvalIsLight,
  tvalIsChest,
  FEAT,
  earlierObject,
} from "@neo-angband/core";
import type { GameObject, StartedGame, Store, EarlierObjectOpts } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { selectFromMenu, promptNumber } from "./overlay";
import type { MenuItem } from "./overlay";
import { objectColor, objectName, packMenu } from "./screens";

/**
 * find_inven (store.c L1515-1644): the quantity of `obj`'s stackable equivalent
 * already carried in the (non-equipped) pack, for the "(you have N)" hint in the
 * buy/take-how-many prompt. Chests never stack (return 0); food/potions/scrolls/
 * devices match on kind alone; wearables and ammo additionally require identical
 * bonuses, artifact/ego identity, light fuel, and base values; all cases then
 * require equal object flags. The port has no separate quiver yet (gap 4.1), so
 * only the pack is scanned - a faithful subset (the quiver would only add ammo).
 * The upstream modifier-compare loop is a known no-op (its `continue` restarts
 * the inner loop, never skipping the item), so it is intentionally omitted here.
 */
export function findInven(game: StartedGame, obj: GameObject): number {
  if (tvalIsChest(obj.tval)) return 0;
  const state = game.state;
  const needsBonusMatch = tvalIsWearable(obj.tval) || tvalIsAmmo(obj.tval);
  let num = 0;
  for (const handle of state.gear.pack) {
    const g = gearGet(state.gear, handle);
    if (!g || g.kind !== obj.kind) continue;
    if (needsBonusMatch) {
      if (obj.toH !== g.toH || obj.toD !== g.toD || obj.toA !== g.toA) continue;
      if (obj.artifact !== g.artifact) continue;
      if (obj.ego !== g.ego) continue;
      if (tvalIsLight(obj.tval) && obj.timeout !== g.timeout) continue;
      if (obj.ac !== g.ac || obj.dd !== g.dd || obj.ds !== g.ds) continue;
    }
    if (!obj.flags.isEqual(g.flags)) continue;
    num += g.number;
  }
  return num;
}

/** A single-line name for a store-stock object (store items are fully known). */
function stockName(game: StartedGame, obj: GameObject): string {
  return describeObject(game.state, obj, ODESC.PREFIX | ODESC.FULL);
}

/** Sell an item from the pack to the store, one pass of the sell picker. */
async function sellFlow(
  term: GlyphTerm,
  game: StartedGame,
  store: Store,
  say: (text: string) => void,
): Promise<void> {
  const { items, handles } = packMenu(game.state);
  if (items.length === 0) {
    say("You have nothing to sell.");
    return;
  }
  const idx = await selectFromMenu(
    term,
    "Sell which item?",
    items,
    "[ a-z to sell, ESC to cancel ]",
  );
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  const name = objectName(game.state, game.state.gear.store.get(handle)!);
  const result = game.sell(store, handle, 1);
  if (!result.ok) {
    const why: Record<string, string> = {
      "no-item": "You do not have that item.",
      stuck: "You cannot remove that - it is stuck to you.",
      refused: "The shopkeeper does not want that.",
      "no-room": "The shopkeeper has no room for it.",
    };
    say(why[result.failure ?? ""] ?? "The sale failed.");
    return;
  }
  say(`You sold ${name} for ${result.price} gold.`);
}

/**
 * store_stock_list (store.c:779-808): order the stock for display by repeatedly
 * choosing the earlier_object-earliest remaining item (a selection sort), in
 * store mode for a real shop and full-inventory mode for the Home. Upstream's
 * store_carry / home_carry insert at the pile head and do NOT sort - ordering is
 * purely a display concern (earlier_object: usable ammo first, then decreasing
 * tval, increasing sval, decreasing value / ammo increasing). The value key
 * uses the per-item buy price as the object_value proxy; within one owner it is
 * monotonic in object_value, so the equal-tval/equal-sval ties resolve the same.
 */
export function sortStoreStock(game: StartedGame, store: Store): GameObject[] {
  const opts: EarlierObjectOpts = {
    store: store.feat !== FEAT.HOME,
    ammoTval: game.state.actor.combat.ammoTval,
    objectValue: (o) => game.price(store, o, false, 1),
  };
  const remaining = [...store.stock];
  const out: GameObject[] = [];
  while (remaining.length > 0) {
    let firstIdx = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (earlierObject(remaining[firstIdx] ?? null, remaining[i] ?? null, opts)) {
        firstIdx = i;
      }
    }
    const chosen = remaining[firstIdx];
    if (chosen) out.push(chosen);
    remaining.splice(firstIdx, 1);
  }
  return out;
}

/**
 * Run the store screen for `store` until the player leaves (ESC). Stock is
 * shown in store_stock_list order. Buying picks a stock row by its letter, or
 * p/g buys the highlighted row; s/d sells from the pack; ESC leaves - the store
 * command keys of ui-store.c:1097-1120.
 */
export async function runStore(
  term: GlyphTerm,
  game: StartedGame,
  store: Store,
  say: (text: string) => void,
  constants: Parameters<typeof invenCarryNum>[2],
): Promise<void> {
  for (;;) {
    const player = game.state.actor.player;
    const displayStock = sortStoreStock(game, store);
    const items: MenuItem[] = displayStock.map((obj) => {
      // Per-item price (buying one at a time), like the store's price column.
      const price = game.price(store, obj, false, 1);
      return {
        label: `${stockName(game, obj).padEnd(34).slice(0, 34)} ${String(price).padStart(6)} au ea`,
        color: objectColor(obj),
      };
    });
    const sellRow: MenuItem = { label: "Sell an item from your pack..." };
    const title = `${store.featName.replace(/^STORE_/, "")}  -  ${store.owner.name}    [ Gold: ${player.au} ]`;
    const pick = await selectFromMenu(
      term,
      title,
      [...items, sellRow],
      "[ a-z or p/g buy, s/d sell, ESC leave ]",
      {
        // Store command keys (ui-store.c:1097-1120), which take precedence over
        // positional letters: p/g buy the highlighted stock row, s/d sell from
        // the pack, l/x examine (not yet implemented - consumed so they do not
        // misfire as positional selections). ESC leaves via selectFromMenu.
        commands: {
          p: (c) => (c < displayStock.length ? c : null),
          g: (c) => (c < displayStock.length ? c : null),
          s: () => items.length,
          d: () => items.length,
          l: () => null,
          x: () => null,
        },
      },
    );
    if (pick === null) return;

    if (pick === items.length) {
      await sellFlow(term, game, store, say);
      continue;
    }

    const obj = displayStock[pick];
    if (!obj) continue;
    // Quantity selection, faithful to store_purchase (ui-store.c L611-682): a
    // single-item stack buys one with no prompt; a multi-item stack works out
    // the maximum the player can afford and carry, then asks "Buy/Take how
    // many?" with the find_inven "(you have N)" owned count appended.
    const isHome = store.feat === FEAT.HOME;
    let amt = 1;
    if (obj.number !== 1) {
      if (isHome) {
        amt = obj.number;
      } else {
        const priceOne = game.price(store, obj, false, 1);
        if (player.au < priceOne) {
          say("You do not have enough gold for this item.");
          continue;
        }
        amt = priceOne === 0 ? obj.number : Math.trunc(player.au / priceOne);
        if (amt > obj.number) amt = obj.number;
      }
      amt = Math.min(amt, invenCarryNum(game.state.gear, obj, constants));
      if (amt <= 0) {
        say("You cannot carry that many items.");
        continue;
      }
      // find_inven owned count; suppressed for an unaware flavour outside the
      // Home so a purchase does not leak the flavour's identity (ui-store.c L669).
      const aware = game.flavor ? game.flavor.isAware(obj.kind) : true;
      const owned = !aware && !isHome ? 0 : findInven(game, obj);
      const have = owned ? ` (you have ${owned})` : "";
      const picked = await promptNumber(
        term,
        `${isHome ? "Take" : "Buy"} how many?${have}`,
        amt,
        1,
        amt,
        `(max ${amt})`,
      );
      if (picked === null || picked <= 0) continue;
      amt = picked;
    }
    const result = game.buy(store, obj, amt);
    if (!result.ok) {
      const why: Record<string, string> = {
        "not-in-stock": "That item is no longer in stock.",
        "no-room": "You cannot carry any more.",
        "cannot-afford": "You do not have enough gold.",
      };
      say(why[result.failure ?? ""] ?? "The purchase failed.");
      continue;
    }
    // Name the item actually bought (one), not the store's stack.
    const bought = result.bought
      ? describeObject(game.state, result.bought, ODESC.PREFIX | ODESC.FULL)
      : "the item";
    say(`You bought ${bought} for ${result.price} gold.`);
  }
}
