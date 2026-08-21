/**
 * Bind compiled store records (packages/content/pack/store.json) into the
 * runtime store model, ported from the parsing side of reference/src/store.c
 * (init_parse_stores / store_parser_new / store_owner_parser_new) and
 * store_at (Angband 4.2.6).
 *
 * This is the data-binding slice of the store subsystem. It resolves each
 * store's entrance feature, owners, always/normal stocking tables (tval + sval
 * names -> object kinds), and buy list. The behavioural half of store.c
 * (pricing, stock maintenance, buying/selling, town placement) belongs to
 * later increments; see store/types.ts.
 *
 * A STOCK LINE A MOD CONTRIBUTED CANNOT TAKE THE BOOT DOWN. `append` on a
 * store's `normal` / `always` table (mod-sdk patch.ts) is the op that lets one
 * mod put an item in a shop, and it made this file's `lookupSval` miss reachable
 * from an ordinary pair of mods: mod A stocks an item mod B defines, the player
 * turns mod B off, and `store: unknown sval` came out of `bindCore` inside
 * `startGame` at module top level - so the whole game showed the crash screen
 * instead of the shop showing one line fewer. That is the failure the mod
 * resilience contract exists to forbid, so a mod-contributed line that resolves
 * to nothing is now DROPPED and collected in `StoreRegistry.refused`, which the
 * host turns into a per-mod fault.
 *
 * CORE'S OWN DATA STILL THROWS, and `fieldOwner` (mod/refusal.ts) is the whole
 * of how the two are told apart. That decision lives there rather than here
 * because a second binder needed the same answer and the two must not differ;
 * this file is where it was worked out, and mod/refusal.ts carries the
 * reasoning.
 *
 * The same policy covers every field of a store record a mod can reach: both
 * stocking tables, the `buy` list, and the `store:` entrance feature. The three
 * list fields lose one entry each; the entrance feature is a scalar, so losing
 * it costs the whole shop - see `NO_FEAT` for why that is done by making the
 * store unreachable rather than by removing it.
 */

import { FEAT, OF } from "../generated/index.js";
import { tvalFindIdx } from "../obj/bind.js";
import type { ObjRegistry } from "../obj/bind.js";
import type { ObjectKind } from "../obj/types.js";
import { attachExt, provenanceOf } from "../mod/extension.js";
import type { RecordProvenance } from "../mod/extension.js";
import { fieldOwner, refusalWhy } from "../mod/refusal.js";
import type { RecordRefusal } from "../mod/refusal.js";
import type {
  BoundStore,
  ObjectBuy,
  StoreBuyJson,
  StoreItemJson,
  StoreOwner,
  StoreRecordJson,
} from "./types.js";

/**
 * Which field of a store record a refusal came from.
 *
 * `normal` and `always` are the two stocking tables and `buy` is the sell-to
 * list; all three lose a single entry. `store` is the entrance feature, which
 * is a scalar and costs the whole shop.
 */
export type StoreField = "normal" | "always" | "buy" | "store";

/**
 * The entrance feature of a store whose `store:` a mod pointed at a feature
 * that does not exist.
 *
 * THE STORE STAYS IN THE ARRAY, and that is the deliberate part. `stores` is
 * consumed positionally - `createTownStores` builds the town's shops from it in
 * order, and a saved game restores its stock against that order - so removing a
 * record would renumber every store after it and silently move one shop's
 * inventory into another. A feature index nothing can equal makes `byFeat` miss
 * instead, which is the same thing the player sees (that shop cannot be
 * entered) with none of the renumbering. No town grid is left dangling either:
 * generation places an entrance for a feature that exists, and this one does
 * not.
 */
const NO_FEAT = -1;

/** A resolved table entry, or the reason it resolved to nothing. */
type StockResolution = { readonly kind: ObjectKind } | { readonly why: string };

/**
 * Resolve a `{tval, sval}` table entry (sval required) to its object kind.
 *
 * Returns the miss rather than throwing it: whether a miss is fatal depends on
 * WHOSE line it is, which is a question about the record's provenance and not
 * about the entry, so the decision belongs to the caller. The four `why`
 * strings are the four messages this function used to throw, verbatim, so a
 * core-owned miss still reads exactly as it did.
 */
function resolveKind(item: StoreItemJson, reg: ObjRegistry): StockResolution {
  const tval = tvalFindIdx(item.tval);
  if (tval < 0) return { why: `unknown tval ${item.tval}` };
  if (item.sval === undefined) {
    return { why: `table entry ${item.tval} needs an sval` };
  }
  const sval = reg.lookupSval(tval, item.sval);
  if (sval < 0) return { why: `unknown sval ${item.tval}:${item.sval}` };
  const kind = reg.lookupKind(tval, sval);
  if (!kind) return { why: `no kind ${item.tval}:${item.sval}` };
  return { kind };
}

/**
 * What a store record lost, phrased for the field it lost it from.
 *
 * The sentence itself is `refusalWhy`'s (mod/refusal.ts); this supplies only the
 * half that is about stores, because "dropped a stock line" and "cannot be
 * entered" are not interchangeable to the player reading the row.
 */
function lostWhat(field: StoreField): string {
  if (field === "store") return "shop cannot be entered";
  if (field === "buy") return "buy list entry dropped";
  return `${field} stock line dropped`;
}

/** A resolved buy rule, or the reason it resolved to nothing. */
type BuyResolution = { readonly buy: ObjectBuy } | { readonly why: string };

/**
 * Resolve one buy entry (bare tval string, or `{tval, flag}` object).
 *
 * Returns the miss for the same reason `resolveKind` does - whose entry it is
 * decides whether it is fatal, and that is not visible from here. Both `why`
 * strings are the messages this used to throw, verbatim.
 */
function resolveBuy(entry: StoreBuyJson): BuyResolution {
  const name = typeof entry === "string" ? entry : entry.tval;
  const tval = tvalFindIdx(name);
  if (tval < 0) return { why: `unknown buy tval ${name}` };
  if (typeof entry === "string" || !entry.flag) return { buy: { tval, flag: 0 } };
  const flag = (OF as Record<string, number>)[entry.flag];
  if (flag === undefined) return { why: `unknown buy flag ${entry.flag}` };
  return { buy: { tval, flag } };
}

/**
 * Bind a single store record. This is the semantic half of parse_store
 * (store.c:132) and its sibling directive handlers (parse_slots, parse_turnover,
 * parse_normal, parse_always, parse_buy): the grammar itself lives in
 * packages/content/src/specs/misc.ts storeSpec, and the record arrives here
 * already tokenised.
 *
 * Two upstream parse-time behaviours are deliberately absent, both recorded in
 * parity/phase3-2026-07-25/findings/W1-CITED.md: the TF_SHOP check on the
 * entrance feature (store.c:135-137, a validation on trusted data), and
 * ordering the store array by the feature's shopnum (L142). Stores here keep
 * store.txt order and are looked up by feature (store_at -> byFeat), which
 * matches shopnum order for the shipped data.
 *
 * `refused` collects the mod-contributed entries that resolved to nothing,
 * which are dropped instead of thrown - see the file header and `fieldOwner`.
 * Optional because a caller that passes none is not asking for a different
 * policy, only declining to listen: the drop happens either way, and
 * `StoreRegistry` is the caller that keeps the list for the host to report.
 */
export function bindStore(
  rec: StoreRecordJson,
  reg: ObjRegistry,
  refused?: RecordRefusal[],
): BoundStore {
  const owners: StoreOwner[] = rec.owner.map((o, index) => ({
    index,
    name: o.name,
    maxCost: o.purse,
  }));

  const from = provenanceOf(rec);
  /** One refusal for this record, so four call sites cannot disagree. */
  const refusal = (
    field: StoreField,
    why: string,
    id: string,
    prov: RecordProvenance,
  ): RecordRefusal => ({
    file: "store",
    record: rec.store,
    field,
    id,
    why: refusalWhy(rec.store, lostWhat(field), why, prov),
  });
  /**
   * One stock line, or null when it resolved to nothing and was a mod's to get
   * wrong. A core-owned miss throws here with exactly the message it always
   * threw - the `store: ` prefix included.
   */
  const stockKind = (it: StoreItemJson, table: "normal" | "always"): ObjectKind | null => {
    const res = resolveKind(it, reg);
    if ("kind" in res) return res.kind;
    const owner = fieldOwner(from, table, it);
    if (owner === null || from === undefined) throw new Error(`store: ${res.why}`);
    refused?.push(refusal(table, res.why, owner, from));
    return null;
  };

  /* `always:` entries with an sval resolve to a specific kind; entries with
   * no sval are the bookseller's town-book lines, expanded at store.ts:173. */
  const alwaysTable: ObjectKind[] = [];
  const alwaysBookTvals: number[] = [];
  for (const it of rec.always ?? []) {
    if (it.sval === undefined) {
      const tval = tvalFindIdx(it.tval);
      if (tval < 0) {
        /* A book line whose tval names nothing. Routed through the same policy
         * as a `{tval, sval}` miss rather than throwing on the spot, because a
         * mod appending to `always:` can get either shape wrong and only one of
         * them being survivable would be an arbitrary line. */
        const owner = fieldOwner(from, "always", it);
        if (owner === null || from === undefined) {
          throw new Error(`store: unknown always tval ${it.tval}`);
        }
        refused?.push(refusal("always", `unknown always tval ${it.tval}`, owner, from));
        continue;
      }
      alwaysBookTvals.push(tval);
    } else {
      const kind = stockKind(it, "always");
      if (kind) alwaysTable.push(kind);
    }
  }
  const normalTable: ObjectKind[] = [];
  for (const it of rec.normal ?? []) {
    const kind = stockKind(it, "normal");
    if (kind) normalTable.push(kind);
  }
  /* The buy list, an entry at a time: a mod can append to `buy:` exactly as it
   * appends to `normal:`, so a rule naming a tval or a flag that is not there is
   * the same defect in a different field and gets the same answer. */
  let buy: ObjectBuy[] | null = null;
  if (rec.buy) {
    buy = [];
    for (const entry of rec.buy) {
      const res = resolveBuy(entry);
      if ("buy" in res) {
        buy.push(res.buy);
        continue;
      }
      const owner = fieldOwner(from, "buy", entry);
      if (owner === null || from === undefined) throw new Error(`store: ${res.why}`);
      refused?.push(refusal("buy", res.why, owner, from));
    }
  }

  /* The entrance feature. A mod can repoint `store:` at a feature that does not
   * exist, and unlike a stock line there is nothing left of the shop when it
   * does - so the record survives carrying an index nothing matches. */
  let feat = (FEAT as Record<string, number>)[rec.store];
  if (feat === undefined) {
    const owner = fieldOwner(from, "store", rec.store);
    if (owner === null || from === undefined) {
      throw new Error(`store: unknown entrance feature ${rec.store}`);
    }
    refused?.push(refusal("store", `unknown entrance feature ${rec.store}`, owner, from));
    feat = NO_FEAT;
  }

  return {
    feat,
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

  /**
   * The mod-contributed entries this bind dropped, in record order.
   *
   * ON THE REGISTRY RATHER THAN RETURNED, because `bindCore` builds a dozen
   * registries and hands back one object; a second return channel would have to
   * be threaded through `bindCore`, `bootLevel`, `startGame` AND `loadGame` to
   * reach the host, and both game paths already expose `booted.registries`. The
   * list is a fact about this bind, so a second character's boot starts with an
   * empty one for free - which a module-level collector would not.
   *
   * Empty for the shipped pack with no mods loaded. See `bindStore`.
   */
  readonly refused: readonly RecordRefusal[];

  constructor(records: StoreRecordJson[], reg: ObjRegistry) {
    const refused: RecordRefusal[] = [];
    this.stores = records.map((rec) => attachExt("store", rec, bindStore(rec, reg, refused)));
    this.refused = refused;
  }

  /**
   * store_at: the store whose entrance feature matches, or null.
   *
   * `NO_FEAT` is refused explicitly rather than left to the comparison: a caller
   * that has itself failed to resolve a feature would otherwise hand in -1 and
   * be given the disabled shop.
   */
  byFeat(feat: number): BoundStore | null {
    if (feat === NO_FEAT) return null;
    return this.stores.find((s) => s.feat === feat) ?? null;
  }

  /** The store with the given FEAT_* name, or null. */
  byName(featName: string): BoundStore | null {
    return this.stores.find((s) => s.featName === featName) ?? null;
  }
}
