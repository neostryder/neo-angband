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

import { describeObject, ODESC } from "@neo-angband/core";
import type { GameObject, StartedGame, Store } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { selectFromMenu } from "./overlay";
import type { MenuItem } from "./overlay";
import { objectColor, objectName, packMenu } from "./screens";

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
 * Run the store screen for `store` until the player leaves (ESC). Buying picks
 * from the stock; 's' switches to selling from the pack. Returns when the
 * player leaves the shop.
 */
export async function runStore(
  term: GlyphTerm,
  game: StartedGame,
  store: Store,
  say: (text: string) => void,
): Promise<void> {
  for (;;) {
    const player = game.state.actor.player;
    const items: MenuItem[] = store.stock.map((obj) => {
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
      "[ a-z to buy, ESC to leave the shop ]",
    );
    if (pick === null) return;

    if (pick === items.length) {
      await sellFlow(term, game, store, say);
      continue;
    }

    const obj = store.stock[pick];
    if (!obj) continue;
    const result = game.buy(store, obj, 1);
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
