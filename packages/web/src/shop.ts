/**
 * The store screen (ui-store.c): a faithful full-screen shop - browse the
 * stock, buy an item, sell one from the pack, examine, or leave. The core owns
 * the runtime - pricing (price_item), the buy/sell transactions, and restocking
 * - exposed as game.buy / game.sell / game.price (session/game.ts); this is the
 * presentation loop over them.
 *
 * Entering a shop is not a game turn (do_cmd_store runs its own input loop), so
 * this owns the keyboard while open and repaints the whole terminal each pass,
 * exactly as the upstream single-threaded store menu does. The layout mirrors
 * store_display_recalc / store_display_frame / store_display_entry to the column:
 *
 *   line 0: reserved for messages / inline prompts (get_quantity, confirms)
 *   line 1: owner name (left) and "<Store> (<purse>)" (right)  [Home: "Your Home"]
 *   line 3: "Store Inventory"        "Weight"     "Price"      [Home: no Price]
 *   line 4+: the lettered stock, each with its weight and per-item price
 *   line (h-1): "Gold Remaining: <au>" and the "Press '?' for help." prompt
 *
 * The letter tags come from the store selection string (store_menu_set_selections),
 * which skips the command keys so a selection letter never collides with p/g/s/d/
 * l/x; a selection letter opens the item context menu (Examine / Buy [/ Buy one]),
 * and p/g / s/d / l/x drive purchase / sell / examine directly, as ui-store.c does.
 */

import {
  describeObject,
  ODESC,
  gearGet,
  invenCarryNum,
  objectCopyAmt,
  tvalIsWearable,
  tvalIsAmmo,
  tvalIsLight,
  tvalIsChest,
  tvalIsBook,
  tvalCanHaveCharges,
  FEAT,
  earlierObject,
} from "@neo-angband/core";
import type { GameObject, StartedGame, Store, EarlierObjectOpts } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { selectFromMenu } from "./overlay";
import { objectColor, objectName, packMenu } from "./screens";
import { UI_TEXT, UI_DIM, UI_CURSOR, UI_CURSOR_DISABLED, UI_GOOD } from "./ui-colors";

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

/* ------------------------------------------------------------------ */
/* Store screen                                                          */
/* ------------------------------------------------------------------ */

/** The two store selection strings (store_menu_set_selections, ui-store.c L797-806):
 * the letters used to tag / pick stock rows, deliberately disjoint from the
 * command keys (p/g/s/d/l/x/...) so a selection letter never fires a command. */
export const SEL_ORIGINAL = "acfhjmnoqruvyzABDFGHJKLMNOPQRSTUVWXYZ";
export const SEL_ROGUE = "abcfmnoqrtuvyzABDFGHJKLMNOQRSUVWXYZ";

/** Callbacks the store screen needs from the shell (kept out of core, decision 21). */
export interface StoreScreenDeps {
  /** f_info[store->feat].name, e.g. "General Store" (store_display_frame). */
  featureName: string;
  /** rogue_like_commands: swaps the selection string and the 'l'/'x' help key. */
  rogueLike: boolean;
  /** store_examine (ui-store.c L749): show the object_info screen for `obj`. */
  examine: (obj: GameObject) => Promise<void>;
}

/** One keyboard key or one grid tap from the store's own input listener. */
type StoreInput = { type: "key"; key: string } | { type: "tap"; row: number; col: number };

/**
 * Read a single key OR a tap while the store owns the terminal (the store menu's
 * inkey / mouse read). Lone modifier keydowns are ignored so a Shift chord does
 * not resolve as a bare key. Registers and tears down its own window-keydown and
 * onCellTap handlers each call, so no two readers are ever live at once.
 */
function readStoreInput(term: GlyphTerm): Promise<StoreInput> {
  return new Promise<StoreInput>((resolve) => {
    const finish = (value: StoreInput): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish({ type: "key", key: ev.key });
    };
    window.addEventListener("keydown", onKey, true);
    term.onCellTap?.((cell) => finish({ type: "tap", row: cell.row, col: cell.col }));
  });
}

/**
 * get_quantity (textui_get_quantity, ui-input.c L1206): an inline row-0 amount
 * prompt over the current screen. Returns 1 without prompting when max is 1;
 * otherwise pre-fills the default "1", accepts digits (and '*'/a letter for
 * "all"), Enter to accept, Escape to abort (0). The result is clamped to
 * [0, max]. `prompt` is the caller's (e.g. "Buy how many? (max 5) ") or the
 * default "Quantity (0-N, *=all): " when null.
 */
function getQuantity(
  term: GlyphTerm,
  prompt: string | null,
  max: number,
): Promise<number> {
  if (max === 1) return Promise.resolve(1);
  return new Promise<number>((resolve) => {
    const label = prompt ?? `Quantity (0-${max}, *=all): `;
    let buf = "1";
    let all = false;
    const paint = (): void => {
      const { cols } = term.size();
      term.print(0, 0, " ".repeat(cols - 1), UI_TEXT);
      term.print(0, 0, `${label}${buf}`.slice(0, cols - 1), UI_TEXT);
    };
    const finish = (value: number): void => {
      window.removeEventListener("keydown", onKey, true);
      const { cols } = term.size();
      term.print(0, 0, " ".repeat(cols - 1), UI_TEXT);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(0);
      if (ev.key === "Enter") {
        // atoi(buf): a leading '*'/letter means "all"; else parse digits.
        let amt = all ? max : Number.parseInt(buf, 10);
        if (!Number.isFinite(amt)) amt = 0;
        if (amt > max) amt = max;
        if (amt < 0) amt = 0;
        return finish(amt);
      }
      if (ev.key === "Backspace") {
        buf = buf.slice(0, -1);
        all = false;
        paint();
        return;
      }
      if (ev.key.length === 1 && buf.length < 7) {
        if (ev.key === "*" || /^[a-zA-Z]$/.test(ev.key)) all = true;
        buf += ev.key;
        paint();
      }
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/**
 * store_get_check (ui-store.c L461-479): the store's own confirmation - prompt
 * at row 0, one key, ESC or 'n'/'N' declines and ANY other key accepts (unlike
 * the game-wide get_check's y-only). `price`, when given, is shown on row 1 as
 * "Price: N" (the buy/sell confirmation shows the total before committing).
 * Assumes the store frame is already painted behind it.
 */
function storeConfirm(
  term: GlyphTerm,
  prompt: string,
  price?: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { cols } = term.size();
    if (price !== undefined) term.print(0, 1, `Price: ${price}`.slice(0, cols - 1), UI_TEXT);
    term.print(0, 0, prompt.slice(0, cols - 1), UI_TEXT);
    const finish = (value: boolean): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape" || ev.key === "n" || ev.key === "N") return finish(false);
      finish(true);
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * Greedy word-wrap a stream of CSS-coloured runs to `width` columns, preserving
 * each run's colour across wrap boundaries (the store help legend, text_out with
 * COLOUR_L_GREEN command keys). Breaks on spaces; a word longer than the width
 * is hard-split. Returns one array of runs per output line.
 */
export function wrapCssRuns(
  runs: readonly { text: string; color: string }[],
  width: number,
): { text: string; color: string }[][] {
  const w = Math.max(1, width);
  type C = { ch: string; color: string };
  const chars: C[] = [];
  for (const run of runs) for (const ch of run.text) chars.push({ ch, color: run.color });

  const group = (slice: C[]): C[] => {
    const line: C[] = [];
    for (const c of slice) {
      const last = line[line.length - 1];
      if (last && last.color === c.color) last.ch += c.ch;
      else line.push({ ch: c.ch, color: c.color });
    }
    return line;
  };

  const out: { text: string; color: string }[][] = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + w, chars.length);
    if (end < chars.length) {
      let brk = -1;
      for (let i = end - 1; i > start; i--) {
        if (chars[i]!.ch === " ") { brk = i; break; }
      }
      if (brk > start) end = brk;
    }
    out.push(group(chars.slice(start, end)).map((c) => ({ text: c.ch, color: c.color })));
    start = end;
    if (start < chars.length && chars[start]!.ch === " ") start++;
  }
  return out.length ? out : [[]];
}

/**
 * A book of the wrong realm shows " (Can't use!)" in the buy confirm
 * (store_purchase, ui-store.c L700-719): obj_can_use = !is_book || obj_can_browse.
 * A non-book is always "usable" here; a book is usable only if it is one of the
 * birthed class's readable spellbook kinds (obj_kind_can_browse).
 */
function objCanUse(game: StartedGame, obj: GameObject): boolean {
  if (!tvalIsBook(obj.tval)) return true;
  return game.state.actor.player.cls.magic.books.some(
    (b) => b.tvalIdx === obj.tval && b.sval === obj.sval,
  );
}

/**
 * Run the store screen for `store` until the player leaves (ESC). Faithful to
 * ui-store.c: full-screen frame, lettered stock, the store command keys, and the
 * inline buy/sell/quantity/confirm prompts.
 */
export async function runStore(
  term: GlyphTerm,
  game: StartedGame,
  store: Store,
  say: (text: string) => void,
  constants: Parameters<typeof invenCarryNum>[2],
  deps: StoreScreenDeps,
): Promise<void> {
  const isHome = store.feat === FEAT.HOME;
  const noSelling = game.state.options?.get("birth_no_selling") ?? false;
  const selections = deps.rogueLike ? SEL_ROGUE : SEL_ORIGINAL;

  let displayStock = sortStoreStock(game, store);
  let cursor = 0;
  let top = 0;
  let helpShown = false;
  // The last transaction / error message. Upstream store_redraw never clears
  // row 0, so a "You bought ..." msg persists on the message line until the
  // next command clears it (prt("", 0, 0) at the head of the store actions);
  // the full-repaint model needs to carry it forward explicitly.
  let statusMsg = "";
  const storeSay = (text: string): void => {
    statusMsg = text;
    say(text);
  };

  // Layout geometry, recomputed each paint from the (fixed) term size and the
  // current help state, mirroring store_display_recalc.
  const geom = (): {
    priceX: number;
    auX: number;
    ownerX: number;
    weightX: number;
    listTop: number;
    listRows: number;
    auY: number;
    helpPromptY: number;
    helpClearY: number;
    nameWidth: number;
  } => {
    const { cols, rows } = term.size();
    const wid = Math.min(cols, 104);
    const priceX = wid - 14;
    const auX = wid - 26;
    const ownerX = wid - 2;
    const weightX = isHome ? wid - 14 : wid - 24;
    let hgt = rows;
    if (helpShown) hgt -= 3;
    const moreY = hgt - 3;
    const auY = hgt - 1;
    const helpClearY = helpShown ? hgt - 1 : hgt - 2;
    const helpPromptY = helpShown ? hgt : hgt - 1;
    const listTop = 4;
    const listRows = Math.max(1, moreY - listTop);
    const nameWidth = Math.max(1, weightX - 4 - 1);
    return { priceX, auX, ownerX, weightX, listTop, listRows, auY, helpPromptY, helpClearY, nameWidth };
  };

  const refreshStock = (): void => {
    displayStock = sortStoreStock(game, store);
    if (cursor >= displayStock.length) cursor = Math.max(0, displayStock.length - 1);
  };

  /** store_display_help (ui-store.c L376): the coloured command legend. */
  const helpRuns = (): { text: string; color: string }[] => {
    const g = UI_GOOD;
    const w = UI_TEXT;
    const runs: { text: string; color: string }[] = [];
    runs.push({ text: deps.rogueLike ? "x" : "l", color: g });
    runs.push({ text: " examines and ", color: w });
    runs.push({ text: "p", color: g });
    runs.push({ text: " (or ", color: w });
    runs.push({ text: "g", color: g });
    runs.push({ text: ")", color: w });
    runs.push({ text: isHome ? " picks up" : " purchases", color: w });
    runs.push({ text: " an item. ", color: w });
    if (noSelling && !isHome) {
      runs.push({ text: "d", color: g });
      runs.push({ text: " (or ", color: w });
      runs.push({ text: "s", color: g });
      runs.push({ text: ")", color: w });
      runs.push({
        text: " gives an item to the store in return for its identification. Some wands and staves will also be recharged. ",
        color: w,
      });
    } else {
      runs.push({ text: "d", color: g });
      runs.push({ text: " (or ", color: w });
      runs.push({ text: "s", color: g });
      runs.push({ text: ")", color: w });
      runs.push({ text: isHome ? " drops" : " sells", color: w });
      runs.push({ text: " an item from your inventory. ", color: w });
    }
    runs.push({ text: "I", color: g });
    runs.push({ text: " inspects an item from your inventory. ", color: w });
    runs.push({ text: "ESC", color: g });
    runs.push({ text: " exits the building.", color: w });
    return runs;
  };

  /** Repaint the whole store, optionally with an inline prompt on row 0. */
  const paint = (prompt?: string): void => {
    const { cols } = term.size();
    const gm = geom();
    term.clear();

    // Row 1: owner / store name (store_display_frame).
    if (isHome) {
      term.print(1, 1, "Your Home", UI_TEXT);
    } else {
      term.print(1, 1, store.owner.name.slice(0, gm.ownerX - 1), UI_TEXT);
      const buf = `${deps.featureName} (${store.owner.maxCost})`;
      term.print(Math.max(0, gm.ownerX - buf.length), 1, buf, UI_TEXT);
    }

    // Row 3: column headers.
    term.print(1, 3, isHome ? "Home Inventory" : "Store Inventory", UI_TEXT);
    term.print(gm.weightX + 2, 3, "Weight", UI_TEXT);
    if (!isHome) term.print(gm.priceX + 4, 3, "Price", UI_TEXT);

    // Rows 4+: the lettered stock (store_display_entry). Keep the cursor visible.
    if (cursor < top) top = cursor;
    if (cursor >= top + gm.listRows) top = cursor - gm.listRows + 1;
    for (let r = 0; r < gm.listRows; r++) {
      const i = top + r;
      const obj = displayStock[i];
      if (!obj) break;
      const y = gm.listTop + r;
      const onCursor = i === cursor;
      const colCursor = onCursor ? UI_CURSOR : UI_TEXT;
      const tag = selections[i - top] ?? " ";
      term.print(1, y, `${tag}) `, colCursor);
      const desc = ODESC.PREFIX | ODESC.FULL | (isHome ? 0 : ODESC.STORE);
      const name = describeObject(game.state, obj, desc);
      term.print(4, y, name.slice(0, gm.nameWidth), objectColor(obj));
      const w = obj.weight;
      const weightStr = `${String(Math.trunc(w / 10)).padStart(3)}.${w % 10} lb`;
      term.print(gm.weightX, y, weightStr, colCursor);
      if (!isHome) {
        const x = game.price(store, obj, false, 1);
        const afford = game.state.actor.player.au >= x;
        const priceCol = afford ? colCursor : onCursor ? UI_CURSOR_DISABLED : UI_DIM;
        const suffix = tvalCanHaveCharges(obj.tval) && obj.number > 1 ? " avg" : "    ";
        term.print(gm.priceX, y, `${String(x).padStart(9)}${suffix}`, priceCol);
      }
    }

    // Bottom: gold remaining + the help prompt / help block.
    if (helpShown) {
      const lines = wrapCssRuns(helpRuns(), Math.min(cols, 104) - 2);
      for (let i = 0; i < lines.length; i++) {
        const y = gm.helpPromptY + i;
        let x = 1;
        for (const run of lines[i] ?? []) {
          term.print(x, y, run.text, run.color);
          x += run.text.length;
        }
      }
    } else {
      term.print(1, gm.helpPromptY, "Press '?' for help.", UI_TEXT);
    }
    term.print(gm.auX, gm.auY, `Gold Remaining: ${String(game.state.actor.player.au).padStart(9)}`, UI_TEXT);

    if (prompt !== undefined) term.print(0, 0, prompt.slice(0, cols - 1), UI_TEXT);
    else if (statusMsg) term.print(0, 0, statusMsg.slice(0, cols - 1), UI_TEXT);
  };

  /** Move the cursor from an arrow / numpad key; returns true if it handled it. */
  const moveCursor = (key: string): boolean => {
    const n = displayStock.length;
    if (n === 0) return false;
    if (key === "ArrowUp" || key === "8") cursor = (cursor + n - 1) % n;
    else if (key === "ArrowDown" || key === "2") cursor = (cursor + 1) % n;
    else if (key === "Home" || key === "7") cursor = 0;
    else if (key === "End" || key === "1") cursor = n - 1;
    else return false;
    return true;
  };

  /**
   * store_get_stock (ui-store.c L868): pick a stock row with the given prompt on
   * row 0 - arrows + Enter, a selection letter, or a tap; ESC cancels (-1).
   */
  const pickStock = async (prompt: string): Promise<number> => {
    for (;;) {
      paint(prompt);
      const ev = await readStoreInput(term);
      if (ev.type === "tap") {
        const gm = geom();
        const r = ev.row - gm.listTop;
        if (r >= 0 && r < gm.listRows) {
          const i = top + r;
          if (i < displayStock.length) return i;
        }
        if (ev.row === geom().auY || ev.row === geom().helpPromptY) return -1;
        continue;
      }
      const k = ev.key;
      if (k === "Escape") return -1;
      if (k === "Enter") return displayStock.length ? cursor : -1;
      const sel = selections.indexOf(k);
      if (sel >= 0) {
        const i = top + sel;
        if (i < displayStock.length) return i;
        continue;
      }
      if (moveCursor(k)) continue;
    }
  };

  /**
   * store_purchase (ui-store.c L595): work out the amount (single item, or the
   * max the player can afford and carry), prompt "Buy how many?" when it is more
   * than one, confirm the price, then commit through game.buy.
   */
  const purchase = async (i: number, single: boolean): Promise<void> => {
    const obj = displayStock[i];
    if (!obj) return;
    const player = game.state.actor.player;
    let amt = 1;
    if (single) {
      if (!isHome && player.au < game.price(store, obj, false, 1)) {
        storeSay("You do not have enough gold for this item.");
        return;
      }
    } else if (isHome) {
      amt = obj.number;
    } else {
      const priceOne = game.price(store, obj, false, 1);
      if (player.au < priceOne) {
        storeSay("You do not have enough gold for this item.");
        return;
      }
      amt = priceOne === 0 ? obj.number : Math.trunc(player.au / priceOne);
      if (amt > obj.number) amt = obj.number;
      // Double check for wands/staves: one more may still be affordable.
      if (player.au >= game.price(store, obj, false, amt + 1) && amt < obj.number) amt++;
    }
    if (!single) {
      amt = Math.min(amt, invenCarryNum(game.state.gear, obj, constants));
      if (amt <= 0) {
        storeSay("You cannot carry that many items.");
        return;
      }
      // find_inven owned count; suppressed for an unaware flavour outside the
      // Home so a purchase does not leak the flavour's identity (ui-store.c L667).
      const aware = game.flavor ? game.flavor.isAware(obj.kind) : true;
      const owned = !aware && !isHome ? 0 : findInven(game, obj);
      const have = owned ? ` (you have ${owned})` : "";
      const q = await getQuantity(
        term,
        `${isHome ? "Take" : "Buy"} how many${have}? (max ${amt}) `,
        amt,
      );
      if (q <= 0) return;
      amt = q;
    }
    // Confirm the purchase (real stores only; the Home just retrieves).
    if (!isHome) {
      const copy = objectCopyAmt(obj, amt);
      const oName = describeObject(game.state, copy, ODESC.PREFIX | ODESC.FULL | ODESC.STORE);
      const price = game.price(store, copy, false, amt);
      const canUse = objCanUse(game, obj);
      const ok = await storeConfirm(
        term,
        `Buy ${oName}?${canUse ? "" : " (Can't use!)"} [ESC, any other key to accept]`,
        price,
      );
      if (!ok) return;
    }
    const result = game.buy(store, obj, amt);
    if (!result.ok) {
      const why: Record<string, string> = {
        "not-in-stock": "That item is no longer in stock.",
        "no-room": "You cannot carry any more.",
        "cannot-afford": "You do not have enough gold.",
      };
      storeSay(why[result.failure ?? ""] ?? "The purchase failed.");
      return;
    }
    const bought = result.bought
      ? describeObject(game.state, result.bought, ODESC.PREFIX | ODESC.FULL)
      : "the item";
    storeSay(`You bought ${bought} for ${result.price} gold.`);
    refreshStock();
  };

  /**
   * store_sell (ui-store.c L484): pick an item from the pack (get_item), a
   * quantity, confirm the sale price, then commit through game.sell. The Home
   * stashes without a price or confirmation.
   */
  const sellFlow = async (): Promise<void> => {
    /* store_sell get_item tester (ui-store.c L512, store_will_buy_tester): a
     * real shop only lists items it would actually buy; the Home accepts
     * anything (game.willBuy returns true for it). Without this the picker
     * showed unsellable items that were only refused after selection. Pack-only
     * source is the same faithful subset noted at findInven (no equip/quiver/
     * floor picker in the store yet). */
    const { items, handles } = packMenu(game.state, (obj) => game.willBuy(store, obj));
    if (items.length === 0) {
      // store_sell reject (ui-store.c L499), shared by shops and the Home.
      storeSay("You have nothing that I want. ");
      return;
    }
    // store_sell prompt (ui-store.c L500/L509): Home drops, no_selling gives.
    const sellPrompt = isHome ? "Drop which item? " : noSelling ? "Give which item? " : "Sell which item? ";
    const idx = await selectFromMenu(term, sellPrompt, items, "[ a-z to sell, ESC to cancel ]");
    if (idx === null) return;
    const handle = handles[idx];
    if (handle === undefined) return;
    const obj = game.state.gear.store.get(handle);
    if (!obj) return;
    const amt = await getQuantity(term, null, obj.number);
    if (amt <= 0) return;
    const name = objectName(game.state, obj);
    if (!isHome) {
      const copy = objectCopyAmt(obj, amt);
      const oName = describeObject(game.state, copy, ODESC.PREFIX | ODESC.FULL);
      const price = game.price(store, copy, true, amt);
      const ok = await storeConfirm(
        term,
        `${noSelling ? "Give" : "Sell"} ${oName}? [ESC, any other key to accept]`,
        noSelling ? undefined : price,
      );
      if (!ok) return;
    }
    const result = game.sell(store, handle, amt);
    if (!result.ok) {
      const why: Record<string, string> = {
        "no-item": "You do not have that item.",
        stuck: "You cannot remove that - it is stuck to you.",
        refused: "The shopkeeper does not want that.",
        "no-room": isHome ? "Your home is full." : "I have not the room in my store to keep it.",
      };
      storeSay(why[result.failure ?? ""] ?? "The sale failed.");
      return;
    }
    if (isHome) storeSay(`You drop ${name}.`);
    // do_cmd_sell (store.c L1966-1969): under birth_no_selling the shop pays
    // nothing and only identifies the item, so it reports "You had ..." rather
    // than a zero-gold sale.
    else if (noSelling) storeSay(`You had ${name}.`);
    else storeSay(`You sold ${name} for ${result.price} gold.`);
    refreshStock();
  };

  /**
   * 'I' -> textui_obj_examine (ui-store.c L843): inspect an item from the
   * player's OWN pack (not the store stock), showing its object_info screen.
   * Distinct from 'l'/'x' (store_examine), which inspects an item on sale.
   * Pack-only, the same faithful subset as the sell picker (no equip/quiver
   * picker in the store yet, gap noted at findInven).
   */
  const inspectInven = async (): Promise<void> => {
    const { items, handles } = packMenu(game.state);
    if (items.length === 0) {
      storeSay("You have nothing to inspect. ");
      return;
    }
    const idx = await selectFromMenu(term, "Examine which item? ", items, "[ a-z to inspect, ESC to cancel ]");
    if (idx === null) return;
    const handle = handles[idx];
    if (handle === undefined) return;
    const obj = game.state.gear.store.get(handle);
    if (obj) await deps.examine(obj);
  };

  /**
   * context_menu_store_item (ui-store.c L964): the popup for a selected stock
   * row - Examine, Buy/Take, and (for a stack) Buy one/Take one - drawn over
   * the store, prompted "(Enter to select, ESC) Command for <name>:".
   */
  const itemContext = async (i: number): Promise<void> => {
    const obj = displayStock[i];
    if (!obj) return;
    const desc = ODESC.PREFIX | ODESC.FULL | (isHome ? 0 : ODESC.STORE);
    const name = describeObject(game.state, obj, desc);
    const entries: { label: string; key: string; act: () => Promise<void> }[] = [
      {
        label: "Examine",
        key: deps.rogueLike ? "x" : "l",
        act: () => deps.examine(obj),
      },
      { label: isHome ? "Take" : "Buy", key: "p", act: () => purchase(i, false) },
    ];
    if (obj.number > 1) {
      entries.push({ label: isHome ? "Take one" : "Buy one", key: "o", act: () => purchase(i, true) });
    }
    let mc = 0;
    for (;;) {
      paint();
      const { cols } = term.size();
      term.print(0, 0, `(Enter to select, ESC) Command for ${name}:`.slice(0, cols - 1), UI_TEXT);
      for (let e = 0; e < entries.length; e++) {
        const ent = entries[e]!;
        term.print(2, 2 + e, `${ent.key}) ${ent.label}`, e === mc ? UI_CURSOR : UI_TEXT);
      }
      const ev = await readStoreInput(term);
      if (ev.type === "tap") {
        const r = ev.row - 2;
        if (r >= 0 && r < entries.length) {
          await entries[r]!.act();
          return;
        }
        return;
      }
      const k = ev.key;
      if (k === "Escape") return;
      if (k === "Enter") {
        await entries[mc]!.act();
        return;
      }
      if (k === "ArrowUp" || k === "8") { mc = (mc + entries.length - 1) % entries.length; continue; }
      if (k === "ArrowDown" || k === "2") { mc = (mc + 1) % entries.length; continue; }
      const hit = entries.findIndex((e) => e.key === k);
      if (hit >= 0) {
        await entries[hit]!.act();
        return;
      }
    }
  };

  // Main store input loop (store_menu_handle, ui-store.c L1032).
  for (;;) {
    paint();
    const ev = await readStoreInput(term);
    // prt("", 0, 0) at the head of the store's command handlers: the last
    // transaction message stays up until the next command is issued.
    statusMsg = "";
    if (ev.type === "tap") {
      const gm = geom();
      const r = ev.row - gm.listTop;
      if (r >= 0 && r < gm.listRows) {
        const i = top + r;
        if (i < displayStock.length) {
          cursor = i;
          await itemContext(i);
        }
      }
      continue;
    }
    const k = ev.key;
    if (k === "Escape") return;
    if (k === "?") { helpShown = !helpShown; continue; }
    if (k === "s" || k === "d") { await sellFlow(); continue; }
    if (k === "I") { await inspectInven(); continue; }
    if (k === "p" || k === "g") {
      const idx = await pickStock(
        isHome
          ? "Get which item? (Esc to cancel, Enter to select)"
          : "Purchase which item? (ESC to cancel, Enter to select)",
      );
      if (idx >= 0) await purchase(idx, false);
      continue;
    }
    if (k === "l" || k === "x") {
      const idx = await pickStock("Examine which item? (ESC to cancel, Enter to select)");
      if (idx >= 0 && displayStock[idx]) await deps.examine(displayStock[idx]!);
      continue;
    }
    if (k === "Enter") {
      if (displayStock.length) await itemContext(cursor);
      continue;
    }
    const sel = selections.indexOf(k);
    if (sel >= 0) {
      const i = top + sel;
      if (i < displayStock.length) { cursor = i; await itemContext(i); }
      continue;
    }
    moveCursor(k);
  }
}
