/**
 * Bind compiled store records (packages/content/pack/store.json) into the
 * runtime store model, ported from the parsing side of reference/src/store.c
 * (init_parse_stores / store_parser_new / store_owner_parser_new) and
 * store_at (Angband 4.2.6).
 *
 * This is the data-binding slice of the store subsystem. It resolves each
 * store's entrance feature, owners, always/normal stocking tables (tval + sval
 * names -> object kinds), and buy list. The behavioural half of store.c
 * (pricing, stock maintenance, buying/selling, town placement) is deferred to
 * later increments; see store/types.ts.
 */

import { FEAT, OF } from "../generated";
import { tvalFindIdx } from "../obj/bind";
import type { ObjRegistry } from "../obj/bind";
import type { ObjectKind } from "../obj/types";
import type {
  BoundStore,
  ObjectBuy,
  StoreBuyJson,
  StoreItemJson,
  StoreOwner,
  StoreRecordJson,
} from "./types";

/** Resolve a FEAT_* name (the store record's `store` key) to its index. */
function featByName(name: string): number {
  const feat = (FEAT as Record<string, number>)[name];
  if (feat === undefined) {
    throw new Error(`store: unknown entrance feature ${name}`);
  }
  return feat;
}

/** Resolve an OF_* flag name to its index (for flag-qualified buy rules). */
function flagByName(name: string): number {
  const flag = (OF as Record<string, number>)[name];
  if (flag === undefined) {
    throw new Error(`store: unknown buy flag ${name}`);
  }
  return flag;
}

/** Resolve a `{tval, sval}` table entry (sval required) to its object kind. */
function resolveKind(item: StoreItemJson, reg: ObjRegistry): ObjectKind {
  const tval = tvalFindIdx(item.tval);
  if (tval < 0) throw new Error(`store: unknown tval ${item.tval}`);
  if (item.sval === undefined) {
    throw new Error(`store: table entry ${item.tval} needs an sval`);
  }
  const sval = reg.lookupSval(tval, item.sval);
  if (sval < 0) {
    throw new Error(`store: unknown sval ${item.tval}:${item.sval}`);
  }
  const kind = reg.lookupKind(tval, sval);
  if (!kind) throw new Error(`store: no kind ${item.tval}:${item.sval}`);
  return kind;
}

/** Resolve one buy entry (bare tval string, or `{tval, flag}` object). */
function resolveBuy(entry: StoreBuyJson): ObjectBuy {
  if (typeof entry === "string") {
    const tval = tvalFindIdx(entry);
    if (tval < 0) throw new Error(`store: unknown buy tval ${entry}`);
    return { tval, flag: 0 };
  }
  const tval = tvalFindIdx(entry.tval);
  if (tval < 0) throw new Error(`store: unknown buy tval ${entry.tval}`);
  return { tval, flag: entry.flag ? flagByName(entry.flag) : 0 };
}

/** Bind a single store record. */
export function bindStore(rec: StoreRecordJson, reg: ObjRegistry): BoundStore {
  const owners: StoreOwner[] = rec.owner.map((o, index) => ({
    index,
    name: o.name,
    maxCost: o.purse,
  }));

  /* `always:` entries with an sval resolve to a specific kind; entries with
   * no sval are the bookseller's town-book lines (expansion deferred). */
  const alwaysTable: ObjectKind[] = [];
  const alwaysBookTvals: number[] = [];
  for (const it of rec.always ?? []) {
    if (it.sval === undefined) {
      const tval = tvalFindIdx(it.tval);
      if (tval < 0) throw new Error(`store: unknown always tval ${it.tval}`);
      alwaysBookTvals.push(tval);
    } else {
      alwaysTable.push(resolveKind(it, reg));
    }
  }
  const normalTable = (rec.normal ?? []).map((it) => resolveKind(it, reg));
  const buy = rec.buy ? rec.buy.map(resolveBuy) : null;

  return {
    feat: featByName(rec.store),
    featName: rec.store,
    owners,
    alwaysTable,
    alwaysBookTvals,
    normalTable,
    buy,
    turnover: rec.turnover ?? 0,
    normalStockMin: rec.slots?.min ?? 0,
    normalStockMax: rec.slots?.max ?? 0,
  };
}

/**
 * The bound set of stores, indexable by entrance feature. Mirrors the global
 * `stores` array; `byFeat` is the store_at lookup (given a town grid's feature,
 * which store is it?).
 */
export class StoreRegistry {
  readonly stores: BoundStore[];

  constructor(records: StoreRecordJson[], reg: ObjRegistry) {
    this.stores = records.map((rec) => bindStore(rec, reg));
  }

  /** store_at: the store whose entrance feature matches, or null. */
  byFeat(feat: number): BoundStore | null {
    return this.stores.find((s) => s.feat === feat) ?? null;
  }

  /** The store with the given FEAT_* name, or null. */
  byName(featName: string): BoundStore | null {
    return this.stores.find((s) => s.featName === featName) ?? null;
  }
}
