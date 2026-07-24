/**
 * Store data model, ported from struct store / struct owner / struct object_buy
 * in reference/src/store.h and the store.txt syntax (Angband 4.2.6).
 *
 * This is the DATA half of the store subsystem: the parsed store definitions
 * (owners, the always/normal stocking tables, the buy list, turnover and stock
 * bounds, and the entrance feature). The behavioural half of store.c - pricing
 * (price_item -> object_value/object_value_real), stock maintenance
 * (store_maint / mass_produce / store_create_random), buying and selling, and
 * town-level placement - lands in later increments; several of those depend on
 * object valuation (object_power, obj-power.c), which is not ported yet.
 */

import type { ObjectKind } from "../obj/types";

/* ------------------------------------------------------------------ */
/* Parsed JSON shape (packages/content/pack/store.json)                 */
/* ------------------------------------------------------------------ */

/** One `owner: purse : name` line. */
export interface StoreOwnerJson {
  purse: number;
  name: string;
}

/**
 * One `normal:`/`always:` table entry. `normal:` always names a specific sval;
 * `always:` may omit it (`always: tval` with no item name), which upstream
 * treats specially for spellbooks - it stocks every TOWN book of that tval.
 */
export interface StoreItemJson {
  tval: string;
  sval?: string;
}

/**
 * A `buy:`/`buy-flag:` entry. store.txt allows a bare tval (`buy: light`) or a
 * flag-qualified tval (`buy-flag: flag : type name`); 4.2.6's data uses only
 * the bare form, so the compiler emits plain tval strings, but the object form
 * is accepted so mods can add flag-qualified buy rules.
 */
export type StoreBuyJson = string | { tval: string; flag?: string };

/** One store record as compiled from store.txt. */
export interface StoreRecordJson {
  /** FEAT_* name of the entrance terrain (e.g. "STORE_GENERAL", "HOME"). */
  store: string;
  owner: StoreOwnerJson[];
  slots?: { min: number; max: number };
  turnover?: number;
  normal?: StoreItemJson[];
  always?: StoreItemJson[];
  buy?: StoreBuyJson[];
}

/* ------------------------------------------------------------------ */
/* Bound (runtime) shape                                                */
/* ------------------------------------------------------------------ */

/** struct owner: one candidate shopkeeper. */
export interface StoreOwner {
  /** oidx: position in the store's owner list. */
  index: number;
  name: string;
  /** max_cost: the owner's purse (largest price they will pay). */
  maxCost: number;
}

/** struct object_buy: one entry in a store's buy list. */
export interface ObjectBuy {
  /** tval the store will buy. */
  tval: number;
  /** OF_* flag required (0 = no flag, buys any item of this tval). */
  flag: number;
}

/** struct store: a fully bound store definition. */
export interface BoundStore {
  /** FEAT_* index of the entrance terrain. */
  feat: number;
  /** The FEAT_* name this store binds to (for diagnostics/lookup). */
  featName: string;
  owners: StoreOwner[];
  /** always_table: specific kinds the store always keeps in stock. */
  alwaysTable: ObjectKind[];
  /**
   * tvals from `always:` lines that named no sval (the bookseller's book
   * lines). Upstream expands each to every TOWN (non-dungeon) book of the
   * tval - see parse_always's book branch (store.c L208-231), gated on
   * object_kind_to_book(kind)->dungeon. Because that needs the class-book
   * metadata (absent at parse time), the parse keeps the tvals here and
   * bindStoreRuntime performs the expansion into the runtime store's
   * alwaysTable (townBooksOfTval). Empty for every non-bookseller store.
   */
  alwaysBookTvals: number[];
  /** normal_table: kinds the store may stock from. */
  normalTable: ObjectKind[];
  /**
   * buy list, or null when the store has no list. As upstream, null means the
   * store buys anything (store_will_buy's `if (!store->buy) return true`); the
   * home (FEAT_HOME) accepts anything regardless of this field.
   */
  buy: ObjectBuy[] | null;
  /** How many items the store turns over per maintenance. */
  turnover: number;
  /** normal_stock_min: fewest 'normal' slots to keep stocked. */
  normalStockMin: number;
  /** normal_stock_max: most 'normal' slots to keep stocked. */
  normalStockMax: number;
}
