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

import { inputEvents } from "./input-door";
import {
  t,
  describeObject,
  ODESC,
  gearGet,
  invenCarryNum,
  packIsFull,
  objectCopyAmt,
  tvalIsWearable,
  tvalIsAmmo,
  tvalIsLight,
  tvalIsChest,
  tvalIsBook,
  tvalCanHaveCharges,
  FEAT,
  earlierObject,
  storeBuyGuard,
  storeRetrieveGuard,
  storeSellGuard,
  storeStashGuard,
} from "@rpgm-tools/neo-angband-core";
import type { GameObject, StartedGame, Store, EarlierObjectOpts } from "@rpgm-tools/neo-angband-core";
import { setActiveCellTap, type GridPointerInput, type GridSurface } from "./term";
import { getQuantity, itemSelect, screenRegionSpec } from "./overlay";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import { objectColor, objectName, packMenu, quiverMenu } from "./screens";
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

/* ------------------------------------------------------------------ */
/* Shopkeeper flavor (comment arrays + greeting)                       */
/* ------------------------------------------------------------------ */

/**
 * comment_welcome (ui-store.c L60-72): the greeting a shopkeeper gives on entry,
 * indexed by the player's level tier. First %s is the owner's short name, the
 * second (when present) the character identifier. Index 0 ("") is unreachable
 * here because prt_welcome gates on player->lev > 5 (tier >= 1).
 */
const COMMENT_WELCOME = [
  "",
  "%s nods to you.",
  "%s says hello.",
  '%s: "See anything you like, adventurer?"',
  '%s: "How may I help you, %s?"',
  '%s: "Welcome back, %s."',
  '%s: "A pleasure to see you again, %s."',
  '%s: "How may I be of assistance, good %s?"',
  '%s: "You do honour to my humble store, noble %s."',
  '%s: "I and my family are entirely at your service, %s."',
];

/**
 * The translated form of COMMENT_WELCOME's rows, keyed by the same index. The
 * array above is kept for its LENGTH - `Math.min(i, COMMENT_WELCOME.length - 1)`
 * is an RNG-parity-relevant bound, not just a display fact - while the actual
 * text a player reads comes from here so it can route through the translator.
 * Index 0 is unreachable (see the comment_welcome doc comment above).
 */
function commentWelcome(i: number, owner: string, ident: string): string {
  switch (i) {
    case 1:
      return t("shop.welcome.nod", "{owner} nods to you.", { owner });
    case 2:
      return t("shop.welcome.hello", "{owner} says hello.", { owner });
    case 3:
      return t(
        "shop.welcome.anythingYouLike",
        '{owner}: "See anything you like, adventurer?"',
        { owner },
      );
    case 4:
      return t("shop.welcome.howMayIHelp", '{owner}: "How may I help you, {ident}?"', {
        owner,
        ident,
      });
    case 5:
      return t("shop.welcome.welcomeBack", '{owner}: "Welcome back, {ident}."', {
        owner,
        ident,
      });
    case 6:
      return t(
        "shop.welcome.pleasure",
        '{owner}: "A pleasure to see you again, {ident}."',
        { owner, ident },
      );
    case 7:
      return t(
        "shop.welcome.assistance",
        '{owner}: "How may I be of assistance, good {ident}?"',
        { owner, ident },
      );
    case 8:
      return t(
        "shop.welcome.honour",
        '{owner}: "You do honour to my humble store, noble {ident}."',
        { owner, ident },
      );
    case 9:
      return t(
        "shop.welcome.service",
        '{owner}: "I and my family are entirely at your service, {ident}."',
        { owner, ident },
      );
    default:
      return "";
  }
}

/**
 * comment_hint (ui-store.c L74-80): only one active format string; each has
 * exactly one %s for the tip text (random_hint).
 */
const COMMENT_HINT = ['"%s"'];

/**
 * random_hint (ui-store.c L121-129): reservoir sample over the global hints
 * list. Starts at the first tip, then for each subsequent tip at index n
 * (1-based count 2, 3, ...) draws one_in_(n) to replace the choice. With N
 * tips this consumes N-1 one_in_ draws on the main stream.
 */
function randomHint(
  rng: StartedGame["state"]["rng"],
  hints: readonly string[],
): string {
  let r = hints[0] ?? "";
  for (let i = 1, n = 2; i < hints.length; i++, n++) {
    if (rng.oneIn(n)) r = hints[i] ?? r;
  }
  return r;
}

/**
 * prt_welcome (ui-store.c L139-177): a real shop's entry greeting.
 *
 * Draw order (Decision 6.2 / ui-store.c:145-172):
 *  1. one_in_(2) -> silent return
 *  2. if hints non-empty: one_in_(3)
 *     - true: randint0(comment_hint) + random_hint reservoir draws, emit tip
 *     - false and lev > 5: comment_welcome path
 *  3. else if lev > 5: comment_welcome path
 *
 * All draws consume the main game RNG.
 */
function prtWelcome(
  store: Store,
  player: StartedGame["state"]["actor"]["player"],
  rng: StartedGame["state"]["rng"],
  hints: readonly string[],
): string | null {
  if (rng.oneIn(2)) return null;

  const shortName = store.owner.name.split(" ")[0] ?? store.owner.name;

  if (hints.length > 0 && rng.oneIn(3)) {
    // COMMENT_HINT has exactly one entry; the draw below still consumes the
    // RNG exactly as upstream's randint0(N_ELEMENTS(comment_hint)) does.
    void rng.randint0(COMMENT_HINT.length);
    return t("shop.hint.format", '"{tip}"', { tip: randomHint(rng, hints) });
  }

  if (player.lev <= 5) return null;

  const defaultTitle = t("shop.welcome.defaultTitle", "valued customer");
  let i = Math.floor((player.lev - 1) / 5);
  i = Math.min(i, COMMENT_WELCOME.length - 1);
  let ident: string;
  if (i % 2 && rng.randint0(2)) {
    ident = player.cls.titles[Math.floor((player.lev - 1) / 5)] ?? defaultTitle;
  } else if (rng.randint0(2)) {
    ident = player.fullName || defaultTitle;
  } else {
    ident = defaultTitle;
  }
  /* commentWelcome(i, short_name, player_name): first slot is the owner,
   * second (if any) is the identifier - see the doc comment above it. */
  return commentWelcome(i, shortName, ident);
}

/** Callbacks the store screen needs from the shell (kept out of core, decision 21). */
/**
 * The result of the store_sell item pick (deps.sellPick): a chosen gear object
 * (pack / equipped / quiver, addressed by handle), a chosen floor-pile object
 * (addressed by the live object, sold via game.sellFloor), or the two no-sale
 * outcomes - "empty" (no qualifying source, show the reject) and "cancel" (ESC).
 */
export type SellPick =
  | { kind: "handle"; handle: number }
  | { kind: "floor"; obj: GameObject }
  | { kind: "empty" }
  | { kind: "cancel" };

export interface StoreScreenDeps {
  /** f_info[store->feat].name, e.g. "General Store" (store_display_frame). */
  featureName: string;
  /**
   * store_at(cave, player->grid), re-resolved per transaction. Each of
   * do_cmd_buy / _retrieve / _sell / _stash calls it afresh (store.c:1665,
   * :1795, :1872, :2014) and refuses when the player is not in a store of the
   * right kind - so the screen must not trust the Store it was opened with.
   * Absent, the guards read the opened store (test harnesses).
   */
  storeAt?: () => Store | null;
  /** rogue_like_commands: swaps the selection string and the 'l'/'x' help key. */
  rogueLike: boolean;
  /** store_examine (ui-store.c L749): show the object_info screen for `obj`. */
  examine: (obj: GameObject) => Promise<void>;
  /**
   * store_sell get_item (ui-store.c L487-518): the faithful multi-source item
   * picker over USE_INVEN|USE_EQUIP|USE_QUIVER|USE_FLOOR, filtered by `tester`
   * (store_will_buy_tester for a shop; accept-anything for the Home). The quiver
   * rides the pack in this gear model, so USE_QUIVER folds into the inventory
   * pass. Returns the chosen source, or "empty"/"cancel".
   */
  sellPick: (prompt: string, tester: (obj: GameObject) => boolean) => Promise<SellPick>;
  /**
   * store_process_command_key item-management commands (ui-store.c:823-863):
   * the store loop re-enables a subset of the dungeon inventory verbs. wield/
   * takeOff run through the engine WITHOUT passing a world turn (cmdq_pop uses
   * CTX_STORE), returning the message to show on row 0 (or null when
   * cancelled). inventory/equipment/quiver are display-only. Optional so the
   * worldless harness/tests can omit them.
   */
  manageItem?: {
    /** 'w' -> CMD_WIELD (ui-store.c:844). */
    wield: () => Promise<string | null>;
    /** 't'/'T' -> CMD_TAKEOFF (ui-store.c:833). */
    takeOff: () => Promise<string | null>;
    /** 'i' -> do_cmd_inven (ui-store.c:849). */
    inventory: () => Promise<void>;
    /** 'e' -> do_cmd_equip (ui-store.c:848). */
    equipment: () => Promise<void>;
    /** '|' -> do_cmd_quiver (ui-store.c:850). */
    quiver: () => Promise<void>;
  };
}

/** One keyboard key or one grid tap from the store's own input listener. */
type StoreInput = { type: "key"; key: string } | { type: "tap"; row: number; col: number };

/**
 * Read a single key OR a tap while the store owns the terminal (the store menu's
 * inkey / mouse read). Lone modifier keydowns are ignored so a Shift chord does
 * not resolve as a bare key. Registers and tears down its own window-keydown and
 * onCellTap handlers each call, so no two readers are ever live at once.
 */
function readStoreInput(term: GridSurface & GridPointerInput): Promise<StoreInput> {
  return new Promise<StoreInput>((resolve) => {
    const finish = (value: StoreInput): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
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
    inputEvents.addEventListener("keydown", onKey, true);
    setActiveCellTap(term, (cell) => finish({ type: "tap", row: cell.row, col: cell.col }));
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
  term: GridSurface & GridPointerInput,
  prompt: string,
  price?: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { cols } = term.size();
    /* prt, not print: upstream's prt erases to end of line first (ui-output.c), and
     * both of these are drawn OVER the store frame - row 0 over the message line,
     * row 1 over the shopkeeper line. Without the erase the shopkeeper's name ran
     * on straight after the price ("Price: 450the Great (Gnome)"). */
    if (price !== undefined) {
      term.prt(0, 1, t("shop.priceLabel", "Price: {price}", { price }).slice(0, cols - 1), UI_TEXT);
    }
    term.prt(0, 0, prompt.slice(0, cols - 1), UI_TEXT);
    const finish = (value: boolean): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
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
    inputEvents.addEventListener("keydown", onKey, true);
  });
}

/**
 * Greedy word-wrap a stream of CSS-coloured runs to `width` columns, preserving
 * each run's colour across wrap boundaries (the store help legend, text_out with
 * COLOUR_L_GREEN command keys). Breaks on spaces; a word longer than the width
 * is hard-split. Returns one array of runs per output line.
 *
 * A newline ENDS a line rather than travelling into one. The terminal has no
 * glyph for U+000A, so a "\n" carried through as an ordinary character painted
 * as a solid block - visible in the mod manager, whose descriptions are written
 * by third-party mod authors and do contain paragraph breaks. "\n\n" therefore
 * yields an empty line, which is what a paragraph break should look like here.
 * `\r\n` and a lone `\r` are the same break; the store legend has no newlines at
 * all, so for that caller this is a no-op.
 */
export function wrapCssRuns(
  runs: readonly { text: string; color: string }[],
  width: number,
): { text: string; color: string }[][] {
  const w = Math.max(1, width);
  type C = { ch: string; color: string };
  const chars: C[] = [];
  for (const run of runs) {
    // Normalise line endings first so a CRLF is one break, not a break plus a
    // stray \r that would paint as its own block.
    for (const ch of run.text.replace(/\r\n?/g, "\n")) chars.push({ ch, color: run.color });
  }

  const group = (slice: C[]): C[] => {
    const line: C[] = [];
    for (const c of slice) {
      const last = line[line.length - 1];
      if (last && last.color === c.color) last.ch += c.ch;
      else line.push({ ch: c.ch, color: c.color });
    }
    return line;
  };

  /* Wrap one newline-free paragraph, appending its lines to `out`. An empty
   * paragraph contributes one empty line - that is the blank row between two
   * paragraphs, and it is why this is not simply skipped. */
  const out: { text: string; color: string }[][] = [];
  const wrapParagraph = (chars: readonly C[]): void => {
    if (chars.length === 0) {
      out.push([]);
      return;
    }
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
  };

  let from = 0;
  for (let i = 0; i <= chars.length; i++) {
    if (i === chars.length || chars[i]!.ch === "\n") {
      wrapParagraph(chars.slice(from, i));
      from = i + 1;
    }
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
  host: GridSurface & GridPointerInput,
  game: StartedGame,
  store: Store,
  say: (text: string) => void,
  constants: Parameters<typeof invenCarryNum>[2],
  deps: StoreScreenDeps,
): Promise<void> {
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
  try {
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

  /* prt_welcome (ui-store.c L1292-1294 in use_store): a real shop greets the
   * character once on entry; the Home does not. Shown on the message line, where
   * it persists until the first command clears it (statusMsg). Draws from
   * state.rng (ui-store.c L145-172), including the hint branch when the pack
   * bound a non-empty hints list. */
  if (!isHome) {
    const welcome = prtWelcome(
      store,
      game.state.actor.player,
      game.state.rng,
      game.booted.registries.hints,
    );
    if (welcome) storeSay(welcome);
  }

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

  /**
   * store_display_help (ui-store.c L376): the coloured command legend.
   *
   * The GREEN runs below are command-key letters (x/l, p, g, d, s, I, ESC) -
   * upstream's own fixed keybindings, not prose, so they stay as literal key
   * names rather than routing through the translator. The surrounding WHITE
   * runs are the descriptive text around them and are translated.
   */
  const helpRuns = (): { text: string; color: string }[] => {
    const g = UI_GOOD;
    const w = UI_TEXT;
    const runs: { text: string; color: string }[] = [];
    runs.push({ text: deps.rogueLike ? "x" : "l", color: g });
    runs.push({ text: t("shop.help.examinesAnd", " examines and "), color: w });
    runs.push({ text: "p", color: g });
    runs.push({ text: t("shop.help.or", " (or "), color: w });
    runs.push({ text: "g", color: g });
    runs.push({ text: ")", color: w });
    runs.push({
      text: isHome
        ? t("shop.help.picksUp", " picks up")
        : t("shop.help.purchases", " purchases"),
      color: w,
    });
    runs.push({ text: t("shop.help.anItem", " an item. "), color: w });
    if (noSelling && !isHome) {
      runs.push({ text: "d", color: g });
      runs.push({ text: t("shop.help.or", " (or "), color: w });
      runs.push({ text: "s", color: g });
      runs.push({ text: ")", color: w });
      runs.push({
        text: t(
          "shop.help.givesForId",
          " gives an item to the store in return for its identification. Some wands and staves will also be recharged. ",
        ),
        color: w,
      });
    } else {
      runs.push({ text: "d", color: g });
      runs.push({ text: t("shop.help.or", " (or "), color: w });
      runs.push({ text: "s", color: g });
      runs.push({ text: ")", color: w });
      runs.push({
        text: isHome ? t("shop.help.drops", " drops") : t("shop.help.sells", " sells"),
        color: w,
      });
      runs.push({ text: t("shop.help.fromInventory", " an item from your inventory. "), color: w });
    }
    runs.push({ text: "I", color: g });
    runs.push({
      text: t("shop.help.inspects", " inspects an item from your inventory. "),
      color: w,
    });
    runs.push({ text: "ESC", color: g });
    runs.push({ text: t("shop.help.exits", " exits the building."), color: w });
    return runs;
  };

  /** Repaint the whole store, optionally with an inline prompt on row 0. */
  const paint = (prompt?: string): void => {
    const { cols } = term.size();
    const gm = geom();
    term.clear();

    // Row 1: owner / store name (store_display_frame).
    if (isHome) {
      term.print(1, 1, t("shop.yourHome", "Your Home"), UI_TEXT);
    } else {
      term.print(1, 1, store.owner.name.slice(0, gm.ownerX - 1), UI_TEXT);
      const buf = `${deps.featureName} (${store.owner.maxCost})`;
      term.print(Math.max(0, gm.ownerX - buf.length), 1, buf, UI_TEXT);
    }

    // Row 3: column headers.
    term.print(
      1,
      3,
      isHome
        ? t("shop.column.homeInventory", "Home Inventory")
        : t("shop.column.storeInventory", "Store Inventory"),
      UI_TEXT,
    );
    term.print(gm.weightX + 2, 3, t("shop.column.weight", "Weight"), UI_TEXT);
    if (!isHome) term.print(gm.priceX + 4, 3, t("shop.column.price", "Price"), UI_TEXT);

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
      term.print(1, gm.helpPromptY, t("shop.pressHelp", "Press '?' for help."), UI_TEXT);
    }
    term.print(
      gm.auX,
      gm.auY,
      t("shop.goldRemaining", "Gold Remaining: {au}", {
        au: String(game.state.actor.player.au).padStart(9),
      }),
      UI_TEXT,
    );

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
        storeSay(t("shop.notEnoughGold", "You do not have enough gold for this item."));
        return;
      }
    } else if (isHome) {
      amt = obj.number;
    } else {
      const priceOne = game.price(store, obj, false, 1);
      if (player.au < priceOne) {
        storeSay(t("shop.notEnoughGold", "You do not have enough gold for this item."));
        return;
      }
      amt = priceOne === 0 ? obj.number : Math.trunc(player.au / priceOne);
      if (amt > obj.number) amt = obj.number;
      // Double check for wands/staves: one more may still be affordable.
      if (player.au >= game.price(store, obj, false, amt + 1) && amt < obj.number) amt++;
    }
    if (!single) {
      amt = Math.min(amt, invenCarryNum(game.state.gear, obj, constants));
      const aware = game.flavor ? game.flavor.isAware(obj.kind) : true;
      // ui-store.c L658-662: no room refuses the purchase - and so does a FULL
      // pack when the flavour is not yet aware and this is not the Home, even
      // though invenCarryNum would happily merge it into an existing slot.
      // Merging is exactly the leak: succeeding where a full pack should refuse
      // tells the player the unknown potion is one they already own. Taking from
      // the Home cannot leak, because home stock shows no true flavour.
      if (
        amt <= 0 ||
        (!aware && !isHome && packIsFull(game.state.gear, constants))
      ) {
        storeSay(t("shop.cannotCarry", "You cannot carry that many items."));
        return;
      }
      // find_inven owned count; suppressed for an unaware flavour outside the
      // Home for the same reason (ui-store.c L667).
      const owned = !aware && !isHome ? 0 : findInven(game, obj);
      const have = owned
        ? t("shop.quantity.haveCount", " (you have {owned})", { owned })
        : "";
      const verb = isHome ? t("shop.verb.take", "Take") : t("shop.verb.buy", "Buy");
      const q = await getQuantity(
        term,
        t("shop.quantity.prompt", "{verb} how many{have}? (max {amt}) ", { verb, have, amt }),
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
      const cantUse = canUse ? "" : t("shop.buy.cantUse", " (Can't use!)");
      const ok = await storeConfirm(
        term,
        t("shop.buy.confirm", "Buy {name}?{cantUse} [ESC, any other key to accept]", {
          name: oName,
          cantUse,
        }),
        price,
      );
      if (!ok) return;
    }
    // do_cmd_buy / do_cmd_retrieve's store-presence guard, re-resolving
    // store_at from the grid as upstream does (store.c:1665-1670 / :1793-1800).
    const here = deps.storeAt?.() ?? store;
    const entry = isHome ? storeRetrieveGuard(here) : storeBuyGuard(here);
    if (entry) {
      storeSay(entry);
      return;
    }
    const result = game.buy(store, obj, amt);
    if (!result.ok) {
      // do_cmd_buy / do_cmd_retrieve's own refusals (store.c:1671, :1690,
      // :1707 and :1801, :1815). These were paraphrased here - "That item is no
      // longer in stock." etc - which is a divergence under exact parity, and
      // the Home has its OWN wording for the missing-item case.
      const why: Record<string, string> = {
        "not-in-stock": isHome
          ? t(
              "shop.buy.notInHome",
              "You cannot retrieve that item because it's not in the home.",
            )
          : t(
              "shop.buy.notInStock",
              "You cannot buy that item because it's not in the store.",
            ),
        "no-room": t("shop.cannotCarry", "You cannot carry that many items."),
        "cannot-afford": t("shop.buy.cannotAfford", "You cannot afford that purchase."),
      };
      storeSay(why[result.failure ?? ""] ?? t("shop.buy.failed", "The purchase failed."));
      return;
    }
    const bought = result.bought
      ? describeObject(game.state, result.bought, ODESC.PREFIX | ODESC.FULL)
      : t("shop.theItem", "the item");
    /* comment_accept was drawn inside storeBuy (do_cmd_buy L1717) before any
     * empty-store shuffle; print it first so the "You bought ..." line remains
     * the status shown on row 0. Home retrieves via do_cmd_retrieve (no comment). */
    if (result.acceptComment) say(result.acceptComment);
    /* do_cmd_retrieve is free and silent about gold; real shops report the sale. */
    if (isHome) storeSay(t("shop.buy.retrieved", "You have {bought}.", { bought }));
    else {
      storeSay(
        t("shop.buy.bought", "You bought {bought} for {price} gold.", {
          bought,
          price: result.price ?? 0,
        }),
      );
    }
    /* store.c:1757-1763: buying the last item empties the shop, and the
     * shopkeeper says which way it went. Printed after the sale line, as
     * upstream prints it after "You bought ...". */
    if (result.emptied === "retired") say(t("shop.shopkeeperRetires", "The shopkeeper retires."));
    else if (result.emptied === "restocked") {
      say(t("shop.shopkeeperRestocks", "The shopkeeper brings out some new stock."));
    }
    refreshStock();
  };

  /**
   * store_sell (ui-store.c L484): pick an item from the pack (get_item), a
   * quantity, confirm the sale price, then commit through game.sell. The Home
   * stashes without a price or confirmation.
   */
  const sellFlow = async (): Promise<void> => {
    /* store_sell get_item (ui-store.c L487-518): a faithful multi-source pick
     * over USE_INVEN|USE_EQUIP|USE_QUIVER|USE_FLOOR, filtered by the tester - a
     * real shop only lists items it would actually buy (store_will_buy_tester);
     * the Home accepts anything (game.willBuy returns true for it). The Quiver is
     * its own source in that pick, so ammo sells out of the quiver as upstream's
     * USE_QUIVER list does (deps.sellPick). */
    // store_sell prompt (ui-store.c L500/L509): Home drops, no_selling gives.
    const sellPrompt = isHome
      ? t("shop.sell.dropPrompt", "Drop which item? ")
      : noSelling
        ? t("shop.sell.givePrompt", "Give which item? ")
        : t("shop.sell.sellPrompt", "Sell which item? ");
    const picked = await deps.sellPick(sellPrompt, (obj) => game.willBuy(store, obj));
    if (picked.kind === "empty") {
      // store_sell reject (ui-store.c L499), shared by shops and the Home.
      storeSay(t("shop.sell.nothingWanted", "You have nothing that I want. "));
      return;
    }
    if (picked.kind === "cancel") return;
    // The chosen source: a gear object (handle) or a live floor-pile object.
    const obj = picked.kind === "handle" ? game.state.gear.store.get(picked.handle) : picked.obj;
    if (!obj) return;
    const amt = await getQuantity(term, null, obj.number);
    if (amt <= 0) return;
    const name = objectName(game.state, obj);
    if (!isHome) {
      const copy = objectCopyAmt(obj, amt);
      const oName = describeObject(game.state, copy, ODESC.PREFIX | ODESC.FULL);
      const price = game.price(store, copy, true, amt);
      // screen_save (ui-store.c:559): restore the store frame behind the
      // "Price:" line and confirm prompt, so the sale price is shown clearly
      // over the shop rather than over the (now-closed) item-picker backdrop.
      paint();
      const sellVerb = noSelling ? t("shop.verb.give", "Give") : t("shop.verb.sell", "Sell");
      const ok = await storeConfirm(
        term,
        t("shop.sell.confirm", "{verb} {name}? [ESC, any other key to accept]", {
          verb: sellVerb,
          name: oName,
        }),
        noSelling ? undefined : price,
      );
      if (!ok) return;
    }
    /* do_cmd_sell dispatch: gear handles (pack/equip/quiver) via game.sell, a
     * floor-pile object via game.sellFloor (floor_object_for_use detach). */
    // do_cmd_sell / do_cmd_stash's store-presence guard (store.c:1902-1905 /
    // :2031-2034), re-resolved from the grid. Upstream checks the stuck item
    // FIRST for sell, which game.sell reports as the "stuck" failure below.
    const hereSell = deps.storeAt?.() ?? store;
    const entrySell = isHome
      ? storeStashGuard(hereSell)
      : storeSellGuard(hereSell);
    if (entrySell) {
      storeSay(entrySell);
      return;
    }
    const result =
      picked.kind === "handle"
        ? game.sell(store, picked.handle, amt)
        : game.sellFloor(store, picked.obj, amt);
    if (!result.ok) {
      // do_cmd_sell / do_cmd_stash's own refusals (store.c:1890, :1903, :1913
      // and :2049). "no-item" has no upstream counterpart: cmd_get_arg_item
      // fails there and returns silently, so the port keeps its own line for a
      // seam the C cannot reach.
      const why: Record<string, string> = {
        "no-item": t("shop.sell.noItem", "You do not have that item."),
        stuck: t("shop.sell.stuck", "Hmmm, it seems to be stuck."),
        refused: t("shop.sell.refused", "I do not wish to purchase this item."),
        "no-room": isHome
          ? t("shop.sell.homeFull", "Your home is full.")
          : t("shop.sell.storeFull", "I have not the room in my store to keep it."),
      };
      storeSay(why[result.failure ?? ""] ?? t("shop.sell.failed", "The sale failed."));
      return;
    }
    if (isHome) storeSay(t("shop.sell.dropped", "You drop {name}.", { name }));
    // do_cmd_sell (store.c L1966-1969): under birth_no_selling the shop pays
    // nothing and only identifies the item, so it reports "You had ..." rather
    // than a zero-gold sale.
    else if (noSelling) storeSay(t("shop.sell.had", "You had {name}.", { name }));
    else {
      storeSay(
        t("shop.sell.sold", "You sold {name} for {price} gold.", { name, price: result.price ?? 0 }),
      );
      /* purchase_analyze (do_cmd_sell L1972): core already drew ONE_OF from
       * state.rng; print the selected reaction comment after the sale line. */
      if (result.reactionComment) storeSay(result.reactionComment);
    }
    refreshStock();
  };

  /**
   * 'I' -> textui_obj_examine (ui-store.c L843): inspect an item from the
   * player's OWN gear (not the store stock), showing its object_info screen.
   * Distinct from 'l'/'x' (store_examine), which inspects an item on sale.
   * Inven + Quiver, since the quiver is a list of its own (upstream's get_item
   * mode here is USE_EQUIP|USE_INVEN|USE_QUIVER|USE_FLOOR; equip and floor
   * remain the gap noted at findInven).
   */
  const inspectInven = async (): Promise<void> => {
    const inven = packMenu(game.state);
    const quiver = quiverMenu(game.state);
    const sources = [
      { label: t("shop.inspect.inven", "Inven"), items: inven.items },
      { label: t("shop.inspect.quiver", "Quiver"), items: quiver.items },
    ].filter((s) => s.items.length > 0);
    const handleLists = [inven.handles, quiver.handles].filter((h) => h.length > 0);
    if (sources.length === 0) {
      storeSay(t("shop.inspect.nothing", "You have nothing to inspect. "));
      return;
    }
    const chosen = await itemSelect(
      term,
      t("shop.inspect.prompt", "Examine which item?"),
      sources,
    );
    if (chosen === null) return;
    const handle = handleLists[chosen.source]?.[chosen.index];
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
        label: t("shop.context.examine", "Examine"),
        key: deps.rogueLike ? "x" : "l",
        act: () => deps.examine(obj),
      },
      {
        label: isHome ? t("shop.verb.take", "Take") : t("shop.verb.buy", "Buy"),
        key: "p",
        act: () => purchase(i, false),
      },
    ];
    if (obj.number > 1) {
      entries.push({
        label: isHome
          ? t("shop.context.takeOne", "Take one")
          : t("shop.context.buyOne", "Buy one"),
        key: "o",
        act: () => purchase(i, true),
      });
    }
    let mc = 0;
    for (;;) {
      paint();
      const { cols } = term.size();
      // prt (ui-output.c:385-391): paint() has just put statusMsg on row 0, so a
      // longer status would show its tail past this prompt.
      term.prt(
        0,
        0,
        t("shop.context.prompt", "(Enter to select, ESC) Command for {name}:", { name }).slice(
          0,
          cols - 1,
        ),
        UI_TEXT,
      );
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
          ? t("shop.pick.get", "Get which item? (Esc to cancel, Enter to select)")
          : t("shop.pick.purchase", "Purchase which item? (ESC to cancel, Enter to select)"),
      );
      if (idx >= 0) await purchase(idx, false);
      continue;
    }
    if (k === "l" || k === "x") {
      const idx = await pickStock(
        t("shop.pick.examine", "Examine which item? (ESC to cancel, Enter to select)"),
      );
      if (idx >= 0 && displayStock[idx]) await deps.examine(displayStock[idx]!);
      continue;
    }
    if (k === "Enter") {
      if (displayStock.length) await itemContext(cursor);
      continue;
    }
    // store_process_command_key (ui-store.c:823-863): item-management verbs
    // usable while shopping. None of these letters are stock-selection tags
    // (store_menu_set_selections excludes them; takeoff is the keyset's non-tag
    // key - 't' in the original keyset, 'T' in roguelike). They run without a
    // world turn and refresh the stock view (the pack changed).
    if (deps.manageItem) {
      if (k === "w") {
        const m = await deps.manageItem.wield();
        // The engine already logged the message via state.msg; only mirror it to
        // the store's row 0 (statusMsg), do not re-log through storeSay.
        if (m) statusMsg = m;
        refreshStock();
        continue;
      }
      if (k === (deps.rogueLike ? "T" : "t")) {
        const m = await deps.manageItem.takeOff();
        if (m) statusMsg = m;
        refreshStock();
        continue;
      }
      if (k === "i") { await deps.manageItem.inventory(); continue; }
      if (k === "e") { await deps.manageItem.equipment(); continue; }
      if (k === "|") { await deps.manageItem.quiver(); continue; }
    }
    const sel = selections.indexOf(k);
    if (sel >= 0) {
      const i = top + sel;
      if (i < displayStock.length) { cursor = i; await itemContext(i); }
      continue;
    }
    moveCursor(k);
  }
  } finally {
    popRegion(handle);
  }
}
